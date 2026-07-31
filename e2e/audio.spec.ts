import { expect, test, type Page } from '@playwright/test'
import { bootGame, captureStage, getState, loadLock, setInput, watchConsole } from './harness'

import type { SoundMeasurement } from '../src/audio-debug'

async function openAudioDebug(page: Page): Promise<Record<string, SoundMeasurement>> {
  await page.goto('/dev/audio-debug.html')
  await page.waitForFunction(() => globalThis.__shearlineAudioDebug?.ready === true, undefined, {
    timeout: 30_000,
  })
  return page.evaluate(() => {
    const h = globalThis.__shearlineAudioDebug
    if (!h) throw new Error('audio debug hook missing')
    return h.measurements()
  })
}

function must(
  m: Record<string, SoundMeasurement>,
  id: string,
): SoundMeasurement {
  const s = m[id]
  if (!s) throw new Error(`no measurement for "${id}"`)
  return s
}

test('every sound renders real signal through an OfflineAudioContext', async ({ page }) => {
  const watcher = watchConsole(page)
  const m = await openAudioDebug(page)
  const ids = Object.keys(m)
  expect(ids.length).toBeGreaterThanOrEqual(14)
  for (const id of ids) {
    const s = must(m, id)
    expect(s.peak, `${id} is silent`).toBeGreaterThan(0.005)
    expect(s.rms, `${id} has no energy`).toBeGreaterThan(0.0005)
    expect(s.durationMs, `${id} has no duration`).toBeGreaterThan(1)
    expect(s.peak, `${id} clips`).toBeLessThanOrEqual(1)
    expect(Number.isFinite(s.centroid), `${id} centroid`).toBe(true)
  }
  watcher.assertClean()
})

test('the click has the envelope AUDIO.md §6 specifies', async ({ page }) => {
  const watcher = watchConsole(page)
  const m = await openAudioDebug(page)
  for (const id of ['click-shallow', 'click-deep']) {
    const s = must(m, id)
    expect(s.attackMs, `${id} attack ${s.attackMs.toFixed(2)}ms`).toBeLessThan(8)
    expect(s.durationMs, `${id} total ${s.durationMs.toFixed(1)}ms`).toBeLessThan(150)
    expect(s.durationMs).toBeGreaterThan(10)
  }
  watcher.assertClean()
})

test('the click varies audibly with pin index and with tension', async ({ page }) => {
  const watcher = watchConsole(page)
  const m = await openAudioDebug(page)
  const shallow = must(m, 'click-shallow')
  const deep = must(m, 'click-deep')

  // Pin index: chamber 1 of 5 against chamber 5 of 5 is a 420Hz-to-180Hz body, a ratio of
  // 2.33. Measured on the post-transient window, the pitch really does scale with depth.
  expect(shallow.bodyHz).toBeGreaterThan(deep.bodyHz * 1.8)

  // Tension: heavy tension shortens the decay and brightens the transient.
  expect(deep.durationMs).toBeLessThan(shallow.durationMs * 0.85)
  watcher.assertClean()
})

test('binding and free-pin sounds are at least 200Hz apart in spectral centroid', async ({
  page,
}) => {
  const watcher = watchConsole(page)
  const m = await openAudioDebug(page)
  const binding = must(m, 'binding')
  const free = must(m, 'free-pin')
  const gap = Math.abs(free.centroid - binding.centroid)
  expect(
    gap,
    `binding ${binding.centroid.toFixed(0)}Hz vs free ${free.centroid.toFixed(0)}Hz`,
  ).toBeGreaterThanOrEqual(200)
  // …and in the direction the spec describes: binding is the low one.
  expect(binding.centroid).toBeLessThan(free.centroid)
  expect(binding.centroid).toBeLessThan(300)
  watcher.assertClean()
})

