class_name DiscSession
extends Node2D
## One attempt at one disc-detainer lock: the rig, and the hand holding the wrench and the pick.
##
## The player (or a script) says what the hands want — which disc, which way to turn it, the
## wrench and how hard — and this turns that into a hand on one disc and a wrench force each
## physics tick, then reports what changed as the same events the pin lock reports.
##
## The pick reaches in along the keyway to one disc and turns it. A disc has no spring: let go and
## it stays where it is, so the hand's command stays where it was left too.

signal sim_event(type: StringName, data: Dictionary)

# ── The hand ────────────────────────────────────────────────────────────────────────────
## mm of rim per second the hand turns a disc with nothing resisting: a quarter turn in about a
## second and a half.
const TURN_RATE := 9.0
## The hand's give: the turn follows slower the harder the disc pushes back, per N.
const LOAD_GAIN := 1.4
## How far the command may stand off a disc that will not move, mm: the hand's give at full push.
const GIVE := DiscRig.HAND_MAX / DiscRig.HAND_K
## How quickly the hand stops leaning on a disc once it stops turning it, s.
const LET_GO := 0.04
## How long the click holds the hand, s: it feels the bar drop and stops, as it does on a pin. A
## turn still held after that leans on the disc, and leaning is how a disc is carried past its gate.
const CLICK_PAUSE := 0.6
## The tip slides along the keyway no faster than this, mm/s, and must be this close to turn.
const TIP_SLEW := 60.0
const ARRIVE_MM := 0.5
## The pick is out of the lock here, mm before the mouth.
const OUT_Z := -3.0

# ── The wrench ──────────────────────────────────────────────────────────────────────────
## Easing: the sleeve is walked back this fast, mm/s, while the bar is still in the disc in hand.
const COUNTER_RATE := 0.6
## A dip of the dial has to be at least this much to count as easing the wrench.
const DIP_MIN := 0.04
const DIP_SECONDS := 1.0
## What a disc turning free feels like through the pick, N.
const FREE_FEEL := 0.05

# ── What the hands want (set by the screen, or a script) ────────────────────────────────
## Disc the tip is in; -1 when the pick is out of the lock.
var in_chamber := 0
## Which way the hand is turning that disc, -1..1: forward is the way the wrench turns.
var in_turn := 0.0
## Or the turn it is asked to hold the disc at, mm of rim from its back stop; NAN to use `in_turn`.
var in_target := NAN
## The pointer's free position along the keyway, in discs from the first; NAN when the keys drive.
var in_pick_at := NAN
var in_tension_held := false
## The wrench dial, 0..1.
var in_tension_level := 0.0
var in_counter := false

# ── What came of it ─────────────────────────────────────────────────────────────────────
var rig: DiscRig
## Simulated seconds this attempt.
var time := 0.0
## The dial level being applied, 0 with the wrench off.
var tension := 0.0
## How hard the hand is turning, 0..1 of what a hand can.
var pick_force := 0.0
## How hard the disc under the pick pushes back, on the same 0..1 scale.
var pick_resistance := 0.0
## How far the hand is being held off where it asked the disc to be, 0..1 of its give.
var pick_give := 0.0
## Where the tip is along the keyway, mm.
var tip_z := OUT_Z
var pick_chamber := -1
var counter_on := false
## The turn the hand is asking of the disc it holds, mm.
var want := 0.0
var stats := {
	"set_order": [],
	"bind_order": [],
	"oversets": 0,
	"full_resets": 0,
	"false_sets": 0,
	"max_tension": 0.0,
	"elapsed": 0.0,
}

var _last_chamber := -1
var _in_hand := -1
## Seconds left of the hand's stop at a click, and the way it was turning when it stopped.
var _pause := 0.0
var _pause_way := 0.0
var _hold_level := 0.0
var _dip_for := 0.0
var _prev_states: PackedInt32Array = PackedInt32Array()
## Per disc: the false gate it is caught in (an index into its notches), or -1.
var _lie: PackedInt32Array = PackedInt32Array()
## Per disc: the bar has been in its true gate since the wrench last came off.
var _was_in: PackedByteArray = PackedByteArray()
var _last_shift := 0.0
var _opened_said := false


func start(lock_def: Dictionary, lock_seed: int) -> void:
	rig = DiscRig.new()
	rig.name = "Rig"
	add_child(rig)
	rig.build(lock_def, lock_seed)
	_prev_states = rig.states.duplicate()
	_lie.resize(rig.count)
	_lie.fill(-1)
	_was_in.resize(rig.count)
	_was_in.fill(0)
	sim_event.emit(&"ATTEMPT_STARTED", {})


## Where disc i sits along the keyway, mm.
static func disc_z(i: int) -> float:
	return DiscRig.FIRST_Z + DiscRig.PITCH_Z * i


