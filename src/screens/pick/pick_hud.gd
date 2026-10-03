class_name PickHud
extends Node2D
## The pick screen's chrome: a header naming the lock with the clock and the pin dots, the rank
## in the band above the lock, the two columns beside it, and a footer carrying the wrench and
## the plug. The screen fills in the fields below each frame; this only draws them.

const MARGIN := 24.0
const HEADER_H := 64.0
const FOOTER_H := 124.0
const FOOTER_TOP := 1080.0 - MARGIN - FOOTER_H
const BAR_H := 30.0
const FOOTER_PAD := 38.0
const RANK_BAND_Y := MARGIN + HEADER_H
## The "← bench" link's hit box.
const BENCH_LINK := Rect2(MARGIN + 16.0, MARGIN + 12.0, 132.0, 40.0)
## Left edge of the right-hand gutter: the strip of page the widest lock never reaches into.
const GUTTER_LEFT := 1548.0

# ── What to show ────────────────────────────────────────────────────────────────────────
var lock_name := ""
var back_label := "bench"
var elapsed := 0.0
## The par the rank is measured against (already scaled for the assist level).
var par := 60.0
## Seconds left on the Lock Blitz's run clock; negative when there is no run.
var countdown_left := -1.0
var lesson := false
var payoff := false
var inspecting := false
## The snap gun is in hand: its opens are counted, not ranked.
var gun := false
## The lock on the bench, in a few rows of [label, value]: what it is, its par, your record.
var about: Array = []
## How far the needle is drawn back, or how hard the last strike was, 0..1.
var gun_power := 0.0
## A combination lock: the tension is a shackle pull, and there is no plug, pick or force.
var shackle := false
## The controls, as [key, what it does] pairs.
var keys: Array = []
## The wrench: dial level being applied (0 when off), the step it is set to, and whether it has
## ever been used this attempt.
var tension := 0.0
var pressure_step := 5
var wrench_used := false
var tension_hint := ""
var held_hint := ""
var restart_hint := ""
## What the footer says while the wrench is on and nothing more pressing is true; "" for the
## pin lock's own line.
var rest_hint := ""
## The second line under the tension prompt before the wrench has ever been used; "" for the
## pin lock's own.
var idle_hint := ""
## What the part the wrench turns is called on this lock.
var plug_word := "plug"
var resistance := 0.0
var pick_force := 0.0
## The word and colour for what the pin under the pick is doing; "" hides the word (Normal).
var state_word := ""
var state_ink := Pal.INK_LIGHT
## How far the plug has turned toward opening, 0..1 where 0.98 is the notch.
var plug_turned := 0.0
var plug_turning_back := false
var strain := 0.0
## Per-pin dots: chamber states (LockRig's enum), and how much they may say.
var dots: PackedInt32Array = PackedInt32Array()
## "full" (every state, Training), "progress" (set or not) or "none".
var dot_mode := "full"
## Sidebar lamp: [gated, aligned] or empty for a lock without one.
var sidebar: Array = []
var sidebar_dropped := false
var bench_hot := false
## Fingers are playing: the gutters belong to the wrench slider and the pads.
var touch := false
## Where the lock's drawing starts, so the key legend can stop short of it.
var assembly_left := 1920.0
var show_legend := true


func _process(_delta: float) -> void:
	queue_redraw()


## Where the key legend starts: clear of the lesson's line, whose box may reach over it.
const LEGEND_TOP := MARGIN + HEADER_H + 62.0


## The y the key legend's last row ends at — the front view sits under it.
static func legend_bottom(rows: int) -> float:
	return LEGEND_TOP + rows * 35.0


static func format_clock(seconds: float) -> String:
	var s := maxi(0, int(floor(seconds)))
	return "%02d:%02d" % [s / 60, s % 60]


func _label(pos: Vector2, s: String, size: int, color: Color, align: int = HORIZONTAL_ALIGNMENT_LEFT,
		heavy: bool = false) -> void:
	Pal.text(self, pos, s.to_upper(), size, color, align, heavy, size * 0.08)


func _text(pos: Vector2, s: String, size: int, color: Color, align: int = HORIZONTAL_ALIGNMENT_LEFT,
		heavy: bool = false) -> void:
	Pal.text(self, pos, s, size, color, align, heavy)


## A horizontal meter, filled in segments so it reads as instrumentation.
func _meter(x: float, y: float, w: float, value: float, color: Color, segments: int = 10, h: float = 16.0) -> void:
	const GAP := 4.0
	var seg_w := (w - GAP * (segments - 1)) / segments
	var filled := roundi(clampf(value, 0.0, 1.0) * segments)
	for i in segments:
		var r := Rect2(x + i * (seg_w + GAP), y, seg_w, h)
		draw_rect(r, color if i < filled else Color(Pal.RULE, 0.55))
		draw_rect(r, Pal.INK_LIGHT, false, Pal.HAIRLINE)


