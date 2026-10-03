/**
 * PHYSLAB — does the whole pin-tumbler family fall out of the geometry?
 *
 * Every test here asserts that something `src/sim` hand-authors with tuned constants instead
 * *emerges* from shapes in contact, now across the full roster:
 *
 *   1. binding order is manufacturing clearance, and pins hand off one at a time;
 *   2. a hook opens a standard lock, setting pins in clearance order;
 *   3. a spool false-sets and jams a hard wrench — only the light-tension technique lets it through;
 *   4. a mushroom punishes a heavy hand: the wrench that opens standards cannot open mushrooms;
 *   5. all four profiles in one lock open together;
 *   6. per-chamber individuality is real and felt, and the run is deterministic;
 *   7. over-lifting a pin oversets it, and only dropping tension clears it;
 *   8. set pins are held by tension — drop it and they fall, feather it and they stand;
 *   9. the binding pin reads heavier than a free one — an emergent resistance readout;
 *  10. leaning hard on a jammed pin bends and then breaks the pick; a gentle hand never does.
 *
 * Not one of these behaviours is coded by name. They are lengths, widths, a friction coefficient.
 */

import { describe, expect, it } from 'vitest'

import {
  createLab,
  FLOOR_Y,
  PITCH,
  setLift,
  snapshot,
  SHELL_CHAMBER_TOP,
  T_SET_HOLD,
  SPRING_SOLID,
  step,
  STRAIN_BENT,
  type LabInput,
  type LabState,
  type ProfileKind,
} from '../../src/physlab/model'

/** Tool lift that puts a hook's crest under a chamber at the height needed to reach `lift`. */
function hookLiftFor(targetLift: number, toothHeight = 2.3): number {
  return FLOOR_Y + targetLift - toothHeight
}

/** Tool parked far from every chamber — tension only, no lifting. */
const IDLE = (tension: number): LabInput => ({ toolX: -99, toolLift: FLOOR_Y, tension })

interface SolveOpts {
  tension?: number
  maxTicks?: number
  /** Ease the wrench when the worked pin jams (the real spool/mushroom technique). Default true. */
  ease?: boolean
  onTick?: (s: LabState) => void
}

/**
 * A hook picker: work the pins tightest-clearance first, committing to one until it is caught, and
 * ease the wrench when the worked pin jams. This is a *player*, not part of the model — it is here
 * so the tests drive the lab the way a hand would.
 */
function solve(lab: LabState, opts: SolveOpts = {}): LabState {
  const tension = opts.tension ?? 0.3
  const maxTicks = opts.maxTicks ?? 8000
  const ease = opts.ease ?? true
  let easeUntil = -1
  for (let t = 0; t < maxTicks && !lab.opened && !lab.pickBroken; t += 1) {
    const uncaught = lab.chambers.filter((c) => !c.caught)
    if (uncaught.length === 0) {
      step(lab, IDLE(tension))
      opts.onTick?.(lab)
      continue
    }
    const c = uncaught.reduce((a, b) => (b.def.clearance < a.def.clearance ? b : a))
    const walled = c.counterForce > 0.02 // a spool foot walling the climb
    if (ease && walled) easeUntil = t + 60
    const easing = t < easeUntil
    const aim = Math.min(setLift(c) + 0.2, c.lift + 0.3) // push firmly into the set window
    // A lightening, not a release: below this a set pin loses its ledge on the way past (D-042's
    // hold threshold), which is the difference between walking a spool up and dropping the stack.
    step(lab, { toolX: c.def.boreX, toolLift: hookLiftFor(aim), tension: easing ? 0.2 : tension })
    opts.onTick?.(lab)
  }
  return lab
}

const std = (n: number): ProfileKind[] => Array.from({ length: n }, () => 'standard')

/** The lightest wrench step the benches offer — deliberately below `T_SET_HOLD`. */
const TENSIONS_LIGHTEST = 0.14

