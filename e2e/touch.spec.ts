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
import { WRENCH_SLIDER, yForStep } from '../src/ui/touch'

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

/** Put the wrench on a given pressure step and leave it there. */
async function setWrench(page: Page, step: number): Promise<void> {
  const y = (yForStep(step) + yForStep(step + 1)) / 2
  const x = WRENCH_SLIDER.x + WRENCH_SLIDER.w / 2
  await touch(page, 'pointerdown', x, y, 2)
  await touch(page, 'pointerup', x, y, 2)
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
