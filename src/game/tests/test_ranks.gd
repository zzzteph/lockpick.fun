extends "res://game/tests/suite.gd"
## The rank ladder over a grid of times, pars and assist levels.


func run() -> void:
	var g: Dictionary = golden("ranks")
	same(Ranks.LETTERS, g["letters"], "letters")
	for i: int in g["through"].size():
		var want: Variant = g["through"][i]
		check((is_inf(Ranks.THROUGH[i]) and want is String) or (not want is String and Ranks.THROUGH[i] == want), "threshold %d" % i)
	same(Ranks.ASSIST_PAR_SCALE, g["scale"], "assist scale")
	same(Ranks.TIER_RANK_REQUIREMENT, g["tierRank"], "tier rank requirement")
	same(Ranks.LETTERS[Ranks.TIER_RANK_REQUIREMENT], "D", "tiers unlock on D")

	for row: Dictionary in g["rows"]:
		var elapsed: float = row["elapsed"]
		var par: float = row["par"]
		var assist := StringName(row["assist"])
		var at := "t=%s par=%s %s" % [WebNum.text(elapsed), WebNum.text(par), assist]
		same(Ranks.index_for(elapsed, par), row["index"], at + " index")
		same(Ranks.rank_for(elapsed, par), row["letter"], at + " letter")
		same(Ranks.seconds_left(elapsed, par), row["left"] if row["left"] != null else -1.0, at + " seconds left")
		same(Ranks.countdown_text(elapsed, par), row["countdown"], at + " countdown")
		same(Ranks.effective_par(par, assist), row["judged"], at + " judged par")
		same(Ranks.earned(elapsed, par, assist), row["earned"], at + " earned")
		same(Ranks.time_text(elapsed), row["timeText"], at + " time text")
		same(Ranks.par_text(par, assist), row["parText"], at + " par text")

	for row: Array in g["letterFor"]:
		same(Ranks.letter_for(row[0]), row[1], "letter for %s" % str(row[0]))
	for row: Array in g["countsForTier"]:
		same(Ranks.counts_for_tier(row[0]), row[1], "counts for tier: %s" % str(row[0]))
	for row: Array in g["tierCredit"]:
		same(Ranks.tier_credit_text(row[0]), row[1], "tier credit text: %s" % str(row[0]))
	for row: Array in g["bestOf"]:
		same(Ranks.best_of(row[0], row[1]), row[2], "best of %s and %s" % [str(row[0]), str(row[1])])

	# The two spellings of "no rank" read the same.
	same(Ranks.letter_for(Ranks.NONE), Ranks.letter_for(null), "no rank, either spelling")
	check(not Ranks.counts_for_tier(Ranks.NONE), "no rank counts for nothing")
	same(Ranks.best_of(Ranks.NONE, 3), 3, "best of nothing and C")
	# A level this build does not have is judged at the lock's own par.
	same(Ranks.effective_par(60.0, &"hard"), 60.0, "an unknown level leaves par alone")
	# You can only fall: the rank never improves as the clock runs.
	var last := 0
	for tick in 4000:
		var rank := Ranks.index_for(tick * 0.05, 60.0)
		check(rank >= last, "rank only falls (t=%s)" % (tick * 0.05))
		last = rank
