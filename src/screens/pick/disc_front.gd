class_name DiscFront
extends Control
## The front view of a disc-detainer lock — a slice through the disc the pick is in.
##
## The side view shows the pack as a row; it cannot show a disc turning. Seen from the front a
## disc is a circle with a gate in its rim, and turning it is just turning it: the gate comes
## round to the bar at the top, and the bar drops in. That is the whole lock, and this is the
## view it is read from. How it is drawn is `DiscArt.front`; the angles are the bodies' own.

const CAPTION_H := 36.0
const INSET := 12.0
## The drawn open turn: where it ends, rad, and how fast it gets there.
const OPEN_SHOW := 0.6
const OPEN_RATE := deg_to_rad(60.0)

var view: DiscLockView
var _window: Control
## The turn drawn on top of the sleeve's own once the lock is open, rad; negative while it is shut.
var _open_turn := -1.0
var _stated := 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_window = Control.new()
	_window.clip_contents = true
	_window.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_window.draw.connect(_draw_window)
	add_child(_window)


func _process(delta: float) -> void:
	if view == null or view.session == null:
		return
	if view.opened:
		_open_turn = minf(OPEN_SHOW, maxf(0.0, _open_turn) + OPEN_RATE * delta)
	else:
		_open_turn = -1.0
	queue_redraw()
	_window.queue_redraw()


## The disc's turn as the caption states it: steady, so the last digit is not a blur.
func _stated_degrees(i: int) -> float:
	var now := rad_to_deg(view.session.rig.turned(i) / DiscRig.RIM_R)
	if absf(now - _stated) >= 0.5 or now <= 0.0:
		_stated = now
	return _stated


func _draw() -> void:
	if view == null or view.session == null:
		return
	var rig := view.session.rig
	var i := clampi(view.front_chamber, 0, rig.count - 1)
	draw_rect(Rect2(Vector2.ZERO, size), Pal.PAPER_SHADE)
	draw_rect(Rect2(Vector2.ZERO, size), Pal.RULE, false, Pal.HAIRLINE)
	Pal.text(self, Vector2(14, 24), "FRONT — DISC %d" % (i + 1), Pal.T_DIM, Pal.INK_LIGHT,
		HORIZONTAL_ALIGNMENT_LEFT, false, 1.4)
	var word: String = ["FREE", "BINDING", "FALSE GATE", "SET", "PAST ITS GATE"][rig.states[i]]
	var full := "%s  ·  TURNED %d°" % [word, roundi(_stated_degrees(i))]
	var caption := full if Pal.text_width(full, Pal.T_DIM, false, 1.4) <= size.x - 28.0 else word
	Pal.text(self, Vector2(size.x - 14, size.y - 14), caption, Pal.T_DIM, Pal.INK_LIGHT,
		HORIZONTAL_ALIGNMENT_RIGHT, false, 1.4)
	_window.position = Vector2(INSET, CAPTION_H)
	_window.size = Vector2(size.x - INSET * 2.0, size.y - CAPTION_H * 2.0)


func _draw_window() -> void:
	if view == null or view.session == null:
		return
	var rig := view.session.rig
	var i := clampi(view.front_chamber, 0, rig.count - 1)
	var reach := (DiscArt.BODY_R + DiscArt.PAD) * 2.0
	var k := minf(_window.size.x / reach, _window.size.y / reach)
	DiscArt.front(_window, _window.size / 2.0, k, view.pose(maxf(0.0, _open_turn)), i)
