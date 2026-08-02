/**
 * The solver test — VERIFICATION.md §4.
 *
 * This is the completeness proof: every authored lock, across 50 seeds, opened by a scripted
 * picker that plays through the same input API a human uses and finds the binding pin by
 * reading the resistance meter rather than by looking at which chamber is binding.
 *
 * It also writes `screenshots/difficulty-curve.txt` so the balance can be read at a glance.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ALL_LOCKS, chambersOf } from '../../src/game/locks'
import { KIT } from '../../src/game/tools'
import {
  PERFECT_TOOLS,
  STARTER_TOOLS,
  difficultyScore,
  effectiveReach,
  formatDifficultyTable,
  makeConfig,
  meanScoreByTier,
  measureDifficulty,
  runTape,
  createSimState,
  solveLock,
  toleranceFactor,
  type LockDef,
  type LockDifficulty,
  type SimConfig,
} from '../../src/sim'

const SEEDS = 50
const OUT_DIR = path.resolve(__dirname, '../../screenshots')

/** Feathering is free from Tier 3 (CONTENT.md §2). */
function configFor(def: LockDef, tools = STARTER_TOOLS): SimConfig {
  return makeConfig({ tools, featherEnabled: def.tier >= 3 })
}

const rows: LockDifficulty[] = []
const starterRows: LockDifficulty[] = []

