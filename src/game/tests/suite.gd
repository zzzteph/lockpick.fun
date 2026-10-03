extends RefCounted
## What every suite in this folder stands on: counting checks, comparing values deeply, and
## reading the golden vectors.
##
## The vectors in `data/` were produced by the web game's own TypeScript — every expected
## value in them is what that code computed, not what somebody thought it should. A suite's
## job is to show this build computes the same.

const DATA := "res://game/tests/data/"
## Enough to read a failure without drowning in the next four hundred like it.
const MAX_REPORTED := 12

var checks := 0
var failures: Array[String] = []


## Overridden by each suite.
func run() -> void:
	pass


func golden(file: String) -> Variant:
	var json := WebJson.new()
	if not json.parse(FileAccess.get_file_as_string(DATA + file + ".json")):
		fail("cannot read %s.json: %s" % [file, json.error])
		return {}
	return json.data


func fail(what: String) -> void:
	failures.append(what)


func check(ok: bool, what: String) -> bool:
	checks += 1
	if not ok:
		fail(what)
	return ok


## Deep equality. Whole numbers compare by value whether they arrived as int or float;
## dictionaries compare without regard to key order.
func same(got: Variant, want: Variant, what: String) -> bool:
	checks += 1
	var difference := diff(got, want)
	if difference != "":
		fail("%s: %s" % [what, difference])
	return difference == ""


## "" when equal, otherwise where and how the two differ.
static func diff(got: Variant, want: Variant, at: String = "") -> String:
	if _is_number(got) and _is_number(want):
		return "" if got == want else "%s got %s, want %s" % [at, WebNum.text(got), WebNum.text(want)]
	if got == null or want == null:
		return "" if got == null and want == null else "%s got %s, want %s" % [at, _show(got), _show(want)]
	if _is_text(got) and _is_text(want):
		return "" if String(got) == String(want) else "%s got %s, want %s" % [at, _near(got, want), _near(want, got)]
	if got is bool and want is bool:
		return "" if got == want else "%s got %s, want %s" % [at, got, want]
	if _is_list(got) and _is_list(want):
		if got.size() != want.size():
			return "%s got %d items, want %d: %s vs %s" % [at, got.size(), want.size(), _show(got), _show(want)]
		for i: int in got.size():
			var inner := diff(got[i], want[i], "%s[%d]" % [at, i])
			if inner != "":
				return inner
		return ""
	if got is Dictionary and want is Dictionary:
		for key: Variant in want:
			if not got.has(key):
				return "%s is missing %s" % [at, _show(key)]
		for key: Variant in got:
			if not want.has(key):
				return "%s has an extra %s" % [at, _show(key)]
			var inner := diff(got[key], want[key], "%s.%s" % [at, key])
			if inner != "":
				return inner
		return ""
	return "%s got %s, want %s" % [at, _show(got), _show(want)]


## A double from the sixteen hex digits of its bits.
static func double_of(hex: String) -> float:
	return WebNum.from_bits(bits_of_hex(hex))


static func bits_of_hex(hex: String) -> int:
	return (hex.substr(0, 8).hex_to_int() << 32) | hex.substr(8).hex_to_int()


static func _is_number(v: Variant) -> bool:
	return v is int or v is float


static func _is_text(v: Variant) -> bool:
	return v is String or v is StringName


static func _is_list(v: Variant) -> bool:
	var t := typeof(v)
	return t == TYPE_ARRAY or (t >= TYPE_PACKED_BYTE_ARRAY and t <= TYPE_PACKED_STRING_ARRAY)


## A long text, cut down to the neighbourhood of where it first parts from `other`.
static func _near(text: String, other: String) -> String:
	if text.length() <= 120:
		return WebJson.quote(text)
	var at := 0
	while at < text.length() and at < other.length() and text[at] == other[at]:
		at += 1
	return "…%s… (at %d)" % [WebJson.quote(text.substr(maxi(0, at - 40), 100)), at]


static func _show(v: Variant) -> String:
	var s := WebJson.stringify(v) if (v == null or v is bool or _is_number(v) or _is_text(v) or _is_list(v) or v is Dictionary) else str(v)
	return s if s.length() <= 200 else s.substr(0, 200) + "…"
