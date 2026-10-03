class_name FrontArt
extends RefCounted
## One chamber seen from the face of the lock, drawn the way a lock is made.
##
## The two bores are the same size and in line, and a pin has play in them. What differs from
## chamber to chamber is the pin: the one that binds first is the fattest, and each later one is a
## shade slimmer, so the plug has that much further to turn before it pinches it. The plug is drawn
## at its true angle — the same in every chamber's view — and its bore's edge reaches the driver
## exactly when that pin binds.
##
## The rig underneath gets its binding order another way (it cuts each bore's edge back instead of
## slimming the pin, and its pins cannot tilt), so the pins are *posed* here rather than copied:
## each is put where a rigid pin has to be, given the plug's angle and the two bores. A plain pin
## is pushed over against the far wall. A spool whose waist the plug has turned into leans — as a
## rigid body, by the least it must — with its foot round in the plug and its head still in the
## shell. Nothing of the plug is ever drawn through a pin.

const HATCH := 6.0
## How far a caught driver may be leant before the picture gives up and lets a line cross, rad.
const MAX_CANT := deg_to_rad(14.0)
const CANT_STEP := deg_to_rad(0.5)


## The play a pin is drawn with beyond its real few hundredths, mm of plug travel. The one
## liberty taken with scale: a real bore's clearance is too fine to see, so the first of the
## plug's turn — taking up that clearance — is drawn larger than life, the same in every chamber.
const PLAY := 0.26
## The plug's slide when it reaches the first pin to bind, mm.
const FIRST := LockRig.PLUG_CLEAR + LockRig.SHELL_CLEAR


## A slide of the plug as it is drawn: the take-up of the play, then mm for mm.
static func drawn(slide: float) -> float:
	return slide + PLAY * clampf(slide / FIRST, 0.0, 1.0)


## The bore's half-width as drawn, mm: the fattest pin (the first to bind) is the rig's own
## size, and has half the plug's drawn travel as play on either side.
static func bore() -> float:
	return LockRig.PIN_R + (FIRST + PLAY) / 2.0


## The radius a pin is drawn at, mm, from how far the plug slides before it binds.
static func pin_radius(bind_at: float) -> float:
	return maxf(LockRig.PIN_R * 0.78, bore() - drawn(bind_at) / 2.0)


