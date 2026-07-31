/**
 * Synthesis — AUDIO.md §2 and §3.
 *
 * Every sound in the game is a few oscillators and a noise buffer. No samples, no files, no
 * licences, no loading. Because everything is generated, a click can vary with pin index,
 * tension and a seeded detune instead of replaying the same 40ms for the thousandth time.
 *
 * Everything here is written against `BaseAudioContext`, which is what `AudioContext` and
 * `OfflineAudioContext` have in common — so the exact code that plays in the game is the code
 * the tests render and measure.
 */

import { createRng, nextFloat } from '../sim'

// ── Noise ───────────────────────────────────────────────────────────────────────────────

const NOISE_SECONDS = 2
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>()
const brownCache = new WeakMap<BaseAudioContext, AudioBuffer>()

/** White noise, generated from a fixed seed so a rendered test buffer is reproducible. */
export function whiteNoise(ctx: BaseAudioContext): AudioBuffer {
  const hit = noiseCache.get(ctx)
  if (hit) return hit
  const length = Math.ceil(ctx.sampleRate * NOISE_SECONDS)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  const rng = createRng(0x5ea21e)
  for (let i = 0; i < length; i += 1) data[i] = nextFloat(rng) * 2 - 1
  noiseCache.set(ctx, buffer)
  return buffer
}

/** Brown noise — the workshop bed (AUDIO.md §4). */
export function brownNoise(ctx: BaseAudioContext): AudioBuffer {
  const hit = brownCache.get(ctx)
  if (hit) return hit
  const length = Math.ceil(ctx.sampleRate * NOISE_SECONDS)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  const rng = createRng(0xb2011)
  let last = 0
  for (let i = 0; i < length; i += 1) {
    const white = nextFloat(rng) * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[i] = last * 3.5
  }
  brownCache.set(ctx, buffer)
  return buffer
}

function noiseSource(ctx: BaseAudioContext, buffer: AudioBuffer, loop = false): AudioBufferSourceNode {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.loop = loop
  return src
}

// ── The click — the sound of the game (AUDIO.md §2) ─────────────────────────────────────

export interface ClickParams {
  /** 0 is nearest the keyway mouth. Deeper pins sound lower. */
  pinIndex: number
  chamberCount: number
  /** 0..1. Heavy tension sounds tight and dead; light tension sounds open and ringing. */
  tension: number
  /** -0.04..0.04, from the sim's seeded PRNG, so replays sound identical. */
  detune: number
  gain?: number
}

export const CLICK_LOW_HZ = 180
export const CLICK_HIGH_HZ = 420

/** Body frequency for a pin — the signal a player learns to hear. */
export function clickBodyFrequency(pinIndex: number, chamberCount: number, detune = 0): number {
  const span = Math.max(1, chamberCount - 1)
  const t = Math.min(1, Math.max(0, pinIndex / span))
  return (CLICK_HIGH_HZ - (CLICK_HIGH_HZ - CLICK_LOW_HZ) * t) * (1 + detune)
}

/**
 * Three layers: a 4ms filtered noise transient, a triangle body that drops 12% in pitch over
 * 30ms, and a sine ring an octave-and-a-half above it. Returns the total duration.
 */
