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
  LESSON_SPOOL_LOCK,
  TUTORIAL_LOCKS,
  currentLine,
  isTutorialLock,
  lessonById,
  lessonProgress,
  startLesson,
  updateLesson,
} from '../../src/game/tutorial'
import { ALL_LOCKS } from '../../src/game/locks'
import {
  CAPTURE_WINDOW,
  MAX_OVERLIFT,
  PERFECT_TOOLS,
  createSimState,
  makeConfig,
  measureDifficulty,
  runTape,
  solveLock,
  validateLockDef,
  DT,
} from '../../src/sim'
import { holdFor, pick, tensionOnly } from '../sim/fixtures'

const CONFIG = makeConfig({ tools: PERFECT_TOOLS, featherEnabled: false })

describe('the teaching locks', () => {
  it('are four, and every one is a legal lock', () => {
    expect(TUTORIAL_LOCKS).toHaveLength(4)
    for (const def of TUTORIAL_LOCKS) {
      expect(() => validateLockDef(def)).not.toThrow()
    }
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

    const s = createSimState(LESSON_OVERSET_LOCK, 5, CONFIG)
    // Light tension and a fast lift: exactly what a player does having just learned that
    // lifting works. The pick crosses the window in about two ticks, well under `CAPTURE_TIME`.
    holdFor(s, tensionOnly(0.15), 0.3)
    const b = s.bindingChamber
    const c = s.chambers[b]
    expect(c).toBeDefined()
    if (!c) return
    holdFor(s, pick(b, c.setLift + MAX_OVERLIFT, 0.15), 1.2)
    expect(s.stats.oversets).toBeGreaterThan(0)
  })

  it('the spool lesson has exactly one spool, in the middle, and nothing else to confuse it', () => {
    expect(LESSON_SPOOL_LOCK.pins.filter((p) => p === 'spool')).toHaveLength(1)
    expect(LESSON_SPOOL_LOCK.pins[1]).toBe('spool')
    expect(LESSON_SPOOL_LOCK.pins.filter((p) => p !== 'standard' && p !== 'spool')).toHaveLength(0)
  })

  it('every teaching lock opens, across 50 seeds', () => {
    for (const def of TUTORIAL_LOCKS) {
      const r = measureDifficulty(def, CONFIG, 50)
      expect(r.solved, `${def.slug}: ${r.failures.slice(0, 2).join('; ')}`).toBe(50)
    }
  })
})

