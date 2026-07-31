import { describe, expect, it } from 'vitest'
import {
  DT,
  OPEN_THETA_FRACTION,
  STARTER_TOOLS,
  THETA_OPEN,
  T_FULL_TURN,
  T_SET_HOLD,
  countEvents,
  createSimState,
  drainEvents,
  falseSetLifts,
  hold,
  pickedButUnturned,
  runTape,
  seconds,
  totalTicks,
  withTools,
  type InputTape,
} from '../../src/sim'
import {
  FIVE_PIN,
  PERFECT_CONFIG,
  THREE_PIN,
  TWELVE_PIN,
  configWith,
  holdFor,
  makeLock,
  pick,
  scriptedOpen,
  tensionOnly,
  workBindingChamber,
} from './fixtures'

/**
 * A tape written by hand against `THREE_PIN` at seed 1.
 *
 * That instance rolls δ = [0.01037, 0.00134, 0.01462], so the plug binds chamber 1, then 0,
 * then 2. `setLift` is `5 - K`, giving 1.80 / 1.00 / 2.20, and the capture window is
 * `0.62 x 1.35 = 0.837`, so each target below is `setLift + W/2` for the chamber whose turn
 * it is. Nothing here is computed from the state — it is a fixed sequence of button presses.
 */
const HAND_TAPE: InputTape = [
  hold(tensionOnly(0.5), seconds(0.3)),
  hold(pick(1, 1.42, 0.5), seconds(0.6)),
  hold(pick(0, 2.22, 0.5), seconds(0.6)),
  hold(pick(2, 2.62, 0.5), seconds(0.6)),
  hold(tensionOnly(0.6), seconds(0.6)),
]

describe('the open condition — SIMULATION.md §4', () => {
  it('a hand-written input tape opens the 3-pin lock', () => {
    const s = createSimState(THREE_PIN, 1, configWith(STARTER_TOOLS))
    expect(s.chambers.map((c) => Number(c.delta.toFixed(5)))).toEqual([0.01037, 0.00134, 0.01462])
    runTape(s, HAND_TAPE)
    expect(s.chambers.map((c) => c.state)).toEqual(['SET', 'SET', 'SET'])
    expect(s.opened).toBe(true)
    expect(s.stats.setOrder).toEqual([1, 0, 2])
    expect(s.stats.oversets).toBe(0)
    expect(s.theta).toBeGreaterThanOrEqual(THETA_OPEN * OPEN_THETA_FRACTION)
    expect(totalTicks(HAND_TAPE)).toBe(324)
  })

  it('emits LOCK_OPENED exactly once', () => {
    const s = createSimState(THREE_PIN, 1, configWith(STARTER_TOOLS))
    runTape(s, HAND_TAPE)
    const events = drainEvents(s)
    expect(countEvents(events, 'LOCK_OPENED')).toBe(1)
    holdFor(s, tensionOnly(0.6), 1.0)
    expect(countEvents(drainEvents(s), 'LOCK_OPENED')).toBe(0)
  })

  it('needs every chamber set — rotation alone is not enough', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(1.0), 2.0)
    expect(s.opened).toBe(false)
    expect(s.theta).toBeLessThan(0.05)
    workBindingChamber(s, 1.0)
    workBindingChamber(s, 1.0)
    expect(s.chambers.filter((c) => c.state === 'SET')).toHaveLength(2)
    holdFor(s, tensionOnly(1.0), 2.0)
    expect(s.opened).toBe(false)
  })

  it('needs the turn as well — all set but barely tensioned does not open', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    for (let i = 0; i < 3; i += 1) workBindingChamber(s, 0.5)
    expect(s.chambers.every((c) => c.state === 'SET')).toBe(true)
    // Ease tension down to a level that still holds the sets but demands little rotation.
    holdFor(s, tensionOnly(0.1), 3.0)
    expect(s.chambers.every((c) => c.state === 'SET')).toBe(true)
    expect(s.thetaDemand).toBeCloseTo(THETA_OPEN * (0.1 / T_FULL_TURN), 6)
    expect(s.opened).toBe(false)
    // Ask for the turn and it goes.
    holdFor(s, tensionOnly(0.4), 1.0)
    expect(s.opened).toBe(true)
  })

  it('opens at any tension at or above T_FULL_TURN, including a light-hand run', () => {
    // Achievement 15 (*Light Hand*) requires an open that never exceeds T = 0.3.
    const s = createSimState(FIVE_PIN, 33, PERFECT_CONFIG)
    expect(scriptedOpen(s, 0.28, 30)).toBe(true)
    expect(s.stats.maxTension).toBeLessThanOrEqual(0.3)
  })

  it('opens a 12-chamber lock', () => {
    const s = createSimState(TWELVE_PIN, 12, PERFECT_CONFIG)
    expect(scriptedOpen(s, 0.5, 60)).toBe(true)
    expect(s.chambers.every((c) => c.state === 'SET')).toBe(true)
  })

  it('opens across many seeds with a scripted picker and real tool jitter', () => {
    // The starter hook reaches 4 chambers, so a 5-pin lock needs the Medium Hook. That gate
    // is deliberate (PHASES.md Phase 8); see the reach tests in binding.test.ts.
    const mediumHook = configWith(withTools(STARTER_TOOLS, { reach: 5 }))
    let opened = 0
    for (let seed = 0; seed < 120; seed += 1) {
      const s = createSimState(FIVE_PIN, seed, mediumHook)
      if (scriptedOpen(s, 0.5, 30)) opened += 1
    }
    expect(opened).toBe(120)
  })

  it('a lock deeper than the pick can reach cannot be opened at all', () => {
    const s = createSimState(FIVE_PIN, 1, configWith(STARTER_TOOLS))
    expect(scriptedOpen(s, 0.5, 10)).toBe(false)
    expect(s.chambers.filter((c) => c.state === 'SET').length).toBeLessThan(5)
  })
})

