/**
 * Shapes as data — pins and picks are polygons, nothing in the solver knows their names.
 *
 * A pin profile is the right-hand silhouette of a solid of revolution: `(u, halfWidth)` pairs from
 * the bottom of the pin to the top, `u` measured from the pin's centre along its axis. The polygon
 * is that side plus its mirror image, wound counter-clockwise in a frame where X is sideways and
 * Y is along the pin.
 *
 * A pick profile is an explicit outline in the cutaway plane: x along the blade toward the tip,
 * y up, the handle point at the origin, wound counter-clockwise. Everything past `flexX` is the
 * blade that bends.
 */

export interface PinProfile {
  readonly name: string
  /** Overall length, bottom to top, excluding nothing. */
  readonly length: number
  /** Right-hand silhouette, bottom to top: [u, halfWidth]. */
  readonly right: readonly (readonly [number, number])[]
}

export interface PickProfile {
  readonly name: string
  /** Counter-clockwise outline: [x, y] pairs. */
  readonly outline: readonly (readonly [number, number])[]
  /** Vertices with x > flexX belong to the bending blade. */
  readonly flexX: number
  /** Index of the working tip vertex (what "tip deflection" is measured at). */
  readonly tipIndex: number
}

const R = 1.475
/** Corner chamfer on every pin end. */
const C = 0.15
/** Driver length; every driver is interchangeable in any chamber. */
export const DRIVER_LENGTH = 4.5
/** Waist / stem radius on cut drivers. */
const WAIST = 1.0

const H = DRIVER_LENGTH / 2

function pin(name: string, length: number, right: (readonly [number, number])[]): PinProfile {
  return { name, length, right }
}

export const STANDARD: PinProfile = pin('standard', DRIVER_LENGTH, [
  [-H, R - C],
  [-H + C, R],
  [H - C, R],
  [H, R - C],
])

/**
 * Spool: full rings top and bottom, a waist between. Rings 1.2 mm, a 0.3 mm shoulder ramp, waist
 * 0.375 mm deep. The shoulder is what the plug rim rides when the pin is pushed through.
 */
export const SPOOL: PinProfile = pin('spool', DRIVER_LENGTH, [
  [-H, R - C],
  [-H + C, R],
  [-1.05, R],
  [-0.75, 1.1],
  [0.75, 1.1],
  [1.05, R],
  [H - C, R],
  [H, R - C],
])

/** A deeper, slimmer-footed spool: 0.9 mm rings, 0.475 mm waist. Cants far more. */
export const SPOOL_DEEP: PinProfile = pin('spool-deep', DRIVER_LENGTH, [
  [-H, R - C],
  [-H + C, R],
  [-1.35, R],
  [-1.0, WAIST],
  [1.0, WAIST],
  [1.35, R],
  [H - C, R],
  [H, R - C],
])

/** Mushroom: a short full foot, then a long shallow taper back up to full diameter. */
export const MUSHROOM: PinProfile = pin('mushroom', DRIVER_LENGTH, [
  [-H, R - C],
  [-H + C, R],
  [-1.65, R],
  [-1.45, 1.05],
  [1.9, R],
  [H, R - C],
])

/** Serrated: a stack of shallow grooves, each a small false set. */
function serratedRight(): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [
    [-H, R - C],
    [-H + C, R],
  ]
  const groove = 0.2
  const land = 0.45
  const width = 0.3
  let u = -H + 0.55
  while (u + width + land < H - 0.55) {
    out.push([u, R], [u + 0.05, R - groove], [u + width - 0.05, R - groove], [u + width, R])
    u += width + land
  }
  out.push([H - C, R], [H, R - C])
  return out
}
export const SERRATED: PinProfile = pin('serrated', DRIVER_LENGTH, serratedRight())

/** T-pin: a full-diameter head at the bottom on a narrow stem. */
export const T_PIN: PinProfile = pin('t-pin', DRIVER_LENGTH, [
  [-H, R - C],
  [-H + C, R],
  [-1.2, R],
  [-1.0, WAIST],
  [H - C, WAIST],
  [H, WAIST - C],
])

