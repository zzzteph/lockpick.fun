class_name WheelLockView
extends Node2D
## The combination padlock on the pick screen, drawn as the thing you hold.
##
## A body, a shackle out of its right face, and a row of digit wheels rolled in place — the
## nearest wheel is the leftmost. The shackle is the wrench: pull it and one wheel drags.
##
## The lock is shown from two sides, each in its own honest projection. The FRONT is the flat
## face you operate; each wheel's window frame carries its state. The SIDE, in the left gutter,
## is the pack looked at down the axle: the first wheel whole in front, every wheel behind it
## peeking out as a ring, each with its gates cut into the rim at their live angles and the
## fence's tooth riding the front one. When the cuts stand in one radial line you are looking
## down the open channel. Wheel packs are coloured on both rungs of the ladder — the teal gate
## and the amber tooth ARE how a wheel is read — unless `plain_on_normal` says otherwise.
##
## It owns the attempt (a WheelEngine stepped at its own fixed 120 Hz), turns keys, mouse and
## touch into what the hands want, and draws from the engine's state, never from the input.

signal sim_event(type: StringName, data: Dictionary)
## The player asked to restart (R) or to pause (Esc).
signal restart_requested
signal pause_requested

# ── The hands ───────────────────────────────────────────────────────────────────────────
## The one strength a shackle is ever pulled at: a hand pulls or it does not. Comfortably over
## the hold floor, a readable drag on the bound wheel, and light enough that a false gate's
## shove stays a texture rather than a wall.
const PULL := 0.45
## Dial units per second the wheel is rolled at while Space is held.
const KEY_ROLL_RATE := 4.2
## Stage px of vertical drag for one full turn of a wheel.
const DRAG_PX := 460.0
## The longest stretch of real time one frame may ask the engine to catch up.
const MAX_CATCHUP := 0.25
const NO_POINTER := -99
const MOUSE_POINTER := -1

# ── Where it sits on the stage ──────────────────────────────────────────────────────────
const SHACKLE_THICK := 54.0
## How far the hook shifts outward at full travel — the give a hand reads the fence's load from.
const SHACKLE_GIVE := 22.0
## How far the whole hook slides once the lock is open: clear of the toe's mouth, the long leg
## still home in its channel.
const SHACKLE_OPEN_SLIDE := 56.0
## Room reserved beside the body for the arch, so body-plus-hook centres as a group.
const SHACKLE_REACH := 178.0
const WHEEL_W := 132.0
const WHEEL_H := 236.0
const WHEEL_GAP := 36.0
const BODY_H := 470.0
const BODY_Y := 402.0
const ROW_Y := 618.0
## The side view: the front wheel's radius, and how much of each wheel behind it shows.
const PACK_R := 105.0
const PACK_BAND := 18.0
## Camera micro-motion: the whole drawing leans this many px as the shackle travels to open.
const CAMERA_DRIFT := 6.0

## Normal draws the same two views with the colour narration off: ink outlines, no state on the
## window frames. Off by default — on a wheel pack the colour is the reading, not a hint, so
## the game keeps it on both rungs.
var plain_on_normal := false
## Accessibility: the pull latches on Q instead of being held.
var tension_toggle := false
## A script is driving: `script_input` (or a tape) is stepped instead of the hands.
var scripted := false
var script_input := {"wheel": -1, "pos": 0.0, "pull": false, "level": 0.0}
## Passed to the engine at `start`: the feather's short forgiveness when the pull drops out.
var feather_enabled := false
## Accessibility: no camera drift.
var reduced_motion := false

var engine: WheelEngine
var def: Dictionary
var assist: StringName = &"training"

## When true: no stepping, no input.
var paused := false:
	set(value):
		paused = value
		if value:
			_release_hands()

var opened: bool:
	get:
		return engine != null and engine.opened
## Simulated seconds this attempt.
var time: float:
	get:
		return engine.time if engine != null else 0.0
var stats: Dictionary:
	get:
		return engine.stats if engine != null else {}

var _count := 0
var _body := Rect2()
var _acc := 0.0
## The engine's last-but-one tick, for drawing between ticks.
var _prev_pos := PackedFloat64Array()
var _prev_theta := 0.0
var _prev_resistance := 0.0
var _slide := 0.0
var _drift := 0.0

# What the hands are doing.
var _wheel := 0
var _key_pos := 0.0
var _space := false
var _pull_key := false
var _toggled := false
## The detent a pending arrow-click is rolling toward, or NAN.
var _click_target := NAN
var _drag_id := NO_POINTER
var _drag_origin_y := 0.0
var _drag_y := 0.0
var _drag_origin_pos := 0.0
## Set on a wheel grab: the drag re-origins at the wheel's real position on the next tick.
var _grab := false
var _shackle_pointers := {}
var _touch_active := false

