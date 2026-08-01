/**
 * What the game actually looks like on a phone.
 *
 * The stage is a fixed 1920x1080 logical space letterboxed into whatever viewport it is given, so
 * every screen "works" on a phone in the sense that nothing breaks — and every piece of type
 * shrinks by the same factor as the stage. That is the thing worth photographing: a 17px label on
 * a 390px-tall landscape phone renders at about six CSS pixels, and no assertion in the suite can
 * tell you whether six pixels is readable.
 *
 * These write the PNGs. `captureStage` asserts each has real ink on it; the rest is for human eyes.
 */

import { expect, test, type Page } from '@playwright/test'
import { bootGame, captureStage, loadLock, renderOnce, setInput, setManual, stepTicks } from './harness'

/** iPhone 14-ish, landscape — the orientation the game asks for. */
const PHONE_LANDSCAPE = { width: 844, height: 390 }
/** The same phone held upright, which is how anybody opens a link. */
const PHONE_PORTRAIT = { width: 390, height: 844 }
/** A small tablet, the other common touch shape. */
const TABLET_LANDSCAPE = { width: 1180, height: 820 }

async function goto(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    globalThis.__shearline?.goto(n)
  }, name)
  await renderOnce(page)
}

/**
 * Put the game into touch mode with a real `PointerEvent`, the way `touch.spec.ts` does.
 *
 * Playwright's `touchscreen.tap` does not reach the canvas `pointerdown` listener in this setup,
 * and `touch.active` is what decides whether the wrench slider and pads are drawn at all — so
 * without this every "mobile" screenshot is the desktop chrome at a phone size.
 */
async function touchTap(page: Page, logicalX: number, logicalY: number): Promise<void> {
  const client = await page.evaluate(
    (pt) => {
      const c = document.querySelector('canvas') as HTMLCanvasElement
      const r = c.getBoundingClientRect()
      const scale = Math.min(r.width / 1920, r.height / 1080)
      return {
        x: r.left + (r.width - 1920 * scale) / 2 + pt.x * scale,
        y: r.top + (r.height - 1080 * scale) / 2 + pt.y * scale,
      }
    },
    { x: logicalX, y: logicalY },
  )
  await page.evaluate((c) => {
    const canvas = document.querySelector('canvas')
    if (!canvas) throw new Error('no canvas')
    const ev = (type: string, target: EventTarget): void => {
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: 'touch',
          clientX: c.x,
          clientY: c.y,
          bubbles: true,
          cancelable: true,
        }),
      )
    }
    ev('pointerdown', canvas)
    ev('pointerup', window)
  }, client)
  await renderOnce(page)
}

/** Logical stage point -> client point, the same mapping `touchTap` does. */
async function toClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    (pt) => {
      const c = document.querySelector('canvas') as HTMLCanvasElement
      const r = c.getBoundingClientRect()
      const scale = Math.min(r.width / 1920, r.height / 1080)
      return {
        x: r.left + (r.width - 1920 * scale) / 2 + pt.x * scale,
        y: r.top + (r.height - 1080 * scale) / 2 + pt.y * scale,
      }
    },
    { x, y },
  )
}

/** A real touch drag: down at one logical point, moved to another, released. */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { release?: boolean } = {},
): Promise<void> {
  const a = await toClient(page, from.x, from.y)
  const b = await toClient(page, to.x, to.y)
  await page.evaluate(
    ({ a, b, release }) => {
      const canvas = document.querySelector('canvas')
      if (!canvas) throw new Error('no canvas')
      const at = (type: string, target: EventTarget, p: { x: number; y: number }): void => {
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 7,
            pointerType: 'touch',
            clientX: p.x,
            clientY: p.y,
            bubbles: true,
            cancelable: true,
          }),
        )
      }
      at('pointerdown', canvas, a)
      // Several moves rather than one, because the wrench is relative: it integrates travel from
      // where the finger went down, and a single jump is still a single delta (D-131).
      for (let i = 1; i <= 8; i += 1) {
        at('pointermove', window, {
          x: a.x + ((b.x - a.x) * i) / 8,
          y: a.y + ((b.y - a.y) * i) / 8,
        })
      }
      if (release) at('pointerup', window, b)
    },
    { a, b, release: opts.release ?? true },
  )
  await renderOnce(page)
}

