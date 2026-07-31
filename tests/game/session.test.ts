import { describe, expect, it } from 'vitest'
import { Session } from '../../src/game/session'
import { percentile, startLoop } from '../../src/game/loop'
import { ALL_LOCKS, findLock, lockById, lockBySlug, locksInTier } from '../../src/game/locks'
import { DT, PERFECT_TOOLS, makeConfig, validateLockDef, type SimInput } from '../../src/sim'

const CONFIG = makeConfig({ tools: PERFECT_TOOLS })

function input(patch: Partial<SimInput> = {}): SimInput {
  return {
    chamber: -1,
    liftTarget: 0,
    tensionHeld: false,
    tensionLevel: 0,
      ...patch,
  }
}

describe('lock roster', () => {
  it('validates every definition at load', () => {
    expect(ALL_LOCKS.length).toBeGreaterThan(0)
    for (const def of ALL_LOCKS) {
      expect(() => {
        validateLockDef(def)
      }, def.slug).not.toThrow()
    }
  })

  it('has unique ids and slugs', () => {
    expect(new Set(ALL_LOCKS.map((d) => d.id)).size).toBe(ALL_LOCKS.length)
    expect(new Set(ALL_LOCKS.map((d) => d.slug)).size).toBe(ALL_LOCKS.length)
  })

  it('looks up by id, slug, or either', () => {
    const first = ALL_LOCKS[0]
    if (!first) throw new Error('empty roster')
    expect(lockById(first.id)).toBe(first)
    expect(lockBySlug(first.slug)).toBe(first)
    expect(findLock(first.id)).toBe(first)
    expect(findLock(first.slug)).toBe(first)
    expect(findLock(String(first.id))).toBe(first)
    expect(findLock(99_999)).toBeUndefined()
    expect(findLock('no-such-lock')).toBeUndefined()
  })

  it('groups by tier, and every tier has locks in it', () => {
    const tiers = [...new Set(ALL_LOCKS.map((d) => d.tier))].sort((a, b) => a - b)
    expect(tiers, 'four tiers since D-104 cut the disc detainers').toEqual([1, 2, 3, 4])
    for (const tier of tiers) {
      expect(locksInTier(tier).length, `tier ${tier}`).toBe(
        ALL_LOCKS.filter((d) => d.tier === tier).length,
      )
      expect(locksInTier(tier).length, `tier ${tier} is empty`).toBeGreaterThan(0)
    }
    // …and nothing beyond the last one.
    expect(locksInTier(6)).toEqual([])
  })
})

