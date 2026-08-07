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
import { ALL_LOCKS, lockBySlug } from '../../src/game/locks'
import { KIT } from '../../src/game/tools'
import {
  DISC_TRAVEL,
  SIDEBAR_HELD_FRACTION,
  THETA_OPEN,
  captureRange,
  createSimState,
  grooveDepthAt,
  makeConfig,
  measureDifficulty,
  sidebarAlignedAt,
  solveLock,
  type LockDef,
  type SimState,
} from '../../src/sim'
import { PERFECT_CONFIG, holdFor, makeLock, pick, tensionOnly } from './fixtures'

function lock(slug: string): LockDef {
  const def = lockBySlug(slug)
  if (!def) throw new Error(`no lock ${slug}`)
  return def
}

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

/** Seven pins in a circle. Not in the roster any more, still fully modelled (D-088). */
const TUBULAR_FIXTURE = makeLock({
  slug: 'fixture-tubular-7',
  bitting: [3.0, 3.4, 2.8, 3.2, 3.6, 2.9, 3.1],
  pins: ['standard', 'standard', 'standard', 'standard', 'standard', 'standard', 'standard'],
  family: 'tubular',
  toleranceQuality: 1.0,
})

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
const sidebars = ALL_LOCKS.filter((d) => d.sidebar !== undefined)

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

/**
 * Tubular locks left the *roster* with D-088 but not the *simulation* — they were never a separate
 * machine, only a pin tumbler bent into a circle by the view, and that is exactly what this proves.
 * From a fixture now, since there is no longer a catalogue entry to point at.
 */
describe('tubular locks', () => {
  it('reuse the pin model unchanged', () => {
    for (const def of [TUBULAR_FIXTURE]) {
      const s = createSimState(def, 1, PERFECT_CONFIG)
      // No disc, no wafer: a tubular is the ordinary stack, bent into a circle by the view.
      expect(s.chambers.every((c) => c.kind === 'pin')).toBe(true)
      expect(s.chambers.every((c) => c.setLift > 0)).toBe(true)
    }
  })

  it(
    'open across 50 seeds with the one kit — no specialist pick needed any more (D-088)',
    () => {
      const r = measureDifficulty(TUBULAR_FIXTURE, realConfig(), 50)
      expect(r.solved, `${TUBULAR_FIXTURE.slug}: ${r.failures.slice(0, 2).join('; ')}`).toBe(50)
    },
    HEAVY_TIMEOUT,
  )
})

