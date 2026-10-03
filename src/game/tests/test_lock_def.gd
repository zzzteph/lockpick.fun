extends "res://game/tests/suite.gd"
## The validator's verdicts, word for word, and the roster it stands on.


func run() -> void:
	# The roster is shared ground: everything else here is only as right as it is. This build's
	# is the web game's, lock for lock and in the same order, with the disc detainers added.
	var roster: Array = golden("roster")
	var shared: Array = []
	for def in Roster.all():
		if def["family"] != "disc-detainer":
			shared.append(def)
	same(shared, roster, "the roster the web game has")
	for i in mini(roster.size(), shared.size()):
		same(shared[i].keys(), roster[i].keys(), "key order of %s" % roster[i]["slug"])
	_disc_detainers()

	var refused := 0
	for case: Dictionary in golden("lock_def"):
		var want: String = case["error"] if case["error"] != null else ""
		var got := LockDefs.validate(case["def"])
		check(got == want, "%s: want %s, got %s" % [case["name"], WebJson.quote(want), WebJson.quote(got)])
		check(LockDefs.is_valid(case["def"]) == (want == ""), "%s: is_valid agrees" % case["name"])
		if want != "":
			refused += 1
	check(refused > 50, "the vectors exercise the refusals (%d)" % refused)

	_what_this_build_does_not_have()
	_malformed_does_not_crash()

	same(LockDefs.detent_centre(0), 0.15, "digit 0 parks half a detent up")
	same(LockDefs.detent_centre(9), 2.85, "digit 9 parks half a detent from the top")
	same(LockDefs.chamber_count(Roster.by_slug("halberd-sovereign")), 7, "chamber count")
	same(LockDefs.chamber_count({}), 0, "chamber count of nothing")


## Families and pins the web validator knows and this build ships none of.
func _what_this_build_does_not_have() -> void:
	var base := Roster.by_slug("kestrel-door-cylinder").duplicate(true)
	base["pins"] = ["wafer", "wafer", "wafer", "wafer", "wafer"]
	check(LockDefs.validate(base).contains('"wafer" is not a known pin profile'), "a wafer is not a pin here")
	for family: String in ["wafer", "dimple", "tubular", ""]:
		var def := Roster.by_slug("kestrel-door-cylinder").duplicate(true)
		def["family"] = family
		check(LockDefs.validate(def).contains("is not a lock this game builds"), 'family "%s" is refused' % family)


## The family this build adds: every one it ships can be built, and what would make one a lock
## nobody can open is refused in a sentence.
func _disc_detainers() -> void:
	var seen := {}
	var count := 0
	var defs: Array = []
	for def in Roster.all():
		check(not seen.has(def["id"]), "id %d is used once" % def["id"])
		seen[def["id"]] = true
		if def["family"] == "disc-detainer":
			defs.append(def)
			count += 1
	check(count == 3, "three disc detainers on the bench (%d)" % count)
	for def: Dictionary in Lessons.LOCKS.values():
		if def["family"] == "disc-detainer":
			defs.append(def)
	for def: Dictionary in defs:
		same(LockDefs.validate(def), "", "%s can be built" % def["slug"])
		same(LockDefs.chamber_count(def), (def["bitting"] as Array).size(), "%s counts its discs" % def["slug"])
	var good: Dictionary = Roster.by_slug("vantage-disc-detainer-6")
	var odd := good.duplicate(true)
	odd["bitting"] = [3, 1, 4, 2, 6, 2]
	check(LockDefs.validate(odd).contains("bitting[4] = 6"), "a cut past a quarter turn is refused")
	odd = good.duplicate(true)
	odd["bitting"] = [3, 1, 4, 2.5, 5, 2]
	check(LockDefs.validate(odd).contains("whole number of steps"), "a cut between steps is refused")
	odd = good.duplicate(true)
	odd["discs"] = {"falseGates": [[3], [], [], [], [], []]}
	check(LockDefs.validate(odd).contains("sits on top of its true gate"), "a false gate on the true one is refused")
	odd = good.duplicate(true)
	odd["discs"] = {"falseGates": [[1], []]}
	check(LockDefs.validate(odd).contains("one list per disc"), "false gates for the wrong number of discs are refused")
	odd = good.duplicate(true)
	odd["discs"] = {"falseGates": [[1, 1], [], [], [], [], []]}
	check(LockDefs.validate(odd).contains("two false gates"), "the same false gate twice is refused")
	odd = good.duplicate(true)
	odd["discs"] = {"falseGates": [[9], [], [], [], [], []]}
	check(LockDefs.validate(odd).contains("off the disc"), "a false gate off the disc is refused")
	odd = good.duplicate(true)
	odd.erase("discs")
	same(LockDefs.validate(odd), "", "a disc detainer with no false gates needs no discs block")
	odd = good.duplicate(true)
	odd["bitting"] = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3]
	odd["pins"] = ["standard", "standard", "standard", "standard", "standard", "standard", "standard", "standard",
		"standard", "standard", "standard", "standard", "standard"]
	odd.erase("discs")
	check(LockDefs.validate(odd).contains("at most"), "more discs than a pack holds are refused")
	same(DiscRig.false_count(Roster.by_slug("vantage-sentinel-9")), 14, "the nine-disc lock's lies are counted")
	same(DiscRig.false_count(Roster.by_slug("vantage-disc-padlock")), 0, "the padlock carries none")


## A definition out of a hand-edited file can be missing anything. It must be refused with a
## sentence, never with a crash.
func _malformed_does_not_crash() -> void:
	var good := Roster.by_slug("halberd-sidebar-cylinder")
	check(LockDefs.validate({}) != "", "an empty definition is refused")
	for key: String in ["id", "slug", "name", "tier", "family", "bitting", "pins", "toleranceQuality", "par"]:
		var def := good.duplicate(true)
		def.erase(key)
		check(LockDefs.validate(def) != "", "missing %s is refused" % key)
		def[key] = null
		check(LockDefs.validate(def) != "", "null %s is refused" % key)
		def[key] = {"nested": true}
		check(LockDefs.validate(def) != "", "a dictionary for %s is refused" % key)
		def[key] = "text"
		if key not in ["slug", "name"]:
			check(LockDefs.validate(def) != "", "text for %s is refused" % key)
	var odd := good.duplicate(true)
	odd["springs"] = "tight"
	check(LockDefs.validate(odd) != "", "springs that are not a list are refused")
	odd = good.duplicate(true)
	odd["sidebar"] = {"gateWidth": 0.1}
	check(LockDefs.validate(odd) != "", "a sidebar without chambers is refused")
	odd = good.duplicate(true)
	odd["bitting"] = [3.3, "deep", 3.05, 3.1, 3.4, 4]
	check(LockDefs.validate(odd).contains("bitting[1] is not a finite number"), "a cut that is not a number is refused")
	var wheels := Roster.by_slug("ironhold-combination-chain").duplicate(true)
	wheels["discs"] = {"gateWidth": 0.12}
	check(LockDefs.validate(wheels) != "", "a wheel pack without gates is refused")
	wheels["discs"] = {"trueGates": [0.75, "x", 1.65, 1.05], "falseGates": [[], [], [], []], "gateWidth": 0.12}
	check(LockDefs.validate(wheels) != "", "a gate that is not a number is refused")
	wheels["discs"] = {"trueGates": [0.75, 2.55, 1.65, 1.05], "falseGates": [7, [], [], []], "gateWidth": "wide"}
	check(LockDefs.validate(wheels) != "", "a gate width that is not a number is refused")
