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
import { STROKE, TYPE, font, readableAccents, type Palette } from '../render/palette'
import { driverOutline } from '../render/layout'
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, type Viewport } from '../render/viewport'
import { screenFrame, type ShellContext } from './shell'
import { button, type Rect } from './widgets'

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

const PAGES = ['the pins', 'the readouts', 'what a pin is doing'] as const

/**
 * Term, blurb, and an optional drawing, on a wide two-column grid.
 *
 * One section per page means each entry can have a whole half-width to itself, which is what turns
 * a column of two-line paragraphs into something you read rather than survey.
 */
function grid(
  c: ShellContext,
  entries: readonly Entry[],
  colour: (term: string) => string,
  draw?: (term: string, rect: Rect) => void,
): void {
  const { vp, p } = c
  const { ctx } = vp
  const cols = 2
  const gap = 40
  const width = Math.floor((LOGICAL_WIDTH - LEFT * 2 - gap) / cols)
  const rowH = 132
  entries.forEach((entry, i) => {
    const x = LEFT + (width + gap) * (i % cols)
    // 250: the page tabs end at y=190 and a pin drawing starts 18px above its own baseline, so at
    // 206 the first row was drawn behind the tab it belongs to (D-103).
    const y = 250 + Math.floor(i / cols) * rowH
    const textX = draw ? x + 76 : x
    if (draw) draw(entry.term, { x, y: y - 18, w: 44, h: 88 })
    label(ctx, entry.term, textX, y + 6, {
      font: font(TYPE.heading),
      size: TYPE.heading,
      color: colour(entry.term),
    })
    paragraph(ctx, entry.blurb, textX, y + 40, {
      font: font(TYPE.body),
      color: p.inkLight,
      maxWidth: width - (draw ? 76 : 0),
      lineHeight: 28,
      maxLines: 3,
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
      { x: LOGICAL_WIDTH - MARGIN - 28 - 150, y: MARGIN + 24, w: 150, h: 40 },
      'Menu',
    )
  ) {
    actions.goto('menu')
  }

  paragraph(
    ctx,
    'A plug cannot turn until every pin is caught on the shear line. Under torque it pinches one ' +
      'pin at a time: find that one by feel, and lift it until it catches.',
    LEFT,
    106,
    { font: font(TYPE.body), color: p.ink, maxWidth: 1300, lineHeight: 28, maxLines: 2 },
  )

  PAGES.forEach((name, i) => {
    const rect: Rect = { x: LEFT + i * 320, y: 148, w: 300, h: 42 }
    if (button(vp, p, ui, rect, name, { primary: i === page })) actions.helpPage(i)
  })

  if (page === 0) {
    grid(
      c,
      PINS.map(([term, blurb]) => ({ term, blurb })),
      (term) => (PROFILES[term as PinTypeName].grooveCount > 0 ? readableAccents(p).violet : p.ink),
      (term, rect) => drawDriver(vp, p, term as PinTypeName, rect),
    )
    text(
      ctx,
      'a narrow band is a groove — somewhere for the plug to catch and lie to you',
      LEFT,
      FOOTNOTE_Y,
      { font: font(TYPE.body), color: p.inkLight },
    )
  } else if (page === 1) {
    grid(c, READOUTS, () => p.ink)
    text(
      ctx,
      'the gap between force and resistance is the reading — that is how you find the binding pin',
      LEFT,
      FOOTNOTE_Y,
      { font: font(TYPE.body), color: p.inkLight },
    )
  } else {
    grid(c, STATES, (term) => stateColour(term, p))
    text(
      ctx,
      'nothing here is random — every lock is the same lock every time you pick it',
      LEFT,
      FOOTNOTE_Y,
      { font: font(TYPE.body), color: p.inkLight },
    )
  }
}
