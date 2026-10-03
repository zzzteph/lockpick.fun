class_name SfxSynth
extends RefCounted
## Every sound in the game, computed: a few oscillators and a noise buffer.
##
## No samples, no files, no licences, no loading. Lock sounds are short, percussive and
## metallic — exactly what subtractive synthesis is good at — and because each one is
## generated, a click can vary with the pin it came from and the weight on the wrench instead
## of replaying the same 40 ms for the thousandth time.
##
## Each voice here returns its samples as floats at 44.1 kHz, at the level it is meant to be
## heard at. Nothing in this file touches the audio server, so the code that plays in the game
## is the code the tests render and measure.
##
## The sounds were designed on a Web Audio graph, and the arithmetic here is that graph written
## out: an oscillator is a phase that advances by its frequency each sample, a gain envelope is
## a straight line up and an exponential down, a filter is the textbook biquad. Rendered side
## by side, the two agree to a fraction of a percent.

const RATE := 44100
## Where every decay is aimed: -80 dB. An exponential cannot reach zero, so it stops here.
const FLOOR := 0.0001

const NOISE_SECONDS := 2
## The noise is seeded, so a rendered sound is the same on every machine and every run.
const WHITE_SEED := 0x5ea21e
const BROWN_SEED := 0xb2011
## How much white noise the one-shots ever read. Short, so the first sound of a session does
## not wait for two seconds of noise it will never use.
const HEAD_SAMPLES := 11025

# ── The click ───────────────────────────────────────────────────────────────────────────
const CLICK_LOW_HZ := 180.0
const CLICK_HIGH_HZ := 420.0

# ── The rest of the palette ─────────────────────────────────────────────────────────────
const FALSE_SET_HZ := 620.0
## Inharmonic on purpose: three partials that belong to no one note read as struck metal.
const FALSE_SET_RATIOS: Array[float] = [1.0, 2.7, 5.3]
const PLUG_FREE_FROM_HZ := 168.0
const PLUG_FREE_TO_HZ := 96.0
## Seconds between one pin dropping and the next in a reset.
const RESET_STAGGER := 0.025
## Major pentatonic, for the open arpeggio.
const PENTATONIC: Array[float] = [1.0, 9.0 / 8.0, 5.0 / 4.0, 3.0 / 2.0, 5.0 / 3.0]
const OPEN_ROOT_HZ := 392.0
const OPEN_ARPEGGIO_AT := 0.28
const OPEN_STEP := 0.085
## Cutoff of the room bed's low-pass. Closed at rest, open on a false set.
const AMBIENT_BED_HZ := 420.0
const AMBIENT_BED_OPEN_HZ := 760.0

enum { SINE, TRIANGLE, SAW }
## A browser's sawtooth is band-limited and then scaled until its overshoot peaks at 1, which
## leaves the ramp itself this tall. The levels in this file were chosen by ear against that
## sawtooth, so this one is the same height.
const SAW_LEVEL := 0.8485

const _MASK := 0xFFFFFFFF

var _lock := Mutex.new()
var _head := PackedFloat32Array()
var _white := PackedFloat32Array()
var _brown := PackedFloat32Array()


# ── Noise ───────────────────────────────────────────────────────────────────────────────

## The first `n` samples of the white noise, as a copy the caller may filter in place.
func noise(n: int) -> PackedFloat32Array:
	_lock.lock()
	var head := _head
	_lock.unlock()
	if head.is_empty():
		# Made outside the lock: two threads may both make it once, and neither waits.
		head = white_noise_from(WHITE_SEED, HEAD_SAMPLES)
		_lock.lock()
		_head = head
		_lock.unlock()
	return head.slice(0, n)


## Two seconds of white noise: the scrape's source, looped.
func white_noise() -> PackedFloat32Array:
	_lock.lock()
	var white := _white
	_lock.unlock()
	if white.is_empty():
		white = white_noise_from(WHITE_SEED, NOISE_SECONDS * RATE)
		_lock.lock()
		_white = white
		_lock.unlock()
	return white


