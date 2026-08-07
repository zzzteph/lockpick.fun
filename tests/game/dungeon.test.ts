/**
 * The labyrinth generator — `docs/DUNGEON.md`, swept the way every dealer here is (D-177).
 *
 * What has to be true of every labyrinth it can ever deal: the maze is connected and
 * braided, the GATE stands on the border with a reachable kneeling side, the doors bar
 * straight halls, the artifacts all exist (picks, keys, the tracker), the guards spawn far
 * from the start with walkable beats, and the same seed always deals the same bytes.
 */

import { describe, expect, it } from 'vitest'
import {
  DUNGEON_H,
  DUNGEON_W,
  generateFloor,
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
            loops += 1 // a 2×2 open block only exists where loops or chambers do
          }
        }
      }
      expect(loops, `seed ${seed} — no loops, pure tree`).toBeGreaterThan(0)
    }
  })

  it('hangs the GATE on the border, hardest lock, kneelable', () => {
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
    }
  })

  it('bars straight halls with locked doors, spaced out, never in chambers', () => {
    for (const seed of SWEEP_SEEDS.slice(0, 120)) {
      const f = generateFloor(seed)
      expect(f.doors.length, `seed ${seed}`).toBeGreaterThanOrEqual(5)
      for (const d of f.doors) {
        expect(d.locked, `seed ${seed} door ${d.id}`).toBe(true)
        expect(f.walk[d.y]?.[d.x], `seed ${seed} door ${d.id} off the floor`).toBe(true)
        const h =
          (f.walk[d.y]?.[d.x - 1] ?? false) &&
          (f.walk[d.y]?.[d.x + 1] ?? false) &&
          !(f.walk[d.y - 1]?.[d.x] ?? false) &&
          !(f.walk[d.y + 1]?.[d.x] ?? false)
        const v =
          (f.walk[d.y - 1]?.[d.x] ?? false) &&
          (f.walk[d.y + 1]?.[d.x] ?? false) &&
          !(f.walk[d.y]?.[d.x - 1] ?? false) &&
          !(f.walk[d.y]?.[d.x + 1] ?? false)
        expect(h || v, `seed ${seed} door ${d.id} not in a straight hall`).toBe(true)
        for (const o of f.doors) {
          if (o.id === d.id) continue
          expect(
            Math.abs(o.x - d.x) + Math.abs(o.y - d.y),
            `seed ${seed} doors ${d.id}/${o.id} crowd`,
          ).toBeGreaterThanOrEqual(5)
        }
        for (const c of f.chambers) {
          expect(
            Math.abs(c.x - d.x) > 2 || Math.abs(c.y - d.y) > 2,
            `seed ${seed} door ${d.id} inside a chamber`,
          ).toBe(true)
        }
      }
    }
  })

  it('guarantees the artifacts: a tracker, two keys, two picks, one chest per chamber', () => {
    for (const seed of SWEEP_SEEDS.slice(0, 120)) {
      const f = generateFloor(seed)
      expect(f.chambers.length, `seed ${seed}`).toBe(5)
      expect(f.chests.length, `seed ${seed}`).toBe(5)
      const items = f.chests.map((c) => c.loot.item)
      expect(items.filter((i) => i === 'tracker').length, `seed ${seed} — tracker`).toBe(1)
      expect(items.filter((i) => i === 'skeleton-key').length, `seed ${seed} — keys`).toBe(2)
      expect(items.filter((i) => i === 'pick').length, `seed ${seed} — picks`).toBe(2)
      const seen = reachable(f)
      for (const c of f.chests) {
        const beside = (
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const
        ).some(([dx, dy]) => seen.has(`${c.x + dx},${c.y + dy}`))
        expect(beside, `seed ${seed} chest ${c.id} has no working side`).toBe(true)
      }
    }
  })

  it('spawns the guards far from the start, each with a walkable beat', () => {
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
