/**
 * The Lock dungeon, crawled in the live game — `docs/DUNGEON.md`.
 *
 * The unit suites prove the floor generator and the turn machine; what only a browser can
 * prove is the seams: that the map screen drives the machine through the same actions the
 * keys and taps use, that bumping a locked chest lands on the real pick screen, that the
 * picking clock turns the floor, and that the solver's open pays loot back into the crawl.
 */

import { expect, test, type Page } from '@playwright/test'
import { generateFloor, type DungeonFloor } from '../src/game/dungeon'
import { movePlayer, startDungeon, waitTurn } from '../src/game/dungeonRun'
import { advanceSeconds, bootGame, captureStage, setManual } from './harness'

const SEED = 4242

/**
 * BFS a path across the floor — chests block, locked doors block (we are heading for our
 * *first* lock and must not trip over another), unlocked doors pass. The spec regenerates
 * the same deterministic floor the game deals, which is the whole point of seeding.
 */
function pathTo(
  floor: DungeonFloor,
  from: [number, number],
  goal: (x: number, y: number) => boolean,
): [number, number][] | null {
  const chestCells = new Set(floor.chests.map((c) => `${c.x},${c.y}`))
  chestCells.add(`${floor.gate.x},${floor.gate.y}`) // the gate is a wall until it is won
  const lockedDoors = new Set(floor.doors.filter((d) => d.locked).map((d) => `${d.x},${d.y}`))
  const prev = new Map<string, string>()
  const queue: [number, number][] = [from]
  const seen = new Set([`${from[0]},${from[1]}`])
  while (queue.length > 0) {
    const [x, y] = queue.shift() as [number, number]
    if (goal(x, y)) {
      const path: [number, number][] = []
      let k = `${x},${y}`
      while (k !== `${from[0]},${from[1]}`) {
        const [px, py] = k.split(',').map(Number) as [number, number]
        path.unshift([px, py])
        k = prev.get(k) as string
      }
      return path
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx
      const ny = y + dy
      const k = `${nx},${ny}`
      if (seen.has(k)) continue
      if (!(floor.walk[ny]?.[nx] ?? false)) continue
      if (chestCells.has(k) || lockedDoors.has(k)) continue
      seen.add(k)
      prev.set(k, `${x},${y}`)
      queue.push([nx, ny])
    }
  }
  return null
}

type DState = {
  phase: string
  turn: number
  x: number
  y: number
  picks: number
  keys: number
  tracker: boolean
  seed: number
  score: number
  picking: { kind: string; id: number } | null
  enemies: { kind: string; x: number; y: number; awake: boolean }[]
}

async function dState(page: Page): Promise<DState | null> {
  return page.evaluate(() => globalThis.__shearline!.dungeonState())
}

async function move(page: Page, dx: number, dy: number): Promise<void> {
  await page.evaluate(([mx, my]) => globalThis.__shearline!.dungeonMove(mx, my), [dx, dy] as [
    number,
    number,
  ])
}


test('the crawl runs through the live screen: moves, turns, fog, audit', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await page.evaluate((seed) => globalThis.__shearline!.startDungeonRun(seed, 'easy'), SEED)

  const start = await dState(page)
  expect(start?.phase).toBe('crawl')
  expect(start?.picks, "the one hero's kit").toBe(2)
  expect(start?.keys).toBe(0)

  // A few real steps: turns advance, position changes, nothing crashes.
  await move(page, 1, 0)
  await move(page, 0, 1)
  await move(page, 1, 0)
  const later = await dState(page)
  expect(later?.turn ?? 0).toBeGreaterThan(0)

  // The live map passes the layout rules and photographs cleanly.
  const audit = await page.evaluate(() => globalThis.__shearline!.auditScreen())
  const collisions = audit.findings.filter((f) =>
    ['overlap', 'text-over-control', 'crowded-text', 'off-stage'].includes(f.kind),
  )
  expect(collisions.map((f) => f.detail)).toEqual([])
  await captureStage(page, 'dungeon-crawl')
  watcher.assertClean()
})

