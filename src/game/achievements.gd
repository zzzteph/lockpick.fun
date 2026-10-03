class_name Achievements
extends RefCounted
## The achievements — ten of them, the spine that survived every cut: the progression ladder,
## beating par, the S standard held across a tier, the editor's front door, one long-haul
## oddity.
##
## Each is a pure predicate over two things and nothing else: the attempt that just finished,
## and the save as it stands *after* that attempt was recorded. No achievement reaches into
## the lock, keeps a counter of its own, or fires from anywhere but `newly_earned`. That shape
## is what makes "no achievement is unreachable" cheap to prove: a predicate over data can be
## handed data.
##
## A trophy that leaves the game takes its id with it. An id already banked in a player's
## save simply stops matching an entry and is ignored — nothing has to migrate.

const GROUPS: Array[String] = ["progression", "mastery", "bench"]

## In declaration order, which is the order a run's new trophies are shown in.
## `condition` is the line on the plate once earned.
const LIST: Array[Dictionary] = [
	{"id": "first-blood", "name": "First Blood", "condition": "Open your first lock", "group": "progression"},
	{"id": "apprentice", "name": "Apprentice", "condition": "Open every Tier 1 cylinder", "group": "progression"},
	{"id": "journeyman", "name": "Journeyman", "condition": "Open every Tier 2 cylinder", "group": "progression"},
	{"id": "locksmith", "name": "Locksmith", "condition": "Open every Tier 3 cylinder", "group": "progression"},
	{"id": "specialist", "name": "Specialist", "condition": "Open every Tier 4 cylinder", "group": "progression"},
	{"id": "master-of-the-bench", "name": "Master of the Bench", "condition": "Open every lock in the game", "group": "progression"},
	{"id": "under-par", "name": "Under Par", "condition": "Beat the par time on any lock", "group": "mastery"},
	{"id": "flawless-tier", "name": "Flawless", "condition": "Earn an S rank on every cylinder in a tier", "group": "mastery"},
	{"id": "architect", "name": "Architect", "condition": "Build a lock of your own", "group": "bench"},
	{"id": "curious", "name": "Curious", "condition": "Open the same lock twenty-five times", "group": "bench"},
]

const CURIOUS_OPENS := 25
const TIERS: Array[int] = [1, 2, 3, 4]

## The drawing for each trophy, by id — a hand-drawn card rather than more linework, because a
## trophy is a memento. One file per achievement, named for it.
const ART_DIR := "res://game/trophies/"


static func all() -> Array[Dictionary]:
	return LIST


static func count() -> int:
	return LIST.size()


static func ids() -> Array[String]:
	var out: Array[String] = []
	for a in LIST:
		out.append(a["id"])
	return out


## The entry for an id, or {} for one the game no longer has.
static func by_id(id: String) -> Dictionary:
	for a in LIST:
		if a["id"] == id:
			return a
	return {}


static func in_group(group: String) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for a in LIST:
		if a["group"] == group:
			out.append(a)
	return out


static func art_path(id: String) -> String:
	return ART_DIR + id + ".png"


## id -> texture path, for every trophy.
static func art_paths() -> Dictionary:
	var out := {}
	for a in LIST:
		out[a["id"]] = art_path(a["id"])
	return out


# ── Evaluation ──────────────────────────────────────────────────────────────────────────

## Everything newly true, in declaration order. `outcome` is the attempt that just finished,
## or null when checking on something that was not a pick — saving a custom lock, say.
static func newly_earned(outcome: AttemptOutcome, save: Dictionary) -> Array[Dictionary]:
	var already: Array = save.get("achievements", [])
	var out: Array[Dictionary] = []
	for a in LIST:
		if not already.has(a["id"]) and is_met(a["id"], outcome, save):
			out.append(a)
	return out


static func is_met(id: String, outcome: AttemptOutcome, save: Dictionary) -> bool:
	match id:
		"first-blood":
			for record: Dictionary in _records(save).values():
				if record["opens"] > 0:
					return true
			return false
		"apprentice":
			return _tier_complete(save, 1)
		"journeyman":
			return _tier_complete(save, 2)
		"locksmith":
			return _tier_complete(save, 3)
		"specialist":
			return _tier_complete(save, 4)
		"master-of-the-bench":
			return _all_opened(save, Roster.all())
		"under-par":
			return outcome != null and outcome.opened and outcome.seconds < float(outcome.lock["par"])
		"flawless-tier":
			# Not a total but a standard, held across a whole tier: the trophy that says you
			# can pick, rather than that you turned up.
			for tier in TIERS:
				if _tier_flawless(save, tier):
					return true
			return false
		"architect":
			return not (save.get("customLocks", []) as Array).is_empty()
		"curious":
			for record: Dictionary in _records(save).values():
				if record["opens"] >= CURIOUS_OPENS:
					return true
			return false
	return false


## Whether a trophy can be earned at all against the roster as it stands. One that names a
## tier with no cylinders in it is not broken, but the wall must be able to grey it out.
static func is_reachable(id: String) -> bool:
	match id:
		"apprentice":
			return not tier_cylinders(1).is_empty()
		"journeyman":
			return not tier_cylinders(2).is_empty()
		"locksmith":
			return not tier_cylinders(3).is_empty()
		"specialist":
			return not tier_cylinders(4).is_empty()
		"flawless-tier":
			for tier in TIERS:
				if not tier_cylinders(tier).is_empty():
					return true
			return false
	return not by_id(id).is_empty()


static func unreachable() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for a in LIST:
		if not is_reachable(a["id"]):
			out.append(a)
	return out


## The tier plates count cylinders only. The bench shelves the wheel locks and the disc
## detainers on their own, apart from the tier pages, so a "tier" in trophy language is the tier
## page — and a three-lock shelf must not become the cheapest Flawless. Those locks belong to
## Master of the Bench, which asks for every lock in the game.
static func tier_cylinders(tier: int) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for d in Roster.in_tier(tier):
		if d["family"] == "pin-tumbler":
			out.append(d)
	return out


static func _records(save: Dictionary) -> Dictionary:
	return save.get("records", {})


static func _opened(save: Dictionary, slug: String) -> bool:
	return _records(save).get(slug, {}).get("opens", 0) > 0


static func _all_opened(save: Dictionary, locks: Array[Dictionary]) -> bool:
	if locks.is_empty():
		return false
	for d in locks:
		if not _opened(save, d["slug"]):
			return false
	return true


static func _tier_complete(save: Dictionary, tier: int) -> bool:
	return _all_opened(save, tier_cylinders(tier))


static func _tier_flawless(save: Dictionary, tier: int) -> bool:
	var locks := tier_cylinders(tier)
	if locks.is_empty():
		return false
	for d in locks:
		if _records(save).get(d["slug"], {}).get("bestRank") != Ranks.S:
			return false
	return true
