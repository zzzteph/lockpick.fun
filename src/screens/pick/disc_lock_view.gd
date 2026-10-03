class_name DiscLockView
extends Node2D
## A disc-detainer lock on the pick screen: the hands, and the side view.
##
## It owns the attempt (a DiscSession), turns keys, mouse, controller and touch into what the
## hands want, and draws the pack from the bodies' own positions (`DiscArt.side`). The side view
## shows every disc, where its gates have got to, and the bar along the top; what it cannot show
## — the disc turning, the bar dropping into its gate — the front view does (`DiscFront`).
##
## The hands are the pin lock's, because the job is the same one: a wrench held with one, a pick
## moved along the keyway with the other. Only the pick's own verb differs. A pin is lifted and
## falls back; a disc is turned and stays, so it has a way back as well as a way on.
##
## That second way is why the mouse differs here. On a pin lock its buttons are the wrench; on a
## disc lock they are the pick's two ways — the left button turns the disc to the left (on,
## anticlockwise, as it is drawn), the right turns it back to the right — and the wrench is Q.

signal sim_event(type: StringName, data: Dictionary)
## The player asked to restart (R) or to pause (Esc).
signal restart_requested
signal pause_requested

# ── Where it sits on the stage ──────────────────────────────────────────────────────────
## Stage px per mm.
const SIDE_PX := 25.0
## The lock's axis on the stage.
const AXIS_Y := 572.0
## The narrowest the left gutter may get.
const MIN_LEFT := 344.0
## The band of the stage the mouse works the lock over: between the header and the footer.
const WORK_TOP := 160.0
const WORK_BOTTOM := 160.0

# ── Input ───────────────────────────────────────────────────────────────────────────────
## How far the mouse must move after an arrow key before it takes the pick back.
const RETAKE_PX := 8.0
## Where the tip stops counting as "in disc 1" on the way out, in discs.
const OUT_AT := -0.6
## One click of the mouse wheel turns the disc in hand this far, mm of rim: a quarter of a cut.
const WHEEL_STEP := DiscRig.UNIT / 4.0

var session: DiscSession
var def: Dictionary
## Training narrates in colour; Normal draws the same bodies plain.
var colored := true
## Accessibility: the wrench latches on Q instead of being held.
var tension_toggle := false
## A script is driving the session's inputs (the scripted hand, a test).
var scripted := false
var paused := false:
	set(value):
		paused = value
		if value:
			# Nothing let go will be heard while the lock is stopped: fingers, keys or buttons.
			_let_go_touch()
			_forward = false
			_back = false
			_mouse_on = false
			_mouse_back = false
		if session != null:
			session.process_mode = Node.PROCESS_MODE_DISABLED if value else Node.PROCESS_MODE_INHERIT

var opened: bool:
	get:
		return session != null and session.rig.opened
var time: float:
	get:
		return session.time if session != null else 0.0
var stats: Dictionary:
	get:
		return session.stats if session != null else {}

## The disc the front view shows: the one the tip is in, kept while the pick is out.
var front_chamber := 0
## The fingers on the glass, while the touch scheme is on (`PickTouch.active`). Its `lift` is the
## turn being asked of the disc in hand, mm of rim.
var touch := PickTouch.new()
var _touch_was := false

var _key_chamber := 0
var _forward := false
var _back := false
## Where the mouse wheel has asked the disc in hand to go, mm of rim; NAN for nowhere.
var _wheel_to := NAN
var _tension_key := false
var _toggled := false
var _counter_key := false
var _mouse_drives := false
var _mouse_at := -1.0
## The mouse buttons, while held over the lock: left turns the disc on, right turns it back.
var _mouse_on := false
var _mouse_back := false
var _pad_tension := false
var _pad_counter := false
var _pad_stick := 0
var _snap_pointer_x := 0.0
static var _slot := 0


