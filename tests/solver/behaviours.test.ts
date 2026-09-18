/**
 * The acceptance behaviours — scripted inputs, assertions on state. Nothing here names a pin type
 * to the solver; every profile is polygon data and every number is read back from geometry.
 *
 * Each test prints the numbers it saw, so a run doubles as the report.
 */

import { describe, expect, it } from 'vitest'
import {
  MUSHROOM,
  RAKE,
  SERRATED,
  SPOOL,
  STANDARD,
  T_PIN,
  aimTip,
  createLock,
  makeInput,
  plugAngle,
  readChamber,
  readPick,
  step,
  type PinProfile,
  type SolverState,
} from '../../src/solver'
import { DEG, K_SPOOL, K_STANDARD, atChamber, deg, glide, lock, parked, run, runUntil, snapshot } from './fixtures'

/** Bore shift needed to pinch a centred pin: both radial clearances, plus the housing offset. */
function takeUp(s: SolverState, chamber: number): number {
  const P = s.params
  return (2 * (P.boreRadius - P.pinRadius) + s.chambers[chamber]!.delta) / P.plugRadius
}

/** Raise the hand target in steps until the driver clears the plug; returns the hand lift used. */
function liftToSet(s: SolverState, chamber: number, T: number, maxLift = 3.6): number {
  glide(s, atChamber(s, chamber, -0.3, T), 0.4, 0.2)
  for (let lift = 1.0; lift <= maxLift; lift += 0.3) {
    const at = runUntil(s, atChamber(s, chamber, lift, T), 0.6, () => readChamber(s, chamber).driverClearance > 0.05)
    if (at > 0) return lift
  }
  return -1
}

describe('1. bind', () => {
  it('torque with no lift binds the chamber with the smallest δ after the bore clearance is taken up, and holds', () => {
    const s = createLock(lock([STANDARD, STANDARD, STANDARD], [0.03, 0.0, 0.06]))
    run(s, parked(s, 0), 0.3)
    run(s, parked(s, 0.3), 1.0)
    const theta1 = plugAngle(s)
    const expected = takeUp(s, 1)
    console.log(`bind: θ=${deg(theta1).toFixed(3)}° expected≈${deg(expected).toFixed(3)}° (rigid, centred pin)`)
    console.log('      ', snapshot(s, 1))
    // A canted pin takes up a little more than a rigid centred one would.
    expect(theta1).toBeGreaterThan(expected * 0.8)
    expect(theta1).toBeLessThan(expected * 1.6)
    // The binding chamber is the one carrying the plug's torque.
    const forces = s.chambers.map((_, i) => readChamber(s, i).plugForce)
    console.log(`      plug force per chamber: ${forces.map((f) => f.toFixed(2)).join(' / ')} N`)
    const total = forces[0]! + forces[1]! + forces[2]!
    expect(forces[1]).toBeGreaterThan(1)
    expect(forces[1]! / total).toBeGreaterThan(0.9)
    // No creep over 2 s.
    run(s, parked(s, 0.3), 2.0)
    const drift = plugAngle(s) - theta1
    console.log(`      creep over 2 s: ${(deg(drift) * 3600).toFixed(2)} arcsec`)
    expect(Math.abs(drift)).toBeLessThan(0.02 * DEG)
  })
})

describe('2. set', () => {
  it('lifting the binding pin under torque clears the driver, the plug advances to the next δ, and the driver stays on the ledge when the pick leaves', () => {
    const s = createLock(lock([STANDARD, STANDARD], [0, 0.04]))
    const T = 0.3
    run(s, parked(s, T), 1.0)
    const thetaBind = plugAngle(s)
    const lift = liftToSet(s, 0, T)
    console.log(`set: cleared at hand lift ${lift.toFixed(1)}; ${snapshot(s, 0)}`)
    expect(lift).toBeGreaterThan(0)
    run(s, atChamber(s, 0, lift, T), 0.3)
    const thetaSet = plugAngle(s)
    console.log(`     θ bind=${deg(thetaBind).toFixed(3)}° → set=${deg(thetaSet).toFixed(3)}°, next δ take-up ≈ ${deg(takeUp(s, 1)).toFixed(3)}°`)
    expect(thetaSet).toBeGreaterThan(thetaBind + 0.1 * DEG)
    expect(thetaSet).toBeGreaterThan(takeUp(s, 1) * 0.8)
    expect(readChamber(s, 1).plugForce).toBeGreaterThan(1)

    glide(s, parked(s, T), 0.5, 1.5)
    const c0 = readChamber(s, 0)
    console.log(`     parked: ${snapshot(s, 0)}`)
    // Key pin back at rest, driver still up on the ledge, plug angle held.
    expect(Math.abs(c0.keyLift)).toBeLessThan(0.05)
    expect(c0.driverLift).toBeGreaterThan(0.3)
    expect(c0.driverClearance).toBeGreaterThan(-0.3)
    expect(Math.abs(plugAngle(s) - thetaSet)).toBeLessThan(0.1 * DEG)
  })
})

