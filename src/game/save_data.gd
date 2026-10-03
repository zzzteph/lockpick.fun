class_name SaveData
extends RefCounted
## The save: its shape, its defaults, and the road every older save takes to reach it.
##
## A save is one Dictionary, keyed exactly as the web game keys it, because the two builds
## read each other's files:
##
##   version      int — VERSION
##   records      { slug: { opens, bestTime, bestOversets, bestRank, challenges } }
##   achievements [ id ]
##   settings     { …DEFAULT_SETTINGS }
##   tutorial     [ lesson id ]
##   playDays     { "YYYY-MM-DD": locks opened that day }
##   customLocks  [ lock definition ]
##   streakBest   { assist: { score, opens } }
##   gunOpens     { slug: count }
##   lockSalt     int — this player's bench, as one number
##
## Versioned and migrated forward rather than replaced: losing a player's progress to a schema
## change is the one outcome that is not acceptable, so every version that ever shipped still
## loads. Nothing here touches the disk — `SaveStore` does — which is what lets all of it be
## exercised by handing it Dictionaries.
##
## The web game's dungeon keeps a best score in the save (`gauntletBest`). This build has no
## dungeon: the field is dropped on the way in and never written.

const VERSION := 5

const ASSISTS: Array[String] = ["training", "normal"]
const HANDS: Array[String] = ["left", "right"]
const INTERFACE_MODES: Array[String] = ["auto", "full", "compact"]
const THEMES: Array[String] = ["drafting", "blueprint"]

const SENSITIVITY_MIN := 0.4
const SENSITIVITY_MAX := 2.0

# ── What the settings screen offers, in the order it lists it ───────────────────────────
## The sliders: [caption, key, low, high]. Every one steps by SLIDER_STEP.
const SLIDERS: Array[Array] = [
	["sensitivity", "sensitivity", SENSITIVITY_MIN, SENSITIVITY_MAX],
	["master volume", "masterVolume", 0.0, 1.0],
	["mechanical", "mechanicalVolume", 0.0, 1.0],
	["ambient", "ambientVolume", 0.0, 1.0],
]
const SLIDER_STEP := 0.05
## The switches: [caption, key].
const SWITCHES: Array[Array] = [
	["mute everything", "muted"],
	["hold tension (off = toggle)", "tensionToggle"],
	["reduce motion", "reducedMotion"],
	["continuous tones (hum, scrape, bed)", "continuousTones"],
	["audio subtitles", "subtitles"],
	["vibrate", "haptics"],
]

## In the order the file carries them.
const DEFAULT_SETTINGS := {
	## Multiplier on the keyboard's lift trim.
	"sensitivity": 1.0,
	## Tension as a toggle rather than a held button.
	"tensionToggle": false,
	"masterVolume": 0.8,
	"mechanicalVolume": 1.0,
	"ambientVolume": 0.2,
	"uiVolume": 0.7,
	"muted": false,
	"reducedMotion": false,
	## The continuous voices — binding hum, spring, scrape, room bed. Off unless asked for:
	## the clicks carry the information a player acts on, the drone under them is atmosphere.
	"continuousTones": false,
	"subtitles": false,
	## Training, not Normal: a new save starts on the rung that explains itself.
	"assist": "training",
	## Which side the keyway opens on. The lock itself never learns which way it is drawn.
	"handedness": "left",
	## Vibrate on what a hand would feel — pins setting, oversets, a reset.
	"haptics": true,
	## Carried for the web game, which has two palettes; this build draws one.
	"theme": "drafting",
	## Full page, compact page, or let the screen decide.
	"interfaceMode": "auto",
}

## Achievements that named the tool shop, gone with it at version 4.
const _SHOP_ACHIEVEMENTS: Array[String] = ["well-equipped", "frugal", "one-tool", "tooled-up"]

## The four assist names version 2 used, on the two rungs that are left.
const _V2_ASSIST := {
	"guided": "training",
	"standard": "normal",
	"expert": "normal",
	"blind": "normal",
}


## What reading a save produced: the save, or why there is none.
class Loaded:
	extends RefCounted
	var data: Dictionary = {}
	## Set when the text or blob could not be used. `data` is then a fresh save.
	var problem := ""
	## True when something was there to read, usable or not.
	var existed := false

	func ok() -> bool:
		return problem == ""


# ── Fresh data ──────────────────────────────────────────────────────────────────────────

