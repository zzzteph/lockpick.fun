/**
 * Signal analysis — AUDIO.md §6.
 *
 * "You can't listen. Test structurally instead." These are the measuring tools: peak, RMS,
 * envelope shape, and a spectral centroid via a real FFT. Pure arithmetic over `Float32Array`,
 * with no Web Audio anywhere in it, so the maths is unit tested against signals whose answers
 * are known analytically before it is ever pointed at a rendered lock sound.
 */

export function peak(samples: Float32Array): number {
  let max = 0
  for (const s of samples) {
    const a = s < 0 ? -s : s
    if (a > max) max = a
  }
  return max
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const s of samples) sum += s * s
  return Math.sqrt(sum / samples.length)
}

/** Largest power of two not exceeding `n`. */
export function floorPow2(n: number): number {
  let p = 1
  while (p * 2 <= n) p *= 2
  return p
}

/**
 * In-place iterative radix-2 FFT. `re`/`im` must be the same power-of-two length.
 * Written out rather than pulled in as a dependency — it is forty lines and this project
 * ships nothing it did not generate itself.
 */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length
  if (n <= 1) return
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i] as number
      re[i] = re[j] as number
      re[j] = tr
      const ti = im[i] as number
      im[i] = im[j] as number
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k += 1) {
        const ar = re[i + k] as number
        const ai = im[i + k] as number
        const br = re[i + k + len / 2] as number
        const bi = im[i + k + len / 2] as number
        const tr = br * cr - bi * ci
        const ti = br * ci + bi * cr
        re[i + k] = ar + tr
        im[i + k] = ai + ti
        re[i + k + len / 2] = ar - tr
        im[i + k + len / 2] = ai - ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/** Hann window, applied in place. */
export function hann(samples: Float32Array): Float32Array {
  const n = samples.length
  for (let i = 0; i < n; i += 1) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
    samples[i] = (samples[i] as number) * w
  }
  return samples
}

/** Magnitude spectrum of the first power-of-two window of `samples`, Hann-windowed. */
export function magnitudeSpectrum(samples: Float32Array): Float32Array {
  const n = floorPow2(samples.length)
  if (n < 2) return new Float32Array(0)
  const re = hann(samples.slice(0, n))
  const im = new Float32Array(n)
  fftInPlace(re, im)
  const half = n / 2
  const mags = new Float32Array(half)
  for (let i = 0; i < half; i += 1) {
    mags[i] = Math.hypot(re[i] as number, im[i] as number)
  }
  return mags
}

/**
 * Spectral centroid in Hz — the "centre of mass" of the spectrum, and the number
 * AUDIO.md §6 uses to prove the binding and free-pin sounds are distinguishable.
 */
export function spectralCentroid(samples: Float32Array, sampleRate: number): number {
  const mags = magnitudeSpectrum(samples)
  if (mags.length === 0) return 0
  const binHz = sampleRate / (mags.length * 2)
  let weighted = 0
  let total = 0
  for (let i = 0; i < mags.length; i += 1) {
    const m = mags[i] as number
    weighted += m * i * binHz
    total += m
  }
  return total > 0 ? weighted / total : 0
}

/** Frequency of the loudest bin, in Hz. */
export function dominantFrequency(samples: Float32Array, sampleRate: number): number {
  const mags = magnitudeSpectrum(samples)
  if (mags.length === 0) return 0
  let best = 0
  let bestIndex = 0
  // Skip DC.
  for (let i = 1; i < mags.length; i += 1) {
    const m = mags[i] as number
    if (m > best) {
      best = m
      bestIndex = i
    }
  }
  return (bestIndex * sampleRate) / (mags.length * 2)
}

export interface Envelope {
  /** Seconds from the first audible sample to the peak. */
  attackSeconds: number
  /** Seconds from the first audible sample to the last one. */
  durationSeconds: number
  /** Index of the peak sample. */
  peakIndex: number
  peak: number
  /** True when the signal never rose above the threshold at all. */
  silent: boolean
}

/**
 * Measure a one-shot's envelope. `threshold` is relative to the signal's own peak, so it
 * works the same on a quiet UI tick and a loud open thunk.
 */
export function envelope(samples: Float32Array, sampleRate: number, threshold = 0.02): Envelope {
  const p = peak(samples)
  if (p <= 0) {
    return { attackSeconds: 0, durationSeconds: 0, peakIndex: 0, peak: 0, silent: true }
  }
  const level = p * threshold
  let first = -1
  let last = -1
  let peakIndex = 0
  for (let i = 0; i < samples.length; i += 1) {
    const a = Math.abs(samples[i] as number)
    if (a >= level) {
      if (first < 0) first = i
      last = i
    }
    if (a === p && peakIndex === 0) peakIndex = i
  }
  if (first < 0) {
    return { attackSeconds: 0, durationSeconds: 0, peakIndex: 0, peak: p, silent: true }
  }
  return {
    attackSeconds: (peakIndex - first) / sampleRate,
    durationSeconds: (last - first + 1) / sampleRate,
    peakIndex,
    peak: p,
    silent: false,
  }
}

/** Count how many separate bursts of sound a buffer contains, for cascade assertions. */
export function countBursts(samples: Float32Array, sampleRate: number, gapSeconds = 0.01): number {
  const p = peak(samples)
  if (p <= 0) return 0
  const level = p * 0.06
  const gapSamples = Math.max(1, Math.round(gapSeconds * sampleRate))
  let bursts = 0
  let quiet = gapSamples
  for (const s of samples) {
    if (Math.abs(s) >= level) {
      if (quiet >= gapSamples) bursts += 1
      quiet = 0
    } else {
      quiet += 1
    }
  }
  return bursts
}
