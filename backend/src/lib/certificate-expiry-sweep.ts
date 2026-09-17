// Raises the alert a week before a vehicle licence lapses, and again when it
// has.
//
// A certificate table nobody looks at is a filing cabinet. The value is in
// the reminder arriving while there is still time to drive to the licensing
// office — hence a week, not a day — and in it arriving where the manager
// already looks: the alert feed, with its badge, toast and optional email.
// Each certificate raises each alert once; the `*_alert_sent_at` stamps are
// cleared when the expiry date is edited, so a renewed paper starts clean.
import { db, sql, alerts, customers, notificationPreferences, eq, and } from './db-helpers';
import { sendMail, mailerReady, alertEmail } from './mailer';

export const CERT_EXPIRING_ALERT = 'vio_cert_expiring';
export const CERT_EXPIRED_ALERT = 'vio_cert_expired';

const WARNING_DAYS = Number(process.env.CERT_EXPIRY_WARNING_DAYS || 7);

interface DueRow {
  id: string;
  customer_id: string;
  vehicle_id: string | null;
  registration_number: string | null;
  license_plate: string | null;
  driver_name: string | null;
  issuing_state: string | null;
  expires_on: string;
  days_left: number;
}

const longDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

function describe(row: DueRow): { subject: string; message: string } {
  const who = row.license_plate ?? row.registration_number ?? row.driver_name ?? 'A vehicle';
  const where = row.issuing_state ? ` (${row.issuing_state} State)` : '';
  const on = longDate(row.expires_on);
  if (row.days_left < 0) {
    const ago = Math.abs(row.days_left);
    return {
      subject: `${who}: vehicle licence expired`,
      message: `${who}'s vehicle licence${where} expired on ${on} — ${ago === 0 ? 'today' : `${ago} day${ago === 1 ? '' : 's'} ago`}. It should not be on the road until it is renewed.`,
    };
  }
  const left = row.days_left === 0 ? 'today' : row.days_left === 1 ? 'tomorrow' : `in ${row.days_left} days`;
  return {
    subject: `${who}: vehicle licence expires ${left}`,
    message: `${who}'s vehicle licence${where} expires ${left}, on ${on}. Renew it before then to avoid a fine at a checkpoint.`,
  };
}

async function email(row: DueRow, alertType: string, subject: string, message: string): Promise<void> {
  if (!mailerReady()) return;
  const [pref] = await db
    .select({ enabled: notificationPreferences.emailEnabled, address: notificationPreferences.emailAddress })
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.customerId, row.customer_id), eq(notificationPreferences.alertType, alertType)))
    .limit(1);
  if (!pref?.enabled) return;

  const [account] = await db.select({ email: customers.email }).from(customers).where(eq(customers.id, row.customer_id)).limit(1);
  const to = pref.address || account?.email;
  if (!to) return;

  const { text, html } = alertEmail({
    title: subject,
    imageUrl: null,
    imageCaption: null,
    lines: [
      ['Vehicle', row.license_plate ?? row.registration_number ?? '—'],
      ['Driver', row.driver_name ?? '—'],
      ['Issued by', row.issuing_state ? `${row.issuing_state} State` : '—'],
      ['Expires', longDate(row.expires_on)],
      ['Status', message],
    ],
    linkUrl: null,
    linkLabel: null,
    footer: 'FuelSense · Settings → Notifications turns these off',
  });
  await sendMail({ to, subject, text, html });
}

async function raise(rows: DueRow[], alertType: string, stampColumn: 'expiry_alert_sent_at' | 'expired_alert_sent_at'): Promise<number> {
  let raised = 0;
  for (const row of rows) {
    const { subject, message } = describe(row);
    try {
      await db.insert(alerts).values({
        customerId: row.customer_id,
        vehicleId: row.vehicle_id,
        alertType,
        message,
      });
      await db.execute(sql`
        UPDATE vehicle_certificates SET ${sql.raw(stampColumn)} = NOW() WHERE id = ${row.id}
      `);
      raised += 1;
    } catch (err) {
      console.error('[certificate_expiry] alert insert failed:', err);
      continue;
    }
    await email(row, alertType, subject, message).catch((err) =>
      console.error('[certificate_expiry] email failed:', err)
    );
  }
  return raised;
}

const dueSelect = sql`
  SELECT c.id, c.customer_id, c.vehicle_id, c.registration_number, c.issuing_state,
         c.expires_on::text AS expires_on,
         (c.expires_on - CURRENT_DATE)::int AS days_left,
         v.license_plate, d.full_name AS driver_name
  FROM vehicle_certificates c
  LEFT JOIN vehicles v ON v.id = c.vehicle_id
  LEFT JOIN drivers d ON d.id = c.driver_id
`;

export async function sweepCertificateExpiry(): Promise<{ expiring: number; expired: number }> {
  const expiring = await db.execute(sql`
    ${dueSelect}
    WHERE c.expiry_alert_sent_at IS NULL
      AND c.expires_on >= CURRENT_DATE
      AND c.expires_on <= CURRENT_DATE + ${WARNING_DAYS}::int
    LIMIT 200
  `);
  const expired = await db.execute(sql`
    ${dueSelect}
    WHERE c.expired_alert_sent_at IS NULL
      AND c.expires_on < CURRENT_DATE
    LIMIT 200
  `);
  return {
    expiring: await raise(expiring.rows as unknown as DueRow[], CERT_EXPIRING_ALERT, 'expiry_alert_sent_at'),
    expired: await raise(expired.rows as unknown as DueRow[], CERT_EXPIRED_ALERT, 'expired_alert_sent_at'),
  };
}

let timer: NodeJS.Timeout | null = null;

/** Hourly is plenty for a deadline measured in days; the first pass runs at
 *  boot so a restart never delays a reminder past the day it was due. */
export function startCertificateExpirySweep(intervalMs = 60 * 60 * 1000): void {
  if (timer) return;
  const run = async () => {
    try {
      const { expiring, expired } = await sweepCertificateExpiry();
      if (expiring || expired) {
        console.log(`[certificate_expiry] ${expiring} expiring, ${expired} expired alert(s) raised`);
      }
    } catch (error) {
      console.error('[certificate_expiry] failed:', (error as Error).message);
    }
  };
  timer = setInterval(run, intervalMs);
  timer.unref?.();
  void run();
}
