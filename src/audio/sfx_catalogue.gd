class_name SfxCatalogue
extends RefCounted
## The sound catalogue: every sound the game has, as a list that can be rendered.
##
## One list for three readers — a debug screen that plots each waveform, the tests that measure
## each one's envelope and spectrum, and anyone asking which lock event makes which sound. A
## sound that is missing from the game is missing from here, and the "every event has a sound"
## check fails.

## `seconds` is how long a window shows the sound whole, for plotting; `event` is the lock event
## that triggers it, where there is one.
const SOUNDS: Array[Dictionary] = [
	{
		"id": &"click-shallow",
		"name": "Click — pin 1, light tension",
		"description": "The sound of the game. Noise transient, triangle body, sine ring.",
		"kind": &"one-shot",
		"seconds": 0.3,
		"event": &"PIN_SET",
	},
	{
		"id": &"click-deep",
		"name": "Click — pin 5, heavy tension",
		"description": "Deeper pin, lower body. Heavy tension: brighter transient, shorter decay.",
		"kind": &"one-shot",
		"seconds": 0.3,
		"event": &"PIN_SET",
	},
	{
		"id": &"overset",
		"name": "Overset",
		"description": "Dull thud. 90Hz sine falling to 62Hz plus lowpassed noise. No ring.",
		"kind": &"one-shot",
		"seconds": 0.4,
		"event": &"PIN_OVERSET",
	},
	{
		"id": &"false-set",
		"name": "False set",
		"description": "Three inharmonic sines at 1.0 / 2.7 / 5.3. The beautiful lie.",
		"kind": &"one-shot",
		"seconds": 0.7,
		"event": &"FALSE_SET_ENTERED",
	},
	{
		"id": &"reset",
		"name": "Reset cascade",
		"description": "Soft drops staggered 25ms per chamber, descending.",
		"kind": &"one-shot",
		"seconds": 0.5,
		"event": &"RESET",
	},
	{
		"id": &"pick-bent",
		"name": "Pick takes a set",
		"description": "A sour metallic groan gliding down as spring steel gives up its shape.",
		"kind": &"one-shot",
		"seconds": 0.5,
		"event": &"PICK_BENT",
	},
	{
		"id": &"pick-broken",
		"name": "Pick snaps",
		"description": "The same voice cut off in 40ms, with a bright fracture burst over it.",
		"kind": &"one-shot",
		"seconds": 0.3,
		"event": &"PICK_BROKEN",
	},
	{
		"id": &"plug-free",
		"name": "Plug goes slack",
		"description": "A low dull give, gliding 168Hz down to 96Hz. No metal, no attack transient.",
		"kind": &"one-shot",
		"seconds": 0.4,
		"event": &"PLUG_FREE",
	},
	{
		"id": &"open",
		"name": "Open",
		"description": "Thunk, five-note major pentatonic arpeggio, then the shackle spring.",
		"kind": &"one-shot",
		"seconds": 1.4,
		"event": &"LOCK_OPENED",
	},
	{
		"id": &"ui",
		"name": "UI detent",
		"description": "6ms of filtered noise. Nothing musical, nothing cute.",
		"kind": &"one-shot",
		"seconds": 0.08,
		"event": &"",
	},
	{
		"id": &"binding",
		"name": "Binding hum",
		"description": "Low resonant hum, 60-90Hz, amplitude tracking resistance.",
		"kind": &"continuous",
		"seconds": 0.8,
		"event": &"",
	},
	{
		"id": &"free-pin",
		"name": "Free pin",
		"description": "Light and springy with a fast wobble — the opposite texture to binding.",
		"kind": &"continuous",
		"seconds": 0.8,
		"event": &"",
	},
	{
		"id": &"counter-rotation",
		"name": "Counter-rotation",
		"description": "Two detuned saws at 45/47Hz through a resonant lowpass. Unpleasant on purpose.",
		"kind": &"continuous",
		"seconds": 0.8,
		"event": &"COUNTER_ROTATION",
	},
	{
		"id": &"scrape",
		"name": "Scrape",
		"description": "Filtered noise driven by pick velocity, sweeping with keyway position.",
		"kind": &"continuous",
		"seconds": 0.8,
		"event": &"PICK_MOVED",
	},
	{
		"id": &"spring",
		"name": "Spring tension",
		"description": "Quiet sawtooth bed under the pick, pitch rising with lift.",
		"kind": &"continuous",
		"seconds": 0.8,
		"event": &"",
	},
	{
		"id": &"plug-friction",
		"name": "Plug movement",
		"description": "Faint sustained friction, gain tracking how fast the plug turns.",
		"kind": &"continuous",
		"seconds": 0.8,
		"event": &"PLUG_MOVED",
	},
	{
		"id": &"ambience",
		"name": "Workshop ambience",
		"description": "Filtered brown noise. Its low-pass opens on a false set and stays open.",
		"kind": &"continuous",
		"seconds": 0.8,
		"event": &"",
	},
]

