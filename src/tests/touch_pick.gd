extends SceneTree
## Headless: the touch scheme through the real app, by real touch events and nothing else — the
## wrench slider, a tap to choose a pin, a drag to lift it, the counter pad for a spool, the snap
## gun's strike pad, pick-out and pause. A plain lock and the spool trainer must open by fingers
## alone, and no line a lesson says to a finger may name a key.
##
##   godot --headless --path src --fixed-fps 60 -s res://tests/touch_pick.gd

const WRENCH := 0
const PIN := 1
const OTHER := 2

var _app: Node
var _failures := 0
var _checks := 0
## Finger index → where it is on the stage.
var _down := {}


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


func _lift_fingers() -> void:
	for index: int in _down.keys():
		_finger(index, _down[index], false)


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


func _wait(seconds: float) -> void:
	for i in maxi(1, roundi(seconds * Engine.physics_ticks_per_second)):
		await physics_frame


## Drag a finger that is down to `to`, over `seconds`.
func _slide(index: int, to: Vector2, seconds: float) -> void:
	var from: Vector2 = _down[index]
	var frames := maxi(1, roundi(seconds * 60.0))
	for k in frames:
		_drag(index, from.lerp(to, float(k + 1) / frames))
		await _wait(1.0 / 60.0)


func _tap(index: int, at: Vector2) -> void:
	_finger(index, at, true)
	await _wait(0.08)
	_finger(index, at, false)
	await _wait(0.08)


## Drag the wrench to `step` from wherever it is — a relative drag, grabbed above the off band.
func _wrench_to(step: int) -> void:
	var view: PinLockView = _app.pick.pins
	var from := Vector2(PickTouch.WRENCH_SLIDER.get_center().x, 760.0)
	_finger(WRENCH, from, true)
	await _wait(0.05)
	var rise := float(step - view.touch.step) * PickTouch.WRENCH_DRAG_PX / PickTouch.STEPS
	await _slide(WRENCH, from - Vector2(0.0, rise), 0.3)
	_finger(WRENCH, _down[WRENCH], false)
	await _wait(0.05)


func _pin_at(view: PinLockView, chamber: int) -> Vector2:
	# Not dead centre: a thumb does not land on the centre line.
	return Vector2(view.sx(float(view.session.rig.chambers[chamber]["x"])) + 14.0, 620.0)


## Work the lock with one thumb on the pins and another for the counter pad, until it opens or
## `limit` seconds have gone. The wrench is already on.
func _work(limit: float) -> bool:
	var pick: PickScreen = _app.pick
	var view := pick.pins
	var session := view.session
	var rig := session.rig
	var dt := 1.0 / Engine.physics_ticks_per_second
	var t := 0.0
	var on := -1
	while t < limit and not pick.is_open():
		# The pin to work: one the plug has trapped (a false set), else the one it is pinching.
		var target := rig.binding
		for i in rig.count:
			if rig.states[i] == LockRig.FALSE_SET:
				target = i
				break
		if target < 0:
			_finger(PIN, _down.get(PIN, Vector2.ZERO), false)
			_finger(OTHER, _down.get(OTHER, Vector2.ZERO), false)
			on = -1
		elif target != on or not _down.has(PIN):
			# Let go, then tap the next one: down, across, up.
			_finger(OTHER, _down.get(OTHER, Vector2.ZERO), false)
			if _down.has(PIN):
				_finger(PIN, _down[PIN], false)
				await _wait(0.12)
				t += 0.12
			_finger(PIN, _pin_at(view, target), true)
			on = target
			await _wait(0.1)
			t += 0.1
		else:
			var at: Vector2 = _down[PIN]
			if at.y > 620.0 - PickTouch.LIFT_DRAG_PX:
				_drag(PIN, at - Vector2(0.0, 1.5))
			# Ease the plug back while the pin is lying about being set.
			var easing := rig.states[target] == LockRig.FALSE_SET or session.counter_on
			_finger(OTHER, PickTouch.COUNTER_PAD.get_center(), easing)
		await physics_frame
		t += dt
	_lift_fingers()
	return pick.is_open()


