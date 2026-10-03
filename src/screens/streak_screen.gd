extends GameScreen
## Lock blitz: five minutes, as many locks as you can, the score the sum of their tiers.
##
## One page in three states, because they are one place. The briefing, with the standing bests
## beside it; the breather between two locks of a live run; and the briefing again once the
## clock has run out, with that run's tally where the bests were — it stays there until the
## next run starts. While a lock is on the bench the app is on the pick screen, whose header
## carries the countdown and the running score.

const LEVELS: Array[StringName] = [&"training", &"normal"]
## The left column's edge, and the panel its text is measured against.
const COLUMN := MARGIN + 60.0
const PANEL := Rect2(1000.0, 200.0, 860.0, 470.0)
const TEXT_WIDTH := 1000.0 - 24.0 - COLUMN
const LINE := 30.0
const FIGURE := 132
const DEAL := "Every deal is a lock you have never met, from whatever tiers your bench has unlocked. " \
	+ "Each open scores its tier — a tier-4 lock is worth four tier-1s."
const PRICE := "Restarting skips to the next lock — the seconds you spent are the price. " \
	+ "The clock never stops for a deal."

## The breather: its figures, and the two ways on under them.
const MID := 1920.0 / 2.0
const REST_ROWS_Y := 376.0
const REST_PITCH := 44.0
const REST_BUTTONS_Y := REST_ROWS_Y + REST_PITCH * 2.0 + 48.0
const REST_BUTTON := Vector2(280.0, 56.0)
## What "any key" leaves alone: the keys that steer between the two buttons or back out, and
## the ones that are only ever held for another key.
const STEERING: Array[StringName] = [
	&"ui_left", &"ui_right", &"ui_up", &"ui_down", &"ui_focus_next", &"ui_focus_prev", &"ui_cancel",
]
const HELD_KEYS: Array[Key] = [
	KEY_SHIFT, KEY_CTRL, KEY_ALT, KEY_META, KEY_CAPSLOCK, KEY_NUMLOCK, KEY_SCROLLLOCK, KEY_PRINT, KEY_F11,
]

## The level the next run is played at. Bests are kept per level.
var _level: StringName = &"normal"
## Baseline of the "difficulty" label: everything under the copy hangs from it.
var _level_y := 0.0


func build() -> void:
	title = "Lock blitz"
	if _resting():
		# No navigation on the breather: the run is live, and its two ways on are both here.
		status = "the clock is stopped — any key or a click deals the next lock too"
		var end := Kit.button(self, Rect2(MID - 12.0 - REST_BUTTON.x, REST_BUTTONS_Y, REST_BUTTON.x, REST_BUTTON.y),
			"End the run", func() -> void: app.abandon_lock())
		Kit.describe(end, "End the run", "the run stops here and banks nothing")
		var next := Kit.button(self, Rect2(MID + 12.0, REST_BUTTONS_Y, REST_BUTTON.x, REST_BUTTON.y), "Next lock",
			func() -> void: app.streak_continue(), true)
		Kit.describe(next, "Next lock", "deal the next lock and start the clock again")
		next.grab_focus.call_deferred(true)
		return
	status = "five minutes on the clock — open as many locks as you can"
	nav([["Menu", func() -> void: app.goto(&"menu")]])
	var kept: Variant = app.memo.get("streak_level", app.progress.assist())
	_level = kept if LEVELS.has(kept) else &"normal"
	_level_y = 284.0 + _lines(DEAL) * LINE + 18.0 + _lines(PRICE) * LINE + 36.0
	Kit.segmented(self, Rect2(COLUMN, _level_y + 10.0, 580.0, 40.0), ["Training", "Normal"], LEVELS.find(_level),
		_choose, "Difficulty")
	var start := Kit.button(self, Rect2(COLUMN, maxf(680.0, _level_y + 128.0), 420.0, 56.0), "Start the clock",
		func() -> void: app.start_streak(_level), true)
	start.grab_focus.call_deferred(true)


func paint() -> void:
	var run: StreakRun = app.streak
	if _resting():
		_paint_breather(run)
		return
	tracked(Vector2(COLUMN, 220.0), "Five minutes. As many as you can.", Pal.T_TITLE, Pal.INK)
	var y := 284.0
	y += paragraph(Vector2(COLUMN, y), DEAL, Pal.T_BODY, Pal.INK, TEXT_WIDTH, LINE, 5) + 18.0
	paragraph(Vector2(COLUMN, y), PRICE, Pal.T_BODY, Pal.INK_LIGHT, TEXT_WIDTH, LINE, 5)
	tracked(Vector2(COLUMN, _level_y), "difficulty", Pal.T_DIM, Pal.INK)
	var best: Dictionary = app.progress.streak_best(_level)
	plain(Vector2(COLUMN, _level_y + 84.0), "no run on the board at this level yet" if best.is_empty()
		else "best %s run — %d pts, %d locks" % [_level, best["score"], best["opens"]], Pal.T_DIM, Pal.AMBER_TEXT)
	# The right half: the run that just ended, or the board itself.
	if run != null and run.finished:
		_paint_tally(run)
	else:
		_paint_bests()


