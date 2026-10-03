extends Control
## SHEAR LINE — the app: which screen is up, the lock on the bench, and what an open is worth.
##
## Screens are Controls built fresh each time they are entered; anything that has to outlive a
## visit lives here. The pick screen is the exception: it stays alive (paused, hidden) while the
## player is in the pause menu or in Settings/Help reached from it, so the attempt survives.

const VERSION := "6.0.0"
## The physics rate the lock needs, and the idle rate everywhere else.
const PICK_TICKS := 480
const IDLE_TICKS := 60

const SCREENS := {
	&"menu": "res://screens/menu_screen.gd",
	&"bench": "res://screens/bench_screen.gd",
	&"tutorial": "res://screens/tutorial_screen.gd",
	&"results": "res://screens/results_screen.gd",
	&"settings": "res://screens/settings_screen.gd",
	&"trophies": "res://screens/trophies_screen.gd",
	&"help": "res://screens/help_screen.gd",
	&"streak": "res://screens/streak_screen.gd",
	&"editor": "res://screens/editor_screen.gd",
	&"pause": "res://screens/pause_screen.gd",
	&"feedback": "res://screens/feedback_screen.gd",
}

var progress: Progress
## What just happened, for whichever screen is up to say: shown on its message strip for a few
## seconds from when it was set.
var status := "":
	set(value):
		status = value
		status_at = Time.get_ticks_msec() / 1000.0
var status_at := 0.0
var screen_name: StringName = &"menu"
var previous_screen: StringName = &"menu"
## Per-screen state that survives leaving the screen: the bench's tier, the help page, …
var memo := {}

# ── The lock on the bench ──
var pick: PickScreen
var lock_def: Dictionary = {}
var lock_seed := 1
## A study run: the lock behaves exactly as always, and nothing is recorded.
var inspecting := false
## Whether the next lock started from the bench is an inspection.
var inspect_next := false
var gun_mode := false
## The lesson being taught, or null.
var lesson: Lessons.Run
## The Lock Blitz run, or null. Never saved: a relaunch has no run to resume.
var streak: StreakRun
## What the last finished attempt was, for the results screen.
var outcome: AttemptOutcome
var result: Progress.Result
var earned: Array[Dictionary] = []
## Challenge modifiers opted into for the next attempt.
var challenges: Array[String] = []
## The lock being designed on the editor screen, held for the session.
var draft: EditorModel

## What posts a feedback entry to the maker's form: it outlives the feedback screen, so a send
## still on its way arrives whatever the player does next.
var feedback: FeedbackPost

var _screen: Control
var _paper: Paper
var _host: Control
var _rotate: RotatePrompt
var _sfx: Node
var _captions := Captions.new()


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	theme = Kit.theme()
	# A test hands the app a throwaway save before it enters the tree; the game opens the real one.
	# The same goes for feedback: under a test, or with no display at all, nothing is ever posted.
	feedback = FeedbackPost.new()
	feedback.name = "Feedback"
	feedback.dry_run = progress != null or DisplayServer.get_name() == "headless"
	add_child(feedback)
	if progress == null:
		progress = Progress.new(SaveStore.new())
	if progress.load_problem != "":
		status = "the save could not be read — starting fresh (%s)" % progress.load_problem
	draft = EditorModel.new()
	draft.keep_felt()
	_paper = Paper.new()
	add_child(_paper)
	_host = Control.new()
	_host.set_anchors_preset(Control.PRESET_FULL_RECT)
	# Neither the app nor the host is something to click on. Left at the default they would
	# swallow every pointer event before it reached the lock, which reads the mouse unhandled.
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_host.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_host)
	_rotate = RotatePrompt.new()
	add_child(_rotate)
	if OS.has_feature("web"):
		JavaScriptBridge.eval(FIRST_TOUCH_JS, true)
	_sfx = get_node_or_null("/root/Sfx")
	Kit.click_hook = click
	apply_settings()
	get_window().size_changed.connect(_fit_window)
	_fit_window()
	Engine.physics_ticks_per_second = IDLE_TICKS
	# What could not be sent last time goes now, once.
	feedback.retry_queue()
	goto(&"menu")


