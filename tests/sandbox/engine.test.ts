/**
 * The bench engine (`src/sandbox/engine.ts`): the 2.5D solver under the game's read model,
 * driven the way a hand drives the bench — wrench on, tip under a pin, Space held with the
 * bench's load-scaled ramp, latched at the click, let go. Every assertion is something the owner
 * asked for at the bench on 2026-09-13. Each test prints what it saw, so a run doubles as the
 * report. The spool push-through is the one open thing, and it is a `todo`, not a green test.
 */

import { describe, expect, it } from 'vitest'
import { ALL_LOCKS } from '../../src/game/locks'
import { STARTER_TOOLS, makeConfig } from '../../src/sim'

type LockDef = (typeof ALL_LOCKS)[number]
import { CLICK_MM, GAME_TUNE, HAND_MAX_FORCE, createEngine, setWindow, shearLineMm, type Engine } from '../../src/physics/engine'

const DT = 1 / 60
/** The bench's Space ramp (`KEY_LIFT_RATE`), mm/s, before the load scaling. */
const RATE = 4.2
/** The bench's default wrench (`TENSIONS[1]`), as a fraction of the solver's max torque. */
const T = 0.13
/** How much the bench's hand relaxes at the click (`bench.ts`), mm of asked lift. */
const CLICK_RELAX = 0
/** The bench's counter-rotation rate (`bench.ts` `COUNTER_RATE`), rad/s. */
const COUNTER_RATE = 0.3 * (Math.PI / 180)
const CONFIG = makeConfig({ tools: STARTER_TOOLS, featherEnabled: true, assist: 'training' })
const LONG = 120_000

const deg = (r: number): number => (r * 180) / Math.PI

function lockDef(slug: string): LockDef {
  const def = ALL_LOCKS.find((l) => l.slug === slug)
  if (!def) throw new Error(`no lock ${slug}`)
  return def
}

function engine(slug: string, seed = 1): Engine {
  return createEngine(lockDef(slug), seed, CONFIG, GAME_TUNE)
}

function words(eng: Engine): string {
  return eng.sol.chambers.map((_, i) => eng.stateOf(i).slice(0, 4)).join(' ')
}

function binders(eng: Engine): number {
  return eng.sol.chambers.filter((_, i) => eng.stateOf(i) === 'BINDING').length
}

function tipX(eng: Engine, ch: number): number {
  const P = eng.sol.params
  return P.firstChamberX + ch * P.pitch
}

/** Wrench at `tension`, pick parked outside the lock, for `secs`. */
function wrench(eng: Engine, tension: number, secs: number): void {
  for (let t = 0; t < secs; t += DT) eng.drive(-3, eng.tipRest(), tension, DT)
}

interface Push {
  /** Seconds into the hold when the pin read SET; -1 if it never did. */
  setAt: number
  /** Asked lift when the foot first came within `CLICK_MM` of the rim; -1 if it never did. */
  askedAtLine: number
  /** Seconds into the hold when that happened. */
  lineAt: number
  /** Asked lift when the pin read SET. */
  askedAtSet: number
  maxPickForce: number
  maxDeep: number
  /** How far any key pin's top ever rose above its own driver's bottom, mm (an inversion). */
  maxKeyOverDriver: number
}

function keyOverDriver(eng: Engine): number {
  return Math.max(...eng.readouts.map((r) => r.keyTopY - r.driverBottomY))
}

/**
 * Hold Space over chamber `ch` the bench's way: load-scaled ramp, latch at SET, then let go.
 * With `counter`, the right button is held too while lifting: the plug walks back at the
 * bench's `COUNTER_RATE` until the pin sets.
 */
