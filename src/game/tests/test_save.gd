extends "res://game/tests/suite.gd"
## Saves: every version that ever shipped reads to the same data the web game makes of it,
## and writes back to the same text.

const SCRATCH := "user://game_tests_save.json"


func run() -> void:
	var g: Dictionary = golden("save")
	same(SaveData.VERSION, g["version"], "save version")
	same(SaveData.DEFAULT_SETTINGS, g["defaults"], "default settings")
	same(SaveData.DEFAULT_SETTINGS.keys(), g["defaults"].keys(), "default settings, in file order")
	same(SaveData.fresh().keys(), g["freshKeys"], "a fresh save's fields, in file order")

	for case: Dictionary in g["cases"]:
		var what: String = case["name"]
		var loaded := SaveStore.decode(case["text"])
		check(loaded.existed, what + ": something was there to read")
		if case["error"] != null:
			same(loaded.problem, case["error"], what + " is refused, and says why")
			same(loaded.data.keys(), g["freshKeys"], what + ": a refusal still hands back a usable save")
			continue
		if not check(loaded.ok(), "%s reads: %s" % [what, loaded.problem]):
			continue
		if case["randomSalt"]:
			var salt: int = loaded.data["lockSalt"]
			check(salt > 0 and salt <= WebNum.MASK32 and salt % 2 == 1, what + ": a missing salt is rolled, odd and 32-bit")
			loaded.data["lockSalt"] = 1
		same(loaded.data, case["data"], what)
		same(SaveStore.encode(loaded.data), case["exported"], what + ": exports to the web game's text")
		check(case["webReadsItBack"], what + ": the web game reads that export back unchanged")
		check(not loaded.data.has("gauntletBest"), what + ": no dungeon field survives")
		# Reading its own export changes nothing.
		var again := SaveStore.decode(SaveStore.encode(loaded.data))
		same(SaveStore.encode(again.data), case["exported"], what + ": a second trip is a no-op")

	for row: Array in g["seeds"]:
		same(SaveData.seed_for_lock(row[0], row[1]), row[2], "seed for %s on bench %s" % [WebJson.quote(row[0]), row[1]])

	_fresh()
	_sanitising()
	_on_disk()


func _fresh() -> void:
	var a := SaveData.fresh()
	same(a["version"], SaveData.VERSION, "a fresh save is current")
	same(a["settings"], SaveData.DEFAULT_SETTINGS, "…with default settings")
	same([a["records"], a["achievements"], a["tutorial"], a["playDays"], a["customLocks"], a["streakBest"], a["gunOpens"]],
		[{}, [], [], {}, [], {}, {}], "…and nothing in it")
	a["settings"]["muted"] = true
	a["achievements"].append("first-blood")
	var b := SaveData.fresh()
	check(not b["settings"]["muted"] and b["achievements"].is_empty(), "fresh saves do not share their contents")
	check(SaveData.migrate(SaveData.fresh()).ok(), "a fresh save is a valid save")
	same(SaveData.empty_record(), {"opens": 0, "bestTime": null, "bestOversets": null, "bestRank": null, "challenges": []}, "an empty record")

	# What the settings screen lists is all real settings of the right kind.
	for row in SaveData.SLIDERS:
		check(SaveData.DEFAULT_SETTINGS.get(row[1]) is float, "slider %s is a number setting" % row[1])
		check(row[2] <= SaveData.DEFAULT_SETTINGS[row[1]] and SaveData.DEFAULT_SETTINGS[row[1]] <= row[3], "…whose default is in range")
	for row in SaveData.SWITCHES:
		check(SaveData.DEFAULT_SETTINGS.get(row[1]) is bool, "switch %s is an on/off setting" % row[1])
	same(SaveData.SLIDERS.size() + SaveData.SWITCHES.size() + 3, SaveData.DEFAULT_SETTINGS.size() - 2,
		"with level, hand and interface that is every setting but the two the screen does not show")


