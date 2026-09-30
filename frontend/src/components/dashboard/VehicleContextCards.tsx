'use client';

import { useEffect, useState } from 'react';
import {
  BatteryWarning,
  CalendarClock,
  MapPin,
  Route,
  ShieldCheck,
  Wrench,
  Hexagon,
} from 'lucide-react';
import {
  FleetVehicle,
  Geofence,
  MaintenanceItem,
  ServerTrip,
  TripsResponse,
  VehicleCertificate,
  api,
  driverEfficiencyScore,
  fetchCertificates,
  fetchDriverReports,
  fetchGeofences,
  fetchMaintenance,
  fetchStopPlace,
  formatNgn,
} from '@/lib/api';
import { externalVerdict } from './PowerDiagnostics';

/**
 * What a manager needs to act on for one vehicle, each card built only from
 * something the tracker or the fleet's own records hold: the last GPS fix and
 * ignition edge, the fleet's geofences, the battery rail (AVL 66), the harsh
 * events behind the driver score, logged trips, service intervals against the
 * odometer, and uploaded certificates. Nothing here needs CAN/OBD, which these
 * trackers do not have, so there is no tyre pressure, oil life or fault code.
 */

type Tone = 'good' | 'warn' | 'bad' | 'neutral';

const TONE: Record<Tone, string> = {
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  neutral: 'text-ink',
};

function Card({
  icon: Icon,
  title,
  value,
  detail,
  tone = 'neutral',
  action,
}: {
  icon: typeof MapPin;
  title: string;
  value: string;
  detail?: string | null;
  tone?: Tone;
  action?: { label: string; onClick: () => void } | null;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-edge bg-panel-deep/60 p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-dim">
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      <p className={`mt-1.5 truncate text-sm font-semibold ${TONE[tone]}`} title={value}>
        {value}
      </p>
      {detail && <p className="mt-0.5 line-clamp-2 text-xs text-ink-dim">{detail}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 self-start text-xs text-brand hover:underline"
        >
          {action.label} →
        </button>
      )}
    </div>
  );
}

const toRad = (d: number) => (d * Math.PI) / 180;
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Whether a point sits inside a zone, by the same shapes the zones are drawn with. */
function insideZone(zone: Geofence, lat: number, lng: number): boolean {
  if (zone.shape === 'circle' && zone.center_lat != null && zone.center_lng != null && zone.radius_m) {
    return metresBetween(lat, lng, Number(zone.center_lat), Number(zone.center_lng)) <= zone.radius_m;
  }
  const ring = zone.polygon;
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' }).toLowerCase();

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const key = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (key(d) === key(today)) return 'today';
  if (key(d) === key(yesterday)) return 'yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
};

