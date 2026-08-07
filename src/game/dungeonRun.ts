/**
 * The labyrinth's turn machine — `docs/DUNGEON.md`, pure state in, pure state out (D-177).
 *
 * Nobody dies here, and nobody fights: the owner's rule is "without any killing person".
 * The guards patrol; if one sees you it chases; if it touches you the run is over — caught.
 * You break a chase by distance (past one-and-a-half times its sight it loses you) or by
 * the loops the maze braids for exactly this purpose. The verbs are walking, waiting,
 * kneeling at locks, and choosing between a pick and a skeleton key. The score is SPEED:
 * fewer turns out the gate, more score banked.
 *
 * Everything else keeps the old machine's constitution: no rng anywhere (the floor was
 * dealt once), no clocks (the app decides how much picking time buys a world turn), and
 * nothing persisted — a relaunch has no labyrinth to resume.
 */

import type { AssistMode } from '../sim'
import {
  type DungeonChestDef,
  type DungeonDoorDef,
  type DungeonFloor,
  type EnemyKind,
  generateFloor,
} from './dungeon'

/** What the chosen assist multiplies the banked score by — the 10/50/100/250 table's heirs. */
export const DUNGEON_DIFFICULTY_FACTOR: Record<AssistMode, number> = {
  training: 0.1,
  easy: 0.5,
  medium: 1,
  hard: 2.5,
}

/** Seconds of real picking that cost one world turn — training buys a slower labyrinth. */
export const PICK_TURN_SECONDS: Record<AssistMode, number> = {
  training: 9,
  easy: 6,
  medium: 6,
  hard: 6,
}

/** The one hero's kit (D-176): two picks and quick feet. Nothing else is owed. */
export const START_PICKS = 2
/** How far a snapped pick rings — walls do not stop it, which is the whole threat. */
export const NOISE_RADIUS = 8
/** A chase breaks past this multiple of the guard's sight — the owner's "1.5 sight". */
export const CHASE_FACTOR = 1.5
/**
 * …and it also breaks by MEMORY: a chaser that has not actually seen you for this many
 * turns gives up wherever you are (D-179). Distance alone never released the sentry —
 * 1.5 × 11 sight is further than a maze ever lets you get.
 */
export const CHASE_MEMORY = 6
/** The motion tracker whispers when any guard is within this reach, walls or no walls. */
export const TRACKER_RADIUS = 6
/** The speed score: turns eat it, escape floors it. Faster out means more banked. */
export const ESCAPE_BASE = 600
export const ESCAPE_FLOOR = 25

export interface EnemyStats {
  /** The map glyph — one letter, roguelike convention, no two kinds share one. */
  readonly letter: string
  /** Plain name; logs say `the ${name}`. */
  readonly name: string
  readonly vision: number
  /** Acts only on even turns. */
  readonly slow: boolean
  /** Acts twice every turn. */
  readonly fast: boolean
  /** The quirk in two words — sighting logs and the compact briefing. */
  readonly quirk: string
  /** The quirk as the full briefing tells it. */
  readonly lore: string
}

/**
 * The bestiary — every guard the labyrinth walks, flat numbers a player can plan against.
 * Different speed, different sight, different beats (the generator deals those).
 */
// Speeds are the owner's table (D-179): warden 0.5, hound 1, sentry 0.5 — nobody moves
// faster than you do, so every chase is escapable by running, and the hound's threat is
// that it matches your pace instead of beating it.
export const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  warden: {
    letter: 'W', name: 'warden', vision: 3,
    slow: true, fast: false,
    quirk: 'dim, slow', lore: 'half your pace, short sight, long rounds',
  },
  hound: {
    letter: 'h', name: 'hound', vision: 6,
    slow: false, fast: false,
    quirk: 'your pace', lore: 'your pace, keen eyes — the one that hunts',
  },
  sentry: {
    letter: 's', name: 'sentry', vision: 10,
    slow: true, fast: false,
    quirk: 'far sight', lore: 'half pace, eyes a whole hall long',
  },
}