var _tape: Array = []
var _tape_at := 0
var _tape_left := 0

## Per wheel: it has been caught in a false gate at least once this attempt.
var _fooled := PackedByteArray()

var _strips: Array[Control] = []
var _overlay: Node2D


## Put a lock on the bench. `lock_def` is a roster dictionary of family "combination";
## `assist_mode` is &"training" or &"normal".
func start(lock_def: Dictionary, lock_seed: int, assist_mode: StringName) -> void:
	def = lock_def
	assist = assist_mode
	engine = WheelEngine.create(lock_def, lock_seed, assist_mode, {"feather": feather_enabled})
	_count = engine.count
	var row_w := _count * WHEEL_W + (_count - 1) * WHEEL_GAP
	var body_w := maxf(row_w + 220.0, 640.0)
	_body = Rect2(Pal.STAGE.x / 2.0 - (body_w + SHACKLE_REACH) / 2.0, BODY_Y, body_w, BODY_H)
	_acc = 0.0
	_slide = 0.0
	_drift = 0.0
	_prev_theta = 0.0
	_prev_resistance = 0.0
	_prev_pos.resize(_count)
	for i in _count:
		_prev_pos[i] = engine.wheels[i].pos
	_fooled.resize(_count)
	_fooled.fill(0)
	_wheel = 0
	_key_pos = engine.wheels[0].pos
	_toggled = false
	_touch_active = false
	_release_hands()
	scripted = false
	_tape = []
	_build_layers()
	queue_redraw()


## Step a recorded tape instead of the hands: [{"ticks": int, "input": Dictionary}] as
## `WheelSolver.solve` returns it. Once it runs out the view stays scripted, on `script_input`.
func play_tape(tape: Array) -> void:
	_tape = tape
	_tape_at = 0
	_tape_left = int(tape[0]["ticks"]) if not tape.is_empty() else 0
	scripted = true


# ── What the HUD shows ──────────────────────────────────────────────────────────────────

## {"tension": 0..1 (0 = shackle not pulled), "resistance": 0..1, "state_word", "progress":
## 0..1 of the wheels seated, "legend": [[key, action], …], "hint"}. `state_word` is always
## empty and `hint` is only ever the pull-through prompt: a word naming a seated wheel would be
## a decoded digit handed over.
func hud() -> Dictionary:
	if engine == null:
		return {"tension": 0.0, "resistance": 0.0, "state_word": "", "progress": 0.0, "legend": [], "hint": ""}
	var legend: Array
	if _touch_active:
		legend = [["tap", "a wheel"], ["drag", "turn it"], ["hold", "the shackle"]]
	else:
		legend = [["← →", "choose a wheel"], ["space", "turn"], ["↑ ↓", "one click"],
			["Q", "pull the shackle"], ["R", "restart"], ["esc", "pause"]]
	return {
		"tension": engine.tension,
		"resistance": lerpf(_prev_resistance, engine.resistance, _alpha()),
		"state_word": "",
		"progress": float(engine.seated_count()) / float(maxi(1, _count)),
		"legend": legend,
		"hint": "every wheel is seated — pull through" if engine.seated_but_held() else "",
		"tension_hint": "press and hold the shackle to pull" if _touch_active else "hold [Q] to pull the shackle",
	}


## A snapshot of the attempt for a lesson's step tests, in the pin view's own keys: "pick" is
## the wheel under the thumb, "binding" the wheel the fence bears on, "states" the wheels'
## states (the pin locks' numbering). A wheel cannot overset and carries no serrations.
func lesson_state() -> Dictionary:
	var states := PackedInt32Array()
	var fooled_then_set := false
	if engine != null:
		for w in engine.wheels:
			states.append(w.state)
			if w.state == WheelEngine.SET and _fooled[w.index] == 1:
				fooled_then_set = true
	return {
		"tension": engine.tension if engine != null else 0.0,
		"pick": engine.pick_wheel if engine != null else -1,
		"binding": engine.binding if engine != null else -1,
		"states": states,
		"opened": opened,
		"full_resets": int(stats.get("full_resets", 0)),
		"false_sets": int(stats.get("false_sets", 0)),
		"fooled_then_set": fooled_then_set,
		"serrated_set": false,
		"overset_for": 0.0,
	}


# ── Geometry of the drawing ─────────────────────────────────────────────────────────────

func body_rect() -> Rect2:
	return _body


