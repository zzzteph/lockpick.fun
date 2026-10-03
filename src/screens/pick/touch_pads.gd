class_name TouchPads
extends Node2D
## The on-screen controls, drawn only once a finger has touched the glass.
##
## Same drafting language as everything else: hairline frames, hatched fill for "engaged", a
## label in the dimension face. A phone player gets controls; a desktop player never sees them,
## because a touch is what turns them on and a mouse never sends one.

## The pin lock's touch state, or null on a wheel pack — which has its own gestures on the lock
## itself and takes only the pause pad from here.
var touch: PickTouch
var gun := false
## The needle is being drawn back.
var charging := false


func _process(_delta: float) -> void:
	queue_redraw()


## A pad is a button: the game's own button, and inverted while a thumb is on it — the same
## way every other pressed thing in the game says so, and not by colour alone.
func _pad(rect: Rect2, caption: String, lit: bool = false) -> void:
	Pal.box(self, rect, Pal.INK if lit else Pal.PAPER_SHADE)
	# Sized to fit the pad, measured against the real face.
	var size := Pal.T_HEADING
	var word := caption.to_upper()
	while size > 12 and Pal.text_width(word, size, false, size * 0.08) > rect.size.x - 16.0:
		size -= 1
	Pal.text(self, Vector2(rect.get_center().x, rect.get_center().y + size * 0.36), word, size,
		Pal.PAPER if lit else Pal.INK, HORIZONTAL_ALIGNMENT_CENTER, false, size * 0.08)


func _draw() -> void:
	if not PickTouch.active:
		return
	_pad(PickTouch.PAUSE_PAD, "pause")
	if touch == null:
		return
	if gun:
		_pad(PickTouch.STRIKE_PAD, "let go to strike" if charging else "hold to strike", charging)
	else:
		_pad(PickTouch.COUNTER_PAD, "counter-rotate", touch.counter_pointer != PickTouch.NO_POINTER)
	_pad(PickTouch.WITHDRAW_PAD, "pick out")
	_draw_wrench()


## The wrench slider. It reads bottom-up with `off` as its own band at the foot: releasing
## tension is a move made in a hurry, and a control that has to be aimed at to release is a
## control that loses the lock. Filled bands are hatched, so the level reads without colour.
func _draw_wrench() -> void:
	var slider := PickTouch.WRENCH_SLIDER
	var cx := slider.get_center().x
	draw_rect(slider, Pal.PAPER_SHADE)
	for at in PickTouch.STEPS + 1:
		var top := PickTouch.y_for_step(at + 1)
		var bottom := PickTouch.y_for_step(at)
		var band := Rect2(slider.position.x, top, slider.size.x, bottom - top)
		if at > 0 and at <= touch.step:
			draw_rect(band, Color(Pal.AMBER, 0.8))
			var y := band.position.y + 5.0
			while y < band.end.y:
				draw_line(Vector2(band.position.x, y), Vector2(band.end.x, y), Color(Pal.INK, 0.35), 1.0)
				y += 5.0
		draw_rect(band, Pal.RULE, false, Pal.HAIRLINE)
		if at == 0:
			Pal.text(self, Vector2(cx, band.get_center().y + Pal.T_DIM * 0.36), "OFF", Pal.T_DIM,
				Pal.INK if touch.step == 0 else Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_CENTER, false, Pal.T_DIM * 0.08)
	# The frame last, over the bands, so the control reads as one object.
	Pal.box(self, slider, Color(0, 0, 0, 0))
	# The number, big, above the slider — the one reading a player calls out to themselves.
	Pal.text(self, Vector2(cx, slider.position.y - 38.0), "—" if touch.step == 0 else str(touch.step), Pal.T_HEADING,
		Pal.AMBER_TEXT if touch.step > 0 else Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_CENTER, true)
	Pal.text(self, Vector2(cx, slider.position.y - 12.0), "WRENCH", Pal.T_DIM, Pal.INK_LIGHT,
		HORIZONTAL_ALIGNMENT_CENTER, false, Pal.T_DIM * 0.08)
