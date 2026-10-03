class_name LockRig
extends Node2D
## A pin-tumbler lock as rigid bodies.
##
## The shell is a StaticBody2D with a bore per chamber; the plug is a RigidBody2D that slides
## under the wrench; every key pin and driver is a RigidBody2D cut to its real outline. Nothing
## here decides that a pin binds, sets, false-sets or jams — the engine's contact solver does,
## because the bores stop lining up once the plug has moved. This file builds the bodies, says
## what pushes on them each tick, and reads the result back as the game's five words.
##
## The world is the lock unrolled: the plug's turn at its rim is a slide along x, so the pinch a
## real cylinder makes across the keyway happens here along it. The views draw that slide as
## the turn it stands for.
##
## How the mechanisms come out of the shapes:
##  - BINDING: each plug bore's rim is cut back a step further than the last one in the binding
##    order, so the sliding plug squeezes exactly one driver against its shell wall at a time.
##  - SET: lift that driver clear of the plug and the plug slides on to the next pinch; its top
##    is now under the driver — a ledge one step wide.
##  - FALSE SET: the plug only bears on a pin through the rim of its bore (below the rim the
##    bore is relieved). A spool's waist at the rim lets the plug slide into it, and the spool's
##    foot is then caught under the rim until the plug is eased back.
##  - OVERSET: a key pin pushed up into the shell's bore is squeezed just as a driver is.

# ── Units ───────────────────────────────────────────────────────────────────────────────
## Engine px per mm. The solver's tolerances are tuned for pixel-sized worlds, so the lock is
## built large and the camera looks at it from far away.
const S := 100.0
## Tonnes to engine mass, and newtons to engine force (so a = F/m comes out in px/s²).
const MS := 1.0e4
const FS := S * MS

# ── Collision layers ────────────────────────────────────────────────────────────────────
const L_SHELL := 1
const L_PLUG := 2
const L_PIN := 4
const L_PICK := 16

# ── Geometry, mm (y up, shear line at 0, x from the keyway's mouth) ──────────────────────
const PITCH := 4.2
const FIRST_X := 3.6
const PIN_R := 1.47
## Bore half-width minus pin radius. The shell's bores are a close fit: a driver has almost no
## sideways play, so where the plug's rim meets it does not depend on which wall it was last
## leaning on.
const PLUG_CLEAR := 0.03
const SHELL_CLEAR := 0.012
## The rim of a plug bore: the only part of its wall that bears on a pin, this tall — thinner
## than the narrowest groove any driver carries (a serration), so it can drop into every one.
## Below it the wall on the pushing side is cut back by RIM_RELIEF: room for a spool's foot, and
## no more than a real plug gives one — the foot fetches up against the wall, so a false set turns
## the plug a degree or so and not by the whole depth of the waist.
const RIM_HEIGHT := 0.12
const RIM_RELIEF := 0.1
## Where the plug's bore meets the keyway: the key pin's cone rests on the slot's lips here.
const FLOOR_Y := -5.0
const SLOT_HALF := 1.1
const SEAT_Y := 9.0
const KEYWAY_FLOOR_Y := -11.0
const KEYWAY_CEIL_Y := -5.0
## Clearance between the plug's top and the shell's underside.
const SHEAR_GAP := 0.04
const RIM_CHAMFER := 0.012
const MOUTH_CHAMFER := 0.02
const PIN_BEVEL := 0.012
## A key pin's top corner, across and up. It is what an over-push cams the plug back with: a
## push held past the click wedges this corner under the shell's bore mouth, and a hand leaning
## hard enough rolls the plug back until the key pin is up in the shell — an overset. A pin set
## long enough ago has more plug under it than this corner is wide, and cannot be reached.
const KEY_TOP_CHAMFER_W := 0.15
const KEY_TOP_CHAMFER_H := 0.15
const KEY_TIP := 2.4
const KEY_TIP_HALF := 0.5
const DRIVER_HALF := 2.25
## How much further the plug must slide before each next chamber pinches, mm, at quality 1.
## It is also the ledge a newly set driver stands on.
const BIND_STEP := 0.07

