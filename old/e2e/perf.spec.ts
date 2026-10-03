import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  SCREENSHOT_DIR,
  bootGame,
  frameStats,
  getState,
  loadLock,
  setInput,
  stepTicks,
} from './harness'

/** 60fps. Anything above this in a frame is a dropped frame. */
const BUDGET_MS = 1000 / 60

/**
 * The two heaviest locks left after D-104.
 *
 * They have now been re-pointed twice, which is worth saying out loud: they were the
 * twelve-chamber twin-row dimples until D-088 took the dimple family, then the eleven-disc Protec
 * until D-104 took the disc detainers. Both times a *content* change silently invalidated a
 * *performance* claim, and both times the test said so by failing to load a lock rather than by
 * quietly measuring something easier — which is the argument for naming locks by id here instead
 * of picking "the biggest" dynamically.
 *
 * What is left is all one family. The Sovereign has the most chambers in the game at seven, every
 * one of them a security pin with a full band stack to classify and draw; the sidebar cylinder is
 * the most *machinery* per frame — six chambers, three of them carrying a second capture condition,
 * plus the sidebar lamp in the footer.
 *
 * **Nothing in the roster exercises the face-on renderer any more.** It was the most expensive
 * thing to draw, so this histogram no longer covers the worst case the *code* can reach — only the
 * worst case the *game* can reach, which is what the 60fps promise is actually about.
 */
const SOVEREIGN = 31 // Halberd Sovereign — seven chambers, every one a security pin, tight keyway.
const SIDEBAR = 27 // Halberd Sidebar Cylinder — six chambers, three sidebar gates, spools.

/**
 * Give the player money and unlock everything. There are no tools to grant any more (D-088) —
 * this exists only so a spec can skip the progression and get straight to a lock.
 */
async function grant(page: Page, credits = 20_000): Promise<void> {
  const current = await page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.getSave()
  })
  await page.evaluate(
    (d) => {
      globalThis.__shearline?.setSave(d)
    },
    { ...current, credits },
  )
}

function histogram(samples: readonly number[], buckets: readonly number[]): string {
  const counts = buckets.map(() => 0)
  let over = 0
  for (const s of samples) {
    const i = buckets.findIndex((b) => s < b)
    if (i < 0) over += 1
    else counts[i] = (counts[i] ?? 0) + 1
  }
  const total = Math.max(1, samples.length)
  const lines: string[] = []
  let previous = 0
  buckets.forEach((b, i) => {
    const n = counts[i] ?? 0
    const share = n / total
    lines.push(
      `  ${previous.toFixed(1).padStart(5)} – ${b.toFixed(1).padStart(5)} ms  ` +
        `${String(n).padStart(6)}  ${(share * 100).toFixed(1).padStart(5)}%  ` +
        '#'.repeat(Math.round(share * 50)),
    )
    previous = b
  })
  const overShare = over / total
  lines.push(
    `  ${previous.toFixed(1).padStart(5)} +          ms  ` +
      `${String(over).padStart(6)}  ${(overShare * 100).toFixed(1).padStart(5)}%  ` +
      '#'.repeat(Math.round(overShare * 50)),
  )
  return lines.join('\n')
}

function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[i] ?? 0
}

/**
 * The frame-time histogram — `PHASES.md` Phase 14.
 *
 * Measures the **work inside each frame callback**, not the interval between callbacks. A
 * headless browser throttles `requestAnimationFrame` to whatever it feels like, so intervals
 * measure Chromium's scheduler and tell you nothing about the game. Time spent in the callback
 * is the number that decides whether a real machine at 60Hz keeps up. See DECISIONS D-022.
 */
