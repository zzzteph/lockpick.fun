/**
 * Challenge modifiers and the manual play checklist.
 *
 * What survives of `shop.spec.ts`. The shop, the loadout and the tool catalogue went with D-088;
 * the tests that were really about *challenges* and about the checklist from VERIFICATION.md §7
 * did not, so they moved here rather than being deleted along with the screen they happened to
 * live behind.
 */

import { expect, test, type Page } from '@playwright/test'
import type { SaveDataShape } from '../src/devhook'
import {
  bootGame,
  getFx,
  getState,
  loadLock,
  scriptPin,
  setInput,
  setManual,
  stepTicks,
  pressureStep,
  tension,
  workChamber,
} from './harness'

async function getSave(page: Page): Promise<SaveDataShape> {
  return page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.getSave()
  })
}

async function toolStats(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () => globalThis.__shearline?.getToolStats() as unknown as Record<string, unknown>,
  )
}



test('challenge modifiers apply and stack multiplicatively', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)

  expect(await page.evaluate(() => globalThis.__shearline?.getChallenges())).toEqual([])
  await page.evaluate(() => {
    globalThis.__shearline?.toggleChallenge('no-resets')
    globalThis.__shearline?.toggleChallenge('no-oversets')
  })
  expect(await page.evaluate(() => globalThis.__shearline?.getChallenges())).toEqual([
    'no-resets',
    'no-oversets',
  ])

  await loadLock(page, 1, 5)
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.5 })
  await stepTicks(page, 60)
  for (let round = 0; round < 20; round += 1) {
    const state = await getState(page)
    if (state.opened) break
    const b = state.bindingChamber
    const c = b >= 0 ? state.chambers[b] : undefined
    if (!c) {
      await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.6 })
      await stepTicks(page, 120)
      continue
    }
    await scriptPin(page, b, c.setLift + c.captureWindow * 0.5, 0.5, 240)
  }

  const state = await getState(page)
  expect(state.opened).toBe(true)
  expect(state.stats.fullResets).toBe(0)
  expect(state.stats.oversets).toBe(0)

  // Opened clean and without a reset, so both modifiers were met and both were recorded. They
  // pay a badge rather than a multiplier now (D-091), and the badge is the thing to assert.
  const save = await getSave(page)
  const record = save.records['clear-practice-cutaway']
  expect(record?.challenges.sort()).toEqual(['no-oversets', 'no-resets'])
  expect(record?.bestRank, 'a clean fast open has to rank well').toBeLessThanOrEqual(3)
  watcher.assertClean()
})

test('a challenge opted into but not met pays nothing extra', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  /**
   * "No resets" cannot be met by an attempt that loses tension, which this one deliberately does.
   *
   * Not "no oversets": this lock is the practice cutaway, whose whole job is to be forgiving, and a
   * loose lock genuinely does *not* jam on an overshoot that would jam a tight one (D-051). Trying
   * to fail the overset challenge here would be trying to make the tutorial lock behave badly.
   * Dropping the wrench works on any lock ever made.
   */
  await page.evaluate(() => {
    globalThis.__shearline?.toggleChallenge('no-resets')
  })

  await loadLock(page, 1, 5)
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.5 })
  await stepTicks(page, 60)
  for (let round = 0; round < 20; round += 1) {
    const s = await getState(page)
    if (s.opened) break
    const b = s.bindingChamber
    const c = b >= 0 ? s.chambers[b] : undefined
    if (!c) {
      await stepTicks(page, 120)
      continue
    }
    await scriptPin(page, b, c.setLift + c.captureWindow * 0.5, 0.5, 240)
    // Drop the wrench once, early, which dumps every set pin and costs the challenge.
    if (round === 0) {
      await setInput(page, { chamber: -1, tensionHeld: false, tensionLevel: 0 })
      await stepTicks(page, 180)
      await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.5 })
      await stepTicks(page, 60)
    }
  }
  const final = await getState(page)
  expect(final.opened, 'the lock still has to open — this is about the payout').toBe(true)
  expect(final.stats.fullResets, 'the reset has to have actually happened').toBeGreaterThan(0)
  const save = await getSave(page)
  expect(save.records['clear-practice-cutaway']?.challenges).toEqual([])
  watcher.assertClean()
})

