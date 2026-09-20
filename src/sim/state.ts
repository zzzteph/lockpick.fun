/**
 * Small, engine-free readings and utilities over a `SimState` — D-235.
 *
 * They lived in the rate sim's `step.ts`, but none of them simulates anything: the game, the HUD and
 * both engines read them. When the rate sim's pin physics went and its wheel physics moved to
 * `src/wheels`, these stayed with the shared lock model.
 */

import { HOOK_RISE, OPEN_THETA_FRACTION, SHAFT_HALF, SHANK_REACH, THETA_OPEN } from './constants'
import type { SimEvent, SimState } from './types'

/**
 * How high the pick's **shaft** holds a pin in front of the hook — DECISIONS D-149.
 *
 * The tool is a rigid straight strip turning about the hand. Its angle is set by the *crest*, which
 * rises `liftTarget` above rest at the chamber being worked; the shaft runs parallel to that line
 * and `HOOK_RISE` below it, and a pin rests on the shaft's **top edge**, a further `SHAFT_HALF` up.
 * So the bearing height at chamber `index` is that line, taken at the chamber's distance from the
 * hand — measured in chamber pitches, `SHANK_REACH` of them outside the lock.
 *
 * **Written twice, differently, and the two did not agree.** D-145 had this as
 * `(lift - HOOK_RISE) × xᵢ/x_pick`, which decays the *already reduced* value and so runs higher than
 * the drawn shaft everywhere except the chamber being worked. The renderer places a rigid tool, and
 * the simulation held pins on a line that was not the one being drawn: the further a chamber was
 * from the hook, the wider the gap. Reported as *"it correctly lifts the nearest pin, but for the
 * rest there is air between the lockpick and the pin."*
 *
 * Exported so the picture can be held against it — `tests/render/shank.test.ts` measures the shaft
 * the renderer actually draws and asserts it lands here, at every chamber and every lift.
 */
export function shankLift(liftTarget: number, pick: number, index: number): number {
  if (pick <= 0 || index >= pick) return 0
  const alongTool = (index + SHANK_REACH) / (pick + SHANK_REACH)
  return Math.max(0, liftTarget * alongTool - HOOK_RISE + SHAFT_HALF)
}

export function pickedButUnturned(state: SimState): boolean {
  if (state.opened || !state.sidebarDropped) return false
  if (!state.chambers.every((c) => c.state === 'SET')) return false
  return state.theta < THETA_OPEN * OPEN_THETA_FRACTION
}

/** Take the events accumulated since the last drain. */
export function drainEvents(state: SimState): SimEvent[] {
  const out = state.events
  state.events = []
  return out
}
