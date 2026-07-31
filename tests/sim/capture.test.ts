import { describe, expect, it } from 'vitest'
import {
  CAPTURE_TIME,
  DT,
  countEvents,
  createSimState,
  drainEvents,
  step,
  type Chamber,
} from '../../src/sim'
import {
  FIVE_PIN,
  PERFECT_CONFIG,
  THREE_PIN,
  TIGHT_FIVE,
  holdFor,
  makeLock,
  pick,
  tensionOnly,
} from './fixtures'

describe('capture window — SIMULATION.md §7', () => {
  it('lifting to the middle of the window and holding sets the pin', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const c = s.chambers[s.bindingChamber]
    if (!c) throw new Error('expected a binding chamber')
    drainEvents(s)
    holdFor(s, pick(c.index, c.setLift + c.captureWindow / 2, 0.5), 1.0)
    expect(c.state).toBe('SET')
    expect(countEvents(drainEvents(s), 'PIN_SET')).toBe(1)
  })

  it('capture is not instantaneous — it takes CAPTURE_TIME inside the window', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const c = s.chambers[s.bindingChamber]
    if (!c) throw new Error('expected a binding chamber')
    const target = c.setLift + c.captureWindow / 2
    // Step until the lift first lands inside the window, then count ticks to SET.
    let ticksInWindow = 0
    for (let i = 0; i < 2000 && c.state !== 'SET'; i += 1) {
      step(s, pick(c.index, target, 0.5), DT)
      if (c.lift >= c.setLift) ticksInWindow += 1
    }
    expect(c.state).toBe('SET')
    const held = ticksInWindow * DT
    expect(held).toBeGreaterThanOrEqual(CAPTURE_TIME - DT)
    expect(held).toBeLessThan(CAPTURE_TIME + 4 * DT)
  })

  it('lifting past the window oversets and never sets', () => {
    const s = createSimState(TIGHT_FIVE, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const c = s.chambers[s.bindingChamber]
    if (!c) throw new Error('expected a binding chamber')
    drainEvents(s)
    holdFor(s, pick(c.index, c.setLift + c.captureWindow * 1.5, 0.5), 2.0)
    expect(c.state).toBe('OVERSET')
    const events = drainEvents(s)
    expect(countEvents(events, 'PIN_OVERSET')).toBe(1)
    expect(countEvents(events, 'PIN_SET')).toBe(0)
    expect(s.stats.oversets).toBe(1)
  })

  /**
   * Capture is a race between the plug's ledge sliding under the driver and the pick pushing
   * the key pin up after it. A chamber only oversets if the pick clears the window in less
   * than `CAPTURE_TIME`, which is why a forgiving lock genuinely forgives a clumsy overshoot
   * and a tight one does not. This is emergent, not special-cased — and it is the reason a
   * Tier 1 lock is a safe place to learn.
   */
  it('a loose lock forgives the same overshoot that jams a tight one', () => {
    /**
     * One overshoot in millimetres, applied to both locks — which is what "the same overshoot"
     * has to mean for the comparison to say anything. Sized to sit inside the loose lock's
     * capture window and outside the tight one's, because that gap *is* what `toleranceQuality`
     * buys the player.
     *
     * It used to overshoot by `captureWindow * 1.5`, which is a different distance on each lock
     * and so compared nothing; it passed only because a captured pin was then clamped and could
     * not be pushed further whatever you did (D-051).
     */
    // The window runs upward from `setLift`, so a chamber is inside it while
    // `lift - setLift < captureWindow`.
    const windowOf = (def: typeof THREE_PIN): number => {
      const w = createSimState(def, 1, PERFECT_CONFIG).chambers[0]?.captureWindow
      if (w === undefined) throw new Error('no chambers')
      return w
    }
    const overshoot = (windowOf(THREE_PIN) + windowOf(TIGHT_FIVE)) / 2
    expect(overshoot).toBeLessThan(windowOf(THREE_PIN))
    expect(overshoot).toBeGreaterThan(windowOf(TIGHT_FIVE))

    const jam = (def: typeof THREE_PIN): string => {
      const s = createSimState(def, 1, PERFECT_CONFIG)
      holdFor(s, tensionOnly(0.5), 0.3)
      const c = s.chambers[s.bindingChamber]
      if (!c) throw new Error('expected a binding chamber')
      holdFor(s, pick(c.index, c.setLift + overshoot, 0.5), 2.0)
      return c.state
    }
    expect(jam(THREE_PIN)).toBe('SET')
    expect(jam(TIGHT_FIVE)).toBe('OVERSET')
  })

  it('light tension makes the pick fast enough to overset even a loose lock', () => {
    // liftRate = 26 / (1 + 3.2T): light tension means a fast pick and less margin.
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.1), 0.3)
    const c = s.chambers[s.bindingChamber]
    if (!c) throw new Error('expected a binding chamber')
    holdFor(s, pick(c.index, c.setLift + c.captureWindow * 1.5, 0.1), 2.0)
    expect(c.state).toBe('OVERSET')
  })

  it('lifting short of the window stays binding', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const c = s.chambers[s.bindingChamber]
    if (!c) throw new Error('expected a binding chamber')
    holdFor(s, pick(c.index, c.setLift - 0.1, 0.5), 2.0)
    expect(c.state).toBe('BINDING')
    expect(c.lift).toBeCloseTo(c.setLift - 0.1, 6)
  })

  it('an overset is unrecoverable while tension is held', () => {
    const s = createSimState(TIGHT_FIVE, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const c = s.chambers[s.bindingChamber]
    if (!c) throw new Error('expected a binding chamber')
    holdFor(s, pick(c.index, c.setLift + c.captureWindow * 1.6, 0.5), 0.6)
    expect(c.state).toBe('OVERSET')
    const jammedAt = c.lift

    // Lower the pick, wander off, come back, wait — nothing helps.
    holdFor(s, pick(c.index, 0, 0.5), 1.0)
    expect(c.state).toBe('OVERSET')
    expect(c.lift).toBeCloseTo(jammedAt, 9)
    holdFor(s, tensionOnly(0.5), 3.0)
    expect(c.state).toBe('OVERSET')
    holdFor(s, pick(c.index, c.setLift + c.captureWindow / 2, 0.2), 2.0)
    expect(c.state).toBe('OVERSET')
    expect(s.opened).toBe(false)

    // Only dropping tension frees it.
    holdFor(s, tensionOnly(0), 0.6)
    expect(c.state).toBe('FREE')
  })

  it('a chamber the plug has not closed on cannot overset', () => {
    // Chamber with the largest delta: the plug is nowhere near it, so over-lifting it is
    // harmless until its turn comes round.
    const s = createSimState(FIVE_PIN, 6, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.4), 0.3)
    const loosest = [...s.chambers].sort((a, b) => b.delta - a.delta)[0]
    if (!loosest) throw new Error('expected a chamber')
    expect(loosest.index).not.toBe(s.bindingChamber)
    holdFor(s, pick(loosest.index, loosest.setLift + loosest.captureWindow * 2, 0.4), 1.0)
    expect(loosest.state).not.toBe('OVERSET')
    expect(s.stats.oversets).toBe(0)
  })

  /**
   * The old rule here was that a set chamber *cannot* be pushed past the shear line: its ceiling
   * was clamped to `setLift` and no amount of force did anything. That made "set" mean "safe
   * forever", which is not how a real lock behaves — a captured driver rests on the sliver of
   * plug edge that one pin's worth of rotation exposes, about 0.0125mm of a 2.92mm face, and
   * driving the key pin up shoves it straight back off. Losing a pin you had already set is one
   * of the commonest mistakes in real picking. See DECISIONS D-051.
   */
  describe('a captured pin is caught, not latched — DECISIONS D-051', () => {
    const setOne = (): { s: ReturnType<typeof createSimState>; c: Chamber } => {
      const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
      holdFor(s, tensionOnly(0.5), 0.3)
      const c = s.chambers[s.bindingChamber]
      if (!c) throw new Error('expected a binding chamber')
      holdFor(s, pick(c.index, c.setLift + c.captureWindow / 2, 0.5), 1.0)
      expect(c.state).toBe('SET')
      return { s, c }
    }

    it('stays set, and settles back onto the ledge, when the pick leaves', () => {
      const { s, c } = setOne()
      holdFor(s, tensionOnly(0.5), 1.0)
      expect(c.state).toBe('SET')
      expect(c.lift).toBeCloseTo(c.setLift, 3)
      // The key pin has fallen away underneath it — the gap that tells you it is captured.
      expect(c.keyLift).toBeLessThan(c.setLift - 0.1)
    })

    it('takes a nudge inside its window without being lost', () => {
      const { s, c } = setOne()
      holdFor(s, pick(c.index, c.setLift + c.captureWindow * 0.3, 0.5), 1.0)
      expect(c.state).toBe('SET')
    })

    it('is driven off the ledge and jams when the pick keeps pushing', () => {
      const { s, c } = setOne()
      const before = s.stats.oversets
      holdFor(s, pick(c.index, c.setLift + 3, 0.5), 1.0)
      expect(c.state).toBe('OVERSET')
      expect(s.stats.oversets).toBe(before + 1)
      expect(c.lift).toBeGreaterThan(c.setLift)
    })

    it('survives the pick travelling past it at full height', () => {
      /**
       * The other half of the rule, and the half that makes it playable: a hook sliding along
       * the keyway rides over the pins between here and there rather than jacking each one up to
       * whatever height the hand is holding. Without it, unclamping a captured driver turned
       * every repositioning move into a wrecking ball.
       */
      const s = createSimState(FIVE_PIN, 3, PERFECT_CONFIG)
      holdFor(s, tensionOnly(0.5), 0.3)
      const first = s.chambers[s.bindingChamber]
      if (!first) throw new Error('expected a binding chamber')
      holdFor(s, pick(first.index, first.setLift + first.captureWindow / 2, 0.5), 1.5)
      expect(first.state).toBe('SET')

      // Now travel the length of the lock and back, hand held high the whole way.
      const far = first.index === 0 ? 4 : 0
      holdFor(s, pick(far, 3.5, 0.5), 2.0)
      holdFor(s, pick(first.index === 0 ? 3 : 1, 3.5, 0.5), 2.0)
      expect(first.state, 'a set pin should survive being travelled past').not.toBe('OVERSET')
    })
  })

  it('a set chamber key pin drops back to the keyway floor when the pick leaves', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    const c = s.chambers[s.bindingChamber]
    if (!c) throw new Error('expected a binding chamber')
    holdFor(s, pick(c.index, c.setLift + c.captureWindow / 2, 0.5), 1.0)
    expect(c.state).toBe('SET')
    holdFor(s, tensionOnly(0.5), 0.5)

    // The **key pin** is what drops — this test always said so in its name, and now the state
    // can say it too: `keyLift` is the key pin and `lift` is the driver (DECISIONS D-042).
    expect(c.keyLift, 'the key pin should be back on the keyway floor').toBeCloseTo(0, 6)
    // The **driver** does not: it has settled onto the plug's ledge, with its bottom exactly on
    // the shear line, and nothing short of losing tension will bring it down.
    expect(c.lift, 'the captured driver should be resting on the ledge').toBeCloseTo(c.setLift, 6)
    expect(c.state).toBe('SET')
  })
})

