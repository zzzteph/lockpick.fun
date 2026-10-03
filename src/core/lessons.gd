class_name Lessons
extends RefCounted
## The lessons: teach through play, one line of text at a time.
##
## A lesson is a lock plus a list of steps, and a step is a line of text plus a test that says
## when the player has done it. Nothing here blocks input, nothing waits for a click, and
## nothing can be dismissed — the line under the header changes when the player's own actions
## change it, and the lesson ends when they open the lock.
##
## The locks are purpose-built and live here rather than in the roster: they are teaching
## instruments, not content, and they never appear on the bench or in any record.
##
## A step's test reads a snapshot of the attempt (see `PickScreen.lesson_state`):
##   tension      the wrench dial being applied, 0 when off
##   pick         chamber under the pick (or the chosen wheel), -1 for none
##   binding      the chamber holding the plug, -1 for none
##   states       per-chamber state, LockRig's enum (a disc's too: a false gate is a false set)
##   opened
##   full_resets, false_sets   tallies this attempt
##   fooled_then_set           a chamber that false-set has since truly set
##   serrated_set              a serrated chamber is set
##   overset_for               the longest any chamber has now stood overset, s

const T_MIN_HOLD := 0.08

# ── The teaching locks ──────────────────────────────────────────────────────────────────
const LOCKS := {
	# One pin, the loosest tolerance in the game: the whole idea of a lock, visible at once.
	"lesson-the-turn": {
		"id": 904, "slug": "lesson-the-turn", "name": "Lesson 1 — The Turn", "tier": 1,
		"family": "pin-tumbler", "bitting": [3.4], "pins": ["standard"], "toleranceQuality": 1.5,
		"keyway": "standard", "par": 45,
		"note": "One pin, in the open. The whole idea of lockpicking, visible at once.",
	},
	# Two standard pins, nothing in it that can go wrong.
	"lesson-tension-and-lift": {
		"id": 901, "slug": "lesson-tension-and-lift", "name": "Lesson 2 — Tension and Lift", "tier": 1,
		"family": "pin-tumbler", "bitting": [3.2, 4.0], "pins": ["standard", "standard"],
		"toleranceQuality": 1.5, "keyway": "standard", "par": 60,
		"note": "A transparent two-pin cutaway. Nothing in it can go wrong.",
	},
	# Three pins, built for the lesson that asks the player to jam one on purpose.
	"lesson-overset-and-reset": {
		"id": 902, "slug": "lesson-overset-and-reset", "name": "Lesson 3 — Overset and Reset", "tier": 1,
		"family": "pin-tumbler", "bitting": [3.4, 2.9, 4.1], "pins": ["standard", "standard", "standard"],
		"toleranceQuality": 0.55, "keyway": "standard", "par": 90,
		"note": "A tight one. You will jam it. That is the lesson.",
	},
	# Three honest pins, nothing to fight — because the subject is the other hand.
	"lesson-wrench-pressure": {
		"id": 905, "slug": "lesson-wrench-pressure", "name": "Lesson 4 — Wrench Pressure", "tier": 1,
		"family": "pin-tumbler", "bitting": [3.3, 2.9, 3.1], "pins": ["standard", "standard", "standard"],
		"toleranceQuality": 1.3, "keyway": "standard", "par": 90,
		"note": "Plain pins, on purpose. The lesson is in your other hand.",
	},
	# One spool, dead centre, so the false set cannot be confused with anything else.
	"lesson-the-spool": {
		"id": 903, "slug": "lesson-the-spool", "name": "Lesson 5 — The Spool", "tier": 1,
		"family": "pin-tumbler", "bitting": [3.2, 3.0, 2.8], "pins": ["standard", "spool", "standard"],
		"toleranceQuality": 1.2, "keyway": "standard", "par": 150,
		"note": "One spool, in the middle. Everything else is out of the way.",
	},
	"lesson-the-serrated": {
		"id": 906, "slug": "lesson-the-serrated", "name": "Lesson 6 — The Serrated Pin", "tier": 1,
		"family": "pin-tumbler", "bitting": [3.1, 2.9, 3.0], "pins": ["standard", "serrated", "standard"],
		"toleranceQuality": 1.2, "keyway": "standard", "par": 150,
		"note": "One serrated pin, in the middle. It will lie to you on the way up.",
	},
	# Three wheels: a lie on the first, a lie on the second, the third clean — and both lies
	# above their true gates, so a student rolling up from zero meets the truth first.
	"lesson-the-wheel-pack": {
		"id": 907, "slug": "lesson-the-wheel-pack", "name": "Lesson 7 — The Wheel Pack", "tier": 1,
		"family": "combination", "bitting": [3, 3, 3], "pins": ["standard", "standard", "standard"],
		"discs": {"trueGates": [0.75, 1.95, 1.35], "falseGates": [[2.25], [2.55], []], "gateWidth": 0.15},
		"toleranceQuality": 1.3, "keyway": "standard", "par": 60,
		"note": "Three wheels and a shackle. The other family, from the first pull.",
	},
	# Two plain pins, wide open: the lesson is the tool, not the lock.
	"lesson-the-snap-gun": {
		"id": 908, "slug": "lesson-the-snap-gun", "name": "Lesson 8 — The Snap Gun", "tier": 1,
		"family": "pin-tumbler", "bitting": [3.2, 3.8], "pins": ["standard", "standard"],
		"toleranceQuality": 1.5, "keyway": "standard", "par": 90,
		"note": "Two plain pins, wide open. The lesson is the tool, not the lock.",
	},
	# Three discs, cut wide, no lies: the third family with nothing on it but the idea. The cuts
	# differ, so each disc is plainly turned by its own amount.
	"lesson-the-disc-pack": {
		"id": 909, "slug": "lesson-the-disc-pack", "name": "Lesson 9 — The Disc Pack", "tier": 1,
		"family": "disc-detainer", "bitting": [2, 4, 3], "pins": ["standard", "standard", "standard"],
		"discs": {"falseGates": [[], [], []]},
		"toleranceQuality": 1.5, "keyway": "standard", "par": 90,
		"note": "Three discs and a bar, seen through. No pins and no springs.",
	},
	# One shallow notch, on the middle disc, lying in the way of its true gate.
	"lesson-the-false-gate": {
		"id": 910, "slug": "lesson-the-false-gate", "name": "Lesson 10 — The False Gate", "tier": 1,
		"family": "disc-detainer", "bitting": [2, 4, 3], "pins": ["standard", "standard", "standard"],
		"discs": {"falseGates": [[], [2], []]},
		"toleranceQuality": 1.4, "keyway": "standard", "par": 150,
		"note": "One shallow notch, on the middle disc. The bar cannot tell the difference.",
	},
}


