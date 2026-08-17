/**
 * Counter-rotation — SIMULATION.md §4, DECISIONS D-081.
 *
 * A set driver is not latched behind the ledge, it is *wedged against* it: the plug cannot come back
 * under a pin it is already holding. Everything here is one claim in two directions — the plug is
 * ratcheted by the pins that are set, and a pin that is lifted clear of its ledge stops ratcheting
 * and is lost when the plug swings back.
 *
 * Reported from play as "when all set, YOU STILL CAN PUSH IT UP": forcing a false-set spool at low
 * tension drove the plug back past every set chamber's δ, which opened `topStop` (D-071) all the way
 * to the top of travel while the chambers stayed nominally SET. Set in the bookkeeping, unsupported
 * in the geometry — so the drivers could be shoved anywhere and never fell.
 */

import { describe, expect, it } from 'vitest'
import { DT, LEDGE_CLEAR_MM, createSimState, drainEvents, step } from '../../src/sim'
import { FIVE_PIN, PERFECT_CONFIG, SPOOL_LOCK, holdFor, pick, pickAt, tensionOnly } from './fixtures'

/** Work whatever is binding until it leaves BINDING. */
function workBinding(s: ReturnType<typeof createSimState>, T: number, seconds = 6): boolean {
  const b = s.bindingChamber
  if (b < 0) return false
  const c = s.chambers[b]
  if (!c) return false
  const target = c.setLift + c.captureWindow * 0.5
  pickAt(s, b, target, T)
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    step(s, pick(b, target, T), DT)
    if (c.state !== 'BINDING' && c.state !== 'FREE') return true
  }
  return false
}

/** Pick until nothing binds, then let the plug take up its rotation with the pick out. */
function pickAndSettle(s: ReturnType<typeof createSimState>, T: number): void {
  holdFor(s, tensionOnly(T), 0.3)
  for (let pass = 0; pass < 12 && !s.opened; pass += 1) if (!workBinding(s, T)) break
  holdFor(s, tensionOnly(T), 3)
}

describe('a set pin ratchets the plug', () => {
  it('the plug cannot be pushed back past a chamber that is set', () => {
    const s = createSimState(SPOOL_LOCK, 4242, PERFECT_CONFIG)
    pickAndSettle(s, 0.212)
    const set = s.chambers.filter((c) => c.state === 'SET')
    expect(set.length).toBeGreaterThan(0)
    const ratchet = Math.max(...set.map((c) => c.delta))
    expect(s.theta).toBeGreaterThanOrEqual(ratchet)

    // Lean on the spool as hard as the pick can, which is what drives the plug back (D-075).
    const spool = s.chambers[1]
    if (!spool) throw new Error('expected a middle chamber')
    pickAt(s, 1, spool.maxLift, 0.212)
    holdFor(s, pick(1, spool.maxLift, 0.212), 5)

    // It may well come back a long way — but never through a pin it is holding.
    const stillSet = s.chambers.filter((c) => c.state === 'SET')
    for (const c of stillSet) expect(s.theta).toBeGreaterThanOrEqual(c.delta - 1e-9)
  })

  it('a set driver cannot be shoved above the shear line once the plug has turned', () => {
    const s = createSimState(FIVE_PIN, 12345, PERFECT_CONFIG)
    pickAndSettle(s, 0.212)
    expect(s.chambers.every((c) => c.state === 'SET')).toBe(true)
    // Picked, but not turned far enough to open — the state that provoked the report (D-048).
    expect(s.opened).toBe(false)

    const c0 = s.chambers[0]
    if (!c0) throw new Error('expected a first chamber')
    pickAt(s, 0, c0.maxLift, 0.212)
    holdFor(s, pick(0, c0.maxLift, 0.212), 3)
    expect(c0.state).toBe('SET')
    expect(c0.lift).toBeLessThanOrEqual(c0.setLift + 1e-6)
    // The key pin still rises to meet the shear line: that much *is* free, and always was.
    expect(c0.keyLift).toBeLessThanOrEqual(c0.setLift + 1e-6)
  })

  it('easing the wrench does not wind the plug back out from under set pins', () => {
    const s = createSimState(FIVE_PIN, 12345, PERFECT_CONFIG)
    pickAndSettle(s, 0.489)
    const before = s.theta
    // Down to the lightest tension that still holds a pin. θ_demand collapses; θ must not.
    holdFor(s, tensionOnly(0.12), 2)
    const ratchet = Math.max(...s.chambers.filter((c) => c.state === 'SET').map((c) => c.delta))
    expect(s.theta).toBeGreaterThanOrEqual(ratchet)
    expect(s.theta).toBeLessThanOrEqual(before + 1e-9)
  })
})

