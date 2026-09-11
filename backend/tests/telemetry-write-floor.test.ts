import { describe, it, expect } from '@jest/globals';
import {
  applyBurnCarry,
  shouldSkipTelemetryRow,
  FloorState,
} from '../src/lib/telemetry-write-floor';

const FLOOR_S = 7;

const at = (seconds: number) => seconds * 1000;

describe('shouldSkipTelemetryRow', () => {
  const previous: FloorState = { atMs: at(100), ignitionOn: true };

  it('keeps the first record for a device', () => {
    expect(
      shouldSkipTelemetryRow({
        recordedAtMs: at(0),
        ignitionOn: true,
        eventId: 0,
        previous: null,
        minSpacingS: FLOOR_S,
      })
    ).toBe(false);
  });

  it('skips a periodic record inside the floor', () => {
    expect(
      shouldSkipTelemetryRow({
        recordedAtMs: at(103),
        ignitionOn: true,
        eventId: 0,
        previous,
        minSpacingS: FLOOR_S,
      })
    ).toBe(true);
  });

  it('keeps a periodic record once the floor has elapsed', () => {
    expect(
      shouldSkipTelemetryRow({
        recordedAtMs: at(107),
        ignitionOn: true,
        eventId: 0,
        previous,
        minSpacingS: FLOOR_S,
      })
    ).toBe(false);
  });

  // Ignition edges are what segment one trip from the next, and scenario
  // events are the whole input to the alerts feed. Holding either back to
  // satisfy a spacing rule would lose the record the logic is built on.
  it('never holds back an eventful record', () => {
    expect(
      shouldSkipTelemetryRow({
        recordedAtMs: at(101),
        ignitionOn: true,
        eventId: 239,
        previous,
        minSpacingS: FLOOR_S,
      })
    ).toBe(false);
  });

  it('never holds back a change of ignition state', () => {
    expect(
      shouldSkipTelemetryRow({
        recordedAtMs: at(101),
        ignitionOn: false,
        eventId: 0,
        previous,
        minSpacingS: FLOOR_S,
      })
    ).toBe(false);
  });

  // A tracker that loses GSM coverage buffers its records and dumps the queue
  // on reconnect. Those timestamps run behind the last row written, and a
  // naive "too soon" test would discard the whole dump.
  it('keeps a record older than the last one written', () => {
    expect(
      shouldSkipTelemetryRow({
        recordedAtMs: at(40),
        ignitionOn: true,
        eventId: 0,
        previous,
        minSpacingS: FLOOR_S,
      })
    ).toBe(false);
  });

  it('is disabled by a zero spacing', () => {
    expect(
      shouldSkipTelemetryRow({
        recordedAtMs: at(100.5),
        ignitionOn: true,
        eventId: 0,
        previous,
        minSpacingS: 0,
      })
    ).toBe(false);
  });
});

describe('applyBurnCarry', () => {
  it('holds a skipped hop\'s burn rather than discarding it', () => {
    expect(applyBurnCarry(true, 40, 0)).toEqual({ burnMl: null, carriedMl: 40 });
  });

  it('accumulates across consecutive skipped hops', () => {
    let carried = 0;
    for (const hop of [40, 35, 25]) {
      ({ carriedMl: carried } = applyBurnCarry(true, hop, carried));
    }
    expect(carried).toBe(100);
  });

  it('pays the carry onto the next row written', () => {
    expect(applyBurnCarry(false, 30, 100)).toEqual({ burnMl: 130, carriedMl: 0 });
  });

  it('pays a carry even when the written hop modelled no burn', () => {
    expect(applyBurnCarry(false, null, 60)).toEqual({ burnMl: 60, carriedMl: 0 });
  });

  it('leaves a null burn alone when nothing is owed', () => {
    expect(applyBurnCarry(false, null, 0)).toEqual({ burnMl: null, carriedMl: 0 });
  });

  // The invariant the whole carry exists to protect: consumption is SUMmed from
  // burn_ml across rows, so thinning the rows must not change the total. A
  // shortfall here is fuel the fleet burned and the product never reported.
  it('preserves total burn exactly across a thinned series', () => {
    const hops = [12, 8, 40, 5, 33, 21, 9, 17, 4, 28];
    // Every third hop survives the floor; the rest are folded forward.
    const skipped = hops.map((_, i) => i % 3 !== 0);

    let carried = 0;
    let persisted = 0;
    hops.forEach((hop, i) => {
      const result = applyBurnCarry(skipped[i], hop, carried);
      carried = result.carriedMl;
      persisted += result.burnMl ?? 0;
    });

    const unthinned = hops.reduce((sum, hop) => sum + hop, 0);
    expect(persisted + carried).toBe(unthinned);
  });
});
