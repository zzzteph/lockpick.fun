/**
 * The labyrinth's REAL-TIME machine — every promise in `docs/DUNGEON.md` as a transition
 * test (D-177, retimed by D-180). The screens may only ever call these functions, so what
 * holds here holds in play.
 *
 * The floors here are hand-built, the way the sim's fixtures are: a machine test wants a
 * guard *exactly there*, and hunting generated seeds for arrangements is a flake factory.
 * Time is driven by hand through `advance()` — one PLAYER_STEP_S per player stride, which
 * is exactly the cadence the app's frame loop settles into.
 */

import { describe, expect, it } from 'vitest'
import type {
  DungeonChestDef,
  DungeonDoorDef,
  DungeonEnemyDef,
  DungeonFloor,
  DungeonPropDef,
  DungeonRoomDef,
} from '../../src/game/dungeon'
import {
  CHASE_MEMORY_S,
  ENEMY_ORDER,
  ENEMY_PACE_FACTOR,
  ENEMY_STATS,
  ESCAPE_BASE,
  HUNTER_FIX_S,
  HUNTER_STEP_FACTOR,
  LAMP_OIL_CAP,
  MAX_FRAME_S,
  STARTLE_S,
  NOISE_RADIUS,
  PLAYER_STEP_S,
  QUIET_LISTEN_RADIUS,
  SCORE_PER_SECOND,
  SLOW_STEP_S,
  START_PICKS,
  TONIC_STUN_S,
  VISION_RADIUS,
  advance,
  canPick,
  dungeonScore,
  enemyStepSeconds,
  footsteps,
  giveUpRange,
  lampRadius,
  movePlayer,
  pickAbandoned,
  pickOpened,
  pickSnapped,
  pickTheLock,
  startDungeon,
  stepBack,
  torchLit,
  trackerNear,
  useKey,
  type DungeonRunState,
} from '../../src/game/dungeonRun'

/** A 16x9 hall: border walls, everything else floor. Entrance mid-left, start beside it. */
function makeFloor(patch: {
  chests?: DungeonChestDef[]
  doors?: DungeonDoorDef[]
  enemies?: DungeonEnemyDef[]
  walls?: [number, number][]
  gate?: { x: number; y: number; lockTier: 4; wheel: boolean }
  bells?: { x: number; y: number; side: 'n' | 'e' | 's' | 'w' }[]
  rooms?: DungeonRoomDef[]
  props?: DungeonPropDef[]
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
    rooms: patch.rooms ?? [],
    doors: patch.doors ?? [],
    chests: patch.chests ?? [],
    enemies: patch.enemies ?? [],
    props: patch.props ?? [],
    bells: patch.bells ?? [],
    // Far corner unless a test moves it — off every walking route the suite uses.
    gate: patch.gate ?? { x: 14, y: 1, lockTier: 4, wheel: false },
    entrance: { x: 0, y: 4 },
    start: { x: 1, y: 4 },
  }
}

function makeRun(patch: Parameters<typeof makeFloor>[0]): DungeonRunState {
  const s = startDungeon(1)
  // Swap the generated floor for the fixture, re-deriving the dependent state the same way
  // `startDungeon` does — except `scan: 0`: fixture guards walk on cue, and the post-sweep
  // has its own test.
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
      pace: 0,
      scan: 0,
      keyring: false,
      bellTarget: null,
      hunt: null,
    })),
    doorOpen: floor.doors.map((d) => !d.locked),
    chestOpen: floor.chests.map(() => false),
    roomSeen: floor.rooms.map(() => false),
    treasure: 0,
    alarmUntil: 0,
    bellRung: (patch.bells ?? []).map(() => false),
    playerOpened: (patch.doors ?? []).map(() => false),
  }
}

/** A player stride at the app's cadence: the move, then the stride's worth of clock. */
function step(s: DungeonRunState, dx: number, dy: number): void {
  movePlayer(s, dx, dy)
  advance(s, PLAYER_STEP_S)
}

/** Feed the clock in frame-sized bites — a stride can outsize MAX_FRAME_S since D-185. */
function give(s: DungeonRunState, seconds: number): void {
  let left = seconds
  while (left > 1e-9) {
    const d = Math.min(left, MAX_FRAME_S)
    advance(s, d)
    left -= d
  }
}

