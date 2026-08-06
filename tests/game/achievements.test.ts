/**
 * The achievements — `PHASES.md` Phase 11.
 *
 * The requirement is precise and it is not "each has a test": it is that **every one of them has
 * a test proving it can fire**, and that **none is unreachable against the current rules, not the
 * spec**. So the table below builds, for each id, the exact world in which that achievement
 * becomes true, and one loop asserts that every id in `ACHIEVEMENTS` appears in it and fires.
 * Adding one without a scenario fails the suite.
 *
 * Thirteen, not the forty `CONTENT.md §3` lists nor the thirty-four this suite once counted:
 * `rake-and-run` and `rake-master` went with the rake (D-058), the shop and disc-detainer cuts
 * took their plates (D-088, D-104), and D-164 was the owner's launch cut down to the spine. The
 * counts below are asserted against the catalogue as it now is — a spec number kept as a target
 * after the content behind it was removed is a test that fails for the right reason and gets
 * "fixed" by putting the content back.
 */

import { describe, expect, it } from 'vitest'
import {
  ACHIEVEMENTS,
  achievementById,
  achievementsInGroup,
  newlyEarned,
  unreachableAchievements,
  type AchievementContext,
} from '../../src/game/achievements'
import { ALL_LOCKS, locksInTier } from '../../src/game/locks'
import { Progress, outcomeFrom, type AttemptOutcome } from '../../src/game/progress'
import { MemoryStorage, newSave, type LockRecord, type SaveData } from '../../src/game/save'
import type { LockDef } from '../../src/sim'

// ── Builders ────────────────────────────────────────────────────────────────────────────

function lockOf(pred: (d: LockDef) => boolean, what: string): LockDef {
  const def = ALL_LOCKS.find(pred)
  if (!def) throw new Error(`no lock matching ${what}`)
  return def
}

function attempt(patch: Partial<AttemptOutcome> & { lock: LockDef }): AttemptOutcome {
  return {
    opened: true,
    seconds: patch.lock.par,
    oversets: 0,
    resets: 0,
    falseSets: 0,
    setOrder: [],
    bindOrder: [],
    feathers: 0,
    maxTension: 0.5,
    minTensionWhileHeld: 0.4,
    securityPinsSet: 0,
    assist: 'easy',
    challenges: [],
    ...patch,
  }
}

function save(patch: Partial<SaveData> = {}): SaveData {
  return { ...newSave(), ...patch }
}

function record(patch: Partial<LockRecord> = {}): LockRecord {
  return { opens: 1, bestTime: 1, bestOversets: 0, bestRank: 0, challenges: [], ...patch }
}

/** A save with the given locks opened. */
function opened(locks: readonly LockDef[], patch: Partial<SaveData> = {}): SaveData {
  const records: Record<string, LockRecord> = {}
  for (const d of locks) records[d.slug] = record()
  return save({ records, ...patch })
}

/**
 * One world per achievement, in which that achievement — and only what it implies — is true.
 *
 * These are hand-built rather than played, on purpose. Several conditions describe states a
 * playthrough would take hours to reach (twenty-five opens, every lock in the game), and a
 * test that cannot reach them is a test that cannot prove they fire.
 */
