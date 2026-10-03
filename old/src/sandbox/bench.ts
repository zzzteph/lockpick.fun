/**
 * The bench — the game's screen, running on the 2.5D contact solver (`src/solver/`), with a
 * side view and a FACE-ON view drawn from the solver's own bodies (`sideview.ts`,
 * `frontview.ts`). Dev-only; the build's single input is still `index.html`.
 *
 * Experiment 3 (2026-09-13): the game's 1-D rate sim is gone from under this bench. In a false
 * set the plug has really turned, so the other straddling pins are really pinched and cannot be
 * set; a pin's cant is bounded by real bore walls; the pick is a rigid polygon that presses a
 * pin wherever it meets it. See `engine.ts`.
 *
 * ── Controls (experiment 1) ──
 *
 * The pick moves **freely** along the keyway under the mouse: its position is a continuous number
 * of chambers from pin 1. Any mouse button held over the lock is the wrench; the RIGHT button
 * pressed on top of it counter-rotates — the plug walks back slowly while it is held, and the
 * wrench takes over again when it is let go (the spool technique). ← / → snap the tip to the
 * next pin in that direction (and the mouse takes over again once it moves). Space is the only
 * thing that pushes — a held ramp, released = the pin comes back on its spring — so the mouse's
 * height does nothing.
 */

import { drawGrid } from '../render/draw'
import { drawHud, drawOpenBanner, type HudOptions } from '../render/hud'
import type { Rect } from '../render/layout'
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
import { Ui, button, panel, pointInRect, segmented, type UiFrame } from '../ui/widgets'
import { KEY_LIFT_RATE } from '../ui/input'
import { ALL_LOCKS } from '../game/locks'
import { STARTER_TOOLS, THETA_OPEN, makeConfig, type LockDef, type SimConfig } from '../sim'
import { createEngine, type Engine } from '../physics/engine'
import { drawFrontView } from '../render/frontview'
import { atForX, drawSideView, sideFrame, tipXForAt } from '../render/sideview'

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLCanvasElement)) throw new Error('#stage missing')
const canvas = stage
const vp = createViewport(canvas)
const ctx = vp.ctx
const P = DRAFTING
const ui = new Ui()

const CONFIG: SimConfig = makeConfig({ tools: STARTER_TOOLS, featherEnabled: true, assist: 'training' })
const LOCKS: LockDef[] = ALL_LOCKS.filter((l) => l.family === 'pin-tumbler')
/**
 * Wrench, as a fraction of the solver's 60 N·mm: 6 to 20 N·mm, step 2 (8 N·mm) the default. Step 1
 * is the lightest that still carries the plug past two set pins to the next bind (4.8 N·mm did not).
 * Lighter than the first cut (6–30): the pinch a push has to lift scales with the wrench, and at
 * 7 N·mm the whole spool trainer walks in one push per pin (owner: "right now I need to
 * push-push-push — before that I need less strength").
 */
const TENSIONS = [0.1, 0.13, 0.18, 0.25, 0.34] as const
/** The most the hand asks the tip to rise, mm — a blade must still pass under the keyway roof. */
const LIFT_CEILING = 3.5
/**
 * Where the tip stops counting as "under pin 1" on the way out, in chambers from pin 1's centre.
 * Past this the pick is out of the lock and not drawn.
 */
const OUT_AT = -0.5
/**
 * How far the mouse must move after an arrow snap before it takes the pick back. A snap parks the
 * tip on a pin the mouse is not over; without a dead zone a one-pixel wobble would yank it away.
 */
const RETAKE_PX = 8
/** Keys the pick owns outright. */
const PICK_KEYS = new Set(['Space', 'ArrowLeft', 'ArrowRight'])

const params = new URLSearchParams(location.search)
const wanted = params.get('lock') ?? 'ironhold-spool-trainer'
const startAt = Math.max(0, LOCKS.findIndex((l) => l.slug === wanted))

let lockIndex = startAt
let seed = 1
let tensionLevel = 1
let wrenchLatched = false
let def: LockDef = LOCKS[lockIndex]!
let eng: Engine = createEngine(def, seed, CONFIG)

function rebuild(): void {
  def = LOCKS[lockIndex]!
  eng = createEngine(def, seed, CONFIG)
  lastChamber = -1
  keyLift = 0
  frontChamber = 0
  tipXCmd = -3
  opened = false
  openTheta = -1
}

