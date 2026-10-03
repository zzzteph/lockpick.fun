/**
 * SOLVERBENCH — the game's bench, running on the 2.5D contact solver in `solver/`.
 *
 * Same idea as `phyzbench.ts`: the game's own cutaway and HUD, with nothing behind them but the
 * solver. Two views side by side — the cutaway (x–y, with the real pick polygon drawn through the
 * cutaway's millimetre mapping) and one chamber's rotation plane (y–z, where the pin cants) —
 * plus readouts for θ, cant, tip deflection and contact forces.
 *
 * Controls: pointer over the lock aims the pick tip; the sliders (bottom-left) do the same when
 * the pointer is elsewhere; wheel or 1–5 for tension; hold the mouse or W to latch the wrench;
 * arrows nudge the hand; H / R / D pick; C picks the chamber in the side view; [ ] change lock;
 * N or space reseeds.
 *
 * Dev-only. The build's single input is still `index.html`.
 */

import { drawGrid } from '../render/draw'
import { drawHud, type HudOptions } from '../render/hud'
import { DRAFTING, TYPE, font } from '../render/palette'
import { label } from '../render/draw'
import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  beginFrame,
  clientToLogical,
  clipToStage,
  createViewport,
  syncViewport,
  typeFor,
} from '../render/viewport'
import { Ui, button, panel, pointInRect, segmented, type Rect, type UiFrame } from '../ui/widgets'
import { ALL_LOCKS } from '../game/locks'
import {
  PERFECT_TOOLS,
  THETA_OPEN as SIM_THETA_OPEN,
  createSimState,
  type ChamberState,
  type LockDef as GameLockDef,
  type PinTypeName,
  type SimConfig,
  type SimState,
} from '../sim'
import {
  BODY_PLUG,
  CLS_PICK_PIN,
  DEFAULT_PARAMS,
  DIAMOND,
  DOF,
  DT,
  HOOK,
  MUSHROOM,
  RAKE,
  SERRATED,
  SPOOL,
  SPOOL_DEEP,
  STANDARD,
  T_PIN,
  aimTip,
  circleY,
  createLock,
  plugAngle,
  readChamber,
  readPick,
  step,
  type ChamberReadout,
  type LockDef,
  type PickProfile,
  type PickReadout,
  type PinProfile,
  type SolverInput,
  type SolverState,
} from '../solver'

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLCanvasElement)) throw new Error('#stage canvas missing')
const canvas: HTMLCanvasElement = stage
const vp = createViewport(canvas)
const ctx = vp.ctx
const P = DRAFTING
const ui = new Ui()
const DEG = Math.PI / 180

const CONFIG: SimConfig = { tools: PERFECT_TOOLS, featherEnabled: true, assist: 'training' }
const LOCKS: GameLockDef[] = ALL_LOCKS.filter((l) => l.family === 'pin-tumbler')
const PICKS: Record<string, PickProfile> = { hook: HOOK, rake: RAKE, diamond: DIAMOND }

const params = new URLSearchParams(location.search)
const wanted = params.get('lock')
const startAt = wanted ? LOCKS.findIndex((l) => l.slug === wanted || String(l.id) === wanted) : 0
if (wanted && startAt < 0) throw new Error(`?lock=${wanted} is not a pin-tumbler roster lock`)

const TENSIONS = [0.1, 0.18, 0.26, 0.36, 0.5] as const

/** The bench's hand is gentler than the tests' shove: 6 N is a hard push on a 0.6 mm blade. */
const BENCH_PARAMS = { ...DEFAULT_PARAMS, handMaxForce: 6 }

/** The game's pin types as solver profiles. Every one is a polygon; the solver never sees a name. */
function driverFor(name: PinTypeName): PinProfile {
  switch (name) {
    case 'spool':
      return SPOOL
    case 'spool-slim':
    case 'spool-deep':
    case 'spool-double':
      return SPOOL_DEEP
    case 'serrated':
      return SERRATED
    case 'mushroom':
      return MUSHROOM
    case 't-pin':
      return T_PIN
    default:
      return STANDARD
  }
}

/** A seeded shuffle for the tolerance order. */
function shuffled(n: number, seed: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  let x = seed >>> 0
  for (let i = n - 1; i > 0; i -= 1) {
    x = (x * 1664525 + 1013904223) >>> 0
    const j = x % (i + 1)
    const t = order[i]!
    order[i] = order[j]!
    order[j] = t
  }
  return order
}

/**
 * The game's lock as a solver lock. The game's set lift is `5 − K`; the solver's is
 * `rim − keyTop = 3.86 − K`, so key lengths are shifted to keep the lifts the player learned.
 */
