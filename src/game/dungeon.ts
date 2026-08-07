/**
 * The labyrinth generator — `docs/DUNGEON.md`, the prison the Lock dungeon became (D-177).
 *
 * This module is the *architect* and nothing else: given a seed it draws one labyrinth —
 * a braided maze of one-tile halls, a handful of 3×3 chambers, locked doors barring
 * passages, chests holding the few artifacts the mode owns (spare picks, skeleton keys,
 * the motion tracker), patrolling guards with their beats, and THE GATE on the far border:
 * the exit, and the whole point. Everything is dealt from one rng stream, so the same seed
 * always builds the same labyrinth, byte for byte — the property every proof stands on.
 *
 * The world it hands over is *data at rest*: nothing here moves, chases, or opens. That is
 * `dungeonRun.ts`, the pure turn machine. The locks are not built here either — a door
 * carries a tier and a wheel flag, and `generateDungeonLock` builds the actual `LockDef`
 * from the same legal space every dungeon lock has come from since D-165.
 *
 * Fairness floors, deliberately few:
 * - the gate's kneeling side is reachable treating locked doors as pickable — no floor can
 *   deal an escape that keys and picks cannot reach;
 * - the artifacts exist on every floor: two spare picks, two skeleton keys, one motion
 *   tracker, spread across the chambers' chests;
 * - no guard spawns within ten tiles of the start — the first minute belongs to you.
 */

import { createRng, nextInt, shuffle } from '../sim'

export const DUNGEON_W = 44
export const DUNGEON_H = 24
/** Maze lattice: cell centres on odd tiles — 21 columns, 11 rows of cells. */
const MAZE_COLS = 21
const MAZE_ROWS = 11

export interface DungeonDoorDef {
  readonly id: number
  readonly x: number
  readonly y: number
  /** Maze doors are always locked — an unlocked door would just be corridor. */
  readonly locked: true
  readonly lockTier: 1 | 2 | 3 | 4
  readonly wheel: boolean
}

/** What a chest can hold — the mode's whole economy since D-177. */
export type DungeonItem = 'pick' | 'skeleton-key' | 'tracker' | null

export interface ChestLoot {
  readonly item: DungeonItem
}

export interface DungeonChestDef {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly locked: boolean
  readonly lockTier: 1 | 2 | 3 | 4
  readonly wheel: boolean
  readonly loot: ChestLoot
  /** Which of the chest drawings this one wears — pure carpentry, no gameplay. */
  readonly style: 0 | 1 | 2
}

/** Decorative furniture — drawn, never collided with. The floor stays walkable under it. */
export type DungeonPropKind =
  | 'torch'
  | 'grass'
  | 'rubble'
  | 'bones'
  | 'web'
  | 'puddle'
  | 'crack'
  | 'mushroom'
  | 'candle'
  | 'chain'

export interface DungeonPropDef {
  readonly kind: DungeonPropKind
  readonly x: number
  readonly y: number
  /** For torches and webs: which neighbouring wall they hang from. */
  readonly side: 'n' | 'e' | 's' | 'w'
}

/** The three kinds of guard — different speed, sight and beat (D-177). Nobody dies here. */
export type EnemyKind = 'warden' | 'hound' | 'sentry'

export interface DungeonEnemyDef {
  readonly id: number
  readonly kind: EnemyKind
  readonly x: number
  readonly y: number
  /** The beat this guard walks while nothing has alerted it. */
  readonly patrol: readonly { readonly x: number; readonly y: number }[]
}

export interface DungeonFloor {
  readonly seed: number
  readonly w: number
  readonly h: number
  /** walk[y][x] — true where a body can stand (halls, chambers, the notches). */
  readonly walk: readonly (readonly boolean[])[]
  /** The 3×3 chambers, for tests and furniture placement. */
  readonly chambers: readonly { readonly x: number; readonly y: number }[]
  readonly doors: readonly DungeonDoorDef[]
  readonly chests: readonly DungeonChestDef[]
  readonly enemies: readonly DungeonEnemyDef[]
  readonly props: readonly DungeonPropDef[]
  /** The way OUT: the exit gate on the far border, the hardest lock they own. */
  readonly gate: {
    readonly x: number
    readonly y: number
    readonly lockTier: 4
    readonly wheel: boolean
  }
  /** The way you were brought in — barred now. Ordinary floor, drawn as jail bars. */
  readonly entrance: { readonly x: number; readonly y: number }
  /** Where you stand on turn zero. */
  readonly start: { readonly x: number; readonly y: number }
}