const SCENARIOS: Record<string, () => AchievementContext> = {
  'first-blood': () => ({
    outcome: attempt({ lock: ALL_LOCKS[0] as LockDef }),
    save: opened([ALL_LOCKS[0] as LockDef]),
  }),
  apprentice: () => ({ outcome: null, save: opened(locksInTier(1)) }),
  journeyman: () => ({ outcome: null, save: opened(locksInTier(2)) }),
  locksmith: () => ({ outcome: null, save: opened(locksInTier(3)) }),
  specialist: () => ({ outcome: null, save: opened(locksInTier(4)) }),
  'master-of-the-bench': () => ({ outcome: null, save: opened(ALL_LOCKS) }),

  'expert-hands': () => ({
    outcome: attempt({ lock: ALL_LOCKS[0] as LockDef, assist: 'medium' }),
    save: save(),
  }),
  'blind-faith': () => ({
    outcome: attempt({ lock: ALL_LOCKS[0] as LockDef, assist: 'hard' }),
    save: save(),
  }),
  'blind-master': () => {
    const def = lockOf((d) => d.tier >= 3, 'a Tier 3+ lock')
    return { outcome: attempt({ lock: def, assist: 'hard' }), save: save() }
  },
  'under-par': () => {
    const def = ALL_LOCKS[0] as LockDef
    return { outcome: attempt({ lock: def, seconds: def.par - 1 }), save: save() }
  },
  // `record()` defaults to bestRank 0 — an S on every lock in the tier is exactly the ask.
  'flawless-tier': () => ({ outcome: null, save: opened(locksInTier(1)) }),

  architect: () => ({ outcome: null, save: save({ customLocks: [ALL_LOCKS[0] as LockDef] }) }),
  curious: () => ({
    outcome: null,
    save: save({ records: { x: record({ opens: 25 }) } }),
  }),

  /*
   * Twenty-one scenarios stood here for the plates D-164 retired — the technique column, the
   * family column, Completionist, the par variants, the endurance oddities. The paired
   * assertions below are why they could not simply be left: a scenario nothing indexes is never
   * run, which is this project's own named failure mode, and the reverse loop now fails on any
   * scenario that outlives its achievement.
   */
}

// ── The suite ───────────────────────────────────────────────────────────────────────────

describe('the achievement catalogue', () => {
  it('is the thirteen of the launch cut', () => {
    // Was 38, then 34 (D-088, D-104), now 13: the owner's D-164 cut, made while entering the
    // Steamworks rows, kept the progression ladder, the difficulty and rank feats, the editor's
    // front door and one long-haul oddity. The number is asserted so the next cut or addition
    // has to come here and say so.
    expect(ACHIEVEMENTS).toHaveLength(13)
  })

  it('has unique ids and names', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length)
    expect(new Set(ACHIEVEMENTS.map((a) => a.name)).size).toBe(ACHIEVEMENTS.length)
  })

  it('is spread across the three groups that remain, with none of them empty', () => {
    // Five groups before D-164; the cut emptied technique and family outright, so the type
    // union shrank with the content. Bench holds two — below the old three-plate bar, kept
    // because a heading with two honest plates beats retiring the editor's column entirely.
    const groups = ['progression', 'mastery', 'bench'] as const
    let total = 0
    for (const g of groups) {
      const n = achievementsInGroup(g).length
      expect(n, g).toBeGreaterThanOrEqual(2)
      total += n
    }
    expect(total).toBe(ACHIEVEMENTS.length)
  })

  it('states a condition for every one, so a plate can be printed', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.condition.length, a.id).toBeGreaterThan(8)
      expect(a.name.length, a.id).toBeGreaterThan(2)
    }
  })

  it('has a scenario for every achievement — none is untested', () => {
    const missing = ACHIEVEMENTS.filter((a) => !(a.id in SCENARIOS)).map((a) => a.id)
    expect(missing).toEqual([])
  })

  /**
   * …and no scenario for an achievement that does not exist.
   *
   * The paired assertion. Five scenarios once outlived their achievements across two content
   * cuts — worlds built, and never once run, because the loop below iterates `ACHIEVEMENTS` and
   * a scenario nothing indexes is simply never asked for. D-164 retired twenty-one at once;
   * this loop is what proves their worlds left with them.
   */
  it('has no scenario left over from an achievement that was removed', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id))
    const orphans = Object.keys(SCENARIOS).filter((id) => !ids.has(id))
    expect(orphans, 'a scenario outlived its achievement').toEqual([])
  })
})

