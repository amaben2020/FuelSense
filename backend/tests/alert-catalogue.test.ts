import { describe, it, expect } from '@jest/globals'
import {
  ALERT_CATALOGUE,
  DRIVER_EXPLAINABLE_ALERTS,
  DRIVER_HIDDEN_ALERTS,
  alertDefinition,
} from '../src/features/alerts/alert-catalogue.service'

describe('alert catalogue', () => {
  it('defines each type once — a second definition can never be looked up', () => {
    const types = ALERT_CATALOGUE.map((a) => a.type)
    expect(new Set(types).size).toBe(types.length)
  })

  it('documents the trip end that the notifier raises', () => {
    expect(alertDefinition('trip_end')?.label).toBe('Vehicle ended a trip')
  })

  it('never hides an alert the driver is asked to explain', () => {
    for (const t of DRIVER_EXPLAINABLE_ALERTS) expect(DRIVER_HIDDEN_ALERTS.has(t)).toBe(false)
  })

  it('only hides types that exist', () => {
    for (const t of DRIVER_HIDDEN_ALERTS) expect(alertDefinition(t)).toBeDefined()
  })
})
