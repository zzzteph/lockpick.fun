/**
 * An immediate-mode widget layer for the canvas UI.
 *
 * Everything in this game is drawn, so the menus are drawn too. Widgets register themselves
 * in call order each frame, which gives every screen a stable tab order for free — and full
 * keyboard navigation with a visible focus ring is a Phase 12 requirement, so it is built in
 * from the start rather than retrofitted.
 */

import { label, roundRectPath, text } from '../render/draw'
import { STROKE, TYPE, alpha, font, type Palette } from '../render/palette'
import { snapX, snapY, type Viewport } from '../render/viewport'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function pointInRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}

export interface UiFrame {
  pointerX: number
  pointerY: number
  /** True on the frame the primary button was released. */
  clicked: boolean
  /** Key codes pressed this frame. */
  keys: ReadonlySet<string>
}

export const EMPTY_FRAME: UiFrame = {
  pointerX: -1,
  pointerY: -1,
  clicked: false,
  keys: new Set<string>(),
}

export interface WidgetState {
  focused: boolean
  hovered: boolean
  activated: boolean
  index: number
  /**
   * True when focus arrived by keyboard. Carried on the state, not read off `Ui`, so a widget
   * drawn by a helper that was never handed the `Ui` can still show a ring — which is how the
   * bench, shop and trophy cards came to have keyboard focus without anything to see.
   */
  keyboardMode: boolean
}

const NEXT_KEYS = ['ArrowDown', 'ArrowRight', 'Tab']
const PREV_KEYS = ['ArrowUp', 'ArrowLeft']
const ACTIVATE_KEYS = ['Enter', 'Space', 'NumpadEnter']

export class Ui {
  focus = 0
  private index = 0
  private count = 0
  private frame: UiFrame = EMPTY_FRAME
  /** True when the last focus change came from the keyboard — hides the ring for mouse users. */
  keyboardMode = false

  begin(frame: UiFrame): void {
    this.frame = frame
    this.index = 0
    if (this.count > 0) {
      let moved = 0
      for (const k of NEXT_KEYS) if (frame.keys.has(k)) moved += 1
      for (const k of PREV_KEYS) if (frame.keys.has(k)) moved -= 1
      if (moved !== 0) {
        this.focus = (((this.focus + moved) % this.count) + this.count) % this.count
        this.keyboardMode = true
      }
    }
  }

  end(): void {
    this.count = this.index
    if (this.count > 0 && this.focus >= this.count) this.focus = this.count - 1
  }

  /** How many focusable widgets the last frame drew. */
  get widgetCount(): number {
    return this.count
  }

  /** Reset focus — call when the screen changes. */
  reset(): void {
    this.focus = 0
    this.count = 0
    this.keyboardMode = false
  }

  private activateKeyPressed(): boolean {
    for (const k of ACTIVATE_KEYS) if (this.frame.keys.has(k)) return true
    return false
  }

  /** The frame currently being processed — widgets that need the raw pointer read it here. */
  get input(): UiFrame {
    return this.frame
  }

  /** Register a widget occupying `rect` and report how the player is interacting with it. */
  widget(rect: Rect, enabled = true): WidgetState {
    const index = this.index
    this.index += 1
    if (!enabled) {
      return { focused: false, hovered: false, activated: false, index, keyboardMode: false }
    }
    const hovered = pointInRect(rect, this.frame.pointerX, this.frame.pointerY)
    if (hovered && this.frame.clicked) {
      this.focus = index
      this.keyboardMode = false
    }
    const focused = this.focus === index
    const activated = (hovered && this.frame.clicked) || (focused && this.activateKeyPressed())
    return { focused, hovered, activated, index, keyboardMode: this.keyboardMode }
  }
}

export interface ButtonOptions {
  enabled?: boolean
  /** Draws filled in ink with reversed text — for the one primary action on a screen. */
  primary?: boolean
  size?: number
}

/** Draw a button and return true when it has been pressed this frame. */
export function button(
  vp: Viewport,
  p: Palette,
  ui: Ui,
  rect: Rect,
  caption: string,
  opts: ButtonOptions = {},
): boolean {
  const { ctx } = vp
  const enabled = opts.enabled ?? true
  const st = ui.widget(rect, enabled)
  const size = opts.size ?? TYPE.body

  ctx.save()
  const x = snapX(vp, rect.x, STROKE.standard)
  const y = snapY(vp, rect.y, STROKE.standard)
  ctx.beginPath()
  ctx.rect(x, y, rect.w, rect.h)
  if (!enabled) ctx.fillStyle = alpha(p.rule, 0.35)
  else if (opts.primary) ctx.fillStyle = st.hovered ? p.amber : p.ink
  else ctx.fillStyle = st.hovered ? p.paper : p.paperShade
  ctx.fill()
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = enabled ? p.ink : p.rule
  ctx.stroke()
  ctx.restore()

  const ink = !enabled ? p.inkLight : opts.primary ? p.paper : p.ink
  label(ctx, caption, rect.x + rect.w / 2, rect.y + rect.h / 2 + size * 0.36, {
    font: font(size),
    size,
    color: ink,
    align: 'center',
  })

  if (st.focused && ui.keyboardMode) drawFocusRing(vp, p, rect)
  return st.activated
}

/** The visible focus ring — 3px, offset outside the widget so it never obscures the label. */
export function drawFocusRing(vp: Viewport, p: Palette, rect: Rect): void {
  const { ctx } = vp
  const pad = 5
  ctx.save()
  ctx.lineWidth = STROKE.heavy
  ctx.strokeStyle = p.amber
  ctx.strokeRect(
    snapX(vp, rect.x - pad, STROKE.heavy),
    snapY(vp, rect.y - pad, STROKE.heavy),
    rect.w + pad * 2,
    rect.h + pad * 2,
  )
  ctx.restore()
}

