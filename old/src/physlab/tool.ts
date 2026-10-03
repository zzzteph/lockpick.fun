/**
 * PHYSLAB — the pick, as a shape.
 *
 * A real tool rather than a line: a strip of spring steel of **fixed length**, milled from constant
 * stock and ground to a point over its last couple of millimetres, set into a moulded grip. It
 * pivots about the hand and **translates** when you insert it — the hand travels with it, because a
 * pick does not grow (`SHANK_LEN`).
 *
 * Two rules make the drawing honest, and one of them is why this file exists at all:
 *
 * 1. **The milled edge is `toolHeightAt`** — the very function `toolSurfaceUnder` asks what is
 *    beneath a pin. What you see bearing on a pin is what the contact test read. The teeth are
 *    triangular because the model's teeth are: a hook is one tooth at the tip (a half-diamond), a
 *    rake is five of them, stepped.
 * 2. **It is rigid.** Blade, teeth and grip are one body. It changes angle and never changes shape —
 *    a bowed shaft was built once and rejected on sight, so nothing here bends. `pickBent` reads as
 *    tired steel, not as a curve.
 *
 * Everything is produced in **keyway millimetres** and drawn through a caller-supplied mapping, so
 * the same tool goes into the lab's own teardown (`view.ts`, one uniform scale) and into the game's
 * cutaway (`phyzbench.ts`, whose x and y scales differ). One tool, two drawings, no second copy of
 * its shape to drift.
 */

import {
  BLADE_MM,
  HAND_Y,
  SHANK_LEN,
  TOOTH_HALF,
  handX,
  toolHeightAt,
  toolShaftY,
  type LabState,
  type Tool,
} from './model'
import { STROKE, alpha, mix, type Palette } from '../render/palette'

export interface Pt {
  readonly x: number
  readonly y: number
}

