/**
 * Keyboard -> `SimInput` — GAME_DESIGN.md §3.
 *
 * The keyboard picks the lock; the mouse operates the interface. Arrows slide the tip along the
 * keyway and choose the chamber, Space pushes it up, Q is the wrench, and 1-9/0 select the
 * pressure step. Position control, not rate control — "the difference between a scalpel and a
 * joystick" — because the tip is asked for a *height* and the simulation decides whether the pin
 * goes there. See DECISIONS D-059 for why there is only one scheme now.
 */

import type { Chamber, SimInput } from '../sim'
import { clamp, clamp01 } from '../sim'
import { type FaceLayout } from '../render/faceon'
import { chamberAtX, yToMm, type CutawayLayout } from '../render/layout'
import { clientToLogical, type Viewport } from '../render/viewport'
import {
  PAUSE_PAD,
  WITHDRAW_PAD,
  createTouchState,
  inRect,
  liftForDrag,
  stepAtY,
  targetAt,
  tensionForTouchStep,
  type TouchState,
} from './touch'

/**
 * Logical pixels per millimetre of lift.
 *
 * No longer an input mapping — the mouse does not lift anything (D-059) — but still the scale the
 * *dev hook* reports positions in, so a test can say "put the tip 1.4mm up" and get a coordinate.
 */
export const LIFT_PX_PER_MM = 144

/**
 * Rotation pressure as ten discrete steps, 1 to 10.
 *
 * A continuous wheel is impossible to return to: "a bit lighter than last time" is not a thing
 * you can aim at, and the whole spool technique is *back off, push through, come back up*. Ten
 * numbered steps you can name and re-select turn tension into something you manage on purpose
 * rather than something you nudge and hope. Keys `1`-`9` and `0` pick one directly.
 */
export const TENSION_STEPS = 10
/**
 * Step 1 sits *above* `T_MIN_HOLD` (0.08), not on it.
 *
 * A dial where the lightest setting cannot hold your set pins is a dial with a broken first
 * step — you would wind down to 1, lose the lock, and learn nothing about why. Every step from
 * 1 to 10 holds; what changes across them is how hard the lock shoves back.
 */
export const TENSION_MIN_STEP = 0.12
export const TENSION_MAX_STEP = 0.95

/** Step `n` (1-based) as a tension value. */
export function tensionForStep(step: number): number {
  const t = (clamp(step, 1, TENSION_STEPS) - 1) / (TENSION_STEPS - 1)
  return TENSION_MIN_STEP + (TENSION_MAX_STEP - TENSION_MIN_STEP) * t
}

/** The nearest step to a tension value, 1-based — what the HUD shows. */
export function stepForTension(tension: number): number {
  const t = (tension - TENSION_MIN_STEP) / (TENSION_MAX_STEP - TENSION_MIN_STEP)
  return clamp(Math.round(t * (TENSION_STEPS - 1)) + 1, 1, TENSION_STEPS)
}
export interface InputSettings {
  /** Multiplies the arrow-key lift nudge. Higher is twitchier. */
  sensitivity: number
  /** Accessibility: tension latches on Q instead of being held. */
  tensionToggle: boolean
  /** Pressure step, as a tension value. */
  tensionLevel: number
  /**
   * Whether the up/down arrows trim the lift — **Training only** (D-111).
   *
   * Space is a rate: you press it, the tip climbs, you let go, the spring takes the pin back. That
   * is the hand the game is about, and it is the thing that is hard — holding a moving tool still
   * inside a window a few tenths of a millimetre wide. The arrow trim replaces that with a dial you
   * can park at an exact height and leave, which is a different and much easier game.
   *
   * So it is a *teaching* control, not a control. On Training it lets a first-time player see what
   * a capture window is by creeping into one a step at a time; anywhere else it would quietly be
   * the correct way to play, and the rate control it replaces would become the thing only beginners
   * use. Every other rung of the ladder takes away exactly one channel (D-046); this rung is the
   * one that adds one.
   */
  fineLift: boolean
}

