/**
 * The labyrinth's turn machine — every promise in `docs/DUNGEON.md` as a transition test
 * (D-177). The screens may only ever call these functions, so what holds here holds in play.
 *
 * The floors here are hand-built, the way the sim's fixtures are: a machine test wants a
 * guard *exactly there*, and hunting generated seeds for arrangements is a flake factory.
 */

import { describe, expect, it } from 'vitest'
import type {
  DungeonChestDef,
  DungeonDoorDef,
  DungeonEnemyDef,
  DungeonFloor,
} from '../../src/game/dungeon'
import {
  ENEMY_ORDER,
  ENEMY_STATS,
  ESCAPE_BASE,
  NOISE_RADIUS,
  START_PICKS,
  canPick,
  dungeonScore,
  giveUpRange,
  movePlayer,
  pickAbandoned,
  pickOpened,
  pickSnapped,
  pickTheLock,
  pickTick,
  startDungeon,
  stepBack,
  trackerNear,
  useKey,
  waitTurn,
  worldTurn,
  type DungeonRunState,
} from '../../src/game/dungeonRun'

/** A 16x9 hall: border walls, everything else floor. Entrance mid-left, start beside it. */
function makeFloor(patch: {
  chests?: DungeonChestDef[]
  doors?: DungeonDoorDef[]
  enemies?: DungeonEnemyDef[]
  walls?: [number, number][]
  gate?: { x: number; y: number; lockTier: 4; wheel: boolean }
}): DungeonFloor {
  const w = 16
  const h = 9
  const walk = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => x > 0 && x < w - 1 && y > 0 && y < h - 1),
  )
  for (const [x, y] of patch.walls ?? []) (walk[y] as boolean[])[x] = false
  ;(walk[4] as boolean[])[0] = true // the barred way in
  return {
    seed: 1,
    w,
    h,
    walk,
    chambers: [],
    doors: patch.doors ?? [],
    chests: patch.chests ?? [],
    enemies: patch.enemies ?? [],
    props: [],
    // Far corner unless a test moves it — off every walking route the suite uses.
    gate: patch.gate ?? { x: 14, y: 1, lockTier: 4, wheel: false },
    entrance: { x: 0, y: 4 },
    start: { x: 1, y: 4 },
  }
}

function makeRun(patch: Parameters<typeof makeFloor>[0]): DungeonRunState {
  const s = startDungeon(1)
  // Swap the generated floor for the fixture, re-deriving the dependent state the same way
  // `startDungeon` does — the machine functions only ever see this shape.
  const floor = makeFloor(patch)
  return {
    ...s,
    floor,
    player: { ...s.player, x: floor.start.x, y: floor.start.y },
    enemies: floor.enemies.map((e) => ({
      id: e.id,
      kind: e.kind,
      x: e.x,
      y: e.y,
      awake: false,
      facing: 'w' as const,
      lastSeen: 0,
      patrol: e.patrol,
      wpIndex: 0,
    })),
    doorOpen: floor.doors.map(() => false),
    chestOpen: floor.chests.map(() => false),
  }
}

const CHEST = (over: Partial<DungeonChestDef>): DungeonChestDef => ({
  id: 0,
  x: 3,
  y: 4,
  locked: false,
  lockTier: 1,
  wheel: false,
  loot: { item: null },
  style: 0,
  ...over,
})

/** A fixture guard — post-less unless the test hands it a beat. */
const GUARD = (
  kind: DungeonEnemyDef['kind'],
  x: number,
  y: number,
  patrol: { x: number; y: number }[] = [{ x, y }],
): DungeonEnemyDef => ({ id: 0, kind, x, y, patrol })

