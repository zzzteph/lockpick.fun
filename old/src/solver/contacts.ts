/**
 * Contact generation — an analytic candidate set, not a broadphase.
 *
 * Every candidate pair is visited in the same order every substep and given a running slot
 * number, so a pair's accumulated impulses and its stick/slip state survive from one substep to
 * the next without a lookup. Only pairs within `margin` become live contacts (speculative: a
 * contact is allowed to close its remaining gap this substep, and no further).
 *
 * Convention: a contact's normal points from body B toward body A; the constraint is that the
 * relative velocity of the contact point along n is at least -gap/h.
 */

import { inBounds, pointInPolygon } from './geometry'
import {
  BODY_PLUG,
  BODY_STATIC,
  BODY_PICK,
  CLS_FLOOR,
  CLS_HOUSING_LEDGE,
  CLS_HOUSING_RIM,
  CLS_HOUSING_WALL,
  CLS_KEYWAY,
  CLS_MOUTH,
  CLS_PICK_PIN,
  CLS_PIN_PIN,
  CLS_PLUG_LEDGE,
  CLS_PLUG_RIM,
  CLS_PLUG_STOP,
  CLS_PLUG_WALL,
  DOF,
  KIND_PICK,
  KIND_PIN,
  KIND_PLUG,
  PLANE_CHAMBER,
  PLANE_CUTAWAY,
  type Chamber,
  type PinBody,
  type SolverState,
} from './types'

/** Jacobian of the contact-point velocity along direction d for `body`, into out[o..o+3]. */
function jac(
  s: SolverState,
  body: number,
  plane: number,
  px: number,
  py: number,
  dx: number,
  dy: number,
  out: Float64Array,
  o: number,
): void {
  const b = s.bodies
  const kind = b.kind[body]!
  out[o] = 0
  out[o + 1] = 0
  out[o + 2] = 0
  out[o + 3] = 0
  if (kind === KIND_PLUG) {
    // Rotation about the pivot (0, -R): v = ω × r.
    const rx = px
    const ry = py + s.params.plugRadius
    out[o] = rx * dy - ry * dx
  } else if (kind === KIND_PIN) {
    if (plane === PLANE_CHAMBER) {
      const cx = b.q[body * DOF]!
      const cy = b.q[body * DOF + 1]!
      out[o] = dx
      out[o + 1] = dy
      out[o + 2] = (px - cx) * dy - (py - cy) * dx
    } else {
      // In the cutaway the pin only moves up and down.
      out[o + 1] = dy
    }
  } else if (kind === KIND_PICK) {
    const cx = b.q[body * DOF]!
    const cy = b.q[body * DOF + 1]!
    const a = b.q[body * DOF + 2]!
    out[o] = dx
    out[o + 1] = dy
    out[o + 2] = (px - cx) * dy - (py - cy) * dx
    const fx = s.pick.flexWX
    const fy = s.pick.flexWY
    // Past the flex point, the blade's bend moves the point too.
    if ((px - fx) * Math.cos(a) + (py - fy) * Math.sin(a) > 0) {
      out[o + 3] = (px - fx) * dy - (py - fy) * dx
    }
  }
}

function add(
  s: SolverState,
  a: number,
  b: number,
  plane: number,
  slot: number,
  cls: number,
  chamber: number,
  px: number,
  py: number,
  nx: number,
  ny: number,
  gap: number,
  mus: number,
  muk: number,
): void {
  const c = s.contacts
  const i = c.count
  if (i >= c.cap) {
    c.overflow += 1
    return
  }
  const bodies = s.bodies
  const o = i * DOF
  jac(s, a, plane, px, py, nx, ny, c.ja, o)
  jac(s, b, plane, px, py, nx, ny, c.jb, o)
  jac(s, a, plane, px, py, -ny, nx, c.ta, o)
  jac(s, b, plane, px, py, -ny, nx, c.tb, o)
  let kn = 0
  let kt = 0
  for (let k = 0; k < DOF; k += 1) {
    const ia = bodies.invM[a * DOF + k]!
    const ib = bodies.invM[b * DOF + k]!
    kn += c.ja[o + k]! * c.ja[o + k]! * ia + c.jb[o + k]! * c.jb[o + k]! * ib
    kt += c.ta[o + k]! * c.ta[o + k]! * ia + c.tb[o + k]! * c.tb[o + k]! * ib
  }
  if (!(kn > 0)) return
  c.a[i] = a
  c.b[i] = b
  c.slot[i] = slot
  c.cls[i] = cls
  c.chamber[i] = chamber
  c.gap[i] = gap
  c.mN[i] = 1 / kn
  c.mT[i] = kt > 0 ? 1 / kt : 0
  c.mus[i] = mus
  c.muk[i] = muk
  c.px[i] = px
  c.py[i] = py
  c.nx[i] = nx
  c.ny[i] = ny
  c.count = i + 1
}

