/**
 * PHYSLAB — the bench.
 *
 * The lab wearing the game's screen: the same 1920x1080 letterboxed stage, the same drafting
 * palette, the same immediate-mode widgets the shell is built from (`src/ui/widgets`). A header
 * naming the lock with its clock and pin dots, the teardown in the middle, a shelf of controls, and
 * the footer meters that carry what a hand needs mid-pick — tension, resistance, and the strain the
 * pick is taking.
 *
 * **Every control is on the screen.** The harness used to be a bare canvas driven by remembered
 * keystrokes; the keys still work, but nothing is now reachable only by knowing about it.
 *
 * Dev-only, like the rest of `src/physlab` — the build's single input is still `index.html`.
 */

import { label, text } from '../render/draw'
import { STROKE, TYPE, alpha, font, readableAccents, stateColor, type Palette } from '../render/palette'
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, typeFor, type Viewport } from '../render/viewport'
import { button, panel, segmented, type Rect, type Ui } from '../ui/widgets'
import { STRAIN_BENT, STRAIN_BROKEN, THETA_OPEN, T_SET_HOLD, type LabState } from './model'

/** The five wrench pressures the shelf offers, light to heavy. */
export const TENSIONS = [0.14, 0.22, 0.3, 0.4, 0.55] as const

const MARGIN = 24
const HEADER_H = 64
const SHELF_H = 134
const FOOTER_H = 124
const GAP = 12
const BAR_H = 30

/** One entry the lock selector can walk to: a roster lock, or one of the demo pin sets. */
export interface LabSource {
  readonly key: string
  readonly name: string
  /** Pin types along the lock, as a line of text. */
  readonly detail: string
  readonly tier: number | null
}

/** Everything the shelf lets a hand change. The harness owns it; the widgets write to it. */
export interface LabControls {
  toolKind: 'hook' | 'rake'
  /** Index into `TENSIONS`. */
  tensionLevel: number
  /** Wrench latched on, for a hand that is busy driving the pick. */
  wrenchLatched: boolean
  viewMode: 'view' | 'debug'
  auto: boolean
  sourceIndex: number
  // ── one-shot requests, read and cleared by the harness each frame ──
  newSeed: boolean
  reset: boolean
  sourceDelta: number
}

export interface BenchLayout {
  readonly header: Rect
  readonly drawing: Rect
  readonly shelf: Rect
  readonly footer: Rect
}

export const BENCH: BenchLayout = (() => {
  const w = LOGICAL_WIDTH - MARGIN * 2
  const header = { x: MARGIN, y: MARGIN, w, h: HEADER_H }
  const footer = { x: MARGIN, y: LOGICAL_HEIGHT - MARGIN - FOOTER_H, w, h: FOOTER_H }
  const shelf = { x: MARGIN, y: footer.y - GAP - SHELF_H, w, h: SHELF_H }
  const top = header.y + header.h + GAP
  return { header, drawing: { x: MARGIN, y: top, w, h: shelf.y - GAP - top }, shelf, footer }
})()