# ── Screens ─────────────────────────────────────────────────────────────────────────────

func goto(next: StringName) -> void:
	if next == &"pick":
		_show_pick()
		return
	previous_screen = screen_name
	screen_name = next
	if _screen != null:
		_screen.queue_free()
		_screen = null
	if pick != null and pick.is_open() and next != &"results":
		# An opened lock is finished with once its results have been read.
		_drop_pick()
	if pick != null:
		# Under the pause panel the lock stays on show, stopped; anywhere else it waits unseen.
		pick.set_paused(true)
		pick.visible = next == &"pause"
	Engine.physics_ticks_per_second = IDLE_TICKS
	var path: String = SCREENS.get(next, "")
	if path == "" or not ResourceLoader.exists(path):
		status = "there is no “%s” screen yet" % next
		path = SCREENS[&"menu"]
		screen_name = &"menu"
	var script: GDScript = load(path)
	_screen = script.new()
	_screen.set("app", self)
	_host.add_child(_screen)
	if _sfx != null:
		_sfx.call("hush")


## The window changed size: refit the line weights to it, so borders stay even on every side.
func _fit_window() -> void:
	if Pal.fit(get_window().get_final_transform().get_scale().x):
		Kit.restyle()
		_paper.queue_redraw()


## Build the screen that is up again, in place — after something it was drawn from has changed.
func refresh() -> void:
	var came_from := previous_screen
	goto(screen_name)
	previous_screen = came_from


func _show_pick() -> void:
	if pick == null:
		goto(&"bench")
		return
	previous_screen = screen_name
	screen_name = &"pick"
	if _screen != null:
		_screen.queue_free()
		_screen = null
	pick.visible = true
	pick.set_paused(false)
	Engine.physics_ticks_per_second = PICK_TICKS


## True while a lock is mid-attempt — Settings and Help reached from the pause panel offer the
## way back to it.
func pick_active() -> bool:
	return pick != null and not pick.is_open()


# ── Starting and leaving a lock ─────────────────────────────────────────────────────────

## The level the current pick is actually played at: a blitz run plays at the level its
## briefing picked, everything else at the one in Settings.
func active_assist() -> StringName:
	if streak != null and not streak.finished:
		return streak.assist
	return progress.assist()


## Put a lock from the bench (or a share code, or the editor) on the pick screen.
func start_lock(def: Dictionary, with_seed: int = -1, inspect: bool = false, gun: bool = false) -> void:
	# Whatever was running — a lesson, a blitz — is over the moment a lock is picked by hand.
	lesson = null
	streak = null
	_begin(def, with_seed, inspect, gun)


func _begin(def: Dictionary, with_seed: int = -1, inspect: bool = false, gun: bool = false) -> void:
	lock_def = def
	lock_seed = with_seed if with_seed >= 0 else progress.seed_for(def)
	inspecting = inspect
	# The gun is only ever in hand on a pin lock.
	gun_mode = gun and str(def.get("family", "pin-tumbler")) == "pin-tumbler"
	outcome = null
	result = null
	earned = []
	status = ""
	if pick != null:
		pick.queue_free()
	pick = PickScreen.new()
	pick.reduced_motion = bool(progress.settings["reducedMotion"])
	_host.add_child(pick)
	pick.opened.connect(_on_opened)
	pick.payoff_done.connect(_on_payoff_done)
	pick.left.connect(abandon_lock)
	pick.restart_requested.connect(restart_lock)
	pick.pause_requested.connect(func() -> void: goto(&"pause"))
	pick.sim_event.connect(_on_sim_event)
	# The attempt's own start is said before anyone is listening to it, so it is said here: the
	# captions start clean and the sound renders this lock's clicks ahead of the first set.
	_captions.clear()
	_captions.turns = "sleeve" if str(def.get("family", "")) == "disc-detainer" else "plug"
	if _sfx != null:
		_sfx.call("handle_event", &"ATTEMPT_STARTED", {"chambers": LockDefs.chamber_count(def)})
	var in_blitz := streak != null and not streak.finished
	pick.back_label = "end run" if in_blitz else ("tutorial" if lesson != null else "bench")
	pick.start(def, lock_seed, {
		"assist": active_assist(),
		"gun": gun_mode,
		"lesson": lesson != null,
		"lesson_run": lesson,
		"inspecting": inspecting,
		"tension_toggle": bool(progress.settings["tensionToggle"]),
		# Feathering arrives with the third tier.
		"feather": progress.is_tier_unlocked(3),
		"about": _about(def, in_blitz),
	})
	_show_pick()


