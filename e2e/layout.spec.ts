/**
 * Every screen, on every phone, checked by the drawing itself — DECISIONS D-132.
 *
 * The mobile bugs in this project have all been found the same way: somebody looked at a
 * screenshot. That does not cover ten screens across twelve devices, and it never catches what
 * nobody thought to look at — `help` had text drawn through its own tab row on a Galaxy S24 for as
 * long as the screen existed, and the suite rendered `help` on exactly one viewport.
 *
 * So the drawing reports itself. `auditScreen` renders one frame with the probe on and returns
 * every glyph run's box; the rules in `src/render/audit.ts` then say whether anything is
 * unreadably small, on top of anything else, or off the edge of the stage.
 *
 * This is a **sweep**, not a demonstration: it is meant to fail loudly with a list, and the list is
 * the work queue.
 */

import { expect, test, type Page } from '@playwright/test'
import { bootGame, loadLock, renderOnce, setInput, setManual, stepTicks } from './harness'

/** The same roster the pick-screen matrix uses, so one device list serves both. */
export const PHONES: { name: string; width: number; height: number }[] = [
  { name: 'iphone-se3', width: 667, height: 375 },
  { name: 'iphone-13-mini', width: 629, height: 375 },
  { name: 'iphone-13', width: 664, height: 390 },
  { name: 'iphone-14-pro', width: 660, height: 393 },
  { name: 'iphone-15-pro-max', width: 739, height: 430 },
  { name: 'iphone-16-pro', width: 681, height: 402 },
  { name: 'iphone-17-pro-max', width: 763, height: 440 },
  { name: 'galaxy-s9-plus', width: 658, height: 320 },
  { name: 'galaxy-s24', width: 780, height: 360 },
  { name: 'galaxy-z-flip-7', width: 764, height: 360 },
  { name: 'galaxy-z-fold-7', width: 1016, height: 984 },
  { name: 'galaxy-tab-s9', width: 1024, height: 640 },
  /**
   * The extremes — DECISIONS D-135.
   *
   * "It must be accessible and usable under every single mobile screen." The list above is the
   * phones people actually hold; these are the edges of the space, and an edge is where a layout
   * that merely *fits* stops fitting. `iphone-se1` is the smallest landscape viewport a browser
   * still ships (0.296 stage scale is not the floor — 0.264 is), and the folds are the widest and
   * the squarest.
   */
  { name: 'iphone-se1', width: 568, height: 320 },
  { name: 'pixel-4a', width: 700, height: 340 },
  { name: 'galaxy-a14', width: 720, height: 340 },
  { name: 'pixel-9-pro-fold', width: 1080, height: 892 },
  { name: 'ipad-mini', width: 1024, height: 768 },
]

/** Two desktop sizes as well, so a fix for a phone cannot quietly break the full page. */
const DESKTOPS = [
  { name: 'laptop-1280', width: 1280, height: 800 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
]

type Finding = { kind: string; detail: string; value: number }

async function audit(page: Page): Promise<{ findings: Finding[]; drawn: number; scale: number }> {
  return page.evaluate(() => globalThis.__shearline!.auditScreen())
}

async function goto(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    globalThis.__shearline?.goto(n)
  }, name)
  await renderOnce(page)
}

/**
 * Put the game on a screen with something real on it.
 *
 * An empty screen passes every layout rule trivially, so each of these arranges for the state that
 * actually draws text: a lock loaded, a draft in the editor, an attempt finished.
 */