/** Bestiary display order. */
export const ENEMY_ORDER: readonly EnemyKind[] = ['warden', 'hound', 'sentry']

/** Past this distance a chasing guard loses you and walks back to its beat. */
export function giveUpRange(kind: EnemyKind): number {
  return Math.ceil(ENEMY_STATS[kind].vision * CHASE_FACTOR)
}

/** A guard's facing — the direction its cone of sight points. */
export type Facing = 'n' | 'e' | 's' | 'w'

export interface DungeonEnemy {
  readonly id: number
  readonly kind: EnemyKind
  x: number
  y: number
  awake: boolean
  /** Where it is looking. Follows every step it takes; the cone hangs off this. */
  facing: Facing
  /** The turn this guard last actually SAW you — chase memory hangs off it (D-179). */
  lastSeen: number
  readonly patrol: readonly { readonly x: number; readonly y: number }[]
  /** Which waypoint the beat is walking toward. */
  wpIndex: number
}

export interface DungeonPlayer {
  x: number
  y: number
  picks: number
  /** Skeleton keys — each skips one lock outright, the gate included. */
  keys: number
  /** True once the motion tracker is carried: nearby guards whisper on the strip. */
  tracker: boolean
}

export type DungeonPhase = 'crawl' | 'picking' | 'unlock' | 'caught' | 'won'

export interface PickingTarget {
  readonly kind: 'chest' | 'door' | 'gate'
  readonly id: number
}

/** How far the lamp reaches — Chebyshev, like guard vision. */
export const VISION_RADIUS = 9

export interface DungeonRunState {
  readonly floor: DungeonFloor
  readonly player: DungeonPlayer
  readonly enemies: DungeonEnemy[]
  readonly doorOpen: boolean[]
  readonly chestOpen: boolean[]
  /** seen[y][x] — every cell the lamp has ever reached. The map draws only what this holds. */
  readonly seen: boolean[][]
  turn: number
  phase: DungeonPhase
  /** The lock being knelt at (picking), or offered the key choice (unlock). */
  picking: PickingTarget | null
  /** Short human lines for the HUD's event ticker, newest last, capped. */
  readonly log: string[]
  /** One-shot: the escape verb is taught the first time anything sees you. */
  hintedRun: boolean
}

export function startDungeon(seed: number): DungeonRunState {
  const floor = generateFloor(seed)
  const state: DungeonRunState = {
    floor,
    player: {
      x: floor.start.x,
      y: floor.start.y,
      picks: START_PICKS,
      keys: 0,
      tracker: false,
    },
    enemies: floor.enemies.map((e) => {
      // Face along the beat: toward the second post if there is one, else westward — back
      // toward the wing's mouth, which is where trouble tends to come from.
      const next = e.patrol[1]
      const facing: Facing = !next
        ? 'w'
        : Math.abs(next.x - e.x) >= Math.abs(next.y - e.y)
          ? next.x >= e.x
            ? 'e'
            : 'w'
          : next.y >= e.y
            ? 's'
            : 'n'
      return {
        id: e.id,
        kind: e.kind,
        x: e.x,
        y: e.y,
        awake: false,
        facing,
        lastSeen: 0,
        patrol: e.patrol,
        wpIndex: 0,
      }
    }),
    doorOpen: floor.doors.map(() => false),
    chestOpen: floor.chests.map(() => false),
    seen: Array.from({ length: floor.h }, () => Array.from({ length: floor.w }, () => false)),
    turn: 0,
    phase: 'crawl',
    picking: null,
    log: [],
    hintedRun: false,
  }
  revealAround(state)
  say(state, 'find the exit gate — quiet and quick')
  return state
}

/**
 * The lamp: everything within its reach and line of sight is seen, and stays seen — walls
 * included, because a floor plan is drawn from its walls.
 */
export function revealAround(s: DungeonRunState): void {
  const px = s.player.x
  const py = s.player.y
  for (let y = Math.max(0, py - VISION_RADIUS); y <= Math.min(s.floor.h - 1, py + VISION_RADIUS); y += 1) {
    for (let x = Math.max(0, px - VISION_RADIUS); x <= Math.min(s.floor.w - 1, px + VISION_RADIUS); x += 1) {
      if (s.seen[y]?.[x]) continue
      if (lineOfSight(s, px, py, x, y)) (s.seen[y] as boolean[])[x] = true
    }
  }
}