func start(lock_def: Dictionary, lock_seed: int, assist: StringName) -> void:
	def = lock_def
	colored = assist == &"training"
	if session != null:
		session.queue_free()
	session = DiscSession.new()
	session.name = "Session"
	# Each attempt gets its own patch of the physics space, well away from the pin locks' patches,
	# and it does not move when the drawing leans and shivers.
	_slot += 1
	session.position = Vector2(60000.0, 40000.0 + 4000.0 * (_slot % 64))
	session.top_level = true
	add_child(session)
	session.sim_event.connect(func(type: StringName, data: Dictionary) -> void: sim_event.emit(type, data))
	session.start(lock_def, lock_seed)
	_key_chamber = 0
	_mouse_drives = false
	_forward = false
	_back = false
	_wheel_to = NAN
	front_chamber = 0
	# A fresh lock starts with the wrench off and the tip in disc 1, whichever hands are on it.
	touch = PickTouch.new()
	touch.chamber = 0
	_touch_was = PickTouch.active
	paused = paused


# ── Geometry of the drawing ─────────────────────────────────────────────────────────────

func side_x0() -> float:
	return maxf(MIN_LEFT, (Pal.STAGE.x - session.rig.depth * SIDE_PX) / 2.0)


## A stage x as a position along the keyway, in discs from the first.
func at_for_x(px: float) -> float:
	return ((px - side_x0()) / SIDE_PX - DiscRig.FIRST_Z) / DiscRig.PITCH_Z


## The drawn assembly on the stage.
func bounds() -> Rect2:
	var half := DiscArt.BODY_R * SIDE_PX
	return Rect2(side_x0() - DiscArt.FACE_T * SIDE_PX, AXIS_Y - half,
		(session.rig.depth + DiscArt.FACE_T + DiscArt.BACK_T) * SIDE_PX, half * 2.0)


func _limit() -> int:
	return session.rig.count - 1


# ── The hands ───────────────────────────────────────────────────────────────────────────

func _unhandled_input(event: InputEvent) -> void:
	if session == null or paused:
		return
	if event is InputEventKey:
		_key(event as InputEventKey)
	elif event is InputEventJoypadButton:
		_pad_button(event as InputEventJoypadButton)
	elif event is InputEventJoypadMotion:
		_pad_axis(event as InputEventJoypadMotion)
	elif event is InputEventScreenTouch:
		var st := event as InputEventScreenTouch
		if st.pressed:
			if _touch_down(st.index, _stage(st)):
				get_viewport().set_input_as_handled()
		else:
			_touch_up(st.index, _stage(st), st.canceled)
	elif event is InputEventScreenDrag:
		_touch_move((event as InputEventScreenDrag).index, _stage(event))
	elif event.device == InputEvent.DEVICE_ID_EMULATION:
		# A finger arrives as a touch and as an emulated mouse; the touch has been heard.
		return
	elif event is InputEventMouseMotion:
		if not PickTouch.active:
			_mouse_move((event as InputEventMouseMotion).button_mask)
	elif event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP or mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			if mb.pressed and _over_lock():
				_wheel(1.0 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else -1.0)
				get_viewport().set_input_as_handled()
			return
		# A press counts only over the lock; a release counts wherever the pointer has got to.
		if mb.button_index == MOUSE_BUTTON_LEFT:
			_mouse_on = mb.pressed and _over_lock()
			_wheel_to = NAN
		elif mb.button_index == MOUSE_BUTTON_RIGHT:
			_mouse_back = mb.pressed and _over_lock()
			_wheel_to = NAN


func _over_lock() -> bool:
	var m := get_local_mouse_position()
	return m.y >= WORK_TOP and m.y <= Pal.STAGE.y - WORK_BOTTOM and m.x >= 0.0 and m.x <= Pal.STAGE.x


# ── Fingers ─────────────────────────────────────────────────────────────────────────────

## Where a touch is on the stage. Read against the screen, not this node: the drawing leans and
## shivers, and the pads under the thumbs do not.
func _stage(event: InputEvent) -> Vector2:
	var parent := get_parent() as CanvasItem
	var local: InputEvent = parent.make_input_local(event) if parent != null else event
	return local.get("position")


