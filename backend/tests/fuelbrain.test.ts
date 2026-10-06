import { describe, it, expect } from '@jest/globals'
import {
  matchDriver,
  shapeEfficiency,
  vehicleState,
} from '../src/features/fuelbrain/fuelbrain.service'
import { lagosMonth, TOKENS_PER_CREDIT, UNREPORTED_CALL_TOKENS } from '../src/features/fuelbrain/fuelbrain-usage.service'
import { parseChartSpec } from '../../frontend/src/lib/fuelbrain-chart-spec'

const NOW = Date.parse('2026-10-06T10:00:00Z')
const tracker = { imei: '862129084847783', tracker_last_seen: '2026-10-06 09:40' }

// FuelBrain told a manager his parked RAV4 had a GPS fault. These pin the rule
// that tells parked from broken.
describe('vehicleState', () => {
  it('calls ignition off with the GPS asleep parked, not a fault', () => {
    expect(vehicleState({ ...tracker, ignition: 0, gnss_status: 3, gps_valid: false }, NOW)).toMatch(/^parked/)
  })

  it('reports a moving car with a fix as driving', () => {
    expect(vehicleState({ ...tracker, ignition: 1, gnss_status: 1, gps_valid: true }, NOW)).toMatch(/^driving/)
  })

  it('only suspects the GPS when the engine is on and there is no fix', () => {
    expect(vehicleState({ ...tracker, ignition: 1, gnss_status: 2, gps_valid: false }, NOW)).toMatch(/no GPS fix/)
  })

  it('calls a tracker silent for over three hours offline, whatever its last frame said', () => {
    const stale = { imei: tracker.imei, tracker_last_seen: '2026-10-06 06:30', ignition: 0, gnss_status: 3 }
    expect(vehicleState(stale, NOW)).toMatch(/^tracker offline/)
  })

  it('treats a tracker that has never reported as offline', () => {
    expect(vehicleState({ imei: tracker.imei, tracker_last_seen: null }, NOW)).toMatch(/^tracker offline/)
  })

  it('says when no tracker is fitted', () => {
    expect(vehicleState({ imei: null }, NOW)).toBe('no tracker fitted')
  })

  it('does not call ignition-off parked unless the GPS is actually asleep', () => {
    expect(vehicleState({ ...tracker, ignition: 0, gnss_status: 1, gps_valid: true }, NOW)).toBe('ignition off')
  })
})

describe('matchDriver', () => {
  const fleet = [
    { id: 'd1', name: 'Benneth Uzochukwu' },
    { id: 'd2', name: 'Bola Adeyemi' },
    { id: 'd3', name: 'Ade' },
    { id: 'd4', name: 'Adebayo Ola' },
  ]

  it('matches a unique partial name', () => {
    expect(matchDriver(fleet, 'benneth')).toEqual({ kind: 'one', driver: fleet[0] })
  })

  it('prefers an exact name over partial matches', () => {
    expect(matchDriver(fleet, 'Ade')).toEqual({ kind: 'one', driver: fleet[2] })
  })

  it('matches by id', () => {
    expect(matchDriver(fleet, 'd2')).toEqual({ kind: 'one', driver: fleet[1] })
  })

  it('refuses to guess between two drivers', () => {
    expect(matchDriver(fleet, 'b')).toEqual({
      kind: 'ambiguous',
      names: ['Benneth Uzochukwu', 'Bola Adeyemi', 'Adebayo Ola'],
    })
  })

  it('finds nobody for an unknown or blank name', () => {
    expect(matchDriver(fleet, 'Chidi')).toEqual({ kind: 'none' })
    expect(matchDriver(fleet, '   ')).toEqual({ kind: 'none' })
  })
})

