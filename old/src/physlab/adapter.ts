/**
 * PHYSLAB → `src/sim` adapter — migration Phase A.
 *
 * This is the bridge that lets the geometric lab wear the game's existing contract, so nothing in
 * `src/render`, `src/audio` or `src/game` has to change to run on physlab: it builds a lab from a
 * real pin-tumbler `LockDef` (the game's pins/bitting/tolerance), and reads physlab's state back out
 * as the game's `ChamberState` and `SimEvent` stream. It also carries a physlab `solveLock` twin, so
 * the pickability proofs and tuning keep working.
 *
 * Pin-tumbler only — the other seven families stay on `src/sim` (the hybrid the plan describes).
 * Scope note: this maps the geometry faithfully (the game's band model *is* physlab's silhouette),
 * but leaves absolute coordinate/feel parity to Phase C — reach, groove bevel (`taper`), and the
 * exact tolerance→clearance curve are approximated here and tuned later.
 */

import {
  profileByName,
  type ChamberState,
  type DriverProfile,
  type LockDef,
  type PinTypeName,
  type SimConfig,
  type SimEvent,
  type SimInput,
} from '../sim'
import {
  createLab,
  DT,
  FLOOR_Y,
  PITCH,
  setLift,
  step,
  type Band as LabBand,
  type Chamber,
  type ChamberSpec,
  type LabInput,
  type LabState,
  type ProfileKind,
} from './model'

const HOOK_HEIGHT = 2.3

/** A pin type's family, for physlab's coarse `kind` label (the geometry comes from its bands). */
function labKind(name: PinTypeName): ProfileKind {
  if (name === 'serrated') return 'serrated'
  if (name === 'mushroom' || name === 't-pin') return 'mushroom'
  if (name === 'standard' || name === 'wafer') return 'standard'
  return 'spool' // spool, spool-slim, spool-deep, spool-double
}

/**
 * A driver silhouette from the game's band model: a full band is the pin's half-width; a reduced
 * band (groove/waist) is narrowed by its `grooveDepth` (a fraction of the pin radius). This is the
 * exact same silhouette physlab's contact test reads — the two models agree on what a pin *is*.
 */
function driverBuilder(prof: DriverProfile): (pinHalf: number) => LabBand[] {
  return (pinHalf) =>
    prof.bands.map((b) => ({ len: b.length, half: b.reduced ? pinHalf * (1 - b.grooveDepth) : pinHalf }))
}

/** Build a physlab lab from a pin-tumbler `LockDef` + tool config. */
export function labFromLock(def: LockDef, seed: number, _config: SimConfig): LabState {
  if (def.family !== 'pin-tumbler') {
    throw new Error(`physlab adapter is pin-tumbler only; got '${def.family}'`)
  }
  const chambers: ChamberSpec[] = def.pins.map((pinName, i) => ({
    kind: labKind(pinName),
    // setLift = 5 − K (the game's reachable band); physlab setLift = -(FLOOR_Y + keyLen) = 6 − keyLen.
    keyLen: 1 + (def.bitting[i] ?? 3),
    driver: driverBuilder(profileByName(pinName)),
  }))
  return createLab({ chambers, seed, toleranceQuality: def.toleranceQuality, tool: 'hook' })
}

/** How a physlab chamber reads as one of the game's five `ChamberState`s. */
function chamberState(c: Chamber): ChamberState {
  if (c.caught) return 'SET'
  if (c.overset) return 'OVERSET'
  if (c.counterForce > 0.02) return 'FALSE_SET' // walled at a spool foot
  // `pinch`, not `binding`: the model knows which pin *would* bind first from clearance alone, at
  // rest and with no wrench on the plug. A pin is only being leaned on when something is turning.
  if (c.pinch > 0) return 'BINDING'
  return 'FREE'
}

/** The `SimState`-shaped read model the game's renderers/HUD/logic consume. */
export interface SimView {
  readonly chambers: readonly {
    readonly state: ChamberState
    /** The driver's lift — what the physics is about. */
    readonly lift: number
    /** The key pin's own lift, which falls away beneath a driver the lock is holding. */
    readonly keyLift: number
  }[]
  readonly tension: number
  readonly theta: number
  readonly binding: number
  readonly pickChamber: number
  readonly resistance: number
  readonly opened: boolean
}

export function readView(lab: LabState): SimView {
  return {
    chambers: lab.chambers.map((c) => ({ state: chamberState(c), lift: c.lift, keyLift: c.keyLift })),
    tension: lab.tension,
    theta: lab.theta,
    binding: lab.binding,
    pickChamber: lab.pickChamber,
    resistance: lab.resistance,
    opened: lab.opened,
  }
}

