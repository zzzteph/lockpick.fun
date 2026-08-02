/**
 * Every scalar the simulation owns reaches the view — DECISIONS D-150.
 *
 * `Session.syncView` copies a **hand-written** list of fields from the live state onto the
 * interpolated one the renderer reads. Its own comment has warned since D-060 that a field added to
 * `SimState` and forgotten here is silently frozen at whatever it was cloned with, forever.
 *
 * It has now happened three times. `stats` (D-112) read as a fresh attempt for the whole of every
 * attempt, found because a banner refused to go away in a screenshot. `pickContact` (D-150) froze at
 * zero, so the HUD's state word said `push to feel` on every frame of every attempt and never once
 * said `binding`, `false set`, `set` or `overset` — found by an agent capturing store screenshots.
 * Both were invisible to the whole suite, because every test drives `state` and no test read `view`.
 *
 * A warning comment is not a mechanism. This is: drive a real attempt, then compare the two objects
 * field by field, so the next omission fails here instead of shipping.
 */

import { describe, expect, it } from 'vitest'
import { Session } from '../../src/game/session'
import { PERFECT_TOOLS } from '../../src/sim'
import { lockById } from '../../src/game/locks'

/**
 * Fields the view is *supposed* to differ on, with the reason it is allowed to.
 *
 * Kept deliberately short and named one by one. A blanket "ignore what does not match" would let the
 * next forgotten field hide in it, which is the whole failure being guarded against.
 */
const INTERPOLATED = new Set([
  // Eased between ticks for a smooth picture — the point of having a view at all.
  'theta',
  'resistance',
  // Per-frame render bookkeeping, not simulation truth.
  'events',
  'chambers',
])

function run(): { live: Record<string, unknown>; view: Record<string, unknown> } {
  const def = lockById(13)
  if (!def) throw new Error('lock 13 missing from the roster')
  const session = new Session(def, 7, {
    tools: PERFECT_TOOLS,
    assist: 'medium',
    featherEnabled: false,
  })
  // A real attempt: wrench on, a pin worked hard enough to build contact and strain.
  for (let i = 0; i < 400; i += 1) {
    session.advance(1 / 120, {
      chamber: 1,
      liftTarget: 2.0,
      tensionHeld: true,
      tensionLevel: 0.45,
    })
  }
  session.syncView(1)
  return {
    live: session.state as unknown as Record<string, unknown>,
    view: session.view as unknown as Record<string, unknown>,
  }
}

describe('the view the renderer reads is the state the simulation computed', () => {
  it('carries every scalar field across', () => {
    const { live, view } = run()
    const stale: string[] = []
    for (const key of Object.keys(live)) {
      if (INTERPOLATED.has(key)) continue
      const a = live[key]
      const b = view[key]
      if (typeof a === 'object' && a !== null) continue
      if (a !== b) stale.push(`${key}: state ${String(a)} but view ${String(b)}`)
    }
    expect(stale, `syncView never copies these, so the drawing cannot see them:\n  ${stale.join('\n  ')}`).toEqual(
      [],
    )
  })

  it('and pickContact specifically, because the HUD gates a whole readout on it', () => {
    /*
     * Named on its own as well as caught by the sweep above. This is the field whose absence made
     * the state word inert, and a regression here has a visible, reportable consequence rather than
     * an abstract one.
     */
    const { live, view } = run()
    expect(live['pickContact'], 'the attempt did not build any contact to test with').toBeGreaterThan(
      0,
    )
    expect(view['pickContact']).toBe(live['pickContact'])
  })
})
