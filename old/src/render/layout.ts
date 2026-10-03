/**
 * Cutaway layout — pure geometry, no canvas.
 *
 * Everything the renderer draws is positioned by this module, and because it touches no
 * drawing API it can be asserted numerically against sim state (PHASES.md Phase 2:
 * "Rendered pin positions match sim state — asserted numerically, not by eye").
 *
 * Coordinates are the fixed 1920x1080 logical space from `viewport.ts`. Millimetres come
 * from the sim, where `y = 0` is the shear line and positive `y` is up.
 */

import {
  DRIVER_LENGTH,
  KEYWAY_FLOOR,
  MAX_OVERLIFT,
  THETA_OPEN,
  clamp,
  clamp01,
  type Chamber,
} from '../sim'
import { LOGICAL_WIDTH } from './viewport'

/** The shear line sits a little above centre, leaving the HUD its band along the bottom. */
export const SHEAR_Y = 500
/**
 * Vertical scale. Fixed for every lock so lift always reads the same.
 *
 * 44, down from 46, to pay for a footer that grew from 116 to 140 when the type scale went up
 * (D-102). At 46 the plug's bottom edge landed at y=932 against a footer panel starting at 916, so
 * the last 16px of the assembly was drawn *underneath* it. Four per cent off the drawing is the
 * cheapest thing on this screen to give up: the alternative was moving the shear line up, which
 * walks the top of the assembly into the rank countdown at the other end.
 */
export const MM_TO_PX = 44
/**
 * ART_DIRECTION.md §4 — the **most** of the width the assembly may take, whatever the pin count.
 *
 * It used to be the width the assembly always took, and that was the bug. Dividing a fixed span
 * by the pin count makes the *pitch* a function of how many pins there are: a 3-pin lock got
 * chambers 2.4 diameters apart, a 12-pin got them touching. No lock is built that way — every
 * pin-tumbler cylinder in the world is drilled on one spacing, and the number of pins changes
 * how *long* the lock is, not how far apart its chambers sit.
 *
 * The visual cost was severe: acres of plug between pins, so the pin stacks read as isolated
 * diagrams rather than as one mechanism, and a hook dragged along the keyway travelled through
 * emptiness between them. The spec's stated reason — "a 3-pin and a 12-pin lock feel like the
 * same instrument at different scales" — is exactly backwards. They *are* the same instrument at
 * the same scale, and different lengths. See DECISIONS D-049.
 */
export const ASSEMBLY_FRACTION = 0.6

/**
 * Real chamber spacing and real pin diameter, in millimetres.
 *
 * 0.150" pitch and 0.115" pins: the dimensions almost every American pin-tumbler is built to,
 * and the reason a real cutaway shows pins that very nearly touch — 0.9mm of brass between one
 * bore and the next. The ratio between these two numbers is the whole point; their absolute
 * values only set how big the drawing is before it has to be squeezed to fit.
 */
export const CHAMBER_PITCH_MM = 3.81
export const PIN_DIAMETER_MM = 2.92
/** ≈1.30. Preserved at every pin count, which is the property that matters. */
export const PITCH_TO_DIAMETER = CHAMBER_PITCH_MM / PIN_DIAMETER_MM

/**
 * Solid brass past the outermost bore, at each end of the body.
 *
 * This is what a short lock is padded out with, rather than with wider pin spacing. A real
 * cylinder has a face at the keyway end and a tail behind the last chamber; drawing them means a
 * 3-pin lock can fill a reasonable part of the frame while its chambers stay 3.81mm apart, and it
 * gives the part labels somewhere to point at that is not a pin.
 */
export const BODY_END_MM = 2.6

/**
 * How much spring is left when a spring is fully compressed — its solid height.
 *
 * A coil spring stops being a spring when its coils touch. Nothing can occupy that last third of a
 * millimetre of chamber, which makes it part of the chamber's depth rather than a detail.
 */
export const SPRING_SOLID_MM = 0.3

