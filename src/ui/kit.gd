class_name Kit
extends RefCounted
## The house style for controls: bordered boxes in ink on drafting paper, one typeface, every
## caption in spaced capitals. Built once as a Theme so every Button, Label and LineEdit in the
## game looks the same without a line of per-screen styling.

static var _theme: Theme
static var _spaced: Dictionary = {}
## Called on every button and card press, so one place gives the whole interface its click.
static var click_hook: Callable


## The game's font with the letter spacing its captions are set in (8% of the size).
static func spaced(size: int, heavy: bool = false) -> FontVariation:
	var key := size * 2 + (1 if heavy else 0)
	if not _spaced.has(key):
		var f := FontVariation.new()
		f.base_font = Pal.bold() if heavy else Pal.font()
		f.spacing_glyph = roundi(size * 0.08)
		_spaced[key] = f
	return _spaced[key]


static func _box(fill: Color, border: Color, width: float = 2.0) -> InkBox:
	return InkBox.make(fill, border, width)


## The one Theme every screen shares. It is filled in place, so after the palette changes
## `restyle()` repaints every control already on screen without anyone re-assigning a theme.
static func theme() -> Theme:
	if _theme != null:
		return _theme
	_theme = Theme.new()
	restyle()
	return _theme


static func restyle() -> void:
	if _theme == null:
		return
	var t := _theme
	t.default_font = spaced(Pal.T_BODY)
	t.default_font_size = Pal.T_BODY

	# Where the keyboard or the pad is: corner ticks off the control, never a box round it.
	var ring := FocusMarks.new()

	# Under the pointer a button lightens and its frame thickens: two cues, neither of them a
	# colour, so it reads on either theme and to any eye.
	t.set_stylebox("normal", "Button", _box(Pal.PAPER_SHADE, Pal.INK))
	t.set_stylebox("hover", "Button", _box(Pal.PAPER, Pal.INK, 4.0))
	t.set_stylebox("pressed", "Button", _box(Pal.RULE, Pal.INK, 4.0))
	t.set_stylebox("disabled", "Button", _box(Color(Pal.RULE, 0.35), Pal.RULE))
	t.set_stylebox("focus", "Button", ring)
	t.set_color("font_color", "Button", Pal.INK)
	t.set_color("font_hover_color", "Button", Pal.INK)
	t.set_color("font_pressed_color", "Button", Pal.INK)
	t.set_color("font_focus_color", "Button", Pal.INK)
	t.set_color("font_disabled_color", "Button", Pal.INK_LIGHT)

	# The one primary action on a screen: filled in ink with reversed text.
	t.set_type_variation("Primary", "Button")
	t.set_stylebox("normal", "Primary", _box(Pal.INK, Pal.INK))
	t.set_stylebox("hover", "Primary", _box(Pal.AMBER, Pal.INK))
	t.set_stylebox("pressed", "Primary", _box(Pal.AMBER, Pal.INK))
	t.set_stylebox("focus", "Primary", ring)
	t.set_color("font_color", "Primary", Pal.PAPER)
	t.set_color("font_hover_color", "Primary", Pal.PAPER)
	t.set_color("font_pressed_color", "Primary", Pal.PAPER)
	t.set_color("font_focus_color", "Primary", Pal.PAPER)

	# A selected segment is filled like the primary, but does not light up under the pointer:
	# it is a state, not an invitation.
	t.set_type_variation("Segment", "Button")
	t.set_type_variation("SegmentOn", "Button")
	t.set_stylebox("normal", "SegmentOn", _box(Pal.INK, Pal.INK))
	t.set_stylebox("hover", "SegmentOn", _box(Pal.INK, Pal.INK))
	t.set_stylebox("pressed", "SegmentOn", _box(Pal.INK, Pal.INK))
	t.set_stylebox("hover_pressed", "SegmentOn", _box(Pal.INK, Pal.INK))
	t.set_stylebox("hover_pressed", "Segment", _box(Pal.PAPER, Pal.INK, 4.0))
	t.set_stylebox("focus", "SegmentOn", ring)
	for key: String in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		t.set_color(key, "SegmentOn", Pal.PAPER)

	# A card: the same frame as a button, and a faint one when it is locked.
	t.set_type_variation("Card", "Button")
	t.set_stylebox("disabled", "Card", _box(Color(Pal.RULE, 0.25), Pal.RULE, 1))

	# Controls that draw themselves: the engine's own box, text and grabber are switched off.
	t.set_type_variation("Bare", "Button")
	for state: String in ["normal", "hover", "pressed", "hover_pressed", "disabled", "focus"]:
		t.set_stylebox(state, "Bare", StyleBoxEmpty.new())
	t.set_type_variation("BareSlider", "HSlider")
	for part: String in ["slider", "grabber_area", "grabber_area_highlight", "focus"]:
		t.set_stylebox(part, "BareSlider", StyleBoxEmpty.new())
	var nothing := ImageTexture.create_from_image(Image.create_empty(1, 1, false, Image.FORMAT_RGBA8))
	for icon: String in ["grabber", "grabber_highlight", "grabber_disabled", "tick"]:
		t.set_icon(icon, "BareSlider", nothing)

	# The message strip: what just happened, said where it will be seen.
	t.set_type_variation("Toast", "Label")
	var strip := _box(Pal.INK, Pal.INK, 0.0)
	strip.content_margin_left = 18.0
	strip.content_margin_right = 18.0
	strip.content_margin_top = 10.0
	strip.content_margin_bottom = 10.0
	t.set_stylebox("normal", "Toast", strip)
	t.set_color("font_color", "Toast", Pal.PAPER)

	t.set_color("font_color", "Label", Pal.INK)

	t.set_stylebox("normal", "LineEdit", _box(Pal.PAPER_SHADE, Pal.INK))
	t.set_stylebox("focus", "LineEdit", _box(Pal.PAPER, Pal.INK, 3))
	t.set_color("font_color", "LineEdit", Pal.INK)
	t.set_color("font_placeholder_color", "LineEdit", Pal.INK_LIGHT)
	t.set_color("caret_color", "LineEdit", Pal.INK)

	# A box for a paragraph: the line edit's look, with room round the words.
	var page := _box(Pal.PAPER_SHADE, Pal.INK)
	var page_on := _box(Pal.PAPER, Pal.INK, 3)
	for box: InkBox in [page, page_on]:
		box.content_margin_left = 14.0
		box.content_margin_right = 14.0
		box.content_margin_top = 10.0
		box.content_margin_bottom = 10.0
	t.set_stylebox("normal", "TextEdit", page)
	t.set_stylebox("focus", "TextEdit", page_on)
	t.set_stylebox("read_only", "TextEdit", page)
	t.set_font("font", "TextEdit", Pal.font())
	t.set_font_size("font_size", "TextEdit", Pal.T_BODY)
	t.set_color("font_color", "TextEdit", Pal.INK)
	t.set_color("font_placeholder_color", "TextEdit", Pal.INK_LIGHT)
	t.set_color("caret_color", "TextEdit", Pal.INK)
	t.set_color("selection_color", "TextEdit", Color(Pal.AMBER, 0.4))
	t.set_color("background_color", "TextEdit", Color(0, 0, 0, 0))


