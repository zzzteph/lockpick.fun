class_name PinSession
extends Node2D
## One attempt at one pin-tumbler lock: the rig, the pick, and the hand holding both tools.
##
## The player (or a script) says what the hands want — which pin, how high, the wrench and how
## hard — and this turns that into a pick pose and a wrench force each physics tick, then reports
## what changed as the events the rest of the game listens to.
##
## The pick is the hook's own outline, moved by the hand. It does not shove the pins as a body
## — a pick works along the keyway, across the direction the plug pinches in — so each key pin
## is held up to whatever steel is under its tip (the outline's top edge there) by the hand's
## spring: stiff, and no stronger than a hand.

signal sim_event(type: StringName, data: Dictionary)

# ── The hand ────────────────────────────────────────────────────────────────────────────
## mm of lift per second while the push is held, with nothing resisting.
const KEY_LIFT_RATE := 4.2
## The hand's give: the lift follows the command slower the harder the lock pushes back.
const LOAD_GAIN := 0.6
## How long the click holds the hand, s: it feels the pin give and stops. A push still held
## after that leans on the set pin, and leaning is how a pin gets overset.
const CLICK_PAUSE := 0.6
## How close the tip must be to a pin's centre, mm, before the lift may rise: down, across, up.
const ARRIVE_MM := 0.4
## The tip slides along the keyway no faster than this, mm/s.
const TIP_SLEW := 60.0
## The pick is out of the lock here, mm before the mouth.
const OUT_X := -3.0
## How far under the key pins the hook rides while it is not pushing, mm.
const PASS_CLEARANCE := 0.4
## How far past the last pin the tip can go, mm: the keyway is closed at the back.
const BACK_REACH := 0.8
## How far either side of a bore's centre the tip can be and still go up into it, mm: the slot
## in the keyway's roof, less the tip's own width.
const BORE_MOUTH := LockRig.SLOT_HALF - 0.4
## The most the tip can be raised between bores, mm of lift: just under the keyway's roof.
const ROOF_LIFT := PASS_CLEARANCE + LockRig.KEY_TIP * (LockRig.SLOT_HALF - LockRig.KEY_TIP_HALF) 	/ (LockRig.PIN_R - LockRig.KEY_TIP_HALF) - 0.15
## The most the hand asks the tip to rise, mm.
const LIFT_CEILING := 3.5
## The most the steel may be asked to stand inside a pin that will not move, mm: the hand's
## give at full push.
const GIVE := LockRig.HAND_MAX / LockRig.HAND_K

# ── The wrench ──────────────────────────────────────────────────────────────────────────
const TENSION_STEPS := 10
const TENSION_MIN_STEP := 0.12
const TENSION_MAX_STEP := 0.95
## Counter-rotation: the plug is eased back this fast, mm/s, while a caught pin is pushed.
const COUNTER_RATE := 0.6
## A pin that takes more than this through the pick, N, and still does not move is caught.
const BLOCKED_N := 3.5
## A dip of the dial has to be at least this much to count as easing the wrench.
const DIP_MIN := 0.04
## How long a dip counter-rotates before the lower pressure simply becomes the wrench.
const DIP_SECONDS := 1.0
const PLUG_RADIUS := 6.35

## The hook: a 1 mm shank, the tip 3.3 mm over its underside. Handle at the origin, mm, y up.
const PICK_REACH := 60.0
const HOOK: Array[Vector2] = [
	Vector2(0, -0.5),
	Vector2(60.0, -0.5),
	Vector2(60.25, 0.4),
	Vector2(60.3, 2.3),
	Vector2(60.05, 3.1),
	Vector2(59.75, 3.3),
	Vector2(59.4, 3.2),
	Vector2(58.55, 0.5),
	Vector2(0, 0.5),
]
const HOOK_TIP := 5

