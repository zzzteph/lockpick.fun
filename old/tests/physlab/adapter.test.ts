/**
 * PHYSLAB → sim adapter — parity harness (migration Phase A).
 *
 * Proves the bridge: physlab can be built from a *real* `LockDef`, played to open, and read back as
 * the game's `ChamberState` + `SimEvent` contract — deterministically. No game code is touched; this
 * is the evidence that physlab can wear the game's contract before anything is wired in.
 */

import { describe, expect, it } from 'vitest'

import { ALL_LOCKS, chambersOf } from '../../src/game/locks'
import { PERFECT_TOOLS, type ChamberState, type LockDef, type SimConfig, type SimInput } from '../../src/sim'
import { labFromLock, readView, solveLab, stepFromSim } from '../../src/physlab/adapter'

const CONFIG: SimConfig = { tools: PERFECT_TOOLS, featherEnabled: true, assist: 'training' }
const VALID_STATES: ReadonlySet<ChamberState> = new Set(['FREE', 'BINDING', 'FALSE_SET', 'SET', 'OVERSET'])

const pinTumbler = ALL_LOCKS.filter((l) => l.family === 'pin-tumbler')
const isStandard = (l: LockDef): boolean => l.pins.every((p) => p === 'standard')
const hasSpool = (l: LockDef): boolean => l.pins.some((p) => p.startsWith('spool'))

const standardLock = pinTumbler.find((l) => isStandard(l) && l.pins.length >= 3)!
const spoolLock = pinTumbler.find(hasSpool)!

describe('adapter builds and solves a real lock', () => {
  it('opens a standard pin-tumbler lock, setting every chamber', () => {
    const lab = labFromLock(standardLock, 123, CONFIG)
    const { opened, rounds, events } = solveLab(lab)
    expect(opened).toBe(true)
    expect(rounds).toBeGreaterThanOrEqual(chambersOf(standardLock))

    const setCount = events.filter((e) => e.type === 'PIN_SET').length
    expect(setCount).toBeGreaterThanOrEqual(chambersOf(standardLock)) // one PIN_SET per chamber (or more, if any re-set)
    expect(events.filter((e) => e.type === 'LOCK_OPENED')).toHaveLength(1)
    expect(events.some((e) => e.type === 'PICK_MOVED')).toBe(true)
  })

  it('opens a spool pin-tumbler lock via the eased technique, with false sets on the way', () => {
    const lab = labFromLock(spoolLock, 77, CONFIG)
    const { opened, events } = solveLab(lab)
    expect(opened).toBe(true)
    expect(events.some((e) => e.type === 'FALSE_SET_ENTERED')).toBe(true) // the spool lied at least once
  })
})

describe('adapter presents the game contract', () => {
  it('reads every chamber as a valid ChamberState and resistance in [0,1]', () => {
    const lab = labFromLock(spoolLock, 5, CONFIG)
    // Drive a while, sampling the view.
    for (let t = 0; t < 400; t += 1) {
      const input: SimInput = { chamber: t % chambersOf(spoolLock), liftTarget: 1.6, tensionHeld: true, tensionLevel: 0.32 }
      stepFromSim(lab, input)
      const view = readView(lab)
      expect(view.chambers).toHaveLength(chambersOf(spoolLock))
      for (const c of view.chambers) expect(VALID_STATES.has(c.state)).toBe(true)
      expect(view.resistance).toBeGreaterThanOrEqual(0)
      expect(view.resistance).toBeLessThanOrEqual(1)
      expect(view.tension).toBeGreaterThanOrEqual(0)
    }
  })

  it('is deterministic — the same lock and seed trace identically', () => {
    const tape: SimInput[] = []
    for (let t = 0; t < 600; t += 1) {
      tape.push({
        chamber: Math.floor(t / 40) % chambersOf(spoolLock),
        liftTarget: 1.2 + Math.sin(t / 30),
        tensionHeld: true,
        tensionLevel: 0.3,
      })
    }
    const a = labFromLock(spoolLock, 999, CONFIG)
    const b = labFromLock(spoolLock, 999, CONFIG)
    for (const input of tape) {
      const ea = stepFromSim(a, input)
      const eb = stepFromSim(b, input)
      expect(readView(a)).toEqual(readView(b))
      expect(ea).toEqual(eb)
    }
  })

  it('rejects non-pin-tumbler families (hybrid boundary)', () => {
    const other = ALL_LOCKS.find((l) => l.family !== 'pin-tumbler')
    if (other) expect(() => labFromLock(other, 1, CONFIG)).toThrow(/pin-tumbler only/)
  })
})
