import { describe, expect, it } from 'vitest'
import {
  DT,
  STARTER_TOOLS,
  createSimState,
  hold,
  runTape,
  seconds,
  snapshotSimState,
  step,
  type InputTape,
} from '../../src/sim'
import { FIVE_PIN, TWELVE_PIN, configWith, pick, tensionOnly, RELEASED } from './fixtures'

/** A tape long and varied enough that any drift would show: 10,000 ticks ≈ 83 seconds. */
function longTape(): InputTape {
  const segments = [
    hold(tensionOnly(0.45), seconds(0.5)),
    hold(pick(0, 1.2, 0.45), seconds(0.9)),
    hold(pick(1, 2.1, 0.45), seconds(0.9)),
    hold(pick(2, 0.7, 0.6), seconds(0.9)),
    hold(RELEASED, seconds(0.3)),
    hold(pick(3, 1.5, 0.3), seconds(0.9)),
    hold(pick(1, 2.6, 0.75), seconds(0.9)),
    hold(tensionOnly(0.2), seconds(0.4)),
    hold(pick(2, 1.9, 0.5), seconds(0.9)),
    hold(pick(0, 2.4, 0.5), seconds(0.9)),
  ]
  const out: InputTape[] = []
  for (let rep = 0; rep < 2; rep += 1) out.push(segments)
  return out.flat()
}

describe('determinism — SIMULATION.md §11', () => {
  it('same seed + same input tape gives an identical state after 10,000 ticks', () => {
    const config = configWith(STARTER_TOOLS)
    const tape = longTape()

    const a = createSimState(FIVE_PIN, 4242, config)
    const b = createSimState(FIVE_PIN, 4242, config)
    runTape(a, tape)
    runTape(b, tape)
    // Top the run up to a full 10,000 ticks with neutral input.
    while (a.ticks < 10_000) step(a, RELEASED, DT)
    while (b.ticks < 10_000) step(b, RELEASED, DT)

    expect(a.ticks).toBe(10_000)
    expect(snapshotSimState(a)).toBe(snapshotSimState(b))
  })

  it('the tool wobble really is exercised, so the test is not vacuous', () => {
    // If the RNG were never advanced, determinism would be trivially true.
    const a = createSimState(FIVE_PIN, 4242, configWith(STARTER_TOOLS))
    const before = { ...a.rng }
    runTape(a, [hold(tensionOnly(0.5), seconds(1))])
    expect({ ...a.rng }).not.toEqual(before)
    expect(a.tensionWobble).not.toBe(0)
  })

  it('different seeds diverge', () => {
    const config = configWith(STARTER_TOOLS)
    const tape = longTape()
    const a = createSimState(FIVE_PIN, 1, config)
    const b = createSimState(FIVE_PIN, 2, config)
    runTape(a, tape)
    runTape(b, tape)
    expect(snapshotSimState(a)).not.toBe(snapshotSimState(b))
  })

  it('replaying the same tape onto a fresh state reproduces every intermediate tick', () => {
    const config = configWith(STARTER_TOOLS)
    const a = createSimState(TWELVE_PIN, 909, config)
    const b = createSimState(TWELVE_PIN, 909, config)
    const inputs = [
      tensionOnly(0.4),
      pick(0, 1.4, 0.4),
      pick(3, 2.0, 0.4),
      pick(7, 1.1, 0.55),
      RELEASED,
    ]
    for (let i = 0; i < 1200; i += 1) {
      const inp = inputs[i % inputs.length]
      if (!inp) throw new Error('bad input index')
      step(a, inp, DT)
      step(b, inp, DT)
      if (i % 97 === 0) expect(snapshotSimState(a)).toBe(snapshotSimState(b))
    }
    expect(snapshotSimState(a)).toBe(snapshotSimState(b))
  })

  it('runTape can stop the moment the lock opens', () => {
    const config = configWith(STARTER_TOOLS)
    const s = createSimState(FIVE_PIN, 5, config)
    const before = s.ticks
    runTape(s, [hold(tensionOnly(0.4), 10)], { stopOnOpen: true })
    expect(s.ticks).toBe(before + 10)
  })
})
