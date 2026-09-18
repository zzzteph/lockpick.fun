/**
 * PHYSLAB — the teardown view.
 *
 * The truthful cross-section, drawn at the game's altitude rather than as a debug schematic: the
 * same `LabState` `render.ts` draws, in the game's drafting language (ART_DIRECTION.md) — two tones
 * of brass so the shear line is a material seam, ink linework, springs, and every pin state carried
 * by colour *and* a fill pattern, never hue alone.
 *
 * Nothing here is decorative invention. The plug slides sideways by exactly the `shift` the tick
 * computed (Δ = R·θ) — the same honest projection of rotation the real cutaway uses. A pin is drawn
 * from the band silhouette the contact test reads. **The pick's top edge is `toolHeightAt`**, the
 * very function the physics asks what is beneath a pin — so the tool you see bearing on a pin is
 * literally the tool the model contacted it with.
 *
 * The view draws into a **rect** the bench hands it; the chrome around it — header, meters,
 * controls — is `bench.ts`'s job.
 */

import {
  BORE_HALF,
  FLOOR_Y,
  KEYWAY_BOTTOM,
  PITCH,
  SHANK_LEN,
  SHEAR_Y,
  SHELL_CHAMBER_TOP,
  THETA_OPEN,
  type Band,
  type Chamber,
  type LabState,
} from './model'
import { GRIP_MM, drawToolShape, toolShape } from './tool'
import {
  DRAFTING,
  alpha,
  font,
  mix,
  STROKE,
  stateColor,
  type Palette,
  type StateKey,
} from '../render/palette'

/**
 * Vertical extent of the drawing, in mm above the shear line.
 *
 * The shell's chambers are drilled to `SHELL_CHAMBER_TOP` and there is brass over them — which is
 * the point: *"I can push the pin so far, that [the driver] pin will go out from the hull."* It could
 * not any more (the model gave the chamber a ceiling), and now you can **see** the ceiling it stops
 * against.
 */
export const SHELL_TOP_MM = SHELL_CHAMBER_TOP + 0.3
/**
 * How deep the plug is drawn.
 *
 * Deep enough to hold a keyway a real tool fits inside. The hand pivot sits at `HAND_Y`, a
 * millimetre below the pins' rest, and the pick is a strip with thickness — a letterbox slot would
 * have the shaft drawn through solid brass on its way to the mouth. Same reasoning as the game's
 * `KEYWAY_BOTTOM_MM` (D-141): the void moves, never the pins.
 */
export const PLUG_BOTTOM_MM = KEYWAY_BOTTOM - 1.6
/** The keyway's ceiling — the bottom of the plug's bores, with the key pins hanging through it. */
export const KEYWAY_TOP_MM = FLOOR_Y + 0.7
/** Its floor, taken from the model: the pick rests on this, so the two must be the same number. */
export const KEYWAY_BOTTOM_MM = KEYWAY_BOTTOM
export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface ViewFrame {
  readonly scale: number
  /** Screen px of `x = 0mm` (chamber 0's bore centre) and `y = 0mm` (the shear line). */
  readonly ox: number
  readonly oy: number
  readonly p: Palette
}

/** Room under the assembly for the chamber captions and the rotation dimension, px. */
const CAPTION_H = 84
const PAD_X = 26
const PAD_TOP = 14

/**
 * Where the drawing sits inside `rect`.
 *
 * The span runs from the **butt of the pick's grip** to the tail of the lock, because the whole
 * tool is on the page now: a pick pivots about the hand, and the hand rides `SHANK_LEN` behind the
 * point wherever the point is. Drawing the lock alone and letting the tool run off the edge would
 * hide the lever that makes the shaft tilt.
 */
export function viewFrame(state: LabState, rect: Rect, p: Palette = DRAFTING): ViewFrame {
  // The span is fixed for a given lock, *not* fitted to where the tool happens to be: the pick is a
  // fixed length that slides, so a frame that tracked it would rescale the lock as you insert.
  const minX = -SHANK_LEN - GRIP_MM - 1
  const maxX = (state.chambers.length - 1) * PITCH + PITCH * 0.9
  const spanX = maxX - minX
  const spanY = SHELL_TOP_MM - PLUG_BOTTOM_MM
  const usableW = rect.w - PAD_X * 2
  const usableH = rect.h - PAD_TOP - CAPTION_H
  const scale = Math.min(usableW / spanX, usableH / spanY)
  const ox = rect.x + PAD_X + (usableW - spanX * scale) / 2 - minX * scale
  const oy = rect.y + PAD_TOP + (usableH - spanY * scale) / 2 + SHELL_TOP_MM * scale
  return { scale, ox, oy, p }
}

