class_name WheelEngine
extends RefCounted
## A combination wheel pack: the padlock's whole physics, as a deterministic 1-D rate model.
##
## Every wheel is a disc with ten detents. One angle on it presents a gate cut clear through —
## the true gate — and some carry shallow false gates beside it. The shackle is the wrench: pull
## it and its fence comes down on the pack, and because no two wheels are cut alike it lands on
## ONE of them first. That wheel drags under the thumb; the others turn free. Roll the dragging
## wheel onto its true gate and the fence drops through it, the drag moves on to the next wheel,
## and when every gate stands in line the shackle pulls out. A false gate lets the fence drop
## part-way and holds the wheel there until the pull is eased.
##
## Positions are in dial units: a full turn is `TRAVEL` (3.0), one digit is `DETENT` (0.3), and
## digit `d` parks at `detent_centre(d)`. `theta` is how far the shackle has actually travelled,
## in the same radians the rest of the game measures a plug's turn in.
##
## Step it at a fixed `DT` and never with a frame time: seed plus input sequence reproduces a run
## exactly, and it deals and steps number-for-number with the web game (tests/golden.gd).
## Nothing here touches a node, the clock or an unseeded random.

# ── Time ────────────────────────────────────────────────────────────────────────────────
const DT := 1.0 / 120.0

# ── The dial ────────────────────────────────────────────────────────────────────────────
const TRAVEL := 3.0
const DIGITS := 10
const DETENT := TRAVEL / DIGITS

# ── Tolerance: which wheel the fence lands on first ─────────────────────────────────────
## Radians of shackle travel before the loosest wheel binds.
const TOLERANCE_SPREAD := 0.02
## Two wheels binding at once is real but unreadable; keep them apart.
const MIN_DELTA_GAP := 0.0008

# ── Shackle travel ──────────────────────────────────────────────────────────────────────
const THETA_OPEN := 0.52
## Open at 98% of full travel, with every wheel seated — never on travel alone.
const OPEN_THETA_FRACTION := 0.98
## How deep a false gate is, as a fraction of a true one, and how much extra travel that buys.
const FALSE_GATE_DEPTH := 0.3
const FALSE_SET_GAIN := 1.05
## A false gate's bevel: how steeply it wedges the wheel back under the pull.
const FALSE_GATE_TAPER := 0.2
## Stiff spring: theta chases its target, capped so a false gate's swing reads as a swing.
const TAKEUP_RATE := 24.0
const MAX_RATE := 1.2
## Tension at which the hand is asking for the full stroke.
const T_FULL_TURN := 0.25

# ── The fence in a false gate ───────────────────────────────────────────────────────────
## Dial units per second the fence drives a wheel back down a false gate's bevel, at full pull.
const COUNTER_ROTATION_FORCE := 42.8
## Radians of travel past a wheel's delta over which the fence fully enters the notch.
const ENGAGE_RAMP := 0.003

# ── Holding what is seated ──────────────────────────────────────────────────────────────
## Below this the shackle is doing nothing at all: no bind, no capture.
const T_MIN_HOLD := 0.08
## What a freshly seated wheel needs to stay seated, before engagement relieves it.
const T_SET_HOLD := 0.18
const HOLD_ENGAGE_RELIEF := 0.75
## Travel past a wheel's delta at which the fence is fully home in its gate.
const LEDGE_FULL_ENGAGE := 0.12
## How long a seat survives a pull that is on but too light, seconds.
const SET_SLIP_GRACE := 0.25
## With the feather learned, how long anything held survives the pull being off entirely.
const FEATHER_WINDOW := 0.12
## Seconds on the gate before the fence is through it. Rolling straight past seats nothing.
const CAPTURE_TIME := 0.045

