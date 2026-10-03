class_name EditorModel
extends RefCounted
## The lock editor's model: a lock under construction, and the rules it is built inside.
##
## A draft is a lock definition before it is one — a name, a row per chamber, a tolerance and
## a keyway — and one instance of this class is the draft a screen edits. Nothing here draws,
## saves or simulates. `LockDefs.validate` is the only judge of whether a draft is real, and
## every edit *clamps* rather than validates: the count, the depth and the tolerance are
## bounded on the way in, so an unbuildable lock is unreachable rather than merely rejected.
##
## What it can express, stated plainly: a chamber is one key pin, one driver and one spring,
## so the editor offers exactly that — how many chambers, how deep each key pin is cut, which
## driver sits on it, how strong its spring is.
##
## Saved designs are whole lock definitions, kept in the save (`Progress.add_custom_lock`);
## loading one back *copies* it into the draft, so saving again adds a lock rather than
## overwriting the one you liked.

## The driver profiles a player may choose, in the order the picker cycles through them — and
## the order a share code numbers them in, so it must not be reshuffled.
const EDITABLE_PINS: Array[String] = [
	"standard", "spool", "spool-slim", "spool-deep", "spool-double", "serrated", "mushroom", "t-pin",
]

## Springs, as three named strengths rather than a number: the useful part of the range, named
## so the choice means something at a glance.
const SPRING_LABELS: Array[String] = ["light", "normal", "stiff"]
const SPRING_VALUES: Array[float] = [0.8, 1.0, 1.22]
const SPRING_NORMAL := 1

const MIN_TOLERANCE := 0.45
const MAX_TOLERANCE := 1.4
const TOLERANCE_STEP := 0.05

## The shallowest cut on offer. The validator's own floor is half a millimetre, but a key pin
## that short leaves most of the chamber to lift through and no fun in picking it.
const MIN_DEPTH := 1.0
## The grid every cut snaps to, in mm: what the +/- buttons step by and, not by coincidence,
## exactly what a share code carries in one digit.
const DEPTH_STEP := 0.1

const DEFAULT_NAME := "My Lock"
## What fits the name field. Letters, digits, spaces and hyphens only — anything else would be
## stripped back out of the slug anyway.
const NAME_MAX := 24

## Ids from here up belong to locks a player built or was sent, so one can never shadow a
## roster lock.
const CUSTOM_ID_BASE := 10000

var name := DEFAULT_NAME
## One row per chamber: { depth: float (key pin length, mm), pin: String, spring: int }.
## `spring` indexes SPRING_VALUES.
var chambers: Array[Dictionary] = []
var tolerance_quality := 1.0
var keyway := "standard"


func _init(chamber_count: int = 5) -> void:
	reset(chamber_count)


# ── The rules ───────────────────────────────────────────────────────────────────────────

## Snap a cut to the grid — and onto the exact double a tenth of a millimetre has, so a depth
## never accumulates float dust however many times it is nudged.
static func snap_depth(mm: float) -> float:
	return WebNum.round_half_up(mm / DEPTH_STEP) / 10.0


## The deepest cut a chamber may carry and still hold this profile's grooves below the shear
## line. A security pin whose waist sits above it can never false-set — a lock that silently
## is not the lock you designed — so the dial stops here instead of letting you find out.
static func max_depth_for(pin: String) -> float:
	if not Profiles.exists(pin):
		return 3.0
	# The set lift (shear line minus cut) must clear the highest groove plus its clearance.
	var needed := Profiles.highest_groove_top(pin) + Profiles.GROOVE_CLEARANCE
	return minf(4.0, LockDefs.MAX_KEY_PIN - needed - 0.01)


static func clamp_chamber_count(n: int) -> int:
	return clampi(n, LockDefs.MIN_CHAMBERS, LockDefs.MAX_CHAMBERS)


## The named spring nearest a strength — the editor has no way to show 1.07.
static func nearest_spring(value: float) -> int:
	var best := SPRING_NORMAL
	var best_gap := INF
	for i in SPRING_VALUES.size():
		var gap := absf(SPRING_VALUES[i] - value)
		if gap < best_gap:
			best_gap = gap
			best = i
	return best


## A slug that is stable for a given name and id, and cannot collide with a roster lock.
static func slug_for(lock_name: String, id: int) -> String:
	var out := ""
	var gap := false
	for i in lock_name.length():
		var c := lock_name.unicode_at(i)
		# Lower-cased first. Two characters outside ASCII land inside it: the Kelvin sign is a
		# plain k, and a dotted capital I is an i with its dot left over.
		var dotted := c == 0x130
		if c >= 65 and c <= 90:
			c += 32
		elif c == 0x212A:
			c = 107
		elif dotted:
			c = 105
		if (c >= 97 and c <= 122) or (c >= 48 and c <= 57):
			if gap and out != "":
				out += "-"
			gap = dotted
			out += String.chr(c)
		else:
			gap = true
	return "custom-%d-%s" % [id, out if out != "" else "lock"]


