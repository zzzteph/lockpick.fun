/**
 * Lock validation and instantiation — SIMULATION.md §1, §2, §7.
 *
 * A `LockDef` is authored data. A `SimState` is that data rolled against a seed: the
 * per-chamber tolerance offsets `δᵢ` that decide the binding order are generated here, per
 * *instance*, so the same lock binds in a different order every time you sit down with it.
 */

import {
  CAPTURE_WINDOW,
  DIMPLE_MAX_OVERLIFT,
  CONDITION_SPREAD,
  DISC_TRAVEL,
  DRAG_RATE_SPREAD,
  DRIVER_LENGTH,
  KEYWAY_FLOOR,
  MAX_KEY_PIN,
  MAX_OVERLIFT,
  MIN_DELTA_GAP,
  MIN_STACK_HEIGHT,
  RESIST_PIN_BIAS,
  SPRING_SPREAD,
  TOLERANCE_SPREAD,
} from './constants'
import { PROFILES, minimumSetLift, type PinTypeName } from './profiles'
import { createRng, nextFloat, shuffle, type RngState } from './rng'
import { STARTER_TOOLS } from './tools'
import type {
  AttemptStats,
  Chamber,
  ChamberKind,
  LockDef,
  LockInstance,
  SimConfig,
  SimState,
  ToolStats,
} from './types'

export class LockDefError extends Error {
  constructor(
    message: string,
    readonly lockSlug: string,
  ) {
    super(`Lock "${lockSlug}": ${message}`)
    this.name = 'LockDefError'
  }
}

export const MIN_CHAMBERS = 1
export const MAX_CHAMBERS = 16

/**
 * Reject a malformed lock at load time with a message that names the problem.
 * An invalid definition must fail the build, not produce an unopenable lock (PHASES.md 6).
 */
export function validateLockDef(def: LockDef): void {
  const fail = (msg: string): never => {
    throw new LockDefError(msg, def.slug || String(def.id))
  }

  if (!Number.isInteger(def.id) || def.id < 1) fail(`id must be a positive integer, got ${def.id}`)
  if (!def.slug) fail('slug is required')
  if (!def.name) fail('name is required')
  if (!Number.isInteger(def.tier) || def.tier < 1 || def.tier > 6) {
    fail(`tier must be 1-6, got ${def.tier}`)
  }

  const n = def.bitting.length
  if (n < MIN_CHAMBERS || n > MAX_CHAMBERS) {
    fail(`chamber count ${n} is outside ${MIN_CHAMBERS}-${MAX_CHAMBERS}`)
  }
  if (def.pins.length !== n) {
    fail(`pins has ${def.pins.length} entries but bitting has ${n}`)
  }

  if (def.family === 'disc-detainer') {
    validateDiscs(def, n, fail)
    return
  }

  for (let i = 0; i < n; i += 1) {
    const k = def.bitting[i]
    if (k === undefined || !Number.isFinite(k)) fail(`bitting[${i}] is not a finite number`)
    const key = k as number
    if (key >= MAX_KEY_PIN) {
      fail(
        `bitting[${i}] = ${key} — key pins must sit below the shear line at rest (K < ${MAX_KEY_PIN})`,
      )
    }
    if (key <= 0) fail(`bitting[${i}] = ${key} — key pin length must be positive`)
    if (key + DRIVER_LENGTH <= MIN_STACK_HEIGHT) {
      fail(
        `bitting[${i}] = ${key} — stack must straddle the shear line (K + D > ${MIN_STACK_HEIGHT}), ` +
          `got ${(key + DRIVER_LENGTH).toFixed(2)}`,
      )
    }
    const pin = def.pins[i]
    if (pin === undefined || !(pin in PROFILES)) {
      fail(`pins[${i}] = "${String(pin)}" is not a known pin profile`)
    }
    const setLift = -(KEYWAY_FLOOR + key)
    if (pin === 'wafer') {
      // A wafer's gate is centred on `setLift`, so the wafer has to start *below* its gate
      // or it would be set the moment tension went on.
      const half = (CAPTURE_WINDOW * def.toleranceQuality) / 2
      if (setLift <= half + 0.15) {
        fail(
          `chamber ${i} is a wafer but bitting ${key} puts its gate ${setLift.toFixed(2)}mm up, ` +
            `inside the ${half.toFixed(2)}mm half-window — it would start already set ` +
            `(use K < ${(MAX_KEY_PIN - half - 0.15).toFixed(2)})`,
        )
      }
    } else {
      // Only the bottom `setLift` mm of a driver ever crosses the shear line, so a security
      // pin whose grooves sit above that would behave exactly like a standard pin.
      const needed = minimumSetLift(PROFILES[pin as PinTypeName])
      if (setLift < needed) {
        fail(
          `chamber ${i} carries a "${String(pin)}" but bitting ${key} gives setLift ` +
            `${setLift.toFixed(2)}mm — its grooves start at ${needed.toFixed(2)}mm and would ` +
            `never reach the shear line (use K < ${(MAX_KEY_PIN - needed).toFixed(2)})`,
        )
      }
    }
  }

  if (def.springs && def.springs.length !== n) {
    fail(`springs has ${def.springs.length} entries but there are ${n} chambers`)
  }
  for (const s of def.springs ?? []) {
    if (!(s > 0.2) || s > 3) fail(`spring strength ${s} is outside the sane range 0.2-3`)
  }

  if (def.doubleSided && !def.pins.every((p) => p === 'wafer')) {
    fail('doubleSided is only meaningful on a lock made entirely of wafers')
  }

  if (!(def.toleranceQuality > 0.2) || def.toleranceQuality > 2.0) {
    fail(`toleranceQuality ${def.toleranceQuality} is outside the sane range 0.2-2.0`)
  }

  const spread = def.toleranceSpread ?? TOLERANCE_SPREAD
  if (!(spread > 0)) fail(`toleranceSpread ${spread} must be positive`)
  const needed = (n - 1) * MIN_DELTA_GAP
  if (spread <= needed) {
    fail(
      `toleranceSpread ${spread} cannot hold ${n} chambers ${MIN_DELTA_GAP} apart ` +
        `(needs > ${needed.toFixed(4)})`,
    )
  }

  if (!(def.par > 0)) fail(`par must be positive, got ${def.par}`)
  // Zero is legal: the three teaching locks in `GAME_DESIGN.md §10` pay nothing on purpose,
  // because a lesson teaches rather than earns. "Every *roster* lock pays" is a content rule
  // and lives in the roster test, which is the only place that knows what the roster is.
  if (def.rows !== undefined && (!Number.isInteger(def.rows) || def.rows < 1 || def.rows > 2)) {
    fail(`rows must be 1 or 2, got ${def.rows}`)
  }
  if (def.sidebar) {
    for (const c of def.sidebar.gatedChambers) {
      if (!Number.isInteger(c) || c < 0 || c >= n) fail(`sidebar gates chamber ${c}, out of range`)
    }
    if (!(def.sidebar.gateWidth > 0)) fail('sidebar gateWidth must be positive')
  }
}

