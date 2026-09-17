import express, { Request, Response } from 'express';
import { authenticateCustomer } from '../middleware/auth';
import { db, sql } from '../lib/db-helpers';
import {
  tamperSignalsCte,
  drivingStretchesCte,
  utilisationCte,
} from '../lib/fleet-intelligence-sql';
import { round1, round2 } from '../lib/fuel-metrics';
import { localDate } from '../lib/telemetry-deltas-sql';
import { buildRefuelPlanning } from '../lib/refuel-planning';
import { sendMail, mailerReady } from '../lib/mailer';
import { withCache, cacheKey } from '../lib/redis';
import { logAndRespond } from '../lib/errors';

const router = express.Router();
router.use(authenticateCustomer);

const clampDays = (raw: unknown, fallback: number) =>
  Math.min(Math.max(Number(raw) || fallback, 1), 90);

/** GSM bars at or below this count as "lost" for the jamming heuristic. */
const WEAK_GSM = 1;
/** Silence longer than this, begun mid-journey, is worth surfacing. */
const GAP_SECONDS = 900;
/** A rest this long ends a continuous driving stretch. */
const BREAK_MINUTES = 30;
/** Stretch length past which fatigue is worth flagging. */
const FATIGUE_HOURS = 4;

/**
 * Security signals — jamming candidates and unexplained reporting gaps.
 *
 * Deliberately called "candidates". Each row carries the evidence that produced
 * it so a manager can dismiss a tunnel without the system having pretended to
 * know the difference.
 */
