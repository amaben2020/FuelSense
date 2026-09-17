'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, FileText, Loader2 } from 'lucide-react';
import {
  DailyReportSetting,
  NotificationAlert,
  fetchNotificationSettings,
  setDailyReportPreference,
  setNotificationPreference,
} from '@/lib/api';
import { Panel } from '@/components/ui/chrome';
import { LoadErrorBanner } from './LoadErrorBanner';

/** "120" is not a unit a person thinks in. */
function waitLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return h === 1 ? '1 hour' : `${h} hours`;
}

/**
 * Where a manager turns the emails off.
 *
 * The offline-tracker email told them to go to "Settings → Notifications",
 * which did not exist — the only toggles in the product were on the
 * Documentation page, a screen nobody visits to change a setting. So the email
 * gave one instruction and it was a dead end. This is that screen.
 */
export function NotificationSettingsPanel() {
  const [alerts, setAlerts] = useState<NotificationAlert[] | null>(null);
  const [report, setReport] = useState<DailyReportSetting | null>(null);
  const [reportAddress, setReportAddress] = useState('');
  const [reportSaving, setReportSaving] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  /** Which row is mid-save, so a double-click cannot race itself. */
  const [saving, setSaving] = useState<string | null>(null);

  const runFetch = useCallback(() => {
    fetchNotificationSettings()
      .then((d) => {
        setAlerts(d.alerts.filter((a) => a.emailable));
        setReport(d.daily_report);
        setReportAddress(d.daily_report.email_address ?? '');
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    runFetch();
  }, [runFetch]);

  useEffect(() => {
    runFetch();
  }, [runFetch]);

  const save = async (
    alert: NotificationAlert,
    emailEnabled: boolean,
    thresholdMinutes?: number | null
  ) => {
    setSaving(alert.type);
    // Optimistic, reverted by the refetch below if the server disagrees.
    setAlerts((prev) =>
      prev
        ? prev.map((a) =>
            a.type === alert.type
              ? {
                  ...a,
                  email_enabled: emailEnabled,
                  threshold_minutes:
                    thresholdMinutes === undefined ? a.threshold_minutes : thresholdMinutes,
                }
              : a
          )
        : prev
    );
    try {
      await setNotificationPreference(alert.type, emailEnabled, thresholdMinutes);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(null);
      runFetch();
    }
  };

  const saveReport = async (enabled: boolean) => {
    if (!report) return;
    setReportSaving(true);
    setReportError(null);
    try {
      await setDailyReportPreference(enabled, reportAddress.trim() || null);
      setReport({ ...report, enabled, email_address: reportAddress.trim() || null });
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setReportSaving(false);
    }
  };

  if (error) {
    return <LoadErrorBanner error={error} subject="notification settings" onRetry={load} />;
  }

  // The report is on by default, but it only goes somewhere real. A
  // placeholder account email with no address here means nothing is sent —
  // said plainly, rather than a manager waiting for a report that never comes.
  const reportDestination = report
    ? report.email_address || (report.account_email_deliverable ? report.account_email : null)
    : null;
  const sendHour = report ? `${report.send_hour_wat}:00` : '21:00';

  const onCount = alerts?.filter((a) => a.email_enabled).length ?? 0;

  return (
    <Panel
      icon={Bell}
      title="Notifications"
      subtitle={
        alerts == null
          ? 'Which alerts reach your inbox'
          : `${onCount} of ${alerts.length} alerts are emailed to you`
      }
      onRefresh={load}
      refreshing={loading}
    >
      {report && (
        <div className="mb-4 rounded-xl border border-edge bg-panel-deep p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-medium text-ink">
                <FileText className="h-4 w-4 text-accent-y" /> Daily fleet report
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">
                Every evening at {sendHour} West Africa Time: distance, trips, fuel and spend per
                driver, with the PDF attached.
                {report.last_sent_at
                  ? ` Last sent ${new Date(report.last_sent_at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} for ${report.last_report_date}.`
                  : ' Not sent yet.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={report.enabled}
              disabled={reportSaving}
              onClick={() => void saveReport(!report.enabled)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                report.enabled
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-edge text-ink-dim hover:text-ink'
              }`}
            >
              {report.enabled ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
              Report {report.enabled ? 'on' : 'off'}
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveReport(report.enabled);
            }}
            className="mt-3 flex flex-wrap items-end gap-2"
          >
            <label className="min-w-[240px] flex-1 text-xs text-ink-mid">
              Send to
              <input
                type="email"
                value={reportAddress}
                onChange={(e) => setReportAddress(e.target.value)}
                placeholder={report.account_email_deliverable ? report.account_email ?? '' : 'manager@yourcompany.com'}
                className="mt-1 w-full rounded-lg border border-edge bg-panel px-2 py-2 text-sm text-ink placeholder-ink-dim"
              />
            </label>
            <button
              type="submit"
              disabled={reportSaving || (reportAddress.trim() || null) === (report.email_address ?? null)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-good px-4 py-2 text-xs font-semibold text-accent-y-ink disabled:opacity-50"
            >
              {reportSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save address
            </button>
          </form>
          {reportError && <p className="mt-2 text-xs text-bad">{reportError}</p>}
          {report.enabled && !reportDestination && (
            <p className="mt-2 text-xs text-warn">
              No address to send to — the account email ({report.account_email}) is a placeholder.
              Enter one above or the report is skipped.
            </p>
          )}
          {report.enabled && reportDestination && (
            <p className="mt-2 text-xs text-ink-dim">Goes to {reportDestination}.</p>
          )}
        </div>
      )}

      {alerts == null ? (
        <p className="rounded-xl bg-panel-deep px-4 py-6 text-center text-sm text-ink-dim">
          Loading notification settings…
        </p>
      ) : (
        <ul className="divide-y divide-divider">
          {alerts.map((a) => {
            const busy = saving === a.type;
            return (
              <li key={a.type} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{a.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">{a.meaning}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={a.email_enabled}
                    disabled={busy}
                    onClick={() => save(a, !a.email_enabled)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                      a.email_enabled
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-edge text-ink-dim hover:text-ink'
                    }`}
                  >
                    {a.email_enabled ? (
                      <Bell className="h-3 w-3" />
                    ) : (
                      <BellOff className="h-3 w-3" />
                    )}
                    Email {a.email_enabled ? 'on' : 'off'}
                  </button>
                </div>

                {/* Only some alerts wait before firing. For those, how long is
                    the difference between a useful warning and a phone that
                    buzzes every time a van parks underground. */}
                {a.threshold_choices && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl bg-panel-deep px-3 py-2.5">
                    <span className="text-xs text-ink-dim">Tell me after it has been quiet for</span>
                    <select
                      value={String(a.threshold_minutes ?? a.threshold_default ?? '')}
                      disabled={busy}
                      onChange={(e) => save(a, a.email_enabled, Number(e.target.value))}
                      className="rounded-lg border border-edge bg-panel px-2 py-1 text-sm text-ink disabled:opacity-50"
                    >
                      {a.threshold_choices.map((m) => (
                        <option key={m} value={m}>
                          {waitLabel(m)}
                          {m === a.threshold_default ? ' (default)' : ''}
                        </option>
                      ))}
                    </select>
                    {!a.email_enabled && (
                      <span className="text-[11px] text-ink-dim">
                        Email is off, but this still decides when the alert appears on the
                        dashboard.
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">
        Emails go to your account address. Nothing is on by default — every alert here was
        switched on deliberately, and switching it off stops the mail immediately.
      </p>
    </Panel>
  );
}
