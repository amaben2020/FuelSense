// Shared opt-in and recipient resolution for alert email.
//
// Preferences are per customer per alert type and default to OFF — a missing
// row means the manager never asked for this mail, so nothing is sent. Who it
// goes to is one rule for every alert: the per-alert address if one is set,
// plus everyone on the fleet's recipient list (Settings → Notifications), and
// only when both are empty the account email — which on a seeded account is
// a placeholder the mailer refuses, so that fallback is for real sign-ups.
import { db, customers, notificationPreferences, eq, and } from './db-helpers';
import { mailerReady, isDeliverable } from './mailer';

/** Fleet-wide recipients plus the account fallback, deliverable ones only. */
export async function fleetRecipients(
  customerId: string,
  extra: Array<string | null | undefined> = []
): Promise<string[]> {
  const [account] = await db
    .select({ email: customers.email, list: customers.notificationEmails })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  const named = [...extra, ...(account?.list ?? [])]
    .map((e) => (e ?? '').trim().toLowerCase())
    .filter((e) => e && isDeliverable(e));
  const unique = [...new Set(named)];
  if (unique.length) return unique;
  return account?.email && isDeliverable(account.email) ? [account.email.toLowerCase()] : [];
}

/**
 * Where this alert type should go, or null when it must not be sent (mailer
 * unconfigured, not opted in, or nobody deliverable to send it to).
 */
export async function resolveAlertRecipient(
  customerId: string,
  alertType: string
): Promise<string[] | null> {
  if (!mailerReady()) return null;

  const [pref] = await db
    .select({
      enabled: notificationPreferences.emailEnabled,
      address: notificationPreferences.emailAddress,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.customerId, customerId),
        eq(notificationPreferences.alertType, alertType)
      )
    )
    .limit(1);

  if (!pref?.enabled) return null;
  const to = await fleetRecipients(customerId, [pref.address]);
  return to.length ? to : null;
}
