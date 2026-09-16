'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Fuel,
  Gauge,
  Printer,
  ReceiptText,
  Route,
  Siren,
  TrendingDown,
  Truck,
  Users,
} from 'lucide-react';
import {
  api,
  fetchDriverReports,
  formatNgn,
  type Alert,
  type Customer,
  type DashboardSummary,
  type DriverReportsResponse,
  type FleetEfficiency,
  type FleetEfficiencySummary,
  type FleetVehicle,
  type FuelPurchasesResponse,
  type HealthTrendResponse,
} from '@/lib/api';
import { Panel, SegmentedPills } from '@/components/ui/chrome';
import { TrendBars, type TrendPoint } from './TrendBars';

const fmtInt = (n: number) => new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format(n);
const fmtL = (n: number) => `${fmtInt(n)} L`;
const fmtKm = (n: number) => `${fmtInt(n)} km`;

/** A day series over the window, zero-filled so quiet days still show as days. */
function dayWindow(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function toSeries(days: number, byDate: Map<string, number>): TrendPoint[] {
  return dayWindow(days).map((date) => ({ date, value: byDate.get(date) ?? 0 }));
}

function Tile({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'ink',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail?: string;
  tone?: 'ink' | 'bad' | 'good';
}) {
  const valueClass = tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-ink';
  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-dim">
        <Icon className="h-3.5 w-3.5 text-accent-y" /> {label}
      </p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-ink-dim">{detail}</p>}
    </div>
  );
}

/**
 * The commander's page: the fleet in numbers, how those numbers are moving,
 * and the reports a command briefing wants — nothing to configure, nothing
 * to acknowledge. Every figure is a fleet total or a trend over the window;
 * the vehicle- and alert-level detail lives in the logistics and manager
 * views. "Fuel bought" is receipts, "fuel burned" is the odometer-driven
 * model, and the two are shown side by side because the gap between them is
 * the one fuel-accountability figure this hardware can honestly produce.
 */