/** Screen px → keyway millimetres, for the hand driving the tool. */
export function mmAt(f: ViewFrame, px: number, py: number): { x: number; y: number } {
  return { x: (px - f.ox) / f.scale, y: (f.oy - py) / f.scale }
}

/** How this chamber should read, as one of the game's five states. */
function chamberState(c: Chamber): StateKey {
  if (c.caught) return 'set'
  if (c.overset) return 'overset'
  if (c.counterForce > 0.02) return 'falseSet' // walled at a false set
  // `pinch`, not `binding`: which pin *would* bind first is geometry the model knows at rest, but a
  // pin is only being leaned on when there is a wrench on the plug (`c.pinch = binding ? T : 0`).
  // Colouring it amber with the wrench released was the drawing claiming a force nobody applied.
  if (c.pinch > 0) return 'binding'
  return 'free'
}

const PATTERN: Record<StateKey, 'solid' | 'hatch' | 'crosshatch' | 'dotted' | 'none'> = {
  free: 'none',
  binding: 'solid',
  set: 'hatch',
  overset: 'crosshatch',
  falseSet: 'dotted',
}

/** Trace a driver silhouette from its bands (tapers included), centred at `cx` mm, foot at `bottom`. */
function tracePin(
  ctx: CanvasRenderingContext2D,
  f: ViewFrame,
  cx: number,
  bottom: number,
  bands: readonly Band[],
): void {
  const sx = (x: number): number => f.ox + x * f.scale
  const sy = (y: number): number => f.oy - y * f.scale
  const topOf = (b: Band): number => b.topHalf ?? b.half
  ctx.beginPath()
  let y = bottom
  ctx.moveTo(sx(cx + bands[0]!.half), sy(y))
  for (const b of bands) {
    ctx.lineTo(sx(cx + b.half), sy(y))
    y += b.len
    ctx.lineTo(sx(cx + topOf(b)), sy(y))
  }
  for (let i = bands.length - 1; i >= 0; i -= 1) {
    const b = bands[i]!
    ctx.lineTo(sx(cx - topOf(b)), sy(y))
    y -= b.len
    ctx.lineTo(sx(cx - b.half), sy(y))
  }
  ctx.closePath()
}

