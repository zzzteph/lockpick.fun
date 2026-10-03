/**
 * PHYSLAB — the bench harness. Dev-only; never part of the shipped bundle (the build's single
 * input is `index.html`). Run `npm run dev` and open `/physlab.html`.
 *
 * The lab now wears the game's screen — header, teardown, control shelf, meters (`bench.ts`) — and
 * **every control is on it**. The keys are shortcuts for controls you can see, not the only way in:
 *
 *   mouse in the drawing  — slide the pick along the keyway; the cursor is the tool's cutting edge
 *   hold the button       — tension on the wrench (or latch it on the shelf)
 *   scroll / 1..5         — wrench pressure          h / r  — hook / rake
 *   v                     — teardown / schematic      w      — latch the wrench
 *   a                     — auto hand                 n, space — new seed
 *   [ / ]                 — previous / next lock
 *
 * `?lock=<slug>` opens a real roster lock; `?auto` self-solves; `?tool=rake`; `?debug`.
 */

import { DRAFTING } from '../render/palette'
import {
  beginFrame,
  clientToLogical,
  clipToStage,
  createViewport,
  syncViewport,
} from '../render/viewport'
import { Ui, pointInRect, type UiFrame } from '../ui/widgets'
import { ALL_LOCKS } from '../game/locks'
import { PERFECT_TOOLS, type LockDef, type SimConfig } from '../sim'
import { labFromLock } from './adapter'
import { BENCH, TENSIONS, drawBench, type LabControls, type LabSource } from './bench'
import {
  createLab,
  DT,
  FLOOR_Y,
  TOOL_FLOOR,
  PITCH,
  makeHook,
  makeRake,
  setLift,
  step,
  type LabInput,
  type LabState,
  type ProfileKind,
} from './model'
import { renderLab } from './render'
import { mmAt, renderView, viewFrame } from './view'

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLCanvasElement)) throw new Error('#stage canvas missing')
const canvas: HTMLCanvasElement = stage
const vp = createViewport(canvas)
const ctx = vp.ctx
const P = DRAFTING
const ui = new Ui()

// ── What the lab can be pointed at ───────────────────────────────────────────────────────────
//
// The demo pin sets, then every pin-tumbler lock in the game — walked with the shelf's < > and
// with `[` / `]`. The seven locks `solveLab` cannot open are in here by name, which is the whole
// point of the roster strip: they are meant to be picked by hand.

const KINDS: readonly (readonly ProfileKind[])[] = [
  ['standard', 'spool', 'serrated', 'mushroom', 'standard'],
  ['standard', 'standard', 'spool', 'standard', 'serrated'],
  ['mushroom', 'mushroom', 'spool', 'standard'],
  ['serrated', 'spool', 'standard', 'mushroom', 'serrated', 'standard'],
]

interface Source extends LabSource {
  readonly kinds?: readonly ProfileKind[]
  readonly lock?: LockDef
}

const SOURCES: Source[] = [
  ...KINDS.map((kinds, i) => ({
    key: `demo-${i + 1}`,
    name: `demo set ${i + 1}`,
    detail: kinds.join(' '),
    tier: null,
    kinds,
  })),
  ...ALL_LOCKS.filter((l) => l.family === 'pin-tumbler').map((l) => ({
    key: l.slug,
    name: l.name,
    detail: l.pins.join(' '),
    tier: l.tier,
    lock: l,
  })),
]

const params = new URLSearchParams(location.search)
const CONFIG: SimConfig = { tools: PERFECT_TOOLS, featherEnabled: true, assist: 'training' }

const lockSlug = params.get('lock')
const wanted = lockSlug ? SOURCES.findIndex((s) => s.key === lockSlug) : -1
if (lockSlug && wanted < 0) throw new Error(`?lock=${lockSlug} is not in the roster`)

const ctl: LabControls = {
  toolKind: params.get('tool') === 'rake' ? 'rake' : 'hook',
  tensionLevel: 2,
  wrenchLatched: false,
  viewMode: params.has('debug') ? 'debug' : 'view',
  auto: params.has('auto'),
  sourceIndex: wanted >= 0 ? wanted : 0,
  newSeed: false,
  reset: false,
  sourceDelta: 0,
}

