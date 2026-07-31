/**
 * The frame loop.
 *
 * `requestAnimationFrame` drives it; the fixed-timestep accumulator lives in `Session`.
 * This module's only jobs are supplying real elapsed time, keeping a frame-time history for
 * the Phase 14 histogram, and letting a test hook take manual control.
 */

export interface FrameStats {
  /** Milliseconds between the last two frame callbacks. */
  last: number
  /** Rolling window of frame intervals, newest last. */
  readonly history: number[]
  /**
   * Rolling window of how long the frame callback itself took — simulate, then draw.
   *
   * This, not the interval, is what says whether the game can hold 60fps. The interval is
   * the browser's business: a headless or backgrounded tab throttles `requestAnimationFrame`
   * to 30Hz whatever the page is doing, so measuring it under test measures the harness.
   */
  readonly work: number[]
  frames: number
}

export interface Loop {
  readonly stats: FrameStats
  stop(): void
  /** Advance one frame by an explicit dt, for deterministic tests. */
  tick(seconds: number): void
  /** Pause the rAF driver so `tick` is the only source of time. */
  setManual(manual: boolean): void
}

const HISTORY_LIMIT = 600

export function startLoop(frame: (seconds: number) => void): Loop {
  const stats: FrameStats = { last: 0, history: [], work: [], frames: 0 }
  let running = true
  let manual = false
  let previous = performance.now()
  let handle = 0

  const record = (ms: number, workMs: number): void => {
    stats.last = ms
    stats.frames += 1
    stats.history.push(ms)
    stats.work.push(workMs)
    if (stats.history.length > HISTORY_LIMIT) stats.history.shift()
    if (stats.work.length > HISTORY_LIMIT) stats.work.shift()
  }

  const onFrame = (now: number): void => {
    if (!running) return
    handle = requestAnimationFrame(onFrame)
    const ms = now - previous
    previous = now
    if (manual) return
    const started = performance.now()
    frame(ms / 1000)
    record(ms, performance.now() - started)
  }
  handle = requestAnimationFrame(onFrame)

  return {
    stats,
    stop(): void {
      running = false
      cancelAnimationFrame(handle)
    },
    tick(seconds: number): void {
      const started = performance.now()
      frame(seconds)
      record(seconds * 1000, performance.now() - started)
    },
    setManual(value: boolean): void {
      manual = value
      previous = performance.now()
    },
  }
}

/** Percentile of a frame-time history, in milliseconds. */
export function percentile(history: readonly number[], p: number): number {
  if (history.length === 0) return 0
  const sorted = [...history].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[idx] ?? 0
}
