/**
 * The pick — ART_DIRECTION.md §5.
 *
 * Drawn as a real tool: a shaft entering from the right along the keyway, ending in a hook
 * whose tip sits under the chamber the player has selected, at the pin's *actual* lift. The
 * gap between where the tip is and where the mouse asked it to be is the force the player is
 * applying, and Phase 3 turns that into the shaft's flex curve.
 */

import type { SimState } from '../sim'
import { KEYWAY_FLOOR } from '../sim'
import { STROKE, alpha, mix, type Palette } from './palette'
import { KEYWAY_BOTTOM_MM, mmToY, plugChamberX, type CutawayLayout } from './layout'
import { type Viewport } from './viewport'

export interface PickRender {
  /** Chamber the tip is under, or -1 when the pick is out of the lock. */
  readonly chamber: number
  /** Where the tip is drawn, in logical px along the keyway. */
  readonly tipX: number
  /** Millimetre height of the tip — normally the pin's lift. */
  readonly tipMm: number
  /** How far the shaft bows, in logical px. Positive bows downward (pin pushing back). */
  readonly flex: number
}

/**
 * The height the hook's tip rests at, at an arbitrary point along the keyway.
 *
 * Directly beneath a chamber this is that chamber's **key pin** — the lower of the two bodies in
 * the stack, and the only one the pick can ever touch. Between two chambers it is interpolated,
 * because a hook dragged along a keyway rides across the bottoms of the key pins rather than
 * jumping between them.
 *
 * It read `c.lift`, the *driver*, which was the same number until the stack was split into two
 * bodies (D-042). After that, every captured chamber — driver held up at the shear line, key pin
 * fallen back onto the pick — drew the hook a millimetre and a half up inside the key pin it was
 * supposed to be resting under. Visible in `phase-03-mid-lift.png`, invisible to every test in
 * the suite, because nothing asserts what the pick is touching.
 */
function tipLiftAt(state: SimState, layout: CutawayLayout, x: number): number {
  const chambers = state.chambers
  if (chambers.length === 0) return 0
  let left = 0
  for (let i = 0; i < chambers.length; i += 1) {
    if (plugChamberX(layout, i) <= x) left = i
  }
  const right = Math.min(chambers.length - 1, left + 1)
  const lx = plugChamberX(layout, left)
  const rx = plugChamberX(layout, right)
  const a = chambers[left]?.keyLift ?? 0
  const b = chambers[right]?.keyLift ?? 0
  if (right === left || rx === lx) return a
  const t = Math.min(1, Math.max(0, (x - lx) / (rx - lx)))
  return a + (b - a) * t
}

/**
 * Where the pick tip actually is, given the sim state.
 *
 * Drawn at `state.pickPosition` — the simulation's own **continuous** position along the keyway
 * (D-045) — interpolated between the two chambers it lies between, so the tip slides visibly and
 * rides over the key pins as it goes.
 *
 * Two earlier versions of this were both wrong, in opposite directions. The first snapped to the
 * selected chamber's centre, which made the pick *teleport* from pin to pin: the largest, most
 * continuous input in the game was the one thing the picture did not show (D-039). The second
 * drew it at the mouse pointer, which was smooth but was the *hand* rather than the tool, and
 * became meaningless the moment the mouse stopped being a picking input (D-059). The sim's own
 * position is both smooth and true, and it is the same for every input scheme.
 */
