class_name WebNum
extends RefCounted
## Numbers the way the web game reads, writes and rounds them.
##
## A save, a share code and a dealt lock have to come out identical on both builds, and that
## rests on a handful of number behaviours the engine does not share with a browser:
##  - a float prints as the *shortest* decimal that reads back to the same double, and an
##    integral one prints without a trailing ".0";
##  - a decimal reads as the *nearest* double — the engine's own parser can land thousands of
##    ulps away on a long fraction, which would quietly change every best time it imported;
##  - `round` sends a half toward +infinity rather than away from zero, and a fixed-decimals
##    rounding looks at the exact binary value, not at the digits a print would show.
##
## The exact paths run on small big-integers. They are slow by engine standards and it does
## not matter: the common cases — integers, short decimals — never reach them, and the rest is
## a few hundred numbers when a save is read or written.

const MASK32 := 0xFFFFFFFF

const _TWO52 := 1 << 52
const _TWO53 := 1 << 53
const _TWO54 := 1 << 54
## Big-integer limbs are base 10^9, little end first: decimal output is then a join, and
## every multiply or divide by a 31-bit factor stays inside a 64-bit int.
const _LIMB := 1000000000
const _POW2_CHUNK := 30
const _POW5_CHUNK := 13
const _POW5_13 := 1220703125
const _LOG2_10 := 3.321928094887362
## Every power of ten a double holds exactly.
const _POW10: Array[float] = [
	1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11,
	1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
]


# ── Integers ────────────────────────────────────────────────────────────────────────────

## The low 32 bits of a product of two 32-bit values, unsigned. Split so the intermediate
## never leaves 64 bits, whatever the operands.
static func imul(a: int, b: int) -> int:
	a &= MASK32
	b &= MASK32
	return ((a * (b & 0xFFFF)) + (((a * (b >> 16)) & 0xFFFF) << 16)) & MASK32


## True for an int, and for a float holding a whole number.
static func is_integer(value: Variant) -> bool:
	if value is int:
		return true
	return value is float and is_finite(value) and floorf(value) == value


## True for an int or a float — never a bool, which a lock or a save may not pass off as one.
static func is_number(value: Variant) -> bool:
	return value is int or value is float


# ── Rounding ────────────────────────────────────────────────────────────────────────────

## Nearest integer, halves toward +infinity: 2.5 -> 3, -2.5 -> -2.
static func round_half_up(x: float) -> int:
	var f := floorf(x)
	return int(f) + 1 if x - f >= 0.5 else int(f)


## `x` with exactly `decimals` digits after the point, rounded on its exact binary value —
## 1.005 is a hair under and prints "1.00".
static func to_fixed(x: float, decimals: int) -> String:
	if is_nan(x):
		return "NaN"
	var a := absf(x)
	if is_inf(a) or a >= 1e21:
		return text(x)
	var sign := "-" if x < 0.0 else ""
	var whole := ""
	var scaled := a * _POW10[decimals] if decimals <= 22 else INF
	if scaled < 1e9 and absf(scaled - floorf(scaled) - 0.5) > 1e-6:
		# Nowhere near a tie, so the float product cannot have crossed one.
		whole = str(int(floorf(scaled + 0.5)))
	elif a == 0.0:
		whole = "0"
	else:
		var exact := _expand(a)
		var digits: String = exact[0]
		var keep: int = exact[1] + decimals
		if keep < 0:
			whole = "0"
		else:
			whole = digits.substr(0, keep) if keep > 0 else "0"
			if digits.length() < keep:
				whole += "0".repeat(keep - digits.length())
			elif digits.length() > keep and digits.unicode_at(keep) >= 53:
				whole = _bump(whole)
	if decimals <= 0:
		return sign + whole
	whole = whole.pad_zeros(decimals + 1)
	return sign + whole.substr(0, whole.length() - decimals) + "." + whole.substr(whole.length() - decimals)


## The nearest double to `x` rounded to `decimals` places.
static func fixed(x: float, decimals: int) -> float:
	return parse(to_fixed(x, decimals))


# ── Text ────────────────────────────────────────────────────────────────────────────────

## A number as a browser prints it: the shortest digits that read back to the same double,
## no trailing ".0", exponent form only past 10^21 or below 10^-6.
static func text(value: Variant) -> String:
	if value is int:
		return str(value)
	var x: float = value
	if is_nan(x):
		return "NaN"
	if is_inf(x):
		return "Infinity" if x > 0.0 else "-Infinity"
	if x == 0.0:
		return "0"
	var sign := "-" if x < 0.0 else ""
	var a := absf(x)
	if a < 9007199254740992.0 and a == floorf(a):
		return sign + str(int(a))
	var exact := _expand(a)
	var short := _shortest(a, exact[0], exact[1])
	return sign + _layout(short[0], short[1])


