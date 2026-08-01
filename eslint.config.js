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
    /**
     * Type drawn on a screen that can go compact must go through the scaler — DECISIONS D-132.
     *
     * D-122 built `typeScaleFor` and wired it into `button()` and about a dozen other places. The
     * other 118 `font(TYPE.x)` calls in the game kept drawing at literal logical pixels, which is
     * six or seven CSS px on a phone — the single cause behind most of a long list of reports about
     * unreadable and overlapping text. That is exactly the failure mode this project keeps hitting:
     * a mechanism built, tested, and then not actually applied.
     *
     * A lint rule rather than a convention, because the next person to add a label will reach for
     * `font(TYPE.body)` — it is shorter, it reads better, and on the desktop it looks perfect.
     */
    files: ['src/render/**/*.ts', 'src/ui/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="font"] > MemberExpression.arguments[object.name="TYPE"]',
          message:
            'Scale it: font(typeFor(vp, TYPE.x)), or ts(TYPE.x) where the module has one. A literal TYPE size is ~7 CSS px on a phone (D-132).',
        },
        {
          /*
           * Scoped to `label` calls, because `size` means two different things.
           *
           * On `label` it is the tracking, and it has to match the face the font is set at — an
           * unscaled one there is a real bug. On `button` it is a *request*, which the widget then
           * puts through `typeFor` itself, so a raw `TYPE.x` is exactly right and a pre-scaled one
           * is the bug: it scales twice, and on the smallest phone in the matrix that turned a 17px
           * face into 81 and dragged the button's whole box up with it.
           */
          selector:
            'CallExpression[callee.name="label"] Property[key.name="size"] > MemberExpression.value[object.name="TYPE"]',
          message:
            "label()'s `size` sets the tracking and must match the face it is drawn in — scale it the same way as the font (D-132).",
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'e2e/**/*.ts', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
