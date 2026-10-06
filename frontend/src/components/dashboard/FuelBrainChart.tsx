'use client';

import { useMemo, useState } from 'react';
import { Table2 } from 'lucide-react';
import type { ChartSpec } from '@/lib/fuelbrain-chart-spec';

export { parseChartSpec, type ChartSpec } from '@/lib/fuelbrain-chart-spec';

const W = 560;
const H = 240;
const M = { top: 12, right: 16, bottom: 30, left: 48 };

/** Round the top of the axis up to a clean step: 1, 2, 2.5 or 5 x 10^n. */
function niceScale(min: number, max: number, ticks = 4) {
  const lo = Math.min(0, min);
  const hi = max <= lo ? lo + 1 : max;
  const raw = (hi - lo) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(hi / step) * step;
  const bottom = Math.floor(lo / step) * step;
  const values: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) values.push(Number(v.toFixed(10)));
  return { bottom, top, values };
}

const fmt = (v: number) =>
  Math.abs(v) >= 1000 ? v.toLocaleString('en-NG', { maximumFractionDigits: 0 }) : String(Number(v.toFixed(2)));

const color = (i: number) => `var(--fb-s${i + 1})`;

/** A bar whose top corners are rounded 4px and whose base sits square on the axis. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, Math.abs(h));
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function FuelBrainChart({ spec }: { spec: ChartSpec }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const geom = useMemo(() => {
    const all = spec.series.flatMap((s) => s.values.filter((v): v is number => v != null));
    const scale = niceScale(all.length ? Math.min(...all) : 0, all.length ? Math.max(...all) : 1);
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;
    const band = plotW / spec.x.length;
    const y = (v: number) => M.top + plotH - ((v - scale.bottom) / (scale.top - scale.bottom)) * plotH;
    const cx = (i: number) => M.left + band * i + band / 2;
    return { scale, plotW, plotH, band, y, cx };
  }, [spec]);

  const { scale, band, y, cx } = geom;
  const n = spec.series.length;
  // Show every label when they fit; otherwise thin them so none collide.
  const labelEvery = Math.max(1, Math.ceil(spec.x.length / 8));
  const unit = spec.unit ? ` ${spec.unit}` : '';

  return (
    <figure className="fb-chart my-3 rounded-xl border border-edge bg-panel p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        {spec.title && <figcaption className="text-[13px] font-semibold text-ink">{spec.title}</figcaption>}
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-pressed={showTable}
          className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-dim hover:bg-ink/5 hover:text-ink"
        >
          <Table2 className="h-3.5 w-3.5" />
          {showTable ? 'Show chart' : 'Show data'}
        </button>
      </div>

      {n > 1 && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {spec.series.map((s, i) => (
            <li key={s.name} className="flex items-center gap-1.5 text-[11px] text-ink-mid">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color(i) }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}

      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px] tabular-nums">
            <thead>
              <tr>
                <th className="border-b border-edge px-2 py-1.5 text-left font-semibold text-ink" />
                {spec.series.map((s) => (
                  <th key={s.name} className="border-b border-edge px-2 py-1.5 text-right font-semibold text-ink">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {spec.x.map((label, i) => (
                <tr key={label + i}>
                  <td className="border-b border-edge/60 px-2 py-1.5 text-ink-mid">{label}</td>
                  {spec.series.map((s) => (
                    <td key={s.name} className="border-b border-edge/60 px-2 py-1.5 text-right text-ink-mid">
                      {s.values[i] == null ? '—' : `${fmt(s.values[i] as number)}${unit}`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={spec.title ?? 'Chart'}>
            {/* Recessive grid and axis. */}
            {scale.values.map((v) => (
              <g key={v}>
                <line
                  x1={M.left}
                  x2={W - M.right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="var(--edge)"
                  strokeWidth={v === 0 ? 1 : 0.5}
                  opacity={v === 0 ? 1 : 0.6}
                />
                <text x={M.left - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize="10" fill="var(--ink-dim)">
                  {fmt(v)}
                </text>
              </g>
            ))}
            {spec.x.map((label, i) =>
              i % labelEvery === 0 ? (
                <text key={label + i} x={cx(i)} y={H - 10} textAnchor="middle" fontSize="10" fill="var(--ink-dim)">
                  {label.length > 10 ? `${label.slice(0, 9)}…` : label}
                </text>
              ) : null
            )}

            {hover != null && (
              <rect
                x={M.left + band * hover}
                y={M.top}
                width={band}
                height={H - M.top - M.bottom}
                fill="var(--ink)"
                opacity={0.05}
              />
            )}

            {spec.type === 'bar'
              ? spec.series.map((s, si) => {
                  // Grouped bars with a 2px gap between neighbours.
                  const groupW = Math.min(band * 0.72, 18 * n + 2 * (n - 1));
                  const barW = (groupW - 2 * (n - 1)) / n;
                  return s.values.map((v, i) => {
                    if (v == null) return null;
                    const x0 = cx(i) - groupW / 2 + si * (barW + 2);
                    const top = y(Math.max(v, 0));
                    const h = Math.abs(y(v) - y(0));
                    return <path key={`${si}-${i}`} d={barPath(x0, top, barW, h)} fill={color(si)} />;
                  });
                })
              : spec.series.map((s, si) => {
                  const pts = s.values
                    .map((v, i) => (v == null ? null : ([cx(i), y(v)] as const)))
                    .filter((p): p is readonly [number, number] => p != null);
                  const last = pts[pts.length - 1];
                  return (
                    <g key={s.name}>
                      <polyline
                        points={pts.map((p) => p.join(',')).join(' ')}
                        fill="none"
                        stroke={color(si)}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      {spec.x.length <= 12 &&
                        pts.map(([px, py], i) => (
                          <circle key={i} cx={px} cy={py} r={4} fill={color(si)} stroke="var(--panel)" strokeWidth={2} />
                        ))}
                      {/* Direct label at the line's end, up to four series. */}
                      {n > 1 && n <= 4 && last && (
                        <text x={Math.min(last[0] + 6, W - 2)} y={last[1]} dy="0.32em" fontSize="10" fill="var(--ink-mid)" textAnchor={last[0] + 60 > W ? 'end' : 'start'}>
                          {s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name}
                        </text>
                      )}
                    </g>
                  );
                })}

            {hover != null && spec.type === 'line' && (
              <line x1={cx(hover)} x2={cx(hover)} y1={M.top} y2={H - M.bottom} stroke="var(--ink-dim)" strokeWidth={1} strokeDasharray="3 3" />
            )}

            {/* Hit targets: a full-height column per x, wider than any mark. */}
            {spec.x.map((label, i) => (
              <rect
                key={`hit-${i}`}
                x={M.left + band * i}
                y={M.top}
                width={band}
                height={H - M.top - M.bottom}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                onTouchStart={() => setHover(i)}
              />
            ))}
          </svg>

          {hover != null && (
            <div
              className="pointer-events-none absolute top-1 z-10 min-w-[120px] rounded-lg border border-edge bg-canvas px-2.5 py-2 text-[11px] shadow-lg"
              style={
                cx(hover) / W > 0.6
                  ? { right: `${100 - (cx(hover) / W) * 100 + 3}%` }
                  : { left: `${(cx(hover) / W) * 100 + 3}%` }
              }
            >
              <p className="mb-1 font-semibold text-ink">{spec.x[hover]}</p>
              {spec.series.map((s, si) => (
                <p key={s.name} className="flex items-center justify-between gap-3 text-ink-mid">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: color(si) }} />
                    {s.name}
                  </span>
                  <span className="tabular-nums text-ink">
                    {s.values[hover] == null ? '—' : `${fmt(s.values[hover] as number)}${unit}`}
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
