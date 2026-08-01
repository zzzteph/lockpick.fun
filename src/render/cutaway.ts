/**
 * The cutaway — ART_DIRECTION.md §4. The centrepiece.
 *
 * A section drawing that moves: shell above the shear line, plug below, chambers drilled
 * through both, pin stacks drawn from the same band data the physics reads. Nothing here
 * holds animation state — every position comes from a `SimState` via `layout.ts`, so what
 * you see is what the simulation thinks is true.
 */

import type { Chamber, SimState } from '../sim'
import { KEYWAY_FLOOR, MAX_OVERLIFT, pickedButUnturned } from '../sim'
import { drawAnatomy, faceCentreX } from './anatomy'
import { dotRect, hatchPath, hatchRect, text } from './draw'
import { chamberOffsetY, falseSetPulse, flashAmount, type Fx } from './fx'
import {
  KEYWAY_BOTTOM_MM,
  PLUG_BOTTOM_MM,
  SHELL_CHAMBER_TOP_MM,
  SHELL_TOP_MM,
  bandRects,
  boreWidth,
  captureBandRect,
  driverPinRect,
  invertedSpringSpan,
  isRecessed,
  keyPinRect,
  driverLengthPx,
  driverOutline,
  mmToY,
  plugChamberX,
  shellChamberX,
  springSpan,
  waferRects,
  type CutawayLayout,
} from './layout'
import { STATE_PATTERN, STROKE, TYPE, alpha, font, mix, stateColor, type Palette } from './palette'
import { LOGICAL_WIDTH, isCompact, snapX, snapY, typeFor, type Viewport } from './viewport'

const HATCH_SPACING = 6

/**
 * Blind mode: you can feel one pin at a time, and you cannot feel what *kind* it is.
 *
 * The mode draws the body, the bores and the shear line — the lock is right there in front of
 * you — and then exactly one pin: the one under the tip. Move the pick and it goes. No faint
 * remembered outline, because your fingers do not leave a drawing behind.
 *
 * Crucially the pin under the tip is drawn as a **plain** stack whatever it really is. A spool's
 * waist, a serrated pin's steps and a mushroom's undercut are things you deduce from how the
 * lock *behaves* — the plug giving early, the shove against your pick, the count of false sets.
 * Drawing the real silhouette handed all of that over for free and made the hardest deduction in
 * the game a matter of looking. See DECISIONS D-041.
 */
export interface FeltPins {
  /** Chamber under the tip right now, or -1 for none. */
  readonly active: number
}

export interface CutawayOptions {
  /** Chamber under the pick tip, or -1. */
  readonly activeChamber: number
  /** Show the capture window and setLift marks (Guided mode). */
  readonly showTargets: boolean
  /** Transient feedback effects. Never affects where the simulation says things are. */
  readonly fx: Fx
  /**
   * Present in Blind mode only. When set, exactly one chamber is drawn — the one under the
   * tip — and its driver is drawn unshaped, so the pin's *type* stays hidden.
   */
  readonly felt?: FeltPins
}

/** In blind mode, only the chamber under the tip is drawn at all. */
function pinVisibility(c: Chamber, felt: FeltPins | undefined): number {
  if (!felt) return 1
  return c.index === felt.active ? 1 : 0
}

/** The shell body with its chamber bores punched out, as one even-odd path. */
function shellPath(ctx: CanvasRenderingContext2D, layout: CutawayLayout): void {
  const top = mmToY(layout, SHELL_TOP_MM)
  const bottom = mmToY(layout, 0)
  ctx.beginPath()
  ctx.rect(layout.left, top, layout.right - layout.left, bottom - top)
  const bw = boreWidth(layout)
  const boreTop = mmToY(layout, SHELL_CHAMBER_TOP_MM)
  for (let i = 0; i < layout.chamberCount; i += 1) {
    ctx.rect(shellChamberX(layout, i) - bw / 2, boreTop, bw, bottom - boreTop)
  }
}