describe('the crawl', () => {
  it('moves on floor, refuses walls, and every real step costs the world a turn', () => {
    const s = makeRun({})
    movePlayer(s, 1, 0)
    expect([s.player.x, s.player.y]).toEqual([2, 4])
    expect(s.turn).toBe(1)
    movePlayer(s, 0, -1)
    movePlayer(s, 0, -1)
    movePlayer(s, 0, -1)
    expect(s.player.y).toBe(1)
    movePlayer(s, 0, -1) // the border wall
    expect(s.player.y).toBe(1)
    expect(s.turn, 'a refused bump must not cost a turn').toBe(4)
  })

  it('the one hero: two picks, no keys, no tracker, quick feet', () => {
    const s = startDungeon(1)
    expect(s.player.picks).toBe(START_PICKS)
    expect(s.player.keys).toBe(0)
    expect(s.player.tracker).toBe(false)
  })

  it('a guard is a wall with eyes: bumping one moves nothing and costs nothing', () => {
    const s = makeRun({ enemies: [GUARD('warden', 2, 4)] })
    movePlayer(s, 1, 0)
    expect([s.player.x, s.player.y], 'nobody dies here — and nobody budges').toEqual([1, 4])
    expect(s.turn).toBe(0)
  })
})

describe('chests and artifacts', () => {
  it('an unlocked chest gives its artifact: pick, key, tracker — or nothing', () => {
    const s = makeRun({
      chests: [
        CHEST({ id: 0, x: 2, y: 4, loot: { item: 'skeleton-key' } }),
        CHEST({ id: 1, x: 2, y: 3, loot: { item: 'tracker' } }),
        CHEST({ id: 2, x: 2, y: 5, loot: { item: 'pick' } }),
      ],
    })
    movePlayer(s, 1, 0)
    expect(s.player.keys).toBe(1)
    movePlayer(s, 0, -1)
    movePlayer(s, 1, 0)
    expect(s.player.tracker).toBe(true)
    movePlayer(s, 0, 1)
    movePlayer(s, 0, 1)
    movePlayer(s, 1, 0)
    expect(s.player.picks).toBe(START_PICKS + 1)
  })

  it('a locked chest with no key kneels straight into the pick', () => {
    const s = makeRun({ chests: [CHEST({ id: 0, x: 2, y: 4, locked: true, lockTier: 2 })] })
    movePlayer(s, 1, 0)
    expect(s.phase).toBe('picking')
    expect(s.picking).toEqual({ kind: 'chest', id: 0 })
    pickAbandoned(s)
    expect(s.phase).toBe('crawl')
    // A snapped pick is a spent pick and a still-shut chest.
    s.player.picks = 1
    movePlayer(s, 1, 0)
    pickSnapped(s)
    expect(s.player.picks).toBe(0)
    expect(canPick(s)).toBe(false)
    // The open pays out.
    s.player.picks = 1
    movePlayer(s, 1, 0)
    pickOpened(s)
    expect(s.phase).toBe('crawl')
    expect(s.chestOpen[0]).toBe(true)
  })

  it('a carried key poses the choice: use it, pick anyway, or step back', () => {
    const s = makeRun({
      chests: [CHEST({ id: 0, x: 2, y: 4, locked: true, loot: { item: 'tracker' } })],
    })
    s.player.keys = 1
    movePlayer(s, 1, 0)
    expect(s.phase).toBe('unlock')
    stepBack(s)
    expect(s.phase).toBe('crawl')
    expect(s.player.keys, 'stepping back spends nothing').toBe(1)
    movePlayer(s, 1, 0)
    pickTheLock(s)
    expect(s.phase, 'choosing the pick hands over to the lock screen').toBe('picking')
    pickAbandoned(s)
    movePlayer(s, 1, 0)
    useKey(s)
    expect(s.player.keys).toBe(0)
    expect(s.chestOpen[0]).toBe(true)
    expect(s.player.tracker, 'the key opens the chest properly').toBe(true)
    expect(s.phase).toBe('crawl')
  })
})

