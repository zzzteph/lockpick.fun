class_name PinLockView
extends Node2D
## A pin-tumbler lock on the pick screen: the hands, and the side view.
##
## It owns the attempt (a PinSession), turns keys, mouse, controller and touch into what the hands
## want, and draws the cutaway from the bodies' own positions — nothing on screen is a picture of
## a number. What a finger means is `PickTouch`'s business; this feeds it and reads it back.
## The side view is a section along the keyway: it shows every pin's height and the pick under
## them. It does not show the plug turning (a section along the axis cannot); the front view does.

signal sim_event(type: StringName, data: Dictionary)
## The player asked to restart (R) or to pause (Esc).
signal restart_requested
signal pause_requested

# ── Where it sits on the stage ──────────────────────────────────────────────────────────
## Stage px per mm, both axes: the pick's angle is real.
const SIDE_PX := 30.0
## The shear line's y on the stage.
const SHEAR_Y := 536.0
## The narrowest the left gutter may get.
const MIN_LEFT := 344.0
const HATCH := 6.0
## The band of the stage the mouse works the lock over: between the header and the footer.
const WORK_TOP := 160.0
const WORK_BOTTOM := 160.0

# ── Input ───────────────────────────────────────────────────────────────────────────────
## mm per tap of the up/down arrows (Training's fine lift).
const KEY_LIFT_NUDGE := 0.12
## How long the strike key is held to draw the needle back for a full (100%) strike, s. Held on,
## it keeps drawing at the same rate to its limit.
const CHARGE_SECONDS := 0.9
## How far down the needle is drawn for a full strike, mm.
const NEEDLE_DRAW := 1.4
## How far the mouse must move after an arrow key before it takes the pick back.
const RETAKE_PX := 8.0
## How near a pin's centre line the pointer must be for the tip to rest under it, in chambers.
const REST_ZONE := 0.2
## Where the tip stops counting as "under pin 1" on the way out.
const OUT_AT := -0.5

## The wrench dial is remembered across locks, like a hand that knows its own weight.
static var tension_level := PinSession.tension_for_step(5)

var session: PinSession
var def: Dictionary
## Training narrates in colour; Normal draws the same bodies plain.
var colored := true
## The snap gun is in hand instead of the hook.
var gun := false
## Arrow-key trim of the lift — Training only.
var fine_lift := false
## Accessibility: the wrench latches on Q instead of being held.
var tension_toggle := false
## A script is driving the session's inputs (the scripted hand, a lesson's demonstration).
var scripted := false
var paused := false:
	set(value):
		paused = value
		if value:
			# The fingers' letting-go will not be heard while the lock is stopped.
			_let_go_touch()
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

## The pin the front view shows: the one under the tip, kept while the pick is out.
var front_chamber := 0
## The snap needle's flick, 0..1 — 1 on a strike, easing back.
var gun_flick := 0.0
## How far the needle is drawn back for the next strike, 0..PinSession.MAX_POWER (1 = a full
## strike): it grows while the strike key is held, and the strike is that hard when it is let go.
var gun_charge := 0.0
## How hard the last strike was, 0..PinSession.MAX_POWER.
var gun_power := 0.0
var _charging := false
## The fingers on the glass, while the touch scheme is on (`PickTouch.active`).
var touch := PickTouch.new()
var _touch_was := false

var _key_chamber := 0
var _space := false
var _trim := 0.0
var _tension_key := false
var _toggled := false
var _counter_key := false
var _mouse_drives := false
var _mouse_at := -1.0
var _mouse_pressing := false
var _counter_held := false
var _pad_tension := false
var _pad_counter := false
var _pad_stick := 0
var _snap_pointer_x := 0.0
var _driver_shapes: Array = []
var _key_shapes: Array = []
static var _slot := 0


