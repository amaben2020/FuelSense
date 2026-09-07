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

const MOVE_COLOR: Record<PointMove, string> = {
  // Rising fuel cost is the warning colour; falling is good news; flat is
  // neither — same convention as FuelPriceTrend's sparkline.
  up: 'var(--warn)',
  down: 'var(--good)',
  flat: 'var(--ink-dim)',
};

const MOVE_TEXT_CLASS: Record<PointMove, string> = {
  up: 'text-warn',
  down: 'text-good',
  flat: 'text-ink-dim',
};

/**
 * Full-width fuel price history — every declared benchmark price, oldest to
 * newest, plotted as a line with each segment coloured by whether that move
 * was a rise, a fall, or effectively flat. Every naira figure elsewhere on
 * this dashboard is this number times some litres, so its trend earns a
 * chart of its own rather than staying folded into the Settings price panel.
 */
export function FuelPriceChart({ className = '' }: { className?: string }) {
  const [data, setData] = useState<FuelPriceResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<FuelPriceResponse>('/fuel-price')
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const series = data?.trend?.series ?? [];

  if (loading) {
    return (
      <div className={`rounded-xl border border-edge bg-panel p-5 sm:p-6 ${className}`}>
        <p className="text-sm text-ink-dim">Loading fuel price trend…</p>
      </div>
    );
  }

  if (series.length < 2) {
    return (
      <div className={`rounded-xl border border-edge bg-panel p-5 sm:p-6 ${className}`}>
        <div className="flex items-center gap-2 text-ink-dim">
          <Fuel className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-[0.12em]">Fuel price trend</span>
        </div>
        <p className="mt-2 text-sm text-ink-dim">
          {series.length === 0
            ? 'No benchmark price declared yet — set one in Settings to start the trend.'
            : 'One declared price is a fact, not a trend yet — set a second price to see movement.'}
        </p>
      </div>
    );
  }

  // Per-point move relative to the previous declared price, oldest first.
  const points = series.map((p, i) => {
    const prev = series[i - 1];
    const pct = prev && prev.ngn_per_liter > 0 ? ((p.ngn_per_liter - prev.ngn_per_liter) / prev.ngn_per_liter) * 100 : 0;
    return {
      ngnPerLiter: p.ngn_per_liter,
      effectiveFrom: p.effective_from,
      pct,
      move: i === 0 ? ('flat' as PointMove) : moveFor(pct),
    };
  });

  const values = points.map((p) => p.ngnPerLiter);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const W = 640;
  const H = 160;
  const PAD_X = 12;
  const PAD_Y = 20;

  const coords = points.map((p, i) => {
    const x = points.length > 1 ? (i / (points.length - 1)) * (W - PAD_X * 2) + PAD_X : W / 2;
    const y = H - PAD_Y - ((p.ngnPerLiter - min) / span) * (H - PAD_Y * 2);
    return { x, y, ...p };
  });

  const trend = data!.trend!;
  const overallMove = moveFor(trend.change_pct);

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

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-4 w-full overflow-visible"
        role="img"
        aria-label={`Fuel price ${trend.direction === 'flat' ? 'unchanged' : trend.direction === 'up' ? 'rising' : 'falling'}, from ${formatNgn(values[0])} to ${formatNgn(values[values.length - 1])} per litre`}
      >
        {coords.slice(1).map((pt, i) => {
          const prev = coords[i];
          return (
            <line
              key={`seg-${i}`}
              x1={prev.x}
              y1={prev.y}
              x2={pt.x}
              y2={pt.y}
              stroke={MOVE_COLOR[pt.move]}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          );
        })}
        {coords.map((pt, i) => (
          <g key={`pt-${i}`}>
            <circle cx={pt.x} cy={pt.y} r={4} fill={MOVE_COLOR[pt.move]} />
            <text
              x={pt.x}
              y={pt.y - 10}
              textAnchor={i === 0 ? 'start' : i === coords.length - 1 ? 'end' : 'middle'}
              className="fill-ink text-[10px] font-mono"
            >
              {formatNgn(pt.ngnPerLiter)}
            </text>
          </g>
        ))}
      </svg>

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