describe('doors and the gate', () => {
  it('every door is locked: kneel, open, walk through', () => {
    const s = makeRun({
      doors: [{ id: 0, x: 3, y: 4, locked: true, lockTier: 2, wheel: false }],
    })
    movePlayer(s, 1, 0)
    movePlayer(s, 1, 0)
    expect(s.phase).toBe('picking')
    pickOpened(s)
    expect(s.doorOpen[0]).toBe(true)
    movePlayer(s, 1, 0)
    expect(s.player.x).toBe(3)
  })

  it('the GATE: pick it open and the run is won at speed', () => {
    const s = makeRun({ gate: { x: 2, y: 4, lockTier: 4, wheel: false } })
    movePlayer(s, 1, 0)
    expect(s.phase).toBe('picking')
    expect(s.picking).toEqual({ kind: 'gate', id: 0 })
    pickOpened(s)
    expect(s.phase).toBe('won')
    expect(dungeonScore(s)).toBe(ESCAPE_BASE - s.turn * 2)
    movePlayer(s, 1, 0)
    expect(s.phase, 'a won run ignores further verbs').toBe('won')
  })

  it('a skeleton key turns the gate itself', () => {
    const s = makeRun({ gate: { x: 2, y: 4, lockTier: 4, wheel: false } })
    s.player.keys = 1
    movePlayer(s, 1, 0)
    expect(s.phase).toBe('unlock')
    useKey(s)
    expect(s.phase).toBe('won')
    expect(s.player.keys).toBe(0)
  })

  it('an unfinished run scores nothing — the score is the escape, priced by turns', () => {
    const s = makeRun({})
    movePlayer(s, 1, 0)
    expect(dungeonScore(s)).toBe(0)
  })
})