static func fresh() -> Dictionary:
	return {
		"version": VERSION,
		"records": {},
		"achievements": [],
		"settings": DEFAULT_SETTINGS.duplicate(),
		"tutorial": [],
		"playDays": {},
		"customLocks": [],
		"streakBest": {},
		"gunOpens": {},
		"lockSalt": roll_salt(),
	}


static func empty_record() -> Dictionary:
	return {"opens": 0, "bestTime": null, "bestOversets": null, "bestRank": null, "challenges": []}


## Any odd 32-bit value; `seed_for_lock` does the work of spreading it. Rolled once, when the
## save is created — the one place the game's records reach for real randomness.
static func roll_salt() -> int:
	return (randi() | 1) & WebNum.MASK32


## The tolerance seed for one lock on one bench — stable for as long as the save exists.
##
## Every lock's seed comes from the save's salt and the lock's slug, so *your* Brasswell No.1
## is a specific physical copy — same binding order, same heavy chamber — every time you sit
## down with it, while somebody else's is a different copy of the same catalogue model. It has
## to be stable, which rules out the clock, and well spread, because neighbouring slugs must
## not bind in the same order.
static func seed_for_lock(slug: String, salt: int) -> int:
	var h := salt & WebNum.MASK32
	var units := slug.to_utf16_buffer()
	for i in range(0, units.size(), 2):
		h = WebNum.imul(h ^ units.decode_u16(i), 0x01000193)
	h = WebNum.imul(h ^ (h >> 16), 0x85EBCA6B)
	h ^= h >> 13
	var seed_value := h % 100000
	return seed_value if seed_value != 0 else 1


## The rung a save's assist name lands on, or "" for a name that means nothing. `training`
## survives; the three levels that were cut all become `normal` — the picture stays, the
## colour goes.
static func normalize_assist(value: Variant) -> String:
	if not (value is String or value is StringName):
		return ""
	match String(value):
		"training":
			return "training"
		"normal", "easy", "medium", "hard":
			return "normal"
	return ""


# ── Migration ───────────────────────────────────────────────────────────────────────────

## Bring any save forward to the current version, filling in whatever is missing and
## repairing whatever is damaged. Refuses only two things: data that is not a save at all,
## and a save from a *newer* build — silently discarding a future save would be the one
## genuinely unrecoverable outcome.
static func migrate(raw: Variant) -> Loaded:
	var out := Loaded.new()
	out.existed = true
	if not raw is Dictionary:
		return _refuse(out, "save data is not an object")
	var data: Dictionary = (raw as Dictionary).duplicate()
	var version := _number(data.get("version"))
	if not is_finite(version) or version < 1.0:
		# A blob from before the schema was numbered.
		version = 1.0
		data["version"] = 1
	if version > VERSION:
		return _refuse(out, ("save is version %s but this build understands up to %d — "
			+ "it was written by a newer version of the game") % [WebNum.text(version), VERSION])
	while version < VERSION:
		if version == 1.0:
			data = _from_v1(data)
		elif version == 2.0:
			data = _from_v2(data)
		elif version == 3.0:
			data = _from_v3(data)
		elif version == 4.0:
			data = _from_v4(data)
		else:
			return _refuse(out, "no migration from save version %s" % WebNum.text(version))
		version = _number(data.get("version"))
	out.data = _tidy(data)
	return out


static func _refuse(out: Loaded, why: String) -> Loaded:
	out.problem = why
	out.data = fresh()
	return out


## Version 1 was a flat count of opens per lock, and settings. Everything else starts empty.
static func _from_v1(old: Dictionary) -> Dictionary:
	var records := {}
	var opens: Variant = old.get("opens")
	if opens is Dictionary:
		for slug: Variant in opens:
			var record := empty_record()
			record["opens"] = _count(opens[slug])
			records[slug] = record
	return {"version": 2, "records": records, "settings": old.get("settings")}


## Version 2 -> 3: the assist levels were renamed. A setting naming a level that no longer
## exists would otherwise fall through to the default and silently move the player.
static func _from_v2(old: Dictionary) -> Dictionary:
	var settings: Dictionary = (old["settings"] as Dictionary).duplicate() if old.get("settings") is Dictionary else {}
	var was: Variant = settings.get("assist")
	if was is String and _V2_ASSIST.has(was):
		settings["assist"] = _V2_ASSIST[was]
	old["version"] = 3
	old["settings"] = settings
	return old


## Version 3 -> 4: the tool shop went, and the achievements that named it went with it — a
## trophy the wall can no longer name is a hole in the case.
static func _from_v3(old: Dictionary) -> Dictionary:
	var kept: Array = []
	if old.get("achievements") is Array:
		for id: Variant in old["achievements"]:
			if not _SHOP_ACHIEVEMENTS.has(_text(id)):
				kept.append(_text(id))
	for gone: String in ["tools", "loadout", "spent", "starterOpens"]:
		old.erase(gone)
	old["version"] = 4
	old["achievements"] = kept
	return old


