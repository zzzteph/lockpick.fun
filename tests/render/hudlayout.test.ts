/**
 * Where the chrome sits — the arithmetic behind `drawHud`, checked without a canvas.
 *
 * A screenshot test proves the page is not blank; it does not prove the clock is inside the header
 * or that the rank ladder is clear of the lock. Both of those are pure arithmetic over the same
 * constants the renderer uses, so they can be asserted directly — which is the only way this stays
 * true as chamber counts, assist levels and pin-dot modes change underneath it.
 */

import { describe, expect, it } from 'vitest'
import { RANKS } from '../../src/game/ranks'
import { PAUSE_PAD, WITHDRAW_PAD, WRENCH_SLIDER } from '../../src/ui/touch'
import { MAX_CHAMBERS, MIN_CHAMBERS } from '../../src/sim'
import { TYPE } from '../../src/render/palette'
import { SHEAR_Y, assemblyBounds, computeLayout } from '../../src/render/layout'
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../src/render/viewport'

// Mirrors `hud.ts`. Kept here rather than exported so the test fails if the renderer drifts from
// its own stated layout, instead of silently following it.
const MARGIN = 24
const HEADER_H = 64
// Three rows since the key legend moved to the left gutter (D-115).
const FOOTER_H = 124
const DOT_GAP = 22
const RANK_SIZE = TYPE.rank
const dotsRight = LOGICAL_WIDTH - MARGIN - 24

function clockRightEdge(chamberCount: number, dotsShown: boolean): number {
  const n = dotsShown ? chamberCount : 0
  return n > 0 ? dotsRight - (n - 1) * DOT_GAP - 44 : dotsRight
}

describe('the header', () => {
  it('keeps the clock inside the frame at every chamber count', () => {
    for (let n = MIN_CHAMBERS; n <= MAX_CHAMBERS; n += 1) {
      for (const dots of [true, false]) {
        const right = clockRightEdge(n, dots)
        expect(right, `n=${n} dots=${dots}`).toBeLessThanOrEqual(LOGICAL_WIDTH - MARGIN)
        expect(right, `n=${n} dots=${dots}`).toBeGreaterThan(LOGICAL_WIDTH / 2)
      }
    }
  })

  it('leaves the clock clear of the pin dots', () => {
    for (let n = MIN_CHAMBERS; n <= MAX_CHAMBERS; n += 1) {
      const leftmostDot = dotsRight - (n - 1) * DOT_GAP
      expect(clockRightEdge(n, true), `n=${n}`).toBeLessThan(leftmostDot)
    }
  })

  it('hiding the dots does not push the clock off the edge', () => {
    // The bug this exists for: `-(0 - 1) * dotGap` put the clock 22px past the right margin in
    // Blind and Expert, which is exactly where nobody was looking.
    expect(clockRightEdge(5, false)).toBeLessThanOrEqual(LOGICAL_WIDTH - MARGIN)
  })
})

describe('the rank letter', () => {
  // Mirrors `hud.ts`: one glyph, centred, in the band between the header and the lock (D-089).
  const bandTop = MARGIN + HEADER_H
  const baseline = bandTop + 88
  const glyphTop = baseline - RANK_SIZE * 0.75
  const glyphBottom = baseline + RANK_SIZE * 0.25

  it('sits below the header rather than inside it', () => {
    expect(glyphTop).toBeGreaterThanOrEqual(bandTop)
  })

  it('clears the lock at every chamber count — it must never cover a pin', () => {
    for (let n = MIN_CHAMBERS; n <= MAX_CHAMBERS; n += 1) {
      const assembly = assemblyBounds(computeLayout(n, 0))
      expect(glyphBottom, `n=${n}`).toBeLessThanOrEqual(assembly.y)
    }
  })

  it('is one letter, not a ladder', () => {
    // The whole point of the change: the readout is a single glyph, so there is exactly one thing
    // to read and it can be big enough to read peripherally.
    expect(RANKS.map((r) => r.letter.length)).toEqual(RANKS.map(() => 1))
    expect(RANK_SIZE).toBeGreaterThan(64)
  })

  it('is centred, so it cannot drift off either edge', () => {
    const halfWidth = RANK_SIZE * 0.7
    expect(LOGICAL_WIDTH / 2 - halfWidth).toBeGreaterThan(MARGIN)
    expect(LOGICAL_WIDTH / 2 + halfWidth).toBeLessThan(LOGICAL_WIDTH - MARGIN)
  })

  it('leaves the clock alone in the top right', () => {
    for (let n = MIN_CHAMBERS; n <= MAX_CHAMBERS; n += 1) {
      const letterRight = LOGICAL_WIDTH / 2 + RANK_SIZE * 0.7
      const clockLeft = clockRightEdge(n, true) - 120
      expect(letterRight, `n=${n}`).toBeLessThan(clockLeft)
    }
  })
})

