/**
 * A record of what was actually drawn — the layout probe.
 *
 * Every mobile bug found so far has been found by a person looking at a screenshot: type too small
 * to read, two captions on top of each other, a button whose text runs out of its own frame. That
 * is a slow and incomplete way to find them, and it does not scale — the game has ten screens and
 * the device matrix has twelve phones, which is a hundred and twenty pictures nobody is going to
 * study. Worse, it only catches what somebody happens to look at: `help` had overlapping text on a
 * Galaxy S24 for as long as the screen has existed, and the suite never rendered it there.
 *
 * So the drawing reports itself. `text()` in `draw.ts` is the single funnel every string in the
 * game passes through — `label` and `paragraph` both call it — so recording there gives an exact
 * bounding box for every glyph run on the screen, with the size it was drawn at. A test can then
 * assert the things a person was being asked to notice: nothing unreadably small, nothing on top of
 * anything else, nothing off the edge of the stage.
 *
 * Off by default and switched on only by the dev hook, so production pays one null check per string.
 * See DECISIONS D-132.
 */

/** One drawn glyph run, in logical stage coordinates. */
export interface DrawnText {
  readonly str: string
  /** The fill it was drawn in. */
  readonly colour: string
  /** The colour actually under it, sampled from the canvas before the glyphs went down. */
  readonly ground: string
  /** Left edge of the ink, after alignment has been applied. */
  readonly x: number
  /** Top of the ink — the baseline less the cap height, not the baseline itself. */
  readonly y: number
  readonly w: number
  readonly h: number
  /** Font size in logical px, which is what the readability floor is measured against. */
  readonly size: number
}

/**
 * Fallback ink extents either side of the baseline, as a fraction of the font size.
 *
 * Only used where `TextMetrics` does not report actual glyph bounds. The real bounds are asked for
 * first, because guessing is what makes a checker cry wolf: the rank letter is a 104px `S` with no
 * descender, and assuming 0.22 of a descender on it put 23 phantom pixels under the glyph and
 * reported a collision with the caption below that no reader will ever see. A layout rule that
 * fires on things nobody can see is a rule people learn to ignore.
 */
export const INK_ABOVE = 0.75
export const INK_BELOW = 0.22

let sink: DrawnText[] | null = null

export function startRecording(): void {
  sink = []
}

export function stopRecording(): DrawnText[] {
  const out = sink ?? []
  sink = null
  return out
}

export function isRecording(): boolean {
  return sink !== null
}

/**
 * The colour already on the canvas at a logical point — the ground a run is about to be drawn on.
 *
 * **Sampled, not assumed** — DECISIONS D-135. The first version of the contrast rule compared every
 * run against the page's two grounds, which is wrong for every reversed caption in the game: a
 * primary button draws paper-on-ink, so the check saw paper against paper and reported 1.00:1 on
 * three hundred perfectly legible labels. A rule that cannot tell where the text sits reports the
 * whole screen, and a rule that reports the whole screen gets switched off.
 *
 * Called before `fillText`, so the pixel under the run is whatever the button, panel or lock put
 * there. Only ever runs while recording, so production pays nothing for it.
 */
export function sampleGround(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  y: number,
): string {
  /*
   * The **dominant** ground across the run, not one pixel of it.
   *
   * The page is drafting paper: a 40px lattice of hairlines in `rule` over `paper`. A single
   * sample that happens to land on one of those hairlines reports `rule` as the ground for the
   * whole string, and `inkLight` on `rule` is 3.36:1 — so every caption that crosses a grid line
   * anywhere along its length failed, three hundred and forty-five of them. That is the same
   * mistake the ink-box approximation made in D-132: a worst-case point is not the thing a reader
   * sees. Five samples and the median by luminance gives the surface the run actually sits on,
   * while still reporting a caption genuinely laid across something dark.
   */
  try {
    const m = ctx.getTransform()
    const hex = (v: number | undefined): string => (v ?? 0).toString(16).padStart(2, '0')
    const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b
    const seen: { hexed: string; l: number }[] = []
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const x = x0 + (x1 - x0) * t
      const px = Math.round(m.a * x + m.c * y + m.e)
      const py = Math.round(m.b * x + m.d * y + m.f)
      const d = ctx.getImageData(px, py, 1, 1).data
      const r = d[0] ?? 0
      const g = d[1] ?? 0
      const b = d[2] ?? 0
      seen.push({ hexed: `#${hex(r)}${hex(g)}${hex(b)}`, l: lum(r, g, b) })
    }
    seen.sort((a, b) => a.l - b.l)
    return seen[Math.floor(seen.length / 2)]?.hexed ?? ''
  } catch {
    // A tainted or zero-sized canvas: report no ground rather than a wrong one.
    return ''
  }
}

/**
 * Parse the pixel size out of a font shorthand, e.g. `600 21px "IBM Plex Mono", monospace`.
 *
 * Returns 0 for anything unparseable rather than guessing, so a bad reading shows up as a
 * failure to measure rather than as a plausible wrong number that quietly passes the floor.
 */
export function sizeOf(fontSpec: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(fontSpec)
  return m?.[1] ? Number.parseFloat(m[1]) : 0
}

/**
 * Record one run. Called from `text()` with the post-alignment left edge and measured width.
 *
 * Whitespace-only runs are dropped: they have real boxes and no ink, so they would generate
 * overlaps nobody can see.
 */
export function recordText(
  ctx: CanvasRenderingContext2D,
  str: string,
  left: number,
  baseline: number,
  w: number,
  size: number,
  colour: string,
  ground: string,
): void {
  if (!sink || str.trim() === '') return
  /*
   * Vertical extents come from the font, horizontal from the caller.
   *
   * `actualBoundingBoxAscent/Descent` are the real ink of *this string in this face* — an
   * all-caps label reports no descender, which is the whole point. Width stays the caller's
   * figure because it already includes the letter-spacing `label` adds by hand, and the metrics
   * object knows nothing about that.
   */
  let top = baseline - size * INK_ABOVE
  let height = size * (INK_ABOVE + INK_BELOW)
  const m = ctx.measureText(str)
  const up = m.actualBoundingBoxAscent
  const down = m.actualBoundingBoxDescent
  if (Number.isFinite(up) && Number.isFinite(down)) {
    top = baseline - up
    height = up + down
  }
  sink.push({ str, colour, ground, x: left, y: top, w, h: height, size })
}
