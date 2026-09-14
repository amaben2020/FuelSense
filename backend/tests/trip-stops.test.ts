import { describe, it, expect } from '@jest/globals';
import { segmentTrips, TelemetryTripPoint } from '../src/lib/trip-segmentation';

const T0 = Date.parse('2026-09-12T10:00:00Z');

/** A point `sec` seconds after T0. Moving points carry a speed; parked ones don't. */
function pt(sec: number, lat: number, lng: number, speedKph: number, ignitionOn = true): TelemetryTripPoint {
  return { lat, lng, speedKph, ignitionOn, recordedAt: new Date(T0 + sec * 1000) };
}

/** Roughly 1 km of driving east at ~36 km/h, one fix every 10 s. */
function drive(fromSec: number, fromLng: number, seconds: number): TelemetryTripPoint[] {
  const out: TelemetryTripPoint[] = [];
  for (let s = 0; s <= seconds; s += 10) {
    out.push(pt(fromSec + s, 9.017, fromLng + (s / seconds) * 0.009, 36));
  }
  return out;
}

describe('a halt at the end of the trip', () => {
  // The Worldgate case: drove in, parked with the engine on, engine off, a
  // 23-minute silence between heartbeats, two more heartbeats, then nothing.
  const points: TelemetryTripPoint[] = [
    ...drive(0, 7.62, 300),
    pt(310, 9.017, 7.629, 1),
    pt(320, 9.017, 7.629, 0),
    pt(380, 9.017, 7.629, 0),
    pt(381, 9.017, 7.629, 0, false),
    pt(430, 9.017, 7.629, 0),
    pt(435, 9.017, 7.629, 0),
    pt(435 + 23 * 60, 9.01701, 7.62901, 0, false),
    pt(435 + 26 * 60, 9.01701, 7.62901, 0, false),
    pt(435 + 26 * 60 + 2, 9.01701, 7.62901, 0, false),
  ];
  const [trip] = segmentTrips(points, T0 + 3 * 3600 * 1000);

  it('is reported once, not as a stop with a duplicate inside it', () => {
    const halts = trip.stops.filter((s) => s.kind === 'stop' || s.kind === 'pause');
    expect(halts).toHaveLength(0);
  });

  it('becomes the destination, carrying the whole parked time', () => {
    const end = trip.stops[trip.stops.length - 1];
    expect(end.kind).toBe('destination');
    // From the first stationary fix (310 s) to "now" — the vehicle has not
    // moved since, so the parked time runs on and is flagged as still going.
    const expectedMinutes = Math.round((3 * 3600 - 310) / 60);
    expect(end.duration_minutes).toBe(expectedMinutes);
    expect(end.ongoing).toBe(true);
  });
});

describe('a long heartbeat gap inside a stop the run already covers', () => {
  // Mid-trip visit: park, go quiet for 12 minutes, one more parked fix, drive on.
  const points: TelemetryTripPoint[] = [
    ...drive(0, 7.62, 300),
    pt(310, 9.017, 7.629, 0),
    pt(320, 9.017, 7.629, 0),
    pt(320 + 12 * 60, 9.01701, 7.62901, 0),
    pt(330 + 12 * 60, 9.01701, 7.62901, 0),
    ...drive(340 + 12 * 60, 7.629, 300),
  ];
  const [trip] = segmentTrips(points, T0 + 3 * 3600 * 1000);

  it('yields a single stop, not one from each detection pass', () => {
    const stops = trip.stops.filter((s) => s.kind === 'stop');
    expect(stops).toHaveLength(1);
    expect(stops[0].duration_minutes).toBe(Math.round((330 + 12 * 60 - 310) / 60));
  });
});

describe('a trip that ends while moving', () => {
  const points = drive(0, 7.62, 300);
  const [trip] = segmentTrips(points, T0 + 3 * 3600 * 1000);

  it('has a destination whose parked time runs from the last fix to now', () => {
    const end = trip.stops[trip.stops.length - 1];
    expect(end.kind).toBe('destination');
    // Nothing moved after the last fix, so the vehicle is parked there still.
    expect(end.ongoing).toBe(true);
    expect(end.duration_minutes).toBeGreaterThan(0);
    expect(end.departed_at).toBe(new Date(T0 + 3 * 3600 * 1000).toISOString());
  });
});
