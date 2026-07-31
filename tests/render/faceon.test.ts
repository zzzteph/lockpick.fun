/**
 * Face-on geometry — `src/render/faceon.ts`.
 *
 * The drawing itself is checked by the Playwright screenshots; what is checked here is the
 * part the player's hand depends on, which is that the two mappings are inverses. If the
 * pointer says one thing and the tool is drawn somewhere else, the lock is unpickable in a way
 * no assertion about pixels would catch.
 */

import { describe, expect, it } from 'vitest'
import { createSimState, DISC_TRAVEL } from '../../src/sim'
import {
  angleDelta,
  bearingAt,
  chamberAtPointer,
  computeFaceLayout,
  discAngle,
  faceKindFor,
  liftForAngle,
  pinAngle,
  ringRadii,
  toolTip,
  valueAtPointer,
} from '../../src/render/faceon'
import { PERFECT_CONFIG, makeLock } from '../sim/fixtures'

/**
 * Six discs — the lock that used to be #25, from a fixture since D-104 cut the family.
 *
 * The face-on view is the only renderer in the game with no roster lock behind it now. That is
 * precisely why these assertions matter more than they did: the pointer-to-chamber and
 * pointer-to-value mappings are the part a player's hand depends on, and nothing else would
 * notice if they drifted.
 */
const DISC_FIXTURE = makeLock({
  slug: 'fixture-disc-6',
  name: 'Fixture disc detainer 6',
  bitting: [3, 3, 3, 3, 3, 3],
  pins: ['standard', 'standard', 'standard', 'standard', 'standard', 'standard'],
  family: 'disc-detainer',
  discs: {
    trueGates: [0.6, 1.9, 1.1, 2.4, 0.9, 1.6],
    falseGates: [[1.6], [0.8], [2.1], [1.2], [2.0], [0.5]],
    gateWidth: 0.18,
  },
  toleranceQuality: 0.65,
  par: 200,
})

describe('faceKindFor', () => {
  it('claims exactly the two families that have no side view', () => {
    expect(faceKindFor('disc-detainer')).toBe('disc-detainer')
    expect(faceKindFor('tubular')).toBe('tubular')
    expect(faceKindFor('pin-tumbler')).toBeNull()
    expect(faceKindFor('dimple')).toBeNull()
    expect(faceKindFor('wafer')).toBeNull()
  })
})

describe('angleDelta', () => {
  it('wraps to the short way round', () => {
    expect(angleDelta(0.1, 0.2)).toBeCloseTo(-0.1, 9)
    expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(0.2, 9)
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(-0.2, 9)
  })
})

describe('the disc detainer face', () => {
  const s = createSimState(DISC_FIXTURE, 3, PERFECT_CONFIG)
  const layout = computeFaceLayout(s.chambers.length, 'disc-detainer', 0)

  it('gives every disc a ring, outermost first, with no overlap', () => {
    let previousInner = Infinity
    for (const c of s.chambers) {
      const { inner, outer } = ringRadii(layout, c.index)
      expect(outer).toBeGreaterThan(inner)
      expect(outer).toBeLessThanOrEqual(previousInner + 1e-6)
      previousInner = inner
    }
    expect(previousInner).toBeGreaterThanOrEqual(layout.rInner - 1e-6)
  })

  it('turns an angle back into the lift that produced it', () => {
    const c = s.chambers[2]
    if (!c) throw new Error('no disc')
    for (const lift of [0, 0.4, 1.1, 2.4, DISC_TRAVEL - 0.01]) {
      const back = liftForAngle(c, discAngle(c, lift, 0), 0)
      expect(back).toBeCloseTo(lift, 6)
    }
  })

  it('keeps that true while the plug is part-turned', () => {
    const c = s.chambers[1]
    if (!c) throw new Error('no disc')
    for (const theta of [0, 0.12, 0.4]) {
      expect(liftForAngle(c, discAngle(c, 1.7, theta), theta)).toBeCloseTo(1.7, 6)
    }
  })

  it('picks the disc under the pointer, by how far out it is', () => {
    for (const c of s.chambers) {
      const { inner, outer } = ringRadii(layout, c.index)
      const r = (inner + outer) / 2
      // Sample all the way round: which disc you have hold of must not depend on bearing.
      for (const a of [0, 1, 2, 3, 4, 5]) {
        const x = layout.cx + Math.cos(a) * r
        const y = layout.cy + Math.sin(a) * r
        expect(chamberAtPointer(layout, x, y), `disc ${c.index} at ${a}rad`).toBe(c.index)
      }
    }
  })

  it('reads nothing at all outside the stack', () => {
    expect(chamberAtPointer(layout, layout.cx, layout.cy)).toBe(-1)
    expect(chamberAtPointer(layout, layout.cx + layout.rOuter + 40, layout.cy)).toBe(-1)
  })

  it('asks for the angle the pointer is actually at', () => {
    const c = s.chambers[0]
    if (!c) throw new Error('no disc')
    const { inner, outer } = ringRadii(layout, c.index)
    const r = (inner + outer) / 2
    for (const want of [0.3, 1.5, 2.7]) {
      const a = discAngle(c, want, 0)
      const x = layout.cx + Math.cos(a) * r
      const y = layout.cy + Math.sin(a) * r
      expect(valueAtPointer(layout, c, x, y)).toBeCloseTo(want, 5)
    }
  })

  it('draws the tool where the pointer asked for it', () => {
    const c = s.chambers[3]
    if (!c) throw new Error('no disc')
    const tip = toolTip(layout, c, 2.1)
    expect(chamberAtPointer(layout, tip.x, tip.y)).toBe(3)
    expect(valueAtPointer(layout, c, tip.x, tip.y)).toBeCloseTo(2.1, 5)
  })
})

