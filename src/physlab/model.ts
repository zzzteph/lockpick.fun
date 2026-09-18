/**
 * PHYSLAB — a geometric contact model of a pin-tumbler cylinder.
 *
 * This is a *lab*, not the game. It sits beside `src/sim` and touches none of it. The question it
 * exists to answer is the one behind the whole "real objects" idea: if the pins, the plug and the
 * tool are actual **shapes** in contact — rather than numbers with tuned walls between them — do the
 * behaviours we hand-author in `src/sim` fall out of the geometry on their own?
 *
 * This file now grows that to a *full pin-tumbler family*: four driver profiles (standard, spool,
 * serrated, mushroom), per-chamber individuality (spring, bore drag, bias), counter-rotation, the
 * overset jam, set-pin retention under tension with feathering, an emergent resistance readout, and
 * pick strain. The claim under test is unchanged and stricter for the extra scope: **there is not
 * one constant in here that names a pin type or a tool.** A mushroom is a cone. A spool is a waist.
 * Binding order is whichever pin the rotating plug pinches first. "Number three is the heavy one" is
 * a spring rolled from the seed. If that reproduces the roster's feel, the view problem and the
 * new-tool problem collapse into one: draw the shapes, add a shape.
 *
 * Coordinates: millimetres and radians, y increasing **upward**, the shear line at y = 0. Fixed
 * timestep, seeded RNG, no DOM or clock — same discipline as `src/sim` so a seed reproduces a run.
 */

import { clamp, clamp01, moveToward } from '../sim/math'
import { createRng, nextSigned } from '../sim/rng'
import type { RngState } from '../sim/rng'

// ── Geometry of the cylinder — real dimensions, nothing about pins or tools ────────────────

/** Plug radius. The only thing that turns rotation into a sideways shift: Δ = R·θ at the bore. */
export const PLUG_RADIUS = 5.0
/** Bore radius — the half-width of the hole a pin sits in, in plug and shell alike. */
export const BORE_HALF = 1.5
/** Chamber spacing along the keyway. */
export const PITCH = 4.2
/** The shear line. Everything is measured from here. */
export const SHEAR_Y = 0
/** Where a key pin's bottom rests with nothing lifting it. */
export const FLOOR_Y = -6.0
/** ~30° — the plug rotation that counts as open. Borrowed from the game only so the feel compares. */
export const THETA_OPEN = 0.52
/** Open once every chamber is caught and the plug has turned this fraction of the way. */
export const OPEN_FRACTION = 0.98

/**
 * How close the key/driver interface must come to the shear line for the plug to shear past it, in
 * mm. This is the real chamfer/clearance slack at the mouth of the bore — a physical gap, not a
 * difficulty knob. It is the width of the capture window expressed as a height.
 */
export const CAPTURE_SLACK = 0.22

/**
 * How deep the shell's chamber is drilled above the shear line, mm.
 *
 * The **ceiling** an overset pin runs into, and it is now the thing that decides how far a pin can be
 * driven rather than a flat guess. Reported from play: *"I can push the pin so far, that [driver] pin
 * will go out from the hull."* It was true — the old flat 2.2mm of overset put a 4.5mm driver's head
 * at 6.7mm, and the shell chamber is 6.1mm deep, so the last 0.6mm of pin was drawn outside the lock.
 *
 * Same number and same derivation as the game's `SHELL_CHAMBER_TOP_MM`, so a lab pin and a game pin
 * live in the same hole — which matters the moment `phyzbench` draws one inside the other.
 */
export const SHELL_CHAMBER_TOP = 6.1
/** What a coil spring still occupies when its coils touch: part of the chamber's depth, not of the void. */
export const SPRING_SOLID = 0.3

/**
 * How far past its set point *this* chamber can be driven, mm — its own head against its own ceiling.
 *
 * Derived per chamber rather than shared, because it is a property of the pin in the hole: a long
 * driver has less room above it than a short one. A standard 4.5mm driver gets 1.3mm, which is
 * exactly the game's `MAX_OVERLIFT` — the two arrive at the same number from the same geometry.
 */
export function oversetRoom(c: Chamber): number {
  return Math.max(0, SHELL_CHAMBER_TOP - SPRING_SOLID - c.def.driverLen)
}

/** Coulomb friction between a pinched pin and the bore. Sets how heavy a bound pin feels. */
export const MU = 0.6

/** How fast the plug takes up rotation toward what the pins currently permit, rad/s. */
export const TAKEUP_RATE = 6.0
/**
 * Tension above which the plug will **not** back out of a groove it has over-rotated into. Below it
 * the plug eases back and a cammed pin can climb; above it, it jams. A tension, not a spool
 * constant: it is the same number for every profile, and a standard pin simply never presents a
 * shoulder for it to catch on. The spool wall, the mushroom's cam and the overset jam all live here.
 */
export const T_BACKOUT = 0.34
/** Tension at which the player is demanding full rotation. */
export const T_FULL_TURN = 0.22

/** How fast a pin rises to meet the tool, mm/s, before friction and bore drag are charged. */
export const TOOL_RATE = 26.0
/** How fast an unsupported pin falls back on its spring, mm/s, at nominal spring and drag. */
export const SPRING_RATE = 30.0
/** A free pin barely resists; this multiplies its rise so it rides up almost weightlessly. */
export const FREE_LIFT_GAIN = 2.4

/**
 * The spool/mushroom **wall**. When a pin is pushed toward a body wider than the offset plug bore can
 * pass — a spool's square foot, a mushroom's cone — the plug's ledge bears on that shoulder and
 * resists the climb, per unit of tension and per mm the body is over-wide. It is a resistance that
 * *slows* the climb (never a downward shove — that caused a buzzing limit cycle), but a firm one:
 * strong enough that at working tension it saturates the hand's push and the pin **cannot** be forced
 * through. The only way past is to ease the wrench, so the plug rolls back and the shoulder narrows
 * to something that fits. Deliberately high so a hard hand cannot bull through a spool.
 */
export const CAM_K = 8.0
/** How far above the tip the wall looks when it measures the shoulder, mm. */
export const CAM_LOOKAHEAD = 0.06

/**
 * **Counter-rotation.** The torque a cammed shoulder puts back into the wrench, per mm of overhang.
 *
 * The thing a picker actually feels, described exactly: *"a pin that has a spool will want to force
 * the tension wrench and the cylinder to go counterclockwise. As it starts to push against the
 * direction you're pushing, you very lightly let up and let it push back — while keeping enough
 * tension as to not drop all the pins."*
 *
 * The mechanism: at a false set the plug has rotated far into the spool's waist, so the **shoulder
 * above the waist overhangs the plug's bore edge**. The spring presses that shoulder down onto the
 * edge, and the chamfer turns it into a force that rolls the plug *back*. It is a torque on the plug,
 * not a shove on the pin — which is the whole difference from the `COUNTER_GAIN` that had to be
 * ripped out: driving the pin down injected velocity and the plug oscillated (761 direction reversals
 * in ten seconds). Torque on θ is a proportional standoff: it settles where the cam balances the
 * wrench, and it cannot buzz.
 *
 * It is also **exclusive to security pins with nothing naming them**: a standard driver is full width
 * everywhere, so at its own bind angle the overhang is exactly zero and it pushes back not at all.
 * Only a waist or a groove lets the plug turn far enough to get under a wider shoulder.
 *
 * Sized so one deep spool false set (~0.5mm of overhang) reads about 0.45 — held by wrench 5 (0.55),
 * pushed back by wrench 3 (0.30). That gap is the technique.
 */
