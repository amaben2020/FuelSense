// The developer's view across every fleet on the platform.
//
// Not a product feature: a single page for whoever runs the servers to see
// which companies exist, when someone from each last signed in, and when
// each fleet's trackers last reported — the three things that say whether
// an onboarding took. Gated by email, not role, because "manager" is a
// customer-side role and every fleet has one.
import express, { Request, Response } from 'express';
import { authenticateCustomer } from '../middleware/auth';
import { db, sql } from '../lib/db-helpers';
import { logAndRespond } from '../lib/errors';

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

export default router;