# ── The thumb ───────────────────────────────────────────────────────────────────────────
## Dial units per second a wheel turns; a pinched wheel turns slower the harder the pull.
const TURN_RATE := 26.0
const FREE_TURN_MULTIPLIER := 2.2
const BIND_HARDNESS := 3.2
## Wheels per second the hand crosses the pack at, and how much the pull slows it.
const HAND_TRAVEL_RATE := 14.0
const TENSION_TRAVEL_DRAG := 3.5
## A turning wheel is felt for this long after it stops. The motion is pulsed — detent to
## detent — and a meter fed the raw pulses would flicker at click rate.
const TURN_ENVELOPE := 0.18

# ── Resistance: what the wheel under the thumb feels like ───────────────────────────────
const RESIST_FLOOR := 0.02
const RESIST_BINDING_BASE := 0.42
const RESIST_BINDING_TENSION := 0.34
const RESIST_FALSE_BASE := 0.36
const RESIST_FALSE_TENSION := 0.26
const RESIST_FALSE_WOBBLE := 0.08
const RESIST_FALSE_HZ := 9.0
const RESIST_SET := 0.05
const RESIST_SET_CONTACT := 0.52
const SET_CONTACT := 0.5
const RESIST_FREE_BASE := 0.2
const RESIST_FREE_WOBBLE := 0.07
const RESIST_FREE_HZ := 3.5
## How far one wheel's feel may differ from its neighbour's, and how much that drags its turn.
const RESIST_WHEEL_BIAS := 0.07
const DRAG_RATE_SPREAD := 0.15
const SPRING_SPREAD := 0.22
const RESIST_PER_SPRING := 0.18

# ── Strain: a command held where the wheel cannot follow ────────────────────────────────
## The hand asking for a spot inside a detent the wheel will not leave its centre for is a
## load, and a load held long enough costs the hand its steadiness: more wobble, a slower
## turn. Dial units of overreach at which the force reading is full, and the strain it builds.
const FORCE_FULL := 0.9
const STRAIN_PER_UNIT_SECOND := 0.42
const STRAIN_RECOVERY := 0.55
const STRAIN_BENT := 1.0
const STRAIN_BROKEN := 2.4
const BENT_JITTER_FACTOR := 3.5
const BENT_RATE_FACTOR := 0.72

# ── Events ──────────────────────────────────────────────────────────────────────────────
## PLUG_MOVED and COUNTER_ROTATION are emitted every this many ticks.
const CONTINUOUS_EVENT_STRIDE := 4
const PLUG_MOVED_EPSILON := 1e-5
## Keep the queue bounded for headless runs that never drain it.
const MAX_PENDING_EVENTS := 8192

## The hand the game is played with: one pull, a competent thumb. `reach` is how many wheels
## in from the first the hand can get to.
const KIT := {
	"tension_min": 0.05,
	"tension_max": 1.0,
	"tension_slew": 4.0,
	"tension_precision": 0.03,
	"reach": 100,
	"jitter": 0.035,
	"rate": 1.0,
	"strength": 1.1,
}

## A wheel's state. The numbering matches the pin locks' (`LockRig`), so `Pal.state_color`
## paints both; a wheel has no overset — a gate is a slot, and turning past it just leaves it.
enum { FREE, BINDING, FALSE_SET, SET }
const STATE_NAMES: Array[String] = ["FREE", "BINDING", "FALSE_SET", "SET"]
## What stands under the fence: plain rim, a false gate, or the true one.
enum { SOLID, GROOVE, WINDOW }
const GEOMETRY_NAMES: Array[String] = ["SOLID", "GROOVE", "WINDOW"]


## One wheel of the pack.
class Wheel:
	extends RefCounted
	var index := 0
	## Where the true gate is, and where the false ones are, in dial units.
	var gate := 0.0
	var false_gates := PackedFloat64Array()
	## How wide every gate on this wheel is.
	var gate_width := 0.0
	## Radians of shackle travel before the fence lands on this wheel. The pack binds in
	## ascending order of it.
	var delta := 0.0
	## This wheel's own feel — bore finish, a burr — added to every reading, and the same roll
	## as a rate: a wheel that reads heavy turns slow.
	var bias := 0.0
	var spring := 1.0
	var drag := 1.0

	var pos := 0.0
	var state := 0
	var geometry := 0
	## Which false gate is under the fence, -1 when none is.
	var notch := -1
	## Seconds spent on the true gate with the fence bearing.
	var capture_timer := 0.0
	## Seconds this held wheel has spent under the pull it needs.
	var below_hold_for := 0.0
	## Dial units per second the fence is driving this wheel back down a false gate.
	var counter_force := 0.0
	## True once this wheel has lied at least once since the last full reset.
	var has_false_set := false

	## The digit showing in the window.
	func digit() -> int:
		return clampi(int(floor(pos / WheelEngine.DETENT)), 0, WheelEngine.DIGITS - 1)


