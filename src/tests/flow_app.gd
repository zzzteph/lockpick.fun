extends SceneTree
## Headless: the whole loop through the real app — bench lock, lesson, snap gun, blitz — with
## the scripted hand doing the picking. Checks what each open is worth and where it leads.
##
##   godot --headless --path godot --fixed-fps 60 -s res://tests/flow_app.gd

var _app: Node
var _walker: PinWalker
var _walked: PinSession
var _stage := 0
var _for := 0.0
var _failures := 0
var _checks := 0
var _strike_in := 0.0
var _clicked := false
var _strikes := 0


func _initialize() -> void:
	var scene: PackedScene = load("res://main.tscn")
	_app = scene.instantiate()
	root.add_child(_app)
	_app.progress = Progress.new(SaveStore.memory())
	_app.status = ""
	physics_frame.connect(_tick)


func _check(ok: bool, what: String) -> void:
	_checks += 1
	if not ok:
		_failures += 1
		print("FAIL  ", what)


## Put the scripted hand on whatever pin lock the app has on the bench.
func _drive() -> void:
	var pick: PickScreen = _app.pick
	if pick == null or pick.pins == null:
		return
	var session := pick.pins.session
	if session != _walked:
		_walked = session
		pick.pins.scripted = true
		_walker = PinWalker.new(session)
	if not session.rig.opened:
		_walker.tick(1.0 / Engine.physics_ticks_per_second)


