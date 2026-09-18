import { Session } from './game/session'
import { generateStreakLock } from './game/streak'
import { walkSolver } from './game/solverWalk'
import { STARTER_TOOLS, makeConfig } from './sim'
for (const [seed, n] of [[1, 2], [2, 3], [3, 4]] as const) {
  const def = generateStreakLock(seed, n, 1)
  const s = new Session(def, 1, makeConfig({ tools: STARTER_TOOLS }), 'solver')
  const ok = walkSolver(s, () => {}, { maxSeconds: 180 })
  const eng = s.engine!
  console.log(def.slug, def.bitting.join('/'), def.toleranceQuality, ok, s.state.chambers.map((c) => c.state).join(','), s.state.chambers.map((_, i) => eng.footAboveRim(i).toFixed(2)).join(' '))
}
