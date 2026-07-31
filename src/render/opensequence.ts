/**
 * The open sequence — `ART_DIRECTION.md §6`.
 *
 * Two and a half seconds, skippable after half a second, in eight beats. Like `fx.ts` this is
 * a pure state machine: seconds in, magnitudes out, no canvas and no clock of its own. That
 * is what lets "the sequence hits its timings" be a unit test with numbers in it rather than
 * a person watching a screen and nodding.
 *
 * Reduced motion keeps every beat and every duration — the credit count-up still counts, the
 * cards still arrive, the sequence still lasts 2.5 seconds — and drops only the things that
 * *move*: the jolt, the burst, the grid sweep and the slide. `ART_DIRECTION.md §5` is explicit
 * that meaning must survive in colour and pattern, and the meaning of this sequence is "you
 * opened it, here is what it paid, here is what you earned".
 */

import { clamp01 } from '../sim'

/** Beat starts, in seconds from the open. Straight from `ART_DIRECTION.md §6`. */
export const BEATS = {
  /** 1. Plug accelerates through the last of its rotation, ease-in. */
  accelerate: 0.0,
  /** 2. Impact: 8px jolt, all linework flashes to Highlight for two frames. */
  impact: 0.25,
  /** 3. Time dilates to 0.25x for 400ms; the shackle springs / the bolt throws. */
  dilate: 0.35,
  /** 4. A thin radial burst of hairlines from the plug centre. */
  burst: 0.6,
  /** 5. Grid lines sweep outward and fade. */
  sweep: 0.9,
  /** 6. The rank stamps in at 64px, with one mechanical tick as it lands (D-091). */
  credits: 1.2,
  /** 7. Achievement cards slide in from the right, staggered 120ms. */
  cards: 1.8,
  /** 8. Settle into the results panel. */
  settle: 2.5,
} as const

/** The spec's length, and the floor: no open is ever shorter than this. */
export const SEQUENCE_SECONDS = BEATS.settle
/** Before this, a keypress does nothing — the payoff is not something to be skipped past. */
export const SKIPPABLE_AFTER = 0.5

/** Two frames at 60fps, per beat 2. */
export const IMPACT_FLASH_SECONDS = 2 / 60
export const IMPACT_JOLT_PX = 8
export const DILATION_SCALE = 0.25
export const DILATION_SECONDS = 0.4
export const BURST_SECONDS = 0.45
export const BURST_RAYS = 18
export const SWEEP_SECONDS = 0.6
export const CREDIT_COUNT_SECONDS = 0.55
export const CARD_STAGGER_SECONDS = 0.12
export const CARD_SLIDE_SECONDS = 0.28
export const CARD_SLIDE_PX = 420

export interface OpenSequence {
  /** Seconds since the lock opened. */
  elapsed: number
  running: boolean
  /** True once the player has skipped; the sequence jumps to its end state. */
  skipped: boolean
  /**
   * Rank index earned, 0 = S. Beat 6 stamps the letter rather than counting a number up.
   *
   * It was a credit total, and the count-up was the best half-second in the game — so the beat,
   * its timing and its tick survived D-091 intact. Only what lands changed.
   */
  rank: number
  /** How many achievement cards to stagger in. */
  cardCount: number
  /** Digits already ticked, so the audio layer can fire one tick per new digit. */
  ticksFired: number
  reducedMotion: boolean
}

export function createOpenSequence(reducedMotion = false): OpenSequence {
  return {
    elapsed: 0,
    running: false,
    skipped: false,
    rank: 6,
    cardCount: 0,
    ticksFired: 0,
    reducedMotion,
  }
}

export function startOpenSequence(seq: OpenSequence, rank: number, cardCount: number): void {
  seq.elapsed = 0
  seq.running = true
  seq.skipped = false
  seq.rank = Math.max(0, Math.round(rank))
  seq.cardCount = Math.max(0, cardCount)
  seq.ticksFired = 0
}

/**
 * How long this particular open runs for.
 *
 * `ART_DIRECTION.md §6` settles at 2.5s and staggers the cards 120ms apart, and those two
 * numbers only fit together up to four cards: the fifth starts at 2.28s and would still be
 * sliding when the results panel took the screen. Finishing a tier routinely fires more than
 * four at once, so the sequence waits for the last card rather than cutting it off. Nothing
 * else moves — every beat keeps its stated time, and an open with no cards is 2.5s exactly.
 * See DECISIONS D-030.
 */
export function sequenceSeconds(seq: OpenSequence): number {
  if (seq.cardCount <= 0) return SEQUENCE_SECONDS
  const lastCardLands = BEATS.cards + (seq.cardCount - 1) * CARD_STAGGER_SECONDS + CARD_SLIDE_SECONDS
  return Math.max(SEQUENCE_SECONDS, lastCardLands)
}

/** True once enough of the sequence has played that skipping is allowed. */
export function canSkip(seq: OpenSequence): boolean {
  return seq.running && seq.elapsed >= SKIPPABLE_AFTER
}

/**
 * Skip to the end.
 *
 * Cleanly, and that word is doing work: a skip must land on exactly the state the sequence
 * would have reached on its own, not on a half-animated frame. So it sets the clock to the
 * end rather than tearing anything down, every getter below reads the same way it would have,
 * and the results panel that follows is identical either way.
 */
export function skipOpenSequence(seq: OpenSequence): boolean {
  if (!canSkip(seq)) return false
  seq.elapsed = sequenceSeconds(seq)
  seq.skipped = true
  seq.running = false
  seq.ticksFired = 1
  return true
}

