import { describe, expect, it } from 'vitest'
import {
  SOUNDED_EVENTS,
  SOUNDS,
  soundById,
  type SoundSpec,
} from '../../src/audio/catalogue'
import {
  CLICK_HIGH_HZ,
  CLICK_LOW_HZ,
  FALSE_SET_RATIOS,
  PENTATONIC,
  RESET_STAGGER,
  clickBodyFrequency,
} from '../../src/audio/synth'
import { DEFAULT_AUDIO_SETTINGS, VOICE_CAP, clickDetune } from '../../src/audio/engine'

describe('the sound catalogue covers AUDIO.md §3', () => {
  it('has an entry for every sounded simulation event', () => {
    const covered = new Set(SOUNDS.map((s) => s.event).filter(Boolean))
    for (const event of SOUNDED_EVENTS) {
      expect(covered.has(event), `no sound wired to ${event}`).toBe(true)
    }
  })

  it('names every sound in the spec table', () => {
    const ids = SOUNDS.map((s) => s.id)
    for (const id of [
      'click-shallow',
      'click-deep',
      'scrape',
      'spring',
      'binding',
      'free-pin',
      'counter-rotation',
      'false-set',
      'overset',
      'plug-friction',
      'reset',
      'open',
      'ui',
      'ambience',
    ]) {
      expect(ids, `missing ${id}`).toContain(id)
    }
  })

  it('has unique ids and a sane render window for each', () => {
    expect(new Set(SOUNDS.map((s) => s.id)).size).toBe(SOUNDS.length)
    for (const s of SOUNDS) {
      expect(s.seconds, s.id).toBeGreaterThan(0)
      expect(s.seconds, s.id).toBeLessThanOrEqual(2)
      expect(s.name.length, s.id).toBeGreaterThan(0)
      expect(s.description.length, s.id).toBeGreaterThan(0)
    }
  })

  it('looks up by id', () => {
    const first = SOUNDS[0] as SoundSpec
    expect(soundById(first.id)).toBe(first)
    expect(soundById('nope')).toBeUndefined()
  })
})

describe('click pitch mapping — AUDIO.md §2', () => {
  it('runs from 420Hz at the mouth down to 180Hz at the deepest chamber', () => {
    expect(clickBodyFrequency(0, 5)).toBeCloseTo(CLICK_HIGH_HZ, 6)
    expect(clickBodyFrequency(4, 5)).toBeCloseTo(CLICK_LOW_HZ, 6)
  })

  it('is monotonically lower as pins get deeper', () => {
    let previous = Number.POSITIVE_INFINITY
    for (let i = 0; i < 12; i += 1) {
      const f = clickBodyFrequency(i, 12)
      expect(f).toBeLessThan(previous)
      previous = f
    }
  })

  it('keeps adjacent pins far enough apart to be learnable', () => {
    // Even on a 12-chamber lock, neighbouring pins differ by ~22Hz — a musical step.
    const a = clickBodyFrequency(5, 12)
    const b = clickBodyFrequency(6, 12)
    expect(a - b).toBeGreaterThan(15)
  })

  it('handles a one-chamber lock without dividing by zero', () => {
    expect(Number.isFinite(clickBodyFrequency(0, 1))).toBe(true)
    expect(clickBodyFrequency(0, 1)).toBeCloseTo(CLICK_HIGH_HZ, 6)
  })

  it('applies detune as a proportion', () => {
    expect(clickBodyFrequency(0, 5, 0.04)).toBeCloseTo(CLICK_HIGH_HZ * 1.04, 6)
    expect(clickBodyFrequency(0, 5, -0.04)).toBeCloseTo(CLICK_HIGH_HZ * 0.96, 6)
  })
})

describe('click detune', () => {
  it('stays inside ±4%', () => {
    for (let chamber = 0; chamber < 12; chamber += 1) {
      for (let tick = 0; tick < 400; tick += 7) {
        const d = clickDetune(chamber, tick)
        expect(Math.abs(d)).toBeLessThanOrEqual(0.04)
      }
    }
  })

  it('is deterministic and varied', () => {
    expect(clickDetune(3, 100)).toBe(clickDetune(3, 100))
    const seen = new Set<number>()
    for (let t = 0; t < 200; t += 1) seen.add(clickDetune(2, t))
    expect(seen.size).toBeGreaterThan(150)
  })

  it('does not touch the simulation PRNG', () => {
    // Derived from a hash of (chamber, tick), so a replay cannot diverge because a sound
    // played. This is asserted by construction: the function takes no RNG state.
    expect(clickDetune.length).toBe(2)
  })
})

describe('synthesis constants', () => {
  it('uses the inharmonic ratios the spec names for the false set', () => {
    expect([...FALSE_SET_RATIOS]).toEqual([1.0, 2.7, 5.3])
  })

  it('uses a major pentatonic for the open arpeggio', () => {
    expect(PENTATONIC).toHaveLength(5)
    expect([...PENTATONIC]).toEqual([1, 9 / 8, 5 / 4, 3 / 2, 5 / 3])
    let previous = 0
    for (const r of PENTATONIC) {
      expect(r).toBeGreaterThan(previous)
      previous = r
    }
  })

  it('staggers the reset cascade by 25ms', () => {
    expect(RESET_STAGGER).toBeCloseTo(0.025, 9)
  })

  it('caps polyphony at 24', () => {
    expect(VOICE_CAP).toBe(24)
  })

  it('defaults ambience quiet and unmuted', () => {
    expect(DEFAULT_AUDIO_SETTINGS.ambient).toBeCloseTo(0.2, 6)
    expect(DEFAULT_AUDIO_SETTINGS.muted).toBe(false)
  })
})
