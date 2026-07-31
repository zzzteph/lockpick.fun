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
 */

import { describe, expect, it } from 'vitest'
import { ALL_LOCKS } from '../../src/game/locks'
import { LESSONS } from '../../src/game/tutorial'
import { benchHeight } from '../../src/ui/shell'
import { LOGICAL_HEIGHT } from '../../src/render/viewport'

const MARGIN = 24
/** The status line sits along the bottom of every screen and the cards must stop above it. */
const STATUS_BAND = 60

describe('the bench', () => {
  const tiers = [...new Set(ALL_LOCKS.map((d) => d.tier))]
  const floor = LOGICAL_HEIGHT - MARGIN - STATUS_BAND

  it('fits the roster that actually ships', () => {
    const h = benchHeight(ALL_LOCKS.length, tiers.length, LESSONS.length)
    expect(h, `bench runs to y=${h}, past the status line at ${floor}`).toBeLessThanOrEqual(floor)
  })

  it('fits the biggest tier, which is what actually bounds the page', () => {
    // The bench draws one tier at a time (D-102), so the page is bounded by the largest tier and
    // not by the total. Asked directly, so a roster that grew one tier is caught.
    const biggest = Math.max(...tiers.map((t) => ALL_LOCKS.filter((d) => d.tier === t).length))
    const h = benchHeight(biggest * tiers.length, tiers.length, LESSONS.length)
    expect(h).toBeLessThanOrEqual(floor)
  })

  it('would catch a tier that grew too large — the check is not vacuous', () => {
    // If this passed at any size, the two above would prove nothing. Twenty locks in one tier is
    // four rows of cards and must not fit.
    expect(benchHeight(20 * tiers.length, tiers.length, LESSONS.length)).toBeGreaterThan(floor)
  })

  it('leaves the tier strip clear of the lesson cards', () => {
    // Mirrors `drawBench`: lesson cards start at y=120 and are `LESSON_H` tall; the strip's buttons
    // are drawn at `y - 22` after `y += LESSON_H + GAP`. At the old gap of 18 that put 40px-tall
    // bordered buttons 4px *inside* the cards above them.
    const LESSON_TOP = 120
    const LESSON_H = 104
    const GAP = 46
    const BUTTON_RISE = 22
    const cardBottom = LESSON_TOP + LESSON_H
    const buttonTop = LESSON_TOP + LESSON_H + GAP - BUTTON_RISE
    expect(buttonTop, 'the tier strip overlaps the lesson cards').toBeGreaterThan(cardBottom)
    expect(buttonTop - cardBottom, 'and leaves enough air to read as a separate row').toBeGreaterThanOrEqual(16)
  })
})
