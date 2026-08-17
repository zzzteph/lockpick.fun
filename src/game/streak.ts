/**
 * The Streak — random locks, dealt one after another, and a chain that only counts opens.
 *
 * The mode in one sentence: press the button, get a lock you have never met, open it and the
 * chain grows; snap the pick or walk away and the chain breaks. The bench's whole philosophy is
 * "nothing is random, every lock is the same lock every time" (D-073) — this screen is the
 * deliberate exception, and the extra time on the clock below is what that exception costs the
 * house: an unseen binding order cannot be known, so the par is half again what the same
 * cylinder would carry on the bench.
 *
 * Everything here is pure — chain arithmetic over two small records, and a generator that
 * dresses the dungeon forge's output for the bench — so the whole mode's logic is testable
 * headlessly. `src/app.ts` owns when a chain extends or breaks; `save.ts` owns where the two
 * chains live. See DECISIONS D-199.
 */

import type { LockDef } from '../sim'
import { createRng, nextInt } from '../sim'
import { generateDungeonLock } from './gauntlet'
import { letterFor } from './ranks'

/**
 * A chain: how many locks fell in a row, wearing the **worst** rank any of them earned.
 *
 * Worst, not best or last, because a chain is as strong as its weakest link — five opens where
 * one of them slipped to a B is a B ×5, and the only way to wear an S is to have never dropped
 * below one. `rank` is an index into `RANKS` (0 is S), stored the same way `LockRecord.bestRank`
 * is and for the same reason: indexes compare with `<`, letters are presentation.
 */
export interface StreakChain {
  readonly rank: number
  readonly count: number
}

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

/** One more open. A fresh chain starts at ×1 wearing exactly what it just earned. */
export function extendChain(current: StreakChain | null, rank: number): StreakChain {
  if (!current) return { rank, count: 1 }
  return { rank: Math.max(current.rank, rank), count: current.count + 1 }
}

/**
 * Whether a fallen chain takes the best's place. Length first — the mode is called the Streak,
 * and seven sloppy opens in a row are a longer streak than three clean ones — with the cleaner
 * letter breaking ties.
 */
export function beatsChain(chain: StreakChain, best: StreakChain | null): boolean {
  if (!best) return true
  if (chain.count !== best.count) return chain.count > best.count
  return chain.rank < best.rank
}

/** `S ×3`, or an em-dash when no chain stands. The screen's whole vocabulary. */
export function chainLabel(chain: StreakChain | null): string {
  return chain ? `${letterFor(chain.rank)} ×${chain.count}` : '—'
}

/**
 * Which tier a deal comes from: uniform across everything the bench has unlocked.
 *
 * `roll` is a plain 0..1 so the caller owns the randomness — the app hands in `Math.random()`,
 * a test hands in a number and gets an answer it can assert. Uniform deliberately: weighting
 * toward the deep end would turn a mode about rhythm into a mode about the hardest tier, and
 * the tier-1 breathers are part of what makes a long chain a story.
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
    // The tier in the name, deliberately: the deal is blind, and "how hard is this one" is the
    // first thing a hand on the wrench wants to know.
    name: `${brand} No.${serial} — tier ${tier}`,
    par,
    note: 'Dealt off the pile. The chain only counts opens.',
  }
}
