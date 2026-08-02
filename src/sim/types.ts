/**
 * Simulation types — the shapes the whole game is built on.
 *
 * Nothing here imports anything outside `src/sim/`. The renderer, audio and game layers all
 * read these; none of them may mutate a `SimState` (SIMULATION.md §9).
 */

import type { DriverProfile, PinTypeName } from './profiles'
import type { RngState } from './rng'

export type LockFamily =
  | 'pin-tumbler'
  | 'wafer'
  | 'dimple'
  | 'disc-detainer'
  | 'tubular'
  | 'safe-dial'
  | 'radial-slider'

export type KeywayGrade = 'standard' | 'tight'

/** A lock as authored — pure data, no instance state. */
export interface LockDef {
  readonly id: number
  readonly slug: string
  readonly name: string
  readonly tier: number
  readonly family: LockFamily
  /** Key pin lengths `Kᵢ` in mm, one per chamber, bottom of the keyway outward. */
  readonly bitting: readonly number[]
  /** Driver pin profile per chamber. */
  readonly pins: readonly PinTypeName[]
  /**
   * Spring strength per chamber, as a multiplier on the nominal rate.
   *
   * Omitted on every authored lock, which rolls its springs from the seed instead (D-062) — a
   * factory does not choose them either. Present only on a lock somebody *built*, where picking the
   * springs is half the point of building it. See DECISIONS D-080.
   */
  readonly springs?: readonly number[]
  /** §7 — the primary difficulty knob. 1.4 forgiving … 0.45 unforgiving. */
  readonly toleranceQuality: number
  /** §2 — optional override; a high-quality lock uses a smaller spread. */
  readonly toleranceSpread?: number
  readonly keyway: KeywayGrade
  /**
   * Seconds. The clock a rank is measured against.
   *
   * It used to feed a speed bonus on a credit payout as well; credits went with D-091 and this is
   * now the *only* thing par does — which makes it, unexpectedly, the most load-bearing number on a
   * lock definition. `pay` and `requiresTool` sat beside it and are both gone: the first had nothing
   * left to pay into, the second nothing left to gate on (D-088).
   */
  readonly par: number
  /** Rows for multi-row layouts (dimple #24). Default 1. */
  readonly rows?: number
  /** Wafer locks where alternate wafers bite from the other side of the keyway. */
  readonly doubleSided?: boolean
  /** Disc detainer geometry. Required for `family: 'disc-detainer'`. */
  readonly discs?: DiscDef
  /** Sidebar locks need gate alignment on top of pin setting. */
  readonly sidebar?: SidebarDef
  /**
   * An interactive element (Tier 6, #33): oversetting *anything* trips it and dumps the whole
   * lock, set pins included. `CONTENT.md §1` — "interactive element that resets on overset".
   * A feather cannot save you from it, which is the point of the lock.
   */
  readonly resetOnOverset?: boolean
  /**
   * Chambers carrying a magnetic element (Tier 6, #34). A rake's teeth do nothing to them —
   * the magnet holds the pin against the tool — so they must be picked one at a time however
   * good the rake is. `CONTENT.md §1` — "magnetic elements that resist raking entirely".
   */
  readonly magneticChambers?: readonly number[]
  /** Notes surfaced in the bench UI. */
  readonly note?: string
}

export interface SidebarDef {
  /** Which chambers carry a sidebar gate. */
  readonly gatedChambers: readonly number[]
  /** How precisely the chamber's lift must match its gate, in mm. */
  readonly gateWidth: number
  /**
   * Where in the capture window each gate sits, 0..1. One entry per gated chamber, or a
   * single value applied to all of them. Defaults to the middle of the window.
   */
  readonly gatePositions?: readonly number[]
}

/** Disc detainer geometry — SIMULATION.md §10. */
export interface DiscDef {
  /** True gate angle per disc, in the same units as lift (0 .. `DISC_TRAVEL`). */
  readonly trueGates: readonly number[]
  /** False gate angles per disc. The sidebar drops partway into these and stops. */
  readonly falseGates: readonly (readonly number[])[]
  /** How wide a gate is, in the same units. */
  readonly gateWidth: number
}

