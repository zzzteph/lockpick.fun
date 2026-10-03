/**
 * Seeded PRNG — xorshift128, seeded through splitmix32.
 *
 * The simulation never calls `Math.random()` (the lint rule in `eslint.config.js` makes that
 * an error). Everything stochastic — tolerance offsets, tool jitter, click detune — comes
 * from here, so a seed plus an input tape reproduces a run exactly.
 *
 * State is a plain object rather than a class so it clones and serialises trivially, which
 * is what the determinism tests need.
 */

export interface RngState {
  a: number
  b: number
  c: number
  d: number
}

function splitmix32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x9e3779b9) | 0
    let t = a ^ (a >>> 16)
    t = Math.imul(t, 0x21f0aaad)
    t = t ^ (t >>> 15)
    t = Math.imul(t, 0x735a2d97)
    return (t ^ (t >>> 15)) >>> 0
  }
}

export function createRng(seed: number): RngState {
  const mix = splitmix32(seed)
  const s: RngState = { a: mix(), b: mix(), c: mix(), d: mix() }
  // xorshift128 degenerates on an all-zero state.
  if ((s.a | s.b | s.c | s.d) === 0) s.a = 0x9e3779b9
  return s
}

export function cloneRng(s: RngState): RngState {
  return { a: s.a, b: s.b, c: s.c, d: s.d }
}

/** Next 32-bit unsigned integer. Mutates `s`. */
export function nextUint32(s: RngState): number {
  let t = s.a
  t ^= t << 11
  t >>>= 0
  t ^= t >>> 8
  s.a = s.b
  s.b = s.c
  s.c = s.d
  let d = s.d
  d ^= d >>> 19
  d ^= t
  s.d = d >>> 0
  return s.d
}

/** Uniform in [0, 1). */
export function nextFloat(s: RngState): number {
  return nextUint32(s) / 4294967296
}

/** Uniform in [lo, hi). */
export function nextRange(s: RngState, lo: number, hi: number): number {
  return lo + (hi - lo) * nextFloat(s)
}

/** Uniform in [-mag, +mag]. */
export function nextSigned(s: RngState, mag: number): number {
  return (nextFloat(s) * 2 - 1) * mag
}

/** Uniform integer in [0, n). */
export function nextInt(s: RngState, n: number): number {
  return Math.floor(nextFloat(s) * n)
}

/** In-place Fisher-Yates. Deterministic for a given RNG state. */
export function shuffle<T>(s: RngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = nextInt(s, i + 1)
    const a = items[i] as T
    const b = items[j] as T
    items[i] = b
    items[j] = a
  }
  return items
}
