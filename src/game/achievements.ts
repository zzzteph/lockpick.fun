/**
 * The achievements — `CONTENT.md §3`. Forty when the spec was written, thirty-four after the
 * shop (D-088) and the disc detainers (D-104) took theirs, **thirteen now**: the launch cut of
 * D-164 kept the spine — the progression ladder, the difficulty feats, the rank standard, the
 * editor's front door, one long-haul oddity — and retired the twenty-one plates that asked the
 * player to grind a niche of the simulation for a toast.
 *
 * Each one is a pure predicate over two things and nothing else: the attempt that just
 * finished, and the save as it stands *after* that attempt has been recorded. No achievement
 * reaches into the simulation, keeps its own counter, or fires from anywhere but here.
 *
 * That shape is deliberate and it is what makes `PHASES.md` Phase 11's real requirement
 * cheap — *"no achievement is unreachable — confirm each against the current rules, not the
 * spec"*. A predicate over data can be handed data. Every one of them has a test that
 * builds the state it describes and watches it fire, and a second test walks the whole set
 * against the roster that actually exists to catch the ones that quietly cannot happen.
 *
 * A trophy that leaves takes its id with it. An id already banked in a player's save simply no
 * longer matches an entry and is ignored — nothing has to migrate. That rule has now carried
 * three cuts without a migration, which is the argument for it.
 */

import type { AttemptOutcome } from './progress'
import { ALL_LOCKS, locksInTier } from './locks'
import type { LockDef } from '../sim'
import type { LockRecord, SaveData } from './save'

export type AchievementGroup = 'progression' | 'mastery' | 'bench'

export interface AchievementContext {
  /** The attempt that just finished, or null when checking on a non-pick event. */
  readonly outcome: AttemptOutcome | null
  /** The save *after* the attempt has been applied. */
  readonly save: SaveData
}

