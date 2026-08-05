/**
 * The screens — GAME_DESIGN.md §9, ART_DIRECTION.md §7.
 *
 * Menu, bench, results, settings and pause, all drawn on the same canvas in the same
 * drafting style: a 24px margin, a hairline border, a title top-left, a status line along the
 * bottom. Every screen looks like a page from the same manual.
 */

import { ACHIEVEMENTS } from '../game/achievements'
import { ASSIST_BLURB, ASSIST_MODES, ASSIST_MULTIPLIER } from '../game/challenges'
import {
  MAX_TOLERANCE,
  MIN_TOLERANCE,
  SPRING_CHOICES,
  draftProblem,
  draftToLockDef,
  windowWidth,
  type Draft,
} from '../game/editor'
import { ALL_LOCKS, chambersOf } from '../game/locks'
import { decodeLock, encodeLock, formatCode, shareProblem, shareableCode } from '../game/sharecode'
import { countsForTier, effectivePar, letterFor } from '../game/ranks'
import type { AttemptOutcome, AttemptResult, Progress } from '../game/progress'
import { LESSONS } from '../game/tutorial'
import { hatchRect, label, paragraph, text } from '../render/draw'
import { drawTrophyArt } from '../render/trophyart'
import { STROKE, TYPE, alpha, font, readableAccents, type Palette } from '../render/palette'
import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  snapX,
  snapY,
  type Viewport,
  isCompact,
  touchFloorFor,
  typeFor,
} from '../render/viewport'
import { MAX_CHAMBERS, MAX_KEY_PIN, MIN_CHAMBERS, PROFILES, type KeywayGrade } from '../sim'
import type { LockDef, SettingsData } from './shellTypes'
import {
  type Ui,
  boxForCaption,
  button,
  captionWidth,
  minControlH,
  cardFrame,
  panel,
  segmented,
  slider,
  toggle,
  type Rect,
} from './widgets'

export type ScreenName =
  | 'menu'
  | 'bench'
  | 'tutorial'
  | 'pick'
  | 'results'
  | 'settings'
  | 'pause'
  | 'trophies'
  | 'editor'
  | 'codes'
  | 'help'

const MARGIN = 24

/** The three answers to "which page?" — the default first, then the two overrides (D-160). */
const INTERFACE_MODES = ['auto', 'full', 'compact'] as const

export interface ShellActions {
  goto(screen: ScreenName): void
  startLock(def: LockDef): void
  resume(): void
  restart(): void
  abandon(): void
  /** Begin one of the lessons from `GAME_DESIGN.md §10`, extended since. */
  startLesson(id: string): void
  updateSettings(patch: Partial<SettingsData>): void
  exportSave(): void
  importSave(): void
  toggleChallenge(id: string): void
  /** Flip whether the next lock started from the bench is a study run (D-092). */
  toggleInspect(): void
  // ── The lock editor (D-080) ──
  editorChamberCount(n: number): void
  editorDepth(index: number, depth: number): void
  editorCyclePin(index: number): void
  editorCycleSpring(index: number): void
  editorTolerance(q: number): void
  editorKeyway(k: KeywayGrade): void
  editorFocusName(on: boolean): void
  editorLoad(index: number): void
  /**
   * Open any lock in the editor as a draft — the roster included (D-100).
   *
   * `editorLoad` takes an index into the player's own saved locks, which is no use to a page that
   * lists every lock in the game. Loading a *copy*, so opening a roster lock to see how it is built
   * cannot alter the roster lock.
   */
  editDef(def: LockDef): void
  /** Copy the current draft's share code to the clipboard (D-093). */
  editorCopyCode(): void
  /** Read a share code from the clipboard and load it into the draft. */
  editorPasteCode(): void
  /**
   * Put a string on the clipboard and say so along the bottom of the screen.
   *
   * `what` is the human name of the thing — "the code for Halberd Deadbolt" — because a status line
   * reading only the sixteen characters back at you does not confirm anything (D-099).
   */
  copyText(value: string, what: string): void
  // ── The share-code box on the codes screen (D-101) ──
  /** Put keystrokes into the code box, or stop. */
  codeFocus(on: boolean): void
  /** Empty the box and keep typing. */
  codeClear(): void
  /** Fill the box from the clipboard — it does not commit anything on its own. */
  codePaste(): void
  /** Decode whatever is in the box and add that lock to the player's own. */
  codeSubmit(): void
  /** Prime a lock for deletion, or clear whatever was primed. One at a time. */
  armDelete(slug: string | null): void
  deleteCustomLock(index: number): void
  /** Step the codes screen through the player's own locks, six at a time. */
  codesPageBy(delta: number): void
  /** Page the shareable roster on the desktop codes screen — DECISIONS D-147. */
  rosterPageBy(delta: number): void
  /** Step the trophy case a page at a time — compact only, where it pages (D-129). */
  trophyPageBy(delta: number): void
  /** Show a tier on the bench. The bench draws one at a time (D-102). */
  benchTier(tier: number): void
  /** Show one of the help screen's three pages (D-103). */
  helpPage(page: number): void
  /** Open the repository in a new tab. */
  openRepo(): void
  /** Open a pre-filled GitHub issue for whatever is on screen (D-102). */
  reportIssue(): void
  editorTest(): void
  editorSave(): void
  editorReset(): void
}

export interface ShellContext {
  vp: Viewport
  p: Palette
  ui: Ui
  progress: Progress
  actions: ShellActions
  /** Filled in on the results screen. */
  outcome?: AttemptOutcome
  result?: AttemptResult | null
  /**
   * Seconds since the results screen was entered — drives the rank stamp's landing (D-154).
   * Absent or large means "settled": the app passes a large value under reduced motion.
   */
  resultsAge?: number
  /**
   * True while a lock is mid-attempt — settings and help reached from the pause panel offer the
   * way back to it (D-157). Without this, pausing to flip a setting stranded the attempt: the
   * session survived the trip, but no button led back.
   */
  pickActive?: boolean
  /** Message shown along the bottom of whichever screen is up. */
  status?: string
  /** Challenge modifiers the player has opted into for the next attempt. */
  challenges?: readonly string[]
  /** True when the next lock picked from the bench will be an inspection (D-092). */
  inspectNext?: boolean
  /** The lock being built, on the editor screen (D-080). */
  draft?: Draft
  /** True while keystrokes are going into the draft's name instead of anywhere else. */
  editingName?: boolean
  // ── The codes screen (D-101) ──
  /** What is typed into the share-code box. */
  codeEntry?: string
  /** True while keystrokes are going into that box. */
  codeFocus?: boolean
  /** Whether this device can vibrate — the settings screen says so when it cannot (D-131). */
  hapticsSupported?: boolean
  /** Which page of the player's own locks is showing. */
  codesPage?: number
  /** Which page of the roster the desktop codes screen is showing. */
  rosterPage?: number
  /** Which page of the trophy case is showing on a phone. */
  trophyPage?: number
  /** Which tier the bench is showing. Undefined means "the deepest one they have reached". */
  benchTier?: number
  /** Which of the help screen's three pages is showing (D-103). */
  helpPage?: number
  /** Slug of the lock whose delete is primed, if any. */
  armedDelete?: string | null
}

// ── Shared chrome ───────────────────────────────────────────────────────────────────────

/**
 * The chrome every shell screen sits in — border, title, status line, and the report link.
 *
 * It takes the whole context now rather than `(vp, p, …)` because it grew a *widget*: the
 * "report an issue" link in the bottom-right corner, which needs the `Ui` to be hit-tested and the
 * actions to open a tab. One frame, one place, so the link is on every page the player can be on
 * when they notice something wrong. See DECISIONS D-102.
 */
export function screenFrame(c: ShellContext, title: string, status: string): void {
  const { vp, p, ui, actions } = c
  const { ctx } = vp
  ctx.save()
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = p.rule
  ctx.strokeRect(
    snapX(vp, MARGIN, STROKE.hairline),
    snapY(vp, MARGIN, STROKE.hairline),
    LOGICAL_WIDTH - MARGIN * 2,
    LOGICAL_HEIGHT - MARGIN * 2,
  )
  ctx.restore()
  label(ctx, title, MARGIN + 28, MARGIN + 52, {
    font: font(typeFor(vp, TYPE.title)),
    size: typeFor(vp, TYPE.title),
    color: p.ink,
  })
  /*
   * The status line and the report link swap corners on a phone — DECISIONS D-132.
   *
   * The link moved to the bottom-left to get an outward link out of the right thumb's rest, and
   * that is where this caption has always sat. One of them has to move, and the caption is the one
   * that can: it is read, not pressed, so it does not care which corner it is in, while the link
   * being under a thumb was the entire point of moving it.
   */
  const statusRight = isCompact(vp)
  text(
    ctx,
    status,
    statusRight ? LOGICAL_WIDTH - MARGIN - 28 : MARGIN + 28,
    LOGICAL_HEIGHT - MARGIN - 24,
    {
      font: font(typeFor(vp, TYPE.dimension)),
      color: p.inkLight,
      ...(statusRight ? { align: 'right' as const } : {}),
    },
  )

  /**
   * Report an issue, in the corner of every page — as a **button**, not a caption.
   *
   * It was 17px grey type on a grey rule, indistinguishable from the status line beside it, and
   * asked to be made more visible. A thing you can press is drawn as a thing you can press: the
   * same bordered frame every other button on the page uses.
   *
   * It opens GitHub's new-issue form with the screen, the lock and the build already written into
   * the body — the context a reporter cannot be expected to think of and the game already has. The
   * player supplies the only part that is actually theirs, which is what went wrong.
   */
  const report = reportLink(vp)
  const reportSize = typeFor(vp, TYPE.body)
  if (!outwardLinksOn(vp, title)) return
  const linkState = ui.widget(report)
  cardFrame(vp, p, report, linkState, false)
  label(
    ctx,
    'report an issue ↗',
    report.x + report.w / 2,
    report.y + report.h / 2 + reportSize * 0.36,
    {
      font: font(reportSize),
      size: reportSize,
      color: linkState.hovered ? readableAccents(p).teal : p.ink,
      align: 'center',
    },
  )
  // Keyboard only: a mouse click is handled synchronously in the pointer event so the browser
  // treats the tab as user-opened (D-103), and never reaches the widget layer.
  if (linkState.activated) actions.reportIssue()
}

/**
 * The two outward links, as fixed rectangles.
 *
 * Exported because they are hit-tested twice: here, for drawing and for keyboard focus, and again
 * in the pointer event itself, which is the only place a browser will let a tab be opened (D-103).
 */
/**
 * Both grow with the type they carry — DECISIONS D-132.
 *
 * They were fixed 262x40 and 302x40 boxes holding a caption that scales, so on a phone `button`'s
 * shrink-to-fit ground both labels down to about seven CSS px. Functions rather than constants
 * because the size depends on the viewport, and both are hit-tested in two places — here for
 * drawing and focus, and again inside the pointer event, which is the only place a browser will
 * open a tab (D-103). One definition each, taking the viewport, keeps those two in step.
 */
/**
 * Bottom-**left** on a phone, not bottom-right — DECISIONS D-132.
 *
 * Held in landscape, a phone puts the right thumb in the bottom-right corner: it is the most
 * reachable spot on the screen, and it was occupied by an **outward link** that leaves the game and
 * opens a browser tab. Every screen's real content is also laid out from the left, so on a phone
 * the grid grows toward that corner and finishes flush against it — on the codes page the roster's
 * COPY buttons and this link shared a hit band, and the widget layer has no z-order, so one tap
 * would copy a code and open GitHub at the same time.
 *
 * The bottom-left is the one corner nothing else wants: the status line is there, and it is a
 * caption rather than a control. On a full page it stays where it has always been.
 */
/**
 * Whether the outward links are drawn at all on this screen — DECISIONS D-135.
 *
 * `report an issue` was on every framed screen and `fork me on GitHub` on the menu, both as
 * full-size buttons, because on a full page a link in a corner costs nothing. On a phone a corner
 * *is* the page: the report button is the largest control on Trophies, and the fork button is the
 * largest thing on the menu after the destinations — and both of them **leave the game**.
 *
 * On a phone the report link keeps the two screens somebody is on when they want it — the title
 * screen and Settings — and the fork link, which is for developers, goes entirely. Exported so the
 * pointer-event path that actually opens the tab (D-103) cannot disagree with what is drawn.
 */
export function outwardLinksOn(vp: Viewport, title: string): boolean {
  if (!isCompact(vp)) return true
  return title === 'Shear line' || title === 'Settings'
}

export function reportLink(vp: Viewport): Rect {
  const box = boxForCaption(vp, 'report an issue ↗', typeFor(vp, TYPE.body), { w: 262, h: 40 })
  const y = LOGICAL_HEIGHT - MARGIN - 14 - box.h
  if (!isCompact(vp)) return { x: LOGICAL_WIDTH - MARGIN - 28 - box.w, y, ...box }
  return { x: MARGIN + 28, y, ...box }
}

export function forkLink(vp: Viewport): Rect {
  const box = boxForCaption(vp, 'fork me on GitHub ↗', typeFor(vp, TYPE.body), { w: 302, h: 40 })
  return { x: LOGICAL_WIDTH - MARGIN - 28 - box.w, y: MARGIN + 34, ...box }
}

/**
 * Navigation, in the same corner on every screen.
 *
 * It used to be wherever each screen had room: the bench and the codes page put it top-right,
 * settings bottom-right, trophies bottom-left, the editor in with its own footer buttons. Reported
 * as *"I want the menu and back buttons in one place — right now they are in different parts of the
 * screen on every page."* Which is the correct complaint: navigation is not content, and a control
 * that moves is a control you have to look for every time.
 *
 * Laid out **right to left**, so the way out is always the rightmost button and always in the same
 * place, whatever else a screen puts beside it. See DECISIONS D-103.
 */
/**
 * The nav row, sized from its own captions — DECISIONS D-132.
 *
 * It was a fixed 150x40 on every screen in the game, which is 54x14 CSS px on a phone: `button`
 * shrank each caption to half the box height and drew `MENU` at seven pixels. Reported as *"the
 * buttons appeared on right top corner are extra small"*, and it was the single most repeated
 * finding in the layout sweep because this row is on eight screens.
 *
 * Each button now takes the width its own word needs, so `SHARE CODES` and `MENU` are no longer
 * the same size — which is also the honest look for a row of links.
 */
function navBar(c: ShellContext, items: readonly (readonly [string, () => void])[]): void {
  const { vp, p, ui } = c
  const size = typeFor(vp, TYPE.body)
  const gap = isCompact(vp) ? 14 : 20
  const boxes = items.map(([caption]) => boxForCaption(vp, caption, size, { w: 150, h: 40 }))
  const h = boxes.reduce((m, b) => Math.max(m, b.h), 0)
  const total = boxes.reduce((sum, b) => sum + b.w, 0) + gap * Math.max(0, items.length - 1)
  // Laid out left to right from a right-aligned block, so tab order still matches reading order.
  let x = LOGICAL_WIDTH - MARGIN - 28 - total
  items.forEach(([caption, go], i) => {
    const box = boxes[i] ?? { w: 150, h }
    if (button(vp, p, ui, { x, y: MARGIN + 24, w: box.w, h }, caption)) go()
    x += box.w + gap
  })
}

function creditLine(progress: Progress): string {
  // Was a credit balance. Ranks are the score now (D-091), so the line says how far along the
  // ladder the bench actually is rather than how much dead money is in it.
  const counted = ALL_LOCKS.filter((d) => countsForTier(progress.record(d.slug).bestRank)).length
  return `${counted}/${ALL_LOCKS.length} locks ranked D or better`
}

// ── Menu ────────────────────────────────────────────────────────────────────────────────

