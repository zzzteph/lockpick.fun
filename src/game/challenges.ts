/**
 * Challenge modifiers and assist multipliers — `GAME_DESIGN.md §4` and `§6`.
 *
 * Assist mode is one multiplier and the opt-in challenges are another; they stack
 * multiplicatively. Expert and Blind appear in both lists in the spec, which would double-count
 * them, so they are counted once, as assist modes. See DECISIONS D-024.
 */

import type { AssistMode } from './save'

/**
 * What each level pays, from `GAME_DESIGN.md §4`. The numbers are unchanged from the old
 * four modes; only the names and what they take away have moved (D-046).
 */
/**
 * The assist ladder's payoff moved to `ranks.ts` as `ASSIST_PAR_SCALE` (D-091).
 *
 * Same four numbers. They used to multiply a credit payout, which stopped meaning anything when the
 * shop went; they now multiply the *par* an attempt is ranked against, which is the thing a harder
 * mode actually costs you. Re-exported here so the settings screen still has one import for
 * everything it says about the ladder.
 */
export { ASSIST_PAR_SCALE as ASSIST_MULTIPLIER } from './ranks'

/** In ladder order, for the settings control and for tests that walk both. */
export const ASSIST_MODES: readonly AssistMode[] = ['training', 'normal']

/** What each level actually takes away, for the settings screen to say out loud. */
// Two rungs since D-218 ("only two of them"): Training shows the coloured x-ray, Normal shows the
// same geometry with the colour narration off. The pins stay drawn on both — the owner never
// wanted the picture taken away, only the colours that name each pin's state.
export const ASSIST_BLURB: Record<AssistMode, string> = {
  training: 'Everything visible: pin types, the binding pin, the target window.',
  normal: 'Every pin, honestly drawn — but no state colours, no state word. The lock stops narrating.',
}

export interface ChallengeDef {
  readonly id: string
  readonly name: string
  readonly blurb: string
  readonly multiplier: number
}

export const CHALLENGES: readonly ChallengeDef[] = [
  {
    id: 'no-resets',
    name: 'No resets',
    blurb: 'Lose tension once and the run is void.',
    multiplier: 1.5,
  },
  {
    id: 'under-par',
    name: 'Under par',
    blurb: "Open it inside the lock's par time.",
    multiplier: 1.4,
  },
  {
    // Replaced "one tool only" when the inventory went (D-088). Same multiplier, same shape of
    // promise — a restriction you take on yourself — but one that is about how you pick rather
    // than about what you own.
    id: 'no-oversets',
    name: 'No oversets',
    blurb: 'Open it without jamming a single pin.',
    multiplier: 1.3,
  },
]

const BY_ID = new Map<string, ChallengeDef>(CHALLENGES.map((c) => [c.id, c]))

export function challengeById(id: string): ChallengeDef | undefined {
  return BY_ID.get(id)
}

export interface AttemptFacts {
  readonly seconds: number
  readonly par: number
  readonly resets: number
  readonly oversets: number
}

/** Did the attempt actually satisfy a challenge it opted into? */
export function challengeMet(id: string, facts: AttemptFacts): boolean {
  switch (id) {
    case 'no-resets':
      return facts.resets === 0
    case 'under-par':
      return facts.seconds < facts.par
    case 'no-oversets':
      return facts.oversets === 0
    default:
      return false
  }
}

/**
 * Which opted-in challenges the attempt actually satisfied.
 *
 * A challenge that was taken on and not met does not void the open — it simply does not get
 * recorded. That was true when they paid a multiplier and it is true now that they pay a **badge**:
 * since D-091 a met challenge is written to the lock's record and shown on its bench card, and the
 * *Cracked It* achievement asks for every one of them at least once. Unknown ids are dropped, which
 * is what lets a challenge be renamed without stranding an old save.
 */
export function challengesMet(opted: readonly string[], facts: AttemptFacts): string[] {
  return opted.filter((id) => challengeById(id) !== undefined && challengeMet(id, facts))
}
