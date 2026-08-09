/**
 * The Lock dungeon, crawled in the live game — `docs/DUNGEON.md`.
 *
 * The unit suites prove the floor generator and the real-time machine; what only a browser
 * can prove is the seams: that the map screen drives the machine through the same actions
 * the keys and taps use, that bumping a locked chest lands on the real pick screen, and
 * that the solver's open pays back into the crawl.
 *
 * Real time is tamed for the drive (D-180): `dungeonFreeze(true)` cuts the frame loop's
 * wall-clock feed, and the walk advances the labyrinth by hand — one PLAYER_STEP_S per
 * stride, exactly the machine the Node dry-run walked. Same state machine, same policy,
 * same seed, same clock: the dry-run's survival IS the browser's.
 */

import { expect, test, type Page } from '@playwright/test'
import { generateFloor, type DungeonFloor } from '../src/game/dungeon'
import { PLAYER_STEP_S, advance, movePlayer, pickOpened, startDungeon } from '../src/game/dungeonRun'
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
  time: number
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

/** Start a frozen, hand-clocked run — the only kind a deterministic drive can vouch for. */
async function startFrozen(
  page: Page,
  seed: number,
  difficulty: 'training' | 'easy' | 'medium' | 'hard',
): Promise<void> {
  await page.evaluate(
    ({ s, d }) => {
      const h = globalThis.__shearline!
      h.startDungeonRun(s, d)
      h.dungeonFreeze(true)
    },
    { s: seed, d: difficulty },
  )
}

/**
 * The walker's whole brain, ONE definition for Node and browser alike: head for each
 * waypoint axis-first; a guard in the next cell means stand and let its stride pass, else
 * step — and every try, stepped or stood, hands the clock one player stride. Nobody dies
 * here, so the only tactics are patience and route.
 */
function policyStep(
  s: { x: number; y: number },
  tx: number,
  ty: number,
): { dx: number; dy: number; nx: number; ny: number } {
  const dx = Math.sign(tx - s.x)
  const dy = Math.sign(ty - s.y)
  const mx = dx !== 0 ? dx : 0
  const my = dx !== 0 ? 0 : dy
  return { dx: mx, dy: my, nx: s.x + mx, ny: s.y + my }
}

/** The dry-run: the policy through the real machine in Node. True = arrived, still crawling. */
function dryWalk(run: ReturnType<typeof startDungeon>, steps: [number, number][]): boolean {
  for (const [tx, ty] of steps) {
    for (let tries = 0; tries < 16; tries += 1) {
      if (run.phase !== 'crawl') return false
      if (run.player.x === tx && run.player.y === ty) break
      const m = policyStep(run.player, tx, ty)
      if (!run.enemies.some((e) => e.x === m.nx && e.y === m.ny)) movePlayer(run, m.dx, m.dy)
      advance(run, PLAYER_STEP_S)
    }
  }
  return run.phase === 'crawl'
}

/** The same walk, driven through the live hooks — a mirror, not a sibling. */
async function browserWalk(page: Page, steps: [number, number][]): Promise<string> {
  return page.evaluate(
    ({ steps: sts, stride }) => {
      const h = globalThis.__shearline!
      for (const [tx, ty] of sts) {
        for (let tries = 0; tries < 16; tries += 1) {
          const s = h.dungeonState()
          if (!s || s.phase !== 'crawl') return s?.phase ?? 'gone'
          if (s.x === tx && s.y === ty) break
          const dx = Math.sign(tx - s.x)
          const dy = Math.sign(ty - s.y)
          const mx = dx !== 0 ? dx : 0
          const my = dx !== 0 ? 0 : dy
          if (!s.enemies.some((e) => e.x === s.x + mx && e.y === s.y + my)) h.dungeonMove(mx, my)
          h.dungeonAdvance(stride)
        }
      }
      return 'beside'
    },
    { steps, stride: PLAYER_STEP_S },
  )
}

test('the crawl runs through the live screen: moves, clock, fog, audit', async ({ page }) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await startFrozen(page, SEED, 'easy')

  const start = await dState(page)
  expect(start?.phase).toBe('crawl')
  expect(start?.picks, "the one hero's kit").toBe(2)
  expect(start?.keys).toBe(0)

  // A few real strides: the clock runs, position changes, nothing crashes.
  await page.evaluate((stride) => {
    const h = globalThis.__shearline!
    h.dungeonMove(1, 0)
    h.dungeonAdvance(stride)
    h.dungeonMove(0, 1)
    h.dungeonAdvance(stride)
    h.dungeonMove(1, 0)
    h.dungeonAdvance(stride)
  }, PLAYER_STEP_S)
  const later = await dState(page)
  expect(later?.time ?? 0).toBeGreaterThan(0)
  expect([later?.x, later?.y]).not.toEqual([start?.x, start?.y])

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
  // Guards patrol from second zero, so the walk to the first lock is hunted per seed: dry-run
  // the exact policy through the real machine, and only drive the browser down a route
  // already proven to kneel unseen.
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
    if (!dryWalk(dry, p)) continue
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
  await startFrozen(page, seed, 'easy')

  const walked = await browserWalk(page, path as [number, number][])
  expect(walked).toBe('beside')
  const found = await page.evaluate(
    (aim) => {
      const h = globalThis.__shearline!
      const s = h.dungeonState()
      if (!s) return null
      h.dungeonMove(Math.sign(aim.x - s.x), Math.sign(aim.y - s.y))
      return h.dungeonState()?.picking ?? null
    },
    target as { x: number; y: number },
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
  // routing home is the point. Frozen, the clock only moves by the strides we fed it.
  expect(after?.time ?? 0).toBeGreaterThanOrEqual(before?.time ?? 0)
  watcher.assertClean()
})

