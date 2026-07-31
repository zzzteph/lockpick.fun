/**
 * `/audio-debug` — AUDIO.md §6.
 *
 * Every sound in the catalogue, rendered through an `OfflineAudioContext`, plotted as a
 * waveform, and measured. It is the Phase 4 screenshot artifact and the fastest way for a
 * human to audit the sound design: press play on any card to hear it.
 *
 * The live `AudioContext` is created on the first play click and not a moment before.
 */

import { SOUNDS, type SoundSpec } from './audio/catalogue'
import { buildGraph, DEFAULT_AUDIO_SETTINGS } from './audio/engine'
import { dominantFrequency, envelope, peak, rms, spectralCentroid } from './audio/analysis'

const SAMPLE_RATE = 44100

export interface RenderedSound {
  spec: SoundSpec
  buffer: AudioBuffer
  peak: number
  rms: number
  centroid: number
  /** Dominant frequency after the transient has passed — the click's *body* pitch. */
  bodyHz: number
  attackMs: number
  durationMs: number
}

/** Render one spec through the standard bus graph, exactly as the game would play it. */
export async function renderSound(spec: SoundSpec, sampleRate = SAMPLE_RATE): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil(spec.seconds * sampleRate), sampleRate)
  const buses = buildGraph(ctx, { ...DEFAULT_AUDIO_SETTINGS, master: 1, ambient: 1, ui: 1 })
  spec.render(ctx, buses.mechanical)
  return ctx.startRendering()
}

export async function measureSound(spec: SoundSpec): Promise<RenderedSound> {
  const buffer = await renderSound(spec)
  const data = buffer.getChannelData(0)
  const env = envelope(data, buffer.sampleRate)
  // Skip the first 8ms so the broadband transient does not mask the body's pitch.
  const bodyStart = Math.min(data.length - 1, Math.round(0.008 * buffer.sampleRate))
  return {
    spec,
    buffer,
    peak: peak(data),
    rms: rms(data),
    centroid: spectralCentroid(data, buffer.sampleRate),
    bodyHz: dominantFrequency(data.slice(bodyStart), buffer.sampleRate),
    attackMs: env.attackSeconds * 1000,
    durationMs: env.durationSeconds * 1000,
  }
}

function drawWaveform(canvas: HTMLCanvasElement, data: Float32Array): void {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = Math.max(1, Math.round(rect.width * dpr))
  canvas.height = Math.max(1, Math.round(rect.height * dpr))
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const w = rect.width
  const h = rect.height
  ctx.clearRect(0, 0, w, h)

  ctx.strokeStyle = '#c9c3b6'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, Math.round(h / 2) + 0.5)
  ctx.lineTo(w, Math.round(h / 2) + 0.5)
  ctx.stroke()

  // Min/max envelope per column — the honest way to plot a signal wider than the canvas.
  const columns = Math.max(1, Math.floor(w))
  const per = data.length / columns
  ctx.strokeStyle = '#1c1b19'
  ctx.beginPath()
  for (let x = 0; x < columns; x += 1) {
    const start = Math.floor(x * per)
    const end = Math.min(data.length, Math.floor((x + 1) * per))
    let min = 0
    let max = 0
    for (let i = start; i < end; i += 1) {
      const v = data[i] as number
      if (v < min) min = v
      if (v > max) max = v
    }
    const cx = x + 0.5
    ctx.moveTo(cx, h / 2 - max * (h / 2) * 0.94)
    ctx.lineTo(cx, h / 2 - min * (h / 2) * 0.94)
  }
  ctx.stroke()
}

export interface SoundMeasurement {
  peak: number
  rms: number
  centroid: number
  bodyHz: number
  attackMs: number
  durationMs: number
}

export interface AudioDebugHook {
  sounds: RenderedSound[]
  ready: boolean
  measurements(): Record<string, SoundMeasurement>
}

declare global {
  var __shearlineAudioDebug: AudioDebugHook | undefined
}

async function main(): Promise<void> {
  const grid = document.getElementById('grid')
  const status = document.getElementById('status')
  if (!grid || !status) return

  let live: AudioContext | null = null
  const rendered: RenderedSound[] = []

  for (const spec of SOUNDS) {
    const card = document.createElement('div')
    card.className = 'card'
    card.dataset['sound'] = spec.id

    const title = document.createElement('h2')
    title.textContent = spec.name
    const desc = document.createElement('p')
    desc.className = 'desc'
    desc.textContent = spec.description
    const canvas = document.createElement('canvas')
    const stats = document.createElement('div')
    stats.className = 'stats'
    const button = document.createElement('button')
    button.textContent = 'play'

    card.append(title, desc, canvas, stats, button)
    grid.append(card)

    const measured = await measureSound(spec)
    rendered.push(measured)
    drawWaveform(canvas, measured.buffer.getChannelData(0))

    const rows: [string, string][] = [
      ['peak', measured.peak.toFixed(3)],
      ['rms', measured.rms.toFixed(4)],
      ['centroid', `${Math.round(measured.centroid)} Hz`],
      ['body', `${Math.round(measured.bodyHz)} Hz`],
      ['duration', `${Math.round(measured.durationMs)} ms`],
      ['attack', `${measured.attackMs.toFixed(1)} ms`],
      ['trigger', spec.event ?? '—'],
      ['kind', spec.kind],
    ]
    for (const [k, v] of rows) {
      const label = document.createElement('span')
      label.textContent = k
      const value = document.createElement('span')
      value.innerHTML = `<b>${v}</b>`
      stats.append(label, value)
    }

    button.addEventListener('click', () => {
      live ??= new AudioContext()
      const ctx = live
      void ctx.resume().then(() => {
        const buses = buildGraph(ctx, { ...DEFAULT_AUDIO_SETTINGS, master: 0.9 })
        spec.render(ctx, buses.mechanical)
        if (spec.kind === 'continuous') {
          // Continuous voices run forever; cut the bus after the plotted window.
          window.setTimeout(() => {
            buses.master.disconnect()
          }, spec.seconds * 1000)
        }
      })
    })
  }

  status.textContent = `${rendered.length} sounds rendered offline at ${SAMPLE_RATE} Hz.`
  globalThis.__shearlineAudioDebug = {
    sounds: rendered,
    ready: true,
    measurements() {
      const out: Record<string, SoundMeasurement> = {}
      for (const r of rendered) {
        out[r.spec.id] = {
          peak: r.peak,
          rms: r.rms,
          centroid: r.centroid,
          bodyHz: r.bodyHz,
          attackMs: r.attackMs,
          durationMs: r.durationMs,
        }
      }
      return out
    },
  }
}

void main()