describe('plug rotation — SIMULATION.md §4', () => {
  it('θ never exceeds θ_max, and θ_max never exceeds θ_open', () => {
    const s = createSimState(FIVE_PIN, 4, PERFECT_CONFIG)
    for (let i = 0; i < 3000; i += 1) {
      const inp = i % 3 === 0 ? tensionOnly(0.6) : pick(i % 5, 1.5, 0.6)
      runTape(s, [hold(inp, 1)])
      expect(s.theta).toBeLessThanOrEqual(s.thetaMax + 1e-9)
      expect(s.thetaMax).toBeLessThanOrEqual(THETA_OPEN + 1e-9)
      expect(s.theta).toBeGreaterThanOrEqual(0)
    }
  })

  it('θ moves rather than teleporting, and is speed-capped', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.5), 0.3)
    for (let i = 0; i < 3; i += 1) workBindingChamber(s, 0.5)
    // Every chamber is set; the plug now has the whole 0.52 rad to travel.
    let maxStep = 0
    let ticks = 0
    while (!s.opened && ticks < 600) {
      const before = s.theta
      runTape(s, [hold(tensionOnly(0.8), 1)])
      maxStep = Math.max(maxStep, s.theta - before)
      ticks += 1
    }
    expect(s.opened).toBe(true)
    // PLUG_MAX_RATE = 1.2 rad/s, so no single 1/120s tick may move more than 0.01 rad.
    expect(maxStep).toBeLessThanOrEqual(1.2 * DT + 1e-9)
    // …and the whole swing therefore takes a visible amount of time.
    expect(ticks * DT).toBeGreaterThan(0.3)
  })

  it('a fully false-set lock swings to 55-70% of θ_open and never opens', () => {
    const fiveSpool = makeLock({
      slug: 'five-spool',
      bitting: [3.0, 3.1, 2.9, 3.2, 3.0],
      pins: ['spool', 'spool', 'spool', 'spool', 'spool'],
      toleranceQuality: 0.95,
      tier: 3,
    })
    const s = createSimState(fiveSpool, 11, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.35), 0.5)

    // Park each chamber in its waist in binding order, without pushing through.
    for (let round = 0; round < s.chambers.length; round += 1) {
      const b = s.bindingChamber
      if (b < 0) break
      const c = s.chambers[b]
      if (!c) break
      const waist = falseSetLifts(c)[0] ?? 0
      for (let i = 0; i < 240 && c.state !== 'FALSE_SET'; i += 1) {
        runTape(s, [hold(pick(b, waist, 0.35), 1)])
      }
    }
    holdFor(s, tensionOnly(0.35), 1.0)

    expect(s.chambers.every((c) => c.state === 'FALSE_SET')).toBe(true)
    const fraction = s.theta / THETA_OPEN
    expect(fraction).toBeGreaterThan(0.55)
    expect(fraction).toBeLessThan(0.7)
    expect(s.opened).toBe(false)

    // It stays that way — that is the lie. Crank the tension and it still will not open.
    holdFor(s, tensionOnly(1.0), 5.0)
    expect(s.opened).toBe(false)
    expect(s.chambers.some((c) => c.state === 'SET')).toBe(false)
  })

  describe('a picked lock that has not been turned — DECISIONS D-048', () => {
    /**
     * The state the player could not read. Every driver is up, nothing binds, and the plug is
     * short of open because a feather-light wrench only ever asks for a third of a turn. The
     * simulation has always been right about this; the *picture* said nothing, so a player who
     * did everything correctly with a light hand watched a solved lock refuse to open.
     */
    it('reads as picked-but-unturned, and turning harder opens it', () => {
      const s = createSimState(FIVE_PIN, 7, PERFECT_CONFIG)
      /**
       * The band where picked-but-unturned lives, and it is narrower than it was.
       *
       * It has to hold set pins mid-pick — above `T_SET_HOLD` since D-095 — and still be below
       * `T_FULL_TURN`, or the plug simply turns and the lock opens. 0.85 of `T_FULL_TURN` is 0.212,
       * comfortably inside both. It used to be 0.5 of it, which is now light enough to shed pins
       * on the way, so the test could never get all five set to begin with.
       */
      const light = T_FULL_TURN * 0.85
      expect(light).toBeGreaterThan(T_SET_HOLD)
      expect(light).toBeLessThan(T_FULL_TURN)
      holdFor(s, tensionOnly(light), 0.3)
      for (let round = 0; round < s.chambers.length * 3; round += 1) {
        if (s.bindingChamber < 0) break
        workBindingChamber(s, light)
      }
      holdFor(s, tensionOnly(light), 1.0)

      expect(s.chambers.every((c) => c.state === 'SET')).toBe(true)
      expect(s.opened).toBe(false)
      // Nothing in the lock is stopping the plug — only the hand on the wrench is.
      expect(s.thetaMax).toBeCloseTo(THETA_OPEN, 6)
      expect(s.thetaDemand).toBeLessThan(THETA_OPEN * OPEN_THETA_FRACTION)
      expect(pickedButUnturned(s)).toBe(true)

      // Wind on and it goes. The gauge says `TURN HARDER`; this is that being true.
      holdFor(s, tensionOnly(0.6), 2.0)
      expect(s.opened).toBe(true)
      expect(pickedButUnturned(s)).toBe(false)
    })

    it('announces itself exactly once, and re-arms if a pin is lost', () => {
      /**
       * The event the audio and the subtitles listen to (D-055). Edge-triggered in the sim,
       * because events are the only channel out of it — so the thing to prove is that it fires on
       * the transition and not once per tick for the rest of the attempt.
       */
      const s = createSimState(FIVE_PIN, 7, PERFECT_CONFIG)
      const light = T_FULL_TURN * 0.85
      holdFor(s, tensionOnly(light), 0.3)
      for (let round = 0; round < s.chambers.length * 3; round += 1) {
        if (s.bindingChamber < 0) break
        workBindingChamber(s, light)
      }
      holdFor(s, tensionOnly(light), 1.0)
      expect(pickedButUnturned(s)).toBe(true)
      expect(countEvents(drainEvents(s), 'PLUG_FREE')).toBe(1)

      // Hold there for a good while: it does not keep saying so.
      holdFor(s, tensionOnly(light), 2.0)
      expect(countEvents(drainEvents(s), 'PLUG_FREE')).toBe(0)

      // Lose the lock, get back to the same place, and it says so again.
      holdFor(s, tensionOnly(0), 0.5)
      expect(pickedButUnturned(s)).toBe(false)
      holdFor(s, tensionOnly(light), 0.3)
      for (let round = 0; round < s.chambers.length * 3; round += 1) {
        if (s.bindingChamber < 0) break
        workBindingChamber(s, light)
      }
      holdFor(s, tensionOnly(light), 1.0)
      expect(pickedButUnturned(s)).toBe(true)
      expect(countEvents(drainEvents(s), 'PLUG_FREE')).toBe(1)
    })

    it('is false while any pin is still down, however hard you turn', () => {
      const s = createSimState(FIVE_PIN, 7, PERFECT_CONFIG)
      holdFor(s, tensionOnly(0.9), 1.0)
      expect(s.chambers.every((c) => c.state === 'SET')).toBe(false)
      expect(pickedButUnturned(s)).toBe(false)
    })
  })
})
