class_name LockDefs
extends RefCounted
## What makes a lock definition a lock.
##
## A definition is authored data — the roster's, a player's own design, a share code read back,
## a lock dealt by the blitz — and all four arrive as the same Dictionary. `validate` is the one
## judge of whether it can be built: it refuses a malformed lock with a sentence naming the
## problem, rather than letting it through to become a lock nobody can open.
##
## Three families ship: pin tumblers (optionally with a sidebar), combination wheel packs and
## disc detainers.

const FAMILIES: Array[String] = ["pin-tumbler", "combination", "disc-detainer"]

const MIN_CHAMBERS := 1
const MAX_CHAMBERS := 16
const MAX_TIER := 6

# ── Pin-tumbler geometry, mm ────────────────────────────────────────────────────────────
## Where the bottom of a key pin rests with nothing in the lock.
const KEYWAY_FLOOR := -5.0
## A key pin must sit below the shear line at rest…
const MAX_KEY_PIN := 5.0
## …and the stack must straddle it: K + D > 5.
const MIN_STACK_HEIGHT := 5.0
const DRIVER_LENGTH := Profiles.DRIVER_LENGTH
## How much lift a chamber forgives at tolerance 1.0. A lock's own window is this times its
## `toleranceQuality`.
const CAPTURE_WINDOW := 0.62
## Radians of plug rotation before the loosest chamber binds, and how far apart two chambers
## must bind: both at once is real, and unpickable.
const TOLERANCE_SPREAD := 0.02
const MIN_DELTA_GAP := 0.0008

# ── Wheel packs ─────────────────────────────────────────────────────────────────────────
## A wheel's whole travel, the digits on it, and the slice of travel each digit owns.
const DISC_TRAVEL := 3.0
const COMBO_DIGITS := 10
const COMBO_DETENT := DISC_TRAVEL / COMBO_DIGITS


## Where digit `digit` parks, in travel units — the only places a wheel can ever stop.
static func detent_centre(digit: int) -> float:
	return (digit + 0.5) * COMBO_DETENT


static func chamber_count(def: Dictionary) -> int:
	var bitting: Variant = def.get("bitting")
	return (bitting as Array).size() if bitting is Array else 0


## "" when the lock can be built, otherwise the reason it cannot — prefixed with the lock it is
## about, since the message is shown as it stands.
static func validate(def: Dictionary) -> String:
	var problem := _problem(def)
	if problem == "":
		return ""
	var slug: Variant = def.get("slug")
	var who := str(slug) if slug is String and slug != "" else _show(def.get("id"))
	return 'Lock "%s": %s' % [who, problem]


static func is_valid(def: Dictionary) -> bool:
	return _problem(def) == ""


