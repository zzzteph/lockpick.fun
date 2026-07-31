/**
 * The on-screen controls, drawn only when a finger has actually touched the glass.
 *
 * Same drafting language as everything else (ART_DIRECTION.md §7): hairline frames, hatched fill for
 * "engaged", a label in the dimension face. A phone player gets controls; a desktop player never
 * sees them, because the first touch event is what turns them on and a mouse never sends one.
 *
 * See DECISIONS D-082.
 */

import { TENSION_STEPS, tensionForStep } from '../ui/input'
import { PAUSE_PAD, WITHDRAW_PAD, WRENCH_SLIDER, yForStep, type TouchState } from '../ui/touch'
import { hatchRect, label, text } from './draw'
import { STROKE, TYPE, alpha, font, readableAccents, type Palette } from './palette'
import { snapX, snapY, type Viewport } from './viewport'

function pad(
  vp: Viewport,
  p: Palette,
  rect: { x: number; y: number; w: number; h: number },
  caption: string,
  lit = false,
): void {
  const { ctx } = vp
  ctx.save()
  ctx.fillStyle = lit ? p.paper : p.paperShade
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = lit ? p.ink : p.rule
  ctx.strokeRect(
    snapX(vp, rect.x, STROKE.standard),
    snapY(vp, rect.y, STROKE.standard),
    rect.w,
    rect.h,
  )
  ctx.restore()
  label(ctx, caption, rect.x + rect.w / 2, rect.y + rect.h / 2 + 6, {
    font: font(TYPE.dimension),
    size: TYPE.dimension,
    color: p.ink,
    align: 'center',
  })
}

/**
 * The wrench slider and its two pads.
 *
 * The slider reads bottom-up with `off` as its own band at the foot: releasing tension is a move you
 * make in a hurry, and a control you have to aim at to release is a control that loses you the lock.
 * Filled bands are hatched so the level reads without relying on colour (ART_DIRECTION.md §1).
 */
export function drawTouchControls(
  vp: Viewport,
  p: Palette,
  touch: TouchState,
  opts: { tensionHeld: boolean } = { tensionHeld: false },
): void {
  if (!touch.active) return
  const { ctx } = vp
  const readable = readableAccents(p)

  pad(vp, p, PAUSE_PAD, 'pause')

  label(ctx, 'wrench', WRENCH_SLIDER.x + WRENCH_SLIDER.w / 2, WRENCH_SLIDER.y - 12, {
    font: font(TYPE.dimension),
    size: TYPE.dimension,
    color: p.inkLight,
    align: 'center',
  })

  ctx.save()
  ctx.fillStyle = p.paperShade
  ctx.fillRect(WRENCH_SLIDER.x, WRENCH_SLIDER.y, WRENCH_SLIDER.w, WRENCH_SLIDER.h)
  ctx.restore()

  // Eleven bands: off, then the ten pressure steps.
  for (let step = 0; step <= TENSION_STEPS; step += 1) {
    const top = yForStep(step + 1)
    const bottom = yForStep(step)
    const h = bottom - top
    const filled = step > 0 && step <= touch.step
    ctx.save()
    if (filled) {
      ctx.fillStyle = alpha(readable.amber, 0.75)
      ctx.fillRect(WRENCH_SLIDER.x, top, WRENCH_SLIDER.w, h)
      hatchRect(ctx, WRENCH_SLIDER.x, top, WRENCH_SLIDER.w, h, {
        spacing: 5,
        angleDeg: 0,
        color: alpha(p.ink, 0.35),
        lineWidth: 1,
      })
    }
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = p.rule
    ctx.strokeRect(
      snapX(vp, WRENCH_SLIDER.x, STROKE.hairline),
      snapY(vp, top, STROKE.hairline),
      WRENCH_SLIDER.w,
      h,
    )
    ctx.restore()
    if (step === 0) {
      label(ctx, 'off', WRENCH_SLIDER.x + WRENCH_SLIDER.w / 2, bottom - h / 2 + 6, {
        font: font(TYPE.dimension),
        size: TYPE.dimension,
        color: touch.step === 0 ? p.ink : p.inkLight,
        align: 'center',
      })
    }
  }

  // The frame last, over the bands, so the control reads as one object.
  ctx.save()
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = opts.tensionHeld ? p.ink : p.rule
  ctx.strokeRect(
    snapX(vp, WRENCH_SLIDER.x, STROKE.standard),
    snapY(vp, WRENCH_SLIDER.y, STROKE.standard),
    WRENCH_SLIDER.w,
    WRENCH_SLIDER.h,
  )
  ctx.restore()

  // The number, big, above the slider — the one reading a player calls out to themselves.
  text(
    ctx,
    touch.step === 0 ? '—' : String(touch.step),
    WRENCH_SLIDER.x + WRENCH_SLIDER.w / 2,
    WRENCH_SLIDER.y - 34,
    { font: font(TYPE.heading), color: touch.step > 0 ? readable.amber : p.inkLight, align: 'center' },
  )
  if (touch.step > 0) {
    text(
      ctx,
      tensionForStep(touch.step).toFixed(2),
      WRENCH_SLIDER.x + WRENCH_SLIDER.w / 2,
      WRENCH_SLIDER.y + WRENCH_SLIDER.h + 26,
      { font: font(TYPE.dimension), color: p.inkLight, align: 'center' },
    )
  }

  pad(vp, p, WITHDRAW_PAD, 'pick out', touch.liftPointer !== null)
}