/** Tool stats, as they reach the sim. Every field must change measurable behaviour. */
export interface ToolStats {
  readonly tensionMin: number
  readonly tensionMax: number
  /** Units per second the tension can change. */
  readonly tensionSlew: number
  /** ± random wobble applied to held tension, in T units. */
  readonly tensionPrecision: number
  /** How many chambers in from the keyway mouth the tip can reach. */
  readonly reach: number
  /** ± random wobble applied to the lift target, in mm. */
  readonly liftJitter: number
  /** Multiplier on `PICK_BASE_RATE`. */
  readonly liftRate: number
  readonly fitsTightKeyway: boolean
  /** Top-of-keyway wrenches leave more room for the pick; bottom-of-keyway block it. */
  readonly keywayPosition: 'top' | 'bottom'
  /**
   * How high the hook's crest stands above the shaft, in millimetres — DECISIONS D-138.
   *
   * The part of the tool that reaches up under a key pin. A short hook clears the pins it passes
   * on the way in; a tall one fouls them, which is the trade a real picker makes when they choose
   * a deep hook to reach a high cut and then have to get it past everything in front.
   *
   * It is only felt while the tip is **travelling with the hand raised**: a pick lying in the
   * keyway is below every pin and touches nothing, which is why this is a stat about carriage
   * rather than about reach.
   */
  readonly hookHeight: number
  /**
   * How much load this pick takes before it bends, as a multiplier on the strain threshold.
   *
   * The starter hook is 1.0. A heavy rigid pick shrugs off more; a fine needle bends sooner, which
   * is the trade a real precision tool makes and the reason a picker owns more than one (D-068).
   */
  readonly strength: number
}

/**
 * The four levels — how much of the lock you are shown.
 *
 * They are a ladder of *instrumentation*, not of physics: the simulation is identical at every
 * level and only what the player is allowed to see changes. Each rung takes away one thing and
 * expects you to replace it with a measurement.
 *
 * | | what you see |
 * |---|---|
 * | `training` | Everything. Pin types, the binding pin, the target window, the overset zone. |
 * | `easy` | One pin — the one under the tip — drawn plain, so its *type* stays hidden. |
 * | `medium` | No pins at all. You see where the pick is, and you read the meter. |
 * | `hard` | Not even the pick. A depth readout in millimetres, and the meter. |
 *
 * Replaces the old `guided | standard | expert | blind`, which took things away in a different
 * order and never took away the picture of where your own hand was. See DECISIONS D-046.
 */
export type AssistMode = 'training' | 'easy' | 'medium' | 'hard'

export interface SimConfig {
  readonly tools: ToolStats
  /** Feathering unlocks at Tier 3 (`CONTENT.md §2`). */
  readonly featherEnabled: boolean
  readonly assist: AssistMode
}

/** One frame of player intent. Position control, not rate control (GAME_DESIGN.md §3). */
export interface SimInput {
  /** Chamber the pick tip is under; -1 when the pick is out of the lock. */
  readonly chamber: number
  /** Absolute lift target in mm for the chamber under the tip. */
  readonly liftTarget: number
  /** Right mouse held. */
  readonly tensionHeld: boolean
  /** Wheel-set tension level, 0..1, before tool clamping. */
  readonly tensionLevel: number
}

export const NEUTRAL_INPUT: SimInput = {
  chamber: -1,
  liftTarget: 0,
  tensionHeld: false,
  tensionLevel: 0,
}

export type ChamberState = 'FREE' | 'BINDING' | 'FALSE_SET' | 'SET' | 'OVERSET'

/** What the geometry says is at the shear line, before roles are assigned. */
export type Geometry = 'SOLID' | 'GROOVE' | 'WINDOW' | 'OVER'

/**
 * How a chamber blocks the shear line.
 *
 * `pin` is the pin-tumbler stack: a threshold, where lifting *past* the window jams the key
 * pin into the shell. `wafer` is a single flat wafer with a gate that must sit *at* the shear
 * line — it blocks in both directions, so it is a window to be found rather than a threshold
 * to be crossed (SIMULATION.md §10).
 */