/** The plug body: bores (which slide with rotation) and the keyway channel punched out. */
function plugPath(ctx: CanvasRenderingContext2D, layout: CutawayLayout): void {
  const top = mmToY(layout, 0)
  const bottom = mmToY(layout, PLUG_BOTTOM_MM)
  ctx.beginPath()
  ctx.rect(layout.left, top, layout.right - layout.left, bottom - top)
  const bw = boreWidth(layout)
  const boreBottom = mmToY(layout, KEYWAY_FLOOR)
  for (let i = 0; i < layout.chamberCount; i += 1) {
    ctx.rect(plugChamberX(layout, i) - bw / 2, top, bw, boreBottom - top)
  }
  const keyTop = mmToY(layout, KEYWAY_FLOOR)
  const keyBottom = mmToY(layout, KEYWAY_BOTTOM_MM)
  ctx.rect(layout.left, keyTop, layout.right - layout.left, keyBottom - keyTop)
}

function drawBody(
  vp: Viewport,
  p: Palette,
  layout: CutawayLayout,
  path: (ctx: CanvasRenderingContext2D, l: CutawayLayout) => void,
  fill: string | CanvasGradient,
  hatchAngle: number,
  bounds: { x: number; y: number; w: number; h: number },
): void {
  const { ctx } = vp
  ctx.save()
  path(ctx, layout)
  ctx.fillStyle = fill
  ctx.fill('evenodd')
  ctx.restore()

  // Cut faces get 45° hatching, like a real section drawing (ART_DIRECTION.md §2).
  ctx.save()
  hatchPath(
    ctx,
    () => {
      path(ctx, layout)
    },
    bounds,
    {
      spacing: HATCH_SPACING,
      angleDeg: hatchAngle,
      color: p.rule,
      lineWidth: 1,
      fillRule: 'evenodd',
    },
  )
  ctx.restore()

  ctx.save()
  path(ctx, layout)
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.stroke()
  ctx.restore()
}

/**
 * A 5-coil zigzag that compresses as the stack rises (ART_DIRECTION.md §4).
 * An inverted wafer's spring sits *below* it, pushing up — that is what makes it inverted.
 */
function drawSpring(vp: Viewport, p: Palette, layout: CutawayLayout, c: Chamber): void {
  const { ctx } = vp
  const span = c.inverted ? invertedSpringSpan(layout, c) : springSpan(layout, c)
  const height = Math.max(2, span.bottom - span.top)
  const cx = shellChamberX(layout, c.index)
  const halfW = layout.driverWidth * 0.36
  /**
   * Coil count and wire weight from this chamber's own spring strength (D-062).
   *
   * A stiff spring is drawn as fewer, fatter coils and a soft one as more, finer ones — which is
   * both how spring steel actually works and the only way the difference is visible before you
   * touch the pin. Five coils for every chamber said "all springs are identical", which was true
   * and is no longer.
   */
  const coils = c.springStrength >= 1.08 ? 4 : c.springStrength <= 0.92 ? 6 : 5
  ctx.save()
  ctx.lineWidth = c.springStrength >= 1.08 ? STROKE.standard : STROKE.hairline
  ctx.strokeStyle = p.inkLight
  ctx.beginPath()
  ctx.moveTo(cx, span.top)
  for (let i = 0; i < coils; i += 1) {
    const y0 = span.top + (height * (i + 0.5)) / coils
    const y1 = span.top + (height * (i + 1)) / coils
    ctx.lineTo(cx + (i % 2 === 0 ? halfW : -halfW), y0)
    ctx.lineTo(cx, y1)
  }
  ctx.stroke()
  ctx.restore()
}

