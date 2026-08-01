/**
 * The help screen — what every pin and every readout on the pick screen actually is.
 *
 * The game teaches by play (`GAME_DESIGN.md §10`) and that rule is right for *technique*: nobody
 * learns tension from a paragraph. It is not right for **vocabulary**. A player asked what `nudge`
 * did and what the force column was for, and the honest answer in both cases was that the screen
 * never said — the words were labels on things, not explanations of them. Asked for directly:
 * *"a specific section with the explanation on what is each of the pins, what is force, plug and
 * other graphics."*
 *
 * So this is a reference page, not a tutorial: three columns, no interaction, nothing to complete.
 * The pin silhouettes are drawn from `PROFILES` — the same band data the simulation shapes real
 * drivers from — so a pin cannot be drawn here as something it is not. See DECISIONS D-101.
 */

import { PROFILES, type PinTypeName } from '../sim'
import { label, paragraph, text } from '../render/draw'
import { STROKE, TYPE, alpha, font, readableAccents, type Palette } from '../render/palette'
import { driverOutline } from '../render/layout'
import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  MIN_TYPE_CSS,
  isCompact,
  typeFor,
  type Viewport,
} from '../render/viewport'
import { reportLink, screenFrame, type ShellContext } from './shell'
import { boxForCaption, button, captionWidth, minControlH, type Rect } from './widgets'

const MARGIN = 24
const LEFT = MARGIN + 28

/**
 * One driver pin, in section, from its own bands.
 *
 * Band 0 sits at the **bottom** — the end that crosses the shear line — so the drawing walks up
 * from `rect`'s base. A reduced band is drawn narrow, which is the whole of what a security pin is:
 * a place where the driver is thinner than the bore, for the plug's ledge to catch in.
 */
/**
 * The nine profiles, drawn from their own band data — DECISIONS D-125.
 *
 * This is the one screen where the pin types are seen **side by side**, so it is the screen where
 * two of them looking alike is a bug rather than a nuance. It had two, and together they made six
 * profiles draw as roughly the same picture:
 *
 * - every reduced band was drawn at a flat `rect.w * 0.44`, so `grooveDepth` — the number that says
 *   how narrow the waist actually is — was thrown away entirely. A wafer's 0.50 gate and a
 *   spool-slim's 0.24 nick came out identical.
 * - `taper` was never drawn anywhere in the game, so a mushroom's cone and a T-pin's square step
 *   were the same rectangle.
 *
 * Both are now read from the profile, through the same `driverOutline` the cutaway uses, so what is
 * on this page is what the simulation is working with rather than a diagram of it.
 */
function drawDriver(vp: Viewport, p: Palette, name: PinTypeName, rect: Rect): void {
  const { ctx } = vp
  const outline = driverOutline(
    PROFILES[name].bands,
    rect.x + rect.w / 2,
    rect.y + rect.h,
    rect.w,
    rect.h,
  )
  ctx.save()
  ctx.beginPath()
  outline.forEach((pt, i) => {
    if (i === 0) ctx.moveTo(pt.x, pt.y)
    else ctx.lineTo(pt.x, pt.y)
  })
  ctx.closePath()
  ctx.fillStyle = p.paperShade
  ctx.fill()
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.stroke()
  ctx.restore()
}

/**
 * One lock in section, with its parts named — DECISIONS D-133.
 *
 * The help screen opened with *"a plug cannot turn until every pin is caught on the shear line;
 * under torque it pinches one pin at a time"* — which uses plug, pin, shear line, torque and bind
 * before any of them has been shown, on a screen with no picture of a whole lock anywhere on it. A
 * usability review put it plainly: the page defines jargon with more jargon.
 *
 * So the first thing on it is now a labelled cross-section. It is deliberately **schematic** rather
 * than the real cutaway renderer: that one needs a `SimState`, draws springs, bevels, strain and a
 * pick, and answers a different question. This one answers "what am I looking at" — five parts, five
 * names, leader lines, nothing moving.
 */
