/**
 * The constraint solver: sequential impulses with warm starting, Coulomb friction with a real
 * stick/slip state per contact, and a position pass that removes what penetration is left.
 *
 * Friction is the point of this file. A contact that is not sliding is held at zero tangential
 * velocity by whatever impulse that takes, up to μ_s·N; once it breaks loose the cap drops to
 * μ_k·N and stays there until the contact comes to rest again. That hysteresis is what lets a set
 * driver sit on a sloping ledge and a wedged spool hold its false set.
 *
 * The loops are written flat — arrays hoisted, the four DOFs unrolled — because this is the hot
 * path: ~30k contact-iterations a frame on a six-pin lock.
 */

import { DOF, type SolverState } from './types'

export function warmStart(s: SolverState): void {
  const c = s.contacts
  const v = s.bodies.v
  const invM = s.bodies.invM
  const { a: A, b: B, slot: S, ja, jb, ta, tb, lamN, lamT } = c
  for (let i = 0; i < c.count; i += 1) {
    const slot = S[i]!
    const ln = lamN[slot]!
    const lt = lamT[slot]!
    if (ln === 0 && lt === 0) continue
    const a = A[i]! * DOF
    const b = B[i]! * DOF
    const o = i * DOF
    v[a] = v[a]! + invM[a]! * (ja[o]! * ln + ta[o]! * lt)
    v[a + 1] = v[a + 1]! + invM[a + 1]! * (ja[o + 1]! * ln + ta[o + 1]! * lt)
    v[a + 2] = v[a + 2]! + invM[a + 2]! * (ja[o + 2]! * ln + ta[o + 2]! * lt)
    v[a + 3] = v[a + 3]! + invM[a + 3]! * (ja[o + 3]! * ln + ta[o + 3]! * lt)
    v[b] = v[b]! - invM[b]! * (jb[o]! * ln + tb[o]! * lt)
    v[b + 1] = v[b + 1]! - invM[b + 1]! * (jb[o + 1]! * ln + tb[o + 1]! * lt)
    v[b + 2] = v[b + 2]! - invM[b + 2]! * (jb[o + 2]! * ln + tb[o + 2]! * lt)
    v[b + 3] = v[b + 3]! - invM[b + 3]! * (jb[o + 3]! * ln + tb[o + 3]! * lt)
  }
}

export function solveVelocities(s: SolverState, h: number, iterations: number): void {
  const c = s.contacts
  const v = s.bodies.v
  const invM = s.bodies.invM
  const { a: A, b: B, slot: S, ja, jb, ta, tb, gap, mN, mT, mus, muk, lamN, lamT, sliding } = c
  const n = c.count
  const invH = 1 / h
  for (let it = 0; it < iterations; it += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = A[i]! * DOF
      const b = B[i]! * DOF
      const o = i * DOF
      const slot = S[i]!
      const ja0 = ja[o]!
      const ja1 = ja[o + 1]!
      const ja2 = ja[o + 2]!
      const ja3 = ja[o + 3]!
      const jb0 = jb[o]!
      const jb1 = jb[o + 1]!
      const jb2 = jb[o + 2]!
      const jb3 = jb[o + 3]!
      let va0 = v[a]!
      let va1 = v[a + 1]!
      let va2 = v[a + 2]!
      let va3 = v[a + 3]!
      let vb0 = v[b]!
      let vb1 = v[b + 1]!
      let vb2 = v[b + 2]!
      let vb3 = v[b + 3]!

      // ── friction first, so the normal is solved last and most exactly ──
      const ln0 = lamN[slot]!
      const mt = mT[i]!
      if (ln0 > 0 && mt > 0) {
        const ta0 = ta[o]!
        const ta1 = ta[o + 1]!
        const ta2 = ta[o + 2]!
        const ta3 = ta[o + 3]!
        const tb0 = tb[o]!
        const tb1 = tb[o + 1]!
        const tb2 = tb[o + 2]!
        const tb3 = tb[o + 3]!
        const vt =
          ta0 * va0 + ta1 * va1 + ta2 * va2 + ta3 * va3 - (tb0 * vb0 + tb1 * vb1 + tb2 * vb2 + tb3 * vb3)
        const max = (sliding[slot] === 0 ? mus[i]! : muk[i]!) * ln0
        const old = lamT[slot]!
        let next = old - mt * vt
        if (next > max) next = max
        else if (next < -max) next = -max
        const d = next - old
        if (d !== 0) {
          lamT[slot] = next
          va0 += invM[a]! * ta0 * d
          va1 += invM[a + 1]! * ta1 * d
          va2 += invM[a + 2]! * ta2 * d
          va3 += invM[a + 3]! * ta3 * d
          vb0 -= invM[b]! * tb0 * d
          vb1 -= invM[b + 1]! * tb1 * d
          vb2 -= invM[b + 2]! * tb2 * d
          vb3 -= invM[b + 3]! * tb3 * d
        }
      }

      // ── normal: close the gap this substep, never faster ──
      const vn = ja0 * va0 + ja1 * va1 + ja2 * va2 + ja3 * va3 - (jb0 * vb0 + jb1 * vb1 + jb2 * vb2 + jb3 * vb3)
      const g = gap[i]!
      const target = g > 0 ? -g * invH : 0
      const old = lamN[slot]!
      let next = old - mN[i]! * (vn - target)
      if (next < 0) next = 0
      const d = next - old
      if (d !== 0) {
        lamN[slot] = next
        va0 += invM[a]! * ja0 * d
        va1 += invM[a + 1]! * ja1 * d
        va2 += invM[a + 2]! * ja2 * d
        va3 += invM[a + 3]! * ja3 * d
        vb0 -= invM[b]! * jb0 * d
        vb1 -= invM[b + 1]! * jb1 * d
        vb2 -= invM[b + 2]! * jb2 * d
        vb3 -= invM[b + 3]! * jb3 * d
      }
      v[a] = va0
      v[a + 1] = va1
      v[a + 2] = va2
      v[a + 3] = va3
      v[b] = vb0
      v[b + 1] = vb1
      v[b + 2] = vb2
      v[b + 3] = vb3
    }
  }
}

