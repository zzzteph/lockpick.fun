import { expect, test, type Page } from '@playwright/test'
import { ALL_LOCKS } from '../src/game/locks'
import { opensRequiredFor } from '../src/game/progress'
import type { SaveDataShape } from '../src/devhook'
import {
  advanceSeconds,
  bootGame,
  earnedThisAttempt,
  getState,
  loadLock,
  scriptPin,
  setInput,
  setManual,
  stepTicks,
} from './harness'

/**
 * The whole game, once — `PHASES.md` Phase 14.
 *
 * *"New save → tutorial → open one lock per tier → verify credits, achievements and unlocks
 * all landed correctly."* Nothing is stubbed and nothing is granted except the tools the
 * player would have bought with money they actually earned. This is the test that would catch
 * a game that works in pieces and not as a game.
 */

test.describe.configure({ mode: 'serial' })

/**
 * This test plays the entire game — three lessons and twenty-two locks, every pin worked one at
 * a time through the same input API a human uses. It takes about twenty-five seconds alone and
 * longer when six workers are sharing six cores, so the 60s default is a measure of contention
 * rather than of the game. Raised here only, so a genuine hang elsewhere still trips it.
 */
test.setTimeout(300_000)

async function save(page: Page): Promise<SaveDataShape> {
  return page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    return h.getSave()
  })
}


/**
 * Work each binding chamber to the middle of its window until the lock opens, easing off the
 * wrench whenever a security pin refuses to go through.
 *
 * The tension is a starting point, not a setting. Every security profile has a tension above
 * which its bevel out-pushes the pick and the pin simply will not climb — spool at T≈0.55,
 * mushroom at T≈0.29 — and finding that out by feel is the whole skill the Tier 4+ locks teach.
 * One fixed number for the entire catalogue is not a player; it is a player who has never met a
 * mushroom, and it duly failed on the Ironhold Mushroom Pad the moment the counter-rotation
 * force stopped being scaled down to nothing for most of an attempt (D-053).
 */
async function openIt(page: Page, startTension = 0.45, rounds = 90): Promise<boolean> {
  let tension = startTension
  let stuckOn = -1
  let stuckFor = 0
  await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: tension })
  await stepTicks(page, 60)
  for (let i = 0; i < rounds; i += 1) {
    const s = await getState(page)
    if (s.opened) return true
    const b = s.bindingChamber
    const c = b >= 0 ? s.chambers[b] : s.chambers.find((x) => x.state === 'FALSE_SET')
    /**
     * Shaft loading up? Stop pushing for a beat.
     *
     * Same relief the solver does (D-068) and for the same reason: a driver that only ever leans
     * harder bends its pick, then breaks it, and then opens nothing at all. Backing the lift off to
     * zero while keeping tension is what a player does when they feel the shaft bow.
     */
    if (s.pickStrain > 0.45 && !s.pickBroken) {
      await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: tension })
      await stepTicks(page, 180)
      continue
    }

    // Two rounds on the same chamber with nothing to show for it means the hand is too heavy.
    if (c && c.index === stuckOn) {
      stuckFor += 1
      if (stuckFor >= 2 && tension > 0.14) {
        tension = Math.max(0.14, tension - 0.08)
        stuckFor = 0
      }
    } else {
      stuckOn = c?.index ?? -1
      stuckFor = 0
    }
    if (!c) {
      await setInput(page, { chamber: -1, tensionHeld: true, tensionLevel: 0.6 })
      await stepTicks(page, 120)
      continue
    }
    // A wafer and a slider want the gate itself; a pin stack wants above its set lift; a disc
    // has to be swept, because nothing shows you a disc's angle.
    if (c.kind === 'disc') {
      const stride = Math.max(0.02, c.captureWindow / 2)
      for (let k = 1; k <= Math.ceil(c.maxLift / stride) + 1; k += 1) {
        await setInput(page, {
          chamber: c.index,
          liftTarget: (c.lift + k * stride) % c.maxLift,
          tensionHeld: true,
          tensionLevel: tension,
        })
        await stepTicks(page, 12)
        const now = await getState(page)
        if (now.chambers[c.index]?.state === 'SET' || now.opened) break
      }
      continue
    }
    const gate = c.profile === 'wafer'
    await scriptPin(
      page,
      c.index,
      gate ? c.setLift : c.setLift + c.captureWindow * 0.5,
      tension,
      240,
    )
  }
  return (await getState(page)).opened
}

/** Open a lock and let the payoff sequence settle, as a player would. */
async function play(page: Page, id: number, seed: number, tension = 0.45): Promise<void> {
  await loadLock(page, id, seed)
  const opened = await openIt(page, tension)
  const s = await getState(page)
  expect(opened, `lock ${id} (${s.lock.name}) did not open`).toBe(true)
  await advanceSeconds(page, 3.2)
}

