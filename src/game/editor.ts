/**
 * The lock editor's data model — `docs/CUSTOM_LOCKS.md` step 5, brought forward.
 *
 * A draft is a `LockDef` under construction plus the bookkeeping the screen needs. Everything here
 * is pure: no canvas, no save, no simulation. `src/ui/shell.ts` draws it, `src/app.ts` owns one
 * instance of it, and `validateLockDef` is the only judge of whether a draft is real.
 *
 * **What it can and cannot express, stated plainly.** A chamber today is one key pin, one driver
 * and one spring above them — so the editor offers exactly that: how many chambers, how deep each
 * key pin is cut, which driver profile sits on it, and how strong its spring is. Two drivers in one
 * chamber with a spring between them is the *segment* model, which is steps 1-3 of
 * `docs/CUSTOM_LOCKS.md` and a genuinely different `Chamber`. Building the editor on today's model
 * first is deliberate: it is a real tool now, and when the segment work lands the editor grows a
 * per-chamber stack instead of a single pin picker rather than being rewritten. See DECISIONS D-080.
 */

import {
  CAPTURE_WINDOW,
  DRIVER_LENGTH,
  MAX_CHAMBERS,
  MAX_KEY_PIN,
  MIN_CHAMBERS,
  MIN_STACK_HEIGHT,
  PROFILES,
  validateLockDef,
  type KeywayGrade,
  type LockDef,
  type PinTypeName,
} from '../sim'

/** The driver profiles a player may choose. Wafers are a whole different family, so not here. */
export const EDITABLE_PINS: readonly PinTypeName[] = [
  'standard',
  'spool',
  'spool-slim',
  'spool-deep',
  'spool-double',
  'serrated',
  'mushroom',
  't-pin',
]

/**
 * Springs, as three named strengths rather than a number.
 *
 * `springStrength` is a multiplier the simulation reads (D-062); these are the useful part of its
 * range, named so the choice means something at a glance. A player who wants 1.07 is not being
 * denied anything they could have felt.
 */
export const SPRING_CHOICES = [
  { label: 'light', value: 0.8 },
  { label: 'normal', value: 1 },
  { label: 'stiff', value: 1.22 },
] as const

export const MIN_TOLERANCE = 0.45
export const MAX_TOLERANCE = 1.4

/**
 * The shallowest cut the editor offers.
 *
 * The validator's own floor is `K + D > MIN_STACK_HEIGHT`, i.e. half a millimetre — but a key pin
 * that short leaves a 4.5mm lift to the shear line, which is most of the chamber and no fun to pick.
 * A millimetre is the shortest cut that still plays.
 */
export const MIN_DEPTH = Math.max(MIN_STACK_HEIGHT - DRIVER_LENGTH + 0.1, 1)

/**
 * The grid every bitting cut snaps to, in mm.
 *
 * One tenth, which is what the +/- buttons already step by — and, not coincidentally, exactly what
 * a share code can carry in one base32 digit (D-093). The editor used to *round* to 0.05 while
 * *stepping* by 0.1, so a draft could hold a depth no button could produce and no code could
 * express. One number, in one place, and the two agree by construction.
 */
export const DEPTH_STEP = 0.1

/** Snap a cut to the grid, and to two decimals so it never accumulates float dust. */
export function snapDepth(mm: number): number {
  return Number((Math.round(mm / DEPTH_STEP) * DEPTH_STEP).toFixed(2))
}

/** One chamber, as the editor holds it. */
export interface DraftChamber {
  /** Key pin length in mm — the bitting cut. Deeper cut, shorter pin, higher `setLift`. */
  depth: number
  pin: PinTypeName
  /** Index into `SPRING_CHOICES`. */
  spring: number
}

export interface Draft {
  name: string
  chambers: DraftChamber[]
  toleranceQuality: number
  keyway: KeywayGrade
}

/**
 * The deepest cut a chamber may carry and still hold this profile's grooves below the shear line.
 *
 * `validateLockDef` enforces this, but a UI that only reports failures afterwards is a UI that lets
 * you build something broken and then tells you off. The editor clamps to it as you turn the dial,
 * so the invalid state is unreachable rather than merely rejected.
 */
