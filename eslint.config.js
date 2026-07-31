import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * The purity law for `src/sim/` (SIMULATION.md, "Architectural law").
 *
 * The simulation is a pure, deterministic, headless state machine. It may not touch the
 * DOM, the canvas, audio, timers, wall-clock time, or unseeded randomness. This block is
 * the enforcement mechanism, and `tests/lint/sim-purity.test.ts` proves it actually fires.
 *
 * Exported so the test can assert the rule set has not been quietly hollowed out.
 */
export const SIM_FORBIDDEN_GLOBALS = [
  'window',
  'document',
  'canvas',
  'navigator',
  'self',
  'top',
  'parent',
  'location',
  'localStorage',
  'sessionStorage',
  'performance',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'setInterval',
  'fetch',
  'XMLHttpRequest',
  'Image',
  'AudioContext',
  'OfflineAudioContext',
  'webkitAudioContext',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D',
  'OffscreenCanvas',
  'alert',
  'console',
]

export const SIM_FORBIDDEN_IMPORT_PATTERNS = [
  '**/render/**',
  '**/audio/**',
  '**/ui/**',
  '**/game/**',
  'vite',
  'vitest',
]

const simPurityRules = {
  'no-restricted-globals': [
    'error',
    ...SIM_FORBIDDEN_GLOBALS.map((name) => ({
      name,
      message: `src/sim must stay pure — no "${name}". See SIMULATION.md "Architectural law".`,
    })),
  ],
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message: 'src/sim must be deterministic — use the seeded PRNG in src/sim/rng.ts.',
    },
    {
      object: 'Date',
      property: 'now',
      message: 'src/sim must be deterministic — no wall-clock time.',
    },
  ],
  'no-restricted-imports': [
    'error',
    {
      patterns: SIM_FORBIDDEN_IMPORT_PATTERNS.map((group) => ({
        group: [group],
        message: `src/sim must not import "${group}". The sim is headless and standalone.`,
      })),
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: 'NewExpression[callee.name="Date"]',
      message: 'src/sim must be deterministic — no wall-clock time.',
    },
  ],
}

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'screenshots/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2023 },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['src/sim/**/*.ts'],
    rules: simPurityRules,
  },
  {
    files: ['tests/**/*.ts', 'e2e/**/*.ts', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
