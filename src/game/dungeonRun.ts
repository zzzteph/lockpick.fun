/**
 * The labyrinth's REAL-TIME machine — `docs/DUNGEON.md`, pure state in, pure state out.
 *
 * Nobody dies here, and nobody fights — the founding rule, briefly reversed by D-195's
 * traps and restored the same day by D-197 ("let's remove the traps completely from
 * the game"). The guards patrol; if one sees you it chases; if it touches you the run
 * is over — caught.
 * You break a chase by distance (past one-and-a-half times its sight it loses you) or by
 * staying out of its eyes until its memory cools. The verbs are walking, kneeling at
 * locks, and choosing between a pick and a skeleton key. The score is SPEED: fewer
 * seconds out the gate, more score banked.
 *
 * Time is real now (D-180, "make it realtime (slow)"): the app feeds `advance()` wall
 * seconds every frame — while you walk, while you kneel, while the key choice hangs open.
 * NOTHING pauses the labyrinth but the end of it. The machine stays deterministic: no rng
 * anywhere (the floor was dealt once), the clock only ever moves by what advance() is
 * handed, and nothing is persisted — a relaunch has no labyrinth to resume.
 */

import type { AssistMode } from '../sim'
import {
  type DungeonChestDef,
  type DungeonDoorDef,
  type DungeonFloor,
  type DungeonItem,
  type EnemyKind,
  ROOM_THEMES,
  generateFloor,
  roomAt,
} from './dungeon'

/** What the chosen assist multiplies the banked score by — the 10/50/100/250 table's heirs. */
export const DUNGEON_DIFFICULTY_FACTOR: Record<AssistMode, number> = {
  training: 0.1,
  easy: 0.5,
  medium: 1,
  hard: 2.5,
}

/**
 * The player's stride: one tile per this many seconds, held key or tapped alike — the
 * "slow" in the owner's "realtime (slow)". Every speed below hangs off it.
 */
export const PLAYER_STEP_S = 0.22
/** A slow guard's stride — half your pace, the owner's 0.5 table (D-179). */
export const SLOW_STEP_S = PLAYER_STEP_S * 2
/** The clock never swallows more than this per frame — a tabbed-out tab must not teleport guards. */
export const MAX_FRAME_S = PLAYER_STEP_S * 4

/** The one hero's kit (D-176): two picks and quick feet. Nothing else is owed. */
export const START_PICKS = 2
/** How far a snapped pick rings — walls do not stop it, which is the whole threat. */
export const NOISE_RADIUS = 8
/** A chase breaks past this multiple of the guard's sight — the owner's "1.5 sight". */
export const CHASE_FACTOR = 1.5
/**
 * …and it also breaks by MEMORY: a chaser that has not actually seen you for this many
 * SECONDS gives up wherever you are (D-179, retimed for real time). Distance alone never
 * released the sentry — 1.5 × its sight is further than a maze ever lets you get.
 */
export const CHASE_MEMORY_S = 3.5
/** How long a guard stands sweeping its gaze on each patrol post before walking on. */
export const SCAN_STRIDES = 2
/** The motion tracker paints its RED DOTS within this reach, walls or no walls (D-188). */
export const TRACKER_RADIUS = 8
/** The listener's ears: a stride inside this reach is a sighting to it. Walls are no bar. */
export const LISTEN_RADIUS = 7
/** The listener's ears against SOFT BOOTS (D-189): quiet steps carry half as far. */
export const QUIET_LISTEN_RADIUS = 4
/** Everyone's ears: an UNSEEN guard this close whispers "footsteps to the …" on the strip. */
export const FOOTSTEP_RADIUS = 5
/** How long the rung bell keeps the whole wing awake and unshakable. */
export const ALARM_S = 12
/** The hunter's stride is this many player strides — slow, and exactly as inevitable. */
export const HUNTER_STEP_FACTOR = 3
/** How often the hunter fixes where you ARE and walks there. It never needs to see you. */
export const HUNTER_FIX_S = 5
/**
 * The whole wing walks at HALF the table again — the owner's "slow them down even more
 * (twice all)" (D-185). Multiplies every guard stride; the player's pace is untouched.
 */
export const ENEMY_PACE_FACTOR = 2
/**
 * The corner grace (D-185): a guard that ACQUIRES you — sight or ears — spends this long
 * startled before its first chase stride. "You can meet the enemy when you turn at the
 * corner": now the meeting is yours to break first.
 */
