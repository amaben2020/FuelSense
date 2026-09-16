// Remote engine-start cutoff over the FMC130/FMC150's wired digital output.
//
// Wiring the DOUT relay into the starter circuit is a hardware step done at
// install time — this module only sends the command a wired relay listens
// for, and reads back what the device says happened. The command is
// Teltonika's `setdigout` over Codec 12 (see teltonika-dout.ts); the device
// answers with the levels it now holds, and from then on reports DOUT1 in
// every AVL record as element 179. That gives three distinct facts, and the
// UI shows each one separately rather than collapsing them into "done":
//
//   sent          — the command left this server over an open socket
//   acknowledged  — the device replied "DOUTS are set to:1…"
//   confirmed     — AVL 179 in a later record reads 1
//
// Immobilizing is a manager's decision and nothing else: no speed rule, no
// stopped-for-N-minutes rule, on either side. The dashboard asks once, and
// the command goes. A tracker with no open socket cannot be commanded —
// Codec 12 rides on the connection the device opens, there is no
// server-initiated path — so the command is queued and delivered on the
// next handshake, however long that takes.
import { db, sql, alerts, devices, vehicles, eq, and } from './db-helpers';
import {
  buildSetDigout,
  levelFromReply,
  parseSetDigoutReply,
  type DoutLevel,
  type DoutOutput,
} from './teltonika-dout';

/** Hardcoded for now — flip to a real subscription check once this ships
 *  past beta. Kept as a single constant so the gate lives in one place. */
export const IMMOBILIZER_ENABLED = true;

/** Matches the device-offline watchdog's own window — "online" in the
 *  status means the tracker reported within it. Informational only. */
const DEVICE_FRESHNESS_MINUTES = 30;

/** The output this fleet's installs wire the starter relay to. Both the
 *  FMC130 and FMC150 carry DOUT1 and DOUT2; DOUT1 is the convention. */
export const RELAY_OUTPUT: DoutOutput = 1;

/** No timeout and no speed ceiling: the output goes high and stays high
 *  until a release is sent, whatever the vehicle is doing. */
export const CMD_ENGAGE = buildSetDigout({ output: RELAY_OUTPUT, level: 1 });
export const CMD_RELEASE = buildSetDigout({ output: RELAY_OUTPUT, level: 0 });

/** The second output, wired through its own relay to the central-locking
 *  module's lock line. A one-second pulse locks every door the way the key
 *  fob does; the timeout is the device's own, so the output drops itself. */
export const DOOR_LOCK_OUTPUT: DoutOutput = 2;
export const DOOR_LOCK_PULSE_SECONDS = 1;
export const CMD_LOCK_DOORS = buildSetDigout({
  output: DOOR_LOCK_OUTPUT,
  level: 1,
  timeoutSeconds: DOOR_LOCK_PULSE_SECONDS,
});

type CommandKind = 'engage' | 'release';

/**
 * How the command reaches the tracker. tcp-server registers its socket table
 * here at startup; nothing in this module reaches into the server directly,
 * so the two do not import each other.
 */
export interface CommandLink {
  isConnected(imei: string): boolean;
  send(imei: string, command: string): void;
}

let link: CommandLink | null = null;

export function registerCommandLink(next: CommandLink): void {
  link = next;
}

export type ImmobilizerPhase =
  | 'released'
  | 'engage_queued'
  | 'engage_sent'
  | 'engaged'
  | 'engaged_confirmed'
  | 'release_queued'
  | 'release_sent';

