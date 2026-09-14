import { describe, it, expect } from '@jest/globals'
import {
  CONSECUTIVE_LOW_FRAMES,
  EXTERNAL_POWER_MIN_MV,
  EXTERNAL_VOLTAGE_AVL_ID,
  MOVING_KPH,
  SUSTAINED_LOW_SECONDS,
  decidePowerTransition,
} from '../src/lib/power-monitor'

// On 2026-08-26 the tracker was pulled from the OBD port and nothing reported
// it. `device_offline` could not have: it fires on two hours of silence, and a
// tracker on its internal battery is not silent — it kept sending frames the
// whole time. AVL 252, the device's own unplug scenario, has never appeared in
// this fleet's history; the scenario is not enabled. AVL 66 read 0 throughout.
//
// Then on 2026-09-13 the first version of this rule — two low frames — raised
// seven "unplugged" alarms in a day for one real unplug. The sequences below
// are that day's real frames, from device_frames, with their timestamps and
// speeds, because the difference between a tamper and a loose connector lives
// in exactly those two columns.

type Frame = [clock: string, mv: number | null, kph: number]

const FRESH = { unplugged: false, lowStreak: 0, lowSince: null as number | null, movedWhileLow: false }

const at = (clock: string) => new Date(`2026-09-13T${clock}Z`)

/** Feed a sequence through the rule, collecting every transition it reports. */
const replay = (frames: Frame[], from = FRESH) => {
  let state = from
  const seen: string[] = []
  for (const [clock, mv, kph] of frames) {
    const { transition, after } = decidePowerTransition(
      { externalMv: mv, at: at(clock), speedKph: kph },
      state
    )
    state = after
    if (transition) seen.push(transition)
  }
  return { transitions: seen, state }
}

/** 13:54 — the one the manager did on purpose: 0 V for three minutes, parked. */
const REAL_UNPLUG: Frame[] = [
  ['13:53:40', 12301, 0],
  ['13:54:09', 0, 0],
  ['13:54:15', 0, 0],
  ['13:54:33', 0, 0],
  ['13:55:22', 0, 0],
  ['13:55:27', 0, 0],
  ['13:55:41', 0, 0],
  ['13:56:02', 0, 0],
  ['13:56:42', 0, 0],
  ['13:57:07', 12317, 0],
  ['13:57:34', 12322, 0],
]

/** 16:28 — 0 V for four and a half minutes at up to 88 km/h, after two sags. */
const DROPOUT_AT_SPEED: Frame[] = [
  ['16:27:06', 12206, 0],
  ['16:27:23', 5269, 6],
  ['16:27:31', 12443, 26],
  ['16:28:07', 12475, 54],
  ['16:28:14', 5362, 58],
  ['16:28:25', 0, 71],
  ['16:28:35', 0, 86],
  ['16:28:43', 0, 88],
  ['16:29:07', 0, 45],
  ['16:29:28', 0, 53],
  ['16:30:14', 0, 19],
  ['16:31:07', 0, 21],
  ['16:32:36', 0, 25],
  ['16:32:52', 8944, 22],
  ['16:32:59', 12436, 28],
]

/** 12:21 — a two-second dip: one frame at 0.3 V, the next at 8.8 V, then normal. */
const BLIP: Frame[] = [
  ['12:21:11', 13661, 33],
  ['12:21:23', 13150, 29],
  ['12:21:28', 309, 17],
  ['12:21:30', 8825, 10],
  ['12:21:39', 12806, 16],
  ['12:21:58', 13225, 23],
]

/** 13:33 — twenty-one seconds of 0 V rolling through a junction. */
const SHORT_DROPOUT: Frame[] = [
  ['13:33:00', 12400, 9],
  ['13:33:14', 0, 6],
  ['13:33:22', 0, 4],
  ['13:33:30', 0, 8],
  ['13:33:35', 12313, 9],
]

