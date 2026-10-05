// Sign-up email verification. SendGrid delivers the link; ownership is proved
// by the token in it, which we store only as a sha256 hash.
import crypto from 'crypto';
import { db, customers, eq } from '../../shared/db-helpers';
import { sendMail, alertEmail } from '../../shared/mailer';

export const VERIFY_TTL_HOURS = 48;
export const RESEND_COOLDOWN_SECONDS = 60;

// Fixed by config, never taken from the request: a link built from the
// caller's Origin would let anyone mail a victim a real token on a lookalike
// domain.
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL || 'https://api.fuelsense.ng').replace(/\/$/, '');
export const APP_URL = (process.env.APP_URL || 'https://fuelsense.ng').replace(/\/$/, '');

export const hashVerifyToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

/** Issues a fresh link (invalidating any earlier one) and emails it. */
export async function sendVerificationEmail(customer: {
  id: string;
  name: string;
  email: string;
}): Promise<boolean> {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .update(customers)
    .set({ emailVerifyTokenHash: hashVerifyToken(token), emailVerifySentAt: new Date() })
    .where(eq(customers.id, customer.id));

  const link = `${API_PUBLIC_URL}/api/auth/verify-email?token=${token}`;
  const { text, html } = alertEmail({
    title: 'Confirm your email for FuelSense',
    lines: [
      ['Account', customer.name],
      ['Email', customer.email],
      ['Link expires', `in ${VERIFY_TTL_HOURS} hours`],
    ],
    linkUrl: link,
    linkLabel: 'Confirm email',
    footer:
      'Until you confirm, FuelSense will not send alerts or daily reports to this account. ' +
      'If you did not sign up, ignore this email.',
  });

  // bypassOverride: the link must reach the person who signed up, not the
  // developer inbox ALERT_EMAIL_OVERRIDE redirects seeded-account mail to.
  return sendMail({
    to: customer.email,
    subject: 'Confirm your email for FuelSense',
    text,
    html,
    bypassOverride: true,
  });
}
