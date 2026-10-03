import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * The frame-time measurement, alone on the machine.
 *
 * One worker, no parallelism, and only `perf.spec.ts`. Everything else about the run is the
 * main config — same browser, same viewport, same server — so the only difference is that
 * nothing else is competing for a core while the stopwatch is running. See DECISIONS D-038.
 */
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ['**/perf.spec.ts'],
  workers: 1,
  fullyParallel: false,
})