export function maxDepthFor(pin: PinTypeName): number {
  const p = PROFILES[pin]
  if (!p) return 3.0
  let cursor = 0
  let highestGrooveTop = 0
  for (const band of p.bands) {
    cursor += band.length
    if (band.reduced) highestGrooveTop = cursor
  }
  // `setLift = MAX_KEY_PIN - depth` must clear the highest groove plus the authored clearance.
  const needed = highestGrooveTop + 0.15
  return Math.min(4.0, MAX_KEY_PIN - needed - 0.01)
}

export function newDraft(chambers = 5): Draft {
  return {
    name: 'My Lock',
    chambers: Array.from({ length: chambers }, (_, i) => ({
      // A spread of cuts, so a fresh draft binds in an interesting order instead of uniformly.
      depth: snapDepth(3.4 - (i % 4) * 0.3),
      pin: 'standard',
      spring: 1,
    })),
    toleranceQuality: 1,
    keyway: 'standard',
  }
}

/** A slug that is stable for a given name, and cannot collide with a catalogue lock. */
export function slugFor(name: string, id: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `custom-${id}-${base || 'lock'}`
}

/**
 * Turn a draft into a real `LockDef`.
 *
 * `id` is offset well past the catalogue so a custom lock can never shadow an authored one. It used
 * to also set `pay: 0` — a lock you designed yourself paying out would have been a money printer.
 * There is no money any more (D-091), so the question does not arise; a custom lock is ranked like
 * any other, against a par derived from its own chamber count.
 */
export const CUSTOM_ID_BASE = 10_000

export function draftToLockDef(draft: Draft, index: number): LockDef {
  const id = CUSTOM_ID_BASE + index
  return {
    id,
    slug: slugFor(draft.name, id),
    name: draft.name.trim() || 'My Lock',
    tier: 1,
    family: 'pin-tumbler',
    bitting: draft.chambers.map((c) => c.depth),
    pins: draft.chambers.map((c) => c.pin),
    springs: draft.chambers.map((c) => SPRING_CHOICES[c.spring]?.value ?? 1),
    toleranceQuality: draft.toleranceQuality,
    keyway: draft.keyway,
    par: Math.max(20, draft.chambers.length * 18),
    note: 'Built at your own bench.',
  }
}

/**
 * Read a saved lock back into an editable draft.
 *
 * The inverse of `draftToLockDef`, and lossy in exactly one direction: a spring that is not one of
 * the three named strengths snaps to the nearest, because the editor has no way to show 1.07. Every
 * lock it can *produce* round-trips exactly, which is the property that matters.
 */
export function draftFromLockDef(def: LockDef): Draft {
  return {
    name: def.name,
    chambers: def.bitting.map((depth, i) => ({
      depth,
      pin: def.pins[i] ?? 'standard',
      spring: nearestSpring(def.springs?.[i] ?? 1),
    })),
    toleranceQuality: def.toleranceQuality,
    keyway: def.keyway,
  }
}

function nearestSpring(value: number): number {
  let best = 1
  let bestGap = Infinity
  SPRING_CHOICES.forEach((choice, i) => {
    const gap = Math.abs(choice.value - value)
    if (gap < bestGap) {
      bestGap = gap
      best = i
    }
  })
  return best
}

/** `null` when the draft is buildable, otherwise the reason it is not. */
export function draftProblem(draft: Draft, index = 0): string | null {
  try {
    validateLockDef(draftToLockDef(draft, index))
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * How wide each chamber's capture window will be, in mm — the number that decides whether this is
 * a forgiving lock or a vicious one, shown while you turn the dial rather than discovered later.
 */
export function windowWidth(draft: Draft): number {
  return CAPTURE_WINDOW * draft.toleranceQuality
}

export function clampChamberCount(n: number): number {
  return Math.max(MIN_CHAMBERS, Math.min(MAX_CHAMBERS, n))
}
