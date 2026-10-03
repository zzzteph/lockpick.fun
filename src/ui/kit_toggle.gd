class_name KitToggle
extends Button
## A checkbox with a caption: a box that fills teal and takes a tick when on.
##
## A real toggle button underneath, so the keyboard, a controller and a screen reader all get
## what the engine gives one — focus, activation, "pressed" — and the look is drawn on top.
## On is never said by colour alone: the box is ticked as well as filled.

signal changed(value: bool)

var caption := ""
var value: bool:
	get:
		return button_pressed
	set(on):
		set_pressed_no_signal(on)
		queue_redraw()


static func make(parent: Node, rect: Rect2, text: String, on: bool, on_change: Callable) -> KitToggle:
	var t := KitToggle.new()
	t.caption = text
	t.toggle_mode = true
	t.set_pressed_no_signal(on)
	t.position = rect.position
	t.theme_type_variation = "Bare"
	t.accessibility_name = text
	t.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	if on_change.is_valid():
		t.changed.connect(on_change)
	parent.add_child(t)
	t.size = rect.size
	return t


func _ready() -> void:
	toggled.connect(_on_toggled)
	focus_entered.connect(queue_redraw)
	focus_exited.connect(queue_redraw)
	mouse_entered.connect(queue_redraw)
	mouse_exited.connect(queue_redraw)


func _on_toggled(on: bool) -> void:
	if Kit.click_hook.is_valid():
		Kit.click_hook.call()
	changed.emit(on)
	queue_redraw()


func _draw() -> void:
	var box := minf(roundf(Pal.T_BODY * 1.2), maxf(16.0, size.y - 8.0))
	var by := (size.y - box) / 2.0
	var square := Rect2(0.0, by, box, box)
	Pal.box(self, square, Pal.TEAL if value else (Pal.PAPER if is_hovered() else Pal.PAPER_SHADE))
	if value:
		# The tick, in the page's own colour on the fill.
		var a := square.position + Vector2(box * 0.22, box * 0.54)
		var b := square.position + Vector2(box * 0.42, box * 0.74)
		var c := square.position + Vector2(box * 0.8, box * 0.26)
		draw_polyline(PackedVector2Array([a, b, c]), Pal.PAPER, maxf(2.0, box * 0.14), true)
	Pal.text(self, Vector2(box + 14.0, size.y / 2.0 + Pal.T_BODY * 0.36), caption.to_upper(), Pal.T_BODY, Pal.INK,
		HORIZONTAL_ALIGNMENT_LEFT, false, Pal.T_BODY * 0.08)
	if has_focus(true):
		FocusMarks.paint(get_canvas_item(), Rect2(Vector2.ZERO, size))
