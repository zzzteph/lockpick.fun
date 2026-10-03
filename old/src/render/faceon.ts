/**
 * Face-on views — `SIMULATION.md §10`, `PHASES.md` Phase 10.
 *
 * Two of the Tier 5 families cannot be drawn in the side cutaway the rest of the game uses,
 * for the same reason they cannot be picked with the same hand movement: nothing about them
 * happens along a line. A disc detainer is a stack of discs each turned to an angle; a tubular
 * lock is the ordinary pin stack bent into a circle. Both are drawn looking down the keyway.
 *
 * The two views are the same picture with the roles of the two polar axes swapped, and so are
 * the two input schemes:
 *
 * | family        | ring picks | angle picks |
 * |---------------|------------|-------------|
 * | disc detainer | the disc   | its angle   |
 * | tubular       | —          | the pin     |
 *
 * so on a disc detainer the pointer's distance from the middle chooses which disc and its
 * bearing turns that disc, while on a tubular the bearing chooses the pin and the distance
 * pushes it in. Both read naturally as "where my tool is", which is the whole point.
 *
 * This module owns geometry and drawing only. It reads `SimState` and never writes to it.
 */

import type { Chamber, SimState } from '../sim'
import { DRIVER_LENGTH, captureRange } from '../sim'
import { driverFill } from './cutaway'
import { hatchPath, text } from './draw'
import type { Fx } from './fx'
import { chamberOffsetY } from './fx'
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, typeFor, type Viewport } from './viewport'
import { STROKE, TYPE, font, type Palette } from './palette'

export type FaceKind = 'disc-detainer' | 'tubular'

export interface FaceLayout {
  readonly kind: FaceKind
  readonly cx: number
  readonly cy: number
  /** Radius of the innermost ring's inner edge. */
  readonly rInner: number
  /** Radius of the outermost ring's outer edge. */
  readonly rOuter: number
  readonly count: number
  /** Radial thickness of one disc ring. Zero for tubular. */
  readonly ringPitch: number
  /** Plug rotation carried through so the whole face can turn with it. */
  readonly theta: number
}

/**
 * Centre of the stage, a little above the middle to leave room for the HUD.
 *
 * The radius went from 330 to 420. The face-on view is the clearest picture in the game — it is
 * the only one where you see the whole mechanism at once rather than a section through it — and it
 * was sitting in the middle of the frame at two thirds of the size it had room for. The header
 * ends at y = 88 and the footer starts at y = 940, so a 420 radius centred at 480 uses the space
 * between them almost exactly. Asked for directly: "I really like the view that shows the lock
 * from the other side, but the lock could be bigger." See DECISIONS D-063.
 */
const CENTRE_Y = 480
const R_OUTER = 420
const R_INNER_FRACTION = 0.26
/** Gap drawn between rings so the discs read as separate plates. */
const RING_GAP = 3

export function computeFaceLayout(count: number, kind: FaceKind, theta: number): FaceLayout {
  const n = Math.max(1, count)
  const rInner = R_OUTER * R_INNER_FRACTION
  return {
    kind,
    cx: LOGICAL_WIDTH / 2,
    cy: CENTRE_Y,
    rInner,
    rOuter: R_OUTER,
    count: n,
    ringPitch: kind === 'disc-detainer' ? (R_OUTER - rInner) / n : 0,
    theta,
  }
}

/** Inner and outer radius of disc `i`. Disc 0 is the outermost — the one nearest the face. */
export function ringRadii(layout: FaceLayout, i: number): { inner: number; outer: number } {
  const outer = layout.rOuter - i * layout.ringPitch
  return { inner: Math.max(layout.rInner, outer - layout.ringPitch + RING_GAP), outer }
}

/**
 * Where a tubular lock's pin `i` sits around the face.
 *
 * Pin 0 is at the top and the rest run clockwise, which is how a tubular key's cuts are
 * numbered and, more usefully, means the pin under the pointer is the pin the pointer is
 * pointing at.
 */
