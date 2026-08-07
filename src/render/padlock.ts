/**
 * The combination padlock, drawn as the thing you hold — D-167's second picture.
 *
 * The first shipped picture reused the disc detainer's concentric-ring face, and the owner
 * rejected it outright: *"the wheels is totally wrong and not what I expect."* What they
 * described from the start was the object everyone owns — *"pull the shackle and rotate the
 * first (nearest) wheel"* — a body, a shackle, and a **row of digit wheels** rolled in place.
 * So this module draws exactly that, front on: the shackle gives under the pull and pops on
 * the open, each wheel is a thumbwheel showing its digit strip through the body, and the
 * "nearest" wheel is simply the leftmost.
 *
 * How much of the inside shows is the owner's call too: **training draws a faint x-ray**
 * under the row — each wheel's core with its gates, and the fence riding them — and every
 * other assist shows a sealed lock, because a combination lock is decoded by feel and the
 * higher rungs are precisely the game not narrating (D-166).
 *
 * This module owns geometry and drawing only. It reads `SimState` and never writes to it.
 */

import type { Chamber, SimState } from '../sim'
import { COMBO_DETENT, COMBO_DIGITS } from '../sim'
import { roundRectPath, text } from './draw'
import type { Fx } from './fx'
import { LOGICAL_WIDTH, typeFor, type Viewport } from './viewport'
import { STROKE, TYPE, alpha, font, readableAccents, type Palette } from './palette'

export interface PadlockLayout {
  readonly count: number
  readonly bodyX: number
  readonly bodyY: number
  readonly bodyW: number
  readonly bodyH: number
  /** One wheel's face width and height. */
  readonly wheelW: number
  readonly wheelH: number
  /** Vertical centre of the wheel row. */
  readonly rowY: number
  /** Horizontal gap between wheels. */
  readonly gap: number
}

/**
 * The shackle exits the body's **right face**, not its top — the owner's call, third round:
 * *"if we move it to the right or left side it will have much more space (like rotate the
 * lock)"*. The top of the pick screen belongs to the header and the rank band and always
 * will; the gutters beside a centred body are the emptiest page in the game. So the lock is
 * drawn rotated: the hook's legs straddle the wheel row's height and its arch bulges into
 * the free right gutter, and no shackle geometry can ever meet the header again.
 */
const SHACKLE_THICK = 54
/** How far the hook shifts outward under a full pull — the give that says the fence is loaded. */
const SHACKLE_GIVE = 22
/**
 * …and how far the WHOLE hook slides once the lock is open. One value for every part of the
 * profile: the first draft popped the toe 104px while the arch kept its 22px give, and the
 * detached toe drew as a loose staple piercing the arch (the owner's "some visual bug with
 * the shackle"). 56 clears the toe's mouth by a readable margin while the long leg (88 deep)
 * visibly stays home in its channel.
 */
const SHACKLE_OPEN_SLIDE = 56
/** Horizontal room reserved beside the body for the arch, at its widest. */
const SHACKLE_REACH = 178
const WHEEL_W = 132
const WHEEL_H = 236
const WHEEL_GAP = 36

export function computePadlockLayout(count: number): PadlockLayout {
  const n = Math.max(1, count)
  const rowW = n * WHEEL_W + (n - 1) * WHEEL_GAP
  const bodyW = Math.max(rowW + 220, 640)
  const bodyH = 470
  return {
    count: n,
    // The body cedes the shackle's reach on the right, so body-plus-hook centres as a group.
    bodyX: LOGICAL_WIDTH / 2 - (bodyW + SHACKLE_REACH) / 2,
    bodyY: 402,
    bodyW,
    bodyH,
    wheelW: WHEEL_W,
    wheelH: WHEEL_H,
    rowY: 618,
    gap: WHEEL_GAP,
  }
}

export function wheelRect(
  layout: PadlockLayout,
  i: number,
): { x: number; y: number; w: number; h: number } {
  const rowW = layout.count * layout.wheelW + (layout.count - 1) * layout.gap
  const left = layout.bodyX + (layout.bodyW - rowW) / 2
  return {
    x: left + i * (layout.wheelW + layout.gap),
    y: layout.rowY - layout.wheelH / 2,
    w: layout.wheelW,
    h: layout.wheelH,
  }
}

/** Which wheel a point is on, or -1 — the touch scheme's hit test. */
export function wheelAtPoint(layout: PadlockLayout, x: number, y: number): number {
  for (let i = 0; i < layout.count; i += 1) {
    const r = wheelRect(layout, i)
    // A finger pad's worth of slack on every side: a 132px wheel is a thumb-sized control.
    if (x >= r.x - 14 && x <= r.x + r.w + 14 && y >= r.y - 20 && y <= r.y + r.h + 20) return i
  }
  return -1
}

/** Where the payoff sequence should centre itself. */
export function padlockCentre(layout: PadlockLayout): { x: number; y: number } {
  return { x: layout.bodyX + layout.bodyW / 2, y: layout.bodyY + layout.bodyH * 0.42 }
}

