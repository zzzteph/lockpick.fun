/**
 * The solver — SIMULATION.md §11, VERIFICATION.md §4.
 *
 * A headless scripted picker that plays the game *properly*, through the same input API a
 * human uses: it finds the binding pin by reading the resistance meter, lifts to the middle
 * of the capture window, backs tension off when a groove refuses to let go, and feathers off
 * an overset. It never reads which chamber is binding — that would be x-ray, and the point of
 * this thing is to prove the lock is beatable with the information the player actually has.
 *
 * It is the completeness proof: if the solver cannot open a lock, the lock is broken, not the
 * solver.
 */

import { captureRange, targetLiftFor } from './classify'
import {
  COMBO_DETENT,
  DT,
  FEATHER_WINDOW,
  RESIST_PRESSURE_MM,
  STRAIN_BENT,
  T_MIN_HOLD,
} from './constants'
import { createSimState } from './lock'
import { clamp } from './math'
import { effectiveReach, step } from './step'
import type { InputTape, TapeSegment } from './tape'
import type { LockDef, SimConfig, SimInput, SimState } from './types'

export interface SolveOptions {
  /** Give up after this much simulated time. */
  maxSeconds?: number
  /** Working tension. The solver lowers it on its own when a groove fights back. */
  tension?: number
  /** Lowest tension it will drop to while pushing through a groove. */
  minTension?: number
  /** Tension used for the final turn, once every chamber is set. */
  turnTension?: number
}

export interface SolveResult {
  readonly opened: boolean
  /** Replayable record of everything the solver did. */
  readonly tape: InputTape
  readonly ticks: number
  readonly seconds: number
  /** How many times it picked a chamber and worked it — the difficulty proxy. */
  readonly rounds: number
  readonly oversets: number
  readonly resets: number
  readonly falseSets: number
  /**
   * Distinct positions it had to try blind, because the geometry there is unreadable — a
   * disc's gate angle and a sidebar gate's height. See `difficultyScore`.
   */
  readonly searchSteps: number
  /** Lowest tension it had to drop to. */
  readonly minTensionUsed: number
  /** Why it gave up, when it did. */
  readonly failure?: string
}

const PROBE_TICKS = 3
const STALL_TICKS = 45
const TENSION_STEP = 0.08
/** Ticks to dwell at one swept position: long enough for `CAPTURE_TIME` plus a margin. */
const DWELL_TICKS = 9
/** Ticks spent unloaded when the shaft is bowing — `STRAIN_RECOVERY` clears it fast (D-068). */
const STRAIN_RELIEF_TICKS = 150

function input(
  chamber: number,
  liftTarget: number,
  tension: number,
  held = true,
): SimInput {
  return { chamber, liftTarget, tensionHeld: held, tensionLevel: tension }
}

/**
 * Drive the simulation and record the tape at the same time. Consecutive identical inputs
 * are merged, so the tape stays small enough to replay and to store.
 */
class Recorder {
  readonly segments: TapeSegment[] = []
  ticks = 0
  /** Blind positions tried — see `SolveResult.searchSteps`. */
  searchSteps = 0

  constructor(readonly state: SimState) {}

  run(inp: SimInput, count: number): void {
    for (let i = 0; i < count; i += 1) step(this.state, inp, DT)
    this.ticks += count
    const last = this.segments[this.segments.length - 1]
    if (last && sameInput(last.input, inp)) {
      this.segments[this.segments.length - 1] = { ticks: last.ticks + count, input: last.input }
    } else {
      this.segments.push({ ticks: count, input: inp })
    }
  }
}

function sameInput(a: SimInput, b: SimInput): boolean {
  return (
    a.chamber === b.chamber &&
    a.liftTarget === b.liftTarget &&
    a.tensionHeld === b.tensionHeld &&
    a.tensionLevel === b.tensionLevel
  )
}

/**
 * Find the chamber that feels heaviest by moving the pick along the keyway and reading the
 * resistance meter — the same channel the player has (§8). Returns -1 if nothing is left.
 */