func start(lock_def: Dictionary, lock_seed: int, assist: StringName) -> void:
	def = lock_def
	colored = assist == &"training"
	fine_lift = assist == &"training"
	if session != null:
		session.queue_free()
	session = PinSession.new()
	session.name = "Session"
	session.gun = gun
	# The bodies live in the same physics space as every other lock ever started; each attempt
	# gets its own patch of it so a lock being freed can never touch the one being built.
	_slot += 1
	session.position = Vector2(0.0, 40000.0 + 4000.0 * (_slot % 64))
	# The drawing leans and shivers; the lock itself must not. Left as an ordinary child, moving
	# this view would drag the shell (a static body) across pins that live in world space.
	session.top_level = true
	add_child(session)
	session.sim_event.connect(func(type: StringName, data: Dictionary) -> void:
		if type == &"STRIKE":
			# The needle kicks when the gun goes off — which is a moment later than the trigger,
			# if a strike was still in the air.
			gun_power = float(data.get("power", 1.0))
			gun_flick = 1.0
		sim_event.emit(type, data))
	session.start(lock_def, lock_seed)
	_key_chamber = 0
	_mouse_drives = false
	_space = false
	_trim = 0.0
	front_chamber = 0
	# A fresh lock starts with the wrench off and the tip under pin 1, whichever hands are on it.
	touch = PickTouch.new()
	touch.chamber = 0
	_touch_was = PickTouch.active
	_driver_shapes.clear()
	_key_shapes.clear()
	for i in session.rig.count:
		var c: Dictionary = session.rig.chambers[i]
		_driver_shapes.append(_mirror(Profiles.silhouette(c["profile"], LockRig.PIN_R, LockRig.PIN_BEVEL)))
		_key_shapes.append(_mirror(LockRig.key_silhouette(c["key_len"])))
	paused = paused


## A right-hand silhouette ([u, half_width]) as a closed outline in pin-local mm (x across, y up).
static func _mirror(sil: Array[Vector2]) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for p in sil:
		pts.append(Vector2(p.y, p.x))
	for k in range(sil.size() - 1, -1, -1):
		pts.append(Vector2(-sil[k].y, sil[k].x))
	return pts


# ── Geometry of the drawing ─────────────────────────────────────────────────────────────

func side_x0() -> float:
	return maxf(MIN_LEFT, (Pal.STAGE.x - session.rig.depth * SIDE_PX) / 2.0)


func sx(mm: float) -> float:
	return side_x0() + mm * SIDE_PX


func sy(mm: float) -> float:
	return SHEAR_Y - mm * SIDE_PX


## A stage x as a position along the keyway, in chambers from pin 1.
func at_for_x(px: float) -> float:
	return ((px - side_x0()) / SIDE_PX - LockRig.FIRST_X) / LockRig.PITCH


## The drawn assembly on the stage, shell top to plug bottom.
func bounds() -> Rect2:
	var top := sy(LockRig.SEAT_Y + 0.8)
	var bottom := sy(LockRig.KEYWAY_FLOOR_Y - 1.7)
	return Rect2(side_x0(), top, session.rig.depth * SIDE_PX, bottom - top)


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
		if mb.pressed:
			if _over_lock():
				_mouse_pressing = true
			_counter_held = _mouse_pressing and (mb.button_mask & MOUSE_BUTTON_MASK_RIGHT) != 0
		else:
			# Letting go of the right button alone keeps the wrench (the left is still down).
			_mouse_pressing = _mouse_pressing and mb.button_mask != 0
			_counter_held = _mouse_pressing and (mb.button_mask & MOUSE_BUTTON_MASK_RIGHT) != 0


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


## The chamber a finger at stage x is over, or -1 off the lock.
func _chamber_at(stage_x: float) -> int:
	var at := at_for_x(stage_x - position.x)
	if at < OUT_AT or at > _limit() + 0.5:
		return -1
	return clampi(roundi(at), 0, _limit())