const SCREENS: { name: string; arrange: (page: Page) => Promise<void> }[] = [
  { name: 'menu', arrange: async (p) => goto(p, 'menu') },
  {
    /**
     * The menu **with trophies earned** — the same lesson as `codes-with-designs` (D-147).
     *
     * The shared fixture earns no achievements, and that is the one state the recent-trophy
     * column never draws in — so *Clean Sweep*'s 67-character condition ran through the button
     * stack for as long as the column existed, and the sweep never saw it. Clean Sweep goes in
     * the seed deliberately: it is the longest condition in the catalogue.
     */
    name: 'menu-with-trophies',
    arrange: async (p) => {
      await p.evaluate(() => {
        const h = globalThis.__shearline!
        h.setSave({
          ...h.getSave(),
          // Flawless carries the longest condition left after the D-164 cut (Clean Sweep, the
          // previous record-holder, went with it) — the seed exists to run the longest string
          // through the recent-trophy column.
          achievements: ['first-blood', 'flawless-tier', 'under-par', 'apprentice', 'journeyman'],
        })
      })
      await goto(p, 'menu')
    },
  },
  { name: 'bench', arrange: async (p) => goto(p, 'bench') },
  {
    // The wheels shelf — the bench's fifth page (D-167). Same card geometry as a tier page,
    // but its own strip button, its own note, and cards whose stats say "wheels".
    name: 'bench-wheels',
    arrange: async (p) => {
      await p.evaluate(() => globalThis.__shearline?.benchTier(0))
      await goto(p, 'bench')
    },
  },
  { name: 'tutorial', arrange: async (p) => goto(p, 'tutorial') },
  { name: 'trophies', arrange: async (p) => goto(p, 'trophies') },
  { name: 'codes', arrange: async (p) => goto(p, 'codes') },
  {
    /**
     * The codes screen **with a design of your own** — DECISIONS D-147.
     *
     * The fixture every case here shares has `customLocks: []`, and that is the one state the codes
     * page fits in: save a design and it grows a heading, a row of cards and their gaps, and the
     * roster's last row is drawn through the status line. Reported from play, invisible to a sweep
     * that had only ever seen an empty save.
     */
    name: 'codes-with-designs',
    arrange: async (p) => {
      await p.evaluate(() => {
        const h = globalThis.__shearline!
        const save = h.getSave()
        h.setSave({
          ...save,
          customLocks: [
            {
              id: 900,
              slug: 'my-first-lock-900',
              name: 'My First Lock',
              tier: 1,
              family: 'pin-tumbler',
              bitting: [3.4, 3.1, 2.8, 2.5, 3.4],
              pins: ['standard', 'spool', 'standard', 'serrated', 'standard'],
              springs: [1, 1, 1.22, 1, 0.8],
              toleranceQuality: 1,
              keyway: 'standard',
              par: 90,
            },
          ],
        })
      })
      await goto(p, 'codes')
    },
  },
  { name: 'editor', arrange: async (p) => goto(p, 'editor') },
  // The Lock dungeon's briefing, and a live floor mid-crawl — the crawler's two big layouts
  // (docs/DUNGEON.md). The end screens are audited by dungeon.spec.ts, which actually plays.
  { name: 'gauntlet', arrange: async (p) => goto(p, 'gauntlet') },
  {
    // The guide's first page: the goal at reading size (D-173, paged by D-196).
    name: 'gauntlet-guide',
    arrange: async (p) => {
      await goto(p, 'gauntlet')
      await p.evaluate(() => globalThis.__shearline!.dungeonGuide(true))
      await renderOnce(p)
    },
  },
  {
    // The bestiary page — 2×2 rows of portrait + grim story (D-194/196).
    name: 'gauntlet-guide-bestiary',
    arrange: async (p) => {
      await goto(p, 'gauntlet')
      await p.evaluate(() => globalThis.__shearline!.dungeonGuide(true, 1))
      await renderOnce(p)
    },
  },
  {
    // Sound & vision — every sense measured in words (D-196).
    name: 'gauntlet-guide-senses',
    arrange: async (p) => {
      await goto(p, 'gauntlet')
      await p.evaluate(() => globalThis.__shearline!.dungeonGuide(true, 2))
      await renderOnce(p)
    },
  },
  {
    // The kit — nine finds, one line each (D-196).
    name: 'gauntlet-guide-kit',
    arrange: async (p) => {
      await goto(p, 'gauntlet')
      await p.evaluate(() => globalThis.__shearline!.dungeonGuide(true, 3))
      await renderOnce(p)
    },
  },
  {
    // The key-or-pick choice over a live crawl (D-177).
    name: 'gauntlet-unlock',
    arrange: async (p) => {
      await p.evaluate(() => globalThis.__shearline!.startDungeonRun(4242, 'easy'))
      await p.evaluate(() => globalThis.__shearline!.dungeonForceUnlock())
      await renderOnce(p)
    },
  },
  {
    name: 'gauntlet-crawl',
    arrange: async (p) => {
      await p.evaluate(() => globalThis.__shearline!.startDungeonRun(4242, 'easy'))
      await p.evaluate(() => {
        const h = globalThis.__shearline!
        // Frozen and hand-clocked: strides are cadence-gated in real time (D-180), so
        // each move buys its clock before the next.
        h.dungeonFreeze(true)
        h.dungeonMove(1, 0)
        h.dungeonAdvance(0.25)
        h.dungeonMove(0, 1)
        h.dungeonAdvance(0.25)
        // The ticker at its longest — the widest sighting the bestiary can produce plus
        // the escape hint, so the sweep audits the column's bounds on every device.
        h.dungeonLog('the sentry sees you — RUN')
        h.dungeonLog('lose it: 15 tiles away, or 3.5s unseen')
      })
      await renderOnce(p)
    },
  },
  // The Lock streak's briefing (D-205): fresh, and with the best board fully populated at
  // its widest — four rows of three-digit scores beside the difficulty ladder.
  { name: 'streak', arrange: async (p) => goto(p, 'streak') },
  {
    name: 'streak-with-bests',
    arrange: async (p) => {
      await p.evaluate(() => {
        const h = globalThis.__shearline!
        h.setSave({
          ...h.getSave(),
          streakBest: {
            training: { score: 999, opens: 333 },
            easy: { score: 128, opens: 51 },
            medium: { score: 64, opens: 25 },
            hard: { score: 12, opens: 4 },
          },
        })
      })
      await goto(p, 'streak')
    },
  },
  {
    // The blitz pick (D-206): the centre band carries the big run countdown instead of the
    // rank letter, and the header carries the running score beside the dealt lock's name.
    name: 'streak-pick',
    arrange: async (p) => {
      await p.evaluate(() => globalThis.__shearline!.startStreakLock(4242, 1))
      await renderOnce(p)
    },
  },
  {
    // The between-locks breather (D-206): real run numbers, the frozen clock, the amber
    // "any key" line — reached the way play reaches it, through an actual open.
    name: 'streak-interlude',
    arrange: async (p) => {
      await p.evaluate(() => {
        const h = globalThis.__shearline!
        h.startStreakLock(4242, 1)
        h.solveCurrentLock()
      })
      await renderOnce(p)
    },
  },
  { name: 'settings', arrange: async (p) => goto(p, 'settings') },
  { name: 'help', arrange: async (p) => goto(p, 'help') },
  {
    name: 'pick',
    arrange: async (p) => {
      await setManual(p, true)
      await loadLock(p, 22, 5)
      await setInput(p, { chamber: 2, liftTarget: 1.2, tensionHeld: true, tensionLevel: 0.45 })
      await stepTicks(p, 90)
      await renderOnce(p)
    },
  },
  {
    // The wheel pack's pick screen (D-167): the padlock view, the shackle labels in the
    // footer, and the wheel key legend — none of which the cutaway pick audits.
    name: 'pick-wheels',
    arrange: async (p) => {
      await setManual(p, true)
      await loadLock(p, 39, 5)
      await setInput(p, { chamber: 1, liftTarget: 0.45, tensionHeld: true, tensionLevel: 0.4 })
      await stepTicks(p, 90)
      await renderOnce(p)
    },
  },
  {
    // …and the same screen the way every attempt actually STARTS: wrench off, so the rank
    // band's "hold Q" hints are drawn. The shackle ran through them for a whole version
    // because the fixture above holds tension and the band never showed (D-169).
    name: 'pick-wheels-start',
    arrange: async (p) => {
      await setManual(p, true)
      await loadLock(p, 39, 5)
      await stepTicks(p, 30)
      await renderOnce(p)
    },
  },
  {
    /**
     * The pause screen was never audited — DECISIONS D-135.
     *
     * The sweep listed the eight screens somebody navigates *to*, and pause is reached by pressing
     * a button mid-attempt, so it fell through the gap. It is drawn over a live pick screen with
     * its own panel and buttons, which is exactly the arrangement that goes wrong when type scales.
     */
    name: 'pause',
    arrange: async (p) => {
      await setManual(p, true)
      await loadLock(p, 22, 5)
      await setInput(p, { chamber: 2, liftTarget: 1.2, tensionHeld: true, tensionLevel: 0.45 })
      await stepTicks(p, 90)
      await goto(p, 'pause')
    },
  },
]