function paintPattern(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  chamber: Chamber,
  p: Palette,
  showBinding: boolean,
): void {
  // Through `stateKey`, so the fill *pattern* hides a binding chamber outside Guided mode as
  // well as the fill colour. Leaking it through the pattern channel would give it straight back
  // to a colourblind player and to anyone reading the greyscale view.
  const pattern = STATE_PATTERN[stateKey(chamber, showBinding)]
  const inkOnFill = alpha(p.ink, 0.55)
  switch (pattern) {
    case 'hatch':
      hatchRect(ctx, rect.x, rect.y, rect.w, rect.h, {
        spacing: 5,
        angleDeg: 0,
        color: inkOnFill,
        lineWidth: 1,
      })
      break
    case 'crosshatch':
      hatchRect(ctx, rect.x, rect.y, rect.w, rect.h, {
        spacing: 6,
        angleDeg: 45,
        color: inkOnFill,
        lineWidth: 1,
      })
      hatchRect(ctx, rect.x, rect.y, rect.w, rect.h, {
        spacing: 6,
        angleDeg: -45,
        color: inkOnFill,
        lineWidth: 1,
      })
      break
    case 'dotted':
      dotRect(ctx, rect.x, rect.y, rect.w, rect.h, {
        spacing: 7,
        radius: 1.4,
        color: inkOnFill,
      })
      break
    case 'solid':
    case 'none':
      break
  }
}

/**
 * The colour a driver is drawn with, including the set flash.
 * ART_DIRECTION.md §5: a one-frame flash to Highlight, then a 180ms ease to the state hue.
 */
export function driverFill(p: Palette, c: Chamber, fx: Fx, showBinding = true): string {
  /**
   * An overset driver is drawn as an ordinary one, because it *is* one.
   *
   * The body jammed across the shear line in an overset is the **key pin** — the junction has gone
   * past the line, so the driver is above it in the bible, holding nothing. Colouring the driver
   * crimson pointed at the wrong pin, and it pointed at it in the loudest way the drawing has.
   * The key pin keeps the crimson (see `drawKeyPin`). See DECISIONS D-094.
   */
  const key = c.state === 'OVERSET' ? 'free' : stateKey(c, showBinding)
  const base = stateColor(p, key)
  const flash = flashAmount(fx, c.index)
  const pulse = falseSetPulse(fx, c.index)
  let fill = flash > 0 ? mix(base, p.highlight, Math.min(1, flash * 1.4)) : base
  if (pulse > 0) fill = mix(fill, p.paper, pulse * 0.18)
  return fill
}

/**
 * A wafer — one flat plate with a gate in it, drawn as a single piece rather than a key pin
 * and a driver, because that is what it is (SIMULATION.md §10).
 */
