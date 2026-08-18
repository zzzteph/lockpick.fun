/**
 * Player progression — GAME_DESIGN.md §5 and §6.
 *
 * Owns the save data and the rules that read it: which tiers are unlocked, what a lock is
 * worth, what a completed attempt does to the records. Pure logic over a `SaveData`, with the
 * storage handed in, so the whole thing is testable headlessly.
 */

import type { AssistMode, AttemptStats, LockDef, SimState, ToolStats } from '../sim'
import { isSecurityPin } from '../sim'
import { newlyEarned, type Achievement } from './achievements'
import { challengesMet } from './challenges'
import { CUSTOM_ID_BASE, slugFor } from './editor'
import { bestOf, countsForTier, rankEarned } from './ranks'
import { beatsScore, type StreakScore } from './streak'
import { ALL_LOCKS, locksInTier } from './locks'
import { KIT } from './tools'
import {
  emptyRecord,
  loadSave,
  newSave,
  writeSave,
  type LockRecord,
  type SaveData,
  type StorageLike,
} from './save'

/**
 * Opens needed in the previous tier to unlock the next — `GAME_DESIGN.md §5`.
 * By *count*, not by completion, so nobody gets walled by one lock they hate.
 */
export const TIER_UNLOCK_REQUIREMENT: Record<number, number> = {
  1: 0,
  2: 3,
  3: 3,
  4: 4,
}

/**
 * Four tiers, all of them cylinders (D-104).
 *
 * Was five — the fifth was the disc detainers, and they were cut for being a family the game
 * never taught. Tier 4 was already the hardest cylinder tier in the game and is now the last one,
 * which costs the roster three locks and no difficulty: the curve still rises across all four.
 *
 * Never more than four of a tier's five locks, so no tier is gated on *completing* the one below
 * it. "By count, not by completion, so nobody gets walled by one lock they hate."
 */
export const MAX_TIER = 4

/**
 * How many opens a tier *actually* needs, given how many locks exist to open.
 *
 * The roster is authored across several phases, so a stated requirement can temporarily
 * exceed the number of locks in the tier below it — Tier 3 asks for four Tier 2 opens while
 * only three Tier 2 locks are authored, because the wafer locks arrive in Phase 9. Left
 * alone that makes the game literally unfinishable. Clamping to what exists keeps every tier
 * reachable at all times, and `tests/game/progress.test.ts` reports which tiers are currently
 * clamped so the gap stays visible rather than silently absorbed. See DECISIONS D-027.
 */
export function opensRequiredFor(tier: number): number {
  const stated = TIER_UNLOCK_REQUIREMENT[tier] ?? Number.POSITIVE_INFINITY
  const available = locksInTier(tier - 1).length
  return Math.min(stated, available)
}

/** Tiers whose stated requirement currently exceeds the locks authored below them. */
export function clampedTiers(): { tier: number; stated: number; available: number }[] {
  const out: { tier: number; stated: number; available: number }[] = []
  for (let tier = 2; tier <= MAX_TIER; tier += 1) {
    const stated = TIER_UNLOCK_REQUIREMENT[tier] ?? 0
    const available = locksInTier(tier - 1).length
    if (available > 0 && available < stated) out.push({ tier, stated, available })
  }
  return out
}

export interface AttemptOutcome {
  readonly lock: LockDef
  readonly opened: boolean
  readonly seconds: number
  readonly oversets: number
  readonly resets: number
  readonly falseSets: number
  readonly setOrder: readonly number[]
  readonly bindOrder: readonly number[]
  /** Feathers used — a dip below `T_MIN_HOLD` short enough to shed only the oversets. */
  readonly feathers: number
  /** Highest and lowest tension the attempt ever reached, for the two tension trophies. */
  readonly maxTension: number
  readonly minTensionWhileHeld: number
  /** How many security-pin chambers were captured. */
  readonly securityPinsSet: number
  /** Assist mode the attempt was played in. */
  readonly assist: AssistMode
  /** Opt-in challenge ids that were met. */
  readonly challenges: readonly string[]
}

/**
 * What an attempt was worth — which since D-091 is a **rank**, not money.
 *
 * Handed back by `completeAttempt` for the results screen to draw. `improved` is the bit that
 * makes it worth reading twice: a run that beats your own best on this lock is the only thing in
 * the game that changes a number permanently, so it is the thing the screen should shout about.
 */