const WORK: Rect = { x: 0, y: 160, w: LOGICAL_WIDTH, h: LOGICAL_HEIGHT - 160 - 160 }
/** The pressure panel sits inside the work area, right of the shell; reaching for it must not move the pick. */
const PANEL_PRESSURE: Rect = { x: LOGICAL_WIDTH - 24 - 430, y: 330, w: 430, h: 74 }
function overLock(x: number, y: number): boolean {
  return pointInRect(WORK, x, y) && !pointInRect(PANEL_PRESSURE, x, y)
}

let pointerX = -1
let pointerY = -1
/** The last x the mouse aimed from inside the work area — the pick follows this, not the panels. */
let aimX = -1
/** True while the mouse owns the pick's position; an arrow snap takes it until the mouse moves. */
let mouseDrives = true
let snapPointerX = 0
let pressingWork = false
/** The right mouse button held on top of the wrench: counter-rotation (see `COUNTER_RATE`). */
let counterHeld = false
/**
 * How fast the plug walks back while the right button is held on top of the wrench, rad/s —
 * "very slowly": 1.5° a second, 0.17 mm at the rim. The wrench stays on and the plug follows a
 * receding stop; let go of the right button and the wrench takes the plug forward again to
 * whatever holds it.
 */
const COUNTER_RATE = 0.3 * (Math.PI / 180)
let clicked = false
let spaceHeld = false
/** The pick gun: a keypress queues one strike, fired on the next frame (see `Engine.strike`). */
let strikePending = false
const keyCodes = new Set<string>()

// ── Pick state ──
/** Where the tip is along the keyway, in chambers from pin 1. Fractional means between pins. */
let pickAt = 0
/** The held lift, mm: Space ramps it up, and it falls back when Space is released. */
let keyLift = 0
/**
 * True from the moment the pin under the tip SETS until Space is released: the hand felt the click
 * and stops pushing. Without it a held key carries the key pin on into the shell's chamfer, which
 * cams the plug back and undoes the set it just made, a timing test no rate control can pass.
 * It holds for `CLICK_PAUSE`; Space still down after that pushes on (overset).
 */
let liftLatched = false
let wasSet = false
/**
 * How long the click holds the hand, s. The latch used to be for good ("let go and push again"),
 * and a binding pin could not be overset at all: the plug moves on at the click, and a second
 * push met a housing bore already offset by a pin's play. Now the click is a pause: Space still
 * held after it pushes on, the key pin wedges in the housing's mouth and the pin reads OVERSET
 * (owner: "I cannot overset the binding pins — only the free ones, a bit"). Let go and it drops.
 */
const CLICK_PAUSE = 0.35
let liftPause = 0
/**
 * How much the hand relaxes at the click, mm of asked lift. Zero: the lift latches at the click
 * and holds. A relax of 0.15 was tried so the key pin's top would not follow the driver up; it
 * dropped the just-set driver onto the plug's rim corner while the plug was still moving and
 * wedged it there (every standard lock stalled 0.4° short of open with every pin set), and the
 * overset rule (`OVER_PUSH`) makes room for the pop's overshoot instead. Let go of Space and the
 * driver settles on its ledge.
 */
const CLICK_RELAX = 0
/** Nearest chamber last frame, so arriving under a new pin can drop the lift (D-051). */
let lastChamber = -1
/** The pin the front view shows: the one under the tip, kept while the pick is out. */
let frontChamber = 0
/**
 * True once the plug has turned past the open angle. The solver then stops: with every driver
 * set and sliding on the rim at 25°+, the plug's friction against their corners makes it swing
 * between two angles for as long as the wrench is held (measured: 25°–27°, 55 reversals in 3 s
 * — the owner's "when you lift all the pins the plug turns and starts to tremble"). An open lock
 * has nothing left to simulate; it is held where it opened until R or N.
 */
let opened = false
/**
 * The open turn, DRAWN: the solver stops the moment the free plug has left the last pin (a few
 * degrees; past that the keyway and the pick would not turn with it), and the bench turns the
 * drawn plug on from there to the game's open angle (owner: "you see the OPEN immediately —
 * before that there was an animation of rotation"). Radians; -1 until the lock opens.
 */
