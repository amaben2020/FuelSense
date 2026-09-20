/**
 * Tracker power-loss detection, derived from AVL 66 (external voltage).
 *
 * The FMC150 has a dedicated unplug scenario — AVL 252, decoded in
 * device-event-decoder.ts — but it only emits when that scenario is enabled in
 * the Configurator, and on this fleet it is not. The scenario events this
 * device actually sends are 239, 240, 243, 253, 255 and 303. There is no 252 in
 * the entire history of the table.
 *
 * That left a real disconnect completely unreported. On 2026-08-26 the tracker
 * was unplugged from the OBD port for 40 minutes and 50 seconds — 14:56:31 to
 * 15:37:22 — and AVL 66 read exactly 0 across all 75 frames of it. The evidence
 * was captured perfectly and nothing looked at it.
 *
 * Nor would anything have: `device_offline` is the only other path, and it
 * fires on silence after two hours. A tracker running on its internal battery
 * is not silent. It keeps reporting, which is precisely what makes an unplug
 * the one tamper case that watchdog structurally cannot see.
 *
 * So the level is read directly. Where AVL 252 is enabled, both paths produce
 * the same `power_unplug` event type and the same alert, and dedup on open
 * alerts keeps them from doubling up.
 */
import { getIoValue } from '../tracker/avl-io.service';
import { recordDeviceEvent, resolveClosedAlert } from './device-event-decoder.service';
import { db, alerts, eq, and, inArray, sql } from '../../shared/db-helpers';

export const EXTERNAL_VOLTAGE_AVL_ID = 66;

/**
 * Below this, the tracker has no external supply, in millivolts.
 *
 * An unplugged device reads 0. A running vehicle reads 12,000–14,500, and even
 * a badly flat battery sits near 9,000–11,000 — so 6,000 is chosen to be
 * unambiguous rather than sensitive. The failure this must not have is crying
 * tamper at a weak battery on a cold morning.
 */
export const EXTERNAL_POWER_MIN_MV = Number(
  process.env.EXTERNAL_POWER_MIN_MV || 6000
);

/**
 * Consecutive low readings before an unplug is called.
 *
 * One frame is not enough: a single corrupt or mid-write IO block would raise a
 * critical tamper alert. Kept as a floor under the duration rule below.
 */
export const CONSECUTIVE_LOW_FRAMES = Number(
  process.env.EXTERNAL_POWER_LOW_FRAMES || 2
);

/**
 * How long the supply must stay low before anything is reported, in seconds.
 *
 * Two frames turned out to be two *seconds* on a moving vehicle, and on
 * 2026-09-13 that produced seven "unplugged" alarms in a day for one real
 * unplug. The others were the supply dipping to 0 V for a frame or two —
 * one lasted two seconds — which is a connector losing contact, not a hand
 * on the plug. The genuine episodes (26 Aug: 41 min; 13 Sep: 3 min) clear a
 * minute easily, and a tamper reported sixty seconds late is still reported.
 */
export const SUSTAINED_LOW_SECONDS = Number(
  process.env.EXTERNAL_POWER_LOW_SECONDS || 60
);

/**
 * Above this speed the vehicle counts as moving for the tamper-or-wiring call.
 *
 * On 13 Sep the supply read 0 V for four and a half minutes while the vehicle
 * was doing 58–88 km/h, after sagging to 5.3 V twice in the minute before.
 * Nobody pulled the plug at 88 km/h: that is the OBD connector losing contact
 * under vibration — a wiring fault a manager should hear about, but not a
 * critical tamper alarm. A tracker unplugged by a person is unplugged while
 * the vehicle is stopped.
 */
export const MOVING_KPH = 5;

interface PowerContext {
  imei: string;
  customerId: string;
  vehicleId: string;
  latitude: string | null;
  longitude: string | null;
  speedKph: number | null;
  occurredAt: Date;
  licensePlate?: string;
}

/**
 * Per-device power state.
 *
 * `unplugged` is seeded from the database the first time a device is seen, not
 * assumed — a restart mid-disconnect must not re-raise an alert that is already
 * open, and must still be able to report the restore when power comes back.
 */
interface PowerState {
  unplugged: boolean;
  lowStreak: number;
  /** When the current run of low readings began (ms epoch); null when powered. */
  lowSince: number | null;
  /** Whether the vehicle moved at any point during the current low run. */
  movedWhileLow: boolean;
}

/** One voltage reading, with the two facts the rule needs alongside it. */
export interface PowerReading {
  externalMv: number | null;
  at: Date;
  speedKph: number | null;
}

const state = new Map<string, PowerState>();

/** Exposed for tests and for the backfill, which replays history per device. */
export const resetPowerState = (imei?: string): void => {
  if (imei) state.delete(imei);
  else state.clear();
};

const hasOpenUnplugAlert = async (
  customerId: string,
  vehicleId: string
): Promise<boolean> => {
  const [row] = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.customerId, customerId),
        eq(alerts.vehicleId, vehicleId),
        inArray(alerts.alertType, ['power_unplug', 'power_dropout']),
        eq(alerts.isResolved, false)
      )
    )
    .limit(1);
  return !!row;
};

const loadState = async (ctx: PowerContext): Promise<PowerState> => {
  const existing = state.get(ctx.imei);
  if (existing) return existing;

  const seeded: PowerState = {
    unplugged: await hasOpenUnplugAlert(ctx.customerId, ctx.vehicleId),
    lowStreak: 0,
    lowSince: null,
    movedWhileLow: false,
  };
  state.set(ctx.imei, seeded);
  return seeded;
};

