import { SHEAR_Y } from '../src/render/layout'
// The trim's step, so the paired gate test bounds itself against the real constant (D-111).
import { KEY_LIFT_NUDGE } from '../src/ui/input'
import { expect, test } from '@playwright/test'
import {
  bootGame,
  frameStats,
  getGeometry,
  getState,
  loadLock,
  pressureStep,
  setAssist,
  scriptPin,
  setInput,
  setManual,
  stepTicks,
  tension,
  workChamber,
  pause,
  useSteppedClock,
} from './harness'

const SHEAR_LINE_MM = 0

// Retired (D-230): 'rendered pin positions match sim state exactly' checked the old cutaway's
// geometry against the rate sim. Since the sidebar and magnetic locks moved to the solver no lock
// draws the cutaway; the side view is drawn from the solver's own bodies and cannot disagree.

test('a set pin reads as captured: driver above the shear line, plug ledge under it', async ({
  page,
}) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await loadLock(page, 1, 5)

  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.5 })
  await stepTicks(page, 60)
  let state = await getState(page)
  const binding = state.bindingChamber
  expect(binding).toBeGreaterThanOrEqual(0)
  const target = state.chambers[binding]
  expect(target).toBeDefined()
  if (!target) return

  const offsetBefore = state.ledgeOffset
  await scriptPin(page, binding, target.setLift + target.captureWindow / 2, 0.5, 180)

  state = await getState(page)
  expect(state.chambers[binding]?.state).toBe('SET')

  const geom = await getGeometry(page)
  const g = geom.chambers[binding]
  expect(g).toBeDefined()
  if (!g) return
  const shearY = geom.layout.shearY - SHEAR_LINE_MM * geom.layout.mmToPx
  // The driver's bottom is now at or above the shear line…
  expect(g.driver.y + g.driver.h).toBeLessThanOrEqual(shearY + 1e-6)
  // …and the plug has taken up rotation, sliding its bore out from under the shell's.
  expect(state.ledgeOffset).toBeGreaterThan(offsetBefore)
  expect(g.plugX).toBeGreaterThan(g.shellX)
  watcher.assertClean()
})

test('scripted input opens the practice lock end to end', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await loadLock(page, 2, 4)

  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.5 })
  await stepTicks(page, 60)

  for (let round = 0; round < 8; round += 1) {
    const state = await getState(page)
    if (state.opened) break
    const b = state.bindingChamber
    if (b < 0) {
      await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.6 })
      await stepTicks(page, 120)
      continue
    }
    const c = state.chambers[b]
    if (!c) break
    await scriptPin(page, b, c.setLift + c.captureWindow / 2, 0.5, 180)
  }

  const final = await getState(page)
  expect(final.opened, `states: ${final.chambers.map((c) => c.state).join(',')}`).toBe(true)
  expect(final.chambers.every((c) => c.state === 'SET')).toBe(true)
  expect(final.stats.setOrder).toHaveLength(final.lock.chamberCount)
  watcher.assertClean()
})

test('a human can open the lock from the keyboard', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await loadLock(page, 1, 3)

  // Q is the wrench; the arrows walk the tip; Space pushes. That is the whole scheme (D-059).
  await tension(page, true)
  await pressureStep(page, 5)

  const deadline = Date.now() + 40_000
  let opened = false
  while (Date.now() < deadline) {
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
    await workChamber(page, b, c.setLift + c.captureWindow * 0.5)
    await page.waitForTimeout(90)
  }
  await tension(page, false)

  const final = await getState(page)
  expect(opened, `not opened; states: ${final.chambers.map((s) => s.state).join(',')}`).toBe(true)
  watcher.assertClean()
})

/**
 * The fine lift — DECISIONS D-105.
 *
 * This is the test that did not exist, which is exactly why the feature did not work. Arrow up and
 * arrow down added to the *held* lift, which decays at 0.112mm per frame the moment Space is not
 * down — so a 0.06mm nudge was wiped before the next read and the keys did nothing at all, in
 * every situation, from the day they were written. Reported from play as "fine lift seems to be
 * not working".
 *
 * Pressed as real keys through the browser rather than driven through `setInput`, because
 * `setInput` writes a lift straight into the simulation and would have passed happily against the
 * broken controller. The bug was entirely in the input layer; the test has to go through it.
 */