# ── What the hands want (set by the screen, or a script) ────────────────────────────────
## Chamber the tip is under; -1 when the pick is out of the lock.
var in_chamber := 0
## Lift target for that chamber, mm.
var in_lift := 0.0
## The mouse's free position along the keyway, in chambers from pin 1; NAN when the keys drive.
var in_pick_at := NAN
var in_tension_held := false
## The wrench dial, 0..1.
var in_tension_level := 0.0
var in_counter := false
## The snap gun is in hand instead of the hook.
var gun := false

# ── What came of it ─────────────────────────────────────────────────────────────────────
var rig: LockRig
## Simulated seconds this attempt.
var time := 0.0
## The dial level being applied, 0 with the wrench off.
var tension := 0.0
## The lift the hand has reached, mm above rest.
var lift := 0.0
## How hard the hand is pushing, 0..1 of what a hand can.
var pick_force := 0.0
## How hard the pin under the tip pushes back, on the same 0..1 scale.
var pick_resistance := 0.0
## How far the steel is being held off where it was asked to be, mm.
var pick_give := 0.0
## Where the tip is, mm.
var tip := Vector2.ZERO
var pick_chamber := -1
var plug_free := false
var _free_for := 0.0
var counter_on := false
var stats := {
	"set_order": [],
	"bind_order": [],
	"oversets": 0,
	"full_resets": 0,
	"false_sets": 0,
	"max_tension": 0.0,
	"elapsed": 0.0,
}

var _tip_x := OUT_X
var _pause := 0.0
var _last_chamber := -1
var _hold_level := 0.0
var _dip_for := 0.0
## The pin being worked through with the plug eased back, or -1.
var _easing := -1
var _prev_states: PackedInt32Array = PackedInt32Array()
var _last_shift := 0.0
var _opened_said := false
var _rest_y := 0.0
var _tip_bottom_rest := 0.0
## The snap gun: seconds left of the current strike, which pins it reached and which of those
## were lucky; the gun's own luck stream, seeded off the lock.
## The height of the hook's top edge above its tip (mm, so mostly negative), sampled every
## PROFILE_STEP mm back from PROFILE_AHEAD in front of the tip. NAN where there is no steel.
var _profile: PackedFloat32Array = PackedFloat32Array()
const PROFILE_STEP := 0.02
const PROFILE_AHEAD := 1.0
const PROFILE_BEHIND := 34.0
var _strike_left := 0.0
var _strike_phase := STRIKE_IDLE
## A strike asked for while one was in the air: how hard, or negative for none.
var _strike_queued := -1.0
var _struck: Array[bool] = []
var _lucky: Array[bool] = []
var _hit: Array[bool] = []
var _gun_rng: Rng
var gun_used := false
## How high the strike in progress throws, mm.
var _throw := 0.0


## Step `n` of the ten-step dial as a tension level.
static func tension_for_step(step: int) -> float:
	var t := float(clampi(step, 1, TENSION_STEPS) - 1) / float(TENSION_STEPS - 1)
	return TENSION_MIN_STEP + (TENSION_MAX_STEP - TENSION_MIN_STEP) * t


## The nearest step to a tension level.
static func step_for_tension(level: float) -> int:
	var t := (level - TENSION_MIN_STEP) / (TENSION_MAX_STEP - TENSION_MIN_STEP)
	return clampi(roundi(t * (TENSION_STEPS - 1)) + 1, 1, TENSION_STEPS)


## The dial as the wrench's force at the plug's rim, N: 6 N·mm at step 1, 10.8 at the default
## step 5, 20 at the top — straight lines between — over the plug's radius.
static func wrench_newtons(level: float) -> float:
	var l0 := tension_for_step(1)
	var l1 := tension_for_step(5)
	var l2 := tension_for_step(10)
	var frac := 0.34
	if level <= l0:
		frac = 0.1
	elif level <= l1:
		frac = 0.1 + (level - l0) / (l1 - l0) * 0.08
	elif level <= l2:
		frac = 0.18 + (level - l1) / (l2 - l1) * 0.16
	return frac * 60.0 / PLUG_RADIUS