test('60fps on the heaviest locks, with a histogram to prove it', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 5 })
  await grant(page)

  const report: string[] = [
    'SHEAR LINE — frame-time histogram',
    '='.repeat(78),
    '',
    'Time spent *inside* each frame callback: simulate, then draw. The interval between',
    'callbacks measures the browser’s scheduler, which is throttled headless and says',
    'nothing about the game — see DECISIONS.md D-022.',
    '',
    `Budget: ${BUDGET_MS.toFixed(2)} ms/frame (60fps).`,
    '',
  ]

  for (const [id, label] of [
    [SOVEREIGN, 'Halberd Sovereign — 7 chambers, every one a security pin'],
    [SIDEBAR, 'Halberd Sidebar Cylinder — 6 chambers, 3 sidebar gates'],
  ] as const) {
    await loadLock(page, id, 3)
    // Play it, rather than watching it idle: pick engaged, tension held, pins moving. An idle
    // frame is the cheapest frame there is and measuring one would be measuring nothing.
    await setInput(page, { chamber: 5, liftTarget: 1.4, tensionHeld: true, tensionLevel: 0.45 })
    await stepTicks(page, 120)

    /**
     * Four seconds, not two — so that `p99` means what the assertion below thinks it means.
     *
     * At 2200ms the sample was about 130 frames, which makes the 99th percentile the *second
     * worst frame in the run*. One garbage collection, or one moment of the machine still tearing
     * down the browser suite that `npm run verify` runs immediately before this, and a build that
     * holds a 2ms mean fails on a 60ms hitch. That happened, and the fix is not a looser bound: a
     * percentile taken over 130 samples is not a percentile. Four seconds is ~240 frames, where
     * p99 is a genuine tail rather than a single outlier, and the settle below keeps the
     * measurement from starting while the previous suite is still exiting. See DECISIONS D-038.
     */
    await page.waitForTimeout(600)
    await page.evaluate(() => globalThis.__shearline?.setManual(false))
    await page.waitForTimeout(4000)
    const stats = await frameStats(page)
    await page.evaluate(() => globalThis.__shearline?.setManual(true))

    // The first handful of frames are the JIT warming up and the first paint landing, and on
    // this machine that is a single ~24ms frame followed by sub-millisecond ones forever. They
    // are dropped, and *reported* — hiding them would misrepresent the steady state and
    // including them would misrepresent it the other way.
    const all = stats.work.filter((w) => w > 0)
    const WARMUP = 5
    const warmup = all.slice(0, WARMUP)
    const work = all.slice(WARMUP)
    expect(work.length, `${label}: no frames measured`).toBeGreaterThan(30)

    const mean = work.reduce((a, b) => a + b, 0) / work.length
    const p50 = percentile(work, 50)
    const p95 = percentile(work, 95)
    const p99 = percentile(work, 99)
    const worst = Math.max(...work)
    const overBudget = work.filter((w) => w > BUDGET_MS).length

    report.push(
      label,
      '-'.repeat(78),
      `  frames measured  ${work.length}`,
      `  mean             ${mean.toFixed(3)} ms`,
      `  p50              ${p50.toFixed(3)} ms`,
      `  p95              ${p95.toFixed(3)} ms`,
      `  p99              ${p99.toFixed(3)} ms`,
      `  worst            ${worst.toFixed(3)} ms`,
      `  over budget      ${overBudget} of ${work.length} ` +
        `(${((overBudget / work.length) * 100).toFixed(2)}%)`,
      `  warm-up dropped  ${WARMUP} frames: ${warmup.map((w) => w.toFixed(1)).join(', ')} ms` +
        '  (JIT and first paint)',
      '',
      histogram(work, [1, 2, 4, 8, BUDGET_MS]),
      '',
    )

    // The bar the phase sets: 60fps sustained. p99 inside budget is the honest reading of
    // "sustained" — one slow frame in a hundred is a blip, not a frame rate.
    expect(p99, `${label}: p99 frame work`).toBeLessThan(BUDGET_MS)
    expect(mean, `${label}: mean frame work`).toBeLessThan(BUDGET_MS / 3)
  }

  // The last lock loaded is the sidebar cylinder, which is what the budget was just measured on.
  // The guard is here because a perf test that silently measured a two-pin practice lock would
  // report wonderful numbers and prove nothing.
  const state = await getState(page)
  expect(state.chambers.length, 'the sidebar cylinder has six chambers').toBe(6)
  expect(
    state.chambers.filter((c) => c.sidebarGate !== null).length,
    'and three of them carry a gate — the machinery this is meant to be timing',
  ).toBe(3)

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  writeFileSync(path.join(SCREENSHOT_DIR, 'frame-histogram.txt'), `${report.join('\n')}\n`, 'utf8')
  watcher.assertClean()
})