## The disc a finger at stage x is over, or -1 off the pack.
func _disc_at(stage_x: float) -> int:
	var at := at_for_x(stage_x - position.x)
	if at < OUT_AT or at > _limit() + 0.6:
		return -1
	return clampi(roundi(at), 0, _limit())


## A finger went down. Returns true when it landed on something of the lock's.
func _touch_down(id: int, p: Vector2) -> bool:
	if scripted or session.rig.opened:
		return false
	if PickTouch.PAUSE_PAD.has_point(p):
		# The screen's own pad, whatever lock is on it.
		return false
	if PickTouch.COUNTER_PAD.has_point(p):
		touch.hold_counter(id)
		return true
	if PickTouch.WITHDRAW_PAD.has_point(p):
		touch.withdraw()
		return true
	if PickTouch.WRENCH_SLIDER.has_point(p):
		var before := touch.step
		touch.grab_wrench(id, p.y)
		if touch.step != before:
			_wrench_stepped()
		return true
	# A disc. A touch chooses it and takes hold of it where it is — nothing turns until the finger
	# moves. Off the pack, the drag turns whichever disc is already chosen.
	var in_band := p.y >= WORK_TOP and p.y <= Pal.STAGE.y - WORK_BOTTOM
	var on := _disc_at(p.x) if in_band else -1
	if on < 0 and touch.chamber < 0:
		return false
	if on >= 0:
		touch.chamber = on
	touch.lift_pointer = id
	touch.lift_origin_y = p.y
	touch.lift = session.rig.turned(touch.chamber)
	touch.lift_origin_mm = touch.lift
	if touch.wrench_pointer != PickTouch.NO_POINTER:
		touch.used_both_thumbs = true
	return true


func _touch_move(id: int, p: Vector2) -> void:
	if id == touch.wrench_pointer:
		if touch.drag_wrench(p.y):
			_wrench_stepped()
	elif id == touch.lift_pointer:
		# Up turns the disc on, down turns it back, geared down like a pin's lift: the whole of a
		# disc's quarter turn is a long, deliberate drag.
		touch.lift = touch.lift_for_drag(p.y, DiscRig.TRAVEL)


func _touch_up(id: int, p: Vector2, canceled: bool) -> void:
	if id == touch.wrench_pointer:
		if touch.release_wrench(p.y, canceled):
			_wrench_stepped()
	elif id == touch.counter_pointer:
		touch.counter_pointer = PickTouch.NO_POINTER
	elif id == touch.lift_pointer:
		# The pick comes off the disc, and the disc stays where it is.
		touch.lift_pointer = PickTouch.NO_POINTER


## Every finger is off the glass as far as the lock is concerned; the wrench stays where it was
## left, as a slider does.
func _let_go_touch() -> void:
	touch.lift_pointer = PickTouch.NO_POINTER
	touch.wrench_pointer = PickTouch.NO_POINTER
	touch.counter_pointer = PickTouch.NO_POINTER


func _wrench_stepped() -> void:
	if touch.step > 0:
		# The dial remembers the last pressure a hand chose, whichever hand it was.
		PinLockView.tension_level = PickTouch.tension_for(touch.step)
	sim_event.emit(&"WRENCH_STEP", {"step": touch.step})


func _mouse_move(buttons: int) -> void:
	# A button let go where no release was heard — off the window, under a pause — is let go here.
	_mouse_on = _mouse_on and (buttons & MOUSE_BUTTON_MASK_LEFT) != 0
	_mouse_back = _mouse_back and (buttons & MOUSE_BUTTON_MASK_RIGHT) != 0
	if not _over_lock():
		return
	var x := get_local_mouse_position().x
	if not _mouse_drives and absf(x - _snap_pointer_x) < RETAKE_PX:
		return
	_mouse_drives = true
	# The pointer may wander anywhere; the pick is in the keyway or just out of its mouth.
	_mouse_at = clampf(at_for_x(x), OUT_AT - 0.5, _limit() + 0.2)