export const CAM_TORQUE = 0.9
/**
 * How much a *second* cammed chamber adds.
 *
 * The plug is one body pinched at one angle: the widest overhang carries the load and the rest are
 * along for the ride, touching rather than bearing. Summing them outright made a stack of spools
 * produce more counter-torque than any wrench can hold, which is not what a stack does — it makes
 * the lock heavier, not impossible.
 */
export const CAM_SHARE = 0.3
/** How fast the plug rolls back under a cam it cannot resist, rad/s per unit of excess torque. */
export const CAM_BACK_RATE = 3.0

/**
 * How much the spring stiffens as it compresses — the extra force to push a pin higher, per mm of
 * lift, per unit of spring strength (Hooke). The last of a lift takes more than the first. This is
 * force felt in the climb; the resistance *readout* has its own compression term (`RESIST_PER_MM`).
 */
export const SPRING_STIFFEN = 0.05

/**
 * A false set **holds** the pin against its spring even after the tool leaves it — the plug has
 * counter-rotated under a shoulder of the driver and bears it, so the pin parks on that ledge instead
 * of falling. This is the same physics as set-pin retention (the plug holds the pin, not the tool),
 * and it is what a real stack of spools/serrations does: each parks on its groove while you move on to
 * the next. Two knobs: how wide the shoulder must be to count as a ledge (not surface noise), and the
 * floor pinch that stands in for the plug's bearing when the pin is not the one carrying the plug's
 * thrust (so a parked false set still reads as one). The hold needs tension to keep the plug wedged —
 * it is gated at `T_BACKOUT`, so easing the wrench lets the plug back out and the stack drops.
 */
export const FALSE_SET_LEDGE = 0.02
export const FALSE_SET_PINCH = 0.2

// ── Tool geometry: the pick is a rigid strip pivoting about the hand ─────────────────────────

/**
 * The pick's working length: grip to point, mm. **The tool has a size, and it travels.**
 *
 * It used to pivot about a fixed point outside the keyway, which made the lever `tipX − HAND_X` —
 * so pushing the tool deeper made it *longer*. The tool grew and shrank as you worked, which is not
 * a pick, it is a snail: reported as exactly that. A pick is a fixed piece of steel, and inserting it
 * moves your hand with it, so the lever is the **tool's own length** and never changes. Sliding it
 * in and out is a translation and nothing else.
 *
 * Six chamber pitches — long enough that a working lift tilts the shaft by a few degrees rather than
 * throwing it, which is what the old lever averaged across the roster's insertion depths.
 */
export const SHANK_LEN = 6 * PITCH
/**
 * The hand's height, below the keyway floor. In ordinary picking the shaft therefore rides *under*
 * the pins and touches nothing; only lifting the tip high enough tilts the shaft up into them. That
 * is what makes shaft-fouling a cost of **overlifting** specifically, not of normal play (D-145).
 */
export const HAND_Y = FLOOR_Y - 1.0
/** Default reach: how deep the tip may be inserted, mm. Large enough for every stock lock. */
export const DEFAULT_REACH = 100

/**
 * Thickness of the pick's steel, mm — a **tool dimension**, not a line weight.
 *
 * It lives with the model rather than with the drawing because the keyway's floor is measured against
 * it: a pick is a strip with a body, and what rests on the bottom of the slot is its underside.
 */
export const BLADE_MM = 0.92
/**
 * The bottom of the keyway.
 *
 * Deep enough that the tool the model defines actually **fits**: a crest stands 2.3-2.6mm above the
 * shaft and the steel hangs `BLADE_MM` below it, so a pick lying clear of the pins needs better than
 * three and a half millimetres of slot. Reported from play — *"lockpick part can go beyond bottom of
 * keyway"* — and it was true by 0.32mm on the hook and 0.61mm on the rake. The drawing reads this
 * number rather than choosing its own, so the two cannot disagree again.
 */
export const KEYWAY_BOTTOM = -9.8
/** The lowest the shaft may be held: the blade's underside resting on the floor of the slot. */
export const TOOL_FLOOR = KEYWAY_BOTTOM + BLADE_MM

/**
 * How hard a key pin resists being pushed **across** a shear line the plug has already turned past,
 * per millimetre it is over-wide for the gap. See the wall itself, in §3.
 */
export const CROSS_K = 40
/**
 * How close two chambers' bind angles must be to bind **together**, radians.
 *
 * *"In rare situations two pins can [bind] at one time."* They can, and it needs nothing but honesty
 * about a strict inequality: two bodies within a few ten-thousandths of a millimetre of the same
 * width are both pinched by the same plug, not one and then the other. About one lock in thirty has
 * its two tightest chambers this close, which is the right kind of rare.
 */
export const CO_BIND = 0.0002

// ── Per-chamber individuality, rolled from the seed ────────────────────────────────────────

/** How much a chamber's spring may differ from nominal, ±. A stiff spring falls faster and reads heavier. */
export const SPRING_SPREAD = 0.22
/** How much a chamber's bore drag may differ, ±. A tight bore lifts *and* falls slower. */
export const DRAG_SPREAD = 0.15
/** How much a chamber's baseline feel may differ, ± — bore finish and pin fit. */
export const BIAS_SPREAD = 0.08

// ── Resistance readout — what the pin under the tool feels like, 0..1 ───────────────────────

/** The lightest a loaded pin ever reads: there is always a spring on top of it. */
export const RESIST_FLOOR = 0.05
/** Hooke: resistance added per mm of compression, so a pin held high pushes back harder. */
export const RESIST_PER_MM = 0.05
/** Felt weight per unit of spring strength over nominal — the individuality you can feel. */
export const RESIST_SPRING_K = 0.12
/** How hard you must be pushing before a pin reads fully, in mm of overreach. */
export const RESIST_PRESSURE_MM = 0.4

// ── Set-pin retention under tension ─────────────────────────────────────────────────────────

/** The tension a **barely** caught driver needs to stay caught — the worst case, not the rule. */
export const T_SET_HOLD = 0.16
/** How much of that a **fully engaged** driver does not need: the plug has the ledge well under it. */
export const HOLD_RELIEF = 0.75
/** Radians of plug rotation past a chamber's bind angle over which its ledge fully closes. */
export const LEDGE_ENGAGE = 0.12
/** Seconds a caught driver tolerates being under-tensioned before it lets go — where feathering lives. */
export const HOLD_GRACE = 0.22

// ── Pick strain — the tool bends and breaks ─────────────────────────────────────────────────

/** How fast strain builds while the tool is loaded against a pin that will not move. */
export const STRAIN_RATE = 1.6
/** How fast strain recovers with the tip unloaded, per second. */
export const STRAIN_EASE = 0.3
/** Past this the pick has taken a permanent set: it works, less well. */
export const STRAIN_BENT = 1.0
/** Past this it snaps and the attempt is over. */
export const STRAIN_BROKEN = 2.4
/** A bent pick is slower — a bowed shaft loses leverage. */
export const BENT_RATE = 0.72

/** Fixed tick. */
export const DT = 1 / 120

// ── Pins as silhouettes ───────────────────────────────────────────────────────────────────

/**
 * One slice of a driver pin, measured upward from the key/driver interface. `half` is the pin's
 * half-width at the band's bottom, in mm — at most `BORE_HALF`. If `topHalf` is given the band
 * **tapers** linearly to it at the top: a cone, which is all a mushroom's cap is. That is the entire
 * difference between the pin types, and it lives in data.
 */
