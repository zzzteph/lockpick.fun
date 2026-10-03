/**
 * PHYSLAB — draw the cross-section straight off the state.
 *
 * This is the claim the game's renderers cannot make today: there is no separate "what does this
 * look like" model here. The picture is the physics. The plug slides sideways by exactly the
 * `shift` the tick computed; a pin is drawn from the same band silhouette the contact test reads;
 * the binding pin is red because the model says it is binding. If the feel is right, this is what
 * an honest teardown view renders — and adding a tool or a pin is adding a shape to this drawing.
 */

import {
  BORE_HALF,
  FLOOR_Y,
  PITCH,
  PLUG_RADIUS,
  SHEAR_Y,
  STRAIN_BENT,
  STRAIN_BROKEN,
  THETA_OPEN,
  TOOTH_HALF,
  toolShaftY,
  type Band,
  type Chamber,
  type LabState,
  type ProfileKind,
} from './model'

const COL = {
  bg: '#0f1216',
  shell: 'rgba(120,140,175,0.10)',
  plug: 'rgba(90,150,210,0.14)',
  plugEdge: 'rgba(150,190,235,0.55)',
  shear: '#5b6472',
  steel: '#8a94a6',
  key: '#6f7889',
  binding: '#e8555a',
  jam: '#e0a33a',
  caught: '#46c37b',
  ready: '#d7e2f2',
  overset: '#b866d6',
  tool: '#d6deec',
  toolBent: '#e0a33a',
  text: '#aeb8c6',
  dim: '#6b7480',
} as const

const KIND_LABEL: Record<ProfileKind, string> = {
  standard: 'std',
  spool: 'spool',
  serrated: 'serr',
  mushroom: 'mush',
}

export interface Layout {
  readonly scale: number
  readonly originX: number
  readonly originY: number
}

export function layoutFor(state: LabState, w: number, h: number): Layout {
  const span = (state.chambers.length + 1) * PITCH + 4
  const scale = Math.min((w - 40) / span, h / 26)
  return { scale, originX: 30, originY: h * 0.46 }
}

function chamberColour(c: Chamber): string {
  if (c.caught) return COL.caught
  if (c.overset) return COL.overset
  if (c.counterForce > 0.02) return COL.jam // walled at a false set
  if (c.binding) return COL.binding
  if (c.permits) return COL.ready
  return COL.steel
}

/** Draw a symmetric pin body from its bands, bottom-to-top, centred at `cx` mm — tapers included. */
function pinPath(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  cx: number,
  bottomMm: number,
  bands: readonly Band[],
): void {
  const sx = (x: number) => L.originX + x * L.scale
  const sy = (y: number) => L.originY - y * L.scale
  const topOf = (b: Band): number => b.topHalf ?? b.half
  ctx.beginPath()
  // Up the right edge — a tapered band slants from `half` at its foot to `topHalf` at its top.
  let y = bottomMm
  ctx.moveTo(sx(cx + bands[0]!.half), sy(y))
  for (const b of bands) {
    ctx.lineTo(sx(cx + b.half), sy(y))
    y += b.len
    ctx.lineTo(sx(cx + topOf(b)), sy(y))
  }
  // ...across the top and back down the left edge.
  for (let i = bands.length - 1; i >= 0; i -= 1) {
    const b = bands[i]!
    ctx.lineTo(sx(cx - topOf(b)), sy(y))
    y -= b.len
    ctx.lineTo(sx(cx - b.half), sy(y))
  }
  ctx.closePath()
}

