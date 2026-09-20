/**
 * Solver state — everything lives in preallocated typed arrays so `step` allocates nothing.
 *
 * Bodies are generic 4-DOF things; what a DOF *means* depends on the body kind:
 *  - plug:  [θ, -, -, -]            rotation about the plug axis (CCW in the chamber plane)
 *  - pin:   [X, Y, φ, -]            sideways, up, cant about the keyway axis (chamber plane)
 *  - pick:  [x, y, angle, bend]     cutaway plane; `bend` is the blade's flex about the flex point
 *  - static:[-, -, -, -]            the housing, the keyway
 *
 * A key pin's Y is the same number in both planes; that is the whole of the 2.5D coupling.
 */

import type { Params } from './params'
import type { PickProfile, PinProfile } from './profiles'

export const DOF = 4

export const KIND_STATIC = 0
export const KIND_PLUG = 1
export const KIND_PIN = 2
export const KIND_PICK = 3

/** Body indices that never move. */
export const BODY_STATIC = 0
export const BODY_PLUG = 1
export const BODY_PICK = 2

/** The chamber (Y–Z) plane, where pins cant. */
export const PLANE_CHAMBER = 0
/** The cutaway (X–Y) plane, where the pick lives. */
export const PLANE_CUTAWAY = 1

/** What a contact is between — for readouts, never for the solve. */
export const CLS_PLUG_STOP = 1
export const CLS_PLUG_WALL = 2
export const CLS_PLUG_RIM = 3
export const CLS_PLUG_LEDGE = 4
export const CLS_HOUSING_WALL = 5
export const CLS_HOUSING_RIM = 6
export const CLS_HOUSING_LEDGE = 7
export const CLS_FLOOR = 8
export const CLS_PIN_PIN = 9
export const CLS_PICK_PIN = 10
export const CLS_KEYWAY = 11
export const CLS_MOUTH = 12

export interface Bodies {
  readonly n: number
  readonly kind: Uint8Array
  readonly q: Float64Array
  readonly v: Float64Array
  readonly f: Float64Array
  readonly invM: Float64Array
  readonly damp: Float64Array
  /** Positions when this substep's contacts were generated (for position correction). */
  readonly q0: Float64Array
}

/** Line segments: 6 numbers each — a, b, and the outward normal (pointing into free space). */
export interface Segments {
  readonly count: number
  readonly data: Float64Array
}

/** Sharp corners that can dig into a pin: 2 numbers each. */
export interface Corners {
  readonly count: number
  readonly data: Float64Array
}

export interface PinBody {
  readonly body: number
  readonly profile: PinProfile
  readonly count: number
  /** Local polygon, X sideways, Y along the axis, pin centre at the origin. */
  readonly local: Float64Array
  /** Chamber-plane world polygon. */
  readonly world: Float64Array
  /** Cutaway-plane world polygon (the pin's silhouette at its chamber x). */
  readonly side: Float64Array
  /** Bounding boxes of `world` and `side`: minX, minY, maxX, maxY. */
  readonly bounds: Float64Array
  readonly sideBounds: Float64Array
  readonly bottomU: number
  readonly topU: number
  readonly bottomVerts: Int32Array
  readonly topVerts: Int32Array
  readonly bottomEdges: Int32Array
  readonly topEdges: Int32Array
  readonly lowerVerts: Int32Array
  readonly lowerEdges: Int32Array
}

export interface Chamber {
  readonly index: number
  /** Position along the keyway (cutaway x). */
  readonly x: number
  /** Housing bore lateral offset: the bore's centre sits at X = -delta. Smallest binds first. */
  readonly delta: number
  readonly key: PinBody
  readonly driver: PinBody
  /** Rest positions, for lift readouts and the spring's preload datum. */
  readonly keyRestY: number
  readonly driverRestY: number
  readonly restTopY: number
  readonly housingSegs: Segments
  readonly housingCorners: Corners
}

export interface PickBody {
  readonly profile: PickProfile
  readonly count: number
  readonly local: Float64Array
  readonly world: Float64Array
  readonly flexX: number
  readonly tipIndex: number
  /** Bounding box of `world`: minX, minY, maxX, maxY. */
  readonly bounds: Float64Array
  /** World flex point this substep. */
  flexWX: number
  flexWY: number
}

export interface Contacts {
  count: number
  readonly cap: number
  readonly a: Int32Array
  readonly b: Int32Array
  readonly slot: Int32Array
  readonly cls: Uint8Array
  readonly chamber: Int16Array
  readonly ja: Float64Array
  readonly jb: Float64Array
  readonly ta: Float64Array
  readonly tb: Float64Array
  readonly gap: Float64Array
  readonly mN: Float64Array
  readonly mT: Float64Array
  readonly mus: Float64Array
  readonly muk: Float64Array
  readonly px: Float64Array
  readonly py: Float64Array
  readonly nx: Float64Array
  readonly ny: Float64Array
  /** Persistent per candidate-pair state, indexed by slot. */
  readonly slots: number
  readonly lamN: Float64Array
  readonly lamT: Float64Array
  readonly sliding: Uint8Array
  readonly liveMark: Uint8Array
  /** Diagnostics. */
  slotsUsed: number
  overflow: number
  /** Penetrations deeper than `margin` in the last substep; anything but 0 means tunnelling. */
  deep: number
  /** Where the first of them were: (body, x, y) triples, world. */
  deepPts: number[]
}

export interface SolverInput {
  /** Wrench, 0..1 → 0..maxTorque. */
  tension: number
  /** Target pose of the pick's handle point (cutaway plane). */
  handX: number
  handY: number
  handAngle: number
}

export interface ChamberDef {
  /** Key pin body length, shoulder to top. */
  readonly keyLength: number
  readonly driver: PinProfile
  /** Housing bore lateral offset (mm). */
  readonly delta: number
}

export interface LockDef {
  readonly chambers: readonly ChamberDef[]
  readonly pick: PickProfile
}

export interface SolverState {
  readonly params: Params
  readonly def: LockDef
  readonly bodies: Bodies
  readonly chambers: readonly Chamber[]
  readonly pick: PickBody
  readonly plugSegsLocal: Segments
  readonly plugSegs: Segments
  readonly plugCornersLocal: Corners
  readonly plugCorners: Corners
  readonly keywaySegs: Segments
  readonly keywayCorners: Corners
  readonly contacts: Contacts
  readonly input: SolverInput
  /** Y of the bore mouth (the circle at the chamfer's outer edge). */
  readonly rimY: number
  plugCos: number
  plugSin: number
  /** Substep length of the last step, for turning impulses into forces. */
  h: number
  time: number
  frame: number
  /**
   * The pick gun (snap gun): an upward force, N, on each chamber's KEY pin while a strike is on —
   * the blade shoving the pins up. Applied as a real force (not a rigid clamp) so the drivers stay
   * movable: the turning plug can settle them onto the ledge instead of ramming a frozen body and
   * tunnelling. Zero except during a strike. One entry per chamber; `Engine.strike` drives it.
   */
  strikeForce: Float64Array
  /**
   * A magnetic chamber's hold, 0..1: the fraction of the DRIVER's spring and weight the magnet
   * cancels — the magnet holding the steel pin where the tool left it (D-230). Applied by scaling
   * the spring where it acts, at the driver's top, not as a separate force: a lift at the centre
   * against a spring pressing the top left the spring's torque unbalanced and tipped the driver
   * over (−104°) with the pick out. Zero on every other chamber.
   */
  magnetHold: Float64Array
}
