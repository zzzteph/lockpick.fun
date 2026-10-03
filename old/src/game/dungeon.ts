/**
 * The labyrinth generator — `docs/DUNGEON.md`, the prison the Lock dungeon became (D-177),
 * rebuilt ROOMS-FIRST for D-189: "I want to have more space and rooms … like library,
 * kitchen, cells, tortures … with the different loot spawn inside."
 *
 * This module is the *architect* and nothing else: given a seed it stamps a dozen THEMED
 * ROOMS (a library, a kitchen, the cells — twenty styles in the catalogue, each with its
 * own furniture and its own idea of loot), weaves a braided maze of corridors around
 * them, hangs ONE DOOR on every room's mouth — doors belong to rooms now, never to the
 * middle of a corridor ("the doors should be for the every room") — and builds THE
 * GATEHOUSE against the far border: the room the exit gate lives in, behind the one door
 * that is always locked. Everything is dealt from one rng stream, so the same seed always
 * builds the same labyrinth, byte for byte — the property every proof stands on.
 *
 * The world it hands over is *data at rest*: nothing here moves, chases, or opens. That is
 * `dungeonRun.ts`, the pure turn machine. The locks are not built here either — a door
 * carries a tier and a wheel flag, and `generateDungeonLock` builds the actual `LockDef`
 * from the same legal space every dungeon lock has come from since D-165.
 *
 * Fairness floors, deliberately few:
 * - the gate's kneeling side is reachable treating locked doors as pickable — no floor can
 *   deal an escape that keys and picks cannot reach;
 * - the gate sits INSIDE the gatehouse, whose one door is always locked — the D-180
 *   guarantee ("no free exit") holds by construction now, not by a cut set;
 * - the artifacts exist on every floor: two spare picks, two skeleton keys, one motion
 *   tracker, spread across five different rooms' chests;
 * - no guard spawns within ten tiles of the start — the first minute belongs to you.
 */

import { createRng, nextInt, shuffle } from '../sim'

export const DUNGEON_W = 52
export const DUNGEON_H = 28
/** Maze lattice: cell centres on odd tiles. */
const MAZE_COLS = 25
const MAZE_ROWS = 13

export interface DungeonDoorDef {
  readonly id: number
  readonly x: number
  readonly y: number
  /** Some room doors are simply shut, not locked — furniture you walk through (D-189). */
  readonly locked: boolean
  readonly lockTier: 1 | 2 | 3 | 4
  readonly wheel: boolean
}

/** What a chest can hold — grown for the themed rooms (D-189). */
export type DungeonItem =
  | 'pick'
  | 'skeleton-key'
  | 'tracker'
  | 'lamp-oil'
  | 'soft-boots'
  | 'map-fragment'
  | 'tonic'
  | 'valuables'
  | null

