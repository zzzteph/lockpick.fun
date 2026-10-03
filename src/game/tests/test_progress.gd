extends "res://game/tests/suite.gd"
## Progress, achievements and challenges: scripted careers replayed step by step against what
## the web game made of the same steps.


func run() -> void:
	var g: Dictionary = golden("progress")
	same(Progress.MAX_TIER, g["maxTier"], "max tier")
	for tier: String in g["requirement"]:
		same(Progress.TIER_UNLOCK_REQUIREMENT[int(tier)], g["requirement"][tier], "stated requirement for tier %s" % tier)
	for tier: String in g["rosterTiers"]:
		var row: Dictionary = g["rosterTiers"][tier]
		# The web game's locks, tier for tier; the disc detainers this build adds sit beside them.
		var slugs: Array = []
		for def in Roster.in_tier(int(tier)):
			if def["family"] != "disc-detainer":
				slugs.append(def["slug"])
		same(slugs, row["locks"], "locks in tier %s" % tier)
		same(Progress.opens_required_for(int(tier)), row["required"] + _unstated(int(tier)), "opens required for tier %s" % tier)

	_catalogues(g)
	for script_name: String in g["scripts"]:
		_play(script_name, g["scripts"][script_name])
	_outcomes()


func _catalogues(g: Dictionary) -> void:
	same(Achievements.count(), g["achievements"].size(), "achievement count")
	same(Achievements.count(), 10, "there are ten")
	for i: int in g["achievements"].size():
		var want: Dictionary = g["achievements"][i]
		var got := Achievements.all()[i]
		for key: String in ["id", "name", "condition", "group"]:
			same(got[key], want[key], "achievement %d %s" % [i, key])
		same(Achievements.is_reachable(want["id"]), want["reachable"], "%s reachable" % want["id"])
		same(Achievements.by_id(want["id"]), got, "%s by id" % want["id"])
		check(Achievements.GROUPS.has(got["group"]), "%s is in a known group" % want["id"])
		check(FileAccess.file_exists(Achievements.art_path(want["id"])), "%s has its drawing" % want["id"])
	check(Achievements.unreachable().is_empty(), "nothing is unreachable against the roster")
	check(Achievements.by_id("push-through").is_empty(), "a retired id names nothing")
	check(not Achievements.is_reachable("push-through"), "…and cannot be earned")
	same(Achievements.art_paths().size(), 10, "one drawing per achievement")
	same(Achievements.art_paths().keys(), Achievements.ids(), "…named by id")
	var grouped := 0
	for group in Achievements.GROUPS:
		check(not Achievements.in_group(group).is_empty(), "group %s is not empty" % group)
		grouped += Achievements.in_group(group).size()
	same(grouped, 10, "every achievement is in exactly one group")
	var drawings := 0
	for file in DirAccess.get_files_at(Achievements.ART_DIR):
		if file.ends_with(".png"):
			drawings += 1
			check(not Achievements.by_id(file.trim_suffix(".png")).is_empty(), "%s belongs to an achievement" % file)
	same(drawings, 10, "no drawing is left over")

	same(Challenges.all(), g["challenges"], "the challenges")
	for row: Array in g["challengeMet"]:
		var f: Dictionary = row[1]
		same(Challenges.is_met(row[0], f["seconds"], f["par"], f["resets"], f["oversets"]), row[2], "%s met by %s" % [row[0], f])
	for row: Array in g["challengesMet"]:
		var f: Dictionary = row[0]
		same(Challenges.met(["under-par", "bogus", "no-oversets", "no-resets"], f["seconds"], f["par"], f["resets"], f["oversets"]), row[1],
			"challenges met by %s" % f)
	check(Challenges.by_id("bogus").is_empty() and Challenges.by_id("no-resets")["name"] == "No resets", "challenges by id")

	same(Challenges.ASSIST_MODES, g["assist"]["modes"], "the assist ladder")
	same(Challenges.ASSIST_BLURB, g["assist"]["blurb"], "the assist blurbs")
	for mode in Challenges.ASSIST_MODES:
		same(Challenges.assist_par_text(mode), g["assist"]["parText"][String(mode)], "par line for %s" % mode)
		same(Challenges.assist_blurb(mode), g["assist"]["blurb"][String(mode)], "blurb for %s" % mode)
	same(SaveData.ASSISTS, g["assist"]["modes"], "the save knows the same levels")

	same(ToolKit.NAME, g["kitName"], "the kit's name")
	same(Repo.URL, g["repo"], "the repository")
	for row: Array in g["issues"]:
		var ctx: Dictionary = row[0]
		same(Repo.new_issue_url(ctx["screen"], ctx.get("lock", ""), ctx["version"]), row[1], "issue link from %s" % ctx["screen"])


