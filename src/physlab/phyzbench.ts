/**
 * PHYZBENCH — the game's own bench, running on physlab.
 *
 * `physlab.html` draws the lab's teardown: a lab's picture of a lab. This is the other half of the
 * question, and the one the migration actually turns on — **the game's real pick screen**, its
 * cutaway and its HUD, with nothing behind them but the geometric model. Every pin you see is
 * `src/render/cutaway.ts` drawing a `SimState`; that `SimState` is never stepped by `src/sim`. It is
 * a projection of a physlab tick, which is exactly what `adapter.ts` was built to make possible.
 *
 * The pick is the phys tool from `tool.ts` — the same fixed-length strip of steel the teardown
 * draws, placed through the cutaway's own (anisotropic) millimetre mapping rather than redrawn.
 *
 * So the two pages answer two different questions. `physlab.html`: *is the model right?*
 * `phyzbench.html`: *does the game feel right on it?*
 *
 * Dev-only. The build's single input is still `index.html`.
 */

import { drawGrid } from '../render/draw'
import { createFx } from '../render/fx'
import { drawHud, type HudOptions } from '../render/hud'
import {
  assemblyBounds,
  computeLayout,
  mmToY,
  plugChamberX,
  type CutawayLayout,
} from '../render/layout'
import { drawCutaway } from '../render/cutaway'
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
  KEYWAY_FLOOR,
  PERFECT_TOOLS,
  STRAIN_BROKEN as SIM_STRAIN_BROKEN,
  THETA_OPEN as SIM_THETA_OPEN,
  createSimState,
  type LockDef,
  type SimConfig,
  type SimState,
} from '../sim'
import { labFromLock, readView } from './adapter'
import {
  DT,
  FLOOR_Y,
  TOOL_FLOOR,
  PITCH,
  T_FULL_TURN,
  T_SET_HOLD,
  makeHook,
  makeRake,
  step,
  type LabInput,
  type LabState,
} from './model'
import { drawToolShape, toolShape, type ToolFrame } from './tool'

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLCanvasElement)) throw new Error('#stage canvas missing')
const canvas: HTMLCanvasElement = stage
const vp = createViewport(canvas)
const ctx = vp.ctx
const P = DRAFTING
const ui = new Ui()

/**
 * The one number that reconciles the two coordinate systems.
 *
 * Both measure lift in millimetres above their own keyway floor and both put the shear line at zero,
 * so lifts transfer straight across — but the floors themselves sit at different depths (`-5.0` in
 * the game, `-6.0` in the lab). Heights of *bodies* need the difference; lifts do not.
 */
const Y_OFFSET = KEYWAY_FLOOR - FLOOR_Y

const CONFIG: SimConfig = { tools: PERFECT_TOOLS, featherEnabled: true, assist: 'training' }
const LOCKS: LockDef[] = ALL_LOCKS.filter((l) => l.family === 'pin-tumbler')

const params = new URLSearchParams(location.search)
const wanted = params.get('lock')
const startAt = wanted ? LOCKS.findIndex((l) => l.slug === wanted || String(l.id) === wanted) : 0
if (wanted && startAt < 0) throw new Error(`?lock=${wanted} is not a pin-tumbler roster lock`)

const TENSIONS = [0.14, 0.22, 0.3, 0.4, 0.55] as const

let lockIndex = Math.max(0, startAt)
let seed = 0x5ea51e
let toolKind: 'hook' | 'rake' = params.get('tool') === 'rake' ? 'rake' : 'hook'
let tensionLevel = 2
let wrenchLatched = false

let def: LockDef = LOCKS[lockIndex]!
let lab: LabState = labFromLock(def, seed, CONFIG)
let sim: SimState = createSimState(def, seed, CONFIG)
const fx = createFx(def.bitting.length, true)

function rebuild(): void {
  def = LOCKS[lockIndex]!
  lab = labFromLock(def, seed, CONFIG)
  lab.tool = toolKind === 'rake' ? makeRake() : makeHook()
  sim = createSimState(def, seed, CONFIG)
  handLift = restingLift()
}

/**
 * Pour a physlab tick into the game's read model.
 *
 * Everything the cutaway and the HUD read is written here and nowhere else, so what the screen shows
 * is the lab's state and not a second simulation quietly running underneath.
 */
