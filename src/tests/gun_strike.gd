extends SceneTree
## Headless: what a snap-gun strike does to the pins, whatever the luck.
##
## A harder strike must throw the pins visibly higher; nothing a strike did not set may be left
## hanging where it was thrown — a driver the plug is pinching least of all, or quick taps walk
## it up its chamber; no key pin may cross its line; and hammering the trigger must not fire
## faster than a strike takes.
##
##   godot --headless --path src --fixed-fps 60 -s res://tests/gun_strike.gd

const SLUG := "kestrel-door-cylinder"
const POWERS: Array[float] = [0.15, 0.5, 1.0, 1.5]

var _failures := 0
var _checks := 0
var _session: PinSession


func _initialize() -> void:
	_run.call_deferred()


func _check(ok: bool, what: String, detail: String = "") -> void:
	_checks += 1
	if not ok:
		_failures += 1
	print("%s %s%s" % ["ok   " if ok else "FAIL ", what, (" — " + detail) if detail != "" else ""])


func _fresh(lock_seed: int, step: int) -> void:
	if _session != null:
		_session.queue_free()
	_session = PinSession.new()
	_session.gun = true
	root.add_child(_session)
	_session.start(Roster.by_slug(SLUG), lock_seed)
	_session.in_chamber = _session.rig.count - 1
	_session.in_tension_held = step > 0
	_session.in_tension_level = PinSession.tension_for_step(maxi(1, step))
	# The needle slides in under every pin before anything is struck.
	await _wait(0.6)


func _wait(seconds: float) -> void:
	for i in maxi(1, roundi(seconds * Engine.physics_ticks_per_second)):
		await physics_frame


## Strike, and watch for `seconds`: the highest each unset driver got, and the nearest any key
## pin's top came to its line (positive = across it).
func _strike_and_watch(power: float, seconds: float) -> Dictionary:
	var rig := _session.rig
	var top := 0.0
	var key_over := -9.0
	var overset := false
	var was_set: Array[bool] = []
	for i in rig.count:
		was_set.append(rig.states[i] == LockRig.SET)
	_session.strike(power)
	for k in roundi(seconds * Engine.physics_ticks_per_second):
		await physics_frame
		for i in rig.count:
			if not was_set[i] and rig.states[i] != LockRig.SET:
				top = maxf(top, rig.driver_lift(i))
			key_over = maxf(key_over, rig.key_lift(i) - float(rig.chambers[i]["set_lift"]))
			overset = overset or rig.states[i] == LockRig.OVERSET
	return {"top": top, "key_over": key_over, "overset": overset}


## The highest any driver that is not set is sitting, mm above its rest.
func _hanging() -> float:
	var rig := _session.rig
	var high := 0.0
	for i in rig.count:
		if rig.states[i] != LockRig.SET:
			high = maxf(high, rig.driver_lift(i))
	return high


func _run() -> void:
	# ── A harder strike is a higher jump ──
	var tops: Array[float] = []
	var worst_key := -9.0
	var any_overset := false
	var left_up := 0.0
	for power in POWERS:
		# No wrench: nothing can be caught, so every strike shows the whole of its throw.
		await _fresh(3, 0)
		var seen: Dictionary = await _strike_and_watch(power, 0.7)
		tops.append(float(seen["top"]))
		worst_key = maxf(worst_key, float(seen["key_over"]))
		any_overset = any_overset or bool(seen["overset"])
		left_up = maxf(left_up, _hanging())
	var rising := true
	for k in range(1, tops.size()):
		rising = rising and tops[k] > tops[k - 1] + 0.3
	_check(rising, "each harder strike throws the drivers visibly higher",
		"15/50/100/150%% → %.2f / %.2f / %.2f / %.2f mm" % [tops[0], tops[1], tops[2], tops[3]])
	for k in POWERS.size():
		var want := PinSession.throw_for(POWERS[k])
		_check(absf(tops[k] - want) < 0.25, "a %d%% strike throws to its height" % roundi(POWERS[k] * 100.0),
			"%.2f mm of %.2f" % [tops[k], want])
	_check(tops[3] > 2.3, "an overdrawn strike sends them well over every line", "%.2f mm" % tops[3])
	_check(left_up < 0.05, "and every one of them comes back down", "highest left at %.2f mm" % left_up)

	# ── Under the wrench: nothing uncaught is left hanging, the pinched pin least of all ──
	var hung := 0.0
	for lock_seed in [3, 5, 9]:
		await _fresh(lock_seed, 5)
		for power: float in [0.4, 1.0, 1.5, 0.15]:
			var seen: Dictionary = await _strike_and_watch(power, 0.8)
			worst_key = maxf(worst_key, float(seen["key_over"]))
			any_overset = any_overset or bool(seen["overset"])
			hung = maxf(hung, _hanging())
			if _session.rig.opened:
				break
	_check(hung < 0.08, "after a strike no unset driver is left where it was thrown", "highest left at %.2f mm" % hung)
	_check(worst_key < -0.1, "no key pin gets to its line", "nearest %.2f mm under" % -worst_key)
	_check(not any_overset, "and no pin is ever overset by the gun")

	# ── Hammering the trigger ──
	await _fresh(5, 5)
	var rig := _session.rig
	var fired := [0]
	_session.sim_event.connect(func(type: StringName, _data: Dictionary) -> void:
		if type == &"STRIKE":
			fired[0] += 1)
	var peak := 0.0
	var asked := 0
	var ticks_per_tap := Engine.physics_ticks_per_second / 10
	for k in roundi(2.0 * Engine.physics_ticks_per_second):
		if k % ticks_per_tap == 0 and not rig.opened:
			_session.strike(PinSession.TAP_POWER)
			asked += 1
		await physics_frame
		for i in rig.count:
			if rig.states[i] != LockRig.SET:
				peak = maxf(peak, rig.driver_lift(i))
	await _wait(0.8)
	_check(peak < PinSession.throw_for(PinSession.TAP_POWER) + 0.15, "ten taps a second walk no pin up its chamber",
		"highest %.2f mm, a tap throws %.2f" % [peak, PinSession.throw_for(PinSession.TAP_POWER)])
	_check(_hanging() < 0.08, "and when the tapping stops the pins are back down", "%.2f mm" % _hanging())
	_check(fired[0] < asked and fired[0] >= 3, "the gun goes off no faster than a strike takes",
		"%d pulls, %d strikes" % [asked, fired[0]])

	print("---- gun: %d checks, %d failed" % [_checks, _failures])
	quit(1 if _failures > 0 else 0)
