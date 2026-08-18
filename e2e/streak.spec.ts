/**
 * The Lock streak's blitz in a real browser — D-205.
 *
 * The unit suite proves the scoring and the deal; what only a browser can prove is the glue:
 * that starting a run lands on the real pick screen with the countdown in the header, that an
 * open scores its tier and deals the next lock the same frame, that R skips, that the clock
 * running out banks the run and takes the summary screen, and that a dealt lock leaves no
 * fingerprints in the bench's records.
 */

import { expect, test, type Page } from '@playwright/test'
import { advanceSeconds, bootGame, captureStage, renderOnce, setManual } from './harness'

async function streakState(page: Page): Promise<{
  live: boolean
  left: number
  score: number
  opens: number
  best: { score: number; opens: number } | null
}> {
  return page.evaluate(() => globalThis.__shearline!.streakState())
}

test('a run scores by tier, deals instantly, and banks when the clock runs out', async ({
  page,
}) => {
  test.slow()
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)

  await page.evaluate(() => globalThis.__shearline!.goto('streak'))
  await page.evaluate(() => globalThis.__shearline!.renderOnce())
  const audit = await page.evaluate(() => globalThis.__shearline!.auditScreen())
  const collisions = audit.findings.filter((f) =>
    ['overlap', 'text-over-control', 'crowded-text', 'off-stage'].includes(f.kind),
  )
  expect(collisions.map((f) => f.detail)).toEqual([])
  expect((await streakState(page)).live).toBe(false)

  // Deal from known seeds inside a real run: a tier-1 open scores 1, a tier-2 open scores 2.
  await page.evaluate(() => globalThis.__shearline!.startStreakLock(4242, 1))
  expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('pick')
  const s0 = await streakState(page)
  expect(s0.live).toBe(true)
  expect(s0.left).toBeGreaterThan(295)
  expect(s0.score).toBe(0)

  expect(await page.evaluate(() => globalThis.__shearline!.solveCurrentLock())).toBe(true)
  await renderOnce(page)
  // The next lock is already on the bench — no tally between, the dungeon's own rhythm.
  expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('pick')
  const s1 = await streakState(page)
  expect(s1.score).toBe(1)
  expect(s1.opens).toBe(1)

  // Force the next deal to a known tier-2 and open it: +2.
  await page.evaluate(() => globalThis.__shearline!.startStreakLock(4243, 2))
  expect(await page.evaluate(() => globalThis.__shearline!.solveCurrentLock())).toBe(true)
  await renderOnce(page)
  const s2 = await streakState(page)
  expect(s2.score).toBe(3)
  expect(s2.opens).toBe(2)

  // R skips: a fresh lock, no score change, the clock still burning.
  const slugBefore = (await page.evaluate(() => globalThis.__shearline!.getState())).lock.slug
  await page.keyboard.press('KeyR')
  await renderOnce(page)
  const slugAfter = (await page.evaluate(() => globalThis.__shearline!.getState())).lock.slug
  expect(slugAfter).not.toBe(slugBefore)
  expect((await streakState(page)).score).toBe(3)

  // Burn the clock out by hand (the dungeon's own determinism trick) — the run banks and the
  // summary takes the screen.
  await page.evaluate(() => globalThis.__shearline!.streakAdvance(301))
  await renderOnce(page)
  expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('streak')
  const done = await streakState(page)
  expect(done.live).toBe(false)
  expect(done.score).toBe(3)
  expect(done.best).toEqual({ score: 3, opens: 2 })

  // A dealt lock leaves no fingerprints: no record, no play-day, no achievement road.
  const save = await page.evaluate(() => globalThis.__shearline!.getSave())
  expect(Object.keys(save.records).filter((slug) => slug.startsWith('streak-'))).toEqual([])
  await renderOnce(page)
  await captureStage(page, 'streak-tally')
  watcher.assertClean()
})

test('walking out through the pause panel abandons the run — nothing banks', async ({ page }) => {
  test.slow()
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)

  await page.evaluate(() => globalThis.__shearline!.startStreakLock(1111, 1))
  expect(await page.evaluate(() => globalThis.__shearline!.solveCurrentLock())).toBe(true)
  await renderOnce(page)
  expect((await streakState(page)).score).toBe(1)

  // Esc pauses (the clock freezes with the sim); the panel's last button ends the run.
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('pause')
  const frozen = (await streakState(page)).left
  await advanceSeconds(page, 3)
  expect((await streakState(page)).left).toBeCloseTo(frozen, 1)
  /**
   * The blitz pause panel, in logical coordinates: 420×380 centred (x 750, y 350), buttons at
   * x+40 from y+110 on a 66 pitch — Resume, Help, Settings (no restart in this mode), then
   * `End the run` at y 658. Derived from `drawPause`, not guessed; if that panel moves, this
   * line is the loud failure that says so.
   */
  await page.evaluate(() => globalThis.__shearline!.clickAt(960, 684))

  expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('streak')
  const after = await streakState(page)
  expect(after.live).toBe(false)
  // Abandoned: the 1-point run never reached the board.
  expect(after.best).toBeNull()
  watcher.assertClean()
})
