import { describe, it, expect } from '@jest/globals';
import { blendedTankCost } from '../src/features/fuel/virtual-tank.service';

describe('blendedTankCost', () => {
  it('weights by what is actually in the tank', () => {
    // 10 L at 1,275 + 40 L at 1,440 = 50 L. (12750 + 57600) / 50 = 1,407.
    expect(blendedTankCost(10, 1275, 40, 1440)).toBe(1407);
  });

  it('prices a never-priced tank at the fill that arrived', () => {
    expect(blendedTankCost(10, null, 40, 1440)).toBe(1440);
  });

  it('leaves the average alone when the fill carries no price', () => {
    expect(blendedTankCost(10, 1275, 40, null)).toBe(1275);
    expect(blendedTankCost(10, 1275, 40, 0)).toBe(1275);
  });

  it('is unmoved by a fill of nothing', () => {
    expect(blendedTankCost(30, 1300, 0, 1440)).toBe(1300);
  });

  it('takes the fill price outright into an empty tank', () => {
    expect(blendedTankCost(0, null, 45, 1440)).toBe(1440);
  });

  it('moves toward the newer price, never past it', () => {
    const blended = blendedTankCost(25, 1275, 25, 1440);
    expect(blended).toBeGreaterThan(1275);
    expect(blended).toBeLessThan(1440);
    // Equal volumes, so the midpoint.
    expect(blended).toBe(1357.5);
  });

  it('a cheap fill into an expensive tank pulls the cost down', () => {
    expect(blendedTankCost(40, 1440, 10, 1275)).toBe(1407);
  });
});
