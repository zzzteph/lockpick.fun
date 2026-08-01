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

/** The logical stage width, mirrored about. Local so this module imports nothing from render. */
const STAGE_W = 1920

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
 * The slider carries a header — the pressure step as a big number at `y - 34` and the word
 * `wrench` at `y - 12` — so it cannot start where the pad above it ends.
 *
 * At `y = 178` those two lines drew at 144 and 166, **inside** the old `PAUSE_PAD`, which ran 96 to
 * 170: the wrench's own label was printed across the pause button on every touch device from the
 * day the scheme was written. Nobody saw it, because the touch controls only draw once a finger has
 * landed and every screenshot in the suite was taken with a mouse. The compact type scale finally
 * made it big enough to report as *"pause and wrench overlap"* (D-129).
 *
 * **318 and 482, once the pads became square (D-131).** The gutter now tiles cleanly: header ends
 * at 88, pause 96..228, a 90px band for this header, slider 318..800, withdraw 806..938, footer
 * panel at 940. Every boundary is a real constraint and nothing overlaps anything. The slider gives
 * up 96px of length for it, which costs nothing it needs — the drag is relative and geared (D-131),
 * so the runway is a comfort, not a resolution limit, and 482 logical px is 174 real ones.
 */
export const WRENCH_SLIDER: TouchRect = { x: 30, y: 318, w: 132, h: 482 }

/**
 * Every touch control mirrors with the handedness setting — DECISIONS D-130.
 *
 * `handedness` has always mirrored the *cutaway* — which end the keyway opens on — and never the
 * controls, so a right-handed player got a mirrored lock with the wrench still under their left
 * thumb. Reported as *"when you switch left-right handed, the interface must also switch — if you
 * hold the lock in the right hand, tension should be at the right part as well"*, which is exactly
 * what the setting is for: it is a statement about which hand is doing what, not about which way
 * the drawing faces.
 *
 * Mirroring about the stage centre rather than defining a second set of rects, so there is one
 * source of truth for where a control is and the two hands cannot drift apart.
 */
export function mirrorRect(r: TouchRect, mirrored: boolean): TouchRect {
  return mirrored ? { ...r, x: STAGE_W - r.x - r.w } : r
}

/**
 * The strip you can drag in to lift the selected pin without your hand covering it.
 *
 * Reported as *"sometimes your finger, you will not see the pin"* — which is true of any
 * drag-on-the-thing gesture and is worst here, because the whole point of the screen is watching a
 * pin cross a line a fraction of a millimetre wide while you hold it there.
 *
 * The lift drag has *always* been vertical-only — `touchMove` reads `y` and deliberately ignores
 * `x` (D-059, D-082) — so it never needed to happen over the lock at all. All that was missing was
 * somewhere to start it. It sits in the gutter opposite the wrench, so the two hands have one
 * control each and neither is over the drawing.
 *
 * **Inboard of the readouts, not outboard.** The far edge of that gutter is already the force and
 * resistance columns, so a strip at the margin lands on top of them. 1548 is `GUTTER_LEFT` — the
 * first column of page the lock can never reach — which puts the strip between the drawing and the
 * readings, touching neither. Mirrored it lands at 240, between the free gutter and the lock.
 */
export const LIFT_PAD: TouchRect = { x: 1548, y: 220, w: 132, h: 272 }

/**
 * The pads at each end of the gutter: pause, and withdraw the pick.
 *
 * **Both are 132 wide and were 74 tall** — forty-eight CSS px across and twenty-seven down on a
 * mid-sized phone. Wide enough for a thumb and a third of the height one needs, which is the shape
 * of the whole mobile audit in D-131: the widths were designed for fingers and the heights were
 * inherited from a desktop row.
 *
 * They are square now, at 132. The room was already there and unused — the wrench slider runs
 * 260 to 838, the header ends at 88 and the footer panel starts at 940, which leaves 172px of
 * empty gutter above the slider and 102 below it. Pause takes 96..228 and withdraw 806..938,
 * both still clear of the bars they must not overlap, and the slider is untouched between them.
 */
export const WITHDRAW_PAD: TouchRect = { x: 30, y: 806, w: 132, h: 132 }
export const PAUSE_PAD: TouchRect = { x: 30, y: 96, w: 132, h: 132 }

/**
 * How far up the finger must drag to ask for full lift, in logical px.
 *
 * Deliberately much longer than the pin's own travel on screen: the pin moves a few millimetres and
 * a finger cannot resolve a few millimetres, so the gesture is *geared down*. 460px of drag for
 * ~4mm of pin is about 115px per millimetre, against the keyboard's Space ramp, and it is what makes
 * stopping inside a 0.37mm capture window possible with a fingertip at all.
 */