## Two seconds of brown noise: the workshop bed and the plug's friction.
func brown_noise() -> PackedFloat32Array:
	_lock.lock()
	var brown := _brown
	_lock.unlock()
	if brown.is_empty():
		brown = white_noise_from(BROWN_SEED, NOISE_SECONDS * RATE)
		var last := 0.0
		for i in brown.size():
			last = (last + 0.02 * brown[i]) / 1.02
			brown[i] = last * 3.5
		_lock.lock()
		_brown = brown
		_lock.unlock()
	return brown


## Uniform noise in [-1, 1) from the game's generator — xorshift128 seeded through splitmix32,
## the same stream the web game's noise buffers hold, written out here so the loop that fills
## 88 200 samples makes no calls.
static func white_noise_from(seed_value: int, n: int) -> PackedFloat32Array:
	var s := seed_value & _MASK
	var state: Array[int] = []
	for i in 4:
		s = (s + 0x9E3779B9) & _MASK
		var m := s ^ (s >> 16)
		m = (m * 0x21F0AAAD) & _MASK
		m = m ^ (m >> 15)
		m = (m * 0x735A2D97) & _MASK
		state.append((m ^ (m >> 15)) & _MASK)
	var a := state[0]
	var b := state[1]
	var c := state[2]
	var d := state[3]
	if (a | b | c | d) == 0:
		a = 0x9E3779B9
	var out := PackedFloat32Array()
	out.resize(n)
	for i in n:
		var t := (a ^ (a << 11)) & _MASK
		t = t ^ (t >> 8)
		a = b
		b = c
		c = d
		d = (d ^ (d >> 19) ^ t) & _MASK
		out[i] = float(d) / 4294967296.0 * 2.0 - 1.0
	return out


# ── Building blocks ─────────────────────────────────────────────────────────────────────

static func frames(seconds: float) -> int:
	return ceili(seconds * RATE - 1e-9)


static func silence(seconds: float) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(frames(seconds))
	return out


## `n` samples of an oscillator starting at phase zero, at full height. With `to_hz` and
## `glide` its pitch slides exponentially from `hz` to `to_hz` over `glide` seconds and holds.
static func wave(shape: int, n: int, hz: float, to_hz := 0.0, glide := 0.0) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(n)
	var gliding := to_hz > 0.0 and glide > 0.0 and to_hz != hz
	var ratio := pow(to_hz / hz, 1.0 / (glide * RATE)) if gliding else 1.0
	var glide_n := glide * RATE
	var f := hz
	match shape:
		SINE:
			var p := 0.0
			for i in n:
				out[i] = sin(TAU * p)
				p += f / RATE
				if gliding:
					f = f * ratio if i + 1 < glide_n else to_hz
		TRIANGLE:
			# Phase is kept a quarter-cycle ahead, so the fold starts at zero, rising.
			var q := 0.25
			for i in n:
				out[i] = _triangle(q, f / RATE)
				q += f / RATE
				if q >= 1.0:
					q -= 1.0
				if gliding:
					f = f * ratio if i + 1 < glide_n else to_hz
		SAW:
			# Half a cycle ahead: the ramp starts at zero and the step falls at q = 0.
			var q := 0.5
			for i in n:
				out[i] = _saw(q, f / RATE)
				q += f / RATE
				if q >= 1.0:
					q -= 1.0
				if gliding:
					f = f * ratio if i + 1 < glide_n else to_hz
	return out


## One sample of a triangle whose corners are rounded over a sample either side (polyBLAMP),
## for the same reason the sawtooth's step is: a sharp corner carries partials past the top of
## the band, and they fold back.
static func _triangle(q: float, dt: float) -> float:
	var v := 1.0 - 4.0 * absf(q - 0.5)
	var d := absf(q - 0.5) / dt
	if d < 1.0:
		d = 1.0 - d
		v -= dt * d * d * d * (8.0 / 6.0)
	elif q < dt:
		d = 1.0 - q / dt
		v += dt * d * d * d * (8.0 / 6.0)
	elif q > 1.0 - dt:
		d = 1.0 - (1.0 - q) / dt
		v += dt * d * d * d * (8.0 / 6.0)
	return v