export function scheduleClick(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  p: ClickParams,
): number {
  const g = p.gain ?? 1
  const tension = Math.min(1, Math.max(0, p.tension))
  const body = clickBodyFrequency(p.pinIndex, p.chamberCount, p.detune)
  // Heavy tension: brighter transient, shorter decay.
  const transientHz = 2400 * (1 + tension * 0.6)
  const bodyDecay = 0.045 * (1 - tension * 0.35)
  const ringDecay = 0.09 * (1 - tension * 0.4)

  // Layer 1 — transient.
  const src = noiseSource(ctx, whiteNoise(ctx))
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = transientHz
  bp.Q.value = 8
  const tg = ctx.createGain()
  tg.gain.setValueAtTime(0, when)
  tg.gain.linearRampToValueAtTime(1.1 * g, when + 0.002)
  tg.gain.exponentialRampToValueAtTime(0.0001, when + 0.006)
  src.connect(bp).connect(tg).connect(dest)
  src.start(when)
  src.stop(when + 0.02)

  // Layer 2 — body.
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(body, when)
  osc.frequency.exponentialRampToValueAtTime(body * 0.88, when + 0.03)
  const og = ctx.createGain()
  og.gain.setValueAtTime(0, when)
  og.gain.linearRampToValueAtTime(0.95 * g, when + 0.003)
  og.gain.exponentialRampToValueAtTime(0.0001, when + bodyDecay)
  osc.connect(og).connect(dest)
  osc.start(when)
  osc.stop(when + bodyDecay + 0.01)

  // Layer 3 — ring.
  const ring = ctx.createOscillator()
  ring.type = 'sine'
  ring.frequency.value = body * 4
  const rg = ctx.createGain()
  rg.gain.setValueAtTime(0, when)
  rg.gain.linearRampToValueAtTime(0.22 * g, when + 0.004)
  rg.gain.exponentialRampToValueAtTime(0.0001, when + ringDecay)
  ring.connect(rg).connect(dest)
  ring.start(when)
  ring.stop(when + ringDecay + 0.01)

  return Math.max(bodyDecay, ringDecay) + 0.01
}

// ── The rest of the palette (AUDIO.md §3) ───────────────────────────────────────────────

/** Overset: dull thud, 80Hz sine plus heavily lowpassed noise. No ring. Dead and final. */
export function scheduleOverset(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  gain = 1,
): number {
  const duration = 0.22
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(90, when)
  osc.frequency.exponentialRampToValueAtTime(62, when + 0.12)
  const og = ctx.createGain()
  og.gain.setValueAtTime(0, when)
  og.gain.linearRampToValueAtTime(0.85 * gain, when + 0.006)
  og.gain.exponentialRampToValueAtTime(0.0001, when + duration)
  osc.connect(og).connect(dest)
  osc.start(when)
  osc.stop(when + duration + 0.01)

  const src = noiseSource(ctx, whiteNoise(ctx))
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 240
  lp.Q.value = 0.7
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(0, when)
  ng.gain.linearRampToValueAtTime(0.5 * gain, when + 0.004)
  ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.14)
  src.connect(lp).connect(ng).connect(dest)
  src.start(when)
  src.stop(when + 0.16)
  return duration
}

/** False set: a bright metallic ping from three inharmonic sines. The audio lies too. */
export const FALSE_SET_RATIOS = [1.0, 2.7, 5.3] as const

export function scheduleFalseSet(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  gain = 1,
): number {
  const base = 620
  const duration = 0.5
  FALSE_SET_RATIOS.forEach((ratio, i) => {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = base * ratio
    const g = ctx.createGain()
    const level = (0.34 / (i + 1)) * gain
    g.gain.setValueAtTime(0, when)
    g.gain.linearRampToValueAtTime(level, when + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, when + duration * (1 - i * 0.22))
    osc.connect(g).connect(dest)
    osc.start(when)
    osc.stop(when + duration + 0.01)
  })
  return duration
}

/**
 * The plug going slack: a low, dull *give* with no metal in it at all.
 *
 * This is the sound of resistance disappearing, which is the opposite of every other cue in the
 * game — the clicks, the false-set ping and the overset are all *impacts*. So it is built the
 * other way round: a short downward glide on a lowpassed triangle, no inharmonic partials, no
 * attack transient to speak of. Nothing here rings, because nothing struck anything; the plug
 * simply stopped being held. See DECISIONS D-055.
 */
export const PLUG_FREE_FROM_HZ = 168
export const PLUG_FREE_TO_HZ = 96

