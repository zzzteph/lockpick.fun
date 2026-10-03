extends Node
## The game's audio: every sound it makes, mixed. Meant to be the autoload `Sfx`.
##
## [codeblock]
##                    ┌─ SfxMechanical ─┐
## voices ───────────►├─ SfxAmbient ────┤──► SfxMaster ──► SfxOut (limiter) ──► Master
##                    └─ SfxUi ─────────┘
## [/codeblock]
##
## Discrete sounds are triggered by the lock's event stream — audio never infers that a pin set
## by watching state. The sustained voices are the one exception ("amplitude tracking
## resistance" is not something an event can say), and their parameters are pushed in each frame
## by whoever owns the lock, through [method update_continuous].
##
## Nothing is loaded: [SfxSynth] computes each sound, on a worker thread, into a stream that is
## kept. A sound asked for before the worker has reached it is rendered on the spot instead of
## being dropped — a missing click is a bug, one frame a few milliseconds long is not.
##
## The buses are made here at runtime, so the project needs no bus layout. Four more sit behind
## the ones drawn above — SfxHum, SfxSpring and SfxScrape into SfxMechanical, SfxBed into
## SfxAmbient — each a sustained voice's own filter.

## Emitted as each one-shot starts, with the key of the sound that was played.
signal voice_started(key: String, bus: StringName)

## A rake across a dozen chambers trivially exceeds any sensible polyphony. The oldest voice
## is stolen.
const VOICE_CAP := 24

const DEFAULT_MASTER := 0.8
const DEFAULT_MECHANICAL := 1.0
const DEFAULT_AMBIENT := 0.2
const DEFAULT_UI := 0.7

const BUS_OUT := &"SfxOut"
const BUS_MASTER := &"SfxMaster"
const BUS_MECHANICAL := &"SfxMechanical"
const BUS_AMBIENT := &"SfxAmbient"
const BUS_UI := &"SfxUi"
const BUS_HUM := &"SfxHum"
const BUS_SPRING := &"SfxSpring"
const BUS_SCRAPE := &"SfxScrape"
const BUS_BED := &"SfxBed"

# ── The limiter ─────────────────────────────────────────────────────────────────────────
# During a rake a dozen clicks fire in a few hundred milliseconds, and without a limiter on the
# way out they clip. The game was mixed through one — threshold -10 dB, a 6 dB knee, 12:1 — and
# that limiter is part of the balance: it lifts everything under its threshold by 4.3 dB and
# holds the click and the open thunk down to meet them. So it is reproduced, not just replaced
# by a safety net. The engine's compressor has a hard knee, no look-ahead, and counts a decibel
# over the threshold as two, so the numbers that give the same curve are not the same numbers.
# Measured against the original on every sound, these put each peak within a decibel of where
# it was and each sound's energy within two.
const LIMITER_THRESHOLD_DB := -8.0
const LIMITER_RATIO := 1.8
const LIMITER_MAKEUP_DB := 4.33
const LIMITER_ATTACK_US := 60.0
const LIMITER_RELEASE_MS := 150.0

# ── The click against the bed ───────────────────────────────────────────────────────────
## The set click is a 30 ms transient and the binding hum under it is sustained at fourteen
## times its energy — and the hum is by definition at full tilt at the moment a pin sets,
## because the pin that sets is the pin being pushed. A click at its natural level is not quiet
## there, it is masked. So it is played louder and the sustained voices drop out of its way.
const CLICK_GAIN := 1.7
const DUCK_TO := 0.3
const DUCK_SECONDS := 0.11

# ── What the sustained voices are told ──────────────────────────────────────────────────
## The state of the pin under the pick, in the order the lock itself counts them.
enum { STATE_FREE, STATE_BINDING, STATE_FALSE_SET, STATE_SET, STATE_OVERSET }
## Counter-rotation force at which the grind is at full level: half of what a spool can push
## back with.
const GRIND_FULL_FORCE := 42.8 * 0.5
## The plug's radius, mm: turns a speed at its rim into the turn rate the friction listens to.
const PLUG_RADIUS := 6.35
## Radians per second at which the plug's friction is at full level.
const FRICTION_FULL_SPEED := 0.6

## The wrench dial's ten steps. A click's timbre follows the tension, so these are the clicks
## worth having ready before the first pin sets.
const TENSION_STEPS := 10
const TENSION_MIN_STEP := 0.12
const TENSION_MAX_STEP := 0.95

