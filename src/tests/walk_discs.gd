extends SceneTree
## Headless: the scripted hand opens every disc-detainer lock — the bench's and the lessons' — on
## several seeds, and the mechanism is held to what it is meant to be along the way.
##
##   godot --headless --path src --fixed-fps 60 -s res://tests/walk_discs.gd -- [seeds] [slug|all] [verbose|quiet] [wrench step]
##
## Checked on every walk, not only that the lock opens:
##   - the bar rests on one disc at a time, and it is the next in the lock's own binding order;
##   - a disc with a false gate in the way is caught by it (so the lie is real);
##   - a disc reads overset only with its gate behind it, and nothing opens with a false gate
##     holding a disc.

var queue: Array = []
var session: DiscSession
var walker: DiscWalker
var current: Array = []
var results: Array[String] = []
var failures := 0
var verbose := false
var wrench_step := 5
var limit := 90.0
var sim_total := 0.0
var wall_start := 0
var _problems: Array[String] = []
var _seen_binding: Array[int] = []


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var seeds := int(args[0]) if args.size() > 0 else 3
	var only := args[1] if args.size() > 1 else ""
	verbose = args.size() > 2 and args[2] == "verbose"
	wrench_step = int(args[3]) if args.size() > 3 else 5
	var defs: Array = []
	for d in Roster.all():
		defs.append(d)
	for d: Dictionary in Lessons.LOCKS.values():
		defs.append(d)
	for d: Dictionary in defs:
		if d["family"] != "disc-detainer":
			continue
		if only != "" and only != "all" and d["slug"] != only:
			continue
		var problem := LockDefs.validate(d)
		if problem != "":
			print("FAIL  ", problem)
			failures += 1
			continue
		for s in range(1, seeds + 1):
			queue.append([d, s * 7919 + 11])
	if queue.is_empty():
		print("---- no disc-detainer locks to walk")
		quit(1)
		return
	physics_frame.connect(_on_physics)
	wall_start = Time.get_ticks_msec()
	_next()


func _next() -> void:
	if session != null:
		session.queue_free()
		session = null
	if queue.is_empty():
		print("---- discs: %d walked, %d failed; %.0f sim s in %.1f wall s" % [
			results.size(), failures, sim_total, (Time.get_ticks_msec() - wall_start) / 1000.0])
		for r in results:
			print(r)
		quit(1 if failures > 0 else 0)
		return
	current = queue.pop_front()
	_problems.clear()
	_seen_binding.clear()
	session = DiscSession.new()
	session.position = Vector2(0.0, 40000.0)
	root.add_child(session)
	session.start(current[0], current[1])
	walker = DiscWalker.new(session, wrench_step)
	if verbose:
		var watched := session
		session.sim_event.connect(func(type: StringName, data: Dictionary) -> void:
			if type != &"PLUG_MOVED" and type != &"PICK_MOVED":
				print("  %.2f %s %s" % [watched.time, type, str(data)]))


func _note(problem: String) -> void:
	if not _problems.has(problem):
		_problems.append(problem)


func _on_physics() -> void:
	if session == null:
		return
	var dt := 1.0 / Engine.physics_ticks_per_second
	walker.tick(dt)
	var rig := session.rig
	# One disc at a time, and in the lock's own order: the binding disc is always the earliest in
	# that order the bar has not dropped into.
	var resting := 0
	for i in rig.count:
		if rig.states[i] == LockRig.BINDING or rig.states[i] == LockRig.OVERSET:
			resting += 1
		if rig.states[i] == LockRig.OVERSET and rig.past_gate(i) <= 0.0:
			_note("disc %d read overset with its gate still ahead of it" % i)
	if resting > 1:
		_note("%d discs binding at once" % resting)
	if rig.binding >= 0:
		if not _seen_binding.has(rig.binding):
			_seen_binding.append(rig.binding)
		for i in rig.count:
			if int(rig.info[i]["order"]) < int(rig.info[rig.binding]["order"]) and not rig.held(i):
				_note("disc %d binds while disc %d, earlier in the order, is not held" % [rig.binding, i])
	if rig.opened:
		for i in rig.count:
			var under := rig.notch_over(i)
			if under < 0 or not bool((rig.info[i]["notches"] as Array)[under]["true"]):
				_note("opened with disc %d out of its true gate" % i)
	if rig.opened or walker.failed or session.time > limit:
		var ok := rig.opened and _problems.is_empty()
		# A lie that lies in the way has to have been met.
		var lies_in_way := 0
		for i in rig.count:
			for notch: Dictionary in rig.info[i]["notches"]:
				if not bool(notch["true"]) and int(notch["cut"]) < int(rig.info[i]["cut"]):
					lies_in_way += 1
		if rig.opened and lies_in_way > 0 and int(session.stats["false_sets"]) == 0:
			ok = false
			_note("%d false gates in the way and none caught a disc" % lies_in_way)
		sim_total += session.time
		if not ok:
			failures += 1
		var states := PackedStringArray()
		for i in rig.count:
			states.append(LockRig.STATE_NAMES[rig.states[i]].substr(0, 4))
		results.append("%s %-26s seed %6d  t=%5.1fs turns=%2d false=%d %s%s" % [
			"OPEN " if ok else "FAIL ", current[0]["slug"], current[1], session.time, walker.turns,
			session.stats["false_sets"],
			"" if rig.opened else " ".join(states) + " s=%.3f foot=%.3f " % [rig.shift(), rig.bar_foot()],
			"; ".join(_problems),
		])
		if verbose or not ok:
			print(results[-1])
			for line in walker.log:
				print("    ", line)
		_next()