function formatClock(seconds: number): string {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}:${r.toFixed(1).padStart(4, '0')}`
}

/** A labelled horizontal meter, filled in ten segments so it reads as instrumentation. */
function meter(
  vp: Viewport,
  p: Palette,
  x: number,
  y: number,
  w: number,
  value: number,
  colour: string,
  segments = 10,
  height = BAR_H,
): void {
  const { ctx } = vp
  const gap = 4
  const segW = (w - gap * (segments - 1)) / segments
  const filled = Math.round(Math.max(0, Math.min(1, value)) * segments)
  for (let i = 0; i < segments; i += 1) {
    const sx = x + i * (segW + gap)
    ctx.fillStyle = i < filled ? colour : alpha(p.rule, 0.55)
    ctx.fillRect(sx, y, segW, height)
    ctx.strokeStyle = p.inkLight
    ctx.lineWidth = STROKE.hairline
    ctx.strokeRect(sx + 0.5, y + 0.5, segW - 1, height - 1)
  }
}

/** Header: what lock this is, how long it has been open on the bench, and where the pins stand. */
function drawHeader(vp: Viewport, p: Palette, state: LabState, src: LabSource): void {
  const { ctx } = vp
  const ts = (size: number): number => typeFor(vp, size)
  const r = BENCH.header
  panel(vp, p, r)
  const mid = r.y + r.h / 2 + 5

  label(ctx, 'physlab', r.x + 24, mid, {
    font: font(ts(TYPE.body)),
    size: ts(TYPE.body),
    color: p.inkLight,
  })
  label(ctx, src.name, LOGICAL_WIDTH / 2, mid, {
    font: font(ts(TYPE.heading), 'bold'),
    size: ts(TYPE.heading),
    color: p.ink,
    align: 'center',
  })

  // Pin dots — filled for set, ringed for the rest, so progress reads at a glance.
  const dotR = 7
  const dotGap = 22
  const dotsRight = LOGICAL_WIDTH - MARGIN - 24
  const n = state.chambers.length
  for (let i = 0; i < n; i += 1) {
    const c = state.chambers[i]!
    const cx = dotsRight - (n - 1 - i) * dotGap
    ctx.beginPath()
    ctx.arc(cx, r.y + r.h / 2, dotR, 0, Math.PI * 2)
    if (c.caught) ctx.fillStyle = p.teal
    else if (c.overset) ctx.fillStyle = p.crimson
    else if (c.counterForce > 0.02) ctx.fillStyle = p.violet
    else if (c.pinch > 0) ctx.fillStyle = p.amber // pinched by the plug, not merely next in line
    else ctx.fillStyle = p.paper
    ctx.fill()
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.stroke()
  }
  const clockX = dotsRight - (n - 1) * dotGap - 44
  const clockSize = Math.min(ts(TYPE.clock), r.h - 14)
  text(ctx, formatClock(state.time), clockX, r.y + r.h / 2 + clockSize * 0.36, {
    font: font(clockSize),
    color: p.ink,
    align: 'right',
  })
}

/**
 * The status word, in the drawing's own top-left corner.
 *
 * It belongs on the workpiece rather than in the chrome — it names what the lock is doing right now,
 * and the eye is already there. Left, because the right-hand corner is where the lock's own tail
 * ends up at every pin count, and a seven-pin lock had the word printed across its shell.
 *
 * A binding chamber is only news while a wrench is on it: the model computes `binding` from
 * clearance whether or not anything is being turned, so at rest it was shouting about a pin nobody
 * is pressing.
 */
function drawStatus(vp: Viewport, p: Palette, state: LabState): void {
  const { ctx } = vp
  const ts = (size: number): number => typeFor(vp, size)
  const r = BENCH.drawing
  let word = ''
  let colour = p.inkLight
  if (state.opened) {
    word = 'OPEN'
    colour = stateColor(p, 'set')
  } else if (state.pickBroken) {
    word = 'PICK BROKEN'
    colour = stateColor(p, 'overset')
  } else if (state.pickBent) {
    word = 'PICK BENT'
    colour = readableAccents(p).amber
  } else if (state.binding >= 0 && state.tension > 0) {
    word = `binding #${state.binding}`
    colour = stateColor(p, 'binding')
  }
  // The drawing *is* the input, said in the corner of the drawing itself — the shelf has no room
  // for it and the header ran it straight through the lock's name.
  label(ctx, 'mouse here slides and lifts the pick · hold to tension', r.x + 24, r.y + r.h - 18, {
    font: font(ts(TYPE.dimension)),
    size: ts(TYPE.dimension),
    color: p.inkLight,
  })
  if (!word) return
  label(ctx, word, r.x + 24, r.y + 44, {
    font: font(ts(TYPE.title), 'bold'),
    size: ts(TYPE.title),
    color: colour,
  })
}