test.describe('phone, landscape', () => {
  test.use({ viewport: PHONE_LANDSCAPE, hasTouch: true, isMobile: true })

  test('@screenshot the menu on a phone', async ({ page }) => {
    const watcher = await bootGame(page)
    await captureStage(page, 'mobile-menu')
    watcher.assertClean()
  })

  test('@screenshot the bench on a phone', async ({ page }) => {
    const watcher = await bootGame(page)
    await goto(page, 'bench')
    await captureStage(page, 'mobile-bench')
    watcher.assertClean()
  })

  /**
   * With the touch controls **actually on**, which is the only honest version of this shot.
   *
   * `setInput` drives the simulation without the input layer, so `touch.active` stays false and
   * the wrench slider and pads are never drawn — the previous version of this test photographed a
   * phone-sized screen with the *desktop* chrome on it and called it the mobile view. A real
   * `PointerEvent` of `pointerType: 'touch'` is what flips the game into touch mode, exactly as
   * `touch.spec.ts` does it.
   */
  test('@screenshot picking on a phone', async ({ page }) => {
    const watcher = await bootGame(page, { frames: 3 })
    await setManual(page, true)
    await loadLock(page, 3, 5)
    await touchTap(page, 900, 600)
    await setInput(page, { chamber: 1, liftTarget: 1.2, tensionHeld: true, tensionLevel: 0.45 })
    await stepTicks(page, 90)
    await renderOnce(page)
    const touching = await page.evaluate(() => globalThis.__shearline?.getTouch() ?? false)
    expect(touching, 'the shot has to be of the touch chrome, not the desktop chrome').toBe(true)
    await captureStage(page, 'mobile-pick')
    watcher.assertClean()
  })

  /**
   * The wrench the player drags, the tension the simulation gets, and the number the footer prints
   * are the same wrench — DECISIONS D-131.
   *
   * The footer read `settings.tensionLevel`, which the touch slider never writes to, so it printed
   * `wrench 5 of 10` on every phone for the whole of every attempt regardless of where the slider
   * was. It took a real drag to see it: nothing in the suite had ever driven the touch wrench
   * through the input layer, which is exactly why a fixed number survived on a live readout.
   */
  test('the footer prints the wrench the player is actually holding', async ({ page }) => {
    const watcher = await bootGame(page, { frames: 3 })
    await setManual(page, true)
    await loadLock(page, 3, 5)
    await touchTap(page, 900, 600)

    const read = async (): Promise<{ step: number; tension: number; printedStep: number }> =>
      page.evaluate(() => globalThis.__shearline!.getWrench())

    // Off, and saying so — not the keyboard's default of step 5.
    expect(await read()).toEqual({ step: 0, tension: 0, printedStep: 0 })

    // Grab low on the slider and drag up. 620px of travel is the full ten steps (WRENCH_DRAG_PX).
    await touchDrag(page, { x: 96, y: 760 }, { x: 96, y: 760 - 248 }, { release: false })
    const mid = await read()
    expect(mid.step, 'four steps of travel').toBe(4)
    expect(mid.printedStep, 'the footer agrees with the slider').toBe(mid.step)
    expect(mid.tension).toBeGreaterThan(0)

    // And the fat off band at the bottom means off however far the drag came from.
    await touchDrag(page, { x: 96, y: 400 }, { x: 96, y: 790 })
    const off = await read()
    expect(off.step).toBe(0)
    expect(off.printedStep).toBe(0)
    watcher.assertClean()
  })

  test('@screenshot the settings page on a phone', async ({ page }) => {
    const watcher = await bootGame(page)
    await goto(page, 'settings')
    await captureStage(page, 'mobile-settings')
    watcher.assertClean()
  })
})

test.describe('phone, portrait', () => {
  test.use({ viewport: PHONE_PORTRAIT, hasTouch: true, isMobile: true })

  /**
   * A portrait phone letterboxes 16:9 into a strip a couple of centimetres tall, so it gets one
   * honest screen instead of a technically-rendered unusable one (D-082). The guard is gated on a
   * *touch* having happened, so this taps first — otherwise the prompt never appears and the shot
   * would quietly be of the ordinary menu, which is exactly the class of test that proves nothing.
   */
  /**
   * On the **first** frame, with nothing touched — which is the whole of D-110.
   *
   * Proof the shot is of the prompt and not of the ordinary menu: the guard returns *before*
   * `ui.begin`, so a frame that drew it has registered no widgets, and the menu has eight. Without
   * this the test would pass just as happily on a technically-rendered, actually-unusable menu,
   * which is the failure mode `PROGRESS.md` names as this project's worst — a screenshot test
   * proves the renderer ran, not that the game got where it was told to.
   */
  test('@screenshot the rotate prompt, before anything is touched', async ({ page }) => {
    const watcher = await bootGame(page)
    const focus = await page.evaluate(() => globalThis.__shearline?.focusState())
    expect(focus?.count, 'the portrait guard should draw before any widget is registered').toBe(0)
    // Paper and two lines of type is all this screen is, so the ordinary blank-canvas floor does
    // not apply — the widget count above is what proves the right thing drew.
    await captureStage(page, 'mobile-portrait', { minColours: 12 })
    watcher.assertClean()
  })
})

test.describe('tablet, landscape', () => {
  test.use({ viewport: TABLET_LANDSCAPE, hasTouch: true, isMobile: true })

  test('@screenshot picking on a tablet', async ({ page }) => {
    const watcher = await bootGame(page, { frames: 3 })
    await setManual(page, true)
    await loadLock(page, 3, 5)
    await setInput(page, { chamber: 1, liftTarget: 1.2, tensionHeld: true, tensionLevel: 0.45 })
    await stepTicks(page, 90)
    await renderOnce(page)
    await captureStage(page, 'mobile-tablet-pick')
    watcher.assertClean()
  })
})