/** Up to four hits from one query: nx, ny, gap per hit. */
const hits = new Float64Array(4 * 3)
let hitCount = 0
/** Penetrations deeper than `margin` seen this substep — ignored, but a sign something tunnelled. */
let deep = 0
/** Where they were ((body, x, y) triples, world), for whoever wants to know what tunnelled. */
let deepPts: number[] = []
/** The body whose vertex, or whose polygon, is being tested — for `deepPts`. */
let deepTag = -1

function pushHit(nx: number, ny: number, gap: number): void {
  if (hitCount >= 4) return
  hits[hitCount * 3] = nx
  hits[hitCount * 3 + 1] = ny
  hits[hitCount * 3 + 2] = gap
  hitCount += 1
}

/**
 * Vertex p against a lone segment a→b whose free-space normal is n. Over the face the gap is the
 * signed distance; past either end the closest feature is the endpoint and the normal is radial
 * from it (the corner is treated as rounded). Fills `hits`.
 */
function vertexVsSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  nx: number,
  ny: number,
  margin: number,
  closed = true,
): void {
  hitCount = 0
  const ex = bx - ax
  const ey = by - ay
  const len2 = ex * ex + ey * ey
  const t = ((px - ax) * ex + (py - ay) * ey) / len2
  if (t <= 0 || t >= 1) {
    const cx = t <= 0 ? ax : bx
    const cy = t <= 0 ? ay : by
    const dx = px - cx
    const dy = py - cy
    const dist = Math.hypot(dx, dy)
    if (dist >= margin || dist < 1e-9) return
    // Only the free-space side of the corner counts.
    if (dx * nx + dy * ny < 0) return
    pushHit(dx / dist, dy / dist, dist)
    return
  }
  const gap = (px - ax) * nx + (py - ay) * ny
  if (gap >= margin) return
  if (gap < -margin) {
    // Behind a closed solid's surface by more than the margin: something tunnelled. Behind a
    // lone face (the lock's front) it just means the point is inside the lock, which is fine.
    if (closed) {
      deep += 1
      if (deepPts.length < 48) deepPts.push(deepTag, px, py)
    }
    return
  }
  pushHit(nx, ny, gap)
}

/**
 * Corner q against a polygon W (or the subset `edges` of its edges). Outside the polygon every
 * face or rounded vertex within `margin` is a hit. Inside, only the nearest face is — a point on
 * the boundary is "inside" too, and measuring it against every face it happens to project onto
 * is how a slot lip resting on a cone once launched a key pin 4 mm. Fills `hits`.
 */
function cornerVsPolygon(
  qx: number,
  qy: number,
  W: Float64Array,
  count: number,
  edges: Int32Array | null,
  margin: number,
): void {
  hitCount = 0
  const inside = pointInPolygon(qx, qy, W, count)
  let bestDist = margin
  let bestNx = 0
  let bestNy = 0
  const m = edges === null ? count : edges.length
  for (let idx = 0; idx < m; idx += 1) {
    const e = edges === null ? idx : edges[idx]!
    const j = (e + 1) % count
    const ax = W[e * 2]!
    const ay = W[e * 2 + 1]!
    const ex = W[j * 2]! - ax
    const ey = W[j * 2 + 1]! - ay
    const len2 = ex * ex + ey * ey
    if (len2 < 1e-12) continue
    const len = Math.sqrt(len2)
    const nx = ey / len
    const ny = -ex / len
    const t = ((qx - ax) * ex + (qy - ay) * ey) / len2
    if (t <= 0 || t >= 1) {
      if (inside) continue
      const cx = t <= 0 ? ax : ax + ex
      const cy = t <= 0 ? ay : ay + ey
      const dx = qx - cx
      const dy = qy - cy
      const dist = Math.hypot(dx, dy)
      if (dist >= margin || dist < 1e-9) continue
      if (dx * nx + dy * ny < 0) continue
      pushHit(dx / dist, dy / dist, dist)
    } else {
      const gap = (qx - ax) * nx + (qy - ay) * ny
      if (inside) {
        const dist = -gap
        if (dist >= 0 && dist < bestDist) {
          bestDist = dist
          bestNx = nx
          bestNy = ny
        }
      } else if (gap >= 0 && gap < margin) {
        pushHit(nx, ny, gap)
      }
    }
  }
  if (inside) {
    if (bestDist < margin) pushHit(bestNx, bestNy, -bestDist)
    else {
      deep += 1
      if (deepPts.length < 48) deepPts.push(deepTag, qx, qy)
    }
  }
}

