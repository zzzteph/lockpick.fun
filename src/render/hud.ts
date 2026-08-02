/**
 * HUD and screen chrome — GAME_DESIGN.md §2, ART_DIRECTION.md §7.
 *
 * A header naming the lock with the clock and pin dots, and a footer carrying the two meters
 * the player actually reads: tension, which they control, and resistance, which is the
 * simulation's only continuous channel back to them (SIMULATION.md §8).
 */

import type { SimState } from '../sim'
import {
  DISTURB_FACTOR,
  MAX_CHAMBERS,
  OPEN_THETA_FRACTION,
  THETA_OPEN,
  T_MIN_HOLD,
  T_SET_HOLD,
  clamp01,
} from '../sim'
import { RANKS, rankIndexFor, secondsLeftInRank } from '../game/ranks'
import { assemblyBounds, computeLayout } from './layout'
import { hatchRect, label, paragraph, text } from './draw'
import { STROKE, TYPE, alpha, font, readableAccents, type Palette } from './palette'
import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  isCompact,
  snapX,
  snapY,
  typeFor,
  type Viewport,
} from './viewport'

const MARGIN = 24
const HEADER_H = 64
/**
 * 124 — three rows, with the bars twice the height they were.
 *
 * It was 116 for four rows at the old type scale, then 140 for four rows at the current one
 * (D-102): a label at +32, a meter at +44, a caption at +76 and the key caps at +102. The key caps
 * moved to the left gutter with D-115, and the row they vacated went into the **bars** rather than
 * into empty page — 16px tall to 30 — because a ten-segment readout you glance at while your hands
 * are busy is the thing this panel is for.
 *
 * A label at +30, a bar at +44 running to +74, and a caption at +100.
 */
const FOOTER_H = 124
/** Height of the footer's horizontal bars. Was the literal 16 in six places (D-115). */
const BAR_H = 30
/**
 * Air above the footer's first row of labels — DECISIONS D-129.
 *
 * The labels sat at `footerY + 30`. At the compact type scale that is a 28px face whose ascenders
 * reach within eight pixels of the panel's own top edge, so the words looked stuck to the frame —
 * reported as *"at the footer, where wrench and plug text, they are without margin on the top"*.
 * 38 gives that row the same air the rest of the page has, and everything below it moves with it.
 */
const FOOTER_PAD = 38

/**
 * Top of the band the rank letter lives in: below the header, above the lock.
 *
 * `SHELL_TOP_MM` puts the top of the assembly at y≈218, so this is a clear 130px strip across the
 * full width of the stage — the only place a 104px glyph can be centred without ever covering a pin.
 */
const RANK_BAND_Y = MARGIN + HEADER_H

/**
 * The bottom of that band — the top of the assembly, measured rather than assumed.
 *
 * The band is 130px of clear page between the header and the lock, and everything in it was placed
 * with literals against a 21px face: the rank letter at +84 and the countdown under it at
 * `+84 + body + 10`. Scaled, `body` is 46 on the smallest phone, which puts the countdown's
 * baseline at 228 — **ten pixels inside the lock**, where it was drawn across the shell. Reported
 * as *"the timer overlaps with the lock"*, and it is the timer: the countdown to the next rank.
 *
 * Measured from `computeLayout` for the same reason `GUTTER_LEFT` is (D-106): every hardcoded
 * guess about where the assembly starts has eventually been wrong. See DECISIONS D-137.
 */
const RANK_BAND_BOTTOM = (() => {
  const widest = assemblyBounds(computeLayout(MAX_CHAMBERS, 0))
  return widest.y
})()

/**
 * Left edge of the right-hand gutter: the strip of page the lock can never reach into.
 *
 * `computeLayout` widens the assembly with the chamber count until it saturates, so the widest it
 * ever gets is the widest lock the simulation will accept — measured here rather than guessed,
 * because every hardcoded guess about this number in the file's history has been wrong. Chrome
 * anchored to this is clear of the pins at *every* chamber count, which is the property
 * `tests/render/hudlayout.test.ts` asserts.
 */
const GUTTER_LEFT = (() => {
  const widest = assemblyBounds(computeLayout(MAX_CHAMBERS, 0))
  return widest.x + widest.w + 12
})()

/** The "← bench" link's hit box, exported so the app can test the pointer against it (D-096). */
export const BENCH_LINK = { x: MARGIN + 16, y: MARGIN + 12, w: 132, h: 40 }