export function pickRender(
  state: SimState,
  layout: CutawayLayout,
  flex = 0,
  /**
   * How high the player is currently asking the tip to go, in mm of lift. Infinity when unknown.
   *
   * The tip rides the key pin **only while it is under one**. A magnetically held pin stays up on
   * its own (`MAGNETIC_RETURN` is a crawl by design, D-066) — and because the tip was drawn at the
   * key pin's height unconditionally, letting go of the lift left the pick hanging in the air
   * against the underside of a pin it was no longer touching. Reported as *"with magnetic pins, you
   * lift it and release the pressure and the lockpick is still glued to the pin."*
   *
   * The sim was right and the drawing was wrong: it is a `min`, not a follow. Lower your hand and
   * the tip comes down; the pin stays where the magnet holds it, which is the whole tell.
   * See DECISIONS D-101.
   */
  askedMm = Number.POSITIVE_INFINITY,
): PickRender {
  if (state.pickChamber < 0 || state.pickPosition < 0) {
    return { chamber: -1, tipX: 0, tipMm: KEYWAY_FLOOR, flex }
  }
  const last = state.chambers.length - 1
  const at = Math.min(Math.max(state.pickPosition, 0), last)
  const lo = Math.floor(at)
  const hi = Math.min(last, lo + 1)
  const loX = plugChamberX(layout, lo)
  const tipX = hi === lo ? loX : loX + (plugChamberX(layout, hi) - loX) * (at - lo)
  return {
    chamber: state.pickChamber,
    tipX,
    tipMm: KEYWAY_FLOOR + Math.min(tipLiftAt(state, layout, tipX), Math.max(0, askedMm)),
    flex,
  }
}

/** One sample along the tool's centreline: where it is, and how thick it is there. */
interface Rib {
  readonly x: number
  readonly y: number
  /** Half the steel's thickness at this point, in logical px. */
  readonly half: number
}

/** Sample a quadratic Bézier, tapering the thickness linearly along it. */
function ribs(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  halfFrom: number,
  halfTo: number,
  steps: number,
  skipFirst = false,
): Rib[] {
  const out: Rib[] = []
  for (let i = skipFirst ? 1 : 0; i <= steps; i += 1) {
    const t = i / steps
    const u = 1 - t
    out.push({
      x: u * u * x0 + 2 * u * t * cx + t * t * x1,
      y: u * u * y0 + 2 * u * t * cy + t * t * y1,
      half: halfFrom + (halfTo - halfFrom) * t,
    })
  }
  return out
}

/**
 * A pick is a **shape**, not a line: a strip of spring steel milled from thick at the handle to a
 * tip fine enough to slip past a key pin, and it has two edges you can see.
 *
 * So it is drawn as a closed silhouette — up one side of the centreline and back down the other,
 * offsetting each sample along its own normal — filled with steel, outlined in ink, with a
 * highlight run along the upper edge where a round-backed piece of steel catches the light.
 *
 * Stroking a path with a varying `lineWidth` cannot do this: canvas has one width per stroke, so
 * the previous attempt drew the shaft in three fixed-width pieces, and three quadratics that each
 * added their own sag produced a visible wave down a tool that is supposed to be straight.
 */
