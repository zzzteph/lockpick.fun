/**
 * PHYSLAB view — the drawing is the physics.
 *
 * The teardown's whole claim is that the pick you see bearing on a pin is the pick the model
 * contacted it with: `view.ts` builds the tool's milled edge out of `toolHeightAt`, the very
 * function `toolSurfaceUnder` asks what is beneath a chamber. That is the sort of claim a picture
 * cannot keep on its own — the last two tools in this project's history were rejected precisely
 * because the drawing and the mechanism had drifted apart — so it is asserted here instead.
 *
 * Nothing in here opens a canvas. `toolOutline` is pure millimetres, which is the point of having
 * split it out of `drawTool`.
 */

import { describe, expect, it } from 'vitest'

import {
  createLab,
  FLOOR_Y,
  handX,
  KEYWAY_BOTTOM,
  step,
  TOOTH_HALF,
  makeHook,
  makeRake,
  toolHeightAt,
  type Tool,
} from '../../src/physlab/model'
import { toolOutline } from '../../src/physlab/tool'

/** A tool posed the way a hand holds it: tip at `x`, shaft at `lift`. */
function posed(tool: Tool, x: number, lift: number): Tool {
  tool.x = x
  tool.lift = lift
  return tool
}

const POSES: readonly (readonly [string, Tool])[] = [
  ['hook at the mouth', posed(makeHook(), 0, FLOOR_Y - 2.4)],
  ['hook deep and lifted', posed(makeHook(), 12.6, FLOOR_Y - 0.6)],
  ['rake mid-scrub', posed(makeRake(), 8.4, FLOOR_Y - 1.9)],
  ['rake driven high', posed(makeRake(), 16.8, FLOOR_Y + 0.4)],
]

describe('the tool outline is the contact surface', () => {
  it('puts every vertex of the milled edge on `toolHeightAt`, from one side or the other', () => {
    // "From one side" is not a loophole: a tooth's foot is a vertical face in the model (its height
    // is measured from the shaft at the tooth's *centre*), so the outline carries two vertices there
    // — the limit from each side. Every other vertex sits on the surface exactly.
    const EPS = 1e-9
    for (const [name, tool] of POSES) {
      const { xs, top } = toolOutline(tool)
      expect(xs.length, name).toBeGreaterThan(1)
      xs.forEach((x, i) => {
        const here = toolHeightAt(tool, x)!
        const sides = [here, toolHeightAt(tool, x - EPS) ?? here, toolHeightAt(tool, x + EPS) ?? here]
        const drawn = top[i]!
        const ok = sides.some((v) => Math.abs(v - drawn) < 1e-7)
        expect(ok, `${name} @${x.toFixed(3)}: drew ${drawn}, surface ${here}`).toBe(true)
      })
    }
  })

  it('is linear between its vertices, so the drawn edge never cuts a corner off the physics', () => {
    // Both the shaft and the teeth are piecewise-linear in the model, so a straight line between
    // two breakpoints has to *be* the surface — not merely touch it at the ends.
    for (const [name, tool] of POSES) {
      const { xs, top } = toolOutline(tool)
      for (let i = 0; i + 1 < xs.length; i += 1) {
        const a = xs[i]!
        const b = xs[i + 1]!
        if (b - a < 1e-9) continue // a vertical face — a tooth's foot, where the surface steps
        for (const t of [0.25, 0.5, 0.75]) {
          const x = a + (b - a) * t
          const drawn = top[i]! + (top[i + 1]! - top[i]!) * t
          expect(drawn, `${name} @${x.toFixed(2)}`).toBeCloseTo(toolHeightAt(tool, x)!, 6)
        }
      }
    }
  })

  it('runs from the hand to the point, and no further', () => {
    for (const [name, tool] of POSES) {
      const { xs } = toolOutline(tool)
      expect(xs[0], name).toBeCloseTo(handX(tool), 9)
      expect(xs[xs.length - 1], name).toBeCloseTo(Math.min(tool.x, tool.reach) + TOOTH_HALF, 9)
      // Past the point there is no tool at all (D-015), and the outline agrees.
      expect(toolHeightAt(tool, xs[xs.length - 1]! + 0.01), name).toBeNull()
    }
  })

  it('is a strip with two edges: the underside is always below the milled edge', () => {
    for (const [name, tool] of POSES) {
      const { xs, top, under } = toolOutline(tool)
      xs.forEach((x, i) => {
        expect(under[i]!, `${name} @${x.toFixed(2)}`).toBeLessThan(top[i]!)
      })
    }
  })

  it('is milled from constant stock and ground only at the point', () => {
    // A pick is strip steel: the same section down its length, ground away over the last couple of
    // millimetres. Tapering it as a *fraction* of the tool's length drew a needle (fixed on sight).
    const tool = POSES[1]![1]
    const { xs, top, under } = toolOutline(tool)
    const thickness = xs.map((_, i) => top[i]! - under[i]!)
    const point = thickness[thickness.length - 1]!
    expect(point).toBeLessThan(0.2)
    const backs = xs.map((x, i) => ({ back: xs[xs.length - 1]! - x, t: thickness[i]! }))
    const shaft = backs.filter((b) => b.back > 3)
    expect(shaft.length).toBeGreaterThan(0)
    for (const s of shaft) expect(s.t).toBeGreaterThan(0.6)
  })
})

/**
 * The pick rests **on** the bottom of the keyway, never through it.
 *
 * Reported from play: *"lockpick part can go beyond bottom of keyway"* — and it did, by 0.32mm on
 * the hook and 0.61mm on the rake, because the slot was drawn 3.0mm deep for a tool that needs 3.5.
 * The model owns the floor now and the drawing reads it, so this asserts the thing that was wrong:
 * the **underside** of the steel, which is what actually touches, at every lift a hand can command.
 */
describe('the tool stays inside the keyway', () => {
  it('never draws steel below the floor of the slot, however hard it is pressed down', () => {
    for (const kind of ['hook', 'rake'] as const) {
      const lab = createLab({ kinds: ['standard', 'standard', 'standard', 'standard'], seed: 7 })
      lab.tool = kind === 'rake' ? makeRake() : makeHook()
      let lowest = 0
      for (const x of [0, 4.2, 8.4, 12.6]) {
        for (const ask of [-20, -12, -9.5, -8.9, -8.5, -7, -4]) {
          step(lab, { toolX: x, toolLift: ask, tension: 0.3 })
          const { under } = toolOutline(lab.tool)
          lowest = Math.min(lowest, ...under)
        }
      }
      expect(lowest, `${kind}: lowest steel`).toBeGreaterThanOrEqual(KEYWAY_BOTTOM - 1e-9)
    }
  })
})