# ── Materials ───────────────────────────────────────────────────────────────────────────
# Masses are numerical, not physical: every body here lives in drag, so mass only sets how
# quickly it reaches the speed its forces ask for. They are chosen so that, at the physics rate,
# each damper and the hand's spring integrate stably as plain explicit forces (a contact can only
# pass on what a body arrives with, so nothing may be hidden in an implicit step), and so the
# plug is only a few pins heavy — the contact solver settles a pinch by passing impulses between
# the plug, the pin and the shell, and it converges on the ratio of their masses.
const SPRING_PRELOAD := 0.3
const SPRING_RATE := 0.1
## Brass on brass, a little lower than life. It decides how hard the pinched pin is to lift,
## and whether a key pin jammed across the line stays jammed: under a working wrench it does,
## under a light one it slides back out.
const FRICTION := 0.25
const PIN_MASS := 1.7e-4
## N per mm/s: a driver rides its spring back at about 35 mm/s.
const PIN_DRAG := 0.009
const PIN_WEIGHT := 0.06
const PIN_MAX_SPEED := 150.0
const PLUG_MASS := 5.0e-4
## N per mm/s: under the default wrench a freed plug runs at about 14 mm/s.
const PLUG_DRAG := 0.12
const PLUG_MAX_SPEED := 40.0
## The pull that takes the plug home when the wrench comes off, N.
const PLUG_RETURN := 0.6
## The hand: a stiff spring that yields. N/mm, and the most it will put through the pick, N.
const HAND_K := 20.0
const HAND_MAX := 6.0
## The snap gun's shove on a driver: N per mm short of where it is thrown to, and the most it
## gives beyond carrying the spring. A driver the wrench is pinching harder than this stays put.
const STRIKE_K := 6.0
const STRIKE_MAX := 1.5
## The brake on a thrown pin, N per mm/s: about critical for a pin on that spring.
const STRIKE_DAMP := 0.06
## The push that sends an uncaught driver home again, N.
const STRIKE_HOME := 2.4
## How far past the last chamber's pinch the plug runs before it is plainly open, mm.
const OPEN_PAST := 0.25
const OPEN_RUN := 0.6

# ── The game's read ─────────────────────────────────────────────────────────────────────
enum { FREE, BINDING, FALSE_SET, SET, OVERSET }
const STATE_NAMES: Array[String] = ["FREE", "BINDING", "FALSE_SET", "SET", "OVERSET"]
## A key pin standing this far into the shell's bore is past the line.
const OVER_PUSH := 0.1

var def: Dictionary
var seed_value := 0
var count := 0
var depth := 0.0
var step := BIND_STEP
## Chamber data: x, set_lift, key_len, relief, bind_at, order, profile, security, grooves,
## key_rest_y, driver_rest_y.
var chambers: Array[Dictionary] = []
var keys: Array[RigPin] = []
var drivers: Array[RigPin] = []
var plug: RigPlug
var shell: StaticBody2D

## The wrench, N along the slide; 0 is off.
var wrench := 0.0
## The hand under each key pin: the key lift, mm, it is holding the pin up to — negative for
## no hand there. A spring of HAND_K up to HAND_MAX, as a hand is.
var hand_lift: PackedFloat32Array = PackedFloat32Array()
## Counter-rotation, against a wrench that stays on: EASE walks the plug back at `ease_rate`
## mm/s, HOLD keeps it from running forward past where it is, OFF lets the wrench have it.
enum { EASE_OFF, EASE_HOLD, EASE_BACK }
var ease_mode := EASE_OFF
## The snap gun's pins are in the air: the plug goes no further than a hair past where it is.
## A hair, not nothing — stopped dead it would stop leaning on the pin it is pinching, and a
## heavy wrench would no longer hold that pin down against the strike.
var strike_hold := false
const STRIKE_SLACK := 0.03
var ease_rate := 0.0

## Sidebar gates: per chamber, the band of key-pin-top heights (mm, [lo, hi], just under the
## line) its sidebar leg drops into — empty for a chamber with no gate. A sidebar reads the key
## pins: every pin can be set and the plug still will not open until each gated key pin has been
## lifted back up into its gate and held there a moment.
var gates: Array = []
var aligned: Array[bool] = []
var _gate_for: PackedFloat32Array = PackedFloat32Array()
## How long a key pin must be held in its gate for the leg to drop in, s.
## How long after the open the bodies keep moving, s: the plug's run to its stop.
const OPEN_SETTLE := 0.3
const GATE_DWELL := 0.3
## The snap gun's lift on each driver this tick, mm above rest; negative for none.
var strike_lift: PackedFloat32Array = PackedFloat32Array()
## Per chamber: the lift the snap gun's blade is throwing the key pin to, mm, or negative.
var strike_key: PackedFloat32Array = PackedFloat32Array()
## How hard this strike shoves, as a multiple of `STRIKE_MAX`: a soft strike is a weak shove, and
## will not lift a driver the wrench is pinching hard.
var strike_force := 1.0

