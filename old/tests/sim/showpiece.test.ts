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
import type { LockDef } from '../../src/sim'

function lock(slug: string): LockDef {
  const def = lockBySlug(slug)
  if (!def) throw new Error(`no lock ${slug}`)
  return def
}

describe('the showpieces that survived the cut', () => {
  it('each still has a mechanism the rest of the roster does not have', () => {
    // The *Vantage Protec Disc* stood here too — eleven discs and thirty-three false gates, the
    // hardest single lock in the game. It went with the family in D-104; its data survives as
    // `PROTEC_FIXTURE` in `highsecurity.test.ts`, which is where its mechanism is now asserted.
    expect(lock('halberd-sovereign').keyway).toBe('tight')
  })

  it('and the deferred lock still says why it was cut, in code rather than in a document', () => {
    expect(DEFERRED_LOCKS.length).toBeGreaterThan(0)
    expect(DEFERRED_LOCKS[0]?.reason).toMatch(/CUT/)
    expect(DEFERRED_LOCKS[0]?.reason.length).toBeGreaterThan(80)
  })

  // 'opens every one across 50 seeds' ran the rate sim on the Sovereign, a pin lock — it runs on
  // the contact solver since D-233 and is opened by the walk in tests/game/solverSession.test.ts.
})

/**
 * The interactive dimple (#33) and the Bramah slider (#35) left the roster with D-088, which
 * kept cylinders and disc detainers only. Their tests went with them; the *mechanisms* are
 * untouched in `src/sim/` and would come straight back with a lock that used them.
 */

/**
 * The magnetic element's rate-sim tests (#34, D-066) went with D-233: the Magnetic Hybrid was cut
 * (D-232) and the rate sim no longer steps pin locks. The solver's magnet (`magnetHold`) stays in
 * the engine for a lock that uses it.
 */
