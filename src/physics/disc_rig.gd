class_name DiscRig
extends Node2D
## A disc-detainer lock as rigid bodies.
##
## Four kinds of part, as in the lock: the body, the sleeve inside it that the wrench turns, the
## sidebar — one bar lying in a slot of the sleeve with its back in a groove of the body — and
## the discs, each with a gate cut in its rim. While the bar is in the body's groove the sleeve
## cannot turn. The bar can only leave the groove by dropping into the discs, and it can only
## drop when every disc has its gate under it.
##
## Nothing here decides that a disc binds, sets or false-sets — the engine's contact solver does.
## This file builds the bodies, says what pushes on them each tick, and reads the result back in
## the same five words the pin lock uses.
##
## The world is the lock unrolled at the discs' rim, as the pin lock's is at the plug's: a turn
## is a slide along x, out from the axis is up. Every disc's rim lies along the same strip of the
## world, each on a collision layer of its own, so the discs pass through each other and the one
## bar meets them all — which is what lying across the whole pack is.
##
## It is built from the sleeve's point of view: the sleeve stands still and the body is what
## slides, the other way. It is the same turn, seen from the part the discs ride in — and it
## means a disc nobody is turning stays exactly where it is in the sleeve, with nothing needed to
## carry it round. `shift()` is the sleeve's turn in the body, whichever of them is drawn moving.
##
## How the mechanisms come out of the shapes:
##  - PRESSING: the groove's wall is a ramp. The sleeve, turning, carries the bar against it, and
##    the ramp drives the bar down onto the discs. The harder the wrench, the harder the bar presses.
##  - BINDING: each disc's rim stands a step lower than the last one in the binding order, so the
##    bar rests on exactly one disc at a time. That disc is stiff under it; the others turn free.
##  - SET: turn that disc until its gate is under the bar and the bar drops into it — one step, on
##    to the next disc's rim — and the sleeve turns that much further. The disc is loose again,
##    and slides a little either way with the bar in its gate.
##  - OVERSET: a gate's mouth is eased, not square. A bar that is only a step down in a gate is
##    still on that slope, so a hand that keeps leaning on the disc rides the bar up out of the
##    gate and carries the disc on past it. A light wrench lets it happen easily, a heavy one
##    hardly at all. The disc is stiff again, its gate is behind it, and it has to be turned back.
##    Once more discs have set, the bar is down past the slope and the gate's walls hold.
##  - FALSE SET: a false gate is a shallow notch. The bar drops into it just the same, but its
##    floor stops the bar short of leaving the groove, and on that floor the bar is down past the
##    slope: the disc is held until the sleeve is eased back.
##  - OPEN: with every true gate in line the bar drops clear of the body, and the sleeve turns.
##
## A disc has no spring. Ease the wrench and the bar's own light spring lifts it back out of the
## gates, and every disc stays exactly where it was left.

# ── Units: the pin rig's ────────────────────────────────────────────────────────────────
const S := LockRig.S
const MS := LockRig.MS
const FS := LockRig.FS

# ── Collision layers ────────────────────────────────────────────────────────────────────
const L_BODY := 1
const L_SLEEVE := 2
const L_BAR := 4
## Disc i is on `L_DISC << i`.
const L_DISC := 256
const MAX_DISCS := 12

