'use client';

import { useState } from 'react';

export interface TrendPoint {
  /** ISO date (YYYY-MM-DD) — the x position and the tooltip's heading. */
  date: string;
  value: number;
}

/**
 * One measure over consecutive days, as thin bars on a baseline.
 *
 * Single series, so there is no legend — the panel title names it — and no
 * second axis: a second measure gets its own chart beside this one. Bars
 * carry the chart-mark token (a step darker than the accent, so a wall of
 * them does not glare); text stays in ink tokens. Hover shows the day and
 * the value; the last bar is direct-labelled so the current figure reads
 * without hovering.
 */
export function TrendBars({
  points,
  format,
  height = 96,
  emptyLabel = 'No data for this period yet.',
}: {
  points: TrendPoint[];
  format: (value: number) => string;
  height?: number;
  emptyLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 320;
  const padTop = 14;
  const padBottom = 18;
  const plotH = height - padTop - padBottom;
  const max = Math.max(...points.map((p) => p.value), 0);

  if (points.length === 0 || max <= 0) {
    return <p className="py-6 text-center text-xs text-ink-dim">{emptyLabel}</p>;
  }

  const gap = 2;
  const barW = Math.max(2, (width - gap * (points.length - 1)) / points.length);
  const x = (i: number) => i * (barW + gap);
  const h = (v: number) => (v / max) * plotH;
  const last = points.length - 1;
  const active = hover ?? last;
  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${points.length} days, latest ${format(points[last].value)}`}
        onMouseLeave={() => setHover(null)}
      >
        <line
          x1={0}
          x2={width}
          y1={padTop + plotH}
          y2={padTop + plotH}
          stroke="var(--edge)"
          strokeWidth={1}
        />
        {points.map((p, i) => {
          const bh = h(p.value);
          const isActive = i === active;
          return (
            <g key={p.date}>
              {/* Hit target wider than the mark, so a 3px bar is easy to hover. */}
              <rect
                x={x(i)}
                y={padTop}
                width={barW + gap}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
              <rect
                x={x(i)}
                y={padTop + plotH - bh}
                width={barW}
                height={bh}
                rx={Math.min(3, barW / 2)}
                fill={isActive ? 'var(--accent-y)' : 'var(--chart-bar)'}
                pointerEvents="none"
              />
            </g>
          );
        })}
        <text
          x={Math.min(width - 2, Math.max(2, x(active) + barW / 2))}
          y={padTop - 4}
          textAnchor={active > points.length * 0.8 ? 'end' : active < points.length * 0.2 ? 'start' : 'middle'}
          className="fill-ink"
          fontSize={11}
          fontWeight={700}
        >
          {format(points[active].value)}
        </text>
        <text x={0} y={height - 4} className="fill-ink-dim" fontSize={10}>
          {dayLabel(points[0].date)}
        </text>
        <text x={width} y={height - 4} textAnchor="end" className="fill-ink-dim" fontSize={10}>
          {dayLabel(points[last].date)}
        </text>
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute -top-1 rounded-md border border-edge bg-panel px-2 py-1 text-[11px] shadow-md"
          style={{ left: `${(x(hover) / width) * 100}%`, transform: 'translate(-50%, -100%)' }}
        >
          <span className="text-ink-dim">{dayLabel(points[hover].date)}</span>{' '}
          <span className="font-semibold text-ink">{format(points[hover].value)}</span>
        </div>
      )}
    </div>
  );
}
