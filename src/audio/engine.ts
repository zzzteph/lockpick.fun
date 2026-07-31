/**
 * The audio engine — AUDIO.md §1.
 *
 * ```
 *                  ┌─ mechanical bus ──┐
 * sources ────────►├─ ambient bus ─────┤──► master gain ──► limiter ──► destination
 *                  └─ ui bus ──────────┘
 * ```
 *
 * Discrete sounds are triggered by the simulation's **event stream** — audio never infers
 * that a pin set by watching state. The continuous voices are the one exception the spec
 * itself asks for ("amplitude tracking resistance", "gain tracking dθ/dt"), and their
 * parameters are pushed in by the app each frame rather than pulled.
 *
 * The context is created lazily on the first user gesture, because browsers block it
 * otherwise, and a silent game with no error is a miserable bug to chase.
 */

import type { SimEvent, SimState } from '../sim'
import { COUNTER_ROTATION_FORCE } from '../sim'
import {
  Ambience,
  BindingHum,
  CounterRotationGrind,
  FreePinTone,
  PlugFriction,
  ScrapeNoise,
  SpringTone,
  scheduleClick,
  scheduleFalseSet,
  scheduleOpen,
  scheduleOverset,
  schedulePickStrain,
  schedulePlugFree,
  scheduleReset,
  scheduleUiTick,
} from './synth'

export type BusName = 'mechanical' | 'ambient' | 'ui'

export interface AudioSettings {
  master: number
  mechanical: number
  ambient: number
  ui: number
  /** A real mute: the graph is disconnected, not merely turned down (AUDIO.md §5). */
  muted: boolean
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  master: 0.8,
  mechanical: 1,
  ambient: 0.2,
  ui: 0.7,
  muted: false,
}

/** AUDIO.md §1 — a rake across 12 chambers trivially exceeds any sensible polyphony. */
export const VOICE_CAP = 24

interface Voice {
  gain: GainNode
  endsAt: number
}

/**
 * A deterministic ±4% detune per click, derived from the chamber and tick rather than drawn
 * from the simulation's PRNG — audio must not perturb the sim's random stream, or a replay
 * would diverge purely because the sound played.
 */
export function clickDetune(chamber: number, tick: number): number {
  let h = (chamber * 0x9e3779b1) ^ (tick * 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2545f491)
  h ^= h >>> 13
  return ((h >>> 0) / 4294967296) * 0.08 - 0.04
}

export interface AudioBuses {
  mechanical: GainNode
  /**
   * A sub-bus, inside `mechanical`, carrying only the **continuous** voices — the binding hum, the
   * free-pin tone, the scrape, the spring, the grind, the plug friction.
   *
   * It exists so a one-shot can duck them. Measured, the set click is a 30ms transient at 0.026 RMS
   * and the binding hum is a sustained 0.376 — fourteen times the energy — and the hum is by
   * definition running at full tilt at the exact moment a pin sets, because the pin that sets is
   * the pin you were pushing. The click was not quiet; it was **masked**, which is why it was
   * reported as missing. See DECISIONS D-065.
   */
  continuous: GainNode
  ambient: GainNode
  ui: GainNode
  master: GainNode
  limiter: DynamicsCompressorNode
}

/** How far the continuous bed drops under a click, and for how long. */
export const DUCK_TO = 0.3
export const DUCK_SECONDS = 0.11

