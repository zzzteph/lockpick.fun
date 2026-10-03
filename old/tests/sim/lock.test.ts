import { describe, expect, it } from 'vitest'
import {
  CONDITION_SPREAD,
  DRIVER_LENGTH,
  KEYWAY_FLOOR,
  LockDefError,
  MAX_CHAMBERS,
  MIN_DELTA_GAP,
  PROFILES,
  TOLERANCE_SPREAD,
  boundaryOffset,
  createRng,
  createSimState,
  driverPinTop,
  generateDeltas,
  keyPinBottom,
  keyPinTop,
  minimumSetLift,
  validateLockDef,
} from '../../src/sim'
import { FIVE_PIN, PERFECT_CONFIG, THREE_PIN, makeLock } from './fixtures'

describe('lock definition validation', () => {
  it('accepts the fixtures', () => {
    expect(() => {
      validateLockDef(THREE_PIN)
    }).not.toThrow()
    expect(() => {
      validateLockDef(FIVE_PIN)
    }).not.toThrow()
  })

  it('rejects a key pin that does not sit below the shear line', () => {
    expect(() => {
      validateLockDef(makeLock({ bitting: [3.0, 5.0] }))
    }).toThrow(/must sit below the shear line/)
    expect(() => {
      validateLockDef(makeLock({ bitting: [3.0, 5.4] }))
    }).toThrow(/must sit below the shear line/)
  })

  it('rejects a stack that does not straddle the shear line', () => {
    // K + D must exceed 5.0; with D = 4.5 that means K > 0.5.
    expect(() => {
      validateLockDef(makeLock({ bitting: [0.4] }))
    }).toThrow(/straddle the shear line/)
  })

  it('rejects non-positive key pins and non-finite bittings', () => {
    expect(() => {
      validateLockDef(makeLock({ bitting: [0] }))
    }).toThrow(/must be positive/)
    expect(() => {
      validateLockDef(makeLock({ bitting: [Number.NaN] }))
    }).toThrow(/not a finite number/)
  })

  it('rejects a chamber count outside range', () => {
    expect(() => {
      validateLockDef(makeLock({ bitting: [] }))
    }).toThrow(/chamber count/)
    expect(() => {
      validateLockDef(makeLock({ bitting: new Array<number>(MAX_CHAMBERS + 1).fill(3.0) }))
    }).toThrow(/chamber count/)
  })

  it('rejects a pins array that does not match the bitting', () => {
    expect(() => {
      validateLockDef(makeLock({ bitting: [3, 3, 3], pins: ['standard', 'standard'] }))
    }).toThrow(/pins has 2 entries but bitting has 3/)
  })

  it('rejects an unknown pin profile', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately invalid data
      validateLockDef(makeLock({ bitting: [3], pins: ['sproing' as any] }))
    }).toThrow(/is not a known pin profile/)
  })

  it('rejects a security pin whose grooves could never reach the shear line', () => {
    // A spool needs setLift above its waist top; K = 4.2 gives setLift 0.8, far too shallow.
    expect(() => {
      validateLockDef(makeLock({ bitting: [4.2], pins: ['spool'] }))
    }).toThrow(/would never reach the shear line/)
  })

  it('accepts a security pin with a deep enough cut', () => {
    expect(() => {
      validateLockDef(makeLock({ bitting: [3.0], pins: ['spool'] }))
    }).not.toThrow()
  })

  it('rejects out-of-range tolerance, par and tier', () => {
    expect(() => {
      validateLockDef(makeLock({ bitting: [3], toleranceQuality: 0 }))
    }).toThrow(/toleranceQuality/)
    expect(() => {
      validateLockDef(makeLock({ bitting: [3], toleranceQuality: 3 }))
    }).toThrow(/toleranceQuality/)
    expect(() => {
      validateLockDef(makeLock({ bitting: [3], par: 0 }))
    }).toThrow(/par must be positive/)
    // `pay` used to be validated here too. It is gone (D-091) — there is nothing to pay.
    expect(() => {
      validateLockDef(makeLock({ bitting: [3], tier: 9 }))
    }).toThrow(/tier must be 1-6/)
  })

  it('rejects a tolerance spread too small to separate the chambers', () => {
    expect(() => {
      validateLockDef(makeLock({ bitting: [3, 3, 3, 3, 3], toleranceSpread: 0.002 }))
    }).toThrow(/cannot hold 5 chambers/)
    expect(() => {
      validateLockDef(makeLock({ bitting: [3], toleranceSpread: 0 }))
    }).toThrow(/must be positive/)
  })

  it('rejects malformed identity, rows and sidebar data', () => {
    expect(() => {
      validateLockDef(makeLock({ bitting: [3], id: 0 }))
    }).toThrow(/id must be a positive integer/)
    expect(() => {
      validateLockDef(makeLock({ bitting: [3], slug: '' }))
    }).toThrow(/slug is required/)
    expect(() => {
      validateLockDef(makeLock({ bitting: [3], name: '' }))
    }).toThrow(/name is required/)
    expect(() => {
      validateLockDef(makeLock({ bitting: [3], rows: 4 }))
    }).toThrow(/rows must be 1 or 2/)
    expect(() => {
      validateLockDef(
        makeLock({ bitting: [3, 3], sidebar: { gatedChambers: [5], gateWidth: 0.1 } }),
      )
    }).toThrow(/out of range/)
    expect(() => {
      validateLockDef(makeLock({ bitting: [3, 3], sidebar: { gatedChambers: [1], gateWidth: 0 } }))
    }).toThrow(/gateWidth must be positive/)
  })

  it('names the lock in the error', () => {
    try {
      validateLockDef(makeLock({ bitting: [9], slug: 'broken-lock' }))
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(LockDefError)
      expect((err as LockDefError).lockSlug).toBe('broken-lock')
      expect((err as Error).message).toContain('broken-lock')
    }
  })
})

