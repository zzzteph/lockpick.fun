/**
 * What the probe's recording means — the layout rules, as code.
 *
 * Pure and viewport-free: it takes the recorded boxes and a stage scale and returns findings. That
 * makes the rules themselves testable (a fabricated pair of boxes must report as an overlap) rather
 * than only observable through a browser, which is the difference between a check you trust and a
 * check that has never once fired. See DECISIONS D-132.
 */

import { contrastRatio } from './palette'
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, MIN_TYPE_CSS, TOUCH_FLOOR_CSS } from './viewport'
import type { DrawnText } from './probe'

export interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export type FindingKind =
  | 'tiny-type'
  | 'overlap'
  | 'off-stage'
  | 'small-target'
  | 'text-over-control'
  | 'low-contrast'
  | 'text-over-lock'
  | 'crowded-text'

export interface Finding {
  readonly kind: FindingKind
  /** Human-readable, and specific enough to find the call site from. */
  readonly detail: string
  /** Worst-offending measurement, for ranking. */
  readonly value: number
}

/**
 * How much two ink boxes may overlap before it counts, in logical px.
 *
 * Not zero. Glyph ink boxes are an approximation — `INK_ABOVE` assumes an ascender on every run,
 * so a row of small-caps labels sitting directly under a line of body text technically "touches"
 * by a pixel or two of empty space. Two logical px is under one real pixel on a phone and well
 * below anything a reader can see, so it removes the approximation's own noise without hiding a
 * real collision, which is always tens of pixels deep.
 */
export const OVERLAP_SLACK = 2

function overlapAmount(a: Box, b: Box): number {
  const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (dx <= 0 || dy <= 0) return 0
  return Math.min(dx, dy)
}

/** Every string must clear the readability floor once the stage is scaled down. */
export function tinyType(drawn: readonly DrawnText[], scale: number): Finding[] {
  const out: Finding[] = []
  for (const d of drawn) {
    const css = d.size * scale
    if (css < MIN_TYPE_CSS - 0.5) {
      out.push({
        kind: 'tiny-type',
        detail: `"${d.str.slice(0, 42)}" drawn at ${css.toFixed(1)} CSS px (${d.size} logical)`,
        value: css,
      })
    }
  }
  return out
}

/**
 * No two glyph runs may sit on top of each other.
 *
 * Quadratic, and deliberately so: a screen draws a few hundred runs, which is tens of thousands of
 * comparisons and microseconds of work. Anything cleverer would be a spatial index nobody can debug
 * standing between a failing test and the reason it failed.
 */
export function overlaps(drawn: readonly DrawnText[]): Finding[] {
  const out: Finding[] = []
  for (let i = 0; i < drawn.length; i += 1) {
    for (let j = i + 1; j < drawn.length; j += 1) {
      const a = drawn[i]
      const b = drawn[j]
      if (!a || !b) continue
      const amount = overlapAmount(a, b)
      if (amount > OVERLAP_SLACK) {
        out.push({
          kind: 'overlap',
          detail: `"${a.str.slice(0, 28)}" over "${b.str.slice(0, 28)}" by ${amount.toFixed(0)}px`,
          value: amount,
        })
      }
    }
  }
  return out
}

/** Nothing may be drawn outside the stage, where the letterbox will clip it. */
export function offStage(drawn: readonly DrawnText[]): Finding[] {
  const out: Finding[] = []
  for (const d of drawn) {
    const over =
      Math.max(0, -d.x) +
      Math.max(0, -d.y) +
      Math.max(0, d.x + d.w - LOGICAL_WIDTH) +
      Math.max(0, d.y + d.h - LOGICAL_HEIGHT)
    if (over > 1) {
      out.push({
        kind: 'off-stage',
        detail: `"${d.str.slice(0, 42)}" runs ${over.toFixed(0)}px past the stage edge`,
        value: over,
      })
    }
  }
  return out
}

/**
 * Every interactive rect must clear the finger floor once the stage is scaled down.
 *
 * Measured against the rect as *registered*, because that is what the near-miss floor in D-131
 * grows from — a control under the floor is fine so long as it is isolated, and the caller passes
 * `effective` for those. What this catches is a control that is both small and crowded.
 */
