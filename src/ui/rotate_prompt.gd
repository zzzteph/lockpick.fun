class_name RotatePrompt
extends Control
## A phone held the wrong way up.
##
## The stage is a fixed 1920×1080 and every screen is laid out across it, so a portrait phone
## letterboxes it down to a strip too small to read, let alone pick with. Saying so is better
## than showing something technically visible and actually unusable.
##
## It is asked of the device, not of the session's history: a phone opened upright shows this on
## its first frame, before anything has been touched. A desktop window dragged tall and narrow
## does not — nobody there has a way to turn the screen.

const HEADING := "TURN THE PHONE SIDEWAYS"
const SUB := "a lock is wider than it is tall"
## The heading's size as a share of the screen's narrow edge. The stage is scaled to that edge in
## portrait, so on the stage it is one number whatever the phone.
const HEADING_SHARE := 0.07


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	# Over every screen, and nothing under it may be pressed through it.
	z_index = 100
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false


## True while the prompt is what the player should be looking at.
static func wanted(window: Window) -> bool:
	if window.size.y <= window.size.x:
		return false
	return PickTouch.active or DisplayServer.is_touchscreen_available()


func _process(_delta: float) -> void:
	var show := wanted(get_window())
	if show != visible:
		visible = show
		queue_redraw()


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, Pal.STAGE), Pal.PAPER)
	var size := roundi(Pal.STAGE.x * HEADING_SHARE)
	while size > 40 and Pal.text_width(HEADING, size, false, size * 0.08) > Pal.STAGE.x * 0.88:
		size -= 2
	var body := roundi(size * 0.52)
	var mid := Pal.STAGE / 2.0
	Pal.text(self, Vector2(mid.x, mid.y - body), HEADING, size, Pal.INK, HORIZONTAL_ALIGNMENT_CENTER, false, size * 0.08)
	Pal.text(self, Vector2(mid.x, mid.y + body * 2.0), SUB, body, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_CENTER)
