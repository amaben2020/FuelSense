'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  Fuel,
  Loader2,
  MessageSquareWarning,
  Phone,
  ReceiptText,
  Wallet,
  X,
} from 'lucide-react';
import {
  RefuelPlanning,
  RefuelVehicle,
  fetchRefuelPlanning,
  formatNgn,
  formatOdometerMiles,
  requestRefuelFigureChange,
} from '@/lib/api';
import { Panel, StatPills, StatusChip, TabRow } from '@/components/ui/chrome';
import { LoadErrorBanner } from './LoadErrorBanner';
import { FleetIntelligencePanel } from './FleetIntelligencePanel';

const lagosDate = (iso: string, withTime = false) =>
  new Date(iso).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  });

const ago = (days: number): string => {
  if (days < 1) return 'today';
  const d = Math.round(days);
  return d === 1 ? 'yesterday' : `${d} days ago`;
};

const inDays = (days: number): string => {
  if (days <= 0) return 'now';
  if (days < 1) return 'today';
  const d = Math.round(days);
  return d === 1 ? 'tomorrow' : `in ${d} days`;
};

const STATUS: Record<
  RefuelVehicle['next_refuel']['status'],
  { label: string; tone: 'bad' | 'warn' | 'good' | 'neutral' | 'info' }
> = {
  overdue: { label: 'Needs fuel now', tone: 'bad' },
  soon: { label: 'This week', tone: 'warn' },
  ok: { label: 'Fine for now', tone: 'good' },
  unknown: { label: 'Not enough data', tone: 'neutral' },
  no_receipts: { label: 'No receipts yet', tone: 'info' },
};

/**
 * The page a manager funding a fleet actually needs: for each driver, when
 * they last bought fuel (the receipt), how far they have gone since, and when
 * — and with how much — they will be back for more.
 *
 * Honesty about which columns are measured and which are modelled is built
 * into the layout: the receipt and the kilometres are facts; the tank level
 * and the date are estimates and carry the basis they rest on. A fleet with
 * receipts only ever pays for what a receipt shows, so the money column is the
 * driver's usual purchase, not a theoretical fill-up.
 */
type Tab = 'plan' | 'working';