export interface ChestLoot {
  readonly item: DungeonItem
  /** Valuables only: what the haul banks on escape. */
  readonly value?: number
  /** Valuables only: what the ticker calls it — the room theme names its own treasure. */
  readonly label?: string
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
  | 'drain'
  | 'bench'
  | 'pipe'
  | 'stain'
  | 'sign'
  | 'shelf'
  | 'table'
  | 'anvil'
  | 'altar'
  | 'barrel'
  | 'bed'
  | 'rack'
  | 'cauldron'

/** The prop kinds that hang from or lean on a wall — placement needs a `side`. */
const WALL_PROPS: readonly DungeonPropKind[] = [
  'torch', 'web', 'bench', 'pipe', 'sign', 'shelf', 'rack',
]

export interface DungeonPropDef {
  readonly kind: DungeonPropKind
  readonly x: number
  readonly y: number
  /** For wall-hung kinds: which neighbouring wall they hang from. */
  readonly side: 'n' | 'e' | 's' | 'w'
}

/** The kinds of guard — different speed, sight and beat (D-177). Nobody dies here. */
// The hound left the roster in D-189 — the owner: "remove dog as an enemy - right now
// there are too much enemies." The wing walks on wardens, sentries and the listener,
// with the hunter deep behind them all.
export type EnemyKind = 'warden' | 'sentry' | 'listener' | 'hunter'

/** A wall-mounted alarm bell (D-181): a seen warden runs for one; rung, the wing wakes. */
export interface DungeonBellDef {
  readonly x: number
  readonly y: number
  /** Which neighbouring wall it hangs from — drawn like the torches. */
  readonly side: 'n' | 'e' | 's' | 'w'
}

// D-195/196's traps lived here for one version; D-197 removed the mechanic outright at
// the owner's word — "let's remove the traps completely from the game." The wing is
// pure stealth again: nobody dies here.

export interface DungeonEnemyDef {
  readonly id: number
  readonly kind: EnemyKind
  readonly x: number
  readonly y: number
  /** The beat this guard walks while nothing has alerted it. */
  readonly patrol: readonly { readonly x: number; readonly y: number }[]
}

/** The twenty styles a room can wear, plus the gatehouse the exit hides in (D-189). */
export type RoomTheme =
  | 'library'
  | 'kitchen'
  | 'cells'
  | 'torture'
  | 'armory'
  | 'chapel'
  | 'crypt'
  | 'storeroom'
  | 'barracks'
  | 'forge'
  | 'infirmary'
  | 'laundry'
  | 'cellar'
  | 'treasury'
  | 'guardroom'
  | 'office'
  | 'well'
  | 'workshop'
  | 'archive'
  | 'mess'
  | 'gatehouse'

export interface RoomThemeSpec {
  /** How the ticker addresses it: `the LIBRARY`. */
  readonly name: string
  /** The entry line's flavour — one clause, hinting what the room's chests favour. */
  readonly line: string
  /** What a non-guaranteed chest here rolls. `null` entries are the ransacked misses. */
  readonly loot: readonly DungeonItem[]
  /** The furniture the theme stamps on its floor and walls. */
  readonly props: readonly DungeonPropKind[]
  /** Themes whose chests hold score, not tools: what it is called and what it banks. */
  readonly treasure?: { readonly label: string; readonly value: number }
}

/**
 * The catalogue — twenty ways a room can be furnished, each with its own idea of loot
 * ("with the different loot spawn inside"). A floor deals a hand of these, no repeats.
 */
export const ROOM_THEMES: Record<RoomTheme, RoomThemeSpec> = {
  library: {
    name: 'the LIBRARY', line: 'shelves lean with old paper',
    loot: ['map-fragment', 'map-fragment', null], props: ['shelf', 'shelf', 'candle', 'web'],
  },
  kitchen: {
    name: 'the KITCHEN', line: 'cold hearths and copper pans',
    loot: ['tonic', 'lamp-oil', null], props: ['table', 'cauldron', 'barrel', 'stain'],
  },
  cells: {
    name: 'the CELLS', line: 'empty bunks, old chains',
    loot: ['pick', 'pick', null, null], props: ['bed', 'chain', 'bones', 'sign'],
  },
  torture: {
    name: 'the TORTURE CHAMBER', line: 'the rack still creaks',
    loot: ['skeleton-key', 'tonic', null], props: ['rack', 'chain', 'stain', 'bones'],
  },
  armory: {
    name: 'the ARMOURY', line: 'stripped racks — but not quite all',
    loot: ['pick', 'pick', 'tonic'], props: ['shelf', 'table', 'rubble', 'sign'],
  },
  chapel: {
    name: 'the CHAPEL', line: 'candle smoke and silverware',
    loot: ['valuables', 'valuables', 'tonic'], props: ['altar', 'candle', 'candle', 'bench'],
    treasure: { label: 'the silver candlesticks', value: 90 },
  },
  crypt: {
    name: 'the CRYPT', line: 'the quiet residents keep their rings',
    loot: ['valuables', null], props: ['bones', 'bones', 'altar', 'web'],
    treasure: { label: 'grave rings', value: 70 },
  },
  storeroom: {
    name: 'the STOREROOM', line: 'crates, sacks and lamp oil',
    loot: ['lamp-oil', 'lamp-oil', null], props: ['barrel', 'barrel', 'shelf', 'web'],
  },
  barracks: {
    name: 'the BARRACKS', line: 'guard beds, guard boots',
    loot: ['soft-boots', null], props: ['bed', 'bed', 'bench', 'table'],
  },
  forge: {
    name: 'the FORGE', line: 'the smith cut key blanks here',
    loot: ['skeleton-key', 'pick'], props: ['anvil', 'table', 'rubble', 'stain'],
  },
  infirmary: {
    name: 'the INFIRMARY', line: 'bitter tonics on the shelf',
    loot: ['tonic', 'tonic'], props: ['bed', 'table', 'candle', 'stain'],
  },
  laundry: {
    name: 'the LAUNDRY', line: 'wet stone and soft cloth',
    loot: ['soft-boots', 'soft-boots', null], props: ['barrel', 'puddle', 'drain', 'stain'],
  },
  cellar: {
    name: 'the WINE CELLAR', line: 'vaulted dark and old vintages',
    loot: ['valuables', 'tonic'], props: ['barrel', 'barrel', 'web', 'mushroom'],
    treasure: { label: 'a dusty vintage', value: 60 },
  },
  treasury: {
    name: 'the TREASURY', line: "the wing's take, counted and locked",
    loot: ['valuables', 'valuables'], props: ['shelf', 'table', 'chain', 'sign'],
    treasure: { label: "the warden's coin", value: 150 },
  },
  guardroom: {
    name: 'the GUARD ROOM', line: 'cards on the table, kit on the hooks',
    loot: ['pick', 'skeleton-key'], props: ['table', 'bench', 'sign', 'candle'],
  },
  office: {
    name: "the WARDEN'S OFFICE", line: 'ledgers, seals, confiscations',
    loot: ['map-fragment', 'valuables'], props: ['table', 'shelf', 'candle', 'sign'],
    treasure: { label: 'a seal of office', value: 80 },
  },
  well: {
    name: 'the WELL ROOM', line: 'a drain, a bucket, black water',
    loot: ['lamp-oil', null], props: ['drain', 'puddle', 'puddle', 'pipe'],
  },
  workshop: {
    name: 'the WORKSHOP', line: 'benches of half-made things',
    loot: ['pick', 'pick'], props: ['table', 'anvil', 'shelf', 'rubble'],
  },
  archive: {
    name: 'the ARCHIVE', line: 'floor plans, filed and forgotten',
    loot: ['map-fragment', 'map-fragment'], props: ['shelf', 'shelf', 'shelf', 'web'],
  },
  mess: {
    name: 'the MESS HALL', line: 'long tables, licked-clean plates',
    loot: ['tonic', null, null], props: ['table', 'table', 'bench', 'stain'],
  },
  gatehouse: {
    name: 'the GATEHOUSE', line: 'the last door before daylight',
    loot: [], props: ['sign', 'bench', 'chain'],
  },
}

/** Every theme a floor can deal a LOOT room from — the gatehouse is placed, not dealt. */
export const LOOT_THEMES: readonly RoomTheme[] = [
  'library', 'kitchen', 'cells', 'torture', 'armory', 'chapel', 'crypt', 'storeroom',
  'barracks', 'forge', 'infirmary', 'laundry', 'cellar', 'treasury', 'guardroom',
  'office', 'well', 'workshop', 'archive', 'mess',
]

export interface DungeonRoomDef {
  readonly id: number
  readonly theme: RoomTheme
  /** The interior rect, inclusive — walls sit one tile outside it. */
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export interface DungeonFloor {
  readonly seed: number
  readonly w: number
  readonly h: number
  /** walk[y][x] — true where a body can stand (halls, rooms, doorways, the notches). */
  readonly walk: readonly (readonly boolean[])[]
  /** The themed rooms — interiors, for the renderer's floors and the run's ticker. */
  readonly rooms: readonly DungeonRoomDef[]
  readonly doors: readonly DungeonDoorDef[]
  readonly chests: readonly DungeonChestDef[]
  readonly enemies: readonly DungeonEnemyDef[]
  readonly props: readonly DungeonPropDef[]
  readonly bells: readonly DungeonBellDef[]
  /** The way OUT: the exit gate on the far border, inside the gatehouse. */
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

/** The room whose interior holds this tile, if any — the renderer and ticker both ask. */
export function roomAt(floor: DungeonFloor, x: number, y: number): DungeonRoomDef | undefined {
  return floor.rooms.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)
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

  // ── The rooms come FIRST (D-189) — the maze weaves around what the builders built ─────
  const rooms: Mutable<DungeonRoomDef>[] = []
  /** Lattice cells whose centres sit inside a room — ground the maze must not touch. */
  const roomCell: boolean[][] = Array.from({ length: MAZE_ROWS }, () =>
    Array.from({ length: MAZE_COLS }, () => false),
  )
  const inRoom = (x: number, y: number): DungeonRoomDef | undefined =>
    rooms.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)
  /** Inside any room's envelope — interior plus its wall ring. Braids and avenues keep out. */
  const inEnvelope = (x: number, y: number): boolean =>
    rooms.some((r) => x >= r.x0 - 1 && x <= r.x1 + 1 && y >= r.y0 - 1 && y <= r.y1 + 1)

