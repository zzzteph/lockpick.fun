extends GameScreen
## The bench: one tier of locks at a time, chosen from the strip above the cards, plus four
## shelves at the end of it — the combination locks, the disc detainers, the pin locks the pick
## gun can open, and the locks the player built. Each card is a small drawing of the lock, what
## it is made of, and your record on it.
##
## Before the first lesson there is no bench to show: the page says why, and offers the one
## way forward.

## The combination locks have a page of their own rather than a seventh card on a tier page.
## They keep their real `tier` for unlocking and par; the shelf is presentation. Zero is not a
## tier, which is what makes it a safe value to keep in the same slot as one.
const WHEELS_SHELF := 0
## The pick-gun shelf: a technique, not a family — the same pin locks, played with the snap gun.
const GUN_SHELF := -1
## The player's own designs, saved from the editor.
const YOURS_SHELF := -2
## The disc detainers: a family of their own, shelved the way the combination locks are — each
## keeps its real `tier` for unlocking and par, and none of them is a card on a tier page.
const DISCS_SHELF := -3
## The gun's six locks. Every one is all-standard pins, because the gun only catches standard
## drivers: a spooled lock here would be a lock the tool cannot open. Ordered by pin count, so
## the shelf reads as a difficulty run.
const GUN_LOCKS: Array[String] = [
	"clear-practice-cutaway", "brasswell-no1-luggage", "brasswell-bike-padlock",
	"northgate-shed-padlock", "northgate-5-pin-cabinet", "kestrel-door-cylinder",
]

## On a grid line, so the paper's rule does not sit as a second line just above the buttons.
const STRIP_Y := 160.0
const STRIP_H := 56.0
const STRIP_GAP := 12.0
const COLS := 3
const GAP := 24.0
const CARD_H := 250.0
const GRID_TOP := 307.0
## What fits on a page: two rows of three. Only the player's own shelf can outgrow it.
const PER_PAGE := 6
const PAGER_Y := GRID_TOP + CARD_H * 2.0 + GAP + 20.0
const STUDY_LINE := "study mode — pick any lock to feel it out. No clock, no rank, nothing recorded."

## The page before the first lesson: what it says, and where its one button sits under it.
const CLOSED_HEAD := "The bench opens after the first lesson."
const CLOSED_WHY := "Five minutes on a one-pin lock teaches what every lock here asks of you: turn the plug, " \
	+ "find the pin that stops it, and lift that pin until it catches. Finish it and the first tier of locks opens."
const CLOSED_Y := 236.0
const CLOSED_WIDTH := 980.0
const CLOSED_LINE := 30.0

var _taught := false
var _tier := 1
var _locks: Array[Dictionary] = []
var _cards: Array[Rect2] = []
var _open: Array[bool] = []
## The words under each strip button whose tier is still locked: [rect, text].
var _notes: Array = []
## Why the page on show is locked, or "".
var _why := ""
## The player's shelf: how many designs there are, and which of them this page starts at.
var _yours := 0
var _from := 0
## Which control takes the focus once the page is rebuilt: the one that was just pressed.
var _focus := &"card"


