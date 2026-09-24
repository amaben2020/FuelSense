import { describe, it, expect } from '@jest/globals'
import { stepIdle, type IdleReading, type IdleState, type IdleEmission } from '../src/features/telemetry/idle-detector.service'

const at = (iso: string): Date => new Date(`2026-08-04T${iso}Z`)

const running = (iso: string, speedKph = 0): IdleReading => ({
  ignitionOn: true,
  speedKph,
  recordedAt: at(iso),
})

const off = (iso: string): IdleReading => ({
  ignitionOn: false,
  speedKph: 0,
  recordedAt: at(iso),
})

/** Runs a sequence through the machine and returns every event it emitted. */
const play = (readings: IdleReading[]): IdleEmission[] => {
  let state: IdleState | null = null
  const emitted: IdleEmission[] = []
  for (const reading of readings) {
    const result = stepIdle(state, reading)
    state = result.state
    emitted.push(...result.emissions)
  }
  return emitted
}

describe('stepIdle', () => {
  it('reports an idle stretch that the device only bookended with two frames', () => {
    // Engine on at 11:00, off at 11:20, nothing in between. The stretch is
    // reported — but only for the ten minutes the cap allows an unwitnessed
    // hop to be worth. All we know is that the engine was running at 11:00
    // and off at 11:20; it may have been switched off at 11:01.
    const emitted = play([running('11:00:00'), off('11:20:00')])

    expect(emitted.map((e) => e.eventType)).toEqual(['idling_start', 'idling_end'])
    expect(emitted[0].occurredAt).toEqual(at('11:00:00'))
    expect(emitted[1].occurredAt).toEqual(at('11:10:00'))
    expect(emitted[1].minutes).toBe(10)
  })

  // 23 September 2026: a tracker slept from 17:40 to 10:15 the next morning —
  // its last frame before the silence reading ignition OFF — and the next
  // frame closed the stretch at "Idled 16h 35m · ≈14.93 L burned", beside a
  // named driver, against a true figure of about twelve minutes. A duration
  // the frames cannot support must never reach a manager's screen.
  it('never bills a silent tracker as a running engine', () => {
    const nextDay = (iso: string): IdleReading => ({
      ignitionOn: true,
      speedKph: 0,
      recordedAt: new Date(`2026-08-05T${iso}Z`),
    })

    const emitted = play([
      running('11:00:00'),
      running('11:04:00'),
      // 16h 35m of nothing.
      nextDay('03:39:00'),
      { ignitionOn: false, speedKph: 0, recordedAt: new Date('2026-08-05T03:45:00Z') },
    ])

    const ends = emitted.filter((e) => e.eventType === 'idling_end')
    expect(ends).toHaveLength(2)
    // Only what was watched: four minutes before the tracker went quiet, and
    // six after it came back. Never the silence between them.
    expect(ends[0].minutes).toBe(4)
    expect(ends[1].minutes).toBe(6)
  })

  it('counts a normally-reporting idle in full', () => {
    // A frame every minute for twelve minutes: every hop is inside the cap,
    // so the whole stretch is real and is reported as such.
    const readings = Array.from({ length: 13 }, (_, i) =>
      running(`11:${String(i).padStart(2, '0')}:00`)
    )
    const emitted = play([...readings, off('11:12:30')])

    const end = emitted.find((e) => e.eventType === 'idling_end')!
    expect(end.minutes).toBe(12.5)
  })

  it('backdates the start to when the engine actually settled, not to the frame that crossed the threshold', () => {
    const emitted = play([running('11:00:00'), running('11:05:00')])

    expect(emitted).toHaveLength(1)
    expect(emitted[0].eventType).toBe('idling_start')
    expect(emitted[0].occurredAt).toEqual(at('11:00:00'))
  })

  it('emits one start per stretch, not one per frame', () => {
    const emitted = play([
      running('11:00:00'),
      running('11:05:00'),
      running('11:06:00'),
      running('11:07:00'),
    ])

    expect(emitted.filter((e) => e.eventType === 'idling_start')).toHaveLength(1)
  })

  it('ignores a pause shorter than the threshold', () => {
    // Key cycled at a gate — the kind of thing that would bury real idling.
    expect(play([running('11:00:00'), off('11:01:00')])).toEqual([])
  })

  it('closes the stretch when the vehicle drives off, timed to the first moving frame', () => {
    const emitted = play([running('11:00:00'), running('11:04:00'), running('11:06:00', 34)])

    expect(emitted.map((e) => e.eventType)).toEqual(['idling_start', 'idling_end'])
    expect(emitted[1].occurredAt).toEqual(at('11:06:00'))
    expect(emitted[1].minutes).toBe(6)
  })

  it('treats GNSS noise below 2 km/h as stationary', () => {
    const emitted = play([running('11:00:00', 1), running('11:03:00', 1)])

    expect(emitted.map((e) => e.eventType)).toEqual(['idling_start'])
  })

  it('does not idle a parked vehicle with the engine off', () => {
    expect(play([off('09:12:14'), off('10:12:14'), off('11:12:14')])).toEqual([])
  })

  it('starts a fresh stretch after the engine is restarted', () => {
    const emitted = play([
      running('11:00:00'),
      off('11:04:00'),
      running('11:30:00'),
      off('11:36:00'),
    ])

    expect(emitted.map((e) => e.eventType)).toEqual([
      'idling_start',
      'idling_end',
      'idling_start',
      'idling_end',
    ])
    expect(emitted[1].minutes).toBe(4)
    expect(emitted[3].minutes).toBe(6)
  })
})