export function drawMenu(c: ShellContext): void {
  const { vp, p, ui, progress, actions } = c
  screenFrame(c, 'Shear line', c.status ?? creditLine(progress))
  const { ctx } = vp

  /**
   * The subtitle clears the title by its **own ascent**, not by a literal 32px — DECISIONS D-146.
   *
   * `MARGIN + 84` was 32px under the title's baseline, which is fine at the desktop face and 3px
   * short on the smallest phone: `typeFor` scales this line up to stay legible (D-135), and a
   * scaled-up line has a taller ascent to fit in the same gap. It was under by exactly the amount
   * the shipped typeface is taller than the one this was spaced against.
   */
  const subtitle = typeFor(vp, TYPE.body)
  label(ctx, 'a lockpicking simulator', MARGIN + 28, MARGIN + 52 + Math.max(32, subtitle + 8), {
    font: font(subtitle),
    size: subtitle,
    color: p.inkLight,
  })

  /**
   * Fork me on GitHub — top right, where that has lived on every project page since 2008.
   *
   * Drawn rather than a ribbon graphic: the game has no images and this screen has a house style,
   * and a corner ribbon in someone else's palette would be the only bitmap in the build.
   */
  const fork = forkLink(vp)
  const forkSize = typeFor(vp, TYPE.body)
  if (!isCompact(vp)) {
  const forkState = ui.widget(fork)
  cardFrame(vp, p, fork, forkState, false)
  label(ctx, 'fork me on GitHub ↗', fork.x + fork.w / 2, fork.y + fork.h / 2 + forkSize * 0.36, {
    font: font(forkSize),
    size: forkSize,
    color: forkState.hovered ? readableAccents(p).teal : p.ink,
    align: 'center',
  })
  // Keyboard only — see `reportLink` (D-103).
  if (forkState.activated) actions.openRepo()
  }

  /**
   * Taller, wider buttons on a phone, and the row of them centred in what is left.
   *
   * The menu is the first thing anybody sees and on a 390px-tall landscape phone it was six 56px
   * buttons of 21px type — about 20px and 8px once the stage is scaled, which is below the size a
   * thumb can hit reliably, never mind read. Asked for as *"menu, when the device is mobile, must
   * be more mobile friendly"*.
   *
   * The button stack is the whole screen on a phone: the side columns go (see below), so the row
   * can take the width it needs and start higher up. See DECISIONS D-122.
   */
  const compact = isCompact(vp)
  /**
   * On a phone the stack becomes a grid, and the buttons are sized from the finger floor (D-131).
   *
   * 84 tall is thirty CSS px on a mid-sized phone — a third of a fingertip. It cannot simply be
   * raised: seven buttons at a genuine 44 CSS px need 1163 logical px on the smallest phone in the
   * matrix, and the stage is 1080. A single column and a thumb do not both fit, so the column goes.
   *
   * Two columns, the primary action spanning both. `touchFloorFor` rather than a constant because
   * the floor *is* device-dependent — 100 logical px on a 17 Pro Max, 149 on a Galaxy S9+ — and a
   * fixed number would be right on one phone by luck. Clamped so a very small viewport cannot eat
   * the title and a large one cannot produce a button the size of a door.
   */
  const w = compact ? 760 : 380
  // Capped at 140, not 150: the Tutorial entry made the compact grid four rows of entries
  // under the primary, and at 150 the last row's bottom lands at 1082 on a 1080 stage.
  const h = compact ? Math.round(Math.min(Math.max(touchFloorFor(vp), 96), 140)) : 56
  const x = (LOGICAL_WIDTH - w) / 2
  const y = compact ? 236 : 320
  // Compact `gap` is the air *between* buttons; the flat layout's is a pitch. Hence `pitch` below.
  const gap = compact ? 24 : 74
  const pitch = compact ? h + gap : gap
  const colW = compact ? (w - gap) / 2 : w
  /** The i-th non-primary entry. Two across on a phone, one under the next everywhere else. */
  const entry = (i: number): Rect =>
    compact
      ? {
          x: x + (i % 2) * (colW + gap),
          y: y + pitch * (1 + Math.floor(i / 2)),
          w: colW,
          h,
        }
      : { x, y: y + pitch * (1 + i), w, h }

  // A brand-new player is sent to the tutorial, not to a wall of thirty-five locks. The
  // game is unusually unforgiving of not knowing what tension is for, and "Start picking"
  // dropping someone straight onto the bench was an invitation to bounce off it. To the
  // tutorial *screen* rather than straight into lesson one, so the course is visible as a
  // course — four cards, in order — before the first line of it starts talking.
  const taught = progress.data.tutorial.length > 0
  const hasProgress = progress.totalOpens > 0
  const primaryCaption = !taught ? 'Start the tutorial' : hasProgress ? 'Continue' : 'Start picking'
  if (button(vp, p, ui, { x, y, w, h }, primaryCaption, { primary: true })) {
    actions.goto(taught ? 'bench' : 'tutorial')
  }
  /**
   * Beside the button it is about — on the **left**, which is the side with nothing on it.
   *
   * It sat one row down next to Bench, where it read as a promise about the bench (D-099), then to
   * the right of the primary button, where at the larger face it ran 500px straight through the
   * "what this is" column (D-102). The left half of this screen is empty; right-aligning against
   * the button stack puts it beside its button with nothing to collide with.
   */
  if (!taught && !compact) {
    label(ctx, 'five minutes, and the rest of the game makes sense', x - 24, y + h / 2 + 6, {
      font: font(typeFor(vp, TYPE.dimension)),
      size: typeFor(vp, TYPE.dimension),
      color: p.inkLight,
      align: 'right',
    })
  }
  if (button(vp, p, ui, entry(0), 'Bench')) actions.goto('bench')
  // Beside the bench, because it is the other place a lock gets picked — and once "Continue"
  // is the primary, this button is the only way back to the lessons for a taught player.
  if (button(vp, p, ui, entry(1), 'Tutorial')) actions.goto('tutorial')
  if (button(vp, p, ui, entry(2), 'Trophies')) actions.goto('trophies')
  // Between the trophies and the settings on purpose: it is a place to *go*, not a preference.
  if (button(vp, p, ui, entry(3), 'Share codes')) actions.goto('codes')
  /**
   * The editor, which had no way in from here (D-128).
   *
   * It was reachable only from the nav row on the bench and the codes page — fine on a desktop
   * where those rows are always in view, and on a phone it meant a whole screen of the game was
   * findable only by guessing which other screen linked to it. Reported as *"no editor at the
   * menu"*. It sits after Share codes because the two belong together: build one, then send it.
   */
  if (button(vp, p, ui, entry(4), 'Editor')) actions.goto('editor')
  if (button(vp, p, ui, entry(5), 'Help')) actions.goto('help')
  if (button(vp, p, ui, entry(6), 'Settings')) actions.goto('settings')

  /*
   * A domain used to be drawn here and on the codes screen. It named a host nobody had registered,
   * which makes it worse than nothing: a made-up address on a title screen is a promise the build
   * cannot keep, and it invited players to type it. `src/game/site.ts` went with it. When there is
   * a real address, it is one constant and two call sites. See DECISIONS D-101.
   */

  /**
   * The last few trophies, down the right of the menu.
   *
   * The trophy room is a whole screen you have to go and look at, so unless you go looking, an
   * achievement fires once during the open sequence and is then never mentioned again. Putting the
   * most recent ones on the way *in* is what makes them feel like a record of your own play rather
   * than a list somebody else wrote. Newest first, because that is the one you just earned.
   */
  /**
   * Both side columns go on a phone (D-122).
   *
   * The button stack takes the full width there, so "what this is" and the recent-trophy list
   * have nowhere left to be — and at the compact scale three sentences of blurb beside six
   * buttons is the crowding the request was about. The blurb is on the page they came from and
   * the trophies have a screen of their own.
   */
  const earned = progress.data.achievements
  if (compact) {
    // Nothing beside the buttons.
  } else if (earned.length === 0) {
    /**
     * What the game *is*, on the one screen where somebody might not know yet.
     *
     * The right half of the title screen was empty until the player had earned a trophy, which is
     * exactly backwards: the person who needs telling is the one who has never played. Three
     * sentences, replaced by their own trophies the moment there are any (D-099).
     */
    const bx = LOGICAL_WIDTH - MARGIN - 520
    label(ctx, 'what this is', bx, 320, {
      font: font(typeFor(vp, TYPE.dimension)),
      size: typeFor(vp, TYPE.dimension),
      color: p.inkLight,
    })
    paragraph(
      ctx,
      'A plug will not turn until every pin is caught on the shear line. Under torque it pinches ' +
        'one pin at a time: find that one by feel, and lift it until it catches.',
      bx,
      356,
      {
        font: font(typeFor(vp, TYPE.body)),
        color: p.ink,
        maxWidth: 480,
        lineHeight: 30,
        maxLines: 5,
      },
    )
    paragraph(
      ctx,
      'Nothing is random. Every lock is the same lock every time, so what improves is you.',
      bx,
      516,
      {
        font: font(typeFor(vp, TYPE.body)),
        color: p.inkLight,
        maxWidth: 480,
        lineHeight: 30,
        maxLines: 3,
      },
    )
  }
  /**
   * The recent-trophy list is a side column too, and it was missed — DECISIONS D-128.
   *
   * D-122 guarded the "what this is" blurb with `if (compact) {}` and left this as a **separate**
   * `if` below it, so on a phone it carried on drawing: right-aligned at x=1800, with conditions
   * long enough to reach back across the 760px-wide button stack. Reported as *"in the menu, when
   * you have the achievements, the text that explains the achievements overlaps the menu buttons"*
   * — which is what an `else if` chain with an orphan `if` on the end does.
   */
  if (!compact && earned.length > 0) {
    const tx = LOGICAL_WIDTH - MARGIN - 96
    /**
     * The column may not reach back into the button stack — measured, because one did.
     *
     * A condition is right-aligned at x=1800 and the buttons' right edge is 1150, so a
     * condition longer than the gap prints through whichever button shares its row. *Clean
     * Sweep*'s 67 characters did exactly that, reported as *"its text overlaps with the menu
     * button trophies"* — and the layout sweep never saw it because its fixture earns no
     * achievements.
     *
     * Wrapped, not shrunk. Shrinking the face to fit was tried first and the sweep failed it
     * on a 1280 laptop at exactly 10 CSS px — the gap needs a 15px face and the tiny-type floor
     * is where it should be. A long condition becomes two right-aligned lines at full size,
     * broken at the space that best balances them.
     */
    const sideRoom = tx - (x + w + 28)
    const splitToFit = (s: string, size: number): string[] => {
      ctx.save()
      ctx.font = font(size)
      if (ctx.measureText(s).width <= sideRoom) {
        ctx.restore()
        return [s]
      }
      const words = s.split(' ')
      let best = [s]
      let bestWidth = Infinity
      for (let i = 1; i < words.length; i += 1) {
        const a = words.slice(0, i).join(' ')
        const b = words.slice(i).join(' ')
        const widest = Math.max(ctx.measureText(a).width, ctx.measureText(b).width)
        if (widest < bestWidth) {
          bestWidth = widest
          best = [a, b]
        }
      }
      ctx.restore()
      return best
    }
    label(ctx, 'lately', tx, 320, {
      font: font(typeFor(vp, TYPE.dimension)),
      size: typeFor(vp, TYPE.dimension),
      color: p.inkLight,
      align: 'right',
    })
    let ty = 350
    for (const id of [...earned].reverse().slice(0, 5)) {
      const a = ACHIEVEMENTS.find((x) => x.id === id)
      if (!a) continue
      label(ctx, a.name, tx, ty, {
        font: font(typeFor(vp, TYPE.body)),
        size: typeFor(vp, TYPE.body),
        color: p.ink,
        align: 'right',
      })
      // 24 below the name, in a 58px row. At 17 and 46 — numbers set for a 13px body — the 21px
      // name's descenders sat inside the 17px condition underneath it (D-103).
      // Full ink, not `inkLight`: the column sits on the background grid, and D-148 already
      // measured that ground — `inkLight` on `rule` is 3.92:1 against AA's 4.5. The size keeps
      // the hierarchy the lighter tone used to carry.
      const condSize = typeFor(vp, TYPE.dimension)
      const condLines = splitToFit(a.condition, condSize)
      condLines.forEach((line, li) => {
        text(ctx, line, tx, ty + 24 + li * (condSize + 5), {
          font: font(condSize),
          color: p.ink,
          align: 'right',
        })
      })
      ty += 58 + (condLines.length - 1) * (condSize + 5)
    }
    text(ctx, `${earned.length}/${ACHIEVEMENTS.length} earned`, tx, ty + 6, {
      font: font(typeFor(vp, TYPE.dimension)),
      color: readableAccents(p).teal,
      align: 'right',
    })
  }

  /**
   * A quiet technical flourish: the shear line itself, across the page.
   *
   * Above the buttons on a phone, through them everywhere else. At 250 it crosses the compact
   * button stack — which it did at the old 84px height too, and does more visibly now the grid's
   * primary is 122 tall (D-131). A decorative rule drawn through the one filled button on the
   * screen reads as a mistake rather than a flourish, and on a phone the stack *is* the screen, so
   * there is nowhere for it to go but above.
   */
  const lineY = isCompact(vp) ? 196 : 250
  ctx.save()
  ctx.lineWidth = STROKE.heavy
  ctx.strokeStyle = p.ink
  ctx.beginPath()
  ctx.moveTo(MARGIN, snapY(vp, lineY, STROKE.heavy))
  ctx.lineTo(LOGICAL_WIDTH - MARGIN, snapY(vp, lineY, STROKE.heavy))
  ctx.stroke()
  ctx.restore()
  label(ctx, 'shear line', LOGICAL_WIDTH - MARGIN - 28, lineY - 12, {
    font: font(typeFor(vp, TYPE.dimension)),
    size: typeFor(vp, TYPE.dimension),
    color: p.inkLight,
    align: 'right',
  })
}

// ── Bench ───────────────────────────────────────────────────────────────────────────────

/**
 * Bench card geometry.
 *
 * Sized so that **every tier fits on one screen**. `ART_DIRECTION.md §7` wants locked tiers
 * visible rather than hidden — *"aspiration is motivating"* — and that only works if the
 * player can see them. With six locks to a tier and six tiers, 300px cards wrapped at five to
 * a row put Tiers 4, 5 and 6 below the bottom of a 1080px stage, where they were unreachable:
 * the bench has no scrolling and should not need any. Six to a row is one row per tier.
 */
/**
 * Card geometry, re-derived when the type scale went up a third (D-096).
 *
 * The old 246x92 was laid out around an 11px dimension face and a 13px body; at 15 and 18 the four
 * stat lines overlapped each other and ran through the line below. Two things had to give and only
 * one of them could be size — the bench still has to fit on one screen with no scrolling, and the
 * tallest tier is six locks.
 *
 * So the card grew as far as the page allows and then **lost content**: two stats instead of four.
 * "tol 0.86" and "counts for the next tier" were never things anybody chose a lock by, and the rank
 * letter in the corner already says whether it counts. See DECISIONS D-097.
 */
// `CARD_H` went with the last screen that used it: the bench draws its own geometry now (D-102)
// and the codes page draws `CODE_CARD_*`. `CARD_W` went with the lesson strip, whose rows were
// the last thing counted in it (D-152).
const CARD_GAP = 12

/**
 * Bench card geometry, for one tier at a time (D-102).
 *
 * Three to a row, two rows, six locks — the shape every tier in the roster happens to be. 596×214
 * against the old 288×112 is four and a half times the area, which is what buys a name at heading
 * size, a lock drawing big enough to tell a spool from a serrated pin, and stats with air round
 * them instead of stacked at 22px intervals.
 */
const BENCH_COLS = 3
const BENCH_GAP = 24
const BENCH_CARD_H = 250
/** Bench card height on a phone: two columns and three rows have to fit above the status line. */
const COMPACT_CARD_H = 210

/**
 * Two to a row on a phone, not three — DECISIONS D-123.
 *
 * The bench is a grid of cards whose text is the point of them, and on a 664x390 landscape phone a
 * three-column card is 596 logical px wide showing a 26px name: nine actual pixels. Two columns is
 * 908 wide, which is enough card to carry the name and the stats at the compact type scale and
 * still leave the lock drawing legible.
 *
 * Six locks then need three rows rather than two, and the room for the third comes from the lesson
 * strip, which compact drops once the lessons are done — see `drawBench`.
 */
function benchGrid(vp: Viewport): {
  cols: number
  cardW: number
  cardH: number
} {
  const cols = isCompact(vp) ? 2 : BENCH_COLS
  const cardW = Math.floor((LOGICAL_WIDTH - (MARGIN + 28) * 2 - BENCH_GAP * (cols - 1)) / cols)
  return { cols, cardW, cardH: isCompact(vp) ? COMPACT_CARD_H : BENCH_CARD_H }
}

/**
 * Codes cards — the **same** grid at every size, and this is a deliberate stop rather than an
 * oversight (D-123).
 *
 * Two columns was tried, and it reads beautifully: big cards, a name that fits, `PLAY EDIT COPY`
 * you could actually hit with a thumb. It is also unusable, because there are twenty shareable
 * locks and two columns is **ten rows** on a page that does not scroll — so half the roster is
 * drawn below the bottom of the phone, where it is not merely ugly but unreachable. That is the
 * exact failure `PROGRESS.md` records from Phase 13, when the bench outgrew the screen and ten
 * locks became unclickable while every test stayed green.
 *
 * The bench got away with two columns because it shows **one tier at a time** — at most six cards.
 * This page shows everything at once, so making it phone-shaped means paging it, and paging it
 * means a second page index, a second control, and deciding what the existing `‹ ›` above the
 * player's own designs now refers to. That is a screen's worth of design, not a column count.
 *
 * So it stays as it is: the cards are small on a phone and the buttons on them are legible, which
 * `button`'s shrink-to-fit now guarantees. Better a dense page you can reach all of than a
 * comfortable one you cannot.
 */
function codeGrid(_vp: Viewport): {
  cols: number
  cardW: number
  cardH: number
} {
  const cardW = Math.floor(
    (LOGICAL_WIDTH - (MARGIN + 28) * 2 - CARD_GAP * (CODE_COLS - 1)) / CODE_COLS,
  )
  return { cols: CODE_COLS, cardW, cardH: CODE_CARD_H }
}
/**
 * Codes-page card geometry: three to a row, the bench's own rhythm — D-155.
 *
 * It was five columns of 150px cards, chosen in D-102 so every name fit and the whole roster
 * landed on one page. Both were true and the page was still wrong, reported from play as *"in
 * bench there are 6 max and they look cool, but in codes there are 15 of them and it's too
 * tight."* Density is not a virtue on a page that already has a pager: three 597px columns give
 * every card the bench card's presence, the lock drawing room to be read, and the roster pages
 * itself — nine at a time with no designs, six once your own row is on the page.
 */
const CODE_COLS = 3
/**
 * 200, not 150 — the height three columns can afford (D-155).
 *
 * The card carries a name, a drawing, its stats, its code and a row of three or four buttons.
 * The extra fifty over D-132's measurement goes to the drawing, which scales with the card's
 * height and at 150 was a 31px strip.
 */
const CODE_CARD_H = 200
const BENCH_LEFT = MARGIN + 28
const BENCH_WIDTH = LOGICAL_WIDTH - BENCH_LEFT * 2

/**
 * A small side-elevation line drawing of a lock, sized to the card.
 *
 * Drawn from the lock's *own* data rather than as a generic icon, so two cards look different
 * exactly where the locks differ: a spool's waist, a serrated pin's steps, a wafer's gate, the
 * ring of a disc detainer or a tubular. `ART_DIRECTION.md §7` asks for "a small isometric line
 * drawing of the lock plus its stats", and a rectangle with n tick marks was not that — every
 * card in the game looked the same but for the number of ticks.
 */
function drawLockGlyph(
  vp: Viewport,
  p: Palette,
  def: LockDef,
  rect: Rect,
  locked: boolean,
  /**
   * Widest a pin stack may be drawn.
   *
   * Fixed at 4 for years because the only caller was a 96px card, where 4 is a chunky, readable
   * stack. The editor's preview is 560px wide and the same glyph came out as five threads floating
   * in a box — the drawing has to *grow*, not just be scaled up around pins that cannot. Left at 4
   * by default so every existing card is byte-identical (D-099).
   */
  maxPinWidth = 4,
): void {
  const { ctx } = vp
  const n = chambersOf(def)
  const ink = locked ? p.rule : p.inkLight
  ctx.save()
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = ink

  // The two round families get a face, not a section: it is what they look like.
  if (
    def.family === 'disc-detainer' ||
    def.family === 'tubular' ||
    def.family === 'radial-slider'
  ) {
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    const r = Math.min(rect.w, rect.h) / 2 - 2
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
    if (def.family === 'disc-detainer') {
      // Concentric discs, each with its gate notch at a different angle.
      for (let i = 0; i < Math.min(n, 5); i += 1) {
        const rr = r * (1 - i / (Math.min(n, 5) + 1))
        ctx.beginPath()
        ctx.arc(cx, cy, rr, 0.5 + i * 1.1, 0.5 + i * 1.1 + Math.PI * 1.75)
        ctx.stroke()
      }
    } else {
      // A fan of chambers around the core, and the shear circle through them.
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.36, 0, Math.PI * 2)
      ctx.stroke()
      for (let i = 0; i < n; i += 1) {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * r * 0.36, cy + Math.sin(a) * r * 0.36)
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
        ctx.stroke()
      }
    }
    ctx.restore()
    return
  }

  const bodyW = rect.w
  const bodyH = rect.h
  const x = rect.x
  const y = rect.y
  const shear = y + bodyH * 0.5
  // Shell above, plug below, in the two brasses the cutaway uses — so a card reads as a small
  // picture of the thing you are about to open rather than as an abstract diagram (D-050). Muted
  // right down on a locked card, where the whole glyph is a ghost.
  if (!locked) {
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.fillStyle = p.shellBody
    ctx.fillRect(x, y, bodyW, shear - y)
    ctx.fillStyle = p.plugBody
    ctx.fillRect(x, shear, bodyW, y + bodyH - shear)
    ctx.restore()
  }
  ctx.strokeRect(snapX(vp, x, 1), snapY(vp, y, 1), bodyW, bodyH)

  ctx.beginPath()
  ctx.moveTo(x, snapY(vp, shear, 1))
  ctx.lineTo(x + bodyW, snapY(vp, shear, 1))
  ctx.stroke()

  // The keyway, along the bottom of the plug.
  const keyway = y + bodyH * 0.84
  ctx.beginPath()
  ctx.moveTo(x + 2, snapY(vp, keyway, 1))
  ctx.lineTo(x + bodyW - 2, snapY(vp, keyway, 1))
  ctx.stroke()

  // One stack per chamber, shaped by the pin it actually carries.
  const pitch = bodyW / n
  const halfW = Math.max(1.5, Math.min(maxPinWidth, pitch * 0.26))
  for (let i = 0; i < n; i += 1) {
    const cx = snapX(vp, x + pitch * (i + 0.5), 1)
    const profile = def.pins[i] ?? 'standard'
    const top = y + 3
    const bottom = keyway - 1
    if (profile === 'wafer') {
      // One plate with a gate slot at the shear line.
      ctx.strokeRect(snapX(vp, cx - halfW, 1), snapY(vp, top, 1), halfW * 2, bottom - top)
      ctx.beginPath()
      ctx.moveTo(cx - halfW, snapY(vp, shear - 1, 1))
      ctx.lineTo(cx + halfW, snapY(vp, shear - 1, 1))
      ctx.moveTo(cx - halfW, snapY(vp, shear + 1, 1))
      ctx.lineTo(cx + halfW, snapY(vp, shear + 1, 1))
      ctx.stroke()
      continue
    }
    /**
     * Driver above the shear line, key pin below, and the silhouette narrowed wherever the profile
     * actually has a groove — read off the pin's own bands rather than a table of four names.
     *
     * The table knew `spool`, `mushroom`, `t-pin` and `serrated`, and the game has more pins than
     * that: `spool-slim` and the rest fell through to "no grooves" and drew as plain rectangles.
     * Every card in the bench and every preview in the editor was quietly claiming those locks had
     * no security pins in them. The bands are the truth and they are right here (D-099).
     *
     * Bands run bottom-up — index 0 sits against the key pin — and the glyph draws the driver top
     * down, hence `1 - mid / total`.
     */
    const bands = PROFILES[profile].bands
    const total = bands.reduce((sum, b) => sum + b.length, 0) || 1
    const cuts: number[] = []
    let cursor = 0
    for (const band of bands) {
      if (band.reduced) cuts.push(1 - (cursor + band.length / 2) / total)
      cursor += band.length
    }
    /**
     * How far up and down the groove's shoulders run — scaled, not fixed at a pixel.
     *
     * At card size a groove is a 1px nick either side of the waist and that is the right weight.
     * Blown up to the editor's 860px preview the same 1px nick vanishes entirely, and a spool drew
     * as a plain rectangle — the one thing the preview exists to show. A quarter of the stack's
     * half-width is 1.0 at card size, so every card is unchanged (D-099).
     */
    const nick = Math.max(1, halfW * 0.25)
    ctx.beginPath()
    ctx.moveTo(cx - halfW, snapY(vp, top, 1))
    for (const at of cuts) {
      const yy = top + (shear - top) * at
      ctx.lineTo(cx - halfW, snapY(vp, yy - nick, 1))
      ctx.lineTo(cx - halfW * 0.4, snapY(vp, yy, 1))
      ctx.lineTo(cx - halfW, snapY(vp, yy + nick, 1))
    }
    ctx.lineTo(cx - halfW, snapY(vp, shear, 1))
    ctx.lineTo(cx + halfW, snapY(vp, shear, 1))
    for (const at of [...cuts].reverse()) {
      const yy = top + (shear - top) * at
      ctx.lineTo(cx + halfW, snapY(vp, yy + nick, 1))
      ctx.lineTo(cx + halfW * 0.4, snapY(vp, yy, 1))
      ctx.lineTo(cx + halfW, snapY(vp, yy - nick, 1))
    }
    ctx.lineTo(cx + halfW, snapY(vp, top, 1))
    ctx.closePath()
    ctx.stroke()
    // The key pin, its height set by the bitting so a deep cut reads as a deep cut.
    const cut = def.bitting[i] ?? 3
    const keyTop = shear + (bottom - shear) * (1 - Math.min(1, cut / 5))
    ctx.strokeRect(
      snapX(vp, cx - halfW * 0.8, 1),
      snapY(vp, keyTop, 1),
      halfW * 1.6,
      bottom - keyTop,
    )
  }
  ctx.restore()
}