func start(lock_def: Dictionary, lock_seed: int) -> void:
	rig = LockRig.new()
	rig.name = "Rig"
	add_child(rig)
	rig.build(lock_def, lock_seed)
	_tip_bottom_rest = float(rig.chambers[0]["key_rest_y"]) - float(rig.chambers[0]["key_len"]) / 2.0 - LockRig.KEY_TIP
	_rest_y = _tip_bottom_rest - PASS_CLEARANCE
	_prev_states = rig.states.duplicate()
	_gun_rng = Rng.create(lock_seed ^ 0x5F356495)
	for i in rig.count:
		_struck.append(false)
		_lucky.append(false)
		_hit.append(false)
	_build_pick_profile()
	_place_pick()
	sim_event.emit(&"ATTEMPT_STARTED", {})


## Measure the hook's top edge once: for each position along the blade, the highest point of
## its outline there.
func _build_pick_profile() -> void:
	var tip := HOOK[HOOK_TIP]
	var n := int((PROFILE_AHEAD + PROFILE_BEHIND) / PROFILE_STEP) + 1
	_profile.resize(n)
	for k in n:
		var x := tip.x + PROFILE_AHEAD - k * PROFILE_STEP
		var top := -INF
		for e in HOOK.size():
			var a := HOOK[e]
			var b := HOOK[(e + 1) % HOOK.size()]
			if (x < minf(a.x, b.x)) or (x > maxf(a.x, b.x)):
				continue
			var y := a.y if absf(b.x - a.x) < 1e-9 else a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x)
			if absf(b.x - a.x) < 1e-9:
				y = maxf(a.y, b.y)
			top = maxf(top, y)
		_profile[k] = top - tip.y if top > -INF else NAN


## The top of the steel `along` mm from the tip (negative is back toward the hand), as a height
## relative to the tip; NAN where the pick is not.
func _steel(along: float) -> float:
	var k := int(round((PROFILE_AHEAD - along) / PROFILE_STEP))
	if k < 0 or k >= _profile.size():
		return NAN
	return _profile[k]


## The lift a chamber's set pin needs, for scripts and the HUD: the tip has to cover the pass
## clearance before it touches the pin at all.
func lift_for_set(i: int) -> float:
	return float(rig.chambers[i]["set_lift"]) + PASS_CLEARANCE


func chamber_x(i: int) -> float:
	return float(rig.chambers[i]["x"])


## Where a key pin looks for steel under it, mm either side of its centre: across the tip's
## flat and up its cone for the hook, a single look for the shank.
const TIP_SAMPLES: Array[float] = [-1.2, -0.8, -0.45, 0.0, 0.45, 0.8, 1.2]
const SHANK_SAMPLES: Array[float] = [0.0]
## Below this lift the shank clears every pin behind the tip.
const SHANK_LIFT := 2.9

