import { expect, test, type Page } from '@playwright/test'
import {
  bootGame,
  captureStage,
  getFx,
  getState,
  loadLock,
  renderOnce,
  setInput,
  setManual,
  setTools,
  stepTicks,
  type StateSnapshot,
  pressureStep,
  tension,
  workChamber,
} from './harness'

const SPOOL_TRAINER = 13
const SERRATED_TRAINER = 14
const DEADBOLT = 16

async function stepUntil(
  page: Page,
  done: (s: StateSnapshot) => boolean,
  { chunk = 4, maxTicks = 4000 } = {},
): Promise<StateSnapshot> {
  let state = await getState(page)
  let ticks = 0
  while (!done(state) && ticks < maxTicks) {
    await stepTicks(page, chunk)
    ticks += chunk
    state = await getState(page)
  }
  return state
}

/** Park every chamber in its first groove, in binding order, without pushing through. */
async function parkEveryGroove(page: Page, tension: number): Promise<StateSnapshot> {
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: tension })
  await stepTicks(page, 60)
  let state = await getState(page)
  for (let round = 0; round < state.chambers.length; round += 1) {
    const b = state.bindingChamber
    if (b < 0) break
    const c = state.chambers[b]
    if (!c) break
    // A standard pin has no groove to park in; set it and move on.
    const target = c.falseSetLifts[0] ?? c.setLift + c.captureWindow * 0.5
    await setInput(page, { chamber: b, liftTarget: target, tensionHeld: true, tensionLevel: tension })
    state = await stepUntil(
      page,
      (s) => s.chambers[b]?.state === 'FALSE_SET' || s.chambers[b]?.state === 'SET',
      { maxTicks: 600 },
    )
  }
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: tension })
  await stepTicks(page, 120)
  return getState(page)
}

test('a spool produces a visible false set and pushes the pick back', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await setTools(page, { tensionPrecision: 0, liftJitter: 0 })
  await loadLock(page, SPOOL_TRAINER, 4)

  const state = await parkEveryGroove(page, 0.35)
  const spools = state.chambers.filter((c) => c.profile === 'spool')
  expect(spools.length).toBe(2)
  expect(spools.every((c) => c.state === 'FALSE_SET')).toBe(true)

  // Visible: the plug has swung a long way past any single chamber's delta.
  const maxDelta = Math.max(...state.chambers.map((c) => c.delta))
  expect(state.theta).toBeGreaterThan(maxDelta * 10)
  expect(state.theta).toBeGreaterThan(0.25)

  // The pick is pushed back: park it on a false-set spool and it ends up below the target.
  const victim = spools[0]
  if (!victim) return
  const target = victim.falseSetLifts[0] ?? 0
  await setInput(page, {
    chamber: victim.index,
    liftTarget: target,
    tensionHeld: true,
    tensionLevel: 0.85,
  })
  await stepTicks(page, 240)
  const pushed = await getState(page)
  const c = pushed.chambers[victim.index]
  expect(c?.counterForce, 'counter-rotation should be active').toBeGreaterThan(0)
  expect(c?.lift, 'the pin should have been shoved below the target').toBeLessThan(target - 0.05)

  // …and the pick shaft is bowed hard as a result.
  const fx = await getFx(page)
  expect(fx.pickFlex).toBeGreaterThan(20)
  watcher.assertClean()
})

test('@screenshot phase-05 a full false set', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await setTools(page, { tensionPrecision: 0, liftJitter: 0 })
  await loadLock(page, SPOOL_TRAINER, 4)

  const state = await parkEveryGroove(page, 0.35)
  expect(state.chambers.some((c) => c.state === 'FALSE_SET')).toBe(true)
  expect(state.theta / 0.52).toBeGreaterThan(0.5)

  // Put the pick on a false-set spool so the pushback is in shot too.
  const spool = state.chambers.find((c) => c.state === 'FALSE_SET')
  if (spool) {
    await setInput(page, {
      chamber: spool.index,
      liftTarget: (spool.falseSetLifts[0] ?? 0) + 0.35,
      tensionHeld: true,
      tensionLevel: 0.55,
    })
    await stepTicks(page, 90)
  }
  await renderOnce(page)
  await captureStage(page, 'phase-05-false-set')
  watcher.assertClean()
})