# ── The stages ──────────────────────────────────────────────────────────────────────────

func _run() -> void:
	await _wait(0.2)
	_app.update_settings({"assist": "training"})
	await _plain()
	await _spool()
	await _controls()
	await _gun()
	await _screens()
	_lessons()
	print("---- touch: %d checks, %d failed" % [_checks, _failures])
	quit(1 if _failures > 0 else 0)


## A plain lock, by fingers alone.
func _plain() -> void:
	_app.start_lock(Roster.by_slug("northgate-5-pin-cabinet"))
	await _wait(0.2)
	var pick: PickScreen = _app.pick
	var view := pick.pins
	var session := view.session
	_check(not PickTouch.active, "the controls are not up before a finger lands")
	await _wrench_to(5)
	_check(PickTouch.active and pick.pads.visible, "a touch brings the controls up")
	_check(view.touch.step == 5, "a drag up the slider walks the wrench to 5", "step %d" % view.touch.step)
	await _wait(0.5)
	_check(session.tension > 0.0 and view.touch.wrench_pointer == PickTouch.NO_POINTER,
		"the wrench stays on with no finger on it", "tension %.2f" % session.tension)
	_check(view.wrench_step() == 5 and pick.hud.pressure_step == 5, "the footer reads the slider's step")
	# A tap chooses a pin and never lifts it.
	_finger(PIN, _pin_at(view, 3), true)
	await _wait(0.4)
	_finger(PIN, _down[PIN], false)
	await _wait(0.3)
	_check(view.touch.chamber == 3 and session.pick_chamber == 3 and session.lift < 0.05 and session.pick_force < 0.05,
		"a tap puts the tip under the pin and lifts nothing", "chamber %d lift %.2f" % [session.pick_chamber, session.lift])
	_check(not view.get("_mouse_drives") and not view.get("_mouse_pressing"),
		"the finger's emulated mouse is not also working the lock")
	var opened := await _work(90.0)
	_check(opened, "northgate-5-pin-cabinet opens by fingers alone", "t=%.1fs states %s" % [pick.elapsed(), str(session.rig.states)])
	await _wait(0.3)
	_check(not pick.pads.visible, "the controls leave with the lock open")
	_app.abandon_lock()
	await _wait(0.2)


## The spool trainer: the counter pad has to ease the plug back.
func _spool() -> void:
	_app.start_lock(Roster.by_slug("ironhold-spool-trainer"))
	await _wait(0.2)
	var pick: PickScreen = _app.pick
	var view := pick.pins
	var eased := [false]
	view.session.sim_event.connect(func(type: StringName, _data: Dictionary) -> void:
		if type == &"COUNTER_ROTATION" and view.touch.counter_pointer != PickTouch.NO_POINTER:
			eased[0] = true)
	await _wrench_to(5)
	var opened := await _work(120.0)
	_check(eased[0], "holding the counter pad turns the plug back off a spool")
	_check(view.touch.used_both_thumbs, "two fingers at once are heard as two")
	_check(opened, "ironhold-spool-trainer opens by fingers alone", "t=%.1fs states %s" % [pick.elapsed(), str(view.session.rig.states)])
	await _wait(0.3)
	_app.abandon_lock()
	await _wait(0.2)


