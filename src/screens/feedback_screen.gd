extends GameScreen
## Feedback: a rating, what kind of thing it is, a few words, a name if the player cares to give
## one — and Send, which posts it to the maker's form without leaving the game (`Feedback`,
## `FeedbackPost`). The build it was written in and where the player was go with it unasked,
## because those are the two things a bug report is useless without and nobody thinks to say.
##
## Nothing is lost by walking away: what has been filled in is kept for the session, so a player
## who backs out to check something finds it as they left it.

const LEAD := "A bug, an idea, or a word about the game. It goes straight to the maker — nothing opens in a browser."
const FIELD_W := 1100.0
const RATE_Y := 266.0
const RATE := Vector2(84.0, 60.0)
const RATE_GAP := 12.0
const KIND_Y := 378.0
const KIND := Vector2(660.0, 60.0)
const DETAILS_Y := 490.0
const DETAILS_H := 250.0
const NAME_Y := 792.0
const NAME := Vector2(520.0, 60.0)
const SEND_Y := 892.0
const SEND := Vector2(300.0, 64.0)

var _rates: Array[Button] = []
var _details: TextEdit
var _name: LineEdit
var _send: Button
var _rating := 0
var _kind := Feedback.DEFAULT_TYPE
var _where := ""


func build() -> void:
	title = "Feedback"
	status = "nothing is sent until you press send"
	# From the pause panel the way back is to the lock, as it is from Settings and Help.
	if app.pick_active():
		nav([
			["Back to the lock", func() -> void: app.goto(&"pause")],
			["Menu", func() -> void: app.goto(&"menu")],
		])
	else:
		nav([["Menu", func() -> void: app.goto(&"menu")]])
	_where = str(app.memo.get("feedback_where", ""))
	var draft: Dictionary = app.memo.get("feedback_draft", {})
	_rating = clampi(int(draft.get("rating", 0)), 0, 5)
	_kind = str(draft.get("kind", Feedback.DEFAULT_TYPE))
	if not Feedback.TYPES.has(_kind):
		_kind = Feedback.DEFAULT_TYPE

	# The rating: five boxes, the chosen one and everything under it filled. Pressing the chosen
	# one again takes the rating back — it is the one question that may be left unanswered.
	_rates.clear()
	for i in 5:
		var b := Kit.button(self, Rect2(LEFT + i * (RATE.x + RATE_GAP), RATE_Y, RATE.x, RATE.y), str(i + 1),
			_rate.bind(i + 1), false, Pal.T_HEADING)
		b.toggle_mode = true
		Kit.describe(b, "Rating: %d of 5" % (i + 1), "Press again to leave the rating out.")
		_rates.append(b)
	_show_rating()

	Kit.segmented(self, Rect2(LEFT, KIND_Y, KIND.x, KIND.y), Feedback.TYPES, Feedback.TYPES.find(_kind),
		func(i: int) -> void:
			_kind = Feedback.TYPES[i]
			_keep(), "Kind")

	_details = TextEdit.new()
	_details.position = Vector2(LEFT, DETAILS_Y)
	_details.placeholder_text = "What happened, or what would make it better?"
	_details.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	_details.text = str(draft.get("details", ""))
	_details.accessibility_name = "Details"
	_details.accessibility_description = "Up to %d characters. Tab moves on to the next field." % Feedback.MAX_DETAILS
	_details.text_changed.connect(_details_changed)
	_details.gui_input.connect(_details_keys)
	add_child(_details)
	_details.size = Vector2(FIELD_W, DETAILS_H)

	_name = LineEdit.new()
	_name.position = Vector2(LEFT, NAME_Y)
	_name.max_length = Feedback.MAX_NAME
	_name.placeholder_text = "leave it empty to stay anonymous"
	_name.text = str(draft.get("name", ""))
	_name.accessibility_name = "Name, optional"
	_name.accessibility_description = "Press Enter to type, and Enter again when done."
	_name.text_changed.connect(func(_text: String) -> void: _keep())
	add_child(_name)
	_name.size = NAME

	_send = Kit.button(self, Rect2(LEFT, SEND_Y, SEND.x, SEND.y), "Send", _send_it, true, Pal.T_HEADING)
	Kit.describe(_send, "Send", "Posts the rating, the kind, the details and the name to the maker's form.")
	var post: FeedbackPost = app.feedback
	if not post.finished.is_connected(_on_finished):
		post.finished.connect(_on_finished)
	_rates[maxi(0, _rating - 1)].grab_focus.call_deferred(true)


