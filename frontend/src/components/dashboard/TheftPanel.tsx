'use client';

import { useEffect, useState } from 'react';
import {
  Box,
  Cable,
  Check,
  Circle,
  DoorClosed,
  History,
  Lock,
  LockOpen,
  Radio,
  ShieldAlert,
  Siren,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ImmobilizerSceneModal } from './ImmobilizerSceneModal';
import {
  FleetVehicle,
  ImmobilizerStatus,
  SecurityLogEntry,
  SecurityLogType,
  engageImmobilizer,
  getImmobilizerStatus,
  getSecurityLog,
  lockVehicleDoors,
  releaseImmobilizer,
} from '@/lib/api';

type Action = 'engage' | 'release' | 'lock';

/** How each audit line reads: the verb a buyer expects, and its colour. */
const EVENT_META: Record<SecurityLogType, { label: string; Icon: LucideIcon; tone: string }> = {
  immobilizer_engaged: { label: 'Immobilize requested', Icon: Lock, tone: 'text-bad' },
  immobilizer_released: { label: 'Mobilize requested', Icon: LockOpen, tone: 'text-good' },
  doors_locked: { label: 'Doors locked', Icon: DoorClosed, tone: 'text-accent-y' },
  fuel_theft: { label: 'Fuel theft flagged', Icon: Siren, tone: 'text-bad' },
  receipt_fraud: { label: 'Receipt mismatch flagged', Icon: Siren, tone: 'text-bad' },
};

/** "13 Sep, 10:02" — day and clock, no year, no seconds. */
const formatWhen = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** "Immobilize requested by Jane Doe" — or by the detector, when nobody asked. */
const eventLine = (event: SecurityLogEntry): string =>
  `${EVENT_META[event.alert_type]?.label ?? event.alert_type} ${
    event.actor ? `by ${event.actor}` : 'automatically'
  }`;

const timeAgo = (iso: string): string => {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(iso).toLocaleString();
};

/**
 * The three facts behind "immobilized", each shown as its own step so a
 * manager sees exactly how far a command got: this server sent it, the
 * tracker answered, and the tracker's own output reading agrees.
 */
function CommandTrail({ status }: { status: ImmobilizerStatus }) {
  const cmd = status.command;
  const engaging = status.immobilized;
  const wantedLevel = engaging ? 1 : 0;

  const sent = cmd ? !!cmd.sentAt : true;
  const acked = !!status.ack && status.ack.level === wantedLevel;
  const confirmed = sent && status.dout1?.level === wantedLevel;

  const steps: { label: string; done: boolean; detail: string }[] = [
    {
      label: `Command ${cmd && !cmd.sentAt ? 'queued' : 'sent'}`,
      done: sent,
      detail: cmd
        ? cmd.sentAt
          ? `${cmd.text} · ${timeAgo(cmd.sentAt)}`
          : `${cmd.text} · waiting for the tracker to reconnect (${cmd.queuedAt ? timeAgo(cmd.queuedAt) : 'just now'})`
        : `${engaging ? status.relay.engageCommand : status.relay.releaseCommand} over Codec 12`,
    },
    {
      label: 'Tracker replied',
      done: acked,
      detail: status.ack
        ? `"${status.ack.text}" · ${timeAgo(status.ack.at)}`
        : sent
          ? 'No reply yet'
          : '—',
    },
    {
      label: `${status.relay.output} reads ${wantedLevel ? 'high' : 'low'} (AVL 179)`,
      done: confirmed,
      detail: status.dout1
        ? `Tracker reports ${status.relay.output} ${status.dout1.level ? 'high' : 'low'} since ${timeAgo(status.dout1.since)}`
        : 'This tracker does not send AVL 179 — enable Digital Output 1 in the Configurator I/O tab to see the relay side',
    },
  ];

  return (
    <ol className="space-y-1.5">
      {steps.map((step) => (
        <li key={step.label} className="flex items-start gap-2 text-xs">
          {step.done ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
          ) : (
            <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-dim" />
          )}
          <div className="min-w-0">
            <p className={step.done ? 'text-ink' : 'text-ink-mid'}>{step.label}</p>
            <p className="break-words font-mono text-[11px] text-ink-dim">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function StatusPill({ status }: { status: ImmobilizerStatus }) {
  switch (status.phase) {
    case 'engage_queued':
    case 'engage_sent':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-y/15 px-2.5 py-1 text-xs font-semibold text-accent-y">
          <Lock className="h-3.5 w-3.5" /> Immobilizing…
        </span>
      );
    case 'engaged':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-bad/15 px-2.5 py-1 text-xs font-semibold text-bad">
          <Lock className="h-3.5 w-3.5" /> Immobilized
        </span>
      );
    case 'engaged_confirmed':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-bad/15 px-2.5 py-1 text-xs font-semibold text-bad">
          <Lock className="h-3.5 w-3.5" /> Immobilized · relay confirmed
        </span>
      );
    case 'release_queued':
    case 'release_sent':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-y/15 px-2.5 py-1 text-xs font-semibold text-accent-y">
          <LockOpen className="h-3.5 w-3.5" /> Mobilizing…
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-good/15 px-2.5 py-1 text-xs font-semibold text-good">
          <LockOpen className="h-3.5 w-3.5" /> Normal
        </span>
      );
  }
}

