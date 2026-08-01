/**
 * Picking with a finger — DECISIONS D-082.
 *
 * `tests/game/touch.test.ts` proves the gesture arithmetic. This proves the thing that actually
 * matters: that real pointer events with `pointerType: 'touch'` reach the simulation, that the
 * wrench slider applies tension, that a tap selects a pin and a drag lifts it — and that a lock
 * can be opened this way with nothing but touches.
 */

import { expect, test, type Page } from '@playwright/test'
import { advanceSeconds, bootGame, getState, loadLock, setManual } from './harness'
import { WRENCH_DRAG_PX, WRENCH_SLIDER, yForStep } from '../src/ui/touch'
import { TENSION_STEPS } from '../src/ui/input'

/** The starter lock: few pins, forgiving, standard drivers. */
const PRACTICE = 1

test.use({ hasTouch: true })

/** Logical stage coordinates to client coordinates, mirroring the letterbox in `viewport.ts`. */
async function toClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([lx, ly]) => {
      const canvas = document.querySelector('canvas')
      if (!canvas) throw new Error('no canvas')
      const rect = canvas.getBoundingClientRect()
      const scale = Math.min(rect.width / 1920, rect.height / 1080)
      const offsetX = (rect.width - 1920 * scale) / 2
      const offsetY = (rect.height - 1080 * scale) / 2
      return { x: rect.left + offsetX + lx * scale, y: rect.top + offsetY + ly * scale }
    },
    [x, y] as [number, number],
  )
}

type TouchKind = 'pointerdown' | 'pointermove' | 'pointerup'

/** Dispatch a real PointerEvent of touch type at a logical stage position. */
async function touch(page: Page, kind: TouchKind, x: number, y: number, id = 1): Promise<void> {
  const c = await toClient(page, x, y)
  await page.evaluate(
    (args: { type: string; clientX: number; clientY: number; pointerId: number }) => {
      const canvas = document.querySelector('canvas')
      if (!canvas) throw new Error('no canvas')
      // `pointerdown` is bound to the canvas; move and up are bound to the window, because a drag
      // that leaves the canvas must keep tracking (D-082).
      const target: EventTarget = args.type === 'pointerdown' ? canvas : window
      target.dispatchEvent(
        new PointerEvent(args.type, {
          pointerId: args.pointerId,
          pointerType: 'touch',
          clientX: args.clientX,
          clientY: args.clientY,
          bubbles: true,
          cancelable: true,
        }),
      )
    },
    { type: kind, clientX: c.x, clientY: c.y, pointerId: id },
  )
}

/**
 * Put the wrench on a given pressure step and leave it there.
 *
 * **A drag, not a tap** — DECISIONS D-131. The slider used to be absolute, so touching a band set
 * the tension to it; it is relative and geared now, because a jump on this control drops every pin
 * already set, and eleven bands in 482px is eighteen CSS pixels a step against a fingertip four
 * times that wide. So this does what a thumb does: grab, travel, release. Tension persists after
 * the release — the slider *is* the wrench, and it stays where it was put.
 */
async function setWrench(page: Page, step: number): Promise<void> {
  const x = WRENCH_SLIDER.x + WRENCH_SLIDER.w / 2
  if (step <= 0) {
    // The fat bottom band means off however the drag arrived in it, so a tap there is enough.
    const y = (yForStep(0) + yForStep(1)) / 2
    await touch(page, 'pointerdown', x, y, 2)
    await touch(page, 'pointerup', x, y, 2)
    return
  }
  // Start just clear of the off zone, or the grab itself would read as a release.
  const from = yForStep(1) - 10
  const to = from - (step / TENSION_STEPS) * WRENCH_DRAG_PX
  await touch(page, 'pointerdown', x, from, 2)
  await touch(page, 'pointermove', x, to, 2)
  await touch(page, 'pointerup', x, to, 2)
}

test('a finger on the wrench applies tension, and taking it off releases it', async ({ page }) => {
  const watcher = await bootGame(page)
  await loadLock(page, PRACTICE, 3)
  await setManual(page, true)

  expect((await getState(page)).tension).toBe(0)

  await setWrench(page, 5)
  await advanceSeconds(page, 0.5)
  const held = await getState(page)
  expect(held.tension).toBeGreaterThan(0.3)

  // The bottom band is "off" — the release that a feather needs.
  await setWrench(page, 0)
  await advanceSeconds(page, 0.5)
  expect((await getState(page)).tension).toBe(0)
  watcher.assertClean()
})

test('tapping a pin selects it without lifting it', async ({ page }) => {
  const watcher = await bootGame(page)
  await loadLock(page, PRACTICE, 3)
  await setManual(page, true)
  await setWrench(page, 5)

  const geometry = await page.evaluate(() => globalThis.__shearline?.getGeometry())
  const centres = (geometry?.chambers ?? []).map((c) => c.shellX)
  expect(centres.length).toBeGreaterThan(1)
  const target = centres[1] ?? 960

  await touch(page, 'pointerdown', target, 600)
  await touch(page, 'pointerup', target, 600)
  await advanceSeconds(page, 0.4)

  const state = await getState(page)
  expect(state.pickChamber).toBe(1)
  // A tap is a tap: the tip arrives at rest, so nothing has been pushed anywhere.
  expect(state.chambers[1]?.keyLift ?? 1).toBeLessThan(0.05)
  watcher.assertClean()
})