## Rendered clicks kept at once. Past this the oldest renders are forgotten; an analogue wrench
## can otherwise ask for a hundred tensions on every pin.
const CLICK_CACHE := 400

var master := DEFAULT_MASTER
var mechanical := DEFAULT_MECHANICAL
var ambient := DEFAULT_AMBIENT
var ui := DEFAULT_UI
var muted := false
## Whether the sustained layer plays at all. Off unless asked for: the discrete voices carry
## what a player acts on — the click of a pin setting, the cascade of a reset — and the
## sustained ones are atmosphere that play-testing twice asked to have removed.
var continuous := false
## Pins in the lock on the bench. Sets which pitch a chamber's click has and how long a full
## reset's cascade runs.
var chamber_count := 6

## Every one-shot ever started, every one that took another's voice to do it, and every sound
## that had to be rendered on the main thread because it was needed before the worker got to it.
var stats := {"scheduled": 0, "stolen": 0, "rendered_late": 0}

var _synth := SfxSynth.new()

# One-shot voices, oldest first.
var _idle: Array[AudioStreamPlayer] = []
var _voice_players: Array[AudioStreamPlayer] = []
var _voice_ends := PackedFloat64Array()

# Rendered sounds by key: { stream, gain, seconds }. Shared with the worker.
var _sounds := {}
var _queue: Array[String] = []
## Keys asked for and not yet rendered, the one in the worker's hands included.
var _wanted := {}
var _timings := {}
var _click_keys: Array[String] = []
## The pin count the worker last prepared clicks for.
var _prepared := 0
var _lock := Mutex.new()
var _wake := Semaphore.new()
var _thread: Thread
var _quit := false

var _tones := {}
var _scrape_filter: AudioEffectBandPassFilter
var _bed_filter: AudioEffectLowPassFilter
var _duck_at := -1.0e9
var _duck_from := 1.0
var _duck_to := DUCK_TO
var _duck_seconds := DUCK_SECONDS
var _hum_hz := 62.0
var _hum_hz_target := 62.0
var _spring_hz := 120.0
var _spring_hz_target := 120.0
var _scrape_hz := 1200.0
var _scrape_hz_target := 1200.0
var _bed_hz := SfxSynth.AMBIENT_BED_HZ
var _bed_lift := 0.0
var _scrape_speed := 0.0
## Whether any sustained voice is sounding or about to: while none is, a frame costs nothing.
var _sustaining := false
var _last_pick_chamber := -1
var _last_pick_lift := 0.0


## A sustained voice: one or two loops, a level that eases towards what it was last told.
class Tone:
	var keys: Array[String] = []
	var players: Array[AudioStreamPlayer] = []
	var gains: Array[float] = []
	## The voice's level when it is asked for all of itself.
	var full := 1.0
	var level := 0.0
	var target := 0.0
	var tau := SfxSynth.LEVEL_TAU
	## Whether a click pushes it down.
	var ducked := true


## Everything is built here rather than on entering the tree, so the settings can be applied
## to this node the moment it exists — before anything else in the game is ready.
func _init() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_buses()
	for i in VOICE_CAP:
		var p := AudioStreamPlayer.new()
		p.name = "Voice%d" % i
		add_child(p)
		_idle.append(p)
	_build_tones()
	for key: String in ["ui", "overset", "false-set", "plug-free", "reset:1", "open", "pick-bent", "pick-broken"]:
		_request(key)
	# The snap gun's strike, at every tenth of a full one it can be drawn back to.
	for tenths in range(1, STRIKE_TENTHS + 1):
		_request("strike:%d" % tenths)


func _enter_tree() -> void:
	if OS.has_feature("threads") and _thread == null:
		_quit = false
		_thread = Thread.new()
		_thread.start(_work)


## Leaving the tree is the game closing: the worker is joined and every voice is let go of.
func _exit_tree() -> void:
	if _thread != null:
		_lock.lock()
		_quit = true
		_lock.unlock()
		_wake.post()
		_thread.wait_to_finish()
		_thread = null
	var sounding := _sustaining or active_voices() > 0
	for child in get_children():
		var player := child as AudioStreamPlayer
		if player != null:
			player.stop()
			player.stream = null
	_idle.append_array(_voice_players)
	_voice_players.clear()
	_voice_ends.clear()
	if sounding:
		_let_the_mixer_finish()