# ── Geometry, mm (x along the rim the way the wrench turns, y out from the axis; the highest
#    disc's rim at 0, the bar's middle at x = 0) ────────────────────────────────────────────
## The discs' radius at the rim: what turns an angle into a length of rim.
const RIM_R := 8.0
## One cut of the key: a disc's gate is a whole number of these round from the bar.
const CUT_ANGLE := PI / 10.0
const UNIT := RIM_R * CUT_ANGLE
## The deepest cut, and the whole of a disc's travel: a quarter turn, stop to stop.
const MAX_CUT := 5
const TRAVEL := UNIT * MAX_CUT
## The bar: across the rim, and from its foot to its back.
const BAR_W := 1.4
const BAR_H := 3.0
## How far the bar's foot stands off the highest rim with the wrench off.
const BAR_LIFT := 0.15
const BAR_BEVEL := 0.04
## The sleeve's wall, inside and out, and the body's bore just outside it.
const SLEEVE_IN := 0.2
const SLEEVE_OUT := 2.3
const BODY_IN := 2.34
## How far the bar's back stands in the body's groove at rest — and so how far it has to drop.
const GROOVE := BAR_LIFT + BAR_H - BODY_IN
## How far the sleeve turns to drive the bar that whole way down: the ramp is steeper than it is
## long, so the bar's back is a bevelled shoulder rather than a point.
const RAMP_RUN := 0.47
## How far the sleeve turns before the groove's ramp takes hold of the bar: the slack in a lock.
const TAKE_UP := 0.1
const SLOT_CLEAR := 0.012
const GROOVE_CLEAR := 0.05
## A gate is this much wider than the bar on each side, at quality 1.
const GATE_CLEAR := 0.12
## A true gate's floor: well below anything the bar reaches.
const GATE_FLOOR := -1.2
## A false gate's floor, under its own rim — and never so low the bar could leave the groove.
const FALSE_DEPTH := 0.3
const FALSE_FLOOR := -0.56
## How much lower each next disc's rim stands, at quality 1, and the most the whole pack may span.
const RIM_STEP := 0.07
const RIM_SPREAD := 0.42
const EDGE_BEVEL := 0.012
## The eased mouth of a gate: how far down each side slopes, and how far along the rim that takes.
## Deeper than one step of the bar and shallower than two, and at about 40 degrees — a slope a
## hand can push a bar up against the wrench's lighter pressures and not against its heavier ones,
## and steep enough that a bar pushed part-way up it and let go slides the disc back down.
const GATE_RAMP := 0.12
const GATE_RAMP_RUN := 0.143
const STRIP_BOTTOM := -3.0
const STRIP_MARGIN := 3.0
const BODY_TOP := 4.6
const BODY_REACH := 4.5
const SLEEVE_REACH := 3.0
## How far past the bar's release the sleeve runs before it is plainly open, and to its stop, mm.
const OPEN_PAST := 0.25
const OPEN_RUN := 0.6
const OPEN_SETTLE := 0.3

# ── Along the lock, mm: where each disc sits. The bodies do not use it — the views do ───────
const FIRST_Z := 3.4
const PITCH_Z := 2.4
const DISC_T := 1.6

# ── Materials ───────────────────────────────────────────────────────────────────────────
## Steel on brass, bar on rim: what makes the disc under the bar stiff.
const FRICTION := 0.3
## The bar in its slot and on the ramp: polished, so the ramp presses rather than grips.
const SLIDE_FRICTION := 0.05
const SLEEVE_MASS := 5.0e-4
const SLEEVE_DRAG := 0.12
const SLEEVE_MAX_SPEED := 40.0
## The pull that takes the sleeve home when the wrench comes off, N.
const SLEEVE_RETURN := 0.6
const BAR_MASS := 1.7e-4
const BAR_DRAG := 0.009
const BAR_MAX_SPEED := 150.0
## The bar's spring, N: enough to lift it out of the gates, far less than any wrench.
const BAR_SPRING := 0.25
const DISC_MASS := 4.0e-4
## N per mm/s: the grease between a disc and its spacers.
const DISC_DRAG := 0.012
const DISC_MAX_SPEED := 60.0
## How firmly a track holds its body to the line of the turn.
const TRACK_BIAS := 0.6
## The hand on a disc: a stiff spring that yields, its damping, and the most it will put in, N.
const HAND_K := 20.0
const HAND_DAMP := 0.11
const HAND_MAX := 1.6

# ── Reading it back ─────────────────────────────────────────────────────────────────────
## The bar is in a notch once its foot is this far under that disc's rim, mm.
const ENGAGE := 0.015
## The bar is resting on a surface when its foot is within this above it, or that below, mm.
const REST := 0.02
const REST_UNDER := 0.045
## The bar is out of a disc's way once its foot stands this far over that disc's rim, mm.
const CLEAR_OVER := 0.03

