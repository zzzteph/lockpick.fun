/**
 * Input tapes and state snapshots.
 *
 * A tape is a compressed sequence of player intent: "hold this input for N ticks". It is
 * what the determinism tests replay, what the solver returns, and what a future replay
 * feature would store.
 */

import { step } from './step'
import { DT } from './constants'
import { cloneRng } from './rng'
import type { Chamber, SimEvent, SimInput, SimState } from './types'

export interface TapeSegment {
  readonly ticks: number
  readonly input: SimInput
}

export type InputTape = readonly TapeSegment[]

export function totalTicks(tape: InputTape): number {
  let n = 0
  for (const s of tape) n += s.ticks
  return n
}

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

function cloneChamber(c: Chamber): Chamber {
  return {
    index: c.index,
    kind: c.kind,
    inverted: c.inverted,
    row: c.row,
    magnetic: c.magnetic,
    keyPinLength: c.keyPinLength,
    driverLength: c.driverLength,
    profile: c.profile,
    setLift: c.setLift,
    captureWindow: c.captureWindow,
    delta: c.delta,
    maxLift: c.maxLift,
    lift: c.lift,
    keyLift: c.keyLift,
    state: c.state,
    geometry: c.geometry,
    bandAtShear: c.bandAtShear,
    captureTimer: c.captureTimer,
    belowHoldFor: c.belowHoldFor,
    counterForce: c.counterForce,
    resistanceBias: c.resistanceBias,
    springStrength: c.springStrength,
    dragFactor: c.dragFactor,
    hasFalseSet: c.hasFalseSet,
    falseGates: c.falseGates,
    sidebarGate: c.sidebarGate,
    sidebarWidth: c.sidebarWidth,
    sidebarAligned: c.sidebarAligned,
  }
}

export function cloneSimState(s: SimState): SimState {
  return {
    instance: s.instance,
    config: s.config,
    chambers: s.chambers.map(cloneChamber),
    tension: s.tension,
    tensionCommanded: s.tensionCommanded,
    tensionWobble: s.tensionWobble,
    pickWobble: s.pickWobble,
    theta: s.theta,
    thetaMax: s.thetaMax,
    thetaDemand: s.thetaDemand,
    thetaVelocity: s.thetaVelocity,
    bindingChamber: s.bindingChamber,
    sidebarDropped: s.sidebarDropped,
    pickChamber: s.pickChamber,
    pickPosition: s.pickPosition,
    resistance: s.resistance,
    pickForce: s.pickForce,
    pickContact: s.pickContact,
    pickStrain: s.pickStrain,
    pickBent: s.pickBent,
    pickBroken: s.pickBroken,
    opened: s.opened,
    time: s.time,
    ticks: s.ticks,
    belowMinHoldFor: s.belowMinHoldFor,
    engaged: s.engaged,
    plugFreeAnnounced: s.plugFreeAnnounced,
    rng: cloneRng(s.rng),
    events: s.events.slice(),
    stats: {
      setOrder: s.stats.setOrder.slice(),
      bindOrder: s.stats.bindOrder.slice(),
      oversets: s.stats.oversets,
      fullResets: s.stats.fullResets,
      feathers: s.stats.feathers,
      falseSetsEntered: s.stats.falseSetsEntered,
      maxCounterForce: s.stats.maxCounterForce,
      maxResistance: s.stats.maxResistance,
      maxTension: s.stats.maxTension,
      minTensionWhileHeld: s.stats.minTensionWhileHeld,
      elapsed: s.stats.elapsed,
    },
  }
}

/**
 * A canonical, exact string form of every mutable number in the state.
 *
 * Floats are written at full precision, not rounded — "byte-identical after 10,000 ticks"
 * means exactly that, and rounding here would hide precisely the drift the test exists to
 * catch. The event queue is excluded: it is a stream consumers drain at their own rate, not
 * part of the physical state.
 */
export function snapshotSimState(s: SimState): string {
  const parts: string[] = [
    `t=${s.time}`,
    `k=${s.ticks}`,
    `T=${s.tension}`,
    `Tc=${s.tensionCommanded}`,
    `Tw=${s.tensionWobble}`,
    `pw=${s.pickWobble}`,
    `th=${s.theta}`,
    `thm=${s.thetaMax}`,
    `thd=${s.thetaDemand}`,
    `thv=${s.thetaVelocity}`,
    `b=${s.bindingChamber}`,
    `sb=${s.sidebarDropped ? 1 : 0}`,
    `p=${s.pickChamber}/${s.pickPosition}`,
    `r=${s.resistance}`,
    `pf=${s.pickForce}`,
    `px=${s.pickStrain}/${s.pickBent ? 1 : 0}/${s.pickBroken ? 1 : 0}`,
    `o=${s.opened ? 1 : 0}`,
    `bmh=${s.belowMinHoldFor}`,
    `e=${s.engaged ? 1 : 0}`,
    `rng=${s.rng.a},${s.rng.b},${s.rng.c},${s.rng.d}`,
  ]
  for (const c of s.chambers) {
    parts.push(
      `c${c.index}:${c.lift}/${c.keyLift}/${c.state}/${c.geometry}/${c.bandAtShear}/${c.captureTimer}/` +
        `${c.counterForce}/${c.sidebarAligned ? 1 : 0}`,
    )
  }
  parts.push(
    `so=${s.stats.setOrder.join('.')}`,
    `bo=${s.stats.bindOrder.join('.')}`,
    `ov=${s.stats.oversets}`,
    `fr=${s.stats.fullResets}`,
    `fe=${s.stats.feathers}`,
    `fs=${s.stats.falseSetsEntered}`,
  )
  return parts.join('|')
}

/** Count events of a given type in a drained list. */
export function countEvents(events: readonly SimEvent[], type: SimEvent['type']): number {
  let n = 0
  for (const e of events) if (e.type === type) n += 1
  return n
}

/** Build a one-segment tape. */
export function hold(input: SimInput, ticks: number): TapeSegment {
  return { ticks, input }
}

/** Seconds -> whole ticks, at least one. */
export function seconds(s: number): number {
  return Math.max(1, Math.round(s / DT))
}