/** A yes/no before the command goes. Nothing to type — one decision. */
const MODAL_COPY: Record<Action, { title: string; body: string; yes: string }> = {
  engage: {
    title: 'Immobilize',
    body: 'This cuts the engine-start circuit remotely through the tracker’s relay. The vehicle will not start until you mobilize it from here.',
    yes: 'Yes, immobilize',
  },
  release: {
    title: 'Mobilize',
    body: 'This restores the engine-start circuit through the tracker’s relay. The vehicle can start normally again.',
    yes: 'Yes, mobilize',
  },
  lock: {
    title: 'Lock the doors of',
    body: 'This sends a one-second pulse on DOUT2 to the central-locking relay — every door locks as if the key fob had been pressed. It does not stop the doors being unlocked from inside.',
    yes: 'Yes, lock doors',
  },
};

function ConfirmModal({
  vehicle,
  action,
  busy,
  onYes,
  onNo,
}: {
  vehicle: FleetVehicle;
  action: Action;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  const engage = action === 'engage';
  const copy = MODAL_COPY[action];
  const Icon = action === 'lock' ? DoorClosed : engage ? Lock : LockOpen;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close" onClick={onNo} />
      <div className="relative w-full max-w-md rounded-xl border border-edge bg-panel p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${engage ? 'bg-bad/15 text-bad' : action === 'lock' ? 'bg-accent-y/15 text-accent-y' : 'bg-good/15 text-good'}`}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-base font-bold text-ink">
              {copy.title} {vehicle.license_plate}?
            </h3>
            <p className="text-xs text-ink-dim">
              {[vehicle.make, vehicle.model].filter(Boolean).join(' ')}
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm text-ink-mid">{copy.body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onNo}
            disabled={busy}
            className="rounded-lg border border-edge px-4 py-2 text-sm text-ink-mid hover:bg-panel-hover disabled:opacity-50"
          >
            No
          </button>
          <button
            type="button"
            onClick={onYes}
            disabled={busy}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 ${engage ? 'bg-bad-deep text-white' : action === 'lock' ? 'bg-accent-y text-accent-y-ink' : 'bg-good text-canvas'}`}
          >
            <Icon className="h-4 w-4" />
            {busy ? 'Sending…' : copy.yes}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The card's own audit trail: every command a person has sent this vehicle,
 * newest first. Who and when, on one line each — the answer to "how do we
 * know who did this", which a security buyer asks before anything else.
 */
function AuditTrail({ events }: { events: SecurityLogEntry[] }) {
  return (
    <div className="mt-5 border-t border-edge pt-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <History className="h-4 w-4 text-ink-mid" /> Audit trail
      </p>
      {events.length === 0 ? (
        <p className="mt-1.5 text-xs text-ink-dim">
          No remote commands have been sent to this vehicle yet.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {events.slice(0, 5).map((event) => {
            const meta = EVENT_META[event.alert_type];
            const Icon = meta?.Icon ?? Siren;
            return (
              <li
                key={event.id}
                className="flex items-start gap-2 text-xs"
                title={event.message}
              >
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta?.tone ?? 'text-ink-mid'}`} />
                <p className="min-w-0 text-ink-mid">
                  <span className="text-ink">{eventLine(event)}</span>
                  <span className="text-ink-dim"> · {formatWhen(event.created_at)}</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function VehicleImmobilizer({
  vehicle,
  trail,
  onActed,
}: {
  vehicle: FleetVehicle;
  trail: SecurityLogEntry[];
  onActed: () => void;
}) {
  const [status, setStatus] = useState<ImmobilizerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [showScene, setShowScene] = useState(false);

  const load = async () => {
    try {
      setStatus(await getImmobilizerStatus(vehicle.id));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const busy = !!status?.command;

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.id]);

  useEffect(() => {
    // While a command is out, poll faster: the reply and the AVL 179 reading
    // land within seconds of each other and the trail should show them arrive.
    const interval = setInterval(load, busy ? 4000 : 20000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.id, busy]);

  const act = async (action: Action) => {
    setActing(true);
    setError(null);
    try {
      setStatus(
        action === 'engage'
          ? await engageImmobilizer(vehicle.id, vehicle.license_plate)
          : action === 'lock'
            ? await lockVehicleDoors(vehicle.id, vehicle.license_plate)
            : await releaseImmobilizer(vehicle.id)
      );
      onActed();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActing(false);
      setConfirming(null);
    }
  };

  const releasing = status?.phase === 'release_queued' || status?.phase === 'release_sent';

  return (
    <div className="rounded-lg border border-edge bg-panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-mono text-sm font-bold text-ink">{vehicle.license_plate}</h3>
          <p className="mt-0.5 text-xs text-ink-dim">
            {[vehicle.make, vehicle.model].filter(Boolean).join(' ')}
            {vehicle.driver_name ? ` · ${vehicle.driver_name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <button
              type="button"
              onClick={() => setShowScene(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-1 text-xs text-ink-mid hover:bg-panel-hover"
            >
              <Box className="h-3.5 w-3.5" /> View feature
            </button>
          )}
          {loading ? (
            <span className="text-xs text-ink-dim">Checking…</span>
          ) : status ? (
            <StatusPill status={status} />
          ) : null}
        </div>
      </div>

      {!loading && status && (
        <>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-dim">
            <span className="inline-flex items-center gap-1">
              <Radio
                className={`h-3 w-3 ${status.linkOpen ? 'text-good' : status.deviceOnline ? 'text-accent-y' : 'text-bad'}`}
              />
              {status.linkOpen
                ? 'Tracker connected'
                : status.lastSeenAt
                  ? `Tracker last reported ${timeAgo(status.lastSeenAt)} — a command will queue until it reconnects`
                  : 'Tracker has never reported'}
            </span>
            <span className="inline-flex items-center gap-1">
              <Cable className="h-3 w-3" />
              {status.relay.output} → starter relay
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {status.immobilized || releasing ? (
              <>
                <p className="text-sm text-ink-mid">
                  {status.immobilized
                    ? 'Engine start is cut. The vehicle will not start until it is mobilized.'
                    : 'Restoring the starter circuit.'}
                  {status.immobilizedAt && (
                    <> Immobilized {new Date(status.immobilizedAt).toLocaleString()}.</>
                  )}
                </p>
                <CommandTrail status={status} />
                {status.immobilized && (
                  <button
                    type="button"
                    onClick={() => setConfirming('release')}
                    disabled={acting}
                    className="inline-flex items-center gap-2 rounded-lg border border-good/40 bg-good/10 px-4 py-2 text-sm font-semibold text-good transition-colors hover:bg-good/20 disabled:opacity-50"
                  >
                    <LockOpen className="h-4 w-4" />
                    Mobilize vehicle
                  </button>
                )}
              </>
            ) : (
              <>
                {status.dout1?.level === 1 && (
                  <p className="rounded-lg border border-accent-y/40 bg-accent-y/10 px-3 py-2 text-xs text-accent-y">
                    The tracker reports {status.relay.output} high, but no immobilize was
                    requested from here. Check the relay wiring or the device&apos;s own
                    immobilizer scenario; mobilizing from here will drop the output.
                  </p>
                )}
                {status.ack && status.dout1 && <CommandTrail status={status} />}
                <button
                  type="button"
                  onClick={() => setConfirming('engage')}
                  disabled={!status.canImmobilize || acting}
                  className="inline-flex items-center gap-2 rounded-lg border border-bad/40 bg-bad/10 px-4 py-2 text-sm font-semibold text-bad transition-colors hover:bg-bad/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Lock className="h-4 w-4" />
                  Immobilize vehicle
                </button>
                {!status.canImmobilize && status.blockedReason && (
                  <p className="text-xs text-ink-dim">{status.blockedReason}</p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {!loading && status && (
        <div className="mt-5 border-t border-edge pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <DoorClosed className="h-4 w-4 text-ink-mid" /> Central locking
              </p>
              <p className="mt-0.5 text-xs text-ink-dim">
                {status.doorLock.output} → central-locking relay · {status.doorLock.command}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirming('lock')}
              disabled={acting || !status.linkOpen}
              className="inline-flex items-center gap-2 rounded-lg border border-accent-y/40 bg-accent-y/10 px-4 py-2 text-sm font-semibold text-accent-y transition-colors hover:bg-accent-y/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <DoorClosed className="h-4 w-4" />
              Lock doors
            </button>
          </div>
          {status.doorLock.sentAt && (
            <p className="mt-2 font-mono text-[11px] text-ink-dim">
              Last pulse {timeAgo(status.doorLock.sentAt)}
              {status.doorLock.ack
                ? ` · tracker replied "${status.doorLock.ack.text}"`
                : ' · no reply yet'}
            </p>
          )}
          <p className="mt-2 text-[11px] text-ink-dim">
            {!status.linkOpen
              ? 'Needs the tracker connected right now — a lock pulse is sent live, never queued. '
              : ''}
            Needs a second relay on {status.doorLock.output} wired to the central-locking lock
            line. Works on any vehicle that has central locking, however old; a vehicle without
            it feels nothing. Locking does not stop the doors being opened from inside.
          </p>
        </div>
      )}

      {!loading && status && <AuditTrail events={trail} />}

      {error && <p className="mt-3 text-xs text-bad">{error}</p>}

      {showScene && status && (
        <ImmobilizerSceneModal
          plate={vehicle.license_plate}
          model={[vehicle.make, vehicle.model].filter(Boolean).join(' ') || null}
          phase={status.phase}
          onClose={() => setShowScene(false)}
        />
      )}

      {confirming && (
        <ConfirmModal
          vehicle={vehicle}
          action={confirming}
          busy={acting}
          onYes={() => act(confirming)}
          onNo={() => !acting && setConfirming(null)}
        />
      )}
    </div>
  );
}

export function TheftPanel({ fleet }: { fleet: FleetVehicle[] }) {
  const [vehicleId, setVehicleId] = useState<string>('');
  const selected = fleet.find((v) => v.id === vehicleId) ?? fleet[0] ?? null;

  // The audit log, not the inbox: it keeps every command whether or not the
  // matching alert was resolved, so the trail survives a cleared queue.
  const [log, setLog] = useState<SecurityLogEntry[]>([]);
  const loadLog = async () => {
    try {
      setLog(await getSecurityLog());
    } catch {
      // The status card carries its own error; a stale log is not worth one.
    }
  };
  useEffect(() => {
    loadLog();
    const interval = setInterval(loadLog, 20000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-edge bg-panel p-5">
        <h2 className="flex items-center gap-2 font-semibold text-ink">
          <ShieldAlert className="h-4 w-4 text-accent-y" /> Theft & immobilizer
        </h2>
        <p className="mt-1 text-xs text-ink-dim">
          Remote engine-start cutoff over the tracker&apos;s wired relay: a Teltonika{' '}
          <span className="font-mono">setdigout</span>
          {' '}command raises the FMC130/FMC150&apos;s DOUT1, the relay opens the starter circuit,
          and the tracker reports the output back in every record (AVL 179). Pick a vehicle,
          confirm, and the command goes — immediately if the tracker is connected, otherwise the
          moment it next reports in. Mobilize it again from the same place.
        </p>

        {fleet.length > 0 && (
          <label className="mt-4 block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
              Vehicle
            </span>
            <select
              value={selected?.id ?? ''}
              onChange={(e) => setVehicleId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink sm:max-w-sm"
            >
              {fleet.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.license_plate}
                  {v.make || v.model ? ` — ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}
                  {v.driver_name ? ` · ${v.driver_name}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {selected ? (
        <VehicleImmobilizer
          key={selected.id}
          vehicle={selected}
          trail={log.filter((e) => e.vehicle_id === selected.id)}
          onActed={loadLog}
        />
      ) : (
        <p className="text-sm text-ink-dim">No vehicles yet.</p>
      )}

      <div className="rounded-lg border border-edge bg-panel p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Siren className="h-4 w-4 text-ink-mid" /> Recent theft activity
        </h3>
        <p className="mt-1 text-xs text-ink-dim">
          Every remote command and theft flag across the fleet, with who sent it. Resolving
          the matching alert clears it from the inbox, not from here.
        </p>
        {log.length === 0 ? (
          <p className="mt-2 text-sm text-ink-dim">No theft-related activity recorded.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {log.slice(0, 20).map((event) => {
              const meta = EVENT_META[event.alert_type];
              const Icon = meta?.Icon ?? Siren;
              const border =
                event.alert_type === 'immobilizer_released'
                  ? 'border-l-good'
                  : event.alert_type === 'doors_locked'
                    ? 'border-l-accent-y'
                    : 'border-l-bad';
              return (
                <li
                  key={event.id}
                  className={`rounded-lg border-l-2 ${border} bg-panel-deep p-3 text-sm`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="flex items-center gap-1.5 font-semibold text-ink">
                      <Icon className={`h-3.5 w-3.5 ${meta?.tone ?? 'text-ink-mid'}`} />
                      {event.license_plate && (
                        <span className="font-mono">{event.license_plate}</span>
                      )}
                      <span className="font-normal text-ink-mid">{eventLine(event)}</span>
                    </p>
                    <p className="text-xs text-ink-dim">
                      {formatWhen(event.created_at)} · {timeAgo(event.created_at)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-ink-dim">{event.message}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