export type ChamberKind = 'pin' | 'wafer' | 'disc'

export interface Chamber {
  readonly index: number
  readonly kind: ChamberKind
  /**
   * A wafer biting from the *other* side of the keyway (double-sided locks). Its spring
   * pushes it up rather than down, so it rests at the top of its travel and the pick has to
   * hold it *down* — the tip is a ceiling instead of a floor.
   */
  readonly inverted: boolean
  /** Which row of a multi-row lock this chamber belongs to. Zero for everything else. */
  readonly row: number
  /**
   * A magnetic element: the pin is held wherever you leave it, instead of riding its spring back.
   *
   * Its original meaning was "a rake cannot move this", which stopped meaning anything when the
   * rake was removed (D-058) — it left this lock's headline feature inert. The magnet is still a
   * real thing though, and what a magnet actually does to a pin stack is hold it: the driver
   * sticks where the tool put it and does not fall back.
   *
   * That cuts both ways, which is what makes it a mechanic rather than a difficulty knob. You can
   * set a chamber and walk away with no spring undoing your work — and an **overset** sticks just
   * as hard, so a chamber you push too far stays pushed too far until you drop tension. See
   * DECISIONS D-066.
   */
  readonly magnetic: boolean
  /**
   * Disc detainer only: angles at which the sidebar drops *partway* and stops. Same lie a
   * spool tells, in a different coordinate (SIMULATION.md §10).
   */
  readonly falseGates: readonly number[]
  /**
   * Sidebar locks: the lift this chamber's sidebar gate wants, or null if it has none.
   * Setting the chamber outside that band leaves it looking set while the sidebar stays up.
   */
  readonly sidebarGate: number | null
  readonly sidebarWidth: number
  /** True once this chamber has been captured *with* its sidebar gate aligned. */
  sidebarAligned: boolean
  /** `Kᵢ` — key pin length, mm. */
  readonly keyPinLength: number
  /** `Dᵢ` — driver pin length, mm. */
  readonly driverLength: number
  readonly profile: DriverProfile
  /** §1 — lift that puts the key/driver junction exactly on the shear line. */
  readonly setLift: number
  /** §7 — `Wᵢ`. */
  readonly captureWindow: number
  /** §2 — radians of plug rotation before this chamber binds. */
  readonly delta: number
  /** Hard ceiling on lift: the spring bottoms out. */
  readonly maxLift: number

  /**
   * `Lᵢ` — the **driver** pin's lift, mm. This is the number the physics is about: the
   * classifier, counter-rotation and capture are all questions about where the driver sits
   * relative to the shear line.
   */
  lift: number
  /**
   * The **key pin**'s own lift, mm.
   *
   * Equal to `lift` almost always, because the key pin is what pushes the driver up. They come
   * apart exactly when something else is holding the driver: a captured driver rests on the
   * plug's ledge, and a false-set driver is wedged in its groove. In both cases the key pin has
   * nothing underneath it and falls back to the keyway floor, leaving a **visible gap** — which
   * is not a detail, it is the clearest tell in the whole game that a pin is set or lying.
   *
   * Never above `lift`: a key pin cannot pass through the driver above it.
   * See DECISIONS D-042.
   */
  keyLift: number
  state: ChamberState
  geometry: Geometry
  /** Index of the band at the shear line, -1 when nothing is. */
  bandAtShear: number
  /** Seconds accumulated inside the capture window. */
  captureTimer: number
  /** Seconds this captured chamber has spent below *its own* hold threshold (D-074). */
  belowHoldFor: number
  /** Current downward counter-rotation velocity, mm/s. */
  counterForce: number
  /**
   * This chamber's own feel, in resistance units, rolled once from the lock's seed.
   *
   * Added to every resistance reading whatever the state, because it is a property of the
   * hardware — spring rate, bore finish, a pin a thousandth over size — not of what the pin is
   * doing. It is what makes "number three is the heavy one" a thing you can learn about a
   * particular lock. See DECISIONS D-052.
   */
  resistanceBias: number
  /**
   * This chamber's spring, as a multiplier on the nominal return rate. Rolled from the seed.
   *
   * Two visible consequences, which is why it is its own field rather than folded into
   * `resistanceBias`: a stiff spring pushes back harder on the tip, *and* it drops its pin back
   * faster when the tip leaves. One you feel, one you watch. See DECISIONS D-062.
   */
  readonly springStrength: number
  /**
   * How much this chamber's bore drags on its pin, as a rate multiplier around 1.
   *
   * Below 1 is a tight chamber: the pin lifts *and* falls more slowly. Rolled from the same number
   * as `resistanceBias`, so a chamber that feels heavy is heavy (D-069).
   */
  readonly dragFactor: number
  /** True once this chamber has produced at least one false set this attempt. */
  hasFalseSet: boolean
}