export function drawBench(c: ShellContext): void {
  const { vp, p, ui, progress, actions } = c
  const { ctx } = vp
  const inspecting = c.inspectNext ?? false
  /**
   * What study mode means goes in the **status line**, not floating under the button.
   *
   * It was a right-aligned sentence at y=102, which at the larger face is 760px of type running
   * from x=596 — straight into the top of the `lessons` heading at y=120. Reported as *"when I
   * click the inspect button the text that appears overlaps a bit."*
   *
   * The status line is the one place on every screen that exists for exactly this: a sentence
   * about what the screen is currently doing. It is already drawn, already clear of everything,
   * and it means the header band does not change height when the toggle flips. See D-103.
   */
  screenFrame(
    c,
    'Bench',
    c.status ??
      (inspecting
        ? 'study mode — pick any lock to feel it out. No clock, no rank, nothing recorded.'
        : creditLine(progress)),
  )

  navBar(c, [
    ['Tutorial', () => actions.goto('tutorial')],
    ['Codes', () => actions.goto('codes')],
    ['Editor', () => actions.goto('editor')],
    ['Menu', () => actions.goto('menu')],
  ])

  /*
   * No lesson strip any more — the lessons live on their own Tutorial screen (D-152), and the
   * bench is tiers and only tiers. 184 is where the tier strip already sat on a phone with the
   * lessons done, so the row's own geometry (buttons at `y - 22`, label at `y + 4`) is unchanged.
   */
  let y = 184
  const taughtBasics = progress.data.tutorial.length > 0
  const grid = benchGrid(vp)
  const compactBench = isCompact(vp)

  /**
   * One tier at a time, chosen from a row of buttons — the bench used to be all twenty-five at once.
   *
   * Twenty-five cards, five tier headings and three lesson cards on one page is a wall, and the
   * request that produced this pass named it: *"every page has a lot of text and a lot of
   * information, which makes it hard to understand."* It was also the one screen that could not
   * afford a bigger face — it had twenty-two pixels of slack at the old scale, and the type is 15%
   * larger now.
   *
   * Both problems have the same answer, and it is not tighter packing. Showing the tier you are
   * actually working on gives each of its six locks **more than four times** the area, which is
   * enough for a name at heading size, a picture you can see, and its stats spelled out with room
   * around them. The tiers you are not working on are still listed, still visibly locked, one click
   * away — `ART_DIRECTION.md §7` wants aspiration visible, and a row of buttons showing three
   * locked tiers does that as honestly as three rows of hatched cards did. See DECISIONS D-102.
   */
  const tiers = [...new Set(ALL_LOCKS.map((d) => d.tier))].sort((a, b) => a - b)
  const openTiers = tiers.filter((t) => taughtBasics && progress.isTierUnlocked(t))
  // Land on the deepest tier the player has actually reached rather than always on Tier 1: that is
  // where they left off, and it saves a click on every visit for everybody past the first hour.
  const fallback = openTiers[openTiers.length - 1] ?? tiers[0] ?? 1
  const tier = c.benchTier !== undefined && tiers.includes(c.benchTier) ? c.benchTier : fallback
  /*
   * The word "tiers" beside four buttons that say TIER 1, TIER 2, TIER 3, TIER 4 (D-130).
   *
   * On a full page it is a quiet column heading and costs nothing. On a phone it is the smallest
   * type on the screen, saying the thing the four large buttons next to it already say — reported
   * as *"the text 'tiers' near them is redundant on the mobile"*. Same rule that took the orphan
   * "lessons" heading in D-123: a label with nothing to add is clutter, and clutter is expensive
   * where there is no room.
   */
  if (!isCompact(vp))
    label(ctx, 'tiers', BENCH_LEFT, y + 4, {
      font: font(typeFor(vp, TYPE.dimension)),
      size: typeFor(vp, TYPE.dimension),
      color: p.inkLight,
    })
  /**
   * The tier strip: flush left, and sized from its own captions — DECISIONS D-132.
   *
   * The 90px indent was the gap the word `tiers` used to sit in. D-131 dropped that word on a phone
   * and left the indent, so the row of buttons stood 90px to the right of the cards beneath it —
   * reported as *"tiers are not aligned to the left"*. It is not a compact-only indent either: the
   * label is 46px wide with 44 of air after it, so on a full page the row never lined up with the
   * grid either, it just had something in the gap.
   *
   * Widths come from the captions, so `TIER 1` is a readable button rather than a 96px box holding
   * seven-CSS-pixel type.
   */
  const tierSize = typeFor(vp, TYPE.body)
  const tierBox = boxForCaption(vp, 'tier 4', tierSize, { w: 96, h: 40 })
  const tierGap = isCompact(vp) ? 14 : 12
  const tierLeft = isCompact(vp) ? BENCH_LEFT : BENCH_LEFT + 90
  tiers.forEach((t, i) => {
    const open = taughtBasics && progress.isTierUnlocked(t)
    const rect: Rect = {
      x: tierLeft + i * (tierBox.w + tierGap),
      y: y - 22,
      w: tierBox.w,
      h: tierBox.h,
    }
    if (button(vp, p, ui, rect, `tier ${t}`, { primary: t === tier })) actions.benchTier(t)
    /*
     * The per-tier "locked" captions go on a phone — DECISIONS D-134.
     *
     * Four of them, under four buttons, on a screen that already says *"locked — finish the first
     * lesson above"* and *"tier 1 — 5 locks, after the first lesson"*. Three ways of saying one
     * thing, and the row of captions is the one that adds nothing: an unlocked tier button is drawn
     * in ink and a locked one is not, so the state is already on the button.
     */
    if (!open && !isCompact(vp)) {
      // A padlock would be a second icon language on a screen that has none. The word is clearer.
      const lockSize = typeFor(vp, TYPE.dimension)
      text(ctx, 'locked', rect.x + rect.w / 2, rect.y + rect.h + lockSize + 2, {
        font: font(lockSize),
        color: p.inkLight,
        align: 'center',
      })
    }
  })
  /**
   * Inspect mode, on the tier strip — the bench's own row of controls.
   *
   * A per-card "study" affordance is the obvious design and the wrong one: it doubles the clutter
   * on every card to serve a mode you turn on once and off once. One switch, and the cards keep
   * meaning "pick this".
   *
   * Not in the nav bar, because that row is for *going* somewhere and a mode switch that looks like
   * a destination gets pressed by accident; and not under it either, which is where it was — that
   * put it straight through the third lesson card. Beside the tier buttons it sits with the other
   * control that changes what this screen is showing. See DECISIONS D-103.
   */
  const inspectBox = boxForCaption(vp, 'Inspecting', tierSize, { w: 190, h: 40 })
  if (
    button(
      vp,
      p,
      ui,
      {
        x: LOGICAL_WIDTH - MARGIN - 28 - inspectBox.w,
        y: y - 22,
        w: inspectBox.w,
        h: Math.max(inspectBox.h, tierBox.h),
      },
      inspecting ? 'Inspecting' : 'Inspect',
      { primary: inspecting },
    )
  ) {
    actions.toggleInspect()
  }

  // The row's own height plus the `locked` captions that hang under it — measured, because both
  // grow with the type now and 66 was a literal tuned against a 40px button (D-132).
  y += tierBox.h + typeFor(vp, TYPE.dimension) + 26

  {
    // The first lesson gates the whole bench. It is five minutes and it is the difference
    // between a game and a wall — but the lessons above are always live, so nobody is stuck.
    const unlocked = taughtBasics && progress.isTierUnlocked(tier)
    const locks = ALL_LOCKS.filter((d) => d.tier === tier)
    if (!unlocked) {
      const need = progress.opensNeededFor(tier)
      /*
       * On a phone this line and the "tier N — M locks, after the first lesson" note under it were
       * the same sentence twice. The note names the tier and the count, so this one only survives
       * where it is *not* about the first lesson — the tier-progress case it alone can express.
       */
      const why = !taughtBasics
        ? 'locked — finish the first lesson in the tutorial'
        : `locked — open ${need} more tier ${tier - 1} lock${need === 1 ? '' : 's'}`
      if (!isCompact(vp) || taughtBasics)
      text(ctx, why, BENCH_LEFT, y, {
        font: font(typeFor(vp, TYPE.body)),
        color: readableAccents(p).amber,
      })
    }
    y += 24

    /**
     * On a phone, before the first lesson, the lock grid still does not draw — D-132, surviving
     * D-152 for a different reason. The original reason was room: the lesson strip plus the tier
     * strip plus six cards overran the stage. The strip is gone, the room exists — but drawing
     * the grid untaught was tried, and the layout sweep failed it on the smallest phones:
     * a hatched card's name at that scale is under ten CSS pixels, a wall of things you cannot
     * read *or* press. One line says what is behind the wall; the tutorial says how to get in.
     */
    const gridSuppressed = isCompact(vp) && !taughtBasics
    if (gridSuppressed) {
      const noteSize = typeFor(vp, TYPE.dimension)
      text(
        ctx,
        `tier ${tier} — ${locks.length} locks, after the first lesson in the tutorial`,
        BENCH_LEFT,
        y + noteSize,
        {
          font: font(noteSize),
          color: p.inkLight,
        },
      )
      y += noteSize + 10
    }
    if (!gridSuppressed)
      locks.forEach((def, i) => {
        const col = i % grid.cols
        const row = Math.floor(i / grid.cols)
        const rect: Rect = {
          x: BENCH_LEFT + (grid.cardW + BENCH_GAP) * col,
          y: y + row * (grid.cardH + BENCH_GAP),
          w: grid.cardW,
          h: grid.cardH,
        }
        const st = ui.widget(rect, unlocked)
        cardFrame(vp, p, rect, st, !unlocked)
        /**
         * The hatch goes on **before** the writing, not after it.
         *
         * Drawn last, a 45-degree rule-grey hatch at 0.7 alpha lies across every glyph and every line
         * of type on the card — which is why two thirds of the bench read as grey mush rather than as
         * locked content. `ART_DIRECTION.md §7` wants locked tiers legible precisely so they can be
         * aspired to; a card you cannot read is not aspiration, it is noise. Under the type, at half
         * the weight and a wider pitch, it still says "not yet" without eating the words. See D-099.
         */
        if (!unlocked) {
          hatchRect(ctx, rect.x, rect.y, rect.w, rect.h, {
            spacing: 11,
            angleDeg: 45,
            color: alpha(p.rule, 0.35),
            lineWidth: 1,
          })
        }
        const record = progress.record(def.slug)
        const readable = readableAccents(p)

        /**
         * The lock's name, **fitted to the card** — DECISIONS D-128.
         *
         * `paragraph` wraps on spaces and lets a single over-long *word* run past `maxWidth` rather
         * than chopping it, which is right for prose and wrong here: at the compact type scale
         * "Halberd Tight-Tolerance 5" put "Tight-Tolerance" straight out through the side of its
         * own card. Reported as *"in the bench the names of the locks are too big and they exit the
         * boxes of the locks"*.
         *
         * Measured and shrunk to fit, the same rule `button` and the touch pads use. A name is a
         * label on a box, so the box wins — the alternative is truncating it, and half a lock name
         * is worse than a slightly smaller whole one.
         */
        const nameRoom = rect.w - (record.opens > 0 ? 110 : 44)
        // …and capped by the card's *height* too. At the compact scale a heading is 42px in a
        // 210px card, which crowds the glyph and the record line into each other even when it fits
        // across (D-128).
        let nameSize = Math.min(typeFor(vp, TYPE.heading), Math.floor(rect.h * 0.15))
        ctx.save()
        while (nameSize > 12) {
          ctx.font = font(nameSize)
          if (ctx.measureText(def.name).width <= nameRoom) break
          nameSize -= 1
        }
        ctx.restore()
        text(ctx, def.name, rect.x + 22, rect.y + 38, {
          font: font(nameSize),
          color: unlocked ? p.ink : p.inkLight,
        })
        const glyphH = compactBench ? 84 : 118
        drawLockGlyph(
          vp,
          p,
          def,
          {
            x: rect.x + 22,
            y: rect.y + 58,
            w: compactBench ? 200 : 220,
            h: glyphH,
          },
          !unlocked,
          9,
        )

        const stats = [`${chambersOf(def)} chambers`, `par ${def.par}s`]
        const statSize = typeFor(vp, TYPE.body)
        stats.forEach((s, k) => {
          text(ctx, s, rect.x + (compactBench ? 250 : 266), rect.y + 92 + k * (statSize + 12), {
            font: font(statSize),
            // `p.rule` is the hairline colour: as a *text* colour on a hatched card it was the same
            // grey as the hatch it sat on, which is no colour at all (D-099).
            color: p.inkLight,
          })
        })

        if (record.opens > 0) {
          text(
            ctx,
            `opened ${record.opens}x  ·  best ${record.bestTime?.toFixed(1) ?? '—'}s`,
            rect.x + 22,
            rect.y + rect.h - 20,
            { font: font(typeFor(vp, TYPE.body)), color: readable.teal },
          )
          /**
           * The best rank on this lock, in the card's corner, large.
           *
           * The single most useful thing a bench can tell you at a glance is *which locks you have
           * not beaten yet*, and a list of best times cannot say that — 61 seconds is excellent on
           * one lock and shameful on another. A letter is comparable across the whole page.
           * Struck through in rule grey when it does not yet reach D, because that is the bar the
           * next tier is waiting on (D-091).
           */
          const best = record.bestRank
          label(ctx, letterFor(best), rect.x + rect.w - 46, rect.y + 60, {
            font: font(typeFor(vp, TYPE.payout), 'bold'),
            size: typeFor(vp, TYPE.payout),
            color: countsForTier(best) ? readable.teal : p.rule,
            align: 'center',
          })
        } else if (unlocked) {
          text(ctx, 'not yet opened', rect.x + 22, rect.y + rect.h - 20, {
            font: font(typeFor(vp, TYPE.body)),
            color: p.inkLight,
          })
        }

        if (st.activated && unlocked) actions.startLock(def)
      })
    /*
     * Advanced by the grid that was actually drawn (D-132).
     *
     * It counted rows with `BENCH_COLS` and heights with `BENCH_CARD_H` — the *flat* constants —
     * while the cards above are laid out from `grid`, which on a phone is two columns of 210px.
     * So on every compact viewport `y` came out of this block wrong in both terms at once, which is
     * why the overflow warning beneath it has never been able to give an honest number.
     */
    if (!gridSuppressed) {
      const rows = Math.ceil(locks.length / grid.cols)
      y += rows * (grid.cardH + BENCH_GAP)
    }
  }

  // The bench does not scroll, so if it ever outgrows the stage the tiers at the bottom
  // become invisible *and* unclickable — which is precisely what happened the moment Phase 13
  // finished the roster. Saying so is better than silently losing Tier 6.
  if (y > LOGICAL_HEIGHT - MARGIN) {
    text(ctx, `bench overflows by ${Math.ceil(y - (LOGICAL_HEIGHT - MARGIN))}px`, BENCH_LEFT, y, {
      font: font(typeFor(vp, TYPE.dimension)),
      color: readableAccents(p).crimson,
    })
  }
}

/**
 * How far down the bench reaches, for the test that keeps it on one screen.
 *
 * Mirrors the layout above rather than measuring it, because the drawing needs a canvas and
 * this needs to be answerable in a unit test.
 *
 * `tierCount` no longer changes the answer — the bench draws one tier at a time (D-102), so what
 * bounds the page is the **largest** tier rather than the sum of all of them. Kept in the signature
 * because the question the test is asking ("does the bench fit for this roster") is unchanged, and
 * a roster whose biggest tier grew is exactly what it still needs to catch.
 */
export function benchHeight(
  lockCount: number,
  tierCount: number,
  /**
   * The compact bench is a different shape and has to be checked as one (D-123): two columns
   * instead of three means a six-lock tier is **three** rows rather than two.
   */
  compact = false,
): number {
  // The tier strip sits at a fixed 184 now that the lessons live on their own screen (D-152).
  let y = 184
  // Tier buttons, then the lock/locked line, then the biggest tier's rows.
  y += 58 + 24
  const cols = compact ? 2 : BENCH_COLS
  const cardH = compact ? COMPACT_CARD_H : BENCH_CARD_H
  const biggest = Math.ceil(lockCount / Math.max(1, tierCount))
  y += Math.ceil(biggest / cols) * (cardH + BENCH_GAP)
  return y
}

// ── Tutorial ────────────────────────────────────────────────────────────────────────────

/**
 * The lessons' own screen — D-152.
 *
 * They lived at the top of the bench for the whole life of the project, as a strip of three
 * summary cards above the tiers. Moved here because the course outgrew the strip: four lessons
 * is a curriculum, and a curriculum deserves a page that says what order it goes in — while the
 * bench, the busiest screen in the game, gets to be about tiers and only tiers.
 *
 * Every lesson is always shown and always replayable, done or not, which is the property D-136
 * existed to protect. `startLesson` is called from exactly one place now: these cards.
 */
export function drawTutorial(c: ShellContext): void {
  const { vp, p, ui, progress, actions } = c
  const { ctx } = vp
  const doneCount = LESSONS.filter((l) => progress.data.tutorial.includes(l.id)).length
  screenFrame(
    c,
    'Tutorial',
    c.status ??
      (doneCount === 0
        ? 'start with lesson one — the bench unlocks once it is done'
        : doneCount === LESSONS.length
          ? 'all lessons done — they replay whenever you like'
          : `${doneCount} of ${LESSONS.length} done — pick up where you left off`),
  )
  navBar(c, [
    ['Bench', () => actions.goto('bench')],
    ['Menu', () => actions.goto('menu')],
  ])

  const readable = readableAccents(p)
  text(
    ctx,
    isCompact(vp)
      ? `${LESSONS.length} short lessons, in order.`
      : `${LESSONS.length} short lessons, in order. Everything on the bench comes down to these.`,
    BENCH_LEFT,
    170,
    { font: font(typeFor(vp, TYPE.body)), color: p.inkLight },
  )

  /*
   * Two columns of two, at half the page each: the blurb is the content here rather than a
   * reminder, because this is the screen a zero-knowledge player reads before their first
   * pick. Heights are measured from the type, the lesson the old strip learnt in D-132.
   */
  const cols = 2
  const cardW = Math.floor((BENCH_WIDTH - BENCH_GAP * (cols - 1)) / cols)
  const tagSize = typeFor(vp, TYPE.dimension)
  const titleSize = typeFor(vp, TYPE.heading)
  const blurbSize = typeFor(vp, TYPE.body)
  /*
   * Measured against the page, not asserted — D-157. Six lessons is three rows, and on the
   * smallest phones three rows of two-blurb-line cards ran through the status line: the sweep
   * failed it before anyone saw it. The card wants two blurb lines (every `teaches` sentence is
   * under 60 characters, two compact lines exactly); where the page cannot pay for two, the
   * card shrinks and the blurb gives a line rather than the grid giving the footer.
   */
  const top = 210
  const rowsWanted = Math.ceil(LESSONS.length / cols)
  const floorY = LOGICAL_HEIGHT - MARGIN - 60
  const fitH = Math.floor((floorY - top - BENCH_GAP * (rowsWanted - 1)) / rowsWanted)
  const wantH = Math.max(150, tagSize + titleSize + blurbSize * 2.4 + 70)
  const cardH = Math.min(wantH, fitH)
  const blurbLines = Math.max(
    1,
    Math.min(2, Math.floor((cardH - tagSize - titleSize - 70) / (blurbSize + 6))),
  )
  const nextIdx = LESSONS.findIndex((l) => !progress.data.tutorial.includes(l.id))
  LESSONS.forEach((lesson, i) => {
    const rect: Rect = {
      x: BENCH_LEFT + (cardW + BENCH_GAP) * (i % cols),
      y: top + Math.floor(i / cols) * (cardH + BENCH_GAP),
      w: cardW,
      h: cardH,
    }
    const done = progress.data.tutorial.includes(lesson.id)
    const st = ui.widget(rect)
    cardFrame(vp, p, rect, st, false)
    label(ctx, `lesson ${i + 1}`, rect.x + 20, rect.y + 16 + tagSize, {
      font: font(tagSize),
      size: tagSize,
      color: p.inkLight,
    })
    label(ctx, lesson.title, rect.x + 20, rect.y + 30 + tagSize + titleSize, {
      font: font(titleSize),
      size: titleSize,
      color: p.ink,
    })
    paragraph(ctx, lesson.teaches, rect.x + 20, rect.y + 48 + tagSize + titleSize + blurbSize, {
      font: font(blurbSize),
      color: p.inkLight,
      maxWidth: rect.w - 40,
      lineHeight: blurbSize + 6,
      maxLines: blurbLines,
    })
    // `done` in teal on the finished ones; `next` in amber on the first that is not — so the
    // order the page keeps talking about is visible as a mark, not just an argument.
    if (done || i === nextIdx) {
      text(ctx, done ? 'done' : 'next', rect.x + rect.w - 20, rect.y + 16 + tagSize, {
        font: font(tagSize),
        color: done ? readable.teal : readable.amber,
        align: 'right',
      })
    }
    if (st.activated) actions.startLesson(lesson.id)
  })
}

