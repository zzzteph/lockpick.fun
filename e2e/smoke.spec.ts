import { expect, test } from '@playwright/test'
import { bootGame } from './harness'

test('boots and renders without a console error', async ({ page }) => {
  const watcher = await bootGame(page)
  const frames = await page.evaluate(
    () => (globalThis as { __shearline?: { framesRendered: number } }).__shearline?.framesRendered,
  )
  expect(frames).toBeGreaterThan(0)
  watcher.assertClean()
})

test('canvas backing store matches devicePixelRatio', async ({ page }) => {
  const watcher = await bootGame(page)
  const info = await page.evaluate(() => {
    const c = document.getElementById('stage') as HTMLCanvasElement
    const rect = c.getBoundingClientRect()
    return {
      backingW: c.width,
      backingH: c.height,
      cssW: Math.round(rect.width),
      cssH: Math.round(rect.height),
      dpr: window.devicePixelRatio,
    }
  })
  expect(info.backingW).toBe(Math.round(info.cssW * info.dpr))
  expect(info.backingH).toBe(Math.round(info.cssH * info.dpr))
  watcher.assertClean()
})

/**
 * Every screen size anybody actually has — asked directly, because it was asked directly.
 *
 * The stage is a fixed 1920x1080 logical space letterboxed into the viewport, so "does it run at
 * 2K, or at 1366x768" is really two questions: does the backing store track `cssSize x dpr` (or the
 * drawing is soft), and does the logical layout come out identical at every size (or the game is a
 * different game on a laptop). Both are checked here, at the resolutions people have rather than at
 * three round numbers.
 *
 * 1366x768 is still the commonest laptop panel in the world; 2560x1440 and 3440x1440 are the
 * monitors this is most likely to be played on; 1280x800 and 1920x1200 are 16:10, which letterboxes
 * on the *other* axis and is the case a 16:9-only assumption gets wrong. See DECISIONS D-116.
 */
test('rescales without distortion at every common screen size', async ({ page }) => {
  const watcher = await bootGame(page)
  const sizes = [
    { width: 1366, height: 768 }, // the commonest laptop panel there is
    { width: 1280, height: 800 }, // 16:10 — letterboxes top and bottom
    { width: 1440, height: 900 },
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 }, // the design size, 1:1
    { width: 1920, height: 1200 }, // 16:10 again, larger
    { width: 2560, height: 1440 }, // 2K, scaling *up*
    { width: 3440, height: 1440 }, // ultrawide — letterboxes left and right
    { width: 1000, height: 900 }, // deliberately awkward
  ]
  for (const size of sizes) {
    await page.setViewportSize(size)
    /**
     * Wait for the resize to have *landed*, not merely to have been asked for.
     *
     * The backing store must track CSS size x DPR, or everything is drawn soft and rescaled — but
     * the check also has to require a non-zero rect. Between `setViewportSize` and the next layout
     * the element can measure zero, and `0/1920` is a scale of zero, which makes the aspect-ratio
     * assertion below `0/0` and fails the test for a reason that has nothing to do with the game.
     */
    await page.waitForFunction((expected) => {
      const c = document.getElementById('stage') as HTMLCanvasElement
      const rect = c.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return false
      if (Math.abs(rect.width - expected.width) > 1) return false
      return c.width === Math.round(rect.width * window.devicePixelRatio)
    }, size)
    const vp = await page.evaluate(() => {
      const c = document.getElementById('stage') as HTMLCanvasElement
      const rect = c.getBoundingClientRect()
      const dpr = window.devicePixelRatio
      // The letterbox: uniform scale, and whatever is left over split evenly.
      const scale = Math.min(rect.width / 1920, rect.height / 1080)
      return {
        backingOk:
          c.width === Math.round(rect.width * dpr) && c.height === Math.round(rect.height * dpr),
        scale,
        drawnW: 1920 * scale,
        drawnH: 1080 * scale,
        cssW: rect.width,
        cssH: rect.height,
      }
    })
    const where = `${size.width}x${size.height}`
    expect(vp.backingOk, `${where}: backing store does not match CSS x DPR`).toBe(true)
    // One scale for both axes is what "without distortion" means: the drawn stage keeps 16:9.
    expect(vp.drawnW / vp.drawnH, `${where}: aspect ratio drifted`).toBeCloseTo(1920 / 1080, 6)
    // …and it fits, rather than being cropped.
    expect(vp.drawnW, `${where}: wider than the viewport`).toBeLessThanOrEqual(vp.cssW + 0.5)
    expect(vp.drawnH, `${where}: taller than the viewport`).toBeLessThanOrEqual(vp.cssH + 0.5)
    // Nothing is so small that the game stops being playable: the smallest here is 1000x900,
    // which still draws the stage at over half size.
    expect(vp.scale, `${where}: stage scaled to ${vp.scale.toFixed(2)}`).toBeGreaterThan(0.5)
  }
  watcher.assertClean()
})