# ── The tests ───────────────────────────────────────────────────────────────────────────

static func holding(s: Dictionary) -> bool:
	return float(s["tension"]) >= T_MIN_HOLD


static func any_set(s: Dictionary) -> bool:
	for st: int in s["states"]:
		if st == LockRig.SET:
			return true
	return false


static func all_set(s: Dictionary) -> bool:
	for st: int in s["states"]:
		if st != LockRig.SET:
			return false
	return true


static func any_overset(s: Dictionary) -> bool:
	for st: int in s["states"]:
		if st == LockRig.OVERSET:
			return true
	return false


static func any_false(s: Dictionary) -> bool:
	for st: int in s["states"]:
		if st == LockRig.FALSE_SET:
			return true
	return false


static func on_binder(s: Dictionary) -> bool:
	return int(s["pick"]) >= 0 and int(s["pick"]) == int(s["binding"])


static func is_open(s: Dictionary) -> bool:
	return bool(s["opened"])


static func _step(id: String, line: String, done: Callable, hint: String = "", hint_after: float = 8.0) -> Dictionary:
	return {"id": id, "line": line, "done": done, "hint": hint, "hint_after": hint_after}


## What a step says to a player with fingers on the glass instead of keys under them, by lesson
## and step: [line, hint], "" for the one that names no key and stands as it is.
const TOUCH := {
	"lesson-rotate": {
		"goal": ["The goal is rotation: a lock opens when its plug turns. Drag the wrench slider up and turn it.",
			"The slider on the left edge is the tension wrench. Drag it up — you are turning the plug the way a key would."],
		"blocked": ["", "Tap the pin to put the pick under it — it is carrying all your turning force."],
		"clear": ["Drag up to lift it. When the cut between its halves meets the seam, nothing blocks.", ""],
		"open": ["Nothing crosses the shear line now. Leave the wrench on and the plug turns open.", ""],
	},
	"lesson-1": {
		"tension": ["Drag the wrench slider up. That is the wrench, turning the plug.",
			"The slider on the left edge. Nothing works without it. Higher turns harder."],
		"find": ["Tap a pin to put the pick under it. One pin feels heavier — that is the one.", ""],
		"lift": ["Lift it: drag up, and stop the moment something gives.",
			"Drag up from anywhere to lift; let go and the pin drops. The click is the plug sliding under the driver."],
		"again": ["", "Let go, tap the next pin, then drag up again."],
		"pressure": ["", "The slider's bands are the pressure steps. 5 holds while you work; light is for the lies."],
	},
	"lesson-2": {
		"overset": ["", "Drag a pin up past its click, and hold it there. In a second it jams."],
		"stuck": ["", "Drop the wrench to off — the bottom of the slider. Everything drops, and you start again."],
		"travel": ["Let the pin go before you move on, or the hook drags the pins it passes.",
			"Let go, tap the next pin, then drag up again. That order is the trick."],
	},
	"lesson-pressure": {
		"grip": ["The wrench has ten pressures — the slider's bands. Set it to 5 and set a pin.", ""],
		"heavy": ["Now lean on it: drag the wrench up to 8. Feel the binding pin pinch harder under the same lift.",
			"The slider moves while you work. Take it to 8, then lift and compare."],
	},
	"lesson-3": {
		"false-set": ["", "Hold the counter-rotate pad to ease the plug back, and keep lifting that pin — it goes through."],
	},
	"lesson-serrated": {
		"grind": ["That give was a tooth, not the line. Hold counter-rotate to ease the plug, and lift it again.",
			"Hard turning pins the tooth. Hold counter-rotate while you lift, or drop the wrench a step."],
	},
	"lesson-wheels": {
		"pull": ["A different animal, seen through. Press and hold the shackle — a tooth jams on a wheel.",
			"Your finger on the shackle is the pull. Its teeth only pass wheels whose clear gate is in the path."],
		"find": ["One wheel drags under the pull. Tap a wheel to choose it — find the stiff one.", ""],
		"dial": ["Drag the wheel: it rolls. Bring the clear gate into the tooth’s path — it lets go.",
			"Stuck on a shallow lie? Let the shackle go — the wheel frees. Then pull and roll on."],
	},
	"lesson-gun": {
		"arm": ["This gun strikes every pin at once. Drag the wrench up a little for light tension — the plug needs it.",
			"The slider is the wrench. Keep it light: too hard and the pinched pin cannot jump at all."],
		"strike": ["Hold the strike pad to draw the needle back, then let go. Every pin jumps — a lucky one catches at the line.", ""],
	},
	"lesson-discs": {
		"tension": ["No pins here: three discs, and one bar across the top. Drag the wrench slider up — the bar comes down on them.",
			"The slider on the left edge is the wrench. It turns the sleeve, and the body's groove pushes the bar down onto the discs."],
		"find": ["The bar is resting on one disc, and that disc is stiff. Tap a disc to put the pick in it — find it.",
			"Drag up to turn the disc the pick is in. The one under the bar turns heavy; the others spin light."],
		"turn": ["Drag up to turn it until its notch is under the bar, and stop: keep pushing and it rides on past.",
			"Gone past? Drag down to turn it back. A disc stays wherever you leave it — it has no spring."],
		"rest": ["Same again for each disc the bar lands on. Nothing falls back here: slide the wrench off and every disc stays put.", ""],
	},
	"lesson-false-gate": {
		"caught": ["", "Hold the counter-rotate pad to ease the sleeve back: the bar lifts out. Keep it held and drag up to turn the disc on."],
		"through": ["Out. Let the pad go and keep turning: the deep notch is further round.", ""],
	},
}


