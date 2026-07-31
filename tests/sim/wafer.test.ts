/**
 * Wafers — SIMULATION.md §10.
 *
 * "The wafer has a gate that must sit at the shear line — but unlike a pin stack it blocks in
 * *both* directions, so it must be lifted to a window, not merely past one."
 */

import { describe, expect, it } from 'vitest'
import {
  DT,
  PERFECT_TOOLS,
  captureRange,
  createSimState,
  makeConfig,
  readShearLine,
  solveLock,
  step,
  targetLiftFor,
  type SimInput,
  type SimState,
} from '../../src/sim'
import { makeLock } from './fixtures'

const PERFECT = makeConfig({ tools: PERFECT_TOOLS })

const THREE_WAFER = makeLock({
  slug: 'fixture-wafer3',
  bitting: [3.0, 3.6, 2.7],
  pins: ['wafer', 'wafer', 'wafer'],
  family: 'wafer',
  toleranceQuality: 1.35,
})

const DOUBLE_SIDED = makeLock({
  slug: 'fixture-wafer-double',
  bitting: [3.2, 3.8, 2.9, 3.5],
  pins: ['wafer', 'wafer', 'wafer', 'wafer'],
  family: 'wafer',
  doubleSided: true,
  toleranceQuality: 1.15,
})

function hold(s: SimState, inp: SimInput, seconds: number): void {
  const ticks = Math.round(seconds / DT)
  for (let i = 0; i < ticks; i += 1) step(s, inp, DT)
}

function pick(chamber: number, liftTarget: number, tension: number): SimInput {
  return { chamber, liftTarget, tensionHeld: true, tensionLevel: tension }
}

describe('a wafer blocks in both directions', () => {
  const s = createSimState(THREE_WAFER, 1, PERFECT)
  const c = s.chambers[0]
  if (!c) throw new Error('missing chamber')

  it('is a window centred on the gate, not a threshold above it', () => {
    const range = captureRange(c)
    expect(range.low).toBeCloseTo(c.setLift - c.captureWindow / 2, 9)
    expect(range.high).toBeCloseTo(c.setLift + c.captureWindow / 2, 9)
    expect(targetLiftFor(c)).toBeCloseTo(c.setLift, 9)
  })

  it('reads SOLID below the gate, WINDOW at it, and SOLID again above', () => {
    expect(readShearLine(c, 0).geometry).toBe('SOLID')
    expect(readShearLine(c, c.setLift - c.captureWindow).geometry).toBe('SOLID')
    expect(readShearLine(c, c.setLift).geometry).toBe('WINDOW')
    expect(readShearLine(c, c.setLift + c.captureWindow * 0.45).geometry).toBe('WINDOW')
    expect(readShearLine(c, c.setLift + c.captureWindow).geometry).toBe('SOLID')
    expect(readShearLine(c, c.maxLift).geometry).toBe('SOLID')
  })

  it('never oversets — over-lifting jams it, but coming back down fixes it', () => {
    // A tight wafer, so the pick clears the gate faster than CAPTURE_TIME and cannot capture
    // on the way past. On a loose wafer, sailing through the gate sets it — which is correct,
    // and the same forgiveness a loose pin tumbler gives.
    const tight = makeLock({
      slug: 'fixture-wafer-tight',
      bitting: [3.0, 3.6, 2.7],
      pins: ['wafer', 'wafer', 'wafer'],
      family: 'wafer',
      toleranceQuality: 0.6,
    })
    const w = createSimState(tight, 1, PERFECT)
    hold(w, pick(-1, 0, 0.5), 0.4)
    const b = w.bindingChamber
    const target = w.chambers[b]
    if (!target) throw new Error('expected a binding chamber')

    hold(w, pick(b, target.maxLift, 0.5), 1.5)
    expect(target.state, 'a wafer has no overset to give').not.toBe('OVERSET')
    expect(target.state, 'parked above its gate, it blocks').toBe('BINDING')
    expect(w.stats.oversets).toBe(0)
    expect(w.opened).toBe(false)

    // Come back down to the gate and it sets — no reset needed, which is the whole
    // difference between jamming a wafer and jamming a pin stack.
    hold(w, pick(b, targetLiftFor(target), 0.5), 1.5)
    expect(target.state).toBe('SET')
  })

  it('a loose wafer can be caught on the way past, like a loose pin tumbler', () => {
    const w = createSimState(THREE_WAFER, 1, PERFECT)
    hold(w, pick(-1, 0, 0.5), 0.4)
    const b = w.bindingChamber
    const target = w.chambers[b]
    if (!target) throw new Error('expected a binding chamber')
    hold(w, pick(b, target.maxLift, 0.5), 1.5)
    expect(target.state).toBe('SET')
    expect(w.stats.oversets).toBe(0)
  })

  it('tells the renderer which half is in the way', () => {
    expect(readShearLine(c, 0).bandAtShear).toBe(0)
    expect(readShearLine(c, c.setLift).bandAtShear).toBe(1)
    expect(readShearLine(c, c.maxLift).bandAtShear).toBe(2)
  })

  it('is refused by the validator if its gate starts already on the shear line', () => {
    expect(() =>
      createSimState(
        makeLock({ slug: 'bad-wafer', bitting: [4.8], pins: ['wafer'], family: 'wafer' }),
        1,
        PERFECT,
      ),
    ).toThrow(/would start already set/)
  })
})

describe('double-sided wafers', () => {
  it('alternate which side of the keyway they bite from', () => {
    const s = createSimState(DOUBLE_SIDED, 1, PERFECT)
    expect(s.chambers.map((c) => c.inverted)).toEqual([false, true, false, true])
    // The inverted ones start at the top of their travel, pushed there by their own spring.
    for (const c of s.chambers) {
      expect(c.lift, `chamber ${c.index}`).toBe(c.inverted ? c.maxLift : 0)
    }
  })

  it('an inverted wafer has to be pushed down, not lifted', () => {
    const s = createSimState(DOUBLE_SIDED, 1, PERFECT)
    const c = s.chambers[1]
    if (!c) throw new Error('missing chamber')
    expect(c.inverted).toBe(true)
    hold(s, pick(-1, 0, 0.4), 0.4)
    expect(c.lift).toBeCloseTo(c.maxLift, 6)

    // Asking the tip for a lower position pushes it down to there.
    hold(s, pick(1, 0.4, 0.4), 1.5)
    expect(c.lift).toBeLessThan(0.6)

    // Take the pick away and its spring carries it straight back up.
    hold(s, pick(-1, 0, 0.4), 2.0)
    expect(c.lift).toBeCloseTo(c.maxLift, 4)
  })

  it('is refused unless every chamber is a wafer', () => {
    expect(() =>
      createSimState(
        makeLock({
          slug: 'bad-double',
          bitting: [3.0, 3.2],
          pins: ['wafer', 'standard'],
          family: 'wafer',
          doubleSided: true,
        }),
        1,
        PERFECT,
      ),
    ).toThrow(/only meaningful on a lock made entirely of wafers/)
  })

  it('can be opened, both directions together', () => {
    const result = solveLock(DOUBLE_SIDED, 5, PERFECT, { maxSeconds: 60 })
    expect(result.opened).toBe(true)
  })
})

/**
 * The roster's wafer and dimple locks used to be tested here. Both families left the roster with
 * D-088 — the game is cylinders and disc detainers now — so the tests that asked the *catalogue*
 * about them went with them. The physics above is untouched: wafers and dimples are still fully
 * modelled and still tested, from fixtures, because the editor and any future roster may want
 * them back and a capability nobody exercises is a capability that quietly rots.
 */
