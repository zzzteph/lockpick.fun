/**
 * The Steam Deck handshake — D-200.
 *
 * Two claims only a browser can prove. One: `?deck=1` really swaps the pick legend to
 * controller names, on a screen that still audits clean — the caps got wider (`L1 R1`,
 * `START`) and the legend column self-measures, which is exactly the kind of promise that
 * needs a picture. Two: the bumper pair actually steps the pressure dial — W and E move the
 * printed step by whole steps, clamp at the ends, and do nothing off the pick screen, where
 * W is a dungeon walking key.
 */

import { expect, test } from '@playwright/test'
import { bootGame, captureStage, loadLock, renderOnce, setManual, stepTicks } from './harness'

test('?deck=1 swaps the legend to controller names, and the screen audits clean', async ({
  page,
}) => {
  const watcher = await bootGame(page, { frames: 3, path: '/?deck=1' })
  expect((await page.evaluate(() => globalThis.__shearline!.layoutState())).deck).toBe(true)

  await setManual(page, true)
  await loadLock(page, 22, 5)
  await stepTicks(page, 30)
  await renderOnce(page)

  const audit = await page.evaluate(() => globalThis.__shearline!.auditScreen())
  const collisions = audit.findings.filter((f) =>
    ['overlap', 'text-over-control', 'crowded-text', 'off-stage'].includes(f.kind),
  )
  expect(collisions.map((f) => f.detail)).toEqual([])
  await captureStage(page, 'deck-pick-legend')
  watcher.assertClean()
})

test('without the flag nothing changes', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  expect((await page.evaluate(() => globalThis.__shearline!.layoutState())).deck).toBe(false)
  watcher.assertClean()
})

test('the lessons speak the deck voice under the flag, and the keyboard voice without', async ({
  page,
}) => {
  // The D-201 glue: the copy lives in tutorial.ts and the voice is chosen in app.ts, and
  // "present, tested, and does nothing" lives exactly in a seam like that.
  const watcher = await bootGame(page, { frames: 3, path: '/?deck=1' })
  await setManual(page, true)
  await page.evaluate(() => globalThis.__shearline!.startLesson('lesson-1'))
  await renderOnce(page)
  const deckLine = (await page.evaluate(() => globalThis.__shearline!.lessonState()))?.line ?? ''
  expect(deckLine).toContain('R2')
  expect(deckLine).not.toMatch(/\bQ\b/)
  watcher.assertClean()
})

test('the menu carries the version, bottom right', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await page.evaluate(() => globalThis.__shearline!.goto('menu'))
  await renderOnce(page)
  // The audit polices the layout the stamp joined; the capture is for the eyes that check
  // the words — a canvas assertion cannot read type, and pretending otherwise is worse.
  const audit = await page.evaluate(() => globalThis.__shearline!.auditScreen())
  const collisions = audit.findings.filter((f) =>
    ['overlap', 'text-over-control', 'crowded-text', 'off-stage'].includes(f.kind),
  )
  expect(collisions.map((f) => f.detail)).toEqual([])
  await captureStage(page, 'menu-version-stamp')
  watcher.assertClean()
})

test('E and W step the pressure dial by whole steps, clamped, pick screen only', async ({
  page,
}) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)

  // Off the pick screen the pair is inert — W walks the dungeon, and a stride must not
  // quietly wind the wrench (the gate this asserts is `playing`, not the crawl specifically).
  const step = async (): Promise<number> =>
    (await page.evaluate(() => globalThis.__shearline!.getWrench())).printedStep
  await page.evaluate(() => globalThis.__shearline!.goto('menu'))
  await renderOnce(page)
  const onMenu = await step()
  await page.keyboard.press('KeyE')
  await renderOnce(page)
  expect(await step()).toBe(onMenu)

  await loadLock(page, 22, 5)
  await stepTicks(page, 5)
  await renderOnce(page)
  expect(await step()).toBe(5) // the default level sits on step 5

  await page.keyboard.press('KeyE')
  await renderOnce(page)
  expect(await step()).toBe(6)
  await page.keyboard.press('KeyW')
  await page.keyboard.press('KeyW')
  await renderOnce(page)
  expect(await step()).toBe(4)

  // The ends are walls, not wrap-arounds: easing off past 1 stays at 1, leaning past 10 stays.
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('KeyW')
  await renderOnce(page)
  expect(await step()).toBe(1)
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('KeyE')
  await renderOnce(page)
  expect(await step()).toBe(10)
  watcher.assertClean()
})