export interface AttemptResult {
  /** Rank index earned this attempt. 0 is S. */
  readonly rank: number
  /** Best ever on this lock, after this attempt. */
  readonly bestRank: number
  /** Best before this attempt, or null on a first open. */
  readonly previousBest: number | null
  readonly improved: boolean
  readonly firstOpen: boolean
  /** The par this attempt was actually judged against, once assist had its say. */
  readonly par: number
  /** Challenge ids opted into and met. */
  readonly challenges: readonly string[]
}

export interface OutcomeContext {
  readonly challenges?: readonly string[]
}

/**
 * Turn a finished attempt into an outcome record.
 *
 * Everything an achievement could ever want to ask is captured here, at the moment the lock
 * opens, rather than being re-derived later from a state that has already moved on. That is
 * what makes an achievement a pure function of one record — and therefore testable by handing
 * it a record, which is what `PHASES.md` Phase 11 asks for.
 */
export function outcomeFrom(
  lock: LockDef,
  state: SimState,
  stats: AttemptStats,
  ctx: OutcomeContext | number = {},
): AttemptOutcome {
  const opts: OutcomeContext = typeof ctx === 'number' ? {} : ctx
  let securityPinsSet = 0
  for (const c of state.chambers) {
    if (c.state === 'SET' && isSecurityPin(c.profile)) securityPinsSet += 1
  }
  return {
    lock,
    opened: state.opened,
    seconds: state.time,
    oversets: stats.oversets,
    resets: stats.fullResets,
    falseSets: stats.falseSetsEntered,
    setOrder: [...stats.setOrder],
    bindOrder: [...stats.bindOrder],
    feathers: stats.feathers,
    maxTension: stats.maxTension,
    // Untouched when the attempt never held tension at all; report that as zero rather than
    // as the sentinel, or `Iron Grip` reads a lock nobody tensioned as an iron grip.
    minTensionWhileHeld: stats.minTensionWhileHeld > 1 ? 0 : stats.minTensionWhileHeld,
    securityPinsSet,
    assist: state.config.assist,
    challenges: [...(opts.challenges ?? [])],
  }
}

export class Progress {
  data: SaveData

  constructor(
    private readonly storage: StorageLike,
    data?: SaveData,
  ) {
    this.data = data ?? loadSave(storage).data
  }

  static fresh(storage: StorageLike): Progress {
    return new Progress(storage, newSave())
  }

  save(): void {
    writeSave(this.storage, this.data)
  }

  record(slug: string): LockRecord {
    return this.data.records[slug] ?? emptyRecord()
  }

  hasOpened(slug: string): boolean {
    return this.record(slug).opens > 0
  }

  /**
   * Distinct locks in a tier opened **well enough to count** — rank D or better (D-091).
   *
   * It used to be "opened at all", which meant a tier could be unlocked by flailing at five locks
   * for ten minutes each. Rank D is one and a half times par: it asks that you actually picked the
   * lock rather than survived it, and leaves plenty of room to be slow about it.
   */
  opensInTier(tier: number): number {
    let n = 0
    for (const def of locksInTier(tier)) if (countsForTier(this.record(def.slug).bestRank)) n += 1
    return n
  }

  /**
   * Tiers unlock in order: you cannot reach Tier 4 without having unlocked Tier 3, even if
   * you somehow opened enough Tier 3 locks first.
   */
  isTierUnlocked(tier: number): boolean {
    if (tier <= 1) return true
    if (tier > MAX_TIER) return false
    if (!this.isTierUnlocked(tier - 1)) return false
    const required = opensRequiredFor(tier)
    if (required <= 0) return false
    return this.opensInTier(tier - 1) >= required
  }

  get highestUnlockedTier(): number {
    let t = 1
    while (t < MAX_TIER && this.isTierUnlocked(t + 1)) t += 1
    return t
  }

  /** How many more opens in tier `n - 1` before tier `n` unlocks. */
  opensNeededFor(tier: number): number {
    if (this.isTierUnlocked(tier)) return 0
    return Math.max(0, opensRequiredFor(tier) - this.opensInTier(tier - 1))
  }

  isLockAvailable(def: LockDef): boolean {
    return this.isTierUnlocked(def.tier)
  }

