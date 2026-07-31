/**
 * Playwright harness — VERIFICATION.md §3.
 *
 * Two rules live here and they are the backbone of the whole screenshot layer:
 *
 *  - **The console rule.** Any `console.error` or unhandled rejection during a run fails
 *    the test. This single check catches more real breakage than everything else combined.
 *  - **The blank-canvas rule.** After capture, the PNG is decoded and asserted to contain
 *    real drawn pixels — at least `MIN_DISTINCT_COLOURS` distinct RGB values and a
 *    luminance standard deviation above `MIN_STD_DEV`. A screenshot test that passes on a
 *    black rectangle is worse than no test.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
// The rate Space lifts at, so `liftTo` can compensate for its own sampling latency rather than
// guessing a margin. Imported from the game so the two cannot drift apart.
import { KEY_LIFT_RATE } from '../src/ui/input'
import type {
  HookFrameStats as HookFrameStatsType,
  HookFx as HookFxType,
  HookGeometry as HookGeometryType,
  HookOpenSequence as HookOpenSequenceType,
  HookState as HookStateType,
} from '../src/devhook'

export const SCREENSHOT_DIR = path.resolve(process.cwd(), 'screenshots')

/**
 * Lowered from 400 to 300 when the type scale went up by a third (D-096).
 *
 * The count is mostly a proxy for *antialiasing variety*, and bigger glyphs have proportionally
 * fewer edge pixels — so the menu, which is the sparsest screen in the game, went from comfortably
 * over 400 to 387 while gaining no less content. `MIN_STD_DEV` is the half of this rule that
 * actually catches a blank canvas, and it did not budge: a black rectangle has one colour and a
 * standard deviation of zero, both of which are still an order of magnitude from either bar.
 */
export const MIN_DISTINCT_COLOURS = 300
export const MIN_STD_DEV = 8

export interface ImageStats {
  width: number
  height: number
  distinctColours: number
  stdDev: number
  mean: number
}

/** Decode a PNG buffer and measure how much is actually drawn in it. */
export function analysePng(buffer: Buffer): ImageStats {
  const png = PNG.sync.read(buffer)
  const seen = new Set<number>()
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i] ?? 0
    const g = png.data[i + 1] ?? 0
    const b = png.data[i + 2] ?? 0
    seen.add((r << 16) | (g << 8) | b)
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sum += lum
    sumSq += lum * lum
    n += 1
  }
  const mean = n > 0 ? sum / n : 0
  const variance = n > 0 ? Math.max(0, sumSq / n - mean * mean) : 0
  return {
    width: png.width,
    height: png.height,
    distinctColours: seen.size,
    stdDev: Math.sqrt(variance),
    mean,
  }
}

export interface ConsoleWatcher {
  /** Throws (via expect) if anything was logged to console.error or thrown on the page. */
  assertClean(): void
  errors: string[]
}

