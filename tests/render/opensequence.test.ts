/**
 * The open sequence — `ART_DIRECTION.md §6`, `PHASES.md` Phase 11.
 *
 * The requirement is that the sequence *hits its timings* and *skips cleanly at any point
 * after 0.5s*. Both are numbers, so both are asserted as numbers here rather than admired on
 * a screen. Advancing in one-frame steps is deliberate: the sequence has to be right when it
 * is driven the way the game drives it, not only when handed a single large `dt`.
 */

import { describe, expect, it } from 'vitest'
import {
  BEATS,
  CARD_STAGGER_SECONDS,
  CREDIT_COUNT_SECONDS,
  DILATION_SCALE,
  SEQUENCE_SECONDS,
  SKIPPABLE_AFTER,
  burst,
  canSkip,
  cardOffsetX,
  cardProgress,
  cardVisible,
  createOpenSequence,
  rankReveal,
  currentBeat,
  easeOut,
  gridSweep,
  impactFlash,
  impactJolt,
  isSettled,
  plugAccel,
  shackleThrow,
  sequenceSeconds,
  skipOpenSequence,
  startOpenSequence,
  timeScale,
  updateOpenSequence,
  type OpenSequence,
} from '../../src/render/opensequence'

const FRAME = 1 / 60

function run(rank = 2, cards = 0, reducedMotion = false): OpenSequence {
  const seq = createOpenSequence(reducedMotion)
  startOpenSequence(seq, rank, cards)
  return seq
}

/**
 * Advance to `t` seconds in 60fps steps, returning the ticks emitted along the way.
 *
 * The trailing nudge is arithmetic, not physics: summing 1/60 a hundred and fifty times lands
 * a fraction of a nanosecond short of 2.5, and a beat boundary tested with `>=` would read as
 * not yet reached. The game never sees this — a real frame overshoots and gets clamped — so
 * the fix belongs in the harness rather than in the sequence.
 */
function advanceTo(seq: OpenSequence, t: number): number {
  let ticks = 0
  let guard = 0
  while (seq.elapsed < t - 1e-9 && guard < 10_000) {
    ticks += updateOpenSequence(seq, Math.min(FRAME, t - seq.elapsed))
    guard += 1
  }
  if (seq.elapsed < t) ticks += updateOpenSequence(seq, t - seq.elapsed + 1e-12)
  return ticks
}

describe('the beats', () => {
  it('are the eight from ART_DIRECTION.md §6, in order, ending at 2.5s', () => {
    const times = Object.values(BEATS)
    expect(times).toEqual([0, 0.25, 0.35, 0.6, 0.9, 1.2, 1.8, 2.5])
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    expect(SEQUENCE_SECONDS).toBe(2.5)
  })

  it('reports the beat it is in as it passes each one', () => {
    const seq = run()
    expect(currentBeat(seq)).toBe('accelerate')
    advanceTo(seq, 0.26)
    expect(currentBeat(seq)).toBe('impact')
    advanceTo(seq, 0.62)
    expect(currentBeat(seq)).toBe('burst')
    advanceTo(seq, 1.25)
    expect(currentBeat(seq)).toBe('credits')
    advanceTo(seq, 1.85)
    expect(currentBeat(seq)).toBe('cards')
    advanceTo(seq, 2.5)
    expect(currentBeat(seq)).toBe('settle')
  })

  it('does not start a beat before its time', () => {
    const seq = run()
    advanceTo(seq, 0.24)
    expect(impactFlash(seq)).toBe(0)
    expect(burst(seq)).toBe(0)
    expect(rankReveal(seq)).toBe(0)
    expect(cardVisible(seq, 0)).toBe(false)
  })
})

describe('beat 1 — the plug accelerates', () => {
  it('eases in rather than running linear', () => {
    const seq = run()
    advanceTo(seq, BEATS.impact / 2)
    // Halfway through, an ease-in has covered less than half the distance. A linear ramp
    // would sit at 0.5 and the weight ART_DIRECTION.md asks for would be missing.
    expect(plugAccel(seq)).toBeLessThan(0.4)
    advanceTo(seq, BEATS.impact)
    expect(plugAccel(seq)).toBeCloseTo(1, 5)
  })
})

describe('beat 2 — impact', () => {
  it('flashes the whole drawing for two frames and no longer', () => {
    const seq = run()
    advanceTo(seq, BEATS.impact + 1e-6)
    expect(impactFlash(seq)).toBeGreaterThan(0.5)
    advanceTo(seq, BEATS.impact + 3 / 60)
    expect(impactFlash(seq)).toBe(0)
  })

  it('jolts by up to 8px, and not at all under reduced motion', () => {
    const seq = run()
    let peak = 0
    for (let t = BEATS.impact; t < BEATS.impact + 0.12; t += 1 / 240) {
      advanceTo(seq, t)
      peak = Math.max(peak, Math.abs(impactJolt(seq)))
    }
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(8)

    const still = run(1000, 0, true)
    advanceTo(still, BEATS.impact + 0.04)
    expect(impactJolt(still)).toBe(0)
  })
})