## A decimal literal as the nearest double, ties to even. Anything a JSON number can spell,
## plus a leading "+", a bare ".5" and a trailing "5.".
static func parse(literal: String) -> float:
	var s := literal.strip_edges()
	var negative := s.begins_with("-")
	if negative or s.begins_with("+"):
		s = s.substr(1)
	var exponent := 0
	var e_at := s.findn("e")
	if e_at >= 0:
		exponent = _small_int(s.substr(e_at + 1))
		s = s.substr(0, e_at)
	var dot := s.find(".")
	var whole := s if dot < 0 else s.substr(0, dot)
	var all := whole if dot < 0 else whole + s.substr(dot + 1)
	var digits := all.lstrip("0")
	var point := whole.length() + exponent - (all.length() - digits.length())
	digits = digits.rstrip("0")
	if digits.is_empty():
		# Negated at run time: the two zeros fold into one constant otherwise.
		var zero := 0.0
		return -zero if negative else zero
	var v := _to_double(digits, point)
	return -v if negative else v


## A signed exponent, clamped: past a few hundred the answer is 0 or infinity either way.
static func _small_int(s: String) -> int:
	var negative := s.begins_with("-")
	if negative or s.begins_with("+"):
		s = s.substr(1)
	var n := 999999 if s.length() > 6 else s.to_int()
	return -n if negative else n


## Digits and point (value = 0.digits x 10^point) laid out as a browser would.
static func _layout(digits: String, point: int) -> String:
	var k := digits.length()
	if k <= point and point <= 21:
		return digits + "0".repeat(point - k)
	if point > 0 and point <= 21:
		return digits.substr(0, point) + "." + digits.substr(point)
	if point > -6 and point <= 0:
		return "0." + "0".repeat(-point) + digits
	var e := point - 1
	var mantissa := digits.substr(0, 1) + ("." + digits.substr(1) if k > 1 else "")
	return mantissa + ("e+" if e >= 0 else "e-") + str(absi(e))


## The fewest digits that still read back as `a`; where two candidates of that length do,
## the nearer one.
static func _shortest(a: float, digits: String, point: int) -> Array:
	for p in range(1, 18):
		if digits.length() <= p:
			return [digits, point]
		var below := digits.substr(0, p)
		var above := _bump(below)
		var above_point := point + (above.length() - p)
		var below_trim := below.rstrip("0")
		var above_trim := above.rstrip("0")
		var below_ok := _to_double(below_trim, point) == a
		var above_ok := _to_double(above_trim, above_point) == a
		if below_ok and above_ok:
			var next := digits.unicode_at(p)
			var up := next > 53 or (next == 53 and digits.length() > p + 1)
			if next == 53 and digits.length() == p + 1:
				up = (below.unicode_at(p - 1) - 48) % 2 == 1
			return [above_trim, above_point] if up else [below_trim, point]
		if below_ok:
			return [below_trim, point]
		if above_ok:
			return [above_trim, above_point]
	return [digits.substr(0, 17), point]


## A decimal digit string plus one.
static func _bump(digits: String) -> String:
	var out := digits.to_utf8_buffer()
	var i := out.size() - 1
	while i >= 0:
		if out[i] < 57:
			out[i] += 1
			return out.get_string_from_utf8()
		out[i] = 48
		i -= 1
	return "1" + out.get_string_from_utf8()


# ── Exact conversion ────────────────────────────────────────────────────────────────────

static func bits_of(x: float) -> int:
	var b := PackedByteArray()
	b.resize(8)
	b.encode_double(0, x)
	return b.decode_s64(0)


static func from_bits(bits: int) -> float:
	var b := PackedByteArray()
	b.resize(8)
	b.encode_s64(0, bits)
	return b.decode_double(0)


## 0.digits x 10^point as the nearest double. `digits` carries no leading or trailing zero.
static func _to_double(digits: String, point: int) -> float:
	var k := point - digits.length()
	if digits.length() <= 15 and absi(k) <= 22:
		# Both operands exact, one correctly rounded operation: the result is the nearest.
		var m := float(digits.to_int())
		return m * _POW10[k] if k >= 0 else m / _POW10[-k]
	return _exact_double(digits, k)


## digits x 10^k as the nearest double, by exact integer arithmetic: scale the value by a
## power of two until its integer part holds 54 bits — 53 of mantissa and the rounding bit —
## and carry whether anything was left below that.
static func _exact_double(digits: String, k: int) -> float:
	if digits.length() > 800:
		# Past any double's exact expansion the tail only says "and a bit more".
		k += digits.length() - 800
		digits = digits.substr(0, 800) + "1"
		k -= 1
	var magnitude := digits.length() + k
	if magnitude > 310:
		return INF
	if magnitude < -326:
		return 0.0
	var lead := digits.substr(0, 15)
	var log2v := log(float(lead.to_int())) / log(2.0) + float(digits.length() - lead.length() + k) * _LOG2_10
	var e := int(floorf(log2v)) + 1
	for attempt in 8:
		var t := mini(54 - e, 1075)
		var big := _big_from_digits(digits)
		var sticky := false
		if k > 0:
			_big_mul_pow(big, _LIMB, 9, 10, k)
		if t > 0:
			_big_mul_pow(big, 1 << _POW2_CHUNK, _POW2_CHUNK, 2, t)
		if k < 0:
			sticky = _big_div_pow(big, _LIMB, 9, 10, -k) or sticky
		if t < 0:
			sticky = _big_div_pow(big, 1 << _POW2_CHUNK, _POW2_CHUNK, 2, -t) or sticky
		if big.size() > 2:
			e += 1
			continue
		var q := _big_to_int(big)
		if q >= _TWO54:
			e += 1
			continue
		if q < _TWO53 and t < 1075:
			e -= 1
			continue
		var mantissa := q >> 1
		if (q & 1) == 1 and (sticky or (mantissa & 1) == 1):
			mantissa += 1
		return _compose(mantissa, 1 - t)
	return (digits + "e" + str(k)).to_float()


