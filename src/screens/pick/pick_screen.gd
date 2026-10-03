class_name PickScreen
extends Control
## The pick screen: one lock, the hands on it, and the instruments around it.
##
## It builds the right view for the lock's family, feeds the HUD from it every frame, and
## reports what the rest of the game needs to hear: the lock opened, the player walked away.

## The lock opened. `summary` carries the time and the attempt's tallies.
signal opened(summary: Dictionary)
## The payoff has played out (or been skipped): time to leave the lock.
signal payoff_done
## The player left by the header link or the pause menu.
signal left
signal restart_requested
signal pause_requested
## Every simulation event, for sound, captions, lessons and haptics.
signal sim_event(type: StringName, data: Dictionary)

var def: Dictionary
var lock_seed := 1
var assist: StringName = &"training"
var gun := false
var lesson := false
var inspecting := false
## Seconds left on a Lock Blitz run, or negative.
var countdown_left := -1.0
var title_suffix := ""
var back_label := "bench"

var pins: PinLockView
var wheels: Node2D
var discs: DiscLockView
var front: FrontView
var disc_front: DiscFront
var hud: PickHud
## The on-screen controls, drawn once a finger has touched the glass.
var pads: TouchPads
var overlay: PickOverlay
## The lesson being taught on this lock, or null.
var lesson_run: Lessons.Run
var reduced_motion := false
## The wrench latches on a tap instead of needing to be held (a Settings choice).
var tension_toggle := false
## Easing the pull without dropping it is allowed on a wheel pack (earned with the third tier).
var feather := false
## What is known about this lock before a pin is touched — [label, value] rows for the HUD.
var about: Array = []
var _paused := false
var _payoff_said := false
var _overset_for: PackedFloat32Array = PackedFloat32Array()
var _fooled: Array[bool] = []
var _opened_said := false
var _wrench_used := false
var _last_shift := 0.0
## The whole-drawing shiver on a set, 1 → 0, and the clock its oscillators run on.
var _shake := 0.0
var _fx_clock := 0.0
## The plug's speed at its rim, mm/s, for the sound of it turning.
var _plug_speed := 0.0
var _speed_from := 0.0
const GRIND_AT_FULL_PUSH := 43.0

var _dt := 1.0 / 60.0
var _force := Steady.new(0.02)
var _resistance := Steady.new(0.02)
var _strain := Steady.new(0.04)
## The plug's slide, mm: steady to a hundredth of a degree's worth.
var _turn := Steady.new(0.004, 0.05)

## Where the front view starts when it has the left gutter to itself: under the rank band.
const FRONT_TOP := 250.0
const SHAKE_PX := 2.4
const SHAKE_SECONDS := 0.04
const CAMERA_DRIFT_PX := 6.0


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	# The pointer belongs to the lock under it; this Control only gives the screen its rect.
	mouse_filter = Control.MOUSE_FILTER_IGNORE


## Put a lock on the bench. `options`: assist, gun, lesson, inspecting.
func start(lock_def: Dictionary, with_seed: int, options: Dictionary = {}) -> void:
	def = lock_def
	lock_seed = with_seed
	assist = options.get("assist", &"training")
	gun = options.get("gun", false)
	lesson = options.get("lesson", false)
	inspecting = options.get("inspecting", false)
	_opened_said = false
	_payoff_said = false
	_wrench_used = false
	for reading: Steady in [_force, _resistance, _strain, _turn]:
		reading.reset()
	lesson_run = options.get("lesson_run", null)
	tension_toggle = options.get("tension_toggle", false)
	feather = options.get("feather", false)
	about = options.get("about", [])
	_overset_for.resize((def["bitting"] as Array).size())
	_overset_for.fill(0.0)
	_fooled.clear()
	for i in _overset_for.size():
		_fooled.append(false)
	for child in get_children():
		child.queue_free()
	pins = null
	wheels = null
	discs = null
	front = null
	disc_front = null
	match str(def.get("family", "pin-tumbler")):
		"combination":
			_start_wheels()
		"disc-detainer":
			_start_discs()
		_:
			_start_pins()
	hud = PickHud.new()
	add_child(hud)
	pads = TouchPads.new()
	pads.touch = pins.touch if pins != null else (discs.touch if discs != null else null)
	pads.gun = gun
	add_child(pads)
	overlay = PickOverlay.new()
	overlay.sequence.reduced_motion = reduced_motion
	add_child(overlay)
	_feed_hud()


