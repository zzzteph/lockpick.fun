class_name Pal
extends RefCounted
## The drafting palette, the type scale and the one typeface — everything a screen or a view
## needs to look like the rest of the game.
##
## Nothing here encodes state in hue alone: each chamber state also carries a fill pattern
## (see `STATE_PATTERN`), so the two can never drift apart.

# ── Colours ─────────────────────────────────────────────────────────────────────────────
# Variables, not constants: the page has two themes and `use()` swaps the whole set at once.
static var PAPER := Color("F4F1EA")
## Panel fills.
static var PAPER_SHADE := Color("E7E2D8")
## Primary linework and text.
static var INK := Color("1C1B19")
## Secondary lines, labels, dimension marks.
static var INK_LIGHT := Color("5C5A56")
## Grid, guides, inactive borders.
static var RULE := Color("C9C3B6")
## Pin bodies at rest, tool bodies.
static var STEEL := Color("8C9199")
## The plug — the part that turns. Brass, because it is brass.
static var PLUG_BODY := Color("E9DFC0")
## The shell — the part that does not. Slightly deeper, and it sits behind.
static var SHELL_BODY := Color("DBD0AA")
## BINDING — the pin demanding attention.
static var AMBER := Color("D98324")
## SET — a chamber that is done.
static var TEAL := Color("1E7A73")
## OVERSET — always paired with cross-hatch, never colour alone.
static var CRIMSON := Color("B23A2E")
## FALSE SET — the beautiful lie.
static var VIOLET := Color("6B4E9B")
## Flash on set, celebration accents.
static var HIGHLIGHT := Color("F2C14E")

# The accents moved until they clear 4.5:1 as *text* on `RULE`, the darkest ground a word ever
# sits on (the paper's own lattice) — so they clear every lighter ground by construction.
static var AMBER_TEXT := Color("754613")
static var TEAL_TEXT := Color("165A55")
static var CRIMSON_TEXT := Color("922F26")
static var VIOLET_TEXT := Color("5E4488")
static var HIGHLIGHT_TEXT := Color("624F20")

## The two pages: ink on drafting paper, and the same drawing as a blueprint.
const THEMES := {
	"drafting": {
		"PAPER": "F4F1EA", "PAPER_SHADE": "E7E2D8", "INK": "1C1B19", "INK_LIGHT": "5C5A56", "RULE": "C9C3B6",
		"STEEL": "8C9199", "PLUG_BODY": "E9DFC0", "SHELL_BODY": "DBD0AA", "AMBER": "D98324", "TEAL": "1E7A73",
		"CRIMSON": "B23A2E", "VIOLET": "6B4E9B", "HIGHLIGHT": "F2C14E", "AMBER_TEXT": "754613",
		"TEAL_TEXT": "165A55", "CRIMSON_TEXT": "922F26", "VIOLET_TEXT": "5E4488", "HIGHLIGHT_TEXT": "624F20",
	},
	"blueprint": {
		"PAPER": "0E2233", "PAPER_SHADE": "153049", "INK": "D8E6F0", "INK_LIGHT": "93A9BC", "RULE": "2C4A66",
		"STEEL": "9FB0C0", "PLUG_BODY": "183851", "SHELL_BODY": "122B41", "AMBER": "F0A44C", "TEAL": "48C4B8",
		"CRIMSON": "E8776A", "VIOLET": "A98FE0", "HIGHLIGHT": "FFD97A", "AMBER_TEXT": "F0A64F",
		"TEAL_TEXT": "52C7BC", "CRIMSON_TEXT": "EFA299", "VIOLET_TEXT": "BFACE8", "HIGHLIGHT_TEXT": "FFD97A",
	},
}
static var theme_name := "drafting"


## Switch the page. Returns true if anything changed — the caller rebuilds what it has drawn.
static func use(name: String) -> bool:
	if not THEMES.has(name) or name == theme_name:
		return false
	theme_name = name
	var t: Dictionary = THEMES[name]
	PAPER = Color(str(t["PAPER"]))
	PAPER_SHADE = Color(str(t["PAPER_SHADE"]))
	INK = Color(str(t["INK"]))
	INK_LIGHT = Color(str(t["INK_LIGHT"]))
	RULE = Color(str(t["RULE"]))
	STEEL = Color(str(t["STEEL"]))
	PLUG_BODY = Color(str(t["PLUG_BODY"]))
	SHELL_BODY = Color(str(t["SHELL_BODY"]))
	AMBER = Color(str(t["AMBER"]))
	TEAL = Color(str(t["TEAL"]))
	CRIMSON = Color(str(t["CRIMSON"]))
	VIOLET = Color(str(t["VIOLET"]))
	HIGHLIGHT = Color(str(t["HIGHLIGHT"]))
	AMBER_TEXT = Color(str(t["AMBER_TEXT"]))
	TEAL_TEXT = Color(str(t["TEAL_TEXT"]))
	CRIMSON_TEXT = Color(str(t["CRIMSON_TEXT"]))
	VIOLET_TEXT = Color(str(t["VIOLET_TEXT"]))
	HIGHLIGHT_TEXT = Color(str(t["HIGHLIGHT_TEXT"]))
	return true

# ── Strokes: three weights only, in stage px ────────────────────────────────────────────
const HAIRLINE := -1.0
# The other two are refitted to the window (`fit`): each is a whole number of device pixels
# thick, so a line is the same weight wherever on the pixel grid it happens to fall.
static var STROKE := 2.0
static var HEAVY := 3.0
## Device pixels per stage pixel: how big the window is drawing the stage.
static var device := 1.0