function push(eng: Engine, ch: number, tension = T, secs = 1.5, counter = false): Push {
  const x = tipX(eng, ch)
  const rest = eng.tipRest()
  for (let t = 0; t < 0.3; t += DT) eng.drive(x, rest, tension, DT)
  let lift = 0
  let latched = false
  const out: Push = {
    setAt: -1,
    askedAtLine: -1,
    lineAt: -1,
    askedAtSet: -1,
    maxPickForce: 0,
    maxDeep: 0,
    maxKeyOverDriver: Number.NEGATIVE_INFINITY,
  }
  for (let t = 0; t < secs; t += DT) {
    if (!latched && eng.stateOf(ch) === 'SET') {
      latched = true
      out.setAt = t
      out.askedAtSet = lift
    }
    if (!latched) lift = Math.min(3.5, lift + (RATE / (1 + 0.6 * eng.pick().force)) * DT)
    eng.drive(x, rest + lift, tension, DT, counter && !latched ? COUNTER_RATE : 0)
    // The bench's hand: at the click it stops lifting and relaxes a little (`CLICK_RELAX`).
    if (eng.clickedNow) {
      latched = true
      lift = Math.max(0, lift - CLICK_RELAX)
      if (out.setAt < 0) {
        out.setAt = t
        out.askedAtSet = lift
      }
    }
    if (out.askedAtLine < 0 && eng.footAboveRim(ch) >= -CLICK_MM) {
      out.askedAtLine = lift
      out.lineAt = t
    }
    out.maxPickForce = Math.max(out.maxPickForce, eng.pick().force)
    out.maxDeep = Math.max(out.maxDeep, eng.sol.contacts.deep)
    out.maxKeyOverDriver = Math.max(out.maxKeyOverDriver, keyOverDriver(eng))
  }
  for (let t = 0; t < 0.6; t += DT) {
    lift = Math.max(0, lift - RATE * 1.6 * DT)
    eng.drive(x, rest + lift, tension, DT)
    out.maxDeep = Math.max(out.maxDeep, eng.sol.contacts.deep)
    out.maxKeyOverDriver = Math.max(out.maxKeyOverDriver, keyOverDriver(eng))
  }
  return out
}

/** Push whatever binds, up to `maxSteps` times; returns one line per push. */
function walk(eng: Engine, maxSteps: number, tension = T): { pin: number; push: Push; after: string }[] {
  const log: { pin: number; push: Push; after: string }[] = []
  for (let s = 0; s < maxSteps; s += 1) {
    const b = eng.bindingChamber
    if (b < 0) break
    const p = push(eng, b, tension)
    log.push({ pin: b, push: p, after: words(eng) })
  }
  return log
}