// ── Results ─────────────────────────────────────────────────────────────────────────────

export function drawResults(c: ShellContext): void {
  const { vp, p, ui, progress, actions, outcome, result } = c
  const { ctx } = vp
  screenFrame(c, outcome?.opened ? 'Open' : 'Results', c.status ?? creditLine(progress))
  if (!outcome) return

  const readable = readableAccents(p)
  /**
   * The lock's name clears `OPEN` by its **own ascent** — DECISIONS D-146, and the same fix the
   * menu's subtitle needed.
   *
   * `MARGIN + 92` is 40px under the title's baseline. That holds for the desktop heading face and
   * not for the compact one, which `typeFor` scales up to stay legible: a taller line in a fixed
   * gap runs into the word above it. Reported by the audit as `"OPEN" over "HALBERD ANTI-BUMP 6"`.
   */
  const nameSize = typeFor(vp, TYPE.heading)
  label(ctx, outcome.lock.name, MARGIN + 28, MARGIN + 52 + Math.max(40, nameSize + 8), {
    font: font(nameSize),
    size: nameSize,
    color: p.inkLight,
  })

  const left = MARGIN + 60
  let y = 220
  // The par this attempt was *judged* against, which on anything but Easy is not the lock's par.
  const judgedPar = effectivePar(outcome.lock.par, outcome.assist)
  const rows: [string, string, string][] = [
    [
      'time',
      `${outcome.seconds.toFixed(2)}s`,
      outcome.seconds <= judgedPar ? readable.teal : p.ink,
    ],
    [
      'par',
      judgedPar === outcome.lock.par
        ? `${outcome.lock.par}s`
        : `${judgedPar.toFixed(0)}s  (${outcome.lock.par}s x ${outcome.assist})`,
      p.inkLight,
    ],
    [
      'oversets',
      String(outcome.oversets),
      outcome.oversets === 0 ? readable.teal : readable.crimson,
    ],
    ['resets', String(outcome.resets), outcome.resets === 0 ? readable.teal : p.ink],
    ['false sets', String(outcome.falseSets), p.ink],
  ]
  /**
   * The value column is measured from the widest label — DECISIONS D-135.
   *
   * It was `left + 260`, tuned against a 21px face. At the compact scale `FALSE SETS` is 286px of
   * tracked capitals, so on the smallest phone the label ran 26px into its own value and `PAR`'s
   * parenthetical ran into the row beneath it. The results screen had never been audited — the
   * sweep reaches its screens with `goto` and this one needs a solved lock — so it was the only
   * screen in the game still carrying a literal like this.
   */
  const statSize = typeFor(vp, TYPE.body)
  const valueX =
    left +
    rows.reduce((w, [k]) => Math.max(w, Math.ceil(captionWidth(vp, k, statSize))), 0) +
    28
  const statPitch = Math.max(34, statSize + 12)
  for (const [k, v, color] of rows) {
    label(ctx, k, left, y, { font: font(statSize), size: statSize, color: p.inkLight })
    text(ctx, v, valueX, y, { font: font(statSize), color })
    y += statPitch
  }

  /**
   * The rank, on the right half of the screen — where the binding-order chart used to be.
   *
   * The panel says three things and no more: what you earned this time, what your best on this
   * lock is, and — the only line worth hurrying for — whether this attempt moved it. A number
   * that only ever goes up is not a reason to play a lock twice; a letter that can be beaten is.
   *
   * It sat under the stats at payout size (64) until D-151 removed the chart and the right half
   * of the busiest good moment in the game became blank paper. Reported as *"looks very empty —
   * you can move the rank to the right part of the screen and make it bigger and animated"*.
   * So: 220px, stamped — it grows in from nothing with a slight overshoot, the same landing
   * `drawCreditCount` gives the letter during the open sequence, driven by `resultsAge` so a
   * test that advances the clock sees the settled frame. Reduced motion arrives settled (D-154).
   */
  if (result) {
    const rankBody = typeFor(vp, TYPE.body)
    const compactResults = isCompact(vp)
    /*
     * `previous best` and `counts toward the next tier` still go on a phone (D-134): they are
     * bookkeeping you can read on the bench, and `best on this lock` is the comparison the big
     * letter is inviting.
     */
    const lines: [string, string][] = compactResults
      ? [['best on this lock', letterFor(result.bestRank)]]
      : [
          ['best on this lock', letterFor(result.bestRank)],
          ['previous best', result.firstOpen ? 'first open' : letterFor(result.previousBest)],
          [
            'counts toward the next tier',
            countsForTier(result.bestRank) ? 'yes' : 'not yet — needs D',
          ],
        ]
    const LETTER = 220
    const linePitch = rankBody + 16
    const px = LOGICAL_WIDTH / 2 + 40
    const pw = LOGICAL_WIDTH - MARGIN - 36 - px
    const py = 200
    const flashSize = typeFor(vp, TYPE.heading)
    const ph = 60 + LETTER + 46 + lines.length * linePitch + (result.improved ? flashSize + 26 : 0) + 26
    panel(vp, p, { x: px, y: py, w: pw, h: ph }, 'rank')

    const rankInk =
      result.rank <= 1 ? readable.teal : result.rank <= 3 ? readable.amber : readable.crimson
    /*
     * The stamp. Ease-out-back from zero: the letter grows in and overshoots by ~10% before it
     * settles, so its bounds at any moment never exceed the clearance the panel is built with.
     * Growing from nothing rather than shrinking from huge, deliberately — a letter that starts
     * at double size would cross the record lines below it on its way down.
     */
    const age = c.resultsAge ?? 9
    const k = Math.min(1, age / 0.45)
    const back = 1.70158
    const eased = 1 + (back + 1) * Math.pow(k - 1, 3) + back * Math.pow(k - 1, 2)
    const letterCx = px + pw / 2
    const letterCy = py + 60 + LETTER / 2
    const glyph = letterFor(result.rank)
    ctx.save()
    ctx.globalAlpha = Math.min(1, age / 0.12)
    ctx.translate(letterCx, letterCy)
    ctx.scale(Math.max(0.001, eased), Math.max(0.001, eased))
    ctx.font = font(LETTER, 'bold')
    ctx.fillStyle = rankInk
    ctx.fillText(glyph, -ctx.measureText(glyph).width / 2, LETTER * 0.36)
    ctx.restore()

    let ly = py + 60 + LETTER + 46
    for (const [k2, v] of lines) {
      label(ctx, k2, px + 40, ly, { font: font(rankBody), size: rankBody, color: p.inkLight })
      text(ctx, v, px + pw - 40, ly, { font: font(rankBody), color: p.ink, align: 'right' })
      ly += linePitch
    }
    if (result.improved && age > 0.5) {
      // After the stamp lands, not with it — one thing arriving at a time.
      label(ctx, result.firstOpen ? 'first open' : 'new best', px + 40, ly + 14, {
        font: font(flashSize),
        size: flashSize,
        color: readable.teal,
      })
    }
  }

  /**
   * The code for the lock you have just beaten, on the screen where you have just beaten it.
   *
   * "Do this in under 5.21 seconds" is the whole reason a share code is worth having, and it was
   * only ever obtainable by going to the editor and rebuilding the lock by hand. Drawn only when
   * the format can carry this lock honestly — `shareableCode` is the judge of that (D-099).
   */
  /*
   * And the share code goes with it (D-134).
   *
   * A code, a COPY button and an ALL CODES button is three more controls on a screen whose job is
   * to tell you how you did and send you to the next lock — and every one of them is a duplicate of
   * the Share codes page, which is one tap from the menu and lists this lock among the others.
   */
  const code = isCompact(vp) ? null : shareableCode(outcome.lock)
  if (code !== null) {
    const sy = 600
    label(ctx, 'share this lock', left, sy, {
      font: font(typeFor(vp, TYPE.dimension)),
      size: typeFor(vp, TYPE.dimension),
      color: p.inkLight,
    })
    /**
     * **Measured, not counted** — the same lesson as D-102, in the one place that had not learnt
     * it yet.
     *
     * The buttons sat at a hardcoded `left + 340` on the assumption the code was narrower than
     * that. A code is sixteen Crockford characters, which `formatCode` groups into four fours
     * joined by dashes — nineteen glyphs, drawn through `label`, which uppercases and adds
     * `size × 0.08` of tracking on top of the advance. At `TYPE.heading` that lands within a few
     * pixels of 340 either side of it, so whether the code ran through the `Copy` button came down
     * to which monospace face the machine resolved from the stack. Reported as *"when the lock is
     * opened, the code of the lock overlaps with some button"* — on that machine, it did.
     *
     * `label` returns the width it drew. Using it removes the guess entirely, and the `340` floor
     * stays only so the buttons do not jump left on a short code. See DECISIONS D-108.
     */
    const codeW = label(ctx, formatCode(code), left, sy + 40, {
      font: font(typeFor(vp, TYPE.heading)),
      size: typeFor(vp, TYPE.heading),
      color: p.ink,
    })
    const bx = left + Math.max(340, codeW + 28)
    if (button(vp, p, ui, { x: bx, y: sy + 14, w: 160, h: 40 }, 'Copy')) {
      actions.copyText(formatCode(code), `the code for ${outcome.lock.name}`)
    }
    if (button(vp, p, ui, { x: bx + 176, y: sy + 14, w: 200, h: 40 }, 'All codes')) {
      actions.goto('codes')
    }
  }

  /**
   * Bench, Again, and — the point of this row — **Next lock**.
   *
   * Opening a lock used to leave two ways forward: do that one again, or go back to the bench and
   * hunt for the next one. The second is a trip through a menu to answer a question the game can
   * already answer, and it is the trip you make after *every* open. Asked for as *"once you open
   * the lock user must see the button 'next', so they will continue without exiting to the bench
   * section"*. `Progress.nextLockAfter` decides which one; this only draws it (D-121).
   *
   * It is the primary action and `Again` gives that up, because carrying on is what most players
   * do most of the time and the primary fill should sit under the button most likely to be
   * pressed. The lock's *name* goes under the row rather than in the label: a 240px button cannot
   * hold "Kestrel Serrated Trainer", and pressing `Next lock` without knowing where it goes is the
   * kind of button people learn not to press.
   */
  const next = progress.nextLockAfter(outcome.lock)
  const bw = 240
  const gap = 24
  const count = next ? 3 : 2
  const rowW = bw * count + gap * (count - 1)
  let bx2 = LOGICAL_WIDTH / 2 - rowW / 2
  // Declared at the height `fitBox` would grow it to anyway, and moved up by the growth — so the
  // caption above the row is spaced from the buttons' real top edge, not the pre-growth one it
  // was 1px from on the smallest phones (D-156).
  const rowBtnH = Math.max(52, minControlH(vp, typeFor(vp, TYPE.body)))
  const by = LOGICAL_HEIGHT - MARGIN - 130 - (rowBtnH - 52)

  if (button(vp, p, ui, { x: bx2, y: by, w: bw, h: rowBtnH }, 'Bench')) actions.goto('bench')
  bx2 += bw + gap
  if (
    button(vp, p, ui, { x: bx2, y: by, w: bw, h: rowBtnH }, 'Again', {
      primary: !next,
    })
  ) {
    actions.restart()
  }
  if (next) {
    bx2 += bw + gap
    if (
      button(vp, p, ui, { x: bx2, y: by, w: bw, h: rowBtnH }, 'Next lock', {
        primary: true,
      })
    ) {
      actions.startLock(next)
    }
    // Above the row, not below it: at the compact face this caption's ascenders reached into the
    // button frames, so the lock you are about to pick read as part of the button (D-134).
    label(ctx, next.name, LOGICAL_WIDTH / 2, by - 18, {
      font: font(typeFor(vp, TYPE.body)),
      size: typeFor(vp, TYPE.body),
      color: p.inkLight,
      align: 'center',
    })
  }
}

// ── Settings ────────────────────────────────────────────────────────────────────────────

export function drawSettings(c: ShellContext): void {
  const { vp, p, ui, progress, actions } = c
  const { ctx } = vp
  const s = progress.data.settings
  screenFrame(c, 'Settings', c.status ?? 'changes save immediately')
  // The way back to a paused attempt, when there is one to go back to (D-157). The pause panel
  // links here; without this, the session survived the trip and no button led back to it.
  navBar(
    c,
    c.pickActive
      ? [
          ['Back to the lock', () => actions.goto('pause')],
          ['Menu', () => actions.goto('menu')],
        ]
      : [['Menu', () => actions.goto('menu')]],
  )

  /**
   * Two columns on a phone, and every row given room for a thumb — DECISIONS D-131.
   *
   * This screen was the worst offender the touch audit found: a 34px toggle at 44px pitch is a
   * **twelve CSS pixel** target with sixteen between centres, in a single column down the left of a
   * 1920-wide stage whose right half is empty except for two buttons. The near-miss floor cannot
   * rescue rows that tightly packed — it resolves to the nearest centre, so it still asks the
   * player to be accurate to within half a pitch, which here is eight real pixels.
   *
   * So the space that was already there gets used. Controls left, switches right, and the pitch
   * roughly doubles. Nothing is dropped and nothing is paged.
   */
  const compact = isCompact(vp)
  const left = MARGIN + 60
  const w = 420
  const col2 = left + 880
  /** Row heights that a fingertip can land on, and the gap between one row and the next. */
  const ctlH = compact ? 64 : 40
  /**
   * What a segmented control will actually be, once `fitBox` has had its say — declared, so the
   * rows below can be spaced from the real bottom edge. Declaring 64 and letting `fitBox` grow it
   * to 84 about its centre put the control's true edge ten pixels below where every `y +=` in
   * this function thought it was, which is how the next row's label ended up 4px from it on the
   * smallest phones (D-156).
   */
  const segH = Math.max(ctlH, minControlH(vp, typeFor(vp, TYPE.body)))
  const rowGap = compact ? 100 : 62
  let y = 150

  label(ctx, 'level', left, y, {
    font: font(typeFor(vp, TYPE.dimension)),
    size: typeFor(vp, TYPE.dimension),
    color: p.inkLight,
  })
  const assistIndex = segmented(
    vp,
    p,
    ui,
    // Four cells holding TRAINING/EASY/MEDIUM/HARD. 580 gives each 145, and TRAINING at the
    // compact face is 208 — so `segmented` shrank it to seven CSS px. Sized from the longest
    // word instead, and it still clears the switch column at left + 880 (D-132).
    // 18 under the label on a phone, not 10: the compact face's descenders reached within 5px
    // of the control's top edge, under the crowding rule's six (D-156).
    {
      x: left,
      y: y + (compact ? 18 : 10),
      w: compact
        ? Math.min(
            860,
            ASSIST_MODES.reduce(
              (m, mode) =>
                Math.max(m, Math.ceil(captionWidth(vp, mode, typeFor(vp, TYPE.body))) + 24),
              0,
            ) * ASSIST_MODES.length,
          )
        : w + 160,
      h: segH,
    },
    ASSIST_MODES,
    ASSIST_MODES.indexOf(s.assist),
  )
  const nextAssist = ASSIST_MODES[assistIndex]
  if (nextAssist !== undefined && nextAssist !== s.assist) {
    actions.updateSettings({ assist: nextAssist })
  }
  // Say what the level takes away and what it pays, so the choice is informed rather than a
  // guess at four adjectives.
  // The full width, not the control's: on its own line below the segmented control there is nothing
  // to its right, and at 580 every blurb wrapped to two lines whose descenders touched the label
  // underneath (D-103).
  // The blurb goes on a phone: it is two lines of prose across 1100px, and the right-hand 880 of
  // that is now the switch column. The four mode names are the choice; the prose explains it.
  // 76, not 70: at 70 the blurb's ascenders came within 3px of the control's bottom edge, which
  // is a graze, not a gap — the crowding rule (D-156) asks for six.
  if (!compact)
    paragraph(ctx, ASSIST_BLURB[s.assist], left, y + 76, {
      font: font(typeFor(vp, TYPE.body)),
      color: p.ink,
      maxWidth: 1100,
      lineHeight: 26,
      maxLines: 2,
    })
  // It used to say "pays x2.50", of credits that no longer exist. The ladder now buys **time**:
  // the harder the mode, the more of the clock a given rank is worth (D-091).
  // Beside the control, not on it: right-aligned to `left + w + 160` put this straight across the
  // segmented control's own right-hand cell, because that is exactly where the control ends (D-099).
  if (!compact)
    text(
      ctx,
      `x${ASSIST_MULTIPLIER[s.assist].toFixed(2)} par for ranking`,
      left + w + 190,
      y + 36,
      { font: font(typeFor(vp, TYPE.body)), color: readableAccents(p).amber },
    )
  // 122, not 108: Training and Hard both run the blurb to two lines, which ended 12px above the
  // next label's baseline — not a gap at 15px, and one word away from touching (D-099). The last
  // six arrived with the blurb itself moving down six for the crowding rule (D-156).
  y += compact ? 18 + segH + 42 : 122

  label(ctx, 'which hand holds the pick', left, y, {
    font: font(typeFor(vp, TYPE.dimension)),
    size: typeFor(vp, TYPE.dimension),
    color: p.inkLight,
  })
  const handIndex = segmented(
    vp,
    p,
    ui,
    // Same 18-on-a-phone offset as the assist row: the label's descenders need the air (D-156).
    { x: left, y: y + (compact ? 18 : 10), w: compact ? 460 : 320, h: segH },
    ['left', 'right'],
    s.handedness === 'right' ? 1 : 0,
  )
  const nextHand = handIndex === 1 ? 'right' : 'left'
  if (nextHand !== s.handedness) actions.updateSettings({ handedness: nextHand })
  // It mirrors the touch controls too now (D-130) — worth saying where there is room to say it.
  if (!compact)
    text(ctx, 'mirrors the lock, so the keyway opens on your side', left + 344, y + 34, {
      font: font(typeFor(vp, TYPE.dimension)),
      color: p.inkLight,
    })
  y += compact ? 18 + segH + 42 : 84

  /**
   * Full page, compact page, or let the screen decide — DECISIONS D-160.
   *
   * On the row above the volume sliders because the people it exists for reach this screen
   * through the compact layout, and a control that overrules the compact layout has to be
   * findable *from* it. The row is the override the player was getting from Chrome's
   * Desktop-site checkbox, put where it can be remembered.
   */
  /**
   * Full ink, not `inkLight` — the D-148 rule, met by a different road.
   *
   * `sampleGround` reads one row of pixels across the run, and at 844x390 this label's row lands
   * exactly on a horizontal grid hairline: five samples, five hits, median `rule`, and `inkLight`
   * on `rule` is 3.92:1. The sibling labels above pass by the luck of their rows falling between
   * hairlines, which is not a property to build on — a label that cannot choose its ground gets
   * the ink that clears every ground it could have (16.4:1). See DECISIONS D-160.
   */
  label(ctx, 'interface', left, y, {
    font: font(typeFor(vp, TYPE.dimension)),
    size: typeFor(vp, TYPE.dimension),
    color: p.ink,
  })
  const modeIndex = segmented(
    vp,
    p,
    ui,
    // Sized from the longest word at the live face, exactly as the assist row is (D-132).
    {
      x: left,
      y: y + (compact ? 18 : 10),
      w: compact
        ? Math.min(
            860,
            INTERFACE_MODES.reduce(
              (m, mode) =>
                Math.max(m, Math.ceil(captionWidth(vp, mode, typeFor(vp, TYPE.body))) + 24),
              0,
            ) * INTERFACE_MODES.length,
          )
        : 450,
      h: segH,
    },
    INTERFACE_MODES,
    INTERFACE_MODES.indexOf(s.interfaceMode),
  )
  const nextMode = INTERFACE_MODES[modeIndex]
  if (nextMode !== undefined && nextMode !== s.interfaceMode) {
    actions.updateSettings({ interfaceMode: nextMode })
  }
  if (!compact)
    text(ctx, 'full is the desktop page; compact enlarges what a phone needs', left + 474, y + 34, {
      font: font(typeFor(vp, TYPE.dimension)),
      color: p.inkLight,
    })
  y += compact ? 18 + segH + 42 : 84

  const sliderH = compact ? 62 : 44
  /*
   * The sensitivity slider is not drawn on a phone — DECISIONS D-134.
   *
   * It multiplies the **arrow-key** lift trim (D-111), and a phone has no arrow keys: the touch
   * lift is geared by `LIFT_DRAG_PX` and never consults this. It was a control that could not
   * change anything, taking a full row on the screen where the rows are most expensive.
   */
  if (!compact) {
    const sensitivity = slider(
      vp,
      p,
      ui,
      { x: left, y, w, h: sliderH },
      'sensitivity',
      s.sensitivity,
      { min: 0.4, max: 2, step: 0.05 },
    )
    if (sensitivity !== s.sensitivity) actions.updateSettings({ sensitivity })
    y += rowGap
  }

  /**
   * One volume on a phone, three on a desktop — DECISIONS D-134.
   *
   * `master`, `mechanical` and `ambient` are a mixing desk, and a mixing desk is a thing you sit
   * at. On a phone they are three of the six rows in the left column, and two of them are for
   * balancing layers against each other — which is a judgement nobody makes on a bus, through a
   * phone speaker, on a game whose continuous voices are off by default anyway (D-085).
   *
   * Master stays because "quieter" and "louder" are real wants. The other two keep whatever they
   * were set to, so a save made at a desk still sounds the way it was mixed.
   */
  const master = slider(vp, p, ui, { x: left, y, w, h: sliderH }, 'master volume', s.masterVolume)
  if (master !== s.masterVolume) actions.updateSettings({ masterVolume: master })
  y += rowGap
  if (!compact) {
    const mech = slider(vp, p, ui, { x: left, y, w, h: sliderH }, 'mechanical', s.mechanicalVolume)
    if (mech !== s.mechanicalVolume) actions.updateSettings({ mechanicalVolume: mech })
    y += rowGap
    const amb = slider(vp, p, ui, { x: left, y, w, h: sliderH }, 'ambient', s.ambientVolume)
    if (amb !== s.ambientVolume) actions.updateSettings({ ambientVolume: amb })
    y += 74
  } else {
    y += rowGap
  }

  const toggles: [string, keyof SettingsData][] = [
    ['mute everything', 'muted'],
    ['hold tension (off = toggle)', 'tensionToggle'],
    ['reduce motion', 'reducedMotion'],
    // Off by default (D-085). The clicks always play; this is the drone layer underneath them.
    [compact ? 'continuous tones' : 'continuous tones (hum, scrape, bed)', 'continuousTones'],
    ['audio subtitles', 'subtitles'],
    ['vibrate', 'haptics'],
  ]
  // The switch column. On a full page it carries on down the left as it always has.
  let ty = compact ? 150 : y
  const tx = compact ? col2 : left
  const toggleH = compact ? 64 : 34
  const togglePitch = compact ? 84 : 44
  /*
   * The row is as wide as its own caption — DECISIONS D-132.
   *
   * `w` is 420, and `CONTINUOUS TONES (HUM, SCRAPE, BED)` at the compact face is over 700. The
   * label was drawn to its full length while the *hit* row stopped at 420, so the back half of
   * every long switch was text you could press with nothing underneath it.
   */
  const toggleSize = typeFor(vp, TYPE.body)
  const toggleW = Math.max(
    w,
    ...toggles.map(([cap]) => Math.ceil(captionWidth(vp, cap, toggleSize)) + toggleSize * 1.2 + 40),
  )
  for (const [caption, key] of toggles) {
    const current = s[key] as boolean
    const next = toggle(vp, p, ui, { x: tx, y: ty, w: toggleW, h: toggleH }, caption, current)
    if (next !== current) actions.updateSettings({ [key]: next })
    ty += togglePitch
  }
  /*
   * Vibration is `navigator.vibrate`, which Safari on iOS does not implement — on any version. The
   * switch is shown regardless, because hiding it would make the setting invisible to the player
   * who later opens the same save on an Android phone, and a line under it says which you have.
   * See DECISIONS D-131 for why the iOS checkbox trick was not taken.
   */
  if (!c.hapticsSupported)
    text(ctx, 'this device has no vibration motor the browser can reach', tx + 34, ty + 6, {
      font: font(typeFor(vp, TYPE.dimension)),
      color: p.inkLight,
    })

  // Save import/export sits below the nav bar rather than level with it: it is this screen's own
  // business, and the row along the top is now navigation and nothing else (D-103).
  // On a phone the top-right is the switch column, so they go under it.
  /**
   * Sized from their captions, like the switches above them — DECISIONS D-146.
   *
   * A literal 280 was wide enough for `EXPORT SAVE` in the typeface the game used to borrow from
   * the machine. In the one it ships, the caption no longer fits, and `button` does the only thing
   * it can with a box it was handed: shrink the type to fit — down to 10.4 CSS px on the smallest
   * phone, under the 11px floor the whole compact pass exists to hold (D-135). The button grows
   * instead. There is a clear half-screen to its right and nothing to be gained by keeping it thin.
   */
  const saveSize = typeFor(vp, TYPE.body)
  const saveW = Math.max(
    280,
    ...(['Export save', 'Import save'] as const).map(
      (cap) => Math.ceil(captionWidth(vp, cap, saveSize)) + 56,
    ),
  )
  const bx = compact ? col2 : LOGICAL_WIDTH - MARGIN - 28 - saveW
  const by = compact ? ty + 54 : 200
  const bh = compact ? 72 : 46
  if (button(vp, p, ui, { x: bx, y: by, w: saveW, h: bh }, 'Export save')) actions.exportSave()
  if (button(vp, p, ui, { x: bx, y: by + bh + 14, w: saveW, h: bh }, 'Import save'))
    actions.importSave()
}