export function schedulePlugFree(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  gain = 1,
): number {
  const duration = 0.34
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(PLUG_FREE_FROM_HZ, when)
  osc.frequency.exponentialRampToValueAtTime(PLUG_FREE_TO_HZ, when + duration * 0.8)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 420
  const g = ctx.createGain()
  // A slow attack — 40ms — so it reads as a release rather than a knock.
  g.gain.setValueAtTime(0, when)
  g.gain.linearRampToValueAtTime(0.3 * gain, when + 0.04)
  g.gain.exponentialRampToValueAtTime(0.0001, when + duration)
  osc.connect(lp).connect(g).connect(dest)
  osc.start(when)
  osc.stop(when + duration + 0.01)
  return duration
}

/**
 * The pick giving up: a metallic groan that bends, or a snap that does not.
 *
 * Both are the *tool* rather than the lock, so both are deliberately unlike anything a chamber
 * makes: a sawtooth through a resonant bandpass, which is thin and sour where every lock sound is
 * either a click or a thud. The bend glides *down* and fades — steel taking a set. The break is the
 * same voice cut off in 40ms with a burst of bright noise over it, because a snap has no decay.
 * See DECISIONS D-068.
 */
export function schedulePickStrain(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  broken: boolean,
  gain = 1,
): number {
  const duration = broken ? 0.22 : 0.42
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(broken ? 900 : 520, when)
  osc.frequency.exponentialRampToValueAtTime(broken ? 240 : 300, when + duration * 0.7)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = broken ? 1500 : 780
  bp.Q.value = 7
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, when)
  g.gain.linearRampToValueAtTime(0.34 * gain, when + (broken ? 0.003 : 0.05))
  g.gain.exponentialRampToValueAtTime(0.0001, when + duration)
  osc.connect(bp).connect(g).connect(dest)
  osc.start(when)
  osc.stop(when + duration + 0.01)

  if (broken) {
    // The fracture itself: a very short burst of bright noise, no tail.
    const src = noiseSource(ctx, whiteNoise(ctx))
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 2600
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.5 * gain, when)
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.04)
    src.connect(hp).connect(ng).connect(dest)
    src.start(when)
    src.stop(when + 0.06)
  }
  return duration
}

/** Reset: a cascade of soft drops, staggered 25ms per chamber, descending. */
export const RESET_STAGGER = 0.025

export function scheduleReset(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  chamberCount: number,
  gain = 1,
): number {
  const n = Math.max(1, chamberCount)
  for (let i = 0; i < n; i += 1) {
    const t = when + i * RESET_STAGGER
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    const f = 260 - i * 18
    osc.frequency.setValueAtTime(f, t)
    osc.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.05)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.3 * gain, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
    osc.connect(g).connect(dest)
    osc.start(t)
    osc.stop(t + 0.09)
  }
  return n * RESET_STAGGER + 0.09
}

/** Major pentatonic, for the open arpeggio. */
export const PENTATONIC = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3] as const

/** Open: a deep mechanical thunk, an ascending arpeggio, then the shackle spring. */
export function scheduleOpen(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  gain = 1,
): number {
  // Thunk.
  const thunk = ctx.createOscillator()
  thunk.type = 'sine'
  thunk.frequency.setValueAtTime(70, when)
  thunk.frequency.exponentialRampToValueAtTime(48, when + 0.18)
  const tg = ctx.createGain()
  tg.gain.setValueAtTime(0, when)
  tg.gain.linearRampToValueAtTime(0.95 * gain, when + 0.006)
  tg.gain.exponentialRampToValueAtTime(0.0001, when + 0.35)
  thunk.connect(tg).connect(dest)
  thunk.start(when)
  thunk.stop(when + 0.37)

  const noise = noiseSource(ctx, whiteNoise(ctx))
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 400
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(0, when)
  ng.gain.linearRampToValueAtTime(0.4 * gain, when + 0.004)
  ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.16)
  noise.connect(lp).connect(ng).connect(dest)
  noise.start(when)
  noise.stop(when + 0.18)

  // Arpeggio.
  const root = 392
  const step = 0.085
  PENTATONIC.forEach((ratio, i) => {
    const t = when + 0.28 + i * step
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = root * ratio
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.28 * gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    osc.connect(g).connect(dest)
    osc.start(t)
    osc.stop(t + 0.32)
  })

  // Shackle spring — a short rising noise sweep.
  const springStart = when + 0.28 + PENTATONIC.length * step
  const spring = noiseSource(ctx, whiteNoise(ctx))
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 4
  bp.frequency.setValueAtTime(700, springStart)
  bp.frequency.exponentialRampToValueAtTime(4200, springStart + 0.16)
  const sg = ctx.createGain()
  sg.gain.setValueAtTime(0, springStart)
  sg.gain.linearRampToValueAtTime(0.35 * gain, springStart + 0.02)
  sg.gain.exponentialRampToValueAtTime(0.0001, springStart + 0.2)
  spring.connect(bp).connect(sg).connect(dest)
  spring.start(springStart)
  spring.stop(springStart + 0.22)

  return springStart - when + 0.22
}

