class_name WebJson
extends RefCounted
## JSON read and written exactly as a browser does it.
##
## The save file is shared with the web game, so the text has to match to the byte in both
## directions: integral numbers without a ".0", floats at their shortest exact spelling, keys
## in the order they were written, the same escapes in strings. The engine's own JSON class
## does none of the first two, and reads long fractions to the wrong double — `WebNum` holds
## the arithmetic.
##
##   var json := WebJson.new()
##   if json.parse(text): use(json.data) else: report(json.error)
##
## A number written without a fraction or exponent comes back as an int, anything else as a
## float; objects come back as Dictionaries in file order.

## Nesting past this is refused rather than recursed into.
const MAX_DEPTH := 64

var data: Variant = null
var error := ""

var _text := ""
var _at := 0
var _end := 0
var _failed := false


# ── Writing ─────────────────────────────────────────────────────────────────────────────

## `indent` empty packs everything onto one line; otherwise each level is indented by it.
static func stringify(value: Variant, indent: String = "") -> String:
	var out := PackedStringArray()
	_write(value, indent, "", out)
	return "".join(out)


static func _write(value: Variant, indent: String, pad: String, out: PackedStringArray) -> void:
	match typeof(value):
		TYPE_NIL:
			out.append("null")
		TYPE_BOOL:
			out.append("true" if value else "false")
		TYPE_INT:
			out.append(str(value))
		TYPE_FLOAT:
			out.append(WebNum.text(value) if is_finite(value) else "null")
		TYPE_STRING, TYPE_STRING_NAME:
			out.append(quote(str(value)))
		TYPE_DICTIONARY:
			var dict: Dictionary = value
			if dict.is_empty():
				out.append("{}")
				return
			var inner := pad + indent
			var first := true
			out.append("{")
			for key: Variant in dict:
				if not first:
					out.append(",")
				first = false
				if indent != "":
					out.append("\n" + inner)
				out.append(quote(str(key)))
				out.append(": " if indent != "" else ":")
				_write(dict[key], indent, inner, out)
			if indent != "":
				out.append("\n" + pad)
			out.append("}")
		_:
			if not _is_list(value):
				out.append("null")
				return
			var count: int = value.size()
			if count == 0:
				out.append("[]")
				return
			var inner := pad + indent
			out.append("[")
			for i in count:
				if i > 0:
					out.append(",")
				if indent != "":
					out.append("\n" + inner)
				_write(value[i], indent, inner, out)
			if indent != "":
				out.append("\n" + pad)
			out.append("]")


static func _is_list(value: Variant) -> bool:
	var t := typeof(value)
	return t == TYPE_ARRAY or (t >= TYPE_PACKED_BYTE_ARRAY and t <= TYPE_PACKED_STRING_ARRAY)


## A string literal: quotes, backslashes and control characters escaped, everything else raw.
static func quote(s: String) -> String:
	var out := PackedStringArray(['"'])
	var run := 0
	for i in s.length():
		var c := s.unicode_at(i)
		if c >= 32 and c != 34 and c != 92:
			continue
		if i > run:
			out.append(s.substr(run, i - run))
		run = i + 1
		match c:
			34: out.append('\\"')
			92: out.append("\\\\")
			8: out.append("\\b")
			12: out.append("\\f")
			10: out.append("\\n")
			13: out.append("\\r")
			9: out.append("\\t")
			_: out.append("\\u%04x" % c)
	if s.length() > run:
		out.append(s.substr(run))
	out.append('"')
	return "".join(out)


# ── Reading ─────────────────────────────────────────────────────────────────────────────

## True when `text` was one well-formed JSON value; the value is then in `data`. Strict in
## the ways a browser is: no trailing commas, no comments, no leading zeros.
func parse(text: String) -> bool:
	_text = text
	_at = 0
	_end = text.length()
	_failed = false
	error = ""
	data = null
	_skip_space()
	var value: Variant = _value(0)
	_skip_space()
	if not _failed and _at < _end:
		_fail("unexpected text after the value")
	if _failed:
		return false
	data = value
	return true


func _fail(what: String) -> Variant:
	if not _failed:
		_failed = true
		error = "%s at character %d" % [what, _at]
	return null


func _skip_space() -> void:
	while _at < _end:
		var c := _text.unicode_at(_at)
		if c != 32 and c != 10 and c != 13 and c != 9:
			return
		_at += 1


func _value(depth: int) -> Variant:
	if _at >= _end:
		return _fail("unexpected end of text")
	if depth > MAX_DEPTH:
		return _fail("nested too deeply")
	var c := _text.unicode_at(_at)
	match c:
		123:
			return _object(depth)
		91:
			return _array(depth)
		34:
			return _string()
		116:
			return _word("true", true)
		102:
			return _word("false", false)
		110:
			return _word("null", null)
	if c == 45 or (c >= 48 and c <= 57):
		return _number()
	return _fail("unexpected character")


