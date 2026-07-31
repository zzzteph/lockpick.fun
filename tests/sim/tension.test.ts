import { describe, expect, it } from 'vitest'
import {
  FEATHER_WINDOW,
  PERFECT_TOOLS,
  STARTER_TOOLS,
  TENSION_SLEW,
  SET_SLIP_GRACE,
  T_SET_HOLD,
  countEvents,
  createSimState,
  drainEvents,
  withTools,
  RESIST_PIN_BIAS,
  RESIST_PRESSURE_MM,
  STRAIN_BENT,
  holdThreshold as holdThresholdOf,
} from '../../src/sim'
import {
  FIVE_PIN,
  PERFECT_CONFIG,
  THREE_PIN,
  TIGHT_FIVE,
  configWith,
  holdFor,
  makeLock,
  pick,
  tensionOnly,
  workBindingChamber,
} from './fixtures'

describe('tension — SIMULATION.md §6', () => {
  it('is rate limited by the wrench slew', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(1), 0.1)
    // PERFECT_TOOLS slews at 12/s, so 0.1s of holding cannot exceed 1.2 units of change.
    expect(s.tensionCommanded).toBeLessThanOrEqual(0.1 * 12 + 1e-9)
    const slow = createSimState(THREE_PIN, 1, configWith(STARTER_TOOLS))
    holdFor(slow, tensionOnly(0.85), 0.1)
    expect(slow.tensionCommanded).toBeLessThanOrEqual(0.1 * TENSION_SLEW + 1e-9)
  })

  it('is clamped to the wrench range', () => {
    const light = configWith(withTools(PERFECT_TOOLS, { tensionMin: 0.05, tensionMax: 0.55 }))
    const s = createSimState(THREE_PIN, 1, light)
    holdFor(s, tensionOnly(1), 1.0)
    expect(s.tension).toBeCloseTo(0.55, 6)
    holdFor(s, tensionOnly(0.01), 1.0)
    expect(s.tension).toBeCloseTo(0.05, 6)
  })

  it('falls to exactly zero when the button is released', () => {
    const s = createSimState(THREE_PIN, 1, configWith(STARTER_TOOLS))
    holdFor(s, tensionOnly(0.6), 0.5)
    expect(s.tension).toBeGreaterThan(0.5)
    holdFor(s, { ...tensionOnly(0.6), tensionHeld: false }, 1.0)
    expect(s.tension).toBe(0)
  })

  it('losing tension for longer than the feather window resets everything', () => {
    const s = createSimState(FIVE_PIN, 11, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    workBindingChamber(s, 0.5)
    workBindingChamber(s, 0.5)
    expect(s.chambers.filter((c) => c.state === 'SET')).toHaveLength(2)
    drainEvents(s)

    holdFor(s, tensionOnly(0), 0.5)
    const events = drainEvents(s)
    expect(countEvents(events, 'RESET')).toBe(1)
    expect(events.find((e) => e.type === 'RESET')?.kind).toBe('full')
    expect(s.chambers.every((c) => c.state === 'FREE')).toBe(true)
    expect(s.stats.setOrder).toEqual([])
    expect(s.stats.fullResets).toBe(1)
  })

  /**
   * A light hand costs you pins — the mechanic asked for in play, and the one this test used to
   * assert the absence of (D-095).
   *
   * It read "set pins survive indefinitely just above `T_MIN_HOLD`", and they did: the whole
   * engagement-relief curve sat below the lightest tension a player could select, so no setting on
   * the wheel could ever shed a pin. `T_SET_HOLD` is what a *captured driver* needs, and it lands
   * between pressure step 1 and step 2 while there is still work to do.
   */
  it('set pins are shed by a hand too light to hold them', () => {
    const s = createSimState(FIVE_PIN, 11, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    workBindingChamber(s, 0.5)
    workBindingChamber(s, 0.5)
    expect(s.chambers.filter((c) => c.state === 'SET')).toHaveLength(2)

    // Well under the threshold, and held far longer than the grace.
    holdFor(s, tensionOnly(T_SET_HOLD * 0.5), 3)
    expect(s.chambers.filter((c) => c.state === 'SET')).toHaveLength(0)
  })

  it('…but a brief dip is survivable, because the grace is what makes it a technique', () => {
    const s = createSimState(FIVE_PIN, 11, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    workBindingChamber(s, 0.5)
    workBindingChamber(s, 0.5)
    const setBefore = s.chambers.filter((c) => c.state === 'SET').map((c) => c.index)

    // Shorter than SET_SLIP_GRACE, then back up. Nothing moves.
    holdFor(s, tensionOnly(T_SET_HOLD * 0.5), SET_SLIP_GRACE * 0.6)
    holdFor(s, tensionOnly(0.5), 0.3)
    expect(s.chambers.filter((c) => c.state === 'SET').map((c) => c.index)).toEqual(setBefore)
    expect(s.stats.fullResets).toBe(0)
  })

  it('and once the plug has swung, a light hand is free — which is the spool technique', () => {
    // Every pin set means θ runs right up, engagement saturates, and the threshold drops below
    // even the lightest pressure step. Easing off to work a spool must never cost you the lock.
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    for (let i = 0; i < 3; i += 1) workBindingChamber(s, 0.5)
    expect(s.chambers.every((c) => c.state === 'SET')).toBe(true)
    holdFor(s, tensionOnly(0.5), 0.4)

    holdFor(s, tensionOnly(T_SET_HOLD * 0.5), 3)
    expect(s.chambers.every((c) => c.state === 'SET')).toBe(true)
    expect(s.stats.fullResets).toBe(0)
  })

  it('does not fire a reset before tension has ever been applied', () => {
    const s = createSimState(FIVE_PIN, 11, PERFECT_CONFIG)
    drainEvents(s)
    holdFor(s, tensionOnly(0), 2)
    expect(countEvents(drainEvents(s), 'RESET')).toBe(0)
    expect(s.stats.fullResets).toBe(0)
  })

  it('does not fire a reset when there is nothing to lose', () => {
    const s = createSimState(FIVE_PIN, 11, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.5)
    drainEvents(s)
    holdFor(s, tensionOnly(0), 0.5)
    expect(countEvents(drainEvents(s), 'RESET')).toBe(0)
  })
})

describe('pins hold by different amounts — DECISIONS D-074', () => {
  /**
   * The technique the game had no way to express. Tension used to be a cliff: above `T_MIN_HOLD`
   * everything held, below it everything died, so easing the wrench could only do nothing or
   * destroy the attempt — and the correct strategy was to pick a number and never touch it.
   *
   * A driver caught a moment ago is holding on a sliver of ledge; one the plug has swung well past
   * has the ledge properly under it. Ease off a little and the newest pin lets go while the rest
   * stand, which is what makes tension an instrument rather than a switch.
   */
  it('eases the newest pin off and leaves the well-engaged ones standing', () => {
    const s = createSimState(FIVE_PIN, 11, configWith(PERFECT_TOOLS, true))
    holdFor(s, tensionOnly(0.5), 0.3)
    for (let i = 0; i < 4; i += 1) workBindingChamber(s, 0.5)
    const setNow = s.chambers.filter((c) => c.state === 'SET')
    expect(setNow.length, 'need several set pins for this to mean anything').toBeGreaterThan(2)

    // The pins differ in how well they are caught, which is the whole premise.
    const holds = setNow.map((c) => holdThresholdOf(c, s.theta))
    expect(Math.max(...holds) - Math.min(...holds)).toBeGreaterThan(0.005)

    // Ease to just under the weakest hold but above the strongest: exactly one loses grip.
    const weakest = Math.max(...holds)
    const strongest = Math.min(...holds)
    const between = (weakest + strongest) / 2
    holdFor(s, tensionOnly(between), 1.0)

    const survivors = s.chambers.filter((c) => c.state === 'SET')
    expect(survivors.length, 'something should have dropped').toBeLessThan(setNow.length)
    expect(survivors.length, 'but not everything').toBeGreaterThan(0)
    // A partial slip is not a ruined attempt.
    expect(s.stats.fullResets).toBe(0)
  })

  it('lets go of everything when the wrench does', () => {
    const s = createSimState(FIVE_PIN, 11, configWith(PERFECT_TOOLS, true))
    holdFor(s, tensionOnly(0.5), 0.3)
    for (let i = 0; i < 3; i += 1) workBindingChamber(s, 0.5)
    expect(s.chambers.some((c) => c.state === 'SET')).toBe(true)
    holdFor(s, tensionOnly(0), 0.6)
    expect(s.chambers.every((c) => c.state === 'FREE')).toBe(true)
    expect(s.stats.fullResets).toBe(1)
  })
})

describe('feathering — SIMULATION.md §6', () => {
  function jammedAndSet(featherEnabled: boolean): ReturnType<typeof createSimState> {
    const s = createSimState(TIGHT_FIVE, 11, configWith(PERFECT_TOOLS, featherEnabled))
    holdFor(s, tensionOnly(0.5), 0.3)
    // Set two chambers cleanly, then deliberately jam the third.
    workBindingChamber(s, 0.5)
    workBindingChamber(s, 0.5)
    const victim = s.chambers[s.bindingChamber]
    if (!victim) throw new Error('expected a binding chamber')
    holdFor(s, pick(victim.index, victim.setLift + victim.captureWindow * 1.8, 0.5), 0.8)
    expect(victim.state).toBe('OVERSET')
    expect(s.chambers.filter((c) => c.state === 'SET')).toHaveLength(2)
    return s
  }

  it('a brief dip drops the overset pin and keeps the set ones', () => {
    const s = jammedAndSet(true)
    const setBefore = s.chambers.filter((c) => c.state === 'SET').map((c) => c.index)
    drainEvents(s)

    // Dip below T_MIN_HOLD for less than FEATHER_WINDOW, then come back.
    holdFor(s, tensionOnly(0), FEATHER_WINDOW * 0.4)
    holdFor(s, tensionOnly(0.5), 0.3)

    const events = drainEvents(s)
    const reset = events.find((e) => e.type === 'RESET')
    expect(reset?.kind).toBe('feather')
    expect(s.stats.feathers).toBe(1)
    expect(s.stats.fullResets).toBe(0)
    expect(s.chambers.filter((c) => c.state === 'OVERSET')).toHaveLength(0)
    expect(s.chambers.filter((c) => c.state === 'SET').map((c) => c.index)).toEqual(setBefore)
  })

  it('a dip longer than the window is a full reset even with feathering learned', () => {
    const s = jammedAndSet(true)
    drainEvents(s)
    holdFor(s, tensionOnly(0), FEATHER_WINDOW * 3)
    const events = drainEvents(s)
    expect(events.find((e) => e.type === 'RESET')?.kind).toBe('full')
    expect(s.chambers.every((c) => c.state === 'FREE')).toBe(true)
    expect(s.stats.fullResets).toBe(1)
  })

  it('without the technique, any dip at all costs everything', () => {
    const s = jammedAndSet(false)
    drainEvents(s)
    holdFor(s, tensionOnly(0), FEATHER_WINDOW * 0.4)
    const events = drainEvents(s)
    expect(events.find((e) => e.type === 'RESET')?.kind).toBe('full')
    expect(s.stats.feathers).toBe(0)
    expect(s.stats.fullResets).toBe(1)
  })

  it('a feather with nothing jammed is a no-op', () => {
    const s = createSimState(TIGHT_FIVE, 11, configWith(PERFECT_TOOLS, true))
    holdFor(s, tensionOnly(0.5), 0.3)
    workBindingChamber(s, 0.5)
    drainEvents(s)
    holdFor(s, tensionOnly(0), FEATHER_WINDOW * 0.4)
    holdFor(s, tensionOnly(0.5), 0.3)
    expect(countEvents(drainEvents(s), 'RESET')).toBe(0)
    expect(s.chambers.filter((c) => c.state === 'SET')).toHaveLength(1)
  })

  it('recovering from an overset by feathering lets the lock be opened', () => {
    const s = jammedAndSet(true)
    holdFor(s, tensionOnly(0), FEATHER_WINDOW * 0.4)
    holdFor(s, tensionOnly(0.45), 0.3)
    for (let i = 0; i < 6; i += 1) workBindingChamber(s, 0.45)
    holdFor(s, tensionOnly(0.6), 1.0)
    expect(s.opened).toBe(true)
  })
})

describe('resistance readout — SIMULATION.md §8', () => {
  it('reads heavy on the binding chamber and light on a free one — when you push', () => {
    const s = createSimState(FIVE_PIN, 2, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const binding = s.bindingChamber
    const free = s.chambers.find((c) => c.index !== binding)
    if (!free) throw new Error('expected a free chamber')

    // Leaning on each in turn, which is the only way a hand learns anything (D-056).
    holdFor(s, pick(binding, RESIST_PRESSURE_MM, 0.5), 0.2)
    const heavy = s.resistance
    holdFor(s, pick(free.index, RESIST_PRESSURE_MM, 0.5), 0.2)
    const light = s.resistance

    // Bands rather than exact values, because every chamber carries its own bias (D-052) and the
    // gap between the states was deliberately narrowed (D-056). The ordering is the claim; the
    // gap only has to survive the bias, not be obvious at a glance.
    expect(heavy, `heavy ${heavy.toFixed(3)}`).toBeGreaterThan(0.45)
    expect(light, `light ${light.toFixed(3)}`).toBeLessThan(0.4)
    expect(heavy - light).toBeGreaterThan(0.15)
  })

  it('tells you nothing at all until you push — DECISIONS D-056', () => {
    /**
     * The gesture this closes: hold tension, sweep the pick along the keyway at zero lift, and
     * the meter used to name the binding chamber before you had touched anything. It worked at
     * every difficulty, including the ones whose entire purpose is to make you work it out.
     */
    const s = createSimState(FIVE_PIN, 2, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const binding = s.bindingChamber
    const free = s.chambers.find((c) => c.index !== binding)
    if (!free) throw new Error('expected a free chamber')

    const readAt = (chamber: number, lift: number): number => {
      holdFor(s, pick(chamber, lift, 0.5), 0.25)
      return s.resistance
    }
    // Resting the tip under each: both read the floor, and the sweep says nothing.
    const restingOnBind = readAt(binding, 0)
    const restingOnFree = readAt(free.index, 0)
    expect(restingOnBind).toBeCloseTo(restingOnFree, 6)
    expect(restingOnBind).toBeLessThan(0.05)

    // The same two chambers, leaned on, are plainly different.
    const pushedOnBind = readAt(binding, RESIST_PRESSURE_MM)
    const pushedOnFree = readAt(free.index, RESIST_PRESSURE_MM)
    expect(pushedOnBind).toBeGreaterThan(restingOnBind + 0.2)
    expect(pushedOnBind).toBeGreaterThan(pushedOnFree)

    // And it comes on gradually, so a light brush is not the same as a deliberate probe.
    const half = readAt(binding, RESIST_PRESSURE_MM * 0.5)
    expect(half).toBeGreaterThan(restingOnBind)
    expect(half).toBeLessThan(pushedOnBind)
  })

  it('no two pins feel quite alike — DECISIONS D-052', () => {
    /**
     * The reason the numbers above are bands. A real cylinder has no two chambers the same, and
     * a picker learns *this* lock — "number three is the heavy one" — rather than learning a
     * threshold that works on every lock ever made. Before this, every free pin returned the
     * identical number and reading the meter was a lookup.
     */
    const s = createSimState(FIVE_PIN, 2, PERFECT_CONFIG)
    const biases = s.chambers.map((c) => c.resistanceBias)
    expect(new Set(biases.map((b) => b.toFixed(6))).size).toBe(biases.length)
    expect(Math.max(...biases) - Math.min(...biases)).toBeGreaterThan(0.02)
    for (const b of biases) expect(Math.abs(b)).toBeLessThanOrEqual(RESIST_PIN_BIAS)

    // It is a property of the lock, not of the moment: load the same lock again and it is the
    // same lock, with the same pin still the heavy one.
    const again = createSimState(FIVE_PIN, 2, PERFECT_CONFIG)
    expect(again.chambers.map((c) => c.resistanceBias)).toEqual(biases)
    // A different lock instance feels different.
    const other = createSimState(FIVE_PIN, 3, PERFECT_CONFIG)
    expect(other.chambers.map((c) => c.resistanceBias)).not.toEqual(biases)
  })

  it('binding resistance rises with tension', () => {
    const readAt = (t: number): number => {
      const s = createSimState(FIVE_PIN, 2, PERFECT_CONFIG)
      holdFor(s, tensionOnly(t), 0.4)
      holdFor(s, pick(s.bindingChamber, RESIST_PRESSURE_MM, t), 0.2)
      return s.resistance
    }
    expect(readAt(0.8)).toBeGreaterThan(readAt(0.2))
  })

  it('reads near nothing on a set chamber and a wall on an overset one', () => {
    const s = createSimState(TIGHT_FIVE, 2, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const first = s.bindingChamber
    workBindingChamber(s, 0.5)
    holdFor(s, pick(first, 0, 0.5), 0.2)
    expect(s.resistance).toBeLessThan(0.1)

    const victim = s.chambers[s.bindingChamber]
    if (!victim) throw new Error('expected a binding chamber')
    holdFor(s, pick(victim.index, victim.setLift + victim.captureWindow * 1.8, 0.5), 0.8)
    expect(victim.state).toBe('OVERSET')
    // A band, not 0.9: every chamber carries its own bias and spring (D-052, D-062), so an
    // overset on a light chamber lands lower than one on a heavy chamber. It is still, by a wide
    // margin, the heaviest thing in the game.
    expect(s.resistance).toBeGreaterThan(0.8)
  })

  describe('the pick bends — DECISIONS D-068', () => {
    /**
     * A lock built to be unpickable at the tension used, so the pin genuinely will not move and
     * the load genuinely does not go away. One spool at a tension well past its wall.
     */
    const leanOn = (
      strength: number,
      seconds: number,
      hard = true,
    ): ReturnType<typeof createSimState> => {
      const def = makeLock({
        slug: `bend-${strength}-${hard ? 'hard' : 'soft'}`,
        bitting: [3.0],
        pins: ['spool'],
        tier: 3,
      })
      const s = createSimState(def, 3, configWith(withTools(PERFECT_TOOLS, { strength })))
      holdFor(s, tensionOnly(0.9), 0.4)
      const c = s.chambers[0]
      if (!c) throw new Error('no chamber')
      // `maxLift` is the whole travel and loads the shaft hard; `setLift` is half of it and loads
      // it gently, which is what the recovery case needs — strain has to be *present* and not yet
      // past the bend for there to be anything to bleed off.
      holdFor(s, pick(0, hard ? c.maxLift : c.setLift, 0.9), seconds)
      return s
    }

    it('costs nothing while the pin is moving', () => {
      // A free five-pin lock at a workable tension: pins ride up to meet the tip, so no gap opens
      // and nothing accumulates. This is the normal state of picking and it must be free.
      const s = createSimState(FIVE_PIN, 4, PERFECT_CONFIG)
      holdFor(s, tensionOnly(0.4), 0.3)
      for (let i = 0; i < 5; i += 1) workBindingChamber(s, 0.4)
      expect(s.pickBent, 'a clean pick should not bend').toBe(false)
      expect(s.pickStrain).toBeLessThan(STRAIN_BENT)
    })

    it('takes a set from leaning on something that will not move', () => {
      const s = leanOn(1, 4)
      expect(s.pickStrain).toBeGreaterThan(STRAIN_BENT)
      expect(s.pickBent).toBe(true)
      expect(countEvents(drainEvents(s), 'PICK_BENT')).toBe(1)
    })

    it('breaks if you keep going, and then lifts nothing at all', () => {
      const s = leanOn(1, 12)
      expect(s.pickBroken, `strain ${s.pickStrain.toFixed(2)}`).toBe(true)
      const c = s.chambers[0]
      if (!c) throw new Error('no chamber')
      const before = c.lift
      // A broken pick is a broken pick: commanding it does nothing.
      holdFor(s, tensionOnly(0), 0.5)
      holdFor(s, pick(0, c.maxLift, 0.3), 1.0)
      expect(c.lift).toBeLessThanOrEqual(before + 1e-6)
    })

    it('a stronger tool survives what a weaker one does not', () => {
      const weak = leanOn(0.5, 3)
      const strong = leanOn(12, 3)
      expect(weak.pickStrain).toBeGreaterThan(strong.pickStrain)
      expect(weak.pickBent).toBe(true)
      expect(strong.pickBent).toBe(false)
    })

    it('recovers when the tip is unloaded', () => {
      const s = leanOn(1, 0.5, false)
      const loaded = s.pickStrain
      expect(loaded, `loaded ${loaded.toFixed(3)}`).toBeGreaterThan(0.1)
      expect(s.pickBent, 'this case needs strain short of the bend').toBe(false)
      holdFor(s, tensionOnly(0.9), 1.5)
      expect(s.pickStrain, 'strain should bleed off with the tip unloaded').toBeLessThan(
        loaded - 0.3,
      )
    })
  })

  it('a set pin goes light, then firm again as the key pin reaches it — D-061', () => {
    /**
     * The warning that was missing. A captured pin can be pushed back off its ledge and jammed
     * (D-051), and until now it read `RESIST_SET` — near nothing — however hard you leaned on it.
     * The one action that can destroy your progress was the only one with no feedback attached.
     */
    const s = createSimState(FIVE_PIN, 4, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const b = s.bindingChamber
    const c = s.chambers[b]
    if (!c) throw new Error('expected a binding chamber')
    holdFor(s, pick(b, c.setLift + c.captureWindow * 0.5, 0.5), 1.2)
    expect(c.state).toBe('SET')

    // Let the key pin fall away, then push it up through the empty bore: light all the way.
    holdFor(s, tensionOnly(0.5), 0.8)
    expect(c.keyLift).toBeLessThan(0.2)
    holdFor(s, pick(b, RESIST_PRESSURE_MM, 0.5), 0.4)
    const climbing = s.resistance
    expect(climbing, `climbing ${climbing.toFixed(3)}`).toBeLessThan(0.25)

    // Push it up to the driver and it comes alive — you are now moving something already set.
    holdFor(s, pick(b, c.setLift, 0.5), 0.6)
    const touching = s.resistance
    expect(touching, `touching ${touching.toFixed(3)}`).toBeGreaterThan(climbing + 0.2)
    expect(c.state).toBe('SET')
  })

  it('is zero when the pick is out of the lock', () => {
    const s = createSimState(FIVE_PIN, 2, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    expect(s.pickChamber).toBe(-1)
    expect(s.resistance).toBe(0)
  })
})