/** One sentry-stride of world time — the fixture suite's "one turn" (hound retired, D-189). */
function beat(s: DungeonRunState): void {
  give(s, enemyStepSeconds('sentry'))
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
  it('moves on floor, refuses walls, and never touches the clock by itself', () => {
    const s = makeRun({})
    movePlayer(s, 1, 0)
    expect([s.player.x, s.player.y]).toEqual([2, 4])
    expect(s.time, 'a step is not a clock — only advance() moves time').toBe(0)
    advance(s, PLAYER_STEP_S)
    movePlayer(s, 0, -1)
    advance(s, PLAYER_STEP_S)
    movePlayer(s, 0, -1)
    advance(s, PLAYER_STEP_S)
    movePlayer(s, 0, -1)
    expect(s.player.y).toBe(1)
    movePlayer(s, 0, -1) // the border wall
    expect(s.player.y).toBe(1)
  })

  it('strides are paced: a second step inside PLAYER_STEP_S is refused', () => {
    const s = makeRun({})
    movePlayer(s, 1, 0)
    movePlayer(s, 1, 0)
    expect(s.player.x, 'no clock between them — the second call is not a stride').toBe(2)
    advance(s, PLAYER_STEP_S)
    movePlayer(s, 1, 0)
    expect(s.player.x).toBe(3)
  })

  it('the one hero: two picks, no keys, no tracker, quick feet', () => {
    const s = startDungeon(1)
    expect(s.player.picks).toBe(START_PICKS)
    expect(s.player.keys).toBe(0)
    expect(s.player.tracker).toBe(false)
  })

  it('a guard is a wall with eyes: bumping one moves nothing and spends no stride', () => {
    const s = makeRun({ enemies: [GUARD('warden', 2, 4)] })
    movePlayer(s, 1, 0)
    expect([s.player.x, s.player.y], 'nobody dies here — and nobody budges').toEqual([1, 4])
    // The refusal did not stamp the stride timer: a real step is still owed at once.
    movePlayer(s, 0, -1)
    expect(s.player.y).toBe(3)
  })

  it('the clock never swallows more than MAX_FRAME_S in one call', () => {
    const s = makeRun({})
    advance(s, 60)
    expect(s.time).toBe(MAX_FRAME_S)
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
    step(s, 1, 0)
    expect(s.player.keys).toBe(1)
    step(s, 0, -1)
    step(s, 1, 0)
    expect(s.player.tracker).toBe(true)
    step(s, 0, 1)
    step(s, 0, 1)
    step(s, 1, 0)
    expect(s.player.picks).toBe(START_PICKS + 1)
  })

  it('an opened chest announces the find: the FOUND banner state is set', () => {
    const s = makeRun({
      chests: [CHEST({ id: 0, x: 2, y: 4, loot: { item: 'skeleton-key' } })],
    })
    advance(s, PLAYER_STEP_S)
    movePlayer(s, 1, 0)
    expect(s.found).toEqual({ item: 'skeleton-key', at: s.time })
    // An empty chest announces the dust too.
    const empty = makeRun({ chests: [CHEST({ id: 0, x: 2, y: 4, loot: { item: null } })] })
    movePlayer(empty, 1, 0)
    expect(empty.found).toEqual({ item: null, at: 0 })
  })

  it('a locked chest with no key kneels straight into the pick', () => {
    const s = makeRun({ chests: [CHEST({ id: 0, x: 2, y: 4, locked: true, lockTier: 2 })] })
    step(s, 1, 0)
    expect(s.phase).toBe('picking')
    expect(s.picking).toEqual({ kind: 'chest', id: 0 })
    pickAbandoned(s)
    expect(s.phase).toBe('crawl')
    // A snapped pick is a spent pick and a still-shut chest.
    s.player.picks = 1
    step(s, 1, 0)
    pickSnapped(s)
    expect(s.player.picks).toBe(0)
    expect(canPick(s)).toBe(false)
    // The open pays out.
    s.player.picks = 1
    step(s, 1, 0)
    pickOpened(s)
    expect(s.phase).toBe('crawl')
    expect(s.chestOpen[0]).toBe(true)
  })

  it('a carried key poses the choice: use it, pick anyway, or step back', () => {
    const s = makeRun({
      chests: [CHEST({ id: 0, x: 2, y: 4, locked: true, loot: { item: 'tracker' } })],
    })
    s.player.keys = 1
    step(s, 1, 0)
    expect(s.phase).toBe('unlock')
    stepBack(s)
    expect(s.phase).toBe('crawl')
    expect(s.player.keys, 'stepping back spends nothing').toBe(1)
    step(s, 1, 0)
    pickTheLock(s)
    expect(s.phase, 'choosing the pick hands over to the lock screen').toBe('picking')
    pickAbandoned(s)
    step(s, 1, 0)
    useKey(s)
    expect(s.player.keys).toBe(0)
    expect(s.chestOpen[0]).toBe(true)
    expect(s.player.tracker, 'the key opens the chest properly').toBe(true)
    expect(s.phase).toBe('crawl')
  })
})

