class_name Rng
extends RefCounted
## Seeded PRNG — xorshift128, seeded through splitmix32.
##
## Bit-for-bit the web game's generator, so a seed deals the same lock here as it did there.
## Everything stochastic in the game draws from one of these; nothing calls randf().

const MASK := 0xFFFFFFFF

var a: int
var b: int
var c: int
var d: int


static func create(seed_value: int) -> Rng:
	var r := Rng.new()
	var s := seed_value & MASK
	var out: Array[int] = []
	for i in 4:
		s = (s + 0x9E3779B9) & MASK
		var t := s ^ (s >> 16)
		t = (t * 0x21F0AAAD) & MASK
		t = t ^ (t >> 15)
		t = (t * 0x735A2D97) & MASK
		out.append((t ^ (t >> 15)) & MASK)
	r.a = out[0]
	r.b = out[1]
	r.c = out[2]
	r.d = out[3]
	# xorshift128 degenerates on an all-zero state.
	if (r.a | r.b | r.c | r.d) == 0:
		r.a = 0x9E3779B9
	return r


func clone() -> Rng:
	var r := Rng.new()
	r.a = a
	r.b = b
	r.c = c
	r.d = d
	return r


## Next 32-bit unsigned integer.
func next_u32() -> int:
	var t := a
	t = (t ^ (t << 11)) & MASK
	t = t ^ (t >> 8)
	a = b
	b = c
	c = d
	var x := d
	x = x ^ (x >> 19)
	x = x ^ t
	d = x & MASK
	return d


## Uniform in [0, 1).
func next_float() -> float:
	return float(next_u32()) / 4294967296.0


## Uniform in [lo, hi).
func next_range(lo: float, hi: float) -> float:
	return lo + (hi - lo) * next_float()


## Uniform in [-mag, +mag].
func next_signed(mag: float) -> float:
	return (next_float() * 2.0 - 1.0) * mag


## Uniform integer in [0, n).
func next_int(n: int) -> int:
	return int(floor(next_float() * n))


## In-place Fisher-Yates.
func shuffle(items: Array) -> Array:
	var i := items.size() - 1
	while i > 0:
		var j := next_int(i + 1)
		var tmp = items[i]
		items[i] = items[j]
		items[j] = tmp
		i -= 1
	return items


func pick(items: Array):
	return items[next_int(items.size())]