## Each control on its own.
func _controls() -> void:
	_app.start_lock(Roster.by_slug("brasswell-no1-luggage"))
	await _wait(0.2)
	var pick: PickScreen = _app.pick
	var view := pick.pins
	var session := view.session
	var x := PickTouch.WRENCH_SLIDER.get_center().x
	_check(view.touch.step == 0 and session.tension <= 0.0, "a fresh lock starts with the wrench off")
	# A tap on a band picks that band.
	await _tap(WRENCH, Vector2(x, (PickTouch.y_for_step(7) + PickTouch.y_for_step(8)) / 2.0))
	_check(view.touch.step == 7, "a tap on the seventh band sets 7", "step %d" % view.touch.step)
	# A grab changes nothing until the finger moves.
	_finger(WRENCH, Vector2(x, 400.0), true)
	await _wait(0.1)
	_check(view.touch.step == 7, "putting a thumb down on the slider does not jump the wrench", "step %d" % view.touch.step)
	await _slide(WRENCH, Vector2(x, 400.0 + 62.0 * 2.0), 0.2)
	_check(view.touch.step == 5, "two steps of drag down is two steps off", "step %d" % view.touch.step)
	# The bottom band is off however the finger arrived in it.
	await _slide(WRENCH, Vector2(x, PickTouch.WRENCH_SLIDER.end.y - 20.0), 0.2)
	_finger(WRENCH, _down[WRENCH], false)
	await _wait(0.3)
	_check(view.touch.step == 0 and session.tension <= 0.0, "the bottom of the slider is off", "step %d" % view.touch.step)
	# Pick out, and back in under a chosen pin.
	await _tap(OTHER, PickTouch.WITHDRAW_PAD.get_center())
	await _wait(0.6)
	_check(session.pick_chamber == -1, "the pick-out pad takes the pick out of the lock", "chamber %d" % session.pick_chamber)
	_finger(PIN, _pin_at(view, 0), true)
	await _wait(0.5)
	_check(session.pick_chamber == 0, "a touch on pin 1 puts it back under pin 1")
	# Dragging up lifts; dragging across with the hand raised carries the hook to the next pin.
	await _slide(PIN, _pin_at(view, 0) - Vector2(0.0, 150.0), 0.4)
	await _wait(0.3)
	var lifted := session.lift
	_check(lifted > 0.5, "a drag up lifts the pin under the tip", "lift %.2f mm" % lifted)
	await _slide(PIN, _pin_at(view, 2) - Vector2(0.0, 150.0), 0.4)
	await _wait(0.6)
	_check(view.touch.chamber == 2 and session.pick_chamber == 2 and view.touch.lift > 0.5,
		"a drag across carries the hook, still raised, to the pin under the finger",
		"chamber %d asked %.2f mm" % [session.pick_chamber, view.touch.lift])
	# From off the lock, a drag lifts the pin already chosen.
	_finger(PIN, _down[PIN], false)
	await _wait(0.5)
	_check(session.lift < 0.05, "letting go lets the pin back down", "lift %.2f" % session.lift)
	_finger(PIN, Vector2(1700.0, 800.0), true)
	await _slide(PIN, Vector2(1700.0, 650.0), 0.4)
	await _wait(0.3)
	_check(session.pick_chamber == 2 and session.lift > 0.5, "a drag started off the lock lifts the chosen pin",
		"chamber %d lift %.2f" % [session.pick_chamber, session.lift])
	_lift_fingers()
	# A key takes the lock back; a finger takes it again.
	var key := InputEventKey.new()
	key.physical_keycode = KEY_F24
	key.keycode = KEY_F24
	key.pressed = true
	Input.parse_input_event(key)
	await _wait(0.1)
	_check(not PickTouch.active and view.get("_key_chamber") == 2, "a key press hands the lock back to the keys, tip where it was")
	await _tap(OTHER, Vector2(1700.0, 800.0))
	_check(PickTouch.active, "and a finger takes it again")
	# Pause.
	await _tap(OTHER, PickTouch.PAUSE_PAD.get_center())
	await _wait(0.1)
	_check(_app.screen_name == &"pause", "the pause pad pauses", str(_app.screen_name))
	_app.goto(&"pick")
	await _wait(0.1)
	_app.abandon_lock()
	await _wait(0.2)


