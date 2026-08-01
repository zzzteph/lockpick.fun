/**
 * Viewport — the one place that knows about pixels.
 *
 * Everything else in `src/render/` draws into a fixed 1920x1080 logical space
 * (ART_DIRECTION.md §8). This module maps that space onto the real canvas: letterboxed,
 * centred, and backed by a `devicePixelRatio`-sized bitmap (PLATFORM.md §3).
 *
 * It also owns half-pixel snapping. Hairlines shimmer during plug rotation unless their
 * centres land on a device half-pixel, and getting that right in one place beats getting
 * it wrong in forty.
 */

export const LOGICAL_WIDTH = 1920
export const LOGICAL_HEIGHT = 1080

export interface Viewport {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  /** CSS pixels of the canvas element. */
  cssWidth: number
  cssHeight: number
  dpr: number
  /** Logical px -> CSS px. */
  scale: number
  /** Letterbox offset in CSS px, always a whole number of device pixels. */
  offsetX: number
  offsetY: number
}

export function createViewport(canvas: HTMLCanvasElement): Viewport {
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Canvas2D is unavailable — SHEAR LINE cannot render.')
  const vp: Viewport = {
    canvas,
    ctx,
    cssWidth: 0,
    cssHeight: 0,
    dpr: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  }
  syncViewport(vp)
  return vp
}

/**
 * Reconcile the backing store with the element's current display size.
 * Returns true when anything changed, so callers can invalidate cached layers.
 */
export function syncViewport(vp: Viewport, dprOverride?: number): boolean {
  const rect = vp.canvas.getBoundingClientRect()
  const cssWidth = Math.max(1, Math.round(rect.width))
  const cssHeight = Math.max(1, Math.round(rect.height))
  const dpr = dprOverride ?? (globalThis.devicePixelRatio || 1)

  if (vp.cssWidth === cssWidth && vp.cssHeight === cssHeight && vp.dpr === dpr) return false

  vp.cssWidth = cssWidth
  vp.cssHeight = cssHeight
  vp.dpr = dpr

  const backingW = Math.max(1, Math.round(cssWidth * dpr))
  const backingH = Math.max(1, Math.round(cssHeight * dpr))
  if (vp.canvas.width !== backingW) vp.canvas.width = backingW
  if (vp.canvas.height !== backingH) vp.canvas.height = backingH

  const scale = Math.min(cssWidth / LOGICAL_WIDTH, cssHeight / LOGICAL_HEIGHT)
  vp.scale = scale
  // Round the letterbox offset to whole device pixels so snapping stays exact.
  vp.offsetX = Math.round(((cssWidth - LOGICAL_WIDTH * scale) / 2) * dpr) / dpr
  vp.offsetY = Math.round(((cssHeight - LOGICAL_HEIGHT * scale) / 2) * dpr) / dpr
  return true
}

/** Logical px -> device px. */
export function deviceScale(vp: Viewport): number {
  return vp.scale * vp.dpr
}

/**
 * Below this stage scale the page is too small to read, and the screens draw a reduced version.
 *
 * Everything is laid out across a fixed 1920x1080 and letterboxed, so *all* type shrinks with the
 * viewport: `vp.scale` is exactly the factor by which. On an 844x390 phone it is 0.36, which puts
 * `TYPE.dimension` at **six CSS pixels** — not small, unreadable. Reported as *"the text on the
 * mobile device is VERY small"*, and it had been true of every screen since the stage was fixed.
 *
 * 0.60 is where `TYPE.dimension` lands at about 10px. Above it the full page is legible and is
 * drawn; below it the screens keep what a player needs and drop what a bigger page can afford —
 * see `compactType` and the call sites. A phone is compact, a small tablet is compact, a 1280x800
 * laptop (0.667) is not. See DECISIONS D-122.
 */
export const COMPACT_SCALE = 0.6

export function isCompact(vp: Viewport): boolean {
  return vp.scale < COMPACT_SCALE
}

/**
 * The smallest type this game will render, in **CSS pixels**, once a screen is compact.
 *
 * Not a multiplier — a target. A flat "1.8x on small screens" is the obvious version and it is
 * wrong at both ends of the range: the phones this has to work on run from a Galaxy S9+ at 0.296
 * stage scale to a Tab S9 at 0.533, so one multiplier either leaves the small end at nine pixels
 * or blows the large end up for no reason. Asking for a rendered size instead makes every device
 * land in the same place.
 */
export const MIN_TYPE_CSS = 11

/**
 * A type size for the current viewport, in logical pixels.
 *
 * Full size above the compact threshold. Below it, scaled by whatever it takes to put
 * `TYPE.dimension` — the smallest face in the game, and the one carrying labels — on
 * `MIN_TYPE_CSS` actual pixels, capped so a very small viewport cannot produce absurd type.
 *
 * This only works because compact also draws *fewer* things: raising the scale alone would make
 * everything collide, which is what D-102 means by "a type scale is a layout". See D-122.
 */
