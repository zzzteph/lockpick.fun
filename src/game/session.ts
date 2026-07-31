/**
 * A picking session: one lock, one seed, one attempt in progress.
 *
 * Owns the fixed-timestep accumulator and the render interpolation. The simulation only ever
 * advances in whole `DT` ticks (SIMULATION.md §9); the renderer is handed a *view* state
 * whose continuous values are interpolated between the last two ticks, so motion stays smooth
 * at any refresh rate without the physics ever seeing a variable frame time.
 */

import {
  DT,
  cloneSimState,
  createSimState,
  drainEvents,
  step,
  type LockDef,
  type SimConfig,
  type SimEvent,
  type SimInput,
  type SimState,
} from '../sim'

/** Never simulate more than this much real time in one frame, or a stall becomes a spiral. */
const MAX_CATCHUP_SECONDS = 0.25

export class Session {
  state: SimState
  /** An interpolated copy for rendering. Never step this. */
  readonly view: SimState

  private accumulator = 0
  private prevTheta = 0
  private prevLifts: number[]
  /**
   * The key pin's previous height, interpolated exactly like the driver's.
   *
   * Missing until now, and the omission was invisible in a way worth recording: `syncView`
   * copies a hand-written list of fields, so a field added to `SimState` is simply *not there* in
   * the render view and silently keeps whatever value it was cloned with. `keyLift` arrived with
   * the two-body split (D-042) and was never added here, so every key pin in the game was drawn
   * frozen at the keyway floor from that day on — and `pickPosition` (D-045) had the same fate,
   * which only surfaced when the pick started being *drawn* from it (D-059). See DECISIONS D-060.
   */
  private prevKeyLifts: number[]
  private prevCounter: number[]
  private prevResistance = 0

  constructor(
    readonly def: LockDef,
    public seed: number,
    private config: SimConfig,
  ) {
    this.state = createSimState(def, seed, config)
    this.view = cloneSimState(this.state)
    this.prevLifts = this.state.chambers.map((c) => c.lift)
    this.prevKeyLifts = this.state.chambers.map((c) => c.keyLift)
    this.prevCounter = this.state.chambers.map(() => 0)
  }

  /** Restart this lock with a fresh tolerance seed (the `R` key). */
  restart(seed: number = this.seed + 1): void {
    this.seed = seed
    this.state = createSimState(this.def, seed, this.config)
    this.accumulator = 0
    this.prevTheta = 0
    this.prevLifts = this.state.chambers.map((c) => c.lift)
    this.prevKeyLifts = this.state.chambers.map((c) => c.keyLift)
    this.prevCounter = this.state.chambers.map(() => 0)
    this.syncView(1)
  }

  setConfig(config: SimConfig): void {
    this.config = config
  }

  /** Advance by real elapsed seconds, running whole ticks only. Returns events emitted. */
  advance(realSeconds: number, input: SimInput): SimEvent[] {
    this.accumulator += Math.min(realSeconds, MAX_CATCHUP_SECONDS)
    let ran = 0
    while (this.accumulator >= DT) {
      this.captureprev()
      step(this.state, input, DT)
      this.accumulator -= DT
      ran += 1
    }
    if (ran === 0) return []
    return drainEvents(this.state)
  }

  /** Fraction of a tick elapsed since the last step, for interpolation. */
  get alpha(): number {
    return this.accumulator / DT
  }

  private captureprev(): void {
    this.prevTheta = this.state.theta
    this.prevResistance = this.state.resistance
    for (let i = 0; i < this.state.chambers.length; i += 1) {
      const c = this.state.chambers[i]
      if (!c) continue
      this.prevLifts[i] = c.lift
      this.prevKeyLifts[i] = c.keyLift
      this.prevCounter[i] = c.counterForce
    }
  }

  /**
   * Refresh the render view. Continuous values are interpolated; discrete ones (chamber
   * state, which chamber binds) are taken from the latest tick, because a half-set pin is
   * not a thing.
   */
  syncView(alpha = this.alpha): SimState {
    const v = this.view
    const s = this.state
    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha
    v.theta = this.prevTheta + (s.theta - this.prevTheta) * t
    v.thetaMax = s.thetaMax
    v.thetaDemand = s.thetaDemand
    v.thetaVelocity = s.thetaVelocity
    v.tension = s.tension
    v.tensionCommanded = s.tensionCommanded
    v.resistance = this.prevResistance + (s.resistance - this.prevResistance) * t
    // Copied deliberately, and the reason is D-060: this list is hand-written, so a field added to
    // `SimState` and forgotten here is silently frozen at its cloned value forever.
    v.pickForce = s.pickForce
    v.pickStrain = s.pickStrain
    v.pickBent = s.pickBent
    v.pickBroken = s.pickBroken
    v.bindingChamber = s.bindingChamber
    v.pickChamber = s.pickChamber
    // Not interpolated: the simulation already slides it at 120Hz (D-045), and it is what the
    // pick is *drawn* from (D-059), so a stale value means no pick on screen at all.
    v.pickPosition = s.pickPosition
    v.plugFreeAnnounced = s.plugFreeAnnounced
    v.sidebarDropped = s.sidebarDropped
    v.opened = s.opened
    v.time = s.time
    v.ticks = s.ticks
    /**
     * The attempt's running tally — **shared, not copied**.
     *
     * It was missing from this list, which is the exact failure the comment above predicts: the
     * constructor's `cloneSimState` gave the view a `stats` of its own and nothing ever touched it
     * again, so `view.stats` read as a fresh attempt — every counter zero — for the whole of every
     * attempt. Nothing noticed until D-112 put `maxTension` on screen and the banner it gates
     * refused to go away, which a screenshot caught and no assertion would have.
     *
     * Aliased rather than deep-copied because `stats` holds two arrays and this runs every frame,
     * and because the renderer only ever reads it. There is nothing to interpolate here: a counter
     * is a count.
     */
    v.stats = s.stats
    for (let i = 0; i < s.chambers.length; i += 1) {
      const src = s.chambers[i]
      const dst = v.chambers[i]
      if (!src || !dst) continue
      const p = this.prevLifts[i] ?? src.lift
      dst.lift = p + (src.lift - p) * t
      const pk = this.prevKeyLifts[i] ?? src.keyLift
      dst.keyLift = pk + (src.keyLift - pk) * t
      const pc = this.prevCounter[i] ?? src.counterForce
      dst.counterForce = pc + (src.counterForce - pc) * t
      dst.state = src.state
      dst.geometry = src.geometry
      dst.bandAtShear = src.bandAtShear
      dst.captureTimer = src.captureTimer
      dst.hasFalseSet = src.hasFalseSet
      dst.sidebarAligned = src.sidebarAligned
    }
    return v
  }
}
