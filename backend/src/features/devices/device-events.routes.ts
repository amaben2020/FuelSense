import express, { Request, Response } from 'express';
import { authenticateCustomer } from '../auth/auth.middleware';
import { db, sql } from '../../shared/db-helpers';
import { distanceDeltasCte } from '../telemetry/telemetry-deltas.repository';
import { IDLE_BURN_LITERS_PER_HOUR, round1 } from '../fuel/fuel-metrics.service';
import { logAndRespond } from '../../shared/errors';

const router = express.Router();

router.use(authenticateCustomer);

/**
 * Points removed from a driver's score, per event.
 *
 * Harsh acceleration and harsh braking are the two the score is really about:
 * they are how a driver treats the vehicle, they are what burns the fuel, and
 * unlike idling they are nobody else's fault. Each costs a flat **2 points**.
 *
 * Flat, not normalised per 100 km. A manager should be able to look at
 * "harsh acceleration x 9" and know it cost 18 points without doing arithmetic
 * involving distance — and a driver should be able to predict the same thing
 * before it happens. The old per-100 km exponential was defensible but no one
 * could work out what any single event had cost them, which is worthless for
 * changing behaviour.
 */
const SCORE_WEIGHTS: Record<string, number> = {
  crash: 25,
  harsh_braking: 2,
  harsh_acceleration: 2,
  // Cornering is the noisiest of the three on a tracker without calibration,
  // so it counts for less than the two the driver can plainly feel.
  harsh_cornering: 1,
  overspeeding: 2,
};

/**
 * Idling costs nothing, for now.
 *
 * It was 6 points an hour — until the idle detector was found to be billing
 * silent trackers as running engines, which overstated stored idling by 43.7
 * hours across 64 stretches. The detector is fixed, but the score should not
 * charge a driver for a measurement whose trustworthiness is still being
 * watched, and idling in Lagos traffic is frequently the road's doing rather
 * than the driver's.
 *
 * Set this back to 6 once a few weeks of corrected idle data look right. The
 * hours are still measured, still shown on the behaviour page, and still count
 * toward the efficiency score at a low weight — they simply do not deduct from
 * the safety score.
 */
const IDLE_PENALTY_PER_HOUR = 0;
// Below this, idling is traffic and junctions rather than a habit worth scoring.
const IDLE_FREE_HOURS = 0.5;

/**
 * What counts against the vehicle as a security concern.
 *
 * Tracker power events are deliberately NOT here. `power_unplug` and
 * `power_dropout` say the device lost its supply — which on a unit wired to a
 * switched circuit happens at every single ignition-off, and did three times
 * in one morning on the reference vehicle. Counted as security, they appeared
 * beside a named driver as "3 security" on a screen headed Driving behaviour,
 * which reads as an accusation of tampering against someone whose only act was
 * turning the engine off. They belong to the tracker's health, and are
 * reported under `power` below.
 */
const SECURITY_EVENT_TYPES = [
  'towing',
  'crash',
  'jamming_start',
  'geofence_exit',
];

/** Tracker supply events — device health, never driver conduct. */
const POWER_EVENT_TYPES = ['power_unplug', 'power_dropout', 'power_restored'];

/**
 * Events that say nothing about anybody and are kept out of the counts.
 *
 * Every ignition turn and every trip edge is bookkeeping the app needs but no
 * manager reads: 29 "Ignition on" and 28 "Ignition off" crowded a driver's
 * chip list to the point that "Harsh braking x 2" was the eleventh thing on
 * it. They are still stored, still drive trips and idling, and are still
 * visible under the Everything filter — they just stop being presented as
 * things the driver did.
 */
const BOOKKEEPING_EVENT_TYPES = ['ignition_on', 'ignition_off', 'trip_start', 'trip_stop'];

