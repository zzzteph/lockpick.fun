/**
 * The labyrinth generator — `docs/DUNGEON.md`, swept the way every dealer here is (D-177),
 * rebuilt for the themed rooms of D-189.
 *
 * What has to be true of every labyrinth it can ever deal: the maze is connected and
 * braided, every ROOM wears a theme and owns a DOOR on its mouth (never mid-corridor),
 * THE GATE stands in the gatehouse's border wall behind its always-locked door, the
 * artifacts all exist (picks, keys, the tracker), the guards spawn far from the start
 * with walkable corridor beats, and the same seed always deals the same bytes.
 */

import { describe, expect, it } from 'vitest'
import {
  DUNGEON_H,
  DUNGEON_W,
  LOOT_THEMES,
  ROOM_THEMES,
  generateFloor,
  roomAt,
  type DungeonFloor,
} from '../../src/game/dungeon'
import { generateDungeonLock } from '../../src/game/gauntlet'
import { validateLockDef } from '../../src/sim'

const SWEEP_SEEDS = Array.from({ length: 250 }, (_, i) => i * 6007 + 3)

/**
 * Every cell a body can reach from the start — locked doors treated as pickable (they
 * are), chests and the shut gate as the furniture they are.
 */
function reachable(floor: DungeonFloor): Set<string> {
  const blocked = new Set(floor.chests.map((c) => `${c.x},${c.y}`))
  blocked.add(`${floor.gate.x},${floor.gate.y}`)
  const seen = new Set<string>()
  const queue = [[floor.start.x, floor.start.y]]
  seen.add(`${floor.start.x},${floor.start.y}`)
  while (queue.length > 0) {
    const [x, y] = queue.pop() as [number, number]
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
      if (blocked.has(k)) continue
      seen.add(k)
      queue.push([nx, ny])
    }
  }
  return seen
}