describe('binding order emerges from clearance', () => {
  it('the tightest chamber binds, and normally it is the only one', () => {
    const lab = createLab({ kinds: std(4), seed: 11 })
    step(lab, IDLE(0.3))
    expect(lab.chambers.filter((c) => c.binding)).toHaveLength(1)
    const tightest = [...lab.chambers].sort((a, b) => a.def.clearance - b.def.clearance)[0]!
    expect(lab.binding).toBe(tightest.def.index)
  })
  it('but two chambers within a hair of each other bind together — rarely', () => {
    // *"In rare situations two pins can [bind] at one time."* Binding is a contact, not a rank: two
    // bodies the same width to within `CO_BIND` are both pinched by the same plug. Asserted as a
    // *rate* over two hundred seeds rather than for one lucky one, which is what "rare" means.
    let together = 0
    for (let seed = 1; seed <= 200; seed += 1) {
      const lab = createLab({ kinds: std(5), seed })
      step(lab, IDLE(0.4))
      if (lab.chambers.filter((c) => c.binding).length > 1) together += 1
    }
    expect(together).toBeGreaterThan(0)
    expect(together).toBeLessThan(40)
  })
  it('over-lifting the pin the plug is pinching oversets it; dropping tension clears it', () => {
    const lab = createLab({ kinds: std(3), seed: 8 })
    step(lab, IDLE(0.3))
    const victim = lab.chambers[lab.binding]!
    for (let t = 0; t < 500; t += 1) {
      step(lab, { toolX: victim.def.boreX, toolLift: hookLiftFor(setLift(victim) + 1.2), tension: 0.3 })
    }
    expect(victim.overset).toBe(true)
    expect(victim.caught).toBe(false)

    for (let t = 0; t < 500; t += 1) step(lab, IDLE(0))
    expect(victim.overset).toBe(false)
    expect(victim.lift).toBeLessThan(0.5) // it fell clear
  })
  it('a pin the plug is NOT pinching goes up and comes straight back down', () => {
    // *"I can not overset [a] non-[binding] pin."* A looser chamber's key pin slips through the
    // passage between the two bores with room to spare, so nothing traps it above the line: the
    // tool holds it up and the spring takes it back the moment the tool leaves. Being above the
    // shear line is not the same as being **held** there, and only the second one is an overset.
    const lab = createLab({ kinds: std(3), seed: 8 })
    step(lab, IDLE(0.3))
    const loose = [...lab.chambers].sort((a, b) => b.def.clearance - a.def.clearance)[0]!
    expect(loose.def.index).not.toBe(lab.binding)
    for (let t = 0; t < 500; t += 1) {
      step(lab, { toolX: loose.def.boreX, toolLift: hookLiftFor(setLift(loose) + 1.2), tension: 0.3 })
    }
    expect(loose.overset, 'lifted past the line, but nothing is holding it there').toBe(false)
    // Take the tool away with the wrench still on and it falls — there is no jam to clear.
    for (let t = 0; t < 400; t += 1) step(lab, IDLE(0.3))
    expect(loose.lift).toBeLessThan(0.5)
  })
})

describe('a hook opens a standard lock', () => {
  it('opens, and every chamber takes its turn as the binder — tightest first', () => {
    const lab = createLab({ kinds: std(5), seed: 3 })
    const binders: number[] = []
    solve(lab, {
      tension: 0.32,
      onTick: (s) => {
        if (s.binding >= 0 && binders[binders.length - 1] !== s.binding) binders.push(s.binding)
      },
    })
    expect(lab.opened).toBe(true)
    const byClearance = [...lab.chambers]
      .sort((a, b) => a.def.clearance - b.def.clearance)
      .map((c) => c.def.index)
    // Nothing names an order: the plug simply pinches whichever pin is tightest, and hands on.
    expect(binders[0]).toBe(byClearance[0])
    expect(new Set(binders).size).toBe(lab.chambers.length)
  })
})

