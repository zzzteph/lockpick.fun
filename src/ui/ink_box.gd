class_name InkBox
extends StyleBox
## A filled box with an ink border whose four sides are always the same thickness on screen.
##
## The stage is drawn at whatever size the window is, so a "2 px" border is 1.67 device pixels
## in one window and 1.42 in another. The engine's own flat box rounds each side separately and
## the top comes out twice as heavy as the bottom. Here the border is a whole number of device
## pixels thick (`Pal.px`), and a strip that long covers the same number of pixel rows wherever
## it happens to land.

var fill := Color.WHITE
var border := Color.BLACK
## Nominal border width, stage px. Zero draws no border.
var width := 2.0
var filled := true


static func make(fill_color: Color, border_color: Color, border_width: float = 2.0) -> InkBox:
	var box := InkBox.new()
	box.fill = fill_color
	box.border = border_color
	box.width = border_width
	# Padding at the sides only: a caption is centred and already capped at half its box's
	# height, and a margin above and below would make the engine grow every short box.
	box.content_margin_left = 8.0
	box.content_margin_right = 8.0
	box.content_margin_top = 0.0
	box.content_margin_bottom = 0.0
	return box


func _draw(to_canvas_item: RID, rect: Rect2) -> void:
	if filled:
		RenderingServer.canvas_item_add_rect(to_canvas_item, rect, fill)
	if width > 0.0:
		frame(to_canvas_item, rect, border, Pal.px(width))


## Four strips just inside `rect`, `t` thick.
static func frame(item: RID, rect: Rect2, color: Color, t: float) -> void:
	var w := rect.size.x
	var h := rect.size.y
	if w <= 0.0 or h <= 0.0:
		return
	t = minf(t, minf(w, h) / 2.0)
	RenderingServer.canvas_item_add_rect(item, Rect2(rect.position, Vector2(w, t)), color)
	RenderingServer.canvas_item_add_rect(item, Rect2(rect.position.x, rect.end.y - t, w, t), color)
	RenderingServer.canvas_item_add_rect(item, Rect2(rect.position.x, rect.position.y + t, t, h - 2.0 * t), color)
	RenderingServer.canvas_item_add_rect(item, Rect2(rect.end.x - t, rect.position.y + t, t, h - 2.0 * t), color)