var def: Dictionary
var seed_value := 0
## &"training" or &"normal". The ladder is instrumentation: it changes what a view may show,
## never what happens here.
var assist: StringName = &"normal"
var tools: Dictionary = KIT
## The feather: a short forgiveness when the pull drops out entirely.
var feather_enabled := false

var wheels: Array[Wheel] = []
var count := 0

## The pull, 0..1, as the fence feels it: the command plus the hand's wobble.
var tension := 0.0
## The pull before the wobble.
var tension_commanded := 0.0
var tension_wobble := 0.0
## The thumb's wobble, dial units.
var pick_wobble := 0.0
## How far the shackle has travelled, and the most the pack and the hand will let it.
var theta := 0.0
var theta_max := 0.0
var theta_demand := 0.0
var theta_velocity := 0.0
## The wheel the fence is bearing on, or -1.
var binding := -1
## The wheel under the thumb, or -1; and where the hand is between wheels on its way there.
var pick_wheel := -1
var pick_position := -1.0
## What the wheel under the thumb is giving back, 0..1 — the family's whole tell.
var resistance := 0.0
## 1 while the wheel under the thumb is turning, decaying to 0 once it parks. A wheel speaks
## only under motion: a still hand feels nothing on a real one.
var wheel_turn := 0.0
var pick_force := 0.0
var pick_contact := 0.0
var pick_strain := 0.0
var pick_bent := false
var pick_broken := false
var opened := false
## Simulated seconds, and whole ticks.
var time := 0.0
var ticks := 0
var below_min_hold_for := 0.0
## True once the pull has been meaningfully on since the last full reset.
var engaged := false
## Every wheel seated but the pull too light to draw the shackle: said once, re-armed on loss.
var plug_free_announced := false
var rng: Rng
## What happened, oldest first. Each is {"type": StringName, ...}; take them with `drain_events`.
var events: Array[Dictionary] = []
var stats := {
	"set_order": [],
	"bind_order": [],
	"oversets": 0,
	"full_resets": 0,
	"feathers": 0,
	"false_sets": 0,
	"max_counter_force": 0.0,
	"max_resistance": 0.0,
	"max_tension": 0.0,
	"min_tension_while_held": 1.0,
	"elapsed": 0.0,
}


## Where digit `d` parks.
static func detent_centre(d: int) -> float:
	return (d + 0.5) * DETENT


## Snap a commanded position to the centre of the detent it is inside. A detent is a slot the
## wheel drops into, so the whole span of one digit maps to that digit's centre.
static func quantize(pos: float) -> float:
	var d := minf(DIGITS - 1, maxf(0.0, floor(pos / DETENT)))
	return (d + 0.5) * DETENT


## A dial position brought into [0, TRAVEL) the way the engine wraps one.
static func wrap_pos(pos: float) -> float:
	return fmod(fmod(pos, TRAVEL) + TRAVEL, TRAVEL)


## Deal a lock against a seed. `def` is a roster dictionary (family "combination");
## `options` may carry "tools" (see `KIT`) and "feather" (bool).
static func create(lock_def: Dictionary, lock_seed: int, assist_mode: StringName,
		options: Dictionary = {}) -> WheelEngine:
	var e := WheelEngine.new()
	e.def = lock_def
	e.seed_value = lock_seed
	e.assist = assist_mode
	e.tools = options.get("tools", KIT)
	e.feather_enabled = options.get("feather", false)
	e.rng = Rng.create(lock_seed)
	e._deal()
	e.events.append({"type": &"ATTEMPT_STARTED", "time": 0.0})
	return e