## Wheel `i`'s face.
func wheel_rect(i: int) -> Rect2:
	var row_w := _count * WHEEL_W + (_count - 1) * WHEEL_GAP
	var left := _body.position.x + (_body.size.x - row_w) / 2.0
	return Rect2(left + i * (WHEEL_W + WHEEL_GAP), ROW_Y - WHEEL_H / 2.0, WHEEL_W, WHEEL_H)


## Which wheel a point is on, or -1. A finger pad's worth of slack on every side: a wheel is a
## thumb-sized control.
func wheel_at_point(p: Vector2) -> int:
	for i in _count:
		if wheel_rect(i).grow_individual(14.0, 20.0, 14.0, 20.0).has_point(p):
			return i
	return -1


## The hand-sized region that means "the shackle" to a pointer: press and hold anywhere on the
## hook to pull.
func shackle_grab_rect() -> Rect2:
	return Rect2(_body.end.x - 110.0, _body.position.y + 20.0, SHACKLE_REACH + 140.0, _body.size.y - 40.0)


## Where an opening flourish should centre itself.
func centre() -> Vector2:
	return Vector2(_body.position.x + _body.size.x / 2.0, _body.position.y + _body.size.y * 0.42)


## Everything this view draws: the pack's side view, the body and the hook at its widest.
func bounds() -> Rect2:
	var outer := PACK_R + PACK_BAND * (_count - 1)
	var left := _body.position.x - outer * 2.0 - 48.0
	return Rect2(left, BODY_Y - 14.0, _body.end.x + SHACKLE_REACH + 60.0 - left, BODY_H + 28.0)


# ── The hands ───────────────────────────────────────────────────────────────────────────

func _unhandled_input(event: InputEvent) -> void:
	if engine == null or paused:
		return
	if event is InputEventKey:
		_key(event as InputEventKey)
	elif event is InputEventScreenTouch:
		var touch := make_input_local(event) as InputEventScreenTouch
		_touch_active = true
		if touch.pressed:
			if _pointer_down(touch.index, touch.position):
				get_viewport().set_input_as_handled()
		else:
			_pointer_up(touch.index)
	elif event is InputEventScreenDrag:
		var drag := make_input_local(event) as InputEventScreenDrag
		_pointer_move(drag.index, drag.position)
	elif event is InputEventMouseButton:
		# A finger arrives as a touch and as an emulated mouse; the touch has been heard.
		if event.device == InputEvent.DEVICE_ID_EMULATION:
			return
		var button := make_input_local(event) as InputEventMouseButton
		if button.button_index != MOUSE_BUTTON_LEFT:
			return
		if button.pressed:
			if _pointer_down(MOUSE_POINTER, button.position):
				get_viewport().set_input_as_handled()
		else:
			_pointer_up(MOUSE_POINTER)
	elif event is InputEventMouseMotion:
		if event.device == InputEvent.DEVICE_ID_EMULATION:
			return
		_pointer_move(MOUSE_POINTER, (make_input_local(event) as InputEventMouseMotion).position)


func _key(e: InputEventKey) -> void:
	var down := e.pressed
	match e.physical_keycode:
		KEY_Q:
			if down and not e.echo:
				_toggled = not _toggled
			_pull_key = down
		KEY_SPACE:
			_space = down
		KEY_LEFT:
			if down:
				_step_wheel(-1)
		KEY_RIGHT:
			if down:
				_step_wheel(1)
		KEY_UP:
			if down:
				_click(1)
		KEY_DOWN:
			if down:
				_click(-1)
		KEY_R:
			if down and not e.echo:
				restart_requested.emit()
		KEY_ESCAPE:
			if down and not e.echo:
				pause_requested.emit()
		_:
			# The wrench's pressure keys are dead here, not silent: a shackle has one pull.
			return
	_touch_active = false
	get_viewport().set_input_as_handled()


## Move the thumb one wheel along. Clamped, not wrapping: a row has two ends.
func _step_wheel(delta: int) -> void:
	# A pending click belongs to the wheel it was pressed on; moving hands drops it.
	_click_target = NAN
	if _wheel < 0:
		_wheel = 0
		return
	_wheel = clampi(_wheel + delta, 0, _count - 1)


## One detent click, up or down. The click is held as a target until the wheel arrives, so
## repeats stack cleanly; stepping down from 0 wraps to 9 through the seam, one click.
func _click(dir: int) -> void:
	if _wheel < 0:
		_wheel = 0
	var from := _click_target if not is_nan(_click_target) else engine.wheels[_wheel].pos
	var digit := int(round(from / WheelEngine.DETENT - 0.5))
	_click_target = WheelEngine.detent_centre(posmod(digit + dir, WheelEngine.DIGITS))