/**
 * Disc detainers are validated on their own terms: they have no bitting to speak of, and
 * what matters is that every gate is reachable and that a false gate never sits on top of the
 * true one — which would make the lock unopenable in a way nothing else would catch.
 */
function validateDiscs(def: LockDef, n: number, fail: (msg: string) => never): void {
  const discs = def.discs
  if (!discs) {
    fail('a disc detainer needs a `discs` block')
    return
  }
  if (discs.trueGates.length !== n) {
    fail(`discs.trueGates has ${discs.trueGates.length} entries but there are ${n} discs`)
  }
  if (discs.falseGates.length !== n) {
    fail(`discs.falseGates has ${discs.falseGates.length} entries but there are ${n} discs`)
  }
  if (!(discs.gateWidth > 0) || discs.gateWidth > DISC_TRAVEL / 4) {
    fail(`discs.gateWidth ${discs.gateWidth} is outside 0 - ${DISC_TRAVEL / 4}`)
  }
  for (let i = 0; i < n; i += 1) {
    const trueGate = discs.trueGates[i]
    if (trueGate === undefined || !Number.isFinite(trueGate)) {
      fail(`disc ${i} has no true gate`)
      return
    }
    if (trueGate < discs.gateWidth || trueGate > DISC_TRAVEL - discs.gateWidth) {
      fail(
        `disc ${i} true gate ${trueGate} is outside the reachable travel ` +
          `${discs.gateWidth} - ${(DISC_TRAVEL - discs.gateWidth).toFixed(2)}`,
      )
    }
    for (const f of discs.falseGates[i] ?? []) {
      if (f < 0 || f > DISC_TRAVEL) fail(`disc ${i} false gate ${f} is off the dial`)
      // Overlapping gates would be indistinguishable, and the true one would be unfindable.
      if (Math.abs(f - trueGate) < discs.gateWidth * 2) {
        fail(
          `disc ${i} false gate ${f} sits on top of its true gate ${trueGate} — ` +
            `they must be at least ${(discs.gateWidth * 2).toFixed(2)} apart`,
        )
      }
    }
  }
  if (!(def.par > 0)) fail(`par must be positive, got ${def.par}`)
  // Zero is legal: the three teaching locks in `GAME_DESIGN.md §10` pay nothing on purpose,
  // because a lesson teaches rather than earns. "Every *roster* lock pays" is a content rule
  // and lives in the roster test, which is the only place that knows what the roster is.
}