## The lock's card on the pick screen: what it is, what it asks, and the record it holds.
func _about(def: Dictionary, in_blitz: bool) -> Array:
	var rows: Array = []
	var wheels := str(def.get("family", "pin-tumbler")) == "combination"
	var discs := str(def.get("family", "pin-tumbler")) == "disc-detainer"
	var count := LockDefs.chamber_count(def)
	rows.append(["wheels" if wheels else ("discs" if discs else "pins"), str(count)])
	if discs:
		var lies := DiscRig.false_count(def)
		rows.append(["false gates", str(lies) if lies > 0 else "none"])
	elif not wheels:
		var security := 0
		for pin: Variant in def.get("pins", []):
			if Profiles.is_security(str(pin)):
				security += 1
		rows.append(["security pins", str(security) if security > 0 else "none"])
	if in_blitz:
		rows.append(["worth", "%d pt%s" % [int(def.get("tier", 1)), "" if int(def.get("tier", 1)) == 1 else "s"]])
		return rows
	if gun_mode:
		var bumps := progress.gun_opens(str(def["slug"]))
		rows.append(["bumped", "%d time%s" % [bumps, "" if bumps == 1 else "s"] if bumps > 0 else "not yet"])
		return rows
	rows.append(["par", "%ds" % roundi(Ranks.effective_par(float(def.get("par", 60)), active_assist()))])
	if inspecting:
		return rows
	var record := progress.record(str(def["slug"]))
	if int(record["opens"]) > 0:
		rows.append(["best time", Ranks.time_text(float(record["bestTime"]))])
		rows.append(["best rank", Ranks.letter_for(record["bestRank"])])
	else:
		rows.append(["your best", "not yet opened"])
	return rows


## Start a lesson. Its lock never reaches the roster: no record, no rank, no achievement — a
## lesson teaches, it does not pay.
func start_lesson(id: String) -> void:
	var l := Lessons.by_id(id)
	if l.is_empty():
		return
	streak = null
	lesson = Lessons.Run.new(l)
	_begin(l["lock"], 3, false, bool(l.get("gun", false)))


## R: a fresh attempt at the same lock — or, inside a blitz, skip to the next one (the seconds
## already spent are the price).
func restart_lock() -> void:
	if pick == null:
		return
	if streak != null and not streak.finished:
		_deal_streak(streak.skip())
		return
	if lesson != null:
		lesson = Lessons.Run.new(lesson.lesson)
	_begin(lock_def, lock_seed, inspecting, gun_mode)


## Walk away from the lock on the bench.
func abandon_lock() -> void:
	var was_lesson := lesson != null
	var was_blitz := streak != null and not streak.finished
	_drop_pick()
	lesson = null
	if was_blitz:
		# Walking out of a blitz abandons the run: it banks nothing, and says so once.
		streak = null
		status = "run abandoned — nothing banked"
		goto(&"streak")
	else:
		goto(&"tutorial" if was_lesson else &"bench")


func _drop_pick() -> void:
	if pick != null:
		pick.queue_free()
		pick = null


# ── The Lock Blitz ──────────────────────────────────────────────────────────────────────

func start_streak(level: StringName) -> void:
	lesson = null
	status = ""
	streak = StreakRun.new(progress, level)
	_deal_streak(streak.deal_next())


func _deal_streak(def: Dictionary) -> void:
	if def.is_empty():
		return
	_begin(def, streak.lock_seed)


## Deal the next lock after the breather.
func streak_continue() -> void:
	if streak != null and not streak.finished and streak.interlude:
		_deal_streak(streak.deal_next())