/**
 * `unplugged` — power lost on a stationary vehicle: a tamper until proven
 * otherwise. `dropout` — power lost while moving: the wiring, not a hand.
 * `restored` closes either.
 */
export type PowerTransition = 'unplugged' | 'dropout' | 'restored' | null;

/**
 * The whole rule, as a pure function: given a reading and the state before it,
 * what transition does this frame represent and what is the state after?
 *
 * Split out from the persistence so the thresholds and the debounce can be
 * tested against real voltage sequences without a database — and so the live
 * detector and the backfill provably share one definition of "unplugged"
 * rather than two implementations that drift.
 *
 * `externalMv` of null means the frame did not carry AVL 66. That is not
 * evidence of anything: a device with the element disabled must never be
 * reported as unplugged for failing to send a reading it never sends.
 */
export const decidePowerTransition = (
  reading: PowerReading,
  before: PowerState
): { transition: PowerTransition; after: PowerState } => {
  const { externalMv } = reading;
  if (externalMv == null || !Number.isFinite(externalMv)) {
    return { transition: null, after: before };
  }

  if (externalMv < EXTERNAL_POWER_MIN_MV) {
    const lowStreak = before.lowStreak + 1;
    const lowSince = before.lowSince ?? reading.at.getTime();
    const movedWhileLow = before.movedWhileLow || (reading.speedKph ?? 0) > MOVING_KPH;
    const after: PowerState = { unplugged: before.unplugged, lowStreak, lowSince, movedWhileLow };
    if (before.unplugged) return { transition: null, after };
    const lowForSeconds = (reading.at.getTime() - lowSince) / 1000;
    if (lowStreak < CONSECUTIVE_LOW_FRAMES || lowForSeconds < SUSTAINED_LOW_SECONDS) {
      return { transition: null, after };
    }
    return {
      transition: movedWhileLow ? 'dropout' : 'unplugged',
      after: { ...after, unplugged: true },
    };
  }

  const powered: PowerState = {
    unplugged: false,
    lowStreak: 0,
    lowSince: null,
    movedWhileLow: false,
  };
  return { transition: before.unplugged ? 'restored' : null, after: powered };
};

/**
 * Called for every telemetry record. Returns the transition it recorded, or
 * null — which is the overwhelmingly common case, since power does not change.
 *
 * A frame without AVL 66 is not evidence of anything and is ignored outright.
 * Devices with the element disabled must not be reported as unplugged for the
 * absence of a reading they were never going to send.
 */
export const handlePowerForRecord = async (
  io: Record<string | number, unknown> | undefined | null,
  ctx: PowerContext
): Promise<PowerTransition> => {
  const externalMv = getIoValue(io, EXTERNAL_VOLTAGE_AVL_ID);
  if (externalMv == null || !Number.isFinite(externalMv)) return null;

  const current = await loadState(ctx);
  const { transition, after } = decidePowerTransition(
    { externalMv, at: ctx.occurredAt, speedKph: ctx.speedKph },
    current
  );
  state.set(ctx.imei, after);

  if (transition === null) return null;

  const plate = ctx.licensePlate || ctx.imei;
  const lowForMin = after.lowSince
    ? Math.max(1, Math.round((ctx.occurredAt.getTime() - after.lowSince) / 60_000))
    : 1;

  if (transition === 'unplugged') {
    await recordDeviceEvent(
      {
        eventType: 'power_unplug',
        severity: 'critical',
        value: externalMv,
        unit: 'mV',
        alertMessage:
          `Tracker on ${plate} lost main power and is running on its internal ` +
          `battery, with the vehicle stationary, for ${lowForMin} min so far. ` +
          `External voltage read ${(externalMv / 1000).toFixed(1)}V. ` +
          `Possible tamper or disconnect.`,
      },
      ctx
    );
    return 'unplugged';
  }

  if (transition === 'dropout') {
    await recordDeviceEvent(
      {
        eventType: 'power_dropout',
        severity: 'warning',
        value: externalMv,
        unit: 'mV',
        alertMessage:
          `Tracker on ${plate} lost vehicle power while the vehicle was moving ` +
          `and has run on its internal battery for ${lowForMin} min so far. ` +
          `That is the power connector losing contact, not a hand on the plug — ` +
          `have the OBD/power wiring checked.`,
      },
      ctx
    );
    return 'dropout';
  }

  // Power is back. `power_restored` carries no alert message of its own — it
  // exists to close the open unplug or dropout alert, exactly as AVL 252's
  // off-state does.
  await recordDeviceEvent(
    {
      eventType: 'power_restored',
      severity: 'info',
      value: externalMv,
      unit: 'mV',
      alertMessage: null,
    },
    ctx
  );
  await resolveClosedAlert('power_restored', ctx.customerId, ctx.vehicleId);
  return 'restored';
};

/**
 * How long the tracker has been without external power, from the open alert.
 * Null when it is powered. Used by the API so a manager sees duration rather
 * than a timestamp they have to subtract.
 */
export const openUnplugSince = async (
  customerId: string,
  vehicleId: string
): Promise<Date | null> => {
  const [row] = await db
    .select({ createdAt: alerts.createdAt })
    .from(alerts)
    .where(
      and(
        eq(alerts.customerId, customerId),
        eq(alerts.vehicleId, vehicleId),
        eq(alerts.alertType, 'power_unplug'),
        eq(alerts.isResolved, false)
      )
    )
    .orderBy(sql`created_at DESC`)
    .limit(1);
  return row?.createdAt ?? null;
};
