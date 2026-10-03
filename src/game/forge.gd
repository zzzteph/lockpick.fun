class_name Forge
extends RefCounted
## The lock forge — random pin tumblers, dealt from a seed.
##
## Generation lives inside the editor's legal space: a forged lock is a draft the editor could
## have produced, pushed down the same road as a player's own design, so the validator polices
## it like everything else. The same seed forges the same lock on every machine, and the same
## lock the web game forges for it.
##
## Difficulty is a ramp of shapes — the bench's ladder compressed: chambers climb, the budget
## of security pins climbs, the window tightens, the pool of liars grows nastier. Tier 1 owns
## the two opening shapes; tiers 2 to 4 one each.

const ID_BASE := 50000

## Per shape: chambers, how many carry a security pin, the band the tolerance rolls inside
## (lower is a narrower capture window), and the drivers those security chambers draw from.
const RAMP: Array[Dictionary] = [
	{"chambers": 3, "security": 0, "tolerance": [1.15, 1.3], "pool": []},
	{"chambers": 4, "security": 0, "tolerance": [1.05, 1.2], "pool": []},
	{"chambers": 5, "security": 1, "tolerance": [0.95, 1.1], "pool": ["spool"]},
	{"chambers": 5, "security": 2, "tolerance": [0.85, 1.0], "pool": ["spool", "serrated", "spool-slim"]},
	{
		"chambers": 6,
		"security": 3,
		"tolerance": [0.72, 0.88],
		"pool": ["spool", "serrated", "spool-deep", "spool-double", "mushroom", "t-pin"],
	},
]

## A bitting whose cuts all sit within this of each other is mush: the binding order means
## nothing and the lock is boring. The roster never ships one and the forge may not either.
const MIN_SPREAD := 0.5


## One forged pin tumbler. `salt` tells apart the locks forged from one seed; `tier` (1 to 4)
## picks the shape.
static func lock(seed_value: int, salt: int, tier: int) -> Dictionary:
	var rng := Rng.create(seed32(((seed_value & WebNum.MASK32) ^ 0x9E37) + salt * 2654435761))
	var shape := rng.next_int(2) if tier <= 1 else clampi(tier, 2, 4)
	var def := draft(rng, shape).to_lock_def(0)
	def["id"] = ID_BASE + 500 + salt
	def["slug"] = "forged-%d-%d" % [seed_value & WebNum.MASK32, salt]
	def["name"] = "A forged lock"
	def["tier"] = clampi(tier, 1, 4)
	def["note"] = ""
	return def


## The draft for one shape on the ramp, drawn from `rng`.
static func draft(rng: Rng, shape_index: int) -> EditorModel:
	var shape := RAMP[shape_index]
	var count: int = shape["chambers"]
	var pool: Array = shape["pool"]
	var band: Array = shape["tolerance"]

	# Which chambers carry the liars: shuffled positions, as many as the shape budgets.
	var positions: Array = rng.shuffle(range(count)).slice(0, shape["security"])

	var model := EditorModel.new()
	model.name = "A forged lock"
	model.chambers.clear()
	for i in count:
		var pin := "standard"
		if positions.has(i) and not pool.is_empty():
			pin = pool[rng.next_int(pool.size())]
		# One cut, random on the editor's own grid, inside what the driver allows.
		var depth := EditorModel.snap_depth(rng.next_range(EditorModel.MIN_DEPTH, EditorModel.max_depth_for(pin)))
		model.chambers.append({"depth": depth, "pin": pin, "spring": _roll_spring(rng, shape_index)})

	var low := INF
	var high := -INF
	for row in model.chambers:
		low = minf(low, row["depth"])
		high = maxf(high, row["depth"])
	if high - low < MIN_SPREAD:
		# Push the first chamber to the legal floor and the last toward its ceiling: a real
		# climb again, without leaving the grid.
		var last := model.chambers[-1]
		model.chambers[0]["depth"] = EditorModel.snap_depth(EditorModel.MIN_DEPTH + EditorModel.DEPTH_STEP)
		last["depth"] = EditorModel.snap_depth(EditorModel.max_depth_for(last["pin"]) - EditorModel.DEPTH_STEP)

	model.tolerance_quality = WebNum.fixed(rng.next_range(band[0], band[1]), 2)
	return model


## Springs lean normal. A stiff or a light one is a texture the later shapes may roll, never
## a wall — a lock met once and never again has no room for a chamber that reads wrong.
static func _roll_spring(rng: Rng, shape_index: int) -> int:
	if shape_index >= 2 and rng.next_int(4) == 0:
		return 0 if rng.next_int(2) == 0 else 2
	return EditorModel.SPRING_NORMAL


## A 32-bit seed, never zero: zero is a legal seed and a degenerate one.
static func seed32(value: int) -> int:
	var s := value & WebNum.MASK32
	return s if s != 0 else 1