test('a cylinder is solvable with the kit the player always has', async ({ page }) => {
  // A browser-side echo of the unit solver test, to prove the wiring did not quietly change
  // what the game hands the simulation.
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  const stats = await toolStats(page)
  // Reach is no longer a gate and the wrench spans every pressure step (D-088).
  expect(stats['reach']).toBeGreaterThanOrEqual(16)
  expect(stats['fitsTightKeyway']).toBe(true)
  expect(stats['tensionMin']).toBeLessThanOrEqual(0.12)
  expect(stats['tensionMax']).toBeGreaterThanOrEqual(0.95)

  await loadLock(page, 3, 9)
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.45 })
  await stepTicks(page, 60)
  for (let round = 0; round < 20; round += 1) {
    const s = await getState(page)
    if (s.opened) break
    const b = s.bindingChamber
    const c = b >= 0 ? s.chambers[b] : undefined
    if (!c) {
      await stepTicks(page, 120)
      continue
    }
    await setInput(page, {
      chamber: b,
      liftTarget: c.setLift + c.captureWindow * 0.5,
      tensionHeld: true,
      tensionLevel: 0.45,
    })
    await stepTicks(page, 240)
  }
  expect((await getState(page)).opened).toBe(true)
  watcher.assertClean()
})

/**
 * The manual play checklist from VERIFICATION.md §7, played by hand through real key events.
 *
 * It used to be run twice, once bare-handed and once "with the full tool range". There is only one
 * range now (D-088), so there is only one run — and the spool arc it exercises is the same one,
 * because that was always about the *tension wheel* rather than about which wrench was equipped.
 */
test('manual play checklist', async ({ page }) => {
  test.setTimeout(120_000)
  const watcher = await bootGame(page, { frames: 10 })

  const stats = await toolStats(page)
  expect(stats['tensionMax']).toBeGreaterThanOrEqual(0.95)

  // A Tier 3 spool lock, played at human pace through real key events.
  await loadLock(page, 13, 21)
  await tension(page, true)
  // Start heavy, the way someone who has not learned the spool technique does: wind the
  // pressure up past the spool wall, feel the lock shove back, then wind it down and finish.
  // That arc is the whole lesson this lock exists to teach.
  await pressureStep(page, 9)
  await page.waitForTimeout(250)

  const flex: number[] = []
  const resistance: number[] = []
  let opened = false
  let rounds = 0
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline && !opened) {
    const state = await getState(page)
    if (state.opened) {
      opened = true
      break
    }
    rounds += 1
    // Stalled on a groove? Back the pressure off — the technique the lock is teaching.
    // Step 2 since D-204: the spool wall is ≈0.32 now, and step 3 is a crawl against it.
    if (rounds === 14) await pressureStep(page, 2)

    /**
     * Jammed a pin? Drop the wrench, take the reset, start again.
     *
     * This lock is Tier 2 since D-088, and feathering only arrives with Tier 3 — so on the fresh
     * save this test runs with, an overset is *not* recoverable by easing off. It is recoverable by
     * releasing entirely, which is exactly what a player without the technique has to do, and what
     * the checklist should be exercising rather than stalling on. Without this the run ends
     * `FREE,FREE,FREE,OVERSET` and the test reports a failure that is really a missing move.
     */
    if (state.chambers.some((c) => c.state === 'OVERSET')) {
      await tension(page, false)
      await page.waitForTimeout(400)
      await tension(page, true)
      // Back to step 2 — the dip this run has already learned; 4 would wall the spools (D-204).
      await pressureStep(page, 2)
      await page.waitForTimeout(200)
      continue
    }

    const b = state.bindingChamber
    const target =
      b >= 0 ? state.chambers[b] : state.chambers.find((c) => c.state === 'FALSE_SET')
    if (!target) {
      if (state.chambers.every((c) => c.state === 'SET')) await pressureStep(page, 8)
      await page.waitForTimeout(60)
      continue
    }
    await workChamber(page, target.index, target.setLift + target.captureWindow * 0.5)
    await page.waitForTimeout(100)
    const fx = await getFx(page)
    const now = await getState(page)
    flex.push(fx.pickFlex)
    resistance.push(now.resistance)
  }
  await tension(page, false)

  const final = await getState(page)
  expect(opened, `states: ${final.chambers.map((c) => c.state).join(',')}`).toBe(true)
  // A spool lock: counter-rotation must have actually shoved back at some point. Read from
  // the attempt's own high-water mark rather than sampled between key presses, which under a
  // loaded test runner can step straight over a transient.
  expect(final.stats.maxCounterForce, 'the spools should have pushed back').toBeGreaterThan(0)
  expect(flex.length).toBeGreaterThan(4)
  // …and the line under it was still sampling, which is the same bug the comment above describes.
  // `maxResistance` exists for exactly this and was added when this test failed under six parallel
  // workers, having stepped clean over every peak it was looking for (D-114).
  expect(final.stats.maxResistance, 'the lock should have felt heavy at some point').toBeGreaterThan(
    0.2,
  )
  watcher.assertClean()
})

