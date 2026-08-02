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
