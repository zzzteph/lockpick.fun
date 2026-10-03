/**
 * Feedback effects — ART_DIRECTION.md §5, GAME_DESIGN.md §8.
 *
 * A pure state machine driven by the simulation's event stream. It holds no canvas and no
 * clock: events in, `dt` in, magnitudes out. That makes "set feedback lands within 100ms
 * across all channels" something a unit test can assert rather than something you squint at.
 *
 * Nothing here ever changes what the simulation thinks is true. The one positional effect —
 * the reset drop bounce — is an explicitly transient render offset that decays to exactly
 * zero, and `getGeometry()` continues to report sim-derived positions. See DECISIONS D-019.
 */

import { clamp01, type SimEvent, type SimState } from '../sim'

/** ART_DIRECTION.md §5 durations, in seconds. */
export const FLASH_SECONDS = 0.18
export const SHAKE_SECONDS = 0.04
export const JOLT_SECONDS = 0.09
export const DROP_SECONDS = 0.25
export const FALSE_SET_PULSE_SECONDS = 0.4

/** Amplitudes, in logical pixels. */
export const SHAKE_PX = 2.4
export const JOLT_PX = 6
export const DROP_BOUNCE_PX = 7
export const CAMERA_DRIFT_PX = 6

/** Per-chamber stagger for the reset cascade (AUDIO.md §3 uses the same 25ms). */
export const DROP_STAGGER_SECONDS = 0.025

export interface ChamberFx {
  /** 1 at the instant a pin sets, decaying to 0 over `FLASH_SECONDS`. */
  flash: number
  /** 1 at the instant a pin oversets, decaying over `JOLT_SECONDS`. */
  jolt: number
  /** 1 at a reset, decaying over `DROP_SECONDS`; staggered per chamber. */
  drop: number
  /** Seconds until this chamber's drop begins (the cascade). */
  dropDelay: number
  /** 1 when a false set is entered, decaying over `FALSE_SET_PULSE_SECONDS`. */
  falseSet: number
}

export interface Fx {
  chambers: ChamberFx[]
  /** Whole-screen shake magnitude, 1 → 0. */
  shake: number
  /** Seconds since the effects started, for deterministic oscillators. */
  clock: number
  /** Collapses every duration and removes every shake. */
  reducedMotion: boolean
}

function emptyChamber(): ChamberFx {
  return { flash: 0, jolt: 0, drop: 0, dropDelay: 0, falseSet: 0 }
}

export function createFx(chamberCount: number, reducedMotion = false): Fx {
  return {
    chambers: Array.from({ length: chamberCount }, emptyChamber),
    shake: 0,
    clock: 0,
    reducedMotion,
  }
}

export function resizeFx(fx: Fx, chamberCount: number): void {
  while (fx.chambers.length < chamberCount) fx.chambers.push(emptyChamber())
  fx.chambers.length = chamberCount
}

export function clearFx(fx: Fx): void {
  for (const c of fx.chambers) {
    c.flash = 0
    c.jolt = 0
    c.drop = 0
    c.dropDelay = 0
    c.falseSet = 0
  }
  fx.shake = 0
}

/**
 * Fold one simulation event into the effect state.
 *
 * With reduced motion on, the *positional* effects (shake, jolt, bounce) are suppressed
 * entirely while the value-carrying ones (flash, false-set pulse) are still set — they just
 * decay instantly in `updateFx`, so state changes continue to read through colour and
 * pattern. ART_DIRECTION.md §5: "state changes still read via colour and pattern".
 */
export function pushFxEvent(fx: Fx, event: SimEvent): void {
  switch (event.type) {
    case 'PIN_SET': {
      const c = fx.chambers[event.chamber]
      if (c) c.flash = 1
      if (!fx.reducedMotion) fx.shake = 1
      break
    }
    case 'PIN_OVERSET': {
      const c = fx.chambers[event.chamber]
      if (c && !fx.reducedMotion) c.jolt = 1
      break
    }
    case 'FALSE_SET_ENTERED': {
      const c = fx.chambers[event.chamber]
      if (c) c.falseSet = 1
      break
    }
    case 'RESET': {
      if (fx.reducedMotion) break
      for (let i = 0; i < fx.chambers.length; i += 1) {
        const c = fx.chambers[i]
        if (!c) continue
        c.drop = 1
        c.dropDelay = i * DROP_STAGGER_SECONDS
      }
      break
    }
    default:
      break
  }
}

