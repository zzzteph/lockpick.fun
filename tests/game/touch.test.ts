/**
 * The touch scheme — DECISIONS D-082.
 *
 * `src/ui/touch.ts` is deliberately DOM-free so the gesture *meanings* can be tested without a
 * browser: what a y maps to on the wrench, what a drag maps to in millimetres, and which control a
 * touch lands on. The browser half — that a finger actually opens a lock — is `e2e/touch.spec.ts`.
 */

import { describe, expect, it } from 'vitest'
import {
  LIFT_DRAG_PX,
  PAUSE_PAD,
  WITHDRAW_PAD,
  WRENCH_SLIDER,
  createTouchState,
  inRect,
  liftForDrag,
  OFF_BAND_SHARE,
  WRENCH_DRAG_PX,
  TAP_SLOP,
  inOffZone,
  stepAtY,
  stepForDrag,
  targetAt,
  tensionForTouchStep,
  LIFT_PAD,
  mirrorRect,
  yForStep,
} from '../../src/ui/touch'
import { TENSION_STEPS, tensionForStep } from '../../src/ui/input'
import { T_MIN_HOLD } from '../../src/sim'
import { LOGICAL_WIDTH } from '../../src/render/viewport'

/** A wrench drag that began at `step`, with the finger at the middle of the slider. */
function grabbedAt(step: number) {
  const state = createTouchState()
  state.step = step
  state.wrenchOriginStep = step
  state.wrenchOriginY = WRENCH_SLIDER.y + WRENCH_SLIDER.h / 2
  return state
}

describe('the wrench slider', () => {
  it('does not move when the finger merely lands on it', () => {
    // The whole point of going relative (D-131): a jump here drops every pin already set.
    for (const step of [0, 3, TENSION_STEPS]) {
      const state = grabbedAt(step)
      expect(stepForDrag(state, state.wrenchOriginY)).toBe(step)
    }
  })

  it('is geared, one step per WRENCH_DRAG_PX/TENSION_STEPS of travel', () => {
    const state = grabbedAt(4)
    const perStep = WRENCH_DRAG_PX / TENSION_STEPS
    expect(stepForDrag(state, state.wrenchOriginY - perStep)).toBe(5)
    expect(stepForDrag(state, state.wrenchOriginY - perStep * 3)).toBe(7)
    expect(stepForDrag(state, state.wrenchOriginY + perStep * 2)).toBe(2)
    // Geared *down* relative to the control's own height — that is the point.
    expect(perStep).toBeGreaterThan(WRENCH_SLIDER.h / (TENSION_STEPS + OFF_BAND_SHARE))
  })

  it('never reports a step outside the range, however far the finger goes', () => {
    const state = grabbedAt(5)
    for (const y of [-5e4, -1, WRENCH_SLIDER.y - 900, WRENCH_SLIDER.y + WRENCH_SLIDER.h + 900, 5e4]) {
      const step = stepForDrag(state, y)
      expect(step).toBeGreaterThanOrEqual(0)
      expect(step).toBeLessThanOrEqual(TENSION_STEPS)
    }
  })

  it('reaches every step on one continuous drag, monotonically', () => {
    const state = grabbedAt(0)
    const seen = new Set<number>()
    let previous = -1
    for (let dy = 0; dy <= WRENCH_DRAG_PX; dy += 1) {
      // Dragged up from the bottom of the slider, so the off zone is left behind immediately.
      const step = stepForDrag(state, state.wrenchOriginY - dy)
      expect(step).toBeGreaterThanOrEqual(previous)
      previous = step
      seen.add(step)
    }
    expect(seen.size).toBe(TENSION_STEPS + 1)
  })

  it('resumes from where the wrench is, so two strokes reach what one would', () => {
    const perStep = WRENCH_DRAG_PX / TENSION_STEPS
    const first = grabbedAt(0)
    const afterOne = stepForDrag(first, first.wrenchOriginY - perStep * 3)
    const second = grabbedAt(afterOne)
    expect(stepForDrag(second, second.wrenchOriginY - perStep * 3)).toBe(6)
  })

  it('reads as off anywhere in the bottom band, wherever the drag came from', () => {
    const state = grabbedAt(TENSION_STEPS)
    const offTop = yForStep(1)
    expect(inOffZone(offTop)).toBe(true)
    expect(inOffZone(offTop - 1)).toBe(false)
    for (const y of [offTop, offTop + 10, WRENCH_SLIDER.y + WRENCH_SLIDER.h - 1]) {
      expect(stepForDrag(state, y)).toBe(0)
    }
  })

  it('draws the off band fatter than the rest, so releasing needs no aim', () => {
    const offBand = yForStep(0) - yForStep(1)
    const topBand = yForStep(TENSION_STEPS) - yForStep(TENSION_STEPS + 1)
    expect(offBand).toBeCloseTo(topBand * OFF_BAND_SHARE, 6)
    // A genuine finger target: 80 logical px is about 29 real ones on a mid-sized phone.
    expect(offBand).toBeGreaterThan(80)
  })

  it('tiles the slider exactly, top to bottom', () => {
    expect(yForStep(0)).toBeCloseTo(WRENCH_SLIDER.y + WRENCH_SLIDER.h, 6)
    expect(yForStep(TENSION_STEPS + 1)).toBeCloseTo(WRENCH_SLIDER.y, 6)
    for (let step = 0; step <= TENSION_STEPS; step += 1) {
      expect(yForStep(step + 1), `band ${step} is above band ${step - 1}`).toBeLessThan(
        yForStep(step),
      )
    }
  })

  it('step 0 means no tension at all, and every other step can hold a pin', () => {
    expect(tensionForTouchStep(0)).toBe(0)
    for (let step = 1; step <= TENSION_STEPS; step += 1) {
      expect(tensionForTouchStep(step)).toBe(tensionForStep(step))
      expect(tensionForTouchStep(step), `step ${step}`).toBeGreaterThanOrEqual(T_MIN_HOLD)
    }
  })
})