describe('security pins are shapes, not constants', () => {
  const spools: ProfileKind[] = ['spool', 'standard', 'spool', 'standard']

  it('a spool jams a hard wrench and yields only to the light-tension technique', () => {
    const forced = createLab({ kinds: spools, seed: 4 })
    solve(forced, { tension: 0.5, ease: false, maxTicks: 16000 })
    expect(forced.opened, 'held hard throughout, it never comes round').toBe(false)

    const eased = createLab({ kinds: spools, seed: 4 })
    solve(eased, { tension: 0.5, ease: true, maxTicks: 16000 })
    expect(eased.opened, 'ease when it walls and the same lock opens').toBe(true)
  })

  it('security pins wall a hard wrench that plain pins shrug off', () => {
    const plain = createLab({ kinds: std(4), seed: 6 })
    solve(plain, { tension: 0.5, ease: false, maxTicks: 16000 })
    expect(plain.opened, 'standards do not care how hard you hold it').toBe(true)

    const mushrooms = createLab({
      kinds: ['mushroom', 'mushroom', 'mushroom', 'mushroom'],
      seed: 6,
    })
    solve(mushrooms, { tension: 0.5, ease: false, maxTicks: 16000 })
    expect(mushrooms.opened, 'the very same hand cannot open mushrooms').toBe(false)
  })

  it('all four profiles in one lock open together', () => {
    const lab = createLab({ kinds: ['standard', 'spool', 'serrated', 'mushroom'], seed: 9 })
    solve(lab, { tension: 0.4, maxTicks: 24000 })
    expect(lab.opened).toBe(true)
  })
})

describe('individuality is rolled from the seed, and a run replays', () => {
  it('chambers in one lock differ in spring, drag and feel', () => {
    const lab = createLab({ kinds: std(5), seed: 17 })
    const springs = new Set(lab.chambers.map((c) => c.def.springStrength.toFixed(4)))
    const drags = new Set(lab.chambers.map((c) => c.def.dragFactor.toFixed(4)))
    expect(springs.size).toBe(lab.chambers.length)
    expect(drags.size).toBe(lab.chambers.length)
  })

  it('the same seed replays exactly', () => {
    const a = createLab({ kinds: std(4), seed: 21 })
    const b = createLab({ kinds: std(4), seed: 21 })
    solve(a, { tension: 0.33 })
    solve(b, { tension: 0.33 })
    expect(snapshot(a)).toEqual(snapshot(b))
  })
})

describe('set pins are held by tension', () => {
  const freshSolved = (): LabState => {
    const lab = createLab({ kinds: std(3), seed: 5 })
    solve(lab, { tension: 0.35 })
    return lab
  }

  it('a held wrench keeps them, a dropped wrench loses them', () => {
    const lab = freshSolved()
    expect(lab.chambers.every((c) => c.caught)).toBe(true)
    for (let t = 0; t < 120; t += 1) step(lab, IDLE(0.35))
    expect(lab.chambers.every((c) => c.caught)).toBe(true) // still held
    for (let t = 0; t < 160; t += 1) step(lab, IDLE(0))
    expect(lab.chambers.some((c) => !c.caught)).toBe(true) // let go, they fell
  })

  it('a brief feather dip keeps the set pins standing', () => {
    const lab = freshSolved()
    for (let t = 0; t < 6; t += 1) step(lab, IDLE(0)) // a flick off the wrench
    for (let t = 0; t < 40; t += 1) step(lab, IDLE(0.35))
    expect(lab.chambers.every((c) => c.caught)).toBe(true)
  })
})

describe('resistance is emergent', () => {
  it('the binding pin feels heavier than a free one, and the readout answers to a push', () => {
    const lab = createLab({ kinds: std(3), seed: 9 })
    step(lab, IDLE(0.4))
    const b = lab.binding
    const binding = lab.chambers[b]!
    const free = lab.chambers.find((c) => c.def.index !== b)!
    expect(binding.feel).toBeGreaterThan(free.feel)

    expect(lab.resistance).toBe(0) // nothing under the tool
    let read = 0
    for (let t = 0; t < 4; t += 1) {
      // A real lean — a big overreach the bound pin cannot ride up to — keeps the tip loaded.
      step(lab, { toolX: binding.def.boreX, toolLift: hookLiftFor(1.6), tension: 0.4 })
      read = Math.max(read, lab.resistance)
    }
    expect(read).toBeGreaterThan(0.15) // leaning on the bound pin reads heavy
  })
})

