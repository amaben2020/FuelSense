import express, { Request, Response } from 'express';
import { authenticateCustomer } from '../middleware/auth';
import { db, sql, eq, and } from '../lib/db-helpers';
import { maintenanceSchedules, maintenanceLogs, vehicles } from '../db/schema';
import { round1 } from '../lib/fuel-metrics';
import { isUniqueViolation, logAndRespond } from '../lib/errors';
import { SERVICE_CATALOGUE, serviceDefinition, serviceLabel } from '../lib/service-catalogue';

const router = express.Router();
router.use(authenticateCustomer);

/** Within this much of the interval, a service is "due soon" rather than fine. */
const DUE_SOON_KM = 500;
const DUE_SOON_DAYS = 14;

/**
 * Service schedules measured against the tracker's own odometer.
 *
 * The competing products anchor this to a mileage a driver types in, which
 * drifts the moment somebody forgets and makes every subsequent "overdue"
 * figure fiction. Here `current_km` is the vehicle's real total: the manager's
 * anchored baseline plus everything AVL 16 has counted since.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const customerId = req.user.customerId;

    const rows = await db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (t.vehicle_id)
          t.vehicle_id,
          COALESCE(t.odometer_m::double precision / 1000.0, t.odometer_km::double precision)
            AS device_km,
          t.recorded_at
        FROM telemetry t
        WHERE t.customer_id = ${customerId}
        ORDER BY t.vehicle_id, t.recorded_at DESC
      )
      SELECT
        m.id,
        m.vehicle_id,
        v.license_plate,
        v.make,
        v.model,
        m.kind,
        m.interval_km,
        m.interval_days,
        m.last_service_km,
        m.last_service_at,
        m.notes,
        -- True mileage: the anchored dashboard reading plus whatever the device
        -- has counted since that anchor. Falls back to the raw device total
        -- when no baseline has been set, which is honest but not the odometer
        -- on the dash.
        CASE
          WHEN v.odometer_baseline_km IS NOT NULL
            AND v.odometer_baseline_device_km IS NOT NULL
            THEN v.odometer_baseline_km + GREATEST(0, latest.device_km - v.odometer_baseline_device_km)
          ELSE latest.device_km
        END AS current_km,
        v.odometer_baseline_km IS NOT NULL AS odometer_anchored,
        latest.recorded_at AS odometer_at
      FROM maintenance_schedules m
      JOIN vehicles v ON v.id = m.vehicle_id
      LEFT JOIN latest ON latest.vehicle_id = m.vehicle_id
      WHERE m.customer_id = ${customerId}
      ORDER BY v.license_plate, m.kind
    `);

    const now = Date.now();
    const items = rows.rows.map((r) => {
      const row = r as Record<string, unknown>;
      const currentKm = row.current_km == null ? null : Number(row.current_km);
      const intervalKm = row.interval_km == null ? null : Number(row.interval_km);
      const lastKm = row.last_service_km == null ? null : Number(row.last_service_km);
      const intervalDays = row.interval_days == null ? null : Number(row.interval_days);
      const lastAt = row.last_service_at ? new Date(String(row.last_service_at)) : null;

      // Distance remaining until the next service falls due.
      const dueAtKm = intervalKm != null && lastKm != null ? lastKm + intervalKm : null;
      const kmRemaining =
        dueAtKm != null && currentKm != null ? round1(dueAtKm - currentKm) : null;

      const dueAtDate =
        intervalDays != null && lastAt
          ? new Date(lastAt.getTime() + intervalDays * 86_400_000)
          : null;
      const daysRemaining =
        dueAtDate != null ? Math.round((dueAtDate.getTime() - now) / 86_400_000) : null;

      // Whichever limit bites first decides the status — a van can hit its
      // distance interval long before its time one, or the reverse.
      // Nothing to count from: the interval is set but nobody has said when
      // it was last done. Shown as its own state rather than a quiet "OK".
      const needsBaseline = kmRemaining == null && daysRemaining == null;
      const overdue =
        (kmRemaining != null && kmRemaining < 0) || (daysRemaining != null && daysRemaining < 0);
      const dueSoon =
        !overdue &&
        ((kmRemaining != null && kmRemaining <= DUE_SOON_KM) ||
          (daysRemaining != null && daysRemaining <= DUE_SOON_DAYS));

      return {
        id: row.id,
        vehicle_id: row.vehicle_id,
        license_plate: row.license_plate,
        make: row.make,
        model: row.model,
        kind: row.kind,
        label: serviceLabel(String(row.kind)),
        group: serviceDefinition(String(row.kind))?.group ?? 'general',
        interval_km: intervalKm,
        interval_days: intervalDays,
        last_service_km: lastKm,
        last_service_at: row.last_service_at,
        notes: row.notes,
        current_km: currentKm == null ? null : round1(currentKm),
        /** False = mileage is device-since-fitting, not the dashboard reading. */
        odometer_anchored: Boolean(row.odometer_anchored),
        odometer_at: row.odometer_at,
        due_at_km: dueAtKm,
        km_remaining: kmRemaining,
        due_at: dueAtDate ? dueAtDate.toISOString() : null,
        days_remaining: daysRemaining,
        status: overdue ? 'overdue' : dueSoon ? 'due_soon' : needsBaseline ? 'needs_baseline' : 'ok',
      };
    });

    // Sort the way a manager reads it: what is late first, then what is close.
    const order = { overdue: 0, due_soon: 1, needs_baseline: 2, ok: 3 } as const;
    items.sort((a, b) => {
      const d = order[a.status as keyof typeof order] - order[b.status as keyof typeof order];
      if (d) return d;
      const ak = a.km_remaining ?? Infinity;
      const bk = b.km_remaining ?? Infinity;
      if (ak !== bk) return ak - bk;
      return (a.days_remaining ?? Infinity) - (b.days_remaining ?? Infinity);
    });

    const spend = await db.execute(sql`
      SELECT COALESCE(SUM(cost_ngn), 0)::bigint AS spend_90d, COUNT(*)::int AS services_90d
      FROM maintenance_logs
      WHERE customer_id = ${customerId} AND done_at > NOW() - INTERVAL '90 days'
    `);
    const sp = spend.rows[0] as Record<string, unknown> | undefined;

    res.json({
      thresholds: { due_soon_km: DUE_SOON_KM, due_soon_days: DUE_SOON_DAYS },
      overdue: items.filter((i) => i.status === 'overdue').length,
      due_soon: items.filter((i) => i.status === 'due_soon').length,
      needs_baseline: items.filter((i) => i.status === 'needs_baseline').length,
      spend_90d_ngn: Number(sp?.spend_90d ?? 0),
      services_90d: Number(sp?.services_90d ?? 0),
      items,
    });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/** The catalogue the form and the standard plan are built from. */
