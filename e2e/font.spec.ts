/**
 * The game is drawing in its own typeface — DECISIONS D-146.
 *
 * This is the guard that keeps the 342-case layout audit meaning something. Everything that audit
 * asserts — that nothing overlaps, that nothing is under the type floor, that no caption sits on a
 * control's edge — is measured from `measureText`, and `measureText` answers with whatever font the
 * machine resolved. For most of this project's life that was Consolas here and DejaVu Sans Mono on
 * a Linux runner, **9% wider per character**, and the audit passed locally while producing 19
 * failures on CI.
 *
 * Bundling a face fixes that only for as long as the face actually loads. If the data URI breaks,
 * or the `FontFace` promise is left unawaited, or the family is renamed on one side and not the
 * other, everything falls back — silently, and the audit goes back to measuring the machine while
 * still reporting green. That is the failure this project has shipped five times in other guises,
 * so the load is asserted rather than assumed.
 */

import { expect, test } from '@playwright/test'
import { bootGame } from './harness'

/** JetBrains Mono's advance is 0.6em exactly. Consolas is 0.55, DejaVu 0.602. */
const JBM_ADVANCE = 0.6

test('the bundled typeface is loaded and is the one being measured', async ({ page }) => {
  await bootGame(page, { frames: 3 })

  const check = await page.evaluate(() => {
    /*
     * Measured through the **game's own stack**, not a string this test made up. Setting
     * `ctx.font` to the family we are hoping for proves only that the family exists; what has to be
     * true is that what the renderer asks for on every draw call resolves to it.
     */
    const stack = globalThis.__shearline!.fontStack()
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')!
    ctx.font = `600 40px ${stack}`
    const asDrawn = ctx.measureText('MMMMMMMMMM').width
    // A family that certainly is not installed, so this is whatever the machine falls back to.
    ctx.font = '600 40px "definitely-not-installed-9137", monospace'
    const fallback = ctx.measureText('MMMMMMMMMM').width
    return { ok: document.fonts.check(`600 40px ${stack}`), stack, asDrawn, fallback }
  })

  expect(check.ok, 'the game s font stack never resolved to a loaded face').toBe(true)
  // 10 characters at 40px: 240px at JetBrains Mono's 0.6em advance.
  expect(check.asDrawn, `the game draws in "${check.stack}", which is not the shipped face`).toBeCloseTo(
    40 * 10 * JBM_ADVANCE,
    0,
  )
  /*
   * And it is genuinely different from what this machine would otherwise have used — otherwise the
   * assertion above would pass on a runner that happened to fall back to something 0.6em wide, and
   * go on passing after the font stopped being bundled at all.
   */
  expect(
    Math.abs(check.asDrawn - check.fallback),
    'the shipped face is indistinguishable from the fallback here, so this proves nothing',
  ).toBeGreaterThan(1)
})