## How far past its tip the snap needle still reaches, mm.
const NEEDLE_REACH := 0.6
## A strike, start to finish, s. Up: the blade throws every pin it reaches, for no longer than
## this. Down: what will not be caught comes back under its line, and is given this long to. Catch:
## the plug gets this long to slide under whatever is still hanging.
const STRIKE_UP := 0.14
const STRIKE_DOWN := 0.25
const STRIKE_CATCH := 0.13
enum { STRIKE_IDLE, STRIKE_RISING, STRIKE_FALLING, STRIKE_CATCHING, STRIKE_HOMING }
## The chance each jumped pin is thrown high enough to be caught — the luck of a snap gun.
## How long every pin must have been up, with the plug still held, before it is called out, s.
const PLUG_FREE_AFTER := 0.35
const CATCH_CHANCE := 0.7
## How high the gun throws a driver, mm of lift: at the lightest strike, and at a full one (100%)
## — which is high enough to clear the deepest-cut pin there is (2.225 mm under its line).
const THROW_MIN := 0.7
const THROW_FULL := 2.4
## The needle can be drawn back past full, to this many times a full strike. No pin needs the
## height; what the extra buys is a shove that carries a driver over under a heavier wrench.
const MAX_POWER := 1.5
## A thrown driver must clear the line by this much to be caught at all, mm.
const THROW_CLEAR := 0.1
## A driver thrown past its line is likelier to bounce back down the further past it goes: its
## chance falls away over this many mm, to no less than `THROW_FLOOR` of what a throw that just
## clears is worth. A hard strike is never useless — it is a blunter one.
const THROW_WASTE := 2.0
const THROW_FLOOR := 0.8
## The needle strikes the key pins, and they jump with it: this much of the throw, and never
## nearer the line than `KEY_UNDER` mm — a key pin across the line would be a pin overset.
const KEY_THROW := 0.8
## The most a caught driver hangs above its line, mm, while the plug comes under it.
const CATCH_HANG := 0.9
## How far past its line a caught driver is thrown at the least, mm.
const CATCH_OVER := 0.35
const KEY_UNDER := 0.35
## A strike with no draw behind it — a tap — is this hard, 0..1.
const TAP_POWER := 0.15
## How hard the lightest strike shoves, as a share of a full one's shove, and how much each
## whole strike past full adds. The shove is what a pinched driver answers to: under the wrench's
## middle pressures any strike lifts it, under a heavy one only a full strike does, and under the
## heaviest only the needle drawn back past full. That is what the last half of its travel is
## for — it throws no pin higher than it needs to go.
const SHOVE_MIN := 0.7
const SHOVE_OVER := 0.6


## How high a strike of `power` (0..MAX_POWER, 1 = full) throws a driver, mm.
static func throw_for(power: float) -> float:
	return THROW_MIN + (THROW_FULL - THROW_MIN) * clampf(power, 0.0, MAX_POWER)


## The snap gun: one flick of the blade under every pin the needle reaches, as hard as the needle
## was drawn back (`power`, 0..MAX_POWER). The pins jump — all as high as the strike throws them,
## because one blade throws them, so a harder strike is a higher jump, over the line and on up
## the chamber. Most come straight back down. A plain driver thrown clear of its line may hang
## there an instant, and a wrench held light enough slides the plug under it: a throw that falls
## short of the line catches nothing, one that just clears it has the best chance, and one that
## sails well past it a slightly lesser one. So a deep-cut pin needs a hard strike, and a hard
## strike at everything opens the lock. A security pin only jiggles — its driver would catch on
## a waist or a notch, and a snap gun is beaten by them.
##
## A strike is one whole motion — up, back down, the catch — and the gun cannot go off again
## until it is over: a trigger pulled in the middle of one is kept, and goes off when it ends.
func strike(power: float = 1.0) -> void:
	if rig == null or rig.opened:
		return
	if _strike_phase != STRIKE_IDLE:
		_strike_queued = power
		return
	gun_used = true
	_strike_phase = STRIKE_RISING
	_strike_left = STRIKE_UP
	_throw = throw_for(power)
	# A harder strike is a harder shove as well as a higher throw.
	rig.strike_force = SHOVE_MIN + (1.0 - SHOVE_MIN) * clampf(power, 0.0, 1.0) + SHOVE_OVER * clampf(power - 1.0, 0.0, MAX_POWER - 1.0)
	for i in rig.count:
		var reached := chamber_x(i) <= _tip_x + NEEDLE_REACH
		var st := rig.states[i]
		_struck[i] = reached and st != LockRig.SET and st != LockRig.OVERSET
		# The blade is under every key pin it reaches, set or not: they all jump.
		_hit[i] = reached and st != LockRig.OVERSET
		var past := _throw - float(rig.chambers[i]["set_lift"]) - THROW_CLEAR
		var chance := 0.0
		if past >= 0.0 and not rig.chambers[i]["security"]:
			chance = CATCH_CHANCE * clampf(1.0 - past / THROW_WASTE, THROW_FLOOR, 1.0)
		# Rolled for every pin, struck or not, so a lock's luck does not depend on the aim.
		var roll := _gun_rng.next_float()
		_lucky[i] = _struck[i] and roll < chance
	sim_event.emit(&"STRIKE", {"power": clampf(power, 0.0, MAX_POWER)})


