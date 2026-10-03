class_name DiscArt
extends RefCounted
## A disc-detainer lock, drawn the way it is made: from the front, as a slice through one disc,
## and from the side, as the pack with the body and the sleeve cut away.
##
## Both are drawn from a pose — where each disc is turned to, where the bar stands, how far the
## sleeve has turned — so the pick screen draws its live bodies with them (`from_rig`) and the
## help pages draw the same lock held still (`pose`). Nothing here runs a lock.
##
## The front is the mechanism: a round disc with its gate in the rim and the key's slot through
## its middle, the sleeve round it with the bar in its slot, the body round that with the groove
## the bar's back sits in. A disc turns anticlockwise, as the plug does on the bench, so a gate
## comes up the right-hand side to the bar at the top.
##
## The side is the same lock from the right: the discs stand in a row with their spacers between
## them, the bar lies along the top, and each gate shows on the face of its disc as a mark that
## climbs to the top as the disc is turned. A gate that has gone over the top is on the far side,
## and is drawn the way a drawing shows what it cannot see: dashed. The bar, when it drops, goes
## down behind the discs' near shoulders — it is seen between them.
##
## A pose is { discs: [disc…], foot, bar_x, shift, extra, wrench, colored, pick, pick_z, gate_half }.
## A disc is { rim, turned, notches: [{x, floor, true}], state }. Lengths are the rig's own
## millimetres: `turned`, `shift` and a notch's `x` along the rim, `rim`, `floor` and `foot` out
## from the highest rim.

const RIM_R := DiscRig.RIM_R
const BODY_R := 13.4
const BORE_R := RIM_R + DiscRig.BODY_IN
const SLEEVE_IN_R := RIM_R + DiscRig.SLEEVE_IN
const SLEEVE_OUT_R := RIM_R + DiscRig.SLEEVE_OUT
const SPACER_R := 7.0
const SPACER_T := 0.5
## The key's slot through a disc, and the pick's tip in it.
const SLOT_W := 5.6
const SLOT_H := 2.0
const TIP_W := 4.8
const TIP_H := 1.2
## The disc's tab, and the window of the sleeve it travels in.
const TAB_HALF := 0.7
const TAB_OUT := 0.9
## The keyway as the side view opens it, mm either side of the axis.
const KEYWAY_HALF := 1.5
const FACE_T := 1.4
const BACK_T := 1.0
const HATCH := 6.0
## How far a view runs past the lock, mm.
const PAD := 0.8


# ── Poses ───────────────────────────────────────────────────────────────────────────────

## A disc for a posed figure: its cut, the cuts it carries false gates at, and its place in the
## binding order (0 binds first).
static func disc(cut: int, lies: Array = [], order: int = 0, step: float = DiscRig.RIM_STEP) -> Dictionary:
	var rim := -step * order
	var notches: Array = [{"x": -cut * DiscRig.UNIT, "floor": DiscRig.GATE_FLOOR, "true": true}]
	for f: int in lies:
		notches.append({"x": -f * DiscRig.UNIT, "floor": maxf(rim - DiscRig.FALSE_DEPTH, DiscRig.FALSE_FLOOR), "true": false})
	return {"rim": rim, "turned": 0.0, "notches": notches, "state": LockRig.FREE, "cut": cut}


static func pose(discs: Array) -> Dictionary:
	return {"discs": discs, "foot": DiscRig.BAR_LIFT, "bar_x": 0.0, "shift": 0.0, "extra": 0.0, "wrench": 0.0,
		"colored": true, "pick": -1, "pick_z": NAN, "gate_half": DiscRig.BAR_W / 2.0 + DiscRig.GATE_CLEAR}


## The live lock as a pose. `extra` is the drawn open turn, rad; `pick_z` where the tip is.
static func from_rig(rig: DiscRig, colored: bool, pick: int, pick_z: float, extra: float = 0.0) -> Dictionary:
	var discs: Array = []
	for i in rig.count:
		discs.append({"rim": rig.rim(i), "turned": rig.turned(i), "notches": rig.info[i]["notches"],
			"state": rig.states[i]})
	return {"discs": discs, "foot": rig.bar_foot(), "bar_x": rig.bar.position.x / DiscRig.S, "shift": rig.shift(),
		"extra": extra, "wrench": rig.wrench, "colored": colored, "pick": pick, "pick_z": pick_z,
		"gate_half": rig.gate_half}