function solverLock(def: GameLockDef, seed: number, pick: PickProfile): LockDef {
  const n = def.bitting.length
  const order = shuffled(n, seed)
  // Housing offsets a real 0.06 mm apart (tighter on a tight-tolerance lock, looser on an easy
  // one): the gap between one chamber's δ and the next is the ledge the earlier set sits on.
  const gap = 0.06 * Math.max(0.5, Math.min(1.5, def.toleranceQuality))
  return {
    chambers: def.pins.map((name, i) => {
      const setLift = Math.max(0.3, Math.min(2.6, 4 - (def.bitting[i] ?? 3)))
      return {
        keyLength: 3.86 - setLift,
        driver: driverFor(name),
        delta: gap * order[i]!,
      }
    }),
    pick,
  }
}

let lockIndex = Math.max(0, startAt)
let seed = 0x5ea51e
let pickName = params.get('tool') ?? 'hook'
if (!(pickName in PICKS)) pickName = 'hook'
let tensionLevel = 1
let wrenchLatched = false
let sideChamber = 0

/** The bench's solver parameters for a lock: the keyway ends 3.5 mm past its last chamber. */
function benchParams(def: GameLockDef): typeof BENCH_PARAMS {
  const n = def.bitting.length
  return { ...BENCH_PARAMS, keywayDepth: BENCH_PARAMS.firstChamberX + BENCH_PARAMS.pitch * (n - 1) + 3.5 }
}

let def: GameLockDef = LOCKS[lockIndex]!
let sol: SolverState = createLock(solverLock(def, seed, PICKS[pickName]!), benchParams(def))
let sim: SimState = createSimState(def, seed, CONFIG)

function tipRest(s: SolverState): number {
  const ch = s.chambers[0]!
  return ch.keyRestY + ch.key.bottomU
}

function rebuild(): void {
  def = LOCKS[lockIndex]!
  sol = createLock(solverLock(def, seed, PICKS[pickName]!), benchParams(def))
  sim = createSimState(def, seed, CONFIG)
  sideChamber = Math.min(sideChamber, sol.chambers.length - 1)
}

// ── Reading the solver as the game's states ──────────────────────────────────────────────────

function chamberState(r: ChamberReadout, s: SolverState): ChamberState {
  // Overset is geometry: the key pin's top is above the shear line, whether or not it is pinched.
  if (r.keyTopY > s.rimY + 0.25) return 'OVERSET'
  // On the ledge the driver carries about the spring's force; pinched in the bore it carries the
  // wrench's, which is several times more.
  if (r.driverClearance > -0.3 && r.driverLift > 0.15 && r.plugForce < 1.8) return 'SET'
  if (Math.abs(r.driverCant) > 2 * DEG && r.plugForce > 0.3) return 'FALSE_SET'
  if (r.plugForce > 0.3) return 'BINDING'
  return 'FREE'
}