func build() -> void:
	title = "Bench"
	var progress: Progress = app.progress
	nav([
		["Editor", func() -> void: app.goto(&"editor")],
		["Menu", func() -> void: app.goto(&"menu")],
	])
	_locks.clear()
	_cards.clear()
	_open.clear()
	_notes.clear()
	_why = ""
	# The first lesson gates the whole bench. It is five minutes, and it is the difference
	# between a game and a wall — so the page says that, and gives the way to it.
	_taught = progress.has_started_lessons()
	if not _taught:
		status = "the bench opens once the first lesson is done"
		var start := Kit.button(self, Rect2(LEFT, _closed_button_y(), 420.0, 56.0), "Start the tutorial",
			func() -> void: app.goto(&"tutorial"), true)
		start.grab_focus.call_deferred(true)
		return
	# What study mode means goes in the status line: the one place on every screen that exists
	# for a sentence about what the screen is currently doing.
	status = STUDY_LINE if app.inspect_next else progress.ranked_line()
	var tiers := _tiers()
	_tier = _current_tier(tiers)

	var chosen := _build_strip(tiers)

	# One switch on the strip rather than a "study" button on every card: it is a mode you turn
	# on once, and the cards keep meaning "pick this".
	var study_w := Kit.caption_width("Study mode") + 12.0
	var study := KitToggle.make(self, Rect2(1920.0 - MARGIN - 28.0 - study_w, STRIP_Y, study_w, STRIP_H), "Study mode",
		app.inspect_next, _set_study)
	Kit.describe(study, "Study mode", "pick any lock with no clock, no rank and nothing recorded")

	# A family's shelf is always open to look at; each card on it waits for its own tier.
	var on_family := _tier == WHEELS_SHELF or _tier == DISCS_SHELF
	var on_gun := _tier == GUN_SHELF
	var on_yours := _tier == YOURS_SHELF
	var unlocked := on_family or on_gun or on_yours or progress.is_tier_unlocked(_tier)
	if not unlocked:
		_why = "locked — %s" % _unlock_text(_tier)

	_locks = _locks_on(_tier)
	_yours = 0
	_from = 0
	if on_yours:
		_yours = _locks.size()
		var pages := maxi(1, ceili(_yours / float(PER_PAGE)))
		var page := clampi(int(app.memo.get("bench_yours_page", 0)), 0, pages - 1)
		_from = page * PER_PAGE
		_locks = _locks.slice(_from, _from + PER_PAGE)

	var card_w := floorf((WIDTH - GAP * (COLS - 1)) / COLS)
	var first: Control
	for i in _locks.size():
		var def := _locks[i]
		# On a family's shelf a card is as open as its own tier: the luggage lock is a
		# first-hour lock and the strongbox is not.
		var open := unlocked and (not on_family or progress.is_tier_unlocked(def["tier"]))
		var rect := Rect2(LEFT + (card_w + GAP) * (i % COLS), GRID_TOP + floorf(i / float(COLS)) * (CARD_H + GAP),
			card_w, CARD_H)
		_cards.append(rect)
		_open.append(open)
		var card := Kit.card(self, rect, _start.bind(def), not open, str(def["name"]), _spoken(def, open))
		if open and first == null:
			first = card

	var turner: Control
	if on_yours:
		if _yours == 0:
			# An empty shelf says where its locks come from, and goes there.
			first = Kit.button(self, Rect2(LEFT, GRID_TOP + 52.0, 320.0, 56.0), "Open the editor",
				func() -> void: app.goto(&"editor"), true)
		elif _yours > PER_PAGE:
			turner = _build_pager()

	var target: Control = first
	if _focus == &"strip" or target == null:
		target = chosen
	if turner != null:
		target = turner
	_focus = &"card"
	if target != null:
		target.grab_focus.call_deferred(true)


## The strip: one of these is on show at a time, so they are a set of choices that says which
## is chosen — to the eye by inversion, to a screen reader as a pressed toggle. Returns the
## chosen one.
func _build_strip(tiers: Array[int]) -> Button:
	var progress: Progress = app.progress
	# [caption, shelf, width, spoken name]
	var cells: Array = []
	var tier_w := maxf(170.0, Kit.caption_width("tier 4"))
	for t in tiers:
		cells.append(["tier %d" % t, t, tier_w, "Tier %d" % t])
	cells.append(["combination", WHEELS_SHELF, maxf(200.0, Kit.caption_width("combination")), "Combination locks"])
	cells.append(["discs", DISCS_SHELF, maxf(120.0, Kit.caption_width("discs")), "Disc detainer locks"])
	cells.append(["pick gun", GUN_SHELF, maxf(150.0, Kit.caption_width("pick gun")), "Pick gun"])
	cells.append(["your locks", YOURS_SHELF, maxf(180.0, Kit.caption_width("your locks")), "Your locks"])
	var group := ButtonGroup.new()
	var x := LEFT + 90.0
	var chosen: Button
	var nearest := true
	for cell: Array in cells:
		var t: int = cell[1]
		var w: float = cell[2]
		var rect := Rect2(x, STRIP_Y, w, STRIP_H)
		var b := Kit.button(self, rect, str(cell[0]), _choose.bind(t))
		b.theme_type_variation = "SegmentOn" if t == _tier else "Segment"
		b.toggle_mode = true
		b.button_group = group
		b.set_pressed_no_signal(t == _tier)
		b.accessibility_name = str(cell[3])
		if t == _tier:
			chosen = b
		# A locked tier can still be looked at: aspiration is the point of showing it. The
		# nearest one says what it is waiting for; the ones past it only that they are locked.
		if t > 0 and not progress.is_tier_unlocked(t):
			var need := progress.opens_needed_for(t)
			_notes.append([rect, "%d more tier-%d open%s" % [need, t - 1, "" if need == 1 else "s"] if nearest
				else "locked"])
			Kit.describe(b, "%s, locked" % cell[3], _unlock_text(t))
			nearest = false
		x += rect.size.x + STRIP_GAP
	return chosen


