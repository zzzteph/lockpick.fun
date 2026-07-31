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

  test('@screenshot picking on a phone', async ({ page }) => {
    const watcher = await bootGame(page, { frames: 3 })
    await setManual(page, true)
    await loadLock(page, 3, 5)
    await setInput(page, { chamber: 1, liftTarget: 1.2, tensionHeld: true, tensionLevel: 0.45 })
    await stepTicks(page, 90)
    await renderOnce(page)
    await captureStage(page, 'mobile-pick')
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
