import { describe, expect, it } from 'vitest'
import {
  ASSEMBLY_FRACTION,
  CHAMBER_PITCH_MM,
  PITCH_TO_DIAMETER,
  MM_TO_PX,
  SHEAR_Y,
  assemblyBounds,
  bandRects,
  captureBandRect,
  chamberAtX,
  computeLayout,
  driverLengthPx,
  driverPinRect,
  keyPinRect,
  LEDGE_MAX_FRACTION,
  ledgeOffset,
  mmToY,
  plugChamberX,
  shellChamberX,
  springSpan,
  yToMm,
} from '../../src/render/layout'
import { LOGICAL_WIDTH } from '../../src/render/viewport'
import { DRIVER_LENGTH, KEYWAY_FLOOR, THETA_OPEN, createSimState } from '../../src/sim'
import { PERFECT_CONFIG, SPOOL_LOCK, THREE_PIN, TWELVE_PIN, holdFor, pick } from '../sim/fixtures'

describe('millimetre mapping', () => {
  const layout = computeLayout(3, 0)

  it('puts the shear line at the shear line', () => {
    expect(mmToY(layout, 0)).toBe(SHEAR_Y)
  })

  it('maps positive millimetres upward', () => {
    expect(mmToY(layout, 1)).toBe(SHEAR_Y - MM_TO_PX)
    expect(mmToY(layout, -1)).toBe(SHEAR_Y + MM_TO_PX)
  })

  it('round-trips', () => {
    for (const mm of [-7.4, -5, -1.25, 0, 2.5, 6.4]) {
      expect(yToMm(layout, mmToY(layout, mm))).toBeCloseTo(mm, 9)
    }
  })
})

describe('assembly framing — ART_DIRECTION.md §4, DECISIONS D-049', () => {
  it('keeps one real chamber pitch until the lock is too long for the frame', () => {
    const trueScale = CHAMBER_PITCH_MM * MM_TO_PX
    // Short and medium locks are drawn to scale: a 3-pin lock is *shorter*, not sparser.
    for (const n of [1, 2, 3, 5]) {
      expect(computeLayout(n, 0).pitch, `n=${n}`).toBeCloseTo(trueScale, 9)
    }
    // Long ones are squeezed uniformly rather than overflowing.
    expect(computeLayout(12, 0).pitch).toBeLessThan(trueScale)
    for (const n of [1, 2, 3, 5, 8, 12, 16]) {
      const l = computeLayout(n, 0)
      expect(l.right - l.left, `n=${n}`).toBeLessThanOrEqual(LOGICAL_WIDTH * ASSEMBLY_FRACTION + 1e-9)
      expect(l.left + (l.right - l.left) / 2, `n=${n}`).toBeCloseTo(LOGICAL_WIDTH / 2, 6)
    }
  })

  it('a longer lock is drawn longer', () => {
    const width = (n: number): number => {
      const l = computeLayout(n, 0)
      return l.right - l.left
    }
    expect(width(3)).toBeLessThan(width(5))
    expect(width(5)).toBeLessThan(width(6))
  })

  it('spaces chambers evenly, with solid body past the outermost bore', () => {
    const layout = computeLayout(5, 0)
    for (let i = 1; i < 5; i += 1) {
      expect(shellChamberX(layout, i) - shellChamberX(layout, i - 1)).toBeCloseTo(layout.pitch, 9)
    }
    // Half a pitch of bore, then the end pad — the face and tail of a real cylinder.
    const pad = layout.endPad
    expect(pad).toBeGreaterThan(0)
    expect(shellChamberX(layout, 0) - layout.left).toBeCloseTo(pad + layout.pitch / 2, 9)
    expect(layout.right - shellChamberX(layout, 4)).toBeCloseTo(pad + layout.pitch / 2, 9)
  })

  it('holds the real pitch-to-diameter ratio at every pin count', () => {
    /**
     * The property the whole change exists for. A real cylinder is drilled on 0.150" centres
     * with 0.115" pins, so adjacent pins very nearly touch — and they must go on nearly
     * touching when a 12-pin lock is squeezed to fit the frame, or the squeeze reintroduces
     * exactly the acreage of empty plug that made the old layout unplayable.
     */
    for (const n of [1, 2, 3, 5, 8, 12, 16]) {
      const l = computeLayout(n, 0)
      expect(l.pitch / l.driverWidth, `n=${n}`).toBeCloseTo(PITCH_TO_DIAMETER, 6)
      // Never wider than its own chamber spacing, at any count.
      expect(l.driverWidth, `n=${n}`).toBeLessThan(l.pitch)
      // …and the gutter between neighbours stays a slim strip, never a gulf.
      const gutter = l.pitch - l.driverWidth
      expect(gutter / l.driverWidth, `n=${n}`).toBeLessThan(0.35)
    }
  })

  it('narrows the pins as the count rises, within sane bounds', () => {
    const few = computeLayout(2, 0)
    const many = computeLayout(12, 0)
    expect(many.driverWidth).toBeLessThan(few.driverWidth)
    expect(many.driverWidth).toBeGreaterThanOrEqual(18)
  })

  it('key pins are narrower than drivers', () => {
    const layout = computeLayout(5, 0)
    expect(layout.keyPinWidth).toBeLessThan(layout.driverWidth)
  })

  it('reports the vertical extent of the whole assembly', () => {
    const layout = computeLayout(3, 0)
    const b = assemblyBounds(layout)
    expect(b.x).toBe(layout.left)
    expect(b.w).toBeCloseTo(layout.right - layout.left, 9)
    expect(b.y).toBeLessThan(mmToY(layout, 0))
    expect(b.y + b.h).toBeGreaterThan(mmToY(layout, 0))
  })

  it('converts driver length to pixels', () => {
    expect(driverLengthPx(computeLayout(3, 0))).toBeCloseTo(DRIVER_LENGTH * MM_TO_PX, 9)
  })
})