## A standing column: the same segments, filling from the bottom. Force reads as height.
func _column(x: float, bottom: float, h: float, value: float, color: Color, w: float = 46.0) -> void:
	const GAP := 4.0
	const SEGMENTS := 10
	var seg_h := (h - GAP * (SEGMENTS - 1)) / SEGMENTS
	var filled := roundi(clampf(value, 0.0, 1.0) * SEGMENTS)
	for i in SEGMENTS:
		var r := Rect2(x, bottom - seg_h - i * (seg_h + GAP), w, seg_h)
		if i < filled:
			draw_rect(r, color)
			var yy := r.position.y + 4.0
			while yy < r.end.y:
				draw_line(Vector2(r.position.x, yy), Vector2(r.end.x, yy), Color(Pal.INK, 0.4), 1.0)
				yy += 4.0
		else:
			draw_rect(r, Color(Pal.RULE, 0.55))
		draw_rect(r, Pal.INK_LIGHT, false, Pal.HAIRLINE)


func _draw() -> void:
	_draw_header()
	_draw_rank_band()
	_draw_footer()
	if not shackle or resistance >= 0.0:
		_draw_columns()
		_draw_about()
	if show_legend:
		_draw_legend()


func _draw_header() -> void:
	var bar := Rect2(MARGIN, MARGIN, 1920.0 - MARGIN * 2.0, HEADER_H)
	draw_rect(bar, Pal.PAPER_SHADE)
	draw_rect(bar, Pal.RULE, false, Pal.HAIRLINE)
	var mid := MARGIN + HEADER_H / 2.0 + 5.0
	_label(Vector2(MARGIN + 24.0, mid), "← " + back_label, Pal.T_BODY, Pal.INK if bench_hot else Pal.INK_LIGHT)
	if bench_hot:
		draw_line(Vector2(MARGIN + 24.0, mid + 5.0), Vector2(MARGIN + 24.0 + BENCH_LINK.size.x - 12.0, mid + 5.0),
			Pal.INK, Pal.HAIRLINE)
	_label(Vector2(960.0, mid), lock_name, Pal.T_HEADING, Pal.INK, HORIZONTAL_ALIGNMENT_CENTER)

	# Pin dots — filled for set, ringed for the rest, so progress reads at a glance.
	const DOT_R := 7.0
	const DOT_GAP := 22.0
	var right := 1920.0 - MARGIN - 24.0
	var n := 0 if dot_mode == "none" else dots.size()
	for i in n:
		var at := Vector2(right - (n - 1 - i) * DOT_GAP, MARGIN + HEADER_H / 2.0)
		var st := dots[i]
		if st == LockRig.SET:
			draw_circle(at, DOT_R, Pal.TEAL)
		elif dot_mode == "full" and st != LockRig.FREE:
			draw_circle(at, DOT_R, Pal.state_color(st))
		draw_arc(at, DOT_R, 0.0, TAU, 24, Pal.INK, Pal.STROKE, true)
	var clock_x := right - (n - 1) * DOT_GAP - 44.0 if n > 0 else right
	_text(Vector2(clock_x, MARGIN + HEADER_H / 2.0 + Pal.T_CLOCK * 0.36), format_clock(elapsed), Pal.T_CLOCK,
		Pal.INK, HORIZONTAL_ALIGNMENT_RIGHT)