## A stopped sound is only released once the mixer, on its own thread, has faded it out — and
## an engine that is quitting does not wait for that: whatever is still fading when the audio
## server shuts down is reported as leaked. So wait for it here: two mixes, a few hundredths
## of a second, and never longer than a tenth.
func _let_the_mixer_finish() -> void:
	var deadline := Time.get_ticks_usec() + 100000
	var mixes := 0
	var since := AudioServer.get_time_since_last_mix()
	while mixes < 2 and Time.get_ticks_usec() < deadline:
		OS.delay_usec(1000)
		var now_since := AudioServer.get_time_since_last_mix()
		if now_since < since:
			mixes += 1
		since = now_since


# ── Volume ──────────────────────────────────────────────────────────────────────────────

## All four are 0..1, linear, as the settings store them.
func set_master(v: float) -> void:
	master = clampf(v, 0.0, 1.0)
	_set_bus_level(BUS_MASTER, master)


func set_mechanical(v: float) -> void:
	mechanical = clampf(v, 0.0, 1.0)
	_set_bus_level(BUS_MECHANICAL, mechanical)


func set_ambient(v: float) -> void:
	ambient = clampf(v, 0.0, 1.0)
	_set_bus_level(BUS_AMBIENT, ambient)


func set_ui(v: float) -> void:
	ui = clampf(v, 0.0, 1.0)
	_set_bus_level(BUS_UI, ui)


## A real mute: the output bus stops, rather than every level being turned to nothing.
func set_muted(on: bool) -> void:
	muted = on
	AudioServer.set_bus_mute(AudioServer.get_bus_index(BUS_OUT), on)


## Turn the sustained layer on or off. Off, it is silenced at once rather than at the next
## update, so the switch in Settings is heard as it is thrown.
func set_continuous(on: bool) -> void:
	if continuous == on:
		return
	continuous = on
	if on:
		_sustaining = true
		for tone: Tone in _tones.values():
			for key in tone.keys:
				_request(key)
		_tone(&"bed").target = 1.0
	else:
		hush()
		_tone(&"bed").target = 0.0


## The lock on the bench has this many pins. Call it as an attempt starts; the clicks that lock
## can make are rendered then, ahead of the first set.
func set_chamber_count(n: int) -> void:
	chamber_count = maxi(1, n)
	_prepare(chamber_count)


## Have the worker render what a lock of `count` pins can sound like: every pin's click at each
## step of the wrench dial, and a cascade for every number of pins that can drop.
func _prepare(count: int) -> void:
	_prepared = count
	for pin in count:
		for step in TENSION_STEPS:
			var t := TENSION_MIN_STEP + (TENSION_MAX_STEP - TENSION_MIN_STEP) * step / float(TENSION_STEPS - 1)
			_request(_click_key(pin, count, t))
	for dropped in range(1, count + 1):
		_request("reset:%d" % dropped)


# ── Events ──────────────────────────────────────────────────────────────────────────────

## The hardest strike the snap gun has a sound for, in tenths of a full one.
const STRIKE_TENTHS := 15

