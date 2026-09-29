'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock, Receipt, Shield, X } from 'lucide-react';
import {
  FleetVehicle,
  FuelPurchase,
  FuelPurchasesResponse,
  formatNgn,
  api,
  milesToKm,
} from '@/lib/api';
import { resolvePendingReceipt } from '@/lib/api';
import type { ParseReceiptResponse } from '@/lib/driver-api';
import { compressReceiptImage } from '@/lib/receipt-image';
import { ReceiptEventModal } from '@/components/dashboard/ReceiptEventModal';
import { PurchaseCalendarView } from '@/components/dashboard/PurchaseCalendarView';
import { ViewModeToggle } from '@/components/dashboard/ViewModeToggle';
import { TableSkeleton } from '@/components/ui/chrome';
import { ExcelIcon, SpendChart, SummaryTile, exportPurchasesToExcel } from '@/components/dashboard/PurchaseLedger';
import { MerchantLabel } from '@/components/StationLogo';


const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/** "28th September 2026", on the fleet's clock. */
function formatReceiptDate(iso: string, withWeekday = false) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Lagos',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value])
  );
  const date = `${ordinal(Number(parts.day))} ${parts.month} ${parts.year}`;
  return withWeekday ? `${parts.weekday}, ${date}` : date;
}

/** "7:46 am" — a pump slip is timed to the minute, not the second. */
function formatReceiptTime(iso: string) {
  return new Date(iso)
    .toLocaleTimeString('en-GB', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Africa/Lagos',
    })
    .toLowerCase();
}

function toDatetimeLocalValue(iso?: string) {
  const date = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateKey(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
}

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-edge bg-canvas px-6 py-3">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="rounded-lg border border-edge px-3 py-1 text-xs disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-xs text-ink-dim">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className="rounded-lg border border-edge px-3 py-1 text-xs disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}