static var _lessons: Array[Dictionary] = []


static func all() -> Array[Dictionary]:
	if _lessons.is_empty():
		_build()
	return _lessons


static func by_id(id: String) -> Dictionary:
	for l in all():
		if l["id"] == id:
			return l
	return {}


static func is_lesson_lock(slug: String) -> bool:
	return LOCKS.has(slug)


static func _build() -> void:
	_lessons = [
		{
			# The lesson for a player with zero knowledge: not technique, the premise.
			"id": "lesson-rotate", "title": "The turn",
			"teaches": "Why a lock opens: the plug turns, and one pin stops it.",
			"lock": LOCKS["lesson-the-turn"],
			"steps": [
				_step("goal", "The goal is rotation: a lock opens when its plug turns. Hold Q and turn it.", holding,
					"Q is the tension wrench. Hold it — you are turning the plug the way a key would.", 6.0),
				_step("blocked", "It stopped. The pin is crossing the shear line — the seam the plug turns along.",
					func(s: Dictionary) -> bool: return holding(s) and on_binder(s),
					"Arrow keys move the pick. Go to the pin — it is carrying all your turning force.", 8.0),
				_step("clear", "Lift it with Space. When the cut between its halves meets the seam, nothing blocks.",
					any_set, "Slowly. The click is the plug edge catching under the driver — that pin is done.", 10.0),
				_step("open", "Nothing crosses the shear line now. Keep holding Q and the plug turns open.", is_open),
			],
		},
		{
			"id": "lesson-1", "title": "Tension and lift",
			"teaches": "Tension on, find the binding pin, lift until it clicks.",
			"lock": LOCKS["lesson-tension-and-lift"],
			"steps": [
				_step("tension", "Hold Q. That is the wrench, turning the plug.", holding,
					"Q, and keep holding it. Nothing works without it. 1-0 set how hard.", 6.0),
				_step("find", "Left and right move along the keyway. One pin feels heavier — that is the one.",
					on_binder, "Push each pin a little and watch the resistance column beside the lock.", 8.0),
				_step("lift", "Lift it. Hold Space, and let go the moment something gives.", any_set,
					"Space lifts while you hold it. The click is the plug sliding under the driver.", 10.0),
				# Ends when they have arrived at the new binding pin, so the next line lands while
				# they are actually working it.
				_step("again", "One down. The lock has moved on to another pin — find it the same way.",
					func(s: Dictionary) -> bool: return any_set(s) and int(s["binding"]) >= 0 and on_binder(s),
					"Release Space, arrow across, then hold Space again.", 8.0),
				# How hard to turn, taught one pin in — the first time there is anything to lose.
				_step("pressure", "Keep the pressure up while you work — too light and a hard push rolls the plug back.",
					all_set, "1 to 0 are the pressure steps. 5 holds while you work; light is for the lies.", 7.0),
				_step("open", "Every pin is up. Keep the tension on and let it turn.", is_open),
			],
		},
		{
			"id": "lesson-2", "title": "Overset and reset",
			"teaches": "Lifting too far jams the pin; dropping tension starts over.",
			"lock": LOCKS["lesson-overset-and-reset"],
			"steps": [
				_step("start", "Same as before: tension on, find the heavy pin, lift.",
					func(s: Dictionary) -> bool: return any_set(s) or any_overset(s)),
				# Waits for the wedge, not a passing overshoot — a brief one frees itself.
				_step("overset", "Now break it on purpose: push one pin too far and keep pushing.",
					func(s: Dictionary) -> bool: return float(s["overset_for"]) > 0.6,
					"Hold Space on a pin past its click, and keep holding. In a second it jams.", 12.0),
				_step("stuck", "That pin is jammed into the shell, and nothing you do with the pick will free it.",
					func(s: Dictionary) -> bool: return int(s["full_resets"]) > 0,
					"Let go of Q. Everything drops, and you start again.", 5.0),
				_step("recover", "That is a reset. It costs you everything — so lift less, and stop sooner.", any_set),
				# Holding the push through a move drags the hook under whatever it passes.
				_step("travel", "Let Space go before you move on, or the hook drags the pins it passes.", all_set,
					"Release Space, then arrow across, then hold Space again. That order is the trick.", 10.0),
				_step("open", "All three. Turn it.", is_open),
			],
		},
		{
			# The skill the security-pin lessons lean on, taught before either needs it.
			"id": "lesson-pressure", "title": "Wrench pressure",
			"teaches": "How hard to turn: heavy holds pins, light frees them.",
			"lock": LOCKS["lesson-wrench-pressure"],
			"steps": [
				_step("grip", "The wrench has ten pressures — keys 1 to 0. Hold Q at 5 and set a pin.", any_set,
					"Middle pressure is the all-rounder: firm enough to hold, light enough to lift.", 10.0),
				_step("heavy", "Now lean on it: press 8. Feel the binding pin pinch harder under the same lift.",
					func(s: Dictionary) -> bool: return float(s["tension"]) >= 0.75,
					"The number keys change pressure while you hold Q. Press 8, then lift and compare.", 8.0),
				_step("feather", "Ease back to 3 — the pinch lets go. Dropping steps eases the plug back for a moment.",
					func(s: Dictionary) -> bool:
						return any_set(s) and float(s["tension"]) >= T_MIN_HOLD and float(s["tension"]) <= 0.42,
					"Light cannot wedge a pin, but a hard push rolls the plug back off your last set.", 8.0),
				_step("open", "Open it however you like — pressure is a dial you ride, not a setting you pick.", is_open),
			],
		},
		{
			"id": "lesson-3", "title": "The spool",
			"teaches": "A spool lies. Recognise the false set, ease the plug, push through.",
			"lock": LOCKS["lesson-the-spool"],
			"steps": [
				_step("start", "One of these three is not a plain pin. Work them as usual and find out which.",
					func(s: Dictionary) -> bool: return int(s["false_sets"]) > 0),
				_step("false-set", "The plug just gave, and that pin feels set. It is not — that is a spool lying.",
					func(s: Dictionary) -> bool: return bool(s["fooled_then_set"]),
					"Hold C to ease the plug back, and keep holding Space on that pin — it goes through.", 8.0),
				_step("through", "You eased the plug off its waist and pushed it through. The wrench alone never lets it.",
					all_set),
				_step("open", "Every real lock past here has pins like that one. Turn it.", is_open),
			],
		},
		{
			"id": "lesson-serrated", "title": "The serrated pin",
			"teaches": "A tooth clicks like a set. Ease off it and lift through.",
			"lock": LOCKS["lesson-the-serrated"],
			"steps": [
				_step("start", "The middle pin is serrated. Work the lock and watch for a give that lies.",
					func(s: Dictionary) -> bool: return int(s["false_sets"]) > 0),
				_step("grind", "That give was a tooth, not the line. Hold C to ease the plug, and lift it again.",
					func(s: Dictionary) -> bool: return bool(s["serrated_set"]),
					"Hard turning pins the tooth. Hold C while you lift, or drop the pressure a step (W).", 10.0),
				_step("open", "Four lies, one truth: the real set is the one that stays. Turn it.", is_open),
			],
		},
		{
			# The second family, taught the way the first was: a lock with nothing on it but the idea.
			"id": "lesson-wheels", "title": "The wheel pack",
			"teaches": "The second family: pull the shackle, find the dragging wheel, dial it.",
			"lock": LOCKS["lesson-the-wheel-pack"],
			"steps": [
				_step("pull", "A different animal, seen through. Hold Q and pull — a tooth jams on a wheel.", holding,
					"Q is the shackle now. Its teeth only pass wheels whose clear gate is in the path.", 6.0),
				_step("find", "One wheel drags under the pull. Arrows move between wheels — find the stiff one.",
					func(s: Dictionary) -> bool: return holding(s) and on_binder(s),
					"Cross the pack slowly. The bound wheel turns heavy; free ones spin light.", 8.0),
				_step("dial", "Hold Space: the wheel rolls. Bring the clear gate into the tooth’s path — it lets go.",
					any_set, "Stuck on a shallow lie? Ease Q right off — the wheel frees. Then pull and roll on.", 10.0),
				_step("transfer", "The drag has moved to another wheel: the pack gives its wheels up in order.",
					func(s: Dictionary) -> bool: return any_set(s) and int(s["binding"]) >= 0 and on_binder(s),
					"Same hunt. Find the wheel that drags now — the seated one is done for good.", 8.0),
				_step("open", "All three gates in line: nothing stops the teeth. Keep pulling — the shackle goes.", is_open),
			],
		},
		{
			# A different verb from every lesson before it: no hunting the binding pin — the tool
			# hits all the pins at once and luck decides which catch.
			"id": "lesson-gun", "title": "The snap gun", "gun": true,
			"teaches": "A different tool: strike every pin at once and let luck catch them.",
			"lock": LOCKS["lesson-the-snap-gun"],
			"steps": [
				_step("arm", "This gun strikes every pin at once. Hold Q for light tension — the plug needs it.", holding,
					"Q is the wrench. Keep it light: too hard and the pinched pin cannot jump at all.", 6.0),
				_step("strike", "Hold Space to draw the needle back, then let go. Every pin jumps — a lucky one catches at the line.",
					any_set, "A longer hold strikes harder. Too soft and no pin reaches the line; try holding longer.", 6.0),
				_step("pop", "A pin caught and held. Keep striking; when the last one catches, the plug turns.", is_open,
					"A pin must be thrown over its line to catch. Falling short? Hold longer — or ease the wrench.", 8.0),
			],
		},
		{
			# The third family. It is the wheel pack's hunt again — find the one that drags, bring
			# its gate round — inside a cylinder, with a wrench and a pick.
			"id": "lesson-discs", "title": "The disc pack",
			"teaches": "No pins, no springs: turn each disc until the bar drops into its gate.",
			"lock": LOCKS["lesson-the-disc-pack"],
			"steps": [
				_step("tension", "No pins here: three discs, and one bar across the top. Hold Q — the bar comes down on them.", holding,
					"Q is the wrench. It turns the sleeve, and the body's groove pushes the bar down onto the discs.", 6.0),
				_step("find", "The bar is resting on one disc, and that disc is stiff. Arrows move the pick — find it.",
					func(s: Dictionary) -> bool: return holding(s) and on_binder(s),
					"Space turns the disc the pick is in. The one under the bar turns heavy; the others spin light.", 8.0),
				_step("turn", "Turn it with Space until its notch is under the bar, and stop: keep pushing and it rides on past.",
					any_set, "Gone past? Down turns it back. A disc stays wherever you leave it — it has no spring.", 10.0),
				_step("next", "The bar has gone down onto another disc: the pack gives its discs up in order.",
					func(s: Dictionary) -> bool: return any_set(s) and int(s["binding"]) >= 0 and on_binder(s),
					"Same hunt. The stiff disc is the one the bar is on now — the one it dropped into is done.", 8.0),
				# What sets this lock apart from every one before it, said while there is still a
				# disc left to try it on.
				_step("rest", "Same again for each disc the bar lands on. Nothing falls back here: let Q go and every disc stays put.",
					all_set, "A disc has no spring. Take the wrench off and put it back: the bar drops into the same gates.", 10.0),
				_step("open", "Every notch in line and the bar drops clear of the body. Keep the wrench on — the sleeve turns.", is_open),
			],
		},
		{
			"id": "lesson-false-gate", "title": "The false gate",
			"teaches": "A shallow notch takes the bar and holds the disc. Ease the sleeve and turn on.",
			"lock": LOCKS["lesson-the-false-gate"],
			"steps": [
				_step("start", "The middle disc has two notches, and the first one round is shallow. Work the pack as before.",
					func(s: Dictionary) -> bool: return int(s["false_sets"]) > 0),
				_step("caught", "The bar dropped, but only part-way — and now that disc will not turn. That is a false gate.",
					func(s: Dictionary) -> bool: return int(s["false_sets"]) > 0 and not any_false(s),
					"Hold C to ease the sleeve back: the bar lifts out. Keep C held and turn the disc on with Space.", 8.0),
				_step("through", "Out. Let C go and keep turning: the deep notch is further round.",
					func(s: Dictionary) -> bool: return bool(s["fooled_then_set"]),
					"The true gate is the deep one: in the front view it is cut far down into the disc.", 10.0),
				_step("open", "A false gate holds a disc just as a true one does — until the bar has to go all the way down.", is_open),
			],
		},
	]