function drawWafer(
  vp: Viewport,
  p: Palette,
  layout: CutawayLayout,
  c: Chamber,
  fx: Fx,
  recessed: boolean,
  showBinding: boolean,
): void {
  const { ctx } = vp
  const rects = waferRects(layout, c)
  const fill = driverFill(p, c, fx, showBinding)
  ctx.save()
  ctx.beginPath()
  for (const r of rects) ctx.rect(r.x, r.y, r.w, r.h)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()
  for (const r of rects) paintPattern(ctx, r, c, p, showBinding)

  ctx.save()
  ctx.lineWidth = recessed ? STROKE.hairline : STROKE.standard
  ctx.strokeStyle = recessed ? p.inkLight : p.ink
  ctx.beginPath()
  outlineBands(ctx, rects)
  ctx.stroke()

  // The gate, marked so it reads as the thing you are aiming at.
  const gate = rects[1]
  if (gate) {
    ctx.setLineDash([3, 3])
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = p.ink
    ctx.beginPath()
    ctx.moveTo(gate.x - 6, gate.y)
    ctx.lineTo(gate.x + gate.w + 6, gate.y)
    ctx.moveTo(gate.x - 6, gate.y + gate.h)
    ctx.lineTo(gate.x + gate.w + 6, gate.y + gate.h)
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.restore()
}

/** The driver pin, band by band — a spool's waist is its real geometry, not a sprite. */
function drawDriver(
  vp: Viewport,
  p: Palette,
  layout: CutawayLayout,
  c: Chamber,
  fx: Fx,
  recessed = false,
  showBinding = true,
  plain = false,
): void {
  const { ctx } = vp
  const fill = driverFill(p, c, fx, showBinding)
  // `plain` is blind mode: draw the driver as an unshaped stack whatever it really is, so a
  // spool's waist and a serrated pin's steps have to be *deduced* rather than read (D-041).
  const rects = plain ? [driverPinRect(layout, c)] : bandRects(layout, c)
  /**
   * Filled and outlined as one **tapered** silhouette, not as a stack of rectangles (D-125).
   *
   * `bandRects` still supplies the rectangles the fill patterns are painted into — a hatch wants a
   * rect, and the band boundaries are where a pattern should change. What it cannot supply is the
   * *shape*: it knows `grooveDepth` and discards `taper`, so a mushroom's bevelled cone and a
   * T-pin's square step came out as the same outline. The pin in the lock now matches the pin on
   * the help page, and both match what the simulation is reading.
   */
  const body = plain
    ? null
    : driverOutline(
        c.profile.bands,
        shellChamberX(layout, c.index),
        (rects[0]?.y ?? 0) + (rects[0]?.h ?? 0),
        layout.driverWidth,
        driverLengthPx(layout),
      )
  const tracePath = (): void => {
    ctx.beginPath()
    if (body) {
      body.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y)
        else ctx.lineTo(pt.x, pt.y)
      })
      ctx.closePath()
    } else {
      for (const r of rects) ctx.rect(r.x, r.y, r.w, r.h)
    }
  }

  ctx.save()
  tracePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()

  // The patterns are clipped to the silhouette so a hatch cannot spill into a waist.
  ctx.save()
  tracePath()
  ctx.clip()
  for (const r of rects) paintPattern(ctx, r, c, p, showBinding)
  ctx.restore()

  ctx.save()
  ctx.lineWidth = recessed ? STROKE.hairline : STROKE.standard
  ctx.strokeStyle = recessed ? p.inkLight : p.ink
  if (body) tracePath()
  else {
    ctx.beginPath()
    // Outline the silhouette rather than every band, so the waist reads as one shape.
    outlineBands(ctx, rects)
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * Whether *which chamber the plug is pinching* may be shown.
 *
 * `GAME_DESIGN.md §4` lists "binding pin highlighted" as a **Guided** feature and gives
 * Standard only "resistance meter, pin states visible". Colouring the binding chamber amber in
 * every mode gave the whole game away for free: the single hardest thing to work out — which
 * pin the lock is actually leaning on — was painted on the screen, and the resistance meter,
 * the audio and the pick's flex were all decoration. Finding the binding pin *is* the game.
 *
 * A binding chamber now draws exactly like a free one outside Guided mode. Nothing is hidden
 * that the player could otherwise see: a pin's position, and whether it is set, overset or
 * lying, all still read at a glance. See DECISIONS D-043.
 */
export function stateKey(
  c: Chamber,
  showBinding = true,
): 'free' | 'binding' | 'set' | 'overset' | 'falseSet' {
  if (c.state === 'BINDING' && !showBinding) return 'free'
  switch (c.state) {
    case 'BINDING':
      return 'binding'
    case 'SET':
      return 'set'
    case 'OVERSET':
      return 'overset'
    case 'FALSE_SET':
      return 'falseSet'
    case 'FREE':
      return 'free'
  }
}

/** Trace the outline of a stack of centred rects as a single closed silhouette. */
function outlineBands(
  ctx: CanvasRenderingContext2D,
  rects: readonly { x: number; y: number; w: number; h: number }[],
): void {
  if (rects.length === 0) return
  const first = rects[0]
  if (!first) return
  // Down the right side (rects are ordered bottom -> top, so iterate in reverse for y order).
  const ordered = [...rects].sort((a, b) => a.y - b.y)
  const top = ordered[0]
  if (!top) return
  ctx.moveTo(top.x, top.y)
  ctx.lineTo(top.x + top.w, top.y)
  for (let i = 0; i < ordered.length; i += 1) {
    const r = ordered[i]
    if (!r) continue
    const next = ordered[i + 1]
    ctx.lineTo(r.x + r.w, r.y + r.h)
    if (next) ctx.lineTo(next.x + next.w, r.y + r.h)
  }
  const last = ordered[ordered.length - 1]
  if (!last) return
  ctx.lineTo(last.x, last.y + last.h)
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const r = ordered[i]
    if (!r) continue
    const prev = ordered[i - 1]
    ctx.lineTo(r.x, r.y)
    if (prev) ctx.lineTo(prev.x, r.y)
  }
  ctx.closePath()
}

