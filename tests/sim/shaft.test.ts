/**
 * The hook fouls what it passes, if you carry it high — DECISIONS D-138.
 *
 * Chambers are not separate rooms. The bores are walled — 0.9mm of brass at a 3.81mm pitch — but
 * the keyway beneath them is one continuous slot, so a hook dragged along it with the hand raised
 * passes directly under every key pin between the mouth and the tip. Every lift in `step.ts` used
 * to be gated on `c.index === pick`, in eight separate places, so only the selected chamber could
 * move at all.
 *
 * Both halves of the rule are pinned here, because the second half is what keeps the game playable:
 * a pick lying in the keyway is beneath everything and must touch nothing.
 */

import { describe, expect, it } from 'vitest'
import { PERFECT_TOOLS, createSimState, type SimState } from '../../src/sim'
import { withTools } from '../../src/sim/tools'
import { FIVE_PIN, configWith, holdFor, pick } from './fixtures'

/** A five-chamber lock and a hook of a given crest height. */
function setup(hookHeight: number): { s: SimState; config: ReturnType<typeof configWith> } {
  const config = configWith(withTools(PERFECT_TOOLS, { hookHeight }))
  return { s: createSimState(FIVE_PIN, 1, config), config }
}

/** Park the tip at the back of the lock with the hand down, and report where every pin is. */
function parkAtBack(s: SimState): number[] {
  holdFor(s, pick(4, 0, 0.3), 1.5)
  return s.chambers.map((c) => c.keyLift)
}

describe('a hook carried high presses the pins it passes', () => {
  /**
   * Sampled **during** the sweep, not after it.
   *
   * The first version of this test read the pins once the tip had arrived and found nothing —
   * correctly, because a pin the hook has already passed drops straight back onto its spring. The
   * lift is momentary by nature, so measuring it afterwards measures the spring rather than the
   * hook. What the mechanic does is disturb pins in passing; the evidence is the peak each one
   * reaches while the crest is under it.
   */
  function peakLiftsWhileTravelling(s: SimState, to: number, hand: number): number[] {
    const peak = s.chambers.map((c) => c.keyLift)
    for (let i = 0; i < 40; i += 1) {
      holdFor(s, pick(to, hand, 0.3), 0.03)
      s.chambers.forEach((c, idx) => {
        peak[idx] = Math.max(peak[idx] ?? 0, c.keyLift)
      })
    }
    return peak
  }

  it('lifts the chambers it travels over', () => {
    const { s } = setup(1.6)
    const before = parkAtBack(s)
    // Drag forward to the mouth with the hand raised: the crest sweeps under 3, 2 and 1.
    const peak = peakLiftsWhileTravelling(s, 0, 2.0)

    const moved = [1, 2, 3].filter((i) => (peak[i] ?? 0) > (before[i] ?? 0) + 0.05)
    expect(moved.length, `chambers passed under that moved: [${moved.join(',')}]`).toBeGreaterThan(0)
  })

  it('and the ones it passes fall back behind it', () => {
    // The other half of "a wedge, not a jack": the disturbance is momentary, so crossing the lock
    // costs you the pins you were holding rather than permanently jacking the ones you were not.
    const { s } = setup(1.6)
    parkAtBack(s)
    peakLiftsWhileTravelling(s, 0, 2.0)
    holdFor(s, pick(0, 2.0, 0.3), 1.0)
    for (const i of [2, 3]) {
      const c = s.chambers[i]
      if (!c || c.state === 'SET') continue
      expect(c.keyLift, `chamber ${i} stayed up after the hook left`).toBeLessThan(0.6)
    }
  })

  it('but a pick lying in the keyway touches nothing', () => {
    const { s } = setup(1.6)
    const before = parkAtBack(s)
    // The same journey with the hand down. This is D-045's sliding hook, and it still rides over.
    holdFor(s, pick(0, 0, 0.3), 1.2)
    const after = s.chambers.map((c) => c.keyLift)
    for (const i of [1, 2, 3]) {
      expect(after[i] ?? 0, `chamber ${i} moved with the hand down`).toBeLessThanOrEqual(
        (before[i] ?? 0) + 0.02,
      )
    }
  })

  it('and a flat hook fouls nothing however high the hand is', () => {
    // `hookHeight: 0` is the reference tool, and it is what keeps every other physics test in this
    // suite measuring the lock rather than the tool.
    const { s } = setup(0)
    const before = parkAtBack(s)
    holdFor(s, pick(0, 2.0, 0.3), 1.2)
    const after = s.chambers.map((c) => c.keyLift)
    for (const i of [1, 2, 3]) {
      expect(after[i] ?? 0, `chamber ${i}`).toBeLessThanOrEqual((before[i] ?? 0) + 0.02)
    }
  })

  it('carries pins at the hook’s crest, not at the hand’s height', () => {
    /*
     * The hook is a wedge going past, not a jack. This is the whole difference between disturbing
     * a lock and demolishing it: without it, crossing a lock with the hand high would overset
     * everything in between, which is the wrecking ball D-045 was written to prevent.
     */
    const crest = 1.2
    const { s } = setup(crest)
    parkAtBack(s)
    holdFor(s, pick(0, 4.0, 0.3), 1.2)
    for (const i of [1, 2, 3]) {
      const c = s.chambers[i]
      if (!c || c.state === 'SET') continue
      expect(c.keyLift, `chamber ${i} was jacked past the crest`).toBeLessThanOrEqual(crest + 0.2)
    }
  })

  it('never drives a chamber past its own ceiling', () => {
    // A tall hook and a high hand must still not push a pin beyond where the lock allows.
    const { s } = setup(4.0)
    parkAtBack(s)
    holdFor(s, pick(0, 4.0, 0.3), 1.2)
    for (const c of s.chambers) {
      expect(c.keyLift, `chamber ${c.index}`).toBeLessThanOrEqual(c.maxLift + 1e-6)
    }
  })
})