test('dragging up lifts the pin under the finger, and letting go drops it', async ({ page }) => {
  const watcher = await bootGame(page)
  await loadLock(page, PRACTICE, 3)
  await setManual(page, true)
  await setWrench(page, 5)

  const geometry = await page.evaluate(() => globalThis.__shearline?.getGeometry())
  const target = (geometry?.chambers ?? [])[0]?.shellX ?? 960

  await touch(page, 'pointerdown', target, 800)
  await advanceSeconds(page, 0.2)
  await touch(page, 'pointermove', target, 500)
  await advanceSeconds(page, 0.6)
  const lifted = await getState(page)
  expect(lifted.chambers[0]?.keyLift ?? 0).toBeGreaterThan(0.2)

  await touch(page, 'pointerup', target, 500)
  await advanceSeconds(page, 1.2)
  const dropped = await getState(page)
  if (dropped.chambers[0]?.state !== 'SET') {
    expect(dropped.chambers[0]?.keyLift ?? 1).toBeLessThan(0.1)
  }
  watcher.assertClean()
})

/**
 * Playable at every size, not merely laid out at every size — DECISIONS D-135.
 *
 * `layout.spec.ts` proves nothing collides and everything is readable and reachable on nineteen
 * devices. It cannot prove the game can be *finished* on them: the wrench is a geared drag, the lift
 * is a geared drag, and both are expressed in logical pixels that shrink with the stage. On the
 * smallest phone a full-range wrench drag is 620 logical px against a 320px-tall viewport — the
 * gesture leaves the screen, and whether that still works is a question about pointer capture, not
 * about layout.
 *
 * So the strongest usability assertion available is run at the edges of the matrix: open a lock,
 * with touches only, on the smallest screen a browser ships and on the largest fold.
 */
const PLAYABLE_ON = [
  { name: 'iphone-se1', width: 568, height: 320 },
  { name: 'galaxy-s9-plus', width: 658, height: 320 },
  { name: 'iphone-13', width: 664, height: 390 },
  { name: 'galaxy-z-fold-7', width: 1016, height: 984 },
]

for (const device of PLAYABLE_ON) {
  test.describe(`playable on ${device.name}`, () => {
    test.use({ viewport: { width: device.width, height: device.height } })

    test(`a lock can be opened with touches alone on ${device.name}`, async ({ page }) => {
      const watcher = await bootGame(page)
      await loadLock(page, PRACTICE, 3)
      await setManual(page, true)
      await setWrench(page, 5)

      const geometry = await page.evaluate(() => globalThis.__shearline?.getGeometry())
      const centres = (geometry?.chambers ?? []).map((c) => c.shellX)

      for (let attempt = 0; attempt < 24; attempt += 1) {
        const state = await getState(page)
        if (state.opened) break
        const binding = state.bindingChamber
        const index = binding >= 0 ? binding : attempt % Math.max(1, centres.length)
        const x = centres[index] ?? 960
        await touch(page, 'pointerdown', x, 820)
        await advanceSeconds(page, 0.15)
        for (let y = 800; y >= 480; y -= 40) {
          await touch(page, 'pointermove', x, y)
          await advanceSeconds(page, 0.12)
          const now = await getState(page)
          if (now.chambers[index]?.state === 'SET') break
          if (now.chambers[index]?.state === 'OVERSET') break
        }
        await touch(page, 'pointerup', x, 480)
        await advanceSeconds(page, 0.3)
      }

      expect((await getState(page)).opened, `could not open the lock on ${device.name}`).toBe(true)
      watcher.assertClean()
    })
  })
}

test('a lock can be opened with touches alone', async ({ page }) => {
  const watcher = await bootGame(page)
  await loadLock(page, PRACTICE, 3)
  await setManual(page, true)
  await setWrench(page, 5)

  const geometry = await page.evaluate(() => globalThis.__shearline?.getGeometry())
  const centres = (geometry?.chambers ?? []).map((c) => c.shellX)

  // Work whatever binds, the way a player would: tap it, drag up until it stops moving, let go.
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const state = await getState(page)
    if (state.opened) break
    const binding = state.bindingChamber
    const index = binding >= 0 ? binding : attempt % Math.max(1, centres.length)
    const x = centres[index] ?? 960
    await touch(page, 'pointerdown', x, 820)
    await advanceSeconds(page, 0.15)
    // Creep up in steps rather than one jump, so the capture window is not flown through.
    for (let y = 800; y >= 480; y -= 40) {
      await touch(page, 'pointermove', x, y)
      await advanceSeconds(page, 0.12)
      const now = await getState(page)
      if (now.chambers[index]?.state === 'SET') break
      if (now.chambers[index]?.state === 'OVERSET') break
    }
    await touch(page, 'pointerup', x, 480)
    await advanceSeconds(page, 0.3)
  }

  expect((await getState(page)).opened).toBe(true)
  watcher.assertClean()
})

test('touches on the bench do not reach the lock', async ({ page }) => {
  const watcher = await bootGame(page)
  await page.evaluate(() => {
    globalThis.__shearline?.goto('bench')
  })
  // The wrench slider's rectangle overlaps the bench's left column. It must be inert there.
  await setWrench(page, 8)
  await page.evaluate(() => {
    globalThis.__shearline?.renderOnce()
  })
  expect(await page.evaluate(() => globalThis.__shearline?.getScreen())).toBe('bench')
  watcher.assertClean()
})
