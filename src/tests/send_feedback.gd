extends SceneTree
## Posts one real feedback entry to the Google Form from the command line: to check that the form
## still takes what the game sends after the form has been edited, or to file a note without the
## game. This is the only thing in the tests that reaches the network, and it is run by hand.
##
##   godot --headless --path src -s res://tests/send_feedback.gd -- --rating 5 --type General
##       --details "Test from the build machine" --name "Robin" [--where "the command line"] [--version 6.0.0]
##
## Exits 0 when Google answered 2xx or 3xx.


func _initialize() -> void:
	_post.call_deferred()


func _post() -> void:
	var opts := {"rating": "0", "type": Feedback.DEFAULT_TYPE, "details": "", "name": "", "where": "the command line",
		"version": ""}
	var args := OS.get_cmdline_user_args()
	var i := 0
	while i + 1 < args.size():
		var key := str(args[i])
		if key.begins_with("--") and opts.has(key.substr(2)):
			opts[key.substr(2)] = str(args[i + 1])
			i += 2
		else:
			i += 1
	var version := str(opts["version"])
	if version == "":
		version = str(ProjectSettings.get_setting("application/config/version", "?"))
	var body := Feedback.build_body(int(str(opts["rating"])), str(opts["type"]), str(opts["details"]), str(opts["name"]),
		str(opts["where"]), version)
	print("posting to %s" % Feedback.FORM_URL)
	var fields := Feedback.parse_body(body)
	for key: String in fields:
		print("  %s = %s" % [key, str(fields[key]).replace("\n", " / ")])
	var http := HTTPRequest.new()
	http.timeout = 20.0
	root.add_child(http)
	var err := http.request(Feedback.FORM_URL, PackedStringArray(Feedback.HEADERS), HTTPClient.METHOD_POST, body)
	if err != OK:
		print("request refused (error %d)" % err)
		quit(1)
		return
	var answer: Array = await http.request_completed
	var ok := int(answer[0]) == HTTPRequest.RESULT_SUCCESS and int(answer[1]) >= 200 and int(answer[1]) < 400
	print("%s — HTTP %d (result %d)" % ["sent" if ok else "FAILED", int(answer[1]), int(answer[0])])
	quit(0 if ok else 1)
