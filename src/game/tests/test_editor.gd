extends "res://game/tests/suite.gd"
## The lock editor's model: its rules against the web game's, and its edits against themselves.


func run() -> void:
	var g: Dictionary = golden("editor")
	same(EditorModel.EDITABLE_PINS, g["pins"], "the editable pins, in share-code order")
	for i: int in g["springs"].size():
		same(EditorModel.SPRING_LABELS[i], g["springs"][i]["label"], "spring %d label" % i)
		same(EditorModel.SPRING_VALUES[i], g["springs"][i]["value"], "spring %d strength" % i)
	same(EditorModel.SPRING_VALUES.size(), g["springs"].size(), "spring count")
	same(EditorModel.MIN_TOLERANCE, g["minTolerance"], "min tolerance")
	same(EditorModel.MAX_TOLERANCE, g["maxTolerance"], "max tolerance")
	same(EditorModel.MIN_DEPTH, g["minDepth"], "min depth")
	same(EditorModel.DEPTH_STEP, g["depthStep"], "depth step")
	same(EditorModel.CUSTOM_ID_BASE, g["customIdBase"], "custom id base")
	same(LockDefs.CAPTURE_WINDOW, g["captureWindow"], "capture window")
	same(LockDefs.MIN_CHAMBERS, g["minChambers"], "min chambers")
	same(LockDefs.MAX_CHAMBERS, g["maxChambers"], "max chambers")

	for pin: String in g["maxDepth"]:
		same(EditorModel.max_depth_for(pin), g["maxDepth"][pin], "deepest cut under a %s" % pin)
	for row: Array in g["snap"]:
		var mm := double_of(row[0])
		same(EditorModel.snap_depth(mm), row[1], "snap %s" % WebNum.text(mm))
	for row: Array in g["clamp"]:
		same(EditorModel.clamp_chamber_count(row[0]), row[1], "clamp %s chambers" % row[0])
	for row: Array in g["slugs"]:
		same(EditorModel.slug_for(row[0], row[1]), row[2], "slug for %s" % WebJson.quote(row[0]))

	for case: Dictionary in g["drafts"]:
		var model := _model(case["draft"])
		var what := "draft %s (%d chambers)" % [WebJson.quote(model.name), model.chambers.size()]
		var def := model.to_lock_def(case["index"])
		same(def, case["def"], what)
		same(def.keys(), case["def"].keys(), what + " key order")
		same(model.problem(case["index"]), case["problem"] if case["problem"] != null else "", what + " problem")
		same(model.window_width(), case["window"], what + " window")

	for case: Dictionary in g["fromDef"]:
		var model := EditorModel.from_lock_def(case["def"])
		var want: Dictionary = case["draft"]
		var what := "reading back %s" % case["def"]["slug"]
		same(model.name, want["name"], what + " name")
		same(model.chambers, want["chambers"], what + " chambers")
		same(model.tolerance_quality, want["toleranceQuality"], what + " tolerance")
		same(model.keyway, want["keyway"], what + " keyway")

	_fresh_drafts()
	_edits()
	_random_editing()


func _model(draft: Dictionary) -> EditorModel:
	var model := EditorModel.new()
	model.name = draft["name"]
	model.tolerance_quality = draft["toleranceQuality"]
	model.keyway = draft["keyway"]
	model.chambers.clear()
	for row: Dictionary in draft["chambers"]:
		model.chambers.append({"depth": float(row["depth"]), "pin": row["pin"], "spring": int(row["spring"])})
	return model


func _fresh_drafts() -> void:
	check(EditorModel.new().problem() == "", "a fresh draft is buildable the moment it exists")
	same(EditorModel.new().chambers.size(), 5, "a fresh draft has five chambers")
	for n in range(LockDefs.MIN_CHAMBERS, LockDefs.MAX_CHAMBERS + 1):
		check(EditorModel.new(n).problem() == "", "a fresh draft is buildable at %d chambers" % n)
	for pin in EditorModel.EDITABLE_PINS:
		var deep := EditorModel.new(3)
		var shallow := EditorModel.new(2)
		for row in deep.chambers:
			row["pin"] = pin
			row["depth"] = EditorModel.max_depth_for(pin)
		for row in shallow.chambers:
			row["pin"] = pin
			row["depth"] = EditorModel.MIN_DEPTH
		check(deep.problem() == "", "%s is buildable at its deepest cut" % pin)
		check(shallow.problem() == "", "%s is buildable at the shallowest cut" % pin)
		check(Profiles.highest_groove_top(pin) <= LockDefs.MAX_KEY_PIN - EditorModel.max_depth_for(pin),
			"%s keeps every groove below the shear line" % pin)
	for q: float in [EditorModel.MIN_TOLERANCE, EditorModel.MAX_TOLERANCE]:
		var model := EditorModel.new()
		model.tolerance_quality = q
		check(model.problem() == "", "tolerance %s is buildable" % q)