describe('the lessons', () => {
  it('are the course in order: the turn, then the three from GAME_DESIGN.md §10', () => {
    // `lesson-rotate` leads because rotation is the premise the others assume; the original
    // three keep their ids because the save file records ids.
    expect(LESSONS.map((l) => l.id)).toEqual(['lesson-rotate', 'lesson-1', 'lesson-2', 'lesson-3'])
    expect(LESSONS.map((l) => l.lock.slug)).toEqual(TUTORIAL_LOCKS.map((d) => d.slug))
  })

  it('teach in one line at a time, and every line is a line', () => {
    for (const lesson of LESSONS) {
      expect(lesson.steps.length, lesson.id).toBeGreaterThan(2)
      for (const step of lesson.steps) {
        // One sentence's worth. A step that needs a paragraph is a step that should have been
        // designed into the lock instead (GAME_DESIGN.md §10).
        expect(step.line.length, `${lesson.id}/${step.id}`).toBeLessThan(90)
        expect(step.line.split('\n'), `${lesson.id}/${step.id}`).toHaveLength(1)
        if (step.hint !== undefined) {
          expect(step.hint.length, `${lesson.id}/${step.id} hint`).toBeLessThan(90)
        }
      }
    }
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

    expect(currentLine(run)).toBe(first.line)
    // The hint replaces the line rather than joining it — still one line at a time.
    run.onStepFor = (first.hintAfter ?? 8) + 1
    expect(currentLine(run)).toBe(first.hint)
    expect(currentLine(run)).not.toContain('\n')
  })

  it('advances only when the player does the thing', () => {
    const lesson = lessonById('lesson-1')
    if (!lesson) throw new Error('no lesson')
    const run = startLesson(lesson)
    const s = createSimState(lesson.lock, 3, CONFIG)

    // Doing nothing advances nothing, however long you wait.
    holdFor(s, tensionOnly(0), 2)
    updateLesson(run, s, 2)
    expect(run.step).toBe(0)

    // Applying tension satisfies step 1, and only step 1.
    holdFor(s, tensionOnly(0.45), 0.3)
    updateLesson(run, s, 0.3)
    expect(run.step).toBe(1)
    expect(run.complete).toBe(false)
  })

  it('skips a step the player has already satisfied', () => {
    // A player who works out the next thing before being told is never made to sit through
    // being told it.
    const lesson = lessonById('lesson-1')
    if (!lesson) throw new Error('no lesson')
    const run = startLesson(lesson)
    const s = createSimState(lesson.lock, 3, CONFIG)

    // Tension on *and* already sitting on the binding chamber: two steps at once.
    holdFor(s, tensionOnly(0.45), 0.3)
    const b = s.bindingChamber
    holdFor(s, pick(b, 0, 0.45), 0.1)
    updateLesson(run, s, 0.1)
    expect(run.step).toBeGreaterThanOrEqual(2)
  })

  it('completes when the lock opens, with no clicks anywhere', () => {
    for (const lesson of LESSONS) {
      const run = startLesson(lesson)
      const s = createSimState(lesson.lock, 4, CONFIG)
      const solved = solveLock(lesson.lock, 4, CONFIG)
      expect(solved.opened, lesson.id).toBe(true)

      // Replay the solver's tape a tick at a time, updating the lesson as the game would.
      for (const segment of solved.tape) {
        for (let i = 0; i < segment.ticks; i += 1) {
          runTape(s, [{ ticks: 1, input: segment.input }])
          updateLesson(run, s, DT)
        }
      }
      expect(s.opened, lesson.id).toBe(true)
      expect(run.complete, `${lesson.id} did not complete on an open`).toBe(true)
      expect(currentLine(run), lesson.id).toBeNull()
      expect(lessonProgress(run), lesson.id).toBe(1)
    }
  })

  it('reaches the overset step in lesson 2 when the player oversets', () => {
    const lesson = lessonById('lesson-2')
    if (!lesson) throw new Error('no lesson')
    const run = startLesson(lesson)
    const s = createSimState(lesson.lock, 5, CONFIG)
    holdFor(s, tensionOnly(0.15), 0.3)
    updateLesson(run, s, 0.3)
    const b = s.bindingChamber
    const c = s.chambers[b]
    if (!c) throw new Error('nothing binding')
    holdFor(s, pick(b, c.setLift + MAX_OVERLIFT, 0.15), 1.2)
    updateLesson(run, s, 1.2)
    expect(s.stats.oversets).toBeGreaterThan(0)
    // Steps 1 and 2 are both satisfied by the overset; the player is now on "that pin is jammed".
    expect(run.lesson.steps[run.step]?.id).toBe('stuck')
  })

  it('reaches the false-set step in lesson 3 when the spool lies', () => {
    const lesson = lessonById('lesson-3')
    if (!lesson) throw new Error('no lesson')
    const run = startLesson(lesson)
    const s = createSimState(lesson.lock, 4, CONFIG)
    const solved = solveLock(lesson.lock, 4, CONFIG)
    let sawFalseSetStep = false
    for (const segment of solved.tape) {
      for (let i = 0; i < segment.ticks; i += 1) {
        runTape(s, [{ ticks: 1, input: segment.input }])
        updateLesson(run, s, DT)
        if (run.lesson.steps[run.step]?.id === 'false-set') sawFalseSetStep = true
      }
    }
    expect(s.stats.falseSetsEntered, 'the spool has to lie for the lesson to work').toBeGreaterThan(0)
    expect(sawFalseSetStep).toBe(true)
    expect(run.complete).toBe(true)
  })
})

