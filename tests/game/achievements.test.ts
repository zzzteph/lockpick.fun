/**
 * The achievements — `PHASES.md` Phase 11.
 *
 * The requirement is precise and it is not "each has a test": it is that **every one of them has
 * a test proving it can fire**, and that **none is unreachable against the current rules, not the
 * spec**. So the table below builds, for each id, the exact world in which that achievement
 * becomes true, and one loop asserts that every id in `ACHIEVEMENTS` appears in it and fires.
 * Adding one without a scenario fails the suite.
 *
 * Thirty-eight, not the forty `CONTENT.md §3` lists: `rake-and-run` and `rake-master` went with
 * the rake (D-058). The counts below are asserted against the catalogue as it now is, and the
 * group totals with them — a spec number kept as a target after the content behind it was removed
 * is a test that fails for the right reason and gets "fixed" by putting the content back.
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
import { CHALLENGES } from '../../src/game/challenges'
import { ALL_LOCKS, chambersOf, locksInTier } from '../../src/game/locks'
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

/** Every lock opened, every challenge cleared somewhere. */
function everything(): SaveData {
  const records: Record<string, LockRecord> = {}
  for (const d of ALL_LOCKS) records[d.slug] = record({ challenges: CHALLENGES.map((c) => c.id) })
  return save({ records })
}

/** Every Tier 1 and Tier 2 lock opened under par. */
function speedRunSave(): SaveData {
  const records: Record<string, LockRecord> = {}
  for (const d of [...locksInTier(1), ...locksInTier(2)]) {
    records[d.slug] = record({ bestTime: d.par - 1 })
  }
  return save({ records })
}


/**
 * One world per achievement, in which that achievement — and only what it implies — is true.
 *
 * These are hand-built rather than played, on purpose. Several conditions describe states a
 * playthrough would take hours to reach (fifty resets, fifteen minutes, twenty-five opens),
 * and a test that cannot reach them is a test that cannot prove they fire.
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
  completionist: () => ({ outcome: null, save: everything() }),

  'single-pin-purist': () => {
    const def = lockOf((d) => chambersOf(d) >= 5, 'five or more chambers')
    return { outcome: attempt({ lock: def }), save: save() }
  },
  'feather-touch': () => ({
    outcome: attempt({ lock: ALL_LOCKS[0] as LockDef, feathers: 1, oversets: 1 }),
    save: save(),
  }),
  'push-through': () => {
    const def = lockOf((d) => d.pins.filter((p) => p === 'spool').length >= 4, 'four spools')
    return { outcome: attempt({ lock: def, securityPinsSet: 4, resets: 0 }), save: save() }
  },
  'not-fooled': () => ({
    outcome: attempt({ lock: ALL_LOCKS[0] as LockDef, falseSets: 3 }),
    save: save(),
  }),
  'light-hand': () => ({
    outcome: attempt({ lock: ALL_LOCKS[0] as LockDef, maxTension: 0.28 }),
    save: save(),
  }),
  'iron-grip': () => ({
    outcome: attempt({ lock: ALL_LOCKS[0] as LockDef, minTensionWhileHeld: 0.74 }),
    save: save(),
  }),
  'clean-sweep': () => {
    const locks = locksInTier(1)
    return {
      outcome: attempt({ lock: locks[locks.length - 1] as LockDef, oversets: 0 }),
      save: opened(locks),
    }
  },
  architect: () => ({ outcome: null, save: save({ customLocks: [ALL_LOCKS[0] as LockDef] }) }),
  prolific: () => ({
    outcome: null,
    save: save({ customLocks: [0, 1, 2, 3, 4].map(() => ALL_LOCKS[0] as LockDef) }),
  }),
  'own-medicine': () => ({
    outcome: attempt({ lock: { ...(ALL_LOCKS[0] as LockDef), id: 10_000 } }),
    save: save(),
  }),
  'every-cylinder': () => {
    const cylinders = ALL_LOCKS.filter((d) => d.family === 'pin-tumbler')
    return { outcome: null, save: opened(cylinders) }
  },
  surgeon: () => {
    const def = lockOf((d) => d.tier >= 4, 'a Tier 4+ lock')
    return { outcome: attempt({ lock: def, oversets: 0 }), save: save() }
  },

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
  'half-par': () => {
    const def = ALL_LOCKS[0] as LockDef
    return { outcome: attempt({ lock: def, seconds: def.par / 2 - 1 }), save: save() }
  },
  'speed-run': () => ({ outcome: null, save: speedRunSave() }),
  'no-second-chances': () => {
    const def = lockOf((d) => d.tier >= 4, 'a Tier 4+ lock')
    return {
      outcome: attempt({ lock: def, resets: 0 }),
      save: save({ records: { [def.slug]: record({ opens: 1 }) } }),
    }
  },
  'the-sovereign': () => {
    const def = ALL_LOCKS.find((d) => d.id === 31)
    return { outcome: null, save: def ? opened([def]) : save() }
  },

  /*
   * `wafer-thin`, `dimpled` and `round-and-round` stood here for families cut in D-088, and
   * `disc-jockey` and `high-security` for the disc detainers cut in D-104. All five outlived the
   * achievements they built a world for: the catalogue loop only asks that every achievement *has*
   * a scenario, so a scenario for an achievement that no longer exists was never once run and
   * never once complained. The reverse assertion is in the catalogue suite now.
   */
  sidebar: () => ({
    outcome: null,
    save: opened(ALL_LOCKS.filter((d) => d.sidebar !== undefined)),
  }),
  'cracked-it': () => {
    const def = ALL_LOCKS.find((d) => d.id === 36)
    return { outcome: null, save: def ? opened([def]) : save() }
  },

  'flawless-tier': () => ({ outcome: null, save: opened(locksInTier(1)) }),
  regular: () => ({
    outcome: null,
    save: save({
      playDays: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`2026-07-0${i + 1}`, 1])),
    }),
  }),
  persistent: () => ({
    outcome: attempt({ lock: ALL_LOCKS[0] as LockDef, resets: 50 }),
    save: save(),
  }),
  patience: () => ({
    outcome: attempt({ lock: ALL_LOCKS[0] as LockDef, seconds: 15 * 60 }),
    save: save(),
  }),
  curious: () => ({
    outcome: null,
    save: save({ records: { x: record({ opens: 25 }) } }),
  }),
}