## A finger went down. Returns true when it landed on something of the lock's.
func _touch_down(id: int, p: Vector2) -> bool:
	if scripted or session.rig.opened:
		return false
	if PickTouch.PAUSE_PAD.has_point(p):
		# The screen's own pad, whatever lock is on it.
		return false
	if gun and PickTouch.STRIKE_PAD.has_point(p):
		touch.strike_pointer = id
		_trigger(true, false)
		return true
	if not gun and PickTouch.COUNTER_PAD.has_point(p):
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
	# A pin. Choosing it is all a touch does — the tip arrives at rest, exactly as an arrow press
	# does, so tapping along a row of pins can never shove one of them. Off the lock, the drag
	# lifts whichever pin is already chosen, from where the hand does not cover it.
	var in_band := p.y >= WORK_TOP and p.y <= Pal.STAGE.y - WORK_BOTTOM
	return touch.grab_pin(id, _chamber_at(p.x) if in_band else -1, p.y)


func _touch_move(id: int, p: Vector2) -> void:
	if id == touch.wrench_pointer:
		if touch.drag_wrench(p.y):
			_wrench_stepped()
	elif id == touch.lift_pointer:
		# The snap gun has no lift: a drag along the lock only aims the needle.
		touch.drag_pin(_chamber_at(p.x), p.y, 0.0 if gun else PinSession.LIFT_CEILING)


func _touch_up(id: int, p: Vector2, canceled: bool) -> void:
	if id == touch.wrench_pointer:
		if touch.release_wrench(p.y, canceled):
			_wrench_stepped()
	elif id == touch.counter_pointer:
		touch.counter_pointer = PickTouch.NO_POINTER
	elif id == touch.strike_pointer:
		touch.strike_pointer = PickTouch.NO_POINTER
		if canceled:
			_charging = false
			gun_charge = 0.0
		else:
			_trigger(false, false)
	elif id == touch.lift_pointer:
		touch.release_pin()


## Every finger is off the glass as far as the lock is concerned; the wrench stays where it was
## left, as a slider does.
func _let_go_touch() -> void:
	touch.release_pin()
	touch.wrench_pointer = PickTouch.NO_POINTER
	touch.counter_pointer = PickTouch.NO_POINTER
	if touch.strike_pointer != PickTouch.NO_POINTER:
		touch.strike_pointer = PickTouch.NO_POINTER
		_charging = false
		gun_charge = 0.0


func _wrench_stepped() -> void:
	if touch.step > 0:
		# The dial remembers the last pressure a hand chose, whichever hand it was.
		tension_level = PickTouch.tension_for(touch.step)
	sim_event.emit(&"WRENCH_STEP", {"step": touch.step})


func _mouse_move(buttons: int) -> void:
	# A second button pressed while the first is held arrives here, not as a press.
	_counter_held = _mouse_pressing and (buttons & MOUSE_BUTTON_MASK_RIGHT) != 0
	if not _over_lock():
		return
	var x := get_local_mouse_position().x
	if not _mouse_drives and absf(x - _snap_pointer_x) < RETAKE_PX:
		return
	_mouse_drives = true
	# The pointer may wander anywhere; the pick is in the keyway or just out of its mouth.
	_mouse_at = clampf(_rest(at_for_x(x)), OUT_AT - 0.5, _limit() + 0.2)


## Where the tip goes for a pointer at `at` (in chambers). Near a pin the tip rests under its
## centre — a hook on the slope of a pin's point lifts nothing useful, and the eye cannot judge a
## millimetre — and between pins it makes up the ground. One unbroken curve of the pointer's own
## movement: the pick is never moved by anything but the hand, and never jumps when it pushes.
func _rest(at: float) -> float:
	var nearest := roundf(at)
	if nearest < 0.0 or nearest > _limit():
		return at
	var off := at - nearest
	return nearest + signf(off) * maxf(0.0, absf(off) - REST_ZONE) / (0.5 - REST_ZONE) * 0.5


