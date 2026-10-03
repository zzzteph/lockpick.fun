extends SceneTree
## Headless: the disc detainers through the real app, by real input events and nothing else —
## keys, then fingers, then the mouse. The scripted hand in `walk_discs` drives the session
## directly; this proves each pair of hands a player has reaches it, and that the two lessons
## can be finished the way they ask to be.
##
##   godot --headless --path src --fixed-fps 60 -s res://tests/discs_play.gd
##
## Held to, along the way:
##   - a disc turned and let go stays exactly where it was left, and turns back as well as on;
##   - the wrench let go lifts the bar and moves no disc, and put back drops it in again;
##   - a touch that does not move turns nothing;
##   - a turn held on after the click carries a disc past its gate, and a heavy wrench stops that;
##   - on the mouse the left button turns a disc on and the right turns it back;
##   - both lessons run every one of their steps and are banked as done.

const WRENCH := 0
const DISC := 1
const OTHER := 2

var _app: Node
var _failures := 0
var _checks := 0
var _held := {}
## Finger index → where it is on the stage.
var _down := {}
var _mouse := Vector2(-1.0, -1.0)
var _mouse_left := false
var _mouse_right := false
## The disc being got out of a false gate, or -1: it is worked until that notch has gone out
## from under the bar, whatever the bar is doing meanwhile.
var _caught := -1


func _initialize() -> void:
	var scene: PackedScene = load("res://main.tscn")
	_app = scene.instantiate()
	_app.progress = Progress.new(SaveStore.memory())
	root.add_child(_app)
	_run.call_deferred()


func _check(ok: bool, what: String, detail: String = "") -> void:
	_checks += 1
	if not ok:
		_failures += 1
	print("%s %s%s" % ["ok   " if ok else "FAIL ", what, (" — " + detail) if detail != "" else ""])


func _wait(seconds: float) -> void:
	for i in maxi(1, roundi(seconds * Engine.physics_ticks_per_second)):
		await physics_frame


# ── Keys ────────────────────────────────────────────────────────────────────────────────

func _key(code: Key, down: bool) -> void:
	if _held.get(code, false) == down:
		return
	_held[code] = down
	var e := InputEventKey.new()
	e.physical_keycode = code
	e.keycode = code
	e.pressed = down
	Input.parse_input_event(e)


func _tap(code: Key) -> void:
	_held[code] = false
	_key(code, true)
	_key(code, false)


func _keys_up() -> void:
	for code: Key in _held.keys():
		_key(code, false)


## The disc to work: one a false gate has hold of — until it is out of it — else the one the
## bar is resting on. While `_caught` is a disc, the sleeve is being eased for it.
func _target(rig: DiscRig) -> int:
	if _caught >= 0:
		if rig.over_lie(_caught) or rig.states[_caught] == LockRig.FALSE_SET:
			return _caught
		_caught = -1
	for i in rig.count:
		if rig.states[i] == LockRig.FALSE_SET:
			_caught = i
			return i
	return rig.binding


## Walk the pick to disc `to` with the arrows.
func _walk_to(view: DiscLockView, to: int) -> void:
	var guard := 0
	while int(view.get("_key_chamber")) != to and guard < 40:
		_tap(KEY_RIGHT if int(view.get("_key_chamber")) < to else KEY_LEFT)
		await _wait(0.06)
		guard += 1
	await _wait(0.15)


