/**
 * Palette — ART_DIRECTION.md §1.
 *
 * Two themes. Drafting is the default; Blueprint is a cosmetic alternate.
 * Nothing here encodes state in hue alone — every state also carries a fill pattern,
 * defined alongside the colour so the two can never drift apart.
 */

export type ThemeName = 'drafting' | 'blueprint'

/** Fill patterns double as the colourblind channel (ART_DIRECTION.md §1). */
export type FillPattern = 'solid' | 'hatch' | 'crosshatch' | 'dotted' | 'none'

export interface Palette {
  readonly name: ThemeName
  /** Background. */
  readonly paper: string
  /** Panel fills, plug body. */
  readonly paperShade: string
  /** Primary linework, text. */
  readonly ink: string
  /** Secondary lines, labels, dimension marks. */
  readonly inkLight: string
  /** Grid, guides, inactive borders. */
  readonly rule: string
  /** Pin bodies at rest, tool bodies. */
  readonly steel: string
  /**
   * The plug (core) — the part that turns. Brass, because it is brass.
   *
   * Shell and plug were both `paperShade`, which made the single most important boundary in the
   * game — the shear line, where one piece of metal ends and another begins — a line with the
   * same material on both sides of it. Two tones of brass say "two parts" before any label does.
   * Named by role rather than by colour so the blueprint theme can stay blue without lying
   * about what it is showing. See DECISIONS D-050.
   */
  readonly plugBody: string
  /** The shell (housing) — the part that does not turn. Slightly deeper, and it sits behind. */
  readonly shellBody: string
  /** BINDING — the pin demanding attention. */
  readonly amber: string
  /** SET — a chamber that's done. */
  readonly teal: string
  /** OVERSET — always paired with cross-hatch, never colour alone. */
  readonly crimson: string
  /** FALSE_SET — the beautiful lie. */
  readonly violet: string
  /** Flash on set, celebration accents. */
  readonly highlight: string
  /** Letterbox bars outside the 1920x1080 logical stage. */
  readonly letterbox: string
}

export const DRAFTING: Palette = {
  name: 'drafting',
  paper: '#F4F1EA',
  paperShade: '#E7E2D8',
  ink: '#1C1B19',
  // Spec said #6B6862; that lands at 4.35:1 on `paperShade` and fails the WCAG AA rule
  // the same document sets. Darkened to the nearest value that clears 4.5:1. See D-004.
  inkLight: '#666460',
  rule: '#C9C3B6',
  steel: '#8C9199',
  plugBody: '#E9DFC0',
  shellBody: '#DBD0AA',
  amber: '#D98324',
  teal: '#1E7A73',
  crimson: '#B23A2E',
  violet: '#6B4E9B',
  highlight: '#F2C14E',
  letterbox: '#14171A',
}

/**
 * Blueprint — ART_DIRECTION.md §1. Accents keep the same hues, brightened for contrast
 * against the dark ground. The exact brightened values are chosen to clear WCAG AA
 * against `paper`; `tests/render/palette.test.ts` enforces that.
 */
export const BLUEPRINT: Palette = {
  name: 'blueprint',
  paper: '#0E2233',
  paperShade: '#153049',
  ink: '#D8E6F0',
  inkLight: '#93A9BC',
  rule: '#2C4A66',
  steel: '#9FB0C0',
  plugBody: '#183851',
  shellBody: '#122B41',
  amber: '#F0A44C',
  teal: '#48C4B8',
  crimson: '#E8776A',
  violet: '#A98FE0',
  highlight: '#FFD97A',
  letterbox: '#050C14',
}

export const THEMES: Record<ThemeName, Palette> = {
  drafting: DRAFTING,
  blueprint: BLUEPRINT,
}

/** Stroke weights — ART_DIRECTION.md §2. Three only, in logical pixels. */
export const STROKE = {
  hairline: 1,
  standard: 2,
  heavy: 3,
} as const

/** Type scale — ART_DIRECTION.md §3, in logical pixels. */
/**
 * The type scale, in logical pixels — and it was a third too small for the screen it lands on.
 *
 * The stage is a fixed 1920×1080 letterboxed into whatever the browser gives it, so every size here
 * is multiplied by `vp.scale` before anybody reads it. On a 1440-wide laptop that is 0.75, which
 * turned the 11px dimension face into **eight physical pixels** — below the size at which a
 * monospace font renders legibly at all, and it was carrying the control hints, the tier
 * requirements, the lock stats and every caption in the game.
 *
 * Raised by about a third across the board. Reported from play twice, the second time as "a lot of
 * things are VERY SMALL and barely visible", which is the kind of note that does not need a third
 * hearing. The display sizes — clock, rank, payout — are unchanged: those were already read at a
 * glance, which is how the small ones went unnoticed for so long. See DECISIONS D-096.
 */