## One sample of a sawtooth whose step is rounded over a sample either side (polyBLEP). A bare
## ramp's step aliases — partials fold back from above the top of the band as tones that belong
## to nothing — and the sawtooth these sounds were designed on is band-limited.
static func _saw(q: float, dt: float) -> float:
	var v := 2.0 * q - 1.0
	if q < dt:
		var x := q / dt
		v -= x + x - x * x - 1.0
	elif q > 1.0 - dt:
		var x := (q - 1.0) / dt
		v -= x * x + x + x + 1.0
	return v * SAW_LEVEL


## Adds `src` to `out` from sample `at`, under the gain curve every one-shot voice uses: `from`
## at the start, a straight line to `peak` at `attack` seconds, an exponential fall to the floor
## at `end` seconds, and the floor after that.
static func mix(out: PackedFloat32Array, at: int, src: PackedFloat32Array, peak: float, attack: float, end: float, from := 0.0) -> void:
	var n := mini(src.size(), out.size() - at)
	var a := attack * RATE
	var e := end * RATE
	var rise := mini(n, ceili(a))
	var fall := mini(n, ceili(e))
	var slope := (peak - from) / a if a > 0.0 else 0.0
	var i := 0
	while i < rise:
		out[at + i] += src[i] * (from + slope * i)
		i += 1
	if i < fall:
		var ratio := pow(FLOOR / peak, 1.0 / (e - a))
		var g := peak * pow(FLOOR / peak, (i - a) / (e - a))
		while i < fall:
			out[at + i] += src[i] * g
			g *= ratio
			i += 1
	while i < n:
		out[at + i] += src[i] * FLOOR
		i += 1


## Runs a biquad over `buf` in place. `c` is b0, b1, b2, a1, a2, already divided by a0.
static func biquad(buf: PackedFloat32Array, c: PackedFloat64Array) -> void:
	var b0 := c[0]
	var b1 := c[1]
	var b2 := c[2]
	var a1 := c[3]
	var a2 := c[4]
	var x1 := 0.0
	var x2 := 0.0
	var y1 := 0.0
	var y2 := 0.0
	for i in buf.size():
		var x: float = buf[i]
		var y := b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
		x2 = x1
		x1 = x
		y2 = y1
		y1 = y
		buf[i] = y


## Low-pass. `q_db` is the height of the resonant peak at the cutoff, in decibels.
static func lowpass(hz: float, q_db := 1.0) -> PackedFloat64Array:
	var w := TAU * hz / RATE
	var alpha := sin(w) / (2.0 * pow(10.0, q_db / 20.0))
	var c := cos(w)
	var a0 := 1.0 + alpha
	return PackedFloat64Array([(1.0 - c) / 2.0 / a0, (1.0 - c) / a0, (1.0 - c) / 2.0 / a0, -2.0 * c / a0, (1.0 - alpha) / a0])


static func highpass(hz: float, q_db := 1.0) -> PackedFloat64Array:
	var w := TAU * hz / RATE
	var alpha := sin(w) / (2.0 * pow(10.0, q_db / 20.0))
	var c := cos(w)
	var a0 := 1.0 + alpha
	return PackedFloat64Array([(1.0 + c) / 2.0 / a0, -(1.0 + c) / a0, (1.0 + c) / 2.0 / a0, -2.0 * c / a0, (1.0 - alpha) / a0])


## Band-pass with unity gain at its centre. `q` is centre frequency over bandwidth.
static func bandpass(hz: float, q: float) -> PackedFloat64Array:
	var w := TAU * hz / RATE
	var alpha := sin(w) / (2.0 * q)
	var a0 := 1.0 + alpha
	return PackedFloat64Array([alpha / a0, 0.0, -alpha / a0, -2.0 * cos(w) / a0, (1.0 - alpha) / a0])


