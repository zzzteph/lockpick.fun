/**
 * The achievements — `CONTENT.md §3`. Forty when the spec was written, thirty-four now: the shop
 * took three with it (D-088) and the disc detainers took two more (D-104).
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
 * longer matches an entry and is ignored — nothing has to migrate.
 */

import type { AttemptOutcome } from './progress'
import { ALL_LOCKS, chambersOf, locksInTier } from './locks'
import { CHALLENGES } from './challenges'
import type { LockDef, LockFamily } from '../sim'
import { PROFILES, isSecurityPin } from '../sim'
import type { LockRecord, SaveData } from './save'

export type AchievementGroup = 'progression' | 'technique' | 'mastery' | 'family' | 'bench'

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

function family(f: LockFamily): readonly LockDef[] {
  return ALL_LOCKS.filter((d) => d.family === f)
}

function sidebarLocks(): readonly LockDef[] {
  return ALL_LOCKS.filter((d) => d.sidebar !== undefined)
}

function lockExists(id: number): boolean {
  return ALL_LOCKS.some((d) => d.id === id)
}

function records(save: SaveData): LockRecord[] {
  return Object.values(save.records)
}

/** How many chambers on this lock carry a driver that can lie. */
function securityPinCount(def: LockDef): number {
  return def.pins.filter((p) => isSecurityPin(PROFILES[p])).length
}

/** How many spools specifically — *Push Through* is about spools, not security pins at large. */
function spoolCount(def: LockDef): number {
  return def.pins.filter((p) => p === 'spool').length
}

const DAILY_TARGET = 7
const PERSISTENT_RESETS = 50
const PATIENCE_SECONDS = 15 * 60
const CURIOUS_OPENS = 25

const always = (): boolean => true

// ── The thirty-four ───────────────────────────────────────────────────────────────────────────

