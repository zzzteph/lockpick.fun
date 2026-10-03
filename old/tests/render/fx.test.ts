import { describe, expect, it } from 'vitest'
import {
  CAMERA_DRIFT_PX,
  DROP_SECONDS,
  DROP_STAGGER_SECONDS,
  FLASH_SECONDS,
  FLEX_MAX,
  JOLT_SECONDS,
  SHAKE_SECONDS,
  cameraDrift,
  chamberOffsetY,
  clearFx,
  createFx,
  falseSetPulse,
  flashAmount,
  pickFlex,
  pushFxEvent,
  resizeFx,
  shakeOffset,
  updateFx,
} from '../../src/render/fx'
import { driverFill } from '../../src/render/cutaway'
import { DRAFTING } from '../../src/render/palette'
import { THETA_OPEN, createSimState, type SimEvent } from '../../src/sim'
import { PERFECT_CONFIG, THREE_PIN } from '../sim/fixtures'

const setEvent = (chamber: number): SimEvent => ({
  type: 'PIN_SET',
  chamber,
  tension: 0.5,
  time: 0,
})
const oversetEvent = (chamber: number): SimEvent => ({ type: 'PIN_OVERSET', chamber, time: 0 })
const falseSetEvent = (chamber: number): SimEvent => ({
  type: 'FALSE_SET_ENTERED',
  chamber,
  depth: 0.3,
  time: 0,
})
const resetEvent = (): SimEvent => ({ type: 'RESET', kind: 'full', dropped: [0, 1], time: 0 })

describe('set feedback — GAME_DESIGN.md §8', () => {
  it('fires flash and shake on the same frame the pin sets', () => {
    const fx = createFx(3)
    pushFxEvent(fx, setEvent(1))
    expect(flashAmount(fx, 1)).toBe(1)
    expect(fx.shake).toBe(1)
    expect(flashAmount(fx, 0)).toBe(0)
  })

  it('lands every channel inside 100ms', () => {
    // The colour change and the flash are instantaneous; the shake is over in 40ms and the
    // flash has eased most of the way to the state hue by 100ms.
    const fx = createFx(3)
    pushFxEvent(fx, setEvent(0))
    const atSet = flashAmount(fx, 0)
    updateFx(fx, 0.1)
    expect(atSet).toBe(1)
    expect(fx.shake).toBe(0)
    expect(flashAmount(fx, 0)).toBeLessThan(0.5)
    expect(flashAmount(fx, 0)).toBeGreaterThan(0)
  })

  it('decays the flash over exactly FLASH_SECONDS', () => {
    const fx = createFx(1)
    pushFxEvent(fx, setEvent(0))
    updateFx(fx, FLASH_SECONDS / 2)
    expect(flashAmount(fx, 0)).toBeCloseTo(0.5, 6)
    updateFx(fx, FLASH_SECONDS / 2)
    expect(flashAmount(fx, 0)).toBe(0)
    updateFx(fx, 1)
    expect(flashAmount(fx, 0)).toBe(0)
  })

  it('shakes for 40ms and no longer', () => {
    const fx = createFx(1)
    pushFxEvent(fx, setEvent(0))
    updateFx(fx, SHAKE_SECONDS * 0.5)
    const mid = shakeOffset(fx)
    expect(Math.hypot(mid.x, mid.y)).toBeGreaterThan(0)
    updateFx(fx, SHAKE_SECONDS * 0.6)
    expect(fx.shake).toBe(0)
    expect(shakeOffset(fx)).toEqual({ x: 0, y: 0 })
  })

  it('turns the driver white on the set frame and settles to teal', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    const c = s.chambers[0]
    if (!c) throw new Error('missing chamber')
    c.state = 'SET'
    const fx = createFx(3)
    const settled = driverFill(DRAFTING, c, fx).toLowerCase()
    expect(settled).toBe(DRAFTING.teal.toLowerCase())

    pushFxEvent(fx, setEvent(0))
    const flashed = driverFill(DRAFTING, c, fx).toLowerCase()
    expect(flashed).not.toBe(settled)
    expect(flashed).toBe(DRAFTING.highlight.toLowerCase())

    updateFx(fx, FLASH_SECONDS)
    expect(driverFill(DRAFTING, c, fx).toLowerCase()).toBe(settled)
  })
})

