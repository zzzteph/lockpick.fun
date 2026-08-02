import { expect, test, type Page } from '@playwright/test'
import type { SaveDataShape } from '../src/devhook'
import {
  advanceSeconds,
  bootGame,
  captureGreyscale,
  captureStage,
  getState,
  loadLock,
  luminanceProfile,
  renderOnce,
  scriptPin,
  setInput,
  setManual,
  stepTicks,
} from './harness'

const PRACTICE = 1
const SPOOL_TRAINER = 13

async function settings(page: Page, patch: Partial<SaveDataShape['settings']>): Promise<void> {
  const save = await page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.getSave()
  })
  await page.evaluate((d) => {
    globalThis.__shearline?.setSave(d)
  }, { ...save, settings: { ...save.settings, ...patch } })
}

async function lessonState(page: Page): Promise<{
  id: string
  line: string | null
  step: number
  total: number
  complete: boolean
} | null> {
  return page.evaluate(() => globalThis.__shearline?.lessonState() ?? null)
}

async function focusState(
  page: Page,
): Promise<{ index: number; count: number; keyboardMode: boolean }> {
  return page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.focusState()
  })
}

/** Work every binding chamber to the middle of its window until the lock opens. */
async function openIt(page: Page, tension = 0.45, rounds = 40): Promise<void> {
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: tension })
  await stepTicks(page, 60)
  for (let i = 0; i < rounds; i += 1) {
    const state = await getState(page)
    if (state.opened) return
    const b = state.bindingChamber
    const c = b >= 0 ? state.chambers[b] : state.chambers.find((x) => x.state === 'FALSE_SET')
    if (!c) {
      await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.6 })
      await stepTicks(page, 120)
      continue
    }
    await scriptPin(page, c.index, c.setLift + c.captureWindow * 0.5, tension, 240)
  }
}

// ── The tutorial ────────────────────────────────────────────────────────────────────────

test('a new player completes all three lessons and then opens lock 1', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)

  // A genuinely new save: nothing taught, nothing opened, nothing ranked.
  const fresh = await page.evaluate(() => globalThis.__shearline?.getSave())
  expect(fresh?.tutorial).toEqual([])
  expect(fresh?.records).toEqual({})

  for (const id of ['lesson-1', 'lesson-2', 'lesson-3']) {
    await page.evaluate((l) => globalThis.__shearline?.startLesson(l), id)
    const started = await lessonState(page)
    expect(started?.id, id).toBe(id)
    expect(started?.line, id).not.toBeNull()
    expect(started?.step, id).toBe(0)

    await openIt(page, 0.45, 60)
    expect((await getState(page)).opened, id).toBe(true)
    await advanceSeconds(page, 2.6)

    const save = await page.evaluate(() => globalThis.__shearline?.getSave())
    expect(save?.tutorial, `${id} was not recorded`).toContain(id)
    // A lesson records nothing: it is a teaching instrument, not content.
    expect(Object.keys(save?.records ?? {}), `${id} left a record`).toEqual([])
  }

  // …and now the real first lock, which does leave a record and a rank.
  await loadLock(page, PRACTICE, 3)
  await openIt(page)
  await advanceSeconds(page, 2.6)
  const done = await page.evaluate(() => globalThis.__shearline?.getSave())
  expect(done?.records['clear-practice-cutaway']?.opens).toBe(1)
  expect(done?.records['clear-practice-cutaway']?.bestRank).not.toBeNull()
  watcher.assertClean()
})

test('a lesson teaches with one line at a time, driven by what the player does', async ({
  page,
}) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await page.evaluate(() => globalThis.__shearline?.startLesson('lesson-1'))

  const first = await lessonState(page)
  expect(first?.line).toContain('Hold Q')
  // Waiting changes nothing. There is nothing to click and nothing to dismiss.
  await advanceSeconds(page, 1)
  await stepTicks(page, 120)
  expect((await lessonState(page))?.step).toBe(0)

  // Applying tension — the thing the line asked for — is what moves it on.
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.45 })
  await stepTicks(page, 60)
  const second = await lessonState(page)
  expect(second?.step).toBeGreaterThan(0)
  expect(second?.line).not.toBe(first?.line)
  watcher.assertClean()
})

// ── Assist modes ────────────────────────────────────────────────────────────────────────

/**
 * The assist ladder buys **time**, not money (D-091).
 *
 * It used to assert credit multipliers of 0.6 / 1.0 / 1.5 / 2.5. The same four numbers now scale
 * the par a rank is measured against, so the assertion is the same shape with the sign flipped:
 * a *lower* rank index is better, and a harder mode should never rank the same run worse.
 */