// ── The suite ───────────────────────────────────────────────────────────────────────────

describe('the achievement catalogue', () => {
  it('is the thirty-four left after the inventory and the disc detainers were removed', () => {
    // Was 38. The shop went with D-088 and took *Well Equipped*, *Full Kit* and *Frugal* with it;
    // *One Tool* became *Clean Sweep*, and the wafer, dimple and tubular family trophies became
    // editor and cylinder ones. D-104 cut the disc detainers and took *Disc Jockey* and
    // *High Security* — "open every Tier 5 lock", of which there are none. Nothing left is
    // unreachable.
    expect(ACHIEVEMENTS).toHaveLength(34)
  })

  it('has unique ids and names', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length)
    expect(new Set(ACHIEVEMENTS.map((a) => a.name)).size).toBe(ACHIEVEMENTS.length)
  })

  it('is spread across all five groups, with none of them empty', () => {
    // The exact split moved with the roster cut (D-088) and will move again with the next content
    // change. What has to hold is that every group is worth opening: a group with one plate in it
    // is a heading with nothing under it.
    const groups = ['progression', 'technique', 'mastery', 'family', 'bench'] as const
    let total = 0
    for (const g of groups) {
      const n = achievementsInGroup(g).length
      expect(n, g).toBeGreaterThanOrEqual(3)
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
   * The paired assertion, and the one that was missing. Five scenarios outlived their achievements
   * across two content cuts — worlds built, and never once run, because the loop below iterates
   * `ACHIEVEMENTS` and a scenario nothing indexes is simply never asked for. That is this
   * project's own stated failure mode: code that is present, tested-looking, and inert.
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
        // Unreachable is allowed — but only for the reason the achievement declares, and the
        // roster test below is what keeps that list from quietly growing.
        expect(a.test(ctx), `${a.id} claims to be unreachable but fired`).toBe(false)
        return
      }
      expect(a.test(ctx), `${a.id} did not fire in its own scenario`).toBe(true)
    })
  }
})

describe('reachability against the roster that actually exists', () => {
  it('names every unreachable achievement, and each names a lock that is not built', () => {
    const blocked = unreachableAchievements()
    // Only the two that name a specific Tier 6 lock may be unreachable, and only while those
    // locks are unauthored. Phase 13 adds #31; #36 may be cut, per CONTENT.md §1.
    const allowed = new Set(['the-sovereign', 'cracked-it'])
    const unexpected = blocked.filter((a) => !allowed.has(a.id)).map((a) => a.id)
    expect(unexpected, 'an achievement became unearnable').toEqual([])
    for (const a of blocked) {
      const id = a.id === 'the-sovereign' ? 31 : 36
      expect(ALL_LOCKS.some((d) => d.id === id), `${a.id}`).toBe(false)
    }
  })

  it('becomes reachable the moment the lock it names is authored', () => {
    // Proven by construction rather than by mutating the roster: `reachable()` is a lookup on
    // `ALL_LOCKS`, and the paired test above shows it currently returns false for exactly the
    // ids whose lock is absent. Adding the lock flips it — which is what Phase 13 will do.
    const sovereign = achievementById('the-sovereign')
    expect(sovereign).toBeDefined()
    expect(sovereign?.reachable()).toBe(ALL_LOCKS.some((d) => d.id === 31))
  })
})