// ── Pause ───────────────────────────────────────────────────────────────────────────────

export function drawPause(c: ShellContext): void {
  const { vp, p, ui, actions } = c
  const { ctx } = vp
  ctx.save()
  ctx.fillStyle = alpha(p.paper, 0.86)
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT)
  ctx.restore()

  const w = 420
  // 446, not 380: the panel gained a Help button and a panel sized for four buttons cannot hold
  // five — the last one drew through its own bottom edge.
  const h = 446
  const x = (LOGICAL_WIDTH - w) / 2
  const y = (LOGICAL_HEIGHT - h) / 2
  panel(vp, p, { x, y, w, h }, undefined, p.paperShade)
  label(ctx, 'Paused', x + w / 2, y + 60, {
    font: font(typeFor(vp, TYPE.title)),
    size: typeFor(vp, TYPE.title),
    color: p.ink,
    align: 'center',
  })

  const bw = w - 80
  let by = y + 110
  if (
    button(vp, p, ui, { x: x + 40, y: by, w: bw, h: 52 }, 'Resume', {
      primary: true,
    })
  ) {
    actions.resume()
  }
  by += 66
  if (button(vp, p, ui, { x: x + 40, y: by, w: bw, h: 52 }, 'Restart lock')) actions.restart()
  by += 66
  // Reachable mid-attempt, because "what is that bar for" is a question you have *while* picking,
  // not one you plan a trip to the menu for (D-101).
  if (button(vp, p, ui, { x: x + 40, y: by, w: bw, h: 52 }, 'Help')) actions.goto('help')
  by += 66
  if (button(vp, p, ui, { x: x + 40, y: by, w: bw, h: 52 }, 'Settings')) actions.goto('settings')
  by += 66
  if (button(vp, p, ui, { x: x + 40, y: by, w: bw, h: 52 }, 'Back to bench')) actions.abandon()
}

// ── Shop ────────────────────────────────────────────────────────────────────────────────

// ── Trophies ────────────────────────────────────────────────────────────────────────────

// `ART_DIRECTION.md §7` asked for a 5x8 wall of plates; the wall went with D-157 — every size
// derives its grid from `trophyGrid` and pages, the way the codes roster does.
const TROPHY_COMPACT_COLS = 2
const TROPHY_COMPACT_ROWS = 5

/**
 * How many pages each paged screen has.
 *
 * Exported so the *actions* can clamp, not just the drawing — D-131. Both drawers have always
 * clamped what they render, which is enough for the `‹ ›` buttons because those disable themselves
 * at the ends. A swipe has no such edge, so without this the stored page walks off past the last
 * one and the way back is as many swipes as you overshot.
 */
/**
 * The compact trophy grid, derived once — DECISIONS D-132.
 *
 * Both the drawing and the page count need it, and they have to agree: a plate now carries its
 * unlock **condition** rather than the word "locked", which is up to two lines, so how many rows
 * fit is a function of the type and the page rather than a constant. Five rows of a two-line plate
 * is 825px on the smallest phone against the 596 the page has, and the overflow lands on the report
 * link in the corner.
 */
export function trophyGrid(vp: Viewport): {
  cols: number
  rows: number
  w: number
  h: number
  top: number
  gapX: number
  gapY: number
} {
  /**
   * The desktop case pages too now — D-157. It was the one grid left in the game drawn as a
   * wall: thirty-four 356x92 plates in five columns, and the report on it was *"let's make
   * trophies also paginated and not so tight."* Three columns of twelve to a page reads like
   * the bench; the compact grid keeps its own shape (D-129).
   */
  const compact = isCompact(vp)
  const cols = compact ? TROPHY_COMPACT_COLS : 3
  const gapX = 20
  const gapY = compact ? 14 : 18
  const size = typeFor(vp, TYPE.body)
  const pagerH = Math.max(40, minControlH(vp, size))
  const pagerY = MARGIN + 24 + boxForCaption(vp, 'Menu', size, { w: 150, h: 40 }).h + 16
  const top = Math.max(152, pagerY + pagerH + 14)
  const left = MARGIN + 56
  const w = Math.floor((LOGICAL_WIDTH - MARGIN - 28 - left - gapX * (cols - 1)) / cols)
  // What a plate needs: a name, then up to two lines of condition, then air.
  const need = size + typeFor(vp, TYPE.dimension) * 2.4 + 30
  const available = reportLink(vp).y - 16 - top
  const maxRows = compact ? TROPHY_COMPACT_ROWS : 5
  const rows = Math.max(1, Math.min(maxRows, Math.floor((available + gapY) / (need + gapY))))
  // Tall enough for the content and the air around it, and no taller than looks deliberate —
  // a 200px plate holding one name and one sentence reads as a mistake, not as spaciousness.
  const h = Math.min(
    Math.ceil(need) + 56,
    Math.max(need, Math.floor((available - gapY * (rows - 1)) / rows)),
  )
  return { cols, rows, w, h, top, gapX, gapY }
}

export function trophyPageCount(vp: Viewport): number {
  const g = trophyGrid(vp)
  return Math.max(1, Math.ceil(ACHIEVEMENTS.length / (g.cols * g.rows)))
}

/**
 * How many pages the codes screen has — counting **what it actually pages** (D-136).
 *
 * The flat layout pages the player's own designs, one row at a time. The compact layout (D-132)
 * merged the two lists into one paged run of four — designs first, then the roster — and this was
 * left counting the designs alone. With no designs that is one page, so `codesPageBy` clamped to
 * page 0 and the `›` button, drawn live and enabled, could never advance: **sixteen of the twenty
 * shareable locks were unreachable on a phone.**
 *
 * It went unseen because the button is *drawn* correctly — the drawing computes its own page count
 * from the real list — and only the action disagreed. Two counts of one thing, which is the bug
 * this signature now makes impossible: the compact branch derives from the same list the drawing
 * builds.
 */
export function codesPageCount(vp: Viewport, saved: number): number {
  if (!isCompact(vp)) return Math.max(1, Math.ceil(saved / codeGrid(vp).cols))
  const shareable = ALL_LOCKS.filter((def) => shareableCode(def) !== null).length
  return Math.max(1, Math.ceil((saved + shareable) / CODES_COMPACT_PER_PAGE))
}

/** Two columns of two, on a phone. Shared so the drawing and the page count cannot disagree. */
export const CODES_COMPACT_PER_PAGE = 4

/**
 * Where the roster starts on the desktop codes page, and how much of it fits — DECISIONS D-147.
 *
 * The roster was drawn in full: twenty cards, five to a row, four rows of 162px. That fits under
 * the status line **only while you have no designs of your own**. Save one and the page grows a
 * heading, a row of cards and its gaps — 136px — and the last row of the roster is drawn through
 * the footer. Reported as *"the codes screen is very overwhelmed — there are 20 locks, and they
 * overlap with the footer."*
 *
 * It survived the layout audit because the audit's save fixture has `customLocks: []`, so the sweep
 * only ever saw the one state that fits. The screen is now audited with designs as well.
 *
 * Returned from **one** function because the page directly above this one is the pager whose count
 * disagreed with its own drawing and made sixteen locks unreachable. The rows are measured against
 * the page rather than chosen, so the roster pages itself exactly when it has to and not before:
 * with no designs it is still one page of twenty, unchanged.
 */
export function codesRoster(saved: number): {
  top: number
  rows: number
  perPage: number
  pages: number
  total: number
} {
  // Mirrors `drawCodes`: the heading at 236, then either the empty line or a row of your designs.
  const afterDesigns = saved === 0 ? 236 + 18 + 44 : 236 + 18 + CODE_CARD_H + 30
  const top = afterDesigns + 18
  const room = LOGICAL_HEIGHT - MARGIN - 40 - top
  const rows = Math.max(1, Math.floor((room + CARD_GAP) / (CODE_CARD_H + CARD_GAP)))
  const total = ALL_LOCKS.filter((def) => shareableCode(def) !== null).length
  const perPage = rows * CODE_COLS
  return { top, rows, perPage, pages: Math.max(1, Math.ceil(total / perPage)), total }
}

/**
 * The trophy case.
 *
 * Earned plates are drawn in full ink with their condition spelled out; locked ones keep the
 * *name* and lose the condition, which is the rule `CONTENT.md §3` sets — a silhouette that
 * still says what it is called, so the case reads as a list of things to go and do rather
 * than a wall of question marks. Aspiration is motivating; hidden content is not.
 *
 * Anything currently unreachable is marked as such rather than quietly greyed in with the
 * rest. A player who has opened every lock in the game should be told *why* one plate is
 * still dark, and "the lock it names has not been built yet" is the honest answer.
 */
export function drawTrophies(c: ShellContext): void {
  const { vp, p, ui, progress, actions } = c
  const { ctx } = vp
  const readable = readableAccents(p)
  const earned = new Set(progress.data.achievements)
  const reachable = ACHIEVEMENTS.filter((a) => a.reachable()).length

  screenFrame(
    c,
    'Trophies',
    c.status ??
      `${earned.size} of ${ACHIEVEMENTS.length} earned  ·  ${reachable} currently earnable`,
  )
  navBar(c, [['Menu', () => actions.goto('menu')]])

  // The pager is placed before the grid because the grid starts below it (D-132).
  const pagerSize = typeFor(vp, TYPE.body)
  const pagerH = Math.max(40, minControlH(vp, pagerSize))
  const pagerW = Math.max(44, Math.ceil(captionWidth(vp, '\u203a', pagerSize)) + 28)
  const pagerY = MARGIN + 24 + boxForCaption(vp, 'Menu', pagerSize, { w: 150, h: 40 }).h + 16
  const pagerRight = LOGICAL_WIDTH - MARGIN - 28

  const left = MARGIN + 56
  // Below the nav bar AND below the pager, which is drawn first and would otherwise be painted
  // over by the first row of plates — invisible, and still stealing the taps meant for them (D-132).
  // From `trophyGrid` at every size now, so the page count cannot disagree with the drawing.
  const top = trophyGrid(vp).top
  /**
   * Two columns and a page turner on a phone — DECISIONS D-129.
   *
   * Reported as *"the achievements screen — the achievements are very small and not readable"*.
   * They were: a plate is 356px wide carrying a condition like "Beat the par time on any lock", and
   * at the compact type scale that sentence is nearly six hundred pixels of type. **Width is the
   * binding constraint here, not height** — which is why this screen could not be fixed the way the
   * bench was, by dropping a column and finding the rows elsewhere. Thirty-four plates wide enough
   * to read is twelve rows, and the page does not scroll.
   *
   * So it pages. Ten plates to a page, four pages, with the same `<` `>` control the codes screen
   * uses. A reference screen you turn is better than one you squint at, and much better than one
   * whose bottom half is drawn past the edge of the phone.
   */
  const g = trophyGrid(vp)
  const cols = g.cols
  const rows = g.rows
  /**
   * The grid is derived from the page's content box, not from a pair of literals — D-132.
   *
   * 908 x 2 plus a 12px gutter is 1828, against a content box of 1816 — so the right-hand column
   * hung 12px past the margin every other screen on this page respects, and the gutter between the
   * columns was the same 12px as the overshoot. The rows then finished 77px above the bottom of the
   * page with that space left unused. Width from the box, and the leftover height spent on the rows
   * that are actually drawn.
   */
  const gapX = g.gapX
  const gapY = g.gapY
  const w = g.w
  const h = g.h
  const perPage = cols * rows
  const pages = trophyPageCount(vp)
  const page = Math.min(Math.max(0, c.trophyPage ?? 0), pages - 1)
  const from = page * perPage
  const nameSize = typeFor(vp, TYPE.body)
  const condSize = typeFor(vp, TYPE.dimension)

  /**
   * The pager, clear of the nav bar and sized up front \u2014 DECISIONS D-132.
   *
   * At y=96 it sat under a nav bar that used to be 40px tall and is now as tall as its own caption
   * needs. Worse, a 44x40 box cannot hold a readable caption, so `button` grew it \u2014 and it grows
   * about the *centre*, taking the extra height off the top and putting the arrows back inside the
   * bar. A control placed below something else has to be given the size it will end up being,
   * rather than discovering it during the draw.
   */
  if (pages > 1) {
    if (
      button(
        vp,
        p,
        ui,
        { x: pagerRight - pagerW * 2 - 12, y: pagerY, w: pagerW, h: pagerH },
        '\u2039',
        { enabled: page > 0 },
      )
    ) {
      actions.trophyPageBy(-1)
    }
    if (
      button(vp, p, ui, { x: pagerRight - pagerW, y: pagerY, w: pagerW, h: pagerH }, '\u203a', {
        enabled: page < pages - 1,
      })
    ) {
      actions.trophyPageBy(1)
    }
  }

  for (let n = 0; n < perPage; n += 1) {
    const i = from + n
    const a = ACHIEVEMENTS[i]
    if (!a) continue
    const col = n % cols
    const row = Math.floor(n / cols)
    if (row >= rows) break
    const x = left + col * (w + gapX)
    const y = top + row * (h + gapY)
    const got = earned.has(a.id)
    const locked = !got && !a.reachable()

    ctx.save()
    ctx.fillStyle = got ? p.paperShade : p.paper
    ctx.fillRect(x, y, w, h)
    ctx.lineWidth = got ? STROKE.standard : STROKE.hairline
    ctx.strokeStyle = got ? p.ink : p.rule
    ctx.strokeRect(snapX(vp, x, STROKE.standard), snapY(vp, y, STROKE.standard), w, h)
    ctx.restore()

    // A filled square for earned, a hollow one for not — the pattern channel, so the case
    // still reads in greyscale and to a colourblind player (ART_DIRECTION.md §1).
    ctx.save()
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = got ? p.ink : p.rule
    ctx.fillStyle = got ? readable.teal : 'transparent'
    if (got) ctx.fillRect(x + 14, y + 16, 14, 14)
    ctx.strokeRect(snapX(vp, x + 14, STROKE.standard), snapY(vp, y + 16, STROKE.standard), 14, 14)
    ctx.restore()

    /**
     * The trophy's own drawing, on the right of its plate — D-159.
     *
     * Earned draws in colour; unearned draws the grayscale copy at reduced strength, so a
     * locked trophy reads as the same picture waiting to be coloured in — the visual sibling
     * of D-132's "say what to do, not that it is locked". The art carries its own cream card
     * background, so it reads on both themes; a thin `rule` frame makes it a deliberate
     * taped-on drawing rather than a floating square. Text yields the width: the name and the
     * condition wrap short of the art rather than under it.
     */
    const artSize = Math.min(h - 20, 130)
    const artX = x + w - artSize - 12
    const artDrawn = drawTrophyArt(ctx, a.id, artX, y + (h - artSize) / 2, artSize, !got)
    if (artDrawn) {
      ctx.save()
      ctx.lineWidth = STROKE.hairline
      ctx.strokeStyle = p.rule
      ctx.strokeRect(
        snapX(vp, artX, STROKE.hairline),
        snapY(vp, y + (h - artSize) / 2, STROKE.hairline),
        artSize,
        artSize,
      )
      ctx.restore()
    }
    const textRoom = (artDrawn ? artX - 14 : x + w - 14) - (x + 40)

    paragraph(ctx, a.name, x + 40, y + nameSize + 10, {
      font: font(nameSize),
      // `rule` is the hairline tone — 1.56:1 on paper. A name nobody can read is not a name
      // (D-135); unreachable trophies are already marked by their own explanatory line.
      color: got ? p.ink : p.inkLight,
      maxWidth: textRoom,
      lineHeight: nameSize + 4,
      maxLines: 1,
    })
    paragraph(
      ctx,
      /*
       * An unearned trophy says what to *do*, not that it is locked \u2014 DECISIONS D-132.
       *
       * The page drew ten identical rows of "\u2014 locked \u2014", which is a list of things you cannot have
       * with no way to find out how to have them: a dead end on a screen whose whole job is to give
       * you something to aim at. Every achievement already carries its own condition \u2014 the earned
       * ones were showing it \u2014 so the text was there the entire time and only the earned half of
       * the screen was allowed to use it.
       */
      locked ? 'Needs a lock that is not in the game yet' : a.condition,
      x + 40,
      y + nameSize + condSize + 20,
      {
        font: font(condSize),
        /*
         * An unearned condition is `inkLight`, not `rule` — DECISIONS D-135.
         *
         * `rule` is the hairline colour: 1.56:1 on paper, which is a tone for *lines*, not for
         * words. It was the right choice while this line read "— locked —" and was deliberately
         * a ghost. D-132 made it carry the actual unlock condition — the one thing on the screen
         * telling you how to earn the trophy — and left it in the ghost colour, so the page's whole
         * purpose was drawn in text nobody can read. Earned versus unearned is already carried by
         * the filled square and the name's own colour.
         */
        color: p.inkLight,
        // Short of the trophy's drawing, not under it (D-159).
        maxWidth: textRoom,
        lineHeight: condSize + 4,
        maxLines: 2,
      },
    )
  }
}