function chamberContacts(s: SolverState, ch: Chamber, slot: number): number {
  const P = s.params
  const margin = P.margin
  const R = P.plugRadius
  const rimOut = P.boreRadius + P.rimChamfer
  const cos = s.plugCos
  const sin = s.plugSin
  const plugSegs = s.plugSegs
  const PS = plugSegs.data
  const HS = ch.housingSegs.data
  const xh = -ch.delta
  const mus = P.muStatic
  const muk = P.muKinetic
  const ci = ch.index

  for (let which = 0; which < 2; which += 1) {
    const pin: PinBody = which === 0 ? ch.key : ch.driver
    const W = pin.world
    const n = pin.count
    const body = pin.body
    deepTag = body

    // ── pin vertices vs plug segments, plug ledge, housing segments, housing underside ──
    // Pruned by side and height: a vertex on the right of the bore cannot touch the left wall,
    // one above the rim cannot touch the plug, one below it cannot touch the housing. Slots are
    // still counted for every candidate so their numbering stays stable.
    const rimY = s.rimY
    for (let i = 0; i < n; i += 1) {
      const px = W[i * 2]!
      const py = W[i * 2 + 1]!
      const right = px > 0
      const nearPlug = py < rimY + margin
      const nearHousing = py > rimY - margin
      // A vertex outside the plug's disc — a set driver's corner over the rim, above the curved
      // top — cannot be inside the plug: behind a wall's line there is air, not tunnelling.
      const inDisc = Math.hypot(px, py + R) < R
      for (let j = 0; j < plugSegs.count; j += 1) {
        slot += 1
        if (!nearPlug) continue
        // segments 0,1,4 are the right side; 2,3,5 the left
        if ((j === 0 || j === 1 || j === 4) !== right) continue
        const o = j * 6
        vertexVsSegment(px, py, PS[o]!, PS[o + 1]!, PS[o + 2]!, PS[o + 3]!, PS[o + 4]!, PS[o + 5]!, margin, inDisc)
        if (hitCount > 0) {
          const cls = j < 4 ? (j % 2 === 0 ? CLS_PLUG_WALL : CLS_PLUG_RIM) : CLS_FLOOR
          add(s, body, BODY_PLUG, PLANE_CHAMBER, slot, cls, ci, px, py, hits[0]!, hits[1]!, hits[2]!, mus, muk)
        }
      }
      // plug's outer circle (the ledge), outside the bore mouth, near the rim
      slot += 1
      {
        const ry = py + R
        const lx = px * cos + ry * sin
        if (Math.abs(lx) > rimOut && ry > R - 0.6) {
          const rho = Math.hypot(px, ry)
          const gap = rho - R
          if (gap < margin) {
            add(s, body, BODY_PLUG, PLANE_CHAMBER, slot, CLS_PLUG_LEDGE, ci, px, py, px / rho, ry / rho, gap, mus, muk)
          }
        }
      }
      for (let j = 0; j < ch.housingSegs.count; j += 1) {
        slot += 1
        if (!nearHousing) continue
        if ((j < 2) !== px > xh) continue
        const o = j * 6
        vertexVsSegment(px, py, HS[o]!, HS[o + 1]!, HS[o + 2]!, HS[o + 3]!, HS[o + 4]!, HS[o + 5]!, margin)
        if (hitCount > 0) {
          const cls = j % 2 === 0 ? CLS_HOUSING_WALL : CLS_HOUSING_RIM
          add(s, body, BODY_STATIC, PLANE_CHAMBER, slot, cls, ci, px, py, hits[0]!, hits[1]!, hits[2]!, mus, muk)
        }
      }
      // housing's underside, outside the housing bore mouth: a circle `shearGap` above the plug's
      slot += 1
      if (Math.abs(px - xh) > rimOut && py > -0.6) {
        const ry = py + R
        const rho = Math.hypot(px, ry)
        const gap = R + P.shearGap - rho
        if (gap < margin) {
          add(s, body, BODY_STATIC, PLANE_CHAMBER, slot, CLS_HOUSING_LEDGE, ci, px, py, -px / rho, -ry / rho, gap, mus, muk)
        }
      }
    }

    // ── plug corners and housing corners vs pin edges ──
    const PC = s.plugCorners.data
    for (let k = 0; k < s.plugCorners.count; k += 1) {
      const qx = PC[k * 2]!
      const qy = PC[k * 2 + 1]!
      if (!inBounds(pin.bounds, qx, qy, margin)) {
        slot += 4
        continue
      }
      cornerVsPolygon(qx, qy, W, n, null, margin)
      const cls = k < 4 ? CLS_PLUG_RIM : CLS_FLOOR
      for (let hh = 0; hh < 4; hh += 1) {
        slot += 1
        if (hh < hitCount) add(s, BODY_PLUG, body, PLANE_CHAMBER, slot, cls, ci, qx, qy, hits[hh * 3]!, hits[hh * 3 + 1]!, hits[hh * 3 + 2]!, mus, muk)
      }
    }
    const HC = ch.housingCorners.data
    for (let k = 0; k < ch.housingCorners.count; k += 1) {
      const qx = HC[k * 2]!
      const qy = HC[k * 2 + 1]!
      if (!inBounds(pin.bounds, qx, qy, margin)) {
        slot += 4
        continue
      }
      cornerVsPolygon(qx, qy, W, n, null, margin)
      for (let hh = 0; hh < 4; hh += 1) {
        slot += 1
        if (hh < hitCount) add(s, BODY_STATIC, body, PLANE_CHAMBER, slot, CLS_HOUSING_RIM, ci, qx, qy, hits[hh * 3]!, hits[hh * 3 + 1]!, hits[hh * 3 + 2]!, mus, muk)
      }
    }
  }

  // ── driver bottom vs key top ──
  const key = ch.key
  const drv = ch.driver
  for (let a = 0; a < drv.bottomVerts.length; a += 1) {
    const i = drv.bottomVerts[a]!
    const px = drv.world[i * 2]!
    const py = drv.world[i * 2 + 1]!
    if (!inBounds(key.bounds, px, py, margin)) {
      slot += 4
      continue
    }
    cornerVsPolygon(px, py, key.world, key.count, key.topEdges, margin)
    for (let hh = 0; hh < 4; hh += 1) {
      slot += 1
      if (hh < hitCount) add(s, drv.body, key.body, PLANE_CHAMBER, slot, CLS_PIN_PIN, ci, px, py, hits[hh * 3]!, hits[hh * 3 + 1]!, hits[hh * 3 + 2]!, mus, muk)
    }
  }
  for (let a = 0; a < key.topVerts.length; a += 1) {
    const i = key.topVerts[a]!
    const px = key.world[i * 2]!
    const py = key.world[i * 2 + 1]!
    if (!inBounds(drv.bounds, px, py, margin)) {
      slot += 4
      continue
    }
    cornerVsPolygon(px, py, drv.world, drv.count, drv.bottomEdges, margin)
    for (let hh = 0; hh < 4; hh += 1) {
      slot += 1
      if (hh < hitCount) add(s, key.body, drv.body, PLANE_CHAMBER, slot, CLS_PIN_PIN, ci, px, py, hits[hh * 3]!, hits[hh * 3 + 1]!, hits[hh * 3 + 2]!, mus, muk)
    }
  }
  return slot
}

