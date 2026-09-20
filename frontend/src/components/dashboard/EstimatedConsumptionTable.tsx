'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Gauge } from 'lucide-react';
import { TableSkeleton } from '@/components/ui/chrome';
import {
  api,
  Driver,
  EstimatedConsumptionDay,
  EstimatedConsumptionResponse,
  EstimatedConsumptionRow,
  formatNgn,
} from '@/lib/api';

export const ESTIMATE_PERIOD_OPTIONS = [1, 7, 30];

export function useEstimatedConsumption(days: number, driverId: string | null = null) {
  const [data, setData] = useState<EstimatedConsumptionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = driverId ? `days=${days}&driver_id=${driverId}` : `days=${days}`;
    api<EstimatedConsumptionResponse>(`/dashboard/estimated-consumption?${query}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load estimate');
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, driverId]);

  return { data, loading, error };
}

/** The drivers a manager can narrow the table to. Fails quietly to "all". */
export function useDriverOptions() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  useEffect(() => {
    let cancelled = false;
    api<Driver[]>('/drivers')
      .then((rows) => {
        if (!cancelled) setDrivers(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return drivers;
}

/** "₦20,000 · 13.8 L" for a row with receipts, an em-dash without. */
function ReceiptCell({ costNgn, liters, muted = false }: { costNgn: number; liters: number; muted?: boolean }) {
  if (!costNgn && !liters) return <>—</>;
  return (
    <>
      {formatNgn(costNgn)}
      <span className={muted ? '' : 'text-ink-dim'}> · {liters.toFixed(1)} L</span>
    </>
  );
}

function formatDay(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function VehicleRow({ row }: { row: EstimatedConsumptionRow }) {
  return (
    <tr>
      <td className="px-6 py-2.5 font-medium text-ink">
        {row.license_plate}
        {row.model && <span className="ml-2 text-xs text-ink-dim">{row.model}</span>}
      </td>
      <td className="px-6 py-2.5">{row.driver_name ?? '—'}</td>
      <td className="px-6 py-2.5 font-mono">{row.distance_km.toLocaleString()} km</td>
      <td className="px-6 py-2.5 font-mono">{row.efficiency_km_l.toFixed(1)}</td>
      <td className="px-6 py-2.5 font-mono">
        {(row.idle_hours ?? 0) > 0
          ? `${row.idle_hours.toFixed(1)} h · ${row.idle_fuel_liters.toFixed(1)} L`
          : '—'}
      </td>
      <td className="px-6 py-2.5 font-mono text-good">
        {row.estimated_fuel_liters.toFixed(1)} L
      </td>
      <td className="px-6 py-2.5 font-mono">{formatNgn(row.estimated_cost_ngn)}</td>
      <td className="px-6 py-2.5 font-mono">
        <ReceiptCell costNgn={row.receipt_cost_ngn} liters={row.receipt_liters} />
      </td>
    </tr>
  );
}

function DayGroup({ day }: { day: EstimatedConsumptionDay }) {
  const isAggregate = day.vehicles.length > 1;

  return (
    <>
      {isAggregate ? (
      <tr className="bg-panel-deep">
        <td className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-brand" colSpan={2}>
          {formatDay(day.date)}
        </td>
        <td className="px-6 py-2 font-mono text-xs text-ink-dim">
          {day.totals.distance_km.toLocaleString()} km
        </td>
        <td className="px-6 py-2" colSpan={2} />
        <td className="px-6 py-2 font-mono text-xs text-ink-dim">
          {day.totals.estimated_fuel_liters.toFixed(1)} L
        </td>
        <td className="px-6 py-2 font-mono text-xs text-ink-dim">
          {formatNgn(day.totals.estimated_cost_ngn)}
        </td>
        <td className="px-6 py-2 font-mono text-xs text-ink-dim">
          <ReceiptCell costNgn={day.totals.receipt_cost_ngn} liters={day.totals.receipt_liters} muted />
        </td>
      </tr>
      ) : (
        <tr className="bg-panel-deep">
          <td
            className="px-6 py-1.5 text-xs font-semibold uppercase tracking-wider text-brand"
            colSpan={8}
          >
            {formatDay(day.date)}
          </td>
        </tr>
      )}
      {day.vehicles.map((row) => (
        <VehicleRow key={`${day.date}-${row.vehicle_id}`} row={row} />
      ))}
    </>
  );
}

export function EstimatedConsumptionTableView({
  days,
  onDaysChange,
  driverId = null,
  onDriverChange,
  drivers = [],
  data,
  loading,
  error,
}: {
  days: number;
  onDaysChange: (d: number) => void;
  /** Null shows every vehicle; a driver id narrows to that driver's vehicles. */
  driverId?: string | null;
  onDriverChange?: (driverId: string | null) => void;
  drivers?: Driver[];
  data: EstimatedConsumptionResponse | null;
  loading: boolean;
  error: string | null;
}) {
  const rows = data?.vehicles ?? [];
  const activeDriver = drivers.find((d) => d.id === driverId) ?? null;

  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-ink">
            <Gauge className="h-4 w-4 text-accent-y" /> Estimated fuel consumed
          </h2>
          <p className="mt-1 text-xs text-ink-dim">
            Estimated, not measured · receipts are what was paid, not what was burned
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onDriverChange && drivers.length > 0 && (
            <label className="relative inline-flex items-center">
              <span className="sr-only">Driver</span>
              <select
                value={driverId ?? ''}
                onChange={(e) => onDriverChange(e.target.value || null)}
                className="appearance-none rounded-lg border border-edge bg-panel py-1 pl-3 pr-7 text-xs text-ink-mid focus:border-accent-y focus:outline-none"
              >
                <option value="">All drivers</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-ink-dim" />
            </label>
          )}
          <div className="flex gap-1">
          {ESTIMATE_PERIOD_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDaysChange(d)}
              className={`rounded-lg border px-3 py-1 text-xs ${
                days === d
                  ? 'border-good bg-good/10 text-good'
                  : 'border-edge text-ink-mid hover:bg-panel-hover'
              }`}
            >
              {d === 1 ? 'Today' : `${d} days`}
            </button>
          ))}
          </div>
        </div>
      </div>

      {error && <p className="px-6 py-3 text-sm text-bad">{error}</p>}

      {loading && rows.length === 0 ? (
        <TableSkeleton
          columns={[
            { width: 90 },
            { width: 80 },
            { width: 60, align: 'right' },
            { width: 60, align: 'right' },
            { width: 50, align: 'right' },
            { width: 60, align: 'right' },
            { width: 70, align: 'right' },
            { width: 90, align: 'right' },
          ]}
        />
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-ink-dim">
          {activeDriver
            ? `No distance or receipts recorded for ${activeDriver.full_name} in this period.`
            : 'No distance recorded in this period yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wider text-ink-dim">
              <tr>
                <th className="px-6 py-3">Vehicle</th>
                <th className="px-6 py-3">Driver</th>
                <th className="px-6 py-3">Distance</th>
                {/* This is the rate configured on the vehicle, not a model
                    average — calling it "baseline" hid the fact that changing
                    it changes every litre and every naira on this page. */}
                <th className="px-6 py-3">Your km/L</th>
                <th className="px-6 py-3">Idle</th>
                <th className="px-6 py-3">Fuel used</th>
                <th className="px-6 py-3">Est. cost</th>
                {/* From filed receipts. Sits beside the estimate so a manager
                    can see paid against modelled on the same line. */}
                <th className="px-6 py-3">Paid (receipts)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider text-ink-mid">
              {(data?.daily?.length ? data.daily : [null]).map((day) =>
                day == null ? (
                  rows.map((row) => <VehicleRow key={row.vehicle_id} row={row} />)
                ) : (
                  <DayGroup key={day.date} day={day} />
                )
              )}
            </tbody>
            {data && (
              <tfoot className="border-t border-edge bg-canvas font-medium text-ink">
                <tr>
                  <td className="px-6 py-3" colSpan={2}>
                    Fleet total
                  </td>
                  <td className="px-6 py-3 font-mono">
                    {data.totals.distance_km.toLocaleString()} km
                  </td>
                  <td className="px-6 py-3" colSpan={2} />
                  <td className="px-6 py-3 font-mono text-good">
                    {data.totals.estimated_fuel_liters.toFixed(1)} L
                  </td>
                  <td className="px-6 py-3 font-mono">
                    {formatNgn(data.totals.estimated_cost_ngn)}
                  </td>
                  <td className="px-6 py-3 font-mono">
                    <ReceiptCell costNgn={data.totals.receipt_cost_ngn} liters={data.totals.receipt_liters} muted />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

export function EstimatedConsumptionTable() {
  const [days, setDays] = useState(7);
  const [driverId, setDriverId] = useState<string | null>(null);
  const drivers = useDriverOptions();
  const state = useEstimatedConsumption(days, driverId);

  return (
    <EstimatedConsumptionTableView
      days={days}
      onDaysChange={setDays}
      driverId={driverId}
      onDriverChange={setDriverId}
      drivers={drivers}
      {...state}
    />
  );
}