/** Decide, per contact, whether it is now sliding or stuck. */
export function updateStiction(s: SolverState): void {
  const c = s.contacts
  const v = s.bodies.v
  const stick = s.params.stickSpeed
  const { a: A, b: B, slot: S, ta, tb, mus, muk, lamN, lamT, sliding } = c
  for (let i = 0; i < c.count; i += 1) {
    const slot = S[i]!
    const ln = lamN[slot]!
    if (ln <= 0) {
      sliding[slot] = 0
      lamT[slot] = 0
      continue
    }
    const a = A[i]! * DOF
    const b = B[i]! * DOF
    const o = i * DOF
    const vt =
      ta[o]! * v[a]! +
      ta[o + 1]! * v[a + 1]! +
      ta[o + 2]! * v[a + 2]! +
      ta[o + 3]! * v[a + 3]! -
      (tb[o]! * v[b]! + tb[o + 1]! * v[b + 1]! + tb[o + 2]! * v[b + 2]! + tb[o + 3]! * v[b + 3]!)
    const mu = sliding[slot] === 0 ? mus[i]! : muk[i]!
    const saturated = Math.abs(lamT[slot]!) >= mu * ln * 0.999
    if (saturated && Math.abs(vt) > stick) sliding[slot] = 1
    else if (Math.abs(vt) < stick * 0.5) sliding[slot] = 0
  }
}

/** Forget every accumulated impulse on slots that were not live this substep. */
export function decayStaleSlots(s: SolverState): void {
  const c = s.contacts
  const live = c.liveMark
  const used = c.slotsUsed
  live.fill(0, 0, used)
  for (let i = 0; i < c.count; i += 1) live[c.slot[i]!] = 1
  const { lamN, lamT, sliding } = c
  for (let slot = 0; slot < used; slot += 1) {
    if (live[slot] === 0 && (lamN[slot] !== 0 || lamT[slot] !== 0 || sliding[slot] !== 0)) {
      lamN[slot] = 0
      lamT[slot] = 0
      sliding[slot] = 0
    }
  }
}

export function integratePositions(s: SolverState, h: number): void {
  const b = s.bodies
  const n = b.n * DOF
  const { q, v, invM } = b
  for (let i = 0; i < n; i += 1) {
    if (invM[i]! > 0) q[i] = q[i]! + v[i]! * h
  }
}

/** Non-linear Gauss–Seidel on positions: push out whatever penetration the velocity pass left. */
export function correctPositions(s: SolverState, iterations: number): void {
  const c = s.contacts
  const { q, q0, invM } = s.bodies
  const { a: A, b: B, ja, jb, gap, mN } = c
  const slop = s.params.slop
  const n = c.count
  for (let it = 0; it < iterations; it += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = A[i]! * DOF
      const b = B[i]! * DOF
      const o = i * DOF
      const ja0 = ja[o]!
      const ja1 = ja[o + 1]!
      const ja2 = ja[o + 2]!
      const ja3 = ja[o + 3]!
      const jb0 = jb[o]!
      const jb1 = jb[o + 1]!
      const jb2 = jb[o + 2]!
      const jb3 = jb[o + 3]!
      const sep =
        gap[i]! +
        ja0 * (q[a]! - q0[a]!) +
        ja1 * (q[a + 1]! - q0[a + 1]!) +
        ja2 * (q[a + 2]! - q0[a + 2]!) +
        ja3 * (q[a + 3]! - q0[a + 3]!) -
        (jb0 * (q[b]! - q0[b]!) +
          jb1 * (q[b + 1]! - q0[b + 1]!) +
          jb2 * (q[b + 2]! - q0[b + 2]!) +
          jb3 * (q[b + 3]! - q0[b + 3]!))
      const pen = -sep - slop
      if (pen <= 0) continue
      const d = pen * 0.6 * mN[i]!
      q[a] = q[a]! + invM[a]! * ja0 * d
      q[a + 1] = q[a + 1]! + invM[a + 1]! * ja1 * d
      q[a + 2] = q[a + 2]! + invM[a + 2]! * ja2 * d
      q[a + 3] = q[a + 3]! + invM[a + 3]! * ja3 * d
      q[b] = q[b]! - invM[b]! * jb0 * d
      q[b + 1] = q[b + 1]! - invM[b + 1]! * jb1 * d
      q[b + 2] = q[b + 2]! - invM[b + 2]! * jb2 * d
      q[b + 3] = q[b + 3]! - invM[b + 3]! * jb3 * d
    }
  }
}
