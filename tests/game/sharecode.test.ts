/**
 * Share codes — DECISIONS D-093.
 *
 * Two properties matter and everything here is one of them: **every lock the editor can build
 * round-trips**, and **nothing else decodes to a lock**. The second is the one worth the checksum:
 * a corrupted code that silently decoded to a *different* valid lock would hand the player a
 * puzzle nobody sent them and no way to know.
 */

import { describe, expect, it } from 'vitest'
import { decodeLock, encodeLock, formatCode } from '../../src/game/sharecode'
import {
  EDITABLE_PINS,
  MAX_TOLERANCE,
  MIN_DEPTH,
  MIN_TOLERANCE,
  SPRING_CHOICES,
  draftToLockDef,
  maxDepthFor,
  newDraft,
} from '../../src/game/editor'
import { MAX_CHAMBERS, MIN_CHAMBERS, createSimState, makeConfig, validateLockDef } from '../../src/sim'

function ok(code: string) {
  const r = decodeLock(code)
  if (r.problem !== null) throw new Error(`expected a lock, got: ${r.problem}`)
  return r.def
}

describe('every lock the editor can build survives the trip', () => {
  it('keeps the bitting, the pins, the springs, the tolerance and the keyway', () => {
    const d = newDraft(5)
    d.keyway = 'tight'
    d.toleranceQuality = 0.75
    d.chambers.forEach((c, i) => {
      c.pin = EDITABLE_PINS[i % EDITABLE_PINS.length] ?? 'standard'
      c.spring = i % SPRING_CHOICES.length
      c.depth = Math.min(Number((2.4 + i * 0.1).toFixed(2)), maxDepthFor(c.pin))
    })
    const original = draftToLockDef(d, 0)
    const back = ok(encodeLock(original))

    expect(back.bitting).toEqual(original.bitting)
    expect(back.pins).toEqual(original.pins)
    expect(back.springs).toEqual(original.springs)
    expect(back.toleranceQuality).toBeCloseTo(original.toleranceQuality, 6)
    expect(back.keyway).toBe(original.keyway)
  })

  it('at every chamber count the game allows', () => {
    for (let n = MIN_CHAMBERS; n <= MAX_CHAMBERS; n += 1) {
      const def = draftToLockDef(newDraft(n), 0)
      const back = ok(encodeLock(def))
      expect(back.bitting, `${n} chambers`).toEqual(def.bitting)
    }
  })

  it.each(EDITABLE_PINS)('with %s in every chamber', (pin) => {
    const d = newDraft(4)
    for (const c of d.chambers) {
      c.pin = pin
      c.depth = Math.min(c.depth, maxDepthFor(pin))
    }
    const def = draftToLockDef(d, 0)
    expect(ok(encodeLock(def)).pins).toEqual(def.pins)
  })

  it.each([0, 1, 2])('with spring %i in every chamber', (spring) => {
    const d = newDraft(3)
    for (const c of d.chambers) c.spring = spring
    const def = draftToLockDef(d, 0)
    expect(ok(encodeLock(def)).springs).toEqual(def.springs)
  })

  it('at both ends of the tolerance range', () => {
    for (const q of [MIN_TOLERANCE, MAX_TOLERANCE]) {
      const d = newDraft(3)
      d.toleranceQuality = q
      const back = ok(encodeLock(draftToLockDef(d, 0)))
      expect(back.toleranceQuality, `tolerance ${q}`).toBeCloseTo(q, 6)
    }
  })

  it('at the shallowest and deepest cuts', () => {
    for (const depth of [MIN_DEPTH, maxDepthFor('standard')]) {
      const d = newDraft(2)
      for (const c of d.chambers) c.depth = Number(depth.toFixed(1))
      const back = ok(encodeLock(draftToLockDef(d, 0)))
      expect(back.bitting[0], `depth ${depth}`).toBeCloseTo(Number(depth.toFixed(1)), 6)
    }
  })

  it('and what comes back is a lock the simulation accepts', () => {
    const def = ok(encodeLock(draftToLockDef(newDraft(6), 0)))
    expect(() => validateLockDef(def)).not.toThrow()
    expect(createSimState(def, 42, makeConfig({})).chambers).toHaveLength(6)
  })
})