/**
 * The shell chamber is **as deep as the things that have to fit inside it** — DECISIONS D-144.
 *
 * A driver pushed to full overlift stands `MAX_OVERLIFT + DRIVER_LENGTH` above the shear line, and
 * its spring still needs its solid height above that. This was a flat 5.9mm against a requirement of
 * 7.0mm, so **every** chamber in the game drew its driver 0.6mm out through the top of its own bore
 * once a pin was pushed that far — and the spring above it inverted, its span having gone negative.
 *
 * Reported as *"the pin will jump out of the shell for a second"*, with an exact recipe: hold the
 * wrench, overset the pin, keep pushing, then release both at once. Nothing transient about it — the
 * geometry never had room, and that recipe is simply the way to reach the top of the range.
 *
 * Derived rather than chosen, so it cannot fall behind the constants it depends on again.
 */
export const SHELL_CHAMBER_TOP_MM = MAX_OVERLIFT + DRIVER_LENGTH + SPRING_SOLID_MM
/** Enough brass above the deepest bore to read as a shell rather than a rim. */
export const SHELL_TOP_MM = SHELL_CHAMBER_TOP_MM + 0.3
/**
 * How deep the plug is drawn, in mm below the shear line.
 *
 * Raised from 7.4 to 9.4 — the plug is 432px tall instead of 340. It is the body whose *rotation*
 * is the entire state of the lock, and it was the smallest thing on the drawing.
 *
 * 9.4 is the frame's limit, not a preference: the band between the header and the footer is 852px,
 * the shell above the shear line takes 294 of it, and the rank letter needs the strip above the
 * assembly. Going further means giving up the footer or the rank. See DECISIONS D-096.
 */
export const PLUG_BOTTOM_MM = -9.4
/**
 * How far a key pin at rest hangs out of its bore into the keyway.
 *
 * 0.6mm — enough to read as a pin standing proud of its hole at a glance, small enough that the
 * bore still visibly holds it.
 */
export const BORE_LIP_MM = 0.6
/**
 * The keyway's ceiling, which is **above** the pins' resting bottoms — DECISIONS D-141.
 *
 * It used to be `KEYWAY_FLOOR` exactly, so every pin sat flush in its hole above a perfectly flat
 * floor running the length of the lock. That is not what a cylinder looks like and it is not how one
 * works: the springs push each stack down until the key pin **protrudes into the slot**, and that
 * protrusion is the whole mechanism — it is the only part of the lock a key ever touches, and the
 * only part a pick can reach. A pin sitting flush would jam a key rather than be lifted by it.
 *
 * Raising the ceiling rather than lowering the pins is deliberate. `KEYWAY_FLOOR` is the datum every
 * height in the simulation is measured from — `setLift`, the capture window, where the shear line
 * falls across a stack — so moving the pins would move the one relationship the whole game is
 * about. The void around them moves instead, and nothing the player is reading changes.
 *
 * Reported as *"make the key pins a bit out of their shafts"*.
 */
export const KEYWAY_TOP_MM = KEYWAY_FLOOR + BORE_LIP_MM
/**
 * How deep the keyway slot is drawn — 3.0mm below the pins, not 1.9mm.
 *
 * A keyway is not a letterbox. On a 12.7mm plug it is a deep slot running most of the way to the
 * plug's axis, and it has to be, because the thing that goes in it is a key: a 1.9mm slot could not
 * physically admit one whose cuts lift a pin 4mm.
 *
 * That shallowness only became visible once the pick was drawn as a rigid body (D-141). A straight
 * tool angled up to a raised hook has to *fit* somewhere on its way to the mouth, and with 1.9mm of
 * slot against lifts of up to 4mm it had nowhere to go but through the plug. Deepening it is the
 * honest fix and an improvement on its own; the plug still keeps 1.4mm of brass beneath.
 */
export const KEYWAY_BOTTOM_MM = -8.0

/**
 * How far the plug's bore slides sideways, as a fraction of the driver width, at full
 * rotation. See `ledgeOffset` for why this is exaggerated.
 */
/**
 * How far the plug's bores slide against the shell's at full rotation, as a fraction of pin width.
 *
 * Raised from 0.62 to 0.8. In a section view this slide *is* the rotation — there is no other cue,
 * because a plug seen in section is a rectangle however far it has turned — so it has to be the
 * loudest thing on the drawing rather than a subtlety. Reported from play as "it's very hard to see
 * its rotation". See DECISIONS D-096.
 */
export const LEDGE_MAX_FRACTION = 0.8
const LEDGE_CURVE = 0.45

