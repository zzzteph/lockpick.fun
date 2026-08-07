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

  /**
   * The bench's pages, exactly as `drawBench` deals them since D-167: each tier page holds its
   * *cylinders*, and the wheel locks are a page of their own. What bounds the layout is the
   * biggest single page — a page is what is on screen at once (D-102).
   */
  const pages = [
    ...tiers.map((t) => ALL_LOCKS.filter((d) => d.tier === t && d.family !== 'combination').length),
    ALL_LOCKS.filter((d) => d.family === 'combination').length,
  ]
  const biggest = Math.max(...pages)

  it('fits every page the roster actually deals — tier pages and the wheels shelf', () => {
    const h = benchHeight(biggest * tiers.length, tiers.length)
    expect(h, `bench runs to y=${h}, past the status line at ${floor}`).toBeLessThanOrEqual(floor)
  })

  it('holds the page size the card was designed for — a tier page never exceeds six', () => {
    // The D-097 card is sized so that six cards fit and seven do not. A lock added to a tier
    // must go to a new page (the wheels shelf is that, for the second family) — this is what
    // fails first when someone drops a 26th lock into a tier instead.
    expect(biggest).toBeLessThanOrEqual(6)
  })

  it('would catch a tier that grew too large — the check is not vacuous', () => {
    // If this passed at any size, the two above would prove nothing. Twenty locks in one tier is
    // four rows of cards and must not fit.
    expect(benchHeight(20 * tiers.length, tiers.length)).toBeGreaterThan(floor)
  })

  /**
   * The compact bench is a different shape, and it is the one that nearly did not fit — D-123.
   * Two columns turns a six-lock page into three rows of taller-typed cards.
   */
  it('fits on a phone, where it is two columns and three rows', () => {
    const h = benchHeight(biggest * tiers.length, tiers.length, true)
    expect(h, `compact bench runs to y=${h}, past the status line at ${floor}`).toBeLessThanOrEqual(
      floor,
    )
  })
})