describe('the code itself', () => {
  it('is short enough to read out loud', () => {
    // Base64 JSON for a five-pin lock is about 350 characters. This is the whole point.
    expect(encodeLock(draftToLockDef(newDraft(5), 0)).length).toBeLessThanOrEqual(16)
  })

  it('contains no character that can be mistaken for another', () => {
    const code = encodeLock(draftToLockDef(newDraft(8), 0))
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/)
    expect(code).not.toMatch(/[ILOU]/)
  })

  it('decodes the same however it was typed or pasted', () => {
    const code = encodeLock(draftToLockDef(newDraft(4), 0))
    const expected = ok(code)
    for (const variant of [code.toLowerCase(), formatCode(code), `  ${code}  `]) {
      expect(ok(variant).bitting, variant).toEqual(expected.bitting)
    }
  })

  it('formats in fours, which is how a code gets read aloud', () => {
    expect(formatCode('ABCDEFGH')).toBe('ABCD-EFGH')
  })
})

describe('nothing else decodes to a lock', () => {
  const code = encodeLock(draftToLockDef(newDraft(5), 0))

  it('rejects an empty or stub code', () => {
    for (const bad of ['', ' ', 'A', 'ABC']) {
      expect(decodeLock(bad).problem, JSON.stringify(bad)).toBeTruthy()
    }
  })

  it('rejects a character the alphabet does not have', () => {
    expect(decodeLock(`${code}!`).problem).toMatch(/not a character/)
  })

  it('rejects a truncated code rather than decoding a shorter lock', () => {
    expect(decodeLock(code.slice(0, -1)).problem).toBeTruthy()
    expect(decodeLock(code.slice(0, -3)).problem).toBeTruthy()
  })

  it('catches a single mistyped character, everywhere in the code', () => {
    // The property the checksum exists for. A code that decodes to the *wrong* lock is worse than
    // one that fails, because the player has no way to notice.
    let caught = 0
    let total = 0
    for (let i = 0; i < code.length; i += 1) {
      for (const ch of '0123456789ABCDEFGHJKMNPQRSTVWXYZ') {
        if (ch === code[i]) continue
        total += 1
        const mutated = code.slice(0, i) + ch + code.slice(i + 1)
        const r = decodeLock(mutated)
        const changed = r.problem === null && JSON.stringify(r.def.bitting) !== JSON.stringify(ok(code).bitting)
        if (r.problem !== null || !changed) caught += 1
      }
    }
    // A one-character checksum cannot catch everything — 1 in 32 collides by construction — but it
    // has to catch the overwhelming majority, and this says how many.
    expect(caught / total).toBeGreaterThan(0.95)
  })

  it('rejects a code claiming a chamber count the game cannot build', () => {
    // Character 1 is the chamber count. Brute-force the checksum digit so the forgery gets *past*
    // the checksum and has to be caught by the range check — which is the thing being tested.
    const body = `${code[0]}Z${code.slice(2, -1)}`
    const problems = new Set<string>()
    for (const ch of '0123456789ABCDEFGHJKMNPQRSTVWXYZ') {
      const r = decodeLock(body + ch)
      if (r.problem !== null) problems.add(r.problem)
      expect(r.problem, 'a 31-chamber lock must never decode').not.toBeNull()
    }
    expect([...problems].some((m) => /chambers/.test(m))).toBe(true)
  })

  it('never throws, whatever it is handed', () => {
    for (const junk of ['💀', '{"lock":true}', 'A'.repeat(500), '----', '0000000']) {
      expect(() => decodeLock(junk)).not.toThrow()
    }
  })
})
