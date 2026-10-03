/** Small numeric helpers. Kept separate so the physics reads as physics. */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

/** Move `from` toward `to` by at most `maxDelta`. */
export function moveToward(from: number, to: number, maxDelta: number): number {
  const d = to - from
  if (d > maxDelta) return from + maxDelta
  if (d < -maxDelta) return from - maxDelta
  return to
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Exponential smoothing that is stable at any dt. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt)
}

export function approxEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps
}
