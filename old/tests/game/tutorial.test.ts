/**
 * The three lessons — `GAME_DESIGN.md §10`, `PHASES.md` Phase 12.
 *
 * The requirement worth testing hardest is the design rule, not the mechanics: *"Teach through
 * play with a single line of text at a time. No walls of tutorial prose."* So this asserts the
 * shape of the teaching as well as its behaviour — one line at a time, never two, always
 * driven by something the player did, and the whole lesson beatable by a scripted picker with
 * no clicks to dismiss anything.
 */

import { describe, expect, it } from 'vitest'
import {
  LESSONS,
  LESSON_TURN_LOCK,
  LESSON_TENSION_LOCK,
  LESSON_OVERSET_LOCK,
  LESSON_PRESSURE_LOCK,
  LESSON_SPOOL_LOCK,
  LESSON_SERRATED_LOCK,
  TUTORIAL_LOCKS,
  currentLine,
  isTutorialLock,
  lessonById,
  lessonProgress,
  speak,
  startLesson,
  updateLesson,
} from '../../src/game/tutorial'
import { ALL_LOCKS } from '../../src/game/locks'
import {
  CAPTURE_WINDOW,
  PERFECT_TOOLS,
  createSimState,
  makeConfig,
  validateLockDef,
  DT,
} from '../../src/sim'
import { measureDifficulty, runTape, solveLock } from '../../src/wheels'
import { Session } from '../../src/game/session'
import { solverCanRun } from '../../src/game/solverStepper'
import { walkSolver } from '../../src/game/solverWalk'
import { tensionForStep } from '../../src/ui/input'
import type { LockDef, SimInput } from '../../src/sim'

const CONFIG = makeConfig({ tools: PERFECT_TOOLS, featherEnabled: false })

/**
 * The lessons' pin locks run on the contact solver (D-233), so these tests play them through a
 * `Session` the way the game does; the wheel lesson stays on the rate sim, its solver and tape.
 */
const TICK = 1 / 120
function input(patch: Partial<SimInput> = {}): SimInput {
  return { chamber: -1, liftTarget: 0, tensionHeld: false, tensionLevel: 0, ...patch }
}
function hold(s: Session, inp: SimInput, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += TICK) {
    s.advance(TICK, inp)
    each?.()
  }
}
const WRENCH = tensionForStep(5)
/** Open a lesson lock, calling `each` every tick: the solver's walk, or the rate sim's tape. */
function playOpen(def: LockDef, seed: number, each: (state: Session['state']) => void): Session['state'] {
  if (solverCanRun(def)) {
    const s = new Session(def, seed, CONFIG)
    walkSolver(s, () => each(s.state), { maxSeconds: 600 })
    return s.state
  }
  const s = createSimState(def, seed, CONFIG)
  const solved = solveLock(def, seed, CONFIG)
  for (const segment of solved.tape) {
    for (let i = 0; i < segment.ticks; i += 1) {
      runTape(s, [{ ticks: 1, input: segment.input }])
      each(s)
    }
  }
  return s
}