## Refit the stroke weights to the window's scale. Returns true if anything changed.
static func fit(device_per_stage: float) -> bool:
	if device_per_stage <= 0.0 or is_equal_approx(device_per_stage, device):
		return false
	device = device_per_stage
	STROKE = px(2.0)
	HEAVY = px(3.0)
	return true


## A nominal width in stage px, as the nearest whole number of device pixels (never less than one).
static func px(width: float) -> float:
	return maxf(1.0, roundf(width * device)) / device

# ── Type scale, stage px ────────────────────────────────────────────────────────────────
const T_DIM := 17
const T_BODY := 21
const T_HEADING := 26
const T_TITLE := 38
const T_CLOCK := 40
const T_RANK := 104
const T_PAYOUT := 64

## The logical stage every screen is laid out on.
const STAGE := Vector2(1920, 1080)
## The drafting-paper lattice behind everything.
const GRID := 40.0

static var _regular: FontFile
static var _bold: FontFile


static func font() -> Font:
	if _regular == null:
		_regular = load("res://assets/fonts/jbm-Regular.woff2")
	return _regular


static func bold() -> Font:
	if _bold == null:
		_bold = load("res://assets/fonts/jbm-SemiBold.woff2")
	return _bold


## Fill colour for a chamber state (LockRig's enum order: FREE, BINDING, FALSE_SET, SET, OVERSET).
static func state_color(state: int) -> Color:
	match state:
		1:
			return AMBER
		2:
			return VIOLET
		3:
			return TEAL
		4:
			return CRIMSON
	return STEEL


static func state_text_color(state: int) -> Color:
	match state:
		1:
			return AMBER_TEXT
		2:
			return VIOLET_TEXT
		3:
			return TEAL_TEXT
		4:
			return CRIMSON_TEXT
	return INK_LIGHT


static func mix(a: Color, b: Color, t: float) -> Color:
	return a.lerp(b, t)


# ── Drawing helpers for custom-drawn nodes ──────────────────────────────────────────────

## Text with letter spacing, as every heading and button in the game is set. `align` is
## HORIZONTAL_ALIGNMENT_*; `pos` is the baseline-left, -centre or -right accordingly.
static func text(item: CanvasItem, pos: Vector2, s: String, size: int, color: Color,
		align: int = HORIZONTAL_ALIGNMENT_LEFT, heavy: bool = false, tracking: float = 0.0) -> void:
	var f := bold() if heavy else font()
	if tracking <= 0.0:
		var w := f.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
		var x := pos.x
		if align == HORIZONTAL_ALIGNMENT_CENTER:
			x -= w / 2.0
		elif align == HORIZONTAL_ALIGNMENT_RIGHT:
			x -= w
		item.draw_string(f, Vector2(x, pos.y), s, HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)
		return
	var total := text_width(s, size, heavy, tracking)
	var cx := pos.x
	if align == HORIZONTAL_ALIGNMENT_CENTER:
		cx -= total / 2.0
	elif align == HORIZONTAL_ALIGNMENT_RIGHT:
		cx -= total
	for i in s.length():
		var ch := s[i]
		item.draw_string(f, Vector2(cx, pos.y), ch, HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)
		cx += f.get_string_size(ch, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x + tracking


static func text_width(s: String, size: int, heavy: bool = false, tracking: float = 0.0) -> float:
	var f := bold() if heavy else font()
	if tracking <= 0.0:
		return f.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var w := 0.0
	for i in s.length():
		w += f.get_string_size(s[i], HORIZONTAL_ALIGNMENT_LEFT, -1, size).x + tracking
	return w - tracking


## Diagonal hatch across `rect`, clipped to it. `angle_deg` 45 leans right, -45 left.
static func hatch_rect(item: CanvasItem, rect: Rect2, spacing: float, angle_deg: float, color: Color,
		width: float = 1.0) -> void:
	var h := rect.size.y
	var lean := h * (1.0 if angle_deg > 0.0 else -1.0)
	var x := rect.position.x - absf(lean)
	while x < rect.end.x + absf(lean):
		var a := Vector2(x, rect.end.y)
		var b := Vector2(x + lean, rect.position.y)
		var clipped := _clip_segment(a, b, rect)
		if clipped.size() == 2:
			item.draw_line(clipped[0], clipped[1], color, width)
		x += spacing


static func _clip_segment(a: Vector2, b: Vector2, rect: Rect2) -> Array[Vector2]:
	# Liang–Barsky against the rectangle's two vertical sides; the hatch spans it top to bottom.
	var d := b - a
	var t0 := 0.0
	var t1 := 1.0
	if absf(d.x) < 1e-9:
		if a.x < rect.position.x or a.x > rect.end.x:
			return []
	else:
		var ta := (rect.position.x - a.x) / d.x
		var tb := (rect.end.x - a.x) / d.x
		t0 = maxf(t0, minf(ta, tb))
		t1 = minf(t1, maxf(ta, tb))
		if t0 >= t1:
			return []
	return [a + d * t0, a + d * t1]


## A filled, ink-outlined polygon.
static func poly(item: CanvasItem, points: PackedVector2Array, fill: Color, outline: Color = INK,
		width: float = STROKE) -> void:
	if points.size() < 3:
		return
	item.draw_colored_polygon(points, fill)
	var closed := points.duplicate()
	closed.append(points[0])
	item.draw_polyline(closed, outline, width, true)


static func box(item: CanvasItem, rect: Rect2, fill: Color, outline: Color = INK, width: float = STROKE) -> void:
	item.draw_rect(rect, fill, true)
	InkBox.frame(item.get_canvas_item(), rect, outline, px(width))
