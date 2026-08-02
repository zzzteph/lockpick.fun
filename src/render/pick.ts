/**
 * The pick — ART_DIRECTION.md §5.
 *
 * Drawn as a real tool: a shaft entering from the right along the keyway, ending in a hook
 * whose tip sits under the chamber the player has selected, at the pin's *actual* lift. The
 * gap between where the tip is and where the mouse asked it to be is the force the player is
 * applying, and Phase 3 turns that into the shaft's flex curve.
 */

import type { SimState } from '../sim'
import { HOOK_RISE, KEYWAY_FLOOR, SHAFT_HALF, SHANK_REACH } from '../sim'
import { STROKE, alpha, mix, type Palette } from './palette'
import { mmToPxX, mmToY, plugChamberX, type CutawayLayout } from './layout'
import { type Viewport } from './viewport'

export interface PickRender {
  /** Chamber the tip is under, or -1 when the pick is out of the lock. */
  readonly chamber: number
  /** Where the tip is drawn, in logical px along the keyway. */
  readonly tipX: number
  /** Millimetre height of the tip — normally the pin's lift. */
  readonly tipMm: number
  /** How far the shaft bows, in logical px. Positive bows downward (pin pushing back). */
  readonly flex: number
}

/**
 * The height the hook's tip rests at, at an arbitrary point along the keyway.
 *
 * Directly beneath a chamber this is that chamber's **key pin** — the lower of the two bodies in
 * the stack, and the only one the pick can ever touch. Between two chambers it is interpolated,
 * because a hook dragged along a keyway rides across the bottoms of the key pins rather than
 * jumping between them.
 *
 * It read `c.lift`, the *driver*, which was the same number until the stack was split into two
 * bodies (D-042). After that, every captured chamber — driver held up at the shear line, key pin
 * fallen back onto the pick — drew the hook a millimetre and a half up inside the key pin it was
 * supposed to be resting under. Visible in `phase-03-mid-lift.png`, invisible to every test in
 * the suite, because nothing asserts what the pick is touching.
 */
function tipLiftAt(state: SimState, layout: CutawayLayout, x: number): number {
  const chambers = state.chambers
  if (chambers.length === 0) return 0
  let left = 0
  for (let i = 0; i < chambers.length; i += 1) {
    if (plugChamberX(layout, i) <= x) left = i
  }
  const right = Math.min(chambers.length - 1, left + 1)
  const lx = plugChamberX(layout, left)
  const rx = plugChamberX(layout, right)
  const a = chambers[left]?.keyLift ?? 0
  const b = chambers[right]?.keyLift ?? 0
  if (right === left || rx === lx) return a
  const t = Math.min(1, Math.max(0, (x - lx) / (rx - lx)))
  return a + (b - a) * t
}

/**
 * Where the pick tip actually is, given the sim state.
 *
 * Drawn at `state.pickPosition` — the simulation's own **continuous** position along the keyway
 * (D-045) — interpolated between the two chambers it lies between, so the tip slides visibly and
 * rides over the key pins as it goes.
 *
 * Two earlier versions of this were both wrong, in opposite directions. The first snapped to the
 * selected chamber's centre, which made the pick *teleport* from pin to pin: the largest, most
 * continuous input in the game was the one thing the picture did not show (D-039). The second
 * drew it at the mouse pointer, which was smooth but was the *hand* rather than the tool, and
 * became meaningless the moment the mouse stopped being a picking input (D-059). The sim's own
 * position is both smooth and true, and it is the same for every input scheme.
 */