describe('the pin that is being lifted is the pin that is lost', () => {
  it('a set driver can no longer be lifted clear mid-pick — the ledge ceiling holds it', () => {
    /**
     * This test used to assert the opposite, and the reversal is D-202/D-204 physics being
     * right. The drop needed two things at once: the driver lifted off its ledge AND the plug
     * pulled back underneath it — and the pull only ever came from working a lying groove,
     * which the one pick in your hand cannot do while it is holding the victim up. With the
     * give waist-sized, θ also never rises far mid-pick, so the ceiling above a set driver
     * opens a bare 0.07mm. Probed across every staging the fixture offers: the shove is
     * survived, nothing drops, and no counter reset fires — you cannot un-bank a set pin by
     * mauling it. The `counter` reset path stays in the simulation for the geometries that
     * can still reach it; what this asserts is that ordinary play no longer can.
     */
    const s = createSimState(SPOOL_LOCK, 4242, PERFECT_CONFIG)
    pickAndSettle(s, 0.212)
    const victim = s.chambers.find((c) => c.state === 'SET')
    if (!victim) throw new Error('expected a set chamber')
    drainEvents(s)

    pickAt(s, victim.index, victim.maxLift, 0.489)
    holdFor(s, pick(victim.index, victim.maxLift, 0.489), 3)

    expect(victim.state).toBe('SET')
    // The ceiling the lie's give opens is a whisker — nowhere near the driver's own travel.
    expect(victim.lift).toBeLessThan(victim.setLift + 0.1)
    const events = drainEvents(s)
    expect(events.find((e) => e.type === 'RESET' && e.kind === 'counter')).toBeUndefined()
  })

  it('a driver resting on its ledge still ratchets — the clearance is a real threshold', () => {
    const s = createSimState(FIVE_PIN, 12345, PERFECT_CONFIG)
    pickAndSettle(s, 0.212)
    const c0 = s.chambers[0]
    if (!c0) throw new Error('expected a first chamber')
    expect(c0.state).toBe('SET')
    // Resting exactly on the ledge is not "lifted clear", so it goes on holding the plug.
    expect(c0.lift).toBeLessThan(c0.setLift + LEDGE_CLEAR_MM)
    const theta = s.theta
    holdFor(s, tensionOnly(0.212), 2)
    expect(s.theta).toBeCloseTo(theta, 6)
  })
})

describe('a forced spool has a price', () => {
  it('at working tension the shove holds the spool in its waist; easing off climbs it', () => {
    /**
     * The price went up with D-204. This used to assert that a working-tension shove drove
     * the spool *home* — through the waist to SET — because the wall sat at 0.55 and 0.397
     * was under it. The wall is ≈0.32 now: at working tension the shove pins the driver in
     * the waist and no amount of patience gets it out, which is the whole reason the dial
     * exists. The second half is the technique: ease below the wall and the same push climbs.
     */
    const s = createSimState(SPOOL_LOCK, 4242, PERFECT_CONFIG)
    pickAndSettle(s, 0.397)
    const spool = s.chambers[1]
    if (!spool) throw new Error('expected a middle chamber')
    expect(spool.state).toBe('FALSE_SET')
    pickAt(s, 1, spool.setLift + spool.captureWindow * 0.5, 0.397)
    holdFor(s, pick(1, spool.setLift + spool.captureWindow * 0.5, 0.397), 5)
    expect(spool.state).toBe('FALSE_SET')
    expect(spool.counterForce).toBeGreaterThan(0)

    holdFor(s, pick(1, spool.setLift + spool.captureWindow * 0.5, 0.25), 4)
    expect(spool.state).toBe('SET')
    expect(spool.lift).toBeLessThanOrEqual(spool.setLift + spool.captureWindow + 1e-6)
  })
})