function pickContacts(s: SolverState, slot: number): number {
  const P = s.params
  const margin = P.margin
  const pick = s.pick
  const W = pick.world
  const n = pick.count
  deepTag = BODY_PICK
  const KS = s.keywaySegs.data
  const mus = P.muPickStatic
  const muk = P.muPickKinetic

  // pick vertices vs keyway
  for (let i = 0; i < n; i += 1) {
    const px = W[i * 2]!
    const py = W[i * 2 + 1]!
    for (let j = 0; j < s.keywaySegs.count; j += 1) {
      slot += 1
      const o = j * 6
      vertexVsSegment(px, py, KS[o]!, KS[o + 1]!, KS[o + 2]!, KS[o + 3]!, KS[o + 4]!, KS[o + 5]!, margin, false)
      if (hitCount > 0) {
        add(s, BODY_PICK, BODY_STATIC, PLANE_CUTAWAY, slot, CLS_KEYWAY, -1, px, py, hits[0]!, hits[1]!, hits[2]!, mus, muk)
      }
    }
  }
  // keyway corners (mouth, ceiling ends) vs pick edges
  const KC = s.keywayCorners.data
  for (let k = 0; k < s.keywayCorners.count; k += 1) {
    const qx = KC[k * 2]!
    const qy = KC[k * 2 + 1]!
    if (!inBounds(pick.bounds, qx, qy, margin)) {
      slot += 4
      continue
    }
    cornerVsPolygon(qx, qy, W, n, null, margin)
    for (let hh = 0; hh < 4; hh += 1) {
      slot += 1
      if (hh < hitCount) add(s, BODY_STATIC, BODY_PICK, PLANE_CUTAWAY, slot, k < 2 ? CLS_MOUTH : CLS_KEYWAY, -1, qx, qy, hits[hh * 3]!, hits[hh * 3 + 1]!, hits[hh * 3 + 2]!, mus, muk)
    }
  }
  // pick vs every key pin's underside
  for (let c = 0; c < s.chambers.length; c += 1) {
    const ch = s.chambers[c]!
    const key = ch.key
    const S = key.side
    const near =
      pick.bounds[2]! + margin >= key.sideBounds[0]! &&
      pick.bounds[0]! - margin <= key.sideBounds[2]! &&
      pick.bounds[3]! + margin >= key.sideBounds[1]! &&
      pick.bounds[1]! - margin <= key.sideBounds[3]!
    if (!near) {
      slot += 4 * (n + key.lowerVerts.length)
      continue
    }
    for (let i = 0; i < n; i += 1) {
      const px = W[i * 2]!
      const py = W[i * 2 + 1]!
      if (!inBounds(key.sideBounds, px, py, margin)) {
        slot += 4
        continue
      }
      cornerVsPolygon(px, py, S, key.count, key.lowerEdges, margin)
      for (let hh = 0; hh < 4; hh += 1) {
        slot += 1
        if (hh < hitCount) add(s, BODY_PICK, key.body, PLANE_CUTAWAY, slot, CLS_PICK_PIN, c, px, py, hits[hh * 3]!, hits[hh * 3 + 1]!, hits[hh * 3 + 2]!, mus, muk)
      }
    }
    for (let a = 0; a < key.lowerVerts.length; a += 1) {
      const i = key.lowerVerts[a]!
      const qx = S[i * 2]!
      const qy = S[i * 2 + 1]!
      if (!inBounds(pick.bounds, qx, qy, margin)) {
        slot += 4
        continue
      }
      cornerVsPolygon(qx, qy, W, n, null, margin)
      for (let hh = 0; hh < 4; hh += 1) {
        slot += 1
        if (hh < hitCount) add(s, key.body, BODY_PICK, PLANE_CUTAWAY, slot, CLS_PICK_PIN, c, qx, qy, hits[hh * 3]!, hits[hh * 3 + 1]!, hits[hh * 3 + 2]!, mus, muk)
      }
    }
  }
  return slot
}

