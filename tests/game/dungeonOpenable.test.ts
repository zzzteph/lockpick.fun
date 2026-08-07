/**
 * Every lock the dungeon can hang on a chest or a door is openable — by the same solver that
 * proves the roster. `dungeon.test.ts` proves the defs are *valid*; this proves they are
 * *beatable*, which is the claim the mode actually makes to a player kneeling with enemies
 * closing in. Every tier, cylinder and wheel padlock alike, across a spread of seeds.
 */

import { describe, expect, it } from 'vitest'
import { generateDungeonLock } from '../../src/game/gauntlet'
import { KIT } from '../../src/game/tools'
import { makeConfig } from '../../src/sim'
import { solveLock } from '../../src/sim/solver'

const SEEDS = [1, 88141, 31337, 55441, 271828, 314159, 999331, 606060]

describe('dungeon locks are beatable', () => {
  for (const tier of [1, 2, 3, 4] as const) {
    for (const wheel of [false, true]) {
      it(`tier ${tier} ${wheel ? 'wheel padlocks' : 'cylinders'}: the solver opens every seed`, () => {
        for (const seed of SEEDS) {
          const def = generateDungeonLock(seed, tier * 11 + (wheel ? 3 : 0), tier, wheel)
          const config = makeConfig({
            tools: KIT,
            // The deeper tiers deal pins that want the wrench eased right off; feathering is
            // part of beating them, exactly as on the roster's Tier 3+ (D-165's lesson).
            featherEnabled: tier >= 3,
          })
          const r = solveLock(def, ((seed + tier * 7919) >>> 0) || 1, config, { maxSeconds: 150 })
          expect(
            r.opened,
            `seed ${seed} tier ${tier} ${def.family} (${def.slug}) — ${r.failure ?? 'gave up'}`,
          ).toBe(true)
        }
      })
    }
  }
})