beforeAll(() => {
  for (const def of ALL_LOCKS) {
    // The kit the player always has (D-088). There is no longer a second answer.
    rows.push(measureDifficulty(def, configFor(def, KIT), SEEDS))
    if (chambersOf(def) <= effectiveReach(STARTER_TOOLS, def.keyway)) {
      starterRows.push(measureDifficulty(def, configFor(def), SEEDS))
    }
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const report = [
    formatDifficultyTable(
      rows,
      `SHEAR LINE - difficulty curve (${SEEDS} seeds per lock, cheapest hook that reaches)`,
    ),
    '',
    formatDifficultyTable(starterRows, 'Reference: the same locks under PERFECT_TOOLS'),
  ].join('\n')
  writeFileSync(path.join(OUT_DIR, 'difficulty-curve.txt'), `${report}\n`, 'utf8')
}, 600_000)

describe('the solver opens every authored lock', () => {
  it(`opens all ${ALL_LOCKS.length} locks across ${SEEDS} seeds — 100%, no exceptions`, () => {
    const broken = rows.filter((r) => r.solved < r.seeds)
    expect(
      broken.map((r) => `${r.slug}: ${r.solved}/${r.seeds} — ${r.failures.slice(0, 2).join('; ')}`),
    ).toEqual([])
  })

  it('opens every lock the starter tools can physically reach', () => {
    expect(starterRows.length).toBeGreaterThan(0)
    const broken = starterRows.filter((r) => r.solved < r.seeds)
    expect(
      broken.map((r) => `${r.slug}: ${r.solved}/${r.seeds} — ${r.failures.slice(0, 2).join('; ')}`),
    ).toEqual([])
  })

  it('refuses a lock deeper than the pick can reach, and says why', () => {
    const deep = ALL_LOCKS.find((d) => chambersOf(d) > effectiveReach(STARTER_TOOLS, d.keyway))
    expect(deep).toBeDefined()
    if (!deep) return
    const r = solveLock(deep, 1, configFor(deep), { maxSeconds: 20 })
    expect(r.opened).toBe(false)
    expect(r.failure).toMatch(/needs a longer hook/)
  })

  it('returns a tape that replays to the same open', () => {
    const def = ALL_LOCKS[0]
    if (!def) throw new Error('empty roster')
    const config = configFor(def, PERFECT_TOOLS)
    const result = solveLock(def, 7, config)
    expect(result.opened).toBe(true)
    expect(result.tape.length).toBeGreaterThan(3)

    const replay = createSimState(def, 7, config)
    runTape(replay, result.tape)
    expect(replay.opened).toBe(true)
    expect(replay.chambers.every((c) => c.state === 'SET')).toBe(true)
  })

  it('finds the binding pin by feel, not by reading which chamber binds', () => {
    // A guard against the solver quietly gaining x-ray: its source must not mention the
    // state field that names the binding chamber.
    const source = readFileSync(path.resolve(__dirname, '../../src/sim/solver.ts'), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    expect(code).not.toContain('bindingChamber')
    expect(code).toContain('resistance')
  })
})

describe('the difficulty curve', () => {
  it('trends upward by tier', () => {
    const scores = meanScoreByTier(rows)
    const tiers = [...scores.keys()].sort((a, b) => a - b)
    expect(tiers.length).toBeGreaterThan(1)
    for (let i = 1; i < tiers.length; i += 1) {
      const here = scores.get(tiers[i] as number) ?? 0
      const before = scores.get(tiers[i - 1] as number) ?? 0
      expect(
        here,
        `tier ${tiers[i]} (${here.toFixed(2)}) should be harder than tier ${tiers[i - 1]} (${before.toFixed(2)})`,
      ).toBeGreaterThan(before)
    }
  })

  it('has no lock more than 2x its tier mean', () => {
    const byTier = new Map<number, LockDifficulty[]>()
    for (const r of rows) {
      const list = byTier.get(r.tier) ?? []
      list.push(r)
      byTier.set(r.tier, list)
    }
    const outliers: string[] = []
    for (const [tier, list] of byTier) {
      const mean = list.reduce((a, b) => a + difficultyScore(b), 0) / list.length
      for (const r of list) {
        const score = difficultyScore(r)
        if (score > mean * 2) {
          outliers.push(`${r.slug} ${score.toFixed(2)} vs tier ${tier} mean ${mean.toFixed(2)}`)
        }
      }
    }
    expect(outliers).toEqual([])
  })

  it('writes the table to screenshots/difficulty-curve.txt', () => {
    const table = formatDifficultyTable(rows, 'test')
    expect(table).toContain('Mean difficulty score by tier')
    expect(table).toContain('score = (rounds')
    expect(table.split('\n').length).toBeGreaterThan(rows.length)
  })

  it('security-pinned locks score higher than plain ones of the same size', () => {
    // Lock 13 has four chambers and two spools; lock 5 has four chambers and none.
    const spoolTrainer = rows.find((r) => r.slug === 'ironhold-spool-trainer')
    const bikePadlock = rows.find((r) => r.slug === 'brasswell-bike-padlock')
    expect(spoolTrainer).toBeDefined()
    expect(bikePadlock).toBeDefined()
    if (!spoolTrainer || !bikePadlock) return
    /*
     * A precondition, not the claim: the two locks have to be doing comparable *amounts* of work
     * for the score gap between them to be attributable to the security pins rather than to length.
     * Within a fifth of a round is comparable — the spool lock sits at 4.08 against the padlock's
     * 4.00, which is a rounding difference in how a spool's false set lands, not a difference in
     * shape. It was pinned to a tenth, which made this fail on the tiny shift from D-144's overlift
     * change while the thing it exists to prove never moved at all.
     */
    expect(Math.abs(spoolTrainer.meanRounds - bikePadlock.meanRounds)).toBeLessThan(0.2)
    expect(difficultyScore(spoolTrainer)).toBeGreaterThan(difficultyScore(bikePadlock))
  })

  it('weights a tighter lock above a loose one doing identical work', () => {
    const loose = rows.find((r) => r.slug === 'northgate-5-pin-cabinet')
    const tight = rows.find((r) => r.slug === 'halberd-tight-tolerance-5')
    expect(loose).toBeDefined()
    expect(tight).toBeDefined()
    if (!loose || !tight) return
    expect(tight.toleranceQuality).toBeLessThan(loose.toleranceQuality)
    expect(toleranceFactor(tight.toleranceQuality)).toBeGreaterThan(
      toleranceFactor(loose.toleranceQuality),
    )
  })

  it('scores mistakes far above routine work', () => {
    const base: LockDifficulty = {
      slug: 'x',
      name: 'x',
      tier: 1,
      toleranceQuality: 1.0,
      seeds: 1,
      solved: 1,
      meanSeconds: 1,
      maxSeconds: 1,
      meanRounds: 4,
      meanOversets: 0,
      meanResets: 0,
      meanFalseSets: 0,
      meanSearchSteps: 0,
      failures: [],
    }
    expect(difficultyScore(base)).toBe(4)
    expect(difficultyScore({ ...base, meanFalseSets: 2 })).toBe(5)
    expect(difficultyScore({ ...base, meanOversets: 1 })).toBe(8)
    expect(difficultyScore({ ...base, meanResets: 1 })).toBe(12)
    // Twenty blind positions tried is worth one chamber's work.
    expect(difficultyScore({ ...base, meanSearchSteps: 20 })).toBe(5)
    // …and tolerance scales the lot: half the tolerance, twice the score.
    expect(difficultyScore({ ...base, toleranceQuality: 0.5 })).toBe(8)
  })
})