export const STARTLE_S = 0.45
/** The speed score: seconds eat it, escape floors it. Faster out means more banked. */
export const ESCAPE_BASE = 600
export const SCORE_PER_SECOND = 3
export const ESCAPE_FLOOR = 25
/** How long the "you found a thing" banner hangs on the map. */
export const FOUND_TOAST_S = 2.6

export interface EnemyStats {
  /** The map glyph — one letter, roguelike convention, no two kinds share one. */
  readonly letter: string
  /** Plain name; logs say `the ${name}`. */
  readonly name: string
  readonly vision: number
  /** Strides at half your pace (the owner's 0.5); false is your pace exactly. */
  readonly slow: boolean
  /** The quirk in two words — sighting logs and the compact briefing. */
  readonly quirk: string
  /** The quirk as the full briefing tells it. */
  readonly lore: string
  /** The GRIM STORY (D-192): who this was before the wing — the guide's reading matter. */
  readonly story: string
}

/** A kind's stride length in seconds — the whole speed table in one line. */
export function enemyStepSeconds(kind: EnemyKind): number {
  const base = kind === 'hunter' ? PLAYER_STEP_S * HUNTER_STEP_FACTOR : ENEMY_STATS[kind].slow ? SLOW_STEP_S : PLAYER_STEP_S
  return base * ENEMY_PACE_FACTOR
}

/**
 * The bestiary — every guard the labyrinth walks, flat numbers a player can plan against.
 * Different speed, different sight, different beats (the generator deals those).
 */
// Speeds are the owner's table (D-179): warden 0.5, sentry 0.5 — nobody moves faster
// than you do, so every chase is escapable by running. The hound retired in D-189
// ("too much enemies"), and its scent-trail machinery went with it.
export const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  warden: {
    letter: 'W', name: 'warden', vision: 3,
    slow: true,
    quirk: 'bell-runner', lore: 'runs for the BELL; one carries the KEYS',
    story:
      'Forty years on the keys — nobody left who remembers handing them over. ' +
      'The wing was quieter locked, so it locks everything. ' +
      'Only the bell still makes it run.',
  },
  sentry: {
    letter: 's', name: 'sentry', vision: 10,
    slow: true,
    quirk: 'far sight', lore: 'half pace, eyes a whole hall long',
    story:
      'Ordered onto a post; the stand-down never came. ' +
      'The eyes grew a hall long from staring, and the legs mostly forgot. ' +
      'It does not patrol. It aims.',
  },
  listener: {
    letter: 'L', name: 'listener', vision: 0,
    slow: true,
    quirk: 'all ears', lore: 'blind — hears every stride you take',
    story:
      'It put out its own lamps to be rid of the flicker, and the ears ' +
      'grew into the dark. It has heard every escape this wing ever ' +
      'tried. It is still here.',
  },
  hunter: {
    letter: 'H', name: 'hunter', vision: 0,
    slow: true,
    quirk: 'never stops', lore: 'starts far away — and it never stops',
    story:
      'Nobody posted it. It came after the first escape; the warders ' +
      'pretend it is theirs. It does not look for you — it walks to ' +
      'where you will be, unhurried.',
  },
}

/** Bestiary display order. */
export const ENEMY_ORDER: readonly EnemyKind[] = ['warden', 'sentry', 'listener', 'hunter']

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
  /** The CLOCK time this guard last actually saw you — chase memory hangs off it (D-179). */
  lastSeen: number
  readonly patrol: readonly { readonly x: number; readonly y: number }[]
  /** Which waypoint the beat is walking toward. */
  wpIndex: number
  /** Unspent seconds — advance() banks time here and the guard strides when it can afford one. */
  pace: number
  /** Strides left of standing on a post sweeping the gaze around before walking on. */
  scan: number
  /** One warden carries the KEYS (D-181): doors are no wall to it, and it locks them behind. */
  readonly keyring: boolean
  /** The bell this alerted warden is running for — null when it is simply chasing. */
  bellTarget: number | null
  /** The hunter's current fix on you: where it is walking, and when it was taken (D-182). */
  hunt: { x: number; y: number; at: number } | null
}

