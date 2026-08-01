/**
 * Security pins — SIMULATION.md §11, "Security pins".
 *
 * Spools, serrated pins, mushrooms and T-pins are not special-cased anywhere in the model;
 * they are the same band walk with different band data. These tests exist to prove that the
 * behaviours the spec describes in prose actually emerge from that one rule.
 */

import { describe, expect, it } from 'vitest'
import {
  DT,
  PERFECT_TOOLS,
  PROFILES,
  THETA_OPEN,
  countEvents,
  createSimState,
  drainEvents,
  falseSetLifts,
  step,
  type SimState,
} from '../../src/sim'
import {
  FIVE_PIN,
  MUSHROOM_LOCK,
  PERFECT_CONFIG,
  SERRATED_LOCK,
  SPOOL_LOCK,
  configWith,
  holdFor,
  makeLock,
  pickAt,
  pick,
  tensionOnly,
} from './fixtures'

const FIVE_SPOOL = makeLock({
  slug: 'five-spool',
  bitting: [3.0, 3.1, 2.9, 3.2, 3.0],
  pins: ['spool', 'spool', 'spool', 'spool', 'spool'],
  toleranceQuality: 0.95,
  tier: 3,
})

const SINGLE_SPOOL = makeLock({
  slug: 'single-spool',
  bitting: [3.0],
  pins: ['spool'],
  toleranceQuality: 1.0,
  tier: 3,
})

/** Lift a chamber to a target and hold, returning its state. */
function holdAt(s: SimState, chamber: number, lift: number, tension: number, seconds: number): void {
  holdFor(s, pick(chamber, lift, tension), seconds)
}

describe('a spool at its waist', () => {
  it('reports FALSE_SET and swings the plug far past its own delta', () => {
    const s = createSimState(SINGLE_SPOOL, 3, PERFECT_CONFIG)
    const c = s.chambers[0]
    if (!c) throw new Error('missing chamber')
    holdFor(s, tensionOnly(0.3), 0.4)
    drainEvents(s)

    const waist = falseSetLifts(c)[0] ?? 0
    holdAt(s, 0, waist, 0.3, 1.5)

    expect(c.state).toBe('FALSE_SET')
    // §11: "produces θ > δ × 3". It produces vastly more than that.
    expect(s.theta).toBeGreaterThan(c.delta * 3)
    expect(s.theta / THETA_OPEN).toBeGreaterThan(0.5)
    expect(countEvents(drainEvents(s), 'FALSE_SET_ENTERED')).toBeGreaterThan(0)
  })

  it('pushes the pick back — the pin ends up below where it was asked to go', () => {
    const s = createSimState(SINGLE_SPOOL, 3, PERFECT_CONFIG)
    const c = s.chambers[0]
    if (!c) throw new Error('missing chamber')
    holdFor(s, tensionOnly(0.85), 0.4)
    const waist = falseSetLifts(c)[0] ?? 0
    holdAt(s, 0, waist, 0.85, 2.0)

    expect(c.state).toBe('FALSE_SET')
    expect(c.counterForce).toBeGreaterThan(0)
    // Asked for the middle of the waist; shoved down to the bottom of it.
    expect(c.lift).toBeLessThan(waist - 0.1)
  })

  it('is settable at T = 0.3 and unsettable at T = 0.9, same input otherwise', () => {
    const attempt = (tension: number): SimState => {
      const s = createSimState(SINGLE_SPOOL, 3, PERFECT_CONFIG)
      const c = s.chambers[0]
      if (!c) throw new Error('missing chamber')
      holdFor(s, tensionOnly(tension), 0.4)
      holdAt(s, 0, c.setLift + c.captureWindow / 2, tension, 6)
      return s
    }
    const light = attempt(0.3)
    const heavy = attempt(0.9)
    expect(light.chambers[0]?.state).toBe('SET')
    expect(heavy.chambers[0]?.state).not.toBe('SET')
    expect(heavy.chambers[0]?.state).toBe('FALSE_SET')
  })

  it('counter-rotation drives lift down, and harder the higher the tension', () => {
    const forceAt = (tension: number): number => {
      const s = createSimState(SINGLE_SPOOL, 3, PERFECT_CONFIG)
      const c = s.chambers[0]
      if (!c) throw new Error('missing chamber')
      holdFor(s, tensionOnly(tension), 0.4)
      holdAt(s, 0, falseSetLifts(c)[0] ?? 0, tension, 2.0)
      return c.counterForce
    }
    const light = forceAt(0.25)
    const heavy = forceAt(0.85)
    expect(light).toBeGreaterThan(0)
    expect(heavy).toBeGreaterThan(light * 2)
  })

  it('does not false-set until the plug has actually reached that chamber', () => {
    // Chamber 1 is the spool but chamber 2 binds first: its groove is at the shear line and
    // the plug is nowhere near it, so it is FREE, not lying.
    const s = createSimState(SPOOL_LOCK, 3, PERFECT_CONFIG)
    const spool = s.chambers[1]
    if (!spool) throw new Error('missing chamber')
    holdFor(s, tensionOnly(0.35), 0.4)
    expect(s.bindingChamber).not.toBe(1)
    holdAt(s, 1, falseSetLifts(spool)[0] ?? 0, 0.35, 1.0)
    expect(spool.geometry).toBe('GROOVE')
    expect(s.theta).toBeLessThan(spool.delta)
    expect(spool.state).toBe('FREE')
  })
})

