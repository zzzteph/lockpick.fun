/**
 * The lock editor in the browser — DECISIONS D-080.
 *
 * `tests/game/editor.test.ts` proves the data model. This proves the screen: that it draws without
 * throwing, that a lock built on it can actually be picked, and that saving one survives a reload.
 */

import { expect, test, type Page } from '@playwright/test'
import { bootGame, captureStage, getState } from './harness'

async function goto(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    globalThis.__shearline?.goto(n)
  }, name)
  await page.evaluate(() => {
    globalThis.__shearline?.renderOnce()
  })
}

test('the editor screen draws', async ({ page }) => {
  const watcher = await bootGame(page)
  await goto(page, 'editor')
  expect(await page.evaluate(() => globalThis.__shearline?.getScreen())).toBe('editor')
  // `captureStage` carries the blank-canvas rule, so this asserts the screen has real ink on it.
  await captureStage(page, 'editor')
  watcher.assertClean()
})

test('a lock built in the editor can be picked', async ({ page }) => {
  const watcher = await bootGame(page)
  await goto(page, 'editor')

  // Drive the editor's own actions rather than clicking pixels: this is about the lock that comes
  // out the far end, not about where the buttons happen to sit this week.
  await page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    h.editorAction('chambers', 4)
    h.editorAction('pin', 1)
    h.editorAction('spring', 2)
    h.editorAction('test')
  })

  expect(await page.evaluate(() => globalThis.__shearline?.getScreen())).toBe('pick')
  const state = await getState(page)
  expect(state.chambers).toHaveLength(4)
  watcher.assertClean()
})

test('a saved lock survives a reload and can be reopened for editing', async ({ page }) => {
  const watcher = await bootGame(page)
  await goto(page, 'editor')
  await page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    h.editorAction('chambers', 6)
    h.editorAction('save')
  })
  const saved = await page.evaluate(() => globalThis.__shearline?.getSave().customLocks?.length ?? 0)
  expect(saved).toBe(1)

  await page.reload()
  await page.waitForFunction(() => (globalThis.__shearline?.framesRendered ?? 0) > 2)
  const after = await page.evaluate(() => globalThis.__shearline?.getSave().customLocks ?? [])
  expect(after).toHaveLength(1)
  expect(after[0]?.bitting).toHaveLength(6)
  watcher.assertClean()
})