func _deal() -> void:
	var discs: Dictionary = def["discs"]
	var gates: Array = discs["trueGates"]
	var lies: Array = discs["falseGates"]
	count = gates.size()
	var spread: float = def.get("toleranceSpread", TOLERANCE_SPREAD)

	# Distinct, well-separated offsets, built rather than rejection-sampled: draw inside the
	# interval shrunk by the gaps, sort, then push the i-th up by i gaps. Shuffled onto the
	# wheels so the binding order belongs to the seed rather than to the combination.
	var usable := spread - (count - 1) * MIN_DELTA_GAP
	var sorted: Array[float] = []
	for i in count:
		sorted.append(rng.next_float() * usable)
	sorted.sort()
	for i in count:
		sorted[i] = sorted[i] + i * MIN_DELTA_GAP
	var assignment: Array = rng.shuffle(range(count))
	var deltas: Array[float] = []
	deltas.resize(count)
	for i in count:
		deltas[assignment[i]] = sorted[i]

	wheels.clear()
	for i in count:
		var w := Wheel.new()
		w.index = i
		w.gate = float(gates[i])
		w.false_gates = PackedFloat64Array(lies[i])
		w.gate_width = float(discs["gateWidth"])
		w.delta = deltas[i]
		# One roll, two consequences: what the wheel feels like and how fast it turns.
		w.bias = (rng.next_float() * 2.0 - 1.0) * RESIST_WHEEL_BIAS
		w.drag = 1.0 - (w.bias / RESIST_WHEEL_BIAS) * DRAG_RATE_SPREAD
		# A pack starts parked: every wheel resting on a digit dealt from the seed. Never its
		# true one (nothing seats for free), never a false gate's (a wheel dealt inside its own
		# notch would arm a false set before the first touch), and never 0 or 9 — a row of
		# those reads as a lock nobody has set, not as one that is parked.
		var banned := {int(floor(w.gate / DETENT)): true, 0: true, DIGITS - 1: true}
		for g in w.false_gates:
			banned[int(floor(g / DETENT))] = true
		var open: Array[int] = []
		for d in DIGITS:
			if not banned.has(d):
				open.append(d)
		w.pos = detent_centre(open[int(floor(rng.next_float() * open.size()))])
		w.spring = 1.0 + (rng.next_float() * 2.0 - 1.0) * SPRING_SPREAD
		wheels.append(w)


## Take the events accumulated since the last drain.
func drain_events() -> Array[Dictionary]:
	var out := events
	events = []
	return out


## True when every wheel is seated and the shackle has still not been drawn: the pull is too
## light to finish the stroke.
func seated_but_held() -> bool:
	if opened or theta >= THETA_OPEN * OPEN_THETA_FRACTION:
		return false
	for w in wheels:
		if w.state != SET:
			return false
	return true


## How many wheels are seated.
func seated_count() -> int:
	var n := 0
	for w in wheels:
		if w.state == SET:
			n += 1
	return n


## The pull a seated wheel needs to stay seated. `theta - delta` is how far the shackle has
## travelled since the fence reached this wheel — how much of the fence is in the gate. A
## wheel seated a moment ago is held by a sliver and needs the full `T_SET_HOLD`; one the
## shackle has swung well past needs a quarter of it.
func hold_threshold(w: Wheel) -> float:
	var engaged_frac := clampf((theta - w.delta) / LEDGE_FULL_ENGAGE, 0.0, 1.0)
	return T_SET_HOLD * (1.0 - HOLD_ENGAGE_RELIEF * engaged_frac)


