extends "res://game/tests/suite.gd"
## Share codes: the same lock is the same string in both builds, in both directions.
##
## One knowing difference from the web game, and it is counted below rather than hidden: the
## web reader hands back whatever fields a well-formed code carries, even when they do not add
## up to a lock its own validator accepts. This build refuses those.

const UNBUILDABLE := "that code describes a lock this game cannot build"

var refused_here_only := 0


func run() -> void:
	var g: Dictionary = golden("sharecode")

	var coded := 0
	var rounded_out: Array = []
	for row: Dictionary in g["roster"]:
		var def := Roster.by_slug(row["slug"])
		var what := "roster %s" % row["slug"]
		if row["encoded"] != null:
			same(ShareCode.encode(def), row["encoded"], what + " packs to the same string")
		var web_code: String = row["code"] if row["code"] != null else ""
		var web_problem: String = row["problem"] if row["problem"] != null else ""
		if web_code != "" and not row["back"]["valid"]:
			# The web lists a code here that reads back as a lock it cannot build.
			rounded_out.append(row["slug"])
			check(ShareCode.problem_for(def) != "", what + " has no code here, and a reason")
			same(ShareCode.code_for(def), "", what + " has no code here")
			check(not ShareCode.decode(web_code).ok(), what + ": the web's code is refused")
			continue
		same(ShareCode.problem_for(def), web_problem, what + " problem")
		same(ShareCode.code_for(def), web_code, what + " code")
		if web_code != "":
			coded += 1
			same(ShareCode.format(web_code), row["formatted"], what + " formatted")
			_decodes(row["back"], what)
	same(rounded_out, ["meridian-euro-profile", "halberd-sovereign"], "the roster locks whose cuts do not survive a code")
	same(coded, 17, "roster locks with a code")

	for i: int in g["locks"].size():
		var row: Dictionary = g["locks"][i]
		var what := "lock %d (%s)" % [i, row["def"]["slug"]]
		same(ShareCode.encode(row["def"]), row["code"], what + " packs to the same string")
		same(ShareCode.problem_for(row["def"]), row["problem"] if row["problem"] != null else "", what + " problem")
		_decodes(row["back"], what)

	for row: Dictionary in g["variants"]:
		_decodes(row, "typed %s" % WebJson.quote(str(row["input"]).substr(0, 40)))
	check(refused_here_only > 100, "the vectors reach the codes only this build refuses (%d)" % refused_here_only)

	for row: Array in g["format"]:
		same(ShareCode.format(row[0]), row[1], "format %s" % row[0])

	same(ShareCode.clean_entry("  ab-12 cd!ö_"), "AB-12CD", "a typed code keeps letters, digits and hyphens, upper-cased")
	same(ShareCode.clean_entry("a".repeat(80)).length(), ShareCode.MAX_ENTRY, "a typed code stops at the longest a code gets")
	same(ShareCode.format(ShareCode.encode(EditorModel.new(16).to_lock_def(0))).length(), ShareCode.MAX_ENTRY, "…which is sixteen chambers, grouped")
	check(ShareCode.encode(EditorModel.new(5).to_lock_def(0)).length() <= 16, "a five-pin code is short enough to read out")


## What reading `row["input"]` must produce, given what the web game made of it.
func _decodes(row: Dictionary, what: String) -> void:
	var got := ShareCode.decode(str(row["input"]), row["index"])
	if row["def"] == null:
		same(got.problem, row["problem"], what + " is refused for the same reason")
		check(got.def.is_empty(), what + " hands back no lock")
	elif row["valid"]:
		check(got.ok(), what + " reads: " + got.problem)
		same(got.def, row["def"], what + " reads back as the same lock")
		same(got.def.keys(), row["def"].keys(), what + " key order")
		check(LockDefs.is_valid(got.def), what + " is a lock the game accepts")
	else:
		refused_here_only += 1
		same(got.problem, UNBUILDABLE, what + " is refused as unbuildable")
		check(got.def.is_empty(), what + " hands back no lock")
		check(not LockDefs.is_valid(row["def"]), what + ": the web's reading really is unbuildable")
