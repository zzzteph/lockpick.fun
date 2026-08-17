/**
 * The Streak in a real browser — D-199.
 *
 * The unit suite proves the chain arithmetic and the deal; what only a browser can prove is the
 * glue: that a deal lands on the real pick screen, that the real open pipeline feeds the chain
 * and lands on the tally, that walking away through the real pause panel breaks it, and that a
 * dealt lock leaves no fingerprints in the bench's records. The "present, tested, and does
 * nothing" failure this project keeps having (START-HERE.md) lives exactly in glue like this.
 */

import { expect, test, type Page } from '@playwright/test'
import { advanceSeconds, bootGame, captureStage, setManual } from './harness'

type Chain = { rank: number; count: number } | null

async function streakState(page: Page): Promise<{
  live: boolean
  current: Chain
  best: Chain
}> {
  return page.evaluate(() => globalThis.__shearline!.streakState())
}

test('a deal opens on the pick screen; the open grows the chain and lands on the tally', async ({
  page,
}) => {
  test.slow()
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)

  await page.evaluate(() => globalThis.__shearline!.goto('streak'))
  await page.evaluate(() => globalThis.__shearline!.renderOnce())
  // The tally, fresh: no chain standing, nothing captured, and the screen audits clean.
  const audit = await page.evaluate(() => globalThis.__shearline!.auditScreen())
  const collisions = audit.findings.filter((f) =>
    ['overlap', 'text-over-control', 'crowded-text', 'off-stage'].includes(f.kind),
  )
  expect(collisions.map((f) => f.detail)).toEqual([])
  expect(await streakState(page)).toEqual({ live: false, current: null, best: null })

  // Deal from a known seed. The lock is a real pick-screen lock wearing the mode's slug.
  await page.evaluate(() => globalThis.__shearline!.startStreakLock(4242, 1))
  expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('pick')
  const state = await page.evaluate(() => globalThis.__shearline!.getState())
  expect(state.lock.slug.startsWith('streak-')).toBe(true)
  expect((await streakState(page)).live).toBe(true)

  // The solver's hands open it; the payoff runs and settles; the tally takes over.
  expect(await page.evaluate(() => globalThis.__shearline!.solveCurrentLock())).toBe(true)
  await advanceSeconds(page, 8)
  expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('streak')
  const after = await streakState(page)
  expect(after.live).toBe(false)
  expect(after.current?.count).toBe(1)
  // The break has not happened, so nothing is captured yet — that is the mode's ceremony.
  expect(after.best).toBeNull()

  // A second open grows the same chain rather than starting another.
  await page.evaluate(() => globalThis.__shearline!.startStreakLock(4243, 1))
  expect(await page.evaluate(() => globalThis.__shearline!.solveCurrentLock())).toBe(true)
  await advanceSeconds(page, 8)
  const grown = await streakState(page)
  expect(grown.current?.count).toBe(2)
  // The chain wears its worst letter: two opens can never wear a better rank than either.
  expect(grown.current!.rank).toBeGreaterThanOrEqual(after.current!.rank)

  // A dealt lock leaves no fingerprints: no record, no play-day, no achievement road.
  const save = await page.evaluate(() => globalThis.__shearline!.getSave())
  expect(Object.keys(save.records).filter((slug) => slug.startsWith('streak-'))).toEqual([])
  await captureStage(page, 'streak-tally')
  watcher.assertClean()
})

test('walking away through the pause panel breaks the chain and captures the best', async ({
  page,
}) => {
  test.slow()
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)

  // One open on the chain…
  await page.evaluate(() => globalThis.__shearline!.startStreakLock(1111, 1))
  expect(await page.evaluate(() => globalThis.__shearline!.solveCurrentLock())).toBe(true)
  await advanceSeconds(page, 8)
  expect((await streakState(page)).current?.count).toBe(1)

  // …then a walk-away on the next deal. Esc pauses; the panel's last button names the price.
  await page.evaluate(() => globalThis.__shearline!.startStreakLock(1112, 1))
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('pause')
  /**
   * The Streak pause panel, in logical coordinates: 420×380 centred (x 750, y 350), buttons at
   * x+40 from y+110 on a 66 pitch — Resume, Help, Settings (no restart in this mode), then
   * `Break the chain` at y 658. Derived from `drawPause`, not guessed; if that panel moves,
   * this line is the loud failure that says so.
   */
  await page.evaluate(() => globalThis.__shearline!.clickAt(960, 684))

  expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('streak')
  const broken = await streakState(page)
  expect(broken.live).toBe(false)
  expect(broken.current).toBeNull()
  expect(broken.best?.count).toBe(1)

  // R is not a verb here: a fresh deal cannot be restarted into a fresh clock.
  await page.evaluate(() => globalThis.__shearline!.startStreakLock(1113, 1))
  const seedBefore = (await page.evaluate(() => globalThis.__shearline!.getState())).seed
  await page.keyboard.press('KeyR')
  await page.evaluate(() => globalThis.__shearline!.renderOnce())
  const seedAfter = (await page.evaluate(() => globalThis.__shearline!.getState())).seed
  expect(seedAfter).toBe(seedBefore)
  expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('pick')
  watcher.assertClean()
})
