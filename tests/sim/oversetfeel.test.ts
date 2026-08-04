/**
 * An overset chamber's jam is felt on contact, not at a distance — D-158.
 *
 * The key pin is pinched across the shear line with the bore below it empty (D-094). The
 * resistance read used to say `RESIST_OVERSET` plus the full spring-compression term the moment
 * the tip was merely *under* the chamber — reported from play: *"when you press on a key pin
 * which was not lifted yet to the driver pin — it still shows the resistance. Which should
 * not."* The reading now closes like the SET case's: light across the empty bore, the full
 * jammed read as the tip reaches the stack's underside.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_OVERLIFT,
  PERFECT_TOOLS,
  createSimState,
  falseSetLifts,
  makeConfig,
  type LockDef,
  type SimState,
} from '../../src/sim'
import { holdFor, pick, tensionOnly } from './fixtures'

const CONFIG = makeConfig({ tools: PERFECT_TOOLS, featherEnabled: false })

/** Tight enough to genuinely jam — the tutorial's overset lock, in miniature. */
const TIGHT: LockDef = {
  id: 993,
  slug: 'test-overset-feel',
  name: 'overset feel',
  tier: 1,
  family: 'pin-tumbler',
  bitting: [3.4, 2.9, 4.1],
  pins: ['standard', 'standard', 'standard'],
  toleranceQuality: 0.55,
  keyway: 'standard',
  par: 90,
  note: '',
}

/** Jam the binding chamber and return the sim with the pick still on it. */
function jam(): { s: SimState; chamber: number } {
  const s = createSimState(TIGHT, 5, CONFIG)
  holdFor(s, tensionOnly(0.15), 0.3)
  const b = s.bindingChamber
  const c = s.chambers[b]
  if (!c) throw new Error('nothing binding')
  holdFor(s, pick(b, c.setLift + MAX_OVERLIFT, 0.15), 1.2)
  const jammed = s.chambers[b]
  if (jammed?.state !== 'OVERSET') throw new Error(`did not jam: ${jammed?.state}`)
  return { s, chamber: b }
}

describe('the jam is felt on contact', () => {
  it('reads light while the tip is below the jammed stack, and full on contact', () => {
    const { s, chamber } = jam()
    const c = s.chambers[chamber]
    if (!c) throw new Error('no chamber')

    // Mid-bore: the tip is well under the jammed key pin. Nothing is under the hand but air —
    // no load, no reading, and no state word (`pickContact` is what the HUD's word hangs off).
    holdFor(s, pick(chamber, Math.max(0, c.keyLift - 1.2), 0.15), 0.3)
    const below = s.resistance
    const contactBelow = s.pickContact

    // At the stack's underside: now you are genuinely pushing a jammed pin.
    holdFor(s, pick(chamber, c.keyLift + 0.1, 0.15), 0.3)
    const touching = s.resistance

    expect(below).toBeLessThan(0.1)
    expect(contactBelow).toBeLessThan(0.05)
    expect(touching).toBeGreaterThan(0.6)
    expect(touching - below).toBeGreaterThan(0.5)
  })

  it('a loose key pin under a false-set driver reads light until it reaches it', () => {
    // The general rule the overset case was one instance of: any split stack — here a spool
    // parked in its waist with the key pin dropped away below — is nearly free to lift until
    // the key pin's top meets the trapped driver's bottom.
    const spoolDef: LockDef = {
      ...TIGHT,
      id: 994,
      slug: 'test-false-set-feel',
      name: 'false set feel',
      bitting: [3.2],
      pins: ['spool'],
      toleranceQuality: 1.2,
    }
    const s = createSimState(spoolDef, 4, CONFIG)
    holdFor(s, tensionOnly(0.45), 0.3)
    const c = s.chambers[0]
    if (!c) throw new Error('no chamber')
    // Into the waist: lift to the groove and let the ledge drop in.
    holdFor(s, pick(0, (falseSetLifts(c)[0] ?? 0) + 0.1, 0.45), 0.8)
    if (c.state !== 'FALSE_SET') throw new Error(`not false set: ${c.state}`)

    // Withdraw the hand; the driver stays parked, the key pin falls away.
    holdFor(s, pick(0, 0, 0.45), 0.5)
    expect(c.state).toBe('FALSE_SET')
    // A spool's waist sits low, so the whole gap is under half a millimetre — which is exactly
    // why the read has to ramp over `SET_CONTACT_MM` rather than switch.
    expect(c.lift - c.keyLift).toBeGreaterThan(0.3)

    // Carrying the loose key pin mid-bore: light.
    holdFor(s, pick(0, Math.max(0, c.lift - 1.0), 0.45), 0.3)
    const below = s.resistance

    // Key pin against the trapped driver: the full false-set read arrives.
    holdFor(s, pick(0, c.lift - 0.02, 0.45), 0.3)
    const touching = s.resistance

    expect(below).toBeLessThan(0.3)
    expect(touching - below).toBeGreaterThan(0.15)
  })

  it('still reports the jam once contact is made — the tell survives the fix', () => {
    const { s, chamber } = jam()
    const c = s.chambers[chamber]
    if (!c) throw new Error('no chamber')
    holdFor(s, pick(chamber, c.keyLift + 0.2, 0.15), 0.3)
    // The overset read is the strongest non-wobbling read in the game; on contact it must
    // still dominate an ordinary binding pin's.
    expect(s.resistance).toBeGreaterThan(0.6)
  })
})
