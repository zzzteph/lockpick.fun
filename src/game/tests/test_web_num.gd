extends "res://game/tests/suite.gd"
## Numbers and JSON, bit for bit and byte for byte against a browser.


func run() -> void:
	var g: Dictionary = golden("web_num")

	# Every double reads from its printed form to the same bits, and prints back the same text.
	for row: Array in g["floats"]:
		var text: String = row[0]
		var bits := bits_of_hex(row[1])
		check(WebNum.bits_of(WebNum.parse(text)) == bits, "parse %s" % text)
		var printed := WebNum.text(WebNum.from_bits(bits))
		check(printed == text, "print %s, got %s" % [text, printed])

	for row: Array in g["fixed"]:
		var x := double_of(row[0])
		var decimals: int = row[1]
		var printed := WebNum.to_fixed(x, decimals)
		check(printed == row[2], "toFixed(%s, %d) want %s, got %s" % [WebNum.text(x), decimals, row[2], printed])
		check(WebNum.bits_of(WebNum.fixed(x, decimals)) == bits_of_hex(row[3]), "fixed(%s, %d)" % [WebNum.text(x), decimals])

	for row: Array in g["round"]:
		var x := double_of(row[0])
		check(WebNum.round_half_up(x) == int(row[1]), "round %s want %s, got %d" % [WebNum.text(x), row[1], WebNum.round_half_up(x)])

	for row: Array in g["imul"]:
		check(WebNum.imul(row[0], row[1]) == int(row[2]), "imul %s x %s" % [row[0], row[1]])

	check(WebNum.is_integer(3) and WebNum.is_integer(3.0) and not WebNum.is_integer(3.5), "is_integer")
	check(not WebNum.is_integer("3") and not WebNum.is_integer(null) and not WebNum.is_integer(true), "is_integer refuses non-numbers")
	check(WebNum.is_number(1) and WebNum.is_number(1.5) and not WebNum.is_number(true) and not WebNum.is_number("1"), "is_number")

	_json(g["json"])


func _json(g: Dictionary) -> void:
	var json := WebJson.new()
	for key: String in ["compact", "pretty", "escapes"]:
		check(json.parse(g[key]), "%s parses: %s" % [key, json.error])
	json.parse(g["compact"])
	var value: Variant = json.data
	check(WebJson.stringify(value) == g["compact"], "compact text survives a round trip")
	check(WebJson.stringify(value, "  ") == g["pretty"], "pretty text matches the browser's")
	json.parse(g["pretty"])
	same(json.data, value, "pretty and compact read as the same value")
	json.parse(g["escapes"])
	check(WebJson.stringify(json.data) == g["escapes"], "escapes survive a round trip")

	for row: Array in g["bad"]:
		check(json.parse(row[0]) == row[1], "strictness on %s" % WebJson.quote(row[0]))
		check(row[1] or json.error != "", "a refusal says why")

	# Whole numbers written without a fraction are ints; everything else is a float.
	json.parse("[1, -7, 1.0, 1e3, 123456789012345, 12345678901234567890, 0.5]")
	var kinds: Array = []
	for item: Variant in json.data:
		kinds.append(typeof(item))
	same(kinds, [TYPE_INT, TYPE_INT, TYPE_FLOAT, TYPE_FLOAT, TYPE_INT, TYPE_FLOAT, TYPE_FLOAT], "number kinds")
	check(WebJson.stringify([1.0, 2.5, -0.0, 1e21, 1e-7, INF, NAN]) == "[1,2.5,0,1e+21,1e-7,null,null]", "floats print as a browser prints them")
	check(WebJson.stringify({"b": 1, "a": {}}, "  ") == "{\n  \"b\": 1,\n  \"a\": {}\n}", "key order is kept, empties stay closed")

	# Depth is bounded rather than trusted.
	check(not json.parse("[".repeat(200) + "]".repeat(200)), "absurd nesting is refused")
