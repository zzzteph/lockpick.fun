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
/**
 * Two workers on CI, six here.
 *
 * A GitHub-hosted runner has a fraction of this machine's cores, and several tests in this suite
 * are latency-sensitive by nature: they press a key, wait for a round trip, and read what moved.
 * `liftTo` compensates for its own sampling latency (D-109) and the resistance peaks are read from
 * the simulation rather than sampled (D-114), but oversubscribing a small runner six ways would
 * put every one of those margins back under pressure for no gain — the suite is IO-bound on
 * browser round trips, not CPU-bound.
 */
const WORKERS = process.env.CI ? 2 : 6

export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['**/perf.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: WORKERS,
  fullyParallel: true,
  forbidOnly: true,
  /**
   * One retry on CI, none here.
   *
   * Deliberately *one*, and deliberately not zero. Zero means a runner hiccup blocks a deploy;
   * three means a genuinely flaky test hides for months. One retry with `flaky` reported in the
   * summary keeps the failure visible — a test that needs its retry is a test to go and look at,
   * and this build has already found three that did.
   */
  retries: process.env.CI ? 1 : 0,
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