  const claim = (room: DungeonRoomDef): void => {
    for (let cy = 0; cy < MAZE_ROWS; cy += 1) {
      for (let cx = 0; cx < MAZE_COLS; cx += 1) {
        const t = cellTile(cx, cy)
        if (t.x >= room.x0 && t.x <= room.x1 && t.y >= room.y0 && t.y <= room.y1) {
          ;(roomCell[cy] as boolean[])[cx] = true
        }
      }
    }
    for (let y = room.y0; y <= room.y1; y += 1) {
      for (let x = room.x0; x <= room.x1; x += 1) carve(x, y)
    }
  }

  /**
   * A candidate doorway: the interior edge tile, the wall tile the door will stand in,
   * and the corridor cell beyond it. Only odd cross-axis tiles qualify — the far side
   * must be a maze cell centre, or the door would open onto solid rock.
   */
  const doorwaysFor = (
    r: { x0: number; y0: number; x1: number; y1: number },
  ): { side: 'n' | 'e' | 's' | 'w'; wx: number; wy: number; cx: number; cy: number }[] => {
    const out: { side: 'n' | 'e' | 's' | 'w'; wx: number; wy: number; cx: number; cy: number }[] = []
    for (let x = r.x0; x <= r.x1; x += 1) {
      if (x % 2 !== 1) continue
      if (r.y0 - 2 >= 1) out.push({ side: 'n', wx: x, wy: r.y0 - 1, cx: x, cy: r.y0 - 2 })
      if (r.y1 + 2 <= DUNGEON_H - 2) out.push({ side: 's', wx: x, wy: r.y1 + 1, cx: x, cy: r.y1 + 2 })
    }
    for (let y = r.y0; y <= r.y1; y += 1) {
      if (y % 2 !== 1) continue
      if (r.x0 - 2 >= 1) out.push({ side: 'w', wx: r.x0 - 1, wy: y, cx: r.x0 - 2, cy: y })
      if (r.x1 + 2 <= DUNGEON_W - 2) out.push({ side: 'e', wx: r.x1 + 1, wy: y, cx: r.x1 + 2, cy: y })
    }
    // The corridor side must be free ground for the maze — not another room's cells.
    return out.filter((c) => !inEnvelope(c.cx, c.cy))
  }