describe('every achievement can fire', () => {
  for (const a of ACHIEVEMENTS) {
    it(`${a.id} — ${a.condition}`, () => {
      const build = SCENARIOS[a.id]
      expect(build, `no scenario for ${a.id}`).toBeDefined()
      if (!build) return
      const ctx = build()
      if (!a.reachable()) {
        expect(a.test(ctx), `${a.id} claims to be unreachable but fired`).toBe(false)
        return
      }
      expect(a.test(ctx), `${a.id} did not fire in its own scenario`).toBe(true)
    })
  }
})

describe('reachability against the roster that actually exists', () => {
  it('leaves nothing unreachable', () => {
    // The allow-list this test once carried is long retired: the-sovereign was authored, the
    // Bench Safe plate was re-pointed (D-163) and then cut with the rest of D-164. An entry
    // appearing here again is a shipped-dead trophy, loudly.
    expect(unreachableAchievements().map((a) => a.id)).toEqual([])
  })

  it('reachability still tracks the roster, not the spec', () => {
    // Proven by construction rather than by mutating the roster: `reachable()` is a lookup on
    // the tier lists, so authoring or cutting a lock moves it without anyone remembering to.
    const specialist = achievementById('specialist')
    expect(specialist).toBeDefined()
    expect(specialist?.reachable()).toBe(locksInTier(4).length > 0)
  })
})

describe('newlyEarned', () => {
  it('returns only what is newly true, in declaration order', () => {
    const ctx = SCENARIOS['master-of-the-bench']?.()
    expect(ctx).toBeDefined()
    if (!ctx) return
    const first = newlyEarned(ctx)
    expect(first.map((a) => a.id)).toContain('master-of-the-bench')
    // Declaration order: progression before mastery, always.
    const ids = ACHIEVEMENTS.map((a) => a.id)
    const positions = first.map((a) => ids.indexOf(a.id))
    expect(positions).toEqual([...positions].sort((x, y) => x - y))

    // Nothing fires twice.
    const already = { ...ctx, save: { ...ctx.save, achievements: first.map((a) => a.id) } }
    expect(newlyEarned(already)).toEqual([])
  })

  it('fires several at once when one open completes several conditions', () => {
    const ctx = SCENARIOS['master-of-the-bench']?.()
    expect(ctx).toBeDefined()
    if (!ctx) return
    const earned = newlyEarned(ctx)
    // Opening the last lock in the game completes the whole progression column at the same
    // moment — and `record()`'s default S ranks bring Flawless with it. That stack is exactly
    // what the card beat animates.
    expect(earned.length).toBeGreaterThan(4)
    expect(earned.map((a) => a.id)).toContain('master-of-the-bench')
    expect(earned.map((a) => a.id)).toContain('flawless-tier')
  })
})

describe('Progress.claimAchievements', () => {
  it('unlocks, persists, and never double-counts', () => {
    const storage = new MemoryStorage()
    const progress = Progress.fresh(storage)
    const def = ALL_LOCKS[0] as LockDef
    const o = attempt({ lock: def, seconds: def.par / 4 })

    progress.completeAttempt(o)
    const first = progress.claimAchievements(o)
    expect(first.map((a) => a.id)).toContain('first-blood')
    expect(first.map((a) => a.id)).toContain('under-par')
    expect(progress.hasAchievement('first-blood')).toBe(true)

    // Same attempt again: the records move on, but nothing already earned re-fires.
    const second = progress.claimAchievements(o)
    expect(second.map((a) => a.id)).not.toContain('first-blood')

    // And it survives a reload.
    const reloaded = new Progress(storage)
    expect(reloaded.hasAchievement('first-blood')).toBe(true)
  })
})