/** Synthesise the game's `SimEvent`s from a state transition. */
export function diffEvents(prev: SimView, lab: LabState): SimEvent[] {
  const now = readView(lab)
  const time = lab.time
  const events: SimEvent[] = []
  const dropped: number[] = []
  now.chambers.forEach((c, i) => {
    const was = prev.chambers[i]!.state
    if (c.state === was) return
    if (c.state === 'SET') events.push({ type: 'PIN_SET', chamber: i, tension: now.tension, time })
    else if (c.state === 'OVERSET') events.push({ type: 'PIN_OVERSET', chamber: i, time })
    else if (c.state === 'FALSE_SET') {
      events.push({ type: 'FALSE_SET_ENTERED', chamber: i, depth: lab.chambers[i]!.counterForce, time })
    }
    if (was === 'SET') dropped.push(i)
  })
  if (dropped.length > 0) {
    const kind = now.chambers.every((c) => c.state !== 'SET') ? 'full' : 'counter'
    events.push({ type: 'RESET', kind, dropped, time })
  }
  if (now.pickChamber !== prev.pickChamber) {
    events.push({ type: 'PICK_MOVED', from: prev.pickChamber, to: now.pickChamber, time })
  }
  if (now.opened && !prev.opened) events.push({ type: 'LOCK_OPENED', time, ticks: Math.round(time / DT) })
  return events
}

/** Translate one frame of game intent into physlab tool input. */
function toLabInput(input: SimInput): LabInput {
  const toolX = input.chamber < 0 ? -99 : input.chamber * PITCH
  return {
    toolX,
    // Command the hook crest to `liftTarget`: crest = toolLift + HOOK_HEIGHT should reach FLOOR + lift.
    toolLift: FLOOR_Y + input.liftTarget - HOOK_HEIGHT,
    tension: input.tensionHeld ? input.tensionLevel : 0,
  }
}

/** Advance the lab from a game `SimInput`, returning the events that fired. */
export function stepFromSim(lab: LabState, input: SimInput): SimEvent[] {
  const prev = readView(lab)
  step(lab, toLabInput(input))
  return diffEvents(prev, lab)
}

/** Lift that puts the hook crest under a chamber at the height needed to reach `targetLift`. */
function hookLiftFor(targetLift: number): number {
  return FLOOR_Y + targetLift - HOOK_HEIGHT
}

export interface LabSolveResult {
  readonly opened: boolean
  /** How many times it picked a chamber and worked it — the difficulty proxy, like `SolveResult`. */
  readonly rounds: number
  readonly events: SimEvent[]
}

/**
 * A physlab `solveLock` twin: work the pins tightest-clearance first, ease the wrench when a groove
 * walls the climb, turn the plug once all are set. Proves a lab is pickable and yields a difficulty
 * proxy — the role `src/sim`'s `solveLock` plays for the tuning loop.
 */
export function solveLab(lab: LabState, maxTicks = 24000): LabSolveResult {
  const events: SimEvent[] = []
  let easeUntil = -1
  let rounds = 0
  let committed = -1
  let stall = 0
  let lastLift = 0
  const drive = (toolX: number, toolLift: number, tension: number): void => {
    const prev = readView(lab)
    step(lab, { toolX, toolLift, tension })
    events.push(...diffEvents(prev, lab))
  }
  // A working tension above the spool back-out point, so grooves genuinely wall and must be eased —
  // the same choice a hand makes to hold set pins while a spool fights back.
  const WORK = 0.4
  /** Light enough that a cam out-torques it, heavy enough that a set pin keeps its ledge. */
  const EASE = 0.2
  for (let t = 0; t < maxTicks && !lab.opened && !lab.pickBroken; t += 1) {
    const uncaught = lab.chambers.filter((c) => !c.caught)
    if (uncaught.length === 0) {
      drive(-99, FLOOR_Y, WORK)
      continue
    }
    // Work the pin the plug is actually resting on (the binding one) and **commit** to it until it
    // sets. Clearance order alone is not bind order once grooves are involved — a serrated pin dips out
    // of binding every time its waist crosses the line — so we follow the live `binding` index when it
    // is valid, and fall back to the tightest-clearance uncaught pin otherwise. `stall` is a safety
    // net: if the committed pin makes no headway (and is not merely waiting out an ease), re-commit.
    const bindingOk = lab.binding >= 0 && !lab.chambers[lab.binding]!.caught
    if (committed < 0 || lab.chambers[committed]!.caught || stall > 1200) {
      committed = bindingOk
        ? lab.binding
        : uncaught.reduce((a, b) => (b.def.clearance < a.def.clearance ? b : a)).def.index
      rounds += 1
      stall = 0
    }
    const c = lab.chambers[committed]!
    if (c.counterForce > 0.02) easeUntil = t + 60
    const easing = t < easeUntil
    if (!easing && Math.abs(c.lift - lastLift) < 1e-4) stall += 1
    else stall = 0
    lastLift = c.lift
    const aim = Math.min(setLift(c) + 0.2, c.lift + 0.3)
    /**
     * The ease is a *lightening*, not a release — *"you very lightly let up and let it push back
     * while keeping enough tension as to not drop all the pins."*
     *
     * `EASE` sits above `T_SET_HOLD`, so the pins already on their ledges stay there, and well below
     * the counter-torque a cammed shoulder produces, so the plug still rolls back and the walled pin
     * still walks up. Easing all the way to 0.1 (which this did) drops the stack on the way past.
     */
    drive(c.def.boreX, hookLiftFor(aim), easing ? EASE : WORK)
  }
  return { opened: lab.opened, rounds, events }
}
