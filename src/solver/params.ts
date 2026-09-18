/**
 * Solver parameters — every number the 2.5D pin solver uses, in one place.
 *
 * Units: millimetres, newtons, seconds, radians. Mass is therefore N·s²/mm (a tonne); the values
 * below are written as grams × 1e-6 so they read as what they are.
 *
 * Two kinds of numbers live here and the distinction matters:
 *  - **geometry and material** (bore, pin, clearance, spring, friction) — measured from real
 *    locks, and the only things behaviour is allowed to come from;
 *  - **solver tuning** (substeps, iterations, margins, damping, speed caps) — numerical, chosen so
 *    the contact solve converges; they set how *fast* a transient settles, never *where*.
 */

export interface Params {
  // ── Cylinder geometry (chamber plane: X sideways with the plug, Y up, shear line at Y≈0) ──
  /** Plug radius — real 12.7 mm plug. Turns rotation into a sideways bore shift, Δ = r·θ. */
  readonly plugRadius: number
  /** Bore radius, plug and housing alike (Ø3.05). */
  readonly boreRadius: number
  /** Pin radius (Ø2.95): 0.05 mm radial clearance in the bore. */
  readonly pinRadius: number
  /** 45° chamfer at every bore mouth. Real plugs are deburred; this is what lets a set push back. */
  readonly rimChamfer: number
  /**
   * Clearance between the plug's top and the housing's underside, mm: the housing's inner circle
   * is `plugRadius + shearGap`. Zero is a real cylinder. A game may open it so a key pin's top can
   * stand a little above the plug's rim without meeting the housing where its bore has turned
   * away (the bench, 2026-09-13: "a small space between plug and hull, as an additional lax thing").
   */
  readonly shearGap: number
  /**
   * 45° chamfer on a key pin's top corners, mm. Keep it smaller than the difference between the
   * key pin's radius and the slimmest driver's, or a driver's bottom corner lands on the slope
   * and the plug's sideways push on the key pin wedges the pair against the housing wall
   * (the bench, 2026-09-13: with 0.15 and drivers 0.15 slimmer, the fifth pin stalled the plug).
   */
  readonly keyTopChamfer: number
  /** Where the plug bore meets the keyway: the key pin's shoulders rest here. */
  readonly floorY: number
  /** Half-width of the keyway slot the key pin's tip hangs through. */
  readonly slotHalf: number
  /** Top of the housing bore (spring seat). */
  readonly seatY: number
  /** Plug rotation that counts as open. */
  readonly thetaOpen: number
  /** The plug will not turn backwards past this. */
  readonly thetaMin: number

  // ── Keyway (cutaway plane: x along the keyway from the mouth, y up) ──
  readonly keywayFloorY: number
  readonly keywayCeilY: number
  readonly keywayDepth: number
  /** Chamber 0's x; the rest follow at `pitch`. */
  readonly firstChamberX: number
  readonly pitch: number

  // ── Materials ──
  /** Driver spring at rest, and per mm of compression. */
  readonly springPreload: number
  readonly springK: number
  /** Brass on brass. Static must exceed kinetic or there is no stick–slip. */
  readonly muStatic: number
  readonly muKinetic: number
  /** Steel pick on brass pin. */
  readonly muPickStatic: number
  readonly muPickKinetic: number
  /** Wrench: tension 0..1 → 0..maxTorque N·mm. */
  readonly maxTorque: number

  // ── Masses, damping, speed caps (numerical — see NOTES.md) ──
  // Damping is set critical (ζ ≈ 1) for the hand, the blade and the pins: a real hand does not
  // ring, and an under-damped pick shakes visibly after every stick–slip. Each damper stays under
  // the explicit limit c·h/m < 1.
  readonly plugInertia: number
  /**
   * Viscous drag on the plug. Kept light (a freed plug turns at 5 rad/s under 15 N·mm) because
   * two behaviours are driven by small net torques and go slow-motion under heavy drag: the
   * plug's creep into a spool's waist (a false set that took under a second takes ten at
   * 15 N·mm·s/rad) and a mushroom's 6° of counter-rotation. A take-up therefore happens in a
   * few milliseconds; smoothing that for the eye is a display job (the bench eases the drawn
   * angle over 80 ms), not a physics one.
   */
  readonly plugDamping: number
  readonly plugMaxRate: number
  readonly pinMass: number
  readonly pinDamping: number
  readonly pinMaxSpeed: number
  readonly pinMaxSpin: number
  /** Weight of a pin. Real is 2.6 mN; boosted so a freed key pin falls in a few frames. */
  readonly pinGravity: number
  readonly pickMass: number
  readonly pickInertia: number
  readonly pickMaxSpeed: number
  readonly pickMaxRate: number
  readonly bendMaxRate: number
  /** The hand: a stiff 2D spring + rotational spring at the handle point. */
  readonly handK: number
  /** The most the hand will push or pull along either axis (N). A real hand yields. */
  readonly handMaxForce: number
  readonly handKRot: number
  readonly handDamping: number
  readonly handDampingRot: number
  /** Blade bending, as a torsion spring at the flex point. Tip stiffness = bendK / L_tip². */
  readonly bendK: number
  readonly bendDamping: number
  readonly bendInertia: number

  // ── Solver ──
  readonly substeps: number
  readonly velocityIterations: number
  readonly positionIterations: number
  /** Contacts closer than this are generated (speculative). Must exceed max travel per substep. */
  readonly margin: number
  /** Penetration tolerated before position correction acts. */
  readonly slop: number
  /** Below this tangential speed a contact counts as stuck (static friction applies). */
  readonly stickSpeed: number
}

export const DEFAULT_PARAMS: Params = {
  plugRadius: 6.35,
  boreRadius: 1.525,
  pinRadius: 1.475,
  rimChamfer: 0.15,
  shearGap: 0,
  keyTopChamfer: 0.15,
  floorY: -5.0,
  slotHalf: 1.1,
  seatY: 9.0,
  thetaOpen: 0.52,
  thetaMin: -0.02,

  keywayFloorY: -11.0,
  keywayCeilY: -5.0,
  keywayDepth: 34.0,
  firstChamberX: 3.6,
  pitch: 4.2,

  springPreload: 0.5,
  springK: 0.15,
  muStatic: 0.35,
  muKinetic: 0.25,
  muPickStatic: 0.3,
  muPickKinetic: 0.2,
  maxTorque: 60,

  plugInertia: 2.1e-2,
  plugDamping: 3.0,
  plugMaxRate: 30,
  pinMass: 2.6e-5,
  pinDamping: 4.5e-3,
  pinMaxSpeed: 150,
  pinMaxSpin: 20,
  pinGravity: 0.03,
  pickMass: 2e-4,
  pickInertia: 0.2,
  pickMaxSpeed: 250,
  pickMaxRate: 3,
  bendMaxRate: 15,
  handK: 20,
  handMaxForce: 12,
  handKRot: 20000,
  handDamping: 0.126,
  handDampingRot: 126,
  bendK: 288,
  bendDamping: 2.15,
  bendInertia: 4e-3,

  substeps: 8,
  velocityIterations: 10,
  positionIterations: 4,
  margin: 0.3,
  slop: 0.001,
  stickSpeed: 0.2,
}

/** Fixed frame time. Substeps divide it. */
export const DT = 1 / 120