export const ACHIEVEMENTS: readonly Achievement[] = [
  // ── Progression (7) ──
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
  // (D-104), rather than sitting permanently grey in the case. *Specialist* is the capstone of the
  // progression ladder now, which is what "the last tier" means once there are four of them.
  {
    id: 'master-of-the-bench',
    name: 'Master of the Bench',
    condition: 'Open every lock in the game',
    group: 'progression',
    reachable: always,
    test: ({ save }) => allOpened(save, ALL_LOCKS),
  },
  {
    id: 'completionist',
    name: 'Completionist',
    condition: 'Every lock, and every challenge modifier, at least once',
    group: 'progression',
    reachable: () => CHALLENGES.length > 0,
    test: ({ save }) => {
      if (!allOpened(save, ALL_LOCKS)) return false
      const cleared = new Set(records(save).flatMap((r) => r.challenges))
      return CHALLENGES.every((c) => cleared.has(c.id))
    },
  },

  // ── Technique (8) ──
  {
    id: 'single-pin-purist',
    name: 'Single Pin Purist',
    // The "without raking once" clause went with the rake (D-058). Every open is single-pin now,
    // so what is left is the part that was always the real ask: do it on a five-pin lock or more.
    condition: 'Open a lock of five chambers or more',
    group: 'technique',
    reachable: () => ALL_LOCKS.some((d) => chambersOf(d) >= 5),
    test: ({ outcome: o }) => o !== null && o.opened && chambersOf(o.lock) >= 5,
  },
  {
    id: 'feather-touch',
    name: 'Feather Touch',
    condition: 'Recover from an overset with a feather, then open the lock',
    group: 'technique',
    reachable: always,
    test: ({ outcome: o }) => o !== null && o.opened && o.feathers > 0 && o.oversets > 0,
  },
  {
    id: 'push-through',
    name: 'Push Through',
    condition: 'Set four spools in a single attempt without resetting',
    group: 'technique',
    reachable: () => ALL_LOCKS.some((d) => spoolCount(d) >= 4),
    test: ({ outcome: o }) =>
      o !== null && o.opened && o.resets === 0 && spoolCount(o.lock) >= 4 && o.securityPinsSet >= 4,
  },
  {
    id: 'not-fooled',
    name: 'Not Fooled',
    condition: 'Recognise and escape three false sets in one attempt',
    group: 'technique',
    reachable: () => ALL_LOCKS.some((d) => securityPinCount(d) >= 2),
    test: ({ outcome: o }) => o !== null && o.opened && o.falseSets >= 3,
  },
  /**
   * `rake-and-run` and `rake-master` were here — "open a Tier 1/2 lock by raking alone" — and
   * went with the rake itself (D-058). Ids already banked in a save simply no longer match an
   * entry and are ignored, which is the same thing that happens to any retired trophy.
   */
  {
    id: 'light-hand',
    name: 'Light Hand',
    condition: 'Open a lock without ever exceeding tension 0.3',
    group: 'technique',
    reachable: always,
    test: ({ outcome: o }) => o !== null && o.opened && o.maxTension <= 0.3,
  },
  {
    id: 'iron-grip',
    name: 'Iron Grip',
    condition: 'Open a lock without ever dropping below tension 0.7',
    group: 'technique',
    reachable: always,
    test: ({ outcome: o }) => o !== null && o.opened && o.minTensionWhileHeld >= 0.7,
  },
  {
    // Replaced *One Tool* when the inventory went (D-088): with one kit, "did it bare-handed"
    // is no longer a thing a player can choose. This asks for the same shape of commitment —
    // a whole tier finished, and the last lock of it finished cleanly.
    id: 'clean-sweep',
    name: 'Clean Sweep',
    condition: 'Finish a whole tier, with no oversets on the lock that finishes it',
    group: 'technique',
    reachable: () => [1, 2, 3, 4].some((t) => locksInTier(t).length > 0),
    test: ({ outcome: o, save }) =>
      o !== null && o.opened && o.oversets === 0 && tierComplete(save, o.lock.tier),
  },
  {
    id: 'surgeon',
    name: 'Surgeon',
    condition: 'Open a Tier 4 or higher lock with no oversets',
    group: 'technique',
    reachable: () => ALL_LOCKS.some((d) => d.tier >= 4),
    test: ({ outcome: o }) => o !== null && o.opened && o.lock.tier >= 4 && o.oversets === 0,
  },

  // ── Mastery (9) ──
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
    id: 'half-par',
    name: 'Half Par',
    condition: 'Open a lock in under half its par time',
    group: 'mastery',
    reachable: always,
    test: ({ outcome: o }) => o !== null && o.opened && o.seconds < o.lock.par / 2,
  },
  {
    id: 'speed-run',
    name: 'Speed Run',
    condition: 'Beat par on every Tier 1 and Tier 2 lock',
    group: 'mastery',
    reachable: () => locksInTier(1).length > 0 && locksInTier(2).length > 0,
    test: ({ save }) =>
      [...locksInTier(1), ...locksInTier(2)].every((d) => {
        const best = save.records[d.slug]?.bestTime
        return best !== null && best !== undefined && best < d.par
      }),
  },
  {
    id: 'no-second-chances',
    name: 'No Second Chances',
    condition: 'Open a Tier 4 or higher lock first time, with no resets',
    group: 'mastery',
    reachable: () => ALL_LOCKS.some((d) => d.tier >= 4),
    test: ({ outcome: o, save }) =>
      o !== null &&
      o.opened &&
      o.lock.tier >= 4 &&
      o.resets === 0 &&
      (save.records[o.lock.slug]?.opens ?? 0) === 1,
  },
  {
    id: 'the-sovereign',
    name: 'The Sovereign',
    condition: 'Open the Halberd Sovereign',
    group: 'mastery',
    reachable: () => lockExists(31),
    test: ({ save }) => ALL_LOCKS.some((d) => d.id === 31 && opened(save, d.slug)),
  },

  // ── Family (3) ──
  {
    // The wafer, dimple and tubular families left the roster with D-088, and their achievements
    // left with them rather than sitting permanently grey in the case. These three are about the
    // editor, which is where the variety went.
    id: 'architect',
    name: 'Architect',
    condition: 'Build a lock of your own',
    group: 'bench',
    reachable: always,
    test: ({ save }) => (save.customLocks?.length ?? 0) > 0,
  },
  {
    id: 'prolific',
    name: 'Prolific',
    condition: 'Build five locks of your own',
    group: 'bench',
    reachable: always,
    test: ({ save }) => (save.customLocks?.length ?? 0) >= 5,
  },
  // *Disc Jockey* — "open every disc detainer" — went with the family (D-104), on the same rule
  // that retired the wafer, dimple and tubular trophies: a plate for content the game no longer
  // ships is a plate nobody can earn.
  {
    id: 'own-medicine',
    name: 'A Taste of Your Own',
    condition: 'Open a lock you built yourself',
    group: 'bench',
    reachable: always,
    test: ({ outcome: o }) => o !== null && o.opened && o.lock.id >= 10_000,
  },
  {
    id: 'sidebar',
    name: 'Sidebar',
    condition: 'Open every sidebar lock',
    group: 'family',
    reachable: () => sidebarLocks().length > 0,
    test: ({ save }) => allOpened(save, sidebarLocks()),
  },
  {
    id: 'cracked-it',
    name: 'Cracked It',
    condition: 'Open The Bench Safe',
    group: 'family',
    reachable: () => lockExists(36),
    test: ({ save }) => ALL_LOCKS.some((d) => d.id === 36 && opened(save, d.slug)),
  },

  // ── Bench & odds (7) ──
  {
    id: 'every-cylinder',
    name: 'Every Cylinder',
    condition: 'Open every pin-tumbler lock in the roster',
    group: 'family',
    reachable: () => family('pin-tumbler').length > 0,
    test: ({ save }) => allOpened(save, family('pin-tumbler')),
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
  {
    /**
     * Was *Regular* — "complete seven daily locks" — and it could not be earned by anyone.
     *
     * `save.daily` is declared, migrated and read here, and **nothing has ever written to it**:
     * there is no daily lock feature and there never was. It claimed `reachable: always`, so the
     * trophy room advertised it as available. An unearnable plate that says it is earnable is worse
     * than no plate at all, and worse than an honestly greyed-out one.
     *
     * Replaced with a condition about the thing the player actually does return for.
     */
    id: 'regular',
    name: 'Regular',
    condition: 'Open locks on seven separate days',
    group: 'bench',
    reachable: always,
    test: ({ save }) => Object.keys(save.playDays ?? {}).length >= DAILY_TARGET,
  },
  {
    id: 'persistent',
    name: 'Persistent',
    condition: 'Take fifty resets on one lock, and open it anyway',
    group: 'bench',
    reachable: always,
    test: ({ outcome: o }) => o !== null && o.opened && o.resets >= PERSISTENT_RESETS,
  },
  {
    id: 'patience',
    name: 'Patience',
    condition: 'Spend fifteen minutes on one attempt, and open it',
    group: 'bench',
    reachable: always,
    test: ({ outcome: o }) => o !== null && o.opened && o.seconds >= PATIENCE_SECONDS,
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