function drawLockAnatomy(vp: Viewport, p: Palette, rect: Rect): void {
  const { ctx } = vp
  const dim = typeFor(vp, TYPE.dimension)
  /**
   * Each part gets its own colour, and its label is drawn in it — DECISIONS D-134.
   *
   * The first version was correct and unreadable: shell, plug, driver and key pin were all paper,
   * paperShade and rule, so five outlined boxes in three greys had to be told apart by tracing a
   * leader line to a caption. Reported as *"the lock is nice, but please add more colours — it's
   * hard to read since all the colours are the same"*.
   *
   * The accents are the palette's own, and the pins take the two the pick screen already uses for
   * the pieces they are: **amber** for the driver, which is the pin the plug pinches and the one
   * the cutaway paints amber when it binds, and **teal** for the key pin, which is what the cutaway
   * paints a pin that has set. So the diagram teaches the colour language as well as the parts,
   * rather than inventing a second one for this page alone.
   */
  const ac = readableAccents(p)
  const chambers = 4
  // The shear line sits at the plug's top edge, a third of the way down the body.
  const bodyH = rect.h * 0.62
  const bodyY = rect.y + rect.h * 0.1
  const shearY = bodyY + bodyH * 0.44
  const plugBottom = bodyY + bodyH

  ctx.save()
  // Shell body.
  ctx.fillStyle = p.paperShade
  ctx.fillRect(rect.x, bodyY, rect.w, bodyH)
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.strokeRect(rect.x, bodyY, rect.w, bodyH)

  // The plug: the cylinder that turns, its top edge the shear line.
  ctx.fillStyle = alpha(ac.violet, 0.14)
  ctx.fillRect(rect.x + 10, shearY, rect.w - 20, plugBottom - shearY)
  ctx.lineWidth = STROKE.standard
  ctx.strokeStyle = p.ink
  ctx.strokeRect(rect.x + 10, shearY, rect.w - 20, plugBottom - shearY)

  // Chambers: a driver above the line, a key pin below it.
  const pitch = (rect.w - 20) / chambers
  // Wide enough to read as a pin rather than a tick — this diagram is the only place a newcomer
  // sees what a chamber is (D-133).
  const boreW = Math.min(76, pitch * 0.46)
  for (let i = 0; i < chambers; i += 1) {
    const cx = rect.x + 10 + pitch * (i + 0.5)
    const x = cx - boreW / 2
    // Driver pin — in the shell, crossing down to the line.
    const driverH = bodyH * 0.3
    ctx.fillStyle = alpha(ac.amber, 0.55)
    ctx.fillRect(x, shearY - driverH, boreW, driverH)
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.strokeRect(x, shearY - driverH, boreW, driverH)
    // Key pin — in the plug, below the line, each a different length.
    // Drawn in the same weight as the driver above it, or the two halves of a chamber read as
    // one pin: paperShade on paper is the same value as the plug they sit in (D-133).
    const keyH = bodyH * (0.14 + i * 0.05)
    ctx.fillStyle = alpha(ac.teal, 0.45)
    ctx.fillRect(x, shearY, boreW, keyH)
    ctx.lineWidth = STROKE.standard
    ctx.strokeStyle = p.ink
    ctx.strokeRect(x, shearY, boreW, keyH)
  }

  // The shear line itself, across the whole body — the thing everything else is measured from.
  ctx.lineWidth = STROKE.heavy
  ctx.strokeStyle = ac.crimson
  ctx.beginPath()
  ctx.moveTo(rect.x - 24, shearY)
  ctx.lineTo(rect.x + rect.w + 24, shearY)
  ctx.stroke()
  ctx.restore()

  /** A name with a leader line back to the thing it names. */
  const callout = (
    name: string,
    tx: number,
    ty: number,
    px: number,
    py: number,
    colour: string,
  ): void => {
    ctx.save()
    ctx.lineWidth = STROKE.hairline
    ctx.strokeStyle = alpha(colour, 0.65)
    ctx.beginPath()
    ctx.moveTo(tx - 8, ty - dim * 0.3)
    ctx.lineTo(px, py)
    ctx.stroke()
    ctx.restore()
    label(ctx, name, tx, ty, { font: font(dim), size: dim, color: colour })
  }

  /*
   * The names are an evenly-spaced column, not five feature-relative positions.
   *
   * Hung off the parts they point at, two of them collide the moment the diagram is short — which
   * it is on the smallest phone, where the type is also at its largest. A leader line exists
   * precisely so the label does not have to sit level with its subject: the column can be regular
   * and the lines can do the work.
   */
  const midChamber = rect.x + 10 + pitch * 0.5
  const nameX = rect.x + rect.w + 34
  const marks: [string, number, number, string][] = [
    ['shell', rect.x + rect.w, bodyY + 12, p.ink],
    ['driver pin', midChamber + boreW / 2, shearY - bodyH * 0.12, ac.amber],
    ['shear line', rect.x + rect.w + 24, shearY, ac.crimson],
    ['key pin', midChamber + boreW / 2, shearY + bodyH * 0.08, ac.teal],
    ['plug', rect.x + rect.w - 10, plugBottom - 14, ac.violet],
  ]
  const pitchY = Math.max(dim * 1.6, (plugBottom - bodyY) / marks.length)
  const firstY = bodyY + dim
  marks.forEach(([name, px, py, colour], i) => {
    callout(name, nameX, firstY + i * pitchY, px, py, colour)
  })
}