# ── Running a lesson ────────────────────────────────────────────────────────────────────

## A lesson in progress: which step, how long on it, whether it is over.
class Run:
	var lesson: Dictionary
	var step := 0
	var on_step_for := 0.0
	var complete := false

	func _init(the_lesson: Dictionary) -> void:
		lesson = the_lesson

	## Advance against live state. Steps only ever move forward, and a step whose test is already
	## true when it becomes current is skipped — a player who works out the next thing before
	## being told is never made to sit through being told it.
	func update(s: Dictionary, dt: float) -> void:
		if complete:
			return
		on_step_for += dt
		var steps: Array = lesson["steps"]
		# Opening the lock ends the lesson, whatever step it was on: the play decides when the
		# teaching is over.
		if bool(s["opened"]):
			step = steps.size()
			complete = true
			return
		var guard := 0
		while step < steps.size() and guard < 32:
			var done: Callable = steps[step]["done"]
			if not done.call(s):
				break
			step += 1
			on_step_for = 0.0
			guard += 1
		if step >= steps.size():
			complete = true

	## The single line to show right now, or "" once the lesson is done. `fingers`: the player is
	## on a touch screen, and a line that names a key says what the fingers do instead.
	func line(fingers: bool = false) -> String:
		var steps: Array = lesson["steps"]
		if complete or step >= steps.size():
			return ""
		var st: Dictionary = steps[step]
		var said: Array = [st["line"], st["hint"]]
		if fingers:
			var theirs: Array = (Lessons.TOUCH.get(lesson["id"], {}) as Dictionary).get(st["id"], ["", ""])
			for k in 2:
				if str(theirs[k]) != "":
					said[k] = theirs[k]
		if str(said[1]) != "" and on_step_for >= float(st["hint_after"]):
			return said[1]
		return said[0]

	func total() -> int:
		return (lesson["steps"] as Array).size()