/**
 * Slide the pick to a chamber and wait until it is actually there.
 *
 * The tip travels along the keyway rather than teleporting (D-045), and under tension it
 * travels slowly. A solver that read the meter three ticks after asking for a chamber would be
 * reading whichever chamber it happened to be passing — so it waits, exactly as a player does.
 */
/**
 * Travel with the hand **down**, the way the controls make a player travel — DECISIONS D-138.
 *
 * This used to carry `lift` across the whole journey, which no human can do: `stepChamber` in the
 * input layer zeroes the lift on every chamber change and the touch scheme does the same, because
 * carrying a tip high past a set pin is how you lose it (D-051, D-059). It did not matter while
 * the simulation ignored every chamber but the selected one.
 *
 * It matters now. With the hook fouling what it passes, a solver that crosses the lock with its
 * hand up sweeps every pin between here and there — and the measured cost was enormous: tier 1
 * went from 2.50 to 36.61 and tier 2 from 6.16 to 104.08, with two locks dropping to 36/50 and
 * 41/50 on **resets**, the whole lock lost and restarted a dozen times an attempt.
 *
 * That is not the mechanic being too strong. It is the solver modelling an input the game does not
 * offer. The lift is dropped for the crossing and restored on arrival, which is what the arrow keys
 * and the touch scheme both do for you.
 */
function travelTo(rec: Recorder, chamber: number, lift: number, tension: number): boolean {
  const s = rec.state
  // Generous: the slowest crossing in the game is a 16-chamber lock at maximum tension.
  for (let i = 0; i < 900; i += 1) {
    if (s.pickChamber === chamber) {
      // Arrived: put the hand back where the caller wanted it.
      rec.run(input(chamber, lift, tension), 1)
      return true
    }
    rec.run(input(chamber, 0, tension), 1)
  }
  return s.pickChamber === chamber
}

function probeForHeaviest(rec: Recorder, tension: number, reach: number): number {
  const s = rec.state
  let best = -1
  let bestResistance = -1
  for (const c of s.chambers) {
    if (c.index >= reach) break
    if (c.state === 'SET') continue
    /**
     * Lean on the chamber, don't just visit it.
     *
     * A pin under an unloaded tip says nothing (D-056), so the probe applies exactly
     * `RESIST_PRESSURE_MM` of push — enough to read fully, and far below the lowest `setLift` in
     * the catalogue, so a probe can neither capture a pin nor overset one. Pressing an inverted
     * wafer means pressing *down*; a disc is left exactly where it was, because a disc has no
     * spring, the tool turns it both ways, and commanding anything else would un-turn every disc
     * the solver had not finished with.
     *
     * The version that probed at rest was reading the free information the pressure gate exists
     * to remove — it found the binding pin without touching it, which is what a player could do
     * too, and was the complaint.
     */
    /**
     * A combination wheel speaks only under motion (D-169): parked, its reading decays to the
     * floor in a fifth of a second, so probing at rest — which is what the disc case below
     * does — reads nothing at all. The honest probe is the player's own: wiggle the wheel one
     * detent out and back, reading mid-turn, and leave it parked exactly where it stood. The
     * hops are three ticks so the peak is sampled *while* the wheel moves rather than after
     * it has arrived and gone quiet.
     */
    if (c.kind === 'disc' && s.instance.def.family === 'combination') {
      const here = c.lift
      const out = (here + COMBO_DETENT) % c.maxLift
      travelTo(rec, c.index, here, tension)
      let peak = 0
      for (const target of [out, here]) {
        for (let hop = 0; hop < 8; hop += 1) {
          rec.run(input(c.index, target, tension), 3)
          if (s.resistance > peak) peak = s.resistance
        }
      }
      if (peak > bestResistance) {
        bestResistance = peak
        best = c.index
      }
      continue
    }
    const probeAt =
      c.kind === 'disc'
        ? c.lift
        : c.inverted
          ? Math.max(0, c.maxLift - RESIST_PRESSURE_MM)
          : RESIST_PRESSURE_MM
    travelTo(rec, c.index, probeAt, tension)
    rec.run(input(c.index, probeAt, tension), PROBE_TICKS)
    if (s.resistance > bestResistance) {
      bestResistance = s.resistance
      best = c.index
    }
  }
  return best
}

