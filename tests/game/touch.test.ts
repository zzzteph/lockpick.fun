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
  stepAtY,
  targetAt,
  tensionForTouchStep,
  yForStep,
} from '../../src/ui/touch'
import { TENSION_STEPS, tensionForStep } from '../../src/ui/input'
import { T_MIN_HOLD } from '../../src/sim'

describe('the wrench slider', () => {
  it('is off at the bottom and full at the top', () => {
    expect(stepAtY(WRENCH_SLIDER.y + WRENCH_SLIDER.h - 1)).toBe(0)
    expect(stepAtY(WRENCH_SLIDER.y)).toBe(TENSION_STEPS)
  })

  it('never reports a step outside the range, however far the finger goes', () => {
    for (const y of [-5000, -1, WRENCH_SLIDER.y - 200, WRENCH_SLIDER.y + WRENCH_SLIDER.h + 900, 5e4]) {
      const step = stepAtY(y)
      expect(step).toBeGreaterThanOrEqual(0)
      expect(step).toBeLessThanOrEqual(TENSION_STEPS)
    }
  })

  it('rises monotonically up the slider, and reaches every step', () => {
    const seen = new Set<number>()
    let previous = -1
    for (let y = WRENCH_SLIDER.y + WRENCH_SLIDER.h - 1; y >= WRENCH_SLIDER.y; y -= 1) {
      const step = stepAtY(y)
      expect(step).toBeGreaterThanOrEqual(previous)
      previous = step
      seen.add(step)
    }
    expect(seen.size).toBe(TENSION_STEPS + 1)
  })

  it('gives the off band the same size as every other, so releasing needs no aim', () => {
    const offBand = yForStep(0) - yForStep(1)
    const topBand = yForStep(TENSION_STEPS) - yForStep(TENSION_STEPS + 1)
    expect(offBand).toBeCloseTo(topBand, 9)
    // And it is a proper finger target rather than a sliver.
    expect(offBand).toBeGreaterThan(40)
  })

  it('every band drawn matches the band the finger is read against', () => {
    for (let step = 0; step <= TENSION_STEPS; step += 1) {
      const middle = (yForStep(step) + yForStep(step + 1)) / 2
      expect(stepAtY(middle), `step ${step}`).toBe(step)
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
    // The lock is drawn across the middle of the stage; the gutter is where the hands go.
    for (const r of [WRENCH_SLIDER, WITHDRAW_PAD, PAUSE_PAD]) {
      expect(r.x + r.w).toBeLessThan(200)
    }
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