## A band-pass whose centre moves towards `to_hz` as it runs, in place. With `glide` the move
## is an exponential slide that arrives after `glide` seconds; with `tau` it is an approach that
## never quite arrives, the way a control eased by hand does.
static func bandpass_moving(buf: PackedFloat32Array, hz: float, to_hz: float, q: float, glide: float, tau := 0.0) -> void:
	var ratio := pow(to_hz / hz, 1.0 / (glide * RATE)) if glide > 0.0 else 1.0
	var glide_n := glide * RATE
	var k := 1.0 - exp(-1.0 / (RATE * tau)) if tau > 0.0 else 0.0
	var f := hz
	var x1 := 0.0
	var x2 := 0.0
	var y1 := 0.0
	var y2 := 0.0
	for i in buf.size():
		var w := TAU * f / RATE
		var alpha := sin(w) / (2.0 * q)
		var a0 := 1.0 + alpha
		var x: float = buf[i]
		var y := (alpha * (x - x2) + 2.0 * cos(w) * y1 - (1.0 - alpha) * y2) / a0
		x2 = x1
		x1 = x
		y2 = y1
		y1 = y
		buf[i] = y
		if tau > 0.0:
			f += (to_hz - f) * k
		else:
			f = f * ratio if i + 1 < glide_n else to_hz


## Fades `buf` in towards `level`, in place: a sustained voice asked for a level from silence
## closes two-thirds of the gap every `tau` seconds.
static func swell(buf: PackedFloat32Array, level: float, tau: float) -> void:
	var k := 1.0 - exp(-1.0 / (RATE * tau))
	var g := 0.0
	for i in buf.size():
		buf[i] *= g
		g += (level - g) * k


# ── The click — the sound of the game ───────────────────────────────────────────────────

## Body frequency for a pin — the signal a player learns to hear. Pin 0 is nearest the keyway's
## mouth; deeper pins sound lower.
static func click_body_frequency(pin: int, count: int, detune := 0.0) -> float:
	var span := maxi(1, count - 1)
	var t := clampf(float(pin) / float(span), 0.0, 1.0)
	return (CLICK_HIGH_HZ - (CLICK_HIGH_HZ - CLICK_LOW_HZ) * t) * (1.0 + detune)


static func click_seconds(tension: float) -> float:
	var t := clampf(tension, 0.0, 1.0)
	return maxf(0.045 * (1.0 - t * 0.35), 0.09 * (1.0 - t * 0.4)) + 0.01


## Three layers: a 4 ms burst of filtered noise, a triangle body that drops 12% in pitch over
## 30 ms, and a sine ring two octaves above it. Heavy tension sounds tight and dead — a brighter
## transient and shorter decays; light tension sounds open and ringing.
func click(pin: int, count: int, tension: float, detune := 0.0, gain := 1.0) -> PackedFloat32Array:
	var t := clampf(tension, 0.0, 1.0)
	var body := click_body_frequency(pin, count, detune)
	var body_decay := 0.045 * (1.0 - t * 0.35)
	var ring_decay := 0.09 * (1.0 - t * 0.4)
	var out := silence(click_seconds(t))

	var burst := noise(frames(0.02))
	biquad(burst, bandpass(2400.0 * (1.0 + t * 0.6), 8.0))
	mix(out, 0, burst, 1.1 * gain, 0.002, 0.006)
	mix(out, 0, wave(TRIANGLE, frames(body_decay + 0.01), body, body * 0.88, 0.03), 0.95 * gain, 0.003, body_decay)
	mix(out, 0, wave(SINE, frames(ring_decay + 0.01), body * 4.0), 0.22 * gain, 0.004, ring_decay)
	return out


# ── The rest of the palette ─────────────────────────────────────────────────────────────

const OVERSET_SECONDS := 0.22

## Overset: a dull thud, a 90 Hz sine falling to 62 with heavily low-passed noise under it.
## No ring. Dead and final.
func overset(gain := 1.0) -> PackedFloat32Array:
	var out := silence(OVERSET_SECONDS + 0.01)
	mix(out, 0, wave(SINE, out.size(), 90.0, 62.0, 0.12), 0.85 * gain, 0.006, OVERSET_SECONDS)
	var thud := noise(frames(0.16))
	biquad(thud, lowpass(240.0, 0.7))
	mix(out, 0, thud, 0.5 * gain, 0.004, 0.14)
	return out