/** Rebuild the live contact set from current positions. */
export function generateContacts(s: SolverState): void {
  const c = s.contacts
  const P = s.params
  c.count = 0
  deepPts = []
  s.bodies.q0.set(s.bodies.q)
  let slot = 0
  deep = 0

  // plug rotation stops
  const theta = s.bodies.q[BODY_PLUG * DOF]!
  slot += 1
  {
    const gap = theta - P.thetaMin
    if (gap < 0.02) {
      const i = c.count
      c.a[i] = BODY_PLUG
      c.b[i] = BODY_STATIC
      c.slot[i] = slot
      c.cls[i] = CLS_PLUG_STOP
      c.chamber[i] = -1
      c.ja.fill(0, i * DOF, i * DOF + DOF)
      c.jb.fill(0, i * DOF, i * DOF + DOF)
      c.ta.fill(0, i * DOF, i * DOF + DOF)
      c.tb.fill(0, i * DOF, i * DOF + DOF)
      c.ja[i * DOF] = 1
      c.gap[i] = gap
      c.mN[i] = P.plugInertia
      c.mT[i] = 0
      c.mus[i] = 0
      c.muk[i] = 0
      c.count = i + 1
    }
  }
  slot += 1
  {
    const gap = P.thetaOpen - theta
    if (gap < 0.02) {
      const i = c.count
      c.a[i] = BODY_PLUG
      c.b[i] = BODY_STATIC
      c.slot[i] = slot
      c.cls[i] = CLS_PLUG_STOP
      c.chamber[i] = -1
      c.ja.fill(0, i * DOF, i * DOF + DOF)
      c.jb.fill(0, i * DOF, i * DOF + DOF)
      c.ta.fill(0, i * DOF, i * DOF + DOF)
      c.tb.fill(0, i * DOF, i * DOF + DOF)
      c.ja[i * DOF] = -1
      c.gap[i] = gap
      c.mN[i] = P.plugInertia
      c.mT[i] = 0
      c.mus[i] = 0
      c.muk[i] = 0
      c.count = i + 1
    }
  }

  for (let i = 0; i < s.chambers.length; i += 1) slot = chamberContacts(s, s.chambers[i]!, slot)
  slot = pickContacts(s, slot)
  c.slotsUsed = slot
  c.deep = deep
  c.deepPts = deepPts
}