func _key(e: InputEventKey) -> void:
	var down := e.pressed
	match e.physical_keycode:
		KEY_Q:
			if down and not e.echo:
				_toggled = not _toggled
			_tension_key = down
		KEY_C:
			_counter_key = down
		KEY_SPACE, KEY_G, KEY_SHIFT:
			if gun:
				_trigger(down, e.echo)
			elif e.physical_keycode == KEY_SPACE:
				_space = down
			else:
				return
		KEY_LEFT:
			if down:
				_step_chamber(-1)
		KEY_RIGHT:
			if down:
				_step_chamber(1)
		KEY_UP:
			if down:
				_nudge(KEY_LIFT_NUDGE)
		KEY_DOWN:
			if down:
				_nudge(-KEY_LIFT_NUDGE)
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
				tension_level = PinSession.tension_for_step(10 if n == 0 else n)
				sim_event.emit(&"WRENCH_STEP", {"step": wrench_step()})
			else:
				return
	get_viewport().set_input_as_handled()


## A controller, laid out the way the hands are: the right trigger is the wrench hand, the left
## trigger eases it back, the face button lifts, the bumpers walk the wrench dial.
func _pad_button(e: InputEventJoypadButton) -> void:
	var down := e.pressed
	match e.button_index:
		JOY_BUTTON_A:
			if gun:
				_trigger(down, false)
			else:
				_space = down
		JOY_BUTTON_X:
			if gun:
				_trigger(down, false)
			else:
				_counter_key = down
		JOY_BUTTON_DPAD_LEFT:
			if down:
				_step_chamber(-1)
		JOY_BUTTON_DPAD_RIGHT:
			if down:
				_step_chamber(1)
		JOY_BUTTON_DPAD_UP:
			if down:
				_nudge(KEY_LIFT_NUDGE)
		JOY_BUTTON_DPAD_DOWN:
			if down:
				_nudge(-KEY_LIFT_NUDGE)
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
			# A flick of the stick is one chamber; it must come back to the middle to step again.
			var dir := 0 if absf(e.axis_value) < 0.6 else (1 if e.axis_value > 0.0 else -1)
			if dir != _pad_stick and dir != 0:
				_step_chamber(dir)
			if dir != 0 or absf(e.axis_value) < 0.3:
				_pad_stick = dir


## The snap gun's trigger: down draws the needle back, up lets it go.
func _trigger(down: bool, echo: bool) -> void:
	if down:
		if not echo and not _charging:
			_charging = true
			gun_charge = 0.0
	elif _charging:
		_charging = false
		fire(maxf(PinSession.TAP_POWER, gun_charge))


## Strike, as hard as `power` (0..1).
func fire(power: float = 1.0) -> void:
	if session == null or not gun or paused:
		return
	session.strike(power)
	gun_charge = 0.0


func step_tension(dir: int) -> void:
	tension_level = PinSession.tension_for_step(PinSession.step_for_tension(tension_level) + dir)
	sim_event.emit(&"WRENCH_STEP", {"step": wrench_step()})


func wrench_step() -> int:
	if PickTouch.active and not scripted:
		return touch.step
	return PinSession.step_for_tension(tension_level)


func _limit() -> int:
	return session.rig.count - 1


## Move the tip one chamber. Clamped, not wrapping: a keyway has two ends. Moving drops the pick
## unless the push is being held on purpose — then the hook is carried along at working height.
func _step_chamber(delta: int) -> void:
	if _mouse_drives:
		_key_chamber = clampi(roundi(_mouse_at), 0, _limit())
		_mouse_drives = false
		_snap_pointer_x = get_local_mouse_position().x
	if _key_chamber < 0:
		_key_chamber = 0
		return
	var next := clampi(_key_chamber + delta, 0, _limit())
	if next != _key_chamber:
		# The trim belongs to the chamber being worked; it never survives leaving it.
		_trim = 0.0
	_key_chamber = next


func _nudge(delta: float) -> void:
	if not fine_lift or gun:
		return
	_trim = clampf(_trim + delta, 0.0, PinSession.LIFT_CEILING)


## Take the pick out of the lock.
func withdraw() -> void:
	_key_chamber = -1
	_trim = 0.0
	_mouse_drives = false
	_mouse_at = -1.0
	touch.withdraw()


