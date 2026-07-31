/**
 * Share codes — a lock you built, as a string you can paste to somebody.
 *
 * An editor whose output can only ever exist in the save that made it is a toy. This is the one
 * thing that turns it into a feature: a `LockDef` compressed to a short, typo-resistant, all-caps
 * string that anyone can paste back in and pick.
 *
 * **Why not base64 JSON.** A five-chamber lock as JSON is about 260 bytes, or 350 characters of
 * base64 — too long to read out, too long to paste reliably, and full of case-sensitive characters
 * that get mangled by chat clients that helpfully capitalise the first letter. The field-packed
 * form below is 2 characters per chamber plus a 6-character header, so a five-pin lock is 16
 * characters. It also cannot express a malformed lock: every field is range-checked on the way in
 * and clamped on the way out, and `validateLockDef` still has the final say.
 *
 * **The alphabet is Crockford base32**, minus the letters that get misread: no I, L, O or U. So a
 * code cannot contain a character that looks like another one, and lower case decodes the same as
 * upper. See DECISIONS D-093.
 */

import { MAX_CHAMBERS, MIN_CHAMBERS, PROFILES, type LockDef } from '../sim'
import { CUSTOM_ID_BASE, EDITABLE_PINS, SPRING_CHOICES, slugFor } from './editor'

/** Crockford base32: no I, L, O or U, so no character can be mistaken for another. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const VERSION = 1

function enc(value: number): string {
  const v = Math.max(0, Math.min(31, Math.round(value)))
  return ALPHABET[v] ?? '0'
}

function dec(ch: string): number {
  // Crockford's own substitutions, so a hand-typed I or O still decodes.
  const c = ch.toUpperCase().replace(/I|L/g, '1').replace(/O/g, '0').replace(/U/g, 'V')
  const at = ALPHABET.indexOf(c)
  return at < 0 ? -1 : at
}

/**
 * Depth, in units of 0.1mm above 1.0mm.
 *
 * The editor's own step is 0.05mm and its range is 1.0–4.0, which is 61 values and does not fit in
 * one base32 digit. Halving the resolution to 0.1mm gives 31 values, fits exactly, and costs
 * nothing anybody can feel: 0.05mm of bitting is a twentieth of a capture window.
 */
function encodeDepth(mm: number): string {
  return enc(Math.round((mm - 1) * 10))
}

function decodeDepth(ch: string): number {
  const v = dec(ch)
  return v < 0 ? 3 : Number((1 + v / 10).toFixed(2))
}

/** Tolerance, in units of 0.05 above 0.40 — covers the editor's 0.45–1.40 range in 20 steps. */
function encodeTolerance(q: number): string {
  return enc(Math.round((q - 0.4) / 0.05))
}

function decodeTolerance(ch: string): number {
  const v = dec(ch)
  return v < 0 ? 1 : Number((0.4 + v * 0.05).toFixed(2))
}

/**
 * Pack a lock into a share code.
 *
 * Layout, one base32 character each unless stated:
 *
 * | | field |
 * |---|---|
 * | 0 | format version |
 * | 1 | chamber count |
 * | 2 | tolerance |
 * | 3 | keyway (0 standard, 1 tight) |
 * | 4.. | two per chamber: depth, then `pin * 4 + spring` |
 * | last | checksum over everything before it |
 *
 * The checksum is what makes a truncated or mistyped code *fail* rather than silently decode to a
 * different lock — which is the failure mode that would actually hurt, because a wrong lock still
 * picks and the player would never know they were not playing what they were sent.
 */
export function encodeLock(def: LockDef): string {
  const body =
    enc(VERSION) +
    enc(def.bitting.length) +
    encodeTolerance(def.toleranceQuality) +
    enc(def.keyway === 'tight' ? 1 : 0) +
    def.bitting
      .map((depth, i) => {
        const pin = Math.max(0, EDITABLE_PINS.indexOf(def.pins[i] ?? 'standard'))
        const spring = nearestSpringIndex(def.springs?.[i] ?? 1)
        return encodeDepth(depth) + enc(pin * 4 + spring)
      })
      .join('')
  return body + checksum(body)
}

function nearestSpringIndex(value: number): number {
  let best = 1
  let gap = Infinity
  SPRING_CHOICES.forEach((choice, i) => {
    const d = Math.abs(choice.value - value)
    if (d < gap) {
      gap = d
      best = i
    }
  })
  return best
}

function checksum(body: string): string {
  let h = 7
  for (const ch of body) h = (h * 31 + Math.max(0, dec(ch))) % 32
  return enc(h)
}

export interface DecodedLock {
  readonly def: LockDef
  readonly problem: null
}

export interface BadCode {
  readonly def: null
  readonly problem: string
}

/**
 * Read a share code back into a lock.
 *
 * Never throws and never returns a half-built lock: either a `LockDef` the simulation will accept,
 * or a sentence saying why not. The caller is a paste box, and a paste box gets given rubbish.
 */