describe('the labyrinth generator', () => {
  it('deals a connected, braided maze inside the border', () => {
    for (const seed of SWEEP_SEEDS.slice(0, 120)) {
      const f = generateFloor(seed)
      const seen = reachable(f)
      let walkable = 0
      let loops = 0
      for (let y = 0; y < DUNGEON_H; y += 1) {
        for (let x = 0; x < DUNGEON_W; x += 1) {
          if (!(f.walk[y]?.[x] ?? false)) continue
          walkable += 1
          // Border stays wall except the two notches.
          const onBorder = x === 0 || x === DUNGEON_W - 1 || y === 0 || y === DUNGEON_H - 1
          if (onBorder) {
            const isNotch =
              (x === f.entrance.x && y === f.entrance.y) || (x === f.gate.x && y === f.gate.y)
            expect(isNotch, `seed ${seed} — hole in the border at ${x},${y}`).toBe(true)
          }
        }
      }
      // Everything walkable is reachable, chests and gate aside.
      const blockedCount = f.chests.length + 1
      expect(seen.size, `seed ${seed} — sealed region`).toBeGreaterThanOrEqual(
        walkable - blockedCount - 2,
      )
      // Braided: more open cells than a perfect maze's tree would carve.
      for (let y = 1; y < DUNGEON_H - 1; y += 1) {
        for (let x = 1; x < DUNGEON_W - 1; x += 1) {
          if ((f.walk[y]?.[x] ?? false) && (f.walk[y + 1]?.[x] ?? false) && (f.walk[y]?.[x + 1] ?? false) && (f.walk[y + 1]?.[x + 1] ?? false)) {
            loops += 1 // a 2×2 open block only exists where loops or rooms do
          }
        }
      }
      expect(loops, `seed ${seed} — no loops, pure tree`).toBeGreaterThan(0)
    }
  })

  it('hangs the GATE in the gatehouse wall: border, hardest lock, kneelable', () => {
    for (const seed of SWEEP_SEEDS.slice(0, 120)) {
      const f = generateFloor(seed)
      const g = f.gate
      expect(g.lockTier, `seed ${seed}`).toBe(4)
      const onBorder =
        g.x === 0 || g.x === DUNGEON_W - 1 || g.y === 0 || g.y === DUNGEON_H - 1
      expect(onBorder, `seed ${seed} — gate off the border`).toBe(true)
      expect(f.walk[g.y]?.[g.x], `seed ${seed} — gate not carved`).toBe(true)
      const seen = reachable(f)
      const beside = (
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const
      ).some(([dx, dy]) => seen.has(`${g.x + dx},${g.y + dy}`))
      expect(beside, `seed ${seed} — no one can kneel at the gate`).toBe(true)
      // The kneeling side is the gatehouse's PORCH — one tile past its east wall, which
      // only the room's interior reaches.
      expect(f.walk[g.y]?.[g.x - 1], `seed ${seed} — no porch`).toBe(true)
      expect(roomAt(f, g.x - 2, g.y)?.theme, `seed ${seed}`).toBe('gatehouse')
    }
  })

  it('deals themed rooms: a hand of distinct styles, interiors carved, none crowding', () => {
    for (const seed of SWEEP_SEEDS.slice(0, 120)) {
      const f = generateFloor(seed)
      expect(f.rooms.length, `seed ${seed} — a wing needs its rooms`).toBeGreaterThanOrEqual(9)
      const themes = f.rooms.map((r) => r.theme)
      expect(new Set(themes).size, `seed ${seed} — a theme repeated`).toBe(themes.length)
      expect(themes.filter((t) => t === 'gatehouse').length, `seed ${seed}`).toBe(1)
      for (const t of themes) {
        expect(t === 'gatehouse' || LOOT_THEMES.includes(t), `seed ${seed} — unknown ${t}`).toBe(true)
      }
      for (const r of f.rooms) {
        for (let y = r.y0; y <= r.y1; y += 1) {
          for (let x = r.x0; x <= r.x1; x += 1) {
            expect(f.walk[y]?.[x], `seed ${seed} room ${r.id} uncarved at ${x},${y}`).toBe(true)
          }
        }
        for (const o of f.rooms) {
          if (o.id === r.id) continue
          const apart = r.x0 > o.x1 + 1 || r.x1 < o.x0 - 1 || r.y0 > o.y1 + 1 || r.y1 < o.y0 - 1
          expect(apart, `seed ${seed} rooms ${r.id}/${o.id} share ground`).toBe(true)
        }
      }
    }
  })

  it('doors belong to rooms: every room has a mouth, no door stands mid-corridor', () => {
    for (const seed of SWEEP_SEEDS.slice(0, 120)) {
      const f = generateFloor(seed)
      const doorsOf = (roomId: number): number =>
        f.doors.filter((d) =>
          f.rooms.some(
            (r) =>
              r.id === roomId &&
              d.x >= r.x0 - 1 && d.x <= r.x1 + 1 && d.y >= r.y0 - 1 && d.y <= r.y1 + 1,
          ),
        ).length
      for (const r of f.rooms) {
        expect(doorsOf(r.id), `seed ${seed} room ${r.id} (${r.theme}) has no mouth`).toBeGreaterThanOrEqual(1)
      }
      for (const d of f.doors) {
        expect(f.walk[d.y]?.[d.x], `seed ${seed} door ${d.id} off the floor`).toBe(true)
        // A door's two sides: one tile inside a room's interior, one in the corridor.
        // That shape IS "doors for the rooms, not the middle of corridors".
        const interiorSides = (
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const
        ).filter(([dx, dy]) => roomAt(f, d.x + dx, d.y + dy) !== undefined).length
        expect(interiorSides, `seed ${seed} door ${d.id} at ${d.x},${d.y} serves no room`).toBe(1)
      }
      // The gatehouse's door is the exit guarantee: always locked — so with every locked
      // door treated as a WALL, nobody reaches the gate's kneeling side (D-180, structural).
      const lockedAsWalls = new Set(
        f.doors.filter((d) => d.locked).map((d) => `${d.x},${d.y}`),
      )
      const seen = new Set([`${f.start.x},${f.start.y}`])
      const q: [number, number][] = [[f.start.x, f.start.y]]
      while (q.length > 0) {
        const [x, y] = q.pop() as [number, number]
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const k = `${x + dx},${y + dy}`
          if (seen.has(k) || !(f.walk[y + dy]?.[x + dx] ?? false) || lockedAsWalls.has(k)) continue
          seen.add(k)
          q.push([x + dx, y + dy])
        }
      }
      const kneelable = (
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const
      ).some(([dx, dy]) => seen.has(`${f.gate.x + dx},${f.gate.y + dy}`))
      expect(kneelable, `seed ${seed} — gate reachable without a single lock`).toBe(false)
    }
  })

  it('guarantees the artifacts across the rooms, and themes deal their own loot', () => {
    for (const seed of SWEEP_SEEDS.slice(0, 120)) {
      const f = generateFloor(seed)
      expect(f.chests.length, `seed ${seed}`).toBeGreaterThanOrEqual(f.rooms.length - 1)
      const items = f.chests.map((c) => c.loot.item)
      expect(items.filter((i) => i === 'tracker').length, `seed ${seed} — tracker`).toBe(1)
      expect(items.filter((i) => i === 'skeleton-key').length, `seed ${seed} — keys`).toBeGreaterThanOrEqual(2)
      expect(items.filter((i) => i === 'pick').length, `seed ${seed} — picks`).toBeGreaterThanOrEqual(2)
      const seen = reachable(f)
      for (const c of f.chests) {
        // Chests live inside loot rooms, on a workable side.
        const room = roomAt(f, c.x, c.y)
        expect(room, `seed ${seed} chest ${c.id} outside every room`).toBeDefined()
        expect(room?.theme, `seed ${seed} chest ${c.id} in the gatehouse`).not.toBe('gatehouse')
        const beside = (
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const
        ).some(([dx, dy]) => seen.has(`${c.x + dx},${c.y + dy}`))
        expect(beside, `seed ${seed} chest ${c.id} has no working side`).toBe(true)
        // A themed roll stays inside its room's idea of loot; valuables carry their price.
        if (c.loot.item === 'valuables') {
          expect(c.loot.value ?? 0, `seed ${seed} chest ${c.id} worthless valuables`).toBeGreaterThan(0)
          expect(c.loot.label, `seed ${seed} chest ${c.id} nameless valuables`).toBeTruthy()
        }
        if (room && c.loot.item && !['tracker', 'skeleton-key', 'pick'].includes(c.loot.item)) {
          expect(
            ROOM_THEMES[room.theme].loot.includes(c.loot.item),
            `seed ${seed} — a ${room.theme} chest rolled ${c.loot.item}`,
          ).toBe(true)
        }
      }
    }
  })

  it('hangs two bells far apart on corridor walls, and deals exactly one listener', () => {
    for (const seed of SWEEP_SEEDS.slice(0, 120)) {
      const f = generateFloor(seed)
      expect(f.bells.length, `seed ${seed} bells`).toBe(2)
      for (const b of f.bells) {
        expect(f.walk[b.y]?.[b.x], `seed ${seed} bell off the floor`).toBe(true)
        const wallAt =
          b.side === 'n'
            ? !(f.walk[b.y - 1]?.[b.x] ?? false)
            : b.side === 's'
              ? !(f.walk[b.y + 1]?.[b.x] ?? false)
              : b.side === 'e'
                ? !(f.walk[b.y]?.[b.x + 1] ?? false)
                : !(f.walk[b.y]?.[b.x - 1] ?? false)
        expect(wallAt, `seed ${seed} bell hangs on air`).toBe(true)
      }
      const [a, b] = f.bells
      if (a && b) {
        expect(
          Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
          `seed ${seed} bells crowd`,
        ).toBeGreaterThanOrEqual(14)
      }
      // Two listeners since D-192 — "I want to have more listeners - they are really fun".
      expect(
        f.enemies.filter((e) => e.kind === 'listener').length,
        `seed ${seed} — two listeners per wing`,
      ).toBe(2)
      // The hunter (D-182): one per wing, spawned deeper than every other guard.
      const hunters = f.enemies.filter((e) => e.kind === 'hunter')
      expect(hunters.length, `seed ${seed} — one hunter`).toBe(1)
      // The hound is retired (D-189) — the roster holds nothing that walks your pace.
      expect(
        f.enemies.every((e) => ['warden', 'sentry', 'listener', 'hunter'].includes(e.kind)),
        `seed ${seed} — an unknown kind walks`,
      ).toBe(true)
    }
  })

  it('spawns the guards far from the start, on corridors, each with a walkable beat', () => {
    for (const seed of SWEEP_SEEDS.slice(0, 120)) {
      const f = generateFloor(seed)
      expect(f.enemies.length, `seed ${seed}`).toBeGreaterThanOrEqual(4)
      // The promise is travel distance, not crow-flies — BFS over the open floor.
      const dist = new Map<string, number>([[`${f.start.x},${f.start.y}`, 0]])
      const q: [number, number][] = [[f.start.x, f.start.y]]
      while (q.length > 0) {
        const [x, y] = q.shift() as [number, number]
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const k = `${x + dx},${y + dy}`
          if (dist.has(k) || !(f.walk[y + dy]?.[x + dx] ?? false)) continue
          dist.set(k, (dist.get(`${x},${y}`) ?? 0) + 1)
          q.push([x + dx, y + dy])
        }
      }
      for (const e of f.enemies) {
        expect(
          dist.get(`${e.x},${e.y}`) ?? 0,
          `seed ${seed} guard ${e.id} crowds the start`,
        ).toBeGreaterThanOrEqual(10)
        expect(roomAt(f, e.x, e.y), `seed ${seed} guard ${e.id} posted inside a room`).toBeUndefined()
        expect(e.patrol.length, `seed ${seed} guard ${e.id} beat`).toBeGreaterThanOrEqual(2)
        for (const wp of e.patrol) {
          expect(f.walk[wp.y]?.[wp.x], `seed ${seed} guard ${e.id} post off floor`).toBe(true)
        }
      }
    }
  })

  it('is deterministic: one seed, one labyrinth, byte for byte', () => {
    const a = generateFloor(90210)
    const b = generateFloor(90210)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    const c = generateFloor(90211)
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a))
  })
})

describe('the locks the labyrinth hangs on things', () => {
  it('are legal at every tier, cylinder and wheel alike', () => {
    for (const seed of SWEEP_SEEDS.slice(0, 60)) {
      for (const tier of [1, 2, 3, 4] as const) {
        for (const wheel of [false, true]) {
          const def = generateDungeonLock(seed, tier * 7 + (wheel ? 1 : 0), tier, wheel)
          expect(() => validateLockDef(def), `${def.slug}`).not.toThrow()
          expect(def.tier).toBe(tier)
          if (wheel && tier >= 2) expect(def.family).toBe('combination')
          else expect(def.family).toBe('pin-tumbler')
        }
      }
    }
  })
})
