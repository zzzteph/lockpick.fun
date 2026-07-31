/**
 * Audio subtitles — `PHASES.md` Phase 12.
 *
 * Every sound the game makes, in words, for a player who cannot hear it or has it turned off.
 * It reads the same event stream the audio engine reads, so a sound with no caption is a bug
 * that shows up as a missing line rather than as silence nobody notices — and the test that
 * enumerates `SimEvent['type']` against this table is what keeps the two in step.
 *
 * The rule the captions follow: describe the **event**, not the waveform. "Pin 3 set" is
 * useful; "short metallic click" is not. A subtitle is a substitute for the information the
 * sound carried, not for the sound.
 */

import type { SimEvent, SimEventType } from '../sim'
import { text } from './draw'
import { STROKE, TYPE, alpha, font, readableAccents, type Palette } from './palette'
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, type Viewport } from './viewport'

/** How long a caption stays up. Long enough to read, short enough not to stack up. */
export const CAPTION_SECONDS = 2.2
/** Never more than this on screen at once; the oldest is dropped. */
export const MAX_CAPTIONS = 4

export interface Caption {
  readonly text: string
  /** 'event' for a discrete sound, 'state' for a sustained one. */
  readonly kind: 'event' | 'state'
  /** Seconds of life left. */
  life: number
}

export interface Subtitles {
  captions: Caption[]
  /** The sustained sound currently playing, so it is not re-announced every frame. */
  sustained: string | null
}

export function createSubtitles(): Subtitles {
  return { captions: [], sustained: null }
}

export function clearSubtitles(s: Subtitles): void {
  s.captions.length = 0
  s.sustained = null
}

/**
 * A caption for every discrete event, or null where the event carries no sound of its own.
 *
 * `PLUG_MOVED` and `COUNTER_ROTATION` are continuous — they are the plug friction and the
 * grind, which the sustained line below describes once rather than sixty times a second.
 */
export function captionFor(e: SimEvent): string | null {
  switch (e.type) {
    case 'ATTEMPT_STARTED':
      return null
    case 'PIN_SET':
      return `pin ${e.chamber + 1} sets — click`
    case 'PIN_OVERSET':
      return `pin ${e.chamber + 1} overset — jams`
    case 'FALSE_SET_ENTERED':
      return `pin ${e.chamber + 1} false sets — the plug gives`
    case 'COUNTER_ROTATION':
      return null
    case 'PLUG_MOVED':
      return null
    case 'LOCK_OPENED':
      return 'the lock opens'
    case 'PLUG_FREE':
      // Names the cause as well as the sensation, because "the plug goes slack" on its own is
      // indistinguishable from a reset to anyone reading rather than hearing (D-055).
      return 'the plug goes slack — every pin is set, turn harder'
    case 'PICK_BENT':
      return 'the pick takes a set — it will not sit where you point it now'
    case 'PICK_BROKEN':
      return 'the pick snaps'
    case 'RESET': {
      const n = e.dropped.length
      const pins = `${n} pin${n === 1 ? '' : 's'}`
      if (e.kind === 'feather') return `feather — ${pins} dropped`
      // Naming the cause matters more here than anywhere else: the player pushed one pin and lost
      // several, and without being told the plug turned back it reads as the game cheating (D-081).
      if (e.kind === 'counter') return `the plug turns back — ${pins} lose their ledge`
      return `tension lost — everything drops`
    }
    case 'PICK_MOVED':
      return null
  }
}

/** Which event types deliberately have no caption, so the completeness test can say so. */
export const SILENT_EVENTS: readonly SimEventType[] = [
  'ATTEMPT_STARTED',
  'COUNTER_ROTATION',
  'PLUG_MOVED',
  'PICK_MOVED',
]

/**
 * The sustained sound, described in one line that changes only when it changes.
 *
 * Counter-rotation grinding and the plug's friction are continuous, and captioning a
 * continuous sound as a stream of discrete lines is worse than not captioning it — the
 * subtitle track becomes unreadable exactly when the most is happening.
 */
export function sustainedCaption(counterForce: number, thetaVelocity: number): string | null {
  if (counterForce > 3) return 'the lock grinds back'
  if (Math.abs(thetaVelocity) > 0.15) return 'the plug turns'
  return null
}

