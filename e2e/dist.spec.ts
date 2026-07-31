import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { analysePng, MIN_DISTINCT_COLOURS, MIN_STD_DEV, watchConsole } from './harness'

/**
 * `dist/` portability — `PHASES.md` Phase 14.
 *
 * Two ways of opening the built game, both of which have to work: a plain static server, and
 * a `file://` double-click. They fail differently and for different reasons, so both are here.
 *
 * These run against `dist/`, which `npm run build` writes — the Playwright web server serves
 * the *dev* tree, so nothing about the rest of the suite exercises the production bundle.
 */

const DIST = path.resolve(process.cwd(), 'dist')

function distReady(): boolean {
  return existsSync(path.join(DIST, 'index.html'))
}

/** A deliberately minimal static server: no SPA fallback, no rewriting, no cleverness. */
function serveDist(): Promise<{ url: string; close: () => Promise<void> }> {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  }
  const server: Server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
    const file = path.join(DIST, rel === '/' ? 'index.html' : rel)
    // Refuse anything outside dist — a static server that serves the whole disk proves nothing.
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/index.html`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
}

/** Wait for the game to have drawn something real, without the dev hook to ask. */
async function expectItRuns(page: Page, where: string): Promise<void> {
  await page.waitForSelector('canvas', { timeout: 20_000 })
  // The production bundle has no `__shearline`, so "is it running?" has to be answered the
  // way a player would answer it: is there a picture, and is it moving?
  await page.waitForFunction(
    () => {
      const c = document.querySelector('canvas')
      return c instanceof HTMLCanvasElement && c.width > 0 && c.height > 0
    },
    undefined,
    { timeout: 20_000 },
  )
  await page.waitForTimeout(700)
  const shot = await page.screenshot({ type: 'png' })
  const stats = analysePng(shot)
  expect(stats.distinctColours, `${where}: the canvas is blank`).toBeGreaterThanOrEqual(
    MIN_DISTINCT_COLOURS,
  )
  expect(stats.stdDev, `${where}: the canvas is flat`).toBeGreaterThan(MIN_STD_DEV)
}

test.describe('the production bundle', () => {
  /**
   * `npm run verify` builds before it reaches here, so this skip should never fire inside the gate.
   *
   * It used to be reachable, and that was the bug: `verify` ran typecheck, lint, unit tests, the
   * browser suite and perf — but not `build`. On a machine that had built at some point `dist/` was
   * lying around and these four ran; on a **fresh clone** they skipped, and the summary read
   * `4 skipped / 98 passed` in among a hundred green lines. So anybody cloning this repository and
   * running the gate the README calls the only thing that matters was told the bundle was portable
   * without a single byte of it ever being loaded.
   *
   * Found by materialising a clone of exactly the committed files and running the gate in it — the
   * same check that caught D-117's flake. The skip stays for anyone running `npm run e2e` alone,
   * which is a reasonable thing to do and is not a claim about the bundle. See DECISIONS D-118.
   */
  test.skip(!distReady(), 'run `npm run build` first — dist/ is not present')

  test('ships no development hook', () => {
    const assets = path.join(DIST, 'assets')
    const js = readdirSync(assets).filter((f) => f.endsWith('.js'))
    expect(js.length).toBeGreaterThan(0)
    for (const file of js) {
      const source = readFileSync(path.join(assets, file), 'utf8')
      // `import.meta.env.DEV` gates the hook's installation, so the whole object should be
      // gone from the bundle. The one permitted mention is the localStorage probe key.
      const hits = source.split('__shearline').length - 1
      const probes = source.split('__shearline_probe__').length - 1
      expect(hits - probes, `${file} still mentions the dev hook`).toBe(0)
    }
  })

  test('uses relative asset paths, so it can be served from any directory', () => {
    const html = readFileSync(path.join(DIST, 'index.html'), 'utf8')
    const srcs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? '')
    expect(srcs.length).toBeGreaterThan(0)
    for (const src of srcs) {
      expect(src.startsWith('/'), `absolute path "${src}" breaks a subdirectory deploy`).toBe(false)
    }
  })

  test('runs from a plain static server', async ({ page }) => {
    const watcher = watchConsole(page)
    const server = await serveDist()
    try {
      await page.goto(server.url)
      await expectItRuns(page, 'static server')
    } finally {
      await server.close()
    }
    watcher.assertClean()
  })

  test('runs from file://, with no server at all', async ({ page }) => {
    const watcher = watchConsole(page)
    const url = pathToFileURL(path.join(DIST, 'index.html')).href
    await page.goto(url)
    await expectItRuns(page, 'file://')
    watcher.assertClean()
  })
})