## Keep what a name may hold: letters, digits, spaces and hyphens, to NAME_MAX.
static func clean_name(text: String) -> String:
	var out := ""
	for i in text.length():
		var c := text.unicode_at(i)
		if (c >= 97 and c <= 122) or (c >= 65 and c <= 90) or (c >= 48 and c <= 57) or c == 32 or c == 45:
			out += String.chr(c)
	return out.substr(0, NAME_MAX)


# ── The draft ───────────────────────────────────────────────────────────────────────────

## A fresh draft: plain pins, normal springs, and a spread of cuts so it binds in an
## interesting order rather than uniformly.
func reset(chamber_count: int = 5) -> void:
	name = DEFAULT_NAME
	tolerance_quality = 1.0
	keyway = "standard"
	chambers = []
	for i in clamp_chamber_count(chamber_count):
		chambers.append({"depth": snap_depth(3.4 - (i % 4) * 0.3), "pin": "standard", "spring": SPRING_NORMAL})


## Read a lock back into the draft. Lossy in exactly one direction: a spring that is not one
## of the three named strengths snaps to the nearest. Every lock the editor can *produce*
## comes back exactly, which is the property that matters.
func load_lock_def(def: Dictionary) -> void:
	name = str(def.get("name", DEFAULT_NAME))
	tolerance_quality = float(def.get("toleranceQuality", 1.0))
	keyway = str(def.get("keyway", "standard"))
	chambers = []
	var bitting: Array = def.get("bitting", [])
	var pins: Array = def.get("pins", [])
	var springs: Variant = def.get("springs")
	for i in bitting.size():
		var strength: float = springs[i] if springs is Array and i < springs.size() else 1.0
		chambers.append({
			"depth": float(bitting[i]),
			"pin": str(pins[i]) if i < pins.size() else "standard",
			"spring": nearest_spring(strength),
		})


static func from_lock_def(def: Dictionary) -> EditorModel:
	var model := EditorModel.new()
	model.load_lock_def(def)
	return model


func set_name(text: String) -> void:
	name = clean_name(text)


## Grow or shrink the lock. A new chamber copies the last one: adding a sixth to five spools
## should give six spools, not five spools and a standard pin nobody asked for.
func set_chamber_count(n: int) -> void:
	var want := clamp_chamber_count(n)
	while chambers.size() > want:
		chambers.pop_back()
	while chambers.size() < want:
		if chambers.is_empty():
			chambers.append({"depth": 3.2, "pin": "standard", "spring": SPRING_NORMAL})
		else:
			chambers.append(chambers[-1].duplicate())


func can_add_chamber() -> bool:
	return chambers.size() < LockDefs.MAX_CHAMBERS


func can_remove_chamber() -> bool:
	return chambers.size() > LockDefs.MIN_CHAMBERS


## Set one chamber's cut, snapped to the grid and held inside what its driver allows.
func set_depth(index: int, depth: float) -> void:
	if index < 0 or index >= chambers.size():
		return
	var pin: String = chambers[index]["pin"]
	chambers[index]["depth"] = snap_depth(clampf(snap_depth(depth), MIN_DEPTH, max_depth_for(pin)))


## The +/- nudges: one grid step deeper (`steps` > 0) or shallower.
func nudge_depth(index: int, steps: int) -> void:
	if index < 0 or index >= chambers.size():
		return
	var depth: float = chambers[index]["depth"]
	set_depth(index, depth + steps * DEPTH_STEP)


## Swap one chamber's driver for the next on the list. A deeper-grooved driver needs more of
## the chamber, so the cut comes back up with it when it has to.
func cycle_pin(index: int) -> void:
	if index < 0 or index >= chambers.size():
		return
	var row := chambers[index]
	var pin := EDITABLE_PINS[(EDITABLE_PINS.find(row["pin"]) + 1) % EDITABLE_PINS.size()]
	var depth: float = row["depth"]
	row["pin"] = pin
	row["depth"] = snap_depth(minf(depth, max_depth_for(pin)))