## Lock events that must have a sound wired to them.
const SOUNDED_EVENTS: Array[StringName] = [
	&"PIN_SET",
	&"PIN_OVERSET",
	&"FALSE_SET_ENTERED",
	&"COUNTER_ROTATION",
	&"PLUG_MOVED",
	&"LOCK_OPENED",
	&"RESET",
	&"PICK_MOVED",
	&"PLUG_FREE",
	&"PICK_BENT",
	&"PICK_BROKEN",
]


static func find(id: StringName) -> Dictionary:
	for s in SOUNDS:
		if s["id"] == id:
			return s
	return {}


## The sound itself, from its first sample. A one-shot runs to its own end; a sustained voice
## is rendered coming in from silence for the catalogue's window.
static func render(id: StringName, synth: SfxSynth) -> PackedFloat32Array:
	match id:
		&"click-shallow":
			return synth.click(0, 5, 0.2)
		&"click-deep":
			return synth.click(4, 5, 0.9)
		&"overset":
			return synth.overset()
		&"false-set":
			return synth.false_set()
		&"reset":
			return synth.reset(5)
		&"pick-bent":
			return synth.pick_strain(false)
		&"pick-broken":
			return synth.pick_strain(true)
		&"plug-free":
			return synth.plug_free()
		&"open":
			return synth.open()
		&"ui":
			return synth.ui_tick()
		&"binding":
			return synth.binding_hum(0.8, 0.9)
		&"free-pin":
			return synth.free_pin(0.8, 1.0)
		&"counter-rotation":
			return synth.grind(0.8, 1.0)
		&"scrape":
			return synth.scrape(0.8, 1.0, 0.5)
		&"spring":
			return synth.spring(0.8, 2.0, 1.0)
		&"plug-friction":
			return synth.plug_friction(0.8, 1.0)
		&"ambience":
			return synth.ambience(0.8, 1.0)
	push_error("SfxCatalogue: no sound named %s" % id)
	return PackedFloat32Array()


## What a one-shot's length is meant to be, in seconds; 0 for a sustained voice.
static func nominal_seconds(id: StringName) -> float:
	match id:
		&"click-shallow":
			return SfxSynth.click_seconds(0.2)
		&"click-deep":
			return SfxSynth.click_seconds(0.9)
		&"overset":
			return SfxSynth.OVERSET_SECONDS
		&"false-set":
			return SfxSynth.FALSE_SET_SECONDS
		&"reset":
			return SfxSynth.reset_seconds(5)
		&"pick-bent":
			return SfxSynth.pick_strain_seconds(false)
		&"pick-broken":
			return SfxSynth.pick_strain_seconds(true)
		&"plug-free":
			return SfxSynth.PLUG_FREE_SECONDS
		&"open":
			return SfxSynth.OPEN_SECONDS
		&"ui":
			return SfxSynth.UI_TICK_SECONDS
	return 0.0