## A button in the house style at `rect` on the stage. `on_press` runs when it is activated.
static func button(parent: Node, rect: Rect2, caption: String, on_press: Callable, primary: bool = false,
		size: int = Pal.T_BODY) -> Button:
	var b := Button.new()
	b.text = caption.to_upper()
	# A screen reader is given the caption as written, not as it is lettered.
	b.accessibility_name = caption
	b.position = rect.position
	b.size = rect.size
	b.clip_text = true
	b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	if primary:
		b.theme_type_variation = "Primary"
	# The caption gives way to the box: capped at half its height, then shrunk until it fits.
	var fitted := mini(size, int(floor(rect.size.y * 0.5)))
	while fitted > 9 and Pal.text_width(b.text, fitted, false, fitted * 0.08) > rect.size.x - 16.0:
		fitted -= 1
	b.add_theme_font_override("font", spaced(fitted))
	b.add_theme_font_size_override("font_size", fitted)
	b.pressed.connect(_clicked)
	if on_press.is_valid():
		b.pressed.connect(on_press)
	parent.add_child(b)
	# Sized again once it is in the tree. Outside it the engine's default theme sets the
	# minimum, and a box shorter than that had already been grown to it.
	b.size = rect.size
	return b


static func _clicked() -> void:
	if click_hook.is_valid():
		click_hook.call()


