import { Session } from './game/session'
import { generateStreakLock } from './game/streak'
import { walkSolver } from './game/solverWalk'
import { solverCanRun } from './game/solverStepper'
import { STARTER_TOOLS, makeConfig } from './sim'
let fail = 0, n = 0
for (let seed = 1; seed <= 15; seed += 1) for (const tier of [1, 2, 3, 4] as const) {
  const def = generateStreakLock(seed * 7919, 1, tier)
  if (!solverCanRun(def)) continue
  const s = new Session(def, 1, makeConfig({ tools: STARTER_TOOLS }), 'solver')
  n += 1
  if (!walkSolver(s, () => {}, { maxSeconds: 180 })) { fail += 1; console.log('FAIL', def.slug, tier) }
}
console.log('streak locks opened', n - fail, 'of', n)