export interface Band {
  readonly len: number
  readonly half: number
  /** If set, the band tapers from `half` at its bottom to `topHalf` at its top (a mushroom cap). */
  readonly topHalf?: number
}

export type ProfileKind = 'standard' | 'spool' | 'serrated' | 'mushroom'

/** The pin's half-width at height `local` above the interface (0 = the interface itself). */
function halfAt(bands: readonly Band[], local: number): number {
  if (local < 0) return 0
  let y = 0
  for (const b of bands) {
    if (local <= y + b.len) {
      if (b.topHalf === undefined) return b.half
      const f = b.len > 0 ? (local - y) / b.len : 0
      return b.half + (b.topHalf - b.half) * f
    }
    y += b.len
  }
  return 0
}

/** A standard driver: one full-width body. Binds and sets cleanly. */
function standardDriver(pinHalf: number): Band[] {
  return [{ len: 4.5, half: pinHalf }]
}

/**
 * A spool: a short foot, a long turned-down waist, then a wide head — sharp shoulders.
 *
 * Band order is bottom-to-top, so `local` runs from the interface upward. Lifting sweeps the shear
 * line *down* the driver toward the interface, so a locked spool (line in the waist) false-sets
 * under tension, jams as the line reaches the wide **foot**, and clears only once the interface
 * arrives. Sharp shoulders → a sharp false set and a sharp wall.
 */
function spoolDriver(pinHalf: number): Band[] {
  const waist = pinHalf * 0.62
  return [
    { len: 0.7, half: pinHalf },
    { len: 2.5, half: waist },
    { len: 1.3, half: pinHalf },
  ]
}

/** A serrated driver: a stack of teeth, each a shallow full/near-full step — many little lies. */
function serratedDriver(pinHalf: number): Band[] {
  const bands: Band[] = []
  for (let i = 0; i < 5; i += 1) {
    bands.push({ len: 0.45, half: i % 2 === 0 ? pinHalf : pinHalf * 0.82 })
  }
  bands.push({ len: 2.25, half: pinHalf })
  return bands
}

/**
 * A mushroom: a waist whose upper shoulder is a **cone**, not a square step.
 *
 * The tapered cap means the plug's ledge cams the pin gradually across the whole cone rather than
 * catching on one edge — so the plug is driven back continuously through a millimetre and a half of
 * lift, and a heavy hand, which cannot let the plug roll out, gets shoved down the entire way. That
 * is why a mushroom punishes a heavy hand hardest and wants the lightest touch in the box: it is a
 * spool with its wall spread into a ramp, and nothing here says so but the geometry.
 */
function mushroomDriver(pinHalf: number): Band[] {
  const waist = pinHalf * 0.66
  return [
    { len: 0.5, half: pinHalf }, // foot
    { len: 1.4, half: waist }, // waist
    { len: 1.6, half: waist, topHalf: pinHalf }, // the cap: a cone that cams the plug gradually
    { len: 1.0, half: pinHalf }, // head
  ]
}

function driverFor(kind: ProfileKind, pinHalf: number): Band[] {
  switch (kind) {
    case 'spool':
      return spoolDriver(pinHalf)
    case 'serrated':
      return serratedDriver(pinHalf)
    case 'mushroom':
      return mushroomDriver(pinHalf)
    case 'standard':
      return standardDriver(pinHalf)
  }
}

// ── A chamber ───────────────────────────────────────────────────────────────────────────

export interface ChamberDef {
  readonly index: number
  readonly boreX: number
  readonly kind: ProfileKind
  /** Key pin body length — the "bitting". A taller key pin needs less lift to reach the line. */
  readonly keyLen: number
  /** The key pin's own half-width. */
  readonly keyHalf: number
  readonly driver: readonly Band[]
  /** How long that driver is, mm — measured once, because the chamber's ceiling is derived from it. */
  readonly driverLen: number
  /** Manufacturing clearance A − pinHalf for this chamber, mm. The seed of binding order. */
  readonly clearance: number
  /** Spring rate as a multiplier on nominal. Stiff springs fall faster and read heavier. */
  readonly springStrength: number
  /** Bore drag as a multiplier around 1. Below 1 the pin lifts *and* falls slower. */
  readonly dragFactor: number
  /** This chamber's baseline feel offset — bore finish and pin fit, ±. */
  readonly resistanceBias: number
}

export interface Chamber {
  readonly def: ChamberDef
  /**
   * How far the stack's key/driver interface sits **above its rest height**, in mm. Rest puts the
   * interface at `FLOOR_Y + keyLen`; lifting by `setLift = -(FLOOR_Y + keyLen)` brings it to the line.
   *
   * This is the **driver**'s number, and it is the one the physics is about — binding, camming and
   * capture are all questions about where the driver sits relative to the shear line.
   */
  lift: number
  /**
   * The **key pin**'s own lift, mm — normally the same, and the tell when it is not.
   *
   * A key pin does not hang from the driver, it holds it up: so the two come apart the moment
   * something *else* is holding the driver — the plug's ledge under a set one, or a spool's shoulder
   * under a false-set one. The key pin then has nothing beneath it but the tool, and where the tool
   * is not, it falls to the bottom of the keyway and leaves a **visible gap**.
   *
   * That gap is the clearest tell in the whole picture that a pin is set (the game learned the same
   * thing the hard way — its D-042). Reported here as *"if you set the pin, the key pin then does not
   * fall down."* Nothing in the physics reads this; it is what the drawing needs in order to be true.
   */
  keyLift: number
  /** Set once the plug ledge has taken up under the driver and it rests on the shear line. */
  caught: boolean
  /** The plug angle when it caught — how much ledge is under it (its resistance to being lost). */
  caughtTheta: number
  /** Seconds this caught driver has spent below its own hold threshold (feathering lives here). */
  belowHoldFor: number
  // ── readouts, recomputed each tick for the renderer and the tests ──
  /** True when the interface is within `CAPTURE_SLACK` of the line: the plug may shear past here. */
  permits: boolean
  /** True when the pin is lifted *past* the line — the key pin is pinched across it (overset). */
  overset: boolean
  /** The half-width of whatever solid body is crossing the shear line right now, mm. */
  crossingHalf: number
  /** Radians the plug may turn before *this* chamber pinches, given where its pin sits now. */
  permittedTheta: number
  /**
   * The plug rotation at which this chamber's **full-width** driver binds: `2·clearance / R`.
   *
   * A constant of the chamber, and the thing capture and retention are measured against — "has the
   * plug taken up far enough to put a ledge under this driver, and is it still there?"
   *
   * It used to be **overwritten every tick** with whatever body happened to be crossing the shear
   * line (`c.bindAngle = c.permittedTheta`), which quietly gave one field two meanings. For a plain
   * driver they agree. For anything with a groove they do not: a spool or mushroom at its waist
   * permits a false-set-sized rotation, so `bindAngle` became a *large* angle, and capture then
   * demanded the plug turn that far before the pin could be set — which the other pins prevent.
   * The result was a deadlock exactly on the locks made of shaped pins: `solveLab` opened 67/110 of
   * the roster and **0/5** on each of the seven security locks, and the cause looked for weeks like
   * "the auto-picker cannot walk a stack of false sets". It was this line. With the two meanings
   * separated — `permittedTheta` varies, `bindAngle` does not — the same picker opens **110/110**.
   */
  bindAngle: number
  /** True when this chamber is the one holding the plug back this tick. */
  binding: boolean
  /** Normal force the plug is pressing into this pin with — the source of its heaviness. */
  pinch: number
  /** Downward mm/s the plug wedge is driving this pin, when it is cammed (spool/mushroom). */
  counterForce: number
  /** Torque this chamber's cammed shoulder is putting back into the wrench — see `CAM_TORQUE`. */
  camTorque: number
  /** What this chamber would feel like under the tool right now, 0..1. */
  feel: number
}