export interface CutawayLayout {
  readonly chamberCount: number
  /** 1 for everything except the twin-row dimple. */
  readonly rows: number
  /** Chambers per row. */
  readonly perRow: number
  readonly shearY: number
  readonly mmToPx: number
  /** Left edge of the assembly, logical px. */
  readonly left: number
  readonly right: number
  /** Distance between chamber centres, logical px. Real spacing at every pin count (D-049). */
  readonly pitch: number
  /** Solid body past the outermost bore at each end, logical px. */
  readonly endPad: number
  readonly driverWidth: number
  readonly keyPinWidth: number
  /** Lateral slide of the plug's bores relative to the shell's, logical px. */
  readonly ledgeOffset: number
  /** Plug rotation in radians, as the sim reports it. */
  readonly theta: number
  /**
   * True when the keyway opens on the **right** and the whole cutaway is mirrored.
   *
   * Handedness lives here, in the one function that turns a chamber index into an x — so
   * mirroring the lock is a single sign flip and nothing else in the game learns about it.
   * Chamber 0 is still the front pin, reach still runs from the mouth inward, and the
   * simulation is not told which way round it is being drawn. See DECISIONS D-047.
   */
  readonly mirrored: boolean
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * The plug's rotation, expressed as the sideways slide of its chambers relative to the
 * shell's.
 *
 * Physically this is arc length at the bore radius, `θ × r`, which for a per-pin take-up of
 * δ ≈ 0.005 rad works out at 0.025mm — about one screen pixel. The single most important
 * thing this view has to communicate is *the plug just took up rotation, that pin is set*,
 * so the mapping is deliberately non-linear: a power curve that lifts small take-ups into
 * visibility while still saturating at full rotation. The honest angle is shown, unexaggerated,
 * by the rotation gauge and its numeric readout. See DECISIONS D-017.
 */
export function ledgeOffset(theta: number, driverWidth: number): number {
  const t = clamp01(theta / THETA_OPEN)
  return LEDGE_MAX_FRACTION * driverWidth * Math.pow(t, LEDGE_CURVE)
}

export function computeLayout(
  chamberCount: number,
  theta: number,
  rows = 1,
  mirrored = false,
): CutawayLayout {
  const rowCount = Math.max(1, rows)
  const perRow = Math.ceil(Math.max(1, chamberCount) / rowCount)
  // True scale by preference, squeezed only when the lock is too long for the frame. A 5-pin
  // lock is drawn shorter than a 12-pin lock because it *is* shorter; both keep real spacing.
  const endPad = BODY_END_MM * MM_TO_PX
  const chamberBudget = LOGICAL_WIDTH * ASSEMBLY_FRACTION - endPad * 2
  const pitch = Math.min(CHAMBER_PITCH_MM * MM_TO_PX, chamberBudget / perRow)
  const width = pitch * perRow + endPad * 2
  const left = (LOGICAL_WIDTH - width) / 2
  // Derived from the pitch, so squeezing a long lock narrows the pins with it and the gutter
  // between bores stays the same slim strip of brass it is in a real cylinder.
  const driverWidth = Math.max(18, pitch / PITCH_TO_DIAMETER)
  return {
    endPad,
    chamberCount,
    rows: rowCount,
    perRow,
    shearY: SHEAR_Y,
    mmToPx: MM_TO_PX,
    left,
    right: left + width,
    pitch,
    driverWidth,
    // Key pins are slightly narrower with a chamfered top (ART_DIRECTION.md §4).
    keyPinWidth: driverWidth * 0.78,
    ledgeOffset: ledgeOffset(theta, driverWidth),
    theta,
    mirrored,
  }
}

/** Horizontal stagger applied to a row, so two rows read as two rows. */
const ROW_STAGGER = 0.34

/** Which row a chamber index belongs to — must match `createSimState`. */
export function rowOf(layout: CutawayLayout, i: number): number {
  return layout.rows > 1 ? i % layout.rows : 0
}

/** Row 1 is drawn recessed: hairline weight in `Ink light`, the drafting way to say "behind". */
export function isRecessed(layout: CutawayLayout, i: number): boolean {
  return rowOf(layout, i) > 0
}

/** Millimetres above the shear line -> logical y. Positive mm is up, so y decreases. */
export function mmToY(layout: CutawayLayout, mm: number): number {
  return layout.shearY - mm * layout.mmToPx
}

/**
 * Logical px per millimetre **along** the lock — which is not `mmToPx` once a lock is squeezed.
 *
 * `computeLayout` fits long locks to the frame by shrinking the pitch: a 12-pin cylinder draws at
 * 76.9px per 3.81mm against a true 167.6px, so everything horizontal — bores, pins, the gutters
 * between them — is at 0.46 scale while heights stay true. Anything else drawn along the keyway has
 * to agree with that or it is simply drawn at a different scale from the lock it sits in.
 *
 * The pick did exactly that: its hook was fixed in millimetres at the *vertical* scale, so it came
 * out 0.87× the pin width on a 5-pin lock and 1.9× on a 12-pin one. Reported as *"for every lock,
 * the hooks should be the same"* — and they were the same absolute size, which is precisely the bug.
 * The tool has to be the same size **as the lock around it**. See DECISIONS D-141.
 */
export function mmToPxX(layout: CutawayLayout): number {
  return layout.pitch / CHAMBER_PITCH_MM
}

/** Logical y -> millimetres above the shear line. */
export function yToMm(layout: CutawayLayout, y: number): number {
  return (layout.shearY - y) / layout.mmToPx
}

/** Centre of chamber `i`'s bore in the shell, which never moves. */
export function shellChamberX(layout: CutawayLayout, i: number): number {
  const row = rowOf(layout, i)
  const col = layout.rows > 1 ? Math.floor(i / layout.rows) : i
  const stagger = ((row - (layout.rows - 1) / 2) * layout.pitch * ROW_STAGGER) / 1
  const x = layout.left + layout.endPad + layout.pitch * (col + 0.5) + stagger
  return layout.mirrored ? layout.left + layout.right - x : x
}

/**
 * Bores are drilled a little wider than the pins that ride in them — as a *fraction* of the pin,
 * not a flat number of pixels.
 *
 * A 0.115" pin runs in a 0.125" bore: 0.005" of clearance a side, about 4% of the diameter. As a
 * flat 5px it was 4% of a fat 5-pin driver and 7% of a squeezed 12-pin one, which ate the gutter
 * between bores on exactly the locks that had least of it to spare (D-049).
 */
export const BORE_CLEARANCE = 0.043

export function boreWidth(layout: CutawayLayout): number {
  return layout.driverWidth * (1 + BORE_CLEARANCE * 2)
}

/** Mirror a logical x about the assembly, or return it unchanged. Handedness in one line. */
export function mirrorX(layout: CutawayLayout, x: number): number {
  return layout.mirrored ? layout.left + layout.right - x : x
}

/** Centre of chamber `i`'s bore in the plug, which slides with rotation. */
export function plugChamberX(layout: CutawayLayout, i: number): number {
  // The plug slides one way as it rotates whichever way round the lock is drawn, so the
  // ledge offset is mirrored too — otherwise a mirrored lock's ledge would close from the
  // wrong side and a set pin would read as unset.
  const offset = layout.mirrored ? -layout.ledgeOffset : layout.ledgeOffset
  return shellChamberX(layout, i) + offset
}

/**
 * Which chamber a logical x lands on, or -1 outside the assembly.
 * With two rows the nearest centre wins, so the staggered banks stay separately selectable.
 */
export function chamberAtX(layout: CutawayLayout, x: number): number {
  if (x < layout.left || x >= layout.right) return -1
  // Un-mirrored, so the index arithmetic below can stay in chamber order. The two-row branch
  // needs no such thing: it compares against `shellChamberX`, which is already in screen space.
  const px = mirrorX(layout, x)
  if (layout.rows <= 1) {
    const from = px - layout.left - layout.endPad
    return clamp(Math.floor(from / layout.pitch), 0, layout.chamberCount - 1)
  }
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < layout.chamberCount; i += 1) {
    const d = Math.abs(shellChamberX(layout, i) - x)
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  }
  return best
}

