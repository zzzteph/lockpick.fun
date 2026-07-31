/**
 * Tier 6 — the showpieces (`CONTENT.md §1`, `PHASES.md` Phase 13).
 *
 * Each of these locks is a *mechanism the rest of the roster does not have*, rather than the
 * same mechanism with the numbers turned up. Two of them add something to the simulation, and
 * those two are what this file is mostly about: an interactive element that dumps the lock on
 * any overset, and magnetic chambers a rake cannot touch.
 */

import { describe, expect, it } from 'vitest'
import { DEFERRED_LOCKS, lockBySlug } from '../../src/game/locks'
import { KIT } from '../../src/game/tools'
import {
  createSimState,
  makeConfig,
  measureDifficulty,
  type LockDef,
} from '../../src/sim'
import { PERFECT_CONFIG, holdFor, pick, tensionOnly } from './fixtures'

function lock(slug: string): LockDef {
  const def = lockBySlug(slug)
  if (!def) throw new Error(`no lock ${slug}`)
  return def
}

function realConfig(): ReturnType<typeof makeConfig> {
  return makeConfig({ tools: KIT, featherEnabled: true })
}


/**
 * Timeout for the 50-seed solver runs.
 *
 * These do genuine work — 250 attempts on the heaviest locks in the game, including 50 blind
 * sweeps of an eleven-disc detainer — and they finish in about four seconds alone. Vitest's 5s
 * default is comfortably inside that alone and outside it when six workers are sharing the same
 * six cores, so the default measures machine contention rather than the solver. Raised here
 * rather than globally, so a genuine hang anywhere else still trips the default.
 */
const HEAVY_TIMEOUT = 120_000

describe('the showpieces that survived the cut', () => {
  it('each still has a mechanism the rest of the roster does not have', () => {
    // The *Vantage Protec Disc* stood here too — eleven discs and thirty-three false gates, the
    // hardest single lock in the game. It went with the family in D-104; its data survives as
    // `PROTEC_FIXTURE` in `highsecurity.test.ts`, which is where its mechanism is now asserted.
    expect(lock('halberd-sovereign').keyway).toBe('tight')
    expect(lock('halberd-magnetic-hybrid').magneticChambers).toEqual([1, 3])
  })

  it('and the deferred lock still says why it was cut, in code rather than in a document', () => {
    expect(DEFERRED_LOCKS.length).toBeGreaterThan(0)
    expect(DEFERRED_LOCKS[0]?.reason).toMatch(/CUT/)
    expect(DEFERRED_LOCKS[0]?.reason.length).toBeGreaterThan(80)
  })

  it(
    'opens every one across 50 seeds',
    () => {
      for (const slug of ['halberd-sovereign', 'halberd-magnetic-hybrid']) {
        const r = measureDifficulty(lock(slug), realConfig(), 50)
        expect(r.solved, `${slug}: ${r.failures.slice(0, 2).join('; ')}`).toBe(50)
      }
    },
    HEAVY_TIMEOUT,
  )
})

/**
 * The interactive dimple (#33) and the Bramah slider (#35) left the roster with D-088, which
 * kept cylinders and disc detainers only. Their tests went with them; the *mechanisms* are
 * untouched in `src/sim/` and would come straight back with a lock that used them.
 */

describe('the magnetic elements — #34', () => {
  const def = lock('halberd-magnetic-hybrid')

  it('marks exactly the chambers the lock declares', () => {
    const s = createSimState(def, 1, PERFECT_CONFIG)
    expect(s.chambers.filter((c) => c.magnetic).map((c) => c.index)).toEqual([1, 3])
  })

  /**
   * `a rake moves every other chamber and never touches those two` was here.
   *
   * The magnetic chambers' *stated* purpose — `CONTENT.md §1`, "magnetic elements that resist
   * raking entirely" — went with the rake (D-058), so there is nothing left for them to resist.
   * They remain marked and the flag remains in the simulation, and the test below still proves
   * they pick normally, which is now the whole of what they do. Worth flagging plainly rather
   * than quietly deleting: this lock's headline feature is currently inert.
   */
  it('holds its pin where the tool left it — DECISIONS D-066', () => {
    /**
     * The magnetic element's new meaning, and its whole point: it cuts both ways. A set chamber
     * stays set with no spring undoing your work, and an overset stays overset just as stubbornly.
     */
    const s = createSimState(def, 2, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.4), 0.3)
    const magnetic = s.chambers.filter((c) => c.magnetic)
    expect(magnetic.length).toBe(2)
    const plain = s.chambers.find((c) => !c.magnetic)
    const held = magnetic[0]
    if (!plain || !held) throw new Error('expected both kinds of chamber')

    // Lift both a little, then take the pick away entirely and give the springs a full second.
    holdFor(s, pick(held.index, 0.9, 0.4), 0.5)
    const heldAt = held.keyLift
    holdFor(s, pick(plain.index, 0.9, 0.4), 0.5)
    const plainAt = plain.keyLift
    expect(heldAt, 'the magnetic pin never came up').toBeGreaterThan(0.3)
    expect(plainAt, 'the plain pin never came up').toBeGreaterThan(0.3)

    holdFor(s, tensionOnly(0.4), 1.0)
    // The plain one has dropped back to the keyway floor; the magnetic one has barely moved.
    expect(plain.keyLift, 'a sprung pin should fall').toBeLessThan(0.1)
    expect(held.keyLift, 'a magnetic pin should hold').toBeGreaterThan(heldAt - 0.3)
    // The claim that matters is the comparison: same lock, same second, wildly different fate.
    expect(held.keyLift).toBeGreaterThan(plain.keyLift * 4)
  })

  it('the magnetic flag is still set, and still means nothing to the pick', () => {
    const s = createSimState(def, 2, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.35), 0.4)
    const magnetic = s.chambers.filter((c) => c.magnetic)
    expect(magnetic.length).toBe(2)
    // Pickable exactly like their neighbours: the flag gates a tool that no longer exists.
    for (const c of magnetic) expect(c.maxLift).toBeGreaterThan(0)
  })

  it('the magnetic chambers still pick perfectly normally', () => {
    const s = createSimState(def, 3, PERFECT_CONFIG)
    holdFor(s, tensionOnly(0.4), 0.3)
    const c = s.chambers[1]
    if (!c) throw new Error('no chamber 1')
    holdFor(s, pick(1, c.setLift + c.captureWindow * 0.5, 0.4), 2)
    expect(c.lift).toBeGreaterThan(0)
  })
})