## Play the open's payoff: the rank stamp (pass a negative rank for none) and the cards earned.
func play_payoff(rank: int, earned: Array) -> void:
	overlay.earned = earned
	overlay.centre = Vector2(960.0, PinLockView.SHEAR_Y if pins != null else (DiscLockView.AXIS_Y if discs != null else 540.0))
	overlay.sequence.start(rank, earned.size())


## What a lesson's steps read: a snapshot of the attempt in the lesson's own terms.
func lesson_state() -> Dictionary:
	if pins != null:
		var session := pins.session
		var rig := session.rig
		var fooled_then_set := false
		var serrated_set := false
		var longest := 0.0
		for i in rig.count:
			if _fooled[i] and rig.states[i] == LockRig.SET:
				fooled_then_set = true
			if rig.states[i] == LockRig.SET and rig.chambers[i]["profile"] == "serrated":
				serrated_set = true
			longest = maxf(longest, _overset_for[i])
		return {
			"tension": session.tension,
			"pick": session.pick_chamber,
			"binding": rig.binding,
			"states": rig.states,
			"opened": rig.opened,
			"full_resets": int(session.stats["full_resets"]),
			"false_sets": int(session.stats["false_sets"]),
			"fooled_then_set": fooled_then_set,
			"serrated_set": serrated_set,
			"overset_for": longest,
		}
	if discs != null:
		var hand := discs.session
		var pack := hand.rig
		var through := false
		for i in pack.count:
			if _fooled[i] and pack.states[i] == LockRig.SET:
				through = true
		return {
			"tension": hand.tension,
			"pick": hand.pick_chamber,
			"binding": pack.binding,
			"states": pack.states,
			"opened": pack.opened,
			"full_resets": 0,
			"false_sets": int(hand.stats["false_sets"]),
			"fooled_then_set": through,
			"serrated_set": false,
			"overset_for": 0.0,
		}
	if wheels != null and wheels.has_method("lesson_state"):
		return wheels.call("lesson_state")
	return {"tension": 0.0, "pick": -1, "binding": -1, "states": PackedInt32Array(), "opened": is_open(),
		"full_resets": 0, "false_sets": 0, "fooled_then_set": false, "serrated_set": false, "overset_for": 0.0}


func _start_pins() -> void:
	pins = PinLockView.new()
	pins.gun = gun
	pins.tension_toggle = tension_toggle
	add_child(pins)
	pins.start(def, lock_seed, &"training" if lesson else assist)
	pins.sim_event.connect(_on_sim_event)
	pins.restart_requested.connect(func() -> void: restart_requested.emit())
	pins.pause_requested.connect(func() -> void: pause_requested.emit())
	front = FrontView.new()
	front.view = pins
	add_child(front)


func _start_discs() -> void:
	discs = DiscLockView.new()
	discs.tension_toggle = tension_toggle
	add_child(discs)
	discs.start(def, lock_seed, &"training" if lesson else assist)
	discs.sim_event.connect(_on_sim_event)
	discs.restart_requested.connect(func() -> void: restart_requested.emit())
	discs.pause_requested.connect(func() -> void: pause_requested.emit())
	disc_front = DiscFront.new()
	disc_front.view = discs
	add_child(disc_front)


func _start_wheels() -> void:
	var script: GDScript = load("res://wheels/wheel_lock_view.gd")
	wheels = script.new()
	wheels.set("tension_toggle", tension_toggle)
	wheels.set("reduced_motion", reduced_motion)
	wheels.set("feather_enabled", feather)
	add_child(wheels)
	wheels.call("start", def, lock_seed, &"training" if lesson else assist)
	wheels.connect("sim_event", _on_sim_event)
	wheels.connect("restart_requested", func() -> void: restart_requested.emit())
	wheels.connect("pause_requested", func() -> void: pause_requested.emit())


