/**
 * The colourblind channel, asserted — DECISIONS D-135.
 *
 * `ART_DIRECTION.md §1` says no state is ever encoded in hue alone, and `STATE_PATTERN` exists to
 * make that true: every chamber state carries a fill pattern as well as a colour. The map is wired
 * into the cutaway and **nothing had ever tested it**, which in this codebase is the exact shape of
 * a guarantee that quietly stops being true — a state added to `stateColor` and forgotten here
 * would be distinguishable by hue and nothing else, and would look perfectly fine to everyone who
 * could see the hue.
 *
 * What these assert is chosen from what the drawing actually does, not from what is easy to measure.
 * A pin is a filled shape **with an ink outline**, drawn in a bore in the shell or the plug — so
 * the boundary WCAG 1.4.11 asks about is the outline (11:1), the ground is the body (not the
 * panel), and the fill's job is to say *which state*, which is the job the pattern channel
 * duplicates.
 */

import { describe, expect, it } from 'vitest'
import {
  BLUEPRINT,
  DRAFTING,
  STATE_PATTERN,
  contrastRatio,
  relativeLuminance,
  stateColor,
  type Palette,
  type StateKey,
} from '../../src/render/palette'

const STATES: StateKey[] = ['free', 'binding', 'set', 'overset', 'falseSet']
const MARKED = STATES.filter((s) => s !== 'free')

/** The surfaces a pin is actually drawn against. */
function grounds(p: Palette): string[] {
  return [p.shellBody, p.plugBody]
}

describe('no state is carried by colour alone', () => {
  it('every state the palette can colour also has a pattern', () => {
    for (const s of STATES) expect(STATE_PATTERN[s], `${s} has no fill pattern`).toBeDefined()
    // Exhaustive both ways: a state added to one map and not the other is the drift this guards.
    expect(Object.keys(STATE_PATTERN).sort()).toEqual([...STATES].sort())
  })

  it('the four states that mean something are told apart by pattern', () => {
    // `free` is the absence of a state and draws no fill, which is itself the distinction.
    const patterns = MARKED.map((s) => STATE_PATTERN[s])
    expect(new Set(patterns).size, 'two states share a fill pattern').toBe(MARKED.length)
    for (const p of patterns) expect(p).not.toBe('none')
  })

  /**
   * The load-bearing one.
   *
   * Two states that are close in **lightness** are exactly the pair a colourblind player is at risk
   * of confusing, because lightness is what survives when hue does not. Those pairs are allowed —
   * the palette has them — but only if the pattern channel separates them. Measured rather than
   * assumed: `binding` (amber) against a pin at rest (steel) is 1.09, and `falseSet` (violet)
   * against `overset` (crimson) is 1.11. Both are effectively the same lightness, and both are
   * distinguishable only because one is solid and the other is not.
   *
   * So this is the assertion that stops somebody "simplifying" the patterns away.
   */
  it('any two states of the same lightness are separated by pattern', () => {
    for (const palette of [DRAFTING, BLUEPRINT]) {
      for (let i = 0; i < MARKED.length; i += 1) {
        for (let j = i + 1; j < MARKED.length; j += 1) {
          const a = MARKED[i]!
          const b = MARKED[j]!
          const la = relativeLuminance(stateColor(palette, a))
          const lb = relativeLuminance(stateColor(palette, b))
          const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
          if (ratio >= 1.3) continue
          expect(
            STATE_PATTERN[a],
            `${palette.name}: ${a} and ${b} are the same lightness AND the same pattern`,
          ).not.toBe(STATE_PATTERN[b])
        }
      }
    }
  })

  it('a pin is always visible: its outline clears the boundary rule on both bodies', () => {
    for (const palette of [DRAFTING, BLUEPRINT]) {
      for (const ground of grounds(palette)) {
        // WCAG 1.4.11 asks 3:1 for the boundary of a graphical object. The outline is that boundary,
        // which is why the fill is free to carry state instead of contrast.
        expect(
          contrastRatio(palette.ink, ground),
          `${palette.name}: a pin's outline against ${ground}`,
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('and every state fill is a different material from the body it sits in', () => {
    for (const palette of [DRAFTING, BLUEPRINT]) {
      for (const s of MARKED) {
        for (const ground of grounds(palette)) {
          // Not the 3:1 boundary rule — the outline does that. This only asks that a filled pin
          // does not read as an empty one.
          expect(
            contrastRatio(stateColor(palette, s), ground),
            `${palette.name}: ${s} is invisible against ${ground}`,
          ).toBeGreaterThan(1.5)
        }
      }
    }
  })
})