/**
 * Which families hide their geometry completely, so the solver has to hunt for it.
 *
 * A pin's height is inferable — the cutaway shows the key pin, and guided mode draws the
 * target outright. A disc detainer's gate angle and a Bramah slider's depth are readable by
 * nothing at all: both are seen face-on, with the mechanism behind the face. Sweeping until
 * something catches is the entire technique for both, and their traps only lie if something
 * is genuinely hunting for the truth. Each position tried is one `searchStep`.
 */
function needsBlindSweep(family: string): boolean {
  return family === 'disc-detainer' || family === 'radial-slider' || family === 'combination'
}

/**
 * Sweep a chamber through its travel until it catches.
 *
 * A disc wraps — a dial has no stop, and the disc keeps its angle when tension drops, so the
 * sweep never has to start over. A slider does not: it runs from the face inward to its
 * bottom, and past that there is nowhere to go.
 */
function sweepBlind(
  rec: Recorder,
  index: number,
  tension: number,
  maxTicks: number,
  wraps: boolean,
): boolean {
  const s = rec.state
  const c = s.chambers[index]
  if (!c) return false
  // Half a window, so the target can never be stepped clean over.
  const stride = Math.max(0.02, c.captureWindow / 2)
  const start = wraps ? c.lift : 0
  const steps = Math.ceil(c.maxLift / stride) + 1
  let spent = 0
  travelTo(rec, index, c.lift, tension)

  for (let i = 1; spent < maxTicks && i <= steps; i += 1) {
    const at = wraps ? (start + i * stride) % c.maxLift : Math.min(c.maxLift, start + i * stride)
    rec.searchSteps += 1
    rec.run(input(index, at, tension), DWELL_TICKS)
    spent += DWELL_TICKS
    if (c.state === 'SET') return true
  }
  return false
}

/**
 * Map every sidebar gate before picking anything, with the wrench barely loaded.
 *
 * A sidebar gate is a narrow band somewhere inside a capture window the pin crosses in a few
 * hundredths of a second, and setting the chamber anywhere else in that window leaves it
 * looking perfectly set while the plug stays locked. Guessing is hopeless: three gates at
 * even odds is one attempt in eight, and every failed attempt costs the whole lock.
 *
 * So the gates get surveyed first, with the wrench off. Nothing binds, nothing captures and
 * nothing can be lost, but the sidebar legs are sprung against their pins regardless, so
 * walking each gated chamber up through its window and watching for the light spot reads the
 * gate straight off the meter. That pass is the entire reason a sidebar lock is harder than
 * the same lock without one, and every position it tries is a `searchStep`.
 *
 * It does not make the lock free. The survey says where the gate is; hitting it afterwards,
 * under tension, with a pick that wobbles by more than half the gate's width, is a separate
 * problem — and missing is only discovered once every pin is set and the plug refuses.
 */
function mapSidebarGates(rec: Recorder, reach: number): Map<number, number> {
  const s = rec.state
  const found = new Map<number, number>()
  for (const c of s.chambers) {
    if (c.index >= reach || c.sidebarGate === null) continue
    const { low, high } = captureRange(c)
    // Step by the gate's own width: fine enough that the detent cannot be stepped over,
    // coarse enough that the search is a handful of probes rather than a hundred.
    const stride = Math.max(0.01, c.sidebarWidth)
    let lightest = Number.POSITIVE_INFINITY
    const readings: { x: number; r: number }[] = []
    travelTo(rec, c.index, low, 0)
    for (let x = low + stride * 0.5; x < high; x += stride) {
      rec.searchSteps += 1
      // Long enough for the pin to arrive and the meter to settle. Wrench off throughout.
      rec.run(input(c.index, x, 0, false), 5)
      readings.push({ x, r: s.resistance })
      if (s.resistance < lightest) lightest = s.resistance
    }
    // Sit in the *middle* of the notch, not at the first edge of it. The gate is wider than
    // one step, so several positions read equally light — and the outermost of those is
    // within a hundredth of a millimetre of missing, which the pick's own jitter will happily
    // spend. Centring is what makes the survey survive a shaky hand.
    const inNotch = readings.filter((p) => p.r <= lightest + 1e-6)
    const first = inNotch[0]
    const last = inNotch[inNotch.length - 1]
    found.set(
      c.index,
      first && last ? (first.x + last.x) / 2 : low + (high - low) * 0.5,
    )
  }
  // Let everything fall back to rest before the real attempt begins.
  if (found.size > 0) rec.run(input(-1, 0, 0, false), Math.round(0.25 / DT))
  return found
}