## Walk a strike through its three parts, and say where each pin is being thrown to.
##
## Up: every driver the blade reaches goes as high as the strike throws it, and its key pin jumps
## after it. The plug is held still for this and for the fall — the pins are in the air for a
## tenth of a second, and a plug under a light wrench does not get under a driver in that; left
## free here it would catch every pin that crossed its line, and luck would have no say.
## Down: the drivers that will not be caught are brought back under their lines — pushed, so one
## the plug is pinching is not left hanging where it was thrown — while the lucky ones hang.
## Catch: the plug is let go, and slides under whatever is still up.
## Home: anything still up that the plug did not get under is sent back down too.
func _drive_strike(delta: float) -> void:
	if _strike_phase == STRIKE_IDLE:
		return
	for i in rig.count:
		var set_lift: float = rig.chambers[i]["set_lift"]
		var driver_to := -1.0
		var key_to := -1.0
		match _strike_phase:
			STRIKE_RISING:
				# The key pin is what the blade hits: it jumps under every driver, set or not.
				if _hit[i]:
					key_to = maxf(0.1, minf(_throw * KEY_THROW, set_lift - KEY_UNDER))
				if _struck[i]:
					# One that will be caught is thrown at least far enough past its line that
					# the shove is still at full strength as it crosses.
					driver_to = maxf(_throw, set_lift + CATCH_OVER) if _lucky[i] else _throw
			STRIKE_FALLING:
				if _hit[i]:
					key_to = 0.0
				if _struck[i]:
					driver_to = _hang(i) if _lucky[i] else 0.0
			STRIKE_CATCHING:
				# The rest are still being seen home: one the plug is pinching would otherwise
				# stop wherever the push left off, and the next strike would start from there.
				if _struck[i]:
					driver_to = _hang(i) if _lucky[i] else 0.0
			STRIKE_HOMING:
				# The catch is over: whatever was hanging and is not on the plug's top goes home.
				if _struck[i] and rig.states[i] != LockRig.SET:
					driver_to = 0.0
		rig.strike_lift[i] = driver_to
		rig.strike_key[i] = key_to
	rig.strike_hold = _strike_phase == STRIKE_RISING or _strike_phase == STRIKE_FALLING
	# On to the next part once this one is done, or has had its time.
	_strike_left -= delta
	match _strike_phase:
		STRIKE_RISING:
			if _strike_left <= 0.0 or _thrown_are_up():
				_strike_phase = STRIKE_FALLING
				_strike_left = STRIKE_DOWN
				# The throw is over. A driver that did not get over its line in it — one the
				# wrench was pinching too hard for this strike — is not going to be caught.
				for i in rig.count:
					if _lucky[i] and rig.driver_lift(i) < float(rig.chambers[i]["set_lift"]) + 0.05:
						_lucky[i] = false
		STRIKE_FALLING:
			if _strike_left <= 0.0 or _uncaught_are_down():
				_strike_phase = STRIKE_CATCHING
				_strike_left = STRIKE_CATCH
		STRIKE_CATCHING:
			if _strike_left <= 0.0:
				_strike_phase = STRIKE_HOMING
				_strike_left = STRIKE_DOWN
		STRIKE_HOMING:
			if _strike_left <= 0.0 or _uncaught_are_home():
				_strike_phase = STRIKE_IDLE
				for i in rig.count:
					rig.strike_lift[i] = -1.0
					rig.strike_key[i] = -1.0
	if _strike_phase == STRIKE_IDLE and _strike_queued >= 0.0:
		var power := _strike_queued
		_strike_queued = -1.0
		strike(power)


