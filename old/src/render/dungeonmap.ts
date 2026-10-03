/**
 * The dungeon floor, drawn as the drafting document it always wanted to be — `docs/DUNGEON.md`.
 *
 * A crawler map in this game's art language is simply a floor plan: rooms as outlined floor,
 * walls as the strokes between carved and uncarved cells, doors as their architectural swing
 * arcs, chests and enemies as small instrument glyphs. Fog is the plan's own honesty — the
 * machine's `seen` grid says what the lamp has reached, and this module draws nothing else;
 * what is seen but not currently lit stays as dim structure, the way a surveyor's pencil
 * keeps yesterday's rooms.
 *
 * This module owns geometry and drawing only. It reads the run state and never writes to it.
 */

import {
  ENEMY_STATS,
  FOOTSTEP_RADIUS,
  FOUND_TOAST_S,
  LISTEN_RADIUS,
  QUIET_LISTEN_RADIUS,
  TRACKER_RADIUS,
  footsteps,
  guardSees,
  lampRadius,
  lineOfSight,
  torchLit,
  trackerNear,
  type DungeonRunState,
} from '../game/dungeonRun'
import { ROOM_THEMES, roomAt, type EnemyKind, type RoomTheme } from '../game/dungeon'
import { text } from './draw'
import { drawGauntletArt, drawGauntletSprite, type GauntletArtId } from './gauntletart'
import { LOGICAL_WIDTH, isCompact, typeFor, type Viewport } from './viewport'
import { STROKE, TYPE, alpha, font, readableAccents, type Palette } from './palette'

type CreatureSpriteId = Extract<GauntletArtId, `sprite-${string}`>

const CREATURE_SPRITE: Record<EnemyKind | 'picker', CreatureSpriteId> = {
  warden: 'sprite-warden',
  sentry: 'sprite-sentry',
  listener: 'sprite-listener',
  hunter: 'sprite-hunter',
  picker: 'sprite-picker',
}

/**
 * A creature drawn SMALL (D-183) — the map's living figures, replacing the bestiary
 * letters ("instead of W as warden — small images, for everything, to make it more
 * alive"). Pure ink strokes, so every theme and size stays crisp; scale 1 fills a 36px
 * tile. The same hand draws the briefing and guide legends, so what you read is what
 * walks. 'picker' is the player.
 */
export function drawCreatureGlyph(
  ctx: CanvasRenderingContext2D,
  kind: EnemyKind | 'picker',
  cx: number,
  cy: number,
  scale: number,
  stroke: string,
  amber: string,
): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  ctx.strokeStyle = stroke
  ctx.fillStyle = stroke
  ctx.lineWidth = STROKE.standard
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (kind === 'warden') {
    // Heavyset coat, flat cap, the lantern on its chain — slow rounds made flesh.
    ctx.beginPath()
    ctx.moveTo(-3.4, -9.6)
    ctx.lineTo(3.4, -9.6)
    ctx.moveTo(2.6, -6.6)
    ctx.arc(0, -6.6, 2.6, 0, Math.PI * 2)
    ctx.moveTo(-4.6, -3.6)
    ctx.lineTo(4.6, -3.6)
    ctx.moveTo(-4.6, -3.6)
    ctx.lineTo(-3.4, 8)
    ctx.moveTo(4.6, -3.6)
    ctx.lineTo(3.4, 8)
    ctx.moveTo(-3.4, 8)
    ctx.lineTo(3.4, 8)
    ctx.moveTo(0, -3.6)
    ctx.lineTo(0, 8)
    ctx.moveTo(4.6, -2.4)
    ctx.lineTo(6.8, -0.8)
    ctx.stroke()
    ctx.fillStyle = amber
    ctx.beginPath()
    ctx.arc(7.2, 1, 1.9, 0, Math.PI * 2)
    ctx.fill()
  } else if (kind === 'sentry') {
    // A human lighthouse: rigid vertical, the staff, the unblinking pair of eyes.
    ctx.beginPath()
    ctx.ellipse(0, -8.6, 2.9, 2.4, 0, 0, Math.PI * 2)
    ctx.moveTo(0, -6.2)
    ctx.lineTo(0, 8)
    ctx.moveTo(-3.2, -4.4)
    ctx.lineTo(3.2, -4.4)
    ctx.moveTo(-2.2, 8)
    ctx.lineTo(2.2, 8)
    ctx.moveTo(5.6, -11)
    ctx.lineTo(5.6, 8)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(5.6, -11.7, 1.1, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(-1, -8.8, 0.6, 0, Math.PI * 2)
    ctx.arc(1.2, -8.8, 0.6, 0, Math.PI * 2)
    ctx.fill()
  } else if (kind === 'listener') {
    // The tilted hood and the great ear it turns to the world.
    ctx.beginPath()
    ctx.moveTo(1.6, -11)
    ctx.lineTo(-4, -3.6)
    ctx.lineTo(4.6, -3.6)
    ctx.closePath()
    ctx.moveTo(-4, -3.6)
    ctx.lineTo(-2.8, 8)
    ctx.moveTo(4.6, -3.6)
    ctx.lineTo(3.2, 8)
    ctx.moveTo(-2.8, 8)
    ctx.lineTo(3.2, 8)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(5.2, -6.2, 3, -Math.PI / 2, Math.PI / 2)
    ctx.moveTo(5.2, -7.4)
    ctx.arc(5.2, -6.2, 1.3, -Math.PI / 2, Math.PI / 2)
    ctx.stroke()
  } else if (kind === 'hunter') {
    // The void in a travelling coat: the only solid figure the map owns.
    ctx.beginPath()
    ctx.moveTo(0, -11.5)
    ctx.lineTo(-6.4, -3)
    ctx.lineTo(-5.2, 8.5)
    ctx.lineTo(5.2, 8.5)
    ctx.lineTo(6.4, -3)
    ctx.closePath()
    ctx.fill()
  } else {
    // The picker — you: quick feet mid-stride, one hand always ahead for the next lock.
    ctx.beginPath()
    ctx.arc(0, -7.4, 2.4, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, -5)
    ctx.lineTo(0, 3)
    ctx.moveTo(0, -3.2)
    ctx.lineTo(4.4, -1.2)
    ctx.moveTo(0, -3.2)
    ctx.lineTo(-3.6, 0.4)
    ctx.moveTo(0, 3)
    ctx.lineTo(-3.4, 8.4)
    ctx.moveTo(0, 3)
    ctx.lineTo(3.4, 8.4)
    ctx.stroke()
  }
  ctx.restore()
}

/** The drawing grid: every glyph below is authored against 36px cells, unchanged. */
export const TILE = 36
/**
 * What a cell measures ON SCREEN since D-185: the whole map plane renders under a 2×
 * transform ("the icons are very small — increase the size of the tiles twice"), and a
 * CAMERA of VIEW_W×VIEW_H cells follows the player across the floor.
 */
export const SCREEN_TILE = 72
export const VIEW_W = 24
export const VIEW_H = 11
export const MAP_X = (LOGICAL_WIDTH - VIEW_W * SCREEN_TILE) / 2
export const MAP_Y = 116

// The camera's top-left cell — set by drawDungeonMap each frame, read by the tap zones.
let camX = 0
let camY = 0

/**
 * A cell in DRAWING coordinates (36px, camera-relative) — correct inside the map's 2×
 * transform, which every internal draw call runs under.
 */
export function tileRect(x: number, y: number): { x: number; y: number; w: number; h: number } {
  return { x: MAP_X + (x - camX) * TILE, y: MAP_Y + (y - camY) * TILE, w: TILE, h: TILE }
}

/** A cell in SCREEN coordinates — what a finger actually touches. */
export function tapTileRect(x: number, y: number): { x: number; y: number; w: number; h: number } {
  return {
    x: MAP_X + (x - camX) * SCREEN_TILE,
    y: MAP_Y + (y - camY) * SCREEN_TILE,
    w: SCREEN_TILE,
    h: SCREEN_TILE,
  }
}

/** The cells the lamp — and the wing's own torches (D-198) — light right now. */
export function visibleNow(s: DungeonRunState): Set<string> {
  const out = new Set<string>()
  const px = s.player.x
  const py = s.player.y
  const reach = lampRadius(s) // burnt LAMP OIL widens the circle (D-189)
  for (let y = Math.max(0, py - reach); y <= Math.min(s.floor.h - 1, py + reach); y += 1) {
    for (let x = Math.max(0, px - reach); x <= Math.min(s.floor.w - 1, px + reach); x += 1) {
      if (lineOfSight(s, px, py, x, y)) out.add(`${x},${y}`)
    }
  }
  for (const k of torchLit(s)) out.add(k)
  out.add(`${px},${py}`)
  return out
}