## Advance one tick. `input` is what the hands want:
##   "wheel": int   — the wheel the thumb is on, -1 for none
##   "pos": float   — where that wheel is being turned to, dial units
##   "pull": bool   — the shackle is being pulled
##   "level": float — how hard, 0..1 (the game always pulls at `WheelLockView.PULL`)
func step(input: Dictionary, dt: float = DT) -> void:
	var in_wheel: int = input.get("wheel", -1)
	var in_pos: float = input.get("pos", 0.0)
	var in_pull: bool = input.get("pull", false)
	var in_level: float = input.get("level", 0.0)

	# ── 1. The pull, rate-limited ───────────────────────────────────────────────────────
	var requested := 0.0
	if in_pull:
		requested = clampf(in_level, tools["tension_min"], tools["tension_max"])
	tension_commanded = _move_toward(tension_commanded, requested, tools["tension_slew"] * dt)
	var precision: float = tools["tension_precision"]
	if precision > 0.0:
		tension_wobble = _damp(tension_wobble, rng.next_signed(precision), 6.0, dt)
	else:
		tension_wobble = 0.0
	tension = clampf(tension_commanded + tension_wobble, 0.0, 1.0) if tension_commanded > 1e-4 else 0.0
	var t := tension
	if t > stats["max_tension"]:
		stats["max_tension"] = t
	if t >= T_MIN_HOLD and t < stats["min_tension_while_held"]:
		stats["min_tension_while_held"] = t

	# ── 2. The thumb ────────────────────────────────────────────────────────────────────
	# The hand travels across the pack rather than jumping, and slower under the pull. Putting
	# it on the lock is one motion and lands where it was aimed; taking it off is immediate.
	var reach: int = tools["reach"]
	var prev_pick := pick_wheel
	var wanted := in_wheel
	if wanted < 0 or wanted >= count or wanted >= reach:
		wanted = -1
	if wanted < 0:
		pick_position = -1.0
	elif pick_position < 0.0:
		pick_position = float(wanted)
	else:
		var travel := HAND_TRAVEL_RATE / (1.0 + TENSION_TRAVEL_DRAG * t)
		pick_position = _move_toward(pick_position, float(wanted), travel * dt)
	var pick := -1 if pick_position < 0.0 else mini(reach - 1, int(round(pick_position)))
	pick_wheel = pick
	# True once the thumb has arrived on the wheel it was sent to. A hand crossing the pack
	# does not turn the wheels it passes.
	var settled := pick >= 0 and pick == wanted
	if pick != prev_pick:
		events.append({"type": &"PICK_MOVED", "from": prev_pick, "to": pick, "time": time})

	var jitter: float = tools["jitter"] * (BENT_JITTER_FACTOR if pick_bent else 1.0)
	if jitter > 0.0:
		pick_wobble = _damp(pick_wobble, rng.next_signed(jitter), 9.0, dt)
	else:
		pick_wobble = 0.0

	# ── 3. Losing the pull — per wheel, not all at once ─────────────────────────────────
	# Every held wheel has its own threshold. A seated one is relieved by how far the fence is
	# home; a wheel caught in a false gate is wedged rather than resting, so engagement buys
	# it nothing and it holds down to the floor. Ease the shackle and the least-committed seat
	# lets go first; let go entirely and everything does — which is the way out of a lie.
	var grace := FEATHER_WINDOW if feather_enabled else 0.0
	var any_slipped := false
	for w in wheels:
		if w.state != SET and w.state != FALSE_SET:
			w.below_hold_for = 0.0
			continue
		var threshold := hold_threshold(w) if w.state == SET else T_MIN_HOLD
		if t < threshold:
			w.below_hold_for += dt
			if w.below_hold_for > _slip_cutoff(t, grace):
				any_slipped = true
		else:
			w.below_hold_for = 0.0
	if engaged and any_slipped:
		var dropped: Array[int] = []
		var cutoff := _slip_cutoff(t, grace)
		for w in wheels:
			if (w.state == SET or w.state == FALSE_SET) and w.below_hold_for > cutoff:
				dropped.append(w.index)
				w.state = FREE
				w.capture_timer = 0.0
				w.counter_force = 0.0
				w.below_hold_for = 0.0
				w.has_false_set = false
				stats["set_order"].erase(w.index)
		# A full reset means the attempt was ruined. Losing the newest seat and keeping the
		# rest is the technique working, not the lock winning.
		var any_seated := false
		for w in wheels:
			if w.state == SET:
				any_seated = true
		if not any_seated:
			stats["full_resets"] += 1
			stats["set_order"].clear()
			stats["bind_order"].clear()
			engaged = false
		events.append({"type": &"RESET", "kind": "full", "dropped": dropped, "time": time})

	if t < T_MIN_HOLD:
		below_min_hold_for += dt
	else:
		below_min_hold_for = 0.0
		engaged = true

	# ── 4. Turning: the thumb, then the fence shoving back ──────────────────────────────
	var binding_last := binding
	wheel_turn = maxf(0.0, wheel_turn - dt / TURN_ENVELOPE)
	var bend_loss := BENT_RATE_FACTOR if pick_bent else 1.0
	for w in wheels:
		var pinched := w.index == binding_last or w.state == FALSE_SET
		var rate: float = tools["rate"] * bend_loss * w.drag
		var turn_rate := (TURN_RATE / (1.0 + BIND_HARDNESS * t)) * rate if pinched \
				else TURN_RATE * FREE_TURN_MULTIPLIER * rate
		# A wheel has no spring, so nothing returns it, and the thumb is a turner rather than
		# a floor: it drives the wheel toward the commanded detent in either direction. A
		# seated wheel is never pinned — the fence cams out of the gate under the thumb.
		if w.index == pick and settled:
			# A dial is a circle: the short way round, through the 9/0 seam when that is
			# nearer. The command snaps to a detent centre, so the wheel travels through the
			# space between clicks but only ever parks on a digit.
			var want := quantize(clampf(in_pos + pick_wobble, 0.0, TRAVEL))
			var step_max := turn_rate * dt
			var d := want - w.pos
			if d > TRAVEL / 2.0:
				d -= TRAVEL
			elif d < -TRAVEL / 2.0:
				d += TRAVEL
			var before := w.pos
			var moved := want if absf(d) <= step_max else w.pos + signf(d) * step_max
			w.pos = fmod(fmod(moved, TRAVEL) + TRAVEL, TRAVEL)
			if absf(w.pos - before) > 1e-6:
				wheel_turn = 1.0
		# Rolled off its gate: the seat is gone, and the bind comes straight back to this
		# wheel next tick — which is exactly the tell a scrambled wheel gives.
		if w.state == SET and absf(w.pos - w.gate) > w.gate_width / 2.0:
			w.state = FREE
			w.capture_timer = 0.0
		_counter_rotate(w, t, dt)
		w.pos = clampf(w.pos, 0.0, TRAVEL)

	# ── 5. What stands under the fence ──────────────────────────────────────────────────
	# ── 6. Capture: time on the true gate, with the fence bearing ───────────────────────
	# A seated wheel is left alone until something has moved it off its gate's centre.
	for w in wheels:
		if w.state == SET and not (w.pos > w.gate + 1e-9):
			continue
		_read(w)
	for w in wheels:
		if w.state == SET and not (w.pos > w.gate + 1e-9):
			continue
		if w.geometry == WINDOW and w.index == binding_last and t >= T_MIN_HOLD:
			w.capture_timer += dt
			if w.capture_timer >= CAPTURE_TIME:
				w.state = SET
				w.capture_timer = 0.0
				stats["set_order"].append(w.index)
				events.append({"type": &"PIN_SET", "chamber": w.index, "tension": t, "time": time})
		else:
			w.capture_timer = 0.0

	# ── 7. How far the shackle may travel, and travelling ───────────────────────────────
	# The wheel that stops it is the unseated one with the smallest delta; a false gate under
	# the fence lends its depth on top.
	var limit := THETA_OPEN
	var limiter := -1
	for w in wheels:
		var con := w.delta
		if w.state == SET:
			con = THETA_OPEN
		elif w.geometry == GROOVE:
			con = w.delta + _notch_depth(w) * FALSE_SET_GAIN
		if limiter == -1 or con < limit:
			limit = con
			limiter = w.index
	theta_max = minf(limit, THETA_OPEN)
	theta_demand = THETA_OPEN * minf(1.0, t / T_FULL_TURN)
	var target := minf(theta_max, theta_demand)
	var prev_theta := theta
	var v := clampf((target - theta) * TAKEUP_RATE, -MAX_RATE, MAX_RATE)
	var moved_theta := theta + v * dt
	theta = minf(moved_theta, target) if v >= 0.0 else maxf(moved_theta, target)
	if theta < 0.0:
		theta = 0.0
	theta_velocity = (theta - prev_theta) / dt

	# ── 8. Roles: which wheel the fence is actually bearing on ──────────────────────────
	# A false gate under the fence only stops being a bind once the shackle has travelled far
	# enough to drop into it — the same condition that makes it a false set, so the two never
	# disagree for a tick.
	var now_binding := -1
	if limiter >= 0 and t >= T_MIN_HOLD:
		var lw := wheels[limiter]
		var in_notch := lw.geometry == GROOVE and theta >= lw.delta
		if lw.state != SET and not in_notch:
			now_binding = limiter
	binding = now_binding
	if binding >= 0:
		var order: Array = stats["bind_order"]
		if order.is_empty() or order[-1] != binding:
			order.append(binding)
	for w in wheels:
		if w.state == SET:
			continue
		var before_state := w.state
		if w.geometry == GROOVE and theta >= w.delta:
			w.state = FALSE_SET
		elif w.index == binding:
			w.state = BINDING
		else:
			w.state = FREE
		if w.state == FALSE_SET and before_state != FALSE_SET:
			w.has_false_set = true
			stats["false_sets"] += 1
			events.append({"type": &"FALSE_SET_ENTERED", "chamber": w.index,
					"depth": _notch_depth(w), "time": time})

	# ── 9. Open — never on travel alone ─────────────────────────────────────────────────
	var all_set := true
	for w in wheels:
		if w.state != SET:
			all_set = false
	if not opened and all_set and theta >= THETA_OPEN * OPEN_THETA_FRACTION:
		opened = true
		events.append({"type": &"LOCK_OPENED", "time": time, "ticks": ticks})
	var free := not opened and all_set and theta < THETA_OPEN * OPEN_THETA_FRACTION
	if free and not plug_free_announced:
		events.append({"type": &"PLUG_FREE", "time": time})
	plug_free_announced = free

	# ── 10. What the hand feels ─────────────────────────────────────────────────────────
	# On a wheel the load is the turn: the reading is scaled by `wheel_turn`, so the drag
	# shows only while the wheel moves and a parked one goes quiet.
	var felt: Wheel = wheels[pick] if pick >= 0 else null
	pick_contact = wheel_turn if felt != null else 0.0
	resistance = _resistance_for(felt, t, pick_contact)
	if resistance > stats["max_resistance"]:
		stats["max_resistance"] = resistance
	var overreach := 0.0
	if felt != null and settled:
		overreach = maxf(0.0, minf(in_pos, TRAVEL) - felt.pos)
	pick_force = clampf(overreach / FORCE_FULL, 0.0, 1.0)
	if not pick_broken:
		if overreach > 0.0:
			pick_strain += (overreach * STRAIN_PER_UNIT_SECOND * dt) / maxf(0.1, tools["strength"])
		else:
			pick_strain = maxf(0.0, pick_strain - STRAIN_RECOVERY * dt)
		if not pick_bent and pick_strain >= STRAIN_BENT:
			pick_bent = true
			events.append({"type": &"PICK_BENT", "time": time})
		if pick_strain >= STRAIN_BROKEN:
			pick_broken = true
			events.append({"type": &"PICK_BROKEN", "time": time})

	if ticks % CONTINUOUS_EVENT_STRIDE == 0:
		if absf(theta - prev_theta) > PLUG_MOVED_EPSILON:
			events.append({"type": &"PLUG_MOVED", "theta": theta, "velocity": theta_velocity, "time": time})
		for w in wheels:
			if w.counter_force > 0.05:
				events.append({"type": &"COUNTER_ROTATION", "chamber": w.index,
						"force": w.counter_force, "time": time})
	if events.size() > MAX_PENDING_EVENTS:
		events = events.slice(events.size() - MAX_PENDING_EVENTS)

	ticks += 1
	time += dt
	stats["elapsed"] = time