describe('toleranceQuality is the difficulty dial — SIMULATION.md §7', () => {
  /**
   * Sweep every chamber to a fixed overshoot above its own `setLift`, at a range of seeds,
   * and count how many attempts ended with at least one jammed pin. The input is identical
   * across the two locks; only `toleranceQuality` differs.
   */
  function oversetRate(toleranceQuality: number, overshoot: number, seeds = 60): number {
    const def = makeLock({
      slug: `tol-${toleranceQuality}`,
      bitting: [3.4, 2.9, 4.1, 3.7, 3.0],
      toleranceQuality,
    })
    let jammed = 0
    for (let seed = 0; seed < seeds; seed += 1) {
      const s = createSimState(def, seed, PERFECT_CONFIG)
      holdFor(s, tensionOnly(0.45), 0.3)
      for (const c of s.chambers) {
        holdFor(s, pick(c.index, c.setLift + overshoot, 0.45), 0.5)
      }
      if (s.stats.oversets > 0) jammed += 1
    }
    return jammed / seeds
  }

  it('a looser lock forgives an overshoot that a tighter one punishes', () => {
    // Window is 0.62 x quality: 0.868mm at 1.4, 0.372mm at 0.6.
    const loose = oversetRate(1.4, 0.42)
    const tight = oversetRate(0.6, 0.42)
    expect(loose).toBe(0)
    expect(tight).toBe(1)
    expect(tight).toBeGreaterThan(loose)
  })

  it('the overset rate rises monotonically as tolerance tightens', () => {
    const rates = [1.4, 1.1, 0.9, 0.7].map((q) => oversetRate(q, 0.5, 30))
    for (let i = 1; i < rates.length; i += 1) {
      expect(rates[i] as number, `quality step ${i}`).toBeGreaterThanOrEqual(rates[i - 1] as number)
    }
    expect(rates[0]).toBe(0)
    expect(rates[rates.length - 1]).toBe(1)
  })
})
