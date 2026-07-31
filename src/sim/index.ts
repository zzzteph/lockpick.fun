/**
 * `src/sim` — the pure, headless, deterministic lock model.
 *
 * Nothing in here touches the DOM, the canvas, audio, the wall clock, or `Math.random`;
 * `eslint.config.js` enforces that and `tests/lint/sim-purity.test.ts` proves the rule fires.
 * Input in, timestep in, new state out.
 */

export * from './classify'
export * from './constants'
export * from './lock'
export * from './math'
export * from './profiles'
export * from './rng'
export * from './solver'
export * from './step'
export * from './tape'
export * from './tools'
export * from './types'
