/**
 * The cutaway's labels — what each part of the lock is called and where it is.
 *
 * A section drawing that names nothing is a puzzle about the drawing rather than about the lock.
 * A player who has never taken a cylinder apart is looking at two brass blocks, a row of
 * rectangles and a very important horizontal line, with no way to learn which is which; and
 * every word this game uses afterwards — plug, shell, shear line, driver, key pin — assumes they
 * already know. So the drawing is annotated the way a real cutaway in a locksmithing text is
 * annotated: part names set into the solid metal at the ends of the body, and a key in the margin
 * naming the three things in a pin stack.
 *
 * Everything here is static anatomy. Nothing in this file reads chamber *state*, so none of it can
 * leak what the player is supposed to deduce — it says "this is a driver pin", never "this driver
 * pin is binding". That is what makes it safe to show at every difficulty. See DECISIONS D-050.
 */

import type { SimState } from '../sim'
import { text } from './draw'
import {
  KEYWAY_BOTTOM_MM,
  SHELL_TOP_MM,
  boreWidth,
  mmToY,
  plugChamberX,
  type CutawayLayout,
} from './layout'
import { KEYWAY_FLOOR } from '../sim'
import { STROKE, TYPE, alpha, font, mix, type Palette } from './palette'
import { LOGICAL_WIDTH, typeFor, type Viewport } from './viewport'

/** Which end of the body the keyway opens at, and which end is the tail. */
function ends(layout: CutawayLayout): {
  mouth: number
  tail: number
  sign: number
} {
  return layout.mirrored
    ? { mouth: layout.right, tail: layout.left, sign: -1 }
    : { mouth: layout.left, tail: layout.right, sign: 1 }
}

/**
 * Where the plug's face is drawn, in logical px — the mouth end, because that is where the face
 * of a real cylinder is.
 *
 * The rotation gauge is the plug seen end-on, so it belongs at the end you put the key in. It
 * used to be pinned to the left whatever the handedness setting said, which put the lock's face
 * at the back of the lock on a right-handed layout (D-047, D-050).
 */
export function faceCentreX(layout: CutawayLayout): number {
  const { mouth, sign } = ends(layout)
  return mouth - 132 * sign
}

/**
 * Where a label sitting in the **plug** may go, and whether there is still room for one.
 *
 * The plug's bores slide with rotation, and at full turn they slide by 62% of a pin diameter —
 * far enough that the last one crosses most of the tail pad and prints itself over any words
 * standing there. So the plug-side labels are placed in whatever gap is left between the
 * outermost bore and the end of the body, and give up when that gap closes.
 *
 * The shell's bores do not move, so `SHELL` needs none of this.
 */
function plugPadCentre(layout: CutawayLayout): number | null {
  const { tail, sign } = ends(layout)
  const last = Math.max(0, layout.chamberCount - 1)
  const edge = plugChamberX(layout, last) + (boreWidth(layout) / 2) * sign
  const room = (tail - edge) * sign
  return room < 36 ? null : (edge + tail) / 2
}

/** The anatomy key's column, in the margin past the tail end. */
function keyColumnX(layout: CutawayLayout): number {
  const { tail, sign } = ends(layout)
  return tail + 58 * sign
}

/**
 * Part names set into the solid brass at each end of the body.
 *
 * These sit in the end pads (`layout.endPad`), which exist precisely so that a short lock has
 * body past its outermost bore — so the text never lands on a pin whatever the pin count.
 */