export function typeScaleFor(vp: Viewport): number {
  if (!isCompact(vp)) return 1
  const smallest = 17 // TYPE.dimension, named here to keep viewport free of a palette import
  const needed = MIN_TYPE_CSS / (smallest * Math.max(vp.scale, 0.01))
  return Math.min(2.4, Math.max(1, needed))
}

/**
 * Faces at or above this multiple of the readability floor are already large enough, and are left
 * exactly as they are.
 *
 * The compact scale exists to lift type *off* the floor (D-122). Applied uniformly it also inflates
 * the type that was never near it: the rank letter is 104 logical px, which is 38 CSS px on a
 * phone — the largest thing on the screen by a factor of three — and multiplying it by 1.79 gave a
 * 186px glyph, 17% of the stage's height, whose ink ran up through the header and printed across
 * the lock's own name.
 *
 * Two floors is the line. Below it a face is small enough that the reason it exists is legibility;
 * above it, it is large because somebody wanted it large, and the phone does not change that.
 * See DECISIONS D-132.
 */
export const NO_SCALE_FLOORS = 2

export function typeFor(vp: Viewport, size: number): number {
  if (size * vp.scale >= MIN_TYPE_CSS * NO_SCALE_FLOORS) return size
  return Math.round(size * typeScaleFor(vp))
}

/**
 * The smallest a control may be, in **CSS pixels**, before a fingertip cannot reliably hit it.
 *
 * 44 is Apple's floor; Material asks 48. An adult fingertip's contact patch is 10-14mm, which is
 * 45-55 CSS px, so this is not a guideline with margin in it — it is roughly the size of the thing
 * doing the pointing.
 */
export const TOUCH_FLOOR_CSS = 44

/**
 * That floor in logical px, for the current viewport.
 *
 * The companion to `typeFor`, and the reason it has to exist: D-122 scaled *glyphs* on a small
 * screen and never touched a hit rect, so compact mode made every control legible and left every
 * one of them unhittable. An audit of every interactive rect in the game found exactly one — the
 * bench card — clearing 44 CSS px on a mid-sized phone; menu buttons came to 30, settings toggles
 * to 12, the paging arrows that are the only way to reach trophy pages 2-4 to 14.
 *
 * The rows are at desktop pitch, which is right for a cursor with one-pixel precision and wrong by
 * about 3x for a thumb. See DECISIONS D-131.
 */
export function touchFloorFor(vp: Viewport): number {
  return TOUCH_FLOOR_CSS / Math.max(vp.scale, 0.01)
}

/**
 * Put the context into logical space: origin at the top-left of the 1920x1080 stage,
 * one unit = one logical pixel. Call once per frame before drawing anything.
 */
export function beginFrame(vp: Viewport, letterboxColor: string): void {
  const { ctx } = vp
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = letterboxColor
  ctx.fillRect(0, 0, vp.canvas.width, vp.canvas.height)
  const s = deviceScale(vp)
  ctx.setTransform(s, 0, 0, s, vp.offsetX * vp.dpr, vp.offsetY * vp.dpr)
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  ctx.textBaseline = 'alphabetic'
}

/** Clip subsequent drawing to the logical stage, so nothing bleeds into the letterbox. */
export function clipToStage(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath()
  ctx.rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT)
  ctx.clip()
}

function snapAxis(logical: number, offsetCss: number, s: number, dpr: number, lw: number): number {
  const offsetDevice = offsetCss * dpr
  const device = logical * s + offsetDevice
  const deviceWidth = Math.max(1, Math.round(lw * s))
  const snapped =
    deviceWidth % 2 === 1 ? Math.round(device - 0.5) + 0.5 : Math.round(device)
  return (snapped - offsetDevice) / s
}

/**
 * Snap a logical X so a stroke of `lineWidth` logical px has its centre on a device
 * pixel boundary (or half-boundary for odd widths). ART_DIRECTION.md §8.
 */
export function snapX(vp: Viewport, logicalX: number, lineWidth: number): number {
  return snapAxis(logicalX, vp.offsetX, deviceScale(vp), vp.dpr, lineWidth)
}

export function snapY(vp: Viewport, logicalY: number, lineWidth: number): number {
  return snapAxis(logicalY, vp.offsetY, deviceScale(vp), vp.dpr, lineWidth)
}

/** Convert a client-space (CSS) point to logical stage coordinates. */
export function clientToLogical(
  vp: Viewport,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = vp.canvas.getBoundingClientRect()
  return {
    x: (clientX - rect.left - vp.offsetX) / vp.scale,
    y: (clientY - rect.top - vp.offsetY) / vp.scale,
  }
}
