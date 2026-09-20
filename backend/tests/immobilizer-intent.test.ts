import { describe, it, expect } from '@jest/globals';
import { engageIntentError } from '../src/features/vehicles/immobilizer.service';

// Immobilizing must only ever happen because a person asked for this vehicle.
// These are the shapes a bug, a retry or a stray call would produce, and every
// one of them has to be refused before anything reaches the tracker.
describe('an engage request is refused unless it carries explicit intent', () => {
  const plate = 'ABC-756-BF';

  it.each([
    ['an empty body', undefined],
    ['no confirm flag', { licensePlate: plate }],
    ['confirm as a string', { confirm: 'true', licensePlate: plate }],
    ['confirm as 1', { confirm: 1, licensePlate: plate }],
    ['confirm false', { confirm: false, licensePlate: plate }],
  ])('refuses %s', (_label, intent) => {
    expect(engageIntentError(intent as never, plate)).toMatch(/explicit confirmation/);
  });

  it.each([
    ['no plate', { confirm: true }],
    ['a different vehicle’s plate', { confirm: true, licensePlate: 'KUJ-529-BF' }],
    ['an empty plate', { confirm: true, licensePlate: '   ' }],
    ['a plate that is not a string', { confirm: true, licensePlate: 123 }],
  ])('refuses %s', (_label, intent) => {
    expect(engageIntentError(intent as never, plate)).toMatch(/licence plate/);
  });

  it('accepts confirm: true with this vehicle’s plate, case- and space-insensitively', () => {
    expect(engageIntentError({ confirm: true, licensePlate: plate }, plate)).toBeNull();
    expect(engageIntentError({ confirm: true, licensePlate: ' abc-756-bf ' }, plate)).toBeNull();
  });
});