## A press. The shackle wins over the wheels: a press on the hook is the pull and nothing else.
func _pointer_down(id: int, p: Vector2) -> bool:
	if scripted or engine.opened:
		return false
	if shackle_grab_rect().has_point(p):
		_shackle_pointers[id] = true
		return true
	var wheel := wheel_at_point(p)
	if wheel < 0:
		return false
	# A tap selects; a vertical drag rolls, from the angle the wheel is actually parked at — a
	# wheel has no spring, and a grab must continue the dial, never yank it somewhere stale.
	_wheel = wheel
	_click_target = NAN
	_drag_id = id
	_drag_origin_y = p.y
	_drag_y = p.y
	_grab = true
	return true


func _pointer_move(id: int, p: Vector2) -> void:
	if id == _drag_id:
		_drag_y = p.y


func _pointer_up(id: int) -> void:
	_shackle_pointers.erase(id)
	if id == _drag_id:
		# The thumb comes off the wheel and a springless wheel simply stays where it was rolled.
		_drag_id = NO_POINTER


func _release_hands() -> void:
	_space = false
	_pull_key = false
	_click_target = NAN
	_drag_id = NO_POINTER
	_grab = false
	_shackle_pointers.clear()


## What the hands want this tick.
func _read_hands(dt: float) -> Dictionary:
	# A key or button released while the window was elsewhere never sends its release.
	if _space and not Input.is_physical_key_pressed(KEY_SPACE):
		_space = false
	if _pull_key and not Input.is_physical_key_pressed(KEY_Q):
		_pull_key = false
	if not Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		_pointer_up(MOUSE_POINTER)
	var pulled := (_toggled if tension_toggle else _pull_key) or not _shackle_pointers.is_empty()
	var pos := 0.0
	if _wheel >= 0:
		var w := engine.wheels[_wheel]
		if _drag_id != NO_POINTER:
			if _grab:
				_drag_origin_pos = w.pos
				_grab = false
			# The dial is a circle, so the drag never clamps: it wraps through the 9/0 seam.
			_key_pos = WheelEngine.wrap_pos(_drag_origin_pos + (_drag_origin_y - _drag_y) / DRAG_PX * WheelEngine.TRAVEL)
		elif _space:
			# Space is the continuous roll and it owns the command while held; past the top it
			# wraps, because a dial has no stop.
			_click_target = NAN
			_key_pos += KEY_ROLL_RATE * dt
			if _key_pos > WheelEngine.TRAVEL:
				_key_pos -= WheelEngine.TRAVEL
		elif not is_nan(_click_target):
			_key_pos = _click_target
			if absf(w.pos - _click_target) < 1e-3:
				_click_target = NAN
		else:
			# Hands still: the command follows the wheel, so a released wheel parks where it is.
			_key_pos = w.pos
		pos = clampf(_key_pos, 0.0, WheelEngine.TRAVEL)
	return {"wheel": _wheel, "pos": pos, "pull": pulled, "level": PULL if pulled else 0.0}


func _next_input(dt: float) -> Dictionary:
	if not scripted:
		return _read_hands(dt)
	while not _tape.is_empty() and _tape_left <= 0:
		_tape_at += 1
		if _tape_at >= _tape.size():
			_tape = []
		else:
			_tape_left = int(_tape[_tape_at]["ticks"])
	if _tape.is_empty():
		return script_input
	_tape_left -= 1
	return _tape[_tape_at]["input"]


# ── Stepping ────────────────────────────────────────────────────────────────────────────

func _physics_process(delta: float) -> void:
	if engine == null or paused or engine.opened:
		return
	# Whole ticks only: the engine never sees a frame time. Once the lock is open the
	# simulation is done.
	_acc += minf(delta, MAX_CATCHUP)
	while _acc >= WheelEngine.DT - 1e-9 and not engine.opened:
		_prev_theta = engine.theta
		_prev_resistance = engine.resistance
		for i in _count:
			_prev_pos[i] = engine.wheels[i].pos
		engine.step(_next_input(WheelEngine.DT), WheelEngine.DT)
		_acc = maxf(0.0, _acc - WheelEngine.DT)
		for ev in engine.drain_events():
			if ev["type"] == &"FALSE_SET_ENTERED":
				_fooled[ev["chamber"]] = 1
			sim_event.emit(ev["type"], ev)
	if engine.opened:
		_acc = 0.0


