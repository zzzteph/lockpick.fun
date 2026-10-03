extends SceneTree
## Headless: the wheel engine against reference traces from the web game's engine.
##
##   godot --headless --path godot -s res://wheels/tests/golden.gd -- [verbose]
##
## `wheel_golden.json` holds, for each of the roster's wheel packs on several seeds and hands:
## the dealt pack, an input tape, the state at sampled ticks (with a running digest covering
## every tick between), every event, and the final tallies — plus the solver's own tapes.
## Floats are stored as their IEEE-754 bits, so the reference is exact. This replays each tape
## and demands the same numbers to within `TOLERANCE`, and the same discrete state and events
## exactly; it also reports how much was bit-identical.

const TOLERANCE := 1e-9
const FIXTURE := "res://wheels/tests/wheel_golden.json"

## The hands the reference was recorded with, as engine tool dictionaries.
const TOOLSETS := {
	"kit": WheelEngine.KIT,
	"starter": {
		"tension_min": 0.15,
		"tension_max": 0.85,
		"tension_slew": 4.0,
		"tension_precision": 0.04,
		"reach": 4,
		"jitter": 0.05,
		"rate": 1.0,
		"strength": 1.0,
	},
	"perfect": {
		"tension_min": 0.0,
		"tension_max": 1.0,
		"tension_slew": 12.0,
		"tension_precision": 0.0,
		"reach": 100,
		"jitter": 0.0,
		"rate": 1.0,
		"strength": 1000.0,
	},
}

const SCALARS: Array[String] = [
	"ticks", "time", "tension", "tension_commanded", "tension_wobble", "pick_wobble", "theta",
	"theta_max", "theta_demand", "theta_velocity", "binding", "pick_wheel", "pick_position",
	"resistance", "wheel_turn", "pick_force", "pick_contact", "pick_strain", "pick_bent",
	"pick_broken", "opened", "below_min_hold_for", "engaged", "plug_free_announced",
	"rng.a", "rng.b", "rng.c", "rng.d",
]
const WHEEL_FIELDS: Array[String] = [
	"pos", "state", "geometry", "notch", "capture_timer", "below_hold_for", "counter_force",
	"has_false_set",
]
const EVENT_FLOATS: Array[String] = ["time", "tension", "theta", "velocity", "depth", "force"]

var verbose := false
var failures: Array[String] = []
var checks := 0
## Per field: how many float comparisons, how many were not bit-identical, the worst difference.
var float_stats := {}
var _bytes := PackedByteArray()


func _initialize() -> void:
	verbose = OS.get_cmdline_user_args().has("verbose")
	_bytes.resize(8)
	var text := FileAccess.get_file_as_string(FIXTURE)
	if text.is_empty():
		print("FAIL cannot read ", FIXTURE)
		quit(1)
		return
	var doc: Dictionary = JSON.parse_string(text)

	_check_roster(doc["locks"])
	var deals: Array = doc["deals"]
	for d: Dictionary in deals:
		_check_deal("deal/%d/%d" % [int(d["lock"]), int(d["seed"])],
				WheelEngine.create(Roster.by_id(int(d["lock"])), int(d["seed"]), &"normal"), d["deal"])
	print("deals: %d packs dealt" % deals.size())

	var traces: Array = doc["traces"]
	for t: Dictionary in traces:
		_run_trace(t)
	print("traces: %d replayed" % traces.size())

	var solves: Array = doc["solves"]
	for s: Dictionary in solves:
		_check_solve(s)
	print("solver: %d solves reproduced" % solves.size())

	var inexact := PackedStringArray()
	var worst := 0.0
	var compared := 0
	for key: String in float_stats:
		var st: Array = float_stats[key]
		compared += st[0]
		worst = maxf(worst, st[2])
		if st[1] > 0:
			inexact.append("%s (%d of %d, worst %s)" % [key, st[1], st[0], str(st[2])])
	print("floats: %d compared, worst difference %s" % [compared, str(worst)])
	print("not bit-identical: ", "none" if inexact.is_empty() else ", ".join(inexact))
	print("---- %d checks, %d failed" % [checks, failures.size()])
	for i in mini(failures.size(), 40):
		print("FAIL ", failures[i])
	quit(1 if not failures.is_empty() else 0)


# ── Reading the reference ───────────────────────────────────────────────────────────────

