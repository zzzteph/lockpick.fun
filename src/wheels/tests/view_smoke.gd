extends SceneTree
## Headless: the playable padlock, driven the ways it will be driven.
##
##   godot --headless --path godot --fixed-fps 60 -s res://wheels/tests/view_smoke.gd -- [verbose]
##
##  - every wheel pack in the roster, on several seeds, fed the scripted hand's own solution as a
##    tape: it opens, says LOCK_OPENED once, and emits exactly the events a bare engine does;
##  - the keyboard, through real key events: Q pulls, the arrows choose and click, Space rolls;
##  - the pointer: press-and-hold the shackle to pull, drag a wheel to roll it;
##  - paused means no stepping and no input.

const WHEEL_LOCKS: Array[int] = [39, 40, 41]
const SEEDS: Array[int] = [1, 2, 3]

var verbose := false
var failures: Array[String] = []
var checks := 0
var heard: Array[Dictionary] = []


func _initialize() -> void:
	verbose = OS.get_cmdline_user_args().has("verbose")
	_run.call_deferred()


func _run() -> void:
	for id in WHEEL_LOCKS:
		for s in SEEDS:
			await _tape_case(Roster.by_id(id), s)
	for id in WHEEL_LOCKS:
		await _keyboard_case(Roster.by_id(id), 5)
	await _pointer_case(Roster.by_id(39), 4)
	await _pause_case(Roster.by_id(40), 6)
	print("---- %d checks, %d failed" % [checks, failures.size()])
	for f in failures:
		print("FAIL ", f)
	quit(1 if not failures.is_empty() else 0)


func _check(ok: bool, what: String) -> void:
	checks += 1
	if not ok:
		failures.append(what)


func _view(def: Dictionary, lock_seed: int) -> WheelLockView:
	var view := WheelLockView.new()
	root.add_child(view)
	heard = []
	view.sim_event.connect(func(type: StringName, data: Dictionary) -> void:
		_check(data["type"] == type, "the event's own type matches the signal's")
		heard.append(data))
	view.start(def, lock_seed, &"training")
	return view


func _frames(n: int) -> void:
	for i in n:
		await physics_frame


func _count(type: StringName) -> int:
	var n := 0
	for ev in heard:
		if ev["type"] == type:
			n += 1
	return n


# ── The solver's tape through the view ──────────────────────────────────────────────────

func _tape_case(def: Dictionary, lock_seed: int) -> void:
	var where := "%s seed %d" % [def["slug"], lock_seed]
	var solution := WheelSolver.solve(def, lock_seed)
	_check(solution["opened"], "%s: the scripted hand opens it" % where)

	# What a bare engine says when it is fed the same tape, up to the open.
	var expected: Array[Dictionary] = []
	var bare := WheelEngine.create(def, lock_seed, &"training")
	for seg: Dictionary in solution["tape"]:
		for i in int(seg["ticks"]):
			if bare.opened:
				break
			bare.step(seg["input"], WheelEngine.DT)
			expected.append_array(bare.drain_events())

	var view := _view(def, lock_seed)
	view.play_tape(solution["tape"])
	var limit := int(solution["ticks"]) * 4 + 2000
	var waited := 0
	while not view.opened and waited < limit:
		await physics_frame
		waited += 1
	_check(view.opened, "%s: the view opens on the tape" % where)
	_check(_count(&"LOCK_OPENED") == 1, "%s: LOCK_OPENED once, heard %d" % [where, _count(&"LOCK_OPENED")])
	_check(_count(&"PIN_SET") >= view.engine.count, "%s: every wheel seated" % where)
	_check(not heard.is_empty() and heard[0]["type"] == &"ATTEMPT_STARTED", "%s: ATTEMPT_STARTED first" % where)
	_check(heard == expected, "%s: the view's events are the engine's (%d heard, %d expected)" % [where, heard.size(), expected.size()])
	_check(is_equal_approx(view.time, bare.time), "%s: the view's clock is the engine's (%f vs %f)" % [where, view.time, bare.time])

	var st := view.stats
	for key: String in ["oversets", "full_resets", "false_sets", "elapsed"]:
		_check(st.has(key), "%s: stats carries %s" % [where, key])
	_check(is_equal_approx(float(st["elapsed"]), view.time), "%s: stats.elapsed is the clock" % where)
	var hud := view.hud()
	for key: String in ["tension", "resistance", "state_word", "progress", "legend", "hint"]:
		_check(hud.has(key), "%s: hud carries %s" % [where, key])
	_check(float(hud["progress"]) == 1.0, "%s: progress is 1 when open" % where)
	_check(float(hud["tension"]) > 0.0 and float(hud["tension"]) <= 1.0, "%s: tension in range" % where)
	_check((hud["legend"] as Array).size() == 6, "%s: six legend rows" % where)

	# Once the lock is open the simulation is done.
	var at := view.time
	await _frames(40)
	_check(view.time == at, "%s: the clock stops at the open" % where)
	if verbose:
		print("tape  %-28s seed %d  t=%.2fs events=%d false=%d" % [def["slug"], lock_seed, view.time, heard.size(), st["false_sets"]])
	view.queue_free()
	await _frames(2)