## mantissa x 2^exponent as a double, where the mantissa is already rounded to fit.
static func _compose(mantissa: int, exponent: int) -> float:
	if mantissa == 0:
		return 0.0
	if mantissa == _TWO53:
		mantissa = _TWO52
		exponent += 1
	if mantissa < _TWO52:
		return from_bits(mantissa)
	var biased := exponent + 52 + 1023
	if biased >= 2047:
		return INF
	return from_bits((biased << 52) | (mantissa & (_TWO52 - 1)))


## Every decimal digit of a positive double, exactly: [digits, point] with the value being
## 0.digits x 10^point and no trailing zero.
static func _expand(a: float) -> Array:
	var bits := bits_of(a)
	var biased := (bits >> 52) & 0x7FF
	var m := bits & (_TWO52 - 1)
	var e := -1074
	if biased != 0:
		m |= _TWO52
		e = biased - 1075
	while (m & 1) == 0:
		m >>= 1
		e += 1
	var big := _big_from_int(m)
	var digits: String
	var point: int
	if e >= 0:
		_big_mul_pow(big, 1 << _POW2_CHUNK, _POW2_CHUNK, 2, e)
		digits = _big_to_digits(big)
		point = digits.length()
	else:
		# m / 2^n is m x 5^n / 10^n: the digits of an integer, with the point moved.
		_big_mul_pow(big, _POW5_13, _POW5_CHUNK, 5, -e)
		digits = _big_to_digits(big)
		point = digits.length() + e
	return [digits.rstrip("0"), point]


# ── Big integers, just enough of them ───────────────────────────────────────────────────

static func _big_from_int(value: int) -> PackedInt64Array:
	var out := PackedInt64Array()
	while value > 0:
		out.append(value % _LIMB)
		value /= _LIMB
	return out


static func _big_from_digits(digits: String) -> PackedInt64Array:
	var out := PackedInt64Array()
	var end := digits.length()
	while end > 0:
		var start := maxi(0, end - 9)
		out.append(digits.substr(start, end - start).to_int())
		end = start
	while out.size() > 0 and out[out.size() - 1] == 0:
		out.remove_at(out.size() - 1)
	return out


static func _big_to_int(big: PackedInt64Array) -> int:
	var v := 0
	for i in range(big.size() - 1, -1, -1):
		v = v * _LIMB + big[i]
	return v


static func _big_to_digits(big: PackedInt64Array) -> String:
	if big.is_empty():
		return "0"
	var parts := PackedStringArray()
	for i in range(big.size() - 1, -1, -1):
		parts.append(str(big[i]) if i == big.size() - 1 else str(big[i]).pad_zeros(9))
	return "".join(parts)


static func _big_mul(big: PackedInt64Array, factor: int) -> void:
	var carry := 0
	for i in big.size():
		var v := big[i] * factor + carry
		big[i] = v % _LIMB
		carry = v / _LIMB
	while carry > 0:
		big.append(carry % _LIMB)
		carry /= _LIMB


## Divide in place, returning the remainder.
static func _big_div(big: PackedInt64Array, divisor: int) -> int:
	var rem := 0
	for i in range(big.size() - 1, -1, -1):
		var v := rem * _LIMB + big[i]
		big[i] = v / divisor
		rem = v % divisor
	while big.size() > 0 and big[big.size() - 1] == 0:
		big.remove_at(big.size() - 1)
	return rem


## Multiply by base^count, `chunk_power` powers at a time (`chunk` is base^chunk_power).
static func _big_mul_pow(big: PackedInt64Array, chunk: int, chunk_power: int, base: int, count: int) -> void:
	while count >= chunk_power:
		_big_mul(big, chunk)
		count -= chunk_power
	if count > 0:
		var rest := 1
		for i in count:
			rest *= base
		_big_mul(big, rest)


## Floor-divide by base^count; true when anything was thrown away.
static func _big_div_pow(big: PackedInt64Array, chunk: int, chunk_power: int, base: int, count: int) -> bool:
	var lost := false
	while count >= chunk_power:
		lost = _big_div(big, chunk) != 0 or lost
		count -= chunk_power
	if count > 0:
		var rest := 1
		for i in count:
			rest *= base
		lost = _big_div(big, rest) != 0 or lost
	return lost
