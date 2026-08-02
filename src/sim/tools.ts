/**
 * Tool stat presets used by the simulation.
 *
 * The purchasable catalogue lives in `src/game/` (Phase 8); these are the two the sim and
 * its tests always need: what a new player is holding, and a hypothetical perfect tool for
 * isolating physics from tool noise in unit tests.
 */

import { TENSION_SLEW } from './constants'
import type { ToolStats } from './types'

/** Starter Flat Wrench + Starter Short Hook — `CONTENT.md §2`. */
export const STARTER_TOOLS: ToolStats = {
  tensionMin: 0.15,
  tensionMax: 0.85,
  tensionSlew: TENSION_SLEW,
  tensionPrecision: 0.04,
  reach: 4,
  /**
   * A short hook: it clears most of what it passes, which is part of what makes it the starter.
   *
   * Live since D-139 gave the player a way to travel with the hand up — hold Space and arrow, or
   * carry a touch-lift sideways into the next chamber. Before that this was zero, because a stat
   * that only fires on an input the game does not offer is an inert feature, and this project has
   * shipped five of those.
   *
   * Was: **zero, and here is why it had to be.** DECISIONS D-138.
   *
   * The crest height is live and proven: `tests/sim/shaft.test.ts` shows a hook carried high
   * pressing the pins it passes, a hook carried low touching nothing, and pins carried at the
   * crest rather than jacked to the hand's height.
   *
   * But `stepChamber` in the input layer zeroes the lift on every chamber change, and the touch
   * scheme does the same — deliberately, since D-051 and D-059, because carrying a tip high past a
   * set pin is how you lose it. So **no human input can travel with the hand up**, and a stat that
   * only fires on an input the game does not offer is exactly the inert feature this project has
   * shipped five times before.
   *
   * Turning it on is one number here, and it needs a decision about the controls first: whether
   * carrying the pick high while moving should become possible, and at what cost. Measured with
   * the solver carrying high, the cost is enormous — tier 1 went 2.50 to 36.61 and tier 2 went
   * 6.16 to 104.08, with two locks failing to open at all.
   */
  hookHeight: 1.6,
  liftJitter: 0.05,
  liftRate: 1,
  fitsTightKeyway: false,
  keywayPosition: 'bottom',
  strength: 1,
}

/**
 * A tool with no wobble and unlimited reach. Not purchasable — it exists so physics tests
 * can assert on the model rather than on tool jitter, and so the solver can be run in a
 * "does the lock work at all" configuration separately from "is it beatable with starters".
 */
export const PERFECT_TOOLS: ToolStats = {
  tensionMin: 0,
  tensionMax: 1,
  tensionSlew: 12,
  tensionPrecision: 0,
  reach: 99,
  // Flat: the reference tool fouls nothing, so physics tests measure the lock and not the tool.
  hookHeight: 0,
  liftJitter: 0,
  liftRate: 1,
  fitsTightKeyway: true,
  keywayPosition: 'top',
  // Unbendable, like everything else about it.
  strength: 1000,
}

export function withTools(base: ToolStats, patch: Partial<ToolStats>): ToolStats {
  return { ...base, ...patch }
}