## Fold one of the lock's events into sound.
##
## `PIN_SET {chamber, tension}` clicks, `PIN_OVERSET` thuds, `FALSE_SET_ENTERED` pings and
## opens the room bed, `RESET {kind, dropped}` cascades and closes it, `PLUG_FREE` gives,
## `LOCK_OPENED` plays the open, `PICK_BENT` and `PICK_BROKEN` groan and snap, `STRIKE {power}`
## is the snap gun going off, as loud as it was drawn back, and
## `ATTEMPT_STARTED` closes the bed (and takes the pin count, if given as `chambers`).
## `RANK_STAMP` is the one tick of the payoff, as the rank letter lands.
## `PLUG_MOVED`, `COUNTER_ROTATION` and `PICK_MOVED` are heard through the sustained voices and
## trigger nothing here; neither does anything else — a wrench step is felt, not heard.
func handle_event(type: StringName, data: Dictionary = {}) -> void:
	match type:
		&"PIN_SET":
			var chamber := int(data.get("chamber", 0))
			_click(chamber, int(data.get("count", chamber_count)), float(data.get("tension", 0.5)),
					click_detune(chamber, int(data.get("tick", Engine.get_physics_frames()))), CLICK_GAIN)
			# The pin that just set is the pin that was humming, so the hum should stop.
			duck()
		&"PIN_OVERSET":
			_voice(BUS_MECHANICAL, "overset", 1.0, 1.0, 0.25)
		&"STRIKE":
			# The snap gun: rendered in tenths of a full strike, so a harder one is a bigger sound.
			var tenths := clampi(roundi(float(data.get("power", 1.0)) * 10.0), 1, STRIKE_TENTHS)
			_voice(BUS_MECHANICAL, "strike:%d" % tenths, 1.0, 1.0, 0.18)
		&"FALSE_SET_ENTERED":
			_voice(BUS_MECHANICAL, "false-set", 1.0, 1.0, 0.55)
			_bed_lift = 1.0
		&"RESET":
			# A counter-rotation drop is only the pins that lost their ledge, not the whole lock,
			# and it should sound like fewer things falling.
			var count := chamber_count
			if data.get("kind", "full") == "counter":
				count = maxi(1, (data.get("dropped", []) as Array).size())
			_voice(BUS_MECHANICAL, "reset:%d" % count, 1.0, 1.0, count * 0.025 + 0.1)
			_bed_lift = 0.0
		&"PICK_BENT":
			_voice(BUS_MECHANICAL, "pick-bent", 1.0, 1.0, 0.3)
			duck()
		&"PICK_BROKEN":
			_voice(BUS_MECHANICAL, "pick-broken", 1.0, 1.0, 0.5)
			duck(0.12, 0.4)
		&"PLUG_FREE":
			_voice(BUS_MECHANICAL, "plug-free", 1.0, 1.0, 0.4)
		&"LOCK_OPENED":
			_voice(BUS_MECHANICAL, "open", 1.0, 1.0, 1.2)
		&"ATTEMPT_STARTED":
			_bed_lift = 0.0
			if data.has("chambers"):
				set_chamber_count(int(data["chambers"]))
		&"RANK_STAMP":
			credit_tick(int(data.get("index", 0)))


## Play a sound by name, for everything that is not a lock event. Returns false for a name
## nothing answers to.
##
## `ui` (or `ui_click`) is the menu detent and `credit {index}` (or `credit_tick`) the payoff's
## tick, both on the UI bus.
## The lock's own sounds can be asked for directly too: `click {chamber, count, tension, detune,
## gain}`, `overset`, `false-set`, `reset {count}`, `pick-bent`, `pick-broken`, `plug-free`,
## `open` — each takes an optional `gain`.
func play(sound: StringName, params: Dictionary = {}) -> bool:
	var gain := float(params.get("gain", 1.0))
	match sound:
		&"ui", &"ui_click":
			_voice(BUS_UI, "ui", gain, 1.0, 0.02)
		&"credit", &"credit_tick":
			credit_tick(int(params.get("index", 0)))
		&"click":
			_click(int(params.get("chamber", 0)), int(params.get("count", chamber_count)),
					float(params.get("tension", 0.5)), float(params.get("detune", 0.0)), gain)
		&"click-shallow":
			_click(0, 5, 0.2, 0.0, gain)
		&"click-deep":
			_click(4, 5, 0.9, 0.0, gain)
		&"overset":
			_voice(BUS_MECHANICAL, "overset", gain, 1.0, 0.25)
		&"false-set":
			_voice(BUS_MECHANICAL, "false-set", gain, 1.0, 0.55)
		&"reset":
			var count := maxi(1, int(params.get("count", chamber_count)))
			_voice(BUS_MECHANICAL, "reset:%d" % count, gain, 1.0, count * 0.025 + 0.1)
		&"pick-bent":
			_voice(BUS_MECHANICAL, "pick-bent", gain, 1.0, 0.3)
		&"pick-broken":
			_voice(BUS_MECHANICAL, "pick-broken", gain, 1.0, 0.5)
		&"plug-free":
			_voice(BUS_MECHANICAL, "plug-free", gain, 1.0, 0.4)
		&"open":
			_voice(BUS_MECHANICAL, "open", gain, 1.0, 1.2)
		_:
			return false
	return true


## UI detent — menus and buttons.
func ui_click() -> void:
	_voice(BUS_UI, "ui", 1.0, 1.0, 0.02)


## The payoff's mechanical tick: one as the rank lands, or one per step of a count-up, each a
## little louder than the last so it climbs as it counts. The same detent the UI uses, so the
## payoff sounds like the rest of the bench rather than like a slot machine.
func credit_tick(index: int) -> void:
	_voice(BUS_UI, "ui", 0.8 + index * 0.12, 1.0, 0.02)