## The run's numbers while the clock is stopped: how many, how fast, how long is left.
func _paint_breather(run: StreakRun) -> void:
	tracked(Vector2(MID, 300.0), "%d %s cracked" % [run.opens, "lock" if run.opens == 1 else "locks"], Pal.T_TITLE,
		Pal.INK, HORIZONTAL_ALIGNMENT_CENTER)
	var rows: Array = [
		["points", str(run.score)],
		["average per lock", "%.1fs" % run.average_seconds()],
		["time left", run.clock_text()],
	]
	var y := REST_ROWS_Y
	for row: Array in rows:
		tracked(Vector2(MID - 30.0, y), row[0], Pal.T_BODY, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_RIGHT)
		plain(Vector2(MID + 30.0, y), row[1], Pal.T_BODY, Pal.INK)
		y += REST_PITCH
	# What the quieter button costs, said beside it: only the clock running out banks a run.
	plain(Vector2(MID, REST_BUTTONS_Y + REST_BUTTON.y + 36.0), "ending the run now banks nothing — only a run that reaches " +
		"the end of the clock counts", Pal.T_DIM, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_CENTER)


func _paint_tally(run: StreakRun) -> void:
	panel(PANEL, "the run")
	var mid := PANEL.get_center().x
	# The score, stamped big — and shrunk to fit rather than clipped, because a score too wide
	# for the panel is a run somebody will eventually stand.
	var figure := "%d pts" % run.score
	var wide := Pal.text_width(figure, FIGURE, true)
	var size := FIGURE if wide <= PANEL.size.x - 56.0 else int(FIGURE * (PANEL.size.x - 56.0) / wide)
	plain(Vector2(mid, PANEL.position.y + 78.0 + FIGURE / 2.0 + size * 0.36), figure, size,
		Pal.TEAL_TEXT if run.new_best else Pal.INK, HORIZONTAL_ALIGNMENT_CENTER, true)
	var y := PANEL.position.y + 78.0 + FIGURE + 44.0
	plain(Vector2(mid, y), "%d %s opened in five minutes" % [run.opens, "lock" if run.opens == 1 else "locks"],
		Pal.T_DIM, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_CENTER)
	if run.new_best:
		plain(Vector2(mid, y + Pal.T_DIM + 14.0), "a new best at %s" % run.assist, Pal.T_DIM, Pal.TEAL_TEXT,
			HORIZONTAL_ALIGNMENT_CENTER)


## No run to report: one row per level. The level the next run is set to is in full ink, with
## a mark in front of it — so which row is yours is not a matter of telling two greys apart.
func _paint_bests() -> void:
	panel(PANEL, "best runs")
	var y := PANEL.position.y + 76.0
	for level in LEVELS:
		var best: Dictionary = app.progress.streak_best(level)
		if level == _level:
			pen.draw_rect(Rect2(PANEL.position.x + 18.0, y - Pal.T_DIM * 0.72, 10.0, Pal.T_DIM * 0.72), Pal.INK)
		tracked(Vector2(PANEL.position.x + 40.0, y), String(level), Pal.T_DIM, Pal.INK if level == _level else Pal.INK_LIGHT)
		plain(Vector2(PANEL.end.x - 40.0, y), "—" if best.is_empty() else "%d pts · %d locks" % [best["score"], best["opens"]],
			Pal.T_DIM, Pal.INK_LIGHT if best.is_empty() else Pal.INK, HORIZONTAL_ALIGNMENT_RIGHT)
		y += 44.0


## A live run waiting between two locks.
func _resting() -> bool:
	var run: StreakRun = app.streak
	return run != null and not run.finished and run.interlude


func _choose(index: int) -> void:
	_level = LEVELS[index]
	app.memo["streak_level"] = _level


static func _lines(copy: String) -> int:
	return mini(5, wrap_text(copy, Pal.T_BODY, TEXT_WIDTH).size())


# ── The breather: the two buttons, and any other key, button or click means "next lock" ──

func _unhandled_input(event: InputEvent) -> void:
	if not _resting():
		super(event)
		return
	if not event.is_pressed() or event.is_echo():
		return
	# Steering is for the two buttons — and puts the focus on one of them if nothing has it.
	for action in STEERING:
		if event.is_action(action):
			super(event)
			return
	var go := event is InputEventJoypadButton
	var key := event as InputEventKey
	if key != null:
		# A key held for another key is not a press of its own, and Alt+Enter is the window's.
		go = not HELD_KEYS.has(key.keycode) and not HELD_KEYS.has(key.physical_keycode) \
			and not (key.alt_pressed or key.ctrl_pressed or key.meta_pressed)
	if go:
		get_viewport().set_input_as_handled()
		app.streak_continue()


func _gui_input(event: InputEvent) -> void:
	var click := event as InputEventMouseButton
	if _resting() and click != null and click.pressed and click.button_index <= MOUSE_BUTTON_RIGHT:
		accept_event()
		app.streak_continue()