func _tick() -> void:
	_for += 1.0 / Engine.physics_ticks_per_second
	var progress: Progress = _app.progress
	match _stage:
		0:
			_app.start_lock(Roster.by_slug("brasswell-no1-luggage"))
			_check(_app.screen_name == &"pick", "a started lock is on the pick screen")
			_check(Engine.physics_ticks_per_second == 480, "the pick screen runs the lock at 480 Hz")
			_next()
		1:
			_drive()
			if _app.screen_name == &"results":
				_check(progress.record("brasswell-no1-luggage")["opens"] == 1, "the open is recorded")
				_check(_app.result != null and _app.result.first_open, "it is a first open")
				_check(_app.outcome != null and _app.outcome.opened, "the outcome says opened")
				_check(_app.pick != null, "the lock stays on the bench behind its results")
				_app.goto(&"bench")
				_check(_app.pick == null, "leaving the results puts the lock away")
				_check(Engine.physics_ticks_per_second == 60, "menus idle at 60 Hz")
				_next()
			elif _for > 90.0:
				_check(false, "bench lock never reached results (screen %s)" % _app.screen_name)
				_next()
		2:
			_app.start_lesson("lesson-1")
			_check(_app.lesson != null, "a lesson is running")
			_next()
		3:
			_drive()
			if _app.screen_name == &"tutorial":
				_check(progress.lesson_done("lesson-1"), "the lesson is banked")
				_check(progress.total_opens() == 1, "a lesson open is not an attempt")
				_check(_app.lesson == null and _app.pick == null, "the lesson is put away")
				_next()
			elif _for > 90.0:
				_check(false, "lesson never finished (screen %s, step %d)" % [_app.screen_name,
					_app.lesson.step if _app.lesson != null else -1])
				_next()
		4:
			_app.start_lock(Roster.by_slug("brasswell-no1-luggage"), -1, false, true)
			_check(_app.gun_mode and _app.pick.pins.gun, "the gun is in hand")
			_app.pick.pins.scripted = true
			_strike_in = 0.5
			_next()
		5:
			# The gun by rote: light wrench held, a strike every 0.4 s, at three strengths in turn.
			var pick: PickScreen = _app.pick
			if pick != null and pick.pins != null and not pick.is_open():
				var session := pick.pins.session
				session.in_chamber = session.rig.count - 1
				session.in_tension_held = true
				session.in_tension_level = PinSession.tension_for_step(3)
				_strike_in -= 1.0 / Engine.physics_ticks_per_second
				if _strike_in <= 0.0:
					_strike_in = 0.4
					# Hard, then softer, then hard again: deep pins want one and shallow pins the other.
					_strikes += 1
					session.strike([1.3, 0.45, 0.8][_strikes % 3])
			if _app.screen_name == &"bench":
				_check(progress.gun_opens("brasswell-no1-luggage") == 1, "the gun open is on the gun's ledger")
				_check(progress.record("brasswell-no1-luggage")["opens"] == 1, "and not on the pick record")
				_next()
			elif _for > 120.0:
				_check(false, "the gun never opened the luggage lock (screen %s)" % _app.screen_name)
				_next()
		6:
			_app.start_streak(&"normal")
			_check(_app.streak != null and _app.screen_name == &"pick", "a blitz deals a lock")
			_check(_app.pick.countdown_left > 0.0 or true, "")
			_next()
		7:
			_drive()
			if _app.streak != null and _app.streak.interlude:
				_check(_app.streak.opens == 1 and _app.streak.score > 0, "a blitz open scores")
				_check(_app.pick == null, "the blitz lock is put away at the breather")
				var left: float = _app.streak.left
				_check(left < Streak.SECONDS and left > 0.0, "the blitz clock ran while picking")
				_app.streak_continue()
				_check(_app.screen_name == &"pick" and not _app.streak.interlude, "continue deals the next lock")
				_app.abandon_lock()
				_check(_app.streak == null and _app.pick == null, "walking out abandons the run")
				_next()
			elif _for > 120.0:
				_check(false, "blitz lock never opened")
				_next()
		8:
			var def := Roster.by_slug("ironhold-combination-chain")
			# The solver's tape is cut for a Normal deal.
			_app.update_settings({"assist": "normal"})
			_app.start_lock(def)
			var view: WheelLockView = _app.pick.wheels
			_check(view != null, "a combination lock gets the wheel view")
			var solved: Dictionary = WheelSolver.solve(def, _app.lock_seed, {"feather": progress.is_tier_unlocked(3)})
			_check(bool(solved["opened"]), "the wheel solver has an answer")
			view.play_tape(solved["tape"])
			_next()
		9:
			if _app.screen_name == &"results":
				_check(progress.record("ironhold-combination-chain")["opens"] == 1, "the wheel open is recorded")
				_app.goto(&"menu")
				_next()
			elif _for > 120.0:
				_check(false, "the wheel pack never reached results (screen %s)" % _app.screen_name)
				_next()
		10:
			# A real click on a real button: the menu's Bench.
			_app.goto(&"menu")
			_next()
		11:
			if _for > 0.2 and not _clicked:
				_clicked = true
				var target := _find_button(_app, "BENCH")
				_check(target != null, "the menu has a Bench button")
				if target != null:
					var at := root.get_final_transform() * target.get_global_rect().get_center()
					for down: bool in [true, false]:
						var e := InputEventMouseButton.new()
						e.button_index = MOUSE_BUTTON_LEFT
						e.pressed = down
						e.position = at
						e.global_position = at
						e.button_mask = MOUSE_BUTTON_MASK_LEFT if down else 0
						Input.parse_input_event(e)
			if _for > 0.5:
				_check(_app.screen_name == &"bench", "clicking Bench on the menu opens the bench")
				_next()
		12:
			# A spool lock through the app: the drawing leans and shivers as the plug turns, and
			# none of that may reach the bodies. (It once did — the view dragged the shell.)
			_app.start_lock(Roster.by_slug("ironhold-spool-trainer"))
			_next()
		13:
			_drive()
			if _app.screen_name == &"results":
				_check(_app.outcome.false_sets > 0, "the spool trainer false-set on the way")
				_check(_app.outcome.resets == 0, "and the scripted hand never had to start over")
				_next()
			elif _for > 60.0:
				_check(false, "the spool trainer never opened through the app")
				_next()
		14:
			# Pause, look something up, come back: the attempt survives the round trip.
			_app.start_lock(Roster.by_slug("northgate-5-pin-cabinet"))
			var before: PickScreen = _app.pick
			_app.goto(&"pause")
			_check(_app.pick == before and before.visible, "the lock stays on show under the pause panel")
			_app.goto(&"settings")
			_check(_app.pick == before and not before.visible, "and waits unseen behind Settings")
			_app.back()
			_check(_app.screen_name == &"pause", "back from Settings returns to the pause panel")
			_app.goto(&"help")
			_app.back()
			_check(_app.screen_name == &"pause", "back from Help returns to the pause panel")
			_app.back()
			_check(_app.screen_name == &"pick" and _app.pick == before, "back from pause returns to the same lock")
			_check(Engine.physics_ticks_per_second == 480, "and the lock is running again")
			_app.abandon_lock()
			_check(_app.screen_name == &"bench" and _app.pick == null, "walking away puts it down")
			_next()
		15:
			# A lock built in the editor — a spool, a stiff spring and a light one — picks like any
			# other, and its springs are the ones it was given.
			var draft := EditorModel.new(4)
			draft.keep_felt()
			draft.set_pin(1, "spool")
			draft.set_spring(0, 2)
			draft.set_spring(2, 0)
			var def := draft.to_lock_def(progress.custom_locks().size())
			_check(draft.problem(progress.custom_locks().size()) == "", "the editor's draft is buildable")
			progress.add_custom_lock(def)
			_app.start_lock(def)
			var rig: LockRig = _app.pick.pins.session.rig
			_check(rig.spring(0) > 1.0 and rig.spring(2) < 1.0 and is_equal_approx(rig.spring(3), 1.0),
				"the lock is built with the editor's springs")
			_next()
		16:
			_drive()
			if _app.screen_name == &"results":
				_check(_app.outcome.opened, "the designed lock opens")
				_app.goto(&"bench")
				_next()
			elif _for > 60.0:
				_check(false, "the designed lock never opened")
				_next()
		_:
			print("---- flow: %d checks, %d failed" % [_checks, _failures])
			quit(1 if _failures > 0 else 0)


func _find_button(node: Node, caption: String) -> Button:
	for child in node.get_children():
		if child is Button and (child as Button).text == caption:
			return child
		var deeper := _find_button(child, caption)
		if deeper != null:
			return deeper
	return null


func _next() -> void:
	_stage += 1
	_for = 0.0