func _play(script_name: String, script: Dictionary) -> void:
	var store := SaveStore.memory()
	var p := Progress.fresh(store)
	p.data["lockSalt"] = 12345
	var steps: Array = script["steps"]
	for i in steps.size():
		var step: Dictionary = steps[i]
		var want: Dictionary = script["outs"][i]
		var what := "%s step %d (%s)" % [script_name, i, step["op"]]
		match step["op"]:
			"attempt":
				var def: Dictionary = p.custom_locks()[step["custom"]] if step.has("custom") else Roster.by_slug(step["slug"])
				var outcome := AttemptOutcome.from_stats(def, step["opened"], step["seconds"], {
					"oversets": step["oversets"], "full_resets": step["resets"], "false_sets": step["falseSets"],
				}, StringName(step["assist"]))
				# The order the game finishes an attempt in.
				var met := p.challenges_met_by(outcome, step["opted"])
				outcome.challenges = met
				var result := p.complete_attempt(outcome, step.get("today", ""))
				var earned: Array = []
				if step["opened"]:
					p.note_challenges(def["slug"], met)
					for a in p.claim_achievements(outcome):
						earned.append(a["id"])
				same(met, want["met"], what + " challenges met")
				same(earned, _without_master(want["earned"]), what + " achievements earned")
				same(p.record(def["slug"]), want["record"], what + " record")
				if want["result"] == null:
					check(result == null, what + " earns nothing")
				elif check(result != null, what + " earns a result"):
					var r: Dictionary = want["result"]
					same(result.rank, r["rank"], what + " rank")
					same(result.best_rank, r["bestRank"], what + " best rank")
					same(result.previous_best, r["previousBest"] if r["previousBest"] != null else Ranks.NONE, what + " previous best")
					same(result.improved, r["improved"], what + " improved")
					same(result.first_open, r["firstOpen"], what + " first open")
					same(result.par, r["par"], what + " par")
					same(result.challenges, r["challenges"], what + " result challenges")
			"gun":
				p.record_gun_open(step["slug"])
				same(p.gun_opens(step["slug"]), want["gun"], what + " tally")
				same(p.has_opened(step["slug"]), want["opened"], what + " leaves the pick record alone")
			"customAdd":
				var index := p.add_custom_lock(step["def"])
				same(index, want["index"], what + " index")
				same(p.custom_locks()[index]["id"], want["id"], what + " id")
				same(p.custom_locks()[index]["slug"], want["slug"], what + " slug")
			"customRemove":
				var gone := p.remove_custom_lock(step["index"])
				same(gone.get("slug"), want["gone"], what + " removed")
				var left: Array = []
				for def: Dictionary in p.custom_locks():
					left.append(def["slug"])
				same(left, want["left"], what + " what is left")
			"streak":
				same(p.note_streak_run(StringName(step["assist"]), {"score": step["score"], "opens": step["opens"]}), want["best"], what + " new best")
				same(p.data["streakBest"], want["table"], what + " table")
			"settings":
				p.update_settings(step["patch"])
				same(p.settings, want["settings"], what)
			"lesson":
				p.complete_lesson(step["id"])
				same(p.data["tutorial"], want["tutorial"], what)
				check(p.lesson_done(step["id"]) and p.has_started_lessons(), what + " is done")
			"unlock":
				same(p.unlock_achievement(step["id"]), want["unlocked"], what + " unlocked")
				same(p.has_achievement(step["id"]), want["has"], what + " has")
			"snapshot":
				_snapshot(p, want, what)
	same(p.export_text(), _text_without_master(script["exported"]), script_name + ": the save exports to the web game's text")
	same(Progress.new(store).data, p.data, script_name + ": what is stored is what is held")
	if script_name == "the whole bench":
		_master_takes_the_discs(p)


## Master of the Bench asks for every lock in the game, and in this build that is the web game's
## locks and the disc detainers. A script that opens only the web game's does not earn it here,
## so it is taken out of what the web game's own run of that script says.
const MASTER := "master-of-the-bench"


func _without_master(ids: Array) -> Array:
	var out: Array = []
	for id: Variant in ids:
		if id != MASTER:
			out.append(id)
	return out