/**
 * The force and resistance columns, and the captions under them — DECISIONS D-106.
 *
 * The captions were anchored to the columns and right-aligned, which walked them left across the
 * page until they were drawn over the lock: ~367px of type ending at x=1656 against an assembly
 * that reaches x=1536 at six chambers or more. Nothing caught it, because a screenshot test proves
 * the page is not blank and the pixels were all perfectly good pixels — they were just on top of
 * the pins.
 *
 * The arithmetic is the same shape as the rank letter's, so it is asserted the same way: whatever
 * the chamber count, this chrome starts to the right of where the lock ends.
 */
describe('the readout columns', () => {
  // Mirrors `hud.ts`.
  const gutterLeft = (() => {
    const widest = assemblyBounds(computeLayout(MAX_CHAMBERS, 0))
    return widest.x + widest.w + 12
  })()
  const colX = LOGICAL_WIDTH - MARGIN - 110
  const colW = 46
  const forceX = colX - colW - 62

  it('puts the gutter clear of the lock at every chamber count', () => {
    for (let n = MIN_CHAMBERS; n <= MAX_CHAMBERS; n += 1) {
      const assembly = assemblyBounds(computeLayout(n, 0))
      expect(gutterLeft, `n=${n}`).toBeGreaterThanOrEqual(assembly.x + assembly.w)
    }
  })

  it('leaves the captions somewhere to be — the longest word still fits the gutter', () => {
    // The fix is only a fix if the strip it moves the text into can carry the text. `paragraph`
    // wraps on spaces and lets a single over-long *word* overflow rather than chopping it, so the
    // thing that would reach back across the lock is a word wider than the gutter. Measured
    // against the real strings, at a generous monospace advance — 0.65em against Consolas'
    // 0.55 and Cascadia's 0.6 — so this errs toward failing rather than toward passing.
    const captionW = LOGICAL_WIDTH - MARGIN - 8 - gutterLeft
    const advance = TYPE.dimension * 0.65
    const words = ['force — how hard you push', 'resistance — how hard it pushes back']
      .flatMap((s) => s.split(' '))
    for (const w of words) {
      expect(w.length * advance, `"${w}" must fit the gutter`).toBeLessThanOrEqual(captionW)
    }
  })

  it('keeps both columns inside the gutter and inside the frame', () => {
    expect(forceX).toBeGreaterThanOrEqual(gutterLeft)
    expect(colX + colW).toBeLessThanOrEqual(LOGICAL_WIDTH - MARGIN)
    // …and they do not overlap each other.
    expect(forceX + colW).toBeLessThan(colX)
  })

  /**
   * The vertical stack, row by row — DECISIONS D-109.
   *
   * Two rows in this block were drawn on top of each other and neither was caught: the state word
   * put its ascenders through the `resistance` label, and D-106's captions were laid out from
   * `colBottom` into the middle of the bars. Both are pure arithmetic over constants, so both are
   * checkable here. A row needs its own type height clear of the row above it, or it is crowded
   * even when it does not strictly overlap.
   */
  it('gives every row in the readout stack clear air above it', () => {
    // Mirrors `hud.ts`.
    const footerY = LOGICAL_HEIGHT - MARGIN - FOOTER_H
    const colBottom = footerY - 56
    const colH = 270
    const rows: [string, number, number][] = [
      // name, baseline, type size
      ['caption line 1', 452, TYPE.dimension],
      ['caption line 2', 474, TYPE.dimension],
      ['state word', 552, TYPE.body],
      ['numbers', 586, TYPE.heading],
    ]
    for (let i = 1; i < rows.length; i += 1) {
      const [name, y, size] = rows[i] as [string, number, number]
      const [prevName, prevY] = rows[i - 1] as [string, number, number]
      // Ascender of this row must clear the baseline of the one above it.
      expect(y - size * 0.8, `"${name}" crowds "${prevName}"`).toBeGreaterThan(prevY)
    }
    // The last row's descenders must clear the top of the bars.
    const [, numY, numSize] = rows[rows.length - 1] as [string, number, number]
    expect(numY + numSize * 0.25, 'the numbers sit on the bars').toBeLessThan(colBottom - colH)
    // And the whole stack starts below the header band rather than inside it.
    expect(452 - TYPE.dimension * 0.8).toBeGreaterThan(MARGIN + HEADER_H)

    /**
     * Nothing is drawn on the shear line — DECISIONS D-115.
     *
     * The rule runs the full width of the stage at `SHEAR_Y`, so it crosses this gutter. The two
     * captions live above it and every reading below it; a row whose ascenders or descenders reach
     * the datum is struck through by it, which looked exactly as bad as it sounds.
     */
    for (const [name, y, size] of rows) {
      const top = y - size * 0.8
      const bottom = y + size * 0.25
      expect(
        bottom < SHEAR_Y - 6 || top > SHEAR_Y + 6,
        `"${name}" is drawn across the shear line`,
      ).toBe(true)
    }
  })

  it('keeps the labels under the bars clear of the footer', () => {
    const footerY = LOGICAL_HEIGHT - MARGIN - FOOTER_H
    const labelY = footerY - 56 + 26
    expect(labelY + TYPE.dimension * 0.25, 'the labels run into the footer panel').toBeLessThan(
      footerY,
    )
  })
})

