/**
 * The lessons — `GAME_DESIGN.md §10`, extended past the original three.
 *
 * The design rule there is unusually strict and worth restating, because it decides the whole
 * shape of this file: *"Teach through play with a single line of text at a time. No walls of
 * tutorial prose, no modal dialogs the player clicks past. If a lesson can't be taught by
 * designing the lock so the player discovers it, cut the lesson."*
 *
 * So a lesson is **a lock plus a list of steps**, and a step is **a line of text plus a
 * predicate that says when the player has done it**. Nothing here blocks input, nothing waits
 * for a click, and nothing can be dismissed — because there is nothing to dismiss. The line at
 * the bottom of the screen changes when the player's own actions change it, and the lesson
 * ends when they open the lock.
 *
 * The locks are purpose-built and live here rather than in the roster: they are teaching
 * instruments, not content, and they must not appear on the bench, in the difficulty curve or
 * in *Master of the Bench*.
 */

import type { LockDef, SimState } from '../sim'
import { T_MIN_HOLD } from '../sim'

export interface LessonStep {
  readonly id: string
  /** The one line shown while this step is the current one. */
  readonly line: string
  /** True once the player has done the thing. Read every frame off live state. */
  readonly done: (s: SimState) => boolean
  /**
   * A second line, shown only while the player is visibly stuck on this step — after
   * `hintAfter` seconds. Still one line at a time; it replaces, it does not stack.
   */
  readonly hint?: string
  readonly hintAfter?: number
}

export interface Lesson {
  readonly id: string
  readonly title: string
  /** What this lesson exists to teach, in the player's words. Shown on the bench card. */
  readonly teaches: string
  readonly lock: LockDef
  readonly steps: readonly LessonStep[]
}

// ── The teaching locks ──────────────────────────────────────────────────────────────────

/**
 * The first lock: **one pin**, the loosest tolerance in the game.
 *
 * The course used to open on the two-pin tension-and-lift lock, which teaches the hands before
 * it has taught the head: a player with zero knowledge does not yet know *what opening a lock
 * even is*. This lock exists to say the one sentence everything else depends on — the plug must
 * rotate, and a pin crossing the shear line is all that stops it. One pin, so the whole idea is
 * visible at once with nothing else moving.
 */
export const LESSON_TURN_LOCK: LockDef = {
  id: 904,
  slug: 'lesson-the-turn',
  name: 'Lesson 1 — The Turn',
  tier: 1,
  family: 'pin-tumbler',
  bitting: [3.4],
  pins: ['standard'],
  toleranceQuality: 1.5,
  keyway: 'standard',
  par: 45,
  note: 'One pin, in the open. The whole idea of lockpicking, visible at once.',
}

/**
 * The tension-and-lift lock: two standard pins, the most forgiving tolerance in the game.
 *
 * `toleranceQuality` 1.5 is looser than anything on the bench (the practice cutaway is 1.4),
 * because a first attempt should not be able to overset. Its window is 0.93mm, which the pick
 * crosses in about 90ms — twice `CAPTURE_TIME`, so simply holding still anywhere sensible
 * works.
 */
export const LESSON_TENSION_LOCK: LockDef = {
  id: 901,
  slug: 'lesson-tension-and-lift',
  name: 'Lesson 2 — Tension and Lift',
  tier: 1,
  family: 'pin-tumbler',
  bitting: [3.2, 4.0],
  pins: ['standard', 'standard'],
  toleranceQuality: 1.5,
  keyway: 'standard',
  par: 60,
  note: 'A transparent two-pin cutaway. Nothing in it can go wrong.',
}

/**
 * The overset lock: three pins and a window tight enough that an overset is likely.
 *
 * `GAME_DESIGN.md §10` asks this lesson to *deliberately induce* an overset — "failure as
 * instruction" — so the lock is built to punish the natural instinct of a player who has just
 * learned that lifting works, which is to lift further. 0.55 gives a 0.34mm window; the pick
 * crosses it in 33ms, less than `CAPTURE_TIME`, so overshooting genuinely jams it.
 */