export function drawPartNames(vp: Viewport, p: Palette, layout: CutawayLayout): void {
  const { ctx } = vp
  const { tail, sign } = ends(layout)
  const shellTop = mmToY(layout, SHELL_TOP_MM)
  const shearY = mmToY(layout, 0)
  // Centre of the tail pad: inside the metal, clear of the last bore.
  const padX = tail - (layout.endPad / 2) * sign
  const plugX = plugPadCentre(layout)

  const pair = (name: string, note: string, y: number, atX = padX): void => {
    text(ctx, name, atX, y - 6, {
      font: font(typeFor(vp, TYPE.dimension)),
      color: p.inkLight,
      align: 'center',
    })
    text(ctx, note, atX, y + 9, {
      font: font(typeFor(vp, TYPE.dimension)),
      color: alpha(p.inkLight, 0.75),
      align: 'center',
    })
  }

  ctx.save()
  ctx.globalAlpha = 0.85
  // Which of these two turns is the fact the whole game rests on, so it is said out loud.
  pair('SHELL', 'fixed', (shellTop + shearY) / 2)
  // Between the shear line and the keyway roof, in whatever plug metal the rotation has left.
  if (plugX !== null) pair('PLUG', 'turns', (shearY + mmToY(layout, KEYWAY_FLOOR)) / 2, plugX)
  ctx.restore()
}

/**
 * `SHEAR LINE`, at the margin, with the line it names running out to meet it.
 *
 * The most important line in the game and the least self-explanatory: it is not a part, it is
 * the *join* between two parts, and the whole of picking is getting pin stacks to end exactly
 * on it. Labelled at the far margin, where the shear line already extends past the body.
 */
export function drawShearLabel(vp: Viewport, p: Palette, layout: CutawayLayout): void {
  const { ctx } = vp
  /**
   * At the **mouth** end, not the tail — because the tail end is where the readouts live.
   *
   * This label sat at the tail, which is the right-hand margin on a right-handed layout: the same
   * strip of page as the force and resistance columns, their numbers and their captions. On a
   * six-chamber lock the assembly reaches x=1536 and this label starts at 1562, so `SHEAR LINE`
   * and `set every stack here` were drawn into the readout stack — reported as *"force/resistance
   * overlaps with the SHEAR LINE, PUSH TO FEEL also overlaps with SHEAR LINE text"*.
   *
   * The shear line runs the full width of the stage and extends past the body at *both* ends
   * (`ART_DIRECTION.md §4`), so either margin labels it honestly. The mouth end is the one with
   * room: the rotation gauge is down at the keyway, well below this, and the readouts can have the
   * whole of the other side. See DECISIONS D-115.
   */
  const { mouth, sign } = ends(layout)
  const y = mmToY(layout, 0)
  const x = mouth - 26 * sign
  ctx.save()
  text(ctx, 'SHEAR LINE', x, y - 12, {
    font: font(typeFor(vp, TYPE.dimension)),
    color: p.ink,
    align: sign > 0 ? 'right' : 'left',
  })
  text(ctx, 'set every stack here', x, y + 20, {
    font: font(typeFor(vp, TYPE.dimension)),
    color: p.inkLight,
    align: sign > 0 ? 'right' : 'left',
  })
  ctx.restore()
}

/** `KEYWAY`, inside the channel the pick goes down. */
export function drawKeywayLabel(vp: Viewport, p: Palette, layout: CutawayLayout): void {
  const { ctx } = vp
  const { tail, sign } = ends(layout)
  const mid = (mmToY(layout, KEYWAY_FLOOR) + mmToY(layout, KEYWAY_BOTTOM_MM)) / 2
  ctx.save()
  text(ctx, 'KEYWAY', tail - (layout.endPad / 2) * sign, mid + 4, {
    font: font(typeFor(vp, TYPE.dimension)),
    color: alpha(p.inkLight, 0.8),
    align: 'center',
  })
  ctx.restore()
}

/**
 * A margin key naming the three things in a pin stack, each drawn as the drawing draws it.
 *
 * Swatches rather than words alone, because "driver pin" only helps if you can tell which of the
 * two rectangles it means. Drawn at rest — plain steel, no state colour — so the key stays a key
 * and never becomes a second, easier readout of the lock (compare `stateColor`, which is the
 * state channel and stays on the pins).
 */