/** The shelf: every control the lab has, laid out where a hand can see them. */
function drawShelf(
  vp: Viewport,
  p: Palette,
  ui: Ui,
  ctl: LabControls,
  src: LabSource,
  sources: readonly LabSource[],
): void {
  const { ctx } = vp
  const ts = (size: number): number => typeFor(vp, size)
  const r = BENCH.shelf
  panel(vp, p, r)
  const cap = (str: string, x: number, y: number): void => {
    label(ctx, str, x, y, {
      font: font(ts(TYPE.dimension)),
      size: ts(TYPE.dimension),
      color: p.inkLight,
    })
  }
  const rowY = r.y + 32
  const rowH = 44
  let x = r.x + 20
  const gap = 38

  cap('tool', x, rowY - 8)
  ctl.toolKind =
    segmented(vp, p, ui, { x, y: rowY, w: 200, h: rowH }, ['hook', 'rake'], ctl.toolKind === 'rake' ? 1 : 0) === 1
      ? 'rake'
      : 'hook'
  x += 200 + gap

  cap('wrench pressure — or scroll', x, rowY - 8)
  ctl.tensionLevel = segmented(
    vp,
    p,
    ui,
    { x, y: rowY, w: 300, h: rowH },
    ['1', '2', '3', '4', '5'],
    ctl.tensionLevel,
  )
  x += 300 + gap

  cap('wrench', x, rowY - 8)
  if (button(vp, p, ui, { x, y: rowY, w: 220, h: rowH }, ctl.wrenchLatched ? 'holding' : 'off', {
    primary: ctl.wrenchLatched,
  })) {
    ctl.wrenchLatched = !ctl.wrenchLatched
  }
  x += 220 + gap

  cap('view', x, rowY - 8)
  ctl.viewMode =
    segmented(
      vp,
      p,
      ui,
      { x, y: rowY, w: 300, h: rowH },
      ['teardown', 'schematic'],
      ctl.viewMode === 'debug' ? 1 : 0,
    ) === 1
      ? 'debug'
      : 'view'
  x += 300 + gap

  cap('hand', x, rowY - 8)
  if (button(vp, p, ui, { x, y: rowY, w: 160, h: rowH }, ctl.auto ? 'auto' : 'manual', { primary: ctl.auto })) {
    ctl.auto = !ctl.auto
  }
  x += 160 + gap

  if (button(vp, p, ui, { x, y: rowY, w: 180, h: rowH }, 'new seed')) ctl.newSeed = true
  x += 180 + gap
  if (button(vp, p, ui, { x, y: rowY, w: 150, h: rowH }, 'reset')) ctl.reset = true

  // ── The roster strip: walk every pin-tumbler lock in the game, plus the demo pin sets ──
  const row2 = r.y + 86
  const row2H = 40
  const navW = 64
  if (button(vp, p, ui, { x: r.x + 20, y: row2, w: navW, h: row2H }, '<')) ctl.sourceDelta -= 1
  if (button(vp, p, ui, { x: r.x + r.w - 20 - navW, y: row2, w: navW, h: row2H }, '>')) {
    ctl.sourceDelta += 1
  }

  const plate = { x: r.x + 20 + navW + 12, y: row2, w: r.w - 40 - (navW + 12) * 2, h: row2H }
  ctx.fillStyle = p.paper
  ctx.fillRect(plate.x, plate.y, plate.w, plate.h)
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = p.rule
  ctx.strokeRect(plate.x + 0.5, plate.y + 0.5, plate.w - 1, plate.h - 1)
  const tier = src.tier === null ? 'demo' : `tier ${src.tier}`
  label(ctx, `${ctl.sourceIndex + 1}/${sources.length}   ${tier}`, plate.x + 14, plate.y + plate.h / 2 + 7, {
    font: font(ts(TYPE.dimension)),
    size: ts(TYPE.dimension),
    color: p.inkLight,
  })
  text(ctx, src.detail, plate.x + plate.w - 14, plate.y + plate.h / 2 + 7, {
    font: font(ts(TYPE.body)),
    color: p.ink,
    align: 'right',
  })
}