export function smallTargets(rects: readonly Box[], scale: number, effective = false): Finding[] {
  if (effective) return []
  const out: Finding[] = []
  for (const r of rects) {
    const shortest = Math.min(r.w, r.h) * scale
    if (shortest < TOUCH_FLOOR_CSS - 0.5) {
      out.push({
        kind: 'small-target',
        detail: `a ${r.w.toFixed(0)}x${r.h.toFixed(0)} control is ${shortest.toFixed(1)} CSS px on its short side`,
        value: shortest,
      })
    }
  }
  return out
}

/**
 * Text drawn across a control it does not belong to.
 *
 * The overlap rule compares text against text, which is most of the problem and not all of it: the
 * help page's first row of terms was drawn up behind the page tabs, and every glyph involved was
 * comfortably clear of every *other* glyph. A caption inside its own button is normal and expected,
 * so a run only counts here when it crosses a control's edge — partly in and partly out is the
 * shape of something that has landed where it should not be. See DECISIONS D-132.
 */
export const STRADDLE_LOW = 0.2
export const STRADDLE_HIGH = 0.85

export function textOverControls(drawn: readonly DrawnText[], rects: readonly Box[]): Finding[] {
  const out: Finding[] = []
  for (const d of drawn) {
    const area = Math.max(1, d.w * d.h)
    for (const r of rects) {
      const dx = Math.min(d.x + d.w, r.x + r.w) - Math.max(d.x, r.x)
      const dy = Math.min(d.y + d.h, r.y + r.h) - Math.max(d.y, r.y)
      if (dx <= 0 || dy <= 0) continue
      /*
       * How much of the run is inside decides what this is.
       *
       * Nearly all of it — a button's own caption, or a toggle's label sitting in its row. Nearly
       * none — a heading whose descenders graze the control beneath it, which is ordinary spacing.
       * **Between** the two is the bad case, and the only one: a run that is half on a control and
       * half off it has landed somewhere nobody put it. Anything less specific reports the whole
       * screen, which is how a rule stops being read.
       */
      const covered = (dx * dy) / area
      if (covered < STRADDLE_LOW || covered > STRADDLE_HIGH) continue
      out.push({
        kind: 'text-over-control',
        detail: `"${d.str.slice(0, 30)}" is ${(covered * 100).toFixed(0)}% across the edge of a ${r.w.toFixed(0)}x${r.h.toFixed(0)} control`,
        value: Math.min(dx, dy),
      })
    }
  }
  return out
}

/**
 * Text must not merely miss a control — it must clear it, by a readable margin.
 *
 * Every rule above waits for ink to actually cross something. Nothing asked for **air**: a
 * caption ending one pixel short of a card's border passed every check while reading exactly like
 * a collision. Reported from play as *"sometimes text is very near the elements — ensure that for
 * every text on every page there is a padding."*
 *
 * Six logical px, which is about two on the smallest phone — the minimum at which a gap reads as
 * a gap rather than a graze. A run that intersects the rect is out of scope here: fully inside is
 * a caption (the control's own padding is `button`'s business), and straddling the edge already
 * has a rule. Corner-to-corner proximity is ignored — diagonal nearness does not read as touching.
 *
 * A **caption is exempt entirely**, against every rect, not only its own. Two controls packed at
 * the touch floor — the editor's sixteen-row table is built on exactly that arithmetic (D-131) —
 * put each caption within a hair of the neighbouring control, and that closeness is the *box
 * packing*, already adjudicated where the pitch was chosen. What this rule is for is free text:
 * labels, headings and remarks, which always have somewhere else to be.
 */
export const MIN_TEXT_GAP = 6

export function crowdedText(drawn: readonly DrawnText[], rects: readonly Box[]): Finding[] {
  const out: Finding[] = []
  for (const d of drawn) {
    const area = Math.max(1, d.w * d.h)
    const isCaption = rects.some((r) => {
      const dx = Math.min(d.x + d.w, r.x + r.w) - Math.max(d.x, r.x)
      const dy = Math.min(d.y + d.h, r.y + r.h) - Math.max(d.y, r.y)
      return dx > 0 && dy > 0 && (dx * dy) / area > STRADDLE_HIGH
    })
    if (isCaption) continue
    for (const r of rects) {
      const gx = Math.max(r.x - (d.x + d.w), d.x - (r.x + r.w), 0)
      const gy = Math.max(r.y - (d.y + d.h), d.y - (r.y + r.h), 0)
      // Intersecting (both zero) belongs to the caption/straddle rules; diagonal (both positive)
      // is not a graze. What is left is edge-on proximity, and that is the thing being measured.
      const gap = gx === 0 && gy === 0 ? Infinity : gx === 0 ? gy : gy === 0 ? gx : Infinity
      if (gap < MIN_TEXT_GAP) {
        out.push({
          kind: 'crowded-text',
          detail: `"${d.str.slice(0, 30)}" is ${gap.toFixed(1)}px from a ${r.w.toFixed(0)}x${r.h.toFixed(0)} control (needs ${MIN_TEXT_GAP})`,
          value: MIN_TEXT_GAP - gap,
        })
      }
    }
  }
  return out
}

