extends SceneTree
## Headless: the game's rules and records, checked against vectors from the web game.
##
##   godot --headless --path godot -s res://game/tests/run.gd -- [suite ...]
##
## With no arguments every suite runs. A suite is named for its file without the `test_`:
## web_num, lock_def, ranks, editor, sharecode, forge, save, progress, feedback. Exits 1 on any
## failure.

const SUITES: Array[String] = [
	"web_num", "lock_def", "ranks", "editor", "sharecode", "forge", "save", "progress", "feedback",
]


func _initialize() -> void:
	var wanted := OS.get_cmdline_user_args()
	var total_checks := 0
	var total_failures := 0
	for suite_name in SUITES:
		if not wanted.is_empty() and not wanted.has(suite_name):
			continue
		var script: GDScript = load("res://game/tests/test_%s.gd" % suite_name)
		if script == null:
			print("FAIL  %-10s could not be loaded" % suite_name)
			total_failures += 1
			continue
		var suite: RefCounted = script.new()
		var started := Time.get_ticks_msec()
		suite.run()
		var failures: Array[String] = suite.failures
		total_checks += suite.checks
		total_failures += failures.size()
		print("%s  %-10s %6d checks, %d failed  (%d ms)" % [
			"ok  " if failures.is_empty() else "FAIL", suite_name, suite.checks, failures.size(),
			Time.get_ticks_msec() - started,
		])
		for i in mini(failures.size(), suite.MAX_REPORTED):
			print("        ", failures[i])
		if failures.size() > suite.MAX_REPORTED:
			print("        … and %d more" % (failures.size() - suite.MAX_REPORTED))
	print("---- %d checks, %d failed" % [total_checks, total_failures])
	quit(1 if total_failures > 0 else 0)
