/**
 * Haptics — the sense this game is about, on the one device that can actually deliver it.
 *
 * SHEAR LINE is a game about *feel*: the whole loop is finding, by touch, which of six pins the
 * plug is currently pinching. On a desktop that is communicated by a number, a bar and a click.
 * On a phone it can be communicated by the phone.
 *
 * It also pays a specific debt. A fingertip cannot resolve the fraction of a millimetre a pin
 * moves, which is why the lift gesture is geared down (`LIFT_DRAG_PX`) and why the wrench now is
 * too (`WRENCH_DRAG_PX`) — but gearing buys precision by making the control slower, and it gives
 * nothing back at the moment something happens. A tick does. See DECISIONS D-131.
 *
 * **Android only, deliberately.** `navigator.vibrate` is unimplemented in Safari on iOS, on every
 * version, and the workaround that circulates — an off-screen `<input type="checkbox" switch>`
 * toggled to trigger the system's own tick — is a rendering side effect of a form control, not an
 * API. It fires at one fixed intensity, only inside a user gesture, and it is one WebKit change
 * away from doing nothing at all. A silent no-op on iOS is the honest behaviour; `isSupported`
 * says which you have, so the settings screen can say so rather than offering a dead switch.
 *
 * No DOM beyond `navigator.vibrate` and no timers, so this stays testable by handing it a fake.
 */

import type { SimEvent } from '../sim'

/** Just enough of `navigator` to vibrate, so tests can pass a stub. */
export interface Vibrator {
  vibrate(pattern: number | readonly number[]): boolean
}

/**
 * The patterns, in milliseconds.
 *
 * Short. All of them shorter than they feel, because a vibration motor has spin-up and spin-down
 * either side of whatever is asked for — 10ms of request is perhaps 40ms of buzz. Anything long
 * enough to be describable as a buzz is too long for an event that happens six times a lock.
 */
export const PATTERNS = {
  /** A pin catching on the ledge: the good one, and the one that must feel crisp. */
  set: 14,
  /** Pushed too far. Duller and doubled — a mistake should not feel like a success. */
  overset: [22, 34, 22],
  /** A false set. Halfway between: something happened, it was not the thing you wanted. */
  falseSet: 9,
  /** One step of the wrench. Barely there — this fires ten times on the way up. */
  detent: 5,
  /** Every driver above the line but the wrench not asking for enough turn to open it. */
  free: [10, 40, 10],
  /** Pins falling back in. The most expensive thing that can happen, and it says so. */
  reset: [30, 40, 60],
  /** The pick has snapped. The attempt is over. */
  broken: [60, 50, 60, 50, 90],
  /** Open. */
  opened: [18, 30, 18, 30, 70],
} as const

/**
 * The shortest gap between two vibrations, in ms.
 *
 * A cascade emits a `RESET` and then a run of per-pin events in the same frame, and firing all of
 * them turns a distinct event into mush — the motor is still spinning down from the last one. The
 * first pattern of a burst wins and the rest are dropped, which is also the right *priority*: the
 * events are pushed in the order the simulation decided them, and the big ones come first.
 */
export const MIN_GAP_MS = 45

export class Haptics {
  /** Off until the settings say otherwise, so nothing buzzes before the player has chosen. */
  enabled = false
  private last = -Infinity

  constructor(
    private readonly device: Vibrator | null,
    /** Injected so this module owns no clock — the caller already has the frame time. */
    private readonly now: () => number,
  ) {}

  /** Whether this device can vibrate at all. False on every iPhone; see the module note. */
  get isSupported(): boolean {
    return this.device !== null
  }

  private fire(pattern: number | readonly number[]): void {
    if (!this.enabled || !this.device) return
    const t = this.now()
    if (t - this.last < MIN_GAP_MS) return
    this.last = t
    // A browser may refuse — a background tab, or a user-gesture requirement not yet met. There is
    // nothing to do about it and nothing worth reporting, so the result is deliberately ignored.
    this.device.vibrate(pattern)
  }

  /** One step of the wrench, called by the input layer rather than driven by a sim event. */
  detent(): void {
    this.fire(PATTERNS.detent)
  }

  handleEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'PIN_SET':
          this.fire(PATTERNS.set)
          break
        case 'PIN_OVERSET':
          this.fire(PATTERNS.overset)
          break
        case 'FALSE_SET_ENTERED':
          this.fire(PATTERNS.falseSet)
          break
        case 'PLUG_FREE':
          this.fire(PATTERNS.free)
          break
        case 'RESET':
          this.fire(PATTERNS.reset)
          break
        case 'PICK_BROKEN':
          this.fire(PATTERNS.broken)
          break
        case 'LOCK_OPENED':
          this.fire(PATTERNS.opened)
          break
        default:
          // PLUG_MOVED, COUNTER_ROTATION and PICK_MOVED fire continuously or on every step, and a
          // motor cannot express a continuous quantity. They are the sound layer's job, not this
          // one's. ATTEMPT_STARTED and PICK_BENT are deliberately silent too — the first is not an
          // event the hand should feel, and the second already arrives with a broken-pick warning
          // on screen.
          break
      }
    }
  }
}

/** The real device, or null where there is not one. */
export function detectVibrator(nav: Navigator | undefined = globalThis.navigator): Vibrator | null {
  if (!nav || typeof nav.vibrate !== 'function') return null
  return { vibrate: (pattern) => nav.vibrate(pattern as number | number[]) }
}
