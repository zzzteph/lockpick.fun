/**
 * The Playwright test hook (VERIFICATION.md §3).
 *
 * `window.__shearline` lets the e2e harness put the game into an exact, reproducible state
 * and photograph it. It is installed only when `import.meta.env.DEV` is true, so it never
 * ships in `dist/`.
 *
 * This file is the single definition of that contract: `src/app.ts` fills the methods in and
 * `e2e/harness.ts` imports the same types, so the harness cannot drift from the game.
 */

import type { SaveData as SaveDataShape } from './game/save'
import type { SimEvent, SimInput, ToolStats } from './sim'

export type { SaveDataShape }

export interface HookChamber {
  index: number
  state: 'FREE' | 'BINDING' | 'FALSE_SET' | 'SET' | 'OVERSET'
  geometry: string
  /** The driver's height. This is the body that decides whether the lock turns. */
  lift: number
  /**
   * The key pin's height — the *other* body in the stack (D-042).
   *
   * Exposed because a browser test that can only see `lift` cannot tell a captured pin from a
   * pin the pick is merely holding up, which is precisely the confusion that shipped a bug: a
   * set driver stayed put but the key pin fell, and no assertion in the suite could see it.
   */
  keyLift: number
  setLift: number
  captureWindow: number
  delta: number
  maxLift: number
  keyPinLength: number
  counterForce: number
  /** Pin profile name, so the harness can tell a spool from a standard pin. */
  profile: string
  /** Lifts at which this chamber presents a groove to the shear line. */
  falseSetLifts: number[]
  /** `pin` | `wafer` | `disc` — which machine this chamber is running. */
  kind: string
  /** Disc detainers: angles where the sidebar drops partway in and stops. */
  falseGates: number[]
  /** Sidebar locks: the lift this chamber's gate wants, or null if it has none. */
  sidebarGate: number | null
  sidebarWidth: number
  /** True once captured *with* the gate lined up. A missed gate is the silent failure. */
  sidebarAligned: boolean
}

export interface HookState {
  lock: { id: number; slug: string; name: string; chamberCount: number }
  seed: number
  ticks: number
  time: number
  tension: number
  theta: number
  thetaMax: number
  thetaDemand: number
  opened: boolean
  bindingChamber: number
  /** False while a sidebar is still holding the plug back. Always true without one. */
  sidebarDropped: boolean
  pickChamber: number
  /** Continuous tip position in chamber units, or -1 when the pick is out (D-045). */
  pickPosition: number
  resistance: number
  /** How hard the tip is loaded, 0..1 — the cause of `resistance` (D-056, D-064). */
  pickForce: number
  /** Accumulated load on the pick; 1 is a permanent bend, 2.4 a break (D-068). */
  pickStrain: number
  pickBent: boolean
  pickBroken: boolean
  ledgeOffset: number
  chambers: HookChamber[]
  stats: {
    setOrder: number[]
    bindOrder: number[]
    oversets: number
    fullResets: number
    falseSetsEntered: number
    maxCounterForce: number
    maxResistance: number
    maxTension: number
    minTensionWhileHeld: number
  }
}

export interface HookOpenSequence {
  running: boolean
  skipped: boolean
  /** Seconds since the lock opened. */
  elapsed: number
  /** How long this open runs for — 2.5s, or longer when many cards fired. */
  duration: number
  /** Beat name from `ART_DIRECTION.md §6`. */
  beat: string
  canSkip: boolean
  settled: boolean
  /** The counter's current value, and the total it is climbing to. */
  creditsShown: number
  credits: number
  cardCount: number
  cardsVisible: number
  reducedMotion: boolean
}

export interface HookLesson {
  id: string
  /** The one line currently on screen, or null once the lesson is done. */
  line: string | null
  step: number
  total: number
  complete: boolean
}

export interface HookRect {
  x: number
  y: number
  w: number
  h: number
}

export interface HookGeometry {
  layout: {
    shearY: number
    mmToPx: number
    left: number
    right: number
    pitch: number
    driverWidth: number
    keyPinWidth: number
    ledgeOffset: number
    theta: number
  }
  chambers: {
    index: number
    shellX: number
    plugX: number
    keyPin: HookRect
    driver: HookRect
    lift: number
    setLift: number
    keyPinLength: number
  }[]
}