func _process(delta: float) -> void:
	if screen_name == &"pick" and pick != null and pick.overlay != null:
		_follow_lock(delta)
	# The blitz clock burns exactly while the run's lock is on the bench: the pause panel
	# freezes it, and so does the breather between locks.
	if streak != null and not streak.finished and screen_name == &"pick" and pick != null:
		pick.countdown_left = streak.left
		pick.title_suffix = " · %d pts" % streak.score
		if streak.tick(delta):
			_drop_pick()
			status = ""
			goto(&"streak")


# ── What an open is worth ───────────────────────────────────────────────────────────────

func _on_opened(summary: Dictionary) -> void:
	# A lock that has just been taken off the bench can still say it opened, a tick late.
	if pick == null:
		return
	if lesson != null:
		# A lesson is not an attempt. It stays on stage through the payoff — the open is its
		# best frame — and is banked when the payoff routes away.
		lesson.complete = true
		pick.play_payoff(-1, [])
		return
	if inspecting:
		# An inspection ends the moment the lock opens and leaves nothing behind.
		status = "%s — inspected. Nothing recorded." % lock_def["name"]
		_drop_pick()
		goto(&"bench")
		return
	if streak != null and not streak.finished:
		# A blitz open scores its tier and goes straight to the breather: no payoff, no tally —
		# two and a half seconds of fanfare is a whole lock's worth of clock.
		streak.opened()
		_drop_pick()
		status = ""
		goto(&"streak")
		return
	if gun_mode:
		# A gun open is bumped, not picked: it earns no rank and writes only to the gun's ledger.
		progress.record_gun_open(str(lock_def["slug"]))
		status = "%s — bumped open." % lock_def["name"]
		pick.play_payoff(-1, [])
		return
	var base := AttemptOutcome.from_stats(lock_def, true, float(summary["time"]), summary["stats"], active_assist())
	base.challenges = progress.challenges_met_by(base, challenges)
	outcome = base
	result = progress.complete_attempt(outcome, Progress.today())
	progress.note_challenges(str(lock_def["slug"]), outcome.challenges)
	# Achievements are claimed after the record is written: half of them are about totals.
	earned = progress.claim_achievements(outcome)
	var cards: Array = []
	for a in earned:
		var art: Texture2D = null
		var path := Achievements.art_path(str(a["id"]))
		if path != "" and ResourceLoader.exists(path):
			art = load(path)
		cards.append({"name": a["name"], "art": art})
	pick.play_payoff(result.rank if result != null else -1, cards)


func _on_payoff_done() -> void:
	if lesson != null:
		if lesson.complete:
			progress.complete_lesson(str(lesson.lesson["id"]))
		lesson = null
		_drop_pick()
		goto(&"tutorial")
	elif gun_mode or outcome == null:
		_drop_pick()
		goto(&"bench")
	else:
		goto(&"results")


func _on_sim_event(type: StringName, data: Dictionary) -> void:
	if _sfx != null:
		_sfx.call("handle_event", type, data)
	Haptics.handle_event(type, data)
	_captions.on_event(type, data, _now())


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


## The sounds that last — the hum of a binding pin, the scrape of the pick, the plug turning —
## follow the lock frame by frame, and the captions describe the same thing in words.
func _follow_lock(delta: float) -> void:
	var s := pick.sustained()
	if _sfx != null:
		_sfx.call("update_continuous", delta, int(s["chamber"]), int(s["state"]), float(s["lift"]),
			float(s["resistance"]), float(s["counter_force"]), float(s["plug_speed"]))
	_captions.update(_now(), float(s["counter_force"]), float(s["plug_speed"]))
	pick.overlay.captions = _captions.rows(_now()) if bool(progress.settings["subtitles"]) else []


# ── Settings, links ─────────────────────────────────────────────────────────────────────

func update_settings(patch: Dictionary) -> void:
	progress.update_settings(patch)
	apply_settings()