router.get('/catalogue', (_req: Request, res: Response) => {
  res.json({ items: SERVICE_CATALOGUE });
});

/**
 * Set a vehicle up with the standard plan in one go. Only kinds it does not
 * already have are added, so pressing it twice is harmless. Each new item
 * starts with "last done" unknown and asks to be told — inventing a
 * completion date would make every countdown fiction from day one.
 */
router.post('/plan', async (req: Request, res: Response) => {
  const vehicleId = String((req.body ?? {}).vehicle_id ?? '');
  const requested = Array.isArray((req.body ?? {}).kinds) ? ((req.body ?? {}).kinds as string[]) : null;
  if (!vehicleId) {
    res.status(400).json({ error: 'vehicle_id is required' });
    return;
  }
  try {
    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.customerId, req.user.customerId)))
      .limit(1);
    if (!vehicle) {
      res.status(404).json({ error: 'No such vehicle on this fleet.' });
      return;
    }
    const wanted = SERVICE_CATALOGUE.filter((d) => (requested ? requested.includes(d.kind) : d.core));
    const existing = await db
      .select({ kind: maintenanceSchedules.kind })
      .from(maintenanceSchedules)
      .where(eq(maintenanceSchedules.vehicleId, vehicleId));
    const have = new Set(existing.map((e) => e.kind));
    const toAdd = wanted.filter((d) => !have.has(d.kind));
    if (toAdd.length) {
      await db.insert(maintenanceSchedules).values(
        toAdd.map((d) => ({
          customerId: req.user.customerId,
          vehicleId,
          kind: d.kind,
          intervalKm: d.intervalKm,
          intervalDays: d.intervalDays,
        }))
      );
    }
    res.status(201).json({ added: toAdd.map((d) => d.kind), skipped: wanted.length - toAdd.length });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/** Everything done to the fleet's vehicles, newest first. */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const vehicleId = typeof req.query.vehicle_id === 'string' ? req.query.vehicle_id : null;
    const rows = await db.execute(sql`
      SELECT l.id, l.vehicle_id, v.license_plate, l.kind, l.done_at, l.odometer_km, l.cost_ngn,
             l.garage, l.notes, l.created_by, l.created_at
      FROM maintenance_logs l
      JOIN vehicles v ON v.id = l.vehicle_id
      WHERE l.customer_id = ${req.user.customerId}
        ${vehicleId ? sql`AND l.vehicle_id = ${vehicleId}` : sql``}
      ORDER BY l.done_at DESC, l.created_at DESC
      LIMIT 500
    `);
    res.json({
      entries: rows.rows.map((r) => {
        const row = r as Record<string, unknown>;
        return { ...row, label: serviceLabel(String(row.kind)) };
      }),
    });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.delete('/history/:id', async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .delete(maintenanceLogs)
      .where(and(eq(maintenanceLogs.id, String(req.params.id)), eq(maintenanceLogs.customerId, req.user.customerId)))
      .returning({ id: maintenanceLogs.id });
    if (!row) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/** Change the interval, or correct when it was last done. */
router.patch('/:id', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: sql`NOW()` };
  if ('interval_km' in body) patch.intervalKm = body.interval_km == null ? null : Number(body.interval_km);
  if ('interval_days' in body) patch.intervalDays = body.interval_days == null ? null : Number(body.interval_days);
  if ('last_service_km' in body) patch.lastServiceKm = body.last_service_km == null ? null : Number(body.last_service_km);
  if ('last_service_at' in body) patch.lastServiceAt = body.last_service_at ? new Date(String(body.last_service_at)) : null;
  if ('notes' in body) patch.notes = body.notes == null ? null : String(body.notes);
  if (Object.keys(patch).length === 1) {
    res.status(400).json({ error: 'Nothing to change.' });
    return;
  }
  if (patch.intervalKm === null && patch.intervalDays === null) {
    res.status(400).json({ error: 'Keep at least one of distance or time.' });
    return;
  }
  // A corrected baseline is a new interval: let the reminders fire afresh.
  if ('last_service_km' in body || 'last_service_at' in body) {
    patch.dueSoonAlertedAt = null;
    patch.overdueAlertedAt = null;
  }
  try {
    const [row] = await db
      .update(maintenanceSchedules)
      .set(patch)
      .where(and(eq(maintenanceSchedules.id, String(req.params.id)), eq(maintenanceSchedules.customerId, req.user.customerId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }
    res.json(row);
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.post('/', async (req: Request, res: Response) => {
  const {
    vehicle_id: vehicleId,
    kind,
    interval_km: intervalKm,
    interval_days: intervalDays,
    last_service_km: lastServiceKm,
    last_service_at: lastServiceAt,
    notes,
  } = req.body ?? {};

  if (!vehicleId || !kind?.trim()) {
    res.status(400).json({ error: 'vehicle_id and kind are required' });
    return;
  }
  if (intervalKm == null && intervalDays == null) {
    res.status(400).json({ error: 'one of interval_km or interval_days is required' });
    return;
  }

  try {
    const [row] = await db
      .insert(maintenanceSchedules)
      .values({
        customerId: req.user.customerId,
        vehicleId,
        kind: String(kind).trim(),
        intervalKm: intervalKm == null ? null : Number(intervalKm),
        intervalDays: intervalDays == null ? null : Number(intervalDays),
        lastServiceKm: lastServiceKm == null ? null : Number(lastServiceKm),
        lastServiceAt: lastServiceAt ? new Date(lastServiceAt) : null,
        notes: notes ?? null,
      })
      .returning();
    res.status(201).json(row);
  } catch (error) {
    // One schedule per kind per vehicle — two "oil_change" rows would race.
    if (isUniqueViolation(error)) {
      // The stored kind is snake_case; the message is read by a person.
      const readable = String(kind).trim().replace(/_/g, ' ');
      res.status(409).json({ error: `"${readable}" is already scheduled for this vehicle` });
      return;
    }
    logAndRespond(res, req.path, error);
  }
});

/**
 * Log a completed service — resets the interval from the current odometer
 * and writes the history row that outlives the schedule.
 */
router.patch('/:id/complete', async (req: Request, res: Response) => {
  const { at_km: atKm, done_at: doneAtRaw, cost_ngn: costRaw, garage, notes } = (req.body ?? {}) as {
    at_km?: number | null;
    done_at?: string | null;
    cost_ngn?: number | null;
    garage?: string | null;
    notes?: string | null;
  };
  const doneAt = doneAtRaw ? new Date(doneAtRaw) : new Date();
  if (Number.isNaN(doneAt.getTime())) {
    res.status(400).json({ error: 'done_at must be a date' });
    return;
  }
  try {
    // Marking a service done without naming an odometer reading used to store
    // NULL, which erased the distance baseline: the schedule then had nothing
    // to count from and could never fall due on mileage again. The tracker
    // already knows where the vehicle is, so an unspecified reading means
    // "here, now" rather than "unknown".
    let resolvedKm: number | null = atKm == null ? null : Number(atKm);
    if (resolvedKm == null) {
      const current = await db.execute(sql`
        SELECT
          CASE
            WHEN v.odometer_baseline_km IS NOT NULL
              AND v.odometer_baseline_device_km IS NOT NULL
              THEN v.odometer_baseline_km
                 + GREATEST(0, latest.device_km - v.odometer_baseline_device_km)
            ELSE latest.device_km
          END AS current_km
        FROM maintenance_schedules m
        JOIN vehicles v ON v.id = m.vehicle_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(t.odometer_m::double precision / 1000.0, t.odometer_km::double precision)
                 AS device_km
          FROM telemetry t
          WHERE t.vehicle_id = m.vehicle_id AND t.customer_id = m.customer_id
          ORDER BY t.recorded_at DESC
          LIMIT 1
        ) latest ON true
        WHERE m.id = ${String(req.params.id)} AND m.customer_id = ${req.user.customerId}
      `);
      const km = (current.rows[0] as Record<string, unknown> | undefined)?.current_km;
      // Still null when the vehicle has never reported an odometer — then the
      // schedule is genuinely time-based and NULL is the honest value.
      resolvedKm = km == null ? null : Math.round(Number(km));
    }

    const [row] = await db
      .update(maintenanceSchedules)
      .set({
        lastServiceKm: resolvedKm,
        lastServiceAt: doneAt,
        dueSoonAlertedAt: null,
        overdueAlertedAt: null,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(maintenanceSchedules.id, String(req.params.id)),
          eq(maintenanceSchedules.customerId, req.user.customerId)
        )
      )
      .returning();

    if (!row) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    await db.insert(maintenanceLogs).values({
      customerId: req.user.customerId,
      vehicleId: row.vehicleId,
      scheduleId: row.id,
      kind: row.kind,
      doneAt,
      odometerKm: resolvedKm,
      costNgn: costRaw == null || costRaw === ('' as unknown) ? null : Math.round(Number(costRaw)),
      garage: garage ? String(garage).trim().slice(0, 160) : null,
      notes: notes ? String(notes).trim().slice(0, 2000) : null,
      createdBy: req.user.name || req.user.email,
    });

    res.json(row);
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .delete(maintenanceSchedules)
      .where(
        and(
          eq(maintenanceSchedules.id, String(req.params.id)),
          eq(maintenanceSchedules.customerId, req.user.customerId)
        )
      )
      .returning({ id: maintenanceSchedules.id });

    if (!row) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

export default router;