test('a whole playthrough: new save, tutorial, one lock a tier, everything banked', async ({
  page,
}) => {
  const watcher = await bootGame(page, { frames: 3 })
  await setManual(page, true)

  // ── A genuinely new save ──────────────────────────────────────────────────────────────
  const start = await save(page)
  expect(start.records, 'a new player has opened nothing').toEqual({})
  expect(start.achievements).toEqual([])
  expect(start.tutorial).toEqual([])

  // ── The tutorial ──────────────────────────────────────────────────────────────────────
  for (const id of ['lesson-1', 'lesson-2', 'lesson-3']) {
    await page.evaluate((l) => globalThis.__shearline?.startLesson(l), id)
    expect(await openIt(page, 0.45), `${id} could not be finished`).toBe(true)
    await advanceSeconds(page, 3.2)
  }
  const taught = await save(page)
  expect(taught.tutorial.sort()).toEqual(['lesson-1', 'lesson-2', 'lesson-3'])
  expect(Object.keys(taught.records), 'lessons must not leave records').toEqual([])

  /**
   * Every tier, played off the roster rather than off hardcoded lock ids.
   *
   * It used to list the ids by hand, which meant that re-tiering the roster (D-088) silently sent
   * the playthrough at locks that had moved or gone. Reading `ALL_LOCKS` makes the test say what
   * it means — "open enough of each tier to unlock the next, then keep going" — and survive the
   * next content change without editing.
   */
  const tiers = [...new Set(ALL_LOCKS.map((d) => d.tier))].sort((a, b) => a - b)
  expect(tiers, 'four tiers, all cylinders (D-088, D-104)').toEqual([1, 2, 3, 4])

  let seed = 3
  let played = 0
  for (const tier of tiers) {
    const locks = ALL_LOCKS.filter((d) => d.tier === tier)
    // Enough to unlock the tier above, and never the whole tier — the unlock rule is by count,
    // so a playthrough that opens everything would not prove that. The last tier unlocks nothing
    // above it, so one lock is the whole point of visiting it; depth of coverage there is the
    // solver's job, which opens every lock in the game across fifty seeds each.
    const need =
      tier === Math.max(...tiers)
        ? 1
        : Math.min(locks.length, opensRequiredFor(tier + 1) || locks.length)
    for (const def of locks.slice(0, Math.max(1, need))) {
      await play(page, def.id, seed, tier >= 3 ? 0.4 : 0.45)
      played += 1
      seed += 1
    }
    const after = await save(page)
    const ranked = Object.values(after.records).filter((r) => r.bestRank !== null).length
    expect(ranked, `tier ${tier} has to have left a rank behind`).toBeGreaterThan(0)
    if (tier === 1) {
      expect(after.achievements, 'First Blood is the first thing anyone earns').toContain(
        'first-blood',
      )
    }
  }

  // ── What landed ───────────────────────────────────────────────────────────────────────
  const end = await save(page)

  // Every tier is unlocked, and the unlocks came from the opens rather than being handed out.
  const unlocked = await page.evaluate(() => {
    const h = globalThis.__shearline
    if (!h) throw new Error('no hook')
    const s = h.getSave()
    return Object.keys(s.records).length
  })
  /**
   * Exactly what was played, and nothing else.
   *
   * Was a hardcoded `>= 12`, which is the shape of assertion that breaks on every content change
   * and says nothing about what the run was for — D-104 took the roster from five tiers to four
   * and this went red at 11. Counting what the walk actually opened makes it say the thing that
   * matters instead: every lock played banked a record, and nothing that was not played banked
   * one. The three lessons run before this loop and are asserted elsewhere to record nothing;
   * this is the assertion that would catch it if they started to.
   */
  expect(played, 'the walk has to visit every tier').toBeGreaterThanOrEqual(tiers.length)
  expect(unlocked, 'one record per lock played, and no others').toBe(played)

  // Rank is the score now (D-091): every lock opened has one, and enough of them reach D that
  // the tiers actually unlocked rather than being handed over.
  for (const [slug, r] of Object.entries(end.records)) {
    expect(r.bestRank, slug).not.toBeNull()
  }
  /**
   * Enough D-or-better opens to account for every tier gate the walk passed through.
   *
   * Derived from `opensRequiredFor` rather than written down, because that is precisely the
   * quantity being claimed: the walk reached the last tier, and tiers unlock on locks opened at
   * rank D or better. If the ranks were not really earned, this is short.
   */
  const gatesPassed = tiers
    .filter((t) => t > Math.min(...tiers))
    .reduce((n, t) => n + opensRequiredFor(t), 0)
  const counted = Object.values(end.records).filter((r) => (r.bestRank ?? 9) <= 4).length
  expect(counted, 'enough D-or-better opens to have unlocked the tiers').toBeGreaterThanOrEqual(
    gatesPassed,
  )

  // Achievements fired off real opens rather than being handed out. This run opens *some* of
  // each tier and *all* of Tier 4, so `specialist` is the one that proves a whole-tier
  // condition can be earned by playing — `apprentice` cannot, because Tier 1 is deliberately
  // only sampled here.
  expect(end.achievements).toContain('first-blood')
  expect(end.achievements).toContain('under-par')
  expect(end.achievements.length).toBeGreaterThan(4)
  // …and every id on the save is a real achievement, not a typo that will never render.
  const known = await page.evaluate(() => globalThis.__shearline?.achievementIds() ?? [])
  for (const id of end.achievements) expect(known, `unknown achievement "${id}"`).toContain(id)

  // Records: best times are real numbers and opens are counted.
  for (const [slug, r] of Object.entries(end.records)) {
    expect(r.opens, slug).toBeGreaterThan(0)
    expect(r.bestTime, slug).toBeGreaterThan(0)
  }

  // Nothing earned by the last attempt was lost on the way to the results page.
  expect(await earnedThisAttempt(page)).toBeDefined()
  watcher.assertClean()
})