/** The footer meters: the three continuous channels the lab has back to the hand. */
function drawFooter(vp: Viewport, p: Palette, state: LabState, ctl: LabControls): void {
  const { ctx } = vp
  const ts = (size: number): number => typeFor(vp, size)
  const r = BENCH.footer
  const acc = readableAccents(p)
  panel(vp, p, r)

  const cols = 3
  const inner = r.w - 40
  const colW = (inner - 40 * (cols - 1)) / cols
  const colX = (i: number): number => r.x + 20 + i * (colW + 40)
  const labelY = r.y + 34
  const barY = r.y + 44
  const capY = r.y + 104

  const cap = (str: string, x: number, colour = p.inkLight): void => {
    label(ctx, str, x, capY, { font: font(ts(TYPE.dimension)), size: ts(TYPE.dimension), color: colour })
  }
  const head = (str: string, x: number): void => {
    label(ctx, str, x, labelY, { font: font(ts(TYPE.dimension)), size: ts(TYPE.dimension), color: p.inkLight })
  }

  /**
   * Tension — the one input the player holds — and, under it, what the lock is doing about it.
   *
   * The **counter** bar is the thing a picker feels through the wrench and has no other way of
   * knowing here: a cammed shoulder driving the plug, and their hand, backwards. Once it overtakes
   * the wrench the plug is losing ground however hard you hold, and the answer is to let up very
   * lightly rather than push harder — so it is drawn on the same scale, directly beneath, where the
   * two can be compared at a glance.
   */
  const full = TENSIONS[TENSIONS.length - 1]!
  const losing = state.counterTorque > state.tension
  head('wrench', colX(0))
  meter(vp, p, colX(0), barY, colW, state.tension / full, acc.amber, 5)
  meter(vp, p, colX(0), barY + BAR_H + 6, colW, state.counterTorque / full, acc.violet, 5, 12)
  // The lightest step sits below the tension a fresh set pin needs to keep its ledge, so it can
  // hold a lock but never set one. That is true, and worth saying: it reads as a broken control
  // otherwise, which is how it was reported.
  const tooLight = TENSIONS[ctl.tensionLevel]! < T_SET_HOLD
  cap(
    losing
      ? `pushing back ${state.counterTorque.toFixed(2)} — ease off, do not shove`
      : tooLight
        ? `level ${ctl.tensionLevel + 1}/5 = ${TENSIONS[ctl.tensionLevel]!.toFixed(2)} — too light to hold a set pin`
        : `level ${ctl.tensionLevel + 1}/5 = ${TENSIONS[ctl.tensionLevel]!.toFixed(2)}   ${
            state.tension > 0 ? 'holding' : 'released'
          }`,
    colX(0),
    losing ? acc.violet : tooLight ? acc.crimson : p.inkLight,
  )

  // Resistance — the simulation's only continuous channel back (SIMULATION.md §8).
  head('resistance', colX(1))
  meter(vp, p, colX(1), barY, colW, state.resistance, acc.teal)
  cap(
    state.pickChamber >= 0 ? `chamber ${state.pickChamber} under the tip` : 'tip touching nothing',
    colX(1),
  )

  // Strain — how hard the tool is being leaned on, and how close it is to going.
  const strainColour = state.pickBroken ? acc.crimson : state.pickBent ? acc.amber : acc.teal
  head('pick strain', colX(2))
  meter(vp, p, colX(2), barY, colW, state.pickStrain / STRAIN_BROKEN, strainColour)
  const set = state.chambers.filter((c) => c.caught).length
  cap(
    state.pickBroken
      ? 'snapped — reset to fit a new pick'
      : state.pickBent
        ? `bent past ${STRAIN_BENT.toFixed(1)} — slower now`
        : `set ${set}/${state.chambers.length}   plug ${Math.round((state.theta / THETA_OPEN) * 100)}%`,
    colX(2),
    state.pickBroken ? acc.crimson : p.inkLight,
  )
}

/**
 * Draw the whole bench, with the workpiece drawn into `BENCH.drawing` in between.
 *
 * The callback goes after the page ground and before the chrome, so the status word can sit over
 * the drawing's own corner. Widgets write straight into `ctl`.
 */
export function drawBench(
  vp: Viewport,
  p: Palette,
  ui: Ui,
  state: LabState,
  ctl: LabControls,
  src: LabSource,
  sources: readonly LabSource[],
  drawWorkpiece: () => void,
): void {
  const { ctx } = vp
  ctx.fillStyle = p.paper
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT)
  drawWorkpiece()
  drawHeader(vp, p, state, src)
  drawStatus(vp, p, state)
  drawShelf(vp, p, ui, ctl, src, sources)
  drawFooter(vp, p, state, ctl)
}
