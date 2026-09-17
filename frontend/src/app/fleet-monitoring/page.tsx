'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, Building2, RefreshCw, ShieldAlert } from 'lucide-react';
import { ApiError, MonitoredFleet, fetchMonitoredFleets, getToken } from '@/lib/api';
import { StatusChip } from '@/components/ui/chrome';

/**
 * The developer's page: every company on the platform, when someone from
 * it last signed in, and when its trackers last reported. Nothing here is
 * for customers — the API refuses anyone not on DEV_MONITOR_EMAILS — but it
 * sits inside the app so the same sign-in works.
 */

const fmt = (iso: string | null, withTime = true): string =>
  iso
    ? new Date(iso).toLocaleString('en-NG', {
        timeZone: 'Africa/Lagos',
        day: 'numeric',
        month: 'short',
        ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
      })
    : '—';

const ageMinutes = (iso: string | null): number | null =>
  iso ? (Date.now() - new Date(iso).getTime()) / 60_000 : null;

const agoLabel = (iso: string | null): string => {
  const m = ageMinutes(iso);
  if (m == null) return 'never';
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};

const onlineTone = (iso: string | null): 'good' | 'warn' | 'bad' | 'neutral' => {
  const m = ageMinutes(iso);
  if (m == null) return 'neutral';
  if (m <= 15) return 'good';
  if (m <= 24 * 60) return 'warn';
  return 'bad';
};

const loginTone = (iso: string | null): 'good' | 'warn' | 'bad' | 'neutral' => {
  const m = ageMinutes(iso);
  if (m == null) return 'neutral';
  if (m <= 24 * 60) return 'good';
  if (m <= 7 * 24 * 60) return 'warn';
  return 'bad';
};