## Put a named driver in a chamber — the picker that shows every profile at once. The same
## rule as `cycle_pin`: a cut too deep for the new driver's grooves comes back up with it. A
## name the editor does not offer is ignored.
func set_pin(index: int, pin: String) -> void:
	if index < 0 or index >= chambers.size() or not EDITABLE_PINS.has(pin):
		return
	var row := chambers[index]
	var depth: float = row["depth"]
	row["pin"] = pin
	row["depth"] = snap_depth(minf(depth, max_depth_for(pin)))


## The deepest cut a chamber may carry under the driver it has, on the grid — exactly where
## `set_depth` and the + button stop.
func max_depth(index: int) -> float:
	if index < 0 or index >= chambers.size():
		return MIN_DEPTH
	var pin: String = chambers[index]["pin"]
	return snap_depth(max_depth_for(pin))


func cycle_spring(index: int) -> void:
	if index < 0 or index >= chambers.size():
		return
	var spring: int = chambers[index]["spring"]
	chambers[index]["spring"] = (spring + 1) % SPRING_VALUES.size()


## The key pin lengths that build different locks in this build's rig, mm: shorter than the
## first, or longer than the last, and the pin sets at the same lift as its neighbour.
const FELT_MIN_DEPTH := 2.7
const FELT_MAX_DEPTH := 3.7


## The longest key pin worth offering for a chamber: what its driver allows, and no longer than
## the lock can tell from the next size down.
func felt_max_depth(index: int) -> float:
	return minf(max_depth(index), FELT_MAX_DEPTH)


## Bring every cut into the range that makes a difference. For a draft the editor starts
## itself; a lock that was pasted or loaded keeps the cuts it came with.
func keep_felt() -> void:
	for i in chambers.size():
		var depth: float = chambers[i]["depth"]
		set_depth(i, clampf(depth, FELT_MIN_DEPTH, felt_max_depth(i)))


## Give a chamber one of the named springs (an index into SPRING_VALUES), held to the list.
func set_spring(index: int, spring: int) -> void:
	if index < 0 or index >= chambers.size():
		return
	chambers[index]["spring"] = clampi(spring, 0, SPRING_VALUES.size() - 1)


func spring_label(index: int) -> String:
	var spring: int = chambers[index]["spring"]
	return SPRING_LABELS[spring] if spring >= 0 and spring < SPRING_LABELS.size() else SPRING_LABELS[SPRING_NORMAL]


## Set the tolerance, on its own grid of twentieths and inside the range that plays.
func set_tolerance(quality: float) -> void:
	tolerance_quality = clampf(WebNum.round_half_up(quality * 20.0) / 20.0, MIN_TOLERANCE, MAX_TOLERANCE)


func nudge_tolerance(steps: int) -> void:
	set_tolerance(tolerance_quality + steps * TOLERANCE_STEP)


func can_loosen() -> bool:
	return tolerance_quality < MAX_TOLERANCE - 1e-9


func can_tighten() -> bool:
	return tolerance_quality > MIN_TOLERANCE + 1e-9


func set_keyway(grade: String) -> void:
	keyway = "tight" if grade == "tight" else "standard"


## How wide each chamber's capture window will be, in mm — the number that decides whether
## this is a forgiving lock or a vicious one, shown while the dial turns rather than
## discovered later.
func window_width() -> float:
	return LockDefs.CAPTURE_WINDOW * tolerance_quality


# ── Out of the editor ───────────────────────────────────────────────────────────────────

## The draft as a real lock definition. `index` is how many custom locks the save already
## holds, which keeps the id clear of them. Ranked like any other lock, against a par that
## grows with its own chamber count.
func to_lock_def(index: int = 0) -> Dictionary:
	var id := CUSTOM_ID_BASE + index
	var bitting: Array = []
	var pins: Array = []
	var springs: Array = []
	for row in chambers:
		var spring: int = row["spring"]
		bitting.append(row["depth"])
		pins.append(row["pin"])
		springs.append(SPRING_VALUES[spring] if spring >= 0 and spring < SPRING_VALUES.size() else 1.0)
	var shown := name.strip_edges()
	return {
		"id": id,
		"slug": slug_for(name, id),
		"name": shown if shown != "" else DEFAULT_NAME,
		"tier": 1,
		"family": "pin-tumbler",
		"bitting": bitting,
		"pins": pins,
		"springs": springs,
		"toleranceQuality": tolerance_quality,
		"keyway": keyway,
		"par": maxi(20, chambers.size() * 18),
		"note": "Built at your own bench.",
	}


## "" when the draft is buildable, otherwise the reason it is not.
func problem(index: int = 0) -> String:
	return LockDefs.validate(to_lock_def(index))


## The draft's share code, or "" while the draft cannot be built.
func share_code(index: int = 0) -> String:
	return ShareCode.encode(to_lock_def(index)) if problem(index) == "" else ""
