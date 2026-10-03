import { describe, expect, it } from 'vitest'
import {
  cloneRng,
  createRng,
  nextFloat,
  nextInt,
  nextRange,
  nextSigned,
  nextUint32,
  shuffle,
} from '../../src/sim'

describe('seeded PRNG', () => {
  it('is reproducible for a seed', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    for (let i = 0; i < 1000; i += 1) {
      expect(nextUint32(a)).toBe(nextUint32(b))
    }
  })

  it('diverges between seeds', () => {
    const a = createRng(1)
    const b = createRng(2)
    let same = 0
    for (let i = 0; i < 1000; i += 1) {
      if (nextUint32(a) === nextUint32(b)) same += 1
    }
    expect(same).toBeLessThan(5)
  })

  it('never degenerates to an all-zero state', () => {
    const s = createRng(0)
    expect(s.a | s.b | s.c | s.d).not.toBe(0)
    const seen = new Set<number>()
    for (let i = 0; i < 200; i += 1) seen.add(nextUint32(s))
    expect(seen.size).toBeGreaterThan(150)
  })

  it('produces floats in [0, 1)', () => {
    const s = createRng(99)
    let min = 1
    let max = 0
    for (let i = 0; i < 20000; i += 1) {
      const v = nextFloat(s)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      if (v < min) min = v
      if (v > max) max = v
    }
    expect(min).toBeLessThan(0.01)
    expect(max).toBeGreaterThan(0.99)
  })

  it('is roughly uniform across 10 buckets', () => {
    const s = createRng(7)
    const buckets = new Array<number>(10).fill(0)
    const n = 100_000
    for (let i = 0; i < n; i += 1) {
      const b = Math.floor(nextFloat(s) * 10)
      buckets[b] = (buckets[b] ?? 0) + 1
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(n / 10 - n / 100)
      expect(count).toBeLessThan(n / 10 + n / 100)
    }
  })

  it('respects range, signed and int bounds', () => {
    const s = createRng(3)
    for (let i = 0; i < 5000; i += 1) {
      const r = nextRange(s, -3, 7)
      expect(r).toBeGreaterThanOrEqual(-3)
      expect(r).toBeLessThan(7)
      const g = nextSigned(s, 0.25)
      expect(Math.abs(g)).toBeLessThanOrEqual(0.25)
      const k = nextInt(s, 5)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThan(5)
    }
  })

  it('clones to an independent identical stream', () => {
    const a = createRng(555)
    nextUint32(a)
    const b = cloneRng(a)
    for (let i = 0; i < 100; i += 1) expect(nextUint32(a)).toBe(nextUint32(b))
  })

  it('shuffles deterministically and preserves membership', () => {
    const base = [0, 1, 2, 3, 4, 5, 6, 7]
    const x = shuffle(createRng(42), base.slice())
    const y = shuffle(createRng(42), base.slice())
    expect(x).toEqual(y)
    expect([...x].sort((a, b) => a - b)).toEqual(base)
    const z = shuffle(createRng(43), base.slice())
    expect(z).not.toEqual(x)
  })

  it('reaches every permutation position over many seeds', () => {
    // Guards against a shuffle that leaves the first element pinned.
    const firsts = new Set<number>()
    for (let seed = 0; seed < 200; seed += 1) {
      firsts.add(shuffle(createRng(seed), [0, 1, 2, 3, 4])[0] as number)
    }
    expect(firsts.size).toBe(5)
  })
})
