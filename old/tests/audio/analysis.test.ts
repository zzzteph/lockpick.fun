import { describe, expect, it } from 'vitest'
import {
  countBursts,
  dominantFrequency,
  envelope,
  fftInPlace,
  floorPow2,
  hann,
  magnitudeSpectrum,
  peak,
  rms,
  spectralCentroid,
} from '../../src/audio/analysis'

const SR = 44100

function sine(hz: number, seconds: number, amplitude = 1, sampleRate = SR): Float32Array {
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate)
  return out
}

describe('level measurement', () => {
  it('measures peak and RMS of a sine correctly', () => {
    const s = sine(440, 0.1, 0.5)
    expect(peak(s)).toBeCloseTo(0.5, 2)
    // RMS of a sine is amplitude / sqrt(2).
    expect(rms(s)).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })

  it('handles silence and empty buffers', () => {
    expect(peak(new Float32Array(100))).toBe(0)
    expect(rms(new Float32Array(100))).toBe(0)
    expect(rms(new Float32Array(0))).toBe(0)
  })

  it('measures the peak of a negative excursion', () => {
    expect(peak(Float32Array.from([0, -0.8, 0.3]))).toBeCloseTo(0.8, 6)
  })
})

describe('FFT', () => {
  it('floors to a power of two', () => {
    expect(floorPow2(1)).toBe(1)
    expect(floorPow2(1000)).toBe(512)
    expect(floorPow2(1024)).toBe(1024)
    expect(floorPow2(1025)).toBe(1024)
  })

  it('transforms a constant signal to a single DC bin', () => {
    const re = new Float32Array([1, 1, 1, 1])
    const im = new Float32Array(4)
    fftInPlace(re, im)
    expect(re[0]).toBeCloseTo(4, 6)
    for (let i = 1; i < 4; i += 1) {
      expect(Math.hypot(re[i] as number, im[i] as number)).toBeCloseTo(0, 5)
    }
  })

  it('transforms an impulse to a flat spectrum', () => {
    const re = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0])
    const im = new Float32Array(8)
    fftInPlace(re, im)
    for (let i = 0; i < 8; i += 1) {
      expect(Math.hypot(re[i] as number, im[i] as number)).toBeCloseTo(1, 6)
    }
  })

  it('is a no-op for a single sample', () => {
    const re = new Float32Array([3])
    const im = new Float32Array([0])
    fftInPlace(re, im)
    expect(re[0]).toBe(3)
  })

  it('windows to zero at the edges', () => {
    const w = hann(new Float32Array(64).fill(1))
    expect(w[0]).toBeCloseTo(0, 6)
    expect(w[63]).toBeCloseTo(0, 6)
    expect(w[32]).toBeGreaterThan(0.99)
  })

  it('returns an empty spectrum for a signal too short to transform', () => {
    expect(magnitudeSpectrum(new Float32Array(1))).toHaveLength(0)
    expect(spectralCentroid(new Float32Array(1), SR)).toBe(0)
    expect(dominantFrequency(new Float32Array(1), SR)).toBe(0)
  })
})

describe('spectral measurement', () => {
  it('finds the dominant frequency of a pure tone', () => {
    for (const hz of [220, 440, 1000, 3000]) {
      const found = dominantFrequency(sine(hz, 0.2), SR)
      expect(Math.abs(found - hz), `${hz}Hz -> ${found}Hz`).toBeLessThan(SR / 4096)
    }
  })

  it('puts the centroid of a pure tone at that tone', () => {
    const c = spectralCentroid(sine(1000, 0.2), SR)
    expect(c).toBeGreaterThan(900)
    expect(c).toBeLessThan(1100)
  })

  it('ranks a bright signal above a dark one — the binding-vs-free test in miniature', () => {
    const dark = spectralCentroid(sine(80, 0.2), SR)
    const bright = spectralCentroid(sine(2000, 0.2), SR)
    expect(bright - dark).toBeGreaterThan(200)
  })

  it('places a two-tone mix between its components', () => {
    const a = sine(400, 0.2)
    const b = sine(1600, 0.2)
    const mix = new Float32Array(a.length)
    for (let i = 0; i < a.length; i += 1) mix[i] = ((a[i] as number) + (b[i] as number)) / 2
    const c = spectralCentroid(mix, SR)
    expect(c).toBeGreaterThan(400)
    expect(c).toBeLessThan(1600)
  })
})

describe('envelope measurement', () => {
  it('reports silence as silence', () => {
    const env = envelope(new Float32Array(1000), SR)
    expect(env.silent).toBe(true)
    expect(env.durationSeconds).toBe(0)
  })

  it('measures attack and duration of a synthetic percussive hit', () => {
    const n = Math.round(0.2 * SR)
    const s = new Float32Array(n)
    const attackSamples = Math.round(0.005 * SR)
    const decaySamples = Math.round(0.1 * SR)
    for (let i = 0; i < attackSamples; i += 1) s[i] = i / attackSamples
    for (let i = 0; i < decaySamples; i += 1) {
      s[attackSamples + i] = Math.exp(-6 * (i / decaySamples))
    }
    const env = envelope(s, SR)
    expect(env.silent).toBe(false)
    expect(env.peak).toBeCloseTo(1, 2)
    expect(env.attackSeconds).toBeGreaterThan(0.003)
    expect(env.attackSeconds).toBeLessThan(0.008)
    expect(env.durationSeconds).toBeGreaterThan(0.05)
    expect(env.durationSeconds).toBeLessThan(0.12)
  })

  it('ignores a signal that never clears the threshold', () => {
    const s = new Float32Array(500)
    s[10] = 1e-9
    const env = envelope(s, SR, 0.5)
    expect(env.peak).toBeGreaterThan(0)
  })
})

describe('burst counting', () => {
  it('counts well-separated bursts', () => {
    const n = SR
    const s = new Float32Array(n)
    const burstLen = Math.round(0.005 * SR)
    for (let b = 0; b < 4; b += 1) {
      const start = b * Math.round(0.1 * SR)
      for (let i = 0; i < burstLen; i += 1) s[start + i] = 1
    }
    expect(countBursts(s, SR)).toBe(4)
  })

  it('counts nothing in silence', () => {
    expect(countBursts(new Float32Array(1000), SR)).toBe(0)
  })

  it('counts a continuous tone as one burst', () => {
    expect(countBursts(sine(200, 0.05), SR, 0.02)).toBe(1)
  })
})
