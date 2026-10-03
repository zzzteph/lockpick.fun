extends SceneTree
## Headless: the scripted hand opens every pin lock in the roster, on several seeds.
##
##   godot --headless --path godot --fixed-fps 60 -s res://tests/walk_roster.gd -- [seeds] [slug|all] [verbose|quiet] [seed base]

var queue: Array = []
var session: PinSession
var walker: PinWalker
var current: Array = []
var results: Array[String] = []
var failures := 0
var verbose := false
var limit := 60.0
var sim_total := 0.0
var wall_start := 0


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var seeds := int(args[0]) if args.size() > 0 else 3
	var only := args[1] if args.size() > 1 else ""
	verbose = args.size() > 2 and args[2] == "verbose"
	# A fourth argument moves the seeds: the game deals 32-bit seeds, not 1, 2, 3.
	var base := int(args[3]) if args.size() > 3 else 0
	for d in Roster.all():
		if d["family"] != "pin-tumbler":
			continue
		if only != "" and only != "all" and d["slug"] != only:
			continue
		for s in range(1, seeds + 1):
			queue.append([d, base + s * (1 if base == 0 else 7919)])
	physics_frame.connect(_on_physics)
	wall_start = Time.get_ticks_msec()
	_next()


func _next() -> void:
	if session != null:
		session.queue_free()
		session = null
	if queue.is_empty():
		print("---- %d walked, %d failed; %.0f sim s in %.1f wall s (%.1f ms of work per sim second)" % [
			results.size(), failures, sim_total, (Time.get_ticks_msec() - wall_start) / 1000.0,
			(Time.get_ticks_msec() - wall_start) / maxf(1.0, sim_total)])
		for r in results:
			print(r)
		quit(1 if failures > 0 else 0)
		return
	current = queue.pop_front()
	session = PinSession.new()
	# The game never builds a lock at the origin; neither does this.
	if OS.get_environment("WALK_AT") != "":
		session.position = Vector2(0.0, float(OS.get_environment("WALK_AT")))
	root.add_child(session)
	session.start(current[0], current[1])
	walker = PinWalker.new(session)
	if verbose:
		var watched := session
		session.sim_event.connect(func(type: StringName, data: Dictionary) -> void:
			if type != &"PLUG_MOVED" and type != &"PICK_MOVED":
				print("  %.2f %s %s" % [watched.time, type, str(data)]))


func _on_physics() -> void:
	if session == null:
		return
	var dt := 1.0 / Engine.physics_ticks_per_second
	walker.tick(dt)
	var rig := session.rig
	if rig.opened or walker.failed or session.time > limit:
		var ok := rig.opened
		sim_total += session.time
		if not ok:
			failures += 1
		var states := PackedStringArray()
		for i in rig.count:
			states.append(LockRig.STATE_NAMES[rig.states[i]].substr(0, 4))
		results.append("%s %-28s seed %d  t=%6.1fs pushes=%2d oversets=%d false=%d resets=%d %s" % [
			"OPEN " if ok else "FAIL ", current[0]["slug"], current[1], session.time, walker.pushes,
			session.stats["oversets"], session.stats["false_sets"], session.stats["full_resets"],
			"" if ok else " ".join(states) + " s=%.3f" % rig.shift(),
		])
		if verbose or not ok:
			print(results[-1])
			for line in walker.log:
				print("    ", line)
		_next()
