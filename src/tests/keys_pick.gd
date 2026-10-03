extends SceneTree
## Headless: pick locks through the real app with real key events — Q held, arrows to the
## binding pin, Space until it sets, C when a spool lies. The scripted hand in `walk_roster`
## drives the session directly; this proves the keyboard reaches it.
##
##   godot --headless --path godot --fixed-fps 60 -s res://tests/keys_pick.gd -- [slug,slug…]

var _app: Node
var _queue: PackedStringArray
var _held := {}
var _for := 0.0
var _tap_wait := 0.0
var _failures := 0
var _slug := ""
var _gunning := false
var _gun_done := false
var _hold := 0.0
var _want := 1.2
var _round := 0
var _powers: Array[float] = []


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	_queue = (args[0] if args.size() > 0 else "brasswell-no1-luggage,northgate-5-pin-cabinet,ironhold-spool-trainer").split(",")
	var scene: PackedScene = load("res://main.tscn")
	_app = scene.instantiate()
	_app.progress = Progress.new(SaveStore.memory())
	root.add_child(_app)
	physics_frame.connect(_tick)


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


func _tick() -> void:
	var dt := 1.0 / Engine.physics_ticks_per_second
	_for += dt
	var pick: PickScreen = _app.pick
	if pick == null or pick.pins == null or _app.screen_name != &"pick" or pick.is_open():
		if pick != null and pick.is_open():
			print("OPEN  %-28s t=%5.1fs oversets=%d false=%d" % [_slug, pick.elapsed(), pick.stats()["oversets"],
				pick.stats()["false_sets"]])
		for code: Key in _held.keys():
			_key(code, false)
		if _queue.is_empty() and not _gun_done:
			# Last: the snap gun, by its own key — held to draw the needle back, let go to strike.
			_gun_done = true
			_gunning = true
			_slug = "kestrel-door-cylinder"
			_app.update_settings({"assist": "training"})
			_app.start_lock(Roster.by_slug(_slug), -1, false, true)
			_app.pick.pins.session.sim_event.connect(func(type: StringName, data: Dictionary) -> void:
				if type == &"STRIKE":
					_powers.append(float(data["power"]))
				if OS.get_environment("KEYS_TRACE") != "" and type != &"PLUG_MOVED" and _powers.size() < 14:
					var rig0: LockRig = _app.pick.pins.session.rig
					print("  %.2f %s %s tension=%.2f states=%s" % [_app.pick.pins.session.time, type, str(data),
						_app.pick.pins.session.tension, str(rig0.states)]))
			_for = 0.0
			_hold = 0.0
			return
		if _queue.is_empty():
			if _gun_done:
				var soft := 1.0
				var hard := 0.0
				for power in _powers:
					soft = minf(soft, power)
					hard = maxf(hard, power)
				# A hold past 0.9 s must strike harder than a full strike.
				var varied := hard - soft > 0.3 and hard > 1.05
				print("%s  %d strikes, from %d%% to %d%% — a longer hold strikes harder" % ["GUN  " if varied else "FAIL ",
					_powers.size(), roundi(soft * 100.0), roundi(hard * 100.0)])
				if not varied:
					_failures += 1
			print("---- keys: %d failed" % _failures)
			quit(1 if _failures > 0 else 0)
			return
		_gunning = false
		_slug = _queue[0]
		_queue.remove_at(0)
		_app.update_settings({"assist": "training"})
		_app.start_lock(Roster.by_slug(_slug))
		_for = 0.0
		if OS.get_environment("KEYS_TRACE") != "":
			var watched: PinSession = _app.pick.pins.session
			watched.sim_event.connect(func(type: StringName, data: Dictionary) -> void:
				if type != &"PLUG_MOVED":
					print("  %.3f %s %s lift=%.2f space=%s" % [watched.time, type, str(data), watched.lift,
						str(_held.get(KEY_SPACE, false))]))
		return
	if _for > 90.0:
		_failures += 1
		print("FAIL  %-28s still shut after 90 s" % _slug)
		_app.abandon_lock()
		return
	var view := pick.pins
	var session := view.session
	var rig := session.rig
	if _gunning:
		# A light wrench, the needle under every pin, and holds of three lengths in turn.
		_app.pick.pins.tension_level = PinSession.tension_for_step(3)
		_key(KEY_Q, true)
		if view.get("_key_chamber") < rig.count - 1:
			_tap_wait -= dt
			if _tap_wait <= 0.0:
				_tap(KEY_RIGHT)
				_tap_wait = 0.08
			return
		_hold += dt
		if _hold < _want:
			_key(KEY_SPACE, true)
		elif _hold < _want + 0.35:
			_key(KEY_SPACE, false)
		else:
			# The next strike: long, short, middling, in turn.
			_hold = 0.0
			_round += 1
			_want = [1.2, 0.3, 0.7][_round % 3]
		return
	_key(KEY_Q, true)
	_tap_wait -= dt
	# The pin to work: one the plug has trapped (a false set), else the one it is pinching.
	var target := rig.binding
	for i in rig.count:
		if rig.states[i] == LockRig.FALSE_SET:
			target = i
			break
	if target < 0:
		_key(KEY_SPACE, false)
		_key(KEY_C, false)
		return
	var at: int = view.get("_key_chamber")
	if at != target:
		_key(KEY_SPACE, false)
		_key(KEY_C, false)
		if _tap_wait <= 0.0:
			_tap(KEY_RIGHT if target > at else KEY_LEFT)
			_tap_wait = 0.08
		return
	# Under it: push, and ease the plug back while the pin is lying about being set.
	_key(KEY_SPACE, true)
	_key(KEY_C, rig.states[target] == LockRig.FALSE_SET or session.counter_on)