describe('the pick is a rigid tool', () => {
  it('a chamber deeper than the tool can reach cannot be opened', () => {
    const shallow = createLab({ kinds: std(4), seed: 3 })
    shallow.tool.reach = 2.5 * PITCH // reaches chambers 0,1,2 — not the deepest
    solve(shallow, { tension: 0.32, maxTicks: 8000 })
    expect(shallow.opened).toBe(false)
    expect(shallow.chambers[3]!.caught).toBe(false)

    const full = createLab({ kinds: std(4), seed: 3 })
    solve(full, { tension: 0.32, maxTicks: 8000 })
    expect(full.opened).toBe(true) // the same lock opens once the tip can reach the last chamber
  })

  it('the pick oversets a pin rather than passing through it, and stops at the ceiling', () => {
    const lab = createLab({ kinds: ['standard'], seed: 5 })
    const c = lab.chambers[0]!
    const commanded = hookLiftFor(setLift(c) + 4) // heave the tip far past the pin's set point
    for (let t = 0; t < 600; t += 1) {
      step(lab, { toolX: c.def.boreX, toolLift: commanded, tension: 0.6 })
    }
    expect(c.overset).toBe(true) // driven past its set point → overset (any set is lost)
    expect(c.caught).toBe(false)
    // A rigid pick cannot rise through it: it stops at the overset ceiling, short of the command.
    expect(lab.tool.lift).toBeLessThan(commanded - 1)
  })

  it('overlifting a deep pin fouls the neighbour toward the mouth through the shaft', () => {
    const lab = createLab({ kinds: std(3), seed: 5 })
    const deep = lab.chambers[2]!
    const neighbour = lab.chambers[1]!
    // Lift the deep pin to just its set point: the shaft rides low and the neighbour is untouched.
    for (let t = 0; t < 200; t += 1) {
      step(lab, { toolX: deep.def.boreX, toolLift: hookLiftFor(setLift(deep)), tension: 0.05 })
    }
    const gentle = neighbour.lift
    // Now heave the tip far past the set point: the rigid shaft tilts up and lifts the neighbour.
    for (let t = 0; t < 200; t += 1) {
      step(lab, { toolX: deep.def.boreX, toolLift: hookLiftFor(setLift(deep) + 3), tension: 0.05 })
    }
    expect(gentle).toBeLessThan(0.3)
    expect(neighbour.lift).toBeGreaterThan(gentle + 0.5)
  })
})

describe('the pick takes strain', () => {
  it('a gentle hand never bends it; leaning on a jam breaks it', () => {
    const gentle = createLab({ kinds: std(3), seed: 6 })
    solve(gentle, { tension: 0.2, maxTicks: 4000 })
    expect(gentle.pickBent).toBe(false)

    const forced = createLab({ kinds: ['spool'], seed: 2 })
    const c = forced.chambers[0]!
    for (let t = 0; t < 6000 && !forced.pickBroken; t += 1) {
      step(forced, { toolX: c.def.boreX, toolLift: hookLiftFor(setLift(c) + 1.0), tension: 0.8 })
    }
    expect(forced.pickStrain).toBeGreaterThan(STRAIN_BENT)
    expect(forced.pickBent).toBe(true)
    expect(forced.pickBroken).toBe(true)
  })
})

/**
 * The wrench is pushed back — the thing a picker actually feels on a spool.
 *
 * *"A pin that has a spool will want to force the tension wrench and the cylinder to go
 * counterclockwise. As it starts to push against the direction you're pushing, you very lightly let
 * up and let it push back, while keeping enough tension as to not drop all the pins."*
 *
 * Every assertion below is about a torque on the **plug**, never a shove on the pin — the difference
 * between this and the `COUNTER_GAIN` that had to be removed for buzzing.
 */