export interface AttemptStats {
  /** Chambers in the order they set. */
  readonly setOrder: number[]
  /** Chambers in the order the plug actually bound them. */
  readonly bindOrder: number[]
  oversets: number
  fullResets: number
  feathers: number
  falseSetsEntered: number
  /** Strongest counter-rotation felt this attempt, mm/s — how hard the lock ever shoved. */
  maxCounterForce: number
  /**
   * Highest resistance the meter ever showed this attempt, 0..1.
   *
   * Recorded for the same reason `maxCounterForce` is: a browser test that samples this between
   * mouse moves can step straight over a transient on a loaded runner, and then reports "the lock
   * never pushed back" about a lock that pushed back hard. A peak the simulation keeps itself is
   * exact at any sampling rate, and it is the honest measurement either way (D-114).
   */
  maxResistance: number
  maxTension: number
  minTensionWhileHeld: number
  /** Seconds of simulated time in this attempt. */
  elapsed: number
}

export type SimEvent =
  | { readonly type: 'ATTEMPT_STARTED'; readonly time: number }
  | {
      readonly type: 'PIN_SET'
      readonly chamber: number
      readonly tension: number
      readonly time: number
    }
  | { readonly type: 'PIN_OVERSET'; readonly chamber: number; readonly time: number }
  | {
      readonly type: 'FALSE_SET_ENTERED'
      readonly chamber: number
      readonly depth: number
      readonly time: number
    }
  | {
      readonly type: 'COUNTER_ROTATION'
      readonly chamber: number
      readonly force: number
      readonly time: number
    }
  | {
      readonly type: 'PLUG_MOVED'
      readonly theta: number
      readonly velocity: number
      readonly time: number
    }
  | { readonly type: 'LOCK_OPENED'; readonly time: number; readonly ticks: number }
  /**
   * Every driver is above the shear line and nothing is holding the plug — but the wrench is not
   * asking for enough turn to open it (`pickedButUnturned`, D-048).
   *
   * A real hand feels this the instant it happens: the plug goes dead slack and rotates against
   * nothing. The gauge says so, but it was the one state in the game with a picture and no sound,
   * and the levels that take the picture away are precisely the ones where it matters most.
   * Emitted once on the transition, and re-armed if a pin is lost. See DECISIONS D-055.
   */
  | { readonly type: 'PLUG_FREE'; readonly time: number }
  /** The pick has taken a permanent set: it still works, less well (D-068). */
  | { readonly type: 'PICK_BENT'; readonly time: number }
  /** The pick has snapped. The attempt is over. */
  | { readonly type: 'PICK_BROKEN'; readonly time: number }
  | {
      /**
       * Drivers falling back into the plug.
       *
       * `full` is tension lost and everything gone; `feather` is the Tier 3 dip that sheds only the
       * overset pins; `counter` is the plug being turned *back* under pins that were set, which
       * takes their ledge away — a different mistake with a different cause, so it says so
       * (D-081).
       */
      readonly type: 'RESET'
      readonly kind: 'full' | 'feather' | 'counter'
      readonly dropped: readonly number[]
      readonly time: number
    }
  | {
      readonly type: 'PICK_MOVED'
      readonly from: number
      readonly to: number
      readonly time: number
    }

