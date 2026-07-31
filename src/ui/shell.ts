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
import { STROKE, TYPE, alpha, font, readableAccents, type Palette } from '../render/palette'
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, snapX, snapY, type Viewport } from '../render/viewport'
import { MAX_CHAMBERS, MAX_KEY_PIN, MIN_CHAMBERS, PROFILES, type KeywayGrade } from '../sim'
import type { LockDef, SettingsData } from './shellTypes'
import {
  type Ui,
  button,
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
  | 'pick'
  | 'results'
  | 'settings'
  | 'pause'
  | 'trophies'
  | 'editor'
  | 'codes'
  | 'help'

const MARGIN = 24

export interface ShellActions {
  goto(screen: ScreenName): void
  startLock(def: LockDef): void
  resume(): void
  restart(): void
  abandon(): void
  /** Begin one of the three lessons from `GAME_DESIGN.md §10`. */
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
  /** Which page of the player's own locks is showing. */
  codesPage?: number
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
    font: font(TYPE.title),
    size: TYPE.title,
    color: p.ink,
  })
  text(ctx, status, MARGIN + 28, LOGICAL_HEIGHT - MARGIN - 24, {
    font: font(TYPE.dimension),
    color: p.inkLight,
  })

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
  const linkState = ui.widget(REPORT_LINK)
  cardFrame(vp, p, REPORT_LINK, linkState, false)
  label(ctx, 'report an issue ↗', REPORT_LINK.x + REPORT_LINK.w / 2, REPORT_LINK.y + 27, {
    font: font(TYPE.body),
    size: TYPE.body,
    color: linkState.hovered ? readableAccents(p).teal : p.ink,
    align: 'center',
  })
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
export const REPORT_LINK: Rect = {
  x: LOGICAL_WIDTH - MARGIN - 290,
  y: LOGICAL_HEIGHT - MARGIN - 54,
  w: 262,
  h: 40,
}
export const FORK_LINK: Rect = { x: LOGICAL_WIDTH - MARGIN - 330, y: MARGIN + 34, w: 302, h: 40 }

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
function navBar(c: ShellContext, items: readonly (readonly [string, () => void])[]): void {
  const { vp, p, ui } = c
  const w = 150
  const gap = 20
  items.forEach(([caption, go], i) => {
    const x = LOGICAL_WIDTH - MARGIN - 28 - w - (items.length - 1 - i) * (w + gap)
    if (button(vp, p, ui, { x, y: MARGIN + 24, w, h: 40 }, caption)) go()
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

  label(ctx, 'a lockpicking simulator', MARGIN + 28, MARGIN + 84, {
    font: font(TYPE.body),
    size: TYPE.body,
    color: p.inkLight,
  })

  /**
   * Fork me on GitHub — top right, where that has lived on every project page since 2008.
   *
   * Drawn rather than a ribbon graphic: the game has no images and this screen has a house style,
   * and a corner ribbon in someone else's palette would be the only bitmap in the build.
   */
  const forkState = ui.widget(FORK_LINK)
  cardFrame(vp, p, FORK_LINK, forkState, false)
  label(ctx, 'fork me on GitHub ↗', FORK_LINK.x + FORK_LINK.w / 2, FORK_LINK.y + 28, {
    font: font(TYPE.body),
    size: TYPE.body,
    color: forkState.hovered ? readableAccents(p).teal : p.ink,
    align: 'center',
  })
  // Keyboard only — see `REPORT_LINK` (D-103).
  if (forkState.activated) actions.openRepo()

  const w = 380
  const h = 56
  const x = (LOGICAL_WIDTH - w) / 2
  let y = 320
  const gap = 74

  // A brand-new player is sent to the first lesson, not to a wall of thirty-five locks. The
  // game is unusually unforgiving of not knowing what tension is for, and "Start picking"
  // dropping someone straight onto the bench was an invitation to bounce off it.
  const taught = progress.data.tutorial.length > 0
  const hasProgress = progress.totalOpens > 0
  const primaryCaption = !taught ? 'Start the tutorial' : hasProgress ? 'Continue' : 'Start picking'
  if (button(vp, p, ui, { x, y, w, h }, primaryCaption, { primary: true })) {
    if (taught) actions.goto('bench')
    else actions.startLesson(LESSONS[0]?.id ?? 'lesson-1')
  }
  /**
   * Beside the button it is about — on the **left**, which is the side with nothing on it.
   *
   * It sat one row down next to Bench, where it read as a promise about the bench (D-099), then to
   * the right of the primary button, where at the larger face it ran 500px straight through the
   * "what this is" column (D-102). The left half of this screen is empty; right-aligning against
   * the button stack puts it beside its button with nothing to collide with.
   */
  if (!taught) {
    label(ctx, 'five minutes, and the rest of the game makes sense', x - 24, y + h / 2 + 6, {
      font: font(TYPE.dimension),
      size: TYPE.dimension,
      color: p.inkLight,
      align: 'right',
    })
  }
  y += gap
  if (button(vp, p, ui, { x, y, w, h }, 'Bench')) actions.goto('bench')
  y += gap
  if (button(vp, p, ui, { x, y, w, h }, 'Trophies')) actions.goto('trophies')
  y += gap
  // Between the trophies and the settings on purpose: it is a place to *go*, not a preference.
  if (button(vp, p, ui, { x, y, w, h }, 'Share codes')) actions.goto('codes')
  y += gap
  if (button(vp, p, ui, { x, y, w, h }, 'Help')) actions.goto('help')
  y += gap
  if (button(vp, p, ui, { x, y, w, h }, 'Settings')) actions.goto('settings')

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
  const earned = progress.data.achievements
  if (earned.length === 0) {
    /**
     * What the game *is*, on the one screen where somebody might not know yet.
     *
     * The right half of the title screen was empty until the player had earned a trophy, which is
     * exactly backwards: the person who needs telling is the one who has never played. Three
     * sentences, replaced by their own trophies the moment there are any (D-099).
     */
    const bx = LOGICAL_WIDTH - MARGIN - 520
    label(ctx, 'what this is', bx, 320, {
      font: font(TYPE.dimension),
      size: TYPE.dimension,
      color: p.inkLight,
    })
    paragraph(
      ctx,
      'A plug will not turn until every pin is caught on the shear line. Under torque it pinches ' +
        'one pin at a time: find that one by feel, and lift it until it catches.',
      bx,
      356,
      { font: font(TYPE.body), color: p.ink, maxWidth: 480, lineHeight: 30, maxLines: 5 },
    )
    paragraph(
      ctx,
      'Nothing is random. Every lock is the same lock every time, so what improves is you.',
      bx,
      516,
      { font: font(TYPE.body), color: p.inkLight, maxWidth: 480, lineHeight: 30, maxLines: 3 },
    )
  }
  if (earned.length > 0) {
    const tx = LOGICAL_WIDTH - MARGIN - 96
    label(ctx, 'lately', tx, 320, {
      font: font(TYPE.dimension),
      size: TYPE.dimension,
      color: p.inkLight,
      align: 'right',
    })
    let ty = 350
    for (const id of [...earned].reverse().slice(0, 5)) {
      const a = ACHIEVEMENTS.find((x) => x.id === id)
      if (!a) continue
      label(ctx, a.name, tx, ty, {
        font: font(TYPE.body),
        size: TYPE.body,
        color: p.ink,
        align: 'right',
      })
      // 24 below the name, in a 58px row. At 17 and 46 — numbers set for a 13px body — the 21px
      // name's descenders sat inside the 17px condition underneath it (D-103).
      text(ctx, a.condition, tx, ty + 24, {
        font: font(TYPE.dimension),
        color: p.inkLight,
        align: 'right',
      })
      ty += 58
    }
    text(ctx, `${earned.length}/${ACHIEVEMENTS.length} earned`, tx, ty + 6, {
      font: font(TYPE.dimension),
      color: readableAccents(p).teal,
      align: 'right',
    })
  }

  // A quiet technical flourish: the shear line itself, across the page.
  const lineY = 250
  ctx.save()
  ctx.lineWidth = STROKE.heavy
  ctx.strokeStyle = p.ink
  ctx.beginPath()
  ctx.moveTo(MARGIN, snapY(vp, lineY, STROKE.heavy))
  ctx.lineTo(LOGICAL_WIDTH - MARGIN, snapY(vp, lineY, STROKE.heavy))
  ctx.stroke()
  ctx.restore()
  label(ctx, 'shear line', LOGICAL_WIDTH - MARGIN - 28, lineY - 12, {
    font: font(TYPE.dimension),
    size: TYPE.dimension,
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
// and the codes page draws `CODE_CARD_*`. `CARD_W` survives only as the width `CARDS_PER_ROW` is
// derived from, which `benchHeight` still uses to count lesson rows.
const CARD_W = 288
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
const BENCH_CARD_W = Math.floor((LOGICAL_WIDTH - (MARGIN + 28) * 2 - BENCH_GAP * 2) / BENCH_COLS)
const BENCH_CARD_H = 250
/** Lesson card height — one line of title over two of blurb, at the larger face. */
const LESSON_H = 104

/**
 * Codes-page card geometry: five to a row, not six (D-102).
 *
 * At 288 wide a 21px name truncated half the roster back to "Halberd…" — the same failure D-099
 * fixed by giving the name the full card, arriving again from the other direction. Five columns is
 * 353 wide, which fits every name in the game, and twenty shareable locks still land in four rows.
 */
const CODE_COLS = 5
const CODE_CARD_W = Math.floor((LOGICAL_WIDTH - (MARGIN + 28) * 2 - CARD_GAP * (CODE_COLS - 1)) / CODE_COLS)
const CODE_CARD_H = 136
const BENCH_LEFT = MARGIN + 28
const BENCH_WIDTH = LOGICAL_WIDTH - BENCH_LEFT * 2
/** Cards per row, so a six-lock tier wraps instead of running off the page. */
const CARDS_PER_ROW = Math.max(1, Math.floor((BENCH_WIDTH + CARD_GAP) / (CARD_W + CARD_GAP)))

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
  if (def.family === 'disc-detainer' || def.family === 'tubular' || def.family === 'radial-slider') {
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
    ['Codes', () => actions.goto('codes')],
    ['Editor', () => actions.goto('editor')],
    ['Menu', () => actions.goto('menu')],
  ])

  // The lessons sit above Tier 1, always visible and always replayable — `GAME_DESIGN.md §10`
  // asks for both. Completed ones say so rather than disappearing: a player who wants to redo
  // the spool lesson three tiers later should not have to hunt for it.
  let y = 120
  const taughtBasics = progress.data.tutorial.length > 0
  label(ctx, 'lessons', BENCH_LEFT, y, {
    font: font(TYPE.heading),
    size: TYPE.heading,
    color: p.ink,
  })
  if (!taughtBasics) {
    text(ctx, 'start here — the locks below unlock once you finish the first one', BENCH_LEFT + 160, y, {
      font: font(TYPE.body),
      color: readableAccents(p).amber,
    })
  }
  y += 18
  LESSONS.forEach((lesson, i) => {
    // On the same three-column grid as the locks below, so the page has one rhythm rather than
    // two — and so a lesson's one-line summary is not cut to "…leaning" to fit a 288px card.
    const rect: Rect = {
      x: BENCH_LEFT + (BENCH_CARD_W + BENCH_GAP) * i,
      y,
      w: BENCH_CARD_W,
      h: LESSON_H,
    }
    const done = progress.data.tutorial.includes(lesson.id)
    const st = ui.widget(rect)
    cardFrame(vp, p, rect, st, false)
    label(ctx, lesson.title, rect.x + 18, rect.y + 32, {
      font: font(TYPE.body),
      size: TYPE.body,
      color: p.ink,
    })
    paragraph(ctx, lesson.teaches, rect.x + 18, rect.y + 60, {
      font: font(TYPE.dimension),
      color: p.inkLight,
      maxWidth: rect.w - 36,
      lineHeight: 22,
      maxLines: 2,
    })
    if (done) {
      text(ctx, 'done', rect.x + rect.w - 18, rect.y + 32, {
        font: font(TYPE.dimension),
        color: readableAccents(p).teal,
        align: 'right',
      })
    }
    if (st.activated) actions.startLesson(lesson.id)
  })
  /**
   * 46, not 18 — the tier strip was drawn 4px *inside* the lesson cards.
   *
   * The buttons on that row are laid out at `y - 22` so their 40px boxes centre on `y`, and a gap
   * of 18 makes that `-4`: the tier buttons and the Inspect switch each put their top border
   * through the bottom border of the lesson card above them. Two bordered boxes sharing an edge
   * read as one broken box. 46 leaves a clean 24px. See DECISIONS D-109.
   */
  y += LESSON_H + 46

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
  label(ctx, 'tiers', BENCH_LEFT, y + 4, {
    font: font(TYPE.dimension),
    size: TYPE.dimension,
    color: p.inkLight,
  })
  tiers.forEach((t, i) => {
    const open = taughtBasics && progress.isTierUnlocked(t)
    const rect: Rect = { x: BENCH_LEFT + 90 + i * 108, y: y - 22, w: 96, h: 40 }
    if (button(vp, p, ui, rect, `tier ${t}`, { primary: t === tier })) actions.benchTier(t)
    if (!open) {
      // A padlock would be a second icon language on a screen that has none. The word is clearer.
      text(ctx, 'locked', rect.x + rect.w / 2, rect.y + rect.h + 18, {
        font: font(TYPE.dimension),
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
  if (
    button(
      vp,
      p,
      ui,
      { x: LOGICAL_WIDTH - MARGIN - 28 - 190, y: y - 22, w: 190, h: 40 },
      inspecting ? 'Inspecting' : 'Inspect',
      { primary: inspecting },
    )
  ) {
    actions.toggleInspect()
  }

  // 66, not 58: the `locked` captions hang 36px below the button row and the tier's own line has to
  // clear their descenders, not just their baselines.
  y += 66

  {
    // The first lesson gates the whole bench. It is five minutes and it is the difference
    // between a game and a wall — but the lessons above are always live, so nobody is stuck.
    const unlocked = taughtBasics && progress.isTierUnlocked(tier)
    const locks = ALL_LOCKS.filter((d) => d.tier === tier)
    if (!unlocked) {
      const need = progress.opensNeededFor(tier)
      const why = !taughtBasics
        ? 'locked — finish the first lesson above'
        : `locked — open ${need} more tier ${tier - 1} lock${need === 1 ? '' : 's'}`
      text(ctx, why, BENCH_LEFT, y, { font: font(TYPE.body), color: readableAccents(p).amber })
    }
    y += 24

    locks.forEach((def, i) => {
      const col = i % BENCH_COLS
      const row = Math.floor(i / BENCH_COLS)
      const rect: Rect = {
        x: BENCH_LEFT + (BENCH_CARD_W + BENCH_GAP) * col,
        y: y + row * (BENCH_CARD_H + BENCH_GAP),
        w: BENCH_CARD_W,
        h: BENCH_CARD_H,
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

      paragraph(ctx, def.name, rect.x + 22, rect.y + 38, {
        font: font(TYPE.heading),
        color: unlocked ? p.ink : p.inkLight,
        maxWidth: rect.w - (record.opens > 0 ? 110 : 44),
        lineHeight: 28,
        maxLines: 1,
      })
      drawLockGlyph(vp, p, def, { x: rect.x + 22, y: rect.y + 62, w: 220, h: 118 }, !unlocked, 9)

      const stats = [`${chambersOf(def)} chambers`, `par ${def.par}s`]
      stats.forEach((s, k) => {
        text(ctx, s, rect.x + 266, rect.y + 100 + k * 32, {
          font: font(TYPE.body),
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
          { font: font(TYPE.body), color: readable.teal },
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
          font: font(TYPE.payout, 'bold'),
          size: TYPE.payout,
          color: countsForTier(best) ? readable.teal : p.rule,
          align: 'center',
        })
      } else if (unlocked) {
        text(ctx, 'not yet opened', rect.x + 22, rect.y + rect.h - 20, {
          font: font(TYPE.body),
          color: p.inkLight,
        })
      }

      if (st.activated && unlocked) actions.startLock(def)
    })
    const rows = Math.ceil(locks.length / BENCH_COLS)
    y += rows * (BENCH_CARD_H + BENCH_GAP)
  }

  // The bench does not scroll, so if it ever outgrows the stage the tiers at the bottom
  // become invisible *and* unclickable — which is precisely what happened the moment Phase 13
  // finished the roster. Saying so is better than silently losing Tier 6.
  if (y > LOGICAL_HEIGHT - MARGIN) {
    text(ctx, `bench overflows by ${Math.ceil(y - (LOGICAL_HEIGHT - MARGIN))}px`, BENCH_LEFT, y, {
      font: font(TYPE.dimension),
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
export function benchHeight(lockCount: number, tierCount: number, lessonCount: number): number {
  const lessonRows = Math.ceil(lessonCount / CARDS_PER_ROW)
  // The `+ 46` mirrors the gap under the lesson cards, which had to grow from 18 because the tier
  // strip's buttons are drawn at `y - 22` and were landing inside the cards (D-109).
  let y = 120 + 18 + lessonRows * (LESSON_H + 6) + 46
  // Tier buttons, then the lock/locked line, then the biggest tier's rows.
  y += 58 + 24
  const biggest = Math.ceil(lockCount / Math.max(1, tierCount))
  y += Math.ceil(biggest / BENCH_COLS) * (BENCH_CARD_H + BENCH_GAP)
  return y
}

// ── Results ─────────────────────────────────────────────────────────────────────────────

/**
 * The binding-order diagram — ART_DIRECTION.md §6. "Every open teaches something about the
 * lock you just beat."
 */
function drawBindingOrder(
  vp: Viewport,
  p: Palette,
  rect: Rect,
  chamberCount: number,
  order: readonly number[],
): void {
  const { ctx } = vp
  const pitch = rect.w / Math.max(1, chamberCount)
  const boxW = Math.min(64, pitch * 0.7)
  const readable = readableAccents(p)
  for (let i = 0; i < chamberCount; i += 1) {
    const cx = rect.x + pitch * (i + 0.5)
    const bx = cx - boxW / 2
    ctx.save()
    ctx.fillStyle = p.paper
    ctx.fillRect(bx, rect.y, boxW, 54)
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.strokeRect(snapX(vp, bx, STROKE.standard), snapY(vp, rect.y, STROKE.standard), boxW, 54)
    ctx.restore()
    text(ctx, String(i + 1), cx, rect.y + 34, {
      font: font(TYPE.heading),
      color: p.ink,
      align: 'center',
    })
    const position = order.indexOf(i)
    text(ctx, position >= 0 ? `${position + 1}${ordinal(position + 1)}` : '—', cx, rect.y + 78, {
      font: font(TYPE.body),
      color: position >= 0 ? readable.amber : p.inkLight,
      align: 'center',
    })
  }
  // The arrow chain, in the order they actually bound.
  ctx.save()
  ctx.lineWidth = STROKE.hairline
  ctx.strokeStyle = readable.amber
  ctx.beginPath()
  for (let k = 0; k < order.length - 1; k += 1) {
    const from = rect.x + pitch * ((order[k] as number) + 0.5)
    const to = rect.x + pitch * ((order[k + 1] as number) + 0.5)
    const y = rect.y + 96 + k * 12
    ctx.moveTo(from, y)
    ctx.lineTo(to, y)
    const dir = Math.sign(to - from) || 1
    ctx.moveTo(to - dir * 7, y - 4)
    ctx.lineTo(to, y)
    ctx.lineTo(to - dir * 7, y + 4)
  }
  ctx.stroke()
  ctx.restore()
  label(ctx, 'binding order', rect.x, rect.y - 12, {
    font: font(TYPE.dimension),
    size: TYPE.dimension,
    color: p.inkLight,
  })
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th'
  switch (n % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

export function drawResults(c: ShellContext): void {
  const { vp, p, ui, progress, actions, outcome, result } = c
  const { ctx } = vp
  screenFrame(c, outcome?.opened ? 'Open' : 'Results', c.status ?? creditLine(progress))
  if (!outcome) return

  const readable = readableAccents(p)
  label(ctx, outcome.lock.name, MARGIN + 28, MARGIN + 92, {
    font: font(TYPE.heading),
    size: TYPE.heading,
    color: p.inkLight,
  })

  const left = MARGIN + 60
  let y = 220
  // The par this attempt was *judged* against, which on anything but Easy is not the lock's par.
  const judgedPar = effectivePar(outcome.lock.par, outcome.assist)
  const rows: [string, string, string][] = [
    ['time', `${outcome.seconds.toFixed(2)}s`, outcome.seconds <= judgedPar ? readable.teal : p.ink],
    [
      'par',
      judgedPar === outcome.lock.par
        ? `${outcome.lock.par}s`
        : `${judgedPar.toFixed(0)}s  (${outcome.lock.par}s x ${outcome.assist})`,
      p.inkLight,
    ],
    ['oversets', String(outcome.oversets), outcome.oversets === 0 ? readable.teal : readable.crimson],
    ['resets', String(outcome.resets), outcome.resets === 0 ? readable.teal : p.ink],
    ['false sets', String(outcome.falseSets), p.ink],
  ]
  for (const [k, v, color] of rows) {
    label(ctx, k, left, y, { font: font(TYPE.body), size: TYPE.body, color: p.inkLight })
    text(ctx, v, left + 260, y, { font: font(TYPE.body), color })
    y += 34
  }

  /**
   * The rank, where the payout panel used to be.
   *
   * Credits went with D-091 and this is what replaced them. The panel says three things and no
   * more: what you earned this time, what your best on this lock is, and — the only line worth
   * hurrying for — whether this attempt moved it. A number that only ever goes up is not a reason
   * to play a lock twice; a letter that can be beaten is.
   */
  if (result) {
    /**
     * 700 wide, not 420 — the panel was laid out for an 11px label face and holds an 18px one.
     *
     * `label` draws in caps with tracking, so "counts toward the next tier" is close to 300px of
     * ink and the values were right-aligned 250px from the panel's left edge: every row printed the
     * value *through* its own label, and the longest label ran out through the panel's right wall.
     * Widened, with the values right-aligned to the far side and the labels given the whole gap in
     * between, so nothing has to be short to fit. See DECISIONS D-099.
     */
    y += 20
    const pw = 700
    panel(vp, p, { x: left - 20, y: y - 34, w: pw, h: 190 }, 'rank')
    const rankInk =
      result.rank <= 1 ? readable.teal : result.rank <= 3 ? readable.amber : readable.crimson
    label(ctx, letterFor(result.rank), left + 60, y + 96, {
      font: font(TYPE.payout, 'bold'),
      size: TYPE.payout,
      color: rankInk,
      align: 'center',
    })
    const lines: [string, string][] = [
      ['best on this lock', letterFor(result.bestRank)],
      ['previous best', result.firstOpen ? 'first open' : letterFor(result.previousBest)],
      ['counts toward the next tier', countsForTier(result.bestRank) ? 'yes' : 'not yet — needs D'],
    ]
    let ly = y + 16
    for (const [k, v] of lines) {
      label(ctx, k, left + 150, ly, { font: font(TYPE.body), size: TYPE.body, color: p.inkLight })
      text(ctx, v, left + pw - 40, ly, { font: font(TYPE.body), color: p.ink, align: 'right' })
      ly += 30
    }
    if (result.improved) {
      label(ctx, result.firstOpen ? 'first open' : 'new best', left + 150, ly + 8, {
        font: font(TYPE.heading),
        size: TYPE.heading,
        color: readable.teal,
      })
    }
  }

  drawBindingOrder(
    vp,
    p,
    { x: LOGICAL_WIDTH / 2 + 40, y: 240, w: 620, h: 200 },
    chambersOf(outcome.lock),
    outcome.bindOrder,
  )

  /**
   * The code for the lock you have just beaten, on the screen where you have just beaten it.
   *
   * "Do this in under 5.21 seconds" is the whole reason a share code is worth having, and it was
   * only ever obtainable by going to the editor and rebuilding the lock by hand. Drawn only when
   * the format can carry this lock honestly — `shareableCode` is the judge of that (D-099).
   */
  const code = shareableCode(outcome.lock)
  if (code !== null) {
    const sy = 600
    label(ctx, 'share this lock', left, sy, {
      font: font(TYPE.dimension),
      size: TYPE.dimension,
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
      font: font(TYPE.heading),
      size: TYPE.heading,
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
  const by = LOGICAL_HEIGHT - MARGIN - 130

  if (button(vp, p, ui, { x: bx2, y: by, w: bw, h: 52 }, 'Bench')) actions.goto('bench')
  bx2 += bw + gap
  if (button(vp, p, ui, { x: bx2, y: by, w: bw, h: 52 }, 'Again', { primary: !next })) {
    actions.restart()
  }
  if (next) {
    bx2 += bw + gap
    if (button(vp, p, ui, { x: bx2, y: by, w: bw, h: 52 }, 'Next lock', { primary: true })) {
      actions.startLock(next)
    }
    label(ctx, next.name, LOGICAL_WIDTH / 2, by + 84, {
      font: font(TYPE.body),
      size: TYPE.body,
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
  navBar(c, [['Menu', () => actions.goto('menu')]])

  const left = MARGIN + 60
  const w = 420
  let y = 150

  label(ctx, 'level', left, y, {
    font: font(TYPE.dimension),
    size: TYPE.dimension,
    color: p.inkLight,
  })
  const assistIndex = segmented(
    vp,
    p,
    ui,
    { x: left, y: y + 10, w: w + 160, h: 40 },
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
  paragraph(ctx, ASSIST_BLURB[s.assist], left, y + 70, {
    font: font(TYPE.body),
    color: p.ink,
    maxWidth: 1100,
    lineHeight: 26,
    maxLines: 2,
  })
  // It used to say "pays x2.50", of credits that no longer exist. The ladder now buys **time**:
  // the harder the mode, the more of the clock a given rank is worth (D-091).
  // Beside the control, not on it: right-aligned to `left + w + 160` put this straight across the
  // segmented control's own right-hand cell, because that is exactly where the control ends (D-099).
  text(
    ctx,
    `x${ASSIST_MULTIPLIER[s.assist].toFixed(2)} par for ranking`,
    left + w + 190,
    y + 36,
    { font: font(TYPE.body), color: readableAccents(p).amber },
  )
  // 116, not 108: Training and Hard both run the blurb to two lines, which ended 12px above the
  // next label's baseline — not a gap at 15px, and one word away from touching (D-099).
  y += 116

  label(ctx, 'which hand holds the pick', left, y, {
    font: font(TYPE.dimension),
    size: TYPE.dimension,
    color: p.inkLight,
  })
  const handIndex = segmented(
    vp,
    p,
    ui,
    { x: left, y: y + 10, w: 320, h: 40 },
    ['left', 'right'],
    s.handedness === 'right' ? 1 : 0,
  )
  const nextHand = handIndex === 1 ? 'right' : 'left'
  if (nextHand !== s.handedness) actions.updateSettings({ handedness: nextHand })
  text(ctx, 'mirrors the lock, so the keyway opens on your side', left + 344, y + 34, {
    font: font(TYPE.dimension),
    color: p.inkLight,
  })
  y += 84

  const sensitivity = slider(vp, p, ui, { x: left, y, w, h: 44 }, 'sensitivity', s.sensitivity, {
    min: 0.4,
    max: 2,
    step: 0.05,
  })
  if (sensitivity !== s.sensitivity) actions.updateSettings({ sensitivity })
  y += 62

  const master = slider(vp, p, ui, { x: left, y, w, h: 44 }, 'master volume', s.masterVolume)
  if (master !== s.masterVolume) actions.updateSettings({ masterVolume: master })
  y += 62
  const mech = slider(vp, p, ui, { x: left, y, w, h: 44 }, 'mechanical', s.mechanicalVolume)
  if (mech !== s.mechanicalVolume) actions.updateSettings({ mechanicalVolume: mech })
  y += 62
  const amb = slider(vp, p, ui, { x: left, y, w, h: 44 }, 'ambient', s.ambientVolume)
  if (amb !== s.ambientVolume) actions.updateSettings({ ambientVolume: amb })
  y += 74

  const toggles: [string, keyof SettingsData][] = [
    ['mute everything', 'muted'],
    ['hold tension (off = toggle)', 'tensionToggle'],
    ['reduce motion', 'reducedMotion'],
    // Off by default (D-085). The clicks always play; this is the drone layer underneath them.
    ['continuous tones (hum, scrape, bed)', 'continuousTones'],
    ['audio subtitles', 'subtitles'],
  ]
  for (const [caption, key] of toggles) {
    const current = s[key] as boolean
    const next = toggle(vp, p, ui, { x: left, y, w, h: 34 }, caption, current)
    if (next !== current) actions.updateSettings({ [key]: next })
    y += 44
  }

  // Save import/export sits below the nav bar rather than level with it: it is this screen's own
  // business, and the row along the top is now navigation and nothing else (D-103).
  const bx = LOGICAL_WIDTH - MARGIN - 308
  if (button(vp, p, ui, { x: bx, y: 200, w: 280, h: 46 }, 'Export save')) actions.exportSave()
  if (button(vp, p, ui, { x: bx, y: 260, w: 280, h: 46 }, 'Import save')) actions.importSave()
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
    font: font(TYPE.title),
    size: TYPE.title,
    color: p.ink,
    align: 'center',
  })

  const bw = w - 80
  let by = y + 110
  if (button(vp, p, ui, { x: x + 40, y: by, w: bw, h: 52 }, 'Resume', { primary: true })) {
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

/** `ART_DIRECTION.md §7`: a 5x8 grid of plates. Forty achievements, forty plates. */
const TROPHY_COLS = 5
const TROPHY_ROWS = 8

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
  const { vp, p, progress, actions } = c
  const { ctx } = vp
  const readable = readableAccents(p)
  const earned = new Set(progress.data.achievements)
  const reachable = ACHIEVEMENTS.filter((a) => a.reachable()).length

  screenFrame(
    c,
    'Trophies',
    c.status ?? `${earned.size} of ${ACHIEVEMENTS.length} earned  ·  ${reachable} currently earnable`,
  )
  navBar(c, [['Menu', () => actions.goto('menu')]])

  const left = MARGIN + 56
  // Below the nav bar, which the grid used to start level with (D-103).
  const top = 152
  const w = 356
  const h = 92
  const gapX = 12
  const gapY = 10

  for (let i = 0; i < ACHIEVEMENTS.length; i += 1) {
    const a = ACHIEVEMENTS[i]
    if (!a) continue
    const col = i % TROPHY_COLS
    const row = Math.floor(i / TROPHY_COLS)
    if (row >= TROPHY_ROWS) break
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

    text(ctx, a.name, x + 40, y + 28, {
      font: font(TYPE.body),
      color: got ? p.ink : locked ? p.rule : p.inkLight,
    })
    paragraph(
      ctx,
      got ? a.condition : locked ? 'Needs a lock that is not in the game yet' : '— locked —',
      x + 40,
      y + 50,
      {
        font: font(TYPE.dimension),
        color: got ? p.inkLight : p.rule,
        maxWidth: w - 54,
        lineHeight: 17,
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

  paragraph(ctx, def.name, rect.x + 16, rect.y + 28, {
    font: font(TYPE.body),
    color: p.ink,
    maxWidth: rect.w - 32,
    lineHeight: 24,
    maxLines: 1,
  })
  drawLockGlyph(vp, p, def, { x: rect.x + 16, y: rect.y + 36, w: 88, h: 34 }, code === null)

  const security = def.pins.filter((pin) => PROFILES[pin].grooveCount > 0).length
  text(ctx, `${chambersOf(def)} chambers`, rect.x + 116, rect.y + 52, {
    font: font(TYPE.dimension),
    color: p.inkLight,
  })
  text(ctx, security === 0 ? 'all standard' : `${security} security`, rect.x + 116, rect.y + 72, {
    font: font(TYPE.dimension),
    color: security > 0 ? readable.violet : p.inkLight,
  })

  if (code === null) {
    // The actual reason, not a stand-in for it. "not a pin tumbler" was printed on every codeless
    // card and was true of three of them; the rest were rejected for cuts the format cannot reach,
    // and a wrong explanation is worse than none (D-099).
    paragraph(ctx, `no code — ${shareProblem(def) ?? ''}`, rect.x + 16, rect.y + rect.h - 40, {
      font: font(TYPE.dimension),
      color: p.inkLight,
      maxWidth: rect.w - 32,
      lineHeight: 21,
      maxLines: 2,
    })
    return
  }
  // 92, with the buttons at 104: at 100 against buttons at 102 the code's descenders sat inside
  // the button frames below it (D-102).
  text(ctx, formatCode(code), rect.x + 16, rect.y + 92, {
    font: font(TYPE.dimension),
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
  const by = rect.y + rect.h - 32
  // Four buttons on a lock of your own, three on one of the game's — sized to the card's inner
  // width so the row is even either way.
  const deletable = customIndex !== undefined
  const inner = rect.w - 32
  const count = deletable ? 4 : 3
  const bw = Math.floor((inner - 8 * (count - 1)) / count)
  const step = bw + 8
  let bx = rect.x + 16
  if (button(vp, p, ui, { x: bx, y: by, w: bw, h: 28 }, 'play', {
    size: TYPE.dimension,
    enabled: playable,
  })) {
    actions.startLock(def)
  }
  bx += step
  if (button(vp, p, ui, { x: bx, y: by, w: bw, h: 28 }, 'edit', { size: TYPE.dimension })) {
    actions.editDef(def)
  }
  bx += step
  if (button(vp, p, ui, { x: bx, y: by, w: bw, h: 28 }, 'copy', { size: TYPE.dimension })) {
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
    button(vp, p, ui, { x: bx, y: by, w: bw, h: 28 }, armed ? 'sure?' : 'del', {
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
export function drawCodes(c: ShellContext): void {
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
    { font: font(TYPE.body), color: p.ink, maxWidth: 980, lineHeight: 30, maxLines: 2 },
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
  label(ctx, 'have a code?', boxX, 104, {
    font: font(TYPE.dimension),
    size: TYPE.dimension,
    color: p.inkLight,
  })
  const boxRect: Rect = { x: boxX, y: 114, w: 360, h: 44 }
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
    boxRect.y + 29,
    {
      font: font(TYPE.heading),
      size: TYPE.heading,
      color: entry === '' && !c.codeFocus ? p.rule : c.codeFocus ? readable.amber : p.ink,
    },
  )
  if (boxState.activated) actions.codeFocus(!c.codeFocus)

  const decoded = entry.trim() === '' ? null : decodeLock(entry, progress.data.customLocks.length)
  if (button(vp, p, ui, { x: boxX + 372, y: 114, w: 108, h: 44 }, 'Paste')) actions.codePaste()
  if (
    button(vp, p, ui, { x: boxX + 490, y: 114, w: 130, h: 44 }, 'Add', {
      primary: true,
      enabled: decoded !== null && decoded.problem === null,
    })
  ) {
    actions.codeSubmit()
  }
  if (entry !== '' && button(vp, p, ui, { x: boxX + 372, y: 166, w: 108, h: 26 }, 'clear', {
    size: TYPE.dimension,
  })) {
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
    // Below the `clear` button, not level with it: at 184 the sentence ran underneath it.
    204,
    {
      font: font(TYPE.dimension),
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
  let y = 206
  // Same gate as the bench: the first lesson unlocks the game, and this page is not a way past it.
  const taught = progress.data.tutorial.length > 0
  const custom = progress.data.customLocks
  label(ctx, 'your designs', BENCH_LEFT, y, {
    font: font(TYPE.heading),
    size: TYPE.heading,
    color: p.ink,
  })
  y += 18
  if (custom.length === 0) {
    text(
      ctx,
      'none yet — build one in the Editor, or paste a code somebody sent you',
      BENCH_LEFT,
      y + 18,
      { font: font(TYPE.body), color: p.inkLight },
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
    const pages = Math.max(1, Math.ceil(custom.length / CODE_COLS))
    const page = Math.min(Math.max(0, c.codesPage ?? 0), pages - 1)
    const from = page * CODE_COLS
    const shown = custom.slice(from, from + CODE_COLS)
    if (pages > 1) {
      if (button(vp, p, ui, { x: BENCH_LEFT + 210, y: y - 22, w: 40, h: 28 }, '‹', {
        size: TYPE.body,
        enabled: page > 0,
      })) {
        actions.codesPageBy(-1)
      }
      if (button(vp, p, ui, { x: BENCH_LEFT + 258, y: y - 22, w: 40, h: 28 }, '›', {
        size: TYPE.body,
        enabled: page < pages - 1,
      })) {
        actions.codesPageBy(1)
      }
      text(
        ctx,
        `${from + 1}–${from + shown.length} of ${custom.length}`,
        BENCH_LEFT + 312,
        y,
        { font: font(TYPE.dimension), color: p.inkLight },
      )
    }
    shown.forEach((def, i) => {
      // Your own locks were never tier-gated — they are not on the ladder at all.
      codeCard(
        c,
        def,
        { x: BENCH_LEFT + (CODE_CARD_W + CARD_GAP) * i, y, w: CODE_CARD_W, h: CODE_CARD_H },
        taught,
        from + i,
      )
    })
    y += CODE_CARD_H + 30
  }

  label(ctx, 'the roster', BENCH_LEFT, y, {
    font: font(TYPE.heading),
    size: TYPE.heading,
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
    text(ctx, `${roster.length} of ${ALL_LOCKS.length} — the rest cannot be written as a code`, BENCH_LEFT + 190, y, {
      font: font(TYPE.dimension),
      color: p.inkLight,
    })
  }
  y += 18
  roster.forEach((def, i) => {
    const col = i % CODE_COLS
    const row = Math.floor(i / CODE_COLS)
    codeCard(
      c,
      def,
      {
        x: BENCH_LEFT + (CODE_CARD_W + CARD_GAP) * col,
        y: y + row * (CODE_CARD_H + CARD_GAP),
        w: CODE_CARD_W,
        h: CODE_CARD_H,
      },
      taught && progress.isTierUnlocked(def.tier),
    )
  })
  const rows = Math.ceil(roster.length / CODE_COLS)
  y += rows * (CODE_CARD_H + CARD_GAP)

  // Same rule as the bench: this page does not scroll, so if it ever outgrows the stage, say so
  // rather than quietly dropping the last row off the bottom.
  if (y > LOGICAL_HEIGHT - MARGIN - 40) {
    text(ctx, `codes page overflows by ${Math.ceil(y - (LOGICAL_HEIGHT - MARGIN - 40))}px`, BENCH_LEFT, y, {
      font: font(TYPE.dimension),
      color: readable.crimson,
    })
  }
}

export function drawEditor(c: ShellContext): void {
  const { vp, p, ui, actions, progress } = c
  const draft = c.draft
  if (!draft) return
  const { ctx } = vp
  // The saved count belongs *in* the status line. As a second line of its own it sat 10px above the
  // one `screenFrame` draws, and 10px is not a line of 15px type — the two printed through each
  // other in the bottom-left corner of every visit to this screen (D-099).
  screenFrame(
    c,
    'Editor',
    c.status ??
      `design a lock, then pick it  ·  ${progress.data.customLocks.length} saved to the bench`,
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
  const dim = { font: font(TYPE.dimension), size: TYPE.dimension, color: p.inkLight }
  const value = { font: font(TYPE.body), size: TYPE.body, color: p.ink }

  // ── The lock as a whole ───────────────────────────────────────────────────────────────
  label(ctx, 'name', left, 112, dim)
  const nameRect: Rect = { x: left, y: 122, w: 420, h: 40 }
  const nameState = ui.widget(nameRect)
  cardFrame(vp, p, nameRect, nameState, false)
  label(ctx, `${draft.name}${c.editingName ? '_' : ''}`, nameRect.x + 12, nameRect.y + 26, {
    font: font(TYPE.body),
    size: TYPE.body,
    color: c.editingName ? readable.amber : p.ink,
  })
  if (nameState.activated) actions.editorFocusName(!c.editingName)
  text(
    ctx,
    c.editingName ? 'typing — click again or press enter to stop' : 'click to rename',
    nameRect.x + nameRect.w + 16,
    nameRect.y + 26,
    { font: font(TYPE.dimension), color: p.inkLight },
  )

  const rowY = 186
  label(ctx, 'chambers', left, rowY - 8, dim)
  if (
    button(vp, p, ui, { x: left, y: rowY, w: 38, h: 34 }, '-', {
      enabled: draft.chambers.length > MIN_CHAMBERS,
    })
  ) {
    actions.editorChamberCount(draft.chambers.length - 1)
  }
  // The spinners are laid out around the *width of their value* at the current face. At 18px a
  // two-digit count cleared `+` at left+84; at 21px it did not (D-102).
  text(ctx, String(draft.chambers.length), left + 60, rowY + 24, value)
  if (
    button(vp, p, ui, { x: left + 100, y: rowY, w: 38, h: 34 }, '+', {
      enabled: draft.chambers.length < MAX_CHAMBERS,
    })
  ) {
    actions.editorChamberCount(draft.chambers.length + 1)
  }

  label(ctx, 'tolerance', left + 210, rowY - 8, dim)
  if (
    button(vp, p, ui, { x: left + 210, y: rowY, w: 38, h: 34 }, '-', {
      enabled: draft.toleranceQuality > MIN_TOLERANCE + 1e-9,
    })
  ) {
    actions.editorTolerance(draft.toleranceQuality - 0.05)
  }
  text(ctx, draft.toleranceQuality.toFixed(2), left + 262, rowY + 24, value)
  if (
    button(vp, p, ui, { x: left + 330, y: rowY, w: 38, h: 34 }, '+', {
      enabled: draft.toleranceQuality < MAX_TOLERANCE - 1e-9,
    })
  ) {
    actions.editorTolerance(draft.toleranceQuality + 0.05)
  }
  // The number nobody can picture until it is in millimetres: how much room you get to stop in.
  text(ctx, `capture window ${windowWidth(draft).toFixed(2)} mm`, left + 386, rowY + 24, {
    font: font(TYPE.dimension),
    color: p.inkLight,
  })

  label(ctx, 'keyway', left + 620, rowY - 8, dim)
  const kw = segmented(
    vp,
    p,
    ui,
    { x: left + 620, y: rowY, w: 220, h: 34 },
    ['standard', 'tight'],
    draft.keyway === 'tight' ? 1 : 0,
  )
  if (kw !== (draft.keyway === 'tight' ? 1 : 0)) {
    actions.editorKeyway(kw === 1 ? 'tight' : 'standard')
  }

  // ── Per-chamber rows ──────────────────────────────────────────────────────────────────
  const top = 262
  const rowH = 36
  label(ctx, '#', left + 8, top - 8, dim)
  label(ctx, 'key pin', left + 74, top - 8, dim)
  label(ctx, 'driver', left + 300, top - 8, dim)
  label(ctx, 'spring', left + 600, top - 8, dim)
  label(ctx, 'sets at', left + 800, top - 8, dim)
  label(ctx, 'false sets', left + 900, top - 8, dim)

  for (let i = 0; i < draft.chambers.length; i += 1) {
    const row = draft.chambers[i]
    if (!row) continue
    const y = top + i * rowH
    text(ctx, String(i + 1), left + 8, y + 22, { font: font(TYPE.body), color: p.inkLight })

    if (button(vp, p, ui, { x: left + 74, y: y + 2, w: 30, h: 28 }, '-')) {
      actions.editorDepth(i, row.depth - 0.1)
    }
    text(ctx, `${row.depth.toFixed(2)} mm`, left + 116, y + 22, {
      font: font(TYPE.body),
      color: p.ink,
    })
    // `3.40 mm` is 88px at 21px type and used to be given 80 before the `+` landed (D-102).
    if (button(vp, p, ui, { x: left + 218, y: y + 2, w: 30, h: 28 }, '+')) {
      actions.editorDepth(i, row.depth + 0.1)
    }

    const pinRect: Rect = { x: left + 300, y: y + 2, w: 260, h: 28 }
    const pinState = ui.widget(pinRect)
    cardFrame(vp, p, pinRect, pinState, false)
    label(ctx, row.pin, pinRect.x + 10, y + 22, {
      font: font(TYPE.body),
      size: TYPE.body,
      color: p.ink,
    })
    text(ctx, '>', pinRect.x + pinRect.w - 12, y + 22, {
      font: font(TYPE.body),
      color: p.inkLight,
      align: 'right',
    })
    if (pinState.activated) actions.editorCyclePin(i)

    const sprRect: Rect = { x: left + 600, y: y + 2, w: 160, h: 28 }
    const sprState = ui.widget(sprRect)
    cardFrame(vp, p, sprRect, sprState, false)
    label(ctx, SPRING_CHOICES[row.spring]?.label ?? 'normal', sprRect.x + 10, y + 22, {
      font: font(TYPE.body),
      size: TYPE.body,
      color: p.ink,
    })
    text(ctx, '>', sprRect.x + sprRect.w - 12, y + 22, {
      font: font(TYPE.body),
      color: p.inkLight,
      align: 'right',
    })
    if (sprState.activated) actions.editorCycleSpring(i)

    // What those three choices add up to, in the simulation's own terms.
    const lies = PROFILES[row.pin].grooveCount
    text(ctx, `${(MAX_KEY_PIN - row.depth).toFixed(2)} mm`, left + 800, y + 22, value)
    text(ctx, lies === 0 ? '—' : String(lies), left + 900, y + 22, {
      font: font(TYPE.body),
      color: lies > 0 ? readable.violet : p.inkLight,
    })
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
  const previewDef = draftToLockDef(draft, progress.data.customLocks.length)
  const preview: Rect = { x: left + 980, y: 254, w: 490, h: 430 }
  panel(vp, p, preview, 'preview')
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
  paragraph(
    ctx,
    `${draft.chambers.length} chambers  ·  ` +
      (security === 0 ? 'no security pins' : `${security} security pin${security === 1 ? '' : 's'}`),
    preview.x + 40,
    preview.y + preview.h - 52,
    {
      font: font(TYPE.body),
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
  const shelfX = left + 1500
  label(ctx, 'your locks', shelfX, top - 8, dim)
  const saved = progress.data.customLocks
  if (saved.length === 0) {
    paragraph(ctx, 'nothing saved yet — build one on the left and press Save to bench', shelfX, top + 20, {
      font: font(TYPE.dimension),
      color: p.inkLight,
      maxWidth: 310,
      lineHeight: 17,
      maxLines: 3,
    })
  }
  saved.forEach((def, i) => {
    const rect: Rect = { x: shelfX, y: top + i * 46, w: 320, h: 40 }
    if (rect.y + rect.h > LOGICAL_HEIGHT - MARGIN - 150) return
    const st = ui.widget(rect)
    cardFrame(vp, p, rect, st, false)
    paragraph(ctx, def.name, rect.x + 10, rect.y + 18, {
      font: font(TYPE.body),
      color: p.ink,
      maxWidth: 200,
      lineHeight: 15,
      maxLines: 1,
    })
    text(ctx, `${def.bitting.length} chambers`, rect.x + 10, rect.y + 33, {
      font: font(TYPE.dimension),
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
  const footY = LOGICAL_HEIGHT - MARGIN - 116
  if (problem) {
    paragraph(ctx, problem, left, footY - 14, {
      font: font(TYPE.body),
      color: readable.crimson,
      maxWidth: BENCH_WIDTH,
      lineHeight: 24,
      maxLines: 2,
    })
  }

  if (
    button(vp, p, ui, { x: left, y: footY, w: 200, h: 46 }, 'Test pick', {
      primary: true,
      enabled: !problem,
    })
  ) {
    actions.editorTest()
  }
  if (
    button(vp, p, ui, { x: left + 220, y: footY, w: 220, h: 46 }, 'Save to bench', {
      enabled: !problem,
    })
  ) {
    actions.editorSave()
  }
  if (button(vp, p, ui, { x: left + 460, y: footY, w: 170, h: 46 }, 'New draft')) {
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
  label(ctx, 'share code', left + 850, footY - 14, dim)
  text(ctx, code ? formatCode(code) : '—', left + 850, footY + 20, {
    font: font(TYPE.heading),
    color: code ? p.ink : p.rule,
  })
  if (button(vp, p, ui, { x: left + 850, y: footY + 34, w: 120, h: 34 }, 'Copy', { enabled: !!code })) {
    actions.editorCopyCode()
  }
  if (button(vp, p, ui, { x: left + 985, y: footY + 34, w: 120, h: 34 }, 'Paste')) {
    actions.editorPasteCode()
  }
  if (button(vp, p, ui, { x: left + 1120, y: footY + 34, w: 190, h: 34 }, 'All codes')) {
    actions.goto('codes')
  }
}