describe('the teaching locks', () => {
  it('are eight, and every one is a legal lock', () => {
    expect(TUTORIAL_LOCKS).toHaveLength(8)
    for (const def of TUTORIAL_LOCKS) {
      expect(() => validateLockDef(def)).not.toThrow()
    }
  })

  it('the serrated lesson has exactly one serrated pin, in the middle', () => {
    expect(LESSON_SERRATED_LOCK.pins.filter((p) => p === 'serrated')).toHaveLength(1)
    expect(LESSON_SERRATED_LOCK.pins[1]).toBe('serrated')
  })

  it('the pressure lesson is all standard pins — the lesson is in the other hand', () => {
    expect(LESSON_PRESSURE_LOCK.pins.every((p) => p === 'standard')).toBe(true)
  })

  it('the turn lesson has exactly one pin, so the premise is visible with nothing else moving', () => {
    expect(LESSON_TURN_LOCK.bitting).toHaveLength(1)
    expect(LESSON_TURN_LOCK.pins).toEqual(['standard'])
    // As forgiving as the tension lock: a first-ever attempt must not be able to overset.
    const loosest = Math.max(...ALL_LOCKS.map((d) => d.toleranceQuality))
    expect(LESSON_TURN_LOCK.toleranceQuality).toBeGreaterThan(loosest)
  })

  it('are kept out of the roster entirely', () => {
    // A lesson lock must not appear on the bench, in the difficulty curve, or in the count
    // *Master of the Bench* is measured against.
    for (const def of TUTORIAL_LOCKS) {
      expect(ALL_LOCKS.some((d) => d.slug === def.slug), def.slug).toBe(false)
      expect(ALL_LOCKS.some((d) => d.id === def.id), `id ${def.id}`).toBe(false)
      expect(isTutorialLock(def.slug)).toBe(true)
    }
    expect(isTutorialLock('clear-practice-cutaway')).toBe(false)
  })

  it('leave no record — a lesson teaches, it does not count', () => {
    // They used to pay nothing; there is nothing to pay since D-091. What has to stay true is that
    // a lesson lock is not on the bench and so can never be ranked, which is the real claim.
    for (const def of TUTORIAL_LOCKS) {
      expect(ALL_LOCKS.some((d) => d.slug === def.slug), def.slug).toBe(false)
    }
  })

  it('the tension lesson is more forgiving than anything on the bench', () => {
    const loosest = Math.max(...ALL_LOCKS.map((d) => d.toleranceQuality))
    expect(LESSON_TENSION_LOCK.toleranceQuality).toBeGreaterThan(loosest)
    // Its window is wide enough that simply holding still anywhere sensible works.
    const w = CAPTURE_WINDOW * LESSON_TENSION_LOCK.toleranceQuality
    expect(w).toBeGreaterThan(0.9)
  })

  it('the overset lesson is tight enough to genuinely jam, which is the lesson', () => {
    const w = CAPTURE_WINDOW * LESSON_OVERSET_LOCK.toleranceQuality
    // Narrower than the pick crosses inside `CAPTURE_TIME`, so overshooting really oversets.
    expect(w).toBeLessThan(0.4)

    // On the solver (D-233): lift a pin to the ceiling and keep pushing; it oversets and, held,
    // wedges (D-220), which is exactly what the lesson asks the player to feel.
    const s = new Session(LESSON_OVERSET_LOCK, 5, CONFIG)
    hold(s, input({ tensionHeld: true, tensionLevel: WRENCH }), 0.5)
    hold(s, input({ chamber: 0, liftTarget: 3.5, tensionHeld: true, tensionLevel: WRENCH }), 4)
    expect(s.state.stats.oversets).toBeGreaterThan(0)
    expect(s.state.chambers.some((c) => c.jammed === true)).toBe(true)
  })

  it('the spool lesson has exactly one spool, in the middle, and nothing else to confuse it', () => {
    expect(LESSON_SPOOL_LOCK.pins.filter((p) => p === 'spool')).toHaveLength(1)
    expect(LESSON_SPOOL_LOCK.pins[1]).toBe('spool')
    expect(LESSON_SPOOL_LOCK.pins.filter((p) => p !== 'standard' && p !== 'spool')).toHaveLength(0)
  })

  it('every teaching lock opens: the pin locks by the solver walk, the wheels across 50 seeds', () => {
    for (const def of TUTORIAL_LOCKS) {
      if (solverCanRun(def)) {
        for (const seed of [1, 3, 4]) {
          const s = new Session(def, seed, CONFIG)
          expect(walkSolver(s, () => {}, { maxSeconds: 600 }), `${def.slug} seed ${seed}`).toBe(true)
        }
        continue
      }
      const r = measureDifficulty(def, CONFIG, 50)
      expect(r.solved, `${def.slug}: ${r.failures.slice(0, 2).join('; ')}`).toBe(50)
    }
  }, 1_200_000)
})