export const LESSON_OVERSET_LOCK: LockDef = {
  id: 902,
  slug: 'lesson-overset-and-reset',
  name: 'Lesson 3 — Overset and Reset',
  tier: 1,
  family: 'pin-tumbler',
  bitting: [3.4, 2.9, 4.1],
  pins: ['standard', 'standard', 'standard'],
  toleranceQuality: 0.55,
  keyway: 'standard',
  par: 90,
  note: 'A tight one. You will jam it. That is the lesson.',
}

/**
 * The spool lock: three pins, one spool, dead centre.
 *
 * A single spool in the middle so the false set cannot be confused with anything else, and a
 * forgiving tolerance so the *only* difficulty in the lesson is the spool itself.
 */
export const LESSON_SPOOL_LOCK: LockDef = {
  id: 903,
  slug: 'lesson-the-spool',
  name: 'Lesson 4 — The Spool',
  tier: 1,
  family: 'pin-tumbler',
  bitting: [3.2, 3.0, 2.8],
  pins: ['standard', 'spool', 'standard'],
  toleranceQuality: 1.2,
  keyway: 'standard',
  par: 150,
  note: 'One spool, in the middle. Everything else is out of the way.',
}

export const TUTORIAL_LOCKS: readonly LockDef[] = [
  LESSON_TURN_LOCK,
  LESSON_TENSION_LOCK,
  LESSON_OVERSET_LOCK,
  LESSON_SPOOL_LOCK,
]

// ── Predicates ──────────────────────────────────────────────────────────────────────────

const holdingTension = (s: SimState): boolean => s.tension >= T_MIN_HOLD
const anySet = (s: SimState): boolean => s.chambers.some((c) => c.state === 'SET')
const allSet = (s: SimState): boolean => s.chambers.every((c) => c.state === 'SET')

// ── The lessons ─────────────────────────────────────────────────────────────────────────