## A ±4% detune per click, so no two sound looped, derived from the chamber and the tick
## rather than drawn from the lock's own random stream — a sound must not be able to change
## what the lock does next.
static func click_detune(chamber: int, tick: int) -> float:
	var h := ((chamber * 0x9e3779b1) ^ (tick * 0x85ebca6b)) & 0xFFFFFFFF
	h = ((h ^ (h >> 15)) * 0x2545f491) & 0xFFFFFFFF
	h = h ^ (h >> 13)
	return float(h) / 4294967296.0 * 0.08 - 0.04


## Voices sounding now.
func active_voices() -> int:
	_prune(_now())
	return _voice_players.size()


## Dip the sustained voices so a one-shot can be heard through them: down in 8 ms, held, then
## eased back. The recovery is an approach rather than a ramp because a straight line back up
## under a decaying transient is audible as a swell.
func duck(to := DUCK_TO, seconds := DUCK_SECONDS) -> void:
	var now := _now()
	_duck_from = _duck_gain(now)
	_duck_at = now
	_duck_to = to
	_duck_seconds = seconds


# ── Sustained voices ────────────────────────────────────────────────────────────────────

## Push the lock's state to the sustained voices. Call once a frame while a lock is on screen.
##
## `pick_chamber` is the chamber under the tip, -1 with the pick out. `pin_state`, `pin_lift`
## (mm) describe the pin there. `resistance` is 0..1, how hard that pin pushes back.
## `counter_force` is the largest counter-rotation force on any pin. `plug_speed` is how fast
## the plug is turning, mm/s at its rim.
func update_continuous(delta: float, pick_chamber: int, pin_state: int, pin_lift: float, resistance: float, counter_force: float, plug_speed: float) -> void:
	# Nothing sustained to update, and turning the layer off already silenced what was playing.
	if not continuous:
		return
	var dt := maxf(delta, 1.0 / 240.0)
	var picked := pick_chamber >= 0

	var binding := maxf(0.0, resistance) if picked and pin_state == STATE_BINDING else 0.0
	_tone(&"hum").target = binding
	_hum_hz_target = 60.0 + binding * 30.0
	_tone(&"free-pin").target = 1.0 if picked and pin_state == STATE_FREE else 0.0

	# Scrape follows how fast the tip is really moving, and stops the instant the pick does.
	var moved := pick_chamber != _last_pick_chamber
	var lift_delta := absf(pin_lift - _last_pick_lift) if picked else 0.0
	var instant := 1.0 if moved else minf(1.0, lift_delta / dt / 30.0)
	_scrape_speed = maxf(instant, _scrape_speed - dt * 8.0)
	var across := float(pick_chamber) / float(chamber_count - 1) if chamber_count > 1 else 0.0
	_tone(&"scrape").target = _scrape_speed if picked else 0.0
	_scrape_hz_target = 800.0 + clampf(across, 0.0, 1.0) * 2200.0
	_last_pick_chamber = pick_chamber
	_last_pick_lift = pin_lift if picked else 0.0

	_tone(&"spring").target = 1.0 if picked else 0.0
	_spring_hz_target = 110.0 + maxf(0.0, pin_lift if picked else 0.0) * 46.0

	_tone(&"grind").target = clampf(counter_force / GRIND_FULL_FORCE, 0.0, 1.0)
	_tone(&"friction").target = minf(1.0, absf(plug_speed) / PLUG_RADIUS / FRICTION_FULL_SPEED)


## Silence the lock's sustained voices without stopping them — for leaving the pick screen.
## The room bed is not the lock's and stays.
func hush() -> void:
	for id: StringName in _tones:
		if id != &"bed":
			_tone(id).target = 0.0
	_scrape_speed = 0.0