## The mouse wheel turns the disc in hand a quarter of a cut at a click.
func _wheel(dir: float) -> void:
	if session.pick_chamber < 0:
		return
	var from := _wheel_to if not is_nan(_wheel_to) else session.rig.turned(session.pick_chamber)
	_wheel_to = clampf(from + dir * WHEEL_STEP, 0.0, DiscRig.TRAVEL)


func _key(e: InputEventKey) -> void:
	var down := e.pressed
	match e.physical_keycode:
		KEY_Q:
			if down and not e.echo:
				_toggled = not _toggled
			_tension_key = down
		KEY_C:
			_counter_key = down
		KEY_SPACE, KEY_UP:
			_forward = down
			_wheel_to = NAN
		KEY_DOWN:
			_back = down
			_wheel_to = NAN
		KEY_LEFT:
			if down:
				_step_chamber(-1)
		KEY_RIGHT:
			if down:
				_step_chamber(1)
		KEY_E:
			if down:
				step_tension(1)
		KEY_W:
			if down:
				step_tension(-1)
		KEY_R:
			if down and not e.echo:
				restart_requested.emit()
		KEY_ESCAPE:
			if down and not e.echo:
				pause_requested.emit()
		_:
			if down and e.physical_keycode >= KEY_0 and e.physical_keycode <= KEY_9:
				# `0` is the tenth step, where it sits on the keyboard.
				var n := int(e.physical_keycode - KEY_0)
				PinLockView.tension_level = PinSession.tension_for_step(10 if n == 0 else n)
				sim_event.emit(&"WRENCH_STEP", {"step": wrench_step()})
			else:
				return
	get_viewport().set_input_as_handled()


## A controller, laid out as it is on a pin lock: the right trigger is the wrench hand, the left
## trigger eases it back, A turns the disc on and B turns it back, the bumpers walk the dial.
func _pad_button(e: InputEventJoypadButton) -> void:
	var down := e.pressed
	match e.button_index:
		JOY_BUTTON_A, JOY_BUTTON_DPAD_UP:
			_forward = down
			_wheel_to = NAN
		JOY_BUTTON_B, JOY_BUTTON_DPAD_DOWN:
			_back = down
			_wheel_to = NAN
		JOY_BUTTON_X:
			_counter_key = down
		JOY_BUTTON_DPAD_LEFT:
			if down:
				_step_chamber(-1)
		JOY_BUTTON_DPAD_RIGHT:
			if down:
				_step_chamber(1)
		JOY_BUTTON_RIGHT_SHOULDER:
			if down:
				step_tension(1)
		JOY_BUTTON_LEFT_SHOULDER:
			if down:
				step_tension(-1)
		JOY_BUTTON_BACK:
			if down:
				restart_requested.emit()
		JOY_BUTTON_START:
			if down:
				pause_requested.emit()
		_:
			return
	get_viewport().set_input_as_handled()


func _pad_axis(e: InputEventJoypadMotion) -> void:
	match e.axis:
		JOY_AXIS_TRIGGER_RIGHT:
			var held := e.axis_value > 0.35
			if held and not _pad_tension:
				_toggled = not _toggled
			_pad_tension = held
		JOY_AXIS_TRIGGER_LEFT:
			_pad_counter = e.axis_value > 0.35
		JOY_AXIS_LEFT_X:
			# A flick of the stick is one disc; it must come back to the middle to step again.
			var dir := 0 if absf(e.axis_value) < 0.6 else (1 if e.axis_value > 0.0 else -1)
			if dir != _pad_stick and dir != 0:
				_step_chamber(dir)
			if dir != 0 or absf(e.axis_value) < 0.3:
				_pad_stick = dir


func step_tension(dir: int) -> void:
	PinLockView.tension_level = PinSession.tension_for_step(PinSession.step_for_tension(PinLockView.tension_level) + dir)
	sim_event.emit(&"WRENCH_STEP", {"step": wrench_step()})


func wrench_step() -> int:
	if PickTouch.active and not scripted:
		return touch.step
	return PinSession.step_for_tension(PinLockView.tension_level)


