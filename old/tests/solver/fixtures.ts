/**
 * Shared scaffolding for the solver's behaviour tests: locks, scripted drives, readouts.
 */

import {
  DT,
  plugReactionTorque,
  HOOK,
  STANDARD,
  aimTip,
  makeInput,
  plugAngle,
  readChamber,
  readPick,
  step,
  type LockDef,
  type PickProfile,
  type PinProfile,
  type SolverInput,
  type SolverState,
} from '../../src/solver'

export const DEG = Math.PI / 180

/**
 * Key lengths that put the driver's bottom where a test wants it. With the cone tip the key top
 * at rest sits at `K - 4.08`; 3.0 puts a driver's foot 1.1 mm under the shear line (a plain bind),
 * 2.0 puts a spool's waist across it (a false set on tension alone).
 */
export const K_STANDARD = 3.0
export const K_SPOOL = 2.0

export function oneChamber(driver: PinProfile = STANDARD, keyLength = K_STANDARD, pick: PickProfile = HOOK): LockDef {
  return { chambers: [{ keyLength, driver, delta: 0 }], pick }
}

export function lock(
  drivers: readonly PinProfile[],
  deltas: readonly number[],
  keyLengths: readonly number[] = drivers.map(() => K_STANDARD),
  pick: PickProfile = HOOK,
): LockDef {
  return {
    chambers: drivers.map((driver, i) => ({ keyLength: keyLengths[i]!, driver, delta: deltas[i]! })),
    pick,
  }
}

/** The pick parked outside the mouth. */
export function parked(s: SolverState, tension: number): SolverInput {
  return makeInput(tension, aimTip(s, -4, (s.params.keywayFloorY + s.params.keywayCeilY) / 2))
}

/** The tip aimed at chamber i, `lift` mm above the key pin's resting tip. */
export function atChamber(s: SolverState, i: number, lift: number, tension: number, dx = -0.3): SolverInput {
  const ch = s.chambers[i]!
  const P = s.params
  const tipRest = ch.keyRestY + ch.key.bottomU
  return makeInput(tension, aimTip(s, ch.x + dx, tipRest + lift - P.slop))
}

/**
 * Move the hand target from where it is to `to` over `seconds`, then hold. A hand does not
 * teleport; ramping keeps the pick under the speed caps and the tests honest.
 */
export function glide(s: SolverState, to: SolverInput, seconds: number, hold = 0): void {
  const from = { ...s.input }
  const n = Math.max(1, Math.round(seconds / DT))
  const cur = { ...from }
  for (let i = 1; i <= n; i += 1) {
    const u = i / n
    cur.tension = from.tension + (to.tension - from.tension) * u
    cur.handX = from.handX + (to.handX - from.handX) * u
    cur.handY = from.handY + (to.handY - from.handY) * u
    cur.handAngle = from.handAngle + (to.handAngle - from.handAngle) * u
    step(s, cur)
  }
  if (hold > 0) run(s, to, hold)
}

export function run(s: SolverState, input: SolverInput, seconds: number): void {
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i += 1) step(s, input)
}

/** Run until `done` or the time is up; returns the seconds it took, or -1. */
export function runUntil(s: SolverState, input: SolverInput, seconds: number, done: () => boolean): number {
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i += 1) {
    step(s, input)
    if (done()) return (i + 1) * DT
  }
  return -1
}

export function deg(rad: number): number {
  return rad / DEG
}

export function snapshot(s: SolverState, i = 0): string {
  const c = readChamber(s, i)
  const p = readPick(s)
  return [
    `t=${s.time.toFixed(3)}s`,
    `θ=${deg(plugAngle(s)).toFixed(3)}°`,
    `key lift=${c.keyLift.toFixed(3)} X=${c.keyX.toFixed(3)} cant=${deg(c.keyCant).toFixed(2)}°`,
    `drv lift=${c.driverLift.toFixed(3)} X=${c.driverX.toFixed(3)} cant=${deg(c.driverCant).toFixed(2)}° clear=${c.driverClearance.toFixed(3)}`,
    `F plug=${c.plugForce.toFixed(2)} housing=${c.housingForce.toFixed(2)} pick=${c.pickForce.toFixed(2)} τr=${plugReactionTorque(s).toFixed(1)}`,
    `tip=(${p.tipX.toFixed(2)},${p.tipY.toFixed(2)}) bend=${p.bendDeflection.toFixed(3)} err=${p.tipError.toFixed(3)}`,
    `contacts=${s.contacts.count} deep=${s.contacts.deep}`,
  ].join(' | ')
}