func _process(delta: float) -> void:
	if session == null:
		return
	if not paused:
		if PickTouch.active != _touch_was:
			# The hands changed: the pick stays under the pin it was under.
			_touch_was = PickTouch.active
			if _touch_was:
				touch.chamber = session.in_chamber
				_mouse_drives = false
				_mouse_pressing = false
				_counter_held = false
			else:
				_key_chamber = touch.chamber
				_let_go_touch()
		if not scripted and PickTouch.active:
			session.in_chamber = touch.chamber
			session.in_pick_at = NAN
			session.in_lift = touch.lift
			session.in_tension_held = touch.step > 0
			session.in_tension_level = PickTouch.tension_for(touch.step)
			session.in_counter = touch.counter_pointer != PickTouch.NO_POINTER
		elif not scripted:
			var chamber := _key_chamber
			if _mouse_drives:
				chamber = clampi(roundi(_mouse_at), 0, _limit()) if _mouse_at >= OUT_AT else -1
			session.in_chamber = chamber
			session.in_pick_at = _mouse_at if _mouse_drives else NAN
			session.in_lift = (PinSession.LIFT_CEILING if _space else 0.0) + _trim
			session.in_tension_held = (_toggled if tension_toggle else (_tension_key or _pad_tension)) or _mouse_pressing
			session.in_tension_level = tension_level
			session.in_counter = _counter_held or _counter_key or _pad_counter
		if session.pick_chamber >= 0:
			front_chamber = session.pick_chamber
		if _charging:
			gun_charge = minf(PinSession.MAX_POWER, gun_charge + delta / CHARGE_SECONDS)
		if gun_flick > 0.0:
			gun_flick = maxf(0.0, gun_flick - delta / 0.12)
	queue_redraw()


## The wrench is being held right now.
func tension_held() -> bool:
	return session != null and session.tension > 0.0


# ── Drawing ─────────────────────────────────────────────────────────────────────────────

func _poly(local: PackedVector2Array, cx: float, cy: float) -> PackedVector2Array:
	var out := PackedVector2Array()
	for p in local:
		out.append(Vector2(sx(cx + p.x), sy(cy + p.y)))
	return out