## The grace a held wheel gets before a slip counts. With the pull off entirely it is the
## feather's window or nothing; with it on but too light, a quarter second — long enough to
## notice and correct, far too short to lean on.
func _slip_cutoff(t: float, grace: float) -> float:
	if t < T_MIN_HOLD:
		return grace
	return maxf(grace, SET_SLIP_GRACE)


## Classify what is under the fence from the wheel's position alone. Which wheel is *the*
## binding one is decided later, because that depends on every other wheel.
func _read(w: Wheel) -> void:
	var half := w.gate_width / 2.0
	if absf(w.pos - w.gate) <= half:
		w.geometry = WINDOW
		w.notch = -1
		return
	for i in w.false_gates.size():
		if absf(w.pos - w.false_gates[i]) <= half:
			w.geometry = GROOVE
			w.notch = i
			return
	w.geometry = SOLID
	w.notch = -1


func _notch_depth(w: Wheel) -> float:
	return 0.0 if w.notch < 0 else FALSE_GATE_DEPTH


## The fence in a false gate wedges against the notch's bevel and drives the wheel back, to the
## notch's low edge and no further: the pull you are applying, the steepness of the bevel, and
## how far into the notch the fence has actually got.
func _counter_rotate(w: Wheel, t: float, dt: float) -> void:
	if w.state != FALSE_SET:
		w.counter_force = 0.0
		return
	var engage := clampf((theta - w.delta) / ENGAGE_RAMP, 0.0, 1.0)
	var taper := 0.0 if w.notch < 0 else FALSE_GATE_TAPER
	w.counter_force = COUNTER_ROTATION_FORCE * t * (0.25 + taper) * engage
	if w.counter_force > 0.0:
		if w.counter_force > stats["max_counter_force"]:
			stats["max_counter_force"] = w.counter_force
		var notch_floor := 0.0
		if w.notch >= 0 and w.notch < w.false_gates.size():
			notch_floor = w.false_gates[w.notch] - w.gate_width / 2.0 + 1e-4
		w.pos = maxf(notch_floor, w.pos - w.counter_force * dt)