export function renderLab(ctx: CanvasRenderingContext2D, state: LabState, w: number, h: number): void {
  const L = layoutFor(state, w, h)
  const sx = (x: number) => L.originX + x * L.scale
  const sy = (y: number) => L.originY - y * L.scale

  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, w, h)

  const leftX = -PITCH
  const rightX = state.chambers.length * PITCH
  const topMm = 7
  const shift = state.shift

  // Shell (fixed) above the shear line; plug (rotated → shifted) below it. The sideways offset of
  // the plug block is the rotation, made visible — the scissor that pinches the pins.
  ctx.fillStyle = COL.shell
  ctx.fillRect(sx(leftX), sy(topMm), (rightX - leftX) * L.scale, (topMm - SHEAR_Y) * L.scale)
  ctx.fillStyle = COL.plug
  ctx.fillRect(
    sx(leftX) + shift * L.scale,
    sy(SHEAR_Y),
    (rightX - leftX) * L.scale,
    (SHEAR_Y - FLOOR_Y + 1.5) * L.scale,
  )
  ctx.strokeStyle = COL.plugEdge
  ctx.lineWidth = 1
  ctx.strokeRect(
    sx(leftX) + shift * L.scale,
    sy(SHEAR_Y),
    (rightX - leftX) * L.scale,
    (SHEAR_Y - FLOOR_Y + 1.5) * L.scale,
  )

  // Each chamber: the driver sits in the shell (fixed x); the key pin sits in the plug (shifted).
  for (const c of state.chambers) {
    const boreX = c.def.boreX
    const interfaceY = FLOOR_Y + c.def.keyLen + c.lift
    const keyBottom = FLOOR_Y + c.lift
    const colour = chamberColour(c)

    // Bore walls (shell fixed, plug shifted) so the pinch is visible where they cross the pin.
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.beginPath()
    ctx.moveTo(sx(boreX - BORE_HALF), sy(topMm))
    ctx.lineTo(sx(boreX - BORE_HALF), sy(SHEAR_Y))
    ctx.moveTo(sx(boreX + BORE_HALF), sy(topMm))
    ctx.lineTo(sx(boreX + BORE_HALF), sy(SHEAR_Y))
    ctx.stroke()

    // Key pin (plug frame → shifted).
    ctx.fillStyle = COL.key
    pinPath(ctx, L, boreX + shift, keyBottom, [{ len: c.def.keyLen, half: c.def.keyHalf }])
    ctx.fill()

    // Driver pin (shell frame → fixed), coloured by what the model says it is doing.
    ctx.fillStyle = colour
    pinPath(ctx, L, boreX, interfaceY, c.def.driver)
    ctx.fill()

    // Spring coil hint above the driver.
    ctx.strokeStyle = COL.dim
    ctx.beginPath()
    const top = interfaceY + c.def.driver.reduce((s, b) => s + b.len, 0)
    for (let i = 0; i <= 6; i += 1) {
      const yy = top + 0.2 + i * 0.18
      const xx = boreX + (i % 2 === 0 ? -0.5 : 0.5)
      if (i === 0) ctx.moveTo(sx(xx), sy(yy))
      else ctx.lineTo(sx(xx), sy(yy))
    }
    ctx.stroke()

    // Chamber index and pin type — so you can read what shape produced the behaviour.
    ctx.fillStyle = COL.dim
    ctx.font = '11px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.fillText(String(c.def.index), sx(boreX), sy(FLOOR_Y) + 16)
    ctx.fillStyle = c.def.kind === 'standard' ? COL.dim : COL.text
    ctx.fillText(KIND_LABEL[c.def.kind], sx(boreX), sy(FLOOR_Y) + 30)
  }

  // The shear line.
  ctx.strokeStyle = COL.shear
  ctx.setLineDash([6, 5])
  ctx.beginPath()
  ctx.moveTo(sx(leftX), sy(SHEAR_Y))
  ctx.lineTo(sx(rightX), sy(SHEAR_Y))
  ctx.stroke()
  ctx.setLineDash([])

  // The tool: a rigid strip pivoting about the hand, so its shaft tilts as the tip lifts, with
  // triangular teeth riding on it. Amber once bent, dashed once snapped.
  const tool = state.tool
  const tipX = Math.min(tool.x, tool.reach)
  const shaftStart = leftX - 1
  const toolColour = state.pickBroken || state.pickBent ? COL.toolBent : COL.tool
  ctx.strokeStyle = toolColour
  ctx.lineWidth = 2
  ctx.setLineDash(state.pickBroken ? [3, 4] : [])
  ctx.beginPath()
  ctx.moveTo(sx(shaftStart), sy(toolShaftY(tool, shaftStart)))
  ctx.lineTo(sx(tipX), sy(toolShaftY(tool, tipX)))
  ctx.stroke()
  for (const t of tool.teeth) {
    const tx = tipX + t.dx
    if (tx < shaftStart) continue
    ctx.beginPath()
    ctx.moveTo(sx(tx - TOOTH_HALF), sy(toolShaftY(tool, tx - TOOTH_HALF)))
    ctx.lineTo(sx(tx), sy(toolShaftY(tool, tx) + t.height))
    ctx.lineTo(sx(tx + TOOTH_HALF), sy(toolShaftY(tool, tx + TOOTH_HALF)))
    ctx.stroke()
  }
  ctx.setLineDash([])

  // Readout.
  ctx.fillStyle = COL.text
  ctx.font = '13px ui-monospace, monospace'
  ctx.textAlign = 'left'
  const pct = Math.round((state.theta / THETA_OPEN) * 100)
  const bind = state.binding >= 0 ? `#${state.binding}` : '—'
  const caught = state.chambers.filter((c) => c.caught).length
  const pick = state.pickBroken ? '   ✖ PICK BROKEN' : state.pickBent ? '   ⚠ pick bent' : ''
  const line =
    `${tool.kind.toUpperCase()}   tension ${state.tension.toFixed(2)}   ` +
    `plug ${pct}% (θ=${state.theta.toFixed(3)}/${THETA_OPEN})   ` +
    `binding ${bind}   set ${caught}/${state.chambers.length}` +
    (state.opened ? '   ✔ OPEN' : pick)
  ctx.fillText(line, 16, 22)

  // Two emergent readouts: what the pin under the tool feels like, and how loaded the pick is.
  meter(ctx, 16, 34, 150, 9, state.resistance, COL.binding, 'resistance')
  meter(ctx, 210, 34, 150, 9, clamp01(state.pickStrain / STRAIN_BROKEN), COL.jam, 'pick strain')
  // strain thresholds, marked on its bar
  ctx.strokeStyle = COL.dim
  ctx.beginPath()
  const bentX = 210 + 150 * (STRAIN_BENT / STRAIN_BROKEN)
  ctx.moveTo(bentX, 34)
  ctx.lineTo(bentX, 43)
  ctx.stroke()

  // A small note on the rotation, so the sideways slide reads as what it is.
  ctx.fillStyle = COL.dim
  ctx.font = '11px ui-monospace, monospace'
  ctx.fillText(`plug shift Δ = R·θ = ${shift.toFixed(3)} mm  (R=${PLUG_RADIUS})`, 16, h - 14)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** A small labelled progress bar. */
function meter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  colour: string,
  label: string,
): void {
  ctx.fillStyle = 'rgba(255,255,255,0.07)'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = colour
  ctx.fillRect(x, y, w * clamp01(frac), h)
  ctx.fillStyle = COL.dim
  ctx.font = '10px ui-monospace, monospace'
  ctx.textAlign = 'left'
  ctx.fillText(label, x, y + h + 10)
}
