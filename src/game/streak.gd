class_name Streak
extends RefCounted
## The Lock blitz — five minutes, as many locks as you can, scored by the sum of their tiers.
##
## A hard five-minute window gives every run identical stakes, a number anyone can read, and a
## clock that makes tension the drama: haste wants a heavy hand, and a heavy hand meets walls.
##
## Scoring is the sum of the opened locks' tiers, so the deal can stay honestly random over
## everything the bench has unlocked while a run heavy in deep locks is worth what it cost. A
## tier-4 open is four tier-1s.
##
## The bench's philosophy is "every lock is the same lock every time". This mode is the
## deliberate exception, and the extra time on every dealt lock's par is what that exception
## costs the house: an unseen binding order cannot be known.
##
## The rules are here and pure. `StreakRun` is one live run; the bests live in the save.

## The window. Five minutes flat — short enough for "one more run".
const SECONDS := 300.0

## Half again the bench clock, baked into every dealt lock's par. A bench lock is *your* copy,
## and its par assumes you can learn it; a dealt lock exists for one attempt. 1.5x is the house
## rate for a lock you meet cold.
const TIME_BONUS := 1.5

## Far above the roster, the custom locks and the forge's own ids: nothing that filters by id
## may mistake a dealt lock for anything else.
const ID_BASE := 60000

## The roster's brands, shelved the way the roster shelves them, so a dealt lock reads like
## something that could have hung on the bench. The serial is the tell that it did not.
const BRANDS := {
	1: ["Brasswell", "Northgate"],
	2: ["Northgate", "Kestrel", "Ironhold"],
	3: ["Ironhold", "Kestrel", "Halberd"],
	4: ["Halberd", "Meridian"],
}

# What the par formula prices, fitted to the roster rather than invented.
const _PAR_PER_CHAMBER := 12
const _PAR_PER_SECURITY_PIN := 22
const _PAR_TIGHTNESS := 60.0


## Whether a finished run — { score, opens } — takes the best's place. Score first; opens
## break ties. An empty `best` is no best at all.
static func beats(run: Dictionary, best: Dictionary) -> bool:
	if best.is_empty():
		return true
	if run["score"] != best["score"]:
		return run["score"] > best["score"]
	return run["opens"] > best["opens"]


## Which tier a deal comes from: uniform across everything the bench has unlocked. `roll` is
## a plain 0..1 so the caller owns the randomness. Uniform on purpose, and with sum-of-tiers
## scoring also fair: a run dealt more deep locks is dealt more points' worth of work.
static func tier_for(roll: float, highest_unlocked: int) -> int:
	var top := clampi(highest_unlocked, 1, 4)
	var r := clampf(roll, 0.0, 0.999999)
	return 1 + int(floorf(r * top))


## One dealt lock: deal number `n` of seed `seed_value`, from `tier`.
##
## Always a pin tumbler, never a wheel pack — a wheel is decoded at its own pace and the blitz
## is a picking rhythm. The mechanism is the forge's; this only dresses it for the bench: a
## roster-shaped name that states its tier, and a par priced like the roster's — about twelve
## seconds a chamber, twenty-two a security pin, a premium as the window tightens — with the
## time bonus on top.
static func deal(seed_value: int, n: int, tier: int) -> Dictionary:
	tier = clampi(tier, 1, 4)
	var def := Forge.lock(seed_value, n, tier)
	var rng := Rng.create(Forge.seed32(((seed_value & WebNum.MASK32) ^ 0x517CC1B7) + n * 40503))
	var brands: Array = BRANDS[tier]
	var brand: String = brands[rng.next_int(brands.size())]
	var serial := 2 + rng.next_int(97)
	var security := 0
	for pin: String in def["pins"]:
		if pin != "standard":
			security += 1
	var chambers: int = (def["bitting"] as Array).size()
	var tightness := maxf(0.0, 1.0 - def["toleranceQuality"]) * _PAR_TIGHTNESS
	def["id"] = ID_BASE + (n % 1000)
	def["slug"] = "streak-%d-%d" % [seed_value & WebNum.MASK32, n]
	# The tier in the name, deliberately: the deal is blind, the tier is the lock's price on
	# the scoreboard, and "how hard is this one" is the first thing a hand on the wrench asks.
	def["name"] = "%s No.%d — tier %d" % [brand, serial, tier]
	def["par"] = WebNum.round_half_up((float(chambers * _PAR_PER_CHAMBER + security * _PAR_PER_SECURITY_PIN) + tightness) * TIME_BONUS)
	def["note"] = "Dealt off the pile. The clock does not stop."
	return def


## The seed the dealt lock's own tolerances roll from. Derived, not rolled: the same deal
## picks the same on every machine.
static func lock_seed(seed_value: int, n: int) -> int:
	return Forge.seed32(seed_value + n * 104729)


## m:ss for the run clock, floored at zero.
static func clock_text(seconds_left: float) -> String:
	var s := maxi(0, int(ceilf(seconds_left)))
	return "%d:%02d" % [s / 60, s % 60]