describe('a spool turns the wrench back', () => {
  /** Hold a chamber at its set point and report what the lock does about it. */
  function press(lab: LabState, index: number, tension: number, ticks: number): void {
    const c = lab.chambers[index]!
    const aim = hookLiftFor(setLift(c) + 0.1)
    for (let t = 0; t < ticks; t += 1) step(lab, { toolX: c.def.boreX, toolLift: aim, tension })
  }

  it('a standard pin pushes back not at all — the effect belongs to the silhouette', () => {
    // A standard driver is the same width all the way up, so at its own bind angle there is no
    // shoulder overhanging the plug's bore edge and nothing to cam on. Nothing in the model names a
    // pin type; this is the geometry declining to produce the behaviour.
    for (const tension of [0.14, 0.3, 0.55]) {
      const lab = createLab({ kinds: ['standard', 'standard'], seed: 7 })
      let peak = 0
      for (let t = 0; t < 600; t += 1) {
        const c = lab.chambers[0]!
        step(lab, { toolX: c.def.boreX, toolLift: hookLiftFor(setLift(c) + 0.1), tension })
        peak = Math.max(peak, lab.counterTorque)
      }
      expect(peak, `standard @T=${tension}`).toBe(0)
    }
  })

  it('a spool at a false set does, hard enough to matter', () => {
    const lab = createLab({ kinds: ['spool'], seed: 7 })
    let peak = 0
    for (let t = 0; t < 600; t += 1) {
      const c = lab.chambers[0]!
      step(lab, { toolX: c.def.boreX, toolLift: hookLiftFor(setLift(c) + 0.1), tension: 0.4 })
      peak = Math.max(peak, lab.counterTorque)
    }
    // Enough to overpower a heavy wrench — which is what makes easing the only way through.
    expect(peak).toBeGreaterThan(0.4)
  })

  it('holding hard walls it; easing lets it push back and the pin walks up', () => {
    // The same lock, the same hand, two tensions. This *is* the technique, and the gap between the
    // two numbers is the room a player has to work in.
    const hard = createLab({ kinds: ['spool'], seed: 7 })
    press(hard, 0, 0.55, 1200)
    expect(hard.chambers[0]!.caught, 'held hard: walled at the false set').toBe(false)

    const eased = createLab({ kinds: ['spool'], seed: 7 })
    press(eased, 0, 0.3, 1200)
    expect(eased.chambers[0]!.caught, 'eased: the spool walks up and sets').toBe(true)
  })

  it('drives the plug backwards, and lets go of it again as the shoulder clears', () => {
    const lab = createLab({ kinds: ['spool'], seed: 7 })
    const c = lab.chambers[0]!
    const aim = hookLiftFor(setLift(c) + 0.1)
    // Wind it into the false set on a heavy wrench, and note how far the plug got.
    for (let t = 0; t < 300; t += 1) step(lab, { toolX: c.def.boreX, toolLift: aim, tension: 0.55 })
    const walled = lab.theta
    expect(lab.counterTorque, 'the wrench is being pushed back').toBeGreaterThan(0.4)

    // Now let up, and watch the whole technique happen in a handful of ticks: the cam out-torques
    // the wrench, the plug — and your hand — is turned back, and the pin climbs as it goes.
    const lifted = c.lift
    let lowest = walled
    for (let t = 0; t < 40; t += 1) {
      step(lab, { toolX: c.def.boreX, toolLift: aim, tension: 0.18 })
      lowest = Math.min(lowest, lab.theta)
    }
    expect(lowest, 'the plug is driven back').toBeLessThan(walled - 0.02)
    expect(c.lift, 'and the pin walks up while it does').toBeGreaterThan(lifted + 0.2)

    // It is not a ratchet: past the shoulder the lock stops fighting altogether and the pin sets.
    for (let t = 0; t < 1200; t += 1) step(lab, { toolX: c.def.boreX, toolLift: aim, tension: 0.3 })
    expect(c.caught).toBe(true)
    expect(lab.counterTorque).toBe(0)
  })
})