## Version 4 -> 5: credits went and rank became the currency.
##
## Existing records keep their best time and gain a best rank derived from it — a player who
## has beaten par on nine locks must not open the game to nine blank ranks and a locked
## Tier 2. The derivation cannot know which assist level those times were set on, so it reads
## them against the lock's plain par. A lock no longer in the roster gets no rank rather than
## a wrong one. `daily` becomes `playDays`: the same shape, doing a job that is actually done.
static func _from_v4(old: Dictionary) -> Dictionary:
	var migrated := {}
	if old.get("records") is Dictionary:
		var records: Dictionary = old["records"]
		for slug: Variant in records:
			var record: Dictionary = (records[slug] as Dictionary).duplicate() if records[slug] is Dictionary else {}
			var best: Variant = record.get("bestTime")
			var lock := Roster.by_slug(str(slug))
			var par: float = lock.get("par", 0)
			record["bestRank"] = Ranks.index_for(best, par) if WebNum.is_number(best) and par > 0 else null
			migrated[slug] = record
	var daily: Variant = old.get("daily")
	old.erase("credits")
	old.erase("daily")
	old["version"] = VERSION
	old["records"] = migrated
	old["playDays"] = daily if daily is Dictionary else {}
	return old


# ── Repair ──────────────────────────────────────────────────────────────────────────────

## A current-version blob, rebuilt field by field: anything missing takes its default,
## anything of the wrong shape is dropped rather than trusted, and unknown fields do not
## survive. A malformed custom lock is one lost creation; refusing to load would be the whole
## player's progress.
static func _tidy(data: Dictionary) -> Dictionary:
	var records := {}
	if data.get("records") is Dictionary:
		var raw_records: Dictionary = data["records"]
		for slug: Variant in raw_records:
			records[str(slug)] = _tidy_record(raw_records[slug])

	var play_days := {}
	if data.get("playDays") is Dictionary:
		var raw_days: Dictionary = data["playDays"]
		for day: Variant in raw_days:
			play_days[str(day)] = _count(raw_days[day])

	var custom_locks: Array = []
	if data.get("customLocks") is Array:
		for def: Variant in data["customLocks"]:
			if def is Dictionary and LockDefs.is_valid(def):
				custom_locks.append(def)

	# A best is a score to beat, so two old rungs folding onto one key is no loss worth
	# guarding: the later one in the file wins.
	var streak_best := {}
	if data.get("streakBest") is Dictionary:
		var raw_bests: Dictionary = data["streakBest"]
		for key: Variant in raw_bests:
			var assist := normalize_assist(key)
			var score := _tidy_streak_score(raw_bests[key])
			if assist != "" and not score.is_empty():
				streak_best[assist] = score

	# A bump tally is a positive count or it is nothing.
	var gun_opens := {}
	if data.get("gunOpens") is Dictionary:
		var raw_gun: Dictionary = data["gunOpens"]
		for slug: Variant in raw_gun:
			var n := _number(raw_gun[slug])
			if is_finite(n) and n >= 1.0:
				gun_opens[str(slug)] = int(n)

	# A save from before the salt existed gets one of its own, rather than every such player
	# sharing a bench.
	var salt: Variant = data.get("lockSalt")
	var lock_salt := int(salt) & WebNum.MASK32 if WebNum.is_number(salt) and is_finite(salt) and salt > 0 else roll_salt()

	return {
		"version": VERSION,
		"records": records,
		"achievements": _texts(data.get("achievements")),
		"settings": tidy_settings(data.get("settings")),
		"tutorial": _texts(data.get("tutorial")),
		"playDays": play_days,
		"customLocks": custom_locks,
		"streakBest": streak_best,
		"gunOpens": gun_opens,
		"lockSalt": lock_salt,
	}


static func _tidy_record(raw: Variant) -> Dictionary:
	var record := empty_record()
	if not raw is Dictionary:
		return record
	record["opens"] = _count(raw.get("opens"))
	var best_time: Variant = raw.get("bestTime")
	if WebNum.is_number(best_time) and is_finite(best_time):
		record["bestTime"] = float(best_time)
	var best_oversets: Variant = raw.get("bestOversets")
	if WebNum.is_number(best_oversets) and is_finite(best_oversets):
		record["bestOversets"] = maxi(0, int(best_oversets))
	var best_rank: Variant = raw.get("bestRank")
	if WebNum.is_number(best_rank) and is_finite(best_rank):
		record["bestRank"] = clampi(int(best_rank), Ranks.S, Ranks.F)
	record["challenges"] = _texts(raw.get("challenges"))
	return record


