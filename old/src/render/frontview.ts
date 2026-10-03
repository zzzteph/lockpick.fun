/**
 * The front view — the current pin's chamber seen from the FACE of the lock, drawn from the
 * solver's chamber plane (experiments 2 and 3, 2026-09-13).
 *
 * The side cutaway cannot show a plug turning: it is a section along the axis. Seen from the
 * front the plug is a circle, and turning it is just turning it. The shell's bore stays where it
 * is (offset by this chamber's own tolerance δ), the plug's bore swings with the plug, and a
 * driver straddling the shear line is caught between the two — which is what a binding pin *is*.
 *
 * Since experiment 3 nothing here is a picture of a number: the plug's angle, the pins' positions
 * and their cant are the solver's bodies, the bores are its walls, and the dots are its contacts,
 * sized by the force they carry. A canted pin cannot enter the shell because the solver's walls
 * are what stop it (owner: *"the pin when under the angle its parts goes inside the shell — which
 * is not physically correct"*). No exaggeration anywhere: a false set turns the plug a couple of
 * degrees and that is what is drawn.
 *
 * It is a **window**, not the whole face: the driver, the key pin and the top of the plug — the
 * owner's cut, *"we do not need to show the whole lock from the front, since it takes a lot of
 * space and brings no value"*. No pick: end-on it was a bar with nothing to say.
 */

import type { ChamberState } from '../sim'
import { hatchPath, label } from './draw'
import { stateKey } from './cutaway'
import { STROKE, TYPE, font, mix, stateColor, type Palette } from './palette'
import type { Rect } from './layout'
import { MIN_TYPE_CSS, typeFor, type Viewport } from './viewport'
import { panel } from '../ui/widgets'
import {
  CLS_HOUSING_LEDGE,
  CLS_HOUSING_RIM,
  CLS_HOUSING_WALL,
  CLS_PLUG_LEDGE,
  CLS_PLUG_RIM,
  CLS_PLUG_WALL,
  housingY,
  type PinBody,
} from '../solver'
import { setWindow, shearLineMm, type Engine } from '../physics/engine'

const DEG = Math.PI / 180
const HATCH_SPACING = 6
/*
 * The plug is drawn at the solver's angle, the same at every pin. For a while the turn past a
 * SET or FALSE_SET pin's own bind angle was magnified ×4 so the ledge would read; the owner saw
 * the plug turned by different amounts at different pins with one number in the caption
 * ("somewhere it's turned more than on another") and the plug's bore wall crossing a false-set
 * spool's foot ("none of the lines from the plug should intersect the pin lines"). Gone: the
 * ledge is the solver's real few hundredths, and the teal contact mark says where it rests.
 */
/**
 * What the window shows, in mm about the shear line: the bore with its spring above a lifted
 * driver, the whole driver at any lift, the key pin, and the top of the plug. The bottom is the
 * plug bore's floor: the keyway slot under it is narrower than the bore, and a narrowing at the
 * bottom of the window read as a second path (owner, twice).
 */
const VIEW_TOP_MM = 6.5
const VIEW_BOTTOM_BELOW_FLOOR_MM = 0
/**
 * How wide the window is, mm. Narrower than the gutter on purpose: at the gutter's full width the
 * rim fell away so steeply it read as a ball — *"the plug is the full circle"* — where a 12.7mm
 * plug under a 3mm pin should read as the top of something big.
 */
const VIEW_WIDTH_MM = 7.4
/** Caption rows above and below the window, px. */
const CAPTION_H = 36
const INSET = 12

function stateWord(state: ChamberState): string {
  switch (state) {
    case 'BINDING':
      return 'binding'
    case 'SET':
      return 'set'
    case 'FALSE_SET':
      return 'false set'
    case 'OVERSET':
      return 'overset'
    case 'FREE':
      return 'free'
  }
}

