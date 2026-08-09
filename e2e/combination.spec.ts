/**
 * The second family, played in the live game — D-167, design in `docs/NEXT-MECHANICS.md §1`.
 *
 * The unit suites prove the sim delta (detents, sequential binding, the wrap) and the solver
 * decode; what only a browser can prove is the seams: that the keyboard's wheel verbs actually
 * reach the sim through `readFace` (the held-lift decay was written for springs, and a wheel
 * must park), and that an opened wheel lock banks through the same progress pipeline as a
 * cylinder. Layout on both new screens is the device sweep's job (`layout.spec.ts`).
 */

import { expect, test, type Page } from '@playwright/test'
import { advanceSeconds, bootGame, getState, loadLock, setManual } from './harness'
import { computePadlockLayout, wheelRect } from '../src/render/padlock'

const LUGGAGE = 39
const STRONGBOX = 41

test.use({ hasTouch: true })

/** Logical stage coordinates to client coordinates, mirroring the letterbox in `viewport.ts`. */
async function toClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([lx, ly]) => {
      const canvas = document.querySelector('canvas')
      if (!canvas) throw new Error('no canvas')
      const rect = canvas.getBoundingClientRect()
      const scale = Math.min(rect.width / 1920, rect.height / 1080)
      const offsetX = (rect.width - 1920 * scale) / 2
      const offsetY = (rect.height - 1080 * scale) / 2
      return { x: rect.left + offsetX + lx * scale, y: rect.top + offsetY + ly * scale }
    },
    [x, y] as [number, number],
  )
}

async function touch(
  page: Page,
  kind: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
  id = 1,
): Promise<void> {
  const c = await toClient(page, x, y)
  await page.evaluate(
    (args: { type: string; clientX: number; clientY: number; pointerId: number }) => {
      const canvas = document.querySelector('canvas')
      if (!canvas) throw new Error('no canvas')
      const target: EventTarget = args.type === 'pointerdown' ? canvas : window
      target.dispatchEvent(
        new PointerEvent(args.type, {
          pointerId: args.pointerId,
          pointerType: 'touch',
          clientX: args.clientX,
          clientY: args.clientY,
          bubbles: true,
          cancelable: true,
        }),
      )
    },
    { type: kind, clientX: c.x, clientY: c.y, pointerId: id },
  )
}

test('a wheel rolls under Space and parks where you leave it, on a digit', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await loadLock(page, LUGGAGE, 5)

  // Real keys and real frames: this is the `readFace` seam the scripted input road bypasses.
  // No shackle yet — rolling a wheel on an unpulled shackle is free and cannot capture.
  // A wheel STARTS parked on a digit since D-192, so movement is measured from there —
  // an absolute floor would pass without Space doing anything.
  const startAt = (await getState(page)).chambers[0]?.lift ?? 0
  const startOff = Math.abs(((startAt / 0.3) % 1) - 0.5)
  expect(startOff, `start lift ${startAt.toFixed(3)} sits off the digit grid`).toBeLessThan(0.05)
  await page.keyboard.down(' ')
  await page.waitForTimeout(450)
  await page.keyboard.up(' ')
  await page.waitForTimeout(150)
  const rolled = (await getState(page)).chambers[0]?.lift ?? 0
  expect(Math.abs(rolled - startAt), 'holding Space must roll the wheel').toBeGreaterThan(0.1)

  // The park. A wheel has no spring, and the keyboard's held-lift decay — correct for pins —
  // must never unwind a dial: half a second later the wheel is exactly where it was left.
  await page.waitForTimeout(600)
  const parked = (await getState(page)).chambers[0]?.lift ?? 0
  expect(parked, 'a released wheel must stay put').toBeCloseTo(rolled, 1)

  // And it is parked ON a digit — the detent claim, read through the live input road: a
  // centre sits at digit·0.3 + 0.15, so lift/0.3 lands half way between integers.
  const offCentre = Math.abs(((parked / 0.3) % 1) - 0.5)
  expect(offCentre, `lift ${parked.toFixed(3)} sits off the digit grid`).toBeLessThan(0.05)

  // The arrows click one detent per press — up, and down through the wrap (D-169).
  // +10 then %10: wrap-safe, and it launders Math.round's -0 (a park a hair under
  // digit 0's centre reads as -0, and toBe is Object.is — -0 !== 0 to it).
  const digitOf = (lift: number): number => (Math.round(lift / 0.3 - 0.5) + 10) % 10
  const before = digitOf(parked)
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(350)
  const upOnce = digitOf((await getState(page)).chambers[0]?.lift ?? 0)
  expect(upOnce).toBe((before + 1) % 10)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(350)
  const backDown = digitOf((await getState(page)).chambers[0]?.lift ?? 0)
  expect(backDown, 'a down-click undoes an up-click').toBe(before)
  watcher.assertClean()
})