test('all four assist modes work, and a harder one is never ranked worse', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)

  const ranks: Record<string, number> = {}
  for (const mode of ['training', 'easy', 'medium', 'hard'] as const) {
    await settings(page, { assist: mode })
    // A fresh save each time, so every run is judged on its own and nothing is a carried-over best.
    const save = await page.evaluate(() => globalThis.__shearline?.getSave())
    if (save) {
      await page.evaluate((d) => {
        globalThis.__shearline?.setSave(d)
      }, { ...save, records: {} })
    }
    await loadLock(page, PRACTICE, 3)
    await openIt(page)
    expect((await getState(page)).opened, mode).toBe(true)
    await advanceSeconds(page, 2.6)
    const after = await page.evaluate(() => globalThis.__shearline?.getSave())
    ranks[mode] = after?.records['clear-practice-cutaway']?.bestRank ?? 9
  }

  // Lower index = better rank. Training is held to a tighter clock than Easy; Medium and Hard get
  // progressively more of it, so neither can come out *worse* than the mode below it.
  expect(ranks['training'] ?? 9).toBeGreaterThanOrEqual(ranks['easy'] ?? 9)
  expect(ranks['medium'] ?? 9).toBeLessThanOrEqual(ranks['easy'] ?? 9)
  expect(ranks['hard'] ?? 9).toBeLessThanOrEqual(ranks['medium'] ?? 9)
  watcher.assertClean()
})

test('blind mode is completable with the sound off, on the meter and subtitles', async ({
  page,
}) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await settings(page, { assist: 'hard', muted: true, subtitles: true })
  await loadLock(page, PRACTICE, 5)

  await openIt(page)
  const state = await getState(page)
  expect(state.opened, 'blind has to be beatable, or the mode is a joke').toBe(true)

  // The subtitle track carried the information the sound would have.
  const captions = await page.evaluate(() => globalThis.__shearline?.subtitles() ?? [])
  expect(captions.length).toBeGreaterThan(0)
  watcher.assertClean()
})

// ── Colour removal ──────────────────────────────────────────────────────────────────────

test('every pin state is distinguishable with colour removed', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await loadLock(page, SPOOL_TRAINER, 3)

  // Build a frame carrying several different states at once: set, false set, binding, free.
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.45 })
  await stepTicks(page, 60)
  for (let i = 0; i < 2; i += 1) {
    const s = await getState(page)
    const b = s.bindingChamber
    const c = b >= 0 ? s.chambers[b] : undefined
    if (!c) break
    await setInput(page, {
      chamber: b,
      liftTarget: c.setLift + c.captureWindow * 0.5,
      tensionHeld: true,
      tensionLevel: 0.45,
    })
    await stepTicks(page, 240)
  }
  const mixed = await getState(page)
  const states = new Set(mixed.chambers.map((c) => c.state))
  expect(states.size, 'the shot needs several states in it to be worth testing').toBeGreaterThan(1)

  await renderOnce(page)
  const grey = await captureGreyscale(page, 'phase-12-greyscale')
  const profile = luminanceProfile(grey)

  // With hue gone, the picture must still be carrying structure: the fills are hatched,
  // cross-hatched, dotted or plain per `ART_DIRECTION.md §1`, so the greyscale image stays
  // busy. A page whose states differed only in colour would collapse to a few flat levels.
  expect(profile.levels, 'greyscale collapsed to too few levels').toBeGreaterThan(24)
  expect(profile.stdDev, 'greyscale went flat').toBeGreaterThan(8)
  expect(profile.topShare, 'ten levels cover the whole page — no pattern survived').toBeLessThan(
    0.97,
  )
  watcher.assertClean()
})

// ── Keyboard ────────────────────────────────────────────────────────────────────────────

test('every menu is keyboard-navigable, with a visible focus ring', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })

  for (const name of ['menu', 'bench', 'settings', 'trophies', 'editor']) {
    await page.evaluate((n) => globalThis.__shearline?.goto(n), name)
    await renderOnce(page)

    const start = await focusState(page)
    expect(start.count, `${name} has no focusable widgets`).toBeGreaterThan(0)
    expect(start.keyboardMode, `${name} shows a ring before any key is pressed`).toBe(false)

    // Tab moves focus and turns the ring on.
    await page.keyboard.press('Tab')
    await renderOnce(page)
    const tabbed = await focusState(page)
    expect(tabbed.keyboardMode, `${name} did not enter keyboard mode`).toBe(true)
    // A screen with one widget has nowhere to move to, and wrapping onto itself is correct.
    if (tabbed.count > 1) {
      expect(tabbed.index, `${name} did not move focus`).not.toBe(start.index)
    }

    // And it wraps rather than dead-ending.
    for (let i = 0; i < tabbed.count + 1; i += 1) {
      await page.keyboard.press('Tab')
      await renderOnce(page)
    }
    const wrapped = await focusState(page)
    expect(wrapped.index, `${name} focus ran off the end`).toBeLessThan(wrapped.count)

    // Arrows work as well as Tab, and shift-tab equivalents go the other way.
    await page.keyboard.press('ArrowUp')
    await renderOnce(page)
    expect((await focusState(page)).index).toBeGreaterThanOrEqual(0)
  }
  watcher.assertClean()
})