func apply_settings() -> void:
	var s := progress.settings
	if Pal.use(str(s.get("theme", "drafting"))):
		# The page changed colour: restyle the controls and build the screen again in the new ink.
		Kit.restyle()
		RenderingServer.set_default_clear_color(Pal.PAPER)
		if _paper != null:
			_paper.queue_redraw()
		if _screen != null and screen_name != &"pick":
			refresh.call_deferred()
	if _sfx != null:
		for pair: Array in [["set_master", "masterVolume"], ["set_mechanical", "mechanicalVolume"],
				["set_ambient", "ambientVolume"], ["set_ui", "uiVolume"], ["set_muted", "muted"],
				["set_continuous", "continuousTones"]]:
			_sfx.call(pair[0], s[pair[1]])
	Haptics.enabled = bool(s["haptics"])
	if pick != null:
		pick.reduced_motion = bool(s["reducedMotion"])
		pick.set_tension_toggle(bool(s["tensionToggle"]))


func click() -> void:
	if _sfx != null:
		_sfx.call("ui_click")


## Open the feedback form, with where the player was written down for it: the screen, and the
## lock if one is on the bench.
func open_feedback() -> void:
	var where := str(screen_name)
	if pick != null and not pick.is_open():
		where = "%s — %s" % [str(lock_def.get("name", "a lock")), "a lesson" if lesson != null else "on the bench"]
	memo["feedback_where"] = where
	goto(&"feedback")


func copy_text(value: String, what: String) -> void:
	DisplayServer.clipboard_set(value)
	status = "copied %s" % what


## Esc, or B on a controller: one step back towards the menu.
func back() -> void:
	match screen_name:
		&"menu", &"pick":
			pass
		&"pause":
			goto(&"pick")
		&"results":
			goto(&"bench")
		_:
			if pick_active():
				# Settings and Help were opened from the pause panel: back is back to it.
				goto(&"pause")
			elif screen_name == &"streak" and streak != null and not streak.finished:
				# A live run is not something to fall out of by accident; its screen has the ways on.
				pass
			else:
				goto(&"menu")


## In a browser, a phone turns itself landscape rather than asking the player to — where it is
## allowed to. Both fullscreen and the orientation lock need a gesture, so this waits for the
## first finger to come off the glass, and it is asked once: a browser that says no (Safari on a
## phone has neither) will say no every time, and the "turn the phone sideways" screen is the
## answer there. Only where the pointer is a finger — a laptop with a touch screen is left alone.
const FIRST_TOUCH_JS := """
(function () {
	if (window.__shearLineFirstTouch) return;
	window.__shearLineFirstTouch = true;
	window.addEventListener('touchend', function once() {
		window.removeEventListener('touchend', once, true);
		if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) return;
		var lock = function () {
			try {
				var o = screen.orientation;
				if (o && o.lock) o.lock('landscape').catch(function () {});
			} catch (e) {}
		};
		try {
			var el = document.getElementById('canvas') || document.documentElement;
			if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().then(lock, lock);
			else lock();
		} catch (e) {
			lock();
		}
	}, true);
})();
"""


## Before any screen hears it: which hands are playing — fingers, or keys and a mouse — and
## nothing on a screen the player has been asked to turn the phone to see.
func _input(event: InputEvent) -> void:
	PickTouch.note(event)
	if _rotate != null and _rotate.visible and (event is InputEventScreenTouch or event is InputEventScreenDrag
			or event is InputEventMouse):
		get_viewport().set_input_as_handled()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and (event as InputEventKey).pressed and not (event as InputEventKey).echo:
		var key := (event as InputEventKey).physical_keycode
		if key == KEY_ESCAPE:
			back()
			get_viewport().set_input_as_handled()
		elif key == KEY_F11 or (key == KEY_ENTER and (event as InputEventKey).alt_pressed):
			toggle_fullscreen()
			get_viewport().set_input_as_handled()
	elif event is InputEventJoypadButton and (event as InputEventJoypadButton).pressed 			and (event as InputEventJoypadButton).button_index == JOY_BUTTON_B and screen_name != &"pick":
		back()
		get_viewport().set_input_as_handled()


func toggle_fullscreen() -> void:
	var w := get_window()
	w.mode = Window.MODE_WINDOWED if w.mode == Window.MODE_FULLSCREEN else Window.MODE_FULLSCREEN