describe('Session — fixed timestep and interpolation', () => {
  const def = ALL_LOCKS[1]
  if (!def) throw new Error('need at least two locks')

  it('runs whole ticks only, never a partial one', () => {
    const s = new Session(def, 1, CONFIG)
    s.advance(DT * 2.5, input())
    expect(s.state.ticks).toBe(2)
    expect(s.alpha).toBeCloseTo(0.5, 6)
    s.advance(DT * 0.6, input())
    expect(s.state.ticks).toBe(3)
    expect(s.alpha).toBeCloseTo(0.1, 6)
  })

  it('does not step at all for a sub-tick frame', () => {
    const s = new Session(def, 1, CONFIG)
    const events = s.advance(DT * 0.4, input())
    expect(s.state.ticks).toBe(0)
    expect(events).toEqual([])
  })

  it('caps catch-up so a stalled tab cannot spiral', () => {
    const s = new Session(def, 1, CONFIG)
    s.advance(10, input())
    // 0.25s of catch-up at 1/120 is 30 ticks, not 1200.
    expect(s.state.ticks).toBe(30)
  })

  it('interpolates continuous values and snaps discrete ones', () => {
    const s = new Session(def, 1, CONFIG)
    const target = 3.0
    const held = input({ chamber: 0, liftTarget: target, tensionHeld: true, tensionLevel: 0.5 })
    // Stop while the pin is genuinely mid-travel, so the two ticks really do differ.
    for (let i = 0; i < 200 && (s.state.chambers[0]?.lift ?? 0) < target * 0.4; i += 1) {
      s.advance(DT, held)
    }
    const before = s.state.chambers[0]?.lift ?? 0
    expect(before).toBeGreaterThan(0)
    expect(before).toBeLessThan(target)
    s.advance(DT, held)
    const after = s.state.chambers[0]?.lift ?? 0
    expect(after).not.toBe(before)

    const half = s.syncView(0.5)
    expect(half.chambers[0]?.lift).toBeCloseTo((before + after) / 2, 9)
    expect(half.chambers[0]?.state).toBe(s.state.chambers[0]?.state)

    expect(s.syncView(0).chambers[0]?.lift).toBeCloseTo(before, 9)
    expect(s.syncView(1).chambers[0]?.lift).toBeCloseTo(after, 9)
  })

  /**
   * The view's running tally is the attempt's, not a frozen copy — DECISIONS D-112.
   *
   * `syncView` copies a hand-written list of fields, and its own comment says why that is
   * dangerous: *"a field added to `SimState` and forgotten here is silently frozen at its cloned
   * value forever"*. `stats` was forgotten. The constructor's `cloneSimState` gave the view a
   * `stats` of its own and nothing ever wrote to it again, so for the whole of every attempt the
   * renderer saw every counter at zero.
   *
   * It cost nothing for as long as nothing read it, which is the point: the bug was invisible
   * until the first thing that did read it — the "hold Q" banner — refused to go away. Anything
   * else on that list can rot the same way, so this asserts the property rather than the field.
   */
  it('gives the view the live stats, not the ones it was cloned with', () => {
    const s = new Session(def, 1, CONFIG)
    expect(s.syncView().stats.maxTension, 'nothing held yet').toBe(0)
    for (let i = 0; i < 60; i += 1) s.advance(DT, input({ tensionHeld: true, tensionLevel: 0.6 }))
    expect(s.state.stats.maxTension, 'the simulation recorded the wrench').toBeGreaterThan(0)
    expect(
      s.syncView().stats.maxTension,
      'and the view has to see it — a renderer reading a frozen tally draws a lie',
    ).toBe(s.state.stats.maxTension)
    // It must keep tracking rather than latch once.
    const seen = s.syncView().stats
    for (let i = 0; i < 60; i += 1) s.advance(DT, input({ tensionHeld: true, tensionLevel: 0.9 }))
    expect(s.syncView().stats.maxTension).toBe(s.state.stats.maxTension)
    expect(s.syncView().stats.maxTension).toBeGreaterThan(seen.maxTension - 1e-9)
  })

  it('clamps the interpolation factor', () => {
    const s = new Session(def, 1, CONFIG)
    for (let i = 0; i < 30; i += 1) s.advance(DT, input({ tensionHeld: true, tensionLevel: 0.5 }))
    expect(s.syncView(5).theta).toBeCloseTo(s.state.theta, 12)
    expect(s.syncView(-5).theta).toBeCloseTo(s.syncView(0).theta, 12)
  })

  it('never lets the view be mistaken for the real state', () => {
    const s = new Session(def, 1, CONFIG)
    for (let i = 0; i < 30; i += 1) s.advance(DT, input({ tensionHeld: true, tensionLevel: 0.5 }))
    expect(s.view).not.toBe(s.state)
    expect(s.view.chambers[0]).not.toBe(s.state.chambers[0])
  })

  it('restarts with a fresh tolerance seed and a clean state', () => {
    const s = new Session(def, 1, CONFIG)
    const deltasBefore = s.state.chambers.map((c) => c.delta)
    for (let i = 0; i < 240; i += 1) {
      s.advance(DT, input({ chamber: 0, liftTarget: 1.5, tensionHeld: true, tensionLevel: 0.5 }))
    }
    expect(s.state.ticks).toBe(240)

    s.restart()
    expect(s.seed).toBe(2)
    expect(s.state.ticks).toBe(0)
    expect(s.state.chambers.every((c) => c.state === 'FREE')).toBe(true)
    expect(s.state.chambers.map((c) => c.delta)).not.toEqual(deltasBefore)
    expect(s.alpha).toBe(0)

    s.restart(1)
    expect(s.state.chambers.map((c) => c.delta)).toEqual(deltasBefore)
  })

  it('returns the events emitted during the frame', () => {
    const s = new Session(def, 1, CONFIG)
    const events = s.advance(DT * 4, input({ tensionHeld: true, tensionLevel: 0.5 }))
    expect(events.some((e) => e.type === 'ATTEMPT_STARTED')).toBe(true)
  })

  it('accepts a config change for later attempts', () => {
    const s = new Session(def, 1, CONFIG)
    s.setConfig(makeConfig({ tools: PERFECT_TOOLS, featherEnabled: true }))
    s.restart(3)
    expect(s.state.config.featherEnabled).toBe(true)
  })
})

describe('frame loop', () => {
  /** Stub the browser globals the loop needs so it can be driven deterministically. */
  function withFakeRaf<T>(fn: () => T): T {
    const g = globalThis as unknown as Record<string, unknown>
    const saved = {
      raf: g['requestAnimationFrame'],
      caf: g['cancelAnimationFrame'],
      perf: g['performance'],
    }
    g['requestAnimationFrame'] = (): number => 1
    g['cancelAnimationFrame'] = (): void => undefined
    let clock = 0
    g['performance'] = {
      now: (): number => {
        clock += 0.5
        return clock
      },
    }
    try {
      return fn()
    } finally {
      g['requestAnimationFrame'] = saved.raf
      g['cancelAnimationFrame'] = saved.caf
      g['performance'] = saved.perf
    }
  }

  it('records frame times and can be driven manually', () => {
    withFakeRaf(() => {
      const seen: number[] = []
      const loop = startLoop((s) => seen.push(s))
      loop.setManual(true)
      loop.tick(1 / 60)
      loop.tick(1 / 30)
      expect(seen).toHaveLength(2)
      expect(loop.stats.frames).toBe(2)
      expect(loop.stats.last).toBeCloseTo(1000 / 30, 6)
      expect(loop.stats.history).toHaveLength(2)
      expect(loop.stats.work).toHaveLength(2)
      loop.stop()
    })
  })

  it('bounds the frame-time history', () => {
    withFakeRaf(() => {
      const loop = startLoop(() => undefined)
      loop.setManual(true)
      for (let i = 0; i < 900; i += 1) loop.tick(1 / 60)
      expect(loop.stats.history.length).toBeLessThanOrEqual(600)
      expect(loop.stats.work.length).toBeLessThanOrEqual(600)
      expect(loop.stats.frames).toBe(900)
      loop.stop()
    })
  })

  it('computes percentiles', () => {
    const history = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(history, 0)).toBe(1)
    expect(percentile(history, 100)).toBe(10)
    expect(percentile(history, 50)).toBe(6)
    expect(percentile([], 50)).toBe(0)
    expect(percentile([4], 95)).toBe(4)
  })
})