export function CommanderDashboard({
  customer,
  summary,
  efficiency,
  efficiencySummary,
  fleet,
  alerts,
  periodDays,
  onPeriodChange,
}: {
  customer: Customer | null;
  summary: DashboardSummary | null;
  efficiency: FleetEfficiency[];
  efficiencySummary: FleetEfficiencySummary | null;
  fleet: FleetVehicle[];
  alerts: Alert[];
  periodDays: number;
  onPeriodChange: (days: number) => void;
}) {
  const [purchases, setPurchases] = useState<FuelPurchasesResponse | null>(null);
  const [reports, setReports] = useState<DriverReportsResponse | null>(null);
  const [health, setHealth] = useState<HealthTrendResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, r, h] = await Promise.all([
        api<FuelPurchasesResponse>(
          `/telemetry/fuel-purchases?page=1&limit=1&include_summary=true&days=${periodDays}`
        ).catch(() => null),
        fetchDriverReports({ bucket: 'day', periods: periodDays }).catch(() => null),
        api<HealthTrendResponse>('/dashboard/health-trend').catch(() => null),
      ]);
      if (cancelled) return;
      setPurchases(p);
      setReports(r);
      setHealth(h);
    })();
    return () => {
      cancelled = true;
    };
  }, [periodDays]);

  const bought = purchases?.summary?.grand_total;
  const burnedLiters = summary?.total_fuel_used_liters ?? efficiencySummary?.total_fuel_used_liters ?? 0;
  const boughtLiters = bought?.total_receipt_liters ?? 0;
  const accountability = burnedLiters > 0 && boughtLiters > 0 ? boughtLiters / burnedLiters : null;

  const kmSeries = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of reports?.drivers ?? [])
      for (const p of d.periods) m.set(p.period, (m.get(p.period) ?? 0) + p.distance_km);
    return toSeries(periodDays, m);
  }, [reports, periodDays]);

  const fuelSeries = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of reports?.drivers ?? [])
      for (const p of d.periods) m.set(p.period, (m.get(p.period) ?? 0) + p.fuel_liters);
    return toSeries(periodDays, m);
  }, [reports, periodDays]);

  const spendSeries = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of purchases?.summary?.daily_totals ?? []) {
      const date = t.activity_date.slice(0, 10);
      m.set(date, (m.get(date) ?? 0) + t.total_cost_ngn);
    }
    return toSeries(periodDays, m);
  }, [purchases, periodDays]);

  const alertSeries = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of health?.days ?? []) m.set(d.date.slice(0, 10), d.concerning_alerts);
    return toSeries(Math.min(periodDays, health?.days.length ?? periodDays), m);
  }, [health, periodDays]);

  const driverLeague = useMemo(() => {
    const byDriver = new Map<string, { name: string; km: number; fuel: number; scores: number[] }>();
    for (const row of efficiency) {
      const name = row.driver_name ?? 'Unassigned';
      const e = byDriver.get(name) ?? { name, km: 0, fuel: 0, scores: [] };
      e.km += row.distance_km;
      e.fuel += row.fuel_used_liters;
      if (row.efficiency_km_l != null && row.expected_efficiency_km_l > 0)
        e.scores.push(Math.min(100, Math.round((row.efficiency_km_l / row.expected_efficiency_km_l) * 100)));
      byDriver.set(name, e);
    }
    return [...byDriver.values()]
      .map((d) => ({
        ...d,
        score: d.scores.length ? Math.round(d.scores.reduce((s, v) => s + v, 0) / d.scores.length) : null,
      }))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }, [efficiency]);

  const utilisation = useMemo(
    () => [...efficiency].sort((a, b) => b.distance_km - a.distance_km),
    [efficiency]
  );

  const online = fleet.filter((v) => v.connection_status === 'online').length;
  const openAlerts = alerts.length;
  const name = customer?.user?.name ?? customer?.name ?? '';
  const windowLabel = `last ${periodDays} days`;

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink-mid">
            Command summary for {customer?.company_name || 'the fleet'} · {windowLabel}
          </p>
          {name && <p className="text-xs text-ink-dim">Prepared for {name}{customer?.user?.title ? ` · ${customer.user.title}` : ''}</p>}
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <SegmentedPills
            items={[
              { id: '7', label: '7 days' },
              { id: '30', label: '30 days' },
            ]}
            active={String(periodDays)}
            onChange={(id) => onPeriodChange(Number(id))}
          />
          <button
            type="button"
            onClick={() => globalThis.window?.print()}
            className="inline-flex items-center gap-2 rounded-full border border-edge bg-panel px-3.5 py-1.5 text-xs font-semibold text-ink hover:bg-panel-hover"
          >
            <Printer className="h-3.5 w-3.5" /> Print briefing
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={Truck}
          label="Fleet"
          value={`${online}/${fleet.length}`}
          detail="vehicles reporting now"
        />
        <Tile
          icon={Route}
          label="Distance"
          value={fmtKm(summary?.total_distance_km ?? 0)}
          detail={`${fmtInt(reports?.drivers.reduce((s, d) => s + d.periods.reduce((t, p) => t + p.trips, 0), 0) ?? 0)} trips · ${windowLabel}`}
        />
        <Tile
          icon={Fuel}
          label="Fuel burned"
          value={fmtL(burnedLiters)}
          detail={`${formatNgn(summary?.total_fuel_cost_ngn ?? 0)} at the declared price`}
        />
        <Tile
          icon={ReceiptText}
          label="Fuel bought"
          value={fmtL(boughtLiters)}
          detail={`${formatNgn(bought?.total_cost_ngn ?? 0)} on ${bought?.receipt_count ?? 0} receipts`}
        />
        <Tile
          icon={Gauge}
          label="Fuel accountability"
          value={accountability != null ? `${Math.round(accountability * 100)}%` : '—'}
          detail={
            accountability == null
              ? 'needs receipts and driving in the window'
              : accountability > 1.15
                ? 'bought well above what the fleet drove — worth a question'
                : accountability < 0.85
                  ? 'receipts lag the driving — fills not logged'
                  : 'buying tracks burning'
          }
          tone={accountability != null && accountability > 1.15 ? 'bad' : 'ink'}
        />
        <Tile
          icon={TrendingDown}
          label="Preventable loss"
          value={formatNgn(efficiencySummary?.total_loss_ngn ?? 0)}
          detail={`idling ${formatNgn(efficiencySummary?.loss_reason?.idle_cost_ngn ?? 0)} · efficiency ${formatNgn(efficiencySummary?.total_efficiency_loss_ngn ?? 0)}`}
          tone={(efficiencySummary?.total_loss_ngn ?? 0) > 0 ? 'bad' : 'good'}
        />
        <Tile
          icon={Activity}
          label="Efficiency"
          value={summary?.avg_efficiency_km_l != null ? `${summary.avg_efficiency_km_l.toFixed(1)} km/L` : '—'}
          detail={`fleet average · ${windowLabel}`}
        />
        <Tile
          icon={Siren}
          label="Open alerts"
          value={fmtInt(openAlerts)}
          detail={`${summary?.theft_alerts ?? 0} theft flags`}
          tone={openAlerts > 0 ? 'bad' : 'good'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon={Route} title="Distance per day" subtitle="Odometer-derived, all vehicles">
          <TrendBars points={kmSeries} format={fmtKm} />
        </Panel>
        <Panel icon={Fuel} title="Fuel burned per day" subtitle="Modelled from distance and idle time">
          <TrendBars points={fuelSeries} format={fmtL} />
        </Panel>
        <Panel icon={ReceiptText} title="Fuel spend per day" subtitle="Receipts logged by drivers">
          <TrendBars points={spendSeries} format={formatNgn} />
        </Panel>
        <Panel icon={Siren} title="Alerts raised per day" subtitle="Driving and fuel alerts, not connectivity">
          <TrendBars points={alertSeries} format={(v) => `${fmtInt(v)} alerts`} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon={Users} title="Driver league" subtitle="Efficiency against each vehicle's benchmark">
          {driverLeague.length === 0 ? (
            <p className="text-sm text-ink-dim">No driving in this window.</p>
          ) : (
            <ol className="divide-y divide-divider">
              {driverLeague.slice(0, 10).map((d, i) => (
                <li key={d.name} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-5 text-right font-mono text-xs text-ink-dim">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{d.name}</span>
                  <span className="font-mono text-xs text-ink-dim">{fmtKm(d.km)}</span>
                  <span
                    className={`w-14 text-right font-mono text-xs font-semibold ${
                      d.score == null ? 'text-ink-dim' : d.score >= 85 ? 'text-good' : d.score >= 70 ? 'text-warn' : 'text-bad'
                    }`}
                  >
                    {d.score == null ? '—' : `${d.score}/100`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel icon={Truck} title="Vehicle utilisation" subtitle={`Distance, idling and loss · ${windowLabel}`}>
          {utilisation.length === 0 ? (
            <p className="text-sm text-ink-dim">No driving in this window.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-ink-dim">
                    <th className="pb-2 text-left font-medium">Vehicle</th>
                    <th className="pb-2 text-right font-medium">Distance</th>
                    <th className="pb-2 text-right font-medium">Idle</th>
                    <th className="pb-2 text-right font-medium">Loss</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {utilisation.slice(0, 10).map((v) => (
                    <tr key={v.vehicle_id}>
                      <td className="py-2 font-mono text-xs text-ink">{v.license_plate}</td>
                      <td className="py-2 text-right font-mono text-xs text-ink-mid">{fmtKm(v.distance_km)}</td>
                      <td className="py-2 text-right font-mono text-xs text-ink-mid">
                        {v.idle_hours != null ? `${v.idle_hours.toFixed(1)} h` : '—'}
                      </td>
                      <td className={`py-2 text-right font-mono text-xs ${v.total_loss_ngn > 0 ? 'text-bad' : 'text-ink-dim'}`}>
                        {formatNgn(v.total_loss_ngn)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <p className="text-[11px] text-ink-dim">
        Distance is odometer-derived from the tracker. Litres burned are modelled from that distance
        and idle time at each vehicle&apos;s configured rate; litres bought are the receipts drivers
        logged. Prices are the fleet&apos;s declared benchmark.
      </p>
    </div>
  );
}