/** `name`, one line about it, and the section drawing beside it. */
interface Entry {
  readonly term: string
  readonly blurb: string
}

const PINS: readonly (readonly [PinTypeName, string])[] = [
  ['standard', 'No grooves. It binds, it sets, and it is done with you.'],
  ['spool', 'One deep waist. The plug turns and the pin feels set — it is not.'],
  ['spool-slim', 'A narrower waist — the same lie, with less of it to feel.'],
  ['spool-deep', 'A deep waist that bites. The plug gives a long way first.'],
  ['spool-double', 'Two waists. Push through one and it lies to you again.'],
  ['serrated', 'Four shallow steps — four small false sets on the way up.'],
  ['mushroom', 'A bevelled shoulder. It shoves your pick out — ease the wrench off.'],
  ['t-pin', 'A square stem. Barely pushes back, but the plug gives a long way.'],
  ['wafer', 'One flat plate. Its gate must sit level with the shear line.'],
]

const READOUTS: readonly Entry[] = [
  {
    term: 'force',
    blurb:
      'How hard your tip is pushing. It rises only when the pin will not go where you ask.',
  },
  {
    term: 'resistance',
    blurb:
      'What the pin pushes back. Level with force means free; far above it means the plug is pinching this one.',
  },
  {
    term: 'tension',
    blurb:
      'How hard the wrench turns the plug — keys 1 to 10. Past the notch, set pins hold while you work.',
  },
  {
    term: 'plug',
    blurb: 'How far the plug has turned. Past the notch, it opens.',
  },
  {
    term: 'the big letter',
    blurb: 'The rank you are on, and how long before it drops one.',
  },
  {
    term: 'pick strain',
    blurb:
      'You are leaning on something that will not move. Bend it far enough and the pick snaps.',
  },
  {
    term: 'the dial',
    blurb:
      'The plug end-on: the angle you ask for, over the angle the pins allow.',
  },
]

const STATES: readonly Entry[] = [
  { term: 'free', blurb: 'Nothing holds it. It lifts easily and drops back.' },
  {
    term: 'binding',
    blurb: 'The one the plug is pinching. Heaviest under the tip.',
  },
  {
    term: 'false set',
    blurb: 'A security pin caught in a groove. The plug moved; this pin did not set.',
  },
  {
    term: 'set',
    blurb: 'Caught on the ledge. Keep the pressure up or it drops.',
  },
  {
    term: 'overset',
    blurb: 'Too far — the key pin is jammed into the shell. Only a reset frees it.',
  },
]

function stateColour(term: string, p: Palette): string {
  const readable = readableAccents(p)
  switch (term) {
    case 'binding':
      return readable.amber
    case 'false set':
      return readable.violet
    case 'set':
      return readable.teal
    case 'overset':
      return readable.crimson
    default:
      return p.inkLight
  }
}

/** The three pages, in order. */
/**
 * The page footnote, clear of the status line — DECISIONS D-109.
 *
 * Was `LOGICAL_HEIGHT - MARGIN - 56`, which is 1000, and the status line every screen draws sits
 * at 1026. Two 17-21px lines of `inkLight` 26px apart, with eight pixels between one's descenders
 * and the other's ascenders, read as one wrapped sentence saying two unrelated things. There is an
 * empty band 200px tall directly above them.
 */
const FOOTNOTE_Y = LOGICAL_HEIGHT - MARGIN - 104

/**
 * The per-page footnote is a nicety, and on a phone it is a nicety in the way (D-129).
 *
 * The grid grows a taller row-height at the compact scale, so five rows of pins now reach y=990 —
 * past the footnote at 952. One of them has to go, and it is the one that adds a remark rather
 * than the one that explains the nine pin types the page exists for.
 */
function footnote(c: ShellContext, line: string): void {
  if (isCompact(c.vp)) return
  text(c.vp.ctx, line, LEFT, FOOTNOTE_Y, {
    font: font(typeFor(c.vp, TYPE.body)),
    color: c.p.inkLight,
  })
}