var states: PackedInt32Array = PackedInt32Array()
var binding := -1
var opened := false
## Seconds since it opened; negative once the bodies have been frozen.
var _open_for := 0.0
var time := 0.0
var _counter_stop := INF
var _last_bind := 0.0
# Per-chamber numbers the tick reads, flat: looking them up by name 480 times a second adds up.
var _key_rest: PackedFloat32Array = PackedFloat32Array()
var _driver_rest: PackedFloat32Array = PackedFloat32Array()
var _key_half: PackedFloat32Array = PackedFloat32Array()
var _bind_at: PackedFloat32Array = PackedFloat32Array()
var _rim_x: PackedFloat32Array = PackedFloat32Array()
var _security: PackedByteArray = PackedByteArray()


static func mm(x: float, y: float) -> Vector2:
	return Vector2(x * S, -y * S)


## The lift that puts a chamber's key pin top on the shear line, from the lock's bitting. A
## security pin is never cut so shallow that its top groove starts above the line.
static func set_lift_for(bitting: float, profile: String) -> float:
	var game_lift := clampf(4.0 - bitting, 0.3, 2.6)
	return maxf(maxf(0.8, Profiles.minimum_set_lift(profile)), minf(2.225, 0.6 + 1.25 * game_lift))


## The seeded shuffle the binding order comes from.
static func bind_order(n: int, seed_in: int) -> Array[int]:
	var order: Array[int] = []
	for i in n:
		order.append(i)
	var x := seed_in & 0xFFFFFFFF
	var i := n - 1
	while i > 0:
		x = (x * 1664525 + 1013904223) & 0xFFFFFFFF
		var j := x % (i + 1)
		var t := order[i]
		order[i] = order[j]
		order[j] = t
		i -= 1
	return order


func build(lock_def: Dictionary, lock_seed: int) -> void:
	def = lock_def
	seed_value = lock_seed
	var bitting: Array = def["bitting"]
	var pins: Array = def["pins"]
	count = bitting.size()
	depth = FIRST_X + PITCH * (count - 1) + 3.5
	step = BIND_STEP * clampf(float(def.get("toleranceQuality", 1.0)), 0.7, 1.3)
	var order := bind_order(count, lock_seed)
	var shoulder := _key_shoulder_y()
	chambers.clear()
	_last_bind = 0.0
	for i in count:
		var profile: String = pins[i]
		var set_lift := set_lift_for(float(bitting[i]), profile)
		var relief := step * order[i]
		var key_len := -shoulder - set_lift
		chambers.append({
			"x": FIRST_X + PITCH * i,
			"set_lift": set_lift,
			# The key pin's body, shoulder to top: its top rests `set_lift` under the line.
			"key_len": key_len,
			"relief": relief,
			"bind_at": PLUG_CLEAR + SHELL_CLEAR + relief,
			"order": order[i],
			"profile": profile,
			"security": Profiles.is_security(profile),
			"grooves": Profiles.grooves(profile),
			"key_rest_y": shoulder + key_len / 2.0,
			"driver_rest_y": shoulder + key_len + DRIVER_HALF,
		})
		_last_bind = maxf(_last_bind, PLUG_CLEAR + SHELL_CLEAR + relief)
		_key_rest.append(shoulder + key_len / 2.0)
		_driver_rest.append(shoulder + key_len + DRIVER_HALF)
		_key_half.append(key_len / 2.0)
		_bind_at.append(PLUG_CLEAR + SHELL_CLEAR + relief)
		_rim_x.append(FIRST_X + PITCH * i - PIN_R - PLUG_CLEAR - relief)
		_security.append(1 if Profiles.is_security(profile) else 0)
	hand_lift.resize(count)
	hand_lift.fill(-1.0)
	strike_lift.resize(count)
	strike_lift.fill(-1.0)
	strike_key.resize(count)
	strike_key.fill(-1.0)
	_build_gates()
	states.resize(count)
	states.fill(FREE)
	_build_shell()
	_build_plug()
	_build_track()
	_build_pins()