export interface HookFrameStats {
  frames: number
  last: number
  /** Intervals between frame callbacks — the browser's scheduling. */
  history: number[]
  /** Time spent inside each frame callback — the game's own cost. */
  work: number[]
}

export interface HookAudio {
  contextState: string
  ready: boolean
  activeVoices: number
  scheduled: number
  stolen: number
  muted: boolean
}

export interface HookFx {
  shake: number
  reducedMotion: boolean
  cameraDrift: number
  pickFlex: number
  chambers: { flash: number; jolt: number; drop: number; falseSet: number; offsetY: number }[]
  /** Fill colour each chamber's driver is currently drawn with. */
  fills: string[]
}

export interface DevHook {
  /** Bumped once per rendered frame — the harness waits on this before screenshotting. */
  framesRendered: number
  /** Set true once the first frame has been painted. */
  ready: boolean
  /** Build phase, for sanity-checking that the harness is talking to the right build. */
  phase: number

  /** Load a lock by numeric id or slug, with an explicit tolerance seed. */
  loadLock(key: number | string, seed?: number): void
  /**
   * Override tool stats and restart the current attempt with them. Lets the harness reach
   * states that depend on a tool the player has not bought yet, and lets a screenshot be
   * taken with tool noise turned off. Pass null to go back to the starter kit.
   */
  setTools(patch: Partial<ToolStats> | null): void
  /** Turn the feathering technique on or off for the current attempt. */
  setFeathering(enabled: boolean): void
  /** Override player input; pass null to hand control back to the mouse. */
  setInput(patch: Partial<SimInput> | null): void
  /**
   * What the input layer is asking for **right now** — the counterpart to `setInput`.
   *
   * Needed because picking is keyboard-only (D-059): a test drives real key events and then has
   * to know what they added up to. `getState` cannot answer it — the simulation stores where the
   * pins *are*, not what the hand asked for, and on a bound pin those are very different numbers.
   */
  getInput(): SimInput
  /** Stop the rAF driver so `stepTicks` is the only source of time. */
  setManual(manual: boolean): void
  /** Advance exactly `n` simulation ticks with the current input. */
  stepTicks(n: number): void
  /** Draw one frame without advancing time. */
  renderOnce(): void
  /**
   * Run whole 60fps frames covering `seconds` of wall time.
   *
   * `stepTicks` advances the *simulation*; this advances the **game loop**, which is what the
   * open sequence and the effect decays actually run on. `renderOnce` draws with `dt = 0` by
   * design, so it cannot be used to move time along.
   */
  advanceSeconds(seconds: number): void
  getState(): HookState
  /** Rendered pin rectangles, for asserting the view against the sim numerically. */
  getGeometry(): HookGeometry
  /** Client coordinates the mouse should be at to ask for this chamber and lift. */
  pointerFor(chamber: number, liftMm: number): { x: number; y: number }
  events(): SimEvent[]
  waitForEvent(type: string, timeoutMs?: number): Promise<void>
  frameStats(): HookFrameStats
  /** Current feedback-effect magnitudes, for asserting on feel. */
  getFx(): HookFx
  /** Force the reduced-motion setting rather than waiting on the media query. */
  setReducedMotion(reduced: boolean): void
  /** Audio graph status — context state, voice count, and how many the cap stole. */
  audioState(): HookAudio
  /** Create the audio context, as a user gesture would. */
  unlockAudio(): Promise<void>
  setMuted(muted: boolean): void
  /** Fire `count` synthetic PIN_SET events at once — the 12-chamber rake of AUDIO.md §6. */
  audioBurst(count: number): void

