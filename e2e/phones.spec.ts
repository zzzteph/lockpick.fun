/**
 * The D-223 screens on phones — the help pages that grew an entry, and Lesson 3 played by finger.
 *
 * `layout.spec.ts` sweeps the help screen's first and last pages only; D-223 added a fifth readout
 * (counter-rotation) and rewrote the overset entry, which live on the two pages between. And Lesson
 * 3 could not be finished at all (the jam's reset never counted), so the strongest check is to
 * finish its jam-and-reset beat with real touch events on the smallest, a common and the squarest
 * phone.
 */

import { expect, test, type Page } from '@playwright/test'
import { advanceSeconds, bootGame, renderOnce, setManual } from './harness'
import { WRENCH_DRAG_PX, WRENCH_SLIDER, yForStep } from '../src/ui/touch'
import { TENSION_STEPS } from '../src/ui/input'

/** The layout sweep's phone roster (kept in step with `PHONES` in layout.spec.ts). */
const PHONES = [
  { name: 'iphone-se3', width: 667, height: 375 },
  { name: 'iphone-13-mini', width: 629, height: 375 },
  { name: 'iphone-13', width: 664, height: 390 },
  { name: 'iphone-14-pro', width: 660, height: 393 },
  { name: 'iphone-15-pro-max', width: 739, height: 430 },
  { name: 'iphone-16-pro', width: 681, height: 402 },
  { name: 'iphone-17-pro-max', width: 763, height: 440 },
  { name: 'galaxy-s9-plus', width: 658, height: 320 },
  { name: 'galaxy-s24', width: 780, height: 360 },
  { name: 'galaxy-z-flip-7', width: 764, height: 360 },
  { name: 'galaxy-z-fold-7', width: 1016, height: 984 },
  { name: 'galaxy-tab-s9', width: 1024, height: 640 },
  { name: 'iphone-se1', width: 568, height: 320 },
  { name: 'pixel-4a', width: 700, height: 340 },
  { name: 'galaxy-a14', width: 720, height: 340 },
  { name: 'pixel-9-pro-fold', width: 1080, height: 892 },
  { name: 'ipad-mini', width: 1024, height: 768 },
]

type Finding = { kind: string; detail: string }

const SCREENS: { name: string; arrange: (page: Page) => Promise<void> }[] = [
  {
    name: 'help-readouts',
    arrange: async (p) => {
      await p.evaluate(() => {
        globalThis.__shearline!.goto('help')
        globalThis.__shearline!.helpPage(2)
      })
      await renderOnce(p)
    },
  },
  {
    name: 'help-states',
    arrange: async (p) => {
      await p.evaluate(() => {
        globalThis.__shearline!.goto('help')
        globalThis.__shearline!.helpPage(3)
      })
      await renderOnce(p)
    },
  },
  {
    name: 'lesson-3',
    arrange: async (p) => {
      await setManual(p, true)
      await p.evaluate(() => globalThis.__shearline!.startLesson('lesson-2'))
      await advanceSeconds(p, 0.2)
      await renderOnce(p)
    },
  },
]

for (const device of PHONES) {
  test.describe(device.name, () => {
    test.use({ viewport: { width: device.width, height: device.height }, hasTouch: true, isMobile: device.width < 1100 })
    for (const screen of SCREENS) {
      test(`${screen.name} is laid out for ${device.name}`, async ({ page }) => {
        const watcher = await bootGame(page, { frames: 3 })
        await screen.arrange(page)
        const result = await page.evaluate(() => globalThis.__shearline!.auditScreen())
        expect(result.drawn).toBeGreaterThan(3)
        const lines = (result.findings as Finding[]).map((f) => `[${f.kind}] ${f.detail}`)
        expect(lines, `${screen.name} @ ${device.name}`).toEqual([])
        watcher.assertClean()
      })
    }
  })
}

// ── Lesson 3 by finger ──────────────────────────────────────────────────────────────────────