describe('newlyEarned', () => {
  it('returns only what is newly true, in declaration order', () => {
    const ctx = SCENARIOS['master-of-the-bench']?.()
    expect(ctx).toBeDefined()
    if (!ctx) return
    const first = newlyEarned(ctx)
    expect(first.map((a) => a.id)).toContain('master-of-the-bench')
    // Declaration order: progression before family, always.
    const ids = ACHIEVEMENTS.map((a) => a.id)
    const positions = first.map((a) => ids.indexOf(a.id))
    expect(positions).toEqual([...positions].sort((x, y) => x - y))

    // Nothing fires twice.
    const already = { ...ctx, save: { ...ctx.save, achievements: first.map((a) => a.id) } }
    expect(newlyEarned(already)).toEqual([])
  })

  it('fires several at once when one open completes several conditions', () => {
    const ctx = SCENARIOS['completionist']?.()
    expect(ctx).toBeDefined()
    if (!ctx) return
    const earned = newlyEarned(ctx)
    // Opening the last lock in the game completes the whole progression column and every
    // family column at the same moment. That stack is exactly what the card beat animates.
    expect(earned.length).toBeGreaterThan(4)
    expect(earned.map((a) => a.id)).toContain('completionist')
    expect(earned.map((a) => a.id)).toContain('master-of-the-bench')
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
    expect(first.map((a) => a.id)).toContain('half-par')
    expect(progress.hasAchievement('first-blood')).toBe(true)

    // Same attempt again: the records move on, but nothing already earned re-fires.
    const second = progress.claimAchievements(o)
    expect(second.map((a) => a.id)).not.toContain('first-blood')

    // And it survives a reload.
    const reloaded = new Progress(storage)
    expect(reloaded.hasAchievement('first-blood')).toBe(true)
  })

  it('Clean Sweep needs the tier finished *and* the finishing lock clean', () => {
    const storage = new MemoryStorage()
    const progress = Progress.fresh(storage)
    const tier1 = locksInTier(1)
    for (const def of tier1) progress.completeAttempt(attempt({ lock: def }))
    const last = tier1[tier1.length - 1] as LockDef

    // Tier complete, but the finishing attempt jammed a pin.
    expect(
      progress.claimAchievements(attempt({ lock: last, oversets: 2 })).map((a) => a.id),
    ).not.toContain('clean-sweep')
    // Same tier, clean attempt.
    expect(
      progress.claimAchievements(attempt({ lock: last, oversets: 0 })).map((a) => a.id),
    ).toContain('clean-sweep')
  })
})

describe('the conditions are not accidentally always true', () => {
  const negatives: Record<string, () => AchievementContext> = {
    'single-pin-purist': () => ({
      outcome: attempt({ lock: lockOf((d) => chambersOf(d) < 5, 'small'), oversets: 0 }),
      save: save(),
    }),
    'light-hand': () => ({
      outcome: attempt({ lock: ALL_LOCKS[0] as LockDef, maxTension: 0.31 }),
      save: save(),
    }),
    'iron-grip': () => ({
      outcome: attempt({ lock: ALL_LOCKS[0] as LockDef, minTensionWhileHeld: 0.69 }),
      save: save(),
    }),
    surgeon: () => ({
      outcome: attempt({ lock: lockOf((d) => d.tier >= 4, 'T4+'), oversets: 1 }),
      save: save(),
    }),
    'under-par': () => {
      const def = ALL_LOCKS[0] as LockDef
      return { outcome: attempt({ lock: def, seconds: def.par + 1 }), save: save() }
    },
    'feather-touch': () => ({
      // Feathered, but nothing was ever overset — there was nothing to recover from.
      outcome: attempt({ lock: ALL_LOCKS[0] as LockDef, feathers: 2, oversets: 0 }),
      save: save(),
    }),
    'clean-sweep': () => {
      const locks = locksInTier(1)
      return {
        // Tier complete, but the finishing attempt jammed a pin.
        outcome: attempt({ lock: locks[locks.length - 1] as LockDef, oversets: 1 }),
        save: opened(locks),
      }
    },
    architect: () => ({ outcome: null, save: save({ customLocks: [] }) }),
    'own-medicine': () => ({ outcome: attempt({ lock: ALL_LOCKS[0] as LockDef }), save: save() }),
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
    const failed = attempt({ lock: def, opened: false, seconds: 1, falseSets: 9, resets: 99 })
    const earned = newlyEarned({ outcome: failed, save: save() })
    expect(earned.map((a) => a.id)).not.toContain('under-par')
    expect(earned.map((a) => a.id)).not.toContain('persistent')
    expect(earned.map((a) => a.id)).not.toContain('not-fooled')
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
    // Or *Iron Grip* is earned by a lock nobody ever put a wrench in.
    expect(o.minTensionWhileHeld).toBe(0)
    expect(achievementById('iron-grip')?.test({ outcome: o, save: save() })).toBe(false)
  })
})
