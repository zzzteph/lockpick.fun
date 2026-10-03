class_name KitSlider
extends HSlider
## A horizontal slider: caption above, an amber-filled track, the value beside it — outside the
## sweep, because a hand setting a slider covers the middle of its own control.
##
## A real slider underneath (dragging, arrows, Home/End, and a screen reader hears a slider with
## a value); the look is drawn on top of it.

## The value was moved by the player. (`changed` is the engine's own, for the range itself.)
signal moved(value: float)

var caption := ""


static func make(parent: Node, rect: Rect2, text: String, start: float, on_change: Callable, low: float = 0.0,
		high: float = 1.0, by: float = 0.05) -> KitSlider:
	var s := KitSlider.new()
	s.caption = text
	s.min_value = low
	s.max_value = high
	s.step = by
	s.set_value_no_signal(start)
	s.position = rect.position
	s.theme_type_variation = "BareSlider"
	s.accessibility_name = text
	s.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	if on_change.is_valid():
		s.moved.connect(on_change)
	parent.add_child(s)
	s.size = rect.size
	return s


func _ready() -> void:
	value_changed.connect(func(v: float) -> void:
		moved.emit(v)
		queue_redraw())
	focus_entered.connect(queue_redraw)
	focus_exited.connect(queue_redraw)


## The value as it is written beside the track: a share of the whole when the range is 0 to 1.
func stated() -> String:
	if is_zero_approx(min_value) and is_equal_approx(max_value, 1.0):
		return "%d%%" % roundi(value * 100.0)
	return "%.2f" % value


func _draw() -> void:
	Pal.text(self, Vector2(0.0, Pal.T_DIM - 3.0), caption.to_upper(), Pal.T_DIM, Pal.INK_LIGHT,
		HORIZONTAL_ALIGNMENT_LEFT, false, Pal.T_DIM * 0.08)
	var track_h := maxf(10.0, roundf(size.y * 0.34))
	var track_y := size.y - track_h - 2.0
	var track := Rect2(0.0, track_y, size.x, track_h)
	draw_rect(track, Color(Pal.RULE, 0.6))
	var t := (value - min_value) / (max_value - min_value)
	var filled := size.x * clampf(t, 0.0, 1.0)
	draw_rect(Rect2(0.0, track_y, filled, track_h), Pal.AMBER)
	draw_rect(track, Pal.INK, false, Pal.HAIRLINE)
	# The handle: where to take hold of it, and where it stands when the fill is empty.
	var grip := Pal.px(4.0)
	draw_rect(Rect2(clampf(filled - grip / 2.0, 0.0, size.x - grip), track_y - 4.0, grip, track_h + 8.0), Pal.INK)
	Pal.text(self, Vector2(size.x + 16.0, track_y + track_h), stated(), Pal.T_BODY, Pal.INK)
	# The marks are for a keyboard or a pad; a pointer already knows where it is.
	if has_focus(true):
		FocusMarks.paint(get_canvas_item(), Rect2(Vector2.ZERO, size))
