// Writes web_reference.json: what the web game's own audio code produces in a browser.
//
// The Godot port is checked against the original, and the original only makes sound inside a
// browser. So this runs the web game's modules (old/src/audio, old/src/render/subtitles.ts,
// old/src/ui/haptics.ts) in headless Chromium, renders every sound through an OfflineAudioContext
// at 44.1 kHz, measures each with the game's own old/src/audio/analysis.ts, and writes the
// numbers down. test_audio.gd reads them.
//
// It needs the web game's dev server, and nothing else:
//
//   cd old && npx vite --port 5311 --strictPort --host 127.0.0.1    (leave running)
//   node src/audio/tests/web_reference.mjs      (from the repo root; REF_BASE overrides the URL)
//
// Only needed again if the web game's sounds, captions or vibration patterns change.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '../../../old/package.json'))
const { chromium } = require('@playwright/test')
const BASE = process.env.REF_BASE ?? 'http://127.0.0.1:5311'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`${BASE}/dev/audio-debug.html`)
await page.waitForFunction(() => globalThis.__shearlineAudioDebug?.ready === true, undefined, { timeout: 60000 })

const facts = await page.evaluate(async () => {
  const SR = 44100
  const synth = await import('/src/audio/synth.ts')
  const engine = await import('/src/audio/engine.ts')
  const cat = await import('/src/audio/catalogue.ts')
  const subs = await import('/src/render/subtitles.ts')
  const hap = await import('/src/ui/haptics.ts')
  const an = await import('/src/audio/analysis.ts')
  const input = await import('/src/ui/input.ts')

  const measure = (data) => {
    const env = an.envelope(data, SR)
    // Skip the first 8 ms so a broadband transient does not mask the body's pitch.
    const bodyStart = Math.min(data.length - 1, Math.round(0.008 * SR))
    return {
      samples: data.length,
      peak: an.peak(data),
      rms: an.rms(data),
      centroid: an.spectralCentroid(data, SR),
      dominant: an.dominantFrequency(data, SR),
      bodyHz: an.dominantFrequency(data.slice(bodyStart), SR),
      attackMs: env.attackSeconds * 1000,
      durationMs: env.durationSeconds * 1000,
      bursts: an.countBursts(data, SR),
    }
  }
  const facts = { sampleRate: SR, raw: {}, continuous: {}, warm: {} }

  // ── Each voice straight to the output, scheduled at t = 0: no bus graph, no limiter ──
  async function raw(seconds, fn) {
    const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR)
    fn(ctx, ctx.destination)
    return (await ctx.startRendering()).getChannelData(0)
  }
  async function addRaw(name, seconds, fn, extra = {}) {
    facts.raw[name] = { seconds, ...extra, ...measure(await raw(seconds, fn)) }
  }
  const clicks = [
    [0, 5, 0.2, 0, 1],
    [4, 5, 0.9, 0, 1],
    [2, 6, 0.489, 0, 1],
    [0, 1, 0.5, 0.03, 1],
    [3, 7, 0.12, -0.04, 1],
    [5, 6, 0.95, 0, 1],
    [2, 6, 0.489, 0, 1.7],
    [1, 4, 0, 0, 1],
    [1, 4, 1, 0, 1],
  ]
  for (const [pinIndex, chamberCount, tension, detune, gain] of clicks) {
    await addRaw(`click-${pinIndex}-${chamberCount}-${tension}-${detune}-${gain}`, 0.12, (c, d) => {
      synth.scheduleClick(c, d, 0, { pinIndex, chamberCount, tension, detune, gain })
    }, { pinIndex, chamberCount, tension, detune, gain })
  }
  await addRaw('overset', 0.25, (c, d) => synth.scheduleOverset(c, d, 0))
  await addRaw('false-set', 0.55, (c, d) => synth.scheduleFalseSet(c, d, 0))
  await addRaw('plug-free', 0.38, (c, d) => synth.schedulePlugFree(c, d, 0))
  await addRaw('pick-bent', 0.46, (c, d) => synth.schedulePickStrain(c, d, 0, false))
  await addRaw('pick-broken', 0.26, (c, d) => synth.schedulePickStrain(c, d, 0, true))
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    await addRaw(`reset-${n}`, n * 0.025 + 0.1, (c, d) => synth.scheduleReset(c, d, 0, n), { count: n })
  }
  await addRaw('open', 1.25, (c, d) => synth.scheduleOpen(c, d, 0))
  await addRaw('ui', 0.03, (c, d) => synth.scheduleUiTick(c, d, 0))
  await addRaw('ui-credit-3', 0.03, (c, d) => synth.scheduleUiTick(c, d, 0, 0.8 + 3 * 0.12))

  // The length each schedule function says its sound has.
  {
    const ctx = new OfflineAudioContext(1, SR, SR)
    const d = ctx.destination
    facts.returned = {
      'click-0-5-0.2': synth.scheduleClick(ctx, d, 0, { pinIndex: 0, chamberCount: 5, tension: 0.2, detune: 0 }),
      'click-4-5-0.9': synth.scheduleClick(ctx, d, 0, { pinIndex: 4, chamberCount: 5, tension: 0.9, detune: 0 }),
      overset: synth.scheduleOverset(ctx, d, 0),
      'false-set': synth.scheduleFalseSet(ctx, d, 0),
      'plug-free': synth.schedulePlugFree(ctx, d, 0),
      'pick-bent': synth.schedulePickStrain(ctx, d, 0, false),
      'pick-broken': synth.schedulePickStrain(ctx, d, 0, true),
      'reset-5': synth.scheduleReset(ctx, d, 0, 5),
      open: synth.scheduleOpen(ctx, d, 0),
      ui: synth.scheduleUiTick(ctx, d, 0),
    }
  }

  // ── The sustained voices: the first 0.8 s from silence, and settled, from 1 s in. The settled
  //    level is taken over exactly two seconds: the hum beats against itself once a second and
  //    the grind twice, and a window that is not a whole number of beats measures the beat. ──
  const cont = {
    binding: (c, d) => new synth.BindingHum(c, d, 0).set(0.9, 0),
    'binding-0.3': (c, d) => new synth.BindingHum(c, d, 0).set(0.3, 0),
    'free-pin': (c, d) => new synth.FreePinTone(c, d, 0).set(1, 0),
    'counter-rotation': (c, d) => new synth.CounterRotationGrind(c, d, 0).set(1, 0),
    scrape: (c, d) => new synth.ScrapeNoise(c, d, 0).set(1, 0.5, 0),
    'scrape-0': (c, d) => new synth.ScrapeNoise(c, d, 0).set(1, 0, 0),
    'scrape-1': (c, d) => new synth.ScrapeNoise(c, d, 0).set(1, 1, 0),
    spring: (c, d) => new synth.SpringTone(c, d, 0).set(2.0, 1, 0),
    'spring-0': (c, d) => new synth.SpringTone(c, d, 0).set(0, 1, 0),
    'plug-friction': (c, d) => new synth.PlugFriction(c, d, 0).set(1, 0),
    ambience: (c, d) => new synth.Ambience(c, d, 0).set(1, 0),
    'ambience-open': (c, d) => {
      const a = new synth.Ambience(c, d, 0)
      a.set(1, 0)
      a.setLift(1, 0)
    },
  }
  for (const [name, fn] of Object.entries(cont)) {
    const data = await raw(3.0, fn)
    const settled = data.slice(SR, 3 * SR)
    const window = data.slice(SR, SR + 65536)
    facts.continuous[name] = {
      catalogue: measure(data.slice(0, Math.round(0.8 * SR))),
      steady: { peak: an.peak(settled), rms: an.rms(settled), centroid: an.spectralCentroid(window, SR), dominant: an.dominantFrequency(window, SR) },
    }
  }

  // ── As heard in the game: through its bus graph and limiter at the default settings.
  //    Scheduled a second in, because the context in the game has been running long before any
  //    sound and its limiter has settled; a fresh offline render's has not. ──
  async function warm(name, seconds, bus, fn, settings = {}) {
    const AT = 1.0
    const ctx = new OfflineAudioContext(1, Math.ceil((AT + seconds) * SR), SR)
    const buses = engine.buildGraph(ctx, { ...engine.DEFAULT_AUDIO_SETTINGS, ...settings })
    fn(ctx, buses[bus], AT)
    const data = (await ctx.startRendering()).getChannelData(0).slice(Math.round(AT * SR))
    let energy = 0
    for (const s of data) energy += s * s
    facts.warm[name] = { seconds, bus, energy, ...measure(data) }
  }
  const setClick = (pinIndex, chamberCount, tension) => (c, d, t) =>
    synth.scheduleClick(c, d, t, { pinIndex, chamberCount, tension, detune: 0, gain: 1.7 })
  for (const [pin, count, tension] of [[2, 6, 0.489], [0, 5, 0.2], [4, 5, 0.9]]) {
    await warm(`click-${pin}-${count}-${tension}`, 0.3, 'mechanical', setClick(pin, count, tension))
  }
  await warm('overset', 0.4, 'mechanical', (c, d, t) => synth.scheduleOverset(c, d, t))
  await warm('false-set', 0.7, 'mechanical', (c, d, t) => synth.scheduleFalseSet(c, d, t))
  await warm('plug-free', 0.5, 'mechanical', (c, d, t) => synth.schedulePlugFree(c, d, t))
  await warm('pick-bent', 0.6, 'mechanical', (c, d, t) => synth.schedulePickStrain(c, d, t, false))
  await warm('pick-broken', 0.4, 'mechanical', (c, d, t) => synth.schedulePickStrain(c, d, t, true))
  await warm('reset-6', 0.5, 'mechanical', (c, d, t) => synth.scheduleReset(c, d, t, 6))
  await warm('open', 1.4, 'mechanical', (c, d, t) => synth.scheduleOpen(c, d, t))
  await warm('ui', 0.1, 'ui', (c, d, t) => synth.scheduleUiTick(c, d, t))
  await warm('ui-credit-3', 0.1, 'ui', (c, d, t) => synth.scheduleUiTick(c, d, t, 0.8 + 3 * 0.12))
  await warm('click-2-6-0.489-master1', 0.3, 'mechanical', setClick(2, 6, 0.489), { master: 1 })
  await warm('click-2-6-0.489-master0.3', 0.3, 'mechanical', setClick(2, 6, 0.489), { master: 0.3 })
  await warm('open-master1', 1.4, 'mechanical', (c, d, t) => synth.scheduleOpen(c, d, t), { master: 1 })

  // ── The limiter on its own: a steady 440 Hz tone in at each level, what comes out ──
  facts.limiter = []
  for (const amp of [0.01, 0.05, 0.1, 0.2, 0.3162, 0.4, 0.5, 0.63, 0.8, 1.0, 1.5, 2.0, 3.0]) {
    const ctx = new OfflineAudioContext(1, 2 * SR, SR)
    const buses = engine.buildGraph(ctx, { ...engine.DEFAULT_AUDIO_SETTINGS, master: 1 })
    const o = ctx.createOscillator()
    o.frequency.value = 440
    const g = ctx.createGain()
    g.gain.value = amp
    o.connect(g).connect(buses.mechanical)
    o.start(0)
    const data = (await ctx.startRendering()).getChannelData(0)
    facts.limiter.push({ amp, out: an.peak(data.slice(SR)) })
  }

  // ── The seeded noise ──
  {
    const ctx = new OfflineAudioContext(1, 1, SR)
    const w = synth.whiteNoise(ctx).getChannelData(0)
    const b = synth.brownNoise(ctx).getChannelData(0)
    facts.noise = { length: w.length, white16: Array.from(w.slice(0, 16)), brown16: Array.from(b.slice(0, 16)) }
  }

  // ── Numbers that need no audio at all ──
  facts.constants = {
    VOICE_CAP: engine.VOICE_CAP,
    DUCK_TO: engine.DUCK_TO,
    DUCK_SECONDS: engine.DUCK_SECONDS,
    DEFAULT_AUDIO_SETTINGS: engine.DEFAULT_AUDIO_SETTINGS,
    CLICK_LOW_HZ: synth.CLICK_LOW_HZ,
    CLICK_HIGH_HZ: synth.CLICK_HIGH_HZ,
    FALSE_SET_RATIOS: [...synth.FALSE_SET_RATIOS],
    PENTATONIC: [...synth.PENTATONIC],
    RESET_STAGGER: synth.RESET_STAGGER,
    PLUG_FREE_FROM_HZ: synth.PLUG_FREE_FROM_HZ,
    PLUG_FREE_TO_HZ: synth.PLUG_FREE_TO_HZ,
    AMBIENT_BED_HZ: synth.AMBIENT_BED_HZ,
    AMBIENT_BED_OPEN_HZ: synth.AMBIENT_BED_OPEN_HZ,
    SOUNDED_EVENTS: [...cat.SOUNDED_EVENTS],
    CAPTION_SECONDS: subs.CAPTION_SECONDS,
    MAX_CAPTIONS: subs.MAX_CAPTIONS,
    SILENT_EVENTS: [...subs.SILENT_EVENTS],
    PATTERNS: hap.PATTERNS,
    MIN_GAP_MS: hap.MIN_GAP_MS,
    tensionSteps: Array.from({ length: 10 }, (_, i) => input.tensionForStep(i + 1)),
  }
  facts.catalogue = cat.SOUNDS.map((s) => ({ id: s.id, name: s.name, description: s.description, kind: s.kind, seconds: s.seconds, event: s.event ?? null }))
  facts.clickBody = []
  for (let n = 1; n <= 12; n += 1) for (let i = 0; i < n; i += 1) facts.clickBody.push([i, n, synth.clickBodyFrequency(i, n)])
  facts.clickDetune = []
  for (const ch of [0, 1, 2, 3, 5, 7, 11]) for (const tick of [0, 1, 2, 7, 100, 119, 120, 4321, 86400, 1000003]) facts.clickDetune.push([ch, tick, engine.clickDetune(ch, tick)])

  // ── Captions ──
  const events = [
    { type: 'ATTEMPT_STARTED', time: 0 },
    { type: 'PIN_SET', chamber: 0, tension: 0.5, time: 0 },
    { type: 'PIN_SET', chamber: 4, tension: 0.5, time: 0 },
    { type: 'PIN_OVERSET', chamber: 2, time: 0 },
    { type: 'FALSE_SET_ENTERED', chamber: 1, depth: 0.1, time: 0 },
    { type: 'COUNTER_ROTATION', chamber: 1, force: 1, time: 0 },
    { type: 'PLUG_MOVED', theta: 0.1, velocity: 0.2, time: 0 },
    { type: 'LOCK_OPENED', time: 3, ticks: 360 },
    { type: 'PLUG_FREE', time: 0 },
    { type: 'PICK_BENT', time: 0 },
    { type: 'PICK_BROKEN', time: 0 },
    { type: 'RESET', kind: 'full', dropped: [0, 1, 2], time: 0 },
    { type: 'RESET', kind: 'counter', dropped: [3], time: 0 },
    { type: 'RESET', kind: 'counter', dropped: [3, 4], time: 0 },
    { type: 'RESET', kind: 'feather', dropped: [1], time: 0 },
    { type: 'RESET', kind: 'feather', dropped: [1, 2, 5], time: 0 },
    { type: 'PICK_MOVED', from: 0, to: 1, time: 0 },
  ]
  facts.captions = events.map((e) => ({ event: e, line: subs.captionFor(e) }))
  facts.sustained = [
    [0, 0], [4, 0], [3, 0], [3.01, 0.5], [0, 0.15], [0, 0.16], [0, -0.3], [2, 0.1],
  ].map(([c, v]) => ({ counter: c, velocity: v, line: subs.sustainedCaption(c, v) }))
  // A scripted run through the real subtitle track: what is on screen after each step.
  {
    const s = subs.createSubtitles()
    const script = [
      { dt: 0, events: [events[1]], counter: 0, velocity: 0 },
      { dt: 0.5, events: [events[3]], counter: 0, velocity: 0 },
      { dt: 0.5, events: [], counter: 0, velocity: 0.3 },
      { dt: 0.5, events: [], counter: 0, velocity: 0.3 },
      { dt: 0.5, events: [events[4], events[11]], counter: 5, velocity: 0.3 },
      { dt: 0.3, events: [events[2], events[8]], counter: 5, velocity: 0 },
      { dt: 0.3, events: [], counter: 0, velocity: 0 },
      { dt: 1.0, events: [], counter: 0, velocity: 0.3 },
      { dt: 1.0, events: [events[7]], counter: 0, velocity: 0 },
      { dt: 2.0, events: [], counter: 0, velocity: 0 },
      { dt: 0.3, events: [], counter: 0, velocity: 0 },
    ]
    facts.captionScript = []
    for (const step of script) {
      subs.pushSubtitleEvents(s, step.events)
      subs.updateSubtitles(s, step.dt, step.counter, step.velocity)
      facts.captionScript.push({
        dt: step.dt,
        events: step.events,
        counter: step.counter,
        velocity: step.velocity,
        lines: s.captions.map((c) => c.text),
        kinds: s.captions.map((c) => c.kind),
        life: s.captions.map((c) => c.life),
      })
    }
  }

  // ── Haptics: what the motor is asked for, through a stub ──
  {
    let clock = 0
    const fired = []
    const stub = { vibrate: (p) => { fired.push({ at: clock, pattern: Array.isArray(p) ? [...p] : [p] }); return true } }
    const h = new hap.Haptics(stub, () => clock)
    h.enabled = true
    const steps = [
      [0, [events[1]]],
      [20, [events[3]]],
      [60, [events[3]]],
      [200, [events[11], events[1], events[4]]],
      [300, [events[4]]],
      [400, [events[8]]],
      [500, [events[10]]],
      [600, [events[9], events[16], events[6], events[5], events[0]]],
      [700, [events[7]]],
      [800, 'detent'],
      [820, 'detent'],
      [850, 'detent'],
    ]
    for (const [at, what] of steps) {
      clock = at
      if (what === 'detent') h.detent()
      else h.handleEvents(what)
    }
    facts.haptics = { steps: steps.map(([at, what]) => ({ at, what })), fired }
  }

  return facts
})

await browser.close()

const about =
  'What the web game produces when its audio, caption and haptics modules run in Chromium. ' +
  '"raw" is each voice straight to the output; "continuous" is each sustained voice ("catalogue" = its first 0.8 s ' +
  'from silence, "steady" = settled, from 1 s in: level over two seconds, spectrum over 65536 samples); "warm" is each sound through the game\'s bus graph and limiter ' +
  'at default settings with the limiter already settled, "energy" the sum of its squared samples. ' +
  'Written by web_reference.mjs — do not edit.'
const path = join(here, 'web_reference.json')
writeFileSync(path, JSON.stringify({ _about: about, ...facts }, null, 1) + '\n')
console.log('wrote', path)