func _build_gates() -> void:
	gates.clear()
	aligned.clear()
	_gate_for.resize(count)
	_gate_for.fill(0.0)
	var sidebar: Dictionary = def.get("sidebar", {})
	# This copy's condition, on its own random stream: a worn cylinder's gates are a shade wider.
	var condition := 1.0 + (Rng.create(seed_value ^ 0x9E3779B9).next_float() * 2.0 - 1.0) * 0.1
	var window := 0.62 * float(def.get("toleranceQuality", 1.0)) * condition
	const BAND := 0.6
	for i in count:
		aligned.append(false)
		var at := -1
		if not sidebar.is_empty():
			at = (sidebar["gatedChambers"] as Array).find(i)
		if at < 0:
			gates.append([])
			continue
		var positions: Array = sidebar.get("gatePositions", [])
		var pos := 0.5
		if at < positions.size():
			pos = float(positions[at])
		elif not positions.is_empty():
			pos = float(positions[0])
		var half := minf(0.45, float(sidebar["gateWidth"]) / maxf(1e-6, window)) * BAND
		var mid := -pos * BAND
		gates.append([mid - half, minf(-0.02, mid + half)])


func has_sidebar() -> bool:
	for g in gates:
		if not (g as Array).is_empty():
			return true
	return false


func sidebar_ok() -> bool:
	for i in count:
		if not (gates[i] as Array).is_empty() and not aligned[i]:
			return false
	return true


func in_gate(i: int) -> bool:
	return _gate_for[i] > 0.0


## Where a resting key pin's shoulder sits: its cone hangs through the slot until the lips
## catch it part-way up.
func _key_shoulder_y() -> float:
	var hang := KEY_TIP * (SLOT_HALF - KEY_TIP_HALF) / (PIN_R - KEY_TIP_HALF)
	return FLOOR_Y - hang + KEY_TIP


func _material(friction: float) -> PhysicsMaterial:
	var m := PhysicsMaterial.new()
	m.friction = friction
	m.bounce = 0.0
	return m


func _add_convex(body: CollisionObject2D, points: PackedVector2Array) -> void:
	var shape := ConvexPolygonShape2D.new()
	shape.points = points
	var node := CollisionShape2D.new()
	node.shape = shape
	body.add_child(node)


func _rect(x0: float, y0: float, x1: float, y1: float) -> PackedVector2Array:
	return PackedVector2Array([mm(x0, y0), mm(x1, y0), mm(x1, y1), mm(x0, y1)])


func _build_shell() -> void:
	shell = StaticBody2D.new()
	shell.name = "Shell"
	shell.collision_layer = L_SHELL
	shell.collision_mask = 0
	shell.physics_material_override = _material(FRICTION)
	add_child(shell)
	var rb := PIN_R + SHELL_CLEAR
	var ch := MOUTH_CHAMFER
	for k in count + 1:
		var left := -0.5 if k == 0 else float(chambers[k - 1]["x"]) + rb
		var right := depth if k == count else float(chambers[k]["x"]) - rb
		var pts := PackedVector2Array()
		# Underside, with the bore mouths' chamfers where a bore is beside it.
		if k > 0:
			pts.append(mm(left, SHEAR_GAP + ch))
			pts.append(mm(left + ch, SHEAR_GAP))
		else:
			pts.append(mm(left, SHEAR_GAP))
		if k < count:
			pts.append(mm(right - ch, SHEAR_GAP))
			pts.append(mm(right, SHEAR_GAP + ch))
		else:
			pts.append(mm(right, SHEAR_GAP))
		pts.append(mm(right, SEAT_Y + 1.0))
		pts.append(mm(left, SEAT_Y + 1.0))
		_add_convex(shell, pts)
	# The spring seats: the bores are closed at the top.
	_add_convex(shell, _rect(-0.5, SEAT_Y, depth, SEAT_Y + 1.0))