let openTheta = -1
const OPEN_SHOW_THETA = 0.75 * THETA_OPEN
/** How fast the drawn open turn runs, rad/s: 45° a second, half a second to the banner's angle. */
const OPEN_TURN_RATE = 45 * (Math.PI / 180)
/**
 * The tip's commanded x, slid toward where the hand wants it at `TIP_SLEW` mm/s. An arrow snap
 * moves the want by a whole pitch in one frame; handing that to the hand spring as a step rams
 * the hook into the next pin's cone at full force. A hand slides.
 */
let tipXCmd = -3
const TIP_SLEW = 60

canvas.addEventListener('pointermove', (e) => {
  const pt = clientToLogical(vp, e.clientX, e.clientY)
  pointerX = pt.x
  pointerY = pt.y
  // A second button pressed while the first is held arrives here, not as a pointerdown.
  counterHeld = pressingWork && (e.buttons & 2) !== 0
  if (!overLock(pt.x, pt.y)) return
  if (!mouseDrives && Math.abs(pt.x - snapPointerX) < RETAKE_PX) return
  mouseDrives = true
  aimX = pt.x
})
canvas.addEventListener('pointerdown', (e) => {
  const pt = clientToLogical(vp, e.clientX, e.clientY)
  pointerX = pt.x
  pointerY = pt.y
  // Any button, held over the lock, is the wrench; the right button on top of it counter-rotates.
  if (overLock(pt.x, pt.y)) pressingWork = true
  counterHeld = pressingWork && (e.buttons & 2) !== 0
})
window.addEventListener('pointerup', (e) => {
  clicked = true
  // Letting go of the right button alone keeps the wrench (the left is still down).
  pressingWork = pressingWork && e.buttons !== 0
  counterHeld = pressingWork && (e.buttons & 2) !== 0
})
window.addEventListener('blur', () => {
  pressingWork = false
  counterHeld = false
  spaceHeld = false
})
canvas.addEventListener('contextmenu', (e) => e.preventDefault())
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    tensionLevel = Math.max(0, Math.min(TENSIONS.length - 1, tensionLevel + (e.deltaY < 0 ? 1 : -1)))
  },
  { passive: false },
)
window.addEventListener('keydown', (e) => {
  keyCodes.add(e.code)
  if (e.code === 'ArrowLeft') {
    e.preventDefault()
    if (!e.repeat) snapPick(-1)
  } else if (e.code === 'ArrowRight') {
    e.preventDefault()
    if (!e.repeat) snapPick(1)
  } else if (e.code === 'Space') {
    e.preventDefault()
    if (!e.repeat) {
      liftLatched = false
      // A push goes under the nearest pin: within 1.5 mm of a centre the tip snaps to it, because a
      // hook on a cone's slope lifts nothing useful and the eye cannot judge a millimetre.
      const nearest = Math.round(pickAt)
      if (nearest >= 0 && nearest <= eng.sol.chambers.length - 1 && Math.abs(pickAt - nearest) * eng.sol.params.pitch <= 1.5 && pickAt !== nearest) {
        pickAt = nearest
        mouseDrives = false
        snapPointerX = pointerX
      }
    }
    spaceHeld = true
  } else if (e.key >= '1' && e.key <= '5') tensionLevel = Number(e.key) - 1
  else if (e.key === 'g') {
    // The pick gun: strike the pins so they jump. Held light on the wrench, a few bumps pop it.
    if (!e.repeat) strikePending = true
  } else if (e.key === 'w') wrenchLatched = !wrenchLatched
  else if (e.key === '[') stepLock(-1)
  else if (e.key === ']') stepLock(1)
  else if (e.key === 'r') rebuild()
  else if (e.key === 'n') {
    seed = (seed * 1664525 + 1013904223) >>> 0
    rebuild()
  }
})
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceHeld = false
})

function stepLock(delta: number): void {
  lockIndex = (((lockIndex + delta) % LOCKS.length) + LOCKS.length) % LOCKS.length
  rebuild()
}

/**
 * Snap the tip to the next pin in a direction — from wherever it is, including between pins.
 *
 * → from 1.3 goes to pin 3 (index 2); ← from 1.3 goes to pin 2. Sitting exactly on a pin, either
 * arrow moves one whole pin. Both ends are walls: ← at pin 1 stays, → at the last pin stays, and
 * a withdrawn tool re-enters at pin 1 on →. The mouse gets the pick back once it moves.
 */