## Previous and Next under the cards, for a shelf with more designs than a page holds. Returns
## the one to focus after a turn, or null when the page was not just turned.
func _build_pager() -> Control:
	var page := floori(_from / float(PER_PAGE))
	var last := ceili(_yours / float(PER_PAGE)) - 1
	var w := _pager_width()
	var back := Kit.button(self, Rect2(LEFT, PAGER_Y, w, 44.0), "Previous", _turn.bind(page - 1, &"back"))
	var on := Kit.button(self, Rect2(LEFT + w + 16.0, PAGER_Y, w, 44.0), "Next", _turn.bind(page + 1, &"on"))
	Kit.describe(back, "Previous page of your locks")
	Kit.describe(on, "Next page of your locks")
	back.disabled = page == 0
	on.disabled = page == last
	for b: Button in [back, on]:
		if b.disabled:
			b.focus_mode = Control.FOCUS_NONE
	# Turning a page rebuilds it: the focus stays on the turner just pressed, or moves to the
	# other one at the end of the run.
	if _focus == &"back":
		return back if not back.disabled else on
	if _focus == &"on":
		return on if not on.disabled else back
	return null


static func _pager_width() -> float:
	return maxf(170.0, Kit.caption_width("Previous"))


func paint() -> void:
	if not _taught:
		plain(Vector2(LEFT, CLOSED_Y), CLOSED_HEAD, Pal.T_HEADING, Pal.INK)
		paragraph(Vector2(LEFT, CLOSED_Y + 46.0), CLOSED_WHY, Pal.T_BODY, Pal.INK_LIGHT, CLOSED_WIDTH, CLOSED_LINE)
		return
	tracked(Vector2(LEFT, STRIP_Y + 26.0), "tiers", Pal.T_DIM, Pal.INK_LIGHT)
	# A padlock would be a second icon language on a screen that has none. The words are clearer.
	# They hang far enough under the button to stay clear of its focus marks.
	for note: Array in _notes:
		var cell: Rect2 = note[0]
		plain(Vector2(cell.get_center().x, cell.end.y + Pal.T_DIM + 10.0), str(note[1]), Pal.T_DIM, Pal.INK_LIGHT,
			HORIZONTAL_ALIGNMENT_CENTER)
	if _why != "":
		plain(Vector2(LEFT, GRID_TOP - 24.0), _why, Pal.T_BODY, Pal.AMBER_TEXT)
	for i in _locks.size():
		_paint_card(_locks[i], _cards[i], _open[i])
	if _tier == YOURS_SHELF:
		if _yours == 0:
			plain(Vector2(LEFT, GRID_TOP + 24.0), "nothing here yet — build a lock in the editor", Pal.T_BODY, Pal.INK)
		elif _yours > PER_PAGE:
			plain(Vector2(LEFT + _pager_width() * 2.0 + 40.0, PAGER_Y + 22.0 + Pal.T_BODY * 0.36),
				"%d–%d of %d" % [_from + 1, _from + _locks.size(), _yours], Pal.T_BODY, Pal.INK_LIGHT)


