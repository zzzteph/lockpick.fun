/**
 * The 2.5D contact solver as a `Session` stepper — docs/SOLVER_PORT.md.
 *
 * `Session` steps a `SimState` in whole `DT` ticks from a `SimInput` and drains a `SimEvent`
 * stream; the game reads nothing else. This module is the second thing that can stand behind
 * that contract: the bench engine (`src/physics/engine.ts`, the solver under the game's read
 * model) driven from the same `SimInput` the keyboard, a finger or the Deck produce, pouring
 * each tick into the same `SimState` (the engine's `project()`), with the events and the
 * attempt stats synthesised here from what changed.
 *
 * Pin-tumbler only (`solverCanRun`); everything else stays on `src/sim`.
 */

import { createEngine, type Engine } from '../physics/engine'
import { DT, T_MIN_HOLD, type LockDef, type SimConfig, type SimEvent, type SimInput, type SimState } from '../sim'
import { KEY_LIFT_RATE, tensionForStep } from '../ui/input'

export interface Stepper {
  readonly state: SimState
  /** The solver behind the state — what the side and front views are drawn from. */
  readonly engine: Engine
  /** Advance one tick of `dt` seconds under `input`; events land in `state.events`. */
  step(input: SimInput, dt: number): void
}

/** Locks the solver has bodies for: single-row pin tumblers with no sidebar, wafer or magnet. */
export function solverCanRun(def: LockDef): boolean {
  if (def.family !== 'pin-tumbler') return false
  if ((def.rows ?? 1) !== 1 || def.doubleSided || def.sidebar || def.discs) return false
  if (def.magneticChambers && def.magneticChambers.length > 0) return false
  return def.pins.every((p) => p !== 'wafer')
}

/**
 * The game's ten-step wrench dial as the solver's torque, a fraction of 60 N·mm.
 *
 * The bench's five levels are 6–20 N·mm. Its default of 8 N·mm (0.13) was the lightest that
 * still carried the plug past two set pins to the next bind — on the trainers and the standard
 * locks. Across the roster it is not enough: at 0.13 the tier-3 and tier-4 locks stall with the
 * last pin or two lifted free and the plug held where it is by the set drivers' feet on its rim
 * (four or five sets, the newest with its bevel on the chamfer: measured 0.5–0.7 N at 45° on the
 * chamfer plus the ledge friction, against 7.8 N·mm of wrench). At 0.18 (10.8 N·mm — the bench's
 * walk script's own default, the one every earlier roster check ran at) six of the nine open.
 * So the game's default step 5 of 10 is 0.18, the dial's ends 0.10 and 0.34, straight lines
 * between; a spool's false set is held by the waist floor and the counter-rotation stop, not by
 * the wrench's weight, so the heavier default costs the spool technique nothing.
 */
export function solverTension(level: number): number {
  const L0 = tensionForStep(1)
  const L1 = tensionForStep(5)
  const L2 = tensionForStep(10)
  if (level <= L0) return 0.1
  if (level <= L1) return 0.1 + ((level - L0) / (L1 - L0)) * (0.18 - 0.1)
  if (level <= L2) return 0.18 + ((level - L1) / (L2 - L1)) * (0.34 - 0.18)
  return 0.34
}

/**
 * Counter-rotation, rad/s, while the wrench is held below the level the plug was last carried
 * forward at — the bench's right button as the game's own verb, "ease the wrench a step" (W,
 * the slider a band down, L1 on the Deck; D-203/D-204's dip-and-climb). 0.3°/s, the bench's.
 */
export const COUNTER_RATE = 0.3 * (Math.PI / 180)
/** A dip has to be at least this much of the dial to count (a step is 0.09). */
const DIP_MIN = 0.04
/**
 * How long the click holds the hand, s (the bench's `CLICK_PAUSE`). A hand that pushes on
 * through the click over-pushes: the key pin wedges in the housing's mouth and the pin reads
 * OVERSET (`OVER_HOLD`). Under a keyboard's ramp or a finger's drag the command runs on, so the
 * pause lives here, where it applies to every way of playing alike.
 */
const CLICK_PAUSE = 0.35
/** The hand's give: the lift the solver is asked for follows the command slower under load. */
const LOAD_GAIN = 0.6
/** The pick is out of the lock here, mm before pin 1 (the bench's `-3`). */
const OUT_X = -3
/**
 * The tip's commanded x slides toward where the hand wants it at this rate, mm/s (the bench's
 * `TIP_SLEW`). An arrow snap moves the want by a whole pitch in one frame; handing that to the
 * hand spring as a step rams the hook into the next pin's cone at full force. A hand slides.
 */