describe('bench engine — a standard lock, the way a hand plays it', () => {
  it(
    'under the wrench exactly one pin binds, and it is the one the read names',
    () => {
      for (const slug of ['brasswell-bike-padlock', 'northgate-5-pin-cabinet', 'ironhold-spool-trainer']) {
        const eng = engine(slug)
        wrench(eng, T, 0.6)
        console.log(`${slug}: [${words(eng)}] binder ${eng.bindingChamber + 1} plug ${deg(eng.theta()).toFixed(2)}°`)
        expect(binders(eng)).toBe(1)
        expect(eng.stateOf(eng.bindingChamber)).toBe('BINDING')
        expect(eng.sol.contacts.deep).toBe(0)
      }
    },
    LONG,
  )

  it(
    'pushing the binder sets it, the set holds, the next pin binds, and the lock opens',
    () => {
      const eng = engine('brasswell-bike-padlock')
      wrench(eng, T, 0.6)
      const log = walk(eng, 6)
      for (const l of log) {
        console.log(
          `  pin ${l.pin + 1}: set@${l.push.setAt.toFixed(2)}s [${l.after}] plug ${deg(eng.theta()).toFixed(2)}° deep=${l.push.maxDeep}`,
        )
      }
      // Four pushes, each one a set that held after the pick lowered; nothing penetrated and no
      // key pin ever rose past its driver (owner: "pins reverted — driver reverted with the key").
      // The centre-line heights differ by up to r·sin(cant) ≈ 0.05 mm when the two pins cant
      // differently; a real inversion is millimetres.
      expect(log.length).toBe(4)
      for (const l of log) expect(l.push.setAt).toBeGreaterThanOrEqual(0)
      for (const l of log) expect(l.push.maxDeep).toBe(0)
      for (const l of log) expect(l.push.maxKeyOverDriver).toBeLessThanOrEqual(0.06)
      expect(log.map((l) => l.after.split(' ').filter((w) => w === 'SET').length)).toEqual([1, 2, 3, 4])
      // After every set but the last exactly one new pin binds.
      for (const l of log.slice(0, -1)) expect(l.after.split(' ').filter((w) => w === 'BIND').length).toBe(1)
      // With every pin set the plug is free: the engine reports the open.
      wrench(eng, T, 0.5)
      console.log(`  opened=${eng.sim.opened} at ${deg(eng.theta()).toFixed(2)}°`)
      expect(eng.sim.opened).toBe(true)
    },
    LONG,
  )

  it(
    'a pin at the line is set: no extra lift, no extra precision (the click)',
    () => {
      // Owner: "you can see that the pin was set, but you need to lift it up just a nano-meter";
      // "sometimes you need to be extra precise, which is very strange". Once the binder's foot is
      // within CLICK_MM of the rim the read must say SET within a few frames and a hair of lift.
      const eng = engine('northgate-5-pin-cabinet')
      wrench(eng, T, 0.6)
      const log = walk(eng, 5)
      expect(log.length).toBe(5)
      for (const l of log) {
        const extraLift = l.push.askedAtSet - l.push.askedAtLine
        const extraTime = l.push.setAt - l.push.lineAt
        console.log(
          `  pin ${l.pin + 1}: at the line after ${l.push.askedAtLine.toFixed(2)} mm, set ${(extraTime * 1000).toFixed(0)} ms and ${extraLift.toFixed(3)} mm later`,
        )
        expect(l.push.setAt).toBeGreaterThanOrEqual(0)
        expect(l.push.askedAtLine).toBeGreaterThanOrEqual(0)
        expect(extraLift).toBeLessThanOrEqual(0.12)
        expect(extraTime).toBeLessThanOrEqual(4 * DT + 1e-9)
      }
    },
    LONG,
  )

  it(
    'pushing a pin that is not binding sets nothing and leaves the lock as it was',
    () => {
      const eng = engine('ironhold-spool-trainer')
      wrench(eng, T, 0.6)
      const before = words(eng)
      const b = eng.bindingChamber
      const other = b === 0 ? 1 : 0
      const p = push(eng, other)
      console.log(`  binder ${b + 1}, pushed ${other + 1}: set@${p.setAt.toFixed(2)} [${before}] → [${words(eng)}] deep=${p.maxDeep}`)
      expect(p.setAt).toBe(-1)
      expect(words(eng)).toBe(before)
      expect(p.maxDeep).toBe(0)
    },
    LONG,
  )

  it(
    'a pin pushed past the line blocks the wrench, reads overset, and frees it when lowered',
    () => {
      // Owner: "it should not be possible to turn the tension wrench with the lockpick pushing
      // the pin" — he could: push a pin up with no wrench, then apply it, and the plug turned.
      const eng = engine('brasswell-bike-padlock')
      const x = tipX(eng, 1)
      const rest = eng.tipRest()
      // Push pin 2 well past the line with the wrench off, then hold it there and apply the wrench.
      for (let t = 0; t < 0.3; t += DT) eng.drive(x, rest, 0, DT)
      let lift = 0
      for (let t = 0; t < 1.2; t += DT) {
        lift = Math.min(3.0, lift + RATE * DT)
        eng.drive(x, rest + lift, 0, DT)
      }
      for (let t = 0; t < 0.6; t += DT) eng.drive(x, rest + lift, T, DT)
      const blocked = deg(eng.theta())
      console.log(`  pin 2 held ${lift.toFixed(1)} mm up, wrench on: plug ${blocked.toFixed(2)}° [${words(eng)}]`)
      expect(blocked).toBeLessThan(0.1)
      expect(eng.stateOf(1)).toBe('OVERSET')
      // Lower the pick: the plug turns to the first binder.
      for (let t = 0; t < 0.8; t += DT) {
        lift = Math.max(0, lift - RATE * 1.6 * DT)
        eng.drive(x, rest + lift, T, DT)
      }
      console.log(`  pick lowered: plug ${deg(eng.theta()).toFixed(2)}° [${words(eng)}]`)
      // The first binder is met at ~0.5° at real tolerances.
      expect(deg(eng.theta())).toBeGreaterThan(0.3)
      expect(binders(eng)).toBe(1)
    },
    LONG,
  )

  it(
    'wrench off: the plug comes back to zero and every set drops; wrench on: one pin binds again',
    () => {
      const eng = engine('brasswell-bike-padlock')
      wrench(eng, T, 0.6)
      walk(eng, 2)
      const held = deg(eng.theta())
      // Two sets at real tolerances: ~0.85°.
      expect(held).toBeGreaterThan(0.5)
      wrench(eng, 0, 1)
      console.log(`  two sets at ${held.toFixed(2)}° → wrench off: ${deg(eng.theta()).toFixed(2)}° [${words(eng)}]`)
      expect(eng.theta()).toBe(0)
      expect(words(eng)).toBe(eng.sol.chambers.map(() => 'FREE').join(' '))
      wrench(eng, T, 0.6)
      console.log(`  wrench on again: ${deg(eng.theta()).toFixed(2)}° [${words(eng)}]`)
      expect(binders(eng)).toBe(1)
    },
    LONG,
  )

  it(
    'counter-rotation walks the plug back slowly, keeps the sets, and the wrench takes over again',
    () => {
      // Owner: "while pressing the left button, you start pressing the right and the rotation
      // very slowly starts moving in the opposite direction; when you release the right button
      // it returns to normal".
      const eng = engine('brasswell-bike-padlock')
      wrench(eng, T, 0.6)
      walk(eng, 2)
      const held = deg(eng.theta())
      const before = words(eng)
      const rate = COUNTER_RATE
      for (let t = 0; t < 0.4; t += DT) eng.drive(-3, eng.tipRest(), T, DT, rate)
      const backed = deg(eng.theta())
      console.log(`  held at ${held.toFixed(2)}° [${before}] → 0.4 s of counter-rotation: ${backed.toFixed(2)}° [${words(eng)}]`)
      // 0.12° back, within the ~0.2° a set pin's ledge allows at real tolerances: both sets hold.
      // (The binder is let go of as the plug walks off it — it reads FREE until the wrench takes
      // over again; a pin binds only while it holds the plug, `BIND_MIN_FORCE`.)
      expect(held - backed).toBeCloseTo(0.12, 1)
      before.split(' ').forEach((w, i) => {
        if (w === 'SET') expect(eng.stateOf(i)).toBe('SET')
      })
      wrench(eng, T, 0.4)
      console.log(`  right button let go: ${deg(eng.theta()).toFixed(2)}° [${words(eng)}]`)
      expect(deg(eng.theta())).toBeCloseTo(held, 1)
      expect(words(eng)).toBe(before)
    },
    LONG,
  )

  it(
    'under a steady wrench nothing trembles',
    () => {
      const eng = engine('brasswell-bike-padlock')
      wrench(eng, T, 0.6)
      walk(eng, 2)
      let lo = Number.POSITIVE_INFINITY
      let hi = Number.NEGATIVE_INFINITY
      let pinMove = 0
      const y0 = eng.readouts.map((r) => r.driverY)
      for (let t = 0; t < 1; t += DT) {
        eng.drive(-3, eng.tipRest(), T, DT)
        const th = deg(eng.theta())
        lo = Math.min(lo, th)
        hi = Math.max(hi, th)
        eng.readouts.forEach((r, i) => {
          pinMove = Math.max(pinMove, Math.abs(r.driverY - y0[i]!))
        })
      }
      console.log(`  one second: plug ${lo.toFixed(3)}°–${hi.toFixed(3)}° (p-p ${(hi - lo).toFixed(4)}°), pins moved ≤ ${pinMove.toFixed(4)} mm`)
      expect(hi - lo).toBeLessThan(0.02)
      expect(pinMove).toBeLessThan(0.01)
    },
    LONG,
  )

  it(
    'the hand never puts more than its cap through the pick',
    () => {
      const eng = engine('northgate-5-pin-cabinet')
      wrench(eng, T, 0.6)
      const log = walk(eng, 5)
      const most = Math.max(...log.map((l) => l.push.maxPickForce))
      console.log(`  most pick force in a five-pin walk: ${most.toFixed(2)} N of ${HAND_MAX_FORCE}`)
      expect(most).toBeLessThanOrEqual(HAND_MAX_FORCE + 1e-6)
    },
    LONG,
  )
})

