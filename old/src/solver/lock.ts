/**
 * Building a lock, aiming the pick, and reading the state back out.
 */

import { housingFeatures, keywayFeatures, makePickBody, makePinBody, plugFeatures, circleY } from './geometry'
import { DEFAULT_PARAMS, type Params } from './params'
import { KEY_TIP, KEY_TIP_HALF, keyPin } from './profiles'
import {
  BODY_PICK,
  BODY_PLUG,
  BODY_STATIC,
  CLS_HOUSING_LEDGE,
  CLS_HOUSING_RIM,
  CLS_HOUSING_WALL,
  CLS_PICK_PIN,
  CLS_PLUG_LEDGE,
  CLS_PLUG_RIM,
  CLS_PLUG_WALL,
  DOF,
  KIND_PICK,
  KIND_PIN,
  KIND_PLUG,
  KIND_STATIC,
  type Bodies,
  type Chamber,
  type Contacts,
  type LockDef,
  type SolverInput,
  type SolverState,
} from './types'

const CONTACT_CAP = 4096
const SLOT_CAP = 1 << 17

function makeBodies(n: number): Bodies {
  return {
    n,
    kind: new Uint8Array(n),
    q: new Float64Array(n * DOF),
    v: new Float64Array(n * DOF),
    f: new Float64Array(n * DOF),
    invM: new Float64Array(n * DOF),
    damp: new Float64Array(n * DOF),
    q0: new Float64Array(n * DOF),
  }
}

function makeContacts(): Contacts {
  const cap = CONTACT_CAP
  return {
    count: 0,
    cap,
    a: new Int32Array(cap),
    b: new Int32Array(cap),
    slot: new Int32Array(cap),
    cls: new Uint8Array(cap),
    chamber: new Int16Array(cap),
    ja: new Float64Array(cap * DOF),
    jb: new Float64Array(cap * DOF),
    ta: new Float64Array(cap * DOF),
    tb: new Float64Array(cap * DOF),
    gap: new Float64Array(cap),
    mN: new Float64Array(cap),
    mT: new Float64Array(cap),
    mus: new Float64Array(cap),
    muk: new Float64Array(cap),
    px: new Float64Array(cap),
    py: new Float64Array(cap),
    nx: new Float64Array(cap),
    ny: new Float64Array(cap),
    slots: SLOT_CAP,
    lamN: new Float64Array(SLOT_CAP),
    lamT: new Float64Array(SLOT_CAP),
    sliding: new Uint8Array(SLOT_CAP),
    liveMark: new Uint8Array(SLOT_CAP),
    slotsUsed: 0,
    overflow: 0,
    deep: 0,
    deepPts: [],
  }
}

/** Where a key pin's cone meets the slot lips: the u (from the pin centre) at half-width slotHalf. */
export function keyRestU(P: Params, keyLength: number): number {
  const h = keyLength / 2
  const R = P.pinRadius
  return -h - KEY_TIP + ((P.slotHalf - KEY_TIP_HALF) / (R - KEY_TIP_HALF)) * KEY_TIP
}