export const LESSONS: readonly Lesson[] = [
  {
    /**
     * The lesson for a player with zero knowledge — asked for as *"more extended tutorial…
     * so any person with 0 knowledge can lockpick even real locks."*
     *
     * Everything the other lessons teach is technique; this one teaches the *premise*. The id
     * is `lesson-rotate` rather than `lesson-0` because what it teaches is that rotation is
     * the goal — the save file records ids, so the existing three keep theirs.
     */
    id: 'lesson-rotate',
    title: 'The turn',
    teaches: 'Why a lock opens at all: the plug must rotate, and one pin is all that stops it.',
    lock: LESSON_TURN_LOCK,
    steps: [
      {
        id: 'goal',
        line: 'The goal is rotation: a lock opens when its plug turns. Hold Q and turn it.',
        done: holdingTension,
        hint: 'Q is the tension wrench. Hold it — you are turning the plug the way a key would.',
        hintAfter: 6,
      },
      {
        id: 'blocked',
        line: 'It stopped. The pin is crossing the shear line — the seam the plug turns along.',
        done: (s) => holdingTension(s) && s.pickChamber >= 0 && s.pickChamber === s.bindingChamber,
        hint: 'Arrow keys move the pick. Go to the pin — it is carrying all your turning force.',
        hintAfter: 8,
      },
      {
        id: 'clear',
        line: 'Lift it with Space. When the cut between its halves meets the seam, nothing blocks.',
        done: anySet,
        hint: 'Slowly. The click is the plug edge catching under the driver — that pin is done.',
        hintAfter: 10,
      },
      {
        id: 'open',
        line: 'Nothing crosses the shear line now. Keep holding Q and the plug turns open.',
        done: (s) => s.opened,
      },
    ],
  },
  {
    id: 'lesson-1',
    title: 'Tension and lift',
    teaches: 'Apply tension, find the pin the lock is leaning on, lift it until it clicks.',
    lock: LESSON_TENSION_LOCK,
    steps: [
      {
        id: 'tension',
        line: 'Hold Q. That is the wrench, turning the plug.',
        done: holdingTension,
        hint: 'Q, and keep holding it. Nothing works without it. 1-0 set how hard.',
        hintAfter: 6,
      },
      {
        id: 'find',
        line: 'Left and right move along the keyway. One pin feels heavier — that is the one.',
        done: (s) => s.pickChamber >= 0 && s.pickChamber === s.bindingChamber,
        hint: 'Watch the resistance meter along the bottom as you move.',
        hintAfter: 8,
      },
      {
        id: 'lift',
        line: 'Lift it. Hold Space, and let go the moment something gives.',
        done: anySet,
        hint: 'Space lifts while you hold it. Go slowly — a pin must sit still for a moment to catch.',
        hintAfter: 10,
      },
      {
        id: 'again',
        line: 'One down. The lock has moved on to another pin — find it the same way.',
        // Ends when they have *arrived* at the new binding pin, not when the lock is open, so the
        // pressure step below lands while they are actually working it.
        done: (s) => anySet(s) && s.bindingChamber >= 0 && s.pickChamber === s.bindingChamber,
        hint: 'Release Space, arrow across, then hold Space again.',
        hintAfter: 8,
      },
      {
        /**
         * How hard to turn — the lesson the game did not have and now needs (D-098).
         *
         * Since a captured driver needs more tension while you are pushing on another chamber, the
         * wrench is no longer "on or off": too light and the pin you just set falls off its ledge
         * while you work the next one, and a player who is never told this experiences it as the
         * game randomly taking their progress away. It is taught here, one pin in, at the exact
         * moment it first applies — the first time there is anything to lose.
         *
         * It ends on `allSet` rather than on a tension reading, because the default pressure is
         * step 5 and a threshold predicate would be true the instant the step began: the line would
         * flash past unread. A player who is already turning hard enough gets told *why* they are
         * getting away with it, which is the thing worth knowing.
         */
        id: 'pressure',
        line: 'Keep the pressure up while you work it — too light and the pin you just set drops.',
        done: allSet,
        // Under 90 characters, which the lesson test enforces: a line has to *be* a line.
        hint: '1 to 0 are the pressure steps. 3 holds what you have caught; 1 and 2 will not.',
        hintAfter: 7,
      },
      {
        id: 'open',
        line: 'Every pin is up. Keep the tension on and let it turn.',
        done: (s) => s.opened,
      },
    ],
  },
  {
    id: 'lesson-2',
    title: 'Overset and reset',
    teaches: 'Lifting too far jams a pin. Letting the tension go is how you start again.',
    lock: LESSON_OVERSET_LOCK,
    steps: [
      {
        id: 'start',
        line: 'Same as before: tension on, find the heavy pin, lift.',
        done: (s) => anySet(s) || s.chambers.some((c) => c.state === 'OVERSET'),
      },
      {
        id: 'overset',
        line: 'This lock is tighter. Lift one too far and watch what happens.',
        done: (s) => s.chambers.some((c) => c.state === 'OVERSET') || s.stats.oversets > 0,
        hint: 'Push a pin well past where it wants to sit. It will jam — that is the point.',
        hintAfter: 12,
      },
      {
        id: 'stuck',
        line: 'That pin is jammed into the shell, and nothing you do with the pick will free it.',
        done: (s) => s.stats.fullResets > 0 || s.stats.feathers > 0,
        hint: 'Let go of Q. Everything drops, and you start again.',
        hintAfter: 5,
      },
      {
        id: 'recover',
        line: 'That is a reset. It costs you everything — so lift less, and stop sooner.',
        done: anySet,
      },
      {
        /**
         * The technique D-051 made necessary. A captured driver rests on a sliver of plug edge,
         * not behind a catch, so raising the pick while still under a pin you have already set
         * pushes it straight back off. The keyboard drops the pick on every arrow press (D-059) so
         * it cannot happen by accident any more — but holding Space *through* the move still does
         * it, so it is taught here, next to the other way to lose a pin.
         */
        id: 'travel',
        line: 'Let Space go before you move on, or you will shove a set pin back out.',
        done: allSet,
        hint: 'Release Space, then arrow across, then hold Space again. That order is the trick.',
        hintAfter: 10,
      },
      {
        id: 'open',
        line: 'All three. Turn it.',
        done: (s) => s.opened,
      },
    ],
  },
  {
    id: 'lesson-3',
    title: 'The spool',
    teaches: 'A security pin lies to you. Recognising the lie, and pushing through it.',
    lock: LESSON_SPOOL_LOCK,
    steps: [
      {
        id: 'start',
        line: 'One of these three is not a plain pin. Work them as usual and find out which.',
        done: (s) => s.stats.falseSetsEntered > 0,
      },
      {
        id: 'false-set',
        line: 'The plug just gave, and that pin feels set. It is not — that is a spool lying.',
        done: (s) => s.chambers.some((c) => c.hasFalseSet && c.state === 'SET'),
        hint: 'Ease the tension off — press 2 or 3 — and keep holding Space on that pin.',
        hintAfter: 8,
      },
      {
        id: 'through',
        line: 'You pushed it through its waist. Heavy tension makes that wall unclimbable.',
        done: allSet,
      },
      {
        id: 'open',
        line: 'Every real lock past here has pins like that one. Turn it.',
        done: (s) => s.opened,
      },
    ],
  },
]

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id)
}

