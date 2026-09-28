// The developer's view across every fleet on the platform.
//
// Not a product feature: a single page for whoever runs the servers to see
// which companies exist, when someone from each last signed in, and when
// each fleet's trackers last reported — the three things that say whether
// an onboarding took. Gated by email, not role, because "manager" is a
// customer-side role and every fleet has one.
import express, { Request, Response } from 'express';
import { authenticateCustomer } from '../auth/auth.middleware';
import { db, sql } from '../../shared/db-helpers';
import { logAndRespond } from '../../shared/errors';

const router = express.Router();
router.use(authenticateCustomer);

/** Who may open it. Comma-separated; matched case-insensitively against the signed-in email. */
const DEV_EMAILS = new Set(
  (process.env.DEV_MONITOR_EMAILS || 'uzochukwubenamara@gmail.com,manager@bluefleet.demo,demo@fuelsense.local')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

export const isDeveloper = (email: string | undefined): boolean =>
  Boolean(email && DEV_EMAILS.has(email.toLowerCase()));

router.use((req, res, next) => {
  if (!isDeveloper(req.user.email)) {
    res.status(403).json({ error: 'This page is for the FuelSense team.' });
    return;
  }
  next();
});

router.get('/fleets', async (req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        c.id,
        COALESCE(c.company_name, c.name) AS company,
        c.name AS account_name,
        c.email,
        c.subscription_status,
        c.created_at,
        c.onboarding_completed,
        c.last_login_at AS account_last_login_at,
        fu.last_login_at AS team_last_login_at,
        fu.member_count,
        v.vehicle_count,
        dr.driver_count,
        d.device_count,
        d.active_device_count,
        d.last_seen_at AS tracker_last_seen_at,
        t.last_recorded_at AS telemetry_last_at,
        t.readings_24h,
        a.open_alerts,
        r.receipts_30d,
        r.last_receipt_at
      FROM customers c
      LEFT JOIN LATERAL (
        SELECT MAX(last_login_at) AS last_login_at, COUNT(*)::int AS member_count
        FROM fleet_users WHERE customer_id = c.id AND is_active = true
      ) fu ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS vehicle_count FROM vehicles WHERE customer_id = c.id
      ) v ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS driver_count FROM drivers WHERE customer_id = c.id AND status = 'active'
      ) dr ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS device_count,
               COUNT(*) FILTER (WHERE is_active)::int AS active_device_count,
               MAX(last_seen_at) AS last_seen_at
        FROM devices WHERE customer_id = c.id
      ) d ON TRUE
      LEFT JOIN LATERAL (
        SELECT MAX(recorded_at) AS last_recorded_at,
               COUNT(*) FILTER (WHERE recorded_at > NOW() - INTERVAL '24 hours')::int AS readings_24h
        FROM telemetry WHERE customer_id = c.id AND recorded_at > NOW() - INTERVAL '90 days'
      ) t ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS open_alerts FROM alerts WHERE customer_id = c.id AND is_resolved = false
      ) a ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE transaction_date > NOW() - INTERVAL '30 days')::int AS receipts_30d,
               MAX(transaction_date) AS last_receipt_at
        FROM fuel_receipts WHERE customer_id = c.id
      ) r ON TRUE
      ORDER BY GREATEST(COALESCE(c.last_login_at, 'epoch'), COALESCE(fu.last_login_at, 'epoch')) DESC NULLS LAST,
               c.created_at DESC
    `);

    const fleets = rows.rows.map((raw) => {
      const r = raw as Record<string, unknown>;
      const account = r.account_last_login_at ? new Date(String(r.account_last_login_at)) : null;
      const team = r.team_last_login_at ? new Date(String(r.team_last_login_at)) : null;
      const lastLogin = [account, team].filter((d): d is Date => d != null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      const trackerSeen = r.tracker_last_seen_at ? new Date(String(r.tracker_last_seen_at)) : null;
      const telemetry = r.telemetry_last_at ? new Date(String(r.telemetry_last_at)) : null;
      const lastOnline = [trackerSeen, telemetry].filter((d): d is Date => d != null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      return {
        id: r.id,
        company: r.company,
        account_name: r.account_name,
        email: r.email,
        subscription_status: r.subscription_status,
        created_at: r.created_at,
        onboarding_completed: Boolean(r.onboarding_completed),
        last_login_at: lastLogin ? lastLogin.toISOString() : null,
        team_members: Number(r.member_count) || 0,
        vehicles: Number(r.vehicle_count) || 0,
        drivers: Number(r.driver_count) || 0,
        devices: Number(r.device_count) || 0,
        active_devices: Number(r.active_device_count) || 0,
        tracker_last_online_at: lastOnline ? lastOnline.toISOString() : null,
        readings_24h: Number(r.readings_24h) || 0,
        open_alerts: Number(r.open_alerts) || 0,
        receipts_30d: Number(r.receipts_30d) || 0,
        last_receipt_at: r.last_receipt_at,
      };
    });

    res.json({ generated_at: new Date().toISOString(), fleets });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/**
 * Every vehicle on the platform with its tracker's latest report, for seeing
 * at a glance what is running right now. One LATERAL per vehicle on
 * (vehicle_id, recorded_at), so the cost is one index probe per vehicle.
 */
const RUNNING_SILENCE_MIN = 15;
const PARKED_SILENCE_MIN = 70;

router.get('/vehicles', async (req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        v.id,
        v.license_plate,
        v.make, v.model, v.year,
        COALESCE(c.company_name, c.name) AS company,
        COALESCE(dr.full_name, v.driver_name) AS driver_name,
        d.imei, d.device_model, d.last_seen_at,
        t.recorded_at, t.ignition_on, t.speed_kph,
        fix.latitude::double precision AS lat,
        fix.longitude::double precision AS lng,
        ROUND(vt.level_ml / 1000.0, 1)::double precision AS tank_liters,
        vt.capacity_liters::double precision AS tank_capacity_liters
      FROM vehicles v
      JOIN customers c ON c.id = v.customer_id
      LEFT JOIN drivers dr ON dr.id = v.driver_id
      LEFT JOIN LATERAL (
        SELECT imei, device_model, last_seen_at FROM devices
        WHERE vehicle_id = v.id ORDER BY is_active DESC, last_seen_at DESC NULLS LAST LIMIT 1
      ) d ON TRUE
      LEFT JOIN LATERAL (
        SELECT recorded_at, ignition_on, speed_kph FROM telemetry
        WHERE vehicle_id = v.id AND fuel_source IS DISTINCT FROM 'calibration'
          AND fuel_source IS DISTINCT FROM 'receipt' AND fuel_source IS DISTINCT FROM 'odometer_gap'
        ORDER BY recorded_at DESC LIMIT 1
      ) t ON TRUE
      LEFT JOIN LATERAL (
        SELECT latitude, longitude FROM telemetry
        WHERE vehicle_id = v.id AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND (latitude::numeric != 0 OR longitude::numeric != 0)
        ORDER BY recorded_at DESC LIMIT 1
      ) fix ON TRUE
      LEFT JOIN virtual_tanks vt ON vt.vehicle_id = v.id
      ORDER BY t.recorded_at DESC NULLS LAST, v.license_plate
    `);

    const now = Date.now();
    const vehicles = rows.rows.map((raw) => {
      const r = raw as Record<string, unknown>;
      const reported = r.recorded_at ? new Date(String(r.recorded_at)) : null;
      const seen = r.last_seen_at ? new Date(String(r.last_seen_at)) : null;
      const last = [reported, seen].filter((x): x is Date => x != null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      const ageMin = last ? (now - last.getTime()) / 60_000 : null;
      const speed = r.speed_kph != null ? Number(r.speed_kph) : null;
      // The FMC150/130 reports every few seconds with the engine on but only
      // about hourly when parked, so silence means different things: 15
      // minutes quiet mid-run is lost contact, while a parked vehicle is only
      // offline once it misses its hourly heartbeat.
      const status =
        !r.imei ? 'no_tracker'
        : ageMin == null ? 'never_reported'
        : r.ignition_on
          ? ageMin > RUNNING_SILENCE_MIN ? 'offline' : (speed ?? 0) >= 3 ? 'moving' : 'engine_on'
          : ageMin > PARKED_SILENCE_MIN ? 'offline' : 'parked';
      return {
        id: r.id,
        license_plate: r.license_plate,
        vehicle: [r.year, r.make, r.model].filter(Boolean).join(' ') || null,
        company: r.company,
        driver_name: r.driver_name ?? null,
        imei: r.imei ?? null,
        device_model: r.device_model ?? null,
        status,
        speed_kph: speed,
        last_report_at: last ? last.toISOString() : null,
        lat: r.lat != null ? Number(r.lat) : null,
        lng: r.lng != null ? Number(r.lng) : null,
        tank_liters: r.tank_liters != null ? Number(r.tank_liters) : null,
        tank_capacity_liters: r.tank_capacity_liters != null ? Number(r.tank_capacity_liters) : null,
      };
    });

    res.json({ generated_at: new Date().toISOString(), vehicles });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

export default router;
