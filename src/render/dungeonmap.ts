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
  VISION_RADIUS,
  guardSees,
  lineOfSight,
  trackerNear,
  type DungeonRunState,
} from '../game/dungeonRun'
import { text } from './draw'
import { LOGICAL_WIDTH, isCompact, typeFor, type Viewport } from './viewport'
import { STROKE, TYPE, alpha, font, readableAccents, type Palette } from './palette'

export const TILE = 36
export const MAP_X = (LOGICAL_WIDTH - 44 * TILE) / 2
export const MAP_Y = 116

export function tileRect(x: number, y: number): { x: number; y: number; w: number; h: number } {
  return { x: MAP_X + x * TILE, y: MAP_Y + y * TILE, w: TILE, h: TILE }
}

/** The cells the lamp reaches right now — entities show only inside this. */
export function visibleNow(s: DungeonRunState): Set<string> {
  const out = new Set<string>()
  const px = s.player.x
  const py = s.player.y
  for (let y = Math.max(0, py - VISION_RADIUS); y <= Math.min(s.floor.h - 1, py + VISION_RADIUS); y += 1) {
    for (let x = Math.max(0, px - VISION_RADIUS); x <= Math.min(s.floor.w - 1, px + VISION_RADIUS); x += 1) {
      if (lineOfSight(s, px, py, x, y)) out.add(`${x},${y}`)
    }
  }
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

  // ── Floor and walls ───────────────────────────────────────────────────────────────────
  ctx.save()
  for (let y = 0; y < s.floor.h; y += 1) {
    for (let x = 0; x < s.floor.w; x += 1) {
      if (!seen(x, y) || !walk(x, y)) continue
      const r = tileRect(x, y)
      ctx.fillStyle = lit(x, y) ? p.paperShade : alpha(p.paperShade, 0.45)
      ctx.fillRect(r.x, r.y, r.w, r.h)
    }
  }
  // Wall strokes: every edge between a seen floor cell and anything uncarved. Drawing the
  // boundary rather than the wall cells is what makes it read as a *plan*.
  ctx.strokeStyle = p.ink
  ctx.lineWidth = STROKE.standard
  ctx.beginPath()
  for (let y = 0; y < s.floor.h; y += 1) {
    for (let x = 0; x < s.floor.w; x += 1) {
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
    } else {
      // chain — three links draped diagonally.
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
    ctx.restore()
  }
  for (const e of s.enemies) {
    if (!lit(e.x, e.y)) continue
    const r = tileRect(e.x, e.y)
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const stats = ENEMY_STATS[e.kind]
    ctx.save()
    if (e.awake) {
      // A chasing guard gets a warning ring — the map's own alarm bell.
      ctx.strokeStyle = alpha(readable.crimson, 0.55)
      ctx.lineWidth = STROKE.hairline
      ctx.beginPath()
      ctx.arc(cx, cy, 14, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.font = font(26, 'bold')
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = e.awake ? readable.crimson : p.ink
    ctx.fillText(stats.letter, cx, cy + 1)
    // The facing tick: a small wedge on the tile edge it is looking at.
    const wed =
      e.facing === 'e'
        ? [r.x + r.w - 3, cy, r.x + r.w - 10, cy - 5, r.x + r.w - 10, cy + 5]
        : e.facing === 'w'
          ? [r.x + 3, cy, r.x + 10, cy - 5, r.x + 10, cy + 5]
          : e.facing === 's'
            ? [cx, r.y + r.h - 3, cx - 5, r.y + r.h - 10, cx + 5, r.y + r.h - 10]
            : [cx, r.y + 3, cx - 5, r.y + 10, cx + 5, r.y + 10]
    ctx.beginPath()
    ctx.moveTo(wed[0] as number, wed[1] as number)
    ctx.lineTo(wed[2] as number, wed[3] as number)
    ctx.lineTo(wed[4] as number, wed[5] as number)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // ── The player ────────────────────────────────────────────────────────────────────────
  {
    const r = tileRect(s.player.x, s.player.y)
    ctx.save()
    ctx.fillStyle = p.ink
    ctx.beginPath()
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, 8.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = p.paper
    ctx.beginPath()
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, 3.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // ── The strip: the clock you are racing, what you carry, what just happened ───────────
  // 26, not 34: on compact the status line's grown type reaches up from the frame's bottom
  // corner, and the strip has to stay clear of it — the sweep caught the 3px graze.
  const stripY = MAP_Y + s.floor.h * TILE + 26
  const dim = typeFor(vp, TYPE.dimension)
  const bodySize = typeFor(vp, TYPE.body)
  // TURNS first and unmissable: speed IS the score now (D-177) — the number the run is
  // racing sits where the health bar used to.
  text(vp.ctx, `turn ${s.turn}`, MAP_X, stripY, {
    font: font(bodySize, 'bold'),
    color: p.ink,
  })
  {
    const g = bodySize * 1.25
    const vy = stripY - g * 0.3
    let ix = MAP_X + bodySize * 6.2
    ctx.save()
    ctx.font = font(dim)
    const numberAt = (n: string): void => {
      text(vp.ctx, n, ix, stripY, { font: font(dim), color: p.ink })
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
        text(vp.ctx, `${near} near`, ix, stripY, { font: font(dim, 'bold'), color: readable.crimson })
        ctx.font = font(dim, 'bold')
        ix += ctx.measureText(`${near} near`).width + g * 0.9
        ctx.font = font(dim)
      } else {
        text(vp.ctx, 'quiet', ix, stripY, { font: font(dim), color: p.inkLight })
        ix += ctx.measureText('quiet').width + g * 0.9
      }
    }
    ctx.restore()
  }
  // The ticker: on a full page the bottom-right corner belongs to the report link, so the
  // lines sit left of it — the first draft printed straight through it, caught on the second
  // self-playtest's own screenshot. The third self-playtest caught its sibling: a long
  // sighting line ran left into the inventory text, because the audit had only ever seen
  // short lines. So the ticker owns a measured column now — lines WRAP inside it, whole
  // entries newest-first fill the slots — and on compact it takes the row BELOW the strip,
  // where 2.4× type has the whole right half to itself instead of a corner it never fit.
  {
    const compact = isCompact(vp)
    // Full page: a channel between the inventory's end and the report link's left edge.
    // Compact: one row, left-aligned in the empty status corner (compact status is '' on
    // the crawl), stopping well short of the Wait/Potion stack.
    const logRight = LOGICAL_WIDTH - MAP_X - 190
    const logW = compact ? 960 : 470
    const slots = compact ? 1 : 2
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
    // Whole entries, newest first, until the slots are spent — a wrapped sighting must
    // never lose its head to make room for an older line's tail.
    const rows: string[] = []
    for (let i = s.log.length - 1; i >= 0 && rows.length < slots; i -= 1) {
      const wrapped = wrapLine(s.log[i] as string)
      if (rows.length > 0 && rows.length + wrapped.length > slots) break
      rows.unshift(...wrapped.slice(0, slots))
    }
    ctx.restore()
    const base = compact ? stripY + dim + 8 : 998
    rows.slice(0, slots).forEach((line, i) => {
      text(vp.ctx, line, compact ? MAP_X : logRight, base + i * (dim + 6), {
        font: font(dim),
        color: p.inkLight,
        align: compact ? 'left' : 'right',
      })
    })
  }
}

/** The four cells a tap can mean, for the shell's invisible tap zones. */
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
  ).map(([dx, dy]) => ({ dx, dy, ...tileRect(s.player.x + dx, s.player.y + dy) }))
}