/** Which chamber the pick tip is under, by x. */
function chamberUnderTip(s: SolverState): number {
  const p = readPick(s)
  if (p.tipX < 1) return -1
  let best = -1
  let bestD = Infinity
  s.chambers.forEach((ch, i) => {
    const d = Math.abs(ch.x - p.tipX)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return bestD < s.params.pitch * 0.6 ? best : -1
}

let readouts: ChamberReadout[] = []
let bindingChamber = -1

/** Pour a solver tick into the game's read model. */
function project(): void {
  readouts = sol.chambers.map((_, i) => readChamber(sol, i))
  const pick = readPick(sol)
  // The side view follows whatever the pick is under; C still cycles it while the pick is out.
  const under = chamberUnderTip(sol)
  if (under >= 0) sideChamber = under
  bindingChamber = -1
  let bestF = 0.3
  readouts.forEach((r, i) => {
    if (r.plugForce > bestF && chamberState(r, sol) === 'BINDING') {
      bestF = r.plugForce
      bindingChamber = i
    }
  })
  const T = sol.input.tension
  sim.tension = T
  sim.tensionCommanded = T
  sim.theta = plugAngle(sol)
  sim.thetaMax = SIM_THETA_OPEN
  sim.thetaDemand = SIM_THETA_OPEN * Math.min(1, T / 0.25)
  sim.bindingChamber = bindingChamber
  sim.pickChamber = chamberUnderTip(sol)
  sim.pickPosition = sim.pickChamber < 0 ? -1 : pick.tipX / sol.params.pitch
  sim.resistance = Math.min(1, pick.force / 6)
  sim.pickForce = Math.min(1, pick.force / 6)
  sim.pickContact = pick.force > 0.05 ? 1 : 0
  sim.pickStrain = Math.min(1, pick.bendDeflection / 3)
  sim.opened = plugAngle(sol) > SIM_THETA_OPEN * 0.98
  sim.time = sol.time
  sim.engaged = T > 0
  readouts.forEach((r, i) => {
    const sc = sim.chambers[i]
    if (!sc) return
    sc.lift = Math.max(0, r.driverLift)
    sc.keyLift = Math.max(0, r.keyLift)
    sc.state = chamberState(r, sol)
  })
}

// ── Mapping solver millimetres onto the page: one scale on both axes, the lock centred ────────

interface Frame {
  sx(mm: number): number
  sy(mm: number): number
}

/** Logical pixels per millimetre. 36 fits a six-pin lock, springs and all, between the bars. */
const PX_PER_MM = 36
/** Where the solver's shear line sits on the page. */
const SHEAR_PAGE_Y = 480

function frameFor(): Frame {
  const width = sol.params.keywayDepth * PX_PER_MM
  const x0 = Math.max(200, 24 + (WORK.w - width) / 2)
  return {
    sx: (mm) => x0 + mm * PX_PER_MM,
    sy: (mm) => SHEAR_PAGE_Y - mm * PX_PER_MM,
  }
}

function mmAtPointer(f: Frame, px: number, py: number): { x: number; y: number } {
  return {
    x: (px - f.sx(0)) / PX_PER_MM,
    y: (SHEAR_PAGE_Y - py) / PX_PER_MM,
  }
}

/** Colour a driver by what the solver says it is doing — the game's own vocabulary. */
function driverColour(state: ChamberState): string {
  switch (state) {
    case 'SET':
      return P.teal
    case 'FALSE_SET':
      return P.violet
    case 'OVERSET':
      return P.crimson
    case 'BINDING':
      return P.amber
    default:
      return P.steel
  }
}

/**
 * The lock, drawn from the solver and nothing else: shell and plug bodies, the keyway, each
 * chamber's two bores (the plug's slid by the true r·θ, the housing's by its δ), the springs,
 * and the pins as the very polygons the chamber plane solves — cant included. The side panel
 * draws the same polygons, so a set looks the same from both directions.
 */
function drawSolverCutaway(f: Frame): void {
  const Pm = sol.params
  const q = sol.bodies.q
  const x0 = f.sx(0)
  const x1 = f.sx(Pm.keywayDepth)
  const shearY = f.sy(sol.rimY)
  const shellTop = f.sy(Pm.seatY + 0.8)
  const plugBottom = f.sy(Pm.keywayFloorY - 1.7)
  const roofY = f.sy(Pm.keywayCeilY)
  const floorY = f.sy(Pm.keywayFloorY)
  const perMm = Math.abs(f.sx(1) - f.sx(0))
  const boreW = 2 * Pm.boreRadius * perMm
  const shift = -Pm.plugRadius * Math.sin(viewTheta)

  // bodies
  ctx.fillStyle = P.shellBody
  ctx.fillRect(x0, shellTop, x1 - x0, shearY - shellTop)
  ctx.fillStyle = P.plugBody
  ctx.fillRect(x0, shearY, x1 - x0, plugBottom - shearY)
  // the keyway, open at the face, closed at the back
  ctx.fillStyle = P.paper
  ctx.fillRect(x0 - 2, roofY, x1 - x0 + 2 - 2 * perMm, floorY - roofY)
  // bores: housing above the shear line, plug below, each where the chamber plane has it
  for (const ch of sol.chambers) {
    const hx = f.sx(ch.x - ch.delta)
    ctx.fillStyle = P.paper
    ctx.fillRect(hx - boreW / 2, f.sy(Pm.seatY), boreW, shearY - f.sy(Pm.seatY))
    const px = f.sx(ch.x + shift)
    ctx.fillRect(px - boreW / 2, shearY, boreW, f.sy(Pm.floorY) - shearY)
    // the slot the key pin's tip hangs through
    const slotW = 2 * Pm.slotHalf * perMm
    ctx.fillRect(px - slotW / 2, f.sy(Pm.floorY) - 1, slotW, f.sy(Pm.keywayCeilY) - f.sy(Pm.floorY) + 2)
  }
  // outlines: the body, with the mouth open in its face, and the shear line
  ctx.strokeStyle = P.ink
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x0, roofY)
  ctx.lineTo(x0, shellTop)
  ctx.lineTo(x1, shellTop)
  ctx.lineTo(x1, plugBottom)
  ctx.lineTo(x0, plugBottom)
  ctx.lineTo(x0, floorY)
  ctx.moveTo(x0, shearY)
  ctx.lineTo(x1, shearY)
  ctx.stroke()
  ctx.lineWidth = 1
  for (const ch of sol.chambers) {
    const hx = f.sx(ch.x - ch.delta)
    ctx.strokeRect(hx - boreW / 2, f.sy(Pm.seatY), boreW, shearY - f.sy(Pm.seatY))
    const px = f.sx(ch.x + shift)
    ctx.strokeRect(px - boreW / 2, shearY, boreW, f.sy(Pm.floorY) - shearY)
  }
  ctx.beginPath()
  ctx.moveTo(x0, roofY)
  ctx.lineTo(x1 - 2 * perMm, roofY)
  ctx.lineTo(x1 - 2 * perMm, floorY)
  ctx.lineTo(x0, floorY)
  ctx.stroke()

  // springs
  ctx.strokeStyle = P.inkLight
  ctx.lineWidth = 1.5
  for (const ch of sol.chambers) {
    const d = ch.driver.body * DOF
    const phi = q[d + 2]!
    const topY = q[d + 1]! + ch.driver.topU * Math.cos(phi)
    const topX = ch.x + q[d]! - ch.driver.topU * Math.sin(phi)
    ctx.beginPath()
    const coils = 7
    for (let i = 0; i <= coils; i += 1) {
      const y = topY + ((Pm.seatY - topY) * i) / coils
      const x = topX + (i % 2 === 0 ? -0.7 : 0.7) * (i === 0 || i === coils ? 0 : 1)
      if (i === 0) ctx.moveTo(f.sx(x), f.sy(y))
      else ctx.lineTo(f.sx(x), f.sy(y))
    }
    ctx.stroke()
  }

  // pins: the chamber plane's polygons, placed at the chamber's x
  sol.chambers.forEach((ch, i) => {
    const r = readouts[i]
    const state: ChamberState = r ? chamberState(r, sol) : 'FREE'
    for (const [pin, colour] of [
      [ch.key, P.amber],
      [ch.driver, driverColour(state)],
    ] as const) {
      const W = pin.world
      ctx.beginPath()
      for (let v = 0; v < pin.count; v += 1) {
        const x = f.sx(ch.x + W[v * 2]!)
        const y = f.sy(W[v * 2 + 1]!)
        if (v === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fillStyle = colour
      ctx.fill()
      ctx.strokeStyle = P.ink
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
  })

  // chamber contacts, the same dots as the side panel
  const c = sol.contacts
  for (let j = 0; j < c.count; j += 1) {
    const chIdx = c.chamber[j]!
    if (chIdx < 0 || c.cls[j] === CLS_PICK_PIN) continue
    const F = c.lamN[c.slot[j]!]! / sol.h
    if (F < 0.05) continue
    const ch = sol.chambers[chIdx]!
    ctx.beginPath()
    ctx.arc(f.sx(ch.x + c.px[j]!), f.sy(c.py[j]!), 2 + Math.min(7, F * 1.5), 0, Math.PI * 2)
    ctx.fillStyle = c.sliding[c.slot[j]!] ? 'rgba(240, 160, 40, 0.7)' : 'rgba(220, 60, 60, 0.6)'
    ctx.fill()
  }

  // labels, as the game has them
  const size = typeFor(vp, TYPE.dimension)
  label(ctx, 'SHEAR LINE', x0 - 12, shearY - 6, { font: font(size), size, color: P.ink, align: 'right' })
  label(ctx, 'SHELL', x1 + 12, shellTop + 24, { font: font(size), size, color: P.inkLight })
  label(ctx, 'PLUG', x1 + 12, shearY + 24, { font: font(size), size, color: P.inkLight })
  label(ctx, 'KEYWAY', x1 + 12, floorY - 8, { font: font(size), size, color: P.inkLight })
}

function drawPick(f: Frame): void {
  const pick = sol.pick
  const W = pick.world
  ctx.beginPath()
  for (let i = 0; i < pick.count; i += 1) {
    const x = f.sx(W[i * 2]!)
    const y = f.sy(W[i * 2 + 1]!)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = P.steel
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = P.ink
  ctx.stroke()
  // the flex point
  ctx.beginPath()
  ctx.arc(f.sx(pick.flexWX), f.sy(pick.flexWY), 3, 0, Math.PI * 2)
  ctx.fillStyle = P.crimson
  ctx.fill()
  // pick contacts
  const c = sol.contacts
  for (let j = 0; j < c.count; j += 1) {
    if (c.cls[j] !== CLS_PICK_PIN) continue
    const F = c.lamN[c.slot[j]!]! / sol.h
    if (F < 0.02) continue
    ctx.beginPath()
    ctx.arc(f.sx(c.px[j]!), f.sy(c.py[j]!), 2 + Math.min(8, F * 2), 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(220, 60, 60, 0.6)'
    ctx.fill()
  }
}

// ── The rotation plane: one chamber, seen along the keyway ───────────────────────────────────

const SIDE: Rect = { x: LOGICAL_WIDTH - 24 - 380, y: 190, w: 380, h: 430 }

function polyPath(W: Float64Array, count: number, tx: (x: number) => number, ty: (y: number) => number): void {
  ctx.beginPath()
  for (let i = 0; i < count; i += 1) {
    const x = tx(W[i * 2]!)
    const y = ty(W[i * 2 + 1]!)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function drawSideView(): void {
  const Pm = sol.params
  const ch = sol.chambers[sideChamber]
  if (!ch) return
  const r = readouts[sideChamber]!
  panel(vp, P, SIDE)
  const scale = 34
  const cx = SIDE.x + SIDE.w / 2
  const cy = SIDE.y + 235
  const tx = (x: number): number => cx + x * scale
  const ty = (y: number): number => cy - y * scale
  ctx.save()
  ctx.beginPath()
  ctx.rect(SIDE.x + 1, SIDE.y + 1, SIDE.w - 2, SIDE.h - 2)
  ctx.clip()

  // housing: everything above the shear circle, minus its bore
  const R = Pm.plugRadius
  const rb = Pm.boreRadius
  const xh = -ch.delta
  ctx.fillStyle = P.shellBody
  ctx.beginPath()
  ctx.rect(SIDE.x, SIDE.y, SIDE.w, ty(0) - SIDE.y)
  ctx.fill()
  ctx.fillStyle = P.paper
  ctx.beginPath()
  ctx.arc(tx(0), ty(-R), R * scale, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.rect(tx(xh - rb), ty(Pm.seatY), 2 * rb * scale, (Pm.seatY - circleY(Pm, rb + ch.delta)) * scale + 2)
  ctx.fill()
  // plug: the disc, rotated, with its bore slot and the keyway slot cut
  ctx.save()
  ctx.translate(tx(0), ty(-R))
  ctx.rotate(-plugAngle(sol))
  ctx.fillStyle = P.plugBody
  ctx.beginPath()
  ctx.arc(0, 0, R * scale, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = P.paper
  ctx.beginPath()
  ctx.rect(-rb * scale, -(R + 0.5) * scale, 2 * rb * scale, (R + 0.5 - (R + Pm.floorY)) * scale)
  ctx.fill()
  ctx.beginPath()
  ctx.rect(-Pm.slotHalf * scale, -(R + Pm.floorY) * scale, 2 * Pm.slotHalf * scale, (Pm.floorY - Pm.keywayFloorY) * scale)
  ctx.fill()
  ctx.restore()
  // shear line
  ctx.strokeStyle = P.crimson
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(SIDE.x, ty(0))
  ctx.lineTo(SIDE.x + SIDE.w, ty(0))
  ctx.stroke()
  ctx.setLineDash([])

  // pins
  for (const pin of [ch.key, ch.driver]) {
    polyPath(pin.world, pin.count, tx, ty)
    ctx.fillStyle = P.amber
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = P.ink
    ctx.stroke()
  }
  // spring, as a zigzag from the driver's top to the seat
  const q = sol.bodies.q
  const d = ch.driver.body * DOF
  const topY = q[d + 1]! + ch.driver.topU * Math.cos(q[d + 2]!)
  const topX = q[d]! - ch.driver.topU * Math.sin(q[d + 2]!)
  ctx.strokeStyle = P.inkLight
  ctx.lineWidth = 1.5
  ctx.beginPath()
  const coils = 8
  for (let i = 0; i <= coils; i += 1) {
    const y = topY + ((Pm.seatY - topY) * i) / coils
    const x = topX + (i % 2 === 0 ? -0.6 : 0.6) * (i === 0 || i === coils ? 0 : 1)
    if (i === 0) ctx.moveTo(tx(x), ty(y))
    else ctx.lineTo(tx(x), ty(y))
  }
  ctx.stroke()

  // contacts in this chamber
  const c = sol.contacts
  for (let j = 0; j < c.count; j += 1) {
    if (c.chamber[j] !== sideChamber || c.cls[j] === CLS_PICK_PIN) continue
    const F = c.lamN[c.slot[j]!]! / sol.h
    if (F < 0.02) continue
    const x = tx(c.px[j]!)
    const y = ty(c.py[j]!)
    ctx.beginPath()
    ctx.arc(x, y, 2 + Math.min(9, F * 1.5), 0, Math.PI * 2)
    ctx.fillStyle = c.sliding[c.slot[j]!] ? 'rgba(240, 160, 40, 0.7)' : 'rgba(220, 60, 60, 0.6)'
    ctx.fill()
    ctx.strokeStyle = P.ink
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + c.nx[j]! * 14, y - c.ny[j]! * 14)
    ctx.stroke()
  }
  ctx.restore()

  const size = typeFor(vp, TYPE.dimension)
  const cap = (str: string, y: number): void => {
    label(ctx, str, SIDE.x + 12, y, { font: font(size), size, color: P.ink })
  }
  cap(`ch ${sideChamber + 1} ${ch.driver.profile.name} δ=${ch.delta.toFixed(3)} [C]`, SIDE.y + 20)
  cap(`θ ${(plugAngle(sol) / DEG).toFixed(2)}° cant drv ${(r.driverCant / DEG).toFixed(1)}° key ${(r.keyCant / DEG).toFixed(1)}°`, SIDE.y + 40)
  cap(`drv N: plug ${r.plugForce.toFixed(1)} hsg ${r.housingForce.toFixed(1)} clr ${r.driverClearance.toFixed(2)}`, SIDE.y + SIDE.h - 44)
  cap(`key N: plug ${r.keyPlugForce.toFixed(1)} hsg ${r.keyHousingForce.toFixed(1)} pick ${r.pickForce.toFixed(1)}`, SIDE.y + SIDE.h - 24)
}

// ── Input ────────────────────────────────────────────────────────────────────────────────────

const WORK: Rect = { x: 0, y: 96, w: LOGICAL_WIDTH - 24 - 390, h: LOGICAL_HEIGHT - 96 - 160 }

const tensionSlider = document.getElementById('tension') as HTMLInputElement
const handXSlider = document.getElementById('handX') as HTMLInputElement
const handYSlider = document.getElementById('handY') as HTMLInputElement
const tensionVal = document.getElementById('tensionVal') as HTMLSpanElement
const handXVal = document.getElementById('handXVal') as HTMLSpanElement
const handYVal = document.getElementById('handYVal') as HTMLSpanElement

let pointerX = -1
let pointerY = -1
let pressingWork = false
let clicked = false
const keyCodes = new Set<string>()
const held = new Set<string>()

canvas.addEventListener('pointermove', (e) => {
  const pt = clientToLogical(vp, e.clientX, e.clientY)
  pointerX = pt.x
  pointerY = pt.y
})
canvas.addEventListener('pointerdown', (e) => {
  const pt = clientToLogical(vp, e.clientX, e.clientY)
  pointerX = pt.x
  pointerY = pt.y
  if (pointInRect(WORK, pt.x, pt.y)) pressingWork = true
})
window.addEventListener('pointerup', () => {
  clicked = true
  pressingWork = false
})
canvas.addEventListener('contextmenu', (e) => e.preventDefault())
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    const dir = e.deltaY < 0 ? 1 : -1
    tensionLevel = Math.max(0, Math.min(TENSIONS.length - 1, tensionLevel + dir))
    tensionSlider.value = String(TENSIONS[tensionLevel])
  },
  { passive: false },
)
tensionSlider.addEventListener('input', () => {
  const t = Number(tensionSlider.value)
  let best = 0
  TENSIONS.forEach((v, i) => {
    if (Math.abs(v - t) < Math.abs(TENSIONS[best]! - t)) best = i
  })
  tensionLevel = best
})

let shiftHeld = false
function nudge(id: string, by: number): void {
  const el = id === 'handY' ? handYSlider : handXSlider
  el.value = (Number(el.value) + by).toFixed(3)
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return
  keyCodes.add(e.code)
  held.add(e.code)
  shiftHeld = e.shiftKey
  const fine = e.shiftKey ? 0.02 : 0.1
  if (e.code === 'ArrowUp') nudge('handY', fine)
  else if (e.code === 'ArrowDown') nudge('handY', -fine)
  else if (e.code === 'ArrowLeft') nudge('handX', -fine * 5)
  else if (e.code === 'ArrowRight') nudge('handX', fine * 5)
  if (e.key >= '1' && e.key <= '5') {
    tensionLevel = Number(e.key) - 1
    tensionSlider.value = String(TENSIONS[tensionLevel])
  } else if (e.key === 'h') setPick('hook')
  else if (e.key === 'r') setPick('rake')
  else if (e.key === 'd') setPick('diamond')
  else if (e.key === 'w') wrenchLatched = !wrenchLatched
  else if (e.key === 'c') sideChamber = (sideChamber + 1) % sol.chambers.length
  else if (e.key === '[') stepLock(-1)
  else if (e.key === ']') stepLock(1)
  else if (e.key === 'n' || e.key === ' ') {
    e.preventDefault()
    seed = (seed * 1664525 + 1013904223) >>> 0
    rebuild()
  }
  if (e.code.startsWith('Arrow')) e.preventDefault()
})
window.addEventListener('keyup', (e) => {
  held.delete(e.code)
  shiftHeld = e.shiftKey
})

function setPick(name: string): void {
  if (!(name in PICKS) || name === pickName) return
  pickName = name
  rebuild()
}

function stepLock(delta: number): void {
  lockIndex = (((lockIndex + delta) % LOCKS.length) + LOCKS.length) % LOCKS.length
  rebuild()
}

// ── Controls row ─────────────────────────────────────────────────────────────────────────────

function drawControls(): void {
  const rowY = 108
  const rowH = 40
  const cap = (str: string, x: number, y: number): void => {
    label(ctx, str, x, y, {
      font: font(typeFor(vp, TYPE.dimension)),
      size: typeFor(vp, TYPE.dimension),
      color: P.inkLight,
    })
  }
  panel(vp, P, { x: 24, y: rowY - 26, w: 640, h: rowH + 34 })
  cap('pick', 40, rowY - 6)
  const names = ['hook', 'rake', 'diamond']
  const t = segmented(vp, P, ui, { x: 40, y: rowY, w: 230, h: rowH }, names, names.indexOf(pickName))
  setPick(names[t]!)
  cap('tension (scroll, 1-5)', 290, rowY - 6)
  const level = segmented(vp, P, ui, { x: 290, y: rowY, w: 200, h: rowH }, ['1', '2', '3', '4', '5'], tensionLevel)
  if (level !== tensionLevel) {
    tensionLevel = level
    tensionSlider.value = String(TENSIONS[tensionLevel])
  }
  cap('wrench', 510, rowY - 6)
  if (button(vp, P, ui, { x: 510, y: rowY, w: 130, h: rowH }, wrenchLatched ? 'holding' : 'off', { primary: wrenchLatched })) {
    wrenchLatched = !wrenchLatched
  }

  const rx = LOGICAL_WIDTH - 24 - 560
  panel(vp, P, { x: rx, y: rowY - 26, w: 560, h: rowH + 34 })
  cap('lock', rx + 16, rowY - 6)
  if (button(vp, P, ui, { x: rx + 16, y: rowY, w: 56, h: rowH }, '<')) stepLock(-1)
  if (button(vp, P, ui, { x: rx + 80, y: rowY, w: 56, h: rowH }, '>')) stepLock(1)
  if (button(vp, P, ui, { x: rx + 152, y: rowY, w: 170, h: rowH }, 'new seed')) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    rebuild()
  }
  if (button(vp, P, ui, { x: rx + 336, y: rowY, w: 130, h: rowH }, 'reset')) rebuild()
  label(ctx, `${lockIndex + 1}/${LOCKS.length}`, rx + 480, rowY + 26, {
    font: font(typeFor(vp, TYPE.dimension)),
    size: typeFor(vp, TYPE.dimension),
    color: P.inkLight,
  })
}

function drawReadouts(): void {
  const p = readPick(sol)
  const size = typeFor(vp, TYPE.dimension)
  const y0 = 200
  panel(vp, P, { x: 24, y: y0 - 8, w: 560, h: 88 })
  const cap = (str: string, y: number): void => {
    label(ctx, str, 36, y, { font: font(size), size, color: P.ink })
  }
  cap(`θ ${(plugAngle(sol) / DEG).toFixed(3)}°  torque ${(sol.input.tension * sol.params.maxTorque).toFixed(1)} N·mm  binding ${bindingChamber < 0 ? '—' : bindingChamber + 1}  ${msPerFrame.toFixed(2)} ms/frame`, y0 + 14)
  cap(`pick ${p.force.toFixed(2)} N  bend ${p.bendDeflection.toFixed(2)} mm  below target ${p.tipError.toFixed(2)} mm  tip x ${p.tipX.toFixed(1)}, ${(p.tipY - tipRest(sol)).toFixed(2)} above rest`, y0 + 36)
  cap(readouts.map((r, i) => `${i + 1}:${chamberState(r, sol).slice(0, 4)} ${r.plugForce.toFixed(1)}N`).join(' '), y0 + 58)
}

// ── Frame ────────────────────────────────────────────────────────────────────────────────────

let last = performance.now()
let msPerFrame = 0
let acc = 0
/** The smoothed hand target, in solver millimetres. */
let aimX = 0
let aimY = 0
let aimReady = false
/**
 * The plug angle as drawn: the true angle eased over ~80 ms. A take-up happens in a few
 * milliseconds and reads as a jolt at 36 px/mm; this is a helper for the eye, not the physics —
 * every readout still shows the true θ.
 */
let viewTheta = 0

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  syncViewport(vp)

  const uiKeys = new Set([...keyCodes].filter((k) => k !== 'Space'))
  const uiFrame: UiFrame = { pointerX, pointerY, clicked, keys: uiKeys }
  keyCodes.clear()
  clicked = false

  const fr = frameFor()

  // The pointer aims the tip while it is over the lock. With Shift held the height is frozen so
  // the arrow keys can work it in 0.02 mm steps — a set is a 0.2 mm window.
  //
  // Two helpers stand between the mouse and the hand, because a mouse is not a hand: the target
  // is smoothed over ~60 ms (a hand does not move at 125 Hz, and at 44 px/mm a pixel of tremor
  // is visible), and vertical sensitivity falls as the pick feels load, so the last tenth of a
  // millimetre before a set is not one pixel of mouse travel.
  let tipX = Number(handXSlider.value)
  let tipLift = Number(handYSlider.value)
  if (pointInRect(WORK, pointerX, pointerY)) {
    const mm = mmAtPointer(fr, pointerX, pointerY)
    const load = readPick(sol).force
    const gain = 1 / (1 + 2 * load)
    const alpha = 1 - Math.exp(-dt / 0.06)
    if (!aimReady) {
      aimX = mm.x
      aimY = mm.y
      aimReady = true
    }
    aimX += (mm.x - aimX) * alpha
    if (!shiftHeld) aimY += (mm.y - aimY) * alpha * gain
    tipX = aimX
    handXSlider.value = tipX.toFixed(2)
    if (!shiftHeld) {
      tipLift = Math.min(3.5, aimY - tipRest(sol))
      handYSlider.value = tipLift.toFixed(2)
    }
  } else {
    aimReady = false
  }
  const wrench = pressingWork || wrenchLatched
  const tension = wrench ? Number(tensionSlider.value) : 0
  tensionVal.textContent = tensionSlider.value
  handXVal.textContent = tipX.toFixed(1)
  handYVal.textContent = tipLift.toFixed(2)

  const aim = aimTip(sol, tipX, tipRest(sol) + tipLift)
  const input: SolverInput = { tension, handX: aim.handX, handY: aim.handY, handAngle: aim.handAngle }
  acc += dt
  const steps = Math.min(4, Math.floor(acc / DT))
  acc -= steps * DT
  const t0 = performance.now()
  for (let i = 0; i < steps; i += 1) step(sol, input)
  if (steps > 0) msPerFrame = 0.9 * msPerFrame + 0.1 * ((performance.now() - t0) / steps)
  project()
  viewTheta += (plugAngle(sol) - viewTheta) * (1 - Math.exp(-dt / 0.08))
  sim.theta = viewTheta

  beginFrame(vp, P.letterbox)
  clipToStage(ctx)
  ctx.fillStyle = P.paper
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT)
  drawGrid(vp, 40, P.rule, LOGICAL_WIDTH, LOGICAL_HEIGHT)

  ui.begin(uiFrame)
  drawSolverCutaway(fr)
  drawPick(fr)

  const hud: HudOptions = {
    lockName: `${def.name} — 2.5D solver`,
    elapsed: sol.time,
    showResistance: true,
    showStateWord: true,
    pinDots: 'full',
    showBinding: true,
    depthMm: readPick(sol).tipX,
    keys: [],
    assemblyLeft: fr.sx(0),
    restartHint: 'N',
    tensionHint: 'hold the mouse over the lock; shift + arrows for fine lift',
    par: def.par,
    pressureStep: tensionLevel * 2 + 1,
    strain: { amount: Math.max(0, Math.min(1, (readPick(sol).bendDeflection - 1.2) / 2)), bent: false, broken: false },
  }
  drawHud(vp, P, sim, hud)
  drawControls()
  drawSideView()
  drawReadouts()
  ui.end()

  requestAnimationFrame(frame)
}

// Keep the plug body index referenced for readers of this file: it is what θ is read from.
void BODY_PLUG

/** A dev hook so a script (or the console) can read the solver and steer the side view. */
interface BenchHook {
  readonly theta: () => number
  readonly binding: () => number
  readonly chambers: () => ChamberReadout[]
  readonly states: () => ChamberState[]
  readonly chamberX: (i: number) => number
  readonly pick: () => PickReadout
  readonly showChamber: (i: number) => void
  readonly opened: () => boolean
}
declare global {
  interface Window {
    solverbench?: BenchHook
  }
}
window.solverbench = {
  theta: () => plugAngle(sol),
  binding: () => bindingChamber,
  chambers: () => readouts,
  states: () => readouts.map((r) => chamberState(r, sol)),
  chamberX: (i) => sol.chambers[i]?.x ?? -1,
  pick: () => readPick(sol),
  showChamber: (i) => {
    sideChamber = Math.max(0, Math.min(sol.chambers.length - 1, i))
  },
  opened: () => sim.opened,
}

requestAnimationFrame(frame)