  // ── Shell and save ────────────────────────────────────────────────────────────────────
  getScreen(): string
  goto(name: string): void
  getSave(): SaveDataShape
  setSave(data: SaveDataShape): void
  exportSaveText(): string
  importSaveText(text: string): void
  /** Deliver a UI click at a logical coordinate, without moving the real pointer. */
  clickAt(x: number, y: number): void
  /**
   * Drive the lock editor without clicking pixels (D-080).
   *
   * A browser test for the editor should be about the lock that comes out of it, not about where
   * the buttons happen to sit this week — so it goes through the same actions the screen does.
   */
  editorAction(name: 'chambers' | 'depth' | 'pin' | 'spring' | 'test' | 'save' | 'reset', value?: number): void
  lockCount(): number
  /** Every lock slug in the roster, in bench order. */
  lockSlugs(): string[]
  /**
   * Where the pick tip is being *drawn*, in logical pixels.
   *
   * Distinct from `getState().pickChamber`, which is where the simulation has quantised it to.
   * The gap between the two is the whole point of drawing the pick at the hand.
   */
  pickTip(): { x: number; y: number; chamber: number }
  /** The stat block the simulation is currently reading, after the loadout is applied. */
  getToolStats(): ToolStats
  /** Challenge modifiers opted into for the next attempt. */
  getChallenges(): string[]
  toggleChallenge(id: string): void

  /** The open sequence's live state, for asserting the beats in a real browser. */
  openSequence(): HookOpenSequence
  /** Ask the sequence to skip, exactly as a keypress would. Returns whether it took. */
  skipOpenSequence(): boolean
  /** Achievement ids earned by the attempt that just finished, in card order. */
  earnedThisAttempt(): string[]
  /** Every achievement id the game knows about, for checking a save has no orphans. */
  achievementIds(): string[]

  /** Begin one of the three lessons. */
  startLesson(id: string): void
  /** The running lesson, or null. */
  lessonState(): HookLesson | null
  /** Captions currently on screen, oldest first. */
  subtitles(): string[]
  /** Which widget the keyboard is on, and whether the ring is showing. */
  focusState(): { index: number; count: number; keyboardMode: boolean }
  /**
   * Whether the game has switched to the touch scheme — set by the first touch that lands.
   *
   * A mobile screenshot taken without this is a screenshot of the *desktop* chrome at a phone
   * size, because the wrench slider and the pads are only drawn once `touch.active` is true
   * (D-082). Asking is how that test stops being a lie.
   */
  getTouch(): boolean
  /**
   * The wrench three ways: the touch slider's step, the tension the simulation is actually being
   * given, and the step the footer meter prints.
   *
   * All three must agree. They did not on any touch device — the HUD read the keyboard's tension
   * field, which the slider never writes, so the footer said `wrench 5 of 10` for the entire life
   * of every attempt. Exposed so a test can hold them against each other. See DECISIONS D-131.
   */
  getWrench(): { step: number; tension: number; printedStep: number }
  /**
   * The exact font string every draw call is made with — DECISIONS D-146.
   *
   * Exposed because a test that sets its own `ctx.font` to the family it hopes for proves only that
   * the family exists on the machine. What has to be true is that the **game's own stack** resolves
   * to the shipped face, and the only way to assert that is to measure the string the game uses.
   */
  fontStack(): string
  /**
   * Draw one frame with the layout probe on, and return what the rules make of it.
   *
   * Every mobile layout bug so far has been found by a person studying a screenshot, which does not
   * cover ten screens across twelve phones and never catches what nobody thought to look at. This
   * makes the drawing report itself. See DECISIONS D-132.
   */
  auditScreen(): {
    findings: { kind: string; detail: string; value: number }[]
    drawn: number
    scale: number
  }
}

declare global {
  /**
   * The build version, replaced at build time by Vite from package.json (D-126).
   *
   * Declared rather than imported so nothing in  reads a JSON file at runtime, and so the
   * constant folds away into a string literal in the bundle.
   */
  const __APP_VERSION__: string
  var __shearline: DevHook | undefined
}

/** Populated by `startApp`; the fields above are all assigned before the first frame. */
const hook = { framesRendered: 0, ready: false, phase: 0 } as DevHook

/** Install the hook (dev only) and return it. In production returns a detached object. */
export function installDevHook(phase: number): DevHook {
  hook.phase = phase
  if (import.meta.env.DEV) {
    globalThis.__shearline = hook
  }
  return hook
}

export function devHook(): DevHook {
  return hook
}
