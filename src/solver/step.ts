/**
 * `step(state, input, dt)` — one fixed frame, in substeps. Same shape as `src/sim`'s step so it
 * can later sit behind `SimState`.
 */

import { generateContacts } from './contacts'
import { placePick, placePin, placePinSide, transformPlug } from './geometry'
import { DT } from './params'
import {
  correctPositions,
  decayStaleSlots,
  integratePositions,
  solveVelocities,
  updateStiction,
  warmStart,
} from './solve'
import { BODY_PICK, BODY_PLUG, DOF, KIND_PIN, type SolverInput, type SolverState } from './types'

export function applyForces(s: SolverState): void {
  const P = s.params
  const b = s.bodies
  const f = b.f
  const q = b.q
  f.fill(0)

  // wrench
  f[BODY_PLUG * DOF] = s.input.tension * P.maxTorque

  for (let i = 0; i < s.chambers.length; i += 1) {
    const ch = s.chambers[i]!
    const d = ch.driver.body * DOF
    const k = ch.key.body * DOF
    // spring on the driver's top, pushing straight down the housing bore
    const phi = q[d + 2]!
    const topU = ch.driver.topU
    const topY = q[d + 1]! + topU * Math.cos(phi)
    const rx = -topU * Math.sin(phi)
    let F = P.springPreload + P.springK * (topY - ch.restTopY)
    if (F < 0) F = 0
    f[d + 1] = f[d + 1]! - F
    f[d + 2] = f[d + 2]! - F * rx
    // weight
    f[d + 1] = f[d + 1]! - P.pinGravity
    f[k + 1] = f[k + 1]! - P.pinGravity
    // the pick gun's blade, shoving this key pin up (zero unless a strike is on)
    f[k + 1] = f[k + 1]! + s.strikeForce[i]!
  }
}

/**
 * Symplectic Euler on every free DOF. Springs and damping are explicit *forces* here on purpose:
 * an implicitly damped velocity hides part of an applied force from the contact solve, and a
 * blocked blade then pushes on a pin with a fraction of what its bend says it should. Masses are
 * chosen in `params` so every spring has ω·h < 1 and every damper c·h/m < 1, which is all explicit
 * integration needs.
 */
export function integrateVelocities(s: SolverState, h: number): void {
  const P = s.params
  const b = s.bodies
  const { q, v, f, invM, damp } = b
  const n = b.n
  const inp = s.input
  for (let body = 0; body < n; body += 1) {
    const o = body * DOF
    const isPick = body === BODY_PICK
    for (let k = 0; k < DOF; k += 1) {
      const im = invM[o + k]!
      if (im === 0) continue
      let force = f[o + k]! - damp[o + k]! * v[o + k]!
      if (isPick) {
        const kk = k === 0 || k === 1 ? P.handK : k === 2 ? P.handKRot : P.bendK
        const t = k === 0 ? inp.handX : k === 1 ? inp.handY : k === 2 ? inp.handAngle : 0
        let spring = -kk * (q[o + k]! - t)
        if (k < 2) {
          if (spring > P.handMaxForce) spring = P.handMaxForce
          else if (spring < -P.handMaxForce) spring = -P.handMaxForce
        }
        force += spring
      }
      v[o + k] = v[o + k]! + im * force * h
    }
    // Speed caps: a safety net against tunnelling, sized so contacts still carry real forces.
    if (b.kind[body] === KIND_PIN) {
      const vx = v[o]!
      const vy = v[o + 1]!
      const sp = Math.hypot(vx, vy)
      if (sp > P.pinMaxSpeed) {
        v[o] = (vx * P.pinMaxSpeed) / sp
        v[o + 1] = (vy * P.pinMaxSpeed) / sp
      }
      const w = v[o + 2]!
      if (w > P.pinMaxSpin) v[o + 2] = P.pinMaxSpin
      else if (w < -P.pinMaxSpin) v[o + 2] = -P.pinMaxSpin
    } else if (body === BODY_PLUG) {
      const w = v[o]!
      if (w > P.plugMaxRate) v[o] = P.plugMaxRate
      else if (w < -P.plugMaxRate) v[o] = -P.plugMaxRate
    } else if (isPick) {
      const sp = Math.hypot(v[o]!, v[o + 1]!)
      if (sp > P.pickMaxSpeed) {
        v[o] = (v[o]! * P.pickMaxSpeed) / sp
        v[o + 1] = (v[o + 1]! * P.pickMaxSpeed) / sp
      }
      if (v[o + 2]! > P.pickMaxRate) v[o + 2] = P.pickMaxRate
      else if (v[o + 2]! < -P.pickMaxRate) v[o + 2] = -P.pickMaxRate
      if (v[o + 3]! > P.bendMaxRate) v[o + 3] = P.bendMaxRate
      else if (v[o + 3]! < -P.bendMaxRate) v[o + 3] = -P.bendMaxRate
    }
  }
}

/** World polygons and plug features from the current positions. */
export function updateKinematics(s: SolverState): void {
  const q = s.bodies.q
  const theta = q[BODY_PLUG * DOF]!
  s.plugCos = Math.cos(theta)
  s.plugSin = Math.sin(theta)
  transformPlug(s.params, s.plugSegsLocal, s.plugSegs, s.plugCornersLocal, s.plugCorners, s.plugCos, s.plugSin)
  for (let i = 0; i < s.chambers.length; i += 1) {
    const ch = s.chambers[i]!
    const k = ch.key.body * DOF
    const d = ch.driver.body * DOF
    placePin(ch.key, q[k]!, q[k + 1]!, q[k + 2]!)
    placePin(ch.driver, q[d]!, q[d + 1]!, q[d + 2]!)
    placePinSide(ch.key, ch.x, q[k + 1]!)
  }
  const o = BODY_PICK * DOF
  placePick(s.pick, q[o]!, q[o + 1]!, q[o + 2]!, q[o + 3]!)
}

/** Advance one fixed frame. Mutates and returns `state`. */
export function step(s: SolverState, input: SolverInput, dt: number = DT): SolverState {
  const P = s.params
  s.input.tension = input.tension < 0 ? 0 : input.tension > 1 ? 1 : input.tension
  s.input.handX = input.handX
  s.input.handY = input.handY
  s.input.handAngle = input.handAngle
  const h = dt / P.substeps
  s.h = h
  for (let sub = 0; sub < P.substeps; sub += 1) {
    applyForces(s)
    integrateVelocities(s, h)
    updateKinematics(s)
    generateContacts(s)
    decayStaleSlots(s)
    warmStart(s)
    solveVelocities(s, h, P.velocityIterations)
    updateStiction(s)
    integratePositions(s, h)
    correctPositions(s, P.positionIterations)
  }
  updateKinematics(s)
  s.time += dt
  s.frame += 1
  return s
}

export function stepTicks(s: SolverState, input: SolverInput, n: number, dt: number = DT): SolverState {
  for (let i = 0; i < n; i += 1) step(s, input, dt)
  return s
}