func _exit_tree() -> void:
	if app != null and app.feedback != null and (app.feedback as FeedbackPost).finished.is_connected(_on_finished):
		(app.feedback as FeedbackPost).finished.disconnect(_on_finished)


func _show_rating() -> void:
	for i in _rates.size():
		var b := _rates[i]
		b.theme_type_variation = "SegmentOn" if i < _rating else "Segment"
		b.set_pressed_no_signal(i + 1 == _rating)


func _rate(n: int) -> void:
	_rating = 0 if n == _rating else n
	_show_rating()
	_keep()


## What has been filled in, held for the session: backing out and coming back loses nothing.
func _keep() -> void:
	app.memo["feedback_draft"] = {"rating": _rating, "kind": _kind, "details": _details.text, "name": _name.text}


## The limit is shown before it bites, and nothing typed past it is silently dropped: the box
## simply stops taking more.
func _details_changed() -> void:
	if _details.text.length() > Feedback.MAX_DETAILS:
		var line := _details.get_caret_line()
		var column := _details.get_caret_column()
		_details.text = _details.text.left(Feedback.MAX_DETAILS)
		_details.set_caret_line(mini(line, _details.get_line_count() - 1))
		_details.set_caret_column(mini(column, _details.get_line(_details.get_caret_line()).length()))
	_keep()


## A text box keeps Tab for itself. Here it moves on, as it does from every other control, so a
## keyboard is never stuck in the box.
func _details_keys(event: InputEvent) -> void:
	var to: Control = null
	if event.is_action_pressed(&"ui_focus_prev", false, true):
		to = _details.find_prev_valid_focus()
	elif event.is_action_pressed(&"ui_focus_next", false, true):
		to = _details.find_next_valid_focus()
	else:
		return
	_details.accept_event()
	if to != null:
		to.grab_focus()


func _send_it() -> void:
	var post: FeedbackPost = app.feedback
	var why := post.refusal(_rating, _details.text)
	if why != "":
		app.status = why
		return
	_send.disabled = true
	app.status = "sending…"
	post.send(Feedback.build_body(_rating, _kind, _details.text, _name.text, _where, str(app.VERSION)))


func _on_finished(ok: bool, words: String) -> void:
	app.status = words
	_send.disabled = false
	if ok:
		# Said and gone. The name stays: the next thing they write is from the same person.
		_rating = 0
		_details.text = ""
		_show_rating()
		_keep()


func paint() -> void:
	plain(Vector2(LEFT, 176.0), LEAD, Pal.T_BODY, Pal.INK_LIGHT)
	tracked(Vector2(LEFT, RATE_Y - 16.0), "rating", Pal.T_DIM, Pal.INK_LIGHT)
	plain(Vector2(LEFT + 5.0 * (RATE.x + RATE_GAP) + 12.0, RATE_Y + RATE.y / 2.0 + Pal.T_DIM * 0.36),
		"1 is poor, 5 is great — or leave it out", Pal.T_DIM, Pal.INK_LIGHT)
	tracked(Vector2(LEFT, KIND_Y - 16.0), "kind", Pal.T_DIM, Pal.INK_LIGHT)
	tracked(Vector2(LEFT, DETAILS_Y - 16.0), "details", Pal.T_DIM, Pal.INK_LIGHT)
	if _details != null:
		var left := Feedback.MAX_DETAILS - _details.text.length()
		plain(Vector2(LEFT + FIELD_W, DETAILS_Y - 16.0), "%d left" % left, Pal.T_DIM,
			Pal.CRIMSON_TEXT if left <= 60 else Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_RIGHT)
	tracked(Vector2(LEFT, NAME_Y - 16.0), "name — optional", Pal.T_DIM, Pal.INK_LIGHT)
	# What goes with it unasked, said before it is sent.
	var from := (", and where you were: %s" % _where) if _where != "" else ""
	plain(Vector2(LEFT + SEND.x + 28.0, SEND_Y + SEND.y / 2.0 + Pal.T_DIM * 0.36),
		"goes with it: version %s, %s%s" % [app.VERSION, Feedback.platform_name(), from], Pal.T_DIM, Pal.INK_LIGHT)
