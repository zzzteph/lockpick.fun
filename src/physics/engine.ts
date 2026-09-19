/**
 * The 2.5D contact solver (`src/solver/`) behind the sandbox bench — experiment 3, 2026-09-13.
 *
 * The bench ran on the game's 1-D rate sim until now, and the front view exposed what a 1-D model
 * cannot say: in a false set the plug has turned, so every other straddling pin is pinched by the
 * offset bores and cannot be pushed through — yet the 1-D sim still named one of them "binding"
 * and let it set (owner: *"when I got the false set … I still be able to push and set the normal
 * pin"*). The solver has that geometry for real: the plug is a disc, bores are offset per chamber,
 * pins are rigid polygons with a cant that the bore walls bound (nothing enters the shell), and
 * the pick is a rigid polygon that touches a pin wherever it actually meets it — the owner's
 * "press on every part of the pin".
 *
 * This file is the seam: it builds a solver lock from a roster lock (the mapping `solverbench`
 * arrived at), steps the solver from a tip target and a wrench, and pours each tick into the
 * game's `SimState` so the game's HUD can read it. Nothing in `src/sim` or `src/solver/` changes.
 */

import type { ChamberState, DriverProfile, LockDef as GameLockDef, SimConfig, SimState } from '../sim'
import { THETA_OPEN as SIM_THETA_OPEN, createRng, createSimState, minimumSetLift, nextFloat, profileByName } from '../sim'
import {
  BODY_PLUG,
  DEFAULT_PARAMS,
  DOF,
  DT,
  PICK_FLEX,
  PICK_REACH,
  aimTip,
  circleY,
  createLock,
  plugAngle,
  readChamber,
  readPick,
  step,
  type ChamberReadout,
  type HandPose,
  type PickProfile,
  type PinBody,
  type LockDef,
  type Params,
  type PickReadout,
  type PinProfile,
  type SolverInput,
  type SolverState,
} from '../solver'

const DEG = Math.PI / 180

/** The solver's own hand: 12 N. The 6 N of `solverbench` could not lift a pin bound at pressure 3. */
/**
 * The most the hand puts through the pick, N. 12 let a false-set spool work as a lever: canted
 * between the housing's mouth corner and the plug's bore wall, 12 N on its foot became 8 N·mm
 * of backward torque through the housing corner's chamfer, more than the default wrench's 7.8,
 * and the plug backed out of the waist on its own (owner: "while pressing the tension wrench
 * (5.26°) I push, and it suddenly changes to 4.4°, which allows me to push the spool"). At 6 N
 * the lever makes ~4 N·mm and the lightest wrench (6 N·mm) still wins; a set needs 1–2 N.
 */
export const HAND_MAX_FORCE = 6
/**
 * A driver "binds" only when it HOLDS the plug: at least this much force from the plug, N. A
 * driver the corner merely brushes while a false-set spool carries the plug (Northgate
 * Commercial at rest: the spool 1.6 N, the next pin 0.05 N) read as the binder, and lifting it
 * to the line set nothing — the plug could not move for the spool (owner: "even when you lift
 * the second to the correct place, it still is marked as binding"). The same threshold has always
 * been the hold reference (`holdAt`): "a real pinch, not a brush".
 */
export const BIND_MIN_FORCE = 0.3
/**
 * The bench's GAME tolerances — physically representable, not 101% physical (owner's rule).
 *
 * Real numbers are a 0.05 mm radial clearance and a 0.15 mm chamfer: invisible on screen, and a set
 * window of 0.3 mm that a held key shoots straight through. Here the bore is a little looser (a gap
 * you can see round every pin), the chamfers are twice as deep (a set window of ~0.6 mm), and the
 * tolerance steps between chambers are wider than the clearance so a set pin still cannot be
 * shoved through — the same rule as the real lock, at a scale a hand and an eye can work with.
 *
 * Not looser than this. At 3.5× the real clearance every pin had a third of a millimetre of
 * sideways play, so pins reached their pinch over a wide, fuzzy range of plug angles and two
 * would jam together; lifting one then freed nothing, the driver sat on the plug's corner with
 * no flip, and pushing on ran it into overset (owner: *"sometimes there are two binding pins"*,
 * *"it does not flip and touches the very angle of the plug"*).
 */
const GAME_BORE_RADIUS = 1.5
/**
 * Smaller than real (0.15): with the set latch the window's width no longer decides whether a
 * set lands, and a small chamfer is what lets a set driver's corner reach the flat (see
 * `PIN_BEVEL`).
 */
const GAME_RIM_CHAMFER = 0.01
/**
 * Each driver is this much slimmer in radius than the one binding before it (× the lock's
 * quality). Twice this is the ledge every set sits on — 0.2 mm, eight pixels in the front view —
 * and the plug's jump per set, about 1.8°. Wider than the pin bevel plus the rim chamfer, so the
 * set corner lands on the flat; wider than the key pin's clearance, so a set pin cannot be shoved
 * through. Not physical — a real lock's pins vary by hundredths — but the mechanism is the real
 * one and the eye can follow it. See `solverLock` for why this is a diameter, not a bore offset.
 */
const GAME_TOLERANCE_GAP = 0.01
/**
 * How far under the key pins the hook rides while it is not pushing, mm. At exactly pin height the
 * crest rams the next cone when the tool walks the keyway and the hand jams against it at full
 * force; a real hook goes in low. Space's ramp covers this in a tenth of a second.
 */
const PASS_CLEARANCE = 0.4
/**
 * The bench's clearance between the plug's top and the shell's underside, mm (`Params.shearGap`;
 * a real cylinder has none). Why: the plug is 12.7 mm across, so every degree it turns shifts its
 * bore 0.11 mm against the shell's, and with drivers 0.1 mm apart in diameter the shell's edge
 * overhangs the plug's bore by 0.4–0.6 mm at the last pins — far more than a key pin's 0.07 mm of
 * play. A key pin's top then cannot rise a hair above the rim without meeting the shell's flat,
 * so the last pins would set only inside a 0.05 mm window (measured: pin 3 of four never set,
 * `contacts.deep` 1). The gap is the room a key pin's top may stand above the rim while the plug
 * turns: the owner's own suggestion ("a small space between plug and hull, as an additional lax
 * thing"). The housing's underside is the shear circle itself plus the gap, and the plug's
 * leading rim corner rides that same circle as it turns, so the gap is exactly the room a key
 * pin's top has above the corner at every angle. 0.35 opened every lock but looked wrong ("the
 * gap is too big — it should be there, but 10 times smaller"). Measured on 2026-09-13 with the
 * hand relaxing at the click (`Engine.clickedNow`, the bench's `CLICK_RELAX`): 0.2 opens the
 * three standard test locks; 0.15 and below leave the last pin binding, and 0.035 cannot work
 * with the plug turning ~1° per pin — on the TRAILING side the shear circle falls away under
 * the shell's overhang, so the key pin's top-left corner meets the shell 0.08 mm BELOW `rimY`
 * while the driver's foot must reach the leading corner 0.13 mm ABOVE it. Halving or quartering
 * the tolerance step (the plug turning less) shrank the ledges to 0.03–0.05 mm and every set
 * slid off. A larger chamfer on the key pin's top (its corner moves in, where the circle is
 * higher) gets the standard locks down to 0.07 — tried, see `KEY_TOP_CHAMFER`: diamond-shaped
 * key pins and the spool technique dead, so 0.2 it stays.
 */
export const SHEAR_GAP = 0.05
/**
 * The key pins' top chamfer, mm (`Params.keyTopChamfer`; the solver's own is 0.15). This is what
 * lets the shear gap be small: turning the plug moves its bore against the shell's, and on the
 * TRAILING side the shear circle falls away under the shell's overhang — with a 0.15 chamfer the
 * key pin's top-left corner sits at x ≈ −1.95 where the shell's underside is 0.11 mm below the
 * rest rim, while the driver's foot must reach the leading corner 0.13 mm above it, so the gap
 * had to be 0.2. A 0.7 chamfer moves that corner in to x ≈ −1.4, where the underside is 0.04
 * ABOVE the rest rim, and 0.07 of gap is enough for the STANDARD locks (measured: three open
 * at 0.07, not at 0.05). But the key pins then look like diamonds (owner: "why did the key pins
 * become diamonds?") and the spool technique dies — spool 3's false set can no longer be
 * pushed through at 0.07 — so it is 0.15 and a 0.2 gap. Kept as a knob for the record.
 */
const KEY_TOP_CHAMFER = 0.15
/** The bench's cuts: `LIFT_OFFSET + LIFT_SCALE × the game's lift`, never under `LIFT_MIN`. */
const LIFT_OFFSET = 0.6
const LIFT_SCALE = 1.25
const LIFT_MIN = 0.8
/**
 * The most a chamber's set lift may ask of the pick, mm — D-223. Was 2.6, but the pick's ceiling
 * lifts a driver to ~2.57 with the wrench off and less under it (a binding pin stalled 0.06–0.09 mm
 * short at 2.3), so a cut shallower than the hand-made roster's made a pin NO hand could set — the
 * dungeon's and the Lock streak's forge deal bittings down to 1.0 (the editor too), and those locks
 * could not be opened. 2.225 is exactly the roster's deepest (bitting 2.7, proven by the roster
 * walk), so no catalogue lock moves; a shallower cut now plays like that deepest one.
 */
