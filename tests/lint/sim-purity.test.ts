/**
 * Proof that the `src/sim/` purity rule actually fires (PHASES.md Phase 0, SIMULATION.md
 * "Architectural law").
 *
 * A lint rule nobody has seen fail is a lint rule that might not be wired up. This test
 * writes a deliberately-impure file into `src/sim/`, runs the *real* project ESLint config
 * against it, asserts each guard reports, and deletes the file again.
 */

import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ESLint } from 'eslint'
import { afterAll, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const FIXTURE = path.join(ROOT, 'src', 'sim', '__purity_fixture__.ts')

const IMPURE = `
// A deliberately impure module. Created and deleted by tests/lint/sim-purity.test.ts.
import { DRAFTING } from '../render/palette'
import { VOICE_CAP } from '../audio/engine'

export function impure(): number {
  const w = window.innerWidth
  const t = document.title.length
  const r = Math.random()
  const now = Date.now()
  const stamp = new Date().getTime()
  const p = performance.now()
  const c: HTMLCanvasElement = document.createElement('canvas')
  const audio = new AudioContext()
  console.log(DRAFTING.ink, c.width, VOICE_CAP, audio.sampleRate)
  return w + t + r + now + stamp + p
}
`

const PURE = `
// A pure module — the control case for tests/lint/sim-purity.test.ts.
export function pure(seed: number): number {
  let x = seed | 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return x >>> 0
}
`

function cleanup(): void {
  if (existsSync(FIXTURE)) rmSync(FIXTURE)
}

afterAll(cleanup)

async function lintFixture(source: string): Promise<ESLint.LintResult> {
  writeFileSync(FIXTURE, source, 'utf8')
  try {
    const eslint = new ESLint({ cwd: ROOT })
    const results = await eslint.lintFiles([FIXTURE])
    const result = results[0]
    if (!result) throw new Error('ESLint returned no result for the purity fixture')
    return result
  } finally {
    cleanup()
  }
}

it('reports every purity violation in src/sim', async () => {
  const result = await lintFixture(IMPURE)
  const byRule = new Map<string, number>()
  for (const m of result.messages) {
    if (m.ruleId) byRule.set(m.ruleId, (byRule.get(m.ruleId) ?? 0) + 1)
  }

  // The four guards that make up the architectural law.
  expect(byRule.get('no-restricted-globals'), 'DOM/global access must be reported').toBeGreaterThan(
    0,
  )
  expect(byRule.get('no-restricted-properties'), 'Math.random must be reported').toBeGreaterThan(0)
  expect(byRule.get('no-restricted-imports'), 'renderer imports must be reported').toBeGreaterThan(0)
  expect(byRule.get('no-restricted-syntax'), 'new Date() must be reported').toBeGreaterThan(0)

  const text = result.messages.map((m) => m.message).join('\n')
  for (const name of ['window', 'document', 'performance', 'console', 'AudioContext']) {
    expect(text, `expected a report mentioning "${name}"`).toContain(`no "${name}"`)
  }
  // No audio and no renderer may be reached from the simulation, ever.
  expect(text).toContain('**/audio/**')
  expect(text).toContain('**/render/**')
  expect(result.errorCount).toBeGreaterThanOrEqual(10)
}, 120_000)

it('passes a pure module with zero problems', async () => {
  const result = await lintFixture(PURE)
  expect(
    result.messages.map((m) => `${m.ruleId ?? '?'}: ${m.message}`),
    'a pure sim module must lint clean',
  ).toEqual([])
}, 120_000)
