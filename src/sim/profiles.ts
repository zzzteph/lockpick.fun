/**
 * Driver pin profiles — SIMULATION.md §3.
 *
 * There is no special case for spools, serrated pins or mushrooms. Every driver is a stack
 * of bands along its length, each full diameter or reduced. Ask one question of a given
 * lift — *what is at the shear line?* — and the whole security-pin catalogue falls out of
 * the same three lines of code.
 */

import { DRIVER_LENGTH } from './constants'

export interface Band {
  /** mm along the pin. */
  readonly length: number
  /** True = groove/waist: the plug's ledge can enter it. */
  readonly reduced: boolean
  /** 0 = square shoulder, 1 = fully bevelled. Drives counter-rotation force (§5). */
  readonly taper: number
  /**
   * Fraction of the pin's radius removed, 0..1. Zero for full bands. Drives how far the
   * plug rotates on a false set (§4).
   *
   * The spec's band model omitted this and then multiplied an unnamed `grooveDepth` by
   * `FALSE_SET_GAIN`; naming it here as a normalised radial cut is what makes the false-set
   * angle land in the 55-70% band the spec asks for. See DECISIONS D-009.
   */
  readonly grooveDepth: number
}

export type PinTypeName =
  | 'standard'
  | 'spool'
  | 'spool-slim'
  | 'spool-deep'
  | 'spool-double'
  | 'serrated'
  | 'mushroom'
  | 't-pin'
  | 'wafer'

export interface DriverProfile {
  readonly name: PinTypeName
  readonly bands: readonly Band[]
  /** Deepest groove on the pin — how convincing a lie it can tell. */
  readonly maxGrooveDepth: number
  /** How many reduced bands it has: the number of false sets available on the way up. */
  readonly grooveCount: number
}

function full(length: number): Band {
  return { length, reduced: false, taper: 0, grooveDepth: 0 }
}

function groove(length: number, taper: number, grooveDepth: number): Band {
  return { length, reduced: true, taper, grooveDepth }
}

function profile(name: PinTypeName, bands: Band[]): DriverProfile {
  const total = bands.reduce((s, b) => s + b.length, 0)
  // Every profile must sum to D so pin types are interchangeable in any chamber.
  if (Math.abs(total - DRIVER_LENGTH) > 1e-9) {
    throw new Error(
      `Driver profile "${name}" sums to ${total.toFixed(4)}mm, expected ${DRIVER_LENGTH}mm`,
    )
  }
  let maxGrooveDepth = 0
  let grooveCount = 0
  for (const b of bands) {
    if (b.reduced) {
      grooveCount += 1
      if (b.grooveDepth > maxGrooveDepth) maxGrooveDepth = b.grooveDepth
    }
  }
  return { name, bands, maxGrooveDepth, grooveCount }
}

/**
 * **Where the features have to live.**
 *
 * Only the bottom `setLift` millimetres of a driver pin ever cross the shear line. At rest
 * the shear line sits at depth `setLift` measured up from the driver's bottom; lifting walks
 * it down to zero, at which point the chamber sets. `setLift = 5.0 - K`, so for realistic
 * key pins it runs about 0.6mm to 2.8mm.
 *
 * `SIMULATION.md §3` originally put a spool's waist at depth 1.4-3.3mm and a serrated pin's
 * fourth serration at 3.9mm. Neither is reachable: with a 3.2mm key pin the shear line never
 * gets past depth 1.8mm, so the spool would behave exactly like a standard pin and the
 * "four convincing false sets" the same document promises could never happen. Every profile
 * below is rescaled so its grooves sit inside the reachable band, and the spec table has
 * been corrected. See DECISIONS D-016.
 */
const serratedBands: Band[] = [full(0.25)]
for (let i = 0; i < 4; i += 1) {
  serratedBands.push(groove(0.18, 0.1, 0.12), full(0.22))
}
serratedBands.push(full(2.65))

export const STANDARD = profile('standard', [full(4.5)])
export const SPOOL = profile('spool', [full(0.45), groove(0.95, 0.15, 0.3), full(3.1)])
/**
 * **Three more spools, because a spool is a shape rather than a type.**
 *
 * The band model already says everything that distinguishes them, so these are data and nothing
 * else — no branch anywhere in the simulation knows they exist. What varies is the three numbers
 * that actually change how one feels under a pick:
 *
 * | | waist | bevel | depth | plays like |
 * |---|---|---|---|---|
 * | `spool` | 0.95mm | 0.15 | 0.30 | the standard article |
 * | `spool-slim` | 0.45mm | 0.12 | 0.26 | a narrow waist: a *brief* lie, easy to walk past |
 * | `spool-deep` | 1.20mm | 0.10 | 0.42 | a deep, near-square waist — a long, convincing lie |
 * | `spool-double` | 2×0.55mm | 0.14 | 0.27 | two waists: it lies, you push through, it lies again |
 *
 * `spool-deep` is the interesting one to pick: the depth makes the plug give a long way, which
 * feels like a set, and the shallow bevel means there is very little to cam against — so it wants
 * the wrench eased right off (D-077). `spool-double` is a serrated pin's *pattern* at a spool's
 * *scale*, which is a genuinely different read from either.
 */
export const SPOOL_SLIM = profile('spool-slim', [full(0.62), groove(0.38, 0.1, 0.24), full(3.5)])
export const SPOOL_DEEP = profile('spool-deep', [full(0.5), groove(1.1, 0.34, 0.44), full(2.9)])
export const SPOOL_DOUBLE = profile('spool-double', [
  full(0.4),
  groove(0.55, 0.14, 0.27),
  full(0.4),
  groove(0.55, 0.14, 0.27),
  full(2.6),
])

