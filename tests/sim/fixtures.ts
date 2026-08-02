/**
 * Lock fixtures for the simulation tests.
 *
 * Deliberately hand-built rather than pulled from the shipped roster, so a balance change in
 * Phase 13 cannot silently change what a physics test is asserting.
 */

import type { LockDef, PinTypeName, SimInput, SimState, ToolStats } from '../../src/sim'
import { DT, PERFECT_TOOLS, makeConfig, step } from '../../src/sim'

let nextId = 1000

export function makeLock(patch: Partial<LockDef> & { bitting: number[] }): LockDef {
  const bitting = patch.bitting
  const id = patch.id ?? nextId++
  return {
    id,
    slug: patch.slug ?? `fixture-${id}`,
    name: patch.name ?? `Fixture ${id}`,
    tier: patch.tier ?? 1,
    family: patch.family ?? 'pin-tumbler',
    bitting,
    pins: patch.pins ?? bitting.map((): PinTypeName => 'standard'),
    toleranceQuality: patch.toleranceQuality ?? 1.3,
    keyway: patch.keyway ?? 'standard',
    par: patch.par ?? 30,
    ...(patch.toleranceSpread !== undefined ? { toleranceSpread: patch.toleranceSpread } : {}),
    ...(patch.rows !== undefined ? { rows: patch.rows } : {}),
    ...(patch.doubleSided !== undefined ? { doubleSided: patch.doubleSided } : {}),
    ...(patch.sidebar !== undefined ? { sidebar: patch.sidebar } : {}),
    ...(patch.discs !== undefined ? { discs: patch.discs } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
  }
}

/** Two standard pins, forgiving. The tutorial's first lock. */
export const TWO_PIN = makeLock({
  id: 9001,
  slug: 'fixture-2pin',
  name: 'Fixture 2-pin',
  bitting: [3.2, 4.0],
  toleranceQuality: 1.4,
})

/** Three standard pins. */
export const THREE_PIN = makeLock({
  id: 9002,
  slug: 'fixture-3pin',
  name: 'Fixture 3-pin',
  bitting: [3.2, 4.0, 2.8],
  toleranceQuality: 1.35,
})

/** Five standard pins, tighter. */
export const FIVE_PIN = makeLock({
  id: 9003,
  slug: 'fixture-5pin',
  name: 'Fixture 5-pin',
  bitting: [3.4, 2.9, 4.1, 3.7, 3.0],
  toleranceQuality: 1.0,
})

/** One spool in the middle. Its bitting is deep enough for the waist to reach the shear line. */
export const SPOOL_LOCK = makeLock({
  id: 9004,
  slug: 'fixture-spool',
  name: 'Fixture spool',
  bitting: [3.2, 3.0, 2.8],
  pins: ['standard', 'spool', 'standard'],
  toleranceQuality: 1.2,
})

/** A single serrated chamber — for counting false sets. */
export const SERRATED_LOCK = makeLock({
  id: 9005,
  slug: 'fixture-serrated',
  name: 'Fixture serrated',
  bitting: [2.6],
  pins: ['serrated'],
  toleranceQuality: 1.2,
})

/** One mushroom — the hardest shove. */
export const MUSHROOM_LOCK = makeLock({
  id: 9007,
  slug: 'fixture-mushroom',
  name: 'Fixture mushroom',
  bitting: [3.2, 3.0],
  pins: ['standard', 'mushroom'],
  toleranceQuality: 1.1,
})

/**
 * Five chambers, unforgiving. `W = 0.62 x 0.6 = 0.372mm`, which the pick crosses in about
 * 37ms at T=0.5 — less than `CAPTURE_TIME`. Overshooting this lock genuinely jams it, which
 * a loose Tier 1 lock will not do. Used wherever a test needs a real overset.
 */
export const TIGHT_FIVE = makeLock({
  id: 9008,
  slug: 'fixture-tight5',
  name: 'Fixture tight 5-pin',
  bitting: [3.4, 2.9, 4.1, 3.7, 3.0],
  toleranceQuality: 0.6,
  tier: 4,
})

/** Twelve chambers — the performance and stress case. */
export const TWELVE_PIN = makeLock({
  id: 9006,
  slug: 'fixture-12pin',
  name: 'Fixture 12-pin',
  bitting: [3.4, 2.9, 4.1, 3.7, 3.0, 3.9, 2.7, 4.3, 3.1, 3.6, 2.8, 4.0],
  toleranceQuality: 0.8,
})

/** Config with an ideal tool: no jitter, unlimited reach. Isolates physics from tools. */
export const PERFECT_CONFIG = makeConfig({ tools: PERFECT_TOOLS })

export function configWith(tools: ToolStats, featherEnabled = false): ReturnType<typeof makeConfig> {
  return makeConfig({ tools, featherEnabled })
}

export function input(patch: Partial<SimInput> = {}): SimInput {
  return {
    chamber: -1,
    liftTarget: 0,
    tensionHeld: false,
    tensionLevel: 0,
      ...patch,
  }
}

/** Hold tension on a chamber at a given lift. */
export function pick(chamber: number, liftTarget: number, tension: number): SimInput {
  return { chamber, liftTarget, tensionHeld: true, tensionLevel: tension }
}

/** Tension only, pick out of the lock. */
export function tensionOnly(tension: number): SimInput {
  return { chamber: -1, liftTarget: 0, tensionHeld: true, tensionLevel: tension }
}

export const RELEASED: SimInput = {
  chamber: -1,
  liftTarget: 0,
  tensionHeld: false,
  tensionLevel: 0,
}

/** Hold an input for a number of seconds of simulated time. */
export function holdFor(s: SimState, inp: SimInput, secondsToHold: number): void {
  const ticks = Math.round(secondsToHold / DT)
  for (let i = 0; i < ticks; i += 1) step(s, inp, DT)
}

/**
 * Slide the pick to a chamber and wait until it is genuinely there, then hold.
 *
 * The tip travels along the keyway rather than teleporting, and tension slows it right down
 * (DECISIONS D-045) — so a test that asks for chamber 4 and holds for a moment may spend that
 * moment in transit and measure whichever chamber it was passing. Every test that drives the
 * pick by hand should come through here; the solver has its own equivalent.
 */
/**
 * Travel to a chamber the way the controls make a player travel — **hand down** (D-138).
 *
 * It used to hold `liftTarget` for the whole crossing. No human input can do that: `stepChamber`
 * zeroes the lift on every chamber change and the touch scheme does the same, because carrying a
 * tip high past a set pin is how you lose it (D-051, D-059).
 *
 * It made no difference while the simulation ignored every chamber but the selected one. It makes
 * a large one now that the hook fouls what it passes: a scripted picker crossing the lock with its
 * hand up sweeps every pin in between, and the pass rate for this fixture fell from 120 to 20.
 * The fixture was wrong, not the physics.
 */
export function pickAt(s: SimState, chamber: number, liftTarget: number, tension: number): void {
  const travelling = pick(chamber, 0, tension)
  for (let i = 0; i < 900 && s.pickChamber !== chamber; i += 1) step(s, travelling, DT)
  // Arrived: put the hand where the caller asked for it.
  step(s, pick(chamber, liftTarget, tension), DT)
}

/** `pickAt` then `holdFor` — arrive, then work it for `secondsToHold`. */
export function holdAt(
  s: SimState,
  chamber: number,
  liftTarget: number,
  tension: number,
  secondsToHold: number,
): void {
  pickAt(s, chamber, liftTarget, tension)
  holdFor(s, pick(chamber, liftTarget, tension), secondsToHold)
}

/**
 * Drive the currently-binding chamber to `setLift + W × windowFraction` until it leaves the
 * BINDING state. A deliberately dumb scripted picker — the real solver arrives in Phase 6.
 * Returns the chamber's final state.
 */
export function workBindingChamber(
  s: SimState,
  tension: number,
  windowFraction = 0.5,
  maxSeconds = 4,
): string {
  const b = s.bindingChamber
  if (b < 0) return 'none'
  const c = s.chambers[b]
  if (!c) return 'none'
  const target = c.setLift + c.captureWindow * windowFraction
  pickAt(s, b, target, tension)
  const ticks = Math.round(maxSeconds / DT)
  for (let i = 0; i < ticks; i += 1) {
    step(s, pick(b, target, tension), DT)
    if (c.state !== 'BINDING' && c.state !== 'FREE') return c.state
  }
  return c.state
}

/** Set every chamber of a standard-pin lock and turn it. Returns true if it opened. */
export function scriptedOpen(s: SimState, tension = 0.5, maxSeconds = 30): boolean {
  holdFor(s, tensionOnly(tension), 0.3)
  const ticks = Math.round(maxSeconds / DT)
  for (let i = 0; i < ticks && !s.opened; i += 1) {
    const b = s.bindingChamber
    if (b < 0) {
      step(s, tensionOnly(tension), DT)
      continue
    }
    const c = s.chambers[b]
    if (!c) break
    // The pick has to get there first, and under tension that takes a moment (D-045).
    if (s.pickChamber !== b) pickAt(s, b, c.setLift + c.captureWindow * 0.5, tension)
    step(s, pick(b, c.setLift + c.captureWindow * 0.5, tension), DT)
  }
  return s.opened
}