## Where this build is stricter than the web game: a loaded value is the right kind and in
## range, or it is the default.
func _sanitising() -> void:
	var loaded := SaveData.migrate({
		"version": 5,
		"lockSalt": 9,
		"settings": {
			"sensitivity": 40, "masterVolume": -3, "mechanicalVolume": "loud", "ambientVolume": 0.25, "uiVolume": null,
			"muted": 1, "tensionToggle": "yes", "reducedMotion": true, "handedness": "both", "interfaceMode": "huge",
			"theme": "blueprint", "assist": "blind", "haptics": false, "cheats": true, "0": "g",
		},
		"records": {"a": {"opens": -4, "bestTime": 5, "bestOversets": -2, "bestRank": 99}, "b": {"opens": 2.9, "bestRank": -3}},
		"playDays": {"2026-01-01": -5, "2026-01-02": 2.9},
		"gunOpens": {"a": 0.5, "b": 2.9},
		"customLocks": [
			{"id": 10000, "slug": "custom-10000-ok", "name": "ok", "tier": 1, "family": "pin-tumbler", "bitting": [3, 3.4],
				"pins": ["standard", "spool"], "toleranceQuality": 1, "keyway": "standard", "par": 36},
			{"id": 10001, "slug": "custom-10001-bad", "name": "bad", "tier": 1, "family": "pin-tumbler", "bitting": [3, 4.4],
				"pins": ["standard", "spool"], "toleranceQuality": 1, "keyway": "standard", "par": 36},
			{"id": 10002, "slug": "custom-10002-wafer", "name": "wafer", "tier": 1, "family": "wafer", "bitting": [3],
				"pins": ["wafer"], "toleranceQuality": 1, "keyway": "standard", "par": 20},
		],
		"somethingNew": [1, 2, 3],
	})
	check(loaded.ok(), "a save full of nonsense still loads")
	var s: Dictionary = loaded.data["settings"]
	same(s.keys(), SaveData.DEFAULT_SETTINGS.keys(), "settings keep exactly the known keys, in order")
	same([s["sensitivity"], s["masterVolume"], s["mechanicalVolume"], s["ambientVolume"], s["uiVolume"]],
		[2.0, 0.0, 1.0, 0.25, 0.7], "numbers are clamped, or defaulted when they are not numbers")
	same([s["muted"], s["tensionToggle"], s["reducedMotion"], s["haptics"]], [false, false, true, false],
		"switches are booleans, or the default")
	same([s["handedness"], s["interfaceMode"], s["theme"], s["assist"]], ["left", "auto", "blueprint", "training"],
		"choices are one of the choices, or the default")
	same(loaded.data["records"]["a"], {"opens": 0, "bestTime": 5.0, "bestOversets": 0, "bestRank": 6, "challenges": []},
		"a record's counts are whole and its rank is on the ladder")
	same(loaded.data["records"]["b"]["opens"], 2, "a fractional count is truncated")
	same(loaded.data["records"]["b"]["bestRank"], 0, "a rank below S is S")
	same(loaded.data["playDays"], {"2026-01-01": 0, "2026-01-02": 2}, "play days are whole and never negative")
	same(loaded.data["gunOpens"], {"b": 2}, "a bump tally is a whole count or nothing")
	same(loaded.data["customLocks"].size(), 1, "a custom lock that cannot be built is dropped")
	same(loaded.data["customLocks"][0]["slug"], "custom-10000-ok", "…and the one that can is kept")
	check(not loaded.data.has("somethingNew"), "unknown fields do not survive")

	same(SaveData.tidy_settings(null), SaveData.DEFAULT_SETTINGS, "no settings at all is the defaults")
	same(SaveData.tidy_settings({"assist": &"normal"})["assist"], "normal", "a level may arrive as a StringName")
	for name: String in ["training"]:
		same(SaveData.normalize_assist(name), "training", "training survives")
	for name: String in ["normal", "easy", "medium", "hard"]:
		same(SaveData.normalize_assist(name), "normal", "%s lands on normal" % name)
	for name: Variant in ["guided", "", null, 3, "Training"]:
		same(SaveData.normalize_assist(name), "", "%s names no level" % str(name))

	# A file saved by an editor may lead with a byte-order mark.
	check(SaveStore.decode("﻿" + SaveStore.encode(SaveData.fresh())).ok(), "a byte-order mark is not a syntax error")


func _on_disk() -> void:
	var store := SaveStore.new(SCRATCH)
	store.clear()
	DirAccess.remove_absolute(SCRATCH + SaveStore.REJECT_SUFFIX)
	check(not store.exists(), "nothing saved yet")
	var first := store.load_save()
	check(not first.existed and first.ok() and first.data["records"].is_empty(), "no file is a fresh start")

	var progress := Progress.new(store)
	check(progress.load_problem == "", "a fresh start is not a problem")
	check(not store.exists(), "starting writes nothing")
	var def := Roster.by_slug("brasswell-no1-luggage")
	progress.complete_attempt(AttemptOutcome.of(def, true, 12.508333333333335), "2026-10-01")
	progress.update_settings({"sensitivity": 1.6, "assist": &"normal"})
	check(store.exists(), "an open autosaves")
	same(store.read_text(), progress.export_text(), "the file on disk is the export text")
	check(not FileAccess.file_exists(SCRATCH + ".tmp"), "no staging file is left behind")

	var reloaded := Progress.new(store)
	same(reloaded.data, progress.data, "reloading gives back an identical save")
	same(reloaded.record(def["slug"])["bestTime"], 12.508333333333335, "…to the last bit of a best time")
	same(reloaded.settings["sensitivity"], 1.6, "…and the settings")
	same(reloaded.assist(), &"normal", "…and the level")

	# An unreadable save starts fresh, says so, and is set aside rather than overwritten.
	store.write_text("{ this is not json")
	var broken := Progress.new(store)
	check(broken.load_problem != "", "an unreadable save is reported")
	check(broken.data["records"].is_empty(), "…and the game starts fresh")
	same(FileAccess.get_file_as_string(SCRATCH + SaveStore.REJECT_SUFFIX), "{ this is not json", "…with the original kept beside it")
	store.write_text(WebJson.stringify({"version": 99}))
	same(Progress.new(store).load_problem,
		"save is version 99 but this build understands up to 5 — it was written by a newer version of the game",
		"a save from a newer build is refused, not mangled")

	# Import replaces the save and writes it; a bad import leaves everything alone.
	var before := progress.export_text()
	same(progress.import_text("<html>"), "that file is not valid JSON", "a bad import says why")
	same(progress.import_text("[1, 2]"), "save data is not an object", "…whatever is wrong with it")
	same(progress.export_text(), before, "…and changes nothing")
	var other := SaveData.fresh()
	other["lockSalt"] = 4242
	other["tutorial"] = ["lesson-1"]
	same(progress.import_text(SaveStore.encode(other)), "", "a good import succeeds")
	same(progress.data, other, "…and replaces the save")
	same(Progress.new(store).data, other, "…on disk too")

	store.clear()
	check(not store.exists(), "clear removes the file")
	DirAccess.remove_absolute(SCRATCH + SaveStore.REJECT_SUFFIX)

	var memory := SaveStore.memory()
	check(not memory.exists() and memory.read_text() == "", "a memory store starts empty")
	memory.write(SaveData.fresh())
	check(memory.exists() and memory.load_save().ok(), "…and holds what it is given")
	memory.clear()
	check(not memory.exists(), "…until cleared")
