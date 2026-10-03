extends GameScreen
## The pause panel, over the stopped lock: back to it, start it again, look something up, or
## walk away. Not a page of its own — the attempt is still on the bench underneath.

const W := 420.0
const PITCH := 66.0

var _rect: Rect2


## An overlay has no chrome: the lock's own header is still showing through.
func show_feedback() -> bool:
	return false


func show_status() -> bool:
	return false


func build() -> void:
	# A blitz pick pauses without a restart: R there is "skip", and the panel must not offer a
	# reroll the mode does not have. Its way out names the price — ending a run banks nothing.
	var blitz: bool = app.streak != null and not app.streak.finished
	var rows: Array = [["Resume", func() -> void: app.goto(&"pick")]]
	if not blitz:
		rows.append(["Restart lock", func() -> void: app.restart_lock()])
	# Reachable mid-attempt, because "what is that bar for" is a question you have while
	# picking, not one you plan a trip to the menu for.
	rows.append(["Help", func() -> void: app.goto(&"help")])
	rows.append(["Settings", func() -> void: app.goto(&"settings")])
	# A bug is met in the middle of a lock, and that is when it can be said with the lock's name
	# on it.
	rows.append(["Feedback", func() -> void: app.open_feedback()])
	var out := "Back to bench"
	if blitz:
		out = "End the run"
	elif app.lesson != null:
		out = "Back to tutorial"
	rows.append([out, func() -> void: app.abandon_lock()])

	var h := 116.0 + PITCH * rows.size()
	_rect = Rect2((1920.0 - W) / 2.0, (1080.0 - h) / 2.0, W, h)
	for i in rows.size():
		var on_press: Callable = rows[i][1]
		var b := Kit.button(self, Rect2(_rect.position.x + 40.0, _rect.position.y + 110.0 + PITCH * i, W - 80.0, 52.0),
			str(rows[i][0]), on_press, i == 0)
		if i == 0:
			b.grab_focus.call_deferred(true)


func paint_under() -> void:
	# The lock stays on show, washed back so the panel is the only thing asking to be read.
	pen.draw_rect(Rect2(Vector2.ZERO, Pal.STAGE), Color(Pal.PAPER, 0.86))
	panel(_rect)
	tracked(Vector2(_rect.get_center().x, _rect.position.y + 60.0), "Paused", Pal.T_TITLE, Pal.INK,
		HORIZONTAL_ALIGNMENT_CENTER)