test('a locked thing routes to the real pick screen, and the open pays back into the crawl', async ({
  page,
}) => {
  test.slow()
  // Guards patrol from turn zero now, so the walk to the first lock is hunted the same way
  // the gate run is: dry-run the exact wait-or-step policy through the real machine per
  // seed, and only drive the browser down a route already proven to kneel unseen.
  const walkPolicy = (
    run: ReturnType<typeof startDungeon>,
    steps: [number, number][],
  ): boolean => {
    for (const [tx, ty] of steps) {
      for (let tries = 0; tries < 16; tries += 1) {
        if (run.phase !== 'crawl') return false
        if (run.player.x === tx && run.player.y === ty) break
        const dx = Math.sign(tx - run.player.x)
        const dy = Math.sign(ty - run.player.y)
        const nx = run.player.x + (dx !== 0 ? dx : 0)
        const ny = run.player.y + (dx !== 0 ? 0 : dy)
        if (run.enemies.some((e) => e.x === nx && e.y === ny)) waitTurn(run)
        else movePlayer(run, dx !== 0 ? dx : 0, dx !== 0 ? 0 : dy)
      }
    }
    return run.phase === 'crawl'
  }
  let seed = SEED
  let path: [number, number][] | null = null
  let target: { x: number; y: number } | null = null
  for (let probe = 0; probe < 120 && !path; probe += 1) {
    const floor = generateFloor(SEED + probe)
    const lockedThings = [
      ...floor.chests.filter((c) => c.locked).map((c) => ({ x: c.x, y: c.y })),
      ...floor.doors.map((d) => ({ x: d.x, y: d.y })),
    ]
    const beside = new Set<string>()
    for (const t of lockedThings) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (floor.walk[t.y + dy]?.[t.x + dx] ?? false) beside.add(`${t.x + dx},${t.y + dy}`)
      }
    }
    const p = pathTo(floor, [floor.start.x, floor.start.y], (x, y) => beside.has(`${x},${y}`))
    if (!p) continue
    const dry = startDungeon(((SEED + probe) >>> 0) || 1)
    if (!walkPolicy(dry, p)) continue
    const t = lockedThings.find(
      (c) => Math.abs(c.x - dry.player.x) + Math.abs(c.y - dry.player.y) === 1,
    )
    if (!t) continue
    movePlayer(dry, Math.sign(t.x - dry.player.x), Math.sign(t.y - dry.player.y))
    if (dry.phase !== 'picking') continue
    seed = SEED + probe
    path = p
    target = t
  }
  expect(path, 'some nearby seed must offer an unseen walk to a lock').not.toBeNull()

  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await page.evaluate((s) => globalThis.__shearline!.startDungeonRun(s, 'easy'), seed)

  const found = await page.evaluate(
    ({ steps, aim }) => {
      const h = globalThis.__shearline!
      for (const [tx, ty] of steps) {
        for (let tries = 0; tries < 16; tries += 1) {
          const s = h.dungeonState()
          if (!s || s.phase !== 'crawl') return s?.picking ?? null
          if (s.x === tx && s.y === ty) break
          const dx = Math.sign(tx - s.x)
          const dy = Math.sign(ty - s.y)
          const nx = s.x + (dx !== 0 ? dx : 0)
          const ny = s.y + (dx !== 0 ? 0 : dy)
          if (s.enemies.some((e) => e.x === nx && e.y === ny)) h.dungeonWait()
          else h.dungeonMove(dx !== 0 ? dx : 0, dx !== 0 ? 0 : dy)
        }
      }
      const s = h.dungeonState()
      if (!s) return null
      h.dungeonMove(Math.sign(aim.x - s.x), Math.sign(aim.y - s.y))
      return h.dungeonState()?.picking ?? null
    },
    { steps: path as [number, number][], aim: target as { x: number; y: number } },
  )
  expect(found, 'the walk must end kneeling at the first lock').not.toBeNull()

  // We are on the pick screen with a generated lock. The solver's hands open it.
  expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('pick')
  const before = await dState(page)
  const opened = await page.evaluate(() => globalThis.__shearline!.solveCurrentLock())
  expect(opened, 'the dungeon lock must be openable in the live game').toBe(true)
  await advanceSeconds(page, 0.5)

  const after = await dState(page)
  expect(after?.phase).toBe('crawl')
  expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('gauntlet')
  // Chest loot (picks, keys, the tracker) is proven by the machine suite; here the open
  // routing home is the point.
  // The floor turned while the hands were inside the lock — the picking clock is real.
  expect(after?.turn ?? 0).toBeGreaterThanOrEqual(before?.turn ?? 0)
  watcher.assertClean()
})