describe('beat 3 — time dilation', () => {
  it('runs at a quarter speed for 400ms, then back to normal', () => {
    const seq = run()
    advanceTo(seq, BEATS.dilate - 0.01)
    expect(timeScale(seq)).toBe(1)
    advanceTo(seq, BEATS.dilate + 0.2)
    expect(timeScale(seq)).toBe(DILATION_SCALE)
    advanceTo(seq, BEATS.dilate + 0.41)
    expect(timeScale(seq)).toBe(1)
  })

  it('throws the shackle across the dilation, and keeps doing so with reduced motion', () => {
    for (const reduced of [false, true]) {
      const seq = run(1000, 0, reduced)
      advanceTo(seq, BEATS.dilate)
      expect(shackleThrow(seq)).toBeCloseTo(0, 5)
      advanceTo(seq, BEATS.dilate + 0.4)
      expect(shackleThrow(seq), `reducedMotion=${reduced}`).toBeCloseTo(1, 5)
    }
  })
})

describe('beats 4 and 5 — burst and sweep', () => {
  it('rise and fall inside their own windows', () => {
    const seq = run()
    advanceTo(seq, BEATS.burst + 0.2)
    expect(burst(seq)).toBeGreaterThan(0.5)
    advanceTo(seq, BEATS.burst + 0.5)
    expect(burst(seq)).toBe(0)

    advanceTo(seq, BEATS.sweep + 0.3)
    expect(gridSweep(seq)).toBeGreaterThan(0)
    advanceTo(seq, BEATS.sweep + 0.65)
    expect(gridSweep(seq)).toBe(0)
  })

  it('are both suppressed by reduced motion — they are pure movement', () => {
    const seq = run(1000, 0, true)
    advanceTo(seq, BEATS.burst + 0.2)
    expect(burst(seq)).toBe(0)
    advanceTo(seq, BEATS.sweep + 0.3)
    expect(gridSweep(seq)).toBe(0)
  })
})

describe('beat 6 — the credit count-up', () => {
  it('counts from zero and lands exactly on the total', () => {
    const seq = run(1240)
    advanceTo(seq, BEATS.credits)
    expect(rankReveal(seq)).toBe(0)
    advanceTo(seq, BEATS.credits + CREDIT_COUNT_SECONDS / 2)
    const mid = rankReveal(seq)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1240)
    advanceTo(seq, BEATS.credits + CREDIT_COUNT_SECONDS)
    expect(rankReveal(seq)).toBe(1)
  })

  it('never counts backwards', () => {
    const seq = run(985)
    let previous = 0
    for (let t = BEATS.credits; t <= SEQUENCE_SECONDS; t += FRAME) {
      advanceTo(seq, t)
      const now = rankReveal(seq)
      expect(now).toBeGreaterThanOrEqual(previous)
      previous = now
    }
  })

  it('emits exactly one mechanical tick, when the letter lands', () => {
    // It used to be one tick per digit of the payout — four for 1,240 credits, two for 50. Credits
    // went with D-091 and a rank is one thing, so it is one tick, whatever the rank.
    for (const rank of [0, 3, 6]) {
      const seq = run(rank)
      expect(advanceTo(seq, SEQUENCE_SECONDS), `rank ${rank}`).toBe(1)
    }
  })

  it('reveals under reduced motion too — the rank is information, not decoration', () => {
    const seq = run(2, 0, true)
    advanceTo(seq, SEQUENCE_SECONDS)
    expect(rankReveal(seq)).toBe(1)
  })
})