test('the arrow keys move the pick, and the nudge survives the spring-back', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  // Training, because the trim is a teaching control and exists on no other level (D-111).
  await setAssist(page, 'training')
  await loadLock(page, 1, 3)
  // Real keys on the game's own clock (D-235): the pin's rise and fall are timed in game time.
  await useSteppedClock(page, true)

  // No wrench anywhere in this test. Without tension nothing can bind and nothing can capture, so
  // the only thing that can move a pin is the tip under it — which makes the pin's height a direct
  // readout of the input layer and nothing else.
  // The tip travels along the keyway rather than teleporting (D-045), so give it the moment it
  // takes to arrive at the chamber the keyboard already has it pointed at.
  for (let i = 0; i < 100 && (await getState(page)).pickChamber !== 0; i += 1) await pause(page, 50)
  expect((await getState(page)).pickChamber).toBe(0)
  const rest = (await getState(page)).chambers[0]?.lift ?? 0

  // Ten taps up. Space is never pressed — the point is that the trim stands on its own.
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowUp')
  // Long enough for the hand's ramp to finish (D-235): at 250 ms of game time the pin was still on
  // its way (0.21 mm); on the wall clock that was a race the slow frames lost.
  await pause(page, 800)
  const lifted = (await getState(page)).chambers[0]?.lift ?? 0
  // 0.3, not 0.5, on the solver (D-226): the resting tip sits under the key pin, and the first taps
  // close that gap before the pin moves — 1.2 mm asked raises it ~0.47 on the practice cutaway.
  expect(lifted, 'ten taps of ArrowUp must raise the pin').toBeGreaterThan(rest + 0.3)

  /**
   * …and it *stays* there. This is the half the old code could never do: a full second with no key
   * down at all, and the tip has not sagged back to the keyway floor.
   *
   * Bounded against the trim's own step, not to two decimal places. A pin under a tip that is
   * holding still is not *perfectly* still — the wrench wobble and the spring leave a few
   * thousandths of a millimetre of drift — and 0.005 is a tighter bound than that noise. Caught by
   * running the gate from a bare clone, where it drifted 0.007. What the assertion means is "it did
   * not sag", and sagging would be measured in whole nudges.
   */
  await pause(page, 1000)
  const sag = Math.abs((await getState(page)).chambers[0]?.lift ?? 0) - lifted
  expect(Math.abs(sag), 'the trim must hold with no key down').toBeLessThan(KEY_LIFT_NUDGE / 2)

  // Down again, symmetrically, and the spring takes the pin back.
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowDown')
  await pause(page, 800)
  expect((await getState(page)).chambers[0]?.lift ?? 0).toBeLessThan(rest + 0.2)

  await useSteppedClock(page, false)
  watcher.assertClean()
})

/**
 * …and nowhere else — DECISIONS D-111.
 *
 * The paired half. Without it, "the trim is Training only" is a claim in a comment: the test above
 * would pass just as happily if the gate did nothing, because it sets Training itself.
 */
test('the fine trim is Training only, and the legend does not claim it elsewhere', async ({
  page,
}) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setAssist(page, 'normal')
  await loadLock(page, 1, 3)
  // Real keys on the game's own clock (D-235): the pin's rise and fall are timed in game time.
  await useSteppedClock(page, true)
  for (let i = 0; i < 100 && (await getState(page)).pickChamber !== 0; i += 1) await pause(page, 50)
  expect((await getState(page)).pickChamber).toBe(0)

  const rest = (await getState(page)).chambers[0]?.lift ?? 0
  for (let i = 0; i < 20; i += 1) await page.keyboard.press('ArrowUp')
  await pause(page, 300)
  /**
   * Bounded against the trim's own step rather than to N decimal places.
   *
   * Twenty taps would be 20 x `KEY_LIFT_NUDGE` = 2.4mm if the gate were open. What is actually
   * left is a few thousandths of a millimetre of the pin still settling under a tip that has just
   * finished travelling along the keyway — real, unrelated, and not something to pin to three
   * decimals. Half a single tap is decisive and does not measure the settle.
   */
  const drift = Math.abs(((await getState(page)).chambers[0]?.lift ?? 0) - rest)
  expect(drift, 'twenty taps of ArrowUp must do nothing off Training').toBeLessThan(
    KEY_LIFT_NUDGE / 2,
  )

  // Space still lifts, so the pin is reachable — this is the trim being off, not the lock being
  // stuck or the keyboard being ignored.
  await page.keyboard.down('Space')
  // Long enough to close the tip-to-pin gap on the solver and lift past it (D-226).
  await pause(page, 450)
  const held = (await getState(page)).chambers[0]?.lift ?? 0
  await page.keyboard.up('Space')
  expect(
    held,
    'Space must still lift — only the trim is gated',
  ).toBeGreaterThan(rest + 0.3)
  await useSteppedClock(page, false)
  watcher.assertClean()
})

