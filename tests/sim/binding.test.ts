import { describe, expect, it } from 'vitest'
import { T_MIN_HOLD, createSimState, effectiveReach, type SimState } from '../../src/sim'
import { STARTER_TOOLS, PERFECT_TOOLS, withTools } from '../../src/sim'
import {
  FIVE_PIN,
  PERFECT_CONFIG,
  THREE_PIN,
  TWELVE_PIN,
  configWith,
  holdFor,
  pick,
  tensionOnly,
  workBindingChamber,
} from './fixtures'

function bindingCount(s: SimState): number {
  return s.chambers.filter((c) => c.state === 'BINDING').length
}

function deltaOrder(s: SimState): number[] {
  return [...s.chambers].sort((a, b) => a.delta - b.delta).map((c) => c.index)
}

describe('binding resolution — SIMULATION.md §2', () => {
  it('exactly one chamber binds under tension, across 500 seeds', () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const s = createSimState(FIVE_PIN, seed, PERFECT_CONFIG)
      holdFor(s, tensionOnly(0.45), 0.3)
      expect(bindingCount(s), `seed ${seed} at rest`).toBe(1)
      expect(s.bindingChamber, `seed ${seed}`).toBe(deltaOrder(s)[0])

      // …and after each pin sets, right up until the last one.
      for (let stage = 0; stage < FIVE_PIN.bitting.length - 1; stage += 1) {
        const result = workBindingChamber(s, 0.45)
        expect(result, `seed ${seed} stage ${stage}`).toBe('SET')
        expect(bindingCount(s), `seed ${seed} after stage ${stage}`).toBe(1)
      }
    }
  })

  it('binds in ascending delta order', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const s = createSimState(FIVE_PIN, seed, PERFECT_CONFIG)
      holdFor(s, tensionOnly(0.45), 0.3)
      for (let i = 0; i < FIVE_PIN.bitting.length; i += 1) workBindingChamber(s, 0.45)
      expect(s.stats.setOrder, `seed ${seed}`).toEqual(deltaOrder(s))
      expect(s.stats.bindOrder, `seed ${seed}`).toEqual(deltaOrder(s))
    }
  })

  it('setting the binding chamber promotes the next-smallest delta', () => {
    const s = createSimState(FIVE_PIN, 17, PERFECT_CONFIG)
    const order = deltaOrder(s)
    holdFor(s, tensionOnly(0.45), 0.3)
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(s.bindingChamber).toBe(order[i])
      workBindingChamber(s, 0.45)
      expect(s.bindingChamber).toBe(order[i + 1])
    }
  })

  it('nothing binds without tension', () => {
    const s = createSimState(FIVE_PIN, 3, PERFECT_CONFIG)
    holdFor(s, tensionOnly(T_MIN_HOLD - 0.01), 0.5)
    expect(s.bindingChamber).toBe(-1)
    expect(bindingCount(s)).toBe(0)
  })

  it('nothing binds once every chamber is set', () => {
    const s = createSimState(THREE_PIN, 8, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    for (let i = 0; i < 3; i += 1) workBindingChamber(s, 0.5)
    expect(s.chambers.every((c) => c.state === 'SET')).toBe(true)
    expect(s.bindingChamber).toBe(-1)
  })

  it('the plug is held at the binding chamber delta and steps up as pins set', () => {
    const s = createSimState(FIVE_PIN, 21, PERFECT_CONFIG)
    const order = deltaOrder(s)
    holdFor(s, tensionOnly(0.5), 0.4)
    let previous = 0
    for (let i = 0; i < order.length - 1; i += 1) {
      const c = s.chambers[s.bindingChamber]
      if (!c) throw new Error('expected a binding chamber')
      expect(s.thetaMax).toBeCloseTo(c.delta, 9)
      expect(s.theta).toBeGreaterThan(previous)
      previous = s.theta
      workBindingChamber(s, 0.5)
      holdFor(s, tensionOnly(0.5), 0.15)
    }
  })
})

describe('pick reach — CONTENT.md §2', () => {
  it('a bottom-of-keyway wrench reaches exactly its rated chambers', () => {
    expect(effectiveReach(STARTER_TOOLS, 'standard')).toBe(4)
  })

  it('a top-of-keyway wrench buys one more chamber', () => {
    const tok = withTools(STARTER_TOOLS, { keywayPosition: 'top' })
    expect(effectiveReach(tok, 'standard')).toBe(5)
  })

  it('a tight keyway costs two chambers to a pick that does not fit, and nothing to one that does', () => {
    // Starter hook: too fat for the keyway (-1) and crowded by a bottom-of-keyway wrench (-1).
    expect(effectiveReach(STARTER_TOOLS, 'tight')).toBe(2)
    const fits = withTools(STARTER_TOOLS, { fitsTightKeyway: true })
    expect(effectiveReach(fits, 'tight')).toBe(4)
    expect(effectiveReach(fits, 'standard')).toBe(4)
    // A TOK wrench still buys its chamber, and spares the crowding penalty on top.
    const tok = withTools(STARTER_TOOLS, { keywayPosition: 'top' })
    expect(effectiveReach(tok, 'tight')).toBe(4)
  })

  it('never goes negative', () => {
    const stub = withTools(STARTER_TOOLS, { reach: 0 })
    expect(effectiveReach(stub, 'tight')).toBe(0)
  })

  it('genuinely prevents access to chambers past the limit', () => {
    const short = configWith(withTools(PERFECT_TOOLS, { reach: 3, keywayPosition: 'bottom' }))
    const s = createSimState(TWELVE_PIN, 5, short)
    holdFor(s, tensionOnly(0.5), 0.3)
    // Chamber 7 is out of reach: the tip is reported as out of the lock and nothing lifts.
    holdFor(s, pick(7, 2.0, 0.5), 1.0)
    expect(s.pickChamber).toBe(-1)
    expect(s.chambers[7]?.lift).toBe(0)
    // Chamber 2 is within reach and does lift.
    holdFor(s, pick(2, 0.4, 0.5), 0.5)
    expect(s.chambers[2]?.lift).toBeGreaterThan(0.3)
  })
})
