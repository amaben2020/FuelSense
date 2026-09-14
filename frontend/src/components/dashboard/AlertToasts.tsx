'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Fuel,
  MapPin,
  Navigation,
  Route,
  ShieldAlert,
  Timer,
  WifiOff,
} from 'lucide-react';
import type { Alert } from '@/lib/api';

/**
 * What an alert type is called when it interrupts someone.
 *
 * The alerts feed carries the full message; a toast has four seconds and a
 * corner of the eye, so it leads with the plain name of the thing and the
 * driver it concerns. Anything unlisted falls back to the type with its
 * underscores taken out — a new alert type must never render as nothing.
 */
const TOAST_TITLE: Record<string, string> = {
  trip_start: 'Trip started',
  trip_end: 'Trip ended',
  low_fuel: 'Low fuel',
  fuel_theft: 'Possible fuel theft',
  fuel_discrepancy: 'Fuel discrepancy',
  unlogged_fill: 'Unlogged fill',
  excessive_idle: 'Excessive idling',
  idle_fuel_waste: 'Fuel wasted idling',
  overspeeding: 'Overspeeding',
  route_deviation: 'Off route',
  geofence_entry: 'Entered a zone',
  geofence_exit: 'Left a zone',
  device_offline: 'Tracker offline',
  device_unplugged: 'Tracker unplugged',
  power_unplug: 'Tracker unplugged',
  power_dropout: 'Tracker power dropout',
  receipt_uploaded: 'Receipt filed',
  receipt_fraud: 'Receipt does not add up',
  immobilizer_engaged: 'Immobiliser engaged',
  immobilizer_released: 'Vehicle mobilized',
  doors_locked: 'Doors locked remotely',
};

const TOAST_ICON: Record<string, typeof BellRing> = {
  trip_start: Navigation,
  trip_end: CheckCircle2,
  low_fuel: Fuel,
  fuel_theft: ShieldAlert,
  fuel_discrepancy: Fuel,
  unlogged_fill: Fuel,
  excessive_idle: Timer,
  idle_fuel_waste: Timer,
  overspeeding: AlertTriangle,
  route_deviation: Route,
  geofence_entry: MapPin,
  geofence_exit: MapPin,
  device_offline: WifiOff,
  device_unplugged: WifiOff,
  receipt_uploaded: CheckCircle2,
  receipt_fraud: ShieldAlert,
};

/** Types worth a sound. The rest appear and go without one. */
export const AUDIBLE_ALERT_TYPES = new Set([
  'fuel_theft',
  'receipt_fraud',
  'device_offline',
  'device_unplugged',
  'immobilizer_engaged',
  'unlogged_fill',
  'fuel_discrepancy',
  'route_deviation',
  'overspeeding',
]);

export function toastTitle(type: string): string {
  return TOAST_TITLE[type] ?? type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

const TOAST_MS = 4000;
const MAX_VISIBLE = 3;

interface Toast {
  key: number;
  title: string;
  who: string;
  detail: string;
  Icon: typeof BellRing;
  tone: 'bad' | 'warn' | 'neutral';
}

const BAD = new Set(['fuel_theft', 'receipt_fraud', 'device_offline', 'device_unplugged', 'immobilizer_engaged']);
const WARN = new Set([
  'low_fuel',
  'fuel_discrepancy',
  'unlogged_fill',
  'excessive_idle',
  'idle_fuel_waste',
  'overspeeding',
  'route_deviation',
]);

/**
 * Bottom-centre notices for alerts that arrived since the last refresh.
 *
 * Each shows the alert's name, the driver and plate it concerns, and one
 * line of detail, then leaves on its own after four seconds — the feed is
 * where an alert lives; this is only the tap on the shoulder. At most three
 * stack, newest at the bottom, so a burst from a whole fleet cannot wall the
 * screen.
 */
export function AlertToasts({
  incoming,
  driverFor,
}: {
  /** Alerts new since the previous poll; the parent decides what is new. */
  incoming: Alert[];
  driverFor: (vehicleId: string | undefined) => string | null;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  // Read through a ref: driverFor is rebuilt on every fleet poll, and keying
  // the effect on it re-ran the body for the same batch — the same alert
  // toasted three times over, and the cleanup cancelled the timer that would
  // have taken the first copy away, so none of them ever left.
  const driverForRef = useRef(driverFor);
  useEffect(() => {
    driverForRef.current = driverFor;
  }, [driverFor]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (incoming.length === 0) return;
    const fresh: Toast[] = incoming.slice(0, MAX_VISIBLE).map((a) => {
      seq.current += 1;
      const driver = driverForRef.current(a.vehicle_id);
      return {
        key: seq.current,
        title: toastTitle(a.alert_type),
        who: [driver, a.license_plate].filter(Boolean).join(' · ') || 'Fleet',
        detail: a.message,
        Icon: TOAST_ICON[a.alert_type] ?? BellRing,
        tone: BAD.has(a.alert_type) ? 'bad' : WARN.has(a.alert_type) ? 'warn' : 'neutral',
      };
    });
    setToasts((prev) => [...prev, ...fresh].slice(-MAX_VISIBLE));
    // Each batch leaves on its own clock; a later batch must not reset it.
    const keys = fresh.map((t) => t.key);
    timers.current.push(
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => !keys.includes(t.key)));
      }, TOAST_MS)
    );
  }, [incoming]);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[1300] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.key}
          className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border bg-panel/95 px-4 py-3 shadow-2xl backdrop-blur-md ${
            t.tone === 'bad'
              ? 'border-bad/50'
              : t.tone === 'warn'
                ? 'border-warn/50'
                : 'border-edge'
          }`}
        >
          <t.Icon
            className={`mt-0.5 h-4 w-4 shrink-0 ${
              t.tone === 'bad' ? 'text-bad' : t.tone === 'warn' ? 'text-warn' : 'text-ink-mid'
            }`}
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              {t.title}
              <span className="ml-2 font-normal text-ink-dim">{t.who}</span>
            </p>
            <p className="mt-0.5 truncate text-xs text-ink-mid">{t.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