describe('tracker power loss, from external voltage', () => {
  it('reads the element the device actually sends', () => {
    // 252 is the scenario event; 66 is the level. Only one of them arrives.
    expect(EXTERNAL_VOLTAGE_AVL_ID).toBe(66)
  })

  it('reports the real unplug as a tamper, and its restore, once each', () => {
    const { transitions } = replay(REAL_UNPLUG)
    expect(transitions).toEqual(['unplugged', 'restored'])
  })

  it('calls a loss of power at speed a dropout, not a tamper', () => {
    // Nobody pulls the plug at 88 km/h. This is the connector.
    const { transitions } = replay(DROPOUT_AT_SPEED)
    expect(transitions).toEqual(['dropout', 'restored'])
  })

  it('ignores a two-second dip entirely', () => {
    expect(replay(BLIP).transitions).toEqual([])
  })

  it('ignores a dropout shorter than the sustained window', () => {
    expect(replay(SHORT_DROPOUT).transitions).toEqual([])
    expect(SUSTAINED_LOW_SECONDS).toBeGreaterThanOrEqual(60)
  })

  it('does not call a crawl through traffic "moving"', () => {
    // A vehicle inching forward at walking pace while someone works on the
    // plug is still a stationary unplug.
    const crawl: Frame[] = REAL_UNPLUG.map(([c, mv]) => [c, mv, 3])
    expect(replay(crawl).transitions).toEqual(['unplugged', 'restored'])
    expect(MOVING_KPH).toBeGreaterThanOrEqual(3)
  })

  it('stays quiet while power is normal', () => {
    const powered: Frame[] = [
      ['10:00:00', 12490, 0],
      ['10:00:10', 12492, 12],
      ['10:00:20', 12577, 30],
    ]
    expect(replay(powered).transitions).toEqual([])
  })

  it('does not re-report an unplug that is already open', () => {
    // The 26 Aug episode ran to 75 frames over 41 minutes. One alert.
    const long: Frame[] = [['14:56:31', 12500, 0]]
    for (let i = 0; i < 75; i += 1) {
      const t = new Date(at('14:56:31').getTime() + (i + 1) * 33_000)
      long.push([t.toISOString().slice(11, 19), 0, 0])
    }
    expect(replay(long).transitions).toEqual(['unplugged'])
  })

  it('needs more than one low frame, whatever the clock says', () => {
    const { transitions } = replay([
      ['10:00:00', 12000, 0],
      ['10:05:00', 0, 0],
      ['10:05:01', 12000, 0],
    ])
    expect(transitions).toEqual([])
    expect(CONSECUTIVE_LOW_FRAMES).toBeGreaterThan(1)
  })

  it('ignores frames with no AVL 66 rather than inferring a disconnect', () => {
    // A device with the element disabled sends nothing here. Absence of a
    // reading is not a reading of zero.
    const { transitions, state } = replay([
      ['10:00:00', null, 0],
      ['10:01:00', null, 0],
      ['10:02:00', null, 0],
    ])
    expect(transitions).toEqual([])
    expect(state.unplugged).toBe(false)
  })

  it('does not cry tamper at a weak battery', () => {
    // A flat-but-connected battery sits near 9–11V. Only a genuine loss of
    // supply drops to single digits of a volt.
    const weak: Frame[] = [
      ['07:00:00', 12000, 0],
      ['07:01:00', 9500, 0],
      ['07:02:00', 9200, 0],
      ['07:03:00', 10100, 0],
      ['07:04:00', 11000, 0],
    ]
    expect(replay(weak).transitions).toEqual([])
    expect(EXTERNAL_POWER_MIN_MV).toBeLessThan(9000)
  })

  it('picks up an episode already in progress after a restart', () => {
    // State is seeded from the open alert, so a process restart mid-disconnect
    // must not re-raise — but must still report the restore.
    const seeded = { ...FRESH, unplugged: true }
    const { transitions } = replay(
      [
        ['15:30:00', 0, 0],
        ['15:31:00', 0, 0],
        ['15:37:22', 14099, 0],
      ],
      seeded
    )
    expect(transitions).toEqual(['restored'])
  })

  it('reports a second loss after power was restored', () => {
    const { transitions } = replay([...REAL_UNPLUG, ...DROPOUT_AT_SPEED])
    expect(transitions).toEqual(['unplugged', 'restored', 'dropout', 'restored'])
  })
})
