/**
 * The tick — SIMULATION.md §9.
 *
 * `step(state, input, dt)` at a fixed `dt = 1/120`, in the order the spec lays out. The
 * renderer interpolates between states; it never steps with a variable frame time, because
 * the physics would diverge between machines and the tests would start lying.
 *
 * `step` mutates and returns the same object rather than allocating a fresh state tree each
 * tick. The architectural law is about *purity from the platform* — no DOM, no clock, no
 * unseeded randomness — not about immutability, and 120 allocations a second of a 12-chamber
 * state tree buys nothing. `cloneSimState` exists for tests that need a snapshot.
 * See DECISIONS D-014.
 */

import {
  grooveCeilingLift,
  grooveDepthAt,
  grooveFloorLift,
  quantizeDetent,
  readShearLine,
  sidebarAlignedAt,
  taperAt,
} from './classify'
import {
  BENT_JITTER_FACTOR,
  BENT_RATE_FACTOR,
  BIND_HARDNESS,
  CAPTURE_TIME,
  CONTINUOUS_EVENT_STRIDE,
  COUNTER_ROTATION_FORCE,
  PIN_COUNTER_FORCE,
  SERRATION_GRIP,
  TAPER_FORCE_CAP,
  DISC_SPRING_RETURN,
  DT,
  LEDGE_CLEAR_MM,
  LEDGE_FULL_ENGAGE,
  LEDGE_RELEASE_MARGIN,
  ENGAGE_RAMP,
  DISTURB_SLIP_GRACE,
  FALSE_SET_GAIN,
  PIN_FALSE_SET_GAIN,
  FEATHER_WINDOW,
  FORCE_FULL_MM,
  FREE_LIFT_MULTIPLIER,
  HOLD_ENGAGE_RELIEF,
  MAGNETIC_RETURN,
  OPEN_THETA_FRACTION,
  OVERSET_THETA_FACTOR,
  PICK_BASE_RATE,
  PICK_TRAVEL_RATE,
  PLUG_MAX_RATE,
  PLUG_MOVED_EPSILON,
  PLUG_PUSHBACK,
  PLUG_TAKEUP_RATE,
  RESIST_BINDING_BASE,
  RESIST_BINDING_TENSION,
  RESIST_FALSE_BASE,
  RESIST_FALSE_HZ,
  RESIST_FALSE_TENSION,
  RESIST_FALSE_WOBBLE,
  RESIST_FLOOR,
  RESIST_FREE_BASE,
  RESIST_FREE_HZ,
  RESIST_FREE_WOBBLE,
  RESIST_OVERSET,
  RESIST_PER_MM_LIFT,
  RESIST_PER_SPRING,
  RESIST_PRESSURE_MM,
  RESIST_SET,
  RESIST_SET_CONTACT,
  RESIST_SIDEBAR_DETENT,
  SET_CONTACT_MM,
  DISTURB_FACTOR,
  SET_SLIP_GRACE,
  SIDEBAR_HELD_FRACTION,
  SPOOL_CAM_BITE,
  HOOK_RISE,
  SHAFT_HALF,
  SHANK_REACH,
  SPRING_RETURN_RATE,
  STRAIN_BENT,
  STRAIN_BROKEN,
  STRAIN_PER_MM_SECOND,
  STRAIN_RECOVERY,
  TENSION_TRAVEL_DRAG,
  THETA_OPEN,
  T_FULL_TURN,
  T_MIN_HOLD,
  T_SET_HOLD,
} from './constants'
import { clamp, clamp01, damp, moveToward } from './math'

import { nextSigned } from './rng'
import type {
  Chamber,
  ChamberState,
  KeywayGrade,
  SimEvent,
  SimInput,
  SimState,
  ToolStats,
} from './types'

/**
 * How many chambers in from the keyway mouth the tip can actually get under.
 *
 * `CONTENT.md §2`: top-of-keyway wrenches leave more room for the pick (+1); bottom-of-keyway
 * ones block the deepest chamber in a tight keyway (-1). A pick that does not fit a tight
 * keyway loses another chamber. This is a hard limit — `PHASES.md` Phase 8 requires that
 * reach "genuinely prevents access to deep chambers". See DECISIONS D-015.
 */
export function effectiveReach(tools: ToolStats, keyway: KeywayGrade): number {
  let r = tools.reach
  if (tools.keywayPosition === 'top') r += 1
  if (keyway === 'tight' && !tools.fitsTightKeyway) {
    // A pick too fat for the keyway loses a chamber, and a bottom-of-keyway wrench crowding
    // it loses another. A pick that *does* fit is immune to both — that is what the catalogue
    // means by "fits tight keyways", and anything less makes the phrase a lie.
    r -= 1
    if (tools.keywayPosition === 'bottom') r -= 1
  }
  return Math.max(0, r)
}

/**
 * §5 — the plug's ledge wedges against the groove's bevel and drives the pin down.
 *
 * Three terms and no more: the torque you are applying, the steepness of the bevel the ledge is
 * riding on, and how far into the groove the ledge has actually got. A disc detainer's sidebar
 * tip does the same thing to a disc caught in a false gate — same code, different coordinate.
 *
 * There used to be a fourth, `θ / θ_open`, and taking it out is the fix to "the physics of the
 * spools is wrong". It has no physical reading: the wedge force is set by the torque and the
 * bevel angle, and how far the plug has *already* turned does not enter into it — while the
 * depth of entry, which does, is what `engage` already measures. What it did have was a
 * devastating game consequence. Through the whole of a normal pick θ sits at one pin's take-up,
 * around 0.01 rad against a θ_open of 0.52, so the term held the pushback at about two per cent
 * of its value until the very last pin. A false-set spool shoving back against your pick is not
 * a flourish for the endgame — it *is* the spool. It is the entire reason you know you have hit
 * one, and for most of every attempt it was not happening. See DECISIONS D-053.
 */
function applyCounterRotation(state: SimState, c: Chamber, T: number, dt: number): void {
  if (c.state !== 'FALSE_SET') {
    c.counterForce = 0
    return
  }
  const engage = clamp01((state.theta - c.delta) / ENGAGE_RAMP)
  // Pins fight at D-204's raised force; discs keep the spec's — a wheel's gate drag is
  // tuned feel the dungeon has burned us on twice, and the owner's ruling was about pins.
  // The taper cap is pin-side only for the same reason.
  const disc = c.kind === 'disc'
  const force = disc ? COUNTER_ROTATION_FORCE : PIN_COUNTER_FORCE
  const taper = disc ? taperAt(c) : Math.min(taperAt(c), TAPER_FORCE_CAP)
  c.counterForce = force * T * (0.25 + taper) * engage
  if (c.counterForce > 0) {
    if (c.counterForce > state.stats.maxCounterForce) {
      state.stats.maxCounterForce = c.counterForce
    }
    c.lift = Math.max(grooveFloorLift(c), c.lift - c.counterForce * dt)
  }
}

/**
 * §8 — what the chamber under the pick tip feels like.
 *
 * A sidebar lock adds one reading on top: the sidebar has a leg on *every* gated chamber, not
 * only the one the plug is pinching, and the legs are sprung inward against the pins whether
 * or not the plug is under torque. So a gated chamber goes notchy-light wherever its gate is,
 * at any tension including none — which is what lets a player survey the gates with the wrench
 * off, before a single pin is set and while a mistake still costs nothing (SIMULATION.md §10).
 *
 * Requiring tension for the tell looked tidier and was unusable: a wrench has a `tensionMin`,
 * every wrench in the catalogue bottoms out above `T_MIN_HOLD`, and a survey conducted above
 * `T_MIN_HOLD` captures the pin at whatever height it had reached when the plug came round —
 * usually the bottom of the window, permanently misaligned. See DECISIONS D-029.
 */
