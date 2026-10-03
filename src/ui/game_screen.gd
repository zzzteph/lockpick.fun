class_name GameScreen
extends Control
## The chrome every menu screen sits in: the title in the top-left corner, navigation in the
## top-right (the way out always the rightmost button), a status line along the bottom, and the
## Feedback button in the bottom-right.
##
## A screen is a drawing with controls on it. Override `build()` to add the controls — real
## Buttons and friends from `Kit`, so the keyboard, a controller and a finger all get focus,
## hover and activation from the engine — and `paint()` to draw everything else with the helpers
## below. `paint()` draws on a layer above the controls (so text can sit on a card); anything
## that must sit underneath them goes in `paint_under()`.

const MARGIN := 24.0
## The left edge content hangs from, and the width between the two margins.
const LEFT := MARGIN + 28.0
const WIDTH := 1920.0 - LEFT * 2.0

## The app that owns this screen: `app.goto(...)`, `app.status`, `app.progress` and so on.
var app: Node
var title := ""
## The quiet line along the bottom; a message from the app replaces it while there is one.
var status := ""
## What `paint` and its helpers are drawing on right now.
var pen: CanvasItem
var _ink: Control
var _toast: Label

## How long a message stays on the strip, s.
const TOAST_SECONDS := 6.0


func _init() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	theme = Kit.theme()
	mouse_filter = Control.MOUSE_FILTER_PASS


func _ready() -> void:
	pen = self
	build()
	accessibility_name = title
	if show_feedback():
		_feedback_button()
	_ink = Control.new()
	_ink.set_anchors_preset(Control.PRESET_FULL_RECT)
	_ink.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_ink.draw.connect(_paint_ink)
	add_child(_ink)
	queue_redraw()


## The Feedback button's box: bottom-right, on every page that carries it.
static func feedback_rect() -> Rect2:
	var box := Kit.box_for("feedback", Pal.T_BODY, 200.0, 40.0)
	return Rect2(1920.0 - MARGIN - 28.0 - box.x, 1080.0 - MARGIN - 14.0 - box.y, box.x, box.y)


func _feedback_button() -> void:
	var b := Kit.button(self, feedback_rect(), "feedback", func() -> void: app.call("open_feedback"))
	Kit.describe(b, "Feedback", "Rate the game, report a bug or suggest something. Sent from inside the game.")


## Override: add the screen's controls.
func build() -> void:
	pass


## Override: draw the screen's text and figures, above the controls.
func paint() -> void:
	pass


## Override: draw what must sit beneath the controls (panel fills, backdrops).
func paint_under() -> void:
	pass


## Override to carry the Feedback button. It lives on the pages a player goes to when
## something is wrong — the menu and Help — not in the corner of every screen, where it would sit
## beside each page's own way forward.
func show_feedback() -> bool:
	return false


## What the app has to say right now, or "" once it has been up long enough to have been read.
func _message() -> String:
	if app == null:
		return ""
	var text := str(app.get("status"))
	if text == "":
		return ""
	var age: float = Time.get_ticks_msec() / 1000.0 - float(app.get("status_at"))
	return text if age < TOAST_SECONDS else ""


## The message strip: a real label, so it is read out as well as shown.
func _show_toast(text: String) -> void:
	if text == "":
		if _toast != null:
			_toast.visible = false
		return
	if _toast == null:
		_toast = Label.new()
		_toast.theme_type_variation = "Toast"
		_toast.add_theme_font_override("font", Pal.font())
		_toast.add_theme_font_size_override("font_size", Pal.T_BODY)
		_toast.accessibility_live = AccessibilityServer.LIVE_POLITE
		_toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(_toast)
	if _toast.text != text:
		_toast.text = text
		_toast.reset_size()
	_toast.visible = true
	_toast.position = Vector2(LEFT, 1080.0 - MARGIN - 14.0 - _toast.size.y)
	move_child(_toast, -1)


## Override to drop the status line along the bottom.
func show_status() -> bool:
	return true


## Throw the controls away and build them again — for a screen whose layout depends on state.
func rebuild() -> void:
	for child in get_children():
		if child != _ink and child != _toast:
			child.queue_free()
	build()
	if show_feedback():
		_feedback_button()
	move_child(_ink, -1)


