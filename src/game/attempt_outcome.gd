class_name AttemptOutcome
extends RefCounted
## One finished attempt, as a record.
##
## Everything the rules could want to ask about an attempt is captured here at the moment the
## lock opens, rather than re-derived later from a lock that has already moved on. That is
## what makes a rank, a challenge and an achievement each a pure function of one record — and
## therefore something a test can be handed.

## The lock that was on the bench — a roster entry, a custom design, a decoded share code.
var lock: Dictionary = {}
var opened := false
var seconds := 0.0
var oversets := 0
## Times the whole lock dropped because tension was lost.
var resets := 0
var false_sets := 0
## The assist level the attempt was actually played at.
var assist: StringName = &"normal"
## Challenge ids that were opted into *and* met.
var challenges: Array[String] = []


static func of(lock_def: Dictionary, was_opened: bool, time: float, level: StringName = &"normal") -> AttemptOutcome:
	var o := AttemptOutcome.new()
	o.lock = lock_def
	o.opened = was_opened
	o.seconds = time
	o.assist = level
	return o


## From a pick session's tally: a Dictionary carrying `oversets`, `full_resets` and
## `false_sets`. Missing counts read as zero.
static func from_stats(lock_def: Dictionary, was_opened: bool, time: float, stats: Dictionary, level: StringName = &"normal") -> AttemptOutcome:
	var o := of(lock_def, was_opened, time, level)
	o.oversets = int(stats.get("oversets", 0))
	o.resets = int(stats.get("full_resets", 0))
	o.false_sets = int(stats.get("false_sets", 0))
	return o


func par() -> float:
	return float(lock.get("par", 0))


## The par this attempt was judged against, once the assist level had its say.
func judged_par() -> float:
	return Ranks.effective_par(par(), assist)
