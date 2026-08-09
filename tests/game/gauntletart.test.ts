/** The generated plates required by docs/IMAGE-PROMPTS.md stay a complete, portable set. */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = path.resolve(__dirname, '..', '..', 'src', 'assets', 'gauntlet-art')
// The merged set (D-184/D-185): menu-backdrop retired with the menu's plate ("background
// should only be in the game section"), and the raw-name sprite dupes gave way to the
// alpha-masked sprite-* plates the tint cache draws through. The hound's plates left with
// the hound (D-189). The 21 room-floor plates of D-189 are OPTIONAL — the map falls back
// to the chamber floor until each drop lands — so they are not required here; any that DO
// ship still ride the size gate below.
const EXPECTED = [
  'briefing-labyrinth-prison',
  'caught',
  'escaped',
  'warden',
  'sentry',
  'listener',
  'hunter',
  'the-gate',
  'corridor-floor',
  'chamber-floor',
  'wall-block',
  'water-drain-floor',
  'sprite-warden',
  'sprite-sentry',
  'sprite-listener',
  'sprite-hunter',
  'sprite-picker',
]

describe('the dungeon art set', () => {
  it('ships every plate named by the image prompt pack', () => {
    const files = readdirSync(DIR)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.replace(/\.png$/, ''))
      .filter((file) => EXPECTED.includes(file))
      .sort()
    expect(files).toEqual([...EXPECTED].sort())
  })

  it('keeps every plate below the inline file-origin limit', () => {
    const shipped = readdirSync(DIR).filter((file) => file.endsWith('.png'))
    for (const file of shipped) {
      const bytes = readFileSync(path.join(DIR, file)).length
      expect(bytes, `${file} is ${bytes} bytes`).toBeLessThanOrEqual(300000)
    }
  })
})
