extends SceneTree
## Headless: the feedback form through the real app — the button on the menu, a rating, a kind,
## words typed into the box, a name, Send — and what is put together to post. Nothing is posted:
## an app started by a test, or with no display, only says it sent.
##
##   godot --headless --path src --fixed-fps 60 -s res://tests/feedback_form.gd

var _app: Node
var _failures := 0
var _checks := 0


func _initialize() -> void:
	var scene: PackedScene = load("res://main.tscn")
	_app = scene.instantiate()
	_app.progress = Progress.new(SaveStore.memory())
	root.add_child(_app)
	_run.call_deferred()


func _check(ok: bool, what: String, detail: String = "") -> void:
	_checks += 1
	if not ok:
		_failures += 1
	print("%s %s%s" % ["ok   " if ok else "FAIL ", what, (" — " + detail) if detail != "" else ""])


func _frames(n: int) -> void:
	for i in n:
		await process_frame


func _button(node: Node, caption: String) -> Button:
	for child in node.get_children():
		if child is Button and not child.is_queued_for_deletion() and (child as Button).is_visible_in_tree() \
				and (child as Button).text.to_lower() == caption.to_lower():
			return child
		var deeper := _button(child, caption)
		if deeper != null:
			return deeper
	return null


func _field(node: Node, kind: String) -> Control:
	for child in node.get_children():
		if child.get_class() == kind and not child.is_queued_for_deletion():
			return child
		var deeper := _field(child, kind)
		if deeper != null:
			return deeper
	return null


func _press(caption: String) -> bool:
	var b := _button(_app, caption)
	if b == null:
		return false
	b.pressed.emit()
	return true


func _run() -> void:
	await _frames(4)
	var post: FeedbackPost = _app.feedback
	_check(post.dry_run, "an app a test started posts nothing")
	_check(_button(_app, "report an issue ↗") == null, "the menu no longer links to the issue tracker")
	_check(_press("feedback"), "the menu has a Feedback button")
	await _frames(4)
	_check(_app.screen_name == &"feedback", "and it opens the feedback form", str(_app.screen_name))

	# Nothing filled in: nothing goes.
	_check(_press("send"), "the form has a Send button")
	await _frames(2)
	_check(post.last_body == "", "an empty form is not sent")
	_check(str(_app.status).contains("rating or write"), "and it says what is missing", str(_app.status))

	# Fill it in the way a player does.
	_check(_press("4"), "a rating can be chosen")
	_check(_press("bug"), "and a kind")
	var details: TextEdit = _field(_app, "TextEdit")
	var name_field: LineEdit = _field(_app, "LineEdit")
	_check(details != null and name_field != null, "there is a box for the details and one for the name")
	details.text = "The bar would not drop on disc 3."
	details.text_changed.emit()
	name_field.text = "Robin"
	name_field.text_changed.emit("Robin")
	await _frames(2)

	# Walking away loses nothing.
	_app.goto(&"menu")
	await _frames(3)
	_press("feedback")
	await _frames(4)
	details = _field(_app, "TextEdit")
	name_field = _field(_app, "LineEdit")
	_check(details.text == "The bar would not drop on disc 3." and name_field.text == "Robin", "what was filled in is still there after leaving and coming back")

	_press("send")
	await _frames(3)
	var sent := Feedback.parse_body(post.last_body)
	_check(sent.get(Feedback.ENTRIES["rating"]) == "4", "the rating is in what is sent", str(sent.get(Feedback.ENTRIES["rating"])))
	_check(sent.get(Feedback.ENTRIES["type"]) == "Bug", "and the kind", str(sent.get(Feedback.ENTRIES["type"])))
	var words := str(sent.get(Feedback.ENTRIES["details"]))
	_check(words.begins_with("The bar would not drop on disc 3.") and words.ends_with("[%s, menu]" % Feedback.platform_name()),
		"the details, with the platform and where the player was under them", words.replace("\n", " / "))
	_check(sent.get(Feedback.ENTRIES["version"]) == str(_app.VERSION), "the version, which the player never sees", str(sent.get(Feedback.ENTRIES["version"])))
	_check(sent.get(Feedback.ENTRIES["name"]) == "Robin", "and the name")
	_check(str(_app.status).contains("thank you"), "it says it was sent", str(_app.status))
	_check(details.text == "" and name_field.text == "Robin", "the words are cleared and the name is kept")

	# A second one straight after is held back.
	details.text = "And another thing."
	details.text_changed.emit()
	var before := post.last_body
	_press("send")
	await _frames(2)
	_check(post.last_body == before and str(_app.status).contains("half a minute"), "a second send straight after is held back", str(_app.status))

	# The typed limit.
	details.text = "y".repeat(Feedback.MAX_DETAILS + 40)
	details.text_changed.emit()
	_check(details.text.length() == Feedback.MAX_DETAILS, "the box stops at its limit", str(details.text.length()))

	# From a lock: the way in is on the pause panel, and the lock's name goes with it.
	_app.progress.complete_lesson("lesson-rotate")
	_app.start_lock(Roster.by_slug("vantage-disc-padlock"))
	await _frames(4)
	_app.goto(&"pause")
	await _frames(3)
	_check(_press("feedback"), "the pause panel has a Feedback entry")
	await _frames(3)
	_check(str(_app.memo.get("feedback_where", "")).begins_with("Vantage Disc Padlock"), "and the lock on the bench is named", str(_app.memo.get("feedback_where", "")))
	_check(_press("back to the lock"), "with a way back to the lock")
	await _frames(3)
	_check(_app.screen_name == &"pause" and _app.pick != null, "which is still there", str(_app.screen_name))

	print("---- feedback: %d checks, %d failed" % [_checks, _failures])
	quit(1 if _failures > 0 else 0)