describe('3. spool false set', () => {
  it('a spool whose waist straddles the shear line lets the plug past the bind angle until the canted pin jams; the pick feels it as deflection', () => {
    const T = 0.25
    const plain = createLock(lock([STANDARD], [0], [K_SPOOL]))
    run(plain, parked(plain, T), 0.8)
    const thetaBind = plugAngle(plain)

    const s = createLock(lock([SPOOL], [0], [K_SPOOL]))
    run(s, parked(s, T), 1.0)
    const thetaFalse = plugAngle(s)
    const c = readChamber(s, 0)
    console.log(`spool: standard pin binds at ${deg(thetaBind).toFixed(2)}°; spool false-sets at θ=${deg(thetaFalse).toFixed(2)}°, driver cant=${deg(c.driverCant).toFixed(2)}°, key cant=${deg(c.keyCant).toFixed(2)}°`)
    console.log(`       driver: plug force ${c.plugForce.toFixed(2)} N, housing force ${c.housingForce.toFixed(2)} N`)
    expect(thetaFalse).toBeGreaterThan(thetaBind + 1 * DEG)
    expect(thetaFalse).toBeLessThan(thetaBind + 6 * DEG)
    expect(Math.abs(c.driverCant)).toBeGreaterThan(1 * DEG)
    expect(Math.abs(c.driverCant)).toBeLessThan(8 * DEG)
    // Jammed: both bores carry it.
    expect(c.plugForce).toBeGreaterThan(0.5)
    expect(c.housingForce).toBeGreaterThan(0.5)
    // Holds for 2 s with no creep.
    run(s, parked(s, T), 2.0)
    expect(Math.abs(plugAngle(s) - thetaFalse)).toBeLessThan(0.05 * DEG)

    // Lean on it: the pin barely moves, the blade bends.
    glide(s, atChamber(s, 0, -0.3, T), 0.4, 0.2)
    glide(s, atChamber(s, 0, 1.5, T), 0.3, 0.5)
    const p = readPick(s)
    const c2 = readChamber(s, 0)
    console.log(`       leaning 1.5 mm: pick force ${p.force.toFixed(2)} N, tip deflection ${p.bendDeflection.toFixed(2)} mm, key lift ${c2.keyLift.toFixed(3)} mm, θ=${deg(plugAngle(s)).toFixed(2)}°`)
    expect(p.bendDeflection).toBeGreaterThan(0.5)
    expect(c2.keyLift).toBeLessThan(0.3)
  })
})