/** UI: a tiny mechanical detent. Nothing musical, nothing cute. */
export function scheduleUiTick(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  gain = 1,
): number {
  const src = noiseSource(ctx, whiteNoise(ctx))
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 3200
  bp.Q.value = 6
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, when)
  // Narrow-band noise loses most of its energy in the filter; the raw gain is high so the
  // detent actually lands at a comparable level to everything else.
  g.gain.linearRampToValueAtTime(2.6 * gain, when + 0.001)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.006)
  src.connect(bp).connect(g).connect(dest)
  src.start(when)
  src.stop(when + 0.02)
  return 0.006
}

// ── Continuous voices ───────────────────────────────────────────────────────────────────

/**
 * A sustained sound whose level and timbre track simulation state.
 *
 * These are the one place audio reads state rather than events, because "amplitude tracking
 * resistance" is not something an event stream can express. The *discrete* triggers still all
 * come from events; only the continuous parameters are pushed in by the app each frame.
 */
export abstract class ContinuousVoice {
  protected readonly out: GainNode
  private stopped = false

  constructor(
    protected readonly ctx: BaseAudioContext,
    dest: AudioNode,
  ) {
    this.out = ctx.createGain()
    this.out.gain.value = 0
    this.out.connect(dest)
  }

  protected ramp(param: AudioParam, value: number, when: number, seconds = 0.04): void {
    param.setTargetAtTime(value, when, Math.max(0.001, seconds / 3))
  }

  setLevel(level: number, when: number): void {
    if (this.stopped) return
    this.ramp(this.out.gain, Math.max(0, level), when)
  }

  stop(when: number): void {
    if (this.stopped) return
    this.stopped = true
    this.out.gain.cancelScheduledValues(when)
    this.out.gain.setTargetAtTime(0, when, 0.02)
    this.onStop(when + 0.2)
  }

  protected abstract onStop(when: number): void
}

/** Binding: a low resonant hum, 60-90Hz. How Expert players find the binding pin. */
export class BindingHum extends ContinuousVoice {
  private readonly osc: OscillatorNode
  private readonly sub: OscillatorNode
  private readonly filter: BiquadFilterNode

  constructor(ctx: BaseAudioContext, dest: AudioNode, when = 0) {
    super(ctx, dest)
    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = 220
    this.filter.Q.value = 8
    this.filter.connect(this.out)
    this.osc = ctx.createOscillator()
    this.osc.type = 'sawtooth'
    this.osc.frequency.value = 62
    this.osc.connect(this.filter)
    this.sub = ctx.createOscillator()
    this.sub.type = 'sine'
    this.sub.frequency.value = 88
    this.sub.connect(this.filter)
    this.osc.start(when)
    this.sub.start(when)
  }

  /** `resistance` 0..1 from SIMULATION.md §8. */
  set(resistance: number, when: number): void {
    this.setLevel(Math.max(0, resistance) * 0.34, when)
    this.ramp(this.osc.frequency, 60 + resistance * 30, when, 0.08)
  }

