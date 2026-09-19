import { expect, test, type Page } from '@playwright/test'
import {
  bootGame,
  captureStage,
  getState,
  loadLock,
  renderOnce,
  scriptPin,
  setInput,
  setManual,
  stepTicks,
  type StateSnapshot,
  pressureStep,
  tension,
  workChamber,
} from './harness'

const SPOOL_TRAINER = 13

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

/**
 * One push on the solver, the keyboard's ramp, let go when the pin answers — `scriptPush` with the
 * counter-rotation chosen by the caller rather than inferred (D-228).
 */
async function pushPlain(page: Page, chamber: number, tension: number, counter = false): Promise<void> {
  await setInput(page, { chamber, liftTarget: 0, tensionHeld: true, tensionLevel: tension })
  await stepTicks(page, 36)
  const before = (await getState(page)).chambers[chamber]?.state ?? 'FREE'
  let lift = 0
  for (let k = 0; k < 40; k += 1) {
    lift = Math.min(3.5, lift + (4.2 * 6) / 120)
    await setInput(page, { chamber, liftTarget: lift, tensionHeld: true, tensionLevel: tension, ...(counter ? { counter: true } : {}) })
    await stepTicks(page, 6)
    const now = (await getState(page)).chambers[chamber]?.state ?? 'FREE'
    if (now === 'SET' || now === 'OVERSET' || (now === 'FALSE_SET' && before !== 'FALSE_SET')) break
  }
  await setInput(page, { chamber, liftTarget: 0, tensionHeld: true, tensionLevel: tension })
  await stepTicks(page, 36)
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
    await scriptPin(page, b, target, tension, 0)
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

test('a spool produces a visible false set', async ({ page }) => {
  /**
   * On the solver (D-228): parked in its groove a spool reads FALSE_SET and the plug has visibly
   * turned past where the first pin bound. (The rate sim's lift heights, θ as a fraction of its
   * 0.52 open, its pushback and pick flex — retired kit feel — are not this physics' numbers; what
   * beats a spool here is pinned below: the counter-rotation A/B.)
   */
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await loadLock(page, SPOOL_TRAINER, 4)
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.489 })
  await stepTicks(page, 60)
  const th0 = (await getState(page)).theta

  const state = await parkEveryGroove(page, 0.489)
  const lying = state.chambers.filter((c) => c.profile === 'spool' && c.state === 'FALSE_SET')
  expect(lying.length, 'a spool parks in its groove').toBeGreaterThan(0)
  // Visible: a clear fraction of a degree past the first bind.
  expect(state.theta - th0).toBeGreaterThan(0.15 * (Math.PI / 180))
  watcher.assertClean()
})

test('@screenshot phase-05 a full false set', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await loadLock(page, SPOOL_TRAINER, 4)
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.489 })
  await stepTicks(page, 60)
  const th0 = (await getState(page)).theta

  const state = await parkEveryGroove(page, 0.489)
  expect(state.chambers.some((c) => c.state === 'FALSE_SET')).toBe(true)
  // The solver's picture (D-228): the plug turned clearly past the first bind, not the rate sim's
  // fraction of its 0.52 open.
  expect(state.theta - th0).toBeGreaterThan(0.15 * (Math.PI / 180))

  // Put the pick on a false-set spool so the push is in shot too.
  const spool = state.chambers.find((c) => c.state === 'FALSE_SET')
  if (spool) {
    await setInput(page, { chamber: spool.index, liftTarget: 1.5, tensionHeld: true, tensionLevel: 0.55 })
    await stepTicks(page, 90)
  }
  await renderOnce(page)
  await captureStage(page, 'phase-05-false-set')
  watcher.assertClean()
})

test('a serrated pin lies once, and lifting through it with the plug eased sets it', async ({
  page,
}) => {
  /**
   * The solver's serrated pin (D-227): a tooth catches like a set — ONE false set that holds — and
   * the pin sets only when the plug is eased off the tooth (counter-rotation) while it is lifted
   * again. The rate sim's "four lies on the way up" no longer happens; the lesson and help say so.
   * Played on the lesson's own lock and seed, so it tests exactly what the lesson teaches.
   */
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await page.evaluate(() => globalThis.__shearline!.startLesson('lesson-serrated'))
  const TENSION = 0.49
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: TENSION })
  await stepTicks(page, 60)
  const serrated = (await getState(page)).chambers.findIndex((c) => c.profile === 'serrated')
  expect(serrated).toBeGreaterThanOrEqual(0)

  let entries = 0
  let previous = 'FREE'
  for (let round = 0; round < 12; round += 1) {
    const s = await getState(page)
    if (s.chambers[serrated]?.state === 'SET') break
    const b = s.bindingChamber >= 0 ? s.bindingChamber : serrated
    await scriptPin(page, b, 0, TENSION, 0)
    const now = (await getState(page)).chambers[serrated]?.state ?? 'FREE'
    if (now === 'FALSE_SET' && previous !== 'FALSE_SET') entries += 1
    previous = now
  }
  expect(entries, 'the tooth lies once').toBe(1)
  expect((await getState(page)).chambers[serrated]?.state).toBe('SET')
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
  // On the solver (D-223) the dial maps differently — step 3 is under what any walk uses — and a
  // false set is worked with counter-rotation (C) instead of a feather, so the default step 5.
  const solver = await page.evaluate(() => globalThis.__shearline!.sideFrame() !== null)
  await pressureStep(page, solver ? 5 : 3)
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
    // On the solver only a WEDGED pin needs this (D-220/D-223): an OVERSET read just after a
    // click is the pin settling, and dropping the wrench then throws every set away.
    if (state.chambers.some((c) => c.state === 'OVERSET' && (c.jammed ?? true))) {
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

test('counter-rotation walks a spool through; without it the spools hold the lock shut', async ({
  page,
}) => {
  /**
   * The solver's spool (D-228), measured: the rate sim's "heavy walls it, light walks through" is
   * not this physics — tension alone opened the spool trainer on 0 of 16 seeds/levels, and with
   * the plug eased back under the lift (counter-rotation: C, the pad, the right button) on 9 of 16.
   * So the lesson the lock teaches is the counter, and that is what this pins, on a seed where the
   * counter opens it at the default pressure.
   */
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)

  async function attempt(counter: boolean): Promise<StateSnapshot> {
    const CRUISE = 0.489
    await loadLock(page, SPOOL_TRAINER, 1)
    await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: CRUISE })
    await stepTicks(page, 60)
    for (let round = 0; round < 40; round += 1) {
      const state = await getState(page)
      if (state.opened) break
      const b = state.bindingChamber
      const fs = state.chambers.findIndex((c) => c.state === 'FALSE_SET')
      const t = b >= 0 ? b : fs >= 0 ? fs : state.chambers.findIndex((c) => c.state !== 'SET')
      if (t < 0) {
        await stepTicks(page, 60)
        continue
      }
      const lying = state.chambers[t]?.state === 'FALSE_SET'
      await pushPlain(page, t, CRUISE, counter && lying)
    }
    return getState(page)
  }

  const eased = await attempt(true)
  expect(eased.opened, `with the counter: ${eased.chambers.map((c) => c.state).join(',')}`).toBe(true)
  const plain = await attempt(false)
  expect(plain.opened, 'tension alone does not beat the spools').toBe(false)
  expect(plain.stats.falseSetsEntered).toBeGreaterThan(0)
  watcher.assertClean()
})