// FuelBrain quoted a period's litres per km (18.5) as the car's rated
// consumption (10.23). The shaped payload names the two so they cannot be confused.
describe('shapeEfficiency', () => {
  const raw = JSON.stringify({
    summary: { total_distance_km: 459 },
    vehicles: [
      {
        license_plate: 'LAG-001-FS',
        driver_name: 'Benneth Uzochukwu',
        model: 'RAV4',
        distance_km: 459,
        fuel_used_liters: 84.9,
        efficiency_l_100km: 18.5,
        expected_efficiency_l_100km: 10.23,
        efficiency_km_l: 5.4,
        expected_efficiency_km_l: 9.78,
        idle_hours: 6.1,
        idle_fuel_liters: 5.2,
        harsh_event_count: 3,
        fuel_cost_ngn: 118611,
        expected_cost_ngn: 65000,
        total_loss_ngn: 0,
        status: 'verified',
        receipt_fraud_loss_ngn: 0,
      },
    ],
  })

  it('labels the rate on file and the period figure unmistakably', () => {
    const v = JSON.parse(shapeEfficiency(raw)).vehicles[0]
    expect(v.rated_l_per_100km).toBe(10.23)
    expect(v.period_effective_l_per_100km_incl_idle_and_corrections).toBe(18.5)
    expect(v).not.toHaveProperty('efficiency_l_100km')
    expect(v).not.toHaveProperty('expected_efficiency_l_100km')
  })

  it('drops the dashboard-only fields the model does not need', () => {
    const v = JSON.parse(shapeEfficiency(raw)).vehicles[0]
    expect(v).not.toHaveProperty('efficiency_km_l')
    expect(v).not.toHaveProperty('receipt_fraud_loss_ngn')
  })

  it('passes errors and unexpected bodies through untouched', () => {
    expect(shapeEfficiency('Request failed (500): boom')).toBe('Request failed (500): boom')
    expect(shapeEfficiency('{"error":"x"}')).toBe('{"error":"x"}')
  })
})

describe('FuelBrain allowance', () => {
  it('buckets usage by the Lagos calendar month, not UTC', () => {
    // 23:30 UTC on 31 Oct is already 00:30 on 1 Nov in Lagos.
    expect(lagosMonth(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11')
    expect(lagosMonth(new Date('2026-10-31T22:30:00Z'))).toBe('2026-10')
  })

  it('charges a stopped call roughly what its prompt cost', () => {
    expect(UNREPORTED_CALL_TOKENS / TOKENS_PER_CREDIT).toBe(3)
  })
})

describe('parseChartSpec', () => {
  const ok = { type: 'line', title: 't', unit: 'km', x: ['Mon', 'Tue'], series: [{ name: 'A', values: [1, null] }] }

  it('accepts a well-formed spec', () => {
    const r = parseChartSpec(JSON.stringify(ok))
    expect('spec' in r && r.spec.series[0].values).toEqual([1, null])
  })

  it.each([
    ['not JSON', '{nope', /not valid JSON/],
    ['unknown type', JSON.stringify({ ...ok, type: 'pie' }), /Unknown chart type/],
    ['no labels', JSON.stringify({ ...ok, x: [] }), /x labels/],
    ['too many labels', JSON.stringify({ ...ok, x: Array.from({ length: 32 }, (_, i) => String(i)) }), /x labels/],
    ['too many series', JSON.stringify({ ...ok, series: Array.from({ length: 7 }, (_, i) => ({ name: `S${i}`, values: [1, 2] })) }), /series/],
    ['length mismatch', JSON.stringify({ ...ok, series: [{ name: 'A', values: [1] }] }), /has 1 values for 2 labels/],
    ['non-numeric value', JSON.stringify({ ...ok, series: [{ name: 'A', values: [1, '2'] }] }), /not a number/],
    ['infinite value', '{"type":"bar","x":["a"],"series":[{"name":"A","values":[1e999]}]}', /not a number/],
  ])('rejects %s', (_label, source, reason) => {
    const r = parseChartSpec(source)
    expect('error' in r && r.error).toMatch(reason)
  })
})
