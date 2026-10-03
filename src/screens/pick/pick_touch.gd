class_name PickTouch
extends RefCounted
## Playing with a finger: where the on-screen controls are, and what a touch means.
##
## Geometry and a state machine, in stage px, and nothing else: `PinLockView` feeds it touches
## and reads the hands back out of it, `TouchPads` draws it.
##
## A hook that follows the finger exactly turns every diagonal drag into a shove on the pin being
## left, so touch keeps the keyboard's one good idea — travel and lift are different gestures:
##
##   tap a pin            the tip goes under it, at rest; a tap never lifts
##   drag up              lift it — geared down, and from anywhere on the screen once a pin is chosen
##   drag across          carry the hook to the next pin with the hand still raised
##   let go               the pick comes off and the pin rides its spring back down
##   the wrench slider    off at the bottom, ten pressure steps above it
##   counter (hold)       ease the plug back, for a pin caught in a false set
##   strike (hold)        the snap gun: hold to draw the needle back, let go to strike
##
## The slider is the wrench rather than a setting for it: at the bottom there is no tension, and
## anywhere above it tension is held at that step with no finger on it. That leaves one thumb for
## the pin and one for the counter pad.

## Something has arrived from a touch screen: the controls are drawn, and the lock answers to
## fingers. A key, a controller or a real mouse button takes it back.
static var active := false

# ── Where the controls are ──────────────────────────────────────────────────────────────
## The wrench, down the left edge under the hand that holds it. Its header — the step as a
## number, and the word — sits in the 90 px above it.
const WRENCH_SLIDER := Rect2(30.0, 318.0, 132.0, 592.0)
## Taking the pick out of the lock: the top of the wrench's gutter, out of the thumb's travel.
const WITHDRAW_PAD := Rect2(30.0, 96.0, 132.0, 132.0)
## Pause is in the pick hand's corner, not the wrench hand's: a thumb that has dragged the wrench
## up rests there for the whole attempt, and a control that ends a run does not belong under it.
const PAUSE_PAD := Rect2(1758.0, 96.0, 132.0, 132.0)
## Hold to ease the plug back. The right gutter above the readouts, where the other thumb is.
const COUNTER_PAD := Rect2(1548.0, 252.0, 342.0, 270.0)
## The snap gun has no lift and no counter: the same pad is its trigger.
const STRIKE_PAD := COUNTER_PAD
## Where the front view starts while the wrench has the left edge.
const CLEAR_LEFT := 182.0

# ── How the drags are geared ────────────────────────────────────────────────────────────
## How far up a finger drags to ask for the whole lift, px. Much longer than the pin's own travel
## on screen: a pin moves a few millimetres and a fingertip cannot resolve a fraction of one, so
## the gesture is geared down — it is what makes stopping at the click possible at all.
const LIFT_DRAG_PX := 460.0
## Drag for the wrench's whole range, px: 62 a step, a deliberate movement rather than a twitch.
const WRENCH_DRAG_PX := 620.0
## How many bands' worth of height the off band gets. Letting the wrench go is the panic move —
## it is done because pins are dropping — so it gets a target to slam into without looking.
const OFF_BAND_SHARE := 2
## How far a finger may travel and still be a tap rather than a drag, px.
const TAP_SLOP := 12.0
const STEPS := PinSession.TENSION_STEPS
const NO_POINTER := -1

# ── What the fingers are doing ──────────────────────────────────────────────────────────
var wrench_pointer := NO_POINTER
var wrench_origin_y := 0.0
## The step the wrench was at when the drag began, so a grab never jumps.
var wrench_origin_step := 0
var wrench_dragged := false
var lift_pointer := NO_POINTER
var lift_origin_y := 0.0
## The lift already asked for when the drag began, mm.
var lift_origin_mm := 0.0
var counter_pointer := NO_POINTER
var strike_pointer := NO_POINTER
## The wrench: 0 is off, 1..STEPS a pressure step.
var step := 0
## The chamber the tip is under, -1 with the pick out.
var chamber := -1
## The lift being asked for, mm.
var lift := 0.0
## Both thumbs have been on the glass at once — the grip that makes this playable.
var used_both_thumbs := false


## Note an input event, whatever screen is up: a touch turns the touch scheme on, and anything
## from a keyboard, a controller or a real mouse button turns it off again. Returns true when the
## answer changed.
static func note(event: InputEvent) -> bool:
	var was := active
	if event is InputEventScreenTouch or event is InputEventScreenDrag:
		active = true
	elif event is InputEventKey or event is InputEventJoypadButton:
		active = false
	elif event is InputEventMouseButton and event.device != InputEvent.DEVICE_ID_EMULATION:
		active = false
	return active != was