/**
 * Four pages now, and shorter names for them — DECISIONS D-133.
 *
 * `what a pin is doing` is 484px of tab at the compact face; four of those overflow the row. The
 * captions each have a heading-sized page under them saying the same thing at length, so the tab
 * only has to be a handle.
 */
const PAGES = ['the lock', 'the pins', 'the readouts', 'pin states'] as const

/** Exported so a swipe can be clamped to the real range, not just the tab row's (D-131). */
export const HELP_PAGE_COUNT = PAGES.length

/**
 * Term, blurb, and an optional drawing, on a wide two-column grid.
 *
 * One section per page means each entry can have a whole half-width to itself, which is what turns
 * a column of two-line paragraphs into something you read rather than survey.
 */
function grid(
  c: ShellContext,
  top: number,
  entries: readonly Entry[],
  colour: (term: string) => string,
  draw?: (term: string, rect: Rect) => void,
): void {
  const { vp, p } = c
  const { ctx } = vp
  /**
   * The same two columns at every size, with the **type** scaled rather than the grid — D-129.
   *
   * Reported as *"help on mobile is barely visible — very small text"*, which it was: this page was
   * still drawing at 26 and 21 logical px, which is nine and seven actual pixels on a phone. It is
   * the one screen whose entire job is to be read.
   *
   * It gets away with keeping two columns because there are only nine entries on its longest page,
   * so five rows of a taller row-height still land above the status line. The drawing beside each
   * term grows with the text, or a 44px pin next to a 42px word reads as a smudge next to a title.
   */
  const compact = isCompact(vp)
  const cols = 2
  const gap = 40
  const width = Math.floor((LOGICAL_WIDTH - LEFT * 2 - gap) / cols)
  /**
   * The term takes the body face on a phone, not the heading face — DECISIONS D-132.
   *
   * The budget is fixed: nine pins in two columns is five rows, and the page has about 140px each.
   * A 47px heading plus two lines of blurb is 145, so the content-first shrink dropped every blurb
   * to **one line and an ellipsis** — on the one screen in the game whose entire job is to explain
   * what the nine pin types are. Truncating all nine explanations to buy a larger name for each is
   * exactly the wrong trade.
   *
   * At 38 over 30 the hierarchy still reads — the term is larger, and it is the only coloured thing
   * in the entry — and both lines of every blurb fit.
   */
  const termSize = compact ? typeFor(vp, TYPE.body) : typeFor(vp, TYPE.heading)
  /**
   * The blurb is one step down from the term on a phone — DECISIONS D-132.
   *
   * At `TYPE.body` scaled, a term is 47px and two lines of blurb are 90, so a row is 155 against a
   * `rowH` of 148 and every entry printed into the name of the one below it. Nine pins in two
   * columns is five rows, and five rows of a *correct* 171 is 855px starting at 250 — off the
   * bottom of the stage. Something had to give and it is not the row height, which is arithmetic.
   *
   * So the blurb drops to the dimension face, which is still 30px — three times the readability
   * floor — while the term stays large. That is ordinary typographic hierarchy rather than a
   * concession, and it is what makes nine entries fit a phone without truncating a single one.
   */
  /*
   * The silhouette is the point of this page, so it gets real size — DECISIONS D-133.
   *
   * At 44 (70 compact) a pin drew at about the size of a checkbox, and the waist, step or bevel
   * that distinguishes one type from another came out as an identical small square. A review put
   * it exactly that way. The blurb column loses the width, which it can afford: it is two lines
   * either way.
   */
  const glyphW = compact ? 104 : 76
  const textPad = glyphW + 32
  /**
   * The row pitch, and what has to give when the page runs out — DECISIONS D-132.
   *
   * Nine pins in two columns is five rows, and at the compact face an entry wants 171px: five of
   * those from `top` runs off the bottom of the stage. Shrinking the *pitch* alone is the obvious
   * move and it is wrong — the entry still draws the same height, so every blurb ends up printed
   * across the name of the entry below it, which is worse than running off the page.
   *
   * So the **content** gives first: a line of blurb, then the blurb's face, until an entry fits the
   * height the page actually has. Nothing is ever drawn taller than the row it is given.
   */
  const rows = Math.max(1, Math.ceil(entries.length / cols))
  const available = Math.floor((LOGICAL_HEIGHT - MARGIN - 70 - top) / rows)
  let bodySize = compact ? typeFor(vp, TYPE.dimension) : typeFor(vp, TYPE.body)
  let lines = compact ? 2 : 3
  const entryH = (): number => termSize + bodySize * (lines + 0.4) + 26
  while (lines > 1 && entryH() > available) lines -= 1
  // `MIN_TYPE_CSS` in logical px — 11 *logical* would be four CSS pixels on a phone, which is
  // the very thing the shrink is supposed to protect against (D-132).
  const floorLogical = MIN_TYPE_CSS / Math.max(vp.scale, 0.01)
  while (bodySize > floorLogical && entryH() > available) bodySize -= 1
  const rowH = Math.max(entryH(), Math.min(available, entryH()))
  entries.forEach((entry, i) => {
    const x = LEFT + (width + gap) * (i % cols)
    const y = top + Math.floor(i / cols) * rowH
    const textX = draw ? x + textPad : x
    /*
     * The entry starts *at* `y`, not 18px above it (D-132).
     *
     * A baseline of `y + 6` puts a 38px term's ascenders twenty pixels above the row's own top, so
     * the first row of every page was drawn up behind the tab it belongs to. The layout audit could
     * not see it: the tabs are boxes, and the audit compares text against text.
     */
    if (draw) draw(entry.term, { x, y: y + 2, w: glyphW, h: rowH - 44 })
    label(ctx, entry.term, textX, y + termSize * 0.86, {
      font: font(termSize),
      size: termSize,
      color: colour(entry.term),
    })
    paragraph(ctx, entry.blurb, textX, y + termSize + bodySize + 4, {
      font: font(bodySize),
      color: p.inkLight,
      maxWidth: width - (draw ? textPad : 0),
      lineHeight: bodySize + 7,
      maxLines: lines,
    })
  })
}

