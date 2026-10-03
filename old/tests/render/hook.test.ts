/**
 * The pick is a rigid tool — DECISIONS D-140, D-141.
 *
 * A pick is a ground strip of steel. It travels, and it turns about the hand that holds it. It does
 * not grow, and it does not bend into a different shape at every height. Two versions of the redraw
 * did both: the hook stretched once the crest stopped tracking the tip (D-140), and the shaft stayed
 * a curve with one end pinned to the lock, so it took a new shape at every lift (D-141). Reported as
 * *"the lockpick itself BENDS, and its hook becomes bigger or smaller"*.
 *
 * Nothing in the suite could see either, because the whole failure was a picture. So the placement
 * is a rigid transform now, and these assert the property that makes it one: **every distance within
 * the tool is the same at every height, in every lock**. That is a stronger claim than checking a
 * handful of dimensions, and it is the definition of not-deforming.
 */

import { describe, expect, it } from 'vitest'
import { KEYWAY_FLOOR } from '../../src/sim'
import { CHAMBER_PITCH_MM, computeLayout, mmToY, KEYWAY_BOTTOM_MM } from '../../src/render/layout'
import {
  HOOK_REACH_MM,
  HOOK_RISE_MM,
  STEEL_HANDLE_MM,
  hookGeometry,
  pickAngle,
  type HookGeometry,

} from '../../src/render/pick'

const TIP_X = 900
const PARTS = ['knee', 'flatStart', 'crest', 'point'] as const

const tipYFor = (layout: ReturnType<typeof computeLayout>, liftMm: number): number =>
  mmToY(layout, KEYWAY_FLOOR + liftMm)

/** Every pairwise distance within the tool — the thing a rigid transform must preserve. */
function spans(g: HookGeometry): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = 0; i < PARTS.length; i += 1) {
    for (let j = i + 1; j < PARTS.length; j += 1) {
      const a = g[PARTS[i]!]
      const b = g[PARTS[j]!]
      out[`${PARTS[i]}-${PARTS[j]}`] = Math.hypot(b.x - a.x, b.y - a.y)
    }
  }
  return out
}

const LIFTS = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2, 4.0]

describe('the pick keeps its shape at every lift', () => {
  for (const pins of [5, 8, 12]) {
    it(`is one rigid tool through the whole range — ${pins}-pin lock`, () => {
      const layout = computeLayout(pins, 0)
      const first = spans(hookGeometry(layout, TIP_X, tipYFor(layout, LIFTS[0]!), 1))
      for (const lift of LIFTS) {
        const at = spans(hookGeometry(layout, TIP_X, tipYFor(layout, lift), 1))
        for (const span of Object.keys(first)) {
          expect(at[span], `${span} at ${lift}mm`).toBeCloseTo(first[span]!, 6)
        }
      }
    })
  }

  it('never stretches — the old bug, stated as a number', () => {
    /*
     * The D-140 regression. Against the construction it replaced, the throat grew 50.6px across
     * this range. Half a pixel of spread is far tighter than that and far looser than the truth,
     * which is zero, so this fails loudly on the bug and cannot fail on rounding.
     */
    const layout = computeLayout(5, 0)
    const throats = LIFTS.map(
      (l) => spans(hookGeometry(layout, TIP_X, tipYFor(layout, l), 1))['knee-flatStart']!,
    )
    const spread = Math.max(...throats) - Math.min(...throats)
    expect(spread, `throat varied by ${spread.toFixed(2)}px`).toBeLessThan(0.5)
  })

  it('the point lands in the middle of the pin, and the flat right behind it', () => {
    // The tool is aimed by its point (D-142). The crest used to sit on the chamber centre, which
    // put the ground point half a millimetre past it and the whole bearing flat off to one side.
    const layout = computeLayout(5, 0)
    for (const lift of LIFTS) {
      const g = hookGeometry(layout, TIP_X, tipYFor(layout, lift), 1)
      expect(g.point.x, `${lift}mm`).toBeCloseTo(TIP_X, 9)
      expect(g.point.y, `${lift}mm`).toBeCloseTo(tipYFor(layout, lift), 9)
      // The flat carries the pin, so it has to run under it rather than beside it. Its far end may
      // reach past the pin — a hook's flat is longer than a pin is wide — but the crest may not.
      expect(Math.abs(g.crest.x - TIP_X), `crest at ${lift}mm`).toBeLessThan(layout.keyPinWidth / 2)
    }
  })
})