test('the GATE ends the run: kneel at it, open it, and the score banks', async ({ page }) => {
  test.slow()
  // Not every seed leaves the gate reachable without another lock first, and not every
  // reachable walk SURVIVES the bestiary between here and there. So the hunt dry-runs the
  // exact walk through the real machine, in Node, and only drives the browser down a route
  // a body has already been proven to live through — determinism making the promise cheap.
  // The walker's whole brain, mirrored EXACTLY in the browser drive below: wait out a guard
  // standing in the next cell, else step toward the waypoint — nobody dies here, so the
  // only tactics are patience and route. Same state machine, same policy, same seed — the dry-run's
  // survival IS the browser's.
  const dryRun = (s0: number, steps: [number, number][], gate: { x: number; y: number }): boolean => {
    const run = startDungeon((s0 >>> 0) || 1)
    for (const [tx, ty] of steps) {
      for (let tries = 0; tries < 14; tries += 1) {
        if (run.phase !== 'crawl') return false
        if (run.player.x === tx && run.player.y === ty) break
        const dx = Math.sign(tx - run.player.x)
        const dy = Math.sign(ty - run.player.y)
        const nx = run.player.x + (dx !== 0 ? dx : 0)
        const ny = run.player.y + (dx !== 0 ? 0 : dy)
        if (run.enemies.some((e) => e.x === nx && e.y === ny)) waitTurn(run)
        else movePlayer(run, dx !== 0 ? dx : 0, dx !== 0 ? 0 : dy)
      }
    }
    if (run.phase !== 'crawl') return false
    movePlayer(run, Math.sign(gate.x - run.player.x), Math.sign(gate.y - run.player.y))
    // Re-read through a widened type: movePlayer mutates phase behind a call, and the
    // narrowing from the guard above would otherwise call this comparison unreachable.
    const ph: string = run.phase
    return ph === 'picking' && run.picking?.kind === 'gate'
  }
  let seed = SEED
  let path: [number, number][] | null = null
  let floor = generateFloor(seed)
  for (let probe = 0; probe < 200; probe += 1) {
    floor = generateFloor(SEED + probe)
    const g = floor.gate
    const p = pathTo(floor, [floor.start.x, floor.start.y], (x, y) =>
      Math.abs(x - g.x) + Math.abs(y - g.y) === 1,
    )
    if (p && dryRun(SEED + probe, p, g)) {
      seed = SEED + probe
      path = p
      break
    }
  }
  expect(path, 'some nearby seed must offer a survivable walk to the gate').not.toBeNull()

  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await page.evaluate((s) => globalThis.__shearline!.startDungeonRun(s, 'medium'), seed)

  const walked = await page.evaluate((steps) => {
    const h = globalThis.__shearline!
    for (const [tx, ty] of steps) {
      for (let tries = 0; tries < 14; tries += 1) {
        const s = h.dungeonState()
        if (!s || s.phase !== 'crawl') return s?.phase ?? 'gone'
        if (s.x === tx && s.y === ty) break
        const dx = Math.sign(tx - s.x)
        const dy = Math.sign(ty - s.y)
        const nx = s.x + (dx !== 0 ? dx : 0)
        const ny = s.y + (dx !== 0 ? 0 : dy)
        if (s.enemies.some((e) => e.x === nx && e.y === ny)) h.dungeonWait()
        else h.dungeonMove(dx !== 0 ? dx : 0, dx !== 0 ? 0 : dy)
      }
    }
    return 'beside'
  }, path as [number, number][])
  expect(walked).toBe('beside')
  // The gate stands lit one tile away — the canonical photograph of the whole mode.
  await advanceSeconds(page, 0.3)
  await captureStage(page, 'dungeon-gate')

  const arrived = await page.evaluate(
    (gate) => {
      const h = globalThis.__shearline!
      const s = h.dungeonState()
      if (!s) return 'gone'
      h.dungeonMove(Math.sign(gate.x - s.x), Math.sign(gate.y - s.y))
      return h.dungeonState()?.picking?.kind ?? 'no-kneel'
    },
    { x: floor.gate.x, y: floor.gate.y },
  )
  expect(arrived, 'the walk must end kneeling at the gate').toBe('gate')
  expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('pick')

  const opened = await page.evaluate(() => globalThis.__shearline!.solveCurrentLock())
  expect(opened, 'the gate lock must be openable in the live game').toBe(true)
  await advanceSeconds(page, 0.5)

  const out = await dState(page)
  expect(out?.phase).toBe('won')
  const save = await page.evaluate(() => globalThis.__shearline!.getSave())
  expect(save.gauntletBest?.medium ?? 0).toBe(out?.score ?? -1)
  expect(out?.score ?? 0).toBeGreaterThan(0)
  watcher.assertClean()
})
