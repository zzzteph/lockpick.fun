/**
 * Geometry: polygons from profiles, rigid transforms, and the fixed contact features of the
 * cylinder (bore walls, chamfers, rims, floor, keyway) as segment and corner lists.
 */

import type { Params } from './params'
import type { PickProfile, PinProfile } from './profiles'
import type { Corners, PickBody, PinBody, Segments } from './types'

// ── Polygons ───────────────────────────────────────────────────────────────────────────────

/** Right-hand silhouette → closed CCW polygon (X sideways, Y along the pin). */
export function pinPolygon(profile: PinProfile): Float64Array {
  const n = profile.right.length
  const out = new Float64Array(n * 4)
  for (let i = 0; i < n; i += 1) {
    const [u, w] = profile.right[i]!
    out[i * 2] = w
    out[i * 2 + 1] = u
  }
  for (let i = 0; i < n; i += 1) {
    const [u, w] = profile.right[n - 1 - i]!
    out[(n + i) * 2] = -w
    out[(n + i) * 2 + 1] = u
  }
  return out
}

function indices(pred: (i: number) => boolean, count: number): Int32Array {
  const list: number[] = []
  for (let i = 0; i < count; i += 1) if (pred(i)) list.push(i)
  return Int32Array.from(list)
}

/** Outward normal Y-component of edge i of a CCW polygon. */
function edgeNormalY(local: Float64Array, count: number, i: number): number {
  const j = (i + 1) % count
  const dx = local[j * 2]! - local[i * 2]!
  const dy = local[j * 2 + 1]! - local[i * 2 + 1]!
  const len = Math.hypot(dx, dy)
  return len > 0 ? -dx / len : 0
}

export function makePinBody(body: number, profile: PinProfile): PinBody {
  const local = pinPolygon(profile)
  const count = local.length / 2
  let bottomU = Infinity
  let topU = -Infinity
  for (let i = 0; i < count; i += 1) {
    const u = local[i * 2 + 1]!
    if (u < bottomU) bottomU = u
    if (u > topU) topU = u
  }
  const y = (i: number): number => local[i * 2 + 1]!
  return {
    body,
    profile,
    count,
    local,
    world: new Float64Array(local.length),
    side: new Float64Array(local.length),
    bounds: new Float64Array(4),
    sideBounds: new Float64Array(4),
    bottomU,
    topU,
    bottomVerts: indices((i) => y(i) < bottomU + 0.6, count),
    topVerts: indices((i) => y(i) > topU - 0.6, count),
    bottomEdges: indices((i) => edgeNormalY(local, count, i) < -0.3, count),
    topEdges: indices((i) => edgeNormalY(local, count, i) > 0.3, count),
    lowerVerts: indices((i) => y(i) < bottomU + 1.6, count),
    lowerEdges: indices((i) => {
      const j = (i + 1) % count
      return Math.min(y(i), y(j)) < bottomU + 1.6
    }, count),
  }
}

export function makePickBody(profile: PickProfile): PickBody {
  const count = profile.outline.length
  const local = new Float64Array(count * 2)
  for (let i = 0; i < count; i += 1) {
    const [x, y] = profile.outline[i]!
    local[i * 2] = x
    local[i * 2 + 1] = y
  }
  return {
    profile,
    count,
    local,
    world: new Float64Array(count * 2),
    flexX: profile.flexX,
    tipIndex: profile.tipIndex,
    bounds: new Float64Array(4),
    flexWX: 0,
    flexWY: 0,
  }
}

/** Axis-aligned bounds of a polygon into out (minX, minY, maxX, maxY). */
export function polygonBounds(W: Float64Array, count: number, out: Float64Array): void {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < count; i += 1) {
    const x = W[i * 2]!
    const y = W[i * 2 + 1]!
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  out[0] = minX
  out[1] = minY
  out[2] = maxX
  out[3] = maxY
}

/** Is (x, y) within `pad` of the box? */
export function inBounds(b: Float64Array, x: number, y: number, pad: number): boolean {
  return x >= b[0]! - pad && x <= b[2]! + pad && y >= b[1]! - pad && y <= b[3]! + pad
}

