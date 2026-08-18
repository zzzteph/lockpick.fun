/**
 * The Lock streak — five minutes, as many locks as you can, scored by the sum of their tiers.
 *
 * The second design of the mode, replacing D-199's endless chain at the owner's word (D-205):
 * the chain only ever ended on a mistake, so its best score measured patience rather than
 * skill, and it punished stopping — real life ended a session and the mode read it as
 * failure. A hard five-minute window gives every run identical stakes, a number anyone can
 * read, and a clock that makes the tension economy (D-203/D-204) the drama: haste wants a
 * heavy hand, and a heavy hand meets walls.
 *
 * Scoring is the **sum of tiers** of the locks opened — the owner's pick over a raw count or
 * a within-run ramp — so the deal stays honestly random over everything the bench has
 * unlocked while a run heavy in deep locks is worth what it cost. A tier-4 open is four
 * tier-1s.
 *
 * The bench's whole philosophy is "nothing is random, every lock is the same lock every
 * time" (D-073) — this screen is still the deliberate exception, and the extra time on every
 * dealt lock's par below is what that exception costs the house: an unseen binding order
 * cannot be known.
 *
 * Everything here is pure; `src/app.ts` owns the run's clock and `save.ts` owns the bests.
 */

import type { LockDef } from '../sim'
import { createRng, nextInt } from '../sim'
import { generateDungeonLock } from './gauntlet'

/** The window. Five minutes flat — the owner's number, and short enough for "one more run". */
export const STREAK_SECONDS = 300

/**
 * Half again the bench clock, baked into every dealt lock's par.
 *
 * A bench lock is *your* copy — same binding order every sitting (D-073) — and its par assumes
 * you can learn it. A dealt lock exists for one attempt, so the knowledge the bench par prices
 * in simply is not available. 1.5× is the assist ladder's own gap between Easy and Medium: the
 * house rate for picking blind-er than usual.
 */
export const STREAK_TIME_BONUS = 1.5

/**
 * Far above the dungeon's own band (50 000 + salt), for the same reason that band sits above
 * `CUSTOM_ID_BASE`: nothing that filters by id may mistake a dealt lock for anything else.
 */
export const STREAK_ID_BASE = 60_000

/** One finished run, as the save keeps it: the score, and the opens behind it for colour. */
export interface StreakScore {
  /** Sum of the opened locks' tiers. */
  readonly score: number
  readonly opens: number
}

/** Whether a finished run takes the best's place. Score first; opens break ties. */
export function beatsScore(run: StreakScore, best: StreakScore | undefined): boolean {
  if (!best) return true
  if (run.score !== best.score) return run.score > best.score
  return run.opens > best.opens
}

/**
 * Which tier a deal comes from: uniform across everything the bench has unlocked.
 *
 * `roll` is a plain 0..1 so the caller owns the randomness — the app hands in `Math.random()`,
 * a test hands in a number and gets an answer it can assert. Uniform deliberately, and with
 * sum-of-tiers scoring it is also *fair*: a run dealt more deep locks is dealt more points'
 * worth of work, not more luck.
 */
export function streakTierFor(roll: number, highestUnlocked: number): 1 | 2 | 3 | 4 {
  const top = Math.max(1, Math.min(4, Math.floor(highestUnlocked)))
  const r = Math.min(0.999999, Math.max(0, roll))
  return (1 + Math.floor(r * top)) as 1 | 2 | 3 | 4
}

/**
 * The catalogue's brands, shelved the way the roster shelves them, so a dealt lock reads like
 * something that could have hung on the bench rather than like generated content. The serial
 * is the tell that it is not.
 */
const STREAK_BRANDS: Record<1 | 2 | 3 | 4, readonly string[]> = {
  1: ['Brasswell', 'Northgate'],
  2: ['Northgate', 'Kestrel', 'Ironhold'],
  3: ['Ironhold', 'Kestrel', 'Halberd'],
  4: ['Halberd', 'Meridian'],
}

/**
 * One dealt lock. Pin tumblers only — **never a wheel pack**, by the owner's word: a wheel is
 * decoded at its own pace and the Streak is a picking rhythm.
 *
 * The mechanism is the dungeon forge's, unchanged — `generateDungeonLock` already deals legal
 * locks from the editor's own space, ramped by tier (D-165, docs/DUNGEON.md) — and this
 * function only dresses one for the bench: a catalogue-shaped name that states its tier, a par
 * priced like the roster's, and the time bonus on top.
 *
 * The par formula is fitted to the roster, not invented: ~12s a chamber, ~22s a security pin,
 * and a premium as the tolerance window tightens below 1.0. Against every catalogue cylinder
 * the forge could have dealt — standard keyway, no sidebar, no magnets — it lands inside the
 * roster's own band (asserted in `tests/game/streak.test.ts`), so a dealt rank means what a
 * bench rank does, before `STREAK_TIME_BONUS` pays for the lock being a stranger.
 */
export function generateStreakLock(seed: number, n: number, tier: 1 | 2 | 3 | 4): LockDef {
  const base = generateDungeonLock(seed, n, tier, false)
  const rng = createRng(((((seed ^ 0x517cc1b7) >>> 0) + n * 40503) >>> 0) || 1)
  const brands = STREAK_BRANDS[tier]
  const brand = brands[nextInt(rng, brands.length)] ?? 'Brasswell'
  const serial = 2 + nextInt(rng, 97)
  const security = base.pins.filter((p) => p !== 'standard').length
  const par = Math.round(
    (base.bitting.length * 12 + security * 22 + Math.max(0, 1 - base.toleranceQuality) * 60) *
      STREAK_TIME_BONUS,
  )
  return {
    ...base,
    id: STREAK_ID_BASE + (n % 1000),
    slug: `streak-${seed >>> 0}-${n}`,
    // The tier in the name, deliberately: the deal is blind, the tier is the lock's price on
    // the scoreboard, and "how hard is this one" is the first thing a hand on the wrench asks.
    name: `${brand} No.${serial} — tier ${tier}`,
    tier,
    par,
    note: 'Dealt off the pile. The clock does not stop.',
  }
}

/** m:ss for the run clock. */
export function blitzClock(secondsLeft: number): string {
  const s = Math.max(0, Math.ceil(secondsLeft))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
