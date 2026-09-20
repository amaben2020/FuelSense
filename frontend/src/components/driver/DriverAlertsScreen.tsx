'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BellOff, CheckCircle2, Info, Loader2, Send, ShieldAlert } from 'lucide-react';
import {
  DriverAlert,
  explainDriverAlert,
  fetchDriverAlerts,
} from '@/lib/driver-api';
import { useLatest } from '@/lib/use-latest';

const PAGE_SIZE = 20;

const SEVERITY_ICON = {
  critical: ShieldAlert,
  warning: AlertTriangle,
  info: Info,
} as const;

const SEVERITY_STYLE = {
  critical: 'bg-bad/15 text-bad',
  warning: 'bg-warn/15 text-warn',
  info: 'bg-good/15 text-good',
} as const;

function when(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: '2-digit',
    month: 'short',
  });
}

/**
 * What the fleet has flagged, and the driver's chance to answer it.
 *
 * Alerts were manager-only, so a driver could be carrying an unexplained
 * "left the depot zone at 19:40" for a week without knowing it existed. Here
 * they see it and can say why — which for everyday alerts closes the matter
 * before anyone has to ask.
 */
export function DriverAlertsScreen({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [alerts, setAlerts] = useState<DriverAlert[] | null>(null);
  const [periodDays, setPeriodDays] = useState(14);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // Held in a ref so `load` keeps a stable identity. Depending on the callback
  // directly would re-run the fetch on every render for any parent that passes
  // an inline function.
  const notify = useLatest(onCountChange);

  /** Resets to page 1 — used on mount and after answering an alert changes
   *  which ones are still unanswered. */
  const reload = useCallback(async () => {
    try {
      const d = await fetchDriverAlerts(14, 1, PAGE_SIZE);
      setAlerts(d.alerts);
      setPeriodDays(d.period_days);
      setPage(1);
      setHasMore(d.has_more);
      setError(null);
      notify.current?.(d.unanswered);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // IntersectionObserver drives "load more" instead of a scroll listener: it
  // only fires when the sentinel actually enters the viewport, so there is no
  // per-scroll-event work and nothing to throttle by hand.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useLatest(loadingMore);
  const hasMoreRef = useLatest(hasMore);
  const pageRef = useLatest(page);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (loadingMoreRef.current || !hasMoreRef.current) return;

        const nextPage = pageRef.current + 1;
        setLoadingMore(true);
        fetchDriverAlerts(periodDays, nextPage, PAGE_SIZE)
          .then((d) => {
            setAlerts((prev) => [...(prev ?? []), ...d.alerts]);
            setPage(nextPage);
            setHasMore(d.has_more);
          })
          .catch((err) => setError((err as Error).message))
          .finally(() => setLoadingMore(false));
      },
      { rootMargin: '200px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [periodDays, loadingMoreRef, hasMoreRef, pageRef]);

  const send = async (alert: DriverAlert) => {
    const text = note.trim();
    if (!text) return;
    setSending(true);
    try {
      const res = await explainDriverAlert(alert.id, text);
      setFlash(res.message);
      setOpenId(null);
      setNote('');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (error) {
    return (
      <div className="rounded-2xl border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
        {error}
        <button
          type="button"
          onClick={reload}
          className="mt-3 block w-full rounded-xl border border-bad/40 py-2.5 text-sm font-semibold"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {flash && (
        <p className="rounded-xl border border-good/40 bg-good/10 px-3 py-2.5 text-sm text-good">
          {flash}
        </p>
      )}

      {alerts == null ? (
        <p className="py-10 text-center text-sm text-ink-dim">Loading…</p>
      ) : alerts.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-panel px-4 py-10 text-center">
          <BellOff className="mx-auto mb-2 h-6 w-6 text-ink-dim" />
          <p className="text-sm text-ink-mid">Nothing flagged</p>
          <p className="mt-1 text-xs text-ink-dim">
            Nothing about your driving, your fuel or your tracker has been flagged in the
            last {periodDays} days.
          </p>
        </div>
      ) : (
        alerts.map((a, i) => {
          const Icon = SEVERITY_ICON[a.severity] ?? Info;
          const isOpen = openId === a.id;
          // The API puts unanswered alerts first. Mark the boundary so the
          // driver can see where the to-do ends and the notices begin.
          const heading =
            i === 0 && a.can_explain
              ? 'Needs your answer'
              : !a.can_explain && (i === 0 || alerts[i - 1].can_explain)
                ? 'For your information'
                : null;
          return (
            <Fragment key={a.id}>
            {heading && (
              <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
                {heading}
              </p>
            )}
            <div className="rounded-2xl border border-edge bg-panel p-4">
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    SEVERITY_STYLE[a.severity] ?? SEVERITY_STYLE.info
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <p className="font-semibold text-ink">{a.label}</p>
                    <span className="shrink-0 text-[11px] text-ink-dim">
                      {when(a.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ink-mid">{a.message}</p>
                </div>
              </div>

              {a.driver_note && (
                <div className="mt-3 rounded-xl bg-canvas px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-good">
                    <CheckCircle2 className="h-3 w-3" /> You answered this
                  </p>
                  <p className="mt-1 text-sm text-ink-mid">{a.driver_note}</p>
                </div>
              )}

              {a.can_explain &&
                (isOpen ? (
                  <div className="mt-3">
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={500}
                      rows={3}
                      autoFocus
                      placeholder="What happened? The customer moved the pickup, traffic held me at the gate…"
                      className="w-full resize-none rounded-xl border border-edge bg-canvas px-3 py-2.5 text-base text-ink placeholder-ink-dim"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={sending || !note.trim()}
                        onClick={() => send(a)}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-canvas disabled:opacity-40"
                      >
                        <Send className="h-4 w-4" />
                        {sending ? 'Sending…' : 'Send to manager'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenId(null);
                          setNote('');
                        }}
                        className="rounded-xl border border-edge px-4 py-3 text-sm font-medium text-ink-mid"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(a.id);
                      setNote('');
                      setFlash(null);
                    }}
                    className="mt-3 w-full rounded-xl border border-accent/40 bg-accent/10 py-3 text-sm font-semibold text-brand"
                  >
                    Explain what happened
                  </button>
                ))}
            </div>
            </Fragment>
          );
        })
      )}

      {/* Invisible trigger for the next page. Placed after the list rather
          than wrapped around a "Load more" button, so scrolling near the
          bottom is the only gesture needed. */}
      {alerts != null && alerts.length > 0 && hasMore && (
        <div ref={sentinelRef} className="h-1" aria-hidden="true" />
      )}
      {loadingMore && (
        <p className="flex items-center justify-center gap-2 py-4 text-xs text-ink-dim">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading more…
        </p>
      )}
    </div>
  );
}