describe('the guards', () => {
  it('walks its beat while nothing has alerted it, and turns at the posts', () => {
    // A hound patroller (full pace); the player walled into the top-left pocket.
    const s = makeRun({
      enemies: [GUARD('hound', 4, 7, [{ x: 4, y: 7 }, { x: 12, y: 7 }])],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    s.player.x = 1
    s.player.y = 1
    const at = (): [number, number] => [s.enemies[0]?.x ?? 0, s.enemies[0]?.y ?? 0]
    worldTurn(s)
    expect(at()).toEqual([5, 7])
    for (let i = 0; i < 7; i += 1) worldTurn(s)
    expect(at(), 'arrived at the far post').toEqual([12, 7])
    worldTurn(s)
    expect(at(), 'and turned around').toEqual([11, 7])
    expect(s.enemies[0]?.awake).toBe(false)
  })

  it('sees you inside its cone and line of sight, and says so', () => {
    const s = makeRun({ enemies: [GUARD('hound', 6, 4)] })
    worldTurn(s) // dist 5 ≤ vision 6, facing west down the open hall
    expect(s.enemies[0]?.awake).toBe(true)
    expect(s.log.some((l) => l.includes('hound sees you'))).toBe(true)
  })

  it('the cone is the sight: behind and beside a guard is blind, arm’s reach is not', () => {
    // Facing EAST, player due west at distance 5: inside radius, outside the cone.
    const behind = makeRun({ enemies: [GUARD('hound', 6, 4)] })
    behind.enemies[0]!.facing = 'e'
    worldTurn(behind)
    expect(behind.enemies[0]?.awake, 'behind its back — unseen').toBe(false)
    // Beside: facing north, player west — the quadrant excludes it.
    const beside = makeRun({ enemies: [GUARD('hound', 6, 4)] })
    beside.enemies[0]!.facing = 'n'
    worldTurn(beside)
    expect(beside.enemies[0]?.awake, 'off the quadrant — unseen').toBe(false)
    // Arm's reach ignores facing entirely.
    const close = makeRun({ enemies: [GUARD('hound', 2, 4)] })
    close.enemies[0]!.facing = 'e'
    worldTurn(close)
    expect(close.enemies[0]?.awake, 'one tile away — nobody is that quiet').toBe(true)
    // The diagonal edge of the quadrant counts as inside.
    const edge = makeRun({ enemies: [GUARD('hound', 5, 8)] })
    edge.enemies[0]!.facing = 'w'
    edge.player.x = 1
    edge.player.y = 4
    worldTurn(edge)
    expect(edge.enemies[0]?.awake, 'the cone edge (|dy| == |dx|) is inside').toBe(true)
  })

  it('facing follows the feet: a patroller looks where it walks', () => {
    const s = makeRun({
      enemies: [GUARD('hound', 4, 7, [{ x: 4, y: 7 }, { x: 12, y: 7 }])],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    s.player.x = 1
    s.player.y = 1
    s.enemies[0]!.facing = 'n'
    worldTurn(s) // steps east along the beat
    expect(s.enemies[0]?.facing).toBe('e')
    for (let i = 0; i < 7; i += 1) worldTurn(s) // to the far post
    worldTurn(s) // turns around
    expect(s.enemies[0]?.facing).toBe('w')
  })

  it('chases while close, gives up past 1.5× its sight, and resumes the beat', () => {
    const s = makeRun({
      enemies: [GUARD('hound', 6, 4, [{ x: 6, y: 4 }, { x: 10, y: 4 }])],
    })
    worldTurn(s)
    expect(s.enemies[0]?.awake).toBe(true)
    const before = s.enemies[0]?.x ?? 0
    worldTurn(s)
    expect(s.enemies[0]?.x ?? 0, 'a chaser closes').toBeLessThan(before)
    // Teleport the player beyond the give-up range: the chase breaks by DISTANCE.
    s.player.x = 1
    s.player.y = 1
    const e = s.enemies[0]
    if (e) {
      e.x = 14
      e.y = 7
    }
    expect(giveUpRange('hound')).toBe(9)
    worldTurn(s)
    expect(s.enemies[0]?.awake, 'past 1.5 sights it loses you').toBe(false)
    expect(s.log.some((l) => l.includes('loses you'))).toBe(true)
  })

  it('a chase also breaks by MEMORY: unseen for six turns, it gives up wherever you are', () => {
    // The player slips into the sealed pocket; the hound stands close outside it — well
    // inside give-up DISTANCE, but the walls blind it, and blindness has a clock now.
    const s = makeRun({
      enemies: [GUARD('hound', 5, 2, [{ x: 5, y: 2 }, { x: 9, y: 2 }])],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    s.player.x = 1
    s.player.y = 1
    const e = s.enemies[0]!
    e.awake = true
    e.lastSeen = 0
    for (let i = 0; i < 6; i += 1) worldTurn(s)
    expect(e.awake, 'still remembering').toBe(true)
    worldTurn(s) // the seventh unseen turn — memory runs out
    expect(e.awake, 'six turns unseen — it gives up in place').toBe(false)
    expect(s.log.some((l) => l.includes('loses you'))).toBe(true)
  })

  it('one hand on you ends the run — caught, banked nothing', () => {
    const s = makeRun({ enemies: [GUARD('hound', 3, 4)] })
    s.enemies[0]!.awake = true
    s.enemies[0]!.lastSeen = 0
    worldTurn(s) // steps to (2,4)
    expect(s.phase).toBe('crawl')
    worldTurn(s) // steps onto you
    expect(s.phase).toBe('caught')
    expect(dungeonScore(s)).toBe(0)
  })

  it("arm's reach is enough while you kneel at a lock", () => {
    const s = makeRun({
      chests: [CHEST({ id: 0, x: 2, y: 4, locked: true })],
      enemies: [GUARD('hound', 6, 4)],
    })
    s.enemies[0]!.awake = true
    s.enemies[0]!.lastSeen = 0
    movePlayer(s, 1, 0)
    expect(s.phase).toBe('picking')
    for (let i = 0; i < 6 && s.phase === 'picking'; i += 1) pickTick(s)
    expect(s.phase).toBe('caught')
    expect(s.picking).toBeNull()
  })

  it('the owner’s speed table: hound your pace, warden and sentry every other turn', () => {
    const hound = makeRun({ enemies: [GUARD('hound', 9, 4)] })
    hound.enemies[0]!.awake = true
    hound.enemies[0]!.lastSeen = 0
    worldTurn(hound)
    expect(hound.enemies[0]?.x, 'one stride a turn — your pace').toBe(8)
    const sentry = makeRun({
      enemies: [GUARD('sentry', 9, 4, [{ x: 9, y: 4 }, { x: 5, y: 4 }])],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    sentry.player.x = 1
    sentry.player.y = 1
    worldTurn(sentry) // odd turn — the sentry rests
    expect(sentry.enemies[0]?.x).toBe(9)
    worldTurn(sentry) // even turn — it moves
    expect(sentry.enemies[0]?.x).toBe(8)
    const warden = makeRun({
      enemies: [GUARD('warden', 9, 4, [{ x: 9, y: 4 }, { x: 5, y: 4 }])],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    warden.player.x = 1
    warden.player.y = 1
    worldTurn(warden) // odd turn — the warden rests too
    expect(warden.enemies[0]?.x).toBe(9)
    worldTurn(warden)
    expect(warden.enemies[0]?.x).toBe(8)
  })

  it('a snapped pick rings: guards within earshot turn your way, beyond it stay on beat', () => {
    const s = makeRun({
      chests: [CHEST({ id: 0, x: 2, y: 4, locked: true })],
      enemies: [GUARD('warden', 6, 4), { ...GUARD('sentry', 13, 7), id: 1 }],
    })
    // The near warden faces AWAY — its cone cannot wake it, so only the RING can.
    s.enemies[0]!.facing = 'e'
    movePlayer(s, 1, 0)
    expect(s.phase).toBe('picking')
    pickSnapped(s)
    expect(NOISE_RADIUS).toBe(8)
    expect(s.enemies[0]?.awake, 'in earshot — woken').toBe(true)
    expect(s.enemies[1]?.awake, 'beyond earshot — not').toBe(false)
    expect(s.log.some((l) => l.includes('rings'))).toBe(true)
  })

  it('the bestiary: three kinds, distinct letters, the owner’s speed and sight tables', () => {
    expect(ENEMY_ORDER.length).toBe(Object.keys(ENEMY_STATS).length)
    const letters = ENEMY_ORDER.map((k) => ENEMY_STATS[k].letter)
    expect(new Set(letters).size).toBe(letters.length)
    // Speeds: warden 0.5, hound 1, sentry 0.5 — nobody outruns the player.
    expect(ENEMY_STATS.warden.slow).toBe(true)
    expect(ENEMY_STATS.hound.slow || ENEMY_STATS.hound.fast).toBe(false)
    expect(ENEMY_STATS.sentry.slow).toBe(true)
    // Sights: warden 3, hound 6, sentry 10.
    expect(ENEMY_STATS.warden.vision).toBe(3)
    expect(ENEMY_STATS.hound.vision).toBe(6)
    expect(ENEMY_STATS.sentry.vision).toBe(10)
  })
})

describe('the motion tracker', () => {
  it('whispers only when carried, and only within its reach', () => {
    const s = makeRun({ enemies: [GUARD('warden', 6, 4), { ...GUARD('hound', 14, 7), id: 1 }] })
    expect(trackerNear(s), 'no tracker, no whisper').toBe(0)
    s.player.tracker = true
    expect(trackerNear(s), 'the warden at 5 is inside reach 6; the hound at 13 is not').toBe(1)
  })
})

describe('waiting', () => {
  it('burns a turn on purpose — the verb patrol-reading runs on', () => {
    const s = makeRun({})
    waitTurn(s)
    expect(s.turn).toBe(1)
  })
})
