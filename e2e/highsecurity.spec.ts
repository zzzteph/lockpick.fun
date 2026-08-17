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
} from './harness'

const SIDEBAR_6 = 27

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

/**
 * Everything a top-tier lock needs, which since D-088 is only money — the kit is fixed and reach
 * is no longer a gate. Kept as a named step so the specs still read as "set the player up, then
 * pick".
 */
async function kitOut(page: Page): Promise<void> {
  await grant(page)
}

/**
 * The tubular lock (129) and the Bramah slider (332) tests lived here. Both families left the
 * roster with D-088, so there is no catalogue lock for a *browser* test to load — the simulation
 * and the face-on renderer still carry them, and both are still tested from fixtures in
 * tests/sim/highsecurity.test.ts and tests/render/faceon.test.ts.
 *
 * The **disc detainers** joined them with D-104, and took three more tests with them: that a disc
 * has no spring and stays where it is left, that its false gates lie on the way to an open, and
 * the `phase-10-disc-detainer` screenshot. Same reason and same disposition — a browser test needs
 * a lock the *bench* can load, and the harness loads by id. All three behaviours are still
 * asserted in `tests/sim/highsecurity.test.ts` against `DISC_FIXTURE`, including the solver's
 * blind sweep for a gate angle, which is the part with no other cover.
 *
 * `screenshots/phase-10-disc-detainer.png` is left in the gallery as the record of the phase that
 * built the family, the same way `phase-00-hello.png` outlived the hello page.
 */

test('a sidebar holds the plug back with every pin set, and says so', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await kitOut(page)
  await loadLock(page, SIDEBAR_6, 4)

  const start = await getState(page)
  const gated = start.chambers.filter((c) => c.sidebarGate !== null)
  expect(gated.length).toBeGreaterThan(0)

  // 0.22 since D-204: the sidebar lock's tight tolerance pulls its spools' wall to ~0.25.
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.22 })
  await stepTicks(page, 60)

  // Set every chamber deliberately at the far end of its window from the gate.
  let state = await getState(page)
  for (let round = 0; round < 60 && !state.chambers.every((c) => c.state === 'SET'); round += 1) {
    const b = state.bindingChamber >= 0
      ? state.bindingChamber
      : state.chambers.findIndex((c) => c.state !== 'SET')
    const c = b >= 0 ? state.chambers[b] : undefined
    if (!c) break
    // A hair inside each edge, not 0.001mm from it. The point is to set *away from the gate*,
    // and on this lock's 0.36mm window either end is four gate-widths clear of it — while an
    // aim right on the top edge sits on the overset cliff and goes over on tool jitter alone,
    // which makes the test a coin toss on the wobble sequence rather than a test of sidebars.
    const inset = c.captureWindow * 0.12
    const low = c.setLift + inset
    const high = c.setLift + c.captureWindow - inset
    const gate = c.sidebarGate
    const target =
      gate === null
        ? c.setLift + c.captureWindow * 0.5
        : Math.abs(high - gate) > Math.abs(low - gate)
          ? high
          : low
    await scriptPin(page, b, target, 0.22, 0)
    await stepTicks(page, 60)
    state = await getState(page)
  }

  expect(state.chambers.every((c) => c.state === 'SET')).toBe(true)
  expect(state.chambers.some((c) => c.sidebarGate !== null && !c.sidebarAligned)).toBe(true)
  expect(state.sidebarDropped).toBe(false)

  // Turn as hard as the wrench goes: it moves, and then it stops. That is the whole tell.
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.9 })
  await stepTicks(page, 300)
  const stalled = await getState(page)
  expect(stalled.opened).toBe(false)
  expect(stalled.theta).toBeGreaterThan(0)
  expect(stalled.theta).toBeLessThan(stalled.thetaDemand)
  watcher.assertClean()
})

test('a sidebar gate can be felt before it is set', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await kitOut(page)
  await loadLock(page, SIDEBAR_6, 4)

  const start = await getState(page)
  const c = start.chambers.find((x) => x.sidebarGate !== null)
  expect(c).toBeDefined()
  if (!c || c.sidebarGate === null) return
  const low = c.setLift
  const high = c.setLift + c.captureWindow
  const off = Math.abs(high - c.sidebarGate) > Math.abs(low - c.sidebarGate) ? high : low

  // Wrench off throughout: nothing can capture, so the survey costs nothing.
  await setInput(page, { chamber: c.index, liftTarget: c.sidebarGate, tensionHeld: false })
  await stepTicks(page, 20)
  const onGate = (await getState(page)).resistance
  await setInput(page, { chamber: c.index, liftTarget: off, tensionHeld: false })
  await stepTicks(page, 20)
  const offGate = (await getState(page)).resistance

  expect((await getState(page)).chambers[c.index]?.state).not.toBe('SET')
  expect(onGate, 'the gate has to be readable, or the lock is a lottery').toBeLessThan(offGate)
  watcher.assertClean()
})

test('@screenshot phase-10 sidebar held', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await kitOut(page)
  await loadLock(page, SIDEBAR_6, 4)

  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.4 })
  await stepTicks(page, 60)
  let state = await getState(page)
  for (let round = 0; round < 60 && !state.chambers.every((c) => c.state === 'SET'); round += 1) {
    const b = state.bindingChamber >= 0
      ? state.bindingChamber
      : state.chambers.findIndex((c) => c.state !== 'SET')
    const c = b >= 0 ? state.chambers[b] : undefined
    if (!c) break
    const gate = c.sidebarGate
    const high = c.setLift + c.captureWindow
    const target = gate === null ? c.setLift + c.captureWindow * 0.5
      : Math.abs(high - gate) > Math.abs(c.setLift - gate) ? high - 1e-3 : c.setLift + 1e-3
    await scriptPin(page, b, target, 0.4, 0)
    await stepTicks(page, 60)
    state = await getState(page)
  }
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.8 })
  await stepTicks(page, 240)
  await renderOnce(page)
  await captureStage(page, 'phase-10-sidebar-held')
  watcher.assertClean()
})