## Where a caught driver hangs while the plug comes under it, mm of lift.
func _hang(i: int) -> float:
	var set_lift: float = rig.chambers[i]["set_lift"]
	return clampf(_throw, set_lift + CATCH_OVER, set_lift + CATCH_HANG)


## Every thrown driver has got as high as it is going to.
func _thrown_are_up() -> bool:
	for i in rig.count:
		if _struck[i] and rig.driver_lift(i) < rig.strike_lift[i] - 0.08:
			return false
	return true


## Every driver that was not caught is back on its key pin.
func _uncaught_are_home() -> bool:
	for i in rig.count:
		if _struck[i] and rig.states[i] != LockRig.SET and rig.driver_lift(i) > 0.04:
			return false
	return true


## Every driver that will not be caught is back under its line.
func _uncaught_are_down() -> bool:
	for i in rig.count:
		if _struck[i] and not _lucky[i] and rig.driver_lift(i) > float(rig.chambers[i]["set_lift"]) - 0.15:
			return false
	return true


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
		# A fresh pin starts from the command as it stands; the pause is for the pin that clicked.
		_pause = 0.0

	# Where the hand wants the tip: the mouse's own position when it drives, else the chamber's
	# centre; in front of the mouth when the pick is out. A hand slides, it does not jump.
	var at := float(chamber)
	if not is_nan(in_pick_at):
		at = maxf(0.0, in_pick_at)
	# No further in than the back of the keyway: the steel stops there, whatever the hand asks.
	var back := LockRig.FIRST_X + (rig.count - 1) * LockRig.PITCH + BACK_REACH
	var tip_want := OUT_X if chamber < 0 else minf(back, LockRig.FIRST_X + at * LockRig.PITCH)
	# A tip raised into a bore is in a hole: it cannot be dragged sideways through the plug. It
	# stays in the bore's mouth until it has come back down under the keyway's roof.
	var held_in := _bore_over(_tip_x) if lift > ROOF_LIFT else -1
	var tip_next := tip_want
	if held_in >= 0:
		tip_next = clampf(tip_want, chamber_x(held_in) - BORE_MOUTH, chamber_x(held_in) + BORE_MOUTH)
	_tip_x = move_toward(_tip_x, tip_next, TIP_SLEW * delta)

	# The lift rises only once the tip has arrived under the pin; while it travels it comes down
	# and crosses. Arrived, it rises no faster than the ramp, slower the harder it presses; falls
	# at the release rate; and holds for a moment at the click. Between bores there is the plug
	# overhead, and the tip goes no higher than its roof.
	var target := clampf(in_lift, 0.0, LIFT_CEILING if _bore_over(_tip_x) >= 0 else ROOF_LIFT)
	var force := _hand_force_total()
	var arrived := chamber >= 0 and absf(_tip_x - tip_want) < ARRIVE_MM
	if not arrived:
		lift = maxf(0.0, lift - KEY_LIFT_RATE * 2.0 * delta)
	elif target < lift:
		lift = maxf(target, lift - KEY_LIFT_RATE * 1.6 * delta)
		_pause = 0.0
	elif _pause > 0.0:
		_pause -= delta
	elif rig.ease_mode == LockRig.EASE_BACK and counter_on:
		# While the plug is being eased off a caught pin the hand holds its push, it does not lean.
		pass
	else:
		lift = minf(target, lift + KEY_LIFT_RATE / (1.0 + LOAD_GAIN * force) * delta)

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
	var wants_counter := held and (dipping or in_counter)
	# Easing the plug back is for the pin that is caught. While the pin under the pick is in a
	# false set — or was, and still will not move — the plug walks back; the moment the pin comes
	# free the plug is held where it is while the pin goes through, and let go as the driver
	# clears the line, so the wrench carries it under. With the hand off the pins it just walks back.
	var under := _chamber_under_tip()
	var pushing := under >= 0 and lift > PASS_CLEARANCE + 0.05
	var was_counter := counter_on
	var mode := LockRig.EASE_OFF
	if wants_counter and pushing:
		var st := rig.states[under]
		var blocked := rig.hand_force(under) > BLOCKED_N
		if st == LockRig.FALSE_SET or (_easing == under and blocked):
			_easing = under
			mode = LockRig.EASE_BACK
		elif _easing == under and rig.driver_foot(under) < 0.0 and st != LockRig.OVERSET:
			mode = LockRig.EASE_HOLD
		else:
			_easing = -1
	elif wants_counter:
		_easing = -1
		mode = LockRig.EASE_BACK
	else:
		_easing = -1
	counter_on = mode != LockRig.EASE_OFF
	rig.wrench = wrench_newtons(level) if held else 0.0
	rig.ease_mode = mode
	rig.ease_rate = COUNTER_RATE
	tension = level

	_place_pick()
	if gun:
		# The gun has no lift: its needle lies under the pins and only its strike touches them.
		for i in rig.count:
			rig.hand_lift[i] = -1.0
		pick_give = 0.0
		lift = 0.0
		_drive_strike(delta)
	else:
		_lay_hands()
	_report(delta, held, was_counter)