## What the sustained sounds (and their captions) follow: the pin under the tip and how it is
## behaving, the grind of a plug being eased back, and how fast the plug is turning.
func sustained() -> Dictionary:
	if pins != null:
		var session := pins.session
		var rig := session.rig
		var under := session.pick_chamber
		return {
			"chamber": under,
			"state": rig.states[under] if under >= 0 else LockRig.FREE,
			"lift": rig.key_lift(under) if under >= 0 else 0.0,
			"resistance": session.pick_resistance,
			# Easing the plug back against a trapped spool is what grinds: the push the hand is
			# holding through it, on the scale the grind was voiced for (a spool at its worst
			# pushes back with about 43).
			"counter_force": session.pick_force * GRIND_AT_FULL_PUSH if session.counter_on else 0.0,
			"plug_speed": _plug_speed,
		}
	if discs != null:
		var hand := discs.session
		var in_disc := hand.pick_chamber
		return {
			"chamber": in_disc,
			"state": hand.rig.states[in_disc] if in_disc >= 0 else LockRig.FREE,
			# What a pin's lift is to its hum, a disc's turn is to its own.
			"lift": hand.rig.turned(in_disc) / DiscRig.UNIT if in_disc >= 0 else 0.0,
			"resistance": hand.pick_resistance,
			"counter_force": 0.0,
			"plug_speed": _plug_speed,
		}
	return {"chamber": -1, "state": 0, "lift": 0.0, "resistance": hud.resistance if hud != null else 0.0,
		"counter_force": 0.0, "plug_speed": 0.0}


## A Settings change made from the pause panel reaches the lock already on the bench.
func set_tension_toggle(on: bool) -> void:
	tension_toggle = on
	if pins != null:
		pins.tension_toggle = on
	if discs != null:
		discs.tension_toggle = on
	if wheels != null:
		wheels.set("tension_toggle", on)


func set_paused(value: bool) -> void:
	_paused = value
	if pins != null:
		pins.paused = value
	if discs != null:
		discs.paused = value
	if wheels != null:
		wheels.set("paused", value)


func is_open() -> bool:
	if pins != null:
		return pins.opened
	if discs != null:
		return discs.opened
	return wheels != null and bool(wheels.get("opened"))


func elapsed() -> float:
	if pins != null:
		return pins.time
	if discs != null:
		return discs.time
	return float(wheels.get("time")) if wheels != null else 0.0


func stats() -> Dictionary:
	if pins != null:
		return pins.stats
	if discs != null:
		return discs.stats
	return wheels.get("stats") if wheels != null else {}


func _on_sim_event(type: StringName, data: Dictionary) -> void:
	# A screen already taken down has nothing more to say: its lock's last tick is not the next
	# lock's news.
	if is_queued_for_deletion():
		return
	# A wheel that seats, or settles in a false gate, does so silently: the pack's only honest
	# tell is the drag in the hand, and a click on each seat would hand the combination over.
	if wheels != null and (type == &"PIN_SET" or type == &"FALSE_SET_ENTERED"):
		return
	sim_event.emit(type, data)
	if type == &"FALSE_SET_ENTERED" and int(data.get("chamber", -1)) >= 0 and int(data["chamber"]) < _fooled.size():
		_fooled[int(data["chamber"])] = true
	if type == &"PIN_SET" and not reduced_motion:
		_shake = 1.0
	if type == &"STRIKE" and not reduced_motion:
		# The gun kicks, as hard as it was drawn back: a tap barely, a full draw plainly.
		_shake = maxf(_shake, 0.5 + float(data.get("power", 1.0)))
	if type == &"LOCK_OPENED" and not _opened_said:
		_opened_said = true
		opened.emit({"time": elapsed(), "stats": stats(), "gun": gun})


func _unhandled_input(event: InputEvent) -> void:
	# The pause pad: a finger has no Esc.
	if event is InputEventScreenTouch and (event as InputEventScreenTouch).pressed and not _paused and not is_open():
		if PickTouch.PAUSE_PAD.has_point((make_input_local(event) as InputEventScreenTouch).position):
			get_viewport().set_input_as_handled()
			pause_requested.emit()
			return
	# The way out, in the header's corner.
	if event is InputEventMouseButton and (event as InputEventMouseButton).pressed \
			and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT \
			and PickHud.BENCH_LINK.has_point(get_local_mouse_position()) and not is_open():
		get_viewport().set_input_as_handled()
		left.emit()
		return
	# Any key or a click skips the payoff, once it has run long enough to allow it.
	if overlay == null or not overlay.sequence.can_skip():
		return
	var pressed := (event is InputEventKey and (event as InputEventKey).pressed and not (event as InputEventKey).echo) \
		or (event is InputEventMouseButton and (event as InputEventMouseButton).pressed) \
		or (event is InputEventScreenTouch and (event as InputEventScreenTouch).pressed) \
		or (event is InputEventJoypadButton and (event as InputEventJoypadButton).pressed)
	if pressed and overlay.sequence.skip():
		get_viewport().set_input_as_handled()