/** The key pin: narrower, chamfered top, and it rides with the plug. */
function drawKeyPin(vp: Viewport, p: Palette, layout: CutawayLayout, c: Chamber): void {
  const { ctx } = vp
  const r = keyPinRect(layout, c)
  const chamfer = Math.min(6, r.w * 0.22)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(r.x + chamfer, r.y)
  ctx.lineTo(r.x + r.w - chamfer, r.y)
  ctx.lineTo(r.x + r.w, r.y + chamfer)
  ctx.lineTo(r.x + r.w, r.y + r.h)
  ctx.lineTo(r.x, r.y + r.h)
  ctx.lineTo(r.x, r.y + chamfer)
  ctx.closePath()
  // Slightly lighter than the driver above it, so the junction reads even where the two
  // are the same width at a glance.
  ctx.fillStyle =
    c.state === 'OVERSET' ? mix(p.steel, p.crimson, 0.55) : mix(p.steel, p.paper, 0.32)
  ctx.fill()
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.stroke()
  ctx.restore()
}

/** Guided-mode annotation: where this chamber's junction has to end up. */
/**
 * Guided mode's annotations — `GAME_DESIGN.md §4`.
 *
 * Three things, and exactly the three the table promises: the capture band marked so `setLift`
 * is visible, the overset zone above it shaded red so the mistake is *seeable before it is
 * made*, and the binding chamber called out so a new player knows which one the lock is
 * actually asking about. They are drawn under the pins, not over them, so guided mode adds
 * information without hiding the mechanism it is explaining.
 */
function drawTargets(
  vp: Viewport,
  p: Palette,
  layout: CutawayLayout,
  c: Chamber,
  binding: boolean,
): void {
  const { ctx } = vp
  const narrow = captureBandRect(layout, c)
  // Full bore width, not key-pin width: at 0.34mm a tight lock's window is a fourteen-pixel
  // sliver, and drawn only as wide as the pin it is entirely hidden behind it. Spanning the
  // bore puts the mark either side of the pin, so the pin reads as sitting *in* the zone.
  const w = boreWidth(layout)
  const band = { ...narrow, x: plugChamberX(layout, c.index) - w / 2, w }
  ctx.save()

  // The overset zone: everything above the window, up to where the spring bottoms out. Both
  // bands are in junction coordinates — height above the shear line — like `captureBandRect`.
  const overTop = mmToY(layout, c.captureWindow + MAX_OVERLIFT)
  const overHeight = Math.max(0, band.y - overTop)
  if (overHeight > 0) {
    ctx.fillStyle = alpha(p.crimson, 0.15)
    ctx.fillRect(band.x, overTop, band.w, overHeight)
    ctx.strokeStyle = alpha(p.crimson, 0.6)
    ctx.lineWidth = STROKE.hairline
    ctx.setLineDash([3, 5])
    ctx.strokeRect(band.x, overTop, band.w, overHeight)
    ctx.setLineDash([])
  }

  ctx.fillStyle = alpha(p.teal, 0.28)
  ctx.fillRect(band.x, band.y, band.w, band.h)
  ctx.strokeStyle = alpha(p.teal, 0.9)
  ctx.lineWidth = STROKE.standard
  ctx.setLineDash([4, 4])
  ctx.strokeRect(band.x, band.y, band.w, band.h)
  ctx.setLineDash([])

  if (binding) {
    // A bracket around the chamber the plug is pinching — the single most useful fact on
    // screen, and the one a new player has no way to read for themselves.
    const x = shellChamberX(layout, c.index)
    const top = mmToY(layout, SHELL_CHAMBER_TOP_MM) - 14
    const bottom = mmToY(layout, KEYWAY_FLOOR) + 14
    const w = layout.driverWidth + 26
    ctx.strokeStyle = p.amber
    ctx.lineWidth = STROKE.standard
    ctx.setLineDash([9, 6])
    ctx.strokeRect(x - w / 2, top, w, bottom - top)
    ctx.setLineDash([])
  }
  ctx.restore()
}