export function pickRender(
  state: SimState,
  layout: CutawayLayout,
  flex = 0,
  /**
   * How high the player is currently asking the tip to go, in mm of lift. Infinity when unknown.
   *
   * The tip rides the key pin **only while it is under one**. A magnetically held pin stays up on
   * its own (`MAGNETIC_RETURN` is a crawl by design, D-066) — and because the tip was drawn at the
   * key pin's height unconditionally, letting go of the lift left the pick hanging in the air
   * against the underside of a pin it was no longer touching. Reported as *"with magnetic pins, you
   * lift it and release the pressure and the lockpick is still glued to the pin."*
   *
   * The sim was right and the drawing was wrong: it is a `min`, not a follow. Lower your hand and
   * the tip comes down; the pin stays where the magnet holds it, which is the whole tell.
   * See DECISIONS D-101.
   */
  askedMm = Number.POSITIVE_INFINITY,
): PickRender {
  if (state.pickChamber < 0 || state.pickPosition < 0) {
    return { chamber: -1, tipX: 0, tipMm: KEYWAY_FLOOR, flex }
  }
  const last = state.chambers.length - 1
  const at = Math.min(Math.max(state.pickPosition, 0), last)
  const lo = Math.floor(at)
  const hi = Math.min(last, lo + 1)
  const loX = plugChamberX(layout, lo)
  const tipX = hi === lo ? loX : loX + (plugChamberX(layout, hi) - loX) * (at - lo)
  return {
    chamber: state.pickChamber,
    tipX,
    tipMm: KEYWAY_FLOOR + Math.min(tipLiftAt(state, layout, tipX), Math.max(0, askedMm)),
    flex,
  }
}

/** One sample along the tool's centreline: where it is, and how thick it is there. */
interface Rib {
  readonly x: number
  readonly y: number
  /** Half the steel's thickness at this point, in logical px. */
  readonly half: number
}

/** Sample a quadratic Bézier, tapering the thickness linearly along it. */
function ribs(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  halfFrom: number,
  halfTo: number,
  steps: number,
  skipFirst = false,
): Rib[] {
  const out: Rib[] = []
  for (let i = skipFirst ? 1 : 0; i <= steps; i += 1) {
    const t = i / steps
    const u = 1 - t
    out.push({
      x: u * u * x0 + 2 * u * t * cx + t * t * x1,
      y: u * u * y0 + 2 * u * t * cy + t * t * y1,
      half: halfFrom + (halfTo - halfFrom) * t,
    })
  }
  return out
}

/** A point on the tool, in logical px. */
export interface ToolPoint {
  readonly x: number
  readonly y: number
}

/** Where the tool's four defining points end up once it is placed in the lock. */
export interface HookGeometry {
  /** Where the throat leaves the shaft and begins to climb. */
  readonly knee: ToolPoint
  /** Where the throat rounds over into the bearing flat. */
  readonly flatStart: ToolPoint
  /** The crest — the flat that bears on a key pin. Always exactly at the tip. */
  readonly crest: ToolPoint
  /** The ground point, just past the chamber centre. */
  readonly point: ToolPoint
  /** How far the tool is tilted, in radians. Zero with the pick lying in the keyway. */
  readonly theta: number
}

/**
 * Horizontal run of the throat, the bearing flat, and the ground point beyond the tip — millimetres.
 *
 * Each piece gets its **own** number rather than a fraction of one width. The first version scaled
 * throat, flat and point off a single `hookW`, which was harmless while that was `keyPinWidth *
 * 0.62` (0.88mm) and absurd the moment it became a real 2.2mm throat: the ground point alone jutted
 * 1.45mm past the chamber centre and the bearing flat ran longer than the rise, so the tool read as
 * a shelf on a stick. A short hook is roughly 1.9mm of rise, 1.1mm of flat and half a millimetre of
 * point, and those are three independent measurements.
 */
/**
 * How far the hook runs along the keyway, from where it leaves the shaft to its point.
 *
 * The hook is one sweep of this length, not three joined segments. It used to be a neck, a bearing
 * flat and a point — which put a horizontal run at the top of the tool directly above the shaft's
 * horizontal run, joined by a rise. Two parallel lines offset vertically read as exactly what they
 * are: *"again the shape of an S, but not the hook."*
 */
export const HOOK_REACH_MM = 2.2

/**
 * How thick the steel is, in millimetres of **half**-profile — DECISIONS D-142.
 *
 * A pick is a strip milled from a blank: something over a millimetre tall through the body, ground
 * away toward the tip until it is fine enough to slip past a key pin. These were bare pixel
 * constants — 4.2 falling to 0.2 — which at this scale is a fifth of a millimetre of steel, and the
 * tool read as *"toooo thin like a bobbypin"*. In millimetres they are dimensions of a tool rather
 * than a line weight, and they scale with the lock like everything else the tool is made of.
 *
 * The taper is the shape of the thing: heavy through the shaft where a pick is stiff, narrowing
 * through the throat where it has to fit a keyway, and ground almost to nothing at the point.
 */
