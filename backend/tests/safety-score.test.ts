import { describe, it, expect } from '@jest/globals';
import { scoreForPenalty } from '../src/features/devices/device-events.routes';

// The score exists to change driving, so its contract is that a driver can
// check it: two points per harsh manoeuvre, subtracted, nothing else in the
// way. An exponential per-100 km curve ranked the bad end more finely but
// nobody — driver or manager — could say what a single event had cost.
describe('safety score', () => {
  it('is 100 when nothing was penalised', () => {
    expect(scoreForPenalty(0)).toBe(100);
    expect(scoreForPenalty(-5)).toBe(100);
  });

  it('removes exactly the points deducted', () => {
    for (const p of [1, 2, 5, 18, 40, 99]) {
      expect(scoreForPenalty(p)).toBe(100 - p);
    }
  });

  it('costs two points per harsh manoeuvre, as the screen says it does', () => {
    // Nine harsh accelerations and two harsh brakes, the reference week.
    const penalty = 9 * 2 + 2 * 2;
    expect(scoreForPenalty(penalty)).toBe(78);
    // One more harsh brake is one more two-point step, every time.
    expect(scoreForPenalty(penalty) - scoreForPenalty(penalty + 2)).toBe(2);
  });

  it('floors at zero rather than going negative', () => {
    expect(scoreForPenalty(100)).toBe(0);
    expect(scoreForPenalty(128.8)).toBe(0);
    expect(scoreForPenalty(5000)).toBe(0);
  });

  it('stays inside 0-100', () => {
    for (const p of [0, 1, 50, 128.8, 1000, 1e6]) {
      const s = scoreForPenalty(p);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('returns whole numbers — a score is not a measurement', () => {
    for (const p of [1.4, 7.5, 33.3]) {
      expect(Number.isInteger(scoreForPenalty(p))).toBe(true);
    }
  });

  it('survives a non-finite penalty rather than reporting NaN', () => {
    expect(scoreForPenalty(Number.NaN)).toBe(100);
    expect(scoreForPenalty(Number.POSITIVE_INFINITY)).toBe(100);
  });
});