/**
 * The footer's caption row — the one at `footerY + 76`, which has three tenants.
 *
 * D-101 found the broken-pick message running through the plug meter here, and the fix was to
 * assign each tenant a start x and keep the strings short enough to stay inside it. That is an
 * arrangement held together by three string literals in two files, and nothing was checking it.
 * D-107 added a fourth string to the row — the wrench prompt, which replaces tension's caption
 * while the wrench is off — so it is checked now.
 */
describe('the footer caption row', () => {
  // Mirrors `hud.ts` and the strings `app.ts` passes in.
  const leftX = MARGIN + 32
  const meterW = 320
  const strainX = leftX + meterW + 230
  const plugX = LOGICAL_WIDTH / 2 + 40
  const advance = TYPE.dimension * 0.65 + TYPE.dimension * 0.08

  const tensionRow = [
    'past the notch, set pins hold while you work',
    'hold [Q] — nothing works without the wrench',
    'slide the wrench up the left edge first',
  ]

  it('keeps every caption inside its own column', () => {
    for (const s of tensionRow) {
      expect(leftX + s.length * advance, `"${s}" runs into the strain hint`).toBeLessThan(strainX)
    }
    for (const s of ['press [R] for a fresh pick', 'tap pause, then restart']) {
      expect(strainX + s.length * advance, `"${s}" runs into the plug meter`).toBeLessThan(plugX)
    }
  })

  it('keeps the plug caption inside the frame', () => {
    const s = 'how far it has turned — past the notch it opens'
    expect(plugX + s.length * advance).toBeLessThan(LOGICAL_WIDTH - MARGIN)
  })

  it('keeps the wrench heading clear of the strain label beside it', () => {
    // The heading row is `footerY + 32`, which it shares with the strain block at `strainX` — the
    // step number and the 0..1 value sit a row *below* it at +60, beyond the meter, and are not
    // its neighbours. `tension wrench — pressure 10 of 10` is the longest it gets (D-107).
    const heading = 'tension wrench — pressure 10 of 10'
    expect(leftX + heading.length * advance).toBeLessThan(strainX)
  })
})