function resistanceFor(
  c: Chamber | undefined,
  tension: number,
  time: number,
  pressure: number,
  /** Commanded tip height in mm — where the hand is asking the tip to be (D-045's measure). */
  tipMm = 0,
): number {
  if (!c) return 0
  /**
   * An overset chamber's jam is felt on **contact**, not at a distance — D-158.
   *
   * The key pin is pinched across the shear line with the bore below it empty (D-094), so until
   * the tip reaches its underside there is nothing under the hand but air — and the reading said
   * `RESIST_OVERSET` anyway, plus the full spring-compression term for a spring the tip was not
   * touching. Reported from play: *"when you press on a key pin which was not lifted yet to the
   * driver pin — it still shows the resistance. Which should not."* The same closing ramp a
   * captured driver already uses (D-051, D-061), against the same field `pickForce` reads for
   * the pin's underside. Discs and inverted wafers keep the flat read: neither has an empty
   * bore below a jam.
   */
  const oversetClosing =
    c.state === 'OVERSET' && c.kind !== 'disc' && !c.inverted
      ? clamp01(1 - Math.max(0, c.keyLift - tipMm) / SET_CONTACT_MM)
      : 1
  /**
   * How much of the split stack the key pin has closed, 0..1 — the general rule D-158's
   * overset case was one instance of.
   *
   * Whenever the driver is parked above a gap — captured on the plug's ledge (SET) or trapped
   * in its own groove (FALSE_SET) — the key pin below it is loose, and lifting it is nearly
   * free until its top meets the driver's bottom. Reported from play as *"general physics —
   * the pressure should be super easy if only touching the key pin and the key pin does not
   * touch the driver pin."* The SET base already ramped on this gap (D-051); FALSE_SET read
   * its full formula flat, and the spring term was charged in both, for a spring sitting
   * untouched on the far side of the gap.
   */
  const stackClosing =
    (c.state === 'SET' || c.state === 'FALSE_SET') && c.kind !== 'disc' && !c.inverted
      ? clamp01(1 - Math.max(0, c.lift - c.keyLift) / SET_CONTACT_MM)
      : 1
  /**
   * This chamber's own character, applied in every state because it is a property of the hardware
   * rather than of what the pin is currently doing.
   *
   * Two terms standing for two different things: `resistanceBias` is the bore and the pin's fit
   * (D-052), `springStrength` is the spring sitting on top of it (D-062). Separate because only
   * one of them also changes how fast the pin *falls*.
   *
   * The spring term closes with the stack: it lives above the driver, and a loose key pin is
   * not loading it. The bias stays — the key pin still rubs its own bore. Both are scaled by
   * the overset closing (1 everywhere else): a tip in the empty bore below a jam touches
   * neither (D-158).
   */
  const character =
    (c.resistanceBias + (c.springStrength - 1) * RESIST_PER_SPRING * stackClosing) *
    oversetClosing
  /**
   * Hooke: the spring stiffens as it compresses, so a pin held high pushes back harder (D-070).
   *
   * Only while the stack is **whole**, and that qualifier is doing real work.
   *
   * Not on a disc: a disc has no spring — `DISC_SPRING_RETURN` is literally zero — and its `lift`
   * is an *angle*, so this would have added a quarter of a unit of resistance purely for having
   * turned it a long way round, in exactly the channel the blind gate survey reads.
   *
   * And not on a SET or FALSE_SET chamber, where the driver is held by the plug's ledge rather than
   * by the key pin: the tip is pushing a loose key pin up an empty bore and is not loading that
   * spring at all. Reading the *driver's* height there made a false-set spool parked high at its
   * waist report heavier than the pin that was actually binding — so the meter lied, and the
   * solver, which simply picks the heaviest, went and worked the wrong chamber.
   */
  const connected = c.state !== 'SET' && c.state !== 'FALSE_SET' && c.kind !== 'disc'
  // How far the spring has been squashed, which is not the same as `lift`: an inverted wafer's
  // spring is *below* it and pushes up, so the wafer rests at the top of its travel and is
  // compressed by being pushed **down**.
  const squash = c.inverted ? c.maxLift - c.lift : c.lift
  // The jammed stack's spring is genuinely compressed, but the tip only feels it on contact.
  const compression = connected ? squash * RESIST_PER_MM_LIFT * oversetClosing : 0
  const full = clamp(
    baseResistance(c, tension, time, oversetClosing, stackClosing) + character + compression,
    RESIST_FLOOR,
    1,
  )
  const detented =
    c.sidebarGate === null || c.state === 'SET'
      ? full
      : sidebarAlignedAt(c, c.lift)
        ? Math.max(0, full - RESIST_SIDEBAR_DETENT)
        : full
  /**
   * Scaled by how hard you are actually pushing.
   *
   * A pin under an unloaded tip has nothing to say. Everything that distinguishes a bound pin
   * from a free one — the friction of the plug pinching it, the spring it is riding, the bevel of
   * a groove — is a *reaction* to force, and with no force applied there is no reaction to feel.
   * So the reading rises from the floor to its full value as the tip loads up (D-056).
   *
   * Floored rather than zeroed: there is a spring on top of every pin, so a tip touching one
   * always feels something. Zero is reserved for "no chamber under the tip at all", which is how
   * the renderer knows to draw the shaft dead straight.
   */
  return RESIST_FLOOR + (detented - RESIST_FLOOR) * clamp01(pressure)
}

/**
 * How hard the tip is loaded against the chamber under it, 0..1 — the gate on everything that
 * chamber can tell you (D-056).
 *
 * Taken from the **commanded** height rather than from where the pin ended up, because that is
 * the force in your hand: a bound pin that has not budged and a free one that rode straight up to
 * meet you are being pushed exactly as hard. Zero while the tip is still travelling, because a
 * hook sliding past a pin is not leaning on it (D-045).
 *
 * Two exceptions, and both are the same exception. A **sidebar-gated** chamber has a leg sprung
 * against it whether or not you are pushing, and a **disc** is held at an angle by a tool that is
 * a turner rather than a floor — so both are loaded the moment the tool reaches them. That is
 * exactly what lets a player survey the gates with the wrench off before a single pin is set,
 * which is the one tell those families have and the whole of D-029.
 */
function feltPressure(c: Chamber | undefined, input: SimInput, settled: boolean): number {
  if (!c || !settled) return 0
  if (c.sidebarGate !== null || c.kind === 'disc') return 1
  /**
   * An overset chamber is loaded from **contact**, not from the keyway floor — D-158.
   *
   * Commanded height works as a load proxy everywhere else because the pin is resting on the
   * tip: ask for height and you are pushing the pin by that much. Here the key pin is jammed
   * high (D-094) with an empty bore under it, so the first `RESIST_PRESSURE_MM` of commanded
   * height is not force against anything — and this gate is what the state word and the
   * resistance colour hang off, so measuring it from zero made the HUD shout `overset` the
   * moment the tip entered the bore. Reported from play, twice, which is what it took.
   */
  if (c.state === 'OVERSET' && !c.inverted) {
    return clamp01((input.liftTarget - (c.keyLift - RESIST_PRESSURE_MM)) / RESIST_PRESSURE_MM)
  }
  // An inverted wafer rests at the *top* of its travel, so loading it means pressing down.
  const load = c.inverted ? c.maxLift - input.liftTarget : input.liftTarget
  return clamp01(load / RESIST_PRESSURE_MM)
}

function baseResistance(
  c: Chamber,
  tension: number,
  time: number,
  /** How much of the gap to an overset stack the tip has closed, 0..1 (D-158). */
  oversetClosing = 1,
  /** How much of a split SET/FALSE_SET stack the key pin has closed, 0..1 (D-158). */
  stackClosing = 1,
): number {
  switch (c.state) {
    case 'BINDING':
      return RESIST_BINDING_BASE + RESIST_BINDING_TENSION * tension
    case 'FALSE_SET': {
      // The trapped driver's read arrives when the key pin reaches it — until then the hand
      // is carrying a loose pin up an empty bore, which is the SET case's light read (D-158).
      const full =
        RESIST_FALSE_BASE +
        RESIST_FALSE_TENSION * tension +
        RESIST_FALSE_WOBBLE * Math.sin(2 * Math.PI * RESIST_FALSE_HZ * time)
      return RESIST_SET + (full - RESIST_SET) * stackClosing
    }
    case 'SET': {
      /**
       * Light while the key pin climbs the empty bore under a captured driver, rising to firm as
       * it comes up against it — because from there you are pushing the driver back off its ledge
       * and a little further jams the lock (D-051, D-061).
       */
      const gap = Math.max(0, c.lift - c.keyLift)
      const closing = clamp01(1 - gap / SET_CONTACT_MM)
      return RESIST_SET + (RESIST_SET_CONTACT - RESIST_SET) * closing
    }
    case 'OVERSET':
      // Light across the empty bore, the full jammed read on contact — the same shape the SET
      // case above gives a key pin climbing toward its captured driver (D-158).
      return RESIST_SET + (RESIST_OVERSET - RESIST_SET) * oversetClosing
    case 'FREE':
      return (
        RESIST_FREE_BASE +
        RESIST_FREE_WOBBLE * Math.sin(2 * Math.PI * RESIST_FREE_HZ * time + c.index)
      )
  }
}

/**
 * The tension this captured chamber needs to stay captured (D-074, D-095).
 *
 * `θ - δ` is how far the plug has swung since this chamber's ledge began closing, which is exactly
 * how much of the ledge is under the driver — the same quantity that decides whether it can be
 * pushed back off (D-071). A pin caught a moment ago is holding by a sliver and needs the full
 * `T_SET_HOLD`; one the plug has swung well past needs a quarter of it.
 *
 * The base used to be `T_MIN_HOLD`, which made the whole curve **unreachable**: its worst case is
 * 0.08 and the lightest pressure step a player can select is 0.12, so every set pin held at every
 * setting and none of this arithmetic ever ran. `T_SET_HOLD` is sized to land inside the range the
 * wheel can actually reach.
 */
export function holdThreshold(c: Chamber, theta: number, disturbance = 0): number {
  const engaged = clamp01((theta - c.delta) / LEDGE_FULL_ENGAGE)
  const base = T_SET_HOLD * (1 - HOLD_ENGAGE_RELIEF * engaged)
  /**
   * `disturbance` is how hard the tip is leaning on some *other* chamber, 0 to 1 (D-098).
   *
   * Proportional rather than a switch. As a boolean it meant "the tip is touching another pin",
   * which is true for most of an attempt and made no distinction between resting against a pin and
   * jamming into one. `pickContact` is how far past the pin the tip is being asked to go, so the
   * shake is exactly as big as the push behind it — and the caller withholds it entirely for a
   * false-set chamber, whose effect on the plug is already counted elsewhere.
   *
   * A spring term was tried here too: `T_SET_HOLD × springStrength`, so that a stiff-sprung chamber
   * always let go first and *which* chamber that is stayed the same across a save. It reads well
   * and it cost two locks their hundred per cent on the solver, so it is not here.
   */
  return base * (1 + (DISTURB_FACTOR - 1) * clamp01(disturbance))
}

