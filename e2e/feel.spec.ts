import { expect, test, type Page } from '@playwright/test'
import {
  bootGame,
  frameStats,
  getFx,
  getState,
  loadLock,
  setInput,
  setManual,
  setReducedMotion,
  setTools,
  stepTicks,
  type StateSnapshot,
  liftTo,
  moveTo,
  pressureStep,
  tension,
} from './harness'

async function stepUntil(
  page: Page,
  done: (s: StateSnapshot) => boolean,
  { chunk = 2, maxTicks = 2400 } = {},
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

/** Put the pick on the binding chamber at a given fraction of its capture window. */
async function workBinding(page: Page, windowFraction: number, tension: number): Promise<number> {
  const state = await getState(page)
  const b = state.bindingChamber
  const c = state.chambers[b]
  if (!c) throw new Error('no binding chamber')
  await setInput(page, {
    chamber: b,
    liftTarget: c.setLift + c.captureWindow * windowFraction,
    tensionHeld: true,
    tensionLevel: tension,
  })
  return b
}

test('pick flex is continuous and proportional to resistance', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await setTools(page, { tensionPrecision: 0, liftJitter: 0 })
  await loadLock(page, 2, 5)

  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.5 })
  await stepTicks(page, 60)
  const start = await getState(page)
  const binding = start.bindingChamber
  const free = start.chambers.find((c) => c.index !== binding)
  expect(free).toBeDefined()
  if (!free) return

  /**
   * Leaning on each in turn. Resting the tip on a pin at zero lift tells you nothing at all now
   * (D-056), so both probes apply the same deliberate ${PRESSURE}mm of push and the difference
   * between them is the pin rather than the hand.
   */
  const PROBE = 0.45

  // Pushing on a free pin: light and bouncy, and it rides up to meet you.
  await setInput(page, {
    chamber: free.index,
    liftTarget: PROBE,
    tensionHeld: true,
    tensionLevel: 0.5,
  })
  await stepTicks(page, 30)
  const onFree = await getFx(page)
  const freeState = await getState(page)

  // Pushing on the binding pin at the same height: heavy and dead, and it does not move.
  await setInput(page, { chamber: binding, liftTarget: PROBE, tensionHeld: true, tensionLevel: 0.5 })
  await stepTicks(page, 30)
  const onBinding = await getFx(page)
  const bindingState = await getState(page)

  expect(bindingState.resistance).toBeGreaterThan(freeState.resistance)
  expect(onBinding.pickFlex).toBeGreaterThan(onFree.pickFlex)
  expect(onBinding.pickFlex - onFree.pickFlex).toBeGreaterThan(3)

  // Pushing against the binding pin bends the shaft further still: the gap between where
  // the tip is and where it was asked to be is the force the player is applying.
  const c = bindingState.chambers[binding]
  if (!c) return
  await setInput(page, {
    chamber: binding,
    liftTarget: c.setLift,
    tensionHeld: true,
    tensionLevel: 0.5,
  })
  await stepTicks(page, 1)
  const pushing = await getFx(page)
  expect(pushing.pickFlex).toBeGreaterThan(onBinding.pickFlex)

  // Continuity: no jump larger than a few pixels over a slow sweep.
  let previous = pushing.pickFlex
  for (let i = 0; i < 40; i += 1) {
    await stepTicks(page, 2)
    const now = (await getFx(page)).pickFlex
    expect(Math.abs(now - previous), `flex jumped from ${previous} to ${now}`).toBeLessThan(12)
    previous = now
  }
  watcher.assertClean()
})

