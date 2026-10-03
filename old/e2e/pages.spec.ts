/**
 * The screens that had no picture of them — DECISIONS D-099.
 *
 * D-097 was found by *looking at* two PNGs after a fully green test run had found nothing, because
 * no assertion in the suite can see two strings drawn on top of each other. Settings, pause and the
 * codes page had never been captured at all, so a type-scale change could wreck them silently and
 * did. These write the PNGs; `captureStage` asserts each page has real ink on it, and the rest is
 * for human eyes.
 */

import { expect, test, type Page } from '@playwright/test'
import type { SaveDataShape } from '../src/devhook'
import { bootGame, captureStage, loadLock, renderOnce } from './harness'

async function goto(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    globalThis.__shearline?.goto(n)
  }, name)
  await renderOnce(page)
}

test('@screenshot the help page', async ({ page }) => {
  const watcher = await bootGame(page)
  await goto(page, 'help')
  expect(await page.evaluate(() => globalThis.__shearline?.getScreen())).toBe('help')
  await captureStage(page, 'page-help')
  watcher.assertClean()
})

test('@screenshot the settings page', async ({ page }) => {
  const watcher = await bootGame(page)
  await goto(page, 'settings')
  expect(await page.evaluate(() => globalThis.__shearline?.getScreen())).toBe('settings')
  await captureStage(page, 'page-settings')
  watcher.assertClean()
})

test('@screenshot the pause overlay', async ({ page }) => {
  const watcher = await bootGame(page)
  await loadLock(page, 2, 11)
  await goto(page, 'pause')
  await captureStage(page, 'page-pause')
  watcher.assertClean()
})

test('@screenshot the codes page, empty', async ({ page }) => {
  const watcher = await bootGame(page)
  await goto(page, 'codes')
  expect(await page.evaluate(() => globalThis.__shearline?.getScreen())).toBe('codes')
  await captureStage(page, 'page-codes-empty')
  watcher.assertClean()
})

test('@screenshot the codes page with designs on it', async ({ page }) => {
  const watcher = await bootGame(page)
  const current = await page.evaluate(() => globalThis.__shearline?.getSave())
  expect(current).toBeDefined()
  if (!current) return
  // Two locks of the player's own, so the top section is not the empty-state line.
  await page.evaluate((d: SaveDataShape) => {
    globalThis.__shearline?.setSave(d)
  }, {
    ...current,
    customLocks: [
      {
        id: 900,
        slug: 'my-first-lock-900',
        name: 'My First Lock',
        tier: 1,
        family: 'pin-tumbler',
        bitting: [3.4, 3.1, 2.8, 2.5, 3.4],
        pins: ['standard', 'spool', 'standard', 'serrated', 'standard'],
        springs: [1, 1, 1.22, 1, 0.8],
        toleranceQuality: 1,
        keyway: 'standard',
        par: 90,
      },
      {
        id: 901,
        slug: 'the-mean-one-901',
        name: 'The Mean One',
        tier: 1,
        family: 'pin-tumbler',
        bitting: [2.2, 3.8, 1.6, 3.4],
        pins: ['spool', 'spool', 't-pin', 'mushroom'],
        springs: [1.22, 1.22, 1, 1],
        toleranceQuality: 0.6,
        keyway: 'tight',
        par: 72,
      },
    ],
  } as SaveDataShape)
  await goto(page, 'codes')
  await captureStage(page, 'page-codes')
  watcher.assertClean()
})

test('@screenshot the editor with a draft in it', async ({ page }) => {
  const watcher = await bootGame(page)
  await goto(page, 'editor')
  await page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    h.editorAction('chambers', 6)
    h.editorAction('pin', 1)
    h.editorAction('pin', 1)
    h.editorAction('spring', 3)
  })
  await renderOnce(page)
  await captureStage(page, 'page-editor')
  watcher.assertClean()
})

/**
 * The editor at `MAX_CHAMBERS` — the case that broke, reported as *"when you add a lot of pins the
 * scroll bar is missing, otherwise everything goes behind the image"* (D-100).
 *
 * Sixteen rows reach y=838. The preview panel used to sit at y=540 and the last eight chambers were
 * drawn straight through it. Nothing here can assert "these do not overlap" — that is what the PNG
 * is for — but the shot exists so the next person to move either one has a picture to check.
 */
test('@screenshot the editor at full chamber count', async ({ page }) => {
  const watcher = await bootGame(page)
  await goto(page, 'editor')
  await page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    h.editorAction('chambers', 16)
  })
  await renderOnce(page)
  await captureStage(page, 'page-editor-full')
  watcher.assertClean()
})