/**
 * Points deducted, turned into a 0-100 score.
 *
 * Straight subtraction, floored at zero: two points off per harsh manoeuvre
 * means the score moves by exactly two, which is the only version a driver can
 * check against their own day. Everything past 100 points of penalty reads 0 —
 * at fifty harsh events in a window the ranking has stopped mattering and the
 * conversation is not about a score any more.
 */
export function scoreForPenalty(penalty: number): number {
  if (!Number.isFinite(penalty) || penalty <= 0) return 100;
  return Math.max(0, Math.round(100 - penalty));
}

const gradeForScore = (score: number): string => {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
};

router.get('/', async (req: Request, res: Response) => {
  const days = Math.min(Number(req.query.days) || 7, 90);
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const type = String(req.query.type || '').trim();
  const vehicleId = String(req.query.vehicle_id || '').trim();
  const customerId = req.user.customerId;

  try {
    const filters = [
      sql`e.customer_id = ${customerId}`,
      sql`e.occurred_at > NOW() - (${days} || ' days')::INTERVAL`,
    ];
    if (type === 'power') {
      filters.push(
        sql`e.event_type IN (${sql.join(
          POWER_EVENT_TYPES.map((t) => sql`${t}`),
          sql`, `
        )})`
      );
    } else if (type === 'security') {
      filters.push(
        sql`e.event_type IN (${sql.join(
          SECURITY_EVENT_TYPES.map((t) => sql`${t}`),
          sql`, `
        )})`
      );
    } else if (type) {
      filters.push(sql`e.event_type = ${type}`);
    }
    if (vehicleId) filters.push(sql`e.vehicle_id = ${vehicleId}::uuid`);

    const result = await db.execute(sql`
      SELECT
        e.id,
        e.vehicle_id,
        v.license_plate,
        COALESCE(dr.full_name, v.driver_name) AS driver_name,
        e.event_type,
        e.severity,
        e.value,
        e.unit,
        e.speed_kph,
        e.latitude,
        e.longitude,
        e.occurred_at
      FROM device_events e
      LEFT JOIN vehicles v ON v.id = e.vehicle_id
      LEFT JOIN drivers dr ON dr.id = v.driver_id
      WHERE ${sql.join(filters, sql` AND `)}
      ORDER BY e.occurred_at DESC
      LIMIT ${limit}
    `);

    res.json({ period_days: days, events: result.rows });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.get('/summary', async (req: Request, res: Response) => {
  const days = Math.min(Number(req.query.days) || 7, 90);
  const customerId = req.user.customerId;

  try {
    const [countsResult, distanceResult, vehiclesResult] = await Promise.all([
      db.execute(sql`
        SELECT vehicle_id, event_type, COUNT(*)::int AS count,
               MAX(occurred_at) AS last_at
        FROM device_events
        WHERE customer_id = ${customerId}
          AND occurred_at > NOW() - (${days} || ' days')::INTERVAL
        GROUP BY vehicle_id, event_type
      `),
      db.execute(sql`
        WITH ${distanceDeltasCte({ customerId, days })}
        SELECT
          vehicle_id,
          COALESCE(SUM(dist_delta), 0)::int AS distance_km,
          COALESCE(SUM(idle_delta_s), 0)::numeric AS idle_seconds
        FROM deltas
        GROUP BY vehicle_id
      `),
      db.execute(sql`
        SELECT v.id AS vehicle_id, v.license_plate, v.model,
               COALESCE(dr.full_name, v.driver_name) AS driver_name
        FROM vehicles v
        LEFT JOIN drivers dr ON dr.id = v.driver_id
        WHERE v.customer_id = ${customerId}
      `),
    ]);

    const distanceByVehicle = new Map<string, number>();
    const idleHoursByVehicle = new Map<string, number>();
    for (const row of distanceResult.rows) {
      const r = row as Record<string, unknown>;
      distanceByVehicle.set(String(r.vehicle_id), Math.max(0, Number(r.distance_km) || 0));
      idleHoursByVehicle.set(String(r.vehicle_id), (Number(r.idle_seconds) || 0) / 3600);
    }

    const countsByVehicle = new Map<string, Record<string, number>>();
    const lastEventByVehicle = new Map<string, string>();
    const fleetCounts: Record<string, number> = {};
    for (const row of countsResult.rows) {
      const r = row as Record<string, unknown>;
      const vid = String(r.vehicle_id);
      const eventType = String(r.event_type);
      const count = Number(r.count) || 0;
      if (!countsByVehicle.has(vid)) countsByVehicle.set(vid, {});
      countsByVehicle.get(vid)![eventType] = count;
      fleetCounts[eventType] = (fleetCounts[eventType] || 0) + count;
      const lastAt = String(r.last_at);
      const prev = lastEventByVehicle.get(vid);
      if (!prev || lastAt > prev) lastEventByVehicle.set(vid, lastAt);
    }

    const vehicles = vehiclesResult.rows.map((row) => {
      const r = row as Record<string, unknown>;
      const vid = String(r.vehicle_id);
      const allCounts = countsByVehicle.get(vid) ?? {};
      const counts = Object.fromEntries(
        Object.entries(allCounts).filter(([t]) => !BOOKKEEPING_EVENT_TYPES.includes(t))
      );
      const distanceKm = distanceByVehicle.get(vid) ?? 0;
      const idleHours = idleHoursByVehicle.get(vid) ?? 0;
      const billableIdleHours = Math.max(0, idleHours - IDLE_FREE_HOURS);

      let penalty = 0;
      for (const [eventType, weight] of Object.entries(SCORE_WEIGHTS)) {
        penalty += (counts[eventType] || 0) * weight;
      }
      penalty += billableIdleHours * IDLE_PENALTY_PER_HOUR;
      const score = scoreForPenalty(penalty);

      const securityEvents = SECURITY_EVENT_TYPES.reduce(
        (s, t) => s + (counts[t] || 0),
        0
      );
      const totalEvents = Object.values(counts).reduce((s, c) => s + c, 0);
      const powerEvents = POWER_EVENT_TYPES.reduce((s, t) => s + (counts[t] || 0), 0);

      return {
        vehicle_id: vid,
        license_plate: r.license_plate,
        driver_name: r.driver_name,
        model: r.model,
        distance_km: distanceKm,
        idle_hours: round1(idleHours),
        idle_fuel_liters: round1(idleHours * IDLE_BURN_LITERS_PER_HOUR),
        score,
        grade: gradeForScore(score),
        total_events: totalEvents,
        security_events: securityEvents,
        /** Tracker supply events. Device health — not counted against the driver. */
        power_events: powerEvents,
        counts,
        last_event_at: lastEventByVehicle.get(vid) ?? null,
      };
    });

    // Vehicles with worse behavior first; untouched vehicles at the end
    vehicles.sort((a, b) => a.score - b.score || b.total_events - a.total_events);

    const scored = vehicles.filter((v) => v.total_events > 0 || v.distance_km > 0);
    const avgScore = scored.length
      ? Math.round(scored.reduce((s, v) => s + v.score, 0) / scored.length)
      : null;

    res.json({
      period_days: days,
      fleet: {
        avg_score: avgScore,
        total_events: Object.values(fleetCounts).reduce((s, c) => s + c, 0),
        security_events: SECURITY_EVENT_TYPES.reduce(
          (s, t) => s + (fleetCounts[t] || 0),
          0
        ),
        power_events: POWER_EVENT_TYPES.reduce((s, t) => s + (fleetCounts[t] || 0), 0),
        idle_hours: round1(vehicles.reduce((s, v) => s + v.idle_hours, 0)),
        idle_fuel_liters: round1(vehicles.reduce((s, v) => s + v.idle_fuel_liters, 0)),
        counts_by_type: fleetCounts,
      },
      idle_burn_liters_per_hour: IDLE_BURN_LITERS_PER_HOUR,
      vehicles,
    });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

export default router;
