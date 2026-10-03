class_name Captions
extends RefCounted
## Audio subtitles: every sound the game makes, in words, for a player who cannot hear it or
## has it turned off.
##
## It reads the same event stream the audio reads, so a sound with no caption shows up as a
## missing line rather than as silence nobody notices.
##
## The rule the captions follow: describe the event, not the waveform. "Pin 3 sets" is useful;
## "short metallic click" is not. A subtitle stands in for the information the sound carried,
## not for the sound.
##
## This is the track only — which lines are up, and for how long. Drawing them is the screen's
## business: stacked newest last, each fading over its final [constant FADE_SECONDS].

## How long a caption stays up. Long enough to read, short enough not to stack up.
const CAPTION_SECONDS := 2.2
## Never more than this on screen at once; the oldest is dropped.
const MAX_CAPTIONS := 4
## A caption fades out over the last of its life.
const FADE_SECONDS := 0.4
## Event types that deliberately have no caption of their own. The plug's friction and the
## grind are continuous; the sustained line describes them once rather than sixty times a
## second.
const SILENT_EVENTS: Array[StringName] = [&"ATTEMPT_STARTED", &"COUNTER_ROTATION", &"PLUG_MOVED", &"PICK_MOVED"]
## Counter-rotation force past which the lock is said to grind back.
const GRIND_FORCE := 3.0
## Radians per second past which the plug is said to turn.
const TURN_SPEED := 0.15
const PLUG_RADIUS := 6.35

## Captions on screen, oldest first: { text, kind, expires }. `kind` is &"event" for a discrete
## sound and &"state" for a sustained one.
var _captions: Array[Dictionary] = []
## The sustained sound being described, so it is not announced again every frame.
var _sustained := ""
## When the track was last advanced.
var _clock := -1.0
## What the part the wrench turns is called on the lock being captioned: a plug, or a sleeve.
var turns := "plug"


## The caption for a discrete event, or "" where the event carries no sound of its own.
static func caption_for(type: StringName, data: Dictionary = {}) -> String:
	match type:
		&"PIN_SET":
			if data.get("what", "pin") == "disc":
				return "disc %d sets — the bar drops in" % (int(data.get("chamber", 0)) + 1)
			return "pin %d sets — click" % (int(data.get("chamber", 0)) + 1)
		&"PIN_OVERSET":
			if data.get("what", "pin") == "disc":
				return "disc %d rides on past its gate" % (int(data.get("chamber", 0)) + 1)
			return "pin %d overset — jams" % (int(data.get("chamber", 0)) + 1)
		&"STRIKE":
			var power := float(data.get("power", 1.0))
			return "the gun snaps — %s" % ("hard" if power > 1.05 else ("softly" if power < 0.5 else "a full strike"))
		&"FALSE_SET_ENTERED":
			if data.get("what", "pin") == "disc":
				return "disc %d — a false gate takes the bar" % (int(data.get("chamber", 0)) + 1)
			return "pin %d false sets — the plug gives" % (int(data.get("chamber", 0)) + 1)
		&"LOCK_OPENED":
			return "the lock opens"
		&"PLUG_FREE":
			# Names the cause as well as the sensation: "the plug goes slack" on its own is
			# indistinguishable from a reset to anyone reading rather than hearing.
			return "the plug goes slack — every pin is set, turn harder"
		&"PICK_BENT":
			return "the pick takes a set — it will not sit where you point it now"
		&"PICK_BROKEN":
			return "the pick snaps"
		&"RESET":
			var n := (data.get("dropped", []) as Array).size()
			var pins := "%d pin%s" % [n, "" if n == 1 else "s"]
			var kind: String = data.get("kind", "full")
			if kind == "feather":
				return "feather — %s dropped" % pins
			# Naming the cause matters more here than anywhere: the player pushed one pin and
			# lost several, and without being told the plug turned back it reads as cheating.
			if kind == "counter":
				return "the plug turns back — %s lose their ledge" % pins
			return "tension lost — everything drops"
	return ""


## The sustained sound, in one line that changes only when the sound does. `counter_force` is
## the largest counter-rotation force on any pin; `plug_speed` is mm/s at the plug's rim.
static func sustained_caption(counter_force: float, plug_speed: float) -> String:
	if counter_force > GRIND_FORCE:
		return "the lock grinds back"
	if absf(plug_speed) / PLUG_RADIUS > TURN_SPEED:
		return "the plug turns"
	return ""


## Caption a lock event at time `now`, in seconds on any steady clock.
func on_event(type: StringName, data: Dictionary, now: float) -> void:
	var line := caption_for(type, data)
	if line != "":
		push(line, &"event", now)


## Put a line on the track.
func push(line: String, kind: StringName, now: float) -> void:
	# The line already on the bottom row is not said twice: it just stays up longer.
	if not _captions.is_empty() and _captions[-1]["text"] == line:
		_captions[-1]["expires"] = now + CAPTION_SECONDS
		return
	_captions.append({"text": line, "kind": kind, "expires": now + CAPTION_SECONDS})
	while _captions.size() > MAX_CAPTIONS:
		_captions.pop_front()


## Advance the track to `now` and fold the sustained sounds in, announcing a change only when
## there is one. Call once a frame while a lock is on screen.
func update(now: float, counter_force: float, plug_speed: float) -> void:
	var line := sustained_caption(counter_force, plug_speed)
	if turns != "plug":
		line = line.replace("the plug turns", "the %s turns" % turns)
	if line != _sustained:
		_sustained = line
		if line != "":
			# The line belongs to the frame that just passed, like the events it sits among.
			push(line, &"state", _clock if _clock >= 0.0 else now)
	_clock = now
	_expire(now)


## The lines on screen at `now`, oldest first.
func lines(now: float) -> Array[String]:
	_expire(now)
	var out: Array[String] = []
	for c in _captions:
		out.append(c["text"])
	return out


## The same, with what a screen needs to draw them: { text, kind, life, fade }. `life` is
## seconds left and `fade` the opacity, 1 until the last [constant FADE_SECONDS].
func entries(now: float) -> Array[Dictionary]:
	_expire(now)
	var out: Array[Dictionary] = []
	for c in _captions:
		var life: float = c["expires"] - now
		out.append({"text": c["text"], "kind": c["kind"], "life": life, "fade": minf(1.0, life / FADE_SECONDS)})
	return out


## The same again as bare rows, [text, life, is_state], for a drawing that wants no more.
func rows(now: float) -> Array:
	_expire(now)
	var out: Array = []
	for c in _captions:
		out.append([c["text"], c["expires"] - now, c["kind"] == &"state"])
	return out


func clear() -> void:
	_captions.clear()
	_sustained = ""
	_clock = -1.0


func _expire(now: float) -> void:
	var i := 0
	while i < _captions.size():
		if _captions[i]["expires"] - now > 0.0:
			i += 1
		else:
			_captions.remove_at(i)