/**
 * Radians of give a groove at the shear line lends the plug. Discs keep the spec's original
 * throw — the gate's drag travel is a silenced wheel's only tell (D-197) — while pins catch
 * rather than sweep (D-202): a last-pin spool used to swing 61-89% of the way to open, which
 * read as the lock turning, not as a ledge wedging into a waist.
 */
function falseSetGive(c: Chamber): number {
  return grooveDepthAt(c) * (c.kind === 'disc' ? FALSE_SET_GAIN : PIN_FALSE_SET_GAIN)
}

/** §4 — how far the plug may rotate before this chamber stops it. */
function constraintFor(c: Chamber): number {
  switch (c.state) {
    case 'SET':
      return THETA_OPEN
    case 'OVERSET':
      return c.delta * OVERSET_THETA_FACTOR
    default:
      if (c.geometry === 'GROOVE') {
        return c.delta + falseSetGive(c)
      }
      return c.delta
  }
}

/**
 * Every driver is above the shear line, nothing is holding the plug back — and the plug still
 * has not been turned far enough to open.
 *
 * This is a state a real lock genuinely has, and it was the one state the player could not read.
 * The open condition is `all SET && θ ≥ θ_open × OPEN_THETA_FRACTION` (§9), and θ is capped by
 * `θ_demand`, a function of tension alone (§4, `T_FULL_TURN = 0.25`). So a lock picked with a
 * feather — which is exactly what the game *advises* for spools, because a heavy hand jams them
 * — sits fully picked and refuses to open, with nothing on screen saying why. A real hand knows
 * instantly: the plug goes dead slack and turns against nothing. Here it has to be drawn.
 *
 * Found by a browser test that winds the wheel to its lightest step, sets all four pins, and
 * then waits out its own timeout looking for a binding chamber that no longer exists. The
 * simulation was right and the picture was silent. See DECISIONS D-048.
 */
/**
 * How high the pick's **shaft** holds a pin in front of the hook — DECISIONS D-149.
 *
 * The tool is a rigid straight strip turning about the hand. Its angle is set by the *crest*, which
 * rises `liftTarget` above rest at the chamber being worked; the shaft runs parallel to that line
 * and `HOOK_RISE` below it, and a pin rests on the shaft's **top edge**, a further `SHAFT_HALF` up.
 * So the bearing height at chamber `index` is that line, taken at the chamber's distance from the
 * hand — measured in chamber pitches, `SHANK_REACH` of them outside the lock.
 *
 * **Written twice, differently, and the two did not agree.** D-145 had this as
 * `(lift - HOOK_RISE) × xᵢ/x_pick`, which decays the *already reduced* value and so runs higher than
 * the drawn shaft everywhere except the chamber being worked. The renderer places a rigid tool, and
 * the simulation held pins on a line that was not the one being drawn: the further a chamber was
 * from the hook, the wider the gap. Reported as *"it correctly lifts the nearest pin, but for the
 * rest there is air between the lockpick and the pin."*
 *
 * Exported so the picture can be held against it — `tests/render/shank.test.ts` measures the shaft
 * the renderer actually draws and asserts it lands here, at every chamber and every lift.
 */
export function shankLift(liftTarget: number, pick: number, index: number): number {
  if (pick <= 0 || index >= pick) return 0
  const alongTool = (index + SHANK_REACH) / (pick + SHANK_REACH)
  return Math.max(0, liftTarget * alongTool - HOOK_RISE + SHAFT_HALF)
}

export function pickedButUnturned(state: SimState): boolean {
  if (state.opened || !state.sidebarDropped) return false
  if (!state.chambers.every((c) => c.state === 'SET')) return false
  return state.theta < THETA_OPEN * OPEN_THETA_FRACTION
}

/**
 * The furthest back the plug can be turned — because **a set pin is a ratchet**.
 *
 * A captured driver has not merely come to rest on the ledge: it has dropped into the corner
 * between the plug's shoulder and the shell bore, and its own body is now in the way of the plug
 * coming back. So every set chamber pins the plug at its own δ, and the binding one is the
 * **largest** — θ has to satisfy all of them at once. A false-set driver blocks the same way, with
 * the shoulder above its waist against the ledge.
 *
 * The one exception is the driver the pick is actively holding *up* off its ledge. Lift it clear of
 * the plug's shoulder and the plug is free to swing back underneath it — which is the only way a set
 * pin is ever lost to counter-rotation, and why it takes a deliberate shove on that exact pin.
 *
 * This is what stops forcing a spool from quietly costing you the whole lock: the plug comes back
 * only as far as the pins you are not touching allow. An OVERSET chamber is deliberately absent —
 * a jam has its own, tighter rotation limit in `constraintFor`, and adding it here would fight it.
 * See DECISIONS D-081.
 */
function counterRotationFloor(chambers: readonly Chamber[], pick: number): number {
  let floor = 0
  for (const c of chambers) {
    // A disc is held by the sidebar leg in its gate, not by anything wedged against the plug.
    if (c.kind === 'disc') continue
    if (c.state === 'SET') {
      const liftedClear = c.index === pick && c.lift > c.setLift + LEDGE_CLEAR_MM
      if (!liftedClear && c.delta > floor) floor = c.delta
    } else if (c.state === 'FALSE_SET' && c.delta > floor) {
      floor = c.delta
    }
  }
  return floor
}

/**
 * §7 — the plug turns back, and the pins it was holding fall.
 *
 * A captured driver is not latched behind anything: it rests on the sliver of plug that has rotated
 * out from under its bore, and that sliver *is* `θ − δ`. Take the rotation away and there is nothing
 * left underneath. So when a push drives the plug back past a set chamber's δ — which is exactly
 * what forcing a false-set spool with a light wrench does (D-075) — that chamber stops being set.
 *
 * Until this existed the chamber stayed nominally SET while its ceiling (`topStop`, D-071) opened
 * all the way up, so the driver could be shoved to the top of its travel, could not overset, and
 * would not fall: set in the bookkeeping, unsupported in the geometry. It is also the answer to
 * "why did I lose three pins for pushing one?" — because you turned the plug back under all of
 * them, which is the real cost of forcing a spool and the reason nobody does it twice.
 *
 * Called after θ is final for the tick, so §8 reads roles that already account for it.
 * See DECISIONS D-081.
 */
function releaseUnledgedPins(state: SimState): void {
  let dropped: number[] | null = null
  for (const c of state.chambers) {
    if (c.state !== 'SET') continue
    // Discs are held by the sidebar leg in their gate, not by a ledge, and an inverted wafer's
    // travel simply ends at its set height. Neither is resting on plug rotation.
    if (c.kind === 'disc' || c.inverted) continue
    if (state.theta >= c.delta - LEDGE_RELEASE_MARGIN) continue
    c.state = 'FREE'
    c.captureTimer = 0
    c.counterForce = 0
    c.belowHoldFor = 0
    const at = state.stats.setOrder.indexOf(c.index)
    if (at >= 0) state.stats.setOrder.splice(at, 1)
    ;(dropped ??= []).push(c.index)
  }
  if (!dropped) return
  // Same accounting as a partial slip (D-074): losing pins is only a *reset* if it took the lot.
  if (!state.chambers.some((c) => c.state === 'SET' || c.state === 'OVERSET')) {
    state.stats.fullResets += 1
    state.stats.setOrder.length = 0
    state.stats.bindOrder.length = 0
    state.engaged = false
  }
  state.events.push({ type: 'RESET', kind: 'counter', dropped, time: state.time })
}

/**
 * §6 — losing tension. A full reset drops every captured driver back into the plug and costs
 * the player everything. A feather is the Tier 3 refinement: a dip shorter than
 * `FEATHER_WINDOW` sheds only the overset pins and leaves the set ones standing.
 */
function dropAll(state: SimState, kind: 'full' | 'feather'): void {
  const dropped: number[] = []
  for (const c of state.chambers) {
    const affected = kind === 'feather' ? c.state === 'OVERSET' : c.state !== 'FREE'
    if (affected && (c.state === 'SET' || c.state === 'OVERSET')) dropped.push(c.index)
    if (!affected) continue
    c.state = 'FREE'
    c.captureTimer = 0
    c.counterForce = 0
    if (kind === 'full') c.hasFalseSet = false
  }
  if (kind === 'full') {
    state.stats.setOrder.length = 0
    state.stats.bindOrder.length = 0
    state.stats.fullResets += 1
    state.engaged = false
  } else {
    state.stats.feathers += 1
  }
  state.events.push({ type: 'RESET', kind, dropped, time: state.time })
}

/** Keep the event stream bounded for headless runs that never drain it. */
const MAX_PENDING_EVENTS = 8192