describe('hit testing', () => {
  const layout = computeLayout(4, 0)

  it('maps x to the chamber it lands in', () => {
    for (let i = 0; i < 4; i += 1) {
      expect(chamberAtX(layout, shellChamberX(layout, i))).toBe(i)
      // Just inside the leading edge of each chamber's slot, past the end pad.
      expect(chamberAtX(layout, layout.left + layout.endPad + layout.pitch * i + 1)).toBe(i)
    }
  })

  it('the end pads belong to the outermost chambers, not to nothing', () => {
    // A click on the face of the lock is a click on the first pin — the alternative is a dead
    // strip of body at each end that silently swallows input.
    expect(chamberAtX(layout, layout.left + 2)).toBe(0)
    expect(chamberAtX(layout, layout.right - 2)).toBe(3)
  })

  it('reports -1 outside the assembly', () => {
    expect(chamberAtX(layout, layout.left - 1)).toBe(-1)
    expect(chamberAtX(layout, layout.right)).toBe(-1)
    expect(chamberAtX(layout, 0)).toBe(-1)
    expect(chamberAtX(layout, LOGICAL_WIDTH)).toBe(-1)
  })
})

describe('plug rotation as a ledge offset', () => {
  it('is zero at rest and saturates at full rotation', () => {
    // Read from the constant rather than hardcoded: the slide *is* the rotation in a section view,
    // so it is a number that gets tuned for legibility (D-096) and a test that pins it to a literal
    // only ever reports that somebody tuned it.
    expect(ledgeOffset(0, 100)).toBe(0)
    expect(ledgeOffset(THETA_OPEN, 100)).toBeCloseTo(LEDGE_MAX_FRACTION * 100, 6)
    expect(ledgeOffset(THETA_OPEN * 2, 100)).toBeCloseTo(LEDGE_MAX_FRACTION * 100, 6)
  })

  it('rises monotonically', () => {
    let previous = -1
    for (let t = 0; t <= THETA_OPEN; t += THETA_OPEN / 40) {
      const v = ledgeOffset(t, 100)
      expect(v).toBeGreaterThanOrEqual(previous)
      previous = v
    }
  })

  it('makes a single pin take-up visible rather than sub-pixel', () => {
    // A per-pin take-up is δ ≈ 0.005 rad, which as true arc length is about one pixel.
    const layout = computeLayout(5, 0.005)
    expect(layout.ledgeOffset).toBeGreaterThan(3)
    expect(layout.ledgeOffset).toBeLessThan(layout.driverWidth / 2)
  })

  it('slides the plug bores and leaves the shell bores alone', () => {
    const rest = computeLayout(3, 0)
    const turned = computeLayout(3, 0.2)
    expect(shellChamberX(turned, 1)).toBeCloseTo(shellChamberX(rest, 1), 9)
    expect(plugChamberX(turned, 1) - shellChamberX(turned, 1)).toBeCloseTo(turned.ledgeOffset, 9)
    expect(plugChamberX(turned, 1)).toBeGreaterThan(plugChamberX(rest, 1))
  })
})