function snapPick(dir: -1 | 1): void {
  const limit = eng.sol.chambers.length - 1
  let next: number
  if (dir > 0) {
    next = Math.min(limit, Math.max(0, Math.floor(pickAt + 1e-6) + 1))
  } else {
    if (pickAt <= 0) return
    next = Math.max(0, Math.ceil(pickAt - 1e-6) - 1)
  }
  pickAt = next
  mouseDrives = false
  snapPointerX = pointerX
}

function drawControls(): void {
  const rowY = 108
  const rowH = 40
  const cap = (str: string, x: number, y: number): void => {
    label(ctx, str, x, y, { font: font(typeFor(vp, TYPE.dimension)), size: typeFor(vp, TYPE.dimension), color: P.inkLight })
  }
  // In the right gutter, between the pin-stack key and the force meters. The left gutter is the front view's.
  const leftY = PANEL_PRESSURE.y + 26
  const lx = PANEL_PRESSURE.x + 16
  panel(vp, P, PANEL_PRESSURE)
  cap('pressure (scroll)', lx, leftY - 6)
  tensionLevel = segmented(vp, P, ui, { x: lx, y: leftY, w: 200, h: rowH }, ['1', '2', '3', '4', '5'], tensionLevel)
  cap('wrench', lx + 220, leftY - 6)
  if (button(vp, P, ui, { x: lx + 220, y: leftY, w: 130, h: rowH }, wrenchLatched ? 'holding' : 'off', { primary: wrenchLatched })) {
    wrenchLatched = !wrenchLatched
  }
  const rx = LOGICAL_WIDTH - 24 - 520
  panel(vp, P, { x: rx, y: rowY - 26, w: 520, h: rowH + 34 })
  cap('lock', rx + 16, rowY - 6)
  if (button(vp, P, ui, { x: rx + 16, y: rowY, w: 56, h: rowH }, '<')) stepLock(-1)
  if (button(vp, P, ui, { x: rx + 80, y: rowY, w: 56, h: rowH }, '>')) stepLock(1)
  if (button(vp, P, ui, { x: rx + 152, y: rowY, w: 150, h: rowH }, 'new seed')) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    rebuild()
  }
  if (button(vp, P, ui, { x: rx + 320, y: rowY, w: 120, h: rowH }, 'reset')) rebuild()
  label(ctx, `${lockIndex + 1}/${LOCKS.length}`, rx + 456, rowY + 26, {
    font: font(typeFor(vp, TYPE.dimension)),
    size: typeFor(vp, TYPE.dimension),
    color: P.inkLight,
  })
}

