/**
 * A combination wheel's detents — the dial's digits as angles (D-167). Its own file since D-235: the
 * lock model builds a pack's gates from it, the wheel engine snaps the turner to it.
 */

import { COMBO_DETENT, COMBO_DIGITS } from './constants'

/** Centre of a combination wheel's detent, in lift units — where digit `digit` parks. */
export function detentCentre(digit: number): number {
  return (digit + 0.5) * COMBO_DETENT
}

/**
 * Snap a commanded wheel angle to the nearest detent centre it is inside.
 *
 * `floor`, not `round`: a detent is a *slot* the wheel drops into, so the whole span of one
 * digit maps to that digit's centre. The top edge of the travel belongs to the last digit —
 * without the clamp, a command at exactly `DISC_TRAVEL` would invent an eleventh detent.
 */
export function quantizeDetent(lift: number): number {
  const digit = Math.min(COMBO_DIGITS - 1, Math.max(0, Math.floor(lift / COMBO_DETENT)))
  return detentCentre(digit)
}
