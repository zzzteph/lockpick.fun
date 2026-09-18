/**
 * The side view (cutaway), drawn from the solver and nothing else — experiment 3.
 *
 * The same drafting language as the game's bench — hatched brass, ink outlines, zigzag springs —
 * but every shape is the solver's own: the keyway and bores at the solver's dimensions, the pins
 * as their cutaway silhouettes, the pick as the very polygon the solver pushes with, and the
 * points where it touches a pin. One scale on both axes, because the pick's angle is real.
 *
 * Two things this view deliberately does NOT do. It does not slide the plug's bores sideways
 * under tension — the plug turns about the keyway's axis, which a section along that axis
 * cannot show (owner: *"I do not believe that we can see the move from the side"*); the front
 * view shows the turn. And it does not cant the pins: a cant is in the plane the front view
 * draws.
 */

import { hatchPath, label } from './draw'
import { stateKey } from './cutaway'
import { STROKE, TYPE, font, mix, stateColor, type Palette } from './palette'
import { LOGICAL_WIDTH, isCompact, snapY, typeFor, type Viewport } from './viewport'
import {
  CLS_HOUSING_LEDGE,
  CLS_HOUSING_RIM,
  CLS_HOUSING_WALL,
  CLS_PICK_PIN,
  CLS_PLUG_LEDGE,
  CLS_PLUG_RIM,
  CLS_PLUG_WALL,
  type PinBody,
} from '../solver'
import { NEEDLE_REACH, setWindow, shearLineMm, type Engine } from '../physics/engine'

/** Logical px per solver mm, both axes. */
export const SIDE_PX = 30
/** Where the shear line sits on the page — the game's own row. */
/**
 * The shear line's y, logical px. 500 on the bench; 536 in the game, where the HUD's rank band
 * ("S · 10.8s to A") sits over the shell's top at 500.
 */
export const SIDE_SHEAR_Y = 536
/**
 * Solver mm the drawn shear line stands for — the same height in both views (`shearLineMm`): the
 * plug's top at the bore's edge, where a set driver's corner rests. With the line at the axis a
 * set driver sat a few pixels BELOW it (owner: "we see that parts of the driver pin below shear
 * line").
 */
export function sideShearMm(eng: Engine): number {
  return shearLineMm(eng.sol.params)
}
/** The narrowest the front view's gutter may get, so the side view is pushed right if need be. */
const MIN_LEFT = 344
const HATCH_SPACING = 6

export interface SideFrame {
  /** Page x of the keyway's mouth (solver x = 0). */
  readonly x0: number
  /** Page x of the keyway's end. */
  readonly x1: number
  sx(mm: number): number
  sy(mm: number): number
}

export function sideFrame(eng: Engine): SideFrame {
  const width = eng.sol.params.keywayDepth * SIDE_PX
  const x0 = Math.max(MIN_LEFT, (LOGICAL_WIDTH - width) / 2)
  const shear = sideShearMm(eng)
  return {
    x0,
    x1: x0 + width,
    sx: (mm) => x0 + mm * SIDE_PX,
    sy: (mm) => SIDE_SHEAR_Y - (mm - shear) * SIDE_PX,
  }
}

/**
 * The drawn assembly, logical px — shell top to plug bottom across the keyway — for the layout
 * audit's text-over-lock rule (D-223). Kept beside `drawSideView` so the two cannot drift.
 */
export function sideBounds(eng: Engine, f: SideFrame): { x: number; y: number; w: number; h: number } {
  const P = eng.sol.params
  const top = f.sy(P.seatY + 0.8)
  const bottom = f.sy(P.keywayFloorY - 1.7)
  return { x: f.x0, y: top, w: f.x1 - f.x0, h: bottom - top }
}

/** A page x as a position along the keyway, in chambers from pin 1 (fractional between pins). */
export function atForX(eng: Engine, f: SideFrame, px: number): number {
  const P = eng.sol.params
  return ((px - f.x0) / SIDE_PX - P.firstChamberX) / P.pitch
}

/** A keyway position in chambers as solver mm along the keyway. */
export function tipXForAt(eng: Engine, at: number): number {
  const P = eng.sol.params
  return P.firstChamberX + at * P.pitch
}