describe('the conditions are not accidentally always true', () => {
  const negatives: Record<string, () => AchievementContext> = {
    'under-par': () => {
      const def = ALL_LOCKS[0] as LockDef
      return { outcome: attempt({ lock: def, seconds: def.par + 1 }), save: save() }
    },
    'expert-hands': () => ({
      outcome: attempt({ lock: ALL_LOCKS[0] as LockDef, assist: 'easy' }),
      save: save(),
    }),
    'blind-master': () => ({
      // Hard, but on a Tier 1 lock — the tier is the half that must not be forgotten.
      outcome: attempt({ lock: lockOf((d) => d.tier === 1, 'a Tier 1 lock'), assist: 'hard' }),
      save: save(),
    }),
    'flawless-tier': () => {
      // Every Tier 1 lock opened, but one of them at rank A — the standard is S across the tier.
      const locks = locksInTier(1)
      const records: Record<string, LockRecord> = {}
      for (const d of locks) records[d.slug] = record()
      const first = locks[0] as LockDef
      records[first.slug] = record({ bestRank: 1 })
      return { outcome: null, save: save({ records }) }
    },
    curious: () => ({
      outcome: null,
      save: save({ records: { x: record({ opens: 24 }) } }),
    }),
    architect: () => ({ outcome: null, save: save({ customLocks: [] }) }),
  }

  for (const [id, build] of Object.entries(negatives)) {
    it(`${id} stays unearned when its condition is missed`, () => {
      const a = achievementById(id)
      expect(a, id).toBeDefined()
      expect(a?.test(build())).toBe(false)
    })
  }

  it('never fires an attempt-shaped achievement on a failed attempt', () => {
    const def = ALL_LOCKS[0] as LockDef
    const failed = attempt({ lock: def, opened: false, seconds: 1, assist: 'hard' })
    const earned = newlyEarned({ outcome: failed, save: save() })
    expect(earned.map((a) => a.id)).not.toContain('under-par')
    expect(earned.map((a) => a.id)).not.toContain('blind-faith')
    expect(earned.map((a) => a.id)).not.toContain('expert-hands')
  })
})

describe('outcomeFrom carries what the achievements need', () => {
  it('captures the facts that are gone by the time the results screen draws', () => {
    const def = ALL_LOCKS[0] as LockDef
    const state = {
      opened: true,
      time: 12.5,
      chambers: [],
      config: { assist: 'hard' as const },
    }
    const stats = {
      setOrder: [0, 1],
      bindOrder: [1, 0],
      oversets: 2,
      fullResets: 1,
      feathers: 3,
      falseSetsEntered: 4,
      maxCounterForce: 0,
      maxResistance: 0,
      maxTension: 0.82,
      minTensionWhileHeld: 0.11,
      elapsed: 12.5,
    }
    const o = outcomeFrom(def, state as never, stats, { challenges: ['no-resets'] })
    expect(o.feathers).toBe(3)
    expect(o.maxTension).toBeCloseTo(0.82)
    expect(o.minTensionWhileHeld).toBeCloseTo(0.11)
    expect(o.assist).toBe('hard')
    expect(o.challenges).toEqual(['no-resets'])
  })

  it('reports zero rather than the sentinel when tension was never held', () => {
    const def = ALL_LOCKS[0] as LockDef
    const stats = {
      setOrder: [],
      bindOrder: [],
      oversets: 0,
      fullResets: 0,
      feathers: 0,
      falseSetsEntered: 0,
      maxCounterForce: 0,
      maxResistance: 0,
      maxTension: 0,
      // The sentinel `minTensionWhileHeld` starts at, meaning "never held".
      minTensionWhileHeld: Infinity,
      elapsed: 0,
    }
    const o = outcomeFrom(
      def,
      { opened: true, time: 0, chambers: [], config: { assist: 'easy' as const } } as never,
      stats,
    )
    // Infinity leaking through would read as "held very hard the whole time" to any consumer
    // of this field — the old Iron Grip was earned exactly that way once, which is why the
    // field is clamped even now that the plate is gone.
    expect(o.minTensionWhileHeld).toBe(0)
  })
})