export const STEEL_HANDLE_MM = 0.52
/** Shared with the simulation, which rests pins on the top of this bar (D-149). */
export const STEEL_KNEE_MM = SHAFT_HALF
export const STEEL_NECK_MM = 0.28
export const STEEL_FLAT_MM = 0.22
export const STEEL_POINT_MM = 0.035
/**
 * How far the crest stands above the knee — the height a short hook is ground to.
 *
 * Briefly this was derived from the keyway's depth, which was neat and wrong: it made the tool a
 * function of the slot rather than a tool, and when the slot turned out to be drawn too shallow
 * (`KEYWAY_BOTTOM_MM`) the hook inherited the mistake. They are two independent measurements that
 * merely have to be compatible — the rise must fit inside the depth — and `hook.test.ts` asserts
 * exactly that relationship rather than an equality.
 *
 * 2.3mm also covers the roster: every lock in the game asks for between 0.80mm and 2.30mm of lift,
 * so the knee stays down in the keyway for the whole of ordinary play. The tool has to fit the slot
 * *including its own steel*, which is what pulled this back from 2.6mm when the pick was given a
 * real thickness — `hook.test.ts` measures the bottom edge, not the centreline.
 */
export const HOOK_RISE_MM = HOOK_RISE

/**
 * The hook hangs off the **tip**, and it keeps its shape — DECISIONS D-140.
 *
 * The first version hung it off the keyway instead: the knee sat at the keyway centre and the crest
 * was `Math.max(tipY, kneeY - hookRise)`, a *fixed* height 3.45mm below the shear line. Up to about
 * 1.55mm of lift the crest tracked the tip and it looked like a hook. Past that the crest stopped
 * rising while the tip kept going, so the throat stretched vertically — reported as *"the end of the
 * hook becomes bigger and bigger when I press space, like some weird snake."* It is also why the
 * redraw looked at first like no change at all: at rest the two constructions are identical, so the
 * shape only diverged once the pick was lifted.
 *
 * A hook is a rigid piece of steel. The crest **is** the tip — that flat is what bears on the key
 * pin — and the knee sits its own rise below, so the whole shape translates and never deforms. The
 * one thing that may move it is the keyway floor: a pick cannot sink through the bottom of the slot.
 *
 * Pulled out of `drawPick` so it can be asserted rather than eyeballed. A tool that silently changes
 * shape is exactly the class of bug this project keeps shipping, and a picture is the one thing the
 * test suite could not see.
 */
/**
 * How far outside the lock the hand holds the tool, in logical px — the centre of the rotation.
 *
 * A pick does not pivot at the keyway mouth. It pivots roughly where it is held, which is a long way
 * outside the lock, and that lever length is the whole reason a real pick tilts by a couple of
 * degrees instead of swinging. Pivoting at the lock face here would need **36° to 52°** to reach the
 * front chamber at full lift, which is not a lock being picked, it is a lever being thrown. At this
 * reach the same movement is 3° to 11°.
 *
 * **Measured in chamber pitches from chamber 0, and shared with the simulation** — DECISIONS D-149.
 * It was 620 logical px measured from the lock *face*, while `shankLift` measured the same lever
 * from chamber 0: two origins differing by the end pad and half a pitch, so the line the tool was
 * drawn along and the line pins were held on were never quite the same one. A pixel reach was wrong
 * on its own terms too — a squeezed 12-pin lock draws at 0.46 scale, so a fixed 620px is twice the
 * lever there that it is on a 5-pin lock.
 */
function handPivotX(layout: CutawayLayout): number {
  return plugChamberX(layout, 0) - SHANK_REACH * layout.pitch * (layout.mirrored ? -1 : 1)
}

/**
 * The pick is a **rigid body**. It changes angle; it never changes shape — DECISIONS D-141.
 *
 * Two versions of this drew the tool as curves whose endpoints were pinned to the lock, so lifting a
 * pin *reshaped* the tool rather than moving it: first the hook stretched (D-140), then the shaft
 * remained a quadratic whose far end tracked the knee, so it bent differently at every height.
 * Reported as *"the lockpick itself BENDS, and its hook becomes bigger or smaller — we must emulate
 * like a REAL METAL LOCKPICK is moving, not that some of its parts become longer and bigger by
 * magic."*
 *
 * So the silhouette is built once, in tool-local millimetres, and placed with a rotation and a
 * translation. Nothing downstream can deform it: a rigid transform preserves every distance in the
 * shape by construction, which is a much stronger guarantee than any amount of care with control
 * points. The crest lands exactly on the pin, because that is the one thing that has to be true.
 *
 * The angle comes from how far the crest has risen above its resting height, over the lever from the
 * hand. At zero lift that is zero and the tool lies flat along the keyway floor.
 */