export interface ImmobilizerStatus {
  /** The commanded state — what the manager last asked for. */
  immobilized: boolean;
  immobilizedAt: string | null;
  /** Whether an immobilize command could be sent right now. */
  canImmobilize: boolean;
  /** Why it can't, when it can't — always populated when canImmobilize is false. */
  blockedReason: string | null;
  /** Reported within the freshness window. */
  deviceOnline: boolean;
  /** Has a socket open to this server this instant. */
  linkOpen: boolean;
  lastSeenAt: string | null;
  phase: ImmobilizerPhase;
  relay: {
    output: string;
    engageCommand: string;
    releaseCommand: string;
  };
  /** The setdigout in flight, if any. */
  command: {
    kind: CommandKind;
    text: string;
    queuedAt: string | null;
    sentAt: string | null;
  } | null;
  /** The device's last reply to a setdigout, verbatim. */
  ack: { text: string; at: string; level: DoutLevel | null } | null;
  /** DOUT1 as the device last reported it in AVL 179. */
  dout1: { level: DoutLevel; since: string } | null;
  /** The last central-locking pulse: when it went, what the device said. */
  doorLock: {
    output: string;
    command: string;
    sentAt: string | null;
    ack: { text: string; at: string; level: DoutLevel | null } | null;
  };
}

const iso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

async function loadDevice(vehicleId: string, customerId: string) {
  const [device] = await db
    .select({
      imei: devices.imei,
      lastSeenAt: devices.lastSeenAt,
      immobilized: devices.immobilized,
      immobilizedAt: devices.immobilizedAt,
      command: devices.immobilizerCommand,
      commandText: devices.immobilizerCommandText,
      queuedAt: devices.immobilizerQueuedAt,
      sentAt: devices.immobilizerSentAt,
      ack: devices.immobilizerAck,
      ackAt: devices.immobilizerAckAt,
      dout1State: devices.dout1State,
      dout1ReportedAt: devices.dout1ReportedAt,
      doorLockSentAt: devices.doorLockSentAt,
      doorLockAck: devices.doorLockAck,
      doorLockAckAt: devices.doorLockAckAt,
    })
    .from(devices)
    .where(and(eq(devices.vehicleId, vehicleId), eq(devices.customerId, customerId)));
  return device;
}

type DeviceRow = NonNullable<Awaited<ReturnType<typeof loadDevice>>>;

const isFresh = (lastSeenAt: Date | null): boolean =>
  !!lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < DEVICE_FRESHNESS_MINUTES * 60_000;

/** The only precondition: there is a tracker to talk to. */
function readiness(device: DeviceRow | undefined): { ok: boolean; reason: string | null } {
  if (!device?.imei) return { ok: false, reason: 'No tracker registered on this vehicle.' };
  if (device.command) return { ok: false, reason: 'A command is already on its way to the tracker.' };
  if (device.immobilized) return { ok: false, reason: 'Vehicle is already immobilized.' };
  return { ok: true, reason: null };
}

/**
 * What an engage request has to carry before it is treated as a manager's
 * decision. Immobilizing must never happen from a stray call, a retried
 * request, a refactor that forgets a guard, or a test hitting the wrong
 * endpoint — so the request has to say, in two independent ways, that it
 * means this vehicle: `confirm: true` and the vehicle's own plate. The
 * dashboard's yes/no modal is the only thing that sends both.
 */
export interface EngageIntent {
  confirm?: unknown;
  licensePlate?: unknown;
}

export function engageIntentError(intent: EngageIntent | null | undefined, plate: string): string | null {
  if (intent?.confirm !== true) {
    return 'Immobilize requires an explicit confirmation (confirm: true).';
  }
  const given = typeof intent.licensePlate === 'string' ? intent.licensePlate.trim().toUpperCase() : '';
  if (!given || given !== plate.trim().toUpperCase()) {
    return 'Immobilize requires the vehicle’s licence plate, and it did not match.';
  }
  return null;
}

function phaseOf(device: DeviceRow): ImmobilizerPhase {
  if (device.command === 'engage') return device.sentAt ? 'engage_sent' : 'engage_queued';
  if (device.command === 'release') return device.sentAt ? 'release_sent' : 'release_queued';
  if (!device.immobilized) return 'released';
  const confirmedByDevice =
    device.dout1State === 1 &&
    !!device.dout1ReportedAt &&
    !!device.immobilizedAt &&
    new Date(device.dout1ReportedAt).getTime() >= new Date(device.immobilizedAt).getTime() - 1000;
  return confirmedByDevice ? 'engaged_confirmed' : 'engaged';
}