export function decodeLock(code: string, index = 0): DecodedLock | BadCode {
  const raw = code.trim().replace(/[\s-]/g, '').toUpperCase()
  if (raw.length < 7) return { def: null, problem: 'that code is too short to be a lock' }
  for (const ch of raw) {
    if (dec(ch) < 0) return { def: null, problem: `"${ch}" is not a character a code can contain` }
  }
  const body = raw.slice(0, -1)
  if (checksum(body) !== raw.slice(-1)) {
    return { def: null, problem: 'that code did not check out — a character is wrong or missing' }
  }
  if (dec(body[0] ?? '') !== VERSION) {
    return { def: null, problem: 'that code was made by a different version of the game' }
  }

  const chambers = dec(body[1] ?? '')
  if (chambers < MIN_CHAMBERS || chambers > MAX_CHAMBERS) {
    return { def: null, problem: `${chambers} chambers is not a lock this game can build` }
  }
  if (body.length !== 4 + chambers * 2) {
    return { def: null, problem: 'that code is the wrong length for the lock it describes' }
  }

  const bitting: number[] = []
  const pins: LockDef['pins'][number][] = []
  const springs: number[] = []
  for (let i = 0; i < chambers; i += 1) {
    const at = 4 + i * 2
    bitting.push(decodeDepth(body[at] ?? '0'))
    const packed = dec(body[at + 1] ?? '0')
    const pin = EDITABLE_PINS[Math.floor(packed / 4)]
    if (!pin || !(pin in PROFILES)) {
      return { def: null, problem: `chamber ${i + 1} names a pin this game does not have` }
    }
    pins.push(pin)
    springs.push(SPRING_CHOICES[packed % 4]?.value ?? 1)
  }

  const id = CUSTOM_ID_BASE + index
  const name = `Shared Lock ${raw.slice(0, 4)}`
  return {
    problem: null,
    def: {
      id,
      slug: slugFor(name, id),
      name,
      tier: 1,
      family: 'pin-tumbler',
      bitting,
      pins,
      springs,
      toleranceQuality: decodeTolerance(body[2] ?? '0'),
      keyway: dec(body[3] ?? '0') === 1 ? 'tight' : 'standard',
      par: Math.max(20, chambers * 18),
      note: 'Sent to you by somebody else.',
    },
  }
}

/** Grouped in fours, which is how anybody reads a code aloud without losing their place. */
export function formatCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? [code]).join('-')
}

const shareable = new Map<string, string | null>()
const shareProblems = new Map<string, string | null>()

/**
 * Why this lock has no code, or `null` when it has one.
 *
 * `encodeLock` will happily pack **anything**, because it was written for drafts that came out of
 * the editor and are therefore expressible by construction. Point it at the roster and it lies: a
 * disc detainer has no pin-tumbler bitting at all, and any pin the editor does not offer packs as
 * `standard` — so the code would decode to a *different lock that still picks*, which is exactly
 * the failure the checksum exists to prevent, arriving through the front door instead.
 *
 * So the test is not "did it encode" but **"does the lock come back"**: encode, decode, compare.
 *
 * **Rounding is not a difference.** The grid is deliberate — one base32 digit is 0.1mm of bitting
 * and 0.05 of tolerance, and the format's own reasoning is that 0.05mm is a twentieth of a capture
 * window and therefore nothing a hand can feel. Rejecting a lock for landing between two grid
 * points would be enforcing a stricter rule than the format was designed around, and it disqualified
 * half the roster on cuts of 3.05mm. What must survive exactly is everything **categorical**: the
 * family, the chamber count, and the pin in every chamber. Those change what the lock *is*.
 *
 * Memoised by slug — the codes screen asks this of every lock on every frame, and the answer for a
 * given lock never changes. See DECISIONS D-099.
 */
export function shareProblem(def: LockDef): string | null {
  const cached = shareProblems.get(def.slug)
  if (cached !== undefined) return cached
  const answer = computeShareProblem(def)
  shareProblems.set(def.slug, answer)
  return answer
}

/** This lock's code, or `null` — see `shareProblem` for which locks have none, and why. */
export function shareableCode(def: LockDef): string | null {
  const cached = shareable.get(def.slug)
  if (cached !== undefined) return cached
  const answer = shareProblem(def) === null ? encodeLock(def) : null
  shareable.set(def.slug, answer)
  return answer
}

/** Half the format's own grid: the most a value can move and still be the same value. */
const DEPTH_SLOP = 0.05 + 1e-9
const TOLERANCE_SLOP = 0.025 + 1e-9

function computeShareProblem(def: LockDef): string | null {
  if (def.family !== 'pin-tumbler') return `a ${def.family} has no bitting to pack`
  if (def.bitting.length < MIN_CHAMBERS || def.bitting.length > MAX_CHAMBERS) {
    return `${def.bitting.length} chambers is outside what a code carries`
  }
  if (def.pins.length !== def.bitting.length) return 'its pins and its bitting disagree'
  const back = decodeLock(encodeLock(def))
  if (back.problem !== null) return back.problem
  for (const [i, pin] of def.pins.entries()) {
    if (back.def.pins[i] !== pin) return `the editor has no ${pin} pin to put in chamber ${i + 1}`
  }
  for (const [i, depth] of def.bitting.entries()) {
    if (Math.abs((back.def.bitting[i] ?? 0) - depth) > DEPTH_SLOP) {
      return `chamber ${i + 1} is cut past a code's range`
    }
  }
  if (Math.abs(back.def.toleranceQuality - def.toleranceQuality) > TOLERANCE_SLOP) {
    return 'its tolerance is outside the range a code can reach'
  }
  if (back.def.keyway !== def.keyway) return 'its keyway does not survive the trip'
  return null
}
