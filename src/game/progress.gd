class_name Progress
extends RefCounted
## Player progression: the save, and the rules that read and write it.
##
## Which tiers are unlocked, what a finished attempt does to the records, which lock comes
## next, what has been earned. Pure logic over a save Dictionary (see `SaveData` for its
## shape) with the storage handed in, so the whole of it runs headless.
##
## Everything that changes the save writes it straight away: there is no "unsaved progress".
##
## Three things an open can be, and only the first reaches the records:
##  - a pick on the bench — `complete_attempt`, then `note_challenges`, then
##    `claim_achievements`, in that order, because half the achievements are about totals and a
##    total that does not yet count the open you just made is the wrong total;
##  - a bump with the pick gun — `record_gun_open`, a ledger of its own;
##  - a lesson, an inspection or a blitz deal — nothing at all.

## Distinct locks needed at rank D or better in the tier below, to unlock a tier. By count,
## not by completion — never the whole tier — so nobody is walled by one lock they hate.
const TIER_UNLOCK_REQUIREMENT := {1: 0, 2: 3, 3: 3, 4: 4}

## Four tiers, all of them on the bench.
const MAX_TIER := 4

var data: Dictionary
## Why the save on disk could not be used, when it could not. The game then started fresh.
var load_problem := ""

var _store: SaveStore


## What an attempt was worth — which is a rank, not money.
class Result:
	extends RefCounted
	## Rank index earned this attempt. 0 is S.
	var rank := Ranks.F
	## Best ever on this lock, after this attempt.
	var best_rank := Ranks.F
	## Best before this attempt, or Ranks.NONE on a first open.
	var previous_best := Ranks.NONE
	## A run that beats your own best on a lock is the only thing in the game that changes a
	## number for good, so it is the thing the results screen should shout about.
	var improved := false
	var first_open := false
	## The lock's own par, before the assist level had its say.
	var par := 0.0
	## Challenge ids opted into and met.
	var challenges: Array[String] = []


## With no `initial` save, reads whatever the store holds (a fresh save when it holds nothing).
func _init(store: SaveStore = null, initial: Dictionary = {}) -> void:
	_store = store if store != null else SaveStore.new()
	if initial.is_empty():
		var loaded := _store.load_save()
		data = loaded.data
		load_problem = loaded.problem
	else:
		data = initial


## A new player on this store, whatever it held.
static func fresh(store: SaveStore = null) -> Progress:
	return Progress.new(store, SaveData.fresh())


func save() -> void:
	_store.write(data)


# ── Settings ────────────────────────────────────────────────────────────────────────────

var settings: Dictionary:
	get:
		return data["settings"]


## The level set in Settings. A blitz run may play at another; that is the run's business.
func assist() -> StringName:
	return StringName(settings["assist"])


## Change settings and persist. Values are held to the same kinds and ranges a loaded save is.
func update_settings(patch: Dictionary) -> void:
	var merged := settings.duplicate()
	merged.merge(patch, true)
	data["settings"] = SaveData.tidy_settings(merged)
	save()


# ── Records ─────────────────────────────────────────────────────────────────────────────

## A lock's record: { opens, bestTime, bestOversets, bestRank, challenges }. An empty one for
## a lock never opened.
func record(slug: String) -> Dictionary:
	return data["records"].get(slug, SaveData.empty_record())


func has_opened(slug: String) -> bool:
	return record(slug)["opens"] > 0


## Total opens across every lock, and how many different locks that is.
func total_opens() -> int:
	var n := 0
	for r: Dictionary in data["records"].values():
		n += r["opens"]
	return n


func distinct_opens() -> int:
	var n := 0
	for r: Dictionary in data["records"].values():
		if r["opens"] > 0:
			n += 1
	return n


## How many roster locks are ranked well enough to count, and the line that says so.
func ranked_count() -> int:
	var n := 0
	for def in Roster.all():
		if Ranks.counts_for_tier(record(def["slug"])["bestRank"]):
			n += 1
	return n


func ranked_line() -> String:
	return "%d/%d locks ranked D or better" % [ranked_count(), Roster.all().size()]


# ── Tiers ───────────────────────────────────────────────────────────────────────────────

## How many opens a tier actually needs, given how many locks exist in the tier below.
## Clamped to what exists, so a thin tier can never make the next one unreachable.
static func opens_required_for(tier: int) -> int:
	if not TIER_UNLOCK_REQUIREMENT.has(tier):
		return Roster.in_tier(tier - 1).size()
	return mini(TIER_UNLOCK_REQUIREMENT[tier], Roster.in_tier(tier - 1).size())


## Distinct locks in a tier opened well enough to count — rank D or better. Not "opened at
## all": a tier is not unlocked by flailing at five locks for ten minutes each.
func opens_in_tier(tier: int) -> int:
	var n := 0
	for def in Roster.in_tier(tier):
		if Ranks.counts_for_tier(record(def["slug"])["bestRank"]):
			n += 1
	return n


