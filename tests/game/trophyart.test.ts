/**
 * Every achievement has its drawing, and every drawing has its achievement — D-159.
 *
 * The art is wired by filename: `src/assets/trophies/<id>.png` is found by `import.meta.glob`
 * and matched to the catalogue at runtime. A misnamed file fails silently there — the plate
 * simply draws no icon — which is this project's own recorded failure mode (present, tested,
 * and does nothing). So the two lists are held equal here, on the filesystem, where a typo is
 * a red test instead of a quietly bare plate.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS } from '../../src/game/achievements'

const DIR = path.resolve(__dirname, '..', '..', 'src', 'assets', 'trophies')

describe('the trophy art set', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.png'))
  const ids = ACHIEVEMENTS.map((a) => a.id)

  it('has exactly one drawing per achievement, named by its id', () => {
    expect(files.map((f) => f.replace(/\.png$/, '')).sort()).toEqual([...ids].sort())
  })

  it('ships nothing oversized — every icon must clear the inline limit', () => {
    // `assetsInlineLimit` is 20480 so the whole set rides into the bundle as data URIs, which
    // is what keeps `dist/` working from `file://` (see vite.config.ts). An icon regenerated
    // at a heavier size would silently become a separate asset and break exactly that.
    for (const f of files) {
      const bytes = readFileSync(path.join(DIR, f)).length
      expect(bytes, `${f} is ${bytes} bytes`).toBeLessThanOrEqual(20480)
    }
  })
})