func _paint_card(def: Dictionary, r: Rect2, open: bool) -> void:
	var progress: Progress = app.progress
	# The hatch goes on before the writing: under the type it still says "not yet" without
	# eating the words a locked tier is shown for.
	if not open:
		Pal.hatch_rect(pen, r, 11.0, 45.0, Color(Pal.RULE, 0.35), 1.0)
		# The faint frame again, as a true hairline: a 1 px stylebox border falls between pixels
		# on a scaled stage, and a locked card would lose a side.
		pen.draw_rect(r.grow(-0.5), Pal.RULE, false, Pal.HAIRLINE)
	var on_gun := _tier == GUN_SHELF
	var record := progress.record(str(def["slug"]))
	# The gun keeps a ledger of its own: a bump is not a pick, so a gun card never reads the
	# roster's record and carries no rank letter.
	var ranked: bool = not on_gun and record["opens"] > 0

	# A name is a label on a box, so the box wins: shrunk until it fits — but never below the
	# smallest type the game sets, which every name the roster or the editor can make clears.
	var lock_name := str(def["name"])
	var room := r.size.x - (110.0 if ranked else 44.0)
	var name_size := mini(Pal.T_HEADING, int(r.size.y * 0.15))
	while name_size > Pal.T_DIM and Pal.text_width(lock_name, name_size) > room:
		name_size -= 1
	plain(r.position + Vector2(22.0, 38.0), lock_name, name_size, Pal.INK if open else Pal.INK_LIGHT)
	draw_lock_glyph(pen, def, Rect2(r.position + Vector2(22.0, 58.0), Vector2(220.0, 118.0)), not open, 9.0)

	# What it is made of, down the right of the drawing. A design of the player's own also says
	# how many of its pins can lie: it is the one thing its name does not promise.
	var facts: Array[String] = [_chambers_text(def)]
	if _tier == YOURS_SHELF:
		facts.append(_security_text(def))
	elif _tier == DISCS_SHELF:
		facts.append(_false_gates_text(def))
	facts.append("par %ss" % WebNum.text(def["par"]))
	for i in facts.size():
		plain(r.position + Vector2(266.0, 92.0 + i * (Pal.T_BODY + 12.0)), facts[i], Pal.T_BODY, Pal.INK_LIGHT)

	var foot := r.position + Vector2(22.0, r.size.y - 20.0)
	if not open:
		# Locked is a word as well as a hatch. Under a tier the line above the cards says what it
		# is waiting for; on the combination shelf each card waits for a tier of its own.
		plain(foot, "locked — opens with tier %d" % def["tier"] if _tier == WHEELS_SHELF or _tier == DISCS_SHELF
			else "locked", Pal.T_BODY, Pal.INK_LIGHT)
	elif on_gun:
		var bumps := progress.gun_opens(str(def["slug"]))
		plain(foot, "bumped %dx" % bumps if bumps > 0 else "not yet bumped", Pal.T_BODY,
			Pal.TEAL_TEXT if bumps > 0 else Pal.INK_LIGHT)
	elif ranked:
		var best: Variant = record["bestTime"]
		plain(foot, "opened %dx  ·  best %ss" % [record["opens"], "—" if best == null else WebNum.to_fixed(best, 1)],
			Pal.T_BODY, Pal.TEAL_TEXT)
		# The best rank, large, in the corner: a letter is comparable across the whole page where
		# a list of best times is not. In the quiet ink until it reaches D — the bar the next tier
		# is waiting on — and the letter itself says which side of that bar it is.
		tracked(r.position + Vector2(r.size.x - 46.0, 60.0), Ranks.letter_for(record["bestRank"]), Pal.T_PAYOUT,
			Pal.TEAL_TEXT if Ranks.counts_for_tier(record["bestRank"]) else Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_CENTER, true)
	else:
		plain(foot, "not yet opened", Pal.T_BODY, Pal.INK_LIGHT)


# ── What a card says ────────────────────────────────────────────────────────────────────

static func _chambers_text(def: Dictionary) -> String:
	var n := LockDefs.chamber_count(def)
	var part := "chamber"
	match str(def.get("family", "")):
		"combination":
			part = "wheel"
		"disc-detainer":
			part = "disc"
	return "%d %s" % [n, part + ("" if n == 1 else "s")]


static func _false_gates_text(def: Dictionary) -> String:
	var n := DiscRig.false_count(def)
	return "no false gates" if n == 0 else "%d false gate%s" % [n, "" if n == 1 else "s"]


