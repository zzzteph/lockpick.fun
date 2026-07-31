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
