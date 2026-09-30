// Turns fuel-station zone containment into a visit log and one arrival alert.
//
// The geofence monitor decides inside/outside with its usual hysteresis and
// hands every fix for a fuel-station zone here. Entering and leaving only
// open and close the visit row; the manager is told when the vehicle has
// actually stopped on the forecourt, because a zone around a roadside station
// also catches every vehicle driving past it.
import { db, alerts, eq, and, sql } from '../../shared/db-helpers';
import { fuelStationVisits } from '../../config/db/schema';
import { alertEmail, sendMail } from '../../shared/mailer';
import { resolveAlertRecipient } from '../alerts/alert-mail.service';

/** Below this the vehicle is standing, not crawling past in traffic. */
const STOPPED_KPH = 5;
/** Inside and standing for this long before it counts as a visit. */
const MIN_DWELL_MS = 60_000;

export interface StationZone {
  id: string;
  name: string;
}

export interface StationFix {
  imei: string;
  customerId: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  recordedAt: Date;
  speedKph: number | null;
  licensePlate?: string;
  driverName?: string | null;
}

// Open visits already announced, so a vehicle parked at a pump for twenty
// minutes costs one UPDATE, not one per fix. Lost on restart, which only
// means one extra UPDATE that matches nothing.
const announced = new Set<string>();
const keyFor = (zoneId: string, vehicleId: string) => `${zoneId}:${vehicleId}`;

export async function openVisit(zone: StationZone, fix: StationFix): Promise<void> {
  announced.delete(keyFor(zone.id, fix.vehicleId));
  await db
    .insert(fuelStationVisits)
    .values({
      customerId: fix.customerId,
      geofenceId: zone.id,
      vehicleId: fix.vehicleId,
      driverName: fix.driverName ?? null,
      enteredAt: fix.recordedAt,
    })
    .onConflictDoNothing();
}

export async function closeVisit(zone: StationZone, fix: StationFix): Promise<void> {
  announced.delete(keyFor(zone.id, fix.vehicleId));
  await db
    .update(fuelStationVisits)
    .set({ exitedAt: fix.recordedAt })
    .where(
      and(
        eq(fuelStationVisits.geofenceId, zone.id),
        eq(fuelStationVisits.vehicleId, fix.vehicleId),
        sql`${fuelStationVisits.exitedAt} IS NULL`
      )
    );
}

/**
 * Called for every fix while the vehicle is inside a station zone. Marks the
 * open visit as a stop — and alerts — the first time the vehicle has been
 * standing inside for a minute. Returns true when that happened.
 */
export async function noteInsideFix(zone: StationZone, fix: StationFix): Promise<boolean> {
  const key = keyFor(zone.id, fix.vehicleId);
  if (announced.has(key)) return false;
  if (fix.speedKph == null || fix.speedKph >= STOPPED_KPH) return false;

  const cutoff = new Date(fix.recordedAt.getTime() - MIN_DWELL_MS);
  const [visit] = await db
    .update(fuelStationVisits)
    .set({ stoppedAt: fix.recordedAt })
    .where(
      and(
        eq(fuelStationVisits.geofenceId, zone.id),
        eq(fuelStationVisits.vehicleId, fix.vehicleId),
        sql`${fuelStationVisits.exitedAt} IS NULL`,
        sql`${fuelStationVisits.stoppedAt} IS NULL`,
        sql`${fuelStationVisits.enteredAt} <= ${cutoff}`
      )
    )
    .returning({ id: fuelStationVisits.id, enteredAt: fuelStationVisits.enteredAt });
  if (!visit) return false;

  announced.add(key);

  const plate = fix.licensePlate ?? 'Vehicle';
  const who = fix.driverName ? `${plate} (${fix.driverName})` : plate;
  await db.insert(alerts).values({
    imei: fix.imei,
    customerId: fix.customerId,
    vehicleId: fix.vehicleId,
    alertType: 'fuel_station_arrival',
    message: `${who} stopped at fuel station "${zone.name}".`,
    latitude: fix.latitude.toString(),
    longitude: fix.longitude.toString(),
  });

  await notifyArrival(zone, fix, visit.enteredAt);
  return true;
}

/** Best-effort, opt-in mail — same contract as every other alert email. */
async function notifyArrival(zone: StationZone, fix: StationFix, enteredAt: Date): Promise<void> {
  try {
    const to = await resolveAlertRecipient(fix.customerId, 'fuel_station_arrival');
    if (!to) return;

    const plate = fix.licensePlate ?? 'Vehicle';
    const { text, html } = alertEmail({
      title: `${plate} is at ${zone.name}`,
      lines: [
        ['Vehicle', plate],
        ['Driver', fix.driverName || 'Unassigned'],
        ['Station', zone.name],
        ['Arrived', enteredAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'],
      ],
      linkUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${fix.latitude},${fix.longitude}`)}`,
      linkLabel: 'Where the vehicle is',
      footer: 'FuelSense · turn these off in Settings → Notifications',
    });
    await sendMail({ to, subject: `${plate} stopped at ${zone.name}`, text, html });
  } catch {
    // The alert row is already durable; a failed mail must not stop ingest.
  }
}
