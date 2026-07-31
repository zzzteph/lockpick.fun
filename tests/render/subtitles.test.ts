/**
 * Audio subtitles — `PHASES.md` Phase 12.
 *
 * The requirement behind these is that *Blind mode is completable with sound off*. That only
 * holds if every sound the game makes has words, so the load-bearing test here is the one that
 * enumerates `SimEvent['type']` and insists each is either captioned or on a declared list of
 * silent ones. A new event type cannot be added without deciding what it says.
 */

import { describe, expect, it } from 'vitest'
import {
  CAPTION_SECONDS,
  MAX_CAPTIONS,
  SILENT_EVENTS,
  captionFor,
  clearSubtitles,
  createSubtitles,
  pushCaption,
  pushSubtitleEvents,
  sustainedCaption,
  updateSubtitles,
} from '../../src/render/subtitles'
import type { SimEvent, SimEventType } from '../../src/sim'

/** One of every event the simulation can emit. */
const EVERY_EVENT: SimEvent[] = [
  { type: 'ATTEMPT_STARTED', time: 0 },
  { type: 'PIN_SET', chamber: 2, tension: 0.4, time: 1 },
  { type: 'PIN_OVERSET', chamber: 0, time: 2 },
  { type: 'FALSE_SET_ENTERED', chamber: 1, depth: 0.3, time: 3 },
  { type: 'COUNTER_ROTATION', chamber: 1, force: 12, time: 4 },
  { type: 'PLUG_MOVED', theta: 0.1, velocity: 0.4, time: 5 },
  { type: 'LOCK_OPENED', time: 6, ticks: 720 },
  { type: 'RESET', kind: 'full', dropped: [0, 1], time: 7 },
  { type: 'RESET', kind: 'feather', dropped: [2], time: 8 },
  { type: 'PICK_MOVED', from: 0, to: 1, time: 9 },
]

describe('caption coverage', () => {
  it('covers every event type the simulation can emit', () => {
    const seen = new Set<SimEventType>()
    for (const e of EVERY_EVENT) seen.add(e.type)
    const types: SimEventType[] = [
      'ATTEMPT_STARTED',
      'PIN_SET',
      'PIN_OVERSET',
      'FALSE_SET_ENTERED',
      'COUNTER_ROTATION',
      'PLUG_MOVED',
      'LOCK_OPENED',
      'RESET',
      'PICK_MOVED',
    ]
    // The fixture list itself is complete — if a type is added to the union and not here, the
    // exhaustive switch in `captionFor` fails to compile, which is the other half of the net.
    expect([...seen].sort()).toEqual([...types].sort())
  })

  it('captions everything that makes a sound, and only deliberately silences the rest', () => {
    for (const e of EVERY_EVENT) {
      const line = captionFor(e)
      if (SILENT_EVENTS.includes(e.type)) {
        expect(line, `${e.type} is declared silent`).toBeNull()
      } else {
        expect(line, `${e.type} has no caption`).not.toBeNull()
        expect((line ?? '').length, e.type).toBeGreaterThan(4)
      }
    }
  })

  it('describes the event, not the waveform', () => {
    expect(captionFor(EVERY_EVENT[1] as SimEvent)).toContain('pin 3')
    expect(captionFor(EVERY_EVENT[2] as SimEvent)).toContain('overset')
    expect(captionFor(EVERY_EVENT[3] as SimEvent)).toContain('false set')
    expect(captionFor(EVERY_EVENT[6] as SimEvent)).toContain('opens')
  })

  it('numbers pins the way the HUD does — from one, not from zero', () => {
    expect(captionFor({ type: 'PIN_SET', chamber: 0, tension: 0.4, time: 0 })).toContain('pin 1')
  })

  it('tells a feather from a full reset', () => {
    const full = captionFor({ type: 'RESET', kind: 'full', dropped: [0, 1, 2], time: 0 })
    const feather = captionFor({ type: 'RESET', kind: 'feather', dropped: [1], time: 0 })
    expect(full).not.toBe(feather)
    expect(feather).toContain('1 pin')
    expect(full).toContain('everything')
  })
})

describe('the sustained line', () => {
  it('names the grind and the turn, and stays quiet otherwise', () => {
    expect(sustainedCaption(12, 0)).toContain('grind')
    expect(sustainedCaption(0, 0.4)).toContain('turn')
    expect(sustainedCaption(0, 0)).toBeNull()
  })

  it('is announced once, not once a frame', () => {
    const s = createSubtitles()
    for (let i = 0; i < 30; i += 1) updateSubtitles(s, 1 / 60, 12, 0)
    expect(s.captions.filter((c) => c.kind === 'state')).toHaveLength(1)
  })

  it('is re-announced when it genuinely changes', () => {
    const s = createSubtitles()
    updateSubtitles(s, 1 / 60, 12, 0)
    updateSubtitles(s, 1 / 60, 0, 0)
    updateSubtitles(s, 1 / 60, 12, 0)
    expect(s.captions.filter((c) => c.kind === 'state')).toHaveLength(2)
  })
})

describe('the caption stack', () => {
  it('expires captions after their time', () => {
    const s = createSubtitles()
    pushCaption(s, 'pin 1 sets — click')
    expect(s.captions).toHaveLength(1)
    updateSubtitles(s, CAPTION_SECONDS + 0.01, 0, 0)
    expect(s.captions).toHaveLength(0)
  })

  it('never grows past the cap, dropping the oldest', () => {
    const s = createSubtitles()
    for (let i = 0; i < MAX_CAPTIONS + 4; i += 1) pushCaption(s, `line ${i}`)
    expect(s.captions).toHaveLength(MAX_CAPTIONS)
    expect(s.captions[0]?.text).toBe(`line ${4}`)
    expect(s.captions[MAX_CAPTIONS - 1]?.text).toBe(`line ${MAX_CAPTIONS + 3}`)
  })

  it('takes a whole event batch and skips the silent ones', () => {
    const s = createSubtitles()
    pushSubtitleEvents(s, EVERY_EVENT)
    const expected = EVERY_EVENT.filter((e) => captionFor(e) !== null).length
    expect(s.captions).toHaveLength(Math.min(MAX_CAPTIONS, expected))
    expect(s.captions.every((c) => c.text.length > 4)).toBe(true)
  })

  it('clears completely between attempts', () => {
    const s = createSubtitles()
    pushSubtitleEvents(s, EVERY_EVENT)
    updateSubtitles(s, 1 / 60, 12, 0)
    clearSubtitles(s)
    expect(s.captions).toHaveLength(0)
    expect(s.sustained).toBeNull()
    // …and the sustained line is re-announced next time rather than assumed still true.
    updateSubtitles(s, 1 / 60, 12, 0)
    expect(s.captions).toHaveLength(1)
  })
})