/**
 * Tubular locks left the *roster* with D-088, not the *renderer* — `faceKindFor` still claims them
 * and the face-on view still draws them, so the layout maths is still tested. From a fixture now,
 * which is where a test of a capability rather than of a catalogue always belonged.
 */
describe('the tubular face', () => {
  const s = createSimState(
    makeLock({
      slug: 'fixture-tubular-7',
      bitting: [3.0, 3.4, 2.8, 3.2, 3.6, 2.9, 3.1],
      pins: ['standard', 'standard', 'standard', 'standard', 'standard', 'standard', 'standard'],
      family: 'tubular',
      toleranceQuality: 1.0,
    }),
    3,
    PERFECT_CONFIG,
  )
  const layout = computeFaceLayout(s.chambers.length, 'tubular', 0)

  it('spaces the pins evenly round the circle, pin 1 at the top', () => {
    expect(pinAngle(layout, 0)).toBeCloseTo(-Math.PI / 2, 9)
    for (let i = 1; i < layout.count; i += 1) {
      const gap = angleDelta(pinAngle(layout, i), pinAngle(layout, i - 1))
      expect(gap).toBeCloseTo((Math.PI * 2) / layout.count, 9)
    }
  })

  it('picks the pin the pointer is pointing at', () => {
    for (const c of s.chambers) {
      const a = pinAngle(layout, c.index)
      const r = (layout.rInner + layout.rOuter) / 2
      expect(chamberAtPointer(layout, layout.cx + Math.cos(a) * r, layout.cy + Math.sin(a) * r)).toBe(
        c.index,
      )
    }
  })

  it('turns the ring of pins with the plug, so the same pin stays under the pointer', () => {
    const turned = computeFaceLayout(s.chambers.length, 'tubular', 0.3)
    const a = pinAngle(turned, 4)
    const r = (turned.rInner + turned.rOuter) / 2
    expect(chamberAtPointer(turned, turned.cx + Math.cos(a) * r, turned.cy + Math.sin(a) * r)).toBe(4)
    expect(bearingAt(turned, turned.cx + Math.cos(a) * r, turned.cy + Math.sin(a) * r)).toBeCloseTo(
      Math.atan2(Math.sin(a), Math.cos(a)),
      9,
    )
  })

  it('pushes the pin in as the pointer moves toward the middle', () => {
    const c = s.chambers[0]
    if (!c) throw new Error('no pin')
    const a = pinAngle(layout, 0)
    const at = (r: number): number =>
      valueAtPointer(layout, c, layout.cx + Math.cos(a) * r, layout.cy + Math.sin(a) * r)
    expect(at(layout.rOuter)).toBeCloseTo(0, 6)
    expect(at(layout.rInner)).toBeCloseTo(c.maxLift, 5)
    expect(at((layout.rInner + layout.rOuter) / 2)).toBeGreaterThan(at(layout.rOuter))
    // Never negative, however far outside the rim the pointer wanders.
    expect(at(layout.rOuter + 80)).toBe(0)
  })

  it('draws the tool where the pointer asked for it', () => {
    const c = s.chambers[5]
    if (!c) throw new Error('no pin')
    const tip = toolTip(layout, c, 1.6)
    expect(chamberAtPointer(layout, tip.x, tip.y)).toBe(5)
    expect(valueAtPointer(layout, c, tip.x, tip.y)).toBeCloseTo(1.6, 5)
  })
})