/**
 * WCAG AA for body text is 4.5:1; large text gets 3:1.
 *
 * "Large" is 24 CSS px, or 18.66 bold. The game's stage scales, so the threshold has to be applied
 * to the **rendered** size rather than the logical one — a 26px heading is large on a desktop and
 * ordinary body text on a phone, and it is the phone that decides which rule it has to pass.
 */
export const AA_NORMAL = 4.5
export const AA_LARGE = 3
export const LARGE_CSS = 24

/**
 * Every string must clear WCAG AA against the ground it is drawn on.
 *
 * The ground is **sampled from the canvas** just before the glyphs are drawn, so a reversed
 * caption on a primary button is checked against the ink it actually sits on rather than against
 * the page it does not. Assuming the page instead reported 1.00:1 on every reversed label in the
 * game — three hundred findings, none of them real. See DECISIONS D-135.
 */
export function lowContrast(drawn: readonly DrawnText[], scale: number): Finding[] {
  const out: Finding[] = []
  for (const d of drawn) {
    if (!d.colour.startsWith('#') || d.colour.length < 7) continue
    if (!d.ground.startsWith('#') || d.ground.length < 7) continue
    const worst = contrastRatio(d.colour, d.ground)
    const against = d.ground
    const css = d.size * scale
    const need = css >= LARGE_CSS ? AA_LARGE : AA_NORMAL
    if (worst + 0.05 < need) {
      out.push({
        kind: 'low-contrast',
        detail: `"${d.str.slice(0, 30)}" is ${worst.toFixed(2)}:1 on ${against} (needs ${need}:1 at ${css.toFixed(0)} CSS px)`,
        value: need - worst,
      })
    }
  }
  return out
}

/**
 * No chrome may be drawn on top of the lock.
 *
 * The lock is the screen — it is the picture, the readout and the feedback channel at once — and it
 * is neither text nor a registered control, so **every rule so far was blind to it**. The rank
 * countdown was drawn ten pixels inside the shell on the smallest phone and nothing could see it;
 * it took a person to notice, which is the failure mode this whole audit exists to end.
 *
 * Strict, deliberately: nothing the HUD draws belongs inside the assembly. The chamber numbers sit
 * below its bounds, the rank block above, the readouts in the gutters. If something legitimately
 * needs to be inside it one day, it can be passed as an exception then — a rule with a list of
 * excuses in it before anything has needed one is a rule that will never fire.
 *
 * See DECISIONS D-137.
 */
export function textOverLock(drawn: readonly DrawnText[], lock: Box | null): Finding[] {
  if (!lock) return []
  const out: Finding[] = []
  for (const d of drawn) {
    const dx = Math.min(d.x + d.w, lock.x + lock.w) - Math.max(d.x, lock.x)
    const dy = Math.min(d.y + d.h, lock.y + lock.h) - Math.max(d.y, lock.y)
    if (dx <= OVERLAP_SLACK || dy <= OVERLAP_SLACK) continue
    out.push({
      kind: 'text-over-lock',
      detail: `"${d.str.slice(0, 30)}" is drawn ${Math.min(dx, dy).toFixed(0)}px inside the lock`,
      value: Math.min(dx, dy),
    })
  }
  return out
}

/** Everything, worst first. */
export function auditLayout(
  drawn: readonly DrawnText[],
  scale: number,
  rects: readonly Box[] = [],
  lock: Box | null = null,
): Finding[] {
  return [
    ...tinyType(drawn, scale),
    ...overlaps(drawn),
    ...offStage(drawn),
    ...smallTargets(rects, scale, true),
    ...textOverControls(drawn, rects),
    ...crowdedText(drawn, rects),
    ...lowContrast(drawn, scale),
    ...textOverLock(drawn, lock),
  ].sort((a, b) => b.value - a.value)
}