/**
 * The control that makes the mechanic reachable — DECISIONS D-139.
 *
 * D-138's physics was correct and unreachable: `stepChamber` zeroes the lift on every chamber
 * change, so no input the game offered could travel with the hand up. Holding Space while pressing
 * an arrow now means what it looks like — drag the hook along without setting it down.
 *
 * These assert the *shape* of that trade at the simulation level: travelling high must be able to
 * cost you a pin you had already set, and travelling low must not.
 */
describe('carrying the hook high costs you what you had', () => {
  /** Set chamber 3, then cross the lock to chamber 0 at the given hand height. */
  function crossAfterSetting(hand: number): SimState {
    const { s } = setup(1.6)
    const target = s.chambers[3]!
    // Work chamber 3 until it captures.
    holdFor(s, pick(3, 0, 0.35), 0.6)
    holdFor(s, pick(3, target.setLift + target.captureWindow * 0.5, 0.35), 2.5)
    // Then travel to the mouth, hand at the given height.
    for (let i = 0; i < 40; i += 1) holdFor(s, pick(0, hand, 0.35), 0.03)
    return s
  }

  /**
   * A pin you have already **set** survives a careless crossing, and this is not luck.
   *
   * When a chamber captures, its key pin falls away to the keyway floor and the driver is held on
   * the plug's ledge above it — D-051 makes exactly this point: *"what makes a set pin feel safe is
   * not a clamp, it is that the pick pushes the key pin, which has fallen away, so dragging the
   * tool across at a working height never reaches the driver at all."*
   *
   * So a short hook sweeping past lifts the fallen key pin and stops well below the driver. That is
   * the property that makes the whole mechanic *fair*: carrying the hook high spoils the pin you
   * are working and the search you are in the middle of, and does not undo work you have banked.
   * It was a discovery rather than a design — the first version of this test asserted the opposite
   * and was wrong about the lock.
   */
  it('a set pin survives the crossing either way', () => {
    expect(crossAfterSetting(0).chambers[3]?.state, 'hand down').toBe('SET')
    expect(crossAfterSetting(2.2).chambers[3]?.state, 'hand up').toBe('SET')
  })

  it('but the unset pins are measurably disturbed by the hand being up', () => {
    const low = crossAfterSetting(0)
    const high = crossAfterSetting(2.2)
    // Same lock, same seed, same journey. The only difference is how the hook was carried.
    const moved = [0, 1, 2].filter((i) => {
      const a = low.chambers[i]
      const b = high.chambers[i]
      if (!a || !b) return false
      return b.state !== a.state || Math.abs(b.keyLift - a.keyLift) > 0.05
    })
    expect(moved.length, 'carrying the hook high across the lock changed nothing at all').toBeGreaterThan(0)
  })
})