describe('4. counter-rotation and push-through', () => {
  /** From a false set, push up with the hand target 5 mm above rest; did the driver clear? */
  function pushThrough(driver: PinProfile, T: number): { through: boolean; back: number; force: number; deflection: number; thetaFalse: number } {
    const s = createLock(lock([driver], [0], [K_SPOOL]))
    run(s, parked(s, T), 1.0)
    const thetaFalse = plugAngle(s)
    glide(s, atChamber(s, 0, -0.3, T), 0.4, 0.2)
    let force = 0
    let deflection = 0
    let minTheta = thetaFalse
    let through = false
    for (let l = 0.3; l < 5.0 && !through; l += 0.25) {
      const inp = atChamber(s, 0, l, T)
      for (let i = 0; i < 40; i += 1) {
        step(s, inp)
        const p = readPick(s)
        if (p.force > force) force = p.force
        if (p.bendDeflection > deflection) deflection = p.bendDeflection
        const th = plugAngle(s)
        if (th < minTheta) minTheta = th
        if (readChamber(s, 0).driverClearance > 0.05) through = true
      }
    }
    return { through, back: thetaFalse - minTheta, force, deflection, thetaFalse }
  }

  for (const driver of [SPOOL, MUSHROOM, SERRATED]) {
    it(`${driver.name}: lifting from the false set pushes the plug back; there is a torque above which it cannot be pushed through`, () => {
      const tensions = [0.1, 0.2, 0.3, 0.45]
      const rows = tensions.map((T) => ({ T, ...pushThrough(driver, T) }))
      for (const r of rows) {
        console.log(
          `${driver.name} T=${r.T.toFixed(2)} (${(r.T * 60).toFixed(0)} N·mm): false set ${deg(r.thetaFalse).toFixed(2)}°, plug pushed back ${deg(r.back).toFixed(2)}°, pick ${r.force.toFixed(1)} N, tip deflection ${r.deflection.toFixed(2)} mm → ${r.through ? 'THROUGH to a true set' : 'unpushable'}`,
        )
      }
      const pushable = rows.filter((r) => r.through).map((r) => r.T)
      const held = rows.filter((r) => !r.through).map((r) => r.T)
      console.log(`${driver.name}: threshold between ${Math.max(...pushable).toFixed(2)} and ${Math.min(...held).toFixed(2)}`)
      expect(pushable.length).toBeGreaterThan(0)
      expect(held.length).toBeGreaterThan(0)
      // Monotonic: everything pushable is lighter than everything held.
      expect(Math.max(...pushable)).toBeLessThan(Math.min(...held))
      // While it holds, the wedge still drives the plug back and the blade bends. A serration is
      // only a fifth of a millimetre deep, so its push-back is a click too small to measure
      // against a hand-damped plug; the spool and mushroom swing it back visibly.
      const first = rows[0]!
      if (driver !== SERRATED) expect(first.back).toBeGreaterThan(0.3 * DEG)
      expect(first.deflection).toBeGreaterThan(0.3)
    })
  }

  it('a T-pin is not pushable at any of these torques', () => {
    const rows = [0.1, 0.2, 0.3].map((T) => ({ T, ...pushThrough(T_PIN, T) }))
    for (const r of rows) console.log(`t-pin T=${r.T.toFixed(2)}: false set ${deg(r.thetaFalse).toFixed(2)}°, pushed back ${deg(r.back).toFixed(2)}° → ${r.through ? 'THROUGH' : 'unpushable'}`)
    expect(rows.every((r) => !r.through)).toBe(true)
  })
})

describe('5. overset', () => {
  it('lifting past the shear line makes the key pin bridge it and bind instead, and the overset holds when the pick leaves', () => {
    const T = 0.25
    const s = createLock(lock([STANDARD, STANDARD], [0, 0.04]))
    run(s, parked(s, T), 0.6)
    const lift = liftToSet(s, 0, T)
    expect(lift).toBeGreaterThan(0)
    run(s, atChamber(s, 0, lift, T), 0.3)
    const thetaSet = plugAngle(s)
    // Now shove it far past.
    glide(s, atChamber(s, 0, 5.5, T), 0.4, 1.0)
    const c = readChamber(s, 0)
    console.log(`overset: set at θ=${deg(thetaSet).toFixed(2)}°; after shoving: θ=${deg(plugAngle(s)).toFixed(2)}° key top ${c.keyTopY.toFixed(2)} mm above shear, key pin plug force ${c.keyPlugForce.toFixed(2)} N / housing ${c.keyHousingForce.toFixed(2)} N, driver plug force ${c.plugForce.toFixed(2)} N, pick ${c.pickForce.toFixed(1)} N`)
    expect(c.keyTopY).toBeGreaterThan(s.rimY + 0.5)
    expect(c.keyPlugForce).toBeGreaterThan(0.5)
    expect(c.keyHousingForce).toBeGreaterThan(0.5)
    expect(plugAngle(s)).toBeLessThan(thetaSet - 0.2 * DEG)
    expect(readChamber(s, 1).plugForce).toBeLessThan(0.2)

    glide(s, parked(s, T), 0.4, 1.0)
    const c2 = readChamber(s, 0)
    console.log(`         parked: θ=${deg(plugAngle(s)).toFixed(2)}° key top ${c2.keyTopY.toFixed(2)}, key pin plug force ${c2.keyPlugForce.toFixed(2)} N`)
    expect(c2.keyTopY).toBeGreaterThan(s.rimY + 0.5)
    expect(c2.keyPlugForce).toBeGreaterThan(0.5)
  })
})

