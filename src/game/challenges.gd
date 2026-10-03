class_name Challenges
extends RefCounted
## The assist ladder as the settings screen describes it, and the opt-in challenge modifiers.
##
## A challenge is a restriction a player takes on themselves for one attempt. Taking one on
## and missing it does not void the open — it simply is not recorded. Meeting it writes a
## badge onto the lock's record.

## The ladder, easiest first. Two rungs: Training draws the lock in state colours, Normal
## draws the same geometry and stops narrating.
const ASSIST_MODES: Array[StringName] = [&"training", &"normal"]

## What each rung takes away, for the settings screen to say out loud.
const ASSIST_BLURB := {
	"training": "Everything visible: pin types, the binding pin, the target window.",
	"normal": "Every pin, honestly drawn — but no state colours, no state word. The lock stops narrating.",
}

const LIST: Array[Dictionary] = [
	{
		"id": "no-resets",
		"name": "No resets",
		"blurb": "Lose tension once and the run is void.",
	},
	{
		"id": "under-par",
		"name": "Under par",
		"blurb": "Open it inside the lock's par time.",
	},
	{
		"id": "no-oversets",
		"name": "No oversets",
		"blurb": "Open it without jamming a single pin.",
	},
]


static func all() -> Array[Dictionary]:
	return LIST


## The entry for an id, or {} for one the game does not have.
static func by_id(id: String) -> Dictionary:
	for c in LIST:
		if c["id"] == id:
			return c
	return {}


static func assist_blurb(assist: StringName) -> String:
	return ASSIST_BLURB.get(String(assist), "")


## The line beside the level control: what the rung does to the clock a rank is judged on.
static func assist_par_text(assist: StringName) -> String:
	return "x%s par for ranking" % WebNum.to_fixed(Ranks.assist_scale(assist), 2)


## Did an attempt with these facts satisfy the challenge?
static func is_met(id: String, seconds: float, par: float, resets: int, oversets: int) -> bool:
	match id:
		"no-resets":
			return resets == 0
		"under-par":
			return seconds < par
		"no-oversets":
			return oversets == 0
	return false


## Which of the opted-in challenges the attempt satisfied, in the order they were opted
## into. Unknown ids are dropped, which is what lets a challenge be renamed without stranding
## an old save.
static func met(opted: Array, seconds: float, par: float, resets: int, oversets: int) -> Array[String]:
	var out: Array[String] = []
	for id: String in opted:
		if is_met(id, seconds, par, resets, oversets):
			out.append(id)
	return out
