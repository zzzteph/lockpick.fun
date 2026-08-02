/**
 * The codes roster fits the page it is drawn on — DECISIONS D-147.
 *
 * Twenty cards, five to a row, is four rows of 162px, and that clears the status line only while
 * you have no designs of your own. Save one and the page grows a heading, a row of cards and their
 * gaps — 136px — and the roster's last row is drawn through the footer. Reported from play as *"the
 * codes screen is very overwhelmed — there are 20 locks, and they overlap with the footer."*
 *
 * The rows are measured against the page rather than chosen, so these are the two things that have
 * to hold: what is drawn always fits, and everything stays reachable. The pager directly above this
 * one on the same screen shipped with a count that disagreed with its own drawing, which made
 * sixteen locks unreachable (D-136) — so reachability is asserted, not assumed.
 */

import { describe, expect, it } from 'vitest'
import { ALL_LOCKS } from '../../src/game/locks'
import { codesRoster } from '../../src/ui/shell'
import { LOGICAL_HEIGHT } from '../../src/render/viewport'

/** Mirrors `drawCodes`: the page's own floor, below which the status line lives. */
const FLOOR = LOGICAL_HEIGHT - 24 - 40
const CARD_H = 150
const GAP = 12

describe('the roster is paged to what the page has left', () => {
  for (const saved of [0, 1, 5, 40]) {
    it(`fits above the status line with ${saved} designs saved`, () => {
      const rs = codesRoster(saved)
      const bottom = rs.top + rs.rows * (CARD_H + GAP)
      expect(bottom, `the last row is drawn ${Math.ceil(bottom - FLOOR)}px into the footer`).toBeLessThanOrEqual(
        FLOOR,
      )
    })
  }

  it('is still one page of twenty for a player with no designs', () => {
    // The fix must not page a screen that was fitting perfectly well.
    const rs = codesRoster(0)
    expect(rs.pages).toBe(1)
    expect(rs.perPage).toBeGreaterThanOrEqual(rs.total)
  })

  it('pages as soon as your own row pushes it down', () => {
    expect(codesRoster(1).pages).toBeGreaterThan(1)
    expect(codesRoster(1).top).toBeGreaterThan(codesRoster(0).top)
  })

  it('every shareable lock is reachable on some page', () => {
    /*
     * The D-136 property. A pager whose count is short of its list does not look broken — the
     * arrow is drawn, and enabled, and simply stops advancing before the end.
     */
    for (const saved of [0, 1, 5, 40]) {
      const rs = codesRoster(saved)
      expect(rs.pages * rs.perPage, `${saved} designs`).toBeGreaterThanOrEqual(rs.total)
      // ...and no page is empty, which would be an arrow that goes nowhere.
      expect((rs.pages - 1) * rs.perPage).toBeLessThan(rs.total)
    }
  })

  it('counts exactly the locks that have a code', () => {
    expect(codesRoster(0).total).toBeLessThan(ALL_LOCKS.length)
    expect(codesRoster(0).total).toBeGreaterThan(0)
  })
})
