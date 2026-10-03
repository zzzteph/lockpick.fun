import { describe, expect, it } from 'vitest'
import {
  COMPACT_SCALE,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  clientToLogical,
  deviceScale,
  isCompact,
  snapX,
  snapY,
  syncViewport,
  type Viewport,
} from '../../src/render/viewport'

/**
 * A viewport with a stand-in canvas. `syncViewport` only reads `getBoundingClientRect` and
 * writes `width`/`height`, so the maths — letterboxing, DPR sizing, half-pixel snapping —
 * is testable headlessly. The drawing itself is verified by screenshot instead
 * (VERIFICATION.md §2).
 */
function fakeViewport(cssWidth: number, cssHeight: number, dpr: number): Viewport {
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    getBoundingClientRect: () => ({ width: cssWidth, height: cssHeight, left: 0, top: 0 }),
  } as unknown as HTMLCanvasElement
  const vp: Viewport = {
    canvas,
    ctx: {} as CanvasRenderingContext2D,
    cssWidth: 0,
    cssHeight: 0,
    dpr: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    interfaceMode: 'auto',
  }
  syncViewport(vp, dpr)
  return vp
}

describe('viewport sizing — PLATFORM.md §3', () => {
  it('sizes the backing store by devicePixelRatio', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      const vp = fakeViewport(1600, 900, dpr)
      expect(vp.canvas.width).toBe(Math.round(1600 * dpr))
      expect(vp.canvas.height).toBe(Math.round(900 * dpr))
      expect(vp.dpr).toBe(dpr)
    }
  })

  it('fills a 16:9 window with no letterbox', () => {
    const vp = fakeViewport(1600, 900, 1)
    expect(vp.scale).toBeCloseTo(1600 / LOGICAL_WIDTH, 9)
    expect(vp.offsetX).toBeCloseTo(0, 6)
    expect(vp.offsetY).toBeCloseTo(0, 6)
  })

  it('letterboxes without ever distorting', () => {
    const tall = fakeViewport(1000, 1000, 1)
    // Scale is uniform: whichever axis is tighter wins, and the other gets bars.
    expect(tall.scale).toBeCloseTo(1000 / LOGICAL_WIDTH, 9)
    expect(tall.offsetX).toBeCloseTo(0, 6)
    expect(tall.offsetY).toBeGreaterThan(0)
    // Bars are equal top and bottom, to within the whole-device-pixel rounding.
    expect(Math.abs(tall.offsetY * 2 + LOGICAL_HEIGHT * tall.scale - 1000)).toBeLessThanOrEqual(1)

    const wide = fakeViewport(2000, 900, 1)
    expect(wide.scale).toBeCloseTo(900 / LOGICAL_HEIGHT, 9)
    expect(wide.offsetY).toBeCloseTo(0, 6)
    expect(wide.offsetX).toBeGreaterThan(0)
  })

  it('keeps the letterbox offset on a whole device pixel', () => {
    for (const dpr of [1, 1.25, 2]) {
      const vp = fakeViewport(1731, 907, dpr)
      expect((vp.offsetX * dpr) % 1).toBeCloseTo(0, 9)
      expect((vp.offsetY * dpr) % 1).toBeCloseTo(0, 9)
    }
  })

  it('reports no change when nothing changed', () => {
    const vp = fakeViewport(1600, 900, 1)
    expect(syncViewport(vp, 1)).toBe(false)
    expect(syncViewport(vp, 2)).toBe(true)
  })

  it('never produces a zero-sized backing store', () => {
    const vp = fakeViewport(0, 0, 1)
    expect(vp.canvas.width).toBeGreaterThan(0)
    expect(vp.canvas.height).toBeGreaterThan(0)
  })
})