## A best run is a non-negative score and open count, or it is nothing.
static func _tidy_streak_score(raw: Variant) -> Dictionary:
	if not raw is Dictionary:
		return {}
	var score: Variant = raw.get("score")
	var opens: Variant = raw.get("opens")
	if not WebNum.is_number(score) or not is_finite(score) or score < 0:
		return {}
	if not WebNum.is_number(opens) or not is_finite(opens) or opens < 0:
		return {}
	return {"score": int(score), "opens": int(opens)}


## Settings with every key present, every value of the right kind and inside its range.
## A value that cannot be read takes the default; a key this build does not know is dropped.
static func tidy_settings(raw: Variant) -> Dictionary:
	var out := DEFAULT_SETTINGS.duplicate()
	if not raw is Dictionary:
		return out
	for key: String in DEFAULT_SETTINGS:
		if raw.has(key):
			out[key] = _tidy_setting(key, raw[key], DEFAULT_SETTINGS[key])
	return out


static func _tidy_setting(key: String, value: Variant, fallback: Variant) -> Variant:
	match key:
		"assist":
			var assist := normalize_assist(value)
			return assist if assist != "" else fallback
		"handedness":
			return _one_of(value, HANDS, fallback)
		"interfaceMode":
			return _one_of(value, INTERFACE_MODES, fallback)
		"theme":
			return _one_of(value, THEMES, fallback)
		"sensitivity":
			return _in_range(value, SENSITIVITY_MIN, SENSITIVITY_MAX, fallback)
		"masterVolume", "mechanicalVolume", "ambientVolume", "uiVolume":
			return _in_range(value, 0.0, 1.0, fallback)
	return value if value is bool else fallback


static func _one_of(value: Variant, choices: Array[String], fallback: Variant) -> Variant:
	if (value is String or value is StringName) and choices.has(String(value)):
		return String(value)
	return fallback


static func _in_range(value: Variant, low: float, high: float, fallback: Variant) -> Variant:
	if not WebNum.is_number(value) or not is_finite(value):
		return fallback
	# Clamped, never rounded: a value already inside must come back out of the file unchanged.
	return clampf(float(value), low, high)


# ── Reading loosely-typed values ────────────────────────────────────────────────────────

## A value as a number, the way a browser coerces one: numeric strings count, `true` is 1,
## nothing is 0, and anything else is not a number.
static func _number(value: Variant) -> float:
	match typeof(value):
		TYPE_INT, TYPE_FLOAT:
			return float(value)
		TYPE_BOOL:
			return 1.0 if value else 0.0
		TYPE_NIL:
			return 0.0
		TYPE_STRING, TYPE_STRING_NAME:
			var s := String(value).strip_edges()
			if s == "":
				return 0.0
			return WebNum.parse(s) if _is_decimal(s) else NAN
	return NAN


static func _is_decimal(s: String) -> bool:
	var at := 0
	var n := s.length()
	if at < n and (s[at] == "-" or s[at] == "+"):
		at += 1
	var digits := 0
	while at < n and s.unicode_at(at) >= 48 and s.unicode_at(at) <= 57:
		at += 1
		digits += 1
	if at < n and s[at] == ".":
		at += 1
		while at < n and s.unicode_at(at) >= 48 and s.unicode_at(at) <= 57:
			at += 1
			digits += 1
	if digits == 0:
		return false
	if at < n and (s[at] == "e" or s[at] == "E"):
		at += 1
		if at < n and (s[at] == "-" or s[at] == "+"):
			at += 1
		var exponent := 0
		while at < n and s.unicode_at(at) >= 48 and s.unicode_at(at) <= 57:
			at += 1
			exponent += 1
		if exponent == 0:
			return false
	return at == n


## A count: a whole number, never negative, zero for anything unreadable.
static func _count(value: Variant) -> int:
	var n := _number(value)
	return maxi(0, int(n)) if is_finite(n) else 0


static func _text(value: Variant) -> String:
	if value is String:
		return value
	if value == null:
		return "null"
	if WebNum.is_number(value):
		return WebNum.text(value)
	return str(value)


static func _texts(value: Variant) -> Array:
	var out: Array = []
	if value is Array:
		for item: Variant in value:
			out.append(_text(item))
	return out