export interface Tooth {
  /** Offset from the **tip** along the keyway, mm. 0 is the tip; negative is back toward the mouth. */
  readonly dx: number
  /** Height of the tooth crest above the shaft, mm. */
  readonly height: number
}

export type ToolKind = 'hook' | 'rake'

export interface Tool {
  kind: ToolKind
  /** The tip position along the keyway, mm — how deep the pick is inserted. */
  x: number
  /** The shaft height at the tip, mm — how high the hand is lifting. The pick tilts about the hand. */
  lift: number
  /** How deep the tip can reach, mm. Chambers past it cannot be touched at all. */
  reach: number
  /** The tool's biting silhouette, riding on the shaft. A hook is one tooth; a rake is several. */
  readonly teeth: readonly Tooth[]
}

/** Half-width of a tool tooth — how much of a chamber it can be "under". */
export const TOOTH_HALF = 1.1

export interface LabInput {
  /** Where the hand is sliding the tool along the keyway, mm. */
  readonly toolX: number
  /** How high the hand is lifting/pressing the tool, mm. */
  readonly toolLift: number
  /** Tension held on the wrench, 0..1. */
  readonly tension: number
}

export interface LabState {
  readonly chambers: Chamber[]
  /** Not readonly: the harness swaps hook for rake in place. */
  tool: Tool
  /** Plug rotation, radians. */
  theta: number
  /** Tangential shift of the plug at the bore, mm — the sideways scissor you see in the view. Δ=Rθ. */
  shift: number
  tension: number
  /** Index of the binding chamber, or -1. */
  binding: number
  /** Index of the chamber the tool is loading, or -1 — the source of the resistance readout. */
  pickChamber: number
  /** What the chamber under the tool feels like right now, 0..1. */
  resistance: number
  /**
   * How hard the lock is pushing the wrench **back**, in the same units as `tension`.
   *
   * Above `tension` the plug is losing ground however hard you hold it — that is the spool talking,
   * and the cue to let up very lightly. See `CAM_TORQUE`.
   */
  counterTorque: number
  /** Accumulated load on the pick, 0..∞. Past `STRAIN_BENT` it is bent; past `STRAIN_BROKEN`, snapped. */
  pickStrain: number
  pickBent: boolean
  pickBroken: boolean
  opened: boolean
  time: number
  rng: RngState
}

// ── Construction ──────────────────────────────────────────────────────────────────────────

/**
 * An explicit chamber, so a caller (the `src/sim` adapter) can build a lab from a real lock's pins
 * and bitting instead of the built-in `kinds`. `driver` receives the chamber's pin half-width and
 * returns its silhouette, so a groove can be expressed as a fraction of the pin radius.
 */
export interface ChamberSpec {
  readonly kind: ProfileKind
  /** Key pin length, mm. Sets `setLift = -(FLOOR_Y + keyLen)` — how far to lift to reach the line. */
  readonly keyLen: number
  /** Absolute clearance, mm; if omitted, rolled from the seed and scaled by `toleranceQuality`. */
  readonly clearance?: number
  readonly driver: (pinHalf: number) => Band[]
}

export interface LabOptions {
  readonly kinds?: readonly ProfileKind[]
  /** Explicit chambers (e.g. from a real `LockDef`); takes precedence over `kinds`. */
  readonly chambers?: readonly ChamberSpec[]
  readonly seed?: number
  readonly tool?: ToolKind
  /** Difficulty: scales the clearance spread. 1 is nominal; below 1 is a tighter, harder lock. */
  readonly toleranceQuality?: number
}

export function makeHook(reach = DEFAULT_REACH): Tool {
  return { kind: 'hook', x: 0, lift: 0, reach, teeth: [{ dx: 0, height: 2.3 }] }
}

/**
 * A rake: a row of teeth of stepped heights running back from the tip toward the mouth. Scrubbed
 * back and forth it lifts each pin it passes to the tooth surface under it and lets it fall behind —
 * the continuous contact an impulse rake never had (D-025).
 */
export function makeRake(reach = DEFAULT_REACH): Tool {
  const teeth: Tooth[] = []
  const heights = [2.0, 2.6, 1.9, 2.4, 1.6]
  for (let i = 0; i < heights.length; i += 1) {
    teeth.push({ dx: -i * PITCH, height: heights[i] as number })
  }
  return { kind: 'rake', x: 0, lift: 0, reach, teeth }
}

/** Assemble a chamber from its resolved geometry — no RNG, so callers control the draw order. */
function makeChamber(
  index: number,
  kind: ProfileKind,
  keyLen: number,
  pinHalf: number,
  clearance: number,
  driver: readonly Band[],
  springStrength: number,
  dragFactor: number,
  resistanceBias: number,
): Chamber {
  const def: ChamberDef = {
    index,
    boreX: index * PITCH,
    kind,
    keyLen,
    keyHalf: pinHalf,
    driver,
    driverLen: driver.reduce((sum, b) => sum + b.len, 0),
    clearance,
    springStrength,
    dragFactor,
    resistanceBias,
  }
  return {
    def,
    lift: 0,
    keyLift: 0,
    caught: false,
    caughtTheta: 0,
    belowHoldFor: 0,
    permits: false,
    overset: false,
    crossingHalf: pinHalf,
    permittedTheta: 0,
    bindAngle: (2 * clearance) / PLUG_RADIUS,
    binding: false,
    pinch: 0,
    counterForce: 0,
    camTorque: 0,
    feel: 0,
  }
}

export function createLab(opts: LabOptions = {}): LabState {
  const quality = opts.toleranceQuality ?? 1
  const rng = createRng(opts.seed ?? 0x5ea51e)
  const rolledClearance = (): number => (0.03 + Math.abs(nextSigned(rng, 0.035))) * quality
  const chambers: Chamber[] = opts.chambers
    ? opts.chambers.map((spec, index) => {
        const clearance = spec.clearance ?? rolledClearance()
        const pinHalf = BORE_HALF - clearance
        const springStrength = 1 + nextSigned(rng, SPRING_SPREAD)
        const dragFactor = 1 + nextSigned(rng, DRAG_SPREAD)
        const resistanceBias = nextSigned(rng, BIAS_SPREAD)
        return makeChamber(index, spec.kind, spec.keyLen, pinHalf, clearance, spec.driver(pinHalf), springStrength, dragFactor, resistanceBias)
      })
    : (opts.kinds ?? ['standard', 'standard', 'spool', 'standard', 'serrated']).map((kind, index) => {
        // Per-chamber manufacturing clearance: a few hundredths of a millimetre, different every
        // chamber. This — nothing else — is what makes the pins bind one at a time and in an order.
        const clearance = rolledClearance()
        const pinHalf = BORE_HALF - clearance
        // Key pin length varies a little so setLift differs per chamber, like a real bitting.
        const keyLen = 3.6 + nextSigned(rng, 0.5)
        const springStrength = 1 + nextSigned(rng, SPRING_SPREAD)
        const dragFactor = 1 + nextSigned(rng, DRAG_SPREAD)
        const resistanceBias = nextSigned(rng, BIAS_SPREAD)
        return makeChamber(index, kind, keyLen, pinHalf, clearance, driverFor(kind, pinHalf), springStrength, dragFactor, resistanceBias)
      })
  const tool = opts.tool === 'rake' ? makeRake() : makeHook()
  return {
    chambers,
    tool,
    theta: 0,
    shift: 0,
    tension: 0,
    binding: -1,
    pickChamber: -1,
    resistance: 0,
    counterTorque: 0,
    pickStrain: 0,
    pickBent: false,
    pickBroken: false,
    opened: false,
    time: 0,
    rng,
  }
}