export interface Achievement {
  readonly id: string
  readonly name: string
  /** Shown on the plate once earned; hidden behind a silhouette until then. */
  readonly condition: string
  readonly group: AchievementGroup
  /**
   * Whether it can be earned at all against the roster as it currently stands. An achievement
   * that names a lock nobody has authored yet is not a bug in the achievement — but it must
   * be visible, so the trophy room can grey it out honestly and Phase 14 can re-check it.
   */
  readonly reachable: () => boolean
  readonly test: (ctx: AchievementContext) => boolean
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────

function opened(save: SaveData, slug: string): boolean {
  return (save.records[slug]?.opens ?? 0) > 0
}

function allOpened(save: SaveData, locks: readonly LockDef[]): boolean {
  return locks.length > 0 && locks.every((d) => opened(save, d.slug))
}

function tierComplete(save: SaveData, tier: number): boolean {
  return allOpened(save, locksInTier(tier))
}

function records(save: SaveData): LockRecord[] {
  return Object.values(save.records)
}

const CURIOUS_OPENS = 25

const always = (): boolean => true

// ── The thirteen — DECISIONS D-164 ──────────────────────────────────────────────────────
//
// The launch cut, made by the owner while entering the Steam rows: *"leave only next
// achievements … Delete them - they are not needed. Delete in original and steam game."*
// What went, so nobody wonders: the whole technique column (Single Pin Purist, Feather Touch,
// Push Through, Not Fooled, Light Hand, Iron Grip, Clean Sweep, Surgeon), the whole family
// column (The Sovereign, Sidebar, Every Cylinder, Cracked It), Completionist, Half Par, Speed
// Run, No Second Chances, Prolific, A Taste of Your Own, Regular, Persistent and Patience.
// Their ids in existing saves are ignored, per the standing rule; their trophy drawings left
// `src/assets/trophies/` with them (the 1024px masters remain beside the Steam listing).

export const ACHIEVEMENTS: readonly Achievement[] = [
  // ── Progression (6) ──
  {
    id: 'first-blood',
    name: 'First Blood',
    condition: 'Open your first lock',
    group: 'progression',
    reachable: always,
    test: ({ save }) => records(save).some((r) => r.opens > 0),
  },
  {
    id: 'apprentice',
    name: 'Apprentice',
    condition: 'Open every Tier 1 lock',
    group: 'progression',
    reachable: () => locksInTier(1).length > 0,
    test: ({ save }) => tierComplete(save, 1),
  },
  {
    id: 'journeyman',
    name: 'Journeyman',
    condition: 'Open every Tier 2 lock',
    group: 'progression',
    reachable: () => locksInTier(2).length > 0,
    test: ({ save }) => tierComplete(save, 2),
  },
  {
    id: 'locksmith',
    name: 'Locksmith',
    condition: 'Open every Tier 3 lock',
    group: 'progression',
    reachable: () => locksInTier(3).length > 0,
    test: ({ save }) => tierComplete(save, 3),
  },
  {
    id: 'specialist',
    name: 'Specialist',
    condition: 'Open every Tier 4 lock',
    group: 'progression',
    reachable: () => locksInTier(4).length > 0,
    test: ({ save }) => tierComplete(save, 4),
  },
  // *High Security* — "open every Tier 5 lock" — left with the disc detainers that were Tier 5
  // (D-104). *Completionist* left with D-164: every lock and every modifier is a completion the
  // trophy wall itself already narrates, and *Master of the Bench* is the plate that says it.
  {
    id: 'master-of-the-bench',
    name: 'Master of the Bench',
    condition: 'Open every lock in the game',
    group: 'progression',
    reachable: always,
    test: ({ save }) => allOpened(save, ALL_LOCKS),
  },

  // ── Mastery (5) ──
  //
  // The technique column stood here — eight plates from *Single Pin Purist* to *Surgeon* —
  // and went with D-164. What stays is the ladder a player actually climbs: the two harder
  // assist levels, beating par, and holding the S standard across a whole tier.
  {
    id: 'expert-hands',
    name: 'Expert Hands',
    // The plate said "Expert mode" and the test asked for `medium`, because D-046 renamed the
    // four levels and the *text* was not renamed with them. A trophy that tells the player to do
    // something Settings does not offer is a trophy nobody can go and get on purpose.
    condition: 'Open any lock on Medium',
    group: 'mastery',
    reachable: always,
    test: ({ outcome: o }) => o !== null && o.opened && o.assist === 'medium',
  },
  {
    id: 'blind-faith',
    name: 'Hard Won',
    condition: 'Open any lock on Hard',
    group: 'mastery',
    reachable: always,
    test: ({ outcome: o }) => o !== null && o.opened && o.assist === 'hard',
  },
  {
    id: 'blind-master',
    name: 'Hard Master',
    condition: 'Open a Tier 3 or higher lock on Hard',
    group: 'mastery',
    reachable: () => ALL_LOCKS.some((d) => d.tier >= 3),
    test: ({ outcome: o }) => o !== null && o.opened && o.lock.tier >= 3 && o.assist === 'hard',
  },
  {
    id: 'under-par',
    name: 'Under Par',
    condition: 'Beat the par time on any lock',
    group: 'mastery',
    reachable: always,
    test: ({ outcome: o }) => o !== null && o.opened && o.seconds < o.lock.par,
  },
  {
    /**
     * Was *Wealthy* — "hold ten thousand credits at once". Credits are gone (D-091), and this is the
     * condition the rank ladder makes worth asking instead: not a total, but a standard held across
     * a whole tier. It is the achievement that says you can pick, rather than that you turned up.
     */
    id: 'flawless-tier',
    name: 'Flawless',
    condition: 'Earn an S rank on every lock in a tier',
    group: 'mastery',
    reachable: () => [1, 2, 3, 4].some((t) => locksInTier(t).length > 0),
    test: ({ save }) =>
      [1, 2, 3, 4].some((t) => {
        const locks = locksInTier(t)
        return locks.length > 0 && locks.every((d) => (save.records[d.slug]?.bestRank ?? 9) === 0)
      }),
  },

  // ── Bench (2) ──
  {
    id: 'architect',
    name: 'Architect',
    condition: 'Build a lock of your own',
    group: 'bench',
    reachable: always,
    test: ({ save }) => (save.customLocks?.length ?? 0) > 0,
  },
  {
    id: 'curious',
    name: 'Curious',
    condition: 'Open the same lock twenty-five times',
    group: 'bench',
    reachable: always,
    test: ({ save }) => records(save).some((r) => r.opens >= CURIOUS_OPENS),
  },
]

export const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id)
}

export function achievementsInGroup(group: AchievementGroup): readonly Achievement[] {
  return ACHIEVEMENTS.filter((a) => a.group === group)
}

/**
 * Everything newly true, in declaration order.
 *
 * Order matters for the card stack: `ART_DIRECTION.md §6` slides them in staggered by 120ms,
 * and a stable order means the same run always produces the same sequence.
 */
export function newlyEarned(ctx: AchievementContext): Achievement[] {
  const already = new Set(ctx.save.achievements)
  return ACHIEVEMENTS.filter((a) => !already.has(a.id) && a.test(ctx))
}

/** Which achievements cannot currently be earned, and why — used by the roster test. */
export function unreachableAchievements(): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !a.reachable())
}