/** Build the standard graph on any context — shared by the game and the offline tests. */
export function buildGraph(ctx: BaseAudioContext, settings: AudioSettings): AudioBuses {
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -10
  limiter.knee.value = 6
  limiter.ratio.value = 12
  limiter.attack.value = 0.002
  limiter.release.value = 0.15
  limiter.connect(ctx.destination)

  const master = ctx.createGain()
  master.gain.value = settings.muted ? 0 : settings.master
  master.connect(limiter)

  const make = (level: number): GainNode => {
    const g = ctx.createGain()
    g.gain.value = level
    g.connect(master)
    return g
  }
  const mechanical = make(settings.mechanical)
  const continuous = ctx.createGain()
  continuous.gain.value = 1
  continuous.connect(mechanical)
  return {
    mechanical,
    continuous,
    ambient: make(settings.ambient),
    ui: make(settings.ui),
    master,
    limiter,
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private buses: AudioBuses | null = null
  private voices: Voice[] = []
  private binding: BindingHum | null = null
  private freePin: FreePinTone | null = null
  private scrape: ScrapeNoise | null = null
  private spring: SpringTone | null = null
  private grind: CounterRotationGrind | null = null
  private friction: PlugFriction | null = null
  private ambience: Ambience | null = null
  private lastPickChamber = -1
  private lastPickLift = 0
  private scrapeSpeed = 0
  private connected = true
  /**
   * Whether the continuous layer plays at all (D-085).
   *
   * Off by default. The discrete voices carry the information a player acts on — the click of a pin
   * setting, the cascade of a reset — and the continuous ones are atmosphere. Asked for twice from
   * play, the second time as *"remove sound of pressure, let's leave only clicking sound"*.
   */
  private continuousTones = false
  /** Counts every one-shot ever scheduled, and every one dropped by the cap. */
  readonly stats = { scheduled: 0, stolen: 0 }

  constructor(public settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS }) {}

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running'
  }

  get contextState(): string {
    return this.ctx?.state ?? 'none'
  }

  get activeVoices(): number {
    return this.voices.length
  }

  /**
   * Create the context. Must be called from a user gesture; safe to call repeatedly.
   * Resuming an already-suspended context is handled explicitly rather than hoped for.
   */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.buses = buildGraph(this.ctx, this.settings)
      const t = this.ctx.currentTime
      // The continuous voices go to the duckable sub-bus; one-shots go straight to mechanical.
      const dest = this.buses.continuous
      this.binding = new BindingHum(this.ctx, dest, t)
      this.freePin = new FreePinTone(this.ctx, dest, t)
      this.scrape = new ScrapeNoise(this.ctx, dest, t)
      this.spring = new SpringTone(this.ctx, dest, t)
      this.grind = new CounterRotationGrind(this.ctx, dest, t)
      this.friction = new PlugFriction(this.ctx, dest, t)
      this.ambience = new Ambience(this.ctx, this.buses.ambient, t)
      // Built either way — the graph is cheap and the setting is a toggle, so a player turning it
      // back on mid-attempt should hear it immediately rather than after the next context unlock.
      this.ambience.set(this.continuousTones ? 1 : 0, t)
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  applySettings(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch }
    const b = this.buses
    if (!b || !this.ctx) return
    const t = this.ctx.currentTime
    b.mechanical.gain.setTargetAtTime(this.settings.mechanical, t, 0.02)
    b.ambient.gain.setTargetAtTime(this.settings.ambient, t, 0.02)
    b.ui.gain.setTargetAtTime(this.settings.ui, t, 0.02)
    b.master.gain.setTargetAtTime(this.settings.master, t, 0.02)
    this.setMuted(this.settings.muted)
  }

  /** A real mute: the master is disconnected from the destination. */
  setMuted(muted: boolean): void {
    this.settings.muted = muted
    const b = this.buses
    if (!b) return
    if (muted && this.connected) {
      b.master.disconnect()
      this.connected = false
    } else if (!muted && !this.connected) {
      b.master.connect(b.limiter)
      this.connected = true
    }
  }

  /**
   * Reserve a voice on a bus, stealing the oldest if the cap is reached.
   * Returns the gain node the caller should schedule into, or null when not ready.
   */
  private voice(bus: BusName, duration: number): GainNode | null {
    const ctx = this.ctx
    const buses = this.buses
    if (!ctx || !buses) return null
    const now = ctx.currentTime
    this.voices = this.voices.filter((v) => v.endsAt > now)
    if (this.voices.length >= VOICE_CAP) {
      const oldest = this.voices.shift()
      if (oldest) {
        oldest.gain.gain.cancelScheduledValues(now)
        oldest.gain.gain.setTargetAtTime(0, now, 0.004)
        this.stats.stolen += 1
      }
    }
    const g = ctx.createGain()
    g.gain.value = 1
    g.connect(buses[bus])
    this.voices.push({ gain: g, endsAt: now + duration + 0.05 })
    this.stats.scheduled += 1
    return g
  }

  /** Fold the simulation's events into sound. */
  handleEvents(events: readonly SimEvent[], state: SimState): void {
    const ctx = this.ctx
    if (!ctx || !this.ready) return
    const now = ctx.currentTime
    const n = state.chambers.length
    for (const e of events) {
      switch (e.type) {
        case 'PIN_SET': {
          const g = this.voice('mechanical', 0.15)
          if (g) {
            scheduleClick(ctx, g, now, {
              pinIndex: e.chamber,
              chamberCount: n,
              tension: e.tension,
              detune: clickDetune(e.chamber, state.ticks),
              // Louder, and the bed gets out of its way. Both halves are needed: at its measured
              // 0.026 RMS against a 0.376 hum, raising the click alone would have to be absurd to
              // clear it. Ducking is also the honest reading — the pin that just set is the pin
              // that was humming, so the hum *should* stop (D-065).
              gain: 1.7,
            })
            this.duck(now)
          }
          break
        }
        case 'PIN_OVERSET': {
          const g = this.voice('mechanical', 0.25)
          if (g) scheduleOverset(ctx, g, now)
          break
        }
        case 'FALSE_SET_ENTERED': {
          const g = this.voice('mechanical', 0.55)
          if (g) scheduleFalseSet(ctx, g, now)
          this.ambience?.setLift(1, now)
          break
        }
        case 'RESET': {
          // A counter-rotation drop is only the pins that lost their ledge, not the whole lock, and
          // it wants to sound like fewer things falling — the cascade is as long as the loss (D-081).
          const count = e.kind === 'counter' ? Math.max(1, e.dropped.length) : n
          const g = this.voice('mechanical', count * 0.025 + 0.1)
          if (g) scheduleReset(ctx, g, now, count)
          this.ambience?.setLift(0, now)
          break
        }
        case 'PICK_BENT': {
          const g = this.voice('mechanical', 0.3)
          if (g) schedulePickStrain(ctx, g, now, false)
          this.duck(now)
          break
        }
        case 'PICK_BROKEN': {
          const g = this.voice('mechanical', 0.5)
          if (g) schedulePickStrain(ctx, g, now, true)
          this.duck(now, 0.12, 0.4)
          break
        }
        case 'PLUG_FREE': {
          const g = this.voice('mechanical', 0.4)
          if (g) schedulePlugFree(ctx, g, now)
          break
        }
        case 'LOCK_OPENED': {
          const g = this.voice('mechanical', 1.2)
          if (g) scheduleOpen(ctx, g, now)
          break
        }
        case 'ATTEMPT_STARTED': {
          this.ambience?.setLift(0, now)
          break
        }
        default:
          break
      }
    }
  }

  /**
   * Dip the continuous bed so a one-shot can be heard through it.
   *
   * A short hold and a slower release, so it reads as the room going quiet for the click rather
   * than as a volume glitch. Uses `setTargetAtTime` for the recovery because a linear ramp back up
   * under a decaying transient is audible as a swell.
   */
  duck(when: number, to = DUCK_TO, seconds = DUCK_SECONDS): void {
    const b = this.buses
    if (!b) return
    const g = b.continuous.gain
    g.cancelScheduledValues(when)
    g.setValueAtTime(g.value, when)
    g.linearRampToValueAtTime(to, when + 0.008)
    g.setValueAtTime(to, when + seconds * 0.45)
    g.setTargetAtTime(1, when + seconds * 0.45, seconds * 0.35)
  }

  /** UI detent — menus and buttons. */
  click(): void {
    const ctx = this.ctx
    if (!ctx || !this.ready) return
    const g = this.voice('ui', 0.02)
    if (g) scheduleUiTick(ctx, g, ctx.currentTime)
  }

  /**
   * One mechanical tick per digit of the credit count-up (`ART_DIRECTION.md §6`).
   *
   * Pitched up a little per digit so a four-figure payout climbs as it counts — the same
   * detent the UI uses, so the payoff sounds like the rest of the bench rather than like a
   * slot machine.
   */
  creditTick(index: number): void {
    const ctx = this.ctx
    if (!ctx || !this.ready) return
    const g = this.voice('ui', 0.02)
    if (g) scheduleUiTick(ctx, g, ctx.currentTime, 0.8 + index * 0.12)
  }

  /** Push the continuous parameters. Called once per rendered frame. */
  /**
   * Turn the continuous layer on or off. Silences it immediately when turned off, rather than
   * waiting for the next `update`, so toggling it in Settings is heard at once.
   */
  setContinuousTones(on: boolean): void {
    if (this.continuousTones === on) return
    this.continuousTones = on
    if (!on) {
      this.hush()
      const ctx = this.ctx
      if (ctx) this.ambience?.set(0, ctx.currentTime)
    } else {
      const ctx = this.ctx
      if (ctx) this.ambience?.set(1, ctx.currentTime)
    }
  }

  update(state: SimState, dt: number): void {
    const ctx = this.ctx
    if (!ctx || !this.ready) return
    // Nothing continuous to update, and `setContinuousTones` has already silenced what was playing.
    // The one-shots in `absorb` are untouched: those are the clicks, and they are the point.
    if (!this.continuousTones) return
    const t = ctx.currentTime
    const picked = state.pickChamber >= 0 ? state.chambers[state.pickChamber] : undefined

    const bindingLevel = picked?.state === 'BINDING' ? state.resistance : 0
    this.binding?.set(bindingLevel, t)
    const freeLevel = picked?.state === 'FREE' ? 1 : 0
    this.freePin?.set(freeLevel, t)

    // Scrape tracks how fast the tip is actually moving; it stops the instant the pick does.
    const movedChamber = state.pickChamber !== this.lastPickChamber
    const liftDelta = picked ? Math.abs(picked.lift - this.lastPickLift) : 0
    const instantaneous = movedChamber ? 1 : Math.min(1, liftDelta / Math.max(dt, 1e-4) / 30)
    this.scrapeSpeed = Math.max(instantaneous, this.scrapeSpeed - dt * 8)
    const across =
      state.chambers.length > 1 ? state.pickChamber / (state.chambers.length - 1) : 0
    this.scrape?.set(picked ? this.scrapeSpeed : 0, Math.max(0, across), t)
    this.lastPickChamber = state.pickChamber
    this.lastPickLift = picked?.lift ?? 0

    this.spring?.set(picked?.lift ?? 0, picked ? 1 : 0, t)

    let maxCounter = 0
    for (const c of state.chambers) if (c.counterForce > maxCounter) maxCounter = c.counterForce
    this.grind?.set(maxCounter / (COUNTER_ROTATION_FORCE * 0.5), t)

    this.friction?.set(Math.min(1, Math.abs(state.thetaVelocity) / 0.6), t)
  }

  /** Silence everything without tearing the context down (used on pause). */
  hush(): void {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    this.binding?.set(0, t)
    this.freePin?.set(0, t)
    this.scrape?.set(0, 0, t)
    this.spring?.set(0, 0, t)
    this.grind?.set(0, t)
    this.friction?.set(0, t)
  }

  async dispose(): Promise<void> {
    const ctx = this.ctx
    this.ctx = null
    this.buses = null
    this.voices = []
    if (ctx) await ctx.close()
  }
}