## A reference float: 16 hex digits of IEEE-754 bits, or a bare number.
func _f(v: Variant) -> float:
	if v is String:
		var s: String = v
		_bytes.encode_u32(4, s.substr(0, 8).hex_to_int())
		_bytes.encode_u32(0, s.substr(8, 8).hex_to_int())
		return _bytes.decode_double(0)
	return float(v)


func _fail(where: String, what: String) -> void:
	failures.append("%s: %s" % [where, what])


func _same_float(where: String, field: String, got: float, want: Variant) -> void:
	checks += 1
	var ref := _f(want)
	var diff := absf(got - ref)
	if not float_stats.has(field):
		float_stats[field] = [0, 0, 0.0]
	var st: Array = float_stats[field]
	st[0] += 1
	if got != ref:
		st[1] += 1
		st[2] = maxf(st[2], diff)
	if not (diff <= TOLERANCE):
		_fail(where, "%s = %.17f, reference %.17f" % [field, got, ref])


func _same_int(where: String, field: String, got: int, want: Variant) -> void:
	checks += 1
	if got != int(want):
		_fail(where, "%s = %d, reference %d" % [field, got, int(want)])


# ── The roster and the deal ─────────────────────────────────────────────────────────────

## The roster's wheel packs carry the gates the reference was recorded with.
func _check_roster(locks: Array) -> void:
	for l: Dictionary in locks:
		var def := Roster.by_id(int(l["id"]))
		var where := "roster/%d" % int(l["id"])
		checks += 1
		if def.is_empty() or def["family"] != "combination" or def["slug"] != l["slug"]:
			_fail(where, "not the reference's wheel pack")
			continue
		var mine: Dictionary = def["discs"]
		var theirs: Dictionary = l["discs"]
		var my_gates: Array = mine["trueGates"]
		var their_gates: Array = theirs["trueGates"]
		var same: bool = absf(float(mine["gateWidth"]) - float(theirs["gateWidth"])) < 1e-12 				and my_gates.size() == their_gates.size()
		if same:
			for i in my_gates.size():
				var my_lies: Array = mine["falseGates"][i]
				var their_lies: Array = theirs["falseGates"][i]
				same = same and absf(float(my_gates[i]) - float(their_gates[i])) < 1e-12
				same = same and my_lies.size() == their_lies.size()
				if same:
					for k in my_lies.size():
						same = same and absf(float(my_lies[k]) - float(their_lies[k])) < 1e-12
		if not same:
			_fail(where, "gates differ from the reference's")


func _check_deal(where: String, e: WheelEngine, deal: Array) -> void:
	_same_int(where, "count", e.count, deal.size())
	if e.count != deal.size():
		return
	for i in e.count:
		var w := e.wheels[i]
		var d: Dictionary = deal[i]
		var at := "%s wheel %d" % [where, i]
		_same_float(at, "deal.gate", w.gate, d["setLift"])
		_same_float(at, "deal.gate_width", w.gate_width, d["captureWindow"])
		_same_float(at, "deal.delta", w.delta, d["delta"])
		_same_float(at, "deal.travel", WheelEngine.TRAVEL, d["maxLift"])
		_same_float(at, "deal.pos", w.pos, d["lift"])
		_same_float(at, "deal.bias", w.bias, d["resistanceBias"])
		_same_float(at, "deal.spring", w.spring, d["springStrength"])
		_same_float(at, "deal.drag", w.drag, d["dragFactor"])
		_same_int(at, "deal.false_gates", w.false_gates.size(), d["falseGates"].size())
		for k in mini(w.false_gates.size(), d["falseGates"].size()):
			_same_float(at, "deal.false_gate", w.false_gates[k], d["falseGates"][k])


# ── Replaying a tape ────────────────────────────────────────────────────────────────────

func _options(t: Dictionary) -> Dictionary:
	return {"tools": TOOLSETS[t["toolset"]], "feather": bool(t["feather"])}


