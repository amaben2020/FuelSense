import { describe, it, expect } from '@jest/globals';
import { stepIdle, type IdleState } from '../src/features/telemetry/idle-detector.service';

const at = (iso: string) => new Date(`2026-09-26T${iso}+01:00`);

/** Feed readings in order, collecting every event written. */
function run(readings: Array<{ t: string; ign: boolean; kph: number }>) {
  let state: IdleState | null = null;
  const events: Array<{ type: string; minutes: number | null }> = [];
  for (const r of readings) {
    const out = stepIdle(state, {
      ignitionOn: r.ign,
      speedKph: r.kph,
      recordedAt: at(r.t),
    });
    state = out.state;
    for (const e of out.emissions) events.push({ type: e.eventType, minutes: e.minutes });
  }
  return { state, events };
}

describe('idle stretches are not split by stationary GNSS noise', () => {
  it('holds one stretch through a single speed blip', () => {
    // A parked engine reporting a 5 km/h Doppler wobble mid-warm-up. This is
    // the 26 September case: 16:38 + 16:53 were one idle, reported as two.
    const { events } = run([
      { t: '16:38:00', ign: true, kph: 0 },
      { t: '16:45:00', ign: true, kph: 0 },
      { t: '16:52:00', ign: true, kph: 5 }, // the wobble
      { t: '16:53:00', ign: true, kph: 0 }, // settled again
      { t: '17:03:00', ign: true, kph: 0 },
      { t: '17:04:00', ign: false, kph: 0 }, // engine off, stretch ends
    ]);

    expect(events.filter((e) => e.type === 'idling_start')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'idling_end')).toHaveLength(1);
  });

  it('does not credit the wobble window as idling', () => {
    // Frames every five minutes, so no hop reaches the ten-minute gap cap and
    // the arithmetic below is purely about the wobble.
    const { events } = run([
      { t: '16:38:00', ign: true, kph: 0 },
      { t: '16:43:00', ign: true, kph: 0 },
      { t: '16:48:00', ign: true, kph: 0 },
      { t: '16:52:00', ign: true, kph: 5 }, // 14 min observed up to here
      { t: '16:53:00', ign: true, kph: 0 }, // this minute is NOT credited
      { t: '16:58:00', ign: true, kph: 0 },
      { t: '17:03:00', ign: true, kph: 0 }, // +10 min
      { t: '17:03:30', ign: false, kph: 0 }, // +30 s
    ]);
    const end = events.find((e) => e.type === 'idling_end');
    expect(end?.minutes).toBeCloseTo(24.5, 1);
  });

  it('ends the stretch when the vehicle really drives away', () => {
    const { state, events } = run([
      { t: '08:00:00', ign: true, kph: 0 },
      { t: '08:10:00', ign: true, kph: 0 },
      { t: '08:11:00', ign: true, kph: 45 }, // unambiguously driving
    ]);
    expect(state).toBeNull();
    expect(events.filter((e) => e.type === 'idling_end')).toHaveLength(1);
  });

  it('ends the stretch when slow movement is sustained', () => {
    const { state, events } = run([
      { t: '08:00:00', ign: true, kph: 0 },
      { t: '08:10:00', ign: true, kph: 0 },
      { t: '08:10:30', ign: true, kph: 4 },
      { t: '08:11:00', ign: true, kph: 5 },
      { t: '08:12:00', ign: true, kph: 4 }, // 90s of movement: a real crawl
    ]);
    expect(state).toBeNull();
    expect(events.filter((e) => e.type === 'idling_end')).toHaveLength(1);
  });

  it('ignition off ends the stretch immediately, wobble or not', () => {
    const { state } = run([
      { t: '08:00:00', ign: true, kph: 0 },
      { t: '08:10:00', ign: true, kph: 0 },
      { t: '08:10:30', ign: false, kph: 3 },
    ]);
    expect(state).toBeNull();
  });
});
