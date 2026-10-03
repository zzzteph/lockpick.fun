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
 * How much of the inside shows is the owner's call too: **lessons and the training rung
 * see the lock from two sides** (D-211) — the flat face you operate, its window frames
 * carrying each wheel's state, and beside it a SIDE-VIEW x-ray of the picked wheel: a full
 * circle with its gates cut into the rim and the fence's tooth riding it. Everything above
 * training shows a sealed lock, because a combination lock is decoded by feel and the
 * higher rungs are precisely the game not narrating (D-166/D-173).
 *
 * This module owns geometry and drawing only. It reads `SimState` and never writes to it.
 */

import type { Chamber, SimState } from '../sim'
import { COMBO_DETENT, COMBO_DIGITS, THETA_OPEN } from '../sim'
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
 * The hand-sized region that means "the shackle" to a pointer (D-188): press and hold
 * anywhere on the hook to PULL. Generous on every side — it is the second-most important
 * control on the screen and it had no pointer story at all ("when you pull the shackle…").
 */
export function shackleGrabRect(layout: PadlockLayout): {
  x: number
  y: number
  w: number
  h: number
} {
  const bodyRight = layout.bodyX + layout.bodyW
  return {
    x: bodyRight - 110,
    y: layout.bodyY + 20,
    w: SHACKLE_REACH + 140,
    h: layout.bodyH - 40,
  }
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
  /**
   * Lessons and the training rung: the two-sided x-ray — state-coloured window frames on
   * the face, and the picked wheel drawn side-on with its gates and the fence's tooth
   * (D-166/D-207..D-211). Everything above training is sealed.
   */
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
    // The one dragging under the pull — the x-ray paints the FEEL (D-208/D-211). Only
    // lessons and training ever reach this: everything above is sealed and plain.
    case 'BINDING':
      return p.amber
    default:
      return p.steel
  }
}

export function drawPadlock(
  vp: Viewport,
  p: Palette,
  state: SimState,
  layout: PadlockLayout,
  opts: PadlockOptions,
): void {
  const { ctx } = vp
  const readable = readableAccents(p)

  // ── The shackle, which is the wrench ──────────────────────────────────────────────────
  // A side hook out of the right face — the lock drawn rotated, per the owner: the long leg
  // rides deep in the body's upper half, the arch bulges into the free right gutter, and the
  // toe seats in the lower half. Under the pull the whole hook shifts outward — the give a
  // hand reads the fence's load from — and on the open it slides further as one piece, the
  // toe clear of its mouth, the long leg still home.
  /*
   * The give. On a sealed face it is the FEEL approximation the owner approved for play —
   * pull harder, see more give. In the x-ray it is the physics itself (D-209, "we need to
   * have real physics representations"): the sim's resolved travel θ, the same number the
   * wheels are actually stopping. So the shackle barely budges against a bound wheel, a
   * false gate visibly buys a few extra millimetres of stroke, each seated wheel lengthens
   * it, and releasing the pull visibly gives it all back.
   */
  const slide = state.opened
    ? SHACKLE_OPEN_SLIDE
    : opts.showTargets
      ? Math.min(1, state.theta / THETA_OPEN) * SHACKLE_GIVE
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
  // The pointer's invitation (D-188): while nothing pulls, two amber chevrons point the
  // way out of the arch — press and hold the hook to pull. They vanish under any pull,
  // because the give itself is the feedback then.
  if (!state.opened && state.tension < 0.05) {
    ctx.strokeStyle = readable.amber
    ctx.lineWidth = STROKE.heavy
    ctx.lineCap = 'round'
    const chevX = arcX + rOut + 16
    for (let k = 0; k < 2; k += 1) {
      ctx.beginPath()
      ctx.moveTo(chevX + k * 22, midY - 14)
      ctx.lineTo(chevX + 14 + k * 22, midY)
      ctx.lineTo(chevX + k * 22, midY + 14)
      ctx.stroke()
    }
  }
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
    // In the x-ray the window frame carries the wheel's verdict (D-211) — amber on the
    // one dragging, teal seated, violet lying — so the pack reads at a glance while the
    // side view explains the one under your hand. Sealed faces stay mute, as ruled.
    ctx.strokeStyle =
      opts.showTargets && opts.plainStates !== true
        ? alpha(stateInk(p, c, false), 0.9)
        : active
          ? p.ink
          : p.rule
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
      // Slack out to 1.5 pitch (D-188): the old pitch+1 cull POPPED the incoming digit at
      // the exact mid-drag frame it crossed the line — read in play as "the numbers on
      // wheels disappear". The window's clip owns the real boundary; this only keeps the
      // audit from reading text drawn fully outside it.
      if (Math.abs(yOff) > pitch * 1.5 + 1) continue
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

  // ── The second side (D-211) ───────────────────────────────────────────────────────────
  if (opts.showTargets) drawWheelSide(vp, p, state, layout, opts)
}

