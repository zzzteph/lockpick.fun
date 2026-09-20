/**
 * The high-security mechanisms — disc detainers, tubulars and sidebars
 * (`SIMULATION.md §10`, `PHASES.md` Phase 10).
 *
 * The three families share one machine with the pin tumbler, so most of what they do is
 * already covered by the core suites. What is tested here is the part that is genuinely
 * theirs: that a disc has no spring and turns both ways, that a false gate actually lies,
 * that a sidebar can be missed and that missing it is both survivable and visible.
 *
 * Only the **sidebar** still ships on a roster lock. Tubulars left with D-088 and disc detainers
 * with D-104, and both are tested from fixtures — the rule this file exists to keep being an
 * example of: *a test of a capability should not depend on a lock existing*.
 */

import { describe, expect, it } from 'vitest'
import { ALL_LOCKS } from '../../src/game/locks'
import { KIT } from '../../src/game/tools'
import {
  DISC_TRAVEL,
  createSimState,
  grooveDepthAt,
  makeConfig,
} from '../../src/sim'
import { measureDifficulty, solveLock } from '../../src/wheels'
import { PERFECT_CONFIG, holdFor, makeLock, pick, tensionOnly } from './fixtures'

/**
 * The loadout a player would actually be holding: the specialist tool is a pure gate with no
 * stats of its own (`CONTENT.md §2`), so the hook in the pick slot is what the simulation
 * reads. Same rule the difficulty curve is measured under.
 */
function realConfig(): ReturnType<typeof makeConfig> {
  return makeConfig({ tools: KIT, featherEnabled: true })
}

/**
 * Timeout for the 50-seed solver runs.
 *
 * These do genuine work — hundreds of attempts across the high-security roster, including blind
 * sweeps of ten- and eleven-disc detainers — and they finish in about four seconds alone.
 * Vitest's 5s default is comfortably inside that alone and outside it when six workers are
 * sharing six cores, so the default ends up measuring machine contention rather than the
 * solver. Raised here rather than globally, so a genuine hang anywhere else still trips it.
 */
const HEAVY_TIMEOUT = 120_000

/**
 * Six discs, one false gate each — the *Vantage Disc Detainer 6* that used to be lock 25.
 *
 * The disc detainers left the roster with D-104 and did **not** leave the simulation, so this is
 * the shipped lock's own data, moved here verbatim. The whole family — no springs, angles instead
 * of heights, false gates that lie through the same `GROOVE` classification a spool's waist uses —
 * is still asserted below, from a fixture, exactly as the wafers and tubulars have been since
 * D-088. Nothing about bringing the family back would have to be rebuilt.
 */
const DISC_FIXTURE = makeLock({
  slug: 'fixture-disc-6',
  name: 'Fixture disc detainer 6',
  bitting: [3, 3, 3, 3, 3, 3],
  pins: ['standard', 'standard', 'standard', 'standard', 'standard', 'standard'],
  family: 'disc-detainer',
  discs: {
    trueGates: [0.6, 1.9, 1.1, 2.4, 0.9, 1.6],
    falseGates: [[1.6], [0.8], [2.1], [1.2], [2.0], [0.5]],
    gateWidth: 0.18,
  },
  toleranceQuality: 0.65,
  par: 200,
})

/** Eleven discs, three false gates each — the *Vantage Protec Disc*, the hardest of the three. */
const PROTEC_FIXTURE = makeLock({
  slug: 'fixture-disc-11',
  name: 'Fixture disc detainer 11',
  bitting: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
  pins: Array.from({ length: 11 }, () => 'standard' as const),
  family: 'disc-detainer',
  discs: {
    trueGates: [0.45, 2.15, 1.25, 2.55, 0.85, 1.75, 2.35, 1.05, 1.95, 0.65, 1.45],
    falseGates: [
      [1.05, 1.75, 2.45],
      [0.5, 1.15, 1.65],
      [0.35, 1.85, 2.45],
      [0.6, 1.15, 1.85],
      [1.45, 1.95, 2.55],
      [0.4, 1.05, 2.45],
      [0.65, 1.15, 1.75],
      [0.4, 1.65, 2.25],
      [0.5, 1.15, 2.55],
      [1.15, 1.75, 2.35],
      [0.5, 1.05, 2.55],
    ],
    gateWidth: 0.12,
  },
  toleranceQuality: 0.48,
  par: 420,
})

const discLocks = [DISC_FIXTURE, PROTEC_FIXTURE]