func _run_trace(t: Dictionary) -> void:
	var name: String = t["name"]
	var before := failures.size()
	var e := WheelEngine.create(Roster.by_id(int(t["lock"])), int(t["seed"]), &"normal", _options(t))
	_check_deal(name, e, t["deal"])

	var rows: Array = t["rows"]
	var events: Array = t["events"]
	var next_row := 0
	var next_event := 0
	var tick := 0
	var acc := 0.0
	next_event = _check_events(name, tick, e.drain_events(), events, next_event)
	for seg: Array in t["tape"]:
		var input := {"wheel": int(seg[1]), "pos": _f(seg[2]), "pull": int(seg[3]) == 1, "level": _f(seg[4])}
		for i in int(seg[0]):
			e.step(input, WheelEngine.DT)
			tick += 1
			acc += _digest(e)
			next_event = _check_events(name, tick, e.drain_events(), events, next_event)
			while next_row < rows.size() and int(rows[next_row][0]) == tick:
				_check_row("%s tick %d" % [name, tick], e, acc, rows[next_row])
				next_row += 1
			if failures.size() - before > 12:
				_fail(name, "giving up on this trace")
				return
	_same_int(name, "rows consumed", next_row, rows.size())
	_same_int(name, "events consumed", next_event, events.size())
	_same_int(name, "ticks", tick, t["ticks"])
	_check_stats(name, e, t["stats"])
	if verbose or failures.size() > before:
		print("%s %s  ticks=%d opened=%s" % ["ok  " if failures.size() == before else "FAIL", name, tick, e.opened])


## One number per tick that moves if anything continuous or discrete does. The additions are in
## the reference's order.
func _digest(e: WheelEngine) -> float:
	var d := e.theta + e.tension + e.resistance + e.wheel_turn + e.pick_strain
	for w in e.wheels:
		d += w.pos + w.state + w.counter_force
	return d


func _check_row(where: String, e: WheelEngine, acc: float, row: Array) -> void:
	_same_float(where, "digest", acc, row[1])
	var s: Array = row[2]
	var got: Array = [
		e.ticks, e.time, e.tension, e.tension_commanded, e.tension_wobble, e.pick_wobble, e.theta,
		e.theta_max, e.theta_demand, e.theta_velocity, e.binding, e.pick_wheel, e.pick_position,
		e.resistance, e.wheel_turn, e.pick_force, e.pick_contact, e.pick_strain, int(e.pick_bent),
		int(e.pick_broken), int(e.opened), e.below_min_hold_for, int(e.engaged),
		int(e.plug_free_announced), e.rng.a, e.rng.b, e.rng.c, e.rng.d,
	]
	for i in SCALARS.size():
		if got[i] is float:
			_same_float(where, SCALARS[i], got[i], s[i])
		else:
			_same_int(where, SCALARS[i], got[i], s[i])
	var ws: Array = row[3]
	for i in e.count:
		var w := e.wheels[i]
		var r: Array = ws[i]
		var at := "%s wheel %d" % [where, i]
		_same_float(at, "pos", w.pos, r[0])
		_same_int(at, "state", w.state, r[1])
		_same_int(at, "geometry", w.geometry, r[2])
		_same_int(at, "notch", w.notch, r[3])
		_same_float(at, "capture_timer", w.capture_timer, r[4])
		_same_float(at, "below_hold_for", w.below_hold_for, r[5])
		_same_float(at, "counter_force", w.counter_force, r[6])
		_same_int(at, "has_false_set", int(w.has_false_set), r[7])


## The events this tick emitted against the reference's, in order. Returns the new cursor.
func _check_events(where: String, tick: int, got: Array[Dictionary], events: Array, cursor: int) -> int:
	for ev in got:
		checks += 1
		if cursor >= events.size():
			_fail(where, "tick %d: %s emitted, the reference has no more events" % [tick, ev["type"]])
			return cursor
		var ref_tick := int(events[cursor][0])
		var ref: Dictionary = events[cursor][1]
		cursor += 1
		var at := "%s tick %d event %s" % [where, tick, ev["type"]]
		if ref_tick != tick or String(ev["type"]) != ref["type"]:
			_fail(at, "reference has %s at tick %d" % [ref["type"], ref_tick])
			continue
		_same_int(at, "fields", ev.size(), ref.size())
		for key: String in ref:
			if key == "type":
				continue
			if not ev.has(key):
				_fail(at, "missing %s" % key)
			elif key in EVENT_FLOATS:
				_same_float(at, "event." + key, ev[key], ref[key])
			elif ref[key] is Array:
				checks += 1
				var mine: Array = ev[key]
				var theirs: Array = ref[key]
				var same := mine.size() == theirs.size()
				for i in mini(mine.size(), theirs.size()):
					same = same and int(mine[i]) == int(theirs[i])
				if not same:
					_fail(at, "%s = %s, reference %s" % [key, str(mine), str(theirs)])
			elif ref[key] is String:
				checks += 1
				if String(ev[key]) != ref[key]:
					_fail(at, "%s = %s, reference %s" % [key, ev[key], ref[key]])
			else:
				_same_int(at, "event." + key, ev[key], ref[key])
	if cursor < events.size() and int(events[cursor][0]) <= tick:
		checks += 1
		_fail(where, "tick %d: the reference emitted %s, nothing here" % [tick, events[cursor][1]["type"]])
		while cursor < events.size() and int(events[cursor][0]) <= tick:
			cursor += 1
	return cursor