## Open the lock on the bench by keys alone, as the lessons teach: Q held, arrows to the stiff
## disc, Space until the bar drops in, C held to turn a disc on out of a false gate.
func _open_by_keys(limit: float) -> bool:
	var pick: PickScreen = _app.pick
	var view := pick.discs
	var rig := view.session.rig
	var t := 0.0
	_caught = -1
	while t < limit and not pick.is_open():
		_key(KEY_Q, true)
		var target := _target(rig)
		if target < 0:
			_key(KEY_SPACE, false)
			_key(KEY_DOWN, false)
			_key(KEY_C, false)
			await _wait(0.05)
			t += 0.05
			continue
		if int(view.get("_key_chamber")) != target:
			_key(KEY_SPACE, false)
			_key(KEY_DOWN, false)
			await _walk_to(view, target)
			t += 0.3
			continue
		_key(KEY_C, _caught >= 0)
		var to_go := rig.gate_turn(target) - rig.turned(target)
		_key(KEY_SPACE, to_go > 0.02 and rig.states[target] != LockRig.SET)
		_key(KEY_DOWN, to_go < -0.02 and rig.states[target] != LockRig.SET)
		await physics_frame
		t += 1.0 / Engine.physics_ticks_per_second
	_keys_up()
	return pick.is_open()


## Let the payoff play out and see where the app goes.
func _after_payoff(screen: StringName) -> bool:
	for i in 12 * 60:
		if _app.screen_name == screen:
			return true
		if i % 30 == 29:
			_tap(KEY_ENTER)
		await process_frame
	return _app.screen_name == screen


func _lesson_by_keys(id: String, want_lies: int) -> void:
	_app.start_lesson(id)
	await _wait(0.3)
	var pick: PickScreen = _app.pick
	var run: Lessons.Run = pick.lesson_run
	var opened := await _open_by_keys(60.0)
	_check(opened, "%s opens by keys" % id, "t=%.1fs" % pick.elapsed())
	_check(int(pick.stats()["false_sets"]) >= want_lies, "%s met its false gate" % id, "false sets %d" % pick.stats()["false_sets"])
	# The last step is the open itself, and opening the lock is what ends a lesson.
	_check(run.complete and run.step >= run.total() - 1, "%s ran every step" % id, "step %d of %d" % [run.step, run.total()])
	_check(await _after_payoff(&"tutorial"), "%s goes back to the tutorial" % id)
	_check(_app.progress.lesson_done(id), "%s is banked as done" % id)


func _stays_put() -> void:
	_app.start_lesson("lesson-discs")
	await _wait(0.3)
	var view: DiscLockView = _app.pick.discs
	var rig := view.session.rig
	await _walk_to(view, 1)
	_key(KEY_SPACE, true)
	await _wait(0.5)
	_key(KEY_SPACE, false)
	await _wait(0.25)
	var turned := rig.turned(1)
	_check(turned > 1.5, "Space turns the disc the pick is in, with no wrench on it", "%.2f mm" % turned)
	await _wait(0.8)
	_check(absf(rig.turned(1) - turned) < 0.02, "and let go, the disc stays exactly where it was left", "%.3f mm on" % (rig.turned(1) - turned))
	_check(absf(rig.turned(0)) < 0.02 and absf(rig.turned(2)) < 0.02, "and no other disc moved")
	_key(KEY_DOWN, true)
	await _wait(0.25)
	_key(KEY_DOWN, false)
	await _wait(0.25)
	_check(rig.turned(1) < turned - 0.8, "Down turns it back", "%.2f mm" % rig.turned(1))
	_check(absf(view.session.rig.hand_force(1)) < 0.05, "and the hand is not left leaning on it", "%.2f N" % rig.hand_force(1))
	_app.abandon_lock()
	await _wait(0.1)


