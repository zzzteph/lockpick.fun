class_name WheelSolver
extends RefCounted
## A scripted hand that decodes a wheel pack properly: through the same input a player has and
## the same resistance reading, never by looking at which wheel binds or where a gate is.
##
## It is the completeness proof — if this cannot open a pack, the pack is broken — and its
## record is a tape: "hold this input for N ticks", replayable into any engine dealt from the
## same lock and seed (`WheelLockView.play_tape`).
##
## The method is the player's own. Pull, then wiggle each unseated wheel one click out and
## back and keep the one that dragged hardest; roll that wheel round its dial, dwelling on
## every half-gate, until it seats; repeat. With everything seated, pull through.

## Ticks to dwell at one swept position: the capture time plus a margin.
const DWELL_TICKS := 9
## The pull it works at, and the pull it finishes the stroke with.
const WORK_TENSION := 0.42
const TURN_TENSION := 0.6
const MAX_SECONDS := 90.0

var engine: WheelEngine
## The record: [{"ticks": int, "input": Dictionary}], consecutive identical inputs merged.
var tape: Array[Dictionary] = []
var ticks := 0
## Positions it had to try blind — a gate's angle cannot be read, only found.
var search_steps := 0
## How many times it picked a wheel and worked it.
var rounds := 0


## Solve `def` dealt from `lock_seed`. `options` are `WheelEngine.create`'s. Returns
## {"opened", "tape", "ticks", "seconds", "rounds", "resets", "false_sets", "search_steps",
## "failure"} — `failure` is "" when it opened.
static func solve(def: Dictionary, lock_seed: int, options: Dictionary = {}) -> Dictionary:
	var s := WheelSolver.new()
	s.engine = WheelEngine.create(def, lock_seed, &"normal", options)
	var failure := s._run()
	var e := s.engine
	return {
		"opened": e.opened,
		"tape": s.tape,
		"ticks": s.ticks,
		"seconds": e.time,
		"rounds": s.rounds,
		"resets": e.stats["full_resets"],
		"false_sets": e.stats["false_sets"],
		"search_steps": s.search_steps,
		"failure": "" if e.opened else failure,
	}


static func make_input(wheel: int, pos: float, level: float, pull: bool = true) -> Dictionary:
	return {"wheel": wheel, "pos": pos, "pull": pull, "level": level}


func _run() -> String:
	var e := engine
	var tools := e.tools
	var tension := clampf(WORK_TENSION, tools["tension_min"], tools["tension_max"])
	var turn_tension := clampf(TURN_TENSION, tools["tension_min"], tools["tension_max"])
	var reach: int = tools["reach"]
	var max_ticks := int(round(MAX_SECONDS / WheelEngine.DT))
	if e.count > reach:
		return "the hand reaches %d wheels, the pack has %d" % [reach, e.count]

	_hold(make_input(-1, 0.0, tension), int(round(0.35 / WheelEngine.DT)))
	while not e.opened and ticks < max_ticks:
		# Everything seated: stop decoding and pull through.
		if e.seated_count() == e.count:
			_hold(make_input(-1, 0.0, turn_tension), int(round(0.5 / WheelEngine.DT)))
			continue
		var target := _probe_for_heaviest(tension, reach)
		if target < 0:
			return "nothing left to work but the lock is not open"
		rounds += 1
		_sweep(target, tension, int(round(12.0 / WheelEngine.DT)))
	return "" if e.opened else "ran out of time"


## Step the engine and record the tape at the same time.
func _hold(input: Dictionary, n: int) -> void:
	for i in n:
		engine.step(input, WheelEngine.DT)
	ticks += n
	if not tape.is_empty() and tape[-1]["input"] == input:
		tape[-1]["ticks"] += n
	else:
		tape.append({"ticks": n, "input": input})


## Put the thumb on a wheel and wait until it is actually there: the hand crosses the pack
## rather than jumping, and a reading taken on the way belongs to whichever wheel it is passing.
func _travel_to(wheel: int, pos: float, tension: float) -> void:
	for i in 900:
		if engine.pick_wheel == wheel:
			_hold(make_input(wheel, pos, tension), 1)
			return
		_hold(make_input(wheel, 0.0, tension), 1)


## Find the wheel that drags hardest. A wheel speaks only while it turns, so each one is
## wiggled a click out and back and read mid-turn — three ticks a hop, so the peak is sampled
## while the wheel moves rather than after it has parked and gone quiet.
func _probe_for_heaviest(tension: float, reach: int) -> int:
	var best := -1
	var best_resistance := -1.0
	for w in engine.wheels:
		if w.index >= reach:
			break
		if w.state == WheelEngine.SET:
			continue
		var here := w.pos
		var out := fmod(here + WheelEngine.DETENT, WheelEngine.TRAVEL)
		_travel_to(w.index, here, tension)
		var peak := 0.0
		for target: float in [out, here]:
			for hop in 8:
				_hold(make_input(w.index, target, tension), 3)
				if engine.resistance > peak:
					peak = engine.resistance
		if peak > best_resistance:
			best_resistance = peak
			best = w.index
	return best


## Roll a wheel round its dial until it seats. Half a gate at a time, so the gate can never be
## stepped clean over; the dial has no stop and the wheel keeps its place when the pull drops,
## so the sweep never has to start again.
func _sweep(index: int, tension: float, max_spent: int) -> bool:
	var w := engine.wheels[index]
	var stride := maxf(0.02, w.gate_width / 2.0)
	var start := w.pos
	var steps := int(ceil(WheelEngine.TRAVEL / stride)) + 1
	var spent := 0
	_travel_to(index, w.pos, tension)
	var i := 1
	while spent < max_spent and i <= steps:
		var at := fmod(start + i * stride, WheelEngine.TRAVEL)
		search_steps += 1
		_hold(make_input(index, at, tension), DWELL_TICKS)
		spent += DWELL_TICKS
		if w.state == WheelEngine.SET:
			return true
		i += 1
	return false