var def: Dictionary
var seed_value := 0
var count := 0
## Length of the pack along the lock, mm, for the views.
var depth := 0.0
var step := RIM_STEP
## Half a gate's width, mm.
var gate_half := BAR_W / 2.0 + GATE_CLEAR
## The sleeve's turn at which the bar has left the body's groove, mm.
var free_at := TAKE_UP + RAMP_RUN
## Per disc: order, rim, cut, notches ([{x, floor, true, cut}], x the centre along the disc's own
## rim, mm).
var info: Array[Dictionary] = []
var discs: Array[RigDisc] = []
var bar: RigBar
## The sleeve: the frame everything else is measured in.
var sleeve: StaticBody2D
## The body, sliding against the sleeve the way the wrench is not turning.
var body: RigPlug

## The wrench, N at the rim; 0 is off.
var wrench := 0.0
## The hand: the turn it is holding each disc to, mm of rim from its back stop — NAN for no hand.
var hand_at: PackedFloat32Array = PackedFloat32Array()
## Easing the sleeve back against a wrench that stays on: LockRig's EASE_OFF / EASE_HOLD / EASE_BACK.
var ease_mode := LockRig.EASE_OFF
var ease_rate := 0.0

## LockRig's five words, per disc. OVERSET is a disc the bar is resting on whose true gate is
## already behind it: turned too far, and to be turned back.
var states: PackedInt32Array = PackedInt32Array()
## The disc the bar is resting on and so pinching — binding or overset — -1 for none.
var binding := -1
## The disc carrying the bar, whether on its rim or on a false gate's floor; -1 for none.
var carrier := -1
var opened := false
var time := 0.0

var _open_for := 0.0
var _counter_stop := INF
var _rim: PackedFloat32Array = PackedFloat32Array()
var _notch_x: Array[PackedFloat32Array] = []
var _notch_floor: Array[PackedFloat32Array] = []
var _notch_true: Array[PackedByteArray] = []
var _under: PackedInt32Array = PackedInt32Array()
var _over: PackedInt32Array = PackedInt32Array()
var _rim_now: PackedFloat32Array = PackedFloat32Array()
## Per disc: the bar's foot is over the eased mouth of one of its notches.
var _slope: PackedByteArray = PackedByteArray()


static func mm(x: float, y: float) -> Vector2:
	return Vector2(x * S, -y * S)


## The cuts of a lock's key: how many steps each disc is turned to bring its gate to the bar.
static func cuts_of(lock_def: Dictionary) -> Array[int]:
	var out: Array[int] = []
	for c: Variant in lock_def.get("bitting", []):
		out.append(clampi(int(c), 0, MAX_CUT))
	return out


## Where each disc carries a false gate, as cuts: [[…], …], one list per disc.
static func false_cuts_of(lock_def: Dictionary) -> Array:
	var out: Array = []
	var n := (lock_def.get("bitting", []) as Array).size()
	var discs_block: Dictionary = lock_def.get("discs", {}) if lock_def.get("discs") is Dictionary else {}
	var lies: Array = discs_block.get("falseGates", []) if discs_block.get("falseGates") is Array else []
	for i in n:
		var mine: Array[int] = []
		if i < lies.size() and lies[i] is Array:
			for f: Variant in lies[i]:
				mine.append(clampi(int(f), 0, MAX_CUT))
		out.append(mine)
	return out


## How many false gates a lock carries in all.
static func false_count(lock_def: Dictionary) -> int:
	var n := 0
	var cuts := cuts_of(lock_def)
	var lies := false_cuts_of(lock_def)
	for i in cuts.size():
		for f: int in lies[i]:
			if f != cuts[i]:
				n += 1
	return n