describe('overset feedback — ART_DIRECTION.md §5', () => {
  it('jolts the chamber vertically for 90ms and only that chamber', () => {
    const fx = createFx(3)
    pushFxEvent(fx, oversetEvent(2))
    updateFx(fx, JOLT_SECONDS * 0.3)
    expect(Math.abs(chamberOffsetY(fx, 2))).toBeGreaterThan(0.5)
    expect(chamberOffsetY(fx, 0)).toBe(0)
    updateFx(fx, JOLT_SECONDS)
    expect(chamberOffsetY(fx, 2)).toBe(0)
  })

  it('does not flash or shake — an overset is not a reward', () => {
    const fx = createFx(3)
    pushFxEvent(fx, oversetEvent(1))
    expect(flashAmount(fx, 1)).toBe(0)
    expect(fx.shake).toBe(0)
  })
})

describe('false set and reset', () => {
  it('pulses on entering a false set', () => {
    const fx = createFx(3)
    pushFxEvent(fx, falseSetEvent(2))
    expect(falseSetPulse(fx, 2)).toBe(1)
    updateFx(fx, 0.5)
    expect(falseSetPulse(fx, 2)).toBe(0)
  })

  it('cascades the reset drop, staggered per chamber', () => {
    const fx = createFx(4)
    pushFxEvent(fx, resetEvent())
    // Chamber 0 starts immediately; later chambers wait their turn.
    expect(fx.chambers[0]?.dropDelay).toBe(0)
    expect(fx.chambers[3]?.dropDelay).toBeCloseTo(3 * DROP_STAGGER_SECONDS, 9)

    updateFx(fx, DROP_STAGGER_SECONDS * 0.5)
    expect(fx.chambers[0]?.drop).toBeLessThan(1)
    expect(fx.chambers[3]?.drop).toBe(1)

    updateFx(fx, DROP_SECONDS + DROP_STAGGER_SECONDS * 4)
    for (const c of fx.chambers) expect(c.drop).toBe(0)
    for (let i = 0; i < 4; i += 1) expect(chamberOffsetY(fx, i)).toBe(0)
  })

  it('returns every positional offset to exactly zero', () => {
    // The render layer may borrow the pins for a flourish, but it always gives them back —
    // otherwise the "rendered positions match sim state" guarantee would rot.
    const fx = createFx(3)
    pushFxEvent(fx, resetEvent())
    pushFxEvent(fx, oversetEvent(1))
    for (let i = 0; i < 200; i += 1) updateFx(fx, 1 / 120)
    for (let i = 0; i < 3; i += 1) expect(chamberOffsetY(fx, i)).toBe(0)
    expect(shakeOffset(fx)).toEqual({ x: 0, y: 0 })
  })
})

describe('reduced motion — ART_DIRECTION.md §5', () => {
  it('removes every shake, jolt and bounce', () => {
    const fx = createFx(3, true)
    pushFxEvent(fx, setEvent(0))
    pushFxEvent(fx, oversetEvent(1))
    pushFxEvent(fx, resetEvent())
    updateFx(fx, 1 / 120)
    expect(fx.shake).toBe(0)
    expect(shakeOffset(fx)).toEqual({ x: 0, y: 0 })
    for (let i = 0; i < 3; i += 1) expect(chamberOffsetY(fx, i)).toBe(0)
    expect(cameraDrift({ theta: THETA_OPEN } as never, THETA_OPEN, true)).toBe(0)
  })

  it('keeps state legible: the colour still changes without any animation', () => {
    const s = createSimState(THREE_PIN, 1, PERFECT_CONFIG)
    const c = s.chambers[0]
    if (!c) throw new Error('missing chamber')
    const fx = createFx(3, true)
    pushFxEvent(fx, setEvent(0))
    updateFx(fx, 1 / 120)
    c.state = 'BINDING'
    const binding = driverFill(DRAFTING, c, fx)
    c.state = 'SET'
    const set = driverFill(DRAFTING, c, fx)
    c.state = 'OVERSET'
    const overset = driverFill(DRAFTING, c, fx)
    expect(new Set([binding, set, overset]).size).toBe(3)
    expect(set.toLowerCase()).toBe(DRAFTING.teal.toLowerCase())
  })
})