func _disc_under_tip() -> int:
	if tip_z < DiscRig.FIRST_Z - DiscRig.PITCH_Z * 0.6:
		return -1
	var i := roundi((tip_z - DiscRig.FIRST_Z) / DiscRig.PITCH_Z)
	if i < 0 or i >= rig.count:
		return -1
	return i


func _physics_process(delta: float) -> void:
	if rig == null:
		return
	if rig.opened:
		if not _opened_said:
			_opened_said = true
			sim_event.emit(&"LOCK_OPENED", {"time": time})
		return
	time += delta
	var chamber := in_chamber if in_chamber >= 0 and in_chamber < rig.count else -1
	if chamber != _last_chamber:
		if _last_chamber >= 0 or chamber >= 0:
			sim_event.emit(&"PICK_MOVED", {"from": _last_chamber, "to": chamber})
		_last_chamber = chamber

	# Where the hand wants the tip: the pointer's own position when it drives, else the disc's
	# middle; in front of the mouth when the pick is out. A hand slides, it does not jump.
	var at := float(chamber)
	if not is_nan(in_pick_at):
		at = clampf(in_pick_at, 0.0, rig.count - 1.0)
	var tip_want := OUT_Z if chamber < 0 else DiscRig.FIRST_Z + at * DiscRig.PITCH_Z
	tip_z = move_toward(tip_z, tip_want, TIP_SLEW * delta)
	pick_chamber = _disc_under_tip()

	# The hand turns only the disc the tip is in, and only once it has got there.
	var arrived := chamber >= 0 and pick_chamber == chamber and absf(tip_z - disc_z(chamber)) < ARRIVE_MM
	var holding := chamber if arrived else -1
	if holding != _in_hand:
		_in_hand = holding
		_pause = 0.0
		if holding >= 0:
			# A disc is taken hold of where it is: nothing moves because the pick arrived.
			want = rig.turned(holding)
	# The wrench, and the dip that eases it.
	var held := in_tension_held and in_tension_level > 0.0
	var level := in_tension_level if held else 0.0
	if not held:
		_hold_level = 0.0
	elif level > _hold_level:
		_hold_level = level
	var dipping := held and level < _hold_level - DIP_MIN
	_dip_for = _dip_for + delta if dipping else 0.0
	if _dip_for > DIP_SECONDS:
		_hold_level = level
		_dip_for = 0.0
		dipping = false
	# Easing the sleeve back is for the disc the bar has hold of. While the bar is down in a notch
	# of the disc in hand the sleeve walks back and the bar's spring lifts it; the moment the bar
	# is clear of that disc the sleeve is held where it is, so the disc can be turned on, and let
	# go when the easing stops. With no disc caught, easing only holds the sleeve where it is.
	var was_counter := counter_on
	var mode := LockRig.EASE_OFF
	if held and (dipping or in_counter):
		mode = LockRig.EASE_BACK if _in_hand >= 0 and rig.blocked(_in_hand) else LockRig.EASE_HOLD
	counter_on = mode != LockRig.EASE_OFF

	for i in rig.count:
		rig.hand_at[i] = NAN
	if _in_hand >= 0:
		var here := rig.turned(_in_hand)
		if mode == LockRig.EASE_BACK:
			# While the bar is being let up out of this disc the hand does not lean on it: a disc
			# shoved against the bar pins the bar in its notch, and nothing would lift.
			want = here
		else:
			var load := absf(rig.hand_force(_in_hand))
			var rate := TURN_RATE / (1.0 + LOAD_GAIN * load)
			# Which way the hand is being asked to turn it, however it is being asked.
			var way := signf(in_turn)
			if not is_nan(in_target):
				way = signf(clampf(in_target, 0.0, DiscRig.TRAVEL) - want) if absf(in_target - want) > 0.01 else 0.0
			# The stop at a click is for the push that found it: turning the other way, or easing
			# the sleeve, is a decision, and is not held up.
			if _pause > 0.0 and way == _pause_way and not counter_on:
				_pause -= delta
				want = here
			elif not is_nan(in_target):
				_pause = 0.0
				want = move_toward(want, clampf(in_target, 0.0, DiscRig.TRAVEL), rate * delta)
			elif in_turn != 0.0:
				_pause = 0.0
				want = clampf(want + clampf(in_turn, -1.0, 1.0) * rate * delta, 0.0, DiscRig.TRAVEL)
			else:
				_pause = 0.0
				# Nothing is being asked of it: the hand stops leaning, and steadies the disc where
				# it has got to. A disc has no spring to push back against.
				want = lerpf(here, want, exp(-delta / LET_GO))
			# A disc that will not move holds the pick off: the hand gives, and no more than a hand can.
			want = clampf(want, here - GIVE, here + GIVE)
		rig.hand_at[_in_hand] = want
		pick_give = clampf(absf(want - here) / GIVE, 0.0, 1.0)
	else:
		pick_give = 0.0
	rig.wrench = PinSession.wrench_newtons(level) if held else 0.0
	rig.ease_mode = mode
	rig.ease_rate = COUNTER_RATE
	tension = level
	_report(delta, held, was_counter)


