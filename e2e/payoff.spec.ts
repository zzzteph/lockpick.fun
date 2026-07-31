import { expect, test, type Page } from '@playwright/test'
import type { SaveDataShape } from '../src/devhook'
import {
  advanceSeconds,
  bootGame,
  captureStage,
  earnedThisAttempt,
  getState,
  loadLock,
  openSequence,
  renderOnce,
  setInput,
  setManual,
  setReducedMotion,
  skipOpenSequence,
  stepTicks,
} from './harness'

const PRACTICE = 1
const FIVE_PIN = 9

async function setSave(page: Page, patch: Partial<SaveDataShape>): Promise<void> {
  const current = await page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.getSave()
  })
  await page.evaluate((d) => {
    globalThis.__shearline?.setSave(d)
  }, { ...current, ...patch })
}

/** Open the current lock by working each binding chamber in turn. */
async function openIt(page: Page, tension = 0.45): Promise<void> {
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: tension })
  await stepTicks(page, 60)
  for (let i = 0; i < 40; i += 1) {
    const state = await getState(page)
    if (state.opened) return
    const b = state.bindingChamber
    const c = b >= 0 ? state.chambers[b] : state.chambers.find((x) => x.state === 'FALSE_SET')
    if (!c) {
      await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.6 })
      await stepTicks(page, 120)
      continue
    }
    await setInput(page, {
      chamber: c.index,
      liftTarget: c.profile === 'wafer' ? c.setLift : c.setLift + c.captureWindow * 0.5,
      tensionHeld: true,
      tensionLevel: tension,
    })
    await stepTicks(page, 240)
  }
}

/** Advance the *sequence* by real frames. `stepTicks` drives the sim; this drives the clock. */
async function advanceSequence(page: Page, seconds: number): Promise<void> {
  await advanceSeconds(page, seconds)
}

test('the open sequence runs its beats and lands on the results page', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await loadLock(page, PRACTICE, 3)
  await openIt(page)

  const opened = await getState(page)
  expect(opened.opened).toBe(true)

  const started = await openSequence(page)
  expect(started.running).toBe(true)
  expect(started.beat).toBe('accelerate')
  expect(started.duration).toBeGreaterThanOrEqual(2.5)
  // The results page must not have stolen the screen the instant the lock opened.
  expect(await page.evaluate(() => globalThis.__shearline?.getScreen())).toBe('pick')

  await advanceSequence(page, 0.4)
  const early = await openSequence(page)
  expect(['accelerate', 'impact', 'dilate']).toContain(early.beat)
  expect(early.canSkip, 'nothing is skippable before 0.5s').toBe(false)

  await advanceSequence(page, 1.1)
  const counting = await openSequence(page)
  expect(counting.canSkip).toBe(true)
  expect(counting.creditsShown).toBeGreaterThan(0)
  expect(counting.creditsShown).toBeLessThanOrEqual(1)

  await advanceSequence(page, 1.4)
  const done = await openSequence(page)
  expect(done.settled).toBe(true)
  // The reveal runs 0 → 1; `credits` on the hook is the rank index the letter lands on (D-091).
  expect(done.creditsShown).toBe(1)
  expect(done.credits).toBeGreaterThanOrEqual(0)
  expect(await page.evaluate(() => globalThis.__shearline?.getScreen())).toBe('results')
  watcher.assertClean()
})

test('the sequence skips cleanly at any point after 0.5s', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)

  for (const at of [0.55, 1.0, 1.9, 2.3]) {
    await loadLock(page, PRACTICE, 4)
    await openIt(page)
    await advanceSequence(page, at)

    const before = await openSequence(page)
    expect(before.canSkip, `at ${at}s`).toBe(true)
    expect(await skipOpenSequence(page), `at ${at}s`).toBe(true)

    const after = await openSequence(page)
    expect(after.settled, `at ${at}s`).toBe(true)
    expect(after.skipped, `at ${at}s`).toBe(true)
    // Every skip lands on the same state: the rank fully revealed, every card in place.
    expect(after.creditsShown, `at ${at}s`).toBe(1)
    expect(after.cardsVisible, `at ${at}s`).toBe(after.cardCount)

    await advanceSequence(page, 0.1)
    expect(await page.evaluate(() => globalThis.__shearline?.getScreen()), `at ${at}s`).toBe(
      'results',
    )
  }
  watcher.assertClean()
})