/**
 * The rotation gauge — the plug seen end-on. This is where `θ` is shown honestly: the
 * keyway silhouette turns by the real angle, with the value in degrees beside it.
 *
 * It carries three angles, not one, because one was not enough to play with. `θ` is where the
 * plug **is**; `θ_demand` is how far your wrench is **asking** it to go; `θ_max` is where the
 * lock **stops** you. Reading them together answers the question the picture used to leave
 * unanswerable: when the plug sits still, is that the pins holding it, or is it your own hand
 * not asking for more? Nothing here is an assist — it is your wrench and the plug's face, both
 * of which a real hand feels directly, so it is drawn at every difficulty. See DECISIONS D-048.
 */
function drawRotationGauge(
  vp: Viewport,
  p: Palette,
  layout: CutawayLayout,
  theta: number,
  demand: number,
  max: number,
  free: boolean,
): void {
  const { ctx } = vp
  const cx = faceCentreX(layout)
  const cy = (mmToY(layout, 0) + mmToY(layout, PLUG_BOTTOM_MM)) / 2
  const r = 56

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = p.paperShade
  ctx.fill()
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.stroke()

  // Datum at zero.
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx, cy - r)
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = p.rule
  ctx.stroke()

  // The keyway silhouette, turned by the real theta, plus an index line to the rim.
  ctx.translate(cx, cy)
  ctx.rotate(theta)
  const w = 8
  const wardY = -r * 0.18
  ctx.beginPath()
  ctx.moveTo(-w, r * 0.58)
  ctx.lineTo(-w, wardY)
  ctx.lineTo(-w * 2.1, wardY)
  ctx.lineTo(-w * 2.1, wardY - w * 0.9)
  ctx.lineTo(-w, wardY - w * 0.9)
  ctx.lineTo(-w, -r * 0.66)
  ctx.lineTo(w, -r * 0.66)
  ctx.lineTo(w, r * 0.58)
  ctx.closePath()
  ctx.fillStyle = p.paper
  ctx.fill()
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(0, -r * 0.66)
  ctx.lineTo(0, -r)
  ctx.lineWidth = STROKE.heavy
  ctx.strokeStyle = p.amber
  ctx.stroke()
  ctx.restore()

  // Three arcs on three radii, outermost first: what the lock allows, what the wrench asks,
  // where the plug actually sits. Concentric so they can be compared at a glance, and in that
  // order so the innermost — the real one — is never overdrawn.
  const arc = (radius: number, angle: number, color: string, width: number): void => {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.max(angle, 0.002))
    ctx.lineWidth = width
    ctx.strokeStyle = color
    ctx.stroke()
    ctx.restore()
  }
  arc(r + 27, max, alpha(p.teal, 0.75), STROKE.standard)
  arc(r + 20, demand, alpha(p.ink, 0.35), STROKE.hairline)
  arc(r + 13, theta, p.amber, STROKE.heavy)

  /**
   * The dial's caption stack, spaced by its own type — DECISIONS D-132.
   *
   * Five lines at +40, +62, +82, +104 and +122: an 18px pitch for a 17px face, which works exactly
   * until the face is 30px and every line is printed through the one below it. Reported as *"plug
   * (circle one) with the text are also very small"* — and once the type was scaled to fix the
   * "very small", the offsets turned it into a smear. Measured, so the two cannot disagree again.
   */
  /**
   * The caption stack is **left-aligned off the gutter**, not centred on the dial — D-133.
   *
   * Centred on `cx`, the widest line (`29.8° / 0.1°`) reaches back past x=162, which is the right
   * edge of the wrench slider's panel — so the leading digit was drawn underneath it and the reading
   * looked sliced. A UX review measured three different left edges in a 35px-tall cluster, with two
   * different label/value arrangements between them.
   *
   * One edge and one arrangement: every line starts at `readX`, which is the first column clear of
   * the gutter, and every line is label-over-value rather than some stacked and some inline.
   */
  /**
   * The caption block is clamped **between both gutters** — DECISIONS D-134.
   *
   * The dial sits at the tail of the lock, so it mirrors with `handedness`; the wrench slider
   * mirrors too. They therefore land on the *same* side of the screen whichever hand is chosen, and
   * this block is always the thing that has to give. D-133 clamped it off the left gutter only, so
   * right-handed put the whole readout under the wrench panel and sliced the plug angle in half.
   *
   * Measured first, placed second: the widest line decides where the block can start, and it is
   * pushed inside whichever gutter it would otherwise run into.
   */
  const dimSize = typeFor(vp, TYPE.dimension)
  const bodySize = typeFor(vp, TYPE.body)
  const deg = (a: number): string => `${((a * 180) / Math.PI).toFixed(1)}°`
  const rows: [string, number, string][] = [
    ['PLUG θ', dimSize, p.inkLight],
    [deg(theta), bodySize, p.ink],
    // "asking / allowed" — the pair that tells you whose fault the stall is.
    [`${deg(demand)} / ${deg(max)}`, dimSize, p.inkLight],
  ]
  if (free) {
    // The plug is slack and turning against nothing. The only thing left is your wrench.
    rows.push(['PLUG FREE', dimSize, p.teal], ['TURN HARDER', dimSize, p.teal])
  }
  ctx.save()
  let widest = 0
  for (const [str, size] of rows) {
    ctx.font = font(size)
    widest = Math.max(widest, ctx.measureText(str).width)
  }
  ctx.restore()
  const GUTTER_CLEAR = 176
  const readX = Math.min(
    Math.max(GUTTER_CLEAR, cx - r),
    LOGICAL_WIDTH - GUTTER_CLEAR - widest,
  )
  let dy = cy + r + 12
  for (const [str, size, color] of rows) {
    dy += size + 6
    text(ctx, str, readX, dy, { font: font(size), color })
  }
}