function say(s: DungeonRunState, line: string): void {
  s.log.push(line)
  if (s.log.length > 6) s.log.splice(0, s.log.length - 6)
}

/** Push a ticker line from outside — the layout sweep's way of auditing a full ticker. */
export function logLine(s: DungeonRunState, line: string): void {
  say(s, line)
}

export function doorAt(s: DungeonRunState, x: number, y: number): DungeonDoorDef | undefined {
  return s.floor.doors.find((d) => d.x === x && d.y === y)
}

export function chestAt(s: DungeonRunState, x: number, y: number): DungeonChestDef | undefined {
  return s.floor.chests.find((c) => c.x === x && c.y === y)
}

function enemyAt(s: DungeonRunState, x: number, y: number): DungeonEnemy | undefined {
  return s.enemies.find((e) => e.x === x && e.y === y)
}

/** Can a body stand here — walls, shut doors, chests, the shut gate and guards all block. */
function passable(s: DungeonRunState, x: number, y: number): boolean {
  if (x < 0 || x >= s.floor.w || y < 0 || y >= s.floor.h) return false
  if (!(s.floor.walk[y]?.[x] ?? false)) return false
  const door = doorAt(s, x, y)
  if (door && !(s.doorOpen[door.id] ?? false)) return false
  if (chestAt(s, x, y)) return false
  if (s.floor.gate.x === x && s.floor.gate.y === y) return false
  if (enemyAt(s, x, y)) return false
  return true
}

/** Straight-line sight, walls and shut doors opaque. Bresenham over the grid. */
export function lineOfSight(s: DungeonRunState, x0: number, y0: number, x1: number, y1: number): boolean {
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
    if (x === x1 && y === y1) break
    if (!(s.floor.walk[y]?.[x] ?? false)) return false
    const door = doorAt(s, x, y)
    if (door && !(s.doorOpen[door.id] ?? false)) return false
  }
  return true
}

const cheb = (ax: number, ay: number, bx: number, by: number): number =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by))

/**
 * The 90° wedge ahead of a facing: a cell is inside when its dominant offset lies along
 * the look direction — the grid's honest quadrant, edges included. Behind a guard is
 * blind, and that is the whole game now (D-178).
 */
export function inCone(facing: Facing, dx: number, dy: number): boolean {
  switch (facing) {
    case 'e':
      return dx > 0 && Math.abs(dy) <= dx
    case 'w':
      return dx < 0 && Math.abs(dy) <= -dx
    case 's':
      return dy > 0 && Math.abs(dx) <= dy
    default:
      return dy < 0 && Math.abs(dx) <= -dy
  }
}

/**
 * Can this guard see that cell right now — the cone, capped by its sight, cut by walls,
 * with one tile of all-round awareness (nobody lets you breathe on their neck).
 */
export function guardSees(s: DungeonRunState, e: DungeonEnemy, x: number, y: number): boolean {
  const dist = cheb(e.x, e.y, x, y)
  if (dist === 0) return true
  if (dist === 1) return true
  if (dist > ENEMY_STATS[e.kind].vision) return false
  if (!inCone(e.facing, x - e.x, y - e.y)) return false
  return lineOfSight(s, e.x, e.y, x, y)
}

/** Point a guard along the step it just took. A zero step leaves the gaze where it was. */
function face(e: DungeonEnemy, dx: number, dy: number): void {
  if (dx > 0) e.facing = 'e'
  else if (dx < 0) e.facing = 'w'
  else if (dy > 0) e.facing = 's'
  else if (dy < 0) e.facing = 'n'
}

/**
 * One BFS step for a guard toward a target cell — a maze wants routes, not greed: the old
 * sign-stepper wedged on the first corner it met. Other guards block; the player's cell is
 * enterable exactly when it IS the target (that entry is the catch). Returns null when no
 * route stands, which a guard spends standing still.
 */