func _check_stats(where: String, e: WheelEngine, ref: Dictionary) -> void:
	var st := e.stats
	_same_orders(where, "set_order", st["set_order"], ref["setOrder"])
	_same_orders(where, "bind_order", st["bind_order"], ref["bindOrder"])
	_same_int(where, "stats.oversets", st["oversets"], ref["oversets"])
	_same_int(where, "stats.full_resets", st["full_resets"], ref["fullResets"])
	_same_int(where, "stats.feathers", st["feathers"], ref["feathers"])
	_same_int(where, "stats.false_sets", st["false_sets"], ref["falseSetsEntered"])
	_same_float(where, "stats.max_counter_force", st["max_counter_force"], ref["maxCounterForce"])
	_same_float(where, "stats.max_resistance", st["max_resistance"], ref["maxResistance"])
	_same_float(where, "stats.max_tension", st["max_tension"], ref["maxTension"])
	_same_float(where, "stats.min_tension_while_held", st["min_tension_while_held"], ref["minTensionWhileHeld"])
	_same_float(where, "stats.elapsed", st["elapsed"], ref["elapsed"])


func _same_orders(where: String, field: String, got: Array, want: Array) -> void:
	checks += 1
	var same := got.size() == want.size()
	for i in mini(got.size(), want.size()):
		same = same and int(got[i]) == int(want[i])
	if not same:
		_fail(where, "%s = %s, reference %s" % [field, str(got), str(want)])


# ── The solver ──────────────────────────────────────────────────────────────────────────

## The scripted hand makes the reference's moves, tick for tick, and reaches its tallies.
func _check_solve(s: Dictionary) -> void:
	var where := "solve/%d/%d/%s" % [int(s["lock"]), int(s["seed"]), s["toolset"]]
	var before := failures.size()
	var got := WheelSolver.solve(Roster.by_id(int(s["lock"])), int(s["seed"]), _options(s))
	var ref: Dictionary = s["result"]
	_same_int(where, "opened", int(got["opened"]), int(ref["opened"]))
	_same_int(where, "ticks", got["ticks"], ref["ticks"])
	_same_float(where, "solve.seconds", got["seconds"], ref["seconds"])
	_same_int(where, "rounds", got["rounds"], ref["rounds"])
	_same_int(where, "resets", got["resets"], ref["resets"])
	_same_int(where, "false_sets", got["false_sets"], ref["falseSets"])
	_same_int(where, "search_steps", got["search_steps"], ref["searchSteps"])
	checks += 1
	if got["failure"] != ref["failure"]:
		_fail(where, "failure '%s', reference '%s'" % [got["failure"], ref["failure"]])
	var tape: Array = got["tape"]
	var ref_tape: Array = s["tape"]
	_same_int(where, "tape segments", tape.size(), ref_tape.size())
	for i in mini(tape.size(), ref_tape.size()):
		var seg: Dictionary = tape[i]
		var input: Dictionary = seg["input"]
		var r: Array = ref_tape[i]
		checks += 1
		if seg["ticks"] != int(r[0]) or input["wheel"] != int(r[1]) or input["pos"] != _f(r[2]) \
				or input["pull"] != (int(r[3]) == 1) or input["level"] != _f(r[4]):
			_fail(where, "tape segment %d is %s, reference %s" % [i, str(seg), str(r)])
			break
	if verbose or failures.size() > before:
		print("%s %s  ticks=%d rounds=%d" % ["ok  " if failures.size() == before else "FAIL", where, got["ticks"], got["rounds"]])