/**
 * The audit's lock box: the sealed metal above the wheel row, hook included. The digits
 * themselves are the *interface*, exactly as the cutaway's pins are the drawing — chrome must
 * stay off the clean metal, but text on the wheels is the wheels working.
 */
export function padlockAuditBox(layout: PadlockLayout): {
  x: number
  y: number
  w: number
  h: number
} {
  return {
    x: layout.bodyX,
    y: layout.bodyY,
    w: layout.bodyW + SHACKLE_REACH,
    h: layout.rowY - layout.wheelH / 2 - 16 - layout.bodyY,
  }
}

export interface PadlockOptions {
  readonly activeChamber: number
  /** Training only: the x-ray band — cores, gates and the fence riding them (D-166/D-167). */
  readonly showTargets: boolean
  /** Above training the narration is off: state colours go steel (D-166). */
  readonly plainStates?: boolean
  readonly fx: Fx
}

function stateInk(p: Palette, c: Chamber, plain: boolean): string {
  if (plain) return p.steel
  switch (c.state) {
    case 'SET':
      return p.teal
    case 'FALSE_SET':
      return p.violet
    default:
      return p.steel
  }
}

/** The angle a wheel's own body has been turned to, for the x-ray cores. Up is seated. */
function coreAngle(c: Chamber, at: number): number {
  const travel = c.maxLift > 0 ? c.maxLift : 1
  return -Math.PI / 2 + ((at - c.lift) / travel) * Math.PI * 2
}