let last = performance.now()

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  syncViewport(vp)

  // The pick's keys never reach the widgets: Space would activate a focused button, and the arrows
  // would walk the focus ring across the panel with every snap.
  const uiFrame: UiFrame = { pointerX, pointerY, clicked, keys: new Set([...keyCodes].filter((k) => !PICK_KEYS.has(k))) }
  keyCodes.clear()
  clicked = false

  const side = sideFrame(eng)

  // ── Where the tip is ──
  if (mouseDrives && aimX >= 0) pickAt = atForX(eng, side, aimX)
  const limit = eng.sol.chambers.length - 1
  if (pickAt > limit) pickAt = limit
  const chamber = pickAt >= OUT_AT ? Math.max(0, Math.round(pickAt)) : -1
  // Arriving under a new pin drops the tip — unless Space is carrying it (D-051, D-139).
  if (chamber !== lastChamber) {
    if (!spaceHeld) keyLift = 0
    lastChamber = chamber
  }
  if (chamber >= 0) frontChamber = chamber

  // ── The push: Space only. Full rate in the clear, slower the harder the pick is pressing — so
  // the last few tenths before a set are a creep you can stop, not a jump you cannot (the
  // solverbench's load-scaled sensitivity, on a rate control) ──
  const rate = KEY_LIFT_RATE / (1 + 0.6 * eng.pick().force)
  const isSet = chamber >= 0 && eng.stateOf(chamber) === 'SET'
  if (isSet && !wasSet && spaceHeld && !liftLatched) {
    liftLatched = true
    liftPause = CLICK_PAUSE
  }
  // The click is a one-frame flag; the SET read that latches the lift usually lands in the same
  // frame, so the relax must not wait on the latch being new.
  if (eng.clickedNow && spaceHeld) {
    liftLatched = true
    liftPause = CLICK_PAUSE
    keyLift = Math.max(0, keyLift - CLICK_RELAX)
  }
  wasSet = isSet
  if (spaceHeld) {
    if (liftLatched) {
      liftPause -= dt
      if (liftPause <= 0) liftLatched = false
    }
    if (!liftLatched) keyLift = Math.min(LIFT_CEILING, keyLift + rate * dt)
  } else keyLift = Math.max(0, keyLift - KEY_LIFT_RATE * 1.6 * dt)

  // ── The solver: aim the tip, hold the wrench, advance ──
  const held = pressingWork || wrenchLatched
  const tension = held ? TENSIONS[tensionLevel]! : 0
  const rest = eng.tipRest()
  // Out of the lock the tip is asked to sit in front of the mouth, level, on the keyway's floor.
  const tipWant = chamber >= 0 ? tipXForAt(eng, Math.max(0, pickAt)) : -3
  const slew = TIP_SLEW * dt
  tipXCmd += Math.max(-slew, Math.min(slew, tipWant - tipXCmd))
  const tipY = chamber >= 0 ? rest + keyLift : rest
  if (!opened) {
    if (strikePending) {
      eng.strike()
      strikePending = false
    }
    eng.drive(tipXCmd, tipY, tension, dt, held && counterHeld ? COUNTER_RATE : 0)
    if (eng.sim.opened) opened = true
  }
  if (opened) {
    if (openTheta < 0) openTheta = eng.theta()
    openTheta = Math.min(OPEN_SHOW_THETA, openTheta + OPEN_TURN_RATE * dt)
    eng.sim.theta = openTheta
  }

  beginFrame(vp, P.letterbox)
  clipToStage(ctx)
  ctx.fillStyle = P.paper
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT)
  drawGrid(vp, 40, P.rule, LOGICAL_WIDTH, LOGICAL_HEIGHT)

  ui.begin(uiFrame)
  drawSideView(vp, P, eng, side)

  // ── The front view: the current pin's chamber seen from the face ──
  // The whole gutter left of the side view, from under the key legend to the footer.
  drawFrontView(
    vp,
    P,
    eng,
    frontChamber,
    {
      // Under the key legend's six rows (the right-click line made it six).
      x: 24,
      y: 362,
      w: side.x0 - 44,
      h: 548,
    },
    opened ? openTheta : eng.theta(),
  )

  const pick = eng.pick()
  const hud: HudOptions = {
    lockName: `${def.name} — 2.5D solver`,
    elapsed: eng.sol.time,
    showResistance: true,
    showStateWord: true,
    pinDots: 'full',
    showBinding: true,
    depthMm: keyLift,
    keys: [
      ['mouse', 'move the pick'],
      ['click', 'hold = wrench'],
      ['r-click', 'hold too = counter-rotate'],
      ['← →', 'snap to a pin'],
      ['space', 'push up'],
      ['g', 'strike (gun)'],
      ['scroll', 'pressure'],
    ],
    assemblyLeft: side.x0,
    plugOpen: eng.openAngle(),
    restartHint: 'N',
    tensionHint: 'hold a mouse button over the lock',
    par: def.par,
    pressureStep: tensionLevel * 2 + 1,
    strain: { amount: Math.max(0, Math.min(1, (pick.bendDeflection - 1.2) / 2)), bent: false, broken: false },
  }
  drawHud(vp, P, eng.sim, hud)
  if (opened) drawOpenBanner(vp, P, eng.sol.time)
  drawControls()
  ui.end()

  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)

// Read-only peeks for the screenshot drive: where the tip is, and what the solver says.
Object.assign(window, {
  sandboxPickAt: (): number => pickAt,
  sandboxStates: (): string[] => eng.sol.chambers.map((_, i) => eng.stateOf(i)),
  sandboxTheta: (): number => (opened ? openTheta : eng.theta()),
  sandboxLift: (): number => keyLift,
  sandboxReadout: (i: number): unknown => ({ ...eng.readouts[i], tip: eng.pick(), tipRest: eng.tipRest(), chamberX: eng.sol.chambers[i]?.x }),
})
