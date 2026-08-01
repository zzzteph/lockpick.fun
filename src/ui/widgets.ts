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
import { snapX, snapY, type Viewport, typeFor } from '../render/viewport'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function pointInRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}

/**
 * A rect grown about its own centre to at least `floor` in each axis.
 *
 * The **hit** rect, never the drawn one — Material's own guidance is that a touch target may extend
 * beyond the visual bounds, and it is the only fix that costs nothing visually. A 96x40 tier button
 * stays a 96x40 tier button and answers to a thumb.
 */
export function grown(r: Rect, floor: number): Rect {
  const w = Math.max(r.w, floor)
  const h = Math.max(r.h, floor)
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h }
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

  /**
   * Logical px every target must span for a fingertip, or 0 to hit-test exactly (D-131).
   *
   * Zero on a mouse, deliberately. A cursor has one-pixel precision, and a pointer that activates
   * the button it is merely *near* feels haunted. This is a concession to the finger, so it is
   * switched on by the finger.
   */
  private floor = 0
  /** This frame's rects in call order, kept so the next frame can resolve a near miss. */
  private rects: Rect[] = []
  private lastRects: Rect[] = []
  /** The widget a touch landing in no widget at all resolves to, or -1. */
  private nearMiss = -1

  begin(frame: UiFrame, floor = 0): void {
    this.frame = frame
    this.index = 0
    this.floor = floor
    this.lastRects = this.rects
    this.rects = []
    this.nearMiss = this.resolveNearMiss()
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

  /**
   * Which widget a touch that landed in no widget at all was aiming for — DECISIONS D-131.
   *
   * Inflating each rect where it is drawn is the obvious version and it is wrong, because this is an
   * immediate-mode layer with no z-order: two inflated rects that overlap would both report hovered
   * and both fire on the same tap. At the floor a phone needs — 122 logical px on an iPhone 13 —
   * neighbours *always* overlap, so resolving to a single winner is not a refinement, it is the
   * whole problem.
   *
   * So the near miss is resolved once, before any widget draws, against the rects the previous frame
   * registered — nearest centre wins, and an exact hit anywhere cancels the whole mechanism. Reusing
   * last frame's table is what makes it a *pre*-pass rather than a frame of lag: the shell redraws
   * the same widgets in the same order every frame, so for any screen that is not mid-transition the
   * table is already the right one.
   */
  private resolveNearMiss(): number {
    if (this.floor <= 0) return -1
    const px = this.frame.pointerX
    const py = this.frame.pointerY
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < this.lastRects.length; i += 1) {
      const r = this.lastRects[i]
      if (!r) continue
      if (pointInRect(r, px, py)) return -1
      if (!pointInRect(grown(r, this.floor), px, py)) continue
      const dx = px - (r.x + r.w / 2)
      const dy = py - (r.y + r.h / 2)
      const d = dx * dx + dy * dy
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    return best
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
    this.rects[index] = rect
    const hovered =
      pointInRect(rect, this.frame.pointerX, this.frame.pointerY) || this.nearMiss === index
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
  /**
   * A button's caption follows the viewport (D-122).
   *
   * Every screen in the game is made of these, so scaling the default here is what makes the shell
   * legible on a phone without touching eleven `draw*` functions. An explicit `opts.size` is
   * scaled too — a caller asking for the dimension face wants the dimension face *for this screen*,
   * not seventeen literal pixels on a 390px-tall display.
   */
  const size = typeFor(vp, opts.size ?? TYPE.body)

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
  /**
   * The caption is shrunk until it fits inside its own frame — DECISIONS D-123.
   *
   * The safety net for the whole shell, and it exists because D-122 removed one. Scaling the
   * default caption size by the viewport made every button legible on a phone and made a good
   * number of them **wider than the box they are drawn in**: the bench's tier strip is a row of
   * 96px buttons at 108px pitch, so `TIER 1` at the compact size ran into `TIER 2` and the four of
   * them read as one smear. Same on the codes page, where `PLAY EDIT COPY` sit in a card's inner
   * width, and on `PASTE`/`ADD`.
   *
   * A rect is a hit target and a layout commitment; a caption is text. When they disagree the text
   * gives way, because a button drawn over its neighbour is unreadable *and* unhittable, while a
   * slightly smaller word is neither. Measured against the real face — the canvas knows how wide
   * the string is (D-102), and this is the fifth place in this codebase to need telling.
   */
  const room = rect.w - 16
  /**
   * Capped by the button's **height** as well as its width — DECISIONS D-128.
   *
   * Width alone was not enough. The compact scale is chosen so the smallest face lands on eleven
   * real pixels (D-122), and applying that to a caption inside a 40px nav button gives a 34px
   * glyph in a 40px box: it fills the button top to bottom with no air at all, which was reported
   * as *"the buttons text is too big — it just takes all the space from the top and bottom, looks
   * badly"*. Half the height leaves the cap-height sitting inside the frame with room to breathe,
   * which is what a button looks like.
   */
  let fitted = Math.min(size, Math.floor(rect.h * 0.5))
  ctx.save()
  const drawnWidth = (s: number): number => {
    ctx.font = font(s)
    return ctx.measureText(caption.toUpperCase()).width + s * 0.08 * Math.max(0, caption.length - 1)
  }
  while (fitted > 9 && drawnWidth(fitted) > room) fitted -= 1
  ctx.restore()
  label(ctx, caption, rect.x + rect.w / 2, rect.y + rect.h / 2 + fitted * 0.36, {
    font: font(fitted),
    size: fitted,
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

  /**
   * Caption, value and track all follow the viewport — DECISIONS D-131.
   *
   * `button` got this in D-122 and these three did not, so the settings screen was drawing its
   * captions at seven CSS px and its track at four. The track is the part that matters: it is the
   * thing a finger aims at, and ten logical px of it is not a control, it is a hairline.
   */
  const capSize = typeFor(vp, TYPE.dimension)
  label(ctx, caption, rect.x, rect.y + capSize - 3, {
    font: font(capSize),
    size: capSize,
    color: p.inkLight,
  })

  const trackH = Math.max(10, Math.round(rect.h * 0.34))
  const trackY = rect.y + rect.h - trackH - 2
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

  // Beside the track, not on it — a thumb setting a slider covers the middle of its own control,
  // so the one number that says what you just chose has to live outside the sweep (D-131).
  text(ctx, value.toFixed(2), rect.x + rect.w + 16, trackY + trackH, {
    font: font(typeFor(vp, TYPE.body)),
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
  // The box scales with the type, and never exceeds the row it sits in (D-131). A 20px checkbox is
  // seven CSS px on a phone — findable only because the caption beside it says where to aim.
  const capSize = typeFor(vp, TYPE.body)
  const box = Math.min(Math.round(capSize * 1.2), Math.max(16, rect.h - 8))
  const boxY = rect.y + (rect.h - box) / 2
  ctx.save()
  ctx.fillStyle = value ? p.teal : p.paper
  ctx.fillRect(rect.x, boxY, box, box)
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.strokeRect(snapX(vp, rect.x, STROKE.standard), snapY(vp, boxY, STROKE.standard), box, box)
  ctx.restore()
  label(ctx, caption, rect.x + box + 14, rect.y + rect.h / 2 + capSize * 0.36, {
    font: font(capSize),
    size: capSize,
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
    // Fitted to its own cell, height and width, exactly as `button` is (D-123, D-128, D-131).
    // Four assist modes in one strip is the narrowest cell in the game.
    let size = Math.min(typeFor(vp, TYPE.body), Math.floor(cell.h * 0.5))
    ctx.save()
    const room = cell.w - 12
    const drawn = (s: number): number => {
      ctx.font = font(s)
      return ctx.measureText(caption.toUpperCase()).width + s * 0.08 * Math.max(0, caption.length - 1)
    }
    while (size > 9 && drawn(size) > room) size -= 1
    ctx.restore()
    label(ctx, caption, cell.x + cell.w / 2, cell.y + cell.h / 2 + size * 0.36, {
      font: font(size),
      size,
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