export const LIFT_DRAG_PX = 460

/**
 * Drag for the wrench's whole range, in logical px — the counterpart to `LIFT_DRAG_PX`.
 *
 * The lift gesture has been geared down since it was written, because a finger cannot resolve the
 * fraction of a millimetre a pin moves. The wrench never was: it read the touch position straight
 * off the slider, which put eleven choices in 482 logical px — **eighteen CSS pixels a step**,
 * against a fingertip four times that wide. One control geared for a hand and its neighbour left on
 * absolute positioning, in the same scheme.
 *
 * 620 makes a step 62 logical px, about 22 real ones: a deliberate movement rather than a twitch.
 * The drag is not confined to the slider — the pointer is captured on the way down — so asking for
 * more travel than the control is tall costs nothing.
 */
export const WRENCH_DRAG_PX = 620

/**
 * How many bands' worth of height the *off* band gets.
 *
 * Its own doc note has always claimed dropping tension in a hurry "should not need precision", and
 * it was drawn exactly as wide as the other ten. Two shares is the claim made true. See D-131.
 */
export const OFF_BAND_SHARE = 2

/**
 * How far across a finger must travel to page a screen, in logical px.
 *
 * About 50 CSS px on a mid-sized phone — unmistakably a swipe. The reference screens are the ones
 * you page, and they are also the ones you rest a thumb on while reading, so the threshold is set
 * where an untidy tap cannot reach it. See DECISIONS D-131.
 */
export const SWIPE_MIN_PX = 140

/** Which control a touch is currently driving. */
export type TouchTarget = 'none' | 'wrench' | 'lift'

export interface TouchState {
  /** The pointer id currently on the wrench, or null. */
  wrenchPointer: number | null
  /** Where the wrench drag started, logical px. */
  wrenchOriginY: number
  /** The step the wrench was already at when the drag began — so a grab never jumps. */
  wrenchOriginStep: number
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
    wrenchOriginY: 0,
    wrenchOriginStep: 0,
    liftPointer: null,
    liftOriginY: 0,
    liftOriginMm: 0,
    step: 0,
    active: false,
  }
}

/** Bands of height below the bottom of band `step`. Band 0 is `OFF_BAND_SHARE` deep, the rest 1. */
function sharesBelow(step: number): number {
  return step <= 0 ? 0 : OFF_BAND_SHARE + (step - 1)
}

/** The y at which a given step's band starts, for drawing. Step 0 is the bottom. */
export function yForStep(step: number): number {
  const t = sharesBelow(step) / (TENSION_STEPS + OFF_BAND_SHARE)
  return WRENCH_SLIDER.y + WRENCH_SLIDER.h * (1 - t)
}

/**
 * Inside the fat band at the bottom, which means *off* wherever the drag came from.
 *
 * The one absolute region on an otherwise relative control, and it earns the exception: a relative
 * drag reaches zero only by travelling the whole way back down, which from step 8 is 496px of
 * deliberate stroke. Letting the wrench go is the panic move — you do it because pins are dropping
 * — so it gets a target you can slam into with your eyes on the lock.
 */
export function inOffZone(y: number): boolean {
  return y >= yForStep(1)
}

/**
 * The pressure step a wrench drag is asking for, 0..`TENSION_STEPS`.
 *
 * **Relative, not absolute** — DECISIONS D-131. Touching the slider used to set the tension to
 * whatever band the finger landed in, so putting a thumb down anywhere jumped the wrench there, and
 * on a control where a sudden change drops every pin you have set, an unintended jump is the most
 * expensive thing the input layer can do. Now a grab changes nothing until the finger moves, and
 * moves from where the wrench already was.
 */
export function stepForDrag(state: TouchState, y: number): number {
  if (inOffZone(y)) return 0
  const moved = (state.wrenchOriginY - y) / WRENCH_DRAG_PX
  const raw = state.wrenchOriginStep + moved * TENSION_STEPS
  return Math.max(0, Math.min(TENSION_STEPS, Math.round(raw)))
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
export function targetAt(x: number, y: number, mirrored = false): TouchTarget {
  if (inRect(mirrorRect(WRENCH_SLIDER, mirrored), x, y)) return 'wrench'
  if (
    inRect(mirrorRect(WITHDRAW_PAD, mirrored), x, y) ||
    inRect(mirrorRect(PAUSE_PAD, mirrored), x, y)
  ) {
    return 'none'
  }
  return 'lift'
}
