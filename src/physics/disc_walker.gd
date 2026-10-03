class_name DiscWalker
extends RefCounted
## A scripted hand that opens a disc-detainer lock through the same inputs a player has.
##
## It works the lock the way the lessons teach it: wrench on, find the disc the bar is resting
## on, turn it until the bar drops in; a disc caught in a false gate is turned on with the sleeve
## eased back. It reads the rig's binding disc and where each gate is rather than feeling for
## them — it is the "solve it for me", not a player — but everything it does goes through
## DiscSession's inputs.

enum { SETTLE, CHOOSE, TRAVEL, TURN, RUN_OUT, GIVE_UP }

var session: DiscSession
## The wrench step it holds, 1..10.
var step := 5
var phase := SETTLE
var target := -1
var clock := 0.0
var turns := 0
var idle := 0
var failed := false
var easing := false
var log: Array[String] = []


func _init(disc_session: DiscSession, wrench_step: int = 5) -> void:
	session = disc_session
	step = wrench_step
	session.in_chamber = -1
	session.in_turn = 0.0
	session.in_target = NAN


## The disc to work next: the one the bar is resting on, else one a false gate has hold of.
func _next_target() -> int:
	var rig := session.rig
	if rig.binding >= 0:
		return rig.binding
	for i in rig.count:
		if rig.states[i] == LockRig.FALSE_SET:
			return i
	return -1


func _all_set() -> bool:
	var rig := session.rig
	for i in rig.count:
		if rig.states[i] != LockRig.SET:
			return false
	return true


func tick(delta: float) -> void:
	var rig := session.rig
	if rig.opened or failed:
		return
	clock += delta
	session.in_tension_held = true
	session.in_tension_level = PinSession.tension_for_step(step)
	session.in_counter = false
	session.in_turn = 0.0
	match phase:
		SETTLE:
			if clock > 0.5:
				phase = CHOOSE
				clock = 0.0
		CHOOSE:
			if _all_set():
				phase = RUN_OUT
				clock = 0.0
				return
			target = _next_target()
			if target < 0:
				# The bar is still on its way down, or the sleeve has not come up to it yet.
				if clock > 2.0:
					phase = GIVE_UP
					clock = 0.0
				return
			session.in_chamber = target
			easing = false
			phase = TRAVEL
			clock = 0.0
		TRAVEL:
			if clock > 0.25:
				phase = TURN
				clock = 0.0
				turns += 1
		TURN:
			var st := rig.states[target]
			if st == LockRig.SET:
				log.append("set %d at %.2fs" % [target, session.time])
				phase = CHOOSE
				clock = 0.0
				idle = 0
				return
			# A disc a false gate has hold of is turned on with the sleeve eased back, and the ease
			# is kept on until that notch has gone out from under the bar.
			if st == LockRig.FALSE_SET:
				if not easing:
					log.append("false gate on %d at %.2fs" % [target, session.time])
				easing = true
			elif not rig.over_lie(target):
				easing = false
			session.in_counter = easing
			var to_go := rig.gate_turn(target) - rig.turned(target)
			session.in_turn = signf(to_go) if absf(to_go) > 0.02 else 0.0
			if clock > 8.0:
				log.append("stuck on %d at %.2fs" % [target, session.time])
				idle += 1
				phase = GIVE_UP if idle > 2 else CHOOSE
				clock = 0.0
		RUN_OUT:
			session.in_chamber = -1
			if clock > 2.0:
				# Not open after all: something still has the bar.
				phase = CHOOSE
				clock = 0.0
				idle += 1
				if idle > 4:
					failed = true
		GIVE_UP:
			# Start over, as a hand does: wrench off, the bar lifts, and the discs stay where they are.
			session.in_tension_held = false
			session.in_chamber = -1
			if clock > 0.8:
				phase = SETTLE
				clock = 0.0
				if turns > 14 * rig.count:
					failed = true
