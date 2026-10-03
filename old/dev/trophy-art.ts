/**
 * Produce the shipping trophy art from the 1024px masters — D-159.
 *
 * The masters live in `shear-line/steam/achievement-icons/` (machine-local, gitignored — they
 * also feed the Steam icon set). This script box-downscales each to 256px and writes it to
 * `src/assets/trophies/<achievement-id>.png`, which IS tracked: a fresh clone carries the art
 * the game ships. Run it again whenever a master changes:
 *
 *     node dev/trophy-art.ts
 *
 * 256 is enough for every place the game draws one (the largest is ~130 logical px on a trophy
 * plate) and keeps the whole set near 350 kB. Files starting with `_` are contact sheets and
 * other non-icons.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', 'shear-line', 'steam', 'achievement-icons')
const OUT = path.resolve(HERE, '..', 'src', 'assets', 'trophies')
const SIZE = 256

mkdirSync(OUT, { recursive: true })
const files = readdirSync(SRC).filter((f) => f.endsWith('.png') && !f.startsWith('_'))
if (files.length === 0) throw new Error(`no masters found in ${SRC}`)

for (const f of files) {
  const src = PNG.sync.read(readFileSync(path.join(SRC, f)))
  const out = new PNG({ width: SIZE, height: SIZE })
  const k = src.width / SIZE
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = Math.floor(y * k); sy < (y + 1) * k; sy += 1) {
        for (let sx = Math.floor(x * k); sx < (x + 1) * k; sx += 1) {
          const i = (sy * src.width + sx) * 4
          r += src.data[i] ?? 0
          g += src.data[i + 1] ?? 0
          b += src.data[i + 2] ?? 0
          n += 1
        }
      }
      const o = (y * SIZE + x) * 4
      out.data[o] = Math.round(r / n)
      out.data[o + 1] = Math.round(g / n)
      out.data[o + 2] = Math.round(b / n)
      out.data[o + 3] = 255
    }
  }
  writeFileSync(path.join(OUT, f), PNG.sync.write(out))
}
console.log(`${files.length} trophy icons written to ${OUT} at ${SIZE}px`)