async function toClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    (pt) => {
      const canvas = document.querySelector('canvas')
      if (!canvas) throw new Error('no canvas')
      const rect = canvas.getBoundingClientRect()
      const scale = Math.min(rect.width / 1920, rect.height / 1080)
      return {
        x: rect.left + (rect.width - 1920 * scale) / 2 + pt.x * scale,
        y: rect.top + (rect.height - 1080 * scale) / 2 + pt.y * scale,
      }
    },
    { x, y },
  )
}

async function touch(page: Page, type: string, x: number, y: number, id: number): Promise<void> {
  const c = await toClient(page, x, y)
  await page.evaluate(
    (a) => {
      const canvas = document.querySelector('canvas')!
      const target: EventTarget = a.type === 'pointerdown' ? canvas : window
      target.dispatchEvent(
        new PointerEvent(a.type, { pointerId: a.id, pointerType: 'touch', clientX: a.x, clientY: a.y, bubbles: true, cancelable: true }),
      )
    },
    { type, x: c.x, y: c.y, id },
  )
}

/** Drag the wrench slider to a step, the way a thumb does (touch.spec.ts `setWrench`). */
async function setWrench(page: Page, step: number): Promise<void> {
  const x = WRENCH_SLIDER.x + WRENCH_SLIDER.w / 2
  const y0 = (yForStep(0) + yForStep(1)) / 2
  await touch(page, 'pointerdown', x, y0, 2)
  await touch(page, 'pointermove', x, y0 + 200, 2)
  await touch(page, 'pointerup', x, y0 + 200, 2)
  if (step === 0) return
  const from = yForStep(1) - 10
  const to = from - (step / TENSION_STEPS) * WRENCH_DRAG_PX
  await touch(page, 'pointerdown', x, from, 2)
  for (let k = 1; k <= 6; k += 1) await touch(page, 'pointermove', x, from + ((to - from) * k) / 6, 2)
  await touch(page, 'pointerup', x, to, 2)
}

const lesson = (page: Page) => page.evaluate(() => globalThis.__shearline!.lessonState()!)

for (const device of [PHONES[12]!, PHONES[2]!, PHONES[10]!]) {
  test.describe(`lesson 3 by finger on ${device.name}`, () => {
    test.use({ viewport: { width: device.width, height: device.height }, hasTouch: true, isMobile: true })
    test(`the jam and its reset complete on ${device.name}`, async ({ page }) => {
      const watcher = await bootGame(page, { frames: 3 })
      await setManual(page, true)
      await page.evaluate(() => globalThis.__shearline!.startLesson('lesson-2'))
      await advanceSeconds(page, 0.2)
      await setWrench(page, 5)
      await advanceSeconds(page, 0.5)

      // Push the first pin up and keep holding — "push one pin too far and keep pushing".
      const x = await page.evaluate(() => {
        const f = globalThis.__shearline!.sideFrame()!
        return f.x0 + f.firstChamberX * f.sidePx
      })
      await touch(page, 'pointerdown', x, 820, 1)
      await advanceSeconds(page, 0.15)
      for (let y = 800; y >= 300; y -= 25) {
        await touch(page, 'pointermove', x, y, 1)
        await advanceSeconds(page, 0.1)
      }
      await advanceSeconds(page, 3)
      const jammed = await lesson(page)
      expect(jammed.step, `still on "${jammed.line}"`).toBeGreaterThanOrEqual(2)
      await touch(page, 'pointerup', x, 300, 1)
      await advanceSeconds(page, 0.5)
      // Lifting the finger does not free it: still on the "stuck" step.
      expect((await lesson(page)).step).toBe(2)

      // Drop the wrench — the reset the step waits for.
      await setWrench(page, 0)
      await advanceSeconds(page, 1)
      const after = await lesson(page)
      expect(after.step, `still on "${after.line}"`).toBeGreaterThanOrEqual(3)
      watcher.assertClean()
    })
  })
}