/** How the caller turns keyway millimetres into pixels. Axes may scale differently. */
export interface ToolFrame {
  sx(mm: number): number
  sy(mm: number): number
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Steel thickness in mm, `mmFromPoint` back along the tool.
 *
 * A pick is milled from strip: **constant section** down its length (`BLADE_MM`, which the model owns
 * because the keyway's floor is measured against it), ground away only over the last couple of
 * millimetres into a point fine enough to slip past a key pin. Tapering it as a *fraction* of the
 * tool's length — the first version — made the grind as long as the tool, so a pick inserted deep
 * read as a needle with a triangle stuck on the end rather than as a blade.
 */
const GRIND_MM = 2.6
function steelThickness(mmFromPoint: number): number {
  if (mmFromPoint >= GRIND_MM) return BLADE_MM
  return 0.08 + (BLADE_MM - 0.08) * clamp01(mmFromPoint / GRIND_MM)
}

/** How much of the pick's grip sits behind the hand, mm. */
export const GRIP_MM = 11

/**
 * The x breakpoints of the tool's piecewise-linear profile, hand to point.
 *
 * The obvious set — the hand, the tip, the point and each tooth's foot/peak/foot — is **not enough**,
 * and the test that samples the outline against `toolHeightAt` between its vertices is what said so.
 * A tooth's height is measured from the shaft *at the tooth's centre*, so its flank and the shaft are
 * two different lines: the profile is their upper envelope, and where they cross is a corner of the
 * tool. Joining foot to peak with one straight line shaved that corner off — up to 0.07mm of steel
 * that the contact test can see and the drawing could not.
 */
function toolBreakpoints(tool: Tool): number[] {
  const tipX = Math.min(tool.x, tool.reach)
  const end = tipX + TOOTH_HALF
  const hx = handX(tool)
  const base = new Set<number>([hx, tipX, end])
  for (const t of tool.teeth) {
    const tx = tipX + t.dx
    for (const x of [tx - TOOTH_HALF, tx, tx + TOOTH_HALF]) {
      if (x > hx && x < end) base.add(x)
    }
  }
  const sorted = [...base].filter((x) => x >= hx && x <= end).sort((a, b) => a - b)

  // With the tip and every tooth foot already breakpoints, both the shaft and the one tooth acting
  // inside a span are straight there — so a crossing is one division, not a search.
  const shaftAt = (x: number): number => toolShaftY(tool, Math.min(x, tipX))
  const xs: number[] = []
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    xs.push(a)
    const mid = (a + b) / 2
    const t = tool.teeth.find((tooth) => Math.abs(mid - (tipX + tooth.dx)) < TOOTH_HALF)
    if (!t) continue
    const tx = tipX + t.dx
    const toothAt = (x: number): number =>
      shaftAt(Math.min(tx, tipX)) + t.height * (1 - Math.abs(x - tx) / TOOTH_HALF)
    const da = toothAt(a) - shaftAt(a)
    const db = toothAt(b) - shaftAt(b)
    if (da === db || da > 0 === db > 0) continue
    const cross = a + (b - a) * (da / (da - db))
    if (cross > a + 1e-9 && cross < b - 1e-9) xs.push(cross)
  }
  xs.push(sorted[sorted.length - 1]!)
  return xs
}

export interface ToolOutline {
  /** Breakpoints along the keyway, mm, hand → point. Both edges are linear between them. */
  readonly xs: readonly number[]
  /** The milled edge: **exactly** `toolHeightAt`, the surface the contact test reads. */
  readonly top: readonly number[]
  /** The flat underside: the shaft, less the steel's thickness there. */
  readonly under: readonly number[]
}

/**
 * The tool's silhouette in keyway millimetres — the one place its shape is decided.
 *
 * Split out of the drawing so the claim this file is built on can be *asserted* rather than
 * eyeballed: the top edge is the physics. `tests/physlab/view.test.ts` samples it against
 * `toolHeightAt` at every breakpoint and between them.
 */
export function toolOutline(tool: Tool): ToolOutline {
  const tipX = Math.min(tool.x, tool.reach)
  const end = tipX + TOOTH_HALF
  const shaftAt = (x: number): number => toolShaftY(tool, Math.min(x, tipX))
  const at = (x: number): number => toolHeightAt(tool, x) ?? shaftAt(x)
  const EPS = 1e-9

  /**
   * A tooth's foot is a **vertical face**, not a joint.
   *
   * The model measures a tooth's height from the shaft at the tooth's own centre, so where the
   * tooth's influence begins the surface steps by `slope · TOOTH_HALF` — up to a quarter of a
   * millimetre with the tip heaved high, which is a quarter of a pin's width on the page. Sloping
   * into it would draw a tool the contact test does not agree with, so the step is drawn: two
   * vertices at the same x, the limit from each side.
   */
  const xs: number[] = []
  const top: number[] = []
  for (const x of toolBreakpoints(tool)) {
    const h = at(x)
    if (x > handX(tool)) {
      const left = at(x - EPS)
      if (Math.abs(left - h) > 1e-7) {
        xs.push(x)
        top.push(left)
      }
    }
    xs.push(x)
    top.push(h)
    if (x < end) {
      const right = at(x + EPS)
      if (Math.abs(right - h) > 1e-7) {
        xs.push(x)
        top.push(right)
      }
    }
  }
  const under = xs.map((x) => shaftAt(x) - steelThickness(end - x))
  return { xs, top, under }
}

export interface ToolShape {
  /** The blade, as a closed polygon in keyway mm: up the milled edge, back down the underside. */
  readonly blade: readonly Pt[]
  /** The lit edge, as a polyline — the milled edge, dropped inside the steel. */
  readonly glint: readonly Pt[]
  /** The hand: the blade's centreline where it enters the grip, in keyway mm. */
  readonly hand: Pt
  /** Tilt about the hand, radians, in millimetre space (y up). */
  readonly angle: number
  readonly broken: boolean
  readonly bent: boolean
}

/** The whole tool in keyway millimetres, ready for any mapping. */
export function toolShape(state: LabState): ToolShape {
  const tool = state.tool
  const { xs, top, under } = toolOutline(tool)
  const blade: Pt[] = []
  xs.forEach((x, i) => blade.push({ x, y: top[i]! }))
  for (let i = xs.length - 1; i >= 0; i -= 1) blade.push({ x: xs[i]!, y: under[i]! })
  const glint = xs.map((x, i) => ({ x, y: top[i]! - BLADE_MM * 0.18 }))
  const hx = handX(tool)
  return {
    blade,
    glint,
    hand: { x: hx, y: HAND_Y - BLADE_MM / 2 },
    // The lever is the tool's own length, so the tilt is one arctangent and never changes with
    // how deep the pick is: the shape is rigid and the whole body swings.
    angle: Math.atan2(tool.lift - HAND_Y, SHANK_LEN),
    broken: state.pickBroken,
    bent: state.pickBent,
  }
}

/** Map a grip-local point (u toward the point, v up) into keyway millimetres. */
function onGrip(shape: ToolShape, u: number, v: number): Pt {
  const cos = Math.cos(shape.angle)
  const sin = Math.sin(shape.angle)
  return { x: shape.hand.x + u * cos - v * sin, y: shape.hand.y + u * sin + v * cos }
}

// ── The grip, in its own frame: a moulded handle, knurled, with two rivets and a steel ferrule ──
const COLLAR_BACK = -2.0
const COLLAR_FRONT = 0.6
const COLLAR_HALF = 0.66
const GRIP_HALF = 1.28
const GRIP_R = 0.5
const RIVETS = [-3.4, -7.4]

function polygon(ctx: CanvasRenderingContext2D, f: ToolFrame, pts: readonly Pt[]): void {
  ctx.beginPath()
  pts.forEach((pt, i) => {
    const x = f.sx(pt.x)
    const y = f.sy(pt.y)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
}

/** Draw the tool through `f`. The only thing the caller decides is how a millimetre maps to a pixel. */
export function drawToolShape(
  ctx: CanvasRenderingContext2D,
  shape: ToolShape,
  p: Palette,
  f: ToolFrame,
): void {
  if (shape.blade.length < 3) return

  // ── The blade ──
  polygon(ctx, f, shape.blade)
  ctx.fillStyle = shape.broken
    ? mix(p.steel, p.crimson, 0.45)
    : shape.bent
      ? mix(p.steel, p.inkLight, 0.35)
      : p.steel
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.strokeStyle = alpha(mix(p.steel, p.paper, 0.75), 0.9)
  ctx.lineWidth = STROKE.standard
  ctx.beginPath()
  shape.glint.forEach((pt, i) => {
    const x = f.sx(pt.x)
    const y = f.sy(pt.y)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
  ctx.restore()
  polygon(ctx, f, shape.blade)
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = shape.broken ? p.crimson : p.ink
  ctx.stroke()

  // ── The grip ──
  const g = (u: number, v: number): Pt => onGrip(shape, u, v)
  const back = -GRIP_MM
  const body: Pt[] = [
    g(back + GRIP_R, GRIP_HALF),
    g(COLLAR_BACK, GRIP_HALF),
    g(COLLAR_BACK, -GRIP_HALF),
    g(back + GRIP_R, -GRIP_HALF),
    g(back, -GRIP_HALF + GRIP_R),
    g(back, GRIP_HALF - GRIP_R),
  ]
  polygon(ctx, f, body)
  ctx.fillStyle = mix(p.steel, p.ink, 0.78)
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.strokeStyle = alpha(p.paper, 0.22)
  ctx.lineWidth = STROKE.hairline
  ctx.beginPath()
  for (let k = back + 0.6; k < COLLAR_BACK; k += 0.62) {
    const a = g(k, -GRIP_HALF)
    const b = g(k + GRIP_HALF * 1.6, GRIP_HALF)
    ctx.moveTo(f.sx(a.x), f.sy(a.y))
    ctx.lineTo(f.sx(b.x), f.sy(b.y))
  }
  ctx.stroke()
  // The light along the moulding's back.
  ctx.strokeStyle = alpha(p.paper, 0.3)
  ctx.beginPath()
  const h0 = g(back + GRIP_R, GRIP_HALF - 0.22)
  const h1 = g(COLLAR_BACK, GRIP_HALF - 0.22)
  ctx.moveTo(f.sx(h0.x), f.sy(h0.y))
  ctx.lineTo(f.sx(h1.x), f.sy(h1.y))
  ctx.stroke()
  ctx.restore()
  polygon(ctx, f, body)
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.stroke()

  for (const at of RIVETS) {
    const ring: Pt[] = []
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2
      ring.push(g(at + 0.34 * Math.cos(a), 0.34 * Math.sin(a)))
    }
    polygon(ctx, f, ring)
    ctx.fillStyle = p.steel
    ctx.fill()
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = p.ink
    ctx.stroke()
  }

  // ── The ferrule the blade is set into ──
  const collar: Pt[] = [
    g(COLLAR_BACK, COLLAR_HALF),
    g(COLLAR_FRONT, COLLAR_HALF),
    g(COLLAR_FRONT, -COLLAR_HALF),
    g(COLLAR_BACK, -COLLAR_HALF),
  ]
  polygon(ctx, f, collar)
  ctx.fillStyle = shape.broken
    ? mix(p.steel, p.crimson, 0.4)
    : shape.bent
      ? mix(p.steel, p.inkLight, 0.3)
      : p.steel
  ctx.fill()
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.stroke()
  const l0 = g(COLLAR_BACK + 0.5, COLLAR_HALF)
  const l1 = g(COLLAR_BACK + 0.5, -COLLAR_HALF)
  ctx.beginPath()
  ctx.moveTo(f.sx(l0.x), f.sy(l0.y))
  ctx.lineTo(f.sx(l1.x), f.sy(l1.y))
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = alpha(p.ink, 0.55)
  ctx.stroke()
}