export function createLock(def: LockDef, params: Params = DEFAULT_PARAMS): SolverState {
  const P = params
  const n = 3 + def.chambers.length * 2
  const bodies = makeBodies(n)
  const { q, invM, damp, kind } = bodies

  kind[BODY_STATIC] = KIND_STATIC
  kind[BODY_PLUG] = KIND_PLUG
  invM[BODY_PLUG * DOF] = 1 / P.plugInertia
  damp[BODY_PLUG * DOF] = P.plugDamping

  kind[BODY_PICK] = KIND_PICK
  invM[BODY_PICK * DOF] = 1 / P.pickMass
  invM[BODY_PICK * DOF + 1] = 1 / P.pickMass
  invM[BODY_PICK * DOF + 2] = 1 / P.pickInertia
  invM[BODY_PICK * DOF + 3] = 1 / P.bendInertia
  damp[BODY_PICK * DOF] = P.handDamping
  damp[BODY_PICK * DOF + 1] = P.handDamping
  damp[BODY_PICK * DOF + 2] = P.handDampingRot
  damp[BODY_PICK * DOF + 3] = P.bendDamping

  const chamberXs = def.chambers.map((_, i) => P.firstChamberX + i * P.pitch)
  const chambers: Chamber[] = def.chambers.map((cd, i) => {
    const keyBody = 3 + i * 2
    const drvBody = keyBody + 1
    const key = makePinBody(keyBody, keyPin(cd.keyLength, P.keyTopChamfer))
    const driver = makePinBody(drvBody, cd.driver)
    for (const b of [keyBody, drvBody]) {
      kind[b] = KIND_PIN
      const m = P.pinMass
      const I = (m * (3 * P.pinRadius * P.pinRadius + 4.5 * 4.5)) / 12
      invM[b * DOF] = 1 / m
      invM[b * DOF + 1] = 1 / m
      invM[b * DOF + 2] = 1 / I
      damp[b * DOF] = P.pinDamping
      damp[b * DOF + 1] = P.pinDamping
      damp[b * DOF + 2] = (P.pinDamping * I) / m
    }
    const keyRestY = P.floorY - keyRestU(P, cd.keyLength) + 0.002
    const driverRestY = keyRestY + key.topU - driver.bottomU + 0.002
    q[keyBody * DOF] = -cd.delta
    q[keyBody * DOF + 1] = keyRestY
    q[drvBody * DOF] = -cd.delta
    q[drvBody * DOF + 1] = driverRestY
    const housing = housingFeatures(P, cd.delta)
    return {
      index: i,
      x: chamberXs[i]!,
      delta: cd.delta,
      key,
      driver,
      keyRestY,
      driverRestY,
      restTopY: driverRestY + driver.topU,
      housingSegs: housing.segs,
      housingCorners: housing.corners,
    }
  })

  const plug = plugFeatures(P)
  const keyway = keywayFeatures(P, chamberXs)
  const pick = makePickBody(def.pick)

  const state: SolverState = {
    params: P,
    def,
    bodies,
    chambers,
    pick,
    plugSegsLocal: plug.segs,
    plugSegs: { count: plug.segs.count, data: new Float64Array(plug.segs.data.length) },
    plugCornersLocal: plug.corners,
    plugCorners: { count: plug.corners.count, data: new Float64Array(plug.corners.data.length) },
    keywaySegs: keyway.segs,
    keywayCorners: keyway.corners,
    contacts: makeContacts(),
    input: { tension: 0, handX: 0, handY: 0, handAngle: 0 },
    rimY: circleY(P, P.boreRadius + P.rimChamfer),
    plugCos: 1,
    plugSin: 0,
    h: 1 / 120 / P.substeps,
    time: 0,
    frame: 0,
    strikeForce: new Float64Array(def.chambers.length),
    magnetHold: new Float64Array(def.chambers.length),
  }

  // Start the pick outside the mouth, level, in the middle of the keyway.
  const aim = aimTip(state, -4, (P.keywayFloorY + P.keywayCeilY) / 2)
  q[BODY_PICK * DOF] = aim.handX
  q[BODY_PICK * DOF + 1] = aim.handY
  q[BODY_PICK * DOF + 2] = aim.handAngle
  state.input.handX = aim.handX
  state.input.handY = aim.handY
  state.input.handAngle = aim.handAngle
  return state
}

export interface HandPose {
  handX: number
  handY: number
  handAngle: number
}

/**
 * A hand pose that would put the pick's tip at (tx, ty). Level whenever the shank fits through the
 * mouth that way; otherwise the shank pivots on the top or bottom of the mouth, the way a real
 * pick levers on the keyway, and the angle comes out of that geometry. Outside the lock, level.
 */
export function aimTip(s: SolverState, tx: number, ty: number, out: HandPose = { handX: 0, handY: 0, handAngle: 0 }): HandPose {
  const P = s.params
  const pick = s.pick
  const lx = pick.local[pick.tipIndex * 2]!
  const ly = pick.local[pick.tipIndex * 2 + 1]!
  const hi = P.keywayCeilY - 0.5 - 0.15
  const lo = P.keywayFloorY + 0.5 + 0.15
  let a = 0
  if (tx > 1) {
    const level = ty - ly
    const pivot = level > hi ? hi : level < lo ? lo : NaN
    if (pivot === pivot) {
      for (let i = 0; i < 4; i += 1) a = Math.atan2(ty - ly * Math.cos(a) - pivot, tx)
    }
  }
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  out.handX = tx - (lx * ca - ly * sa)
  out.handY = ty - (lx * sa + ly * ca)
  out.handAngle = a
  return out
}

export function makeInput(tension = 0, hand: HandPose = { handX: 0, handY: 0, handAngle: 0 }): SolverInput {
  return { tension, handX: hand.handX, handY: hand.handY, handAngle: hand.handAngle }
}

// ── Readouts ───────────────────────────────────────────────────────────────────────────────

export function plugAngle(s: SolverState): number {
  return s.bodies.q[BODY_PLUG * DOF]!
}

export interface ChamberReadout {
  readonly keyY: number
  readonly keyX: number
  readonly keyCant: number
  readonly keyLift: number
  readonly keyTopY: number
  readonly driverY: number
  readonly driverX: number
  /** Cant in radians (CCW positive). */
  readonly driverCant: number
  readonly driverLift: number
  readonly driverBottomY: number
  /** Total normal force from the plug on the driver (walls, rim, ledge). */
  readonly plugForce: number
  readonly housingForce: number
  /** The same for the key pin — non-zero above the shear line means an overset is bridging it. */
  readonly keyPlugForce: number
  readonly keyHousingForce: number
  /** Normal force the pick is putting into the key pin. */
  readonly pickForce: number
  /** Where the driver's lowest point sits relative to the bore mouth: > 0 is clear of the plug. */
  readonly driverClearance: number
}