export function VehicleContextCards({
  vehicle,
  externalVoltage,
  onOpenLive,
  onNavigate,
}: {
  vehicle: FleetVehicle;
  externalVoltage: number | null;
  onOpenLive: (vehicleId: string) => void;
  onNavigate?: (view: 'records' | 'certificates' | 'drivers' | 'geofences') => void;
}) {
  const [lastTrip, setLastTrip] = useState<ServerTrip | null | undefined>(undefined);
  const [place, setPlace] = useState<string | null>(null);
  const [zones, setZones] = useState<Geofence[] | null>(null);
  const [service, setService] = useState<MaintenanceItem | null | undefined>(undefined);
  const [cert, setCert] = useState<VehicleCertificate | null | undefined>(undefined);
  const [score, setScore] = useState<{ total: number | null; harsh: number | null } | null | undefined>(undefined);

  const lat = vehicle.latitude != null ? Number(vehicle.latitude) : null;
  const lng = vehicle.longitude != null ? Number(vehicle.longitude) : null;

  useEffect(() => {
    let live = true;
    const vid = vehicle.id;
    api<TripsResponse>('/telemetry/trips?minutes=10080&fallback=1')
      .then((r) => {
        const trips = r.vehicles.find((v) => v.vehicle_id === vid)?.trips ?? [];
        if (live) setLastTrip(trips.length ? trips[trips.length - 1] : null);
      })
      .catch(() => live && setLastTrip(null));
    fetchGeofences().then((z) => live && setZones(z)).catch(() => live && setZones([]));
    fetchMaintenance()
      .then((m) => {
        const mine = m.items.filter((i) => i.vehicle_id === vid && i.status !== 'needs_baseline');
        const rank = (i: MaintenanceItem) => (i.status === 'overdue' ? 0 : i.status === 'due_soon' ? 1 : 2);
        mine.sort((a, b) => rank(a) - rank(b) || (a.km_remaining ?? Infinity) - (b.km_remaining ?? Infinity));
        if (live) setService(mine[0] ?? null);
      })
      .catch(() => live && setService(null));
    fetchCertificates()
      .then((c) => {
        const mine = c.certificates
          .filter((x) => x.vehicle_id === vid)
          .sort((a, b) => a.days_to_expiry - b.days_to_expiry);
        if (live) setCert(mine[0] ?? null);
      })
      .catch(() => live && setCert(null));
    fetchDriverReports({ bucket: 'month', periods: 1 })
      .then((r) => {
        const report = r.drivers.find((d) => d.driver_name === vehicle.driver_name);
        const period = report?.periods[report.periods.length - 1] ?? null;
        if (live) setScore(period ? { total: driverEfficiencyScore(period).total, harsh: period.harsh_events ?? null } : null);
      })
      .catch(() => live && setScore(null));
    return () => {
      live = false;
    };
  }, [vehicle.id, vehicle.driver_name]);

  // Rounded so a parked car's GPS jitter does not re-resolve the address.
  const latKey = lat != null ? lat.toFixed(4) : null;
  const lngKey = lng != null ? lng.toFixed(4) : null;
  useEffect(() => {
    if (latKey == null || lngKey == null) return;
    let live = true;
    fetchStopPlace(Number(latKey), Number(lngKey))
      .then((p) => live && setPlace(p.place_name ?? p.formatted_address ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [latKey, lngKey]);

  const moving = vehicle.connection_status === 'online' && vehicle.ignition_on && Number(vehicle.speed_kph ?? 0) > 2;
  const since = !moving && lastTrip && !lastTrip.active ? `since ${clock(lastTrip.end_at)} ${dayLabel(lastTrip.end_at)}` : null;
  const inZones = lat != null && lng != null && zones ? zones.filter((z) => z.active && insideZone(z, lat, lng)) : null;
  const battery = externalVoltage != null && vehicle.ignition_on !== true ? externalVerdict(externalVoltage) : null;

  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-3">
      <Card
        icon={MapPin}
        title="Location"
        value={place ?? (lat != null ? `${lat.toFixed(5)}, ${lng?.toFixed(5)}` : 'No GPS fix yet')}
        detail={moving ? 'Moving now' : since ? `Parked ${since}` : null}
        action={{ label: 'Live map', onClick: () => onOpenLive(vehicle.id) }}
      />

      <Card
        icon={Hexagon}
        title="Geofence"
        value={
          inZones == null
            ? '…'
            : zones?.length === 0
              ? 'No zones set up'
              : inZones.length
                ? `Inside ${inZones.map((z) => z.name).join(', ')}`
                : 'Outside all zones'
        }
        tone={inZones && inZones.length ? 'good' : 'neutral'}
        action={zones?.length === 0 && onNavigate ? { label: 'Draw a zone', onClick: () => onNavigate('geofences') } : null}
      />

      {battery && battery.tone !== 'good' && (
        <Card
          icon={BatteryWarning}
          title="Vehicle battery"
          value={`${externalVoltage!.toFixed(2)} V · ${battery.label}`}
          detail="Engine off. Below 12.4 V a 12 V battery is not holding full charge — check it before the next early start."
          tone={battery.tone === 'bad' ? 'bad' : 'warn'}
        />
      )}

      <Card
        icon={ShieldCheck}
        title="Driver score · this month"
        value={
          score === undefined
            ? '…'
            : score?.total != null
              ? `${Math.round(score.total)} / 100`
              : 'Not enough driving yet'
        }
        detail={
          score?.harsh != null
            ? `${score.harsh} harsh braking, acceleration or cornering event${score.harsh === 1 ? '' : 's'}`
            : vehicle.driver_name ?? null
        }
        tone={score?.total == null ? 'neutral' : score.total >= 80 ? 'good' : score.total >= 60 ? 'warn' : 'bad'}
        action={onNavigate ? { label: 'Driver report', onClick: () => onNavigate('drivers') } : null}
      />

      <Card
        icon={Route}
        title="Last trip"
        value={
          lastTrip === undefined
            ? '…'
            : lastTrip
              ? `${lastTrip.distance_km} km · ${lastTrip.estimated_fuel_liters} L`
              : 'No trips this week'
        }
        detail={
          lastTrip
            ? `${dayLabel(lastTrip.start_at)} ${clock(lastTrip.start_at)}–${clock(lastTrip.end_at)}${
                lastTrip.estimated_cost_ngn != null ? ` · ${formatNgn(lastTrip.estimated_cost_ngn)}` : ''
              }`
            : null
        }
        action={lastTrip ? { label: 'Replay on map', onClick: () => onOpenLive(vehicle.id) } : null}
      />

      <Card
        icon={Wrench}
        title="Next service"
        value={
          service === undefined
            ? '…'
            : service
              ? service.label
              : 'No schedule set'
        }
        detail={
          service
            ? service.status === 'overdue'
              ? 'Overdue'
              : service.km_remaining != null
                ? `in ${Math.round(service.km_remaining * 0.621371).toLocaleString()} mi`
                : service.days_remaining != null
                  ? `in ${service.days_remaining} days`
                  : null
            : null
        }
        tone={service?.status === 'overdue' ? 'bad' : service?.status === 'due_soon' ? 'warn' : 'neutral'}
        action={onNavigate ? { label: 'Service record', onClick: () => onNavigate('records') } : null}
      />

      <Card
        icon={CalendarClock}
        title="Documents"
        value={
          cert === undefined
            ? '…'
            : cert
              ? cert.status === 'expired'
                ? `${cert.kind.toUpperCase()} expired`
                : `${cert.kind.toUpperCase()} valid`
              : 'None uploaded'
        }
        detail={
          cert
            ? cert.status === 'expired'
              ? `Expired ${new Date(cert.expires_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
              : `Expires ${new Date(cert.expires_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${cert.days_to_expiry} days`
            : null
        }
        tone={cert?.status === 'expired' ? 'bad' : cert?.status === 'expiring' ? 'warn' : 'neutral'}
        action={onNavigate ? { label: 'Certificates', onClick: () => onNavigate('certificates') } : null}
      />
    </div>
  );
}
