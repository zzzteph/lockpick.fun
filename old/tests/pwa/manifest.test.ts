/**
 * The installable-app layer, held together — DECISIONS D-162.
 *
 * A manifest is four files that must agree: the JSON, the icons it points at, the HTML that
 * links it, and the colours the browser chrome is told twice. Nothing here runs a browser —
 * that is `e2e/pwa.spec.ts` — this asserts the *files* cannot drift apart, which is the way
 * this class of asset actually breaks: an icon renamed, a colour changed in one place, a
 * dimension that stopped matching its declaration.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '..', '..')
const PUBLIC = path.join(ROOT, 'public')

interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose?: string
}

interface Manifest {
  name: string
  short_name: string
  display: string
  orientation: string
  start_url: string
  scope: string
  background_color: string
  theme_color: string
  icons: ManifestIcon[]
}

const manifest = JSON.parse(
  readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8'),
) as Manifest
const indexHtml = readFileSync(path.join(ROOT, 'index.html'), 'utf8')

describe('the web app manifest — D-162', () => {
  it('asks for the launch the game is built for: fullscreen, landscape', () => {
    expect(manifest.display).toBe('fullscreen')
    expect(manifest.orientation).toBe('landscape')
  })

  it('keeps every URL relative, because dist/ must run from a subdirectory too', () => {
    expect(manifest.start_url.startsWith('./')).toBe(true)
    expect(manifest.scope.startsWith('./')).toBe(true)
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('./'), `${icon.src} should be relative`).toBe(true)
    }
  })

  it('declares icons that exist and are the size they claim to be', () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3)
    for (const icon of manifest.icons) {
      const file = path.join(PUBLIC, icon.src)
      const png = PNG.sync.read(readFileSync(file))
      const [w, h] = icon.sizes.split('x').map(Number)
      expect(png.width, `${icon.src} width`).toBe(w)
      expect(png.height, `${icon.src} height`).toBe(h)
    }
  })

  it('carries a maskable icon, so Android launchers can crop it into any shape', () => {
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
  })

  it('agrees with index.html about the chrome colour', () => {
    const meta = /<meta name="theme-color" content="(#[0-9a-fA-F]{6})"/.exec(indexHtml)
    expect(meta?.[1]).toBeDefined()
    expect(manifest.theme_color.toLowerCase()).toBe(meta?.[1]?.toLowerCase())
    expect(manifest.background_color.toLowerCase()).toBe(meta?.[1]?.toLowerCase())
  })
})

describe('index.html wiring — D-162', () => {
  it('links the manifest and both icon dialects, and the files are real', () => {
    for (const href of [
      /<link rel="manifest" href="(\.\/[^"]+)"/,
      /<link rel="icon"[^>]*href="(\.\/[^"]+)"/,
      /<link rel="apple-touch-icon" href="(\.\/[^"]+)"/,
    ]) {
      const m = href.exec(indexHtml)
      expect(m?.[1], String(href)).toBeDefined()
      if (m?.[1]) expect(() => readFileSync(path.join(ROOT, 'public', m[1]!))).not.toThrow()
    }
  })

  it('sizes the apple-touch-icon at the 180 iOS reads', () => {
    const png = PNG.sync.read(readFileSync(path.join(PUBLIC, 'icons', 'apple-touch-icon.png')))
    expect(png.width).toBe(180)
    expect(png.height).toBe(180)
  })
})