/** Work one chamber until it sets, jams, or the solver runs out of patience. */
function workChamber(
  rec: Recorder,
  index: number,
  tension: number,
  minTension: number,
  maxTicks: number,
  gates: Map<number, number>,
): { tension: number; done: boolean } {
  const s = rec.state
  const c = s.chambers[index]
  if (!c) return { tension, done: true }
  let working = tension
  // A sidebar gate is unreadable geometry — aim at whatever the opening survey found.
  const target = gates.get(index) ?? targetLiftFor(c)
  // Get there before starting the clock: the stall detector below measures a pin that is not
  // moving, and a pick still in transit is not a pin that is stuck.
  travelTo(rec, index, target, working)
  let stalled = 0
  let lastLift = c.lift

  for (let t = 0; t < maxTicks; t += 1) {
    rec.run(input(index, target, working), 1)
    if (c.state === 'SET' || c.state === 'OVERSET') return { tension: working, done: true }

    // Absolute movement, because an inverted wafer makes progress by going *down*.
    if (Math.abs(c.lift - lastLift) <= 1e-5) stalled += 1
    else stalled = 0
    lastLift = c.lift

    /**
     * Shaft loading up? Let go for a moment.
     *
     * The pick takes a set if you lean on something that will not move (D-068), and a solver that
     * cannot feel that would snap its tool on the first spool wall it met. The player has this
     * channel already — it is the bow in the shaft — so reading it here is not x-ray. Relieving at
     * half the bend threshold leaves plenty of margin, and the recovery is fast enough that a
     * beat of it costs almost nothing.
     */
    if (s.pickStrain > STRAIN_BENT * 0.5) {
      // Until it is *actually* relieved, not for a fixed count. A flat 30 ticks bled off 0.14 of
      // strain against a threshold of 0.5, so the loop re-entered relief immediately and spent the
      // attempt alternating between pushing and not-quite-recovering — which showed up as a
      // handful of wafer locks "running out of time" rather than as anything obviously wrong.
      for (let r = 0; r < STRAIN_RELIEF_TICKS && s.pickStrain > STRAIN_BENT * 0.15; r += 1) {
        rec.run(input(index, 0, working), 1)
      }
      stalled = 0
      continue
    }

    // Not moving? A groove is wedged against the plug's ledge. Back the tension off — the
    // counter-force scales with it, and this is the whole spool technique.
    if (stalled > STALL_TICKS) {
      if (working <= minTension + 1e-9) return { tension: working, done: false }
      working = Math.max(minTension, working - TENSION_STEP)
      stalled = 0
    }
  }
  return { tension: working, done: false }
}

