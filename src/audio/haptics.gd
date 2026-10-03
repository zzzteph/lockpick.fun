class_name Haptics
extends RefCounted
## Haptics — the sense this game is about, on the devices that can deliver it.
##
## The whole loop is finding, by touch, which pin the plug is pinching. On a desktop that is
## told by a number, a bar and a click. On a phone, or a pad with motors in it, it can be told
## by the thing in the player's hands.
##
## A phone vibrates through `Input.vibrate_handheld`; every connected joypad gets the same
## pattern on its motors. Where there is neither this does nothing, and [method is_supported]
## says so, so a settings screen can say so too rather than offer a dead switch.

## The patterns, in milliseconds: on, off, on, …
##
## Short. All of them shorter than they feel, because a vibration motor has spin-up and
## spin-down either side of whatever is asked for — 10 ms of request is perhaps 40 ms of buzz.
## Anything long enough to be called a buzz is too long for an event that happens six times a
## lock.
const PATTERNS := {
	## A pin catching on the ledge: the good one, and the one that must feel crisp.
	&"set": [14],
	## Pushed too far. Duller and doubled — a mistake should not feel like a success.
	&"overset": [22, 34, 22],
	## A false set. Halfway between: something happened, it was not the thing you wanted.
	&"false_set": [9],
	## One step of the wrench. Barely there — this fires ten times on the way up.
	&"detent": [5],
	## Every driver above the line but the wrench not asking for enough turn to open it.
	&"free": [10, 40, 10],
	## Pins falling back in. The most expensive thing that can happen, and it says so.
	&"reset": [30, 40, 60],
	## The pick has snapped. The attempt is over.
	&"broken": [60, 50, 60, 50, 90],
	## Open.
	&"opened": [18, 30, 18, 30, 70],
}

## Which event plays which pattern. `PLUG_MOVED`, `COUNTER_ROTATION` and `PICK_MOVED` fire
## continuously or on every step, and a motor cannot express a continuous quantity; they are
## the sound's job. `ATTEMPT_STARTED` is not something a hand should feel, and `PICK_BENT`
## already arrives with a warning on screen.
const EVENT_PATTERNS := {
	&"WRENCH_STEP": &"detent",
	&"PIN_SET": &"set",
	&"PIN_OVERSET": &"overset",
	&"FALSE_SET_ENTERED": &"false_set",
	&"PLUG_FREE": &"free",
	&"RESET": &"reset",
	&"PICK_BROKEN": &"broken",
	&"LOCK_OPENED": &"opened",
}

## The shortest gap between two vibrations, in ms.
##
## A cascade emits a `RESET` and then a run of per-pin events in the same frame, and firing
## all of them turns a distinct event into mush — the motor is still spinning down from the
## last one. The first pattern of a burst wins and the rest are dropped, which is also the
## right priority: events arrive in the order the lock decided them, and the big ones come
## first.
const MIN_GAP_MS := 45

## Off until the settings say otherwise, so nothing buzzes before the player has chosen.
static var enabled := false
## Where a pattern goes instead of the motors, when set: called with the pattern. For tests.
static var sink := Callable()

static var _last := -INF


## Whether anything here can vibrate at all.
static func is_supported() -> bool:
	return OS.has_feature("mobile") or not Input.get_connected_joypads().is_empty()


## Vibrate for a lock event, if it is one a hand should feel. `now_ms` is the clock to space
## patterns by; left out, it is the engine's own.
static func handle_event(type: StringName, _data: Dictionary = {}, now_ms := -1.0) -> void:
	if EVENT_PATTERNS.has(type):
		fire(PATTERNS[EVENT_PATTERNS[type]], now_ms)


## One step of the wrench, called by the input layer rather than driven by a lock event.
static func detent(now_ms := -1.0) -> void:
	fire(PATTERNS[&"detent"], now_ms)


static func fire(pattern: Array, now_ms := -1.0) -> void:
	if not enabled:
		return
	var t := now_ms if now_ms >= 0.0 else float(Time.get_ticks_msec())
	if t - _last < MIN_GAP_MS:
		return
	_last = t
	if sink.is_valid():
		sink.call(pattern)
		return
	var tree := Engine.get_main_loop() as SceneTree
	var at := 0
	for i in pattern.size():
		var ms: int = pattern[i]
		# Even entries are pulses, odd ones the rests between them.
		if i % 2 == 0:
			if at == 0:
				_pulse(ms)
			elif tree != null:
				tree.create_timer(at / 1000.0).timeout.connect(_pulse.bind(ms))
		at += ms


## Forget the last vibration, so the next is not spaced against it.
static func reset_clock() -> void:
	_last = -INF


static func _pulse(ms: int) -> void:
	Input.vibrate_handheld(ms)
	for pad in Input.get_connected_joypads():
		# The light motor for a tick; the heavy one joins in for the events that cost something.
		Input.start_joy_vibration(pad, 1.0, 1.0 if ms >= 30 else 0.0, ms / 1000.0)