describe('half-pixel snapping — ART_DIRECTION.md §8', () => {
  /**
   * The invariant is stated in *device* pixels, because that is where shimmer happens: a
   * stroke whose rendered width is an odd number of device pixels must be centred on a
   * half-pixel, and an even one on a whole pixel. A "1px" logical hairline is 0.83 device px
   * at 1600x900 and 1.67 at dpr 2 — odd and even respectively — so the rule has to be
   * derived, not assumed from the logical width.
   */
  it('centres a stroke on the boundary its device width requires', () => {
    for (const dpr of [1, 1.5, 2]) {
      for (const [cssW, cssH] of [
        [1600, 900],
        [1920, 1080],
        [1731, 907],
      ] as const) {
        const vp = fakeViewport(cssW, cssH, dpr)
        const s = deviceScale(vp)
        for (const lineWidth of [1, 2, 3]) {
          const deviceWidth = Math.max(1, Math.round(lineWidth * s))
          const wantHalf = deviceWidth % 2 === 1
          for (const x of [100, 100.3, 512.77, 1400.2]) {
            const device = snapX(vp, x, lineWidth) * s + vp.offsetX * dpr
            const frac = Math.abs(device % 1)
            expect(
              wantHalf ? frac : Math.min(frac, 1 - frac),
              `x=${x} lw=${lineWidth} dpr=${dpr} ${cssW}x${cssH}`,
            ).toBeCloseTo(wantHalf ? 0.5 : 0, 9)
          }
          for (const y of [200, 200.4, 513.9]) {
            const device = snapY(vp, y, lineWidth) * s + vp.offsetY * dpr
            const frac = Math.abs(device % 1)
            expect(wantHalf ? frac : Math.min(frac, 1 - frac)).toBeCloseTo(wantHalf ? 0.5 : 0, 9)
          }
        }
      }
    }
  })

  it('moves a coordinate by less than one logical pixel', () => {
    const vp = fakeViewport(1600, 900, 1)
    for (let x = 0; x < 400; x += 7.13) {
      expect(Math.abs(snapX(vp, x, 1) - x)).toBeLessThanOrEqual(1)
      expect(Math.abs(snapY(vp, x, 3) - x)).toBeLessThanOrEqual(1)
    }
  })

  it('is stable: snapping an already-snapped value changes nothing', () => {
    const vp = fakeViewport(1731, 907, 1.25)
    for (const x of [37.2, 512, 900.9]) {
      const once = snapX(vp, x, 1)
      expect(snapX(vp, once, 1)).toBeCloseTo(once, 9)
    }
  })

  it('accounts for the letterbox offset, not just the scale', () => {
    // A viewport with bars: snapping must land on device pixels of the *canvas*, not of
    // the logical stage, or hairlines crawl as the window resizes.
    const vp = fakeViewport(2000, 900, 1)
    expect(vp.offsetX).toBeGreaterThan(0)
    const s = deviceScale(vp)
    const device = snapX(vp, 640, 1) * s + vp.offsetX * vp.dpr
    expect(Math.abs(device % 1)).toBeCloseTo(0.5, 9)
  })
})

describe("compact, full, and the player's say — DECISIONS D-160", () => {
  it('auto keeps the scale rule: phones compact, desks full', () => {
    const phone = fakeViewport(844, 390, 3)
    expect(phone.scale).toBeLessThan(COMPACT_SCALE)
    expect(isCompact(phone)).toBe(true)

    const desk = fakeViewport(1600, 900, 1)
    expect(isCompact(desk)).toBe(false)
  })

  it('exactly the threshold is full, not compact', () => {
    // 1152x648 is COMPACT_SCALE precisely; the boundary belongs to the full page.
    const vp = fakeViewport(1152, 648, 1)
    expect(vp.scale).toBeCloseTo(COMPACT_SCALE, 12)
    expect(isCompact(vp)).toBe(false)
  })

  it('the override beats the heuristic in both directions', () => {
    const phone = fakeViewport(844, 390, 3)
    phone.interfaceMode = 'full'
    expect(isCompact(phone)).toBe(false)

    const desk = fakeViewport(1600, 900, 1)
    desk.interfaceMode = 'compact'
    expect(isCompact(desk)).toBe(true)
  })

  it('auto has no fold-class exception: squarish tablet glass stays compact', () => {
    // A Z Fold inner screen is 0.53 by the scale rule, tablet by any honest measure — and it
    // stays compact anyway, because the full page's smallest face clears MIN_TYPE_CSS only from
    // 0.647 up. A heuristic must not default anyone onto type the audit calls unreadable; the
    // interfaceMode override is how a fold player takes the full page knowingly (D-160).
    for (const [w, h] of [
      [1016, 984], // galaxy-z-fold-7 inner
      [1080, 892], // pixel-9-pro-fold inner
      [1024, 768], // ipad-mini
      [780, 360], // galaxy-s24 landscape
      [390, 844], // portrait phone
    ] as const) {
      const vp = fakeViewport(w, h, 2)
      expect(vp.scale).toBeLessThan(COMPACT_SCALE)
      expect(isCompact(vp), `${w}x${h} should stay compact under auto`).toBe(true)
    }
  })
})

describe('pointer mapping', () => {
  it('inverts the letterbox transform', () => {
    const vp = fakeViewport(2000, 900, 1)
    for (const [lx, ly] of [
      [0, 0],
      [960, 540],
      [1920, 1080],
    ] as const) {
      const clientX = vp.offsetX + lx * vp.scale
      const clientY = vp.offsetY + ly * vp.scale
      const back = clientToLogical(vp, clientX, clientY)
      expect(back.x).toBeCloseTo(lx, 6)
      expect(back.y).toBeCloseTo(ly, 6)
    }
  })
})
