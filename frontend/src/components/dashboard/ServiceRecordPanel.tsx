'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ClipboardList,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import {
  FleetVehicle,
  KM_TO_MILES,
  MaintenanceItem,
  MaintenanceResponse,
  ServiceDefinition,
  ServiceLogEntry,
  applyStandardPlan,
  completeMaintenance,
  createMaintenance,
  deleteMaintenance,
  deleteServiceLog,
  fetchMaintenance,
  fetchServiceCatalogue,
  fetchServiceHistory,
  formatNgn,
  formatOdometerMiles,
  milesToKm,
  setVehicleOdometer,
  updateMaintenance,
} from '@/lib/api';
import { StatusChip, TabRow } from '@/components/ui/chrome';
import { KpiCard } from './DashboardKpis';
import { LoadErrorBanner } from './LoadErrorBanner';

const INPUT =
  'mt-1 w-full rounded-lg border border-edge bg-panel-deep px-3 py-2 text-sm text-ink placeholder-ink-dim';

const GROUP_LABEL: Record<MaintenanceItem['group'], string> = {
  engine: 'Engine',
  tyres_brakes: 'Tyres & brakes',
  fluids: 'Fluids',
  electrical: 'Electrical',
  general: 'General',
};

const STATUS: Record<MaintenanceItem['status'], { label: string; tone: 'bad' | 'warn' | 'good' | 'info' }> = {
  overdue: { label: 'Overdue', tone: 'bad' },
  due_soon: { label: 'Due soon', tone: 'warn' },
  ok: { label: 'OK', tone: 'good' },
  needs_baseline: { label: 'Set last done', tone: 'info' },
};

const miles = (km: number | null | undefined): string =>
  km == null ? '—' : `${Math.abs(Math.round(km * KM_TO_MILES)).toLocaleString('en-NG')} mi`;

const lagosDate = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

const todayInput = () => new Date().toLocaleDateString('en-CA');
const dateInput = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '');

/** "Every 3,107 mi or 6 months" — the interval as a person says it. */
function intervalLabel(km: number | null, days: number | null): string {
  const parts: string[] = [];
  if (km != null) parts.push(miles(km));
  if (days != null) parts.push(days % 365 === 0 ? `${days / 365} yr${days / 365 === 1 ? '' : 's'}` : days % 30 === 0 ? `${days / 30} mo` : `${days} days`);
  return parts.length ? `every ${parts.join(' or ')}` : '—';
}

/** What is left, on whichever limit bites first. */
function remainingLabel(m: MaintenanceItem): { text: string; tone: 'bad' | 'warn' | 'good' | 'neutral' } {
  const km = m.km_remaining;
  const days = m.days_remaining;
  if (km == null && days == null) return { text: 'unknown until last done is set', tone: 'neutral' };
  const kmFirst = km != null && (days == null || km / (m.interval_km ?? 1) <= days / (m.interval_days ?? 1));
  if (kmFirst && km != null) {
    if (km < 0) return { text: `${miles(km)} over`, tone: 'bad' };
    return { text: `${miles(km)} left`, tone: m.status === 'due_soon' ? 'warn' : 'good' };
  }
  if (days != null) {
    if (days < 0) return { text: `${Math.abs(days)} days over`, tone: 'bad' };
    if (days === 0) return { text: 'today', tone: 'warn' };
    return { text: `${days} days left`, tone: m.status === 'due_soon' ? 'warn' : 'good' };
  }
  return { text: '—', tone: 'neutral' };
}

const currentKmOf = (v: FleetVehicle | undefined) => v?.total_odometer_km ?? v?.odometer_km ?? null;

type Tab = 'schedule' | 'history';

/**
 * The service record: what each vehicle is due for, what was done, and what
 * it cost. Distance counts down from the tracker's own odometer, so a
 * schedule that says 3,000 mi to the next oil change is measuring the
 * vehicle, not a number someone remembered to type.
 */
