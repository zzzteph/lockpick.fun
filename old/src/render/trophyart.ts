/**
 * The trophy art — thirty-four MS-Paint drawings, one per achievement (D-159).
 *
 * The first image files the game has ever shipped, and the departure is deliberate: the
 * drafting style draws every mechanism in code because mechanisms have geometry, but a trophy
 * is a *memento*, and a hand-drawn card taped to the blueprint says that better than more
 * linework could. The masters are 1024px paint drawings (machine-local, beside the Steam
 * listing); `dev/trophy-art.mjs` produces the 256px shipping copies in `src/assets/trophies/`,
 * named by achievement id so this module and the catalogue cannot drift apart — a test holds
 * the two lists equal.
 *
 * Everything arrives as a data URI (`assetsInlineLimit` covers the whole set) for the same
 * reason the fonts do: `dist/` must run from `file://`, where a fetched PNG is cross-origin —
 * it would both fail to load under CORS-ish file isolation and taint the canvas, and the
 * grayscale variants below are built with `getImageData`, which a tainted canvas refuses.
 *
 * Loading is asynchronous and the drawing never waits: `drawTrophyArt` draws nothing and
 * returns false until the image is ready, which at data-URI speed is the first frame or two
 * after boot. Locked achievements get a grayscale copy, computed once per icon on load —
 * luminance, not `ctx.filter`, because Safari's canvas filter support is not a thing to lean a
 * trophy wall on.
 */

const urls = import.meta.glob<string>('../assets/trophies/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
})

interface TrophyArt {
  image: HTMLImageElement
  ready: boolean
  gray: HTMLCanvasElement | null
}

const art = new Map<string, TrophyArt>()

/** Build the grayscale locked variant — same drawing, drained of its accent. */
function grayscale(image: HTMLImageElement): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.2126 * (px[i] ?? 0) + 0.7152 * (px[i + 1] ?? 0) + 0.0722 * (px[i + 2] ?? 0)
    px[i] = lum
    px[i + 1] = lum
    px[i + 2] = lum
  }
  ctx.putImageData(data, 0, 0)
  return canvas
}

// Guarded so the module can be *imported* anywhere: the unit tests run the shell's layout
// helpers under node, where there is no `Image` and nothing to draw. There the map stays
// empty and `drawTrophyArt` simply reports false — the same thing it says mid-load.
if (typeof Image !== 'undefined') {
  for (const [path, url] of Object.entries(urls)) {
    const id = path.split('/').pop()?.replace(/\.png$/, '')
    if (!id) continue
    const image = new Image()
    const entry: TrophyArt = { image, ready: false, gray: null }
    image.onload = () => {
      entry.ready = true
      entry.gray = grayscale(image)
    }
    image.src = url
    art.set(id, entry)
  }
}

/** Every id this module has art for — the parity test reads it through the hook. */
export function trophyArtIds(): string[] {
  return [...art.keys()].sort()
}

/** True once every icon has loaded — lets a test wait for the wall to be complete. */
export function trophyArtReady(): boolean {
  return [...art.values()].every((a) => a.ready)
}

/**
 * Draw the achievement's card at `x,y` in a `size` square. Locked draws the grayscale copy at
 * reduced strength, so an unearned trophy reads as the same drawing waiting to be coloured in.
 * Returns false when the art is missing or not yet loaded — the caller loses an icon for a
 * frame, never a layout.
 */
export function drawTrophyArt(
  ctx: CanvasRenderingContext2D,
  id: string,
  x: number,
  y: number,
  size: number,
  locked: boolean,
): boolean {
  const entry = art.get(id)
  if (!entry || !entry.ready) return false
  ctx.save()
  if (locked && entry.gray) {
    ctx.globalAlpha *= 0.55
    ctx.drawImage(entry.gray, x, y, size, size)
  } else {
    ctx.drawImage(entry.image, x, y, size, size)
  }
  ctx.restore()
  return true
}