/**
 * A key pin cannot be pushed into a shell bore that has moved.
 *
 * Reported from play: *"you can not overset all the pins — sometimes some of them will never
 * [overset]. And if one is [overset], you can not overset others."* Both halves are one comparison
 * of widths, and it costs the model no new constant.
 */
describe('overset is a race against the plug, not a free action', () => {
  const HEAVE = 4 // mm past the set point — a hand with no manners at all

  it('the pin holding the plug back can be overset; it is the one at the jam fit', () => {
    // A lone chamber is its own limiter, so its key pin is exactly as wide as the driver being
    // pinched: a jam fit, passable against friction. Heave on it and it goes across.
    const lab = createLab({ kinds: ['standard'], seed: 5 })
    const c = lab.chambers[0]!
    for (let t = 0; t < 600; t += 1) {
      step(lab, { toolX: c.def.boreX, toolLift: hookLiftFor(setLift(c) + HEAVE), tension: 0.6 })
    }
    expect(c.overset).toBe(true)
  })

  it('a pin behind a false set cannot be overset at all — it stops dead at the line', () => {
    // The reported rule, in the case where it bites: something else is holding the plug turned
    // *wider* than this chamber's own clearance, so its key pin meets the shell's bore edge instead
    // of the shell's bore. Set a pin, wall a spool at its false set, then heave the set pin with
    // everything: it does not go across, it does not even come loose — you just bend your pick.
    const lab = createLab({ kinds: ['standard', 'spool'], seed: 7 })
    const st = lab.chambers[0]!
    const sp = lab.chambers[1]!
    for (let t = 0; t < 400; t += 1) {
      step(lab, { toolX: st.def.boreX, toolLift: hookLiftFor(setLift(st) + 0.1), tension: 0.4 })
    }
    expect(st.caught).toBe(true)
    for (let t = 0; t < 400; t += 1) {
      step(lab, { toolX: sp.def.boreX, toolLift: hookLiftFor(setLift(sp) + 0.1), tension: 0.55 })
    }
    expect(lab.counterTorque, 'the spool is walled at a false set').toBeGreaterThan(0.4)
    const turned = lab.theta

    for (let t = 0; t < 400; t += 1) {
      step(lab, { toolX: st.def.boreX, toolLift: hookLiftFor(setLift(st) + HEAVE), tension: 0.55 })
    }
    expect(st.overset, 'heaved on with everything and it will not go across').toBe(false)
    expect(st.lift, 'it stops at the shear line, where the shell bore has moved on').toBeLessThanOrEqual(
      setLift(st) + 1e-6,
    )
    expect(lab.theta, 'and the plug does not budge for it either').toBeCloseTo(turned, 3)
    // A pin the lock will not move is the stiffest thing in it, so all of that went into the tool.
    expect(lab.pickBroken, 'the pick is what gives').toBe(true)
  })

  it('a lock cannot be opened with a pin overset, however long you work it', () => {
    // The jam: an overset key pin spans the shear line, so it can never be *caught*, and the plug
    // can never come round. Only dropping tension clears it.
    const lab = createLab({ kinds: ['standard', 'standard', 'standard'], seed: 11 })
    step(lab, IDLE(0.5))
    const victim = lab.chambers[lab.binding]!
    for (let t = 0; t < 400; t += 1) {
      step(lab, { toolX: victim.def.boreX, toolLift: hookLiftFor(setLift(victim) + HEAVE), tension: 0.5 })
    }
    expect(victim.overset).toBe(true)
    solve(lab, { tension: 0.5, maxTicks: 6000 })
    expect(lab.opened).toBe(false)
    // Let go and it clears, exactly as it always did.
    for (let t = 0; t < 400; t += 1) step(lab, IDLE(0))
    expect(lab.chambers.some((c) => c.overset)).toBe(false)
  })
})