function polyPath(ctx: CanvasRenderingContext2D, pin: PinBody, X: (mm: number) => number, Y: (mm: number) => number): void {
  const W = pin.world
  ctx.beginPath()
  for (let i = 0; i < pin.count; i += 1) {
    const x = X(W[i * 2]!)
    const y = Y(W[i * 2 + 1]!)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

/** Draw chamber `chamberIndex` of the engine's solver face-on inside `rect`. */
/**
 * Draw chamber `chamberIndex` of the engine's solver face-on inside `rect`. `theta` is the plug
 * angle to draw — the solver's, unless the bench is animating the open turn after the solver
 * has stopped.
 */
export function drawFrontView(
  vp: Viewport,
  p: Palette,
  eng: Engine,
  chamberIndex: number,
  rect: Rect,
  theta = eng.theta(),
  // The assist ladder (D-218): Training and lessons narrate in colour — the target window, the
  // driver's state colour, the blocking-contact map; Normal draws the same face plain. Defaults on
  // so the sandbox and other callers keep the full x-ray.
  colored = true,
): void {
  const { ctx } = vp
  panel(vp, p, rect)
  const { sol } = eng
  const ch = sol.chambers[chamberIndex]
  const r = eng.readouts[chamberIndex]
  const sc = eng.sim.chambers[chamberIndex]
  if (!ch || !r || !sc) return
  const P = sol.params
  const R = P.plugRadius
  const rb = P.boreRadius
  const state = eng.stateOf(chamberIndex)

  // The window: scale from the height, width from the scale, centred in the panel.
  const viewBottom = P.floorY - VIEW_BOTTOM_BELOW_FLOOR_MM
  const s = (rect.h - CAPTION_H * 2) / (VIEW_TOP_MM - viewBottom)
  const winW = Math.min(rect.w - INSET * 2, VIEW_WIDTH_MM * s)
  const win: Rect = {
    x: rect.x + (rect.w - winW) / 2,
    y: rect.y + CAPTION_H,
    w: winW,
    h: rect.h - CAPTION_H * 2,
  }
  const ox = win.x + win.w / 2
  /** The shear line — the plug's top at the axis — in screen y. */
  const oy = win.y + VIEW_TOP_MM * s
  const X = (mm: number): number => ox + mm * s
  const Y = (mm: number): number => oy - mm * s
  const plugCy = Y(-R)

  // ── Captions ──
  const size = typeFor(vp, TYPE.dimension)
  label(ctx, `front — pin ${chamberIndex + 1}`, rect.x + 14, rect.y + 24, {
    font: font(size),
    size,
    color: p.inkLight,
  })
  const deg = theta / DEG
  const cant = r.driverCant / DEG
  // The whole line where it fits; on a narrow panel (a phone, with the wrench slider beside it)
  // the type shrinks a little, and if that is still not enough the cant goes: the state word and
  // the plug's angle are what the caption is for.
  const full = `${stateWord(state)}  ·  plug ${deg.toFixed(2)}°  ·  cant ${cant.toFixed(1)}°`
  const short = `${stateWord(state)}  ·  plug ${deg.toFixed(2)}°`
  ctx.save()
  const width = (t: string, sz: number): number => {
    ctx.font = font(sz)
    return ctx.measureText(t.toUpperCase()).width + sz * 0.08 * (t.length - 1)
  }
  const room = rect.w - 28
  // Never below the readability floor (D-223): at 0.75 of the face the caption drew at ~9 CSS px
  // on the smallest phones. What cannot fit at the floor loses words instead — the cant, then the
  // angle — never legibility.
  const floor = Math.min(size, Math.max(Math.ceil(size * 0.75), Math.ceil((MIN_TYPE_CSS - 0.5) / vp.scale)))
  let text = full
  let capSize = size
  for (const candidate of [full, short, stateWord(state)]) {
    text = candidate
    capSize = size
    while (width(text, capSize) > room && capSize > floor) capSize -= 1
    if (width(text, capSize) <= room) break
  }
  ctx.restore()
  label(ctx, text, rect.x + rect.w - 14, rect.y + rect.h - 14, { font: font(capSize), size: capSize, color: p.inkLight, align: 'right' })

  ctx.save()
  ctx.beginPath()
  ctx.rect(win.x, win.y, win.w, win.h)
  ctx.clip()

  // ── Shell: everything in the window is brass until the plug's hole and the bore are cut out ──
  ctx.fillStyle = p.shellBody
  ctx.fillRect(win.x, win.y, win.w, win.h)
  hatchPath(
    ctx,
    () => {
      ctx.rect(win.x, win.y, win.w, win.h)
    },
    win,
    { spacing: HATCH_SPACING, angleDeg: 45, color: p.rule, lineWidth: 1 },
  )
  // The hole the plug turns in, and the shell's bore — offset by this chamber's δ, drilled from the
  // seat until it breaks into the hole. ONE void: the walls end where they meet the hole's arc.
  const hx = -ch.delta
  const seatY = Y(P.seatY)
  ctx.fillStyle = p.paper
  ctx.beginPath()
  // The housing's underside is `shearGap` above the plug's top: the same clearance the solver has.
  ctx.arc(X(0), plugCy, (R + P.shearGap) * s + 0.5, 0, Math.PI * 2)
  ctx.rect(X(hx - rb), seatY, 2 * rb * s, plugCy - seatY)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(X(hx - rb), Y(housingY(P, hx - rb)))
  ctx.lineTo(X(hx - rb), seatY)
  ctx.lineTo(X(hx + rb), seatY)
  ctx.lineTo(X(hx + rb), Y(housingY(P, hx + rb)))
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = p.ink
  ctx.stroke()

  // ── The set window across the bore: teal to aim at, crimson past it ──
  // A coloured aim overlay — Training and lessons only, off on Normal (D-218).
  if (colored) {
    const w = setWindow(sol)
    ctx.fillStyle = p.teal
    ctx.globalAlpha = 0.28
    ctx.fillRect(X(hx - rb), Y(w.to), 2 * rb * s, Y(w.from) - Y(w.to))
    ctx.fillStyle = p.crimson
    ctx.globalAlpha = 0.12
    ctx.fillRect(X(hx - rb), Y(w.to + 1.2), 2 * rb * s, Y(w.to) - Y(w.to + 1.2))
    ctx.globalAlpha = 1
  }

  // ── Spring, the game's construction, from the seat down to the driver's top ──
  {
    const top = seatY
    const bottom = Y(r.driverY + ch.driver.topU * Math.cos(r.driverCant))
    const cx = X(r.driverX - ch.driver.topU * Math.sin(r.driverCant))
    const height = Math.max(2, bottom - top)
    const halfW = P.pinRadius * 0.72 * s
    const coils = 5
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = p.inkLight
    ctx.beginPath()
    ctx.moveTo(cx, top)
    for (let i = 0; i < coils; i += 1) {
      const y0 = top + (height * (i + 0.5)) / coils
      const y1 = top + (height * (i + 1)) / coils
      ctx.lineTo(cx + (i % 2 === 0 ? halfW : -halfW), y0)
      ctx.lineTo(cx, y1)
    }
    ctx.stroke()
  }

  // ── Plug: a circle turned by the solver's angle, with its bore and the keyway slot cut out ──
  ctx.save()
  ctx.translate(X(0), plugCy)
  // The solver's chamber plane is CCW-positive; the canvas turns the other way.
  ctx.rotate(-theta)
  const lx = (mm: number): number => mm * s
  const ly = (mm: number): number => -(mm + R) * s
  {
    ctx.save()
    ctx.beginPath()
    ctx.arc(0, 0, R * s, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = p.plugBody
    ctx.fillRect(-R * s, -R * s, R * 2 * s, R * 2 * s)
    hatchPath(
      ctx,
      () => {
        ctx.arc(0, 0, R * s, 0, Math.PI * 2)
      },
      { x: -R * s, y: -R * s, w: R * 2 * s, h: R * 2 * s },
      { spacing: HATCH_SPACING, angleDeg: -45, color: p.rule, lineWidth: 1 },
    )
    // The plug's bore, from the keyway's ceiling out through the rim, and the slot the key pin's
    // tip hangs through.
    ctx.fillStyle = p.paper
    ctx.fillRect(lx(-rb), ly(1), 2 * rb * s, (1 - P.floorY) * s)
    ctx.fillRect(lx(-P.slotHalf), ly(P.floorY), 2 * P.slotHalf * s, (P.floorY - P.keywayFloorY) * s)
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = p.ink
    ctx.strokeRect(lx(-rb), ly(1), 2 * rb * s, (1 - P.floorY) * s)
    ctx.strokeRect(lx(-P.slotHalf), ly(P.floorY), 2 * P.slotHalf * s, (P.floorY - P.keywayFloorY) * s)
    ctx.restore()
  }
  // The rim, where there is rim: round to the bore's opening and stop.
  const opening = Math.asin(rb / R)
  ctx.beginPath()
  ctx.arc(0, 0, R * s, -Math.PI / 2 + opening, (3 * Math.PI) / 2 - opening)
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.stroke()
  ctx.restore()

  // ── The pins: the solver's own polygons, cant and all, in the solver's world frame ──
  // The key pin sits in the plug's bore, so when the drawn plug is turned beyond the solver's
  // angle (the open turn, after the solver has stopped) it turns with it, about the plug's axis;
  // the driver is in the shell and stays (owner: "when the lock is opened the key pin becomes
  // part of the plug body").
  const extra = theta - eng.theta()
  const withPlug = (draw: () => void): void => {
    if (extra === 0) {
      draw()
      return
    }
    ctx.save()
    ctx.translate(X(0), plugCy)
    ctx.rotate(-extra)
    ctx.translate(-X(0), -plugCy)
    draw()
    ctx.restore()
  }
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  withPlug(() => {
    polyPath(ctx, ch.key, X, Y)
    // Normal drops the overset tint and paints the driver steel: geometry stays, colour goes (D-218).
    ctx.fillStyle =
      colored && state === 'OVERSET' ? mix(p.steel, p.crimson, 0.55) : mix(p.steel, p.paper, 0.32)
    ctx.fill()
    ctx.stroke()
  })
  polyPath(ctx, ch.driver, X, Y)
  ctx.fillStyle = stateColor(p, colored ? stateKey(sc) : 'free')
  ctx.fill()
  ctx.stroke()

  // ── The shear line: an annotation, not an edge — at the bore's edge, as the side view draws it ──
  const shearY = Y(shearLineMm(P))
  ctx.save()
  ctx.setLineDash([4, 6])
  ctx.beginPath()
  ctx.moveTo(win.x, shearY)
  ctx.lineTo(win.x + win.w, shearY)
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = p.inkLight
  ctx.stroke()
  ctx.restore()

  // ── Where it is caught, and where it merely rests ──
  // Only two kinds of contact say anything: a WALL pinching the pin (amber; crimson while it slips)
  // and the RIM or LEDGE carrying it (a small teal mark — a set driver sits on the plug's rim and
  // that is not a block; the owner read the amber dot there as "still touching and preventing the
  // plug from rotation"). Pin-on-pin, the slot lips and the pick are support, not story.
  // None during the drawn open turn: the solver has stopped and its last contacts are stale.
  // This is the "why it is stuck" narration in colour, so it belongs to Training and lessons only —
  // Normal shows the plain face and lets you read the block yourself (D-218).
  const c = sol.contacts
  for (let j = colored ? (extra === 0 ? 0 : c.count) : c.count; j < c.count; j += 1) {
    if (c.chamber[j] !== chamberIndex) continue
    const cls = c.cls[j]!
    const wall = cls === CLS_PLUG_WALL || cls === CLS_HOUSING_WALL
    const rest = cls === CLS_PLUG_RIM || cls === CLS_PLUG_LEDGE || cls === CLS_HOUSING_RIM || cls === CLS_HOUSING_LEDGE
    if (!wall && !rest) continue
    const F = c.lamN[c.slot[j]!]! / sol.h
    if (F < 0.05) continue
    // Bigger and bolder at the owner's word (D-221): crimson wherever a pin is still holding the
    // plug (binding, a false set), teal once it is SET and merely resting on the rim, each ringed
    // in ink so it reads on the metal. Sized by the contact force so the hardest block is loudest.
    ctx.beginPath()
    ctx.arc(X(c.px[j]!), Y(c.py[j]!), wall ? 6 + Math.min(12, F * 2) : 5.5, 0, Math.PI * 2)
    ctx.fillStyle = state === 'SET' ? p.teal : p.crimson
    ctx.globalAlpha = 0.9
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = p.ink
    ctx.stroke()
  }

  ctx.restore()
  ctx.save()
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = p.ink
  ctx.strokeRect(win.x, win.y, win.w, win.h)
  ctx.restore()
}