/**
 * The lock editor — `docs/CUSTOM_LOCKS.md` step 5, DECISIONS D-080.
 *
 * How many chambers, then per chamber a bitting depth, a driver profile and a spring. The right-hand
 * readouts are the point: `sets at` and the false-set count are what the three numbers you are
 * choosing actually *mean* in the simulation, and an editor that makes you build-and-test to find
 * that out is an editor nobody opens twice.
 *
 * Depth is clamped as you turn it rather than validated afterwards (`maxDepthFor`), so a lock whose
 * grooves sit above the shear line — one that could never false-set — is unreachable instead of
 * merely rejected.
 */
// ── Share codes ─────────────────────────────────────────────────────────────────────────

/**
 * One lock, as a picture and a code, on a card the size of a bench card.
 *
 * The whole card is the button. A 288x112 target that copies on click beats a 60px `Copy` button
 * beside it, costs no pixels, and means the picture and the string that produces it are the same
 * object rather than two things that happen to be adjacent.
 */
function codeCard(
  c: ShellContext,
  def: LockDef,
  rect: Rect,
  playable: boolean,
  /** Index into the player's own locks, when this is one of theirs — the only deletable kind. */
  customIndex?: number,
): void {
  const { vp, p, ui, actions } = c
  const { ctx } = vp
  const code = shareableCode(def)
  const readable = readableAccents(p)
  /**
   * Registered for the frame only — never read for `activated`.
   *
   * The card holds three buttons of its own now, and a card that also acted on a click would fire
   * its own action underneath whichever button was pressed. `cardFrame` wants a `WidgetState` for
   * the hover lightening, so it gets one; the clicks belong entirely to the buttons.
   */
  const st = ui.widget(rect, false)
  cardFrame(vp, p, rect, { ...st, hovered: false }, code === null)

  /*
   * Laid out as a measured stack — DECISIONS D-132.
   *
   * Every offset in here used to be a literal tuned against a 21px face: the name at +28, the glyph
   * at +36, two stat lines at +52 and +72, the code at +92 and a 28px button row at the bottom. The
   * moment the type scaled (D-132) the name landed on the chamber count, the code landed on the
   * buttons, and `button`'s shrink-to-fit ground PLAY/EDIT/COPY down to five CSS pixels. A stack
   * spaced by its own measured type cannot come apart that way, which is the same lesson D-129 drew
   * from the readout column.
   */
  const dim = typeFor(vp, TYPE.dimension)
  const body = typeFor(vp, TYPE.body)
  const pad = 14
  let cy = rect.y + pad + body
  paragraph(ctx, def.name, rect.x + pad, cy, {
    font: font(body),
    color: p.ink,
    maxWidth: rect.w - pad * 2,
    lineHeight: body + 4,
    maxLines: 1,
  })
  cy += 10

  /*
   * One stat line, not two — DECISIONS D-132.
   *
   * The card is 136px and has five things to stack in it: name, drawing, stats, code, buttons. Two
   * stat lines is one more than fits, and what it cost was the **code** — the one thing this page
   * exists to show — printed through the row of buttons beneath it. Chambers and security count are
   * one fact about the lock and read perfectly well on one line.
   */
  /**
   * No lock drawing on the card at a phone's size — DECISIONS D-135.
   *
   * It is 88x55 logical, which is **26x16 CSS px** on the smallest phone, and inside it the groove
   * that is the entire point of the drawing comes out 0.30 CSS px deep. Zoomed, it is a hatched
   * box; at size it is a smudge.
   *
   * And it can never be anything else *here*, which is what settles it: every lock on this screen
   * is a pin tumbler by construction — the roster is filtered by `shareableCode(def) !== null` and
   * `shareProblem` rejects every other family — so the one distinction that would read at 26x16,
   * the family silhouette, cannot occur. What is left is a thread count already printed in words
   * beside it and a security-pin count already printed in violet.
   *
   * Cutting it also straightens the card: the stat line was the only row indented past the name
   * above it and the code below, and on the smallest phone the stack it sat in overran its own box
   * — the code line was being clamped against the button row. The drawing survives everywhere it
   * can actually be read: the bench card, the editor preview, and the pick screen at full size.
   */
  const security = def.pins.filter((pin) => PROFILES[pin].grooveCount > 0).length
  const tiny = isCompact(vp)
  // The drawing takes whatever height the card has left over the fixed stack (name, code,
  // buttons, padding ≈ 140px) — on the 200px card that is a readable 60px lock rather than the
  // 31px strip the old 150px card could spare (D-155).
  const glyphH = Math.max(26, Math.floor(dim * 1.5), rect.h - 140)
  const glyphW = tiny ? 0 : Math.min(Math.floor(glyphH * 3), Math.floor(rect.w * 0.34))
  if (!tiny) drawLockGlyph(vp, p, def, { x: rect.x + pad, y: cy, w: glyphW, h: glyphH }, code === null)
  text(
    ctx,
    `${chambersOf(def)} chambers · ${security === 0 ? 'all standard' : `${security} security`}`,
    rect.x + pad + (tiny ? 0 : glyphW + 12),
    cy + (tiny ? dim : glyphH / 2 + dim * 0.36),
    { font: font(dim), color: security > 0 ? readable.violet : p.inkLight },
  )
  cy += (tiny ? dim + 10 : glyphH) + 8

  // The button row's geometry, needed before the code line that sits just above it.
  const bh = Math.max(28, minControlH(vp, dim))
  const by = rect.y + rect.h - pad - bh

  if (code === null) {
    // The actual reason, not a stand-in for it. "not a pin tumbler" was printed on every codeless
    // card and was true of three of them; the rest were rejected for cuts the format cannot reach,
    // and a wrong explanation is worse than none (D-099).
    paragraph(ctx, `no code — ${shareProblem(def) ?? ''}`, rect.x + pad, cy + dim, {
      font: font(dim),
      color: p.inkLight,
      maxWidth: rect.w - pad * 2,
      lineHeight: dim + 4,
      maxLines: 2,
    })
    return
  }
  // Anchored to the button row rather than to the flow above it: the card has a fixed height on a
  // full page, so the last thing before the buttons has to be placed from the bottom up.
  text(ctx, formatCode(code), rect.x + pad, Math.min(cy + dim, by - 10), {
    font: font(dim),
    color: p.inkLight,
  })

  /**
   * Play it, edit it, copy it — three buttons, because a page of locks you can only *copy* is a
   * filing cabinet.
   *
   * Reported as *"in CODES I want to be able to edit immediately or play with them, not just copy
   * the code."* Play starts the lock; Edit loads it into the editor as a copy to change; Copy is
   * what the card used to do on click.
   *
   * **Play is gated the way the bench gates it.** A roster lock four tiers ahead is not playable
   * from here just because this page happens to list every lock in the game — that would make the
   * codes screen a way around the progression rather than a way around the clipboard. Locks you
   * made yourself are always playable: they were never gated.
   */
  /*
   * Tall enough that `button` will not shrink its caption below the readability floor — and no
   * taller. `dim * 2` would be 44 on a full page, where 30 is enough, and 136px of card cannot
   * spare the difference: it was the code line that ended up printed across the button row.
   * Declared above, beside the code line that is placed relative to it.
   */
  // Four buttons on a lock of your own, three on one of the game's — sized to the card's inner
  // width so the row is even either way.
  const deletable = customIndex !== undefined
  const inner = rect.w - 32
  const count = deletable ? 4 : 3
  const bw = Math.floor((inner - 8 * (count - 1)) / count)
  const step = bw + 8
  let bx = rect.x + 16
  if (
    button(vp, p, ui, { x: bx, y: by, w: bw, h: bh }, 'play', {
      size: TYPE.dimension,
      enabled: playable,
    })
  ) {
    actions.startLock(def)
  }
  bx += step
  if (
    button(vp, p, ui, { x: bx, y: by, w: bw, h: bh }, 'edit', {
      size: TYPE.dimension,
    })
  ) {
    actions.editDef(def)
  }
  bx += step
  if (
    button(vp, p, ui, { x: bx, y: by, w: bw, h: bh }, 'copy', {
      size: TYPE.dimension,
    })
  ) {
    actions.copyText(formatCode(code), `the code for ${def.name}`)
  }
  if (!deletable || customIndex === undefined) return

  /**
   * Delete, in two clicks — because there is no undo and never can be.
   *
   * A lock you designed exists in exactly one place, and a mis-click on a 58px button would end it.
   * The first click **arms**: this card's button turns crimson and reads `sure?`, and every other
   * card's disarms, so only one thing is ever primed at a time. The second click on the same button
   * removes it. Clicking anywhere else — another card, another screen — disarms and nothing is lost.
   *
   * Deliberately not a modal: this page is a grid you sweep through deleting three or four codes
   * somebody sent you, and a dialog per deletion turns that into a chore. See DECISIONS D-101.
   */
  bx += step
  const armed = c.armedDelete === def.slug
  if (
    button(vp, p, ui, { x: bx, y: by, w: bw, h: bh }, armed ? 'sure?' : 'del', {
      size: TYPE.dimension,
      primary: armed,
    })
  ) {
    if (armed) actions.deleteCustomLock(customIndex)
    else actions.armDelete(def.slug)
  }
}

/**
 * The codes screen — where a share code goes and where one comes from.
 *
 * D-093 built the format and the editor's Copy button and stopped there, which left the feature
 * complete and unusable: nothing in the game said codes existed, nothing showed you one for a lock
 * you had actually played, and a code somebody sent you could only be pasted while standing in the
 * editor with a draft open. The mechanism was finished; the *place* was missing.
 *
 * So: every lock in the game as a picture with its code under it, the player's own designs first,
 * one button to take a code off the clipboard, and the address of the site to send people to. See
 * DECISIONS D-099.
 */
/**
 * The codes page on a phone — a different page, not the same one squeezed.
 *
 * The flat layout was five columns of 136px cards, twenty-two of them (three of 200 since
 * D-155), with an intro paragraph, an entry field, and two headed sections. At a phone's scale
 * the five-column card was 96 CSS px wide holding
 * four lines of type and three buttons, which is the *"very small — every piece of the element,
 * and it looks like a mess"* in the report; the layout sweep counted over a thousand findings on
 * this screen alone, two thirds of everything left in the game.
 *
 * Nothing here is squeezed, because squeezing is what produced that. The intro goes (the page is
 * titled *Share codes*; the sentence explains what a code is to somebody already reading a page
 * about codes), the entry field takes the full width it needs, and the two lists become **one**
 * paged list of four — designs first, then the roster, with the heading naming whichever the
 * current page is showing. One list means one pager and one swipe target, which is the right
 * number for a thumb. See DECISIONS D-132.
 */
function drawCodesCompact(c: ShellContext): void {
  const { vp, p, ui, progress, actions } = c
  const { ctx } = vp
  const readable = readableAccents(p)
  screenFrame(c, 'Share codes', c.status ?? creditLine(progress))
  navBar(c, [
    ['Editor', () => actions.goto('editor')],
    ['Bench', () => actions.goto('bench')],
    ['Menu', () => actions.goto('menu')],
  ])

  const dim = typeFor(vp, TYPE.dimension)
  const body = typeFor(vp, TYPE.body)
  const heading = typeFor(vp, TYPE.heading)
  const taught = progress.data.tutorial.length > 0
  const entry = c.codeEntry ?? ''
  const decoded = entry.trim() === '' ? null : decodeLock(entry, progress.data.customLocks.length)

  // ── The entry row, across the top ──────────────────────────────────────────────────────
  /*
   * No "have a code?" heading on a phone — DECISIONS D-134.
   *
   * The field underneath it reads "type or paste a code". A label whose only content is the
   * question its own control already asks is a row of type spent on nothing.
   */
  let y = 150
  y += 14
  const fieldH = Math.max(64, body * 2 + 16)
  const paste = boxForCaption(vp, 'Paste', body, { w: 150, h: fieldH })
  const add = boxForCaption(vp, 'Add', body, { w: 130, h: fieldH })
  const fieldW = LOGICAL_WIDTH - MARGIN - 28 - BENCH_LEFT - paste.w - add.w - 24
  const boxRect: Rect = { x: BENCH_LEFT, y, w: fieldW, h: fieldH }
  const boxState = ui.widget(boxRect)
  cardFrame(vp, p, boxRect, boxState, false)
  label(
    ctx,
    entry === ''
      ? c.codeFocus
        ? '_'
        : 'type or paste a code'
      : `${entry}${c.codeFocus ? '_' : ''}`,
    boxRect.x + 12,
    boxRect.y + fieldH / 2 + body * 0.36,
    {
      font: font(body),
      size: body,
      // A placeholder is de-emphasised, not invisible: `rule` is 1.36:1 and WCAG applies to
      // placeholder text like any other (D-135).
      color: entry === '' && !c.codeFocus ? p.inkLight : c.codeFocus ? readable.amber : p.ink,
    },
  )
  if (boxState.activated) actions.codeFocus(!c.codeFocus)
  if (button(vp, p, ui, { x: boxRect.x + fieldW + 12, y, w: paste.w, h: fieldH }, 'Paste')) {
    actions.codePaste()
  }
  if (
    button(vp, p, ui, { x: boxRect.x + fieldW + paste.w + 24, y, w: add.w, h: fieldH }, 'Add', {
      primary: true,
      enabled: decoded !== null && decoded.problem === null,
    })
  ) {
    actions.codeSubmit()
  }
  y += fieldH + 8
  text(
    ctx,
    decoded === null
      ? 'letters and digits, in groups of four'
      : decoded.problem !== null
        ? decoded.problem
        : `${decoded.def.bitting.length} chambers · ready to add`,
    BENCH_LEFT,
    y + dim,
    {
      font: font(dim),
      color:
        decoded !== null && decoded.problem !== null
          ? readable.crimson
          : decoded !== null
            ? readable.teal
            : p.inkLight,
    },
  )
  // The heading below is a 47px face on a phone and hangs 34px above its own baseline, so the
  // gap has to be measured from *it*, not from the line above (D-132).
  y += dim + Math.round(heading * 0.9)

  // ── One list: your designs, then the roster ────────────────────────────────────────────
  const custom = progress.data.customLocks
  const roster = ALL_LOCKS.filter((def) => shareableCode(def) !== null)
  const all = [
    ...custom.map((def, i) => ({ def, own: true, index: i })),
    ...roster.map((def) => ({ def, own: false, index: -1 })),
  ]
  const cols = 2
  const rows = 2
  const perPage = CODES_COMPACT_PER_PAGE
  const pages = codesPageCount(vp, custom.length)
  const page = Math.min(Math.max(0, c.codesPage ?? 0), pages - 1)
  const shown = all.slice(page * perPage, page * perPage + perPage)
  const owned = shown.filter((s) => s.own).length
  label(
    ctx,
    owned === shown.length
      ? 'your designs'
      : owned > 0
        ? 'your designs · the roster'
        : 'the roster',
    BENCH_LEFT,
    y,
    { font: font(heading), size: heading, color: p.ink },
  )
  const pageBox = boxForCaption(vp, '‹', body, { w: 64, h: Math.max(52, body * 2 + 10) })
  const pagerY = y - heading
  const pagerX = LOGICAL_WIDTH - MARGIN - 28 - pageBox.w * 2 - 12
  if (button(vp, p, ui, { x: pagerX, y: pagerY, ...pageBox }, '‹', { enabled: page > 0 })) {
    actions.codesPageBy(-1)
  }
  if (
    button(vp, p, ui, { x: pagerX + pageBox.w + 12, y: pagerY, ...pageBox }, '›', {
      enabled: page < pages - 1,
    })
  ) {
    actions.codesPageBy(1)
  }
  text(
    ctx,
    `${page * perPage + 1}–${page * perPage + shown.length} of ${all.length}`,
    pagerX - 16,
    y,
    { font: font(dim), color: p.inkLight, align: 'right' },
  )

  y += 20
  const gridW = LOGICAL_WIDTH - MARGIN - 28 - BENCH_LEFT
  const cardW = Math.floor((gridW - CARD_GAP) / cols)
  /*
   * The grid stops above the report link, not at a guess — DECISIONS D-132.
   *
   * That link is a registered widget in the bottom-right corner, and the widget layer has no
   * z-order: two rects containing the same point both report activated, so a card's COPY button
   * drawn under it would copy the code *and* open a GitHub issue on one tap. The link also grew
   * with its own caption in this pass, so the old fixed 70px reserve stopped being enough.
   */
  const cardH = Math.floor((reportLink(vp).y - 12 - y - CARD_GAP) / rows)
  shown.forEach((item, i) => {
    codeCard(
      c,
      item.def,
      {
        x: BENCH_LEFT + (cardW + CARD_GAP) * (i % cols),
        y: y + Math.floor(i / cols) * (cardH + CARD_GAP),
        w: cardW,
        h: cardH,
      },
      item.own ? taught : taught && progress.isTierUnlocked(item.def.tier),
      ...(item.own ? ([item.index] as const) : ([] as const)),
    )
  })
}