export function isTutorialLock(slug: string): boolean {
  return TUTORIAL_LOCKS.some((d) => d.slug === slug)
}

// ── Running a lesson ────────────────────────────────────────────────────────────────────

export interface LessonRun {
  readonly lesson: Lesson
  /** Index of the step the player is on. */
  step: number
  /** Seconds spent on the current step, for the hint timer. */
  onStepFor: number
  complete: boolean
}

export function startLesson(lesson: Lesson): LessonRun {
  return { lesson, step: 0, onStepFor: 0, complete: false }
}

/**
 * Advance the lesson against live state.
 *
 * Steps only ever move forward, and a step whose predicate is *already* true when it becomes
 * current is skipped immediately — so a player who works out the next thing before being told
 * is never made to sit through being told it. Teaching through play means the play leads.
 */
export function updateLesson(run: LessonRun, s: SimState, dt: number): void {
  if (run.complete) return
  run.onStepFor += dt

  // Opening the lock ends the lesson, whatever step it was on. `GAME_DESIGN.md §10` says of
  // the first lesson "ends the moment they open it", and the same has to hold for the other
  // two — lesson 2's middle steps ask the player to *overset*, and a step that requires
  // failing would leave a player who never fails stuck on a line they have already outgrown.
  // Teaching through play means the play decides when the teaching is over.
  if (s.opened) {
    run.step = run.lesson.steps.length
    run.complete = true
    return
  }

  let guard = 0
  while (run.step < run.lesson.steps.length && guard < 32) {
    const step = run.lesson.steps[run.step]
    if (!step || !step.done(s)) break
    run.step += 1
    run.onStepFor = 0
    guard += 1
  }
  if (run.step >= run.lesson.steps.length) run.complete = true
}

/** The single line to show right now, or null once the lesson is done. */
export function currentLine(run: LessonRun): string | null {
  if (run.complete) return null
  const step = run.lesson.steps[run.step]
  if (!step) return null
  if (step.hint !== undefined && run.onStepFor >= (step.hintAfter ?? 8)) return step.hint
  return step.line
}

/** How far through, 0..1 — for the progress pips beside the line. */
export function lessonProgress(run: LessonRun): number {
  const n = run.lesson.steps.length
  return n === 0 ? 1 : Math.min(1, run.step / n)
}