export async function getImmobilizerStatus(
  vehicleId: string,
  customerId: string
): Promise<ImmobilizerStatus> {
  const device = await loadDevice(vehicleId, customerId);
  const check = readiness(device);
  const ackReply = device?.ack ? parseSetDigoutReply(device.ack) : null;

  return {
    immobilized: !!device?.immobilized,
    immobilizedAt: iso(device?.immobilizedAt),
    canImmobilize: check.ok && !device?.immobilized,
    blockedReason: device?.immobilized ? null : check.reason,
    deviceOnline: isFresh(device?.lastSeenAt ?? null),
    linkOpen: !!device?.imei && !!link?.isConnected(device.imei),
    lastSeenAt: iso(device?.lastSeenAt),
    phase: device ? phaseOf(device) : 'released',
    relay: {
      output: `DOUT${RELAY_OUTPUT}`,
      engageCommand: CMD_ENGAGE,
      releaseCommand: CMD_RELEASE,
    },
    command:
      device?.command === 'engage' || device?.command === 'release'
        ? {
            kind: device.command,
            text: device.commandText ?? (device.command === 'engage' ? CMD_ENGAGE : CMD_RELEASE),
            queuedAt: iso(device.queuedAt),
            sentAt: iso(device.sentAt),
          }
        : null,
    ack:
      device?.ack && device.ackAt
        ? {
            text: device.ack,
            at: new Date(device.ackAt).toISOString(),
            level: ackReply ? levelFromReply(ackReply, RELAY_OUTPUT) : null,
          }
        : null,
    dout1:
      device?.dout1State != null && device.dout1ReportedAt
        ? {
            level: device.dout1State === 1 ? 1 : 0,
            since: new Date(device.dout1ReportedAt).toISOString(),
          }
        : null,
    doorLock: {
      output: `DOUT${DOOR_LOCK_OUTPUT}`,
      command: CMD_LOCK_DOORS,
      sentAt: iso(device?.doorLockSentAt),
      ack:
        device?.doorLockAck && device.doorLockAckAt
          ? (() => {
              const reply = parseSetDigoutReply(device.doorLockAck);
              return {
                text: device.doorLockAck,
                at: new Date(device.doorLockAckAt).toISOString(),
                level: reply ? levelFromReply(reply, DOOR_LOCK_OUTPUT) : null,
              };
            })()
          : null,
    },
  };
}

export interface ImmobilizerActionResult {
  ok: boolean;
  error?: string;
  status?: ImmobilizerStatus;
}

/**
 * Hands the queued command to the tracker if it has a socket open. Returns
 * whether it went. Called at request time and again on every handshake, so
 * a command that found no socket goes the moment the device next dials in.
 */
async function deliver(imei: string, kind: CommandKind, text: string): Promise<boolean> {
  if (!link?.isConnected(imei)) return false;
  link.send(imei, text);
  await db
    .update(devices)
    .set({ immobilizerSentAt: sql`NOW()`, updatedAt: sql`NOW()` })
    .where(eq(devices.imei, imei));
  console.log(`[immobilizer] ${imei} ${kind}: sent "${text}"`);
  return true;
}