func _process(delta: float) -> void:
	if _thread == null:
		_work_once()
	if not _sustaining:
		return
	var now := _now()
	var duck_gain := _duck_gain(now)
	var any := false
	for id: StringName in _tones:
		var tone: Tone = _tones[id]
		tone.level += (tone.target - tone.level) * (1.0 - exp(-delta / tone.tau))
		var live := continuous or tone.level > 0.0005
		if not live:
			tone.level = 0.0
		for i in tone.players.size():
			var p := tone.players[i]
			if live and p.stream == null:
				var sound := _peek(tone.keys[i])
				if not sound.is_empty():
					p.stream = sound["stream"]
					tone.gains[i] = sound["gain"]
			if live and p.stream != null:
				if not p.playing:
					p.play()
				# Told to the mixer only when it has moved: a level that is holding costs nothing.
				var v := tone.level * tone.full * tone.gains[i] * (duck_gain if tone.ducked else 1.0)
				var db := linear_to_db(maxf(v, 0.00001))
				if absf(db - p.volume_db) > 0.01:
					p.volume_db = db
				any = true
			elif p.playing:
				p.stop()
	_sustaining = any or continuous
	if not any:
		return
	_hum_hz = _ease(_hum_hz, _hum_hz_target, delta, 0.08 / 3.0)
	_set_pitch(_tone(&"hum").players[0], _hum_hz / 60.0)
	_spring_hz = _ease(_spring_hz, _spring_hz_target, delta, 0.06 / 3.0)
	_set_pitch(_tone(&"spring").players[0], _spring_hz / 110.0)
	_scrape_hz = _ease(_scrape_hz, _scrape_hz_target, delta, 0.05 / 3.0)
	_scrape_filter.cutoff_hz = _scrape_hz
	var bed_target := SfxSynth.AMBIENT_BED_HZ + (SfxSynth.AMBIENT_BED_OPEN_HZ - SfxSynth.AMBIENT_BED_HZ) * _bed_lift
	_bed_hz = _ease(_bed_hz, bed_target, delta, 0.35 / 3.0)
	_bed_filter.cutoff_hz = _bed_hz


static func _set_pitch(player: AudioStreamPlayer, pitch: float) -> void:
	if absf(pitch - player.pitch_scale) > 0.0002:
		player.pitch_scale = pitch


static func _ease(value: float, target: float, delta: float, tau: float) -> float:
	return value + (target - value) * (1.0 - exp(-delta / tau))


func _duck_gain(now: float) -> float:
	var t := now - _duck_at
	var hold := _duck_seconds * 0.45
	if t < 0.008:
		return lerpf(_duck_from, _duck_to, t / 0.008)
	if t < hold:
		return _duck_to
	return 1.0 + (_duck_to - 1.0) * exp(-(t - hold) / (_duck_seconds * 0.35))


func _tone(id: StringName) -> Tone:
	return _tones[id]


func _build_tones() -> void:
	# id, loops, bus, level at full, ducked by a click.
	_add_tone(&"hum", ["loop:hum-saw", "loop:hum-sub"], BUS_HUM, 0.34, true)
	_add_tone(&"free-pin", ["loop:free-pin"], BUS_MECHANICAL, 0.16, true)
	# The mixer's band-pass is louder than the one the scrape was levelled through by the root
	# of its Q plus one.
	_add_tone(&"scrape", ["loop:scrape"], BUS_SCRAPE, 0.16 / sqrt(1.4 + 1.0), true)
	_add_tone(&"spring", ["loop:spring"], BUS_SPRING, 0.06, true)
	_add_tone(&"grind", ["loop:grind"], BUS_MECHANICAL, 0.3, true)
	_add_tone(&"friction", ["loop:friction"], BUS_MECHANICAL, 0.3, true)
	_add_tone(&"bed", ["loop:bed"], BUS_BED, 0.09, false)
	# The scrape stops with the pick: it eases four times faster than the rest.
	_tone(&"scrape").tau = 0.008


func _add_tone(id: StringName, keys: Array[String], bus: StringName, full: float, ducked: bool) -> void:
	var tone := Tone.new()
	tone.keys = keys
	tone.full = full
	tone.ducked = ducked
	for key in keys:
		var p := AudioStreamPlayer.new()
		p.name = key.replace(":", "_")
		p.bus = bus
		p.volume_db = -100.0
		add_child(p)
		tone.players.append(p)
		tone.gains.append(1.0)
	_tones[id] = tone


# ── One-shot voices ─────────────────────────────────────────────────────────────────────