describe('the lift drag', () => {
  it('a full drag up reaches the top of the travel from rest', () => {
    const s = createTouchState()
    s.liftOriginY = 900
    s.liftOriginMm = 0
    expect(liftForDrag(s, 900 - LIFT_DRAG_PX, 4)).toBeCloseTo(4, 9)
  })

  it('dragging down from rest asks for nothing rather than something negative', () => {
    const s = createTouchState()
    s.liftOriginY = 500
    expect(liftForDrag(s, 900, 4)).toBe(0)
  })

  it('resumes from where the pin already was, so two drags reach the same place as one', () => {
    const half = LIFT_DRAG_PX / 2
    const one = createTouchState()
    one.liftOriginY = 900
    const inOneGo = liftForDrag(one, 900 - half * 2, 4)

    const first = createTouchState()
    first.liftOriginY = 900
    const midway = liftForDrag(first, 900 - half, 4)
    const second = createTouchState()
    second.liftOriginY = 900
    second.liftOriginMm = midway
    expect(liftForDrag(second, 900 - half, 4)).toBeCloseTo(inOneGo, 9)
  })

  it('is geared down enough to stop inside a capture window', () => {
    // A tight lock's window is around 0.37mm. That has to be more than a few px of finger travel,
    // or the gesture cannot express it at all.
    const pxPerMm = LIFT_DRAG_PX / 4
    expect(pxPerMm * 0.37).toBeGreaterThan(30)
  })

  it('never exceeds the chamber it is working', () => {
    const s = createTouchState()
    s.liftOriginY = 1080
    expect(liftForDrag(s, -3000, 2.5)).toBe(2.5)
  })
})

