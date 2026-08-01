import { defineConfig } from 'vitest/config'

// Worker count is roughly half the 12 detected cores, and two on a CI runner, which has far fewer
// (D-119). Vitest 4 replaced the `--poolOptions.forks.maxForks` CLI flag from VERIFICATION.md §1
// with top-level `maxWorkers`; it lives here rather than in the npm script. See DECISIONS D-003.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    maxWorkers: process.env.CI ? 2 : 6,
    /**
     * Vitest's default is 5 seconds, and for this suite that number measures the *machine*.
     *
     * A dozen tests run the solver across 50 seeds on the heaviest locks in the game — 250
     * attempts including blind sweeps of an eleven-disc detainer. Alone they finish in one to
     * four seconds; with six workers sharing six cores they cross five, and which ones cross it
     * shifts run to run. Patching them one at a time as they surfaced was chasing the symptom.
     *
     * 30s still catches what a timeout is *for*: a genuine hang, an infinite loop, a solver that
     * never converges. Nothing legitimate in this suite comes close to it.
     *
     * **60s now, and the reason is worth recording rather than just doubling the number.** The
     * heaviest test here is `a lock deeper than the pick can reach cannot be opened at all`, which
     * has to run its full ten simulated seconds *every time* — it asserts a lock does **not** open,
     * so there is no early exit by construction. It takes 3.9s alone and it tripped 30s in a full
     * run: an eight-fold stretch, which is what six workers on six cores does to a CPU-bound test
     * once the suite grows. The suite went from 651 tests to 728 in one session.
     *
     * Raising it is not weakening it. A timeout that fires on contention tells you the machine was
     * busy, which you knew; the failure it exists to catch is unbounded, and 60s catches that
     * exactly as well as 30 did. See DECISIONS D-127.
     */
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/main.ts', 'src/devhook.ts'],
      reporter: ['text', 'text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      // VERIFICATION.md §2. Set from Phase 1 on purpose: a threshold added at the end is a
      // threshold you'll be tempted to lower.
      thresholds: {
        'src/sim/**': { branches: 90, functions: 95, lines: 95 },
        'src/game/**': { branches: 70, lines: 80 },
      },
    },
  },
})