export function drawCutaway(
  vp: Viewport,
  p: Palette,
  state: SimState,
  layout: CutawayLayout,
  opts: CutawayOptions,
): void {
  const { ctx } = vp
  const shellTop = mmToY(layout, SHELL_TOP_MM)
  const shearY = mmToY(layout, 0)
  const plugBottom = mmToY(layout, PLUG_BOTTOM_MM)

  drawBody(vp, p, layout, shellPath, p.shellBody, 45, {
    x: layout.left,
    y: shellTop,
    w: layout.right - layout.left,
    h: shearY - shellTop,
  })

  // The plug carries a very subtle vertical wash — the one gradient in the whole game.
  const wash = ctx.createLinearGradient(0, shearY, 0, plugBottom)
  wash.addColorStop(0, p.plugBody)
  wash.addColorStop(1, mix(p.plugBody, p.paper, 0.55))
  drawBody(vp, p, layout, plugPath, wash, -45, {
    x: layout.left,
    y: shearY,
    w: layout.right - layout.left,
    h: plugBottom - shearY,
  })

  // Recessed rows first, so the front bank draws over them (ART_DIRECTION.md §4 — line
  // weight and value push non-active elements back, rather than depth of field).
  const ordered = [...state.chambers].sort(
    (a, b) => Number(isRecessed(layout, b.index)) - Number(isRecessed(layout, a.index)),
  )
  for (const c of ordered) {
    if (opts.showTargets) drawTargets(vp, p, layout, c, c.index === state.bindingChamber)
    const seen = pinVisibility(c, opts.felt)
    if (seen <= 0) continue
    const dy = chamberOffsetY(opts.fx, c.index)
    const recessed = isRecessed(layout, c.index)
    ctx.save()
    if (dy !== 0) ctx.translate(0, dy)
    if (recessed) ctx.globalAlpha = 0.55
    if (seen < 1) ctx.globalAlpha *= seen
    drawSpring(vp, p, layout, c)
    if (c.kind === 'wafer') {
      drawWafer(vp, p, layout, c, opts.fx, recessed, opts.showTargets)
    } else {
      drawDriver(vp, p, layout, c, opts.fx, recessed, opts.showTargets, opts.felt !== undefined)
      drawKeyPin(vp, p, layout, c)
    }
    ctx.restore()
  }

  // The shear line: the strongest line on screen, running past the body on both sides.
  const y = snapY(vp, shearY, STROKE.heavy)
  ctx.save()
  ctx.lineWidth = STROKE.heavy
  ctx.strokeStyle = p.ink
  ctx.beginPath()
  ctx.moveTo(0, y)
  ctx.lineTo(LOGICAL_WIDTH, y)
  ctx.stroke()
  ctx.restore()

  /**
   * The rotation gauge is a desktop reading — DECISIONS D-135.
   *
   * It is a dial plus three lines of type in the lower-left corner, and the **plug's angle is
   * already a meter in the footer**. What the dial adds over that meter is `asking / allowed` —
   * whose fault the stall is — which is a genuinely good reading and a study one: you look at it
   * when you are working out *why*, not while you are picking. On a phone it is one of the largest
   * blocks on the screen, and the screen it is on is the one the whole game happens on.
   *
   * The one thing in it that is not a reading but an **instruction** survives the cut: `plug free,
   * turn harder` means every driver is above the line and only your wrench is short, which is a
   * state a player can sit in indefinitely without knowing why. It moves to the caption row where
   * the other prompts live.
   */
  if (!isCompact(vp))
    drawRotationGauge(
      vp,
      p,
      layout,
      state.theta,
      state.thetaDemand,
      state.thetaMax,
      pickedButUnturned(state),
    )
  drawChamberLabels(vp, p, layout, state, opts.activeChamber)
  /**
   * The anatomy key — SHELL, PLUG, KEYWAY, the shear line and the pin-stack legend — is a
   * desktop luxury (D-122).
   *
   * It exists so a player who has never taken a cylinder apart can learn which brass block is
   * which (D-050), and on a full page it costs nothing. On a phone it is six labels at a size
   * nobody can read, drawn across the one thing they need to see. The lock itself is the tutorial
   * on a small screen; the words are in Help.
   */
  if (!isCompact(vp)) drawAnatomy(vp, p, layout, state)
}

