/**
 * The Lock dungeon's generated drafting plates (docs/IMAGE-PROMPTS.md).
 *
 * Art is deliberately optional at boot: the canvas keeps drawing the vector fallback while the
 * data-URI images decode. Keeping the loader here also gives the blueprint theme one place to
 * dim the light-paper source art over its blue ground.
 */

import type { Palette } from './palette'

export type GauntletArtId =
  | 'briefing-labyrinth-prison'
  | 'caught'
  | 'escaped'
  | 'warden'
  | 'sentry'
  | 'listener'
  | 'hunter'
  | 'the-gate'
  | 'corridor-floor'
  | 'chamber-floor'
  | 'wall-block'
  | 'water-drain-floor'
  // The GRIM set (D-193): optional per-tile variants of the corridor floor and wall
  // block, dealt from a position hash — docs/IMAGE-PROMPTS.md §36–41 is their brief.
  | 'corridor-floor-bones'
  | 'corridor-floor-damp'
  | 'corridor-floor-scratched'
  | 'wall-block-chained'
  | 'wall-block-tally'
  | 'wall-block-seep'
  | 'sprite-warden'
  | 'sprite-sentry'
  | 'sprite-listener'
  | 'sprite-hunter'
  | 'sprite-picker'
  // The themed room floors (D-189) — optional plates the map prefers over the plain
  // chamber floor the moment they exist. docs/IMAGE-PROMPTS.md §D-189 is their brief.
  | `room-${
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
      | 'gatehouse'}`

const urls = import.meta.glob<string>(
  ['../assets/gauntlet-art/*.png', '!../assets/gauntlet-art/sprite-*.png'],
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
)

// The creature sprites ride separately, as inline data-URIs: ~99KB for all six, and the
// map wants them the first frame a guard steps into the lamp — no decode gap, no URL
// fetch. The big plates above stay on the ?url road.
const spriteUrls = import.meta.glob<string>('../assets/gauntlet-art/sprite-*.png', {
  eager: true,
  query: '?inline',
  import: 'default',
})

interface ArtEntry {
  readonly image: HTMLImageElement
  ready: boolean
}

const art = new Map<GauntletArtId, ArtEntry>()

// Unit tests render shell geometry under node, where Image does not exist. The map staying empty
// there is intentional; drawGauntletArt simply falls back to the existing vector drawing.
if (typeof Image !== 'undefined') {
  for (const [path, url] of Object.entries({ ...urls, ...spriteUrls })) {
    const id = path.split('/').pop()?.replace(/\.png$/, '') as GauntletArtId | undefined
    if (!id) continue
    const image = new Image()
    const entry: ArtEntry = { image, ready: false }
    image.onload = () => {
      entry.ready = true
    }
    image.src = url
    art.set(id, entry)
  }
}

export function gauntletArtReady(id?: GauntletArtId): boolean {
  if (id) return art.get(id)?.ready ?? false
  return [...art.values()].every((entry) => entry.ready)
}

/** Draw one generated plate, returning false while it is still decoding. */
export function drawGauntletArt(
  ctx: CanvasRenderingContext2D,
  id: GauntletArtId,
  x: number,
  y: number,
  w: number,
  h: number,
  palette: Palette,
  opacity = 1,
  fit: 'stretch' | 'contain' = 'stretch',
  blend: GlobalCompositeOperation = 'source-over',
): boolean {
  const entry = art.get(id)
  if (!entry?.ready || typeof ctx.drawImage !== 'function') return false

  let dx = x
  let dy = y
  let dw = w
  let dh = h
  if (fit === 'contain') {
    const scale = Math.min(w / entry.image.naturalWidth, h / entry.image.naturalHeight)
    dw = entry.image.naturalWidth * scale
    dh = entry.image.naturalHeight * scale
    dx += (w - dw) / 2
    dy += (h - dh) / 2
  }

  ctx.save()
  // The generated source is drafting-paper light. A low-opacity pass is the intended treatment
  // over blueprint blue; its paper then reads as a quiet blue wash and the ink remains legible.
  ctx.globalAlpha *= opacity * (palette.name === 'blueprint' ? 0.2 : 1)
  ctx.globalCompositeOperation = blend
  ctx.drawImage(entry.image, dx, dy, dw, dh)
  ctx.restore()
  return true
}

// One offscreen per (sprite, tint), built on demand: the alpha plate is the mask, the
// tint flood-filled through it with 'source-in'. A handful of entries, never dropped.
const tinted = new Map<string, HTMLCanvasElement>()

/**
 * Draw one of the alpha-masked creature sprites centred on a map cell (D-184).
 *
 * `tint: null` draws the plate as authored — near-black ink plus its amber detail —
 * which is exactly right on drafting paper. Awake guards pass crimson; the blueprint
 * theme passes its LIGHT ink, because near-black figures vanish on a blue-black ground
 * (the multiply-blend first draft proved it). `mirror` flips profile sprites to face
 * the way their feet do. Returns false while the plate decodes, so callers keep the
 * vector figure as the stand-in.
 */
export function drawGauntletSprite(
  ctx: CanvasRenderingContext2D,
  id: Extract<GauntletArtId, `sprite-${string}`>,
  cx: number,
  cy: number,
  size: number,
  tint: string | null = null,
  mirror = false,
): boolean {
  const entry = art.get(id)
  if (!entry?.ready || typeof ctx.drawImage !== 'function') return false
  let source: CanvasImageSource = entry.image
  if (tint) {
    const key = `${id}|${tint}`
    let plate = tinted.get(key)
    if (!plate) {
      plate = document.createElement('canvas')
      plate.width = entry.image.naturalWidth
      plate.height = entry.image.naturalHeight
      const pctx = plate.getContext('2d')
      if (!pctx) return false
      pctx.drawImage(entry.image, 0, 0)
      pctx.globalCompositeOperation = 'source-in'
      pctx.fillStyle = tint
      pctx.fillRect(0, 0, plate.width, plate.height)
      tinted.set(key, plate)
    }
    source = plate
  }
  ctx.save()
  if (mirror) {
    ctx.translate(cx, 0)
    ctx.scale(-1, 1)
    ctx.translate(-cx, 0)
  }
  ctx.drawImage(source, cx - size / 2, cy - size / 2, size, size)
  ctx.restore()
  return true
}
