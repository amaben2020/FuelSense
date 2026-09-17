import express, { Request, Response } from 'express';
import { authenticateCustomer } from '../middleware/auth';
import { FEATURES, resolveFeatureFlags, setFeatureFlag } from '../lib/feature-flags';
import {
  VEHICLE_TYPE_PRESETS,
  CALIBRATION_MIN_PURCHASES,
  SPEED_BUCKETS,
  presetForVehicleType,
} from '../lib/fuel-metrics';
import { ALERT_CATALOGUE } from '../lib/alert-catalogue';
import {
  DEFAULT_OFFLINE_MINUTES,
  DEVICE_OFFLINE_ALERT,
  OFFLINE_THRESHOLD_CHOICES,
} from '../lib/device-offline-watchdog';
import { db, notificationPreferences, eq, and, sql } from '../lib/db-helpers';
import { logAndRespond } from '../lib/errors';
import { isDeliverable } from '../lib/mailer';
import { customers } from '../db/schema';
import { DAILY_REPORT_PREF, SEND_HOUR_WAT } from '../lib/daily-report-mailer';

const router = express.Router();

router.use(authenticateCustomer);

/** Effective flags plus the catalogue, so Settings can render toggles without
 *  duplicating the feature list on the client. */
router.get('/', async (req: Request, res: Response) => {
  try {
    const flags = await resolveFeatureFlags(req.user.customerId);
    res.json({
      flags,
      catalogue: FEATURES.map((f) => ({
        key: f.key,
        label: f.label,
        description: f.description,
        default_enabled: f.defaultEnabled,
        enabled: flags[f.key],
      })),
    });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.patch('/:key', async (req: Request, res: Response) => {
  const { enabled, note } = req.body as { enabled?: boolean; note?: string };

  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }

  try {
    await setFeatureFlag(req.user.customerId, String(req.params.key), enabled, note);
    res.json({ success: true, flags: await resolveFeatureFlags(req.user.customerId) });
  } catch (error) {
    const err = error as Error & { status?: number };
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

/** The tuning constants behind fuel estimates, exposed so the calibration and
 *  features pages can describe the live configuration instead of hardcoding it. */
router.get('/fuel-config', async (_req: Request, res: Response) => {
  res.json({
    vehicle_types: Object.entries(VEHICLE_TYPE_PRESETS).map(([key, p]) => ({
      key,
      label: p.label,
      consumption_l_per_100km: p.consumptionL100km,
      idle_burn_l_per_hour: p.idleBurnLph,
    })),
    speed_buckets: SPEED_BUCKETS.map((b) => ({
      label: b.label,
      up_to_kph: b.maxKph === Infinity ? null : b.maxKph,
      multiplier: b.multiplier,
    })),
    calibration_min_purchases: CALIBRATION_MIN_PURCHASES,
  });
});

/** Everything the Documentation page renders — alerts, how estimates work, and
 *  the limits worth being honest about. Generated from the same constants the
 *  engines use, so the docs cannot drift from the behaviour. */
router.get('/documentation', async (req: Request, res: Response) => {
  try {
    const prefs = await db
      .select({
        alertType: notificationPreferences.alertType,
        emailEnabled: notificationPreferences.emailEnabled,
        emailAddress: notificationPreferences.emailAddress,
        thresholdMinutes: notificationPreferences.thresholdMinutes,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.customerId, req.user.customerId));

    const prefBy = new Map(prefs.map((p) => [p.alertType, p]));

    const lastRun = (
      await db.execute(sql`
        SELECT report_date, sent_at FROM report_runs
        WHERE customer_id = ${req.user.customerId} AND report_type = 'daily'
        ORDER BY sent_at DESC LIMIT 1
      `)
    ).rows[0] as { report_date: string; sent_at: string } | undefined;
    const reportPref = prefBy.get(DAILY_REPORT_PREF);
    // The fallback recipient is the account's email, not whoever is signed in.
    const account = (
      await db.execute(sql`SELECT email, notification_emails FROM customers WHERE id = ${req.user.customerId}`)
    ).rows[0] as { email: string; notification_emails: string[] | null } | undefined;

    res.json({
      /** Everyone this fleet's email goes to — alerts and the daily report. */
      recipients: account?.notification_emails ?? [],
      account_email: account?.email ?? null,
      account_email_deliverable: isDeliverable(account?.email),
      /** The evening fleet report: on unless switched off, sent to the address
       *  here plus the recipient list, or else the account email. */
      daily_report: {
        enabled: reportPref?.emailEnabled ?? true,
        email_address: reportPref?.emailAddress ?? null,
        account_email: account?.email ?? null,
        account_email_deliverable: isDeliverable(account?.email),
        send_hour_wat: SEND_HOUR_WAT,
        last_report_date: lastRun?.report_date ?? null,
        last_sent_at: lastRun?.sent_at ?? null,
      },
      alerts: ALERT_CATALOGUE.map((a) => ({
        ...a,
        email_enabled: prefBy.get(a.type)?.emailEnabled ?? false,
        email_address: prefBy.get(a.type)?.emailAddress ?? null,
        threshold_minutes: prefBy.get(a.type)?.thresholdMinutes ?? null,
        /** Only the offline alert waits before firing, so only it is tunable. */
        threshold_choices:
          a.type === DEVICE_OFFLINE_ALERT ? [...OFFLINE_THRESHOLD_CHOICES] : null,
        threshold_default: a.type === DEVICE_OFFLINE_ALERT ? DEFAULT_OFFLINE_MINUTES : null,
      })),
      fuel: {
        vehicle_types: Object.entries(VEHICLE_TYPE_PRESETS).map(([key, p]) => ({
          key,
          label: p.label,
          consumption_l_per_100km: p.consumptionL100km,
          idle_burn_l_per_hour: p.idleBurnLph,
        })),
        speed_buckets: SPEED_BUCKETS.map((b) => ({
          label: b.label,
          up_to_kph: b.maxKph === Infinity ? null : b.maxKph,
          multiplier: b.multiplier,
        })),
        calibration_min_purchases: CALIBRATION_MIN_PURCHASES,
      },
      limitations: [
        'Fuel level is calculated from movement and logged purchases, not read from a tank sensor. It is an estimate that improves as fill-ups are logged.',
        'Siphoning while parked cannot be detected in real time. What the platform catches is consumption that does not match distance, and fuel claims that do not match the vehicle’s real rate.',
        'Device scenario alerts — overspeeding, towing, crash, jamming, geofences — only fire if those scenarios are enabled on the tracker itself.',
      ],
    });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/** Live calibration state per vehicle — what rate each is running on, whether
 *  it is still the class preset, and how many more fill-ups it needs. Turns the
 *  explainer page into something actionable rather than static copy. */
router.get('/calibration-status', async (req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT
        v.id AS vehicle_id,
        v.license_plate,
        v.vehicle_type,
        v.consumption_rate_l_per_100km::double precision AS rate,
        v.idle_burn_rate_l_per_hour::double precision AS idle_rate,
        v.rate_source,
        COUNT(fp.id) FILTER (
          WHERE fp.real_consumption_l_per_100km IS NOT NULL
            AND fp.implausible_odometer = false
        ) AS usable_measurements,
        COUNT(fp.id) AS purchases_logged,
        COUNT(fp.id) FILTER (WHERE fp.distance_mismatch) AS distance_mismatches,
        MAX(fp.purchased_at) AS last_purchase_at
      FROM vehicles v
      LEFT JOIN fuel_purchases fp ON fp.vehicle_id = v.id
      WHERE v.customer_id = ${req.user.customerId}
      GROUP BY v.id, v.license_plate, v.vehicle_type,
               v.consumption_rate_l_per_100km, v.idle_burn_rate_l_per_hour, v.rate_source
      ORDER BY v.license_plate
    `);

    const vehicles = (result.rows as Array<Record<string, unknown>>).map((r) => {
      const usable = Number(r.usable_measurements ?? 0);
      return {
        vehicle_id: r.vehicle_id,
        license_plate: r.license_plate,
        vehicle_type: r.vehicle_type,
        vehicle_type_label: presetForVehicleType(r.vehicle_type as string).label,
        rate_l_per_100km: r.rate != null ? Number(r.rate) : null,
        idle_burn_l_per_hour: r.idle_rate != null ? Number(r.idle_rate) : null,
        rate_source: r.rate_source,
        purchases_logged: Number(r.purchases_logged ?? 0),
        usable_measurements: usable,
        distance_mismatches: Number(r.distance_mismatches ?? 0),
        // What the manager can actually do about it.
        fill_ups_until_calibrated: Math.max(0, CALIBRATION_MIN_PURCHASES - usable),
        last_purchase_at: r.last_purchase_at,
      };
    });

    res.json({ calibration_min_purchases: CALIBRATION_MIN_PURCHASES, vehicles });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/**
 * The fleet's recipient list. Whole-list replace, so removing an address is
 * the same call as adding one; the UI sends what it shows.
 */
router.put('/recipients', async (req: Request, res: Response) => {
  if (req.user.role !== 'manager') {
    res.status(403).json({ error: 'Only a manager can change who receives email.' });
    return;
  }
  const raw = (req.body ?? {}).emails;
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: 'emails must be an array of addresses' });
    return;
  }
  const emails = [...new Set(raw.map((e) => String(e ?? '').trim().toLowerCase()).filter(Boolean))];
  const bad = emails.filter((e) => !isDeliverable(e));
  if (bad.length) {
    res.status(400).json({ error: `Not a deliverable address: ${bad.join(', ')}` });
    return;
  }
  if (emails.length > 20) {
    res.status(400).json({ error: 'Up to 20 addresses.' });
    return;
  }
  try {
    await db.update(customers).set({ notificationEmails: emails }).where(eq(customers.id, req.user.customerId));
    res.json({ success: true, recipients: emails });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/** Opt in or out of email for a given alert type, and how long it waits. */
router.patch('/notifications/:alertType', async (req: Request, res: Response) => {
  const alertType = String(req.params.alertType);
  const { emailEnabled, emailAddress, thresholdMinutes } = req.body as {
    emailEnabled?: boolean;
    emailAddress?: string | null;
    thresholdMinutes?: number | null;
  };

  if (typeof emailEnabled !== 'boolean') {
    res.status(400).json({ error: 'emailEnabled must be a boolean' });
    return;
  }
  if (alertType !== DAILY_REPORT_PREF && !ALERT_CATALOGUE.some((a) => a.type === alertType)) {
    res.status(400).json({ error: `Unknown alert type "${alertType}"` });
    return;
  }
  // The address is checked here, not at send time: a typo should fail the
  // form, not silently stop the report months later.
  if (emailAddress != null && emailAddress !== '' && !isDeliverable(String(emailAddress))) {
    res.status(400).json({ error: 'That email address does not look deliverable.' });
    return;
  }
  // Rejected rather than clamped: a manager who picks 5 minutes should be told
  // it is not available, not quietly given 15 and left wondering.
  if (
    thresholdMinutes != null &&
    !OFFLINE_THRESHOLD_CHOICES.includes(Number(thresholdMinutes) as never)
  ) {
    res.status(400).json({
      error: `thresholdMinutes must be one of ${OFFLINE_THRESHOLD_CHOICES.join(', ')}`,
    });
    return;
  }
  if (thresholdMinutes != null && alertType !== DEVICE_OFFLINE_ALERT) {
    res.status(400).json({ error: 'Only the offline alert has a waiting period' });
    return;
  }

  try {
    const [existing] = await db
      .select({ id: notificationPreferences.id })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.customerId, req.user.customerId),
          eq(notificationPreferences.alertType, alertType)
        )
      )
      .limit(1);

    // Omitting the key leaves the stored waiting period alone; sending it as
    // null is the explicit "go back to the platform default". Without that
    // distinction, toggling email off from anywhere else would silently reset
    // a threshold the manager had chosen.
    const touchesThreshold = Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      'thresholdMinutes'
    );
    const threshold = thresholdMinutes == null ? null : Number(thresholdMinutes);

    if (existing) {
      await db
        .update(notificationPreferences)
        .set({
          emailEnabled,
          emailAddress: emailAddress?.trim() || null,
          ...(touchesThreshold ? { thresholdMinutes: threshold } : {}),
          updatedAt: sql`NOW()`,
        })
        .where(eq(notificationPreferences.id, existing.id));
    } else {
      await db.insert(notificationPreferences).values({
        customerId: req.user.customerId,
        alertType,
        emailEnabled,
        emailAddress: emailAddress?.trim() || null,
        thresholdMinutes: touchesThreshold ? threshold : null,
      });
    }

    res.json({
      success: true,
      alert_type: alertType,
      email_enabled: emailEnabled,
      threshold_minutes: threshold,
    });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

export default router;