/** Place a pin polygon in the chamber plane: centre (cx, cy), cant φ (CCW). */
export function placePin(pin: PinBody, cx: number, cy: number, phi: number): void {
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  const L = pin.local
  const W = pin.world
  for (let i = 0; i < pin.count; i += 1) {
    const x = L[i * 2]!
    const y = L[i * 2 + 1]!
    W[i * 2] = cx + x * c - y * s
    W[i * 2 + 1] = cy + x * s + y * c
  }
  polygonBounds(W, pin.count, pin.bounds)
}

/** The pin's silhouette in the cutaway plane, upright at (x, y). */
export function placePinSide(pin: PinBody, x: number, y: number): void {
  const L = pin.local
  const S = pin.side
  for (let i = 0; i < pin.count; i += 1) {
    S[i * 2] = x + L[i * 2]!
    S[i * 2 + 1] = y + L[i * 2 + 1]!
  }
  polygonBounds(S, pin.count, pin.sideBounds)
}

/** Place the pick: handle at (x, y), angle a, blade bent by β about the flex point. */
export function placePick(pick: PickBody, x: number, y: number, a: number, beta: number): void {
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const cb = Math.cos(beta)
  const sb = Math.sin(beta)
  const fx = pick.flexX
  const L = pick.local
  const W = pick.world
  pick.flexWX = x + fx * ca
  pick.flexWY = y + fx * sa
  for (let i = 0; i < pick.count; i += 1) {
    let lx = L[i * 2]!
    let ly = L[i * 2 + 1]!
    if (lx > fx) {
      const dx = lx - fx
      const dy = ly
      lx = fx + dx * cb - dy * sb
      ly = dx * sb + dy * cb
    }
    W[i * 2] = x + lx * ca - ly * sa
    W[i * 2 + 1] = y + lx * sa + ly * ca
  }
  polygonBounds(W, pick.count, pick.bounds)
}