func _resistance_for(w: Wheel, t: float, pressure: float) -> float:
	if w == null:
		return 0.0
	var base := 0.0
	match w.state:
		BINDING:
			base = RESIST_BINDING_BASE + RESIST_BINDING_TENSION * t
		FALSE_SET:
			base = RESIST_FALSE_BASE + RESIST_FALSE_TENSION * t \
					+ RESIST_FALSE_WOBBLE * sin(2.0 * PI * RESIST_FALSE_HZ * time)
		SET:
			var closing := clampf(1.0 - maxf(0.0, w.pos) / SET_CONTACT, 0.0, 1.0)
			base = RESIST_SET + (RESIST_SET_CONTACT - RESIST_SET) * closing
		_:
			base = RESIST_FREE_BASE + RESIST_FREE_WOBBLE * sin(2.0 * PI * RESIST_FREE_HZ * time + w.index)
	var character := w.bias + (w.spring - 1.0) * RESIST_PER_SPRING
	var full := clampf(base + character, RESIST_FLOOR, 1.0)
	return RESIST_FLOOR + (full - RESIST_FLOOR) * clampf(pressure, 0.0, 1.0)


static func _move_toward(from: float, to: float, max_delta: float) -> float:
	var d := to - from
	if d > max_delta:
		return from + max_delta
	if d < -max_delta:
		return from - max_delta
	return to


## Exponential smoothing that is stable at any dt.
static func _damp(current: float, target: float, rate: float, dt: float) -> float:
	return target + (current - target) * exp(-rate * dt)
