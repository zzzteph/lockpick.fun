import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_LOCKS, DEFERRED_LOCKS, chambersOf, findLock } from '../../src/game/locks'
import {
  PERFECT_TOOLS,
  PROFILES,
  createSimState,
  isSecurityPin,
  makeConfig,
  validateLockDef,
} from '../../src/sim'
import { CODES_COMPACT_PER_PAGE, codesPageCount } from '../../src/ui/shell'
import { shareableCode } from '../../src/game/sharecode'
import { LESSONS } from '../../src/game/tutorial'
import type { Viewport } from '../../src/render/viewport'

const ROOT = path.resolve(__dirname, '../..')

describe('the roster is data — CONTENT.md §1', () => {
  it('is cylinders, in four tiers (D-088, D-104)', () => {
    // The roster used to be 36 locks across six tiers and six families. It was cut twice, both
    // times deliberately: D-088 dropped wafer, dimple, tubular and radial-slider locks and spread
    // the pin tumblers over four tiers with the disc detainers as a fifth, and D-104 dropped the
    // disc detainers too — a family the game never taught. What is left is one family and one
    // idea, told four tiers deep. The ids are no longer contiguous, and that is fine: an id is an
    // identity, not a position.
    const tiers = [...new Set(ALL_LOCKS.map((d) => d.tier))].sort((a, b) => a - b)
    expect(tiers).toEqual([1, 2, 3, 4])
    const families = new Set(ALL_LOCKS.map((d) => d.family))
    expect([...families]).toEqual(['pin-tumbler'])
    // Every id is unique, and nothing is both authored and deferred.
    expect(new Set(ALL_LOCKS.map((d) => d.id)).size).toBe(ALL_LOCKS.length)
    const deferred = new Set(DEFERRED_LOCKS.map((d) => d.id))
    for (const d of ALL_LOCKS) expect(deferred.has(d.id), `lock ${d.id} is both`).toBe(false)
  })

  it('gives a reason for every deferral, traceable to where it was decided', () => {
    // Either a phase — for a lock that was never authored — or a decision entry, for one that was
    // authored and then cut. The disc detainers are the second kind and there was no phase to
    // point at (D-104), so pointing at the decision is what "gives a reason" has to mean.
    for (const d of DEFERRED_LOCKS) {
      expect(d.reason.length, `lock ${d.id}`).toBeGreaterThan(4)
      expect(d.reason, `lock ${d.id}`).toMatch(/Phase \d+|D-\d+/)
    }
  })

  it('validates every definition at module load', () => {
    for (const def of ALL_LOCKS) {
      expect(() => {
        validateLockDef(def)
      }, def.slug).not.toThrow()
    }
  })

  it('adding a lock means touching exactly one file', () => {
    // Nothing outside `src/game/locks.ts` may contain a lock definition. The marker is a
    // `slug:` field next to a `bitting:` field; if that pair appears anywhere else, lock data
    // has leaked out of its one home.
    const files = [
      'src/app.ts',
      'src/game/session.ts',
      'src/render/cutaway.ts',
      'src/render/layout.ts',
      'src/sim/lock.ts',
      'src/sim/solver.ts',
    ]
    for (const rel of files) {
      const text = readFileSync(path.join(ROOT, rel), 'utf8')
      expect(text, `${rel} should not contain lock data`).not.toMatch(/bitting:\s*\[/)
    }
    const roster = readFileSync(path.join(ROOT, 'src/game/locks.ts'), 'utf8')
    expect((roster.match(/bitting:\s*\[/g) ?? []).length).toBe(ALL_LOCKS.length)
  })
})

describe('every authored lock loads and is playable', () => {
  const config = makeConfig({ tools: PERFECT_TOOLS })

  it('instantiates with distinct tolerance offsets and a sane chamber count', () => {
    for (const def of ALL_LOCKS) {
      const s = createSimState(def, 1, config)
      expect(s.chambers.length, def.slug).toBe(chambersOf(def))
      const deltas = s.chambers.map((c) => c.delta)
      expect(new Set(deltas).size, `${def.slug} has duplicate deltas`).toBe(deltas.length)
      for (const c of s.chambers) {
        expect(c.setLift, `${def.slug} chamber ${c.index}`).toBeGreaterThan(0)
        expect(c.captureWindow, `${def.slug} chamber ${c.index}`).toBeGreaterThan(0)
        // Every chamber starts below the shear line and straddling it.
        expect(c.geometry).toBe('SOLID')
      }
    }
  })

  it('gives every security-pin chamber a cut deep enough to reach its grooves', () => {
    for (const def of ALL_LOCKS) {
      const s = createSimState(def, 1, config)
      for (const c of s.chambers) {
        if (c.profile.grooveCount === 0) continue
        expect(
          c.setLift,
          `${def.slug} chamber ${c.index} (${c.profile.name}) is cut too shallow`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it('uses only pin profiles the simulation knows', () => {
    for (const def of ALL_LOCKS) {
      for (const p of def.pins) expect(Object.keys(PROFILES)).toContain(p)
    }
  })

  it('has unique ids, slugs and names', () => {
    expect(new Set(ALL_LOCKS.map((d) => d.id)).size).toBe(ALL_LOCKS.length)
    expect(new Set(ALL_LOCKS.map((d) => d.slug)).size).toBe(ALL_LOCKS.length)
    expect(new Set(ALL_LOCKS.map((d) => d.name)).size).toBe(ALL_LOCKS.length)
  })

  it('is resolvable by id and by slug', () => {
    for (const def of ALL_LOCKS) {
      expect(findLock(def.id)).toBe(def)
      expect(findLock(def.slug)).toBe(def)
    }
  })
})

describe('roster balance matches CONTENT.md', () => {
  it('gives every lock on the bench a par to be ranked against', () => {
    // Par used to feed a speed bonus as well as a rank. It is the only thing left (D-091), which
    // makes a lock with a nonsense par a lock nobody can be scored on.
    for (const d of ALL_LOCKS) {
      expect(d.par, d.slug).toBeGreaterThan(0)
      // S is 40% of par. On the fastest lock in the game that still has to be several seconds.
      expect(d.par * 0.4, d.slug).toBeGreaterThan(3)
    }
  })

  it('par time rises with tier', () => {
    const byTier = new Map<number, number[]>()
    for (const d of ALL_LOCKS) {
      const e = byTier.get(d.tier) ?? []
      e.push(d.par)
      byTier.set(d.tier, e)
    }
    const tiers = [...byTier.keys()].sort((a, b) => a - b)
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
    for (let i = 1; i < tiers.length; i += 1) {
      const here = byTier.get(tiers[i] as number)
      const before = byTier.get(tiers[i - 1] as number)
      if (!here || !before) continue
      expect(mean(here), `tier ${tiers[i]} par`).toBeGreaterThan(mean(before))
    }
  })

  it('tolerance tightens as tiers rise', () => {
    // By tier *mean* rather than by tier worst — a tier is allowed one lock that is hard for a
    // reason other than tolerance, as long as the tier as a whole is less forgiving than the one
    // below it. It mattered more when the last tier was three disc detainers, whose difficulty was
    // a ten-disc stack of false gates rather than a tight fit; with four cylinder tiers the mean
    // and the floor now agree, and the mean is still the honest question to ask of the number.
    const mean = new Map<number, number>()
    for (const tier of new Set(ALL_LOCKS.map((d) => d.tier))) {
      const locks = ALL_LOCKS.filter((d) => d.tier === tier)
      mean.set(tier, locks.reduce((a, b) => a + b.toleranceQuality, 0) / locks.length)
    }
    const tiers = [...mean.keys()].sort((a, b) => a - b)
    for (let i = 1; i < tiers.length; i += 1) {
      const here = mean.get(tiers[i] as number) as number
      const before = mean.get(tiers[i - 1] as number) as number
      expect(here, `tier ${tiers[i]} (${here.toFixed(3)}) vs ${tiers[i - 1]} (${before.toFixed(3)})`).toBeLessThan(before)
    }
  })

  it('keeps security pins out of Tier 1, and introduces them in Tier 2', () => {
    // The tightest tolerance anything below Tier 3 is allowed to have. A Tier 3+ lock that
    // carries no security feature at all must at least be *tighter* than that, or it is a
    // Tier 2 lock with a higher number on it.
    const tier12 = ALL_LOCKS.filter((d) => d.tier <= 2)
    const looseFloor = Math.min(...tier12.map((d) => d.toleranceQuality))

    for (const d of ALL_LOCKS) {
      // A wafer's gate is a groove, but it is the target rather than a trap.
      const pins = d.pins.filter((p) => isSecurityPin(PROFILES[p])).length
      // A disc detainer has no pins at all. It tells the same lie with a false gate — a notch
      // too shallow for the sidebar to pass — so that is what counts as its security feature.
      const gates = (d.discs?.falseGates ?? []).reduce((n, g) => n + g.length, 0)
      // A sidebar, an interactive element and a magnet are each a defence in their own right.
      const extras =
        (d.sidebar ? 1 : 0) +
        (d.resetOnOverset ? 1 : 0) +
        (d.magneticChambers?.length ?? 0)
      const security = pins + gates + extras

      // Tier 1 is plain cylinders, full stop. Tier 2 is where security pins are *taught* — it
      // carries the spool and serrated trainers, which exist to introduce them — so it is allowed
      // them, and only the first tier is held to zero. With the roster cut to 23 locks (D-088)
      // there is no longer a tier of wafers to spend on the gap.
      if (d.tier === 1) expect(security, `${d.slug}`).toBe(0)
      if (d.tier >= 3) {
        // The Bramah is the one lock whose whole defence is its family: seven sliders, each
        // blocking in both directions, at the tightest tolerance in the game. It carries no
        // security pin because it does not need one.
        const tightEnough = d.toleranceQuality < looseFloor
        expect(security > 0 || tightEnough, `${d.slug} is a Tier 2 lock wearing a badge`).toBe(true)
      }
    }
  })
})

/**
 * Reachability on a phone — DECISIONS D-136.
 *
 * Two things were unreachable and nothing could see it, because both were *drawn* correctly and
 * only the surrounding arithmetic disagreed. Neither the layout audit nor a screenshot can catch
 * "this control is enabled and does nothing" or "this card will disappear after you press it".
 */
describe('nothing on a phone becomes unreachable', () => {
  it('the codes pager can reach every shareable lock', () => {
    const compact = { scale: 0.3 } as Viewport
    const shareable = ALL_LOCKS.filter((def) => shareableCode(def) !== null).length
    expect(shareable).toBeGreaterThan(4)

    // With no designs of your own, the roster alone still has to be pageable.
    const pages = codesPageCount(compact, 0)
    expect(pages, 'the roster needs more than one page').toBeGreaterThan(1)
    expect(pages * CODES_COMPACT_PER_PAGE).toBeGreaterThanOrEqual(shareable)

    // And a design of your own adds to the same run rather than a separate count.
    expect(codesPageCount(compact, 8)).toBe(Math.ceil((shareable + 8) / CODES_COMPACT_PER_PAGE))
  })

  it('every lesson stays reachable until all of them are done', () => {
    // `startLesson` is called from exactly two places: the menu's shortcut, which always goes to
    // the first lesson, and the bench's lesson cards. So while any lesson is unfinished, the cards
    // are the only route to it and must be drawn.
    expect(LESSONS.length).toBeGreaterThan(1)
    const afterFirst = [LESSONS[0]!.id]
    const allDone = LESSONS.map((l) => l.id)
    const stripShows = (done: string[]): boolean => !LESSONS.every((l) => done.includes(l.id))
    expect(stripShows([]), 'before any lesson').toBe(true)
    expect(stripShows(afterFirst), 'after lesson one — two and three are still unreached').toBe(true)
    expect(stripShows(allDone), 'once every lesson is done').toBe(false)
  })
})