async function setImmobilized(
  vehicleId: string,
  customerId: string,
  engage: boolean,
  actorLabel: string,
  intent?: EngageIntent
): Promise<ImmobilizerActionResult> {
  if (!IMMOBILIZER_ENABLED) {
    return { ok: false, error: 'Immobilizer is not enabled on this account.' };
  }

  const device = await loadDevice(vehicleId, customerId);
  if (!device?.imei) {
    return { ok: false, error: 'No tracker registered on this vehicle.' };
  }

  const [vehicle] = await db
    .select({ licensePlate: vehicles.licensePlate })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.customerId, customerId)));
  if (!vehicle) {
    return { ok: false, error: 'Vehicle not found.' };
  }
  const plate = vehicle.licensePlate;

  if (engage) {
    const intentError = engageIntentError(intent, plate);
    if (intentError) return { ok: false, error: intentError };
    const check = readiness(device);
    if (!check.ok) return { ok: false, error: check.reason ?? 'Cannot immobilize right now.' };
  }
  // A release is always allowed, and supersedes an engage still on its way.

  const kind: CommandKind = engage ? 'engage' : 'release';
  const text = engage ? CMD_ENGAGE : CMD_RELEASE;

  await db
    .update(devices)
    .set({
      immobilized: engage,
      immobilizedAt: engage ? sql`NOW()` : null,
      immobilizerCommand: kind,
      immobilizerCommandText: text,
      immobilizerQueuedAt: sql`NOW()`,
      immobilizerSentAt: null,
      immobilizerAck: null,
      immobilizerAckAt: null,
      updatedAt: sql`NOW()`,
    })
    .where(eq(devices.imei, device.imei));

  const sent = await deliver(device.imei, kind, text);

  // Every immobilize/release is an audit event, not just a state flip — a
  // manager reviewing this months later should see who did it and when.
  const delivery = sent
    ? 'The command went to the tracker over its open connection.'
    : 'The tracker has no connection open right now; the command is queued and goes the moment it next reports in.';
  await db.insert(alerts).values({
    imei: device.imei,
    customerId,
    vehicleId,
    alertType: engage ? 'immobilizer_engaged' : 'immobilizer_released',
    actor: actorLabel,
    message: engage
      ? `${plate} was remotely immobilized by ${actorLabel} (${text} on ${`DOUT${RELAY_OUTPUT}`}). ${delivery} The engine will not start until it is mobilized.`
      : `${plate} was mobilized by ${actorLabel} (${text} on ${`DOUT${RELAY_OUTPUT}`}). ${delivery} The engine can start normally once the tracker confirms.`,
  });

  const status = await getImmobilizerStatus(vehicleId, customerId);
  return { ok: true, status };
}

export const engageImmobilizer = (
  vehicleId: string,
  customerId: string,
  actorLabel: string,
  intent: EngageIntent
) => setImmobilized(vehicleId, customerId, true, actorLabel, intent);

export const releaseImmobilizer = (vehicleId: string, customerId: string, actorLabel: string) =>
  setImmobilized(vehicleId, customerId, false, actorLabel);

/**
 * Lock every door with a pulse on DOUT2. Same explicit-intent guard as
 * immobilize; unlike immobilize it is never queued — a lock that lands
 * hours later is not what anyone asked for — so the tracker must be
 * connected right now.
 */
export async function lockDoors(
  vehicleId: string,
  customerId: string,
  actorLabel: string,
  intent: EngageIntent
): Promise<ImmobilizerActionResult> {
  const device = await loadDevice(vehicleId, customerId);
  if (!device?.imei) return { ok: false, error: 'No tracker registered on this vehicle.' };

  const [vehicle] = await db
    .select({ licensePlate: vehicles.licensePlate })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.customerId, customerId)));
  if (!vehicle) return { ok: false, error: 'Vehicle not found.' };

  const intentError = engageIntentError(intent, vehicle.licensePlate);
  if (intentError) return { ok: false, error: intentError.replace('Immobilize', 'Locking the doors') };

  if (!link?.isConnected(device.imei)) {
    return {
      ok: false,
      error: 'Tracker is not connected right now — a lock pulse is only sent live, not queued.',
    };
  }

  link.send(device.imei, CMD_LOCK_DOORS);
  awaitingDoorLockReply.add(device.imei);
  await db
    .update(devices)
    .set({ doorLockSentAt: sql`NOW()`, doorLockAck: null, doorLockAckAt: null, updatedAt: sql`NOW()` })
    .where(eq(devices.imei, device.imei));
  console.log(`[immobilizer] ${device.imei} lock doors: sent "${CMD_LOCK_DOORS}"`);

  await db.insert(alerts).values({
    imei: device.imei,
    customerId,
    vehicleId,
    alertType: 'doors_locked',
    actor: actorLabel,
    message: `${vehicle.licensePlate} doors were locked remotely by ${actorLabel} (${CMD_LOCK_DOORS} — a ${DOOR_LOCK_PULSE_SECONDS}s pulse on DOUT${DOOR_LOCK_OUTPUT}).`,
  });

  return { ok: true, status: await getImmobilizerStatus(vehicleId, customerId) };
}

/** Trackers with a door-lock pulse out and no reply yet. */
const awaitingDoorLockReply = new Set<string>();