describe('bench engine — what the solver is built from', () => {
  it('drivers are the game\'s own profiles, band for band, one width apart by tolerance', () => {
    const eng = engine('ironhold-spool-trainer')
    const P = eng.sol.params
    const spool = eng.sol.chambers[1]!.driver
    const full = Math.max(...spool.profile.right.map(([, h]) => h))
    const fromFoot = spool.profile.right.map(([u, h]) => [u - spool.bottomU, h] as const)
    console.log(`  spool: ${fromFoot.map(([u, h]) => `${u.toFixed(2)}:${h.toFixed(3)}`).join(' ')}`)
    // The game's spool: foot 0.45, groove 0.95 at depth 0.30, head 3.1; the shoulders run
    // 0.15 × depth / 2 ≈ 0.03 along the pin (near square, as the game's taper 0.15 means).
    const waist = fromFoot.filter(([, h]) => h < full * 0.75).map(([u]) => u)
    expect(Math.min(...waist)).toBeCloseTo(0.48, 2)
    expect(Math.max(...waist)).toBeCloseTo(1.37, 2)
    for (const [, h] of fromFoot.filter(([u]) => u > 0.48 && u < 1.37)) expect(h).toBeCloseTo(full * 0.7, 2)
    expect(spool.topU - spool.bottomU).toBeCloseTo(4.5, 6)
    // Every driver is slimmer than the bore, no two the same, the steps the tolerance apart.
    const radii = eng.sol.chambers.map((c) => Math.max(...c.driver.profile.right.map(([, h]) => h)))
    console.log(`  full radii: ${radii.map((r) => r.toFixed(3)).join(' ')} in a ${P.boreRadius.toFixed(3)} bore`)
    for (const r of radii) expect(r).toBeLessThan(P.boreRadius)
    expect(new Set(radii.map((r) => r.toFixed(4))).size).toBe(radii.length)
    const sorted = [...radii].sort((a, b) => b - a)
    for (let i = 1; i < sorted.length; i += 1) expect(sorted[i - 1]! - sorted[i]!).toBeCloseTo(GAME_TUNE.toleranceGap, 3)
  })

  it('the set window starts on the shear line and is tall enough to aim at', () => {
    const eng = engine('brasswell-bike-padlock')
    const w = setWindow(eng.sol)
    console.log(`  shear line ${shearLineMm(eng.sol.params).toFixed(3)} mm, window ${w.from.toFixed(3)}–${w.to.toFixed(3)}`)
    expect(w.from).toBe(shearLineMm(eng.sol.params))
    expect(w.to - w.from).toBeGreaterThanOrEqual(0.6)
  })
})