export function pickAngle(layout: CutawayLayout, tipX: number, tipY: number): number {
  const restY = mmToY(layout, KEYWAY_FLOOR)
  return Math.atan2(restY - tipY, Math.abs(tipX - handPivotX(layout)))
}

/**
 * Place a tool-local point (x runs into the lock, y runs down, origin at the crest) into the lock.
 *
 * Millimetres scale by the lock's own two scales — along the keyway by `mmToPxX`, in height by
 * `mmToPx` — so the tool is drawn at the same scale as the lock around it however squeezed that
 * lock is (D-141). Rotation happens after, in px, which is the same anisotropy every pin in the
 * picture already has.
 */
export function placeOnTool(
  layout: CutawayLayout,
  tipX: number,
  tipY: number,
  sign: number,
  theta: number,
  mmAlong: number,
  mmUp: number,
): ToolPoint {
  const x = mmAlong * mmToPxX(layout)
  const y = -mmUp * layout.mmToPx
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  return {
    x: tipX + sign * (x * cos + y * sin),
    y: tipY + (-x * sin + y * cos),
  }
}

/**
 * Where each landmark sits along the tool, measured from the **point** — DECISIONS D-142.
 *
 * The origin used to be the crest, which put the ground point half a millimetre *past* the chamber
 * centre and the whole bearing flat behind it, so the hook engaged the pin off to one side.
 * Reported as the hook needing to *"point in the middle of the pin"*. The point is the end of the
 * tool and the part a picker aims, so it is the end that gets aimed: it lands on the chamber centre
 * and the flat that carries the pin sits immediately behind it, still well within the pin's width.
 *
 * These are the tool's **outline** — the top edge, which is the surface that touches a key pin.
 * `drawPick` drops each rib's centreline by its own half-thickness so that edge stays the contact.
 */
export const POINT_AT = 0
export const CREST_AT = -HOOK_REACH_MM * 0.16
export const FLAT_AT = -HOOK_REACH_MM * 0.45
export const KNEE_AT = -HOOK_REACH_MM
/**
 * Where the hook's single curve is pulled toward — and the whole difference between a hook and an S.
 *
 * It sits **forward, at the shaft's height**: the curve therefore leaves the knee running level
 * along the bottom of the keyway and only sweeps up as it reaches the point. That is a hook —
 * concave on the side that scoops under a pin, tip highest, nothing above the shaft until the very
 * end. The control point used to sit *above* the knee, which makes the curve rise first and then run
 * flat, and a flat top above a flat shaft is an S however sharply the two are joined (D-142's
 * "corner" was the same mistake made crisper).
 */
export const HOOK_CONTROL_AT = -HOOK_REACH_MM * 0.2

/** The tool's defining points, placed in the lock. */
export function hookGeometry(
  layout: CutawayLayout,
  tipX: number,
  tipY: number,
  sign: number,
): HookGeometry {
  const theta = pickAngle(layout, tipX, tipY)
  const at = (mmAlong: number, mmUp: number): ToolPoint =>
    placeOnTool(layout, tipX, tipY, sign, theta, mmAlong, mmUp)
  return {
    knee: at(KNEE_AT, -HOOK_RISE_MM),
    flatStart: at(FLAT_AT, 0),
    crest: at(CREST_AT, 0),
    point: at(POINT_AT, 0),
    theta,
  }
}

/**
 * A pick is a **shape**, not a line: a strip of spring steel milled from thick at the handle to a
 * tip fine enough to slip past a key pin, and it has two edges you can see.
 *
 * So it is drawn as a closed silhouette — up one side of the centreline and back down the other,
 * offsetting each sample along its own normal — filled with steel, outlined in ink, with a
 * highlight run along the upper edge where a round-backed piece of steel catches the light.
 *
 * Stroking a path with a varying `lineWidth` cannot do this: canvas has one width per stroke, so
 * the previous attempt drew the shaft in three fixed-width pieces, and three quadratics that each
 * added their own sag produced a visible wave down a tool that is supposed to be straight.
 */
