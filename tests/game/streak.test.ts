/**
 * The Streak — D-199.
 *
 * Three claims worth proving headlessly: the chain arithmetic (grow, wear the worst letter,
 * capture on the break and only then), the deal (always a valid pin-tumbler, never a wheel
 * pack, priced like the roster with the time bonus on top), and the save's coercion of the two
 * chains. Whether a dealt lock is *beatable* is already covered from the other side —
 * `dungeonOpenable.test.ts` proves every cylinder the shared forge can produce, and the Streak
 * deals nothing else.
 */

import { describe, expect, it } from 'vitest'
import { MemoryStorage, migrate, newSave } from '../../src/game/save'
import { Progress } from '../../src/game/progress'
import { RANKS, letterFor } from '../../src/game/ranks'
import { ALL_LOCKS } from '../../src/game/locks'
import {
  STREAK_ID_BASE,
  STREAK_TIME_BONUS,
  beatsChain,
  chainLabel,
  extendChain,
  generateStreakLock,
  streakTierFor,
} from '../../src/game/streak'
import { validateLockDef } from '../../src/sim'

const S = 0
const A = 1
const B = 2
const F = RANKS.length - 1

describe('the chain', () => {
  it('starts at ×1 wearing exactly what it earned', () => {
    expect(extendChain(null, A)).toEqual({ rank: A, count: 1 })
  })

  it('grows by one and wears its worst letter', () => {
    let chain = extendChain(null, S)
    chain = extendChain(chain, S)
    expect(chain).toEqual({ rank: S, count: 2 })
    chain = extendChain(chain, B)
    expect(chain).toEqual({ rank: B, count: 3 })
    // A later clean open cannot polish the letter back up: the B stays in the chain.
    chain = extendChain(chain, S)
    expect(chain).toEqual({ rank: B, count: 4 })
  })

  it('ranks length first, then the cleaner letter', () => {
    expect(beatsChain({ rank: F, count: 7 }, { rank: S, count: 3 })).toBe(true)
    expect(beatsChain({ rank: S, count: 3 }, { rank: F, count: 7 })).toBe(false)
    expect(beatsChain({ rank: S, count: 3 }, { rank: A, count: 3 })).toBe(true)
    expect(beatsChain({ rank: A, count: 3 }, { rank: S, count: 3 })).toBe(false)
    // A tie beats nothing: the standing best keeps its place.
    expect(beatsChain({ rank: S, count: 3 }, { rank: S, count: 3 })).toBe(false)
    expect(beatsChain({ rank: F, count: 1 }, null)).toBe(true)
  })

  it('prints as the letter times the count', () => {
    expect(chainLabel({ rank: S, count: 3 })).toBe(`${letterFor(S)} ×3`)
    expect(chainLabel(null)).toBe('—')
  })
})

describe('the bookkeeping (Progress)', () => {
  it('grows the current chain on an open and saves it', () => {
    const p = Progress.fresh(new MemoryStorage())
    expect(p.noteStreakOpen(S)).toEqual({ rank: S, count: 1 })
    expect(p.noteStreakOpen(A)).toEqual({ rank: A, count: 2 })
    expect(p.data.streak.current).toEqual({ rank: A, count: 2 })
    // Best is untouched while the chain stands — capture happens at the break, not before.
    expect(p.data.streak.best).toBeNull()
  })

  it('captures the best exactly when a chain breaks', () => {
    const p = Progress.fresh(new MemoryStorage())
    p.noteStreakOpen(S)
    p.noteStreakOpen(S)
    p.noteStreakOpen(S)
    const first = p.breakStreak()
    expect(first).toEqual({ captured: { rank: S, count: 3 }, newBest: true })
    expect(p.data.streak).toEqual({ current: null, best: { rank: S, count: 3 } })

    // A shorter chain falls without taking the best's place.
    p.noteStreakOpen(S)
    const second = p.breakStreak()
    expect(second.newBest).toBe(false)
    expect(p.data.streak.best).toEqual({ rank: S, count: 3 })

    // A longer, sloppier one takes it — length first is the mode's whole name.
    for (let i = 0; i < 4; i += 1) p.noteStreakOpen(F)
    expect(p.breakStreak().newBest).toBe(true)
    expect(p.data.streak.best).toEqual({ rank: F, count: 4 })
  })

  it('breaking with no chain standing is legal and does nothing', () => {
    const p = Progress.fresh(new MemoryStorage())
    expect(p.breakStreak()).toEqual({ captured: null, newBest: false })
    expect(p.data.streak).toEqual({ current: null, best: null })
  })
})