/**
 * A chamber has a ceiling, and nothing is ever driven out through the top of the lock.
 *
 * Reported from play: *"I can push the pin so far, that [the driver] pin will go out from the hull."*
 * It was true — a flat 2.2mm of overset put a 4.5mm driver's head at 6.7mm in a 6.1mm chamber. The
 * room is derived from the pin in the hole now, so a long driver has less of it than a short one.
 */
describe('the shell chamber has a ceiling', () => {
  it('no driver can be pushed past the top of its own chamber, at any tension', () => {
    for (const tension of [0.1, 0.35, 0.6]) {
      const lab = createLab({ kinds: ['standard', 'spool', 'serrated', 'mushroom'], seed: 5 })
      let highest = -Infinity
      for (const c of lab.chambers) {
        for (let t = 0; t < 400; t += 1) {
          step(lab, { toolX: c.def.boreX, toolLift: hookLiftFor(setLift(c) + 6), tension })
        }
        for (const k of lab.chambers) {
          highest = Math.max(highest, FLOOR_Y + k.def.keyLen + k.lift + k.def.driverLen)
        }
      }
      // Its head, plus the spring it can never fully flatten, is the whole depth of the chamber.
      expect(highest, `T=${tension}`).toBeLessThanOrEqual(SHELL_CHAMBER_TOP - SPRING_SOLID + 1e-6)
    }
  })
})

/**
 * The key pin falls away from a driver the lock is holding.
 *
 * Reported from play: *"if you set the pin, the key pin then does not fall down."* A key pin does not
 * hang from the driver, it holds it up — so the moment the plug's ledge takes the driver, the key pin
 * has nothing beneath it but the tool, and where the tool is not it lands on the bottom of the keyway.
 * The gap that leaves is the clearest tell in the picture that a pin is set.
 */
describe('a set pin drops its key pin', () => {
  it('leaves a gap once the tool moves off, and closes it when the tool comes back', () => {
    const lab = createLab({ kinds: std(3), seed: 5 })
    solve(lab, { tension: 0.35 })
    expect(lab.chambers.every((c) => c.caught)).toBe(true)

    // Hold the wrench and take the tool right out of the lock.
    for (let t = 0; t < 300; t += 1) step(lab, IDLE(0.35))
    for (const c of lab.chambers) {
      expect(c.caught, `#${c.def.index} still set`).toBe(true)
      expect(c.keyLift, `#${c.def.index} key pin fell`).toBeLessThan(c.lift - 0.5)
      expect(c.keyLift).toBeCloseTo(0, 2) // all the way to the floor of the keyway
    }

    // Put the tool back under one of them and the key pin rides up to meet its driver again.
    const c0 = lab.chambers[0]!
    for (let t = 0; t < 200; t += 1) {
      step(lab, { toolX: c0.def.boreX, toolLift: hookLiftFor(setLift(c0)), tension: 0.35 })
    }
    expect(c0.keyLift).toBeCloseTo(c0.lift, 1)
    expect(lab.chambers[1]!.keyLift).toBeLessThan(lab.chambers[1]!.lift - 0.5)
  })

  it('never lets a key pin pass up through the driver above it', () => {
    const lab = createLab({ kinds: ['standard', 'spool'], seed: 7 })
    for (const c of lab.chambers) {
      for (let t = 0; t < 400; t += 1) {
        step(lab, { toolX: c.def.boreX, toolLift: hookLiftFor(setLift(c) + 4), tension: 0.45 })
        for (const k of lab.chambers) expect(k.keyLift).toBeLessThanOrEqual(k.lift + 1e-9)
      }
    }
  })
})

/**
 * A ledge you cannot hold is not a ledge you can catch on.
 *
 * Capture and retention used to ask different questions of the wrench, and the gap between them was a
 * trap: a pin captured, sat out its grace period under-tensioned, let go, fell for part of a tick, and
 * was re-captured before the tick ended — round and round, about nine times a second. Reported as
 * *"if I set tension level to 1, the set driver pins start to jump."*
 */
