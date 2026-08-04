/**
 * The serrated grind — D-157.
 *
 * Reported from play: *"serrated pins — I do feel that they have no real difference to the
 * general pin — yes they bind a lot, but they will not prevent the oversetting."* The lies were
 * always simulated (each groove false-sets — the four fake clicks); what was missing was any
 * cost to the climb itself. `SERRATION_GRIP` divides the binding lift rate by
 * `1 + grip × T × grooveCount`, so the teeth drag exactly when the plug edge is pinching them.
 *
 * Asserted the way START-HERE.md demands: that the effect *occurs* — a serrated driver under
 * working tension climbs at a fraction of a standard driver's rate, and eases when the wrench
 * does — not merely that a constant exists.
 */

import { describe, expect, it } from 'vitest'
import { PERFECT_TOOLS, createSimState, makeConfig, type LockDef } from '../../src/sim'
import { holdFor, pick, tensionOnly } from './fixtures'

const CONFIG = makeConfig({ tools: PERFECT_TOOLS, featherEnabled: false })

const base: Omit<LockDef, 'pins' | 'slug' | 'id' | 'name'> = {
  tier: 1,
  family: 'pin-tumbler',
  bitting: [3.2, 3.0, 2.8],
  toleranceQuality: 1.2,
  keyway: 'standard',
  par: 60,
  note: '',
}

const standardDef: LockDef = {
  ...base,
  id: 990,
  slug: 'test-standard-trio',
  name: 'standard trio',
  pins: ['standard', 'standard', 'standard'],
}

const serratedDef: LockDef = {
  ...base,
  id: 991,
  slug: 'test-serrated-trio',
  name: 'serrated trio',
  pins: ['serrated', 'serrated', 'serrated'],
}

/** Lift gained by the binding chamber in a short, fixed push at a given tension. */
function climb(def: LockDef, tension: number): number {
  const s = createSimState(def, 7, CONFIG)
  holdFor(s, tensionOnly(tension), 0.3)
  const b = s.bindingChamber
  const c = s.chambers[b]
  if (!c) throw new Error('nothing binding')
  const before = c.lift
  // Short enough that neither pin reaches its capture window, so this measures pure rate.
  holdFor(s, pick(b, c.setLift * 0.85, tension), 0.1)
  return c.lift - before
}

describe('serrations drag on the climb', () => {
  it('a binding serrated pin climbs at a fraction of a standard pin, at working tension', () => {
    const plain = climb(standardDef, 0.45)
    const toothed = climb(serratedDef, 0.45)
    expect(plain).toBeGreaterThan(0)
    expect(toothed).toBeGreaterThan(0)
    // 1 / (1 + 0.8 × 0.45 × 4) ≈ 0.41 — anything near parity means the grind is not wired.
    expect(toothed / plain).toBeLessThan(0.55)
  })

  it('feathering the wrench frees the teeth — lighter tension, weaker grip', () => {
    const heavy = climb(serratedDef, 0.7)
    const light = climb(serratedDef, 0.15)
    // The grip term scales with T, and the binding pinch does too — light tension must win by
    // more for a serrated pin than the pinch alone explains for a standard one.
    const heavyPlain = climb(standardDef, 0.7)
    const lightPlain = climb(standardDef, 0.15)
    expect(light / heavy).toBeGreaterThan(lightPlain / heavyPlain)
  })

  it('a spool is not a grind — one groove is a wall, and walls have their own mechanics', () => {
    const spoolDef: LockDef = {
      ...base,
      id: 992,
      slug: 'test-spool-trio',
      name: 'spool trio',
      pins: ['spool', 'spool', 'spool'],
    }
    const plain = climb(standardDef, 0.45)
    const spool = climb(spoolDef, 0.45)
    // The grind gate is grooveCount >= 3; a spool's single waist must not trip it.
    expect(spool / plain).toBeGreaterThan(0.9)
  })
})