export interface DungeonPlayer {
  x: number
  y: number
  picks: number
  /** Skeleton keys — each skips one lock outright, the gate included. */
  keys: number
  /** True once the motion tracker is carried: nearby guards whisper on the strip. */
  tracker: boolean
  /** Flasks of LAMP OIL burnt (D-189): each adds a tile of lamp reach, capped. */
  lampBonus: number
  /** SOFT BOOTS carried (D-189): the listener hears your strides at half its reach. */
  quiet: boolean
  /** TONICS carried (D-189): each burns one grab — you twist out instead of caught. */
  tonics: number
}

export type DungeonPhase = 'crawl' | 'picking' | 'unlock' | 'caught' | 'won'

export interface PickingTarget {
  readonly kind: 'chest' | 'door' | 'gate'
  readonly id: number
}

/** How far the lamp reaches — Chebyshev, like guard vision. Cut to 8 for the dark (D-180). */
export const VISION_RADIUS = 8
/** Lamp oil never stacks past this many extra tiles — a lamp, not a sunrise (D-189). */
export const LAMP_OIL_CAP = 2
/** How long a tonic-burnt grab leaves the guard reeling before its next stride (D-189). */
export const TONIC_STUN_S = 3

/** The lamp's reach right now — VISION_RADIUS plus whatever oil has been burnt. */
export function lampRadius(s: DungeonRunState): number {
  return VISION_RADIUS + s.player.lampBonus
}

/** How far a wall TORCH throws its pool (D-198) — the wing's own lights, working. */
export const TORCH_LIGHT_RADIUS = 3

/**
 * Cells the wing's TORCHES light right now, as far as the player's eye can reach
 * (D-198): "the lights - they should help to see, right now they are sort of the
 * decoration element." A pool is lit by its torch (line of sight from the flame) and
 * VISIBLE from any distance the player has a clear line to — light carries. Guards'
 * eyes are unchanged: the wing is theirs, the lights help YOU.
 */
export function torchLit(s: DungeonRunState): Set<string> {
  const out = new Set<string>()
  const px = s.player.x
  const py = s.player.y
  for (const pr of s.floor.props) {
    if (pr.kind !== 'torch') continue
    for (let y = pr.y - TORCH_LIGHT_RADIUS; y <= pr.y + TORCH_LIGHT_RADIUS; y += 1) {
      for (let x = pr.x - TORCH_LIGHT_RADIUS; x <= pr.x + TORCH_LIGHT_RADIUS; x += 1) {
        if (x < 0 || x >= s.floor.w || y < 0 || y >= s.floor.h) continue
        const k = `${x},${y}`
        if (out.has(k)) continue
        if (!lineOfSight(s, pr.x, pr.y, x, y)) continue
        if (!lineOfSight(s, px, py, x, y)) continue
        out.add(k)
      }
    }
  }
  return out
}

export interface DungeonRunState {
  readonly floor: DungeonFloor
  readonly player: DungeonPlayer
  readonly enemies: DungeonEnemy[]
  readonly doorOpen: boolean[]
  readonly chestOpen: boolean[]
  /** seen[y][x] — every cell the lamp has ever reached. The map draws only what this holds. */
  readonly seen: boolean[][]
  /** The run clock, in seconds — advance() is the only thing that moves it. */
  time: number
  /** When the player last strode — the stride cadence gate, keyboard and taps alike. */
  lastStepAt: number
  phase: DungeonPhase
  /** The lock being knelt at (picking), or offered the key choice (unlock). */
  picking: PickingTarget | null
  /** Short human lines for the HUD's event ticker, newest last, capped. */
  readonly log: string[]
  /** One-shot: the escape verb is taught the first time anything sees you. */
  hintedRun: boolean
  /** One-shot: the hunter announces itself the first time its fix lands near you. */
  hintedHunter: boolean
  /** What the last chest gave, for the map's FOUND banner — cleared by nothing but time. */
  found: { item: DungeonItem; at: number; label?: string } | null
  /** Rooms the ticker has already announced — each theme introduces itself once (D-189). */
  readonly roomSeen: boolean[]
  /** Valuables banked so far (D-189) — paid on top of the speed score, escape only. */
  treasure: number
  /** While the clock is short of this, the rung bell keeps the whole wing awake. */
  alarmUntil: number
  /** Which alarm bells have been rung — each rings once. */
  readonly bellRung: boolean[]
  /** Doors the PLAYER opened — the key-ring warden relocking one is worth a ticker line. */
  readonly playerOpened: boolean[]
}

