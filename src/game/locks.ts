/**
 * The lock roster — `CONTENT.md §1`.
 *
 * Locks are data. **Adding one means touching this file and nothing else.** Every definition
 * is validated at module load, so a malformed bitting throws before anything can run: the
 * dev server refuses to boot and `npm run verify` fails with a message naming the lock and
 * the chamber. That is the "an invalid lock definition fails the build" requirement.
 *
 * Bitting rules the validator enforces, worth knowing while authoring:
 *  - `0 < K < 5.0` and `K + 4.5 > 5.0` — the stack has to straddle the shear line.
 *  - A security-pin chamber needs a cut deep enough for its groove to reach the shear line:
 *    spool `K ≤ 3.45`, mushroom `K ≤ 3.35`, serrated `K ≤ 3.22`, T-pin `K ≤ 3.20`.
 */

import { type LockDef, validateLockDef } from '../sim'

const ROSTER: LockDef[] = [

  // ── Tier 1 — Practice ─────────────────────────────────────────────────────────────────
  {
    id: 1,
    slug: 'clear-practice-cutaway',
    name: 'Clear Practice Cutaway',
    tier: 1,
    family: 'pin-tumbler',
    bitting: [3.2, 4.0],
    pins: ['standard', 'standard'],
    toleranceQuality: 1.4,
    keyway: 'standard',
    par: 20,
    note: 'Two pins, generous tolerances, nothing hidden. Start here.',
  },
  {
    id: 2,
    slug: 'clear-practice-cutaway-ii',
    name: 'Clear Practice Cutaway II',
    tier: 1,
    family: 'pin-tumbler',
    bitting: [3.4, 2.9, 4.1],
    pins: ['standard', 'standard', 'standard'],
    toleranceQuality: 1.35,
    keyway: 'standard',
    par: 30,
    note: 'A third chamber, and a deeper cut to reach.',
  },
  {
    id: 3,
    slug: 'brasswell-no1-luggage',
    name: 'Brasswell No.1 Luggage',
    tier: 1,
    family: 'pin-tumbler',
    bitting: [2.8, 3.9, 3.3],
    pins: ['standard', 'standard', 'standard'],
    toleranceQuality: 1.3,
    keyway: 'standard',
    par: 35,
    note: 'The lock on every suitcase ever made. It is not trying very hard.',
  },
  {
    id: 5,
    slug: 'brasswell-bike-padlock',
    name: 'Brasswell Bike Padlock',
    tier: 1,
    family: 'pin-tumbler',
    bitting: [3.1, 4.2, 2.7, 3.6],
    pins: ['standard', 'standard', 'standard', 'standard'],
    toleranceQuality: 1.25,
    keyway: 'standard',
    par: 45,
    note: 'Four chambers and a wide bitting spread. Rakes beautifully.',
  },
  {
    id: 6,
    slug: 'northgate-shed-padlock',
    name: 'Northgate Shed Padlock',
    tier: 1,
    family: 'pin-tumbler',
    bitting: [4.0, 2.9, 3.5, 3.1],
    pins: ['standard', 'standard', 'standard', 'standard'],
    toleranceQuality: 1.2,
    keyway: 'standard',
    par: 50,
    note: 'Tighter than it looks. The first lock that will punish a heavy hand.',
  },
  {
    /**
     * The first combination lock, and the reason the family starts in Tier 1: everyone has
     * held one. Three wheels, honest gates on the digit grid (code 4-1-7 → 1.35, 0.45, 2.25),
     * no false gates — Tier 1 carries no security features, wheels included. The decode is
     * the whole lesson: pull the shackle, find the wheel that drags, dial it until the drag
     * moves on.
     */
    id: 39,
    slug: 'brasswell-3-wheel-luggage',
    name: 'Brasswell 3-Wheel Luggage',
    tier: 1,
    family: 'combination',
    bitting: [3, 3, 3],
    pins: ['standard', 'standard', 'standard'],
    discs: {
      trueGates: [1.35, 0.45, 2.25],
      falseGates: [[], [], []],
      gateWidth: 0.15,
    },
    toleranceQuality: 1.2,
    keyway: 'standard',
    par: 55,
    note: 'Every suitcase you have ever owned. Pull the shackle and read the wheels with your thumb.',
  },

  // ── Tier 2 — Standard cylinders ───────────────────────────────────────────────────────
  {
    id: 9,
    slug: 'northgate-5-pin-cabinet',
    name: 'Northgate 5-Pin Cabinet',
    tier: 2,
    family: 'pin-tumbler',
    bitting: [3.5, 2.8, 4.1, 3.2, 3.7],
    pins: ['standard', 'standard', 'standard', 'standard', 'standard'],
    toleranceQuality: 1.15,
    keyway: 'standard',
    par: 60,
    note: 'Five chambers. You will need a hook that reaches all of them.',
  },
  {
    id: 10,
    slug: 'kestrel-door-cylinder',
    name: 'Kestrel Door Cylinder',
    tier: 2,
    family: 'pin-tumbler',
    bitting: [2.9, 3.8, 3.3, 4.2, 3.0],
    pins: ['standard', 'standard', 'standard', 'standard', 'standard'],
    toleranceQuality: 1.05,
    keyway: 'standard',
    par: 70,
    note: 'The lock on a million front doors, and no harder than one.',
  },
  {
    id: 11,
    slug: 'ironhold-laminated-pad',
    name: 'Ironhold Laminated Pad',
    tier: 2,
    family: 'pin-tumbler',
    bitting: [3.6, 3.1, 4.0, 2.8, 3.4],
    pins: ['standard', 'standard', 'standard', 'serrated', 'standard'],
    toleranceQuality: 1.05,
    keyway: 'standard',
    par: 80,
    note: 'One serrated pin, hiding among four honest ones. Which one is it?',
  },
  {
    id: 13,
    slug: 'ironhold-spool-trainer',
    name: 'Ironhold Spool Trainer',
    tier: 2,
    family: 'pin-tumbler',
    bitting: [3.6, 3.2, 2.9, 4.0],
    pins: ['standard', 'spool', 'spool', 'standard'],
    toleranceQuality: 1.0,
    keyway: 'standard',
    par: 90,
    note: 'Two spools, nothing else. Made for learning what a false set feels like.',
  },
  {
    id: 14,
    slug: 'kestrel-serrated-trainer',
    name: 'Kestrel Serrated Trainer',
    tier: 2,
    family: 'pin-tumbler',
    bitting: [3.0, 2.8, 3.1, 3.8],
    pins: ['serrated', 'serrated', 'serrated', 'standard'],
    toleranceQuality: 1.0,
    keyway: 'standard',
    par: 100,
    note: 'Every one of these pins will lie to you four times on the way up.',
  },

  // ── Tier 3 — Security pins ────────────────────────────────────────────────────────────
  {
    id: 15,
    slug: 'northgate-commercial',
    name: 'Northgate Commercial',
    tier: 3,
    family: 'pin-tumbler',
    bitting: [3.4, 2.9, 3.1, 3.7, 4.0],
    // Chamber 2 is a *slim* spool (D-079): a 0.45mm waist against the 0.95mm one beside it, so the
    // two lie for very different lengths of time. First place in the roster the difference shows.
    pins: ['spool', 'spool-slim', 'serrated', 'standard', 'standard'],
    toleranceQuality: 0.95,
    keyway: 'standard',
    par: 110,
    note: 'Two spools and a serrated. The first lock that really needs a plan.',
  },
  {
    id: 16,
    slug: 'halberd-deadbolt',
    name: 'Halberd Deadbolt',
    tier: 3,
    family: 'pin-tumbler',
    bitting: [3.4, 2.9, 3.2, 3.9, 3.0],
    // The middle one is a deep spool: a 1.2mm waist with almost no bevel, so it gives a long way
    // and cams against nothing. It wants the wrench eased right off (D-077, D-079).
    pins: ['spool', 'standard', 'spool-deep', 'standard', 'spool'],
    toleranceQuality: 0.9,
    keyway: 'standard',
    par: 120,
    note: 'Three spools. Back the tension off or it will fight you all day.',
  },
  {
    id: 17,
    slug: 'ironhold-mushroom-pad',
    name: 'Ironhold Mushroom Pad',
    tier: 3,
    family: 'pin-tumbler',
    bitting: [3.3, 3.0, 3.7, 2.8, 3.1],
    pins: ['mushroom', 'spool', 'standard', 'mushroom', 'standard'],
    toleranceQuality: 0.88,
    keyway: 'standard',
    par: 130,
    note: 'Mushrooms shove harder than spools. A light hand is the only hand.',
  },
  {
    id: 18,
    slug: 'kestrel-pro-cylinder',
    name: 'Kestrel Pro Cylinder',
    tier: 3,
    family: 'pin-tumbler',
    bitting: [3.3, 3.0, 2.8, 3.4, 3.1, 4.1],
    pins: ['spool', 'serrated', 'serrated', 'spool', 'spool', 'standard'],
    toleranceQuality: 0.85,
    keyway: 'standard',
    par: 150,
    note: 'Six chambers, five of them lying. The end of Tier 3, and it knows it.',
  },
  {
    id: 19,
    slug: 'halberd-tight-tolerance-5',
    name: 'Halberd Tight-Tolerance 5',
    tier: 3,
    family: 'pin-tumbler',
    bitting: [3.3, 3.05, 3.4, 3.15, 4.0],
    // T-pins were here, and they were the one profile in the game that did not look like
    // something you would find in a lock: a very deep waist with a square shoulder. Replaced with
    // the two traditional security pins the roster was thinnest on. See DECISIONS D-063.
    pins: ['spool', 'mushroom', 'spool', 'serrated', 'standard'],
    toleranceQuality: 0.8,
    keyway: 'standard',
    par: 150,
    note: 'Two spools, a mushroom and a serrated. Four false sets on one of them, and a wall.',
  },

  {
    /**
     * A whole lock of slim spools.
     *
     * Every waist is 0.45mm, so every false set is *brief*: the plug gives, and gives back almost
     * at once. The lesson is the opposite of the deep spool's — here you can walk straight past the
     * lie if you are moving, and the mistake is being too careful rather than too heavy.
     */
    id: 37,
    slug: 'kestrel-slimline-5',
    name: 'Kestrel Slimline 5',
    tier: 3,
    family: 'pin-tumbler',
    bitting: [3.3, 2.8, 3.6, 3.1, 3.45],
    pins: ['spool-slim', 'spool-slim', 'standard', 'spool-slim', 'standard'],
    toleranceQuality: 0.86,
    keyway: 'standard',
    par: 130,
    note: 'Three slim spools. Every lie is a short one — keep moving.',
  },
  {
    /**
     * Four wheels (code 2-8-5-3) and one false gate on each — the spool's lie in wheel form:
     * a notch that takes the fence partway, drags like the truth, and holds the shackle shut.
     * The false digits (6, 1, 9, 7) sit well away from the code, so walking the dial finds the
     * lie before the truth about half the time, which is the tier's whole curriculum.
     */
    id: 40,
    slug: 'ironhold-combination-chain',
    name: 'Ironhold Combination Chain',
    tier: 3,
    family: 'combination',
    bitting: [3, 3, 3, 3],
    pins: ['standard', 'standard', 'standard', 'standard'],
    discs: {
      trueGates: [0.75, 2.55, 1.65, 1.05],
      falseGates: [[1.95], [0.45], [2.85], [2.25]],
      gateWidth: 0.12,
    },
    toleranceQuality: 0.85,
    keyway: 'standard',
    par: 135,
    note: 'Four wheels, and one digit on each that feels right and is not.',
  },

  // ── Tier 4 — High security ────────────────────────────────────────────────────────────
  {
    id: 20,
    slug: 'meridian-euro-profile',
    name: 'Meridian Euro Profile',
    tier: 4,
    family: 'pin-tumbler',
    // Chamber 2 is cut a touch shallower than it was (2.95 -> 2.90) to make room for a
    // double-spool's second waist — the groove has to clear the shear line or it cannot lie at all,
    // which is exactly what `maxDepthFor` enforces in the editor.
    bitting: [3.2, 3.5, 2.9, 3.35, 3.1, 4.0],
    // A double spool lies, lets you push through, and lies again at the same scale. It reads
    // like a serrated pin's pattern at a spool's size, which is a genuinely different job (D-079).
    pins: ['spool', 'standard', 'spool-double', 'mushroom', 'spool', 'standard'],
    toleranceQuality: 0.75,
    keyway: 'standard',
    par: 170,
    note: 'The cylinder on half the front doors in Europe. Three spools and a mushroom.',
  },
  {
    id: 22,
    slug: 'halberd-anti-bump-6',
    name: 'Halberd Anti-Bump 6',
    tier: 4,
    family: 'pin-tumbler',
    bitting: [3.15, 3.2, 2.9, 3.05, 3.3, 3.4],
    // Two t-pins among the serrated ones. A t-pin has the highest measured tension wall in the
    // game (T≈0.65, D-053) — square shoulders, so it catches and holds where a mushroom shoves
    // back; the pin that actually punishes a heavy hand hardest is the mushroom (wall ≈0.29).
    // The old version of this comment drew the opposite conclusion from the same number, and a
    // store-copy fact-check caught the sentence it seeded. Until now no roster lock carried one.
    pins: ['t-pin', 'serrated', 'serrated', 't-pin', 'spool', 'spool'],
    toleranceQuality: 0.72,
    keyway: 'standard',
    par: 190,
    note: 'Four serrated and two spools. Twenty false sets on the way up, give or take.',
  },
  {
    id: 27,
    slug: 'halberd-sidebar-cylinder',
    name: 'Halberd Sidebar Cylinder',
    tier: 4,
    family: 'pin-tumbler',
    bitting: [3.3, 3.6, 3.05, 3.1, 3.4, 4.0],
    pins: ['spool', 'standard', 'spool', 'standard', 'spool', 'standard'],
    sidebar: { gatedChambers: [0, 2, 4], gateWidth: 0.09, gatePositions: [0.35, 0.6, 0.45] },
    toleranceQuality: 0.58,
    keyway: 'standard',
    par: 230,
    note: 'Three chambers carry a sidebar gate. Set them wrong and the plug simply will not turn.',
  },
  {
    id: 31,
    slug: 'halberd-sovereign',
    name: 'Halberd Sovereign',
    tier: 4,
    family: 'pin-tumbler',
    bitting: [3.2, 3.05, 3.4, 3.1, 3.35, 2.95, 3.25],
    pins: ['spool', 'mushroom', 'spool', 'spool', 'mushroom', 'spool', 'spool'],
    toleranceQuality: 0.5,
    keyway: 'tight',
    par: 360,
    note: 'Seven chambers, every one of them a security pin, in a keyway that fits nothing.',
  },
  {
    id: 34,
    slug: 'halberd-magnetic-hybrid',
    name: 'Halberd Magnetic Hybrid',
    tier: 4,
    family: 'pin-tumbler',
    // The magnets are on the two serrated chambers, so the pins a rake would help you with
    // most are exactly the ones it cannot touch.
    bitting: [3.15, 3.1, 3.0, 3.05, 2.9, 3.3],
    pins: ['spool', 'serrated', 'mushroom', 'serrated', 'spool', 'spool'],
    magneticChambers: [1, 3],
    toleranceQuality: 0.46,
    keyway: 'standard',
    par: 400,
    note: 'Two of these six are held by magnets. A rake passes straight under them.',
  },

  {
    /**
     * The pin-shape showpiece: every security profile the simulation has, in one cylinder.
     *
     * Two t-pins for the wall, a deep spool for the long lie, a double for the lie-twice, and a
     * mushroom to round it off. It exists so that a player who has learned to *read* a security
     * pin has somewhere to prove it, and so that no profile in `PROFILES` is unreachable without
     * opening the editor.
     */
    id: 38,
    slug: 'halberd-t-bar-6',
    name: 'Halberd T-Bar 6',
    tier: 4,
    family: 'pin-tumbler',
    bitting: [3.1, 2.85, 3.15, 2.9, 3.3, 3.5],
    pins: ['t-pin', 'spool-deep', 't-pin', 'spool-double', 'mushroom', 'standard'],
    toleranceQuality: 0.6,
    keyway: 'tight',
    par: 210,
    note: 'One of everything the trade ever put in a chamber.',
  },
  {
    /**
     * The family's showpiece: four wheels (code 7-2-9-4), *three* false gates on every one —
     * twelve lies against four truths, on a 0.09 gate the width of a held breath. The Protec
     * fixture's spirit at padlock scale: most detents on the dial do something, and only the
     * drag under the pull says which something you found.
     */
    id: 41,
    slug: 'meridian-strongbox-wheels',
    name: 'Meridian Strongbox Wheels',
    tier: 4,
    family: 'combination',
    bitting: [3, 3, 3, 3],
    pins: ['standard', 'standard', 'standard', 'standard'],
    discs: {
      trueGates: [2.25, 0.75, 2.85, 1.35],
      falseGates: [
        [0.15, 1.35, 2.55],
        [1.65, 2.55, 0.15],
        [0.45, 1.65, 2.25],
        [0.15, 1.95, 2.85],
      ],
      gateWidth: 0.09,
    },
    toleranceQuality: 0.6,
    keyway: 'standard',
    par: 240,
    note: 'Twelve false gates across four wheels. Every third digit is a lie with good manners.',
  },
]

