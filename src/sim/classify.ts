/**
 * The classifier — SIMULATION.md §3.
 *
 * For a given lift, ask one question: **what is at the shear line?** Everything about
 * security pins follows from the answer. There is no per-pin-type branch anywhere below,
 * which is the entire point of the band model.
 */

import { DISC_FALSE_GATE_DEPTH, DISC_FALSE_GATE_TAPER } from './constants'
import type { DriverProfile } from './profiles'
import type { Chamber, Geometry } from './types'

/**
 * Index of the band sitting on the shear line, given the boundary offset `s < 0`.
 *
 * The driver pin spans `[s, s + D]` in shear-relative coordinates, so walk the bands from
 * the bottom accumulating length until the running total passes `-s`.
 */
export function bandAtShearLine(profile: DriverProfile, s: number): number {
  const depth = -s
  let cursor = 0
  const bands = profile.bands
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i]
    if (band === undefined) break
    cursor += band.length
    if (cursor > depth) return i
  }
  // `K + D > 5.0` guarantees the driver straddles the shear line, so this is unreachable
  // for a validated lock. Fall back to the top band rather than throwing in the hot loop.
  return bands.length - 1
}

export interface ShearReading {
  readonly geometry: Geometry
  /** Band on the shear line, or -1 when the driver has cleared it. */
  readonly bandAtShear: number
}

/**
 * Classify a chamber's geometry from its lift alone. Roles (which chamber is *the* binding
 * one) are assigned later, in `step`, because they depend on every other chamber.
 */
export function readShearLine(c: Chamber, lift: number): ShearReading {
  if (c.kind === 'wafer') return readWafer(c, lift)
  if (c.kind === 'disc') return readDisc(c, lift)
  const s = lift - c.setLift
  if (s > c.captureWindow) return { geometry: 'OVER', bandAtShear: -1 }
  if (s >= 0) return { geometry: 'WINDOW', bandAtShear: -1 }
  const idx = bandAtShearLine(c.profile, s)
  const band = c.profile.bands[idx]
  return {
    geometry: band !== undefined && band.reduced ? 'GROOVE' : 'SOLID',
    bandAtShear: idx,
  }
}

/**
 * A wafer — SIMULATION.md §10.
 *
 * One flat wafer with a gate in it, and no key/driver split. The gate has to sit *at* the
 * shear line: too low and the wafer's lower half blocks, too high and its upper half blocks.
 * So it is a window to be found rather than a threshold to be crossed, and there is no
 * overset — over-lifting a wafer jams the lock but is recoverable by simply coming back down,
 * which is a different and gentler mistake than jamming a key pin into the shell.
 *
 * The window is centred on `setLift` rather than running upward from it, because a gate is a
 * slot and not an edge.
 */
function readWafer(c: Chamber, lift: number): ShearReading {
  const d = lift - c.setLift
  const half = c.captureWindow / 2
  if (Math.abs(d) <= half) return { geometry: 'WINDOW', bandAtShear: 1 }
  // Band 0 is the wafer below the gate, band 2 the part above it — which half is at the
  // shear line tells the renderer which way the player has gone wrong.
  return { geometry: 'SOLID', bandAtShear: d < 0 ? 0 : 2 }
}

/**
 * A disc detainer disc — SIMULATION.md §10.
 *
 * No pins and no springs: a disc turned to the right angle presents its gate to the sidebar,
 * and the sidebar drops in. An Abloy-style **false gate** is a notch not deep enough to let
 * the sidebar through — it drops partway and stops, telling exactly the lie a spool tells, in
 * a different coordinate. Because it *is* the same lie, routing it through the same GROOVE
 * classification gets false-set state, counter-rotation and the dramatic swing for free.
 */
function readDisc(c: Chamber, lift: number): ShearReading {
  const half = c.captureWindow / 2
  if (Math.abs(lift - c.setLift) <= half) return { geometry: 'WINDOW', bandAtShear: -1 }
  for (let i = 0; i < c.falseGates.length; i += 1) {
    if (Math.abs(lift - (c.falseGates[i] as number)) <= half) {
      return { geometry: 'GROOVE', bandAtShear: i }
    }
  }
  return { geometry: 'SOLID', bandAtShear: -1 }
}

/**
 * The lift a player should aim for to set this chamber.
 *
 * A pin stack wants the middle of the capture window, which runs *upward* from `setLift`.
 * A wafer wants the gate itself, which is centred on `setLift`. One helper so the solver and
 * the guided-mode annotations cannot disagree about it.
 */
export function targetLiftFor(c: Chamber): number {
  if (c.kind === 'wafer' || c.kind === 'disc') return c.setLift
  // A sidebar chamber has a second, narrower condition inside the capture window: the gate
  // has to line up too, so aim at the gate rather than the middle of the window.
  if (c.sidebarGate !== null) return c.sidebarGate
  return c.setLift + c.captureWindow * 0.5
}