function SummaryCardsSkeleton({ columns }: { columns: 2 | 3 | 4 }) {
  return (
    <div
      className={`grid min-h-[7.5rem] gap-4 ${columns === 4 ? 'sm:grid-cols-4' : columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}
      aria-hidden
    >
      {Array.from({ length: columns }).map((_, index) => (
        <div
          key={index}
          className="rounded-lg border border-edge bg-panel p-4"
        >
          <div className="h-3 w-24 animate-pulse rounded bg-divider" />
          <div className="mt-3 h-8 w-32 animate-pulse rounded bg-divider" />
          <div className="mt-2 h-3 w-40 animate-pulse rounded bg-divider" />
        </div>
      ))}
    </div>
  );
}

/** Which receipts the page shows. `days: null` is all time. */
export type ReceiptRange = { days: number | null } | { from: string; to: string };

/** The API query for a range — the same window the list and totals use. */
export function rangeQuery(range: ReceiptRange): string {
  if ('from' in range) return `from=${range.from}&to=${range.to}`;
  return range.days != null ? `days=${range.days}` : '';
}

const RANGE_PRESETS: Array<{ label: string; days: number | null }> = [
  { label: 'All time', days: null },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

function ReceiptRangeFilter({
  range,
  onChange,
}: {
  range: ReceiptRange;
  onChange: (range: ReceiptRange) => void;
}) {
  const custom = 'from' in range;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
  const [from, setFrom] = useState(custom ? range.from : '');
  const [to, setTo] = useState(custom ? range.to : today);
  const [showCustom, setShowCustom] = useState(custom);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {RANGE_PRESETS.map((p) => {
        const active = !custom && !showCustom && 'days' in range && range.days === p.days;
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setShowCustom(false);
              onChange({ days: p.days });
            }}
            className={`rounded-full border px-3 py-1 text-xs ${
              active ? 'border-accent bg-accent/15 text-brand' : 'border-edge text-ink-mid hover:bg-panel-hover'
            }`}
          >
            {p.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setShowCustom(true)}
        className={`rounded-full border px-3 py-1 text-xs ${
          custom || showCustom ? 'border-accent bg-accent/15 text-brand' : 'border-edge text-ink-mid hover:bg-panel-hover'
        }`}
      >
        Custom
      </button>
      {showCustom && (
        <span className="flex items-center gap-1.5 text-xs text-ink-dim">
          <input
            type="date"
            value={from}
            max={to || today}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-edge bg-panel px-2 py-1 text-xs text-ink"
            aria-label="From"
          />
          to
          <input
            type="date"
            value={to}
            min={from || undefined}
            max={today}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-edge bg-panel px-2 py-1 text-xs text-ink"
            aria-label="To"
          />
          <button
            type="button"
            disabled={!from || !to}
            onClick={() => onChange({ from, to })}
            className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-y-ink disabled:opacity-40"
          >
            Apply
          </button>
        </span>
      )}
    </div>
  );
}

export function ReceiptsPanel({
  data,
  fleet,
  page,
  onPageChange,
  onRefresh,
  range,
  onRangeChange,
}: {
  data: FuelPurchasesResponse | null;
  fleet: FleetVehicle[];
  page: number;
  onPageChange: (p: number) => void;
  onRefresh: () => void;
  range: ReceiptRange;
  onRangeChange: (range: ReceiptRange) => void;
}) {
  const purchases = data?.purchases ?? [];
  const summary = data?.summary;
  const [showForm, setShowForm] = useState(false);
  const [vehicleId, setVehicleId] = useState(fleet[0]?.id ?? '');
  const [declared, setDeclared] = useState('');
  // The price on the slip. Without it the receipt is stored with no price at
  // all — the route used to invent one, which put a compiled-in 1300 on the
  // "what was actually paid" chart as though a driver had paid it.
  const [pricePerLiter, setPricePerLiter] = useState('');
  const [totalPaid, setTotalPaid] = useState('');
  const [merchant, setMerchant] = useState('');
  const [receiptRef, setReceiptRef] = useState('');
  const [purchasedAtLocal, setPurchasedAtLocal] = useState(() => toDatetimeLocalValue());
  const [odometer, setOdometer] = useState('');
  const [odometerUnit, setOdometerUnit] = useState<'mi' | 'km'>('mi');
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /**
   * Record a verdict, then refetch rather than patching local state.
   *
   * The badge a manager ends up looking at should be the server's, not an
   * optimistic guess: the endpoint refuses anything already settled, so a
   * stale tab that "succeeds" locally would otherwise show a decision the
   * database never accepted.
   */
  const handleResolvePending = useCallback(
    async (id: string, decision: 'accept' | 'reject') => {
      await resolvePendingReceipt(id, decision);
      onRefresh?.();
    },
    [onRefresh]
  );

  const [selectedPurchase, setSelectedPurchase] = useState<FuelPurchase | null>(null);
  // One point per day for the spend line; daily_totals is per (day, driver).
  const spendByDate = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const row of summary?.daily_totals ?? []) {
      byDate.set(row.activity_date, (byDate.get(row.activity_date) ?? 0) + row.total_cost_ngn);
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [summary]);
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'graph'>('list');
  const [exporting, setExporting] = useState(false);

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, FuelPurchase[]>();
    for (const purchase of purchases) {
      const key = dateKey(purchase.timestamp);
      const list = groups.get(key) ?? [];
      list.push(purchase);
      groups.set(key, list);
    }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [purchases]);

  const dailyTotalsByDate = useMemo(() => {
    const map = new Map<
      string,
      NonNullable<FuelPurchasesResponse['summary']>['daily_totals']
    >();
    if (!summary?.daily_totals) return map;
    for (const row of summary.daily_totals) {
      const key = String(row.activity_date).slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, [summary]);


  // For a driver without a phone: the manager photographs the slip and the
  // same OCR the driver app uses fills the form.
  const scanReceipt = async (file: File) => {
    setScanning(true);
    setMessage(null);
    try {
      const image = await compressReceiptImage(file);
      const { fields } = await api<ParseReceiptResponse>('/telemetry/fuel-purchases/receipt/scan', {
        method: 'POST',
        body: JSON.stringify({ image_data_url: image }),
      });
      if (fields.merchant_name) setMerchant(fields.merchant_name);
      if (fields.declared_liters != null) setDeclared(String(fields.declared_liters));
      if (fields.price_per_liter != null) setPricePerLiter(String(fields.price_per_liter));
      if (fields.total_amount != null) setTotalPaid(String(fields.total_amount));
      if (fields.transaction_date) setPurchasedAtLocal(toDatetimeLocalValue(fields.transaction_date));
      setMessage('Receipt read — check the figures, then save.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Scan failed, enter the details by hand');
    } finally {
      setScanning(false);
    }
  };

  const submitReceipt = async () => {
    // Prices move week to week and there is no defensible default, so a
    // receipt without one is refused here rather than stored with a guess.
    if (!(Number(pricePerLiter) > 0) && !(Number(totalPaid) > 0)) {
      setMessage('Enter the price per litre, or the total paid, from the receipt.');
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await api<{
        message: string;
        liters_actual: number | null;
        actual_from: string;
      }>('/telemetry/fuel-purchases/receipt', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: vehicleId,
          liters_declared: Number(declared),
          merchant,
          receipt_reference: receiptRef || undefined,
          purchased_at: new Date(purchasedAtLocal).toISOString(),
          // Stored in km whatever the dash reads; the unit is only a display fact.
          odometer_km: odometer
            ? Math.round(odometerUnit === 'mi' ? milesToKm(Number(odometer)) : Number(odometer))
            : undefined,
          cost_per_liter_ngn: pricePerLiter ? Number(pricePerLiter) : undefined,
          total_amount_ngn: totalPaid ? Number(totalPaid) : undefined,
        }),
      });
      setMessage(result.message);
      setShowForm(false);
      onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {selectedPurchase && (
        <ReceiptEventModal purchase={selectedPurchase} onClose={() => setSelectedPurchase(null)} />
      )}

      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile label="Receipts" value={String(summary.grand_total.receipt_count)} />
          <SummaryTile label="Total spend" value={formatNgn(summary.grand_total.total_cost_ngn)} />
          <SummaryTile
            label="Litres bought"
            value={`${summary.grand_total.total_receipt_liters.toFixed(1)} L`}
          />
          <SummaryTile
            label="Avg. price / L"
            value={
              summary.grand_total.total_receipt_liters > 0
                ? formatNgn(
                    Math.round(summary.grand_total.total_cost_ngn / summary.grand_total.total_receipt_liters)
                  )
                : '—'
            }
          />
        </div>
      ) : (
        <SummaryCardsSkeleton columns={4} />
      )}

      <div className="overflow-hidden rounded-lg border border-edge bg-panel">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-ink">
              <Receipt className="h-4 w-4 text-accent-y" /> Receipts
            </h2>
            <p className="mt-1 text-xs text-ink-dim">
              Every fuel purchase — logged by a driver or entered here — with the spend behind it
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ViewModeToggle
              mode={viewMode}
              onChange={setViewMode}
              modes={['list', 'calendar', 'graph'] as const}
            />
            <button
              type="button"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                setMessage(null);
                try {
                  await exportPurchasesToExcel(rangeQuery(range));
                } catch (err) {
                  setMessage(err instanceof Error ? err.message : 'Export failed');
                } finally {
                  setExporting(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-panel-deep px-3 py-2 text-xs font-semibold text-ink transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50"
            >
              <ExcelIcon className="h-3.5 w-3.5" /> {exporting ? 'Exporting…' : 'Export to Excel'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-y-ink"
            >
              Add receipt
            </button>
          </div>
        </div>

        <div className="border-b border-edge px-6 py-3">
          <ReceiptRangeFilter range={range} onChange={onRangeChange} />
        </div>

        {showForm && (
          <div className="border-b border-edge bg-canvas px-6 py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-ink-dim">
                Log a fill on the driver&apos;s behalf. The litres are added to what the tank
                already holds.
              </p>
              <label className="cursor-pointer rounded-lg border border-edge bg-panel px-3 py-2 text-xs font-medium text-ink hover:border-accent/50">
                {scanning ? 'Reading receipt…' : 'Scan receipt photo'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={scanning}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void scanReceipt(file);
                  }}
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="text-xs text-ink-dim">
                Vehicle
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-edge bg-panel px-2 py-2 text-sm text-ink"
                >
                  {fleet.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.license_plate}
                      {v.driver_name ? ` — ${v.driver_name}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-ink-dim">
                Purchase time (exact)
                <input
                  type="datetime-local"
                  value={purchasedAtLocal}
                  onChange={(e) => setPurchasedAtLocal(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-edge bg-panel px-2 py-2 text-sm text-ink"
                />
              </label>
              <label className="text-xs text-ink-dim">
                Receipt liters
                <input
                  type="number"
                  value={declared}
                  onChange={(e) => setDeclared(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-edge bg-panel px-2 py-2 text-sm text-ink"
                />
              </label>
              <label className="text-xs text-ink-dim">
                Price per litre (NGN) <span className="text-warn">*</span>
                <input
                  type="number"
                  required
                  value={pricePerLiter}
                  onChange={(e) => setPricePerLiter(e.target.value)}
                  placeholder="what the pump charged"
                  className="mt-1 w-full rounded-lg border border-edge bg-panel px-2 py-2 text-sm text-ink"
                />
              </label>
              <label className="text-xs text-ink-dim">
                Total paid (NGN)
                <input
                  type="number"
                  value={totalPaid}
                  onChange={(e) => setTotalPaid(e.target.value)}
                  placeholder="or the total, if that is what the slip shows"
                  className="mt-1 w-full rounded-lg border border-edge bg-panel px-2 py-2 text-sm text-ink"
                />
              </label>
              <label className="text-xs text-ink-dim">
                Merchant
                <input
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-edge bg-panel px-2 py-2 text-sm text-ink"
                />
              </label>
              <label className="text-xs text-ink-dim">
                Receipt #
                <input
                  value={receiptRef}
                  onChange={(e) => setReceiptRef(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-edge bg-panel px-2 py-2 text-sm text-ink"
                />
              </label>
              <label className="text-xs text-ink-dim">
                Odometer at the pump
                <div className="mt-1 flex gap-1">
                  <input
                    type="number"
                    min={0}
                    value={odometer}
                    onChange={(e) => setOdometer(e.target.value)}
                    className="w-full rounded-lg border border-edge bg-panel px-2 py-2 text-sm text-ink"
                    placeholder="from the dash"
                  />
                  <select
                    value={odometerUnit}
                    onChange={(e) => setOdometerUnit(e.target.value as 'mi' | 'km')}
                    className="rounded-lg border border-edge bg-panel px-1 py-2 text-sm text-ink"
                    aria-label="Odometer unit"
                  >
                    <option value="mi">mi</option>
                    <option value="km">km</option>
                  </select>
                </div>
              </label>
            </div>
            <button
              type="button"
              disabled={submitting}
              onClick={submitReceipt}
              className="mt-3 rounded-lg bg-good px-4 py-2 text-xs font-semibold text-accent-y-ink"
            >
              {submitting ? 'Saving…' : 'Save receipt'}
            </button>
          </div>
        )}

        {message && <p className="px-6 py-2 text-xs text-brand">{message}</p>}

        {data === null ? (
          <TableSkeleton
            columns={[
              { width: 60 },
              { width: 70 },
              { width: 80 },
              { width: 70 },
              { width: 90 },
              { width: 60, align: 'right' },
              { width: 90 },
              { width: 80 },
              { width: 60, align: 'right' },
              { width: 70 },
              { width: 16 },
            ]}
          />
        ) : purchases.length === 0 ? (
          <p className="p-6 text-sm text-ink-dim">
            No receipts yet. Run{' '}
            <code className="text-brand">npm run seed-fuel-purchases</code> or log a receipt
            above.
          </p>
        ) : viewMode === 'calendar' ? (
          <PurchaseCalendarView purchases={purchases} onViewEvent={setSelectedPurchase} />
        ) : viewMode === 'graph' ? (
          <div className="p-5">
            <SpendChart points={spendByDate} />
          </div>
        ) : (
          <ReconciledReceiptsTable
            groupedByDate={groupedByDate}
            dailyTotalsByDate={dailyTotalsByDate}
            summary={summary}
            onViewEvent={setSelectedPurchase}
            onResolve={handleResolvePending}
          />
        )}

        {viewMode === 'list' && data && data.total_pages > 0 && (
          <Pagination page={page} totalPages={data.total_pages} onPage={onPageChange} />
        )}
      </div>
    </div>
  );
}

function ReconciledReceiptsTable({
  onResolve,
  groupedByDate,
  dailyTotalsByDate,
  summary,
  onViewEvent,
}: {
  groupedByDate: [string, FuelPurchase[]][];
  dailyTotalsByDate: Map<
    string,
    NonNullable<FuelPurchasesResponse['summary']>['daily_totals']
  >;
  summary?: FuelPurchasesResponse['summary'];
  onViewEvent: (purchase: FuelPurchase) => void;
  onResolve?: (id: string, decision: 'accept' | 'reject') => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-left text-sm">
        <thead className="bg-canvas text-xs uppercase tracking-wider text-ink-dim">
          <tr>
            <th className="whitespace-nowrap px-4 py-3">Date</th>
            <th className="whitespace-nowrap px-4 py-3">Purchase time</th>
            <th className="whitespace-nowrap px-4 py-3">Vehicle</th>
            <th className="whitespace-nowrap px-4 py-3">Driver</th>
            <th className="whitespace-nowrap px-4 py-3">Merchant</th>
            <th className="whitespace-nowrap px-4 py-3 text-right">Receipt (L)</th>
            <th className="whitespace-nowrap px-4 py-3 text-right">₦ / L</th>
            <th className="whitespace-nowrap px-4 py-3 text-right">Distance since last fill</th>
            <th className="whitespace-nowrap px-4 py-3 text-right">Cost</th>
            <th className="whitespace-nowrap px-4 py-3">Status</th>
            <th className="whitespace-nowrap px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-divider text-ink-mid">
          {groupedByDate.map(([dayKey, dayPurchases]) => {
            const dayLabel = formatReceiptDate(dayPurchases[0].timestamp, true);
            const dayTotals = dailyTotalsByDate.get(dayKey) ?? [];

            return (
              <ReconciledDateGroup
                key={dayKey}
                dayLabel={dayLabel}
                purchases={dayPurchases}
                dayTotals={dayTotals}
                onViewEvent={onViewEvent}
                onResolve={onResolve}
              />
            );
          })}
        </tbody>
        {summary && (
          <tfoot className="border-t-2 border-edge bg-canvas text-sm">
            <tr>
              {/* "Reconciled" asserted a verification that had not happened:
                  the only row beneath it read Pending / Not checked, and the
                  header already says 0 of 1 checked against the tracker. This
                  totals what drivers logged — the checking status is reported
                  per receipt and counted above, not implied here. */}
              <td colSpan={5} className="px-4 py-4 font-semibold text-ink">
                Grand total (logged by drivers)
              </td>
              <td className="px-4 py-4 text-right font-mono font-semibold tabular-nums text-brand">
                {summary.grand_total.total_receipt_liters.toFixed(1)} L
              </td>
              <td className="px-4 py-4 text-right font-mono text-xs tabular-nums text-ink-dim">
                {summary.grand_total.total_receipt_liters > 0
                  ? `avg ${formatNgn(Math.round(summary.grand_total.total_cost_ngn / summary.grand_total.total_receipt_liters))}`
                  : '—'}
              </td>
              <td className="px-4 py-4 text-right text-xs text-ink-dim">—</td>
              <td className="px-4 py-4 text-right font-mono font-bold tabular-nums text-ink">
                {formatNgn(summary.grand_total.total_cost_ngn)}
              </td>
              <td colSpan={2} className="px-4 py-4 text-xs text-ink-dim">
                {summary.grand_total.receipt_count} receipts
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Matches the pill treatment across all three receipt statuses — Pending
 *  previously rendered as bare amber text, which read as an error rather than
 *  "not checked yet" next to the Theft/Verified pills either side of it. */
function ReceiptStatusBadge({ status }: { status: FuelPurchase['status'] }) {
  if (status === 'flagged_theft') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-bad-deep/20 px-2 py-1 text-xs text-bad">
        <AlertTriangle className="h-3 w-3" /> Review
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ink-dim/20 px-2 py-1 text-xs text-ink-mid">
        <X className="h-3 w-3" /> Rejected
      </span>
    );
  }
  if (status === 'manually_verified') {
    // Distinct from the reconciler's own "Verified": a human decided this, and
    // conflating the two would let a judgement call read later as evidence.
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-good/20 px-2 py-1 text-xs text-good">
        <Shield className="h-3 w-3" /> Verified by manager
      </span>
    );
  }
  if (status === 'pending_receipt') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warn-deep/20 px-2 py-1 text-xs text-warn">
        <Clock className="h-3 w-3" /> Pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-good/20 px-2 py-1 text-xs text-good">
      <Shield className="h-3 w-3" /> Verified
    </span>
  );
}

function ViewEventButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="whitespace-nowrap rounded-lg border border-accent/40 bg-accent/15 px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-accent/25"
    >
      View event
    </button>
  );
}

function ReconciledDateGroup({
  onResolve,
  dayLabel,
  purchases,
  dayTotals,
  onViewEvent,
}: {
  dayLabel: string;
  purchases: FuelPurchase[];
  dayTotals: Array<{
    driver_name: string;
    total_cost_ngn: number;
    total_receipt_liters: number;
    total_obd_liters: number;
    receipt_count: number;
  }>;
  onViewEvent: (purchase: FuelPurchase) => void;
  onResolve?: (id: string, decision: 'accept' | 'reject') => Promise<void>;
}) {
  const dayCost = dayTotals.reduce((sum, row) => sum + row.total_cost_ngn, 0);

  return (
    <>
      <tr className="bg-panel-hover/60">
        <td colSpan={11} className="px-4 py-2 text-xs font-semibold text-brand">
          {dayLabel}
          {dayCost > 0 && (
            <span className="ml-3 font-mono normal-case text-ink-dim">
              Day total {formatNgn(dayCost)}
            </span>
          )}
        </td>
      </tr>
      {purchases.map((purchase) => (
        <ReconciledReceiptRow
          key={purchase.id}
          purchase={purchase}
          onViewEvent={onViewEvent}
          onResolve={onResolve}
        />
      ))}
      {purchases.length > 1 && dayTotals.map((row) => (
        <tr key={`${dayLabel}-${row.driver_name}-reconciled`} className="bg-canvas/80">
          <td colSpan={5} className="px-4 py-2 text-xs text-ink-dim">
            Daily total · {row.driver_name}
          </td>
          <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-brand">
            {row.total_receipt_liters.toFixed(1)} L
          </td>
          <td className="px-4 py-2 text-right font-mono text-xs text-ink-dim">—</td>
          <td className="px-4 py-2 text-right font-mono text-xs text-ink-dim">—</td>
          <td className="px-4 py-2 text-right font-mono text-xs font-semibold tabular-nums text-ink">
            {formatNgn(row.total_cost_ngn)}
          </td>
          <td colSpan={2} />
        </tr>
      ))}
    </>
  );
}

function ReconciledReceiptRow({
  purchase,
  onViewEvent,
  onResolve,
  compact = false,
}: {
  purchase: FuelPurchase;
  onViewEvent: (purchase: FuelPurchase) => void;
  /** Omitted where the table is read-only. */
  onResolve?: (id: string, decision: 'accept' | 'reject') => Promise<void>;
  compact?: boolean;
}) {
  const isTheft = purchase.status === 'flagged_theft';
  const isPending = purchase.status === 'pending_receipt';
  const purchaseTime = purchase.purchased_at ?? purchase.timestamp;

  if (compact) {
    return (
      <tr className={`transition-colors hover:bg-panel-hover/40 ${isTheft ? 'bg-bad-deep/5' : ''}`}>
        <td className="whitespace-nowrap px-4 py-3">{formatReceiptDate(purchaseTime)}</td>
        <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-ink">{purchase.license_plate}</td>
        <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">{purchase.liters_declared} L</td>
        <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">
          {formatNgn(purchase.cost_per_liter_ngn)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">{formatNgn(purchase.total_cost_ngn)}</td>
        <td className="px-4 py-3">
          <ReceiptStatusBadge status={purchase.status} />
        </td>
        <td className="px-4 py-3">
          {/* Stacked, not side by side: "View event" plus two circular
              accept/reject buttons squeezed into one row overflowed this
              cell's width. The verdict buttons sit on their own row below
              the view action instead. */}
          <div className="flex flex-col items-start gap-1.5">
            <ViewEventButton onClick={() => onViewEvent(purchase)} />
            {isPending && onResolve && (
              <div className="flex items-center gap-1.5">
                <ResolvePendingButtons id={purchase.id} onResolve={onResolve} />
              </div>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`transition-colors hover:bg-panel-hover/40 ${isTheft ? 'bg-bad-deep/5' : ''}`}>
      <td className="whitespace-nowrap px-4 py-3">{formatReceiptDate(purchaseTime)}</td>
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-brand">{formatReceiptTime(purchaseTime)}</td>
      <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-ink">{purchase.license_plate}</td>
      <td className="whitespace-nowrap px-4 py-3 text-ink-dim">{purchase.driver_name ?? '—'}</td>
      <td className="max-w-[12rem] px-4 py-3"><MerchantLabel merchant={purchase.merchant} /></td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">{purchase.liters_declared} L</td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">
        {formatNgn(purchase.cost_per_liter_ngn)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-ink-dim">
        {purchase.distance_km != null ? `${purchase.distance_km.toFixed(1)} km` : '—'}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">{formatNgn(purchase.total_cost_ngn)}</td>
      <td className="whitespace-nowrap px-4 py-3">
        <ReceiptStatusBadge status={purchase.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <div className="flex flex-col items-start gap-1.5">
          <ViewEventButton onClick={() => onViewEvent(purchase)} />
          {isPending && onResolve && (
            <div className="flex items-center gap-1.5">
              <ResolvePendingButtons id={purchase.id} onResolve={onResolve} />
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * The two verdicts a manager can record on a receipt the reconciler could not
 * settle.
 *
 * "Pending" previously had no exit: the automatic check had nothing to judge
 * against, and the one person who could resolve it — someone able to ask the
 * driver — had nowhere to put the answer, so the row stayed Pending forever.
 *
 * Rejecting is deliberately not "flag as theft". A receipt the manager could
 * not stand up is a bookkeeping outcome; escalating it to an accusation is a
 * separate decision with separate evidence behind it.
 */
function ResolvePendingButtons({
  id,
  onResolve,
}: {
  id: string;
  onResolve: (id: string, decision: 'accept' | 'reject') => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const decide = async (decision: 'accept' | 'reject') => {
    setBusy(true);
    try {
      await onResolve(id, decision);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* A tick and a cross, not two words. The verdict is binary and the
          buttons sit at the end of a dense row — the words were doing no work
          the icons cannot, and cost the row the width. Colour carries the
          meaning, the label carries it for anyone who cannot see colour. */}
      <button
        type="button"
        onClick={() => decide('accept')}
        disabled={busy}
        title="Accept this receipt as genuine"
        aria-label="Accept this receipt as genuine"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-edge text-ink-mid transition-colors hover:border-good/50 hover:bg-good/10 hover:text-good disabled:opacity-40"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => decide('reject')}
        disabled={busy}
        title="Could not stand this receipt up"
        aria-label="Could not stand this receipt up"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-edge text-ink-mid transition-colors hover:border-bad/50 hover:bg-bad/10 hover:text-bad disabled:opacity-40"
      >
        <X className="h-4 w-4" />
      </button>
    </>
  );
}

/** Compact reconciliation table for Fuel analytics view */
export function FuelPurchaseTable({
  data,
  onOpenReceipts,
  onRefresh,
}: {
  data: FuelPurchasesResponse | null;
  fleet: FleetVehicle[];
  page: number;
  onPageChange: (p: number) => void;
  onRefresh: () => void;
  onOpenReceipts?: () => void;
}) {
  const purchases = data?.purchases ?? [];
  const [selectedPurchase, setSelectedPurchase] = useState<FuelPurchase | null>(null);

  // Same contract as the main panel: settle server-side, then refetch, so the
  // badge shown is the database's verdict rather than an optimistic guess.
  const handleResolvePending = useCallback(
    async (id: string, decision: 'accept' | 'reject') => {
      await resolvePendingReceipt(id, decision);
      onRefresh?.();
    },
    [onRefresh]
  );

  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-panel">
      {selectedPurchase && (
        <ReceiptEventModal purchase={selectedPurchase} onClose={() => setSelectedPurchase(null)} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-ink">
            <Receipt className="h-4 w-4 text-accent-y" /> Latest fuel purchases
          </h2>
          <p className="mt-1 text-xs text-ink-dim">
            What each driver logged at the pump, newest first
          </p>
        </div>
        {onOpenReceipts && (
          <button
            type="button"
            onClick={onOpenReceipts}
            className="rounded-lg border border-accent/40 bg-accent/15 px-3 py-2 text-xs font-medium text-brand"
          >
            Open Receipts →
          </button>
        )}
      </div>
      {purchases.length === 0 ? (
        <p className="p-6 text-sm text-ink-dim">No fuel purchases yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wider text-ink-dim">
              <tr>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Vehicle</th>
                <th className="px-6 py-3">Receipt (L)</th>
                <th className="px-6 py-3">₦ / L</th>
                <th className="px-6 py-3">Cost</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-divider text-ink-mid">
              {purchases.slice(0, 5).map((purchase) => (
                <ReconciledReceiptRow
                  key={purchase.id}
                  purchase={purchase}
                  onViewEvent={setSelectedPurchase}
                  onResolve={handleResolvePending}
                  compact
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {onOpenReceipts && purchases.length > 0 && (
        <div className="border-t border-edge px-6 py-3">
          <button
            type="button"
            onClick={onOpenReceipts}
            className="text-xs text-brand hover:underline"
          >
            View all {data?.total ?? purchases.length} receipts with daily totals →
          </button>
        </div>
      )}
    </div>
  );
}
