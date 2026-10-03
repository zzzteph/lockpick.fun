/**
 * Draw the PWA icons — `node dev/pwa-icons.ts` — DECISIONS D-162.
 *
 * The game ships no logo: every mechanism is drawn in code, and the store-facing art (D-159)
 * lives beside the Steam listing. An installable app needs an icon file, so this draws one the
 * way the game would draw it — the plug face-on, brass in a steel shell on drafting paper, the
 * keyway down the middle, shear-line ticks where plug meets shell — and writes the PNG sizes the
 * platforms ask for into `public/icons/`. Rendered through the same headless Chromium the test
 * suite uses, so the shipped icons are reproducible from this file alone.
 *
 * Sizes: 192 and 512 (manifest), a 512 "maskable" with the drawing pulled into the safe zone so
 * Android launchers can crop it into any shape, and 180 for `apple-touch-icon`.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public', 'icons')

/** The drafting palette, copied by value: an icon generator must not import the render layer. */
const PAPER = '#F4F1EA'
const INK = '#1C1B19'
const RULE = '#C9C3B6'
const PLUG_BRASS = '#E9DFC0'
const SHELL_BRASS = '#DBD0AA'

/**
 * Draw at `size`, with the lock scaled by `fit` about the centre — 1 for the plain icons,
 * 0.78 for the maskable one so the whole drawing survives a circular crop.
 */
function drawScript(size: number, fit: number): string {
  return `
    const c = document.getElementById('c')
    c.width = ${size}
    c.height = ${size}
    const ctx = c.getContext('2d')
    const S = ${size}

    // Drafting paper, with the grid the game rules every page with.
    ctx.fillStyle = '${PAPER}'
    ctx.fillRect(0, 0, S, S)
    ctx.strokeStyle = '${RULE}'
    ctx.lineWidth = Math.max(1, S / 512)
    const pitch = S / 8
    for (let i = 1; i < 8; i += 1) {
      ctx.beginPath(); ctx.moveTo(i * pitch, 0); ctx.lineTo(i * pitch, S); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * pitch); ctx.lineTo(S, i * pitch); ctx.stroke()
    }

    ctx.save()
    ctx.translate(S / 2, S / 2)
    ctx.scale(${fit}, ${fit})
    const u = S / 512 // one 512-master unit

    // The shell: a brass ring in section, hatched the way the cutaway hatches fixed metal.
    ctx.beginPath()
    ctx.arc(0, 0, 236 * u, 0, Math.PI * 2)
    ctx.arc(0, 0, 168 * u, 0, Math.PI * 2, true)
    ctx.fillStyle = '${SHELL_BRASS}'
    ctx.fill()
    ctx.save()
    ctx.clip()
    ctx.strokeStyle = 'rgba(28,27,25,0.18)'
    ctx.lineWidth = 3 * u
    for (let x = -520; x <= 520; x += 26) {
      ctx.beginPath()
      ctx.moveTo(x * u - 260 * u, 260 * u)
      ctx.lineTo(x * u + 260 * u, -260 * u)
      ctx.stroke()
    }
    ctx.restore()
    ctx.lineWidth = 12 * u
    ctx.strokeStyle = '${INK}'
    ctx.beginPath(); ctx.arc(0, 0, 236 * u, 0, Math.PI * 2); ctx.stroke()

    // The plug: the part that turns, brass, with its own hairline.
    ctx.beginPath(); ctx.arc(0, 0, 168 * u, 0, Math.PI * 2)
    ctx.fillStyle = '${PLUG_BRASS}'
    ctx.fill()
    ctx.lineWidth = 10 * u
    ctx.stroke()

    // Shear-line ticks: the gap the whole game is about, marked where plug meets shell.
    ctx.lineWidth = 12 * u
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(side * 148 * u, 0)
      ctx.lineTo(side * 256 * u, 0)
      ctx.stroke()
    }

    // The keyway, drawn as the paracentric silhouette a pick has to travel: a spine with wards.
    ctx.fillStyle = '${INK}'
    ctx.beginPath()
    ctx.moveTo(-17 * u, -128 * u)
    ctx.lineTo(17 * u, -128 * u)
    ctx.lineTo(17 * u, -52 * u)
    ctx.lineTo(34 * u, -52 * u)
    ctx.lineTo(34 * u, -14 * u)
    ctx.lineTo(17 * u, -14 * u)
    ctx.lineTo(17 * u, 46 * u)
    ctx.lineTo(-34 * u, 46 * u)
    ctx.lineTo(-34 * u, 8 * u)
    ctx.lineTo(-17 * u, 8 * u)
    ctx.lineTo(-17 * u, -90 * u)
    ctx.closePath()
    ctx.fill()
    // The keyway's mouth flare at the bottom of the plug.
    ctx.beginPath()
    ctx.moveTo(-30 * u, 46 * u)
    ctx.lineTo(30 * u, 46 * u)
    ctx.lineTo(17 * u, 118 * u)
    ctx.lineTo(-17 * u, 118 * u)
    ctx.closePath()
    ctx.fill()

    ctx.restore()
  `
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ args: ['--disable-gpu'] })
  const page = await browser.newPage()
  await page.setContent('<canvas id="c"></canvas><style>body{margin:0}canvas{display:block}</style>')

  const targets: { file: string; size: number; fit: number }[] = [
    { file: 'icon-192.png', size: 192, fit: 1 },
    { file: 'icon-512.png', size: 512, fit: 1 },
    { file: 'icon-maskable-512.png', size: 512, fit: 0.78 },
    { file: 'apple-touch-icon.png', size: 180, fit: 1 },
  ]
  for (const t of targets) {
    await page.evaluate(drawScript(t.size, t.fit))
    const el = page.locator('#c')
    const buffer = await el.screenshot({ type: 'png' })
    writeFileSync(path.join(OUT, t.file), buffer)
    process.stdout.write(`${t.file} — ${buffer.length} bytes\n`)
  }
  await browser.close()
}

void main()