export default function FleetMonitoringPage() {
  const router = useRouter();
  const [fleets, setFleets] = useState<MonitoredFleet[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchMonitoredFleets();
      setFleets(d.fleets);
      setGeneratedAt(d.generated_at);
      setError(null);
    } catch (err) {
      setError({
        status: err instanceof ApiError ? err.status ?? undefined : undefined,
        message: err instanceof Error ? err.message : 'Could not load',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load, router]);

  const online = fleets?.filter((f) => onlineTone(f.tracker_last_online_at) === 'good').length ?? 0;
  const activeWeek = fleets?.filter((f) => (ageMinutes(f.last_login_at) ?? Infinity) <= 7 * 24 * 60).length ?? 0;

  return (
    <main className="min-h-screen bg-canvas px-4 py-8 text-ink sm:px-8">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-dim">FuelSense · developer</p>
            <h1 className="mt-1 text-2xl font-bold">Fleet monitoring</h1>
            <p className="mt-1 text-sm text-ink-dim">
              Every company, when they last signed in, and when their trackers last reported.
              {generatedAt && ` Updated ${fmt(generatedAt)}.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="rounded-lg border border-edge px-3 py-2 text-xs text-ink-mid hover:bg-panel-hover">
              Back to dashboard
            </Link>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-xs text-ink-mid hover:bg-panel-hover"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </header>

        {error?.status === 403 ? (
          <div className="rounded-lg border border-edge bg-panel p-8 text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-warn" />
            <p className="mt-3 font-medium">This page is for the FuelSense team.</p>
            <p className="mt-1 text-sm text-ink-dim">
              Sign in with a developer account, or add your email to DEV_MONITOR_EMAILS on the server.
            </p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-bad/40 bg-bad-deep/10 p-4 text-sm text-bad">{error.message}</div>
        ) : (
          <>
            {fleets && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-edge bg-panel p-4">
                  <p className="text-xs uppercase tracking-wider text-ink-dim">Companies</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{fleets.length}</p>
                </div>
                <div className="rounded-lg border border-edge bg-panel p-4">
                  <p className="text-xs uppercase tracking-wider text-ink-dim">Signed in this week</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{activeWeek}</p>
                </div>
                <div className="rounded-lg border border-edge bg-panel p-4">
                  <p className="text-xs uppercase tracking-wider text-ink-dim">Trackers reporting now</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {online}
                    <span className="text-sm font-normal text-ink-dim"> / {fleets.length}</span>
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-edge bg-panel">
              <div className="flex items-center gap-2 border-b border-edge px-5 py-4">
                <Building2 className="h-4 w-4 text-accent-y" />
                <h2 className="text-base font-semibold">Companies</h2>
              </div>
              {!fleets ? (
                <p className="p-6 text-sm text-ink-dim">Loading…</p>
              ) : fleets.length === 0 ? (
                <p className="p-6 text-sm text-ink-dim">No companies yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1200px] text-left text-sm">
                    <thead className="bg-canvas text-xs uppercase tracking-wider text-ink-dim whitespace-nowrap">
                      <tr>
                        <th className="px-3 py-3">Company</th>
                        <th className="px-3 py-3">Account</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">Last login</th>
                        <th className="px-3 py-3">Tracker last online</th>
                        <th className="px-3 py-3">Readings 24h</th>
                        <th className="px-3 py-3">Vehicles</th>
                        <th className="px-3 py-3">Trackers</th>
                        <th className="px-3 py-3">Drivers</th>
                        <th className="px-3 py-3">Team</th>
                        <th className="px-3 py-3">Receipts 30d</th>
                        <th className="px-3 py-3">Open alerts</th>
                        <th className="px-3 py-3">Since</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-divider text-ink-mid">
                      {fleets.map((f) => (
                        <tr key={f.id} className="hover:bg-panel-hover">
                          <td className="px-3 py-3 font-medium text-ink">
                            {f.company}
                            {!f.onboarding_completed && (
                              <span className="ml-2 text-[10px] uppercase tracking-wider text-warn">onboarding</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <span className="block text-ink">{f.account_name}</span>
                            <span className="text-xs text-ink-dim">{f.email}</span>
                          </td>
                          <td className="px-3 py-3">
                            <StatusChip tone={f.subscription_status === 'active' ? 'good' : 'neutral'}>
                              {f.subscription_status}
                            </StatusChip>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <StatusChip tone={loginTone(f.last_login_at)} dot>
                              {agoLabel(f.last_login_at)}
                            </StatusChip>
                            <span className="ml-2 text-xs text-ink-dim">{fmt(f.last_login_at)}</span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <StatusChip tone={onlineTone(f.tracker_last_online_at)} dot>
                              {agoLabel(f.tracker_last_online_at)}
                            </StatusChip>
                            <span className="ml-2 text-xs text-ink-dim">{fmt(f.tracker_last_online_at)}</span>
                          </td>
                          <td className="px-3 py-3 font-mono">
                            <span className="inline-flex items-center gap-1">
                              <Activity className="h-3 w-3 text-ink-dim" />
                              {f.readings_24h.toLocaleString()}
                            </span>
                          </td>
                          <td className="px-3 py-3 font-mono">{f.vehicles}</td>
                          <td className="px-3 py-3 font-mono">
                            {f.active_devices}
                            <span className="text-ink-dim">/{f.devices}</span>
                          </td>
                          <td className="px-3 py-3 font-mono">{f.drivers}</td>
                          <td className="px-3 py-3 font-mono">{f.team_members + 1}</td>
                          <td className="px-3 py-3 font-mono">
                            {f.receipts_30d}
                            {f.last_receipt_at && <span className="ml-1 text-xs text-ink-dim">· {fmt(f.last_receipt_at, false)}</span>}
                          </td>
                          <td className="px-3 py-3 font-mono">{f.open_alerts}</td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs text-ink-dim">{fmt(f.created_at, false)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <p className="text-xs text-ink-dim">
              Last login is the latest sign-in by the account holder or any team member. Tracker last
              online is the newest of the devices&apos; last-seen time and the newest telemetry row.
              Refreshes every minute.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