static func _security_text(def: Dictionary) -> String:
	var n := 0
	for pin: Variant in def.get("pins", []):
		if Profiles.is_security(str(pin)):
			n += 1
	return "no security pins" if n == 0 else "%d security pin%s" % [n, "" if n == 1 else "s"]


## What unlocks a tier, in words that finish "locked — ".
func _unlock_text(tier: int) -> String:
	var progress: Progress = app.progress
	if not progress.is_tier_unlocked(tier - 1):
		return "unlock tier %d first" % (tier - 1)
	var need := progress.opens_needed_for(tier)
	return "open %d more tier %d lock%s at rank D or better" % [need, tier - 1, "" if need == 1 else "s"]


## A card read aloud, after its name: what the lock is made of and the record on it — or why
## it cannot be picked yet.
func _spoken(def: Dictionary, open: bool) -> String:
	var progress: Progress = app.progress
	var parts: Array[String] = [_chambers_text(def)]
	if _tier == YOURS_SHELF:
		parts.append(_security_text(def))
	elif _tier == DISCS_SHELF:
		parts.append(_false_gates_text(def))
	parts.append("par %s seconds" % WebNum.text(def["par"]))
	if not open:
		parts.append("locked — %s" % _unlock_text(def["tier"]))
	elif _tier == GUN_SHELF:
		var bumps := progress.gun_opens(str(def["slug"]))
		parts.append("not yet bumped" if bumps == 0 else "bumped open %d time%s" % [bumps, "" if bumps == 1 else "s"])
	else:
		var record := progress.record(str(def["slug"]))
		var opens: int = record["opens"]
		if opens == 0:
			parts.append("not yet opened")
		else:
			parts.append("opened %d time%s" % [opens, "" if opens == 1 else "s"])
			if record["bestTime"] != null:
				parts.append("best time %s seconds" % WebNum.to_fixed(record["bestTime"], 1))
			parts.append("best rank %s" % Ranks.letter_for(record["bestRank"]))
	return ", ".join(parts)


# ── What the strip does ─────────────────────────────────────────────────────────────────

func _choose(tier: int) -> void:
	app.memo["bench_tier"] = tier
	_focus = &"strip"
	rebuild()


## Nothing on the page is built from the mode, so nothing is rebuilt: the box takes its tick and
## the status line says what that means.
func _set_study(on: bool) -> void:
	app.inspect_next = on
	status = STUDY_LINE if on else app.progress.ranked_line()


func _turn(page: int, pressed: StringName) -> void:
	app.memo["bench_yours_page"] = page
	_focus = pressed
	rebuild()


func _start(def: Dictionary) -> void:
	app.start_lock(def, -1, app.inspect_next, _tier == GUN_SHELF)


## Where the closed page's button sits: under its paragraph, however that wrapped.
static func _closed_button_y() -> float:
	return CLOSED_Y + 46.0 + wrap_text(CLOSED_WHY, Pal.T_BODY, CLOSED_WIDTH).size() * CLOSED_LINE + 10.0


static func _tiers() -> Array[int]:
	var out: Array[int] = []
	for def in Roster.all():
		if not out.has(int(def["tier"])):
			out.append(int(def["tier"]))
	out.sort()
	return out


## The page last chosen, or — on a first visit — the deepest tier reached: that is where the
## player left off, and it saves a click on every visit for everybody past the first hour.
func _current_tier(tiers: Array[int]) -> int:
	var kept: Variant = app.memo.get("bench_tier")
	if kept is int and (tiers.has(kept) or kept == WHEELS_SHELF or kept == DISCS_SHELF or kept == GUN_SHELF
			or kept == YOURS_SHELF):
		return kept
	return app.progress.highest_unlocked_tier()


func _locks_on(tier: int) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	if tier == YOURS_SHELF:
		for def: Dictionary in app.progress.custom_locks():
			out.append(def)
		return out
	if tier == GUN_SHELF:
		for slug in GUN_LOCKS:
			var def := Roster.by_slug(slug)
			if not def.is_empty():
				out.append(def)
		return out
	for def in Roster.all():
		var family := str(def.get("family", ""))
		var here := false
		if tier == WHEELS_SHELF:
			here = family == "combination"
		elif tier == DISCS_SHELF:
			here = family == "disc-detainer"
		else:
			here = family == "pin-tumbler" and def["tier"] == tier
		if here:
			out.append(def)
	return out