describe('doors and the gate', () => {
  it('a locked door: kneel, open, walk through', () => {
    const s = makeRun({
      doors: [{ id: 0, x: 3, y: 4, locked: true, lockTier: 2, wheel: false }],
    })
    step(s, 1, 0)
    step(s, 1, 0)
    expect(s.phase).toBe('picking')
    pickOpened(s)
    expect(s.doorOpen[0]).toBe(true)
    advance(s, PLAYER_STEP_S)
    step(s, 1, 0)
    expect(s.player.x).toBe(3)
  })

  it('the GATE: pick it open and the run is won at speed', () => {
    const s = makeRun({ gate: { x: 2, y: 4, lockTier: 4, wheel: false } })
    advance(s, 0.66)
    movePlayer(s, 1, 0)
    expect(s.phase).toBe('picking')
    expect(s.picking).toEqual({ kind: 'gate', id: 0 })
    advance(s, 0.44) // kneeling costs real time now — the score feels it
    pickOpened(s)
    expect(s.phase).toBe('won')
    expect(dungeonScore(s)).toBe(Math.round(ESCAPE_BASE - s.time * SCORE_PER_SECOND))
    movePlayer(s, 1, 0)
    expect(s.phase, 'a won run ignores further verbs').toBe('won')
  })

  it('a skeleton key turns the gate itself', () => {
    const s = makeRun({ gate: { x: 2, y: 4, lockTier: 4, wheel: false } })
    s.player.keys = 1
    step(s, 1, 0)
    expect(s.phase).toBe('unlock')
    useKey(s)
    expect(s.phase).toBe('won')
    expect(s.player.keys).toBe(0)
  })

  it('an unfinished run scores nothing — the score is the escape, priced by seconds', () => {
    const s = makeRun({})
    step(s, 1, 0)
    expect(dungeonScore(s)).toBe(0)
  })
})