const SET_LIFT_CAP = 2.225
/** The plug is home — back in line after the wrench came off — below this, rad (0.05°). D-225. */
const RESET_HOME = 0.05 * (Math.PI / 180)
/** The wrench-off return, rad/s: about 30°/s, so a fully turned plug is back in a fifth of a second. */
const RETURN_RATE = 0.5
/**
 * The click, the game's way. At the end of a lift the binder's foot reaches the rim and stops a
 * few hundredths short of it: its bottom bevel rides onto the plug's rim corner and the wrench,
 * which has been pinching the pin, now holds it there. The pin sits AT the line, reads binding,
 * and only pops once the hand has added another half newton — 0.2–0.4 mm more of asked lift
 * (owner: "you can see that the pin was set, but you need to lift it up just a nano-meter, which
 * is not game-like"; "sometimes you need to be extra precise, which is very strange"). In the
 * game a pin at the line is set. So a binding driver being lifted whose foot is within
 * `CLICK_MM` of the rim is moved the rest of the way, ONCE per bind, landing `CLICK_LAND` above
 * the rim — clear of the bore wall, so the plug, no longer held, turns on to the next pin within
 * the frame and the rim slides under the driver, which the pick (still lifting the key pin
 * beneath it) carries the rest of the way as it does after a natural pop. Moving the key pin
 * too, and moving on every substep, threw the pair up again each time the spring dropped them
 * back and punched the driver's bevel through the rim corner (`contacts.deep` 14). The natural
 * pop is a jump — the wound-up pick throws the driver 0.11 mm in one substep from 0.067 below
 * the corner — so a 0.06 window sometimes misses it; wider windows (0.08, 0.12) caught it but
 * left the key pin far enough below the moved driver that the driver fell back into the bore
 * before the rim was under it, and once carried a spool's foot through its own false set. So
 * 0.06, and `OVER_PUSH` allows for the pop's overshoot. The click never fires on a driver the
 * plug's corner is in the groove of.
 */
export const CLICK_MM = 0.03
/**
 * Where the click lands the driver's lowest corner above the plug's rim corner: more than the
 * corner's chamfer plus the driver's bevel (0.05), so the rim passes under the driver's flat as
 * the plug moves on. Landed at 0.02 the rim corner met the bevel's slope on the slimmest
 * driver of the Brasswell padlock, dragged it along, and it lost its footing (`deep` 4).
 */
const CLICK_LAND = 0.015

/** The lowest point of a pin's polygon in the world, mm: its foot, cant and all. */
function lowestY(pin: PinBody): number {
  const W = pin.world
  let low = Number.POSITIVE_INFINITY
  for (let i = 0; i < pin.count; i += 1) {
    const y = W[i * 2 + 1]!
    if (y < low) low = y
  }
  return low
}

/**
 * The world height of the plug's rim corner on the side the wrench turns it into — the corner
 * that pinches a binder's foot. It is NOT `rimY`: turning the plug lifts that corner by
 * (bore + chamfer) × sin θ, 0.08 mm at 3° and 0.15 mm at 5.6° (measured: a driver landed 0.02
 * above `rimY` was still pinched at 0.7 N by a corner 0.06 higher).
 */
function rimCornerY(sol: Engine['sol']): number {
  const P = sol.params
  const th = plugAngle(sol)
  const px = (P.boreRadius + P.rimChamfer) * (th >= 0 ? 1 : -1)
  return px * Math.sin(th) + (sol.rimY + P.plugRadius) * Math.cos(th) - P.plugRadius
}

/**
 * The bench's hook: the solver's short hook (1 mm shank, tip 2.3 mm over the shank's underside)
 * made 1 mm taller. The bench's cuts run to 2.6 mm and the tip rests 0.4 mm under the pins, so
 * with the short hook any lift past 2.2 mm brought the SHANK up under the neighbouring key pin —
 * behind a false-set spool that meant lifting the spool's own key pin into the lever and the
 * binding pin behind it could never set (owner: "when one pin false-sets, another starts to
 * bind, but the one that binds is no longer able to set — which is unreal"; "your handle stuck
 * on the key pins"). With the tip 3.3 mm over the shank's underside the shank clears the
 * neighbours up to a 3.2 mm lift.
 */
const BENCH_HOOK: PickProfile = {
  name: 'bench-hook',
  outline: [
    [0, -0.5],
    [PICK_REACH, -0.5],
    [PICK_REACH + 0.25, 0.4],
    [PICK_REACH + 0.3, 2.3],
    [PICK_REACH + 0.05, 3.1],
    [PICK_REACH - 0.25, 3.3],
    [PICK_REACH - 0.6, 3.2],
    [PICK_REACH - 1.45, 0.5],
    [0, 0.5],
  ],
  flexX: PICK_REACH - PICK_FLEX,
  tipIndex: 5,
}

/** A seeded shuffle for the tolerance order. */
function shuffled(n: number, seed: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  let x = seed >>> 0
  for (let i = n - 1; i > 0; i -= 1) {
    x = (x * 1664525 + 1013904223) >>> 0
    const j = x % (i + 1)
    const t = order[i]!
    order[i] = order[j]!
    order[j] = t
  }
  return order
}

/**
 * The game's lock as a solver lock. The game's set lift is `5 − K`; the solver's is
 * `rim − keyTop = 3.86 − K`, so key lengths are shifted to keep the lifts the player learned.
 */
/**
 * The corner bevel on a driver's ends, mm. The solver's profiles carry 0.15, which with a 0.15
 * rim chamfer means a set driver's corner never reaches the plug's flat top unless the ledge
 * under it is 0.3 mm wide: it sits on the chamfer's slope and its spring cams the plug BACK, and
 * two such sets hold a pressure-2 wrench to a standstill (measured: after two sets the plug
 * stalled at 2.38° and nothing bound). Smaller bevels and a smaller rim chamfer let the corner
 * land on the flat past a 0.2 mm ledge; the plug then jumps to the next pin — the click.
 */
const PIN_BEVEL = 0.01
/** The solver's driver half-length and nominal radius. */
const HALF_LENGTH = 2.25
const SOLVER_R = 1.475

/**
 * The GAME's driver, as a solver polygon — band for band, nothing invented.
 *
 * `src/sim/profiles.ts` is the definition of every pin in the roster: a stack of bands from the
 * bottom, each full diameter or a groove of some depth (a fraction of the radius removed) with a
 * shoulder taper (0 square, 1 fully bevelled). The solver's own demo profiles and two generated
 * spools were used before this; the owner's rule: *"check what kind of spool pins and their
 * design is available — do not generate them, use defined."* The game designed its grooves to
 * sit within the bottom `setLift` of the driver — the part that crosses the shear line — so a
 * spool's waist is at the line at rest for the cuts the game gives it, which is the picture the
 * owner wants. Each shoulder slopes over `taper × band / 2`, as the game's own cutaway draws it
 * (D-125). Slimmed by `slack` in radius for this chamber's place in the binding order, with the
 * bench's small end bevels.
 */
function fromBands(p: DriverProfile, slack: number): PinProfile {
  const R = SOLVER_R - slack
  const H = HALF_LENGTH
  const b = PIN_BEVEL
  const right: (readonly [number, number])[] = [
    [-H, R - b],
    [-H + b, R],
  ]
  let u = -H
  for (const band of p.bands) {
    const u0 = u
    const u1 = u + band.length
    if (band.reduced) {
      const groove = R * (1 - band.grooveDepth)
      // The shoulder: the game's `taper` is 0 for square, 1 for fully bevelled, and "drives
      // counter-rotation force". Read as the shoulder's run along the pin per unit of groove
      // depth, halved: a spool's 0.15 gives a 0.03 mm run over a 0.41 mm depth, a cam ratio of
      // 0.07 — the pin would need 16 N to push the plug back against the default wrench, past
      // the hand's 12 N, so a false-set spool goes nowhere until the plug is counter-rotated
      // (owner: with the wrench held he pushed a spool, the plug went back on its own and let it
      // through). A mushroom's 0.85 gives 0.42 and 3 N — the push-back a mushroom is known for.
      // Read as a fraction of the band's length instead (the first cut), the spool's shoulder
      // was a 10° ramp that 7 N pushed the plug out of. A square shoulder still needs a hair of
      // slope to be a polygon edge the solver can face.
      const depth = R - groove
      const ramp = Math.max(0.02, Math.min(band.taper * depth * 0.5, band.length / 2 - 0.01))
      right.push([u0, R], [u0 + ramp, groove], [u1 - ramp, groove], [u1, R])
    }
    u = u1
  }
  right.push([H - b, R], [H, R - b])
  // Drop points that repeat their neighbour (two full bands in a row).
  const out: (readonly [number, number])[] = []
  for (const pt of right) {
    const last = out[out.length - 1]
    if (!last || Math.abs(last[0] - pt[0]) > 1e-9 || Math.abs(last[1] - pt[1]) > 1e-9) out.push(pt)
  }
  return { name: `${p.name}-game-${slack.toFixed(3)}`, length: 2 * H, right: out }
}

/**
 * The game's lock as a solver lock. The game's set lift is `5 − K`; the solver's is
 * `rim − keyTop = 3.86 − K`, so key lengths are shifted to keep the lifts the player learned.
 *
 * Binding order comes from DRIVER DIAMETER, not from bore position. `solverbench` offset each
 * chamber's housing bore sideways by a step of δ, and at any spread wide enough to give a set a
 * visible ledge the pins jammed the plug with no wrench at all (every driver straddles the shear
 * line at rest), while at a narrower spread neighbouring pins bound within a few hundredths of a
 * degree of each other and a set had no ledge to sit on (owner: *"I lift it, and it's not set and
 * in a second another pin starts binding"*). A real cylinder's bores are drilled aligned; what
 * varies is the pins. So the bores are aligned here and each driver is a step slimmer than the
 * one that binds before it: the fattest pinches first at `2 × its clearance`, the next binds one
 * step later, and the step is the ledge — the same for every pin, at rest nothing is pinched.
 */