func _wrench_off_moves_nothing() -> void:
	_app.update_settings({"assist": "normal"})
	_app.start_lock(Roster.by_slug("vantage-disc-padlock"))
	await _wait(0.3)
	var pick: PickScreen = _app.pick
	var view := pick.discs
	var rig := view.session.rig
	# Two discs in, then the wrench comes off.
	var t := 0.0
	while t < 40.0:
		var sets := 0
		for i in rig.count:
			if rig.states[i] == LockRig.SET:
				sets += 1
		if sets >= 2:
			break
		_key(KEY_Q, true)
		var target := _target(rig)
		if target >= 0 and int(view.get("_key_chamber")) != target:
			_key(KEY_SPACE, false)
			await _walk_to(view, target)
			t += 0.3
			continue
		_key(KEY_SPACE, target >= 0)
		await physics_frame
		t += 1.0 / Engine.physics_ticks_per_second
	_key(KEY_SPACE, false)
	await _wait(0.2)
	var before: Array[float] = []
	var were: Array[int] = []
	for i in rig.count:
		before.append(rig.turned(i))
		if rig.states[i] == LockRig.SET:
			were.append(i)
	_check(were.size() == 2, "two discs set before the wrench comes off", str(were))
	_keys_up()
	await _wait(0.8)
	var moved := 0.0
	var still_set := 0
	for i in rig.count:
		moved = maxf(moved, absf(rig.turned(i) - before[i]))
		if rig.states[i] == LockRig.SET:
			still_set += 1
	_check(moved < 0.03, "the wrench let go moves no disc", "most %.3f mm" % moved)
	_check(still_set == 0 and rig.bar_foot() > 0.0, "and the bar has lifted out of them", "foot %.2f mm" % rig.bar_foot())
	_key(KEY_Q, true)
	await _wait(0.8)
	var back := 0
	for i: int in were:
		if rig.states[i] == LockRig.SET:
			back += 1
	_check(back == were.size(), "and put back on, the bar drops into both again", "%d of %d" % [back, were.size()])
	var opened := await _open_by_keys(60.0)
	_check(opened, "the padlock opens by keys on Normal", "t=%.1fs" % pick.elapsed())
	_check(await _after_payoff(&"results"), "and goes to the results page")
	_check(int(_app.progress.record("vantage-disc-padlock")["opens"]) == 1, "with the open on its record")


# ── Fingers ─────────────────────────────────────────────────────────────────────────────

## Stage px → the window px an input event is delivered in.
func _to_window(stage: Vector2) -> Vector2:
	return root.get_final_transform() * stage


func _finger(index: int, stage: Vector2, down: bool) -> void:
	if down == _down.has(index):
		return
	var e := InputEventScreenTouch.new()
	e.index = index
	e.position = _to_window(stage)
	e.pressed = down
	if down:
		_down[index] = stage
	else:
		_down.erase(index)
	Input.parse_input_event(e)


func _drag(index: int, to: Vector2) -> void:
	var from: Vector2 = _down[index]
	if from.distance_to(to) < 0.01:
		return
	var e := InputEventScreenDrag.new()
	e.index = index
	e.position = _to_window(to)
	e.relative = _to_window(to) - _to_window(from)
	_down[index] = to
	Input.parse_input_event(e)


func _disc_at(view: DiscLockView, i: int) -> Vector2:
	# Not dead centre, and on the upper half of the pack: where a thumb lands.
	return Vector2(view.side_x0() + DiscArt.disc_z(i) * DiscLockView.SIDE_PX + 6.0, DiscLockView.AXIS_Y - 110.0)


