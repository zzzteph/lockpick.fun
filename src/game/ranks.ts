/**
 * Time ranks — S down to F, against the lock's own par.
 *
 * A clock counting up tells you how long you have taken and nothing about whether that is good. Par
 * has been on every `LockDef` since the roster was written and was only ever spent at the results
 * screen, so the one number that says "well?" arrived after the attempt was over. These thresholds
 * put it on screen while you are still working: you start at S and watch it fall, which is a
 * different kind of pressure from a number going up and a much better reason to hurry.
 *
 * Ratios rather than seconds, so a rank means the same thing on a two-pin trainer and a twelve-pin
 * dimple. S is comfortably under half par — the run where nothing went wrong and you knew the
 * binding order. C is par exactly: par is *fine*, which is what par means. F is where the clock
 * stops being interesting.
 *
 * Since D-091 this is also the game's **only** currency: credits are gone, tiers unlock on ranks
 * earned rather than on locks merely opened, and the assist ladder is paid out here rather than in
 * money. See DECISIONS D-084 and D-091.
 */

import type { AssistMode } from '../sim'

/** A rank and the multiple of par at which it lapses. `Infinity` for the last one. */
export interface Rank {
  readonly letter: string
  /** You hold this rank while `elapsed <= par * through`. */
  readonly through: number
}

export const RANKS: readonly Rank[] = [
  { letter: 'S', through: 0.4 },
  { letter: 'A', through: 0.6 },
  { letter: 'B', through: 0.85 },
  { letter: 'C', through: 1 },
  { letter: 'D', through: 1.5 },
  { letter: 'E', through: 2.5 },
  { letter: 'F', through: Infinity },
]

/** Index into `RANKS` for a time on a lock. Never -1: F catches everything. */
export function rankIndexFor(elapsed: number, par: number): number {
  const limit = Math.max(1e-6, par)
  for (let i = 0; i < RANKS.length; i += 1) {
    const r = RANKS[i]
    if (r && elapsed <= limit * r.through) return i
  }
  return RANKS.length - 1
}

export function rankFor(elapsed: number, par: number): string {
  return RANKS[rankIndexFor(elapsed, par)]?.letter ?? 'F'
}

/**
 * Seconds left before the current rank lapses, or `null` on F where there is nothing left to lose.
 *
 * Shown as a countdown beside the letter, because "you are on A" is worth much less than "you are
 * on A for another nine seconds".
 */
export function secondsLeftInRank(elapsed: number, par: number): number | null {
  const r = RANKS[rankIndexFor(elapsed, par)]
  if (!r || !Number.isFinite(r.through)) return null
  return Math.max(0, Math.max(1e-6, par) * r.through - elapsed)
}

/**
 * How much of the lock's par each assist level is worth, as a multiplier on the clock you are
 * measured against.
 *
 * These are the old credit multipliers, unchanged, doing a job that means something. Hard hides the
 * pins entirely and a hard run genuinely takes two or three times as long — so under the old model
 * it paid 2.5x money that could not buy anything, and under this one it buys **time**, which is the
 * thing it actually costs you. Training shows you everything, so it is held to a tighter clock.
 *
 * The effect is that the ladder is now a real choice: the same wall-clock attempt is a C on Easy
 * and an S on Hard, and picking blind is rewarded rather than merely respected. See DECISIONS D-091.
 */
export const ASSIST_PAR_SCALE: Record<AssistMode, number> = {
  training: 0.6,
  easy: 1.0,
  medium: 1.5,
  hard: 2.5,
}

/** The par an attempt is actually judged against, once the assist level has had its say. */
export function effectivePar(par: number, assist: AssistMode): number {
  return par * (ASSIST_PAR_SCALE[assist] ?? 1)
}

/**
 * The rank a finished attempt earned, as an index. Lower is better; 0 is S.
 *
 * The one place the two halves meet, so nothing else has to remember to apply the assist scale.
 */
export function rankEarned(seconds: number, par: number, assist: AssistMode): number {
  return rankIndexFor(seconds, effectivePar(par, assist))
}

/**
 * The rank a lock must be opened at to count toward unlocking the next tier — **D**.
 *
 * Not "opened at all", which rewards flailing, and not "opened well", which walls anyone still
 * learning. D is one and a half times par: you have to have actually picked it rather than
 * stumbled through it, and you have plenty of room to be slow about it.
 */
export const TIER_RANK_REQUIREMENT = RANKS.findIndex((r) => r.letter === 'D')

/** Is this record's best rank good enough to count toward the next tier? */
export function countsForTier(bestRank: number | null): boolean {
  return bestRank !== null && bestRank <= TIER_RANK_REQUIREMENT
}

/** The better of two ranks, either of which may be absent. Lower index wins. */
export function bestOf(a: number | null, b: number): number {
  return a === null ? b : Math.min(a, b)
}

export function letterFor(index: number | null): string {
  return index === null ? '—' : (RANKS[index]?.letter ?? 'F')
}