test('the GATE ends the run: pick through its door, kneel at it, and the score banks', async ({
  page,
}) => {
  test.slow()
  // The exit is GUARANTEED behind at least one locked door now (D-180) — a door-free walk
  // to the gate no longer exists on any seed, so the plan is legged: walk to each barring
  // door on the route, kneel, solve, walk on; the gate last. The dry-run walks the whole
  // plan through the real machine — doors opened with the machine's own pickOpened, which
  // is exactly what the browser's solver open does — and the browser only walks proven
  // ground. Survival still does the winnowing: a leg that meets a cone fails the probe.
  const planLegs = (
    f: DungeonFloor,
  ): { legs: [number, number][][]; doors: { x: number; y: number }[] } | null => {
    // Route with locked doors PASSABLE — the legs split at each door crossed.
    const chestCells = new Set(f.chests.map((c) => `${c.x},${c.y}`))
    chestCells.add(`${f.gate.x},${f.gate.y}`)
    const doorCells = new Map(f.doors.map((d) => [`${d.x},${d.y}`, { x: d.x, y: d.y }]))
    const prev = new Map<string, string>()
    const from: [number, number] = [f.start.x, f.start.y]
    const queue: [number, number][] = [from]
    const seen = new Set([`${from[0]},${from[1]}`])
    let goalKey: string | null = null
    while (queue.length > 0 && !goalKey) {
      const [x, y] = queue.shift() as [number, number]
      if (Math.abs(x - f.gate.x) + Math.abs(y - f.gate.y) === 1) {
        goalKey = `${x},${y}`
        break
      }
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const k = `${x + dx},${y + dy}`
        if (seen.has(k) || !(f.walk[y + dy]?.[x + dx] ?? false) || chestCells.has(k)) continue
        seen.add(k)
        prev.set(k, `${x},${y}`)
        queue.push([x + dx, y + dy])
      }
    }
    if (!goalKey) return null
    const cells: [number, number][] = []
    let k = goalKey
    while (k !== `${from[0]},${from[1]}`) {
      const [px, py] = k.split(',').map(Number) as [number, number]
      cells.unshift([px, py])
      k = prev.get(k) as string
    }
    const legs: [number, number][][] = []
    const doors: { x: number; y: number }[] = []
    let leg: [number, number][] = []
    for (const cell of cells) {
      const dc = doorCells.get(`${cell[0]},${cell[1]}`)
      if (dc) {
        legs.push(leg)
        doors.push(dc)
        // The next leg begins by stepping onto the now-open door cell itself.
        leg = [cell]
      } else {
        leg.push(cell)
      }
    }
    legs.push(leg)
    return { legs, doors }
  }
  const dryPlan = (
    s0: number,
    plan: { legs: [number, number][][]; doors: { x: number; y: number }[] },
    gate: { x: number; y: number },
  ): boolean => {
    const run = startDungeon((s0 >>> 0) || 1)
    for (let i = 0; i < plan.legs.length; i += 1) {
      if (!dryWalk(run, plan.legs[i] as [number, number][])) return false
      const door = plan.doors[i]
      if (door) {
        movePlayer(run, Math.sign(door.x - run.player.x), Math.sign(door.y - run.player.y))
        const ph: string = run.phase
        if (ph !== 'picking' || run.picking?.kind !== 'door') return false
        // The machine's own open — the browser's solver lands on this exact call.
        pickOpened(run)
        advance(run, PLAYER_STEP_S)
        if ((run.phase as string) !== 'crawl') return false
      }
    }
    movePlayer(run, Math.sign(gate.x - run.player.x), Math.sign(gate.y - run.player.y))
    const ph: string = run.phase
    return ph === 'picking' && run.picking?.kind === 'gate'
  }
  let seed = SEED
  let plan: { legs: [number, number][][]; doors: { x: number; y: number }[] } | null = null
  let floor = generateFloor(seed)
  for (let probe = 0; probe < 400; probe += 1) {
    floor = generateFloor(SEED + probe)
    const p = planLegs(floor)
    if (p && dryPlan(SEED + probe, p, floor.gate)) {
      seed = SEED + probe
      plan = p
      break
    }
  }
  expect(plan, 'some nearby seed must offer a survivable, pickable road to the gate').not.toBeNull()
  const legs = (plan as { legs: [number, number][][] }).legs
  const doors = (plan as { doors: { x: number; y: number }[] }).doors

  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)
  await startFrozen(page, seed, 'medium')

  for (let i = 0; i < legs.length; i += 1) {
    const walked = await browserWalk(page, legs[i] as [number, number][])
    expect(walked, `leg ${i} must end still crawling`).toBe('beside')
    const door = doors[i]
    if (!door) continue
    const kneel = await page.evaluate(
      (aim) => {
        const h = globalThis.__shearline!
        const s = h.dungeonState()
        if (!s) return 'gone'
        h.dungeonMove(Math.sign(aim.x - s.x), Math.sign(aim.y - s.y))
        return h.dungeonState()?.picking?.kind ?? 'no-kneel'
      },
      door,
    )
    expect(kneel, `leg ${i} must end kneeling at its door`).toBe('door')
    expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('pick')
    const doorOpened = await page.evaluate(() => globalThis.__shearline!.solveCurrentLock())
    expect(doorOpened, `door ${i} must be openable in the live game`).toBe(true)
    await advanceSeconds(page, 0.5)
    expect(await page.evaluate(() => globalThis.__shearline!.getScreen())).toBe('gauntlet')
    // Mirror the dry-run's post-open stride so the clocks stay in lockstep.
    await page.evaluate((stride) => globalThis.__shearline!.dungeonAdvance(stride), PLAYER_STEP_S)
  }

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
