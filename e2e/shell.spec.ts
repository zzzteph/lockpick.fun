import { expect, test, type Page } from '@playwright/test'
import type { SaveDataShape } from '../src/devhook'
import { SAVE_VERSION } from '../src/game/save'
import {
  advanceSeconds,
  bootGame,
  captureStage,
  getState,
  loadLock,
  renderOnce,
  setInput,
  setManual,
  stepTicks,
  type StateSnapshot,
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
async function openCurrentLock(page: Page, tension = 0.45): Promise<StateSnapshot> {
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: tension })
  await stepTicks(page, 60)
  for (let round = 0; round < 40; round += 1) {
    const state = await getState(page)
    if (state.opened) return state
    const b = state.bindingChamber
    const target = b >= 0 ? state.chambers[b] : state.chambers.find((c) => c.state === 'FALSE_SET')
    if (!target) {
      await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.6 })
      await stepTicks(page, 120)
      continue
    }
    await setInput(page, {
      chamber: target.index,
      liftTarget: target.setLift + target.captureWindow * 0.5,
      tensionHeld: true,
      tensionLevel: tension,
    })
    await stepTicks(page, 240)
  }
  return getState(page)
}

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