/**
 * Every phone, strictly — DECISIONS D-122.
 *
 * `tests/render/compact.test.ts` proves the type scale is right on each of these without a browser.
 * What this adds is the part arithmetic cannot answer: on a real render at a real device size, is
 * anything drawn **on top of** anything else, and is the lock still usable.
 *
 * The overlap that prompted this was concrete: the key legend moved into the left gutter (D-115),
 * which on touch is where the pause pad, the wrench slider and the withdraw pad live — so on a
 * phone the legend was drawn straight across all three. Reported as *"some of the elements overlap
 * with the fonts… pause, wrench for example"*. So the assertions are about that gutter, and about
 * the lock having somewhere to be.
 */
const PHONES: { name: string; width: number; height: number }[] = [
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
]

for (const phone of PHONES) {
  test.describe(phone.name, () => {
    test.use({
      viewport: { width: phone.width, height: phone.height },
      hasTouch: true,
      isMobile: true,
    })

    test(`the pick screen is laid out for ${phone.name}`, async ({ page }) => {
      const watcher = await bootGame(page, { frames: 3 })
      await setManual(page, true)
      await loadLock(page, 22, 5) // a six-chamber lock: the widest the assembly ever gets
      await touchTap(page, 900, 600)
      await setInput(page, { chamber: 2, liftTarget: 1.2, tensionHeld: true, tensionLevel: 0.45 })
      await stepTicks(page, 90)
      await renderOnce(page)

      const info = await page.evaluate(() => {
        const c = document.querySelector('canvas') as HTMLCanvasElement
        const r = c.getBoundingClientRect()
        return {
          touch: globalThis.__shearline?.getTouch() ?? false,
          scale: Math.min(r.width / 1920, r.height / 1080),
          geom: globalThis.__shearline?.getGeometry(),
        }
      })

      expect(info.touch, 'the touch chrome must be what is being measured').toBe(true)
      expect(info.scale, 'this device should be in compact mode').toBeLessThan(0.6)

      /**
       * The left gutter belongs to the touch controls, whole.
       *
       * `PAUSE_PAD`, `WRENCH_SLIDER` and `WITHDRAW_PAD` all sit at x 30..162 and between them
       * cover y 96..932 — effectively the entire gutter. Nothing else may be drawn into it, and
       * the lock must start to the right of it.
       */
      const assembly = info.geom?.layout
      expect(assembly, 'geometry should be available').toBeDefined()
      if (!assembly) return
      expect(assembly.left, 'the lock must clear the touch gutter').toBeGreaterThanOrEqual(162)

      // The lock is still worth looking at: at least a third of the stage wide.
      expect(assembly.right - assembly.left).toBeGreaterThan(1920 / 3)

      await captureStage(page, `mobile-${phone.name}`)
      watcher.assertClean()
    })
  })
}

/**
 * Every shell screen at phone size — DECISIONS D-123.
 *
 * D-122 did the pick screen and the menu, which is where a phone player lives, and left the rest
 * with nothing but larger button captions. These write the PNGs for the rest of them so the layout
 * can be judged from a picture rather than from theory, which is how every layout bug in this
 * project has actually been found.
 */
test.describe('the shell screens on a phone', () => {
  test.use({ viewport: { width: 664, height: 390 }, hasTouch: true, isMobile: true })

  test('@screenshot every shell screen', async ({ page }) => {
    const watcher = await bootGame(page, { frames: 3 })
    // A save with progress, so the bench and trophies have something in them rather than showing
    // their empty states — an empty screen cannot be crowded.
    await page.evaluate(() => {
      const h = globalThis.__shearline
      if (!h) throw new Error('no hook')
      const save = h.getSave()
      const records: Record<string, unknown> = {}
      for (const slug of h.lockSlugs().slice(0, 9)) {
        records[slug] = { opens: 2, bestTime: 41.5, bestOversets: 0, bestRank: 1, challenges: [] }
      }
      h.setSave({
        ...save,
        records: records as never,
        tutorial: ['lesson-1', 'lesson-2', 'lesson-3'],
        achievements: ['first-blood', 'apprentice', 'under-par'],
      })
    })

    for (const name of ['bench', 'settings', 'trophies', 'help', 'codes', 'editor']) {
      await goto(page, name)
      expect(await page.evaluate(() => globalThis.__shearline?.getScreen()), name).toBe(name)
      await captureStage(page, `mobile-screen-${name}`)
    }

    // Pause and results both need a lock behind them.
    await loadLock(page, 1, 5)
    await goto(page, 'pause')
    await captureStage(page, 'mobile-screen-pause')
    watcher.assertClean()
  })
})
