class_name Roster
extends RefCounted
## The lock roster.
##
## Locks are data: adding one means adding a dictionary here and nothing else. Keys are the
## same names the web game and its share codes use.
##
## Bitting rules worth knowing while authoring (LockDef.validate enforces them):
##  - 0 < K < 5.0 — a key pin has to sit below the shear line at rest.
##  - A security-pin chamber needs a cut deep enough for its groove to reach the shear line:
##    spool K <= 3.45, mushroom K <= 3.35, serrated K <= 3.22, t-pin K <= 3.20.
##
## A disc detainer's `bitting` is its key's code: for each disc, how many 18-degree steps (0-5)
## it has to be turned to bring its gate under the sidebar. `discs.falseGates` lists, per disc,
## the steps at which it also carries a shallow notch. A lie only catches a disc on its way to
## the truth, so one that is to do its work sits at a lower step than the disc's own cut.

const LOCKS: Array[Dictionary] = [
	{
		"id": 1,
		"slug": "clear-practice-cutaway",
		"name": "Clear Practice Cutaway",
		"tier": 1,
		"family": "pin-tumbler",
		"bitting": [3.2, 4],
		"pins": ["standard", "standard"],
		"toleranceQuality": 1.4,
		"keyway": "standard",
		"par": 20,
		"note": "Two pins, generous tolerances, nothing hidden. Start here.",
	},
	{
		"id": 2,
		"slug": "clear-practice-cutaway-ii",
		"name": "Clear Practice Cutaway II",
		"tier": 1,
		"family": "pin-tumbler",
		"bitting": [3.4, 2.9, 4.1],
		"pins": ["standard", "standard", "standard"],
		"toleranceQuality": 1.35,
		"keyway": "standard",
		"par": 30,
		"note": "A third chamber, and a deeper cut to reach.",
	},
	{
		"id": 3,
		"slug": "brasswell-no1-luggage",
		"name": "Brasswell No.1 Luggage",
		"tier": 1,
		"family": "pin-tumbler",
		"bitting": [2.8, 3.9, 3.3],
		"pins": ["standard", "standard", "standard"],
		"toleranceQuality": 1.3,
		"keyway": "standard",
		"par": 35,
		"note": "The lock on every suitcase ever made. It is not trying very hard.",
	},
	{
		"id": 5,
		"slug": "brasswell-bike-padlock",
		"name": "Brasswell Bike Padlock",
		"tier": 1,
		"family": "pin-tumbler",
		"bitting": [3.1, 4.2, 2.7, 3.6],
		"pins": ["standard", "standard", "standard", "standard"],
		"toleranceQuality": 1.25,
		"keyway": "standard",
		"par": 45,
		"note": "Four chambers and a wide bitting spread. Rakes beautifully.",
	},
	{
		"id": 6,
		"slug": "northgate-shed-padlock",
		"name": "Northgate Shed Padlock",
		"tier": 1,
		"family": "pin-tumbler",
		"bitting": [4, 2.9, 3.5, 3.1],
		"pins": ["standard", "standard", "standard", "standard"],
		"toleranceQuality": 1.2,
		"keyway": "standard",
		"par": 50,
		"note": "Tighter than it looks. The first lock that will punish a heavy hand.",
	},
	{
		"id": 39,
		"slug": "brasswell-3-wheel-luggage",
		"name": "Brasswell 3-Wheel Luggage",
		"tier": 1,
		"family": "combination",
		"bitting": [3, 3, 3],
		"pins": ["standard", "standard", "standard"],
		"discs": {
			"trueGates": [1.35, 0.45, 2.25],
			"falseGates": [[], [], []],
			"gateWidth": 0.15,
		},
		"toleranceQuality": 1.2,
		"keyway": "standard",
		"par": 55,
		"note": "Every suitcase you have ever owned. Pull the shackle and read the wheels with your thumb.",
	},
	{
		"id": 9,
		"slug": "northgate-5-pin-cabinet",
		"name": "Northgate 5-Pin Cabinet",
		"tier": 2,
		"family": "pin-tumbler",
		"bitting": [3.5, 2.8, 4.1, 3.2, 3.7],
		"pins": ["standard", "standard", "standard", "standard", "standard"],
		"toleranceQuality": 1.15,
		"keyway": "standard",
		"par": 60,
		"note": "Five chambers. You will need a hook that reaches all of them.",
	},
	{
		"id": 10,
		"slug": "kestrel-door-cylinder",
		"name": "Kestrel Door Cylinder",
		"tier": 2,
		"family": "pin-tumbler",
		"bitting": [2.9, 3.8, 3.3, 4.2, 3],
		"pins": ["standard", "standard", "standard", "standard", "standard"],
		"toleranceQuality": 1.05,
		"keyway": "standard",
		"par": 70,
		"note": "The lock on a million front doors, and no harder than one.",
	},
	{
		"id": 11,
		"slug": "ironhold-laminated-pad",
		"name": "Ironhold Laminated Pad",
		"tier": 2,
		"family": "pin-tumbler",
		"bitting": [3.6, 3.1, 4, 2.8, 3.4],
		"pins": ["standard", "standard", "standard", "serrated", "standard"],
		"toleranceQuality": 1.05,
		"keyway": "standard",
		"par": 80,
		"note": "One serrated pin, hiding among four honest ones. Which one is it?",
	},
	{
		"id": 13,
		"slug": "ironhold-spool-trainer",
		"name": "Ironhold Spool Trainer",
		"tier": 2,
		"family": "pin-tumbler",
		"bitting": [3.6, 3.2, 2.9, 4],
		"pins": ["standard", "spool", "spool", "standard"],
		"toleranceQuality": 1,
		"keyway": "standard",
		"par": 90,
		"note": "Two spools, nothing else. Made for learning what a false set feels like.",
	},
	{
		"id": 14,
		"slug": "kestrel-serrated-trainer",
		"name": "Kestrel Serrated Trainer",
		"tier": 2,
		"family": "pin-tumbler",
		"bitting": [3, 2.8, 3.1, 3.8],
		"pins": ["serrated", "serrated", "serrated", "standard"],
		"toleranceQuality": 1,
		"keyway": "standard",
		"par": 100,
		"note": "Every one of these pins will lie to you four times on the way up.",
	},
	{
		"id": 42,
		"slug": "vantage-disc-padlock",
		"name": "Vantage Disc Padlock",
		"tier": 2,
		"family": "disc-detainer",
		"bitting": [2, 4, 1, 3],
		"pins": ["standard", "standard", "standard", "standard"],
		"discs": {"falseGates": [[], [], [], []]},
		"toleranceQuality": 1.3,
		"keyway": "standard",
		"par": 60,
		"note": "Four discs and one bar. No pins and no springs — nothing in it falls back down.",
	},
	{
		"id": 15,
		"slug": "northgate-commercial",
		"name": "Northgate Commercial",
		"tier": 3,
		"family": "pin-tumbler",
		"bitting": [3.4, 2.9, 3.1, 3.7, 4],
		"pins": ["spool", "spool-slim", "serrated", "standard", "standard"],
		"toleranceQuality": 0.95,
		"keyway": "standard",
		"par": 110,
		"note": "Two spools and a serrated. The first lock that really needs a plan.",
	},
	{
		"id": 16,
		"slug": "halberd-deadbolt",
		"name": "Halberd Deadbolt",
		"tier": 3,
		"family": "pin-tumbler",
		"bitting": [3.4, 2.9, 3.2, 3.9, 3],
		"pins": ["spool", "standard", "spool-deep", "standard", "spool"],
		"toleranceQuality": 0.9,
		"keyway": "standard",
		"par": 120,
		"note": "Three spools. Back the tension off or it will fight you all day.",
	},
	{
		"id": 17,
		"slug": "ironhold-mushroom-pad",
		"name": "Ironhold Mushroom Pad",
		"tier": 3,
		"family": "pin-tumbler",
		"bitting": [3.3, 3, 3.7, 2.8, 3.1],
		"pins": ["mushroom", "spool", "standard", "mushroom", "standard"],
		"toleranceQuality": 0.88,
		"keyway": "standard",
		"par": 130,
		"note": "Mushrooms shove harder than spools. A light hand is the only hand.",
	},
	{
		"id": 18,
		"slug": "kestrel-pro-cylinder",
		"name": "Kestrel Pro Cylinder",
		"tier": 3,
		"family": "pin-tumbler",
		"bitting": [3.3, 3, 2.8, 3.4, 3.1, 4.1],
		"pins": ["spool", "serrated", "serrated", "spool", "spool", "standard"],
		"toleranceQuality": 0.85,
		"keyway": "standard",
		"par": 150,
		"note": "Six chambers, five of them lying. The end of Tier 3, and it knows it.",
	},
	{
		"id": 19,
		"slug": "halberd-tight-tolerance-5",
		"name": "Halberd Tight-Tolerance 5",
		"tier": 3,
		"family": "pin-tumbler",
		"bitting": [3.3, 3.05, 3.4, 3.15, 4],
		"pins": ["spool", "mushroom", "spool", "serrated", "standard"],
		"toleranceQuality": 0.8,
		"keyway": "standard",
		"par": 150,
		"note": "Two spools, a mushroom and a serrated. Four false sets on one of them, and a wall.",
	},
	{
		"id": 37,
		"slug": "kestrel-slimline-5",
		"name": "Kestrel Slimline 5",
		"tier": 3,
		"family": "pin-tumbler",
		"bitting": [3.3, 2.8, 3.6, 3.1, 3.45],
		"pins": ["spool-slim", "spool-slim", "standard", "spool-slim", "standard"],
		"toleranceQuality": 0.86,
		"keyway": "standard",
		"par": 130,
		"note": "Three slim spools. Every lie is a short one — keep moving.",
	},
	{
		"id": 40,
		"slug": "ironhold-combination-chain",
		"name": "Ironhold Combination Chain",
		"tier": 3,
		"family": "combination",
		"bitting": [3, 3, 3, 3],
		"pins": ["standard", "standard", "standard", "standard"],
		"discs": {
			"trueGates": [0.75, 2.55, 1.65, 1.05],
			"falseGates": [[1.95], [0.45], [2.85], [2.25]],
			"gateWidth": 0.12,
		},
		"toleranceQuality": 0.85,
		"keyway": "standard",
		"par": 135,
		"note": "Four wheels, and one digit on each that feels right and is not.",
	},
	{
		"id": 43,
		"slug": "vantage-disc-detainer-6",
		"name": "Vantage Disc Detainer 6",
		"tier": 3,
		"family": "disc-detainer",
		"bitting": [3, 1, 4, 2, 5, 2],
		"pins": ["standard", "standard", "standard", "standard", "standard", "standard"],
		"discs": {"falseGates": [[1], [], [2], [4], [3], [1]]},
		"toleranceQuality": 1,
		"keyway": "standard",
		"par": 130,
		"note": "Six discs, and on most of them a shallow notch that takes the bar just as gladly.",
	},
	{
		"id": 20,
		"slug": "meridian-euro-profile",
		"name": "Meridian Euro Profile",
		"tier": 4,
		"family": "pin-tumbler",
		"bitting": [3.2, 3.5, 2.9, 3.35, 3.1, 4],
		"pins": ["spool", "standard", "spool-double", "mushroom", "spool", "standard"],
		"toleranceQuality": 0.75,
		"keyway": "standard",
		"par": 170,
		"note": "The cylinder on half the front doors in Europe. Three spools and a mushroom.",
	},
	{
		"id": 22,
		"slug": "halberd-anti-bump-6",
		"name": "Halberd Anti-Bump 6",
		"tier": 4,
		"family": "pin-tumbler",
		"bitting": [3.15, 3.2, 2.9, 3.05, 3.3, 3.4],
		"pins": ["t-pin", "serrated", "serrated", "t-pin", "spool", "spool"],
		"toleranceQuality": 0.72,
		"keyway": "standard",
		"par": 190,
		"note": "Four serrated and two spools. Twenty false sets on the way up, give or take.",
	},
	{
		"id": 27,
		"slug": "halberd-sidebar-cylinder",
		"name": "Halberd Sidebar Cylinder",
		"tier": 4,
		"family": "pin-tumbler",
		"bitting": [3.3, 3.6, 3.05, 3.1, 3.4, 4],
		"pins": ["spool", "standard", "spool", "standard", "spool", "standard"],
		"sidebar": {
			"gatedChambers": [0, 2, 4],
			"gateWidth": 0.09,
			"gatePositions": [0.35, 0.6, 0.45],
		},
		"toleranceQuality": 0.58,
		"keyway": "standard",
		"par": 230,
		"note": "Three chambers carry a sidebar gate. Set them wrong and the plug simply will not turn.",
	},
	{
		"id": 31,
		"slug": "halberd-sovereign",
		"name": "Halberd Sovereign",
		"tier": 4,
		"family": "pin-tumbler",
		"bitting": [3.2, 3.05, 3.4, 3.1, 3.35, 2.95, 3.25],
		"pins": ["spool", "mushroom", "spool", "spool", "mushroom", "spool", "spool"],
		"toleranceQuality": 0.5,
		"keyway": "tight",
		"par": 360,
		"note": "Seven chambers, every one of them a security pin, in a keyway that fits nothing.",
	},
	{
		"id": 38,
		"slug": "halberd-t-bar-6",
		"name": "Halberd T-Bar 6",
		"tier": 4,
		"family": "pin-tumbler",
		"bitting": [3.1, 2.85, 3.15, 2.9, 3.3, 3.5],
		"pins": ["t-pin", "spool-deep", "t-pin", "spool-double", "mushroom", "standard"],
		"toleranceQuality": 0.6,
		"keyway": "tight",
		"par": 210,
		"note": "One of everything the trade ever put in a chamber.",
	},
	{
		"id": 41,
		"slug": "meridian-strongbox-wheels",
		"name": "Meridian Strongbox Wheels",
		"tier": 4,
		"family": "combination",
		"bitting": [3, 3, 3, 3],
		"pins": ["standard", "standard", "standard", "standard"],
		"discs": {
			"trueGates": [2.25, 0.75, 2.85, 1.35],
			"falseGates": [[0.15, 1.35, 2.55], [1.65, 2.55, 0.15], [0.45, 1.65, 2.25], [0.15, 1.95, 2.85]],
			"gateWidth": 0.09,
		},
		"toleranceQuality": 0.6,
		"keyway": "standard",
		"par": 240,
		"note": "Twelve false gates across four wheels. Every third digit is a lie with good manners.",
	},
	{
		"id": 44,
		"slug": "vantage-sentinel-9",
		"name": "Vantage Sentinel 9",
		"tier": 4,
		"family": "disc-detainer",
		"bitting": [4, 2, 5, 3, 1, 5, 2, 4, 3],
		"pins": ["standard", "standard", "standard", "standard", "standard", "standard", "standard", "standard", "standard"],
		"discs": {"falseGates": [[1, 2], [1], [2, 3], [1], [3], [1, 3], [1, 4], [2], [1, 5]]},
		"toleranceQuality": 0.7,
		"keyway": "standard",
		"par": 240,
		"note": "Nine discs and fourteen false gates. The bar drops into every one of them just the same.",
	},
]


static func all() -> Array[Dictionary]:
	return LOCKS


static func by_id(id: int) -> Dictionary:
	for d in LOCKS:
		if d["id"] == id:
			return d
	return {}


static func by_slug(slug: String) -> Dictionary:
	for d in LOCKS:
		if d["slug"] == slug:
			return d
	return {}


## Resolve by numeric id or slug.
static func find(key: Variant) -> Dictionary:
	if key is int:
		return by_id(key)
	var d := by_slug(str(key))
	if d.is_empty() and str(key).is_valid_int():
		return by_id(int(str(key)))
	return d


static func in_tier(tier: int) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for d in LOCKS:
		if d["tier"] == tier:
			out.append(d)
	return out
