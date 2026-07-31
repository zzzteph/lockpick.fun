/**
 * Drawing the open sequence — `ART_DIRECTION.md §6`.
 *
 * `opensequence.ts` owns the timing and this owns the ink. Nothing here holds state; every
 * function is `(sequence, palette) -> pixels`, so what is on screen at t = 1.4s is fully
 * determined by the number 1.4 and the payout, which is what makes the timings testable.
 */

import type { Achievement } from '../game/achievements'
import { RANKS } from '../game/ranks'
import { text } from './draw'
import {
  BURST_RAYS,
  burst,
  cardOffsetX,
  cardVisible,
  rankReveal,
  gridSweep,
  impactFlash,
  isSettled,
  type OpenSequence,
} from './opensequence'
import { STROKE, TYPE, alpha, font, readableAccents, type Palette } from './palette'
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, type Viewport } from './viewport'

/** Beat 2: every line on screen flashes to Highlight for two frames. */
export function drawImpactFlash(vp: Viewport, p: Palette, seq: OpenSequence): void {
  const a = impactFlash(seq)
  if (a <= 0) return
  const { ctx } = vp
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = alpha(p.highlight, a * 0.55)
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT)
  ctx.restore()
}

/**
 * Beat 4: a thin radial burst of hairlines from the plug centre.
 *
 * Hairlines, evenly spaced, no glow and no particles — `ART_DIRECTION.md §6` says *technical,
 * not sparkly*, and the difference between the two is entirely in the line weight.
 */
export function drawBurst(
  vp: Viewport,
  p: Palette,
  seq: OpenSequence,
  cx: number,
  cy: number,
): void {
  const t = burst(seq)
  if (t <= 0) return
  const { ctx } = vp
  const inner = 40 + (1 - t) * 30
  const outer = inner + 90 + (1 - t) * 460
  ctx.save()
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = alpha(p.ink, t * 0.7)
  ctx.beginPath()
  for (let i = 0; i < BURST_RAYS; i += 1) {
    const a = (i / BURST_RAYS) * Math.PI * 2
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner)
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer)
  }
  ctx.stroke()
  ctx.restore()
}

/** Beat 5: the background grid sweeps outward from the plug and fades. */
export function drawGridSweep(
  vp: Viewport,
  p: Palette,
  seq: OpenSequence,
  cx: number,
  cy: number,
): void {
  const t = gridSweep(seq)
  if (t <= 0) return
  const { ctx } = vp
  const r = t * 1400
  ctx.save()
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = alpha(p.rule, (1 - t) * 0.9)
  for (let ring = 0; ring < 4; ring += 1) {
    ctx.beginPath()
    ctx.arc(cx, cy, Math.max(0, r - ring * 46), 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Beat 6: the payout, counting up in 64px tabular numerals.
 *
 * Tabular figures matter here and are not decoration: proportional digits change width as
 * they roll, so a counter drawn in them jitters sideways all the way up. `TYPE.payout` is the
 * 64px size `ART_DIRECTION.md §6` calls for.
 */
export function drawCreditCount(vp: Viewport, p: Palette, seq: OpenSequence): void {
  if (seq.elapsed < 1.2) return
  const { ctx } = vp
  const readable = readableAccents(p)
  const t = rankReveal(seq)
  if (t <= 0) return
  const letter = RANKS[seq.rank]?.letter ?? 'F'
  const ink = seq.rank <= 1 ? readable.teal : seq.rank <= 3 ? readable.amber : readable.crimson
  ctx.save()
  ctx.textBaseline = 'alphabetic'
  // Scales down onto the baseline as it fades in — a stamp landing rather than a number ticking.
  const scale = 1 + (1 - t) * 0.6
  ctx.globalAlpha = t
  ctx.translate(LOGICAL_WIDTH / 2, COUNT_BASELINE)
  ctx.scale(scale, scale)
  ctx.font = font(TYPE.payout, 'bold')
  ctx.fillStyle = ink
  ctx.fillText(letter, -ctx.measureText(letter).width / 2, 0)
  ctx.restore()
  text(ctx, 'rank', LOGICAL_WIDTH / 2, COUNT_BASELINE + 30, {
    font: font(TYPE.body),
    color: p.inkLight,
    align: 'center',
  })
}

/** Baseline for the 64px counter: clear of the header, clear of the assembly. */
const COUNT_BASELINE = 152

export const CARD_W = 420
export const CARD_H = 76
const CARD_GAP = 12

/**
 * Beat 7: achievement cards, sliding in from the right, staggered.
 *
 * They stack downward from a fixed top rather than growing from the bottom, so the first one
 * earned is always in the same place whether one fired or six did.
 */
export function drawAchievementCards(
  vp: Viewport,
  p: Palette,
  seq: OpenSequence,
  earned: readonly Achievement[],
): void {
  if (earned.length === 0) return
  const { ctx } = vp
  const readable = readableAccents(p)
  const right = LOGICAL_WIDTH - 48
  const top = 420

  for (let i = 0; i < earned.length; i += 1) {
    const a = earned[i]
    if (!a || !cardVisible(seq, i)) continue
    const x = right - CARD_W + cardOffsetX(seq, i)
    const y = top + i * (CARD_H + CARD_GAP)

    ctx.save()
    ctx.fillStyle = p.paperShade
    ctx.fillRect(x, y, CARD_W, CARD_H)
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.strokeRect(x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1)
    // A teal bar down the leading edge: the same "captured" colour a set pin gets.
    ctx.fillStyle = readable.teal
    ctx.fillRect(x, y, 7, CARD_H)
    ctx.restore()

    text(ctx, 'ACHIEVEMENT', x + 22, y + 26, {
      font: font(TYPE.dimension),
      color: p.inkLight,
    })
    text(ctx, a.name, x + 22, y + 54, { font: font(TYPE.heading), color: p.ink })
  }
}

/** Everything above, in beat order, over whatever the pick screen last drew. */
export function drawOpenSequence(
  vp: Viewport,
  p: Palette,
  seq: OpenSequence,
  earned: readonly Achievement[],
  centre: { x: number; y: number },
): void {
  if (isSettled(seq)) return
  drawGridSweep(vp, p, seq, centre.x, centre.y)
  drawBurst(vp, p, seq, centre.x, centre.y)
  drawCreditCount(vp, p, seq)
  drawAchievementCards(vp, p, seq, earned)
  // The flash goes over everything, because it is the whole picture flashing, not a layer.
  drawImpactFlash(vp, p, seq)
}