func _process(delta: float) -> void:
	if engine == null:
		return
	# The give is the physics itself: the engine's resolved travel, the same number the wheels
	# are stopping. It barely budges against a bound wheel, a false gate buys a few extra px,
	# and releasing the pull gives it all back. On the open the whole hook slides out as one.
	var travel := clampf(lerpf(_prev_theta, engine.theta, _alpha()) / WheelEngine.THETA_OPEN, 0.0, 1.0)
	if engine.opened:
		_slide = lerpf(_slide, SHACKLE_OPEN_SLIDE, 1.0 - exp(-14.0 * delta))
	else:
		_slide = travel * SHACKLE_GIVE
	_drift = 0.0 if reduced_motion else travel * CAMERA_DRIFT
	queue_redraw()
	for i in _strips.size():
		_strips[i].position = wheel_rect(i).position + Vector2(2.0 + _drift, 2.0)
		_strips[i].queue_redraw()
	if _overlay != null:
		_overlay.queue_redraw()


## Fraction of a tick elapsed since the last step.
func _alpha() -> float:
	if engine == null or engine.opened:
		return 1.0
	return clampf(_acc / WheelEngine.DT, 0.0, 1.0)


## Wheel `i`'s position between ticks, the short way round the dial.
func _shown_pos(i: int) -> float:
	var now := engine.wheels[i].pos
	var d := now - _prev_pos[i]
	if d > WheelEngine.TRAVEL / 2.0:
		d -= WheelEngine.TRAVEL
	elif d < -WheelEngine.TRAVEL / 2.0:
		d += WheelEngine.TRAVEL
	return WheelEngine.wrap_pos(_prev_pos[i] + d * _alpha())


# ── Drawing ─────────────────────────────────────────────────────────────────────────────

## The digit strips are clipped to their windows and the side view lies over everything, so
## each gets a canvas item of its own under this one.
func _build_layers() -> void:
	for strip in _strips:
		strip.queue_free()
	_strips.clear()
	if _overlay != null:
		_overlay.queue_free()
	for i in _count:
		var r := wheel_rect(i)
		var strip := Control.new()
		strip.name = "Strip%d" % i
		strip.clip_contents = true
		strip.mouse_filter = Control.MOUSE_FILTER_IGNORE
		strip.position = r.position + Vector2(2.0, 2.0)
		strip.size = r.size - Vector2(4.0, 4.0)
		strip.draw.connect(_draw_strip.bind(strip, i))
		add_child(strip)
		_strips.append(strip)
	_overlay = Node2D.new()
	_overlay.name = "Overlay"
	_overlay.draw.connect(_draw_overlay)
	add_child(_overlay)


func _plain() -> bool:
	return plain_on_normal and assist == &"normal"


## A wheel's verdict as a colour: amber on the one dragging, teal seated, violet lying.
func _state_ink(w: WheelEngine.Wheel) -> Color:
	if _plain():
		return Pal.STEEL
	return Pal.state_color(w.state)


func _draw() -> void:
	if engine == null:
		return
	draw_set_transform(Vector2(_drift, 0.0))
	_draw_shackle()
	# The body, over the hook's legs.
	_round_rect(self, _body, 26.0, Pal.PAPER_SHADE, Pal.INK, Pal.STROKE)
	# The toe's mouth in the body's edge.
	var toe_y1 := _body.end.y - 62.0
	var toe_y0 := toe_y1 - SHACKLE_THICK
	draw_line(Vector2(_body.end.x - 1.0, toe_y0 - 8.0), Vector2(_body.end.x - 1.0, toe_y1 + 8.0), Pal.INK, Pal.STROKE)
	# The slot each wheel sits in, then the wheel face proud of it. The window frame carries the
	# wheel's verdict, so the pack reads at a glance while the side view explains it.
	for i in _count:
		var w := engine.wheels[i]
		var r := wheel_rect(i)
		var active := i == engine.pick_wheel
		_round_rect(self, r.grow_individual(8.0, 10.0, 8.0, 10.0), 14.0, Color(Pal.INK, 0.08), Color.TRANSPARENT, 0.0)
		var frame := Color(_state_ink(w), 0.9)
		if _plain():
			frame = Pal.INK if active else Pal.RULE
		_round_rect(self, r, 12.0, Pal.PAPER, frame, Pal.HEAVY if active else Pal.STROKE)