export function startDungeon(seed: number): DungeonRunState {
  const floor = generateFloor(seed)
  // Exactly one warden carries the key ring — the first one dealt.
  let keyGiven = false
  const state: DungeonRunState = {
    floor,
    player: {
      x: floor.start.x,
      y: floor.start.y,
      picks: START_PICKS,
      keys: 0,
      tracker: false,
      lampBonus: 0,
      quiet: false,
      tonics: 0,
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
      const keyring = e.kind === 'warden' && !keyGiven
      if (keyring) keyGiven = true
      return {
        id: e.id,
        kind: e.kind,
        x: e.x,
        y: e.y,
        // The hunter wakes with the wing's lights: hunting is its only state (D-182).
        awake: e.kind === 'hunter',
        facing,
        lastSeen: 0,
        patrol: e.patrol,
        wpIndex: 0,
        pace: 0,
        // Open the run mid-sweep: every guard starts on post, gaze turning.
        scan: SCAN_STRIDES,
        keyring,
        bellTarget: null,
        hunt: null,
      }
    }),
    // An UNLOCKED room door stands open on the plan (D-189) — a mouth, not a barrier.
    // Only locked doors start shut.
    doorOpen: floor.doors.map((d) => !d.locked),
    chestOpen: floor.chests.map(() => false),
    seen: Array.from({ length: floor.h }, () => Array.from({ length: floor.w }, () => false)),
    time: 0,
    lastStepAt: -Infinity,
    phase: 'crawl',
    picking: null,
    log: [],
    hintedRun: false,
    hintedHunter: false,
    found: null,
    roomSeen: floor.rooms.map(() => false),
    treasure: 0,
    alarmUntil: 0,
    bellRung: floor.bells.map(() => false),
    playerOpened: floor.doors.map(() => false),
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
  const reach = lampRadius(s)
  for (let y = Math.max(0, py - reach); y <= Math.min(s.floor.h - 1, py + reach); y += 1) {
    for (let x = Math.max(0, px - reach); x <= Math.min(s.floor.w - 1, px + reach); x += 1) {
      if (s.seen[y]?.[x]) continue
      if (lineOfSight(s, px, py, x, y)) (s.seen[y] as boolean[])[x] = true
    }
  }
  // A torch pool the eye can reach inks the plan too (D-198) — light carries.
  for (const k of torchLit(s)) {
    const [x, y] = k.split(',').map(Number) as [number, number]
    ;(s.seen[y] as boolean[])[x] = true
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
  const opaque = (x: number, y: number): boolean => {
    if (!(s.floor.walk[y]?.[x] ?? false)) return true
    const door = doorAt(s, x, y)
    return door !== undefined && !(s.doorOpen[door.id] ?? false)
  }
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  while (x !== x1 || y !== y1) {
    const px = x
    const py = y
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
    // A diagonal stride may not squeeze between two wall corners: when both orthogonal
    // cells flanking the diagonal are opaque, the pinch is solid — the owner's "if rooms
    // are connected by the angle you can see through them" (D-180).
    if (x !== px && y !== py && opaque(x, py) && opaque(px, y)) return false
    if (x === x1 && y === y1) break
    if (opaque(x, y)) return false
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
  // The cone is the WHOLE sight since D-188 — the owner's ruling: "the warden has a
  // surround area, while he will not spot you behind." No neck-hair ring; directly
  // beside or behind an unsuspecting guard is honestly, dangerously safe.
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

/** What a guard's boot can enter. The key ring turns shut doors from walls into cells. */
function guardCan(s: DungeonRunState, x: number, y: number, throughDoors: boolean): boolean {
  if (!throughDoors) return passable(s, x, y)
  if (x < 0 || x >= s.floor.w || y < 0 || y >= s.floor.h) return false
  if (!(s.floor.walk[y]?.[x] ?? false)) return false
  if (chestAt(s, x, y)) return false
  if (s.floor.gate.x === x && s.floor.gate.y === y) return false
  if (enemyAt(s, x, y)) return false
  return true
}

/**
 * One BFS step for a guard toward a target cell — a maze wants routes, not greed: the old
 * sign-stepper wedged on the first corner it met. Other guards block; the player's cell is
 * enterable exactly when it IS the target (that entry is the catch). Returns null when no
 * route stands, which a guard spends standing still. `throughDoors` is the key ring's
 * privilege — shut doors count as floor.
 */
function bfsStep(
  s: DungeonRunState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  throughDoors = false,
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
        if (!guardCan(s, nx, ny, throughDoors) || isPlayer) continue
      } else if (!isPlayer && !guardCan(s, nx, ny, throughDoors)) {
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

/**
 * A guard takes its stride — with the key ring's door bookkeeping: stepping ONTO a shut
 * door swings it open; stepping OFF a door locks it behind, and if that undoes a door the
 * PLAYER picked, the ticker says so (D-181 — the maze's topology is alive).
 */
function guardStride(s: DungeonRunState, e: DungeonEnemy, toX: number, toY: number): void {
  const from = e.keyring ? doorAt(s, e.x, e.y) : undefined
  face(e, toX - e.x, toY - e.y)
  e.x = toX
  e.y = toY
  if (!e.keyring) return
  // Only doors built LOCKED relock behind the key ring (D-189) — an open room mouth
  // was never its to bar.
  if (from && from.locked) {
    if ((s.doorOpen[from.id] ?? false) && (s.playerOpened[from.id] ?? false)) {
      say(s, 'keys jingle — the door you picked is LOCKED again')
    }
    s.doorOpen[from.id] = false
    s.playerOpened[from.id] = false
  }
  const onto = doorAt(s, e.x, e.y)
  if (onto && !(s.doorOpen[onto.id] ?? false)) s.doorOpen[onto.id] = true
}

/** How the logs address a kind — the bestiary's name with its article on. */
const callIt = (kind: EnemyKind): string => `the ${ENEMY_STATS[kind].name}`

/** One quarter-turn clockwise — how a scanning guard sweeps its cone around a post. */
function turnRight(e: DungeonEnemy): void {
  e.facing = e.facing === 'n' ? 'e' : e.facing === 'e' ? 's' : e.facing === 's' ? 'w' : 'n'
}

function wakeOnSight(s: DungeonRunState, e: DungeonEnemy): boolean {
  if (!guardSees(s, e, s.player.x, s.player.y)) return false
  e.awake = true
  e.lastSeen = s.time
  // The startle (D-185): it raises the alarm before its feet move — corner meetings are
  // yours to break first.
  e.pace = -STARTLE_S
  say(s, `${callIt(e.kind)} sees you — RUN`)
  if (!s.hintedRun) {
    s.hintedRun = true
    say(s, `lose it: ${giveUpRange(e.kind)} tiles away, or ${CHASE_MEMORY_S}s unseen`)
  }
  return true
}

/**
 * A guard's hand closes — unless a TONIC burns (D-189): one charge, one grab twisted
 * out of, the guard reeling for TONIC_STUN_S before its next stride. The alarm it
 * raised stays raised; the tonic buys steps, not forgiveness. Returns true when the
 * run truly ends.
 */
function grabbed(s: DungeonRunState, e: DungeonEnemy): boolean {
  if (s.player.tonics > 0) {
    s.player.tonics -= 1
    e.pace = -TONIC_STUN_S
    e.lastSeen = s.time
    say(s, 'the TONIC burns — you twist out of the grab')
    return false
  }
  s.phase = 'caught'
  s.picking = null
  say(s, 'a hand closes on your collar. caught.')
  return true
}

/**
 * One guard's STRIDE. Returns false the moment the player is caught, so the frame stops
 * cold. advance() pays for strides out of each guard's banked seconds — a slow kind's
 * stride simply costs twice what a quick one's does.
 */
function enemyAct(s: DungeonRunState, e: DungeonEnemy): boolean {
  const dist = cheb(e.x, e.y, s.player.x, s.player.y)
  const blind = ENEMY_STATS[e.kind].vision === 0
  /** A stride just sounded within the listener's reach — its ears count as eyes (D-181).
   * SOFT BOOTS (D-189) halve how far a stride carries. */
  const earReach = s.player.quiet ? QUIET_LISTEN_RADIUS : LISTEN_RADIUS
  const hears = blind && s.time - s.lastStepAt < 0.3 && dist <= earReach
  if (!e.awake) {
    // Look first: the 90° cone ahead, walls cutting it, one tile of neck-hair all round.
    if (wakeOnSight(s, e)) return true
    if (hears) {
      e.awake = true
      e.lastSeen = s.time
      e.pace = -STARTLE_S
      say(s, 'the listener turns its head — it HEARS you')
      if (!s.hintedRun) {
        s.hintedRun = true
        say(s, 'stand STILL — it is blind, and memory fades')
      }
      return true
    }
    // The beat: waypoint to waypoint, forever. A blocked hall is a pause on post.
    if (e.patrol.length > 0) {
      const wp = e.patrol[e.wpIndex] as { x: number; y: number }
      if (e.x === wp.x && e.y === wp.y) {
        // On post it SWEEPS: a stride spent turning the cone a quarter around (D-180 —
        // "no suspense": a hall you watched a guard walk out of can light up behind you).
        if (e.scan > 0) {
          e.scan -= 1
          turnRight(e)
          wakeOnSight(s, e)
          return true
        }
        e.wpIndex = (e.wpIndex + 1) % e.patrol.length
      }
      const next = e.patrol[e.wpIndex] as { x: number; y: number }
      const step = bfsStep(s, e.x, e.y, next.x, next.y, e.keyring)
      if (step && !(step.x === s.player.x && step.y === s.player.y) && guardCan(s, step.x, step.y, e.keyring)) {
        guardStride(s, e, step.x, step.y)
        if (e.x === next.x && e.y === next.y) e.scan = SCAN_STRIDES
        // Fresh gaze after the stride: a guard that turns a corner sees down the new hall.
        wakeOnSight(s, e)
      }
    }
    return true
  }
  // The HUNTER (D-182) neither sees nor forgets: every HUNTER_FIX_S it fixes where you
  // ARE and walks there at a third of your pace — arriving early only re-fixes sooner.
  // No sight to break, no memory to cool, no leash to outrun. It just keeps coming.
  if (e.kind === 'hunter') {
    if (!e.hunt || s.time - e.hunt.at >= HUNTER_FIX_S || (e.x === e.hunt.x && e.y === e.hunt.y)) {
      e.hunt = { x: s.player.x, y: s.player.y, at: s.time }
      if (!s.hintedHunter && dist <= 10) {
        s.hintedHunter = true
        say(s, 'the HUNTER has your scent — it does not stop')
      }
    }
  } else {
    // Alerted, it swivels — the cone is for the unsuspecting; a chaser sees all round
    // within its sight, walls permitting, and remembers you for CHASE_MEMORY_S seconds.
    // The listener's swivel is its ears: only your strides refresh it.
    const seesNow =
      dist <= ENEMY_STATS[e.kind].vision && lineOfSight(s, e.x, e.y, s.player.x, s.player.y)
    if (seesNow || hears) e.lastSeen = s.time
    // The chase breaks two ways: run past one-and-a-half sights, or stay out of its senses
    // until its memory cools. Two exemptions from the distance leash: the blind (silence is
    // the only thing that sheds a listener) and a warden on its BELL errand — it is running
    // AWAY from you by design, and only a cooled memory calls it off.
    // A bell errand holds its purpose twice as long as a chase holds its prey — at half
    // pace (D-185) no bell would ever ring on a plain 3.5s memory. Still breakable.
    const memoryS = e.bellTarget !== null ? CHASE_MEMORY_S * 2 : CHASE_MEMORY_S
    if (
      (!blind && e.bellTarget === null && dist > giveUpRange(e.kind)) ||
      s.time - e.lastSeen > memoryS
    ) {
      e.awake = false
      e.bellTarget = null
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
  }
  // The grab: while you kneel at a lock — or hang over the key choice — arm's reach is
  // enough. Real time means the labyrinth no longer waits for you to decide (D-180).
  if ((s.phase === 'picking' || s.phase === 'unlock') && dist === 1) {
    return !grabbed(s, e)
  }
  // A seen WARDEN is a runner, not a fighter (D-181): it makes for the nearest unrung
  // bell, and the wing wakes if it arrives. Break its memory before that and nothing rings.
  if (e.kind === 'warden' && s.floor.bells.length > 0) {
    if (e.bellTarget === null || (s.bellRung[e.bellTarget] ?? false)) {
      e.bellTarget = null
      let bi = -1
      let bd = Infinity
      s.floor.bells.forEach((b, i) => {
        if (s.bellRung[i] ?? false) return
        const d = Math.abs(b.x - e.x) + Math.abs(b.y - e.y)
        if (d < bd) {
          bd = d
          bi = i
        }
      })
      if (bi >= 0) {
        e.bellTarget = bi
        say(s, 'the warden runs for the BELL')
      }
    }
    const bell = e.bellTarget !== null ? s.floor.bells[e.bellTarget] : undefined
    if (bell) {
      if (cheb(e.x, e.y, bell.x, bell.y) <= 1) {
        s.bellRung[e.bellTarget as number] = true
        e.bellTarget = null
        s.alarmUntil = s.time + ALARM_S
        say(s, 'the BELL RINGS — the whole wing wakes')
        return true
      }
      const step = bfsStep(s, e.x, e.y, bell.x, bell.y, e.keyring)
      if (step && !(step.x === s.player.x && step.y === s.player.y) && guardCan(s, step.x, step.y, e.keyring)) {
        guardStride(s, e, step.x, step.y)
        return true
      }
      // No road toward the bell this stride — fall through and chase like anybody.
    }
  }
  // What the chaser heads for: you, when its senses hold you; the hunter walks its FIX
  // (D-182), which may be seconds stale.
  let tx = s.player.x
  let ty = s.player.y
  if (e.kind === 'hunter' && e.hunt) {
    tx = e.hunt.x
    ty = e.hunt.y
  }
  const step = bfsStep(s, e.x, e.y, tx, ty, e.keyring)
  if (!step) return true
  if (step.x === s.player.x && step.y === s.player.y) {
    if (s.phase === 'picking' || s.phase === 'unlock' || s.phase === 'crawl') {
      return !grabbed(s, e)
    }
    return true
  }
  if (guardCan(s, step.x, step.y, e.keyring)) {
    guardStride(s, e, step.x, step.y)
  }
  return true
}

/**
 * The world moves: hand it the frame's seconds and every guard strides as often as its
 * pace affords. Called every frame the run is alive — crawling, kneeling at a lock, or
 * hanging over the key choice. Nothing pauses the labyrinth (D-180, bug 7).
 */
export function advance(s: DungeonRunState, seconds: number): void {
  if (s.phase === 'caught' || s.phase === 'won') return
  const dt = Math.min(Math.max(seconds, 0), MAX_FRAME_S)
  const wasAlarm = s.time < s.alarmUntil
  s.time += dt
  if (s.time < s.alarmUntil) {
    // The rung bell (D-181): the whole wing awake, nobody's memory cooling — for ALARM_S
    // seconds there is no losing them, only outlasting it.
    for (const e of s.enemies) {
      e.awake = true
      e.lastSeen = s.time
    }
  } else if (wasAlarm) {
    say(s, 'the wing settles — they have not forgotten your face')
  }
  for (const e of s.enemies) {
    e.pace += dt
    const stride = enemyStepSeconds(e.kind)
    while (e.pace >= stride) {
      e.pace -= stride
      if (!enemyAct(s, e)) return
    }
  }
}

function openChest(s: DungeonRunState, chest: DungeonChestDef): void {
  s.chestOpen[chest.id] = true
  const p = s.player
  const item = chest.loot.item
  // The FOUND banner: the map announces the haul in your face, not just the ticker.
  s.found = chest.loot.label ? { item, at: s.time, label: chest.loot.label } : { item, at: s.time }
  if (item === 'pick') {
    p.picks += 1
    say(s, 'chest: a spare pick')
  } else if (item === 'skeleton-key') {
    p.keys += 1
    say(s, 'chest: a SKELETON KEY — it will skip one lock')
  } else if (item === 'tracker') {
    p.tracker = true
    say(s, 'chest: the MOTION TRACKER — it paints them red, walls or not')
  } else if (item === 'lamp-oil') {
    // The oil burns for the rest of the run — a tile of reach per flask, capped.
    if (p.lampBonus < LAMP_OIL_CAP) {
      p.lampBonus += 1
      say(s, 'chest: LAMP OIL — the lamp reaches a tile further')
      revealAround(s)
    } else {
      say(s, 'chest: lamp oil — the lamp already burns its brightest')
    }
  } else if (item === 'soft-boots') {
    if (!p.quiet) {
      p.quiet = true
      say(s, 'chest: SOFT BOOTS — your strides carry half as far')
    } else {
      say(s, 'chest: soft boots. yours are already quiet')
    }
  } else if (item === 'map-fragment') {
    // The archivist's gift: the whole wing's WALLS, inked. Not its guards — the map
    // knows the building, never the shift roster.
    for (const row of s.seen) row.fill(true)
    say(s, 'chest: a MAP of the wing — every wall, inked')
  } else if (item === 'tonic') {
    p.tonics += 1
    say(s, 'chest: a TONIC — one grab will not hold you')
  } else if (item === 'valuables') {
    const value = chest.loot.value ?? 0
    s.treasure += value
    say(s, `chest: ${chest.loot.label ?? 'valuables'} — worth ${value} at the gate`)
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
 * is not a legal move — bumping a wall or a guard costs nothing, not even the stride
 * timer. Strides are paced at PLAYER_STEP_S: the app may call this every frame while a
 * key is held; the clock decides which calls are strides.
 */
export function movePlayer(s: DungeonRunState, dx: number, dy: number): void {
  if (s.phase !== 'crawl') return
  if (Math.abs(dx) + Math.abs(dy) !== 1) return
  // The epsilon absorbs float drift: a frame clock summing 0.22s strides lands a hair
  // short, and a stride owed at 0.2199999… must not be refused.
  if (s.time - s.lastStepAt < PLAYER_STEP_S - 1e-6) return
  const nx = s.player.x + dx
  const ny = s.player.y + dy

  // A guard is a wall with eyes — there is no swinging at anyone (D-177).
  if (enemyAt(s, nx, ny)) return

  const chest = chestAt(s, nx, ny)
  if (chest && !(s.chestOpen[chest.id] ?? false)) {
    s.lastStepAt = s.time
    if (chest.locked) {
      kneelAt(s, { kind: 'chest', id: chest.id })
      return
    }
    openChest(s, chest)
    return
  }
  if (chest) return // an opened chest is furniture

  const door = doorAt(s, nx, ny)
  if (door && !(s.doorOpen[door.id] ?? false)) {
    s.lastStepAt = s.time
    kneelAt(s, { kind: 'door', id: door.id })
    return
  }

  if (nx === s.floor.gate.x && ny === s.floor.gate.y) {
    s.lastStepAt = s.time
    kneelAt(s, { kind: 'gate', id: 0 })
    return
  }

  if (!passable(s, nx, ny)) return
  s.lastStepAt = s.time
  s.player.x = nx
  s.player.y = ny
  revealAround(s)
  // A room introduces itself the first time you cross its mouth (D-189): the theme's
  // name and what its keepers left behind — the ticker as a tour guide.
  const room = roomAt(s.floor, nx, ny)
  if (room && !(s.roomSeen[room.id] ?? false)) {
    s.roomSeen[room.id] = true
    const spec = ROOM_THEMES[room.theme]
    say(s, `${spec.name} — ${spec.line}`)
  }
}

/** The key choice: spend a skeleton key and the lock simply opens. The clock ran regardless. */
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
    s.playerOpened[target.id] = true
    say(s, 'the skeleton key turns. the door swings open')
    revealAround(s)
  }
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
    s.playerOpened[target.id] = true
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
      // The snap is a sighting for the ears: memory starts NOW, so the guard walks the
      // sound down for CHASE_MEMORY_S before it shrugs — an investigation, not a shrug.
      e.lastSeen = s.time
      e.pace = -STARTLE_S
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
 * Everyone's ears (D-181): the nearest guard within FOOTSTEP_RADIUS that the lamp does
 * NOT currently hold — a direction for the strip's whisper, or null for silence. What you
 * can already see needs no whisper.
 */
export function footsteps(s: DungeonRunState): 'north' | 'south' | 'east' | 'west' | null {
  let best: DungeonEnemy | null = null
  let bestD = Infinity
  for (const e of s.enemies) {
    const d = cheb(e.x, e.y, s.player.x, s.player.y)
    if (d === 0 || d > FOOTSTEP_RADIUS || d >= bestD) continue
    if (d <= lampRadius(s) && lineOfSight(s, s.player.x, s.player.y, e.x, e.y)) continue
    bestD = d
    best = e
  }
  if (!best) return null
  const dx = best.x - s.player.x
  const dy = best.y - s.player.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west'
  return dy > 0 ? 'south' : 'north'
}

/**
 * What the run is worth: SPEED, plus whatever VALUABLES made it out in your coat
 * (D-189). The base decays three points a second; the floor keeps a slow escape from
 * reading as worthless... and a caught run banks nothing, which the app enforces —
 * this function only prices an escape.
 */
export function dungeonScore(s: DungeonRunState): number {
  if (s.phase !== 'won') return 0
  return Math.max(ESCAPE_FLOOR, Math.round(ESCAPE_BASE - s.time * SCORE_PER_SECOND)) + s.treasure
}