describe('beat 7 — achievement cards', () => {
  it('staggers them 120ms apart', () => {
    const seq = run(100, 4)
    advanceTo(seq, BEATS.cards + 1e-6)
    expect(cardVisible(seq, 0)).toBe(true)
    expect(cardVisible(seq, 1)).toBe(false)
    advanceTo(seq, BEATS.cards + CARD_STAGGER_SECONDS + 1e-6)
    expect(cardVisible(seq, 1)).toBe(true)
    expect(cardVisible(seq, 2)).toBe(false)
    advanceTo(seq, BEATS.cards + 3 * CARD_STAGGER_SECONDS + 1e-6)
    expect(cardVisible(seq, 3)).toBe(true)
  })

  it('slides each one in from the right and lands it', () => {
    const seq = run(100, 3)
    advanceTo(seq, BEATS.cards + 0.01)
    expect(cardOffsetX(seq, 0)).toBeGreaterThan(0)
    advanceTo(seq, SEQUENCE_SECONDS)
    for (let i = 0; i < 3; i += 1) {
      expect(cardProgress(seq, i)).toBeCloseTo(1, 5)
      expect(cardOffsetX(seq, i)).toBeCloseTo(0, 5)
    }
  })

  it('stacks correctly when several fire at once — every card lands, none is dropped', () => {
    // Finishing a tier can fire this many at once. Every one of them has to land on screen,
    // and the sequence waits for the last rather than cutting it off (D-030).
    for (const n of [1, 2, 4, 6, 9]) {
      const seq = run(100, n)
      expect(sequenceSeconds(seq)).toBeGreaterThanOrEqual(SEQUENCE_SECONDS)
      advanceTo(seq, sequenceSeconds(seq))
      for (let i = 0; i < n; i += 1) {
        expect(cardVisible(seq, i), `${n} cards, card ${i}`).toBe(true)
        expect(cardProgress(seq, i), `${n} cards, card ${i}`).toBeCloseTo(1, 5)
      }
      expect(isSettled(seq), `${n} cards`).toBe(true)
    }
  })

  it('runs exactly the spec length when four or fewer cards fire', () => {
    for (const n of [0, 1, 2, 3, 4]) {
      expect(sequenceSeconds(run(100, n)), `${n} cards`).toBe(SEQUENCE_SECONDS)
    }
    expect(sequenceSeconds(run(100, 6))).toBeGreaterThan(SEQUENCE_SECONDS)
  })

  it('shows them without sliding under reduced motion', () => {
    const seq = run(100, 3, true)
    advanceTo(seq, BEATS.cards + 0.01)
    expect(cardVisible(seq, 0)).toBe(true)
    expect(cardOffsetX(seq, 0)).toBe(0)
  })
})

describe('skipping', () => {
  it('does nothing at all before 0.5s', () => {
    const seq = run(500, 2)
    advanceTo(seq, SKIPPABLE_AFTER - 0.02)
    expect(canSkip(seq)).toBe(false)
    expect(skipOpenSequence(seq)).toBe(false)
    expect(isSettled(seq)).toBe(false)
  })

  it('lands on exactly the end state, from any moment after 0.5s', () => {
    // Whatever frame it is skipped on, what the player sees next must be identical.
    for (const at of [0.5, 0.7, 1.0, 1.35, 1.9, 2.2, 2.49]) {
      const seq = run(1240, 3)
      advanceTo(seq, at)
      expect(canSkip(seq), `at ${at}s`).toBe(true)
      expect(skipOpenSequence(seq), `at ${at}s`).toBe(true)

      expect(isSettled(seq), `at ${at}s`).toBe(true)
      expect(rankReveal(seq), `at ${at}s`).toBe(1)
      expect(impactFlash(seq), `at ${at}s`).toBe(0)
      expect(burst(seq), `at ${at}s`).toBe(0)
      expect(gridSweep(seq), `at ${at}s`).toBe(0)
      for (let i = 0; i < 3; i += 1) {
        expect(cardVisible(seq, i), `at ${at}s, card ${i}`).toBe(true)
        expect(cardOffsetX(seq, i), `at ${at}s, card ${i}`).toBeCloseTo(0, 5)
      }
    }
  })

  it('is idempotent — skipping twice is skipping once', () => {
    const seq = run(400, 1)
    advanceTo(seq, 1.0)
    skipOpenSequence(seq)
    const after = { ...seq }
    skipOpenSequence(seq)
    expect(seq.elapsed).toBe(after.elapsed)
    expect(rankReveal(seq)).toBe(1)
  })

  it('leaves the sequence stopped, so nothing keeps animating behind the results panel', () => {
    const seq = run(400, 1)
    advanceTo(seq, 1.0)
    skipOpenSequence(seq)
    updateOpenSequence(seq, FRAME)
    expect(seq.running).toBe(false)
    expect(seq.elapsed).toBe(SEQUENCE_SECONDS)
  })
})

describe('running to completion', () => {
  it('settles at 2.5s and stops', () => {
    const seq = run(320, 2)
    advanceTo(seq, SEQUENCE_SECONDS)
    expect(isSettled(seq)).toBe(true)
    expect(seq.running).toBe(false)
    expect(seq.elapsed).toBe(SEQUENCE_SECONDS)
  })

  it('never runs past its end, however coarse the frame', () => {
    const seq = run(320, 2)
    updateOpenSequence(seq, 10)
    expect(seq.elapsed).toBe(SEQUENCE_SECONDS)
    expect(rankReveal(seq)).toBe(1)
  })

  it('reaches the same end state under reduced motion, at the same time', () => {
    const plain = run(880, 3)
    const reduced = run(880, 3, true)
    advanceTo(plain, SEQUENCE_SECONDS)
    advanceTo(reduced, SEQUENCE_SECONDS)
    expect(reduced.elapsed).toBe(plain.elapsed)
    expect(rankReveal(reduced)).toBe(rankReveal(plain))
    expect(cardVisible(reduced, 2)).toBe(cardVisible(plain, 2))
  })
})

describe('easeOut', () => {
  it('starts at zero, ends at one, and decelerates', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.5)
    expect(easeOut(-1)).toBe(0)
    expect(easeOut(2)).toBe(1)
  })
})
