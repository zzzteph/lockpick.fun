/**
 * The shaft behind the hook is under the pins in front of it — DECISIONS D-145.
 *
 * D-138 gave the hook its crest while the pick is *travelling*. This is the other half, and it
 * applies while the pick is standing still: a pick is a straight tool pivoting about the hand, so
 * lifting a pin higher than the hook is tall raises the shaft behind it — and that shaft is under
 * every pin between there and the keyway mouth.
 *
 * Reported from play as *"when you press the deepest pin, the handle can overlap with the first
 * pins"*. The drawing was right and the simulation was holding those pins at rest while a rigid tool
 * was drawn straight through them.
 *
 * Both halves are pinned here, because the second is what keeps it fair: below the hook's own rise
 * nothing is touched at all, and the deepest cut in the roster asks for 2.30mm.
 */

import { describe, expect, it } from 'vitest'
import {
  HOOK_RISE,
  PERFECT_TOOLS,
  SHAFT_HALF,
  createSimState,
  shankLift,
  type SimState,
} from '../../src/sim'
import { FIVE_PIN, configWith, holdFor, pick } from './fixtures'

/** Travel to a chamber with the hand down, then lift it and hold. Peak of every other chamber. */
function peaksAfterLifting(chamber: number, liftMm: number): number[] {
  const s: SimState = createSimState(FIVE_PIN, 1, configWith(PERFECT_TOOLS))
  holdFor(s, pick(chamber, 0, 0.2), 0.6)
  const peak = s.chambers.map((c) => c.keyLift)
  for (let i = 0; i < 60; i += 1) {
    holdFor(s, pick(chamber, liftMm, 0.2), 0.03)
    s.chambers.forEach((c, idx) => {
      peak[idx] = Math.max(peak[idx] ?? 0, c.keyLift)
    })
  }
  return peak
}

describe('the shank reaches the pins in front of the hook', () => {
  it('lifts them once the pin is pushed higher than the hook is tall', () => {
    const before = peaksAfterLifting(4, HOOK_RISE * 0.5)
    const after = peaksAfterLifting(4, HOOK_RISE + 1.2)
    const moved = [0, 1, 2, 3].filter((i) => (after[i] ?? 0) > (before[i] ?? 0) + 0.05)
    expect(moved.length, `chambers the shank disturbed: [${moved.join(',')}]`).toBeGreaterThan(0)
  })

  it('touches nothing at all below the shaft s own bearing height', () => {
    /*
     * `HOOK_RISE - SHAFT_HALF` — 1.84mm, not 2.3.
     *
     * A pin rests on the **top edge** of the steel, and D-149 corrected the simulation to say so:
     * contact begins half a thickness earlier than it did when this was measured to the shaft's
     * centreline. That is the honest number, and it is the one that matches the drawing.
     */
    const rest = peaksAfterLifting(4, 0)
    for (const lift of [0.8, 1.5, HOOK_RISE - SHAFT_HALF - 0.05]) {
      const peak = peaksAfterLifting(4, lift)
      for (const i of [0, 1, 2, 3]) {
        expect(peak[i] ?? 0, `chamber ${i} moved at ${lift.toFixed(2)}mm`).toBeLessThanOrEqual(
          (rest[i] ?? 0) + 0.02,
        )
      }
    }
  })

  it('and the deepest cut in the roster only ever grazes its neighbour', () => {
    /*
     * The balance claim, now that contact starts at 1.84mm rather than 2.3. Locks ask for at most
     * 2.30mm of lift, which does reach the shaft — but by a fraction of a millimetre, at the one
     * chamber next door, and nowhere near the capture window of anything. The measured difficulty
     * curve is unchanged either side of this correction: 2.50 / 6.17 / 10.03 / 19.68.
     */
    for (let i = 0; i < 4; i += 1) {
      expect(shankLift(2.3, 4, i), `chamber ${i} at the roster s deepest cut`).toBeLessThan(0.3)
    }
    expect(shankLift(2.3, 4, 3), 'the neighbour should be the one that feels it').toBeGreaterThan(0)
  })

  it('reaches the neighbour hardest and the far pins least, as a falling shaft must', () => {
    // The shaft drops away toward the mouth, so the pin that suffers is the one next door — not,
    // as it first appeared from play, the front of the lock.
    const rest = peaksAfterLifting(4, 0)
    const peak = peaksAfterLifting(4, HOOK_RISE + 1.5)
    const gained = [0, 1, 2, 3].map((i) => (peak[i] ?? 0) - (rest[i] ?? 0))
    expect(gained[3]!, 'the neighbour should take the most').toBeGreaterThanOrEqual(gained[0]!)
  })

  it('never drives a chamber past its own ceiling', () => {
    const s = createSimState(FIVE_PIN, 1, configWith(PERFECT_TOOLS))
    holdFor(s, pick(4, 0, 0.2), 0.6)
    holdFor(s, pick(4, 6, 0.2), 2.0)
    for (const c of s.chambers) {
      expect(c.lift, `chamber ${c.index}`).toBeLessThanOrEqual(c.maxLift + 1e-6)
    }
  })
})
