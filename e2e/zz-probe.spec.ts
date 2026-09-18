import { test } from '@playwright/test'
import { bootGame, setManual } from './harness'
test('probe streak solve', async ({ page }) => {
  test.setTimeout(300_000)
  await bootGame(page, { frames: 3 })
  await setManual(page, true)
  for (const seed of [4242, 1, 2, 3]) {
    await page.evaluate((s) => globalThis.__shearline!.startStreakLock(s, 1), seed)
    const r = await page.evaluate(() => {
      const h = globalThis.__shearline!
      const s0 = h.getState()
      const ok = h.solveCurrentLock()
      const s = h.getState()
      return { side: h.sideFrame() !== null, ok, lock: s0.lock, states: s.chambers.map((c) => `${c.state}/${c.profile}`).join(','), strain: s.pickStrain, time: s.time, tools: h.getToolStats() }
    })
    console.log(seed, JSON.stringify(r))
    await page.evaluate(() => globalThis.__shearline!.goto('menu'))
  }
})