/** Advance the simulation one fixed tick. Mutates and returns `state`. */
export function step(state: SimState, input: SimInput, dt: number = DT): SimState {
  const { config, chambers, rng } = state
  const tools = config.tools
  const n = chambers.length

  // ── 1. Tension, rate-limited ──────────────────────────────────────────────────────────
  const requested = input.tensionHeld
    ? clamp(input.tensionLevel, tools.tensionMin, tools.tensionMax)
    : 0
  state.tensionCommanded = moveToward(
    state.tensionCommanded,
    requested,
    tools.tensionSlew * dt,
  )
  if (tools.tensionPrecision > 0) {
    const target = nextSigned(rng, tools.tensionPrecision)
    state.tensionWobble = damp(state.tensionWobble, target, 6, dt)
  } else {
    state.tensionWobble = 0
  }
  state.tension =
    state.tensionCommanded > 1e-4 ? clamp01(state.tensionCommanded + state.tensionWobble) : 0
  const T = state.tension
  if (T > state.stats.maxTension) state.stats.maxTension = T
  if (T >= T_MIN_HOLD && T < state.stats.minTensionWhileHeld) state.stats.minTensionWhileHeld = T

  // ── 2. Pick tip ───────────────────────────────────────────────────────────────────────
  //
  // The tip *travels* along the keyway rather than jumping. Every pin it passes is pressed down
  // onto it, so it has to shove each one aside to get by — and tension is what presses them, so
  // a heavy hand is a slow hand. Withdrawing is immediate: pulling the pick out is not the same
  // job as pushing it deeper. See DECISIONS D-045.
  const reach = effectiveReach(tools, state.instance.def.keyway)
  const prevPick = state.pickChamber
  let wanted = Math.trunc(input.chamber)
  if (wanted < 0 || wanted >= n || wanted >= reach) wanted = -1

  if (wanted < 0) {
    state.pickPosition = -1
  } else if (state.pickPosition < 0) {
    // *Inserting* the pick puts the tip where you aimed it — that is one motion, and it is not
    // the motion the pins resist. What they resist is **sliding between** them once you are in.
    //
    // Pulling out and re-entering at a different chamber therefore skips the travel, and that
    // is correct rather than an exploit: it is what a picker actually does, and it costs you
    // every unset pin you were holding up, because nothing supports them while the pick is out.
    state.pickPosition = wanted
  } else {
    const rate = PICK_TRAVEL_RATE / (1 + TENSION_TRAVEL_DRAG * T)
    state.pickPosition = moveToward(state.pickPosition, wanted, rate * dt)
  }

  const pick = state.pickPosition < 0 ? -1 : Math.min(reach - 1, Math.round(state.pickPosition))
  state.pickChamber = pick
  /**
   * True once the tip has arrived at the chamber it was sent to.
   *
   * A hook sliding along a keyway **rides over** the pins between here and there. It does not
   * stop under each one and jack it up to whatever height your hand happens to be holding — it
   * has neither the time nor the leverage, and the pin presses it down and lets it past. Lifting
   * is something you do to the pin you have stopped on.
   *
   * Without this, travel became a wrecking ball the moment a captured driver stopped being
   * clamped at `setLift` (D-051): moving from pin 4 to pin 1 with the hand held high oversets
   * everything in between. That is not what a real hook does, and it is not what the player
   * asked for when they asked to be *allowed* to overset a pin they had already set.
   */
  const settled = pick >= 0 && pick === wanted
  if (pick !== prevPick) {
    state.events.push({ type: 'PICK_MOVED', from: prevPick, to: pick, time: state.time })
  }

  /**
   * ── 2b. The hook fouls what it passes, if you carry it high ──────────────────────────
   *
   * Chambers in a real lock are not separate rooms. The bores are walled — 0.9mm of brass at a
   * 3.81mm pitch — but the **keyway underneath them is one continuous slot**, and a hook carried
   * along it passes directly beneath every key pin between the mouth and the tip. Reported as
   * *"they are not separated by any kind of walls, so it could be the case that when you
   * incorrectly insert the lockpick you press on other pins"*, which is exactly right and was
   * exactly not modelled: every lift in this file is gated on `c.index === pick`, so only the
   * selected chamber could ever move.
   *
   * **Only while travelling, and only while raised.** D-045 says a sliding hook rides over the
   * pins between here and there, and that stays true — for a hook riding *low*. It is the case
   * that comment assumes away: a pick lying in the keyway is beneath everything and touches
   * nothing, and it is lifting the hand *while* moving that drags the crest through them. So the
   * condition is travel (`!settled`) plus a commanded lift above the hook's own height.
   *
   * The pins are pressed to the crest, not to the commanded lift. The hook is a wedge going past,
   * not a jack: it carries them at its own height and lets them fall behind it. That is the
   * difference between disturbing a lock and demolishing it, and it is why this can be a real
   * mechanic rather than a punishment. See DECISIONS D-138.
   */
  const carried = Math.max(0, Math.min(input.liftTarget, tools.hookHeight))
  // A bent shaft no longer goes where you point it (D-068).
  const jitter = tools.liftJitter * (state.pickBent ? BENT_JITTER_FACTOR : 1)
  if (jitter > 0) {
    const target = nextSigned(rng, jitter)
    state.pickWobble = damp(state.pickWobble, target, 9, dt)
  } else {
    state.pickWobble = 0
  }

  /**
   * ── 3. Tension loss — per pin, not all at once ────────────────────────────────────────
   *
   * Each captured chamber has its own hold threshold, scaled down by how much ledge is actually
   * under it (D-074). Ease the wrench a little and the newest, least-committed pin lets go while
   * the rest stand; ease it a lot and they go in order of how well they were caught; let go
   * entirely and everything drops, which is the old behaviour arrived at from the right direction.
   *
   * An **overset** is not held by a ledge at all — it is jammed — so it keeps the flat threshold
   * and is still what a feather sheds.
   */
  /**
   * One mechanism for every kind of held chamber, rather than a per-pin path beside the old
   * all-at-once one. Two paths meant two resets counted for a single release of the wrench.
   *
   * The **grace** is where feathering lives: with the technique learned you get
   * `FEATHER_WINDOW` below a pin's threshold before it lets go, which is what makes a deliberate
   * dip survivable; without it, any dip at all costs you the pin the moment it happens.
   */
  const grace = config.featherEnabled ? FEATHER_WINDOW : 0
  // A flag rather than a filtered array: this runs 120 times a second in every simulation, and the
  // solver runs thousands of simulations, so an allocation here is an allocation nobody needs. The
  // list is only built on the rare tick where something has actually let go.
  let anySlipped = false
  /**
   * A false set is held by the wrench too, and used not to be.
   *
   * `held` covered SET and OVERSET only, so a false-set driver — which is held up by nothing but
   * the plug's ledge sitting in its waist — survived the wrench being released entirely. On a lock
   * of standard pins that never showed, because a chamber has to be *set* to matter. Build one out
   * of nothing but spools in the editor and it is glaring: every chamber false-sets, you drop the
   * tension to start again, and every chamber stays exactly where it was. Reported from play as
   * "when I release the tension they all can became in position of false set".
   *
   * Take the rotation away and the ledge comes out of the waist; the driver's own spring does the
   * rest. Same threshold as an overset: engagement buys a false set nothing, because it is wedged
   * rather than resting. See DECISIONS D-087.
   */
  const heldByWrench = (c: Chamber): boolean =>
    c.state === 'SET' || c.state === 'OVERSET' || c.state === 'FALSE_SET'
  /**
   * The grace a held chamber gets before a slip counts, by cause — D-203. Under the chamber's
   * OWN bar (the wrench simply too light) the quarter-second grace applies as it always has.
   * Over that bar but under the disturbed one — safe if your hand were still, slipping only
   * because you are leaning on another pin — the grace is `DISTURB_SLIP_GRACE`: long enough
   * that a transit shove or a probe touch never sheds banked work (the D-051 fairness the
   * shaft suite asserts), and far shorter than a hand camped at light pressure to hunt.
   *
   * One function, used by the flag pass and the harvest pass alike, or a chamber is flagged
   * by one rule and harvested by the other — which is how you get a pin dropping a tick after
   * it was declared safe.
   */
  const worked = pick >= 0 ? chambers[pick] : undefined
  const slipCutoff = (c: Chamber): number => {
    if (T < T_MIN_HOLD) return grace
    const own = c.state === 'SET' ? holdThreshold(c, state.theta, 0) : T_MIN_HOLD
    return Math.max(grace, T < own ? SET_SLIP_GRACE : DISTURB_SLIP_GRACE)
  }
  for (const c of chambers) {
    if (!heldByWrench(c)) {
      c.belowHoldFor = 0
      continue
    }
    // An overset is *jammed* rather than resting on a ledge, so engagement buys it nothing, and a
    // false set is wedged in a groove for the same reason.
    /**
     * Leaning on *another* chamber shakes this one (D-098).
     *
     * `pickContact` rather than merely "the tip is here": resting the pick against a pin disturbs
     * nothing, and the whole point of D-056 is that feeling anything requires pushing. So the
     * disturbance is exactly as real as the push that causes it.
     */
    /**
     * Leaning on *another* chamber shakes this one (D-098) — with one exclusion.
     *
     * A chamber you are pushing that is **false set** is not counted, because its effect on the
     * plug is already in the model twice over: `applyCounterRotation` drives its own pin down and
     * `PLUG_PUSHBACK` winds θ back, which drops every other chamber's engagement and raises its
     * hold threshold through the relief term. Charging a disturbance on top of that is the same
     * force billed a second time — and it is enough to make the spool technique impossible, since
     * easing the wrench to push a groove is precisely when a set pin can least afford it.
     *
     * What is left is the case with no other representation: the tip jammed against a pin that is
     * binding or free and will not move. `pickContact` measures how far past the pin the tip is
     * being asked to go, so the disturbance is exactly as big as the push that causes it.
     */
    /**
     * Discs are exempt from the shake as well as from charging it (D-203). A seated wheel is
     * captured by the fence spring in its gate — jiggling the next wheel does not lift it
     * out — where a set pin's driver rests on a sliver of plug ledge that a shaken hand can
     * genuinely walk off. The disturbance models the hand, and the hand cannot reach a gate.
     */
    const shaken =
      worked && worked.index !== c.index && worked.state !== 'FALSE_SET' && c.kind !== 'disc'
        ? state.pickContact
        : 0
    const threshold = c.state === 'SET' ? holdThreshold(c, state.theta, shaken) : T_MIN_HOLD
    /**
     * A light hand gets its own, longer, forgiveness — and needs it (D-095).
     *
     * Two different failures share this loop. **Dropping the wrench** is the old one: the ledge goes
     * and the pin falls, and how long you have is `FEATHER_WINDOW` or nothing, which is the whole
     * feather technique. **Holding too light** is the new one, and it must not be a hair trigger,
     * for a measured reason: at the instant the last pin sets, engagement is still ~0 and the plug
     * needs about a tenth of a second to take up its rotation and make everything safe. With no
     * grace, setting your last pin on a light hand lost you the lock in the same tick — the race
     * being lost to the take-up rather than to anything the player did.
     *
     * A quarter second is comfortably past the take-up and still far too short to lean on: ease off
     * and you have a moment to notice and correct, which is what makes this a *technique* rather
     * than a trapdoor.
     */
    if (T < threshold) {
      c.belowHoldFor += dt
      if (c.belowHoldFor > slipCutoff(c)) anySlipped = true
    } else {
      c.belowHoldFor = 0
    }
  }
  if (state.engaged && anySlipped) {
    const slipped = chambers.filter((c) => heldByWrench(c) && c.belowHoldFor > slipCutoff(c))
    for (const c of slipped) {
      c.state = 'FREE'
      c.captureTimer = 0
      c.counterForce = 0
      c.belowHoldFor = 0
      c.hasFalseSet = false
      const at = state.stats.setOrder.indexOf(c.index)
      if (at >= 0) state.stats.setOrder.splice(at, 1)
    }
    // `fullResets` means "the attempt was ruined", so a partial slip is not one. Losing your
    // newest pin and keeping three is the technique working, not the lock winning (D-074).
    if (!chambers.some((x) => x.state === 'SET' || x.state === 'OVERSET')) {
      state.stats.fullResets += 1
      state.stats.setOrder.length = 0
      state.stats.bindOrder.length = 0
      state.engaged = false
    }
    state.events.push({
      type: 'RESET',
      kind: 'full',
      dropped: slipped.map((c) => c.index),
      time: state.time,
    })
  }

  if (T < T_MIN_HOLD) {
    state.belowMinHoldFor += dt
  } else {
    if (
      config.featherEnabled &&
      state.belowMinHoldFor > 0 &&
      state.belowMinHoldFor <= FEATHER_WINDOW &&
      chambers.some((c) => c.state === 'OVERSET')
    ) {
      dropAll(state, 'feather')
    }
    state.belowMinHoldFor = 0
    state.engaged = true
  }

  // ── 4. Lift: spring return, then the tool, then counter-rotation ──────────────────────
  //
  // Raking used to be handled first, because it changed what the pins were resting on. It is
  // gone (D-058), and with it the only path by which more than one chamber could be driven at
  // once — so from here on, exactly one chamber is under the tool: the one the tip has reached.

  const bindingLast = state.bindingChamber
  // The wheel-turn envelope (D-169): saturated by the turner below the moment a wheel moves,
  // decaying here so a parked wheel goes quiet in about 180ms. The 180 is an envelope, not a
  // reading — the wheel's motion is pulsed (it snaps detent to detent while the command
  // crawls), and a meter fed the raw pulses flickers at click rate.
  const comboFamily = state.instance.def.family === 'combination'
  if (comboFamily) state.wheelTurn = Math.max(0, state.wheelTurn - dt / 0.18)
  /**
   * Radians per second of *backward* plug rotation demanded by pins bearing on the ledge (D-075).
   * Accumulated here and applied after θ is integrated, so the wrench and the pick fight each other
   * continuously rather than one winning outright on a single tick.
   */
  let pushback = 0
  for (const c of chambers) {
    // Discs and inverted wafers are held at their set position outright — a disc is pinned by
    // the sidebar leg dropped into its gate, and an inverted wafer's travel *ends* there.
    const ceiling = c.state === 'SET' ? c.setLift : c.maxLift
    const pinched = c.index === bindingLast || c.state === 'FALSE_SET'
    const bendLoss = state.pickBent ? BENT_RATE_FACTOR : 1
    // `dragFactor` is the chamber's own friction, and it resists *motion* rather than merely
    // reporting a heavier number (D-069).
    const rate = tools.liftRate * bendLoss * c.dragFactor
    const toolRate = pinched
      ? (PICK_BASE_RATE / (1 + BIND_HARDNESS * T)) * rate
      : PICK_BASE_RATE * FREE_LIFT_MULTIPLIER * rate

    /**
     * An overset jams the **key pin**, and nothing in the stack moves until tension drops.
     *
     * Worth being exact, because it was got wrong once. `lift` is the whole stack's displacement,
     * and `setLift` is where the key/driver junction meets the shear line. An overset is
     * `lift > setLift + captureWindow` — the junction is *past* the line, which means the body
     * lying across the shear line is the **key pin**, not the driver. The driver is above it,
     * up in the bible, blocking nothing.
     *
     * So the key pin cannot fall: the plug has turned onto it and it is pinched. D-086 briefly made
     * it drop away like a key pin under a *captured* driver, which is a different situation
     * entirely — there the driver is on the ledge and the key pin has nothing above it holding it.
     * Reported from play as *"with an oversetted pin the key pin should stay in the cylinder"*,
     * which is right. See DECISIONS D-094.
     */
    if (c.state === 'OVERSET') {
      c.counterForce = 0
      continue
    }

    if (c.kind === 'disc') {
      // A disc has no spring, so nothing returns it — and the tool is a *turner*, not a
      // floor. It drives the disc toward the commanded angle in either direction, which is
      // both what makes reading a disc detainer a different job from picking a pin tumbler
      // and what stops one overshoot from making the lock permanently unopenable: with a
      // floor-only tool and no spring, a disc turned past its gate could never come back.
      //
      // Once the sidebar has dropped into a disc's true gate the disc is pinned and stops
      // turning at all — on a **disc detainer**. A combination wheel is never pinned: the
      // fence leg cams out of the gate under the thumb, so a seated wheel stays turnable and
      // turning it off its digit un-seats it — the owner's rule ("you must always be able to
      // rotate"), and the real object's. The pack re-binds it in delta order.
      //
      // A combination wheel is this same disc with detents: the commanded angle snaps to the
      // digit's centre, so the wheel travels through the space between clicks but only ever
      // *parks* on a digit — hand wobble moves the command inside one detent and changes
      // nothing, which is what a real wheel's spring plunger does to a shaky thumb.
      if ((c.state !== 'SET' || comboFamily) && c.index === pick && settled) {
        const commanded = clamp(input.liftTarget + state.pickWobble, 0, c.maxLift)
        if (comboFamily) {
          // A dial is a circle: the turner takes the short way round, through the seam when
          // that is nearer — digit 9 to digit 0 is one click on a real wheel, not a rewind
          // across every gate on the dial. The wheel's own angle wraps with it.
          const want = quantizeDetent(commanded)
          const stepMax = toolRate * dt
          let delta = want - c.lift
          if (delta > c.maxLift / 2) delta -= c.maxLift
          else if (delta < -c.maxLift / 2) delta += c.maxLift
          const before = c.lift
          const moved = Math.abs(delta) <= stepMax ? want : c.lift + Math.sign(delta) * stepMax
          c.lift = ((moved % c.maxLift) + c.maxLift) % c.maxLift
          // A wheel speaks only while it turns: motion saturates the envelope the resistance
          // reading scales by, and the decay above silences a parked wheel (D-169).
          if (Math.abs(c.lift - before) > 1e-6) state.wheelTurn = 1
        } else {
          c.lift = moveToward(c.lift, commanded, toolRate * dt)
        }
      }
      // Rolled off its gate: the fence leg cams back out and the seat is gone. The limiter
      // loop re-nominates it next tick — it held the smallest delta of the unseated, so the
      // bind comes straight back to it, which is exactly the tell a scrambled wheel gives.
      if (comboFamily && c.state === 'SET' && Math.abs(c.lift - c.setLift) > c.captureWindow / 2) {
        c.state = 'FREE'
        c.sidebarAligned = false
        c.captureTimer = 0
      }
      applyCounterRotation(state, c, T, dt)
      c.lift = clamp(c.lift, 0, c.maxLift)
      continue
    }

    if (c.inverted) {
      // A wafer biting from the other side of the keyway: its spring pushes it *up*, so it
      // rests at the top of its travel and the pick's tip is a ceiling rather than a floor.
      // Same mechanics, opposite sign (SIMULATION.md §10, double-sided wafers).
      const rest = ceiling
      const support =
        c.index === pick && settled ? clamp(input.liftTarget + state.pickWobble, 0, rest) : rest
      if (c.lift < support) c.lift = Math.min(support, c.lift + springRate(c) * dt)
      if (c.lift > support && c.index === pick) {
        c.lift = Math.max(support, c.lift - toolRate * dt)
      }
      c.counterForce = 0
      c.lift = clamp(c.lift, 0, c.maxLift)
      continue
    }

    /**
     * A captured driver is caught on a *sliver* of ledge, not latched behind one.
     *
     * When one pin sets, the plug has taken up δ ≈ 0.005 rad, which at the bore radius is about
     * 0.0125mm of overlap across a 2.92mm pin — four tenths of one per cent of the face. There is
     * no catch there. Drive the key pin up hard enough and it pushes the driver straight back off
     * it, and if you keep going the key pin itself crosses the shear line and the chamber jams
     * overset. Losing a pin you had already set is one of the commonest mistakes in real picking.
     *
     * The ceiling used to be `setLift` for a SET chamber, which made "set" mean "safe forever":
     * you could lean on a captured pin as hard as you liked and nothing happened. It is now the
     * full travel, exactly like any other chamber. What makes a set pin *feel* safe is not a
     * clamp — it is that the pick pushes the **key pin**, which has fallen away to the keyway
     * floor, so dragging the tool across at a working height never reaches the driver at all.
     * See DECISIONS D-051.
     */
    /**
     * How much of the plug's ledge is actually under this driver, 0..1 (D-071).
     *
     * The bore overlap shrinks as the plug turns, so a driver caught at the very start of the
     * attempt is held by a sliver and can be shoved straight back off it (D-051), while one still
     * standing at the end has the ledge properly under it and cannot be reached at all. `θ - δ` is
     * how far the plug has swung *since this chamber's ledge started closing*, which is exactly the
     * quantity — and it is why the pins you set first are the ones that end up safest.
     */
    const engaged = clamp01((state.theta - c.delta) / LEDGE_FULL_ENGAGE)
    const topStop =
      c.state === 'SET' ? c.setLift + (c.maxLift - c.setLift) * (1 - engaged) : ceiling
    /**
     * What is actually under this pin — DECISIONS D-138.
     *
     * This used to read *"the one tool that can be under it: the pick, and only where it has
     * arrived"*, and everything else got a support of **zero**. That is the assumption the whole
     * lock was built on and it is not true of a real one: the bores are walled, but the keyway
     * beneath them is one continuous slot, so the hook is under whichever pin it is passing
     * whether it has arrived there or not.
     *
     * Two supports, then. Arrived, the pin rests on the tip at the height the hand is holding —
     * the original rule, unchanged. **Travelling**, it rests on the hook's *crest*: the tool is
     * going past, not stopping, so it carries the pin at its own height and leaves it behind. A
     * hook carried low has a crest of nothing and disturbs nothing, which is why a careful
     * insertion still costs you nothing at all.
     *
     * `ceiling` still exists for the disc and inverted-wafer paths above, which hold a set
     * chamber at `setLift` outright rather than letting it be pushed off (D-051).
     */
    /**
     * ...and the **shank** is under the pins between the hook and the mouth — DECISIONS D-145.
     *
     * D-138 gave the hook its crest while travelling. This is the other half, and it applies while
     * the pick is standing still: a pick is a straight tool pivoting about the hand, so lifting a
     * pin higher than the hook is tall raises the shaft behind it, and the shaft is under every pin
     * between there and the keyway mouth. Reported from play — *"when you press the deepest pin, the
     * handle can overlap with the first pins"* — and the drawing was right. The simulation was
     * holding those pins at rest while a rigid tool was drawn straight through them.
     *
     * **Only above the hook's own rise.** Below that the knee is still down in the keyway and the
     * shaft touches nothing, which is the whole of ordinary play: the deepest cut in the roster asks
     * for 2.30mm and the hook stands `hookHeight` above the shaft. So this is a cost of *overlifting*
     * specifically, and the measured difficulty curve is unchanged by it.
     *
     * The shaft falls away toward the mouth, so the pin that suffers is the **neighbour**, not the
     * front of the lock — `(i + reach) / (pick + reach)` is that slope, with the hand `SHANK_REACH`
     * chambers outside the lock providing the lever. Same geometry the renderer places the tool
     * with, expressed in chambers rather than pixels so the simulation stays free of the drawing.
     */
    const shank =
      pick < 0 || state.pickBroken || !settled || c.index >= pick
        ? 0
        : shankLift(input.liftTarget, pick, c.index)

    const support = !(c.index === pick) || state.pickBroken
      ? Math.min(shank, topStop)
      : settled
        ? clamp(input.liftTarget + state.pickWobble, 0, topStop)
        : Math.min(carried, topStop)

    // A false-set chamber is held: the plug's ledge is sitting in its groove and the
    // full-diameter body above the groove cannot pass back down through it. Nothing but
    // counter-rotation moves it. This is what lets false sets *accumulate* across chambers
    // while you work the rest of the lock, which is the whole spool experience.
    // Everything below is about the **driver**, which is what `lift` means.
    //
    // A captured driver rests on the plug's ledge and can settle no lower than `setLift` — the
    // lift at which its bottom is exactly on the shear line. That floor is what makes a set pin
    // stay set when the pick leaves, and it is also the small settle you feel on capture: the
    // driver drops the last fraction of a millimetre onto the ledge and stops.
    const wafer = c.kind === 'wafer'
    const driverFloor = c.state === 'SET' ? c.setLift : 0
    const driverSupport = Math.max(support, driverFloor)
    const driverHeld = c.state === 'FALSE_SET'
    if (!driverHeld && c.lift > driverSupport) {
      c.lift = Math.max(driverSupport, c.lift - springRate(c) * dt)
    }
    /**
     * Something under a pin can push it **up** — and the shank is something (D-145).
     *
     * This was gated on `c.index === pick` alone, which is the same assumption D-138 found in the
     * support expression: only the chamber the tip has arrived at can be driven upward. That is
     * fine for the hook, and it is why D-138's travelling foul works at all — the rounded pick
     * index passes through each chamber in turn, so every pin it crosses is briefly `pick`.
     *
     * The shank is the case that assumption cannot express. It bears on pins that are by definition
     * *not* the one the tip is on, for as long as the hand is held high, without the pick going
     * anywhere. So `shank > 0` is its own reason to move: it is already zero for the pick's own
     * chamber, for anything behind the hook, and for any lift below the hook's rise.
     */
    /**
     * The serrated grind — D-157. While a many-toothed driver is pinched, every serration
     * drags on the plug edge and the climb slows by `1 + grip × T × teeth`. The lies were
     * already here (each groove false-sets — the four fake clicks); this is the grind that
     * makes the profile *feel* like anything on the way up. Light tension frees it, which is
     * the same lesson every security pin in the game teaches.
     */
    const grind =
      pinched && c.profile.grooveCount >= 3
        ? 1 / (1 + SERRATION_GRIP * T * c.profile.grooveCount)
        : 1
    if (!driverHeld && c.lift < driverSupport && (c.index === pick || shank > 0)) {
      c.lift = Math.min(driverSupport, c.lift + toolRate * grind * dt)
    }
    /**
     * A false-set driver is **trapped between its own shoulders** while the ledge is in its waist.
     *
     * The foot below cannot pass the ledge going up and the head above cannot pass it going down,
     * which is what a false set physically is. Only the downward half used to be modelled, so a
     * spool could be shoved straight up through its shoulder in a pure force race — reported as
     * "once it says false set I can still push the spool; the cylinder is rotated and stuck".
     *
     * The way out is the bevel: bearing on the ledge drives the plug **back** against the wrench,
     * which withdraws the ledge and raises the ceiling. `entered` is how far in it currently is,
     * measured against this groove's own depth rather than `ENGAGE_RAMP` — the latter saturates in
     * three thousandths of a radian, so a cap keyed to it would never release. See DECISIONS D-075.
     */
    if (c.state === 'FALSE_SET' && c.index === pick) {
      const span = Math.max(1e-6, falseSetGive(c))
      const entered = clamp01((state.theta - c.delta) / span)
      const ceilingNow =
        grooveCeilingLift(c) + (c.maxLift - grooveCeilingLift(c)) * (1 - entered)
      const wanted = Math.min(support, ceilingNow)
      if (c.lift < wanted) c.lift = Math.min(wanted, c.lift + toolRate * dt)
      // Asking for more than the trap allows is what turns the plug back, and the wrench is what
      // resists it. Hold hard enough and nothing gives — which is the spool wall, arrived at
      // geometrically rather than as a race between two rates.
      /**
       * How fast the plug gives back is the margin by which the pick is *already* winning.
       *
       * `toolRate - counterForce` is the existing false-set force race, whose balance point was
       * solved for and measured per profile (D-010, D-053): spool T≈0.55, mushroom T≈0.29, t-pin
       * T≈0.65. Driving the pushback from that same margin means the wall stays exactly where it
       * was measured — above it the pick is losing, nothing gives, and the driver is genuinely
       * trapped — while below it the plug visibly rotates back as you push through, which is the
       * sensation that was missing and the reason the wrench has a gauge.
       *
       * A new constant of its own would have re-opened tuning that two decisions already settled.
       */
      const asking = Math.min(support, c.maxLift) > ceilingNow
      if (asking) {
        /**
         * …and how much good pushing does depends on how deep the ledge already is.
         *
         * Camming works on the *bevel* at the waist's edge. Once the plug has swung fully into the
         * groove, the driver's shoulder is bearing on a flat plug edge with no bevel presented to
         * it at all, and shoving harder does almost nothing — which is the report: with the other
         * pins set and the plug swung well round, the middle spool was still pushable and should
         * not have been.
         *
         * So the way in is to **relax the wrench first**. Drop tension and `θ_demand` falls below
         * the false set's `θ_max`, the plug rotates back, the bevel comes into contact, and *then*
         * the pin climbs. That is the real spool technique, it is what lesson 3 already tells the
         * player to do in so many words, and until now the mechanic did not require it.
         */
        const bevelPresented = 1 - entered * SPOOL_CAM_BITE
        pushback += PLUG_PUSHBACK * Math.max(0, toolRate - c.counterForce) * bevelPresented
      }
    }

    applyCounterRotation(state, c, T, dt)
    c.lift = clamp(c.lift, 0, c.maxLift)

    // ── The key pin, which is a separate body ──
    //
    // A pin stack is two pieces. While the key pin is what holds the driver up they move as
    // one, and `keyLift` is simply `lift`. The moment something *else* holds the driver — the
    // plug's ledge under a captured pin, or the ledge wedged in a false-set groove — the key
    // pin has nothing under it and drops away, leaving the gap that tells the player what
    // happened. A wafer has no key pin to separate. See DECISIONS D-042.
    // Discs returned earlier, so `kind` here is `pin` or `wafer`.
    if (wafer) {
      c.keyLift = c.lift
    } else {
      /**
       * The same arithmetic in every state, because the geometry does not care what the state is
       * called: the key pin rests on whatever is under it, and cannot pass the driver above it.
       *
       * It used to be two branches — this one for `SET` and `FALSE_SET`, and a bare
       * `keyLift = lift` for everything else. That second line is a **teleport**. It says the key
       * pin is wherever the driver is, which is true only when the two are touching, and it fires
       * the instant a chamber stops being held: let the wrench go on a magnetic chamber and the
       * driver stays up where the magnet holds it (`MAGNETIC_RETURN`, D-066) while the key pin
       * snapped from the bottom of its bore up to meet it, across a gap of millimetres, in one
       * tick. Reported as *"with magnetic pins, press Q and the key pin falls; release and it jumps
       * back up to the driver."*
       *
       * What actually happens is the opposite and it is already modelled: the **driver** falls onto
       * the key pin, at its own spring rate — a crawl when a magnet is holding it. The two re-unify
       * when the driver arrives, not when the state name changes. See DECISIONS D-102.
       */
      const roof = c.lift
      const want = Math.min(support, roof)
      /**
       * `springRate(c)`, not the bare constant — the key pin falls at *this chamber's* rate.
       *
       * The old branch used `SPRING_RETURN_RATE` directly, which was survivable while it only ran
       * for `SET` and `FALSE_SET`. Applied to every state it is wrong in the one case this whole
       * fix is about: a magnetic chamber's key pin would drop at the full sprung rate while its
       * driver crept, which is the same stack coming apart at two different speeds. `springRate`
       * already knows about magnets, discs and this chamber's own spring and bore.
       */
      if (c.keyLift > want) c.keyLift = Math.max(want, c.keyLift - springRate(c) * dt)
      else if (c.keyLift < want && (c.index === pick || shank > 0)) {
        // The shank is under this key pin too, and for the same reason (D-145): a tool held high
        // bears on the pins between its hook and the mouth without being *at* any of them.
        c.keyLift = Math.min(want, c.keyLift + toolRate * dt)
      }
      c.keyLift = clamp(c.keyLift, 0, roof)
    }
  }

  /**
   * A captured chamber is re-read only once something has driven its driver up off the ledge.
   *
   * The cheap test — is the driver still sitting at `setLift`? — is also the honest one: while it
   * is, nothing has changed and re-reading it every tick would be work for no answer. The moment
   * it is higher, the pick is pushing a pin that was already set, and the reading decides whether
   * that is a harmless nudge inside the capture window or an overset (D-051).
   */
  const disturbed = (c: Chamber): boolean => c.state !== 'SET' || c.lift > c.setLift + 1e-9

  // ── 5. Classify every chamber ─────────────────────────────────────────────────────────
  for (const c of chambers) {
    if (c.state === 'OVERSET' || !disturbed(c)) continue
    const reading = readShearLine(c, c.lift)
    c.geometry = reading.geometry
    c.bandAtShear = reading.bandAtShear
  }

  // ── 6. Capture timers, and the overset that punishes rushing ─────────────────────────
  for (const c of chambers) {
    // A SET chamber falls through to the OVER check below and nothing else: the capture branch
    // needs `c.index === bindingLast`, and `limiterBinds` never nominates a chamber that is
    // already set, so an undisturbed capture cannot be re-captured or re-counted.
    if (c.state === 'OVERSET' || !disturbed(c)) continue
    if (c.geometry === 'OVER') {
      // Only jams if the plug's ledge has actually closed on this chamber.
      if (T >= T_MIN_HOLD && (c.index === bindingLast || state.theta >= c.delta)) {
        c.state = 'OVERSET'
        c.captureTimer = 0
        state.stats.oversets += 1
        state.events.push({ type: 'PIN_OVERSET', chamber: c.index, time: state.time })
        // An interactive element trips on *any* overset and dumps the whole lock — set pins
        // included, and a feather cannot save you from it. That is the lock (SIMULATION.md §10).
        if (state.instance.def.resetOnOverset) {
          dropAll(state, 'full')
          state.theta = 0
        }
      }
      continue
    }
    if (c.geometry === 'WINDOW' && c.index === bindingLast && T >= T_MIN_HOLD) {
      c.captureTimer += dt
      if (c.captureTimer >= CAPTURE_TIME) {
        c.state = 'SET'
        c.captureTimer = 0
        // A sidebar chamber has a second condition: the gate has to line up as well. Miss it
        // and the chamber still *looks* set — but the sidebar never drops (SIMULATION.md §10).
        c.sidebarAligned = sidebarAlignedAt(c, c.lift)
        state.stats.setOrder.push(c.index)
        state.events.push({ type: 'PIN_SET', chamber: c.index, tension: T, time: state.time })
      }
    } else {
      c.captureTimer = 0
    }
  }

  // ── 7. θ_max, and integrating the plug (§4) ───────────────────────────────────────────
  //
  // `SIMULATION.md §9` lists the binding chamber (7) before θ_max and rotation (8). The two
  // are swapped here, deliberately, and the spec has been corrected to match: which chamber
  // the plug is pinching and whether a groove has swallowed the ledge are *both* questions
  // about where the plug is **now**, and answering them against last tick's θ costs a tick of
  // latency that a 0.18mm disc gate simply does not have — the gate is two ticks wide at the
  // pinched pick rate, so one tick of stale θ loses the false set outright.
  //
  // Nothing is lost by the swap: `constraintFor` reads only SET/OVERSET, which step 6 has
  // already settled, and none of FREE/BINDING/FALSE_SET changes a constraint. The rotation
  // therefore sees exactly the same θ_max either way. See DECISIONS D-028.
  let thetaMax = THETA_OPEN
  let limiter = -1
  for (const c of chambers) {
    const con = constraintFor(c)
    if (limiter === -1 || con < thetaMax) {
      thetaMax = con
      limiter = c.index
    }
  }
  state.thetaMax = thetaMax

  // A sidebar lock holds the plug back until every gated chamber has been set *with its gate
  // aligned*. Everything can read SET and the plug still will not turn — which is the whole
  // point of a sidebar, and a distinct failure from anything else in the game.
  state.sidebarDropped = chambers.every(
    (c) => c.sidebarGate === null || (c.state === 'SET' && c.sidebarAligned),
  )
  const sidebarCap = state.sidebarDropped ? THETA_OPEN : THETA_OPEN * SIDEBAR_HELD_FRACTION
  state.thetaMax = Math.min(state.thetaMax, sidebarCap)

  state.thetaDemand = THETA_OPEN * Math.min(1, T / T_FULL_TURN)
  const target = Math.min(state.thetaMax, state.thetaDemand)
  const prevTheta = state.theta
  let v = (target - state.theta) * PLUG_TAKEUP_RATE
  v = clamp(v, -PLUG_MAX_RATE, PLUG_MAX_RATE)
  const moved = state.theta + v * dt
  state.theta = v >= 0 ? Math.min(moved, target) : Math.max(moved, target)
  // …and then whatever the pick is shoving back out of a groove (D-075). Never past δ: at that
  // point the ledge is clear of the waist entirely and there is nothing left to push against.
  const floor = counterRotationFloor(chambers, pick)
  if (pushback > 0) {
    state.theta = Math.max(floor, state.theta - pushback * dt)
  }
  // Nothing turns the plug back through a pin that is wedged against it, whatever the reason —
  // a push on a spool, a jam tightening the limit, or the wrench simply being eased off (D-081).
  if (state.theta < floor) state.theta = floor
  if (state.theta < 0) state.theta = 0
  state.thetaVelocity = (state.theta - prevTheta) / dt
  // θ is final for the tick, so anything the plug has just turned back out from under falls now.
  if (state.theta < prevTheta) releaseUnledgedPins(state)

  // ── 8. Roles: which chamber is the plug actually pinching (§2) ────────────────────────
  const limiterChamber = limiter >= 0 ? chambers[limiter] : undefined
  // A groove at the shear line only stops *being* a bind once the plug's ledge has actually
  // rotated far enough to drop into it — the same condition the FALSE_SET transition below
  // uses, and it has to be the same or the two disagree for a tick.
  //
  // They used to disagree, and it quietly broke disc detainers. Demoting the chamber the
  // instant its groove appeared un-pinched it, which quadrupled the pick's rate on it
  // (`FREE_LIFT_MULTIPLIER`), which shot the disc straight out the far side of a 0.18mm
  // false gate before the plug's take-up had crawled the last 1e-4 radians to δ. The lie was
  // never told: 0 false sets across 50 seeds on a lock built entirely out of them.
  // See DECISIONS D-028.
  const ledgeInGroove =
    limiterChamber !== undefined &&
    limiterChamber.geometry === 'GROOVE' &&
    state.theta >= limiterChamber.delta
  const limiterBinds =
    limiterChamber !== undefined &&
    limiterChamber.state !== 'SET' &&
    limiterChamber.state !== 'OVERSET' &&
    !ledgeInGroove
  const binding = T >= T_MIN_HOLD && limiterBinds ? limiter : -1
  state.bindingChamber = binding
  if (binding >= 0) {
    const last = state.stats.bindOrder[state.stats.bindOrder.length - 1]
    if (last !== binding) state.stats.bindOrder.push(binding)
  }

  for (const c of chambers) {
    if (c.state === 'SET' || c.state === 'OVERSET') continue
    const before: ChamberState = c.state
    let next: ChamberState
    // A groove at the shear line is only a *false set* once the plug has actually rotated
    // far enough for its ledge to reach this chamber. Until then the groove is simply
    // sitting there and the pin is riding its spring like any other.
    if (c.geometry === 'GROOVE' && state.theta >= c.delta) next = 'FALSE_SET'
    else if (c.index === binding) next = 'BINDING'
    else next = 'FREE'
    c.state = next
    if (next === 'FALSE_SET' && before !== 'FALSE_SET') {
      c.hasFalseSet = true
      state.stats.falseSetsEntered += 1
      state.events.push({
        type: 'FALSE_SET_ENTERED',
        chamber: c.index,
        depth: grooveDepthAt(c),
        time: state.time,
      })
    }
  }

  // ── 9. Open condition — never on rotation alone ───────────────────────────────────────
  if (!state.opened) {
    const allSet = chambers.every((c) => c.state === 'SET') && state.sidebarDropped
    if (allSet && state.theta >= THETA_OPEN * OPEN_THETA_FRACTION) {
      state.opened = true
      state.events.push({ type: 'LOCK_OPENED', time: state.time, ticks: state.ticks })
    }
  }

  // The plug going slack under a wrench too light to turn it (D-048). Announced once on the
  // transition and re-armed the moment it stops being true, so losing a pin and getting back
  // there says so again — the flag is on the state rather than in the audio layer because
  // events are the only channel out of the simulation and they have to be edge-triggered here.
  const free = pickedButUnturned(state)
  if (free && !state.plugFreeAnnounced) {
    state.events.push({ type: 'PLUG_FREE', time: state.time })
  }
  state.plugFreeAnnounced = free

  // ── 10. Continuous events, throttled ──────────────────────────────────────────────────
  /**
   * **Contact** — is the tip loaded onto this pin at all, 0..1.
   *
   * The gate on everything the chamber can tell you (D-056), and zero while the tip is still
   * travelling, since a hook sliding past a pin is not leaning on it (D-045). Half a millimetre of
   * push saturates it, which is right for a gate and was wrong for a *reading* — see below.
   */
  const felt = pick >= 0 ? chambers[pick] : undefined
  // On a combination wheel the load is the *turn*: a static hand feels nothing on a real
  // one, and the drag-probe under motion is the family's whole decode (D-169).
  const contact =
    comboFamily && felt?.kind === 'disc' ? state.wheelTurn : feltPressure(felt, input, settled)
  state.pickContact = contact
  state.resistance = resistanceFor(felt, T, state.time, contact, settled ? input.liftTarget : 0)
  if (state.resistance > state.stats.maxResistance) state.stats.maxResistance = state.resistance

  /**
   * **Force** — how hard you are actually leaning, 0..1.
   *
   * This used to be `contact`, and it was the same number, which meant the force column pinned to
   * full within 0.45mm of a four-millimetre travel and then stayed there for the rest of the
   * attempt. Reported from play as *"force meter is very strange — like it always maxed"*, and it
   * was: a meter that reads 1.0 for ninety per cent of every attempt is not a reading.
   *
   * It is now the **overreach** — how far above the pin the tip is being commanded. A pin that
   * rides up to meet you takes almost nothing, because it keeps up; a pin that will not budge lets
   * the gap open, and the gap *is* the force in your hand. That makes it the exact partner of the
   * resistance column beside it: what you apply against what comes back, with the difference
   * between them being the whole reading.
   *
   * `FORCE_FULL_MM` is a little under a third of a second of held Space, so leaning hard enough to
   * peg it is a deliberate act rather than the resting state.
   */
  const touching = felt ? (felt.kind === 'disc' ? felt.lift : felt.keyLift) : 0
  const overreach =
    felt && settled ? Math.max(0, Math.min(input.liftTarget, felt.maxLift) - touching) : 0
  // An inverted wafer's tip is a ceiling rather than a floor, so overreach has the opposite sign
  // and its rest position is the *top* of travel — measured the same way, simply arriving at one
  // would read as a maximal shove. It keeps the contact measure.
  state.pickForce = felt?.inverted ? contact : clamp01(overreach / FORCE_FULL_MM)

  /**
   * §11 — the pick bends.
   *
   * Strain grows with the **gap** between where the tip is being asked to be and where the pin
   * actually is: force meeting something that will not give. A bound pin under a light touch costs
   * nothing, which is the normal state of picking; leaning hard on one that has not budged is what
   * takes a set out of spring steel. It is the same quantity the shaft flex has always been drawn
   * from, so the animation is now the readout of an accumulating cost rather than decoration.
   *
   * Divided by the tool's `strength`, so a fine needle gives out before a rigid hook. See
   * DECISIONS D-068.
   */
  if (!state.pickBroken) {
    /**
     * The same `overreach` the force column reads, which is the point: what bends the pick is what
     * the meter shows you, so the bar is the readout of an accumulating cost rather than a second
     * opinion about it.
     *
     * It is measured against the body the tip is actually touching — for a pin stack the key pin,
     * for a wafer the same number, and for a **disc** its `lift`, because the disc branch returns
     * before the key-pin section runs and its `keyLift` therefore never moves off zero. Reading it
     * there made every disc look permanently and maximally jammed, and the solver snapped its pick
     * on all eleven of them.
     */
    const load = overreach
    if (load > 0) {
      state.pickStrain += (load * STRAIN_PER_MM_SECOND * dt) / Math.max(0.1, tools.strength)
    } else {
      state.pickStrain = Math.max(0, state.pickStrain - STRAIN_RECOVERY * dt)
    }
    if (!state.pickBent && state.pickStrain >= STRAIN_BENT) {
      state.pickBent = true
      state.events.push({ type: 'PICK_BENT', time: state.time })
    }
    if (state.pickStrain >= STRAIN_BROKEN) {
      state.pickBroken = true
      state.events.push({ type: 'PICK_BROKEN', time: state.time })
    }
  }
  if (state.ticks % CONTINUOUS_EVENT_STRIDE === 0) {
    if (Math.abs(state.theta - prevTheta) > PLUG_MOVED_EPSILON) {
      state.events.push({
        type: 'PLUG_MOVED',
        theta: state.theta,
        velocity: state.thetaVelocity,
        time: state.time,
      })
    }
    for (const c of chambers) {
      if (c.counterForce > 0.05) {
        state.events.push({
          type: 'COUNTER_ROTATION',
          chamber: c.index,
          force: c.counterForce,
          time: state.time,
        })
      }
    }
  }

  if (state.events.length > MAX_PENDING_EVENTS) {
    state.events.splice(0, state.events.length - MAX_PENDING_EVENTS)
  }

  state.ticks += 1
  state.time += dt
  state.stats.elapsed = state.time
  return state
}