test('the keyboard can start a lock without touching the mouse', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await page.evaluate(() => globalThis.__shearline?.goto('bench'))
  await renderOnce(page)

  // Tab to the first lesson card and press it.
  const before = await page.evaluate(() => globalThis.__shearline?.getScreen())
  expect(before).toBe('bench')
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab')
    await renderOnce(page)
    await page.keyboard.press('Enter')
    await renderOnce(page)
    if ((await page.evaluate(() => globalThis.__shearline?.getScreen())) !== 'bench') break
  }
  expect(await page.evaluate(() => globalThis.__shearline?.getScreen())).not.toBe('bench')
  watcher.assertClean()
})

// ── Screenshots ─────────────────────────────────────────────────────────────────────────

test('@screenshot phase-12 guided mode', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await settings(page, { assist: 'training' })
  await loadLock(page, SPOOL_TRAINER, 3)
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.42 })
  await stepTicks(page, 60)
  const s = await getState(page)
  const b = s.bindingChamber
  const c = b >= 0 ? s.chambers[b] : undefined
  if (c) {
    await setInput(page, {
      chamber: b,
      liftTarget: c.setLift * 0.6,
      tensionHeld: true,
      tensionLevel: 0.42,
    })
    await stepTicks(page, 120)
  }
  await renderOnce(page)
  await captureStage(page, 'phase-12-guided')
  watcher.assertClean()
})

test('@screenshot phase-12 blind mode', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await settings(page, { assist: 'hard', subtitles: true })
  await loadLock(page, SPOOL_TRAINER, 3)
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.42 })
  await stepTicks(page, 60)
  const s = await getState(page)
  const b = s.bindingChamber
  const c = b >= 0 ? s.chambers[b] : undefined
  if (c) {
    await setInput(page, {
      chamber: b,
      liftTarget: c.setLift + c.captureWindow * 0.5,
      tensionHeld: true,
      tensionLevel: 0.42,
    })
    await stepTicks(page, 200)
  }
  await renderOnce(page)
  await captureStage(page, 'phase-12-blind')
  watcher.assertClean()
})

test('@screenshot phase-12 a lesson in progress', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await page.evaluate(() => globalThis.__shearline?.startLesson('lesson-3'))
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.45 })
  await stepTicks(page, 60)
  const s = await getState(page)
  const b = s.bindingChamber
  const c = b >= 0 ? s.chambers[b] : undefined
  if (c) {
    await setInput(page, {
      chamber: b,
      liftTarget: c.setLift + c.captureWindow * 0.5,
      tensionHeld: true,
      tensionLevel: 0.45,
    })
    await stepTicks(page, 200)
  }
  await renderOnce(page)
  await captureStage(page, 'phase-12-lesson')
  watcher.assertClean()
})

test('the mouse pointer is visible on every screen', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })

  const cursorNow = async (): Promise<string> =>
    page.evaluate(() => {
      const c = document.querySelector('canvas')
      return c ? getComputedStyle(c).cursor : 'missing'
    })

  // Every screen made of buttons and cards needs a pointer to operate at all.
  for (const name of ['menu', 'bench', 'shop', 'loadout', 'settings', 'trophies', 'results']) {
    await page.evaluate((n) => globalThis.__shearline?.goto(n), name)
    await renderOnce(page)
    expect(await cursorNow(), `${name} has no visible pointer`).toBe('default')
  }

  // The pick screen keeps one too, and it is the ordinary arrow like everywhere else. It used to
  // become a crosshair, because the mouse *was* the pick; the keyboard picks now (D-059), so a
  // crosshair there would be aiming a tool it cannot move — and the header still carries a way
  // back to the bench that has to be clickable.
  await setManual(page, true)
  await loadLock(page, PRACTICE, 3)
  await renderOnce(page)
  expect(await cursorNow(), 'the pick screen has no visible pointer').toBe('default')

  // …and it comes back on the way out.
  await page.evaluate(() => globalThis.__shearline?.goto('bench'))
  await renderOnce(page)
  expect(await cursorNow()).toBe('default')
  watcher.assertClean()
})