let seed = 0x5ea51e

function buildLab(): LabState {
  const src = SOURCES[ctl.sourceIndex]!
  const lab = src.lock
    ? labFromLock(src.lock, seed, CONFIG)
    : createLab({ kinds: [...src.kinds!], seed, tool: ctl.toolKind })
  lab.tool = ctl.toolKind === 'rake' ? makeRake() : makeHook()
  return lab
}

let lab = buildLab()

/** How far the tool's highest tooth stands above its shaft — the cursor is the cutting edge. */
function crestOf(state: LabState): number {
  return state.tool.teeth.reduce((m, t) => Math.max(m, t.height), 0)
}

/**
 * The range the hand may hold the tool's shaft in, mm.
 *
 * Bounded at both ends because the mouse is not: the cursor commands the tool's **cutting edge**, so
 * a pointer at the top of the page asked for a shaft angle a strip of steel in a keyway cannot take
 * — the tool came out of the lock and stood up at forty degrees. The floor rests the blade in the
 * bottom of the slot with the edge just under the pins; the ceiling is a millimetre past the deepest
 * lift any lock in the roster asks for.
 */
function liftRange(state: LabState): { lo: number; hi: number } {
  const crest = crestOf(state)
  return { lo: Math.max(TOOL_FLOOR, FLOOR_Y - crest - 0.3), hi: FLOOR_Y + 5 - crest }
}

// The hand: where it is holding the tool, in keyway mm. Starts with the pick lying in the bottom of
// the keyway, touching nothing — which is where a pick rests before you lift anything.
let handX = 0
let handLift = liftRange(lab).lo

// ── Input ────────────────────────────────────────────────────────────────────────────────────

let pointerX = -1
let pointerY = -1
/** True while a press that *began inside the drawing* is held — that is the wrench. */
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
  if (pointInRect(BENCH.drawing, pt.x, pt.y)) pressingWork = true
})
window.addEventListener('pointerup', () => {
  clicked = true
  pressingWork = false
})
window.addEventListener('pointercancel', () => {
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
    ctl.tensionLevel = Math.max(0, Math.min(TENSIONS.length - 1, ctl.tensionLevel + step))
  },
  { passive: false },
)


window.addEventListener('keydown', (e) => {
  keyCodes.add(e.code)
  if (e.key >= '1' && e.key <= '5') ctl.tensionLevel = Number(e.key) - 1
  else if (e.key === 'h') ctl.toolKind = 'hook'
  else if (e.key === 'r') ctl.toolKind = 'rake'
  else if (e.key === 'v') ctl.viewMode = ctl.viewMode === 'view' ? 'debug' : 'view'
  else if (e.key === 'w') ctl.wrenchLatched = !ctl.wrenchLatched
  else if (e.key === 'a') ctl.auto = !ctl.auto
  else if (e.key === 'n' || e.key === 'k') ctl.newSeed = true
  else if (e.key === '[') ctl.sourceDelta -= 1
  else if (e.key === ']') ctl.sourceDelta += 1
  else if (e.key === ' ') {
    e.preventDefault()
    ctl.newSeed = true
  }
})

// ── The self-driving hand (`?auto`, or the shelf's AUTO) ─────────────────────────────────────

let easeUntil = 0
let scrubPhase = 0
let restartScheduled = false

/** Hook lift that puts the crest under a chamber at the height needed to reach `targetLift`. */
function hookLiftFor(targetLift: number): number {
  return FLOOR_Y + targetLift - 2.3
}