const TIP_SLEW = 60
/** The plug has "moved" for the event stream past this much, rad. */
const PLUG_MOVED_MIN = 0.02 * (Math.PI / 180)
/**
 * How close the tip must be to a pin's centre, mm, before the lift may rise — the "down, across,
 * up" motion made real. While the tip is travelling to a pin (or out of the lock) the pick comes
 * DOWN and crosses; only once it has arrived does it push UP. Without this a pick that reaches a
 * bound pin with the lift already up slams it, the load-scaled ramp stalls in a low-force
 * equilibrium, and the pin never lifts however long Space is held (owner: "the lockpick moves,
 * but when I press space it does not lift — you wait 3–5 seconds", "sometimes the pins are not
 * lifting at all"). It is also the bench's rule — arriving under a new pin drops the tip (D-051).
 */
const ARRIVE_MM = 0.4

export function createSolverStepper(def: LockDef, seed: number, config: SimConfig): Stepper {
  const eng: Engine = createEngine(def, seed, config)
  const state = eng.sim
  const P = eng.sol.params
  const rest = eng.tipRest()
  /** The lift the solver is asked for, mm: the command through the hand's give and the click's pause. */
  let lift = 0
  let pauseLeft = 0
  let lastChamber = -1
  /** The dial level the plug was last carried forward at; a held level below it counter-rotates. */
  let holdLevel = 0
  let lastTheta = 0
  let lastCounter = 0
  let tipXCmd = OUT_X
  let plugFreeSaid = false
  const prevStates = state.chambers.map((c) => c.state)
  // (`createSimState` has already queued ATTEMPT_STARTED.)

  function emit(e: SimEvent): void {
    state.events.push(e)
  }

  return {
    state,
    engine: eng,
    step(input: SimInput, dt: number): void {
      const s = state
      const chamber = input.chamber >= 0 && input.chamber < s.chambers.length ? input.chamber : -1
      if (chamber !== lastChamber) {
        if (lastChamber >= 0 || chamber >= 0) emit({ type: 'PICK_MOVED', from: lastChamber, to: chamber, time: s.time })
        lastChamber = chamber
        // A fresh pin starts from the command as it stands; the pause is for the pin that clicked.
        pauseLeft = 0
      }
      // Where the hand wants the tip: the mouse's continuous position when it drives, else the
      // chamber's centre; in front of the mouth when the pick is out.
      const at = input.pickAt !== undefined ? Math.max(0, input.pickAt) : chamber
      const tipWant = chamber < 0 ? OUT_X : P.firstChamberX + at * P.pitch
      const slew = TIP_SLEW * dt
      tipXCmd += Math.max(-slew, Math.min(slew, tipWant - tipXCmd))
      const tipX = tipXCmd

      // The hand: the pick lifts only once it has ARRIVED at the pin (`ARRIVE_MM`) — while it is
      // still travelling it comes down and crosses, so it never slams a pin it reaches with the
      // lift up. Arrived, it rises no faster than the ramp, slower the harder it presses; falls at
      // the release rate; and holds for a moment at the click.
      const target = Math.max(0, input.liftTarget)
      const force = eng.pick().force
      const arrived = chamber >= 0 && Math.abs(tipXCmd - tipWant) < ARRIVE_MM
      if (!arrived) lift = Math.max(0, lift - KEY_LIFT_RATE * 2 * dt)
      else if (target < lift) lift = Math.max(target, lift - KEY_LIFT_RATE * 1.6 * dt)
      else if (pauseLeft > 0) pauseLeft -= dt
      else lift = Math.min(target, lift + (KEY_LIFT_RATE / (1 + LOAD_GAIN * force)) * dt)

      // The wrench, and the dip that counter-rotates.
      const held = input.tensionHeld && input.tensionLevel > 0
      const level = held ? input.tensionLevel : 0
      const tension = held ? solverTension(level) : 0
      if (!held) holdLevel = 0
      else if (level > holdLevel) holdLevel = level
      // The dip, or the right button on top of the wrench (the bench's control, on a mouse).
      const counter = held && (level < holdLevel - DIP_MIN || input.counter === true) ? COUNTER_RATE : 0

      // The pick gun: a strike this frame flicks the pins up before the step (see `Engine.strike`).
      if (input.strike) eng.strike()
      const thetaBefore = eng.theta()
      eng.drive(tipX, rest + lift, tension, dt, counter)
      if (eng.clickedNow) pauseLeft = CLICK_PAUSE

      // The plug carried forward at this level: it is the working level again.
      const theta = eng.theta()
      if (held && theta > thetaBefore + 1e-6 && counter === 0) holdLevel = level

      // The game's HUD, audio and logic read `tension` as the 0..1 dial level the player set — the
      // same as the rate sim — not the solver's internal torque fraction (`solverTension`, 0.1–0.34)
      // the engine put there, which filled the pressure meter to only 2–3 of 10 whatever the dial
      // said (owner: "the tension wrench pressure bar only shows 1 or 2 grades even if you press
      // 6–10"). The pushed-pin block keeps the wrench shown by holding `level` here too.
      s.tension = held ? level : 0
      s.tensionCommanded = held ? level : 0

      // ── What changed: events and stats ──
      const dropped: number[] = []
      for (let i = 0; i < s.chambers.length; i += 1) {
        const c = s.chambers[i]!
        const was = prevStates[i]!
        const now = c.state
        if (now !== was) {
          if (now === 'SET') {
            emit({ type: 'PIN_SET', chamber: i, tension: s.tension, time: s.time })
            if (!s.stats.setOrder.includes(i)) s.stats.setOrder.push(i)
            if (pauseLeft <= 0 && i === chamber && lift > 0) pauseLeft = CLICK_PAUSE
          } else if (now === 'OVERSET') {
            emit({ type: 'PIN_OVERSET', chamber: i, time: s.time })
            s.stats.oversets += 1
          } else if (now === 'FALSE_SET') {
            emit({ type: 'FALSE_SET_ENTERED', chamber: i, depth: Math.max(0, theta - thetaBefore), time: s.time })
            s.stats.falseSetsEntered += 1
            c.hasFalseSet = true
          }
          // A jammed overset falling as the wrench comes off is a reset too (D-223) — it is the only
          // way out of a latch, and Lesson 3 waits on exactly that reset.
          if ((was === 'SET' && now !== 'SET' && now !== 'OVERSET') || (!held && was === 'OVERSET' && now !== 'OVERSET')) {
            dropped.push(i)
            const at = s.stats.setOrder.indexOf(i)
            if (at >= 0) s.stats.setOrder.splice(at, 1)
          }
          prevStates[i] = now
        }
        c.counterForce = counter > 0 ? 1 : 0
        c.jammed = eng.jammed(i)
      }
      if (dropped.length > 0) {
        if (!held) s.stats.fullResets += 1
        emit({ type: 'RESET', kind: held ? 'counter' : 'full', dropped, time: s.time })
        plugFreeSaid = false
      }
      // Picked but unturned (D-055): every pin set, the plug past the last hold, the pick still on
      // a pin — the plug is free and the hand does not know it yet. Once, until a pin is lost.
      if (!s.opened && eng.plugFree() && !plugFreeSaid) {
        plugFreeSaid = true
        emit({ type: 'PLUG_FREE', time: s.time })
      }
      if (s.bindingChamber >= 0 && !s.stats.bindOrder.includes(s.bindingChamber)) s.stats.bindOrder.push(s.bindingChamber)
      if (s.tension > s.stats.maxTension) s.stats.maxTension = s.tension
      if (s.tension >= T_MIN_HOLD && s.tension < s.stats.minTensionWhileHeld) s.stats.minTensionWhileHeld = s.tension
      if (s.resistance > s.stats.maxResistance) s.stats.maxResistance = s.resistance
      if (counter > 0) {
        s.stats.maxCounterForce = Math.max(s.stats.maxCounterForce, 1)
        if (lastCounter === 0) emit({ type: 'COUNTER_ROTATION', chamber: Math.max(0, chamber), force: 1, time: s.time })
      }
      lastCounter = counter

      s.thetaVelocity = (theta - lastTheta) / dt
      if (Math.abs(theta - lastTheta) > PLUG_MOVED_MIN) emit({ type: 'PLUG_MOVED', theta, velocity: s.thetaVelocity, time: s.time })
      lastTheta = theta
      s.ticks += 1
      s.stats.elapsed = s.time
      s.belowMinHoldFor = s.tension < T_MIN_HOLD ? s.belowMinHoldFor + dt : 0
      if (s.opened && !s.plugFreeAnnounced) {
        s.plugFreeAnnounced = true
        emit({ type: 'LOCK_OPENED', time: s.time, ticks: s.ticks })
      }
    },
  }
}

/** `DT` re-exported so a caller stepping by hand uses the game's tick, not its own. */
export const SOLVER_DT = DT
