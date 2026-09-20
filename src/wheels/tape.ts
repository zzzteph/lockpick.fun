/**
 * Replaying an input tape through the wheel engine — D-235 (from `src/sim/tape.ts`, which keeps the
 * engine-free tape utilities).
 */

import { DT } from '../sim/constants'
import type { InputTape } from '../sim/tape'
import type { SimState } from '../sim/types'
import { step } from './step'

/** Play a tape into a state. Optionally stop early once the lock opens. */
export function runTape(
  state: SimState,
  tape: InputTape,
  opts: { stopOnOpen?: boolean; dt?: number } = {},
): SimState {
  const dt = opts.dt ?? DT
  for (const segment of tape) {
    for (let i = 0; i < segment.ticks; i += 1) {
      step(state, segment.input, dt)
      if (opts.stopOnOpen && state.opened) return state
    }
  }
  return state
}
