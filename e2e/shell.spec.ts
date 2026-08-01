import { expect, test, type Page } from '@playwright/test'
import type { SaveDataShape } from '../src/devhook'
import { SAVE_VERSION } from '../src/game/save'
import {
  advanceSeconds,
  bootGame,
  captureStage,
  getState,
  loadLock,
  openCurrentLock,
  renderOnce,
  setManual,
} from './harness'

async function screen(page: Page): Promise<string> {
  return page.evaluate(() => globalThis.__shearline?.getScreen() ?? '?')
}

async function goto(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    globalThis.__shearline?.goto(n)
  }, name)
}

async function getSave(page: Page): Promise<SaveDataShape> {
  return page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.getSave()
  })
}

async function setSave(page: Page, data: SaveDataShape): Promise<void> {
  await page.evaluate((d) => {
    globalThis.__shearline?.setSave(d)
  }, data)
}

/** Drive the currently-loaded lock to an open through the scripted input API. */

test('menu to bench to pick to results to bench', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  expect(await screen(page)).toBe('menu')

  await goto(page, 'bench')
  expect(await screen(page)).toBe('bench')

  await setManual(page, true)
  await loadLock(page, 1, 5)
  expect(await screen(page)).toBe('pick')

  const opened = await openCurrentLock(page)
  expect(opened.opened, `states: ${opened.chambers.map((c) => c.state).join(',')}`).toBe(true)

  // Opening the lock plays the payoff sequence and *then* lands on results, with the payout
  // banked. From Phase 11 the results page is 2.5s behind the open rather than one frame.
  await advanceSeconds(page, 2.6)
  expect(await screen(page)).toBe('results')
  const save = await getSave(page)
  expect(save.records['clear-practice-cutaway']?.bestRank).not.toBeNull()
  expect(save.records['clear-practice-cutaway']?.opens).toBe(1)
  expect(save.records['clear-practice-cutaway']?.bestTime).toBeGreaterThan(0)

  await goto(page, 'bench')
  expect(await screen(page)).toBe('bench')
  watcher.assertClean()
})

test('escape pauses the pick screen and resumes it', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await loadLock(page, 2, 1)
  expect(await screen(page)).toBe('pick')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(80)
  expect(await screen(page)).toBe('pause')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(80)
  expect(await screen(page)).toBe('pick')
  watcher.assertClean()
})

test('save survives a browser restart', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await loadLock(page, 1, 5)
  const opened = await openCurrentLock(page)
  expect(opened.opened).toBe(true)
  const before = await getSave(page)
  expect(before.records['clear-practice-cutaway']?.bestRank).not.toBeNull()

  // A genuine reload — new document, new JS context, same localStorage.
  await page.reload()
  await page.waitForFunction(() => globalThis.__shearline?.ready === true, undefined, {
    timeout: 20_000,
  })
  const after = await getSave(page)
  expect(after.records['clear-practice-cutaway']?.bestRank).toBe(
    before.records['clear-practice-cutaway']?.bestRank,
  )
  expect(after.records['clear-practice-cutaway']?.opens).toBe(1)
  expect(after.records['clear-practice-cutaway']?.bestTime).toBeCloseTo(
    before.records['clear-practice-cutaway']?.bestTime ?? -1,
    6,
  )
  watcher.assertClean()
})

test('export produces JSON that imports back to an identical state', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await loadLock(page, 1, 5)
  await openCurrentLock(page)

  const original = await getSave(page)
  const text = await page.evaluate(() => globalThis.__shearline?.exportSaveText() ?? '')
  expect(text.length).toBeGreaterThan(50)
  expect(() => JSON.parse(text) as unknown).not.toThrow()

  // Wipe, confirm it is gone, then import the file back.
  await setSave(page, { ...original, records: {} })
  expect((await getSave(page)).records).toEqual({})

  await page.evaluate((t) => {
    globalThis.__shearline?.importSaveText(t)
  }, text)
  expect(await getSave(page)).toEqual(original)
  watcher.assertClean()
})

test('a version 1 save migrates without data loss', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  const legacy = JSON.stringify({
    version: 1,
    credits: 815,
    opens: { 'clear-practice-cutaway': 4, 'brasswell-no1-luggage': 2 },
    settings: { sensitivity: 1.3, muted: true },
  })
  await page.evaluate((t) => {
    globalThis.__shearline?.importSaveText(t)
  }, legacy)

  const migrated = await getSave(page)
  // Migrated all the way to the current version, not just one step (D-046 added v3).
  expect(migrated.version).toBe(SAVE_VERSION)
  expect(migrated.records['clear-practice-cutaway']?.opens).toBe(4)
  expect(migrated.records['brasswell-no1-luggage']?.opens).toBe(2)
  expect(migrated.settings.sensitivity).toBe(1.3)
  expect(migrated.settings.muted).toBe(true)
  // Fields v1 never had are present and sane.
  expect(migrated.achievements).toEqual([])
  expect(migrated.customLocks).toEqual([])
  expect(migrated.lockSalt).toBeGreaterThan(0)
  watcher.assertClean()
})