describe('pin geometry follows sim state — PHASES.md Phase 2', () => {
  it('places the key pin, junction and driver top exactly where the sim says', () => {
    const s = createSimState(THREE_PIN, 3, PERFECT_CONFIG)
    holdFor(s, pick(1, 0.8, 0.5), 0.6)
    const layout = computeLayout(s.chambers.length, s.theta)
    for (const c of s.chambers) {
      const key = keyPinRect(layout, c)
      const driver = driverPinRect(layout, c)
      expect(key.y + key.h).toBeCloseTo(mmToY(layout, KEYWAY_FLOOR + c.lift), 9)
      expect(key.y).toBeCloseTo(mmToY(layout, KEYWAY_FLOOR + c.keyPinLength + c.lift), 9)
      expect(driver.y + driver.h).toBeCloseTo(key.y, 9)
      expect(driver.y).toBeCloseTo(
        mmToY(layout, KEYWAY_FLOOR + c.keyPinLength + c.driverLength + c.lift),
        9,
      )
      expect(driver.h).toBeCloseTo(c.driverLength * MM_TO_PX, 9)
      // The key pin rides in the plug bore; the driver stays with the shell.
      expect(key.x + key.w / 2).toBeCloseTo(plugChamberX(layout, c.index), 9)
      expect(driver.x + driver.w / 2).toBeCloseTo(shellChamberX(layout, c.index), 9)
    }
  })

  it('a set chamber draws its driver bottom at or above the shear line', () => {
    const s = createSimState(THREE_PIN, 3, PERFECT_CONFIG)
    holdFor(s, pick(-1, 0, 0.5), 0.3)
    const b = s.bindingChamber
    const c = s.chambers[b]
    if (!c) throw new Error('expected a binding chamber')
    holdFor(s, pick(b, c.setLift + c.captureWindow / 2, 0.5), 1.0)
    expect(c.state).toBe('SET')
    const layout = computeLayout(s.chambers.length, s.theta)
    const driver = driverPinRect(layout, c)
    expect(driver.y + driver.h).toBeLessThanOrEqual(mmToY(layout, 0) + 1e-6)
  })

  it('draws the driver from its band data, waist and all', () => {
    const s = createSimState(SPOOL_LOCK, 3, PERFECT_CONFIG)
    const spool = s.chambers[1]
    if (!spool) throw new Error('missing chamber')
    const layout = computeLayout(s.chambers.length, 0)
    const bands = bandRects(layout, spool)
    expect(bands).toHaveLength(spool.profile.bands.length)

    // Bands stack bottom to top with no gaps, and sum to the driver length.
    let total = 0
    for (let i = 0; i < bands.length; i += 1) {
      const r = bands[i]
      const band = spool.profile.bands[i]
      if (!r || !band) continue
      expect(r.h).toBeCloseTo(band.length * MM_TO_PX, 6)
      total += r.h
      expect(r.w).toBeCloseTo(layout.driverWidth * (1 - band.grooveDepth), 9)
      expect(r.x + r.w / 2).toBeCloseTo(shellChamberX(layout, spool.index), 9)
      const next = bands[i + 1]
      if (next) expect(next.y + next.h).toBeCloseTo(r.y, 6)
    }
    expect(total).toBeCloseTo(spool.driverLength * MM_TO_PX, 6)

    // The waist is genuinely narrower than the bands either side of it.
    const waist = bands[1]
    const foot = bands[0]
    const body = bands[2]
    if (!waist || !foot || !body) throw new Error('expected three bands')
    expect(waist.w).toBeLessThan(foot.w)
    expect(waist.w).toBeLessThan(body.w)
  })

  it('every standard pin is drawn as a single full-width band', () => {
    const s = createSimState(TWELVE_PIN, 1, PERFECT_CONFIG)
    const layout = computeLayout(s.chambers.length, 0)
    for (const c of s.chambers) {
      const bands = bandRects(layout, c)
      expect(bands).toHaveLength(1)
      expect(bands[0]?.w).toBeCloseTo(layout.driverWidth, 9)
    }
  })

  it('compresses the spring as the stack rises', () => {
    const s = createSimState(THREE_PIN, 3, PERFECT_CONFIG)
    const layout = computeLayout(s.chambers.length, 0)
    const c = s.chambers[0]
    if (!c) throw new Error('missing chamber')
    const atRest = springSpan(layout, c)
    holdFor(s, pick(0, 1.5, 0), 0.5)
    const lifted = springSpan(layout, c)
    expect(lifted.top).toBe(atRest.top)
    expect(lifted.bottom).toBeLessThan(atRest.bottom)
    expect(lifted.bottom - lifted.top).toBeLessThan(atRest.bottom - atRest.top)
  })

  it('draws the capture window as the band just above the shear line', () => {
    const s = createSimState(THREE_PIN, 3, PERFECT_CONFIG)
    const layout = computeLayout(s.chambers.length, 0)
    const c = s.chambers[0]
    if (!c) throw new Error('missing chamber')
    const band = captureBandRect(layout, c)
    expect(band.y + band.h).toBeCloseTo(mmToY(layout, 0), 9)
    expect(band.h).toBeCloseTo(c.captureWindow * MM_TO_PX, 9)
  })
})
