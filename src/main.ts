/**
 * SHEAR LINE — entry point.
 *
 * Finds the canvas and starts the app. Everything else lives in `src/app.ts`.
 */

import { startApp } from './app'

const canvas = document.getElementById('stage')
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('#stage canvas is missing from index.html')
}

startApp(canvas)