# ── The wrench ──────────────────────────────────────────────────────────────────────────

## Bands of height below the bottom of band `at`: the off band is `OFF_BAND_SHARE` deep.
static func _shares_below(at: int) -> int:
	return 0 if at <= 0 else OFF_BAND_SHARE + (at - 1)


## The y at which a step's band starts. Step 0 is the bottom of the slider.
static func y_for_step(at: int) -> float:
	var t := float(_shares_below(at)) / float(STEPS + OFF_BAND_SHARE)
	return WRENCH_SLIDER.position.y + WRENCH_SLIDER.size.y * (1.0 - t)


## The step whose drawn band contains `y`. For taps, not drags: a tap chose a band by looking.
static func step_at_y(y: float) -> int:
	var t := 1.0 - (y - WRENCH_SLIDER.position.y) / WRENCH_SLIDER.size.y
	var shares := t * (STEPS + OFF_BAND_SHARE)
	if shares <= OFF_BAND_SHARE:
		return 0
	return clampi(int(floor(shares - OFF_BAND_SHARE)) + 1, 0, STEPS)


## Inside the fat band at the bottom, which means off wherever the drag came from.
static func in_off_zone(y: float) -> bool:
	return y >= y_for_step(1)


## The step a wrench drag is asking for. Relative, not absolute: a sudden change of tension
## drops every pin that is set, so a grab changes nothing until the finger moves, and then it
## moves from where the wrench already was.
func step_for_drag(y: float) -> int:
	if in_off_zone(y):
		return 0
	var moved := (wrench_origin_y - y) / WRENCH_DRAG_PX
	return clampi(roundi(wrench_origin_step + moved * STEPS), 0, STEPS)


## The dial level a step means; step 0 is the wrench off and has none of its own.
static func tension_for(at: int) -> float:
	return 0.0 if at <= 0 else PinSession.tension_for_step(at)


# ── The lift ────────────────────────────────────────────────────────────────────────────

## Lift asked for by a drag, mm: measured from where the finger went down and added to what was
## already asked, so lifting in two goes reaches the same place as lifting in one.
func lift_for_drag(y: float, ceiling: float) -> float:
	var dragged := (lift_origin_y - y) / LIFT_DRAG_PX
	return clampf(lift_origin_mm + dragged * ceiling, 0.0, ceiling)


# ── The gestures ────────────────────────────────────────────────────────────────────────

## A finger has gone down on the wrench.
func grab_wrench(id: int, y: float) -> void:
	wrench_pointer = id
	wrench_origin_y = y
	wrench_origin_step = step
	wrench_dragged = false
	if in_off_zone(y):
		step = 0
	_both(lift_pointer)


## The wrench finger moved. Returns true when the step changed.
func drag_wrench(y: float) -> bool:
	if absf(y - wrench_origin_y) > TAP_SLOP:
		wrench_dragged = true
	var next := step_for_drag(y)
	var changed := next != step
	step = next
	return changed


## The wrench finger came off. A finger that never moved was a tap, and a tap picks the band it
## landed on. Returns true when the step changed.
func release_wrench(y: float, canceled: bool) -> bool:
	var changed := false
	if not wrench_dragged and not canceled:
		var next := step_at_y(y)
		changed = next != step
		step = next
	wrench_pointer = NO_POINTER
	wrench_dragged = false
	return changed


## A finger has gone down on pin `on` (or off the lock, `on` = -1, to lift the pin already
## chosen from somewhere the hand does not cover it). Returns false when there is nothing to lift.
func grab_pin(id: int, on: int, y: float) -> bool:
	if on < 0 and chamber < 0:
		return false
	if on >= 0 and on != chamber:
		lift = 0.0
		chamber = on
	lift_pointer = id
	lift_origin_y = y
	lift_origin_mm = lift
	_both(wrench_pointer)
	return true


## The lifting finger moved: `over` is the chamber under it now (or -1), and crossing into
## another carries the hook there with the lift kept.
func drag_pin(over: int, y: float, ceiling: float) -> void:
	if over >= 0 and over != chamber:
		chamber = over
	lift = lift_for_drag(y, ceiling)


## The pick comes off the pin. Whatever the springs want to do now, they do.
func release_pin() -> void:
	lift_pointer = NO_POINTER
	lift = 0.0


func hold_counter(id: int) -> void:
	counter_pointer = id
	_both(wrench_pointer)
	_both(lift_pointer)


## Take the pick out of the lock.
func withdraw() -> void:
	chamber = -1
	lift = 0.0
	lift_pointer = NO_POINTER


func _both(other: int) -> void:
	if other != NO_POINTER:
		used_both_thumbs = true