## Draw the chamber. `win` is the window (the caller clips to it), `o` where the bore's axis meets
## the shear line, `k` the px per mm. `d` holds:
##   profile, bind_at, slide (mm), extra (rad of drawn turn beyond the slide's own, for the open),
##   driver (outline, x across / y up about its centre, at the rig's radius), driver_y,
##   key (outline), key_y, state, colored, wrench (N), overset (bool).
## Mirrored, so the plug turns anticlockwise as it does on the bench. Returns the driver's cant, rad.
static func paint(c: CanvasItem, win: Rect2, o: Vector2, k: float, d: Dictionary) -> float:
	var half := bore()
	var r := pin_radius(float(d["bind_at"]))
	var play := half - r
	var fat := r / LockRig.PIN_R
	var radius := PinSession.PLUG_RADIUS
	var slide := drawn(float(d["slide"]))
	var extra: float = d.get("extra", 0.0)
	var theta := slide / radius + extra
	var colored: bool = d.get("colored", true)
	var state: int = d["state"]
	# The plug's axis: far enough down that the rim's circle meets the bore's edges on the line.
	var axis_y := -sqrt(radius * radius - half * half)
	var centre := Vector2(o.x, o.y - axis_y * k)
	var gap := clampf(HATCH * k / 30.0, 4.5, HATCH)
	var seat_y := o.y - LockRig.SEAT_Y * k

	# ── Shell: brass everywhere until the plug's hole and the bore are cut ──
	c.draw_rect(win, Pal.SHELL_BODY)
	Pal.hatch_rect(c, win, gap, 45.0, Pal.RULE)
	c.draw_circle(centre, (radius + LockRig.SHEAR_GAP) * k + 0.5, Pal.PAPER)
	c.draw_rect(Rect2(o.x - half * k, seat_y, 2.0 * half * k, o.y - seat_y + 2.0), Pal.PAPER)
	for side: float in [-1.0, 1.0]:
		c.draw_line(Vector2(o.x + side * half * k, o.y - LockRig.SHEAR_GAP * k), Vector2(o.x + side * half * k, seat_y),
			Pal.INK, Pal.HAIRLINE)
	c.draw_line(Vector2(o.x - half * k, seat_y), Vector2(o.x + half * k, seat_y), Pal.INK, Pal.HAIRLINE)

	# ── The set window across the bore: teal to aim at, crimson past it ──
	if colored:
		c.draw_rect(Rect2(o.x - half * k, o.y - 0.6 * k, 2.0 * half * k, 0.6 * k), Color(Pal.TEAL, 0.28))
		c.draw_rect(Rect2(o.x - half * k, o.y - 1.8 * k, 2.0 * half * k, 1.2 * k), Color(Pal.CRIMSON, 0.12))

	# ── Where the driver has to be ──
	var outline: PackedVector2Array = d["driver"]
	var driver_y: float = d["driver_y"]
	var pose := pose_pin(outline, fat, driver_y, half, theta, axis_y, clampf(slide - play, 0.0, play))
	var at: float = pose.x
	var cant: float = pose.y

	# ── Spring, from the seat down to the driver's top ──
	var crown := _placed(Vector2(0.0, LockRig.DRIVER_HALF), driver_y, at, cant)
	var top := Vector2(o.x - crown.x * k, o.y - crown.y * k)
	var spring := PackedVector2Array([Vector2(top.x, seat_y)])
	var height := maxf(2.0, top.y - seat_y)
	var half_w := r * 0.72 * k
	for n in 5:
		spring.append(Vector2(top.x + (half_w if n % 2 == 0 else -half_w), seat_y + height * (n + 0.5) / 5.0))
		spring.append(Vector2(top.x, seat_y + height * (n + 1.0) / 5.0))
	c.draw_polyline(spring, Pal.INK_LIGHT, 1.0, true)

	# ── Plug: a circle turned by the plug's angle, its bore and the keyway slot cut out ──
	c.draw_circle(centre, radius * k, Pal.PLUG_BODY)
	_hatch_circle(c, centre, radius * k, gap)
	c.draw_set_transform(centre, -theta)
	var hole := PackedVector2Array()
	for q: Vector2 in [
		Vector2(-half, 0.02), Vector2(-half, LockRig.FLOOR_Y), Vector2(-LockRig.SLOT_HALF, LockRig.FLOOR_Y),
		Vector2(-LockRig.SLOT_HALF, LockRig.KEYWAY_FLOOR_Y), Vector2(LockRig.SLOT_HALF, LockRig.KEYWAY_FLOOR_Y),
		Vector2(LockRig.SLOT_HALF, LockRig.FLOOR_Y), Vector2(half, LockRig.FLOOR_Y), Vector2(half, 0.02),
	]:
		hole.append(Vector2(-q.x * k, -(q.y - axis_y) * k))
	c.draw_colored_polygon(hole, Pal.PAPER)
	c.draw_polyline(hole, Pal.INK, 1.0, true)
	# The rim, where there is rim: round to the bore's opening and stop.
	var opening := asin(clampf(half / radius, -1.0, 1.0))
	c.draw_arc(Vector2.ZERO, radius * k, -PI / 2.0 + opening, -PI / 2.0 - opening + TAU, 96, Pal.INK, Pal.STROKE, true)
	# The key pin sits in the plug's bore and turns with it — dragged back against the wall that
	# pushes, as the driver above it is.
	var key_y: float = d["key_y"]
	var key_at := -minf(maxf(slide, 0.0), play)
	var key_fill := Pal.STEEL.lerp(Pal.PAPER, 0.32)
	if colored and state == LockRig.OVERSET:
		key_fill = Pal.STEEL.lerp(Pal.CRIMSON, 0.55)
	var key_pts := PackedVector2Array()
	for q: Vector2 in (d["key"] as PackedVector2Array):
		key_pts.append(Vector2(-(key_at + q.x * fat) * k, -(key_y + q.y - axis_y) * k))
	Pal.poly(c, key_pts, key_fill)
	c.draw_set_transform(Vector2.ZERO, 0.0)

	# ── The driver, in the shell's frame, posed ──
	var drv_pts := PackedVector2Array()
	for q: Vector2 in outline:
		var w := _placed(Vector2(q.x * fat, q.y), driver_y, at, cant)
		drv_pts.append(Vector2(o.x - w.x * k, o.y - w.y * k))
	Pal.poly(c, drv_pts, Pal.state_color(state if colored else LockRig.FREE))

	# ── The shear line: an annotation, not an edge ──
	var x := win.position.x
	while x < win.end.x:
		c.draw_line(Vector2(x, o.y), Vector2(minf(x + 4.0, win.end.x), o.y), Pal.INK_LIGHT, Pal.HAIRLINE)
		x += 10.0

	# ── Where it is caught, and where it merely rests. Not during the drawn open turn ──
	if colored and extra == 0.0:
		var scale := clampf(k / 30.0, 0.7, 1.6)
		var edge := -half + slide
		if state == LockRig.SET:
			_dot(c, Vector2(o.x - maxf(edge - 0.05, at - r) * k, o.y), 5.5 * scale, Pal.TEAL)
		elif state == LockRig.BINDING or state == LockRig.FALSE_SET:
			var squeeze := (6.0 + minf(12.0, float(d.get("wrench", 0.0)) * 2.0)) * scale
			_dot(c, Vector2(o.x - edge * k, o.y + LockRig.RIM_HEIGHT / 2.0 * k), squeeze, Pal.CRIMSON)
			if state == LockRig.BINDING:
				_dot(c, Vector2(o.x - half * k, o.y - (LockRig.SHEAR_GAP + 0.15) * k), squeeze, Pal.CRIMSON)

	c.draw_rect(win, Pal.INK, false, Pal.HAIRLINE)
	return cant