## The width a caption needs as a button, with the game's padding.
static func caption_width(caption: String, size: int = Pal.T_BODY) -> float:
	return ceilf(Pal.text_width(caption.to_upper(), size, false, size * 0.08)) + 28.0


## A box that holds `caption` at `size` without shrinking it: a button caps its caption at half
## its height, so a box that wants a face of `size` has to be at least twice that tall.
static func box_for(caption: String, size: int = Pal.T_BODY, min_w: float = 0.0, min_h: float = 0.0) -> Vector2:
	return Vector2(maxf(min_w, caption_width(caption, size)), maxf(min_h, size * 2.0 + 14.0))


## A text label on the stage. Captions that name things are spaced capitals (`upper`); running
## text is set as written.
static func label(parent: Node, pos: Vector2, text: String, size: int = Pal.T_BODY, color: Color = Pal.INK,
		upper: bool = false, width: float = 0.0) -> Label:
	var l := Label.new()
	l.text = text.to_upper() if upper else text
	l.position = pos
	l.add_theme_font_override("font", spaced(size) if upper else Pal.font())
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if width > 0.0:
		l.size = Vector2(width, 0.0)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	parent.add_child(l)
	return l


## Say what a control is to someone who cannot see what is painted on it: its name, and
## anything more worth hearing (a record, why it is locked).
static func describe(control: Control, spoken_name: String, more: String = "") -> void:
	control.accessibility_name = spoken_name
	control.accessibility_description = more


## A card: a framed box that can be pressed, with whatever the screen paints on top of it.
## A locked card is drawn faint and cannot be pressed or focused. `spoken` is what the card is
## called aloud — a card has no caption of its own, only what the screen paints over it.
static func card(parent: Node, rect: Rect2, on_press: Callable, locked: bool = false, spoken: String = "",
		more: String = "") -> Button:
	var b := Button.new()
	b.position = rect.position
	b.size = rect.size
	b.theme_type_variation = "Card"
	b.disabled = locked
	describe(b, spoken, more)
	if locked:
		b.focus_mode = Control.FOCUS_NONE
	else:
		b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	b.pressed.connect(_clicked)
	if on_press.is_valid():
		b.pressed.connect(on_press)
	parent.add_child(b)
	return b


## A row of mutually exclusive options. `on_change` is called with the chosen index. `spoken`
## names the group aloud ("Level"), so each cell is heard as "Level: Training, selected".
static func segmented(parent: Node, rect: Rect2, captions: Array, selected: int, on_change: Callable,
		spoken: String = "") -> Array[Button]:
	var cells: Array[Button] = []
	var w := rect.size.x / captions.size()
	var group := ButtonGroup.new()
	for i in captions.size():
		var cell := button(parent, Rect2(rect.position.x + w * i, rect.position.y, w, rect.size.y), str(captions[i]),
			Callable(), i == selected)
		cell.theme_type_variation = "SegmentOn" if i == selected else "Segment"
		# One of a set, and it says which: the engine tells a screen reader the rest.
		cell.toggle_mode = true
		cell.button_group = group
		cell.set_pressed_no_signal(i == selected)
		if spoken != "":
			cell.accessibility_name = "%s: %s" % [spoken, str(captions[i])]
		cells.append(cell)
	for i in cells.size():
		cells[i].pressed.connect(func() -> void:
			for k in cells.size():
				cells[k].theme_type_variation = "SegmentOn" if k == i else "Segment"
			on_change.call(i))
	return cells