describe('a serrated pin', () => {
  it('gives exactly four distinct false sets on the way up', () => {
    const s = createSimState(SERRATED_LOCK, 5, PERFECT_CONFIG)
    const c = s.chambers[0]
    if (!c) throw new Error('missing chamber')
    holdFor(s, tensionOnly(0.3), 0.4)
    drainEvents(s)

    // Creep the pick up through the whole travel, one small step at a time.
    const transitions: number[] = []
    let previous = c.state
    for (let lift = 0; lift <= c.setLift + c.captureWindow * 0.5; lift += 0.01) {
      holdFor(s, pick(0, lift, 0.3), 0.05)
      if (c.state === 'FALSE_SET' && previous !== 'FALSE_SET') transitions.push(lift)
      previous = c.state
      if (c.state === 'SET' || c.state === 'OVERSET') break
    }

    expect(transitions).toHaveLength(4)
    expect(c.state).toBe('SET')
    expect(countEvents(drainEvents(s), 'FALSE_SET_ENTERED')).toBe(4)
    // The four lies are spread across the travel, not bunched at one end.
    for (let i = 1; i < transitions.length; i += 1) {
      expect((transitions[i] as number) - (transitions[i - 1] as number)).toBeGreaterThan(0.2)
    }
  })

  it('tells a smaller lie than a spool — shallow serrations, small plug swing', () => {
    const swingOf = (def: ReturnType<typeof makeLock>): number => {
      const s = createSimState(def, 3, PERFECT_CONFIG)
      const c = s.chambers[0]
      if (!c) throw new Error('missing chamber')
      holdFor(s, tensionOnly(0.35), 0.4)
      holdAt(s, 0, falseSetLifts(c)[0] ?? 0, 0.35, 2.0)
      return s.theta
    }
    const serrated = swingOf(
      makeLock({ slug: 'one-serrated', bitting: [2.6], pins: ['serrated'], tier: 3 }),
    )
    const spool = swingOf(SINGLE_SPOOL)
    expect(serrated).toBeGreaterThan(0)
    expect(spool).toBeGreaterThan(serrated * 2)
  })

  it('walls later than any other security pin — it lies rather than fights', () => {
    /**
     * The claim used to be that a serrated pin "can always be pushed through, at any tension",
     * and that was an artefact of the counter-rotation force being scaled by `θ / θ_open` rather
     * than a fact about serrations (D-053). With the force honest, a gorilla grip jams a serrated
     * pin too — it jams everything, which is why nobody picks with one.
     *
     * What is actually true of serrations, and what makes them a different problem from spools
     * rather than a harder one, is where the wall *is*: four shallow notches with a blunt bevel
     * push back less than anything else in the catalogue, so a serrated pin stays settable at a
     * tension that has already stopped a spool dead. The ordering is the claim; the absolute
     * numbers are a tuning detail and are asserted nowhere else.
     */
    const settable = (def: ReturnType<typeof makeLock>, tension: number): boolean => {
      const s = createSimState(def, 5, PERFECT_CONFIG)
      const c = s.chambers[0]
      if (!c) throw new Error('missing chamber')
      holdFor(s, tensionOnly(tension), 0.4)
      holdAt(s, 0, c.setLift + c.captureWindow / 2, tension, 8)
      return c.state === 'SET'
    }
    const wallOf = (def: ReturnType<typeof makeLock>): number => {
      for (let t = 0.15; t <= 0.95; t += 0.05) if (!settable(def, t)) return t
      return 1
    }
    const serratedWall = wallOf(
      makeLock({ slug: 'wall-serrated', bitting: [2.6], pins: ['serrated'], tier: 3 }),
    )
    const spoolWall = wallOf(SINGLE_SPOOL)
    const mushroomWall = wallOf(
      makeLock({ slug: 'wall-mushroom', bitting: [3.0], pins: ['mushroom'], tier: 3 }),
    )
    expect(serratedWall, `serrated ${serratedWall} vs spool ${spoolWall}`).toBeGreaterThan(
      spoolWall,
    )
    expect(spoolWall, `spool ${spoolWall} vs mushroom ${mushroomWall}`).toBeGreaterThan(
      mushroomWall,
    )
    // And it still goes through comfortably at any tension a player would actually use.
    expect(serratedWall).toBeGreaterThan(0.5)
  })
})

