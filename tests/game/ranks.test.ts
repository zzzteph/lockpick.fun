/**
 * Time ranks — DECISIONS D-084.
 */

import { describe, expect, it } from 'vitest'
import { RANKS, rankFor, rankIndexFor, secondsLeftInRank } from '../../src/game/ranks'
import { ALL_LOCKS } from '../../src/game/locks'

describe('the ladder', () => {
  it('starts at S and ends at F', () => {
    expect(RANKS[0]?.letter).toBe('S')
    expect(RANKS[RANKS.length - 1]?.letter).toBe('F')
    expect(RANKS.map((r) => r.letter)).toEqual(['S', 'A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('has strictly widening thresholds, so every rank is reachable', () => {
    for (let i = 1; i < RANKS.length; i += 1) {
      expect(RANKS[i]?.through ?? 0).toBeGreaterThan(RANKS[i - 1]?.through ?? 0)
    }
  })

  it('only falls as time passes — you can never climb back up', () => {
    let previous = 0
    for (let t = 0; t <= 300; t += 0.5) {
      const at = rankIndexFor(t, 60)
      expect(at).toBeGreaterThanOrEqual(previous)
      previous = at
    }
  })

  it('par itself is a C — par is fine, which is what par means', () => {
    expect(rankFor(60, 60)).toBe('C')
    expect(rankFor(59.9, 60)).toBe('C')
    expect(rankFor(60.1, 60)).toBe('D')
  })

  it('an instant open is an S and a hopeless one is an F', () => {
    expect(rankFor(0, 60)).toBe('S')
    expect(rankFor(1e6, 60)).toBe('F')
  })

  it('the same time means different ranks on different locks', () => {
    // The whole reason the thresholds are ratios rather than seconds.
    expect(rankFor(30, 30)).toBe('C')
    expect(rankFor(30, 150)).toBe('S')
  })

  it('survives a nonsense par instead of dividing by zero', () => {
    expect(() => rankFor(10, 0)).not.toThrow()
    expect(rankFor(10, 0)).toBe('F')
  })
})

describe('the countdown', () => {
  it('says how long the current rank has left', () => {
    // S lapses at 0.4 x par = 24s.
    expect(secondsLeftInRank(10, 60)).toBeCloseTo(14, 6)
    expect(secondsLeftInRank(23.9, 60)).toBeCloseTo(0.1, 6)
  })

  it('is null on F, where there is nothing left to lose', () => {
    expect(secondsLeftInRank(1e6, 60)).toBeNull()
  })

  it('never goes negative', () => {
    for (let t = 0; t <= 400; t += 3) {
      const left = secondsLeftInRank(t, 60)
      if (left !== null) expect(left).toBeGreaterThanOrEqual(0)
    }
  })

  it('hitting zero is exactly when the rank changes', () => {
    for (const par of [12, 60, 150]) {
      for (let i = 0; i < RANKS.length - 1; i += 1) {
        const boundary = par * (RANKS[i]?.through ?? 0)
        expect(rankIndexFor(boundary, par)).toBe(i)
        expect(rankIndexFor(boundary + 1e-6, par)).toBe(i + 1)
      }
    }
  })
})

describe('against the real roster', () => {
  it('every shipped lock has a par that makes S achievable and F meaningful', () => {
    for (const def of ALL_LOCKS) {
      expect(def.par, def.slug).toBeGreaterThan(0)
      // S wants a run under 40% of par. On the fastest lock in the game that must still be
      // several seconds, or the top rank is a stopwatch artefact rather than a skill.
      expect(def.par * 0.4, def.slug).toBeGreaterThan(3)
      expect(rankFor(def.par * 0.2, def.par), def.slug).toBe('S')
      expect(rankFor(def.par * 3, def.par), def.slug).toBe('F')
    }
  })
})
