class_name StreakRun
extends RefCounted
## One live Lock blitz run: the clock, the score, and the lock on the bench.
##
## Never persisted. A relaunch has no run to resume, and that absence is what makes "no
## resume" true. Only the clock running out banks a score; walking out banks nothing.
##
## The shape of a run:
##   start -> deal -> (the pick screen; `tick` burns the clock)
##     opened  -> the breather: clock frozen, the run's numbers on screen, any input deals on
##     skip    -> next lock at once; the seconds already spent are the price
##     clock out -> banked, `finished`, `summary()` for the tally
##
## The clock burns only while a dealt lock is on the bench. The caller owns pause — it simply
## stops calling `tick` — and the breather freezes the clock by itself: a rest stop the clock
## charged for would not be one. A skip or a snapped pick earns no breather.

## The level the run's locks are played at, picked on the briefing. Bests are kept per level.
var assist: StringName = &"normal"
var left := Streak.SECONDS
## Sum of the opened locks' tiers.
var score := 0
var opens := 0
## The lock on the bench and the seed its tolerances roll from; {} between deals.
var lock: Dictionary = {}
var lock_seed := 0
## True between an open and the next deal.
var interlude := false
var finished := false
## Set when the clock runs out: whether the run took the best at its level.
var new_best := false

## Deals this sitting, salting the forge so no two deals share a slug or an id.
static var dealt := 0

var _progress: Progress


func _init(progress: Progress, level: StringName = &"") -> void:
	_progress = progress
	assist = level if level != &"" else progress.assist()


## Start a run and deal its first lock.
static func start(progress: Progress, level: StringName = &"") -> StreakRun:
	var run := StreakRun.new(progress, level)
	run.deal_next()
	return run


## Roll and deal the next lock, from any tier the bench has unlocked. Tier and seed roll
## separately; hand both in (a roll in 0..1, a non-zero seed) to make a deal reproducible.
## Returns the lock.
func deal_next(tier_roll: float = -1.0, seed_value: int = 0) -> Dictionary:
	if finished:
		return {}
	if tier_roll < 0.0:
		tier_roll = randf()
	if seed_value == 0:
		seed_value = Forge.seed32(randi())
	dealt += 1
	var tier := Streak.tier_for(tier_roll, _progress.highest_unlocked_tier())
	lock = Streak.deal(seed_value, dealt, tier)
	lock_seed = Streak.lock_seed(seed_value, dealt)
	interlude = false
	return lock


## Burn the clock. Returns true on the tick it runs out — the run has then banked.
func tick(delta: float) -> bool:
	if finished or interlude or lock.is_empty():
		return false
	left -= delta
	if left > 0.0:
		return false
	_finish()
	return true


## The lock on the bench opened: it scores its tier and the breather begins.
func opened() -> void:
	if finished or lock.is_empty():
		return
	score += int(lock["tier"])
	opens += 1
	lock = {}
	interlude = true


## Give up on this lock — the skip key, or a snapped pick. The next one is dealt at once.
func skip() -> Dictionary:
	return deal_next()


## Average seconds per opened lock so far. Elapsed over opens, so skips and fights count:
## they are part of a lock's true cost.
func average_seconds() -> float:
	return (Streak.SECONDS - left) / opens if opens > 0 else 0.0


func clock_text() -> String:
	return Streak.clock_text(left)


## The finished run as the save keeps it.
func summary() -> Dictionary:
	return {"score": score, "opens": opens}


func _finish() -> void:
	left = 0.0
	finished = true
	interlude = false
	lock = {}
	new_best = _progress.note_streak_run(assist, summary())