# ── The lock, drawn small ───────────────────────────────────────────────────────────────

## A small side elevation of a lock, sized to `rect`, on whatever is being drawn on.
##
## Drawn from the lock's own data rather than as a generic icon, so two cards differ exactly
## where the locks do: a spool's waist, a serrated pin's steps, the depth of each cut.
## `max_pin_width` is the widest a pin stack may get — a card wants 4, a big preview more.
static func draw_lock_glyph(on: CanvasItem, def: Dictionary, rect: Rect2, locked: bool,
		max_pin_width: float = 4.0) -> void:
	var ink := Pal.RULE if locked else Pal.INK_LIGHT
	var n := LockDefs.chamber_count(def)
	if n <= 0:
		return
	if str(def.get("family", "")) == "combination":
		_draw_padlock(on, rect, n, ink)
		return
	if str(def.get("family", "")) == "disc-detainer":
		_draw_disc_pack(on, rect, def, ink, locked)
		return

	var shear := rect.position.y + rect.size.y * 0.5
	# Shell above, plug below, in the two brasses the cutaway uses — so a card reads as a small
	# picture of the thing you are about to open. A locked card's glyph is a ghost: no fill.
	if not locked:
		on.draw_rect(Rect2(rect.position, Vector2(rect.size.x, rect.size.y * 0.5)), Color(Pal.SHELL_BODY, 0.5))
		on.draw_rect(Rect2(rect.position.x, shear, rect.size.x, rect.size.y * 0.5), Color(Pal.PLUG_BODY, 0.5))
	on.draw_rect(rect, ink, false, Pal.HAIRLINE)
	on.draw_line(Vector2(rect.position.x, shear), Vector2(rect.end.x, shear), ink, Pal.HAIRLINE)
	# The keyway, along the bottom of the plug.
	var keyway := rect.position.y + rect.size.y * 0.84
	on.draw_line(Vector2(rect.position.x + 2.0, keyway), Vector2(rect.end.x - 2.0, keyway), ink, Pal.HAIRLINE)

	var pins: Array = def.get("pins", [])
	var bitting: Array = def.get("bitting", [])
	var pitch := rect.size.x / n
	var half := maxf(1.5, minf(max_pin_width, pitch * 0.26))
	# How far a groove's shoulders run either side of its waist — scaled with the stack, so a
	# spool still reads as a spool when the drawing is blown up.
	var nick := maxf(1.0, half * 0.25)
	var top := rect.position.y + 3.0
	var bottom := keyway - 1.0
	for i in n:
		var cx := rect.position.x + pitch * (i + 0.5)
		# The driver, narrowed wherever its profile really has a groove — read off the pin's own
		# bands, not a table of names. Bands run bottom-up and the driver is drawn top-down.
		var bands := Profiles.bands(str(pins[i]) if i < pins.size() else "standard")
		var total := 0.0
		for band: Array in bands:
			total += band[0]
		var cuts: Array[float] = []
		var cursor := 0.0
		for band: Array in bands:
			if band[1]:
				cuts.append(top + (shear - top) * (1.0 - (cursor + band[0] / 2.0) / maxf(total, 1e-6)))
			cursor += band[0]
		cuts.sort()
		var outline := PackedVector2Array([Vector2(cx - half, top)])
		for at in cuts:
			outline.append_array([Vector2(cx - half, at - nick), Vector2(cx - half * 0.4, at), Vector2(cx - half, at + nick)])
		outline.append_array([Vector2(cx - half, shear), Vector2(cx + half, shear)])
		cuts.reverse()
		for at in cuts:
			outline.append_array([Vector2(cx + half, at + nick), Vector2(cx + half * 0.4, at), Vector2(cx + half, at - nick)])
		outline.append_array([Vector2(cx + half, top), Vector2(cx - half, top)])
		on.draw_polyline(outline, ink, Pal.HAIRLINE)
		# The key pin, its height set by the bitting so a deep cut reads as a deep cut.
		var cut: float = bitting[i] if i < bitting.size() else 3.0
		var key_top := shear + (bottom - shear) * (1.0 - minf(1.0, cut / 5.0))
		on.draw_rect(Rect2(cx - half * 0.8, key_top, half * 1.6, bottom - key_top), ink, false, Pal.HAIRLINE)


