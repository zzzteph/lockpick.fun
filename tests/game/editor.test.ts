/**
 * The lock editor's data model — DECISIONS D-080.
 *
 * The editor's whole claim is that an invalid lock is *unreachable* rather than merely rejected, so
 * most of this is about the clamps: whatever you do to a draft, `validateLockDef` still accepts it.
 */

import { describe, expect, it } from 'vitest'
import {
  CUSTOM_ID_BASE,
  EDITABLE_PINS,
  MAX_TOLERANCE,
  MIN_DEPTH,
  MIN_TOLERANCE,
  SPRING_CHOICES,
  clampChamberCount,
  draftFromLockDef,
  draftProblem,
  draftToLockDef,
  maxDepthFor,
  newDraft,
  slugFor,
  windowWidth,
} from '../../src/game/editor'
import {
  CAPTURE_WINDOW,
  MAX_CHAMBERS,
  MIN_CHAMBERS,
  PROFILES,
  createSimState,
  makeConfig,
  validateLockDef,
} from '../../src/sim'
import { PERFECT_CONFIG } from '../sim/fixtures'

describe('a fresh draft', () => {
  it('is valid the moment it exists', () => {
    expect(draftProblem(newDraft())).toBeNull()
  })

  it('is valid at every chamber count the simulation allows', () => {
    for (let n = MIN_CHAMBERS; n <= MAX_CHAMBERS; n += 1) {
      expect(draftProblem(newDraft(n)), `${n} chambers`).toBeNull()
    }
  })

  it('reports its capture window in millimetres before you build it', () => {
    const d = newDraft()
    expect(windowWidth(d)).toBeCloseTo(CAPTURE_WINDOW * d.toleranceQuality, 9)
    d.toleranceQuality = MIN_TOLERANCE
    expect(windowWidth(d)).toBeLessThan(CAPTURE_WINDOW)
  })
})

describe('every pin the editor offers can be used in every chamber', () => {
  it.each(EDITABLE_PINS)('%s is valid at its deepest allowed cut', (pin) => {
    const d = newDraft(3)
    for (const c of d.chambers) {
      c.pin = pin
      c.depth = maxDepthFor(pin)
    }
    expect(draftProblem(d)).toBeNull()
  })

  it.each(EDITABLE_PINS)('%s keeps every groove below the shear line', (pin) => {
    // The point of `maxDepthFor`: a security pin whose waist sits *above* the shear line can never
    // false-set, which is a lock that silently is not the lock you designed.
    const profile = PROFILES[pin]
    const setLift = 5 - maxDepthFor(pin)
    let cursor = 0
    for (const band of profile.bands) {
      cursor += band.length
      if (band.reduced) expect(cursor, `groove top of ${pin}`).toBeLessThanOrEqual(setLift)
    }
  })

  it.each(EDITABLE_PINS)('%s is still valid at the shallowest cut', (pin) => {
    const d = newDraft(2)
    for (const c of d.chambers) {
      c.pin = pin
      c.depth = MIN_DEPTH
    }
    expect(draftProblem(d)).toBeNull()
  })
})

describe('springs are authored, not rolled', () => {
  it('carries the chosen strength through to the built lock', () => {
    const d = newDraft(3)
    d.chambers.forEach((c, i) => (c.spring = i % SPRING_CHOICES.length))
    const def = draftToLockDef(d, 0)
    expect(def.springs).toEqual(d.chambers.map((c) => SPRING_CHOICES[c.spring]?.value))
    const s = createSimState(def, 99, PERFECT_CONFIG)
    s.chambers.forEach((c, i) => {
      expect(c.springStrength).toBeCloseTo(SPRING_CHOICES[d.chambers[i]?.spring ?? 1]?.value ?? 1, 9)
    })
  })

  it('a stiff spring really is stiffer than a light one, in the same chamber', () => {
    const light = newDraft(1)
    const stiff = newDraft(1)
    if (light.chambers[0]) light.chambers[0].spring = 0
    if (stiff.chambers[0]) stiff.chambers[0].spring = 2
    const a = createSimState(draftToLockDef(light, 0), 5, PERFECT_CONFIG)
    const b = createSimState(draftToLockDef(stiff, 1), 5, PERFECT_CONFIG)
    expect(b.chambers[0]?.springStrength).toBeGreaterThan(a.chambers[0]?.springStrength ?? 0)
  })

  it('leaves binding order alone — the roll happens whether it is used or not', () => {
    // A lock with authored springs must bind in the same order as the same lock without them, or
    // choosing a spring would silently reshuffle the puzzle.
    const d = newDraft(5)
    const withSprings = draftToLockDef(d, 0)
    const { springs: _dropped, ...withoutSprings } = withSprings
    const a = createSimState(withSprings, 4242, PERFECT_CONFIG)
    const b = createSimState(withoutSprings, 4242, PERFECT_CONFIG)
    expect(a.chambers.map((c) => c.delta)).toEqual(b.chambers.map((c) => c.delta))
  })
})

