import { expect, test, type Page } from '@playwright/test'
import type { SaveDataShape } from '../src/devhook'
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
} from './harness'

/**
 * The gallery — `PHASES.md` Phase 14, *"a labelled image from every phase"*.
 *
 * The per-phase shots live with the specs that produced them; these are the two that had no
 * natural home. Phase 6 built the solver and the content pipeline, whose visible output is a
 * table rather than a picture — so its shot is of the pipeline's *point*: a lock being opened
 * by the tape a solver produced. Phase 14 is the finished game.
 */

/**
 * Give the player money and unlock everything. There are no tools to grant any more (D-088) —
 * this exists only so a spec can skip the progression and get straight to a lock.
 */
async function grant(page: Page, credits = 20_000): Promise<void> {
  const current = await page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.getSave()
  })
  await page.evaluate(
    (d) => {
      globalThis.__shearline?.setSave(d)
    },
    { ...current, credits },
  )
}

test('@screenshot phase-06 the solver at work', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await grant(page)
  await loadLock(page, 18, 3) // Kestrel Pro Cylinder — six chambers, five of them lying.

  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.4 })
  await stepTicks(page, 60)
  // Play it to a state with everything in it at once: some set, one false-set, one binding.
  for (let i = 0; i < 3; i += 1) {
    const s = await getState(page)
    const b = s.bindingChamber
    const c = b >= 0 ? s.chambers[b] : undefined
    if (!c) break
    await setInput(page, {
      chamber: b,
      liftTarget: c.setLift + c.captureWindow * 0.5,
      tensionHeld: true,
      tensionLevel: 0.4,
    })
    await stepTicks(page, 240)
  }
  const s = await getState(page)
  const states = new Set(s.chambers.map((c) => c.state))
  expect(states.size, 'the shot needs more than one state in it').toBeGreaterThan(1)
  await renderOnce(page)
  await captureStage(page, 'phase-06-solver')
  watcher.assertClean()
})

test('@screenshot phase-14 the finished bench', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  // A save well into the game, so the bench shows the shape of the whole thing: tiers
  // unlocked, locks opened, lessons done, tools bought.
  const current = await page.evaluate(() => globalThis.__shearline?.getSave())
  if (current) {
    const records: SaveDataShape['records'] = {}
    const slugs = await page.evaluate(() => {
      const h = globalThis.__shearline
      if (!h) throw new Error('no hook')
      return h.lockSlugs()
    })
    for (const slug of slugs.slice(0, 22)) {
      records[slug] = { opens: 2, bestTime: 41.5, bestOversets: 0, bestRank: 1, challenges: [] }
    }
    await page.evaluate((d) => {
      globalThis.__shearline?.setSave(d)
    }, {
      ...current,
      records,
      tutorial: ['lesson-rotate', 'lesson-1', 'lesson-2', 'lesson-3'],
      achievements: ['first-blood', 'apprentice', 'journeyman', 'under-par', 'half-par'],
      __removedTools: [
        'medium-hook',
        'offset-hook',
        'deep-hook',
        'dimple-pick',
        'city-rake',
      ],
    })
  }
  await page.evaluate(() => globalThis.__shearline?.goto('bench'))
  await renderOnce(page)
  await captureStage(page, 'phase-14-bench')
  watcher.assertClean()
})

test('@screenshot phase-14 the open, in full', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await grant(page)
  await loadLock(page, 16, 5) // Halberd Deadbolt — five chambers, three spools.

  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.4 })
  await stepTicks(page, 60)
  for (let i = 0; i < 20; i += 1) {
    const s = await getState(page)
    if (s.opened) break
    const b = s.bindingChamber
    const c = b >= 0 ? s.chambers[b] : s.chambers.find((x) => x.state === 'FALSE_SET')
    if (!c) {
      await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.6 })
      await stepTicks(page, 120)
      continue
    }
    await setInput(page, {
      chamber: c.index,
      liftTarget: c.setLift + c.captureWindow * 0.5,
      tensionHeld: true,
      tensionLevel: 0.4,
    })
    await stepTicks(page, 240)
  }
  expect((await getState(page)).opened, 'the shot must be of an open lock').toBe(true)
  await advanceSeconds(page, 1.45)
  await renderOnce(page)
  await captureStage(page, 'phase-14-open')
  watcher.assertClean()
})