## A disc detainer as its pick view shows it from the side: the body, the row of discs, the bar
## along the top — and on each disc's face its gates, at the height the key's cut puts them, so
## two cards differ exactly where the locks do.
static func _draw_disc_pack(on: CanvasItem, rect: Rect2, def: Dictionary, ink: Color, locked: bool) -> void:
	var cuts := DiscRig.cuts_of(def)
	var lies := DiscRig.false_cuts_of(def)
	var n := cuts.size()
	if not locked:
		on.draw_rect(rect, Color(Pal.SHELL_BODY, 0.5))
	on.draw_rect(rect, ink, false, Pal.HAIRLINE)
	var axis := rect.position.y + rect.size.y * 0.56
	var radius := rect.size.y * 0.34
	var pitch := (rect.size.x - 16.0) / n
	var width := maxf(3.0, minf(14.0, pitch * 0.62))
	var first := rect.position.x + 8.0 + pitch / 2.0
	# The bar, lying along the top of the pack.
	var bar_h := maxf(4.0, rect.size.y * 0.07)
	on.draw_rect(Rect2(first - width / 2.0 - 4.0, axis - radius - bar_h - 2.0, pitch * (n - 1) + width + 8.0, bar_h), ink,
		false, Pal.HAIRLINE)
	for i in n:
		var x := first + pitch * i - width / 2.0
		if not locked:
			on.draw_rect(Rect2(x, axis - radius, width, radius * 2.0), Color(Pal.PAPER, 0.75))
		on.draw_rect(Rect2(x, axis - radius, width, radius * 2.0), ink, false, Pal.HAIRLINE)
		var marks: Array = [cuts[i]]
		marks.append_array(lies[i])
		for cut: int in marks:
			var y := axis - radius * cos(cut * DiscRig.CUT_ANGLE)
			on.draw_line(Vector2(x, y), Vector2(x + width, y), ink, Pal.HAIRLINE)
	# The keyway, through the middle of the pack.
	on.draw_line(Vector2(rect.position.x + 2.0, axis), Vector2(rect.end.x - 2.0, axis), ink, Pal.HAIRLINE)


## The combination padlock as the object — body, side hook, a row of wheel slots — matching
## its pick view: the hook leaves by the right face.
static func _draw_padlock(on: CanvasItem, rect: Rect2, wheels: int, ink: Color) -> void:
	var hook_w := rect.size.x * 0.16
	var w := minf(rect.size.x * 0.62, rect.size.y * 1.1)
	var h := rect.size.y * 0.72
	var x := rect.position.x + (rect.size.x - w - hook_w) / 2.0
	var y := rect.position.y + (rect.size.y - h) / 2.0
	var inset := h * 0.2
	var bend := Vector2(x + w + hook_w * 0.4, y + h / 2.0)
	var hook := PackedVector2Array([Vector2(x + w - 3.0, y + inset)])
	for k in 17:
		hook.append(bend + Vector2.from_angle(-PI / 2.0 + PI * k / 16.0) * (h / 2.0 - inset))
	hook.append(Vector2(x + w - 3.0, y + h - inset))
	on.draw_polyline(hook, ink, Pal.HAIRLINE)
	on.draw_rect(Rect2(x, y, w, h), ink, false, Pal.HAIRLINE)
	# The wheel slots, each with its read line through the middle.
	var slots := mini(wheels, 4)
	var slot_w := (w * 0.78) / slots - 4.0
	var slot_h := h * 0.52
	var row := y + h / 2.0
	var left := x + (w - (slot_w + 4.0) * slots + 4.0) / 2.0
	for i in slots:
		var sx := left + i * (slot_w + 4.0)
		on.draw_rect(Rect2(sx, row - slot_h / 2.0, slot_w, slot_h), ink, false, Pal.HAIRLINE)
		on.draw_line(Vector2(sx + 2.0, row), Vector2(sx + slot_w - 2.0, row), ink, Pal.HAIRLINE)
