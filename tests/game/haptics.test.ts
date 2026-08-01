/**
 * Haptics — DECISIONS D-131.
 *
 * `src/ui/haptics.ts` takes its device and its clock by injection precisely so this can be tested
 * without a phone: the thing worth pinning is not that `navigator.vibrate` exists, but that the
 * right events reach it, that a cascade does not turn into one long buzz, and that the whole module
 * is silent when it is switched off or has nothing to vibrate.
 */

import { describe, expect, it } from 'vitest'
import { Haptics, MIN_GAP_MS, PATTERNS, detectVibrator, type Vibrator } from '../../src/ui/haptics'
import type { SimEvent } from '../../src/sim'

function fake() {
  const calls: (number | readonly number[])[] = []
  let clock = 0
  const device: Vibrator = {
    vibrate: (pattern) => {
      calls.push(pattern)
      return true
    },
  }
  const h = new Haptics(device, () => clock)
  h.enabled = true
  return {
    h,
    calls,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const setEvent: SimEvent = { type: 'PIN_SET', chamber: 0, tension: 0.4, time: 1 }
const oversetEvent: SimEvent = { type: 'PIN_OVERSET', chamber: 0, time: 1 }

describe('haptics', () => {
  it('vibrates on the events a hand would feel', () => {
    const { h, calls, advance } = fake()
    const events: SimEvent[] = [
      setEvent,
      oversetEvent,
      { type: 'FALSE_SET_ENTERED', chamber: 1, depth: 2, time: 1 },
      { type: 'PLUG_FREE', time: 1 },
      { type: 'RESET', kind: 'full', dropped: [0, 1], time: 1 },
      { type: 'PICK_BROKEN', time: 1 },
      { type: 'LOCK_OPENED', time: 1, ticks: 10 },
    ]
    for (const e of events) {
      h.handleEvents([e])
      advance(MIN_GAP_MS)
    }
    expect(calls).toEqual([
      PATTERNS.set,
      PATTERNS.overset,
      PATTERNS.falseSet,
      PATTERNS.free,
      PATTERNS.reset,
      PATTERNS.broken,
      PATTERNS.opened,
    ])
  })

  it('says nothing about the events a motor cannot express', () => {
    const { h, calls, advance } = fake()
    const continuous: SimEvent[] = [
      { type: 'PLUG_MOVED', theta: 0.1, velocity: 0.2, time: 1 },
      { type: 'COUNTER_ROTATION', chamber: 0, force: 0.3, time: 1 },
      { type: 'PICK_MOVED', from: 0, to: 1, time: 1 },
      { type: 'ATTEMPT_STARTED', time: 0 },
      { type: 'PICK_BENT', time: 1 },
    ]
    for (const e of continuous) {
      h.handleEvents([e])
      advance(MIN_GAP_MS)
    }
    expect(calls).toEqual([])
  })

  it('collapses a burst to its first pattern', () => {
    // A cascade emits RESET and then a run of per-pin events on the same frame. Firing all of them
    // would leave the motor mid-spin-down for each, which is a buzz rather than three events.
    const { h, calls } = fake()
    h.handleEvents([
      { type: 'RESET', kind: 'full', dropped: [0, 1, 2], time: 1 },
      oversetEvent,
      setEvent,
    ])
    expect(calls).toEqual([PATTERNS.reset])
  })

  it('fires again once the gap has passed', () => {
    const { h, calls, advance } = fake()
    h.handleEvents([setEvent])
    advance(MIN_GAP_MS - 1)
    h.handleEvents([setEvent])
    expect(calls).toHaveLength(1)
    advance(1)
    h.handleEvents([setEvent])
    expect(calls).toHaveLength(2)
  })

  it('is silent when switched off', () => {
    const { h, calls, advance } = fake()
    h.enabled = false
    h.handleEvents([setEvent])
    advance(1000)
    h.detent()
    expect(calls).toEqual([])
  })

  it('ticks on a wrench detent, and rate-limits that too', () => {
    const { h, calls, advance } = fake()
    h.detent()
    expect(calls).toEqual([PATTERNS.detent])
    // Dragging fast crosses several steps inside one gap; the extra ticks are dropped rather than
    // queued, or the motor would still be running steps the wrench left behind.
    h.detent()
    h.detent()
    expect(calls).toHaveLength(1)
    advance(MIN_GAP_MS)
    h.detent()
    expect(calls).toHaveLength(2)
  })

  it('is a harmless no-op with no device, and reports as unsupported', () => {
    const h = new Haptics(null, () => 0)
    h.enabled = true
    expect(h.isSupported).toBe(false)
    expect(() => {
      h.handleEvents([setEvent])
      h.detent()
    }).not.toThrow()
  })

  it('detects a real vibrator only when the browser has one', () => {
    expect(detectVibrator(undefined)).toBeNull()
    expect(detectVibrator({} as Navigator)).toBeNull()
    const withMotor = { vibrate: () => true } as unknown as Navigator
    expect(detectVibrator(withMotor)).not.toBeNull()
  })

  it('keeps every pattern short enough to read as an event, not a buzz', () => {
    for (const [name, pattern] of Object.entries(PATTERNS)) {
      const total = typeof pattern === 'number' ? pattern : pattern.reduce((a, b) => a + b, 0)
      expect(total, name).toBeLessThanOrEqual(320)
    }
  })
})