function drawChamberLabels(
  vp: Viewport,
  p: Palette,
  layout: CutawayLayout,
  state: SimState,
  active: number,
): void {
  const { ctx } = vp
  const labelY = mmToY(layout, PLUG_BOTTOM_MM) + 30
  for (const c of state.chambers) {
    const cx = shellChamberX(layout, c.index)
    const isActive = c.index === active
    text(ctx, String(c.index + 1), cx, labelY, {
      font: font(typeFor(vp, TYPE.dimension)),
      color: isActive ? p.ink : p.inkLight,
      align: 'center',
    })
  }

  if (active < 0) return
  const c = state.chambers[active]
  if (!c) return
  // The active chamber gets a 3px focus rectangle (ART_DIRECTION.md §4).
  const bw = boreWidth(layout) + 10
  const top = mmToY(layout, SHELL_CHAMBER_TOP_MM) - 6
  const bottom = mmToY(layout, KEYWAY_FLOOR) + 6
  ctx.save()
  ctx.lineWidth = STROKE.heavy
  ctx.strokeStyle = p.ink
  const rx = snapX(vp, shellChamberX(layout, active) - bw / 2, STROKE.heavy)
  const ry = snapY(vp, top, STROKE.heavy)
  ctx.strokeRect(rx, ry, bw, bottom - top)
  ctx.restore()
}
