/**
 * The bench fits on the page — DECISIONS D-109.
 *
 * `benchHeight` was written in Phase 14 for exactly this test, after the roster grew from 27 locks
 * to 35 and pushed three tiers off the bottom of the stage, where they were not merely ugly but
 * **unclickable**, because the bench does not scroll. Every test passed at the time: the solver
 * loads locks by id, the playthrough loads them by id, and the blank-canvas check was perfectly
 * happy with a page full of ink.
 *
 * The test was never written. The helper has sat exported and called by nothing ever since —
 * present, plausible, and inert, which is this project's own stated failure mode. It is called
 * now.
 *
 * The lesson strip is gone from these sums (D-152): the lessons live on their own Tutorial
 * screen, so the bench is bounded by the tier strip and the largest tier alone.
 */

import { describe, expect, it } from 'vitest'
import { ALL_LOCKS } from '../../src/game/locks'
import { benchHeight } from '../../src/ui/shell'
import { LOGICAL_HEIGHT } from '../../src/render/viewport'

const MARGIN = 24
/** The status line sits along the bottom of every screen and the cards must stop above it. */
const STATUS_BAND = 60

describe('the bench', () => {
  const tiers = [...new Set(ALL_LOCKS.map((d) => d.tier))]
  const floor = LOGICAL_HEIGHT - MARGIN - STATUS_BAND

  it('fits the roster that actually ships', () => {
    const h = benchHeight(ALL_LOCKS.length, tiers.length)
    expect(h, `bench runs to y=${h}, past the status line at ${floor}`).toBeLessThanOrEqual(floor)
  })

  it('fits the biggest tier, which is what actually bounds the page', () => {
    // The bench draws one tier at a time (D-102), so the page is bounded by the largest tier and
    // not by the total. Asked directly, so a roster that grew one tier is caught.
    const biggest = Math.max(...tiers.map((t) => ALL_LOCKS.filter((d) => d.tier === t).length))
    const h = benchHeight(biggest * tiers.length, tiers.length)
    expect(h).toBeLessThanOrEqual(floor)
  })

  it('would catch a tier that grew too large — the check is not vacuous', () => {
    // If this passed at any size, the two above would prove nothing. Twenty locks in one tier is
    // four rows of cards and must not fit.
    expect(benchHeight(20 * tiers.length, tiers.length)).toBeGreaterThan(floor)
  })

  /**
   * The compact bench is a different shape, and it is the one that nearly did not fit — D-123.
   * Two columns turns a six-lock tier into three rows of taller-typed cards.
   */
  it('fits on a phone, where it is two columns and three rows', () => {
    const h = benchHeight(ALL_LOCKS.length, tiers.length, true)
    expect(h, `compact bench runs to y=${h}, past the status line at ${floor}`).toBeLessThanOrEqual(
      floor,
    )
  })
})