func _process(delta: float) -> void:
	if hud == null:
		return
	_dt = delta
	if pins != null:
		var rig := pins.session.rig
		for i in rig.count:
			_overset_for[i] = _overset_for[i] + delta if rig.states[i] == LockRig.OVERSET else 0.0
	if lesson_run != null:
		lesson_run.update(lesson_state(), delta)
		overlay.lesson_line = lesson_run.line(PickTouch.active)
		overlay.lesson_step = lesson_run.step
		overlay.lesson_total = lesson_run.total()
	else:
		overlay.lesson_line = ""
	var seq := overlay.sequence
	if seq.running:
		if seq.update(delta):
			sim_event.emit(&"RANK_STAMP", {})
		# The jolt rides the drawing, not the chrome: the lock lurches, the HUD stays put.
		if wheels != null:
			wheels.position.y = seq.jolt()
	if pins != null:
		var shift_now := pins.session.rig.shift()
		_plug_speed = (shift_now - _speed_from) / maxf(delta, 1e-4)
		_speed_from = shift_now
		# The drawing leans a few pixels as the plug turns, and shivers once on a set.
		_shake = maxf(0.0, _shake - delta / SHAKE_SECONDS)
		_fx_clock += delta
		var lean := 0.0 if reduced_motion else hud.plug_turned * CAMERA_DRIFT_PX
		var a := _shake * SHAKE_PX
		pins.position = Vector2(lean + a * sin(_fx_clock * 190.0), a * sin(_fx_clock * 233.0 + 1.1) + seq.jolt())
	if discs != null:
		var turn_now := discs.session.rig.shift()
		_plug_speed = (turn_now - _speed_from) / maxf(delta, 1e-4)
		_speed_from = turn_now
		# The same lean and the same shiver as a pin lock's: the sleeve turning, the bar dropping in.
		_shake = maxf(0.0, _shake - delta / SHAKE_SECONDS)
		_fx_clock += delta
		var lean := 0.0 if reduced_motion else hud.plug_turned * CAMERA_DRIFT_PX
		var a := _shake * SHAKE_PX
		discs.position = Vector2(lean + a * sin(_fx_clock * 190.0), a * sin(_fx_clock * 233.0 + 1.1) + seq.jolt())
	if _opened_said and not _payoff_said and seq.elapsed > 0.0 and seq.settled():
		_payoff_said = true
		payoff_done.emit()
	_feed_hud()


func _legend() -> Array:
	if discs != null:
		if PickTouch.active:
			return [["tap", "a disc"], ["drag ↕", "turn it"], ["slider", "tension"], ["pad", "ease the sleeve"]]
		# Short, so the front view under it is large: it is the picture this lock is learned from.
		return [["← → · mouse", "choose a disc"], ["space · click", "turn it on"], ["↓ · r-click", "turn it back"],
			["Q", "tension wrench"], ["C", "ease the sleeve"], ["1-0", "wrench pressure"]]
	if PickTouch.active:
		# What the fingers do; the pads say the rest themselves.
		if gun:
			return [["strike", "hold, then let go"], ["tap", "aim the needle"], ["slider", "tension"]]
		return [["tap", "a pin"], ["drag up", "to lift"], ["drag ↔", "carry it"], ["slider", "tension"]]
	if gun:
		return [["space", "hold to draw, let go to strike"], ["← →", "aim the needle"], ["Q", "tension wrench"],
			["1-0", "wrench pressure"], ["R", "restart"], ["esc", "pause"]]
	var rows: Array = [
		["mouse", "move the pick"],
		["click", "hold = wrench"],
		["r-click", "hold too = counter-rotate"],
		["← →", "move"],
		["space", "lift"],
		["space+← →", "carry it"],
	]
	if pins != null and pins.fine_lift:
		rows.append(["↑ ↓", "fine lift"])
	rows.append_array([["Q", "tension wrench"], ["C", "counter-rotate"], ["1-0", "wrench pressure"],
		["R", "restart"], ["esc", "pause"]])
	return rows


func _feed_hud() -> void:
	hud.lock_name = str(def.get("name", "")) + title_suffix
	hud.back_label = back_label
	hud.elapsed = elapsed()
	hud.par = float(def.get("par", 60)) * (0.6 if assist == &"training" else 1.0)
	hud.countdown_left = countdown_left
	hud.lesson = lesson
	hud.inspecting = inspecting
	hud.gun = gun
	hud.about = about if not lesson else []
	if gun and pins != null:
		hud.gun_power = pins.gun_charge if pins.gun_charge > 0.0 else pins.gun_power
	hud.payoff = is_open()
	hud.touch = PickTouch.active
	pads.visible = not _paused and not is_open()
	pads.charging = pins != null and pins.touch.strike_pointer != PickTouch.NO_POINTER
	hud.bench_hot = is_inside_tree() and PickHud.BENCH_LINK.has_point(get_local_mouse_position())
	hud.plug_word = "plug"
	hud.rest_hint = ""
	hud.idle_hint = ""
	if pins != null:
		_feed_pins()
	elif discs != null:
		_feed_discs()
	elif wheels != null:
		_feed_wheels()