/**
 * The key legend, down the left gutter — DECISIONS D-115.
 *
 * It moved out of the footer because a row of seven caps and seven phrases along the bottom of the
 * busiest strip on the page reads as prose and nobody was reading it. A column has the opposite
 * failure mode: it is bounded by the *lock*, which grows to the left as the chamber count rises,
 * and the longest label is the one that finds that out. `wrench pressure, 1 to 10` reached x=480
 * against an assembly starting at x=384.
 */
describe('the key legend', () => {
  // Mirrors `drawKeyLegend`.
  const x = MARGIN + 16
  const ROW = 34
  const top = MARGIN + HEADER_H + 52
  const capAdvance = TYPE.body * 0.65
  const labelAdvance = TYPE.body * 0.65 + TYPE.body * 0.08

  // The keyboard set, at its longest — Training carries the extra `fine lift` row (D-111).
  const KEYS: [string, string][] = [
    ['← →', 'move'],
    ['space', 'lift'],
    ['↑ ↓', 'fine lift'],
    ['Q', 'tension wrench'],
    ['1-0', 'wrench pressure'],
    ['R', 'restart'],
    ['esc', 'pause'],
  ]
  const capW = Math.max(30, ...KEYS.map(([k]) => k.length * capAdvance + 20))
  const widest = Math.max(...KEYS.map(([, what]) => what.length * labelAdvance))
  const right = x + capW + 14 + widest

  it('clears the lock at every chamber count', () => {
    for (let n = MIN_CHAMBERS; n <= MAX_CHAMBERS; n += 1) {
      const assembly = assemblyBounds(computeLayout(n, 0))
      expect(right, `n=${n}: the legend runs into the lock`).toBeLessThan(assembly.x)
    }
  })

  it('sits below the header and stops short of the rotation gauge', () => {
    expect(top - TYPE.body * 0.8).toBeGreaterThan(MARGIN + HEADER_H)
    // The gauge is the plug seen end-on, down at the keyway. `SHEAR_Y` is a safe floor for the
    // list: everything in the lower-left gutter belongs to the gauge.
    expect(top + KEYS.length * ROW).toBeLessThan(SHEAR_Y)
  })

  it('is a column, so every label starts at the same x', () => {
    // The whole reason it works as a list rather than as prose. A per-cap width would ragged the
    // second column and turn a scan back into a read.
    expect(capW).toBeGreaterThanOrEqual(30)
    for (const [k] of KEYS) expect(k.length * capAdvance + 20).toBeLessThanOrEqual(capW)
  })
})

describe('the touch controls', () => {
  it('sit in the gutter, clear of the lock at every chamber count', () => {
    for (let n = MIN_CHAMBERS; n <= MAX_CHAMBERS; n += 1) {
      const assembly = assemblyBounds(computeLayout(n, 0))
      for (const r of [WRENCH_SLIDER, WITHDRAW_PAD, PAUSE_PAD]) {
        expect(r.x + r.w, `n=${n}`).toBeLessThanOrEqual(assembly.x)
      }
    }
  })

  it('do not overlap the header, which has its own tap targets', () => {
    for (const r of [WRENCH_SLIDER, WITHDRAW_PAD, PAUSE_PAD]) {
      expect(r.y).toBeGreaterThanOrEqual(MARGIN + HEADER_H)
    }
  })

  it('do not overlap the footer', () => {
    const footerTop = LOGICAL_HEIGHT - MARGIN - 116
    for (const r of [WRENCH_SLIDER, WITHDRAW_PAD, PAUSE_PAD]) {
      expect(r.y + r.h).toBeLessThanOrEqual(footerTop)
    }
  })
})
