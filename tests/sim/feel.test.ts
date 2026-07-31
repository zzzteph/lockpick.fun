/**
 * What the player can read — DECISIONS D-083, and the two physics defects found beside it.
 *
 * Every case here started as a play report. They are grouped because they are all the same class of
 * bug: the simulation was right about the lock and wrong about what it told you.
 */

import { describe, expect, it } from 'vitest'
import { DT, FORCE_FULL_MM, T_MIN_HOLD, createSimState, step } from '../../src/sim'
import {
  FIVE_PIN,
  MUSHROOM_LOCK,
  PERFECT_CONFIG,
  SPOOL_LOCK,
  TIGHT_FIVE,
  holdFor,
  makeLock,
  pick,
  pickAt,
  tensionOnly,
} from './fixtures'

/** Work whatever is binding until it leaves BINDING. */
function workBinding(s: ReturnType<typeof createSimState>, T: number, seconds = 6): boolean {
  const b = s.bindingChamber
  if (b < 0) return false
  const c = s.chambers[b]
  if (!c) return false
  const target = c.setLift + c.captureWindow * 0.5
  pickAt(s, b, target, T)
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    step(s, pick(b, target, T), DT)
    if (c.state !== 'BINDING' && c.state !== 'FREE') return true
  }
  return false
}

/**
 * An overset jams the **key pin** — DECISIONS D-094.
 *
 * `lift` is the whole stack's displacement and `setLift` is where the key/driver junction meets the
 * shear line, so `lift > setLift + captureWindow` means the junction has gone *past* the line and
 * the body lying across it is the key pin. The driver is above it, in the bible, holding nothing.
 *
 * This block asserted the opposite for one afternoon. It is here in full because the mistake was
 * easy to make and the corrected version is easy to break again.
 */
function overset(seed = 11): { s: ReturnType<typeof createSimState>; victim: number } {
  const s = createSimState(TIGHT_FIVE, seed, PERFECT_CONFIG)
  holdFor(s, tensionOnly(0.5), 0.3)
  const c = s.chambers[s.bindingChamber]
  if (!c) throw new Error('expected a binding chamber')
  holdFor(s, pick(c.index, c.setLift + c.captureWindow * 1.8, 0.5), 0.8)
  if (c.state !== 'OVERSET') throw new Error(`expected an overset, got ${c.state}`)
  return { s, victim: c.index }
}

describe('an overset jams the key pin, not the driver', () => {
  it('the key pin stays in the cylinder — the plug has turned onto it', () => {
    const { s, victim: i } = overset()
    const c = s.chambers[i]
    if (!c) throw new Error('missing chamber')
    const held = c.keyLift

    // Take the pick right off it and give the spring a long time to do nothing.
    pickAt(s, i === 0 ? 1 : 0, 0, 0.5)
    holdFor(s, tensionOnly(0.5), 2)
    expect(c.keyLift, 'a pinched key pin does not fall').toBeCloseTo(held, 4)
    expect(c.keyLift).toBeGreaterThan(c.setLift)
  })

  it('the junction is above the shear line, which is what makes it the key pin that is caught', () => {
    const { s, victim: i } = overset()
    const c = s.chambers[i]
    if (!c) throw new Error('missing chamber')
    expect(c.lift).toBeGreaterThan(c.setLift + c.captureWindow)
  })

  it('and it lets go the moment tension does', () => {
    const { s, victim: i } = overset()
    const c = s.chambers[i]
    if (!c) throw new Error('missing chamber')
    holdFor(s, tensionOnly(0), 1.5)
    expect(c.state).toBe('FREE')
    expect(c.lift).toBeLessThan(0.1)
    expect(c.keyLift).toBeLessThan(0.1)
  })

  it('arriving at one with the pick at rest does not read as leaning on it', () => {
    const { s, victim: i } = overset()
    // The original play report — "the lockpick is always like pressed a lot". The fix was the force
    // meter becoming an overreach measure (D-083), *not* moving the key pin, which is what D-086
    // wrongly did. With the pick asking for nothing there is no overreach and no force.
    pickAt(s, i, 0, 0.5)
    holdFor(s, pick(i, 0, 0.5), 0.4)
    expect(s.pickForce).toBeLessThan(0.1)
  })
})