func build(lock_def: Dictionary, lock_seed: int) -> void:
	def = lock_def
	seed_value = lock_seed
	var cuts := cuts_of(def)
	var lies := false_cuts_of(def)
	count = mini(cuts.size(), MAX_DISCS)
	depth = FIRST_Z + PITCH_Z * (count - 1) + FIRST_Z
	var quality := float(def.get("toleranceQuality", 1.0))
	step = minf(RIM_STEP * clampf(quality, 0.7, 1.3), RIM_SPREAD / maxf(1.0, count - 1.0))
	gate_half = BAR_W / 2.0 + GATE_CLEAR * clampf(quality, 0.5, 1.5)
	var order := LockRig.bind_order(count, lock_seed)
	info.clear()
	_rim.clear()
	_notch_x.clear()
	_notch_floor.clear()
	_notch_true.clear()
	for i in count:
		var rim_y := -step * order[i]
		var xs := PackedFloat32Array()
		var floors := PackedFloat32Array()
		var trues := PackedByteArray()
		var notches: Array = []
		# The gate for cut c is c steps round from the bar: turning the disc c steps brings it under.
		var marks: Array = [[cuts[i], true]]
		for f: int in lies[i]:
			if f != cuts[i]:
				marks.append([f, false])
		for mark: Array in marks:
			var x := -float(mark[0]) * UNIT
			var is_true: bool = mark[1]
			var floor_y := GATE_FLOOR if is_true else maxf(rim_y - FALSE_DEPTH, FALSE_FLOOR)
			xs.append(x)
			floors.append(floor_y)
			trues.append(1 if is_true else 0)
			notches.append({"x": x, "floor": floor_y, "true": is_true, "cut": int(mark[0])})
		info.append({"order": order[i], "rim": rim_y, "cut": cuts[i], "notches": notches})
		_rim.append(rim_y)
		_notch_x.append(xs)
		_notch_floor.append(floors)
		_notch_true.append(trues)
	hand_at.resize(count)
	hand_at.fill(NAN)
	states.resize(count)
	states.fill(LockRig.FREE)
	_under.resize(count)
	_under.fill(-1)
	_over.resize(count)
	_over.fill(-1)
	_rim_now.resize(count)
	_rim_now.fill(0.0)
	_slope.resize(count)
	_slope.fill(0)
	_build_sleeve()
	_build_body()
	_build_bar()
	_build_discs()


func _material(friction: float) -> PhysicsMaterial:
	var m := PhysicsMaterial.new()
	m.friction = friction
	m.bounce = 0.0
	return m


func _add_convex(to: CollisionObject2D, points: PackedVector2Array) -> void:
	var shape := ConvexPolygonShape2D.new()
	shape.points = points
	var node := CollisionShape2D.new()
	node.shape = shape
	to.add_child(node)


func _rect(x0: float, y0: float, x1: float, y1: float) -> PackedVector2Array:
	return PackedVector2Array([mm(x0, y0), mm(x1, y0), mm(x1, y1), mm(x0, y1)])


## The sleeve: all the rig needs of it is the slot the bar rides in.
func _build_sleeve() -> void:
	sleeve = StaticBody2D.new()
	sleeve.name = "Sleeve"
	sleeve.collision_layer = L_SLEEVE
	sleeve.collision_mask = 0
	sleeve.physics_material_override = _material(SLIDE_FRICTION)
	add_child(sleeve)
	_add_convex(sleeve, _rect(-SLEEVE_REACH, SLEEVE_IN, -BAR_W / 2.0 - SLOT_CLEAR, SLEEVE_OUT))
	_add_convex(sleeve, _rect(BAR_W / 2.0 + SLOT_CLEAR, SLEEVE_IN, SLEEVE_REACH, SLEEVE_OUT))


## A track along the turn for a body that only turns, from `back` mm behind where it starts to
## `on` mm ahead: the bar pressing on a disc is carried by this, not by the disc giving way.
func _track(to: RigidBody2D, back: float, on: float) -> void:
	var groove := GrooveJoint2D.new()
	groove.name = "Track" + to.name
	groove.position = mm(-back - 1.0, 0.0)
	groove.rotation = -PI / 2.0
	groove.length = (back + on + 2.0) * S
	groove.initial_offset = (back + 1.0) * S
	groove.bias = TRACK_BIAS
	add_child(groove)
	groove.node_a = groove.get_path_to(sleeve)
	groove.node_b = groove.get_path_to(to)


