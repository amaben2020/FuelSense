// Derives idling from the ignition and speed the tracker already sends.
//
// The Excessive Idling scenario (AVL 251) is not enabled on our trackers, so
// no idling event ever arrives from the device. But an engine that is running
// while the vehicle sits still is fully described by what we do receive:
// ignition ON with GNSS speed at zero. This module turns that into the same
// `idling_start` / `idling_end` events the decoder would have produced from
// AVL 251, so the driving-behaviour feed is correct without reconfiguring
// hardware in the field.
//
// Duration is measured from record TIMESTAMPS, never from how many records
// arrived. That matters: parked with the engine running, the FMC150 drops to
// its "on stop" cadence and can go an hour between frames. Timestamp maths
// still reports that hour correctly; counting frames would report nothing.
import { recordDeviceEvent } from '../devices/device-event-decoder.service';
import { db, alerts } from '../../shared/db-helpers';
import { idleFuelBurnLiters, DEFAULT_FUEL_PRICE_NGN_LITER } from '../fuel/fuel-metrics.service';
import { IDLE_GAP_CAP_SECONDS } from './telemetry-deltas.repository';
import { latestReceiptPrice } from '../fuel/fuel-price.service';
import { DetectorState } from '../../shared/detector-state';

// Below this the vehicle is not travelling — GNSS reports a few km/h of
// Doppler noise while stationary. Matches the idle definition already used by
// trip segmentation and the daily-activity rollup.
const IDLE_SPEED_KPH = 2;

// How long the engine must run stationary before it counts. Short enough to
// catch a driver warming the car up, long enough that a pause at a junction
// with the ignition on is not reported as idling.
const IDLE_MIN_MS = Number(process.env.IDLE_MIN_SECONDS || 120) * 1000;

// Idling past this is money burning with nothing moving, so the manager is
// told while it is still happening rather than at the end of the day.
const IDLE_ALERT_MINUTES = Number(process.env.IDLE_ALERT_MINUTES || 5);

export interface IdleReading {
  ignitionOn: boolean;
  speedKph: number | null;
  recordedAt: Date;
}

/**
 * Longest silence that may still be counted as idling, in ms.
 *
 * The same ceiling the delta queries apply per hop, so the event feed and the
 * daily reports cannot disagree about what an unobserved gap is worth. On the
 * reference vehicle the gap between frames while idling has a median of 25 s
 * and a 90th percentile of 6.5 minutes, so a 10-minute ceiling costs almost
 * nothing on real idling and refuses the outages outright.
 */
const MAX_IDLE_GAP_MS = IDLE_GAP_CAP_SECONDS * 1000;

export interface IdleState {
  idleSince: Date;
  /** The last frame seen during this stretch — the end of observed time. */
  lastSeenAt: Date;
  /**
   * Idling we actually watched happen: the sum of gaps between consecutive
   * frames, each capped at `MAX_IDLE_GAP_MS`.
   *
   * This is the whole point of the state machine. Measuring instead from
   * `idleSince` to whichever frame arrives next books every silence as
   * idling: on 23 September a tracker slept for 16.6 hours — with the
   * ignition reading OFF on its last frame before the silence — and the next
   * frame closed the stretch at "idled 16h 35m, ≈14.93 L burned", against a
   * true figure of about 12 minutes. That is a fabricated accusation attached
   * to a named driver, and no fleet manager can tell it from a real one.
   */
  observedMs: number;
  /** True once `idling_start` has been written for this stretch. */
  startEmitted: boolean;
  /** True once the long-idle alert has been raised for this stretch. */
  alerted?: boolean;
}

/** Observed idling so far, in minutes — the only duration ever reported. */
export function observedIdleMinutes(state: IdleState): number {
  return Math.round((state.observedMs / 60000) * 10) / 10;
}

const beginStretch = (at: Date): IdleState => ({
  idleSince: at,
  lastSeenAt: at,
  observedMs: 0,
  startEmitted: false,
});

export interface IdleEmission {
  eventType: 'idling_start' | 'idling_end';
  occurredAt: Date;
  /** Minutes idled — carried on the end event only. */
  minutes: number | null;
}

