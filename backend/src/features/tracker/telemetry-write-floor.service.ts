/**
 * Decides which incoming AVL records earn a `telemetry` row of their own.
 *
 * The FMC150 does not report on a timer. It reports on min-distance and
 * min-angle triggers, so while moving roughly a third of its records arrive
 * less than two seconds apart and every corner produces a burst. Replaying 30
 * days of real driving through `segmentTrips` at increasing spacings measured
 * the cost of thinning them:
 *
 *   floor   rows kept   distance error   stops+pauses   trips
 *   as-is       100%               —         78/78        18
 *   5s         61.6%          -0.03%         69/78        18
 *   7s         49.8%          -0.18%         67/78        18
 *   30s        18.6%          -2.87%         54/78        18
 *
 * Seven seconds halves the table for 0.18% of distance, with trip count and
 * idle minutes untouched. Short pauses are the real cost and most of that loss
 * is already incurred at five seconds, which is why the extra two are cheap.
 *
 * This floor governs `telemetry` ALONE. `device_frames` keeps every record:
 * `harsh-driving.ts` discards any sample pair spaced more than MAX_SAMPLE_GAP_S
 * (5s) apart, so thinning frames to 7s would silently reduce harsh
 * acceleration, braking and cornering detection to nothing and take the
 * driving-behaviour score down with it.
 */

/** Seconds. Override per deployment; 0 disables the floor entirely. */
export const TELEMETRY_MIN_SPACING_S = Number(process.env.TELEMETRY_MIN_SPACING_S || 7);

export interface FloorState {
  /** When the last row was actually written, in epoch ms. */
  atMs: number;
  ignitionOn: boolean;
}

export interface FloorInput {
  recordedAtMs: number;
  ignitionOn: boolean;
  /** The AVL event ID that triggered the record; 0 or null means periodic. */
  eventId: number | null | undefined;
  /** State from the last row written for this device, or null if none yet. */
  previous: FloorState | null;
  minSpacingS?: number;
}

/**
 * Whether this record may be folded into the next one.
 *
 * Three things always earn a row, whatever the spacing:
 *  - the first record seen for a device, which has nothing to measure against;
 *  - an eventful record — ignition edges, scenario events and geofence
 *    crossings are exactly the rows the trip and alert logic reads;
 *  - a change of ignition state, which is what segments one trip from the next;
 *  - a record older than the last one written, which means a buffered dump.
 */
export function shouldSkipTelemetryRow(input: FloorInput): boolean {
  const spacingMs = (input.minSpacingS ?? TELEMETRY_MIN_SPACING_S) * 1000;
  if (spacingMs <= 0) return false;
  if (input.previous == null) return false;
  if (input.eventId != null && input.eventId !== 0) return false;
  if (input.previous.ignitionOn !== input.ignitionOn) return false;

  const sinceLastMs = input.recordedAtMs - input.previous.atMs;
  // An older timestamp than the row before it is a device emptying its buffer
  // after a stretch with no GSM coverage, which is exactly when the FMC130
  // dumps a queue out of order. Treating "negative" as "too soon" would throw
  // that history away silently, so anything not moving forward is kept.
  if (sinceLastMs < 0) return false;

  return sinceLastMs < spacingMs;
}

/**
 * Modelled burn owed to the next row that is written, in millilitres.
 *
 * `burn_ml` is not a reading. It is the fuel burned over the hop *ending* at
 * that row, and `telemetry-deltas-sql` sums it to report consumption. Dropping
 * a row without carrying its millilitres forward would quietly under-report
 * every litre the fleet burned — the one number the product exists to state.
 *
 * Returns the burn to store on this row and the carry to hold for the next, so
 * that the sum over any window is identical to the unthinned series.
 */
export function applyBurnCarry(
  skipping: boolean,
  hopBurnMl: number | null,
  carriedMl: number
): { burnMl: number | null; carriedMl: number } {
  if (skipping) {
    return { burnMl: null, carriedMl: carriedMl + (hopBurnMl ?? 0) };
  }
  if (carriedMl === 0) return { burnMl: hopBurnMl, carriedMl: 0 };

  return { burnMl: (hopBurnMl ?? 0) + carriedMl, carriedMl: 0 };
}