export type SimEventType = SimEvent['type']

/** A lock instantiated against a seed — chambers with their tolerance offsets rolled. */
export interface LockInstance {
  readonly def: LockDef
  readonly seed: number
  readonly chamberCount: number
  /** Radians; the largest δ in this instance. */
  readonly toleranceSpread: number
  /**
   * This copy's condition, around 1. Above 1 is worn — wider capture windows and looser tolerance;
   * below is stiff and new. Rolled per instance (D-072).
   */
  readonly condition: number
}

export interface SimState {
  readonly instance: LockInstance
  readonly config: SimConfig
  chambers: Chamber[]
  /** Current tension `T`, 0..1. */
  tension: number
  /** Tension before tool wobble — what the HUD shows. */
  tensionCommanded: number
  /** Smoothed wrench imprecision, in T units. */
  tensionWobble: number
  /** Smoothed pick imprecision, in mm. */
  pickWobble: number
  /** Plug rotation, radians. */
  theta: number
  thetaMax: number
  thetaDemand: number
  /** rad/s, for audio and camera. */
  thetaVelocity: number
  /** Index of the chamber the plug is pinching, or -1. */
  bindingChamber: number
  /**
   * False until every sidebar-gated chamber is set *with its gate aligned*. While it is
   * false the plug is held back however many pins read SET.
   */
  sidebarDropped: boolean
  /** Chamber the pick tip is under, after reach clamping. */
  pickChamber: number
  /**
   * Where the tip actually is along the keyway, in chamber units — 0 is chamber 0, 2.5 is
   * halfway between chambers 2 and 3. `-1` when the pick is out of the lock.
   *
   * `pickChamber` is this rounded: the chamber the tip is genuinely under. The two differ while
   * the pick is *travelling*, which it does at a rate tension slows right down (D-045).
   */
  pickPosition: number
  /** §8 — the resistance readout for the chamber under the tip. */
  resistance: number
  /**
   * How hard you are **leaning**, 0..1 — the *cause* of which `resistance` is the effect (D-064).
   *
   * The overreach: how far above the pin the tip is being commanded. A pin that rides up to meet
   * you takes almost nothing; one that will not budge lets the gap open, and that gap is the force
   * in your hand. Resistance alone cannot answer "am I feeling nothing because this pin is loose,
   * or because I am not pushing?", and that is the first question a player has once feeling
   * anything requires pushing at all. See DECISIONS D-083.
   */
  pickForce: number
  /**
   * Whether the tip is loaded onto the chamber at all, 0..1 — the *gate*, not the reading.
   *
   * Saturates within `RESIST_PRESSURE_MM`, which is what a gate should do and is exactly why it is
   * no longer what `pickForce` shows. Everything the chamber is allowed to tell you is scaled by
   * this (D-056), including whether its state may be named at all (D-076).
   */
  pickContact: number
  /**
   * Accumulated load on the pick, 0..∞. Past `STRAIN_BENT` the tool has taken a set; past
   * `STRAIN_BROKEN` it has snapped and the attempt is over. Resets with the attempt (D-068).
   */
  pickStrain: number
  /** True once the pick has taken a permanent bend this attempt. */
  pickBent: boolean
  /** True once it has broken. Nothing works after this until the lock is restarted. */
  pickBroken: boolean
  opened: boolean
  /** Simulated seconds since the attempt began. */
  time: number
  ticks: number
  /** How long tension has been below `T_MIN_HOLD`. */
  belowMinHoldFor: number
  /** True once tension has been meaningfully applied at least once. */
  engaged: boolean
  /**
   * True while the lock is picked but the wrench is not turning it hard enough (D-055).
   *
   * Purely so the `PLUG_FREE` event can be edge-triggered. Nothing reads it for physics.
   */
  plugFreeAnnounced: boolean
  rng: RngState
  events: SimEvent[]
  stats: AttemptStats
}