const cellTile = (cx: number, cy: number): { x: number; y: number } => ({
  x: 1 + cx * 2,
  y: 1 + cy * 2,
})

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** One labyrinth, deterministically, from one seed. */
export function generateFloor(seed: number): DungeonFloor {
  const rng = createRng(((seed ^ 0xd0e0) >>> 0) || 1)

  const walk: boolean[][] = Array.from({ length: DUNGEON_H }, () =>
    Array.from({ length: DUNGEON_W }, () => false),
  )
  const carve = (x: number, y: number): void => {
    if (x >= 0 && x < DUNGEON_W && y >= 0 && y < DUNGEON_H) (walk[y] as boolean[])[x] = true
  }
  const isWalk = (x: number, y: number): boolean => walk[y]?.[x] ?? false

  // ── The maze: recursive backtracker over the cell lattice ─────────────────────────────
  const visited: boolean[][] = Array.from({ length: MAZE_ROWS }, () =>
    Array.from({ length: MAZE_COLS }, () => false),
  )
  {
    const stack: [number, number][] = [[0, 0]]
    ;(visited[0] as boolean[])[0] = true
    carve(1, 1)
    while (stack.length > 0) {
      const [cx, cy] = stack[stack.length - 1] as [number, number]
      const options = shuffle(
        rng,
        (
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const
        ).filter(([dx, dy]) => {
          const nx = cx + dx
          const ny = cy + dy
          return nx >= 0 && nx < MAZE_COLS && ny >= 0 && ny < MAZE_ROWS && !visited[ny]?.[nx]
        }),
      )
      const step = options[0]
      if (!step) {
        stack.pop()
        continue
      }
      const [dx, dy] = step
      const nx = cx + dx
      const ny = cy + dy
      ;(visited[ny] as boolean[])[nx] = true
      const a = cellTile(cx, cy)
      const b = cellTile(nx, ny)
      carve(b.x, b.y)
      carve((a.x + b.x) / 2, (a.y + b.y) / 2) // knock the wall between
      stack.push([nx, ny])
    }
  }

  // ── Braiding: open some dead ends into loops ──────────────────────────────────────────
  // A perfect maze is a tree, and a tree has no way around a guard. Loops are what make
  // "run — break its line of sight" a real verb rather than advice.
  for (let cy = 0; cy < MAZE_ROWS; cy += 1) {
    for (let cx = 0; cx < MAZE_COLS; cx += 1) {
      const t = cellTile(cx, cy)
      const open = (
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const
      ).filter(([dx, dy]) => isWalk(t.x + dx, t.y + dy))
      if (open.length !== 1 || nextInt(rng, 3) === 0) continue
      const closed = shuffle(
        rng,
        (
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const
        ).filter(([dx, dy]) => {
          const nx = cx + dx
          const ny = cy + dy
          return (
            nx >= 0 &&
            nx < MAZE_COLS &&
            ny >= 0 &&
            ny < MAZE_ROWS &&
            !isWalk(t.x + dx, t.y + dy)
          )
        }),
      )
      const pick = closed[0]
      if (pick) carve(t.x + pick[0], t.y + pick[1])
    }
  }

  // ── Chambers: five 3×3 rooms melted into the maze — artifact sites ────────────────────
  const chambers: { x: number; y: number }[] = []
  for (let attempt = 0; attempt < 60 && chambers.length < 5; attempt += 1) {
    const cx = 2 + nextInt(rng, MAZE_COLS - 4)
    const cy = 1 + nextInt(rng, MAZE_ROWS - 2)
    const t = cellTile(cx, cy)
    if (Math.abs(t.x - 1) + Math.abs(t.y - 1) < 8) continue // not on the start
    if (chambers.some((c) => Math.abs(c.x - t.x) < 8 && Math.abs(c.y - t.y) < 8)) continue
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) carve(t.x + dx, t.y + dy)
    }
    chambers.push({ x: t.x, y: t.y })
  }

  // ── Start and the barred way in ───────────────────────────────────────────────────────
  const start = { x: 1, y: 1 }
  const entrance = { x: 0, y: 1 }
  carve(entrance.x, entrance.y)

  // ── Distances from the start, for everything placed "far" ─────────────────────────────
  const dist: number[][] = Array.from({ length: DUNGEON_H }, () =>
    Array.from({ length: DUNGEON_W }, () => -1),
  )
  {
    const q: [number, number][] = [[start.x, start.y]]
    ;(dist[start.y] as number[])[start.x] = 0
    while (q.length > 0) {
      const [x, y] = q.shift() as [number, number]
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (!isWalk(nx, ny) || (dist[ny]?.[nx] ?? -1) >= 0) continue
        ;(dist[ny] as number[])[nx] = (dist[y]?.[x] ?? 0) + 1
        q.push([nx, ny])
      }
    }
  }
  const distAt = (x: number, y: number): number => dist[y]?.[x] ?? -1

  // ── THE GATE: on the border, beside the farthest reachable edge tile ──────────────────
  let gateInside = { x: DUNGEON_W - 2, y: DUNGEON_H - 2 }
  let bestD = -1
  for (let y = 1; y < DUNGEON_H - 1; y += 1) {
    for (let x = 1; x < DUNGEON_W - 1; x += 1) {
      if (!isWalk(x, y) || distAt(x, y) < 0) continue
      const onEdge = x === 1 || x === DUNGEON_W - 2 || y === 1 || y === DUNGEON_H - 2
      if (!onEdge) continue
      if (distAt(x, y) > bestD) {
        bestD = distAt(x, y)
        gateInside = { x, y }
      }
    }
  }
  const gatePos =
    gateInside.x === DUNGEON_W - 2
      ? { x: DUNGEON_W - 1, y: gateInside.y }
      : gateInside.x === 1
        ? { x: 0, y: gateInside.y }
        : gateInside.y === DUNGEON_H - 2
          ? { x: gateInside.x, y: DUNGEON_H - 1 }
          : { x: gateInside.x, y: 0 }
  const gate = {
    x: gatePos.x,
    y: gatePos.y,
    lockTier: 4 as const,
    wheel: nextInt(rng, 2) === 0,
  }
  carve(gate.x, gate.y)

  // ── Reserved ground ───────────────────────────────────────────────────────────────────
  const taken = new Set<string>()
  const key = (x: number, y: number): string => `${x},${y}`
  taken.add(key(start.x, start.y))
  taken.add(key(entrance.x, entrance.y))
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) taken.add(key(gate.x + dx, gate.y + dy))
  }

  // ── Locked doors barring straight halls ───────────────────────────────────────────────
  const doors: Mutable<DungeonDoorDef>[] = []
  {
    const candidates: { x: number; y: number }[] = []
    for (let y = 1; y < DUNGEON_H - 1; y += 1) {
      for (let x = 1; x < DUNGEON_W - 1; x += 1) {
        if (!isWalk(x, y) || taken.has(key(x, y))) continue
        if (chambers.some((c) => Math.abs(c.x - x) <= 2 && Math.abs(c.y - y) <= 2)) continue
        const h = isWalk(x - 1, y) && isWalk(x + 1, y) && !isWalk(x, y - 1) && !isWalk(x, y + 1)
        const v = isWalk(x, y - 1) && isWalk(x, y + 1) && !isWalk(x - 1, y) && !isWalk(x + 1, y)
        if ((h || v) && distAt(x, y) >= 6) candidates.push({ x, y })
      }
    }
    const maxD = Math.max(1, bestD)
    const want = 5 + nextInt(rng, 3)
    for (const c of shuffle(rng, candidates)) {
      if (doors.length >= want) break
      if (doors.some((d) => Math.abs(d.x - c.x) + Math.abs(d.y - c.y) < 5)) continue
      const frac = distAt(c.x, c.y) / maxD
      const base = frac < 0.34 ? 1 : frac < 0.67 ? 2 : 3
      const tier = (base + (nextInt(rng, 4) === 0 ? 1 : 0)) as 1 | 2 | 3 | 4
      doors.push({
        id: doors.length,
        x: c.x,
        y: c.y,
        locked: true,
        lockTier: tier > 4 ? 4 : tier,
        wheel: tier >= 2 && nextInt(rng, 3) === 0,
      })
      taken.add(key(c.x, c.y))
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        taken.add(key(c.x + dx, c.y + dy))
      }
    }
  }

  // ── Chests in the chambers: the artifacts live here ───────────────────────────────────
  // One per chamber, at its centre. The guaranteed spread: one motion tracker, two
  // skeleton keys, two spare picks — the fairness floor the whole mode leans on.
  const GUARANTEED: DungeonItem[] = ['tracker', 'skeleton-key', 'skeleton-key', 'pick', 'pick']
  const chests: Mutable<DungeonChestDef>[] = []
  const maxD = Math.max(1, bestD)
  shuffle(rng, chambers.slice()).forEach((c, i) => {
    const frac = distAt(c.x, c.y) / maxD
    const base = frac < 0.34 ? 1 : frac < 0.67 ? 2 : 3
    const locked = nextInt(rng, 3) > 0
    chests.push({
      id: chests.length,
      x: c.x,
      y: c.y,
      locked,
      lockTier: locked ? (base) : 1,
      wheel: locked && base >= 2 && nextInt(rng, 3) === 0,
      loot: { item: GUARANTEED[i] ?? null },
      style: nextInt(rng, 3) as 0 | 1 | 2,
    })
    taken.add(key(c.x, c.y))
  })

  // ── The guards and their beats ────────────────────────────────────────────────────────
  // Junctions are where beats anchor; each kind patrols its own way: the warden walks long
  // rounds, the hound runs short circuits, the sentry barely leaves its post.
  const junctions: { x: number; y: number }[] = []
  for (let y = 1; y < DUNGEON_H - 1; y += 1) {
    for (let x = 1; x < DUNGEON_W - 1; x += 1) {
      if (!isWalk(x, y) || taken.has(key(x, y))) continue
      const open = (
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const
      ).filter(([dx, dy]) => isWalk(x + dx, y + dy)).length
      if (open >= 3 && distAt(x, y) >= 10) junctions.push({ x, y })
    }
  }
  const enemies: DungeonEnemyDef[] = []
  {
    const pool = shuffle(rng, junctions)
    const kinds: EnemyKind[] = ['warden', 'hound', 'sentry', 'warden', 'hound', 'sentry']
    const count = Math.min(5 + nextInt(rng, 2), pool.length)
    const span = (kind: EnemyKind): [number, number] =>
      kind === 'warden' ? [8, 26] : kind === 'hound' ? [4, 12] : [2, 6]
    for (let i = 0; i < count; i += 1) {
      const kind = kinds[i % kinds.length] as EnemyKind
      const home = pool[i]
      if (!home) break
      const [lo, hi] = span(kind)
      const mates = pool.filter((j) => {
        const d = Math.abs(j.x - home.x) + Math.abs(j.y - home.y)
        return j !== home && d >= lo && d <= hi
      })
      const beats = kind === 'warden' ? 2 : 1
      const patrol = [home, ...shuffle(rng, mates).slice(0, beats)]
      // A sentry with no mate shuffles between its post and an open neighbour.
      if (patrol.length === 1) {
        const side = (
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const
        ).find(([dx, dy]) => isWalk(home.x + dx, home.y + dy))
        if (side) patrol.push({ x: home.x + side[0], y: home.y + side[1] })
      }
      enemies.push({ id: i, kind, x: home.x, y: home.y, patrol })
    }
  }

  // ── Set dressing: torches on the walls, damp in the halls ─────────────────────────────
  const props: DungeonPropDef[] = []
  const wallSide = (x: number, y: number): 'n' | 'e' | 's' | 'w' | null =>
    !isWalk(x, y - 1) ? 'n' : !isWalk(x + 1, y) ? 'e' : !isWalk(x, y + 1) ? 's' : !isWalk(x - 1, y) ? 'w' : null
  const CLUTTER: readonly DungeonPropKind[] = [
    'grass', 'rubble', 'bones', 'puddle', 'crack', 'mushroom', 'candle', 'chain', 'web',
  ]
  for (let y = 1; y < DUNGEON_H - 1; y += 1) {
    for (let x = 1; x < DUNGEON_W - 1; x += 1) {
      if (!isWalk(x, y) || taken.has(key(x, y))) continue
      const side = wallSide(x, y)
      if (side && nextInt(rng, 11) === 0) {
        taken.add(key(x, y))
        props.push({ kind: 'torch', x, y, side })
      } else if (nextInt(rng, 13) === 0) {
        taken.add(key(x, y))
        props.push({
          kind: CLUTTER[nextInt(rng, CLUTTER.length)] as DungeonPropKind,
          x,
          y,
          side: side ?? 'n',
        })
      }
    }
  }

  return {
    seed: seed >>> 0,
    w: DUNGEON_W,
    h: DUNGEON_H,
    walk,
    chambers,
    doors,
    chests,
    enemies,
    props,
    gate,
    entrance,
    start,
  }
}