const STRIKE_SECONDS := 0.16

## The snap gun going off: the blade's slap on the pins, and the thump of the gun behind it.
##
## The one sound here the hand makes rather than the lock, and the only one with a size: `power`
## (0..1.5, 1 a full strike) is how far the needle was drawn back, and a harder strike is louder,
## brighter in its slap and longer in its thump — so a strike is heard before it is read.
func strike(power: float, gain := 1.0) -> PackedFloat32Array:
	var p := clampf(power, 0.0, 1.5)
	var out := silence(STRIKE_SECONDS + 0.01)
	var slap := noise(frames(0.04))
	biquad(slap, bandpass(1500.0 + 900.0 * p, 2.5))
	mix(out, 0, slap, (0.3 + 0.5 * p) * gain, 0.001, 0.018 + 0.012 * p)
	mix(out, 0, wave(SINE, out.size(), 140.0 + 40.0 * p, 78.0, 0.09), (0.22 + 0.42 * p) * gain, 0.003, 0.07 + 0.055 * p)
	return out


const FALSE_SET_SECONDS := 0.5

## False set: a bright metallic ping from three inharmonic sines, each partial quieter and
## shorter than the one below it. The audio lies exactly as the plug does.
func false_set(gain := 1.0) -> PackedFloat32Array:
	var out := silence(FALSE_SET_SECONDS + 0.01)
	for i in FALSE_SET_RATIOS.size():
		var level := 0.34 / float(i + 1) * gain
		mix(out, 0, wave(SINE, out.size(), FALSE_SET_HZ * FALSE_SET_RATIOS[i]), level, 0.004, FALSE_SET_SECONDS * (1.0 - i * 0.22))
	return out


const PLUG_FREE_SECONDS := 0.34

## The plug going slack: a low, dull give with no metal in it at all.
##
## This is the sound of resistance disappearing, the opposite of every other cue in the game —
## the click, the false-set ping and the overset are all impacts. So it is built the other way
## round: a short downward glide on a low-passed triangle, no inharmonic partials, and a 40 ms
## attack so it reads as a release rather than a knock. Nothing rings, because nothing struck
## anything; the plug simply stopped being held.
func plug_free(gain := 1.0) -> PackedFloat32Array:
	var out := silence(PLUG_FREE_SECONDS + 0.01)
	var give := wave(TRIANGLE, out.size(), PLUG_FREE_FROM_HZ, PLUG_FREE_TO_HZ, PLUG_FREE_SECONDS * 0.8)
	biquad(give, lowpass(420.0))
	mix(out, 0, give, 0.3 * gain, 0.04, PLUG_FREE_SECONDS)
	return out


static func pick_strain_seconds(broken: bool) -> float:
	return 0.22 if broken else 0.42


## The pick giving up: a metallic groan that bends, or a snap that does not.
##
## Both are the tool rather than the lock, so both are unlike anything a chamber makes: a
## sawtooth through a resonant band-pass, thin and sour where every lock sound is a click or a
## thud. The bend glides down and fades — steel taking a set. The break is the same voice cut
## off in 40 ms with a burst of bright noise over it, because a snap has no decay.
func pick_strain(broken: bool, gain := 1.0) -> PackedFloat32Array:
	var seconds := pick_strain_seconds(broken)
	var out := silence(seconds + 0.01)
	var groan := wave(SAW, out.size(), 900.0 if broken else 520.0, 240.0 if broken else 300.0, seconds * 0.7)
	biquad(groan, bandpass(1500.0 if broken else 780.0, 7.0))
	mix(out, 0, groan, 0.34 * gain, 0.003 if broken else 0.05, seconds)
	if broken:
		# The fracture itself: a very short burst of bright noise, at full level from its first
		# sample, no tail.
		var crack := noise(frames(0.06))
		biquad(crack, highpass(2600.0))
		mix(out, 0, crack, 0.5 * gain, 0.0, 0.04)
	return out