func _build_plug() -> void:
	plug = RigPlug.new()
	plug.name = "Plug"
	plug.collision_layer = L_PLUG
	plug.collision_mask = L_PIN
	plug.physics_material_override = _material(FRICTION)
	plug.custom_integrator = true
	plug.can_sleep = false
	plug.lock_rotation = true
	plug.gravity_scale = 0.0
	plug.mass = PLUG_MASS * MS
	plug.drag = PLUG_DRAG * FS / S
	plug.max_speed = PLUG_MAX_SPEED * S
	plug.stop_lo = 0.0
	plug.base = global_position
	add_child(plug)
	var rb := PIN_R + PLUG_CLEAR
	var ch := RIM_CHAMFER
	for k in count + 1:
		var left := -0.5 if k == 0 else float(chambers[k - 1]["x"]) + rb
		# The rim that pushes this bore's pins is cut back by the chamber's place in the binding
		# order: the plug has that much further to slide before it reaches the driver.
		var right := depth if k == count else float(chambers[k]["x"]) - rb - float(chambers[k]["relief"])
		# The top of the land, rim to rim.
		var top := PackedVector2Array()
		top.append(mm(left, -RIM_HEIGHT))
		top.append(mm(right, -RIM_HEIGHT))
		if k < count:
			top.append(mm(right, -ch))
			top.append(mm(right - ch, 0.0))
		else:
			top.append(mm(right, 0.0))
		if k > 0:
			top.append(mm(left + ch, 0.0))
			top.append(mm(left, -ch))
		else:
			top.append(mm(left, 0.0))
		_add_convex(plug, top)
		# The rest of it, cut back under the rim on the side that pushes.
		var stem_right := right if k == count else right - RIM_RELIEF
		_add_convex(plug, _rect(left, FLOOR_Y, stem_right, -RIM_HEIGHT))
	# The slot's lips under each bore, either side of the key pin's cone.
	for k in count:
		var x: float = chambers[k]["x"]
		_add_convex(plug, _rect(x - rb - float(chambers[k]["relief"]) - RIM_RELIEF - 0.6, FLOOR_Y - 0.6, x - SLOT_HALF,
			FLOOR_Y))
		_add_convex(plug, _rect(x + SLOT_HALF, FLOOR_Y - 0.6, x + rb + 0.2, FLOOR_Y))


func _build_track() -> void:
	# The plug only slides: a groove joint pins it to a track along the slide. (Rails it rested
	# on as contacts worked too, and cost more than every pin in the lock put together.)
	var groove := GrooveJoint2D.new()
	groove.name = "Track"
	groove.position = mm(-1.0, 0.0)
	groove.rotation = -PI / 2.0
	groove.length = (_last_bind + OPEN_RUN + 2.0) * S
	groove.initial_offset = 1.0 * S
	add_child(groove)
	groove.node_a = groove.get_path_to(shell)
	groove.node_b = groove.get_path_to(plug)


func _new_pin(pin_name: String) -> RigPin:
	var pin := RigPin.new()
	pin.name = pin_name
	pin.collision_layer = L_PIN
	pin.collision_mask = L_SHELL | L_PLUG | L_PIN
	pin.physics_material_override = _material(FRICTION)
	pin.custom_integrator = true
	pin.can_sleep = false
	# A pin slides in its bore; it does not tip. The bores guide it.
	pin.lock_rotation = true
	pin.gravity_scale = 0.0
	pin.mass = PIN_MASS * MS
	pin.drag = PIN_DRAG * FS / S
	pin.weight = PIN_WEIGHT * FS
	pin.max_speed = PIN_MAX_SPEED * S
	pin.base = global_position
	return pin


## Mirror a right-hand silhouette ([u, half_width] along the pin) into convex pieces: a piece
## runs for as long as the outline keeps turning the same way.
func _add_silhouette(body: RigPin, sil: Array[Vector2]) -> void:
	var start := 0
	var i := 1
	var last_slope := INF
	while i < sil.size():
		var du := sil[i].x - sil[i - 1].x
		var slope := (sil[i].y - sil[i - 1].y) / du if du > 1e-9 else INF
		if slope > last_slope + 1e-9 and i - 1 > start:
			_add_piece(body, sil, start, i - 1)
			start = i - 1
		last_slope = slope
		i += 1
	_add_piece(body, sil, start, sil.size() - 1)


func _add_piece(body: RigPin, sil: Array[Vector2], from: int, to: int) -> void:
	var pts := PackedVector2Array()
	for k in range(from, to + 1):
		pts.append(Vector2(sil[k].y * S, -sil[k].x * S))
	for k in range(to, from - 1, -1):
		pts.append(Vector2(-sil[k].y * S, -sil[k].x * S))
	_add_convex(body, pts)


