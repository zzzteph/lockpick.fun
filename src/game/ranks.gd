class_name Ranks
extends RefCounted
## Time ranks — S down to F, against the lock's own par.
##
## A clock counting up says how long you have taken and nothing about whether that is good.
## These thresholds put the answer on screen while you are still working: you start at S and
## watch it fall, which is a different kind of pressure from a number going up.
##
## Ratios rather than seconds, so a rank means the same thing on a two-pin trainer and a
## seven-pin cylinder. S is comfortably under half par — the run where nothing went wrong. C is
## par exactly: par is *fine*, which is what par means. F is where the clock stops mattering.
##
## Rank is also the game's only currency: tiers unlock on ranks earned rather than on locks
## merely opened, and the assist ladder is paid out here, in time.
##
## A rank travels as its index — 0 is S, 6 is F — so two can be compared with `<`. "No rank
## yet" is `null` in a save record and anything negative elsewhere; `letter_for` reads both.

const LETTERS: Array[String] = ["S", "A", "B", "C", "D", "E", "F"]
## You hold rank `i` while `elapsed <= par * THROUGH[i]`.
const THROUGH: Array[float] = [0.4, 0.6, 0.85, 1.0, 1.5, 2.5, INF]

const S := 0
const F := 6
const NONE := -1

## How much of a lock's par each assist level is judged against. Training shows everything,
## so it is held to the tighter clock; the same wall-clock run ranks lower there than on Normal.
const ASSIST_PAR_SCALE := {"training": 0.6, "normal": 1.0}

## The rank a lock must be opened at to count toward the next tier — D, one and a half times
## par. Not "opened at all", which rewards flailing, and not "opened well", which walls anyone
## still learning.
const TIER_RANK_REQUIREMENT := 4


## Rank index for a time on a lock. F catches everything, including a nonsense par.
static func index_for(elapsed: float, par: float) -> int:
	var limit := maxf(1e-6, par)
	for i in THROUGH.size():
		if elapsed <= limit * THROUGH[i]:
			return i
	return F


static func rank_for(elapsed: float, par: float) -> String:
	return LETTERS[index_for(elapsed, par)]


## Seconds before the current rank lapses, or -1 on F, where there is nothing left to lose.
static func seconds_left(elapsed: float, par: float) -> float:
	var i := index_for(elapsed, par)
	if i >= F:
		return -1.0
	return maxf(0.0, maxf(1e-6, par) * THROUGH[i] - elapsed)


## The line under the big letter: "9.3s to B". Empty on F. "You are on A" is worth much less
## than "you are on A for another nine seconds".
static func countdown_text(elapsed: float, par: float) -> String:
	var i := index_for(elapsed, par)
	if i >= F:
		return ""
	return "%ss to %s" % [WebNum.to_fixed(seconds_left(elapsed, par), 1), LETTERS[i + 1]]


static func assist_scale(assist: StringName) -> float:
	return ASSIST_PAR_SCALE.get(String(assist), 1.0)


## The par an attempt is actually judged against, once the assist level has had its say.
static func effective_par(par: float, assist: StringName) -> float:
	return par * assist_scale(assist)


## The rank a finished attempt earned. The one place time and assist meet, so nothing else
## has to remember to apply the scale.
static func earned(seconds: float, par: float, assist: StringName) -> int:
	return index_for(seconds, effective_par(par, assist))


## Whether a record's best rank is good enough to count toward the next tier.
static func counts_for_tier(best_rank: Variant) -> bool:
	return has_rank(best_rank) and best_rank <= TIER_RANK_REQUIREMENT


static func has_rank(rank: Variant) -> bool:
	return (rank is int or rank is float) and rank >= 0


## The better of two ranks, the first of which may be absent. Lower index wins.
static func best_of(a: Variant, b: int) -> int:
	return mini(int(a), b) if has_rank(a) else b


## The letter for a rank index; an em dash for a lock never opened.
static func letter_for(rank: Variant) -> String:
	if not has_rank(rank):
		return "—"
	return LETTERS[int(rank)] if rank < LETTERS.size() else "F"


# ── What the results panel prints ───────────────────────────────────────────────────────

static func time_text(seconds: float) -> String:
	return WebNum.to_fixed(seconds, 2) + "s"


## The par row: the lock's own par, or the judged one with where it came from when the assist
## level moved it.
static func par_text(par: float, assist: StringName) -> String:
	var judged := effective_par(par, assist)
	if judged == par:
		return WebNum.text(par) + "s"
	return "%ss  (%ss x %s)" % [WebNum.to_fixed(judged, 0), WebNum.text(par), assist]


## The "counts toward the next tier" row.
static func tier_credit_text(best_rank: Variant) -> String:
	return "yes" if counts_for_tier(best_rank) else "not yet — needs D"