describe('a set pin is steady or it is gone — never both', () => {
  /** Set one pin at a working wrench, then dwell at `tension` with the tool out of the lock. */
  function dwell(tension: number): { reversals: number; caught: boolean } {
    const lab = createLab({ kinds: std(5), seed: 5 })
    const first = [...lab.chambers].sort((a, b) => a.def.clearance - b.def.clearance)[0]!
    for (let t = 0; t < 800 && !first.caught; t += 1) {
      const aim = Math.min(setLift(first) + 0.2, first.lift + 0.3)
      step(lab, { toolX: first.def.boreX, toolLift: hookLiftFor(aim), tension: 0.35 })
    }
    expect(first.caught).toBe(true)
    let reversals = 0
    let prev = first.lift
    let dir = 0
    for (let t = 0; t < 1200; t += 1) {
      step(lab, IDLE(tension))
      const d = Math.sign(first.lift - prev)
      if (d !== 0 && dir !== 0 && d !== dir) reversals += 1
      if (d !== 0) dir = d
      prev = first.lift
    }
    return { reversals, caught: first.caught }
  }

  it('does not jitter at any wrench pressure', () => {
    for (const tension of [0.14, 0.22, 0.3, 0.4, 0.55]) {
      expect(dwell(tension).reversals, `T=${tension}`).toBe(0)
    }
  })

  it('below the hold threshold it simply falls, once', () => {
    // The lightest step is under `T_SET_HOLD`, so it can hold a lock but never set one — and the pin
    // it cannot hold comes off cleanly instead of buzzing on the edge of coming off.
    expect(TENSIONS_LIGHTEST).toBeLessThan(T_SET_HOLD)
    expect(dwell(TENSIONS_LIGHTEST).caught).toBe(false)
    expect(dwell(0.22).caught).toBe(true)
  })

  it('will not capture a pin it has not the tension to keep', () => {
    const lab = createLab({ kinds: std(3), seed: 5 })
    for (let t = 0; t < 3000; t += 1) {
      const c = lab.chambers.filter((k) => !k.caught).sort((a, b) => a.def.clearance - b.def.clearance)[0]
      if (!c) break
      const aim = Math.min(setLift(c) + 0.2, c.lift + 0.3)
      step(lab, { toolX: c.def.boreX, toolLift: hookLiftFor(aim), tension: TENSIONS_LIGHTEST })
    }
    expect(lab.chambers.some((c) => c.caught), 'too light a wrench sets nothing').toBe(false)
  })
})

/**
 * Setting a pin has a real tolerance, not a pixel of one.
 *
 * *"There is a green area to where you need to lift the driver pin, but when you lift just a bit past
 * it the lock oversets instantly, which should not be true because there is a gap."* It was true: the
 * plug's ledge used to refuse a driver while the *hand* was reaching above the capture window, so with
 * a mouse the difference between a set and an overset was landing the pointer inside 0.22mm. The ledge
 * does not ask what your hand is doing; retention does, and it asks for a firm shove.
 */
describe('the set window has room in it', () => {
  /** Put the tool at a fixed height, the way a pointer does — no ramp — and see what happens. */
  function land(above: number): 'set' | 'overset' | 'neither' {
    const lab = createLab({ kinds: std(3), seed: 5 })
    const c = [...lab.chambers].sort((a, b) => a.def.clearance - b.def.clearance)[0]!
    for (let t = 0; t < 1200; t += 1) {
      step(lab, { toolX: c.def.boreX, toolLift: hookLiftFor(setLift(c) + above), tension: 0.35 })
    }
    return c.caught ? 'set' : c.overset ? 'overset' : 'neither'
  }

  it('sets anywhere from the shear line to a third of a millimetre past it', () => {
    for (const above of [-0.1, 0, 0.1, 0.2, 0.3]) {
      expect(land(above), `+${above}mm`).toBe('set')
    }
  })

  it('and oversets only for a shove that is meant', () => {
    for (const above of [0.5, 1.2, 3]) {
      expect(land(above), `+${above}mm`).toBe('overset')
    }
  })
})