## A key pin's right-hand silhouette: a cone that hangs into the keyway, a body, a chamfered top.
static func key_silhouette(key_len: float) -> Array[Vector2]:
	var h := key_len / 2.0
	return [
		Vector2(-h - KEY_TIP, KEY_TIP_HALF),
		Vector2(-h, PIN_R),
		Vector2(h - KEY_TOP_CHAMFER_H, PIN_R),
		Vector2(h, PIN_R - KEY_TOP_CHAMFER_W),
	]


func _build_pins() -> void:
	keys.clear()
	drivers.clear()
	for i in count:
		var c := chambers[i]
		var x: float = c["x"]
		var key_len: float = c["key_len"]

		var key := _new_pin("Key%d" % (i + 1))
		add_child(key)
		_add_silhouette(key, key_silhouette(key_len))
		key.position = mm(x, float(c["key_rest_y"]) + 0.002)
		keys.append(key)

		var drv := _new_pin("Driver%d" % (i + 1))
		add_child(drv)
		_add_silhouette(drv, Profiles.silhouette(c["profile"], PIN_R, PIN_BEVEL))
		var rest_y: float = c["driver_rest_y"]
		drv.position = mm(x, rest_y + 0.004)
		# A lock may give each chamber its own spring: lighter or stiffer than the usual one.
		drv.spring_preload = SPRING_PRELOAD * spring(i) * FS
		drv.spring_rate = SPRING_RATE * spring(i) * FS / S
		drv.spring_rest_y = -rest_y * S
		drivers.append(drv)


# ── Reading it back ─────────────────────────────────────────────────────────────────────

## How far the plug has slid, mm.
func shift() -> float:
	return plug.position.x / S


## What the hand is putting into chamber i's key pin, N.
## How strong chamber i's spring is, as a multiple of the usual one.
func spring(i: int) -> float:
	var springs: Variant = def.get("springs")
	if springs is Array and i < (springs as Array).size():
		return clampf(float(springs[i]), 0.5, 2.0)
	return 1.0


func hand_force(i: int) -> float:
	return keys[i].hand_force / FS


func key_lift(i: int) -> float:
	return -keys[i].position.y / S - _key_rest[i]


func driver_lift(i: int) -> float:
	return -drivers[i].position.y / S - _driver_rest[i]


## The key pin's top, mm above the shear line.
func key_top(i: int) -> float:
	return -keys[i].position.y / S + _key_half[i]


## The driver's bottom, mm above the plug's top (negative while it is in the plug).
func driver_foot(i: int) -> float:
	return (plug.position.y - drivers[i].position.y) / S - DRIVER_HALF


## How far the plug's rim stands under chamber i's driver, mm: the ledge. Negative before the
## plug has reached the driver at all.
func ledge(i: int) -> float:
	return _rim_x[i] + shift() - (drivers[i].position.x / S - PIN_R)


## An opened lock is finished: once the plug has run on to its stop the bodies are frozen where
## they are, so a lock left on show through its payoff costs the physics server nothing.
func _settle_open(delta: float) -> void:
	if _open_for < 0.0:
		return
	_open_for += delta
	if _open_for < OPEN_SETTLE:
		return
	_open_for = -1.0
	plug.freeze = true
	for i in count:
		keys[i].freeze = true
		drivers[i].freeze = true