  availableLocks(): readonly LockDef[] {
    return ALL_LOCKS.filter((d) => this.isTierUnlocked(d.tier))
  }

  /**
   * The lock the `Next lock` button on the results screen goes to, or null if there is not one.
   *
   * Opening a lock and then being returned to the bench to find the next one is a trip through a
   * menu to answer a question the game can already answer. So it answers it (D-121).
   *
   * **Unopened first, in bench order, wrapping.** "Next" has to mean forward: the next lock you
   * have not beaten, starting after this one and coming round the front if the rest of the tier is
   * done. Only when everything available is opened does it fall back to plain bench order, which
   * turns the button into "keep going" for somebody chasing ranks rather than dead-ending them.
   *
   * Never a locked tier — the button cannot be a way around the gate the bench enforces. And null
   * rather than a wrong answer in two cases: a lock that is not in the roster at all (a lesson, or
   * one of the player's own designs, where "next" has no meaning), and a roster with nothing else
   * available, where the button would just restart what you finished.
   */
  nextLockAfter(def: LockDef): LockDef | null {
    const here = ALL_LOCKS.findIndex((d) => d.slug === def.slug)
    if (here < 0) return null
    const rotated = [...ALL_LOCKS.slice(here + 1), ...ALL_LOCKS.slice(0, here)]
    const available = rotated.filter((d) => this.isTierUnlocked(d.tier))
    return available.find((d) => !this.hasOpened(d.slug)) ?? available[0] ?? null
  }

  /** Apply a finished attempt. Returns what it earned, or null when the lock was not opened. */
  completeAttempt(outcome: AttemptOutcome, today?: string): AttemptResult | null {
    if (!outcome.opened) return null
    const slug = outcome.lock.slug
    const previous = this.record(slug)
    const rank = rankEarned(outcome.seconds, outcome.lock.par, outcome.assist)
    const bestRank = bestOf(previous.bestRank, rank)

    const next: LockRecord = {
      opens: previous.opens + 1,
      bestTime:
        previous.bestTime === null ? outcome.seconds : Math.min(previous.bestTime, outcome.seconds),
      bestOversets:
        previous.bestOversets === null
          ? outcome.oversets
          : Math.min(previous.bestOversets, outcome.oversets),
      bestRank,
      challenges: [...previous.challenges],
    }
    this.data.records[slug] = next
    // The days you turned up, which is what the old `daily` field pretended to hold (D-090).
    if (today) this.data.playDays[today] = (this.data.playDays[today] ?? 0) + 1
    this.save()
    return {
      rank,
      bestRank,
      previousBest: previous.bestRank,
      improved: previous.bestRank === null || rank < previous.bestRank,
      firstOpen: previous.opens === 0,
      par: outcome.lock.par,
      challenges: [...outcome.challenges],
    }
  }

  /**
   * Evaluate all forty against the attempt that just finished and the save as it now stands,
   * unlock whatever is newly true, and hand the list back for the card stack to animate.
   *
   * Called *after* `completeAttempt`, deliberately: half the conditions are about totals, and
   * a total that does not yet include the open you just made is the wrong total.
   */
  claimAchievements(outcome: AttemptOutcome | null): Achievement[] {
    const earned = newlyEarned({ outcome, save: this.data })
    if (earned.length === 0) return []
    for (const a of earned) this.data.achievements.push(a.id)
    this.save()
    return earned
  }

  hasAchievement(id: string): boolean {
    return this.data.achievements.includes(id)
  }

  unlockAchievement(id: string): boolean {
    if (this.data.achievements.includes(id)) return false
    this.data.achievements.push(id)
    this.save()
    return true
  }

  updateSettings(patch: Partial<SaveData['settings']>): void {
    this.data.settings = { ...this.data.settings, ...patch }
    this.save()
  }

  /**
   * Bank a survived Gauntlet run's total — D-165. Returns whether it is a new personal best,
   * which is the one thing the tally screen wants to know. Called only for completed runs: a
   * fallen run banks nothing, and that rule lives in the run machine, not here.
   */
  noteGauntlet(difficulty: SaveData['settings']['assist'], total: number): boolean {
    const prev = this.data.gauntletBest[difficulty] ?? 0
    const isBest = total > prev
    if (isBest) {
      this.data.gauntletBest = { ...this.data.gauntletBest, [difficulty]: total }
      this.save()
    }
    return isBest
  }