## The band between the header and the lock: one large letter, read at a glance — or whatever
## matters more than a rank right now.
func _draw_rank_band() -> void:
	if lesson or payoff:
		# The lesson's line, or the earned-rank stamp, owns this band.
		return
	if countdown_left >= 0.0:
		# The blitz carries its run clock here: a letter against one lock's par is bench language
		# on a mode measured by a wall clock.
		_label(Vector2(960.0, RANK_BAND_Y + 84.0), format_clock(countdown_left), Pal.T_RANK,
			Pal.CRIMSON_TEXT if countdown_left < 30.0 else Pal.INK, HORIZONTAL_ALIGNMENT_CENTER, true)
		_label(Vector2(960.0, RANK_BAND_Y + 84.0 + Pal.T_BODY + 10.0), "time left", Pal.T_BODY, Pal.INK_LIGHT,
			HORIZONTAL_ALIGNMENT_CENTER)
		return
	if not wrench_used:
		# Before the wrench has ever been used this attempt, the band says so: a lock with no
		# tension on it looks like it is responding perfectly, and nothing will ever set.
		_label(Vector2(960.0, RANK_BAND_Y + 66.0), tension_hint, Pal.T_TITLE, Pal.AMBER_TEXT,
			HORIZONTAL_ALIGNMENT_CENTER, true)
		var second := "nothing in the lock moves until it is under tension"
		if shackle:
			second = "no wheel drags until the shackle is pulled"
		elif idle_hint != "":
			second = idle_hint
		_label(Vector2(960.0, RANK_BAND_Y + 66.0 + Pal.T_BODY + 12.0), second, Pal.T_BODY, Pal.INK_LIGHT,
			HORIZONTAL_ALIGNMENT_CENTER)
		return
	if inspecting:
		_label(Vector2(960.0, RANK_BAND_Y + 66.0), "inspection", Pal.T_TITLE, Pal.VIOLET_TEXT,
			HORIZONTAL_ALIGNMENT_CENTER, true)
		_label(Vector2(960.0, RANK_BAND_Y + 94.0), "nothing is recorded", Pal.T_BODY, Pal.INK_LIGHT,
			HORIZONTAL_ALIGNMENT_CENTER)
		return
	if gun:
		# A bump is not a pick: the clock runs, but there is no rank to hold or lose.
		_label(Vector2(960.0, RANK_BAND_Y + 66.0), "snap gun", Pal.T_TITLE, Pal.INK, HORIZONTAL_ALIGNMENT_CENTER, true)
		_label(Vector2(960.0, RANK_BAND_Y + 94.0), "a bumped lock earns no rank", Pal.T_BODY, Pal.INK_LIGHT,
			HORIZONTAL_ALIGNMENT_CENTER)
		return
	var rank := Ranks.index_for(elapsed, par)
	var ink := Pal.TEAL_TEXT
	if rank > 4:
		ink = Pal.CRIMSON_TEXT
	elif rank > 3:
		ink = Pal.INK
	elif rank > 1:
		ink = Pal.AMBER_TEXT
	_label(Vector2(960.0, RANK_BAND_Y + 84.0), Ranks.LETTERS[rank], Pal.T_RANK, Color(ink, 0.9),
		HORIZONTAL_ALIGNMENT_CENTER, true)
	# "You are on A" is worth much less than "you are on A for another nine seconds".
	_label(Vector2(960.0, RANK_BAND_Y + 84.0 + Pal.T_BODY + 10.0), Ranks.countdown_text(elapsed, par),
		Pal.T_BODY, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_CENTER)


