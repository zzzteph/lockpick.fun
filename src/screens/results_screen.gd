extends GameScreen
## What an open was worth, in the order it is read: the rank it earned, what happened on the
## way, anything it won, and the way on along the bottom.

const LETTER := 220
## Two panels of one size, side by side and centred: the rank, then the attempt.
const PANEL_W := 760.0
const PANEL_GAP := 40.0
const PANEL_Y := 190.0
const PANELS_X := (1920.0 - PANEL_W * 2.0 - PANEL_GAP) / 2.0
const PAD := 40.0
const ROW_Y := 1080.0 - MARGIN - 130.0
const BUTTON_W := 240.0
const BUTTON_H := 52.0

## Seconds on this screen: what the stamp lands on.
var _age := 0.0
var _next: Dictionary = {}
## Where the next lock's name is written: over its own button, from that button's left edge.
var _next_at := Vector2.ZERO


func build() -> void:
	var outcome: AttemptOutcome = app.outcome
	title = "Open" if outcome != null and outcome.opened else "Results"
	status = app.progress.ranked_line()
	if outcome == null:
		# Nothing to report on; still a page somebody can leave.
		nav([["Bench", func() -> void: app.goto(&"bench")]])
		return
	# Reduced motion arrives settled.
	_age = 9.0 if bool(app.progress.settings["reducedMotion"]) else 0.0
	# Everything below is painted, not lettered on controls: the page says it to a screen reader.
	accessibility_description = _summary(outcome)

	# Bench, Again, and — the point of the row — Next lock: carrying on is what most players do
	# after most opens, so it is the primary action and needs no trip through the bench. Its
	# button is as wide as the name written over it, so the two read as one thing.
	_next = app.progress.next_lock_after(outcome.lock)
	var onward := not _next.is_empty()
	var next_w := maxf(BUTTON_W, ceilf(Pal.text_width(_next_line(), Pal.T_DIM))) if onward else 0.0
	var x := 1920.0 / 2.0 - (BUTTON_W * 2.0 + 24.0 + ((next_w + 24.0) if onward else 0.0)) / 2.0
	Kit.button(self, Rect2(x, ROW_Y, BUTTON_W, BUTTON_H), "Bench", func() -> void: app.goto(&"bench"))
	x += BUTTON_W + 24.0
	var primary := Kit.button(self, Rect2(x, ROW_Y, BUTTON_W, BUTTON_H), "Again",
		func() -> void: app.start_lock(outcome.lock, app.lock_seed), not onward)
	Kit.describe(primary, "Again", "another attempt at %s" % outcome.lock["name"])
	if onward:
		x += BUTTON_W + 24.0
		# High enough over the button to clear its focus marks.
		_next_at = Vector2(x, ROW_Y - 16.0)
		primary = Kit.button(self, Rect2(x, ROW_Y, next_w, BUTTON_H), "Next lock",
			func() -> void: app.start_lock(_next), true)
		Kit.describe(primary, "Next lock: %s" % _next["name"])
	primary.grab_focus.call_deferred(true)


func _process(delta: float) -> void:
	_age += delta
	super(delta)


func paint() -> void:
	var outcome: AttemptOutcome = app.outcome
	if outcome == null:
		return
	tracked(Vector2(LEFT, MARGIN + 92.0), str(outcome.lock["name"]), Pal.T_HEADING, Pal.INK_LIGHT)
	var result: Progress.Result = app.result
	if result != null:
		_paint_rank(result, _rank_rect())
	_paint_attempt(outcome, _attempt_rect())

	var earned := _earned_line()
	if earned != "":
		var under := _rank_rect().end.y if result != null else _attempt_rect().end.y
		paragraph(Vector2(PANELS_X, under + 44.0), earned, Pal.T_BODY, Pal.INK, PANEL_W * 2.0 + PANEL_GAP,
			Pal.T_BODY + 9.0, 2)
	if not _next.is_empty():
		plain(_next_at, _next_line(), Pal.T_DIM, Pal.INK)


func paint_under() -> void:
	if app.outcome == null:
		return
	if app.result != null:
		panel(_rank_rect(), "rank")
	panel(_attempt_rect(), "the attempt")


## The rank panel says three things and no more: what you earned this time, what your best on
## this lock is, and — the only line worth hurrying for — whether this attempt moved it.
func _paint_rank(result: Progress.Result, r: Rect2) -> void:
	var ink := Pal.CRIMSON_TEXT
	if result.rank <= 1:
		ink = Pal.TEAL_TEXT
	elif result.rank <= 3:
		ink = Pal.AMBER_TEXT
	# The stamp: the letter grows in from nothing and overshoots by a tenth before it settles.
	# From nothing rather than from huge — a letter shrinking into place would cross the lines
	# under it on the way down.
	var k := minf(1.0, _age / 0.45) - 1.0
	const BACK := 1.70158
	var eased := 1.0 + (BACK + 1.0) * k * k * k + BACK * k * k
	pen.draw_set_transform(Vector2(r.get_center().x, r.position.y + 60.0 + LETTER / 2.0), 0.0,
		Vector2.ONE * maxf(0.001, eased))
	Pal.text(pen, Vector2(0.0, LETTER * 0.36), Ranks.letter_for(result.rank), LETTER,
		Color(ink, minf(1.0, _age / 0.12)), HORIZONTAL_ALIGNMENT_CENTER, true)
	pen.draw_set_transform(Vector2.ZERO)

	var lines: Array = [
		["best on this lock", Ranks.letter_for(result.best_rank)],
		["previous best", "first open" if result.first_open else Ranks.letter_for(result.previous_best)],
		["counts toward the next tier", Ranks.tier_credit_text(result.best_rank)],
	]
	var y := r.position.y + 60.0 + LETTER + 46.0
	for line: Array in lines:
		tracked(Vector2(r.position.x + PAD, y), str(line[0]), Pal.T_BODY, Pal.INK_LIGHT)
		plain(Vector2(r.end.x - PAD, y), str(line[1]), Pal.T_BODY, Pal.INK, HORIZONTAL_ALIGNMENT_RIGHT)
		y += Pal.T_BODY + 16.0
	# After the stamp lands, not with it — one thing arriving at a time.
	if result.improved and _age > 0.5:
		tracked(Vector2(r.position.x + PAD, y + 14.0), "first open" if result.first_open else "new best", Pal.T_HEADING,
			Pal.TEAL_TEXT)