# ── The keyboard ────────────────────────────────────────────────────────────────────────

func _key(code: Key, pressed: bool) -> void:
	var e := InputEventKey.new()
	e.keycode = code
	e.physical_keycode = code
	e.pressed = pressed
	Input.parse_input_event(e)
	Input.flush_buffered_events()


func _tap(code: Key) -> void:
	_key(code, true)
	await _frames(2)
	_key(code, false)
	await _frames(2)


## Arrow the thumb onto a wheel and wait for the hand to get there: it crosses the pack rather
## than jumping.
func _thumb_to(view: WheelLockView, wheel: int) -> void:
	var tries := 0
	while view.engine.pick_wheel != wheel and tries < 8:
		tries += 1
		await _tap(KEY_RIGHT if view.engine.pick_wheel < wheel else KEY_LEFT)
		await _frames(160)


## A player who can see the x-ray and has only the keys: hold Q, arrow to the wheel that drags,
## click it round to its clear gate, wait for the fence to drop, repeat.
func _keyboard_case(def: Dictionary, lock_seed: int) -> void:
	var where := "%s keyboard" % def["slug"]
	var view := _view(def, lock_seed)
	var e := view.engine
	await _frames(8)
	_check(e.pick_wheel == 0, "%s: the thumb starts on the first wheel" % where)
	_check(e.tension == 0.0, "%s: no pull before Q" % where)

	# Space rolls the wheel under the thumb and letting go parks it on a digit.
	var before := e.wheels[0].pos
	_key(KEY_SPACE, true)
	await _frames(240)
	_check(e.wheels[0].pos != before, "%s: Space rolls the wheel" % where)
	_key(KEY_SPACE, false)
	await _frames(60)
	var parked := e.wheels[0].pos
	_check(absf(parked - WheelEngine.quantize(parked)) < 1e-9, "%s: released, the wheel parks on a digit" % where)
	await _frames(60)
	_check(e.wheels[0].pos == parked, "%s: a parked wheel stays" % where)

	# One click up and one click down, and down from 0 wraps to 9 through the seam.
	var d0 := e.wheels[0].digit()
	await _tap(KEY_UP)
	await _frames(40)
	_check(e.wheels[0].digit() == posmod(d0 + 1, 10), "%s: ↑ is one click up" % where)
	for i in posmod(d0 + 1, 10) + 1:
		await _tap(KEY_DOWN)
		await _frames(40)
	_check(e.wheels[0].digit() == 9, "%s: ↓ from 0 wraps to 9 (at %d)" % [where, e.wheels[0].digit()])

	_key(KEY_Q, true)
	await _frames(200)
	_check(e.tension > 0.3, "%s: Q pulls the shackle (%f)" % [where, e.tension])
	_check(view.hud()["tension"] > 0.3, "%s: the hud reads the pull" % where)
	var guard := 0
	while not view.opened and guard < 200:
		guard += 1
		# A wheel caught on a lie holds everything: ease the pull right off, roll it on, pull again.
		var liar := -1
		for w in e.wheels:
			if w.state == WheelEngine.FALSE_SET:
				liar = w.index
		if liar >= 0:
			_key(KEY_Q, false)
			await _frames(160)
			await _thumb_to(view, liar)
			await _tap(KEY_UP)
			await _frames(60)
			_key(KEY_Q, true)
			await _frames(200)
			continue
		var b := e.binding
		if b < 0:
			await _frames(20)
			continue
		await _thumb_to(view, b)
		if e.wheels[b].digit() != int(floor(e.wheels[b].gate / WheelEngine.DETENT)):
			await _tap(KEY_UP)
		await _frames(60)
	_key(KEY_Q, false)
	_check(view.opened, "%s: opens by the keys alone (%s)" % [where, str(view.lesson_state()["states"])])
	_check(_count(&"LOCK_OPENED") == 1, "%s: LOCK_OPENED once" % where)
	if verbose:
		print("keys  %-28s t=%.2fs false=%d resets=%d" % [def["slug"], view.time, view.stats["false_sets"], view.stats["full_resets"]])
	view.queue_free()
	await _frames(2)


