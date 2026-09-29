'use client';

import { api, formatNgn, FuelPurchase, FuelPurchasesResponse } from '@/lib/api';

/**
 * The purchase ledger's shared parts: the spend chart, the Excel export and
 * the summary tile, used by the Receipts page.
 */

// Export pulls the whole history in as few round trips as the backend's cap
// allows, looping pages rather than trusting one big fetch to have covered
// everything.
const EXPORT_PAGE_SIZE = 500;

/** Generic spreadsheet mark in Excel's own green, not a reproduction of
 * Microsoft's trademarked logo asset. */
export function ExcelIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden>
      <rect x="1" y="2" width="18" height="16" rx="2" fill="#1D6F42" />
      <rect x="4" y="5" width="12" height="10" rx="1" fill="#0B4A2A" />
      <path
        d="M6.5 7l2.4 3-2.4 3h1.7l1.55-2.1L11.3 13H13l-2.4-3 2.4-3h-1.7l-1.55 2.1L8.2 7z"
        fill="#ffffff"
      />
    </svg>
  );
}

/**
 * Real .xlsx via exceljs, built and downloaded client-side. Only the writer
 * half of the library ever runs here — the parser (`workbook.xlsx.load`)
 * is never called, since nothing this feature does reads a file back in.
 */
async function downloadXlsx(
  filename: string,
  header: string[],
  rows: (string | number)[][],
  totalsRow: (string | number)[]
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FuelSense';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Fuel purchases');
  sheet.addRow(header);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D6F42' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });

  rows.forEach((row) => sheet.addRow(row));

  const total = sheet.addRow(totalsRow);
  total.font = { bold: true };

  sheet.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      max = Math.max(max, String(cell.value ?? '').length + 2);
    });
    col.width = Math.min(max, 40);
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function purchaseRow(p: FuelPurchase): (string | number)[] {
  return [
    new Date(p.purchased_at ?? p.timestamp).toLocaleString('en-NG'),
    p.driver_name ?? 'Unassigned',
    p.license_plate,
    Number(p.liters_declared.toFixed(2)),
    p.cost_per_liter_ngn,
    p.total_cost_ngn,
    p.distance_km != null ? Number(p.distance_km.toFixed(1)) : '',
    p.merchant ?? '',
    p.status,
  ];
}

const LEDGER_HEADER = [
  'Date',
  'Driver',
  'Vehicle',
  'Litres purchased',
  'Price per litre (NGN)',
  'Amount (NGN)',
  'Distance since last fill (km)',
  'Merchant',
  'Status',
];

/**
 * Spend over time as a line.
 *
 * This was a bar per purchase day, on the argument that each day is a discrete
 * transaction rather than a continuous reading. True, and beside the point: a
 * row of equal-looking bars answers "what did we spend on the 15th", which the
 * table already answers better. The question a ledger chart is for is whether
 * spend is climbing, and a line is what shows that.
 *
 * Points sit at their real position in time, not at even intervals. Fill-ups
 * are irregular — 10th, 11th, 15th, 18th, 20th — and spacing them evenly draws
 * a steady rhythm the fleet does not have.
 */
export function SpendChart({ points }: { points: [string, number][] }) {
  if (points.length === 0) {
    return <p className="py-12 text-center text-sm text-ink-dim">No purchases yet.</p>;
  }

  const W = 720;
  const H = 260;
  const PAD = { top: 24, right: 20, bottom: 32, left: 76 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = points.map(([, v]) => v);
  const max = Math.max(...values, 1);
  const times = points.map(([d]) => new Date(d).getTime());
  const first = times[0];
  const span = Math.max(times[times.length - 1] - first, 1);

  // A single purchase has no trend to draw, so it is placed mid-plot rather
  // than collapsed onto the left edge.
  const xFor = (t: number) => (points.length === 1 ? PAD.left + plotW / 2 : PAD.left + ((t - first) / span) * plotW);
  const yFor = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const coords = points.map(([, v], i) => [xFor(times[i]), yFor(v)] as const);
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${PAD.left},${PAD.top + plotH} ${line} ${coords[coords.length - 1][0].toFixed(1)},${PAD.top + plotH}`;

  const peak = values.indexOf(Math.max(...values));
  const showLabelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Fuel spend over time">
      {[0, 0.5, 1].map((t) => {
        const y = PAD.top + t * plotH;
        return (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--divider)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="var(--ink-dim)">
              {formatNgn(Math.round(max * (1 - t)))}
            </text>
          </g>
        );
      })}

      {/* A wash, never a saturated block — the line carries the reading. */}
      <polygon points={area} fill="var(--chart-bar)" opacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke="var(--chart-bar)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {coords.map(([x, y], i) => (
        <g key={points[i][0]}>
          {/* 2px surface ring keeps the dot legible where it crosses the line. */}
          <circle cx={x} cy={y} r={4} fill="var(--chart-bar)" stroke="var(--panel)" strokeWidth={2}>
            <title>
              {new Date(points[i][0]).toLocaleDateString()} · {formatNgn(points[i][1])}
            </title>
          </circle>
          {i === peak && (
            <text x={x} y={y - 12} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">
              {formatNgn(points[i][1])}
            </text>
          )}
          {i % showLabelEvery === 0 && (
            <text x={x} y={H - PAD.bottom + 16} textAnchor="middle" fontSize={9} fill="var(--ink-dim)">
              {new Date(points[i][0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/**
 * Every purchase matching `query`, fetched in as few round trips as the
 * backend cap allows, and saved as a real .xlsx with a totals row.
 */
export async function exportPurchasesToExcel(query: string): Promise<void> {
  const all: FuelPurchase[] = [];
  let p = 1;
  let totalPages = 1;
  do {
    const res = await api<FuelPurchasesResponse>(
      `/telemetry/fuel-purchases?page=${p}&limit=${EXPORT_PAGE_SIZE}${query ? `&${query}` : ''}`
    );
    all.push(...res.purchases);
    totalPages = res.total_pages || 1;
    p += 1;
  } while (p <= totalPages);

  const totalAmount = all.reduce((sum, row) => sum + row.total_cost_ngn, 0);
  const totalLiters = all.reduce((sum, row) => sum + row.liters_declared, 0);

  await downloadXlsx(
    `fuel-purchases-${new Date().toISOString().slice(0, 10)}.xlsx`,
    LEDGER_HEADER,
    all.map(purchaseRow),
    ['', '', '', Number(totalLiters.toFixed(2)), '', totalAmount, '', '', 'TOTAL']
  );
}


export function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel p-4">
      <p className="text-[11px] uppercase tracking-wider text-ink-dim">{label}</p>
      <p className="mt-1 font-mono text-lg font-bold text-ink">{value}</p>
    </div>
  );
}