function solverLock(def: GameLockDef, seed: number, tune: Tune): LockDef {
  const n = def.bitting.length
  const order = shuffled(n, seed)
  // Radius slack per step (tighter on a tight-tolerance lock, looser on an easy one).
  const step = tune.toleranceGap * Math.max(0.5, Math.min(1.5, def.toleranceQuality))
  return {
    chambers: def.pins.map((name, i) => {
      // The game's own lift, then cut DEEPER for the bench: a longer path to the line (the owner:
      // "it always too little to lift for the shear line — for the game it's better to make this
      // path bigger"), and a spool's waist at the line at rest instead of its ring (0.3–1.1 mm of
      // lift put every spool's wide ring on the line and its waist above it, so the plug could
      // never get into the waist before the next pin bound: no false set was possible).
      const gameLift = Math.max(0.3, Math.min(2.6, 4 - (def.bitting[i] ?? 3)))
      // ...but never so shallow that a security pin's top groove is already at the line at rest:
      // the game's own rule (`minimumSetLift`, the groove's top plus 0.15 mm). The mapping alone
      // put Northgate Commercial's first spool's waist 0.05 mm OVER the line, and the wrench
      // dropped the plug into it before anything was lifted — a false set at rest.
      const profile = profileByName(name)
      const setLift = Math.max(LIFT_MIN, minimumSetLift(profile), Math.min(SET_LIFT_CAP, LIFT_OFFSET + LIFT_SCALE * gameLift))
      return {
        keyLength: 3.86 - setLift,
        // The game's own pin, band for band (see `fromBands`), slimmed by this chamber's step.
        driver: fromBands(profile, step * order[i]!),
        delta: 0,
      }
    }),
    pick: BENCH_HOOK,
  }
}

/** The game-tolerance knobs, overridable so a headless sweep can measure alternatives. */
export interface Tune {
  readonly boreRadius: number
  readonly rimChamfer: number
  readonly toleranceGap: number
  readonly passClearance: number
  /** Any further solver parameter, applied last — springs, friction, the hand. */
  readonly params?: Partial<Params>
}

export const GAME_TUNE: Tune = {
  boreRadius: GAME_BORE_RADIUS,
  rimChamfer: GAME_RIM_CHAMFER,
  toleranceGap: GAME_TOLERANCE_GAP,
  passClearance: PASS_CLEARANCE,
  /**
   * Lighter springs and slipperier brass than the solver's defaults (0.5 N + 0.15 N/mm, 0.35/0.25).
   * A set driver rests on the plug's rim off-centre, so its spring cams the plug BACK, and rim
   * friction adds to that; at the solver's numbers two sets held a pressure-2 wrench to a dead
   * stop before the third pin could bind (measured: reaction 10.8 of 10.8 N·mm, nothing binding).
   * At these the same walk sets all four pins and opens at pressure 2. Pinches are lighter and
   * stick–slip jumps smaller too — which is the "more relaxed" the owner asked for.
   */
  /**
   * Pin damping ×2 and the pins' (boosted, numerical) weight ×2 (both are settling-speed numbers,
   * never where things end): the damping trims the one or two stick–slip jumps of a lift; the
   * weight keeps a freed key pin falling at the solver's original 6.7 mm/s — at ×4 damping alone
   * a key pin took half a second to drop away from its set driver ("key pins falling very slow").
   */
  // And the plug's speed cap at a third of the solver's: with every spool's waist on the line the
  // plug can jump 3° in one go once the fatter pins are set, and at 30 rad/s that tunnelled
  // contacts (`contacts.deep` 3). At 10 rad/s a substep moves the rim 0.07 mm, well inside the
  // 0.3 mm contact margin, and the jump still takes only a few hundredths of a second.
  params: { springPreload: 0.3, springK: 0.1, muStatic: 0.2, muKinetic: 0.15, pinDamping: 0.009, pinGravity: 0.06, plugMaxRate: 3 },
}

/** The bench's solver parameters for a lock: the keyway ends 3.5 mm past its last chamber. */
function benchParams(def: GameLockDef, tune: Tune): Params {
  const n = def.bitting.length
  return {
    ...DEFAULT_PARAMS,
    handMaxForce: HAND_MAX_FORCE,
    boreRadius: tune.boreRadius,
    rimChamfer: tune.rimChamfer,
    shearGap: SHEAR_GAP,
    keyTopChamfer: KEY_TOP_CHAMFER,
    keywayDepth: DEFAULT_PARAMS.firstChamberX + DEFAULT_PARAMS.pitch * (n - 1) + 3.5,
    ...tune.params,
  }
}

/**
 * The set window, as key-pin TOP heights: from where the driver's bottom clears the plug's mouth to
 * where the key pin's top would meet the shell's. The band both views draw — "the space where we
 * need to align" — and a guide, not a rule: the solver decides what actually catches.
 */
/**
 * Solver mm the drawn SHEAR LINE stands for, in both views: the plug's top at the bore's edge,
 * where a set driver's corner actually rests — not the top on the axis (Y = 0), which is a
 * fraction higher, nor the mouth's lowest point (`rimY`), which is a fraction lower.
 */
export function shearLineMm(P: Params): number {
  return circleY(P, P.pinRadius - 0.05)
}

export function setWindow(s: SolverState): { from: number; to: number } {
  // A guide, not a rule: the latch does the timing, the band says where to aim, and it is drawn
  // tall enough to aim at (owner: "make green space bigger"). It starts ON the drawn shear line —
  // it began at the mouth's lowest point and read as "a bit below the line".
  const from = shearLineMm(s.params)
  return { from, to: from + Math.max(0.6, 2 * s.params.rimChamfer) }
}

/**
 * The solver's forces and positions, read as the game's five words.
 *
 * SET is read the way the game reads it: from the plug's ANGLE. A chamber binds once the plug's
 * bore has moved `2 × clearance + δ` from the shell's (the pin bridging both walls); a chamber the
 * plug has turned PAST that is no longer what stops the plug, so a lifted driver there that the
 * plug carries is set, wherever on the chamfer it rests. It used to demand the driver clear of the
 * mouth within 0.12 mm, and a driver held on the chamfer's slope (the solver's own "curved ledge
 * plus stiction") read FREE while the next pin went amber (owner: *"I lift it, and it's not set
 * and in a second another pin starts binding, when the first one is not set"*).
 */
export function chamberStateOf(
  r: ChamberReadout,
  _s: SolverState,
  passed: boolean,
  security: boolean,
  /** Where the plug touches this driver, from the solver's contacts (`plugTouch`). */
  touch: PlugTouch,
  /**
   * The plug has turned past this pin's own sideways play (twice its clearance) — by geometry,
   * not by having seen it bind. A spool whose waist sits on the line never pinches, so it never
   * records a bind angle; but once the plug is past its play, the plug is in its waist.
   */
  passedGeom = false,
  /** The key pin has stood over the corner under the pick for longer than `OVER_HOLD`. */
  overHeld = false,
): ChamberState {
  // Overset: the key pin's top stands more than `OVER_PUSH` above the plug's leading rim corner —
  // the pick has pushed the pin past the line, and the plug is blocked by it (`clampPush`). The
  // old read waited for the key pin to be past the shell's chamfer, 0.4 mm up, which the shear
  // gap made reachable; "a pin the turned plug will not let through" is the same geometry.
  // ...unless the plug has already moved past this pin: then the key pin's excursion is the
  // click's own overshoot (the wound-up pick springing up as the pinch lets go, 0.15–0.2 mm at
  // real tolerances), the set is made, and the pin reads set while Space is still held — for
  // `OVER_HOLD`. Held over the corner longer than that, a set pin is over-pushed too.
  if (touch.keyOver > OVER_PUSH && (overHeld || (!passed && !passedGeom))) return 'OVERSET'
  // `passed`: the plug has turned past the angle this pin was last seen holding it at. A false set
  // is the plug's corner IN THE WAIST — touching the driver above its foot band — which only a
  // shaped driver has. A driver the plug touches under its foot, or does not touch at all, is not
  // in a false set however it leans (owner: "when the spool is already behind the shear line and
  // the plug touches the middle of its bottom, it's marked as false set — once part of the plug
  // touches the bottom it should flip and set"). Heights and cants were tried for this read and
  // misread a canted, resting spool; the contacts say where the plug actually is.
  // ...or the driver's foot is still deep in the plug's bore: then the plug is in its groove by
  // construction, whether or not the corner's contact carries force this very substep (it lost
  // it for an instant mid-push once, the read flipped to SET, and the hand's latch stopped the
  // push there).
  // The plug pinching a WIDE part — the head at rest, the foot's side — is binding, not a false
  // set (owner: "false set only when the plug is stuck in the narrow part, not in the wider
  // parts"); the foot-deep fallback below is only for a lifted driver the plug is not pinching,
  // whose groove contact dropped out for a substep.
  if (security && (passed || passedGeom) && (touch.waist || (touch.foot < -0.3 && !touch.pinch && r.driverLift > 0.05)))
    return 'FALSE_SET'
  // A lifted driver the plug has passed is set the instant the plug moves on — while the pick is
  // still pushing, which is the click the hand feels — and stays set on the ledge until the plug
  // rolls back. Unless the plug's wall is still pressing its side: then it is holding the plug.
  if ((passed || passedGeom) && r.driverLift > 0.05 && !touch.pinch) return 'SET'
  if (r.plugForce > BIND_MIN_FORCE) return 'BINDING'
  return 'FREE'
}

/** Where the plug touches a driver, read from the solver's contacts — see `plugTouch`. */
export interface PlugTouch {
  /** A plug contact above the driver's foot band: the plug's corner is in a groove, or under the head. */
  readonly waist: boolean
  /** A plug contact whose normal is mostly sideways: the bore wall pressing the driver's side. */
  readonly pinch: boolean
  /** The key pin's top above the plug's leading rim corner, mm (`rimCornerY`). */
  readonly keyOver: number
  /** The driver's lowest corner above the plug's leading rim corner, mm (`Engine.footAboveRim`). */
  readonly foot: number
}