function project(): void {
  const view = readView(lab)
  sim.tension = lab.tension
  sim.tensionCommanded = lab.tension
  sim.theta = lab.theta
  sim.thetaMax = SIM_THETA_OPEN
  sim.thetaDemand = SIM_THETA_OPEN * Math.min(1, lab.tension / T_FULL_TURN)
  sim.bindingChamber = lab.binding
  sim.pickChamber = lab.pickChamber
  sim.pickPosition = lab.pickChamber < 0 ? -1 : lab.tool.x / PITCH
  sim.resistance = lab.resistance
  sim.pickForce = Math.min(1, lab.resistance)
  sim.pickContact = lab.pickChamber < 0 ? 0 : 1
  sim.pickStrain = lab.pickStrain
  sim.pickBent = lab.pickBent
  sim.pickBroken = lab.pickBroken
  sim.opened = lab.opened
  sim.time = lab.time
  sim.engaged = lab.tension > 0
  lab.chambers.forEach((c, i) => {
    const sc = sim.chambers[i]
    if (!sc) return
    sc.lift = c.lift
    sc.keyLift = c.keyLift
    sc.state = view.chambers[i]!.state
  })
}

// ── Mapping keyway millimetres onto the game's cutaway ───────────────────────────────────────

function toolFrameFor(layout: CutawayLayout): ToolFrame {
  const zero = plugChamberX(layout, 0)
  const perMm = (layout.pitch / PITCH) * (layout.mirrored ? -1 : 1)
  return {
    sx: (mm: number): number => zero + mm * perMm,
    sy: (mm: number): number => mmToY(layout, mm + Y_OFFSET),
  }
}

function mmAtPointer(layout: CutawayLayout, px: number, py: number): { x: number; y: number } {
  const zero = plugChamberX(layout, 0)
  const perMm = (layout.pitch / PITCH) * (layout.mirrored ? -1 : 1)
  return {
    x: (px - zero) / perMm,
    y: (layout.shearY - py) / layout.mmToPx - Y_OFFSET,
  }
}

// ── Input ────────────────────────────────────────────────────────────────────────────────────

/** The lock's own drawing area — everything between the header and the footer. */
const WORK: Rect = { x: 0, y: 96, w: LOGICAL_WIDTH, h: LOGICAL_HEIGHT - 96 - 160 }

function crestOf(state: LabState): number {
  return state.tool.teeth.reduce((m, t) => Math.max(m, t.height), 0)
}
function restingLift(): number {
  return Math.max(TOOL_FLOOR, FLOOR_Y - crestOf(lab) - 0.3)
}

let handX = 0
let handLift = restingLift()
let pointerX = -1
let pointerY = -1
let pressingWork = false
let clicked = false
const keyCodes = new Set<string>()

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

/**
 * The wheel is the wrench.
 *
 * Asked for directly, and it is the right control for this screen: the pointer has to stay over the
 * lock to drive the pick, so reaching up to a button strip to change pressure means letting go of the
 * wrench first — which on a lock full of set pins is the one thing you must not do. Scroll up for
 * more, down for less, without moving your hand.
 */
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    const step = e.deltaY < 0 ? 1 : -1
    tensionLevel = Math.max(0, Math.min(TENSIONS.length - 1, tensionLevel + step))
  },
  { passive: false },
)

window.addEventListener('keydown', (e) => {
  keyCodes.add(e.code)
  if (e.key >= '1' && e.key <= '5') tensionLevel = Number(e.key) - 1
  else if (e.key === 'h') toolKind = 'hook'
  else if (e.key === 'r') toolKind = 'rake'
  else if (e.key === 'w') wrenchLatched = !wrenchLatched
  else if (e.key === '[') step_lock(-1)
  else if (e.key === ']') step_lock(1)
  else if (e.key === 'n' || e.key === ' ') {
    e.preventDefault()
    seed = (seed * 1664525 + 1013904223) >>> 0
    rebuild()
  }
})

function step_lock(delta: number): void {
  lockIndex = ((lockIndex + delta) % LOCKS.length + LOCKS.length) % LOCKS.length
  rebuild()
}