/** Fill the current path with a state's colour and its pattern overlay — the colourblind channel. */
function fillState(
  ctx: CanvasRenderingContext2D,
  f: ViewFrame,
  colour: string,
  pattern: 'solid' | 'hatch' | 'crosshatch' | 'dotted' | 'none',
  bbox: { x: number; y: number; w: number; h: number },
): void {
  ctx.save()
  ctx.clip()
  // A wash of the state colour, then the ink pattern over it so hue is never the only signal.
  ctx.fillStyle = pattern === 'none' ? f.p.steel : pattern === 'solid' ? colour : alpha(colour, 0.32)
  ctx.fillRect(bbox.x, bbox.y, bbox.w, bbox.h)
  if (pattern === 'hatch' || pattern === 'crosshatch' || pattern === 'dotted') {
    ctx.strokeStyle = colour
    ctx.fillStyle = colour
    ctx.lineWidth = STROKE.hairline
    const gap = 7
    if (pattern === 'dotted') {
      for (let x = bbox.x; x < bbox.x + bbox.w; x += gap) {
        for (let y = bbox.y; y < bbox.y + bbox.h; y += gap) {
          ctx.beginPath()
          ctx.arc(x, y, 1.2, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    } else {
      ctx.beginPath()
      for (let d = -bbox.h; d < bbox.w + bbox.h; d += gap) {
        ctx.moveTo(bbox.x + d, bbox.y)
        ctx.lineTo(bbox.x + d - bbox.h, bbox.y + bbox.h)
      }
      if (pattern === 'crosshatch') {
        for (let d = -bbox.h; d < bbox.w + bbox.h; d += gap) {
          ctx.moveTo(bbox.x + d, bbox.y + bbox.h)
          ctx.lineTo(bbox.x + d - bbox.h, bbox.y)
        }
      }
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Draw a spring coil between two heights in a chamber, in mm. */
function spring(
  ctx: CanvasRenderingContext2D,
  f: ViewFrame,
  cx: number,
  fromMm: number,
  toMm: number,
  colour: string,
): void {
  const sx = (x: number): number => f.ox + x * f.scale
  const sy = (y: number): number => f.oy - y * f.scale
  const coils = 6
  ctx.strokeStyle = colour
  ctx.lineWidth = STROKE.hairline
  ctx.beginPath()
  ctx.moveTo(sx(cx), sy(fromMm))
  for (let i = 0; i <= coils; i += 1) {
    const t = i / coils
    const y = fromMm + (toMm - fromMm) * t
    const x = cx + (i % 2 === 0 ? -0.55 : 0.55)
    ctx.lineTo(sx(x), sy(y))
  }
  ctx.lineTo(sx(cx), sy(toMm))
  ctx.stroke()
}

export function renderView(
  ctx: CanvasRenderingContext2D,
  state: LabState,
  rect: Rect,
  p: Palette = DRAFTING,
): void {
  const f = viewFrame(state, rect, p)
  const sx = (x: number): number => f.ox + x * f.scale
  const sy = (y: number): number => f.oy - y * f.scale
  const shift = state.shift

  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.w, rect.h)
  ctx.clip()

  // ── Drafting paper and its rule grid ──
  ctx.fillStyle = p.paper
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  ctx.strokeStyle = alpha(p.rule, 0.6)
  ctx.lineWidth = STROKE.hairline
  ctx.beginPath()
  for (let gx = rect.x; gx < rect.x + rect.w; gx += 28) {
    ctx.moveTo(gx, rect.y)
    ctx.lineTo(gx, rect.y + rect.h)
  }
  for (let gy = rect.y; gy < rect.y + rect.h; gy += 28) {
    ctx.moveTo(rect.x, gy)
    ctx.lineTo(rect.x + rect.w, gy)
  }
  ctx.stroke()

  const leftX = -PITCH * 0.7
  const rightX = (state.chambers.length - 1) * PITCH + PITCH * 0.7
  const bw = BORE_HALF * 2

  const bodyW = (rightX - leftX) * f.scale
  const plugX = sx(leftX) + shift * f.scale
  const boreLeft = (c: Chamber, dx = 0): number => sx(c.def.boreX - BORE_HALF) + dx

  /**
   * A void needs an edge to read as one.
   *
   * Bores and keyway are drawn in `paper`, which sits a hair off both brasses — so with nothing but
   * fill, a plug carrying a deep slot and five wide bores read as a white box with brass at the
   * bottom. The walls are what make it a body with holes in it.
   */
  const wall = (x: number, top: number, bottom: number): void => {
    ctx.moveTo(x, sy(top))
    ctx.lineTo(x, sy(bottom))
  }

  // ── Shell body (fixed, deeper brass) above the shear line, bores punched out ──
  ctx.fillStyle = p.shellBody
  ctx.fillRect(sx(leftX), sy(SHELL_TOP_MM), bodyW, (SHELL_TOP_MM - SHEAR_Y) * f.scale)
  ctx.fillStyle = p.paper
  for (const c of state.chambers) {
    ctx.fillRect(boreLeft(c), sy(SHELL_CHAMBER_TOP), bw * f.scale, (SHELL_CHAMBER_TOP - 0.2) * f.scale)
  }
  ctx.strokeStyle = alpha(p.ink, 0.45)
  ctx.lineWidth = STROKE.hairline
  ctx.beginPath()
  for (const c of state.chambers) {
    wall(boreLeft(c), SHELL_CHAMBER_TOP, SHEAR_Y)
    wall(boreLeft(c, bw * f.scale), SHELL_CHAMBER_TOP, SHEAR_Y)
  }
  ctx.stroke()

  // ── Plug body (turns → slides by `shift`, lighter brass) below the shear line ──
  ctx.fillStyle = p.plugBody
  ctx.fillRect(plugX, sy(SHEAR_Y), bodyW, (SHEAR_Y - PLUG_BOTTOM_MM) * f.scale)
  ctx.fillStyle = p.paper
  for (const c of state.chambers) {
    // The bore stops at the keyway's ceiling so key pins hang into the slot (the game's D-141).
    ctx.fillRect(boreLeft(c, shift * f.scale), sy(SHEAR_Y), bw * f.scale, (SHEAR_Y - KEYWAY_TOP_MM) * f.scale)
  }
  // The keyway: a deep slot the length of the plug, which is the thing a tool goes into.
  ctx.fillRect(plugX, sy(KEYWAY_TOP_MM), bodyW, (KEYWAY_TOP_MM - KEYWAY_BOTTOM_MM) * f.scale)
  ctx.strokeStyle = alpha(p.ink, 0.45)
  ctx.lineWidth = STROKE.hairline
  ctx.beginPath()
  for (const c of state.chambers) {
    wall(boreLeft(c, shift * f.scale), SHEAR_Y, KEYWAY_TOP_MM)
    wall(boreLeft(c, shift * f.scale + bw * f.scale), SHEAR_Y, KEYWAY_TOP_MM)
  }
  ctx.stroke()
  ctx.strokeRect(plugX, sy(KEYWAY_TOP_MM), bodyW, (KEYWAY_TOP_MM - KEYWAY_BOTTOM_MM) * f.scale)
  // The plug's own outline — its face is where the tool visibly enters something.
  ctx.strokeStyle = p.ink
  ctx.lineWidth = STROKE.standard
  ctx.strokeRect(plugX, sy(SHEAR_Y), bodyW, (SHEAR_Y - PLUG_BOTTOM_MM) * f.scale)

  // ── Pins ──
  for (const c of state.chambers) {
    const boreX = c.def.boreX
    const interfaceY = FLOOR_Y + c.def.keyLen + c.lift
    // The key pin sits where the key pin sits: beneath a driver the lock is holding, it has fallen
    // away and there is a gap. That gap is the tell.
    const keyBottom = FLOOR_Y + c.keyLift
    const key = chamberState(c)
    const colour = stateColor(p, key)
    const driverTop = interfaceY + c.def.driver.reduce((s, b) => s + b.len, 0)

    // Spring: from the driver's top to the shell ceiling, compressing as the pin rises.
    spring(ctx, f, boreX, driverTop + 0.1, SHELL_CHAMBER_TOP, p.inkLight)

    // Key pin (in the plug → slides with it), steel and plain — and a shade lighter than the
    // driver, or a free stack draws as one grey column with the interface invisible inside it.
    tracePin(ctx, f, boreX + shift, keyBottom, [{ len: c.def.keyLen, half: c.def.keyHalf }])
    ctx.save()
    ctx.clip()
    ctx.fillStyle = mix(p.steel, p.paper, 0.34)
    ctx.fillRect(
      sx(boreX - 2) + shift * f.scale,
      sy(keyBottom + c.def.keyLen),
      4 * f.scale,
      (c.def.keyLen + 0.4) * f.scale,
    )
    ctx.restore()
    tracePin(ctx, f, boreX + shift, keyBottom, [{ len: c.def.keyLen, half: c.def.keyHalf }])
    ctx.strokeStyle = p.ink
    ctx.lineWidth = STROKE.hairline
    ctx.stroke()

    // Driver pin (in the shell → fixed), coloured and patterned by state.
    const bbox = {
      x: sx(boreX - BORE_HALF) - 2,
      y: sy(driverTop) - 2,
      w: bw * f.scale + 4,
      h: (driverTop - interfaceY) * f.scale + 4,
    }
    tracePin(ctx, f, boreX, interfaceY, c.def.driver)
    fillState(ctx, f, colour, PATTERN[key], bbox)
    tracePin(ctx, f, boreX, interfaceY, c.def.driver)
    ctx.strokeStyle = p.ink
    ctx.lineWidth = STROKE.standard
    ctx.stroke()
  }

  // ── The shear line — the seam between the two brasses, drawn heavy ──
  ctx.strokeStyle = p.ink
  ctx.lineWidth = STROKE.heavy
  ctx.beginPath()
  ctx.moveTo(sx(leftX), sy(SHEAR_Y))
  ctx.lineTo(sx(rightX), sy(SHEAR_Y))
  ctx.stroke()
  // Named on the approach side, not past the tail: a seven-pin lock reaches the edge of the panel
  // and printed the caption half off the page. The paper left of the mouth is empty at this height.
  ctx.fillStyle = p.inkLight
  ctx.font = font(13)
  ctx.textAlign = 'right'
  ctx.fillText('shear line', sx(leftX) - 10, sy(SHEAR_Y) + 4)
  ctx.textAlign = 'left'

  // ── The tool ──  (its shape lives in `tool.ts`; this frame is only how a mm becomes a pixel)
  drawToolShape(ctx, toolShape(state), p, { sx, sy })

  // ── Chamber captions: index and pin type, drafting-dimension style ──
  ctx.fillStyle = p.inkLight
  ctx.font = font(13)
  ctx.textAlign = 'center'
  for (const c of state.chambers) {
    ctx.fillText(`${c.def.index}`, sx(c.def.boreX), sy(PLUG_BOTTOM_MM) + 20)
    ctx.fillText(c.def.kind, sx(c.def.boreX), sy(PLUG_BOTTOM_MM) + 38)
  }

  // ── The rotation dimension: the plug's slide, called out as Δ = R·θ ──
  const dimY = sy(PLUG_BOTTOM_MM) + 56
  ctx.strokeStyle = p.inkLight
  ctx.lineWidth = STROKE.hairline
  ctx.beginPath()
  ctx.moveTo(sx(0), dimY)
  ctx.lineTo(sx(0) + shift * f.scale, dimY)
  ctx.stroke()
  ctx.fillStyle = p.inkLight
  ctx.textAlign = 'left'
  const pct = Math.round((state.theta / THETA_OPEN) * 100)
  ctx.fillText(`plug turned ${pct}%   Δ = R·θ = ${shift.toFixed(2)} mm`, sx(0), dimY + 16)
  ctx.restore()
}
