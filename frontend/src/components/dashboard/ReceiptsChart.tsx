'use client';

import { useEffect, useMemo, useState } from 'react';
import { FuelPurchasesResponse, api, formatNgn } from '@/lib/api';
import { SnapshotPeriod, periodQuery, periodStartMs } from '@/lib/period';

/**
 * Receipts by day across the snapshot window: what was paid, and when.
 *
 * Built from the purchases endpoint's `daily_totals`, which aggregates every
 * receipt in the window (it is not paged), so the bars add up to the figure
 * above them rather than to the first page of a list. Windows longer than a
 * month bucket by week so the bars stay wide enough to read.
 */
export function ReceiptsChart({ period }: { period: SnapshotPeriod }) {
  const [daily, setDaily] = useState<Map<string, { cost: number; liters: number; count: number }> | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let live = true;
    api<FuelPurchasesResponse>(`/telemetry/fuel-purchases?${periodQuery(period)}&limit=1&include_summary=true`)
      .then((res) => {
        if (!live) return;
        const byDate = new Map<string, { cost: number; liters: number; count: number }>();
        for (const row of res.summary?.daily_totals ?? []) {
          const key = row.activity_date.slice(0, 10);
          const prev = byDate.get(key) ?? { cost: 0, liters: 0, count: 0 };
          byDate.set(key, {
            cost: prev.cost + Number(row.total_cost_ngn || 0),
            liters: prev.liters + Number(row.total_receipt_liters || 0),
            count: prev.count + Number(row.receipt_count || 0),
          });
        }
        setDaily(byDate);
        requestAnimationFrame(() => live && setShown(true));
      })
      .catch(() => live && setDaily(new Map()));
    return () => {
      live = false;
    };
  }, [period]);

  const buckets = useMemo(() => {
    if (!daily) return [];
    const start = new Date(periodStartMs(period));
    const end = period.to ? new Date(`${period.to}T12:00:00+01:00`) : new Date();
    const days: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push(d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }));
    }
    const unique = [...new Set(days)];
    const size = unique.length > 31 ? 7 : 1;
    const out: { label: string; cost: number; liters: number; count: number }[] = [];
    for (let i = 0; i < unique.length; i += size) {
      const slice = unique.slice(i, i + size);
      const sum = slice.reduce(
        (acc, k) => {
          const v = daily.get(k);
          return v ? { cost: acc.cost + v.cost, liters: acc.liters + v.liters, count: acc.count + v.count } : acc;
        },
        { cost: 0, liters: 0, count: 0 }
      );
      const first = new Date(`${slice[0]}T12:00:00+01:00`);
      const label =
        size === 1
          ? first.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
          : `Week of ${first.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
      out.push({ label, ...sum });
    }
    return out;
  }, [daily, period]);

  if (!daily || buckets.every((b) => b.cost === 0)) return null;

  const max = Math.max(...buckets.map((b) => b.cost));
  const active = hover != null ? buckets[hover] : null;

  return (
    <div className="mt-5 flex h-[150px] flex-col">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-dim">
          Receipts by {buckets.length && buckets[0].label.startsWith('Week') ? 'week' : 'day'}
        </p>
        <p className="truncate font-mono text-[11px] tabular-nums text-ink-dim">
          {active
            ? active.cost > 0
              ? `${active.label} · ${formatNgn(active.cost)} · ${active.liters.toFixed(1)} L`
              : `${active.label} · no receipts`
            : `${buckets.filter((b) => b.cost > 0).length} of ${buckets.length} with receipts`}
        </p>
      </div>
      <div
        className="relative flex flex-1 items-end gap-[3px] border-b border-edge pb-px"
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Receipts over the period, highest ${formatNgn(max)}`}
      >
        {buckets.map((b, i) => {
          const h = b.cost > 0 ? Math.max((b.cost / max) * 100, 6) : 0;
          return (
            <button
              key={b.label}
              type="button"
              tabIndex={-1}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              className="group relative flex h-full min-w-0 flex-1 items-end"
              aria-label={`${b.label}: ${b.cost > 0 ? formatNgn(b.cost) : 'no receipts'}`}
            >
              {b.cost > 0 ? (
                <span
                  className={`mx-auto w-full max-w-[14px] rounded-t-[3px] transition-[height,background-color] duration-700 ease-[cubic-bezier(.22,1,.36,1)] ${
                    hover === i ? 'bg-accent' : 'bg-accent/70 group-hover:bg-accent'
                  }`}
                  style={{ height: shown ? `${h}%` : '0%', transitionDelay: shown ? `${i * 18}ms` : '0ms' }}
                />
              ) : (
                <span className={`mx-auto mb-0.5 h-1 w-1 rounded-full ${hover === i ? 'bg-ink-mid' : 'bg-ink/15'}`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