## A side hook out of the right face: the long leg rides deep in the body's upper half, the
## arch bulges into the free right gutter, and the toe seats in the lower half.
func _draw_shackle() -> void:
	var right := _body.end.x
	var top_y0 := _body.position.y + 62.0
	var top_y1 := top_y0 + SHACKLE_THICK
	var toe_y1 := _body.end.y - 62.0
	var toe_y0 := toe_y1 - SHACKLE_THICK
	var mid_y := (top_y0 + toe_y1) / 2.0
	var arc_x := right - 6.0 + _slide
	var r_out := mid_y - top_y0
	var r_in := mid_y - top_y1
	var tip_top := right - 88.0 + _slide
	var tip_toe := right - 20.0 + _slide
	var c := Vector2(arc_x, mid_y)
	var pts := PackedVector2Array()
	pts.append(Vector2(tip_top, top_y0))
	_arc_points(pts, c, r_out, -PI / 2.0, PI / 2.0, 48)
	pts.append(Vector2(tip_toe, toe_y1))
	pts.append(Vector2(tip_toe, toe_y0))
	_arc_points(pts, c, r_in, PI / 2.0, -PI / 2.0, 40)
	pts.append(Vector2(tip_top, top_y1))
	Pal.poly(self, pts, Pal.PAPER, Pal.INK, Pal.STROKE)
	# The pointer's invitation: while nothing pulls, two amber chevrons point the way out of
	# the arch. They vanish under any pull, because the give itself is the feedback then.
	if not engine.opened and engine.tension < 0.05:
		var chev_x := arc_x + r_out + 16.0
		for k in 2:
			var x := chev_x + k * 22.0
			draw_polyline(PackedVector2Array([Vector2(x, mid_y - 14.0), Vector2(x + 14.0, mid_y), Vector2(x, mid_y + 14.0)]),
				Pal.AMBER_TEXT, Pal.HEAVY, true)


## The digit strip of wheel `i`: the current digit through the middle of the window, its
## neighbours rolled part-way out of it. A wheel parked on a detent lands its digit dead centre.
func _draw_strip(strip: Control, i: int) -> void:
	if engine == null or i >= _count:
		return
	var pitch := WHEEL_H / 3.0
	var centre_x := strip.size.x / 2.0
	var row_y := ROW_Y - wheel_rect(i).position.y - 2.0
	var at := _shown_pos(i) / WheelEngine.DETENT - 0.5
	var nearest := int(round(at))
	for k in range(-2, 3):
		var y_off := (k - (at - nearest)) * pitch
		if absf(y_off) > pitch * 1.5 + 1.0:
			continue
		var centreish := absf(y_off) < pitch * 0.5
		var size := Pal.T_HEADING if centreish else Pal.T_BODY
		Pal.text(strip, Vector2(centre_x, row_y + y_off + size * 0.36), str(posmod(nearest + k, WheelEngine.DIGITS)), size,
			Pal.INK if centreish else Color(Pal.INK_LIGHT, 0.55), HORIZONTAL_ALIGNMENT_CENTER, centreish)


func _draw_overlay() -> void:
	if engine == null:
		return
	var o := _overlay
	o.draw_set_transform(Vector2(_drift, 0.0))
	var pitch := WHEEL_H / 3.0
	for i in _count:
		var r := wheel_rect(i)
		# The window's own edges: two score lines the centre digit sits between, like the
		# stamped read line on a real wheel.
		var line := Pal.INK if i == engine.pick_wheel else Pal.RULE
		for y: float in [ROW_Y - pitch / 2.0, ROW_Y + pitch / 2.0]:
			o.draw_line(Vector2(r.position.x - 12.0, y), Vector2(r.end.x + 12.0, y), line, Pal.STROKE)
		# The ribbed edge a thumb finds.
		for g in range(1, 5):
			var gy := r.position.y + r.size.y * g / 5.0
			o.draw_line(Vector2(r.position.x - 8.0, gy), Vector2(r.position.x - 2.0, gy), Pal.RULE, Pal.HAIRLINE)
			o.draw_line(Vector2(r.end.x + 2.0, gy), Vector2(r.end.x + 8.0, gy), Pal.RULE, Pal.HAIRLINE)
	_draw_pack(o)


## Where dial position `at` on a wheel standing at `pos` appears on the side view: the digit in
## the front window is at the top, under the fence.
static func _angle_of(pos: float, at: float) -> float:
	return wrapf((at - pos) / WheelEngine.TRAVEL * TAU, -PI, PI) - PI / 2.0