/**
 * Generate `n` tolerance offsets in `[0, spread]`, every pair at least `MIN_DELTA_GAP` apart.
 *
 * The spec suggested rejection sampling ("regenerating if not"), which has no upper bound on
 * iterations and gets pathological as `n × gap` approaches `spread`. This constructs the
 * result directly instead: sample in the shrunken interval, sort, then push the i-th value
 * up by `i × gap`. Same distribution family, guaranteed to terminate. See DECISIONS D-013.
 */
export function generateDeltas(rng: RngState, n: number, spread: number): number[] {
  const gap = MIN_DELTA_GAP
  const usable = spread - (n - 1) * gap
  if (usable <= 0) {
    throw new Error(`toleranceSpread ${spread} cannot separate ${n} chambers by ${gap}`)
  }
  const raw: number[] = []
  for (let i = 0; i < n; i += 1) raw.push(nextFloat(rng) * usable)
  raw.sort((a, b) => a - b)
  return raw.map((v, i) => v + i * gap)
}

export const DEFAULT_CONFIG: SimConfig = {
  tools: STARTER_TOOLS,
  featherEnabled: false,
  assist: 'easy',
}

export function makeConfig(patch: Partial<SimConfig> & { tools?: ToolStats }): SimConfig {
  return { ...DEFAULT_CONFIG, ...patch }
}

function emptyStats(): AttemptStats {
  return {
    setOrder: [],
    bindOrder: [],
    oversets: 0,
    fullResets: 0,
    feathers: 0,
    falseSetsEntered: 0,
    maxCounterForce: 0,
    maxResistance: 0,
    maxTension: 0,
    minTensionWhileHeld: 1,
    elapsed: 0,
  }
}