test('a thumb rolls a wheel, it parks where the thumb leaves it, and a regrab continues', async ({
  page,
}) => {
  const watcher = await bootGame(page, { frames: 3 })
  await loadLock(page, LUGGAGE, 5)
  await setManual(page, true)

  // Wheel 1's face, straight from the padlock geometry the game draws with.
  const r = wheelRect(computePadlockLayout(3), 1)
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2

  // The dial is a circle and the wheel starts PARKED on a seed-dealt digit (D-192), so
  // every "did it move" reading is the signed short-way displacement — an absolute lift
  // floor lies the moment an upward roll wraps 9 across the seam to 0.
  const fwd = (from: number, to: number): number => {
    let d = (to - from) % 3.0
    if (d < -1.5) d += 3.0
    else if (d > 1.5) d -= 3.0
    return d
  }
  const start1 = (await getState(page)).chambers[1]?.lift ?? 0

  // Grab the wheel and drag up: the strip follows the thumb.
  await touch(page, 'pointerdown', cx, cy)
  await advanceSeconds(page, 0.1)
  await touch(page, 'pointermove', cx, cy - 60)
  await advanceSeconds(page, 0.2)
  await touch(page, 'pointermove', cx, cy - 120)
  await advanceSeconds(page, 0.3)
  await touch(page, 'pointerup', cx, cy - 120)
  await advanceSeconds(page, 0.3)

  const rolled = (await getState(page)).chambers[1]?.lift ?? 0
  expect(fwd(start1, rolled), 'the drag must roll the wheel upward').toBeGreaterThan(0.2)

  // The park: no spring, no decay — half a second later it has not moved.
  await advanceSeconds(page, 0.5)
  const parked = (await getState(page)).chambers[1]?.lift ?? 0
  expect(parked).toBeCloseTo(rolled, 1)

  // A second grab continues the dial from where it stands — the origin re-syncs to the
  // wheel's real angle, never to a stale command and never to zero.
  await touch(page, 'pointerdown', cx, cy)
  await advanceSeconds(page, 0.1)
  await touch(page, 'pointermove', cx, cy - 60)
  await advanceSeconds(page, 0.3)
  await touch(page, 'pointerup', cx, cy - 60)
  await advanceSeconds(page, 0.3)
  const regrabbed = (await getState(page)).chambers[1]?.lift ?? 0
  expect(fwd(parked, regrabbed), 'a regrab must continue upward, not restart').toBeGreaterThan(0.1)
  watcher.assertClean()
})

test('the decode banks like any other lock, from luggage to strongbox', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)

  // The easiest wheel lock: the real solver's tape, replayed through the live session, fires
  // the whole open pipeline — payoff, record, first blood.
  await loadLock(page, LUGGAGE, 7)
  expect(await page.evaluate(() => globalThis.__shearline!.solveCurrentLock())).toBe(true)
  await advanceSeconds(page, 6)
  const save = await page.evaluate(() => globalThis.__shearline!.getSave())
  const record = save.records['brasswell-3-wheel-luggage']
  expect(record?.opens, 'the open must bank a record').toBe(1)
  expect(record?.bestRank, 'and a rank').not.toBeNull()
  expect(save.achievements, 'a first open is First Blood, whatever the family').toContain(
    'first-blood',
  )

  // The hardest: twelve false gates on a 0.09 gate. If the solver survives this one in the
  // live game, the family's whole ladder is playable end to end.
  await loadLock(page, STRONGBOX, 3)
  expect(await page.evaluate(() => globalThis.__shearline!.solveCurrentLock())).toBe(true)
  const after = await getState(page)
  expect(after.opened).toBe(true)
  expect(after.stats.falseSetsEntered, 'the strongbox should have lied on the way').toBeGreaterThan(
    0,
  )
  watcher.assertClean()
})