  /**
   * Bank a finished five-minute run — D-205, the same shape as `noteGauntlet`. Returns
   * whether it is a new personal best at this difficulty, which is the one thing the summary
   * screen wants to know. Called only when the clock runs out: an abandoned run banks
   * nothing, and that rule lives in the run machine, not here.
   */
  noteStreakRun(difficulty: SaveData['settings']['assist'], run: StreakScore): boolean {
    const isBest = beatsScore(run, this.data.streakBest[difficulty])
    if (isBest) {
      this.data.streakBest = { ...this.data.streakBest, [difficulty]: run }
      this.save()
    }
    return isBest
  }

  get totalOpens(): number {
    let n = 0
    for (const r of Object.values(this.data.records)) n += r.opens
    return n
  }

  get distinctOpens(): number {
    let n = 0
    for (const r of Object.values(this.data.records)) if (r.opens > 0) n += 1
    return n
  }

  // ── Tools ─────────────────────────────────────────────────────────────────────────────

  /**
   * The stat block the simulation reads. Always the same one (D-088).
   *
   * Kept as a method rather than inlining `KIT` at the call sites so there is still exactly one
   * answer to "what is in the player's hands", which is where a per-lock or per-challenge tool
   * modifier would go if one is ever wanted again.
   */
  toolStats(): ToolStats {
    return KIT
  }

  /**
   * Save a lock the player built. Returns its index.
   *
   * The id is re-stamped from the **highest id already saved**, not from the array length, and that
   * is what makes deletion safe. Ids were `CUSTOM_ID_BASE + index`, so deleting the first of two
   * locks left the survivor holding id 10001 at index 0 — and the next lock saved, computing its id
   * from a length of 1, would have been minted as 10001 as well. Two locks, one slug, one shared
   * record of opens and best times. See DECISIONS D-101.
   */
  addCustomLock(def: LockDef): number {
    const id =
      this.data.customLocks.reduce((max, d) => Math.max(max, d.id), CUSTOM_ID_BASE - 1) + 1
    this.data.customLocks.push({ ...def, id, slug: slugFor(def.name, id) })
    this.save()
    return this.data.customLocks.length - 1
  }

  /**
   * Throw one away. Returns the lock that went, or null if the index was not one.
   *
   * The record it earned is left alone. A slug is unique for the life of the save now, so nothing
   * else can inherit it, and a player who deletes a lock by mistake and pastes the code back gets a
   * *new* lock with a clean record rather than one wearing somebody else's times.
   */
  removeCustomLock(index: number): LockDef | null {
    const [gone] = this.data.customLocks.splice(index, 1)
    if (!gone) return null
    this.save()
    return gone
  }

  get customLocks(): readonly LockDef[] {
    return this.data.customLocks
  }

  /**
   * Whether this lock can be attempted at all — which is now purely a question of tier.
   *
   * It used to also ask whether the player owned the specialist tool the family demanded. With one
   * kit there is no such question, and that is the point of D-088: a lock you cannot open is a lock
   * you cannot pick, not a lock you have not shopped for.
   */
  canAttempt(def: LockDef): boolean {
    return this.isTierUnlocked(def.tier)
  }

  /** Feathering arrives with Tier 3 (`CONTENT.md §2`). */
  get hasFeathering(): boolean {
    return this.isTierUnlocked(3)
  }

  // ── Challenges ────────────────────────────────────────────────────────────────────────

  /** Which of the opted-in challenge modifiers this attempt actually satisfied. */
  challengesMetBy(
    outcome: Pick<AttemptOutcome, 'seconds' | 'resets' | 'oversets' | 'lock'>,
    opted: readonly string[],
  ): string[] {
    return challengesMet(opted, {
      seconds: outcome.seconds,
      par: outcome.lock.par,
      resets: outcome.resets,
      oversets: outcome.oversets,
    })
  }

  /** Record challenge modifiers cleared on a lock, for the bench badges. */
  noteChallenges(slug: string, met: readonly string[]): void {
    if (met.length === 0) return
    const record = this.data.records[slug] ?? emptyRecord()
    const merged = new Set([...record.challenges, ...met])
    this.data.records[slug] = { ...record, challenges: [...merged].sort() }
    this.save()
  }
}