export function pushCaption(s: Subtitles, line: string, kind: Caption['kind'] = 'event'): void {
  s.captions.push({ text: line, kind, life: CAPTION_SECONDS })
  if (s.captions.length > MAX_CAPTIONS) s.captions.splice(0, s.captions.length - MAX_CAPTIONS)
}

export function pushSubtitleEvents(s: Subtitles, events: readonly SimEvent[]): void {
  for (const e of events) {
    const line = captionFor(e)
    if (line !== null) pushCaption(s, line)
  }
}

/** Fold the continuous state in, announcing a change only when there is one. */
export function updateSubtitles(
  s: Subtitles,
  dt: number,
  counterForce: number,
  thetaVelocity: number,
): void {
  const now = sustainedCaption(counterForce, thetaVelocity)
  if (now !== s.sustained) {
    s.sustained = now
    if (now !== null) pushCaption(s, now, 'state')
  }
  for (const c of s.captions) c.life -= dt
  for (let i = s.captions.length - 1; i >= 0; i -= 1) {
    if ((s.captions[i]?.life ?? 0) <= 0) s.captions.splice(i, 1)
  }
}

/**
 * The tutorial's one line, in the same place a subtitle would be but above it.
 *
 * One line. Not a panel, not a dialog, nothing to dismiss — `GAME_DESIGN.md §10` is explicit,
 * and the shape of the thing is what enforces it: there is nowhere to put a second sentence.
 * The pips beside it are the only progress indication, because a step counter would invite
 * reading ahead rather than playing.
 */
export function drawLessonLine(
  vp: Viewport,
  p: Palette,
  lesson: { line: string | null; step: number; total: number },
): void {
  if (lesson.line === null) return
  const { ctx } = vp
  const readable = readableAccents(p)
  const width = 900
  const h = 46
  const x = (LOGICAL_WIDTH - width) / 2
  // Under the header, above the drawing. The bottom of the stage belongs to the subtitle
  // track, and instruction and transcript must not sit on top of each other.
  const y = 100

  ctx.save()
  ctx.fillStyle = p.paperShade
  ctx.fillRect(x, y, width, h)
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, h - 1)
  ctx.fillStyle = readable.amber
  ctx.fillRect(x, y, 6, h)
  ctx.restore()

  text(ctx, lesson.line, LOGICAL_WIDTH / 2, y + 29, {
    font: font(TYPE.body),
    color: p.ink,
    align: 'center',
  })

  // Progress pips, right of the line.
  const pipR = 4
  const pipGap = 14
  const pipsX = x + width + 22
  ctx.save()
  for (let i = 0; i < lesson.total; i += 1) {
    ctx.beginPath()
    ctx.arc(pipsX + i * pipGap, y + h / 2, pipR, 0, Math.PI * 2)
    ctx.fillStyle = i < lesson.step ? readable.teal : p.paper
    ctx.fill()
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = p.rule
    ctx.stroke()
  }
  ctx.restore()
}

/** Stacked along the bottom of the stage, newest last, fading as they expire. */
export function drawSubtitles(vp: Viewport, p: Palette, s: Subtitles): void {
  if (s.captions.length === 0) return
  const { ctx } = vp
  const readable = readableAccents(p)
  const lineH = 30
  const bottom = LOGICAL_HEIGHT - 210
  const top = bottom - s.captions.length * lineH

  for (let i = 0; i < s.captions.length; i += 1) {
    const c = s.captions[i]
    if (!c) continue
    const fade = Math.min(1, c.life / 0.4)
    const y = top + i * lineH
    const width = 640
    const x = (LOGICAL_WIDTH - width) / 2
    ctx.save()
    ctx.fillStyle = alpha(p.paper, 0.88 * fade)
    ctx.fillRect(x, y, width, lineH - 4)
    ctx.strokeStyle = alpha(p.rule, fade)
    ctx.lineWidth = STROKE.hairline
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, lineH - 5)
    ctx.restore()
    text(ctx, c.text, LOGICAL_WIDTH / 2, y + 20, {
      font: font(TYPE.body),
      color: alpha(c.kind === 'state' ? readable.violet : p.ink, fade),
      align: 'center',
    })
  }
}