export function drawAnatomyKey(vp: Viewport, p: Palette, layout: CutawayLayout): void {
  const { ctx } = vp
  const x = keyColumnX(layout)
  const { sign } = ends(layout)
  const align = sign > 0 ? 'left' : 'right'
  const swatchW = 26
  const swatchH = 16
  // Swatch on the side the text reads away from, so neither has to jump the other.
  const sx = sign > 0 ? x : x - swatchW
  const tx = sign > 0 ? x + swatchW + 10 : x - swatchW - 10
  let y = mmToY(layout, SHELL_TOP_MM) + 4

  /**
   * Full ink, not `inkLight` — DECISIONS D-148.
   *
   * These three sit in the margin beside the shell, and the shell is **hatched**: 45° rules at 6px
   * spacing, drawn in `p.rule`. So the ground under a word here is not paper, it is a line the same
   * weight as the word, and `inkLight` against it is **3.92:1** where AA asks for 4.5. Full ink is
   * 9.81 in drafting and 7.24 in blueprint, and it matches this key's own `PIN STACK` heading, which
   * was already drawn that way.
   *
   * The audit found it only at desktop-1920. `sampleGround` reads real pixels, and below full scale
   * the hatching is antialiased into its background, so the median comes back lighter and the run
   * passes. That is a sampling artefact of the check, not of the problem: the contrast is what it is
   * at every size, which is why `palette.test.ts` now asserts it as a number.
   */
  const row = (name: string, paint: () => void): void => {
    paint()
    text(ctx, name, tx, y + swatchH - 4, {
      font: font(typeFor(vp, TYPE.dimension)),
      color: p.ink,
      align,
    })
    y += swatchH + 14
  }

  ctx.save()
  text(ctx, 'PIN STACK', tx, y - 10, {
    font: font(typeFor(vp, TYPE.dimension)),
    color: p.ink,
    align,
  })
  y += 8

  row('spring', () => {
    ctx.beginPath()
    ctx.moveTo(sx, y + swatchH / 2)
    for (let i = 0; i < 4; i += 1) {
      ctx.lineTo(sx + (swatchW * (i + 0.5)) / 4, y + (i % 2 === 0 ? 2 : swatchH - 2))
      ctx.lineTo(sx + (swatchW * (i + 1)) / 4, y + swatchH / 2)
    }
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = p.inkLight
    ctx.stroke()
  })

  row('driver pin', () => {
    ctx.fillStyle = p.steel
    ctx.fillRect(sx, y, swatchW, swatchH)
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.strokeRect(sx, y, swatchW, swatchH)
  })

  row('key pin', () => {
    // Narrower and lighter, with the chamfered top — exactly how `drawKeyPin` draws it.
    const w = swatchW * 0.78
    const ox = sx + (swatchW - w) / 2
    const chamfer = 4
    ctx.beginPath()
    ctx.moveTo(ox + chamfer, y)
    ctx.lineTo(ox + w - chamfer, y)
    ctx.lineTo(ox + w, y + chamfer)
    ctx.lineTo(ox + w, y + swatchH)
    ctx.lineTo(ox, y + swatchH)
    ctx.lineTo(ox, y + chamfer)
    ctx.closePath()
    ctx.fillStyle = mix(p.steel, p.paper, 0.32)
    ctx.fill()
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.stroke()
  })
  ctx.restore()
}

/**
 * Everything in this module, in one call.
 *
 * Skipped entirely for the face-on families (discs, tubulars, sliders), which are not drawn as a
 * pin-stack section and would be labelled with the wrong words.
 */
export function drawAnatomy(
  vp: Viewport,
  p: Palette,
  layout: CutawayLayout,
  state: SimState,
  opts: { skipKey?: boolean } = {},
): void {
  // A key stack with no key pin — a wafer or disc lock — has nothing to name here.
  if (state.chambers.length === 0 || state.chambers[0]?.kind !== 'pin') return
  // No room to annotate a lock that already fills the frame edge to edge.
  if (layout.left < 120 || LOGICAL_WIDTH - layout.right < 120) return
  drawPartNames(vp, p, layout)
  drawKeywayLabel(vp, p, layout)
  drawShearLabel(vp, p, layout)
  // The margin key cedes its column to the drag-to-lift strip while a finger is down (D-160).
  if (!opts.skipKey) drawAnatomyKey(vp, p, layout)
}