/**
 * A phone held the wrong way up.
 *
 * The stage is a fixed 1920x1080 (ART_DIRECTION.md §8) and every screen is laid out across it, so a
 * portrait phone letterboxes down to a strip too small to read, let alone pick with. Saying so is
 * better than shipping something technically visible and actually unusable — and it is one line for
 * the player against re-laying-out eleven screens for a second aspect ratio.
 */
export function drawRotatePrompt(vp: Viewport, p: Palette): void {
  const { ctx } = vp
  /**
   * Drawn in **CSS pixels**, not in the logical stage — the one screen in the game that has to be.
   *
   * Everything else is laid out across a fixed 1920x1080 and letterboxed, which means all type
   * scales with the viewport. That is fine at any size the game is playable at and absurd here: on
   * a 390px-wide portrait phone the stage letterboxes to a 219px strip, so `TYPE.title` at 38px
   * came out at **7.7 CSS pixels** and the line under it at four. The screen whose entire job is to
   * tell you the layout does not fit was itself too small to read, inside two black bars filling
   * three quarters of the phone. Reported as part of the mobile pass; see DECISIONS D-110.
   *
   * So it resets the transform, fills the whole canvas, and sizes its type against the *real*
   * viewport: 7% of the short edge for the heading, clamped so it stays sensible on a tablet.
   */
  const w = vp.cssWidth
  const h = vp.cssHeight
  const HEADING = 'turn the phone sideways'
  const SUB = 'a lock is wider than it is tall'

  ctx.save()
  ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0)
  ctx.fillStyle = p.paper
  ctx.fillRect(0, 0, w, h)

  /**
   * Sized to the narrow edge, then **shrunk to fit if it still does not**.
   *
   * 7% of 390 is 27px, and `label` uppercases and tracks, so twenty-three characters came to
   * 423px against a 390px phone: the heading ran off both edges, which is a worse way to say
   * "this does not fit" than saying it small. Measured against the real face rather than
   * estimated — the canvas knows how wide the string is (D-102).
   */
  const fits = (size: number, s: string): number => {
    ctx.font = font(size)
    return ctx.measureText(s.toUpperCase()).width + size * 0.08 * Math.max(0, s.length - 1)
  }
  const usable = w * 0.88
  let titleSize = Math.round(Math.max(16, Math.min(44, Math.min(w, h) * 0.07)))
  while (titleSize > 12 && fits(titleSize, HEADING) > usable) titleSize -= 1
  const bodySize = Math.max(11, Math.round(titleSize * 0.52))

  label(ctx, HEADING, w / 2, h / 2 - bodySize, {
    font: font(titleSize),
    size: titleSize,
    color: p.ink,
    align: 'center',
  })
  text(ctx, SUB, w / 2, h / 2 + bodySize * 2, {
    font: font(bodySize),
    color: p.inkLight,
    align: 'center',
  })
  ctx.restore()
}

/** True when the display is too tall and narrow to lay the game out across. */
export function isPortrait(vp: Viewport): boolean {
  return vp.cssHeight > vp.cssWidth
}

/**
 * Whether this is a device you touch — asked of the device, not of the history of the session.
 *
 * The portrait guard used to be gated on `input.touch.active`, which is set by the **first
 * touch that lands**. So opening the game upright on a phone drew the ordinary menu first,
 * letterboxed 16:9 into a 390px-wide viewport: a 219px-tall strip with 17px type rendering at
 * about three and a half CSS pixels. Unreadable, un-hittable, and the exact "technically
 * rendered, actually unusable" screen D-082 added the prompt to avoid — sitting there until the
 * player poked at the smear hard enough to hit something.
 *
 * `(pointer: coarse)` is true on phones and tablets and false on a mouse, so the prompt is
 * correct on the very first frame. `touch.active` is still ORed in: a hybrid laptop reports a
 * fine pointer and is right to, but if somebody has actually touched the screen, they have told
 * us more than the media query did. See DECISIONS D-110.
 */
export function isCoarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
}