export const DEFAULT_INPUT_SETTINGS: InputSettings = {
  sensitivity: 1,
  tensionToggle: false,
  tensionLevel: tensionForStep(5),
  fineLift: false,
}

export interface InputHooks {
  onRestart?: () => void
  onPause?: () => void
  onLoadout?: () => void
  /**
   * A click at logical `(x, y)`, delivered **synchronously inside the pointer event**.
   *
   * Exists for one job: opening a link. Return `true` if it was handled, and the click is dropped
   * rather than queued for the widget layer (D-103).
   */
  onLinkClick?: (x: number, y: number) => boolean
  /**
   * The first touch of the session — the only moment a page is allowed to ask for fullscreen or
   * an orientation lock, both of which need a user gesture (D-129).
   */
  onFirstTouch?: () => void
}

/** mm of lift per second while Space is held — matched to the pick's own rate. */
export const KEY_LIFT_RATE = 4.2
/**
 * mm per tap of the up/down arrows.
 *
 * Raised from 0.06 with D-105. At 0.06 a tap moved the tip by less than a *tenth* of the tightest
 * capture window in the game, which is below the threshold of "did anything happen" even when the
 * nudge survived — and until D-105 it did not survive at all. 0.12 is about a quarter of a Tier 4
 * window and a third of a Tier 1 one: a hair, and a hair you can see.
 */
export const KEY_LIFT_NUDGE = 0.12

/**
 * The keyboard scheme — the only way to pick.
 *
 * Every input the game has, on keys:
 *
 * | | |
 * |---|---|
 * | **← / →** | Move the pick one chamber along the keyway. |
 * | **Space**, held | Push the pick up. Release and the pin rides its spring back down. |
 * | **↑ / ↓** | Trim the lift a hair, and it stays there. **Training only** (D-111). |
 * | **Q**, held | Rotation pressure, at the step last selected. |
 * | **1 … 9, 0** | Pressure step 1 to 10 directly. |
 *
 * Space and Q are both *held*: two continuous inputs, released the instant you stop asking.
 * Nothing is a toggle unless the accessibility setting makes it one.
 *
 * Left and right also **drop the pick** as they move it, which is the whole reason the keyboard
 * is now the only scheme: carrying the tip high past a pin you have already set shoves it back
 * out (D-051), and "down, across, up" is something the arrow keys do for you and a mouse makes
 * you remember. See DECISIONS D-059.
 */
