'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  CarFront,
  Gauge,
  MapPin,
  PlugZap,
  Radio,
  Route,
  ShieldAlert,
  Play,
  Timer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  api,
  formatNgn,
  BehaviorVehicle,
  DeviceEvent,
  DeviceEventsResponse,
  DeviceEventsSummary,
} from '@/lib/api';
import { EventReplayPanel } from '@/components/dashboard/EventReplayPanel';
import { ReplayTarget } from '@/lib/replay-target';
import { parseServerTime } from '@/lib/map-utils';
import { formatHoursShort, formatMinutes } from '@/lib/duration';

// A harsh brake or a swerve is a claim about how someone drove. Replaying the
// surrounding telemetry is what turns it into something you can discuss with
// the driver rather than a number to wave at them.
const REPLAYABLE_TYPES = new Set([
  'harsh_braking',
  'harsh_cornering',
  'harsh_acceleration',
  'overspeeding',
  'crash',
]);

const REFRESH_MS = 30000;

type EventFilter = 'attention' | 'all' | 'driving' | 'security' | 'power' | 'trips';

const DRIVING_TYPES = new Set([
  'harsh_acceleration',
  'harsh_braking',
  'harsh_cornering',
  'overspeeding',
  'idling_start',
  'idling_end',
]);
/**
 * Tracker supply events. Split out of SECURITY_TYPES because a unit wired to
 * a switched circuit loses power at every ignition-off — three times in one
 * morning on the reference vehicle — and listing that under a driver's name
 * on a Driving behaviour screen reads as an accusation of tampering against
 * someone who only turned the engine off. It is the tracker's health.
 */
const POWER_TYPES = new Set(['power_unplug', 'power_dropout', 'power_restored']);

const SECURITY_TYPES = new Set([
  'towing',
  'crash',
  'jamming_start',
  'jamming_end',
  'geofence_enter',
  'geofence_exit',
]);
const TRIP_TYPES = new Set(['trip_start', 'trip_stop']);

/** The two edges the device sends for one idle spell. Counted once, not twice. */
const IDLE_COUNT_TYPES = new Set(['idling_start', 'idling_end']);

// Raw ignition and trip edges are how the tracker talks, not what a manager
// needs to see. They stay available under "Everything" but never lead the feed.
const HOUSEKEEPING_TYPES = new Set([
  'ignition_on',
  'ignition_off',
  'trip_start',
  'trip_stop',
]);

const HARSH_TYPES = ['harsh_acceleration', 'harsh_braking', 'harsh_cornering'];

/**
 * Only used if the API response predates `score_weights`. Kept in step with
 * SCORE_WEIGHTS in device-events.routes.ts.
 */
const DEFAULT_SCORE_WEIGHTS: Record<string, number> = {
  crash: 25,
  harsh_braking: 2,
  harsh_acceleration: 2,
  harsh_cornering: 1,
  overspeeding: 2,
};

/** An idle spell shorter than this is a junction or a queue, not a habit. */
const IDLE_ATTENTION_MINUTES = 10;
const IDLE_BURN_LPH_FALLBACK = 0.9;

const EVENT_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  harsh_acceleration: { label: 'Harsh acceleration', icon: TrendingUp },
  harsh_braking: { label: 'Harsh braking', icon: TrendingDown },
  harsh_cornering: { label: 'Harsh cornering', icon: Activity },
  overspeeding: { label: 'Overspeeding', icon: Gauge },
  idling_start: { label: 'Idling started', icon: Timer },
  idling_end: { label: 'Idling ended', icon: Timer },
  towing: { label: 'Towing detected', icon: AlertTriangle },
  crash: { label: 'Crash detected', icon: AlertTriangle },
  jamming_start: { label: 'Signal jamming', icon: Radio },
  jamming_end: { label: 'Jamming ended', icon: Radio },
  power_unplug: { label: 'Tracker unplugged', icon: PlugZap },
  power_dropout: { label: 'Tracker power dropout', icon: PlugZap },
  power_restored: { label: 'Power restored', icon: PlugZap },
  trip_start: { label: 'Trip started', icon: Route },
  trip_stop: { label: 'Trip ended', icon: Route },
  geofence_enter: { label: 'Entered geofence', icon: MapPin },
  geofence_exit: { label: 'Left geofence', icon: MapPin },
};