describe('bench engine — spools (the game\'s defined profile)', () => {
  it(
    'a spool pushed with the wrench held false-sets and stays there: the plug never gives on its own',
    () => {
      // Owner: "while pressing the tension wrench (5.26°) I push, and it suddenly changes to
      // 4.4°, which allows me to push the spool". With the game's near-square shoulder the
      // spool cannot cam the plug back; pushing it harder does nothing until counter-rotation.
      const eng = engine('ironhold-spool-trainer')
      wrench(eng, T, 0.6)
      const log = walk(eng, 3)
      for (const l of log) console.log(`  pin ${l.pin + 1}: set@${l.push.setAt.toFixed(2)}s [${l.after}] deep=${l.push.maxDeep}`)
      const pins = lockDef('ironhold-spool-trainer').pins
      const spool = log.find((l) => pins[l.pin] === 'spool')!
      expect(eng.stateOf(spool.pin)).toBe('FALSE_SET')
      // Push it again, wrench held: the plug must not walk back, and the spool must not set.
      const held = deg(eng.theta())
      const x = tipX(eng, spool.pin)
      const rest = eng.tipRest()
      let lift = 0
      let lowest = held
      for (let t = 0; t < 1.5; t += DT) {
        lift = Math.min(3.5, lift + (RATE / (1 + 0.6 * eng.pick().force)) * DT)
        eng.drive(x, rest + lift, T, DT)
        lowest = Math.min(lowest, deg(eng.theta()))
      }
      console.log(`  spool ${spool.pin + 1} pushed again, wrench held: plug ${held.toFixed(2)}° → lowest ${lowest.toFixed(2)}°, reads ${eng.stateOf(spool.pin)}`)
      expect(held - lowest).toBeLessThan(0.15)
      expect(eng.stateOf(spool.pin)).not.toBe('SET')
      for (const l of log) expect(l.push.maxDeep).toBe(0)
    },
    LONG,
  )

  it(
    'the spool technique: a false-set spool pushed while counter-rotating sets, and the lock opens',
    () => {
      // The trainer the way a hand picks it: whatever binds is pushed at the default wrench; a
      // pin that reads false set is worked first, with the right button held (counter-rotation)
      // — the plug walks back, the spool's foot clears the corner, the wrench takes over again.
      const eng = engine('ironhold-spool-trainer')
      wrench(eng, T, 0.6)
      const lines: string[] = []
      let maxDeep = 0
      for (let s = 0; s < 8 && !eng.sim.opened; s += 1) {
        let pin = -1
        let bestF = 0
        eng.readouts.forEach((r, i) => {
          if (eng.stateOf(i) === 'FALSE_SET' && r.plugForce >= bestF) {
            bestF = r.plugForce
            pin = i
          }
        })
        const counter = pin >= 0
        if (!counter) pin = eng.bindingChamber
        if (pin < 0) break
        const p = push(eng, pin, T, 1.5, counter)
        maxDeep = Math.max(maxDeep, p.maxDeep)
        lines.push(`pin ${pin + 1}${counter ? ' counter-rotating' : ''} → [${words(eng)}] ${deg(eng.theta()).toFixed(2)}° deep=${p.maxDeep}`)
      }
      console.log(`  ${lines.join('\n  ')}\n  opened=${eng.sim.opened} deep=${maxDeep}`)
      expect(eng.sim.opened).toBe(true)
      expect(maxDeep).toBeLessThanOrEqual(1)
      expect(lines.some((l) => l.includes('counter-rotating'))).toBe(true)
    },
    LONG,
  )
})