func _draw_footer() -> void:
	var fy := FOOTER_TOP
	var bar := Rect2(MARGIN, fy, 1920.0 - MARGIN * 2.0, FOOTER_H)
	draw_rect(bar, Pal.PAPER_SHADE)
	draw_rect(bar, Pal.RULE, false, Pal.HAIRLINE)
	const METER_W := 420.0
	var left := MARGIN + 32.0
	var off := tension <= 0.0
	var heading := ""
	if shackle:
		heading = "shackle — released" if off else "shackle — pulled"
	else:
		heading = "tension wrench — off" if off else "tension wrench — pressure %d of 10" % pressure_step
	_label(Vector2(left, fy + FOOTER_PAD), heading, Pal.T_DIM, Pal.INK_LIGHT)
	if not shackle:
		# The pull is one strength on a wheel pack, so it gets no strength meter.
		_meter(left, fy + FOOTER_PAD + 14.0, METER_W, tension, Pal.AMBER, 10, BAR_H)
		_label(Vector2(left + METER_W + 20.0, fy + FOOTER_PAD + 38.0), "—" if off else str(pressure_step),
			Pal.T_HEADING, Pal.INK_LIGHT if off else Pal.INK, HORIZONTAL_ALIGNMENT_LEFT, true)
		_text(Vector2(left + METER_W + 58.0, fy + FOOTER_PAD + 38.0), "%.2f" % tension, Pal.T_DIM, Pal.INK_LIGHT)
	# The caption's row belongs to whichever sentence is currently true. While the wrench is off
	# it says so, in amber: it is the one caption on the screen asking for an action.
	var caption := tension_hint
	var caption_ink := Pal.AMBER_TEXT
	if not off:
		if held_hint != "":
			caption = held_hint
		else:
			caption = "the bound wheel drags under the pull — that drag is the tell" if shackle \
				else "heavy holds a set harder — light lets a caught pin through"
			if rest_hint != "":
				caption = rest_hint
			caption_ink = Pal.INK_LIGHT
	_label(Vector2(left, fy + FOOTER_PAD + 70.0), caption, Pal.T_DIM, caption_ink)

	if not shackle:
		# How far the plug has turned — and, more to the point, when it turns back.
		var px := 960.0 + 40.0
		const PLUG_W := 300.0
		_label(Vector2(px, fy + FOOTER_PAD), plug_word + " — turning back" if plug_turning_back else plug_word, Pal.T_DIM,
			Pal.CRIMSON_TEXT if plug_turning_back else Pal.INK_LIGHT)
		_meter(px, fy + FOOTER_PAD + 14.0, PLUG_W, plug_turned, Pal.CRIMSON_TEXT if plug_turning_back else Pal.INK, 10, BAR_H)
		# The opening threshold, as a notch above the bar: a line the fill has to reach.
		var notch := px + PLUG_W * 0.98
		draw_line(Vector2(notch, fy + FOOTER_PAD + 6.0), Vector2(notch, fy + FOOTER_PAD + 14.0), Pal.INK, Pal.STROKE)
		_label(Vector2(px, fy + FOOTER_PAD + 70.0), "how far it has turned — past the notch it opens", Pal.T_DIM,
			Pal.INK_LIGHT)

		# The pick's own condition, beside the wrench: leaning too hard is the cause, this the cost.
		if strain > 0.04:
			var sx := left + METER_W + 230.0
			_label(Vector2(sx, fy + FOOTER_PAD), "pick strain", Pal.T_DIM, Pal.INK_LIGHT)
			_meter(sx, fy + FOOTER_PAD + 14.0, 180.0, strain, Pal.AMBER, 6, BAR_H)

	if not sidebar.is_empty():
		var gated: int = sidebar[0]
		var met: int = sidebar[1]
		var ink := Pal.TEAL_TEXT if sidebar_dropped else Pal.INK_LIGHT
		var word := "sidebar dropped" if sidebar_dropped else "sidebar up — %d/%d gates" % [met, gated]
		var x := 1920.0 - MARGIN - 32.0
		var y := fy + 44.0
		draw_circle(Vector2(x - 8.0, y + 6.0), 8.0, Pal.TEAL if sidebar_dropped else Pal.PAPER)
		draw_arc(Vector2(x - 8.0, y + 6.0), 8.0, 0.0, TAU, 24, Pal.INK, Pal.STROKE, true)
		_label(Vector2(x - 24.0, y + 12.0), word, Pal.T_DIM, ink, HORIZONTAL_ALIGNMENT_RIGHT)


## The lock's card, top right: what it is, what it asks, and what you have done to it before.
func _draw_about() -> void:
	if about.is_empty() or touch:
		return
	const ROW := 34.0
	var rect := Rect2(GUTTER_LEFT, 184.0, 1920.0 - MARGIN - GUTTER_LEFT, 44.0 + ROW * about.size())
	draw_rect(rect, Pal.PAPER_SHADE)
	draw_rect(rect, Pal.RULE, false, Pal.HAIRLINE)
	_label(rect.position + Vector2(14.0, 24.0), "this lock", Pal.T_DIM, Pal.INK_LIGHT)
	var y := rect.position.y + 58.0
	for row: Array in about:
		_text(Vector2(rect.position.x + 14.0, y), str(row[0]), Pal.T_DIM, Pal.INK_LIGHT)
		_text(Vector2(rect.end.x - 14.0, y), str(row[1]), Pal.T_BODY, Pal.INK, HORIZONTAL_ALIGNMENT_RIGHT)
		y += ROW