function polyPath(ctx: CanvasRenderingContext2D, W: Float64Array, count: number, f: SideFrame, dx = 0, dy = 0): void {
  ctx.beginPath()
  for (let i = 0; i < count; i += 1) {
    const x = f.sx(W[i * 2]! + dx)
    const y = f.sy(W[i * 2 + 1]! + dy)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

/** A pin's upright silhouette at (x, y) in the cutaway plane, from its local polygon. */
function localPath(ctx: CanvasRenderingContext2D, pin: PinBody, x: number, y: number, f: SideFrame): void {
  polyPath(ctx, pin.local, pin.count, f, x, y)
}

export function drawSideView(
  vp: Viewport,
  p: Palette,
  eng: Engine,
  f: SideFrame,
  gun = false,
  flick = 0,
  // The assist ladder, in one flag (D-218): Training and lessons narrate in colour, Normal draws
  // the same bodies plain — steel drivers, no target window, no overset tint. Defaults on so the
  // sandbox and any other caller keep the full x-ray without threading it.
  colored = true,
): void {
  const { ctx } = vp
  const { sol } = eng
  const P = sol.params
  const q = sol.bodies.q
  const shearY = f.sy(sideShearMm(eng))
  /** The shell's underside: `shearGap` above the plug's top, as the solver has it. */
  const shellBottom = f.sy(sideShearMm(eng) + P.shearGap)
  const shellTop = f.sy(P.seatY + 0.8)
  const plugBottom = f.sy(P.keywayFloorY - 1.7)
  const roofY = f.sy(P.keywayCeilY)
  const floorY = f.sy(P.keywayFloorY)
  const boreW = 2 * P.boreRadius * SIDE_PX
  /** The keyway is open at the face and closed 2 mm short of the back. */
  const backX = f.sx(P.keywayDepth - 2)

  // ── Shell: the body above the shear line, its bores punched out ──
  const shellPath = (): void => {
    ctx.rect(f.x0, shellTop, f.x1 - f.x0, shellBottom - shellTop)
    for (const ch of sol.chambers) {
      const hx = f.sx(ch.x)
      ctx.rect(hx - boreW / 2, f.sy(P.seatY), boreW, shellBottom - f.sy(P.seatY))
    }
  }
  // ── Plug: the body below it, its bores and the keyway channel punched out ──
  const plugPath = (): void => {
    ctx.rect(f.x0, shearY, f.x1 - f.x0, plugBottom - shearY)
    for (const ch of sol.chambers) {
      const px = f.sx(ch.x)
      ctx.rect(px - boreW / 2, shearY, boreW, f.sy(P.floorY) - shearY)
    }
    ctx.rect(f.x0 - 2, roofY, backX - f.x0 + 2, floorY - roofY)
  }
  const body = (path: () => void, fill: string, angle: number, bounds: { x: number; y: number; w: number; h: number }): void => {
    ctx.save()
    ctx.beginPath()
    path()
    ctx.fillStyle = fill
    ctx.fill('evenodd')
    ctx.restore()
    hatchPath(ctx, path, bounds, { spacing: HATCH_SPACING, angleDeg: angle, color: p.rule, lineWidth: 1, fillRule: 'evenodd' })
    ctx.save()
    ctx.beginPath()
    path()
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.stroke()
    ctx.restore()
  }
  body(shellPath, p.shellBody, 45, { x: f.x0, y: shellTop, w: f.x1 - f.x0, h: shellBottom - shellTop })
  body(plugPath, p.plugBody, -45, { x: f.x0, y: shearY, w: f.x1 - f.x0, h: plugBottom - shearY })

  // ── The set window: where to put the key pin's top. Teal to aim at, crimson past it ──
  // A coloured aim overlay, so it belongs to Training and lessons only — Normal has no target hint.
  if (colored) {
    const w = setWindow(sol)
    for (const ch of sol.chambers) {
      const x = f.sx(ch.x) - boreW / 2
      ctx.fillStyle = p.teal
      ctx.globalAlpha = 0.28
      ctx.fillRect(x, f.sy(w.to), boreW, f.sy(w.from) - f.sy(w.to))
      ctx.fillStyle = p.crimson
      ctx.globalAlpha = 0.12
      ctx.fillRect(x, f.sy(w.to + 1.2), boreW, f.sy(w.to) - f.sy(w.to + 1.2))
      ctx.globalAlpha = 1
    }
  }

  // ── Springs, the game's construction: from the seat down to the driver's top ──
  sol.chambers.forEach((ch, i) => {
    const r = eng.readouts[i]!
    const top = f.sy(P.seatY)
    const bottom = f.sy(r.driverY + ch.driver.topU)
    const height = Math.max(2, bottom - top)
    const cx = f.sx(ch.x)
    const halfW = P.pinRadius * 0.72 * SIDE_PX
    const coils = 5
    ctx.save()
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = p.inkLight
    ctx.beginPath()
    ctx.moveTo(cx, top)
    for (let k = 0; k < coils; k += 1) {
      const y0 = top + (height * (k + 0.5)) / coils
      const y1 = top + (height * (k + 1)) / coils
      ctx.lineTo(cx + (k % 2 === 0 ? halfW : -halfW), y0)
      ctx.lineTo(cx, y1)
    }
    ctx.stroke()
    ctx.restore()
  })

  // ── Pins: upright silhouettes at the chamber's x, at the solver's heights ──
  sol.chambers.forEach((ch, i) => {
    const sc = eng.sim.chambers[i]!
    const k = ch.key.body * 4
    const d = ch.driver.body * 4
    // Normal paints every pin steel (the FREE colour) and drops the overset tint: the picture
    // stays, the state narration goes (D-218). Training keeps the full colour language.
    const keyFill =
      colored && sc.state === 'OVERSET' ? mix(p.steel, p.crimson, 0.55) : mix(p.steel, p.paper, 0.32)
    ctx.save()
    localPath(ctx, ch.driver, ch.x, q[d + 1]!, f)
    ctx.fillStyle = stateColor(p, colored ? stateKey(sc) : 'free')
    ctx.fill()
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.stroke()
    localPath(ctx, ch.key, ch.x, q[k + 1]!, f)
    ctx.fillStyle = keyFill
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  })

  // ── The shear line: the strongest line on screen, across the assembly ──
  const y = snapY(vp, shearY, STROKE.heavy)
  ctx.save()
  ctx.lineWidth = STROKE.heavy
  ctx.strokeStyle = p.ink
  ctx.beginPath()
  ctx.moveTo(f.x0 - 40, y)
  ctx.lineTo(f.x1 + 40, y)
  ctx.stroke()
  ctx.restore()

  // ── Where each pin is caught — the front view's dots, PROJECTED (D-223) ──
  // D-221 drew the front view's contacts here with their across-the-plug x read as an along-the-
  // keyway x, so they landed beside the lock and came off (D-222). The honest projection: the pinch
  // is on the pin's circumference, which seen from the side is the pin's own centre line, and its
  // height is the solver's world height — the same axis both views share. So one dot per chamber on
  // the pin at the contact's height: the hardest wall contact (crimson — it is holding the plug), or
  // failing that the rim it rests on once set (teal). Training and lessons only, like the front.
  if (colored) {
    const c = sol.contacts
    const best = sol.chambers.map(() => ({ F: 0, y: 0, wall: false }))
    for (let j = 0; j < c.count; j += 1) {
      const i = c.chamber[j]!
      const b = best[i]
      if (!b) continue
      const cls = c.cls[j]!
      const wall = cls === CLS_PLUG_WALL || cls === CLS_HOUSING_WALL
      const rest = cls === CLS_PLUG_RIM || cls === CLS_PLUG_LEDGE || cls === CLS_HOUSING_RIM || cls === CLS_HOUSING_LEDGE
      if (!wall && !rest) continue
      const F = c.lamN[c.slot[j]!]! / sol.h
      if (F < 0.05) continue
      // A wall outranks a rest; within a kind, the harder contact wins.
      if ((wall && !b.wall) || (wall === b.wall && F > b.F)) Object.assign(b, { F, y: c.py[j]!, wall })
    }
    ctx.save()
    best.forEach((b, i) => {
      if (b.F === 0) return
      const set = eng.stateOf(i) === 'SET'
      ctx.beginPath()
      ctx.arc(f.sx(sol.chambers[i]!.x), f.sy(b.y), b.wall ? 6 + Math.min(12, b.F * 2) : 5.5, 0, Math.PI * 2)
      ctx.fillStyle = set ? p.teal : p.crimson
      ctx.globalAlpha = 0.9
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.lineWidth = STROKE.hairline
      ctx.strokeStyle = p.ink
      ctx.stroke()
    })
    ctx.restore()
  }

  if (gun) {
    // ── The snap gun's blade: a straight flat PLANK lying along the keyway under the key pins, not
    // a hook and not a pointed needle — a real gun needle is a thin flat steel strip (owner). It
    // reaches from the mouth to its INSERTION TIP, which the player slides in and out to aim the
    // strike (D-219): the plank ends at the tip, and a bump only jumps the pins it covers. It
    // recoils DOWN on a strike — the pins jump up (the strike force), the needle kicks the other
    // way, so it touches the key pins at rest (owner: "it's not touching the pins") and never rides
    // up through one that did not jump (owner: "the needle goes into the key pins"). Purely drawn;
    // the strike's force does the physics. ──
    const topMm = eng.tipRest() + 0.15 - flick * 0.7
    const firstX = sol.params.firstChamberX
    const lastX = sol.chambers.length ? sol.chambers[sol.chambers.length - 1]!.x : firstX
    // The plank's far end follows the pick tip, capped just past the last pin (a deep needle) and
    // held to a mouth stub when the tip is withdrawn short of pin 1, so the needle is always drawn.
    const reachMm = Math.max(firstX - 2, Math.min(eng.pick().tipX + NEEDLE_REACH, lastX + 3.5))
    const yc = f.sy(topMm) + 2.5
    const half = 9
    const leftX = f.x0 - 40
    const rightX = f.sx(reachMm)
    ctx.save()
    ctx.beginPath()
    ctx.rect(f.x0 - 22, 0, LOGICAL_WIDTH, 2000)
    ctx.clip()
    ctx.beginPath()
    ctx.rect(leftX, yc - half, rightX - leftX, half * 2)
    ctx.fillStyle = p.steel
    ctx.fill()
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.stroke()
    ctx.restore()
  } else {
    // ── The pick: the solver's polygon, and where it is pressing. Not drawn once withdrawn — the
    // solver parks it in front of the mouth, which on the page is a stub at the screen's edge ──
    const pick = sol.pick
    const tipX = pick.world[pick.tipIndex * 2]!
    ctx.save()
    if (tipX < 0) ctx.globalAlpha = 0
    // The blade is 60 mm long and the front view's panel covers it outside the lock; clip it to
    // just outside the mouth so it enters from behind the panel rather than resurfacing beyond it.
    ctx.beginPath()
    ctx.rect(f.x0 - 22, 0, LOGICAL_WIDTH, 2000)
    ctx.clip()
    polyPath(ctx, pick.world, pick.count, f)
    ctx.fillStyle = p.steel
    ctx.fill()
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.stroke()
    const c = sol.contacts
    for (let j = 0; j < c.count; j += 1) {
      if (c.cls[j] !== CLS_PICK_PIN) continue
      const F = c.lamN[c.slot[j]!]! / sol.h
      if (F < 0.02) continue
      ctx.beginPath()
      ctx.arc(f.sx(c.px[j]!), f.sy(c.py[j]!), 3 + Math.min(8, F * 2), 0, Math.PI * 2)
      ctx.fillStyle = p.amber
      ctx.globalAlpha = 0.75
      ctx.fill()
      ctx.globalAlpha = 1
    }
    ctx.restore()
  }

  // ── Part names ──
  const size = typeFor(vp, TYPE.dimension)
  const cap = (s: string, x: number, yy: number): void => {
    label(ctx, s, x, yy, { font: font(size), size, color: p.inkLight, align: 'right' })
  }
  // Only the keyway is named: the solver's body ends 3.5 mm past the last chamber, which leaves
  // no room for "shell" and "plug" beside it.
  // Not on a phone: there the scaled label sits across the metal, the same reason the cutaway's
  // anatomy names drop at the compact face (D-122, D-223).
  if (!isCompact(vp)) cap('keyway', backX - 12, floorY - 10)
}