export function readChamber(s: SolverState, i: number): ChamberReadout {
  const ch = s.chambers[i]!
  const q = s.bodies.q
  const k = ch.key.body * DOF
  const d = ch.driver.body * DOF
  const keyY = q[k + 1]!
  const driverY = q[d + 1]!
  const driverCant = q[d + 2]!
  let lowest = Infinity
  for (let v = 0; v < ch.driver.count; v += 1) {
    const y = ch.driver.world[v * 2 + 1]!
    if (y < lowest) lowest = y
  }
  let plugForce = 0
  let housingForce = 0
  let keyPlugForce = 0
  let keyHousingForce = 0
  let pickForce = 0
  const c = s.contacts
  for (let j = 0; j < c.count; j += 1) {
    if (c.chamber[j] !== i) continue
    const f = c.lamN[c.slot[j]!]! / s.h
    const cls = c.cls[j]!
    const involvesDriver = c.a[j] === ch.driver.body || c.b[j] === ch.driver.body
    const involvesKey = c.a[j] === ch.key.body || c.b[j] === ch.key.body
    const plugSide = cls === CLS_PLUG_WALL || cls === CLS_PLUG_RIM || cls === CLS_PLUG_LEDGE
    const housingSide = cls === CLS_HOUSING_WALL || cls === CLS_HOUSING_RIM || cls === CLS_HOUSING_LEDGE
    if (involvesDriver && plugSide) plugForce += f
    if (involvesDriver && housingSide) housingForce += f
    if (involvesKey && plugSide) keyPlugForce += f
    if (involvesKey && housingSide) keyHousingForce += f
    if (cls === CLS_PICK_PIN) pickForce += f
  }
  return {
    keyY,
    keyX: q[k]!,
    keyCant: q[k + 2]!,
    keyLift: keyY - ch.keyRestY,
    keyTopY: keyY + ch.key.topU * Math.cos(q[k + 2]!),
    driverY,
    driverX: q[d]!,
    driverCant,
    driverLift: driverY - ch.driverRestY,
    driverBottomY: lowest,
    plugForce,
    housingForce,
    keyPlugForce,
    keyHousingForce,
    pickForce,
    driverClearance: lowest - s.rimY,
  }
}

export interface PickReadout {
  readonly tipX: number
  readonly tipY: number
  /** How far the tip sits below where a rigid blade would put it — the bend. */
  readonly bendDeflection: number
  /** How far the tip sits below the hand's target for it (bend + hand give). */
  readonly tipError: number
  readonly bend: number
  /** Total normal force between the pick and pins. */
  readonly force: number
}

export function readPick(s: SolverState): PickReadout {
  const pick = s.pick
  const q = s.bodies.q

  const y = q[BODY_PICK * DOF + 1]!
  const a = q[BODY_PICK * DOF + 2]!
  const beta = q[BODY_PICK * DOF + 3]!
  const tipX = pick.world[pick.tipIndex * 2]!
  const tipY = pick.world[pick.tipIndex * 2 + 1]!
  const lx = pick.local[pick.tipIndex * 2]!
  const ly = pick.local[pick.tipIndex * 2 + 1]!
  const rigidY = y + lx * Math.sin(a) + ly * Math.cos(a)
  const inp = s.input
  const targetY = inp.handY + lx * Math.sin(inp.handAngle) + ly * Math.cos(inp.handAngle)
  let force = 0
  const c = s.contacts
  for (let j = 0; j < c.count; j += 1) {
    if (c.cls[j] === CLS_PICK_PIN) force += c.lamN[c.slot[j]!]! / s.h
  }
  return {
    tipX,
    tipY,
    bendDeflection: rigidY - tipY,
    tipError: targetY - tipY,
    bend: beta,
    force,
  }
}

/** Sum of normal forces on the plug from chamber i's driver, resolved as torque about the axis. */
export function plugReactionTorque(s: SolverState): number {
  const c = s.contacts
  let torque = 0
  for (let j = 0; j < c.count; j += 1) {
    const isPlugA = c.a[j] === BODY_PLUG
    const isPlugB = c.b[j] === BODY_PLUG
    if (!isPlugA && !isPlugB) continue
    if (c.cls[j] === 1) continue
    const slot = c.slot[j]!
    const ln = c.lamN[slot]! / s.h
    const lt = c.lamT[slot]! / s.h
    const o = j * DOF
    torque += isPlugA ? c.ja[o]! * ln + c.ta[o]! * lt : -(c.jb[o]! * ln + c.tb[o]! * lt)
  }
  return torque
}
