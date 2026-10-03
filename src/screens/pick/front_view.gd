class_name FrontView
extends Control
## The front view — the current pin's chamber seen from the face of the lock.
##
## The side cutaway cannot show a plug turning: it is a section along the axis. Seen from the
## front the plug is a circle, and turning it is just turning it. The shell's bore stays where it
## is, the plug's bore swings with the plug, and a driver straddling the shear line is caught
## between the two — which is what a binding pin is.
##
## The plug's angle is the rig's own (its slide ÷ its radius), the same whichever pin is on show,
## and the pins' heights are the bodies' own. How the chamber is drawn from those — both bores
## the same size, the pins with play in them — is `FrontArt`.
## It is a window, not the whole face: the driver, the key pin and the top of the plug.

const PLUG_RADIUS := PinSession.PLUG_RADIUS
## What the window shows, mm about the shear line.
const VIEW_TOP := 6.5
const VIEW_WIDTH := 7.4
const CAPTION_H := 36.0
const INSET := 12.0
const HATCH := 6.0
## The drawn open turn: where it ends, rad, and how fast it gets there.
const OPEN_SHOW := 0.39
const OPEN_RATE := deg_to_rad(45.0)

var view: PinLockView
var _window: Control
var _open_theta := -1.0
var _stated := 0.0
## How far the driver on show is leaning, rad: a spool caught in a false set.
var cant := 0.0
var _s := 1.0
var _ox := 0.0
var _oy := 0.0


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
		if _open_theta < 0.0:
			_open_theta = theta()
		_open_theta = minf(OPEN_SHOW, _open_theta + OPEN_RATE * delta)
	else:
		_open_theta = -1.0
	queue_redraw()
	_window.queue_redraw()


## The plug's turn, rad: its slide at the rim over its radius.
func theta() -> float:
	return view.session.rig.shift() / PLUG_RADIUS


## The turn as the caption states it: steady, so the last digit is not a blur.
func _stated_degrees() -> float:
	var now := rad_to_deg(drawn_theta())
	if absf(now - _stated) >= 0.04 or now == 0.0:
		_stated = now
	return _stated


func drawn_theta() -> float:
	return _open_theta if _open_theta >= 0.0 else theta()


func _state_word(state: int) -> String:
	return ["FREE", "BINDING", "FALSE SET", "SET", "OVERSET"][state]


func _draw() -> void:
	if view == null or view.session == null:
		return
	var rig := view.session.rig
	var i := clampi(view.front_chamber, 0, rig.count - 1)
	draw_rect(Rect2(Vector2.ZERO, size), Pal.PAPER_SHADE)
	draw_rect(Rect2(Vector2.ZERO, size), Pal.RULE, false, Pal.HAIRLINE)
	Pal.text(self, Vector2(14, 24), "FRONT — PIN %d" % (i + 1), Pal.T_DIM, Pal.INK_LIGHT,
		HORIZONTAL_ALIGNMENT_LEFT, false, 1.4)
	var full := "%s  ·  PLUG %.2f°" % [_state_word(rig.states[i]), _stated_degrees()]
	var caption := full if Pal.text_width(full, Pal.T_DIM, false, 1.4) <= size.x - 28.0 else _state_word(rig.states[i])
	Pal.text(self, Vector2(size.x - 14, size.y - 14), caption, Pal.T_DIM, Pal.INK_LIGHT,
		HORIZONTAL_ALIGNMENT_RIGHT, false, 1.4)

	# The window: as large as the panel takes, whichever of its height and its width runs out
	# first, and centred in it.
	var tall := VIEW_TOP - LockRig.FLOOR_Y
	_s = minf((size.y - CAPTION_H * 2.0) / tall, (size.x - INSET * 2.0) / VIEW_WIDTH)
	var win := Vector2(VIEW_WIDTH * _s, tall * _s)
	_window.position = Vector2((size.x - win.x) / 2.0, CAPTION_H + (size.y - CAPTION_H * 2.0 - win.y) / 2.0)
	_window.size = win
	_ox = win.x / 2.0
	_oy = VIEW_TOP * _s


## Window px for a point in the shell's frame, mm: u across (the way the plug slides), y up.
## Mirrored, so the plug turns anticlockwise as it does on the bench.
func _p(u: float, y: float) -> Vector2:
	return Vector2(_ox - u * _s, _oy - y * _s)


func _draw_window() -> void:
	if view == null or view.session == null:
		return
	var rig := view.session.rig
	var i := clampi(view.front_chamber, 0, rig.count - 1)
	var c: Dictionary = rig.chambers[i]
	cant = FrontArt.paint(_window, Rect2(Vector2.ZERO, _window.size), Vector2(_ox, _oy), _s, {
		"profile": c["profile"],
		"bind_at": c["bind_at"],
		"slide": rig.shift(),
		"extra": drawn_theta() - theta(),
		"driver": view._driver_shapes[i],
		"driver_y": -rig.drivers[i].position.y / LockRig.S,
		"key": view._key_shapes[i],
		"key_y": -rig.keys[i].position.y / LockRig.S,
		"state": rig.states[i],
		"colored": view.colored,
		"wrench": rig.wrench,
	})