describe('drafts and lock definitions round-trip', () => {
  it('every lock the editor can build reads back as the same draft', () => {
    const d = newDraft(4)
    d.name = 'Round Trip'
    d.keyway = 'tight'
    d.toleranceQuality = 0.75
    d.chambers.forEach((c, i) => {
      c.pin = EDITABLE_PINS[i % EDITABLE_PINS.length] ?? 'standard'
      c.spring = i % SPRING_CHOICES.length
      c.depth = Math.min(c.depth, maxDepthFor(c.pin))
    })
    expect(draftFromLockDef(draftToLockDef(d, 3))).toEqual(d)
  })

  it('ids and slugs cannot collide with a catalogue lock', () => {
    const def = draftToLockDef(newDraft(), 0)
    expect(def.id).toBeGreaterThanOrEqual(CUSTOM_ID_BASE)
    expect(def.slug.startsWith('custom-')).toBe(true)
    expect(slugFor('My Lock!!', 10_000)).toBe('custom-10000-my-lock')
    // A name with nothing usable in it still has to produce a slug.
    expect(slugFor('!!!', 10_001)).toBe('custom-10001-lock')
  })

  it('gets a par derived from its own size, so it can be ranked like any other lock', () => {
    // There is no payout to withhold since D-091, but a custom lock still needs a clock to be
    // measured against, and that clock has to grow with the lock.
    const small = draftToLockDef(newDraft(2), 0)
    const large = draftToLockDef(newDraft(10), 1)
    expect(small.par).toBeGreaterThan(0)
    expect(large.par).toBeGreaterThan(small.par)
  })
})

describe('clamps', () => {
  it('holds the chamber count inside what the simulation accepts', () => {
    expect(clampChamberCount(-5)).toBe(MIN_CHAMBERS)
    expect(clampChamberCount(999)).toBe(MAX_CHAMBERS)
    expect(clampChamberCount(5)).toBe(5)
  })

  it('the tolerance range is entirely buildable at both ends', () => {
    for (const q of [MIN_TOLERANCE, MAX_TOLERANCE]) {
      const d = newDraft(5)
      d.toleranceQuality = q
      expect(draftProblem(d), `tolerance ${q}`).toBeNull()
    }
  })

  it('reports a real reason when a draft is genuinely impossible', () => {
    const d = newDraft(2)
    if (d.chambers[0]) d.chambers[0].depth = 9
    const problem = draftProblem(d)
    expect(problem).not.toBeNull()
    expect(() => validateLockDef(draftToLockDef(d, 0))).toThrow()
  })
})

describe('a built lock is a real lock', () => {
  it('loads into the simulation and binds like any other', () => {
    const d = newDraft(5)
    d.chambers.forEach((c, i) => {
      c.pin = i === 2 ? 'spool-deep' : 'standard'
      c.depth = Math.min(c.depth, maxDepthFor(c.pin))
    })
    const s = createSimState(draftToLockDef(d, 0), 4242, makeConfig({}))
    expect(s.chambers).toHaveLength(5)
    expect(s.chambers[2]?.profile.name).toBe('spool-deep')
    expect(new Set(s.chambers.map((c) => c.delta)).size).toBe(5)
  })
})
