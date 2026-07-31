import { describe, expect, it } from 'vitest'
import {
  DT,
  PROFILES,
  approxEqual,
  clamp,
  clamp01,
  cloneSimState,
  countEvents,
  createSimState,
  damp,
  drainEvents,
  hold,
  isSecurityPin,
  lerp,
  moveToward,
  profileByName,
  seconds,
  snapshotSimState,
  stepTicks,
  totalTicks,
} from '../../src/sim'
import { PERFECT_CONFIG, THREE_PIN, holdFor, tensionOnly } from './fixtures'

describe('numeric helpers', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-5, 0, 3)).toBe(0)
    expect(clamp(1, 0, 3)).toBe(1)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(-2)).toBe(0)
    expect(clamp01(0.4)).toBe(0.4)
  })

  it('moves toward a target without overshooting, in both directions', () => {
    expect(moveToward(0, 10, 3)).toBe(3)
    expect(moveToward(10, 0, 3)).toBe(7)
    expect(moveToward(0, 1, 5)).toBe(1)
    expect(moveToward(1, 0, 5)).toBe(0)
    expect(moveToward(2, 2, 5)).toBe(2)
  })

  it('lerps and damps', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5)
    expect(lerp(4, 4, 0.9)).toBe(4)
    // damp is frame-rate independent: two half steps land where one whole step does.
    const once = damp(0, 1, 5, 0.2)
    const twice = damp(damp(0, 1, 5, 0.1), 1, 5, 0.1)
    expect(twice).toBeCloseTo(once, 12)
    expect(damp(0, 1, 5, 0)).toBe(0)
  })

  it('compares approximately', () => {
    expect(approxEqual(0.1 + 0.2, 0.3)).toBe(true)
    expect(approxEqual(1, 1.5)).toBe(false)
    expect(approxEqual(1, 1.4, 0.5)).toBe(true)
  })
})

describe('profile lookup', () => {
  it('resolves by name', () => {
    expect(profileByName('spool')).toBe(PROFILES.spool)
    expect(profileByName('standard')).toBe(PROFILES.standard)
  })

  it('throws on an unknown name', () => {
    const bogus = 'nope' as unknown as Parameters<typeof profileByName>[0]
    expect(() => profileByName(bogus)).toThrow(/Unknown pin profile/)
  })

  it('identifies security pins', () => {
    expect(isSecurityPin(PROFILES.standard)).toBe(false)
    expect(isSecurityPin(PROFILES.spool)).toBe(true)
    expect(isSecurityPin(PROFILES.serrated)).toBe(true)
    expect(isSecurityPin(PROFILES.mushroom)).toBe(true)
    expect(isSecurityPin(PROFILES['t-pin'])).toBe(true)
    // A wafer's gate is a groove too, but it is the target rather than a trap.
    expect(isSecurityPin(PROFILES.wafer)).toBe(false)
  })
})

describe('tapes and snapshots', () => {
  it('counts ticks and converts seconds', () => {
    expect(seconds(1)).toBe(120)
    expect(seconds(0)).toBe(1)
    expect(seconds(0.045)).toBe(5)
    const tape = [hold(tensionOnly(0.4), 12), hold(tensionOnly(0.5), 8)]
    expect(totalTicks(tape)).toBe(20)
    expect(totalTicks([])).toBe(0)
  })

  it('stepTicks advances exactly n ticks', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    stepTicks(s, tensionOnly(0.4), 37)
    expect(s.ticks).toBe(37)
    expect(s.time).toBeCloseTo(37 * DT, 12)
  })

  it('clones to an independent state', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.5)
    const copy = cloneSimState(s)
    expect(snapshotSimState(copy)).toBe(snapshotSimState(s))

    // Advancing the copy must not touch the original.
    const originalSnapshot = snapshotSimState(s)
    holdFor(copy, tensionOnly(0.9), 1.0)
    expect(snapshotSimState(s)).toBe(originalSnapshot)
    expect(snapshotSimState(copy)).not.toBe(originalSnapshot)

    // …and the arrays really are copies, not shared references.
    copy.chambers[0]!.lift = 99
    expect(s.chambers[0]!.lift).not.toBe(99)
    copy.stats.setOrder.push(7)
    expect(s.stats.setOrder).not.toContain(7)
    copy.rng.a = 12345
    expect(s.rng.a).not.toBe(12345)
  })

  it('a clone resumes identically from the same point', () => {
    const s = createSimState(THREE_PIN, 9, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.4)
    const a = cloneSimState(s)
    const b = cloneSimState(s)
    holdFor(a, tensionOnly(0.6), 2)
    holdFor(b, tensionOnly(0.6), 2)
    expect(snapshotSimState(a)).toBe(snapshotSimState(b))
  })

  it('drains events and counts by type', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    const first = drainEvents(s)
    expect(countEvents(first, 'ATTEMPT_STARTED')).toBe(1)
    expect(s.events).toEqual([])
    holdFor(s, tensionOnly(0.5), 0.5)
    const second = drainEvents(s)
    expect(countEvents(second, 'ATTEMPT_STARTED')).toBe(0)
    expect(countEvents(second, 'PLUG_MOVED')).toBeGreaterThan(0)
    expect(countEvents([], 'PIN_SET')).toBe(0)
  })

  it('bounds the pending event queue on a long unattended run', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    // 200 seconds of plug jitter with nobody draining.
    for (let i = 0; i < 24_000; i += 1) {
      stepTicks(s, tensionOnly(i % 240 < 120 ? 0.5 : 0.2), 1)
    }
    expect(s.events.length).toBeLessThanOrEqual(8192)
  })
})
