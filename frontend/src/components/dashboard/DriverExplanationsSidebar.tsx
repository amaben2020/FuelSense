'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Flag, Loader2, MapPin, MessageSquareText, Phone, X } from 'lucide-react';
import {
  DriverExplanation,
  actOnExplanation,
  fetchExplanations,
} from '@/lib/api';
import { StatusChip } from '@/components/ui/chrome';

/**
 * Driver explanations waiting on a manager.
 *
 * A driver's account of a zone exit or a power loss lands here rather than
 * silently closing the alert. The manager reads it and either accepts it —
 * the alert closes with the note on record — or escalates it, which keeps
 * the alert open and flagged with their reason. Either way the queue is
 * cleared one decision at a time, and the audit trail reads a name.
 */
export function DriverExplanationsSidebar({
  isOpen,
  onClose,
  onViewOnMap,
  readOnly = false,
  onCountChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  onViewOnMap?: (lat: number, lng: number, vehicleId: string) => void;
  /** A viewer can read the queue; the buttons are hidden for them. */
  readOnly?: boolean;
  onCountChange?: (pending: number) => void;
}) {
  const [items, setItems] = useState<DriverExplanation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escalating, setEscalating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchExplanations();
      setItems(data.explanations);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load explanations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    onCountChange?.(items.length);
  }, [items.length, onCountChange]);

  // Polled while closed too, so the header badge counts what is waiting
  // without anyone opening the drawer to find out.
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (item: DriverExplanation, action: 'accepted' | 'escalated') => {
    setBusy(item.id);
    try {
      await actOnExplanation(item.id, action, action === 'escalated' ? comment : undefined);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setEscalating(null);
      setComment('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that');
    } finally {
      setBusy(null);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <button type="button" className="fixed inset-0 z-40 bg-black/50" aria-label="Close" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-hidden border-l border-edge bg-panel shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-accent-y" />
            <div>
              <p className="text-sm font-semibold text-ink">From drivers</p>
              <p className="text-[11px] text-ink-dim">
                {items.length ? `${items.length} waiting on you` : 'Nothing waiting'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-mid hover:bg-divider">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error && <p className="mb-3 rounded-lg bg-bad-deep/20 p-3 text-xs text-bad">{error}</p>}

          {loading && !items.length && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-brand" />
            </div>
          )}

          {!loading && !items.length && !error && (
            <p className="py-10 text-center text-sm text-ink-dim">
              When a driver explains a zone exit or a tracker power loss, it appears here for
              you to accept or escalate.
            </p>
          )}

          <ul className="space-y-3">
            {items.map((item) => {
              const lat = item.latitude != null ? Number(item.latitude) : null;
              const lng = item.longitude != null ? Number(item.longitude) : null;
              const isEscalating = escalating === item.id;
              const isBusy = busy === item.id;
              return (
                <li key={item.id} className="rounded-xl border border-edge bg-panel-deep p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {item.license_plate ?? 'Vehicle'}{' '}
                        <span className="font-normal text-ink-dim">· {item.driver_name ?? 'Driver'}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-mid">{item.message}</p>
                    </div>
                    <StatusChip tone={item.severity === 'critical' ? 'bad' : item.severity === 'warning' ? 'warn' : 'info'}>
                      {item.label}
                    </StatusChip>
                  </div>

                  <blockquote className="mt-3 rounded-lg border-l-2 border-accent-y bg-canvas px-3 py-2 text-sm text-ink">
                    “{item.driver_note}”
                    <footer className="mt-1 text-[11px] text-ink-dim">
                      {new Date(item.driver_note_at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}
                    </footer>
                  </blockquote>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {lat != null && lng != null && onViewOnMap && item.vehicle_id && (
                      <button
                        type="button"
                        onClick={() => onViewOnMap(lat, lng, item.vehicle_id!)}
                        className="inline-flex items-center gap-1 rounded-full border border-edge px-3 py-1 text-[11px] text-ink-mid hover:bg-panel-hover"
                      >
                        <MapPin className="h-3 w-3" /> On map
                      </button>
                    )}
                    {item.driver_phone && (
                      <a
                        href={`tel:${item.driver_phone}`}
                        className="inline-flex items-center gap-1 rounded-full border border-edge px-3 py-1 text-[11px] text-ink-mid hover:bg-panel-hover"
                      >
                        <Phone className="h-3 w-3" /> Call
                      </a>
                    )}
                    {!readOnly && (
                      <span className="ml-auto flex gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setEscalating(isEscalating ? null : item.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-edge px-3 py-1 text-[11px] font-medium text-ink-mid transition-colors hover:border-warn/60 hover:text-warn disabled:opacity-40"
                        >
                          <Flag className="h-3 w-3" /> Escalate
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void act(item, 'accepted')}
                          className="inline-flex items-center gap-1 rounded-full bg-good px-3 py-1 text-[11px] font-semibold text-accent-y-ink disabled:opacity-40"
                        >
                          {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          Accept
                        </button>
                      </span>
                    )}
                  </div>

                  {isEscalating && !readOnly && (
                    <div className="mt-3">
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        maxLength={500}
                        rows={2}
                        placeholder="Why this needs looking into (optional)"
                        className="w-full rounded-lg border border-edge bg-panel px-2 py-2 text-sm text-ink placeholder-ink-dim"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEscalating(null);
                            setComment('');
                          }}
                          className="rounded-full border border-edge px-3 py-1 text-[11px] text-ink-mid hover:bg-panel-hover"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void act(item, 'escalated')}
                          className="inline-flex items-center gap-1 rounded-full bg-warn px-3 py-1 text-[11px] font-semibold text-canvas disabled:opacity-40"
                        >
                          <Flag className="h-3 w-3" /> Keep open and flag
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}
