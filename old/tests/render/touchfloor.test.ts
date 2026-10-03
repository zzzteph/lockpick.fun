/**
 * The finger floor — DECISIONS D-131.
 *
 * An audit of every interactive rect found exactly one clearing 44 CSS px on a mid-sized phone.
 * These tests pin both halves of the fix: that a near miss lands on the control it was aimed at,
 * and — the part that is easy to get wrong — that overlapping inflated rects still resolve to a
 * single winner, because at a phone's floor neighbours *always* overlap.
 */

import { describe, expect, it } from 'vitest'
import { TOUCH_FLOOR_CSS, touchFloorFor, type Viewport } from '../../src/render/viewport'
import { EMPTY_FRAME, Ui, grown, pointInRect, type Rect, type UiFrame } from '../../src/ui/widgets'

function viewportAtScale(scale: number): Viewport {
  return { scale } as Viewport
}

function tapAt(x: number, y: number): UiFrame {
  return { ...EMPTY_FRAME, pointerX: x, pointerY: y, clicked: true }
}

/** Register the same rects twice — the first pass fills the table the near-miss pass reads. */
function activationsFor(rects: readonly Rect[], frame: UiFrame, floor: number): number[] {
  const ui = new Ui()
  for (let pass = 0; pass < 2; pass += 1) {
    ui.begin(frame, floor)
    const hits: number[] = []
    rects.forEach((r, i) => {
      if (ui.widget(r).activated) hits.push(i)
    })
    ui.end()
    if (pass === 1) return hits
  }
  return []
}

describe('touch floor', () => {
  it('is the phone-sized gap it claims to be', () => {
    // iPhone 13 landscape. 44 CSS px is 122 logical px, which is three times a 40px nav button.
    const floor = touchFloorFor(viewportAtScale(0.361))
    expect(floor).toBeGreaterThan(120)
    expect(floor).toBeLessThan(124)
    expect(floor * 0.361).toBeCloseTo(TOUCH_FLOOR_CSS, 5)
  })

  it('grows a rect about its own centre, and never shrinks one', () => {
    const tier: Rect = { x: 100, y: 200, w: 96, h: 40 }
    const g = grown(tier, 122)
    expect(g.w).toBe(122)
    expect(g.h).toBe(122)
    // Centre preserved: the drawn control does not move, only what answers for it.
    expect(g.x + g.w / 2).toBeCloseTo(tier.x + tier.w / 2, 6)
    expect(g.y + g.h / 2).toBeCloseTo(tier.y + tier.h / 2, 6)

    const card: Rect = { x: 0, y: 0, w: 288, h: 210 }
    expect(grown(card, 122)).toEqual(card)
  })

  it('activates a tier button from a tap that misses it', () => {
    const tier: Rect = { x: 100, y: 200, w: 96, h: 40 }
    // 30 logical px below the button — about 11 CSS px, a thoroughly ordinary thumb error.
    const near = tapAt(148, 268)
    expect(activationsFor([tier], near, 122)).toEqual([0])
  })

  it('leaves a mouse alone', () => {
    const tier: Rect = { x: 100, y: 200, w: 96, h: 40 }
    // The same miss, with the floor off. A cursor that activates what it is merely near is broken.
    expect(activationsFor([tier], tapAt(148, 268), 0)).toEqual([])
  })

  it('fires exactly one of four overlapping neighbours', () => {
    // The bench's tier strip: 96 wide at 108 pitch. Inflated to 122 they all overlap.
    const strip: Rect[] = [0, 1, 2, 3].map((i) => ({ x: 100 + i * 108, y: 200, w: 96, h: 40 }))
    for (let i = 0; i < strip.length; i += 1) {
      const r = strip[i]!
      const hits = activationsFor(strip, tapAt(r.x + r.w / 2, r.y + r.h / 2), 122)
      expect(hits).toEqual([i])
    }
    // And in the gap between two buttons, the nearer centre takes it — still only one.
    const gap = activationsFor(strip, tapAt(202, 220), 122)
    expect(gap).toHaveLength(1)
  })

  it('cancels the near miss entirely when something is hit exactly', () => {
    const card: Rect = { x: 0, y: 0, w: 200, h: 200 }
    const chip: Rect = { x: 220, y: 60, w: 60, h: 60 }
    // (190, 100) is genuinely inside the card, and also inside the chip's *inflated* rect — it is
    // 30px shy of the chip. The card must take it alone: a target you are actually on always wins,
    // or a large control could never be used next to a small one.
    expect(pointInRect(card, 190, 100)).toBe(true)
    expect(pointInRect(chip, 190, 100)).toBe(false)
    expect(pointInRect(grown(chip, 122), 190, 100)).toBe(true)
    expect(activationsFor([card, chip], tapAt(190, 100), 122)).toEqual([0])
  })

  it('ignores a tap that is nowhere near anything', () => {
    const tier: Rect = { x: 100, y: 200, w: 96, h: 40 }
    expect(activationsFor([tier], tapAt(900, 900), 122)).toEqual([])
  })
})