/**
 * Three pages, not one — because one page of all three sections is a wall.
 *
 * D-102 cut every blurb to a single sentence and the page was still twenty-one entries in three
 * columns of small type: *"make help 3 pages, right now there is too much text."* Split by the
 * question being asked — what are the pins, what are the readouts, what is a pin doing — each gets
 * the whole page, a two-column grid, body-size text and pin drawings twice the size.
 * See DECISIONS D-103.
 */
export function drawHelp(c: ShellContext): void {
  const { vp, p, ui, actions } = c
  const { ctx } = vp
  const page = Math.min(Math.max(0, c.helpPage ?? 0), PAGES.length - 1)
  screenFrame(c, 'Help', c.status ?? 'what everything on the pick screen means')

  // The nav bar lives in `shell.ts` and is not exported; this screen has one destination, drawn in
  // the same corner and at the same size as everywhere else (D-103).
  if (
    button(
      vp,
      p,
      ui,
      (() => {
        const box = boxForCaption(vp, 'Menu', typeFor(vp, TYPE.body), { w: 150, h: 40 })
        return { x: LOGICAL_WIDTH - MARGIN - 28 - box.w, y: MARGIN + 24, ...box }
      })(),
      'Menu',
    )
  ) {
    actions.goto('menu')
  }

  /**
   * The page's own opening line — scaled like everything else on it (D-130).
   *
   * D-129 scaled the grid and missed this, so the first sentence a player reads on the reference
   * screen was still drawing at 21 logical px: about seven actual pixels on a phone. Reported as
   * *"in mobile, help section, the text 'the plug cannot turn until…' is extra small and not
   * readable"*. It is the sentence the rest of the page is a footnote to.
   */
  /**
   * The opening line, and everything under it placed from where it ends — DECISIONS D-132.
   *
   * D-130 scaled this sentence and left the tab row at a fixed y=148. Scaled, it is two lines of
   * 38px type starting at 106, so it ran to 190 and the three page tabs were drawn straight
   * through it. The tabs go below whatever it used, and the grid below the tabs.
   */
  const introSize = typeFor(vp, TYPE.body)
  // Below the screen title, which is a scaled 38px face whose descenders reach past y=106.
  const introY = Math.max(106, MARGIN + 52 + typeFor(vp, TYPE.title) * 0.34 + 12)
  /*
   * A shorter sentence on a phone, not a truncated one — DECISIONS D-137.
   *
   * D-132 cut this to one line to buy header height for the grid, which left it reading *"A plug
   * cannot turn until every pin is caught on the shear line. Under torque…"* — an ellipsis in the
   * middle of a thought, on the first line of the reference screen. Reported as *"under torque is
   * the end of the phrase, something is missing"*, which is exactly right: it looks like a bug
   * because it is one.
   *
   * The first sentence is the one that has to land, and it lands whole. The rest of the thought —
   * that torque pinches one pin at a time — is what the four pages under it are for, and the page
   * about the lock says it directly beneath the diagram.
   */
  const introH = paragraph(
    ctx,
    isCompact(vp)
      ? 'A plug cannot turn until every pin is caught on the shear line.'
      : 'A plug cannot turn until every pin is caught on the shear line. Under torque it pinches ' +
        'one pin at a time: find that one by feel, and lift it until it catches.',
    LEFT,
    introY,
    {
      font: font(introSize),
      color: p.ink,
      maxWidth: LOGICAL_WIDTH - LEFT * 2 - 180,
      lineHeight: introSize + 7,
      // One line on a phone. The second line is 45px of a header the grid cannot spare, and the
      // first sentence — "a plug cannot turn until every pin is caught on the shear line" — is the
      // one that has to land.
      maxLines: isCompact(vp) ? 1 : 2,
    },
  )

  const tabSize = typeFor(vp, TYPE.body)
  const tabH = Math.max(42, minControlH(vp, tabSize))
  const tabY = introY + introH + 16
  const tabW = Math.max(
    260,
    ...PAGES.map((name) => Math.ceil(captionWidth(vp, name, tabSize)) + 28),
  )
  const tabGap = 20
  PAGES.forEach((name, i) => {
    const rect: Rect = { x: LEFT + i * (tabW + tabGap), y: tabY, w: tabW, h: tabH }
    if (button(vp, p, ui, rect, name, { primary: i === page })) actions.helpPage(i)
  })
  const gridTop = tabY + tabH + (isCompact(vp) ? 16 : 26)

  if (page === 0) {
    /*
     * The whole lock, before any prose about it. Sized to the page rather than a constant, and
     * left of centre so the callouts have somewhere to go.
     */
    /*
     * The prose is placed from the bottom up and the diagram takes what is left.
     *
     * Three lines of body type at the compact face is 144px, and the report link is the lowest
     * thing on the page — so the sentence is hung off that rather than off a constant, and the
     * cross-section is given the gap between the tabs and it.
     */
    const proseSize = typeFor(vp, TYPE.body)
    const proseLines = 3
    const proseH = proseLines * (proseSize + 10)
    const proseY = reportLink(vp).y - 20 - proseH
    const w = Math.min(1020, LOGICAL_WIDTH - LEFT * 2 - 360)
    drawLockAnatomy(vp, p, {
      x: LEFT + 20,
      y: gridTop + 10,
      w,
      h: Math.max(120, proseY - gridTop - 40),
    })
    paragraph(
      ctx,
      /*
       * Written to *fit* three lines on a phone, not trimmed to them — DECISIONS D-137.
       *
       * The long version ended "…until its gap…" at the compact face, which is the same defect as
       * the truncated opening line and has the same cause: prose written for a full page, given a
       * line budget, and allowed to run out. The clause about the plug creeping onto the next pin
       * is the one to lose — it describes what the player is about to watch happen anyway.
       */
      isCompact(vp)
        ? 'The plug is the cylinder a key turns. It cannot turn while any driver pin still ' +
          'crosses the shear line. Turning gently pinches one pin at a time — lift that one ' +
          'until its gap reaches the line.'
        : 'The plug is the cylinder a key turns. It cannot turn while any driver pin still ' +
          'crosses the shear line — the gap between plug and shell. Turning gently pinches one ' +
          'pin at a time; lift that one until its gap reaches the line, and the plug creeps ' +
          'round onto the next.',
      LEFT + 20,
      proseY + proseSize,
      {
        font: font(proseSize),
        color: p.ink,
        maxWidth: LOGICAL_WIDTH - LEFT * 2 - 40,
        lineHeight: proseSize + 10,
        maxLines: proseLines,
      },
    )
  } else if (page === 1) {
    grid(
      c,
      gridTop,
      PINS.map(([term, blurb]) => ({ term, blurb })),
      (term) => (PROFILES[term as PinTypeName].grooveCount > 0 ? readableAccents(p).violet : p.ink),
      (term, rect) => drawDriver(vp, p, term as PinTypeName, rect),
    )
    footnote(c, 'a narrow band is a groove — somewhere for the plug to catch and lie to you')
  } else if (page === 2) {
    grid(c, gridTop, READOUTS, () => p.ink)
    footnote(c, 'the gap between force and resistance is the reading — that is how you find the binding pin')
  } else {
    grid(c, gridTop, STATES, (term) => stateColour(term, p))
    footnote(c, 'nothing here is random — every lock is the same lock every time you pick it')
  }
}
