class_name FocusMarks
extends StyleBox
## Where the keyboard or the controller is: four corner ticks in ink, standing just off the
## control like the crop marks on a drawing.
##
## Not a box round the control and not a colour: the marks say "here" without changing what the
## control looks like, and they only appear once somebody is steering by key or by pad — a
## pointer already knows where it is.

## How far the ticks stand off the control, and how long each arm is, stage px.
const OFFSET := 5.0
const ARM := 16.0
const WEIGHT := 3.0


func _draw(to_canvas_item: RID, rect: Rect2) -> void:
	paint(to_canvas_item, rect)


func _get_draw_rect(rect: Rect2) -> Rect2:
	return rect.grow(OFFSET + Pal.px(WEIGHT))


## The same marks, for controls that draw themselves.
static func paint(item: RID, rect: Rect2) -> void:
	var t := Pal.px(WEIGHT)
	var r := rect.grow(OFFSET + t)
	var arm := minf(ARM, minf(r.size.x, r.size.y) / 3.0)
	for corner: Vector2 in [Vector2(0, 0), Vector2(1, 0), Vector2(0, 1), Vector2(1, 1)]:
		var at := r.position + r.size * corner
		var dir := Vector2(1.0 - 2.0 * corner.x, 1.0 - 2.0 * corner.y)
		var across := Rect2(at, Vector2(arm * dir.x, t * dir.y)).abs()
		var down := Rect2(at, Vector2(t * dir.x, arm * dir.y)).abs()
		RenderingServer.canvas_item_add_rect(item, across, Pal.INK)
		RenderingServer.canvas_item_add_rect(item, down, Pal.INK)