static func reset_seconds(count: int) -> float:
	return maxi(1, count) * RESET_STAGGER + 0.09


## Reset: a cascade of soft drops, one per pin, 25 ms apart and each a little lower than the
## last. The cascade is as long as the loss, so one pin falling does not sound like six.
func reset(count: int, gain := 1.0) -> PackedFloat32Array:
	var n := maxi(1, count)
	var out := silence(reset_seconds(n))
	var drop := frames(0.09)
	for i in n:
		var hz := 260.0 - i * 18.0
		mix(out, roundi(i * RESET_STAGGER * RATE), wave(SINE, drop, hz, hz * 0.7, 0.05), 0.3 * gain, 0.003, 0.07)
	return out


const OPEN_SECONDS := OPEN_ARPEGGIO_AT + 5 * OPEN_STEP + 0.22

## Open: a deep mechanical thunk, a five-note ascending arpeggio, then the shackle spring — a
## short burst of noise swept upwards.
func open(gain := 1.0) -> PackedFloat32Array:
	var out := silence(OPEN_SECONDS)
	mix(out, 0, wave(SINE, frames(0.37), 70.0, 48.0, 0.18), 0.95 * gain, 0.006, 0.35)
	var thunk := noise(frames(0.18))
	biquad(thunk, lowpass(400.0))
	mix(out, 0, thunk, 0.4 * gain, 0.004, 0.16)

	var note := frames(0.32)
	for i in PENTATONIC.size():
		var at := roundi((OPEN_ARPEGGIO_AT + i * OPEN_STEP) * RATE)
		mix(out, at, wave(TRIANGLE, note, OPEN_ROOT_HZ * PENTATONIC[i]), 0.28 * gain, 0.008, 0.3)

	var spring := noise(frames(0.22))
	bandpass_moving(spring, 700.0, 4200.0, 4.0, 0.16)
	mix(out, roundi((OPEN_ARPEGGIO_AT + PENTATONIC.size() * OPEN_STEP) * RATE), spring, 0.35 * gain, 0.02, 0.2)
	return out


const UI_TICK_SECONDS := 0.006

## UI: a tiny mechanical detent, 6 ms of filtered noise. Nothing musical, nothing cute.
## Narrow-band noise loses most of its energy in the filter; the raw gain is high so the detent
## lands at a level comparable to everything else.
func ui_tick(gain := 1.0) -> PackedFloat32Array:
	var out := silence(0.02)
	var tick := noise(out.size())
	biquad(tick, bandpass(3200.0, 6.0))
	mix(out, 0, tick, 2.6 * gain, 0.001, UI_TICK_SECONDS)
	return out


# ── Sustained voices ────────────────────────────────────────────────────────────────────
#
# The one place audio follows the lock's state rather than its events, because "amplitude
# tracking resistance" is not something an event can say. Each function below renders a voice
# from silence, asked once for the given setting — how it sounds as it comes in. In the game the
# same voices run as loops through the mixer's own filters (see sfx.gd); these renders are what
# those are measured against.

const LEVEL_TAU := 0.04 / 3.0


## A sawtooth whose pitch eases from `hz` towards `to_hz`.
static func _saw_towards(n: int, hz: float, to_hz: float, tau: float) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(n)
	var k := 1.0 - exp(-1.0 / (RATE * tau))
	var f := hz
	var q := 0.5
	for i in n:
		out[i] = _saw(q, f / RATE)
		q += f / RATE
		if q >= 1.0:
			q -= 1.0
		f += (to_hz - f) * k
	return out


static func _add(out: PackedFloat32Array, src: PackedFloat32Array) -> void:
	for i in mini(out.size(), src.size()):
		out[i] += src[i]


static func _tiled(src: PackedFloat32Array, n: int) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(n)
	var m := src.size()
	for i in n:
		out[i] = src[i % m]
	return out