export function ServiceRecordPanel({ fleet = [], readOnly = false }: { fleet?: FleetVehicle[]; readOnly?: boolean }) {
  const [data, setData] = useState<MaintenanceResponse | null>(null);
  const [catalogue, setCatalogue] = useState<ServiceDefinition[]>([]);
  const [history, setHistory] = useState<ServiceLogEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('schedule');
  const [notice, setNotice] = useState<string | null>(null);

  const [logging, setLogging] = useState<MaintenanceItem | null>(null);
  const [editing, setEditing] = useState<MaintenanceItem | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // vehicle id
  const [anchoring, setAnchoring] = useState<{ id: string; plate: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const byId = useMemo(() => new Map(fleet.map((v) => [v.id, v])), [fleet]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, h] = await Promise.all([fetchMaintenance(), fetchServiceHistory()]);
      setData(m);
      setHistory(h.entries);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    fetchServiceCatalogue().then((c) => setCatalogue(c.items)).catch(() => {});
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      await load();
      if (done) setNotice(done);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  if (error) return <LoadErrorBanner error={error} subject="service record" onRetry={() => void load()} />;

  const items = data?.items ?? [];
  const byVehicle = new Map<string, MaintenanceItem[]>();
  for (const m of items) byVehicle.set(m.vehicle_id, [...(byVehicle.get(m.vehicle_id) ?? []), m]);
  const vehiclesWithout = fleet.filter((v) => !byVehicle.has(v.id));
  const unanchored = [...new Map(items.filter((m) => !m.odometer_anchored).map((m) => [m.vehicle_id, m.license_plate])).entries()];
  const nextDue = items.find((m) => m.status === 'overdue' || m.status === 'due_soon') ?? items.find((m) => m.status === 'ok');

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="Overdue" value={data.overdue} hint={data.overdue ? 'Book these first' : 'Nothing is late'} icon={AlertTriangle} tone={data.overdue ? 'critical' : 'default'} />
          <KpiCard
            title="Due soon"
            value={data.due_soon}
            hint={`Within ${miles(data.thresholds.due_soon_km)} or ${data.thresholds.due_soon_days} days`}
            icon={CalendarClock}
            tone={data.due_soon ? 'warning' : 'default'}
          />
          <KpiCard
            title="Next up"
            value={nextDue ? nextDue.label : '—'}
            hint={nextDue ? `${nextDue.license_plate} · ${remainingLabel(nextDue).text}` : 'No schedules yet'}
            icon={Wrench}
          />
          <KpiCard title="Spent on servicing" value={formatNgn(data.spend_90d_ngn)} hint={`${data.services_90d} service${data.services_90d === 1 ? '' : 's'} logged in 90 days`} icon={Wallet} />
        </div>
      )}

      {unanchored.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <p className="text-ink-mid">
            <span className="font-medium text-warn">Mileage is not the dashboard reading</span> for{' '}
            {unanchored.map(([, plate]) => plate).join(', ')} — distance counts from when the tracker was fitted. Anchor it once and every countdown reads true.
          </p>
          {!readOnly && (
            <button
              type="button"
              onClick={() => setAnchoring({ id: unanchored[0][0], plate: unanchored[0][1] })}
              className="rounded-full border border-warn/60 px-3 py-1 text-xs font-medium text-warn hover:bg-warn/10"
            >
              Anchor odometer
            </button>
          )}
        </div>
      )}

      {notice && <p className="rounded-lg border border-edge bg-panel px-4 py-2 text-sm text-ink">{notice}</p>}

      <div className="rounded-lg border border-edge bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <ClipboardList className="h-4 w-4 text-accent-y" /> Service record
            </h2>
            <p className="mt-1 text-xs text-ink-dim">Oil, tyres, brakes, fluids — what each vehicle is due for, counted down by the tracker.</p>
          </div>
          <div className="flex items-center gap-2">
            <TabRow<Tab>
              items={[
                { id: 'schedule', label: 'Schedule', count: items.length || undefined },
                { id: 'history', label: 'History', count: history?.length || undefined },
              ]}
              active={tab}
              onChange={setTab}
              className="border-b-0"
            />
            <button type="button" onClick={() => void load()} className="rounded-lg border border-edge p-2 text-ink-mid hover:bg-panel-hover" aria-label="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {tab === 'schedule' && (
          <div className="divide-y divide-edge">
            {!data && loading && <p className="p-6 text-sm text-ink-dim">Loading…</p>}
            {data && fleet.length === 0 && <p className="p-6 text-sm text-ink-dim">Add a vehicle first.</p>}

            {fleet
              .filter((v) => byVehicle.has(v.id))
              .map((v) => {
                const rows = byVehicle.get(v.id)!;
                const km = currentKmOf(v);
                return (
                  <section key={v.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-canvas/40 px-5 py-3">
                      <div>
                        <span className="font-medium text-brand">{v.license_plate}</span>
                        <span className="ml-2 text-sm text-ink-mid">{[v.make, v.model].filter(Boolean).join(' ')}</span>
                        <span className="ml-2 text-xs text-ink-dim">
                          {km != null ? `odometer ${formatOdometerMiles(km)}` : 'no odometer reading yet'}
                        </span>
                      </div>
                      {!readOnly && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy === `plan-${v.id}`}
                            onClick={() => void act(`plan-${v.id}`, () => applyStandardPlan(v.id), 'Standard plan applied — set when each was last done.')}
                            className="inline-flex items-center gap-1 rounded-full border border-edge px-3 py-1 text-xs text-ink-mid hover:bg-panel-hover disabled:opacity-40"
                            title="Adds any core items this vehicle does not have yet"
                          >
                            <Sparkles className="h-3 w-3" /> Fill in standard plan
                          </button>
                          <button
                            type="button"
                            onClick={() => setAdding(v.id)}
                            className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-canvas hover:opacity-90"
                          >
                            <Plus className="h-3 w-3" /> Add item
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1120px] text-left text-sm">
                        <thead className="bg-canvas text-xs uppercase tracking-wider text-ink-dim whitespace-nowrap">
                          <tr>
                            <th className="px-5 py-2.5">Item</th>
                            <th className="px-3 py-2.5">Every</th>
                            <th className="px-3 py-2.5">Last done</th>
                            <th className="px-3 py-2.5">Next due</th>
                            <th className="px-3 py-2.5">Remaining</th>
                            <th className="px-3 py-2.5">Status</th>
                            <th className="px-3 py-2.5" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-divider text-ink-mid">
                          {rows.map((m) => {
                            const st = STATUS[m.status];
                            const rem = remainingLabel(m);
                            return (
                              <tr key={m.id} className={`hover:bg-panel-hover ${m.status === 'overdue' ? 'bg-bad-deep/10' : ''}`}>
                                <td className="px-5 py-3 whitespace-nowrap">
                                  <span className="font-medium text-ink">{m.label}</span>
                                  <span className="ml-2 text-xs text-ink-dim">{GROUP_LABEL[m.group]}</span>
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap">{intervalLabel(m.interval_km, m.interval_days)}</td>
                                <td className="px-3 py-3 whitespace-nowrap">
                                  {m.last_service_at || m.last_service_km != null ? (
                                    <>
                                      <span className="text-ink">{lagosDate(m.last_service_at)}</span>
                                      {m.last_service_km != null && <span className="ml-1.5 font-mono text-xs text-ink-dim">{formatOdometerMiles(m.last_service_km)}</span>}
                                    </>
                                  ) : (
                                    <span className="text-ink-dim">not recorded</span>
                                  )}
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap">
                                  {m.due_at_km != null && <span className="font-mono text-ink">{formatOdometerMiles(m.due_at_km)}</span>}
                                  {m.due_at_km != null && m.due_at && <span className="text-ink-dim"> or </span>}
                                  {m.due_at && <span className="text-ink">{lagosDate(m.due_at)}</span>}
                                  {m.due_at_km == null && !m.due_at && '—'}
                                </td>
                                <td className={`px-3 py-3 whitespace-nowrap font-medium ${rem.tone === 'bad' ? 'text-bad-bright' : rem.tone === 'warn' ? 'text-warn' : rem.tone === 'good' ? 'text-good' : 'text-ink-dim'}`}>
                                  {rem.text}
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap">
                                  {m.status === 'needs_baseline' && !readOnly ? (
                                    <button
                                      type="button"
                                      onClick={() => setEditing(m)}
                                      className="inline-flex items-center gap-1 rounded-full border border-brand/50 px-2.5 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/10"
                                    >
                                      Set last done
                                    </button>
                                  ) : (
                                    <StatusChip tone={st.tone} dot>
                                      {st.label}
                                    </StatusChip>
                                  )}
                                </td>
                                <td className="px-3 py-3 text-right whitespace-nowrap">
                                  {!readOnly && (
                                    <span className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setLogging(m)}
                                        className="inline-flex items-center gap-1 rounded-full border border-edge px-2.5 py-1 text-[11px] font-medium text-ink-mid transition-colors hover:border-good/50 hover:text-good"
                                      >
                                        <Check className="h-3 w-3" /> Log service
                                      </button>
                                      <button type="button" onClick={() => setEditing(m)} className="rounded p-1 text-ink-dim hover:text-ink" aria-label="Edit" title="Edit">
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (window.confirm(`Remove ${m.label} from ${m.license_plate}? Its history stays.`)) {
                                            void act(`del-${m.id}`, () => deleteMaintenance(m.id));
                                          }
                                        }}
                                        className="rounded p-1 text-ink-dim hover:text-bad"
                                        aria-label="Remove"
                                        title="Remove"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}

            {data &&
              vehiclesWithout.map((v) => (
                <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <span className="font-medium text-brand">{v.license_plate}</span>
                    <span className="ml-2 text-sm text-ink-mid">{[v.make, v.model].filter(Boolean).join(' ')}</span>
                    <p className="text-xs text-ink-dim">No service schedule yet.</p>
                  </div>
                  {!readOnly && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy === `plan-${v.id}`}
                        onClick={() => void act(`plan-${v.id}`, () => applyStandardPlan(v.id), 'Standard plan applied — now set when each item was last done.')}
                        className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
                      >
                        {busy === `plan-${v.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Set up standard plan
                      </button>
                      <button type="button" onClick={() => setAdding(v.id)} className="inline-flex items-center gap-1 rounded-full border border-edge px-3 py-1 text-xs text-ink-mid hover:bg-panel-hover">
                        <Plus className="h-3 w-3" /> Add one item
                      </button>
                    </div>
                  )}
                </div>
              ))}

            <p className="px-5 py-3 text-xs text-ink-dim">
              Standard plan: oil &amp; filter every {miles(5000)} / 6 months, air filter, tyre rotation, tyre replacement, brake pads, brake fluid, coolant, battery, wiper blades and a full service — conservative intervals for Nigerian roads. Change any of them per vehicle.
            </p>
          </div>
        )}

        {tab === 'history' && (
          <HistoryTable entries={history} readOnly={readOnly} onDelete={(id) => void act(`log-${id}`, () => deleteServiceLog(id))} />
        )}
      </div>

      {logging && (
        <LogServiceModal
          item={logging}
          currentKm={currentKmOf(byId.get(logging.vehicle_id))}
          onClose={() => setLogging(null)}
          onSaved={() => {
            setLogging(null);
            void load();
            setNotice(`${logging.label} logged for ${logging.license_plate}.`);
          }}
        />
      )}
      {editing && (
        <EditScheduleModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {adding && (
        <AddItemModal
          vehicle={byId.get(adding)}
          vehicleId={adding}
          catalogue={catalogue}
          existing={new Set((byVehicle.get(adding) ?? []).map((m) => m.kind))}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            void load();
          }}
        />
      )}
      {anchoring && (
        <AnchorModal
          target={anchoring}
          onClose={() => setAnchoring(null)}
          onSaved={() => {
            setAnchoring(null);
            void load();
            setNotice('Odometer anchored — the countdowns now read against the dashboard mileage.');
          }}
        />
      )}
    </div>
  );
}

function HistoryTable({ entries, readOnly, onDelete }: { entries: ServiceLogEntry[] | null; readOnly: boolean; onDelete: (id: string) => void }) {
  if (!entries) return <p className="p-6 text-sm text-ink-dim">Loading…</p>;
  if (entries.length === 0) {
    return <p className="p-6 text-sm text-ink-dim">Nothing logged yet. Each &ldquo;Log service&rdquo; on the schedule lands here with its cost and garage.</p>;
  }
  const total = entries.reduce((s, e) => s + (e.cost_ngn ?? 0), 0);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-canvas text-xs uppercase tracking-wider text-ink-dim whitespace-nowrap">
            <tr>
              <th className="px-5 py-2.5">Date</th>
              <th className="px-3 py-2.5">Vehicle</th>
              <th className="px-3 py-2.5">Service</th>
              <th className="px-3 py-2.5">Odometer</th>
              <th className="px-3 py-2.5">Cost</th>
              <th className="px-3 py-2.5">Garage</th>
              <th className="px-3 py-2.5">Notes</th>
              <th className="px-3 py-2.5">Logged by</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-divider text-ink-mid">
            {entries.map((e) => (
              <tr key={e.id} className="hover:bg-panel-hover">
                <td className="px-5 py-3 whitespace-nowrap text-ink">{lagosDate(e.done_at)}</td>
                <td className="px-3 py-3 font-medium text-brand">{e.license_plate}</td>
                <td className="px-3 py-3 text-ink">{e.label}</td>
                <td className="px-3 py-3 font-mono">{e.odometer_km != null ? formatOdometerMiles(e.odometer_km) : '—'}</td>
                <td className="px-3 py-3 font-mono">{e.cost_ngn != null ? formatNgn(e.cost_ngn) : '—'}</td>
                <td className="px-3 py-3">{e.garage ?? '—'}</td>
                <td className="max-w-[240px] truncate px-3 py-3 text-xs" title={e.notes ?? undefined}>{e.notes ?? '—'}</td>
                <td className="px-3 py-3 text-xs text-ink-dim">{e.created_by ?? '—'}</td>
                <td className="px-3 py-3 text-right">
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Delete this history entry?')) onDelete(e.id);
                      }}
                      className="rounded p-1 text-ink-dim hover:text-bad"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-edge px-5 py-3 text-xs text-ink-dim">
        {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · {formatNgn(total)} in total
      </p>
    </>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <button type="button" className="fixed inset-0 z-40 bg-black/50" aria-label="Close" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-edge bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-ink">{title}</p>
            {subtitle && <p className="mt-0.5 text-xs text-ink-dim">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-mid hover:bg-divider" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

function SubmitRow({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-lg border border-edge px-3 py-2 text-xs text-ink-mid hover:bg-panel-hover">
        Cancel
      </button>
      <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-good px-4 py-2 text-xs font-semibold text-accent-y-ink disabled:opacity-50">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {label}
      </button>
    </div>
  );
}

function LogServiceModal({ item, currentKm, onClose, onSaved }: { item: MaintenanceItem; currentKm: number | null; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(todayInput());
  const [odoMiles, setOdoMiles] = useState(currentKm != null ? String(Math.round(currentKm * KM_TO_MILES)) : '');
  const [cost, setCost] = useState('');
  const [garage, setGarage] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await completeMaintenance(item.id, {
        at_km: odoMiles.trim() ? Math.round(milesToKm(Number(odoMiles))) : null,
        done_at: date ? new Date(`${date}T12:00:00`).toISOString() : null,
        cost_ngn: cost.trim() ? Number(cost) : null,
        garage: garage.trim() || null,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Log service · ${item.label}`} subtitle={`${item.license_plate} — restarts the countdown from here and adds a history entry.`} onClose={onClose}>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-ink-mid">
          Date
          <input type="date" required value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} className={INPUT} />
        </label>
        <label className="text-xs text-ink-mid">
          Odometer (mi)
          <input type="number" min="0" value={odoMiles} onChange={(e) => setOdoMiles(e.target.value)} className={INPUT} placeholder="from the dashboard" />
        </label>
        <label className="text-xs text-ink-mid">
          Cost (₦) <span className="text-ink-dim">(optional)</span>
          <input type="number" min="0" step="1" value={cost} onChange={(e) => setCost(e.target.value)} className={INPUT} />
        </label>
        <label className="text-xs text-ink-mid">
          Garage <span className="text-ink-dim">(optional)</span>
          <input value={garage} onChange={(e) => setGarage(e.target.value)} className={INPUT} maxLength={160} />
        </label>
        <label className="text-xs text-ink-mid sm:col-span-2">
          Notes <span className="text-ink-dim">(optional — parts, what was found)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={INPUT} maxLength={2000} />
        </label>
        {err && <p className="text-xs text-bad sm:col-span-2">{err}</p>}
        <div className="sm:col-span-2">
          <SubmitRow busy={busy} label="Log service" onCancel={onClose} />
        </div>
      </form>
    </Modal>
  );
}

function EditScheduleModal({ item, onClose, onSaved }: { item: MaintenanceItem; onClose: () => void; onSaved: () => void }) {
  const [intMiles, setIntMiles] = useState(item.interval_km != null ? String(Math.round(item.interval_km * KM_TO_MILES)) : '');
  const [intDays, setIntDays] = useState(item.interval_days != null ? String(item.interval_days) : '');
  const [lastDate, setLastDate] = useState(dateInput(item.last_service_at));
  const [lastMiles, setLastMiles] = useState(item.last_service_km != null ? String(Math.round(item.last_service_km * KM_TO_MILES)) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intMiles.trim() && !intDays.trim()) {
      setErr('Keep at least one of distance or time.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await updateMaintenance(item.id, {
        interval_km: intMiles.trim() ? Math.round(milesToKm(Number(intMiles))) : null,
        interval_days: intDays.trim() ? Number(intDays) : null,
        last_service_km: lastMiles.trim() ? Math.round(milesToKm(Number(lastMiles))) : null,
        last_service_at: lastDate ? new Date(`${lastDate}T12:00:00`).toISOString() : null,
      });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit · ${item.label}`} subtitle={`${item.license_plate}. Changing "last done" restarts the countdown from there.`} onClose={onClose}>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-ink-mid">
          Every (mi)
          <input type="number" min="0" value={intMiles} onChange={(e) => setIntMiles(e.target.value)} className={INPUT} placeholder="blank = time only" />
        </label>
        <label className="text-xs text-ink-mid">
          Or every (days)
          <input type="number" min="0" value={intDays} onChange={(e) => setIntDays(e.target.value)} className={INPUT} placeholder="blank = distance only" />
        </label>
        <label className="text-xs text-ink-mid">
          Last done on
          <input type="date" value={lastDate} max={todayInput()} onChange={(e) => setLastDate(e.target.value)} className={INPUT} />
        </label>
        <label className="text-xs text-ink-mid">
          Last done at (mi)
          <input type="number" min="0" value={lastMiles} onChange={(e) => setLastMiles(e.target.value)} className={INPUT} />
        </label>
        {err && <p className="text-xs text-bad sm:col-span-2">{err}</p>}
        <div className="sm:col-span-2">
          <SubmitRow busy={busy} label="Save" onCancel={onClose} />
        </div>
      </form>
    </Modal>
  );
}

function AddItemModal({
  vehicle,
  vehicleId,
  catalogue,
  existing,
  onClose,
  onSaved,
}: {
  vehicle: FleetVehicle | undefined;
  vehicleId: string;
  catalogue: ServiceDefinition[];
  existing: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const available = catalogue.filter((c) => !existing.has(c.kind));
  const [kind, setKind] = useState(available[0]?.kind ?? '__custom__');
  const [custom, setCustom] = useState('');
  const def = catalogue.find((c) => c.kind === kind);
  const [intMiles, setIntMiles] = useState(def?.intervalKm != null ? String(Math.round(def.intervalKm * KM_TO_MILES)) : '');
  const [intDays, setIntDays] = useState(def?.intervalDays != null ? String(def.intervalDays) : '');
  const [lastDate, setLastDate] = useState('');
  const currentKm = currentKmOf(vehicle);
  const [lastMiles, setLastMiles] = useState(currentKm != null ? String(Math.round(currentKm * KM_TO_MILES)) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = (k: string) => {
    setKind(k);
    const d = catalogue.find((c) => c.kind === k);
    setIntMiles(d?.intervalKm != null ? String(Math.round(d.intervalKm * KM_TO_MILES)) : '');
    setIntDays(d?.intervalDays != null ? String(d.intervalDays) : '');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalKind = kind === '__custom__' ? custom.trim().toLowerCase().replace(/\s+/g, '_') : kind;
    if (!finalKind) return setErr('Name the item.');
    if (!intMiles.trim() && !intDays.trim()) return setErr('Give a distance or a time interval.');
    setBusy(true);
    setErr(null);
    try {
      await createMaintenance({
        vehicleId,
        kind: finalKind,
        intervalKm: intMiles.trim() ? Math.round(milesToKm(Number(intMiles))) : null,
        intervalDays: intDays.trim() ? Number(intDays) : null,
        lastServiceKm: lastMiles.trim() ? Math.round(milesToKm(Number(lastMiles))) : null,
        lastServiceAt: lastDate ? new Date(`${lastDate}T12:00:00`).toISOString() : null,
      });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Add service item · ${vehicle?.license_plate ?? ''}`} subtitle="Pick from the catalogue and the interval fills in; adjust it if the manual says otherwise." onClose={onClose}>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-ink-mid sm:col-span-2">
          Item
          <select value={kind} onChange={(e) => pick(e.target.value)} className={INPUT}>
            {available.map((c) => (
              <option key={c.kind} value={c.kind}>
                {c.label}
              </option>
            ))}
            <option value="__custom__">Something else…</option>
          </select>
          {def && <span className="mt-1 block text-[11px] text-ink-dim">{def.what}</span>}
        </label>
        {kind === '__custom__' && (
          <label className="text-xs text-ink-mid sm:col-span-2">
            Name
            <input value={custom} onChange={(e) => setCustom(e.target.value)} className={INPUT} placeholder="e.g. Clutch" required />
          </label>
        )}
        <label className="text-xs text-ink-mid">
          Every (mi)
          <input type="number" min="0" value={intMiles} onChange={(e) => setIntMiles(e.target.value)} className={INPUT} placeholder="blank = time only" />
        </label>
        <label className="text-xs text-ink-mid">
          Or every (days)
          <input type="number" min="0" value={intDays} onChange={(e) => setIntDays(e.target.value)} className={INPUT} placeholder="blank = distance only" />
        </label>
        <label className="text-xs text-ink-mid">
          Last done on <span className="text-ink-dim">(if known)</span>
          <input type="date" value={lastDate} max={todayInput()} onChange={(e) => setLastDate(e.target.value)} className={INPUT} />
        </label>
        <label className="text-xs text-ink-mid">
          Last done at (mi)
          <input type="number" min="0" value={lastMiles} onChange={(e) => setLastMiles(e.target.value)} className={INPUT} />
        </label>
        {err && <p className="text-xs text-bad sm:col-span-2">{err}</p>}
        <div className="sm:col-span-2">
          <SubmitRow busy={busy} label="Add item" onCancel={onClose} />
        </div>
      </form>
    </Modal>
  );
}

function AnchorModal({ target, onClose, onSaved }: { target: { id: string; plate: string }; onClose: () => void; onSaved: () => void }) {
  const [milesNow, setMilesNow] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const m = Number(milesNow);
    if (!(m > 0)) return setErr('Type the mileage showing on the dashboard.');
    setBusy(true);
    setErr(null);
    try {
      await setVehicleOdometer(target.id, Math.round(milesToKm(m)));
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Anchor odometer · ${target.plate}`} subtitle="Read the total mileage off the dashboard right now. From then on the tracker keeps it current." onClose={onClose}>
      <form onSubmit={submit} className="mt-4">
        <label className="text-xs text-ink-mid">
          Dashboard reading (mi)
          <input type="number" min="1" autoFocus value={milesNow} onChange={(e) => setMilesNow(e.target.value)} className={INPUT} />
        </label>
        {err && <p className="mt-2 text-xs text-bad">{err}</p>}
        <SubmitRow busy={busy} label="Anchor" onCancel={onClose} />
      </form>
    </Modal>
  );
}