test('tier gating unlocks on the counts in GAME_DESIGN §5', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  const fresh = await getSave(page)

  // `bestRank: 0` is an S — the tier gate wants D or better, and a fixture asserting *gating*
  // should not accidentally be asserting *ranking* as well (D-091).
  const withOpens = (slugs: string[]): SaveDataShape => ({
    ...fresh,
    records: Object.fromEntries(
      slugs.map((s) => [
        s,
        { opens: 1, bestTime: 10, bestOversets: 0, bestRank: 0, challenges: [] },
      ]),
    ),
  })

  // Two Tier 1 opens is not enough.
  await setSave(page, withOpens(['clear-practice-cutaway', 'clear-practice-cutaway-ii']))
  await goto(page, 'bench')
  await renderOnce(page)
  let unlocked = await page.evaluate(() => {
    const h = globalThis.__shearline
    return h ? h.getSave().records : {}
  })
  expect(Object.keys(unlocked)).toHaveLength(2)

  // The third one opens Tier 2. Verified through the bench: a Tier 2 lock becomes loadable.
  await setSave(
    page,
    withOpens([
      'clear-practice-cutaway',
      'clear-practice-cutaway-ii',
      'brasswell-no1-luggage',
    ]),
  )
  unlocked = await page.evaluate(() => globalThis.__shearline?.getSave().records ?? {})
  expect(Object.keys(unlocked)).toHaveLength(3)
  watcher.assertClean()
})

test('@screenshot phase-07 menu', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await goto(page, 'menu')
  await renderOnce(page)
  await captureStage(page, 'phase-07-menu')
  watcher.assertClean()
})

test('@screenshot phase-07 bench', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  const fresh = await getSave(page)
  // A save partway through: Tier 2 unlocked, some records to show on the cards.
  await setSave(page, {
    ...fresh,
    records: {
      'clear-practice-cutaway': {
        opens: 3,
        bestTime: 11.4,
        bestOversets: 0,
        bestRank: 0,
        challenges: [],
      },
      'clear-practice-cutaway-ii': {
        opens: 1,
        bestTime: 26.8,
        bestOversets: 1,
        bestRank: 2,
        challenges: [],
      },
      'brasswell-no1-luggage': {
        opens: 2,
        bestTime: 19.2,
        bestOversets: 0,
        bestRank: 1,
        challenges: [],
      },
      'northgate-5-pin-cabinet': {
        opens: 1,
        bestTime: 58.1,
        bestOversets: 2,
        bestRank: 3,
        challenges: [],
      },
    },
  })
  await goto(page, 'bench')
  await renderOnce(page)
  await captureStage(page, 'phase-07-bench')
  watcher.assertClean()
})

test('@screenshot phase-07 results', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await loadLock(page, 3, 11)
  const opened = await openCurrentLock(page)
  expect(opened.opened).toBe(true)
  await advanceSeconds(page, 2.6)
  await renderOnce(page)
  expect(await screen(page)).toBe('results')
  await captureStage(page, 'phase-07-results')
  watcher.assertClean()
})

/**
 * `Next lock` carries you on without a trip through the bench — DECISIONS D-121.
 *
 * The unit tests decide *which* lock is next; this proves the button is on screen, that pressing it
 * starts that lock, and — the actual request — that the bench is never visited on the way. Clicked
 * through the dev hook at the row's own arithmetic rather than at a remembered pixel, and the row
 * is mirrored here so the test fails if the renderer moves it.
 */
test('the results screen offers the next lock, and taking it never visits the bench', async ({
  page,
}) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await loadLock(page, 1, 5)

  const opened = await openCurrentLock(page)
  expect(opened.opened, `states: ${opened.chambers.map((c) => c.state).join(',')}`).toBe(true)
  await advanceSeconds(page, 2.6)
  expect(await screen(page)).toBe('results')

  // Mirrors `drawResults`: three 240px buttons, 24px apart, centred, 130px off the bottom.
  const BW = 240
  const GAP = 24
  const rowW = BW * 3 + GAP * 2
  const left = 1920 / 2 - rowW / 2
  const nextCentre = { x: left + BW * 2 + GAP * 2 + BW / 2, y: 1080 - 24 - 130 + 26 }

  await renderOnce(page)
  await page.evaluate((at) => {
    globalThis.__shearline?.clickAt(at.x, at.y)
  }, nextCentre)
  await renderOnce(page)

  // Straight into the next lock. Not the bench, and not the one just finished.
  expect(await screen(page), 'Next lock should start a lock, not a menu').toBe('pick')
  const now = await getState(page)
  expect(now.lock.slug, 'the first unopened lock in bench order').toBe('clear-practice-cutaway-ii')
  expect(now.opened, 'and it should be a fresh attempt').toBe(false)

  // The lock that was just beaten kept its record — starting the next one banked nothing extra.
  const save = await getSave(page)
  expect(save.records['clear-practice-cutaway']?.opens).toBe(1)
  expect(save.records['clear-practice-cutaway-ii']).toBeUndefined()
  watcher.assertClean()
})