## The bar has just dropped into the disc in hand: the hand feels it and stops for a moment.
func _click(i: int) -> void:
	if i != _in_hand or _pause > 0.0:
		return
	var way := signf(want - rig.turned(i))
	if way != 0.0:
		_pause = CLICK_PAUSE
		_pause_way = way


## What the disc under the tip takes to turn, N — known only once it is being turned.
##
## A free disc is only its grease. The disc the bar is resting on also has to slip under the bar,
## and the wrench is what presses the bar down. A disc the bar has dropped into does not turn at
## all: the gate's walls are steel against steel.
func _resistance_under_tip() -> float:
	var i := pick_chamber
	if i < 0:
		return 0.0
	if rig.held(i) and pick_give > 0.9:
		return DiscRig.HAND_MAX
	var need := FREE_FEEL
	if rig.carrier == i:
		# The ramp turns the wrench's push into the bar's press, less the bar's own spring.
		var gain := DiscRig.RAMP_RUN / DiscRig.GROOVE
		need += DiscRig.FRICTION * maxf(0.0, rig.wrench * gain - DiscRig.BAR_SPRING) / (1.0 - DiscRig.FRICTION * gain)
	return need


func _report(delta: float, held: bool, was_counter: bool) -> void:
	var s := rig.shift()
	var force := absf(rig.hand_force(_in_hand)) if _in_hand >= 0 else 0.0
	pick_force = minf(1.0, force / DiscRig.HAND_MAX)
	pick_resistance = minf(1.0, _resistance_under_tip() / DiscRig.HAND_MAX) if pick_force > 0.01 else 0.0
	var lifted: Array[int] = []
	var order: Array = stats["set_order"]
	# A disc let out of its gate on purpose — the wrench off, or the sleeve eased — has not been
	# overset, wherever it is turned to next.
	if not held or counter_on:
		_was_in.fill(0)
	for i in rig.count:
		var was := _prev_states[i]
		var now := rig.states[i]
		# The false gate a disc was last caught in is forgotten once it has turned out from under
		# the bar — and so is its having been in its true gate.
		if _lie[i] >= 0 and rig.notch_over(i) != _lie[i]:
			_lie[i] = -1
		if _was_in[i] == 1 and rig.notch_over(i) < 0:
			_was_in[i] = 0
		if now == was:
			continue
		if now == LockRig.SET:
			# Said once for each time the bar finds the gate: a disc leant part-way up its gate's
			# slope and let slide back was in its gate all along.
			if _was_in[i] == 0:
				sim_event.emit(&"PIN_SET", {"chamber": i, "tension": tension, "what": "disc"})
			if not order.has(i):
				order.append(i)
			_click(i)
		elif now == LockRig.FALSE_SET:
			# One lie is one false set, however the bar chatters on the notch's lip on its way out.
			var notch := rig.notch_over(i)
			if _lie[i] != notch:
				_lie[i] = notch
				sim_event.emit(&"FALSE_SET_ENTERED", {"chamber": i, "depth": maxf(0.0, s - _last_shift), "what": "disc"})
				stats["false_sets"] += 1
				_click(i)
		elif now == LockRig.OVERSET and _was_in[i] == 1:
			# Carried on out of its gate by a hand that kept leaning — up the gate's slope first,
			# and then onto the rim beyond.
			_was_in[i] = 0
			sim_event.emit(&"PIN_OVERSET", {"chamber": i, "what": "disc"})
			stats["oversets"] += 1
		if now == LockRig.SET:
			_was_in[i] = 1
		if was == LockRig.SET and now != LockRig.SET:
			lifted.append(i)
			order.erase(i)
		_prev_states[i] = now
	# The bar came back out of gates it was in. Nothing drops in this lock — the discs are where
	# they were — so it is said as its own event, and it is not a reset.
	if not lifted.is_empty():
		sim_event.emit(&"BAR_LIFTED", {"kind": "counter" if held else "full", "lifted": lifted})
	if rig.binding >= 0 and not (stats["bind_order"] as Array).has(rig.binding):
		(stats["bind_order"] as Array).append(rig.binding)
	stats["max_tension"] = maxf(stats["max_tension"], tension)
	stats["elapsed"] = time
	if counter_on and not was_counter:
		sim_event.emit(&"COUNTER_ROTATION", {"chamber": maxi(0, pick_chamber)})
	if absf(s - _last_shift) > 0.002:
		sim_event.emit(&"PLUG_MOVED", {"shift": s, "velocity": (s - _last_shift) / delta})
	_last_shift = s
