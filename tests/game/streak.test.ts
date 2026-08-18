/**
 * The Lock streak — D-205's five-minute blitz (replacing D-199's chain).
 *
 * Three claims worth proving headlessly: the scoring (sum of tiers, best per difficulty,
 * banked only when a run finishes), the deal (always a valid pin-tumbler, never a wheel pack,
 * priced like the roster with the time bonus on top), and the save's coercion of the bests.
 * Whether a dealt lock is *beatable* is already covered from the other side —
 * `dungeonOpenable.test.ts` proves every cylinder the shared forge can produce, and the
 * Streak deals nothing else.
 */

import { describe, expect, it } from 'vitest'
import { MemoryStorage, migrate, newSave } from '../../src/game/save'
import { Progress } from '../../src/game/progress'
import { ALL_LOCKS } from '../../src/game/locks'
import {
  STREAK_ID_BASE,
  STREAK_SECONDS,
  STREAK_TIME_BONUS,
  beatsScore,
  blitzClock,
  generateStreakLock,
  streakTierFor,
} from '../../src/game/streak'
import { validateLockDef } from '../../src/sim'

describe('the scoring', () => {
  it('is five minutes flat', () => {
    expect(STREAK_SECONDS).toBe(300)
  })

  it('ranks score first, opens breaking ties', () => {
    expect(beatsScore({ score: 12, opens: 4 }, undefined)).toBe(true)
    expect(beatsScore({ score: 12, opens: 4 }, { score: 11, opens: 9 })).toBe(true)
    expect(beatsScore({ score: 11, opens: 9 }, { score: 12, opens: 4 })).toBe(false)
    expect(beatsScore({ score: 12, opens: 6 }, { score: 12, opens: 4 })).toBe(true)
    // A tie beats nothing: the standing best keeps its place.
    expect(beatsScore({ score: 12, opens: 4 }, { score: 12, opens: 4 })).toBe(false)
  })

  it('banks a finished run per difficulty, keeping the better one', () => {
    const p = Progress.fresh(new MemoryStorage())
    expect(p.noteStreakRun('easy', { score: 9, opens: 5 })).toBe(true)
    expect(p.data.streakBest['easy']).toEqual({ score: 9, opens: 5 })
    // A worse run leaves the board alone.
    expect(p.noteStreakRun('easy', { score: 7, opens: 7 })).toBe(false)
    expect(p.data.streakBest['easy']).toEqual({ score: 9, opens: 5 })
    // Difficulties keep separate boards.
    expect(p.noteStreakRun('hard', { score: 3, opens: 1 })).toBe(true)
    expect(p.data.streakBest['easy']).toEqual({ score: 9, opens: 5 })
    expect(p.data.streakBest['hard']).toEqual({ score: 3, opens: 1 })
  })

  it('prints the clock as m:ss, floored at zero', () => {
    expect(blitzClock(300)).toBe('5:00')
    expect(blitzClock(29.4)).toBe('0:30')
    expect(blitzClock(-2)).toBe('0:00')
  })
})

describe('the save', () => {
  it('an old save wakes up with an empty board — D-199 chains are dropped without ceremony', () => {
    const migrated = migrate({
      version: 5,
      records: {},
      streak: { current: { rank: 0, count: 9 }, best: { rank: 1, count: 3 } },
    })
    expect(migrated.streakBest).toEqual({})
    expect('streak' in migrated).toBe(false)
  })

  it('round-trips the bests and refuses half-remembered ones', () => {
    const s = newSave()
    s.streakBest = { easy: { score: 21, opens: 9 }, hard: { score: 4, opens: 1 } }
    const back = migrate(JSON.parse(JSON.stringify(s)))
    expect(back.streakBest).toEqual(s.streakBest)

    const mangled = migrate({
      ...JSON.parse(JSON.stringify(newSave())),
      streakBest: {
        easy: { score: 21.9, opens: 9.2 },
        medium: { score: -3, opens: 1 },
        hard: { score: 'lots', opens: 1 },
      },
    })
    expect(mangled.streakBest['easy']).toEqual({ score: 21, opens: 9 })
    expect(mangled.streakBest['medium']).toBeUndefined()
    expect(mangled.streakBest['hard']).toBeUndefined()
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

  it('is a valid pin tumbler at every tier — never a wheel pack — and its tier is its price', () => {
    for (const tier of [1, 2, 3, 4] as const) {
      for (const seed of SEEDS) {
        const def = generateStreakLock(seed, tier * 7 + 1, tier)
        expect(() => validateLockDef(def), `seed ${seed} tier ${tier}`).not.toThrow()
        expect(def.family).toBe('pin-tumbler')
        expect(def.discs).toBeUndefined()
        // The tier is the scoreboard's unit, so the def must carry the tier it was dealt at.
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