export function drawCodes(c: ShellContext): void {
  if (isCompact(c.vp)) {
    drawCodesCompact(c)
    return
  }
  const { vp, p, ui, progress, actions } = c
  const { ctx } = vp
  const readable = readableAccents(p)
  screenFrame(c, 'Share codes', c.status ?? creditLine(progress))

  navBar(c, [
    ['Editor', () => actions.goto('editor')],
    ['Bench', () => actions.goto('bench')],
    ['Menu', () => actions.goto('menu')],
  ])

  /**
   * "A short code", not "sixteen characters" — because it is not sixteen characters.
   *
   * `encodeLock` packs a header plus one group per chamber, so the length tracks the lock: a
   * two-pin practice cutaway comes out at eleven characters and a sixteen-chamber design from the
   * editor at forty-six. The copy has said "sixteen" since D-093, when the format was fixed-width,
   * and every card on this page has been visibly contradicting it ever since. See D-109.
   */
  paragraph(
    ctx,
    'Every lock below packs into a short code — longer for a bigger lock. Copy one, paste it to ' +
      'anybody, and they pick the lock you did.',
    BENCH_LEFT,
    108,
    {
      font: font(typeFor(vp, TYPE.body)),
      color: p.ink,
      maxWidth: 980,
      lineHeight: 30,
      maxLines: 2,
    },
  )

  /**
   * A box you type a code into — and the Paste button now fills it rather than acting on its own.
   *
   * The only way to bring a code in was a button that read the clipboard, which is a thing people
   * have to be told exists: *"paste from the clipboard is not very obvious."* A field is the shape
   * everybody already recognises for "put a code here", it works for somebody reading a code off a
   * phone, and it makes Paste honest — you see what arrived before it becomes a lock on your bench.
   *
   * Validated as you type, out of `decodeLock`'s own sentences, so a code that is one character
   * short says so at the character rather than at the button. See DECISIONS D-101.
   */
  const entry = c.codeEntry ?? ''
  // The whole group is 620 wide and the frame's inner edge is at `LOGICAL_WIDTH - MARGIN`, so 640
  // leaves the Add button 20px clear of it instead of drawn against it.
  const boxX = LOGICAL_WIDTH - MARGIN - 640
  /*
   * The group starts under the nav row, not beside it — D-157. `have a code?` sat at y=104 and
   * the nav's buttons, grown to their captions since D-132, reach y=103: the label printed
   * straight under EDITOR. Reported as *"HAVE A CODE? text overlaps with EDITOR."*
   */
  label(ctx, 'have a code?', boxX, 126, {
    font: font(typeFor(vp, TYPE.dimension)),
    size: typeFor(vp, TYPE.dimension),
    // Full ink: at this position the label sits across a grid line, and `inkLight` on `rule`
    // is 3.92:1 against AA's 4.5 — the ground D-148 measured.
    color: p.ink,
  })
  const boxRect: Rect = { x: boxX, y: 140, w: 360, h: 44 }
  const boxState = ui.widget(boxRect)
  cardFrame(vp, p, boxRect, boxState, false)
  /*
   * Fitted to the field — D-157. The placeholder at the heading face is 363px of tracked caps in
   * a 360px box, so its tail hung out through the border; a long typed code did the same. The
   * face shrinks until the string fits, and a string no face can hold keeps its **tail**, because
   * the tail is where the caret is.
   */
  {
    const shown =
      entry === ''
        ? c.codeFocus
          ? '_'
          : 'type or paste a code'
        : `${entry}${c.codeFocus ? '_' : ''}`
    const room = boxRect.w - 24
    let fieldSize = typeFor(vp, TYPE.heading)
    let visible = shown
    ctx.save()
    while (fieldSize > 14 && captionWidth(vp, visible, fieldSize) > room) fieldSize -= 1
    while (visible.length > 4 && captionWidth(vp, `…${visible.slice(1)}`, fieldSize) > room) {
      visible = visible.slice(1)
    }
    if (visible !== shown) visible = `…${visible.slice(1)}`
    ctx.restore()
    label(ctx, visible, boxRect.x + 12, boxRect.y + 22 + fieldSize * 0.36, {
      font: font(fieldSize),
      size: fieldSize,
      // Same as the compact field: a placeholder is de-emphasised, not invisible (D-135).
      color: entry === '' && !c.codeFocus ? p.inkLight : c.codeFocus ? readable.amber : p.ink,
    })
  }
  if (boxState.activated) actions.codeFocus(!c.codeFocus)

  const decoded = entry.trim() === '' ? null : decodeLock(entry, progress.data.customLocks.length)
  if (button(vp, p, ui, { x: boxX + 372, y: 140, w: 108, h: 44 }, 'Paste')) actions.codePaste()
  if (
    button(vp, p, ui, { x: boxX + 490, y: 140, w: 130, h: 44 }, 'Add', {
      primary: true,
      enabled: decoded !== null && decoded.problem === null,
    })
  ) {
    actions.codeSubmit()
  }
  if (
    entry !== '' &&
    button(vp, p, ui, { x: boxX + 372, y: 192, w: 108, h: 26 }, 'clear', {
      size: TYPE.dimension,
    })
  ) {
    actions.codeClear()
  }
  text(
    ctx,
    decoded === null
      ? 'letters and digits, in groups of four — type it, or press Paste'
      : decoded.problem !== null
        ? decoded.problem
        : `${decoded.def.bitting.length} chambers · ready to add`,
    boxX,
    // Below the `clear` button, not level with it: level, the sentence ran underneath it.
    232,
    {
      font: font(typeFor(vp, TYPE.dimension)),
      color:
        decoded !== null && decoded.problem !== null
          ? readable.crimson
          : decoded !== null
            ? readable.teal
            : p.inkLight,
    },
  )

  /**
   * The page has 1080px and no scrolling, and the roster is five rows of cards on its own.
   *
   * Every number below is spent against that: 206 to start, and 30 between the bottom of the
   * player's own row and the baseline of the roster heading — a 22px heading needs more than the
   * 14 it had, or it prints into the card above it. At 232 and 26 the last row of the roster
   * printed *through* the status line, which the overflow warning then dutifully reported, on top
   * of the status line, in red.
   */
  // 236, not 206 — the have-a-code group moved down from under the nav row (D-157), and a third
  // design card's top corner was already within a graze of the group's own hint line.
  let y = 236
  // Same gate as the bench: the first lesson unlocks the game, and this page is not a way past it.
  const taught = progress.data.tutorial.length > 0
  const custom = progress.data.customLocks
  label(ctx, 'your designs', BENCH_LEFT, y, {
    font: font(typeFor(vp, TYPE.heading)),
    size: typeFor(vp, TYPE.heading),
    color: p.ink,
  })
  y += 18
  if (custom.length === 0) {
    text(
      ctx,
      'none yet — build one in the Editor, or paste a code somebody sent you',
      BENCH_LEFT,
      y + 18,
      { font: font(typeFor(vp, TYPE.body)), color: p.inkLight },
    )
    y += 44
  } else {
    /**
     * Six at a time, with arrows — because the page cannot grow and the list can.
     *
     * It used to draw the first six and say *"+N more on the bench"*, which was wrong twice: there
     * was no way to reach the rest, and the bench it pointed at does not list custom locks at all.
     * Asked as *"how to scroll the codes?"* — and the answer is that nothing in this game scrolls,
     * for the reasons D-100 sets out, so a bounded list gets a pager instead. The count is spelled
     * out (`7–12 of 31`) so it is never ambiguous whether anything is being held back.
     */
    const cg = codeGrid(vp)
    const pages = codesPageCount(vp, custom.length)
    const page = Math.min(Math.max(0, c.codesPage ?? 0), pages - 1)
    const from = page * cg.cols
    const shown = custom.slice(from, from + cg.cols)
    if (pages > 1) {
      if (
        button(vp, p, ui, { x: BENCH_LEFT + 210, y: y - 22, w: 40, h: 28 }, '‹', {
          size: TYPE.body,
          enabled: page > 0,
        })
      ) {
        actions.codesPageBy(-1)
      }
      if (
        button(vp, p, ui, { x: BENCH_LEFT + 258, y: y - 22, w: 40, h: 28 }, '›', {
          size: TYPE.body,
          enabled: page < pages - 1,
        })
      ) {
        actions.codesPageBy(1)
      }
      text(ctx, `${from + 1}–${from + shown.length} of ${custom.length}`, BENCH_LEFT + 312, y, {
        font: font(typeFor(vp, TYPE.dimension)),
        color: p.inkLight,
      })
    }
    shown.forEach((def, i) => {
      // Your own locks were never tier-gated — they are not on the ladder at all.
      codeCard(
        c,
        def,
        {
          x: BENCH_LEFT + (cg.cardW + CARD_GAP) * i,
          y,
          w: cg.cardW,
          h: cg.cardH,
        },
        taught,
        from + i,
      )
    })
    y += cg.cardH + 30
  }

  label(ctx, 'the roster', BENCH_LEFT, y, {
    font: font(typeFor(vp, TYPE.heading)),
    size: typeFor(vp, TYPE.heading),
    color: p.ink,
  })
  /**
   * Only the locks that **have** a code.
   *
   * Five of the twenty-five cannot be written as one — three disc detainers, which have no
   * pin-tumbler bitting to pack at all, and two cut past the depth a base32 digit reaches. They
   * were listed anyway, greyed, each explaining its own absence, which is five cards of apology on
   * a page whose entire subject is codes. *"Remove disc detainer from the codes."*
   *
   * The count is still said out loud below, because a roster that quietly shows twenty of
   * twenty-five is the silent-truncation habit this project keeps having to dig out of itself.
   */
  const roster = ALL_LOCKS.filter((def) => shareableCode(def) !== null)
  const missing = ALL_LOCKS.length - roster.length
  if (missing > 0) {
    text(
      ctx,
      `${roster.length} of ${ALL_LOCKS.length} — the rest cannot be written as a code`,
      BENCH_LEFT + 190,
      y,
      {
        font: font(typeFor(vp, TYPE.dimension)),
        color: p.inkLight,
      },
    )
  }
  /**
   * Paged to whatever the page has left for it — DECISIONS D-147.
   *
   * `codesRoster` measures the room under the heading rather than assuming four rows will do, so
   * this is one page of twenty for a player with no designs of their own — unchanged — and pages
   * itself the moment their own row pushes it down. The count comes from the same call the pager's
   * action uses, which is the property the pager above this one lacked (D-136).
   */
  const rs = codesRoster(custom.length)
  const rosterPage = Math.min(Math.max(0, c.rosterPage ?? 0), rs.pages - 1)
  const rosterFrom = rosterPage * rs.perPage
  const rosterShown = roster.slice(rosterFrom, rosterFrom + rs.perPage)
  if (rs.pages > 1) {
    /*
     * Anchored to the **right** of the frame, not to a gap after the heading.
     *
     * The heading's line already carries a sentence of unknown length — `20 of 22 — the rest cannot
     * be written as a code` — and the first version of this put the arrows at a literal offset that
     * landed 11px inside it. The right edge is the one fixed thing on the row.
     */
    const pagerRight = LOGICAL_WIDTH - MARGIN - 28
    if (
      button(vp, p, ui, { x: pagerRight - 88, y: y - 22, w: 40, h: 28 }, '‹', {
        size: TYPE.body,
        enabled: rosterPage > 0,
      })
    ) {
      actions.rosterPageBy(-1)
    }
    if (
      button(vp, p, ui, { x: pagerRight - 40, y: y - 22, w: 40, h: 28 }, '›', {
        size: TYPE.body,
        enabled: rosterPage < rs.pages - 1,
      })
    ) {
      actions.rosterPageBy(1)
    }
    text(
      ctx,
      `${rosterFrom + 1}–${rosterFrom + rosterShown.length} of ${roster.length}`,
      pagerRight - 104,
      y,
      { font: font(typeFor(vp, TYPE.dimension)), color: p.inkLight, align: 'right' },
    )
  }
  y += 18
  const rosterGrid = codeGrid(vp)
  rosterShown.forEach((def, i) => {
    const col = i % rosterGrid.cols
    const row = Math.floor(i / rosterGrid.cols)
    codeCard(
      c,
      def,
      {
        x: BENCH_LEFT + (rosterGrid.cardW + CARD_GAP) * col,
        y: y + row * (rosterGrid.cardH + CARD_GAP),
        w: rosterGrid.cardW,
        h: CODE_CARD_H,
      },
      taught && progress.isTierUnlocked(def.tier),
    )
  })
  y += Math.ceil(rosterShown.length / CODE_COLS) * (CODE_CARD_H + CARD_GAP)

  // Same rule as the bench: this page does not scroll, so if it ever outgrows the stage, say so
  // rather than quietly dropping the last row off the bottom.
  if (y > LOGICAL_HEIGHT - MARGIN - 40) {
    text(
      ctx,
      `codes page overflows by ${Math.ceil(y - (LOGICAL_HEIGHT - MARGIN - 40))}px`,
      BENCH_LEFT,
      y,
      {
        font: font(typeFor(vp, TYPE.dimension)),
        color: readable.crimson,
      },
    )
  }
}

/**
 * Below this stage scale the editor does not fit, and says so — DECISIONS D-132.
 *
 * It is the densest screen in the game: a name field, two spinners, a keyway control, a table of up
 * to sixteen rows and five columns, an action row, a share-code block, a preview and a shelf. On a
 * 658x320 phone the compact type scale is 2.2x and the stage is still 1080 tall, so the header
 * alone takes 560 of the 740px the table has — leaving 36px rows for controls that need 84.
 *
 * That is arithmetic, not a layout that needs tuning. Dropping the preview and the shelf buys width
 * and this is a height problem; shrinking the row type far enough would put it under four CSS
 * pixels, which is the thing this whole pass exists to prevent. Every other screen in the game was
 * made to fit a phone because every other screen is something you *play*; this one is an authoring
 * tool, and an authoring tool that admits it needs a bigger window is better than one that draws
 * its controls on top of each other and lets you press the wrong pin.
 *
 * 0.34 is where a five-chamber draft still gets rows tall enough to touch — a Galaxy S24 and up.
 */
export const EDITOR_MIN_SCALE = 0.34

