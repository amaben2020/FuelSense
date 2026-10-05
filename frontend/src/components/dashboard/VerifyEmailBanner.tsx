'use client';

import { useEffect, useState } from 'react';
import { MailWarning } from 'lucide-react';
import { api, type Customer } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

/**
 * Shown to the account holder of a new sign-up until they click the link in
 * the welcome email. Alerts and the daily report are held until then, so the
 * banner says so rather than letting a quiet inbox read as a quiet fleet.
 *
 * The cached customer can be stale — verified in another tab — so it is only
 * the trigger; /auth/me decides.
 */
export function VerifyEmailBanner() {
  const cached = useAuthStore((s) => s.customer);
  const setCustomer = useAuthStore((s) => s.setCustomer);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [note, setNote] = useState<string | null>(null);

  const isHolder = !cached?.user || cached.user.email === cached.email;
  const unverified = cached != null && cached.email_verified_at === null && isHolder;

  useEffect(() => {
    if (!unverified) return;
    api<Customer>('/auth/me')
      .then((me) => {
        if (me.email_verified_at) setCustomer(me);
      })
      .catch(() => {});
  }, [unverified, setCustomer]);

  if (!unverified) return null;

  const resend = async () => {
    setState('sending');
    setNote(null);
    try {
      const r = await api<{ already_verified?: boolean; sent_to?: string }>(
        '/auth/verify-email/resend',
        { method: 'POST' }
      );
      if (r.already_verified) {
        setCustomer(await api<Customer>('/auth/me'));
        return;
      }
      setState('sent');
      setNote(`New link sent to ${r.sent_to}.`);
    } catch (err) {
      setState('idle');
      setNote(err instanceof Error ? err.message : 'Could not send the link.');
    }
  };

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn-deep/20 p-4 text-warn"
    >
      <MailWarning className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 text-sm">
        Confirm <span className="font-semibold">{cached.email}</span> to start receiving alert
        emails and the daily report. Check your inbox for the link.
        {note && <span className="text-ink-mid"> {note}</span>}
      </p>
      <button
        type="button"
        onClick={resend}
        disabled={state !== 'idle'}
        className="rounded-lg border border-warn/40 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
      >
        {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent' : 'Resend link'}
      </button>
    </div>
  );
}
