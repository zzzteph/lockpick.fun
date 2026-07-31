import { describe, expect, it } from 'vitest'
import {
  PROFILES,
  bandAtShearLine,
  bandLiftRange,
  createSimState,
  falseSetLifts,
  grooveDepthAt,
  grooveFloorLift,
  readShearLine,
  taperAt,
} from '../../src/sim'
import { PERFECT_CONFIG, SERRATED_LOCK, SPOOL_LOCK, THREE_PIN, makeLock } from './fixtures'

describe('band at the shear line — SIMULATION.md §3', () => {
  it('walks the bands from the bottom', () => {
    const spool = PROFILES.spool // full 0.45 · groove 0.95 · full 3.10
    expect(bandAtShearLine(spool, -0.2)).toBe(0)
    expect(bandAtShearLine(spool, -0.44)).toBe(0)
    expect(bandAtShearLine(spool, -0.5)).toBe(1)
    expect(bandAtShearLine(spool, -1.39)).toBe(1)
    expect(bandAtShearLine(spool, -1.5)).toBe(2)
    expect(bandAtShearLine(spool, -4.4)).toBe(2)
  })

  it('never runs off the end of the profile', () => {
    expect(bandAtShearLine(PROFILES.standard, -0.0)).toBe(0)
    expect(bandAtShearLine(PROFILES.standard, -4.5)).toBe(0)
    expect(bandAtShearLine(PROFILES.spool, -99)).toBe(PROFILES.spool.bands.length - 1)
  })
})

describe('geometry classification', () => {
  const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
  const c = s.chambers[0]

  it('reads SOLID below the window for a standard pin', () => {
    if (!c) throw new Error('missing chamber')
    expect(readShearLine(c, 0).geometry).toBe('SOLID')
    expect(readShearLine(c, c.setLift - 0.001).geometry).toBe('SOLID')
  })

  it('reads WINDOW from the shear line up to the top of the capture band', () => {
    if (!c) throw new Error('missing chamber')
    expect(readShearLine(c, c.setLift).geometry).toBe('WINDOW')
    expect(readShearLine(c, c.setLift + c.captureWindow / 2).geometry).toBe('WINDOW')
    expect(readShearLine(c, c.setLift + c.captureWindow * 0.999).geometry).toBe('WINDOW')
  })

  it('reads OVER past the window', () => {
    if (!c) throw new Error('missing chamber')
    expect(readShearLine(c, c.setLift + c.captureWindow + 1e-6).geometry).toBe('OVER')
  })

  it('reads GROOVE when a reduced band is at the shear line', () => {
    const sp = createSimState(SPOOL_LOCK, 3, PERFECT_CONFIG)
    const spool = sp.chambers[1]
    if (!spool) throw new Error('missing chamber')
    const waist = falseSetLifts(spool)[0]
    expect(waist).toBeDefined()
    if (waist === undefined) return
    const reading = readShearLine(spool, waist)
    expect(reading.geometry).toBe('GROOVE')
    expect(reading.bandAtShear).toBe(1)
  })
})

describe('groove geometry helpers', () => {
  it('bandLiftRange inverts the depth mapping', () => {
    const sp = createSimState(SPOOL_LOCK, 3, PERFECT_CONFIG)
    const spool = sp.chambers[1]
    if (!spool) throw new Error('missing chamber')
    const range = bandLiftRange(spool, 1)
    // Groove spans depths 0.45 .. 1.40, so lift spans setLift-1.40 .. setLift-0.45.
    expect(range.min).toBeCloseTo(spool.setLift - 1.4, 9)
    expect(range.max).toBeCloseTo(spool.setLift - 0.45, 9)
    for (const lift of [range.min + 0.01, (range.min + range.max) / 2, range.max - 0.01]) {
      expect(readShearLine(spool, lift).geometry).toBe('GROOVE')
    }
    expect(readShearLine(spool, range.min - 0.01).geometry).toBe('SOLID')
    expect(readShearLine(spool, range.max + 0.01).geometry).toBe('SOLID')
  })

  it('the groove floor keeps the chamber inside its groove', () => {
    const sp = createSimState(SPOOL_LOCK, 3, PERFECT_CONFIG)
    const spool = sp.chambers[1]
    if (!spool) throw new Error('missing chamber')
    const waist = falseSetLifts(spool)[0] ?? 0
    const reading = readShearLine(spool, waist)
    spool.bandAtShear = reading.bandAtShear
    const floor = grooveFloorLift(spool)
    expect(readShearLine(spool, floor).geometry).toBe('GROOVE')
    expect(readShearLine(spool, floor - 0.002).geometry).toBe('SOLID')
  })

  it('reports depth and taper of the band at the shear line, and zero on a full band', () => {
    const sp = createSimState(SPOOL_LOCK, 3, PERFECT_CONFIG)
    const spool = sp.chambers[1]
    if (!spool) throw new Error('missing chamber')
    spool.bandAtShear = 1
    expect(grooveDepthAt(spool)).toBeCloseTo(0.3, 9)
    expect(taperAt(spool)).toBeCloseTo(0.15, 9)
    spool.bandAtShear = 0
    expect(grooveDepthAt(spool)).toBe(0)
    expect(taperAt(spool)).toBe(0)
    spool.bandAtShear = -1
    expect(grooveDepthAt(spool)).toBe(0)
    expect(taperAt(spool)).toBe(0)
  })
})

describe('falseSetLifts', () => {
  it('lists one lift per groove, ascending, for a serrated pin', () => {
    const s = createSimState(SERRATED_LOCK, 5, PERFECT_CONFIG)
    const c = s.chambers[0]
    if (!c) throw new Error('missing chamber')
    const lifts = falseSetLifts(c)
    expect(lifts).toHaveLength(4)
    for (let i = 1; i < lifts.length; i += 1) {
      expect(lifts[i] as number).toBeGreaterThan(lifts[i - 1] as number)
    }
    for (const lift of lifts) {
      expect(readShearLine(c, lift).geometry).toBe('GROOVE')
    }
  })

  it('is empty for a standard pin', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    const c = s.chambers[0]
    if (!c) throw new Error('missing chamber')
    expect(falseSetLifts(c)).toEqual([])
  })

  it('drops grooves that sit below zero lift', () => {
    // A shallow-cut spool chamber cannot reach its waist; the list must not offer a
    // negative lift the pick could never produce.
    const s = createSimState(
      makeLock({ bitting: [3.0, 2.9], pins: ['standard', 'spool'] }),
      1,
      PERFECT_CONFIG,
    )
    const c = s.chambers[1]
    if (!c) throw new Error('missing chamber')
    for (const lift of falseSetLifts(c)) expect(lift).toBeGreaterThanOrEqual(0)
  })
})