export interface HudOptions {
  readonly lockName: string
  readonly elapsed: number
  /**
   * Hide the resistance meter — Expert mode, which leaves audio and pick flex only.
   * Blind mode *keeps* it: `GAME_DESIGN.md §4` gives Blind "sound and the meter".
   */
  readonly showResistance: boolean
  /**
   * Whether the resistance readout may print the chamber's state as a **word**.
   *
   * Training only. Outside it the meter shows the number and nothing else, because the word is a
   * verdict rather than a reading: hiding the amber binding pin (D-043) and then writing
   * *"binding"* in the footer underneath hands back exactly what was hidden, and *"false set"* is
   * worse — telling a spool's lie apart from a real set is the hardest deduction in the game.
   * See DECISIONS D-054.
   */
  readonly showStateWord?: boolean
  /**
   * How much the per-pin dots in the header may say.
   *
   * `full` — set, overset, false set and binding, each in its own colour. Training.
   * `progress` — set or not set, and nothing else. How many pins you have done is something a
   *   real picker simply *remembers*, and taking it away was never asked for.
   * `none` — no dots at all.
   */
  readonly pinDots?: 'full' | 'progress' | 'none'
  /** Name the binding chamber in the dots. Training only (`GAME_DESIGN.md §4`, D-043). */
  readonly showBinding?: boolean
  /**
   * How deep the pick tip is, in millimetres, or null to omit it.
   *
   * Hard mode does not draw the pick at all, so this number *is* the pick: it is the only way
   * to know where your own hand is. Given as a figure rather than a bar because you need to be
   * able to return to a depth you found, and you cannot read a bar to two decimal places.
   */
  readonly depthMm?: number | null
  /**
   * The controls, as `[key, what it does]` pairs.
   *
   * Was one 11px run-on sentence in `inkLight` — *"← → move · space lift · ↑↓ nudge · Q tension…"* —
   * which is the smallest, faintest text on the screen carrying the only information a new player
   * cannot guess. Reported from play as "VERY HARD" to read, which it was. See DECISIONS D-096.
   */
  readonly keys: readonly (readonly [string, string])[]
  /** What to press to start over once the pick has snapped — differs by input scheme. */
  readonly restartHint: string
  /**
   * What to do to apply the wrench, shown whenever it is not applied (D-107).
   *
   * Passed in rather than written here for the same reason `restartHint` is: on touch there is no
   * key to press, there is a slider down the left gutter, and a caption naming a key the player
   * does not have is worse than no caption at all.
   */
  readonly tensionHint: string
  /**
   * What to say while the wrench *is* held, when there is something better than the default.
   *
   * Supplied only while it is worth saying — the two-thumb prompt on a phone, until the player has
   * held the wrench and lifted a pin at the same time. Absent everywhere else, which leaves the
   * notch explanation in place. See DECISIONS D-131.
   */
  readonly heldHint?: string
  /**
   * True when the player holds the lock right-handed, which mirrors the whole screen (D-130).
   *
   * The readouts move with the controls. If they did not, the wrench would land on top of them the
   * moment it crossed to the other gutter — the two are the only tenants of those two strips, and
   * they have to swap together or not at all.
   */
  readonly mirrored?: boolean
  /** The lock's par time in seconds, which is what the rank ladder is measured against. */
  readonly par: number
  /**
   * Which of the ten pressure steps the wrench is set to — the same 1-9/0 the keys select (D-103).
   *
   * Passed in rather than derived here: the mapping from a step to a tension lives in `ui/input`,
   * and a renderer reaching into the input layer to re-derive it is the wrong direction.
   */
  readonly pressureStep: number
  /** True while this is a study run rather than an attempt (D-092). */
  readonly inspecting?: boolean
  /**
   * True while a tutorial lesson is running, which suppresses the rank band entirely.
   *
   * The lesson line is a 900x46 panel at y=100 and the rank letter is a 104px glyph centred at
   * y=172 — they occupy the same strip and were drawn on top of each other. A lesson is not ranked
   * (it leaves no record at all), so there was never anything to show. See DECISIONS D-098.
   */
  readonly lesson?: boolean
  /**
   * True once the lock is open and the payoff sequence owns this band.
   *
   * The open sequence stamps the rank you **earned** at baseline 152 in the 64px payout face,
   * centred; the live readout draws the rank you are **on** at baseline 172 in the 104px rank face,
   * also centred. Both were drawn, so for the whole of every open the two letters sat on top of
   * each other — reported as *"when a new rank appears it is put on top of the current rank and
   * they overlap."*
   *
   * The live one goes, because it is the one that has stopped meaning anything: the clock is
   * stopped, the countdown counts down to nothing, and what you want to read is the letter the
   * attempt actually earned. It leaves a beat of empty band between the open and the stamp landing,
   * which is the sequence's own timing rather than a gap. See DECISIONS D-100.
   */
  readonly payoff?: boolean
  /** True when the pointer is over the bench link, so it can light up. */
  readonly benchHot?: boolean
  /**
   * Accumulated load on the pick, 0..1 where 1 is a permanent bend, and whether it has already
   * bent or broken (D-068).
   *
   * Shown at every level, because the bow in your own shaft is not information about the lock —
   * it is information about the thing in your hand, and a real picker can see it.
   */
  readonly strain?: { readonly amount: number; readonly bent: boolean; readonly broken: boolean }
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The resistance column: the same ten segments, standing up and filling from the bottom.
 *
 * Resistance is the one reading in the game that is a *quantity of force*, and force reads as
 * height — a bar growing upward is understood before it is thought about, where a bar growing
 * rightward has to be measured against its own track. It also puts the reading beside the
 * cutaway rather than under it, at the height your eye is already at. See DECISIONS D-057.
 */
function column(
  vp: Viewport,
  p: Palette,
  x: number,
  bottom: number,
  h: number,
  value: number,
  color: string,
  segments = 10,
  width = 46,
): void {
  const { ctx } = vp
  const gap = 4
  const w = width
  const segH = (h - gap * (segments - 1)) / segments
  const filled = Math.round(Math.max(0, Math.min(1, value)) * segments)
  for (let i = 0; i < segments; i += 1) {
    const sy = bottom - segH - i * (segH + gap)
    if (i < filled) {
      ctx.fillStyle = color
      ctx.fillRect(x, sy, w, segH)
      hatchRect(ctx, x, sy, w, segH, {
        spacing: 4,
        angleDeg: 0,
        color: alpha(p.ink, 0.4),
        lineWidth: 1,
      })
    } else {
      ctx.fillStyle = alpha(p.rule, 0.55)
      ctx.fillRect(x, sy, w, segH)
    }
    ctx.strokeStyle = p.inkLight
    ctx.lineWidth = STROKE.hairline
    ctx.strokeRect(x + 0.5, sy + 0.5, w - 1, segH - 1)
  }
}

/** A labelled horizontal meter, filled in ten segments so it reads as instrumentation. */
function meter(
  vp: Viewport,
  p: Palette,
  x: number,
  y: number,
  w: number,
  value: number,
  color: string,
  opts: { segments?: number; hatchFilled?: boolean; height?: number } = {},
): void {
  const { ctx } = vp
  const segments = opts.segments ?? 10
  const gap = 4
  // The bar's height used to be the literal 16 in six places. It is a parameter because the footer
  // grew when the key legend left it, and a readout with room to be bigger should be (D-115).
  const h = opts.height ?? 16
  const segW = (w - gap * (segments - 1)) / segments
  const filled = Math.round(Math.max(0, Math.min(1, value)) * segments)
  for (let i = 0; i < segments; i += 1) {
    const sx = x + i * (segW + gap)
    if (i < filled) {
      ctx.fillStyle = color
      ctx.fillRect(sx, y, segW, h)
      if (opts.hatchFilled) {
        hatchRect(ctx, sx, y, segW, h, {
          spacing: 4,
          angleDeg: 0,
          color: alpha(p.ink, 0.4),
          lineWidth: 1,
        })
      }
    } else {
      ctx.fillStyle = alpha(p.rule, 0.55)
      ctx.fillRect(sx, y, segW, h)
    }
    ctx.strokeStyle = p.inkLight
    ctx.lineWidth = STROKE.hairline
    ctx.strokeRect(sx + 0.5, y + 0.5, segW - 1, h - 1)
  }
}

/**
 * How hard you have to be pushing before the readout will name what it is feeling.
 *
 * The meter itself has been pressure-gated since D-056 — rest the tip on a pin and it reads its
 * floor — but the **word** beside it was read straight off `chamber.state`, so it announced
 * *"binding"* for a pin nobody was touching. Every leak this ladder closes it reopened, in the one
 * channel that spells the answer out. See DECISIONS D-076.
 */
const WORD_NEEDS_FORCE = 0.15

function stateWord(state: SimState, compact = false): string {
  const c = state.pickChamber >= 0 ? state.chambers[state.pickChamber] : undefined
  if (!c) return 'no contact'
  // Gated on **contact**, not on force. Force is now the overreach (D-083), and a free pin that
  // rides up with you never builds any — so gating the word on it would mean a loose chamber could
  // never be named, which is the opposite of what D-076 was for.
  /**
   * One word on a phone — DECISIONS D-146.
   *
   * This readout is right-aligned to the margin in the strip beside the lock, and on a phone
   * `typeFor` scales it up to stay legible (D-135). `push to feel` is the longest thing it can say
   * by some way, and at that size it reached back **into the assembly** — the same collision D-106
   * fixed for the captions above it, arriving through the one line that is not a caption. Shrinking
   * it to fit lands under the 11px floor, so what gives is the wording.
   *
   * `push` says the same thing next to a resistance bar reading zero, and every other state word is
   * short enough to have never been near the lock.
   */
  if (state.pickContact < WORD_NEEDS_FORCE) return compact ? 'push' : 'push to feel'
  switch (c.state) {
    case 'BINDING':
      return 'binding'
    case 'FALSE_SET':
      return 'false set'
    case 'SET':
      return 'set'
    case 'OVERSET':
      return 'overset'
    case 'FREE':
      return 'free'
  }
}

function stateInk(state: SimState, p: Palette): string {
  const r = readableAccents(p)
  const c = state.pickChamber >= 0 ? state.chambers[state.pickChamber] : undefined
  if (!c) return p.inkLight
  // Same gate as the word: colouring the column amber for an untouched pin is the identical leak
  // through a channel a colourblind player still reads (D-076).
  if (state.pickContact < WORD_NEEDS_FORCE) return p.inkLight
  switch (c.state) {
    case 'BINDING':
      return r.amber
    case 'FALSE_SET':
      return r.violet
    case 'SET':
      return r.teal
    case 'OVERSET':
      return r.crimson
    case 'FREE':
      return p.inkLight
  }
}

/**
 * The sidebar lamp — only drawn on a lock that has a sidebar.
 *
 * A sidebar failure is the one failure in the game that looks exactly like success: every pin
 * reads set, every dot in the header is teal, and the plug turns a third of the way and stops.
 * Without something saying so the player has no way to tell that from a lock they simply are
 * not turning hard enough, so the lamp names it — and, because a gated chamber that captured
 * misaligned is *the* thing they need to know, it counts them.
 */
function drawSidebarLamp(vp: Viewport, p: Palette, state: SimState, footerY: number): void {
  const ts = (size: number): number => typeFor(vp, size)
  const gated = state.chambers.filter((c) => c.sidebarGate !== null)
  if (gated.length === 0) return
  const { ctx } = vp
  const r = readableAccents(p)
  const aligned = gated.filter((c) => c.state === 'SET' && c.sidebarAligned).length
  const missed = gated.filter((c) => c.state === 'SET' && !c.sidebarAligned).length
  const ink = state.sidebarDropped ? r.teal : missed > 0 ? r.crimson : p.inkLight
  const word = state.sidebarDropped
    ? 'sidebar dropped'
    : missed > 0
      ? `sidebar held — ${missed} gate${missed === 1 ? '' : 's'} missed`
      : `sidebar up — ${aligned}/${gated.length} gates`

  const x = LOGICAL_WIDTH - MARGIN - 32
  const y = footerY + 44
  ctx.save()
  ctx.beginPath()
  ctx.arc(x - 8, y + 6, 8, 0, Math.PI * 2)
  ctx.fillStyle = state.sidebarDropped ? r.teal : missed > 0 ? r.crimson : p.paper
  ctx.fill()
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.stroke()
  ctx.restore()
  label(ctx, word, x - 24, y + 12, {
    font: font(ts(TYPE.dimension)),
    size: ts(TYPE.dimension),
    color: ink,
    align: 'right',
  })
}

export function drawHud(vp: Viewport, p: Palette, state: SimState, opts: HudOptions): void {
  const { ctx } = vp
  /**
   * On a small screen this page keeps what you need and drops what you can do without.
   *
   * At 0.36 stage scale — an 844x390 phone — everything here renders at about a third of its
   * logical size, and `TYPE.dimension` lands on six CSS pixels. The answer is not to shrink the
   * layout further or to scroll it: it is to draw **less**, and draw what is left at nearly twice
   * the size. What goes: the key legend (the touch controls are on screen and labelled, so the
   * legend was describing controls the player is looking at), the force column and both captions
   * explaining the pair, the tension and plug captions, and the pick-depth readout.
   *
   * What stays is what a hand needs mid-pick: the lock, the clock, the rank, the wrench and its
   * pressure, how far the plug has turned, and **resistance** — the one continuous channel the
   * simulation has back to the player (`SIMULATION.md §8`). See DECISIONS D-122.
   */
  const compact = isCompact(vp)
  const ts = (size: number): number => typeFor(vp, size)

  // ── Header ────────────────────────────────────────────────────────────────────────────
  ctx.save()
  ctx.fillStyle = p.paperShade
  ctx.fillRect(MARGIN, MARGIN, LOGICAL_WIDTH - MARGIN * 2, HEADER_H)
  ctx.strokeStyle = p.rule
  ctx.lineWidth = STROKE.hairline
  ctx.strokeRect(MARGIN + 0.5, MARGIN + 0.5, LOGICAL_WIDTH - MARGIN * 2 - 1, HEADER_H - 1)
  ctx.restore()

  const headerMid = MARGIN + HEADER_H / 2 + 5
  /**
   * "← bench" was a *label*. It looked like a way out and was not one — the only way off the pick
   * screen was Escape and then a menu, which nobody guesses from a piece of grey text that already
   * has an arrow on it. Reported from play as "during the lockpick, bench is not clickable".
   *
   * Drawn here and hit-tested by the caller, because the HUD has no `Ui` of its own and giving it
   * one to serve a single link would put widget state in the drawing layer. See DECISIONS D-096.
   */
  label(ctx, '← bench', MARGIN + 24, headerMid, {
    font: font(ts(TYPE.body)),
    size: ts(TYPE.body),
    color: opts.benchHot ? p.ink : p.inkLight,
  })
  if (opts.benchHot) {
    ctx.save()
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = p.ink
    ctx.beginPath()
    ctx.moveTo(MARGIN + 24, snapY(vp, headerMid + 5, STROKE.hairline))
    ctx.lineTo(MARGIN + 24 + BENCH_LINK.w - 12, snapY(vp, headerMid + 5, STROKE.hairline))
    ctx.stroke()
    ctx.restore()
  }
  label(ctx, opts.lockName, LOGICAL_WIDTH / 2, headerMid, {
    font: font(ts(TYPE.heading)),
    size: ts(TYPE.heading),
    color: p.ink,
    align: 'center',
  })

  // Pin dots — filled for set, ringed for the rest, so progress reads at a glance. Blind mode
  // hides them: knowing how many pins are set is exactly the thing it takes away.
  const dotR = 7
  const dotGap = 22
  const dotsRight = LOGICAL_WIDTH - MARGIN - 24
  const dots = opts.pinDots ?? 'full'
  const n = dots === 'none' ? 0 : state.chambers.length
  for (let i = 0; i < n; i += 1) {
    const c = state.chambers[i]
    if (!c) continue
    const cx = dotsRight - (n - 1 - i) * dotGap
    ctx.beginPath()
    ctx.arc(cx, MARGIN + HEADER_H / 2, dotR, 0, Math.PI * 2)
    if (c.state === 'SET') {
      ctx.fillStyle = p.teal
      ctx.fill()
    } else if (dots === 'progress') {
      // Set or not set, full stop. A false-set dot would tell you the spool is lying, and an
      // overset dot would tell you which pin to blame — both of those are readings, not memory.
    } else if (c.state === 'OVERSET') {
      ctx.fillStyle = p.crimson
      ctx.fill()
    } else if (c.state === 'FALSE_SET') {
      ctx.fillStyle = p.violet
      ctx.fill()
    } else if (c.state === 'BINDING' && (opts.showBinding ?? true)) {
      // Guided mode only — the header dots were naming the binding chamber in every mode,
      // which is the one thing the player is supposed to work out (D-043).
      ctx.fillStyle = p.amber
      ctx.fill()
    }
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.stroke()
  }
  // With the dots hidden — Blind and Expert — there is nothing to sit left of, and the old
  // arithmetic ran `-(0 - 1) * dotGap` and pushed the clock 22px *past* the right margin.
  const clockX = n > 0 ? dotsRight - (n - 1) * dotGap - 44 : dotsRight
  const rank = rankIndexFor(opts.elapsed, opts.par)
  const readable = readableAccents(p)
  text(ctx, formatClock(opts.elapsed), clockX, MARGIN + HEADER_H / 2 + 12, {
    font: font(ts(TYPE.clock)),
    color: p.ink,
    align: 'right',
  })
  const left = secondsLeftInRank(opts.elapsed, opts.par)

  /**
   * The rank, as **one letter**, centred, and large enough to read without looking for it.
   *
   * It was a seven-letter ladder with the current one boxed. That is a good diagram and a bad
   * readout: while you are picking, your eyes are on the pins, and a row of small glyphs in the
   * corner is not something peripheral vision resolves. Asked for in play as *"put it to the
   * centre, and just one letter, one big letter"* — which is right. You do not need to be shown
   * the ranks you no longer have; you need to know, at a glance, the one you are on.
   *
   * It sits in the band between the header and the top of the lock, so it is central without ever
   * being over the thing you are looking at. See DECISIONS D-089.
   */
  if (opts.lesson || opts.payoff) {
    // Nothing: during a lesson the instruction panel is drawn over this band by `drawLessonLine`,
    // and during the payoff the earned-rank stamp is. Both used to be drawn *through* the letter.
  } else if (state.stats.maxTension <= 0) {
    /**
     * Before the wrench has *ever* been used this attempt, this band says so — at title size,
     * centred, where the rank letter goes.
     *
     * The footer caption was the first attempt at this (D-107) and the report on it was
     * *"barely visible"*, which it was: `TYPE.dimension` is the smallest face in the game and it
     * was carrying the single most important thing a stuck beginner needs to know. D-096 made
     * exactly this complaint about exactly this size of type once already.
     *
     * The band is the right home and `opts.inspecting` had already made the argument — a word goes
     * here when a player would otherwise spend ten good minutes on a run that was never going to
     * work. A lock with no tension on it is that run: nothing binds, nothing captures, and every
     * pin still moves under the pick, so it looks like it is responding perfectly.
     *
     * Gated on `maxTension`, which is "has the wrench ever been held", **not** on tension being off
     * right now. Releasing the wrench mid-attempt is a real technique — feathering, resetting — and
     * a banner that flashed back every time would fight the rank readout it is standing in for.
     * Once you have used it once, the amber footer caption is enough. See DECISIONS D-112.
     */
    label(ctx, opts.tensionHint, LOGICAL_WIDTH / 2, RANK_BAND_Y + 66, {
      font: font(ts(TYPE.title), 'bold'),
      size: ts(TYPE.title),
      color: readable.amber,
      align: 'center',
    })
    label(ctx, 'nothing in the lock moves until it is under tension', LOGICAL_WIDTH / 2, RANK_BAND_Y + 100, {
      font: font(ts(TYPE.body)),
      size: ts(TYPE.body),
      color: p.inkLight,
      align: 'center',
    })
  } else if (opts.inspecting) {
    // No letter, because there is no rank to earn — and the word has to be unmissable, or a player
    // will spend ten good minutes on a run that was never going to count (D-092).
    label(ctx, 'INSPECTION', LOGICAL_WIDTH / 2, RANK_BAND_Y + 66, {
      font: font(ts(TYPE.title), 'bold'),
      size: ts(TYPE.title),
      color: readable.violet,
      align: 'center',
    })
    label(ctx, 'nothing is recorded', LOGICAL_WIDTH / 2, RANK_BAND_Y + 94, {
      font: font(ts(TYPE.body)),
      size: ts(TYPE.body),
      color: p.inkLight,
      align: 'center',
    })
  } else {
    const rankInk =
      rank <= 1 ? readable.teal : rank <= 3 ? readable.amber : rank <= 4 ? p.ink : readable.crimson
    ctx.save()
    ctx.globalAlpha = 0.9
    label(ctx, RANKS[rank]?.letter ?? 'F', LOGICAL_WIDTH / 2, RANK_BAND_Y + 84, {
      font: font(ts(TYPE.rank), 'bold'),
      size: ts(TYPE.rank),
      color: rankInk,
      align: 'center',
    })
    ctx.restore()
    /**
     * The countdown, directly under the letter it belongs to.
     *
     * It started under the clock in the top right, which put the two halves of one reading on
     * opposite sides of the screen — you would see the letter, then have to go and find out how
     * long it had left. Asked for in play as *"the timer for how much before the rank changes
     * should be below the rank"*, which is where it should always have been.
     */
    if (left !== null) {
      /*
       * The countdown takes the dimension face on a phone, and sits on the band's floor.
       *
       * The band is 130px between the header and the lock. The rank letter is 104 of them and is
       * deliberately not scaled (D-135), so at the compact body face there is simply no room for a
       * second line under it — clamping the body-sized line up to clear the lock pushed it into the
       * letter instead. One step down fits: the letter's ink ends at 177 and this sits at 183.
       */
      const countSize = compact ? ts(TYPE.dimension) : ts(TYPE.body)
      label(
        ctx,
        `${left.toFixed(1)}s to ${RANKS[rank + 1]?.letter ?? 'F'}`,
        LOGICAL_WIDTH / 2,
        Math.min(RANK_BAND_Y + 84 + countSize + 10, RANK_BAND_BOTTOM - countSize * 0.28 - 8),
        { font: font(countSize), size: countSize, color: p.inkLight, align: 'center' },
      )
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────────────────
  const footerY = LOGICAL_HEIGHT - MARGIN - FOOTER_H
  ctx.save()
  ctx.fillStyle = p.paperShade
  ctx.fillRect(MARGIN, footerY, LOGICAL_WIDTH - MARGIN * 2, FOOTER_H)
  ctx.strokeStyle = p.rule
  ctx.lineWidth = STROKE.hairline
  ctx.strokeRect(MARGIN + 0.5, footerY + 0.5, LOGICAL_WIDTH - MARGIN * 2 - 1, FOOTER_H - 1)
  ctx.restore()

  // 420, not 320 — the width the key legend gave back (D-115).
  const meterW = 420
  const leftX = MARGIN + 32
  /**
   * The tension readout says **which step you are on**, not a number between 0 and 1.
   *
   * The keys are `1` to `9` and `0`, the meter has ten segments, and the number beside it was
   * `0.45` — three ways of describing the same control, none of which said they were the same
   * control. Reported as *"the tension strength 1-2, 3-4 is not obvious right now; 1-0 is very
   * unobvious."*
   *
   * So the heading is the step, in the same numbers the keys use, and the 0..1 value stays beside
   * it in small type for anyone reading the notch against it. See DECISIONS D-103.
   */
  /**
   * …and it says **what** the pressure is on.
   *
   * D-103 made the heading name the step. It still did not name the control: three ways of saying
   * the same thing had become four, and none of them said the word *wrench*. Reported as
   * *"1-0 pressure 1 to 10, it's not clear which pressure — we need to say that tension wrench"*.
   * The wrench is the only thing in the game that has a pressure, and the reason a player cannot
   * infer that is that they have never seen it named next to the meter it drives (D-107).
   */
  /*
   * Step 0 is a real state and has to read like one — DECISIONS D-131.
   *
   * The touch slider folds "how hard" and "at all" into one control, so its step can be zero, and
   * `wrench 0 of 10` beside a slider whose bottom band says OFF is two names for the same thing.
   * The keyboard never sends 0 here, so this costs the flat layout nothing.
   */
  const off = opts.pressureStep <= 0
  label(
    ctx,
    off
      ? compact
        ? 'wrench off'
        : 'tension wrench — off'
      : compact
        ? `wrench ${opts.pressureStep} of 10`
        : `tension wrench — pressure ${opts.pressureStep} of 10`,
    leftX,
    footerY + FOOTER_PAD,
    {
      font: font(ts(TYPE.dimension)),
      size: ts(TYPE.dimension),
      color: p.inkLight,
    },
  )
  meter(
    vp,
    p,
    leftX,
    footerY + FOOTER_PAD + 14,
    meterW,
    state.tension,
    state.tension >= T_MIN_HOLD ? p.amber : p.rule,
    { height: BAR_H },
  )
  // The same em dash the slider's own header uses for off, so the two readouts speak one language.
  label(ctx, off ? '—' : String(opts.pressureStep), leftX + meterW + 20, footerY + FOOTER_PAD + 38, {
    font: font(ts(TYPE.heading), 'bold'),
    size: ts(TYPE.heading),
    color: off ? p.inkLight : p.ink,
  })
  text(ctx, state.tension.toFixed(2), leftX + meterW + 58, footerY + FOOTER_PAD + 38, {
    font: font(ts(TYPE.dimension)),
    color: p.inkLight,
  })
  /**
   * The pressure the pins you have already set need, marked on the meter you set pressure with.
   *
   * The wrench used to be a thing you turned on; since D-098 it is a thing you have to get *right*,
   * and the meter said nothing about which part of its range was which. A number between 0 and 1
   * cannot tell you that 0.21 loses pins and 0.31 does not — so the threshold is drawn where it
   * actually is, as the same notch the plug bar uses for the same job: a line the fill has to reach.
   *
   * Below it, leaning on one chamber shakes the drivers off the others. Above it, they stay. That is
   * the whole of the tension decision and it is now visible rather than deducible. See D-100.
   */
  const holdX = leftX + meterW * clamp01(T_SET_HOLD * DISTURB_FACTOR)
  ctx.save()
  ctx.strokeStyle = state.tension >= T_SET_HOLD * DISTURB_FACTOR ? p.ink : readableAccents(p).crimson
  ctx.lineWidth = STROKE.standard
  ctx.beginPath()
  ctx.moveTo(snapX(vp, holdX, STROKE.standard), footerY + FOOTER_PAD + 6)
  ctx.lineTo(snapX(vp, holdX, STROKE.standard), footerY + FOOTER_PAD + 14)
  ctx.stroke()
  ctx.restore()
  /**
   * The caption's row belongs to whichever sentence is *currently* true.
   *
   * While the wrench is off, "past the notch, set pins hold while you work" is advice about a
   * situation the player is not in — it explains the notch on a meter that is doing nothing, and
   * the one thing they need to know goes unsaid. **Nothing in this game works without the wrench**:
   * with no tension there is no binding pin, nothing captures, and lifting every pin in turn
   * achieves exactly nothing while the lock looks like it is responding perfectly. That is a state
   * a new player can sit in indefinitely without a single thing on screen suggesting why.
   *
   * So while it is off, the row says so, in amber, naming the key. Amber rather than `inkLight`
   * because this is the one caption on the screen that is asking for an action rather than
   * describing one. Reported as *"we also need to show that if the user has not pressed the
   * tension wrench"*. See DECISIONS D-107.
   */
  const wrenchOff = state.tension < T_MIN_HOLD
  /**
   * With the wrench held, the row teaches two-thumb play until it has happened once (D-131).
   *
   * `heldHint` rather than the fixed sentence because the thing worth saying at that moment is not
   * fixed: on a phone, the player who has just got tension on is about to let go of it to reach a
   * pin, and letting go is the one move that undoes what they have. On a desktop, and on a phone
   * once they have done it, the notch explanation is the better use of the row.
   */
  const held = opts.heldHint ?? 'past the notch, set pins hold while you work'
  // On a phone the prompt survives and the explanation does not: 'hold the wrench' is the one
  // sentence a stuck player needs, and the notch is visible on the meter itself (D-122). A hint
  // the caller has gone out of its way to supply is a prompt, so it survives too.
  if (!compact || wrenchOff || opts.heldHint !== undefined)
    label(ctx, wrenchOff ? opts.tensionHint : held, leftX, footerY + FOOTER_PAD + 70, {
      font: font(ts(TYPE.dimension)),
      size: ts(TYPE.dimension),
      color: wrenchOff || opts.heldHint !== undefined ? readableAccents(p).amber : p.inkLight,
    })

  if (opts.showResistance) {
    /**
     * A standing column at the right-hand margin, clear of the footer panel.
     *
     * The word beside it — and the state *colour* of the column itself — belong to the assisted
     * levels only. Colouring the bar amber for a bind is the same leak as writing "binding" under
     * it, through a channel a colourblind player would still read, so the two are gated together
     * (D-054, D-057).
     */
    const named = opts.showStateWord ?? true
    const flip = opts.mirrored ?? false
    /** Mirror an x-span about the stage centre — the same rule the touch controls use. */
    const mx = (x: number, w = 0): number => (flip ? LOGICAL_WIDTH - x - w : x)
    const colX = mx(LOGICAL_WIDTH - MARGIN - 110, 46)
    const colBottom = footerY - 56
    // 270 normally; 210 on a phone, where the readings above the bars are nearly twice the size
    // and need the room (D-129).
    const colH = compact ? 210 : 270
    /**
     * Two columns: what you are pushing **with**, and what pushes **back**.
     *
     * Resistance alone cannot answer the first question a player has now that feeling anything
     * requires pushing — "is this pin loose, or am I just not leaning on it?" The force column is
     * the cause and the resistance column is the effect, side by side, and the gap between them is
     * the whole reading: equal heights on a free pin, force well short of resistance on a bound
     * one. Asked for as "the resistance indicator should show how much force is being applied to
     * the pin". Both, rather than one instead of the other. See DECISIONS D-064.
     */
    /**
     * Both columns the same width, with the number above each in the heading face.
     *
     * The force column used to be a 22px sliver with no number at all beside a 46px resistance
     * column that had one — so the pair read as "the meter, and a decoration next to it" rather
     * than as two halves of one comparison. Asked for as *"resistance and numbers on it must be
     * more representable"*. Same width, same weight, same treatment: the gap between the two bars
     * is the reading, and a reading needs both sides drawn as if they matter.
     */
    const colW = 46
    const forceX = flip ? colX + colW + 62 : colX - colW - 62
    /**
     * One explicit vertical stack, top to bottom, with every row named.
     *
     * The block used to be written as offsets from `colBottom` in the order the drawing happened,
     * and two of them collided: the state word at `+48` put its ascenders through the `resistance`
     * label at `+26`, and the captions D-106 moved into the gutter were laid out at
     * `colBottom - 52` — the middle of the columns' own height, so they were drawn straight across
     * both bars. Fixing the first overlap by moving text into the gutter had simply produced a
     * second one, which is what happens when positions are relative to whatever was drawn last.
     *
     * Written as a stack, the collisions are arithmetic instead of a drawing order, and
     * `tests/render/hudlayout.test.ts` can check the gaps without a canvas. See DECISIONS D-109.
     */
    /**
     * Nothing sits on the shear line, which runs the full width of the stage at `SHEAR_Y` = 500.
     *
     * The stack used to straddle it with the state word at 516, ascenders through a 3px datum:
     * that is not a separator, it is a strike-through. The two caption lines go above the rule and
     * every *reading* goes below it, so the heaviest line on the page divides the explanation from
     * the numbers instead of cutting one in half (D-115).
     */
    /**
     * Spaced by the **type's own height**, not by fixed gaps — DECISIONS D-129.
     *
     * `WORD_Y = 552` and `NUM_Y = 586` is 34px of separation, which is right for a 21px word above
     * a 26px number and wrong the moment either grows. At the compact scale they are 38 and 42, so
     * the word's descenders reached 561 and the number's ascenders 556: the state word and the
     * reading it belongs to were drawn through each other on every phone. Reported as part of
     * *"…resist numbers overlaps"*.
     *
     * Stacking upward from the bars, each row given its own measured height plus a gap, is the
     * arrangement that cannot come apart when the scale moves — which it now does per device.
     */
    const wordSize = ts(TYPE.body)
    const numSize = ts(TYPE.heading)
    const NUM_Y = colBottom - colH - 16 // clear of the bars beneath it
    const WORD_Y = NUM_Y - numSize - 10 // clear of the number beneath it
    const CAPTION_Y = 452 // two lines of gutter caption, above the rule
    const LABEL_Y = colBottom + 26 // `force` / `resistance`, under their bars
    // The pair is a *comparison* (D-064) and a phone has room for one bar. Resistance is the one
    // that survives: it is the simulation's only continuous channel back to the player, and force
    // is knowable from the hand that is making it (D-122).
    if (!compact) {
      column(vp, p, forceX, colBottom, colH, state.pickForce, alpha(p.inkLight, 0.7), 10, colW)
    text(ctx, state.pickForce.toFixed(2), forceX + colW / 2, NUM_Y, {
      font: font(ts(TYPE.heading)),
      color: p.ink,
      align: 'center',
    })
      label(ctx, 'force', forceX + colW / 2, LABEL_Y, {
        font: font(ts(TYPE.dimension)),
        size: ts(TYPE.dimension),
        color: p.inkLight,
        align: 'center',
      })
    }

    /**
     * Centred on the column normally; **right-aligned to the margin** when compact.
     *
     * The column sits 110px off the right edge, which is fine for a 17px label centred on it and
     * not fine for the same label at 37. `PUSH TO FEEL` at the compact size is about 375px wide
     * and ran a hundred pixels off the side of the screen. Anchoring to the margin instead of to
     * the column is what keeps a reading that got bigger from also getting cut off (D-122).
     */
    const readX = compact ? (flip ? MARGIN : LOGICAL_WIDTH - MARGIN) : colX + colW / 2
    const readAlign = compact
      ? flip
        ? ('left' as const)
        : ('right' as const)
      : ('center' as const)
    column(vp, p, colX, colBottom, colH, state.resistance, named ? stateInk(state, p) : p.ink)
    text(ctx, state.resistance.toFixed(2), readX, NUM_Y, {
      font: font(numSize),
      color: named ? stateInk(state, p) : p.ink,
      align: readAlign,
    })
    label(ctx, 'resistance', readX, LABEL_Y, {
      font: font(ts(TYPE.dimension)),
      size: ts(TYPE.dimension),
      color: p.inkLight,
      align: readAlign,
    })
    /**
     * What the pair is *for*, in the strip of page to the right of the lock.
     *
     * Two bars labelled `force` and `resistance` are two nouns, and a player asked outright what
     * the force one was for. It is the cause and the other is the effect: the gap between them is
     * the reading — level on a pin that is free, force far short of resistance on one the plug is
     * pinching. That is the single most useful thing on the screen and it was being left to be
     * inferred from two words. See DECISIONS D-101.
     *
     * **It was drawn straight through the lock.** D-101 put these two lines at `forceX - 22`,
     * right-aligned, calling that "the empty column of page to their left" — and it is not empty,
     * it is where the assembly is. "resistance — how hard it pushes back" is ~367px of type
     * ending at x=1656, so it began at x≈1289 while a lock of six chambers or more reaches
     * x=1536: nearly 250px of caption over the pins, at the exact height of the keyway. Reported
     * as *"text during the lockpick — force/resistance overlaps with the lock itself"*.
     *
     * Anchored to `GUTTER_LEFT` now, which is derived from the widest the assembly can ever be
     * rather than from the columns, and wrapped to that width so a longer sentence wraps instead
     * of reaching back across the drawing. `tests/render/hudlayout.test.ts` asserts the clearance
     * at every chamber count. See DECISIONS D-106.
     */
    const captionW = LOGICAL_WIDTH - MARGIN - 8 - GUTTER_LEFT
    const captionX = flip ? MARGIN + 8 : GUTTER_LEFT
    /*
     * Not drawn at all on a phone, rather than drawn at y = -1000 (D-132).
     *
     * Hiding a thing by putting it a thousand pixels above the stage works, in the sense that
     * nobody sees it — but it is still measured, still costs a `measureText`, and it is invisible
     * to any check that asks what is on the screen. The layout audit reported it as text running
     * off the top edge, which is exactly what it was.
     */
    let cy = CAPTION_Y
    if (!compact) {
      for (const line of ['force — how hard you push', 'resistance — how hard it pushes back']) {
        cy += paragraph(ctx, line, captionX, cy, {
          font: font(ts(TYPE.dimension)),
          color: p.inkLight,
          maxWidth: captionW,
          lineHeight: 22,
        })
      }
    }
    if (named) {
      label(ctx, stateWord(state, compact), readX, WORD_Y, {
        font: font(wordSize),
        size: wordSize,
        color: stateInk(state, p),
        align: readAlign,
      })
    }
  }

  /**
   * How far the plug has actually turned — and, more to the point, when it turns **back**.
   *
   * Rotation was the one quantity the simulation cared about that the player could not read. It
   * decides whether a set pin is safe (`engaged`, D-071), whether a false-set spool can be forced
   * (D-075), and whether the lock is picked-but-unturned (D-048) — and all of it was inferable only
   * from a few degrees of plug on the diagram. The notch is the opening threshold, so "nearly there
   * and stuck" is a thing you can see rather than deduce.
   *
   * It goes crimson while θ is falling. A player who forces a spool and loses three pins needs the
   * cause on screen at the moment it happens, not a caption afterwards. See DECISIONS D-081.
   */
  const turningBack = state.thetaVelocity < -1e-3
  const plugX = LOGICAL_WIDTH / 2 + 40
  const plugW = 300
  label(ctx, turningBack ? 'plug — turning back' : 'plug', plugX, footerY + FOOTER_PAD, {
    font: font(ts(TYPE.dimension)),
    size: ts(TYPE.dimension),
    color: turningBack ? readableAccents(p).crimson : p.inkLight,
  })
  const turned = clamp01(state.theta / THETA_OPEN)
  meter(vp, p, plugX, footerY + FOOTER_PAD + 14, plugW, turned, turningBack ? readableAccents(p).crimson : p.ink, {
    height: BAR_H,
  })
  // The opening threshold, drawn as a notch above the bar rather than a segment inside it: it is a
  // line the fill has to reach, and a filled segment would read as progress rather than as a target.
  const notchX = plugX + plugW * OPEN_THETA_FRACTION
  ctx.save()
  ctx.strokeStyle = p.ink
  ctx.lineWidth = STROKE.standard
  ctx.beginPath()
  ctx.moveTo(snapX(vp, notchX, STROKE.standard), footerY + FOOTER_PAD + 6)
  ctx.lineTo(snapX(vp, notchX, STROKE.standard), footerY + FOOTER_PAD + 14)
  ctx.stroke()
  ctx.restore()
  // The bar was unlabelled beyond the word "plug", so the notch read as decoration. It is the
  // finish line: fill past it and the lock is open (D-100).
  if (!compact)
  label(ctx, 'how far it has turned — past the notch it opens', plugX, footerY + FOOTER_PAD + 70, {
    font: font(ts(TYPE.dimension)),
    size: ts(TYPE.dimension),
    color: p.inkLight,
  })

  if (!compact && opts.depthMm !== null && opts.depthMm !== undefined) {
    const dx = LOGICAL_WIDTH / 2 - 150
    label(ctx, 'pick depth', dx, footerY + FOOTER_PAD, {
      font: font(ts(TYPE.dimension)),
      size: ts(TYPE.dimension),
      color: p.inkLight,
    })
    text(ctx, `${opts.depthMm.toFixed(2)} mm`, dx, footerY + FOOTER_PAD + 38, {
      font: font(ts(TYPE.heading)),
      color: p.ink,
    })
  }

  /**
   * The pick's own condition, in the footer beside the tension meter.
   *
   * A slim bar that only appears once there is something to say: silent while the tool is
   * unstressed, amber as it loads, crimson and named once it has taken a set or snapped. Putting it
   * next to tension is deliberate — leaning too hard is the cause and this is the cost.
   */
  const strain = opts.strain
  if (strain && (strain.amount > 0.04 || strain.bent || strain.broken)) {
    // +230, not +90. The caption under the tension meter is 430px wide at the larger face and this
    // block used to start at 466 — the two shared 20px of row (D-102).
    const sx = leftX + meterW + 230
    const word = strain.broken ? 'pick broken' : strain.bent ? 'pick bent' : 'pick strain'
    const ink = strain.broken ? p.crimson : strain.bent ? p.crimson : p.amber
    label(ctx, word, sx, footerY + FOOTER_PAD, {
      font: font(ts(TYPE.dimension)),
      size: ts(TYPE.dimension),
      color: p.inkLight,
    })
    meter(vp, p, sx, footerY + FOOTER_PAD + 14, 180, strain.broken ? 1 : strain.amount, ink, {
      segments: 6,
      height: BAR_H,
    })
    /**
     * A snapped pick ends the attempt, and until now nothing said what to do about it — the bar
     * went crimson, the lock stopped responding, and the player was left to guess.
     *
     * Under the strain bar rather than beside it. At `sx + 196` on the meter's own row it began at
     * x=662 and ran 440px at body size, straight through the plug meter at x=1000 — reported as
     * *"the message when the lock is broken overlaps with the plug measure."* The caption row has
     * three tenants now and this is the middle one: tension's caption ends at 400, this runs
     * 466–909, and the plug's starts at 1000 (D-101).
     */
    if (strain.broken) {
      text(ctx, opts.restartHint, sx, footerY + FOOTER_PAD + 70, {
        font: font(ts(TYPE.body)),
        color: readableAccents(p).crimson,
      })
    }
  }

  drawSidebarLamp(vp, p, state, footerY)

  // The touch controls are drawn on screen and labelled, so on a phone this legend described
  // controls the player was looking at — and did it *on top of them*, straight across the pause
  // pad and the wrench slider, which share the same gutter (D-122).
  if (!compact) drawKeyLegend(vp, p, opts.keys)
}

/**
 * The controls, as boxed key caps with the action beside each — **down the left gutter**.
 *
 * A key you must press is a *thing*, so it is drawn as one: a bordered cap in full ink at body
 * size, with what it does beside it.
 *
 * It was a single row along the bottom of the footer, and the report on it was that it *"is not
 * really visible"* — which it was not, and for a structural reason rather than a styling one. Laid
 * out across the page it is seven caps and seven phrases in one horizontal band, read left to
 * right like prose; the eye scanning a game screen does not read prose, and the row sat under three
 * meters in the busiest strip on the page. Down the left gutter it is a *list*: one control per
 * line, caps aligned, scannable in the shape a control reference is normally in, at the top of the
 * page where nothing else is.
 *
 * It also pays for itself twice. The footer was 140px because it had four rows to fit; with this
 * gone it has three, so the meters that stayed got the height back rather than the page getting
 * emptier. See DECISIONS D-115.
 */
function drawKeyLegend(
  vp: Viewport,
  p: Palette,
  keys: readonly (readonly [string, string])[],
): void {
  const { ctx } = vp
  const ts = (size: number): number => typeFor(vp, size)
  const x = MARGIN + 16
  // The row pitch follows the type, or a scaled legend stacks its own lines on top of each other —
  // the entries are drawn at `ROW` apart and the glyphs got 1.8x taller (D-132).
  const ROW = Math.max(34, ts(TYPE.body) + 14)
  // Below the header, and stopping well short of the rotation gauge in the lower gutter.
  let ky = MARGIN + HEADER_H + 52
  /**
   * Cap boxes are all the same width — the widest in the set.
   *
   * In a row, a cap sized to its own label is right: the text flows on after it. In a column it is
   * wrong, because the labels beside them no longer line up, and a list whose second column is
   * ragged is a list you have to read rather than scan. Measured rather than counted, which is the
   * rule this row has now broken twice (D-102, D-109).
   */
  ctx.save()
  ctx.font = font(ts(TYPE.body), 'bold')
  const capW = keys.reduce((w, [key]) => Math.max(w, ctx.measureText(key).width + 20), 30)
  ctx.restore()

  for (const [key, what] of keys) {
    ctx.save()
    ctx.fillStyle = p.paper
    ctx.fillRect(x, ky, capW, 26)
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.strokeRect(snapX(vp, x, STROKE.standard), snapY(vp, ky, STROKE.standard), capW, 26)
    ctx.restore()
    label(ctx, key, x + capW / 2, ky + 18, {
      font: font(ts(TYPE.body), 'bold'),
      size: ts(TYPE.body),
      color: p.ink,
      align: 'center',
    })
    label(ctx, what, x + capW + 14, ky + 18, {
      font: font(ts(TYPE.body)),
      size: ts(TYPE.body),
      color: p.ink,
    })
    ky += ROW
  }
  // There was a `tab  tools` hint here. Tab opened the loadout, the loadout went with D-088, and
  // the hint stayed — a key legend advertising a key that does nothing, printed on every frame of
  // every attempt since. Nothing replaces it: this list is the whole of the controls.
}

/** The banner shown once the lock is open. The full sequence arrives in Phase 11. */
export function drawOpenBanner(vp: Viewport, p: Palette, elapsed: number): void {
  const ts = (size: number): number => typeFor(vp, size)
  const { ctx } = vp
  const w = 520
  const h = 108
  const x = (LOGICAL_WIDTH - w) / 2
  const y = 150
  ctx.save()
  ctx.fillStyle = p.paper
  ctx.fillRect(x, y, w, h)
  ctx.lineWidth = STROKE.heavy
  ctx.strokeStyle = p.teal
  ctx.strokeRect(x, y, w, h)
  ctx.restore()
  label(ctx, 'open', LOGICAL_WIDTH / 2, y + 52, {
    font: font(ts(TYPE.title)),
    size: ts(TYPE.title),
    color: p.ink,
    align: 'center',
  })
  text(ctx, `${elapsed.toFixed(2)}s · press R for a fresh seed`, LOGICAL_WIDTH / 2, y + 84, {
    font: font(ts(TYPE.body)),
    color: p.inkLight,
    align: 'center',
  })
}
