'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { X } from 'lucide-react';
import { FleetVehicle } from '@/lib/api';

const PowerUnplugFlourish = dynamic(
  () => import('./PowerUnplugFlourish').then((m) => m.PowerUnplugFlourish),
  { ssr: false }
);

const STORAGE_KEY = 'fuelsense_unplug_dismissed';

export interface UnpluggedVehicle {
  id: string;
  plate: string;
  since: string | null;
}

export const unpluggedVehicles = (fleet: FleetVehicle[]): UnpluggedVehicle[] =>
  fleet
    .filter((v) => v.power_unplugged)
    .map((v) => ({ id: v.id, plate: v.license_plate, since: v.power_unplugged_since ?? null }));

/** vehicle id -> the `since` timestamp of the instance that was dismissed. A
 *  later unplug on the same vehicle has a different `since`, so it is not
 *  covered by an old dismissal — same lapse rule as LowFuelBanner, keyed on
 *  "is this still the same occurrence" instead of "has the tank refilled". */
type DismissedAt = Record<string, string>;

const readDismissed = (): DismissedAt => {
  if (!globalThis.window) return {};
  try {
    const raw = globalThis.window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as DismissedAt)
      : {};
  } catch {
    return {};
  }
};

const writeDismissed = (map: DismissedAt): void => {
  if (!globalThis.window) return;
  try {
    globalThis.window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Losing the dismissal just means it's asked again next load — not worth
    // failing the banner over.
  }
};

function since(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

interface Props {
  fleet: FleetVehicle[];
  onSelectVehicle?: (vehicleId: string) => void;
}

/**
 * Tracker power-loss notice — the one banner in the product that outranks
 * every other, because it means the evidence stream itself may be about to
 * stop. Deliberately larger and louder than LowFuelBanner: a car sitting at
 * reserve is a Tuesday, a tracker someone just pulled the plug on is either a
 * mechanic's hands in the wiring or a driver hiding a detour, and a manager
 * should not be able to miss it while skimming the dashboard.
 *
 * Distinct from a flat car battery by construction, not by wording: the
 * `power_unplugged` flag only sets when AVL 66 (external voltage) reads under
 * 6V for two consecutive frames — see EXTERNAL_POWER_MIN_MV in
 * power-monitor.ts. Even a badly dying 12V battery still reads 9-11V, so this
 * can only mean the supply is physically gone, not just weak.
 */
export function PowerUnplugBanner({ fleet, onSelectVehicle }: Props) {
  const [dismissed, setDismissed] = useState<DismissedAt>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
    setReady(true);
  }, []);

  const unplugged = useMemo(() => unpluggedVehicles(fleet), [fleet]);
  const showing = unplugged.filter((v) => dismissed[v.id] !== (v.since ?? ''));

  if (!ready || showing.length === 0) return null;

  const dismiss = () => {
    const next = { ...dismissed };
    for (const v of showing) next[v.id] = v.since ?? '';
    setDismissed(next);
    writeDismissed(next);
  };

  const first = showing[0];

  return (
    <div
      role="alert"
      className="mb-4 flex items-center gap-4 overflow-hidden rounded-2xl border-2 border-bad-bright bg-bad-bright/10 px-5 py-4 shadow-[0_0_28px_-6px_rgba(255,107,107,0.5)]"
    >
      <PowerUnplugFlourish className="shrink-0" />

      <div className="min-w-0 flex-1">
        <p className="text-lg font-bold text-bad-bright">
          {showing.length === 1
            ? `Tracker unplugged — ${first.plate}`
            : `Tracker unplugged on ${showing.length} vehicles`}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink-mid">
          {showing.slice(0, 3).map((v, i) => (
            <span key={v.id}>
              {i > 0 && ', '}
              {onSelectVehicle ? (
                <button
                  type="button"
                  onClick={() => onSelectVehicle(v.id)}
                  className="font-semibold text-ink underline decoration-dotted underline-offset-2 hover:text-bad-bright"
                >
                  {v.plate}
                </button>
              ) : (
                <span className="font-semibold text-ink">{v.plate}</span>
              )}
              {v.since && <span className="text-ink-dim"> · unplugged {since(v.since)}</span>}
            </span>
          ))}
          {showing.length > 3 && (
            <span className="text-ink-dim"> and {showing.length - 3} more</span>
          )}
          {'. '}
          <span className="text-ink-dim">
            External power is completely gone — not a flat car battery, which still reads well
            above this. The tracker is running on its own backup cell and will stop reporting once
            that runs out.
          </span>
        </p>
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label={
          showing.length === 1
            ? `Dismiss unplug warning for ${first.plate}`
            : 'Dismiss unplug warning'
        }
        title="Dismiss"
        className="shrink-0 self-start rounded-full border border-edge p-1.5 text-ink-dim transition-colors hover:bg-panel-hover hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