const eventLabel = (type: string) =>
  EVENT_META[type]?.label ??
  type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const SEVERITY_STYLES: Record<string, string> = {
  info: 'border-l-edge bg-canvas',
  // A flat saturated orange card is the single most recognisable
  // "AI-generated dashboard" tell — flag events get a duller, warmer copper
  // and a thin border only, not a full tinted wash.
  warning: 'border-l-flag bg-canvas',
  critical: 'border-l-bad bg-bad-deep/20',
};

const GRADE_STYLES: Record<string, string> = {
  A: 'bg-good/20 text-good',
  B: 'bg-good/15 text-good',
  C: 'bg-warn/20 text-warn',
  D: 'bg-warn/25 text-warn',
  F: 'bg-bad/20 text-bad',
};

type FeedItem = {
  id: string;
  eventType: string;
  label: string;
  vehicleId: string | null;
  plate: string;
  driverName: string | null;
  occurredAt: string;
  severity: string;
  latitude: number | null;
  longitude: number | null;
  detail: string | null;
  /** Set for merged idle spells so the row can lead with the duration. */
  idleMinutes?: number;
  idleLiters?: number;
  needsAttention: boolean;
};

/**
 * The device reports edges — idling started, idling ended, ignition on, ignition
 * off. Rendering them one per row produced a feed that was technically complete
 * and operationally useless. This pairs each idle spell into a single row that
 * leads with how long the engine ran while parked, and marks the housekeeping
 * edges so they can be kept out of the default view.
 */
function buildFeed(events: DeviceEvent[], idleBurnLph: number): FeedItem[] {
  const chronological = [...events].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
  const openIdle = new Map<string, DeviceEvent>();
  const items: FeedItem[] = [];

  const base = (e: DeviceEvent) => ({
    vehicleId: e.vehicle_id ?? null,
    plate: e.license_plate ?? 'Unknown',
    driverName: e.driver_name ?? null,
    severity: e.severity,
    latitude: e.latitude != null ? Number(e.latitude) : null,
    longitude: e.longitude != null ? Number(e.longitude) : null,
  });

  // The last power loss per vehicle, so its restore can say how long it was.
  const openPowerLoss = new Map<string, DeviceEvent>();

  for (const e of chronological) {
    const key = e.vehicle_id ?? 'unknown';

    if (e.event_type === 'power_unplug' || e.event_type === 'power_dropout') {
      openPowerLoss.set(key, e);
    }
    if (e.event_type === 'power_restored') {
      const loss = openPowerLoss.get(key);
      openPowerLoss.delete(key);
      if (loss) {
        const minutes =
          (new Date(e.occurred_at).getTime() - new Date(loss.occurred_at).getTime()) / 60000;
        items.push({
          ...base(e),
          id: String(e.id),
          eventType: e.event_type,
          label: `Power restored · after ${formatMinutes(Math.max(1, minutes))} ${
            loss.event_type === 'power_dropout' ? 'without supply' : 'unplugged'
          }`,
          occurredAt: e.occurred_at,
          detail: eventValueDetail(e),
          needsAttention: false,
        });
        continue;
      }
    }

    if (e.event_type === 'idling_start') {
      openIdle.set(key, e);
      continue;
    }

    if (e.event_type === 'idling_end') {
      const start = openIdle.get(key);
      openIdle.delete(key);
      if (!start) continue;
      // The detector writes the minutes it actually WATCHED onto the end
      // event, each gap between frames capped. Re-deriving them from the two
      // timestamps here would undo that: a tracker that goes quiet mid-idle
      // and wakes hours later would be shown as an engine that ran for hours.
      // Only fall back to wall-clock for rows written before the detector
      // carried a value.
      const reported = Number(e.value);
      const minutes =
        e.unit === 'min' && Number.isFinite(reported) && reported > 0
          ? reported
          : (new Date(e.occurred_at).getTime() - new Date(start.occurred_at).getTime()) / 60000;
      if (minutes <= 0) continue;
      const liters = (minutes / 60) * idleBurnLph;
      items.push({
        ...base(start),
        id: `idle-${start.id}`,
        eventType: 'idling',
        label: `Idled ${formatMinutes(minutes)}`,
        occurredAt: start.occurred_at,
        detail: `Engine running while stationary · ≈${liters.toFixed(2)} L burned`,
        idleMinutes: minutes,
        idleLiters: liters,
        needsAttention: minutes >= IDLE_ATTENTION_MINUTES,
      });
      continue;
    }

    items.push({
      ...base(e),
      id: String(e.id),
      eventType: e.event_type,
      label: eventLabel(e.event_type),
      occurredAt: e.occurred_at,
      detail: eventValueDetail(e),
      needsAttention:
        !HOUSEKEEPING_TYPES.has(e.event_type) &&
        // Tracker power is chased by whoever fits the trackers, not by the
        // manager reviewing a driver, so it stays out of "needs attention".
        !POWER_TYPES.has(e.event_type) &&
        (e.severity !== 'info' || SECURITY_TYPES.has(e.event_type)),
    });
  }

  // An idle spell still running when the window ends is real and worth showing.
  for (const start of openIdle.values()) {
    items.push({
      ...base(start),
      id: `idle-open-${start.id}`,
      eventType: 'idling',
      label: 'Idling started',
      occurredAt: start.occurred_at,
      detail: 'Still idling at the end of this window',
      needsAttention: true,
    });
  }

  return items.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
}