## The body: its bore above the sleeve, and the groove the bar's back sits in. The groove's wall
## on the turning side is the ramp — as steep as the bar's own shoulder, and `TAKE_UP` away from it.
func _build_body() -> void:
	body = RigPlug.new()
	body.name = "Body"
	body.collision_layer = L_BODY
	body.collision_mask = L_BAR
	body.physics_material_override = _material(SLIDE_FRICTION)
	body.custom_integrator = true
	body.can_sleep = false
	body.lock_rotation = true
	body.gravity_scale = 0.0
	body.mass = SLEEVE_MASS * MS
	body.drag = SLEEVE_DRAG * FS / S
	body.max_speed = SLEEVE_MAX_SPEED * S
	body.stop_hi = 0.0
	body.stop_lo = -(free_at + OPEN_RUN) * S
	body.base = global_position
	add_child(body)
	var left := -BAR_W / 2.0 - GROOVE_CLEAR
	var roof := BAR_LIFT + BAR_H
	var ramp_top := BAR_W / 2.0 - RAMP_RUN + TAKE_UP
	var ramp_foot := BAR_W / 2.0 + TAKE_UP
	_add_convex(body, _rect(-BODY_REACH, BODY_IN, left, BODY_TOP))
	_add_convex(body, _rect(left, roof, ramp_top, BODY_TOP))
	_add_convex(body, PackedVector2Array([
		mm(ramp_top, roof), mm(ramp_foot, BODY_IN), mm(BODY_REACH, BODY_IN), mm(BODY_REACH, BODY_TOP), mm(ramp_top, BODY_TOP),
	]))
	_track(body, free_at + OPEN_RUN, 0.0)


## The bar's outline about its middle, mm, y up: a flat foot, and on the turning side a shoulder
## cut to the groove's ramp.
static func bar_outline() -> PackedVector2Array:
	var hw := BAR_W / 2.0
	var hh := BAR_H / 2.0
	return PackedVector2Array([
		Vector2(-hw, -hh + BAR_BEVEL), Vector2(-hw + BAR_BEVEL, -hh), Vector2(hw - BAR_BEVEL, -hh),
		Vector2(hw, -hh + BAR_BEVEL), Vector2(hw, hh - GROOVE), Vector2(hw - RAMP_RUN, hh), Vector2(-hw, hh),
	])


func _build_bar() -> void:
	bar = RigBar.new()
	bar.name = "Bar"
	bar.collision_layer = L_BAR
	var mask := L_BODY | L_SLEEVE
	for i in count:
		mask |= L_DISC << i
	bar.collision_mask = mask
	bar.physics_material_override = _material(FRICTION)
	bar.custom_integrator = true
	bar.can_sleep = false
	bar.lock_rotation = true
	bar.gravity_scale = 0.0
	bar.mass = BAR_MASS * MS
	bar.drag = BAR_DRAG * FS / S
	bar.max_speed = BAR_MAX_SPEED * S
	bar.lift = BAR_SPRING * FS
	add_child(bar)
	var pts := PackedVector2Array()
	for p in bar_outline():
		pts.append(mm(p.x, p.y))
	_add_convex(bar, pts)
	bar.position = mm(0.0, BAR_LIFT + BAR_H / 2.0 - 0.002)


## A stretch of rim between two gates. Where it ends at a gate its corner is that gate's eased
## mouth: a slope down to the gate's wall.
func _land(to: RigDisc, x0: float, x1: float, rim_y: float, gate_left: bool, gate_right: bool) -> void:
	if x1 - x0 < EDGE_BEVEL * 3.0:
		return
	var left := Vector2(GATE_RAMP_RUN, GATE_RAMP) if gate_left else Vector2(EDGE_BEVEL, EDGE_BEVEL)
	var right := Vector2(GATE_RAMP_RUN, GATE_RAMP) if gate_right else Vector2(EDGE_BEVEL, EDGE_BEVEL)
	# Two gates a single cut apart leave a land shorter than two slopes: they meet in the middle.
	var room := (x1 - x0 - EDGE_BEVEL) / maxf(1e-6, left.x + right.x)
	if room < 1.0:
		left *= room
		right *= room
	_add_convex(to, PackedVector2Array([
		mm(x0, GATE_FLOOR), mm(x1, GATE_FLOOR), mm(x1, rim_y - right.y), mm(x1 - right.x, rim_y), mm(x0 + left.x, rim_y),
		mm(x0, rim_y - left.y),
	]))