/** Lift that brings a chamber's interface exactly to the shear line. */
export function setLift(c: Chamber): number {
  return -(FLOOR_Y + c.def.keyLen)
}

// ── The tick ────────────────────────────────────────────────────────────────────────────

/**
 * The half-width of the solid body crossing the shear line in chamber `c`, and whether the
 * interface itself is at the line (a clean shear — the plug may pass). The whole geometric heart of
 * the model: either the interface is at the line (permit), a driver band is (a body to pinch), or —
 * lifted too far — the key pin is (overset, a body to pinch on the other side).
 */
function crossing(c: Chamber): { permit: boolean; half: number } {
  const interfaceY = FLOOR_Y + c.def.keyLen + c.lift
  const d = SHEAR_Y - interfaceY // >0: interface below the line, driver crosses it
  if (Math.abs(d) <= CAPTURE_SLACK) return { permit: true, half: 0 }
  if (d > 0) return { permit: false, half: halfAt(c.def.driver, d) }
  const keyBottomToLine = c.def.keyLen - -d
  if (keyBottomToLine < 0) return { permit: false, half: 0 } // lifted clean out (not reachable here)
  return { permit: false, half: c.def.keyHalf }
}

/** The half-width of the body that would cross the shear line if this pin sat at `lift`. */
function crossingHalfAtLift(c: Chamber, lift: number): number {
  const interfaceY = FLOOR_Y + c.def.keyLen + lift
  const d = SHEAR_Y - interfaceY
  if (Math.abs(d) <= CAPTURE_SLACK) return 0
  if (d > 0) return halfAt(c.def.driver, d)
  const keyBottomToLine = c.def.keyLen - -d
  if (keyBottomToLine < 0) return 0
  return c.def.keyHalf
}

/** Radians the plug may turn before a body of half-width `half` is pinched between the two bores. */
function permittedTheta(half: number): number {
  // The passage between plug bore and shell bore is (2A − Δ) wide; the body (2·half) is pinched
  // when Δ > 2(A − half). So the rotation this body allows is 2(A − half)/R.
  return (2 * (BORE_HALF - half)) / PLUG_RADIUS
}

/** Where the hand is holding this tool — always its own length behind the point. */
export function handX(tool: Tool): number {
  return Math.min(tool.x, tool.reach) - SHANK_LEN
}

/** The pick's shaft (top edge) height at keyway position `x` — the rigid lever from hand to tip. */
export function toolShaftY(tool: Tool, x: number): number {
  const tipX = Math.min(tool.x, tool.reach)
  const hx = tipX - SHANK_LEN
  return HAND_Y + (tool.lift - HAND_Y) * clamp01((x - hx) / SHANK_LEN)
}

/**
 * The tool's surface height beneath chamber `c`, or null if the tool is not over it.
 *
 * The pick is a rigid strip from the hand pivot to the tip: the shaft top edge runs along that line,
 * so lifting the tip high **tilts the shaft up under the pins between the tip and the mouth** (D-145)
 * — a cost of overlifting, since a shaft held low touches nothing. Teeth are triangular bumps riding
 * on the shaft — a peak at the centre sloping to the shaft at its edges, so a pin *skates up and down
 * the faces* as the tool slides rather than snapping to a flat crest (a hook is one tooth at the tip;
 * a rake several, back toward the mouth). Past the tip — including past `reach` — there is no tool at
 * all (D-015). The heights match what `render`/`view` draw, so the picture and the physics are one.
 */
export function toolHeightAt(tool: Tool, x: number): number | null {
  const tipX = Math.min(tool.x, tool.reach)
  if (x < tipX - SHANK_LEN || x > tipX + TOOTH_HALF) return null
  let best = toolShaftY(tool, Math.min(x, tipX))
  for (const t of tool.teeth) {
    const tx = tipX + t.dx
    const dist = Math.abs(x - tx)
    if (dist <= TOOTH_HALF) {
      const h = toolShaftY(tool, Math.min(tx, tipX)) + t.height * (1 - dist / TOOTH_HALF)
      if (h > best) best = h
    }
  }
  return best
}

/**
 * The support a key pin gets from the tool — the **highest tool point anywhere under the pin's flat
 * bottom**, not the height at its centre. A pin is a rectangle wider than a tooth, so a tooth peak
 * beneath its edge lifts it exactly as one beneath its centre, and the sloped faces under any part
 * of its footprint bear on it. (Sampling only the centre — the bug behind this — meant a pin rose
 * only when a crest met its middle, and the tooth flanks did nothing.) The shaft is linear and the
 * teeth piecewise-linear, so the max over the footprint sits at an edge of it, a tooth peak, a tooth
 * flank, or the tip; evaluate those and take the highest.
 */
function toolSurfaceUnder(tool: Tool, c: Chamber): number | null {
  const half = c.def.keyHalf
  const x0 = c.def.boreX - half
  const x1 = c.def.boreX + half
  const tipX = Math.min(tool.x, tool.reach)
  const candidates = [x0, x1, clamp(tipX, x0, x1)]
  for (const t of tool.teeth) {
    for (const cx of [tipX + t.dx - TOOTH_HALF, tipX + t.dx, tipX + t.dx + TOOTH_HALF]) {
      if (cx > x0 && cx < x1) candidates.push(cx)
    }
  }
  let best: number | null = null
  for (const x of candidates) {
    const h = toolHeightAt(tool, x)
    if (h !== null && (best === null || h > best)) best = h
  }
  return best
}

/**
 * The tension a caught driver needs to stay on its ledge.
 *
 * The more the plug has swung past this chamber's bind angle, the more brass is under the driver and
 * the less it asks of the wrench — which is what makes the newest, least-engaged pin always the first
 * to go. Shared by the two places that must agree about it: **capture** and **retention**.
 */
function holdThreshold(c: Chamber, theta: number): number {
  return T_SET_HOLD * (1 - HOLD_RELIEF * clamp01((theta - c.bindAngle) / LEDGE_ENGAGE))
}

