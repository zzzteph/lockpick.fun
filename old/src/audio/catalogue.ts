/**
 * The sound catalogue — every entry in AUDIO.md §3, as a renderable spec.
 *
 * One list, used by three things: the `/audio-debug` page draws each one's waveform, the
 * offline tests assert each one's envelope and spectrum, and the engine plays them. If a
 * sound is missing from the game it is missing from here, and the "every event has a sound"
 * test fails.
 */

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

export type SoundKind = 'one-shot' | 'continuous'

export interface SoundSpec {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly kind: SoundKind
  /** How long to render for analysis and for the debug plot. */
  readonly seconds: number
  /** The simulation event that triggers it, if any. */
  readonly event?: string
  render(ctx: BaseAudioContext, dest: AudioNode): void
}

export const SOUNDS: readonly SoundSpec[] = [
  {
    id: 'click-shallow',
    name: 'Click — pin 1, light tension',
    description: 'The sound of the game. Noise transient, triangle body, sine ring.',
    kind: 'one-shot',
    seconds: 0.3,
    event: 'PIN_SET',
    render(ctx, dest) {
      scheduleClick(ctx, dest, 0.01, { pinIndex: 0, chamberCount: 5, tension: 0.2, detune: 0 })
    },
  },
  {
    id: 'click-deep',
    name: 'Click — pin 5, heavy tension',
    description: 'Deeper pin, lower body. Heavy tension: brighter transient, shorter decay.',
    kind: 'one-shot',
    seconds: 0.3,
    event: 'PIN_SET',
    render(ctx, dest) {
      scheduleClick(ctx, dest, 0.01, { pinIndex: 4, chamberCount: 5, tension: 0.9, detune: 0 })
    },
  },
  {
    id: 'overset',
    name: 'Overset',
    description: 'Dull thud. 90Hz sine falling to 62Hz plus lowpassed noise. No ring.',
    kind: 'one-shot',
    seconds: 0.4,
    event: 'PIN_OVERSET',
    render(ctx, dest) {
      scheduleOverset(ctx, dest, 0.01)
    },
  },
  {
    id: 'false-set',
    name: 'False set',
    description: 'Three inharmonic sines at 1.0 / 2.7 / 5.3. The beautiful lie.',
    kind: 'one-shot',
    seconds: 0.7,
    event: 'FALSE_SET_ENTERED',
    render(ctx, dest) {
      scheduleFalseSet(ctx, dest, 0.01)
    },
  },
  {
    id: 'reset',
    name: 'Reset cascade',
    description: 'Soft drops staggered 25ms per chamber, descending.',
    kind: 'one-shot',
    seconds: 0.5,
    event: 'RESET',
    render(ctx, dest) {
      scheduleReset(ctx, dest, 0.01, 5)
    },
  },
  {
    id: 'pick-bent',
    name: 'Pick takes a set',
    description: 'A sour metallic groan gliding down as spring steel gives up its shape.',
    kind: 'one-shot',
    seconds: 0.5,
    event: 'PICK_BENT',
    render(ctx, dest) {
      schedulePickStrain(ctx, dest, 0.01, false)
    },
  },
  {
    id: 'pick-broken',
    name: 'Pick snaps',
    description: 'The same voice cut off in 40ms, with a bright fracture burst over it.',
    kind: 'one-shot',
    seconds: 0.3,
    event: 'PICK_BROKEN',
    render(ctx, dest) {
      schedulePickStrain(ctx, dest, 0.01, true)
    },
  },
  {
    id: 'plug-free',
    name: 'Plug goes slack',
    description: 'A low dull give, gliding 168Hz down to 96Hz. No metal, no attack transient.',
    kind: 'one-shot',
    seconds: 0.4,
    event: 'PLUG_FREE',
    render(ctx, dest) {
      schedulePlugFree(ctx, dest, 0.01)
    },
  },
  {
    id: 'open',
    name: 'Open',
    description: 'Thunk, five-note major pentatonic arpeggio, then the shackle spring.',
    kind: 'one-shot',
    seconds: 1.4,
    event: 'LOCK_OPENED',
    render(ctx, dest) {
      scheduleOpen(ctx, dest, 0.01)
    },
  },
  {
    id: 'ui',
    name: 'UI detent',
    description: '6ms of filtered noise. Nothing musical, nothing cute.',
    kind: 'one-shot',
    seconds: 0.08,
    render(ctx, dest) {
      scheduleUiTick(ctx, dest, 0.005)
    },
  },
  {
    id: 'binding',
    name: 'Binding hum',
    description: 'Low resonant hum, 60-90Hz, amplitude tracking resistance.',
    kind: 'continuous',
    seconds: 0.8,
    render(ctx, dest) {
      const v = new BindingHum(ctx, dest, 0)
      v.set(0.9, 0)
    },
  },
  {
    id: 'free-pin',
    name: 'Free pin',
    description: 'Light and springy with a fast wobble — the opposite texture to binding.',
    kind: 'continuous',
    seconds: 0.8,
    render(ctx, dest) {
      const v = new FreePinTone(ctx, dest, 0)
      v.set(1, 0)
    },
  },
  {
    id: 'counter-rotation',
    name: 'Counter-rotation',
    description: 'Two detuned saws at 45/47Hz through a resonant lowpass. Unpleasant on purpose.',
    kind: 'continuous',
    seconds: 0.8,
    event: 'COUNTER_ROTATION',
    render(ctx, dest) {
      const v = new CounterRotationGrind(ctx, dest, 0)
      v.set(1, 0)
    },
  },
  {
    id: 'scrape',
    name: 'Scrape',
    description: 'Filtered noise driven by pick velocity, sweeping with keyway position.',
    kind: 'continuous',
    seconds: 0.8,
    event: 'PICK_MOVED',
    render(ctx, dest) {
      const v = new ScrapeNoise(ctx, dest, 0)
      v.set(1, 0.5, 0)
    },
  },
  {
    id: 'spring',
    name: 'Spring tension',
    description: 'Quiet sawtooth bed under the pick, pitch rising with lift.',
    kind: 'continuous',
    seconds: 0.8,
    render(ctx, dest) {
      const v = new SpringTone(ctx, dest, 0)
      v.set(2.0, 1, 0)
    },
  },
  {
    id: 'plug-friction',
    name: 'Plug movement',
    description: 'Faint sustained friction, gain tracking dθ/dt.',
    kind: 'continuous',
    seconds: 0.8,
    event: 'PLUG_MOVED',
    render(ctx, dest) {
      const v = new PlugFriction(ctx, dest, 0)
      v.set(1, 0)
    },
  },
  {
    id: 'ambience',
    name: 'Workshop ambience',
    // No drone since D-040: the false-set tell is the low-pass opening, not a note rising.
    description: 'Filtered brown noise. Its low-pass opens on a false set and stays open.',
    kind: 'continuous',
    seconds: 0.8,
    render(ctx, dest) {
      const v = new Ambience(ctx, dest, 0)
      v.set(1, 0)
    },
  },
]

export function soundById(id: string): SoundSpec | undefined {
  return SOUNDS.find((s) => s.id === id)
}

/** Simulation events that must have a sound wired to them (AUDIO.md §3). */
export const SOUNDED_EVENTS = [
  'PIN_SET',
  'PIN_OVERSET',
  'FALSE_SET_ENTERED',
  'COUNTER_ROTATION',
  'PLUG_MOVED',
  'LOCK_OPENED',
  'RESET',
  'PICK_MOVED',
  // Added with the states they announce: the plug going slack (D-055) and the tool giving out
  // (D-068). Listing them here is what makes the 'every event has a sound' test cover them.
  'PLUG_FREE',
  'PICK_BENT',
  'PICK_BROKEN',
] as const