/** Drive the current lock automatically: work the binding pin; ease the wrench when it jams. */
function autoInput(now: number): LabInput {
  if (lab.tool.kind === 'rake') {
    scrubPhase += 0.02
    const span = (lab.chambers.length + 1) * PITCH
    return {
      toolX: ((Math.sin(scrubPhase) + 1) / 2) * span - PITCH,
      toolLift: FLOOR_Y + 1.7 + 0.9 * Math.sin(scrubPhase * 2.3),
      tension: 0.24,
    }
  }
  // Work the pins in a *stable* order — tightest clearance first — and commit to one until it is
  // caught. Chasing the live `binding` index instead makes the hand flip-flop, because a serrated
  // or spool pin dips below the standards' bind angle every time its waist crosses the line.
  const uncaught = lab.chambers.filter((c) => !c.caught)
  if (uncaught.length === 0) return { toolX: 0, toolLift: FLOOR_Y, tension: 0.3 }
  const c = uncaught.reduce((a, b) => (b.def.clearance < a.def.clearance ? b : a))
  const walled = c.counterForce > 0.02 // a spool foot walling the climb
  if (walled) easeUntil = now + 450 // ease so the plug rolls back and the wall lifts
  const easing = now < easeUntil
  const aim = Math.min(setLift(c) + 0.2, c.lift + 0.3) // push firmly into the set window
  return { toolX: c.def.boreX, toolLift: hookLiftFor(aim), tension: easing ? 0.12 : 0.32 }
}

// ── Control requests raised by the shelf (or the keys) ───────────────────────────────────────

function applyControls(): void {
  if (ctl.toolKind !== lab.tool.kind) {
    lab.tool = ctl.toolKind === 'rake' ? makeRake() : makeHook()
    handLift = Math.min(liftRange(lab).hi, Math.max(liftRange(lab).lo, handLift))
  }
  let rebuild = false
  if (ctl.sourceDelta !== 0) {
    const n = SOURCES.length
    ctl.sourceIndex = (((ctl.sourceIndex + ctl.sourceDelta) % n) + n) % n
    ctl.sourceDelta = 0
    rebuild = true
  }
  if (ctl.newSeed) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    ctl.newSeed = false
    rebuild = true
  }
  if (ctl.reset) {
    ctl.reset = false
    rebuild = true
  }
  if (rebuild) lab = buildLab()
}

// ── Frame ────────────────────────────────────────────────────────────────────────────────────

let last = performance.now()

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  syncViewport(vp)

  // Space is the harness's "new seed", so it never reaches the widget layer as an activate key.
  const uiKeys = new Set([...keyCodes].filter((k) => k !== 'Space'))
  const uiFrame: UiFrame = { pointerX, pointerY, clicked, keys: uiKeys }
  keyCodes.clear()
  clicked = false

  // The hand only drives the tool while the pointer is over the workpiece — a trip to the shelf
  // must not drag the pick across the lock on the way.
  const f = viewFrame(lab, BENCH.drawing, P)
  if (!ctl.auto && pointInRect(BENCH.drawing, pointerX, pointerY)) {
    const mm = mmAt(f, pointerX, pointerY)
    const { lo, hi } = liftRange(lab)
    handX = mm.x
    handLift = Math.min(hi, Math.max(lo, mm.y - crestOf(lab)))
  }
  const held = pressingWork || ctl.wrenchLatched
  const input: LabInput = ctl.auto
    ? autoInput(now)
    : { toolX: handX, toolLift: handLift, tension: held ? TENSIONS[ctl.tensionLevel]! : 0 }

  // In demo mode, start over a moment after it opens (or snaps the pick), so it loops.
  if (ctl.auto && (lab.opened || lab.pickBroken) && !restartScheduled) {
    restartScheduled = true
    window.setTimeout(() => {
      ctl.newSeed = true
      restartScheduled = false
    }, 900)
  }

  const steps = Math.max(1, Math.round(dt / DT))
  for (let i = 0; i < steps; i += 1) step(lab, input)

  beginFrame(vp, P.letterbox)
  clipToStage(ctx)
  ui.begin(uiFrame)
  drawBench(vp, P, ui, lab, ctl, SOURCES[ctl.sourceIndex]!, SOURCES, () => {
    if (ctl.viewMode === 'view') {
      renderView(ctx, lab, BENCH.drawing, P)
    } else {
      const r = BENCH.drawing
      ctx.save()
      ctx.beginPath()
      ctx.rect(r.x, r.y, r.w, r.h)
      ctx.clip()
      ctx.translate(r.x, r.y)
      renderLab(ctx, lab, r.w, r.h)
      ctx.restore()
    }
  })
  ui.end()

  applyControls()
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