export function solveLock(
  def: LockDef,
  seed: number,
  config: SimConfig,
  opts: SolveOptions = {},
): SolveResult {
  const maxSeconds = opts.maxSeconds ?? 90
  const tools = config.tools
  const startTension = clamp(opts.tension ?? 0.42, tools.tensionMin, tools.tensionMax)
  const minTension = clamp(
    opts.minTension ?? Math.max(T_MIN_HOLD + 0.03, tools.tensionMin),
    tools.tensionMin,
    tools.tensionMax,
  )
  const turnTension = clamp(opts.turnTension ?? 0.6, tools.tensionMin, tools.tensionMax)

  const state = createSimState(def, seed, config)
  const rec = new Recorder(state)
  const reach = effectiveReach(tools, def.keyway)
  const maxTicks = Math.round(maxSeconds / DT)

  let rounds = 0
  let tension = startTension
  let lowest = startTension

  const finish = (failure?: string): SolveResult => ({
    opened: state.opened,
    tape: rec.segments,
    ticks: rec.ticks,
    seconds: state.time,
    rounds,
    oversets: state.stats.oversets,
    resets: state.stats.fullResets,
    falseSets: state.stats.falseSetsEntered,
    searchSteps: rec.searchSteps,
    minTensionUsed: lowest,
    ...(failure !== undefined && !state.opened ? { failure } : {}),
  })

  if (state.chambers.length > reach) {
    return finish(
      `pick reaches ${reach} chambers, lock has ${state.chambers.length} — needs a longer hook`,
    )
  }

  let gates = mapSidebarGates(rec, reach)
  rec.run(input(-1, 0, tension), Math.round(0.35 / DT))

  while (!state.opened && rec.ticks < maxTicks) {
    // Everything captured: stop picking and turn it.
    if (state.chambers.every((c) => c.state === 'SET')) {
      rec.run(input(-1, 0, turnTension), Math.round(0.5 / DT))
      if (state.opened) break
      if (gates.size === 0) continue

      // Every pin reads set and the plug still will not go round: a sidebar gate was missed.
      // Nothing can be salvaged — a captured driver is above the shear line and cannot be
      // re-lifted — so the only move is the one a real picker makes, which is to let the whole
      // thing drop and go again. The survey is redone rather than reused: the miss came from
      // the pick's own wobble, so a fresh reading is a fresh draw, and repeating the old
      // number would just repeat the mistake.
      rec.run(input(-1, 0, 0, false), Math.round(0.45 / DT))
      gates = mapSidebarGates(rec, reach)
      rec.run(input(-1, 0, tension), Math.round(0.3 / DT))
      continue
    }

    // Jammed: feather it off if the technique is known, otherwise start again.
    const jammed = state.chambers.find((c) => c.state === 'OVERSET')
    if (jammed) {
      if (config.featherEnabled) {
        rec.run(input(-1, 0, 0, false), Math.round((FEATHER_WINDOW * 0.4) / DT))
        rec.run(input(-1, 0, tension), Math.round(0.25 / DT))
      } else {
        rec.run(input(-1, 0, 0, false), Math.round(0.4 / DT))
        rec.run(input(-1, 0, tension), Math.round(0.35 / DT))
        // A reset costs everything, so come back at it more gently.
        tension = Math.max(minTension, tension - TENSION_STEP)
        lowest = Math.min(lowest, tension)
      }
      continue
    }

    const target = probeForHeaviest(rec, tension, reach)
    if (target < 0) return finish('nothing left to work but the lock is not open')

    rounds += 1
    if (needsBlindSweep(def.family)) {
      // Nothing to aim at — work it along until it catches. Discs and combination wheels
      // wrap (a dial has no stop); only the slider runs out of travel.
      sweepBlind(rec, target, tension, Math.round(12 / DT), def.family !== 'radial-slider')
      continue
    }
    const result = workChamber(rec, target, tension, minTension, Math.round(3.5 / DT), gates)
    lowest = Math.min(lowest, result.tension)
    if (!result.done) {
      // Could not move it even at the lowest tension this wrench reaches. Ease off globally
      // and try again — on a fresh probe it may pick a different chamber.
      tension = Math.max(minTension, tension - TENSION_STEP)
      lowest = Math.min(lowest, tension)
      rec.run(input(-1, 0, tension), Math.round(0.2 / DT))
    } else {
      tension = result.tension
      lowest = Math.min(lowest, tension)
    }
  }

  return finish(state.opened ? undefined : 'ran out of time')
}