export function pinAngle(layout: FaceLayout, i: number): number {
  return -Math.PI / 2 + (i / layout.count) * Math.PI * 2 + layout.theta
}

/** Turn a lift, in mm, into the angle a disc has been turned to. */
export function discAngle(c: Chamber, lift: number, theta: number): number {
  const travel = c.maxLift > 0 ? c.maxLift : 1
  return -Math.PI / 2 + (lift / travel) * Math.PI * 2 + theta
}

/** The inverse: a bearing on screen back to the lift that would produce it. */
export function liftForAngle(c: Chamber, angle: number, theta: number): number {
  const travel = c.maxLift > 0 ? c.maxLift : 1
  let turn = angle - theta + Math.PI / 2
  turn = ((turn % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return (turn / (Math.PI * 2)) * travel
}

/** Bearing of a point from the face's centre, in the same convention as `pinAngle`. */
export function bearingAt(layout: FaceLayout, x: number, y: number): number {
  return Math.atan2(y - layout.cy, x - layout.cx)
}

export function radiusAt(layout: FaceLayout, x: number, y: number): number {
  return Math.hypot(x - layout.cx, y - layout.cy)
}

/**
 * Which chamber the pointer is on, or -1 when it is off the face entirely.
 *
 * Off the face means out of the lock: on a disc detainer, further out than the last ring or
 * inside the core; on a tubular, outside the pin circle. Both give the player somewhere to
 * park the tool without touching anything, which the cutaway gets for free by having edges.
 */
export function chamberAtPointer(layout: FaceLayout, x: number, y: number): number {
  const r = radiusAt(layout, x, y)
  if (layout.kind === 'disc-detainer') {
    if (r > layout.rOuter || r < layout.rInner) return -1
    const i = Math.floor((layout.rOuter - r) / layout.ringPitch)
    return i >= 0 && i < layout.count ? i : -1
  }
  if (r > layout.rOuter + 30 || r < layout.rInner * 0.5) return -1
  // Nearest pin by bearing. `pinAngle` already includes θ, so the ring of pins turns with
  // the plug and the pointer keeps pointing at the same physical pin as it goes round.
  let best = -1
  let bestGap = Infinity
  const b = bearingAt(layout, x, y)
  for (let i = 0; i < layout.count; i += 1) {
    const gap = Math.abs(angleDelta(b, pinAngle(layout, i)))
    if (gap < bestGap) {
      bestGap = gap
      best = i
    }
  }
  // Half a pin's share of the circle, so there is always exactly one nearest pin.
  return bestGap <= Math.PI / layout.count ? best : -1
}

/** Signed difference between two bearings, wrapped to (-π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d <= -Math.PI) d += Math.PI * 2
  return d
}

/**
 * What the pointer is asking for, in the chamber's own units.
 *
 * A disc reads the pointer's bearing as an angle; a tubular pin reads its distance from the
 * centre as a lift, pushed in from the rim towards the middle exactly as a tubular pick pushes
 * its feelers inward.
 */
export function valueAtPointer(
  layout: FaceLayout,
  c: Chamber,
  x: number,
  y: number,
): number {
  if (layout.kind === 'disc-detainer') {
    return liftForAngle(c, bearingAt(layout, x, y), layout.theta)
  }
  const span = layout.rOuter - layout.rInner
  const depth = (layout.rOuter - radiusAt(layout, x, y)) / (span > 0 ? span : 1)
  return Math.max(0, depth) * c.maxLift
}

// ── Drawing ─────────────────────────────────────────────────────────────────────────────

function arc(
  ctx: CanvasRenderingContext2D,
  layout: FaceLayout,
  r: number,
  from: number,
  to: number,
): void {
  ctx.beginPath()
  ctx.arc(layout.cx, layout.cy, r, from, to)
}

function ringPath(
  ctx: CanvasRenderingContext2D,
  layout: FaceLayout,
  inner: number,
  outer: number,
): void {
  ctx.beginPath()
  ctx.arc(layout.cx, layout.cy, outer, 0, Math.PI * 2)
  ctx.arc(layout.cx, layout.cy, inner, 0, Math.PI * 2, true)
}

/** A gate notch: a wedge cut out of a ring's outer edge, drawn as a filled sector. */
function gatePath(
  ctx: CanvasRenderingContext2D,
  layout: FaceLayout,
  inner: number,
  outer: number,
  centre: number,
  halfWidth: number,
): void {
  ctx.beginPath()
  ctx.arc(layout.cx, layout.cy, outer, centre - halfWidth, centre + halfWidth)
  ctx.arc(layout.cx, layout.cy, inner, centre + halfWidth, centre - halfWidth, true)
  ctx.closePath()
}

/**
 * Which chamber the plug is pinching is Guided-mode information (`GAME_DESIGN.md §4`, D-043),
 * so outside Guided a binding chamber is inked exactly like a free one.
 */
function stateInk(p: Palette, c: Chamber, showBinding = true): string {
  switch (c.state) {
    case 'SET':
      return p.teal
    case 'OVERSET':
      return p.crimson
    case 'FALSE_SET':
      return p.violet
    case 'BINDING':
      return showBinding ? p.amber : p.steel
    default:
      return p.steel
  }
}

export interface FaceOptions {
  readonly activeChamber: number
  readonly showTargets: boolean
  readonly fx: Fx
  /** What the chambers are called on this lock, for the hint line. Defaults to "pin". */
  readonly chamberNoun?: string
  /**
   * The D-166 ladder, as it lands on a face: geometry cannot be taken away here — the face is
   * the *outside* of the lock, and a hand can always see where its own wheels are turned — so
   * what the ladder silences is the narration: state colours and the captured hatch go steel.
   */
  readonly plainStates?: boolean
}

/**
 * The sidebar, drawn as a bar lying along the top of the face.
 *
 * It is the whole story of a disc detainer in one element: it rides on the discs, drops into
 * whatever notch is under it, and only reaches the bottom when every notch beneath it is a
 * true one. Partial drops are the false gates lying, and they are visible as such.
 */
function drawSidebar(
  vp: Viewport,
  p: Palette,
  layout: FaceLayout,
  state: SimState,
  plainStates = false,
): void {
  const { ctx } = vp
  const x = layout.cx + layout.rOuter + 46
  const top = layout.cy - layout.rOuter + 14
  const height = layout.rOuter * 2
  const settled = state.chambers.filter((c) => c.state === 'SET').length
  const cheated = state.chambers.filter((c) => c.state === 'FALSE_SET').length
  const drop = (settled + cheated * 0.45) / Math.max(1, state.chambers.length)

  ctx.save()
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.rule
  ctx.strokeRect(x, top, 22, height)
  const barH = 54
  const y = top + (height - barH) * Math.min(1, drop)
  // The bar's POSITION stays at every level — shackle give is a thing a hand feels — but its
  // colour is narration, and above training the narration is off (D-166).
  ctx.fillStyle = plainStates
    ? p.steel
    : state.sidebarDropped
      ? p.teal
      : cheated > 0
        ? p.violet
        : p.steel
  ctx.fillRect(x + 3, y, 16, barH)
  ctx.strokeStyle = p.ink
  ctx.lineWidth = STROKE.standard
  ctx.strokeRect(x + 3, y, 16, barH)
  ctx.restore()

  text(ctx, 'sidebar', x + 11, top - 14, {
    font: font(typeFor(vp, TYPE.dimension)),
    color: p.inkLight,
    align: 'center',
  })
}

function drawDiscFace(
  vp: Viewport,
  p: Palette,
  state: SimState,
  layout: FaceLayout,
  opts: FaceOptions,
): void {
  const { ctx } = vp
  for (const c of state.chambers) {
    const { inner, outer } = ringRadii(layout, c.index)
    const active = c.index === opts.activeChamber
    const ink = opts.plainStates === true ? p.steel : stateInk(p, c, opts.showTargets)

    ctx.save()
    ringPath(ctx, layout, inner, outer)
    ctx.fillStyle = p.paperShade
    ctx.fill('evenodd')
    // A set disc is filled with the same hatch a set driver gets in the cutaway, so the two
    // views say "captured" the same way.
    if (opts.plainStates !== true && (c.state === 'SET' || c.state === 'FALSE_SET')) {
      hatchPath(
        ctx,
        () => ringPath(ctx, layout, inner, outer),
        { x: layout.cx - outer, y: layout.cy - outer, w: outer * 2, h: outer * 2 },
        { spacing: 7, angleDeg: 45, color: ink, lineWidth: STROKE.hairline, fillRule: 'evenodd' },
      )
    }
    ctx.lineWidth = active ? STROKE.heavy : STROKE.standard
    ctx.strokeStyle = active ? p.ink : p.rule
    arc(ctx, layout, outer, 0, Math.PI * 2)
    ctx.stroke()
    arc(ctx, layout, inner, 0, Math.PI * 2)
    ctx.stroke()

    // False gates first, then the true one over the top: a false gate is a shallower notch,
    // so it is drawn shallower, and the difference is exactly what the player is hunting.
    const half = (c.captureWindow / Math.max(1e-6, c.maxLift)) * Math.PI
    for (const f of c.falseGates) {
      gatePath(ctx, layout, outer - (outer - inner) * 0.45, outer, discAngle(c, f, layout.theta), half)
      ctx.fillStyle = p.paper
      ctx.fill()
      ctx.lineWidth = STROKE.hairline
      ctx.strokeStyle = p.violet
      ctx.stroke()
    }
    if (opts.showTargets) {
      gatePath(ctx, layout, inner, outer, discAngle(c, c.setLift, layout.theta), half)
      ctx.fillStyle = p.paper
      ctx.fill()
      ctx.lineWidth = STROKE.standard
      ctx.strokeStyle = p.teal
      ctx.stroke()
    }

    // The index mark: where this disc has actually been turned to. It is the one thing on the
    // face the player is steering, so it is the heaviest mark on the ring and it overhangs
    // both edges — a pointer, not a spoke.
    const a = discAngle(c, c.lift, layout.theta)
    ctx.lineWidth = STROKE.heavy
    ctx.strokeStyle = ink
    ctx.beginPath()
    ctx.moveTo(layout.cx + Math.cos(a) * (inner - 4), layout.cy + Math.sin(a) * (inner - 4))
    ctx.lineTo(layout.cx + Math.cos(a) * (outer + 4), layout.cy + Math.sin(a) * (outer + 4))
    ctx.stroke()
    ctx.fillStyle = ink
    ctx.beginPath()
    ctx.arc(
      layout.cx + Math.cos(a) * (inner + outer) / 2,
      layout.cy + Math.sin(a) * (inner + outer) / 2,
      active ? 5 : 3.5,
      0,
      Math.PI * 2,
    )
    ctx.fill()
    ctx.restore()

    // Disc number, laid down a diagonal rather than a radius: at ten rings to a face the
    // pitch is 24px, which is not enough vertical room for a label, but a diagonal turns that
    // same pitch into 17px of separation in *both* axes and the numbers stop colliding.
    const labelR = (inner + outer) / 2
    const la = Math.PI * 0.78
    text(ctx, String(c.index + 1), layout.cx + Math.cos(la) * labelR, layout.cy + Math.sin(la) * labelR + 4, {
      font: font(typeFor(vp, TYPE.dimension)),
      color: active ? p.ink : p.inkLight,
      align: 'center',
    })

    if (active) {
      text(ctx, `disc ${c.index + 1}`, layout.cx, layout.cy + 5, {
        font: font(typeFor(vp, TYPE.body)),
        color: p.ink,
        align: 'center',
      })
    }
  }
  drawSidebar(vp, p, layout, state, opts.plainStates === true)
}

/**
 * The tubular view is a *fan*: the barrel's chambers unrolled around the face, each drawn as a
 * radial channel with lift running inward. It is a cutaway seen down the axis rather than
 * across it, and it is measured the same way — one millimetre scale shared by every spoke,
 * with a single shear circle every chamber's key/driver junction has to reach.
 *
 * Sharing the scale is the whole point. Normalising each spoke by its own travel would be
 * easier and would put the shear line at a different radius on every one, which is exactly the
 * information a pin tumbler player reads first.
 */
function tubularScale(layout: FaceLayout): { shear: number; pxPerMm: number } {
  const span = layout.rOuter - layout.rInner
  const shear = layout.rInner + span * 0.42
  // The deepest cut in the game still fits between the shear circle and the rim.
  return { shear, pxPerMm: (layout.rOuter - shear) / 3.2 }
}

function drawTubularFace(
  vp: Viewport,
  p: Palette,
  state: SimState,
  layout: FaceLayout,
  opts: FaceOptions,
): void {
  const { ctx } = vp
  const { shear, pxPerMm } = tubularScale(layout)
  const core = layout.rInner * 0.5
  const halfWidth = Math.PI / layout.count - 0.03

  ctx.save()
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = p.rule
  arc(ctx, layout, layout.rOuter, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  for (const c of state.chambers) {
    const a = pinAngle(layout, c.index)
    const active = c.index === opts.activeChamber
    const cap = captureRange(c)
    // Shear-relative: lift = setLift puts the junction exactly on the shear circle.
    const toR = (mm: number): number => shear + (c.setLift - mm) * pxPerMm

    ctx.save()
    ctx.translate(0, chamberOffsetY(opts.fx, c.index))
    // The chamber bore: the channel this pin slides along, pointing at the middle.
    gatePath(ctx, layout, core, layout.rOuter, a, halfWidth)
    ctx.fillStyle = p.paperShade
    ctx.fill()
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = p.rule
    ctx.stroke()

    if (opts.showTargets) {
      gatePath(ctx, layout, toR(cap.high), toR(cap.low), a, halfWidth)
      ctx.fillStyle = p.paper
      ctx.fill()
      ctx.lineWidth = STROKE.hairline
      ctx.strokeStyle = p.teal
      ctx.stroke()
    }

    // Key pin below the junction, driver above it — "above" being inward, because that is the
    // way the tool pushes. Both clipped to the bore, exactly as the cutaway clips them.
    const junction = toR(c.lift)
    gatePath(
      ctx,
      layout,
      Math.max(core, junction),
      Math.min(layout.rOuter, junction + c.keyPinLength * pxPerMm),
      a,
      halfWidth * 0.62,
    )
    ctx.fillStyle = p.steel
    ctx.fill()
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.stroke()

    gatePath(
      ctx,
      layout,
      Math.max(core, junction - DRIVER_LENGTH * pxPerMm),
      Math.max(core, junction),
      a,
      halfWidth * 0.62,
    )
    // Filled with the state colour, not outlined in it — the same language the cutaway uses,
    // so a player coming to their first tubular already knows what teal means.
    ctx.fillStyle = driverFill(p, c, opts.fx, opts.plainStates === true)
    ctx.fill()
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.stroke()
    ctx.restore()

    const labelR = layout.rOuter + 26
    text(ctx, String(c.index + 1), layout.cx + Math.cos(a) * labelR, layout.cy + Math.sin(a) * labelR + 5, {
      font: font(typeFor(vp, TYPE.dimension)),
      color: active ? p.ink : p.inkLight,
      align: 'center',
    })
  }

  // The active chamber gets the same focus outline the cutaway draws, over the bore rather
  // than under the pins, so it frames the chamber instead of colouring it in.
  const focus = state.chambers[opts.activeChamber]
  if (focus) {
    ctx.save()
    gatePath(ctx, layout, core, layout.rOuter, pinAngle(layout, focus.index), halfWidth)
    ctx.lineWidth = STROKE.heavy
    ctx.strokeStyle = p.ink
    ctx.stroke()
    ctx.restore()
  }

  // The shear line last and over everything, because it is still the strongest line on screen
  // (ART_DIRECTION.md §4) — here it is a circle rather than a rule, and nothing else changes.
  ctx.save()
  ctx.lineWidth = STROKE.heavy
  ctx.strokeStyle = p.ink
  arc(ctx, layout, shear, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

export function drawFaceOn(
  vp: Viewport,
  p: Palette,
  state: SimState,
  layout: FaceLayout,
  opts: FaceOptions,
): void {
  if (layout.kind === 'disc-detainer') drawDiscFace(vp, p, state, layout, opts)
  else drawTubularFace(vp, p, state, layout, opts)

  const noun = opts.chamberNoun ?? 'pin'
  text(
    vp.ctx,
    layout.kind === 'disc-detainer'
      ? 'looking down the keyway — move out and in to choose a disc, around to turn it'
      : `looking down the keyway — move around to choose a ${noun}, inward to push it`,
    LOGICAL_WIDTH / 2,
    LOGICAL_HEIGHT - 176,
    { font: font(typeFor(vp, TYPE.dimension)), color: p.inkLight, align: 'center' },
  )
}

/** Where the tool tip is, for drawing it and for the pointer-position test hook. */
export function toolTip(
  layout: FaceLayout,
  c: Chamber | undefined,
  target: number,
): { x: number; y: number } {
  if (!c) return { x: layout.cx, y: layout.cy }
  if (layout.kind === 'disc-detainer') {
    const { inner, outer } = ringRadii(layout, c.index)
    const a = discAngle(c, target, layout.theta)
    const r = (inner + outer) / 2
    return { x: layout.cx + Math.cos(a) * r, y: layout.cy + Math.sin(a) * r }
  }
  const a = pinAngle(layout, c.index)
  const span = layout.rOuter - layout.rInner
  const r = layout.rOuter - (Math.min(target, c.maxLift) / Math.max(1e-6, c.maxLift)) * span
  return { x: layout.cx + Math.cos(a) * r, y: layout.cy + Math.sin(a) * r }
}

/**
 * The tool, drawn where the player is actually asking for.
 *
 * A disc-detainer tool is a bar that reaches in to one disc and turns it; a tubular pick is a
 * ring of feelers pushing inward. Both are drawn as the tip plus the shaft back to the rim, so
 * the player can see which chamber they have hold of without hunting for a highlight.
 */
export function drawFaceTool(
  vp: Viewport,
  p: Palette,
  layout: FaceLayout,
  state: SimState,
  input: { chamber: number; liftTarget: number },
): void {
  const c = input.chamber >= 0 ? state.chambers[input.chamber] : undefined
  if (!c) return
  const { ctx } = vp
  const tip = toolTip(layout, c, input.liftTarget)
  const a = Math.atan2(tip.y - layout.cy, tip.x - layout.cx)
  const shaftR = layout.rOuter + 70

  ctx.save()
  ctx.lineWidth = STROKE.heavy
  ctx.strokeStyle = p.ink
  ctx.beginPath()
  ctx.moveTo(layout.cx + Math.cos(a) * shaftR, layout.cy + Math.sin(a) * shaftR)
  ctx.lineTo(tip.x, tip.y)
  ctx.stroke()
  ctx.fillStyle = p.amber
  ctx.beginPath()
  ctx.arc(tip.x, tip.y, 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = STROKE.standard
  ctx.stroke()
  ctx.restore()
}

/**
 * The family's view. Everything else stays in the side cutaway.
 *
 * A radial slider is a Bramah: sliders arranged round a circle, each pushed to a *depth* — the
 * same fan the tubular uses, drawn with the same shared millimetre scale, because it is the
 * same picture. What differs is the simulation underneath: a slider is a wafer, blocking in
 * both directions, so the depth has to be *found* rather than crossed.
 */
export function faceKindFor(family: string): FaceKind | null {
  if (family === 'disc-detainer') return 'disc-detainer'
  // NOT the combination family: its second picture is `render/padlock.ts` — the owner
  // rejected the ring dial outright ("the wheels is totally wrong"), and the wheel pack is
  // drawn as the padlock it is. D-167.
  if (family === 'tubular' || family === 'radial-slider') return 'tubular'
  return null
}