describe('sidebar locks', () => {
  it('put every gate inside its chamber capture window', () => {
    expect(sidebars.length, 'the roster still carries a sidebar cylinder').toBeGreaterThan(0)
    for (const def of sidebars) {
      const s = createSimState(def, 1, PERFECT_CONFIG)
      const gated = s.chambers.filter((c) => c.sidebarGate !== null)
      expect(gated.length).toBe(def.sidebar?.gatedChambers.length)
      for (const c of gated) {
        const { low, high } = captureRange(c)
        expect(c.sidebarGate as number).toBeGreaterThanOrEqual(low)
        expect(c.sidebarGate as number).toBeLessThanOrEqual(high)
        // …and narrower than the window, or it would not be a second condition at all.
        expect(c.sidebarWidth * 2).toBeLessThan(high - low)
      }
    }
  })

  it('hold the plug back with every pin set, when a gate was missed', () => {
    const def = lock('halberd-sidebar-cylinder')
    const s = createSimState(def, 4, PERFECT_CONFIG)
    setEveryChamber(s, (c) => {
      if (c.sidebarGate === null) return c.setLift + c.captureWindow * 0.5
      // Deliberately aim at the far end of the window from the gate.
      const { low, high } = captureRange(c)
      return sidebarAlignedAt(c, high - 1e-3) ? low + 1e-3 : high - 1e-3
    })

    expect(s.chambers.every((c) => c.state === 'SET')).toBe(true)
    expect(s.chambers.some((c) => c.sidebarGate !== null && !c.sidebarAligned)).toBe(true)
    expect(s.sidebarDropped).toBe(false)
    expect(s.opened).toBe(false)
    // Turned some of the way and stopped: the tell that it is a sidebar and not weak tension.
    expect(s.theta).toBeGreaterThan(0)
    expect(s.theta).toBeLessThanOrEqual(THETA_OPEN * SIDEBAR_HELD_FRACTION + 1e-6)
  })

  it('open when the same lock is set with every gate aligned', () => {
    const def = lock('halberd-sidebar-cylinder')
    const s = createSimState(def, 4, PERFECT_CONFIG)
    setEveryChamber(s, (c) => c.sidebarGate ?? c.setLift + c.captureWindow * 0.5)
    expect(s.chambers.every((c) => c.state === 'SET')).toBe(true)
    expect(s.sidebarDropped).toBe(true)
    holdFor(s, tensionOnly(0.6), 1.2)
    expect(s.opened).toBe(true)
  })

  it('let the gate be felt: a gated chamber reads lighter on its gate', () => {
    const def = lock('halberd-sidebar-cylinder')
    const s = createSimState(def, 4, PERFECT_CONFIG)
    const c = s.chambers.find((x) => x.sidebarGate !== null)
    if (!c) throw new Error('no gated chamber')
    const gate = c.sidebarGate as number
    const { low, high } = captureRange(c)
    const off = sidebarAlignedAt(c, high) ? low : high

    // Wrench off, so nothing can capture while the survey is running.
    holdFor(s, pick(c.index, gate, 0), 0.12)
    const onGate = s.resistance
    holdFor(s, pick(c.index, off, 0), 0.12)
    const offGate = s.resistance
    expect(c.state).not.toBe('SET')
    expect(onGate).toBeLessThan(offGate)
  })

  it(
    'open across 50 seeds with the tools a player would bring',
    () => {
      for (const def of sidebars) {
        const r = measureDifficulty(def, realConfig(), 50)
        expect(r.solved, `${def.slug}: ${r.failures.slice(0, 2).join('; ')}`).toBe(50)
      }
    },
    HEAVY_TIMEOUT,
  )

  it('are not free — the solver spends blind probes finding the gates', () => {
    for (const def of sidebars) {
      const r = measureDifficulty(def, realConfig(), 10)
      expect(r.meanSearchSteps, `${def.slug}`).toBeGreaterThan(0)
    }
  })
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
      for (const def of ALL_LOCKS.filter((d) => d.tier === 4)) {
        const r = measureDifficulty(def, realConfig(), 50)
        expect(r.solved, `${def.slug}: ${r.failures.slice(0, 2).join('; ')}`).toBe(50)
      }
    },
    HEAVY_TIMEOUT,
  )

  it('returns a replayable tape for the sidebar cylinder and for a disc detainer', () => {
    // One shipped lock and one fixture: the solver's disc handling — sweeping blind for an angle
    // it is given no way to read — is the part that would rot silently now that no lock in the
    // roster exercises it.
    for (const def of [lock('halberd-sidebar-cylinder'), DISC_FIXTURE]) {
      const r = solveLock(def, 6, realConfig())
      expect(r.opened, def.slug).toBe(true)
      expect(r.tape.length, def.slug).toBeGreaterThan(3)
    }
  })
})

/**
 * Drive every chamber to a chosen lift and let it capture, in binding order.
 *
 * Deliberately not the solver: these tests need to *choose* where each chamber sets, which is
 * the whole point when the question is whether setting it in the wrong place is detected.
 */
function setEveryChamber(s: SimState, targetFor: (c: SimState['chambers'][number]) => number): void {
  holdFor(s, tensionOnly(0.35), 0.3)
  for (let guard = 0; guard < 6000 && !s.chambers.every((c) => c.state === 'SET'); guard += 1) {
    // A false-set chamber is nobody's binding chamber — the groove has swallowed the ledge —
    // so falling back to the first unset one is what keeps a spool from deadlocking this.
    const b = s.bindingChamber >= 0 ? s.bindingChamber : s.chambers.findIndex((c) => c.state !== 'SET')
    const c = b >= 0 ? s.chambers[b] : undefined
    if (!c) break
    holdFor(s, pick(b, targetFor(c), 0.35), 1 / 120)
  }
}
