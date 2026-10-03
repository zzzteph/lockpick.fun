/**
 * The version scheme — DECISIONS D-126.
 *
 * `1.0.0 -> 1.0.1 -> … -> 1.0.9 -> 1.1.0`, each field a single digit carrying into the one above
 * it. Small enough to hold in your head and exactly the sort of arithmetic that is wrong in the
 * one place nobody checks: the carry.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { nextVersion } from '../../dev/bump'

const ROOT = path.resolve(__dirname, '../..')

describe('bumping', () => {
  it('counts up within a field', () => {
    expect(nextVersion('1.0.0')).toBe('1.0.1')
    expect(nextVersion('1.0.5')).toBe('1.0.6')
    expect(nextVersion('2.3.4')).toBe('2.3.5')
  })

  it('carries at nine, which is the whole of the scheme', () => {
    expect(nextVersion('1.0.9')).toBe('1.1.0')
    expect(nextVersion('1.9.9')).toBe('2.0.0')
    expect(nextVersion('9.9.9')).toBe('10.0.0')
  })

  it('never goes backwards or sideways', () => {
    // Walk a hundred bumps and check each is strictly greater than the last, compared the way a
    // human reads it rather than as a string — `1.10.0` sorts before `1.9.0` alphabetically.
    const rank = (v: string): number => {
      const [a, b, c] = v.split('.').map(Number)
      return (a ?? 0) * 1e6 + (b ?? 0) * 1e3 + (c ?? 0)
    }
    let v = '1.0.0'
    for (let i = 0; i < 100; i += 1) {
      const next = nextVersion(v)
      expect(rank(next), `${v} -> ${next}`).toBeGreaterThan(rank(v))
      v = next
    }
    // A hundred bumps is exactly one major: ten patches to a minor, ten minors to a major.
    expect(v).toBe('2.0.0')
  })

  it('forces a carry when asked', () => {
    expect(nextVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(nextVersion('1.9.3', 'minor')).toBe('2.0.0')
    expect(nextVersion('1.2.3', 'major')).toBe('2.0.0')
  })

  it('refuses anything that is not a three-part version', () => {
    for (const bad of ['1.0', '1.0.0.0', 'v1.0.0', '', 'one.two.three', '1.-1.0']) {
      expect(() => nextVersion(bad), bad).toThrow()
    }
  })

  it('is the version the package actually carries', () => {
    // The scheme is only worth having if `package.json` is playing along: a two-part or
    // prerelease version would make every bump throw at exactly the wrong moment.
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      version: string
    }
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(() => nextVersion(pkg.version)).not.toThrow()
  })
})