static func _problem(def: Dictionary) -> String:
	var id: Variant = def.get("id")
	if not WebNum.is_integer(id) or id < 1:
		return "id must be a positive integer, got %s" % _show(id)
	if not def.get("slug") is String or def["slug"] == "":
		return "slug is required"
	if not def.get("name") is String or def["name"] == "":
		return "name is required"
	var tier: Variant = def.get("tier")
	if not WebNum.is_integer(tier) or tier < 1 or tier > MAX_TIER:
		return "tier must be 1-%d, got %s" % [MAX_TIER, _show(tier)]

	if not def.get("bitting") is Array:
		return "bitting is required"
	if not def.get("pins") is Array:
		return "pins is required"
	var bitting: Array = def["bitting"]
	var pins: Array = def["pins"]
	var n := bitting.size()
	if n < MIN_CHAMBERS or n > MAX_CHAMBERS:
		return "chamber count %d is outside %d-%d" % [n, MIN_CHAMBERS, MAX_CHAMBERS]
	if pins.size() != n:
		return "pins has %d entries but bitting has %d" % [pins.size(), n]

	var family: Variant = def.get("family")
	if not family is String or not FAMILIES.has(family):
		return 'family "%s" is not a lock this game builds' % _show(family)
	if family == "combination":
		# The grid first: an author who fattens a gate should hear about the detent rule, not
		# about the reachable-travel arithmetic it happens to break for digits 0 and 9.
		var off_grid := _detent_grid_problem(def)
		return off_grid if off_grid != "" else _discs_problem(def, n)
	if family == "disc-detainer":
		return _detainer_problem(def, n)

	for i in n:
		var k: Variant = bitting[i]
		if not WebNum.is_number(k) or not is_finite(k):
			return "bitting[%d] is not a finite number" % i
		var key := float(k)
		if key >= MAX_KEY_PIN:
			return "bitting[%d] = %s — key pins must sit below the shear line at rest (K < %s)" % [
				i, _show(key), _show(MAX_KEY_PIN)]
		if key <= 0.0:
			return "bitting[%d] = %s — key pin length must be positive" % [i, _show(key)]
		if key + DRIVER_LENGTH <= MIN_STACK_HEIGHT:
			return "bitting[%d] = %s — stack must straddle the shear line (K + D > %s), got %s" % [
				i, _show(key), _show(MIN_STACK_HEIGHT), WebNum.to_fixed(key + DRIVER_LENGTH, 2)]
		var pin: Variant = pins[i]
		if not pin is String or not Profiles.exists(pin):
			return 'pins[%d] = "%s" is not a known pin profile' % [i, _show(pin)]
		# Only the bottom `set_lift` mm of a driver ever crosses the shear line, so a security
		# pin whose grooves sit above that would behave exactly like a standard pin.
		var set_lift := -(KEYWAY_FLOOR + key)
		var needed := Profiles.minimum_set_lift(pin)
		if set_lift < needed:
			return ('chamber %d carries a "%s" but bitting %s gives setLift %smm — its grooves start at '
				+ "%smm and would never reach the shear line (use K < %s)") % [
				i, pin, _show(key), WebNum.to_fixed(set_lift, 2), WebNum.to_fixed(needed, 2),
				WebNum.to_fixed(MAX_KEY_PIN - needed, 2)]

	if def.has("springs") and def["springs"] != null:
		if not def["springs"] is Array:
			return "springs must be a list"
		var springs: Array = def["springs"]
		if springs.size() != n:
			return "springs has %d entries but there are %d chambers" % [springs.size(), n]
		for s: Variant in springs:
			if not WebNum.is_number(s) or not (s > 0.2) or s > 3:
				return "spring strength %s is outside the sane range 0.2-3" % _show(s)

	var quality: Variant = def.get("toleranceQuality")
	if not WebNum.is_number(quality) or not (quality > 0.2) or quality > 2.0:
		return "toleranceQuality %s is outside the sane range 0.2-2.0" % _show(quality)

	var spread: Variant = def.get("toleranceSpread", TOLERANCE_SPREAD)
	if spread == null:
		spread = TOLERANCE_SPREAD
	if not WebNum.is_number(spread) or not (spread > 0):
		return "toleranceSpread %s must be positive" % _show(spread)
	var gap_needed := (n - 1) * MIN_DELTA_GAP
	if spread <= gap_needed:
		return "toleranceSpread %s cannot hold %d chambers %s apart (needs > %s)" % [
			_show(spread), n, _show(MIN_DELTA_GAP), WebNum.to_fixed(gap_needed, 4)]

	var par_problem := _par_problem(def)
	if par_problem != "":
		return par_problem

	var sidebar: Variant = def.get("sidebar")
	if sidebar is Dictionary:
		var gated: Variant = sidebar.get("gatedChambers")
		if not gated is Array:
			return "sidebar needs its gatedChambers"
		for c: Variant in gated:
			if not WebNum.is_integer(c) or c < 0 or c >= n:
				return "sidebar gates chamber %s, out of range" % _show(c)
		var width: Variant = sidebar.get("gateWidth")
		if not WebNum.is_number(width) or not (width > 0):
			return "sidebar gateWidth must be positive"
	return ""


static func _par_problem(def: Dictionary) -> String:
	var par: Variant = def.get("par")
	if not WebNum.is_number(par) or not (par > 0):
		return "par must be positive, got %s" % _show(par)
	return ""


## A wheel pack on its own terms: it has no bitting to speak of, and what matters is that
## every gate is reachable and that a false gate never sits on top of the true one — which
## would make the lock unopenable in a way nothing else would catch.
static func _discs_problem(def: Dictionary, n: int) -> String:
	if not def.get("discs") is Dictionary:
		return "a disc detainer needs a `discs` block"
	var discs: Dictionary = def["discs"]
	if not discs.get("trueGates") is Array or not discs.get("falseGates") is Array:
		return "discs needs its trueGates and falseGates"
	var true_gates: Array = discs["trueGates"]
	var false_gates: Array = discs["falseGates"]
	if true_gates.size() != n:
		return "discs.trueGates has %d entries but there are %d discs" % [true_gates.size(), n]
	if false_gates.size() != n:
		return "discs.falseGates has %d entries but there are %d discs" % [false_gates.size(), n]
	var width: Variant = discs.get("gateWidth")
	if not WebNum.is_number(width) or not (width > 0) or width > DISC_TRAVEL / 4:
		return "discs.gateWidth %s is outside 0 - %s" % [_show(width), _show(DISC_TRAVEL / 4)]
	for i in n:
		var gate: Variant = true_gates[i]
		if not WebNum.is_number(gate) or not is_finite(gate):
			return "disc %d has no true gate" % i
		if gate < width or gate > DISC_TRAVEL - width:
			return "disc %d true gate %s is outside the reachable travel %s - %s" % [
				i, _show(gate), _show(width), WebNum.to_fixed(DISC_TRAVEL - width, 2)]
		var lies: Variant = false_gates[i]
		for f: Variant in (lies if lies is Array else []):
			if not WebNum.is_number(f) or f < 0 or f > DISC_TRAVEL:
				return "disc %d false gate %s is off the dial" % [i, _show(f)]
			# Overlapping gates would be indistinguishable, and the true one unfindable.
			if absf(f - gate) < width * 2:
				return "disc %d false gate %s sits on top of its true gate %s — they must be at least %s apart" % [
					i, _show(f), _show(gate), WebNum.to_fixed(width * 2, 2)]
	return _par_problem(def)


