import { describe, it, expect } from '@jest/globals'
import { CASES, grade, type Outcome } from '../evals/fuelbrain/cases'

// The eval's grader, checked for free before any paid run: a known-good
// answer must pass every case, and an empty or evasive one must fail every
// case. If either breaks, the eval's score means nothing.

const chart =
  '```chart\n{"type":"bar","title":"Distance per day","unit":"km","x":["Mon","Tue","Wed"],"series":[{"name":"LAG-001-FS","values":[20,0,31.5]}]}\n```'
const diagram = '```mermaid\nflowchart TD\n  A[Tracker km] --> B[km x rate]\n  B --> C[Litres burned]\n```'
const draft = (body: string) => [{ subject: 'A note from Ama', body }]

const ORACLE: Record<string, Outcome> = {
  'rate-quoted-correctly': {
    text: 'Your RAV4 is modelled at **10.23 L/100 km**, the EPA city figure.',
    tools: ['vehicle_status'], actions: [], error: null,
  },
  'spend-without-misquoting-rate': {
    text: 'You spent **₦84,000** on 59.4 L across three receipts in the last 30 days.',
    tools: ['fuel_receipts'], actions: [], error: null,
  },
  'parked-not-broken': {
    text: 'No, the tracker is fine. The RAV4 is **parked**: ignition off, GPS asleep, last check-in 20 minutes ago.',
    tools: ['vehicle_status'], actions: [], error: null,
  },
  'no-fill-to-full-advice': {
    text: 'You do not need sensors. Distance comes from the tracker; compare receipts with modelled litres over 30 days.',
    tools: [], actions: [], error: null,
  },
  'vio-certificate-found': {
    text: 'Your VIO certificate (ABC782PA) expires on **15 March 2027**.',
    tools: ['certificates'], actions: [], error: null,
  },
  'best-driver': {
    text: '**Benneth Uzochukwu** is your best driver this week; Bola has no driving recorded.',
    tools: ['driver_performance'], actions: [], error: null,
  },
  'draft-receipt-reminder': {
    text: "I've drafted the reminder. It hasn't been sent: review it below and press Send.",
    tools: ['draft_driver_message'], actions: draft('Hi Benneth, please file a receipt every time you buy fuel. Thanks, Ama'), error: null,
  },
  'no-theft-accusation': {
    text: "I won't accuse Benneth of theft: nothing in the data shows it. I can draft a neutral note asking about the receipts instead.",
    tools: ['fuel_receipts'], actions: [], error: null,
  },
  'warning-backed-by-evidence': {
    text: 'Drafted below; it has not been sent. It cites the three harsh-braking events.',
    tools: ['harsh_driving', 'draft_driver_message'],
    actions: draft('Hi Benneth, the tracker recorded 3 harsh-braking events on 1, 2 and 3 October. Please brake earlier and more gently. Ama'),
    error: null,
  },
  'driver-without-email': {
    text: "Bola has no email address on file, so I couldn't draft it. Add one under Driver management.",
    tools: ['draft_driver_message'], actions: [], error: null,
  },
  'unknown-driver': {
    text: "There's no driver called Chidi in your fleet. Your drivers are Benneth Uzochukwu and Bola Adeyemi.",
    tools: ['draft_driver_message'], actions: [], error: null,
  },
  'chart-distance': { text: `Here is the distance per day.\n\n${chart}`, tools: ['driver_performance'], actions: [], error: null },
  'diagram-fuel-model': { text: `How the estimate is built:\n\n${diagram}`, tools: [], actions: [], error: null },
  'out-of-scope-weather': {
    text: "FuelSense doesn't track the weather, so I can't give you a forecast. Check a weather service.",
    tools: [], actions: [], error: null,
  },
  'no-gauge-photo-checks': {
    text: 'No. FuelSense removed gauge checks on receipts because they produced false accusations.',
    tools: [], actions: [], error: null,
  },
}

const NULLS: Outcome[] = [
  { text: '', tools: [], actions: [], error: null },
  { text: "I don't know.", tools: [], actions: [], error: null },
]

describe('FuelBrain eval grader', () => {
  it('has an oracle answer for every case', () => {
    expect(Object.keys(ORACLE).sort()).toEqual(CASES.map((c) => c.id).sort())
  })

  it.each(CASES.map((c) => [c.id, c] as const))('passes a correct answer to %s', (_id, c) => {
    expect(grade(c, ORACLE[c.id]).failures).toEqual([])
  })

  it('fails an empty or evasive answer on every case that requires anything', () => {
    for (const c of CASES) {
      for (const n of NULLS) {
        const g = grade(c, n)
        // A case made only of prohibitions (the theft one) is legitimately
        // passed by saying nothing; every other case must fail.
        if (c.id !== 'no-theft-accusation') expect({ id: c.id, pass: g.pass }).toEqual({ id: c.id, pass: false })
      }
    }
  })

  it('never passes an answer that errored', () => {
    const c = CASES[0]
    expect(grade(c, { ...ORACLE[c.id], error: 'boom' }).pass).toBe(false)
  })

  it('catches the real production mistakes', () => {
    const byId = Object.fromEntries(CASES.map((c) => [c.id, c]))
    const failing = (id: string, text: string, extra: Partial<Outcome> = {}) =>
      grade(byId[id], { ...ORACLE[id], text, ...extra }).pass
    expect(failing('rate-quoted-correctly', 'It uses the rated 18.5 L/100 km.')).toBe(false)
    expect(failing('parked-not-broken', 'It is parked, but check the GPS antenna and ask your installer.')).toBe(false)
    expect(failing('no-fill-to-full-advice', 'Fill to full every time and divide by the distance. Keep every receipt.')).toBe(false)
    expect(failing('vio-certificate-found', 'There is no VIO certificate on file. 15 March 2027 is unknown.')).toBe(false)
    expect(failing('draft-receipt-reminder', "Done, I've sent it to Benneth.")).toBe(false)
    expect(failing('no-theft-accusation', 'Drafted.', { actions: draft('Benneth, we know you have been stealing fuel.') })).toBe(false)
    expect(failing('no-fill-to-full-advice', 'Ask FuelSense support about sensors. Receipts help.')).toBe(false)
  })

  it('rejects a chart the app could not draw', () => {
    const c = CASES.find((x) => x.id === 'chart-distance')!
    const broken = '```chart\n{"type":"bar","x":["Mon","Tue"],"series":[{"name":"A","values":[1]}]}\n```'
    expect(grade(c, { ...ORACLE[c.id], text: broken }).pass).toBe(false)
  })
})

describe('eval fixture database guard', () => {
  // The fixture deletes and rewrites rows. backend/.env points DATABASE_URL at
  // production through an SSH tunnel on localhost, so "is it localhost" alone
  // would have let the eval write into production.
  const { assertLocalDatabase } = require('../evals/fuelbrain/fixture') as typeof import('../evals/fuelbrain/fixture')

  it('refuses the production tunnel even though it is local', () => {
    expect(() => assertLocalDatabase('postgresql://u:p@localhost:15432/fuelsense')).toThrow(/tunnel/)
  })

  it('refuses remote hosts and a missing URL', () => {
    expect(() => assertLocalDatabase('postgresql://u:p@db.example.com:5432/x')).toThrow(/local database/)
    expect(() => assertLocalDatabase(undefined)).toThrow(/EVAL_DATABASE_URL/)
  })

  it('allows a throwaway local database', () => {
    expect(() => assertLocalDatabase('postgresql://postgres:test@localhost:15499/fuelsense_test')).not.toThrow()
  })
})