for (const def of ROSTER) validateLockDef(def)

const BY_ID = new Map<number, LockDef>(ROSTER.map((d) => [d.id, d]))
const BY_SLUG = new Map<string, LockDef>(ROSTER.map((d) => [d.slug, d]))

export const ALL_LOCKS: readonly LockDef[] = ROSTER

/**
 * Locks from `CONTENT.md §1` not yet authored, and why. Kept here rather than in a comment
 * so the gap is visible to code as well as to readers — the roster test asserts that every
 * id in `CONTENT.md` is either present above or listed here.
 */
export const DEFERRED_LOCKS: readonly { id: number; name: string; reason: string }[] = [
  /**
   * The three disc detainers, cut together.
   *
   * Reported from play as *"remove all disc detainer locks — I don't know how it works"*, and that
   * report is the whole reason. A disc detainer is the one family in the game that is a genuinely
   * different machine: no springs, no binding order, and an angle to find rather than a height to
   * reach. Every other lock teaches the next one; these three taught nothing and were taught
   * nothing, sitting behind Tier 4 as an unexplained final tier. A family the game never teaches is
   * a family the game should not ship, and the honest fix is to cut it rather than to bolt a
   * fourth lesson onto the tutorial for three locks.
   *
   * The **simulation is untouched** — discs, false gates, the sidebar and the face-on view are all
   * still modelled and still tested, from fixtures, exactly as the wafers and tubulars have been
   * since D-088. Nothing here would have to be rebuilt to bring them back; the roster entries
   * below are the only thing that was removed.
   */
  {
    id: 25,
    name: 'Vantage Disc Detainer 6',
    reason:
      'CUT from the roster, kept in the simulation. A disc detainer asks the player to find an ' +
      'angle with no spring to return it and no binding order to follow, which shares almost ' +
      'nothing with the four tiers before it — and the game never taught it. See DECISIONS D-104.',
  },
  {
    id: 28,
    name: 'Vantage Disc Detainer 10',
    reason: 'CUT with the rest of the disc detainers. See DECISIONS D-104.',
  },
  {
    id: 32,
    name: 'Vantage Protec Disc',
    reason: 'CUT with the rest of the disc detainers. See DECISIONS D-104.',
  },
  {
    id: 36,
    name: 'The Bench Safe',
    reason:
      'CUT. `CONTENT.md §1` names it as the correct thing to cut and `SIMULATION.md §10` says ' +
      'it "shares almost no code with the rest of the game" — it is manipulation, not picking: ' +
      'three wheels, a drive cam, and reading contact-area drop points. Building it would mean ' +
      'a second simulation, a second input scheme and a second renderer for one lock, at the ' +
      'cost of the polish pass the other thirty-five need. Cut deliberately, not run out of. ' +
      'See PROGRESS.md Phase 13 and DECISIONS D-035.',
  },
]

export function lockById(id: number): LockDef | undefined {
  return BY_ID.get(id)
}

export function lockBySlug(slug: string): LockDef | undefined {
  return BY_SLUG.get(slug)
}

/** Resolve by numeric id or slug — what the dev hook and the bench both want. */
export function findLock(key: number | string): LockDef | undefined {
  return typeof key === 'number' ? lockById(key) : (lockBySlug(key) ?? lockById(Number(key)))
}

export function locksInTier(tier: number): readonly LockDef[] {
  return ROSTER.filter((d) => d.tier === tier)
}

/** Chambers this lock has — how much pick reach it needs. */
export function chambersOf(def: LockDef): number {
  return def.bitting.length
}
