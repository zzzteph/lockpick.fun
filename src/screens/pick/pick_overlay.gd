class_name PickOverlay
extends Node2D
## What is drawn over the lock: the lesson's one line, the audio captions, and the payoff when
## it opens — the burst, the rank stamp, the achievement cards.

const LETTERS: Array[String] = ["S", "A", "B", "C", "D", "E", "F"]

var sequence := OpenSequence.new()
## Where the burst and the sweep radiate from.
var centre := Vector2(960.0, 536.0)
## Achievements earned by this open: dictionaries with "name" and optionally "art" (a Texture2D).
var earned: Array = []
## The lesson's current line ("" for none), and its progress pips.
var lesson_line := ""
var lesson_step := 0
var lesson_total := 0
## Audio captions, oldest first: [text, life, is_state].
var captions: Array = []
var show_skip_hint := true


func _process(_delta: float) -> void:
	queue_redraw()


func _draw() -> void:
	_draw_captions()
	_draw_lesson()
	if sequence.elapsed > 0.0 and not sequence.settled():
		_draw_payoff()


func _draw_lesson() -> void:
	if lesson_line == "":
		return
	# The box is sized from the sentence, not the sentence from the box.
	var pip_room := lesson_total * 14.0 + 36.0
	var max_text := 1920.0 - 2.0 * (pip_room + 40.0)
	var size := Pal.T_BODY
	var text_w := Pal.text_width(lesson_line, size)
	while size > 15 and text_w > max_text:
		size -= 1
		text_w = Pal.text_width(lesson_line, size)
	var width := ceilf(text_w) + 56.0
	const H := 46.0
	var x := (1920.0 - width) / 2.0
	# Under the header, above the drawing.
	const Y := 100.0
	Pal.box(self, Rect2(x, Y, width, H), Pal.PAPER_SHADE)
	draw_rect(Rect2(x, Y, 6.0, H), Pal.AMBER_TEXT)
	Pal.text(self, Vector2(960.0, Y + H / 2.0 + size * 0.36), lesson_line, size, Pal.INK, HORIZONTAL_ALIGNMENT_CENTER)
	# Progress pips, right of the line: the only progress shown, because a step counter would
	# invite reading ahead rather than playing.
	var pips_x := x + width + 22.0
	for i in lesson_total:
		var at := Vector2(pips_x + i * 14.0, Y + H / 2.0)
		draw_circle(at, 4.0, Pal.TEAL_TEXT if i < lesson_step else Pal.PAPER)
		draw_arc(at, 4.0, 0.0, TAU, 16, Pal.RULE, Pal.HAIRLINE)


func _draw_captions() -> void:
	if captions.is_empty():
		return
	const LINE_H := 30.0
	var bottom := 1080.0 - 210.0
	var top := bottom - captions.size() * LINE_H
	for i in captions.size():
		var c: Array = captions[i]
		var fade := minf(1.0, float(c[1]) / 0.4)
		var y := top + i * LINE_H
		var r := Rect2((1920.0 - 640.0) / 2.0, y, 640.0, LINE_H - 4.0)
		draw_rect(r, Color(Pal.PAPER, 0.88 * fade))
		draw_rect(r, Color(Pal.RULE, fade), false, Pal.HAIRLINE)
		Pal.text(self, Vector2(960.0, y + 20.0), str(c[0]), Pal.T_BODY,
			Color(Pal.VIOLET_TEXT if c[2] else Pal.INK, fade), HORIZONTAL_ALIGNMENT_CENTER)


func _draw_payoff() -> void:
	var seq := sequence
	# The grid sweeps outward from the plug and fades.
	var sw := seq.sweep()
	if sw > 0.0:
		for ring in 4:
			var r := maxf(0.0, sw * 1400.0 - ring * 46.0)
			if r > 0.0:
				draw_arc(centre, r, 0.0, TAU, 96, Color(Pal.RULE, (1.0 - sw) * 0.9), Pal.HAIRLINE)
	# A thin radial burst of hairlines: technical, not sparkly.
	var b := seq.burst()
	if b > 0.0:
		var inner := 40.0 + (1.0 - b) * 30.0
		var outer := inner + 90.0 + (1.0 - b) * 460.0
		for i in OpenSequence.BURST_RAYS:
			var dir := Vector2.from_angle(float(i) / OpenSequence.BURST_RAYS * TAU)
			draw_line(centre + dir * inner, centre + dir * outer, Color(Pal.INK, b * 0.7), Pal.HAIRLINE)
	# The rank, stamping down onto its baseline as it fades in.
	var t := seq.stamp()
	if seq.rank >= 0 and t > 0.0:
		var ink := Pal.TEAL_TEXT if seq.rank <= 1 else (Pal.AMBER_TEXT if seq.rank <= 3 else Pal.CRIMSON_TEXT)
		var size := roundi(Pal.T_PAYOUT * (1.0 + (1.0 - t) * 0.6))
		Pal.text(self, Vector2(960.0, 152.0), LETTERS[clampi(seq.rank, 0, 6)], size, Color(ink, t),
			HORIZONTAL_ALIGNMENT_CENTER, true)
		Pal.text(self, Vector2(960.0, 182.0), "rank", Pal.T_BODY, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_CENTER)
	# Achievement cards, sliding in from the right, staggered, stacking down from a fixed top.
	if not earned.is_empty():
		const CARD_H := 76.0
		var card_w := 420.0
		for a: Dictionary in earned:
			card_w = maxf(card_w, ceilf(Pal.text_width(str(a["name"]), Pal.T_HEADING)) + 44.0 + (CARD_H - 14.0) + 8.0)
		for i in earned.size():
			if not seq.card_visible(i):
				continue
			var a: Dictionary = earned[i]
			var x := 1920.0 - 48.0 - card_w + seq.card_offset(i)
			var y := 420.0 + i * (CARD_H + 12.0)
			Pal.box(self, Rect2(x, y, card_w, CARD_H), Pal.PAPER_SHADE)
			# A teal bar down the leading edge: the same "captured" colour a set pin gets.
			draw_rect(Rect2(x, y, 7.0, CARD_H), Pal.TEAL_TEXT)
			var tx := x + 22.0
			var art: Texture2D = a.get("art")
			if art != null:
				var side := CARD_H - 14.0
				draw_texture_rect(art, Rect2(x + 16.0, y + 7.0, side, side), false)
				tx = x + 16.0 + side + 14.0
			Pal.text(self, Vector2(tx, y + 14.0 + Pal.T_DIM), "ACHIEVEMENT", Pal.T_DIM, Pal.INK_LIGHT)
			Pal.text(self, Vector2(tx, y + 14.0 + Pal.T_DIM + 10.0 + Pal.T_HEADING), str(a["name"]), Pal.T_HEADING, Pal.INK)
	if show_skip_hint and seq.can_skip() and not seq.skipped:
		Pal.text(self, Vector2(1920.0 - 60.0, 116.0), "tap to skip" if PickTouch.active else "any key to skip",
			Pal.T_DIM, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_RIGHT)
	# The flash goes over everything: it is the whole picture flashing, not a layer.
	var f := seq.flash()
	if f > 0.0:
		draw_rect(Rect2(Vector2.ZERO, Pal.STAGE), Color(Pal.HIGHLIGHT, f * 0.55))
