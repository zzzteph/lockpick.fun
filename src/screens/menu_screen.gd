extends GameScreen
## The title screen: the ways into the game in a column on the left — the one to take first always
## at the top — and, filling the rest of the page, the thing the game is about: a lock, cut open,
## half picked, with the page's shear line running through its own.

const W := 440.0
const H := 64.0
const PITCH := 74.0
## The extra air between one group of entries and the next.
const GROUP_GAP := 24.0
const TOP := 286.0
## The hero lock: px per mm, and where the page's shear line (and the lock's) runs.
const LOCK_K := 31.0
const SHEAR_Y := 566.0
const LOCK_RIGHT := 1920.0 - MARGIN - 64.0

var _buttons: Array[Button] = []


func show_feedback() -> bool:
	return true


func build() -> void:
	# The name is set large below; the corner title is every other page's.
	title = ""
	var progress: Progress = app.progress
	status = progress.ranked_line()
	# A brand-new player is steered to the tutorial, not to a wall of locks: the game is
	# unusually unforgiving of not knowing what tension is for. After that, the bench.
	var taught := progress.has_started_lessons()
	var play: Array = [
		["Tutorial", &"tutorial", "%d short lessons — a few minutes each, and the rest of the game makes sense" % Lessons.all().size()],
		["Bench", &"bench", "every lock in the game, tier by tier"],
	]
	if taught:
		play.reverse()
	var groups: Array = [
		play + [["Lock blitz", &"streak", "five minutes on the clock, as many locks as you can open"]],
		[
			["Lock editor", &"editor", "build a lock of your own, then pick it"],
			["Trophies", &"trophies", "%d of %d earned" % [_earned(), Achievements.count()]],
		],
		[
			["Help", &"help", "what every part is and what it is doing, in pictures"],
			["Settings", &"settings", "level, display, sound and your save"],
			["Quit", &"", "close the game"],
		],
	]
	# A page in a browser is closed by closing it: there is nothing for a Quit button to do.
	if OS.has_feature("web"):
		(groups[2] as Array).pop_back()
	_buttons.clear()
	var y := TOP
	for group: Array in groups:
		for entry: Array in group:
			var first := _buttons.is_empty()
			var b := Kit.button(self, Rect2(LEFT, y, W, H), str(entry[0]), _go.bind(entry[1]), first, Pal.T_HEADING)
			Kit.describe(b, str(entry[0]), str(entry[2]))
			_buttons.append(b)
			if first:
				b.grab_focus.call_deferred(true)
			y += PITCH
		y += GROUP_GAP
	accessibility_name = "Shear line — a lockpicking simulator"


func _go(to: StringName) -> void:
	if to == &"":
		get_tree().quit()
	else:
		app.goto(to)


func _earned() -> int:
	var n := 0
	for id: String in app.progress.data["achievements"]:
		if not Achievements.by_id(id).is_empty():
			n += 1
	return n


func paint() -> void:
	tracked(Vector2(LEFT, MARGIN + 96.0), "Shear line", Pal.T_PAYOUT, Pal.INK, HORIZONTAL_ALIGNMENT_LEFT, true)
	tracked(Vector2(LEFT + 4.0, MARGIN + 140.0), "a lockpicking simulator", Pal.T_BODY, Pal.INK_LIGHT)
	if not app.progress.has_started_lessons():
		# Said once, beside the entry it is about, to the one player who needs it.
		plain(Vector2(LEFT + W + 24.0, TOP + H / 2.0 + Pal.T_BODY * 0.36), "start here — five minutes", Pal.T_BODY,
			Pal.INK_LIGHT)
	var report := feedback_rect()
	plain(Vector2(report.position.x - 20.0, report.get_center().y + Pal.T_DIM * 0.36),
		"v" + str(app.VERSION), Pal.T_DIM, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_RIGHT)


func paint_under() -> void:
	var lock := _lock()
	var width := (HelpFigure.depth((lock["pins"] as Array).size())) * LOCK_K
	var mouth := LOCK_RIGHT - width
	# The shear line itself, across the page and through the lock's own.
	pen.draw_line(Vector2(LEFT + W + 60.0, SHEAR_Y), Vector2(1920.0 - MARGIN, SHEAR_Y), Pal.INK, Pal.HEAVY)
	tracked(Vector2(LEFT + W + 60.0, SHEAR_Y - 14.0), "shear line", Pal.T_DIM, Pal.INK_LIGHT)
	HelpFigure.side(pen, Vector2(mouth, SHEAR_Y), LOCK_K, lock)


## The lock on the page: two pins set, the third pinched and on its way up, two still to do.
func _lock() -> Dictionary:
	var step := LockRig.BIND_STEP
	var pins: Array = [
		HelpFigure.pin("standard", 1.5, step * 2.0), HelpFigure.pin("spool", 2.0, 0.0),
		HelpFigure.pin("standard", 1.2, step), HelpFigure.pin("standard", 1.8, step * 3.0),
		HelpFigure.pin("serrated", 1.4, step * 4.0),
	]
	var lock := HelpFigure.pose(pins)
	lock["shift"] = HelpFigure.bind_at(pins[0])
	lock["wrench"] = PinSession.wrench_newtons(PinSession.tension_for_step(5))
	lock["pick"] = 0.0
	lock["pick_lift"] = 0.9
	lock["push"] = 1.3
	(pins[1] as Dictionary).merge(HelpFigure.set_at(pins[1]), true)
	(pins[2] as Dictionary).merge(HelpFigure.set_at(pins[2]), true)
	(pins[0] as Dictionary).merge(HelpFigure.lifted(0.9, LockRig.BINDING), true)
	return lock
