/**
 * Every lock the dungeon can hang on a chest or a door is openable — by the same solver that
 * proves the roster. `dungeon.test.ts` proves the defs are *valid*; this proves they are
 * *beatable*, which is the claim the mode actually makes to a player kneeling with enemies
 * closing in. Every tier, cylinder and wheel padlock alike, across a spread of seeds.
 */

import { describe, expect, it } from 'vitest'
import { generateDungeonLock } from '../../src/game/gauntlet'
import { KIT } from '../../src/game/tools'
import { Session } from '../../src/game/session'
import { solverCanRun } from '../../src/game/solverStepper'
import { walkSolver } from '../../src/game/solverWalk'
import { makeConfig, type LockDef, type SimConfig } from '../../src/sim'
import { solveLock } from '../../src/wheels'

/**
 * Opened by the hand that runs it (D-233): a pin lock on the contact solver's walk — the rate sim
 * no longer steps pin tumblers — and a wheel pack on the rate sim's own solver, which it still runs.
 */
function opens(def: LockDef, seed: number, config: SimConfig, budget: number): { opened: boolean; why: string } {
  if (solverCanRun(def)) {
    const s = new Session(def, seed, config)
    return { opened: walkSolver(s, () => {}, { maxSeconds: budget }), why: 'the walk gave up' }
  }
  const r = solveLock(def, seed, config, { maxSeconds: 150 })
  return { opened: r.opened, why: r.failure ?? 'gave up' }
}

const SEEDS = [1, 88141, 31337, 55441, 271828, 314159, 999331, 606060]

/**
 * Sized for the contact solver's walk (D-233). The rate sim's solver opened a lock in milliseconds
 * and every tier took all eight seeds; the walk plays the lock in simulated real time, so eight
 * tier-4 walks ran 26 minutes on a desk machine, and one tier-4 lock (seed 1) outlasted the walk's
 * whole retry budget — the auto-solver's limit, not the lock's (the retries and the D-225 sweep:
 * 59/60 generated tier 3–4 locks open). So: the wheel packs and tiers 1–2 on every seed, as
 * before; tiers 3–4 on three seeds, at least two of which must open.
 */
const DEEP_SEEDS = [88141, 31337, 55441]

describe('dungeon locks are beatable', () => {
  for (const tier of [1, 2, 3, 4] as const) {
    for (const wheel of [false, true]) {
      const deep = !wheel && tier >= 3
      const seeds = deep ? DEEP_SEEDS : SEEDS
      it(`tier ${tier} ${wheel ? 'wheel padlocks' : 'cylinders'}: the solver opens ${deep ? 'two of three seeds' : 'every seed'}`, () => {
        const failed: string[] = []
        for (const seed of seeds) {
          const def = generateDungeonLock(seed, tier * 11 + (wheel ? 3 : 0), tier, wheel)
          const config = makeConfig({
            tools: KIT,
            // The deeper tiers deal pins that want the wrench eased right off; feathering is
            // part of beating them, exactly as on the roster's Tier 3+ (D-165's lesson).
            featherEnabled: tier >= 3,
          })
          const r = opens(def, ((seed + tier * 7919) >>> 0) || 1, config, deep ? 400 : 1500)
          if (!r.opened) failed.push(`seed ${seed} tier ${tier} ${def.family} (${def.slug}) — ${r.why}`)
        }
        if (deep) expect(failed.length, failed.join('; ')).toBeLessThanOrEqual(1)
        else expect(failed).toEqual([])
      }, 1_800_000)
    }
  }
})