func _draw() -> void:
	if session == null:
		return
	var rig := session.rig
	var x0 := side_x0()
	var x1 := x0 + rig.depth * SIDE_PX
	var shear_y := sy(0.0)
	var shell_bottom := sy(LockRig.SHEAR_GAP)
	var shell_top := sy(LockRig.SEAT_Y + 0.8)
	var seat_y := sy(LockRig.SEAT_Y)
	var plug_bottom := sy(LockRig.KEYWAY_FLOOR_Y - 1.7)
	var roof_y := sy(LockRig.KEYWAY_CEIL_Y)
	var floor_y := sy(LockRig.KEYWAY_FLOOR_Y)
	var bore_w := 2.0 * (LockRig.PIN_R + LockRig.PLUG_CLEAR) * SIDE_PX
	# The keyway is open at the face and closed 2 mm short of the back.
	var back_x := sx(rig.depth - 2.0)

	# ── Shell: the body above the shear line, its bores punched out ──
	var shell := Rect2(x0, shell_top, x1 - x0, shell_bottom - shell_top)
	draw_rect(shell, Pal.SHELL_BODY)
	Pal.hatch_rect(self, shell, HATCH, 45.0, Pal.RULE)
	# ── Plug: the body below it, its bores and the keyway channel punched out ──
	var plug := Rect2(x0, shear_y, x1 - x0, plug_bottom - shear_y)
	draw_rect(plug, Pal.PLUG_BODY)
	Pal.hatch_rect(self, plug, HATCH, -45.0, Pal.RULE)
	var keyway := Rect2(x0 - 2.0, roof_y, back_x - x0 + 2.0, floor_y - roof_y)
	draw_rect(keyway, Pal.PAPER)
	for i in rig.count:
		var bx := sx(float(rig.chambers[i]["x"])) - bore_w / 2.0
		draw_rect(Rect2(bx, seat_y, bore_w, shell_bottom - seat_y), Pal.PAPER)
		draw_rect(Rect2(bx, shear_y, bore_w, roof_y - shear_y), Pal.PAPER)
	draw_rect(shell, Pal.INK, false, Pal.STROKE)
	draw_rect(plug, Pal.INK, false, Pal.STROKE)
	draw_rect(keyway, Pal.INK, false, Pal.STROKE)
	for i in rig.count:
		var bx := sx(float(rig.chambers[i]["x"])) - bore_w / 2.0
		draw_rect(Rect2(bx, seat_y, bore_w, shell_bottom - seat_y), Pal.INK, false, Pal.STROKE)
		draw_rect(Rect2(bx, shear_y, bore_w, roof_y - shear_y), Pal.INK, false, Pal.STROKE)

	# ── The set window: where to put the key pin's top. Teal to aim at, crimson past it ──
	if colored:
		for i in rig.count:
			var bx := sx(float(rig.chambers[i]["x"])) - bore_w / 2.0
			draw_rect(Rect2(bx, sy(0.6), bore_w, sy(0.0) - sy(0.6)), Color(Pal.TEAL, 0.28))
			draw_rect(Rect2(bx, sy(1.8), bore_w, sy(0.6) - sy(1.8)), Color(Pal.CRIMSON, 0.12))

	# ── Springs: from the seat down to the driver's top ──
	for i in rig.count:
		var cx := sx(float(rig.chambers[i]["x"]))
		var bottom := sy(-rig.drivers[i].position.y / LockRig.S + LockRig.DRIVER_HALF)
		_spring(cx, seat_y, maxf(2.0, bottom - seat_y), LockRig.PIN_R * 0.72 * SIDE_PX)

	# ── Pins: upright silhouettes at the chamber's x, at the bodies' heights ──
	for i in rig.count:
		var x: float = rig.chambers[i]["x"]
		var st := rig.states[i]
		var driver_y := -rig.drivers[i].position.y / LockRig.S
		var key_y := -rig.keys[i].position.y / LockRig.S
		Pal.poly(self, _poly(_driver_shapes[i], x, driver_y), Pal.state_color(st if colored else LockRig.FREE))
		var key_fill := Pal.STEEL.lerp(Pal.PAPER, 0.32)
		if colored and st == LockRig.OVERSET:
			key_fill = Pal.STEEL.lerp(Pal.CRIMSON, 0.55)
		Pal.poly(self, _poly(_key_shapes[i], x, key_y), key_fill)

	# ── Sidebar gates: where a set chamber's key pin must be lifted back up to. A physical cut
	# in the bore, so both rungs draw it — Normal as plain ticks on the bore walls, Training as a
	# violet band that turns teal once the gate is met ──
	for i in rig.count:
		var g: Array = rig.gates[i]
		if g.is_empty():
			continue
		var bx := sx(float(rig.chambers[i]["x"])) - bore_w / 2.0
		var top := sy(float(g[1]))
		var bottom := sy(float(g[0]))
		var met: bool = rig.aligned[i]
		if colored:
			draw_rect(Rect2(bx, top, bore_w, bottom - top), Color(Pal.TEAL if met else Pal.VIOLET, 0.45 if met else 0.4))
		var ink := (Pal.TEAL if met else Pal.VIOLET) if colored else Pal.INK
		for y: float in [top, bottom]:
			draw_line(Vector2(bx - 10.0, y), Vector2(bx, y), ink, Pal.STROKE)
			draw_line(Vector2(bx + bore_w, y), Vector2(bx + bore_w + 10.0, y), ink, Pal.STROKE)

	# ── The shear line: the strongest line on screen, across the assembly ──
	draw_line(Vector2(x0 - 40.0, shear_y), Vector2(x1 + 40.0, shear_y), Pal.INK, Pal.HEAVY)

	# ── Where each pin is caught: crimson where it is holding the plug, teal once it rests on
	# the plug's top. Training and lessons only ──
	if colored:
		for i in rig.count:
			var st := rig.states[i]
			var cx := sx(float(rig.chambers[i]["x"]))
			if st == LockRig.SET:
				_dot(Vector2(cx, sy(rig.driver_foot(i))), 5.5, Pal.TEAL)
			elif st == LockRig.BINDING or st == LockRig.FALSE_SET:
				_dot(Vector2(cx, sy(-LockRig.RIM_HEIGHT / 2.0)), 6.0 + minf(12.0, rig.wrench * 2.0), Pal.CRIMSON)

	if gun:
		_draw_needle(x0, rig)
	else:
		_draw_pick(x0, rig)

	Pal.text(self, Vector2(back_x - 12.0, floor_y - 10.0), "KEYWAY", Pal.T_DIM, Pal.INK_LIGHT,
		HORIZONTAL_ALIGNMENT_RIGHT, false, 1.4)