test('a keypress before 0.5s does nothing at all', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await loadLock(page, PRACTICE, 5)
  await openIt(page)

  await advanceSequence(page, 0.2)
  await page.keyboard.press('Space')
  await advanceSequence(page, 0.05)
  const seq = await openSequence(page)
  expect(seq.skipped).toBe(false)
  expect(seq.settled).toBe(false)
  expect(await page.evaluate(() => globalThis.__shearline?.getScreen())).toBe('pick')
  watcher.assertClean()
})

test('achievements fire off the attempt and stack as cards', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await loadLock(page, PRACTICE, 6)
  await openIt(page)

  const earned = await earnedThisAttempt(page)
  // A first open beats par comfortably on the practice lock, so several land at once.
  expect(earned).toContain('first-blood')
  expect(earned.length).toBeGreaterThan(1)

  const seq = await openSequence(page)
  expect(seq.cardCount).toBe(earned.length)

  await advanceSequence(page, 1.85)
  expect((await openSequence(page)).cardsVisible).toBeGreaterThanOrEqual(1)
  await advanceSequence(page, 1.2)
  const settled = await openSequence(page)
  expect(settled.cardsVisible, 'every card lands before the sequence settles').toBe(
    settled.cardCount,
  )

  // And they persist: the trophy case knows about them on the next boot.
  const save = await page.evaluate(() => globalThis.__shearline?.getSave())
  expect(save?.achievements).toEqual(expect.arrayContaining(earned))
  watcher.assertClean()
})

test('the sequence still reads correctly with reduced motion on', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await setReducedMotion(page, true)
  await loadLock(page, PRACTICE, 7)
  await openIt(page)

  const seq = await openSequence(page)
  expect(seq.reducedMotion).toBe(true)

  await advanceSequence(page, 2.6)
  const done = await openSequence(page)
  // The information survives in full: same length, same payout counted out, same cards.
  expect(done.settled).toBe(true)
  // The reveal runs 0 → 1; `credits` on the hook is the rank index the letter lands on (D-091).
  expect(done.creditsShown).toBe(1)
  expect(done.credits).toBeGreaterThanOrEqual(0)
  expect(done.cardsVisible).toBe(done.cardCount)
  watcher.assertClean()
})

test('@screenshot phase-11 the open sequence mid-count', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  // Five chambers is one more than the starter hook reaches, so equip one that does — or the
  // shot is of a lock that never opened, and the pixel check alone would not notice.
  const save = await page.evaluate(() => globalThis.__shearline?.getSave())
  if (save) {
    await page.evaluate((d) => {
      globalThis.__shearline?.setSave(d)
    }, { ...save })
  }
  await loadLock(page, FIVE_PIN, 3)
  await openIt(page, 0.42)
  expect((await getState(page)).opened, 'the shot must be of an open lock').toBe(true)

  // 1.9s in: the payout is on screen and the first cards are sliding.
  await advanceSequence(page, 1.95)
  const seq = await openSequence(page)
  expect(seq.creditsShown).toBeGreaterThan(0)
  await renderOnce(page)
  await captureStage(page, 'phase-11-open-sequence')
  watcher.assertClean()
})

test('@screenshot phase-11 trophy room', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  // A case part-filled reads better than an empty or a complete one: it shows both states.
  await setSave(page, {
    achievements: [
      'first-blood',
      'apprentice',
      'under-par',
      'half-par',
      'light-hand',
      'not-fooled',
      'wafer-thin',
      'single-pin-purist',
      'well-equipped',
      'surgeon',
      'feather-touch',
      'expert-hands',
    ],
  })
  await page.evaluate(() => {
    globalThis.__shearline?.goto('trophies')
  })
  await renderOnce(page)
  await captureStage(page, 'phase-11-trophy-room')
  watcher.assertClean()
})