/** Aggregate statistics for one lock across many seeds — the difficulty curve. */
export interface LockDifficulty {
  readonly slug: string
  readonly name: string
  readonly tier: number
  /** §7 — carried through so the score can weight by it. */
  readonly toleranceQuality: number
  readonly seeds: number
  readonly solved: number
  /** Mean simulated seconds to open, over the seeds that opened. */
  readonly meanSeconds: number
  readonly maxSeconds: number
  /** Mean number of chambers worked — the closest thing to "attempts to open". */
  readonly meanRounds: number
  readonly meanOversets: number
  readonly meanResets: number
  readonly meanFalseSets: number
  /** Mean blind positions tried — the cost of geometry the player cannot read. */
  readonly meanSearchSteps: number
  readonly failures: readonly string[]
}

export function measureDifficulty(
  def: LockDef,
  config: SimConfig,
  seeds: number,
  opts: SolveOptions = {},
): LockDifficulty {
  let solved = 0
  let totalSeconds = 0
  let worst = 0
  let totalRounds = 0
  let totalOversets = 0
  let totalResets = 0
  let totalFalseSets = 0
  let totalSearchSteps = 0
  const failures: string[] = []

  for (let seed = 0; seed < seeds; seed += 1) {
    const r = solveLock(def, seed, config, opts)
    if (r.opened) {
      solved += 1
      totalSeconds += r.seconds
      if (r.seconds > worst) worst = r.seconds
    } else {
      failures.push(`seed ${seed}: ${r.failure ?? 'unknown'}`)
    }
    totalRounds += r.rounds
    totalOversets += r.oversets
    totalResets += r.resets
    totalFalseSets += r.falseSets
    totalSearchSteps += r.searchSteps
  }

  return {
    slug: def.slug,
    name: def.name,
    tier: def.tier,
    toleranceQuality: def.toleranceQuality,
    seeds,
    solved,
    meanSeconds: solved > 0 ? totalSeconds / solved : 0,
    maxSeconds: worst,
    meanRounds: totalRounds / seeds,
    meanOversets: totalOversets / seeds,
    meanResets: totalResets / seeds,
    meanFalseSets: totalFalseSets / seeds,
    meanSearchSteps: totalSearchSteps / seeds,
    failures,
  }
}

/**
 * A difficulty score for the curve, in units of "chambers' worth of work".
 *
 * Wall-clock solve time turns out to be a poor measure: the solver plays perfectly, never
 * oversets and never resets, so its elapsed time is almost exactly proportional to chamber
 * count. By that measure a five-chamber Tier 2 cylinder outranks a four-chamber Tier 3 spool
 * trainer, which is plainly wrong — and `CONTENT.md` makes locks 13 and 14 small on purpose,
 * because they are *trainers*.
 *
 * So the score counts the three things the lock actually asks of the player, each in the same
 * unit as the first:
 *  - **rounds** — chambers that had to be found and worked.
 *  - **false sets** — times the lock lied and had to be seen through, at half the weight of
 *    working a fresh chamber; recognising and pushing past a groove is real work, but less
 *    than finding a pin from scratch.
 *  - **mistakes forced** — oversets and full resets, weighted heavily because a reset costs
 *    the player every chamber they had already set.
 *  - **blind search** — positions that had to be tried by feel, because the geometry there is
 *    unreadable: a disc's gate angle and a sidebar gate's height. A tenth of a chamber each,
 *    so hunting a whole disc round its travel costs about a chamber and a half.
 *
 * The search term is what makes the curve tell the truth about Tier 5. `CONTENT.md` gives the
 * high-security locks *fewer* chambers than the Tier 4 dimples — six discs against twelve
 * dimple pins — so any measure that only counts chambers ranks a disc detainer below a lock
 * you can read straight off the cutaway. What makes it hard is not how many things there are;
 * it is that you cannot see where any of them need to go.
 *
 * All of that is then scaled by **tolerance**, because `SIMULATION.md §7` calls
 * `toleranceQuality` the primary difficulty knob and a curve that cannot see the primary
 * difficulty knob is measuring the wrong thing. It is a multiplier rather than another term:
 * a tighter lock does not add work, it makes every unit of the same work less forgiving. The
 * solver itself never feels it — it aims at the middle of the window and so never oversets —
 * which is exactly why the number has to come from the lock rather than from the playthrough.
 *
 * See DECISIONS D-023, D-029.
 */
