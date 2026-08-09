/**
 * Combination locks — a disc with detents, decoded under shackle tension.
 *
 * The family rides the disc-detainer machinery whole (no springs, gates read by feel, false
 * gates lying through GROOVE), so what is tested here is only what is genuinely its own: the
 * detent grid the turner snaps to, the grid the validator enforces, and the owner's decode
 * sequence — one wheel binds under tension, dialling its digit passes the bind to the next,
 * and a wheel dialled right *before* its turn seats itself the moment the bind reaches it.
 * `docs/NEXT-MECHANICS.md §1`.
 */

import { describe, expect, it } from 'vitest'
import { ALL_LOCKS } from '../../src/game/locks'
import { KIT } from '../../src/game/tools'
import {
  COMBO_DETENT,
  COMBO_DIGITS,
  DISC_TRAVEL,
  DT,
  createSimState,
  detentCentre,
  grooveDepthAt,
  makeConfig,
  measureDifficulty,
  quantizeDetent,
  step,
  validateLockDef,
  type LockDef,
  type SimState,
} from '../../src/sim'
import { PERFECT_CONFIG, holdAt, holdFor, makeLock, pick, tensionOnly } from './fixtures'

/** Chamber indices in the order this instance's seeded deltas will bind them. */
function bindingOrder(s: SimState): number[] {
  return s.chambers
    .map((c) => ({ i: c.index, d: c.delta }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.i)
}

/** Four wheels, code 2-7-4-9, one false gate each. Gates all on detent centres. */
const COMBO_FIXTURE = makeLock({
  slug: 'fixture-combo-4',
  name: 'Fixture combination 4',
  bitting: [3, 3, 3, 3],
  pins: ['standard', 'standard', 'standard', 'standard'],
  family: 'combination',
  tier: 3,
  discs: {
    trueGates: [detentCentre(2), detentCentre(7), detentCentre(4), detentCentre(9)],
    falseGates: [[detentCentre(6)], [detentCentre(1)], [detentCentre(8)], [detentCentre(3)]],
    gateWidth: 0.12,
  },
  toleranceQuality: 0.8,
  par: 240,
})

const HEAVY_TIMEOUT = 120_000

function realConfig(): ReturnType<typeof makeConfig> {
  return makeConfig({ tools: KIT, featherEnabled: true })
}

describe('the detent grid', () => {
  it('maps every command into a digit centre, ends included', () => {
    expect(quantizeDetent(0)).toBeCloseTo(detentCentre(0), 9)
    expect(quantizeDetent(COMBO_DETENT - 1e-9)).toBeCloseTo(detentCentre(0), 9)
    // The click boundary belongs to the next digit…
    expect(quantizeDetent(COMBO_DETENT)).toBeCloseTo(detentCentre(1), 9)
    // …and the top of the travel to the last one, not an invented eleventh.
    expect(quantizeDetent(DISC_TRAVEL)).toBeCloseTo(detentCentre(COMBO_DIGITS - 1), 9)
    for (let d = 0; d < COMBO_DIGITS; d += 1) {
      expect(quantizeDetent(detentCentre(d))).toBeCloseTo(detentCentre(d), 9)
    }
  })

  it('is enforced by the validator: off-grid gates and fat gates are authoring errors', () => {
    expect(() => validateLockDef(COMBO_FIXTURE)).not.toThrow()
    const { discs, ...noDiscs } = COMBO_FIXTURE
    expect(discs).toBeDefined()
    expect(() => validateLockDef(noDiscs)).toThrow(/discs/)
    const offGrid: LockDef = {
      ...COMBO_FIXTURE,
      discs: {
        trueGates: [0.8, detentCentre(7), detentCentre(4), detentCentre(9)],
        falseGates: [[], [], [], []],
        gateWidth: 0.12,
      },
    }
    expect(() => validateLockDef(offGrid)).toThrow(/detent grid/)
    const offGridFalse: LockDef = {
      ...COMBO_FIXTURE,
      discs: {
        trueGates: COMBO_FIXTURE.discs?.trueGates ?? [],
        falseGates: [[1.0], [], [], []],
        gateWidth: 0.12,
      },
    }
    expect(() => validateLockDef(offGridFalse)).toThrow(/detent grid/)
    const fatGate: LockDef = {
      ...COMBO_FIXTURE,
      discs: {
        trueGates: COMBO_FIXTURE.discs?.trueGates ?? [],
        falseGates: COMBO_FIXTURE.discs?.falseGates ?? [],
        gateWidth: 0.2,
      },
    }
    expect(() => validateLockDef(fatGate)).toThrow(/half a detent/)
  })

  it('builds every chamber as a disc, exactly like the detainer family', () => {
    const s = createSimState(COMBO_FIXTURE, 1, PERFECT_CONFIG)
    expect(s.chambers.every((c) => c.kind === 'disc')).toBe(true)
    expect(s.chambers.every((c) => c.maxLift === DISC_TRAVEL)).toBe(true)
  })
})

describe('the wheels', () => {
  it('click: a wheel parks on a digit centre, never between', () => {
    // No tension: nothing binds, nothing can set, the turner runs at the free rate — this is
    // a hand spinning a wheel on an unpulled shackle.
    const s = createSimState(COMBO_FIXTURE, 3, PERFECT_CONFIG)
    const c = s.chambers[0]
    if (!c) throw new Error('no wheel')
    holdFor(s, pick(0, 1.0, 0), 0.8) // commanded mid-detent…
    expect(c.lift).toBeCloseTo(detentCentre(3), 6) // …parks on the digit
    holdFor(s, pick(0, 2.99, 0), 0.8)
    expect(c.lift).toBeCloseTo(detentCentre(9), 6)
    holdFor(s, pick(0, 0, 0), 0.8)
    expect(c.lift).toBeCloseTo(detentCentre(0), 6)
  })

  it('shrug off hand wobble: the real kit cannot smear a wheel off its digit', () => {
    const s = createSimState(COMBO_FIXTURE, 3, realConfig())
    const c = s.chambers[0]
    if (!c) throw new Error('no wheel')
    holdFor(s, pick(0, detentCentre(5), 0), 1.2)
    // The command wobbles with the hand; the detent quantizes the wobble away.
    expect(c.lift).toBeCloseTo(detentCentre(5), 6)
  })

  it('spin free and silent without the shackle pulled: the right code alone sets nothing', () => {
    const s = createSimState(COMBO_FIXTURE, 7, PERFECT_CONFIG)
    const gates = COMBO_FIXTURE.discs?.trueGates ?? []
    for (let w = 0; w < gates.length; w += 1) {
      holdAt(s, w, gates[w] as number, 0, 1.0)
      expect(s.chambers[w]?.lift).toBeCloseTo(gates[w] as number, 6)
    }
    expect(s.chambers.every((c) => c.state !== 'SET')).toBe(true)
    expect(s.opened).toBe(false)
  })
})

describe('the decode', () => {
  it('binds one wheel under tension, and dialling its digit passes the bind on', () => {
    const s = createSimState(COMBO_FIXTURE, 11, PERFECT_CONFIG)
    const order = bindingOrder(s)
    const gates = COMBO_FIXTURE.discs?.trueGates ?? []
    holdFor(s, tensionOnly(0.4), 0.3)
    const first = order[0] as number
    expect(s.bindingChamber).toBe(first)

    holdAt(s, first, gates[first] as number, 0.4, 3.0)
    expect(s.chambers[first]?.state).toBe('SET')

    // The bind is not gone — it has moved to the next wheel in the seeded order.
    holdFor(s, tensionOnly(0.4), 0.2)
    expect(s.bindingChamber).toBe(order[1])
    expect(s.stats.bindOrder.slice(0, 2)).toEqual([order[0], order[1]])
  })

  it('turns the bound wheel slow — the drag that says "correct so far"', () => {
    const a = createSimState(COMBO_FIXTURE, 19, PERFECT_CONFIG)
    const b = createSimState(COMBO_FIXTURE, 19, PERFECT_CONFIG)
    const order = bindingOrder(a)
    const bound = order[0] as number
    const free = order[order.length - 1] as number
    expect(bound).not.toBe(free)

    // A short sprint at a heavy pull: short so the free wheel cannot saturate its travel and
    // flatten the comparison, heavy because the drag scales with tension — that is the
    // punishing-a-heavy-hand thesis wearing wheel form. The target is mid-dial: past the
    // halfway point the turner would take the short way round the seam and arrive at once.
    // Wheels start PARKED on seed-dealt digits since D-192, so the sprint measures from a
    // KNOWN post: park the wheel on digit 0 (free, no tension) before the pull goes on.
    const sprint = (s: SimState, wheel: number): number => {
      holdAt(s, wheel, detentCentre(0), 0, 1.5)
      holdFor(s, tensionOnly(0.6), 0.2)
      holdAt(s, wheel, detentCentre(4), 0.6, 0.04)
      return s.chambers[wheel]?.lift ?? 0
    }
    const boundMoved = sprint(a, bound)
    const freeMoved = sprint(b, free)
    expect(freeMoved).toBeGreaterThan(boundMoved * 1.5)
  })

  it('reads a false gate as a groove on the bound wheel — the lie survives the detents', () => {
    const s = createSimState(COMBO_FIXTURE, 23, PERFECT_CONFIG)
    const order = bindingOrder(s)
    const bound = order[0] as number
    const falseGate = COMBO_FIXTURE.discs?.falseGates[bound]?.[0]
    if (falseGate === undefined) throw new Error('fixture wheel has no false gate')
    holdFor(s, tensionOnly(0.35), 0.2)
    holdAt(s, bound, falseGate, 0.35, 0.8)
    const c = s.chambers[bound]
    if (!c) throw new Error('no wheel')
    // Not parked on the centre: the sidebar tip in the notch shoves the wheel toward the
    // notch's low edge, exactly the ride a plug ledge gives a spool's waist. The wheel stays
    // inside the notch, the state says the lie fired, and the depth is the false gate's own.
    expect(Math.abs(c.lift - falseGate)).toBeLessThan(c.captureWindow)
    expect(c.state).toBe('FALSE_SET')
    expect(s.stats.falseSetsEntered).toBeGreaterThan(0)
    expect(c.geometry).toBe('GROOVE')
    expect(grooveDepthAt(c)).toBeGreaterThan(0)
  })

  it('speaks only under the thumb: resistance while turning, silence parked (D-169)', () => {
    const s = createSimState(COMBO_FIXTURE, 41, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.4), 0.3)
    const b = s.bindingChamber
    expect(b).toBeGreaterThanOrEqual(0)

    // Roll the bound wheel somewhere, then hold the command steady on it: parked, the meter
    // must fall back to the floor — a static hand feels nothing on a real wheel.
    holdAt(s, b, 0.75, 0.4, 0.8)
    holdFor(s, pick(b, 0.75, 0.4), 0.5)
    expect(s.resistance, 'a parked wheel must go quiet').toBeLessThan(0.15)

    // Mid-roll the same wheel reads its drag — sampled during the motion, tick by tick.
    let peak = 0
    for (let i = 0; i < 90; i += 1) {
      step(s, pick(b, 1.65, 0.4), DT)
      if (s.resistance > peak) peak = s.resistance
    }
    expect(peak, 'a turning wheel must speak').toBeGreaterThan(0.3)

    // And once it arrives, the reading dies again inside a fifth of a second.
    holdFor(s, pick(b, 1.65, 0.4), 0.5)
    expect(s.resistance).toBeLessThan(0.15)
  })

  it('never freezes a wheel: a seated one turns off its digit and the bind comes back', () => {
    // The owner's rule and the real object's: the fence leg cams out under the thumb, so
    // "set" is a state of the pack, not a lock on the wheel.
    const s = createSimState(COMBO_FIXTURE, 37, PERFECT_CONFIG)
    const order = bindingOrder(s)
    const first = order[0] as number
    const gates = COMBO_FIXTURE.discs?.trueGates ?? []
    holdFor(s, tensionOnly(0.4), 0.3)
    holdAt(s, first, gates[first] as number, 0.4, 3.0)
    expect(s.chambers[first]?.state).toBe('SET')

    // Roll the seated wheel two digits off its code: it must move, and it must unseat.
    const away = (((gates[first] as number) + 0.6) % 3 + 3) % 3
    holdAt(s, first, away, 0.4, 1.5)
    expect(s.chambers[first]?.lift).toBeCloseTo(away, 1)
    expect(s.chambers[first]?.state).not.toBe('SET')

    // And the pack re-binds it: it held the smallest delta, so the drag comes straight back.
    holdFor(s, tensionOnly(0.4), 0.3)
    expect(s.bindingChamber).toBe(first)
  })

  it('seats a pre-dialled wheel the moment the bind reaches it', () => {
    const s = createSimState(COMBO_FIXTURE, 31, PERFECT_CONFIG)
    const order = bindingOrder(s)
    const gates = COMBO_FIXTURE.discs?.trueGates ?? []
    const [first, second] = [order[0] as number, order[1] as number]

    holdFor(s, tensionOnly(0.4), 0.3)
    // Dial the SECOND wheel to its digit while the first still holds the bind: it parks in
    // its own gate and stays unset — capture belongs to the binding wheel alone.
    holdAt(s, second, gates[second] as number, 0.4, 2.0)
    expect(s.chambers[second]?.state).not.toBe('SET')

    // Now dial the bound wheel. It sets — and the pre-dialled wheel seats itself with the
    // pick nowhere near it, which is the whole reason pre-dialling a combination works.
    holdAt(s, first, gates[first] as number, 0.4, 3.0)
    expect(s.chambers[first]?.state).toBe('SET')
    holdFor(s, tensionOnly(0.4), 0.3)
    expect(s.chambers[second]?.state).toBe('SET')
  })

  it(
    'is decoded whole by the solver: 10 seeds, 10 opens',
    () => {
      const r = measureDifficulty(COMBO_FIXTURE, realConfig(), 10)
      expect(r.solved, r.failures.slice(0, 2).join('; ')).toBe(10)
      // The digits are readable from nothing — the hunt has to actually hunt.
      expect(r.meanSearchSteps).toBeGreaterThan(COMBO_FIXTURE.bitting.length)
    },
    HEAVY_TIMEOUT,
  )
})