const isStationaryRunning = (r: IdleReading): boolean =>
  r.ignitionOn && (r.speedKph ?? 0) < IDLE_SPEED_KPH;

/**
 * Pure state machine — one telemetry reading in, the next state and any
 * events to write out. Kept side-effect free so the timing rules can be
 * tested without a database or a device.
 */
export function stepIdle(
  state: IdleState | null,
  reading: IdleReading
): { state: IdleState | null; emissions: IdleEmission[] } {
  /** Closes a stretch at the last frame that actually witnessed it. */
  const close = (s: IdleState): IdleEmission[] => {
    const minutes = observedIdleMinutes(s);
    if (!s.startEmitted && s.observedMs < IDLE_MIN_MS) return [];
    const out: IdleEmission[] = [];
    // A qualifying stretch that ended before any frame crossed the threshold
    // still gets both events, backdated. Without this, an idle that the device
    // reported only at its start and its end would vanish entirely.
    if (!s.startEmitted) {
      out.push({ eventType: 'idling_start', occurredAt: s.idleSince, minutes: null });
    }
    // Ends at the last frame we saw, not at the frame that happens to be in
    // hand — those are the same instant during normal reporting and hours
    // apart after an outage.
    out.push({ eventType: 'idling_end', occurredAt: s.lastSeenAt, minutes });
    return out;
  };

  if (isStationaryRunning(reading)) {
    if (!state) return { state: beginStretch(reading.recordedAt), emissions: [] };

    const gap = reading.recordedAt.getTime() - state.lastSeenAt.getTime();

    // Silence longer than the cap is not evidence of anything. Whatever the
    // engine did through it, we did not see it: bank what was observed, and
    // let this frame open a fresh stretch.
    if (gap > MAX_IDLE_GAP_MS) {
      return { state: beginStretch(reading.recordedAt), emissions: close(state) };
    }

    const next: IdleState = {
      ...state,
      lastSeenAt: reading.recordedAt,
      observedMs: state.observedMs + Math.max(0, gap),
    };

    if (!next.startEmitted && next.observedMs >= IDLE_MIN_MS) {
      return {
        state: { ...next, startEmitted: true },
        // Backdated to when the engine actually started sitting, not to the
        // frame that happened to cross the threshold.
        emissions: [{ eventType: 'idling_start', occurredAt: next.idleSince, minutes: null }],
      };
    }
    return { state: next, emissions: [] };
  }

  // Engine off, or the vehicle has started moving — either way the stretch is
  // over. Its final hop counts only up to the cap, for the same reason.
  if (!state) return { state: null, emissions: [] };

  const finalGap = Math.max(0, reading.recordedAt.getTime() - state.lastSeenAt.getTime());
  const ended: IdleState = {
    ...state,
    observedMs: state.observedMs + Math.min(finalGap, MAX_IDLE_GAP_MS),
    lastSeenAt:
      finalGap > MAX_IDLE_GAP_MS
        ? new Date(state.lastSeenAt.getTime() + MAX_IDLE_GAP_MS)
        : reading.recordedAt,
  };

  return { state: null, emissions: close(ended) };
}

// An idle stretch outlives a restart: parked with the engine running the
// tracker can go an hour between frames, so a deploy in that hour must not
// forget when the engine started sitting.
const stateByImei = new DetectorState<IdleState>('idle', {
  ttlSeconds: 6 * 60 * 60,
  revive: (raw) => {
    const r = raw as {
      idleSince: string;
      lastSeenAt?: string;
      observedMs?: number;
      startEmitted: boolean;
      alerted?: boolean;
    };
    const idleSince = new Date(r.idleSince);
    return {
      ...r,
      idleSince,
      // Rows written before observed-time accounting existed carry neither
      // field. Treating them as "nothing observed yet" is the safe read: the
      // stretch restarts from this frame rather than inheriting a wall-clock
      // claim nobody measured.
      lastSeenAt: r.lastSeenAt ? new Date(r.lastSeenAt) : idleSince,
      observedMs: typeof r.observedMs === 'number' ? r.observedMs : 0,
    };
  },
});