func _click(pin: int, count: int, tension: float, detune: float, gain: float) -> void:
	var key := _click_key(pin, count, tension)
	if _peek(key).is_empty():
		# An analogue wrench lands between the dial's steps. The click a few hundredths of
		# tension away is already rendered and cannot be told from this one, so it plays now
		# and the exact one is made for next time.
		var at := key.rfind(":") + 1
		var asked := int(key.substr(at))
		for d: int in [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]:
			var near := key.substr(0, at) + str(asked + d)
			if not _peek(near).is_empty():
				_request(key)
				key = near
				break
		# Nobody said how many pins this lock has: the first click waits to be rendered, and the
		# rest of the lock's are made behind it.
		if maxi(1, count) != _prepared:
			_prepare(maxi(1, count))
	_voice(BUS_MECHANICAL, key, gain, 1.0 + detune, 0.15)


## A click is rendered once per pin and per hundredth of tension; the detune is applied as it
## plays, by pitch.
static func _click_key(pin: int, count: int, tension: float) -> String:
	var n := maxi(1, count)
	return "click:%d:%d:%d" % [clampi(pin, 0, n - 1), n, roundi(clampf(tension, 0.0, 1.0) * 100.0)]


## Start a sound on a bus, taking the oldest voice if every one is busy. `reserve` is how long
## the voice is spoken for, in seconds, if that is longer than the sound.
func _voice(bus: StringName, key: String, gain: float, pitch: float, reserve: float) -> void:
	# A player outside the tree cannot sound.
	if not is_inside_tree():
		return
	var sound := _sound(key)
	if sound.is_empty():
		return
	var now := _now()
	_prune(now)
	var player: AudioStreamPlayer
	if _voice_players.size() >= VOICE_CAP or _idle.is_empty():
		player = _voice_players.pop_front()
		_voice_ends.remove_at(0)
		stats["stolen"] += 1
	else:
		player = _idle.pop_back()
	player.stream = sound["stream"]
	player.bus = bus
	player.volume_db = linear_to_db(maxf(gain * float(sound["gain"]), 0.00001))
	player.pitch_scale = pitch
	player.play()
	_voice_players.append(player)
	_voice_ends.append(now + maxf(reserve, float(sound["seconds"]) / pitch) + 0.05)
	stats["scheduled"] += 1
	voice_started.emit(key, bus)


func _prune(now: float) -> void:
	var i := 0
	while i < _voice_players.size():
		if _voice_ends[i] <= now:
			_idle.append(_voice_players[i])
			_voice_players.remove_at(i)
			_voice_ends.remove_at(i)
		else:
			i += 1


static func _now() -> float:
	return Time.get_ticks_usec() / 1.0e6


# ── Rendering ───────────────────────────────────────────────────────────────────────────

## True once everything asked for so far has been rendered.
func is_ready() -> bool:
	_lock.lock()
	var idle := _wanted.is_empty()
	_lock.unlock()
	return idle


## How long each sound took to render, in milliseconds, by key.
func render_times() -> Dictionary:
	_lock.lock()
	var out := _timings.duplicate()
	_lock.unlock()
	return out


## Ask the worker for a sound it has not made yet.
func _request(key: String) -> void:
	_lock.lock()
	var wanted := not _sounds.has(key) and not _wanted.has(key)
	if wanted:
		_queue.append(key)
		_wanted[key] = true
	_lock.unlock()
	if wanted:
		_wake.post()


func _peek(key: String) -> Dictionary:
	_lock.lock()
	var sound: Dictionary = _sounds.get(key, {})
	_lock.unlock()
	return sound


## The sound for a key, rendered now if the worker has not reached it.
func _sound(key: String) -> Dictionary:
	var sound := _peek(key)
	if sound.is_empty():
		sound = _render(key)
		if not sound.is_empty():
			stats["rendered_late"] += 1
	return sound


func _work() -> void:
	while true:
		_wake.wait()
		_lock.lock()
		var quit := _quit
		_lock.unlock()
		if quit:
			return
		_work_once()


func _work_once() -> void:
	_lock.lock()
	var key: String = _queue.pop_front() if not _queue.is_empty() else ""
	var have := key == "" or _sounds.has(key)
	_lock.unlock()
	if not have:
		_render(key)
	if key != "":
		_lock.lock()
		_wanted.erase(key)
		_lock.unlock()