## What happened on the way: five figures, each on a ruled line of its own, the values in one
## column down the right so they can be read off like a ledger.
func _paint_attempt(outcome: AttemptOutcome, r: Rect2) -> void:
	# The par row is the par this attempt was judged against, which on Training is not the lock's.
	var rows: Array = [
		["time", Ranks.time_text(outcome.seconds), Pal.TEAL_TEXT if outcome.seconds <= outcome.judged_par() else Pal.INK],
		["par", _par_text(outcome), Pal.INK],
		["oversets", str(outcome.oversets), Pal.TEAL_TEXT if outcome.oversets == 0 else Pal.CRIMSON_TEXT],
		["resets", str(outcome.resets), Pal.TEAL_TEXT if outcome.resets == 0 else Pal.INK],
		["false sets", str(outcome.false_sets), Pal.INK],
	]
	var top := r.position.y + 52.0
	var pitch := (r.end.y - 18.0 - top) / rows.size()
	for i in rows.size():
		var row: Array = rows[i]
		var ink: Color = row[2]
		var base := top + pitch * (i + 0.5) + Pal.T_BODY * 0.36
		tracked(Vector2(r.position.x + PAD, base), str(row[0]), Pal.T_BODY, Pal.INK_LIGHT)
		plain(Vector2(r.end.x - PAD, base), str(row[1]), Pal.T_BODY, ink, HORIZONTAL_ALIGNMENT_RIGHT)
		if i > 0:
			var rule := top + pitch * i
			pen.draw_line(Vector2(r.position.x + PAD, rule), Vector2(r.end.x - PAD, rule), Pal.RULE, Pal.HAIRLINE)


func _rank_rect() -> Rect2:
	return Rect2(PANELS_X, PANEL_Y, PANEL_W, _panel_height())


## Beside the rank; alone in the middle of the page when there is no rank to stand beside.
func _attempt_rect() -> Rect2:
	var x := PANELS_X + PANEL_W + PANEL_GAP if app.result != null else (1920.0 - PANEL_W) / 2.0
	return Rect2(x, PANEL_Y, PANEL_W, _panel_height())


## Both panels are as tall as the rank needs — a line taller when there is a best to announce.
func _panel_height() -> float:
	var result: Progress.Result = app.result
	var flash := Pal.T_HEADING + 26.0 if result != null and result.improved else 0.0
	return 60.0 + LETTER + 46.0 + 3.0 * (Pal.T_BODY + 16.0) + flash + 26.0


## The par an attempt was judged against, and — when the level moved it — the lock's own par
## and the multiple that level put on it.
static func _par_text(outcome: AttemptOutcome) -> String:
	var par := outcome.par()
	var judged := outcome.judged_par()
	if is_equal_approx(judged, par):
		return WebNum.text(par) + "s"
	return "%ss  (%ss × %s on %s)" % [WebNum.to_fixed(judged, 0), WebNum.text(par),
		WebNum.text(Ranks.assist_scale(outcome.assist)), outcome.assist]


func _next_line() -> String:
	return "next: %s" % _next["name"]


## "earned: First Blood, Under Par", or "" when this open won nothing.
func _earned_line() -> String:
	var names := PackedStringArray()
	for a: Dictionary in app.earned:
		names.append(str(a["name"]))
	return "" if names.is_empty() else "earned: " + ", ".join(names)


## The page in a sentence or two, for a screen reader: everything on it is painted.
func _summary(outcome: AttemptOutcome) -> String:
	var parts := PackedStringArray([str(outcome.lock["name"])])
	var result: Progress.Result = app.result
	if result != null:
		var rank := "rank %s" % Ranks.letter_for(result.rank)
		if result.first_open:
			rank += ", first open"
		elif result.improved:
			rank += ", a new best"
		parts.append(rank)
		parts.append("best on this lock %s" % Ranks.letter_for(result.best_rank))
		parts.append("counts toward the next tier: %s" % Ranks.tier_credit_text(result.best_rank))
	parts.append("time %s, par %s" % [Ranks.time_text(outcome.seconds), _par_text(outcome)])
	parts.append("%d oversets, %d resets, %d false sets" % [outcome.oversets, outcome.resets, outcome.false_sets])
	var earned := _earned_line()
	if earned != "":
		parts.append(earned)
	return ". ".join(parts)