export function resetIdleDetectorState(): void {
  stateByImei.clear();
}

export interface IdleContext {
  imei: string;
  customerId: string;
  vehicleId: string;
  latitude: string | null;
  longitude: string | null;
  ignitionOn: boolean;
  speedKph: number | null;
  recordedAt: Date;
  licensePlate?: string | null;
}

/**
 * One alert per idle stretch that runs past the threshold.
 *
 * Deliberately not deduped against still-open alerts the way scenario events
 * are: each stretch is a separate cost the manager is entitled to see, and
 * suppressing the second one because the first was never dismissed would hide
 * exactly the repeat behaviour worth acting on.
 */
async function raiseIdleAlert(ctx: IdleContext, minutes: number): Promise<void> {
  const liters = idleFuelBurnLiters(minutes / 60);
  const price = await latestReceiptPrice(ctx.customerId).catch(() => null);
  // Priced off the last receipt a driver actually paid, so the naira figure
  // tracks the pump rather than an assumed rate.
  const ngnPerLiter = price?.ngnPerLiter ?? DEFAULT_FUEL_PRICE_NGN_LITER;
  const cost = Math.round(liters * ngnPerLiter);
  const plate = ctx.licensePlate ?? 'vehicle';

  await db.insert(alerts).values({
    imei: ctx.imei,
    customerId: ctx.customerId,
    vehicleId: ctx.vehicleId,
    alertType: 'excessive_idle',
    message: `${plate} idled ${Math.round(minutes)} min with the engine running and the vehicle stationary — about ${liters.toFixed(1)}L burned (₦${cost.toLocaleString('en-NG')} at ₦${Math.round(ngnPerLiter)}/L).`,
    fuelDropLiters: liters.toFixed(2),
    estimatedLossNgn: cost,
    latitude: ctx.latitude,
    longitude: ctx.longitude,
  });
}

/**
 * Feed every telemetry record here. Returns the events written, if any.
 *
 * State is memory-first with a Redis copy, so a restart mid-idle picks the
 * stretch back up; without Redis it behaves as before and the next
 * stationary record starts a fresh one.
 */
export async function handleIdleForRecord(ctx: IdleContext): Promise<IdleEmission[]> {
  const prior = await stateByImei.get(ctx.imei);
  const { state, emissions } = stepIdle(prior, {
    ignitionOn: ctx.ignitionOn,
    speedKph: ctx.speedKph,
    recordedAt: ctx.recordedAt,
  });

  if (state) {
    // Alert while the engine is still running, not in hindsight: parked with
    // the ignition on, the FMC150 slows to its stop cadence, so the crossing
    // is detected on whichever frame arrives after the threshold passes.
    const minutes = observedIdleMinutes(state);
    if (!state.alerted && minutes >= IDLE_ALERT_MINUTES) {
      await raiseIdleAlert(ctx, minutes);
      state.alerted = true;
    }
    stateByImei.set(ctx.imei, state);
  } else {
    // A stretch that began and ended between two frames never had a chance to
    // cross the threshold live — its true length is only known now.
    const ended = emissions.find((e) => e.eventType === 'idling_end');
    if (!prior?.alerted && ended?.minutes != null && ended.minutes >= IDLE_ALERT_MINUTES) {
      await raiseIdleAlert(ctx, ended.minutes);
    }
    stateByImei.delete(ctx.imei);
  }

  for (const emission of emissions) {
    await recordDeviceEvent(
      {
        eventType: emission.eventType,
        severity: 'info',
        value: emission.minutes,
        unit: emission.minutes != null ? 'min' : null,
        // Idling is a running cost, not a security incident — it belongs in
        // the behaviour feed, not in the alert list.
        alertMessage: null,
      },
      {
        imei: ctx.imei,
        customerId: ctx.customerId,
        vehicleId: ctx.vehicleId,
        latitude: ctx.latitude,
        longitude: ctx.longitude,
        speedKph: 0,
        occurredAt: emission.occurredAt,
      }
    );
  }

  return emissions;
}