/**
 * How far a key pin's top may stand above the plug's leading rim corner before it is overset and
 * the wrench cannot turn the plug forward (owner: "it should not be possible to turn the tension
 * wrench with the lockpick pushing the pin"). A real cylinder's gap is a few hundredths; the
 * bench's 0.2 mm shear gap (needed for the last pins, see `SHEAR_GAP`) would let a pushed pin
 * stand 0.25 mm up and the plug still turn — this rule is the missing shell. The click lands a
 * driver's lowest corner 0.02 above the rim corner, its centre (canted) 0.07, and the hand adds
 * up to 0.05 before it latches; a natural pop (the click's window missed by a hair) throws the
 * pair up to 0.3. 0.35 keeps every set clear of the rule while Space is held (0.25 read the
 * odd just-set pin as overset mid-hold); a pin pushed a visible amount past the line is caught.
 * With the gap at 0.07 the shell itself now stops a key pin a little above that, physically.
 */
export const OVER_PUSH = 0.12
/**
 * How long, s, a SET pin's key pin must be held over the corner before it reads OVERSET. At the
 * click the wound-up hand springs the key pin 0.15–0.2 mm up into the housing's mouth for an
 * instant and it settles back; held there longer — Space kept down through the click — the pin
 * is over-pushed: the key pin's chamfer wedged in the mouth, the plug blocked (owner: "I cannot
 * overset the binding pins — only the free ones, a bit").
 */
export const OVER_HOLD = 0.2

/**
 * How long, s, a standard pin must sit over-pushed before its overset LATCHES (D-220). It is well
 * past `OVER_HOLD`, and deliberately past the auto-solver's own push, too: the scripted walk rams a
 * pin toward the ceiling for up to 1.5 s a push (`solverWalk`), reading OVERSET the while, and it
 * must NOT wedge — the walk is "solve it for me", and a heuristic that jams itself is no solver. So
 * only a hand that leans on the push longer than any single scripted push — you have seen the pin
 * go red and kept driving it — gets the wedge. A brief overshoot you correct never reaches this.
 */
export const OVERSET_LATCH_TIME = 1.6

/**
 * How far past its tip the snap needle still reaches, mm — D-219. The tip sits at a chamber's
 * centre when the player aims there, so a small margin includes the pin being pointed at while
 * still excluding the next one in (the pitch is several mm). Sliding the needle out past pin 1 by
 * more than this reaches nothing and a strike is inert. Shared by the strike and the drawing so
 * the plank ends exactly where the bump lands.
 */
export const NEEDLE_REACH = 0.6