export class InputController {
  settings: InputSettings
  private pointerX = -1
  private pointerY = 0
  private toggled = false
  private spaceDown = false
  private disposers: (() => void)[] = []
  // ── Keyboard play state ──
  /**
   * Chamber the tip is at. Starts at the first one — the pick begins *in* the lock.
   *
   * It used to start at -1, out of the keyway, and the first arrow press only inserted it: you
   * pressed right and nothing moved, because that press was spent putting the pick in. Nothing on
   * screen said the tip was outside, so the game's first interaction read as a dropped keystroke.
   * There is also nothing to do with the pick out of the lock — no reason to be there and no way
   * back once you have left. Asked for as *"the lockpick by default must be on the first pin when
   * you start."* See DECISIONS D-100.
   */
  private keyChamber = 0
  /** Lift the keyboard is asking for, mm. Held by Space, and let go of the moment Space is. */
  private keyLift = 0
  /**
   * The fine trim, mm — what the arrow keys move, held until you leave the chamber.
   *
   * **This is the whole of D-105, and the reason it needed to exist.** The arrows used to add to
   * `keyLift`, which is the *held* lift: `tick` ramps it while Space is down and decays it at
   * `KEY_LIFT_RATE × 1.6` when Space is not. That decay is 0.112mm in a single 60Hz frame against
   * a nudge of 0.06mm, clamped at zero — so a tap was erased before the next `read()` could ever
   * see it. Arrow up and arrow down were a **complete no-op**, in every situation, since the day
   * they were written. Reported from play as *"fine lift seems to be not working"*, which it was.
   *
   * The two controls want opposite things from the same number: Space is a muscle you hold and
   * release, the arrows are a position you set and keep. One variable cannot be both, which is the
   * same shape of bug as D-083 — `pickForce` and the contact gate sharing one quantity — and it
   * gets the same fix: give the second meaning its own number and add them at the point of use.
   */
  private keyTrim = 0
  private tensionKeyDown = false
  /** Key codes pressed since the last `takeKeys()` — the UI layer drains these each frame. */
  private pendingKeys = new Set<string>()
  private pendingClick = false
  /**
   * Touch play state (D-082).
   *
   * Held here rather than in `touch.ts` so there is still exactly one object that answers "what are
   * the hands doing" — `read()` merges keyboard and touch without either knowing about the other.
   */
  readonly touch: TouchState = createTouchState()
  /** The last cutaway layout, so a tap can be turned into a chamber. Set each frame by the app. */
  private layout: CutawayLayout | null = null
  /** Chamber the current lift drag is working, kept apart from `keyChamber` while dragging. */
  private touchChamber = -1
  private touchLift = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly vp: Viewport,
    settings: InputSettings = DEFAULT_INPUT_SETTINGS,
    private readonly hooks: InputHooks = {},
  ) {
    this.settings = { ...settings }
    this.attach()
  }

  private on<K extends keyof WindowEventMap>(
    target: Window | HTMLElement,
    type: K,
    handler: (ev: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    const listener = handler as EventListener
    target.addEventListener(type, listener, options)
    this.disposers.push(() => {
      target.removeEventListener(type, listener)
    })
  }

  /**
   * The mouse operates the *interface* and nothing else. Picking is the keyboard's job.
   *
   * There used to be two complete and subtly different ways to play, and the mouse one was the
   * worse of the two once the physics got honest. A hook follows the cursor exactly, so any
   * diagonal drag raises the tip while it is still under the pin you are leaving and shoves that
   * pin back out (D-051) — the correct motion is "down, across, up", which a mouse user has to
   * perform deliberately and a keyboard user gets for free from the arrow keys. Two schemes also
   * meant two sets of bugs, two things to teach, and a tutorial that could only honestly describe
   * one of them.
   *
   * So: pointer tracking and clicks stay, because the bench, shop and settings are made of
   * buttons. Right-button tension, wheel-tension and left-button raking are gone. See
   * DECISIONS D-059.
   */
  private attach(): void {
    this.on(this.canvas, 'pointermove', (e) => {
      const p = clientToLogical(this.vp, e.clientX, e.clientY)
      this.pointerX = p.x
      this.pointerY = p.y
    })
    this.on(this.canvas, 'pointerdown', (e) => {
      const p = clientToLogical(this.vp, e.clientX, e.clientY)
      this.pointerX = p.x
      this.pointerY = p.y
      if (e.pointerType === 'touch') this.touchDown(e.pointerId, p.x, p.y)
    })
    this.on(window, 'pointerup', (e) => {
      if (e.pointerType === 'touch') this.touchUp(e.pointerId)
      if (e.button === 0) {
        /**
         * Outward links are opened **here**, inside the real event, and nowhere else.
         *
         * Every other click in the game is queued into `pendingClick` and consumed by the `Ui` on
         * the next animation frame, which is fine for anything that stays inside the canvas. It is
         * fatal for `window.open`: browsers only allow a popup during the task a user gesture
         * started, and a `requestAnimationFrame` callback is a different task. So the link worked
         * in no browser at all — it reported "blocked" every time, which is what the fallback
         * message was written for and not what it was meant to be *for*. See DECISIONS D-103.
         *
         * A handled link swallows the click so the `Ui` never sees it, or the same press would
         * open the tab here and fire the widget again a frame later.
         */
        const p = clientToLogical(this.vp, e.clientX, e.clientY)
        if (this.hooks.onLinkClick?.(p.x, p.y) === true) return
        this.pendingClick = true
      }
    })
    this.on(window, 'pointercancel', (e) => {
      this.touchUp(e.pointerId)
    })
    // The lift drag has to keep tracking once the finger leaves the canvas, or dragging a pin up
    // past the top of the screen silently stops raising it at the edge.
    this.on(window, 'pointermove', (e) => {
      if (e.pointerType !== 'touch') return
      const p = clientToLogical(this.vp, e.clientX, e.clientY)
      this.touchMove(e.pointerId, p.x, p.y)
    })
    this.on(window, 'keydown', (e) => {
      if (!e.repeat) this.pendingKeys.add(e.code)
      switch (e.code) {
        // ── Playing with the keyboard ──
        case 'KeyQ':
          e.preventDefault()
          this.tensionKeyDown = true
          break
        case 'Space':
          // "Push the pick up", applied to whatever chamber the arrows have the tip on. Held, not
          // toggled — see `tick`.
          e.preventDefault()
          this.spaceDown = true
          break
        case 'ArrowLeft':
          this.stepChamber(-1)
          break
        case 'ArrowRight':
          this.stepChamber(1)
          break
        case 'ArrowUp':
          this.nudgeLift(KEY_LIFT_NUDGE)
          break
        case 'ArrowDown':
          this.nudgeLift(-KEY_LIFT_NUDGE)
          break
        case 'Digit1':
        case 'Digit2':
        case 'Digit3':
        case 'Digit4':
        case 'Digit5':
        case 'Digit6':
        case 'Digit7':
        case 'Digit8':
        case 'Digit9':
          this.setTensionLevel(tensionForStep(Number(e.code.slice(5))))
          break
        case 'Digit0':
          // `0` is the tenth step, where it sits on the keyboard.
          this.setTensionLevel(tensionForStep(TENSION_STEPS))
          break
        // ── Everything else ──
        case 'KeyE':
          this.nudgeTension(0.05)
          break
        case 'KeyR':
          this.hooks.onRestart?.()
          break
        case 'Escape':
          this.hooks.onPause?.()
          break
        case 'Tab':
          e.preventDefault()
          this.hooks.onLoadout?.()
          break
        default:
          break
      }
    })
    this.on(window, 'keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false
      if (e.code === 'KeyQ') this.tensionKeyDown = false
    })
    this.on(window, 'blur', () => {
      this.spaceDown = false
      this.tensionKeyDown = false
    })
  }

  // ── Touch (D-082) ─────────────────────────────────────────────────────────────────────

  /**
   * Tell the input layer that the lock is on screen, and with which layout.
   *
   * Without this a tap anywhere on the bench would be routed as "put the pick under a chamber", and
   * the pause pad's rectangle would sit invisibly over the tier-1 lock cards. The controls are drawn
   * only while picking, so they must only *listen* while picking.
   */
  setPlayScreen(playing: boolean, layout: CutawayLayout | null): void {
    this.playing = playing
    this.layout = layout
  }

  private playing = false

  private touchDown(id: number, x: number, y: number): void {
    if (!this.touch.active) this.hooks.onFirstTouch?.()
    this.touch.active = true
    // Menus are made of widgets and are driven by the ordinary pointer path; only the lock itself
    // has gestures.
    if (!this.playing) return
    if (inRect(PAUSE_PAD, x, y)) {
      this.hooks.onPause?.()
      return
    }
    if (inRect(WITHDRAW_PAD, x, y)) {
      this.withdraw()
      this.touchChamber = -1
      this.touchLift = 0
      return
    }
    const target = targetAt(x, y)
    if (target === 'wrench') {
      this.touch.wrenchPointer = id
      this.touch.step = stepAtY(y)
      return
    }
    // A pin. Selecting is *all* this does — the tip arrives at rest, exactly as an arrow press
    // does, so tapping along a row of pins can never shove one of them (D-051, D-059).
    const layout = this.layout
    if (!layout) return
    const chamber = chamberAtX(layout, x)
    if (chamber < 0) return
    if (chamber !== this.touchChamber) this.touchLift = 0
    this.touchChamber = chamber
    this.touch.liftPointer = id
    this.touch.liftOriginY = y
    this.touch.liftOriginMm = this.touchLift
  }

  private touchMove(id: number, _x: number, y: number): void {
    if (id === this.touch.wrenchPointer) {
      this.touch.step = stepAtY(y)
      return
    }
    if (id !== this.touch.liftPointer) return
    // Vertical only. The finger wandering sideways during a lift is the diagonal drag that made
    // the mouse scheme unplayable, so the x is simply not read here.
    this.touchLift = liftForDrag(this.touch, y, this.liftCeiling)
  }

  private touchUp(id: number): void {
    if (id === this.touch.wrenchPointer) {
      this.touch.wrenchPointer = null
      return
    }
    if (id !== this.touch.liftPointer) return
    this.touch.liftPointer = null
    // The pick comes off the pin. Whatever the springs want to do now, they do.
    this.touchLift = 0
  }

  /** Ceiling for a touch lift, in mm. Set from the loaded lock each frame, like `chamberLimit`. */
  private liftCeiling = 4

  /**
   * Move the keyboard's pick one chamber. Clamped rather than wrapping: a keyway has two ends,
   * and wrapping past the last chamber would teleport the hand the length of the lock.
   */
  /**
   * Move to the next chamber — and **drop the pick on the way**.
   *
   * A mouse user lowers their hand, slides across, and raises it again, because carrying the tip
   * high past a pin you have already set shoves it straight back out (D-051). The keyboard had no
   * way to express that: `keyLift` persisted across an arrow press, so arrowing along the keyway
   * arrived at every new pin with your hand already at full height and slammed it up. Left and
   * right are the *travel* keys; Space is the lift key. Separating them is what makes the two
   * input schemes the same game.
   */
  private stepChamber(delta: number): void {
    if (this.keyChamber < 0) {
      // The pick starts *out* of the lock. The first arrow press inserts it at the mouth.
      this.keyChamber = 0
      this.keyLift = 0
      return
    }
    const next = Math.max(0, Math.min(this.chamberLimit, this.keyChamber + delta))
    if (next !== this.keyChamber) {
      this.keyLift = 0
      // The trim is a property of the chamber you are working, not of the hand. Carrying it along
      // the keyway would be carrying the tip high past a set pin, which is the exact thing this
      // key drops the pick to avoid (D-051).
      this.keyTrim = 0
    }
    this.keyChamber = next
  }

  /**
   * Move the fine trim. Bounded by the lift ceiling in both directions, so holding an arrow down
   * cannot wind up an offset that takes a second of the opposite arrow to unwind.
   *
   * A no-op off Training (D-111). The key legend drops the `↑ ↓` entry on the same condition, so
   * nobody is ever shown a key that does nothing — which is the bug D-105 had just finished being.
   */
  private nudgeLift(delta: number): void {
    if (!this.settings.fineLift) return
    if (this.keyChamber < 0) this.keyChamber = 0
    this.keyTrim = clamp(this.keyTrim + delta, -this.liftCeiling, this.liftCeiling)
  }

  /** What the pick is actually asking for: the held lift plus the trim, never below the floor. */
  private get requestedLift(): number {
    return Math.max(0, this.keyLift + this.keyTrim)
  }

  /** How far the keyboard may step. Set each frame from the lock that is loaded. */
  private chamberLimit = 0

  /**
   * Advance the keyboard's held inputs by a frame.
   *
   * Space is a *held* control, so the lift it asks for grows while it is down and falls back
   * when it is not — the same shape as pushing a pick up and letting the spring take it.
   */
  tick(dt: number, chamberCount: number, maxLift = this.liftCeiling): void {
    this.chamberLimit = Math.max(0, chamberCount - 1)
    this.liftCeiling = maxLift
    if (this.keyChamber > this.chamberLimit) this.keyChamber = this.chamberLimit
    if (this.touchChamber > this.chamberLimit) this.touchChamber = this.chamberLimit
    // Settings are switchable mid-attempt, so a trim applied on Training must not survive a change
    // to a level that has no trim — otherwise the tip stays parked at a height nothing on the new
    // level could have put it at, and no key can bring it back down (D-111).
    if (!this.settings.fineLift) this.keyTrim = 0
    if (this.spaceDown) this.keyLift += KEY_LIFT_RATE * dt
    else this.keyLift = Math.max(0, this.keyLift - KEY_LIFT_RATE * 1.6 * dt)
  }

  /**
   * Always true: picking is the keyboard's job and only the keyboard's (D-059).
   *
   * Kept as a property rather than deleted because the renderer and the HUD ask it, and a lock
   * family that wanted a pointer-driven view again would ask it too.
   */
  get usingKeyboard(): boolean {
    return true
  }

  /** Take the pick out of the lock — everything unset drops. Bound to Escape's sibling, [X]. */
  withdraw(): void {
    this.keyChamber = -1
    this.keyLift = 0
    this.keyTrim = 0
  }

  nudgeTension(delta: number): void {
    this.settings.tensionLevel = clamp01(this.settings.tensionLevel + delta)
  }

  setTensionLevel(level: number): void {
    this.settings.tensionLevel = clamp01(level)
  }


  read(_layout: CutawayLayout, maxLift: number): SimInput {
    if (this.touch.active) {
      return {
        chamber: this.touchChamber,
        liftTarget: clamp(this.touchLift, 0, maxLift),
        ...this.hands(),
      }
    }
    return {
      chamber: this.keyChamber,
      liftTarget: clamp(this.requestedLift, 0, maxLift),
      ...this.hands(),
    }
  }

  /**
   * A face-on lock — `SIMULATION.md §10`.
   *
   * The keyboard reads the same for both views, which is one of the quieter benefits of dropping
   * the mouse (D-059): a disc's angle and a tubular pin's depth were the pointer's *polar*
   * coordinates about the middle of the face, a second control scheme layered on the first, and
   * both are now just "which chamber" and "how far in" like everything else.
   */
  readFace(_layout: FaceLayout, chambers: readonly Chamber[]): SimInput {
    const index = this.touch.active ? this.touchChamber : this.keyChamber
    const lift = this.touch.active ? this.touchLift : this.requestedLift
    const c = index >= 0 ? chambers[index] : undefined
    return {
      chamber: index,
      liftTarget: c ? clamp(lift, 0, c.maxLift) : 0,
      ...this.hands(),
    }
  }

  /**
   * The wrench, which works identically in every view.
   *
   * **Q** holds tension. With `tensionToggle` on — the accessibility setting for players who
   * cannot hold a key down — Q latches instead of holding.
   */
  private hands(): Pick<SimInput, 'tensionHeld' | 'tensionLevel'> {
    // The touch slider *is* the wrench: at step 0 there is no tension, and above it tension is held
    // at that step. One control instead of a held key plus a separate level (D-082).
    if (this.touch.active) {
      return {
        tensionHeld: this.touch.step > 0,
        tensionLevel: tensionForTouchStep(this.touch.step),
      }
    }
    return {
      tensionHeld: this.settings.tensionToggle ? this.toggled : this.tensionKeyDown,
      tensionLevel: this.settings.tensionLevel,
    }
  }

  /** Logical pointer position, for drawing the pick where the hand actually is. */
  get pointer(): { x: number; y: number } {
    return { x: this.pointerX, y: this.pointerY }
  }

  /** Drain the keys pressed since the last call. */
  takeKeys(): Set<string> {
    const out = this.pendingKeys
    this.pendingKeys = new Set<string>()
    return out
  }

  /** Drain whether the primary button was released since the last call. */
  takeClick(): boolean {
    const out = this.pendingClick
    this.pendingClick = false
    return out
  }

  /** Inject a key press, for the pause menu's own shortcuts and for tests. */
  pressKey(code: string): void {
    this.pendingKeys.add(code)
  }

  /** Millimetre height the pointer is at, in cutaway space. */
  pointerMm(layout: CutawayLayout): number {
    return yToMm(layout, this.pointerY)
  }

  dispose(): void {
    for (const d of this.disposers) d()
    this.disposers = []
  }
}
