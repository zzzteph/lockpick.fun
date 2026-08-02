/**
 * A chamber has to hold what goes in it — DECISIONS D-144.
 *
 * The shell chamber was a flat 5.9mm while a driver at full overlift needs 6.5mm and its spring
 * needs half a millimetre more. So every chamber in the game drew its driver out through the top of
 * its own bore once a pin was pushed that far, and the spring above it inverted. Reported as *"the
 * pin will jump out of the shell for a second"*.
 *
 * Nothing caught it because nothing related the chamber's depth to the parts inside it. That
 * relationship is the test.
 */

import { describe, expect, it } from 'vitest'
import { DRIVER_LENGTH, MAX_OVERLIFT, createSimState, PERFECT_TOOLS } from '../../src/sim'
import { ALL_LOCKS } from '../../src/game/locks'
import {
  PLUG_BOTTOM_MM,
  SHELL_CHAMBER_TOP_MM,
  SHELL_TOP_MM,
  SHEAR_Y,
  MM_TO_PX,
  SPRING_SOLID_MM,
  computeLayout,
  driverPinRect,
  mmToY,
  springSpan,
} from '../../src/render/layout'

describe('the shell chamber holds a fully overlifted stack', () => {
  it('is deep enough for the driver and its compressed spring', () => {
    expect(SHELL_CHAMBER_TOP_MM).toBeGreaterThanOrEqual(
      MAX_OVERLIFT + DRIVER_LENGTH + SPRING_SOLID_MM,
    )
  })

  it('keeps brass above the bore, so the shell is a shell', () => {
    expect(SHELL_TOP_MM).toBeGreaterThan(SHELL_CHAMBER_TOP_MM)
  })

  it('never draws a driver through the top of its own bore, in any lock', () => {
    /*
     * Every chamber of every lock in the roster, shoved to the top of its range. `maxLift` is the
     * furthest the simulation will ever put one, so this is the true worst case rather than a
     * sample of it.
     */
    const chamberTop = mmToY(computeLayout(5, 0), SHELL_CHAMBER_TOP_MM)
    for (const def of ALL_LOCKS) {
      const state = createSimState(def, 1, {
        tools: PERFECT_TOOLS,
        assist: 'medium',
        featherEnabled: false,
      })
      const layout = computeLayout(state.chambers.length, 0, def.rows ?? 1)
      for (const c of state.chambers) {
        const shoved = { ...c, lift: c.maxLift, keyLift: c.maxLift }
        const rect = driverPinRect(layout, shoved)
        expect(rect.y, `${def.id} chamber ${c.index} driver top`).toBeGreaterThanOrEqual(
          mmToY(layout, SHELL_CHAMBER_TOP_MM) - 1e-6,
        )
        // And the spring above it still has somewhere to be.
        const span = springSpan(layout, shoved)
        expect(span.bottom - span.top, `${def.id} chamber ${c.index} spring`).toBeGreaterThan(0)
      }
    }
    expect(chamberTop).toBeGreaterThan(0)
  })

  it('still fits the frame with room for the rank strip above it', () => {
    // The assembly grew upward to make room. It has to stay clear of the top of the stage, and
    // leave the band the rank letter is drawn in (D-096).
    const top = SHEAR_Y - SHELL_TOP_MM * MM_TO_PX
    const bottom = SHEAR_Y - PLUG_BOTTOM_MM * MM_TO_PX
    expect(top, 'the shell has grown off the top of the stage').toBeGreaterThan(120)
    expect(bottom, 'the plug has grown into the footer').toBeLessThan(940)
  })
})