describe('a mushroom', () => {
  it('shoves harder than a spool at the same tension', () => {
    // Single-chamber locks, so the pin under test is always the one the plug is pressing on
    // and the two are compared under identical conditions.
    const forceOf = (def: ReturnType<typeof makeLock>): number => {
      const s = createSimState(def, 7, PERFECT_CONFIG)
      const c = s.chambers[0]
      if (!c) throw new Error('missing chamber')
      holdFor(s, tensionOnly(0.4), 0.4)
      holdAt(s, 0, falseSetLifts(c)[0] ?? 0, 0.4, 2.0)
      return c.counterForce
    }
    const mushroom = forceOf(
      makeLock({ slug: 'lone-mushroom', bitting: [3.0], pins: ['mushroom'], tier: 3 }),
    )
    const spool = forceOf(SINGLE_SPOOL)
    const serrated = forceOf(
      makeLock({ slug: 'lone-serrated', bitting: [2.6], pins: ['serrated'], tier: 3 }),
    )
    expect(serrated).toBeGreaterThan(0)
    expect(spool).toBeGreaterThan(serrated)
    expect(mushroom).toBeGreaterThan(spool)
  })

  it('walls at a lower tension than a spool does', () => {
    const settable = (def: ReturnType<typeof makeLock>, tension: number): boolean => {
      const s = createSimState(def, 3, PERFECT_CONFIG)
      const c = s.chambers[0]
      if (!c) throw new Error('missing chamber')
      holdFor(s, tensionOnly(tension), 0.4)
      holdAt(s, 0, c.setLift + c.captureWindow / 2, tension, 8)
      return c.state === 'SET'
    }
    const oneMushroom = makeLock({ slug: 'one-mushroom', bitting: [3.0], pins: ['mushroom'], tier: 3 })
    /**
     * Measured at a genuinely light hand rather than at 0.2.
     *
     * These are **single-chamber** locks, and on a single-chamber lock a false-set pin is by
     * definition the only thing holding the plug — so it is always fully engaged, and the ledge is
     * always right into its groove with no bevel presented to cam against (D-077). Getting through
     * one therefore needs the wrench genuinely eased off, which is the technique and not a defect.
     * On a real multi-pin lock, other chambers hold θ down and a mid-pick false set cams freely.
     */
    expect(settable(oneMushroom, 0.12)).toBe(true)
    expect(settable(oneMushroom, 0.3)).toBe(false)
    // The spool is still going at a tension that has already stopped the mushroom dead, which is
    // the ordering this test exists for. Measured walls on a lone pin: mushroom ≈0.3, spool ≈0.5.
    expect(settable(SINGLE_SPOOL, 0.3)).toBe(true)
    expect(settable(SINGLE_SPOOL, 0.4)).toBe(true)
  })
})