function drawSteel(ctx: CanvasRenderingContext2D, p: Palette, path: Rib[]): void {
  if (path.length < 2) return
  const normalAt = (i: number): { nx: number; ny: number } => {
    const a = path[Math.max(0, i - 1)]
    const b = path[Math.min(path.length - 1, i + 1)]
    if (!a || !b) return { nx: 0, ny: -1 }
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    // Left-hand normal, which for a shaft running along the keyway points up the page.
    return { nx: dy / len, ny: -dx / len }
  }

  ctx.beginPath()
  for (let i = 0; i < path.length; i += 1) {
    const r = path[i]
    if (!r) continue
    const { nx, ny } = normalAt(i)
    const x = r.x + nx * r.half
    const y = r.y + ny * r.half
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const r = path[i]
    if (!r) continue
    const { nx, ny } = normalAt(i)
    ctx.lineTo(r.x - nx * r.half, r.y - ny * r.half)
  }
  ctx.closePath()
  ctx.fillStyle = p.steel
  ctx.fill()
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.stroke()

  // Highlight down the lit edge, inset so it reads as a rounded back rather than a second outline.
  ctx.beginPath()
  for (let i = 0; i < path.length; i += 1) {
    const r = path[i]
    if (!r) continue
    const { nx, ny } = normalAt(i)
    const inset = Math.max(0, r.half - 1.2)
    const x = r.x + nx * inset
    const y = r.y + ny * inset
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = alpha(mix(p.steel, p.paper, 0.8), 0.85)
  ctx.stroke()
}

export function drawPick(
  vp: Viewport,
  p: Palette,
  layout: CutawayLayout,
  render: PickRender,
): void {
  if (render.chamber < 0) return
  const { ctx } = vp
  const tipX = render.tipX
  const tipY = mmToY(layout, render.tipMm)
  /**
   * The shaft lies in the keyway and exits **left**, because that is the end the keyway opens
   * at — and therefore the end chamber 0 is at.
   *
   * It used to exit right, which put the keyway mouth at the opposite end of the lock from the
   * chambers a short hook can reach. `effectiveReach` counts "chambers in from the mouth" and
   * allows `0..reach-1`, so with the drawing mirrored the pick appeared to stretch across the
   * whole lock, past pins it could not touch, to grab the far ones. Pin 1 is the front pin in
   * every lock ever made; the drawing now agrees. See DECISIONS D-044.
   */
  // Just outside the lock body, not at the screen edge: the handle is off-stage either way, and
  // a shaft drawn all the way to the margin runs straight through the rotation gauge.
  // Whichever end the keyway opens at (D-047). sign flips the hook with it.
  const sign = layout.mirrored ? -1 : 1
  const entryX = layout.mirrored ? layout.right + 26 : layout.left - 26
  const keywayY = mmToY(layout, (KEYWAY_FLOOR + KEYWAY_BOTTOM_MM) / 2)
  const hookW = layout.keyPinWidth * 0.62
  // Where the hook leaves the shaft and climbs — inside the bore, not through plug metal.
  const kneeX = tipX - hookW * sign

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  /**
   * One continuous piece of steel: shaft, then the hook that climbs out of the keyway and
   * squares off under the key pin. Thickness runs 4.2px at the handle down to 1.1px at the tip.
   *
   * The bow lives entirely in the shaft's control point, so the deflection is a single smooth
   * curve — a cantilevered strip loaded at the far end, which is what a pick under a pin is.
   * ART_DIRECTION.md §5: bent as a real curve, never rotated.
   */
  const kneeY = keywayY + render.flex
  const shaft = ribs(
    entryX,
    keywayY,
    entryX + (kneeX - entryX) * 0.62,
    keywayY + render.flex * 0.42,
    kneeX,
    kneeY,
    4.2,
    1.9,
    18,
  )
  const hook = ribs(
    kneeX,
    kneeY,
    tipX - hookW * 0.92 * sign,
    tipY,
    tipX - hookW * 0.18 * sign,
    tipY,
    1.9,
    1.1,
    10,
    true,
  )
  /**
   * The working end: a short flat that bears on the key pin, then a **point**.
   *
   * A real hook is ground to a tip fine enough to slip between a key pin and the keyway wall, and
   * that point is the part of the tool a picker actually thinks about. Ending the silhouette on a
   * blunt 1.05px stub read as a bent rod with a squared-off end; tapering the last third to 0.2px
   * gives it the ground edge it should have. Asked for twice: "it should have a clearly shaped or
   * pointed tip, similar to a real lockpick." See DECISIONS D-063.
   */
  const face: Rib[] = [
    { x: tipX + hookW * 0.2 * sign, y: tipY, half: 1.0 },
    { x: tipX + hookW * 0.46 * sign, y: tipY, half: 0.62 },
    { x: tipX + hookW * 0.66 * sign, y: tipY - 0.3, half: 0.2 },
  ]
  drawSteel(ctx, p, [...shaft, ...hook, ...face])
  ctx.restore()
}

/**
 * A faint marker showing where the mouse is asking the tip to go. The distance between this
 * and the tip is the resistance made visible.
 */
export function drawPickTarget(
  vp: Viewport,
  p: Palette,
  layout: CutawayLayout,
  chamber: number,
  targetMm: number,
  atX?: number,
): void {
  if (chamber < 0) return
  const { ctx } = vp
  // Drawn where the tip is drawn, so the gap between the marker and the tip reads as one
  // vertical distance rather than as two things in different places.
  const x = atX ?? plugChamberX(layout, chamber)
  const y = mmToY(layout, KEYWAY_FLOOR + targetMm)
  ctx.save()
  ctx.strokeStyle = p.inkLight
  ctx.lineWidth = STROKE.hairline
  ctx.setLineDash([3, 5])
  ctx.beginPath()
  ctx.moveTo(x - layout.driverWidth * 0.8, y)
  ctx.lineTo(x + layout.driverWidth * 0.8, y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}