/** A set chamber's key pin is only carrying its own weight — it falls a little slower. */
const SET_KEY_PIN_RETURN = 22.0

/**
 * Springs are strong; a chamber the pick has left drops fast. A disc detainer disc has no
 * spring at all — nothing returns it, so it stays exactly where you left it, which is what
 * makes reading a disc detainer a different job from picking a pin tumbler.
 */
function springRate(c: Chamber): number {
  if (c.kind === 'disc') return DISC_SPRING_RETURN
  // A magnetic element holds its pin where the tool left it — nothing returns it (D-066).
  if (c.magnetic) return MAGNETIC_RETURN
  const base = c.state === 'SET' ? SET_KEY_PIN_RETURN : SPRING_RETURN_RATE
  /**
   * Two per-chamber terms, each a different piece of hardware: `springStrength` is the spring
   * (D-062) and `dragFactor` is the bore (D-069) — a tight chamber returns its pin slowly as well
   * as lifting it slowly. Both are symmetric about 1, so neither shifts the average.
   *
   * Hooke's law (D-070) is deliberately **not** here, only in what the pin feels like. Scaling the
   * return by compression means a pin at rest falls at `SPRING_PRELOAD` of the nominal rate — 45%
   * slower — and `SPRING_RETURN_RATE` is a tuned number (D-012) that the capture race depends on:
   * how long a pin dwells inside its window against `CAPTURE_TIME` is the whole difference between
   * a forgiving lock and a jamming one. Twelve tests moved at once when it was in here. The felt
   * gradient is the half that gives the player a sense of depth; making the fall follow it too is a
   * re-tuning job, not a one-line addition.
   */
  return base * c.springStrength * c.dragFactor
}

/** Advance `n` ticks with a constant input. */
export function stepTicks(state: SimState, input: SimInput, n: number, dt: number = DT): SimState {
  for (let i = 0; i < n; i += 1) step(state, input, dt)
  return state
}

/** Take the events accumulated since the last drain. */
export function drainEvents(state: SimState): SimEvent[] {
  const out = state.events
  state.events = []
  return out
}