/** Ray-crossing point-in-polygon, for the non-convex guard on corner contacts. */
export function pointInPolygon(px: number, py: number, W: Float64Array, count: number): boolean {
  let inside = false
  for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
    const xi = W[i * 2]!
    const yi = W[i * 2 + 1]!
    const xj = W[j * 2]!
    const yj = W[j * 2 + 1]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// ── Fixed features ─────────────────────────────────────────────────────────────────────────

function segments(list: number[][]): Segments {
  const data = new Float64Array(list.length * 6)
  list.forEach((s, i) => {
    const [ax, ay, bx, by] = s as [number, number, number, number]
    let nx = s[4]!
    let ny = s[5]!
    const len = Math.hypot(nx, ny)
    nx /= len
    ny /= len
    data.set([ax, ay, bx, by, nx, ny], i * 6)
  })
  return { count: list.length, data }
}

function corners(list: number[][]): Corners {
  const data = new Float64Array(list.length * 2)
  list.forEach((c, i) => data.set([c[0]!, c[1]!], i * 2))
  return { count: list.length, data }
}

/** Height of the shear circle at sideways offset x: the plug's top. */
export function circleY(P: Params, x: number): number {
  return Math.sqrt(P.plugRadius * P.plugRadius - x * x) - P.plugRadius
}

/** Height of the housing's underside at sideways offset x: the plug's top plus `shearGap`. */
export function housingY(P: Params, x: number): number {
  const r = P.plugRadius + P.shearGap
  return Math.sqrt(r * r - x * x) - P.plugRadius
}

/**
 * The plug's contact features in its own frame (θ = 0): bore walls up to the chamfer, the chamfer,
 * the floor either side of the keyway slot; corners at the wall tops, chamfer tops and slot lips.
 * The outer circle is handled analytically.
 */
export function plugFeatures(P: Params): { segs: Segments; corners: Corners } {
  const rb = P.boreRadius
  const ch = P.rimChamfer
  const yc = circleY(P, rb + ch)
  const yw = yc - ch
  const fl = P.floorY
  const sl = P.slotHalf
  return {
    segs: segments([
      // right wall (normal points into the bore: -X)
      [rb, fl, rb, yw, -1, 0],
      // right chamfer
      [rb, yw, rb + ch, yc, -1, 1],
      // left wall
      [-rb, yw, -rb, fl, 1, 0],
      // left chamfer
      [-rb - ch, yc, -rb, yw, 1, 1],
      // floor, either side of the slot
      [sl, fl, rb, fl, 0, 1],
      [-rb, fl, -sl, fl, 0, 1],
    ]),
    corners: corners([
      [rb, yw],
      [rb + ch, yc],
      [-rb, yw],
      [-rb - ch, yc],
      [sl, fl],
      [-sl, fl],
    ]),
  }
}

/** The housing bore for one chamber, centred at X = -delta, in world coordinates. */
export function housingFeatures(P: Params, delta: number): { segs: Segments; corners: Corners } {
  const rb = P.boreRadius
  const ch = P.rimChamfer
  const xh = -delta
  const yR = housingY(P, Math.abs(xh + rb + ch))
  const yL = housingY(P, Math.abs(xh - rb - ch))
  return {
    segs: segments([
      // right wall, chamfer bottom up to the seat (normal into the bore: -X)
      [xh + rb, yR + ch, xh + rb, P.seatY, -1, 0],
      // right chamfer (material is up-right; free space is down-left)
      [xh + rb + ch, yR, xh + rb, yR + ch, -1, -1],
      // left wall
      [xh - rb, P.seatY, xh - rb, yL + ch, 1, 0],
      // left chamfer
      [xh - rb, yL + ch, xh - rb - ch, yL, 1, -1],
    ]),
    corners: corners([
      [xh + rb, yR + ch],
      [xh + rb + ch, yR],
      [xh - rb, yL + ch],
      [xh - rb - ch, yL],
    ]),
  }
}

/**
 * The keyway in the cutaway plane: floor, ceiling between bores, bore side walls; corners at the
 * mouth and at every ceiling end.
 */
export function keywayFeatures(P: Params, chamberXs: readonly number[]): { segs: Segments; corners: Corners } {
  const fl = P.keywayFloorY
  const ce = P.keywayCeilY
  const rb = P.boreRadius
  const segs: number[][] = [
    [0, fl, P.keywayDepth, fl, 0, 1],
    // the lock's front face, above and below the mouth
    [0, ce, 0, ce + 12, -1, 0],
    [0, fl - 12, 0, fl, -1, 0],
  ]
  const cs: number[][] = [
    [0, ce],
    [0, fl],
  ]
  let x0 = 0
  for (const x of chamberXs) {
    segs.push([x0, ce, x - rb, ce, 0, -1])
    segs.push([x - rb, ce, x - rb, 0, 1, 0])
    segs.push([x + rb, 0, x + rb, ce, -1, 0])
    cs.push([x - rb, ce], [x + rb, ce])
    x0 = x + rb
  }
  segs.push([x0, ce, P.keywayDepth, ce, 0, -1])
  return { segs: segments(segs), corners: corners(cs) }
}

/** Rotate plug-local features about the pivot (0, -plugRadius) by θ into world buffers. */
export function transformPlug(
  P: Params,
  local: Segments,
  world: Segments,
  cornersLocal: Corners,
  cornersWorld: Corners,
  cos: number,
  sin: number,
): void {
  const R = P.plugRadius
  const L = local.data
  const W = world.data
  for (let i = 0; i < local.count; i += 1) {
    const o = i * 6
    for (let k = 0; k < 4; k += 2) {
      const x = L[o + k]!
      const y = L[o + k + 1]! + R
      W[o + k] = x * cos - y * sin
      W[o + k + 1] = x * sin + y * cos - R
    }
    const nx = L[o + 4]!
    const ny = L[o + 5]!
    W[o + 4] = nx * cos - ny * sin
    W[o + 5] = nx * sin + ny * cos
  }
  const CL = cornersLocal.data
  const CW = cornersWorld.data
  for (let i = 0; i < cornersLocal.count; i += 1) {
    const x = CL[i * 2]!
    const y = CL[i * 2 + 1]! + R
    CW[i * 2] = x * cos - y * sin
    CW[i * 2 + 1] = x * sin + y * cos - R
  }
}