describe('the tool changes angle instead', () => {
  const layout = computeLayout(5, 0)

  it('lies flat in the keyway at rest', () => {
    expect(pickAngle(layout, TIP_X, tipYFor(layout, 0))).toBeCloseTo(0, 9)
  })

  it('tilts further the higher the pin is lifted', () => {
    const angles = LIFTS.map((l) => pickAngle(layout, TIP_X, tipYFor(layout, l)))
    for (let i = 1; i < angles.length; i += 1) {
      expect(angles[i]!, `${LIFTS[i]}mm vs ${LIFTS[i - 1]}mm`).toBeGreaterThan(angles[i - 1]!)
    }
  })

  it('stays a believable angle rather than a thrown lever', () => {
    // Pivoting at the lock face needed 36-52deg to reach the front chamber. A hand's reach outside
    // the lock is what keeps a real pick within a few degrees, and that lever is why.
    const steepest = pickAngle(layout, TIP_X, tipYFor(layout, 4.0))
    expect((steepest * 180) / Math.PI).toBeLessThan(16)
  })

  it('tilts less for a chamber further into the lock, as a longer lever must', () => {
    const y = tipYFor(layout, 2.0)
    expect(pickAngle(layout, 1400, y)).toBeLessThan(pickAngle(layout, 700, y))
  })
})

describe('the tool is drawn at the scale of the lock around it', () => {
  it('matches the lock however squeezed it is', () => {
    /*
     * `computeLayout` fits long locks to the frame by shrinking the pitch — a 12-pin cylinder draws
     * at 0.46 scale horizontally. The hook was fixed at the *vertical* scale, so it came out 0.87x
     * the pin width on a 5-pin lock and 1.9x on a 12-pin one. Reported as "for every lock, the hooks
     * should be the same": the same absolute size was exactly the bug (D-141).
     */
    for (const pins of [5, 8, 12]) {
      const layout = computeLayout(pins, 0)
      const g = hookGeometry(layout, TIP_X, tipYFor(layout, 0), 1)
      const reach = Math.abs(g.point.x - g.knee.x)
      expect(reach / layout.pitch, `${pins}-pin`).toBeCloseTo(HOOK_REACH_MM / CHAMBER_PITCH_MM, 6)
    }
  })

  it('fits inside one chamber pitch, so a hook can never bridge two pins', () => {
    for (const pins of [5, 8, 12]) {
      const layout = computeLayout(pins, 0)
      const g = hookGeometry(layout, TIP_X, tipYFor(layout, 0), 1)
      expect(Math.abs(g.point.x - g.knee.x), `${pins}-pin`).toBeLessThan(layout.pitch)
    }
  })
})

describe('the hook is built to real dimensions', () => {
  const layout = computeLayout(5, 0)

  it('fits inside the keyway at rest, with the slot to spare', () => {
    // Two independent measurements that have to be compatible: a hook taller than the slot could
    // not be in the lock at all, and the tool must have somewhere to lie when no pin is lifted.
    expect(HOOK_RISE_MM, 'a hook taller than the keyway could not enter it').toBeLessThan(
      KEYWAY_FLOOR - KEYWAY_BOTTOM_MM,
    )
    const g = hookGeometry(layout, TIP_X, tipYFor(layout, 0), 1)
    expect(g.knee.y, 'at rest the knee lies inside the keyway').toBeLessThan(
      mmToY(layout, KEYWAY_BOTTOM_MM),
    )
    expect(g.knee.y, 'and below the pins').toBeGreaterThan(mmToY(layout, KEYWAY_FLOOR))
  })

  it('fits the slot including its own steel, not just its centreline', () => {
    /*
     * The thing that pulled `HOOK_RISE_MM` back from 2.6mm once the pick was given a real thickness
     * (D-142). `knee` is a centreline: the shaft's *bottom edge* is a further half-thickness below,
     * and the handle is the thickest part of the tool. A pick whose spine is through the floor of
     * the keyway is not in the lock.
     */
    const g = hookGeometry(layout, TIP_X, tipYFor(layout, 0), 1)
    const bottomEdge = g.knee.y + STEEL_HANDLE_MM * layout.mmToPx
    expect(bottomEdge, 'the spine of the tool is through the keyway floor').toBeLessThan(
      mmToY(layout, KEYWAY_BOTTOM_MM),
    )
  })

  it('keeps the knee down in the keyway across every lift the roster asks for', () => {
    // Roster lifts run 0.80mm to 2.30mm. Beyond that the throat starts to enter the bore, which is
    // what a real pick does when you lift a pin further than its own hook is tall.
    for (const lift of [0.8, 1.5, 2.3]) {
      const g = hookGeometry(layout, TIP_X, tipYFor(layout, lift), 1)
      expect(g.knee.y, `${lift}mm`).toBeGreaterThanOrEqual(mmToY(layout, KEYWAY_FLOOR) - 1e-6)
    }
  })

  it('mirrors cleanly for a left-handed lock', () => {
    // The same tool, drawn the other way round: every distance within it is identical.
    const y = tipYFor(layout, 1.6)
    expect(spans(hookGeometry(layout, TIP_X, y, -1))).toEqual(spans(hookGeometry(layout, TIP_X, y, 1)))
    // The point is aimed at the chamber either way, so the tell is which side the shaft runs off to.
    expect(hookGeometry(layout, TIP_X, y, -1).knee.x, 'the shaft trails the other way').toBeGreaterThan(
      TIP_X,
    )
    expect(hookGeometry(layout, TIP_X, y, 1).knee.x).toBeLessThan(TIP_X)
  })
})