func _by_fingers() -> void:
	_app.update_settings({"assist": "training"})
	_app.start_lock(Roster.by_slug("vantage-disc-detainer-6"))
	await _wait(0.3)
	var pick: PickScreen = _app.pick
	var view := pick.discs
	var rig := view.session.rig
	# A tap chooses a disc and turns nothing.
	_finger(DISC, _disc_at(view, 2), true)
	await _wait(0.1)
	_finger(DISC, _down[DISC], false)
	await _wait(0.3)
	_check(PickTouch.active, "a touch brings the touch scheme up")
	_check(view.touch.chamber == 2 and view.session.pick_chamber == 2, "a tap puts the pick in that disc", "disc %d" % (view.touch.chamber + 1))
	_check(absf(rig.turned(2)) < 0.02, "and turns nothing", "%.3f mm" % rig.turned(2))
	# The wrench: a drag up the slider.
	var grab := Vector2(PickTouch.WRENCH_SLIDER.get_center().x, 760.0)
	_finger(WRENCH, grab, true)
	await _wait(0.05)
	var rise := 5.0 * PickTouch.WRENCH_DRAG_PX / PickTouch.STEPS
	for k in 18:
		_drag(WRENCH, grab - Vector2(0.0, rise * (k + 1) / 18.0))
		await _wait(1.0 / 60.0)
	_finger(WRENCH, _down[WRENCH], false)
	await _wait(0.4)
	_check(view.touch.step == 5 and view.session.tension > 0.0, "the slider puts the wrench on and leaves it on", "step %d" % view.touch.step)
	# One thumb on the discs, the other for the counter pad.
	var t := 0.0
	var on := -1
	_caught = -1
	while t < 90.0 and not pick.is_open():
		var target := _target(rig)
		# The counter pad is held for exactly as long as a disc is being got out of a false gate.
		_finger(OTHER, PickTouch.COUNTER_PAD.get_center(), _caught >= 0)
		if target < 0:
			if _down.has(DISC):
				_finger(DISC, _down[DISC], false)
			on = -1
		elif target != on or not _down.has(DISC):
			if _down.has(DISC):
				_finger(DISC, _down[DISC], false)
				await _wait(0.1)
				t += 0.1
			_finger(DISC, _disc_at(view, target), true)
			on = target
			await _wait(0.12)
			t += 0.12
		else:
			var to_go := rig.gate_turn(target) - rig.turned(target)
			if absf(to_go) > 0.02 and rig.states[target] != LockRig.SET:
				# Up turns it on, down turns it back — a slow, geared drag.
				_drag(DISC, _down[DISC] - Vector2(0.0, 1.2 * signf(to_go)))
		await physics_frame
		t += 1.0 / Engine.physics_ticks_per_second
		if OS.get_environment("DISCS_TRACE") != "" and fmod(t, 1.0) < 1.0 / Engine.physics_ticks_per_second:
			var turns := PackedStringArray()
			for i in rig.count:
				turns.append("%.2f" % rig.turned(i))
			print("  %.1f target %d states %s turned [%s] asked %.2f foot %.3f ease %d fingers %s" % [t, target, str(rig.states),
				",".join(turns), view.touch.lift, rig.bar_foot(), rig.ease_mode, str(_down.keys())])
	for index: int in _down.keys():
		_finger(index, _down[index], false)
	_check(pick.is_open(), "six discs and five false gates open by fingers alone", "t=%.1fs false=%d" % [pick.elapsed(), pick.stats()["false_sets"]])
	_check(int(pick.stats()["false_sets"]) >= 1, "with the counter pad letting a disc out of a false gate")
	_app.abandon_lock()
	await _wait(0.1)


# ── The mouse ───────────────────────────────────────────────────────────────────────────

func _mask() -> int:
	return (MOUSE_BUTTON_MASK_LEFT if _mouse_left else 0) | (MOUSE_BUTTON_MASK_RIGHT if _mouse_right else 0)


func _move(stage: Vector2) -> void:
	if stage.distance_to(_mouse) < 0.5:
		return
	var e := InputEventMouseMotion.new()
	e.position = _to_window(stage)
	e.global_position = e.position
	e.relative = _to_window(stage) - _to_window(_mouse)
	e.button_mask = _mask()
	_mouse = stage
	Input.parse_input_event(e)


func _button(index: MouseButton, down: bool) -> void:
	if index == MOUSE_BUTTON_LEFT:
		if _mouse_left == down:
			return
		_mouse_left = down
	elif index == MOUSE_BUTTON_RIGHT:
		if _mouse_right == down:
			return
		_mouse_right = down
	var e := InputEventMouseButton.new()
	e.button_index = index
	e.pressed = down
	e.position = _to_window(_mouse)
	e.global_position = e.position
	e.button_mask = _mask()
	Input.parse_input_event(e)


