import { defineConfig } from '@playwright/test'

/**
 * Worker count is roughly half the 12 detected cores (PLATFORM.md §7).
 *
 * `perf.spec.ts` is excluded and run on its own by `npm run perf`, which `verify` calls
 * separately. It measures how long a frame takes, and a frame time taken while five other
 * Chromium instances are competing for the same cores measures the machine rather than the
 * game: the same lock reports a 3.5ms p99 alone and blows the 16.67ms budget under load. The
 * number is only worth having if it is taken alone. See DECISIONS D-038.
 */
export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['**/perf.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 6,
  fullyParallel: true,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1600, height: 900 },
    launchOptions: { args: ['--disable-gpu'] },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    timeout: 120_000,
    reuseExistingServer: true,
  },
})
