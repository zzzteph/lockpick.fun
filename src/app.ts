/**
 * The application: screens, session, input, loop, renderer, audio.
 *
 * A small screen machine. Only the pick screen runs the simulation; the rest are drawn from
 * the player's save. The `window.__shearline` hook (dev builds only) is assembled at the
 * bottom — it is how the Playwright harness puts the game into an exact state.
 */

import { AudioEngine } from './audio/engine'
import {
  installDevHook,
  type DevHook,
  type HookAudio,
  type HookFrameStats,
  type HookFx,
  type HookLesson,
  type HookOpenSequence,
  type HookGeometry,
  type HookState,
} from './devhook'
import { ALL_LOCKS, findLock } from './game/locks'
import { startLoop, type Loop } from './game/loop'
import { ACHIEVEMENTS, type Achievement } from './game/achievements'
import { Progress, outcomeFrom, type AttemptOutcome, type AttemptResult } from './game/progress'
import {
  MemoryStorage,
  exportSave,
  importSave,
  seedForLock,
  writeSave,
  type SaveData,
  type SettingsData,
  type StorageLike,
} from './game/save'
import { Session } from './game/session'
import {
  currentLine,
  lessonById,
  startLesson as beginLesson,
  updateLesson,
  type LessonRun,
} from './game/tutorial'
import { drawCutaway, driverFill } from './render/cutaway'
import { drawGrid, text } from './render/draw'
import {
  cameraDrift,
  chamberOffsetY,
  clearFx,
  createFx,
  pickFlex,
  pushFxEvent,
  resizeFx,
  shakeOffset,
  updateFx,
  type Fx,
} from './render/fx'
import {
  computeFaceLayout,
  drawFaceOn,
  drawFaceTool,
  faceKindFor,
  toolTip,
  type FaceLayout,
} from './render/faceon'
import { BENCH_LINK, drawHud } from './render/hud'
import {
  canSkip,
  cardVisible,
  createOpenSequence,
  rankReveal,
  currentBeat,
  impactJolt,
  isSettled,
  sequenceSeconds,
  skipOpenSequence,
  startOpenSequence,
  updateOpenSequence,
} from './render/opensequence'
import { drawOpenSequence } from './render/payoff'
import {
  clearSubtitles,
  createSubtitles,
  drawLessonLine,
  drawSubtitles,
  pushSubtitleEvents,
  updateSubtitles,
} from './render/subtitles'
import {
  computeLayout,
  driverPinRect,
  keyPinRect,
  mmToY,
  plugChamberX,
  shellChamberX,
  type CutawayLayout,
} from './render/layout'
import { FONT_STACK, THEMES, TYPE, font, type Palette } from './render/palette'
import { drawPick, drawPickTarget, pickRender } from './render/pick'
import {
  drawRotatePrompt,
  drawTouchControls,
  isCoarsePointer,
  isPortrait,
  tryRotateToLandscape,
} from './render/touchui'
import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  beginFrame,
  clipToStage,
  createViewport,
  isCompact,
  syncViewport,
  touchFloorFor,
  typeFor,
} from './render/viewport'
import {
  KEYWAY_FLOOR,
  STARTER_TOOLS,
  THETA_OPEN,
  T_MIN_HOLD,
  pickedButUnturned,
  falseSetLifts,
  makeConfig,
  withTools,
  type LockDef,
  type SimEvent,
  type SimInput,
  type SimState,
  type ToolStats,
} from './sim'
import { DEFAULT_INPUT_SETTINGS, InputController, LIFT_PX_PER_MM } from './ui/input'
import { Haptics, detectVibrator } from './ui/haptics'
import { auditLayout, type Box, type Finding } from './render/audit'
import { assemblyBounds } from './render/layout'
import { startRecording, stopRecording } from './render/probe'
import {
  LIFT_PAD,
  PAUSE_PAD,
  WITHDRAW_PAD,
  WRENCH_SLIDER,
  mirrorRect,
} from './ui/touch'
import {
  EDITABLE_PINS,
  MAX_TOLERANCE,
  MIN_DEPTH,
  MIN_TOLERANCE,
  SPRING_CHOICES,
  clampChamberCount,
  snapDepth,
  draftFromLockDef,
  draftProblem,
  draftToLockDef,
  maxDepthFor,
  newDraft,
  type Draft,
} from './game/editor'
import { decodeLock, encodeLock, formatCode } from './game/sharecode'
import { REPO_URL, newIssueUrl } from './game/repo'
import {
  forkLink,
  outwardLinksOn,
  reportLink,
  drawBench,
  drawCodes,
  drawEditor,
  drawMenu,
  drawPause,
  drawResults,
  drawSettings,
  drawTrophies,
  drawTutorial,
  codesPageCount,
  codesRoster,
  trophyPageCount,
  type ScreenName,
  type ShellActions,
  type ShellContext,
} from './ui/shell'
import { HELP_PAGE_COUNT, drawHelp } from './ui/help'
import { Ui, grown, pointInRect, type Rect, type UiFrame } from './ui/widgets'

export interface App {
  readonly hook: DevHook
  readonly audio: AudioEngine
  readonly progress: Progress
  loadLock(key: number | string, seed?: number): void
  destroy(): void
}

/**
 * Open a URL in a new tab, and report whether the browser allowed it.
 *
 * `noopener,noreferrer` so the opened page gets no handle on this one. A blocked popup is the worst
 * kind of failure — the click does nothing and the player concludes the link is broken — so the
 * callers say so rather than letting it pass silently.
 */
function openTab(url: string): boolean {
  return window.open(url, '_blank', 'noopener,noreferrer') !== null
}

function safeStorage(): StorageLike {
  try {
    const probe = '__shearline_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    // Private browsing, or storage disabled. The game still runs; progress just will not
    // survive the tab. Better than refusing to start.
    return new MemoryStorage()
  }
}