export function drawPadlock(
  vp: Viewport,
  p: Palette,
  state: SimState,
  layout: PadlockLayout,
  opts: PadlockOptions,
): void {
  const { ctx } = vp
  const plain = opts.plainStates === true
  const readable = readableAccents(p)

  // ── The shackle, which is the wrench ──────────────────────────────────────────────────
  // A side hook out of the right face — the lock drawn rotated, per the owner: the long leg
  // rides deep in the body's upper half, the arch bulges into the free right gutter, and the
  // toe seats in the lower half. Under the pull the whole hook shifts outward — the give a
  // hand reads the fence's load from — and on the open it slides further as one piece, the
  // toe clear of its mouth, the long leg still home.
  const slide = state.opened
    ? SHACKLE_OPEN_SLIDE
    : Math.min(1, state.tension / 0.6) * SHACKLE_GIVE
  const bodyRight = layout.bodyX + layout.bodyW
  const topY0 = layout.bodyY + 62
  const topY1 = topY0 + SHACKLE_THICK
  const toeY1 = layout.bodyY + layout.bodyH - 62
  const toeY0 = toeY1 - SHACKLE_THICK
  const midY = (topY0 + toeY1) / 2
  const arcX = bodyRight - 6 + slide
  const rOut = midY - topY0
  const tipTop = bodyRight - 88 + slide
  const tipToe = bodyRight - 20 + slide
  ctx.save()
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.fillStyle = p.paper
  ctx.beginPath()
  ctx.moveTo(tipTop, topY0)
  ctx.lineTo(arcX, topY0)
  ctx.arc(arcX, midY, rOut, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(tipToe, toeY1)
  ctx.lineTo(tipToe, toeY0)
  ctx.lineTo(arcX, toeY0)
  ctx.arc(arcX, midY, midY - topY1, Math.PI / 2, -Math.PI / 2, true)
  ctx.lineTo(tipTop, topY1)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  // ── The body ──────────────────────────────────────────────────────────────────────────
  ctx.save()
  roundRectPath(ctx, layout.bodyX, layout.bodyY, layout.bodyW, layout.bodyH, 26)
  ctx.fillStyle = p.paperShade
  ctx.fill()
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.stroke()
  // The toe's mouth in the body's edge — drawn over the fill, or the fill would eat it.
  ctx.beginPath()
  ctx.moveTo(bodyRight - 1, toeY0 - 8)
  ctx.lineTo(bodyRight - 1, toeY1 + 8)
  ctx.stroke()
  ctx.restore()

  // ── The wheels ────────────────────────────────────────────────────────────────────────
  const centreSize = typeFor(vp, TYPE.heading)
  const sideSize = typeFor(vp, TYPE.body)
  const pitch = layout.wheelH / 3
  for (const c of state.chambers) {
    if (c.index >= layout.count) continue
    const r = wheelRect(layout, c.index)
    const active = c.index === opts.activeChamber

    ctx.save()
    // The slot the wheel sits in, then the wheel face proud of it.
    roundRectPath(ctx, r.x - 8, r.y - 10, r.w + 16, r.h + 20, 14)
    ctx.fillStyle = alpha(p.ink, 0.08)
    ctx.fill()
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 12)
    ctx.fillStyle = p.paper
    ctx.fill()
    ctx.lineWidth = active ? STROKE.heavy : STROKE.standard
    ctx.strokeStyle = active ? p.ink : p.rule
    ctx.stroke()

    // The digit strip, clipped to the wheel: the current digit through the middle of the
    // window, its neighbours rolled part-way out of it. `pos` is the strip's continuous
    // position — a wheel parked on a detent centre lands its digit dead centre.
    roundRectPath(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 10)
    ctx.clip()
    const pos = c.lift / COMBO_DETENT - 0.5
    const nearest = Math.round(pos)
    for (let k = -2; k <= 2; k += 1) {
      const digit = (((nearest + k) % COMBO_DIGITS) + COMBO_DIGITS) % COMBO_DIGITS
      const yOff = (k - (pos - nearest)) * pitch
      // The window shows three digits; anything further is clipped invisible by the canvas —
      // but the layout probe records every `text()` call regardless of clip, so a digit the
      // player can never see must not be drawn at all, or the audit reads it over the metal.
      // One pixel of slack, because a parked neighbour sits at *exactly* one pitch and float
      // error put it a hair past the line — which culled the digit below the window on half
      // the detents ("when you see 0, upper is 9 but below nothing").
      if (Math.abs(yOff) > pitch + 1) continue
      const centreish = Math.abs(yOff) < pitch * 0.5
      text(ctx, String(digit), r.x + r.w / 2, layout.rowY + yOff + (centreish ? centreSize : sideSize) * 0.36, {
        font: font(centreish ? centreSize : sideSize, centreish ? 'bold' : undefined),
        color: centreish ? p.ink : alpha(p.inkLight, 0.55),
        align: 'center',
      })
    }
    ctx.restore()

    // The window's own edges: two score lines the centre digit sits between, like the
    // stamped read line on a real wheel. Deliberately neutral at every assist — no dimple,
    // no tick, no colour when a wheel is right (owner's rule): the only tell a correct
    // wheel gives is the drag moving on to the next one. Training's x-ray below is the one
    // teaching exception.
    ctx.save()
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = active ? p.ink : p.rule
    ctx.beginPath()
    ctx.moveTo(r.x - 12, layout.rowY - pitch / 2)
    ctx.lineTo(r.x + r.w + 12, layout.rowY - pitch / 2)
    ctx.moveTo(r.x - 12, layout.rowY + pitch / 2)
    ctx.lineTo(r.x + r.w + 12, layout.rowY + pitch / 2)
    ctx.stroke()
    // Roll direction nubs: the ribbed edge a thumb finds.
    ctx.strokeStyle = p.rule
    ctx.lineWidth = STROKE.hairline
    for (let g = 1; g <= 4; g += 1) {
      const gy = r.y + (r.h * g) / 5
      ctx.beginPath()
      ctx.moveTo(r.x - 8, gy)
      ctx.lineTo(r.x - 2, gy)
      ctx.moveTo(r.x + r.w + 2, gy)
      ctx.lineTo(r.x + r.w + 8, gy)
      ctx.stroke()
    }
    ctx.restore()
  }

  // ── Training's x-ray: the cores, their gates, and the fence riding them ───────────────
  if (opts.showTargets) {
    const bandY = layout.rowY + layout.wheelH / 2 + 24
    const coreR = 40
    const coreY = bandY + coreR + 26
    const ghost = alpha(p.ink, 0.45)
    ctx.save()
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = ghost

    // The fence: one bar, one leg per wheel. A seated wheel's leg is dropped into its gate;
    // a false gate holds it partway — the same partial drop the sidebar column showed.
    const seated = (c: Chamber): number =>
      c.state === 'SET' ? 1 : c.state === 'FALSE_SET' ? 0.45 : 0
    const fenceY = bandY + 4
    ctx.beginPath()
    ctx.moveTo(wheelRect(layout, 0).x - 10, fenceY)
    ctx.lineTo(wheelRect(layout, layout.count - 1).x + layout.wheelW + 10, fenceY)
    ctx.stroke()

    for (const c of state.chambers) {
      if (c.index >= layout.count) continue
      const r = wheelRect(layout, c.index)
      const cx = r.x + r.w / 2
      const drop = seated(c) * 14
      ctx.strokeStyle = plain ? ghost : alpha(stateInk(p, c, plain), 0.8)
      ctx.beginPath()
      ctx.moveTo(cx, fenceY)
      ctx.lineTo(cx, coreY - coreR - 8 + drop)
      ctx.stroke()

      // The core: the wheel's hidden middle, turning with it. The true gate is the deep
      // notch, false gates are the shallow ones — the same honesty the cutaway gives a
      // spool's waist. Seated is the gate straight up, under the leg.
      ctx.strokeStyle = ghost
      ctx.beginPath()
      ctx.arc(cx, coreY, coreR, 0, Math.PI * 2)
      ctx.stroke()
      const notch = (at: number, depth: number): void => {
        const a = coreAngle(c, at)
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * coreR, coreY + Math.sin(a) * coreR)
        ctx.lineTo(cx + Math.cos(a) * (coreR - depth), coreY + Math.sin(a) * (coreR - depth))
        ctx.stroke()
      }
      ctx.strokeStyle = plain ? ghost : alpha(readable.teal, 0.85)
      ctx.lineWidth = STROKE.standard
      notch(c.setLift, 16)
      ctx.strokeStyle = plain ? ghost : alpha(p.violet, 0.8)
      ctx.lineWidth = STROKE.hairline
      for (const f of c.falseGates) notch(f, 8)
      ctx.lineWidth = STROKE.hairline
    }
    ctx.restore()
  }
}