function eventValueDetail(e: DeviceEvent): string | null {
  if (e.value == null) return null;
  if (e.unit === 'g') return `${Number(e.value).toFixed(2)} g`;
  if (e.unit === 'km/h') return `${Math.round(Number(e.value))} km/h`;
  return null;
}

function formatHours(hours: number | null | undefined): string {
  if (hours == null) return '—';
  return formatHoursShort(hours);
}

function scoreBarColor(score: number) {
  if (score >= 80) return 'bg-good';
  if (score >= 60) return 'bg-warn';
  return 'bg-bad';
}

type DriverChip = {
  key: string;
  label: string;
  /** Points this cost the driver, if any. */
  points: number;
  tone: string;
};

/**
 * Turns a vehicle's raw event tally into chips a fleet manager can read.
 *
 * Three things were wrong with printing `v.counts` directly. The tracker
 * reports an idle as two rows, so nine idle spells appeared as "Idling
 * started x 9" AND "Idling ended x 9" — eighteen chips' worth of alarm for
 * nine kettles' worth of fuel, and the same spell counted twice. Tracker
 * supply events sat in the same row as driver conduct. And nothing said what
 * any of it cost, so the 73 at the end of the row was a number the manager had
 * to take on faith. Now the chips that cost points say so and lead, idling is
 * one chip carrying its hours, and device health has left the row entirely.
 */
function buildDriverChips(
  v: BehaviorVehicle,
  weights: Record<string, number>
): DriverChip[] {
  const chips: DriverChip[] = [];

  for (const [type, count] of Object.entries(v.counts)) {
    if (!count) continue;
    if (IDLE_COUNT_TYPES.has(type)) continue;
    if (POWER_TYPES.has(type)) continue;
    const weight = weights[type] ?? 0;
    chips.push({
      key: type,
      label: `${eventLabel(type)} × ${count}`,
      points: weight * count,
      tone:
        weight > 0
          ? 'border-flag/40 bg-flag/10 text-flag'
          : 'border-edge bg-canvas text-ink-mid',
    });
  }

  // A spell is one idle, however many edges the device sent for it. Prefer the
  // ends — those are the spells that actually finished inside the window.
  const spells = v.counts.idling_end || v.counts.idling_start || 0;
  if (spells > 0 || (v.idle_hours ?? 0) > 0) {
    const parts = [`Idled × ${spells}`];
    if (v.idle_hours) parts.push(formatHours(v.idle_hours));
    if (v.idle_fuel_ngn) parts.push(formatNgn(v.idle_fuel_ngn));
    chips.push({
      key: 'idling',
      label: parts.join(' · '),
      points: 0,
      tone:
        (v.idle_hours ?? 0) >= 1
          ? 'border-warn/40 bg-warn/10 text-warn'
          : 'border-edge bg-canvas text-ink-mid',
    });
  }

  // Costliest first: the row should open with whatever moved the score.
  return chips.sort((a, b) => b.points - a.points);
}