func _by_mouse() -> void:
	_app.start_lock(Roster.by_slug("vantage-disc-detainer-6"))
	await _wait(0.3)
	var pick: PickScreen = _app.pick
	var view := pick.discs
	var rig := view.session.rig
	_move(_disc_at(view, 0) + Vector2(-40.0, 0.0))
	await _wait(0.05)
	_move(_disc_at(view, 3))
	await _wait(0.4)
	_check(view.session.pick_chamber == 3, "the pointer carries the pick to the disc under it", "disc %d" % (view.session.pick_chamber + 1))
	# The buttons are the pick's two ways on a disc lock: left turns it on, right turns it back.
	_button(MOUSE_BUTTON_LEFT, true)
	await _wait(0.5)
	_button(MOUSE_BUTTON_LEFT, false)
	await _wait(0.3)
	var on := rig.turned(3)
	_check(on > 1.5, "the left button, held, turns the disc on", "%.2f mm" % on)
	_check(view.session.tension == 0.0, "and it is not the wrench")
	await _wait(0.5)
	_check(absf(rig.turned(3) - on) < 0.02, "let go, the disc stays where it was left", "%.3f mm on" % (rig.turned(3) - on))
	_button(MOUSE_BUTTON_RIGHT, true)
	await _wait(0.25)
	_button(MOUSE_BUTTON_RIGHT, false)
	await _wait(0.3)
	_check(rig.turned(3) < on - 0.8, "the right button, held, turns it back", "%.2f mm" % rig.turned(3))
	var before := rig.turned(3)
	for k in 4:
		_button(MOUSE_BUTTON_WHEEL_UP, true)
		_button(MOUSE_BUTTON_WHEEL_UP, false)
		await _wait(0.05)
	await _wait(0.6)
	_check(absf(rig.turned(3) - before - DiscRig.UNIT) < 0.08, "four clicks of the wheel turn the disc one cut on", "%.2f mm" % (rig.turned(3) - before))
	_button(MOUSE_BUTTON_WHEEL_DOWN, true)
	_button(MOUSE_BUTTON_WHEEL_DOWN, false)
	await _wait(0.5)
	_check(absf(rig.turned(3) - before - DiscRig.UNIT * 0.75) < 0.08, "and one click back turns it a quarter of a cut back", "%.2f mm" % (rig.turned(3) - before))
	# The whole lock, the pick by mouse and the wrench by Q — with C to ease a disc out of a lie.
	var t := 0.0
	_caught = -1
	while t < 90.0 and not pick.is_open():
		_key(KEY_Q, true)
		var target := _target(rig)
		_key(KEY_C, _caught >= 0)
		if target < 0:
			_button(MOUSE_BUTTON_LEFT, false)
			_button(MOUSE_BUTTON_RIGHT, false)
		else:
			_move(_disc_at(view, target))
			var arrived := view.session.pick_chamber == target
			var to_go := rig.gate_turn(target) - rig.turned(target)
			var set := rig.states[target] == LockRig.SET
			_button(MOUSE_BUTTON_LEFT, arrived and to_go > 0.02 and not set)
			_button(MOUSE_BUTTON_RIGHT, arrived and to_go < -0.02 and not set)
		await physics_frame
		t += 1.0 / Engine.physics_ticks_per_second
	_button(MOUSE_BUTTON_LEFT, false)
	_button(MOUSE_BUTTON_RIGHT, false)
	_keys_up()
	_check(pick.is_open(), "six discs open with the pick on the mouse and the wrench on Q", "t=%.1fs false=%d" % [pick.elapsed(), pick.stats()["false_sets"]])
	await _wait(0.3)
	_app.abandon_lock()
	await _wait(0.1)


# ── Past the gate ───────────────────────────────────────────────────────────────────────

