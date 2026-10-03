extends "res://game/tests/suite.gd"
## The forge and the Lock blitz: the same seed deals the same lock as the web game, and a run
## scores, rests and banks the way the mode is written down.


func run() -> void:
	var g: Dictionary = golden("forge")

	for row: Dictionary in g["forged"]:
		var def := Forge.lock(row["seed"], row["salt"], row["tier"])
		var what := "forged seed %s salt %s tier %s" % [row["seed"], row["salt"], row["tier"]]
		for key: String in ["id", "family", "bitting", "pins", "springs", "toleranceQuality", "keyway", "par"]:
			same(def[key], row[key], "%s %s" % [what, key])
		same(def["tier"], row["tier"], what + " tier")
		check(LockDefs.is_valid(def) == row["valid"] and row["valid"], what + " is a lock the game accepts")

	for row: Dictionary in g["dealt"]:
		var def := Streak.deal(row["seed"], row["n"], row["tier"])
		var what := "dealt seed %s n %s tier %s" % [row["seed"], row["n"], row["tier"]]
		same(def, row["def"], what)
		same(def.keys(), row["def"].keys(), what + " key order")
		same(Streak.lock_seed(row["seed"], row["n"]), row["simSeed"], what + " lock seed")
		check(def["family"] == "pin-tumbler" and not def.has("discs"), what + " is never a wheel pack")
		check(LockDefs.is_valid(def), what + " is a lock the game accepts")

	same(Streak.SECONDS, g["seconds"], "the window")
	same(Streak.TIME_BONUS, g["bonus"], "the time bonus")
	same(Streak.ID_BASE, g["idBase"], "the id base")
	for row: Array in g["tiers"]:
		same(Streak.tier_for(row[0], int(row[1])), row[2], "tier for roll %s with %s unlocked" % [row[0], row[1]])
	for row: Array in g["clock"]:
		same(Streak.clock_text(row[0]), row[1], "clock at %s" % row[0])
	for row: Array in g["beats"]:
		same(Streak.beats(row[0], row[1] if row[1] != null else {}), row[2], "%s beats %s" % [row[0], row[1]])

	_a_run()
	_a_run_that_walks_out()
	_deals_follow_the_bench()


func _a_run() -> void:
	StreakRun.dealt = 0
	var store := SaveStore.memory()
	var progress := Progress.fresh(store)
	var run := StreakRun.start(progress, &"normal")
	same(run.left, 300.0, "a run starts with five minutes")
	check(not run.lock.is_empty() and run.lock["tier"] == 1, "a fresh bench deals tier 1")
	check(LockDefs.is_valid(run.lock), "the dealt lock is real")
	check(run.lock_seed > 0, "the dealt lock has a seed to roll from")

	check(not run.tick(12.5), "the clock burns without ending the run")
	same(run.left, 287.5, "…by exactly what it was given")
	run.opened()
	same([run.score, run.opens, run.interlude], [1, 1, true], "an open scores its tier and starts the breather")
	check(run.lock.is_empty(), "nothing is on the bench during the breather")
	run.tick(60.0)
	same(run.left, 287.5, "the breather does not cost time")
	same(run.average_seconds(), 12.5, "average per lock is elapsed over opens")
	same(run.clock_text(), "4:48", "the clock reads m:ss")

	var second := run.deal_next(0.0, 4242)
	same(second, Streak.deal(4242, 2, 1), "a deal with a known seed is the known lock")
	same(run.lock_seed, Streak.lock_seed(4242, 2), "…with the known lock seed")
	check(not run.interlude, "dealing ends the breather")
	run.tick(20.0)
	var skipped_to := run.skip()
	check(skipped_to["slug"] != second["slug"], "a skip deals a different lock")
	same([run.score, run.opens, run.interlude], [1, 1, false], "…scores nothing and earns no breather")
	same(run.left, 267.5, "…and the seconds spent stay spent")
	run.opened()
	run.deal_next()
	same(run.average_seconds(), 16.25, "skips and fights count toward the average")

	check(progress.streak_best(&"normal").is_empty(), "nothing is banked while the run is live")
	check(not run.tick(267.0), "half a second left is still a run")
	check(run.tick(0.75), "the tick that empties the clock ends it")
	check(run.finished and run.new_best, "the first finished run is a best")
	same(run.left, 0.0, "the clock stops at zero")
	same(run.summary(), {"score": 2, "opens": 2}, "the summary is the score and the opens behind it")
	same(progress.streak_best(&"normal"), {"score": 2, "opens": 2}, "the clock running out banks the run")
	check(progress.streak_best(&"training").is_empty(), "bests are kept per level")
	check(run.deal_next().is_empty() and not run.tick(1.0), "a finished run deals and burns nothing more")
	run.opened()
	same(run.score, 2, "…and scores nothing more")
	same(Progress.new(store).streak_best(&"normal"), {"score": 2, "opens": 2}, "the best is on disk")

	var worse := StreakRun.start(progress, &"normal")
	worse.opened()
	worse.deal_next()
	worse.tick(301.0)
	check(worse.finished and not worse.new_best, "a lesser run is not a best")
	same(progress.streak_best(&"normal"), {"score": 2, "opens": 2}, "…and leaves the best alone")
	check(progress.data["records"].is_empty() and progress.data["achievements"].is_empty() and progress.data["playDays"].is_empty(),
		"dealt locks leave no records, achievements or play days")

	# With no level given, a run is played at the level in Settings.
	same(StreakRun.new(progress).assist, &"training", "a run takes the Settings level by default")


func _a_run_that_walks_out() -> void:
	var progress := Progress.fresh(SaveStore.memory())
	var run := StreakRun.start(progress, &"training")
	run.opened()
	run.deal_next()
	run.tick(100.0)
	# Abandoning is simply letting go of the run: nothing banks unless the clock runs out.
	run = null
	check(progress.streak_best(&"training").is_empty(), "a run that is walked out of banks nothing")


func _deals_follow_the_bench() -> void:
	var progress := Progress.fresh(SaveStore.memory())
	for def in Roster.in_tier(1) + Roster.in_tier(2):
		progress.complete_attempt(AttemptOutcome.of(def, true, 10.0))
	same(progress.highest_unlocked_tier(), 3, "three tiers are open")
	var run := StreakRun.new(progress, &"normal")
	var seen := {}
	for i in 60:
		var def := run.deal_next(i / 60.0)
		seen[def["tier"]] = true
		check(def["name"].contains("tier %d" % def["tier"]), "a dealt lock states its tier")
		check(def["id"] >= Streak.ID_BASE, "a dealt lock's id is clear of everything else")
	same(seen.keys(), [1, 2, 3], "deals come from every unlocked tier and no other")
	var slugs := {}
	for i in 200:
		slugs[run.deal_next()["slug"]] = true
	same(slugs.size(), 200, "no two deals in a sitting share a slug")