/**
 * A wafer drawn as one piece — SIMULATION.md §10. Below the gate, the gate itself, above the
 * gate. The gate sits `K` mm up the wafer, which is exactly where a pin stack's key/driver
 * junction would be, so it lands on the shear line at the same lift.
 */
export function waferRects(layout: CutawayLayout, c: Chamber): Rect[] {
  const cx = plugChamberX(layout, c.index)
  const w = layout.driverWidth
  const gateW = w * 0.42
  const bottomMm = KEYWAY_FLOOR + c.lift
  const gateLowMm = bottomMm + c.keyPinLength - c.captureWindow / 2
  const gateHighMm = bottomMm + c.keyPinLength + c.captureWindow / 2
  const topMm = bottomMm + c.keyPinLength + c.driverLength
  const rect = (loMm: number, hiMm: number, width: number): Rect => ({
    x: cx - width / 2,
    y: mmToY(layout, hiMm),
    w: width,
    h: mmToY(layout, loMm) - mmToY(layout, hiMm),
  })
  return [
    rect(bottomMm, gateLowMm, w),
    rect(gateLowMm, gateHighMm, gateW),
    rect(gateHighMm, topMm, w),
  ]
}

/**
 * The key pin: rides in the plug bore, so it travels with the plug. Drawn from the sim's
 * lift, never from a separate animation value.
 */
