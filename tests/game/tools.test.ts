/**
 * The kit — DECISIONS D-088.
 *
 * There used to be a nineteen-tool catalogue here, and a test per purchase proving it changed
 * measurable simulation behaviour. The catalogue is gone; what is left is one stat block, and what
 * matters about it is the shape of the trade it makes: **nothing that gates, everything that is
 * felt.** These tests are that sentence, made checkable.
 */

import { describe, expect, it } from 'vitest'
import { KIT, KIT_NAME } from '../../src/game/tools'
import { ALL_LOCKS } from '../../src/game/locks'
import { PERFECT_TOOLS, createSimState, effectiveReach, makeConfig } from '../../src/sim'
import { TENSION_MAX_STEP, TENSION_MIN_STEP } from '../../src/ui/input'

describe('nothing in the kit is a gate', () => {
  it('reaches every chamber of every lock in the roster', () => {
    for (const def of ALL_LOCKS) {
      const reach = effectiveReach(KIT, def.keyway)
      expect(reach, def.slug).toBeGreaterThanOrEqual(def.bitting.length)
    }
  })

  it('fits a tight keyway, so no lock is closed by its keyway alone', () => {
    expect(KIT.fitsTightKeyway).toBe(true)
    for (const def of ALL_LOCKS.filter((d) => d.keyway === 'tight')) {
      expect(effectiveReach(KIT, def.keyway), def.slug).toBeGreaterThanOrEqual(def.bitting.length)
    }
  })

  it('passes every pressure step the wheel can select, unclamped', () => {
    expect(KIT.tensionMin).toBeLessThanOrEqual(TENSION_MIN_STEP)
    expect(KIT.tensionMax).toBeGreaterThanOrEqual(TENSION_MAX_STEP)
  })
})

describe('but the kit is a tool, not a cheat', () => {
  it('still wobbles, so precision is exercised rather than owned', () => {
    expect(KIT.liftJitter).toBeGreaterThan(0)
  })

  it('still bends, so leaning on a jammed pin still costs something (D-068)', () => {
    expect(KIT.strength).toBeGreaterThan(0)
    expect(KIT.strength).toBeLessThan(10)
  })

  it('the wrench still takes a moment to load, and still drifts', () => {
    expect(KIT.tensionSlew).toBeGreaterThan(0)
    expect(KIT.tensionSlew).toBeLessThan(100)
    expect(KIT.tensionPrecision).toBeGreaterThan(0)
  })

  it('is measurably not `PERFECT_TOOLS`, which exists for physics tests only', () => {
    expect(KIT.liftJitter).toBeGreaterThan(PERFECT_TOOLS.liftJitter)
    expect(KIT.strength).toBeLessThan(PERFECT_TOOLS.strength)
  })

  it('and its numbers actually reach the simulation', () => {
    const def = ALL_LOCKS[0]
    if (!def) throw new Error('empty roster')
    const s = createSimState(def, 4242, makeConfig({ tools: KIT }))
    expect(s.config.tools.liftJitter).toBe(KIT.liftJitter)
    expect(s.config.tools.strength).toBe(KIT.strength)
  })
})

describe('there is only one of it', () => {
  it('has a name the HUD can print', () => {
    expect(KIT_NAME.length).toBeGreaterThan(0)
  })

  it('is a complete stat block, with nothing left to fall back on', () => {
    // It used to be merged out of a wrench slice and a pick slice over a starter default, which
    // meant a half-specified tool was reachable. One literal cannot be half-specified.
    const required: (keyof typeof KIT)[] = [
      'tensionMin',
      'tensionMax',
      'tensionSlew',
      'tensionPrecision',
      'reach',
      'liftJitter',
      'liftRate',
      'fitsTightKeyway',
      'keywayPosition',
      'strength',
    ]
    for (const key of required) expect(KIT[key], key).not.toBeUndefined()
  })
})
