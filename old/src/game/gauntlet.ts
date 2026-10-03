/**
 * The dungeon's lock forge — every lock the Lock dungeon hangs on a chest or a door.
 *
 * History, because the file name carries it: this was the five-slot Gauntlet's generator
 * (D-165), grew the deal and the wager (D-168), and then the owner turned the mode into a
 * crawler outright (`docs/DUNGEON.md`) — the runs, the ramp-of-five, the banking arithmetic
 * all retired with their screens. What survives is the part the crawler stands on: the ramp's
 * slot shapes and the two builders that dealt legal locks from the editor's own space since
 * the first run — now serving one lock at a time, keyed by tier.
 *
 * Generation still lives inside the editor's legal space: a dungeon lock is a `Draft` the
 * editor could have produced, pushed through the same `draftToLockDef`/`validateLockDef` road
 * as a player's own design (D-080), and the wheel padlocks author their gates through
 * `detentCentre` so the grid validator polices them like everything else (D-167).
 */

import type { LockDef } from '../sim'
import { COMBO_DIGITS, createRng, detentCentre, nextInt, nextRange, shuffle, type RngState } from '../sim'
import {
  DEPTH_STEP,
  MIN_DEPTH,
  draftToLockDef,
  maxDepthFor,
  snapDepth,
  type Draft,
  type DraftChamber,
} from './editor'
import type { PinTypeName } from '../sim'

/**
 * Far above `CUSTOM_ID_BASE` (10 000) and the catalogue: nothing that filters by id range —
 * the bench, the codes roster — can mistake a dungeon lock for player content or vice versa.
 */
export const GAUNTLET_ID_BASE = 50_000

/**
 * The slot shapes, the bench's difficulty ladder compressed: chambers climb, the security
 * budget climbs, the window tightens, the liar pool grows nastier. Tier 1 owns the two
 * opening slots; tiers 2-4 their own rungs.
 */
interface SlotShape {
  readonly chambers: number
  readonly securityPins: number
  /** Tolerance band the slot rolls inside; lower is a narrower capture window. */
  readonly tolerance: readonly [number, number]
  readonly pool: readonly PinTypeName[]
}

const RAMP: readonly SlotShape[] = [
  { chambers: 3, securityPins: 0, tolerance: [1.15, 1.3], pool: [] },
  { chambers: 4, securityPins: 0, tolerance: [1.05, 1.2], pool: [] },
  { chambers: 5, securityPins: 1, tolerance: [0.95, 1.1], pool: ['spool'] },
  { chambers: 5, securityPins: 2, tolerance: [0.85, 1.0], pool: ['spool', 'serrated', 'spool-slim'] },
  {
    chambers: 6,
    securityPins: 3,
    tolerance: [0.72, 0.88],
    pool: ['spool', 'serrated', 'spool-deep', 'spool-double', 'mushroom', 't-pin'],
  },
]

/** One chamber's cut, random on the editor's own grid, inside the profile's legal depth. */
function rollDepth(rng: RngState, pin: PinTypeName): number {
  const max = maxDepthFor(pin)
  return snapDepth(nextRange(rng, MIN_DEPTH, max))
}

/**
 * Springs lean normal. A stiff or light spring is a texture the later slots may roll, never a
 * wall — a lock the player meets once and never again has no room for a chamber that reads
 * wrong.
 */
function rollSpring(rng: RngState, slot: number): number {
  if (slot >= 2 && nextInt(rng, 4) === 0) return nextInt(rng, 2) === 0 ? 0 : 2
  return 1
}