/**
 * The lock's SECOND SIDE: the whole pack, edge-on — DECISIONS D-211, stacked D-212.
 *
 * Three combined-view drawings died before D-211 split the projections ("Isometr is bad…
 * like with have lock from two sides"), and the split's first cut showed one wheel alone.
 * The owner liked it and asked for the pack: *"can we somehow see that they are in line…
 * if wheel is the firts, then we can see the bit of the gate."* So the side view is the
 * STACK now: the first wheel whole in front — knurled rim, digit ring, its gates cut deep
 * — and every wheel behind it peeking out as a ring, each ring carrying the visible BIT
 * of its own true gate and lies at their live angles. Alignment stops being a claim: when
 * the cuts stand in one radial line, you are looking down the open channel, and the open
 * drives the tooth through it.
 *
 * Each wheel's outline wears its state colour (amber dragging, teal seated, violet lying
 * — the face's window frames say the same, so the two views cross-read), the picked wheel
 * is the heavy outline, the hub is the shackle's leg the pack rides on, and the fence's
 * one drawn tooth rides the front rim: down into the cut on a seat, hard on the metal
 * with the amber contact when the front wheel binds.
 */
function drawWheelSide(
  vp: Viewport,
  p: Palette,
  state: SimState,
  layout: PadlockLayout,
  opts: PadlockOptions,
): void {
  const { ctx } = vp
  const plain = opts.plainStates === true
  const readable = readableAccents(p)
  const ghost = alpha(p.ink, 0.75)
  const TAU = Math.PI * 2
  const wrap = (a: number): number => {
    let w = a % TAU
    if (w > Math.PI) w -= TAU
    if (w <= -Math.PI) w += TAU
    return w
  }
  const wheels = state.chambers.filter((ch) => ch.index < layout.count)
  const front = wheels.find((ch) => ch.index === 0)
  if (!front) return
  const picked = Math.max(0, Math.min(opts.activeChamber, layout.count - 1))

  // The front wheel whole; every wheel behind peeks out as an 18px ring. The panel sits
  // in the left gutter at the row's own eye level, and grows leftward with the pack.
  const R = 105
  const BAND = 18
  const outerR = R + BAND * (wheels.length - 1)
  const cx = layout.bodyX - outerR - 48
  const cy = layout.rowY

  const angleOf = (ch: Chamber, at: number): number => {
    const travel = ch.maxLift > 0 ? ch.maxLift : 1
    return wrap(((at - ch.lift) / travel) * TAU) - Math.PI / 2
  }
  // A gate, cut into a wheel's visible edge: the mouth open through the rim stroke, two
  // walls and a floor in the gate's colour. On the rings the cut is exactly the BIT of
  // the deeper wheel's gate the stack lets you see.
  const cut = (ch: Chamber, at: number, rim: number, depth: number, deep: boolean): void => {
    const a = angleOf(ch, at)
    const w = deep ? 0.17 : 0.11
    const edge = plain ? ghost : deep ? readable.teal : alpha(p.violet, 0.85)
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a - w) * (rim + 3), cy + Math.sin(a - w) * (rim + 3))
    ctx.arc(cx, cy, rim + 3, a - w, a + w)
    ctx.lineTo(cx + Math.cos(a + w) * (rim - depth), cy + Math.sin(a + w) * (rim - depth))
    ctx.arc(cx, cy, rim - depth, a + w, a - w, true)
    ctx.closePath()
    ctx.fillStyle = p.paperShade
    ctx.fill()
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = edge
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a - w) * (rim + 3), cy + Math.sin(a - w) * (rim + 3))
    ctx.lineTo(cx + Math.cos(a - w) * (rim - depth), cy + Math.sin(a - w) * (rim - depth))
    ctx.arc(cx, cy, rim - depth, a - w, a + w)
    ctx.lineTo(cx + Math.cos(a + w) * (rim + 3), cy + Math.sin(a + w) * (rim + 3))
    ctx.stroke()
  }

  ctx.save()
  // Deepest wheel first, the front wheel last — each disc drawn whole, each next one
  // covering all but the ring. A breath of shade per step back keeps the stack reading
  // as depth rather than as one flat target.
  for (let i = wheels.length - 1; i >= 0; i -= 1) {
    const ch = wheels[i]
    if (!ch) continue
    const rim = R + BAND * i
    ctx.beginPath()
    ctx.arc(cx, cy, rim, 0, TAU)
    ctx.fillStyle = p.paper
    ctx.fill()
    if (i > 0) {
      ctx.fillStyle = alpha(p.ink, 0.03 * i)
      ctx.fill()
    }
    // Its knurled grip, its state on its outline, and the heavy line on the picked wheel.
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = alpha(p.ink, 0.35)
    for (let k = 0; k < 36; k += 1) {
      const a = (k / 36) * TAU
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * (rim - 6), cy + Math.sin(a) * (rim - 6))
      ctx.lineTo(cx + Math.cos(a) * (rim + 1), cy + Math.sin(a) * (rim + 1))
      ctx.stroke()
    }
    ctx.lineWidth = ch.index === picked ? STROKE.heavy : STROKE.standard
    ctx.strokeStyle = plain ? ghost : alpha(stateInk(p, ch, plain), 0.9)
    ctx.beginPath()
    ctx.arc(cx, cy, rim, 0, TAU)
    ctx.stroke()
    // The bit of every gate this wheel shows: through the ring on the deep wheels, deep
    // into the face on the front one.
    const depth = i === 0 ? 34 : BAND + 4
    const shallow = i === 0 ? 12 : 8
    cut(ch, ch.setLift, rim, depth, true)
    for (const f of ch.falseGates) cut(ch, f, rim, shallow, false)
  }

  // The digits, stamped round the front wheel's face and orbiting live. The one at the
  // TOP is the one showing in the front window — gate and read line share the wheel's
  // zero, which is the whole decode — and the digit passing the true gate sits in its
  // mouth: the gate wears its number. (R−40, so compact faces clear each other — the
  // sweep caught neighbours kissing at R−52.)
  const digitSize = typeFor(vp, TYPE.dimension)
  const frontTravel = front.maxLift > 0 ? front.maxLift : 1
  for (let d = 0; d < COMBO_DIGITS; d += 1) {
    const da = wrap((((d + 0.5) * COMBO_DETENT - front.lift) / frontTravel) * TAU) - Math.PI / 2
    const atTop = Math.abs(wrap(da + Math.PI / 2)) < 0.31
    text(ctx, String(d), cx + Math.cos(da) * (R - 40), cy + Math.sin(da) * (R - 40) + digitSize * 0.36, {
      font: font(digitSize, atTop ? 'bold' : undefined),
      color: atTop ? p.ink : alpha(p.inkLight, 0.6),
      align: 'center',
    })
  }

  // The hub: the shackle's leg, end-on — the whole pack rides on it.
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = ghost
  ctx.beginPath()
  ctx.arc(cx, cy, 22, 0, TAU)
  ctx.fillStyle = p.paperShade
  ctx.fill()
  ctx.stroke()

  // The lined-up channel, celebrated (D-213): the moment every cut stands in one radial
  // row is the whole climax of the mode, and it used to happen without a word. When the
  // pack is fully seated (or open), the channel's walls get one clear emphasis — a soft
  // teal underglow beneath heavy edges, from the outer rim down to the front wheel's
  // floor, right where the tooth is about to drive through.
  const allSet = wheels.every((ch) => ch.state === 'SET')
  if ((allSet || state.opened) && !plain) {
    const a = angleOf(front, front.setLift)
    const w = 0.17
    const chanTop = outerR + 3
    const chanFloor = R - 34
    ctx.save()
    for (const pass of [
      { width: 10, colour: alpha(readable.teal, 0.22) },
      { width: STROKE.heavy, colour: readable.teal },
    ]) {
      ctx.lineWidth = pass.width
      ctx.strokeStyle = pass.colour
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a - w) * chanTop, cy + Math.sin(a - w) * chanTop)
      ctx.lineTo(cx + Math.cos(a - w) * chanFloor, cy + Math.sin(a - w) * chanFloor)
      ctx.moveTo(cx + Math.cos(a + w) * chanTop, cy + Math.sin(a + w) * chanTop)
      ctx.lineTo(cx + Math.cos(a + w) * chanFloor, cy + Math.sin(a + w) * chanFloor)
      ctx.stroke()
    }
    ctx.restore()
  }

  // The fence, in section: the bar and the one drawn tooth, riding the FRONT wheel's rim
  // over the rings — which is the true occlusion, the front wheel's tooth being nearest.
  // PRESSED only while the pull is on (D-213): release, and the tooth visibly lifts a
  // hair clear of the wheel — which is the escape move drawn, the same one the dial
  // hint teaches: a lie only holds the tooth while something presses it in. Under pull:
  // seated sits down inside the clear cut, a lie stops at the shallow floor, the binder
  // presses solid metal. The open sends it through the lined-up channel.
  const barW = 128
  const barH = 14
  const barY = cy - outerR - 46
  const pulling = state.opened || state.tension > 0.05
  const drop = state.opened ? 40 : front.state === 'SET' ? 26 : front.state === 'FALSE_SET' ? 9 : 0
  const tipY = pulling ? cy - R + drop : cy - R - 6
  ctx.fillStyle = p.paper
  ctx.fillRect(cx - barW / 2, barY, barW, barH)
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = ghost
  ctx.strokeRect(cx - barW / 2, barY, barW, barH)
  ctx.fillStyle = p.paper
  ctx.fillRect(cx - 13, barY + barH, 26, tipY - (barY + barH))
  ctx.fillStyle = plain ? alpha(ghost, 0.35) : alpha(stateInk(p, front, plain), 0.55)
  ctx.fillRect(cx - 13, barY + barH, 26, tipY - (barY + barH))
  ctx.strokeRect(cx - 13, barY + barH, 26, tipY - (barY + barH))
  // The jam, lit at the contact and keyed to the pull being held.
  if (!state.opened && front.state === 'BINDING' && state.tension > 0.05) {
    ctx.lineWidth = STROKE.heavy
    ctx.strokeStyle = readable.amber
    ctx.beginPath()
    ctx.moveTo(cx - 16, tipY)
    ctx.lineTo(cx + 16, tipY)
    ctx.stroke()
  }
  ctx.restore()

  // Names, and what this drawing is: the callouts stay put and the leader lines chase
  // the geometry, exactly as the help screen's anatomy pages do.
  const labelSize = typeFor(vp, TYPE.dimension)
  text(ctx, 'fence', cx - barW / 2 - 12, barY + barH / 2 + labelSize * 0.36, {
    font: font(labelSize),
    color: ghost,
    align: 'right',
  })
  // Which ring is which wheel, said in numerals (D-213): a small column at the pack's
  // lower right, one hairline out to each rim. In the band itself a numeral would not
  // fit the compact face; out here the column has all the room it needs and still stops
  // short of the body's edge.
  const numeralX = layout.bodyX - 14
  for (const ch of wheels) {
    const rim = R + BAND * ch.index
    const ny = cy + 34 + ch.index * labelSize * 1.5
    const a = Math.asin(Math.min(1, (ny - cy) / rim))
    ctx.save()
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = alpha(ghost, 0.5)
    ctx.beginPath()
    ctx.moveTo(numeralX - labelSize * 0.8, ny - labelSize * 0.14)
    ctx.lineTo(cx + Math.cos(a) * (rim - 4), cy + Math.sin(a) * (rim - 4))
    ctx.stroke()
    ctx.restore()
    text(ctx, String(ch.index + 1), numeralX, ny + labelSize * 0.36, {
      font: font(labelSize),
      color: ch.index === picked ? p.ink : p.inkLight,
      align: 'right',
    })
  }
  // The gate callouts sit UNDER the pack and read rightward — left-of-the-circle labels
  // grew off the stage's left edge at the compact face, and a label that has to fight
  // the bezel is a label in the wrong place. Leaders climb from the words to the cuts.
  const labelLeft = cx - outerR + 2
  const callout = (name: string, ly: number, at: number, colour: string): void => {
    const a = angleOf(front, at)
    ctx.save()
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = alpha(colour, 0.65)
    ctx.beginPath()
    ctx.moveTo(labelLeft + 8, ly - labelSize * 0.5)
    ctx.lineTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12))
    ctx.stroke()
    ctx.restore()
    text(ctx, name, labelLeft, ly + labelSize * 0.36, {
      font: font(labelSize),
      color: colour,
      align: 'left',
    })
  }
  callout('gate', cy + outerR + 30, front.setLift, plain ? ghost : readable.teal)
  const firstFalse = front.falseGates[0]
  if (firstFalse !== undefined) {
    callout(
      'false gate',
      cy + outerR + 30 + labelSize * 1.9,
      firstFalse,
      plain ? ghost : readable.violet,
    )
  }
  // What this drawing is, said once, up top where nothing else lives.
  text(ctx, 'the pack, side on', cx, barY - 14, {
    font: font(labelSize),
    color: p.inkLight,
    align: 'center',
  })
}