func _physics_process(delta: float) -> void:
	if plug == null:
		return
	if opened:
		_settle_open(delta)
		return
	time += delta
	if wrench > 0.0:
		plug.drive = wrench * FS
		if ease_mode == EASE_BACK:
			# The stop walks back and the plug, still under the wrench, follows it down.
			_counter_stop = maxf(0.0, minf(_counter_stop, shift()) - ease_rate * delta)
		elif ease_mode == EASE_HOLD:
			_counter_stop = minf(_counter_stop, shift())
		elif strike_hold:
			_counter_stop = minf(_counter_stop, shift() + STRIKE_SLACK)
		else:
			_counter_stop = INF
	else:
		plug.drive = -PLUG_RETURN * FS
		_counter_stop = INF
	# Every pin set but a gate unmet: the sidebar is still in its groove and the plug stops just
	# past the last pinch, short of the open — it simply will not turn.
	var run := OPEN_RUN if sidebar_ok() else OPEN_PAST * 0.4
	plug.stop_hi = minf(_last_bind + run, _counter_stop) * S
	for i in count:
		var key := keys[i]
		if hand_lift[i] >= 0.0:
			key.hand_k = HAND_K * FS / S
			key.hand_max = HAND_MAX * FS
			key.hand_y = -(_key_rest[i] + hand_lift[i]) * S
		else:
			key.hand_k = 0.0
		# The snap gun's blade throws the driver, as the struck key pin does in a real one: a
		# stiff shove up to the height it is flicked to, no harder than STRIKE_MAX — and braked
		# as it gets there. Thrown without a brake a driver sails a millimetre past its mark,
		# every struck pin clears the line, and luck stops mattering.
		var drv := drivers[i]
		if strike_lift[i] == 0.0:
			# Sent home: pushed back down onto its key pin, harder than it was thrown and braked
			# the same way, so that not even one the plug is pinching is left part-way up.
			var falling := drv.linear_velocity.y / S
			drv.push = Vector2(0.0, clampf(STRIKE_HOME - STRIKE_DAMP * falling, 0.0, STRIKE_HOME) * FS) 				if driver_lift(i) > 0.02 else Vector2.ZERO
		elif strike_lift[i] > 0.0:
			var gap := strike_lift[i] - driver_lift(i)
			var rising := -drv.linear_velocity.y / S
			var carry := (SPRING_PRELOAD + SPRING_RATE * maxf(0.0, driver_lift(i))) * spring(i) + PIN_WEIGHT
			drv.push = Vector2(0.0, -clampf(carry + STRIKE_K * gap - STRIKE_DAMP * rising, -STRIKE_MAX,
				carry + STRIKE_MAX * strike_force) * FS)
		else:
			drv.push = Vector2.ZERO
		# The key pin is what the blade actually hits, and it jumps as hard: thrown to its own
		# mark under the line, braked the same way, and left to fall when the blade has gone.
		if strike_key[i] >= 0.0:
			var key_gap := strike_key[i] - key_lift(i)
			var key_rising := -key.linear_velocity.y / S
			key.push = Vector2(0.0, -clampf(PIN_WEIGHT + STRIKE_K * key_gap - STRIKE_DAMP * key_rising,
				-STRIKE_MAX, PIN_WEIGHT + STRIKE_MAX) * FS)
		else:
			key.push = Vector2.ZERO
	_read(delta)


func _read(delta: float) -> void:
	var plug_at := plug.position
	var s := plug_at.x / S
	var margin := step * 0.3
	binding = -1
	var all_set := true
	var best := INF
	for i in count:
		var bind_at := _bind_at[i]
		var driver_at := drivers[i].position
		var foot := (plug_at.y - driver_at.y) / S - DRIVER_HALF
		var over := _rim_x[i] + s - (driver_at.x / S - PIN_R)
		var was := states[i]
		var st := FREE
		if -keys[i].position.y / S + _key_half[i] > SHEAR_GAP + OVER_PUSH:
			st = OVERSET
		elif foot >= -0.012 and over > 0.03:
			st = SET
		elif was == SET and foot >= -0.05 and over > 0.0:
			# Still on its ledge: a set is not lost until the driver is back in the plug.
			st = SET
		elif _security[i] == 1 and foot < 0.0 and s > bind_at + (0.004 if was == FALSE_SET else margin):
			# The plug has slid past where this driver's full width would stop it, and the driver
			# is still across the line: the rim is in a groove.
			st = FALSE_SET
		elif wrench > 0.0 and foot < 0.0 and s > bind_at - 0.015 and bind_at < best:
			# The pin the plug is leaning on: the first in the binding order still across the line.
			best = bind_at
			binding = i
		states[i] = st
		if st != SET:
			all_set = false
	if binding >= 0:
		states[binding] = BINDING
	for i in count:
		var g: Array = gates[i]
		if g.is_empty():
			continue
		if states[i] != SET:
			aligned[i] = false
			_gate_for[i] = 0.0
			continue
		var top := key_top(i)
		_gate_for[i] = _gate_for[i] + delta if top >= float(g[0]) and top <= float(g[1]) else 0.0
		if _gate_for[i] >= GATE_DWELL:
			aligned[i] = true
	if all_set and s > _last_bind + (OPEN_PAST if sidebar_ok() else INF):
		opened = true