describe('tolerance offsets', () => {
  it('are distinct by at least MIN_DELTA_GAP, across many seeds', () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const deltas = generateDeltas(createRng(seed), 12, TOLERANCE_SPREAD)
      const sorted = [...deltas].sort((a, b) => a - b)
      for (let i = 1; i < sorted.length; i += 1) {
        const gap = (sorted[i] as number) - (sorted[i - 1] as number)
        expect(gap).toBeGreaterThanOrEqual(MIN_DELTA_GAP - 1e-12)
      }
      expect(sorted[0]).toBeGreaterThanOrEqual(0)
      expect(sorted[sorted.length - 1]).toBeLessThanOrEqual(TOLERANCE_SPREAD + 1e-12)
    }
  })

  it('throws rather than looping forever when the spread cannot fit', () => {
    expect(() => generateDeltas(createRng(1), 40, 0.001)).toThrow(/cannot separate/)
  })

  it('gives different binding orders for different seeds', () => {
    const orders = new Set<string>()
    for (let seed = 0; seed < 500; seed += 1) {
      const s = createSimState(FIVE_PIN, seed, PERFECT_CONFIG)
      const order = [...s.chambers]
        .sort((a, b) => a.delta - b.delta)
        .map((c) => c.index)
        .join('')
      orders.add(order)
    }
    // 5! = 120 possible orders; a good spread should reach most of them.
    expect(orders.size).toBeGreaterThan(100)
  })

  it('is stable for a given lock and seed', () => {
    const a = createSimState(FIVE_PIN, 77, PERFECT_CONFIG)
    const b = createSimState(FIVE_PIN, 77, PERFECT_CONFIG)
    expect(a.chambers.map((c) => c.delta)).toEqual(b.chambers.map((c) => c.delta))
  })
})

describe('chamber geometry — SIMULATION.md §1', () => {
  it('derives setLift, the capture window and the rest positions', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    const c = s.chambers[0]
    expect(c).toBeDefined()
    if (!c) return
    expect(c.setLift).toBeCloseTo(-(KEYWAY_FLOOR + c.keyPinLength), 12)
    expect(c.setLift).toBeCloseTo(5.0 - c.keyPinLength, 12)
    // Scaled by this *copy's* condition (D-072): the catalogue number describes the model, and
    // the instance is one particular cylinder off the shelf — worn a shade wide, or stiff and new.
    expect(c.captureWindow).toBeCloseTo(
      0.62 * THREE_PIN.toleranceQuality * s.instance.condition,
      12,
    )
    expect(Math.abs(s.instance.condition - 1)).toBeLessThanOrEqual(CONDITION_SPREAD + 1e-12)

    expect(keyPinBottom(c)).toBeCloseTo(KEYWAY_FLOOR, 12)
    expect(keyPinTop(c)).toBeCloseTo(KEYWAY_FLOOR + c.keyPinLength, 12)
    expect(driverPinTop(c)).toBeCloseTo(KEYWAY_FLOOR + c.keyPinLength + DRIVER_LENGTH, 12)
    // At rest the stack straddles the shear line.
    expect(keyPinTop(c)).toBeLessThan(0)
    expect(driverPinTop(c)).toBeGreaterThan(0)
  })

  it('boundary offset s is zero exactly at setLift', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    const c = s.chambers[1]
    expect(c).toBeDefined()
    if (!c) return
    expect(boundaryOffset(c)).toBeCloseTo(-c.setLift, 12)
    c.lift = c.setLift
    expect(boundaryOffset(c)).toBeCloseTo(0, 12)
    expect(keyPinTop(c)).toBeCloseTo(0, 12)
  })
})

describe('driver profiles — SIMULATION.md §3', () => {
  it('every profile sums to the driver length', () => {
    for (const p of Object.values(PROFILES)) {
      const total = p.bands.reduce((sum, b) => sum + b.length, 0)
      expect(total, `${p.name} band total`).toBeCloseTo(DRIVER_LENGTH, 9)
    }
  })

  it('the standard pin has no grooves and every security pin has at least one', () => {
    expect(PROFILES.standard.grooveCount).toBe(0)
    expect(minimumSetLift(PROFILES.standard)).toBe(0)
    for (const name of ['spool', 'serrated', 'mushroom', 't-pin', 'wafer'] as const) {
      expect(PROFILES[name].grooveCount, name).toBeGreaterThan(0)
      expect(minimumSetLift(PROFILES[name]), name).toBeGreaterThan(0)
    }
  })

  it('a serrated pin has exactly four grooves', () => {
    expect(PROFILES.serrated.grooveCount).toBe(4)
  })

  it('mushrooms have the harshest bevel and t-pins the deepest cut', () => {
    const taper = (n: keyof typeof PROFILES): number =>
      Math.max(...PROFILES[n].bands.map((b) => b.taper))
    expect(taper('mushroom')).toBeGreaterThan(taper('spool'))
    expect(taper('spool')).toBeGreaterThan(taper('t-pin'))
    expect(PROFILES['t-pin'].maxGrooveDepth).toBeGreaterThan(PROFILES.spool.maxGrooveDepth)
    expect(PROFILES.spool.maxGrooveDepth).toBeGreaterThan(PROFILES.serrated.maxGrooveDepth)
  })

  it('every groove sits inside the reachable band of a realistic bitting', () => {
    // A driver's features only matter below depth `setLift`, and setLift maxes out around
    // 2.8mm for a sane key pin. Grooves above that would be dead geometry.
    for (const name of ['spool', 'serrated', 'mushroom', 't-pin'] as const) {
      expect(minimumSetLift(PROFILES[name]), name).toBeLessThan(2.6)
    }
  })
})