## The lock's second side: the whole pack, edge-on.
func _draw_pack(o: CanvasItem) -> void:
	var plain := _plain()
	var ghost := Color(Pal.INK, 0.75)
	var front := engine.wheels[0]
	var front_pos := _shown_pos(0)
	var picked := clampi(engine.pick_wheel, 0, _count - 1)
	var outer := PACK_R + PACK_BAND * (_count - 1)
	var c := Vector2(_body.position.x - outer - 48.0, ROW_Y)

	# Deepest wheel first, the front wheel last — each disc drawn whole, each next one covering
	# all but the ring. A breath of shade per step back keeps the stack reading as depth.
	for i in range(_count - 1, -1, -1):
		var w := engine.wheels[i]
		var pos := _shown_pos(i)
		var rim := PACK_R + PACK_BAND * i
		o.draw_circle(c, rim, Pal.PAPER)
		if i > 0:
			o.draw_circle(c, rim, Color(Pal.INK, 0.03 * i))
		# Its knurled grip, its state on its outline, and the heavy line on the picked wheel.
		for k in 36:
			var a := k / 36.0 * TAU
			var dir := Vector2(cos(a), sin(a))
			o.draw_line(c + dir * (rim - 6.0), c + dir * (rim + 1.0), Color(Pal.INK, 0.35), Pal.HAIRLINE)
		o.draw_arc(c, rim, 0.0, TAU, 96, ghost if plain else Color(_state_ink(w), 0.9),
			Pal.HEAVY if i == picked else Pal.STROKE, true)
		# The bit of every gate this wheel shows: through the ring on the deep wheels, deep
		# into the face on the front one.
		_draw_cut(o, c, _angle_of(pos, w.gate), rim, 34.0 if i == 0 else PACK_BAND + 4.0, true, plain)
		for f in w.false_gates:
			_draw_cut(o, c, _angle_of(pos, f), rim, 12.0 if i == 0 else 8.0, false, plain)

	# The digits, stamped round the front wheel's face and orbiting live. The one at the top is
	# the one showing in the front window, and the digit passing the true gate sits in its
	# mouth: the gate wears its number.
	for d in WheelEngine.DIGITS:
		var da := _angle_of(front_pos, WheelEngine.detent_centre(d))
		var at_top := absf(wrapf(da + PI / 2.0, -PI, PI)) < 0.31
		var p := c + Vector2(cos(da), sin(da)) * (PACK_R - 40.0)
		Pal.text(o, p + Vector2(0.0, Pal.T_DIM * 0.36), str(d), Pal.T_DIM,
			Pal.INK if at_top else Color(Pal.INK_LIGHT, 0.6), HORIZONTAL_ALIGNMENT_CENTER, at_top)

	# The hub: the shackle's leg, end-on — the whole pack rides on it.
	o.draw_circle(c, 22.0, Pal.PAPER_SHADE)
	o.draw_arc(c, 22.0, 0.0, TAU, 48, ghost, Pal.STROKE, true)

	# The lined-up channel: the moment every cut stands in one radial row is the climax of the
	# whole decode, so its walls get one clear emphasis, right where the tooth drives through.
	if (engine.seated_count() == _count or engine.opened) and not plain:
		var a := _angle_of(front_pos, front.gate)
		for pass_: Array in [[10.0, Color(Pal.TEAL_TEXT, 0.22)], [Pal.HEAVY, Pal.TEAL_TEXT]]:
			for side: float in [-0.17, 0.17]:
				var dir := Vector2(cos(a + side), sin(a + side))
				o.draw_line(c + dir * (outer + 3.0), c + dir * (PACK_R - 34.0), pass_[1], pass_[0], true)

	# The fence, in section: the bar and the one drawn tooth, riding the front wheel's rim.
	# Pressed only while the pull is on — release, and the tooth lifts a hair clear, which is
	# the escape from a lie, drawn. Under the pull: seated sits down inside the clear cut, a
	# lie stops at the shallow floor, the binder presses solid metal.
	var bar := Rect2(c.x - 64.0, c.y - outer - 46.0, 128.0, 14.0)
	var pulling := engine.opened or engine.tension > 0.05
	var drop := 0.0
	if engine.opened:
		drop = 40.0
	elif front.state == WheelEngine.SET:
		drop = 26.0
	elif front.state == WheelEngine.FALSE_SET:
		drop = 9.0
	var tip_y := c.y - PACK_R + drop if pulling else c.y - PACK_R - 6.0
	Pal.box(o, bar, Pal.PAPER, ghost, Pal.STROKE)
	var tooth := Rect2(c.x - 13.0, bar.end.y, 26.0, tip_y - bar.end.y)
	o.draw_rect(tooth, Pal.PAPER)
	Pal.box(o, tooth, Color(Pal.INK, 0.26) if plain else Color(_state_ink(front), 0.55), ghost, Pal.STROKE)
	# The jam, lit at the contact and keyed to the pull being held.
	if not engine.opened and front.state == WheelEngine.BINDING and engine.tension > 0.05:
		o.draw_line(Vector2(c.x - 16.0, tip_y), Vector2(c.x + 16.0, tip_y), Pal.AMBER_TEXT, Pal.HEAVY)

	# Names. The callouts stay put and the leader lines chase the geometry.
	var size := Pal.T_DIM
	Pal.text(o, Vector2(bar.position.x - 12.0, bar.get_center().y + size * 0.36), "fence", size, ghost, HORIZONTAL_ALIGNMENT_RIGHT)
	# Which ring is which wheel: a small column at the pack's lower right, one hairline out to
	# each rim.
	var numeral_x := _body.position.x - 14.0
	for i in _count:
		var rim := PACK_R + PACK_BAND * i
		var ny := c.y + 34.0 + i * size * 1.5
		var a := asin(minf(1.0, (ny - c.y) / rim))
		o.draw_line(Vector2(numeral_x - size * 0.8, ny - size * 0.14), c + Vector2(cos(a), sin(a)) * (rim - 4.0),
			ghost, Pal.HAIRLINE, true)
		Pal.text(o, Vector2(numeral_x, ny + size * 0.36), str(i + 1), size,
			Pal.INK if i == picked else Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_RIGHT)
	# The gate callouts sit under the pack and read rightward; leaders climb to the cuts.
	var label_left := c.x - outer + 2.0
	_draw_callout(o, c, "gate", label_left, c.y + outer + 30.0, _angle_of(front_pos, front.gate),
		ghost if plain else Pal.TEAL_TEXT)
	if not front.false_gates.is_empty():
		_draw_callout(o, c, "false gate", label_left, c.y + outer + 30.0 + size * 1.9,
			_angle_of(front_pos, front.false_gates[0]), ghost if plain else Pal.VIOLET_TEXT)
	# What this drawing is, said once, up top where nothing else lives.
	Pal.text(o, Vector2(c.x, bar.position.y - 14.0), "the pack, side on", size, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_CENTER)