## The snap gun: the strike pad is held to draw the needle back and let go to strike.
func _gun() -> void:
	_app.start_lock(Roster.by_slug("kestrel-door-cylinder"), -1, false, true)
	await _wait(0.2)
	var pick: PickScreen = _app.pick
	var view := pick.pins
	var powers: Array[float] = []
	view.session.sim_event.connect(func(type: StringName, data: Dictionary) -> void:
		if type == &"STRIKE":
			powers.append(float(data["power"])))
	await _wrench_to(3)
	# Aim the needle under every pin: a touch on the last one.
	await _tap(PIN, _pin_at(view, view.session.rig.count - 1))
	await _wait(0.6)
	_check(view.session.pick_chamber == view.session.rig.count - 1 and view.session.lift < 0.05,
		"a touch on the last pin aims the needle and lifts nothing")
	var holds := [1.2, 0.3, 0.7]
	var k := 0
	var spent := 0.0
	while spent < 60.0 and not pick.is_open():
		var hold: float = holds[k % 3]
		_finger(OTHER, PickTouch.STRIKE_PAD.get_center(), true)
		await _wait(hold)
		_finger(OTHER, _down[OTHER], false)
		await _wait(0.35)
		spent += hold + 0.35
		k += 1
	var soft := 9.0
	var hard := 0.0
	for power in powers:
		soft = minf(soft, power)
		hard = maxf(hard, power)
	_check(powers.size() >= 3 and hard - soft > 0.3 and hard > 1.05, "a longer hold on the strike pad strikes harder",
		"%d strikes, %d%% to %d%%" % [powers.size(), roundi(soft * 100.0), roundi(hard * 100.0)])
	print("     the gun lock %s after %d strikes" % ["opened" if pick.is_open() else "is still shut", powers.size()])
	_lift_fingers()
	await _wait(0.3)
	_app.abandon_lock()
	await _wait(0.2)


## The pad a wheel pack takes, and the screen that asks for the phone to be turned.
func _screens() -> void:
	_app.start_lock(Roster.by_slug("brasswell-3-wheel-luggage"))
	await _wait(0.2)
	await _tap(OTHER, PickTouch.PAUSE_PAD.get_center())
	await _wait(0.1)
	_check(_app.screen_name == &"pause", "the pause pad pauses a wheel pack too", str(_app.screen_name))
	_app.goto(&"pick")
	await _wait(0.1)
	_app.abandon_lock()
	_app.goto(&"menu")
	await _wait(0.2)
	var prompt: RotatePrompt = _app.get("_rotate")
	_check(not prompt.visible, "no rotate prompt on a wide screen")
	var wide := root.size
	root.size = Vector2i(390, 844)
	await _wait(0.3)
	_check(prompt.visible, "a touch screen held upright is asked to turn", "window %s" % str(root.size))
	root.size = wide
	await _wait(0.3)
	_check(not prompt.visible, "and the prompt goes when it is turned back")


## No line said to a finger names a key.
func _lessons() -> void:
	var keys := RegEx.new()
	# "The way a key would" is a key for a lock, and stays.
	keys.compile("\\bQ\\b|\\bSpace\\b|[Aa]rrow|\\bkeys\\b|\\bpress\\b|\\bC\\b|\\(W\\)|1 to 0|1-0")
	var bad: Array[String] = []
	var said := 0
	for lesson in Lessons.all():
		var run := Lessons.Run.new(lesson)
		for k in (lesson["steps"] as Array).size():
			run.step = k
			for wait_for: float in [0.0, 999.0]:
				run.on_step_for = wait_for
				var line := run.line(true)
				said += 1
				if keys.search(line) != null:
					bad.append("%s/%s: %s" % [lesson["id"], lesson["steps"][k]["id"], line])
	for line in bad:
		print("     ", line)
	_check(bad.is_empty(), "no lesson line said to a finger names a key", "%d lines read" % said)
