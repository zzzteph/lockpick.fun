/**
 * PHYSLAB pickability — migration Phase B.
 *
 * The lasting proof that physlab, built from the *real* roster of pin-tumbler `LockDef`s and driven by
 * the `solveLab` auto-picker, actually opens the locks — and a guard on how far that reaches today.
 *
 * The boundary this test draws is deliberate and is the subject of the **Phase C gate**:
 *  - Every all-standard lock, and single-security-pin locks (a lone spool bank, one mushroom row),
 *    open reliably across seeds, and their difficulty proxy (`rounds`) tracks `src/sim`'s `solveLock`
 *    almost exactly — measured feel parity.
 *  - Heavy *stacked* security locks (serrated banks, t-pin/serrated/spool mixes, sidebar sovereigns)
 *    do **not** yet self-open: the auto-picker cannot build and walk a whole stack of false sets, even
 *    though the model now holds them. Closing that gap is real work, weighed at the gate — not asserted
 *    here, so this test stays honest about what physlab can and cannot pick today.
 */

import { describe, expect, it } from 'vitest'

import { ALL_LOCKS } from '../../src/game/locks'
import { PERFECT_TOOLS, type LockDef, type SimConfig } from '../../src/sim'
import { labFromLock, solveLab } from '../../src/physlab/adapter'

const CONFIG: SimConfig = { tools: PERFECT_TOOLS, featherEnabled: true, assist: 'training' }
const pinTumbler = ALL_LOCKS.filter((l) => l.family === 'pin-tumbler')
const isStandard = (l: LockDef): boolean => l.pins.every((p) => p === 'standard')

describe('physlab picks the pin-tumbler roster', () => {
  it('opens every all-standard lock, on every seed', () => {
    const standards = pinTumbler.filter(isStandard)
    expect(standards.length).toBeGreaterThan(0)
    for (const lock of standards) {
      for (const seed of [1, 2, 3, 101]) {
        const { opened } = solveLab(labFromLock(lock, seed, CONFIG))
        expect(opened, `${lock.slug} @${seed}`).toBe(true)
      }
    }
  })

  it('opens every security lock in the roster, on every seed', () => {
    // This assertion used to read `>= 12 of 60` with a note that stacked-security locks were the
    // Phase C question. They are not a question any more: the deadlock was one line in `model.ts`
    // giving `bindAngle` two meanings, so any driver with a groove demanded a false-set-sized plug
    // rotation before it could be captured — which the other pins made impossible. See the field's
    // own comment. With that separated, the same picker opens the whole roster.
    const security = pinTumbler.filter((l) => !isStandard(l))
    expect(security.length).toBeGreaterThan(10)
    for (const lock of security) {
      for (const seed of [1, 2, 3, 4, 5]) {
        expect(solveLab(labFromLock(lock, seed, CONFIG)).opened, `${lock.slug} @${seed}`).toBe(true)
      }
    }
  })

  it('works each chamber about once — no lock needs pathological rework', () => {
    // `rounds` counts how many times the picker committed to a chamber. One pass per pin is what a
    // clean solve looks like; a lock that needed three times its pin count would be one the geometry
    // is fighting rather than teaching. (It is a coarse proxy — it tracks pin count closely — so it
    // is asserted as a ceiling, not as a difficulty curve.)
    for (const lock of pinTumbler) {
      const { rounds, opened } = solveLab(labFromLock(lock, 3, CONFIG))
      expect(opened, lock.slug).toBe(true)
      expect(rounds, `${lock.slug} rounds`).toBeLessThanOrEqual(lock.pins.length * 2)
    }
  })

  it('is deterministic — a lock and seed open (or not) identically every run', () => {
    const lock = pinTumbler.find(isStandard)!
    const a = solveLab(labFromLock(lock, 55, CONFIG))
    const b = solveLab(labFromLock(lock, 55, CONFIG))
    expect(a.opened).toBe(b.opened)
    expect(a.rounds).toBe(b.rounds)
  })
})