# ── The pointer ─────────────────────────────────────────────────────────────────────────

func _mouse_button(stage_pos: Vector2, pressed: bool) -> void:
	var e := InputEventMouseButton.new()
	e.button_index = MOUSE_BUTTON_LEFT
	e.pressed = pressed
	e.button_mask = MOUSE_BUTTON_MASK_LEFT if pressed else 0
	e.position = root.get_final_transform() * stage_pos
	e.global_position = e.position
	Input.parse_input_event(e)
	Input.flush_buffered_events()


func _mouse_move(stage_pos: Vector2) -> void:
	var e := InputEventMouseMotion.new()
	e.button_mask = MOUSE_BUTTON_MASK_LEFT
	e.position = root.get_final_transform() * stage_pos
	e.global_position = e.position
	Input.parse_input_event(e)
	Input.flush_buffered_events()


func _pointer_case(def: Dictionary, lock_seed: int) -> void:
	var where := "%s pointer" % def["slug"]
	var view := _view(def, lock_seed)
	var e := view.engine
	await _frames(8)

	# Press and hold the hook: the pull. Let go: released.
	var hook := view.shackle_grab_rect().get_center()
	_mouse_button(hook, true)
	await _frames(200)
	_check(e.tension > 0.3, "%s: holding the shackle pulls it (%f)" % [where, e.tension])
	_mouse_button(hook, false)
	await _frames(200)
	_check(e.tension == 0.0, "%s: letting go releases it (%f)" % [where, e.tension])

	# Drag the second wheel up two clicks' worth: it rolls two digits and stays there.
	var face := view.wheel_rect(1).get_center()
	var d0 := e.wheels[1].digit()
	var others := [e.wheels[0].pos, e.wheels[2].pos]
	_mouse_button(face, true)
	# The hand crosses the pack to get there.
	await _frames(80)
	_check(e.pick_wheel == 1, "%s: a press on a wheel puts the thumb on it" % where)
	_check(e.wheels[1].digit() == d0, "%s: a press alone turns nothing" % where)
	var click_px := WheelLockView.DRAG_PX / WheelEngine.DIGITS
	for i in 20:
		_mouse_move(face + Vector2(0.0, -click_px * 2.0 * (i + 1) / 20.0))
		await _frames(4)
	await _frames(60)
	_check(e.wheels[1].digit() == posmod(d0 + 2, 10), "%s: dragging up two clicks rolls two digits (%d → %d)" % [where, d0, e.wheels[1].digit()])
	_mouse_button(face + Vector2(0.0, -click_px * 2.0), false)
	await _frames(60)
	_check(e.wheels[1].digit() == posmod(d0 + 2, 10), "%s: released, the wheel stays" % where)
	_check(e.wheels[0].pos == others[0] and e.wheels[2].pos == others[1], "%s: the other wheels never moved" % where)
	# A second grab continues the dial from where it stands.
	_mouse_button(face, true)
	await _frames(8)
	_mouse_move(face + Vector2(0.0, click_px))
	await _frames(60)
	_mouse_button(face + Vector2(0.0, click_px), false)
	await _frames(20)
	_check(e.wheels[1].digit() == posmod(d0 + 1, 10), "%s: a second grab continues from where the wheel stands (%d)" % [where, e.wheels[1].digit()])
	view.queue_free()
	await _frames(2)


# ── Paused ──────────────────────────────────────────────────────────────────────────────

func _pause_case(def: Dictionary, lock_seed: int) -> void:
	var where := "%s paused" % def["slug"]
	var view := _view(def, lock_seed)
	await _frames(40)
	_check(view.time > 0.0, "%s: the clock runs" % where)
	view.paused = true
	var at := view.time
	_key(KEY_Q, true)
	_key(KEY_RIGHT, true)
	_key(KEY_RIGHT, false)
	await _frames(80)
	_check(view.time == at, "%s: no stepping while paused" % where)
	view.paused = false
	await _frames(80)
	_check(view.time > at, "%s: the clock resumes" % where)
	_check(view.engine.tension == 0.0, "%s: a key pressed while paused pulled nothing" % where)
	_check(view.engine.pick_wheel == 0, "%s: an arrow pressed while paused moved nothing" % where)
	_key(KEY_Q, false)
	view.queue_free()
	await _frames(2)
