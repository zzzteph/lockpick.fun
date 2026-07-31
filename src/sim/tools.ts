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