## The total the hand is putting through the pick, N.
func _hand_force_total() -> float:
	var f := 0.0
	for i in rig.count:
		f += rig.hand_force(i)
	return f


## What the pin under the tip takes to move, N — known only once it is being pushed.
##
## A free pin is its spring and the weight of the stack, which is exactly what the hand ends up
## carrying: the two readings sit level. A pin the plug is pinching also has to slip through
## that pinch — friction at the plug's rim and again at the shell bore, both loaded by the
## wrench — so it reads well above the push until the push catches up and the pin moves.
func _resistance_under_tip() -> float:
	var i := pick_chamber
	if i < 0:
		return 0.0
	var need := LockRig.PIN_WEIGHT
	if rig.key_top(i) >= rig.driver_foot(i) - 0.02:
		need += LockRig.PIN_WEIGHT + (LockRig.SPRING_PRELOAD + LockRig.SPRING_RATE * maxf(0.0, rig.driver_lift(i))) \
			* rig.spring(i)
	var st := rig.states[i]
	if st == LockRig.BINDING or st == LockRig.FALSE_SET:
		need += 2.0 * LockRig.FRICTION * rig.wrench
	return need


## The chamber whose bore the point `x` along the keyway is under, or -1 between bores.
func _bore_over(x: float) -> int:
	var i := roundi((x - LockRig.FIRST_X) / LockRig.PITCH)
	if i < 0 or i >= rig.count:
		return -1
	return i if absf(chamber_x(i) - x) <= BORE_MOUTH + 1e-4 else -1


func _chamber_under_tip() -> int:
	if _tip_x < 1.0:
		return -1
	var i := roundi((_tip_x - LockRig.FIRST_X) / LockRig.PITCH)
	if i < 0 or i >= rig.count:
		return -1
	return i if absf(chamber_x(i) - _tip_x) < LockRig.PITCH * 0.6 else -1


## Where the hand has the tip: level, at the commanded height. The shank fits through the
## mouth level at every lift the hand can ask for.
func _place_pick() -> void:
	tip = Vector2(_tip_x, _rest_y + lift)