func _render(key: String) -> Dictionary:
	var started := Time.get_ticks_usec()
	var part := key.split(":")
	var samples: PackedFloat32Array
	var looped := false
	match part[0]:
		"click":
			samples = _synth.click(int(part[1]), int(part[2]), int(part[3]) / 100.0)
		"reset":
			samples = _synth.reset(int(part[1]))
		"overset":
			samples = _synth.overset()
		"strike":
			samples = _synth.strike(int(part[1]) / 10.0)
		"false-set":
			samples = _synth.false_set()
		"plug-free":
			samples = _synth.plug_free()
		"pick-bent":
			samples = _synth.pick_strain(false)
		"pick-broken":
			samples = _synth.pick_strain(true)
		"open":
			samples = _synth.open()
		"ui":
			samples = _synth.ui_tick()
		"loop":
			samples = _synth.loop(StringName(part[1]))
			looped = true
		_:
			push_error("Sfx: no sound for key %s" % key)
			return {}
	var sound := SfxSynth.pack(samples, looped)
	_lock.lock()
	_sounds[key] = sound
	_timings[key] = (Time.get_ticks_usec() - started) / 1000.0
	if part[0] == "click":
		_click_keys.append(key)
		if _click_keys.size() > CLICK_CACHE:
			_sounds.erase(_click_keys.pop_front())
	_lock.unlock()
	return sound


# ── Buses ───────────────────────────────────────────────────────────────────────────────

func _build_buses() -> void:
	if _bus(BUS_OUT, &"Master"):
		var comp := AudioEffectCompressor.new()
		comp.threshold = LIMITER_THRESHOLD_DB
		comp.ratio = LIMITER_RATIO
		comp.gain = LIMITER_MAKEUP_DB
		comp.attack_us = LIMITER_ATTACK_US
		comp.release_ms = LIMITER_RELEASE_MS
		AudioServer.add_bus_effect(AudioServer.get_bus_index(BUS_OUT), comp)
		# The compressor shapes the mix; this only guarantees the output never clips.
		AudioServer.add_bus_effect(AudioServer.get_bus_index(BUS_OUT), AudioEffectHardLimiter.new())
	_bus(BUS_MASTER, BUS_OUT)
	_bus(BUS_MECHANICAL, BUS_MASTER)
	_bus(BUS_AMBIENT, BUS_MASTER)
	_bus(BUS_UI, BUS_MASTER)
	# A filter in the mixer takes its resonance as Q itself; the voices were designed with the
	# resonant peak given in decibels.
	if _bus(BUS_HUM, BUS_MECHANICAL):
		_add_filter(BUS_HUM, AudioEffectLowPassFilter.new(), 220.0, db_to_linear(8.0))
	if _bus(BUS_SPRING, BUS_MECHANICAL):
		_add_filter(BUS_SPRING, AudioEffectLowPassFilter.new(), 900.0, db_to_linear(1.0))
	if _bus(BUS_SCRAPE, BUS_MECHANICAL):
		# The mixer's band-pass doubles the resonance it is given: this is a Q of 1.4.
		_add_filter(BUS_SCRAPE, AudioEffectBandPassFilter.new(), 1200.0, 0.7)
	if _bus(BUS_BED, BUS_AMBIENT):
		_add_filter(BUS_BED, AudioEffectLowPassFilter.new(), SfxSynth.AMBIENT_BED_HZ, db_to_linear(1.0))
	_scrape_filter = AudioServer.get_bus_effect(AudioServer.get_bus_index(BUS_SCRAPE), 0) as AudioEffectBandPassFilter
	_bed_filter = AudioServer.get_bus_effect(AudioServer.get_bus_index(BUS_BED), 0) as AudioEffectLowPassFilter
	set_master(master)
	set_mechanical(mechanical)
	set_ambient(ambient)
	set_ui(ui)
	set_muted(muted)


## Make a bus if there is not one by that name already. Returns true when it was made here,
## and so still needs its effects.
func _bus(bus: StringName, send: StringName) -> bool:
	if AudioServer.get_bus_index(bus) >= 0:
		return false
	AudioServer.add_bus()
	var idx := AudioServer.bus_count - 1
	AudioServer.set_bus_name(idx, bus)
	AudioServer.set_bus_send(idx, send)
	return true


func _add_filter(bus: StringName, filter: AudioEffectFilter, hz: float, resonance: float) -> void:
	filter.cutoff_hz = hz
	filter.resonance = resonance
	AudioServer.add_bus_effect(AudioServer.get_bus_index(bus), filter)


func _set_bus_level(bus: StringName, level: float) -> void:
	var idx := AudioServer.get_bus_index(bus)
	if idx >= 0:
		AudioServer.set_bus_volume_db(idx, linear_to_db(maxf(level, 0.00001)))