func _feed_pins() -> void:
	var session := pins.session
	var rig := session.rig
	var colored := pins.colored
	hud.shackle = false
	# The keys are spelled out while they are being taught; after that the bench is the lock
	# and its instruments, and Help has the controls.
	hud.keys = _legend() if lesson else []
	hud.assembly_left = pins.side_x0()
	hud.tension = session.tension
	hud.pressure_step = pins.wrench_step()
	if session.tension > 0.0:
		_wrench_used = true
	# Which key does what is said in the tutorial and nowhere else: on the bench the prompt
	# names the state, not the key.
	hud.wrench_used = _wrench_used or not lesson
	var fingers := PickTouch.active
	if lesson and fingers:
		# Names the control the player actually has: on touch the wrench is the slider.
		hud.tension_hint = "drag the wrench up, then hold strike and let go" if gun else "drag the wrench up the left edge"
	elif lesson:
		hud.tension_hint = "hold [Q] for tension, then hold and release [space]" if gun else "hold [Q] to turn the wrench"
	else:
		hud.tension_hint = "nothing in the lock moves until it is under tension"
	hud.restart_hint = "tap pause, then restart" if fingers else "press [R] for a fresh pick"
	hud.held_hint = ""
	if lesson and fingers and not gun and not pins.touch.used_both_thumbs:
		# The grip that makes this playable, taught until it has happened once.
		hud.held_hint = "the wrench stays where you leave it — both thumbs are free"
	if session.plug_free:
		hud.held_hint = "every pin is up — the sidebar is not: ease each pin into its gate" \
			if rig.has_sidebar() and not rig.sidebar_ok() else "every pin is up — turn the wrench"
	# The bodies chatter at a scale no hand would feel. What is shown is what a hand would:
	# eased over a few frames, and a number that only changes when it has really moved.
	_force.follow(session.pick_force, _dt)
	_resistance.follow(session.pick_resistance, _dt)
	_strain.follow(clampf(session.pick_give / PinSession.GIVE, 0.0, 1.0) if session.pick_force > 0.6 else 0.0, _dt)
	_turn.follow(rig.shift(), _dt)
	hud.pick_force = _force.shown
	hud.resistance = _resistance.shown
	hud.strain = _strain.shown
	hud.dots = rig.states
	hud.dot_mode = "full" if colored else "progress"
	# The word is a verdict, not a reading: Training gets it, and only once the pin is being
	# pushed — resting the tip under a pin tells a hand nothing.
	if colored:
		var under := session.pick_chamber
		if under < 0:
			hud.state_word = "no contact"
			hud.state_ink = Pal.INK_LIGHT
		elif session.pick_force < 0.01:
			hud.state_word = "push to feel"
			hud.state_ink = Pal.INK_LIGHT
		else:
			hud.state_word = ["free", "binding", "false set", "set", "overset"][rig.states[under]]
			hud.state_ink = Pal.state_text_color(rig.states[under])
	else:
		hud.state_word = ""
		hud.state_ink = Pal.INK
	var open_at := rig._last_bind + LockRig.OPEN_PAST
	hud.plug_turned = clampf(_turn.shown / (open_at / 0.98), 0.0, 1.0)
	hud.plug_turning_back = _turn.value < _last_shift - 2e-4 and not is_open()
	_last_shift = _turn.value
	if rig.has_sidebar():
		var gated := 0
		var met := 0
		for i in rig.count:
			if not (rig.gates[i] as Array).is_empty():
				gated += 1
				if rig.aligned[i]:
					met += 1
		hud.sidebar = [gated, met]
		hud.sidebar_dropped = rig.sidebar_ok()
	else:
		hud.sidebar = []
	# The front view has the left gutter — right of the wrench slider while fingers are playing.
	var left := PickTouch.CLEAR_LEFT if fingers else 24.0
	# Under the key legend in a lesson; otherwise it takes the whole gutter: the one view that
	# shows the plug turning and the pin pinched, drawn as large as the page allows.
	var top := PickHud.legend_bottom(hud.keys.size()) + 16.0 if lesson else FRONT_TOP
	front.position = Vector2(left, top)
	front.size = Vector2(pins.side_x0() - left - 20.0, 1080.0 - 160.0 - 10.0 - top)