describe('camera micro-motion', () => {
  it('drifts a few pixels in proportion to plug rotation', () => {
    expect(cameraDrift({ theta: 0 } as never, THETA_OPEN, false)).toBe(0)
    expect(cameraDrift({ theta: THETA_OPEN } as never, THETA_OPEN, false)).toBeCloseTo(
      CAMERA_DRIFT_PX,
      9,
    )
    expect(cameraDrift({ theta: THETA_OPEN / 2 } as never, THETA_OPEN, false)).toBeCloseTo(
      CAMERA_DRIFT_PX / 2,
      9,
    )
    // Never runs away, however far the plug is asked to go.
    expect(cameraDrift({ theta: 99 } as never, THETA_OPEN, false)).toBeCloseTo(CAMERA_DRIFT_PX, 9)
  })
})

describe('pick flex — the continuous force channel', () => {
  it('is strictly monotonic in resistance', () => {
    let previous = -1
    for (let r = 0; r <= 1.0001; r += 0.02) {
      const f = pickFlex(r, 0)
      expect(f).toBeGreaterThan(previous)
      previous = f
    }
  })

  it('is zero only when the pin offers nothing and lags by nothing', () => {
    expect(pickFlex(0, 0)).toBe(0)
    expect(pickFlex(0.05, 0)).toBeGreaterThan(0)
    expect(pickFlex(0, 0.05)).toBeGreaterThan(0)
  })

  it('separates a binding pin from a free one by a visible amount', () => {
    // §8: free ≈ 0.10, binding ≈ 0.55 + 0.45T. Those must not look the same.
    const free = pickFlex(0.1, 0)
    const binding = pickFlex(0.55 + 0.45 * 0.5, 0)
    expect(binding - free).toBeGreaterThan(8)
  })

  it('adds the lag between where the tip is and where it was asked to be', () => {
    // This is counter-rotation made visible: the pin is being shoved down, the shaft bows.
    expect(pickFlex(0.5, 0.3)).toBeGreaterThan(pickFlex(0.5, 0))
    expect(pickFlex(0.5, -1)).toBe(pickFlex(0.5, 0))
  })

  it('saturates rather than bending the pick through the lock', () => {
    expect(pickFlex(1, 10)).toBe(FLEX_MAX)
    expect(pickFlex(1, 1000)).toBe(FLEX_MAX)
  })
})

describe('fx lifecycle', () => {
  it('resizes to the chamber count, keeping existing entries', () => {
    const fx = createFx(2)
    pushFxEvent(fx, setEvent(0))
    resizeFx(fx, 5)
    expect(fx.chambers).toHaveLength(5)
    expect(flashAmount(fx, 0)).toBe(1)
    expect(flashAmount(fx, 4)).toBe(0)
    resizeFx(fx, 1)
    expect(fx.chambers).toHaveLength(1)
  })

  it('clears everything on demand', () => {
    const fx = createFx(3)
    pushFxEvent(fx, setEvent(0))
    pushFxEvent(fx, oversetEvent(1))
    clearFx(fx)
    expect(fx.shake).toBe(0)
    for (let i = 0; i < 3; i += 1) {
      expect(flashAmount(fx, i)).toBe(0)
      expect(chamberOffsetY(fx, i)).toBe(0)
    }
  })

  it('ignores events for chambers that do not exist', () => {
    const fx = createFx(2)
    expect(() => {
      pushFxEvent(fx, setEvent(9))
      pushFxEvent(fx, oversetEvent(9))
      pushFxEvent(fx, falseSetEvent(9))
      pushFxEvent(fx, { type: 'PLUG_MOVED', theta: 0.1, velocity: 1, time: 0 })
    }).not.toThrow()
    expect(flashAmount(fx, 9)).toBe(0)
    expect(chamberOffsetY(fx, 9)).toBe(0)
  })
})