## Navigation, in the same corner on every screen: `items` are [caption, callable], laid out so
## the last is the rightmost.
func nav(items: Array) -> void:
	var widths: Array[float] = []
	var total := 0.0
	var h := 40.0
	for item: Array in items:
		var box := Kit.box_for(str(item[0]), Pal.T_BODY, 150.0, 40.0)
		widths.append(box.x)
		total += box.x
		h = maxf(h, box.y)
	total += 20.0 * maxi(0, items.size() - 1)
	var x := 1920.0 - MARGIN - 28.0 - total
	for i in items.size():
		Kit.button(self, Rect2(x, MARGIN + 24.0, widths[i], h), str(items[i][0]), items[i][1])
		x += widths[i] + 20.0


func _process(_delta: float) -> void:
	queue_redraw()
	_show_toast(_message() if show_status() else "")
	if _ink != null:
		_ink.queue_redraw()


func _draw() -> void:
	pen = self
	paint_under()


func _paint_ink() -> void:
	pen = _ink
	if title != "":
		tracked(Vector2(LEFT, MARGIN + 52.0), title, Pal.T_TITLE, Pal.INK)
	if show_status():
		# The quiet line is the page's own; something that just happened is said on the strip.
		if _message() == "":
			plain(Vector2(LEFT, 1080.0 - MARGIN - 24.0), status, Pal.T_DIM, Pal.INK_LIGHT)
	paint()
	pen = self


# ── Helpers for `paint` ─────────────────────────────────────────────────────────────────

## Spaced capitals: titles, labels, anything that names a thing.
func tracked(pos: Vector2, s: String, size: int, color: Color, align: int = HORIZONTAL_ALIGNMENT_LEFT,
		heavy: bool = false) -> void:
	Pal.text(pen, pos, s.to_upper(), size, color, align, heavy, size * 0.08)


## Running text, as written.
func plain(pos: Vector2, s: String, size: int, color: Color, align: int = HORIZONTAL_ALIGNMENT_LEFT,
		heavy: bool = false) -> void:
	Pal.text(pen, pos, s, size, color, align, heavy)


## Break running text into lines no wider than `max_width`.
static func wrap_text(s: String, size: int, max_width: float) -> PackedStringArray:
	var out := PackedStringArray()
	var line := ""
	for word in s.split(" "):
		var candidate := word if line == "" else line + " " + word
		if line != "" and Pal.text_width(candidate, size) > max_width:
			out.append(line)
			line = word
		else:
			line = candidate
	if line != "":
		out.append(line)
	return out


## A paragraph wrapped to `max_width`, `pos` being the first baseline; returns the height used.
func paragraph(pos: Vector2, s: String, size: int, color: Color, max_width: float, line_height: float,
		max_lines: int = 99) -> float:
	var lines := wrap_text(s, size, max_width)
	var n := mini(lines.size(), max_lines)
	for i in n:
		var row := lines[i]
		if i == n - 1 and lines.size() > n:
			# Cut short: say so, rather than end mid-sentence as if that were the sentence.
			while row.length() > 1 and Pal.text_width(row + "…", size) > max_width:
				row = row.left(-1)
			row = row.rstrip(" ,;:") + "…"
		plain(Vector2(pos.x, pos.y + i * line_height), row, size, color)
	return n * line_height


## A framed panel with an optional title, in the house style.
func panel(rect: Rect2, heading: String = "", fill: Color = Pal.PAPER_SHADE) -> void:
	pen.draw_rect(rect, fill)
	pen.draw_rect(rect, Pal.RULE, false, Pal.HAIRLINE)
	if heading != "":
		tracked(rect.position + Vector2(16.0, 26.0), heading, Pal.T_DIM, Pal.INK_LIGHT)


## With nothing focused, the first arrow or Tab press puts the focus on the first control —
## so a keyboard or a controller can drive every screen from a standing start.
func _unhandled_input(event: InputEvent) -> void:
	if get_viewport().gui_get_focus_owner() != null:
		return
	for action: StringName in [&"ui_down", &"ui_up", &"ui_left", &"ui_right", &"ui_focus_next"]:
		if event.is_action_pressed(action):
			var first := find_next_valid_focus()
			if first != null:
				first.grab_focus()
				get_viewport().set_input_as_handled()
			return