describe('the guards', () => {
  it('walks its beat while nothing has alerted it, and pays double for slow strides', () => {
    // A sentry patroller; the player walled into the top-left pocket.
    const s = makeRun({
      enemies: [GUARD('sentry', 4, 7, [{ x: 4, y: 7 }, { x: 12, y: 7 }])],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    s.player.x = 1
    s.player.y = 1
    const at = (): [number, number] => [s.enemies[0]?.x ?? 0, s.enemies[0]?.y ?? 0]
    beat(s)
    expect(at()).toEqual([5, 7])
    for (let i = 0; i < 7; i += 1) beat(s)
    expect(at(), 'arrived at the far post').toEqual([12, 7])
    expect(s.enemies[0]?.scan, 'and set up to sweep it').toBe(2)
    expect(s.enemies[0]?.awake).toBe(false)
  })

  it('on each post it sweeps: strides spent turning the cone before walking on', () => {
    const s = makeRun({
      enemies: [GUARD('sentry', 4, 7, [{ x: 4, y: 7 }, { x: 12, y: 7 }])],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    s.player.x = 1
    s.player.y = 1
    const e = s.enemies[0]!
    e.scan = 2
    e.facing = 'n'
    beat(s)
    expect([e.x, e.y], 'first sweep stride — no step taken').toEqual([4, 7])
    expect(e.facing, 'the gaze turned a quarter').toBe('e')
    beat(s)
    expect([e.x, e.y]).toEqual([4, 7])
    expect(e.facing).toBe('s')
    beat(s)
    expect([e.x, e.y], 'sweep done — the beat walks on').toEqual([5, 7])
  })

  it('sees you inside its cone and line of sight, and says so', () => {
    const s = makeRun({ enemies: [GUARD('sentry', 6, 4)] })
    beat(s) // dist 5 ≤ vision 10, facing west down the open hall
    expect(s.enemies[0]?.awake).toBe(true)
    expect(s.log.some((l) => l.includes('sentry sees you'))).toBe(true)
  })

  it('the cone is the sight: behind and beside a guard is blind, arm’s reach is not', () => {
    // Facing EAST, player due west at distance 5: inside radius, outside the cone.
    const behind = makeRun({ enemies: [GUARD('sentry', 6, 4)] })
    behind.enemies[0]!.facing = 'e'
    beat(behind)
    expect(behind.enemies[0]?.awake, 'behind its back — unseen').toBe(false)
    // Beside: facing north, player west — the quadrant excludes it.
    const beside = makeRun({ enemies: [GUARD('sentry', 6, 4)] })
    beside.enemies[0]!.facing = 'n'
    beat(beside)
    expect(beside.enemies[0]?.awake, 'off the quadrant — unseen').toBe(false)
    // Since D-188 the cone is the WHOLE sight: directly beside a guard facing away is
    // safe ("he will not spot you behind") — and one tile INSIDE the cone is not.
    const close = makeRun({ enemies: [GUARD('sentry', 2, 4)] })
    close.enemies[0]!.facing = 'e'
    beat(close)
    expect(close.enemies[0]?.awake, 'at its shoulder, behind its eyes — unseen').toBe(false)
    const closeSeen = makeRun({ enemies: [GUARD('sentry', 2, 4)] })
    closeSeen.enemies[0]!.facing = 'w'
    beat(closeSeen)
    expect(closeSeen.enemies[0]?.awake, 'one tile inside the cone — seen').toBe(true)
    // The diagonal edge of the quadrant counts as inside.
    const edge = makeRun({ enemies: [GUARD('sentry', 5, 8)] })
    edge.enemies[0]!.facing = 'w'
    edge.player.x = 1
    edge.player.y = 4
    beat(edge)
    expect(edge.enemies[0]?.awake, 'the cone edge (|dy| == |dx|) is inside').toBe(true)
  })

  it('facing follows the feet: a patroller looks where it walks', () => {
    const s = makeRun({
      enemies: [GUARD('sentry', 4, 7, [{ x: 4, y: 7 }, { x: 12, y: 7 }])],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    s.player.x = 1
    s.player.y = 1
    s.enemies[0]!.facing = 'n'
    beat(s) // steps east along the beat
    expect(s.enemies[0]?.facing).toBe('e')
  })

  it('chases while close, gives up past 1.5× its sight, and resumes the beat', () => {
    // A warden at arm's-length sight (3): dist 3 down the open hall, dead in its cone.
    const s = makeRun({
      enemies: [GUARD('warden', 4, 4, [{ x: 4, y: 4 }, { x: 10, y: 4 }])],
    })
    beat(s)
    expect(s.enemies[0]?.awake).toBe(true)
    const before = s.enemies[0]?.x ?? 0
    beat(s)
    expect(s.enemies[0]?.x ?? 0, 'startled — the corner meeting is yours to break').toBe(before)
    give(s, STARTLE_S)
    beat(s)
    expect(s.enemies[0]?.x ?? 0, 'a chaser closes once the startle passes').toBeLessThan(before)
    // Teleport the player beyond the give-up range: the chase breaks by DISTANCE.
    s.player.x = 1
    s.player.y = 1
    const e = s.enemies[0]
    if (e) {
      e.x = 14
      e.y = 7
    }
    expect(giveUpRange('warden')).toBe(5)
    beat(s)
    expect(s.enemies[0]?.awake, 'past 1.5 sights it loses you').toBe(false)
    expect(s.log.some((l) => l.includes('loses you'))).toBe(true)
  })

  it('a chase also breaks by MEMORY: unseen for its seconds, it gives up wherever you are', () => {
    // The player slips into the sealed pocket; the sentry stands close outside it — well
    // inside give-up DISTANCE, but the walls blind it, and blindness has a clock.
    const s = makeRun({
      enemies: [GUARD('sentry', 5, 2, [{ x: 5, y: 2 }, { x: 9, y: 2 }])],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    s.player.x = 1
    s.player.y = 1
    const e = s.enemies[0]!
    e.awake = true
    e.lastSeen = 0
    while (s.time <= CHASE_MEMORY_S) {
      beat(s)
      if (s.time <= CHASE_MEMORY_S) expect(e.awake, `still remembering at ${s.time}s`).toBe(true)
    }
    expect(e.awake, 'its memory of you cooled — it gives up in place').toBe(false)
    expect(s.log.some((l) => l.includes('loses you'))).toBe(true)
  })

  it('one hand on you ends the run — caught, banked nothing', () => {
    const s = makeRun({ enemies: [GUARD('sentry', 3, 4)] })
    s.enemies[0]!.awake = true
    s.enemies[0]!.lastSeen = 0
    beat(s) // steps to (2,4)
    expect(s.phase).toBe('crawl')
    beat(s) // steps onto you
    expect(s.phase).toBe('caught')
    expect(dungeonScore(s)).toBe(0)
  })

  it("arm's reach is enough while you kneel at a lock", () => {
    const s = makeRun({
      chests: [CHEST({ id: 0, x: 2, y: 4, locked: true })],
      enemies: [GUARD('sentry', 6, 4)],
    })
    s.enemies[0]!.awake = true
    s.enemies[0]!.lastSeen = 0
    movePlayer(s, 1, 0)
    expect(s.phase).toBe('picking')
    for (let i = 0; i < 10 && s.phase === 'picking'; i += 1) beat(s)
    expect(s.phase).toBe('caught')
    expect(s.picking).toBeNull()
  })

  it('the key choice is no shelter: the world walks while the panel hangs open', () => {
    const s = makeRun({
      chests: [CHEST({ id: 0, x: 2, y: 4, locked: true })],
      enemies: [GUARD('sentry', 5, 4)],
    })
    s.player.keys = 1
    s.enemies[0]!.awake = true
    s.enemies[0]!.lastSeen = 0
    movePlayer(s, 1, 0)
    expect(s.phase).toBe('unlock')
    for (let i = 0; i < 10 && s.phase === 'unlock'; i += 1) beat(s)
    expect(s.phase, 'browsing was never free — now it is dangerous').toBe('caught')
  })

  it('the owner’s speed table, halved again: "slow them down even more (twice all)"', () => {
    expect(enemyStepSeconds('warden')).toBe(SLOW_STEP_S * ENEMY_PACE_FACTOR)
    expect(enemyStepSeconds('sentry')).toBe(SLOW_STEP_S * ENEMY_PACE_FACTOR)
    expect(enemyStepSeconds('listener')).toBe(SLOW_STEP_S * ENEMY_PACE_FACTOR)
    const sentry = makeRun({
      enemies: [GUARD('sentry', 9, 4, [{ x: 9, y: 4 }, { x: 5, y: 4 }])],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    sentry.player.x = 1
    sentry.player.y = 1
    give(sentry, enemyStepSeconds('sentry') / 2) // half a stride banked — it rests
    expect(sentry.enemies[0]?.x).toBe(9)
    give(sentry, enemyStepSeconds('sentry') / 2) // the stride is paid for — it moves
    expect(sentry.enemies[0]?.x).toBe(8)
    const warden = makeRun({
      enemies: [GUARD('warden', 9, 4, [{ x: 9, y: 4 }, { x: 5, y: 4 }])],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    warden.player.x = 1
    warden.player.y = 1
    give(warden, enemyStepSeconds('warden') / 2)
    expect(warden.enemies[0]?.x).toBe(9)
    give(warden, enemyStepSeconds('warden') / 2)
    expect(warden.enemies[0]?.x).toBe(8)
  })

  it('a snapped pick rings: earshot guards come INVESTIGATE, beyond it stay on beat', () => {
    const s = makeRun({
      chests: [CHEST({ id: 0, x: 2, y: 4, locked: true })],
      enemies: [GUARD('warden', 6, 4), { ...GUARD('sentry', 13, 7), id: 1 }],
    })
    // The near warden faces AWAY — its cone cannot wake it, so only the RING can.
    s.enemies[0]!.facing = 'e'
    advance(s, 1)
    movePlayer(s, 1, 0)
    expect(s.phase).toBe('picking')
    pickSnapped(s)
    expect(NOISE_RADIUS).toBe(8)
    expect(s.enemies[0]?.awake, 'in earshot — woken').toBe(true)
    expect(
      s.enemies[0]?.lastSeen,
      'the snap seeds its memory: it walks the sound down before it shrugs',
    ).toBe(s.time)
    expect(s.enemies[1]?.awake, 'beyond earshot — not').toBe(false)
    expect(s.log.some((l) => l.includes('rings'))).toBe(true)
  })

  it('the bestiary: four kinds since D-189, distinct letters, the owner’s tables', () => {
    expect(ENEMY_ORDER.length).toBe(Object.keys(ENEMY_STATS).length)
    expect(ENEMY_ORDER.length, 'the hound retired — "too much enemies"').toBe(4)
    const letters = ENEMY_ORDER.map((k) => ENEMY_STATS[k].letter)
    expect(new Set(letters).size).toBe(letters.length)
    // Speeds: warden 0.5, sentry 0.5, listener 0.5, hunter 1/3 — nobody outruns the
    // player, and the hunter does not need to.
    expect(ENEMY_STATS.warden.slow).toBe(true)
    expect(ENEMY_STATS.sentry.slow).toBe(true)
    expect(ENEMY_STATS.listener.slow).toBe(true)
    // Sights: warden 3, sentry 10 — the listener and the hunter are stone blind.
    expect(ENEMY_STATS.warden.vision).toBe(3)
    expect(ENEMY_STATS.sentry.vision).toBe(10)
    expect(ENEMY_STATS.listener.vision).toBe(0)
    expect(ENEMY_STATS.hunter.vision).toBe(0)
  })
})

describe('the listener (D-181)', () => {
  it('is stone blind: a still player in plain reach never wakes it', () => {
    const s = makeRun({ enemies: [GUARD('listener', 6, 4)] })
    for (let i = 0; i < 8; i += 1) advance(s, SLOW_STEP_S)
    expect(s.enemies[0]?.awake, 'dist 5, open hall, dead ahead — and it is blind').toBe(false)
  })

  it('hears a walking player inside its reach, and says so', () => {
    const s = makeRun({ enemies: [GUARD('listener', 6, 4)] })
    for (let i = 0; i < 4; i += 1) {
      movePlayer(s, i % 2 === 0 ? 1 : -1, 0)
      advance(s, PLAYER_STEP_S)
    }
    expect(s.enemies[0]?.awake, 'kept walking through its act — heard').toBe(true)
    expect(s.log.some((l) => l.includes('HEARS'))).toBe(true)
  })

  it('keeps the chase on your strides alone, and only silence sheds it', () => {
    // The player paces inside the sealed pocket — audible through the walls, but the
    // listener can never reach a grab, so the clock is free to run.
    const s = makeRun({
      enemies: [GUARD('listener', 5, 2)],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    s.player.x = 1
    s.player.y = 1
    const e = s.enemies[0]!
    e.awake = true
    e.lastSeen = 0
    // Pacing keeps refreshing its ears well past the memory window.
    for (let i = 0; i < 20; i += 1) {
      movePlayer(s, i % 2 === 0 ? 1 : -1, 0)
      advance(s, PLAYER_STEP_S)
    }
    expect(s.time).toBeGreaterThan(CHASE_MEMORY_S)
    expect(e.awake, 'still pacing — still heard (no distance leash for the blind)').toBe(true)
    // Stand still and its memory of you cools like anyone's.
    while (s.time - e.lastSeen <= CHASE_MEMORY_S) advance(s, SLOW_STEP_S)
    expect(e.awake, 'silence — it gives up').toBe(false)
  })
})

describe('the warden and the bell (D-181)', () => {
  it('a seen warden runs for the bell, rings it, and the whole wing wakes unshakable', () => {
    // The player sits in the sealed pocket the whole time: the warden's errand needs no
    // live sight (its memory carries it), and no chaser can ever reach a grab — so every
    // clock in the test is free to run to its end.
    const s = makeRun({
      enemies: [GUARD('warden', 6, 4), { ...GUARD('sentry', 13, 7), id: 1 }],
      bells: [{ x: 12, y: 4, side: 'n' }],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    const w = s.enemies[0]!
    w.awake = true
    w.lastSeen = 0
    s.player.x = 1
    s.player.y = 1
    // It runs EAST for the bell — away from the player a chaser would head for.
    give(s, enemyStepSeconds('warden'))
    expect(w.x, 'first stride is toward the bell, not the player').toBe(7)
    expect(s.log.some((l) => l.includes('runs for the BELL'))).toBe(true)
    for (let i = 0; i < 6 && !(s.bellRung[0] ?? false); i += 1) give(s, enemyStepSeconds('warden'))
    expect(s.bellRung[0], 'adjacent to the bell — RUNG').toBe(true)
    expect(s.log.some((l) => l.includes('BELL RINGS'))).toBe(true)
    expect(s.alarmUntil).toBeGreaterThan(s.time)
    // The far sentry — asleep, out of any cone's reach — is awake next frame.
    advance(s, PLAYER_STEP_S)
    expect(s.enemies[1]?.awake, 'the alarm wakes the whole wing').toBe(true)
    // And nobody's memory cools while it lasts.
    advance(s, MAX_FRAME_S)
    expect(s.enemies[1]?.lastSeen, 'alarm pins every memory to now').toBe(s.time)
    // When it lapses, the wing settles — audibly.
    while (s.time < s.alarmUntil) advance(s, MAX_FRAME_S)
    expect(s.log.some((l) => l.includes('settles'))).toBe(true)
  })

  it('break the warden’s memory before it arrives and nothing rings', () => {
    const s = makeRun({
      enemies: [GUARD('warden', 5, 4)],
      bells: [{ x: 13, y: 7, side: 's' }],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    const w = s.enemies[0]!
    w.awake = true
    w.lastSeen = 0
    // The player is already gone — sealed in the pocket, unseen from the first stride.
    s.player.x = 1
    s.player.y = 1
    // The errand's fuse is twice a chase's (D-185) — outlast that and nothing rings.
    while (s.time - w.lastSeen <= CHASE_MEMORY_S * 2) give(s, enemyStepSeconds('warden'))
    expect(w.awake, 'memory cooled en route').toBe(false)
    expect(w.bellTarget, 'the errand is forgotten with the chase').toBeNull()
    expect(s.bellRung[0], 'and nothing rang').toBe(false)
  })
})

describe('the key-ring warden (D-181)', () => {
  it('crosses locked doors on its beat and locks them behind — undoing your pick is news', () => {
    const s = makeRun({
      doors: [{ id: 0, x: 8, y: 4, locked: true, lockTier: 2, wheel: false }],
      enemies: [GUARD('warden', 6, 4, [{ x: 6, y: 4 }, { x: 10, y: 4 }])],
      walls: [
        [8, 1], [8, 2], [8, 3], [8, 5], [8, 6], [8, 7],
        [3, 1], [3, 2], [3, 3], [1, 3], [2, 3],
      ],
    })
    s.enemies[0] = { ...s.enemies[0]!, keyring: true }
    s.player.x = 1
    s.player.y = 1
    // March the beat: 6 → 7 → onto the door at 8 (it swings) → 9 (locked behind).
    const stridesTo = (x: number): void => {
      for (let i = 0; i < 14 && s.enemies[0]?.x !== x; i += 1) give(s, enemyStepSeconds('warden'))
    }
    stridesTo(8)
    expect(s.doorOpen[0], 'the ring opens the door under its boot').toBe(true)
    stridesTo(9)
    expect(s.doorOpen[0], 'and locks it the stride it leaves').toBe(false)
    expect(
      s.log.some((l) => l.includes('LOCKED again')),
      'its own silent crossings are not news',
    ).toBe(false)
    // Now the door is YOURS: picked open — the relock earns a ticker line.
    s.doorOpen[0] = true
    s.playerOpened[0] = true
    stridesTo(10)
    stridesTo(8)
    stridesTo(7)
    expect(s.doorOpen[0], 'crossed back and locked again').toBe(false)
    expect(s.log.some((l) => l.includes('LOCKED again')), 'undoing the pick is news').toBe(true)
  })
})

describe('the themed rooms’ kit (D-189)', () => {
  it('lamp oil widens the lamp, flask by flask, to its cap', () => {
    const s = makeRun({
      chests: [
        CHEST({ id: 0, x: 2, y: 4, loot: { item: 'lamp-oil' } }),
        CHEST({ id: 1, x: 2, y: 3, loot: { item: 'lamp-oil' } }),
        CHEST({ id: 2, x: 2, y: 5, loot: { item: 'lamp-oil' } }),
      ],
    })
    expect(lampRadius(s)).toBe(VISION_RADIUS)
    step(s, 1, 0)
    expect(s.player.lampBonus).toBe(1)
    expect(lampRadius(s)).toBe(VISION_RADIUS + 1)
    step(s, 0, -1)
    step(s, 1, 0)
    expect(s.player.lampBonus).toBe(2)
    step(s, 0, 1)
    step(s, 0, 1)
    step(s, 1, 0)
    expect(s.player.lampBonus, 'a lamp, not a sunrise — the cap holds').toBe(LAMP_OIL_CAP)
  })

  it('soft boots: the listener’s reach halves against quiet strides', () => {
    expect(QUIET_LISTEN_RADIUS).toBe(4)
    // Pacing north–south at dist 5 from the listener: heard in ordinary boots…
    const loud = makeRun({ enemies: [GUARD('listener', 6, 4)] })
    for (let i = 0; i < 4; i += 1) {
      movePlayer(loud, 0, i % 2 === 0 ? -1 : 1)
      advance(loud, PLAYER_STEP_S)
    }
    expect(loud.enemies[0]?.awake).toBe(true)
    // …and silence itself in soft ones — dist 5 is beyond its quiet reach of 4.
    const soft = makeRun({ enemies: [GUARD('listener', 6, 4)] })
    soft.player.quiet = true
    for (let i = 0; i < 4; i += 1) {
      movePlayer(soft, 0, i % 2 === 0 ? -1 : 1)
      advance(soft, PLAYER_STEP_S)
    }
    expect(soft.enemies[0]?.awake, 'quiet strides die before its ears').toBe(false)
  })

  it('a tonic burns one grab: you twist out, the guard reels — the second grab holds', () => {
    const s = makeRun({ enemies: [GUARD('sentry', 3, 4)] })
    s.player.tonics = 1
    s.enemies[0]!.awake = true
    s.enemies[0]!.lastSeen = 0
    beat(s) // steps to (2,4)
    expect(s.phase).toBe('crawl')
    beat(s) // the grab — burnt
    expect(s.phase, 'the tonic buys the moment').toBe('crawl')
    expect(s.player.tonics).toBe(0)
    expect(s.log.some((l) => l.includes('TONIC'))).toBe(true)
    expect(s.enemies[0]!.pace, 'the guard reels').toBeLessThanOrEqual(-TONIC_STUN_S + 1e-9)
    give(s, TONIC_STUN_S)
    beat(s) // the second grab, unbought
    expect(s.phase).toBe('caught')
  })

  it('the map fragment inks the whole wing', () => {
    const s = makeRun({ chests: [CHEST({ id: 0, x: 2, y: 4, loot: { item: 'map-fragment' } })] })
    expect(s.seen.some((row) => row.some((c) => !c)), 'fog to begin with').toBe(true)
    movePlayer(s, 1, 0)
    expect(s.seen.every((row) => row.every(Boolean)), 'every wall, inked').toBe(true)
  })

  it('valuables ride in the coat and pay only at the gate', () => {
    const s = makeRun({
      chests: [
        CHEST({
          id: 0, x: 2, y: 4,
          loot: { item: 'valuables', value: 90, label: 'the silver candlesticks' },
        }),
      ],
      gate: { x: 2, y: 5, lockTier: 4, wheel: false },
    })
    advance(s, PLAYER_STEP_S)
    movePlayer(s, 1, 0)
    expect(s.treasure).toBe(90)
    expect(s.found?.label).toBe('the silver candlesticks')
    expect(dungeonScore(s), 'nothing banks mid-run').toBe(0)
    // The chest bump spent this stride — pay for the next two before taking them.
    advance(s, PLAYER_STEP_S)
    movePlayer(s, 0, 1)
    advance(s, PLAYER_STEP_S)
    movePlayer(s, 1, 0)
    expect(s.phase).toBe('picking')
    pickOpened(s)
    expect(s.phase).toBe('won')
    expect(dungeonScore(s), 'speed plus the haul').toBe(
      Math.round(ESCAPE_BASE - s.time * SCORE_PER_SECOND) + 90,
    )
  })

  it('a room introduces itself once — the theme name on the ticker', () => {
    const s = makeRun({ rooms: [{ id: 0, theme: 'library', x0: 3, y0: 3, x1: 5, y1: 5 }] })
    step(s, 1, 0)
    expect(s.log.some((l) => l.includes('LIBRARY')), 'not before the mouth').toBe(false)
    step(s, 1, 0)
    expect(s.log.filter((l) => l.includes('LIBRARY')).length).toBe(1)
    step(s, 1, 0)
    step(s, -1, 0)
    step(s, -1, 0)
    step(s, 1, 0)
    expect(s.log.filter((l) => l.includes('LIBRARY')).length, 'introduced once').toBe(1)
  })

  it('an unlocked door is a mouth, not a barrier: it stands open from the deal', () => {
    const s = makeRun({ doors: [{ id: 0, x: 3, y: 4, locked: false, lockTier: 1, wheel: false }] })
    expect(s.doorOpen[0]).toBe(true)
    step(s, 1, 0)
    step(s, 1, 0)
    expect([s.player.x, s.player.y], 'walked straight through').toEqual([3, 4])
  })
})

describe('footsteps (D-181)', () => {
  it('whispers the direction of an unseen guard in earshot — and only unseen', () => {
    // Behind the wall: dist 3, no line of sight — a whisper to the east.
    const hidden = makeRun({
      enemies: [GUARD('warden', 4, 4)],
      walls: [[3, 3], [3, 4], [3, 5]],
    })
    expect(footsteps(hidden)).toBe('east')
    // Plain view: the lamp holds it — silence.
    const seen = makeRun({ enemies: [GUARD('warden', 4, 4)] })
    expect(footsteps(seen)).toBeNull()
    // Beyond earshot: silence.
    const far = makeRun({
      enemies: [GUARD('warden', 8, 4)],
      walls: [[3, 3], [3, 4], [3, 5]],
    })
    expect(footsteps(far)).toBeNull()
  })
})

describe('the key ring is dealt once', () => {
  it('exactly one warden carries it on a generated floor', () => {
    const s = startDungeon(1)
    const carriers = s.enemies.filter((e) => e.keyring)
    expect(carriers.length).toBe(1)
    expect(carriers[0]?.kind).toBe('warden')
  })
})

describe('the hunter (D-182)', () => {
  it('wakes with the wing and never gives up — no sight to break, no memory to cool', () => {
    const s = startDungeon(1)
    const h = s.enemies.find((e) => e.kind === 'hunter')
    expect(h, 'one hunter per floor').toBeDefined()
    expect(h?.awake, 'hunting is its only state').toBe(true)
    const run = makeRun({
      enemies: [GUARD('hunter', 14, 7)],
      walls: [[3, 1], [3, 2], [3, 3], [1, 3], [2, 3]],
    })
    run.player.x = 1
    run.player.y = 1
    const e = run.enemies[0]!
    e.awake = true
    // Far past every give-up rule the others obey: distance huge, unseen the whole time.
    for (let i = 0; i < 20; i += 1) advance(run, MAX_FRAME_S)
    expect(run.time).toBeGreaterThan(CHASE_MEMORY_S * 3)
    expect(e.awake, 'it does not stop').toBe(true)
    expect(e.hunt, 'it holds a fix on you').not.toBeNull()
  })

  it('walks a FIX that goes stale: your old position until the next one is taken', () => {
    const s = makeRun({ enemies: [GUARD('hunter', 12, 4)] })
    const e = s.enemies[0]!
    e.awake = true
    give(s, enemyStepSeconds('hunter'))
    expect(e.hunt).toEqual({ x: 1, y: 4, at: expect.any(Number) as number })
    expect(e.x, 'one stride toward the fix').toBe(11)
    // The player slips away; the hunter still walks the OLD fix until HUNTER_FIX_S.
    s.player.y = 6
    give(s, enemyStepSeconds('hunter'))
    expect(e.hunt?.y, 'fix not yet refreshed').toBe(4)
    expect(HUNTER_FIX_S).toBe(5)
    for (let i = 0; i < 30 && e.hunt?.y !== 6; i += 1) give(s, enemyStepSeconds('hunter'))
    expect(e.hunt?.y, 'a fresh fix finds where you went').toBe(6)
  })

  it('strides at a sixth of your pace — slow, and exactly as inevitable', () => {
    expect(enemyStepSeconds('hunter')).toBe(PLAYER_STEP_S * HUNTER_STEP_FACTOR * ENEMY_PACE_FACTOR)
    const s = makeRun({ enemies: [GUARD('hunter', 12, 4)] })
    const e = s.enemies[0]!
    e.awake = true
    give(s, enemyStepSeconds('hunter') - PLAYER_STEP_S)
    expect(e.x, 'almost a stride banked — not yet').toBe(12)
    give(s, PLAYER_STEP_S)
    expect(e.x, 'the last player stride pays for its own').toBe(11)
  })

  it('announces itself once when its fix first lands near you', () => {
    const s = makeRun({ enemies: [GUARD('hunter', 8, 4)] })
    const e = s.enemies[0]!
    e.awake = true
    give(s, enemyStepSeconds('hunter'))
    expect(s.log.some((l) => l.includes('HUNTER has your scent'))).toBe(true)
  })
})

describe('the torches light the wing (D-198)', () => {
  const TORCH: DungeonPropDef = { kind: 'torch', x: 12, y: 4, side: 'n' }

  it('a torch pool is visible and inked from any clear line — walls end the light', () => {
    const s = makeRun({ props: [TORCH] })
    expect(torchLit(s).has('12,4'), 'the pool, seen down the whole hall').toBe(true)
    expect(torchLit(s).has('9,4'), 'the pool reaches three tiles').toBe(true)
    expect(torchLit(s).has('8,4'), 'and no further').toBe(false)
    step(s, 1, 0)
    expect(s.seen[4]?.[12], 'torchlight inks the plan').toBe(true)
    // Wall the hall: the light still burns, but your eye cannot reach it.
    const blocked = makeRun({
      props: [TORCH],
      walls: [[8, 3], [8, 4], [8, 5]],
    })
    expect(blocked.floor.walk[4]?.[8]).toBe(false)
    expect(torchLit(blocked).has('12,4'), 'light does not turn corners').toBe(false)
  })
})

describe('the motion tracker', () => {
  it('whispers only when carried, and only within its reach', () => {
    const s = makeRun({ enemies: [GUARD('warden', 6, 4), { ...GUARD('sentry', 14, 7), id: 1 }] })
    expect(trackerNear(s), 'no tracker, no whisper').toBe(0)
    s.player.tracker = true
    expect(trackerNear(s), 'the warden at 5 is inside reach 8; the sentry at 13 is not').toBe(1)
  })
})
