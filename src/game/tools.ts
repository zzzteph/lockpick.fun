/**
 * The tools — one pick, one wrench, always in hand.
 *
 * There used to be a catalogue of nineteen tools, a shop to buy them from and a loadout screen to
 * equip them, and `CONTENT.md §2` still describes it. It is gone. Asked for in play as *"remove the
 * inventory — you should always have the right tool"*, and the request is a good one: the
 * catalogue's main effect on a session was that a lock you could not open was sometimes a lock you
 * could not open **yet**, for reasons that had nothing to do with picking it. Reach in particular
 * was a hard wall — the deep chambers of a six-pin cylinder were unreachable until you had banked
 * 650 credits — and the shop screen was where you went to find that out.
 *
 * What is kept, deliberately, is everything about a tool that the *hand* can feel:
 *
 * - **`liftJitter`** — the tip does not sit exactly where you point it, so precision is something
 *   you exercise rather than something you buy.
 * - **`strength`** — the pick still bends and still snaps if you lean on a pin that will not move
 *   (D-068). That is a consequence of how you pick, not of what you own.
 * - **`tensionSlew` and `tensionPrecision`** — the wrench still takes a moment to load and still
 *   wobbles, which is what makes tension something you manage.
 *
 * What is removed is everything that was a *gate*: reach is effectively unlimited, the keyway
 * always fits, and the tension range spans every pressure step. The lock is the difficulty now.
 * See DECISIONS D-088.
 */

import { TENSION_SLEW, type ToolStats } from '../sim'

/**
 * The kit. Good, not perfect.
 *
 * `PERFECT_TOOLS` in `src/sim/tools.ts` exists for physics tests and is *not* this: it has zero
 * jitter and effectively infinite strength, which would take pick strain and the whole question of
 * precision out of the game. This is a competent pick in a competent hand.
 */
export const KIT: ToolStats = {
  // Every pressure step from 1 to 10 passes through unclamped, so the wheel means what it says.
  tensionMin: 0.05,
  tensionMax: 1.0,
  tensionSlew: TENSION_SLEW,
  tensionPrecision: 0.03,
  // A competent hook: taller than the starter, so it reaches further under a pin and fouls more
  // of what it passes. That is the trade a real picker makes choosing a deep hook (D-138).
  hookHeight: 2.0,
  // Longer than the longest lock in the roster. Reach is no longer a wall (D-088).
  reach: 99,
  liftJitter: 0.035,
  liftRate: 1,
  fitsTightKeyway: true,
  // Top of the keyway, which leaves the most room for the pick — the choice a picker would make.
  keywayPosition: 'top',
  strength: 1.1,
}

/** The line under the HUD naming what is in your hands. There is only ever one answer. */
export const KIT_NAME = 'hook and wrench'
