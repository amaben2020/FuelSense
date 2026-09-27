import 'dotenv/config';

import { db, initDatabase, closePool } from '../config/db';
import { sql } from 'drizzle-orm';
import { deviceEvents } from '../config/db/schema';
import { detectHarshEvents, DrivingSample } from '../features/telemetry/harsh-driving.service';
import { FrameRow, frameToSample } from '../features/telemetry/driving-events-sweep.service';

// Re-derives every GPS-detected harsh manoeuvre with the readings timed
// correctly.
//
// The detector used to time samples by server arrival, which trails the
// device's reading by a variable 1-3 s. A turn whose two readings arrived
// 0.57 s apart, but were taken a second apart, was scored at 3.8 m/s² when it
// was 2.2 — an ordinary right turn filed as harsh cornering. Replaying
// September that way gave 59 events; timed properly, 22, and not one of them a
// harsh acceleration.
//
// Frames stored before `device_frames.recorded_at` existed have no device
// time, so the gap between two of them is recovered from the ground covered:
// distance / mean speed, rounded to the device's whole-second clock. Where
// both frames carry a device time, that is used as-is. A stationary pair
// falls back to arrival, which cannot matter: nothing moving, nothing harsh.
//
// Only GPS-derived rows (unit m/s²) are replaced. The tracker's own
// accelerometer events (unit g) are evidence, not a derivation, and are kept.
//
// Usage: npm run rederive-harsh-events            (dry run)
//        npm run rederive-harsh-events -- --apply

/** Below this the distance moved is GPS jitter, not travel worth timing. */
const MIN_MOVING_MS = 2;

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLng = (bLng - aLng) * r;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Seconds between two consecutive frames, by the best evidence available. */
function gapSeconds(prev: FrameRow, cur: FrameRow, prevSample: DrivingSample, sample: DrivingSample): number {
  if (prev.recorded_at && cur.recorded_at) {
    return (new Date(cur.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 1000;
  }
  const meanMs = (prevSample.speedKph + sample.speedKph) / 2 / 3.6;
  if (
    meanMs > MIN_MOVING_MS &&
    prevSample.lat != null && prevSample.lng != null &&
    sample.lat != null && sample.lng != null
  ) {
    const metres = haversineM(prevSample.lat, prevSample.lng, sample.lat, sample.lng);
    return Math.max(1, Math.round(metres / meanMs));
  }
  return (new Date(cur.received_at).getTime() - new Date(prev.received_at).getTime()) / 1000;
}

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await initDatabase();

  const vehicles = (
    await db.execute(sql`
      SELECT DISTINCT d.vehicle_id, d.customer_id, d.imei
      FROM devices d
      WHERE d.vehicle_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM device_frames f WHERE f.imei = d.imei)
    `)
  ).rows as Array<{ vehicle_id: string; customer_id: string; imei: string }>;

  const replaced = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM device_events
    WHERE unit = 'm/s2'
      AND event_type IN ('harsh_acceleration', 'harsh_braking', 'harsh_cornering')
  `);
  console.log(`GPS-derived harsh events on file: ${(replaced.rows[0] as { n: number }).n}`);

  const toWrite: Array<typeof deviceEvents.$inferInsert> = [];

  for (const vehicle of vehicles) {
    const frames = (
      await db.execute(sql`
        SELECT imei, received_at, recorded_at, gps_raw, gps_valid
        FROM device_frames
        WHERE imei = ${vehicle.imei} AND gps_raw IS NOT NULL
        ORDER BY received_at ASC, id ASC
      `)
    ).rows as unknown as FrameRow[];
    if (frames.length < 2) continue;

    // A synthetic clock for the detector, plus the real instant each tick
    // stands for, so an event is stored at a time a manager can look up.
    const samples: DrivingSample[] = [];
    const stampFor = new Map<number, Date>();
    let clockMs = new Date(frames[0].received_at).getTime();

    for (let i = 0; i < frames.length; i += 1) {
      const frame = frames[i];
      const provisional = frameToSample(frame, new Date(clockMs));
      if (i > 0) {
        clockMs += gapSeconds(frames[i - 1], frame, samples[i - 1], provisional) * 1000;
      }
      samples.push({ ...provisional, at: new Date(clockMs) });
      if (!stampFor.has(clockMs)) {
        stampFor.set(clockMs, new Date(frame.recorded_at ?? frame.received_at));
      }
    }

    const events = detectHarshEvents(samples);
    const byType: Record<string, number> = {};
    for (const event of events) {
      byType[event.type] = (byType[event.type] ?? 0) + 1;
      toWrite.push({
        imei: vehicle.imei,
        customerId: vehicle.customer_id,
        vehicleId: vehicle.vehicle_id,
        eventType: event.type,
        severity: event.severity,
        value: event.magnitudeMs2.toString(),
        unit: 'm/s2',
        speedKph: event.speedKph,
        latitude: event.lat?.toString() ?? null,
        longitude: event.lng?.toString() ?? null,
        occurredAt: stampFor.get(event.occurredAt.getTime()) ?? event.occurredAt,
      });
    }
    console.log(`${vehicle.imei}: ${frames.length} frames -> ${events.length} events`, byType);
  }

  if (!apply) {
    console.log(`Dry run: would replace them with ${toWrite.length}. Re-run with --apply.`);
    await closePool();
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM device_events
      WHERE unit = 'm/s2'
        AND event_type IN ('harsh_acceleration', 'harsh_braking', 'harsh_cornering')
    `);
    for (let i = 0; i < toWrite.length; i += 500) {
      await tx.insert(deviceEvents).values(toWrite.slice(i, i + 500));
    }
  });
  console.log(`Replaced with ${toWrite.length} correctly timed events.`);
  await closePool();
}

run().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});