/**
 * Advance, and return how many mechanical ticks fell in this frame.
 *
 * The stamp owns its own tick emission because only this module knows when the letter lands.
 * Audio subscribes; nothing polls. One tick now rather than one per digit — a rank is one thing.
 */
export function updateOpenSequence(seq: OpenSequence, dt: number): number {
  if (!seq.running) return 0
  const end = sequenceSeconds(seq)
  seq.elapsed = Math.min(end, seq.elapsed + Math.max(0, dt))
  // One tick, on the frame the letter finishes landing.
  const landed = rankReveal(seq) >= 1 ? 1 : 0
  const fired = Math.max(0, landed - seq.ticksFired)
  seq.ticksFired += fired
  if (seq.elapsed >= end) seq.running = false
  return fired
}

/** Where a beat is in its own life, 0 before it starts and 1 once it is done. */
function beatProgress(elapsed: number, start: number, duration: number): number {
  if (duration <= 0) return elapsed >= start ? 1 : 0
  return clamp01((elapsed - start) / duration)
}

/** `1 - (1-t)^3` — the ease-out `ART_DIRECTION.md §5` asks for everywhere. */
export function easeOut(t: number): number {
  const u = 1 - clamp01(t)
  return 1 - u * u * u
}

/** Beat 1: how far through the final accelerating rotation, ease-*in*. */
export function plugAccel(seq: OpenSequence): number {
  const t = beatProgress(seq.elapsed, BEATS.accelerate, BEATS.impact - BEATS.accelerate)
  return t * t
}

/** Beat 2: whole-linework flash to Highlight, 1 → 0 across two frames. */
export function impactFlash(seq: OpenSequence): number {
  if (seq.elapsed < BEATS.impact) return 0
  return 1 - beatProgress(seq.elapsed, BEATS.impact, IMPACT_FLASH_SECONDS)
}

/** Beat 2: the 8px jolt, suppressed by reduced motion. */
export function impactJolt(seq: OpenSequence): number {
  if (seq.reducedMotion) return 0
  const t = beatProgress(seq.elapsed, BEATS.impact, 0.12)
  if (t <= 0 || t >= 1) return 0
  return IMPACT_JOLT_PX * (1 - t) * Math.sin(t * Math.PI * 3)
}

/**
 * Beat 3: the time-dilation factor the *simulation* would be stepped at, were it still
 * running. It is not — the lock is open — so this drives the shackle throw and the camera,
 * and it is the one beat reduced motion keeps at full strength, because slow is not motion.
 */
export function timeScale(seq: OpenSequence): number {
  if (seq.elapsed < BEATS.dilate || seq.elapsed >= BEATS.dilate + DILATION_SECONDS) return 1
  return DILATION_SCALE
}

/** Beat 3: shackle/bolt throw, 0 → 1 with an ease-out. */
export function shackleThrow(seq: OpenSequence): number {
  return easeOut(beatProgress(seq.elapsed, BEATS.dilate, DILATION_SECONDS))
}

/** Beat 4: radial hairline burst, 0 → 1 → gone. Purely positional, so motion-gated. */
export function burst(seq: OpenSequence): number {
  if (seq.reducedMotion) return 0
  const t = beatProgress(seq.elapsed, BEATS.burst, BURST_SECONDS)
  return t <= 0 || t >= 1 ? 0 : Math.sin(t * Math.PI)
}

/** Beat 5: grid sweep outward, 0 → 1. Fades as it goes. */
export function gridSweep(seq: OpenSequence): number {
  if (seq.reducedMotion) return 0
  const t = beatProgress(seq.elapsed, BEATS.sweep, SWEEP_SECONDS)
  return t <= 0 || t >= 1 ? 0 : t
}

/** Beat 6: how far the rank letter has stamped in, 0 → 1. Lands exactly, never near it. */
export function rankReveal(seq: OpenSequence): number {
  const t = beatProgress(seq.elapsed, BEATS.credits, CREDIT_COUNT_SECONDS)
  if (t <= 0) return 0
  if (t >= 1) return 1
  return easeOut(t)
}

/**
 * Beat 7: how far card `i` has slid in, 0 → 1, staggered by 120ms.
 *
 * Several at once is the normal case — finishing a tier can fire four — so they stack rather
 * than overlap, and the stagger is what makes a stack of four readable instead of a pile.
 */
export function cardProgress(seq: OpenSequence, index: number): number {
  const start = BEATS.cards + index * CARD_STAGGER_SECONDS
  return easeOut(beatProgress(seq.elapsed, start, CARD_SLIDE_SECONDS))
}

/** Horizontal offset for card `i`, in logical pixels; zero once it has landed. */
export function cardOffsetX(seq: OpenSequence, index: number): number {
  if (seq.reducedMotion) return 0
  return (1 - cardProgress(seq, index)) * CARD_SLIDE_PX
}

/** Card `i` is on screen at all — reduced motion pops it in at its beat rather than sliding. */
export function cardVisible(seq: OpenSequence, index: number): boolean {
  return seq.elapsed >= BEATS.cards + index * CARD_STAGGER_SECONDS
}

/** The whole sequence is over and the results panel owns the screen. */
export function isSettled(seq: OpenSequence): boolean {
  return seq.elapsed >= sequenceSeconds(seq)
}

/** Which beat is currently showing, by name — for tests and the debug overlay. */
export function currentBeat(seq: OpenSequence): keyof typeof BEATS {
  const names = Object.keys(BEATS) as (keyof typeof BEATS)[]
  let current: keyof typeof BEATS = 'accelerate'
  for (const name of names) {
    if (seq.elapsed >= BEATS[name]) current = name
  }
  return current
}