/** A framed panel with an optional title, in the house style. */
export function panel(
  vp: Viewport,
  p: Palette,
  rect: Rect,
  title?: string,
  fill: string = p.paperShade,
): void {
  const { ctx } = vp
  ctx.save()
  ctx.fillStyle = fill
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = p.rule
  ctx.strokeRect(
    snapX(vp, rect.x, STROKE.hairline),
    snapY(vp, rect.y, STROKE.hairline),
    rect.w,
    rect.h,
  )
  ctx.restore()
  if (title) {
    label(ctx, title, rect.x + 16, rect.y + 26, {
      font: font(TYPE.dimension),
      size: TYPE.dimension,
      color: p.inkLight,
    })
  }
}

/** A horizontal slider. Returns the new value; the caller owns the state. */
export function slider(
  vp: Viewport,
  p: Palette,
  ui: Ui,
  rect: Rect,
  caption: string,
  value: number,
  opts: { min?: number; max?: number; step?: number } = {},
): number {
  const { ctx } = vp
  const min = opts.min ?? 0
  const max = opts.max ?? 1
  const step = opts.step ?? 0.05
  const st = ui.widget(rect)

  label(ctx, caption, rect.x, rect.y + 14, {
    font: font(TYPE.dimension),
    size: TYPE.dimension,
    color: p.inkLight,
  })

  const trackY = rect.y + rect.h - 12
  const trackH = 10
  ctx.save()
  ctx.fillStyle = alpha(p.rule, 0.6)
  ctx.fillRect(rect.x, trackY, rect.w, trackH)
  const t = (value - min) / (max - min)
  ctx.fillStyle = p.amber
  ctx.fillRect(rect.x, trackY, rect.w * Math.max(0, Math.min(1, t)), trackH)
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = p.ink
  ctx.strokeRect(
    snapX(vp, rect.x, STROKE.hairline),
    snapY(vp, trackY, STROKE.hairline),
    rect.w,
    trackH,
  )
  ctx.restore()

  text(ctx, value.toFixed(2), rect.x + rect.w + 16, trackY + trackH, {
    font: font(TYPE.body),
    color: p.ink,
  })
  if (st.focused && ui.keyboardMode) drawFocusRing(vp, p, rect)

  let next = value
  if (st.hovered && st.activated) {
    const fraction = (ui.input.pointerX - rect.x) / rect.w
    next = min + (max - min) * Math.max(0, Math.min(1, fraction))
  } else if (st.focused) {
    if (ui.input.keys.has('BracketRight')) next = Math.min(max, value + step)
    if (ui.input.keys.has('BracketLeft')) next = Math.max(min, value - step)
  }
  return Math.min(max, Math.max(min, Math.round(next / step) * step))
}

/** A checkbox with a caption. Returns the new value. */
export function toggle(
  vp: Viewport,
  p: Palette,
  ui: Ui,
  rect: Rect,
  caption: string,
  value: boolean,
): boolean {
  const { ctx } = vp
  const st = ui.widget(rect)
  const box = 20
  const boxY = rect.y + (rect.h - box) / 2
  ctx.save()
  ctx.fillStyle = value ? p.teal : p.paper
  ctx.fillRect(rect.x, boxY, box, box)
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.strokeRect(snapX(vp, rect.x, STROKE.standard), snapY(vp, boxY, STROKE.standard), box, box)
  ctx.restore()
  label(ctx, caption, rect.x + box + 14, rect.y + rect.h / 2 + 5, {
    font: font(TYPE.body),
    size: TYPE.body,
    color: p.ink,
  })
  if (st.focused && ui.keyboardMode) drawFocusRing(vp, p, rect)
  return st.activated ? !value : value
}

/** A row of mutually-exclusive options. Returns the selected index. */
export function segmented(
  vp: Viewport,
  p: Palette,
  ui: Ui,
  rect: Rect,
  captions: readonly string[],
  selected: number,
): number {
  const w = rect.w / captions.length
  let next = selected
  captions.forEach((caption, i) => {
    const cell: Rect = { x: rect.x + w * i, y: rect.y, w, h: rect.h }
    const st = ui.widget(cell)
    const { ctx } = vp
    ctx.save()
    ctx.fillStyle = i === selected ? p.ink : st.hovered ? p.paper : p.paperShade
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h)
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.strokeRect(
      snapX(vp, cell.x, STROKE.standard),
      snapY(vp, cell.y, STROKE.standard),
      cell.w,
      cell.h,
    )
    ctx.restore()
    label(ctx, caption, cell.x + cell.w / 2, cell.y + cell.h / 2 + 5, {
      font: font(TYPE.body),
      size: TYPE.body,
      color: i === selected ? p.paper : p.ink,
      align: 'center',
    })
    if (st.focused && ui.keyboardMode) drawFocusRing(vp, p, cell)
    if (st.activated) next = i
  })
  return next
}

/** A lock card for the bench — a small line drawing plus its record. */
export function cardFrame(
  vp: Viewport,
  p: Palette,
  rect: Rect,
  state: WidgetState,
  locked: boolean,
): void {
  const { ctx } = vp
  ctx.save()
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 2)
  ctx.fillStyle = locked ? alpha(p.rule, 0.25) : state.hovered ? p.paper : p.paperShade
  ctx.fill()
  ctx.lineWidth = locked ? STROKE.hairline : STROKE.standard
  ctx.strokeStyle = locked ? p.rule : p.ink
  ctx.stroke()
  ctx.restore()
  // Every card is a focusable widget, so every card gets the ring. Doing it here rather than
  // at each of the five call sites is what stops the next card grid from forgetting.
  if (state.focused && state.keyboardMode) drawFocusRing(vp, p, rect)
}