describe('the roster wheel packs', () => {
  const rosterCombos = ALL_LOCKS.filter((d) => d.family === 'combination')

  it('exist at the tiers the store ladder claims, and only with grid-legal gates', () => {
    expect(rosterCombos.map((d) => d.tier).sort()).toEqual([1, 3, 4])
    // Tier 1 carries no security features, wheels included: the luggage lock does not lie.
    const luggage = rosterCombos.find((d) => d.tier === 1)
    expect(luggage?.discs?.falseGates.every((g) => g.length === 0)).toBe(true)
  })

  it(
    'open across 50 seeds with the real kit — the store claim holds for the family',
    () => {
      for (const def of rosterCombos) {
        const r = measureDifficulty(def, realConfig(), 50)
        expect(r.solved, `${def.slug}: ${r.failures.slice(0, 2).join('; ')}`).toBe(50)
      }
    },
    HEAVY_TIMEOUT,
  )

  it(
    'actually tell their lies: the solver meets false gates on both liar locks',
    () => {
      for (const def of rosterCombos.filter((d) => d.tier >= 3)) {
        const r = measureDifficulty(def, realConfig(), 20)
        expect(r.meanFalseSets, def.slug).toBeGreaterThan(0)
      }
    },
    HEAVY_TIMEOUT,
  )
})
