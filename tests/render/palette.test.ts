import { describe, expect, it } from 'vitest'
import {
  BLUEPRINT,
  DRAFTING,
  STATE_PATTERN,
  THEMES,
  contrastRatio,
  ensureContrast,
  mix,
  parseHex,
  readableAccents,
  stateColor,
  type Palette,
} from '../../src/render/palette'

const THEME_LIST: Palette[] = [DRAFTING, BLUEPRINT]

describe('palette contrast — ART_DIRECTION.md §1', () => {
  for (const p of THEME_LIST) {
    describe(p.name, () => {
      it('every text role clears WCAG AA (4.5:1) on every background', () => {
        const backgrounds = { paper: p.paper, paperShade: p.paperShade }
        const textRoles = { ink: p.ink, inkLight: p.inkLight, ...readableAccents(p) }
        for (const [bgName, bg] of Object.entries(backgrounds)) {
          for (const [fgName, fg] of Object.entries(textRoles)) {
            const ratio = contrastRatio(fg, bg)
            expect(ratio, `${fgName} on ${bgName} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
              4.5,
            )
          }
        }
      })

      it('every component fill separates from the page', () => {
        // Pin bodies are outlined in ink (13:1 against paper), so the outline always
        // reads. What the fill itself must do is not vanish into the background.
        for (const key of ['steel', 'amber', 'teal', 'crimson', 'violet'] as const) {
          const ratio = contrastRatio(p[key], p.paper)
          expect(ratio, `${key} fill on paper = ${ratio.toFixed(2)}:1`).toBeGreaterThan(2.0)
        }
      })

      it('primary linework is unmistakable and the grid stays subordinate', () => {
        const inkRatio = contrastRatio(p.ink, p.paper)
        expect(inkRatio, `ink on paper = ${inkRatio.toFixed(2)}:1`).toBeGreaterThan(7)
        expect(contrastRatio(p.rule, p.paper)).toBeLessThan(contrastRatio(p.inkLight, p.paper))
        expect(contrastRatio(p.inkLight, p.paper)).toBeLessThan(inkRatio)
      })
    })
  }
})

describe('state encoding', () => {
  it('never encodes state in hue alone — every state has a distinct pattern', () => {
    const patterns = Object.values(STATE_PATTERN)
    expect(new Set(patterns).size).toBe(patterns.length)
  })

  it('maps every state to a colour', () => {
    for (const key of Object.keys(STATE_PATTERN) as (keyof typeof STATE_PATTERN)[]) {
      expect(stateColor(DRAFTING, key)).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})

describe('colour helpers', () => {
  it('parses hex', () => {
    expect(parseHex('#FF8000')).toEqual([255, 128, 0])
    expect(parseHex('000000')).toEqual([0, 0, 0])
  })

  it('contrast of white on black is 21:1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5)
  })

  it('contrast is symmetric', () => {
    expect(contrastRatio('#D98324', '#F4F1EA')).toBeCloseTo(contrastRatio('#F4F1EA', '#D98324'), 9)
  })

  it('mixes endpoints exactly', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toBe('#000000')
    expect(mix('#000000', '#FFFFFF', 1)).toBe('#ffffff')
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080')
  })

  it('ensureContrast is a no-op when the colour already passes', () => {
    expect(ensureContrast('#000000', '#FFFFFF', 4.5)).toBe('#000000')
  })

  it('ensureContrast lightens on a dark ground and darkens on a light one', () => {
    const onLight = ensureContrast('#D98324', '#F4F1EA', 4.5)
    const onDark = ensureContrast('#D98324', '#0E2233', 4.5)
    expect(contrastRatio(onLight, '#F4F1EA')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(onDark, '#0E2233')).toBeGreaterThanOrEqual(4.5)
  })

  it('exposes both themes by name', () => {
    expect(THEMES.drafting).toBe(DRAFTING)
    expect(THEMES.blueprint).toBe(BLUEPRINT)
  })
})

/**
 * Text drawn over the lock is read against **hatching**, not paper — DECISIONS D-148.
 *
 * The bodies in the cutaway are hatched: 45° rules at 6px spacing in `p.rule`. A word placed over
 * one of them has a line of that colour behind it, so `p.paper` is the wrong thing to have measured
 * it against. The anatomy key was drawn in `inkLight` and came out at 3.92:1 against the hatching,
 * where AA asks for 4.5 — found by the layout audit, and only at desktop-1920, because `sampleGround`
 * reads real pixels and below full scale the hatching antialiases into its background and the run
 * passes. The contrast is the same at every size; the *detection* was not.
 *
 * So it is a number here rather than a sampled pixel, and it holds for every theme.
 */
describe('anything drawn over a hatched body', () => {
  for (const [name, p] of Object.entries(THEMES)) {
    it(`full ink clears AA against the hatching — ${name}`, () => {
      expect(contrastRatio(p.ink, p.rule)).toBeGreaterThanOrEqual(4.5)
    })

    it(`and inkLight does not, which is why the anatomy key uses ink — ${name}`, () => {
      /*
       * Pinned deliberately. If `inkLight` is ever darkened enough to pass here this test fails, and
       * whoever does it gets to decide whether the key should go back to it — rather than the pair
       * quietly drifting until something over a body is unreadable again.
       */
      expect(contrastRatio(p.inkLight, p.rule)).toBeLessThan(4.5)
    })
  }
})