function StatTile({
  label,
  value,
  hint,
  tone = 'text-ink',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-dim">{label}</p>
      <p className={`mt-0.5 text-xl font-bold ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-ink-dim">{hint}</p>}
    </div>
  );
}

export function countCriticalDeviceEvents(summary: DeviceEventsSummary | null): number {
  return summary?.fleet.security_events ?? 0;
}

export function DrivingBehaviorPanel() {
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<DeviceEventsSummary | null>(null);
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [filter, setFilter] = useState<EventFilter>('attention');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replayTarget, setReplayTarget] = useState<ReplayTarget | null>(null);

  const load = useCallback(async () => {
    try {
      // Driving events are fetched on their own. In one list capped at 150,
      // a busy week's ignition, trip and idle edges crowded them out — 11
      // harsh events in the summary, 2 in the list.
      const [summaryData, eventsData, drivingData] = await Promise.all([
        api<DeviceEventsSummary>(`/device-events/summary?days=${days}`),
        api<DeviceEventsResponse>(`/device-events?days=${days}&limit=150`),
        api<DeviceEventsResponse>(`/device-events?days=${days}&limit=500&type=driving`),
      ]);
      setSummary(summaryData);
      const byId = new Map(eventsData.events.map((e) => [e.id, e]));
      for (const e of drivingData.events) byId.set(e.id, e);
      setEvents(
        [...byId.values()].sort(
          (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
        )
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load device events');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  /** The "now" the fortnight grouping counts back from, fixed at mount. */
  const [groupingEpoch] = useState(() => Date.now());

  const feed = useMemo(
    () => buildFeed(events, summary?.idle_burn_liters_per_hour ?? IDLE_BURN_LPH_FALLBACK),
    [events, summary]
  );

  const filteredEvents = useMemo(() => {
    if (filter === 'all') return feed;
    if (filter === 'attention') return feed.filter((e) => e.needsAttention);
    if (filter === 'driving') {
      return feed.filter((e) => DRIVING_TYPES.has(e.eventType) || e.eventType === 'idling');
    }
    const set =
      filter === 'security' ? SECURITY_TYPES : filter === 'power' ? POWER_TYPES : TRIP_TYPES;
    return feed.filter((e) => set.has(e.eventType));
  }, [feed, filter]);

  /**
   * The feed as a flat reverse-chronological list made it hard to answer the
   * question a manager actually has — is this driver getting better or worse —
   * because one driver's events were interleaved with everyone else's and with
   * every other week. Grouping into fortnights, and by driver inside each,
   * turns the same rows into a comparison.
   *
   * Fortnights are counted back from today rather than pinned to the calendar,
   * so the most recent group is always "the last two weeks" no matter which day
   * it is read on.
   *
   * "Today" is pinned once when the panel mounts. Reading `Date.now()` inside
   * the memo made the grouping depend on the moment React happened to
   * recompute it: the same events could land in different fortnights between
   * two renders, and the boundary could slide under the reader mid-session.
   */
  const groupedEvents = useMemo(() => {
    const FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000;
    const now = groupingEpoch;

    const groups = new Map<
      string,
      { key: string; index: number; driver: string; start: Date; end: Date; items: FeedItem[] }
    >();

    for (const item of filteredEvents) {
      const at = new Date(item.occurredAt).getTime();
      // 0 = the current fortnight, 1 = the one before it, and so on.
      const index = Math.max(0, Math.floor((now - at) / FORTNIGHT_MS));
      const driver = item.driverName?.trim() || 'Unassigned';
      const key = `${index}::${driver}`;

      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          index,
          driver,
          start: new Date(now - (index + 1) * FORTNIGHT_MS),
          end: new Date(now - index * FORTNIGHT_MS),
          items: [],
        };
        groups.set(key, group);
      }
      group.items.push(item);
    }

    // Most recent fortnight first; inside a fortnight, the busiest driver
    // first, since that is the one worth looking at.
    return [...groups.values()].sort(
      (a, b) => a.index - b.index || b.items.length - a.items.length
    );
  }, [filteredEvents, groupingEpoch]);

  const mutedCount = feed.length - feed.filter((e) => e.needsAttention).length;

  // The server's own weights, so a chip that says a harsh brake cost 2 points
  // and the score that deducted it cannot drift apart.
  const scoreWeights = useMemo(
    () => summary?.score_weights ?? DEFAULT_SCORE_WEIGHTS,
    [summary]
  );

  const { harshTotal, harshPenalty } = useMemo(() => {
    const counts = summary?.fleet.counts_by_type ?? {};
    let total = 0;
    let penalty = 0;
    for (const type of HARSH_TYPES) {
      const n = counts[type] ?? 0;
      total += n;
      penalty += n * (scoreWeights[type] ?? 0);
    }
    return { harshTotal: total, harshPenalty: penalty };
  }, [summary, scoreWeights]);

  const vehiclesWithData = useMemo(
    () => (summary?.vehicles ?? []).filter((v) => v.total_events > 0 || v.distance_km > 0),
    [summary]
  );

  if (loading) {
    return (
      <div className="rounded-lg border border-edge bg-panel p-6 text-sm text-ink-dim">
        Loading driving behavior…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {replayTarget && (
        <EventReplayPanel target={replayTarget} onClose={() => setReplayTarget(null)} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">Driving behavior &amp; device events</h2>
          <p className="mt-1 text-xs text-ink-dim">
            Decoded from what the tracker actually reports — no fuel sensor required.{' '}
            <Link
              href="/documentation/signals"
              className="text-brand underline decoration-dotted underline-offset-2"
            >
              Which signals exist
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-lg border px-3 py-1.5 text-xs ${
                days === d
                  ? 'border-good bg-good/10 text-good'
                  : 'border-edge bg-panel text-ink-mid hover:bg-panel-hover'
              }`}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-warn/40 bg-warn-deep/20 p-4 text-sm text-warn">
          {error}
        </div>
      )}

      {/* Four tiles, not six. "Events recorded: 151" counted every ignition
          turn the tracker ever sent and told a manager nothing he could act
          on, and tracker power is the fitter's problem — it now has its own
          line below instead of a headline slot beside driver conduct. What is
          left is the four things a fleet manager can actually do something
          about this week. */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Fleet safety score"
          value={
            summary?.fleet.avg_score != null
              ? `${summary.fleet.avg_score}/100`
              : '—'
          }
          hint={
            harshTotal > 0
              ? `${harshTotal} harsh manoeuvre${harshTotal === 1 ? '' : 's'} cost ${harshPenalty} points`
              : 'Nothing deducted this period'
          }
          tone={
            summary?.fleet.avg_score != null
              ? summary.fleet.avg_score >= 80
                ? 'text-good'
                : summary.fleet.avg_score >= 60
                  ? 'text-warn'
                  : 'text-bad'
              : 'text-ink'
          }
        />
        {/* Idling leads with money. Hours and litres are the workings; the
            naira figure is the only part a manager repeats to a driver. */}
        <StatTile
          label="Fuel burned idling"
          value={
            summary?.fleet.idle_fuel_ngn
              ? formatNgn(summary.fleet.idle_fuel_ngn)
              : formatHours(summary?.fleet.idle_hours)
          }
          hint={
            (summary?.fleet.idle_hours ?? 0) > 0
              ? `${formatHours(summary?.fleet.idle_hours)} parked with the engine running · ≈${(summary?.fleet.idle_fuel_liters ?? 0).toFixed(1)} L`
              : 'No engine-on standing time this period'
          }
          tone={(summary?.fleet.idle_hours ?? 0) >= 1 ? 'text-warn' : 'text-ink'}
        />
        <StatTile
          label="Harsh driving"
          value={String(harshTotal)}
          hint={
            harshTotal > 0
              ? 'Heavy acceleration, braking and cornering — the driver’s own habits'
              : 'None recorded'
          }
          tone={harshTotal > 0 ? 'text-flag' : 'text-good'}
        />
        <StatTile
          label="Security"
          value={
            (summary?.fleet.security_events ?? 0) > 0
              ? String(summary?.fleet.security_events)
              : 'All clear'
          }
          hint="Towing, crash, signal jamming or leaving a geofence"
          tone={(summary?.fleet.security_events ?? 0) > 0 ? 'text-bad' : 'text-good'}
        />
      </div>

      {/* Tracker health, stated as the fitter's job. It used to sit in the
          tile row reading "Tracker power 11" next to driving figures, which
          invited the manager to read it as something a driver did. */}
      {(summary?.fleet.power_events ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-panel px-4 py-2.5 text-xs text-ink-mid">
          <PlugZap className="h-3.5 w-3.5 shrink-0 text-ink-dim" />
          <span>
            <span className="font-medium text-ink">
              Tracker lost power {summary?.fleet.power_events} times
            </span>{' '}
            in {days} days. Normal when the unit is wired to a circuit that
            switches off with the ignition — a job for whoever fits the
            trackers, and nothing to do with how anyone drove.
          </span>
        </div>
      )}

      <div className="rounded-lg border border-edge bg-panel">
        <div className="border-b border-edge px-6 py-4">
          <h3 className="text-sm font-semibold text-ink">Driver scores</h3>
          <p className="mt-0.5 text-xs text-ink-dim">
            Every driver starts at 100 and loses points only for things they
            chose to do:{' '}
            <span className="text-ink-mid">
              2 for a harsh acceleration or a harsh brake, 1 for hard cornering,
              2 for overspeeding, 25 for a crash
            </span>
            . Idling costs nothing yet — the hours are shown so you can talk
            about the fuel, but they are not charged to anyone while we finish
            proving the measurement. Add the deductions under a driver&apos;s
            name and you get their score.
          </p>
        </div>
        {vehiclesWithData.length === 0 ? (
          <p className="px-6 py-8 text-sm text-ink-dim">
            No scenario events. These are computed inside the tracker and only sent when
            the Eco/Green Driving, Overspeeding and Idling scenarios are switched on in its
            configuration — this fleet&apos;s devices have them off, so nothing arrives to
            score.{' '}
            <Link
              href="/documentation/signals#scenario-events"
              className="text-brand underline decoration-dotted underline-offset-2"
            >
              What it takes to enable them
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-edge">
            {vehiclesWithData.map((v: BehaviorVehicle) => (
              <li key={v.vehicle_id} className="px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <CarFront className="h-5 w-5 text-ink-dim" />
                    <div>
                      <p className="font-medium text-ink">{v.license_plate ?? 'Unknown'}</p>
                      {/* Idling moved into its own chip below, where it
                          carries the spells, the hours and the money together
                          instead of being repeated in two places. */}
                      <p className="text-xs text-ink-dim">
                        {v.driver_name ?? 'Unassigned'} · {v.distance_km} km driven
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {v.security_events > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-bad/20 px-2 py-0.5 text-xs text-bad">
                        <ShieldAlert className="h-3 w-3" /> {v.security_events} security
                      </span>
                    )}
                    {/* Neutral, and worded as the tracker's problem — it sits
                        beside a driver's name, and a supply that drops at every
                        ignition-off is a wiring job, not a driver to question. */}
                    {(v.power_events ?? 0) > 0 && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-ink-dim/15 px-2 py-0.5 text-xs text-ink-mid"
                        title="The tracker lost power. Usually means it is wired to a switched circuit rather than permanent battery — a fitting issue, not the driver."
                      >
                        <PlugZap className="h-3 w-3" /> tracker power ×{v.power_events}
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${GRADE_STYLES[v.grade] ?? 'bg-ink-dim/20 text-ink-mid'}`}
                    >
                      {v.grade}
                    </span>
                    <span className="w-14 text-right font-mono text-sm text-ink">
                      {v.score}/100
                    </span>
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
                  <div
                    className={`h-full rounded-full ${scoreBarColor(v.score)}`}
                    style={{ width: `${v.score}%` }}
                  />
                </div>
                {(() => {
                  const chips = buildDriverChips(v, scoreWeights);
                  const charged = chips.filter((c) => c.points > 0);
                  const deducted = charged.reduce((sum, c) => sum + c.points, 0);
                  if (chips.length === 0) return null;
                  return (
                    <>
                      {/* The arithmetic, spelled out. A score a manager cannot
                          reproduce is a score he will not repeat to a driver. */}
                      {charged.length > 0 && (
                        <p className="mt-2 font-mono text-[11px] text-ink-dim">
                          100
                          {charged.map((c) => (
                            <span key={c.key}> − {c.points} {c.key.replace(/^harsh_/, '')}</span>
                          ))}{' '}
                          = <span className="text-ink-mid">{Math.max(0, 100 - deducted)}</span>
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {chips.map((c) => (
                          <span
                            key={c.key}
                            className={`rounded-full border px-2 py-0.5 text-xs ${c.tone}`}
                          >
                            {c.label}
                            {c.points > 0 && (
                              <span className="ml-1 font-mono opacity-80">−{c.points} pts</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-edge bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-6 py-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Event feed</h3>
            <p className="mt-0.5 text-xs text-ink-dim">
              {filter === 'attention' && mutedCount > 0
                ? `${mutedCount} ignition and trip edges hidden — switch to Everything to see them`
                : 'Idle spells are merged into one row with the time the engine ran'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['attention', 'Needs attention'],
                ['driving', 'Driving'],
                ['security', 'Security'],
                ['power', 'Tracker power'],
                ['trips', 'Trips'],
                ['all', 'Everything'],
              ] as [EventFilter, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  filter === id
                    ? 'border-good bg-good/10 text-good'
                    : 'border-edge bg-canvas text-ink-mid hover:bg-panel-hover'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {filteredEvents.length === 0 ? (
          <p className="px-6 py-8 text-sm text-ink-dim">
            {filter === 'attention'
              ? 'Nothing needs attention in this window. Switch to Everything to see the raw device feed.'
              : 'No events in this window.'}
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto">
            {groupedEvents.map((group) => (
              <section key={group.key}>
                {/* Sticky so the driver and fortnight a row belongs to stay
                    visible while scrolling a long group — otherwise the
                    grouping is lost the moment the header scrolls away. */}
                <header className="sticky top-0 z-10 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-y border-edge bg-panel-deep/95 px-6 py-2 backdrop-blur">
                  <span className="text-sm font-semibold text-ink">{group.driver}</span>
                  <span className="text-[11px] text-ink-dim">
                    {group.index === 0 ? 'Last 2 weeks' : `${group.start.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })} – ${group.end.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}`}
                    {' · '}
                    {group.items.length} event{group.items.length === 1 ? '' : 's'}
                  </span>
                </header>
                <ul className="divide-y divide-edge">
                  {group.items.map((item) => {
              const Icon =
                item.eventType === 'idling' ? Timer : EVENT_META[item.eventType]?.icon ?? Activity;
              const tone =
                item.severity === 'critical'
                  ? 'text-bad'
                  : item.eventType === 'idling'
                    ? 'text-warn'
                    : item.severity === 'warning'
                      ? 'text-flag'
                      : 'text-ink-dim';
              return (
                <li
                  key={item.id}
                  className={`flex flex-wrap items-center justify-between gap-2 border-l-2 px-6 py-3 ${
                    SEVERITY_STYLES[item.severity] ?? SEVERITY_STYLES.info
                  } ${item.needsAttention ? '' : 'opacity-60'}`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel ${tone}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm text-ink">
                        <span className="font-medium">{item.plate}</span>
                        {' · '}
                        <span className={item.eventType === 'idling' ? 'text-warn' : undefined}>
                          {item.label}
                        </span>
                      </p>
                      {item.detail && (
                        <p className="text-xs text-ink-mid">{item.detail}</p>
                      )}
                      <p className="text-xs text-ink-dim">
                        {new Date(item.occurredAt).toLocaleString()}
                        {item.driverName ? ` · ${item.driverName}` : ''}
                        {item.latitude != null && item.longitude != null && (
                          <span className="ml-2 inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {REPLAYABLE_TYPES.has(item.eventType) && item.vehicleId && (
                      <button
                        type="button"
                        onClick={() =>
                          setReplayTarget({
                            kind: 'daily',
                            vehicleId: item.vehicleId!,
                            activityDate: item.occurredAt.slice(0, 10),
                            flagType: item.eventType,
                            // `occurred_at` is a naive Postgres timestamp
                            // holding UTC — "2026-08-11 15:44:49.752", no zone
                            // marker. `new Date()` reads that as *local* time,
                            // so in Lagos it shifted every event an hour early
                            // and the replay opened on the wrong stretch of the
                            // day: clicking a 15:44 harsh cornering produced a
                            // window with no cornering in it at all, captioned
                            // as though it did. Parse it as the UTC it is.
                            at: parseServerTime(item.occurredAt)?.toISOString(),
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-y-ink"
                      >
                        <Play className="h-3.5 w-3.5" /> Replay
                      </button>
                    )}
                    {/* "View on map" dropped: Replay already opens the map, on
                        the moment the event happened rather than on wherever
                        the vehicle happens to be now. Two buttons where the
                        weaker one answers a worse question. */}
                  </div>
                </li>
              );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