  protected onStop(when: number): void {
    this.osc.stop(when)
    this.sub.stop(when)
  }
}

/** Free pin: light, springy, higher — deliberately the opposite texture to binding. */
export class FreePinTone extends ContinuousVoice {
  private readonly osc: OscillatorNode
  private readonly wobble: OscillatorNode
  private readonly wobbleGain: GainNode

  constructor(ctx: BaseAudioContext, dest: AudioNode, when = 0) {
    super(ctx, dest)
    this.osc = ctx.createOscillator()
    this.osc.type = 'triangle'
    this.osc.frequency.value = 210
    this.osc.connect(this.out)
    this.wobble = ctx.createOscillator()
    this.wobble.type = 'sine'
    this.wobble.frequency.value = 11
    this.wobbleGain = ctx.createGain()
    this.wobbleGain.gain.value = 18
    this.wobble.connect(this.wobbleGain).connect(this.osc.frequency)
    this.osc.start(when)
    this.wobble.start(when)
  }

  set(amount: number, when: number): void {
    this.setLevel(Math.max(0, amount) * 0.16, when)
  }

  protected onStop(when: number): void {
    this.osc.stop(when)
    this.wobble.stop(when)
  }
}

/** Scrape: filtered noise driven by pick velocity. Stops instantly when the pick stops. */
export class ScrapeNoise extends ContinuousVoice {
  private readonly src: AudioBufferSourceNode
  private readonly bp: BiquadFilterNode

  constructor(ctx: BaseAudioContext, dest: AudioNode, when = 0) {
    super(ctx, dest)
    this.bp = ctx.createBiquadFilter()
    this.bp.type = 'bandpass'
    this.bp.frequency.value = 1200
    this.bp.Q.value = 1.4
    this.bp.connect(this.out)
    this.src = noiseSource(ctx, whiteNoise(ctx), true)
    this.src.connect(this.bp)
    this.src.start(when)
  }

  /** `speed` 0..1, `position` 0..1 across the keyway. */
  set(speed: number, position: number, when: number): void {
    this.out.gain.cancelScheduledValues(when)
    this.out.gain.setTargetAtTime(Math.max(0, speed) * 0.16, when, 0.008)
    this.ramp(this.bp.frequency, 800 + position * 2200, when, 0.05)
  }

  protected onStop(when: number): void {
    this.src.stop(when)
  }
}

/** Spring tension: a quiet sawtooth bed under the pick, pitch rising with lift. */
export class SpringTone extends ContinuousVoice {
  private readonly osc: OscillatorNode
  private readonly lp: BiquadFilterNode

  constructor(ctx: BaseAudioContext, dest: AudioNode, when = 0) {
    super(ctx, dest)
    this.lp = ctx.createBiquadFilter()
    this.lp.type = 'lowpass'
    this.lp.frequency.value = 900
    this.lp.connect(this.out)
    this.osc = ctx.createOscillator()
    this.osc.type = 'sawtooth'
    this.osc.frequency.value = 120
    this.osc.connect(this.lp)
    this.osc.start(when)
  }

  /** `lift` in mm. */
  set(lift: number, level: number, when: number): void {
    this.setLevel(Math.max(0, level) * 0.06, when)
    this.ramp(this.osc.frequency, 110 + Math.max(0, lift) * 46, when, 0.06)
  }

  protected onStop(when: number): void {
    this.osc.stop(when)
  }
}

/** Counter-rotation: two detuned saws at 45/47Hz. Physical and unpleasant, which is the point. */
export class CounterRotationGrind extends ContinuousVoice {
  private readonly a: OscillatorNode
  private readonly b: OscillatorNode
  private readonly lp: BiquadFilterNode