## A point of a pin (about its centre) in the shell's frame, mm: lifted to its height, leant by
## `cant` about the point where its axis crosses the shear line, and moved across by `at`.
static func _placed(local: Vector2, height: float, at: float, cant: float) -> Vector2:
	var y := height + local.y
	return Vector2(at + local.x * cos(cant) - y * sin(cant), local.x * sin(cant) + y * cos(cant))


## Where a rigid pin sits: x = how far across, y = its cant. Above the line every point of it must
## be inside the shell's bore; below it, inside the plug's — which has turned by `theta`. The
## least cant that fits is the one drawn; `wanted` is where it would sit left to itself.
static func pose_pin(outline: PackedVector2Array, fat: float, height: float, half: float, theta: float, axis_y: float,
		wanted: float) -> Vector2:
	var best := Vector2(wanted, 0.0)
	var least := INF
	var cant := 0.0
	while cant <= MAX_CANT + 1e-6:
		var room := _room(outline, fat, height, half, theta, axis_y, cant)
		if room.x <= room.y + 1e-4:
			return Vector2(clampf(wanted, room.x, maxf(room.x, room.y)), cant)
		if room.x - room.y < least:
			least = room.x - room.y
			best = Vector2((room.x + room.y) / 2.0, cant)
		# A pin wholly above the line, or a plug that has not turned, never needs to lean.
		if is_zero_approx(theta):
			break
		cant += CANT_STEP
	return best


## The span of positions (x = least, y = most) a pin leant by `cant` may take.
static func _room(outline: PackedVector2Array, fat: float, height: float, half: float, theta: float, axis_y: float,
		cant: float) -> Vector2:
	var least := -INF
	var most := INF
	var n := outline.size()
	var previous := _placed(Vector2(outline[n - 1].x * fat, outline[n - 1].y), height, 0.0, cant)
	for i in n:
		var p := _placed(Vector2(outline[i].x * fat, outline[i].y), height, 0.0, cant)
		var points: Array[Vector2] = [p]
		# Where this edge crosses the top of the plug and the bottom of the shell: a corner of
		# either must not be inside the pin, and a corner is only tested where an edge meets it.
		for level: float in [0.0, LockRig.SHEAR_GAP]:
			if (previous.y - level) * (p.y - level) < 0.0:
				var t := (level - previous.y) / (p.y - previous.y)
				points.append(Vector2(lerpf(previous.x, p.x, t), level))
		for q in points:
			if q.y >= LockRig.SHEAR_GAP - 1e-6:
				least = maxf(least, -half - q.x)
				most = minf(most, half - q.x)
			if q.y <= 1e-6:
				# The plug's bore at this depth, carried round by the plug's turn.
				var carried := (q.y - axis_y) * sin(theta)
				least = maxf(least, carried - half - q.x)
				most = minf(most, carried + half - q.x)
		previous = p
	return Vector2(least, most)


static func _dot(c: CanvasItem, at: Vector2, radius: float, color: Color) -> void:
	c.draw_circle(at, radius, Color(color, 0.9))
	c.draw_arc(at, radius, 0.0, TAU, 24, Pal.INK, 1.0, true)


## Hatch a circle: each stroke is the chord of a 45° line through it.
static func _hatch_circle(c: CanvasItem, centre: Vector2, radius: float, gap: float) -> void:
	var dir := Vector2(1.0, 1.0).normalized()
	var normal := Vector2(1.0, -1.0).normalized()
	var at := -radius
	while at < radius:
		var chord := sqrt(radius * radius - at * at)
		var mid := centre + normal * at
		c.draw_line(mid - dir * chord, mid + dir * chord, Pal.RULE, 1.0)
		at += gap * 0.7071
