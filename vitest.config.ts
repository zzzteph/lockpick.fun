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
     */
    testTimeout: 30_000,
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