func _build_discs() -> void:
	discs.clear()
	var x_min := -TRAVEL - STRIP_MARGIN
	var x_max := STRIP_MARGIN
	for i in count:
		var d := RigDisc.new()
		d.name = "Disc%d" % (i + 1)
		d.collision_layer = L_DISC << i
		d.collision_mask = L_BAR
		d.physics_material_override = _material(FRICTION)
		d.custom_integrator = true
		d.can_sleep = false
		d.lock_rotation = true
		d.gravity_scale = 0.0
		d.mass = DISC_MASS * MS
		d.drag = DISC_DRAG * FS / S
		d.max_speed = DISC_MAX_SPEED * S
		d.stop_lo = 0.0
		d.stop_hi = TRAVEL * S
		d.base = global_position
		add_child(d)
		var rim_y := _rim[i]
		_add_convex(d, _rect(x_min, STRIP_BOTTOM, x_max, GATE_FLOOR))
		var notches: Array = (info[i]["notches"] as Array).duplicate()
		notches.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a["x"]) < float(b["x"]))
		var cursor := x_min
		var after_gate := false
		for notch: Dictionary in notches:
			var x0 := float(notch["x"]) - gate_half
			var x1 := float(notch["x"]) + gate_half
			_land(d, cursor, x0, rim_y, after_gate, true)
			if float(notch["floor"]) > GATE_FLOOR + 1e-6:
				_add_convex(d, _rect(x0, GATE_FLOOR, x1, float(notch["floor"])))
			cursor = x1
			after_gate = true
		_land(d, cursor, x_max, rim_y, after_gate, false)
		_track(d, 0.0, TRAVEL)
		discs.append(d)


# ── Reading it back ─────────────────────────────────────────────────────────────────────

## How far the sleeve has turned in the body, mm at the rim.
func shift() -> float:
	return -body.position.x / S


## How far disc i has been turned from its back stop, mm at the rim.
func turned(i: int) -> float:
	return discs[i].position.x / S


## The turn that puts disc i's true gate under the bar, mm at the rim.
func gate_turn(i: int) -> float:
	return float(info[i]["cut"]) * UNIT


## Disc i's rim, mm: where it was cut, less whatever the bar is pressing it down by.
func rim(i: int) -> float:
	return _rim[i] - discs[i].position.y / S


## The bar's foot, mm above the highest rim.
func bar_foot() -> float:
	return -bar.position.y / S - BAR_H / 2.0


## How far the bar has come down from where its spring holds it, mm.
func bar_drop() -> float:
	return maxf(0.0, BAR_LIFT - bar_foot())


## What the hand is putting into disc i, N: positive turns it forward.
func hand_force(i: int) -> float:
	return discs[i].hand_force / FS


## The notch of disc i the bar could drop into or has: the whole bar is over it. An index into
## the disc's `notches`; -1 over plain rim, or over a notch's eased mouth.
func notch_under(i: int) -> int:
	return _under[i]


## The notch of disc i any part of the bar's foot is over, its eased mouth included; -1 when the
## bar is clear of them all.
func notch_over(i: int) -> int:
	return _over[i]


## Disc i has been turned on past its true gate, mm: positive once the bar is off the gate's far
## slope and on the rim beyond.
func past_gate(i: int) -> float:
	return turned(i) - gate_turn(i) - (gate_half + GATE_RAMP_RUN - (BAR_W / 2.0 - BAR_BEVEL))


## Any part of the bar is over one of disc i's false gates.
func over_lie(i: int) -> bool:
	return _over[i] >= 0 and _notch_true[i][_over[i]] == 0


## The bar is down in one of disc i's notches, and its walls are holding the disc.
func held(i: int) -> bool:
	return states[i] == LockRig.SET or states[i] == LockRig.FALSE_SET


## The bar is still in disc i's way: over one of its notches and not yet lifted clear of its rim.
func blocked(i: int) -> bool:
	return _over[i] >= 0 and bar_foot() < rim(i) + CLEAR_OVER


func _settle_open(delta: float) -> void:
	if _open_for < 0.0:
		return
	_open_for += delta
	if _open_for < OPEN_SETTLE:
		return
	_open_for = -1.0
	body.freeze = true
	bar.freeze = true
	for d in discs:
		d.freeze = true