export const DRIVERS: Readonly<Record<string, PinProfile>> = {
  standard: STANDARD,
  spool: SPOOL,
  'spool-deep': SPOOL_DEEP,
  mushroom: MUSHROOM,
  serrated: SERRATED,
  't-pin': T_PIN,
}

/**
 * Height of the key pin's conical tip below its shoulder. The cone rests on the keyway slot's lips
 * part-way up, so with this length the tip hangs ~1.5 mm into the keyway — what a pick has to get
 * under, and the most a pin can be lifted by a blade that must still pass under the keyway roof.
 */
export const KEY_TIP = 2.4
/** Half-width of the flat at the very tip. */
export const KEY_TIP_HALF = 0.5

/**
 * A key pin of body length `length` (shoulder to top) with a conical tip below the shoulder that
 * hangs into the keyway. `u = 0` is the centre of the body, so the tip flat is at
 * `-length/2 - KEY_TIP`.
 */
export function keyPin(length: number, topChamfer = C): PinProfile {
  const h = length / 2
  return pin(`key-${length}`, length + KEY_TIP, [
    [-h - KEY_TIP, KEY_TIP_HALF],
    [-h, R],
    [h - topChamfer, R],
    [h, R - topChamfer],
  ])
}

// ── Picks ──────────────────────────────────────────────────────────────────────────────────

/** Distance from the handle point to the tip. */
export const PICK_REACH = 60
/** Blade length that bends: the flex point sits this far behind the tip. */
export const PICK_FLEX = 12
const T = PICK_REACH

/**
 * Short hook: 1.0 mm shank, tip 2.3 mm above the shank's underside. The front of the tip is
 * rounded off (a 45° bevel under a small nose) — a square front acts as a 2.5:1 wedge against a
 * pin's conical tip and hoists it far past the hook's own height.
 */
export const HOOK: PickProfile = {
  name: 'hook',
  outline: [
    [0, -0.5],
    [T, -0.5],
    [T + 0.25, 0.4],
    [T + 0.3, 1.3],
    [T + 0.05, 2.1],
    [T - 0.25, 2.3],
    [T - 0.6, 2.2],
    [T - 1.45, 0.5],
    [0, 0.5],
  ],
  flexX: T - PICK_FLEX,
  tipIndex: 5,
}

/** Half diamond: a symmetric 1.8 mm peak. */
export const DIAMOND: PickProfile = {
  name: 'diamond',
  outline: [
    [0, -0.5],
    [T, -0.5],
    [T + 0.4, 0.2],
    [T - 1.5, 1.8],
    [T - 3.4, 0.5],
    [0, 0.5],
  ],
  flexX: T - PICK_FLEX,
  tipIndex: 3,
}

/** Triple-peak rake: peaks of falling height so a scrub bounces pins rather than holding them. */
export const RAKE: PickProfile = {
  name: 'rake',
  outline: [
    [0, -0.5],
    [T, -0.5],
    [T + 0.3, 0.1],
    [T - 0.6, 1.6],
    [T - 2.0, 0.55],
    [T - 3.4, 0.55],
    [T - 4.6, 1.35],
    [T - 6.0, 0.55],
    [T - 7.4, 0.55],
    [T - 8.6, 1.15],
    [T - 10.0, 0.5],
    [0, 0.5],
  ],
  flexX: T - PICK_FLEX,
  tipIndex: 3,
}

export const PICKS: Readonly<Record<string, PickProfile>> = { hook: HOOK, diamond: DIAMOND, rake: RAKE }

/** A player-drawn blade: any counter-clockwise outline with the handle at the origin. */
export function customPick(name: string, outline: readonly (readonly [number, number])[], tipIndex: number): PickProfile {
  return { name, outline, flexX: PICK_REACH - PICK_FLEX, tipIndex }
}