describe('where a touch lands', () => {
  it('the wrench wins over the lock', () => {
    expect(targetAt(WRENCH_SLIDER.x + 10, WRENCH_SLIDER.y + 10)).toBe('wrench')
  })

  it('the middle of the stage is a pin', () => {
    expect(targetAt(960, 500)).toBe('lift')
  })

  it('the pads are neither', () => {
    expect(targetAt(PAUSE_PAD.x + 4, PAUSE_PAD.y + 4)).toBe('none')
    expect(targetAt(WITHDRAW_PAD.x + 4, WITHDRAW_PAD.y + 4)).toBe('none')
  })

  it('no two controls overlap', () => {
    const rects = [WRENCH_SLIDER, WITHDRAW_PAD, PAUSE_PAD]
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]
        const b = rects[j]
        if (!a || !b) continue
        const overlaps =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlaps, `${i} vs ${j}`).toBe(false)
      }
    }
  })

  it('every control is a comfortable finger target', () => {
    // Around 9mm of finger pad, at the scale a phone renders a 1920-wide stage.
    for (const r of [WRENCH_SLIDER, WITHDRAW_PAD, PAUSE_PAD]) {
      expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(70)
    }
  })

  it('the controls sit clear of the cutaway, which is centred', () => {
    // The lock is drawn across the middle of the stage; both gutters are where the hands go.
    for (const r of [WRENCH_SLIDER, WITHDRAW_PAD]) {
      expect(r.x + r.w, 'the wrench hand works down the left gutter').toBeLessThan(200)
    }
    for (const r of [PAUSE_PAD, LIFT_PAD]) {
      expect(r.x, 'the pick hand works down the right one').toBeGreaterThan(LOGICAL_WIDTH - 500)
    }
  })

  /**
   * Nothing that ends a run may share a gutter with the wrench — DECISIONS D-133.
   *
   * Pause and the bench link used to be stacked either side of the slider, in the same 50px column
   * a thumb holds tension in for the whole attempt. The review that found it measured 32px between
   * a raised thumb and the pause box. This is the property that was missing, so it is asserted
   * rather than left to the next person to notice.
   */
  it('keeps the pause pad out of the wrench thumb’s column', () => {
    const wrenchRight = WRENCH_SLIDER.x + WRENCH_SLIDER.w
    expect(PAUSE_PAD.x).toBeGreaterThan(wrenchRight)
    // …and out of the pick-out pad's column too, since that shares the wrench's gutter now.
    expect(PAUSE_PAD.x).toBeGreaterThan(WITHDRAW_PAD.x + WITHDRAW_PAD.w)
  })

  it('gives the wrench the whole of its own gutter, down to the footer', () => {
    // 940 is the footer panel's top edge; the slider is meant to reach it, not stop short.
    expect(WRENCH_SLIDER.y + WRENCH_SLIDER.h).toBeGreaterThan(900)
    expect(WRENCH_SLIDER.y + WRENCH_SLIDER.h).toBeLessThanOrEqual(940)
  })

  it('and inside the stage', () => {
    for (const r of [WRENCH_SLIDER, WITHDRAW_PAD, PAUSE_PAD]) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(1920)
      expect(r.y + r.h).toBeLessThanOrEqual(1080)
    }
  })

  it('inRect is half-open, so adjacent rectangles cannot both claim a point', () => {
    const r = { x: 10, y: 10, w: 100, h: 100 }
    expect(inRect(r, 10, 10)).toBe(true)
    expect(inRect(r, 110, 10)).toBe(false)
    expect(inRect(r, 10, 110)).toBe(false)
    expect(inRect(r, 9, 50)).toBe(false)
  })
})

/**
 * Handedness mirrors the controls, and the lift strip sits opposite the wrench — D-130.
 *
 * `mirrorRect` is pure geometry, so which side every control lands on is checkable here rather
 * than by photographing a phone.
 */