func _physics_process(delta: float) -> void:
	if body == null:
		return
	if opened:
		_settle_open(delta)
		return
	time += delta
	if wrench > 0.0:
		body.drive = -wrench * FS
		if ease_mode == LockRig.EASE_BACK:
			# The stop walks back and the sleeve, still under the wrench, follows it.
			_counter_stop = maxf(0.0, minf(_counter_stop, shift()) - ease_rate * delta)
		elif ease_mode == LockRig.EASE_HOLD:
			_counter_stop = minf(_counter_stop, shift())
		else:
			_counter_stop = INF
	else:
		body.drive = SLEEVE_RETURN * FS
		_counter_stop = INF
	body.stop_lo = -minf(free_at + OPEN_RUN, _counter_stop) * S
	for i in count:
		var d := discs[i]
		if is_nan(hand_at[i]):
			d.hand_k = 0.0
		else:
			d.hand_k = HAND_K * FS / S
			d.hand_c = HAND_DAMP * FS / S
			d.hand_max = HAND_MAX * FS
			d.hand_x = hand_at[i] * S
	_read()


func _read() -> void:
	var foot := -bar.position.y / S - BAR_H / 2.0
	# The bar's place in its slot: a hair either side of the middle.
	var off := bar.position.x / S
	# The flat of the bar's foot, either side of its middle: what rides a gate's slope.
	var flat := BAR_W / 2.0 - BAR_BEVEL
	# Any of the foot is over a notch, or over its eased mouth, within this of the notch's middle.
	var any := gate_half + GATE_RAMP_RUN + BAR_W / 2.0
	binding = -1
	carrier = -1
	var top := -1
	var top_at := -INF
	for i in count:
		var at := off - discs[i].position.x / S
		var xs := _notch_x[i]
		var near := -1
		var near_by := INF
		for k in xs.size():
			var by := absf(at - xs[k])
			if by < near_by:
				near_by = by
				near = k
		# The track gives a little under the bar's weight, and takes the rim down with it.
		var sink := discs[i].position.y / S
		var rim_at := _rim[i] - sink
		# What of this disc is under the foot, and how high it stands there: the gate's floor
		# while the whole bar is over the gate, the slope of its mouth while the foot's edge is on
		# that, the rim beyond.
		var whole := near >= 0 and near_by + BAR_W / 2.0 <= gate_half
		var stands := rim_at
		_slope[i] = 0
		if whole:
			stands = -INF if _notch_true[i][near] == 1 else _notch_floor[i][near] - sink
		elif near >= 0:
			var up := clampf((near_by + flat - gate_half) / GATE_RAMP_RUN, 0.0, 1.0)
			stands = rim_at - GATE_RAMP * (1.0 - up)
			_slope[i] = 1 if up < 1.0 else 0
		_under[i] = near if whole else -1
		_over[i] = near if near_by <= any else -1
		_rim_now[i] = rim_at
		if stands > top_at:
			top = i
			top_at = stands
	# The bar rests on the highest thing under it — when the wrench has it resting on anything.
	var resting := top >= 0 and wrench > 0.0 and foot - top_at <= REST and top_at - foot <= REST_UNDER
	var all_set := true
	for i in count:
		var st := LockRig.FREE
		if resting and top == i:
			carrier = i
			var in_lie := _over[i] >= 0 and _notch_true[i][_over[i]] == 0
			if _under[i] >= 0 or (in_lie and _slope[i] == 1 and foot < _rim_now[i] - ENGAGE):
				# On a false gate's floor, or down in its mouth with the bar wedged on the slope:
				# held there, and holding the bar up.
				st = LockRig.FALSE_SET
			else:
				# On its rim, or on the slope into one of its gates: the disc the bar is pinching.
				# With its true gate already behind it, it has been turned too far.
				binding = i
				st = LockRig.OVERSET if past_gate(i) > 0.0 else LockRig.BINDING
		elif _over[i] >= 0 and foot < _rim_now[i] - ENGAGE:
			# Under this disc's rim and resting on something else: the bar is in one of its gates.
			st = LockRig.SET if _notch_true[i][_over[i]] == 1 else LockRig.FALSE_SET
		states[i] = st
		if st != LockRig.SET:
			all_set = false
	if all_set and shift() > free_at + OPEN_PAST:
		opened = true