describe('the save', () => {
  it('an old save wakes up with both chains empty', () => {
    const migrated = migrate({ version: 1, credits: 0, opens: {} })
    expect(migrated.streak).toEqual({ current: null, best: null })
  })

  it('round-trips the chains and refuses half-remembered ones', () => {
    const s = newSave()
    s.streak = { current: { rank: 1, count: 4 }, best: { rank: 0, count: 9 } }
    const back = migrate(JSON.parse(JSON.stringify(s)))
    expect(back.streak).toEqual(s.streak)

    // A rank off the ladder is clamped onto it; a count below one is no chain at all.
    const mangled = migrate({
      ...JSON.parse(JSON.stringify(newSave())),
      streak: { current: { rank: 40, count: 2.9 }, best: { rank: 0, count: 0 } },
    })
    expect(mangled.streak.current).toEqual({ rank: RANKS.length - 1, count: 2 })
    expect(mangled.streak.best).toBeNull()
  })
})

describe('the tier roll', () => {
  it('is uniform across exactly the unlocked tiers, and never off the ladder', () => {
    expect(streakTierFor(0, 1)).toBe(1)
    expect(streakTierFor(0.999, 1)).toBe(1)
    expect(streakTierFor(0, 3)).toBe(1)
    expect(streakTierFor(0.34, 3)).toBe(2)
    expect(streakTierFor(0.999, 3)).toBe(3)
    expect(streakTierFor(0.999, 4)).toBe(4)
    // Defensive at both edges: a mad "highest" clamps, and roll = 1 exactly stays in range.
    expect(streakTierFor(1, 4)).toBe(4)
    expect(streakTierFor(0.5, 0)).toBe(1)
    expect(streakTierFor(0.5, 9)).toBeLessThanOrEqual(4)
  })
})

describe('the deal', () => {
  const SEEDS = [1, 88141, 31337, 271828, 999331]

  it('is a valid pin tumbler at every tier — never a wheel pack', () => {
    for (const tier of [1, 2, 3, 4] as const) {
      for (const seed of SEEDS) {
        const def = generateStreakLock(seed, tier * 7 + 1, tier)
        expect(() => validateLockDef(def), `seed ${seed} tier ${tier}`).not.toThrow()
        expect(def.family).toBe('pin-tumbler')
        expect(def.discs).toBeUndefined()
        expect(def.tier).toBe(tier)
        expect(def.id).toBeGreaterThanOrEqual(STREAK_ID_BASE)
        // The deal is blind, so the name says what the hand wants to know first.
        expect(def.name).toContain(`tier ${tier}`)
      }
    }
  })

  it('is the same lock for the same seed — the e2e drives the mode from a known number', () => {
    const a = generateStreakLock(4242, 3, 2)
    const b = generateStreakLock(4242, 3, 2)
    expect(b).toEqual(a)
    const c = generateStreakLock(4243, 3, 2)
    expect(c.slug).not.toBe(a.slug)
  })

  it('prices its par like the roster, with the time bonus on top', () => {
    /**
     * The formula, un-bonused, against every catalogue cylinder the forge could have dealt —
     * standard keyway, no sidebar, no magnets, pins only. Inside the roster's own band rather
     * than to the second: the catalogue's pars carry authored judgment the formula does not
     * pretend to reproduce, but a dealt C must not be another lock's S.
     */
    for (const lock of ALL_LOCKS) {
      if (lock.family !== 'pin-tumbler') continue
      if (lock.sidebar || lock.magneticChambers || lock.keyway !== 'standard') continue
      const security = lock.pins.filter((p) => p !== 'standard').length
      const predicted =
        lock.bitting.length * 12 + security * 22 + Math.max(0, 1 - lock.toleranceQuality) * 60
      expect(predicted, lock.slug).toBeGreaterThanOrEqual(lock.par * 0.6)
      expect(predicted, lock.slug).toBeLessThanOrEqual(lock.par * 1.6)
    }
    // And the dealt lock carries the bonus: its par is the formula's answer times 1.5.
    for (const tier of [1, 2, 3, 4] as const) {
      const def = generateStreakLock(31337, tier, tier)
      const security = def.pins.filter((p) => p !== 'standard').length
      const raw =
        def.bitting.length * 12 + security * 22 + Math.max(0, 1 - def.toleranceQuality) * 60
      expect(def.par).toBe(Math.round(raw * STREAK_TIME_BONUS))
      expect(STREAK_TIME_BONUS).toBe(1.5)
    }
  })
})