## Two columns beside the lock: what you are pushing with, and what pushes back.
func _draw_columns() -> void:
	const COL_W := 46.0
	const COL_H := 270.0
	var col_x := 1920.0 - MARGIN - 110.0 - COL_W
	var col_bottom := FOOTER_TOP - 56.0
	var force_x := col_x - COL_W - 62.0
	var num_y := col_bottom - COL_H - 16.0
	var word_y := num_y - Pal.T_HEADING - 10.0
	var label_y := col_bottom + 26.0
	var named := state_word != ""
	if gun:
		# Nothing is pushed with a snap gun: the one reading is how far the needle is drawn back.
		# The column runs to the needle's limit; a notch marks a full strike on the way up it.
		var limit := PinSession.MAX_POWER
		_column(col_x, col_bottom, COL_H, gun_power / limit, Pal.CRIMSON if gun_power > 1.0 else Pal.AMBER, COL_W)
		var full_y := col_bottom - COL_H / limit
		draw_line(Vector2(col_x - 12.0, full_y), Vector2(col_x - 2.0, full_y), Pal.INK, Pal.STROKE)
		_text(Vector2(col_x - 18.0, full_y + Pal.T_DIM * 0.36), "100", Pal.T_DIM, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_RIGHT)
		_text(Vector2(col_x + COL_W / 2.0, num_y), "%d%%" % roundi(gun_power * 100.0), Pal.T_HEADING, Pal.INK,
			HORIZONTAL_ALIGNMENT_CENTER)
		_label(Vector2(col_x + COL_W / 2.0, label_y), "strike", Pal.T_DIM, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_CENTER)
		if touch:
			# The strike pad has that strip of page.
			return
		var gy := 452.0
		for row in GameScreen.wrap_text("strike — how far the needle is drawn back. The harder the strike, the higher every pin jumps. A pin must clear its line to be caught, and a heavy wrench wants a harder strike.",
				Pal.T_DIM, 1920.0 - MARGIN - 8.0 - GUTTER_LEFT):
			_text(Vector2(GUTTER_LEFT, gy), row, Pal.T_DIM, Pal.INK_LIGHT)
			gy += 22.0
		return
	if not shackle:
		_column(force_x, col_bottom, COL_H, pick_force, Color(Pal.INK_LIGHT, 0.7), COL_W)
		_text(Vector2(force_x + COL_W / 2.0, num_y), "%.2f" % pick_force, Pal.T_HEADING, Pal.INK,
			HORIZONTAL_ALIGNMENT_CENTER)
		_label(Vector2(force_x + COL_W / 2.0, label_y), "force", Pal.T_DIM, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_CENTER)
	var read_x := col_x + COL_W / 2.0
	_column(col_x, col_bottom, COL_H, resistance, state_ink if named else Pal.INK, COL_W)
	_text(Vector2(read_x, num_y), "%.2f" % resistance, Pal.T_HEADING, state_ink if named else Pal.INK,
		HORIZONTAL_ALIGNMENT_CENTER)
	_label(Vector2(read_x, label_y), "resistance", Pal.T_DIM, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_CENTER)
	# What the pair is for, in the strip of page to the right of the lock, above the shear line.
	# Running text, wrapped to the gutter: a longer sentence wraps instead of reaching back
	# across the drawing.
	var lines: Array = ["force — how hard you push", "resistance — how hard it pushes back"]
	if shackle:
		lines = ["resistance — the bound wheel dragging under the pull"]
	elif touch:
		# The counter pad has that strip of page.
		lines = []
	var cy := 452.0
	for line: String in lines:
		for row in GameScreen.wrap_text(line, Pal.T_DIM, 1920.0 - MARGIN - 8.0 - GUTTER_LEFT):
			_text(Vector2(GUTTER_LEFT, cy), row, Pal.T_DIM, Pal.INK_LIGHT)
			cy += 22.0
	if named:
		_label(Vector2(read_x, word_y), state_word, Pal.T_BODY, state_ink, HORIZONTAL_ALIGNMENT_CENTER)


## The controls, as boxed key caps with the action beside each, down the left gutter: a key you
## must press is a thing, so it is drawn as one.
func _draw_legend() -> void:
	if keys.is_empty():
		return
	var x := PickTouch.CLEAR_LEFT + 6.0 if touch and not shackle else MARGIN + 16.0
	var size := Pal.T_BODY
	var max_right := assembly_left - 10.0
	var cap_w := 30.0
	# The face gives way until the widest row fits the gutter the current lock leaves.
	while true:
		cap_w = 30.0
		var label_w := 0.0
		for row: Array in keys:
			cap_w = maxf(cap_w, Pal.text_width(str(row[0]).to_upper(), size, true, size * 0.08) + 20.0)
			label_w = maxf(label_w, Pal.text_width(str(row[1]).to_upper(), size, false, size * 0.08))
		if x + cap_w + 14.0 + label_w <= max_right or size <= 14:
			break
		size -= 1
	var row_h := maxf(35.0, size + 14.0)
	var cap_h := maxf(26.0, size + 6.0)
	var ky := LEGEND_TOP
	for row: Array in keys:
		Pal.box(self, Rect2(x, ky, cap_w, cap_h), Pal.PAPER)
		_label(Vector2(x + cap_w / 2.0, ky + cap_h / 2.0 + size * 0.36), str(row[0]), size, Pal.INK,
			HORIZONTAL_ALIGNMENT_CENTER, true)
		_label(Vector2(x + cap_w + 14.0, ky + cap_h / 2.0 + size * 0.36), str(row[1]), size, Pal.INK)
		ky += row_h