export function drawEditor(c: ShellContext): void {
  const { vp, p, ui, actions, progress } = c
  const draft = c.draft
  if (!draft) return
  if (vp.scale < EDITOR_MIN_SCALE) {
    screenFrame(c, 'Editor', 'the editor needs a larger screen')
    navBar(c, [
      ['Codes', () => actions.goto('codes')],
      ['Bench', () => actions.goto('bench')],
      ['Menu', () => actions.goto('menu')],
    ])
    const size = typeFor(vp, TYPE.body)
    paragraph(
      c.vp.ctx,
      'The editor lays out a table of up to sixteen chambers, and there is not enough height for ' +
        'it here. Turn to a larger screen — a tablet, or a desktop — and it is waiting. Codes ' +
        'somebody sent you still open on the Share codes page.',
      MARGIN + 60,
      260,
      {
        font: font(size),
        color: p.ink,
        maxWidth: LOGICAL_WIDTH - MARGIN * 2 - 120,
        lineHeight: size + 10,
        maxLines: 4,
      },
    )
    return
  }
  const { ctx } = vp
  // The saved count belongs *in* the status line. As a second line of its own it sat 10px above the
  // one `screenFrame` draws, and 10px is not a line of 15px type — the two printed through each
  // other in the bottom-left corner of every visit to this screen (D-099).
  screenFrame(
    c,
    'Editor',
    c.status ??
      `design a lock, then tap Test pick  ·  ${progress.data.customLocks.length} saved to the bench`,
  )
  navBar(c, [
    ['Codes', () => actions.goto('codes')],
    ['Bench', () => actions.goto('bench')],
    ['Menu', () => actions.goto('menu')],
  ])

  const problem = draftProblem(draft, progress.data.customLocks.length)
  const readable = readableAccents(p)
  const left = BENCH_LEFT
  /**
   * Two sizes on this screen and no others — reported as *"the editor has very different font
   * sizes"*, which it did: four.
   *
   * `dimension` is every column header and every annotation; `body` is every value you can change.
   * The chamber count and the tolerance were at `heading` for no reason but that they are numbers,
   * so a row of controls stepped 22 / 15 / 18 / 18 / 15 / 15 across its width and read as five
   * unrelated widgets. Size here has one job: telling a *label* from a *value*. The share code
   * keeps `heading` because it is the one thing on the screen you read a character at a time.
   * See DECISIONS D-099.
   */
  const dim = {
    font: font(typeFor(vp, TYPE.dimension)),
    size: typeFor(vp, TYPE.dimension),
    color: p.inkLight,
  }
  const value = { font: font(typeFor(vp, TYPE.body)), size: typeFor(vp, TYPE.body), color: p.ink }

  // ── The lock as a whole ───────────────────────────────────────────────────────────────
  label(ctx, 'name', left, 112, dim)
  const nameRect: Rect = {
    x: left,
    y: 122,
    w: 420,
    h: Math.max(40, minControlH(vp, typeFor(vp, TYPE.body))),
  }
  const nameState = ui.widget(nameRect)
  cardFrame(vp, p, nameRect, nameState, false)
  label(ctx, `${draft.name}${c.editingName ? '_' : ''}`, nameRect.x + 12, nameRect.y + 26, {
    font: font(typeFor(vp, TYPE.body)),
    size: typeFor(vp, TYPE.body),
    color: c.editingName ? readable.amber : p.ink,
  })
  if (nameState.activated) actions.editorFocusName(!c.editingName)
  text(
    ctx,
    c.editingName ? 'typing — tap again or press enter to stop' : 'tap to rename',
    nameRect.x + nameRect.w + 16,
    nameRect.y + 26,
    { font: font(typeFor(vp, TYPE.dimension)), color: p.inkLight },
  )

  /**
   * The lock-wide controls, laid out by measurement rather than by literal offsets (D-132).
   *
   * Every x in this row used to be a constant tuned against a 21px face — the spinners at +0/+100,
   * tolerance at +210/+330, the capture window at +386, the keyway at +620. At the compact scale
   * that face is 38px, so `capture window 0.62 mm` was printed straight across the STANDARD/TIGHT
   * control and the chamber count landed on its own `+`. D-102 already caught this row once, at
   * 18px to 21px, and fixed it by moving the literals; the literals were the problem.
   *
   * On a phone it wraps to two rows, because measured or not, four controls at the compact face are
   * 1200px wide and the preview panel starts at 1032.
   */
  // The right-hand column, declared here because the header row clamps against it (D-133).
  const rightX = left + 980
  const rightW = LOGICAL_WIDTH - MARGIN - 28 - rightX

  const editorCompact2 = isCompact(vp)
  const bodySize = typeFor(vp, TYPE.body)
  const dimSize = typeFor(vp, TYPE.dimension)
  const spin = boxForCaption(vp, '+', bodySize, { w: 38, h: 34 })
  const gap = 12
  // Below the name field and the label that belongs to this row — 186 was measured against a
  // 17px label under a 40px field, and both grow with the type now (D-132).
  const rowY = Math.max(186, 122 + nameRect.h + typeFor(vp, TYPE.dimension) + 16)
  // At least what button() will grow a spinner to, or the two rows of the compact header overlap.
  const headRowH = Math.max(spin.h, minControlH(vp, bodySize))
  const row2Y = editorCompact2 ? rowY + headRowH + dimSize + 22 : rowY

  /** A -/value/+ spinner. Returns the x the next control may start at. */
  const spinner = (
    x: number,
    y: number,
    caption: string,
    valueText: string,
    canDown: boolean,
    canUp: boolean,
    onDown: () => void,
    onUp: () => void,
  ): number => {
    label(ctx, caption, x, y - 8, dim)
    if (button(vp, p, ui, { x, y, w: spin.w, h: headRowH }, '-', { enabled: canDown })) onDown()
    const valW = Math.ceil(captionWidth(vp, valueText, bodySize)) + 8
    const vx = x + spin.w + gap
    text(ctx, valueText, vx, y + headRowH / 2 + bodySize * 0.36, value)
    const px = vx + valW + gap
    if (button(vp, p, ui, { x: px, y, w: spin.w, h: headRowH }, '+', { enabled: canUp })) onUp()
    return px + spin.w
  }

  let hx = spinner(
    left,
    rowY,
    'chambers',
    String(draft.chambers.length),
    draft.chambers.length > MIN_CHAMBERS,
    draft.chambers.length < MAX_CHAMBERS,
    () => actions.editorChamberCount(draft.chambers.length - 1),
    () => actions.editorChamberCount(draft.chambers.length + 1),
  )
  hx = spinner(
    hx + 40,
    rowY,
    'tolerance',
    draft.toleranceQuality.toFixed(2),
    draft.toleranceQuality > MIN_TOLERANCE + 1e-9,
    draft.toleranceQuality < MAX_TOLERANCE - 1e-9,
    () => actions.editorTolerance(draft.toleranceQuality - 0.05),
    () => actions.editorTolerance(draft.toleranceQuality + 0.05),
  )

  // The number nobody can picture until it is in millimetres: how much room you get to stop in.
  // Named as well as measured — "capture window" is the game's own term and this is the one screen
  // where somebody meets it before they have ever felt one (D-133).
  const windowText = editorCompact2
    ? `${windowWidth(draft).toFixed(2)} mm capture window`
    : `${windowWidth(draft).toFixed(2)} mm to stop in — the capture window`
  /**
   * Controls first, then the readout they produce — DECISIONS D-133.
   *
   * The capture window used to sit between the tolerance spinner and the keyway control, which put
   * a sentence in the middle of a row of controls — and once that sentence said what it meant, it
   * pushed the keyway off the end of the row and under the preview panel. A readout goes after the
   * things that decide it, and takes whatever width is left.
   */
  const keyW = Math.max(220, (Math.ceil(captionWidth(vp, 'standard', bodySize)) + 28) * 2)
  const keyXWanted = editorCompact2
    ? left + Math.ceil(captionWidth(vp, windowText, dimSize)) + 40
    : hx + 28
  // Clamped out of the right-hand column: a segmented control drawn under the preview panel is a
  // control you can neither see nor press.
  const keyX = Math.min(keyXWanted, rightX - keyW - 30)
  const windowX = editorCompact2 ? left : keyX + keyW + 34
  const windowY = editorCompact2
    ? row2Y + headRowH / 2 + dimSize * 0.36
    : rowY + headRowH / 2 + dimSize * 0.36
  text(ctx, windowText, windowX, windowY, { font: font(dimSize), color: p.inkLight })

  label(
    ctx,
    editorCompact2 ? 'keyway' : 'keyway — tight is a narrower pick path',
    keyX,
    row2Y - 8,
    dim,
  )
  const kw = segmented(
    vp,
    p,
    ui,
    { x: keyX, y: row2Y, w: keyW, h: headRowH },
    ['standard', 'tight'],
    draft.keyway === 'tight' ? 1 : 0,
  )
  if (kw !== (draft.keyway === 'tight' ? 1 : 0)) {
    actions.editorKeyway(kw === 1 ? 'tight' : 'standard')
  }

  // Far enough up that the tallest the action row can grow still clears the status line at
  // `LOGICAL_HEIGHT - MARGIN - 24` — the buttons size themselves from their captions now (D-132).
  const footY =
    LOGICAL_HEIGHT -
    MARGIN -
    60 -
    Math.max(116, boxForCaption(vp, 'Save to bench', typeFor(vp, TYPE.body)).h * 2 + 20)

  // ── Per-chamber rows ──────────────────────────────────────────────────────────────────
  // Below the header, wherever it ended — the header is one row on a full page and two on a phone.
  // `+ 38`, not `+ 30` — and 50 at the compact face: the column headings live in this band, and
  // at 30 their ink could not clear both the header row above and the first `-` button below by
  // the crowding rule's six (D-156). The band has to hold the heading's whole ink height plus a
  // gap each side, and the compact face is half again as tall.
  const top = Math.max(262, row2Y + headRowH + (editorCompact2 ? 56 : 38))
  /**
   * On a phone the rows take whatever height the draft leaves spare — DECISIONS D-131.
   *
   * The editor was the worst-measuring screen in the touch audit: 28px controls on a 36px pitch is
   * a **ten CSS pixel** target. It also cannot be fixed the way the others were, by giving each row
   * the finger floor, because `MAX_CHAMBERS` is 16 and sixteen rows at a thumb's height is 1150px
   * of table on a 1080px stage. The pitch is not a free choice; it is `(838 - 262) / chambers`.
   *
   * So it is spent rather than fixed. A six-chamber draft — which is most of them — gets 76px
   * rows, and a sixteen-chamber monster degrades to exactly the 36 it has always had. The table
   * gets no taller either way, so the preview panel beside it never moves.
   */
  const editorCompact = isCompact(vp)
  // Above the action row, which moves with its own captions now — 838 was a constant chosen when
  // the row below it was a fixed 46px tall (D-132).
  const ROWS_BOTTOM = footY - 24
  const rowH = editorCompact
    ? Math.max(
        36,
        Math.min(104, Math.floor((ROWS_BOTTOM - top) / Math.max(1, draft.chambers.length))),
      )
    : 36
  const rowText = typeFor(vp, TYPE.body)
  /** Control height and its offset inside the row, so everything stays vertically centred. */
  // At least what `button` will grow a control to, or consecutive rows overlap each other by the
  // difference — `fitBox` grows about the centre, so it eats into the row above as well (D-132).
  const rowCtlH = Math.min(rowH - 8, Math.max(editorCompact ? minControlH(vp, rowText) : 28, 28))
  const rowCtlY = (rowTop: number): number => rowTop + (rowH - rowCtlH) / 2
  /** A cell's value, shrunk until it clears the chevron drawn at the cell's right edge. */
  const fitLabel = (str: string, cell: Rect, baseline: number, want: number): void => {
    const room = cell.w - 20 - Math.ceil(captionWidth(vp, '>', want)) - 14
    let size = want
    while (size > 10 && captionWidth(vp, str, size) > room) size -= 1
    label(ctx, str, cell.x + 10, baseline, { font: font(size), size, color: p.ink })
  }
  /** Baseline for text set in the middle of a row. */
  const rowBase = (rowTop: number): number => rowTop + rowH / 2 + rowText * 0.36
  /**
   * Column offsets, which have to widen with the type — DECISIONS D-131.
   *
   * Giving the rows finger height was only half of it: at the compact scale `3.40 mm` is about
   * 110px of type in a 102px gap between the two nudge buttons, so the value drew straight through
   * the `+`. Everything shifts right to suit, and the two **derived** columns — what the pin sets
   * at, and how many false sets it has — are dropped, because the table has to stop at 980 where
   * the preview panel begins and those two are restatements of the driver choice beside them.
   */
  const COL = editorCompact
    ? {
        minus: 74,
        depth: 148,
        plus: 268,
        driver: 344,
        driverW: 300,
        spring: 664,
        springW: 200,
      }
    : {
        minus: 74,
        depth: 116,
        plus: 218,
        driver: 300,
        driverW: 260,
        spring: 600,
        springW: 160,
      }
  // `top - 12`, not `- 8` (and -18 at the compact face): on a 1280 laptop the scaled face's
  // descenders came within 5px of the first row's `-` button, and the crowding rule (D-156)
  // asks for six. The compact face is taller and needs the deeper lift the wider band pays for.
  const headBase = top - (editorCompact ? 22 : 12)
  label(ctx, '#', left + 8, headBase, dim)
  // The unit moves into the heading on a phone: `3.40 mm` is 160px of type at the compact face and
  // the gap between the two nudges is 120, and a unit repeated down every row is the part to cut.
  label(ctx, editorCompact ? 'key pin mm' : 'key pin', left + COL.minus, headBase, dim)
  label(ctx, 'driver', left + COL.driver, headBase, dim)
  label(ctx, 'spring', left + COL.spring, headBase, dim)
  if (!editorCompact) {
    /**
     * Both headings are wider than the numbers under them, so they are placed by **measurement**
     * back from the table's right edge — DECISIONS D-146.
     *
     * At `left + 890` a literal, `false sets` ran 8px into the preview panel's own title once the
     * game stopped borrowing whichever monospace the machine owned: the shipped face is wider than
     * the Consolas this column was spaced against. The values below stay on their columns; it is
     * only the headings that were ever near the edge.
     */
    const tableRight = left + 980
    const falseW = Math.ceil(captionWidth(vp, 'false sets', dim.size))
    const setsW = Math.ceil(captionWidth(vp, 'sets at', dim.size))
    const falseX = Math.min(left + 890, tableRight - 24 - falseW)
    label(ctx, 'sets at', Math.min(left + 800, falseX - 20 - setsW), headBase, dim)
    label(ctx, 'false sets', falseX, headBase, dim)
  }

  for (let i = 0; i < draft.chambers.length; i += 1) {
    const row = draft.chambers[i]
    if (!row) continue
    const y = top + i * rowH
    const base = rowBase(y)
    const cy = rowCtlY(y)
    text(ctx, String(i + 1), left + 8, base, {
      font: font(rowText),
      color: p.inkLight,
    })

    // The two nudges are the smallest targets in the game. They keep their drawn size on a full
    // page and take the row's height on a phone; the near-miss floor (D-131) covers the rest.
    const nudgeW = editorCompact ? 52 : 30
    if (button(vp, p, ui, { x: left + COL.minus, y: cy, w: nudgeW, h: rowCtlH }, '-')) {
      actions.editorDepth(i, row.depth - 0.1)
    }
    text(
      ctx,
      editorCompact ? row.depth.toFixed(2) : `${row.depth.toFixed(2)} mm`,
      left + COL.depth,
      base,
      {
        font: font(rowText),
        color: p.ink,
      },
    )
    // `3.40 mm` is 88px at 21px type and used to be given 80 before the `+` landed (D-102).
    if (button(vp, p, ui, { x: left + COL.plus, y: cy, w: nudgeW, h: rowCtlH }, '+')) {
      actions.editorDepth(i, row.depth + 0.1)
    }

    const pinRect: Rect = {
      x: left + COL.driver,
      y: cy,
      w: COL.driverW,
      h: rowCtlH,
    }
    const pinState = ui.widget(pinRect)
    cardFrame(vp, p, pinRect, pinState, false)
    fitLabel(row.pin, pinRect, base, rowText)
    text(ctx, '>', pinRect.x + pinRect.w - 12, base, {
      font: font(rowText),
      color: p.inkLight,
      align: 'right',
    })
    if (pinState.activated) actions.editorCyclePin(i)

    const sprRect: Rect = {
      x: left + COL.spring,
      y: cy,
      w: COL.springW,
      h: rowCtlH,
    }
    const sprState = ui.widget(sprRect)
    cardFrame(vp, p, sprRect, sprState, false)
    // The value stops short of the chevron's column — at the compact face NORMAL reached the
    // card's right edge and printed straight through the `>` (D-132).
    fitLabel(SPRING_CHOICES[row.spring]?.label ?? 'normal', sprRect, base, rowText)
    // The chevron gets a column of its own; at the compact face 'NORMAL' reached the card's right
    // edge and printed through it (D-132).
    text(ctx, '>', sprRect.x + sprRect.w - 10, base, {
      font: font(rowText),
      color: p.inkLight,
      align: 'right',
    })
    if (sprState.activated) actions.editorCycleSpring(i)

    // What those three choices add up to, in the simulation's own terms. Both are derived from the
    // driver named two columns left, so they are what the compact table can afford to lose.
    if (!editorCompact) {
      const lies = PROFILES[row.pin].grooveCount
      text(ctx, `${(MAX_KEY_PIN - row.depth).toFixed(2)} mm`, left + 800, base, {
        ...value,
        font: font(rowText),
      })
      text(ctx, lies === 0 ? '—' : String(lies), left + 900, base, {
        font: font(rowText),
        color: lies > 0 ? readable.violet : p.inkLight,
      })
    }
  }

  /**
   * The draft, drawn — beside the table, not below it.
   *
   * The editor asked for six numbers and showed none of them as a *lock*. You could set a 1.2mm
   * cut and a spool in chamber three and the only feedback was the word "spool" in a dropdown —
   * everything that makes a lock look like anything was invisible until you pressed Test pick.
   *
   * **Beside** because the table is as tall as the lock is long. Under the table at a fixed y it
   * worked for the five-chamber default and was wrong the moment you added pins: `MAX_CHAMBERS` is
   * 16, the rows reach y=838, and the panel sat at 540 — so the last eight chambers were drawn
   * straight through the picture. Reported as *"when you add a lot of pins the scroll bar is
   * missing, otherwise everything goes behind the image."*
   *
   * There is no scroll bar because nothing in this game scrolls: the bench has the same constraint
   * and answers it by fitting on one screen, with an overflow warning to prove it still does. A
   * scrolling region here would mean pointer offsets, a wheel handler and a touch-drag that fights
   * the widget layer — machinery to *manage* an overlap that a column arrangement removes. Sixteen
   * chambers now fit beside a full-height preview with room to spare.
   *
   * Drawn from the same `LockDef` the Test pick button would hand the simulation, so what you are
   * looking at is what you are about to pick, not an illustration of it. See DECISIONS D-099, D-100.
   */
  /**
   * The preview and the shelf are the first things to go when the page runs out — D-132.
   *
   * The editor is the densest screen in the game: a name field, two spinners, a keyway control, a
   * table of up to sixteen rows with five columns each, an action row, a share-code block, a live
   * preview and a shelf of saved locks. On a 658x320 phone the type is 2.2x and the stage is the
   * same 1920 wide, so the preview panel at x = left + 980 lands on the keyway control and the
   * shelf's text runs through the preview.
   *
   * The table is the editor. The preview is a nicety you can get by pressing Test pick, and the
   * shelf is a copy of a page that has its own entry in the nav bar directly above it. Below 0.34
   * they both go, and the table takes the width — which is what makes the header stop wrapping too.
   */
  /**
   * The preview and the shelf are desktop furniture — DECISIONS D-134.
   *
   * They were gated at 0.34, which kept them on a mid-sized phone, and a mid-sized phone is exactly
   * where they hurt: reported as *"in the mobile editor there are too many buttons and things — Your
   * locks is just a mess"*. Both are duplicates of something a tap away. The preview shows the lock
   * you are about to pick and `Test pick` shows you the real one; the shelf lists locks you have
   * saved and the Share codes page in the nav bar directly above it lists them with more room and
   * more to do with them.
   *
   * What is left is the table, which is the editor, and the row of actions under it.
   */
  const roomy = !isCompact(vp)
  /**
   * The right of the page is **one column**, on one left edge — DECISIONS D-133.
   *
   * It was three things at three different x: a preview panel at left+980, a shelf of saved locks
   * pushed out to left+1500, and the share-code block at left+850 — which is not even clear of the
   * table's own last column. A review measured a 22px step between two blocks stacked in the same
   * column and found the shelf sitting unframed in the leftover strip, wrapping to four short lines
   * and truncating. Three edges is not a column; it is three things that happen to be on the right.
   *
   * One x, one width, everything in it framed the same way.
   */
  const previewDef = draftToLockDef(draft, progress.data.customLocks.length)
  const preview: Rect = { x: rightX, y: 254, w: rightW, h: 330 }
  if (roomy) panel(vp, p, preview, 'preview')
  if (roomy)
    drawLockGlyph(
      vp,
      p,
      previewDef,
      { x: preview.x + 40, y: preview.y + 70, w: preview.w - 80, h: preview.h - 170 },
      false,
      14,
    )
  // The keyway and the capture window are both already spelled out in the controls above; repeating
  // them here cost a third line and got the summary truncated to "· no…" instead (D-102).
  const security = draft.chambers.filter((r) => PROFILES[r.pin].grooveCount > 0).length
  if (roomy)
    paragraph(
      ctx,
      `${draft.chambers.length} chambers  ·  ` +
        (security === 0
          ? 'no security pins'
          : `${security} security pin${security === 1 ? '' : 's'}`),
      preview.x + 40,
      preview.y + preview.h - 52,
      {
        font: font(typeFor(vp, TYPE.body)),
        color: p.inkLight,
        maxWidth: preview.w - 80,
        lineHeight: 28,
        maxLines: 2,
      },
    )

  // ── Locks this player has already built ───────────────────────────────────────────────
  //
  // Down the right-hand side rather than on the bench: the bench is already one screenful and has
  // an overflow warning to prove it, and a lock you made belongs next to the thing that made it.
  // Pushed out past the preview column, and clear of `false sets` so the header stops reading as a
  // seventh column of the table.
  // In the same column as the preview, framed like it, under it — not parked in the strip that
  // was left over. It goes with the preview on the smallest phones (D-132): it is a copy of the
  // codes page, which is one tap away in the nav bar directly above this column.
  const shelf: Rect = { x: rightX, y: preview.y + preview.h + 26, w: rightW, h: 210 }
  const shelfX = shelf.x + 16
  if (roomy) {
    panel(vp, p, shelf, 'your locks')
    const saved = progress.data.customLocks
    if (saved.length === 0) {
      paragraph(
        ctx,
        'nothing saved yet — build one on the left and press Save to bench',
        shelfX,
        shelf.y + 60,
        {
          font: font(typeFor(vp, TYPE.dimension)),
          color: p.inkLight,
          maxWidth: rightW - 32,
          lineHeight: typeFor(vp, TYPE.dimension) + 5,
          maxLines: 3,
        },
      )
    }
    saved.forEach((def, i) => {
      const rect: Rect = { x: shelfX, y: shelf.y + 44 + i * 46, w: rightW - 32, h: 40 }
      if (rect.y + rect.h > shelf.y + shelf.h - 10) return
      const st = ui.widget(rect)
      cardFrame(vp, p, rect, st, false)
      paragraph(ctx, def.name, rect.x + 10, rect.y + 18, {
        font: font(typeFor(vp, TYPE.body)),
        color: p.ink,
        maxWidth: 200,
        lineHeight: 15,
        maxLines: 1,
      })
      text(ctx, `${def.bitting.length} chambers`, rect.x + 10, rect.y + 33, {
        font: font(typeFor(vp, TYPE.dimension)),
        color: p.inkLight,
      })
      if (st.activated) actions.startLock(def)
      if (button(vp, p, ui, { x: rect.x + 232, y: rect.y + 6, w: 78, h: 28 }, 'edit')) {
        actions.editorLoad(i)
      }
    })

    // ── Verdict and actions ───────────────────────────────────────────────────────────────
    /**
     * The verdict, and **only when there is one**.
     *
     * This line exists to say why `Save to bench` is greyed out. When nothing is wrong it used to
     * print "valid — every chamber sets, and every groove sits below the shear line", which is a
     * permanent sentence that tells you what the two enabled buttons underneath it already tell you.
     * Asked directly: *"there is a text 'valid — every chamber' — why is it there?"* — and the honest
     * answer was that it did not need to be. Silence is the valid state now. See DECISIONS D-103.
     */
    if (problem) {
      paragraph(ctx, problem, left, footY - 14, {
        font: font(typeFor(vp, TYPE.body)),
        color: readable.crimson,
        maxWidth: BENCH_WIDTH,
        lineHeight: 24,
        maxLines: 2,
      })
    }
  }

  /**
   * The footer's three actions, measured from their own captions — DECISIONS D-132.
   *
   * `Save to bench` in a 220px box is fine at 21px type and impossible at 38: `button` shrinks a
   * caption that will not fit across, so on a phone the primary action on this screen was drawn at
   * seven CSS px. Widths come from the words, and the row is laid out left to right from them so
   * the three cannot overlap whatever they grow to.
   */
  const footCaps = ['Test pick', 'Save to bench', 'New draft'] as const
  const footSize = typeFor(vp, TYPE.body)
  const footBtn = (caption: string): { w: number; h: number } =>
    boxForCaption(vp, caption, footSize, { w: 170, h: 46 })
  const footX = (i: number): number =>
    left + footCaps.slice(0, i).reduce((sum, cap) => sum + footBtn(cap).w + 20, 0)

  if (
    button(vp, p, ui, { x: left, y: footY, ...footBtn('Test pick') }, 'Test pick', {
      primary: true,
      enabled: !problem,
    })
  ) {
    actions.editorTest()
  }
  if (
    button(vp, p, ui, { x: footX(1), y: footY, ...footBtn('Save to bench') }, 'Save to bench', {
      enabled: !problem,
    })
  ) {
    actions.editorSave()
  }
  if (button(vp, p, ui, { x: footX(2), y: footY, ...footBtn('New draft') }, 'New draft')) {
    actions.editorReset()
  }

  /**
   * The share code, and the two buttons that move it.
   *
   * Drawn even when the draft is invalid — a code for a lock that does not quite work is still a
   * code, and hiding it while somebody is mid-edit would mean the field flickers in and out as they
   * turn a dial. It is copy and paste rather than a text field because a share code is a thing you
   * receive from somewhere else, and typing sixteen characters by hand is not the flow (D-093).
   */
  const code = problem ? null : encodeLock(draftToLockDef(draft, progress.data.customLocks.length))
  /*
   * The share-code block, stacked from its own type — DECISIONS D-132.
   *
   * Heading at -14, the code at +20 and a button row at +34: an 18px gap between a 26px face and
   * the row under it, which is a collision at any scale above the one it was drawn for. The code
   * was printed through its own `SHARE CODE` label and the buttons through the code.
   */
  const codeSize = typeFor(vp, TYPE.heading)
  // To the right of wherever the action row actually ended — those three buttons are sized from
  // their own captions now, so 850 is no longer guaranteed to be clear of them (D-132).
  // The same edge as the preview and the shelf above it, and still clear of the action row.
  const shareX = Math.max(rightX, footX(3) + 40)
  label(ctx, 'share code', shareX, footY - 14, dim)
  text(ctx, code ? formatCode(code) : '—', shareX, footY + codeSize * 0.9, {
    font: font(codeSize),
    color: code ? p.ink : p.rule,
  })
  const clipY = footY + codeSize + 16
  if (
    button(vp, p, ui, { x: shareX, y: clipY, ...footBtn('Copy') }, 'Copy', {
      enabled: !!code,
    })
  ) {
    actions.editorCopyCode()
  }
  /*
   * Paste and All codes are not drawn on a phone — DECISIONS D-134.
   *
   * Pasting a code to edit, and browsing every code, are both the Share codes page's job — and it
   * is in the nav bar at the top of this screen. What the editor uniquely produces is *this* lock's
   * code, so the code and Copy stay and the two navigational duplicates go.
   */
  if (
    roomy &&
    button(
      vp,
      p,
      ui,
      { x: shareX + footBtn('Copy').w + 15, y: clipY, ...footBtn('Paste') },
      'Paste',
    )
  ) {
    actions.editorPasteCode()
  }
  if (
    roomy &&
    button(
      vp,
      p,
      ui,
      {
        x: shareX + footBtn('Copy').w + footBtn('Paste').w + 30,
        y: clipY,
        ...footBtn('All codes'),
      },
      'All codes',
    )
  ) {
    actions.goto('codes')
  }
}