export function RefuelPlanningPanel({ readOnly = false }: { readOnly?: boolean }) {
  const [data, setData] = useState<RefuelPlanning | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [showSignals, setShowSignals] = useState(false);
  const [tab, setTab] = useState<Tab>('plan');
  const [disputing, setDisputing] = useState<RefuelVehicle | null>(null);

  const runFetch = useCallback(() => {
    fetchRefuelPlanning()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    runFetch();
  }, [runFetch]);

  useEffect(() => {
    runFetch();
  }, [runFetch]);

  if (error) {
    return <LoadErrorBanner error={error} subject="refuel planning" onRetry={load} />;
  }

  const s = data?.summary;

  return (
    <div className="space-y-4">
      <Panel
        icon={Fuel}
        title="Refuel planning"
        subtitle={
          data
            ? `Fuel at ${formatNgn(data.price_per_liter_ngn)}/L${data.price_source === 'latest_receipt' ? ' (latest receipt)' : ' (default — no receipt price yet)'} · tank estimates hold back a ${data.reserve_liters} L reserve`
            : 'Who last refuelled, how far they have gone since, and who needs money next'
        }
        onRefresh={load}
        refreshing={loading}
      >
        <TabRow<Tab>
          className="mb-4"
          items={[
            { id: 'plan', label: 'Who needs fuel' },
            { id: 'working', label: 'How we calculate' },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === 'working' && data && (
          <WorkingTab data={data} readOnly={readOnly} onDispute={setDisputing} />
        )}

        {tab === 'plan' && s && (
          <StatPills
            className="mb-4"
            items={[
              { icon: AlertTriangle, label: 'Need fuel now', value: String(s.due_now) },
              { icon: CalendarClock, label: 'Due this week', value: String(s.due_this_week) },
              { icon: Wallet, label: 'Cash to have ready this week', value: formatNgn(s.cash_needed_this_week_ngn) },
              { icon: Fuel, label: 'Spent last 30 days', value: `${formatNgn(s.spend_30d_ngn)} · ${s.liters_30d} L` },
              ...(s.no_receipts
                ? [{ icon: ReceiptText, label: 'Vehicles with no receipts', value: String(s.no_receipts) }]
                : []),
            ]}
          />
        )}

        {tab !== 'plan' ? null : !data && loading ? (
          <p className="rounded-xl bg-panel-deep px-4 py-6 text-center text-sm text-ink-dim">Loading…</p>
        ) : !data || data.vehicles.length === 0 ? (
          <p className="rounded-xl bg-panel-deep px-4 py-6 text-center text-sm text-ink-dim">
            No vehicles yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-ink-dim">
                <tr>
                  <th className="py-2 pr-3 font-medium">Driver · vehicle</th>
                  <th className="py-2 pr-3 font-medium">Last refuel (receipt)</th>
                  <th className="py-2 pr-3 font-medium">Since then</th>
                  <th className="py-2 pr-3 font-medium">Tank now (est.)</th>
                  <th className="py-2 pr-3 font-medium">Next refuel (est.)</th>
                  <th className="py-2 pr-3 font-medium">Money to have ready</th>
                  <th className="py-2 font-medium">Last 30 days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {data.vehicles.map((v) => {
                  const st = STATUS[v.next_refuel.status];
                  const n = v.next_refuel;
                  return (
                    <tr key={v.vehicle_id} className={n.status === 'overdue' ? 'bg-bad-deep/10' : ''}>
                      <td className="py-3 pr-3 align-top">
                        <p className="font-medium text-ink">{v.driver_name}</p>
                        <p className="text-xs text-ink-dim">
                          {v.license_plate}
                          {v.make ? ` · ${v.make} ${v.model ?? ''}` : ''}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <StatusChip tone={st.tone} dot>
                            {st.label}
                          </StatusChip>
                          {v.driver_phone && (
                            <a
                              href={`tel:${v.driver_phone}`}
                              className="inline-flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 text-[11px] text-ink-mid hover:bg-panel-hover"
                            >
                              <Phone className="h-3 w-3" /> Call
                            </a>
                          )}
                        </div>
                      </td>

                      <td className="py-3 pr-3 align-top">
                        {v.last_refuel ? (
                          <>
                            <p className="text-ink">
                              {lagosDate(v.last_refuel.at, true)}{' '}
                              <span className="text-ink-dim">· {ago(v.last_refuel.days_ago)}</span>
                            </p>
                            <p className="text-xs text-ink-mid">
                              {v.last_refuel.liters} L
                              {v.last_refuel.amount_ngn != null && ` · ${formatNgn(v.last_refuel.amount_ngn)}`}
                              {v.last_refuel.price_per_liter != null && ` @ ${formatNgn(v.last_refuel.price_per_liter)}/L`}
                            </p>
                            {v.last_refuel.merchant && (
                              <p className="truncate text-xs text-ink-dim" title={v.last_refuel.merchant}>
                                <ReceiptText className="mr-1 inline h-3 w-3" />
                                {v.last_refuel.merchant}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-ink-dim">No receipt on file. The driver logs one from the app.</p>
                        )}
                      </td>

                      <td className="py-3 pr-3 align-top tabular-nums">
                        {v.since_refuel ? (
                          <>
                            <p className="text-ink">{v.since_refuel.km} km</p>
                            <p className="text-xs text-ink-dim">
                              ~{v.since_refuel.fuel_used_l} L used
                              {v.since_refuel.idle_hours >= 0.5 && ` · ${v.since_refuel.idle_hours} h idling`}
                            </p>
                          </>
                        ) : (
                          <span className="text-ink-dim">—</span>
                        )}
                      </td>

                      <td className="py-3 pr-3 align-top">
                        {v.tank.level_l != null ? (
                          <>
                            <p className="tabular-nums text-ink">
                              ~{v.tank.level_l} L
                              {v.tank.percent != null && <span className="text-ink-dim"> · {v.tank.percent}%</span>}
                            </p>
                            {v.tank.capacity_l != null && v.tank.percent != null && (
                              <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-canvas">
                                <div
                                  className={`h-full rounded-full ${v.tank.percent <= 20 ? 'bg-bad-bright' : 'bg-gradient-to-r from-good to-accent'}`}
                                  style={{ width: `${Math.min(100, v.tank.percent)}%` }}
                                />
                              </div>
                            )}
                            <p className="text-xs text-ink-dim">
                              {v.tank.range_km != null && `~${v.tank.range_km} km to reserve · `}
                              {v.tank.rate_l_per_100km} L/100 km
                              {v.tank.rate_source === 'calibrated' ? ' (from receipts)' : ' (preset)'}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-ink-dim">No tank model yet</span>
                        )}
                      </td>

                      <td className="py-3 pr-3 align-top">
                        {n.in_days != null && n.at ? (
                          <>
                            <p className={`font-medium ${n.status === 'overdue' ? 'text-bad-bright' : n.status === 'soon' ? 'text-warn' : 'text-ink'}`}>
                              {inDays(n.in_days)}
                              <span className="font-normal text-ink-dim"> · {lagosDate(n.at)}</span>
                            </p>
                            <p className="text-xs text-ink-dim">
                              {n.basis === 'model'
                                ? `at ${v.usage.km_per_day ?? 0} km/day (${v.usage.active_days} active of ${v.usage.window_days})`
                                : `refuels every ~${n.avg_gap_days} days`}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-ink-dim">
                            {v.last_refuel ? 'Not enough driving or receipts to say yet' : '—'}
                          </p>
                        )}
                      </td>

                      <td className="py-3 pr-3 align-top">
                        {n.cash_ngn != null ? (
                          <>
                            <p className="flex items-center gap-1 font-semibold tabular-nums text-ink">
                              <Wallet className="h-3.5 w-3.5 text-accent-y" />
                              {formatNgn(n.cash_ngn)}
                            </p>
                            <p className="text-xs text-ink-dim">
                              {n.cash_basis === 'typical'
                                ? `usual buy · ~${n.cash_liters} L`
                                : `to fill · ${n.cash_liters} L`}
                              {n.cash_basis === 'typical' && n.fill_cost_ngn != null && (
                                <span className="block">full tank {formatNgn(n.fill_cost_ngn)}</span>
                              )}
                            </p>
                          </>
                        ) : (
                          <span className="text-ink-dim">—</span>
                        )}
                      </td>

                      <td className="py-3 align-top tabular-nums">
                        <p className="text-ink">{formatNgn(v.last_30_days.spend_ngn)}</p>
                        <p className="text-xs text-ink-dim">
                          {v.last_30_days.receipts} receipt{v.last_30_days.receipts === 1 ? '' : 's'} · {v.last_30_days.liters} L
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'plan' && (
        <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">
          Receipts and kilometres are recorded. Tank level, range and the date are estimates: the
          vehicle carries no fuel sensor, so litres are distance × the vehicle&apos;s rate, re-anchored
          each time a receipt or a gauge reading is logged. A rate marked &ldquo;from receipts&rdquo; was
          measured full-to-full on this vehicle; &ldquo;preset&rdquo; is the class default until it is.
        </p>
        )}
      </Panel>

      {disputing && (
        <DisputeModal
          vehicle={disputing}
          onClose={() => setDisputing(null)}
        />
      )}

      {/* The old signals — jamming candidates, working hours, utilisation,
          zone events — still exist for whoever wants them, folded away. */}
      <div>
        <button
          type="button"
          onClick={() => setShowSignals((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs text-ink-dim hover:text-ink"
          aria-expanded={showSignals}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSignals ? 'rotate-180' : ''}`} />
          Tracker signals: security, working hours, utilisation, zones
        </button>
        {showSignals && (
          <div className="mt-3">
            <FleetIntelligencePanel />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The arithmetic behind each vehicle's row, one line per step, in the order
 * it is done. Nothing here is a summary; it is the actual working, so a
 * manager can put the receipt and the dashboard odometer next to it and
 * check every line. The button at the bottom is for when a line is wrong.
 */
function WorkingTab({
  data,
  readOnly,
  onDispute,
}: {
  data: RefuelPlanning;
  readOnly: boolean;
  onDispute: (v: RefuelVehicle) => void;
}) {
  if (data.vehicles.length === 0) {
    return <p className="rounded-xl bg-panel-deep px-4 py-6 text-center text-sm text-ink-dim">No vehicles yet.</p>;
  }
  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-ink-mid">
        No sensor on the vehicle measures fuel. Every litre below is arrived at from three
        recorded things — the receipt, the odometer, and the vehicle&apos;s consumption rate — in
        the steps shown. Measured figures are marked; everything after the rate is an estimate
        that follows from them.
      </p>
      {data.vehicles.map((v) => {
        const c = v.calculation;
        const Row = ({
          label,
          value,
          how,
          kind,
        }: {
          label: string;
          value: React.ReactNode;
          how?: React.ReactNode;
          kind: 'measured' | 'setting' | 'estimate';
        }) => (
          <tr>
            <td className="w-52 py-2 pr-3 align-top text-ink-mid">{label}</td>
            <td className="w-40 py-2 pr-3 align-top font-medium tabular-nums text-ink">{value}</td>
            <td className="py-2 pr-3 align-top text-xs text-ink-dim">{how}</td>
            <td className="w-24 py-2 align-top">
              <StatusChip tone={kind === 'measured' ? 'good' : kind === 'setting' ? 'info' : 'warn'}>
                {kind}
              </StatusChip>
            </td>
          </tr>
        );
        return (
          <div key={v.vehicle_id} className="rounded-xl border border-edge bg-panel-deep p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">
                  {v.license_plate}
                  <span className="font-normal text-ink-dim"> · {v.driver_name}</span>
                </p>
                <p className="text-xs text-ink-dim">
                  {[v.make, v.model].filter(Boolean).join(' ')}
                  {c.odometer_now_at &&
                    ` · odometer read ${new Date(c.odometer_now_at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                </p>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onDispute(v)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-ink-mid transition-colors hover:border-warn/60 hover:text-warn"
                >
                  <MessageSquareWarning className="h-3.5 w-3.5" /> Request changes
                </button>
              )}
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <tbody className="divide-y divide-edge">
                  <Row
                    kind="measured"
                    label="Last receipt"
                    value={v.last_refuel ? `${v.last_refuel.liters} L` : '—'}
                    how={
                      v.last_refuel
                        ? `${lagosDate(v.last_refuel.at, true)} · ${v.last_refuel.amount_ngn != null ? formatNgn(v.last_refuel.amount_ngn) : ''}${v.last_refuel.merchant ? ` · ${v.last_refuel.merchant}` : ''} — logged by the driver from the receipt`
                        : 'No receipt on file; nothing below can be anchored to a purchase.'
                    }
                  />
                  <Row
                    kind="measured"
                    label="Odometer at that refuel"
                    value={c.odometer_at_refuel_km != null ? formatOdometerMiles(c.odometer_at_refuel_km) : '—'}
                    how="The tracker's odometer (AVL 16) on the last reading before the receipt time."
                  />
                  <Row
                    kind="measured"
                    label="Odometer now"
                    value={c.odometer_now_km != null ? formatOdometerMiles(c.odometer_now_km) : '—'}
                    how="Latest tracker reading."
                  />
                  <Row
                    kind="measured"
                    label="Distance since refuel"
                    value={`${c.km_since_refuel} km`}
                    how={`Sum of ${c.km_since_source}. Odometer where reported, GPS otherwise; a hop longer than the vehicle could have driven in the time is clipped.`}
                  />
                  <Row
                    kind="setting"
                    label="Consumption rate"
                    value={`${c.rate_l_per_100km} L/100 km`}
                    how={`= ${c.rate_mpg} mpg. ${c.rate_source === 'calibrated' ? 'Measured on this vehicle from full-to-full receipts.' : c.rate_source === 'manual' ? 'Entered by the manager under Calibration.' : 'Class preset — set the real figure under Calibration, or it learns from full-to-full receipts.'}`}
                  />
                  <Row
                    kind="estimate"
                    label="Fuel used since refuel"
                    value={`${c.liters_used_since_refuel} L`}
                    how={`${c.km_since_refuel} km × ${c.rate_l_per_100km} ÷ 100`}
                  />
                  <Row
                    kind="estimate"
                    label="Tank anchor"
                    value={c.anchor.level_l != null ? `${c.anchor.level_l} L` : '—'}
                    how={
                      c.anchor.at
                        ? `Level the tank was last pinned to, ${lagosDate(c.anchor.at, true)} (${c.anchor.source ?? 'calibration'}). A receipt adds its litres to the level at that moment; a gauge reading replaces it.`
                        : 'Never anchored — starts at half a tank until a receipt or gauge reading is logged.'
                    }
                  />
                  <Row
                    kind="estimate"
                    label="Burned since anchor"
                    value={c.burned_since_anchor_l != null ? `${c.burned_since_anchor_l} L` : '—'}
                    how="Every hop since the anchor: distance × rate, plus idle hours × idle rate when the engine ran without moving."
                  />
                  <Row
                    kind="estimate"
                    label="Tank now"
                    value={c.level_now_l != null ? `${c.level_now_l} L` : '—'}
                    how={c.anchor.level_l != null && c.burned_since_anchor_l != null ? `${c.anchor.level_l} − ${c.burned_since_anchor_l}` : undefined}
                  />
                  <Row
                    kind="estimate"
                    label="Range to reserve"
                    value={c.range_km != null ? `${c.range_km} km` : '—'}
                    how={c.usable_l != null ? `(${c.level_now_l} − ${c.reserve_l} reserve) = ${c.usable_l} L usable ÷ ${c.rate_l_per_100km} × 100` : undefined}
                  />
                  <Row
                    kind="estimate"
                    label="Next refuel"
                    value={
                      v.next_refuel.in_days != null ? inDays(v.next_refuel.in_days) : '—'
                    }
                    how={
                      c.days_by_model != null
                        ? `${c.range_km} km ÷ ${c.km_per_day} km/day (average of the last ${v.usage.window_days} days) = ${c.days_by_model} days${c.days_by_cadence != null ? `; receipt cadence alone would say ${c.days_by_cadence} days` : ''}`
                        : c.days_by_cadence != null
                          ? `From receipt cadence alone: refuels every ~${v.next_refuel.avg_gap_days} days, last one ${v.last_refuel ? ago(v.last_refuel.days_ago) : ''}`
                          : 'Not enough driving or receipts yet.'
                    }
                  />
                  <Row
                    kind="setting"
                    label="Price"
                    value={`${formatNgn(c.price_per_liter_ngn)}/L`}
                    how={data.price_source === 'latest_receipt' ? 'From the latest receipt.' : 'Platform default until a receipt carries a price.'}
                  />
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** "This is wrong" — sent to the developer with the working attached. */
function DisputeModal({ vehicle, onClose }: { vehicle: RefuelVehicle; onClose: () => void }) {
  const c = vehicle.calculation;
  const [message, setMessage] = useState(
    `The fuel in the tank of ${vehicle.license_plate} is shown as ${c.level_now_l ?? '?'} L, but `
  );
  const [actual, setActual] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await requestRefuelFigureChange({
        vehicle_id: vehicle.vehicle_id,
        message: message.trim(),
        actual_liters: actual.trim() ? Number(actual) : null,
      });
      setDone(res.sent_to);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="fixed inset-0 z-40 bg-black/50" aria-label="Close" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,540px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-edge bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-ink">Request changes · {vehicle.license_plate}</p>
            <p className="mt-0.5 text-xs text-ink-dim">
              Goes to the developer with every figure from this page attached, so nothing needs
              re-typing.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-mid hover:bg-divider" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="mt-4 rounded-xl bg-good/10 p-4 text-sm text-ink">
            Sent to {done}. You&apos;ll get a reply by email.
            <div className="mt-3 text-right">
              <button type="button" onClick={onClose} className="rounded-lg border border-edge px-3 py-2 text-xs text-ink-mid hover:bg-panel-hover">
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={send} className="mt-4 space-y-3">
            <label className="block text-xs text-ink-mid">
              What&apos;s wrong
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                maxLength={2000}
                required
                className="mt-1 w-full rounded-lg border border-edge bg-panel-deep px-3 py-2 text-sm text-ink placeholder-ink-dim"
              />
            </label>
            <label className="block text-xs text-ink-mid">
              What the gauge actually shows, in litres <span className="text-ink-dim">(optional)</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                className="mt-1 w-40 rounded-lg border border-edge bg-panel-deep px-3 py-2 text-sm text-ink"
              />
            </label>
            {error && <p className="text-xs text-bad">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-edge px-3 py-2 text-xs text-ink-mid hover:bg-panel-hover">
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !message.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-good px-4 py-2 text-xs font-semibold text-accent-y-ink disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send to developer
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