function bfsStep(
  s: DungeonRunState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): { x: number; y: number } | null {
  if (fromX === toX && fromY === toY) return null
  const prev = new Map<string, string>()
  const seen = new Set([`${fromX},${fromY}`])
  const q: [number, number][] = [[fromX, fromY]]
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
      const k = `${nx},${ny}`
      if (seen.has(k)) continue
      const isTarget = nx === toX && ny === toY
      const isPlayer = nx === s.player.x && ny === s.player.y
      if (!isTarget) {
        if (!passable(s, nx, ny) || isPlayer) continue
      } else if (!isPlayer && !passable(s, nx, ny)) {
        // A target cell someone else stands on (another guard on the waypoint): unreachable
        // this turn; the beat waits.
        continue
      }
      seen.add(k)
      prev.set(k, `${x},${y}`)
      if (isTarget) {
        // Walk back to the first step.
        let cur = k
        let parent = prev.get(cur) as string
        while (parent !== `${fromX},${fromY}`) {
          cur = parent
          parent = prev.get(cur) as string
        }
        const [sx, sy] = cur.split(',').map(Number) as [number, number]
        return { x: sx, y: sy }
      }
      q.push([nx, ny])
    }
  }
  return null
}

/** How the logs address a kind — the bestiary's name with its article on. */
const callIt = (kind: EnemyKind): string => `the ${ENEMY_STATS[kind].name}`

/**
 * One guard's act. Returns false the moment the player is caught, so the turn stops cold.
 * A hound takes this act twice a turn; that is its whole trick.
 */