test('a serrated pin lies four times on the way up, on screen', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await setTools(page, { tensionPrecision: 0, liftJitter: 0 })
  await loadLock(page, SERRATED_TRAINER, 2)

  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.35 })
  await stepTicks(page, 60)
  const start = await getState(page)
  const b = start.bindingChamber
  const c = start.chambers[b]
  expect(c).toBeDefined()
  if (!c) return
  expect(c.profile).toBe('serrated')
  expect(c.falseSetLifts).toHaveLength(4)

  let entries = 0
  let previous = 'FREE'
  for (let lift = 0; lift <= c.setLift + c.captureWindow * 0.5; lift += 0.02) {
    await setInput(page, { chamber: b, liftTarget: lift, tensionHeld: true, tensionLevel: 0.35 })
    await stepTicks(page, 6)
    const now = await getState(page)
    const state = now.chambers[b]?.state ?? 'FREE'
    if (state === 'FALSE_SET' && previous !== 'FALSE_SET') entries += 1
    previous = state
    if (state === 'SET' || state === 'OVERSET') break
  }
  expect(entries).toBe(4)
  expect((await getState(page)).chambers[b]?.state).toBe('SET')
  watcher.assertClean()
})

test('a human can open a 4-pin 2-spool lock from the keyboard', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await loadLock(page, SPOOL_TRAINER, 6)

  await tension(page, true)
  /**
   * Step 3: light but controlled.
   *
   * Spools jam under heavy tension, so the pressure comes down — but not to the stop. The very
   * lightest step makes the pick *fast* enough to cross a capture window inside `CAPTURE_TIME`
   * and overset on the way through, and it asks for barely a third of a turn so a picked lock
   * will not open until you lean back on it. Both are real and both are tested elsewhere.
   */
  await pressureStep(page, 3)
  await page.waitForTimeout(200)

  const deadline = Date.now() + 45_000
  let opened = false
  while (Date.now() < deadline) {
    const state = await getState(page)
    if (state.opened) {
      opened = true
      break
    }
    // An overset is unrecoverable while the wrench is on, so a player does the only thing that
    // works: lets go, lets everything drop, and starts the lock again (D-051).
    if (state.chambers.some((c) => c.state === 'OVERSET')) {
      await tension(page, false)
      await page.waitForTimeout(220)
      await tension(page, true)
      await page.waitForTimeout(220)
      continue
    }
    const b = state.bindingChamber
    const target =
      b >= 0 ? state.chambers[b] : state.chambers.find((c) => c.state === 'FALSE_SET')
    if (!target) {
      // Nothing binding and nothing false-set: every driver is up and all that is left is to
      // turn the plug. Wind the pressure on (D-048).
      if (state.chambers.every((c) => c.state === 'SET')) await pressureStep(page, 8)
      await page.waitForTimeout(60)
      continue
    }
    // The arrows drop the pick as they move it, so this is always "down, across, up" (D-051).
    await workChamber(page, target.index, target.setLift + target.captureWindow * 0.5)
    await page.waitForTimeout(120)
  }
  await tension(page, false)

  const final = await getState(page)
  expect(opened, `states: ${final.chambers.map((c) => c.state).join(',')}`).toBe(true)
  expect(final.stats.falseSetsEntered, 'the spools should have lied at least once').toBeGreaterThan(
    0,
  )
  watcher.assertClean()
})

test('heavy tension walls a spool that a light hand walks through', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  // A five-chamber lock needs a pick that reaches five; this test is about tension, not
  // reach, so give it the Medium Hook and take the tool noise out.
  await setTools(page, { tensionMin: 0.05, tensionPrecision: 0, liftJitter: 0, reach: 5 })

  async function attempt(tension: number): Promise<StateSnapshot> {
    await loadLock(page, DEADBOLT, 3)
    await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: tension })
    await stepTicks(page, 60)
    for (let round = 0; round < 40; round += 1) {
      const state = await getState(page)
      if (state.opened) break
      const b = state.bindingChamber
      const target =
        b >= 0 ? state.chambers[b] : state.chambers.find((c) => c.state === 'FALSE_SET')
      if (!target) {
        await stepTicks(page, 60)
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

  const light = await attempt(0.3)
  expect(light.opened, `light: ${light.chambers.map((c) => c.state).join(',')}`).toBe(true)

  const heavy = await attempt(0.95)
  expect(heavy.opened).toBe(false)
  expect(heavy.chambers.some((c) => c.state === 'FALSE_SET')).toBe(true)
  watcher.assertClean()
})