describe('the false set is the whole game — SIMULATION.md §4', () => {
  it('a fully false-set five-spool lock sits at 55-70% of θ_open and holds', () => {
    const s = createSimState(FIVE_SPOOL, 11, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.35), 0.5)

    for (let round = 0; round < s.chambers.length; round += 1) {
      const b = s.bindingChamber
      if (b < 0) break
      const c = s.chambers[b]
      if (!c) break
      const waist = falseSetLifts(c)[0] ?? 0
      for (let i = 0; i < 240 && c.state !== 'FALSE_SET'; i += 1) {
        step(s, pick(b, waist, 0.35), DT)
      }
    }
    holdFor(s, tensionOnly(0.35), 1.0)

    expect(s.chambers.every((c) => c.state === 'FALSE_SET')).toBe(true)
    const fraction = s.theta / THETA_OPEN
    expect(fraction).toBeGreaterThan(0.55)
    expect(fraction).toBeLessThan(0.7)

    // It is stable — you can park four spools and go and find the fifth.
    holdFor(s, tensionOnly(0.35), 5.0)
    expect(s.chambers.every((c) => c.state === 'FALSE_SET')).toBe(true)
    expect(s.theta / THETA_OPEN).toBeGreaterThan(0.55)
  })

  it('never opens however hard you turn it', () => {
    const s = createSimState(FIVE_SPOOL, 11, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.35), 0.5)
    for (let round = 0; round < s.chambers.length; round += 1) {
      const b = s.bindingChamber
      if (b < 0) break
      const c = s.chambers[b]
      if (!c) break
      for (let i = 0; i < 240 && c.state !== 'FALSE_SET'; i += 1) {
        step(s, pick(b, falseSetLifts(c)[0] ?? 0, 0.35), DT)
      }
    }
    holdFor(s, tensionOnly(1.0), 6.0)
    expect(s.opened).toBe(false)
    expect(s.chambers.some((c) => c.state === 'SET')).toBe(false)
  })

  it('collapses the moment a spool is pushed through', () => {
    const s = createSimState(SINGLE_SPOOL, 3, PERFECT_CONFIG)
    const c = s.chambers[0]
    if (!c) throw new Error('missing chamber')
    holdFor(s, tensionOnly(0.3), 0.4)
    holdAt(s, 0, falseSetLifts(c)[0] ?? 0, 0.3, 1.5)
    const swung = s.theta
    expect(swung / THETA_OPEN).toBeGreaterThan(0.5)

    // Push past the waist: the plug counter-rotates back to almost nothing.
    holdAt(s, 0, c.setLift - 0.05, 0.3, 1.5)
    expect(c.state).toBe('BINDING')
    expect(s.theta).toBeLessThan(swung * 0.2)
  })
})

