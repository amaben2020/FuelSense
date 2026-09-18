'use client';

import { useEffect, useState } from 'react';
import { TrendingDown, TrendingUp, Minus, Fuel } from 'lucide-react';
import { api, formatNgn, FuelPriceResponse } from '@/lib/api';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });

// A move smaller than this reads as noise, not a real rise or fall — the
// third colour exists so a ₦2 rounding-sized change doesn't paint the same
// red as a real ₦150 jump.
const FLAT_TOLERANCE_PCT = 0.5;

type PointMove = 'up' | 'down' | 'flat';

function moveFor(pct: number): PointMove {
  if (pct > FLAT_TOLERANCE_PCT) return 'up';
  if (pct < -FLAT_TOLERANCE_PCT) return 'down';
  return 'flat';
}

const MOVE_TEXT_CLASS: Record<PointMove, string> = {
  // Rising fuel cost is the warning colour; falling is good news; flat is
  // neither — same convention as FuelPriceTrend's sparkline.
  up: 'text-warn',
  down: 'text-good',
  flat: 'text-ink-dim',
};

// Plot geometry. The left gutter holds the price axis and the bottom strip
// the dates, so the drawing area is what's left inside them.
const W = 720;
const H = 240;
const PAD = { top: 18, right: 16, bottom: 30, left: 56 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const Y_TICKS = 4;

/** Rounds a price span out to friendly ₦25 boundaries so the axis labels are
 *  readable numbers rather than 1,273.4 / 1,291.8 / 1,310.2. */
function niceBounds(min: number, max: number): { lo: number; hi: number } {
  if (max === min) return { lo: min - 25, hi: max + 25 };
  const step = 25;
  const pad = (max - min) * 0.15;
  return {
    lo: Math.floor((min - pad) / step) * step,
    hi: Math.ceil((max + pad) / step) * step,
  };
}

/**
 * Fuel price history — the declared benchmark against what was actually paid.
 *
 * Two things a single line could not say. The benchmark is a **step**: a
 * declared price holds flat until the manager changes it, so drawing it as a
 * diagonal ramp between declarations invents a gradual drift that never
 * happened. And the benchmark is only half the story — it is a figure the
 * manager sets, so it can drift away from the pump. Receipt prices are
 * plotted alongside it as discrete observations, because that is what they
 * are: one driver, one pump, one day.
 *
 * The x-axis is time-proportional. Evenly spacing the declarations drew a
 * one-day gap and a three-week gap the same width, which is precisely the
 * thing a price chart exists to show.
 */
export function FuelPriceChart({ className = '' }: { className?: string }) {
  const [data, setData] = useState<FuelPriceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // The newest declared price is still in force, so the step has to run to
  // "now" — captured once on mount rather than read during render, which is
  // not a pure thing to do and would redraw the plot on every render anyway.
  const [now, setNow] = useState<number | null>(null);
  const [adopting, setAdopting] = useState(false);

  const load = () =>
    api<FuelPriceResponse>('/fuel-price')
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));

  useEffect(() => {
    setNow(Date.now());
    void load();
  }, []);

  /** One click closes the gap: the receipt price becomes the benchmark from today. */
  const adoptReceiptPrice = async (price: number) => {
    setAdopting(true);
    try {
      await api('/fuel-price', {
        method: 'POST',
        body: JSON.stringify({ ngn_per_liter: price, note: 'Adopted from the latest receipt' }),
      });
      await load();
    } finally {
      setAdopting(false);
    }
  };

  const series = data?.trend?.series ?? [];
  const receiptSeries = data?.trend?.receipts ?? [];

  if (loading || now === null) {
    return (
      <div className={`rounded-xl border border-edge bg-panel p-5 sm:p-6 ${className}`}>
        <p className="text-sm text-ink-dim">Loading fuel price trend…</p>
      </div>
    );
  }

  if (series.length === 0) {
    return (
      <div className={`rounded-xl border border-edge bg-panel p-5 sm:p-6 ${className}`}>
        <div className="flex items-center gap-2 text-ink-dim">
          <Fuel className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-[0.12em]">Fuel price trend</span>
        </div>
        <p className="mt-2 text-sm text-ink-dim">
          No benchmark price declared yet — set one in Settings to start the trend.
        </p>
      </div>
    );
  }

  // Per-point move relative to the previous declared price, oldest first.
  const points = series.map((p, i) => {
    const prev = series[i - 1];
    const pct =
      prev && prev.ngn_per_liter > 0
        ? ((p.ngn_per_liter - prev.ngn_per_liter) / prev.ngn_per_liter) * 100
        : 0;
    return {
      ngnPerLiter: p.ngn_per_liter,
      effectiveFrom: p.effective_from,
      at: new Date(p.effective_from).getTime(),
      pct,
      move: i === 0 ? ('flat' as PointMove) : moveFor(pct),
    };
  });

  const receipts = receiptSeries.map((r) => ({
    ngnPerLiter: r.ngn_per_liter,
    at: new Date(r.as_of).getTime(),
    asOf: r.as_of,
  }));

  const times = [...points.map((p) => p.at), ...receipts.map((r) => r.at), now];
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const tSpan = tMax - tMin || 1;

  const allPrices = [...points.map((p) => p.ngnPerLiter), ...receipts.map((r) => r.ngnPerLiter)];
  const { lo, hi } = niceBounds(Math.min(...allPrices), Math.max(...allPrices));
  const ySpan = hi - lo || 1;

  const x = (t: number) => PAD.left + ((t - tMin) / tSpan) * PLOT_W;
  const y = (v: number) => PAD.top + PLOT_H - ((v - lo) / ySpan) * PLOT_H;

  // A line through each declared price, carried flat to today for the one
  // still in force. It read as a staircase before; a manager wants to see the
  // direction the price is moving, not the mechanics of when it was typed in.
  const stepPath = [
    ...points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.at).toFixed(1)} ${y(p.ngnPerLiter).toFixed(1)}`),
    `L ${x(now).toFixed(1)} ${y(points[points.length - 1].ngnPerLiter).toFixed(1)}`,
  ].join(' ');

  const yTicks = Array.from({ length: Y_TICKS + 1 }, (_, i) => lo + (ySpan / Y_TICKS) * i);

  const trend = data!.trend!;
  const overallMove = moveFor(trend.change_pct);
  const latestReceipt = data?.latest_receipt ?? null;
  const currentBenchmark = points[points.length - 1];

  // The gap that actually matters: what the fleet is charged versus what the
  // manager has told the product to expect.
  const gapNgn = latestReceipt ? latestReceipt.ngn_per_liter - currentBenchmark.ngnPerLiter : null;

  return (
    <div className={`rounded-xl border border-edge bg-panel p-5 sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-ink-dim">
          <Fuel className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-[0.12em]">Fuel price trend</span>
        </div>
        <span className={`flex items-center gap-1 text-sm font-medium ${MOVE_TEXT_CLASS[overallMove]}`}>
          {overallMove === 'up' ? (
            <TrendingUp className="h-4 w-4" />
          ) : overallMove === 'down' ? (
            <TrendingDown className="h-4 w-4" />
          ) : (
            <Minus className="h-4 w-4" />
          )}
          {trend.change_pct === 0
            ? 'No change'
            : `${trend.change_pct > 0 ? '+' : ''}${trend.change_pct}%`}{' '}
          over {trend.changes} declared price{trend.changes === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-dim">
        <span className="flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden className="shrink-0">
            <path d="M0 6 L9 3 L18 2" fill="none" stroke="var(--accent-y)" strokeWidth="2" />
          </svg>
          Declared benchmark
        </span>
        {receipts.length > 0 && (
          <span className="flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden className="shrink-0">
              <circle cx="5" cy="4" r="3" fill="var(--warn)" />
              <circle cx="14" cy="4" r="3" fill="var(--warn)" />
            </svg>
            Price paid on a receipt
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 w-full"
        role="img"
        aria-label={`Declared fuel price ${trend.direction === 'flat' ? 'unchanged' : trend.direction === 'up' ? 'rising' : 'falling'}, from ${formatNgn(points[0].ngnPerLiter)} to ${formatNgn(currentBenchmark.ngnPerLiter)} per litre${latestReceipt ? `, against a latest receipt price of ${formatNgn(latestReceipt.ngn_per_liter)}` : ''}`}
      >
        {/* Gridlines and the price axis. Not zero-based: Nigerian pump prices
            move a few percent at a time, and a zero-based axis flattens every
            one of those into the same horizontal line. */}
        {yTicks.map((v) => (
          <g key={`tick-${v}`}>
            <line
              x1={PAD.left}
              y1={y(v)}
              x2={W - PAD.right}
              y2={y(v)}
              stroke="var(--edge)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(v) + 3.5}
              textAnchor="end"
              className="fill-ink-dim font-mono text-[10px]"
            >
              {Math.round(v).toLocaleString()}
            </text>
          </g>
        ))}

        {/* Date axis: first declaration, and today at the right edge. */}
        <text x={PAD.left} y={H - 10} textAnchor="start" className="fill-ink-dim text-[10px]">
          {formatDate(points[0].effectiveFrom)}
        </text>
        <text x={W - PAD.right} y={H - 10} textAnchor="end" className="fill-ink-dim text-[10px]">
          Today
        </text>

        <path
          d={stepPath}
          fill="none"
          stroke="var(--accent-y)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Each declaration marked where it took effect. */}
        {points.map((p, i) => (
          <circle
            key={`decl-${i}`}
            cx={x(p.at)}
            cy={y(p.ngnPerLiter)}
            r={3.5}
            fill="var(--accent-y)"
          >
            <title>{`Declared ${formatNgn(p.ngnPerLiter)}/L on ${formatDate(p.effectiveFrom)}`}</title>
          </circle>
        ))}

        {/* Receipts as discrete observations — deliberately not joined into a
            line, because consecutive receipts are different drivers at
            different pumps, not a series. */}
        {receipts.map((r, i) => (
          <circle
            key={`rcpt-${i}`}
            cx={x(r.at)}
            cy={y(r.ngnPerLiter)}
            r={3}
            fill="var(--warn)"
            fillOpacity={0.85}
          >
            <title>{`Paid ${formatNgn(r.ngnPerLiter)}/L on ${formatDate(r.asOf)}`}</title>
          </circle>
        ))}

        {/* The newest receipt is the one a manager is looking for, so it is
            the only point labelled on the plot. */}
        {latestReceipt && (
          <g>
            <circle
              cx={x(new Date(latestReceipt.as_of).getTime())}
              cy={y(latestReceipt.ngn_per_liter)}
              r={5}
              fill="none"
              stroke="var(--warn)"
              strokeWidth={2}
            />
            <text
              x={Math.min(x(new Date(latestReceipt.as_of).getTime()), W - PAD.right - 4)}
              y={y(latestReceipt.ngn_per_liter) - 12}
              textAnchor="end"
              className="fill-warn font-mono text-[11px] font-semibold"
            >
              {formatNgn(latestReceipt.ngn_per_liter)}
            </text>
          </g>
        )}
      </svg>

      {gapNgn != null && Math.abs(gapNgn) >= 1 && (
        <p className="mt-3 rounded-lg border border-edge bg-canvas px-3 py-2 text-xs text-ink-mid">
          The latest receipt is{' '}
          <span className={gapNgn > 0 ? 'font-semibold text-warn' : 'font-semibold text-good'}>
            {formatNgn(Math.abs(gapNgn))}/L {gapNgn > 0 ? 'above' : 'below'}
          </span>{' '}
          the declared benchmark. Expected cost and cost per km use the benchmark, so a
          persistent gap is worth closing.{' '}
          {gapNgn > 0 && (
            <button
              type="button"
              disabled={adopting}
              onClick={() => void adoptReceiptPrice(latestReceipt!.ngn_per_liter)}
              className="font-semibold text-brand underline-offset-2 hover:underline disabled:opacity-50"
            >
              Use {formatNgn(latestReceipt!.ngn_per_liter)}/L as the benchmark from today
            </button>
          )}
        </p>
      )}

      <div className="mt-4 max-h-40 overflow-y-auto border-t border-edge pt-2">
        <ul className="space-y-1">
          {[...points].reverse().map((p, i, arr) => (
            <li
              key={`${p.effectiveFrom}-${i}`}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <span className="text-ink-dim">{formatDate(p.effectiveFrom)}</span>
              <span className="font-mono text-ink">{formatNgn(p.ngnPerLiter)}/L</span>
              <span className={`font-mono tabular-nums ${MOVE_TEXT_CLASS[p.move]}`}>
                {i === arr.length - 1
                  ? 'first declared'
                  : `${p.pct > 0 ? '+' : ''}${p.pct.toFixed(1)}%`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