export const FALSE_SET_WEIGHT = 0.5
export const OVERSET_WEIGHT = 4
export const RESET_WEIGHT = 8
export const SEARCH_WEIGHT = 0.05
/** The `toleranceQuality` a multiplier of 1.0 corresponds to — a mid-Tier-3 lock. */
export const REFERENCE_TOLERANCE = 1.0

export function toleranceFactor(toleranceQuality: number): number {
  return toleranceQuality > 0 ? REFERENCE_TOLERANCE / toleranceQuality : 1
}

export function difficultyScore(r: LockDifficulty): number {
  const work =
    r.meanRounds +
    FALSE_SET_WEIGHT * r.meanFalseSets +
    OVERSET_WEIGHT * r.meanOversets +
    RESET_WEIGHT * r.meanResets +
    SEARCH_WEIGHT * r.meanSearchSteps
  return work * toleranceFactor(r.toleranceQuality)
}

export function meanScoreByTier(rows: readonly LockDifficulty[]): Map<number, number> {
  const byTier = new Map<number, number[]>()
  for (const r of rows) {
    const list = byTier.get(r.tier) ?? []
    list.push(difficultyScore(r))
    byTier.set(r.tier, list)
  }
  const out = new Map<number, number>()
  for (const [tier, list] of byTier) {
    out.set(tier, list.reduce((a, b) => a + b, 0) / Math.max(1, list.length))
  }
  return out
}

/** Render the difficulty table written to `screenshots/difficulty-curve.txt`. */
export function formatDifficultyTable(rows: readonly LockDifficulty[], title: string): string {
  const head =
    '  # tier  lock                             solved   score    tol   mean s   max s  rounds  overset  reset  false  search'
  const lines: string[] = [title, '='.repeat(head.length), head, '-'.repeat(head.length)]
  rows.forEach((r, i) => {
    lines.push(
      [
        String(i + 1).padStart(3),
        String(r.tier).padStart(5),
        `  ${r.name}`.padEnd(33).slice(0, 33),
        `${r.solved}/${r.seeds}`.padStart(7),
        difficultyScore(r).toFixed(2).padStart(8),
        r.toleranceQuality.toFixed(2).padStart(7),
        r.meanSeconds.toFixed(1).padStart(9),
        r.maxSeconds.toFixed(1).padStart(8),
        r.meanRounds.toFixed(1).padStart(8),
        r.meanOversets.toFixed(2).padStart(9),
        r.meanResets.toFixed(2).padStart(7),
        r.meanFalseSets.toFixed(1).padStart(7),
        r.meanSearchSteps.toFixed(1).padStart(8),
      ].join(''),
    )
  })
  lines.push('-'.repeat(head.length))
  lines.push(
    '',
    `score = (rounds + ${FALSE_SET_WEIGHT} x falseSets + ${OVERSET_WEIGHT} x oversets + ` +
      `${RESET_WEIGHT} x resets + ${SEARCH_WEIGHT} x searchSteps) x ${REFERENCE_TOLERANCE}/tol`,
    '',
    'Mean difficulty score by tier:',
  )
  const scores = meanScoreByTier(rows)
  const seconds = new Map<number, number[]>()
  for (const r of rows) {
    const list = seconds.get(r.tier) ?? []
    list.push(r.meanSeconds)
    seconds.set(r.tier, list)
  }
  for (const tier of [...scores.keys()].sort((a, b) => a - b)) {
    const list = seconds.get(tier) ?? []
    const meanS = list.reduce((a, b) => a + b, 0) / Math.max(1, list.length)
    lines.push(
      `  tier ${tier}: score ${(scores.get(tier) ?? 0).toFixed(2).padStart(6)}   ` +
        `mean ${meanS.toFixed(1)}s   (${list.length} locks)`,
    )
  }
  return lines.join('\n')
}