describe('opening a security-pinned lock', () => {
  /** Push through every groove, backing tension off the way a player learns to. */
  function pickThrough(s: SimState, tension: number, maxSeconds = 60): boolean {
    const ticks = Math.round(maxSeconds / DT)
    for (let i = 0; i < ticks && !s.opened; i += 1) {
      // The pick has to reach the chamber before it can work it (D-045). Without the travel
      // step this loop re-aims every tick and the tip oscillates in transit forever.
      const b = s.bindingChamber
      if (b >= 0) {
        const c = s.chambers[b]
        if (!c) break
        const target = c.setLift + c.captureWindow * 0.5
        if (s.pickChamber !== b) pickAt(s, b, target, tension)
        step(s, pick(b, target, tension), DT)
        continue
      }
      const stuck = s.chambers.find((c) => c.state === 'FALSE_SET')
      if (stuck) {
        const target = stuck.setLift + stuck.captureWindow * 0.5
        if (s.pickChamber !== stuck.index) pickAt(s, stuck.index, target, tension)
        step(s, pick(stuck.index, target, tension), DT)
        continue
      }
      step(s, tensionOnly(Math.max(tension, 0.3)), DT)
    }
    return s.opened
  }

  it('opens a two-spool lock at a light hand and fails at a heavy one', () => {
    const light = createSimState(SPOOL_LOCK, 3, PERFECT_CONFIG)
    expect(pickThrough(light, 0.3)).toBe(true)

    const heavy = createSimState(SPOOL_LOCK, 3, PERFECT_CONFIG)
    expect(pickThrough(heavy, 0.9, 20)).toBe(false)
  })

  it('opens a five-spool lock', () => {
    const s = createSimState(FIVE_SPOOL, 11, PERFECT_CONFIG)
    expect(pickThrough(s, 0.3, 90)).toBe(true)
    expect(s.stats.falseSetsEntered).toBeGreaterThan(0)
  })

  it('opens a serrated lock despite four lies per pin', () => {
    const s = createSimState(SERRATED_LOCK, 5, configWith(PERFECT_TOOLS))
    expect(pickThrough(s, 0.4, 40)).toBe(true)
    expect(s.stats.falseSetsEntered).toBeGreaterThanOrEqual(4)
  })

  it('opens a mushroom lock only with a light hand', () => {
    const light = createSimState(MUSHROOM_LOCK, 7, PERFECT_CONFIG)
    expect(pickThrough(light, 0.2, 60)).toBe(true)
    const heavy = createSimState(MUSHROOM_LOCK, 7, PERFECT_CONFIG)
    expect(pickThrough(heavy, 0.6, 20)).toBe(false)
  })
})

/** Three wafers, forgiving — a wafer is one piece and must stay one piece. */
const WAFER_FIXTURE = makeLock({
  slug: 'fixture-wafer-twobody',
  bitting: [3.0, 3.6, 2.7],
  pins: ['wafer', 'wafer', 'wafer'],
  family: 'wafer',
  toleranceQuality: 1.35,
})

describe('a pin stack is two bodies — DECISIONS D-042', () => {
  it('drops the key pin but not the driver when a chamber is set', () => {
    const s = createSimState(FIVE_PIN, 4, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.45), 0.3)
    const b = s.bindingChamber
    const c = s.chambers[b]
    if (!c) throw new Error('nothing binding')
    holdFor(s, pick(b, c.setLift + c.captureWindow * 0.5, 0.45), 1.5)
    expect(c.state).toBe('SET')

    // Move the pick right out of the lock and give the spring a full second.
    holdFor(s, tensionOnly(0.45), 1.0)

    // The driver has not moved: the plug's ledge is under it and nothing can bring it back.
    expect(c.lift, 'the captured driver fell').toBeGreaterThanOrEqual(c.setLift - 1e-6)
    // The key pin has: nothing is holding it, so it is back on the keyway floor.
    expect(c.keyLift, 'the key pin did not fall').toBeLessThan(0.05)
    // Which is the gap that tells the player the pin is set.
    expect(c.lift - c.keyLift).toBeGreaterThan(1)
  })

  it('drops the key pin but not the driver during a false set', () => {
    const s = createSimState(SPOOL_LOCK, 3, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const spool = s.chambers.findIndex((c) => c.profile.name === 'spool')
    for (let i = 0; i < 600 && s.chambers[spool]?.state !== 'FALSE_SET'; i += 1) {
      const b = s.bindingChamber
      const target = b >= 0 ? s.chambers[b] : s.chambers[spool]
      if (!target) break
      holdFor(s, pick(target.index, target.setLift + target.captureWindow * 0.5, 0.5), 1 / 120)
    }
    const c = s.chambers[spool]
    if (!c) throw new Error('no spool')
    expect(c.state, 'the spool never false-set, so the test proves nothing').toBe('FALSE_SET')

    const drivenTo = c.lift
    holdFor(s, tensionOnly(0.5), 1.0)

    // The driver stays wedged in its waist — that is what makes a false set *stable*.
    expect(Math.abs(c.lift - drivenTo)).toBeLessThan(0.2)
    // The key pin drops away underneath it.
    expect(c.keyLift, 'the key pin hung in mid-air').toBeLessThan(drivenTo - 0.1)
  })

  it('keeps a wafer in one piece — it has no key pin to separate', () => {
    const s = createSimState(WAFER_FIXTURE, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.45), 0.3)
    const b = s.bindingChamber
    const c = s.chambers[b]
    if (!c) throw new Error('nothing binding')
    holdFor(s, pick(b, c.setLift, 0.45), 1.5)
    expect(c.state).toBe('SET')
    holdFor(s, tensionOnly(0.45), 1.0)
    // A set wafer does not move at all: the ledge is in its gate.
    expect(c.keyLift).toBeCloseTo(c.lift, 6)
    expect(c.lift).toBeCloseTo(c.setLift, 2)
  })
})