test('set feedback lands on every channel within 100ms', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await setTools(page, { tensionPrecision: 0, liftJitter: 0 })
  await loadLock(page, 2, 9)

  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.5 })
  await stepTicks(page, 60)
  const b = await workBinding(page, 0.5, 0.5)
  const before = await getFx(page)
  const stateBefore = await getState(page)

  const atSet = await stepUntil(page, (s) => s.chambers[b]?.state === 'SET')
  expect(atSet.chambers[b]?.state).toBe('SET')
  const fxAtSet = await getFx(page)

  // Channel 1 — the flash is already burning.
  expect(fxAtSet.chambers[b]?.flash).toBeGreaterThan(0.5)
  // Channel 2 — the colour has changed, and to something new.
  expect(fxAtSet.fills[b]).not.toBe(before.fills[b])
  // Channel 3 — the micro-shake is running.
  expect(fxAtSet.shake).toBeGreaterThan(0)
  // Channel 4 — the plug has begun to take up rotation.
  expect(atSet.theta).toBeGreaterThan(stateBefore.theta)

  // …and 100ms later the plug take-up is well under way and the shake is long over.
  await stepTicks(page, 12)
  const after = await getState(page)
  const fxAfter = await getFx(page)
  expect(after.theta).toBeGreaterThan(atSet.theta)
  expect(fxAfter.shake).toBe(0)
  expect(fxAfter.chambers[b]?.flash).toBeLessThan(fxAtSet.chambers[b]?.flash ?? 1)
  watcher.assertClean()
})

test('the binding pin is identifiable without hovering over it', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await loadLock(page, 3, 21)
  // Tension only — the pick is not in the lock at all.
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.5 })
  await stepTicks(page, 90)

  const state = await getState(page)
  const fx = await getFx(page)
  expect(state.pickChamber).toBe(-1)
  const b = state.bindingChamber
  expect(b).toBeGreaterThanOrEqual(0)

  // Exactly one chamber is drawn in the binding colour, and it is the binding one.
  const bindingFill = fx.fills[b]
  const others = fx.fills.filter((_, i) => i !== b)
  expect(others.every((f) => f !== bindingFill)).toBe(true)
  expect(state.chambers.filter((c) => c.state === 'BINDING')).toHaveLength(1)
  watcher.assertClean()
})

test('reduced motion removes the movement and keeps the meaning', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await setTools(page, { tensionPrecision: 0, liftJitter: 0 })
  await loadLock(page, 2, 9)

  const fx0 = await getFx(page)
  expect(fx0.reducedMotion, 'the media query should have been picked up').toBe(true)

  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.5 })
  await stepTicks(page, 60)
  const b = await workBinding(page, 0.5, 0.5)
  const before = await getFx(page)
  const atSet = await stepUntil(page, (s) => s.chambers[b]?.state === 'SET')
  const fx = await getFx(page)

  // No shake, no jolt, no camera drift, no positional offset at all.
  expect(fx.shake).toBe(0)
  expect(fx.cameraDrift).toBe(0)
  for (const c of fx.chambers) expect(c.offsetY).toBe(0)

  // But the state still reads: the colour changed, and the plug still turned for real.
  expect(atSet.chambers[b]?.state).toBe('SET')
  expect(fx.fills[b]).not.toBe(before.fills[b])
  expect(atSet.theta).toBeGreaterThan(0)
  watcher.assertClean()
})

test('reduced motion can be toggled back on', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  const normal = await getFx(page)
  expect(normal.reducedMotion).toBe(false)
  await setReducedMotion(page, true)
  expect((await getFx(page)).reducedMotion).toBe(true)
  await setReducedMotion(page, false)
  expect((await getFx(page)).reducedMotion).toBe(false)
  watcher.assertClean()
})

/**
 * The manual play checklist from VERIFICATION.md §7, driven at human pace through real
 * pointer input, with the answers measured rather than guessed. The written answers go in
 * PROGRESS.md; this test is what backs them up.
 */
