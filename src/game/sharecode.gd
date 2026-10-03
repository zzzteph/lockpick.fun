class_name ShareCode
extends RefCounted
## Share codes — a lock you built, as a string you can paste to somebody.
##
## An editor whose output can only exist in the save that made it is a toy. This is what turns
## it into a feature: a lock definition packed into a short, typo-resistant, all-caps string
## that anyone can paste back in and pick — in this build or the web one, which read each
## other's codes.
##
## Field-packed rather than encoded JSON: two characters per chamber plus a four-character
## header and a checksum, so a five-pin lock is fifteen characters — short enough to read out.
## It also cannot express a malformed lock: every field is clamped on the way out and
## range-checked on the way in.
##
## Layout, one character each:
##   0      format version
##   1      chamber count
##   2      tolerance, in steps of 0.05 above 0.40
##   3      keyway (0 standard, 1 tight)
##   4..    two per chamber: depth in tenths of a mm above 1.0, then pin x 4 + spring
##   last   checksum over everything before it
##
## The checksum is what makes a truncated or mistyped code *fail* rather than quietly decode
## to a different lock — the failure that would actually hurt, because a wrong lock still
## picks, and the player would never know they were not playing what they were sent.

## Crockford base32: no I, L, O or U, so no character can be mistaken for another, and lower
## case reads the same as upper.
const ALPHABET := "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const VERSION := 1
## The shortest string that could be a code: header, one chamber, checksum.
const MIN_LENGTH := 7
## The longest a code gets as typed — sixteen chambers is 37 characters, and grouped in fours
## that is nine hyphens more.
const MAX_ENTRY := 46

## Half the format's own grid: the most a value can move in a code and still be the same value.
const _DEPTH_SLOP := 0.05 + 1e-9
const _TOLERANCE_SLOP := 0.025 + 1e-9

## Character -> value, built on first use.
static var _values: Dictionary = {}

## What reading a code produced: a lock the game will accept, or a sentence saying why not.
## Never a half-built lock — the caller is a paste box, and a paste box gets given rubbish.
class Decoded:
	extends RefCounted
	var def: Dictionary = {}
	var problem := ""

	func ok() -> bool:
		return problem == ""


# ── Writing ─────────────────────────────────────────────────────────────────────────────

## Pack a lock into a code. Total: it packs anything, clamping as it goes — which is right for
## a draft out of the editor and a lie for anything else. Ask `problem_for` first when the
## lock did not come from the editor.
static func encode(def: Dictionary) -> String:
	var bitting: Array = def.get("bitting", [])
	var pins: Array = def.get("pins", [])
	var springs: Variant = def.get("springs")
	var body := _enc(VERSION) + _enc(bitting.size())
	body += _enc(WebNum.round_half_up((float(def.get("toleranceQuality", 1.0)) - 0.4) / 0.05))
	body += _enc(1 if def.get("keyway") == "tight" else 0)
	for i in bitting.size():
		var pin := maxi(0, EditorModel.EDITABLE_PINS.find(pins[i] if i < pins.size() else "standard"))
		var strength: float = springs[i] if springs is Array and i < springs.size() else 1.0
		body += _enc(WebNum.round_half_up((float(bitting[i]) - 1.0) * 10.0))
		body += _enc(pin * 4 + EditorModel.nearest_spring(strength))
	return body + _checksum(body)


## Grouped in fours, which is how anybody reads a code aloud without losing their place.
static func format(code: String) -> String:
	var groups := PackedStringArray()
	for at in range(0, code.length(), 4):
		groups.append(code.substr(at, 4))
	return "-".join(groups) if not groups.is_empty() else code


## Why this lock has no code, or "" when it has one.
##
## `encode` packs anything, so the test is not "did it encode" but "does the lock come back":
## encode, decode, compare. A wheel pack has no bitting at all, and a pin the editor does not
## offer would pack as a standard one — a *different lock that still picks*.
##
## Rounding is not a difference. One digit is a tenth of a millimetre of bitting and a
## twentieth of tolerance, and nothing a hand can feel sits between two grid points. What
## must survive exactly is everything categorical: the family, the chamber count, the pin in
## every chamber, the keyway. Those change what the lock *is*.
static func problem_for(def: Dictionary) -> String:
	var family := str(def.get("family", ""))
	if family != "pin-tumbler":
		return "a %s has no bitting to pack" % family
	var bitting: Array = def["bitting"]
	var pins: Array = def["pins"]
	if bitting.size() < LockDefs.MIN_CHAMBERS or bitting.size() > LockDefs.MAX_CHAMBERS:
		return "%d chambers is outside what a code carries" % bitting.size()
	if pins.size() != bitting.size():
		return "its pins and its bitting disagree"
	var back := _unpack(encode(def), 0)
	if not back.ok():
		return back.problem
	for i in pins.size():
		if back.def["pins"][i] != pins[i]:
			return "the editor has no %s pin to put in chamber %d" % [pins[i], i + 1]
	for i in bitting.size():
		if absf(back.def["bitting"][i] - bitting[i]) > _DEPTH_SLOP:
			return "chamber %d is cut past a code's range" % (i + 1)
	if absf(back.def["toleranceQuality"] - def["toleranceQuality"]) > _TOLERANCE_SLOP:
		return "its tolerance is outside the range a code can reach"
	if back.def["keyway"] != def["keyway"]:
		return "its keyway does not survive the trip"
	# A cut sitting right at its driver's limit can round a tenth too deep, and the lock that
	# came back would no longer be one the game can build.
	if not LockDefs.is_valid(back.def):
		return "its cuts do not survive a code's rounding"
	return ""