export function drawDungeonMap(
  vp: Viewport,
  p: Palette,
  s: DungeonRunState,
  visible: Set<string>,
): void {
  const { ctx } = vp
  const readable = readableAccents(p)
  const lit = (x: number, y: number): boolean => visible.has(`${x},${y}`)
  const seen = (x: number, y: number): boolean => s.seen[y]?.[x] ?? false
  const walk = (x: number, y: number): boolean => s.floor.walk[y]?.[x] ?? false
  const hasDrain = (x: number, y: number): boolean =>
    s.floor.props.some(
      (prop) =>
        prop.x === x && prop.y === y && (prop.kind === 'drain' || prop.kind === 'puddle'),
    )
  const tileFor = (x: number, y: number): GauntletArtId => {
    if (!walk(x, y)) return 'wall-block'
    if (hasDrain(x, y)) return 'water-drain-floor'
    if (roomAt(s.floor, x, y)) return 'chamber-floor'
    return 'corridor-floor'
  }
  // Each theme leans one of the plan's readable hues (D-189): warm for the lived rooms,
  // cold for the wet ones, bruised for the grim — recognition before the plate loads.
  const themeWash = (theme: RoomTheme): string => {
    const cold: RoomTheme[] = ['well', 'laundry', 'cellar', 'storeroom', 'infirmary', 'library', 'archive']
    const grim: RoomTheme[] = ['cells', 'torture', 'crypt']
    return cold.includes(theme) ? readable.teal : grim.includes(theme) ? readable.violet : readable.amber
  }
  // The GRIM set (D-193): corridors and walls deal per-tile variants from a position
  // hash — deterministic, camera-independent — so a hall reads as one build with bad
  // patches: bones swept to an edge here, a seep down the stones there. Absent plates
  // simply fall back to the base tile, the loader's standing rule.
  const GRIM_CORRIDOR: readonly GauntletArtId[] = [
    'corridor-floor-bones', 'corridor-floor-damp', 'corridor-floor-scratched',
  ]
  const GRIM_WALL: readonly GauntletArtId[] = [
    'wall-block-chained', 'wall-block-tally', 'wall-block-seep',
  ]
  const grimRoll = (x: number, y: number): number => {
    let h = (x * 374761393 + y * 668265263) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) % 100
  }

  // ── The camera (D-185): the view window follows the player, clamped to the floor ──────
  camX = Math.max(0, Math.min(s.floor.w - VIEW_W, s.player.x - Math.floor(VIEW_W / 2)))
  camY = Math.max(0, Math.min(s.floor.h - VIEW_H, s.player.y - Math.floor(VIEW_H / 2)))
  // Everything on the map plane draws at its authored 36px under a 2× transform about the
  // map origin — twice the owner asked for, once the code changes. The clip keeps cone
  // paint and glyph overhang from cells outside the window off the rest of the page.
  ctx.save()
  ctx.translate(MAP_X, MAP_Y)
  ctx.scale(2, 2)
  ctx.translate(-MAP_X, -MAP_Y)
  ctx.beginPath()
  ctx.rect(MAP_X, MAP_Y, VIEW_W * TILE, VIEW_H * TILE)
  ctx.clip()
  const viewX0 = camX
  const viewX1 = Math.min(s.floor.w, camX + VIEW_W)
  const viewY0 = camY
  const viewY1 = Math.min(s.floor.h, camY + VIEW_H)

  // ── THE DARK (D-197): "It's not dark, the lights make no sense" ───────────────────────
  // The map window is a HOLE in the drafting page now: unseen ground is this near-black,
  // remembered ground is drawn whole and then VEILED back into it, and only the lamp's
  // pool stays bright paper. One ground truth — bright is NOW, dim is memory, black is
  // unknown — instead of three near-identical shades of paper.
  const THE_DARK = p.name === 'blueprint' ? '#04080e' : '#161310'
  ctx.fillStyle = THE_DARK
  ctx.fillRect(MAP_X, MAP_Y, VIEW_W * TILE, VIEW_H * TILE)

  // ── Floor and walls ───────────────────────────────────────────────────────────────────
  ctx.save()
  for (let y = viewY0; y < viewY1; y += 1) {
    for (let x = viewX0; x < viewX1; x += 1) {
      if (!seen(x, y)) continue
      const r = tileRect(x, y)
      const floorCell = walk(x, y)
      // Every seen tile draws at FULL brightness now (D-197) — the veil after the
      // furniture is what puts memory into the dark, uniformly, objects included.
      ctx.fillStyle = p.paperShade
      ctx.fillRect(r.x, r.y, r.w, r.h)
      const room = floorCell ? roomAt(s.floor, x, y) : undefined
      const opacity = floorCell ? 0.62 : 0.4
      // A themed room draws its own plate the moment its art exists (D-189); the plain
      // chamber floor stands in until that drop lands. Either way the theme's wash
      // tints the ground, so a library never reads as a kitchen even before the art.
      // Corridors and walls try their GRIM variant first (D-193), base tile as ever.
      const id = tileFor(x, y)
      const roll = grimRoll(x, y)
      const variant =
        id === 'corridor-floor' && roll < 36
          ? GRIM_CORRIDOR[roll % 3]
          : id === 'wall-block' && roll < 30
            ? GRIM_WALL[roll % 3]
            : undefined
      if (!(room && drawGauntletArt(ctx, `room-${room.theme}` as GauntletArtId, r.x, r.y, r.w, r.h, p, opacity))) {
        if (!(variant && drawGauntletArt(ctx, variant, r.x, r.y, r.w, r.h, p, opacity))) {
          drawGauntletArt(ctx, id, r.x, r.y, r.w, r.h, p, opacity)
        }
      }
      if (room && room.theme !== 'gatehouse') {
        ctx.fillStyle = alpha(themeWash(room.theme), 0.08)
        ctx.fillRect(r.x, r.y, r.w, r.h)
      }
    }
  }
  // Wall strokes: every edge between a seen floor cell and anything uncarved. Drawing the
  // boundary rather than the wall cells is what makes it read as a *plan*.
  ctx.strokeStyle = p.ink
  ctx.lineWidth = STROKE.standard
  ctx.beginPath()
  for (let y = viewY0; y < viewY1; y += 1) {
    for (let x = viewX0; x < viewX1; x += 1) {
      if (!seen(x, y) || !walk(x, y)) continue
      const r = tileRect(x, y)
      if (!walk(x, y - 1)) {
        ctx.moveTo(r.x, r.y)
        ctx.lineTo(r.x + r.w, r.y)
      }
      if (!walk(x, y + 1)) {
        ctx.moveTo(r.x, r.y + r.h)
        ctx.lineTo(r.x + r.w, r.y + r.h)
      }
      if (!walk(x - 1, y)) {
        ctx.moveTo(r.x, r.y)
        ctx.lineTo(r.x, r.y + r.h)
      }
      if (!walk(x + 1, y)) {
        ctx.moveTo(r.x + r.w, r.y)
        ctx.lineTo(r.x + r.w, r.y + r.h)
      }
    }
  }
  ctx.stroke()
  ctx.restore()

  // ── Room names on the plan (D-189): a surveyor's annotation over each themed room ─────
  // Raw fillText, deliberately not the probe's text(): plan lettering lives under the
  // map's 2× transform, and the audit would read its coordinates from the wrong space.
  // A name that will not fit between its own walls is simply not written.
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = font(9)
  for (const room of s.floor.rooms) {
    let anySeen = false
    for (let y = room.y0; y <= room.y1 && !anySeen; y += 1) {
      for (let x = room.x0; x <= room.x1 && !anySeen; x += 1) if (seen(x, y)) anySeen = true
    }
    if (!anySeen) continue
    const label = ROOM_THEMES[room.theme].name.replace(/^the /, '')
    const r0 = tileRect(room.x0, room.y0)
    const r1 = tileRect(room.x1, room.y1)
    if (ctx.measureText(label).width > r1.x + TILE - r0.x - 6) continue
    ctx.fillStyle = alpha(p.ink, 0.5)
    ctx.fillText(label, (r0.x + r1.x + TILE) / 2, r0.y + 10)
  }
  ctx.restore()

  // ── The way you came in — barred behind you. Drawn as jail bars, because it is one. ───
  if (seen(s.floor.entrance.x, s.floor.entrance.y)) {
    const r = tileRect(s.floor.entrance.x, s.floor.entrance.y)
    ctx.save()
    ctx.strokeStyle = alpha(p.ink, 0.7)
    ctx.lineWidth = STROKE.standard
    ctx.beginPath()
    for (let b = 0; b < 4; b += 1) {
      const bx = r.x + 6 + b * 8
      ctx.moveTo(bx, r.y + 5)
      ctx.lineTo(bx, r.y + r.h - 5)
    }
    ctx.moveTo(r.x + 3, r.y + 5)
    ctx.lineTo(r.x + r.w - 3, r.y + 5)
    ctx.moveTo(r.x + 3, r.y + r.h - 5)
    ctx.lineTo(r.x + r.w - 3, r.y + r.h - 5)
    ctx.stroke()
    ctx.restore()
  }

  // ── THE GATE — the way out, drawn to be recognised the moment the lamp finds it ───────
  if (seen(s.floor.gate.x, s.floor.gate.y)) {
    const r = tileRect(s.floor.gate.x, s.floor.gate.y)
    const cx = r.x + r.w / 2
    ctx.save()
    ctx.strokeStyle = readable.teal
    ctx.lineWidth = STROKE.heavy
    // Heavy jambs and an arch — a portal, not a door.
    ctx.beginPath()
    ctx.moveTo(r.x + 4, r.y + r.h - 3)
    ctx.lineTo(r.x + 4, r.y + 10)
    ctx.quadraticCurveTo(cx, r.y - 2, r.x + r.w - 4, r.y + 10)
    ctx.lineTo(r.x + r.w - 4, r.y + r.h - 3)
    ctx.stroke()
    // Portcullis bars.
    ctx.lineWidth = STROKE.standard
    ctx.beginPath()
    for (let b = 0; b < 3; b += 1) {
      const bx = r.x + 11 + b * 7
      ctx.moveTo(bx, r.y + 8)
      ctx.lineTo(bx, r.y + r.h - 4)
    }
    ctx.stroke()
    // The hardest lock they own, in amber.
    ctx.fillStyle = readable.amber
    ctx.beginPath()
    ctx.arc(cx, r.y + r.h / 2 + 3, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // ── Set dressing — under everything that matters, over the bare floor ─────────────────
  // Torch flames burn amber only while the lamp actually reaches them: lit rooms read warm,
  // remembered ones cold — the same honesty the fog already keeps.
  for (const pr of s.floor.props) {
    if (!seen(pr.x, pr.y)) continue
    const r = tileRect(pr.x, pr.y)
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    ctx.save()
    if (pr.kind === 'torch') {
      const rot =
        pr.side === 'n' ? 0 : pr.side === 'e' ? Math.PI / 2 : pr.side === 's' ? Math.PI : -Math.PI / 2
      ctx.translate(cx, cy)
      ctx.rotate(rot)
      // Bracket pinned to the wall edge, stem into the room, flame at its tip.
      ctx.strokeStyle = p.ink
      ctx.lineWidth = STROKE.standard
      ctx.beginPath()
      ctx.moveTo(-5, -r.h / 2 + 3)
      ctx.lineTo(5, -r.h / 2 + 3)
      ctx.moveTo(0, -r.h / 2 + 3)
      ctx.lineTo(0, -r.h / 2 + 13)
      ctx.stroke()
      ctx.fillStyle = lit(pr.x, pr.y) ? readable.amber : alpha(p.ink, 0.35)
      ctx.beginPath()
      ctx.ellipse(0, -r.h / 2 + 17, 3.4, 5, 0, 0, Math.PI * 2)
      ctx.fill()
    } else if (pr.kind === 'grass') {
      ctx.strokeStyle = alpha(readable.teal, 0.6)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.moveTo(cx - 5, cy + 8)
      ctx.lineTo(cx - 8, cy - 2)
      ctx.moveTo(cx, cy + 8)
      ctx.lineTo(cx, cy - 4)
      ctx.moveTo(cx + 5, cy + 8)
      ctx.lineTo(cx + 8, cy - 1)
      ctx.stroke()
    } else if (pr.kind === 'rubble') {
      ctx.strokeStyle = alpha(p.ink, 0.45)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.arc(cx - 6, cy + 4, 2.6, 0, Math.PI * 2)
      ctx.moveTo(cx + 5, cy + 6)
      ctx.arc(cx + 2, cy + 6, 3.2, 0, Math.PI * 2)
      ctx.moveTo(cx + 9, cy - 1)
      ctx.arc(cx + 7, cy - 1, 2.2, 0, Math.PI * 2)
      ctx.stroke()
    } else if (pr.kind === 'bones') {
      ctx.strokeStyle = alpha(p.ink, 0.5)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.moveTo(cx - 6, cy + 6)
      ctx.lineTo(cx + 4, cy - 2)
      ctx.moveTo(cx - 6, cy - 2)
      ctx.lineTo(cx + 4, cy + 6)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx + 6, cy - 4, 3, 0, Math.PI * 2)
      ctx.stroke()
    } else if (pr.kind === 'web') {
      // Spun against its wall: arcs fanning from the wall edge, two radials through them.
      const rot =
        pr.side === 'n' ? 0 : pr.side === 'e' ? Math.PI / 2 : pr.side === 's' ? Math.PI : -Math.PI / 2
      ctx.translate(cx, cy)
      ctx.rotate(rot)
      ctx.strokeStyle = alpha(p.ink, 0.32)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      for (const rr of [5, 9, 13]) ctx.arc(0, -r.h / 2, rr, Math.PI * 0.15, Math.PI * 0.85)
      ctx.moveTo(0, -r.h / 2)
      ctx.lineTo(-8, -r.h / 2 + 12)
      ctx.moveTo(0, -r.h / 2)
      ctx.lineTo(8, -r.h / 2 + 12)
      ctx.stroke()
    } else if (pr.kind === 'puddle') {
      ctx.strokeStyle = alpha(readable.teal, 0.4)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.ellipse(cx - 2, cy + 4, 8, 4, 0, 0, Math.PI * 2)
      ctx.moveTo(cx + 8, cy - 2)
      ctx.ellipse(cx + 5, cy - 2, 3, 1.8, 0, 0, Math.PI * 2)
      ctx.stroke()
    } else if (pr.kind === 'crack') {
      ctx.strokeStyle = alpha(p.ink, 0.4)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.moveTo(cx - 9, cy - 6)
      ctx.lineTo(cx - 2, cy - 1)
      ctx.lineTo(cx - 4, cy + 4)
      ctx.lineTo(cx + 6, cy + 8)
      ctx.moveTo(cx - 2, cy - 1)
      ctx.lineTo(cx + 5, cy - 3)
      ctx.stroke()
    } else if (pr.kind === 'mushroom') {
      ctx.strokeStyle = alpha(p.violet, 0.55)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.moveTo(cx - 3, cy + 7)
      ctx.lineTo(cx - 3, cy + 1)
      ctx.moveTo(cx + 4, cy + 7)
      ctx.lineTo(cx + 4, cy + 3)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx - 3, cy + 1, 4, Math.PI, 0)
      ctx.moveTo(cx + 7, cy + 3)
      ctx.arc(cx + 4, cy + 3, 3, Math.PI, 0)
      ctx.stroke()
    } else if (pr.kind === 'candle') {
      ctx.strokeStyle = alpha(p.ink, 0.55)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.moveTo(cx, cy + 7)
      ctx.lineTo(cx, cy - 1)
      ctx.moveTo(cx - 4, cy + 7)
      ctx.lineTo(cx + 4, cy + 7)
      ctx.stroke()
      ctx.fillStyle = lit(pr.x, pr.y) ? readable.amber : alpha(p.ink, 0.35)
      ctx.beginPath()
      ctx.ellipse(cx, cy - 4, 2, 3.2, 0, 0, Math.PI * 2)
      ctx.fill()
    } else if (pr.kind === 'chain') {
      // Three links draped diagonally.
      ctx.strokeStyle = alpha(p.ink, 0.45)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      for (let li = 0; li < 3; li += 1) {
        const lx = cx - 6 + li * 5
        const ly = cy - 4 + li * 4
        ctx.moveTo(lx + 2.6, ly)
        ctx.arc(lx, ly, 2.6, 0, Math.PI * 2)
      }
      ctx.stroke()
    } else if (pr.kind === 'drain') {
      // A floor drain: ring with three grate bars — the prison's plumbing.
      ctx.strokeStyle = alpha(p.ink, 0.42)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.arc(cx, cy + 2, 7, 0, Math.PI * 2)
      ctx.moveTo(cx - 4, cy - 2)
      ctx.lineTo(cx - 4, cy + 6)
      ctx.moveTo(cx, cy - 3)
      ctx.lineTo(cx, cy + 7)
      ctx.moveTo(cx + 4, cy - 2)
      ctx.lineTo(cx + 4, cy + 6)
      ctx.stroke()
    } else if (pr.kind === 'bench') {
      // A wall bench: slab on two legs, pushed to its wall.
      const rot =
        pr.side === 'n' ? 0 : pr.side === 'e' ? Math.PI / 2 : pr.side === 's' ? Math.PI : -Math.PI / 2
      ctx.translate(cx, cy)
      ctx.rotate(rot)
      ctx.strokeStyle = alpha(p.ink, 0.5)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.moveTo(-9, -r.h / 2 + 8)
      ctx.lineTo(9, -r.h / 2 + 8)
      ctx.moveTo(-7, -r.h / 2 + 8)
      ctx.lineTo(-7, -r.h / 2 + 14)
      ctx.moveTo(7, -r.h / 2 + 8)
      ctx.lineTo(7, -r.h / 2 + 14)
      ctx.stroke()
    } else if (pr.kind === 'pipe') {
      // A run of pipe along the wall with one joint collar.
      const rot =
        pr.side === 'n' ? 0 : pr.side === 'e' ? Math.PI / 2 : pr.side === 's' ? Math.PI : -Math.PI / 2
      ctx.translate(cx, cy)
      ctx.rotate(rot)
      ctx.strokeStyle = alpha(p.ink, 0.45)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.moveTo(-r.w / 2 + 2, -r.h / 2 + 6)
      ctx.lineTo(r.w / 2 - 2, -r.h / 2 + 6)
      ctx.moveTo(-r.w / 2 + 2, -r.h / 2 + 9)
      ctx.lineTo(r.w / 2 - 2, -r.h / 2 + 9)
      ctx.moveTo(2, -r.h / 2 + 4)
      ctx.lineTo(2, -r.h / 2 + 11)
      ctx.moveTo(5, -r.h / 2 + 4)
      ctx.lineTo(5, -r.h / 2 + 11)
      ctx.stroke()
    } else if (pr.kind === 'stain') {
      // An old stain seeped into the stones — a blotched outline, nothing more said.
      ctx.strokeStyle = alpha(p.ink, 0.28)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.moveTo(cx - 7, cy + 1)
      ctx.quadraticCurveTo(cx - 8, cy - 5, cx - 2, cy - 4)
      ctx.quadraticCurveTo(cx + 3, cy - 7, cx + 6, cy - 2)
      ctx.quadraticCurveTo(cx + 9, cy + 3, cx + 3, cy + 5)
      ctx.quadraticCurveTo(cx - 3, cy + 8, cx - 7, cy + 1)
      ctx.moveTo(cx + 9, cy + 6)
      ctx.arc(cx + 8, cy + 6, 1.4, 0, Math.PI * 2)
      ctx.stroke()
    } else if (pr.kind === 'sign') {
      // A scratched plate on the wall: frame and two illegible lines.
      const rot =
        pr.side === 'n' ? 0 : pr.side === 'e' ? Math.PI / 2 : pr.side === 's' ? Math.PI : -Math.PI / 2
      ctx.translate(cx, cy)
      ctx.rotate(rot)
      ctx.strokeStyle = alpha(p.ink, 0.5)
      ctx.lineWidth = STROKE.hairline
      ctx.strokeRect(-7, -r.h / 2 + 4, 14, 10)
      ctx.beginPath()
      ctx.moveTo(-4, -r.h / 2 + 7.5)
      ctx.lineTo(4, -r.h / 2 + 7.5)
      ctx.moveTo(-4, -r.h / 2 + 10.5)
      ctx.lineTo(1, -r.h / 2 + 10.5)
      ctx.stroke()
    } else if (pr.kind === 'shelf') {
      // A wall shelf (D-189): bracket rail and the spines leaning on it — the library's
      // signature, and the storeroom's.
      const rot =
        pr.side === 'n' ? 0 : pr.side === 'e' ? Math.PI / 2 : pr.side === 's' ? Math.PI : -Math.PI / 2
      ctx.translate(cx, cy)
      ctx.rotate(rot)
      ctx.strokeStyle = alpha(p.ink, 0.5)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.moveTo(-9, -r.h / 2 + 13)
      ctx.lineTo(9, -r.h / 2 + 13)
      for (let b = 0; b < 5; b += 1) {
        const bx = -7 + b * 3.2
        ctx.moveTo(bx, -r.h / 2 + 13)
        ctx.lineTo(bx + (b === 2 ? 1.6 : 0), -r.h / 2 + 5)
      }
      ctx.stroke()
    } else if (pr.kind === 'table') {
      // A table in plan view: the slab and its four corner legs.
      ctx.strokeStyle = alpha(p.ink, 0.5)
      ctx.lineWidth = STROKE.hairline
      ctx.strokeRect(cx - 9, cy - 5, 18, 11)
      ctx.beginPath()
      for (const [lx, ly] of [
        [-7, -3],
        [7, -3],
        [-7, 4],
        [7, 4],
      ] as const) {
        ctx.moveTo(cx + lx - 1, cy + ly)
        ctx.lineTo(cx + lx + 1, cy + ly)
      }
      ctx.stroke()
    } else if (pr.kind === 'anvil') {
      // The forge's anvil: horn, face and the block it stands on.
      ctx.strokeStyle = alpha(p.ink, 0.55)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.moveTo(-8 + cx, cy - 3)
      ctx.lineTo(6 + cx, cy - 3)
      ctx.quadraticCurveTo(cx + 10, cy - 2, cx + 6, cy)
      ctx.lineTo(cx - 6, cy)
      ctx.lineTo(cx - 8, cy - 3)
      ctx.moveTo(cx - 4, cy)
      ctx.lineTo(cx - 4, cy + 5)
      ctx.moveTo(cx + 4, cy)
      ctx.lineTo(cx + 4, cy + 5)
      ctx.moveTo(cx - 6, cy + 5)
      ctx.lineTo(cx + 6, cy + 5)
      ctx.stroke()
    } else if (pr.kind === 'altar') {
      // A stone altar: the slab, its plinth, one small flame above.
      ctx.strokeStyle = alpha(p.ink, 0.5)
      ctx.lineWidth = STROKE.hairline
      ctx.strokeRect(cx - 7, cy - 1, 14, 4)
      ctx.beginPath()
      ctx.moveTo(cx - 5, cy + 3)
      ctx.lineTo(cx - 5, cy + 7)
      ctx.moveTo(cx + 5, cy + 3)
      ctx.lineTo(cx + 5, cy + 7)
      ctx.moveTo(cx - 7, cy + 7)
      ctx.lineTo(cx + 7, cy + 7)
      ctx.stroke()
      ctx.fillStyle = lit(pr.x, pr.y) ? readable.amber : alpha(p.ink, 0.35)
      ctx.beginPath()
      ctx.ellipse(cx, cy - 4.5, 1.8, 2.8, 0, 0, Math.PI * 2)
      ctx.fill()
    } else if (pr.kind === 'barrel') {
      // A barrel on end: two hoops around its round plan.
      ctx.strokeStyle = alpha(p.ink, 0.5)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.arc(cx - 3, cy + 1, 6, 0, Math.PI * 2)
      ctx.moveTo(cx + 1, cy + 1)
      ctx.arc(cx - 3, cy + 1, 4, 0, Math.PI * 2)
      ctx.moveTo(cx + 9, cy - 4)
      ctx.arc(cx + 6, cy - 4, 3, 0, Math.PI * 2)
      ctx.stroke()
    } else if (pr.kind === 'bed') {
      // A bunk in plan: the frame and its turned-back blanket line.
      ctx.strokeStyle = alpha(p.ink, 0.5)
      ctx.lineWidth = STROKE.hairline
      ctx.strokeRect(cx - 9, cy - 6, 18, 12)
      ctx.beginPath()
      ctx.moveTo(cx - 4, cy - 6)
      ctx.lineTo(cx - 4, cy + 6)
      ctx.moveTo(cx - 9, cy)
      ctx.lineTo(cx - 4, cy)
      ctx.stroke()
    } else if (pr.kind === 'rack') {
      // The rack (D-189): a frame, its rollers, the ropes nobody asks about.
      const rot =
        pr.side === 'n' ? 0 : pr.side === 'e' ? Math.PI / 2 : pr.side === 's' ? Math.PI : -Math.PI / 2
      ctx.translate(cx, cy)
      ctx.rotate(rot)
      ctx.strokeStyle = alpha(p.ink, 0.55)
      ctx.lineWidth = STROKE.hairline
      ctx.strokeRect(-9, -r.h / 2 + 4, 18, 12)
      ctx.beginPath()
      ctx.arc(-6, -r.h / 2 + 10, 1.8, 0, Math.PI * 2)
      ctx.moveTo(7.8, -r.h / 2 + 10)
      ctx.arc(6, -r.h / 2 + 10, 1.8, 0, Math.PI * 2)
      ctx.moveTo(-4, -r.h / 2 + 10)
      ctx.lineTo(4, -r.h / 2 + 10)
      ctx.stroke()
    } else {
      // cauldron — the kitchen's pot: a fat arc on three legs, steam as one curl.
      ctx.strokeStyle = alpha(p.ink, 0.55)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.arc(cx, cy + 1, 6, Math.PI * 0.05, Math.PI * 0.95)
      ctx.moveTo(cx - 6, cy + 1)
      ctx.lineTo(cx + 6, cy + 1)
      ctx.moveTo(cx - 4, cy + 6.5)
      ctx.lineTo(cx - 5, cy + 8.5)
      ctx.moveTo(cx + 4, cy + 6.5)
      ctx.lineTo(cx + 5, cy + 8.5)
      ctx.moveTo(cx, cy + 7)
      ctx.lineTo(cx, cy + 8.5)
      ctx.moveTo(cx + 1, cy - 2)
      ctx.quadraticCurveTo(cx + 3.5, cy - 5, cx + 1.5, cy - 8)
      ctx.stroke()
    }
    ctx.restore()
  }

  // ── Doors, as their swing arcs ────────────────────────────────────────────────────────
  for (const d of s.floor.doors) {
    if (!seen(d.x, d.y)) continue
    const open = s.doorOpen[d.id] ?? false
    const r = tileRect(d.x, d.y)
    ctx.save()
    ctx.strokeStyle = open ? alpha(p.ink, 0.45) : p.ink
    ctx.lineWidth = STROKE.standard
    // The leaf: shut is a bar across the cell; open is the leaf against the jamb plus the
    // drafting arc every plan gives a door.
    ctx.beginPath()
    if (open) {
      ctx.moveTo(r.x + 4, r.y + r.h - 4)
      ctx.lineTo(r.x + 4, r.y + 4)
      ctx.arc(r.x + 4, r.y + r.h - 4, r.h - 8, -Math.PI / 2, 0)
    } else {
      // A shut door reads as a *door*, not a dash: the leaf across the opening, framed by
      // its two jambs — the owner read the first draft's single line as nothing at all.
      ctx.moveTo(r.x + 5, r.y + 5)
      ctx.lineTo(r.x + 5, r.y + r.h - 5)
      ctx.moveTo(r.x + r.w - 5, r.y + 5)
      ctx.lineTo(r.x + r.w - 5, r.y + r.h - 5)
      ctx.rect(r.x + 8, r.y + r.h / 2 - 5, r.w - 16, 10)
    }
    ctx.stroke()
    if (!open && d.locked) {
      ctx.fillStyle = readable.amber
      ctx.beginPath()
      ctx.arc(r.x + r.w / 2, r.y + r.h / 2 - 8, 3.4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  // ── Chests — three carpenters, one per style, so a room's furniture varies ────────────
  for (const c of s.floor.chests) {
    if (!seen(c.x, c.y)) continue
    const open = s.chestOpen[c.id] ?? false
    const r = tileRect(c.x, c.y)
    const cx = r.x + r.w / 2
    const midY = r.y + r.h / 2
    ctx.save()
    ctx.strokeStyle = open ? alpha(p.ink, 0.45) : p.ink
    ctx.lineWidth = STROKE.standard
    if (c.style === 1) {
      // The strongbox: squarer body, two riveted straps, a flat lid.
      ctx.strokeRect(cx - 12, midY - 6, 24, 15)
      ctx.beginPath()
      if (open) {
        ctx.moveTo(cx - 12, midY - 6)
        ctx.lineTo(cx - 15, r.y + 4)
        ctx.moveTo(cx + 12, midY - 6)
        ctx.lineTo(cx + 15, r.y + 4)
      } else {
        ctx.moveTo(cx - 12, midY - 6)
        ctx.lineTo(cx + 12, midY - 6)
        ctx.moveTo(cx - 6, midY - 6)
        ctx.lineTo(cx - 6, midY + 9)
        ctx.moveTo(cx + 6, midY - 6)
        ctx.lineTo(cx + 6, midY + 9)
      }
      ctx.stroke()
    } else if (c.style === 2) {
      // The coffer: narrow and tall, an X-braced face under a shallow lid.
      ctx.strokeRect(cx - 9, midY - 8, 18, 17)
      ctx.beginPath()
      if (open) {
        ctx.moveTo(cx - 9, midY - 8)
        ctx.lineTo(cx - 12, r.y + 3)
        ctx.moveTo(cx + 9, midY - 8)
        ctx.lineTo(cx + 12, r.y + 3)
      } else {
        ctx.moveTo(cx - 9, midY - 8)
        ctx.lineTo(cx + 9, midY + 9)
        ctx.moveTo(cx + 9, midY - 8)
        ctx.lineTo(cx - 9, midY + 9)
      }
      ctx.stroke()
    } else {
      // The banded chest, the original: domed lid over a low body.
      ctx.strokeRect(cx - 11, midY - 4, 22, 12)
      ctx.beginPath()
      if (open) {
        ctx.moveTo(cx - 11, midY - 4)
        ctx.lineTo(cx - 13, r.y + 5)
        ctx.moveTo(cx + 11, midY - 4)
        ctx.lineTo(cx + 13, r.y + 5)
      } else {
        ctx.moveTo(cx - 11, midY - 4)
        ctx.quadraticCurveTo(cx, r.y + 4, cx + 11, midY - 4)
      }
      ctx.stroke()
    }
    if (!open && c.locked) {
      ctx.fillStyle = readable.amber
      ctx.beginPath()
      ctx.arc(cx, midY + 2, 3.4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  // ── The alarm bells (D-181): wall-hung, amber while unrung, dim once spent ────────────
  for (let i = 0; i < s.floor.bells.length; i += 1) {
    const b = s.floor.bells[i] as { x: number; y: number; side: 'n' | 'e' | 's' | 'w' }
    if (!seen(b.x, b.y)) continue
    const rung = s.bellRung[i] ?? false
    const r = tileRect(b.x, b.y)
    const rot =
      b.side === 'n' ? 0 : b.side === 'e' ? Math.PI / 2 : b.side === 's' ? Math.PI : -Math.PI / 2
    ctx.save()
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2)
    ctx.rotate(rot)
    ctx.strokeStyle = rung ? alpha(p.ink, 0.4) : readable.amber
    ctx.lineWidth = STROKE.standard
    // The bracket, the bell's skirt, and its clapper.
    ctx.beginPath()
    ctx.moveTo(-4, -r.h / 2 + 3)
    ctx.lineTo(4, -r.h / 2 + 3)
    ctx.moveTo(0, -r.h / 2 + 3)
    ctx.lineTo(0, -r.h / 2 + 6)
    ctx.arc(0, -r.h / 2 + 12, 6.5, Math.PI * 1.05, Math.PI * 1.95)
    ctx.moveTo(-6.5, -r.h / 2 + 14)
    ctx.lineTo(6.5, -r.h / 2 + 14)
    ctx.stroke()
    ctx.fillStyle = rung ? alpha(p.ink, 0.4) : readable.amber
    ctx.beginPath()
    ctx.arc(0, -r.h / 2 + 16.5, 1.8, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // ── THE VEIL (D-197): memory sinks into the dark ──────────────────────────────────────
  // Every seen-but-unlit tile — floors, walls, doors, chests, traps, remains, labels,
  // all of it already drawn whole above — dims uniformly under one wash of the dark.
  // What the lamp holds right now stays bright paper; there is no third brightness.
  ctx.save()
  ctx.fillStyle = alpha(THE_DARK, 0.62)
  for (let y = viewY0; y < viewY1; y += 1) {
    for (let x = viewX0; x < viewX1; x += 1) {
      if (!seen(x, y) || lit(x, y)) continue
      const r = tileRect(x, y)
      ctx.fillRect(r.x, r.y, r.w, r.h)
    }
  }
  ctx.restore()

  // ── Guards — only what the lamp lights right now ──────────────────────────────────────
  // Each kind is its bestiary LETTER: W warden, h hound, s sentry. The letter is the
  // identity; colour carries state — ink on its beat, crimson when it is chasing YOU.
  // Under every lit guard, its CONE of sight is painted where your own lamp can vouch for
  // it (D-178): the danger is a shape on the floor you route around, not a number.
  for (const e of s.enemies) {
    if (!lit(e.x, e.y)) continue
    const stats = ENEMY_STATS[e.kind]
    ctx.save()
    ctx.fillStyle = alpha(readable.crimson, e.awake ? 0.18 : 0.1)
    for (let y = e.y - stats.vision; y <= e.y + stats.vision; y += 1) {
      for (let x = e.x - stats.vision; x <= e.x + stats.vision; x += 1) {
        if (x === e.x && y === e.y) continue
        if (!visible.has(`${x},${y}`)) continue
        if (!guardSees(s, e, x, y)) continue
        const cr = tileRect(x, y)
        ctx.fillRect(cr.x, cr.y, cr.w, cr.h)
      }
    }
    // The LISTENER'S EAR-FIELD (D-190): "it's not obvious how to measure your
    // footsteps" — so its hearing is painted exactly the way sight cones are: the
    // square of ground where a STRIDE is a sighting, walls no bar. Soft boots shrink
    // the painted field live, which is the boots' value made visible. A hatch-line
    // border marks the measured edge; inside, the same crimson wash as any cone.
    if (e.kind === 'listener') {
      const reach = s.player.quiet ? QUIET_LISTEN_RADIUS : LISTEN_RADIUS
      ctx.fillStyle = alpha(readable.crimson, e.awake ? 0.14 : 0.07)
      for (let y = e.y - reach; y <= e.y + reach; y += 1) {
        for (let x = e.x - reach; x <= e.x + reach; x += 1) {
          if (x === e.x && y === e.y) continue
          if (!seen(x, y) || !walk(x, y)) continue
          const cr = tileRect(x, y)
          ctx.fillRect(cr.x, cr.y, cr.w, cr.h)
        }
      }
      const er = tileRect(e.x - reach, e.y - reach)
      ctx.strokeStyle = alpha(readable.crimson, e.awake ? 0.5 : 0.3)
      ctx.lineWidth = STROKE.hairline
      ctx.setLineDash([5, 4])
      ctx.strokeRect(er.x, er.y, (reach * 2 + 1) * TILE, (reach * 2 + 1) * TILE)
      ctx.setLineDash([])
    }
    ctx.restore()
  }
  for (const e of s.enemies) {
    if (!lit(e.x, e.y)) continue
    const r = tileRect(e.x, e.y)
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    // The bob (D-183): every figure breathes on the run clock — quicker when hunting.
    // Presentation only; the machine never reads it.
    const bob = Math.sin(s.time * (e.awake ? 9 : 4.5) + e.id * 1.7) * (e.awake ? 1.4 : 0.9)
    ctx.save()
    if (e.awake) {
      // A chasing guard gets a warning ring — the map's own alarm bell.
      ctx.strokeStyle = alpha(readable.crimson, 0.55)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.arc(cx, cy, 14, 0, Math.PI * 2)
      ctx.stroke()
    }
    // Crimson while it hunts, the theme's own ink otherwise (blueprint needs its LIGHT
    // ink); profile sprites walk the way they face (D-184).
    const spriteTint = e.awake ? readable.crimson : p.name === 'blueprint' ? p.ink : null
    const mirror = e.kind === 'warden' && e.facing === 'e'
    if (!drawGauntletSprite(ctx, CREATURE_SPRITE[e.kind], cx, cy + bob, TILE, spriteTint, mirror)) {
      drawCreatureGlyph(
        ctx,
        e.kind,
        cx,
        cy + bob,
        1,
        e.awake ? readable.crimson : p.ink,
        readable.amber,
      )
    }
    // The key-ring warden wears its office: a small amber ring at its shoulder.
    if (e.keyring) {
      ctx.strokeStyle = readable.amber
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.arc(cx + 11, cy - 10, 3.2, 0, Math.PI * 2)
      ctx.stroke()
    }
    // No facing wedge since D-188 ("remove triangles") — the painted cone IS the facing.
    ctx.restore()
  }

  // ── The motion tracker paints RED DOTS (D-188): "it should reveal the enemies" ───────
  // Every guard inside its reach — walls ignored, lamp or no lamp — lands as a pulsing
  // crimson dot. What the lamp already shows is drawn as its figure above; the dots are
  // for the ones you cannot see. Reach 8 outruns the window's half-height, so a dot
  // past the camera's edge PINS to the border along its bearing (D-189) — clipped
  // silence would be the tracker failing at exactly its job.
  if (s.player.tracker) {
    const pulse = 0.5 + 0.3 * Math.sin(s.time * 5)
    const inset = 12
    for (const e of s.enemies) {
      const d = Math.max(Math.abs(e.x - s.player.x), Math.abs(e.y - s.player.y))
      if (d > TRACKER_RADIUS || lit(e.x, e.y)) continue
      const r = tileRect(e.x, e.y)
      const cx = Math.max(MAP_X + inset, Math.min(MAP_X + VIEW_W * TILE - inset, r.x + r.w / 2))
      const cy = Math.max(MAP_Y + inset, Math.min(MAP_Y + VIEW_H * TILE - inset, r.y + r.h / 2))
      ctx.save()
      ctx.fillStyle = alpha(readable.crimson, pulse)
      ctx.beginPath()
      ctx.arc(cx, cy, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  // ── The player — a little picker, not a token (D-183) ────────────────────────────────
  {
    const r = tileRect(s.player.x, s.player.y)
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    // A short hop on each stride, timed off the run clock — alive, never sim-relevant.
    const sinceStep = s.time - s.lastStepAt
    const hop = sinceStep >= 0 && sinceStep < 0.25 ? Math.sin((sinceStep / 0.25) * Math.PI) * -1.8 : 0
    ctx.save()
    // The paper halo keeps you findable over floor clutter, as the old token was.
    ctx.fillStyle = alpha(p.paper, 0.85)
    ctx.beginPath()
    ctx.arc(cx, cy, 10, 0, Math.PI * 2)
    ctx.fill()
    if (
      !drawGauntletSprite(
        ctx,
        CREATURE_SPRITE.picker,
        cx,
        cy + hop,
        TILE,
        p.name === 'blueprint' ? p.ink : null,
      )
    ) {
      drawCreatureGlyph(ctx, 'picker', cx, cy + hop, 1, p.ink, readable.amber)
    }
    ctx.restore()
  }

  // ── Danger bearings (D-187): "show in the map from where danger is coming" ───────────
  // Every guard your EARS hold but your lamp does not gets a pulsing crimson chevron on
  // the view's edge, pointing up its bearing — the whisper, drawn.
  {
    const pr = tileRect(s.player.x, s.player.y)
    const pcx = pr.x + pr.w / 2
    const pcy = pr.y + pr.h / 2
    const inset = 14
    const bx0 = MAP_X + inset
    const by0 = MAP_Y + inset
    const bx1 = MAP_X + VIEW_W * TILE - inset
    const by1 = MAP_Y + VIEW_H * TILE - inset
    const pulse = 0.45 + 0.3 * Math.sin(s.time * 6)
    for (const e of s.enemies) {
      const d = Math.max(Math.abs(e.x - s.player.x), Math.abs(e.y - s.player.y))
      if (d === 0 || d > FOOTSTEP_RADIUS) continue
      if (d <= lampRadius(s) && lineOfSight(s, s.player.x, s.player.y, e.x, e.y)) continue
      const dx = e.x - s.player.x
      const dy = e.y - s.player.y
      const len = Math.hypot(dx, dy) || 1
      const ux = dx / len
      const uy = dy / len
      // Walk the ray to the border box.
      let t = Infinity
      if (ux > 0) t = Math.min(t, (bx1 - pcx) / ux)
      if (ux < 0) t = Math.min(t, (bx0 - pcx) / ux)
      if (uy > 0) t = Math.min(t, (by1 - pcy) / uy)
      if (uy < 0) t = Math.min(t, (by0 - pcy) / uy)
      if (!Number.isFinite(t)) continue
      const gx = pcx + ux * t
      const gy = pcy + uy * t
      ctx.save()
      ctx.translate(gx, gy)
      ctx.rotate(Math.atan2(uy, ux))
      ctx.fillStyle = alpha(readable.crimson, pulse)
      ctx.beginPath()
      ctx.moveTo(10, 0)
      ctx.lineTo(-6, -8)
      ctx.lineTo(-2, 0)
      ctx.lineTo(-6, 8)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }

  // The map plane's 2× transform ends here — the panel below is screen-space UI.
  ctx.restore()

  // ── The STATUS BOARD (D-185): "the game may be very fast and the information about ────
  // who heard what is not very visible" — a framed panel under the camera, with the
  // clock and kit at reading size, THREAT lines in crimson (who hunts, who heard, who
  // runs for a bell), and the ticker in its own measured column.
  const compact = isCompact(vp)
  const panelX = MAP_X
  // Full pages keep the board clear of the Guide/report column on the right.
  const panelW = VIEW_W * SCREEN_TILE - (compact ? 0 : 350)
  const panelY = MAP_Y + VIEW_H * SCREEN_TILE + 14
  const panelH = 1080 - panelY - 46
  const dim = typeFor(vp, TYPE.dimension)
  const bodySize = typeFor(vp, TYPE.body)
  const alarmOn = s.time < s.alarmUntil
  ctx.save()
  ctx.fillStyle = p.paperShade
  ctx.fillRect(panelX, panelY, panelW, panelH)
  ctx.strokeStyle = p.ink
  ctx.lineWidth = STROKE.standard
  ctx.strokeRect(panelX, panelY, panelW, panelH)
  ctx.restore()

  // What is COMING for you, most urgent first — the panel's whole reason (D-185).
  const cheb2 = (ax: number, ay: number, bx: number, by: number): number =>
    Math.max(Math.abs(ax - bx), Math.abs(ay - by))
  const threats: { line: string; hot: boolean }[] = []
  if (alarmOn) threats.push({ line: 'ALARM — the wing hunts as one', hot: true })
  for (const e of s.enemies) {
    if (threats.length >= 2) break
    if (!e.awake || e.kind === 'hunter') continue
    const name = ENEMY_STATS[e.kind].name
    if (e.kind === 'warden' && e.bellTarget !== null) {
      threats.push({ line: `the ${name} RUNS FOR THE BELL`, hot: true })
    } else if (e.kind === 'listener') {
      threats.push({ line: 'the listener HEARD you', hot: true })
    } else {
      threats.push({ line: `the ${name} HUNTS you`, hot: true })
    }
  }
  if (threats.length < 2) {
    const hunter = s.enemies.find((e) => e.kind === 'hunter')
    if (hunter && cheb2(hunter.x, hunter.y, s.player.x, s.player.y) <= 10) {
      threats.push({ line: 'the HUNTER is close', hot: true })
    }
  }
  if (threats.length < 2) {
    const steps = footsteps(s)
    if (steps) threats.push({ line: `footsteps to the ${steps}…`, hot: false })
  }

  const row1 = panelY + (compact ? bodySize * 1.05 : 40)
  const clock = `${Math.floor(Math.max(0, s.time) / 60)}:${String(Math.floor(Math.max(0, s.time)) % 60).padStart(2, '0')}${alarmOn ? ' · ALARM' : ''}`
  text(vp.ctx, clock, panelX + 24, row1, {
    font: font(Math.round(bodySize * (compact ? 1 : 1.25)), 'bold'),
    color: alarmOn ? readable.crimson : p.ink,
  })
  {
    const g = bodySize * 1.25
    const vy = row1 - g * 0.3
    ctx.save()
    // The kit row clears the CLOCK by measure, not by faith (D-190): '· ALARM' grows
    // the clock past the old fixed offset, and the ear-field screenshot caught the
    // word striking through the key icon.
    ctx.font = font(Math.round(bodySize * (compact ? 1 : 1.25)), 'bold')
    const clockW = ctx.measureText(clock).width
    let ix = panelX + 24 + Math.max(bodySize * (compact ? 5.4 : 6.6), clockW + g * 0.9)
    ctx.font = font(dim)
    const numberAt = (n: string): void => {
      text(vp.ctx, n, ix, row1, { font: font(dim), color: p.ink })
      ix += ctx.measureText(n).width + g * 0.9
    }
    ctx.strokeStyle = p.ink
    ctx.lineWidth = STROKE.standard

    // The pick: a shaft with its upturned hook.
    ctx.beginPath()
    ctx.moveTo(ix, vy + g * 0.1)
    ctx.lineTo(ix + g * 0.55, vy + g * 0.1)
    ctx.quadraticCurveTo(ix + g * 0.75, vy + g * 0.1, ix + g * 0.72, vy - g * 0.14)
    ctx.moveTo(ix, vy + g * 0.02)
    ctx.lineTo(ix, vy + g * 0.18)
    ctx.stroke()
    ix += g * 0.9
    numberAt(String(s.player.picks))

    // The skeleton key: a ring bow, a shaft, two teeth.
    {
      const bx = ix + g * 0.18
      ctx.beginPath()
      ctx.arc(bx, vy - g * 0.1, g * 0.16, 0, Math.PI * 2)
      ctx.moveTo(bx, vy + g * 0.06)
      ctx.lineTo(bx, vy + g * 0.34)
      ctx.moveTo(bx, vy + g * 0.34)
      ctx.lineTo(bx + g * 0.16, vy + g * 0.34)
      ctx.moveTo(bx, vy + g * 0.22)
      ctx.lineTo(bx + g * 0.12, vy + g * 0.22)
      ctx.stroke()
      ix += g * 0.62
      numberAt(String(s.player.keys))
    }

    // The motion tracker, once carried: a dish and its blip — crimson with a count while
    // anything walks within its reach ("shows if enemy is nearby").
    if (s.player.tracker) {
      const near = trackerNear(s)
      const hot = near > 0
      ctx.strokeStyle = hot ? readable.crimson : p.ink
      ctx.beginPath()
      ctx.arc(ix + g * 0.3, vy + g * 0.1, g * 0.3, -Math.PI * 0.85, -Math.PI * 0.15)
      ctx.arc(ix + g * 0.3, vy + g * 0.1, g * 0.18, -Math.PI * 0.85, -Math.PI * 0.15)
      ctx.stroke()
      ctx.fillStyle = hot ? readable.crimson : p.ink
      ctx.beginPath()
      ctx.arc(ix + g * 0.3, vy + g * 0.1, 2.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = p.ink
      ix += g * 0.8
      if (hot) {
        text(vp.ctx, `${near} near`, ix, row1, { font: font(dim, 'bold'), color: readable.crimson })
        ctx.font = font(dim, 'bold')
        ix += ctx.measureText(`${near} near`).width + g * 0.9
        ctx.font = font(dim)
      } else {
        text(vp.ctx, 'quiet', ix, row1, { font: font(dim), color: p.inkLight })
        ix += ctx.measureText('quiet').width + g * 0.9
      }
    }

    // The themed rooms' kit (D-189), drawn only once carried — the board stays lean.
    // Lamp oil: a flask with its wick-neck, and how far past 8 the lamp reaches now.
    if (s.player.lampBonus > 0) {
      ctx.beginPath()
      ctx.moveTo(ix + g * 0.12, vy - g * 0.16)
      ctx.lineTo(ix + g * 0.28, vy - g * 0.16)
      ctx.moveTo(ix + g * 0.2, vy - g * 0.16)
      ctx.lineTo(ix + g * 0.2, vy - g * 0.02)
      ctx.moveTo(ix + g * 0.34, vy + g * 0.16)
      ctx.arc(ix + g * 0.2, vy + g * 0.16, g * 0.14, 0, Math.PI * 2)
      ctx.stroke()
      ix += g * 0.52
      numberAt(`+${s.player.lampBonus}`)
    }
    // Soft boots: one sole, toes forward. No number — quiet is quiet.
    if (s.player.quiet) {
      ctx.beginPath()
      ctx.ellipse(ix + g * 0.16, vy + g * 0.04, g * 0.11, g * 0.2, -0.25, 0, Math.PI * 2)
      ctx.moveTo(ix + g * 0.3, vy + g * 0.3)
      ctx.ellipse(ix + g * 0.22, vy + g * 0.3, g * 0.08, g * 0.05, -0.25, 0, Math.PI * 2)
      ctx.stroke()
      ix += g * 0.55
    }
    // Tonics: the vial, with how many grabs it still buys.
    if (s.player.tonics > 0) {
      ctx.beginPath()
      ctx.moveTo(ix + g * 0.1, vy - g * 0.14)
      ctx.lineTo(ix + g * 0.26, vy - g * 0.14)
      ctx.moveTo(ix + g * 0.13, vy - g * 0.14)
      ctx.lineTo(ix + g * 0.13, vy + g * 0.28)
      ctx.lineTo(ix + g * 0.23, vy + g * 0.28)
      ctx.lineTo(ix + g * 0.23, vy - g * 0.14)
      ctx.stroke()
      ix += g * 0.48
      numberAt(String(s.player.tonics))
    }
    // Valuables already in the coat: what escaping is worth on top of speed.
    if (s.treasure > 0) {
      text(vp.ctx, `+${s.treasure}`, ix, row1, { font: font(dim, 'bold'), color: readable.amber })
      ctx.font = font(dim, 'bold')
      ix += ctx.measureText(`+${s.treasure}`).width + g * 0.9
      ctx.font = font(dim)
    }
    ctx.restore()
  }

  if (compact) {
    // One more row: the loudest threat, or the newest ticker line — big type owns little room.
    const row2 = row1 + dim * 1.2
    const threat = threats[0]
    if (threat) {
      text(vp.ctx, threat.line, panelX + 24, row2, {
        font: font(dim, threat.hot ? 'bold' : undefined),
        color: readable.crimson,
      })
    } else {
      const last = s.log[s.log.length - 1]
      if (last) {
        ctx.save()
        ctx.font = font(dim)
        let line = last
        while (line.length > 4 && ctx.measureText(line).width > panelW - 48) {
          line = line.slice(0, -4)
        }
        ctx.restore()
        text(vp.ctx, line, panelX + 24, row2, { font: font(dim), color: p.inkLight })
      }
    }
  } else {
    // Threat lines at reading size, mid-panel — and an honest idle line when nothing
    // hunts, so the slot never reads as a rendering hole.
    const threatX = panelX + 540
    if (threats.length === 0) {
      text(vp.ctx, 'quiet — for now', threatX, panelY + 40, {
        font: font(dim),
        color: p.inkLight,
      })
    }
    threats.slice(0, 2).forEach((t, i) => {
      text(vp.ctx, t.line, threatX, panelY + 40 + i * 34, {
        font: font(t.hot ? bodySize : dim, t.hot ? 'bold' : undefined),
        color: readable.crimson,
      })
    })
    // The ticker: a measured column inside the board's right edge. Whole entries,
    // newest first — a wrapped sighting must never lose its head for an older tail.
    const logRight = panelX + panelW - 24
    const logW = 400
    const slots = 3
    ctx.save()
    ctx.font = font(dim)
    const wrapLine = (line: string): string[] => {
      const out: string[] = []
      let row = ''
      for (const word of line.split(' ')) {
        const tryRow = row === '' ? word : `${row} ${word}`
        if (ctx.measureText(tryRow).width <= logW || row === '') row = tryRow
        else {
          out.push(row)
          row = word
        }
      }
      if (row !== '') out.push(row)
      return out
    }
    const rows: string[] = []
    for (let i = s.log.length - 1; i >= 0 && rows.length < slots; i -= 1) {
      const wrapped = wrapLine(s.log[i] as string)
      if (rows.length > 0 && rows.length + wrapped.length > slots) break
      rows.unshift(...wrapped.slice(0, slots))
    }
    ctx.restore()
    rows.slice(0, slots).forEach((line, i) => {
      text(vp.ctx, line, logRight, panelY + 30 + i * (dim + 8), {
        font: font(dim),
        color: p.inkLight,
        align: 'right',
      })
    })
  }

  // ── The FOUND banner: what the chest just gave, in your face, then gone ───────────────
  // The owner's ask (D-180): the ticker whispers, this announces. A card over the map's
  // top edge for FOUND_TOAST_S, timed off the run clock so a pause cannot stretch it.
  if (s.found && s.time - s.found.at < FOUND_TOAST_S) {
    const CARD: Partial<Record<Exclude<typeof s.found.item, null>, [string, string]>> = {
      'pick': ['FOUND: A SPARE PICK', 'one more try in your coat'],
      'skeleton-key': ['FOUND: A SKELETON KEY', 'skips one lock — the gate counts'],
      'tracker': ['FOUND: THE MOTION TRACKER', 'paints them red, walls or not'],
      'lamp-oil': ['FOUND: LAMP OIL', 'the lamp reaches a tile further'],
      'soft-boots': ['FOUND: SOFT BOOTS', 'your strides carry half as far'],
      'map-fragment': ['FOUND: A MAP OF THE WING', 'every wall, inked'],
      'tonic': ['FOUND: A TONIC', 'one grab will not hold you'],
      'valuables': [
        `FOUND: ${(s.found.label ?? 'valuables').toUpperCase()}`,
        'worth its weight — if you make the gate',
      ],
    }
    const [title, sub] = (s.found.item && CARD[s.found.item]) ?? ['EMPTY. DUST.', 'someone was here first']
    const bodySz = typeFor(vp, TYPE.body)
    const dimSz = typeFor(vp, TYPE.dimension)
    ctx.save()
    ctx.font = font(bodySz, 'bold')
    const titleW = ctx.measureText(title).width
    ctx.font = font(dimSz)
    const subW = ctx.measureText(sub).width
    const w = Math.max(titleW, subW) + 72
    const h = bodySz + dimSz + 46
    const bx = MAP_X + (VIEW_W * SCREEN_TILE - w) / 2
    const by = MAP_Y + 10
    ctx.fillStyle = p.paperShade
    ctx.fillRect(bx, by, w, h)
    ctx.strokeStyle = s.found.item ? readable.amber : p.ink
    ctx.lineWidth = STROKE.standard
    ctx.strokeRect(bx, by, w, h)
    ctx.restore()
    text(vp.ctx, title, bx + w / 2, by + bodySz + 8, {
      font: font(bodySz, 'bold'),
      color: s.found.item ? readable.amber : p.ink,
      align: 'center',
    })
    text(vp.ctx, sub, bx + w / 2, by + bodySz + dimSz + 20, {
      font: font(dimSz),
      color: p.inkLight,
      align: 'center',
    })
  }
}

/**
 * The mobile walk PAD (D-185): four hold-to-walk buttons in the right thumb zone —
 * "you can not move the person in mobile". Geometry lives here so the app's pointer
 * wiring, the shell's tap-deconfliction and the drawing can never disagree.
 */
export function padRects(): { dx: number; dy: number; x: number; y: number; w: number; h: number }[] {
  const b = 150
  const gap = 12
  const cx = LOGICAL_WIDTH - 250
  // High enough that the DOWN button clears the Guide button and the status board.
  const cy = MAP_Y + VIEW_H * SCREEN_TILE - 340
  return [
    { dx: 0, dy: -1, x: cx - b / 2, y: cy - b * 1.5 - gap, w: b, h: b },
    { dx: 0, dy: 1, x: cx - b / 2, y: cy + b * 0.5 + gap, w: b, h: b },
    { dx: -1, dy: 0, x: cx - b * 1.5 - gap, y: cy - b / 2, w: b, h: b },
    { dx: 1, dy: 0, x: cx + b * 0.5 + gap, y: cy - b / 2, w: b, h: b },
  ]
}

/** Draw the PAD: paper discs with ink chevrons, translucent so the maze stays readable. */
export function drawDungeonPad(vp: Viewport, p: Palette): void {
  const { ctx } = vp
  ctx.save()
  for (const r of padRects()) {
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    ctx.fillStyle = alpha(p.paper, 0.55)
    ctx.beginPath()
    ctx.arc(cx, cy, r.w / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = alpha(p.ink, 0.7)
    ctx.lineWidth = STROKE.standard
    ctx.beginPath()
    ctx.arc(cx, cy, r.w / 2, 0, Math.PI * 2)
    ctx.stroke()
    // The chevron, pointing its way.
    const a = r.w * 0.17
    ctx.beginPath()
    if (r.dy === -1) {
      ctx.moveTo(cx - a, cy + a * 0.6)
      ctx.lineTo(cx, cy - a * 0.8)
      ctx.lineTo(cx + a, cy + a * 0.6)
    } else if (r.dy === 1) {
      ctx.moveTo(cx - a, cy - a * 0.6)
      ctx.lineTo(cx, cy + a * 0.8)
      ctx.lineTo(cx + a, cy - a * 0.6)
    } else if (r.dx === -1) {
      ctx.moveTo(cx + a * 0.6, cy - a)
      ctx.lineTo(cx - a * 0.8, cy)
      ctx.lineTo(cx + a * 0.6, cy + a)
    } else {
      ctx.moveTo(cx - a * 0.6, cy - a)
      ctx.lineTo(cx + a * 0.8, cy)
      ctx.lineTo(cx - a * 0.6, cy + a)
    }
    ctx.lineWidth = STROKE.heavy
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
  }
  ctx.restore()
}

/** The four cells a tap can mean — SCREEN rects, since fingers live outside the 2× transform. */
export function adjacentTiles(
  s: DungeonRunState,
): { dx: number; dy: number; x: number; y: number; w: number; h: number }[] {
  return (
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const
  ).map(([dx, dy]) => ({ dx, dy, ...tapTileRect(s.player.x + dx, s.player.y + dy) }))
}