function buildSlot(rng: RngState, slot: number): Draft {
  const shape = RAMP[slot] as SlotShape

  // Which chambers carry the liars: shuffled positions, budget from the ramp.
  const positions = shuffle(
    rng,
    Array.from({ length: shape.chambers }, (_, i) => i),
  ).slice(0, shape.securityPins)
  const security = new Set(positions)

  const chambers: DraftChamber[] = Array.from({ length: shape.chambers }, (_, i) => {
    const pin: PinTypeName =
      security.has(i) && shape.pool.length > 0
        ? (shape.pool[nextInt(rng, shape.pool.length)] as PinTypeName)
        : 'standard'
    return { depth: rollDepth(rng, pin), pin, spring: rollSpring(rng, slot) }
  })

  /**
   * A degenerate bitting — every cut within a hair of the same depth — makes the binding order
   * mush and the lock boring. The catalogue never ships one and the forge may not either:
   * if the spread comes out under half a millimetre, the first chamber is pushed to the legal
   * floor and the last toward its ceiling, which restores a real climb without leaving the grid.
   */
  const depths = chambers.map((c) => c.depth)
  if (Math.max(...depths) - Math.min(...depths) < 0.5) {
    const first = chambers[0] as DraftChamber
    const last = chambers[chambers.length - 1] as DraftChamber
    first.depth = snapDepth(MIN_DEPTH + DEPTH_STEP)
    last.depth = snapDepth(maxDepthFor(last.pin) - DEPTH_STEP)
  }

  return {
    name: 'A dungeon lock',
    chambers,
    toleranceQuality: Number(nextRange(rng, shape.tolerance[0], shape.tolerance[1]).toFixed(2)),
    keyway: 'standard',
  }
}

/** Wheels per slot, lies per wheel, and how wide a gate the fence gets. Ramped like the pins. */
const WHEEL_SHAPE: Record<number, { wheels: number; lies: number; gate: number }> = {
  2: { wheels: 3, lies: 0, gate: 0.15 },
  3: { wheels: 4, lies: 1, gate: 0.12 },
  4: { wheels: 4, lies: 2, gate: 0.1 },
}

/**
 * A wheel combination padlock for a chest or a door (D-167/D-168's wheels, chest-sized).
 * Gates live on the detent grid by construction — `detentCentre` of shuffled digits, so code
 * and lies can never share a detent — which is exactly what `validateDetentGrid` polices.
 */
function buildWheelLock(rng: RngState, slot: number): Omit<LockDef, 'id' | 'slug' | 'tier'> {
  const shape = WHEEL_SHAPE[slot] ?? { wheels: 4, lies: 1, gate: 0.12 }
  const ramp = RAMP[slot] as SlotShape
  const trueGates: number[] = []
  const falseGates: number[][] = []
  for (let w = 0; w < shape.wheels; w += 1) {
    const digits = shuffle(
      rng,
      Array.from({ length: COMBO_DIGITS }, (_, d) => d),
    )
    trueGates.push(detentCentre(digits[0] as number))
    falseGates.push(digits.slice(1, 1 + shape.lies).map((d) => detentCentre(d)))
  }
  return {
    name: 'A combination padlock',
    family: 'combination',
    bitting: Array.from({ length: shape.wheels }, () => 3),
    pins: Array.from({ length: shape.wheels }, (): PinTypeName => 'standard'),
    discs: { trueGates, falseGates, gateWidth: shape.gate },
    toleranceQuality: Number(nextRange(rng, ramp.tolerance[0], ramp.tolerance[1]).toFixed(2)),
    keyway: 'standard',
    par: shape.wheels * 26 + shape.wheels * shape.lies * 10,
    note: 'Every second spent in here, the floor takes its turns.',
  }
}

/**
 * One lock for a chest or a door (`docs/DUNGEON.md`). `salt` tells the floor's locks apart;
 * `tier` maps onto the ramp the way the bench's tiers do, and a wheel padlock (tier 2+) is
 * the second family wearing chest form.
 */
export function generateDungeonLock(
  seed: number,
  salt: number,
  tier: 1 | 2 | 3 | 4,
  wheel: boolean,
): LockDef {
  const rng = createRng(((((seed ^ 0x9e37) >>> 0) + salt * 2654435761) >>> 0) || 1)
  const slot = tier === 1 ? nextInt(rng, 2) : tier
  const base =
    wheel && slot >= 2
      ? buildWheelLock(rng, slot)
      : draftToLockDef(buildSlot(rng, slot), 0)
  return {
    ...base,
    id: GAUNTLET_ID_BASE + 500 + salt,
    slug: `dungeon-${seed >>> 0}-${salt}`,
    name: base.family === 'combination' ? 'A combination padlock' : 'A dungeon lock',
    tier,
    note: 'Every second spent in here, the floor takes its turns.',
  }
}