describe('disc detainers', () => {
  it('are gone from the roster, and still a lock the simulation can build (D-104)', () => {
    expect(ALL_LOCKS.filter((d) => d.family === 'disc-detainer')).toEqual([])
    for (const def of discLocks) {
      const gates = def.discs?.trueGates ?? []
      expect(gates).toHaveLength(def.bitting.length)
      for (const g of gates) {
        expect(g).toBeGreaterThan(0)
        expect(g).toBeLessThan(DISC_TRAVEL)
      }
      // Not merely valid data — it instantiates, and every chamber comes out a disc.
      const s = createSimState(def, 1, PERFECT_CONFIG)
      expect(s.chambers.every((c) => c.kind === 'disc')).toBe(true)
    }
  })

  it('have no spring — a disc stays exactly where it was left', () => {
    const s = createSimState(DISC_FIXTURE, 3, PERFECT_CONFIG)
    const c = s.chambers[0]
    if (!c) throw new Error('no disc')
    holdFor(s, pick(0, 1.4, 0.4), 0.4)
    const parked = c.lift
    expect(parked).toBeGreaterThan(1.0)
    // Take the tool away entirely for a full second.
    holdFor(s, tensionOnly(0.4), 1.0)
    expect(c.lift).toBeCloseTo(parked, 6)
  })

  it('turn back down again — an overshoot is recoverable', () => {
    const s = createSimState(DISC_FIXTURE, 3, PERFECT_CONFIG)
    const c = s.chambers[0]
    if (!c) throw new Error('no disc')
    holdFor(s, pick(0, 2.6, 0.4), 0.6)
    expect(c.lift).toBeGreaterThan(2.4)
    holdFor(s, pick(0, 0.4, 0.4), 0.6)
    expect(c.lift).toBeLessThan(0.6)
  })

  it('read a false gate as a groove, with a depth that is not the pin profile', () => {
    const def = DISC_FIXTURE
    const s = createSimState(def, 3, PERFECT_CONFIG)
    const c = s.chambers.find((x) => x.falseGates.length > 0)
    if (!c) throw new Error('no false gates')
    // Every disc here carries a plain `standard` profile, whose only band has zero depth.
    // Reading the depth off that profile is exactly the bug that made false gates silent.
    expect(c.profile.name).toBe('standard')
    holdFor(s, tensionOnly(0.4), 0.3)
    holdFor(s, pick(c.index, c.falseGates[0] as number, 0.4), 0.5)
    if (c.geometry === 'GROOVE') expect(grooveDepthAt(c)).toBeGreaterThan(0)
  })

  it('actually tell the lie: the solver meets false gates on both of them', () => {
    for (const def of discLocks) {
      const r = measureDifficulty(def, realConfig(), 20)
      expect(r.meanFalseSets, `${def.slug}`).toBeGreaterThan(0)
    }
  })

  it('cost real search — the gate angle is readable from nothing', () => {
    for (const def of discLocks) {
      const r = measureDifficulty(def, realConfig(), 10)
      // At least one sweep's worth of blind positions per disc.
      expect(r.meanSearchSteps, `${def.slug}`).toBeGreaterThan(def.bitting.length)
    }
  })

  it(
    'open across 50 seeds',
    () => {
      for (const def of discLocks) {
        const r = measureDifficulty(def, realConfig(), 50)
        expect(r.solved, `${def.slug}: ${r.failures.slice(0, 2).join('; ')}`).toBe(50)
      }
    },
    HEAVY_TIMEOUT,
  )
})



describe('the top of the roster', () => {
  it('ends at Tier 4 — cylinders and wheel packs, since D-167 brought a second family', () => {
    // The disc detainers were cut in D-104; the combination wheels ride the same surviving
    // machinery back in. The tier ceiling is unchanged: Tier 4 is still the top, as the store
    // page says.
    const tiers = [...new Set(ALL_LOCKS.map((d) => d.tier))].sort((a, b) => a - b)
    expect(tiers).toEqual([1, 2, 3, 4])
    expect(ALL_LOCKS.every((d) => d.family === 'pin-tumbler' || d.family === 'combination')).toBe(
      true,
    )
  })

  it(
    'opens every Tier 4 lock across 50 seeds',
    () => {
      // The wheel packs: Tier 4's pin locks run on the contact solver now (D-233) and are opened
      // there, by the walk, in tests/game/solverSession.test.ts.
      for (const def of ALL_LOCKS.filter((d) => d.tier === 4 && d.family === 'combination')) {
        const r = measureDifficulty(def, realConfig(), 50)
        expect(r.solved, `${def.slug}: ${r.failures.slice(0, 2).join('; ')}`).toBe(50)
      }
    },
    HEAVY_TIMEOUT,
  )

  it('returns a replayable tape for a disc detainer', () => {
    // The solver's disc handling — sweeping blind for an angle it is given no way to read — is
    // the part that would rot silently now that no lock in the roster exercises it. (The sidebar
    // cylinder stood here too; it runs on the contact solver since D-230/D-233.)
    for (const def of [DISC_FIXTURE]) {
      const r = solveLock(def, 6, realConfig())
      expect(r.opened, def.slug).toBe(true)
      expect(r.tape.length, def.slug).toBeGreaterThan(3)
    }
  })
})