func _word(word: String, value: Variant) -> Variant:
	if _text.substr(_at, word.length()) != word:
		return _fail("unexpected character")
	_at += word.length()
	return value


func _object(depth: int) -> Variant:
	var out := {}
	_at += 1
	_skip_space()
	if _at < _end and _text.unicode_at(_at) == 125:
		_at += 1
		return out
	while true:
		_skip_space()
		if _at >= _end or _text.unicode_at(_at) != 34:
			return _fail("expected a key")
		var key: Variant = _string()
		if _failed:
			return null
		_skip_space()
		if _at >= _end or _text.unicode_at(_at) != 58:
			return _fail("expected a colon")
		_at += 1
		_skip_space()
		var value: Variant = _value(depth + 1)
		if _failed:
			return null
		out[key] = value
		_skip_space()
		if _at >= _end:
			return _fail("unexpected end of text")
		var c := _text.unicode_at(_at)
		_at += 1
		if c == 125:
			return out
		if c != 44:
			_at -= 1
			return _fail("expected a comma")
	return null


func _array(depth: int) -> Variant:
	var out := []
	_at += 1
	_skip_space()
	if _at < _end and _text.unicode_at(_at) == 93:
		_at += 1
		return out
	while true:
		_skip_space()
		var value: Variant = _value(depth + 1)
		if _failed:
			return null
		out.append(value)
		_skip_space()
		if _at >= _end:
			return _fail("unexpected end of text")
		var c := _text.unicode_at(_at)
		_at += 1
		if c == 93:
			return out
		if c != 44:
			_at -= 1
			return _fail("expected a comma")
	return null


func _string() -> Variant:
	_at += 1
	var out := PackedStringArray()
	var run := _at
	while _at < _end:
		var c := _text.unicode_at(_at)
		if c == 34:
			out.append(_text.substr(run, _at - run))
			_at += 1
			return "".join(out)
		if c < 32:
			return _fail("control character in a string")
		if c != 92:
			_at += 1
			continue
		out.append(_text.substr(run, _at - run))
		_at += 1
		if _at >= _end:
			break
		var esc := _text.unicode_at(_at)
		_at += 1
		match esc:
			34: out.append('"')
			92: out.append("\\")
			47: out.append("/")
			98: out.append("\b")
			102: out.append("\f")
			110: out.append("\n")
			114: out.append("\r")
			116: out.append("\t")
			117:
				var unit := _hex4()
				if _failed:
					return null
				# A surrogate pair is one character here; half of one has no character at all.
				if unit >= 0xD800 and unit <= 0xDBFF and _text.substr(_at, 2) == "\\u":
					var mark := _at
					_at += 2
					var low := _hex4()
					if _failed:
						return null
					if low >= 0xDC00 and low <= 0xDFFF:
						unit = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)
					else:
						_at = mark
				if unit >= 0xD800 and unit <= 0xDFFF:
					unit = 0xFFFD
				out.append(String.chr(unit) if unit != 0 else "")
			_:
				_at -= 1
				return _fail("bad escape")
		run = _at
	return _fail("unterminated string")


func _hex4() -> int:
	var hex := _text.substr(_at, 4)
	if hex.length() != 4 or not hex.is_valid_hex_number():
		_fail("bad unicode escape")
		return 0
	_at += 4
	return hex.hex_to_int()


func _digits() -> int:
	var start := _at
	while _at < _end:
		var c := _text.unicode_at(_at)
		if c < 48 or c > 57:
			break
		_at += 1
	return _at - start


func _number() -> Variant:
	var start := _at
	var integral := true
	if _text.unicode_at(_at) == 45:
		_at += 1
	var lead := _at
	var whole := _digits()
	if whole == 0:
		return _fail("expected a digit")
	if whole > 1 and _text.unicode_at(lead) == 48:
		_at = lead + 1
		return _fail("leading zero")
	if _at < _end and _text.unicode_at(_at) == 46:
		integral = false
		_at += 1
		if _digits() == 0:
			return _fail("expected a digit")
	if _at < _end and (_text.unicode_at(_at) == 101 or _text.unicode_at(_at) == 69):
		integral = false
		_at += 1
		if _at < _end and (_text.unicode_at(_at) == 43 or _text.unicode_at(_at) == 45):
			_at += 1
		if _digits() == 0:
			return _fail("expected a digit")
	var token := _text.substr(start, _at - start)
	if integral and whole <= 15:
		return token.to_int()
	return WebNum.parse(token)