export function step(state: LabState, input: LabInput, dt: number = DT): LabState {
  const { chambers, tool } = state
  const T = clamp01(input.tension)
  state.tension = T
  tool.x = input.toolX
  // The pick rests on the bottom of the keyway; it cannot be pressed through the plug.
  tool.lift = Math.max(input.toolLift, TOOL_FLOOR)
  // The chamber the plug was resting on last tick. When *that* pin's interface reaches the window,
  // the ledge is certain to take it — even though the instant it permits another chamber becomes
  // the new binding limiter.
  const prevBinding = state.binding

  // ── 1. Read the geometry: what each chamber permits right now ────────────────────────────
  let cap = THETA_OPEN
  let binding = -1
  /**
   * The widest body the two bores will pass at this angle. Everything about camming, crossing and
   * oversetting is one comparison against this number.
   */
  const bearHalf = BORE_HALF - (PLUG_RADIUS * state.theta) / 2
  for (const c of chambers) {
    const interfaceY = FLOOR_Y + c.def.keyLen + c.lift
    const { permit, half } = crossing(c)
    c.permits = permit
    c.crossingHalf = half
    /**
     * Overset is being **trapped** above the line, not merely lifted past it.
     *
     * A key pin driven across the shear line only stays there if the plug is pinching it — if it is
     * at least as wide as the passage between the two bores. The chamber holding the plug back is
     * exactly that wide (a jam fit), which is why the pin you are working is the one a heavy hand
     * oversets. A *looser* chamber's key pin slips through the same passage with room to spare, so
     * nothing holds it: it goes up, and it comes straight back down when the tool leaves.
     *
     * Reported from play, twice: *"only [the binding] pin can be overset"*, *"I can not overset [a]
     * non-[binding] pin."* Both are this one clause. Without it a pin was overset by *geometry alone*
     * — above the line, therefore stuck — with nothing asked about what was holding it there.
     */
    c.overset =
      !permit && interfaceY > SHEAR_Y && c.def.keyHalf >= bearHalf - 1e-9
    c.permittedTheta = permit ? THETA_OPEN : permittedTheta(half)
    if (!c.caught && c.permittedTheta < cap) {
      cap = c.permittedTheta
      binding = c.def.index
    }
  }
  state.binding = binding

  // ── 2. Turn the plug — forward into what the pins allow, backward only if tension lets go ──
  const demand = THETA_OPEN * clamp01(T / T_FULL_TURN)
  const net = T - state.counterTorque
  if (state.theta > cap + 1e-9) {
    // Over-rotated: a pin has moved and no longer permits this angle. Easing lets the plug back out.
    const backOut = TAKEUP_RATE * clamp01(1 - T / T_BACKOUT)
    state.theta = Math.max(cap, state.theta - backOut * dt)
  } else if (net < 0) {
    /**
     * **The cam is winning.** The lock is turning your wrench back, and it will keep turning it
     * back until the two balance — which is a *smaller* angle, where the shoulder overhangs less.
     * Let it: as the plug rolls back the wall under the pin narrows with it, and the pin you are
     * pushing climbs. That is the whole technique, and it is why this is a torque on the plug and
     * never a shove on the pin.
     *
     * Hold hard enough and `net` never goes negative: the false set is a wall and you are stuck at
     * it. Let go entirely and the plug runs back to nothing, taking every set pin with it. The
     * window between those two is where a lock like this is picked.
     */
    state.theta = Math.max(0, state.theta - CAM_BACK_RATE * Math.min(1, -net) * dt)
  } else {
    state.theta = moveToward(state.theta, Math.min(demand, cap), TAKEUP_RATE * dt)
  }
  state.theta = clamp(state.theta, 0, THETA_OPEN)
  state.shift = PLUG_RADIUS * state.theta

  // Which chamber the tool is loading — the nearest one it is actually under. Drives the readout.
  const pickChamber = state.pickBroken ? -1 : nearestToolChamber(state)
  state.pickChamber = pickChamber
  let toolLoad = 0

  // ── 3. Move the pins ─────────────────────────────────────────────────────────────────────
  for (const c of chambers) {
    const crest = state.pickBroken ? null : toolSurfaceUnder(tool, c)
    // How high the hand is *asking* this pin to go, before the lock has its say. A pin can be driven
    // up to its physical ceiling — its driver's head against the top of its own chamber, the spring
    // gone solid — and no further, so no pin is ever driven out through the top of the lock.
    // Feel and strain are measured against the ask, so leaning on a pin that cannot move still reads
    // as load — which is how you break a pick on one.
    const commanded = crest === null ? 0 : clamp(crest - FLOOR_Y, 0, setLift(c) + oversetRoom(c))
    /**
     * **Crossing the shear line: how hard, not whether.**
     *
     * Oversetting means driving the key pin *across* the line, and the key pin is full width: it only
     * goes if the two bores are still nearly aligned. The moment anything holds the plug turned — a
     * bound driver, a false set, another pin already overset — every key pin in the lock meets the
     * shell's bore **edge** instead of its bore. But a pin at that edge is a jam fit, and a jam fit
     * answers to force: `crossWall` is how much force, growing with how far past this chamber's own
     * clearance the plug has been turned. `keyHalf = BORE_HALF − clearance`, so the comparison *is*
     * the clearance — no new geometry, only `CROSS_K`.
     *
     * Four play reports, one wall. The chamber holding the plug back is exactly at the boundary and
     * costs nothing: *"only [the binding] pin can be overset"*, *"I can not overset [a] non-[binding]
     * pin."* A chamber that has just set sits a couple of hundredths past it and a firm heave carries
     * it: *"setted pin I can overset with more pressure."* A pin behind a **false set** is half a
     * millimetre over-wide, which at this rate is past anything a hand can push: *"if one is
     * [overset], you can not overset others"*, and *"some of them will never [overset]."*
     *
     * `bearHalf` is read from **§1**, before this tick's take-up: the plug only turned because the
     * pin arrived, so charging the pin for a rotation its own arrival caused would settle the race
     * against it every time. And a pin whose interface is already above the line is **committed** —
     * its top is in the shell's bore, and turning the plug traps it there rather than pushing it out.
     */
    const keyTop = FLOOR_Y + c.def.keyLen + c.lift
    /**
     * The wall exists only **at the line**, in the last fraction of a millimetre before the key pin's
     * top would enter the shell. Below that the pin is inside the plug's own bore with nothing in its
     * way — charging it the whole climb was the first version of this, and it walled spools at their
     * waists, which is a different mechanism entirely and already has one.
     */
    const atLine = keyTop > -CAPTURE_SLACK && keyTop <= SHEAR_Y
    const crossWall =
      c.overset || !atLine ? 0 : CROSS_K * Math.max(0, c.def.keyHalf - bearHalf)
    const targetLift = commanded

    // The binding chamber carries the plug's whole thrust; every other pin rides free. This normal
    // force is what Coulomb friction acts on, and why the one pin that matters feels heavy.
    // Binding is a *contact*, not a rank: every chamber the plug is pinched against at this angle
    // is bound, and once in a while two are within a hair of each other and go together (`CO_BIND`).
    c.binding = !c.caught && !c.permits && c.permittedTheta <= cap + CO_BIND
    c.pinch = c.binding ? T : 0
    c.counterForce = 0
    c.camTorque = 0

    // Individuality: a tight bore is slow both ways; a stiff spring falls faster; a bent pick drags.
    const bend = state.pickBent ? BENT_RATE : 1
    const liftRate = TOOL_RATE * c.def.dragFactor * bend
    const fallRate = SPRING_RATE * c.def.dragFactor * c.def.springStrength

    // Resistance/feel: friction on a bound pin, spring compression (Hooke), and the chamber's own
    // character. All emergent — no per-state table.
    const compression = c.def.springStrength * Math.max(0, c.lift) * RESIST_PER_MM
    const character = c.def.resistanceBias + (c.def.springStrength - 1) * RESIST_SPRING_K
    const contact = crest === null ? 0 : clamp01((commanded - Math.max(0, c.lift)) / RESIST_PRESSURE_MM)
    /**
     * A pin the lock will barely let move reads **solid**. Without this, leaning on a key pin that
     * cannot cross a turned shear line felt like pushing on nothing: the pin is not bound (something
     * else holds the plug), its spring is not compressing, and every term above was small. It is the
     * stiffest thing in the lock, and it is what breaks picks.
     */
    c.feel = clamp01(RESIST_FLOOR + MU * c.pinch + compression + character + clamp01(crossWall / 8))
    if (c.def.index === pickChamber) {
      state.resistance = c.feel * (RESIST_FLOOR + (1 - RESIST_FLOOR) * contact)
      toolLoad = contact * c.feel
    }

    // ── A caught driver: held on the ledge, but only while the wrench asks enough ──
    if (c.caught) {
      const hold = holdThreshold(c, state.theta)
      if (state.theta < c.bindAngle - 1e-3) {
        // The plug has turned back past this chamber's ledge — there is nothing under the driver
        // any more and it falls in. A well-engaged pin (plug swung well past its bind angle)
        // survives a dip that a barely-caught one does not, which is exactly the feather.
        c.caught = false
        c.belowHoldFor = 0
      } else if (T < hold) {
        // Under-tensioned. It survives a brief dip (the feather) but not a held-light wrench, and
        // the least-engaged pin — the newest — is always the first to go.
        c.belowHoldFor += dt
        if (c.belowHoldFor > HOLD_GRACE) {
          c.caught = false
          c.belowHoldFor = 0
        } else {
          c.lift = moveToward(c.lift, setLift(c), liftRate * dt)
          continue
        }
      } else if (crest !== null && commanded > setLift(c) + CAPTURE_SLACK + 0.15) {
        // The ledge is *below* the driver, so it never stops the tool driving the driver up off it:
        // push the key pin up into the driver and beyond and the pin oversets — the commonest way to
        // lose a set pin (D-051, which gave a set chamber the full travel like any other). It falls
        // through to the rise/overset logic below and climbs into overset. The trigger sits above the
        // set *window* so that merely holding a pin at set (or a picker's firm set-push) never trips it.
        c.caught = false
      } else {
        c.belowHoldFor = 0
        c.lift = moveToward(c.lift, setLift(c), liftRate * dt)
        continue
      }
      // fell through: it just came loose this tick — let it rise/fall like any free pin, below.
    }

    // ── An overset pin: its key pin is pinned across the shear line ──
    // It does not fall while the plug is turned — it is held there by the plug, not the tool. But the
    // tool can still drive it **deeper** against the pinch: you can always overset further, it just
    // takes force (μ·T of friction). Drop tension (θ → 0) and it falls clear — overset recovery.
    if (c.overset && state.theta > 0.004) {
      if (crest !== null && targetLift > c.lift) {
        const push = clamp01((targetLift - c.lift) / 0.3)
        c.lift = moveToward(c.lift, targetLift, liftRate * clamp01(push - MU * T) * dt)
      }
      continue
    }

    if (crest !== null && targetLift > c.lift) {
      // Rising against three things: bore friction (μ·N on the binding pin), the spring stiffening as
      // it compresses (Hooke — the higher it is, the more force), and the **wall** — how much wider
      // the shoulder just above the tip is than the offset plug bore can pass. A spool's foot spikes
      // the wall so hard that at working tension the hand's push is saturated and the pin **cannot**
      // be forced through; ease the wrench (§2 rolls the plug back, the shoulder narrows) and it
      // climbs. All three only *slow* the climb — nothing shoves the pin back — so no buzz.
      const maxHalf = BORE_HALF - (PLUG_RADIUS * state.theta) / 2
      const over = Math.max(0, crossingHalfAtLift(c, c.lift + CAM_LOOKAHEAD) - maxHalf)
      const wall = CAM_K * c.pinch * over
      c.counterForce = wall // the false set — a wide shoulder walling the climb
      // Push is NOT clamped at 1: how far past the pin the hand is reaching *is* the force behind it,
      // so a hard heave carries far more than a set-push. That is what lets a deliberate heave bull a
      // false-set spool straight through its foot into overset (a mistake), while a gentle set-push —
      // or the picker trying to set it — stays walled and must ease the wrench (owner's call).
      const push = Math.min(20, (targetLift - c.lift) / 0.3)
      /**
       * ...and the same contact, read as a torque on the plug: **counter-rotation**.
       *
       * The shoulder you are driving the pin into is a step, and the shell's bore edge that stops it
       * is offset. Pushing a step up into an offset corner gives a reaction with a sideways component,
       * the pin hands it to the plug's bore wall, and the plug is shoved *back out* — which is why a
       * spool fights the wrench rather than merely refusing to move. `CAM_TORQUE` is the chamfer.
       *
       * Two things follow from where this is computed, and both are the behaviour a picker describes.
       * It scales with **your own push**: the lock only fights while you are leaning on it — *"as it
       * starts to push against the direction you're pushing"*. And a *parked* false set, one you have
       * walked up and left to work another pin, produces none: a false set is stable, and a stack of
       * them must not unwind itself while your hands are elsewhere.
       */
      c.camTorque = CAM_TORQUE * over * clamp01(push)
      const friction = MU * c.pinch
      const spring = SPRING_STIFFEN * c.def.springStrength * Math.max(0, c.lift)
      // A pin bearing on the shell's bore edge is not free however loose it is: the whole point of
      // the wall is that it has to be *pushed* past, and `FREE_LIFT_GAIN` would waft it through.
      const free = (c.permits || !c.binding) && crossWall === 0
      const gain = clamp01((free ? FREE_LIFT_GAIN : push - friction) - wall - crossWall - spring)
      c.lift = moveToward(c.lift, targetLift, liftRate * gain * dt)
    } else {
      const rest = crest === null ? 0 : Math.max(0, targetLift)
      // A false set holds against the spring even with the tool gone. To fall, a wider shoulder of the
      // driver above the tip would have to descend past the offset plug bore — and it cannot: the plug
      // has counter-rotated under that shoulder and bears it. So the pin parks on the ledge and does
      // not sink below it (the plug holds it, not the tool). It needs tension to keep the plug wedged;
      // below `T_BACKOUT` the plug eases back and the shoulder clears, so the stack drops — which is
      // exactly how easing the wrench walks a spool up, and how releasing resets the lock. Caught and
      // overset pins were already handled above; this is what lets a *false* set survive the tool
      // moving off to work another pin, so a stack of spools/serrations can be built up at all.
      const maxHalf = BORE_HALF - (PLUG_RADIUS * state.theta) / 2
      const ledge = T >= T_BACKOUT && rest < c.lift ? crossingHalfAtLift(c, c.lift - CAM_LOOKAHEAD) - maxHalf : 0
      if (ledge > FALSE_SET_LEDGE) {
        c.counterForce = CAM_K * Math.max(c.pinch, FALSE_SET_PINCH) * ledge // parked on the ledge — a false set
      } else {
        c.lift = moveToward(c.lift, rest, fallRate * dt)
      }
    }

    // Capture: the interface reached the window while the plug has taken up under this driver — and
    // the hand is not heaving it on past the set point (that is an overset, not a set).
    const engaged = state.theta >= c.bindAngle - 1e-4 || c.def.index === prevBinding
    /**
     * **The ledge does not ask what your hand is doing.**
     *
     * Capture used to refuse while the tool was commanded above the window (`settling`), which is a
     * fact about the *hand*, not about the lock: the plug's ledge slides under a driver the instant
     * the driver clears the line, whatever the hand is reaching for. With a mouse that made the
     * difference between setting a pin and oversetting it a matter of landing the pointer inside
     * 0.22mm — about ten pixels — and anything past that overset with no resistance at all. Reported
     * as *"there is a green area to where you need to lift the driver pin, but when you lift just a
     * bit past it the lock oversets instantly, which should not be true because there is a gap."*
     *
     * So the ledge takes it, and what happens next is retention's business: keep pushing hard enough
     * (`CAPTURE_SLACK + 0.15` past the set point) and you drive the driver back off its ledge and
     * overset it, exactly as before. The tolerance is a real one now — a firm heave, not a pixel.
     */
    /**
     * **A ledge you cannot hold is not a ledge you can catch on.**
     *
     * Capture used to ask nothing of the wrench beyond "some", while retention asked for
     * `holdThreshold`. Between those two numbers sat a trap: a pin would capture, sit out its grace
     * period under-tensioned, let go, fall for part of a tick — and be re-captured by this very line
     * before the tick ended, because it was still inside the window. Round and round, about nine
     * times a second. Reported from play as *"if I set tension level to 1, the set driver pins start
     * to jump"*, and at level 1 (0.14) against a fresh pin's threshold (0.158) it was every pin,
     * every time. Level 2 and up never saw it.
     *
     * Asking the same question in both places closes it, and says something true while it is at it:
     * too light a wrench does not set pins. It leaves them sitting at the shear line.
     */
    const holdable = T >= holdThreshold(c, state.theta)
    if (!c.caught && c.permits && state.theta > 0.004 && engaged && holdable) {
      c.caught = true
      c.caughtTheta = state.theta
      c.belowHoldFor = 0
    }
  }

  /**
   * **The key pin rests on whatever is under it, and never passes through the driver above it.**
   *
   * One rule, and both halves of the behaviour fall out of it. While the key pin is what is doing the
   * lifting, its support *is* the tool and the driver *is* above it, so the two move as one and there
   * is nothing to see. The moment the lock takes the driver — caught on the plug's ledge, or parked on
   * a spool's shoulder — the key pin is left with only the tool beneath it, and where the tool has
   * gone, the bottom of the keyway is what it lands on. That gap is the clearest tell in the drawing
   * that a pin is set, and it was missing: *"if you set the pin, the key pin then does not fall down."*
   *
   * The exception is an overset pin: there the **key pin itself** is the body pinched across the shear
   * line, so it is resting on nothing and cannot fall.
   *
   * A pass of its own, after the tool has been blocked (§4) and therefore after every `lift` this tick
   * is final — and because the branches above return early for exactly the chambers this is about.
   */
  for (const c of chambers) {
    const crest = state.pickBroken ? null : toolSurfaceUnder(tool, c)
    const support = crest === null ? 0 : Math.max(0, crest - FLOOR_Y)
    const wants = c.overset ? c.lift : Math.min(c.lift, support)
    if (wants >= c.keyLift) c.keyLift = wants
    else c.keyLift = moveToward(c.keyLift, wants, SPRING_RATE * c.def.dragFactor * dt)
    // A falling driver *shoves* its key pin down — it does not wait for it. So the ceiling is applied
    // last and without a rate: nothing may end a tick with a key pin inside the driver above it.
    c.keyLift = Math.min(c.keyLift, c.lift)
  }

  /**
   * How hard the lock is turning the wrench back, taken over the chambers that are camming.
   *
   * Read by §2 on the **next** tick, which is the honest ordering: the plug turns on the contacts as
   * they stood when it started turning. One tick at 120Hz.
   */
  let camMax = 0
  let camSum = 0
  for (const c of chambers) {
    camSum += c.camTorque
    if (c.camTorque > camMax) camMax = c.camTorque
  }
  state.counterTorque = camMax + CAM_SHARE * (camSum - camMax)

  // ── 4. The pick is a rigid body — pins it cannot move block it ────────────────────────────
  //
  // The commanded lift drove the pins above. Where a pin could not follow — pinned overset, or bound
  // harder than the push — it lagged the tool, and a rigid pick **cannot pass through a pin**. So the
  // tool stops at the most-blocking pin it is under and the rest of the throw goes into flex: once it
  // cannot be moved, it does not move. A free pin's one-tick catch-up is not a block and is exempt.
  // Only the tool's drawn position changes — the pins already resolved above against the command.
  let block = 0
  for (const c of chambers) {
    const surf = toolSurfaceUnder(tool, c)
    if (surf === null) continue
    // How far the commanded tool surface is above where the pin actually sits — the pierce. A free
    // pin's one-tick catch-up is not a block; anything beyond it is the pick trying to pass through.
    const freeReach = TOOL_RATE * FREE_LIFT_GAIN * c.def.dragFactor * dt
    const lag = surf - FLOOR_Y - c.lift - freeReach
    if (lag > block) block = lag
  }
  // The tool simply stops at the most-blocking pin — it does not move further, and it does not bend.
  // The hand can carry on; the pick does not follow past the pin.
  if (block > 0) {
    tool.lift -= block
    // The pins were resolved against the *commanded* lift, but the pick actually stopped lower — so
    // any pin merely resting on the tool must rest on the lowered shaft, not float up on one drawn
    // where the pick is not. Pull them down to where the pick really is. A pinned overset pin or a
    // caught pin is held by the lock, not the tool, so it stays. This is what stops the rest of the
    // pins drifting while the blocked pick stands still.
    for (const c of chambers) {
      if (c.caught || (c.overset && state.theta > 0.004)) continue
      const surf = toolSurfaceUnder(tool, c)
      if (surf !== null) c.lift = Math.min(c.lift, Math.max(0, surf - FLOOR_Y))
    }
  }

  // ── 5. Pick strain — pushing hard on a pin that will not give ─────────────────────────────
  state.pickStrain = Math.max(0, state.pickStrain + (toolLoad * STRAIN_RATE - STRAIN_EASE) * dt)
  if (state.pickStrain >= STRAIN_BENT) state.pickBent = true
  if (state.pickStrain >= STRAIN_BROKEN) state.pickBroken = true

  // ── 6. Open? ─────────────────────────────────────────────────────────────────────────────
  const allCaught = chambers.every((c) => c.caught)
  if (allCaught && state.theta >= THETA_OPEN * OPEN_FRACTION) state.opened = true

  state.time += dt
  return state
}