func _spring(cx: float, top: float, height: float, half_w: float) -> void:
	const COILS := 5
	var pts := PackedVector2Array([Vector2(cx, top)])
	for k in COILS:
		pts.append(Vector2(cx + (half_w if k % 2 == 0 else -half_w), top + height * (k + 0.5) / COILS))
		pts.append(Vector2(cx, top + height * (k + 1.0) / COILS))
	draw_polyline(pts, Pal.INK_LIGHT, 1.0, true)


func _dot(at: Vector2, radius: float, color: Color) -> void:
	draw_circle(at, radius, Color(color, 0.9))
	draw_arc(at, radius, 0.0, TAU, 24, Pal.INK, 1.0, true)


## The pick: the very polygon the pins feel for, held off by whatever will not move.
func _draw_pick(x0: float, rig: LockRig) -> void:
	if session.tip.x < 0.0:
		return
	var tip_local := PinSession.HOOK[PinSession.HOOK_TIP]
	var ox := session.tip.x - tip_local.x
	var oy := session.tip.y - session.pick_give - tip_local.y
	# The blade is 60 mm long; it enters from just outside the mouth, behind the front view.
	var clip_mm := (x0 - 22.0 - side_x0()) / SIDE_PX
	var pts := PackedVector2Array()
	for p in PinSession.HOOK:
		pts.append(Vector2(sx(maxf(ox + p.x, clip_mm)), sy(oy + p.y)))
	Pal.poly(self, pts, Pal.STEEL)
	# Where it is pressing, sized by how hard.
	for i in rig.count:
		var f := rig.hand_force(i)
		if f < 0.02:
			continue
		var c: Dictionary = rig.chambers[i]
		var tip_y: float = -rig.keys[i].position.y / LockRig.S - float(c["key_len"]) / 2.0 - LockRig.KEY_TIP
		draw_circle(Vector2(sx(float(c["x"])), sy(tip_y)), 3.0 + minf(8.0, f * 2.0), Color(Pal.AMBER, 0.75))


## The snap gun's blade: a flat plank lying along the keyway just under the key pins, reaching
## from the mouth to where the player has slid its tip. It kicks down on a strike — the pins jump
## up, the needle goes the other way.
func _draw_needle(x0: float, rig: LockRig) -> void:
	# Drawn back as the key is held; let go, it snaps up to the pins and settles.
	var drawn_back := gun_charge if _charging else gun_power * gun_flick * gun_flick
	var top_mm := session._rest_y + PinSession.PASS_CLEARANCE - 0.25 - drawn_back * NEEDLE_DRAW
	var first_x := LockRig.FIRST_X
	var last_x := LockRig.FIRST_X + LockRig.PITCH * (rig.count - 1)
	var reach := clampf(session.tip.x + PinSession.NEEDLE_REACH, first_x - 2.0, last_x + 3.5)
	var yc := sy(top_mm) + 9.0
	var left := x0 - 22.0
	Pal.box(self, Rect2(left, yc - 9.0, sx(reach) - left, 18.0), Pal.STEEL)