## Tiers unlock in order: Tier 4 cannot be reached without Tier 3, however many Tier 3 locks
## were somehow opened first.
func is_tier_unlocked(tier: int) -> bool:
	if tier <= 1:
		return true
	if tier > MAX_TIER or not is_tier_unlocked(tier - 1):
		return false
	var required := opens_required_for(tier)
	return required > 0 and opens_in_tier(tier - 1) >= required


func highest_unlocked_tier() -> int:
	var t := 1
	while t < MAX_TIER and is_tier_unlocked(t + 1):
		t += 1
	return t


## How many more counted opens in tier `tier - 1` before `tier` unlocks.
func opens_needed_for(tier: int) -> int:
	if is_tier_unlocked(tier):
		return 0
	return maxi(0, opens_required_for(tier) - opens_in_tier(tier - 1))


## Whether a lock can be attempted at all — purely a question of its tier.
func can_attempt(def: Dictionary) -> bool:
	return is_tier_unlocked(def["tier"])


func available_locks() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for def in Roster.all():
		if is_tier_unlocked(def["tier"]):
			out.append(def)
	return out


## The lock the results screen's "Next lock" goes to, or {} when there is not one.
##
## Unopened first, in bench order, wrapping: "next" has to mean forward — the next lock you
## have not beaten, starting after this one and coming round the front. Only when everything
## available is opened does it fall back to plain bench order, which turns the button into
## "keep going" for somebody chasing ranks.
##
## It stays in the same family: finishing a cylinder sends you to the next cylinder, not
## across to a shelf, unless the family has nothing left to offer — and a shelf with nothing
## left sends you back to the cylinders, the bench's main line, before anywhere else. Never a
## locked tier — the button cannot be a way round the gate. And {} rather than a wrong answer
## for a lock that is not in the roster (a lesson, a custom design), or when nothing else is
## available.
func next_lock_after(def: Dictionary) -> Dictionary:
	var roster := Roster.all()
	var here := -1
	for i in roster.size():
		if roster[i]["slug"] == def.get("slug"):
			here = i
			break
	if here < 0:
		return {}
	var available: Array[Dictionary] = []
	for step in range(1, roster.size()):
		var other := roster[(here + step) % roster.size()]
		if is_tier_unlocked(other["tier"]):
			available.append(other)
	var kin: Array[Dictionary] = []
	var cylinders: Array[Dictionary] = []
	for other in available:
		if other["family"] == def.get("family"):
			kin.append(other)
		if other["family"] == "pin-tumbler":
			cylinders.append(other)
	var pool := kin
	if pool.is_empty():
		pool = cylinders if not cylinders.is_empty() else available
	for other in pool:
		if not has_opened(other["slug"]):
			return other
	return pool[0] if not pool.is_empty() else {}


# ── Attempts ────────────────────────────────────────────────────────────────────────────

## Which of the opted-in challenges an attempt satisfied.
func challenges_met_by(outcome: AttemptOutcome, opted: Array) -> Array[String]:
	return Challenges.met(opted, outcome.seconds, outcome.par(), outcome.resets, outcome.oversets)


## Apply a finished attempt to the records. Returns what it earned, or null when the lock was
## not opened — a failed attempt records nothing. `day` ("YYYY-MM-DD", see `today`) also
## counts the open toward that day.
func complete_attempt(outcome: AttemptOutcome, day: String = "") -> Result:
	if not outcome.opened:
		return null
	var slug: String = outcome.lock["slug"]
	var previous := record(slug)
	var had_rank := Ranks.has_rank(previous["bestRank"])
	var result := Result.new()
	result.rank = Ranks.earned(outcome.seconds, outcome.par(), outcome.assist)
	result.best_rank = Ranks.best_of(previous["bestRank"], result.rank)
	result.previous_best = int(previous["bestRank"]) if had_rank else Ranks.NONE
	result.improved = not had_rank or result.rank < result.previous_best
	result.first_open = previous["opens"] == 0
	result.par = outcome.par()
	result.challenges = outcome.challenges.duplicate()

	var best_time: Variant = previous["bestTime"]
	var best_oversets: Variant = previous["bestOversets"]
	data["records"][slug] = {
		"opens": previous["opens"] + 1,
		"bestTime": outcome.seconds if best_time == null else minf(best_time, outcome.seconds),
		"bestOversets": outcome.oversets if best_oversets == null else mini(best_oversets, outcome.oversets),
		"bestRank": result.best_rank,
		"challenges": (previous["challenges"] as Array).duplicate(),
	}
	if day != "":
		data["playDays"][day] = data["playDays"].get(day, 0) + 1
	save()
	return result