describe('the force meter is a reading, not a light', () => {
  it('rest on a pin without pushing and it stays near zero', () => {
    const s = createSimState(FIVE_PIN, 12345, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const b = s.bindingChamber
    const c = s.chambers[b]
    if (!c) throw new Error('expected a binding chamber')
    pickAt(s, b, c.lift, 0.5)
    holdFor(s, pick(b, c.lift, 0.5), 0.3)
    expect(s.pickForce).toBeLessThan(0.15)
  })

  it('rises with how far past the pin you are asking, over its whole range', () => {
    const s = createSimState(FIVE_PIN, 12345, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.9), 0.3)
    const b = s.bindingChamber
    const c = s.chambers[b]
    if (!c) throw new Error('expected a binding chamber')
    pickAt(s, b, 0, 0.9)
    holdFor(s, pick(b, 0, 0.9), 0.2)

    const readings: number[] = []
    for (const over of [0, 0.25, 0.5, 0.75, 1]) {
      const target = c.keyLift + FORCE_FULL_MM * over
      holdFor(s, pick(b, target, 0.9), 0.05)
      readings.push(s.pickForce)
    }
    // Monotone, and it actually uses the range rather than pinning at the top (D-083). It does not
    // reach 1.0 here and should not: a bound pin still creeps up under the pick, closing the gap it
    // is being measured by, which is the meter reporting the lock rather than the command.
    for (let i = 1; i < readings.length; i += 1) {
      expect(readings[i] ?? 0).toBeGreaterThanOrEqual((readings[i - 1] ?? 0) - 1e-9)
    }
    const lowest = readings[0] ?? 1
    const highest = readings[readings.length - 1] ?? 0
    expect(lowest).toBeLessThan(0.2)
    expect(highest).toBeGreaterThan(0.6)
    expect(highest - lowest).toBeGreaterThan(0.5)
  })

  it('does not peg the instant the tip touches a pin, which is the bug that was reported', () => {
    const s = createSimState(FIVE_PIN, 12345, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const b = s.bindingChamber
    const c = s.chambers[b]
    if (!c) throw new Error('expected a binding chamber')
    // A quarter of a millimetre of push used to be more than half of full scale.
    pickAt(s, b, 0, 0.5)
    holdFor(s, pick(b, c.keyLift + 0.25, 0.5), 0.1)
    expect(s.pickForce).toBeLessThan(0.5)
  })

  it('contact still saturates quickly — it is the gate, and the gate should', () => {
    const s = createSimState(FIVE_PIN, 12345, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const b = s.bindingChamber
    const c = s.chambers[b]
    if (!c) throw new Error('expected a binding chamber')
    pickAt(s, b, c.setLift, 0.5)
    holdFor(s, pick(b, c.setLift, 0.5), 0.2)
    expect(s.pickContact).toBe(1)
  })

  it('reads nothing at all with the pick out of the lock', () => {
    const s = createSimState(FIVE_PIN, 12345, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.6)
    expect(s.pickForce).toBe(0)
    expect(s.pickContact).toBe(0)
  })
})

describe('releasing the wrench drops false sets too', () => {
  const ALL_SPOOLS = makeLock({
    id: 9101,
    slug: 'fixture-all-spools',
    name: 'Fixture all spools',
    bitting: [3.2, 3.0, 2.8, 3.1],
    pins: ['spool', 'spool', 'spool', 'spool'],
    toleranceQuality: 1.2,
  })

  it('a lock made entirely of spools does not stay false-set with the wrench off', () => {
    const s = createSimState(ALL_SPOOLS, 4242, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    for (let pass = 0; pass < 12 && !s.opened; pass += 1) if (!workBinding(s, 0.5)) break
    // At least one chamber should have taken the lie — that is what a spool lock does.
    expect(s.chambers.some((c) => c.state === 'FALSE_SET' || c.state === 'SET')).toBe(true)

    holdFor(s, tensionOnly(0), 1.2)
    expect(s.tension).toBeLessThan(T_MIN_HOLD)
    // Reported from play: "when I release the tension they all can became in position of false set".
    expect(s.chambers.every((c) => c.state === 'FREE')).toBe(true)
  })

  it('a single false set clears the same way', () => {
    const s = createSimState(SPOOL_LOCK, 4242, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.6), 0.3)
    for (let pass = 0; pass < 8 && !s.opened; pass += 1) if (!workBinding(s, 0.6)) break
    holdFor(s, tensionOnly(0), 1.2)
    expect(s.chambers.every((c) => c.state === 'FREE')).toBe(true)
  })

  it('and the driver actually comes back down, not just the label', () => {
    const s = createSimState(MUSHROOM_LOCK, 4242, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.6), 0.3)
    for (let pass = 0; pass < 8 && !s.opened; pass += 1) if (!workBinding(s, 0.6)) break
    holdFor(s, tensionOnly(0), 1.5)
    for (const c of s.chambers) expect(c.lift).toBeLessThan(0.1)
  })
})