## Move the tip one disc. Clamped, not wrapping: a keyway has two ends.
func _step_chamber(delta: int) -> void:
	if _mouse_drives:
		_key_chamber = clampi(roundi(_mouse_at), 0, _limit())
		_mouse_drives = false
		_snap_pointer_x = get_local_mouse_position().x
	_wheel_to = NAN
	if _key_chamber < 0:
		_key_chamber = 0
		return
	_key_chamber = clampi(_key_chamber + delta, 0, _limit())


## Take the pick out of the lock.
func withdraw() -> void:
	_key_chamber = -1
	_mouse_drives = false
	_mouse_at = -1.0
	_wheel_to = NAN
	touch.withdraw()


func _process(_delta: float) -> void:
	if session == null:
		return
	if not paused:
		if PickTouch.active != _touch_was:
			# The hands changed: the pick stays in the disc it was in.
			_touch_was = PickTouch.active
			if _touch_was:
				# Unless that first touch was itself on a disc, and has already chosen.
				if touch.lift_pointer == PickTouch.NO_POINTER:
					touch.chamber = session.in_chamber
				_mouse_drives = false
				_mouse_on = false
				_mouse_back = false
				_forward = false
				_back = false
			else:
				_key_chamber = touch.chamber
				_let_go_touch()
		if not scripted and PickTouch.active:
			session.in_chamber = touch.chamber
			session.in_pick_at = NAN
			session.in_turn = 0.0
			session.in_target = touch.lift if touch.lift_pointer != PickTouch.NO_POINTER else NAN
			session.in_tension_held = touch.step > 0
			session.in_tension_level = PickTouch.tension_for(touch.step)
			session.in_counter = touch.counter_pointer != PickTouch.NO_POINTER
		elif not scripted:
			var chamber := _key_chamber
			if _mouse_drives:
				chamber = clampi(roundi(_mouse_at), 0, _limit()) if _mouse_at >= OUT_AT else -1
			if chamber != session.in_chamber:
				_wheel_to = NAN
			session.in_chamber = chamber
			session.in_pick_at = _mouse_at if _mouse_drives else NAN
			session.in_turn = (1.0 if _forward or _mouse_on else 0.0) - (1.0 if _back or _mouse_back else 0.0)
			# A wheel click is done with once the disc has got there.
			if not is_nan(_wheel_to) and absf(session.want - _wheel_to) < 0.01:
				_wheel_to = NAN
			session.in_target = _wheel_to
			session.in_tension_held = _toggled if tension_toggle else (_tension_key or _pad_tension)
			session.in_tension_level = PinLockView.tension_level
			session.in_counter = _counter_key or _pad_counter
		if session.pick_chamber >= 0:
			front_chamber = session.pick_chamber
	queue_redraw()


## The wrench is being held right now.
func tension_held() -> bool:
	return session != null and session.tension > 0.0


## The live lock as `DiscArt` draws it; `extra` is the front view's drawn open turn, rad.
func pose(extra: float = 0.0) -> Dictionary:
	return DiscArt.from_rig(session.rig, colored, session.pick_chamber, session.tip_z, extra)


# ── Drawing ─────────────────────────────────────────────────────────────────────────────

func _draw() -> void:
	if session == null:
		return
	var rig := session.rig
	var o := Vector2(side_x0(), AXIS_Y)
	DiscArt.side(self, o, SIDE_PX, pose())
	var right := o.x + (DiscArt.disc_z(rig.count - 1.0) + DiscRig.DISC_T / 2.0 + 0.9) * SIDE_PX
	Pal.text(self, Vector2(right + 12.0, o.y - (DiscArt.BODY_R + 0.5) * SIDE_PX), "SIDEBAR", Pal.T_DIM, Pal.INK_LIGHT,
		HORIZONTAL_ALIGNMENT_RIGHT, false, 1.4)
	Pal.text(self, Vector2(o.x + (rig.depth - 1.6) * SIDE_PX, o.y + DiscArt.KEYWAY_HALF * SIDE_PX - 8.0), "KEYWAY",
		Pal.T_DIM, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_RIGHT, false, 1.4)