/** One line per finding, worst first, so a failure message is a work queue. */
function report(where: string, findings: Finding[]): string {
  const lines = findings.slice(0, 14).map((f) => `  [${f.kind}] ${f.detail}`)
  const more = findings.length > lines.length ? `\n  …and ${findings.length - lines.length} more` : ''
  return `${where}: ${findings.length} layout findings\n${lines.join('\n')}${more}`
}

/**
 * Both themes — DECISIONS D-135.
 *
 * Blueprint is a cosmetic alternate: the same layout in a dark palette, with the accents brightened
 * to clear contrast against a dark ground. "Cosmetic" is exactly why it needs checking — every
 * contrast figure in the game was tuned for Drafting, and a reversed palette is where a colour
 * chosen by eye stops working. It is a setting a player can turn on and then never leave.
 */
const THEMES = ['drafting', 'blueprint'] as const

/** Boot with a theme already chosen, so the first frame is drawn in it. */
async function useTheme(page: Page, theme: string): Promise<void> {
  await page.addInitScript((t) => {
    const raw = {
      version: 5,
      records: {},
      achievements: [],
      tutorial: [],
      playDays: {},
      customLocks: [],
      settings: { theme: t },
    }
    localStorage.setItem('shearline.save.v1', JSON.stringify(raw))
  }, theme)
}

for (const device of [...PHONES, ...DESKTOPS]) {
  for (const theme of THEMES) {
    test.describe(`${device.name} · ${theme}`, () => {
      test.use({
        viewport: { width: device.width, height: device.height },
        hasTouch: true,
        isMobile: device.width < 1100,
      })

      for (const screen of SCREENS) {
        test(`${screen.name} is laid out for ${device.name} in ${theme}`, async ({ page }) => {
          await useTheme(page, theme)
          const watcher = await bootGame(page, { frames: 3 })
          await screen.arrange(page)
          const result = await audit(page)
          expect(
            result.drawn,
            'the screen drew nothing — the audit would pass vacuously',
          ).toBeGreaterThan(3)
          expect(
            result.findings,
            report(`${screen.name} @ ${device.name} (${theme})`, result.findings),
          ).toEqual([])
          watcher.assertClean()
        })
      }
    })
  }
}
