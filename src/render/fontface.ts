/**
 * The game ships its own typeface — DECISIONS D-146.
 *
 * `FONT_STACK` used to name families and hope: `ui-monospace, "Cascadia Code", "SF Mono", Consolas,
 * monospace`. Every one of those resolves to something different depending on the machine, and none
 * of them exists on a bare Linux box, where `ui-monospace` lands on DejaVu Sans Mono — **9% wider**
 * per character than the Consolas this was laid out against, with a taller ascent.
 *
 * That is not a rendering nicety. This game measures text: `Ui.widget` sizes controls from
 * `measureText`, captions shrink to fit their boxes, and a 342-case layout audit asserts that
 * nothing overlaps, nothing is too small and nothing sits on a control's edge. All of it was
 * measuring **one machine's fonts**. The audit passed locally and produced 19 failures on CI — six
 * distinct findings, every one of them a run of text that had less than 9% of slack. Linux and
 * Android players have been getting a layout nobody ever checked.
 *
 * So the typeface is an asset now, not a preference. JetBrains Mono under the SIL Open Font License,
 * subsetted to the 130 characters the game actually draws — 5.7KB a weight, against a 193KB bundle.
 *
 * **Inlined as a data URI, not fetched.** `dist/` has to run from `file://` (D-037), and a font file
 * requested from an opaque origin is blocked by CORS exactly like the module script that decision is
 * about. `assetsInlineLimit` in the Vite config is what turns these two imports into data URIs, and
 * it is set high enough on purpose.
 */

import regular from './fonts/jbm-Regular.woff2'
import semibold from './fonts/jbm-SemiBold.woff2'

/** The family name the canvas asks for. Ours, so nothing on the machine can answer to it. */
export const GAME_FONT_FAMILY = 'Shear Mono'

/**
 * Register both weights and wait for them to be usable.
 *
 * **Awaited before the first frame**, because canvas text is measured the moment the app draws and
 * a `measureText` taken before the font arrives is measuring the fallback — which is the whole bug
 * this exists to fix, reintroduced at boot. `document.fonts.load` is the part that matters:
 * `FontFace.load()` alone resolves before the family is available to a 2D context.
 *
 * It never rejects. A game that will not start because a decorative asset failed is worse than one
 * drawn in the wrong typeface, so a failure here falls through to the stack's remaining families.
 */
export async function loadGameFont(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  try {
    const faces = [
      new FontFace(GAME_FONT_FAMILY, `url(${regular})`, { weight: '400', style: 'normal' }),
      new FontFace(GAME_FONT_FAMILY, `url(${semibold})`, { weight: '600', style: 'normal' }),
    ]
    await Promise.all(faces.map(async (f) => document.fonts.add(await f.load())))
    // Both weights, at a size, or a 2D context may still hand back fallback metrics.
    await Promise.all([
      document.fonts.load(`400 16px "${GAME_FONT_FAMILY}"`),
      document.fonts.load(`600 16px "${GAME_FONT_FAMILY}"`),
    ])
  } catch {
    // Fall through to the rest of the stack.
  }
}