func _edits() -> void:
	var model := EditorModel.new(5)
	for i in 5:
		model.chambers[i]["pin"] = "spool"
		model.chambers[i]["spring"] = 2
	model.set_chamber_count(6)
	same(model.chambers[5], model.chambers[4], "a new chamber copies the last one")
	model.chambers[5]["pin"] = "standard"
	same(model.chambers[4]["pin"], "spool", "…and is a copy, not the same row")
	model.set_chamber_count(999)
	same(model.chambers.size(), LockDefs.MAX_CHAMBERS, "the count stops at the most a lock holds")
	check(not model.can_add_chamber() and model.can_remove_chamber(), "the + is spent at sixteen")
	model.set_chamber_count(-4)
	same(model.chambers.size(), LockDefs.MIN_CHAMBERS, "…and at the fewest")
	check(model.can_add_chamber() and not model.can_remove_chamber(), "the - is spent at one")

	model = EditorModel.new(3)
	model.set_depth(0, 99.0)
	same(model.chambers[0]["depth"], 4.0, "a plain pin's cut stops at 4.0")
	model.set_depth(0, -3.0)
	same(model.chambers[0]["depth"], EditorModel.MIN_DEPTH, "…and at the shallowest")
	model.set_depth(0, 2.449)
	same(model.chambers[0]["depth"], 2.4, "a cut lands on the grid")
	model.set_depth(7, 2.0)
	model.nudge_depth(-1, 1)
	model.cycle_pin(12)
	model.cycle_spring(12)
	check(true, "an index that is not a chamber is ignored")
	for step in 40:
		model.nudge_depth(0, 1)
	same(model.chambers[0]["depth"], 4.0, "nudging up stops at the limit")
	for step in 40:
		model.nudge_depth(0, -1)
	same(model.chambers[0]["depth"], 1.0, "nudging down stops at the floor")
	for step in 7:
		model.nudge_depth(0, 1)
	same(model.chambers[0]["depth"], 1.7, "seven nudges up from 1.0 is exactly 1.7")

	# Cycling the driver walks the whole list and pulls a too-deep cut back up with it.
	model = EditorModel.new(1)
	model.set_depth(0, 4.0)
	var seen: Array = []
	for step in EditorModel.EDITABLE_PINS.size():
		model.cycle_pin(0)
		var pin: String = model.chambers[0]["pin"]
		seen.append(pin)
		check(model.chambers[0]["depth"] <= EditorModel.max_depth_for(pin) + 1e-9, "the cut fits a %s" % pin)
		check(model.problem() == "", "still buildable with a %s" % pin)
	same(seen, EditorModel.EDITABLE_PINS.slice(1) + ["standard"], "the picker cycles in list order and wraps")

	# Naming the driver outright does what cycling to it does, cut and all.
	for pin in EditorModel.EDITABLE_PINS:
		model = EditorModel.new(2)
		model.set_depth(0, 4.0)
		model.set_pin(0, pin)
		same(model.chambers[0]["pin"], pin, "set_pin puts a %s in the chamber" % pin)
		same(model.chambers[1]["pin"], "standard", "…and leaves the next chamber alone (%s)" % pin)
		same(model.chambers[0]["depth"], model.max_depth(0), "a %s pulls a too-deep cut up to its limit" % pin)
		check(model.problem() == "", "still buildable with a %s set outright" % pin)
		model.nudge_depth(0, 1)
		same(model.chambers[0]["depth"], model.max_depth(0), "max_depth is where + stops under a %s" % pin)
	model = EditorModel.new(2)
	model.set_pin(0, "no-such-pin")
	model.set_pin(9, "spool")
	same(model.chambers[0]["pin"], "standard", "a driver the editor does not offer is ignored")
	model.set_depth(0, 2.0)
	model.set_pin(0, "spool")
	same(model.chambers[0]["depth"], 2.0, "a cut that already fits is left where it was")

	model = EditorModel.new(1)
	for spring in EditorModel.SPRING_LABELS.size():
		model.set_spring(0, spring)
		same(model.spring_label(0), EditorModel.SPRING_LABELS[spring], "set_spring %d" % spring)
	model.set_spring(0, 99)
	same(model.chambers[0]["spring"], EditorModel.SPRING_VALUES.size() - 1, "a spring past the list is the last one")
	model.set_spring(4, 0)

	model = EditorModel.new(1)
	var labels: Array = []
	for step in 4:
		labels.append(model.spring_label(0))
		model.cycle_spring(0)
	same(labels, ["normal", "stiff", "light", "normal"], "springs cycle normal, stiff, light")

	model = EditorModel.new()
	for step in 40:
		model.nudge_tolerance(1)
	same(model.tolerance_quality, EditorModel.MAX_TOLERANCE, "loosening stops at the ceiling")
	check(not model.can_loosen() and model.can_tighten(), "…and says so")
	var walked: Array = []
	for step in 40:
		model.nudge_tolerance(-1)
		walked.append(WebNum.to_fixed(model.tolerance_quality, 2))
	same(model.tolerance_quality, EditorModel.MIN_TOLERANCE, "tightening stops at the floor")
	check(not model.can_tighten() and model.can_loosen(), "…and says so")
	same(walked.slice(0, 4), ["1.35", "1.30", "1.25", "1.20"], "tolerance walks in twentieths")
	model.set_tolerance(0.874)
	same(model.tolerance_quality, 0.85, "tolerance lands on its grid")

	model.set_keyway("tight")
	same(model.keyway, "tight", "tight keyway")
	model.set_keyway("anything else")
	same(model.keyway, "standard", "anything else is a standard keyway")

	model.set_name("Bob's  Lock #2 — über-fine, really quite a long name")
	same(model.name, "Bobs  Lock 2  ber-fine r", "a name keeps letters, digits, spaces and hyphens, to 24")
	model.set_name("")
	same(model.to_lock_def(0)["name"], EditorModel.DEFAULT_NAME, "an empty name builds as the default")
	same(model.to_lock_def(3)["slug"], "custom-10003-lock", "…and still has a slug")

	model.reset()
	same(model.to_lock_def(0), EditorModel.new().to_lock_def(0), "reset is a fresh draft")

	var broken := EditorModel.new(2)
	broken.chambers[0]["depth"] = 9.0
	check(broken.problem().contains("key pins must sit below the shear line"), "an impossible draft says why")
	same(broken.share_code(), "", "…and has no code")

	# Loading a saved design copies it: editing the draft leaves the saved lock alone.
	var saved := EditorModel.new(4).to_lock_def(0)
	var copy := EditorModel.from_lock_def(saved)
	copy.set_depth(0, 1.0)
	copy.cycle_pin(1)
	same(saved["bitting"][0], 3.4, "the saved lock keeps its cut")
	same(saved["pins"][1], "standard", "…and its pins")