describe('6. feather', () => {
  it('easing the torque releases set pins in order of least ledge engagement', () => {
    const s = createLock(lock([STANDARD, STANDARD, STANDARD], [0, 0.03, 0.06]))
    const T = 0.3
    run(s, parked(s, T), 0.8)
    for (const ch of [0, 1]) {
      expect(liftToSet(s, ch, T)).toBeGreaterThan(0)
      glide(s, parked(s, T), 0.4, 0.3)
      console.log(`feather: set chamber ${ch}: θ=${deg(plugAngle(s)).toFixed(3)}°`)
    }
    const c0 = readChamber(s, 0)
    const c1 = readChamber(s, 1)
    expect(c0.driverLift).toBeGreaterThan(0.3)
    expect(c1.driverLift).toBeGreaterThan(0.3)
    // Chamber 1 was set last, at the larger angle: less of the ledge under it.
    let drop0 = -1
    let drop1 = -1
    for (const t of [0.25, 0.2, 0.15, 0.12, 0.1, 0.08, 0.06, 0.04, 0.02, 0.0]) {
      run(s, parked(s, t), 0.5)
      const d0 = readChamber(s, 0).driverLift
      const d1 = readChamber(s, 1).driverLift
      console.log(`         T=${t.toFixed(2)}: θ=${deg(plugAngle(s)).toFixed(3)}° driver lifts ${d0.toFixed(3)} / ${d1.toFixed(3)}`)
      if (drop0 < 0 && d0 < 0.1) drop0 = t
      if (drop1 < 0 && d1 < 0.1) drop1 = t
    }
    console.log(`         chamber 1 dropped at T=${drop1}, chamber 0 at T=${drop0}`)
    expect(drop1).toBeGreaterThan(drop0)
  })
})

describe('7. the pick fouls neighbours', () => {
  it('a hook carried between chambers lifts every pin it passes by about its own height, not the hand target', () => {
    const s = createLock(lock([STANDARD, STANDARD, STANDARD], [0, 0.03, 0.06]))
    run(s, parked(s, 0), 0.3)
    const ch0 = s.chambers[0]!
    const tipRest = ch0.keyRestY + ch0.key.bottomU
    for (const carry of [0.6, 1.0]) {
      const maxLift = [0, 0, 0]
      let tipFree = 0
      let tipUnder = 0
      glide(s, makeInput(0, aimTip(s, ch0.x - 1.5, tipRest + carry)), 0.5, 0.2)
      const out = makeInput(0, aimTip(s, s.chambers[2]!.x + 1.0, tipRest + carry))
      const from = { ...s.input }
      const mid = s.chambers[1]!.x
      const n = 240
      for (let i = 1; i <= n; i += 1) {
        const u = i / n
        step(s, {
          tension: 0,
          handX: from.handX + (out.handX - from.handX) * u,
          handY: from.handY + (out.handY - from.handY) * u,
          handAngle: from.handAngle + (out.handAngle - from.handAngle) * u,
        })
        for (let c = 0; c < 3; c += 1) maxLift[c] = Math.max(maxLift[c]!, readChamber(s, c).keyLift)
        const p = readPick(s)
        const h = p.tipY - tipRest
        if (p.tipX > ch0.x - 2 && p.tipX < ch0.x - 1) tipFree = Math.max(tipFree, h)
        if (Math.abs(p.tipX - mid) < 0.5) tipUnder = Math.max(tipUnder, h)
      }
      run(s, out, 0.4)
      const after = [0, 1, 2].map((c) => readChamber(s, c).keyLift)
      console.log(
        `foul: hand asked ${carry.toFixed(1)} above the pin tips; the tip ran at ${tipFree.toFixed(2)} in the clear and ${tipUnder.toFixed(2)} under the middle pin (the pin's spring bends it down); max lifts ${maxLift.map((m) => m.toFixed(2)).join(' / ')}; after passing: ${after.map((a) => a.toFixed(3)).join(' / ')}`,
      )
      // The pins follow the tip they actually met, and the tip is the hand target less the bend.
      expect(tipFree).toBeGreaterThan(carry - 0.05)
      expect(tipUnder).toBeLessThan(tipFree + 0.01)
      expect(maxLift[1]).toBeGreaterThan(tipUnder - 0.1)
      expect(maxLift[1]).toBeLessThan(tipUnder + 0.7)
      expect(maxLift[1]).toBeGreaterThan(0.4 * carry)
      for (let c = 0; c < 2; c += 1) expect(Math.abs(after[c]!)).toBeLessThan(0.05)
      glide(s, parked(s, 0), 0.5, 0.2)
    }
  })

  it('carried above the keyway roof, the hook is held down to the roof: pins get the roof clearance, not the hand target', () => {
    const s = createLock(lock([STANDARD, STANDARD, STANDARD], [0, 0.03, 0.06]))
    run(s, parked(s, 0), 0.3)
    const ch0 = s.chambers[0]!
    const tipRest = ch0.keyRestY + ch0.key.bottomU
    const roof = s.params.keywayCeilY - tipRest
    const carry = roof + 0.3
    glide(s, makeInput(0, aimTip(s, ch0.x - 1.5, tipRest + carry)), 0.5, 0.2)
    const out = makeInput(0, aimTip(s, s.chambers[2]!.x + 1.0, tipRest + carry))
    const from = { ...s.input }
    const maxLift = [0, 0, 0]
    let maxTip = -Infinity
    const n = 240
    for (let i = 1; i <= n; i += 1) {
      const u = i / n
      step(s, {
        tension: 0,
        handX: from.handX + (out.handX - from.handX) * u,
        handY: from.handY + (out.handY - from.handY) * u,
        handAngle: from.handAngle + (out.handAngle - from.handAngle) * u,
      })
      for (let c = 0; c < 3; c += 1) maxLift[c] = Math.max(maxLift[c]!, readChamber(s, c).keyLift)
      const p = readPick(s)
      if (p.tipX > ch0.x + 2 && p.tipX < s.chambers[1]!.x - 2) maxTip = Math.max(maxTip, p.tipY - tipRest)
    }
    console.log(`foul: roof is ${roof.toFixed(2)} above the tips; hand asked for ${carry.toFixed(2)}, the tip got ${maxTip.toFixed(2)} between chambers; max lifts ${maxLift.map((m) => m.toFixed(2)).join(' / ')}`)
    expect(maxTip).toBeLessThan(roof + 0.1)
    // The first pin is where the hook rides up before the roof catches it; the ones after get
    // only what the roof allows.
    for (let c = 1; c < 3; c += 1) expect(maxLift[c]).toBeLessThan(roof + 0.7)
  })
})