## This lock's code, or "" — see `problem_for` for which locks have none, and why.
static func code_for(def: Dictionary) -> String:
	return encode(def) if problem_for(def) == "" else ""


# ── Reading ─────────────────────────────────────────────────────────────────────────────

## Read a code back into a lock. `index` is how many custom locks the save already holds,
## which keeps the new lock's id clear of them.
static func decode(code: String, index: int = 0) -> Decoded:
	var out := _unpack(code, index)
	# Well-formed is not the same as buildable: the fields are each in range, but a deep cut
	# under a long-grooved driver is a combination the validator refuses.
	if out.ok() and not LockDefs.is_valid(out.def):
		out.def = {}
		out.problem = "that code describes a lock this game cannot build"
	return out


## The fields of a code, unpacked and range-checked, without asking whether they add up to a
## lock.
static func _unpack(code: String, index: int) -> Decoded:
	var out := Decoded.new()
	var raw := _strip(code).to_upper()
	if raw.length() < MIN_LENGTH:
		out.problem = "that code is too short to be a lock"
		return out
	for i in raw.length():
		if _dec(raw[i]) < 0:
			out.problem = '"%s" is not a character a code can contain' % raw[i]
			return out
	var body := raw.substr(0, raw.length() - 1)
	if _checksum(body) != raw[raw.length() - 1]:
		out.problem = "that code did not check out — a character is wrong or missing"
		return out
	if _dec(body[0]) != VERSION:
		out.problem = "that code was made by a different version of the game"
		return out

	var count := _dec(body[1])
	if count < LockDefs.MIN_CHAMBERS or count > LockDefs.MAX_CHAMBERS:
		out.problem = "%d chambers is not a lock this game can build" % count
		return out
	if body.length() != 4 + count * 2:
		out.problem = "that code is the wrong length for the lock it describes"
		return out

	var bitting: Array = []
	var pins: Array = []
	var springs: Array = []
	for i in count:
		var at := 4 + i * 2
		bitting.append((10 + _dec(body[at])) / 10.0)
		var packed := _dec(body[at + 1])
		var pin := packed / 4
		if pin >= EditorModel.EDITABLE_PINS.size() or not Profiles.exists(EditorModel.EDITABLE_PINS[pin]):
			out.problem = "chamber %d names a pin this game does not have" % (i + 1)
			return out
		pins.append(EditorModel.EDITABLE_PINS[pin])
		var spring := packed % 4
		springs.append(EditorModel.SPRING_VALUES[spring] if spring < EditorModel.SPRING_VALUES.size() else 1.0)

	var id := EditorModel.CUSTOM_ID_BASE + index
	var lock_name := "Shared Lock " + raw.substr(0, 4)
	out.def = {
		"id": id,
		"slug": EditorModel.slug_for(lock_name, id),
		"name": lock_name,
		"tier": 1,
		"family": "pin-tumbler",
		"bitting": bitting,
		"pins": pins,
		"springs": springs,
		"toleranceQuality": (40 + 5 * _dec(body[2])) / 100.0,
		"keyway": "tight" if _dec(body[3]) == 1 else "standard",
		"par": maxi(20, count * 18),
		"note": "Sent to you by somebody else.",
	}
	return out


## What a typed code may hold: the alphabet's own characters, upper-cased, and the grouping
## hyphen — anything else `decode` would refuse, and refusing it at the keystroke is kinder.
static func clean_entry(text: String) -> String:
	var out := ""
	for i in text.length():
		var c := text.unicode_at(i)
		if c >= 97 and c <= 122:
			c -= 32
		if (c >= 65 and c <= 90) or (c >= 48 and c <= 57) or c == 45:
			out += String.chr(c)
	return out.substr(0, MAX_ENTRY)


# ── The alphabet ────────────────────────────────────────────────────────────────────────

static func _enc(value: int) -> String:
	return ALPHABET[clampi(value, 0, 31)]


## A character's value, or -1. The alphabet's own substitutions apply, so a hand-typed I, L,
## O or U still reads.
static func _dec(ch: String) -> int:
	if _values.is_empty():
		for i in ALPHABET.length():
			_values[ALPHABET[i]] = i
			_values[ALPHABET[i].to_lower()] = i
		for pair: Array in [["I", 1], ["L", 1], ["O", 0], ["U", ALPHABET.find("V")]]:
			_values[pair[0]] = pair[1]
			_values[pair[0].to_lower()] = pair[1]
	return _values.get(ch, -1)


static func _checksum(body: String) -> String:
	var h := 7
	for i in body.length():
		h = (h * 31 + maxi(0, _dec(body[i]))) % 32
	return _enc(h)


## A code with the spaces and grouping hyphens taken out, however it was typed or pasted.
static func _strip(code: String) -> String:
	var out := ""
	for i in code.length():
		var c := code.unicode_at(i)
		if c == 45 or _is_space(c):
			continue
		out += code[i]
	return out


static func _is_space(c: int) -> bool:
	return (c >= 9 and c <= 13) or c == 32 or c == 0xA0 or c == 0x1680 or (c >= 0x2000 and c <= 0x200A) \
		or c == 0x2028 or c == 0x2029 or c == 0x202F or c == 0x205F or c == 0x3000 or c == 0xFEFF
