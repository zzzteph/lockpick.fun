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
/** The floor the eased push cycles down to at the top of the dial (D-225). */
const EASE_FLOOR = 5
/**
 * Where each attempt starts its wrench — D-225. A lock the walk cannot finish from the default is
 * dropped and started over from another pressure, the way a hand gives up on a going-nowhere
 * attempt: the last four of 60 generated tier 3–4 locks each opened from some other start and from
 * no single one. The outcome is sensitive — the contact solve warm-starts from the last frame, so a
 * reset never replays a fresh start exactly — so the retries cycle pressures in both styles, the
 * PATIENT one (see `walkOnce`) first. The first try is the proven default and gets the most time.
 */
const RETRIES: readonly { readonly step: number; readonly patient: boolean }[] = [
  { step: FIRST_STEP, patient: false },
  ...[4, 8, 3, 7, 6, 9, 5].flatMap((step) => [
    { step, patient: true },
    { step, patient: false },
  ]),
]
const FIRST_TRY_SECONDS = 150
const RETRY_SECONDS = 90
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
  const total = opts.maxSeconds ?? 1500
  let spent = 0
  for (let i = 0; i < RETRIES.length && spent < total && !session.state.opened; i += 1) {
    if (i > 0) {
      // Start over, as a hand does when a lock is going nowhere: wrench off, pick out — every pin
      // drops — then again from a different pressure.
      for (let t = 0; t < 0.6; t += DT) onEvents(session.advance(DT, input({})))
      spent += 0.6
    }
    const cap = Math.min(total - spent, i === 0 ? FIRST_TRY_SECONDS : RETRY_SECONDS)
    spent += walkOnce(session, onEvents, RETRIES[i]!.step, RETRIES[i]!.patient, cap)
  }
  return session.state.opened
}

/**
 * One attempt from `firstStep`, within `budget` seconds. Returns the seconds it used. `patient` is
 * the retry style (D-225): at the top of the dial a false set's push is eased too, the ease goes down
 * to step 3, and a pin nothing binds is pushed plainly every other try — the counter's roll-back can
 * knock the last set pin off its ledge (a tier-3 five-pin looped set 3 / lose 3 for a minute).
 */
function walkOnce(
  session: Session,
  onEvents: (events: readonly SimEvent[]) => void,
  firstStep: number,
  patient: boolean,
  budget: number,
): number {
  let spent = 0
  const advance = (inp: SimInput, secs: number): void => {
    for (let t = 0; t < secs && spent < budget && !session.state.opened; t += DT) {
      onEvents(session.advance(DT, inp))
      spent += DT
    }
  }
  const s = session.state
  let step = firstStep
  let LEVEL = tensionForStep(step)
  let DIP = tensionForStep(step - 1)
  let idle = 0
  /** The eased push's step once the wrench is at the top (D-225). */
  let easeStep = LAST_STEP
  const easeFloor = patient ? 3 : EASE_FLOOR
  let stuckTries = 0
  // The wrench on, the pick out: the first pin binds.
  advance(input({ tensionHeld: true, tensionLevel: LEVEL }), 0.6)
  for (let pushes = 0; pushes < 12 * s.chambers.length && spent < budget && !s.opened; pushes += 1) {
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
      // …unless a sidebar gate is unmet (D-230): lift that set pin slowly up its window until the
      // leg drops into the gate, then let it down.
      const eng = session.engine
      const gated = eng ? s.chambers.findIndex((_, i) => eng.gate(i) !== null && !eng.aligned(i)) : -1
      if (eng && gated >= 0) {
        advance(input({ chamber: gated, tensionHeld: true, tensionLevel: LEVEL }), 0.3)
        let lift = 0
        for (let t = 0; t < 3 && spent < budget && !s.opened && !eng.aligned(gated); t += DT) {
          // Up slowly, and hold still once the key pin is in its gate — the leg needs a moment.
          if (!eng.inGate(gated)) lift = Math.min(LIFT_CEILING, lift + KEY_LIFT_RATE * 0.35 * DT)
          onEvents(session.advance(DT, input({ chamber: gated, liftTarget: lift, tensionHeld: true, tensionLevel: LEVEL })))
          spent += DT
        }
        advance(input({ chamber: gated, tensionHeld: true, tensionLevel: LEVEL }), 0.4)
        continue
      }
      if (step >= LAST_STEP) break
      step += 1
      LEVEL = tensionForStep(step)
      DIP = tensionForStep(step - 1)
      continue
    }
    const setsBefore = s.chambers.filter((c) => c.state === 'SET').length
    if (stuck >= 0) stuckTries += 1
    const plainStuck = patient && stuck >= 0 && stuckTries % 2 === 0
    const eased = step >= LAST_STEP && idle >= 2 ? tensionForStep(easeStep) : null
    const level = plainStuck
      ? LEVEL
      : falseSet >= 0
        ? ((patient ? eased : null) ?? DIP)
        : stuck >= 0
          ? DIP
          : (eased ?? LEVEL)
    // A binding SECURITY pin that gave nothing on the last push is caught on a tooth or a waist —
    // the magnet's case above all (D-230: a magnetic serrated driver held on a tooth stays there),
    // so it is worked the way a false set is: with the plug eased back under the lift.
    const caught = falseSet < 0 && stuck < 0 && idle >= 1 && session.def.pins[target] !== 'standard'
    const counter = falseSet >= 0 || (stuck >= 0 && !plainStuck) || caught
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
    } else if (idle >= 2) {
      // At the top of the dial the wrench STAYS there — easing it drops the plug back and the sets
      // with it — but each push is made a step lighter than the last, round and round (D-225): a
      // pin pinched hard under the full wrench cannot be lifted at all, and the same push eased
      // sets it (a generated tier-3 five-pin stalled at step 10 for 50 s; one eased push opened it).
      easeStep = easeStep > easeFloor ? easeStep - 1 : LAST_STEP - 1
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
  return spent
}