/**
 * A smoke check on per-frame cost — **not** the 60fps claim.
 *
 * Asserted on the *work* the game does per frame rather than the interval between frames, because
 * a headless Chromium under six parallel workers throttles `requestAnimationFrame` to 30Hz however
 * idle the page is. That much was always right. What was wrong is the bound: this test ran a
 * **p95 < 16.6ms** assertion from inside the parallel suite, where five other Chromiums are
 * competing for the same cores — so the work genuinely does take longer, and the number it was
 * checking was partly a measurement of the machine.
 *
 * It failed at 18.4ms in a full run and passed three times out of three on its own, which is the
 * signature D-022 and D-038 both describe. The honest 60fps measurement is `npm run perf`: one
 * worker, nothing else running, four seconds of samples and a histogram, exactly so that the
 * percentile means something.
 *
 * So this keeps the assertion it can make under load — the median frame is nowhere near the
 * budget, which catches a real regression like an accidental O(n²) in the draw — and leaves the
 * tail to the test that can measure it properly. The p95 bound is two frames' worth: it is there
 * to catch a stall, not to certify a frame rate.
 */
test('simulate and draw cost a sane amount per frame', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 10 })
  await loadLock(page, 3, 1)
  await setInput(page, { chamber: 1, liftTarget: 1.2, tensionHeld: true, tensionLevel: 0.45 })
  await page.waitForTimeout(2000)

  const stats = await frameStats(page)
  const work = stats.work.slice(-100)
  expect(work.length).toBeGreaterThan(20)
  const sorted = [...work].sort((a, b) => a - b)
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
  const median = sorted[Math.floor(sorted.length * 0.5)] ?? 0
  expect(median, `median frame work ${median.toFixed(2)}ms`).toBeLessThan(16.6)
  expect(p95, `p95 frame work ${p95.toFixed(2)}ms`).toBeLessThan(33.2)
  watcher.assertClean()
})

test('the cutaway rescales without distortion', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await loadLock(page, 3, 1)
  const sizes = [
    { width: 1280, height: 720 },
    { width: 1000, height: 900 },
    { width: 1920, height: 1080 },
  ]
  // Captured from the first size and compared against the rest, rather than pinned to a
  // constant: the claim is that resolution does not change the layout, not that the layout is
  // any particular width. Asserting `left === 384` made this a test of the framing *rule*, and
  // it duly failed when the rule changed for reasons that had nothing to do with rescaling.
  let reference: { left: number; right: number; pitch: number; driverWidth: number } | null = null
  for (const size of sizes) {
    await page.setViewportSize(size)
    await page.waitForTimeout(120)
    const info = await page.evaluate(() => {
      const c = document.getElementById('stage') as HTMLCanvasElement
      const rect = c.getBoundingClientRect()
      return { w: rect.width, h: rect.height, bw: c.width, bh: c.height, dpr: devicePixelRatio }
    })
    expect(info.bw).toBe(Math.round(info.w * info.dpr))
    expect(info.bh).toBe(Math.round(info.h * info.dpr))
    // Logical geometry is resolution independent: the same lock lays out identically.
    const geom = await getGeometry(page)
    // Read from the constant: the claim is that resolution does not move the layout, not that the
    // shear line is at any particular y — which is a number that gets tuned (D-096).
    expect(geom.layout.shearY).toBe(SHEAR_Y)
    const seen = {
      left: geom.layout.left,
      right: geom.layout.right,
      pitch: geom.layout.pitch,
      driverWidth: geom.layout.driverWidth,
    }
    if (reference === null) reference = seen
    else expect(seen, `at ${size.width}x${size.height}`).toEqual(reference)
  }
  // The lock is centred and on screen at every one of them.
  expect(reference).not.toBeNull()
  if (reference) expect((reference.left + reference.right) / 2).toBeCloseTo(1920 / 2, 6)
  watcher.assertClean()
})

// Retired (D-230): 'the pick is drawn where the tip is' tested the cutaway's pick; the side view
// draws the solver's own pick polygon, and `hook.pickTip` reports its tip.

// Retired (D-226): 'a short hook reaches the pins nearest the keyway mouth' tested the kit's
// `reach` stat, which the solver does not model (and D-088 made unlimited). Owner: retire.