## Record challenge modifiers cleared on a lock, for its bench badges.
func note_challenges(slug: String, met: Array) -> void:
	if met.is_empty():
		return
	var entry: Dictionary = data["records"].get(slug, SaveData.empty_record())
	var merged: Array = (entry["challenges"] as Array).duplicate()
	for id: Variant in met:
		if not merged.has(id):
			merged.append(id)
	merged.sort()
	entry["challenges"] = merged
	data["records"][slug] = entry
	save()


## Unlock whatever the attempt that just finished — and the save as it now stands — made
## true, and hand the new entries back for the screen to show. Pass null when checking on
## something that was not a pick. Call it *after* `complete_attempt`.
func claim_achievements(outcome: AttemptOutcome = null) -> Array[Dictionary]:
	var earned := Achievements.newly_earned(outcome, data)
	if earned.is_empty():
		return earned
	for a in earned:
		data["achievements"].append(a["id"])
	save()
	return earned


func has_achievement(id: String) -> bool:
	return data["achievements"].has(id)


func unlock_achievement(id: String) -> bool:
	if has_achievement(id):
		return false
	data["achievements"].append(id)
	save()
	return true


## Today as the save writes a play day: the UTC date.
static func today() -> String:
	return Time.get_date_string_from_system(true)


# ── The pick gun ────────────────────────────────────────────────────────────────────────

## How many times a lock has been bumped open with the pick gun. A ledger of its own, kept
## clear of the records: a bump is not a pick, it earns no rank and moves no tier, and the gun
## bench must never read a lock as "opened before" because it was picked on the roster.
func gun_opens(slug: String) -> int:
	return data["gunOpens"].get(slug, 0)


## Tally one gun open and persist. No rank, no achievements, no play day — just the count.
func record_gun_open(slug: String) -> void:
	data["gunOpens"][slug] = gun_opens(slug) + 1
	save()


# ── The blitz ───────────────────────────────────────────────────────────────────────────

## The best finished run at a level — { score, opens } — or {} when there is none.
func streak_best(level: StringName) -> Dictionary:
	return data["streakBest"].get(String(level), {})


## Bank a finished five-minute run. Returns whether it is a new best at its level, which is
## the one thing the tally screen wants to know. A score, never a currency: nothing unlocks
## behind it.
func note_streak_run(level: StringName, run: Dictionary) -> bool:
	if not Streak.beats(run, streak_best(level)):
		return false
	data["streakBest"][String(level)] = {"score": int(run["score"]), "opens": int(run["opens"])}
	save()
	return true


# ── Lessons ─────────────────────────────────────────────────────────────────────────────

func lesson_done(id: String) -> bool:
	return data["tutorial"].has(id)


## True once any lesson is finished — what the menu asks before sending a new player to the
## tutorial instead of the bench.
func has_started_lessons() -> bool:
	return not (data["tutorial"] as Array).is_empty()


## Mark a lesson finished. Returns false when it already was.
func complete_lesson(id: String) -> bool:
	if lesson_done(id):
		return false
	data["tutorial"].append(id)
	save()
	return true


# ── The player's own locks ──────────────────────────────────────────────────────────────

func custom_locks() -> Array:
	return data["customLocks"]


## Save a lock the player built or was sent. Returns its index.
##
## The id is stamped from the highest id already saved, not from how many there are — which is
## what makes deletion safe: delete the first of two and the next lock saved still gets an id,
## and so a slug and a record, that nothing else has held.
func add_custom_lock(def: Dictionary) -> int:
	var id := EditorModel.CUSTOM_ID_BASE - 1
	for other: Dictionary in custom_locks():
		id = maxi(id, int(other["id"]))
	id += 1
	var stamped := def.duplicate(true)
	stamped["id"] = id
	stamped["slug"] = EditorModel.slug_for(stamped["name"], id)
	custom_locks().append(stamped)
	save()
	return custom_locks().size() - 1


## Throw one away. Returns the lock that went, or {} when the index was not one. The record it
## earned is left alone: its slug is never handed out again, so nothing can inherit it.
func remove_custom_lock(index: int) -> Dictionary:
	if index < 0 or index >= custom_locks().size():
		return {}
	var gone: Dictionary = custom_locks().pop_at(index)
	save()
	return gone


## The seed a lock's tolerances roll from on this player's bench: the same copy of the lock
## every time they sit down with it.
func seed_for(def: Dictionary) -> int:
	return SaveData.seed_for_lock(def["slug"], data["lockSalt"])


# ── Export and import ───────────────────────────────────────────────────────────────────

## The save as text — the same file the web game exports.
func export_text() -> String:
	return SaveStore.encode(data)


## Replace the save with an exported one, from either build. Returns "" on success; otherwise
## why not, and the save in hand is untouched.
func import_text(text: String) -> String:
	var loaded := SaveStore.decode(text)
	if not loaded.ok():
		return loaded.problem
	data = loaded.data
	save()
	return ""
