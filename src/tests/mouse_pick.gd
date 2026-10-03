extends SceneTree
## Headless: the mouse scheme through the real app — pointer over the binding pin, left button
## held for the wrench, Space to lift, right button to ease a spool back. Proves pointer events
## get through the app's own Controls to the lock: a plain lock must open by pointer alone, and
## on the spool trainer the right button must start a counter-rotation.
##
##   godot --headless --path godot --fixed-fps 60 -s res://tests/mouse_pick.gd

var _app: Node
var _queue: PackedStringArray
var _slug := ""
var _for := 0.0
var _failures := 0
var _left := false
var _right := false
var _space := false
var _at := Vector2(-1, -1)
## How far off a pin's centre line the pointer is held, stage px (a pin is 88 wide).
const OFF_CENTRE := 18.0
var _target := -1
var _sweep := -1.0
var _through := 0
var _eased := false
var _ease_tried := false
var _on_for := 0.0


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	_queue = (args[0] if args.size() > 0 else "brasswell-bike-padlock,northgate-5-pin-cabinet").split(",")
	var scene: PackedScene = load("res://main.tscn")
	_app = scene.instantiate()
	_app.progress = Progress.new(SaveStore.memory())
	root.add_child(_app)
	physics_frame.connect(_tick)


## Stage px → the window px an input event is delivered in.
func _to_window(stage: Vector2) -> Vector2:
	return root.get_final_transform() * stage


func _mask() -> int:
	return (MOUSE_BUTTON_MASK_LEFT if _left else 0) | (MOUSE_BUTTON_MASK_RIGHT if _right else 0)


func _move(stage: Vector2) -> void:
	if stage.distance_to(_at) < 0.5:
		return
	var e := InputEventMouseMotion.new()
	e.position = _to_window(stage)
	e.global_position = e.position
	e.relative = _to_window(stage) - _to_window(_at)
	e.button_mask = _mask()
	_at = stage
	Input.parse_input_event(e)


func _button(index: MouseButton, down: bool) -> void:
	if index == MOUSE_BUTTON_LEFT:
		if _left == down:
			return
		_left = down
	else:
		if _right == down:
			return
		_right = down
	var e := InputEventMouseButton.new()
	e.button_index = index
	e.pressed = down
	e.position = _to_window(_at)
	e.global_position = e.position
	e.button_mask = _mask()
	Input.parse_input_event(e)


func _space_key(down: bool) -> void:
	if _space == down:
		return
	_space = down
	var e := InputEventKey.new()
	e.physical_keycode = KEY_SPACE
	e.keycode = KEY_SPACE
	e.pressed = down
	Input.parse_input_event(e)


func _tick() -> void:
	_for += 1.0 / Engine.physics_ticks_per_second
	var pick: PickScreen = _app.pick
	if pick == null or pick.pins == null or _app.screen_name != &"pick" or pick.is_open():
		if pick != null and pick.is_open():
			print("OPEN  %-28s t=%5.1fs by mouse" % [_slug, pick.elapsed()])
		_space_key(false)
		_button(MOUSE_BUTTON_RIGHT, false)
		_button(MOUSE_BUTTON_LEFT, false)
		if _queue.is_empty() and not _ease_tried:
			# Last: the spool trainer, only as far as the first ease.
			_ease_tried = true
			_queue.append("ironhold-spool-trainer")
		if _queue.is_empty():
			print("---- mouse: %d failed" % _failures)
			quit(1 if _failures > 0 else 0)
			return
		_slug = _queue[0]
		_queue.remove_at(0)
		_app.start_lock(Roster.by_slug(_slug))
		_for = 0.0
		_target = -1
		_eased = false
		_app.pick.pins.session.sim_event.connect(func(type: StringName, _data: Dictionary) -> void:
			if type == &"COUNTER_ROTATION" and _right:
				_eased = true)
		return
	if _ease_tried and _slug == "ironhold-spool-trainer" and _eased and _sweep < 0.0:
		print("EASED %-28s the right button turned the plug back" % _slug)
		_button(MOUSE_BUTTON_RIGHT, false)
		_sweep = 0.0
	if _sweep >= 0.0:
		# Last: Space held, the pointer dragged right across the lock to the edge of the screen
		# and back out past the mouth. The pick must stay in the keyway — never through the plug
		# between two bores, never out through the back.
		_sweep += 1.0 / Engine.physics_ticks_per_second
		var session := pick.pins.session
		var back := LockRig.FIRST_X + (session.rig.count - 1) * LockRig.PITCH + PinSession.BACK_REACH
		_space_key(true)
		var across := 1900.0 * _sweep / 2.0 if _sweep < 2.0 else 1900.0 * (4.0 - _sweep) / 2.0
		_move(Vector2(maxf(4.0, across), 620.0))
		if session.tip.x > back + 0.01:
			_through += 1
		if session.lift > PinSession.ROOF_LIFT + 0.01 and session.call("_bore_over", session.tip.x) < 0:
			_through += 1
		if _sweep >= 4.0:
			print("%s the pick stayed in the keyway while dragged across the screen (%d frames out of it)" % [
				"KEPT " if _through == 0 else "FAIL ", _through])
			if _through > 0:
				_failures += 1
			_space_key(false)
			_button(MOUSE_BUTTON_LEFT, false)
			_app.abandon_lock()
			print("---- mouse: %d failed" % _failures)
			quit(1 if _failures > 0 else 0)
		return
	if _for > 90.0:
		_failures += 1
		var view0 := pick.pins
		print("FAIL  %-28s still shut after 90 s (wrench %.2f, pressing %s, counter %s/%s, states %s, tip chamber %d, mouse drives %s at %.2f)" % [
			_slug, view0.session.tension, str(view0.get("_mouse_pressing")), str(view0.get("_counter_held")),
			str(view0.session.counter_on), str(view0.session.rig.states), view0.session.pick_chamber,
			str(view0.get("_mouse_drives")), float(view0.get("_mouse_at"))])
		_app.abandon_lock()
		return
	var view := pick.pins
	var rig := view.session.rig
	# Stay on a pin until it is set — easing a spool back can drop a neighbour, and a hand that
	# chases the neighbour never gets the spool through.
	_on_for += 1.0 / Engine.physics_ticks_per_second
	if _target >= rig.count or _target < 0 or rig.states[_target] == LockRig.SET or _on_for > 6.0:
		_target = rig.binding
		for i in rig.count:
			if rig.states[i] == LockRig.FALSE_SET:
				_target = i
				break
		_on_for = 0.0
	var target := _target
	if target < 0:
		# Nothing pinched yet: get the pointer over the lock and the wrench on.
		_move(Vector2(view.sx(float(rig.chambers[0]["x"])), 620.0))
		_button(MOUSE_BUTTON_LEFT, true)
		_space_key(false)
		return
	# Not dead centre: a hand does not land on the centre line, and the tip must still rest there.
	var want := Vector2(view.sx(float(rig.chambers[target]["x"])) + OFF_CENTRE, 620.0)
	if want.distance_to(_at) > 1.0:
		_space_key(false)
		_move(want)
		return
	_button(MOUSE_BUTTON_LEFT, true)
	_button(MOUSE_BUTTON_RIGHT, rig.states[target] == LockRig.FALSE_SET or view.session.counter_on)
	_space_key(true)