## Hold the turn on disc `i` until it reads `state`, or `limit` seconds have gone.
func _hold_until(rig: DiscRig, key: Key, i: int, state: int, limit: float) -> bool:
	_key(key, true)
	var t := 0.0
	while t < limit and rig.states[i] != state:
		await physics_frame
		t += 1.0 / Engine.physics_ticks_per_second
	return rig.states[i] == state


func _overset() -> void:
	_app.update_settings({"assist": "training"})
	_app.start_lesson("lesson-discs")
	await _wait(0.3)
	var pick: PickScreen = _app.pick
	var view := pick.discs
	var rig := view.session.rig
	_tap(KEY_5)
	_key(KEY_Q, true)
	await _wait(0.6)
	var first := rig.binding
	_check(first >= 0, "the bar comes down on one disc", "disc %d" % (first + 1))
	await _walk_to(view, first)
	# The turn held straight on through the click, as a hand that does not stop.
	_check(await _hold_until(rig, KEY_SPACE, first, LockRig.SET, 6.0), "the bar drops into its gate")
	var set_at := view.session.time
	var gone := await _hold_until(rig, KEY_SPACE, first, LockRig.OVERSET, 4.0)
	_key(KEY_SPACE, false)
	_check(gone, "a turn held on after the click carries the disc past its gate", "%.2fs after the click" % (view.session.time - set_at))
	_check(view.session.time - set_at > 0.5, "but not at once: the hand stops at the click first")
	await _wait(0.05)
	_check(int(pick.stats()["oversets"]) == 1, "and it is counted as an overset", str(pick.stats()["oversets"]))
	_check(rig.binding == first and rig.turned(first) > rig.gate_turn(first), "the disc is stiff again, with its gate behind it")
	_check(await _hold_until(rig, KEY_DOWN, first, LockRig.SET, 4.0), "Down turns it back into its gate")
	_key(KEY_DOWN, false)
	await _wait(1.0)
	_check(rig.states[first] == LockRig.SET, "and let go there, it stays")
	# A heavy wrench holds a disc in its gate against the same hand.
	_tap(KEY_9)
	await _wait(0.5)
	var second := rig.binding
	await _walk_to(view, second)
	_check(await _hold_until(rig, KEY_SPACE, second, LockRig.SET, 8.0), "the next disc sets under a heavy wrench", "disc %d" % (second + 1))
	await _wait(2.5)
	_check(rig.past_gate(second) < 0.0 and rig.states[second] != LockRig.OVERSET,
		"and held on for seconds after, the heavy wrench does not let it past",
		"%s, %.2f mm on from its gate's middle, force %.2f N" % [LockRig.STATE_NAMES[rig.states[second]],
		rig.turned(second) - rig.gate_turn(second), rig.hand_force(second)])
	_key(KEY_SPACE, false)
	await _wait(0.8)
	_check(rig.states[second] == LockRig.SET, "let go, it is in its gate", LockRig.STATE_NAMES[rig.states[second]])
	_keys_up()
	_check(int(pick.stats()["oversets"]) == 1, "with no second overset")
	_app.abandon_lock()
	await _wait(0.1)


func _run() -> void:
	await _wait(0.2)
	_app.progress.complete_lesson("lesson-rotate")
	await _stays_put()
	await _overset()
	await _lesson_by_keys("lesson-discs", 0)
	await _lesson_by_keys("lesson-false-gate", 1)
	await _wrench_off_moves_nothing()
	await _by_fingers()
	# A real mouse button takes the screen back from the fingers.
	_move(Vector2(960.0, 500.0))
	_button(MOUSE_BUTTON_LEFT, true)
	_button(MOUSE_BUTTON_LEFT, false)
	await _wait(0.1)
	_check(not PickTouch.active, "a mouse button puts the touch scheme away again")
	await _by_mouse()
	print("---- discs by hand: %d checks, %d failed" % [_checks, _failures])
	quit(1 if _failures > 0 else 0)