## How long a pack of `count` discs is, mm.
static func depth(count: int) -> float:
	return DiscRig.FIRST_Z * 2.0 + DiscRig.PITCH_Z * (count - 1)


static func disc_z(i: float) -> float:
	return DiscRig.FIRST_Z + DiscRig.PITCH_Z * i


## The sleeve's turn in the body as drawn, rad.
static func turn(p: Dictionary) -> float:
	return float(p["shift"]) / RIM_R + float(p.get("extra", 0.0))


# ── The front: a slice through disc `i` ─────────────────────────────────────────────────

## A point `r` mm from the axis, `a` rad anticlockwise from twelve o'clock.
static func _polar(centre: Vector2, k: float, r: float, a: float) -> Vector2:
	return centre + Vector2(-sin(a), -cos(a)) * (r * k)


## A point of a part drawn square to the bar: `u` mm along the rim the way the lock turns, `y` mm
## out from the highest rim, the part turned `a` rad with the sleeve.
static func _square(centre: Vector2, k: float, u: float, y: float, a: float) -> Vector2:
	var local := Vector2(-u, RIM_R + y)
	var turned := Vector2(local.x * cos(a) - local.y * sin(a), local.x * sin(a) + local.y * cos(a))
	return centre + Vector2(turned.x, -turned.y) * k