describe('8. rake', () => {
  it('a rake scrubbed under torque sets standard pins one by one and never sets the spool', () => {
    const T = 0.2
    const s = createLock(lock([STANDARD, SPOOL, STANDARD, STANDARD], [0.0, 0.03, 0.045, 0.06], [K_STANDARD, K_SPOOL, 3.3, K_STANDARD], RAKE))
    run(s, parked(s, T), 0.5)
    const ch0 = s.chambers[0]!
    const tipRest = ch0.keyRestY + ch0.key.bottomU
    const deepX = s.chambers[3]!.x + 2
    const setNow = (): boolean[] => s.chambers.map((_, c) => {
      const r = readChamber(s, c)
      return r.driverLift > 0.25 && r.driverClearance > -0.3
    })
    let firstSet = -1
    for (let pass = 0; pass < 40; pass += 1) {
      const h = 0.7 + 0.12 * (pass % 9)
      glide(s, makeInput(T, aimTip(s, pass % 2 === 0 ? deepX : 2.0, tipRest + h)), 0.3, 0.05)
      if (firstSet < 0 && setNow().some(Boolean)) firstSet = pass
    }
    glide(s, parked(s, T), 0.4, 0.5)
    const state = setNow()
    const detail = s.chambers.map((ch, c) => `${ch.driver.profile.name}: lift ${readChamber(s, c).driverLift.toFixed(2)} clear ${readChamber(s, c).driverClearance.toFixed(2)} ${state[c] ? 'SET' : 'not set'}`)
    console.log(`rake at T=${T}: first set on pass ${firstSet}; θ=${deg(plugAngle(s)).toFixed(2)}°\n         ${detail.join('\n         ')}`)
    const standardSet = [0, 2, 3].filter((c) => state[c]).length
    expect(standardSet).toBeGreaterThanOrEqual(2)
    expect(state[1]).toBe(false)
    expect(readChamber(s, 1).driverClearance).toBeLessThan(-1.0)
  })
})
