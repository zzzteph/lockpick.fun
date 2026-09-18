/**
 * A scripted hand that opens a solver-stepped lock — docs/SOLVER_PORT.md.
 *
 * The rate sim's `solveLock` writes an input tape the game replays tick by tick (the dev hook's
 * `solveCurrentLock`, the "solve it for me" of the e2e suites and the dungeon's guide). The
 * contact solver has no tape: this walks the lock the way the bench's tests do — the wrench held
 * at the game's default step, the binding pin pushed with the keyboard's ramp until it clicks,
 * a false set worked again with the wrench eased a step (the counter-rotation verb) — through
 * `Session.advance`, so every event reaches whoever is listening.
 */

import type { Session } from './session'
import type { SimEvent, SimInput } from '../sim'
import { KEY_LIFT_RATE, tensionForStep } from '../ui/input'

const DT = 1 / 120
/**
 * The wrench: the game's default step 5 first, a step heavier each time the lock stops giving
 * (two pushes in a row that set nothing), up to the top — what a hand does when the last pin or
 * two lift free and the plug will not move for the set drivers' feet on its rim (the tier-3 and
 * tier-4 locks need step 6 to 8, and the tightest six-pin t-bar the whole dial; measured
 * 2026-09-17). The dip is one step under the current one.
 */
const FIRST_STEP = 5
const LAST_STEP = 10
/** The most the hand asks the tip to rise, mm (the bench's ceiling). */
const LIFT_CEILING = 3.5

export interface WalkOptions {
  readonly maxSeconds?: number
}

function input(patch: Partial<SimInput>): SimInput {
  return { chamber: -1, liftTarget: 0, tensionHeld: false, tensionLevel: 0, ...patch }
}

/**
 * Walk `session` open. Returns whether it opened. `onEvents` receives what each advance emitted,
 * exactly as the frame loop would hand it to audio, haptics and the log.
 */
export function walkSolver(session: Session, onEvents: (events: readonly SimEvent[]) => void, opts: WalkOptions = {}): boolean {
  const budget = opts.maxSeconds ?? 180
  let spent = 0
  const advance = (inp: SimInput, secs: number): void => {
    for (let t = 0; t < secs && spent < budget && !session.state.opened; t += DT) {
      onEvents(session.advance(DT, inp))
      spent += DT
    }
  }
  const s = session.state
  let step = FIRST_STEP
  let LEVEL = tensionForStep(step)
  let DIP = tensionForStep(step - 1)
  let idle = 0
  // The wrench on, the pick out: the first pin binds.
  advance(input({ tensionHeld: true, tensionLevel: LEVEL }), 0.6)
  for (let pushes = 0; pushes < 6 * s.chambers.length && spent < budget && !s.opened; pushes += 1) {
    const falseSet = s.chambers.findIndex((c) => c.state === 'FALSE_SET')
    // A serrated pin resting in a notch reads FREE, not binding — it is not the binder and not a
    // false set, so when nothing else calls, the walk works the first unset pin with the wrench
    // eased (a notch comes off the way a false set does). This is also how the last pin sets when
    // the plug is held short of the open by the set drivers' feet.
    const stuck = falseSet < 0 && s.bindingChamber < 0 ? s.chambers.findIndex((c) => c.state !== 'SET') : -1
    const target = falseSet >= 0 ? falseSet : s.bindingChamber >= 0 ? s.bindingChamber : stuck
    if (target < 0) {
      // Every pin set: the plug may be free — hold and see, a step heavier if it is held short.
      advance(input({ tensionHeld: true, tensionLevel: LEVEL }), 0.3)
      if (s.opened) break
      if (step >= LAST_STEP) break
      step += 1
      LEVEL = tensionForStep(step)
      DIP = tensionForStep(step - 1)
      continue
    }
    const setsBefore = s.chambers.filter((c) => c.state === 'SET').length
    const level = falseSet >= 0 || stuck >= 0 ? DIP : LEVEL
    const counter = falseSet >= 0 || stuck >= 0
    advance(input({ chamber: target, tensionHeld: true, tensionLevel: LEVEL }), 0.3)
    let lift = 0
    let latched = false
    for (let t = 0; t < 1.5 && spent < budget && !s.opened; t += DT) {
      const c = s.chambers[target]
      if (!latched && c && c.state === 'SET') latched = true
      lift = latched ? Math.max(0, lift - KEY_LIFT_RATE * 1.6 * DT) : Math.min(LIFT_CEILING, lift + KEY_LIFT_RATE * DT)
      onEvents(session.advance(DT, input({ chamber: target, liftTarget: lift, tensionHeld: true, tensionLevel: latched ? LEVEL : level, ...(counter && !latched ? { counter: true } : {}) })))
      spent += DT
    }
    advance(input({ chamber: target, tensionHeld: true, tensionLevel: LEVEL }), 0.5)
    // No new set from this push: once is a false set being worked, twice is the wrench too light.
    const setsAfter = s.chambers.filter((c) => c.state === 'SET').length
    idle = setsAfter > setsBefore ? 0 : idle + 1
    if (idle >= 2 && step < LAST_STEP) {
      step += 1
      LEVEL = tensionForStep(step)
      DIP = tensionForStep(step - 1)
      idle = 0
    }
  }
  // The open: the pick out, the wrench held — a step heavier each half-second the plug is held
  // short of the open by the set drivers on its rim, up to the last step.
  for (let k = 0; k < 6 && !s.opened && spent < budget; k += 1) {
    advance(input({ chamber: -1, tensionHeld: true, tensionLevel: LEVEL }), 0.5)
    if (step < LAST_STEP) {
      step += 1
      LEVEL = tensionForStep(step)
    }
  }
  return s.opened
}