describe('the lessons', () => {
  it('are the course in order: premise, hands, failure, pressure, the liars, wheels, then the gun', () => {
    // `lesson-rotate` leads because rotation is the premise the others assume; the original
    // three keep their ids because the save file records ids. Pressure comes before the
    // security pins because both of their lessons lean on it. The wheel pack closes the pick
    // course (it assumes the binding-order hunt the cylinder curriculum just taught, D-167), and
    // the snap gun comes last of all (D-217): a different tool entirely, taught once picking is known.
    expect(LESSONS.map((l) => l.id)).toEqual([
      'lesson-rotate',
      'lesson-1',
      'lesson-2',
      'lesson-pressure',
      'lesson-3',
      'lesson-serrated',
      'lesson-wheels',
      'lesson-gun',
    ])
    expect(LESSONS.map((l) => l.lock.slug)).toEqual(TUTORIAL_LOCKS.map((d) => d.slug))
  })

  it('teach in one line at a time, and every line is a line — in every voice', () => {
    for (const lesson of LESSONS) {
      expect(lesson.steps.length, lesson.id).toBeGreaterThan(2)
      for (const step of lesson.steps) {
        for (const voice of ['kb', 'deck'] as const) {
          // One sentence's worth. A step that needs a paragraph is a step that should have been
          // designed into the lock instead (GAME_DESIGN.md §10) — and the deck voice (D-201) is
          // held to the same bar, because it is the same screen band.
          const line = speak(step.line, voice)
          expect(line.length, `${lesson.id}/${step.id} (${voice})`).toBeLessThan(90)
          expect(line.split('\n'), `${lesson.id}/${step.id} (${voice})`).toHaveLength(1)
          if (step.hint !== undefined) {
            expect(speak(step.hint, voice).length, `${lesson.id}/${step.id} hint (${voice})`)
              .toBeLessThan(90)
          }
        }
      }
    }
  })

  it('the deck voice never names a control the deck does not have', () => {
    // The whole point of D-201: a lesson saying "Hold Q" on a machine with no Q is the D-105
    // lie read aloud. The kb voice is allowed all of these, so only the deck voice is swept.
    const KEYBOARD_WORDS = /\bQ\b|\bSpace\b|arrow|number keys|keys 1/i
    for (const lesson of LESSONS) {
      for (const step of lesson.steps) {
        const texts = [step.line, ...(step.hint !== undefined ? [step.hint] : [])]
        for (const t of texts) {
          expect(speak(t, 'deck'), `${lesson.id}/${step.id}`).not.toMatch(KEYBOARD_WORDS)
        }
      }
    }
  })

  it('a plain line speaks the same in every voice', () => {
    expect(speak('the words', 'kb')).toBe('the words')
    expect(speak('the words', 'deck')).toBe('the words')
    expect(speak({ kb: 'press Q', deck: 'press R2' }, 'deck')).toBe('press R2')
  })

  it('has unique step ids within each lesson', () => {
    for (const lesson of LESSONS) {
      expect(new Set(lesson.steps.map((s) => s.id)).size, lesson.id).toBe(lesson.steps.length)
    }
  })

  it('shows exactly one line at any moment, and never a hint before its time', () => {
    const lesson = lessonById('lesson-1')
    expect(lesson).toBeDefined()
    if (!lesson) return
    const run = startLesson(lesson)
    const first = lesson.steps[0]
    expect(first).toBeDefined()
    if (!first) return

    expect(currentLine(run)).toBe(speak(first.line, 'kb'))
    // The deck voice resolves through the same road, and differs exactly where a variant exists.
    expect(currentLine(run, 'deck')).toBe(speak(first.line, 'deck'))
    expect(currentLine(run, 'deck')).toContain('R2')
    // The hint replaces the line rather than joining it — still one line at a time.
    run.onStepFor = (first.hintAfter ?? 8) + 1
    expect(currentLine(run)).toBe(speak(first.hint ?? '', 'kb'))
    expect(currentLine(run)).not.toContain('\n')
  })

  it('advances only when the player does the thing', () => {
    const lesson = lessonById('lesson-1')
    if (!lesson) throw new Error('no lesson')
    const run = startLesson(lesson)
    const s = new Session(lesson.lock, 3, CONFIG)

    // Doing nothing advances nothing, however long you wait.
    hold(s, input(), 2)
    updateLesson(run, s.state, 2)
    expect(run.step).toBe(0)

    // Applying tension satisfies step 1, and only step 1.
    hold(s, input({ tensionHeld: true, tensionLevel: WRENCH }), 0.3)
    updateLesson(run, s.state, 0.3)
    expect(run.step).toBe(1)
    expect(run.complete).toBe(false)
  })

  it('skips a step the player has already satisfied', () => {
    // A player who works out the next thing before being told is never made to sit through
    // being told it.
    const lesson = lessonById('lesson-1')
    if (!lesson) throw new Error('no lesson')
    const run = startLesson(lesson)
    const s = new Session(lesson.lock, 3, CONFIG)

    // Tension on *and* already sitting on the binding chamber: two steps at once.
    hold(s, input({ tensionHeld: true, tensionLevel: WRENCH }), 0.3)
    const b = s.state.bindingChamber
    hold(s, input({ chamber: b, tensionHeld: true, tensionLevel: WRENCH }), 0.5)
    updateLesson(run, s.state, 0.5)
    expect(run.step).toBeGreaterThanOrEqual(2)
  })

  it('completes when the lock opens, with no clicks anywhere', () => {
    for (const lesson of LESSONS) {
      const run = startLesson(lesson)
      // Played a tick at a time, updating the lesson as the game would.
      const s = playOpen(lesson.lock, 4, (st) => updateLesson(run, st, DT))
      expect(s.opened, lesson.id).toBe(true)
      expect(run.complete, `${lesson.id} did not complete on an open`).toBe(true)
      expect(currentLine(run), lesson.id).toBeNull()
      expect(lessonProgress(run), lesson.id).toBe(1)
    }
  }, 600_000)

  it('reaches the overset step in lesson 2 when the player oversets', () => {
    const lesson = lessonById('lesson-2')
    if (!lesson) throw new Error('no lesson')
    const run = startLesson(lesson)
    const s = new Session(lesson.lock, 5, CONFIG)
    hold(s, input({ tensionHeld: true, tensionLevel: WRENCH }), 0.5, () => updateLesson(run, s.state, TICK))
    // Push one pin too far and keep pushing, as the lesson asks: it oversets and wedges (D-223).
    hold(s, input({ chamber: 0, liftTarget: 3.5, tensionHeld: true, tensionLevel: WRENCH }), 4, () =>
      updateLesson(run, s.state, TICK),
    )
    expect(s.state.stats.oversets).toBeGreaterThan(0)
    // Steps 1 and 2 are both satisfied by the overset; the player is now on "that pin is jammed".
    expect(run.lesson.steps[run.step]?.id).toBe('stuck')
  })

  it('reaches the false-set step in lesson 3 when the spool lies', () => {
    const lesson = lessonById('lesson-3')
    if (!lesson) throw new Error('no lesson')
    const run = startLesson(lesson)
    let sawFalseSetStep = false
    const s = playOpen(lesson.lock, 4, (st) => {
      updateLesson(run, st, DT)
      if (run.lesson.steps[run.step]?.id === 'false-set') sawFalseSetStep = true
    })
    expect(s.stats.falseSetsEntered, 'the spool has to lie for the lesson to work').toBeGreaterThan(0)
    expect(sawFalseSetStep).toBe(true)
    expect(run.complete).toBe(true)
  })
})