/** Attach the console rule to a page. Call before the first navigation. */
export function watchConsole(page: Page): ConsoleWatcher {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
  })
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`)
  })
  page.on('requestfailed', (req) => {
    const failure = req.failure()
    // Ignore aborted navigations caused by test teardown.
    if (failure && !/net::ERR_ABORTED/.test(failure.errorText)) {
      errors.push(`requestfailed: ${req.url()} ${failure.errorText}`)
    }
  })
  return {
    errors,
    assertClean(): void {
      expect(errors, `page logged errors:\n${errors.join('\n')}`).toEqual([])
    },
  }
}

// ── Talking to the game (`window.__shearline`, VERIFICATION.md §3) ──────────────────────
//
// The contract itself lives in `src/devhook.ts`, so the harness cannot drift from the game.

export type {
  DevHook,
  HookChamber,
  HookFrameStats,
  HookFx,
  HookGeometry,
  HookRect,
  HookState,
} from '../src/devhook'

/** Alias kept because the specs read better with "snapshot" than "hook state". */
export type StateSnapshot = HookStateType

export async function getFx(page: Page): Promise<HookFxType> {
  return page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.getFx()
  })
}

export async function setReducedMotion(page: Page, reduced: boolean): Promise<void> {
  await page.evaluate((r) => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    h.setReducedMotion(r)
  }, reduced)
}

export interface ToolPatch {
  tensionMin?: number
  tensionMax?: number
  tensionSlew?: number
  tensionPrecision?: number
  reach?: number
  liftJitter?: number
  liftRate?: number
  fitsTightKeyway?: boolean
  keywayPosition?: 'top' | 'bottom'
  rakeStrength?: number
}

export async function setTools(page: Page, patch: ToolPatch | null): Promise<void> {
  await page.evaluate((p) => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    h.setTools(p)
  }, patch)
}

export async function setFeathering(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate((e) => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    h.setFeathering(e)
  }, enabled)
}

export interface SimInputPatch {
  chamber?: number
  liftTarget?: number
  tensionHeld?: boolean
  tensionLevel?: number
  raking?: boolean
}

export async function loadLock(page: Page, key: number | string, seed = 1): Promise<void> {
  await page.evaluate(
    ([k, s]) => {
      const h = globalThis.__shearline
      if (!h) throw new Error('window.__shearline is missing — is this a dev build?')
      h.loadLock(k, s)
    },
    [key, seed] as [number | string, number],
  )
}

export async function setInput(page: Page, patch: SimInputPatch | null): Promise<void> {
  await page.evaluate((p) => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    h.setInput(p)
  }, patch)
}

export async function setManual(page: Page, manual: boolean): Promise<void> {
  await page.evaluate((m) => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    h.setManual(m)
  }, manual)
}

export async function stepTicks(page: Page, n: number): Promise<void> {
  await page.evaluate((count) => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    h.stepTicks(count)
  }, n)
}

export async function renderOnce(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    h.renderOnce()
  })
}

export async function getState(page: Page): Promise<HookStateType> {
  return page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.getState()
  })
}

export async function getGeometry(page: Page): Promise<HookGeometryType> {
  return page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.getGeometry()
  })
}

export async function pointerFor(
  page: Page,
  chamber: number,
  liftMm: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([c, l]) => {
      const h = globalThis.__shearline
      if (!h) throw new Error('no hook')
      return h.pointerFor(c, l)
    },
    [chamber, liftMm] as [number, number],
  )
}

export async function advanceSeconds(page: Page, seconds: number): Promise<void> {
  await page.evaluate((s) => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    h.advanceSeconds(s)
  }, seconds)
}

export async function openSequence(page: Page): Promise<HookOpenSequenceType> {
  return page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.openSequence()
  })
}

export async function skipOpenSequence(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.skipOpenSequence()
  })
}

export async function earnedThisAttempt(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.earnedThisAttempt()
  })
}

export async function frameStats(page: Page): Promise<HookFrameStatsType> {
  return page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.frameStats()
  })
}

export interface BootOptions {
  /** Path to open, defaults to '/'. */
  path?: string
  /** Wait until this many frames have been rendered. */
  frames?: number
}

/** Boot the game and wait until the renderer has painted. */
export async function bootGame(page: Page, opts: BootOptions = {}): Promise<ConsoleWatcher> {
  const watcher = watchConsole(page)
  await page.goto(opts.path ?? '/')
  const wantFrames = opts.frames ?? 3
  await page.waitForFunction(
    (n) => {
      const hook = (globalThis as { __shearline?: { framesRendered: number } }).__shearline
      return hook !== undefined && hook.framesRendered >= n
    },
    wantFrames,
    { timeout: 20_000 },
  )
  return watcher
}

/**
 * Every distinct **luminance** in a capture, and how far apart the nearest two are.
 *
 * The greyscale test needs to know whether two states that differ only in hue are still
 * distinguishable with colour removed. Counting distinct luminances is not enough on its own —
 * a page can carry hundreds and still have amber and teal land on the same grey — so this also
 * reports how well separated the *common* levels are.
 */
export function luminanceProfile(buffer: Buffer): {
  levels: number
  /** Fraction of pixels covered by the ten most common levels. */
  topShare: number
  /** Standard deviation of luminance, as `analysePng` computes it. */
  stdDev: number
} {
  const png = PNG.sync.read(buffer)
  const hist = new Map<number, number>()
  let n = 0
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i] ?? 0
    const g = png.data[i + 1] ?? 0
    const b = png.data[i + 2] ?? 0
    const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
    hist.set(lum, (hist.get(lum) ?? 0) + 1)
    n += 1
  }
  const sorted = [...hist.values()].sort((a, b) => b - a)
  const top = sorted.slice(0, 10).reduce((a, b) => a + b, 0)
  return {
    levels: hist.size,
    topShare: n > 0 ? top / n : 0,
    stdDev: analysePng(buffer).stdDev,
  }
}

/** Screenshot the page with the whole document desaturated, for the colourblind check. */
export async function captureGreyscale(page: Page, name: string): Promise<Buffer> {
  await page.addStyleTag({ content: 'html { filter: grayscale(1) !important; }' })
  await renderOnce(page)
  const buffer = await page.screenshot({ type: 'png' })
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  writeFileSync(path.join(SCREENSHOT_DIR, `${name}.png`), buffer)
  return buffer
}

/**
 * Capture the page, write it to `screenshots/<name>.png`, and enforce the blank-canvas
 * rule on the bytes that were actually written.
 *
 * `minColours` lowers the bar for a screen that is *supposed* to be nearly empty — currently one:
 * the portrait rotate prompt, which is paper and two lines of type and nothing else. Lowering it
 * is only honest where something *else* already proves the right screen drew; the rotate prompt's
 * test asserts the widget count is zero, which the ordinary menu could never be. Anywhere else,
 * a screen this empty is a bug and the default should catch it.
 */
export async function captureStage(
  page: Page,
  name: string,
  opts: { minColours?: number } = {},
): Promise<ImageStats> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const buffer = await page.screenshot({ type: 'png' })
  const file = path.join(SCREENSHOT_DIR, `${name}.png`)
  writeFileSync(file, buffer)
  const stats = analysePng(buffer)
  const floor = opts.minColours ?? MIN_DISTINCT_COLOURS
  expect(
    stats.distinctColours,
    `${name}.png looks blank: only ${stats.distinctColours} distinct colours`,
  ).toBeGreaterThanOrEqual(floor)
  expect(
    stats.stdDev,
    `${name}.png looks flat: luminance stdDev ${stats.stdDev.toFixed(2)}`,
  ).toBeGreaterThan(MIN_STD_DEV)
  return stats
}

// ── Playing with the keyboard ───────────────────────────────────────────────────────────
//
// Picking is keyboard-only (D-059), so a test that claims "a human can open this" has to press
// the keys a human presses. These four helpers are the whole scheme: hold the wrench, choose the
// pressure step, walk the tip along the keyway, push a pin up.
//
// They poll `getInput()` rather than counting key presses, because what a press *does* depends on
// where the tip already was — and because the commanded lift is a rate, held on Space, not a
// value you can set. Polling the hand is how a person plays: press, watch, stop.

/**
 * Set the assist level on the live save.
 *
 * A level is not just what the drawing shows — since D-111 it also decides whether the arrow-key
 * trim exists at all — so a spec that cares about either has to say which level it is on rather
 * than inherit whatever the default happens to be this month.
 */
export async function setAssist(
  page: Page,
  assist: 'training' | 'easy' | 'medium' | 'hard',
): Promise<void> {
  await page.evaluate((level) => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    const save = h.getSave()
    h.setSave({ ...save, settings: { ...save.settings, assist: level } })
  }, assist)
}

/** What the input layer is currently asking the simulation for. */
export async function getInput(page: Page): Promise<{
  chamber: number
  liftTarget: number
  tensionHeld: boolean
  tensionLevel: number
}> {
  return page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.getInput()
  })
}

/** Put the wrench on, or take it off. */
export async function tension(page: Page, on: boolean): Promise<void> {
  if (on) await page.keyboard.down('KeyQ')
  else await page.keyboard.up('KeyQ')
  await page.waitForTimeout(40)
}

/** Choose a pressure step, 1-10. `0` on the keyboard is step 10. */
export async function pressureStep(page: Page, step: number): Promise<void> {
  const key = step >= 10 ? 'Digit0' : `Digit${step}`
  await page.keyboard.press(key)
  await page.waitForTimeout(40)
}

/**
 * Walk the tip to a chamber with the arrow keys.
 *
 * Each press moves one chamber *and drops the pick* (D-051), so arriving anywhere always arrives
 * with the hand low — which is exactly the motion the mouse made you remember.
 */
export async function moveTo(page: Page, chamber: number, tries = 24): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    const at = (await getInput(page)).chamber
    if (at === chamber) return true
    await page.keyboard.press(at < chamber ? 'ArrowRight' : 'ArrowLeft')
    await page.waitForTimeout(30)
  }
  return (await getInput(page)).chamber === chamber
}

/**
 * Hold Space until the hand is asking for `liftMm`, then let go.
 *
 * Space is a *rate* — `KEY_LIFT_RATE` mm per second while it is down — so this is a
 * press-and-watch loop rather than an assignment.
 *
 * **It watches from the wrong side of a round trip**, which is the part that had to be fixed. The
 * loop used to break when the *last sample it managed to take* had reached the target, and each
 * sample is a `page.evaluate` — a few milliseconds on an idle machine and fifty or more with six
 * workers sharing six cores. Space stays down throughout, so at 4.2mm/s a fifty-millisecond
 * sample costs 0.21mm of travel nobody saw, which is most of a Tier 1 capture window. The comment
 * here used to claim it "cannot sail past". It could, and did: `a human can open the lock from
 * the keyboard` oversets under load, on a two-pin practice lock, and only under load.
 *
 * So it stops *early*, by however far the tip will move before the next sample could possibly
 * see it — the round trip just measured, plus the poll interval. Overshoot is bounded by one
 * frame of travel instead of by how busy the machine is.
 */
export async function liftTo(page: Page, liftMm: number, timeoutMs = 4000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  const POLL_MS = 16
  await page.keyboard.down('Space')
  let asked = 0
  while (Date.now() < deadline) {
    const sentAt = Date.now()
    asked = (await getInput(page)).liftTarget
    const roundTripS = (Date.now() - sentAt + POLL_MS) / 1000
    if (asked >= liftMm - KEY_LIFT_RATE * roundTripS) break
    await page.waitForTimeout(POLL_MS)
  }
  await page.keyboard.up('Space')
  await page.waitForTimeout(30)
  return asked
}

/**
 * Let the shaft unbend.
 *
 * The pick takes a permanent set if you keep leaning on something that will not move (D-068), so a
 * driver that only ever pushes eventually snaps its tool and then cannot open anything. Space is
 * already up by the time this is called, so the lift decays on its own — this is just waiting for
 * it, which is exactly what the relief is: stop pushing for a beat.
 */
export async function relieve(page: Page, below = 0.45, timeoutMs = 3000): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let strain = (await getState(page)).pickStrain
  while (strain > below && Date.now() < deadline) {
    await page.waitForTimeout(80)
    strain = (await getState(page)).pickStrain
  }
  return strain
}

/** Move to a chamber and push it to a height — the two-step motion, in one call. */
export async function workChamber(page: Page, chamber: number, liftMm: number): Promise<void> {
  await moveTo(page, chamber)
  await liftTo(page, liftMm)
  // Only when it has actually built up: the check is one round trip and costs nothing otherwise.
  const { pickStrain } = await getState(page)
  if (pickStrain > 0.45) await relieve(page)
}