## A rectangle `w` by `h` mm about the axis, turned `a` rad anticlockwise.
static func _turned_rect(centre: Vector2, k: float, w: float, h: float, a: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for q: Vector2 in [Vector2(-1, -1), Vector2(1, -1), Vector2(1, 1), Vector2(-1, 1)]:
		var local := Vector2(q.x * w / 2.0, q.y * h / 2.0)
		var r := Vector2(local.x * cos(a) - local.y * sin(a), local.x * sin(a) + local.y * cos(a))
		pts.append(centre + Vector2(r.x, -r.y) * k)
	return pts


## Points round an arc from `a0` to `a1`; `between` leaves both ends out, for an arc that joins
## two points already in the outline.
static func _arc(into: PackedVector2Array, centre: Vector2, k: float, r: float, a0: float, a1: float,
		between: bool = false) -> void:
	var steps := maxi(2, ceili(absf(a1 - a0) / deg_to_rad(3.0)))
	for n in range(1 if between else 0, steps if between else steps + 1):
		into.append(_polar(centre, k, r, lerpf(a0, a1, n / float(steps))))


static func _ring_piece(c: CanvasItem, centre: Vector2, k: float, r0: float, r1: float, a0: float, a1: float,
		fill: Color) -> void:
	var pts := PackedVector2Array()
	_arc(pts, centre, k, r1, a0, a1)
	_arc(pts, centre, k, r0, a1, a0)
	Pal.poly(c, pts, fill)


## A disc's outline about `centre`, turned `a` rad: its rim, its notches cut square into it, its tab.
static func disc_outline(centre: Vector2, k: float, d: Dictionary, gate_half: float, a: float) -> PackedVector2Array:
	var radius := RIM_R + float(d["rim"])
	# What breaks the rim, as [where round it, half its width in rad, how far from the axis it
	# reaches, half its width in mm]: the notches, and the tab.
	var breaks: Array = []
	var mouth := gate_half + DiscRig.GATE_RAMP_RUN
	for notch: Dictionary in d["notches"]:
		breaks.append([fposmod(float(notch["x"]) / RIM_R, TAU), asin(clampf(mouth / radius, 0.0, 1.0)), RIM_R + float(notch["floor"]), gate_half])
	breaks.append([PI, asin(TAB_HALF / radius), radius + TAB_OUT, TAB_HALF])
	breaks.sort_custom(func(x: Array, y: Array) -> bool: return float(x[0]) < float(y[0]))
	var pts := PackedVector2Array()
	for n in breaks.size():
		var here: Array = breaks[n]
		var at: float = here[0]
		var half: float = here[1]
		var to: float = here[2]
		var half_mm: float = here[3]
		# Walls square to the notch's own middle, so a square bar sits in it — and a gate's mouth
		# eased, the slope a bar that is only a step down can be ridden back up.
		var gate := to < radius
		for side: float in [-1.0, 1.0]:
			var out := half_mm + (DiscRig.GATE_RAMP_RUN if gate else 0.0)
			var edge := Vector2(-side * out, sqrt(maxf(0.0, radius * radius - out * out)))
			var floor_pt := Vector2(-side * half_mm, to)
			var order: Array = [edge, floor_pt] if side < 0.0 else [floor_pt, edge]
			if gate and to < radius - DiscRig.GATE_RAMP - 0.01:
				var lip := Vector2(-side * half_mm, radius - DiscRig.GATE_RAMP)
				order = [edge, lip, floor_pt] if side < 0.0 else [floor_pt, lip, edge]
			for q: Vector2 in order:
				var turn_by := at + a
				var r := Vector2(q.x * cos(turn_by) - q.y * sin(turn_by), q.x * sin(turn_by) + q.y * cos(turn_by))
				pts.append(centre + Vector2(r.x, -r.y) * k)
		var next: Array = breaks[(n + 1) % breaks.size()]
		var until: float = float(next[0]) - float(next[1])
		if n == breaks.size() - 1:
			until += TAU
		_arc(pts, centre, k, radius, a + at + half, a + until, true)
	return pts


## Draw the slice through disc `i`, centred on `centre` at `k` px per mm.
static func front(c: CanvasItem, centre: Vector2, k: float, p: Dictionary, i: int) -> void:
	var discs: Array = p["discs"]
	var d: Dictionary = discs[clampi(i, 0, discs.size() - 1)]
	var colored: bool = p.get("colored", true)
	var state: int = d["state"]
	var gate_half: float = p["gate_half"]
	var sleeve_a := turn(p)
	var disc_a := sleeve_a + float(d["turned"]) / RIM_R
	var gap := clampf(HATCH * k / 24.0, 4.5, HATCH)

	# ── Body: brass, with its bore and the groove the bar's back sits in ──
	c.draw_circle(centre, BODY_R * k, Pal.SHELL_BODY)
	FrontArt._hatch_circle(c, centre, BODY_R * k, gap)
	c.draw_circle(centre, BORE_R * k, Pal.PAPER)
	var left := -DiscRig.BAR_W / 2.0 - DiscRig.GROOVE_CLEAR
	var roof := DiscRig.BAR_LIFT + DiscRig.BAR_H
	var ramp_top := DiscRig.BAR_W / 2.0 - DiscRig.RAMP_RUN + DiscRig.TAKE_UP
	var ramp_foot := DiscRig.BAR_W / 2.0 + DiscRig.TAKE_UP
	var mouth := DiscRig.BODY_IN - 0.12
	var groove := PackedVector2Array([
		_square(centre, k, left, mouth, 0.0), _square(centre, k, left, roof, 0.0),
		_square(centre, k, ramp_top, roof, 0.0), _square(centre, k, ramp_foot, mouth, 0.0),
	])
	c.draw_colored_polygon(groove, Pal.PAPER)
	var bore := PackedVector2Array()
	_arc(bore, centre, k, BORE_R, atan2(ramp_foot, BORE_R), TAU + atan2(left, BORE_R))
	c.draw_polyline(bore, Pal.INK, Pal.STROKE, true)
	c.draw_polyline(PackedVector2Array([bore[bore.size() - 1], groove[1], groove[2], bore[0]]), Pal.INK, Pal.STROKE, true)
	c.draw_arc(centre, BODY_R * k, 0.0, TAU, 96, Pal.INK, Pal.STROKE, true)

	# ── Sleeve: a ring in two pieces — the bar's slot at the top, the tab's window from six
	# o'clock round to three ──
	var slot := asin((DiscRig.BAR_W / 2.0 + DiscRig.SLOT_CLEAR + 0.04) / SLEEVE_IN_R)
	var window := (TAB_HALF + 0.2) / SLEEVE_IN_R
	_ring_piece(c, centre, k, SLEEVE_IN_R, SLEEVE_OUT_R, sleeve_a + slot, sleeve_a + PI - window, Pal.PLUG_BODY)
	_ring_piece(c, centre, k, SLEEVE_IN_R, SLEEVE_OUT_R, sleeve_a + 1.5 * PI + window, sleeve_a + TAU - slot, Pal.PLUG_BODY)
	# One tick for each cut of the key: where a gate can be, counted round from the bar.
	for cut in range(1, DiscRig.MAX_CUT + 1):
		var at := sleeve_a - cut * DiscRig.CUT_ANGLE
		c.draw_line(_polar(centre, k, SLEEVE_IN_R, at), _polar(centre, k, SLEEVE_IN_R + 0.55, at), Pal.INK_LIGHT, Pal.HAIRLINE)

	# ── The disc: its rim and gates, the key's slot through its middle ──
	var fill := Pal.state_color(state if colored else LockRig.FREE)
	Pal.poly(c, disc_outline(centre, k, d, gate_half, disc_a), fill)
	Pal.poly(c, _turned_rect(centre, k, SLOT_W, SLOT_H, disc_a), Pal.PAPER, Pal.INK, 1.0)
	if int(p.get("pick", -1)) == i:
		Pal.poly(c, _turned_rect(centre, k, TIP_W, TIP_H, disc_a), Pal.STEEL, Pal.INK, 1.0)

	# ── The bar, in the sleeve's slot ──
	var foot: float = p["foot"]
	var bar_x: float = p.get("bar_x", 0.0)
	var bar := PackedVector2Array()
	for q in DiscRig.bar_outline():
		bar.append(_square(centre, k, bar_x + q.x, foot + DiscRig.BAR_H / 2.0 + q.y, sleeve_a))
	Pal.poly(c, bar, Pal.STEEL)

	# ── Where the bar is resting, and where it has dropped in. Not during the drawn open turn ──
	if colored and float(p.get("extra", 0.0)) == 0.0:
		var scale := clampf(k / 22.0, 0.7, 1.6)
		var at_foot := _square(centre, k, bar_x, foot, sleeve_a)
		if state == LockRig.SET:
			_dot(c, at_foot, 5.5 * scale, Pal.TEAL)
		elif state == LockRig.BINDING or state == LockRig.FALSE_SET or state == LockRig.OVERSET:
			_dot(c, at_foot, (6.0 + minf(12.0, float(p.get("wrench", 0.0)) * 2.0)) * scale,
				Pal.VIOLET if state == LockRig.FALSE_SET else Pal.CRIMSON)


# ── The side: the pack, with the body and the sleeve cut away ───────────────────────────

## Draw the pack with the mouth of the keyway at `o.x` and the lock's axis at `o.y`, `k` px per mm.
static func side(c: CanvasItem, o: Vector2, k: float, p: Dictionary) -> void:
	var discs: Array = p["discs"]
	var n := discs.size()
	var colored: bool = p.get("colored", true)
	var gate_half: float = p["gate_half"]
	var long := depth(n)
	var foot: float = p["foot"]
	var x0 := o.x
	var x1 := o.x + long * k
	var gap := clampf(HATCH * k / 26.0, 4.5, HATCH)

	# ── The body: a wall above and below, a face with the keyway through it, a back ──
	var top_wall := Rect2(x0 - FACE_T * k, o.y - BODY_R * k, (long + FACE_T + BACK_T) * k, (BODY_R - BORE_R) * k)
	var bottom_wall := Rect2(top_wall.position.x, o.y + BORE_R * k, top_wall.size.x, top_wall.size.y)
	var face_up := Rect2(x0 - FACE_T * k, o.y - BORE_R * k, FACE_T * k, (BORE_R - KEYWAY_HALF) * k)
	var face_down := Rect2(x0 - FACE_T * k, o.y + KEYWAY_HALF * k, FACE_T * k, (BORE_R - KEYWAY_HALF) * k)
	var back := Rect2(x1, o.y - BORE_R * k, BACK_T * k, 2.0 * BORE_R * k)
	for wall: Rect2 in [top_wall, bottom_wall, face_up, face_down, back]:
		c.draw_rect(wall, Pal.SHELL_BODY)
		Pal.hatch_rect(c, wall, gap, 45.0, Pal.RULE)
	# The groove the bar's back sits in, along the top wall.
	var bar_z0 := disc_z(0.0) - DiscRig.DISC_T / 2.0 - 0.9
	var bar_z1 := disc_z(n - 1.0) + DiscRig.DISC_T / 2.0 + 0.9
	var roof := RIM_R + DiscRig.BAR_LIFT + DiscRig.BAR_H + 0.06
	var groove := Rect2(o.x + (bar_z0 - 0.12) * k, o.y - roof * k, (bar_z1 - bar_z0 + 0.24) * k, (roof - BORE_R) * k + 1.0)
	c.draw_rect(groove, Pal.PAPER)
	for edge: Array in [
		[groove.position, Vector2(groove.end.x, groove.position.y)],
		[groove.position, Vector2(groove.position.x, groove.end.y - 1.0)],
		[Vector2(groove.end.x, groove.position.y), Vector2(groove.end.x, groove.end.y - 1.0)],
	]:
		c.draw_line(edge[0], edge[1], Pal.INK, 1.0)
	var outer := Rect2(top_wall.position, Vector2(top_wall.size.x, 2.0 * BODY_R * k))
	c.draw_rect(outer, Pal.INK, false, Pal.STROKE)
	var bore_top := o.y - BORE_R * k
	var bore_bottom := o.y + BORE_R * k
	c.draw_line(Vector2(x0, bore_top), Vector2(groove.position.x, bore_top), Pal.INK, 1.0)
	c.draw_line(Vector2(groove.end.x, bore_top), Vector2(x1, bore_top), Pal.INK, 1.0)
	c.draw_line(Vector2(x0, bore_bottom), Vector2(x1, bore_bottom), Pal.INK, 1.0)
	c.draw_line(Vector2(x0, bore_top), Vector2(x0, o.y - KEYWAY_HALF * k), Pal.INK, 1.0)
	c.draw_line(Vector2(x0, o.y + KEYWAY_HALF * k), Vector2(x0, bore_bottom), Pal.INK, 1.0)
	c.draw_line(Vector2(x1, bore_top), Vector2(x1, bore_bottom), Pal.INK, 1.0)

	# ── The sleeve, where the cut leaves any of it: its wall along the bottom ──
	var sleeve_wall := Rect2(x0 + 0.5 * k, o.y + SLEEVE_IN_R * k, (long - 1.0) * k, (SLEEVE_OUT_R - SLEEVE_IN_R) * k)
	c.draw_rect(sleeve_wall, Pal.PLUG_BODY)
	Pal.hatch_rect(c, sleeve_wall, gap, -45.0, Pal.RULE)
	c.draw_rect(sleeve_wall, Pal.INK, false, 1.0)

	# ── Spacers: a thin washer between each disc and the next ──
	for s in n + 1:
		var z := disc_z(s - 0.5)
		var washer := Rect2(o.x + (z - SPACER_T / 2.0) * k, o.y - SPACER_R * k, SPACER_T * k, 2.0 * SPACER_R * k)
		c.draw_rect(washer, Pal.PAPER_SHADE)
		c.draw_rect(washer, Pal.INK_LIGHT, false, 1.0)

	# ── The bar, before the discs: where it has dropped it is behind their near shoulders ──
	var bar := Rect2(o.x + bar_z0 * k, o.y - (RIM_R + foot + DiscRig.BAR_H) * k, (bar_z1 - bar_z0) * k, DiscRig.BAR_H * k)
	c.draw_rect(bar, Pal.STEEL)
	c.draw_rect(bar, Pal.INK, false, Pal.STROKE)

	# ── The discs, each with its gates on its face ──
	for i in n:
		var d: Dictionary = discs[i]
		var radius := RIM_R + float(d["rim"])
		var state: int = d["state"]
		var left := o.x + (disc_z(i) - DiscRig.DISC_T / 2.0) * k
		var width := DiscRig.DISC_T * k
		var slab := Rect2(left, o.y - radius * k, width, 2.0 * radius * k)
		c.draw_rect(slab, Pal.state_color(state if colored else LockRig.FREE).lerp(Pal.PAPER, 0.18))
		var half_angle := gate_half / RIM_R
		for notch: Dictionary in d["notches"]:
			# How far round from the bar the gate still is: positive on the near side, coming up.
			var away := (-float(notch["x"]) - float(d["turned"])) / RIM_R
			var hi := radius * cos(clampf(absf(away) - half_angle, 0.0, PI))
			var lo := radius * cos(clampf(absf(away) + half_angle, 0.0, PI))
			var band := Rect2(left, o.y - hi * k, width, maxf(2.0, (hi - lo) * k))
			var ink := Pal.INK
			if colored:
				ink = Pal.TEAL if bool(notch["true"]) else Pal.VIOLET
			if away >= -half_angle:
				c.draw_rect(band, Color(ink, 0.85) if colored else Pal.INK)
			else:
				# Gone over the top: on the far side, and out of sight.
				_dashed_rect(c, band, Color(ink, 0.9))
		c.draw_rect(slab, Pal.INK, false, Pal.STROKE)

	# ── The keyway, opened along the axis, and the pick in it ──
	var keyway := Rect2(x0 - FACE_T * k - 2.0, o.y - KEYWAY_HALF * k, (long + FACE_T - 1.2) * k + 2.0, 2.0 * KEYWAY_HALF * k)
	c.draw_rect(keyway, Pal.PAPER)
	c.draw_line(Vector2(x0 - FACE_T * k, keyway.position.y), Vector2(keyway.end.x, keyway.position.y), Pal.INK, 1.0)
	c.draw_line(Vector2(x0 - FACE_T * k, keyway.end.y), Vector2(keyway.end.x, keyway.end.y), Pal.INK, 1.0)
	c.draw_line(Vector2(keyway.end.x, keyway.position.y), Vector2(keyway.end.x, keyway.end.y), Pal.INK, 1.0)
	var pick_z: float = p.get("pick_z", NAN)
	if is_nan(pick_z) and int(p.get("pick", -1)) >= 0:
		pick_z = disc_z(float(p["pick"]))
	if not is_nan(pick_z) and pick_z > -FACE_T:
		var shaft_left := x0 - FACE_T * k - 46.0
		var tip_x := o.x + pick_z * k
		Pal.box(c, Rect2(shaft_left, o.y - 0.42 * k, tip_x - shaft_left, 0.84 * k), Pal.STEEL)
		Pal.box(c, Rect2(tip_x - DiscRig.DISC_T * 0.42 * k, o.y - 1.05 * k, DiscRig.DISC_T * 0.84 * k, 2.1 * k), Pal.STEEL)

	# ── Where the bar is resting, and where it has dropped in ──
	if colored and float(p.get("extra", 0.0)) == 0.0:
		for i in n:
			var d: Dictionary = discs[i]
			var state: int = d["state"]
			var at := Vector2(o.x + disc_z(i) * k, o.y - (RIM_R + float(d["rim"])) * k)
			if state == LockRig.SET:
				_dot(c, at, 5.5, Pal.TEAL)
			elif state == LockRig.BINDING or state == LockRig.OVERSET:
				_dot(c, at, 6.0 + minf(12.0, float(p.get("wrench", 0.0)) * 2.0), Pal.CRIMSON)
			elif state == LockRig.FALSE_SET:
				_dot(c, at, 6.0, Pal.VIOLET)


static func _dashed_rect(c: CanvasItem, r: Rect2, ink: Color) -> void:
	for y: float in [r.position.y, r.end.y]:
		var x := r.position.x + 2.0
		while x < r.end.x - 2.0:
			c.draw_line(Vector2(x, y), Vector2(minf(x + 5.0, r.end.x - 2.0), y), ink, 1.0)
			x += 9.0


static func _dot(c: CanvasItem, at: Vector2, radius: float, color: Color) -> void:
	c.draw_circle(at, radius, Color(color, 0.9))
	c.draw_arc(at, radius, 0.0, TAU, 24, Pal.INK, 1.0, true)