  constructor(ctx: BaseAudioContext, dest: AudioNode, when = 0) {
    super(ctx, dest)
    this.lp = ctx.createBiquadFilter()
    this.lp.type = 'lowpass'
    this.lp.frequency.value = 320
    this.lp.Q.value = 6
    this.lp.connect(this.out)
    this.a = ctx.createOscillator()
    this.a.type = 'sawtooth'
    this.a.frequency.value = 45
    this.a.connect(this.lp)
    this.b = ctx.createOscillator()
    this.b.type = 'sawtooth'
    this.b.frequency.value = 47
    this.b.connect(this.lp)
    this.a.start(when)
    this.b.start(when)
  }

  /** `force` is `F_counter` in mm/s; normalised by the caller. */
  set(force: number, when: number): void {
    this.setLevel(Math.min(1, Math.max(0, force)) * 0.3, when)
  }

  protected onStop(when: number): void {
    this.a.stop(when)
    this.b.stop(when)
  }
}

/** Plug movement: faint sustained friction, gain tracking dθ/dt. */
export class PlugFriction extends ContinuousVoice {
  private readonly src: AudioBufferSourceNode
  private readonly bp: BiquadFilterNode

  constructor(ctx: BaseAudioContext, dest: AudioNode, when = 0) {
    super(ctx, dest)
    this.bp = ctx.createBiquadFilter()
    this.bp.type = 'bandpass'
    this.bp.frequency.value = 460
    this.bp.Q.value = 2.5
    this.bp.connect(this.out)
    this.src = noiseSource(ctx, brownNoise(ctx), true)
    this.src.connect(this.bp)
    this.src.start(when)
  }

  set(speed: number, when: number): void {
    this.setLevel(Math.min(1, Math.max(0, speed)) * 0.3, when)
  }

  protected onStop(when: number): void {
    this.src.stop(when)
  }
}

/** Cutoff of the room bed's low-pass, in Hz. Closed at rest, open on a false set. */
export const AMBIENT_BED_HZ = 420
export const AMBIENT_BED_OPEN_HZ = 760

/**
 * The workshop bed: near-silent filtered brown noise, and **nothing pitched**.
 *
 * `AUDIO.md §3` asked for the bed to *lift a semitone* on a false set, and `AUDIO.md §4` says
 * "nothing melodic during picking … the player is listening for a click, and a soundtrack
 * actively works against the game's core mechanic". Those two cannot both hold: a semitone lift
 * needs a note to lift, and a note held under the whole game is the most melodic thing in it.
 * §4 is the rule that matters, and the drone this class used to carry — a 98 Hz sine, forever —
 * read as an engine hum. §3 has been corrected.
 *
 * The false-set tell survives without pitch: the bed's filter **opens and stays open**, so the
 * room leans in. Same information, no note. See DECISIONS D-040.
 */
export class Ambience extends ContinuousVoice {
  private readonly src: AudioBufferSourceNode
  private readonly lp: BiquadFilterNode

  constructor(ctx: BaseAudioContext, dest: AudioNode, when = 0) {
    super(ctx, dest)
    this.lp = ctx.createBiquadFilter()
    this.lp.type = 'lowpass'
    this.lp.frequency.value = AMBIENT_BED_HZ
    this.lp.connect(this.out)
    this.src = noiseSource(ctx, brownNoise(ctx), true)
    this.src.connect(this.lp)
    this.src.start(when)
  }

  set(level: number, when: number): void {
    this.setLevel(Math.max(0, level) * 0.09, when)
  }

  /**
   * `amount` 0..1 — how far the room has opened up. One on a false set, back to zero on reset.
   * Named `setLift` still because that is what it is telling the player, not how it does it.
   */
  setLift(amount: number, when: number): void {
    const target = AMBIENT_BED_HZ + (AMBIENT_BED_OPEN_HZ - AMBIENT_BED_HZ) * Math.min(1, Math.max(0, amount))
    this.ramp(this.lp.frequency, target, when, 0.35)
  }

  /** Current bed cutoff, for tests and the debug page. */
  get bedCutoff(): number {
    return this.lp.frequency.value
  }

  protected onStop(when: number): void {
    this.src.stop(when)
  }
}