## Binding: a low resonant hum, the sawtooth rising from 60 to 90 Hz with resistance over a
## fixed 88 Hz sine. How a player finds the binding pin by ear.
func binding_hum(seconds: float, resistance: float) -> PackedFloat32Array:
	var n := frames(seconds)
	var out := _saw_towards(n, 62.0, 60.0 + resistance * 30.0, 0.08 / 3.0)
	_add(out, wave(SINE, n, 88.0))
	biquad(out, lowpass(220.0, 8.0))
	swell(out, maxf(0.0, resistance) * 0.34, LEVEL_TAU)
	return out


## One second of the free-pin tone at full height: a triangle at 210 Hz with an 11 Hz wobble
## of 18 Hz either way. A whole number of cycles of both, so it loops without a seam.
static func free_pin_cycle(n := RATE) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(n)
	var q := 0.25
	for i in n:
		var dt := (210.0 + 18.0 * sin(TAU * 11.0 * i / RATE)) / RATE
		out[i] = _triangle(q, dt)
		q += dt
		if q >= 1.0:
			q -= 1.0
	return out


## Free pin: light, springy, higher — deliberately the opposite texture to binding.
func free_pin(seconds: float, amount: float) -> PackedFloat32Array:
	var out := free_pin_cycle(frames(seconds))
	swell(out, maxf(0.0, amount) * 0.16, LEVEL_TAU)
	return out


## Counter-rotation at full height: two sawtooths at 45 and 47 Hz, beating twice a second,
## through a resonant low-pass. Physical and unpleasant, which is the point.
static func grind_cycle(n: int) -> PackedFloat32Array:
	var out := wave(SAW, n, 45.0)
	_add(out, wave(SAW, n, 47.0))
	biquad(out, lowpass(320.0, 6.0))
	return out


func grind(seconds: float, force: float) -> PackedFloat32Array:
	var out := grind_cycle(frames(seconds))
	swell(out, clampf(force, 0.0, 1.0) * 0.3, LEVEL_TAU)
	return out


## Scrape: band-passed noise driven by how fast the tip is moving, its centre sweeping from 800
## to 3000 Hz with the tip's position along the keyway. `speed` and `position` are 0..1.
func scrape(seconds: float, speed: float, position: float) -> PackedFloat32Array:
	var out := _tiled(white_noise(), frames(seconds))
	bandpass_moving(out, 1200.0, 800.0 + position * 2200.0, 1.4, 0.0, 0.05 / 3.0)
	swell(out, maxf(0.0, speed) * 0.16, 0.008)
	return out


## Spring tension: a quiet sawtooth bed under the pick, its pitch rising with lift (mm).
func spring(seconds: float, lift: float, level: float) -> PackedFloat32Array:
	var out := _saw_towards(frames(seconds), 120.0, 110.0 + maxf(0.0, lift) * 46.0, 0.06 / 3.0)
	biquad(out, lowpass(900.0))
	swell(out, maxf(0.0, level) * 0.06, LEVEL_TAU)
	return out


## Plug movement at full height: brown noise through a band-pass at 460 Hz.
func plug_friction_cycle(n: int) -> PackedFloat32Array:
	var out := _tiled(brown_noise(), n)
	biquad(out, bandpass(460.0, 2.5))
	return out


## Plug movement: faint sustained friction, its level following how fast the plug turns.
func plug_friction(seconds: float, speed: float) -> PackedFloat32Array:
	var out := plug_friction_cycle(frames(seconds))
	swell(out, clampf(speed, 0.0, 1.0) * 0.3, LEVEL_TAU)
	return out