func _text_without_master(text: String) -> String:
	return text.replace('    "%s",
' % MASTER, "").replace(',
    "%s"' % MASTER, "")


## With the web game's whole bench already opened, the three disc detainers are what is left.
func _master_takes_the_discs(p: Progress) -> void:
	check(not p.has_achievement(MASTER), "the web game's bench alone is not every lock here")
	var left: Array[Dictionary] = []
	for def in Roster.all():
		if def["family"] == "disc-detainer":
			left.append(def)
	for i in left.size():
		var def := left[i]
		var outcome := AttemptOutcome.from_stats(def, true, float(def["par"]) * 2.0, {}, &"normal")
		p.complete_attempt(outcome, "2026-10-03")
		var earned: Array = []
		for a in p.claim_achievements(outcome):
			earned.append(a["id"])
		check(earned.has(MASTER) == (i == left.size() - 1), "Master of the Bench comes with the last disc detainer (%s)" % def["slug"])
	check(p.has_achievement(MASTER), "every lock opened earns Master of the Bench")
	for tier in Achievements.TIERS:
		for def in Achievements.tier_cylinders(tier):
			check(def["family"] == "pin-tumbler", "tier %d's plate counts cylinders only (%s)" % [tier, def["slug"]])


## A tier with no stated requirement asks for every lock in the tier below it — and this build
## has disc detainers there that the web game's numbers do not count. None of these scripts opens
## one, so each is one more open still needed.
func _unstated(tier: int) -> int:
	if Progress.TIER_UNLOCK_REQUIREMENT.has(tier):
		return 0
	var added := 0
	for def in Roster.in_tier(tier - 1):
		if def["family"] == "disc-detainer":
			added += 1
	return added


func _snapshot(p: Progress, want: Dictionary, what: String) -> void:
	same(p.highest_unlocked_tier(), want["highest"], what + " highest tier")
	for tier in 6:
		same(p.is_tier_unlocked(tier), want["unlocked"][tier], "%s tier %d unlocked" % [what, tier])
	for tier in range(1, 5):
		same(p.opens_in_tier(tier), want["opensInTier"][tier - 1], "%s counted opens in tier %d" % [what, tier])
	for tier in range(1, 6):
		same(p.opens_needed_for(tier), want["needed"][tier - 1] + _unstated(tier), "%s opens needed for tier %d" % [what, tier])
	same(p.total_opens(), want["total"], what + " total opens")
	same(p.distinct_opens(), want["distinct"], what + " distinct opens")
	# The line counts every lock on the bench: the web game's, and the disc detainers.
	var added := 0
	for def in Roster.all():
		if def["family"] == "disc-detainer":
			added += 1
	var web_total := Roster.all().size() - added
	same(p.ranked_line(), str(want["ranked"]).replace("/%d " % web_total, "/%d " % Roster.all().size()), what + " ranked line")
	var available: Array = []
	var shared: Array = []
	for def in p.available_locks():
		available.append(def["slug"])
		if def["family"] != "disc-detainer":
			shared.append(def["slug"])
		check(p.can_attempt(def), "%s %s can be attempted" % [what, def["slug"]])
	same(shared, want["available"], what + " available locks")
	for def in Roster.all():
		check(available.has(def["slug"]) == p.can_attempt(def), "%s gate on %s" % [what, def["slug"]])
		if def["family"] == "disc-detainer":
			# No lock sends you to a locked one, and a disc detainer sends you to another while
			# there is another to go to.
			var onward := p.next_lock_after(def)
			check(onward.is_empty() or p.can_attempt(onward), "%s next after %s is not locked" % [what, def["slug"]])
			continue
		same(p.next_lock_after(def).get("slug"), want["next"][def["slug"]], "%s next after %s" % [what, def["slug"]])
	if not p.custom_locks().is_empty():
		same(p.next_lock_after(p.custom_locks()[0]).get("slug"), want["nextAfterCustom"], what + " next after a custom lock")
	same(p.data["achievements"], _without_master(want["achievements"]), what + " achievements held")


## The pieces of an attempt the scripts do not reach.
func _outcomes() -> void:
	var def := Roster.by_slug("kestrel-door-cylinder")
	var o := AttemptOutcome.from_stats(def, true, 41.5, {"oversets": 2, "full_resets": 1, "false_sets": 3, "bind_order": [1, 0]}, &"training")
	same([o.oversets, o.resets, o.false_sets, o.seconds, o.opened], [2, 1, 3, 41.5, true], "an outcome reads a session's tally")
	same(o.par(), 70.0, "…knows its lock's par")
	same(o.judged_par(), 42.0, "…and the par it is judged against")
	same(AttemptOutcome.from_stats(def, true, 1.0, {}).oversets, 0, "a missing count is zero")
	same(AttemptOutcome.of(def, false, 9.0).assist, &"normal", "the level defaults to normal")

	var p := Progress.fresh(SaveStore.memory())
	same(p.seed_for(def), SaveData.seed_for_lock(def["slug"], p.data["lockSalt"]), "a lock's seed comes from the bench's salt")
	same(p.seed_for(def), p.seed_for(def), "…and is the same every time")
	check(p.claim_achievements().is_empty(), "nothing is earned on an empty save")
	same(p.streak_best(&"normal"), {}, "no best yet")
	check(Progress.today().length() == 10 and Progress.today()[4] == "-", "today is a date")
	# A record handed out is the save's own, or a blank that is not.
	p.record("never-opened")["opens"] = 5
	check(not p.has_opened("never-opened"), "a blank record is not written back by reading it")