/** The chamber the tool is most under (nearest to the handle among those a tooth covers), or -1. */
function nearestToolChamber(state: LabState): number {
  let best = -1
  let bestD = Infinity
  for (const c of state.chambers) {
    if (toolSurfaceUnder(state.tool, c) === null) continue
    const dd = Math.abs(state.tool.x - c.def.boreX)
    if (dd < bestD) {
      bestD = dd
      best = c.def.index
    }
  }
  return best
}

/** A compact snapshot for tests and traces — no methods, cheap to diff. */
export interface LabSnapshot {
  readonly theta: number
  readonly shift: number
  readonly binding: number
  readonly opened: boolean
  readonly resistance: number
  readonly lifts: readonly number[]
  readonly keyLifts: readonly number[]
  readonly caught: readonly boolean[]
  readonly overset: readonly boolean[]
  readonly permits: readonly boolean[]
}

export function snapshot(state: LabState): LabSnapshot {
  return {
    theta: state.theta,
    shift: state.shift,
    binding: state.binding,
    opened: state.opened,
    resistance: state.resistance,
    lifts: state.chambers.map((c) => c.lift),
    keyLifts: state.chambers.map((c) => c.keyLift),
    caught: state.chambers.map((c) => c.caught),
    overset: state.chambers.map((c) => c.overset),
    permits: state.chambers.map((c) => c.permits),
  }
}