## A disc detainer on its own terms. Its bitting is its key's code — how many steps each disc is
## turned to bring its gate under the sidebar — and the one thing that would make it a lock
## nobody can open is a false gate cut where the true one is.
static func _detainer_problem(def: Dictionary, n: int) -> String:
	if n > DiscRig.MAX_DISCS:
		return "a disc detainer holds at most %d discs, got %d" % [DiscRig.MAX_DISCS, n]
	var bitting: Array = def["bitting"]
	for i in n:
		var cut: Variant = bitting[i]
		if not WebNum.is_integer(cut) or cut < 0 or cut > DiscRig.MAX_CUT:
			return "bitting[%d] = %s — a disc's cut is a whole number of steps, 0-%d" % [i, _show(cut), DiscRig.MAX_CUT]
	var discs: Variant = def.get("discs")
	if discs != null:
		if not discs is Dictionary:
			return "discs must be a block"
		var lies: Variant = (discs as Dictionary).get("falseGates")
		if lies != null:
			if not lies is Array or (lies as Array).size() != n:
				return "discs.falseGates needs one list per disc (%d)" % n
			for i in n:
				if not lies[i] is Array:
					return "discs.falseGates[%d] must be a list" % i
				var seen: Array = []
				for f: Variant in lies[i]:
					if not WebNum.is_integer(f) or f < 0 or f > DiscRig.MAX_CUT:
						return "disc %d false gate %s is off the disc — use a step, 0-%d" % [i, _show(f), DiscRig.MAX_CUT]
					if f == bitting[i]:
						return "disc %d false gate %s sits on top of its true gate" % [i, _show(f)]
					if seen.has(f):
						return "disc %d has two false gates at step %s" % [i, _show(f)]
					seen.append(f)
	var quality: Variant = def.get("toleranceQuality")
	if not WebNum.is_number(quality) or not (quality > 0.2) or quality > 2.0:
		return "toleranceQuality %s is outside the sane range 0.2-2.0" % _show(quality)
	return _par_problem(def)


## A wheel can only ever park on a detent centre, so a gate authored anywhere else is a gate
## no input can reach: the lock would validate, build, and never open. The width cap is the
## same fact from the other side — at half a detent the first digit's centre sits exactly one
## gate width up the travel, and a neighbouring detent can never read inside the window.
static func _detent_grid_problem(def: Dictionary) -> String:
	if not def.get("discs") is Dictionary:
		return ""
	var discs: Dictionary = def["discs"]
	var width: Variant = discs.get("gateWidth")
	if WebNum.is_number(width) and width > COMBO_DETENT / 2:
		return "combination gateWidth %s exceeds half a detent (%s) — digit 0 would sit outside the reachable travel" % [
			_show(width), WebNum.to_fixed(COMBO_DETENT / 2, 2)]
	var true_gates: Variant = discs.get("trueGates")
	var false_gates: Variant = discs.get("falseGates")
	if not true_gates is Array:
		return ""
	for i: int in true_gates.size():
		var gate: Variant = true_gates[i]
		if not _on_detent(gate):
			return "wheel %d true gate %s is off the detent grid — use digit·%s+%s" % [
				i, _show(gate), _show(COMBO_DETENT), _show(COMBO_DETENT / 2)]
		var lies: Variant = false_gates[i] if false_gates is Array and i < false_gates.size() else null
		for f: Variant in (lies if lies is Array else []):
			if not _on_detent(f):
				return "wheel %d false gate %s is off the detent grid" % [i, _show(f)]
	return ""


static func _on_detent(gate: Variant) -> bool:
	if not WebNum.is_number(gate) or not is_finite(gate):
		return false
	var digit := WebNum.round_half_up(gate / COMBO_DETENT - 0.5)
	return digit >= 0 and digit < COMBO_DIGITS and absf(gate - detent_centre(digit)) < 1e-6


## A value as a message shows it: numbers the way the web game prints them.
static func _show(value: Variant) -> String:
	if value == null:
		return "null"
	if WebNum.is_number(value):
		return WebNum.text(value)
	return str(value)
