/**
 * The compact type scale, across every phone this is likely to be opened on — DECISIONS D-122.
 *
 * `typeFor` is pure arithmetic over `vp.scale`, so the whole device matrix can be checked here in
 * milliseconds rather than by booting seventeen browsers. What the browser suite adds on top is
 * whether the *layout* survives; what this proves is that nothing is ever drawn too small to read.
 *
 * The viewports are Playwright's own device descriptors, transposed to landscape because that is
 * the orientation the game asks for. They are written out rather than imported so this stays a
 * unit test — and so the numbers are visible when one of them fails.
 */

import { describe, expect, it } from 'vitest'
import { TYPE } from '../../src/render/palette'
import {
  COMPACT_SCALE,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  MIN_TYPE_CSS,
  isCompact,
  typeFor,
  type Viewport,
} from '../../src/render/viewport'

/** Landscape CSS viewport of each device, from `@playwright/test`'s descriptors. */
const PHONES: [string, number, number][] = [
  ['iPhone SE (3rd gen)', 667, 375],
  ['iPhone 12 Mini', 629, 375],
  ['iPhone 13 Mini', 629, 375],
  ['iPhone 13', 664, 390],
  ['iPhone 13 Pro', 664, 390],
  ['iPhone 13 Pro Max', 746, 428],
  ['iPhone 14', 664, 390],
  ['iPhone 14 Pro', 660, 393],
  ['iPhone 14 Pro Max', 740, 430],
  ['iPhone 15', 659, 393],
  ['iPhone 15 Pro', 659, 393],
  ['iPhone 15 Pro Max', 739, 430],
  ['iPhone 16', 659, 393],
  ['iPhone 16 Pro', 681, 402],
  ['iPhone 16 Pro Max', 763, 440],
  ['iPhone 17', 681, 402],
  ['iPhone 17 Pro', 681, 402],
  ['iPhone 17 Pro Max', 763, 440],
  ['Galaxy S8', 740, 360],
  ['Galaxy S9+', 658, 320],
  ['Galaxy S24', 780, 360],
  ['Galaxy Z Flip 7', 764, 360],
  ['Galaxy Z Fold 7', 1016, 984],
  ['Galaxy Tab S9', 1024, 640],
  ['Galaxy Tab S4', 1138, 712],
]

/** Desktop sizes, which must stay on the full layout. */
const DESKTOPS: [string, number, number][] = [
  ['1366x768 laptop', 1366, 768],
  ['1280x800 laptop', 1280, 800],
  ['1440x900', 1440, 900],
  ['1920x1080', 1920, 1080],
  ['2560x1440 (2K)', 2560, 1440],
  ['3440x1440 ultrawide', 3440, 1440],
]

/** Just enough of a Viewport for the pure helpers. */
function vpOf(cssWidth: number, cssHeight: number): Viewport {
  const scale = Math.min(cssWidth / LOGICAL_WIDTH, cssHeight / LOGICAL_HEIGHT)
  return { cssWidth, cssHeight, scale, dpr: 3, offsetX: 0, offsetY: 0 } as unknown as Viewport
}

describe('compact mode covers every phone, and no desktop', () => {
  it.each(PHONES)('%s (%ix%i) is compact', (_name, w, h) => {
    expect(isCompact(vpOf(w, h))).toBe(true)
  })

  it.each(DESKTOPS)('%s (%ix%i) keeps the full layout', (_name, w, h) => {
    expect(isCompact(vpOf(w, h))).toBe(false)
  })

  it('the threshold is where the smallest face stops being readable', () => {
    // A sanity check on the constant rather than a restatement of it: at exactly the threshold,
    // unscaled `TYPE.dimension` is about ten CSS pixels, which is the edge of legible.
    expect(TYPE.dimension * COMPACT_SCALE).toBeGreaterThan(9)
    expect(TYPE.dimension * COMPACT_SCALE).toBeLessThan(11.5)
  })
})

describe('nothing is ever drawn too small to read', () => {
  it.each(PHONES)('%s renders the smallest face at a readable size', (name, w, h) => {
    const vp = vpOf(w, h)
    const cssPx = typeFor(vp, TYPE.dimension) * vp.scale
    expect(cssPx, `${name}: smallest type at ${cssPx.toFixed(1)}px`).toBeGreaterThanOrEqual(
      MIN_TYPE_CSS - 0.5,
    )
  })

  it('would fail if the scale were a flat multiplier — the check is not vacuous', () => {
    // The design this replaced: 1.8x everywhere. On the smallest phone in the matrix it lands
    // under the floor, which is the whole reason the scale is computed per viewport.
    const worst = vpOf(658, 320) // Galaxy S9+
    expect(TYPE.dimension * 1.8 * worst.scale).toBeLessThan(MIN_TYPE_CSS)
    expect(typeFor(worst, TYPE.dimension) * worst.scale).toBeGreaterThanOrEqual(MIN_TYPE_CSS - 0.5)
  })

  it('never inflates type on a desktop', () => {
    for (const [name, w, h] of DESKTOPS) {
      expect(typeFor(vpOf(w, h), TYPE.dimension), name).toBe(TYPE.dimension)
      expect(typeFor(vpOf(w, h), TYPE.clock), name).toBe(TYPE.clock)
    }
  })

  it('is capped, so a tiny viewport cannot produce absurd type', () => {
    // A 320x200 window is not a device anybody has; it is what a resize handle can produce, and
    // the cap is what stops the clock becoming taller than the stage.
    const tiny = vpOf(320, 200)
    expect(typeFor(tiny, TYPE.clock)).toBeLessThanOrEqual(TYPE.clock * 2.4)
  })
})