## A gate, cut into a wheel's visible edge: the mouth open through the rim stroke, two walls
## and a floor in the gate's colour. Deep and teal for the true gate, shallow and violet for a lie.
func _draw_cut(o: CanvasItem, c: Vector2, a: float, rim: float, depth: float, deep: bool, plain: bool) -> void:
	var w := 0.17 if deep else 0.11
	var edge := Color(Pal.INK, 0.75) if plain else (Pal.TEAL_TEXT if deep else Color(Pal.VIOLET, 0.85))
	var mouth := PackedVector2Array()
	_arc_points(mouth, c, rim + 3.0, a - w, a + w, 8)
	_arc_points(mouth, c, rim - depth, a + w, a - w, 8)
	o.draw_colored_polygon(mouth, Pal.PAPER_SHADE)
	var walls := PackedVector2Array()
	walls.append(c + Vector2(cos(a - w), sin(a - w)) * (rim + 3.0))
	_arc_points(walls, c, rim - depth, a - w, a + w, 8)
	walls.append(c + Vector2(cos(a + w), sin(a + w)) * (rim + 3.0))
	o.draw_polyline(walls, edge, Pal.STROKE, true)


func _draw_callout(o: CanvasItem, c: Vector2, name_: String, x: float, y: float, a: float, ink: Color) -> void:
	var size := Pal.T_DIM
	# A leader is the faintest line in the drawing: it points, it does not compete with the cuts.
	o.draw_line(Vector2(x + 8.0, y - size * 0.5), c + Vector2(cos(a), sin(a)) * (PACK_R - 12.0),
		Color(ink, ink.a * 0.45), Pal.HAIRLINE, true)
	Pal.text(o, Vector2(x, y + size * 0.36), name_, size, ink)


## Append the points of an arc about `c`, from angle `a0` to `a1` (either direction).
static func _arc_points(into: PackedVector2Array, c: Vector2, r: float, a0: float, a1: float, steps: int) -> void:
	for k in steps + 1:
		var a := lerpf(a0, a1, float(k) / float(steps))
		into.append(c + Vector2(cos(a), sin(a)) * r)


## A filled rounded rectangle with an optional outline.
static func _round_rect(o: CanvasItem, rect: Rect2, radius: float, fill: Color, outline: Color, width: float) -> void:
	var r := minf(radius, minf(rect.size.x, rect.size.y) / 2.0)
	var pts := PackedVector2Array()
	_arc_points(pts, Vector2(rect.end.x - r, rect.position.y + r), r, -PI / 2.0, 0.0, 6)
	_arc_points(pts, Vector2(rect.end.x - r, rect.end.y - r), r, 0.0, PI / 2.0, 6)
	_arc_points(pts, Vector2(rect.position.x + r, rect.end.y - r), r, PI / 2.0, PI, 6)
	_arc_points(pts, Vector2(rect.position.x + r, rect.position.y + r), r, PI, PI * 1.5, 6)
	o.draw_colored_polygon(pts, fill)
	if width > 0.0:
		pts.append(pts[0])
		o.draw_polyline(pts, outline, width, true)