func _feed_discs() -> void:
	var hand := discs.session
	var pack := hand.rig
	var colored := discs.colored
	var fingers := PickTouch.active
	hud.shackle = false
	hud.plug_word = "sleeve"
	hud.keys = _legend() if lesson else []
	hud.assembly_left = discs.side_x0() - DiscArt.FACE_T * DiscLockView.SIDE_PX
	hud.tension = hand.tension
	hud.pressure_step = discs.wrench_step()
	if hand.tension > 0.0:
		_wrench_used = true
	hud.wrench_used = _wrench_used or not lesson
	if lesson and fingers:
		hud.tension_hint = "drag the wrench up the left edge"
	elif lesson:
		hud.tension_hint = "hold [Q] to turn the wrench"
	else:
		hud.tension_hint = "no disc binds until the sleeve is under tension"
	hud.idle_hint = "the bar only comes down on the discs while the sleeve is being turned"
	hud.rest_hint = "the bar rests on one disc at a time — that disc turns stiff"
	hud.restart_hint = "tap pause, then restart" if fingers else "press [R] for a fresh pick"
	hud.held_hint = ""
	if lesson and fingers and not discs.touch.used_both_thumbs:
		hud.held_hint = "the wrench stays where you leave it — both thumbs are free"
	_force.follow(hand.pick_force, _dt)
	_resistance.follow(hand.pick_resistance, _dt)
	_strain.follow(hand.pick_give if hand.pick_force > 0.9 else 0.0, _dt)
	_turn.follow(pack.shift(), _dt)
	hud.pick_force = _force.shown
	hud.resistance = _resistance.shown
	hud.strain = _strain.shown
	hud.dots = pack.states
	hud.dot_mode = "full" if colored else "progress"
	if colored:
		var under := hand.pick_chamber
		if under < 0:
			hud.state_word = "no contact"
			hud.state_ink = Pal.INK_LIGHT
		elif hand.pick_force < 0.01:
			hud.state_word = "turn to feel"
			hud.state_ink = Pal.INK_LIGHT
		else:
			hud.state_word = ["free", "binding", "false gate", "set", "past its gate"][pack.states[under]]
			hud.state_ink = Pal.state_text_color(pack.states[under])
	else:
		hud.state_word = ""
		hud.state_ink = Pal.INK
	var open_at := pack.free_at + DiscRig.OPEN_PAST
	hud.plug_turned = clampf(_turn.shown / (open_at / 0.98), 0.0, 1.0)
	hud.plug_turning_back = _turn.value < _last_shift - 2e-4 and not is_open()
	_last_shift = _turn.value
	# The bar is this lock's sidebar, and its lamp says how many discs it has dropped into.
	var down := 0
	for i in pack.count:
		if pack.states[i] == LockRig.SET:
			down += 1
	hud.sidebar = [pack.count, down]
	hud.sidebar_dropped = pack.opened or pack.shift() >= pack.free_at
	# The front view has the left gutter — right of the wrench slider while fingers are playing;
	# under the key legend in a lesson.
	var left := PickTouch.CLEAR_LEFT if fingers else 24.0
	var top := PickHud.legend_bottom(hud.keys.size()) + 16.0 if lesson else FRONT_TOP
	disc_front.position = Vector2(left, top)
	disc_front.size = Vector2(hud.assembly_left - left - 20.0, 1080.0 - 160.0 - 10.0 - top)


func _feed_wheels() -> void:
	var h: Dictionary = wheels.call("hud")
	hud.shackle = true
	hud.keys = h.get("legend", []) if lesson else []
	hud.assembly_left = 600.0
	hud.tension = float(h.get("tension", 0.0))
	if hud.tension > 0.0:
		_wrench_used = true
	hud.wrench_used = _wrench_used or not lesson
	hud.tension_hint = str(h.get("tension_hint", "hold [Q] to pull the shackle")) if lesson 		else "no wheel drags until the shackle is pulled"
	hud.restart_hint = "press [R] for a fresh pack"
	hud.held_hint = str(h.get("hint", ""))
	hud.resistance = float(h.get("resistance", 0.0))
	hud.state_word = ""
	hud.dot_mode = "none"
	hud.sidebar = []