// ── The controls, in the band the rank letter leaves empty on both sides ─────────────────────

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
  panel(vp, P, { x: 24, y: rowY - 26, w: 560, h: rowH + 34 })
  cap('tool', 40, rowY - 6)
  const t = segmented(vp, P, ui, { x: 40, y: rowY, w: 150, h: rowH }, ['hook', 'rake'], toolKind === 'rake' ? 1 : 0)
  const nextTool = t === 1 ? 'rake' : 'hook'
  if (nextTool !== toolKind) {
    toolKind = nextTool
    lab.tool = toolKind === 'rake' ? makeRake() : makeHook()
    handLift = restingLift()
  }
  cap(TENSIONS[tensionLevel]! < T_SET_HOLD ? 'pressure — too light to set' : 'pressure — or scroll', 210, rowY - 6)
  tensionLevel = segmented(vp, P, ui, { x: 210, y: rowY, w: 200, h: rowH }, ['1', '2', '3', '4', '5'], tensionLevel)
  cap('wrench', 430, rowY - 6)
  if (button(vp, P, ui, { x: 430, y: rowY, w: 130, h: rowH }, wrenchLatched ? 'holding' : 'off', {
    primary: wrenchLatched,
  })) {
    wrenchLatched = !wrenchLatched
  }

  const rx = LOGICAL_WIDTH - 24 - 560
  panel(vp, P, { x: rx, y: rowY - 26, w: 560, h: rowH + 34 })
  cap('lock', rx + 16, rowY - 6)
  if (button(vp, P, ui, { x: rx + 16, y: rowY, w: 56, h: rowH }, '<')) step_lock(-1)
  if (button(vp, P, ui, { x: rx + 80, y: rowY, w: 56, h: rowH }, '>')) step_lock(1)
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

// ── Frame ────────────────────────────────────────────────────────────────────────────────────

let last = performance.now()

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  syncViewport(vp)

  const uiKeys = new Set([...keyCodes].filter((k) => k !== 'Space'))
  const uiFrame: UiFrame = { pointerX, pointerY, clicked, keys: uiKeys }
  keyCodes.clear()
  clicked = false

  const layout = computeLayout(def.bitting.length, lab.theta, def.rows ?? 1, false)
  if (pointInRect(WORK, pointerX, pointerY)) {
    const mm = mmAtPointer(layout, pointerX, pointerY)
    const crest = crestOf(lab)
    handX = mm.x
    handLift = Math.min(FLOOR_Y + 5 - crest, Math.max(FLOOR_Y - crest - 0.3, mm.y - crest))
  }
  const held = pressingWork || wrenchLatched
  const input: LabInput = {
    toolX: handX,
    toolLift: handLift,
    tension: held ? TENSIONS[tensionLevel]! : 0,
  }
  const steps = Math.max(1, Math.round(dt / DT))
  for (let i = 0; i < steps; i += 1) step(lab, input)
  project()

  beginFrame(vp, P.letterbox)
  clipToStage(ctx)
  ctx.fillStyle = P.paper
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT)
  drawGrid(vp, 40, P.rule, LOGICAL_WIDTH, LOGICAL_HEIGHT)

  ui.begin(uiFrame)
  drawCutaway(vp, P, sim, layout, {
    activeChamber: sim.pickChamber,
    showTargets: true,
    fx,
  })
  // The phys tool, in the game's own drawing. Its shape comes from the model; this is only the
  // mapping that puts a keyway millimetre on the page.
  drawToolShape(ctx, toolShape(lab), P, toolFrameFor(layout))

  const bounds = assemblyBounds(layout)
  const hud: HudOptions = {
    lockName: def.name,
    elapsed: lab.time,
    showResistance: true,
    showStateWord: true,
    pinDots: 'full',
    showBinding: true,
    depthMm: lab.tool.x,
    // The legend lives in the left gutter, where the lab's own control panel now sits. The controls
    // are on the screen as controls; a list of keys naming them again would print straight through.
    keys: [],
    assemblyLeft: bounds.x,
    restartHint: 'N',
    tensionHint: 'hold the mouse over the lock',
    par: def.par,
    pressureStep: tensionLevel * 2 + 1,
    strain: {
      amount: Math.min(1, lab.pickStrain / SIM_STRAIN_BROKEN),
      bent: lab.pickBent,
      broken: lab.pickBroken,
    },
  }
  drawHud(vp, P, sim, hud)
  drawControls()
  ui.end()

  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