/** Roll a lock instance and build the initial simulation state. */
export function createSimState(def: LockDef, seed: number, config: SimConfig): SimState {
  validateLockDef(def)
  const rng = createRng(seed)
  const n = def.bitting.length
  /**
   * This copy's condition (D-072), on its **own** random stream.
   *
   * Above 1 is a worn cylinder — chambers reamed a shade wide by years of use, so it forgives a
   * clumsier lift; below 1 is stiff and new. Two copies of the same catalogue lock are not the same
   * lock, which is why `toleranceQuality` describes the *model* rather than the object in your hand.
   *
   * The separate stream is not fastidiousness. Drawing it from `rng` shifts every subsequent draw,
   * so the δ values a seed produces all move — and fourteen tests that assert on exact seeded
   * geometry, including two hand-written input tapes, changed meaning at once. A property of the
   * instance does not belong in the middle of the tolerance draw.
   */
  const condition = 1 + (nextFloat(createRng((seed ^ 0x9e3779b9) >>> 0)) * 2 - 1) * CONDITION_SPREAD
  const spread = def.toleranceSpread ?? TOLERANCE_SPREAD

  // Distinct, well-separated offsets, then shuffled onto chambers so the binding order is
  // a property of the seed rather than of the bitting.
  const sorted = generateDeltas(rng, n, spread)
  const assignment = shuffle(
    rng,
    sorted.map((_, i) => i),
  )
  const deltas: number[] = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i += 1) {
    deltas[assignment[i] as number] = sorted[i] as number
  }

  const chambers: Chamber[] = []
  const rows = def.rows ?? 1
  const isDisc = def.family === 'disc-detainer'
  for (let i = 0; i < n; i += 1) {
    const keyPinLength = def.bitting[i] as number
    const profileName = def.pins[i] as PinTypeName
    const kind: ChamberKind = isDisc ? 'disc' : profileName === 'wafer' ? 'wafer' : 'pin'

    // §1 — the lift that brings the key/driver junction exactly to the shear line. For a
    // wafer it is the lift that puts the gate on the shear line; for a disc it is the angle
    // that presents the true gate to the sidebar.
    const setLift = isDisc
      ? (def.discs?.trueGates[i] ?? DISC_TRAVEL / 2)
      : -(KEYWAY_FLOOR + keyPinLength)
    // A worn cylinder forgives a clumsier lift than a stiff new one (D-072). Disc gates are cut
    // rather than reamed, so wear does not widen them the same way.
    const captureWindow = isDisc
      ? (def.discs?.gateWidth ?? 0.2)
      : CAPTURE_WINDOW * def.toleranceQuality * condition

    // Double-sided wafer locks alternate which side of the keyway each wafer bites from.
    const inverted = kind === 'wafer' && def.doubleSided === true && i % 2 === 1

    const gated = def.sidebar?.gatedChambers.indexOf(i) ?? -1
    const gatePosition =
      gated >= 0
        ? (def.sidebar?.gatePositions?.[gated] ?? def.sidebar?.gatePositions?.[0] ?? 0.5)
        : 0.5
    const sidebarGate = gated >= 0 ? setLift + captureWindow * gatePosition : null

    // One roll, two consequences: what the chamber feels like and how fast it moves (D-069).
    const bias = (nextFloat(rng) * 2 - 1) * RESIST_PIN_BIAS

    const chamber: Chamber = {
      index: i,
      kind,
      inverted,
      row: rows > 1 ? i % rows : 0,
      magnetic: def.magneticChambers?.includes(i) ?? false,
      falseGates: isDisc ? (def.discs?.falseGates[i] ?? []) : [],
      sidebarGate,
      sidebarWidth: def.sidebar?.gateWidth ?? 0,
      sidebarAligned: false,
      keyPinLength,
      driverLength: DRIVER_LENGTH,
      profile: PROFILES[profileName],
      setLift,
      captureWindow,
      delta: deltas[i] as number,
      maxLift: isDisc
        ? DISC_TRAVEL
        : setLift + (def.family === 'dimple' ? DIMPLE_MAX_OVERLIFT : MAX_OVERLIFT),
      lift: 0,
      keyLift: 0,
      state: 'FREE',
      geometry: 'SOLID',
      bandAtShear: 0,
      captureTimer: 0,
      belowHoldFor: 0,
      counterForce: 0,
      hasFalseSet: false,
      /**
       * This chamber's own feel, rolled once from the lock's seed.
       *
       * No two chambers in a real cylinder feel alike. The springs come off a coil and vary a
       * few per cent; the bores are reamed to a tolerance, not to a number; one pin is a
       * thousandth fatter than the next and drags on the wall. A picker learns a *particular*
       * lock — "number three is the heavy one" — and that knowledge is most of what makes the
       * second attempt faster than the first.
       *
       * Every chamber returning the identical number for the identical state made resistance a
       * lookup rather than a reading: one glance at the meter told you the state outright, and
       * there was nothing to learn about *this* lock as opposed to locks in general. Rolled from
       * the seed, so it is a property of the lock instance and is the same every time that lock
       * is loaded. See DECISIONS D-052.
       */
      resistanceBias: bias,
      // Authored springs win; everything else rolls its own from the seed (D-062, D-080). The
      // draw happens either way so a lock with springs binds in the same order as one without.
      springStrength: (() => {
        const rolled = 1 + (nextFloat(rng) * 2 - 1) * SPRING_SPREAD
        return def.springs?.[i] ?? rolled
      })(),
      // Derived from the same roll as the bias, negated: a chamber that reads heavy is a chamber
      // that drags, so it lifts and falls more slowly too (D-069).
      dragFactor: 1 - (bias / RESIST_PIN_BIAS) * DRAG_RATE_SPREAD,
    }
    // An inverted wafer rests at the top of its travel, pushed there by its own spring.
    if (inverted) chamber.lift = chamber.maxLift
    chambers.push(chamber)
  }

  const instance: LockInstance = {
    def,
    seed,
    chamberCount: n,
    toleranceSpread: spread,
    condition,
  }

  return {
    instance,
    config,
    chambers,
    tension: 0,
    tensionCommanded: 0,
    tensionWobble: 0,
    pickWobble: 0,
    theta: 0,
    thetaMax: 0,
    thetaDemand: 0,
    thetaVelocity: 0,
    bindingChamber: -1,
    sidebarDropped: !def.sidebar,
    pickChamber: -1,
    pickPosition: -1,
    resistance: 0,
    pickForce: 0,
    pickContact: 0,
    pickStrain: 0,
    pickBent: false,
    pickBroken: false,
    opened: false,
    time: 0,
    ticks: 0,
    belowMinHoldFor: 0,
    engaged: false,
    plugFreeAnnounced: false,
    rng,
    events: [{ type: 'ATTEMPT_STARTED', time: 0 }],
    stats: emptyStats(),
  }
}

/** Derived geometry for rendering — SIMULATION.md §1. */
export function keyPinBottom(c: Chamber): number {
  return KEYWAY_FLOOR + c.lift
}

export function keyPinTop(c: Chamber): number {
  return KEYWAY_FLOOR + c.keyPinLength + c.lift
}

export function driverPinTop(c: Chamber): number {
  return KEYWAY_FLOOR + c.keyPinLength + c.driverLength + c.lift
}

/** §1 — the boundary offset `sᵢ`: signed height of the key/driver junction above shear. */
export function boundaryOffset(c: Chamber): number {
  return c.lift - c.setLift
}