function enemyAct(s: DungeonRunState, e: DungeonEnemy): boolean {
  const dist = cheb(e.x, e.y, s.player.x, s.player.y)
  if (!e.awake) {
    // Look first: the 90° cone ahead, walls cutting it, one tile of neck-hair all round.
    if (guardSees(s, e, s.player.x, s.player.y)) {
      e.awake = true
      e.lastSeen = s.turn
      say(s, `${callIt(e.kind)} sees you — RUN`)
      if (!s.hintedRun) {
        s.hintedRun = true
        say(s, `lose it: ${giveUpRange(e.kind)} tiles away, or ${CHASE_MEMORY} turns unseen`)
      }
      return true
    }
    // The beat: waypoint to waypoint, forever. A blocked hall is a pause on post.
    if (e.patrol.length > 0) {
      const wp = e.patrol[e.wpIndex] as { x: number; y: number }
      if (e.x === wp.x && e.y === wp.y) {
        e.wpIndex = (e.wpIndex + 1) % e.patrol.length
      }
      const next = e.patrol[e.wpIndex] as { x: number; y: number }
      const step = bfsStep(s, e.x, e.y, next.x, next.y)
      if (step && !(step.x === s.player.x && step.y === s.player.y) && passable(s, step.x, step.y)) {
        face(e, step.x - e.x, step.y - e.y)
        e.x = step.x
        e.y = step.y
        // Fresh gaze after the stride: a guard that turns a corner sees down the new hall.
        if (guardSees(s, e, s.player.x, s.player.y)) {
          e.awake = true
          e.lastSeen = s.turn
          say(s, `${callIt(e.kind)} sees you — RUN`)
        }
      }
    }
    return true
  }
  // Alerted, it swivels — the cone is for the unsuspecting; a chaser sees all round
  // within its sight, walls permitting, and remembers you for CHASE_MEMORY turns.
  if (
    dist <= ENEMY_STATS[e.kind].vision &&
    lineOfSight(s, e.x, e.y, s.player.x, s.player.y)
  ) {
    e.lastSeen = s.turn
  }
  // The chase breaks two ways: run past one-and-a-half sights, or stay unseen — corners
  // and loops — until its memory runs out.
  if (dist > giveUpRange(e.kind) || s.turn - e.lastSeen > CHASE_MEMORY) {
    e.awake = false
    // Resume the beat at its nearest post.
    let best = 0
    let bestD = Infinity
    e.patrol.forEach((wp, i) => {
      const d = Math.abs(wp.x - e.x) + Math.abs(wp.y - e.y)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    e.wpIndex = best
    say(s, `${callIt(e.kind)} loses you`)
    return true
  }
  // The grab: while you kneel at a lock, arm's reach is enough.
  if (s.phase === 'picking' && dist === 1) {
    s.phase = 'caught'
    s.picking = null
    say(s, 'a hand closes on your collar. caught.')
    return false
  }
  const step = bfsStep(s, e.x, e.y, s.player.x, s.player.y)
  if (!step) return true
  if (step.x === s.player.x && step.y === s.player.y) {
    if (s.phase === 'picking' || s.phase === 'crawl') {
      s.phase = 'caught'
      s.picking = null
      say(s, 'a hand closes on your collar. caught.')
      return false
    }
    return true
  }
  if (passable(s, step.x, step.y)) {
    face(e, step.x - e.x, step.y - e.y)
    e.x = step.x
    e.y = step.y
  }
  return true
}

/**
 * The world takes its turn. Called after every player verb, and once per picking tick —
 * which is the whole "time costs turns" rule: a slow lock is a dangerous one.
 */
export function worldTurn(s: DungeonRunState): void {
  if (s.phase === 'caught' || s.phase === 'won') return
  s.turn += 1
  for (const e of s.enemies) {
    const stats = ENEMY_STATS[e.kind]
    if (stats.slow && s.turn % 2 === 1) continue
    if (!enemyAct(s, e)) return
    if (stats.fast && !enemyAct(s, e)) return
  }
}

function openChest(s: DungeonRunState, chest: DungeonChestDef): void {
  s.chestOpen[chest.id] = true
  const p = s.player
  if (chest.loot.item === 'pick') {
    p.picks += 1
    say(s, 'chest: a spare pick')
  } else if (chest.loot.item === 'skeleton-key') {
    p.keys += 1
    say(s, 'chest: a SKELETON KEY — it will skip one lock')
  } else if (chest.loot.item === 'tracker') {
    p.tracker = true
    say(s, 'chest: the MOTION TRACKER — it whispers when they are near')
  } else {
    say(s, 'chest: empty. someone was here first')
  }
}

/** Route a bump on a locked thing: the key choice when a key is carried, else the pick. */
function kneelAt(s: DungeonRunState, target: PickingTarget): void {
  s.picking = target
  s.phase = s.player.keys > 0 ? 'unlock' : 'picking'
}

/**
 * The player's one verb: step (or bump) in a direction. Returns quietly on anything that
 * is not a legal move — bumping a wall or a guard costs nothing.
 */
export function movePlayer(s: DungeonRunState, dx: number, dy: number): void {
  if (s.phase !== 'crawl') return
  if (Math.abs(dx) + Math.abs(dy) !== 1) return
  const nx = s.player.x + dx
  const ny = s.player.y + dy

  // A guard is a wall with eyes — there is no swinging at anyone (D-177).
  if (enemyAt(s, nx, ny)) return

  const chest = chestAt(s, nx, ny)
  if (chest && !(s.chestOpen[chest.id] ?? false)) {
    if (chest.locked) {
      kneelAt(s, { kind: 'chest', id: chest.id })
      return
    }
    openChest(s, chest)
    worldTurn(s)
    return
  }
  if (chest) return // an opened chest is furniture

  const door = doorAt(s, nx, ny)
  if (door && !(s.doorOpen[door.id] ?? false)) {
    kneelAt(s, { kind: 'door', id: door.id })
    return
  }

  if (nx === s.floor.gate.x && ny === s.floor.gate.y) {
    kneelAt(s, { kind: 'gate', id: 0 })
    return
  }

  if (!passable(s, nx, ny)) return
  s.player.x = nx
  s.player.y = ny
  revealAround(s)
  worldTurn(s)
}

/** Stand still for a turn — patrols move on beats, and waiting is how you read them. */
export function waitTurn(s: DungeonRunState): void {
  if (s.phase !== 'crawl') return
  worldTurn(s)
}

/** The key choice: spend a skeleton key and the lock simply opens. Costs the turn. */
export function useKey(s: DungeonRunState): void {
  if (s.phase !== 'unlock' || !s.picking || s.player.keys <= 0) return
  const target = s.picking
  s.player.keys -= 1
  s.picking = null
  if (target.kind === 'gate') {
    s.phase = 'won'
    say(s, 'the skeleton key turns. daylight.')
    return
  }
  s.phase = 'crawl'
  if (target.kind === 'chest') {
    const chest = s.floor.chests[target.id]
    if (chest) openChest(s, chest)
    say(s, 'the skeleton key turns')
  } else {
    s.doorOpen[target.id] = true
    say(s, 'the skeleton key turns. the door swings open')
    revealAround(s)
  }
  worldTurn(s)
}

/** The pick choice: kneel at it properly — the lock screen takes over from here. */
export function pickTheLock(s: DungeonRunState): void {
  if (s.phase !== 'unlock' || !s.picking) return
  s.phase = 'picking'
}

/** Step back from the lock — free, exactly as never having bumped it. */
export function stepBack(s: DungeonRunState): void {
  if (s.phase !== 'unlock') return
  s.picking = null
  s.phase = 'crawl'
}

/** True while the player still owns a pick that could work a lock. */
export function canPick(s: DungeonRunState): boolean {
  return s.player.picks > 0
}

/** One world turn spent kneeling at the lock — the app calls this on the picking clock. */
export function pickTick(s: DungeonRunState): void {
  if (s.phase !== 'picking') return
  worldTurn(s)
}

/** The lock opened: the chest gives, the door does — or the GATE does, and you are out. */
export function pickOpened(s: DungeonRunState): void {
  if (s.phase !== 'picking' || !s.picking) return
  const target = s.picking
  s.picking = null
  if (target.kind === 'gate') {
    s.phase = 'won'
    say(s, 'the gate gives. daylight.')
    return
  }
  s.phase = 'crawl'
  if (target.kind === 'chest') {
    const chest = s.floor.chests[target.id]
    if (chest) openChest(s, chest)
  } else {
    s.doorOpen[target.id] = true
    say(s, 'the lock gives. the door swings open')
    revealAround(s)
  }
}

/**
 * The pick snapped inside the lock: the lock stays shut, a spare is now a need — and the
 * SNAP RINGS. Every guard within earshot turns toward it; walls do not muffle it.
 */
export function pickSnapped(s: DungeonRunState): void {
  if (s.phase !== 'picking') return
  s.player.picks = Math.max(0, s.player.picks - 1)
  s.picking = null
  s.phase = 'crawl'
  say(s, s.player.picks > 0 ? `the pick snaps — ${s.player.picks} left` : 'the pick snaps. none left.')
  let woken = 0
  for (const e of s.enemies) {
    if (e.awake) continue
    if (cheb(e.x, e.y, s.player.x, s.player.y) <= NOISE_RADIUS) {
      e.awake = true
      woken += 1
    }
  }
  if (woken > 0) say(s, 'the snap rings down the halls — footsteps turn your way')
}

/** Walked away from the lock — no cost beyond the turns already spent kneeling. */
export function pickAbandoned(s: DungeonRunState): void {
  if (s.phase !== 'picking') return
  s.picking = null
  s.phase = 'crawl'
}

/** Guards within the tracker's reach right now — 0 without the tracker. */
export function trackerNear(s: DungeonRunState): number {
  if (!s.player.tracker) return 0
  return s.enemies.filter((e) => cheb(e.x, e.y, s.player.x, s.player.y) <= TRACKER_RADIUS).length
}

/**
 * What the run is worth: SPEED. The base decays two points a turn; the floor keeps a fast
 * caught-at-the-end run from reading as worthless... except a caught run banks nothing,
 * which the app enforces — this function only prices an escape.
 */
export function dungeonScore(s: DungeonRunState): number {
  if (s.phase !== 'won') return 0
  return Math.max(ESCAPE_FLOOR, ESCAPE_BASE - s.turn * 2)
}