export function startApp(canvas: HTMLCanvasElement, storage: StorageLike = safeStorage()): App {
  const hook = installDevHook(7)
  const vp = createViewport(canvas)
  const progress = new Progress(storage)
  let palette: Palette = THEMES[progress.data.settings.theme]

  let config = makeConfig({ tools: STARTER_TOOLS })
  let toolOverride: Partial<ToolStats> | null = null
  let featherOverride: boolean | null = null

  let screen: ScreenName = 'menu'
  let previousScreen: ScreenName = 'menu'
  let session: Session | null = null
  let layout: CutawayLayout = computeLayout(1, 0)
  // Non-null exactly when the current lock is drawn and driven face-on rather than in the
  // side cutaway — the disc detainers and the tubulars (`SIMULATION.md §10`).
  let face: FaceLayout | null = null
  let scriptedInput: SimInput | null = null
  let outcome: AttemptOutcome | undefined
  let result: AttemptResult | null | undefined
  /**
   * Seconds since the results screen was entered, for the rank stamp's landing (D-154).
   *
   * Advanced by the same `seconds` every other clock in the game runs on, so the animation is
   * deterministic under `advanceSeconds` and settles identically in a test and in play.
   */
  let resultsAge = 0
  /**
   * Today, as an ISO date, for the play-day tally (D-090).
   *
   * The one place the game reads the clock. `src/sim/` may never touch it — the whole simulation is
   * deterministic and the lint enforces that — but "which day is it" is not a simulation question.
   */
  const today = (): string => new Date().toISOString().slice(0, 10)
  let earnedThisAttempt: Achievement[] = []
  const sequence = createOpenSequence(false)
  const subtitles = createSubtitles()

  /** Non-null while a tutorial lesson is being played. */
  let lesson: LessonRun | null = null
  let status = ''
  let challenges: string[] = []

  /**
   * The lock being designed on the editor screen (D-080).
   *
   * One draft, held for the session rather than per visit: wandering off to the bench to look at a
   * tier-3 lock and coming back to an empty form is the sort of thing that makes an editor feel
   * hostile. It is deliberately *not* saved — what gets saved is the finished `LockDef`.
   */
  /** Whether the *next* lock started from the bench is an inspection rather than an attempt. */
  let inspectNext = false
  /** True while the pointer is over the pick screen's bench link (D-096). */
  let overBenchLink = false
  let draft: Draft = newDraft()
  /** True while keystrokes are going into the draft's name rather than anywhere else. */
  let editingName = false
  /**
   * The share code being typed on the codes screen, and whether keys are going into it (D-101).
   *
   * A box you can type into, because the only way in was a Paste button and a button that reads the
   * clipboard is not a thing people expect to exist — *"paste from the clipboard is not very
   * obvious."* Paste now fills this field rather than importing behind your back, so a code you
   * received is something you can see before you commit to it.
   */
  let codeEntry = ''
  let codeFocus = false
  /**
   * Which page of the player's own locks the codes screen is showing, and which delete is primed.
   *
   * Both live here rather than in the shell because the shell redraws from scratch every frame and
   * holds no state of its own — the same reason `editingName` is here.
   */
  let codesPage = 0
  let rosterPage = 0
  /** Which page of the trophy case is showing — compact only, where 34 plates do not fit (D-129). */
  let trophyPage = 0
  let armedDelete: string | null = null
  /** Which tier the bench is showing, or undefined for "wherever they got to" (D-102). */
  let benchTier: number | undefined
  /** Which of the help screen's three pages is showing (D-103). */
  let helpPage = 0

  const eventLog: SimEvent[] = []
  const eventWaiters: { type: string; resolve: () => void }[] = []
  const ui = new Ui()

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const fx: Fx = createFx(0, motionQuery.matches || progress.data.settings.reducedMotion)
  motionQuery.addEventListener('change', (e) => {
    fx.reducedMotion = e.matches || progress.data.settings.reducedMotion
  })
  let currentFlex = 0
  let currentDrift = 0

  const audio = new AudioEngine({
    master: progress.data.settings.masterVolume,
    mechanical: progress.data.settings.mechanicalVolume,
    ambient: progress.data.settings.ambientVolume,
    ui: progress.data.settings.uiVolume,
    muted: progress.data.settings.muted,
  })
  /**
   * The phone's motor, driven by the same event stream as the sound (D-131).
   *
   * `performance.now` rather than the frame's own clock because the rate limit is about the motor
   * spinning down, which is wall time — a paused or slowed frame loop must not let a burst through.
   */
  const haptics = new Haptics(detectVibrator(), () => performance.now())
  haptics.enabled = progress.data.settings.haptics
  const unlockAudio = (): void => {
    void audio.unlock()
  }
  window.addEventListener('pointerdown', unlockAudio)
  window.addEventListener('keydown', unlockAudio)

  function currentConfig(): ReturnType<typeof makeConfig> {
    // One kit, always (D-088). `toolOverride` survives because the dev hook still uses it to
    // put the simulation into an exact tool state for a test.
    const tools = toolOverride ? withTools(progress.toolStats(), toolOverride) : progress.toolStats()
    return makeConfig({
      tools,
      assist: progress.data.settings.assist,
      featherEnabled: featherOverride ?? progress.hasFeathering,
    })
  }

  /**
   * The mouse pointer. An ordinary arrow, on every screen, never hidden.
   *
   * It used to become a crosshair while picking, because the mouse *was* the pick. It is not any
   * more (D-059) — the keyboard picks and the mouse operates the interface — so a crosshair on the
   * pick screen would be pointing at a tool it cannot move. The pointer still needs to be visible
   * there: the header carries a way back to the bench.
   */
  function applyCursor(_next: ScreenName): void {
    canvas.style.cursor = 'default'
  }

  function goto(next: ScreenName): void {
    previousScreen = screen
    screen = next
    if (next === 'results') resultsAge = 0
    ui.reset()
    applyCursor(next)
    // Immediately, not on the next frame: a finger that lands the instant the lock appears must
    // already be a gesture on the lock rather than a stray tap on the screen it came from (D-082).
    input.setPlayScreen(next === 'pick' && session !== null, face ? null : layout)
    if (next !== 'pick') audio.hush()
  }

  /**
   * Start a tutorial lesson. Its lock never reaches the roster, so there is no payout, no
   * record and no achievement — a lesson teaches, it does not pay.
   */
  function startLesson(id: string, seed = 3): void {
    const l = lessonById(id)
    if (!l) throw new Error(`Unknown lesson "${id}"`)
    lesson = beginLesson(l)
    startLock(l.lock, seed)
  }

  function finishLesson(): void {
    if (!lesson) return
    if (lesson.complete && !progress.data.tutorial.includes(lesson.lesson.id)) {
      progress.data.tutorial.push(lesson.lesson.id)
      progress.save()
    }
    lesson = null
  }

  /**
   * The seed for a lock, which is a property of *this bench* rather than of the clock.
   *
   * It used to be `Date.now() % 100000`, so every attempt rolled a different binding order, a
   * different heavy chamber and a different set of springs. That made the per-chamber character
   * (D-052, D-062) unlearnable in exactly the way it was documented as learnable — "number three is
   * the heavy one" was true for one attempt and then false. A lock you own is one lock.
   * See DECISIONS D-073.
   */
  function seedFor(def: LockDef): number {
    return seedForLock(def.slug, progress.data.lockSalt)
  }

  /**
   * Inspection mode — study a lock, with nothing riding on it (D-092).
   *
   * The lock behaves *exactly* as it always does: it binds, it lies, it sets, it opens. What is
   * suspended is the bookkeeping — no rank, no record, no achievements, no clock. It is the mode a
   * real picker spends most of their time in, and the one this game has never had: somewhere to
   * find the binding order of a specific lock without the finding costing you the run.
   *
   * That it carries over is the point. `lockSalt` makes every lock a stable physical copy (D-073),
   * so the binding order you learn here is the binding order you meet later.
   */
  let inspecting = false

  function startLock(def: LockDef, seed = seedFor(def), inspect = false): void {
    inspecting = inspect
    session = new Session(def, seed, currentConfig())
    layout = computeLayout(def.bitting.length, 0, def.rows ?? 1, mirrored())
    const kind = faceKindFor(def.family)
    face = kind ? computeFaceLayout(def.bitting.length, kind, 0) : null
    resizeFx(fx, def.bitting.length)
    clearFx(fx)
    eventLog.length = 0
    outcome = undefined
    result = undefined
    earnedThisAttempt = []
    sequence.running = false
    sequence.elapsed = 0
    sequence.reducedMotion = fx.reducedMotion
    clearSubtitles(subtitles)
    status = ''
    goto('pick')
  }

  const actions: ShellActions = {
    goto,
    startLock: (def) => {
      startLock(def, seedFor(def), inspectNext)
    },
    toggleInspect: () => {
      inspectNext = !inspectNext
    },
    resume: () => {
      goto('pick')
    },
    restart: () => {
      if (session) startLock(session.def, session.seed, inspecting)
    },
    abandon: () => {
      // Abandoning a lesson abandons the lesson, not just the attempt — otherwise the line at
      // the bottom of the screen would follow the player onto their next lock. It also goes
      // back to where the lesson was started, which is not where a lock attempt goes.
      const wasLesson = lesson !== null
      lesson = null
      session = null
      goto(wasLesson ? 'tutorial' : 'bench')
    },
    startLesson: (id: string) => {
      startLesson(id)
    },
    updateSettings: (patch: Partial<SettingsData>) => {
      progress.updateSettings(patch)
      applySettings()
    },
    toggleChallenge: (id: string) => {
      challenges = challenges.includes(id)
        ? challenges.filter((c) => c !== id)
        : [...challenges, id]
    },
    // ── The lock editor (D-080) ──
    //
    // Every one of these clamps rather than validates: the count, the depth and the tolerance are
    // bounded on the way in, so the only errors `draftProblem` can ever report are the structural
    // ones the editor cannot rule out by construction.
    editorChamberCount: (n: number) => {
      const want = clampChamberCount(n)
      const rows = draft.chambers.slice(0, want)
      while (rows.length < want) {
        // A new chamber copies the last one: adding a sixth to five spools should give you six
        // spools, not five spools and a standard pin nobody asked for.
        const previous = rows[rows.length - 1]
        rows.push(
          previous ? { ...previous } : { depth: 3.2, pin: 'standard', spring: 1 },
        )
      }
      draft = { ...draft, chambers: rows }
    },
    editorDepth: (index: number, depth: number) => {
      const row = draft.chambers[index]
      if (!row) return
      // Snapped to the shared grid, so every depth the editor can hold is one a share code can
      // carry and one the +/- buttons can reach (D-093).
      const capped = Math.max(MIN_DEPTH, Math.min(maxDepthFor(row.pin), snapDepth(depth)))
      draft.chambers[index] = { ...row, depth: snapDepth(capped) }
    },
    editorCyclePin: (index: number) => {
      const row = draft.chambers[index]
      if (!row) return
      const at = EDITABLE_PINS.indexOf(row.pin)
      const pin = EDITABLE_PINS[(at + 1) % EDITABLE_PINS.length] ?? 'standard'
      // A deeper-grooved driver needs more of the chamber, so the cut may have to come back up
      // with it — otherwise switching pin silently produces a lock that cannot false-set.
      const depth = Math.min(row.depth, maxDepthFor(pin))
      draft.chambers[index] = { ...row, pin, depth: snapDepth(depth) }
      audio.click()
    },
    editorCycleSpring: (index: number) => {
      const row = draft.chambers[index]
      if (!row) return
      draft.chambers[index] = { ...row, spring: (row.spring + 1) % SPRING_CHOICES.length }
      audio.click()
    },
    editorTolerance: (q: number) => {
      const rounded = Math.round(q * 20) / 20
      draft = {
        ...draft,
        toleranceQuality: Math.max(MIN_TOLERANCE, Math.min(MAX_TOLERANCE, rounded)),
      }
    },
    editorKeyway: (k) => {
      draft = { ...draft, keyway: k }
    },
    editorFocusName: (on: boolean) => {
      editingName = on
    },
    editorCopyCode: () => {
      const problem = draftProblem(draft, progress.data.customLocks.length)
      if (problem) {
        status = problem
        return
      }
      const code = formatCode(encodeLock(draftToLockDef(draft, progress.data.customLocks.length)))
      void navigator.clipboard
        ?.writeText(code)
        .then(() => {
          status = `copied ${code}`
        })
        .catch(() => {
          // A browser that refuses clipboard access still has to tell the player the code, or the
          // feature simply does not exist for them.
          status = `clipboard refused — your code is ${code}`
        })
    },
    editorPasteCode: () => {
      void navigator.clipboard
        ?.readText()
        .then((text) => {
          const r = decodeLock(text, progress.data.customLocks.length)
          if (r.problem !== null) {
            status = r.problem
            return
          }
          draft = draftFromLockDef(r.def)
          editingName = false
          status = `loaded a shared lock — ${r.def.bitting.length} chambers`
        })
        .catch(() => {
          status = 'could not read the clipboard'
        })
    },
    /**
     * Clipboard, with the status line as the receipt (D-099).
     *
     * The failure path matters more than the happy one: a browser that refuses clipboard access
     * must still put the string somewhere the player can select it, or the feature does not exist
     * for them at all. So a refusal prints the value rather than an apology.
     */
    copyText: (value: string, what: string) => {
      void navigator.clipboard
        ?.writeText(value)
        .then(() => {
          status = `copied ${what}`
        })
        .catch(() => {
          status = `clipboard refused — ${what} is ${value}`
        })
    },
    codeFocus: (on: boolean) => {
      codeFocus = on
      armedDelete = null
    },
    codeClear: () => {
      codeEntry = ''
      codeFocus = true
    },
    // Fills the box rather than importing behind the player's back: what arrived on the clipboard
    // is now a thing they can read before they commit to it (D-101).
    codePaste: () => {
      void navigator.clipboard
        ?.readText()
        .then((text) => {
          codeEntry = text.trim().toUpperCase().slice(0, 45)
          codeFocus = true
          status = ''
        })
        .catch(() => {
          status = 'could not read the clipboard — type the code in instead'
        })
    },
    codeSubmit: () => {
      const r = decodeLock(codeEntry, progress.data.customLocks.length)
      if (r.problem !== null) {
        status = r.problem
        return
      }
      // Straight onto the bench rather than into the editor's draft: a code you were *sent* is a
      // lock to pick, and making the player press Save before they can play it is a step that
      // exists only because the editor happened to be where paste used to live.
      progress.addCustomLock(r.def)
      codeEntry = ''
      codeFocus = false
      status = `${r.def.name} added — ${r.def.bitting.length} chambers`
      audio.click()
    },
    armDelete: (slug: string | null) => {
      armedDelete = slug
    },
    deleteCustomLock: (index: number) => {
      const gone = progress.removeCustomLock(index)
      armedDelete = null
      if (!gone) return
      status = `${gone.name} deleted`
      audio.click()
    },
    // Clamped at both ends, not just at zero — a swipe has no disabled state to stop it at the
    // last page, so without an upper bound the stored page walks off the end (D-131).
    codesPageBy: (delta: number) => {
      const last = codesPageCount(vp, progress.data.customLocks.length) - 1
      codesPage = Math.min(last, Math.max(0, codesPage + delta))
      armedDelete = null
    },
    rosterPageBy: (delta: number) => {
      const last = codesRoster(progress.data.customLocks.length).pages - 1
      rosterPage = Math.min(last, Math.max(0, rosterPage + delta))
    },
    trophyPageBy: (delta: number) => {
      trophyPage = Math.min(trophyPageCount(vp) - 1, Math.max(0, trophyPage + delta))
      audio.click()
    },
    benchTier: (tier: number) => {
      benchTier = tier
      audio.click()
    },
    helpPage: (page: number) => {
      helpPage = Math.min(HELP_PAGE_COUNT - 1, Math.max(0, page))
      audio.click()
    },
    openRepo: () => {
      if (!openTab(REPO_URL)) status = `blocked — the repo is ${REPO_URL}`
    },
    /**
     * The report link, with the context already written in (D-102).
     *
     * `screen` and the lock come from here because this is the only place that knows them; the
     * player supplies what went wrong. A tab that fails to open — a popup blocker, usually — says
     * so and prints the address, for the same reason a refused clipboard prints the code.
     */
    reportIssue: () => {
      const url = newIssueUrl({
        screen,
        lock: session?.def.name,
        version: `${__APP_VERSION__} · save v${progress.data.version}`,
      })
      if (!openTab(url)) status = `blocked — report issues at ${REPO_URL}/issues`
    },
    editDef: (def: LockDef) => {
      // A copy, and straight to the editor — the point of the button is that you are already
      // looking at the lock you want to change (D-100).
      draft = draftFromLockDef(def)
      editingName = false
      status = `editing a copy of ${def.name}`
      goto('editor')
      audio.click()
    },
    editorLoad: (index: number) => {
      const def = progress.data.customLocks[index]
      if (!def) return
      // Loading *copies* into the draft: saving again adds a new lock rather than overwriting, so
      // there is no way to lose a lock you liked by opening it to try a variation.
      draft = draftFromLockDef(def)
      editingName = false
      status = `editing a copy of ${def.name}`
    },
    editorTest: () => {
      // Tested against the *next* index so a draft picks identically before and after saving.
      const problem = draftProblem(draft, progress.data.customLocks.length)
      if (problem) {
        status = problem
        return
      }
      editingName = false
      startLock(draftToLockDef(draft, progress.data.customLocks.length))
    },
    editorSave: () => {
      const index = progress.data.customLocks.length
      const problem = draftProblem(draft, index)
      if (problem) {
        status = problem
        return
      }
      progress.addCustomLock(draftToLockDef(draft, index))
      editingName = false
      status = `${draft.name} saved to the bench`
      audio.click()
    },
    editorReset: () => {
      draft = newDraft()
      editingName = false
      status = ''
    },
    exportSave: () => {
      status = downloadSave(progress.data)
    },
    importSave: () => {
      void pickSaveFile().then((text) => {
        if (text === null) return
        try {
          progress.data = importSave(text)
          writeSave(storage, progress.data)
          applySettings()
          status = 'save imported'
        } catch (err) {
          status = `import failed: ${err instanceof Error ? err.message : String(err)}`
        }
      })
    },
  }

  function applySettings(): void {
    const s = progress.data.settings
    palette = THEMES[s.theme]
    // The seam that keeps save.ts's InterfaceMode and viewport.ts's in step: if either union
    // gains a value the other lacks, this assignment is where the compiler says so (D-160).
    vp.interfaceMode = s.interfaceMode
    fx.reducedMotion = motionQuery.matches || s.reducedMotion
    input.settings.sensitivity = s.sensitivity
    input.settings.tensionToggle = s.tensionToggle
    // The arrow trim is a teaching control and belongs to Training alone (D-111). Set here rather
    // than read at the key handler so a level change mid-attempt takes effect immediately, trim
    // and legend together.
    input.settings.fineLift = s.assist === 'training'
    // Right-handed mirrors the controls as well as the cutaway (D-130).
    input.settings.mirrored = s.handedness === 'right'
    audio.applySettings({
      master: s.masterVolume,
      mechanical: s.mechanicalVolume,
      ambient: s.ambientVolume,
      ui: s.uiVolume,
      muted: s.muted,
    })
    audio.setContinuousTones(s.continuousTones)
    haptics.enabled = s.haptics
  }

  const input = new InputController(
    canvas,
    vp,
    {
      ...DEFAULT_INPUT_SETTINGS,
      sensitivity: progress.data.settings.sensitivity,
      tensionToggle: progress.data.settings.tensionToggle,
      mirrored: progress.data.settings.handedness === 'right',
    },
    {
      // A phone that can turn itself landscape should, rather than asking (D-129).
      onFirstTouch: () => {
        tryRotateToLandscape(canvas)
      },
      onRestart: () => {
        if (screen === 'pick' && session) startLock(session.def)
      },
      onPause: () => {
        if (screen === 'pick') goto('pause')
        else if (screen === 'pause') goto('pick')
        else if (screen !== 'menu') goto(previousScreen === 'pick' ? 'bench' : 'menu')
      },
      /**
       * The outward links, opened inside the pointer event so the browser allows the tab (D-103).
       *
       * Only on the screens that draw them: the report link lives in `screenFrame`, which the pick
       * and pause screens do not use, and the fork link is the menu's alone. Hit-testing them
       * everywhere would swallow clicks on whatever else happens to be in that corner.
       */
      onLinkClick: (x: number, y: number): boolean => {
        // Both links are 40 logical px tall — fourteen CSS px on a phone. They get the finger
        // floor like every other target (D-131); they are isolated in their corners, so growing
        // them can steal nothing.
        const floor = input.touch.active ? touchFloorFor(vp) : 0
        const inside = (r: Rect): boolean => pointInRect(grown(r, floor), x, y)
        /*
         * Only where the link is actually drawn — DECISIONS D-135.
         *
         * Both are gated on a phone now, and a hit test that did not follow would leave an
         * invisible 250x90 rectangle in the corner of six screens that opens a browser tab. The
         * screen names here are the same titles `screenFrame` is called with, so the two cannot
         * drift: `outwardLinksOn` is the single answer.
         */
        const framed = screen !== 'pick' && screen !== 'pause'
        const title =
          screen === 'menu' ? 'Shear line' : screen === 'settings' ? 'Settings' : screen
        if (framed && outwardLinksOn(vp, title) && inside(reportLink(vp))) {
          actions.reportIssue()
          return true
        }
        if (screen === 'menu' && !isCompact(vp) && inside(forkLink(vp))) {
          actions.openRepo()
          return true
        }
        return false
      },
      onLoadout: () => {
        // Tab used to open the loadout while picking. There is no loadout (D-088), and there is
        // nothing else worth taking Tab away from the widgets for, so it now does nothing here and
        // stays the focus-advance key everywhere.
      },
      // A tick per step of the wrench. This is the gearing's counterpart: the drag was made slower
      // to buy precision, and the detent is what gives the hand something back for it (D-131).
      onWrenchStep: () => haptics.detent(),
    },
  )
  applySettings()
  // The game opens on the menu without going through `goto`, so set the pointer for it here.
  applyCursor(screen)

  /** True when the player has chosen a right-handed lock, so the cutaway is mirrored. */
  function mirrored(): boolean {
    return progress.data.settings.handedness === 'right'
  }

  function maxLift(): number {
    let m = 1
    for (const c of session?.state.chambers ?? []) if (c.maxLift > m) m = c.maxLift
    return m
  }

  function currentInput(): SimInput {
    if (scriptedInput) return scriptedInput
    if (screen !== 'pick') {
      return { chamber: -1, liftTarget: 0, tensionHeld: false, tensionLevel: 0 }
    }
    if (face && session) return input.readFace(face, session.view.chambers)
    return input.read(layout, maxLift())
  }

  /** Advance the keyboard's held controls. Called once a frame, before the input is read. */
  function tickKeyboard(seconds: number): void {
    // The tallest chamber in the lock is the ceiling a finger drag maps onto, so the same gesture
    // reaches the top of the travel whatever is loaded (D-082).
    const chambers = session?.state.chambers
    const ceiling = chambers?.length ? Math.max(...chambers.map((c) => c.maxLift)) : 4
    input.setPlayScreen(screen === 'pick' && session !== null, face ? null : layout)
    input.tick(seconds, chambers?.length ?? 0, ceiling)
  }

  function absorb(events: readonly SimEvent[]): void {
    if (events.length === 0 || !session) return
    audio.handleEvents(events, session.state)
    haptics.handleEvents(events)
    if (progress.data.settings.subtitles) pushSubtitleEvents(subtitles, events)
    eventLog.push(...events)
    if (eventLog.length > 512) eventLog.splice(0, eventLog.length - 512)
    for (const e of events) {
      pushFxEvent(fx, e)
      if (e.type === 'LOCK_OPENED') finishAttempt()
      for (let i = eventWaiters.length - 1; i >= 0; i -= 1) {
        const w = eventWaiters[i]
        if (w && w.type === e.type) {
          eventWaiters.splice(i, 1)
          w.resolve()
        }
      }
    }
  }

  function finishAttempt(): void {
    if (!session) return
    // A lesson is not an attempt: no payout, no record, no achievement, no difficulty curve.
    // Its locks are teaching instruments and must never reach the roster's bookkeeping.
    if (lesson) {
      lesson.complete = true
      finishLesson()
      startOpenSequence(sequence, 0, 0)
      return
    }
    /**
     * An inspection ends the moment the lock opens and leaves nothing behind.
     *
     * Not even a "you did it" — the results screen is where a rank is reported, and there is no
     * rank to report. It goes straight back to the bench with a line saying what it was.
     */
    if (inspecting) {
      status = `${session.def.name} — inspected. Nothing recorded.`
      session = null
      goto('bench')
      return
    }
    const base = outcomeFrom(session.def, session.state, session.state.stats, { challenges })
    const met = progress.challengesMetBy(base, challenges)
    outcome = { ...base, challenges: met }
    result = progress.completeAttempt(outcome, today())
    progress.noteChallenges(session.def.slug, met)
    // Achievements are claimed *after* the record is written: half of them are about totals,
    // and a total that does not yet count the open you just made is the wrong total.
    earnedThisAttempt = progress.claimAchievements(outcome)
    startOpenSequence(sequence, result?.rank ?? 6, earnedThisAttempt.length)
  }

  /** Any key or a click skips, once the sequence has run long enough to allow it. */
  function wantsSkip(keys: Set<string>, clicked: boolean): boolean {
    return clicked || keys.size > 0
  }

  /**
   * How far the pick tip is into the lock, for Hard mode's readout: the lift of the chamber it
   * is under. Zero when the pick is out — there is no depth to report.
   */
  function pickDepthMm(view: SimState): number {
    const c = view.pickChamber >= 0 ? view.chambers[view.pickChamber] : undefined
    return c ? c.keyLift : 0
  }

  function pickGapMm(view: SimState, inp: SimInput): number {
    const c = view.pickChamber >= 0 ? view.chambers[view.pickChamber] : undefined
    if (!c) return 0
    return Math.max(0, Math.min(inp.liftTarget, c.maxLift) - c.lift)
  }

  /**
   * Apply a frame's worth of keystrokes to the draft's name.
   *
   * Codes rather than characters, because that is what the input layer collects — `KeyA`, `Digit3`,
   * `Space`. It gives letters, digits, spaces and hyphens and nothing else: the name becomes a slug
   * and a filename-ish id, and every character not on this list is one that would be stripped back
   * out again by `slugFor`. Twenty-four is what fits the field at body size.
   */
  /**
   * Apply a frame's worth of keystrokes to the share-code box.
   *
   * A narrower alphabet than the name field, and it uppercases as it goes: a code is Crockford
   * base32 plus the grouping hyphens, so letters, digits and `-` are the whole of it. Anything else
   * `decodeLock` would reject with "that is not a character a code can contain", and rejecting it at
   * the keystroke is kinder than rejecting it at the button.
   *
   * 45 characters is the longest a code gets — sixteen chambers, grouped in fours.
   */
  function typeIntoCode(keys: ReadonlySet<string>): void {
    for (const code of keys) {
      if (code === 'Escape') {
        codeFocus = false
        return
      }
      if (code === 'Enter' || code === 'NumpadEnter') {
        actions.codeSubmit()
        return
      }
      if (code === 'Backspace') {
        codeEntry = codeEntry.slice(0, -1)
      } else if (code.startsWith('Key') && code.length === 4) {
        codeEntry += code.slice(3).toUpperCase()
      } else if (code.startsWith('Digit') && code.length === 6) {
        codeEntry += code.slice(5)
      } else if (code === 'Minus' || code === 'NumpadSubtract') {
        codeEntry += '-'
      }
    }
    codeEntry = codeEntry.slice(0, 45)
  }

  function typeIntoName(keys: ReadonlySet<string>): void {
    let name = draft.name
    for (const code of keys) {
      if (code === 'Enter' || code === 'Escape') {
        editingName = false
        return
      }
      if (code === 'Backspace') {
        name = name.slice(0, -1)
      } else if (code.startsWith('Key') && code.length === 4) {
        name += code.slice(3).toLowerCase()
      } else if (code.startsWith('Digit') && code.length === 6) {
        name += code.slice(5)
      } else if (code === 'Space') {
        name += ' '
      } else if (code === 'Minus') {
        name += '-'
      }
    }
    if (name !== draft.name) draft = { ...draft, name: name.slice(0, 24) }
  }

  function frame(seconds: number): void {
    syncViewport(vp)
    const keys = input.takeKeys()
    const clicked = input.takeClick()
    const pointer = input.pointer
    const uiFrame: UiFrame = {
      pointerX: pointer.x,
      pointerY: pointer.y,
      clicked,
      keys,
    }

    // Typing a lock's name. Safe to consume keys wholesale here because picking is the keyboard's
    // job on exactly one screen and this is not it (D-059) — there is nothing to collide with.
    if (screen === 'editor' && editingName) typeIntoName(keys)
    if (screen === 'codes' && codeFocus) typeIntoCode(keys)

    /**
     * Swipe across to turn a page — DECISIONS D-131.
     *
     * The `‹ ›` arrows are 40 logical px tall, which is fourteen real ones, and on the trophy case
     * they are the *only* way to reach pages two through four. The floor in D-131 makes them
     * hittable; this makes them unnecessary, because a swipe is what a player tries first on a
     * paged screen and the arrows are then the discoverable fallback rather than the mechanism.
     *
     * Read once, here, and dispatched by screen: a swipe means nothing on the bench or the menu,
     * and a gesture that silently did something on a screen with no pages would be worse than one
     * that does nothing. Swiping left goes forward, as it does in every gallery.
     */
    const swipe = input.takeSwipe()
    if (swipe !== 0) {
      if (screen === 'trophies') actions.trophyPageBy(-swipe)
      else if (screen === 'codes') actions.codesPageBy(-swipe)
      else if (screen === 'help') actions.helpPage(helpPage - swipe)
    }

    /**
     * The "← bench" link in the pick HUD's header (D-096).
     *
     * Hit-tested here rather than in `hud.ts` because the HUD is a *drawing* — it has no `Ui` and
     * no widget state, and giving it one to serve a single link would put interaction state in the
     * render layer. The rectangle is exported from the HUD so there is still exactly one definition
     * of where the link is.
     */
    overBenchLink =
      screen === 'pick' &&
      pointInRect(
        grown(BENCH_LINK, input.touch.active ? touchFloorFor(vp) : 0),
        pointer.x,
        pointer.y,
      )
    if (overBenchLink && clicked) {
      const wasLesson = lesson !== null
      lesson = null
      session = null
      goto(wasLesson ? 'tutorial' : 'bench')
    }

    if (screen === 'results') resultsAge += seconds
    tickKeyboard(seconds)
    const inp = currentInput()
    if (screen === 'pick' && session) {
      // Once the lock is open the simulation is done; the sequence owns the screen until it
      // settles, and only then does the player land on the results page.
      if (!session.state.opened) absorb(session.advance(seconds, inp))
      updateFx(fx, seconds)
      audio.update(session.state, Math.max(seconds, 1 / 240))
      const view = session.syncView()
      if (progress.data.settings.subtitles) {
        let counter = 0
        for (const c of view.chambers) if (c.counterForce > counter) counter = c.counterForce
        updateSubtitles(subtitles, seconds, counter, view.thetaVelocity)
      }
      if (lesson) updateLesson(lesson, view, seconds)
      layout = computeLayout(view.chambers.length, view.theta, session.def.rows ?? 1, mirrored())
      if (face) face = computeFaceLayout(view.chambers.length, face.kind, view.theta)
      if (sequence.running) {
        const ticks = updateOpenSequence(sequence, seconds)
        for (let i = 0; i < ticks; i += 1) audio.creditTick(i)
        if (canSkip(sequence) && wantsSkip(keys, clicked)) skipOpenSequence(sequence)
      }
      // A lesson has no results page to land on — it goes back to the tutorial, where the
      // card it just finished says `done` and the next one is marked `next` (D-152).
      if (view.opened && isSettled(sequence)) goto(outcome ? 'results' : 'tutorial')
    } else {
      updateFx(fx, seconds)
    }

    render(uiFrame, inp)
    hook.framesRendered += 1
    hook.ready = true
  }

  function render(uiFrame: UiFrame, inp: SimInput): void {
    const { ctx } = vp
    beginFrame(vp, palette.letterbox)

    /**
     * A portrait phone letterboxes the stage down to an unusable strip, so it gets one honest
     * screen instead of a technically-rendered one (D-082) — on the *first* frame, not once the
     * player has managed to hit something on the smear, and **before the stage clip**, so the
     * message owns the whole device rather than the same useless 219px band it is warning about
     * (D-110).
     */
    if ((input.touch.active || isCoarsePointer()) && isPortrait(vp)) {
      drawRotatePrompt(vp, palette)
      return
    }

    ctx.save()
    clipToStage(ctx)
    ctx.fillStyle = palette.paper
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT)
    drawGrid(vp, 40, palette.rule, LOGICAL_WIDTH, LOGICAL_HEIGHT)

    // A fingertip gets the touch floor; a cursor gets exact hit-testing (D-131).
    ui.begin(uiFrame, input.touch.active ? touchFloorFor(vp) : 0)
    const shell: ShellContext = {
      vp,
      p: palette,
      ui,
      progress,
      actions,
      ...(outcome ? { outcome } : {}),
      ...(result !== undefined ? { result } : {}),
      ...(status ? { status } : {}),
      challenges,
      inspectNext,
      draft,
      editingName,
      codeEntry,
      codeFocus,
      codesPage,
      rosterPage,
      trophyPage,
      armedDelete,
      helpPage,
      hapticsSupported: haptics.isSupported,
      // With reduced motion the stamp is simply already down — a large age reads as settled.
      resultsAge: fx.reducedMotion ? 9 : resultsAge,
      // Mid-attempt only: an opened lock's session lingers for the results screen, and "back to
      // the lock" on a lock that is already open would be a door to a finished room.
      pickActive: session !== null && !session.state.opened,
      ...(benchTier !== undefined ? { benchTier } : {}),
    }

    switch (screen) {
      case 'menu':
        drawMenu(shell)
        break
      case 'bench':
        drawBench(shell)
        break
      case 'tutorial':
        drawTutorial(shell)
        break
      case 'results':
        drawResults(shell)
        break
      case 'settings':
        drawSettings(shell)
        break
      case 'trophies':
        drawTrophies(shell)
        break
      case 'codes':
        drawCodes(shell)
        break
      case 'help':
        drawHelp(shell)
        break
      case 'editor':
        drawEditor(shell)
        break
      case 'pick':
      case 'pause':
        renderPick(inp)
        if (screen === 'pause') drawPause(shell)
        break
    }
    ui.end()
    ctx.restore()
  }

  function renderPick(inp: SimInput): void {
    if (!session) return
    const { ctx } = vp
    const view = session.view
    currentDrift = cameraDrift(view, THETA_OPEN, fx.reducedMotion)
    currentFlex = pickFlex(view.resistance, pickGapMm(view, inp))
    const shake = shakeOffset(fx)
    // Beat 2's impact rides the same translate the shake does, so it jolts the drawing rather
    // than the HUD — the chrome should stay put while the lock lurches.
    const jolt = impactJolt(sequence)

    const assist = progress.data.settings.assist
    /**
     * The four levels, as a ladder of what the drawing is allowed to show (D-046).
     *
     * `training` gets the real cutaway. `easy` gets one pin — the one under the tip — drawn
     * plain so its type stays hidden. `medium` and `hard` get no pins at all; what separates
     * them is whether you can see your own hand.
     */
    const felt =
      assist === 'training'
        ? undefined
        : { active: assist === 'easy' ? view.pickChamber : -1 }
    const showPick = assist !== 'hard'

    ctx.save()
    ctx.translate(currentDrift + shake.x, shake.y + jolt)
    if (face) {
      drawFaceOn(vp, palette, view, face, {
        activeChamber: view.pickChamber,
        showTargets: assist === 'training',
        fx,
        chamberNoun: session.def.family === 'radial-slider' ? 'slider' : 'pin',
      })
      drawFaceTool(vp, palette, face, view, inp)
    } else {
      drawCutaway(vp, palette, view, layout, {
        activeChamber: view.pickChamber,
        showTargets: assist === 'training',
        fx,
        touchActive: input.touch.active,
        ...(felt ? { felt } : {}),
      })
      // The pick is drawn where the *hand* is, sliding along the keyway, rather than snapped
      // to the chamber the simulation quantised it to. Scripted input has no hand, so it
      // falls back to the chamber centre.
      // No hand to follow when a script or the keyboard is driving — the keyboard selects a
      // chamber outright, so the pick belongs at that chamber's centre.
      const render = pickRender(view, layout, currentFlex, inp.liftTarget)
      if (showPick) {
        drawPickTarget(vp, palette, layout, view.pickChamber, inp.liftTarget, render.tipX)
        drawPick(vp, palette, layout, render)
      }
    }
    ctx.restore()

    drawHud(vp, palette, view, {
      lockName: session.def.name,
      elapsed: view.time,
      inspecting,
      lesson: lesson !== null,
      // The face locks draw a dial, not the side cutaway, and their gutter is never crowded.
      ...(face ? {} : { assemblyLeft: assemblyBounds(layout).x }),
      // The payoff owns the rank band from the moment the lock opens (D-100).
      payoff: sequence.running,
      // The meter is on at every level: it is the substitute for touch, and the higher levels
      // take away the picture precisely so that the meter is what you read instead. What the
      // ladder changes is whether the meter *interprets* itself for you (D-054).
      showResistance: true,
      // Training and Easy get the word; Medium and Hard get the number only — and on both it now
      // stays silent until you are actually leaning on the pin (D-076).
      showStateWord: assist === 'training' || assist === 'easy',
      showBinding: assist === 'training',
      /**
       * Easy keeps a bare set/not-set count, because how many pins you have done is something a
       * real picker remembers rather than something the lock tells them — and with the pins drawn
       * only under the tip, taking the dots away too meant the *default* level had no progress
       * indicator of any kind. That was never asked for. Medium and Hard have none by design.
       */
      pinDots:
        assist === 'training' ? 'full' : assist === 'easy' ? 'progress' : 'none',
      depthMm: assist === 'hard' ? pickDepthMm(view) : null,
      /**
       * Carrying the hook high is a real control now, so the legend has to say so — D-139.
       *
       * The arrows drop the pick, which is the safe default and has been since D-051. Holding the
       * lift *while* moving drags the hook along the keyway at working height, and it shoves aside
       * whatever it passes (D-138). A control the player cannot discover is the same as no control,
       * and this one is invisible: it is the absence of a thing the game has always done for you.
       */
      keys: input.touch.active
        ? ([
            ['tap', 'a pin'],
            ['drag up', 'to lift'],
            ['drag ↔', 'carry it'],
            ['slider', 'tension'],
          ] as const)
        : ([
            ['← →', 'move'],
            ['space', 'lift'],
            ['space+← →', 'carry it'],
            /**
             * The trim is Training only (D-111), so the legend only claims it on Training.
             *
             * "nudge" named the *action* and not what it acts on, and a player asked outright what
             * it was. Space lifts continuously; these step the target a hair at a time (D-101).
             *
             * Dropping the row rather than greying it is the same rule that deleted `tab tools`
             * when the loadout went: a key legend advertising a key that does nothing is worse
             * than a shorter legend, and D-105 is what that costs when nobody notices.
             */
            ...(assist === 'training'
              ? ([['↑ ↓', 'fine lift']] as const)
              : ([] as const)),
            ['Q', 'tension wrench'],
            // `1-0` alone did not say that `0` is the tenth step, or that there are ten (D-103) —
            // and naming the step still did not name the *control* it belongs to (D-107).
            // "…, 1 to 10" as well, until the legend became a column in the left gutter: at 24
            // characters that row reached x=480 and the lock starts at x=384 on anything with six
            // chambers. The cap says `1-0` and the footer heading says "pressure N of 10", so the
            // range is stated twice already (D-115).
            ['1-0', 'wrench pressure'],
            ['R', 'restart'],
            ['esc', 'pause'],
          ] as const),
      // The gutters belong to the pads while a finger is down, whatever the layout (D-160).
      touchActive: input.touch.active,
      benchHot: overBenchLink,
      // Short enough to sit between the strain meter and the plug bar at the larger face (D-102).
      restartHint: input.touch.active ? 'tap pause, then restart' : 'press [R] for a fresh pick',
      /**
       * Names the control the player actually has. On touch the wrench *is* the slider, so there
       * is no key to name and telling them to hold one would be a lie (D-107).
       *
       * Both kept to about the length of the caption they replace. That row already has three
       * tenants — this one, the broken-pick hint at x=606 and the plug's caption at x=1000 — and a
       * broken pick with the wrench released is a perfectly ordinary state to be in, so "it only
       * shows when the wrench is off" does not make the row any less crowded (D-101).
       */
      tensionHint: input.touch.active
        ? // Which edge depends on the hand the lock is held in (D-130), and "drag" rather than
          // "slide to" because the wrench moves from where it is now, not to where you touched.
          `drag the wrench up the ${mirrored() ? 'right' : 'left'} edge`
        : 'hold [Q] to turn the wrench',
      // Teach the grip that makes this playable one-handed-per-control, until it has happened.
      ...(session && pickedButUnturned(session.state)
        ? { heldHint: 'every pin is up — turn harder' }
        : input.touch.active && !input.usedBothThumbs
          ? { heldHint: 'keep that thumb there — lift with the other' }
          : {}),
      par: session.def.par,
      mirrored: mirrored(),
      pressureStep: input.wrenchStep,
      // `STRAIN_BENT` is 1, so the raw figure is already the 0..1 the bar wants.
      strain: { amount: view.pickStrain, bent: view.pickBent, broken: view.pickBroken },
    })

    drawTouchControls(vp, palette, input.touch, {
      tensionHeld: view.tension >= T_MIN_HOLD,
      mirrored: mirrored(),
    })

    if (progress.data.settings.subtitles) drawSubtitles(vp, palette, subtitles)
    if (lesson) {
      drawLessonLine(vp, palette, {
        line: currentLine(lesson),
        step: lesson.step,
        total: lesson.lesson.steps.length,
      })
    }

    if (view.opened) {
      const centre = face
        ? { x: face.cx, y: face.cy }
        : { x: LOGICAL_WIDTH / 2, y: mmToY(layout, 0) }
      drawOpenSequence(vp, palette, sequence, earnedThisAttempt, centre)
      // Not on touch: a tap skips and needs no advertisement, and at the compact face the hint
      // printed across the header's own furniture (D-157).
      if (canSkip(sequence) && !sequence.skipped && !input.touch.active && !isCompact(vp)) {
        // Tucked under the header, where the drawing never reaches — a hint, not an element.
        text(vp.ctx, 'any key to skip', LOGICAL_WIDTH - 60, 116, {
          font: font(typeFor(vp, TYPE.dimension)),
          color: palette.inkLight,
          align: 'right',
        })
      }
    }
  }

  const loop: Loop = startLoop(frame)

  function loadLock(key: number | string, seed = 1): void {
    const def = findLock(key)
    if (!def) throw new Error(`Unknown lock "${String(key)}"`)
    startLock(def, seed)
  }

  // ── Test hook (VERIFICATION.md §3) ────────────────────────────────────────────────────
  hook.loadLock = loadLock
  hook.setInput = (patch: Partial<SimInput> | null): void => {
    scriptedInput = patch
      ? {
          chamber: -1,
          liftTarget: 0,
          tensionHeld: false,
          tensionLevel: 0,
          ...patch,
        }
      : null
  }
  hook.getInput = (): SimInput => currentInput()
  hook.setManual = (manual: boolean): void => {
    loop.setManual(manual)
  }
  hook.stepTicks = (n: number): void => {
    if (!session) return
    const inp = currentInput()
    for (let i = 0; i < n; i += 1) {
      absorb(session.advance(1 / 120, inp))
      updateFx(fx, 1 / 120)
      // Everything else that runs per frame runs here too. A harness that advanced only the
      // simulation would report a tutorial that never noticed the player doing anything.
      if (lesson) updateLesson(lesson, session.state, 1 / 120)
      if (progress.data.settings.subtitles) {
        let counter = 0
        for (const c of session.state.chambers) {
          if (c.counterForce > counter) counter = c.counterForce
        }
        updateSubtitles(subtitles, 1 / 120, counter, session.state.thetaVelocity)
      }
    }
    const view = session.syncView(1)
    layout = computeLayout(view.chambers.length, view.theta, session.def.rows ?? 1, mirrored())
    if (face) face = computeFaceLayout(view.chambers.length, face.kind, view.theta)
    currentDrift = cameraDrift(view, THETA_OPEN, fx.reducedMotion)
    currentFlex = pickFlex(view.resistance, pickGapMm(view, inp))
  }
  hook.renderOnce = (): void => {
    frame(0)
  }
  /**
   * Draw one frame with the probe on, and report what the layout rules make of it (D-132).
   *
   * The rects come from the widget layer's own registry rather than from a second list kept in
   * step by hand — the whole point is that this cannot drift from what was actually drawn. The
   * touch pads are added because they are hit-tested outside the `Ui` and would otherwise be the
   * one part of the screen the audit could not see.
   */
  hook.auditScreen = (): { findings: Finding[]; drawn: number; scale: number } => {
    startRecording()
    frame(0)
    const drawn = stopRecording()
    const rects: Box[] = [...ui.registeredRects()]
    if (input.touch.active && screen === 'pick') {
      const flip = mirrored()
      for (const r of [WRENCH_SLIDER, PAUSE_PAD, WITHDRAW_PAD, LIFT_PAD]) {
        rects.push(mirrorRect(r, flip))
      }
    }
        /*
     * The lock's bounds, **on a phone**, on the one screen that has a lock.
     *
     * Not on a full page, because there the anatomy key deliberately writes SHELL, PLUG and KEYWAY
     * across the metal to name it (D-050) — that is the drawing doing its job. It is already
     * dropped on a phone (D-122), which is exactly where scaled chrome starts intruding, so the
     * rule and the exception happen to have the same boundary. Scoping it this way is honest;
     * carrying a list of allowed strings would not be.
     */
    const lock = isCompact(vp) && screen === 'pick' && session ? assemblyBounds(layout) : null
    return {
      findings: auditLayout(drawn, vp.scale, rects, lock),
      drawn: drawn.length,
      scale: vp.scale,
    }
  }
  hook.advanceSeconds = (seconds: number): void => {
    const step = 1 / 60
    let left = Math.max(0, seconds)
    let guard = 0
    while (left > 1e-9 && guard < 10_000) {
      const dt = Math.min(step, left)
      frame(dt)
      left -= dt
      guard += 1
    }
  }
  hook.getState = (): HookState => snapshot()
  hook.getGeometry = (): HookGeometry => geometry()
  /**
   * Where a chamber and a lift would appear on screen, in client coordinates.
   *
   * No longer somewhere to *click* — the mouse does not pick (D-059). It is kept because the
   * screenshot and geometry tests use it to ask "where is chamber 3 at 1.4mm", which is a
   * question about the drawing rather than about input.
   */
  hook.pointerFor = (chamber: number, liftMm: number): { x: number; y: number } => {
    // A face-on lock has no "along the keyway" to point at, so the tool tip's own geometry
    // answers the question instead — the same function the renderer draws it with, which is
    // what keeps the harness honest about where the player would actually have to click.
    const tip = face
      ? toolTip(face, session?.view.chambers[chamber], liftMm)
      : {
          x: plugChamberX(layout, chamber),
          y: mmToY(layout, KEYWAY_FLOOR) - liftMm * LIFT_PX_PER_MM,
        }
    const logicalX = tip.x
    const logicalY = tip.y
    const rect = canvas.getBoundingClientRect()
    return {
      x: rect.left + vp.offsetX + logicalX * vp.scale,
      y: rect.top + vp.offsetY + logicalY * vp.scale,
    }
  }
  hook.openSequence = (): HookOpenSequence => {
    let cardsVisible = 0
    for (let i = 0; i < earnedThisAttempt.length; i += 1) {
      if (cardVisible(sequence, i)) cardsVisible += 1
    }
    return {
      running: sequence.running,
      skipped: sequence.skipped,
      elapsed: sequence.elapsed,
      duration: sequenceSeconds(sequence),
      beat: currentBeat(sequence),
      canSkip: canSkip(sequence),
      settled: isSettled(sequence),
      creditsShown: rankReveal(sequence),
      credits: sequence.rank,
      cardCount: sequence.cardCount,
      cardsVisible,
      reducedMotion: sequence.reducedMotion,
    }
  }
  hook.skipOpenSequence = (): boolean => skipOpenSequence(sequence)
  hook.earnedThisAttempt = (): string[] => earnedThisAttempt.map((a) => a.id)
  hook.achievementIds = (): string[] => ACHIEVEMENTS.map((a) => a.id)
  hook.startLesson = (id: string): void => {
    startLesson(id)
  }
  hook.lessonState = (): HookLesson | null =>
    lesson
      ? {
          id: lesson.lesson.id,
          line: currentLine(lesson),
          step: lesson.step,
          total: lesson.lesson.steps.length,
          complete: lesson.complete,
        }
      : null
  hook.subtitles = (): string[] => subtitles.captions.map((c) => c.text)
  hook.focusState = (): { index: number; count: number; keyboardMode: boolean } => ({
    index: ui.focus,
    count: ui.widgetCount,
    keyboardMode: ui.keyboardMode,
  })
  hook.getTouch = (): boolean => input.touch.active
  // The wrench, as the game actually has it and as the footer prints it — the two disagreed on
  // every phone until D-131, and nothing could see it because nothing exposed either one.
  hook.fontStack = (): string => FONT_STACK
  hook.getWrench = (): { step: number; tension: number; printedStep: number } => ({
    step: input.touch.step,
    tension: input.effectiveTension,
    printedStep: input.wrenchStep,
  })
  hook.events = (): SimEvent[] => eventLog.slice()
  hook.waitForEvent = async (type: string, timeoutMs = 15_000): Promise<void> => {
    if (eventLog.some((e) => e.type === type)) return
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timed out waiting for ${type}`))
      }, timeoutMs)
      eventWaiters.push({
        type,
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
      })
    })
  }
  hook.frameStats = (): HookFrameStats => ({
    frames: loop.stats.frames,
    last: loop.stats.last,
    history: loop.stats.history.slice(),
    work: loop.stats.work.slice(),
  })
  hook.getFx = (): HookFx => ({
    shake: fx.shake,
    reducedMotion: fx.reducedMotion,
    cameraDrift: currentDrift,
    pickFlex: currentFlex,
    chambers: fx.chambers.map((c, i) => ({
      flash: c.flash,
      jolt: c.jolt,
      drop: c.drop,
      falseSet: c.falseSet,
      offsetY: chamberOffsetY(fx, i),
    })),
    fills: (session?.state.chambers ?? []).map((c) => driverFill(palette, c, fx)),
  })
  hook.setReducedMotion = (reduced: boolean): void => {
    fx.reducedMotion = reduced
    if (reduced) clearFx(fx)
  }
  hook.setTools = (patch: Partial<ToolStats> | null): void => {
    toolOverride = patch
    config = makeConfig({ ...config, tools: patch ? withTools(STARTER_TOOLS, patch) : STARTER_TOOLS })
    if (session) startLock(session.def, session.seed)
  }
  hook.setFeathering = (enabled: boolean): void => {
    featherOverride = enabled
    if (session) startLock(session.def, session.seed)
  }
  hook.audioState = (): HookAudio => ({
    contextState: audio.contextState,
    ready: audio.ready,
    activeVoices: audio.activeVoices,
    scheduled: audio.stats.scheduled,
    stolen: audio.stats.stolen,
    muted: audio.settings.muted,
  })
  hook.unlockAudio = async (): Promise<void> => {
    await audio.unlock()
  }
  hook.setMuted = (muted: boolean): void => {
    audio.setMuted(muted)
  }
  hook.audioBurst = (count: number): void => {
    if (!session) return
    const n = session.state.chambers.length
    const burst: SimEvent[] = []
    for (let i = 0; i < count; i += 1) {
      burst.push({
        type: 'PIN_SET',
        chamber: i % Math.max(1, n),
        tension: 0.5,
        time: session.state.time,
      })
    }
    audio.handleEvents(burst, session.state)
  }
  hook.getScreen = (): string => screen
  hook.goto = (name: string): void => {
    goto(name as ScreenName)
  }
  hook.layoutState = (): { compact: boolean; interfaceMode: string; scale: number } => ({
    compact: isCompact(vp),
    interfaceMode: vp.interfaceMode,
    scale: vp.scale,
  })
  hook.getSave = (): SaveData => JSON.parse(JSON.stringify(progress.data)) as SaveData
  hook.setSave = (data: SaveData): void => {
    progress.data = data
    writeSave(storage, data)
    applySettings()
  }
  hook.exportSaveText = (): string => exportSave(progress.data)
  hook.importSaveText = (textToImport: string): void => {
    progress.data = importSave(textToImport)
    writeSave(storage, progress.data)
    applySettings()
  }
  hook.clickAt = (x: number, y: number): void => {
    // Drive a UI click in logical coordinates, without needing the real pointer.
    const uiFrame: UiFrame = { pointerX: x, pointerY: y, clicked: true, keys: new Set<string>() }
    render(uiFrame, currentInput())
  }
  hook.editorAction = (name, value): void => {
    switch (name) {
      case 'chambers':
        actions.editorChamberCount(value ?? 5)
        break
      case 'depth':
        actions.editorDepth(0, value ?? 3)
        break
      case 'pin':
        // `value` is how many times to advance, so a test can name a profile by its position.
        for (let i = 0; i < (value ?? 1); i += 1) actions.editorCyclePin(0)
        break
      case 'spring':
        for (let i = 0; i < (value ?? 1); i += 1) actions.editorCycleSpring(0)
        break
      case 'test':
        actions.editorTest()
        break
      case 'save':
        actions.editorSave()
        break
      case 'reset':
        actions.editorReset()
        break
    }
  }
  hook.lockCount = (): number => ALL_LOCKS.length
  hook.lockSlugs = (): string[] => ALL_LOCKS.map((d) => d.slug)
  hook.pickTip = (): { x: number; y: number; chamber: number } => {
    if (!session) return { x: 0, y: 0, chamber: -1 }
    const r = pickRender(session.view, layout, currentFlex, currentInput().liftTarget)
    return { x: r.tipX, y: mmToY(layout, r.tipMm), chamber: r.chamber }
  }
  hook.getToolStats = (): ToolStats => currentConfig().tools
  hook.getChallenges = (): string[] => [...challenges]
  hook.toggleChallenge = (id: string): void => {
    actions.toggleChallenge(id)
  }

  function snapshot(): HookState {
    const s = session?.state
    if (!s || !session) {
      return {
        lock: { id: 0, slug: '', name: '', chamberCount: 0 },
        seed: 0,
        ticks: 0,
        time: 0,
        tension: 0,
        theta: 0,
        thetaMax: 0,
        thetaDemand: 0,
        opened: false,
        bindingChamber: -1,
        sidebarDropped: true,
        pickChamber: -1,
        pickPosition: -1,
        resistance: 0,
        pickForce: 0,
        pickStrain: 0,
        pickBent: false,
        pickBroken: false,
        ledgeOffset: 0,
        chambers: [],
        stats: {
          setOrder: [],
          bindOrder: [],
          oversets: 0,
          fullResets: 0,
          falseSetsEntered: 0,
          maxCounterForce: 0,
        maxResistance: 0,
          maxTension: 0,
          minTensionWhileHeld: 1,
        },
      }
    }
    return {
      lock: {
        id: session.def.id,
        slug: session.def.slug,
        name: session.def.name,
        chamberCount: s.chambers.length,
      },
      seed: session.seed,
      ticks: s.ticks,
      time: s.time,
      tension: s.tension,
      theta: s.theta,
      thetaMax: s.thetaMax,
      thetaDemand: s.thetaDemand,
      opened: s.opened,
      bindingChamber: s.bindingChamber,
      sidebarDropped: s.sidebarDropped,
      pickChamber: s.pickChamber,
      pickPosition: s.pickPosition,
      resistance: s.resistance,
      pickForce: s.pickForce,
      pickStrain: s.pickStrain,
      pickBent: s.pickBent,
      pickBroken: s.pickBroken,
      ledgeOffset: layout.ledgeOffset,
      chambers: s.chambers.map((c) => ({
        index: c.index,
        state: c.state,
        geometry: c.geometry,
        lift: c.lift,
        keyLift: c.keyLift,
        setLift: c.setLift,
        captureWindow: c.captureWindow,
        delta: c.delta,
        maxLift: c.maxLift,
        keyPinLength: c.keyPinLength,
        counterForce: c.counterForce,
        profile: c.profile.name,
        falseSetLifts: falseSetLifts(c),
        kind: c.kind,
        falseGates: c.falseGates.slice(),
        sidebarGate: c.sidebarGate,
        sidebarWidth: c.sidebarWidth,
        sidebarAligned: c.sidebarAligned,
      })),
      stats: {
        setOrder: s.stats.setOrder.slice(),
        bindOrder: s.stats.bindOrder.slice(),
        oversets: s.stats.oversets,
        fullResets: s.stats.fullResets,
        falseSetsEntered: s.stats.falseSetsEntered,
        maxCounterForce: s.stats.maxCounterForce,
        maxResistance: s.stats.maxResistance,
        maxTension: s.stats.maxTension,
        minTensionWhileHeld: s.stats.minTensionWhileHeld,
      },
    }
  }

  function geometry(): HookGeometry {
    const chambers = session?.state.chambers ?? []
    return {
      layout: {
        shearY: layout.shearY,
        mmToPx: layout.mmToPx,
        left: layout.left,
        right: layout.right,
        pitch: layout.pitch,
        driverWidth: layout.driverWidth,
        keyPinWidth: layout.keyPinWidth,
        ledgeOffset: layout.ledgeOffset,
        theta: layout.theta,
      },
      chambers: chambers.map((c) => ({
        index: c.index,
        shellX: shellChamberX(layout, c.index),
        plugX: plugChamberX(layout, c.index),
        keyPin: keyPinRect(layout, c),
        driver: driverPinRect(layout, c),
        lift: c.lift,
        keyLift: c.keyLift,
        setLift: c.setLift,
        keyPinLength: c.keyPinLength,
      })),
    }
  }

  /**
   * Re-fit the canvas whenever its box changes — DECISIONS D-129.
   *
   * A `resize` listener alone is not enough on a phone. Rotating fires `resize` and
   * `orientationchange` *before* the browser has finished re-laying-out, so the handler measures
   * the old box, and nothing fires again once the new one settles: the stage stays letterboxed to
   * the previous orientation and the game sits in a strip of the screen. Reported as *"when you
   * rotate the device the interface is not on the whole screen"*.
   *
   * A `ResizeObserver` on the canvas is the signal that actually means "your box changed", and it
   * fires again when the layout settles. It also covers the two other mobile cases a resize event
   * handles badly: the address bar sliding away mid-drag, and the on-screen keyboard.
   *
   * The window listener stays as a belt-and-braces fallback for `devicePixelRatio` changes, which
   * do not change the element's box and so do not trip the observer — dragging a window between a
   * retina and a non-retina monitor.
   */
  const refit = (): void => {
    syncViewport(vp)
  }
  const boxObserver =
    typeof ResizeObserver === 'function' ? new ResizeObserver(refit) : null
  boxObserver?.observe(canvas)
  window.addEventListener('resize', refit)
  window.addEventListener('orientationchange', refit)

  return {
    hook,
    audio,
    progress,
    loadLock,
    destroy(): void {
      loop.stop()
      input.dispose()
      boxObserver?.disconnect()
      window.removeEventListener('resize', refit)
      window.removeEventListener('orientationchange', refit)
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
      void audio.dispose()
    },
  }
}

/** Offer the save as a download. Returns a status line for the settings screen. */
function downloadSave(data: SaveData): string {
  try {
    const blob = new Blob([exportSave(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'shear-line-save.json'
    a.click()
    URL.revokeObjectURL(url)
    return 'save exported'
  } catch (err) {
    return `export failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

/** Ask for a JSON file. Resolves to null if the player cancels. */
async function pickSaveFile(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = 'application/json,.json'
    el.addEventListener('change', () => {
      const file = el.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      void file.text().then(resolve, () => {
        resolve(null)
      })
    })
    el.click()
  })
}