function drawSteel(ctx: CanvasRenderingContext2D, p: Palette, path: Rib[]): void {
  if (path.length < 2) return
  const normalAt = (i: number): { nx: number; ny: number } => {
    const a = path[Math.max(0, i - 1)]
    const b = path[Math.min(path.length - 1, i + 1)]
    if (!a || !b) return { nx: 0, ny: -1 }
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    // Left-hand normal, which for a shaft running along the keyway points up the page.
    return { nx: dy / len, ny: -dx / len }
  }

  ctx.beginPath()
  for (let i = 0; i < path.length; i += 1) {
    const r = path[i]
    if (!r) continue
    const { nx, ny } = normalAt(i)
    const x = r.x + nx * r.half
    const y = r.y + ny * r.half
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const r = path[i]
    if (!r) continue
    const { nx, ny } = normalAt(i)
    ctx.lineTo(r.x - nx * r.half, r.y - ny * r.half)
  }
  ctx.closePath()
  ctx.fillStyle = p.steel
  ctx.fill()
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.stroke()

  // Highlight down the lit edge, inset so it reads as a rounded back rather than a second outline.
  ctx.beginPath()
  for (let i = 0; i < path.length; i += 1) {
    const r = path[i]
    if (!r) continue
    const { nx, ny } = normalAt(i)
    const inset = Math.max(0, r.half - 1.2)
    const x = r.x + nx * inset
    const y = r.y + ny * inset
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = alpha(mix(p.steel, p.paper, 0.8), 0.85)
  ctx.stroke()
}

export function drawPick(
  vp: Viewport,
  p: Palette,
  layout: CutawayLayout,
  render: PickRender,
): void {
  if (render.chamber < 0) return
  const { ctx } = vp
  const tipX = render.tipX
  const tipY = mmToY(layout, render.tipMm)
  /**
   * The shaft lies in the keyway and exits **left**, because that is the end the keyway opens
   * at — and therefore the end chamber 0 is at.
   *
   * It used to exit right, which put the keyway mouth at the opposite end of the lock from the
   * chambers a short hook can reach. `effectiveReach` counts "chambers in from the mouth" and
   * allows `0..reach-1`, so with the drawing mirrored the pick appeared to stretch across the
   * whole lock, past pins it could not touch, to grab the far ones. Pin 1 is the front pin in
   * every lock ever made; the drawing now agrees. See DECISIONS D-044.
   */
  // Just outside the lock body, not at the screen edge: the handle is off-stage either way, and
  // a shaft drawn all the way to the margin runs straight through the rotation gauge.
  // Whichever end the keyway opens at (D-047). sign flips the hook with it.
  const sign = layout.mirrored ? -1 : 1
  const entryX = layout.mirrored ? layout.right + 26 : layout.left - 26

  /**
   * The hook has its **own** dimensions, in millimetres — DECISIONS D-138.
   *
   * It used to be `keyPinWidth * 0.62` wide and nothing else: a stub scaled to the hole it sits
   * in rather than a tool with a shape. Reported as *"a lockpick is a hook, but here we have
   * something different that fits inside the space where the pin sits"*, which is exactly what
   * deriving a tool's geometry from the lock's geometry produces. `hookGeometry` owns those
   * numbers now, and the whole tool is placed as a rigid body (D-141).
   */
  const theta = pickAngle(layout, tipX, tipY)
  /**
   * The silhouette, laid out **once** in tool-local millimetres and then placed.
   *
   * `along` runs into the lock and `up` runs out of the keyway, both measured from the **point** —
   * the end of the tool, and the end a picker aims (D-142). Every curve is described here in the
   * tool's own frame, so no endpoint is pinned to the lock and nothing in the picture can pull the
   * shape around. A rigid transform preserves every distance in it, which is why the hook cannot
   * grow however far the pin is lifted (D-140, D-141).
   *
   * `edge` places a rib by the tool's **top** surface, dropping its centreline by its own half
   * thickness. That edge is what bears on a key pin, and once the steel had a real thickness the
   * difference stopped being cosmetic: laying the centreline on the pin buried a third of a
   * millimetre of tool inside it.
   *
   * How far the shaft is drawn is the one thing the lock decides: enough to reach the mouth and a
   * little past it. The handle is off-stage either way, and a shaft drawn to the screen edge runs
   * straight through the rotation gauge.
   */
  const at = (along: number, up: number): ToolPoint =>
    placeOnTool(layout, tipX, tipY, sign, theta, along, up)
  const edge = (along: number, up: number, half: number): ToolPoint => at(along, up - half)
  const backMm = (Math.abs(tipX - entryX) + 12) / mmToPxX(layout)
  const px = (mm: number): number => mm * layout.mmToPx
  const bar = (
    a: ToolPoint,
    c: ToolPoint,
    b: ToolPoint,
    from: number,
    to: number,
    steps: number,
    skipFirst = false,
  ): Rib[] => ribs(a.x, a.y, c.x, c.y, b.x, b.y, from, to, steps, skipFirst)

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  /**
   * One continuous piece of steel: a straight shaft, the throat that climbs out of the keyway, and
   * the flat that bears on the pin. Thickness runs 4.2px at the handle to 0.2px at the point.
   *
   * **The shaft is dead straight and the tool changes angle**, which is what a real pick does: it is
   * a rigid strip of spring steel, and lifting a pin turns it about the hand rather than bending it.
   * Two earlier versions bowed it — first across its whole length, which read as *"some weird
   * spring"*, then across the last stretch, which still meant the tool was a different shape at
   * every height. `flex` no longer touches the drawing at all; the load already reads in the gap
   * between the target marker and the tip, which is a truer signal because it is the simulation's.
   *
   * This supersedes ART_DIRECTION.md §5's *"bent as a real curve, never rotated"*: asked for
   * directly, twice, and right — *"it must change the angle and we must emulate like a REAL METAL
   * LOCKPICK is moving."* See DECISIONS D-141.
   */
  const knee = at(KNEE_AT, -HOOK_RISE_MM)
  const shaft = bar(
    at(-backMm, -HOOK_RISE_MM),
    at((-backMm + KNEE_AT) / 2, -HOOK_RISE_MM),
    knee,
    px(STEEL_HANDLE_MM),
    px(STEEL_KNEE_MM),
    14,
  )
  /**
   * The hook: **one sweep**, running level out of the shaft and rising only at the end.
   *
   * This was three pieces — a neck, a bearing flat and a point — which put a horizontal run at the
   * top of the tool directly above the shaft's horizontal run with a rise between them. Two parallel
   * lines offset vertically are an S whatever you do to the join, and sharpening that join into a
   * corner (D-142) only made a crisper S. Reported exactly: *"it's again the shape of S, but not the
   * hook."*
   *
   * A hook is **concave** on the face that scoops under a pin. So it is a single quadratic pulled
   * toward a control point that sits forward at the shaft's own height: the curve leaves the knee
   * running along the bottom of the keyway, carries most of its length there, and turns up hard into
   * the point. Nothing stands above the shaft until the very end, which is what makes it read as a
   * finger reaching up rather than a shelf sitting on a stick.
   *
   * The taper runs the whole sweep, thickest where it leaves the shaft and ground almost to nothing
   * at the tip — a real hook is one continuous piece of steel and does not change section in steps.
   */
  const hook = bar(
    knee,
    at(HOOK_CONTROL_AT, -HOOK_RISE_MM),
    edge(POINT_AT, 0, STEEL_POINT_MM),
    px(STEEL_KNEE_MM),
    px(STEEL_POINT_MM),
    18,
    true,
  )
  drawSteel(ctx, p, [...shaft, ...hook])
  ctx.restore()
}

/**
 * A faint marker showing where the mouse is asking the tip to go. The distance between this
 * and the tip is the resistance made visible.
 */
export function drawPickTarget(
  vp: Viewport,
  p: Palette,
  layout: CutawayLayout,
  chamber: number,
  targetMm: number,
  atX?: number,
): void {
  if (chamber < 0) return
  const { ctx } = vp
  // Drawn where the tip is drawn, so the gap between the marker and the tip reads as one
  // vertical distance rather than as two things in different places.
  const x = atX ?? plugChamberX(layout, chamber)
  const y = mmToY(layout, KEYWAY_FLOOR + targetMm)
  ctx.save()
  ctx.strokeStyle = p.inkLight
  ctx.lineWidth = STROKE.hairline
  ctx.setLineDash([3, 5])
  ctx.beginPath()
  ctx.moveTo(x - layout.driverWidth * 0.8, y)
  ctx.lineTo(x + layout.driverWidth * 0.8, y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}
