import { expect, test, type Page } from '@playwright/test'
import {
  bootGame,
  captureStage,
  getState,
  loadLock,
  renderOnce,
  setInput,
  setManual,
  setTools,
  stepTicks,
  type StateSnapshot,
} from './harness'

/** Step in small chunks until `done`, so a screenshot can catch a transient effect. */
async function stepUntil(
  page: Page,
  done: (s: StateSnapshot) => boolean,
  { chunk = 4, maxTicks = 2400 } = {},
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

test('@screenshot phase-02 cutaway mid-pick', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 5 })
  await setManual(page, true)
  await loadLock(page, 3, 1)

  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.45 })
  await stepTicks(page, 60)
  await setInput(page, { chamber: 1, liftTarget: 1.0, tensionHeld: true, tensionLevel: 0.45 })
  await stepTicks(page, 90)
  await renderOnce(page)

  await captureStage(page, 'phase-02-cutaway')
  watcher.assertClean()
})

test('@screenshot phase-03 at rest', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 5 })
  await setManual(page, true)
  await loadLock(page, 2, 11)
  await setInput(page, { chamber: 1, liftTarget: 0, tensionHeld: false, tensionLevel: 0.45 })
  await stepTicks(page, 90)
  await renderOnce(page)

  const state = await getState(page)
  expect(state.chambers.every((c) => c.state === 'FREE')).toBe(true)
  expect(state.tension).toBe(0)
  await captureStage(page, 'phase-03-rest')
  watcher.assertClean()
})

test('@screenshot phase-03 mid-lift under tension', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 5 })
  await setManual(page, true)
  await loadLock(page, 2, 11)
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.55 })
  await stepTicks(page, 60)

  const before = await getState(page)
  const b = before.bindingChamber
  const c = before.chambers[b]
  expect(c).toBeDefined()
  if (!c) return
  // Park the pick just short of the window: maximum resistance, maximum pick flex.
  await setInput(page, {
    chamber: b,
    liftTarget: c.setLift - 0.05,
    tensionHeld: true,
    tensionLevel: 0.55,
  })
  await stepTicks(page, 120)
  await renderOnce(page)

  const state = await getState(page)
  expect(state.chambers[b]?.state).toBe('BINDING')
  await captureStage(page, 'phase-03-mid-lift')
  watcher.assertClean()
})

test('@screenshot phase-03 the moment a pin sets', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 5 })
  await setManual(page, true)
  await loadLock(page, 2, 11)
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.55 })
  await stepTicks(page, 60)

  const before = await getState(page)
  const b = before.bindingChamber
  const c = before.chambers[b]
  expect(c).toBeDefined()
  if (!c) return
  await setInput(page, {
    chamber: b,
    liftTarget: c.setLift + c.captureWindow / 2,
    tensionHeld: true,
    tensionLevel: 0.55,
  })
  const state = await stepUntil(page, (s) => s.chambers[b]?.state === 'SET')
  expect(state.chambers[b]?.state).toBe('SET')
  await renderOnce(page)

  await captureStage(page, 'phase-03-set')
  watcher.assertClean()
})

test('@screenshot phase-03 an overset', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 5 })
  await setManual(page, true)
  // Light tension makes the pick fast, and a fast pick clears the capture window in under
  // CAPTURE_TIME — which is exactly when an overshoot jams instead of setting. A light
  // wrench with the wobble calibrated out keeps the shot reproducible.
  await setTools(page, { tensionMin: 0.05, tensionPrecision: 0, liftJitter: 0 })
  await loadLock(page, 3, 11)
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.1 })
  await stepTicks(page, 60)

  const before = await getState(page)
  const b = before.bindingChamber
  const c = before.chambers[b]
  expect(c).toBeDefined()
  if (!c) return
  await setInput(page, {
    chamber: b,
    liftTarget: c.setLift + c.captureWindow * 1.6,
    tensionHeld: true,
    tensionLevel: 0.1,
  })
  const state = await stepUntil(page, (s) => s.chambers[b]?.state === 'OVERSET')
  expect(state.chambers[b]?.state, 'expected the pin to jam').toBe('OVERSET')
  await renderOnce(page)

  await captureStage(page, 'phase-03-overset')
  watcher.assertClean()
})