export function keyPinRect(layout: CutawayLayout, c: Chamber): Rect {
  // `keyLift`, not `lift`: the key pin is its own body and falls away when the driver above it
  // is being held by the plug's ledge. The gap that opens up is the tell (D-042).
  const top = mmToY(layout, KEYWAY_FLOOR + c.keyPinLength + c.keyLift)
  const bottom = mmToY(layout, KEYWAY_FLOOR + c.keyLift)
  return {
    x: plugChamberX(layout, c.index) - layout.keyPinWidth / 2,
    y: top,
    w: layout.keyPinWidth,
    h: bottom - top,
  }
}

/**
 * Where the **driver** pin's bottom sits, in millimetres.
 *
 * Normally it rides on the key pin's top, so it tracks `lift`. Once the chamber is **SET** it
 * does not: the plug's ledge has closed underneath it, and it is resting on the shear line with
 * its own chamber no longer aligned. Nothing can bring it back down — which is the entire
 * reason a set pin stays set, and why letting go of the pick does not undo your work.
 *
 * The key pin, by contrast, *does* fall. The pick has left, nothing is holding it, and it drops
 * back to the keyway floor. Deriving both from `lift` drew the whole stack sinking together,
 * which showed a set pin coming undone every time the player moved to the next chamber.
 * See DECISIONS D-042.
 */
export function driverBottomMm(c: Chamber): number {
  return KEYWAY_FLOOR + c.keyPinLength + c.lift
}

/** The driver pin's full extent, ignoring its band shaping. */
export function driverPinRect(layout: CutawayLayout, c: Chamber): Rect {
  const bottomMm = driverBottomMm(c)
  const top = mmToY(layout, bottomMm + c.driverLength)
  const bottom = mmToY(layout, bottomMm)
  return {
    x: shellChamberX(layout, c.index) - layout.driverWidth / 2,
    y: top,
    w: layout.driverWidth,
    h: bottom - top,
  }
}

/**
 * One rect per band of the driver profile, narrowed where the band is reduced.
 * This is what makes a spool's waist the *same* geometry the physics reads.
 */
export function bandRects(layout: CutawayLayout, c: Chamber): Rect[] {
  const driverBottom = driverBottomMm(c)
  const cx = shellChamberX(layout, c.index)
  const out: Rect[] = []
  let depth = 0
  for (const band of c.profile.bands) {
    const w = layout.driverWidth * (1 - band.grooveDepth)
    const top = mmToY(layout, driverBottom + depth + band.length)
    const bottom = mmToY(layout, driverBottom + depth)
    out.push({ x: cx - w / 2, y: top, w, h: bottom - top })
    depth += band.length
  }
  return out
}

/**
 * The driver's silhouette as a polygon, with **bevelled shoulders** — DECISIONS D-125.
 *
 * `bandRects` draws every band as a rectangle, so the only thing separating one profile from
 * another on screen is how long and how wide its groove is. `taper` — which is the *shape* of the
 * shoulder, and the number the simulation turns into counter-rotation force — was never drawn at
 * all. A mushroom's bevelled cone and a T-pin's square step therefore rendered as the same
 * picture, and were reported as one: *"T-pin and mushroom are the same now."*
 *
 * They are not the same and they never were. A mushroom shoves your pick out (taper 0.85 puts its
 * counter-rotation at 4.4x a T-pin's); a T-pin barely shoves at all and instead gives a long, deep,
 * convincing false set. That is two different techniques — light tension against a mushroom,
 * precision against a T-pin — and the drawing was flattening both into "a pin with a waist".
 *
 * So the outline slopes each shoulder over a distance proportional to the taper of the bands
 * meeting there. Square stays square, a cone looks like a cone, and every profile in the game gets
 * a distinguishable outline out of data that was already there.
 *
 * Returned in logical px, bottom-up, as a closed left-then-right polygon.
 */
