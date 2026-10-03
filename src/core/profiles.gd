class_name Profiles
extends RefCounted
## Driver pin profiles.
##
## There is no special case for spools, serrated pins or mushrooms. Every driver is a stack of
## bands along its length, each full diameter or reduced, and the physics body is cut to exactly
## that outline — what a profile *does* under the pick comes from its shape meeting the plug and
## the shell, not from a rule about its name.
##
## A band is [length_mm, reduced, taper, groove_depth]:
##   taper        0 = square shoulder, 1 = fully bevelled
##   groove_depth fraction of the pin's radius removed, 0..1

const DRIVER_LENGTH := 4.5
## Clearance a chamber needs above the highest groove so it starts on a full band.
const GROOVE_CLEARANCE := 0.15

const NAMES: Array[String] = [
	"standard", "spool", "spool-slim", "spool-deep", "spool-double", "serrated", "mushroom", "t-pin",
]

static var _bands: Dictionary = {}


static func _full(length: float) -> Array:
	return [length, false, 0.0, 0.0]


static func _groove(length: float, taper: float, depth: float) -> Array:
	return [length, true, taper, depth]


static func _build() -> void:
	var serrated: Array = [_full(0.25)]
	for i in 4:
		serrated.append(_groove(0.18, 0.1, 0.12))
		serrated.append(_full(0.22))
	serrated.append(_full(2.65))
	_bands = {
		"standard": [_full(4.5)],
		"spool": [_full(0.45), _groove(0.95, 0.15, 0.3), _full(3.1)],
		# A narrow waist: a brief lie, easy to walk past.
		"spool-slim": [_full(0.62), _groove(0.38, 0.1, 0.24), _full(3.5)],
		# A deep waist — a long, convincing lie.
		"spool-deep": [_full(0.5), _groove(1.1, 0.34, 0.44), _full(2.9)],
		# Two waists: it lies, you push through, it lies again.
		"spool-double": [
			_full(0.4), _groove(0.55, 0.14, 0.27), _full(0.4), _groove(0.55, 0.14, 0.27), _full(2.6),
		],
		"serrated": serrated,
		# A mushroom and a T-pin start at the bottom: a stem flaring into a head. What separates
		# them is the bevel — a mushroom is a cone (it drags and slides), a T-pin is square (it
		# catches and walls).
		"mushroom": [_full(0.12), _groove(1.38, 0.85, 0.28), _full(3.0)],
		"t-pin": [_full(0.1), _groove(1.5, 0.0, 0.44), _full(2.9)],
	}


static func bands(name: String) -> Array:
	if _bands.is_empty():
		_build()
	return _bands.get(name, _bands["standard"])


static func exists(name: String) -> bool:
	if _bands.is_empty():
		_build()
	return _bands.has(name)


## True for anything that can tell a lie — a driver whose groove produces a false set.
static func is_security(name: String) -> bool:
	return groove_count(name) > 0


static func groove_count(name: String) -> int:
	var n := 0
	for b in bands(name):
		if b[1]:
			n += 1
	return n


static func max_groove_depth(name: String) -> float:
	var d := 0.0
	for b in bands(name):
		if b[1]:
			d = maxf(d, b[3])
	return d


## Depth, measured up from the driver's bottom, of the top of the highest groove.
static func highest_groove_top(name: String) -> float:
	var cursor := 0.0
	var top := 0.0
	for b in bands(name):
		cursor += b[0]
		if b[1]:
			top = cursor
	return top


## Minimum set lift for a chamber carrying this profile: only the bottom `set_lift` millimetres
## of a driver ever cross the shear line, so a groove above that could never lie.
static func minimum_set_lift(name: String) -> float:
	var top := highest_groove_top(name)
	return top + GROOVE_CLEARANCE if top > 0.0 else 0.0


## Groove spans measured up from the driver's bottom, mm: [[from, to], ...], ramps included.
static func grooves(name: String) -> Array:
	var out: Array = []
	var cursor := 0.0
	for b in bands(name):
		if b[1]:
			out.append([cursor, cursor + b[0]])
		cursor += b[0]
	return out


## The right-hand silhouette of a driver of radius `radius`, bottom to top: [u, half_width]
## pairs with u measured from the pin's centre. Band for band, nothing invented — each groove's
## shoulder slopes over `taper x depth / 2`, which is what makes a mushroom cam and a T-pin wall.
static func silhouette(name: String, radius: float, bevel: float) -> Array[Vector2]:
	var half := DRIVER_LENGTH / 2.0
	var pts: Array[Vector2] = [Vector2(-half, radius - bevel), Vector2(-half + bevel, radius)]
	var u := -half
	for b in bands(name):
		var u0 := u
		var u1: float = u + b[0]
		if b[1]:
			var groove: float = radius * (1.0 - b[3])
			var depth := radius - groove
			var ramp: float = maxf(0.02, minf(b[2] * depth * 0.5, b[0] / 2.0 - 0.01))
			pts.append(Vector2(u0, radius))
			pts.append(Vector2(u0 + ramp, groove))
			pts.append(Vector2(u1 - ramp, groove))
			pts.append(Vector2(u1, radius))
		u = u1
	pts.append(Vector2(half - bevel, radius))
	pts.append(Vector2(half, radius - bevel))
	# Drop points that repeat or run backwards past their neighbour (a groove that starts inside
	# the bottom bevel).
	var out: Array[Vector2] = []
	for p in pts:
		if out.is_empty() or p.x > out[-1].x + 1e-9 or absf(p.y - out[-1].y) > 1e-9:
			if not out.is_empty() and p.x < out[-1].x:
				continue
			out.append(p)
	return out