## The workshop bed: near-silent filtered brown noise, and nothing pitched. A note held under
## the whole game is the most melodic thing in it and reads as an engine. The false-set tell
## needs no note: the bed's filter opens (`lift` 0..1) and the room leans in.
func ambience(seconds: float, level: float, lift := 0.0) -> PackedFloat32Array:
	var n := frames(seconds)
	var out := _tiled(brown_noise(), n)
	var target := AMBIENT_BED_HZ + (AMBIENT_BED_OPEN_HZ - AMBIENT_BED_HZ) * clampf(lift, 0.0, 1.0)
	if is_equal_approx(target, AMBIENT_BED_HZ):
		biquad(out, lowpass(AMBIENT_BED_HZ))
	else:
		_lowpass_towards(out, AMBIENT_BED_HZ, target, 0.35 / 3.0)
	swell(out, maxf(0.0, level) * 0.09, LEVEL_TAU)
	return out


static func _lowpass_towards(buf: PackedFloat32Array, hz: float, to_hz: float, tau: float) -> void:
	var k := 1.0 - exp(-1.0 / (RATE * tau))
	var resonance := 2.0 * pow(10.0, 1.0 / 20.0)
	var f := hz
	var x1 := 0.0
	var x2 := 0.0
	var y1 := 0.0
	var y2 := 0.0
	for i in buf.size():
		var w := TAU * f / RATE
		var c := cos(w)
		var alpha := sin(w) / resonance
		var x: float = buf[i]
		var y := ((1.0 - c) * (0.5 * x + x1 + 0.5 * x2) + 2.0 * c * y1 - (1.0 - alpha) * y2) / (1.0 + alpha)
		x2 = x1
		x1 = x
		y2 = y1
		y1 = y
		buf[i] = y
		f += (to_hz - f) * k


# ── Loops ───────────────────────────────────────────────────────────────────────────────

## A voice's raw material as a seamless loop, at full height. The filtered ones are rendered
## twice through and the second pass kept, so the filter is already ringing where the loop
## begins and the join is silent.
func loop(id: StringName) -> PackedFloat32Array:
	match id:
		&"hum-saw":
			# 60 Hz is 735 samples a cycle exactly.
			return wave(SAW, 735 * 4, 60.0)
		&"hum-sub":
			# 88 Hz is 22 cycles in a quarter of a second.
			return wave(SINE, 11025, 88.0)
		&"spring":
			# 110 Hz is 11 cycles in a tenth.
			return wave(SAW, 4410, 110.0)
		&"free-pin":
			return free_pin_cycle()
		&"grind":
			return grind_cycle(2 * RATE).slice(RATE)
		&"friction":
			var n := NOISE_SECONDS * RATE
			return plug_friction_cycle(2 * n).slice(n)
		&"scrape":
			return white_noise()
		&"bed":
			return brown_noise()
	push_error("SfxSynth: no loop named %s" % id)
	return PackedFloat32Array()


# ── Into the mixer ──────────────────────────────────────────────────────────────────────

## Samples as a 16-bit stream the mixer can play.
##
## The stream is stored at full scale whatever the sound's own level — a quiet voice keeps all
## sixteen bits, and a loud one (a click at 1.7 peaks well past 1.0) is not clipped. `gain` is
## what to play it back at to hear it at the level it was rendered.
##
## A loop is stored with its first sample repeated after its last. The mixer plays the sample
## at the loop's end point and then goes on from the one after its start, so the end point has
## to be a copy of the start for the loop to be the length it was rendered at.
static func pack(samples: PackedFloat32Array, looped := false) -> Dictionary:
	var n := samples.size()
	var peak := 0.0
	for i in n:
		var v := absf(samples[i])
		if v > peak:
			peak = v
	var scale := 32000.0 / peak if peak > 0.0 else 0.0
	var bytes := PackedByteArray()
	bytes.resize((n + 1) * 2 if looped else n * 2)
	for i in n:
		bytes.encode_s16(i * 2, roundi(samples[i] * scale))
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = RATE
	stream.stereo = false
	if looped and n > 0:
		bytes.encode_s16(n * 2, roundi(samples[0] * scale))
		stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
		stream.loop_begin = 0
		stream.loop_end = n
	stream.data = bytes
	# The mixer reads a stored sample as a fraction of 32767.
	return {"stream": stream, "gain": 32767.0 / scale if scale > 0.0 else 0.0, "seconds": float(n) / RATE}
