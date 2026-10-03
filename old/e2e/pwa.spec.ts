/**
 * The installable-app layer, served and built — DECISIONS D-162.
 *
 * `tests/pwa/manifest.test.ts` proves the files agree with each other; this proves the server
 * actually hands them out, that dev never registers the worker (it would cache what HMR is
 * rewriting), and — because `npm run verify` builds before this suite runs — that the build
 * emitted a `sw.js` precaching the hashed bundle it just wrote. That last file is the one no
 * unit test can check: only the build knows the hash.
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { bootGame } from './harness'

// The suite always runs from the repo root, which is what the harness's screenshot dir relies
// on too — `__dirname` does not exist in ES module scope and this file is one.
const ROOT = process.cwd()

test('the manifest and icons are served, and the page links them', async ({ page }) => {
  await bootGame(page)
  const links = await page.evaluate(() => ({
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null,
    apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? null,
  }))
  expect(links.manifest).toBe('./manifest.webmanifest')
  expect(links.apple).toBe('./icons/apple-touch-icon.png')

  const manifest = await page.evaluate(async () => {
    const res = await fetch('./manifest.webmanifest')
    return { ok: res.ok, body: (await res.json()) as { display: string; orientation: string; icons: { src: string }[] } }
  })
  expect(manifest.ok).toBe(true)
  expect(manifest.body.display).toBe('fullscreen')
  expect(manifest.body.orientation).toBe('landscape')
  for (const icon of manifest.body.icons) {
    const status = await page.evaluate(async (src) => (await fetch(src)).status, icon.src)
    expect(status, icon.src).toBe(200)
  }
})

test('dev never registers the service worker', async ({ page }) => {
  await bootGame(page)
  const registrations = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return []
    return (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope)
  })
  expect(registrations, 'a worker in dev would cache what HMR is rewriting').toEqual([])
})

test('the build wrote a worker that precaches the bundle it built', () => {
  // Runs against dist/ on disk: `npm run verify` builds before the browser suite. If this fails
  // standalone, run `npm run build` first — asserting a stale dist would prove nothing.
  const sw = readFileSync(path.join(ROOT, 'dist', 'sw.js'), 'utf8')
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    version: string
  }
  expect(sw).toContain(`shearline-v${pkg.version}`)
  expect(sw).toContain(`'./'`)
  expect(sw).toContain('./manifest.webmanifest')

  const assets = readdirSync(path.join(ROOT, 'dist', 'assets'))
  const main = assets.find((f) => f.startsWith('main-') && f.endsWith('.js'))
  expect(main, 'the built bundle should exist').toBeDefined()
  expect(sw, 'the worker must precache the hashed bundle').toContain(`./assets/${main}`)

  // And the manifest travelled into dist alongside it.
  const distManifest = JSON.parse(
    readFileSync(path.join(ROOT, 'dist', 'manifest.webmanifest'), 'utf8'),
  ) as { display: string }
  expect(distManifest.display).toBe('fullscreen')
})