/** The band of lift over which this chamber will capture. */
export function captureRange(c: Chamber): { low: number; high: number } {
  if (c.kind === 'wafer' || c.kind === 'disc') {
    return { low: c.setLift - c.captureWindow / 2, high: c.setLift + c.captureWindow / 2 }
  }
  return { low: c.setLift, high: c.setLift + c.captureWindow }
}

/** True when this chamber's lift satisfies its sidebar gate, or it has no gate to satisfy. */
export function sidebarAlignedAt(c: Chamber, lift: number): boolean {
  if (c.sidebarGate === null) return true
  return Math.abs(lift - c.sidebarGate) <= c.sidebarWidth
}

/**
 * The lift range over which band `bandIndex` sits on the shear line.
 *
 * Band `i` spans depths `[before, before + length]` measured up from the driver's bottom,
 * and depth relates to lift by `depth = setLift - lift`. So the band is at the shear line
 * for `lift ∈ [setLift - (before + length), setLift - before]`.
 */
export function bandLiftRange(c: Chamber, bandIndex: number): { min: number; max: number } {
  let before = 0
  for (let i = 0; i < bandIndex; i += 1) {
    before += c.profile.bands[i]?.length ?? 0
  }
  const length = c.profile.bands[bandIndex]?.length ?? 0
  return { min: c.setLift - (before + length), max: c.setLift - before }
}

/**
 * The lowest lift a false-set chamber can be driven to.
 *
 * Counter-rotation shoves the pin down, but it cannot shove it *out* of the groove: the
 * full-diameter body above the waist would have to pass through the plug's ledge, and the
 * ledge is exactly what tension is holding in place. The pin sinks to the bottom of its
 * travel inside the groove and stops. This is why a false set is stable — why you can park
 * four spools and go find the fifth — and why the only way out is dropping tension.
 */
export function grooveFloorLift(c: Chamber): number {
  if (c.bandAtShear < 0) return 0
  if (c.kind === 'disc') {
    // A disc's "groove" is a false gate, and `bandAtShear` indexes that gate rather than a
    // band on a pin. The sidebar tip sitting in the notch shoves the disc back to the notch's
    // low edge and no further, exactly as a plug ledge parks a spool in its waist.
    const gate = c.falseGates[c.bandAtShear]
    if (gate === undefined) return 0
    return gate - c.captureWindow / 2 + 1e-4
  }
  return bandLiftRange(c, c.bandAtShear).min + 1e-4
}

/** Groove depth of the band currently at the shear line, 0 when it is a full band. */
/**
 * The **top** of the groove the plug's ledge is sitting in — where the driver's full-diameter
 * shoulder meets the ledge and can go no further up.
 *
 * A spool caught at its waist is trapped between two shoulders: the foot below cannot pass the
 * ledge going up, the head above cannot pass it going down. That is what a false set physically
 * *is*, and until now only the downward half was modelled. See DECISIONS D-075.
 */
export function grooveCeilingLift(c: Chamber): number {
  if (c.bandAtShear < 0) return Number.POSITIVE_INFINITY
  if (c.kind === 'disc') {
    const gate = c.falseGates[c.bandAtShear]
    if (gate === undefined) return Number.POSITIVE_INFINITY
    return gate + c.captureWindow / 2 - 1e-4
  }
  return bandLiftRange(c, c.bandAtShear).max - 1e-4
}

export function grooveDepthAt(c: Chamber): number {
  if (c.bandAtShear < 0) return 0
  if (c.kind === 'disc') return DISC_FALSE_GATE_DEPTH
  return c.profile.bands[c.bandAtShear]?.grooveDepth ?? 0
}

/** Taper of the band currently at the shear line, 0 when it is a full band. */
export function taperAt(c: Chamber): number {
  if (c.bandAtShear < 0) return 0
  if (c.kind === 'disc') return DISC_FALSE_GATE_TAPER
  return c.profile.bands[c.bandAtShear]?.taper ?? 0
}

/**
 * Every lift at which this profile presents a reduced band at the shear line, as the
 * midpoint of each groove. Used by the solver and by the "a serrated pin gives exactly four
 * false sets" test.
 */
export function falseSetLifts(c: Chamber): number[] {
  const out: number[] = []
  let cursor = 0
  for (const band of c.profile.bands) {
    if (band.reduced) {
      // Band spans [cursor, cursor + length] measured down from the driver's bottom, and
      // sits on the shear line when s = -(that depth).
      const mid = cursor + band.length / 2
      out.push(c.setLift - mid)
    }
    cursor += band.length
  }
  return out.filter((l) => l >= 0).sort((a, b) => a - b)
}
