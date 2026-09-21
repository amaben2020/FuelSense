import { describe, it, expect } from '@jest/globals'
import {
  VEHICLE_CATALOGUE,
  catalogueSpec,
  resolveVehicleSpec,
  tankLitersFor,
  yearInRange,
} from '../src/features/vehicles/vehicle-catalogue.service'

const fallback = { type: 'sedan' as const, consumptionL100km: 10, idleBurnLph: 1 }

// The figures a manager will check against the vehicle's own handbook. A
// wrong tank size breaks fill-to-full calibration on the very first fill.
describe('tank size by year', () => {
  it.each([
    ['Toyota', 'RAV4', 2013, 60],
    ['Toyota', 'RAV4', 2018, 60],
    ['Toyota', 'RAV4', 2019, 55],
    ['Toyota', 'Corolla', 2008, 50],
    ['Toyota', 'Corolla', 2015, 50],
    ['Toyota', 'Corolla', 2024, 50],
    ['Toyota', 'Camry', 2009, 70],
    ['Toyota', 'Camry', 2014, 64],
    ['Toyota', 'Camry', 2020, 60],
    ['Toyota', 'Land Cruiser', 2016, 138],
    ['Toyota', 'Prado', 2015, 150],
    ['Toyota', 'Highlander', 2012, 73],
    ['Toyota', 'Hilux', 2019, 80],
  ])('%s %s %i → %i L', (make, model, year, liters) => {
    expect(resolveVehicleSpec(make, model, year, fallback).tankLiters).toBe(liters)
  })

  it('is case-insensitive on make and model', () => {
    expect(resolveVehicleSpec('toyota', 'rav4', 2013, fallback).tankLiters).toBe(60)
  })

  it('falls back to the model figure when no year is given', () => {
    const spec = catalogueSpec('Toyota', 'RAV4')!
    expect(tankLitersFor(spec, null).tankLiters).toBe(spec.tankLiters)
  })

  it('offers no tank size for a model it does not know', () => {
    const r = resolveVehicleSpec('Peugeot', '504', 1990, fallback)
    expect(r.matched).toBe(false)
    expect(r.tankLiters).toBe(0)
  })
})

describe('catalogue integrity', () => {
  const specs = VEHICLE_CATALOGUE.flatMap((m) => m.models.map((s) => ({ make: m.make, ...s })))

  it('every generation range sits inside the model range and none overlap', () => {
    for (const s of specs) {
      const gens = [...(s.tankByYear ?? [])].sort((a, b) => a.years[0] - b.years[0])
      for (let i = 0; i < gens.length; i++) {
        expect(gens[i].years[0]).toBeGreaterThanOrEqual(s.years[0])
        expect(gens[i].years[1]).toBeLessThanOrEqual(s.years[1])
        expect(gens[i].years[0]).toBeLessThanOrEqual(gens[i].years[1])
        if (i > 0) expect(gens[i].years[0]).toBeGreaterThan(gens[i - 1].years[1])
      }
    }
  })

  it('every tank size is a plausible number of litres', () => {
    for (const s of specs) {
      expect(s.tankLiters).toBeGreaterThanOrEqual(30)
      expect(s.tankLiters).toBeLessThanOrEqual(400)
      for (const g of s.tankByYear ?? []) {
        expect(g.tankLiters).toBeGreaterThanOrEqual(30)
        expect(g.tankLiters).toBeLessThanOrEqual(400)
      }
    }
  })

  it('rejects a year the model was not sold in', () => {
    const rav4 = catalogueSpec('Toyota', 'RAV4')!
    expect(yearInRange(rav4, 2013)).toBe(true)
    expect(yearInRange(rav4, 1999)).toBe(false)
    expect(yearInRange(rav4, new Date().getFullYear() + 5)).toBe(false)
  })
})
