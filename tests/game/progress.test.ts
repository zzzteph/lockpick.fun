import { describe, expect, it } from 'vitest'
import { ALL_LOCKS, locksInTier } from '../../src/game/locks'
import {
  MAX_TIER,
  Progress,
  TIER_UNLOCK_REQUIREMENT,
  clampedTiers,
  opensRequiredFor,
  outcomeFrom,
  type AttemptOutcome,
} from '../../src/game/progress'
import { countsForTier, rankEarned } from '../../src/game/ranks'
import { MemoryStorage, loadSave } from '../../src/game/save'
import { PERFECT_TOOLS, createSimState, makeConfig, runTape, solveLock } from '../../src/sim'

function lock(slug: string): (typeof ALL_LOCKS)[number] {
  const def = ALL_LOCKS.find((d) => d.slug === slug)
  if (!def) throw new Error(`no lock ${slug}`)
  return def
}

function outcome(patch: Partial<AttemptOutcome> & { lock: AttemptOutcome['lock'] }): AttemptOutcome {
  return {
    opened: true,
    seconds: patch.lock.par,
    oversets: 1,
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

describe('rank — the only currency there is (D-091)', () => {
  it('is measured against the lock par, scaled by the assist level', () => {
    const def = lock('kestrel-pro-cylinder')
    // Easy is 1.0, so the raw par applies.
    expect(rankEarned(def.par * 0.3, def.par, 'easy')).toBe(0)
    expect(rankEarned(def.par, def.par, 'easy')).toBe(3)
    // Hard buys 2.5x the clock, so the same run ranks better.
    expect(rankEarned(def.par, def.par, 'hard')).toBe(0)
    // Training shows everything and is held to a tighter clock.
    expect(rankEarned(def.par * 0.5, def.par, 'training')).toBeGreaterThan(
      rankEarned(def.par * 0.5, def.par, 'easy'),
    )
  })

  it('records the best rank ever earned, and says when it improved', () => {
    const p = Progress.fresh(new MemoryStorage())
    const def = lock('clear-practice-cutaway')
    const slow = p.completeAttempt(outcome({ lock: def, seconds: def.par * 2, oversets: 0 }))
    expect(slow?.firstOpen).toBe(true)
    expect(slow?.improved, 'a first open is always an improvement').toBe(true)
    const first = slow?.rank ?? 9

    const fast = p.completeAttempt(outcome({ lock: def, seconds: def.par * 0.2, oversets: 0 }))
    expect(fast?.rank).toBe(0)
    expect(fast?.improved).toBe(true)
    expect(fast?.previousBest).toBe(first)
    expect(p.record(def.slug).bestRank).toBe(0)

    // A worse run never spoils the record.
    const worse = p.completeAttempt(outcome({ lock: def, seconds: def.par * 3, oversets: 0 }))
    expect(worse?.improved).toBe(false)
    expect(p.record(def.slug).bestRank).toBe(0)
  })

  it('a lock that was never opened has no rank at all', () => {
    const p = Progress.fresh(new MemoryStorage())
    expect(p.record('clear-practice-cutaway').bestRank).toBeNull()
    expect(countsForTier(null)).toBe(false)
  })

  it('records the day it was played on, which the old daily field never did (D-090)', () => {
    const p = Progress.fresh(new MemoryStorage())
    p.completeAttempt(outcome({ lock: lock('clear-practice-cutaway') }), '2026-07-30')
    p.completeAttempt(outcome({ lock: lock('brasswell-no1-luggage') }), '2026-07-30')
    p.completeAttempt(outcome({ lock: lock('northgate-shed-padlock') }), '2026-07-31')
    expect(Object.keys(p.data.playDays).sort()).toEqual(['2026-07-30', '2026-07-31'])
    expect(p.data.playDays['2026-07-30']).toBe(2)
  })

  it('a failed attempt records nothing', () => {
    const p = Progress.fresh(new MemoryStorage())
    expect(p.completeAttempt(outcome({ lock: lock('clear-practice-cutaway'), opened: false }))).toBeNull()
    expect(p.data.records).toEqual({})
  })
})

describe('tier gating — GAME_DESIGN.md §5', () => {
  function fresh(): Progress {
    return Progress.fresh(new MemoryStorage())
  }

  function openLock(progress: Progress, slug: string): void {
    progress.completeAttempt(outcome({ lock: lock(slug), seconds: 10, oversets: 0 }))
  }

  it('starts with only Tier 1 unlocked', () => {
    const p = fresh()
    expect(p.isTierUnlocked(1)).toBe(true)
    expect(p.isTierUnlocked(2)).toBe(false)
    expect(p.highestUnlockedTier).toBe(1)
  })

  it('unlocks Tier 2 on the third distinct Tier 1 open, not the third attempt', () => {
    const p = fresh()
    const tier1 = locksInTier(1)
    // Opening the same lock repeatedly does not count three times.
    for (let i = 0; i < 5; i += 1) openLock(p, tier1[0]?.slug ?? '')
    expect(p.opensInTier(1)).toBe(1)
    expect(p.isTierUnlocked(2)).toBe(false)

    openLock(p, tier1[1]?.slug ?? '')
    openLock(p, tier1[2]?.slug ?? '')
    expect(p.opensInTier(1)).toBe(3)
    expect(p.isTierUnlocked(2)).toBe(true)
    expect(p.highestUnlockedTier).toBe(2)
  })

  it('reports how many more opens a locked tier needs', () => {
    const p = fresh()
    expect(p.opensNeededFor(2)).toBe(TIER_UNLOCK_REQUIREMENT[2])
    openLock(p, locksInTier(1)[0]?.slug ?? '')
    expect(p.opensNeededFor(2)).toBe((TIER_UNLOCK_REQUIREMENT[2] ?? 0) - 1)
    expect(p.opensNeededFor(1)).toBe(0)
  })

  /**
   * The roster is authored across phases, so a stated requirement can temporarily exceed the
   * locks below it. That must never make a tier unreachable — this test both enforces that
   * and reports which tiers are currently clamped, so the gap stays visible.
   */
  it('never states a requirement that cannot be met with the locks that exist', () => {
    for (let tier = 2; tier <= MAX_TIER; tier += 1) {
      const available = locksInTier(tier - 1).length
      if (available === 0) continue
      expect(opensRequiredFor(tier), `tier ${tier}`).toBeLessThanOrEqual(available)
      expect(opensRequiredFor(tier), `tier ${tier}`).toBeGreaterThan(0)
    }
    // Recorded rather than asserted away: this is the list Phase 9 and Phase 13 must empty.
    const clamped = clampedTiers()
    for (const c of clamped) {
      expect(c.available, `tier ${c.tier} has no locks below it`).toBeGreaterThan(0)
    }
  })

  it('lets a player reach every tier that has locks below it', () => {
    const p = fresh()
    for (let tier = 2; tier <= MAX_TIER; tier += 1) {
      const below = locksInTier(tier - 1)
      if (below.length === 0) break
      for (const def of below) openLock(p, def.slug)
      expect(p.isTierUnlocked(tier), `tier ${tier} should be reachable`).toBe(true)
    }
  })

  it('will not skip a tier, however many later locks are somehow opened', () => {
    const p = fresh()
    for (const def of locksInTier(3)) openLock(p, def.slug)
    expect(p.opensInTier(3)).toBeGreaterThanOrEqual(4)
    // Tier 2 is still locked, so Tier 4 cannot open either.
    expect(p.isTierUnlocked(2)).toBe(false)
    expect(p.isTierUnlocked(4)).toBe(false)
  })

  it('exposes only the locks a player may attempt', () => {
    const p = fresh()
    const available = p.availableLocks()
    expect(available.every((d) => d.tier === 1)).toBe(true)
    expect(available.length).toBe(locksInTier(1).length)
    expect(p.isLockAvailable(lock('halberd-deadbolt'))).toBe(false)
  })
})

describe('records and credits', () => {
  it('keeps the best time and the fewest oversets across attempts', () => {
    const p = Progress.fresh(new MemoryStorage())
    const def = lock('clear-practice-cutaway')
    p.completeAttempt(outcome({ lock: def, seconds: 40, oversets: 3 }))
    p.completeAttempt(outcome({ lock: def, seconds: 18, oversets: 1 }))
    p.completeAttempt(outcome({ lock: def, seconds: 25, oversets: 0 }))
    const r = p.record(def.slug)
    expect(r.opens).toBe(3)
    expect(r.bestTime).toBe(18)
    expect(r.bestOversets).toBe(0)
  })

  it('ignores an attempt that did not open the lock', () => {
    const p = Progress.fresh(new MemoryStorage())
    const def = lock('clear-practice-cutaway')
    expect(p.completeAttempt(outcome({ lock: def, opened: false }))).toBeNull()
    expect(p.record(def.slug).opens).toBe(0)
    expect(p.record(def.slug).bestRank).toBeNull()
  })

  it('grants an achievement once each', () => {
    const p = Progress.fresh(new MemoryStorage())
    expect(p.unlockAchievement('first-blood')).toBe(true)
    expect(p.unlockAchievement('first-blood')).toBe(false)
  })

  it('autosaves after every open and settings change', () => {
    const storage = new MemoryStorage()
    const p = Progress.fresh(storage)
    p.completeAttempt(outcome({ lock: lock('clear-practice-cutaway'), seconds: 12, oversets: 0 }))
    expect(loadSave(storage).data.records['clear-practice-cutaway']?.bestRank).toBe(
      p.record('clear-practice-cutaway').bestRank,
    )

    p.updateSettings({ sensitivity: 1.6 })
    expect(loadSave(storage).data.settings.sensitivity).toBe(1.6)
  })

  it('reloads from storage into an identical state', () => {
    const storage = new MemoryStorage()
    const first = Progress.fresh(storage)
    first.completeAttempt(outcome({ lock: lock('brasswell-no1-luggage'), seconds: 20, oversets: 0 }))
    first.updateSettings({ assist: 'medium' })

    const second = new Progress(storage)
    expect(second.data).toEqual(first.data)
  })
})

describe('the kit, and gating — D-088', () => {
  it('the stat block the simulation reads is the same one every time', () => {
    const p = Progress.fresh(new MemoryStorage())
    const first = p.toolStats()
    p.completeAttempt(outcome({ lock: lock('clear-practice-cutaway'), seconds: 10, oversets: 0 }))
    expect(p.toolStats()).toEqual(first)
  })

  it('reach is no longer a wall — the kit reaches the deepest lock in the roster', () => {
    const p = Progress.fresh(new MemoryStorage())
    const deepest = Math.max(...ALL_LOCKS.map((d) => d.bitting.length))
    expect(p.toolStats().reach).toBeGreaterThanOrEqual(deepest)
    expect(p.toolStats().fitsTightKeyway).toBe(true)
  })

  it('but the kit is not perfect: jitter and pick strain are still real', () => {
    // If these went to zero, precision would stop being a skill and the pick could never bend.
    const stats = Progress.fresh(new MemoryStorage()).toolStats()
    expect(stats.liftJitter).toBeGreaterThan(0)
    expect(stats.strength).toBeLessThan(100)
  })

  it('every pressure step the wheel offers passes through unclamped', () => {
    const stats = Progress.fresh(new MemoryStorage()).toolStats()
    expect(stats.tensionMin).toBeLessThanOrEqual(0.12)
    expect(stats.tensionMax).toBeGreaterThanOrEqual(0.95)
  })

  it('attemptability is a question of tier and nothing else', () => {
    const p = Progress.fresh(new MemoryStorage())
    expect(p.canAttempt(lock('clear-practice-cutaway'))).toBe(true)
    // A locked tier still blocks.
    expect(p.canAttempt(lock('halberd-deadbolt'))).toBe(false)
    // Every lock in an open tier is attemptable, whatever family it is.
    for (const def of locksInTier(1)) {
      expect(p.canAttempt(def), def.slug).toBe(true)
    }
  })

  it('feathering arrives with Tier 3 and is not bought', () => {
    const p = Progress.fresh(new MemoryStorage())
    expect(p.hasFeathering).toBe(false)
    for (const def of [...locksInTier(1), ...locksInTier(2)]) {
      p.completeAttempt(outcome({ lock: def, seconds: 10, oversets: 0 }))
    }
    expect(p.isTierUnlocked(3)).toBe(true)
    expect(p.hasFeathering).toBe(true)
  })
})

describe('a real solved attempt feeds the records', () => {
  it('turns a solver run into an outcome, a payout and a record', () => {
    const def = lock('ironhold-spool-trainer')
    const config = makeConfig({ tools: PERFECT_TOOLS, featherEnabled: true })
    const solved = solveLock(def, 3, config)
    expect(solved.opened).toBe(true)

    // Replay the solver's tape so we have a genuine finished state, not a hand-built one.
    const state = createSimState(def, 3, config)
    runTape(state, solved.tape, { stopOnOpen: true })
    expect(state.opened).toBe(true)

    const attempt = outcomeFrom(def, state, state.stats)
    expect(attempt.bindOrder.length).toBeGreaterThan(0)
    expect(attempt.setOrder).toHaveLength(def.bitting.length)
    expect(attempt.falseSets).toBeGreaterThan(0)

    const progress = Progress.fresh(new MemoryStorage())
    const result = progress.completeAttempt(attempt)
    expect(result).not.toBeNull()
    expect(result?.firstOpen).toBe(true)
    expect(result?.rank).toBe(progress.record(def.slug).bestRank)
    expect(progress.record(def.slug).opens).toBe(1)
    expect(progress.record(def.slug).bestTime).toBeCloseTo(state.time, 6)
  })
})

/**
 * `Next lock` — DECISIONS D-121.
 *
 * The button on the results screen that carries you on without a trip through the bench. What is
 * asserted here is the *choice*, which is the whole of it: the drawing is one `button()` call.
 */
describe('the lock after this one', () => {
  function fresh(): Progress {
    return Progress.fresh(new MemoryStorage())
  }

  function openLock(progress: Progress, slug: string): void {
    progress.completeAttempt(outcome({ lock: lock(slug), seconds: 1, oversets: 0 }))
  }

  it('is the next lock in bench order', () => {
    const p = fresh()
    const tier1 = locksInTier(1)
    const first = tier1[0] as (typeof ALL_LOCKS)[number]
    expect(p.nextLockAfter(first)?.slug).toBe(tier1[1]?.slug)
  })

  it('skips locks already opened — "next" has to mean forward', () => {
    const p = fresh()
    const tier1 = locksInTier(1)
    openLock(p, tier1[1]?.slug ?? '')
    openLock(p, tier1[2]?.slug ?? '')
    // 2 and 3 are done, so after 1 comes 4.
    expect(p.nextLockAfter(tier1[0] as (typeof ALL_LOCKS)[number])?.slug).toBe(tier1[3]?.slug)
  })

  it('wraps to the front of the roster rather than dead-ending on the last lock', () => {
    const p = fresh()
    const tier1 = locksInTier(1)
    const last = tier1[tier1.length - 1] as (typeof ALL_LOCKS)[number]
    // Only Tier 1 is unlocked on a fresh save, so the wrap has to come back to its first lock.
    expect(p.nextLockAfter(last)?.slug).toBe(tier1[0]?.slug)
  })

  it('never offers a locked tier — it cannot be a way around the gate', () => {
    const p = fresh()
    expect(p.isTierUnlocked(2)).toBe(false)
    for (const d of locksInTier(1)) {
      const next = p.nextLockAfter(d)
      expect(next, d.slug).not.toBeNull()
      expect(p.isTierUnlocked(next?.tier ?? 99), `${d.slug} -> ${next?.slug}`).toBe(true)
    }
  })

  it('falls back to bench order once everything available is opened', () => {
    const p = fresh()
    const tier1 = locksInTier(1)
    for (const d of tier1) openLock(p, d.slug)
    // Tier 2 is unlocked by now, so the next unopened lock is its first.
    expect(p.isTierUnlocked(2)).toBe(true)
    const next = p.nextLockAfter(tier1[0] as (typeof ALL_LOCKS)[number])
    expect(next?.tier).toBe(2)
  })

  it('is null for a lock that is not in the roster', () => {
    // A lesson lock or one of the player's own designs. "Next" has no meaning for either, and a
    // wrong answer is worse than no button.
    const base = ALL_LOCKS[0]
    expect(base).toBeDefined()
    if (!base) return
    expect(fresh().nextLockAfter({ ...base, id: 10_001, slug: 'my-own-lock' })).toBeNull()
  })
})