// ---------------------------------------------------------------------------
// Hooks the TCP server calls as the device side of the exchange comes in.

async function loadByImei(imei: string) {
  const [device] = await db
    .select({
      imei: devices.imei,
      customerId: devices.customerId,
      vehicleId: devices.vehicleId,
      immobilized: devices.immobilized,
      command: devices.immobilizerCommand,
      commandText: devices.immobilizerCommandText,
      queuedAt: devices.immobilizerQueuedAt,
      sentAt: devices.immobilizerSentAt,
    })
    .from(devices)
    .where(eq(devices.imei, imei));
  return device;
}

/** On handshake: send whatever was waiting for this tracker. */
export async function flushQueuedCommand(imei: string): Promise<void> {
  const device = await loadByImei(imei);
  if (!device?.command || device.sentAt) return;
  const text = device.commandText ?? (device.command === 'engage' ? CMD_ENGAGE : CMD_RELEASE);
  await deliver(imei, device.command as CommandKind, text);
}

/**
 * The device's Codec 12 reply. Only a `setdigout` answer is acted on; the
 * text is stored verbatim either way so the UI can show exactly what came
 * back. A reply that already shows the commanded level closes the command;
 * one that does not (the firmware holding it under its speed ceiling) leaves
 * it open for AVL 179 to close later.
 */
export async function handleCommandReply(imei: string, text: string): Promise<void> {
  const device = await loadByImei(imei);
  if (!device) return;

  const reply = parseSetDigoutReply(text);

  // A reply to the door-lock pulse, when nothing else is in flight for this
  // tracker: it says DOUT2 went high, and the device's own timeout drops it.
  if (reply && awaitingDoorLockReply.has(imei) && !device.command) {
    awaitingDoorLockReply.delete(imei);
    await db
      .update(devices)
      .set({ doorLockAck: text, doorLockAckAt: sql`NOW()`, updatedAt: sql`NOW()` })
      .where(eq(devices.imei, imei));
    console.log(`[immobilizer] ${imei} replied "${text}" — door lock acknowledged`);
    return;
  }
  const level = reply ? levelFromReply(reply, RELAY_OUTPUT) : null;
  const wanted: DoutLevel | null =
    device.command === 'engage' ? 1 : device.command === 'release' ? 0 : null;
  const closes = wanted != null && level === wanted;

  await db
    .update(devices)
    .set({
      immobilizerAck: text,
      immobilizerAckAt: sql`NOW()`,
      ...(closes ? { immobilizerCommand: null } : {}),
      updatedAt: sql`NOW()`,
    })
    .where(eq(devices.imei, imei));

  console.log(
    `[immobilizer] ${imei} replied "${text}"${closes ? ` — ${device.command} acknowledged` : ''}`
  );
}

/** Last AVL 179 level seen per tracker, so the row is only written on change. */
const lastDout1 = new Map<string, DoutLevel>();

/**
 * DOUT1 as carried in a data record. Written on change only — "since 09:41"
 * is the useful fact, not one row per packet. A reading that matches a
 * command still open closes it: this is the relay-side confirmation.
 */
export async function handleDoutReading(
  imei: string,
  level: number,
  recordedAt: Date
): Promise<void> {
  const normalised: DoutLevel = level === 1 ? 1 : 0;
  if (lastDout1.get(imei) === normalised) return;
  lastDout1.set(imei, normalised);

  const device = await loadByImei(imei);
  if (!device) return;

  const wanted: DoutLevel | null =
    device.command === 'engage' ? 1 : device.command === 'release' ? 0 : null;
  const closes = wanted != null && !!device.sentAt && normalised === wanted;

  await db
    .update(devices)
    .set({
      dout1State: normalised,
      dout1ReportedAt: recordedAt,
      ...(closes ? { immobilizerCommand: null } : {}),
      updatedAt: sql`NOW()`,
    })
    .where(eq(devices.imei, imei));

  console.log(
    `[immobilizer] ${imei} DOUT1 now ${normalised}${closes ? ` — ${device.command} confirmed by AVL 179` : ''}`
  );
}