function decay(value: number, dt: number, duration: number): number {
  if (value <= 0) return 0
  const next = value - dt / duration
  return next > 0 ? next : 0
}

export function updateFx(fx: Fx, dt: number): void {
  fx.clock += dt
  if (fx.reducedMotion) {
    clearFx(fx)
    return
  }
  fx.shake = decay(fx.shake, dt, SHAKE_SECONDS)
  for (const c of fx.chambers) {
    c.flash = decay(c.flash, dt, FLASH_SECONDS)
    c.jolt = decay(c.jolt, dt, JOLT_SECONDS)
    c.falseSet = decay(c.falseSet, dt, FALSE_SET_PULSE_SECONDS)
    // Spend the frame on the stagger first, then on the drop itself. Consuming the whole
    // frame for a 25ms delay would stall the cascade on a slow frame.
    let remaining = dt
    if (c.dropDelay > 0) {
      const used = Math.min(c.dropDelay, remaining)
      c.dropDelay -= used
      remaining -= used
    }
    if (c.dropDelay <= 0 && remaining > 0) c.drop = decay(c.drop, remaining, DROP_SECONDS)
  }
}

/** Deterministic screen shake offset, in logical pixels. */
export function shakeOffset(fx: Fx): { x: number; y: number } {
  if (fx.shake <= 0) return { x: 0, y: 0 }
  const a = fx.shake * SHAKE_PX
  return {
    x: a * Math.sin(fx.clock * 190),
    y: a * Math.sin(fx.clock * 233 + 1.1),
  }
}

/**
 * Camera micro-motion: a few pixels of drift tracking plug rotation, so the whole drawing
 * leans as the plug turns (PHASES.md Phase 3).
 */
export function cameraDrift(state: SimState, thetaOpen: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0
  return clamp01(state.theta / thetaOpen) * CAMERA_DRIFT_PX
}

/** Transient vertical offset for a chamber's pins: the overset jolt and the reset bounce. */
export function chamberOffsetY(fx: Fx, index: number): number {
  const c = fx.chambers[index]
  if (!c) return 0
  let y = 0
  if (c.jolt > 0) {
    // A hard 6px jolt that snaps rather than eases — it should feel like a mistake.
    y += JOLT_PX * c.jolt * Math.sin(c.jolt * Math.PI * 3)
  }
  if (c.drop > 0 && c.dropDelay <= 0) {
    // Bounce: overshoot downward, then settle. `1 - drop` runs 0 → 1 through the effect.
    const t = 1 - c.drop
    y += DROP_BOUNCE_PX * Math.sin(t * Math.PI) * (1 - t)
  }
  return y
}

/** How much of the set flash's white is still showing, 0..1. */
export function flashAmount(fx: Fx, index: number): number {
  return fx.chambers[index]?.flash ?? 0
}

export function falseSetPulse(fx: Fx, index: number): number {
  return fx.chambers[index]?.falseSet ?? 0
}

/**
 * Pick shaft flex, in logical pixels of bow.
 *
 * Two terms, both continuous. `resistance` is the simulation's own readout (§8), so the shaft
 * is bending *all the time, on every pin* as ART_DIRECTION.md §5 requires. `gapMm` is how far
 * the pin is lagging behind where the player has asked the tip to be — which is exactly what
 * counter-rotation shoving the pick back looks like.
 */
export const FLEX_PER_RESISTANCE = 16
export const FLEX_PER_MM_GAP = 26
export const FLEX_MAX = 46

export function pickFlex(resistance: number, gapMm: number): number {
  const fromResistance = clamp01(resistance) * FLEX_PER_RESISTANCE
  const fromGap = Math.max(0, gapMm) * FLEX_PER_MM_GAP
  return Math.min(FLEX_MAX, fromResistance + fromGap)
}
