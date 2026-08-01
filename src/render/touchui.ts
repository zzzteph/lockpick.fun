/**
 * The on-screen controls, drawn only when a finger has actually touched the glass.
 *
 * Same drafting language as everything else (ART_DIRECTION.md §7): hairline frames, hatched fill for
 * "engaged", a label in the dimension face. A phone player gets controls; a desktop player never
 * sees them, because the first touch event is what turns them on and a mouse never sends one.
 *
 * See DECISIONS D-082.
 */

import { TENSION_STEPS } from '../ui/input'
import {
  LIFT_PAD,
  PAUSE_PAD,
  WITHDRAW_PAD,
  WRENCH_SLIDER,
  mirrorRect,
  yForStep,
  type TouchState,
} from '../ui/touch'
import { hatchRect, label, text } from './draw'
import { STROKE, TYPE, alpha, font, readableAccents, type Palette } from './palette'
import { snapX, snapY, typeFor, type Viewport } from './viewport'

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
  /**
   * Sized to fit the pad, measured against the real face.
   *
   * The compact scale is chosen for the *smallest readable size* (D-122), not for the widest box
   * it has to sit in — so on a large phone `pick out` came out at 152px inside a 132px pad and
   * hung off both ends of its own frame. Shrink-to-fit rather than a shorter word, because "pick
   * out" is what the control does and the pad is a fixed part of the touch layout.
   */
  const max = rect.w - 12
  let size = typeFor(vp, TYPE.dimension)
  const drawn = (s: number): number => {
    ctx.font = font(s)
    return ctx.measureText(caption.toUpperCase()).width + s * 0.08 * Math.max(0, caption.length - 1)
  }
  while (size > 10 && drawn(size) > max) size -= 1
  label(ctx, caption, rect.x + rect.w / 2, rect.y + rect.h / 2 + size * 0.35, {
    font: font(size),
    size,
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
  opts: { tensionHeld: boolean; mirrored?: boolean } = { tensionHeld: false },
): void {
  if (!touch.active) return
  const { ctx } = vp
  const readable = readableAccents(p)
  /**
   * Every control is placed through `mirrorRect` — DECISIONS D-130.
   *
   * Right-handed means the lock is held in the right hand, so the wrench belongs under the right
   * thumb. The cutaway has mirrored on this setting since it existed; the controls never did.
   */
  const flip = opts.mirrored ?? false
  const slider = mirrorRect(WRENCH_SLIDER, flip)
  const lift = mirrorRect(LIFT_PAD, flip)

  pad(vp, p, mirrorRect(PAUSE_PAD, flip), 'pause')

  /**
   * The lift strip, opposite the wrench.
   *
   * Drawn as a dashed outline rather than a solid pad because it is not a button — it is somewhere
   * to *drag*, and a solid frame beside a solid wrench slider would read as a second thing to
   * press. The caption is the whole of the discoverability: nobody would find "you may drag here
   * instead" on their own, and the alternative is a tutorial line for a control that should
   * explain itself.
   */
  ctx.save()
  ctx.setLineDash([10, 8])
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = touch.liftPointer !== null ? p.ink : p.rule
  ctx.strokeRect(snapX(vp, lift.x, 1), snapY(vp, lift.y, 1), lift.w, lift.h)
  ctx.restore()
  {
    const s = typeFor(vp, TYPE.dimension)
    label(ctx, 'drag', lift.x + lift.w / 2, lift.y + lift.h / 2 - s * 0.7, {
      font: font(s),
      size: s,
      color: p.inkLight,
      align: 'center',
    })
    label(ctx, 'to lift', lift.x + lift.w / 2, lift.y + lift.h / 2 + s * 0.6, {
      font: font(s),
      size: s,
      color: p.inkLight,
      align: 'center',
    })
  }

  label(ctx, 'wrench', slider.x + slider.w / 2, slider.y - 12, {
    font: font(typeFor(vp, TYPE.dimension)),
    size: typeFor(vp, TYPE.dimension),
    color: p.inkLight,
    align: 'center',
  })

  ctx.save()
  ctx.fillStyle = p.paperShade
  ctx.fillRect(slider.x, slider.y, slider.w, slider.h)
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
      ctx.fillRect(slider.x, top, slider.w, h)
      hatchRect(ctx, slider.x, top, slider.w, h, {
        spacing: 5,
        angleDeg: 0,
        color: alpha(p.ink, 0.35),
        lineWidth: 1,
      })
    }
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = p.rule
    ctx.strokeRect(
      snapX(vp, slider.x, STROKE.hairline),
      snapY(vp, top, STROKE.hairline),
      slider.w,
      h,
    )
    ctx.restore()
    if (step === 0) {
      label(ctx, 'off', slider.x + slider.w / 2, bottom - h / 2 + 6, {
        font: font(typeFor(vp, TYPE.dimension)),
        size: typeFor(vp, TYPE.dimension),
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
    snapX(vp, slider.x, STROKE.standard),
    snapY(vp, slider.y, STROKE.standard),
    slider.w,
    slider.h,
  )
  ctx.restore()

  // The number, big, above the slider — the one reading a player calls out to themselves.
  text(
    ctx,
    touch.step === 0 ? '—' : String(touch.step),
    slider.x + slider.w / 2,
    slider.y - 34,
    { font: font(typeFor(vp, TYPE.heading)), color: touch.step > 0 ? readable.amber : p.inkLight, align: 'center' },
  )
  /*
   * The 0..1 value used to be printed under the slider, at `y + h + 26` = 864 — **inside**
   * `WITHDRAW_PAD`, which spans 854 to 932. Reported as *"pick out overlaps with the value of the
   * tension wrench"*, and it is not a consequence of moving the slider in D-129: the old geometry
   * was `178 + 660 + 26`, which is also 864. It has collided since the touch scheme was written.
   *
   * It is simply deleted rather than moved. The slider's job is the **step**, which is drawn large
   * above it, and the same 0.45 is already in the footer beside `wrench 5 of 10`. A number printed
   * twice on one screen, one of them on top of a button, is not a readout worth finding room for.
   * See DECISIONS D-130.
   */

  pad(vp, p, mirrorRect(WITHDRAW_PAD, flip), 'pick out', touch.liftPointer !== null)
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

/** Tried once per session; a refusal is normal and must not be retried on every touch. */
let rotationAsked = false

/**
 * Ask the device to turn itself landscape, rather than asking the player to — DECISIONS D-129.
 *
 * Reported as *"when you open the device the interface must be rotated by default without ask"*,
 * and that is the right instinct: the game is 16:9 and a phone knows how to rotate. What it is not
 * is reliably *allowed*. `screen.orientation.lock` needs a fullscreen element on Chrome and Android,
 * and **Safari on iOS does not implement it at all** — so this is best-effort by nature, and the
 * "turn the phone sideways" screen stays as the fallback for the browsers that refuse.
 *
 * Called from the first touch because both fullscreen and orientation lock require a user gesture:
 * a page cannot rotate the phone of somebody who has not touched it yet, and no amount of wanting
 * to changes that. Tried once — a browser that says no will say no every time, and asking again on
 * every tap would mean an unhandled rejection per tap.
 */
export function tryRotateToLandscape(canvas: HTMLElement): void {
  if (rotationAsked) return
  rotationAsked = true
  const orientation = screen.orientation as
    | (ScreenOrientation & { lock?: (o: string) => Promise<void> })
    | undefined
  if (typeof orientation?.lock !== 'function') return

  const lock = (): void => {
    orientation.lock?.('landscape').catch(() => {
      // Refused — no fullscreen, or the platform does not support it. The prompt handles it.
    })
  }
  // Fullscreen first where it is available, because the lock is rejected outside it on the
  // browsers that support the lock at all.
  const el = canvas as HTMLElement & { requestFullscreen?: () => Promise<void> }
  if (typeof el.requestFullscreen === 'function' && !document.fullscreenElement) {
    el.requestFullscreen().then(lock, lock)
  } else {
    lock()
  }
}