describe("bench engine — serrated pins (the game's defined profile)", () => {
  it(
    'counter-rotating onto a serrated pin never throws its driver out of the chamber',
    () => {
      // Owner, 2026-09-16, the serrated trainer: "I set 4, first, and when I set the second with
      // counter-rotation, the third pin (driver) falls out of the shaft into the keyhole …
      // always, when you counter-rotate to set up the pin, if next is serrated — it falls out."
      // Seed 4 reproduced it headless: the moment a serration groove reached the rim corner
      // the pinch let go, the plug ran 0.34° → 0.77° INSIDE one solver step, the lip jammed on
      // the rising ledge, the hard cap teleported the plug back 0.44°, and the driver — left
      // canted with a corner in the plug's wall — flipped 96° into the plug (`deep` 5–8). The
      // caps are the solver's own rotation stops now, so the plug never leaves them.
      const eng = engine('kestrel-serrated-trainer', 4)
      const floorY = eng.sol.params.floorY
      const lowestDriver = (): number =>
        Math.min(
          ...eng.sol.chambers.map((ch) => {
            let low = Number.POSITIVE_INFINITY
            for (let k = 0; k < ch.driver.count; k += 1) low = Math.min(low, ch.driver.world[k * 2 + 1]!)
            return low
          }),
        )
      const maxCant = (): number => Math.max(...eng.readouts.map((r) => Math.abs(deg(r.driverCant))))
      wrench(eng, T, 0.6)
      const lines: string[] = []
      let maxDeep = 0
      let minLow = Number.POSITIVE_INFINITY
      let worstCant = 0
      const work = (pin: number, counter: boolean): void => {
        const p = push(eng, pin, T, 1.5, counter)
        maxDeep = Math.max(maxDeep, p.maxDeep)
        minLow = Math.min(minLow, lowestDriver())
        worstCant = Math.max(worstCant, maxCant())
        lines.push(`pin ${pin + 1}${counter ? ' counter-rotating' : ''} → [${words(eng)}] ${deg(eng.theta()).toFixed(2)}° deep=${p.maxDeep} cant=${maxCant().toFixed(1)}°`)
      }
      // The owner's order: pin 4, pin 1, pin 2, pin 3 — a false set is worked again with the
      // right button held, as at the bench.
      work(3, false)
      for (const pin of [0, 1, 2]) {
        for (let k = 0; k < 3 && eng.stateOf(pin) !== 'SET'; k += 1) work(pin, k > 0 || eng.stateOf(pin) === 'FALSE_SET')
      }
      console.log(`  ${lines.join('\n  ')}\n  deep=${maxDeep} lowest driver ${(minLow - eng.sol.rimY).toFixed(2)} mm (floor ${(floorY - eng.sol.rimY).toFixed(2)}) worst cant ${worstCant.toFixed(1)}°`)
      expect(maxDeep).toBe(0)
      expect(minLow).toBeGreaterThan(floorY + 1)
      expect(worstCant).toBeLessThan(10)
    },
    LONG,
  )
})
