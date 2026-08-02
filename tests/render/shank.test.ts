/**
 * The drawn shaft and the height pins are held at are the same line — DECISIONS D-149.
 *
 * The simulation holds a pin in front of the hook on the pick's shaft (D-145), and the renderer
 * draws that shaft as a rigid straight tool (D-141). Those are two descriptions of one piece of
 * steel, and they were written independently: the physics used `(lift - HOOK_RISE) × xᵢ/x_pick` and
 * the drawing set the tool's angle from the *crest* and hung the shaft below it. They agree only at
 * the chamber being worked. Everywhere else the simulation's line runs higher, so a pin was held
 * above the steel that is supposed to be under it — reported from play as *"it correctly lifts the
 * nearest pin, but for the rest there is air between the lockpick and the pin"*, and the gap grew
 * with distance from the hook, which is exactly the shape of the disagreement.
 *
 * So this measures the shaft the renderer **actually draws** and asserts it lands where `shankLift`
 * says a pin will rest. Neither side can move without the other.
 */

import { describe, expect, it } from 'vitest'
import { KEYWAY_FLOOR, shankLift } from '../../src/sim'
import { computeLayout, mmToY, plugChamberX, yToMm } from '../../src/render/layout'
import { STEEL_KNEE_MM, hookGeometry, pickAngle } from '../../src/render/pick'

const LAYOUT = computeLayout(5, 0)

/**
 * Where the top edge of the drawn shaft is at a chamber, in mm of lift above the keyway floor.
 *
 * Taken from the rendered knee and the rendered angle — the tool is straight, so the shaft is that
 * point and that slope — then raised by the steel's half-thickness, because a pin rests on the top
 * of the bar rather than on its centreline.
 */
function drawnShaftAt(pick: number, index: number, liftMm: number): number {
  const tipX = plugChamberX(LAYOUT, pick)
  const tipY = mmToY(LAYOUT, KEYWAY_FLOOR + liftMm)
  const theta = pickAngle(LAYOUT, tipX, tipY)
  const { knee } = hookGeometry(LAYOUT, tipX, tipY, 1)
  const x = plugChamberX(LAYOUT, index)
  const centreY = knee.y + (knee.x - x) * Math.tan(theta)
  const topY = centreY - STEEL_KNEE_MM * LAYOUT.mmToPx
  return yToMm(LAYOUT, topY) - KEYWAY_FLOOR
}

describe('the picture and the physics agree about where the shaft is', () => {
  for (const pick of [2, 3, 4]) {
    for (const lift of [2.6, 3.0, 3.4]) {
      it(`chamber ${pick} at ${lift}mm holds the pins in front of it on the drawn steel`, () => {
        for (let i = 0; i < pick; i += 1) {
          const physics = shankLift(lift, pick, i)
          const drawn = drawnShaftAt(pick, i, lift)
          if (physics <= 0) continue
          expect(
            physics,
            `chamber ${i}: the pin is held ${(physics - drawn).toFixed(2)}mm off the steel`,
          ).toBeCloseTo(drawn, 1)
        }
      })
    }
  }

  it('touches nothing below the hook s own rise, at any distance', () => {
    // Below that the knee is still down in the keyway, so there is no shaft above the floor to rest
    // on — which is what keeps this a cost of overlifting and not of ordinary play.
    for (const lift of [0.8, 1.5, 1.8]) {
      for (let i = 0; i < 4; i += 1) {
        expect(shankLift(lift, 4, i), `${lift}mm at chamber ${i}`).toBe(0)
      }
    }
  })

  it('falls away toward the mouth, so the neighbour takes the most', () => {
    const lift = 3.4
    for (let i = 1; i < 4; i += 1) {
      expect(shankLift(lift, 4, i), `chamber ${i}`).toBeGreaterThanOrEqual(shankLift(lift, 4, i - 1))
    }
  })
})
