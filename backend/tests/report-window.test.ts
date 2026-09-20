import { describe, it, expect } from '@jest/globals'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import {
  parseReportWindow,
  telemetryDeltasCte,
  windowEnd,
  windowKey,
  windowStart,
} from '../src/lib/telemetry-deltas-sql'

const dialect = new PgDialect()
const render = (fragment: SQL) => dialect.sqlToQuery(fragment)

// The snapshot's calendar sends `from`/`to`; every older caller still sends
// `days`. Both must land on the same bounded window, and a picked range must
// never reach past the 90-day cap the summary queries were sized for.
describe('parseReportWindow', () => {
  it('reads days back from today when no range is given', () => {
    expect(parseReportWindow({ days: '30' })).toEqual({ days: 30, from: null, to: null })
    expect(parseReportWindow({})).toEqual({ days: 7, from: null, to: null })
    expect(parseReportWindow({ days: '400' }).days).toBe(90)
  })

  it('reads an inclusive from/to range and counts its days', () => {
    const w = parseReportWindow({ from: '2026-09-01', to: '2026-09-07' })
    expect(w).toEqual({ days: 7, from: '2026-09-01', to: '2026-09-07' })
    expect(windowKey(w)).toBe('2026-09-01_2026-09-07')
  })

  it('collapses a range that ends before it starts to a single day', () => {
    const w = parseReportWindow({ from: '2026-09-07', to: '2026-09-01' })
    expect(w).toEqual({ days: 1, from: '2026-09-07', to: '2026-09-07' })
  })

  it('ignores a malformed date and falls back to days', () => {
    expect(parseReportWindow({ from: 'yesterday', days: '3' })).toEqual({ days: 3, from: null, to: null })
  })
})

describe('window bounds', () => {
  it('a days window runs from local midnight to now', () => {
    expect(render(windowStart(7)).params).toEqual(['Africa/Lagos', 7, 'Africa/Lagos'])
    expect(render(windowEnd(7)).sql).toBe('NOW()')
  })

  it('a picked range runs from its first local midnight to the midnight after its last day', () => {
    const w = parseReportWindow({ from: '2026-09-01', to: '2026-09-07' })
    expect(render(windowStart(w)).params).toEqual(['2026-09-01', 'Africa/Lagos'])
    const end = render(windowEnd(w))
    expect(end.sql).toContain('::date + 1')
    expect(end.params).toEqual(['2026-09-07', 'Africa/Lagos'])
  })

  it('the deltas CTE bounds both ends of the window', () => {
    const w = parseReportWindow({ from: '2026-09-01', to: '2026-09-07' })
    const q = render(telemetryDeltasCte({ customerId: 'c', days: w }))
    expect(q.sql).toContain('t.recorded_at >=')
    expect(q.sql).toContain('t.recorded_at <')
  })
})