/** Which chamber the pick tip is under, by x. */
function chamberUnderTip(s: SolverState): number {
  const p = readPick(s)
  if (p.tipX < 1) return -1
  let best = -1
  let bestD = Infinity
  s.chambers.forEach((ch, i) => {
    const d = Math.abs(ch.x - p.tipX)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return bestD < s.params.pitch * 0.6 ? best : -1
}

export interface Engine {
  readonly def: GameLockDef
  readonly sol: SolverState
  /** The game's read model, poured from the solver each frame — what the HUD draws. */
  readonly sim: SimState
  /** One readout per chamber, refreshed each frame. */
  readonly readouts: ChamberReadout[]
  bindingChamber: number
  /** The state word for chamber `i` — the frame's read, with BINDING ranked to one pin. */
  stateOf(i: number): ChamberState
  /** Where the tip rests with nothing lifted: just under the key pins, clear to slide. */
  tipRest(): number
  /**
   * Aim the tip at (x, y) in solver mm, hold the wrench at `tension`, and advance by `dt`. With
   * `counter` > 0 (rad/s) the hand is counter-rotating: the plug is walked BACK at that rate
   * against the wrench, which stays on — the spool technique's easing, as a control (owner: "while
   * pressing the left button, you start pressing the right and the rotation very slowly starts
   * moving in the opposite direction; when you release the right button it returns to normal").
   */
  drive(tipX: number, tipY: number, tension: number, dt: number, counter?: number): void
  /**
   * The pick gun (snap gun): flick every key pin upward at `vel` mm/s. On the next `drive` the
   * struck key pins fire their drivers up past the shear line; they fall back on their springs a
   * few hundredths of a second later (the pins visibly JUMP). A light wrench, held, turns the plug
   * a hair in the instant a driver's bottom is above the line and catches it on the ledge — so a
   * few bumps at the right tension open the lock, and too much or too little catches nothing. Owner:
   * "there is a lockpick gun — you strike the pins and they jump … bump the pressure a few times
   * and pop the lock (if lucky)." The kick is capped at the solver's `pinMaxSpeed`.
   */
  strike(): void
  pick(): PickReadout
  theta(): number
  /** The plug angle chamber `i` was last seen binding at; +Infinity if it never has. */
  bindAngle(i: number): number
  /**
   * Chamber `i`'s driver: its lowest corner above the plug's rim corner on the pinching side, mm.
   * Negative: still in the plug's bore. The click fires within `CLICK_MM` below zero.
   */
  footAboveRim(i: number): number
  /**
   * Where the plug will open, rad — the HUD's plug bar puts its notch there. With every pin set
   * it is where the run past the last hold ends (`RUN_PAST`); before that an estimate that firms
   * up with every set: the last hold, 0.2° for each pin still to set but one (the measured step
   * between binds at real tolerances), and the final run.
   */
  openAngle(): number
  /** Every pin set and the plug past the last hold: free, whether or not the pick has let go. */
  plugFree(): boolean
  /** Chamber `i` is a latched overset (D-220): wedged until the wrench comes off. */
  jammed(i: number): boolean
  /**
   * True for the frame in which the click fired (`clickSet`): the hand's cue to stop lifting and
   * relax a little, so the key pin's top does not follow the driver up into the shell.
   */
  clickedNow: boolean
  /** Diagnostics: the last substep's plug cap (rad) and whether a pushed pin blocked the wrench. */
  debug: { cap: number; blocked: boolean; falseSet: number }
}

export function createEngine(def: GameLockDef, seed: number, config: SimConfig, tune: Tune = GAME_TUNE): Engine {
  const sol = createLock(solverLock(def, seed, tune), benchParams(def, tune))
  const sim = createSimState(def, seed, config)
  const readouts: ChamberReadout[] = sol.chambers.map((_, i) => readChamber(sol, i))
  const states: ChamberState[] = sol.chambers.map(() => 'FREE')
  /**
   * The plug angle each chamber was last seen BINDING at — the angle it holds the plug to. A
   * chamber the plug has turned past that angle is behind the wrench; a lifted driver there is
   * set. Measured rather than derived: the chamfer moves the real bind angle a good way from the
   * rigid `2·clearance + δ` estimate, which both missed binders and misread sets.
   */
  const bindAt: number[] = sol.chambers.map(() => Number.POSITIVE_INFINITY)
  const passedNow: boolean[] = sol.chambers.map(() => false)
  /** Whether the click has fired for this chamber's current bind; cleared when it reads FREE. */
  const clicked: boolean[] = sol.chambers.map(() => false)
  /** Seconds each key pin has stood more than `OVER_PUSH` over the corner under the pick. */
  const overFor: number[] = sol.chambers.map(() => 0)
  /**
   * A LATCHED overset (D-220). An over-pushed pin does not un-overset the instant the pick comes
   * off it: the real thing traps the driver above the shear on the turned plug's ledge with the key
   * pin wedged in the housing mouth, and only dropping the wrench — rolling the plug back into line
   * — frees it. So an overset held long enough under the wrench latches here; while latched the pin
   * is held up (`strikeForce`), the plug stays blocked (`armPush`), and the read stays OVERSET
   * however the pick moves. The latch clears only when the wrench comes off, which is the reset.
   */
  const overLatched: boolean[] = sol.chambers.map(() => false)
  /** The key-pin height each latched overset is held at, mm above rest — where it wedged. */
  const overLiftAt: number[] = sol.chambers.map(() => 0)
  /**
   * Seconds each chamber has held a *latchable* overset (D-220) — a standard binder shoved past the
   * line that never set. Its own timer, not `overFor`, because a pin wedged at the ceiling reaches
   * a low-force equilibrium (the load-scaled hand settles the tip right at it), so `overFor`'s push
   * test would keep resetting and the latch would never arm.
   */
  const overStateFor: number[] = sol.chambers.map(() => 0)
  /**
   * The snap gun has been used this attempt (D-221). Its strike drives every reached pin ballistic
   * over the shear, so a launched driver reads OVERSET for as long as it hangs there — and a player
   * bumping again and again holds it up. That is the tool working, not a mistake, so a gunned lock
   * must NEVER wedge a pin the overset latch (D-220): once the gun is in hand the latch is off.
   */
  let gunUsed = false
  /** Each chamber's last `plugTouch`, for the click (no click on a driver the plug is in the groove of). */
  const touches: PlugTouch[] = sol.chambers.map(() => ({ waist: false, pinch: false, keyOver: -1, foot: -1 }))
  /**
   * Each driver's grooves: the heights above its lowest point where its radius is reduced, ramps
   * included — a spool's 0.45–1.40 mm waist, a serrated pin's four notches; none on a standard
   * pin. The plug's corner touching a driver inside one is a false set; touching it anywhere
   * else (its head at rest, its foot's side) is binding, and under its foot is a set.
   */
  const grooves: [number, number][][] = sol.chambers.map((ch) => {
    const right = ch.driver.profile.right
    const full = right.reduce((m, [, h]) => Math.max(m, h), 0)
    const out: [number, number][] = []
    let start = -1
    for (let k = 1; k < right.length; k += 1) {
      const [pu] = right[k - 1]!
      const [u, h] = right[k]!
      const reduced = h < full - 0.05
      if (reduced && start < 0) start = pu - ch.driver.bottomU
      if (!reduced && start >= 0) {
        out.push([start, u - ch.driver.bottomU])
        start = -1
      }
    }
    return out
  })
  /** The plug angle at which a pin last held it, and whether every pin has set. */
  let holdAt = Number.POSITIVE_INFINITY
  let allSet = false
  const FALSE_SET_MAX = 3 * DEG
  void FALSE_SET_MAX
  /** How far, mm, the plug's corner may enter a groove past the driver's head (`limitFalseSet`). */
  const WAIST_DROP_MAX = 0.08
  /** With every pin set, this far past the last hold the plug is running free: open. */
  const OPEN_PAST = 0.3 * DEG
  /**
   * How far past the last hold the plug may ever run under the wrench (`plugCap`). 1°: at 1.5°
   * the Brasswell padlock's last, slimmest driver — its foot over the turned plug's bore mouth
   * with 0.25 mm of rim under its outer edge and 0.22 mm of play in the housing bore — tipped
   * into the bore the moment its key pin dropped (cant 36°, `deep` 4). A binder step can be
   * up to 1.15°, so after such a set the next pin binds once the pick has let go.
   */
  const RUN_PAST = 0.4 * DEG
  /**
   * OFF (0). While the pick pushes a pin, under the wrench with no counter-rotation, how far the
   * plug may turn BACK per substep (`hardCap`). Tried at 0.001° and 0.005°: a pushed, wedged
   * pin against an immovable plug is a rigid three-body jam the contact solver answers with
   * tunnelling (deep 6–18 with a 12 N or 6 N hand, even at 30 iterations in a 1.5 s hold), and
   * at 0.005° the lever still crept 0.3° a second. What held instead, 2026-09-15 to 09-16, was a
   * 0.3 N hand cap on a false-set pin; now it is the waist floor (`hardCap`), the solver's own
   * stop. Owner: "while pressing the tension wrench
   * (5.26°) I push, and it suddenly changes to 4.4°, which allows me to push the spool". A
   * false-set spool, canted between the housing's mouth corner and the plug's bore wall, works
   * as a lever when pushed: the offset between the bores is far more than its play, so lifting
   * it means pulling the bores back into line — and with the bench's 1° a pin that lever beats
   * any wrench. So under the wrench the plug does not turn back by itself; only the right button
   * turns it back. With a 12 N hand the solver answered the immovable plug with 14–18 tunnelled
   * contacts; at 6 N it holds cleanly. `tune.params.ratchet` (degrees) overrides.
   */
  const RATCHET = ((tune.params as { ratchet?: number } | undefined)?.ratchet ?? 0) * DEG
  /** The counter-rotation stop (`counterRotate`): the plug may not be past this angle. */
  let counterCap = Number.POSITIVE_INFINITY
  /** Every pin set and the plug past the last hold: open, once the pick has let go. */
  let openReady = false
  /** The pick is carrying a pin (last frame's read): the plug is held short of the open swing. */
  let pickOn = false
  /** The pushed-pin hold (`holdPlug`): where the plug was when a pin was pushed too far. */
  let pushCap = Number.POSITIVE_INFINITY
  let pushBlocked = false
  /** The pick is pushing a pin the plug's corner is in the groove of (last frame's read). */
  let onWaist = false
  /** The solver's rotation stops at rest; the caps below are set as these stops every substep. */
  const STOP_MIN = sol.params.thetaMin
  const STOP_OPEN = sol.params.thetaOpen
  /** The wrench the hand asked for this frame, before the pushed-pin block. */
  let commanded = 0
  // Half the plug's jump per set (the jump is twice the diameter step, over the radius): at a fixed
  // 0.05° a set read as passed while its corner was still on the chamfer, the latch stopped the push
  // there, and it slid off on release.
  const PASS_MARGIN = (2 * tune.toleranceGap) / sol.params.plugRadius / 2
  const pose: HandPose = { handX: 0, handY: 0, handAngle: 0 }
  const input: SolverInput = { tension: 0, handX: 0, handY: 0, handAngle: 0 }
  let acc = 0
  /** The last frame's length, s (for the over-push timer in `project`). */
  let frameDt = 1 / 60
  // ── The pick gun (snap gun): a strike shoves every unset key pin up with a real FORCE for a
  // brief window (`Params.strikeForce`), so the drivers fire over the shear while the wrench turns
  // the plug — the plug catches whichever it passes as the drivers settle, and the rest fall back
  // when the window closes (the pins jump). A force, not a rigid clamp: the drivers stay movable,
  // so the turning plug settles them onto the ledge instead of ramming a frozen body (which
  // tunnelled). See `Engine.strike`. ──
  /** How many solver steps a strike lasts — one flick, ~130 ms: long enough for the plug to catch. */
  const STRIKE_TICKS = 16
  /**
   * The blade's force on each key pin, N, in two phases. LAUNCH fires the driver up past the shear
   * against its pinch and spring (a strong shove — a pinched binder needs it); once the driver has
   * cleared, HOLD balances the driver's spring so it hangs just above the line while the wrench
   * turns the plug and catches it, rather than over-driving into the housing (which crashed back
   * and tunnelled). Both found on the bench.
   */
  const STRIKE_LAUNCH = 1.6
  const STRIKE_HOLD = 0.5
  /** Where a LUCKY pin is driven — its driver's bottom just clears its own shear, and is caught. */
  const STRIKE_CLEAR = sim.chambers.map((c) => c.setLift + 0.2)
  /** Where an UNLUCKY pin is driven — up, so it visibly jumps, but short of the shear, so it cannot catch. */
  const STRIKE_JIGGLE = sim.chambers.map((c) => Math.max(0.3, c.setLift - 0.3))
  /**
   * The strike's ceiling (D-222): a struck pin may not rise past its target height, whatever the
   * launch force does — the owner's "additional physical layer", a lid the bump cannot fling a pin
   * through ("regardless the force they will not just away"). A small margin above the target so the
   * driver still clears the shear to be caught, then the clamp stops the overshoot dead.
   */
  const STRIKE_CAP_MARGIN = 0.1
  /**
   * The chance each jumped pin is HELD up long enough to be caught this strike — the luck of a
   * snap gun. The unlucky pins jump too (they are launched), but their blade lets go the moment
   * they clear, so they fall before the plug's rim reaches them and nothing catches. So a strike
   * sets a random few, and a few bumps at the right tension open the lock (owner: "make it lucky,
   * fewer catches per strike").
   */
  const CATCH_CHANCE = 0.55
  /** The gun's own luck stream, seeded off the lock so a bench run is repeatable. */
  const gunRng = createRng((seed ^ 0x5f356495) >>> 0)
  let strikeTicks = 0
  /** Which chambers this strike is driving — the ones not already set, so a strike keeps the sets. */
  const struck = sol.chambers.map(() => false)
  /** Which struck chambers are lucky this strike: held up to be caught. The rest jump but fall. */
  const heldThisStrike = sol.chambers.map(() => false)

  /**
   * The strike's per-pin force, before a solver step: LAUNCH until the driver clears the shear,
   * then HOLD (balancing its spring) so it hangs for the plug to catch. Run whether or not the
   * wrench is held (D-222) — a bump with no tension still jumps the pins; nothing catches them.
   */
  function applyStrikeForce(): void {
    const q = sol.bodies.q
    sol.chambers.forEach((ch, i) => {
      if (!struck[i]) return
      const keyLift = q[ch.key.body * DOF + 1]! - ch.keyRestY
      const target = heldThisStrike[i] ? STRIKE_CLEAR[i]! : STRIKE_JIGGLE[i]!
      sol.strikeForce[i] = keyLift < target ? STRIKE_LAUNCH : STRIKE_HOLD
    })
  }

  /**
   * The strike's ceiling (D-222), after the step: a struck pin — key and driver — may not stand
   * past its target, so however hard the launch drove it, it stops there instead of flying away.
   * Run in both wrench paths: without it, a no-wrench bump flung the pins with no cap and the
   * solver diverged (owner, iPhone: "after bump all pins are just thrown away").
   */
  function clampStrike(): void {
    const q = sol.bodies.q
    const v = sol.bodies.v
    sol.chambers.forEach((ch, i) => {
      if (!struck[i]) return
      const target = (heldThisStrike[i] ? STRIKE_CLEAR[i]! : STRIKE_JIGGLE[i]!) + STRIKE_CAP_MARGIN
      const kb = ch.key.body * DOF + 1
      if (q[kb]! - ch.keyRestY > target) {
        q[kb] = ch.keyRestY + target
        if (v[kb]! > 0) v[kb] = 0
      }
      const db = ch.driver.body * DOF + 1
      if (q[db]! - ch.driverRestY > target) {
        q[db] = ch.driverRestY + target
        if (v[db]! > 0) v[db] = 0
      }
    })
  }

  const eng: Engine = {
    def,
    sol,
    sim,
    readouts,
    bindingChamber: -1,
    clickedNow: false,
    strike: () => {},
    debug: { cap: Number.POSITIVE_INFINITY, blocked: false, falseSet: Number.POSITIVE_INFINITY },
    stateOf: (i) => states[i] ?? 'FREE',
    tipRest: () => {
      const ch = sol.chambers[0]!
      return ch.keyRestY + ch.key.bottomU - tune.passClearance
    },
    drive: (tipX, tipY, tension, dt, counter = 0) => {
      frameDt = dt
      eng.clickedNow = false
      eng.debug.falseSet = Number.POSITIVE_INFINITY
      aimTip(sol, tipX, tipY, pose)
      if (counter <= 0) counterCap = Number.POSITIVE_INFINITY
      commanded = Math.max(0, tension)
      // The waist floor (`hardCap`): while the pick pushes the pin under the TIP and the plug's
      // corner is in that driver's groove, the plug may not turn back — only counter-rotation
      // moves it, at its rate. Keyed to the pin under the tip, not to any pick contact: the blade
      // brushes a false-set spool's key pin on its way to the next pin (that key pin hangs in
      // the plug's pinch instead of dropping), and the pin that binds behind it must still lift
      // (owner: "the one that binds is no longer able to set up, which is unreal").
      const P0 = sol.params
      const under = Math.round((tipX - P0.firstChamberX) / P0.pitch)
      onWaist = under >= 0 && under < states.length && touches[under]!.waist && readouts[under]!.pickForce > 0.02
      if (tension > 0) armPush()
      else {
        pushBlocked = false
        // The wrench is off: every latched overset resets (D-220) — the plug rolls back into line
        // and the wedged pins drop. Clear the holds so the drivers actually fall, unless a gun
        // strike is mid-flight (it owns `strikeForce`).
        if (overLatched.some((v) => v)) {
          overLatched.fill(false)
          if (strikeTicks === 0) sol.strikeForce.fill(0)
        }
      }
      // Blocked by an over-pushed pin, the wrench does nothing: no torque, and the plug is held.
      // (During a strike the wrench stays ON: the force keeps the drivers movable, so the plug
      // turns and catches whichever clears the shear — that IS the snap gun.)
      input.tension = pushBlocked ? 0 : Math.max(0, tension)
      input.handX = pose.handX
      input.handY = pose.handY
      input.handAngle = pose.handAngle
      acc += dt
      // Open is the end: with every pin set the free plug swings 25–30° in a friction limit cycle
      // against the set drivers on its rim (`contacts.deep` 8), so the solver stops here.
      const steps = sim.opened ? 0 : Math.min(4, Math.floor(acc / DT))
      acc -= steps * DT
      for (let i = 0; i < steps; i += 1) {
        if (tension <= 0) {
          setStops(STOP_MIN, STOP_OPEN)
          // A bump with no wrench still fires the pins up, but the strike must run its course and
          // clear (D-222) — otherwise its launch force lived on and flung the pins without bound.
          if (strikeTicks > 0) applyStrikeForce()
          step(sol, input)
          if (strikeTicks > 0) {
            clampStrike()
            strikeTicks -= 1
            if (strikeTicks === 0) sol.strikeForce.fill(0)
          }
          returnPlug()
          continue
        }
        // Every stop on the plug — the run limit, a false set's give, the counter-rotation stop,
        // the pushed-pin hold — as one cap, applied SOFTLY: the plug's speed is limited so that
        // it arrives at the cap within the substep instead of overshooting and being reset. A
        // reset of up to 0.7° a substep (the plug's full rate) yanked the rim back and forth
        // under the set drivers and the last one lost its footing (`contacts.deep` 4).
        // A cap only stops the plug going FORWARD past it. One that engages below where the
        // plug already is — a false set's give, computed once the corner is at the groove's
        // height — must not pull the plug back: the owner saw the wrench held at 5.26°, the plug
        // jump to 4.4° on its own while he pushed the spool, and the spool go through without
        // his counter-rotation. Only counter-rotation itself moves the plug back, and only at its
        // rate: a cap that lands further below a counter-rotating plug is held to `rate·DT` too.
        const before = sol.bodies.q[BODY_PLUG * DOF]!
        let cap = Math.max(plugCap(counter), counter > 0 ? before - counter * DT : before)
        // The pushed-pin hold wins over a receding counter-rotation stop: both ways means both.
        if (pushBlocked) cap = Math.max(cap, pushCap)
        eng.debug.cap = cap
        eng.debug.blocked = pushBlocked
        // The waist floor: the plug is held where it is — or carried down at the counter-rotation
        // rate, the cap then being below `before` and the floor following it.
        const floor = pushBlocked ? pushCap : onWaist ? Math.min(cap, before) : STOP_MIN
        setStops(floor, cap)
        softCap(cap)
        // The strike's per-pin force (`applyStrikeForce`): LAUNCH until the driver clears the shear,
        // then HOLD so it hangs there for the plug to catch. Applied inside `step` via `strikeForce`.
        if (strikeTicks > 0) {
          applyStrikeForce()
        } else if (overLatched.some((v) => v)) {
          // Hold each latched overset (D-220) at the height it wedged — a force balancing the
          // spring so the driver hangs there for the plug to stay caught on, even once the pick is
          // withdrawn. Below that height it gets a launch back up: a fallen overset is not a
          // reset, only the wrench coming off is.
          const q = sol.bodies.q
          sol.chambers.forEach((ch, i) => {
            if (!overLatched[i]) {
              sol.strikeForce[i] = 0
              return
            }
            const keyLift = q[ch.key.body * DOF + 1]! - ch.keyRestY
            sol.strikeForce[i] = keyLift < overLiftAt[i]! - 0.05 ? STRIKE_LAUNCH : STRIKE_HOLD
          })
        }
        step(sol, input)
        if (strikeTicks > 0) {
          // The ceiling (D-222), the owner's "additional physical layer": after the step, no struck
          // pin may stand past its target height — key pin AND driver are clamped back to it and any
          // remaining upward velocity killed, so however hard the launch drove them they stop there
          // instead of flying away ("regardless the force they will not just away").
          const q = sol.bodies.q
          const v = sol.bodies.v
          sol.chambers.forEach((ch, i) => {
            if (!struck[i]) return
            const target = (heldThisStrike[i] ? STRIKE_CLEAR[i]! : STRIKE_JIGGLE[i]!) + STRIKE_CAP_MARGIN
            const kb = ch.key.body * DOF + 1
            if (q[kb]! - ch.keyRestY > target) {
              q[kb] = ch.keyRestY + target
              if (v[kb]! > 0) v[kb] = 0
            }
            const db = ch.driver.body * DOF + 1
            if (q[db]! - ch.driverRestY > target) {
              q[db] = ch.driverRestY + target
              if (v[db]! > 0) v[db] = 0
            }
          })
          strikeTicks -= 1
          if (strikeTicks === 0) sol.strikeForce.fill(0)
        }
        hardCap(cap, floor, before, counter > 0)
        clickSet()
      }
      project()
    },
    pick: () => readPick(sol),
    theta: () => plugAngle(sol),
    bindAngle: (i) => bindAt[i] ?? Number.POSITIVE_INFINITY,
    footAboveRim: (i) => lowestY(sol.chambers[i]!.driver) - rimCornerY(sol),
    plugFree: () => openReady,
    jammed: (i) => overLatched[i] === true,
    openAngle: () => {
      const hold = Number.isFinite(holdAt) ? holdAt : plugAngle(sol)
      const unset = states.filter((st) => st !== 'SET').length
      return hold + Math.max(0, unset - 1) * 0.2 * DEG + RUN_PAST
    },
  }

  /**
   * With the wrench off the plug turns BACK — moved, not torqued. A real plug is pushed back by
   * the pin springs; the game's flat ledges (chosen so sets hold) took that away. A return TORQUE
   * was tried first and a canted binder wedged against it: a pin bridging two offset bores at a
   * small cant self-locks in both directions under friction, so the plug came back 0.07° and
   * stuck (owner: "when I add tension and then release, it stays at 1.24 degree"). So the plug
   * is walked to zero at `RETURN_RATE`; the solver's contacts then push every pin where the
   * realigned bores want it, and every set drops (owner: "plug by default need to return back").
   */
  function returnPlug(): void {
    const q = sol.bodies.q
    const v = sol.bodies.v
    const i = BODY_PLUG * DOF
    const th = q[i]!
    q[i] = th > 0 ? Math.max(0, th - RETURN_RATE * DT) : 0
    v[i] = 0
  }

  /**
   * A pushed pin blocks the wrench: while any key pin the pick is carrying stands more than
   * `OVER_PUSH` above the plug's leading rim corner, the wrench's torque is taken off and the plug
   * is HELD where it is — both ways, so the sets keep their ledges — until the pin is lowered.
   * Read from the last frame's readouts; decided BEFORE the frame's steps (a free plug covers
   * 0.7° in one substep). Holding the plug with the torque still ON was tried first: each
   * substep the torque drove the plug's wall into the binding driver, the hold reset the plug,
   * and the driver ratcheted 0.3 mm into the housing's mouth corner (`contacts.deep` 1).
   */
  function armPush(): void {
    const cornerY = rimCornerY(sol)
    let blocked = false
    for (let k = 0; k < readouts.length; k += 1) {
      const r = readouts[k]!
      // A latched overset (D-220) keeps the plug blocked with no hand on the pin: the driver is
      // held up by `strikeForce`, not the pick, so the live over-push test would let go the moment
      // the pick moved off. The latch is the hold now, until the wrench drops.
      if (overLatched[k]) blocked = true
      else if (r.pickForce > 0.02 && r.keyTopY - cornerY > OVER_PUSH) blocked = true
    }
    if (blocked && !pushBlocked) pushCap = sol.bodies.q[BODY_PLUG * DOF]!
    pushBlocked = blocked
  }
  // (The hold itself is a term of `plugCap`, and `hardCap` keeps the plug from falling back.)

  /**
   * The plug never runs more than `RUN_PAST` past the angle a pin last held it at — always, not
   * only once every pin reads set. That is past the next binder (the steps are 0.9–1.15°) and
   * most of a false set's give, so picking barely meets it (at 3° the last driver, carried 0.33
   * mm along the rising rim in a frame, once lost its footing: `deep` 4); the last pin's set leaves the
   * plug waiting here until the pick lets go and the open is called (owner: "it should not be
   * possible to turn the tension wrench with the lockpick pushing the pin"). Gating this on the
   * SET read let a set that read a frame late run the free plug to 23° with the pick still up,
   * and the drivers fell into the turned plug (`contacts.deep` 3); gating it on "every driver
   * above the rim corner" failed the other way, because set drivers rest at the height the
   * corner had when they set, below where it has risen to since.
   */
  // (The run limit itself is the first term of `plugCap`.)

  /**
   * Counter-rotation: a stop that walks back at `rate` rad/s, the wrench still on. The plug is
   * held against the stop by its torque and follows it down, the way a hand eases a wrench to let
   * a spool through — moved, not torqued, like `returnPlug`, so a canted pin cannot wedge it.
   * (Torque OFF instead let the set drivers' springs cam the free plug home in a quarter second
   * and every set dropped — measured 3.6° → 0.6° in 0.4 s.) The pins answer: a set driver stays
   * on its ledge until the plug is back past its own bind angle, then drops; a false-set spool's
   * foot gets its room.
   */
  function counterCapNow(rate: number): number {
    const q = sol.bodies.q[BODY_PLUG * DOF]!
    counterCap = Math.max(0, Math.min(counterCap, q) - rate * DT)
    return counterCap
  }

  /** The tightest stop on the plug this substep, radians; +Infinity for none. */
  function plugCap(counter: number): number {
    let cap = Number.isFinite(holdAt) ? holdAt + RUN_PAST : Number.POSITIVE_INFINITY
    const falseSet = falseSetCap()
    eng.debug.falseSet = Math.min(eng.debug.falseSet, falseSet)
    cap = Math.min(cap, falseSet)
    if (counter > 0) cap = Math.min(cap, counterCapNow(counter))
    if (pushBlocked) cap = Math.min(cap, pushCap)
    return cap
  }
  /**
   * The cap as the solver's own rotation stop (`Params.thetaOpen`; the pushed-pin hold as
   * `thetaMin` too). The soft and hard caps around `step` bound the plug only at the substep's
   * edges; INSIDE the step's eight sub-substeps the wrench had the plug to itself. When a serrated
   * driver's groove reached the rim corner the pinch let go, the plug ran 0.34° → 0.77° at 60°/s
   * within one step, the serration's lip jammed on the rising ledge, and the hard cap then
   * teleported the plug back 0.44° with the driver left canted 3.9° and a corner inside the
   * plug's wall — next step `contacts.deep` 5 and the driver flipped 96° into the plug (owner:
   * "the third pin's driver falls out of the shaft into the keyhole" — the serrated trainer, seed
   * 4, counter-rotating on pin 3). As a stop contact the cap is solved together with the pins'
   * contacts: the plug never leaves it, and nothing is teleported.
   */
  function setStops(lo: number, hi: number): void {
    const P = sol.params as { thetaMin: number; thetaOpen: number }
    P.thetaMin = lo
    P.thetaOpen = Number.isFinite(hi) ? hi : STOP_OPEN
  }
  /** Before the step: no faster than reaches the cap by the end of the substep. */
  function softCap(cap: number): void {
    if (!Number.isFinite(cap)) return
    const i = BODY_PLUG * DOF
    const v = sol.bodies.v
    v[i] = Math.min(v[i]!, (cap - sol.bodies.q[i]!) / DT)
  }
  /**
   * After the step: what is left past the cap — the stop's residual (at most the solver's slop)
   * and the counter-rotation's own increment — taken back. And the floor's residual, the same
   * way. A floor as a kinematic reset (the ratchet below) was tried against the spool lever and
   * the solver answered 12 N against an immovable plug with 14–18 tunnelled contacts; as the
   * solver's own stop (`Params.thetaMin`, see `setStops`) it is solved with the pins' contacts,
   * the way the pushed-pin hold already was.
   *
   * THE WAIST FLOOR replaces the 0.3 N hand cap of 2026-09-15. A false-set spool, canted between
   * the housing's mouth corner and the plug's bore wall, is a lever: pushed, it pulls the two
   * bores back into line — 15 N·mm of backward torque per newton at the old 1° a pin, twice the
   * default wrench — and the plug backed out of the waist on its own (owner: "while pressing the
   * tension wrench (5.26°) I push, and it suddenly changes to 4.4°, which allows me to push the
   * spool"). The cap of 0.3 N kept the lever under the wrench, but a hand that puts 0.3 N through
   * a pin does not lift it at all — the pick sat under the spool (owner: "when the pin is binding
   * the lockpick under it moves very slowly"). Now the hand pushes with all 6 N, the plug is held
   * by its floor, and the spool is what it is: jammed under the corner until the right button
   * turns the plug back.
   */
  function hardCap(cap: number, floor: number, before: number, counterOn: boolean): void {
    const i = BODY_PLUG * DOF
    const q = sol.bodies.q
    if (q[i]! > cap) {
      q[i] = cap
      sol.bodies.v[i] = 0
    }
    if (Number.isFinite(floor) && floor > STOP_MIN && q[i]! < floor) {
      q[i] = floor
      sol.bodies.v[i] = 0
    }
    // Only while the pick is on a pin: that is the lever. With the pick off, the plug settles
    // back onto its binder after an overshoot as it should (held at the run limit past pin 4,
    // the Northgate cabinet stalled with that pin free).
    if (RATCHET > 0 && pickOn && !counterOn && !pushBlocked && q[i]! < before - RATCHET) {
      q[i] = before - RATCHET
      sol.bodies.v[i] = Math.max(0, sol.bodies.v[i]!)
    }
    // The pushed-pin hold is both ways: the sets keep their ledges while the wrench is dead.
    if (pushBlocked && q[i]! < pushCap) {
      q[i] = pushCap
      sol.bodies.v[i] = 0
    }
  }

  /**
   * A false set is a bounded give: the plug's corner may enter a lifted security driver's groove
   * by at most `WAIST_DROP_MAX` past the head's side. Physically the head then meets the housing
   * wall (0.17 mm of play each side); asked to resolve the plug's corner on the groove's floor
   * with the foot on the key pin and the head on the housing, the contact solver tunnels
   * (`contacts.deep` 6 at 7.8° in the trainer). The earlier rule — 3° past the angle a pin last
   * held the plug at — followed the binder as it crept down the shallow shoulder and bounded
   * nothing. What follows is that older comment, kept for the record.
   *
   * A false set is at most `FALSE_SET_MAX` deep — a game rule, and the one that keeps the solver
   * honest. With every spool's waist on the line, the moment the last standard pin sets the plug
   * drops into every waist at once and overshoots the shallowest one's wall, wedging that spool
   * between its shoulder and the key pin beneath it: a three-body jam the contact solver could
   * only resolve by penetration (`contacts.deep` 3–6, then nonsense). So while any pin is unset
   * the plug may not turn further than this past the angle a pin last held it at. Once every pin
   * is set the plug is free to open.
   */
  function falseSetCap(): number {
    if (allSet) return Number.POSITIVE_INFINITY
    const P = sol.params
    const cornerY = rimCornerY(sol)
    let cap = Number.POSITIVE_INFINITY
    sol.chambers.forEach((ch, k) => {
      const g = grooves[k]!
      if (g.length === 0) return
      const r = readouts[k]!
      if (r.driverLift < 0.05) return
      // Only while the plug's corner is at a groove's height — under a set spool's foot the
      // corner sits deeper than this on purpose (that is the ledge).
      const height = cornerY - lowestY(ch.driver)
      if (!g.some(([lo, hi]) => height >= lo - 0.05 && height <= hi + 0.05)) return
      const full = ch.driver.profile.right.reduce((m, [, h]) => Math.max(m, h), 0)
      // The corner's sideways position is (bore + chamfer)·cos θ − (rimY + R)·sin θ ≈ a − b·θ:
      // the angle at which it is `WAIST_DROP_MAX` past the head's side.
      const limitX = r.driverX + full - WAIST_DROP_MAX
      cap = Math.min(cap, (P.boreRadius + P.rimChamfer - limitX) / (sol.rimY + P.plugRadius))
    })
    return cap
  }

  /**
   * The click: see `CLICK_MM`. Only the binder, only while the pick is lifting it, once. The foot
   * is the driver's LOWEST corner: a pinched driver cants ~1.8°, which puts one bottom corner
   * 0.05 mm below its bottom's centre — landing the centre clear of the rim left that corner in
   * the bore, still pinched, and the pop still needed the hand (measured).
   */
  function clickSet(): void {
    const b = eng.bindingChamber
    if (b < 0 || clicked[b] || touches[b]!.waist) return
    const ch = sol.chambers[b]!
    const r = readChamber(sol, b)
    if (r.plugForce < 0.02 || r.pickForce < 0.05) return
    const foot = lowestY(ch.driver) - rimCornerY(sol)
    if (foot >= 0 || foot < -CLICK_MM) return
    const drv = ch.driver.body * DOF + 1
    sol.bodies.q[drv] = sol.bodies.q[drv]! + (CLICK_LAND - foot)
    clicked[b] = true
    eng.clickedNow = true
  }

  /**
   * Where the plug touches chamber `i`'s driver, from the contacts of the last substep: `waist`
   * — a plug contact inside one of the driver's grooves (ramps and a hair of slack included),
   * the plug's corner in the waist; `pinch` — a plug contact whose normal is mostly sideways (a
   * wall, not a chamfer or a corner under the foot), the plug pressing the driver's side. Only
   * contacts carrying force count. A contact on the HEAD's side — a spool at rest, its head at
   * the line — is a pinch, not a waist (that misread was "FALS" on an untouched spool).
   */
  function plugTouch(i: number): PlugTouch {
    const c = sol.contacts
    const drv = sol.chambers[i]!.driver
    const low = lowestY(drv)
    const g = grooves[i]!
    let waist = false
    let pinch = false
    for (let j = 0; j < c.count; j += 1) {
      const a = c.a[j]!
      const b = c.b[j]!
      if (!((a === drv.body && b === BODY_PLUG) || (b === drv.body && a === BODY_PLUG))) continue
      if (c.lamN[c.slot[j]!]! / sol.h < 0.02) continue
      const height = c.py[j]! - low
      if (g.some(([lo, hi]) => height >= lo - 0.02 && height <= hi + 0.02)) waist = true
      if (Math.abs(c.nx[j]!) > 0.85) pinch = true
    }
    const cornerY = rimCornerY(sol)
    return { waist, pinch, keyOver: readouts[i]!.keyTopY - cornerY, foot: low - cornerY }
  }

  /** Pour a solver tick into the game's read model. */
  function project(): void {
    sol.chambers.forEach((_, i) => {
      readouts[i] = readChamber(sol, i)
    })
    const pick = readPick(sol)
    // BINDING is a rank, not a contact: the pin carrying the most plug force is the one the wrench
    // is asking about. Others brushing a wall keep their contact marks and read FREE — "sometimes
    // there are two binding pins" was two pins over a 0.3 N threshold, one of them barely touching.
    eng.bindingChamber = -1
    // No threshold: under tension SOMETHING holds the plug, and it is the unset pin carrying the
    // most plug force, however little (owner: "ensure that once the pin is set, another starts to
    // bind" — during a push the next pin was pinched too lightly for the old 0.3 N bar).
    let bestF = 0.02
    const th = plugAngle(sol)
    readouts.forEach((r, i) => {
      const touch = plugTouch(i)
      touches[i] = touch
      // With hysteresis: a chamber counts as passed once the plug is a margin past its bind angle,
      // and stays so until the plug is back within a quarter of that. Without it a set pin sitting
      // right at the margin flickered SET/FREE from frame to frame, and the front view — which
      // magnifies the ledge only for a SET pin — flipped with it, which read as trembling.
      const past = th - bindAt[i]!
      if (past > PASS_MARGIN) passedNow[i] = true
      else if (past < PASS_MARGIN * 0.25) passedNow[i] = false
      // By geometry: the plug's turn at the rim exceeds this driver's sideways play.
      const ring = sol.chambers[i]!.driver.profile.right.reduce((m, [, half]) => Math.max(m, half), 0)
      const passedGeom = th * sol.params.plugRadius > 2 * (sol.params.boreRadius - ring) + 0.01
      overFor[i] = touch.keyOver > OVER_PUSH && r.pickForce > 0.05 ? overFor[i]! + frameDt : 0
      states[i] = chamberStateOf(r, sol, passedNow[i]!, def.pins[i] !== 'standard', touch, passedGeom, overFor[i] > OVER_HOLD)
      // Latch a STANDARD pin held OVERSET under the wrench for `OVERSET_LATCH_TIME` (D-220). Every
      // overset in this solver is a pin that set as it cleared and then got over-pushed (`passed`
      // holds), so the discriminator is not "never set" — it is HELD. The auto-solver sets a plain
      // pin and moves straight on, so it never sits on one long enough to trip this; a player who
      // leans on Space past the click does. Security pins are excluded: they are worked past the
      // line on purpose (false sets, easing the wrench). The timer is force-independent
      // (`overStateFor`), because a wedged pin settles at a low-force equilibrium.
      const latchable =
        !gunUsed && commanded > 0 && states[i] === 'OVERSET' && def.pins[i] === 'standard'
      overStateFor[i] = latchable ? overStateFor[i]! + frameDt : 0
      if (overStateFor[i] > OVERSET_LATCH_TIME) {
        // The wedge height is captured once so the hold in `drive` keeps it there.
        if (!overLatched[i]) overLiftAt[i] = Math.max(0, r.keyLift)
        overLatched[i] = true
      }
      if (overLatched[i]) states[i] = 'OVERSET'
      // A snap-gun strike drives every reached driver ballistic over the shear (D-221): while it is
      // up there, mid-jump, it is not overset — it is the bump doing its job, so it must not flash
      // red and read as a mistake (owner: "all the pins run away and act weirdly"). A struck pin
      // reads neutral through the strike window; when it ends it either caught (SET) or fell.
      if (strikeTicks > 0 && struck[i] && states[i] === 'OVERSET') states[i] = 'FREE'
      if (states[i] === 'FREE') clicked[i] = false
      if (r.plugForce > bestF && states[i] === 'BINDING') {
        bestF = r.plugForce
        eng.bindingChamber = i
      }
    })
    // Binding is a wrench-on word: with the wrench off the return torque pinches nothing that
    // deserves the name.
    if (sol.input.tension <= 0) eng.bindingChamber = -1
    // A reset forgets the attempt (D-225). The bind angles and the last hold were MEASURED on the
    // attempt the dropped wrench just ended; kept, they judged the next one — a pin read unset
    // against its old bind angle, the open waited on the old hold — so a lock could be lost after
    // a reset that would have opened fresh (four generated tier 3–4 locks: each opened from a new
    // session, none after a reset). Cleared once the wrench is off and the plug is home.
    if (sol.input.tension <= 0 && th < RESET_HOME) {
      bindAt.fill(Number.POSITIVE_INFINITY)
      holdAt = Number.POSITIVE_INFINITY
      passedNow.fill(false)
    }
    states.forEach((st, i) => {
      if (st === 'BINDING' && i !== eng.bindingChamber) states[i] = 'FREE'
    })
    if (eng.bindingChamber >= 0) {
      bindAt[eng.bindingChamber] = th
      // The limiter's reference is a real pinch, not a brush: a spool touching a wall mid-jump
      // read as the binder and dragged the limit along with the plug.
      if (readouts[eng.bindingChamber]!.plugForce > BIND_MIN_FORCE) holdAt = th
    }
    allSet = states.every((st) => st === 'SET')
    // The return torque is not a wrench: the HUD sees the wrench off. A wrench the pushed-pin
    // block has taken the torque off is still the hand's wrench: the HUD keeps showing it.
    const T = pushBlocked ? commanded : Math.max(0, sol.input.tension)
    sim.tension = T
    sim.tensionCommanded = T
    sim.theta = plugAngle(sol)
    sim.thetaMax = SIM_THETA_OPEN
    sim.thetaDemand = SIM_THETA_OPEN * Math.min(1, T / 0.25)
    sim.bindingChamber = eng.bindingChamber
    sim.pickChamber = chamberUnderTip(sol)
    sim.pickPosition = sim.pickChamber < 0 ? -1 : (pick.tipX - sol.params.firstChamberX) / sol.params.pitch
    sim.resistance = Math.min(1, pick.force / 6)
    sim.pickForce = Math.min(1, pick.force / 6)
    sim.pickContact = pick.force > 0.05 ? 1 : 0
    sim.pickStrain = Math.min(1, pick.bendDeflection / 3)
    // Open once the plug is well past every bind: with four set drivers camming on the rim the
    // plug settles short of the game's 30°, and 22° is unmistakably open.
    // Open the moment the free plug has left the last pin behind, not 20° later: the keyway (and
    // the pick in it) does not turn with the solver's plug, so a long open swing drags the key
    // pins through the plug's floor (`contacts.deep` 8–11). The bench freezes here and says open.
    const thNow = plugAngle(sol)
    // With every pin set and the plug past the last hold it is free — but not while the pick is
    // still pushing a pin (owner: "it should not be possible to turn the tension wrench with the
    // lockpick pushing the pin"): the plug is held there (`clampOpen`) until the pick lets go.
    openReady = allSet && Number.isFinite(holdAt) && thNow > holdAt + OPEN_PAST - 1e-9
    pickOn = pick.force >= 0.05
    sim.opened = thNow > SIM_THETA_OPEN * 0.75 || (openReady && !pickOn)
    sim.time = sol.time
    sim.engaged = T > 0
    readouts.forEach((r, i) => {
      const sc = sim.chambers[i]
      if (!sc) return
      sc.lift = Math.max(0, r.driverLift)
      sc.keyLift = Math.max(0, r.keyLift)
      sc.state = states[i]!
    })
  }

  eng.strike = (): void => {
    // The pins are so light and damped that a plain velocity impulse dies in a millisecond and a
    // rigid blade rams the plug into tunnelling. So a strike opens a brief LOOSE window: the pins'
    // damping and gravity are cut, and every pin gets a hard upward velocity, so the key pins fire
    // their drivers ballistically over the shear and hang there a moment before falling back. The
    // freed plug creeps forward under the wrench and catches whichever driver its rim passes while
    // it is up — then the window closes, damping and gravity return, and the rest fall (the pins
    // jump). Tension is the whole skill: too much and the drivers bind before they clear, too
    // little and none are caught, so a few bumps at the right pressure open it.
    strikeTicks = STRIKE_TICKS
    gunUsed = true
    // The needle only reaches the pins in front of its tip (D-219, owner: aim the gun by insertion
    // depth). A strike jumps a pin only if the needle currently reaches its chamber — pins deeper
    // than the tip are untouched, so sliding the needle in and out picks which pins a bump can
    // catch. The needle is withdrawn when the tip is short of pin 1: then a strike does nothing.
    const tipX = readPick(sol).tipX
    // Only the pins that are not already set: a strike must not fire a caught driver off its ledge
    // (that undid the last strike's work). A binding or free pin is struck; a set or overset one is
    // left alone.
    sol.chambers.forEach((ch, i) => {
      const reached = ch.x <= tipX + NEEDLE_REACH
      struck[i] = reached && states[i] !== 'SET' && states[i] !== 'OVERSET'
      // The luck: a struck pin is HELD (catchable) only if its roll comes up; the rest jump and fall.
      // A security pin (spool, serrated, mushroom, t-pin…) is NEVER held clear of the shear by the
      // gun: its driver catches at a waist or a notch and falls back, so it only jiggles — a snap
      // gun is defeated by security pins, and it must not set them (owner: "why so easy serrated
      // pins are bumped?", "how can false-sets be bumped?"). Only a standard pin can be caught.
      heldThisStrike[i] = struck[i] && def.pins[i] === 'standard' && nextFloat(gunRng) < CATCH_CHANCE
      sol.strikeForce[i] = struck[i] ? STRIKE_LAUNCH : 0
    })
  }

  project()
  return eng
}