export const SERRATED = profile('serrated', serratedBands)

/**
 * **A mushroom and a T-pin start at the bottom. A spool does not.** — DECISIONS D-124.
 *
 * Reported from play as *"there is little difference between mushroom and normal spool — I believe
 * mushroom should be T-shaped"*, and then the same of `wafer` against `spool-slim` and
 * `spool-deep` against `t-pin`. All three were true, and the reason is one thing rather than three:
 * every profile in this file had the shape **full band, groove, full band** — a waist between two
 * collars — and differed only in how long and how deep the waist was. `spool-deep` and `t-pin`
 * were within 0.1mm of each other on every axis. Drawn at pin scale that is the same picture.
 *
 * A spool *is* a waist between two collars, so it keeps that shape. A mushroom and a T-pin are not:
 * on both, the **reduced section runs from the bottom of the driver**, so the silhouette is a stem
 * flaring into a head — a T. That is what the parts actually look like, and it is a different
 * outline rather than a different measurement of the same one. The base band drops from 0.4 to
 * around 0.1: not removed, because a groove that reaches depth zero would put a shallow-cut chamber
 * in its own waist at rest, but short enough that the eye reads a stem.
 *
 * What separates them from each other is then the **bevel**, which is also what separates them
 * under the pick: a mushroom is a cone (taper 0.95, it drags and slides), a T-pin is square
 * (taper 0.0, it catches and walls). The picture and the feel say the same thing, which they did
 * not before.
 *
 * **No groove top moved upward.** The reachable band is `setLift = 5 - K`, so raising a groove
 * would invalidate lock bittings that are currently legal (D-016). Every top here is the same or
 * lower than it was: mushroom 1.50 -> 1.50, t-pin 1.65 -> 1.60, spool-slim 0.95 -> 1.00 (the one
 * that rose, and it rose 0.05mm into slack that every spool-slim chamber already has).
 */
/**
 * The bevel and the depth are the **tuned** numbers and they are left exactly where they were.
 *
 * Raising the taper to 0.95 and the depth to 0.30 alongside the silhouette change took the Ironhold
 * Mushroom Pad from 50/50 to 49/50 on the solver — one seed ran out of time. That is the whole
 * argument for changing one thing at a time: the shape was the complaint, the bevel is what the
 * lock is balanced on, and there was no reason to move both.
 */
export const MUSHROOM = profile('mushroom', [full(0.12), groove(1.38, 0.85, 0.28), full(3.0)])
export const T_PIN = profile('t-pin', [full(0.1), groove(1.5, 0.0, 0.44), full(2.9)])

/**
 * Wafer — SIMULATION.md §10. One wafer per chamber with a gate that must sit at the shear
 * line. It blocks in *both* directions, which the sim handles by treating the gate as a
 * window rather than a threshold; the band data is what the renderer draws.
 */
/**
 * A **slot**, not a waist — which is what a wafer's gate is (D-124).
 *
 * At `groove(0.5, 0.02, 0.5)` it was 0.05mm of length and 0.02 of bevel away from `spool-slim`,
 * so the two drew as the same small notch and the one profile in the game that is *not* a lie
 * looked exactly like one that is. A wafer is a flat plate with a gate cut through it: the cut is
 * narrow, square-edged and deep. Half the length and a perfectly square edge is that, and it reads
 * apart from every rounded spool waist at a glance.
 *
 * The depth is unchanged at 0.5. It is the one number here that is load-bearing rather than
 * cosmetic — the gate is the *target* on a wafer, not a trap, and its depth is what the plug has
 * to pass through.
 */
export const WAFER = profile('wafer', [full(0.35), groove(0.22, 0.0, 0.5), full(3.93)])

/**
 * Depth, measured up from the driver's bottom, of the top of the highest groove.
 * A chamber must have `setLift` comfortably above this or it starts life already false-set.
 */
export function highestGrooveTop(p: DriverProfile): number {
  let cursor = 0
  let top = 0
  for (const band of p.bands) {
    cursor += band.length
    if (band.reduced) top = cursor
  }
  return top
}

/** Clearance a chamber needs above the highest groove so it starts on a full band. */
export const GROOVE_CLEARANCE = 0.15

/** Minimum `setLift` for a chamber carrying this profile. */
export function minimumSetLift(p: DriverProfile): number {
  const top = highestGrooveTop(p)
  return top > 0 ? top + GROOVE_CLEARANCE : 0
}

export const PROFILES: Record<PinTypeName, DriverProfile> = {
  standard: STANDARD,
  spool: SPOOL,
  'spool-slim': SPOOL_SLIM,
  'spool-deep': SPOOL_DEEP,
  'spool-double': SPOOL_DOUBLE,
  serrated: SERRATED,
  mushroom: MUSHROOM,
  't-pin': T_PIN,
  wafer: WAFER,
}

export function profileByName(name: PinTypeName): DriverProfile {
  const p = PROFILES[name]
  if (!p) throw new Error(`Unknown pin profile "${String(name)}"`)
  return p
}

/**
 * True for anything that can tell a lie — a driver whose groove produces a false set.
 *
 * A wafer's gate is a groove too, but it is the *target*, not a trap: sitting in it is how a
 * wafer sets. So wafers are deliberately not security pins.
 */
export function isSecurityPin(p: DriverProfile): boolean {
  return p.grooveCount > 0 && p.name !== 'wafer'
}