test('manual play checklist — human-paced input', async ({ page }) => {
  /**
   * The checklist from VERIFICATION.md §7, played through real key events at human pace.
   *
   * The hunt is the part that changed. It used to sweep the pick along the keyway at zero lift
   * and read the meter, which found the binding pin without touching anything; a pin under an
   * unloaded tip now says nothing at all (D-056), so the hunt *pushes* on each chamber in turn
   * and compares. That is both the technique the game now requires and the reason the resistance
   * samples below have anything to say.
   */
  const watcher = await bootGame(page, { frames: 10 })
  await loadLock(page, 2, 33)
  const PROBE = 0.45

  await tension(page, true)
  await pressureStep(page, 5)
  await page.waitForTimeout(200)

  const flexSamples: number[] = []
  const resistanceSamples: number[] = []
  let opened = false
  const deadline = Date.now() + 40_000

  /**
   * One complete hunt, before anything is worked — and outside the clock.
   *
   * The assertions below are about the *spread* between a free pin and the binding one, and the
   * loop that used to collect them was bounded by a 40-second wall clock. Six workers sharing a
   * machine meant fewer sweeps inside that window, and an easy lock opening early meant fewer
   * still, so the spread was measured over whatever samples happened to fit — which failed about
   * one full run in three. The reading the test is actually making needs one clean sweep of every
   * chamber, so it takes one, unconditionally, before the timed part begins.
   */
  {
    const start = await getState(page)
    for (let i = 0; i < start.chambers.length; i += 1) {
      await moveTo(page, i)
      await liftTo(page, PROBE)
      flexSamples.push((await getFx(page)).pickFlex)
      resistanceSamples.push((await getState(page)).resistance)
    }
  }

  while (Date.now() < deadline && !opened) {
    const state = await getState(page)
    if (state.opened) {
      opened = true
      break
    }
    const b = state.bindingChamber
    const c = b >= 0 ? state.chambers[b] : undefined
    if (!c) {
      await page.waitForTimeout(60)
      continue
    }

    // Hunt: push each chamber a little and feel which one refuses to move. This is the motion
    // the whole game is built around.
    for (let i = 0; i < state.chambers.length; i += 1) {
      await moveTo(page, i)
      await liftTo(page, PROBE)
      const fx = await getFx(page)
      const now = await getState(page)
      flexSamples.push(fx.pickFlex)
      resistanceSamples.push(now.resistance)
    }

    // Then work the one that was heavy, creeping up on the window the way a person does.
    await moveTo(page, b)
    for (const fraction of [0.1, 0.3, 0.5]) {
      await liftTo(page, c.setLift + c.captureWindow * fraction)
      const fx = await getFx(page)
      const now = await getState(page)
      flexSamples.push(fx.pickFlex)
      resistanceSamples.push(now.resistance)
      if (now.chambers[b]?.state !== 'BINDING') break
    }
  }
  await tension(page, false)

  const final = await getState(page)
  expect(opened, `states: ${final.chambers.map((c) => c.state).join(',')}`).toBe(true)

  // The pick was bending the whole time, and bending by visibly different amounts between
  // a free pin and the binding one.
  expect(flexSamples.length).toBeGreaterThan(6)
  expect(Math.min(...flexSamples)).toBeGreaterThan(0)
  expect(Math.max(...flexSamples) - Math.min(...flexSamples)).toBeGreaterThan(4)
  /**
   * Resistance really did swing between light and heavy as the pick worked.
   *
   * The high end comes from the simulation's own high-water mark and the low end from the samples,
   * which is not an inconsistency: a sampler that misses a frame misses a *peak*, and cannot
   * invent a trough that was never there. Sampling both ends was flaky under six parallel workers
   * for exactly that reason (D-114).
   */
  expect(final.stats.maxResistance - Math.min(...resistanceSamples)).toBeGreaterThan(0.2)

  // Input stayed connected: the game's own per-frame work through a whole played attempt,
  // measured rather than the browser's throttled frame interval (see pick.spec.ts).
  const fstats = await frameStats(page)
  const sorted = [...fstats.work].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
  expect(median, `median frame work ${median.toFixed(2)}ms`).toBeLessThan(16.6)
  expect(p95, `p95 frame work ${p95.toFixed(2)}ms`).toBeLessThan(16.6)
  watcher.assertClean()
})
