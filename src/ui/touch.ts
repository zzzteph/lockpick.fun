/**
 * Playing with a finger — the touch scheme.
 *
 * Everything here is geometry and state machine, in logical 1920x1080 space, with no DOM and no
 * canvas: `InputController` feeds it pointer events, `src/render/touchui.ts` draws it, and this
 * module is the only thing that knows what a touch *means*.
 *
 * **The scheme, and why it is shaped like this.** The mouse scheme was removed (D-059) because a
 * hook that follows the pointer exactly turns every diagonal drag into a shove on the pin you are
 * leaving: raise your hand while crossing a set pin and you push it straight back off its ledge
 * (D-051). A finger is worse than a mouse at this, not better. So touch keeps the keyboard's one
 * good idea — **travel and lift are different gestures** — rather than reinventing the scheme that
 * did not work:
 *
 * | Gesture | Meaning |
 * |---|---|
 * | Tap a pin | Put the tip under that chamber, at rest. Never lifts. |
 * | Drag up from a pin | Lift it. Vertical only: sideways movement inside a lift drag is ignored. |
 * | Let go | The pick comes off and the pin rides its spring back down. |
 * | Drag the wrench slider | Rotation pressure, off at the bottom and ten steps above it. |
 *
 * The slider *is* the wrench rather than a setting for it: at zero there is no tension at all, and
 * anywhere above zero tension is held at that step. One control, and a flick to the bottom and back
 * is the feather (SIMULATION.md §6) — which on the keyboard needs two hands and good timing.
 *
 * See DECISIONS D-082.
 */

import { TENSION_STEPS, tensionForStep } from './input'

/** Logical-space rectangle. */
export interface TouchRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export function inRect(r: TouchRect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}

/**
 * The wrench slider, in the left gutter.
 *
 * `computeLayout` centres the cutaway across `ASSEMBLY_FRACTION` of the stage, which leaves a
 * clear strip down each side; the wrench goes in the left one because that is the hand that holds
 * it. Wide enough to hit without looking — a finger pad is around 9mm, which at the scale a 6"
 * phone renders this is roughly 90 logical px, so 132 is a comfortable target rather than a tight
 * one.
 */
/**
 * The slider starts at 260, not 178 — DECISIONS D-129.
 *
 * It carries a header: the pressure step as a big number at `y - 34` and the word `wrench` at
 * `y - 12`. At `y = 178` both of those were drawn at 144 and 166 — **inside `PAUSE_PAD`**, which
 * runs 96 to 170. So the wrench's own label has always been printed across the pause button, on
 * every touch device, since the scheme was written. Nobody saw it because the touch controls only
 * draw once a finger has landed and every screenshot in the suite was taken with a mouse; the
 * compact type scale made it large enough to report — *"pause and wrench overlap"*.
 *
 * 260 leaves the header a clear 90px band of its own between the two controls. The bottom edge is
 * unchanged at 838, so `WITHDRAW_PAD` and every hit test below it stay exactly where they were.
 */
export const WRENCH_SLIDER: TouchRect = { x: 30, y: 260, w: 132, h: 578 }

/** The pads along the bottom of the gutter: withdraw the pick, and pause. */
// Above the footer panel, which starts at 940 — a control drawn over the tension meter reads as
// part of it.
export const WITHDRAW_PAD: TouchRect = { x: 30, y: 854, w: 132, h: 78 }
// Clear of the header, which ends at 88 — a pad drawn under the header bar but hit-tested over it
// is a pad that eats taps meant for the bar.
export const PAUSE_PAD: TouchRect = { x: 30, y: 96, w: 132, h: 74 }

/**
 * How far up the finger must drag to ask for full lift, in logical px.
 *
 * Deliberately much longer than the pin's own travel on screen: the pin moves a few millimetres and
 * a finger cannot resolve a few millimetres, so the gesture is *geared down*. 460px of drag for
 * ~4mm of pin is about 115px per millimetre, against the keyboard's Space ramp, and it is what makes
 * stopping inside a 0.37mm capture window possible with a fingertip at all.
 */
export const LIFT_DRAG_PX = 460

/** Which control a touch is currently driving. */
export type TouchTarget = 'none' | 'wrench' | 'lift'

export interface TouchState {
  /** The pointer id currently on the wrench, or null. */
  wrenchPointer: number | null
  /** The pointer id currently lifting a pin, or null. */
  liftPointer: number | null
  /** Where the lift drag started, logical px. */
  liftOriginY: number
  /** Lift the pin was already at when the drag began, mm — so a second drag resumes, not jumps. */
  liftOriginMm: number
  /** Pressure step 0..TENSION_STEPS, where 0 is "wrench off". */
  step: number
  /** True once anything has arrived from a touch device: the controls are drawn only then. */
  active: boolean
}

export function createTouchState(): TouchState {
  return {
    wrenchPointer: null,
    liftPointer: null,
    liftOriginY: 0,
    liftOriginMm: 0,
    step: 0,
    active: false,
  }
}

/**
 * The pressure step a touch at `y` is asking for, 0..`TENSION_STEPS`.
 *
 * Bottom of the slider is off. The eleven bands are equal, so the *off* band is as easy to hit as
 * any other — dropping tension in a hurry is a technique, not an accident, and it should not need
 * precision.
 */
export function stepAtY(y: number): number {
  const t = 1 - (y - WRENCH_SLIDER.y) / WRENCH_SLIDER.h
  const band = Math.floor(t * (TENSION_STEPS + 1))
  return Math.max(0, Math.min(TENSION_STEPS, band))
}

/** The y at which a given step's band starts, for drawing. */
export function yForStep(step: number): number {
  const t = step / (TENSION_STEPS + 1)
  return WRENCH_SLIDER.y + WRENCH_SLIDER.h * (1 - t)
}

/** The tension value a step means. Step 0 is the wrench off, so it has no value of its own. */
export function tensionForTouchStep(step: number): number {
  return step <= 0 ? 0 : tensionForStep(step)
}

/**
 * Lift asked for by a drag, in mm.
 *
 * Measured from where the finger went down and added to whatever the pin was already at, so lifting
 * in two goes reaches the same place as lifting in one — a finger runs out of screen long before a
 * deep chamber runs out of travel.
 */
export function liftForDrag(state: TouchState, y: number, maxLift: number): number {
  const dragged = (state.liftOriginY - y) / LIFT_DRAG_PX
  const mm = state.liftOriginMm + dragged * maxLift
  return Math.max(0, Math.min(maxLift, mm))
}

/**
 * Where a touch that goes down at (x, y) should go.
 *
 * The wrench wins over everything, because it is the control you reach for in a hurry. Anything
 * else inside the lock area is a pin: taps and lift drags start the same way and are told apart by
 * whether the finger then moves.
 */
export function targetAt(x: number, y: number): TouchTarget {
  if (inRect(WRENCH_SLIDER, x, y)) return 'wrench'
  if (inRect(WITHDRAW_PAD, x, y) || inRect(PAUSE_PAD, x, y)) return 'none'
  return 'lift'
}
