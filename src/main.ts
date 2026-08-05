/**
 * SHEAR LINE — entry point.
 *
 * Finds the canvas and starts the app. Everything else lives in `src/app.ts`.
 */

import { startApp } from './app'
import { loadGameFont } from './render/fontface'

const canvas = document.getElementById('stage')
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('#stage canvas is missing from index.html')
}

/**
 * The typeface is loaded **before** the first frame — DECISIONS D-146.
 *
 * This game sizes its controls from `measureText`, and a measurement taken before the face arrives
 * measures the fallback. Starting first and letting the font swap in would rebuild every widget on
 * the frame it landed, which is the cross-machine layout bug this fixes, moved to boot.
 *
 * `loadGameFont` never rejects, so nothing here can stop the game starting.
 */
void loadGameFont().then(() => {
  startApp(canvas)
})

/**
 * The offline layer — DECISIONS D-162.
 *
 * `sw.js` is generated at build time (see `serviceWorker()` in vite.config.ts) with the built
 * asset names baked in, so an installed copy opens instantly and works with no connection.
 * Registered after the game has started because the game must never wait on it, and guarded
 * three ways: never in dev (the worker would cache what HMR is rewriting), never from `file://`
 * (double-clicked `dist/` has no origin to register under), and never fatally — a browser that
 * refuses gets the plain website, which is the whole game anyway.
 */
if (!import.meta.env.DEV && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Electron, a locked-down browser, or a transient failure: the game is already running.
  })
}