## Each key pin is held up to whatever steel is under its tip.
func _lay_hands() -> void:
	var shift := rig.shift()
	var worst := 0.0
	var slope := LockRig.KEY_TIP / (LockRig.PIN_R - LockRig.KEY_TIP_HALF)
	for i in rig.count:
		var cx := LockRig.FIRST_X + LockRig.PITCH * i + shift
		# Nothing of the pick is under a pin deeper in than the tip.
		if cx - LockRig.PIN_R > _tip_x + 0.6:
			rig.hand_lift[i] = -1.0
			continue
		# The hook's tip works the pin it is under; a pin further back along the keyway can only
		# meet the shank, and only when the hand is raised nearly to its ceiling.
		var near := absf(cx - _tip_x) < LockRig.PITCH * 0.75
		if not near and lift < SHANK_LIFT:
			rig.hand_lift[i] = -1.0
			continue
		var want := -1.0
		for dx: float in (TIP_SAMPLES if near else SHANK_SAMPLES):
			var steel := _steel(cx + dx - _tip_x)
			if is_nan(steel):
				continue
			# The pin's underside at this offset: the flat of the tip, or the cone's flank.
			var under := _tip_bottom_rest + maxf(0.0, absf(dx) - LockRig.KEY_TIP_HALF) * slope
			want = maxf(want, tip.y + steel - under)
		rig.hand_lift[i] = want if want > 0.0 else -1.0
		if want > 0.0:
			worst = maxf(worst, want - rig.key_lift(i))
	# A pin that will not move holds the steel off: the hand gives, and no more than a hand can.
	pick_give = maxf(0.0, worst)
	if worst > GIVE:
		lift = maxf(0.0, lift - (worst - GIVE))


func _report(delta: float, held: bool, was_counter: bool) -> void:
	var s := rig.shift()
	var force := _hand_force_total()
	pick_force = minf(1.0, force / LockRig.HAND_MAX)
	pick_chamber = _chamber_under_tip()
	pick_resistance = minf(1.0, _resistance_under_tip() / LockRig.HAND_MAX) if pick_force > 0.01 else 0.0
	var dropped: Array[int] = []
	var order: Array = stats["set_order"]
	for i in rig.count:
		var was := _prev_states[i]
		var now := rig.states[i]
		if now == was:
			continue
		if now == LockRig.SET:
			sim_event.emit(&"PIN_SET", {"chamber": i, "tension": tension})
			if not order.has(i):
				order.append(i)
			# The click: the hand stops for a moment on the pin it was lifting.
			if _pause <= 0.0 and i == _last_chamber and lift > 0.0:
				_pause = CLICK_PAUSE
		elif now == LockRig.OVERSET:
			sim_event.emit(&"PIN_OVERSET", {"chamber": i})
			stats["oversets"] += 1
		elif now == LockRig.FALSE_SET:
			sim_event.emit(&"FALSE_SET_ENTERED", {"chamber": i, "depth": maxf(0.0, s - _last_shift)})
			stats["false_sets"] += 1
		if was == LockRig.SET and now != LockRig.SET and now != LockRig.OVERSET:
			dropped.append(i)
			order.erase(i)
		elif not held and was == LockRig.OVERSET and now != LockRig.OVERSET:
			dropped.append(i)
			order.erase(i)
		_prev_states[i] = now
	if not dropped.is_empty():
		if not held:
			stats["full_resets"] += 1
		sim_event.emit(&"RESET", {"kind": "counter" if held else "full", "dropped": dropped})
	# Every pin is up and the plug has still not gone: something else is holding it (a sidebar
	# whose gates are unmet), or the wrench is not on. Said once each time it becomes true.
	var all_up := rig.count > 0
	for i in rig.count:
		if rig.states[i] != LockRig.SET:
			all_up = false
			break
	_free_for = _free_for + delta if all_up and not rig.opened else 0.0
	var free := _free_for > PLUG_FREE_AFTER
	if free and not plug_free:
		sim_event.emit(&"PLUG_FREE", {})
	plug_free = free
	if rig.binding >= 0 and not (stats["bind_order"] as Array).has(rig.binding):
		(stats["bind_order"] as Array).append(rig.binding)
	stats["max_tension"] = maxf(stats["max_tension"], tension)
	stats["elapsed"] = time
	if counter_on and not was_counter:
		sim_event.emit(&"COUNTER_ROTATION", {"chamber": maxi(0, pick_chamber)})
	if absf(s - _last_shift) > 0.002:
		sim_event.emit(&"PLUG_MOVED", {"shift": s, "velocity": (s - _last_shift) / delta})
	_last_shift = s
