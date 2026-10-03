extends "res://game/tests/suite.gd"
## What a feedback submission is made of, and the queue a failed one waits in.


func run() -> void:
	_bodies()
	_cleaning()
	_queue()


func _bodies() -> void:
	var body := Feedback.build_body(4, "Bug", "The bar would not drop.\nSecond line & more?", "Robin", "bench", "6.0.0")
	var got := Feedback.parse_body(body)
	same(got[Feedback.ENTRIES["rating"]], "4", "the rating is sent as its number")
	same(got[Feedback.ENTRIES["type"]], "Bug", "the kind is one of the form's own words")
	same(got[Feedback.ENTRIES["details"]], "The bar would not drop.\nSecond line & more?\n\n[%s, bench]" % Feedback.platform_name(),
		"the details carry the player's words, then the platform and where they were")
	same(got[Feedback.ENTRIES["version"]], "6.0.0", "the version goes with it")
	same(got[Feedback.ENTRIES["name"]], "Robin", "and the name")
	check(not body.contains(" ") and not body.contains("\n") and not body.contains("?"), "the body is url-encoded")
	same(got.size(), 5, "five answers, one for each question")
	check(Feedback.FORM_URL.begins_with("https://docs.google.com/forms/d/e/") and Feedback.FORM_URL.ends_with("/formResponse"),
		"it is posted to the form's own submit address")
	for kind in Feedback.TYPES:
		same(Feedback.parse_body(Feedback.build_body(0, kind, "x", "", "", "1"))[Feedback.ENTRIES["type"]], kind, "kind %s" % kind)

	# What may be left out, is.
	var bare := Feedback.parse_body(Feedback.build_body(0, "nonsense", "", "", "", "6.0.0"))
	check(not bare.has(Feedback.ENTRIES["rating"]), "no rating leaves the rating unanswered")
	same(bare[Feedback.ENTRIES["type"]], Feedback.DEFAULT_TYPE, "an unknown kind is General")
	same(bare[Feedback.ENTRIES["details"]], "[%s]" % Feedback.platform_name(), "with no words, the details are the context alone")
	same(bare[Feedback.ENTRIES["name"]], "", "no name is no name")
	for rating: int in [-1, 0, 6, 99]:
		check(not Feedback.parse_body(Feedback.build_body(rating, "Bug", "x", "", "", "1")).has(Feedback.ENTRIES["rating"]),
			"a rating of %d is not sent" % rating)

	check(not Feedback.has_something(0, "   \n "), "nothing filled in is nothing to send")
	check(Feedback.has_something(3, ""), "a rating alone is something")
	check(Feedback.has_something(0, "a word"), "a word alone is something")


func _cleaning() -> void:
	same(Feedback.clean("  hello\tthere\u0007 \n", 50), "hellothere", "control characters go, and the ends are trimmed")
	same(Feedback.clean("one\ntwo", 50), "one\ntwo", "a newline is kept")
	var long := "x".repeat(Feedback.MAX_DETAILS + 50)
	var cut := Feedback.clean(long, Feedback.MAX_DETAILS)
	same(cut.length(), Feedback.MAX_DETAILS, "text is capped at its limit")
	check(cut.ends_with("…"), "and says it was cut")
	same(Feedback.clean("A very long name indeed, far too long", Feedback.MAX_NAME).length(), Feedback.MAX_NAME, "a name is capped too")
	same(Feedback.context_line(""), "[%s]" % Feedback.platform_name(), "the context with nowhere to name")


func _queue() -> void:
	var path := OS.get_temp_dir().path_join("shear-line-feedback-queue-test.json")
	Feedback.queue_save([] as Array[String], path)
	same(Feedback.queue_load(path), [] as Array[String], "no queue is an empty queue")
	Feedback.queue_add("a=1", path)
	Feedback.queue_add("b=2", path)
	same(Feedback.queue_load(path), ["a=1", "b=2"] as Array[String], "what is kept comes back in order")
	for i in Feedback.QUEUE_MAX + 5:
		Feedback.queue_add("n=%d" % i, path)
	var kept := Feedback.queue_load(path)
	same(kept.size(), Feedback.QUEUE_MAX, "the queue holds no more than its limit")
	same(kept[-1], "n=%d" % (Feedback.QUEUE_MAX + 4), "and it is the oldest that go")
	var file := FileAccess.open(path, FileAccess.WRITE)
	file.store_string("{ not a list")
	file.close()
	same(Feedback.queue_load(path), [] as Array[String], "a queue file that cannot be read is an empty queue")
	Feedback.queue_save([] as Array[String], path)
	check(not FileAccess.file_exists(path), "an empty queue leaves no file behind")