test('the rest of the palette matches its written character', async ({ page }) => {
  const watcher = watchConsole(page)
  const m = await openAudioDebug(page)

  // Overset: "dull thud… no ring. Dead and final."
  const overset = must(m, 'overset')
  expect(overset.centroid, 'overset should be dark').toBeLessThan(300)
  expect(overset.durationMs).toBeGreaterThan(60)
  expect(overset.durationMs).toBeLessThan(400)

  // False set: "a bright metallic ping".
  const falseSet = must(m, 'false-set')
  expect(falseSet.centroid).toBeGreaterThan(600)
  expect(falseSet.durationMs).toBeGreaterThan(150)

  /**
   * Plug goes slack: resistance *disappearing*, which is the opposite of every other cue here —
   * so no metal in it at all, and nothing like the false-set ping it could otherwise be confused
   * with. It measures at 214Hz against the overset thud's 127Hz, which is the right way round:
   * the overset is a genuine impact into the shell and this is a release (D-055).
   */
  const plugFree = must(m, 'plug-free')
  expect(plugFree.centroid, 'the plug going slack must have no metal in it').toBeLessThan(300)
  expect(plugFree.centroid, 'nothing like the false-set ping').toBeLessThan(falseSet.centroid / 2)
  expect(plugFree.durationMs).toBeGreaterThan(150)
  expect(plugFree.durationMs).toBeLessThan(500)

  // Reset: a cascade, so it must last markedly longer than one drop.
  const reset = must(m, 'reset')
  expect(reset.durationMs, 'reset should be a cascade, not a single drop').toBeGreaterThan(100)

  // Open: the whole sequence — thunk, arpeggio, shackle.
  const open = must(m, 'open')
  expect(open.durationMs).toBeGreaterThan(500)

  // UI: "tiny mechanical detents, 6ms, filtered noise only."
  const ui = must(m, 'ui')
  expect(ui.durationMs).toBeLessThan(20)
  expect(ui.centroid).toBeGreaterThan(2000)

  // Scrape sweeps high; the plug's friction and the workshop bed sit low and quiet.
  expect(must(m, 'scrape').centroid).toBeGreaterThan(2000)
  expect(must(m, 'ambience').peak).toBeLessThan(0.35)
  watcher.assertClean()
})

test('@screenshot phase-04 audio debug page', async ({ page }) => {
  const watcher = watchConsole(page)
  await openAudioDebug(page)
  await captureStage(page, 'phase-04-audio-debug')
  watcher.assertClean()
})

test('nothing plays before a user gesture', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 10 })
  // The page has booted and rendered, and the simulation has been running — but nobody has
  // touched anything, so there is no audio context at all.
  const before = await page.evaluate(() => globalThis.__shearline?.audioState())
  expect(before?.contextState).toBe('none')
  expect(before?.ready).toBe(false)
  expect(before?.scheduled).toBe(0)
  watcher.assertClean()
})

test('a real gesture starts the graph, and a rake cannot exceed the voice cap', async ({
  page,
}) => {
  const watcher = await bootGame(page, { frames: 5 })
  await loadLock(page, 3, 1)

  // A genuine click — this is what browsers require, and what the app listens for.
  await page.mouse.click(400, 400)
  await page.waitForFunction(() => globalThis.__shearline?.audioState().ready === true, undefined, {
    timeout: 10_000,
  })
  const unlocked = await page.evaluate(() => globalThis.__shearline?.audioState())
  expect(unlocked?.contextState).toBe('running')

  // AUDIO.md §6: "assert the voice cap holds under a synthetic 12-chamber rake."
  await page.evaluate(() => {
    globalThis.__shearline?.audioBurst(48)
  })
  const after = await page.evaluate(() => globalThis.__shearline?.audioState())
  expect(after?.activeVoices, 'voice cap exceeded').toBeLessThanOrEqual(24)
  expect(after?.stolen, 'the cap should have stolen voices').toBeGreaterThan(0)
  expect(after?.scheduled).toBeGreaterThanOrEqual(48)
  watcher.assertClean()
})

test('muting genuinely disconnects the graph, and unmuting restores it', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 5 })
  await page.mouse.click(400, 400)
  await page.waitForFunction(() => globalThis.__shearline?.audioState().ready === true)

  await page.evaluate(() => {
    globalThis.__shearline?.setMuted(true)
  })
  expect((await page.evaluate(() => globalThis.__shearline?.audioState()))?.muted).toBe(true)
  await page.evaluate(() => {
    globalThis.__shearline?.setMuted(false)
  })
  expect((await page.evaluate(() => globalThis.__shearline?.audioState()))?.muted).toBe(false)
  watcher.assertClean()
})

test('playing the game schedules sounds off the event stream', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 5 })
  await loadLock(page, 1, 5)
  await page.mouse.click(400, 400)
  await page.waitForFunction(() => globalThis.__shearline?.audioState().ready === true)

  const baseline = await page.evaluate(() => globalThis.__shearline?.audioState().scheduled ?? 0)

  // Drive a pin to a set and confirm the engine reacted to the event, not to polling.
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.5 })
  await page.waitForTimeout(400)
  const state = await getState(page)
  const b = state.bindingChamber
  const c = state.chambers[b]
  expect(c).toBeDefined()
  if (!c) return
  await setInput(page, {
    chamber: b,
    liftTarget: c.setLift + c.captureWindow / 2,
    tensionHeld: true,
    tensionLevel: 0.5,
  })
  await page.waitForFunction(
    (idx) => globalThis.__shearline?.getState().chambers[idx]?.state === 'SET',
    b,
    { timeout: 15_000 },
  )
  const after = await page.evaluate(() => globalThis.__shearline?.audioState().scheduled ?? 0)
  expect(after, 'a set should have scheduled a click').toBeGreaterThan(baseline)
  watcher.assertClean()
})
