class_name PinWalker
extends RefCounted
## A scripted hand that opens a pin lock through the same inputs a player has.
##
## It works the lock the way the lessons teach it: wrench on, find the pin the plug is leaning
## on, push it until it clicks; a pin caught in a false set is pushed with the plug eased back.
## It reads the rig's binding order rather than feeling for it — it is the "solve it for me",
## not a player — but everything it does goes through PinSession's inputs.

enum { SETTLE, CHOOSE, TRAVEL, PUSH, RELEASE, RUN_OUT, GIVE_UP, GATE }

var session: PinSession
## The wrench step it holds, 1..10.
var step := 5
var phase := SETTLE
var target := -1
var clock := 0.0
var pushes := 0
var idle := 0
var failed := false
var easing := false
var log: Array[String] = []


func _init(pin_session: PinSession, wrench_step: int = 5) -> void:
	session = pin_session
	step = wrench_step
	session.in_chamber = -1
	session.in_lift = 0.0


func _next_target() -> int:
	var rig := session.rig
	var best := -1
	var best_at := INF
	for i in rig.count:
		if rig.states[i] == LockRig.SET:
			continue
		var at: float = rig.chambers[i]["bind_at"]
		if at < best_at:
			best_at = at
			best = i
	return best


func _next_gate() -> int:
	var rig := session.rig
	for i in rig.count:
		if not (rig.gates[i] as Array).is_empty() and not rig.aligned[i]:
			return i
	return -1


func tick(delta: float) -> void:
	var rig := session.rig
	if rig.opened or failed:
		return
	clock += delta
	session.in_tension_held = true
	session.in_tension_level = PinSession.tension_for_step(step)
	session.in_counter = false
	match phase:
		SETTLE:
			if clock > 0.5:
				phase = CHOOSE
		CHOOSE:
			target = _next_target()
			if target < 0:
				# Every pin set: a sidebar may still be holding the plug. Work its gates one by one.
				target = _next_gate()
				if target >= 0:
					session.in_chamber = target
					session.in_lift = 0.0
					phase = GATE
					clock = 0.0
					return
				phase = RUN_OUT
				clock = 0.0
				return
			session.in_chamber = target
			session.in_lift = 0.0
			phase = TRAVEL
			clock = 0.0
		TRAVEL:
			easing = false
			if clock > 0.3:
				phase = PUSH
				clock = 0.0
				pushes += 1
		PUSH:
			session.in_lift = PinSession.LIFT_CEILING
			var st := rig.states[target]
			# A caught pin is pushed with the plug eased back; once it has been caught, the ease
			# is kept on until the pin is through.
			if st == LockRig.FALSE_SET:
				easing = true
			session.in_counter = easing
			if st == LockRig.SET:
				log.append("set %d at %.2fs" % [target, session.time])
				phase = RELEASE
				clock = 0.0
				idle = 0
			elif st == LockRig.OVERSET or clock > 5.0:
				log.append("%s %d at %.2fs" % ["overset" if st == LockRig.OVERSET else "stuck", target, session.time])
				idle += 1
				phase = RELEASE
				clock = 0.0
				if st == LockRig.OVERSET or idle > 3:
					phase = GIVE_UP
		RELEASE:
			session.in_lift = 0.0
			if clock > 0.6:
				phase = CHOOSE
				if pushes > 12 * rig.count:
					failed = true
		GATE:
			# Lift the set chamber's key pin slowly back up until it is in its gate, then hold
			# still — the sidebar's leg needs a moment to drop in.
			if rig.aligned[target] or clock > 6.0:
				session.in_lift = 0.0
				phase = RELEASE
				clock = 0.0
			elif clock > 0.3 and not rig.in_gate(target):
				session.in_lift = minf(PinSession.LIFT_CEILING, session.in_lift + PinSession.KEY_LIFT_RATE * 0.3 * delta)
		RUN_OUT:
			session.in_chamber = -1
			session.in_lift = 0.0
			if clock > 2.0:
				failed = true
		GIVE_UP:
			# Start over, as a hand does: wrench off, pick out, every pin drops.
			session.in_tension_held = false
			session.in_chamber = -1
			session.in_lift = 0.0
			if clock > 0.8:
				idle = 0
				phase = SETTLE
				clock = 0.0