  {
    // THE GATEHOUSE comes first — the one room the floor cannot exist without claims its
    // ground before the hand is dealt. Against the east border, the far side from the
    // start; the exit gate stands beyond its east wall, joined by a one-tile PORCH, and
    // its one door is the D-180 guarantee, structural now. The interior keeps the
    // lattice's odd parity (an even anchor put corridor cells flush against the
    // interior — a room with an open wall).
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const w = 3 + 2 * nextInt(rng, 2)
      const h = 3 + 2 * nextInt(rng, 2)
      const x1 = DUNGEON_W - 3
      const x0 = x1 - w + 1
      const y0 = 3 + 2 * nextInt(rng, Math.floor((DUNGEON_H - 6 - h) / 2) + 1)
      const y1 = y0 + h - 1
      if (y1 > DUNGEON_H - 4) continue
      if (doorwaysFor({ x0, y0, x1, y1 }).length === 0) continue
      const room: Mutable<DungeonRoomDef> = { id: rooms.length, theme: 'gatehouse', x0, y0, x1, y1 }
      rooms.push(room)
      claim(room)
      break
    }
    // A hand of themes, no repeats — every floor furnishes differently.
    const hand = shuffle(rng, LOOT_THEMES.slice()).slice(0, 10 + nextInt(rng, 2))
    const sizes: [number, number][] = [
      [3, 3], [3, 3], [5, 3], [5, 3], [5, 5], [7, 3], [7, 5],
    ]
    for (const theme of hand) {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const [w, h] = sizes[nextInt(rng, sizes.length)] as [number, number]
        const x0 = 3 + 2 * nextInt(rng, Math.floor((DUNGEON_W - 6 - w) / 2) + 1)
        const y0 = 3 + 2 * nextInt(rng, Math.floor((DUNGEON_H - 6 - h) / 2) + 1)
        const x1 = x0 + w - 1
        const y1 = y0 + h - 1
        if (x1 > DUNGEON_W - 4 || y1 > DUNGEON_H - 4) continue
        if (x0 <= 4 && y0 <= 4) continue // the start's corner stays corridor
        const crowds = rooms.some(
          (o) => !(x0 > o.x1 + 3 || x1 < o.x0 - 3 || y0 > o.y1 + 3 || y1 < o.y0 - 3),
        )
        if (crowds) continue
        if (doorwaysFor({ x0, y0, x1, y1 }).length === 0) continue
        const room: Mutable<DungeonRoomDef> = { id: rooms.length, theme, x0, y0, x1, y1 }
        rooms.push(room)
        claim(room)
        break
      }
    }
  }
  const gatehouse = rooms.find((r) => r.theme === 'gatehouse')
  if (!gatehouse) throw new Error(`seed ${seed}: no ground for a gatehouse`)

  // ── The maze: recursive backtracker over the cells the rooms left free ────────────────
  const visited: boolean[][] = roomCell.map((row) => row.slice())
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
    // Rooms can pinch the lattice into pockets the backtracker never reached. Sew every
    // pocket to a visited neighbour — deterministic row order, repeated until quiet.
    let sewed = true
    while (sewed) {
      sewed = false
      for (let cy = 0; cy < MAZE_ROWS; cy += 1) {
        for (let cx = 0; cx < MAZE_COLS; cx += 1) {
          if (visited[cy]?.[cx]) continue
          const mate = (
            [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ] as const
          ).find(([dx, dy]) => {
            const nx = cx + dx
            const ny = cy + dy
            return (visited[ny]?.[nx] ?? false) && !(roomCell[ny]?.[nx] ?? false)
          })
          if (!mate) continue
          const a = cellTile(cx, cy)
          const b = cellTile(cx + mate[0], cy + mate[1])
          carve(a.x, a.y)
          carve((a.x + b.x) / 2, (a.y + b.y) / 2)
          ;(visited[cy] as boolean[])[cx] = true
          sewed = true
        }
      }
    }
  }

  // ── Braiding: open some dead ends into loops ──────────────────────────────────────────
  // A perfect maze is a tree, and a tree has no way around a guard. Loops are what make
  // "run — break its line of sight" a real verb rather than advice.
  for (let cy = 0; cy < MAZE_ROWS; cy += 1) {
    for (let cx = 0; cx < MAZE_COLS; cx += 1) {
      if (roomCell[cy]?.[cx]) continue
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
            !(roomCell[ny]?.[nx] ?? false) &&
            !isWalk(t.x + dx, t.y + dy)
          )
        }),
      )
      const pick = closed[0]
      if (pick) carve(t.x + pick[0], t.y + pick[1])
    }
  }

  // ── Avenues (D-185): "the corridors a wider maybe — not all, but some of them" ────────
  // A few hall stretches open one flank for 3–6 cells, becoming 2-wide avenues. Seeded
  // sparsely on straight halls; runs follow the hall and widen the same side throughout,
  // so an avenue reads as a built thing, not an erosion. Room walls always hold.
  for (let y = 2; y < DUNGEON_H - 2; y += 1) {
    for (let x = 2; x < DUNGEON_W - 2; x += 1) {
      if (!isWalk(x, y) || inEnvelope(x, y)) continue
      const hHall = isWalk(x - 1, y) && isWalk(x + 1, y) && !isWalk(x, y - 1) && !isWalk(x, y + 1)
      const vHall = isWalk(x, y - 1) && isWalk(x, y + 1) && !isWalk(x - 1, y) && !isWalk(x + 1, y)
      if ((!hHall && !vHall) || nextInt(rng, 22) !== 0) continue
      const len = 3 + nextInt(rng, 4)
      const side = nextInt(rng, 2) === 0 ? 1 : -1
      for (let i = 0; i < len; i += 1) {
        const wx = hHall ? x + i : x
        const wy = hHall ? y : y + i
        if (wx < 1 || wx >= DUNGEON_W - 1 || wy < 1 || wy >= DUNGEON_H - 1) break
        if (!isWalk(wx, wy)) break
        const fx = hHall ? wx : wx + side
        const fy = hHall ? wy + side : wy
        if (fx < 1 || fx >= DUNGEON_W - 1 || fy < 1 || fy >= DUNGEON_H - 1) break
        if (inEnvelope(fx, fy)) break
        carve(fx, fy)
      }
    }
  }

  // ── Start and the barred way in ───────────────────────────────────────────────────────
  const start = { x: 1, y: 1 }
  const entrance = { x: 0, y: 1 }
  carve(entrance.x, entrance.y)

  // ── Reserved ground ───────────────────────────────────────────────────────────────────
  const taken = new Set<string>()
  const key = (x: number, y: number): string => `${x},${y}`
  taken.add(key(start.x, start.y))
  taken.add(key(entrance.x, entrance.y))

  // ── Every room gets its DOOR (D-189): on the mouth, never mid-corridor ────────────────
  // Big rooms earn a second mouth on another side — flow, not a fire-code violation.
  const doors: Mutable<DungeonDoorDef>[] = []
  {
    for (const room of rooms) {
      const spots = shuffle(rng, doorwaysFor(room))
      const first = spots[0]
      if (!first) throw new Error(`seed ${seed}: room ${room.id} has no mouth`)
      const area = (room.x1 - room.x0 + 1) * (room.y1 - room.y0 + 1)
      const chosen = [first]
      if (room.theme !== 'gatehouse' && area >= 25) {
        const second = spots.find((c) => c.side !== first.side)
        if (second) chosen.push(second)
      }
      for (const c of chosen) {
        carve(c.wx, c.wy)
        doors.push({
          id: doors.length,
          x: c.wx,
          y: c.wy,
          // The gatehouse door is the exit guarantee — always locked. Elsewhere some
          // doors are simply shut: a mouth to walk through, drawn open on the plan.
          locked: room.theme === 'gatehouse' ? true : nextInt(rng, 4) > 0,
          lockTier: 1, // priced below, once distances exist
          wheel: false,
        })
        taken.add(key(c.wx, c.wy))
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          taken.add(key(c.wx + dx, c.wy + dy))
        }
      }
    }
  }

  // ── THE GATE: through the gatehouse's east wall, joined by its porch ──────────────────
  const gate = {
    x: DUNGEON_W - 1,
    y: gatehouse.y0 + Math.floor((gatehouse.y1 - gatehouse.y0) / 2),
    lockTier: 4 as const,
    wheel: nextInt(rng, 2) === 0,
  }
  // The porch: one carved tile between the interior and the border, kneeling ground the
  // room alone can reach — its flanking ring tiles stay wall.
  carve(DUNGEON_W - 2, gate.y)
  carve(gate.x, gate.y)
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) taken.add(key(gate.x + dx, gate.y + dy))
  }
  taken.add(key(DUNGEON_W - 3, gate.y))

  // ── Distances from the start, for everything priced or placed "far" ───────────────────
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
  let bestD = 1
  for (let y = 1; y < DUNGEON_H - 1; y += 1) {
    for (let x = 1; x < DUNGEON_W - 1; x += 1) {
      if (distAt(x, y) > bestD) bestD = distAt(x, y)
    }
  }

  // Price the doors now that depth exists: nearer the start picks easier.
  for (const d of doors) {
    const frac = Math.max(0, distAt(d.x, d.y)) / bestD
    const base = frac < 0.34 ? 1 : frac < 0.67 ? 2 : 3
    const bumped = base + (nextInt(rng, 4) === 0 ? 1 : 0)
    const isGatehouse =
      d.x >= gatehouse.x0 - 1 && d.x <= gatehouse.x1 + 1 && d.y >= gatehouse.y0 - 1 && d.y <= gatehouse.y1 + 1
    const tier = Math.min(4, Math.max(isGatehouse ? 3 : 1, bumped)) as 1 | 2 | 3 | 4
    d.lockTier = tier
    d.wheel = tier >= 2 && nextInt(rng, 3) === 0
  }

  // ── Chests: every loot room keeps at least one, big rooms two ─────────────────────────
  // The guaranteed spread rides the first chest of five different rooms: one motion
  // tracker, two skeleton keys, two spare picks — the fairness floor the mode leans on.
  // Everything after that is the ROOM'S loot: what a library hides is not what a
  // storeroom does ("with the different loot spawn inside").
  const GUARANTEED: DungeonItem[] = ['tracker', 'skeleton-key', 'skeleton-key', 'pick', 'pick']
  const chests: Mutable<DungeonChestDef>[] = []
  {
    const lootRooms = shuffle(rng, rooms.filter((r) => r.theme !== 'gatehouse'))
    lootRooms.forEach((room, roomIndex) => {
      const spec = ROOM_THEMES[room.theme]
      const inner: { x: number; y: number }[] = []
      for (let y = room.y0 + 1; y <= room.y1 - 1; y += 1) {
        for (let x = room.x0 + 1; x <= room.x1 - 1; x += 1) {
          if (!taken.has(key(x, y))) inner.push({ x, y })
        }
      }
      const area = (room.x1 - room.x0 + 1) * (room.y1 - room.y0 + 1)
      const want = Math.min(inner.length, area >= 25 ? 2 : 1)
      const sites = shuffle(rng, inner).slice(0, want)
      sites.forEach((site, siteIndex) => {
        const frac = Math.max(0, distAt(site.x, site.y)) / bestD
        const base = (frac < 0.34 ? 1 : frac < 0.67 ? 2 : 3) as 1 | 2 | 3 | 4
        // The treasury seals everything it owns; elsewhere a third of chests sit unlocked.
        const locked = room.theme === 'treasury' ? true : nextInt(rng, 3) > 0
        const guaranteed = siteIndex === 0 ? GUARANTEED[roomIndex] : undefined
        const rolled =
          guaranteed !== undefined
            ? guaranteed
            : spec.loot.length > 0
              ? (spec.loot[nextInt(rng, spec.loot.length)] as DungeonItem)
              : null
        const loot: ChestLoot =
          rolled === 'valuables' && spec.treasure
            ? { item: 'valuables', value: spec.treasure.value, label: spec.treasure.label }
            : { item: rolled }
        chests.push({
          id: chests.length,
          x: site.x,
          y: site.y,
          locked,
          lockTier: locked ? base : 1,
          wheel: locked && base >= 2 && nextInt(rng, 3) === 0,
          loot,
          style: nextInt(rng, 3) as 0 | 1 | 2,
        })
        taken.add(key(site.x, site.y))
      })
    })
  }

  // ── The guards and their beats — corridor creatures; rooms are yours to slip into ─────
  // Junctions are where beats anchor; each kind patrols its own way: the warden walks
  // long rounds, the sentry barely leaves its post, the listener drifts between them.
  const junctions: { x: number; y: number }[] = []
  for (let y = 1; y < DUNGEON_H - 1; y += 1) {
    for (let x = 1; x < DUNGEON_W - 1; x += 1) {
      if (!isWalk(x, y) || taken.has(key(x, y)) || inRoom(x, y)) continue
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
    // Wardens, sentries and TWO listeners since D-192 ("I want to have more listeners -
    // they are really fun") — the hound stays retired (D-189: "too much enemies"), so
    // the wing gains ears, not bodies.
    const kinds: EnemyKind[] = ['warden', 'listener', 'sentry', 'listener', 'sentry']
    const count = Math.min(4 + nextInt(rng, 2), pool.length)
    const span = (kind: EnemyKind): [number, number] =>
      kind === 'warden' ? [8, 26] : kind === 'listener' ? [4, 10] : [2, 6]
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
    // The HUNTER (D-182): one per wing, spawned at the deepest junction the maze owns —
    // as far from the start as the floor can put it. Never sleeps, never gives up; the
    // machine gives it a fix on you every few seconds and it walks, a third of your pace.
    let deep: { x: number; y: number } | null = null
    let deepD = -1
    for (const j of junctions) {
      if (enemies.some((e) => e.x === j.x && e.y === j.y)) continue
      const d = distAt(j.x, j.y)
      if (d > deepD) {
        deepD = d
        deep = j
      }
    }
    if (deep) {
      const home = deep
      const patrol: { x: number; y: number }[] = [home]
      const side = (
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const
      ).find(([dx, dy]) => isWalk(home.x + dx, home.y + dy))
      if (side) patrol.push({ x: home.x + side[0], y: home.y + side[1] })
      enemies.push({ id: enemies.length, kind: 'hunter', x: home.x, y: home.y, patrol })
    }
  }

  // ── The alarm bells (D-181): two per wing, hung far apart on corridor walls ──────────
  const wallSide = (x: number, y: number): 'n' | 'e' | 's' | 'w' | null =>
    !isWalk(x, y - 1) ? 'n' : !isWalk(x + 1, y) ? 'e' : !isWalk(x, y + 1) ? 's' : !isWalk(x - 1, y) ? 'w' : null
  const bells: DungeonBellDef[] = []
  {
    const spots: { x: number; y: number; side: 'n' | 'e' | 's' | 'w' }[] = []
    for (let y = 1; y < DUNGEON_H - 1; y += 1) {
      for (let x = 1; x < DUNGEON_W - 1; x += 1) {
        if (!isWalk(x, y) || taken.has(key(x, y)) || inRoom(x, y)) continue
        const side = wallSide(x, y)
        if (side && distAt(x, y) >= 8) spots.push({ x, y, side })
      }
    }
    for (const spot of shuffle(rng, spots)) {
      if (bells.length >= 2) break
      if (bells.some((b) => Math.abs(b.x - spot.x) + Math.abs(b.y - spot.y) < 14)) continue
      bells.push(spot)
      taken.add(key(spot.x, spot.y))
    }
  }

  // ── Set dressing ──────────────────────────────────────────────────────────────────────
  // Rooms wear their THEME's furniture (D-189): the library its shelves, the forge its
  // anvil — recognition at a glance, before any generated plate arrives. Corridors keep
  // the prison-issue clutter of D-180.
  const props: DungeonPropDef[] = []
  for (const room of rooms) {
    const spec = ROOM_THEMES[room.theme]
    const sites: { x: number; y: number }[] = []
    for (let y = room.y0; y <= room.y1; y += 1) {
      for (let x = room.x0; x <= room.x1; x += 1) {
        if (!taken.has(key(x, y))) sites.push({ x, y })
      }
    }
    const want = Math.min(sites.length, 2 + nextInt(rng, 3))
    const spots = shuffle(rng, sites)
    let placed = 0
    for (const spot of spots) {
      if (placed >= want) break
      const kind = spec.props[nextInt(rng, spec.props.length)] as DungeonPropKind
      const side = wallSide(spot.x, spot.y)
      // Wall furniture needs a wall; a mid-room draw re-rolls the site instead.
      if (WALL_PROPS.includes(kind) && !side) continue
      props.push({ kind, x: spot.x, y: spot.y, side: side ?? 'n' })
      taken.add(key(spot.x, spot.y))
      placed += 1
    }
  }
  // The corridor clutter leans GRIM since D-193 ("make the place more GRIM"): bones,
  // chains, old stains and webs weighted double, and the whole flood a notch denser.
  const CLUTTER: readonly DungeonPropKind[] = [
    'grass', 'rubble', 'bones', 'bones', 'puddle', 'crack', 'mushroom', 'candle',
    'chain', 'chain', 'web', 'web', 'drain', 'bench', 'pipe', 'stain', 'stain', 'sign',
  ]
  for (let y = 1; y < DUNGEON_H - 1; y += 1) {
    for (let x = 1; x < DUNGEON_W - 1; x += 1) {
      if (!isWalk(x, y) || taken.has(key(x, y)) || inRoom(x, y)) continue
      const side = wallSide(x, y)
      if (side && nextInt(rng, 10) === 0) {
        taken.add(key(x, y))
        props.push({ kind: 'torch', x, y, side })
      } else if (nextInt(rng, 7) === 0) {
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
    rooms,
    doors,
    chests,
    enemies,
    props,
    bells,
    gate,
    entrance,
    start,
  }
}