/**
 * Raised again, and this time the pages lost content to pay for it.
 *
 * D-096 raised the scale and D-097 spent a session repairing what that broke, which taught the rule
 * this pass is built on: **a type scale is a layout, and a bigger one has to be paid for in
 * content, not in whitespace.** Reported as *"make the font a bit bigger and more spacious"* and,
 * in the same breath, *"every page has a lot of text and a lot of information that makes it hard to
 * understand."* Those are one request. Sizes up about 15%, line heights up more than that, and
 * every screen that could not afford it gave something up rather than tightening. See D-102.
 */
export const TYPE = {
  dimension: 17,
  body: 21,
  heading: 26,
  title: 38,
  /** The pick screen's clock. Second only to the lock itself — see DECISIONS D-084. */
  clock: 40,
  /** The rank letter, centred above the lock. One glyph, read at a glance (D-089). */
  rank: 104,
  payout: 64,
} as const

export const FONT_STACK = `ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace`

export function font(sizePx: number, weight: 'normal' | 'bold' = 'normal'): string {
  return `${weight === 'bold' ? '600 ' : ''}${sizePx}px ${FONT_STACK}`
}

/** Parse `#RRGGBB` into 0-255 components. */
export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ]
}

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  const lin = (v: number): number => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio between two `#RRGGBB` colours, 1.0 – 21.0. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Mix two hex colours; `t` = 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a)
  const [br, bg, bb] = parseHex(b)
  const c = (x: number, y: number): string =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0')
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`
}

/** Hex colour with an alpha channel, as `rgba(...)`. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/**
 * Darken (on a light ground) or lighten (on a dark ground) `color` until it clears
 * `target` contrast against `bg`. Hue survives; lightness moves.
 *
 * The four accent hues are tuned to read as *fills* outlined in ink. Used as text they sit
 * below WCAG AA, so anywhere an accent becomes type we use this variant instead
 * (ART_DIRECTION.md §1, "All text/background pairs must clear WCAG AA").
 */
export function ensureContrast(color: string, bg: string, target = 4.5): string {
  if (contrastRatio(color, bg) >= target) return color
  const towards = relativeLuminance(bg) > 0.35 ? '#000000' : '#FFFFFF'
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2
    if (contrastRatio(mix(color, towards, mid), bg) >= target) hi = mid
    else lo = mid
  }
  return mix(color, towards, hi)
}

export interface ReadableAccents {
  readonly amber: string
  readonly teal: string
  readonly crimson: string
  readonly violet: string
  readonly highlight: string
}

const readableCache = new Map<ThemeName, ReadableAccents>()

/**
 * Accent colours safe to use as *text*, against the harder of the two backgrounds
 * (`paperShade` in both themes).
 */
export function readableAccents(p: Palette): ReadableAccents {
  const hit = readableCache.get(p.name)
  if (hit) return hit
  const bg = p.paperShade
  const out: ReadableAccents = {
    amber: ensureContrast(p.amber, bg),
    teal: ensureContrast(p.teal, bg),
    crimson: ensureContrast(p.crimson, bg),
    violet: ensureContrast(p.violet, bg),
    highlight: ensureContrast(p.highlight, bg),
  }
  readableCache.set(p.name, out)
  return out
}

/** Chamber states, as the renderer and HUD know them. Mirrors `src/sim` ChamberState. */
export type StateKey = 'free' | 'binding' | 'set' | 'overset' | 'falseSet'

/**
 * The colourblind channel: every state carries a distinct fill pattern as well as a hue
 * (ART_DIRECTION.md §1). This map is the single source of truth for both, so the two can
 * never drift apart.
 */
export const STATE_PATTERN: Record<StateKey, FillPattern> = {
  free: 'none',
  binding: 'solid',
  set: 'hatch',
  overset: 'crosshatch',
  falseSet: 'dotted',
}

export function stateColor(p: Palette, state: StateKey): string {
  switch (state) {
    case 'binding':
      return p.amber
    case 'set':
      return p.teal
    case 'overset':
      return p.crimson
    case 'falseSet':
      return p.violet
    case 'free':
      return p.steel
  }
}