export function driverOutline(
  bands: readonly { length: number; grooveDepth: number; taper: number }[],
  cx: number,
  bottomY: number,
  width: number,
  height: number,
): { x: number; y: number }[] {
  const total = bands.reduce((s, b) => s + b.length, 0) || 1
  const yAt = (depth: number): number => bottomY - (depth / total) * height
  const halfAt = (i: number): number => (width * (1 - (bands[i]?.grooveDepth ?? 0))) / 2

  /** How far a shoulder slopes, in mm, from the tapers of the two bands that meet at it. */
  const bevelAt = (i: number): number => {
    const below = bands[i]
    const above = bands[i + 1]
    if (!below || !above) return 0
    const t = Math.max(below.taper, above.taper)
    return t * 0.5 * Math.min(below.length, above.length)
  }

  // Sample the profile as (depth, half-width) pairs going up: each band contributes its own
  // straight section, and each internal boundary contributes a slope centred on it.
  const samples: { d: number; half: number }[] = []
  let depth = 0
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i]
    if (!band) continue
    const bevBelow = i > 0 ? bevelAt(i - 1) : 0
    const bevAbove = i < bands.length - 1 ? bevelAt(i) : 0
    const from = depth + bevBelow / 2
    const to = depth + band.length - bevAbove / 2
    samples.push({ d: from, half: halfAt(i) })
    // A band shorter than its own bevels collapses to a point rather than inverting.
    samples.push({ d: Math.max(from, to), half: halfAt(i) })
    depth += band.length
  }

  const left = samples.map((s) => ({ x: cx - s.half, y: yAt(s.d) }))
  const right = [...samples].reverse().map((s) => ({ x: cx + s.half, y: yAt(s.d) }))
  return [...left, ...right]
}

/** The spring above the driver, from the driver's top to the chamber ceiling. */
export function springSpan(layout: CutawayLayout, c: Chamber): { top: number; bottom: number } {
  // Sits on the driver, so it follows the driver — including staying compressed once the
  // chamber is set, which is what holds the driver against the ledge in the first place.
  const driverTopMm = driverBottomMm(c) + c.driverLength
  return {
    top: mmToY(layout, SHELL_CHAMBER_TOP_MM),
    bottom: mmToY(layout, driverTopMm),
  }
}

/** The spring under an inverted wafer, in the keyway below it, pushing it up. */
export function invertedSpringSpan(
  layout: CutawayLayout,
  c: Chamber,
): { top: number; bottom: number } {
  return {
    top: mmToY(layout, KEYWAY_FLOOR + c.lift),
    bottom: mmToY(layout, KEYWAY_BOTTOM_MM),
  }
}

/** The band of lift over which this chamber captures — drawn as the guided-mode target. */
export function captureBandRect(layout: CutawayLayout, c: Chamber): Rect {
  // At `setLift` the key/driver junction is on the shear line; the window extends above it.
  // Drawn as the range of *junction* heights, i.e. 0 .. W millimetres above the shear line.
  const top = mmToY(layout, c.captureWindow)
  const bottom = mmToY(layout, 0)
  return {
    x: plugChamberX(layout, c.index) - layout.keyPinWidth / 2,
    y: top,
    w: layout.keyPinWidth,
    h: bottom - top,
  }
}

/** Vertical extent of the whole assembly, for framing and hit-testing. */
export function assemblyBounds(layout: CutawayLayout): Rect {
  const top = mmToY(layout, SHELL_TOP_MM)
  const bottom = mmToY(layout, PLUG_BOTTOM_MM)
  return {
    x: layout.left,
    y: top,
    w: layout.right - layout.left,
    h: bottom - top,
  }
}

/** Full driver length in logical px — a handy constant for the renderer. */
export function driverLengthPx(layout: CutawayLayout): number {
  return DRIVER_LENGTH * layout.mmToPx
}