router.get('/security', async (req: Request, res: Response) => {
  const days = clampDays(req.query.days, 7);
  try {
    const customerId = req.user.customerId;
    const payload = await withCache(
      cacheKey(customerId, 'intel-security', String(days)),
      60,
      async () => {
        const rows = await db.execute(sql`
          WITH ${tamperSignalsCte({
            customerId,
            days,
            weakGsm: WEAK_GSM,
            minGapSeconds: GAP_SECONDS,
          })}
          SELECT
            vehicle_id, license_plate, driver_name, recorded_at,
            latitude, longitude, signal, gsm_signal, battery_current_ma,
            prev_speed, gap_seconds
          FROM signals
          WHERE signal IS NOT NULL
          ORDER BY recorded_at DESC
          LIMIT 100
        `);

        return {
          period_days: days,
          thresholds: {
            weak_gsm_bars: WEAK_GSM,
            reporting_gap_seconds: GAP_SECONDS,
          },
          events: rows.rows.map((r) => {
            const row = r as Record<string, unknown>;
            return {
              vehicle_id: row.vehicle_id,
              license_plate: row.license_plate,
              driver_name: row.driver_name,
              at: row.recorded_at,
              latitude: row.latitude == null ? null : Number(row.latitude),
              longitude: row.longitude == null ? null : Number(row.longitude),
              kind: row.signal,
              gsm_signal: row.gsm_signal == null ? null : Number(row.gsm_signal),
              battery_current_ma:
                row.battery_current_ma == null ? null : Number(row.battery_current_ma),
              speed_before_kph: row.prev_speed == null ? null : Number(row.prev_speed),
              gap_seconds: row.gap_seconds == null ? null : Number(row.gap_seconds),
            };
          }),
        };
      }
    );
    res.json(payload);
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/**
 * Driving hours and fatigue exposure, per vehicle over the window.
 *
 * There is no hours-of-service regulation encoded here — thresholds are stated
 * in the response so the number can be argued with rather than taken on trust.
 */
router.get('/hours', async (req: Request, res: Response) => {
  const days = clampDays(req.query.days, 7);
  try {
    const customerId = req.user.customerId;
    const payload = await withCache(
      cacheKey(customerId, 'intel-hours', String(days)),
      60,
      async () => {
        const rows = await db.execute(sql`
          WITH ${drivingStretchesCte({ customerId, days, breakMinutes: BREAK_MINUTES })}
          SELECT
            vehicle_id,
            license_plate,
            driver_name,
            COUNT(*) AS stretches,
            COALESCE(SUM(hours), 0) AS total_hours,
            COALESCE(MAX(hours), 0) AS longest_hours,
            COUNT(*) FILTER (WHERE hours >= ${FATIGUE_HOURS}) AS long_stretches,
            COUNT(*) FILTER (WHERE touched_night) AS night_stretches
          FROM stretches
          GROUP BY vehicle_id, license_plate, driver_name
          ORDER BY total_hours DESC
        `);

        const longest = await db.execute(sql`
          WITH ${drivingStretchesCte({ customerId, days, breakMinutes: BREAK_MINUTES })}
          SELECT license_plate, driver_name, started_at, ended_at, hours, touched_night
          FROM stretches
          WHERE hours >= ${FATIGUE_HOURS}
          ORDER BY hours DESC
          LIMIT 20
        `);

        // Every stretch, not just the fatigue-flagged ones — "16 stretches" on
        // its own says nothing about where the driving happened, and a night
        // badge with no date is a count with the useful half removed. Kept
        // separate from `flagged` (fatigue-only) rather than replacing it.
        const allStretches = await db.execute(sql`
          WITH ${drivingStretchesCte({ customerId, days, breakMinutes: BREAK_MINUTES })}
          SELECT
            vehicle_id, started_at, ended_at, hours, touched_night,
            start_lat, start_lng, end_lat, end_lng
          FROM stretches
          ORDER BY vehicle_id, started_at DESC
          LIMIT 300
        `);
        const stretchesByVehicle = new Map<string, unknown[]>();
        for (const r of allStretches.rows) {
          const row = r as Record<string, unknown>;
          const key = String(row.vehicle_id);
          const list = stretchesByVehicle.get(key) ?? [];
          list.push({
            started_at: row.started_at,
            ended_at: row.ended_at,
            hours: round1(Number(row.hours)),
            night: Boolean(row.touched_night),
            start_lat: row.start_lat != null ? Number(row.start_lat) : null,
            start_lng: row.start_lng != null ? Number(row.start_lng) : null,
            end_lat: row.end_lat != null ? Number(row.end_lat) : null,
            end_lng: row.end_lng != null ? Number(row.end_lng) : null,
          });
          stretchesByVehicle.set(key, list);
        }

        return {
          period_days: days,
          thresholds: {
            break_minutes: BREAK_MINUTES,
            fatigue_hours: FATIGUE_HOURS,
          },
          vehicles: rows.rows.map((r) => {
            const row = r as Record<string, unknown>;
            return {
              vehicle_id: row.vehicle_id,
              license_plate: row.license_plate,
              driver_name: row.driver_name,
              stretches: Number(row.stretches),
              total_hours: round1(Number(row.total_hours)),
              longest_hours: round1(Number(row.longest_hours)),
              long_stretches: Number(row.long_stretches),
              night_stretches: Number(row.night_stretches),
              stretch_detail: stretchesByVehicle.get(String(row.vehicle_id)) ?? [],
            };
          }),
          flagged: longest.rows.map((r) => {
            const row = r as Record<string, unknown>;
            return {
              license_plate: row.license_plate,
              driver_name: row.driver_name,
              started_at: row.started_at,
              ended_at: row.ended_at,
              hours: round1(Number(row.hours)),
              night: Boolean(row.touched_night),
            };
          }),
        };
      }
    );
    res.json(payload);
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/**
 * Utilisation, for deciding whether a vehicle earns its keep.
 *
 * `idle_share` is engine-hours with no distance against total engine-hours —
 * the figure that separates a busy van from one that sits running.
 */
router.get('/utilisation', async (req: Request, res: Response) => {
  const days = clampDays(req.query.days, 30);
  try {
    const customerId = req.user.customerId;
    const payload = await withCache(
      cacheKey(customerId, 'intel-utilisation', String(days)),
      60,
      async () => {
        const rows = await db.execute(sql`
          WITH ${utilisationCte({ customerId, days })}
          SELECT
            vehicle_id,
            license_plate,
            make,
            model,
            driver_name,
            COALESCE(SUM(dist_delta), 0) AS distance_km,
            COALESCE(SUM(engine_seconds), 0) AS engine_seconds,
            COALESCE(SUM(ignition_cycle), 0) AS ignition_cycles,
            COUNT(DISTINCT CASE WHEN dist_delta > 0 THEN ${localDate} END) AS active_days
          FROM util_deltas
          GROUP BY vehicle_id, license_plate, make, model, driver_name
          ORDER BY distance_km DESC
        `);

        const vehicles = rows.rows.map((r) => {
          const row = r as Record<string, unknown>;
          const distanceKm = Number(row.distance_km);
          const activeDays = Number(row.active_days);
          const engineHours = Number(row.engine_seconds) / 3600;
          return {
            vehicle_id: row.vehicle_id,
            license_plate: row.license_plate,
            make: row.make,
            model: row.model,
            driver_name: row.driver_name,
            distance_km: round1(distanceKm),
            engine_hours: round1(engineHours),
            ignition_cycles: Number(row.ignition_cycles),
            active_days: activeDays,
            /** Share of the window the vehicle actually moved on. */
            active_share: round2(activeDays / days),
            km_per_active_day: activeDays > 0 ? round1(distanceKm / activeDays) : null,
            /** Distance covered per hour the engine was running. */
            km_per_engine_hour: engineHours > 0.1 ? round1(distanceKm / engineHours) : null,
          };
        });

        return { period_days: days, vehicles };
      }
    );
    res.json(payload);
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.get('/refuels', async (req: Request, res: Response) => {
  try {
    const customerId = req.user.customerId;
    const payload = await withCache(cacheKey(customerId, 'intel-refuels'), 60, () =>
      buildRefuelPlanning(customerId)
    );
    res.json(payload);
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/** Where a manager's "this figure is wrong" goes: the developer, with the working attached. */
const DEVELOPER_EMAIL = process.env.DEVELOPER_EMAIL || process.env.CONTACT_EMAIL_TO || 'uzochukwubenamara@gmail.com';

/**
 * A manager disputing a modelled figure. The message goes to the developer
 * with the vehicle's full working — every number the page showed — so the
 * conversation starts from the same facts rather than a screenshot.
 */
router.post('/refuels/feedback', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { vehicle_id?: string; message?: string; actual_liters?: number | string | null };
  const message = String(body.message ?? '').trim();
  const vehicleId = String(body.vehicle_id ?? '').trim();
  if (!vehicleId || !message) {
    res.status(400).json({ error: 'Say which vehicle and what looks wrong.' });
    return;
  }
  if (message.length > 2000) {
    res.status(400).json({ error: 'Keep it under 2000 characters.' });
    return;
  }
  if (!mailerReady()) {
    res.status(503).json({ error: 'Email is not configured on this server, so the request cannot be sent.' });
    return;
  }

  try {
    const planning = await buildRefuelPlanning(req.user.customerId);
    const vehicle = planning.vehicles.find((v) => v.vehicle_id === vehicleId);
    if (!vehicle) {
      res.status(404).json({ error: 'No such vehicle on this fleet.' });
      return;
    }
    const actual = body.actual_liters != null && body.actual_liters !== '' ? Number(body.actual_liters) : null;
    const c = vehicle.calculation;
    const lines = [
      `From: ${req.user.name || req.user.email} (${req.user.email}), customer ${req.user.customerId}`,
      `Vehicle: ${vehicle.license_plate} · ${vehicle.driver_name}`,
      '',
      'Their message:',
      message,
      '',
      ...(actual != null && Number.isFinite(actual) ? [`Tank actually holds (their reading): ${actual} L`, ''] : []),
      'What the page showed:',
      `  Last receipt: ${vehicle.last_refuel ? `${vehicle.last_refuel.at} · ${vehicle.last_refuel.liters} L · ₦${vehicle.last_refuel.amount_ngn ?? '?'} · ${vehicle.last_refuel.merchant ?? ''}` : 'none'}`,
      `  Odometer now: ${c.odometer_now_km ?? '?'} km (at ${c.odometer_now_at ?? '?'}) · at refuel: ${c.odometer_at_refuel_km ?? '?'} km`,
      `  Km since refuel: ${c.km_since_refuel} (${c.km_since_source})`,
      `  Rate: ${c.rate_l_per_100km} L/100 km = ${c.rate_mpg} mpg (${c.rate_source})`,
      `  Litres used since refuel: ${c.liters_used_since_refuel}`,
      `  Anchor: ${c.anchor.level_l ?? '?'} L at ${c.anchor.at ?? '?'} (${c.anchor.source ?? '?'}) · burned since anchor: ${c.burned_since_anchor_l ?? '?'} L`,
      `  Level now: ${c.level_now_l ?? '?'} L · reserve ${c.reserve_l} L · usable ${c.usable_l ?? '?'} L · range ${c.range_km ?? '?'} km`,
      `  Usage: ${c.km_per_day ?? '?'} km/day · days by model ${c.days_by_model ?? '?'} · by receipt cadence ${c.days_by_cadence ?? '?'}`,
      `  Price: ₦${c.price_per_liter_ngn}/L`,
      '',
      `Generated ${planning.generated_at}`,
    ];
    const text = lines.join('\n');
    const ok = await sendMail({
      to: DEVELOPER_EMAIL,
      subject: `[FuelSense] ${vehicle.license_plate}: fuel figure disputed by ${req.user.name || req.user.email}`,
      text,
      html: `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap">${text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')}</pre>`,
      bypassOverride: true,
    });
    if (!ok) {
      res.status(502).json({ error: 'The email could not be sent. Try again in a moment.' });
      return;
    }
    res.json({ ok: true, sent_to: DEVELOPER_EMAIL });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

export default router;
