// Turns a service falling due into something the manager is told about,
// rather than something they would have found by opening the page.
//
// Once per interval per schedule: "due soon" when it crosses the threshold,
// "overdue" when it passes the mark. Logging the service clears both stamps
// so the next interval starts fresh. Distance and time are judged the same
// way the page judges them, from the anchored odometer.
import { db, sql, alerts } from '../../shared/db-helpers';
import { serviceLabel } from './service-catalogue.service';
import { resolveAlertRecipient } from '../alerts/alert-mail.service';
import { sendMail, alertEmail } from '../../shared/mailer';

export const SERVICE_DUE_SOON_ALERT = 'service_due_soon';
export const SERVICE_OVERDUE_ALERT = 'service_overdue';

const DUE_SOON_KM = 500;
const DUE_SOON_DAYS = 14;
const KM_TO_MILES = 0.621371;

interface DueRow {
  id: string;
  customer_id: string;
  vehicle_id: string;
  license_plate: string | null;
  kind: string;
  km_remaining: number | null;
  days_remaining: number | null;
  due_soon_alerted_at: string | null;
  overdue_alerted_at: string | null;
}

const miles = (km: number) => `${Math.abs(Math.round(km * KM_TO_MILES)).toLocaleString('en-NG')} mi`;

function describe(row: DueRow, overdue: boolean): string {
  const plate = row.license_plate ?? 'A vehicle';
  const item = serviceLabel(row.kind).toLowerCase();
  const km = row.km_remaining;
  const days = row.days_remaining;
  if (overdue) {
    const by =
      km != null && km < 0
        ? `${miles(km)} past due`
        : days != null && days < 0
          ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} past due`
          : 'past due';
    return `${plate}: ${item} is overdue — ${by}. Book it before the next long trip.`;
  }
  const inWhat =
    km != null && km <= DUE_SOON_KM
      ? `in about ${miles(km)}`
      : days != null
        ? days <= 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`
        : 'soon';
  return `${plate}: ${item} is due ${inWhat}.`;
}

export async function sweepServiceReminders(): Promise<{ dueSoon: number; overdue: number }> {
  const rows = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (t.vehicle_id)
        t.vehicle_id,
        COALESCE(t.odometer_m::double precision / 1000.0, t.odometer_km::double precision) AS device_km
      FROM telemetry t
      WHERE t.recorded_at > NOW() - INTERVAL '90 days'
      ORDER BY t.vehicle_id, t.recorded_at DESC
    ),
    computed AS (
      SELECT
        m.id, m.customer_id, m.vehicle_id, v.license_plate, m.kind,
        m.due_soon_alerted_at, m.overdue_alerted_at,
        CASE
          WHEN m.interval_km IS NOT NULL AND m.last_service_km IS NOT NULL AND latest.device_km IS NOT NULL
          THEN (m.last_service_km + m.interval_km) - (
            CASE
              WHEN v.odometer_baseline_km IS NOT NULL AND v.odometer_baseline_device_km IS NOT NULL
              THEN v.odometer_baseline_km + GREATEST(0, latest.device_km - v.odometer_baseline_device_km)
              ELSE latest.device_km
            END)
        END AS km_remaining,
        CASE
          WHEN m.interval_days IS NOT NULL AND m.last_service_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM ((m.last_service_at + (m.interval_days || ' days')::interval) - NOW())) / 86400.0
        END AS days_remaining
      FROM maintenance_schedules m
      JOIN vehicles v ON v.id = m.vehicle_id
      LEFT JOIN latest ON latest.vehicle_id = m.vehicle_id
    )
    SELECT * FROM computed
    WHERE (km_remaining IS NOT NULL AND km_remaining <= ${DUE_SOON_KM})
       OR (days_remaining IS NOT NULL AND days_remaining <= ${DUE_SOON_DAYS})
  `);

  let dueSoon = 0;
  let overdue = 0;
  for (const raw of rows.rows as unknown as DueRow[]) {
    const km = raw.km_remaining == null ? null : Number(raw.km_remaining);
    const days = raw.days_remaining == null ? null : Math.round(Number(raw.days_remaining));
    const row = { ...raw, km_remaining: km, days_remaining: days };
    const isOverdue = (km != null && km < 0) || (days != null && days < 0);

    const alertType = isOverdue ? SERVICE_OVERDUE_ALERT : SERVICE_DUE_SOON_ALERT;
    const already = isOverdue ? row.overdue_alerted_at : row.due_soon_alerted_at;
    if (already) continue;

    const message = describe(row, isOverdue);
    try {
      await db.insert(alerts).values({
        customerId: row.customer_id,
        vehicleId: row.vehicle_id,
        alertType,
        message,
      });
      await db.execute(sql`
        UPDATE maintenance_schedules
        SET ${sql.raw(isOverdue ? 'overdue_alerted_at' : 'due_soon_alerted_at')} = NOW()
        WHERE id = ${row.id}
      `);
      if (isOverdue) overdue += 1;
      else dueSoon += 1;
    } catch (err) {
      console.error('[service_reminder] alert insert failed:', err);
      continue;
    }

    const to = await resolveAlertRecipient(row.customer_id, alertType).catch(() => null);
    if (!to) continue;
    const { text, html } = alertEmail({
      title: message,
      imageUrl: null,
      imageCaption: null,
      lines: [
        ['Vehicle', row.license_plate ?? '—'],
        ['Service', serviceLabel(row.kind)],
        ['Status', isOverdue ? 'Overdue' : 'Due soon'],
      ],
      linkUrl: null,
      linkLabel: null,
      footer: 'FuelSense · Settings → Notifications turns these off',
    });
    await sendMail({ to, subject: message, text, html }).catch((err) =>
      console.error('[service_reminder] email failed:', err)
    );
  }
  return { dueSoon, overdue };
}

let timer: NodeJS.Timeout | null = null;

export function startServiceReminderSweep(intervalMs = 60 * 60 * 1000): void {
  if (timer) return;
  const run = async () => {
    try {
      const { dueSoon, overdue } = await sweepServiceReminders();
      if (dueSoon || overdue) console.log(`[service_reminder] ${dueSoon} due soon, ${overdue} overdue alert(s) raised`);
    } catch (error) {
      console.error('[service_reminder] failed:', (error as Error).message);
    }
  };
  timer = setInterval(run, intervalMs);
  timer.unref?.();
  void run();
}