/**
 * A mushroom and a T-pin are different pins — DECISIONS D-124, D-125.
 *
 * Reported together: *"T-pin and mushroom are the same now"* and *"their behaviour should also be
 * very different"*. The drawing was genuinely identical and is fixed elsewhere; this is the other
 * half — proving the two are not the same lock problem, and pinning which way round they differ so
 * a future retune cannot quietly collapse them again.
 *
 * The two axes are the two numbers a profile carries beyond its length:
 *
 * - `taper` is the bevel, and `counterForce = FORCE x T x (0.25 + taper)`. A mushroom is a cone: it
 *   cams against the plug and **shoves the pick out**. A T-pin is square: nothing to cam on, so it
 *   barely pushes at all.
 * - `grooveDepth` is how far into the pin the waist cuts, and therefore how far the plug turns
 *   before it stops. A T-pin's is deeper, so it tells the **longer, more convincing lie**.
 *
 * Opposite ends of both, which is two different techniques: ease the wrench off a mushroom, and be
 * precise with a T-pin.
 */
describe('mushroom against t-pin', () => {
  const MUSH_ONLY = makeLock({
    slug: 'fixture-mushroom-only',
    bitting: [3.2],
    pins: ['mushroom'],
    toleranceQuality: 1.2,
  })
  const TPIN_ONLY = makeLock({
    slug: 'fixture-tpin-only',
    bitting: [3.2],
    pins: ['t-pin'],
    toleranceQuality: 1.2,
  })

  /** Park the single chamber in its groove under tension and read what the lock does back. */
  function inGroove(def: typeof MUSH_ONLY): { counter: number; theta: number } {
    const s = createSimState(def, 5, PERFECT_CONFIG)
    const c = s.chambers[0]
    if (!c) throw new Error('no chamber')
    const target = c.setLift * 0.55
    holdFor(s, tensionOnly(0.6), 0.3)
    holdAt(s, 0, target, 0.6, 2.5)
    return { counter: s.stats.maxCounterForce, theta: s.thetaMax }
  }

  it('the mushroom shoves the pick out and the t-pin does not', () => {
    const m = inGroove(MUSH_ONLY)
    const t = inGroove(TPIN_ONLY)
    expect(m.counter, 'a mushroom cams against the plug').toBeGreaterThan(0)
    expect(
      m.counter,
      `mushroom ${m.counter.toFixed(2)} vs t-pin ${t.counter.toFixed(2)}`,
    ).toBeGreaterThan(t.counter * 2)
  })

  it('their grooves are cut to different depths, so the lies are different lengths', () => {
    const mush = PROFILES.mushroom
    const tpin = PROFILES['t-pin']
    expect(tpin.maxGrooveDepth, 'a t-pin cuts deeper').toBeGreaterThan(mush.maxGrooveDepth)
    // …and by enough to be a different reading, not a rounding difference.
    expect(tpin.maxGrooveDepth - mush.maxGrooveDepth).toBeGreaterThan(0.1)
  })

  it('and they are shaped differently, which is what the drawing now shows', () => {
    // The bevel is the shape *and* the force, so this is the same number the test above measures.
    expect(PROFILES.mushroom.bands.find((b) => b.reduced)?.taper).toBeGreaterThan(0.5)
    expect(PROFILES['t-pin'].bands.find((b) => b.reduced)?.taper).toBe(0)
  })
})