## A long run of arbitrary edits never leaves the editor holding a lock it cannot build, and
## whatever it holds survives a share code.
func _random_editing() -> void:
	var rng := Rng.create(20261001)
	var model := EditorModel.new()
	for step in 3000:
		var index := rng.next_int(model.chambers.size())
		match rng.next_int(8):
			0: model.set_chamber_count(model.chambers.size() + rng.next_int(5) - 2)
			1: model.set_depth(index, rng.next_range(-1.0, 7.0))
			2: model.nudge_depth(index, rng.next_int(3) - 1)
			3: model.cycle_pin(index)
			4: model.cycle_spring(index)
			5: model.set_tolerance(rng.next_range(0.0, 2.0))
			6: model.nudge_tolerance(rng.next_int(3) - 1)
			7: model.set_keyway("tight" if rng.next_int(2) == 0 else "standard")
		var problem := model.problem(step % 50)
		if not check(problem == "", "edit %d left an unbuildable draft: %s" % [step, problem]):
			return
		if step % 10 != 0:
			continue
		var def := model.to_lock_def(step % 50)
		var back := ShareCode.decode(model.share_code(step % 50))
		if not check(back.ok(), "edit %d: the draft's code does not read back: %s" % [step, back.problem]):
			return
		for key: String in ["bitting", "pins", "springs", "toleranceQuality", "keyway"]:
			same(back.def[key], def[key], "edit %d: %s survives a share code" % [step, key])
		same(EditorModel.from_lock_def(def).to_lock_def(step % 50), def, "edit %d: the lock reads back as the same draft" % step)