describe('the two hands', () => {
  const STAGE_W = 1920

  it('puts the wrench on the left for a left-handed player and the right for a right-handed one', () => {
    expect(mirrorRect(WRENCH_SLIDER, false).x).toBe(WRENCH_SLIDER.x)
    const right = mirrorRect(WRENCH_SLIDER, true)
    expect(right.x).toBe(STAGE_W - WRENCH_SLIDER.x - WRENCH_SLIDER.w)
    expect(right.x + right.w, 'and stays inside the stage').toBeLessThanOrEqual(STAGE_W)
  })

  it('mirrors every control together, so the hands never end up split', () => {
    for (const r of [WRENCH_SLIDER, WITHDRAW_PAD, PAUSE_PAD, LIFT_PAD]) {
      const m = mirrorRect(r, true)
      // Same distance from its own edge as the original was from the other edge.
      expect(STAGE_W - m.x - m.w, r === LIFT_PAD ? 'lift' : 'control').toBe(r.x)
      expect(m.y).toBe(r.y)
      expect(m.h).toBe(r.h)
    }
  })

  it('keeps the lift strip opposite the wrench in both hands', () => {
    for (const flip of [false, true]) {
      const w = mirrorRect(WRENCH_SLIDER, flip)
      const l = mirrorRect(LIFT_PAD, flip)
      const apart = Math.abs(w.x - l.x)
      expect(apart, `flip=${flip}: the two controls must be on opposite sides`).toBeGreaterThan(
        STAGE_W / 2,
      )
    }
  })

  it('gives every control a target an adult finger can hit', () => {
    // A finger pad is about 9mm. At the scale a phone renders this stage — roughly 0.35 — 132
    // logical px is about 46 CSS px, which is above both Apple's 44pt and Material's 48dp floors.
    for (const r of [WRENCH_SLIDER, WITHDRAW_PAD, PAUSE_PAD, LIFT_PAD]) {
      expect(r.w).toBeGreaterThanOrEqual(132)
      expect(r.h).toBeGreaterThanOrEqual(74)
    }
  })

  it('never lets a control overlap another', () => {
    const rects = [WRENCH_SLIDER, WITHDRAW_PAD, PAUSE_PAD, LIFT_PAD]
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]
        const b = rects[j]
        if (!a || !b) continue
        const overlaps =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlaps, `control ${i} overlaps control ${j}`).toBe(false)
      }
    }
  })
})

/**
 * Tapping a band picks it; dragging is still relative — DECISIONS D-134.
 *
 * D-131 made the wrench relative so a grab could not jump the tension and drop every set pin. That
 * left the ten drawn, numbered bands inert: *"I cannot freely click on the tension measure, I need
 * to click and drag"*. A tap is a different gesture with a different intent — you looked, you chose,
 * you put your finger on it — so it gets the absolute answer and the drag keeps the relative one.
 */
describe('tapping the wrench', () => {
  it('reads the band the finger landed on', () => {
    for (let step = 1; step <= TENSION_STEPS; step += 1) {
      const middle = (yForStep(step) + yForStep(step + 1)) / 2
      expect(stepAtY(middle), `band ${step}`).toBe(step)
    }
  })

  it('reads the whole fat bottom band as off', () => {
    const offMiddle = (yForStep(0) + yForStep(1)) / 2
    expect(stepAtY(offMiddle)).toBe(0)
    expect(stepAtY(WRENCH_SLIDER.y + WRENCH_SLIDER.h - 1)).toBe(0)
    // …and the band immediately above it is step 1, not off.
    expect(stepAtY(yForStep(1) - 1)).toBe(1)
  })

  it('is the exact inverse of the bands that are drawn', () => {
    // If these two ever disagree, a player taps one number and gets another.
    for (let step = 0; step <= TENSION_STEPS; step += 1) {
      const top = yForStep(step + 1)
      const bottom = yForStep(step)
      expect(stepAtY((top + bottom) / 2), `drawn band ${step}`).toBe(step)
    }
  })

  it('never reports a step outside the range', () => {
    for (const y of [-5000, 0, WRENCH_SLIDER.y - 400, WRENCH_SLIDER.y + WRENCH_SLIDER.h + 400, 5e4]) {
      const step = stepAtY(y)
      expect(step).toBeGreaterThanOrEqual(0)
      expect(step).toBeLessThanOrEqual(TENSION_STEPS)
    }
  })

  it('needs less travel to count as a drag than one geared step costs', () => {
    // Or a deliberate one-step drag would be read as a tap and jump somewhere else entirely.
    expect(TAP_SLOP).toBeLessThan(WRENCH_DRAG_PX / TENSION_STEPS)
  })
})
