class_name HelpFigure
extends RefCounted
## The help pages' drawings: the lock as the pick screen draws it, posed by hand.
##
## Nothing here runs. A pose says where each pin stands and how far the plug has slid, and
## `side` and `front` draw it the way `PinLockView` and `FrontView` draw the live bodies: the
## same outlines (`Profiles.silhouette`, `LockRig.key_silhouette`, `PinSession.HOOK`), the same
## hatch, the same state colours and contact dots, the colours read from `Pal` as they are drawn.
## So a help figure is a frame of the game, held still — not a second diagram language.
##
## A pose is { pins: [chamber…], shift, wrench, colored, pick, pick_lift, push, gun, flick, turn }.
## A chamber is { profile, set_lift, relief, key, driver, state, gate, met }; `key` and `driver`
## are lifts above rest, mm. Lengths are the rig's own millimetres, y up, the shear line at 0.

const HATCH := 6.0
## How far a side view runs past the lock at each end, and above and below it, mm.
const SIDE_PAD := 0.7
const SIDE_TOP := LockRig.SEAT_Y + 0.8 + 0.5
const SIDE_BOTTOM := 1.7 - LockRig.KEYWAY_FLOOR_Y + 0.5


# ── Poses ───────────────────────────────────────────────────────────────────────────────

static func pin(profile: String, set_lift: float, relief: float) -> Dictionary:
	return {"profile": profile, "set_lift": set_lift, "relief": relief, "key": 0.0, "driver": 0.0,
		"state": LockRig.FREE, "gate": [], "met": false}


static func pose(pins: Array) -> Dictionary:
	return {"pins": pins, "shift": 0.0, "wrench": 0.0, "colored": true, "pick": -1.0,
		"pick_lift": -PinSession.PASS_CLEARANCE, "push": 0.0, "gun": false, "flick": 0.0, "turn": 0.0}


## A copy of `base` with `changes` laid over it, and `pins` ({index: {…}}) over its chambers.
static func alter(base: Dictionary, changes: Dictionary, pins: Dictionary = {}) -> Dictionary:
	var p := base.duplicate(true)
	p.merge(changes, true)
	for i: int in pins:
		(p["pins"][i] as Dictionary).merge(pins[i], true)
	return p


## A chamber being lifted, key pin and driver together.
static func lifted(lift: float, state: int) -> Dictionary:
	return {"key": lift, "driver": lift, "state": state}


## A set chamber: the driver's foot on the plug's top, the key pin wherever the pick has it.
static func set_at(chamber: Dictionary, key_lift: float = 0.0) -> Dictionary:
	return {"key": key_lift, "driver": float(chamber["set_lift"]), "state": LockRig.SET}


## Where a resting key pin's shoulder sits (as `LockRig._key_shoulder_y`).
static func shoulder() -> float:
	var hang := LockRig.KEY_TIP * (LockRig.SLOT_HALF - LockRig.KEY_TIP_HALF) / (LockRig.PIN_R - LockRig.KEY_TIP_HALF)
	return LockRig.FLOOR_Y - hang + LockRig.KEY_TIP


static func chamber_x(i: float) -> float:
	return LockRig.FIRST_X + LockRig.PITCH * i


static func depth(count: int) -> float:
	return LockRig.FIRST_X + LockRig.PITCH * (count - 1) + 3.5


static func key_len(chamber: Dictionary) -> float:
	return -shoulder() - float(chamber["set_lift"])


## The key pin's centre, mm.
static func key_y(chamber: Dictionary) -> float:
	return shoulder() + key_len(chamber) / 2.0 + float(chamber["key"])


## The driver's centre, mm.
static func driver_y(chamber: Dictionary) -> float:
	return -float(chamber["set_lift"]) + LockRig.DRIVER_HALF + float(chamber["driver"])


## How far the plug slides before its rim reaches this chamber's driver, mm.
static func bind_at(chamber: Dictionary) -> float:
	return LockRig.PLUG_CLEAR + LockRig.SHELL_CLEAR + float(chamber["relief"])


## The plug's turn, degrees, as the front view's caption reads it.
static func turn_degrees(p: Dictionary) -> float:
	return rad_to_deg(float(p["shift"]) / PinSession.PLUG_RADIUS + float(p.get("turn", 0.0)))


## The bottom of a resting key pin's cone: where the pick's tip meets it.
static func tip_rest() -> float:
	return shoulder() - LockRig.KEY_TIP


static func mirror(sil: Array[Vector2]) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for q in sil:
		pts.append(Vector2(q.y, q.x))
	for j in range(sil.size() - 1, -1, -1):
		pts.append(Vector2(-sil[j].y, sil[j].x))
	return pts


static func driver_outline(profile: String) -> PackedVector2Array:
	return mirror(Profiles.silhouette(profile, LockRig.PIN_R, LockRig.PIN_BEVEL))


static func key_fill(state: int, colored: bool) -> Color:
	if colored and state == LockRig.OVERSET:
		return Pal.STEEL.lerp(Pal.CRIMSON, 0.55)
	return Pal.STEEL.lerp(Pal.PAPER, 0.32)


# ── The side cutaway ────────────────────────────────────────────────────────────────────

## The section along the keyway. `o` is where the keyway's mouth meets the shear line, `k` the
## px per mm.
static func side(c: CanvasItem, o: Vector2, k: float, p: Dictionary) -> void:
	var pins: Array = p["pins"]
	var n := pins.size()
	var colored: bool = p.get("colored", true)
	var wrench: float = p.get("wrench", 0.0)
	var f := clampf(k / 30.0, 0.65, 1.2)
	var x0 := o.x
	var x1 := o.x + depth(n) * k
	var shell_bottom := o.y - LockRig.SHEAR_GAP * k
	var shell_top := o.y - (LockRig.SEAT_Y + 0.8) * k
	var seat_y := o.y - LockRig.SEAT_Y * k
	var plug_bottom := o.y - (LockRig.KEYWAY_FLOOR_Y - 1.7) * k
	var roof_y := o.y - LockRig.KEYWAY_CEIL_Y * k
	var floor_y := o.y - LockRig.KEYWAY_FLOOR_Y * k
	var bore_w := 2.0 * (LockRig.PIN_R + LockRig.PLUG_CLEAR) * k
	var back_x := o.x + (depth(n) - 2.0) * k
	var gap := clampf(HATCH * k / 30.0, 4.5, HATCH)

	var shell := Rect2(x0, shell_top, x1 - x0, shell_bottom - shell_top)
	c.draw_rect(shell, Pal.SHELL_BODY)
	Pal.hatch_rect(c, shell, gap, 45.0, Pal.RULE)
	var plug := Rect2(x0, o.y, x1 - x0, plug_bottom - o.y)
	c.draw_rect(plug, Pal.PLUG_BODY)
	Pal.hatch_rect(c, plug, gap, -45.0, Pal.RULE)
	var keyway := Rect2(x0 - 2.0, roof_y, back_x - x0 + 2.0, floor_y - roof_y)
	c.draw_rect(keyway, Pal.PAPER)
	for i in n:
		var bx := o.x + chamber_x(i) * k - bore_w / 2.0
		c.draw_rect(Rect2(bx, seat_y, bore_w, shell_bottom - seat_y), Pal.PAPER)
		c.draw_rect(Rect2(bx, o.y, bore_w, roof_y - o.y), Pal.PAPER)
	c.draw_rect(shell, Pal.INK, false, Pal.STROKE)
	c.draw_rect(plug, Pal.INK, false, Pal.STROKE)
	c.draw_rect(keyway, Pal.INK, false, Pal.STROKE)
	for i in n:
		var bx := o.x + chamber_x(i) * k - bore_w / 2.0
		c.draw_rect(Rect2(bx, seat_y, bore_w, shell_bottom - seat_y), Pal.INK, false, Pal.STROKE)
		c.draw_rect(Rect2(bx, o.y, bore_w, roof_y - o.y), Pal.INK, false, Pal.STROKE)

	# The set window: teal to aim at, crimson past it.
	if colored:
		for i in n:
			var bx := o.x + chamber_x(i) * k - bore_w / 2.0
			c.draw_rect(Rect2(bx, o.y - 0.6 * k, bore_w, 0.6 * k), Color(Pal.TEAL, 0.28))
			c.draw_rect(Rect2(bx, o.y - 1.8 * k, bore_w, 1.2 * k), Color(Pal.CRIMSON, 0.12))

	for i in n:
		var ch: Dictionary = pins[i]
		var cx := o.x + chamber_x(i) * k
		var bottom := o.y - (driver_y(ch) + LockRig.DRIVER_HALF) * k
		_spring(c, Vector2(cx, seat_y), maxf(2.0, bottom - seat_y), LockRig.PIN_R * 0.72 * k)

	for i in n:
		var ch: Dictionary = pins[i]
		var st: int = ch["state"]
		var at := Vector2(o.x + chamber_x(i) * k, o.y)
		Pal.poly(c, _placed(driver_outline(str(ch["profile"])), at, driver_y(ch), k),
			Pal.state_color(st if colored else LockRig.FREE))
		Pal.poly(c, _placed(mirror(LockRig.key_silhouette(key_len(ch))), at, key_y(ch), k), key_fill(st, colored))

	# Sidebar gates: a cut in the bore, where a set chamber's key pin must be lifted back up to.
	for i in n:
		var ch: Dictionary = pins[i]
		var g: Array = ch["gate"]
		if g.is_empty():
			continue
		var bx := o.x + chamber_x(i) * k - bore_w / 2.0
		var top := o.y - float(g[1]) * k
		var bottom := o.y - float(g[0]) * k
		var met: bool = ch["met"]
		if colored:
			c.draw_rect(Rect2(bx, top, bore_w, bottom - top), Color(Pal.TEAL if met else Pal.VIOLET, 0.45 if met else 0.4))
		var ink := (Pal.TEAL if met else Pal.VIOLET) if colored else Pal.INK
		for y: float in [top, bottom]:
			c.draw_line(Vector2(bx - 10.0 * f, y), Vector2(bx, y), ink, Pal.STROKE)
			c.draw_line(Vector2(bx + bore_w, y), Vector2(bx + bore_w + 10.0 * f, y), ink, Pal.STROKE)

	# The shear line: the strongest line in the drawing.
	c.draw_line(Vector2(x0 - SIDE_PAD * k, o.y), Vector2(x1 + SIDE_PAD * k, o.y), Pal.INK, Pal.HEAVY)

	if colored:
		for i in n:
			var ch: Dictionary = pins[i]
			var st: int = ch["state"]
			var cx := o.x + chamber_x(i) * k
			if st == LockRig.SET:
				var foot := driver_y(ch) - LockRig.DRIVER_HALF
				dot(c, Vector2(cx, o.y - foot * k), 5.5 * f, Pal.TEAL)
			elif st == LockRig.BINDING or st == LockRig.FALSE_SET:
				dot(c, Vector2(cx, o.y + LockRig.RIM_HEIGHT / 2.0 * k), (6.0 + minf(12.0, wrench * 2.0)) * f, Pal.CRIMSON)

	if bool(p.get("gun", false)):
		_needle(c, o, k, p)
	else:
		_pick(c, o, k, p)


static func _placed(outline: PackedVector2Array, at: Vector2, y: float, k: float) -> PackedVector2Array:
	var out := PackedVector2Array()
	for q in outline:
		out.append(Vector2(at.x + q.x * k, at.y - (y + q.y) * k))
	return out


static func _spring(c: CanvasItem, seat: Vector2, height: float, half_w: float) -> void:
	const COILS := 5
	var pts := PackedVector2Array([seat])
	for j in COILS:
		pts.append(Vector2(seat.x + (half_w if j % 2 == 0 else -half_w), seat.y + height * (j + 0.5) / COILS))
		pts.append(Vector2(seat.x, seat.y + height * (j + 1.0) / COILS))
	c.draw_polyline(pts, Pal.INK_LIGHT, 1.0, true)


static func dot(c: CanvasItem, at: Vector2, radius: float, color: Color) -> void:
	c.draw_circle(at, radius, Color(color, 0.9))
	c.draw_arc(at, radius, 0.0, TAU, 24, Pal.INK, 1.0, true)


## The hook, its tip under chamber `pick` (a position along the keyway, in chambers).
static func _pick(c: CanvasItem, o: Vector2, k: float, p: Dictionary) -> void:
	var at: float = p.get("pick", -1.0)
	if at < 0.0:
		return
	var tip := Vector2(chamber_x(at), tip_rest() + float(p.get("pick_lift", -PinSession.PASS_CLEARANCE)))
	var tip_local := PinSession.HOOK[PinSession.HOOK_TIP]
	var from := tip - tip_local
	var pts := PackedVector2Array()
	for q in PinSession.HOOK:
		# The blade is 60 mm long: it leaves the drawing by the mouth.
		pts.append(Vector2(o.x + maxf(from.x + q.x, -3.0) * k, o.y - (from.y + q.y) * k))
	Pal.poly(c, pts, Pal.STEEL)
	var push: float = p.get("push", 0.0)
	if push > 0.02:
		c.draw_circle(Vector2(o.x + tip.x * k, o.y - tip.y * k), (3.0 + minf(8.0, push * 2.0)) * clampf(k / 30.0, 0.65, 1.2),
			Color(Pal.AMBER, 0.75))


## The snap gun's blade: a flat plank under every pin it reaches, kicked down on a strike.
static func _needle(c: CanvasItem, o: Vector2, k: float, p: Dictionary) -> void:
	var count: int = (p["pins"] as Array).size()
	var top_mm := tip_rest() - 0.25 - float(p.get("flick", 0.0)) * 0.7
	var reach := clampf(chamber_x(float(p.get("pick", count - 1.0))) + PinSession.NEEDLE_REACH,
		LockRig.FIRST_X - 2.0, chamber_x(count - 1) + 3.5)
	var left := o.x - 3.0 * k
	Pal.box(c, Rect2(left, o.y - top_mm * k, o.x + reach * k - left, 0.6 * k), Pal.STEEL)


# ── The front view ──────────────────────────────────────────────────────────────────────

## Chamber `i` seen from the lock's face. `win` is the window (the caller clips to it), `o` where
## the bore's axis meets the shear line, `k` the px per mm. Mirrored as the game's is, so the
## plug turns anticlockwise.
static func front(c: CanvasItem, win: Rect2, o: Vector2, k: float, p: Dictionary, i: int) -> void:
	var ch: Dictionary = p["pins"][i]
	FrontArt.paint(c, win, o, k, {
		"profile": ch["profile"],
		"bind_at": bind_at(ch),
		"slide": p["shift"],
		"extra": p.get("turn", 0.0),
		"driver": driver_outline(str(ch["profile"])),
		"driver_y": driver_y(ch),
		"key": mirror(LockRig.key_silhouette(key_len(ch))),
		"key_y": key_y(ch),
		"state": ch["state"],
		"colored": p.get("colored", true),
		"wrench": p.get("wrench", 0.0),
	})


## Hatch a circle: each stroke is the chord of a 45° line through it.
static func _hatch_circle(c: CanvasItem, centre: Vector2, radius: float, gap: float) -> void:
	var dir := Vector2(1.0, 1.0).normalized()
	var normal := Vector2(1.0, -1.0).normalized()
	var d := -radius
	while d < radius:
		var half := sqrt(radius * radius - d * d)
		var mid := centre + normal * d
		c.draw_line(mid - dir * half, mid + dir * half, Pal.RULE, 1.0)
		d += gap * 0.7071


## One driver on its own, upright, its centre at `at`.
static func driver(c: CanvasItem, at: Vector2, k: float, profile: String, fill: Color) -> void:
	Pal.poly(c, _placed(driver_outline(profile), at, 0.0, k), fill)


# ── The readouts ────────────────────────────────────────────────────────────────────────

## A horizontal meter in segments, as the footer's are.
static func meter(c: CanvasItem, at: Vector2, w: float, value: float, color: Color, segments: int = 10,
		h: float = 16.0) -> void:
	const GAP := 4.0
	var seg_w := (w - GAP * (segments - 1)) / segments
	var filled := roundi(clampf(value, 0.0, 1.0) * segments)
	for j in segments:
		var r := Rect2(at.x + j * (seg_w + GAP), at.y, seg_w, h)
		c.draw_rect(r, color if j < filled else Color(Pal.RULE, 0.55))
		c.draw_rect(r, Pal.INK_LIGHT, false, Pal.HAIRLINE)


## A standing column filling from the bottom, as force and resistance are.
static func column(c: CanvasItem, x: float, bottom: float, h: float, value: float, color: Color, w: float = 46.0) -> void:
	const GAP := 4.0
	const SEGMENTS := 10
	var seg_h := (h - GAP * (SEGMENTS - 1)) / SEGMENTS
	var filled := roundi(clampf(value, 0.0, 1.0) * SEGMENTS)
	for j in SEGMENTS:
		var r := Rect2(x, bottom - seg_h - j * (seg_h + GAP), w, seg_h)
		if j < filled:
			c.draw_rect(r, color)
			var yy := r.position.y + 4.0
			while yy < r.end.y:
				c.draw_line(Vector2(r.position.x, yy), Vector2(r.end.x, yy), Color(Pal.INK, 0.4), 1.0)
				yy += 4.0
		else:
			c.draw_rect(r, Color(Pal.RULE, 0.55))
		c.draw_rect(r, Pal.INK_LIGHT, false, Pal.HAIRLINE)


static func keycap_width(label: String, size: int) -> float:
	return maxf(size + 14.0, Pal.text_width(label.to_upper(), size, true, size * 0.08) + 20.0)


## A key you press, drawn as one: a boxed cap. Returns its width.
static func keycap(c: CanvasItem, at: Vector2, label: String, size: int, lit: bool = false) -> float:
	var w := keycap_width(label, size)
	var h := size + 10.0
	Pal.box(c, Rect2(at.x, at.y, w, h), Pal.INK if lit else Pal.PAPER)
	Pal.text(c, Vector2(at.x + w / 2.0, at.y + h / 2.0 + size * 0.36), label.to_upper(), size,
		Pal.PAPER if lit else Pal.INK, HORIZONTAL_ALIGNMENT_CENTER, true, size * 0.08)
	return w


## A straight arrow with a filled head.
static func arrow(c: CanvasItem, from: Vector2, to: Vector2, color: Color, width: float = 3.0, head: float = 12.0) -> void:
	var dir := (to - from).normalized()
	var across := Vector2(-dir.y, dir.x)
	c.draw_line(from, to - dir * head * 0.8, color, width, true)
	c.draw_colored_polygon(PackedVector2Array([to, to - dir * head + across * head * 0.5,
		to - dir * head - across * head * 0.5]), color)


## An arrow along an arc about `centre`, from angle `a0` to `a1`.
static func arc_arrow(c: CanvasItem, centre: Vector2, radius: float, a0: float, a1: float, color: Color,
		width: float = 3.0, head: float = 12.0) -> void:
	var pts := PackedVector2Array()
	arc_points(pts, centre, radius, a0, a1, 24)
	var tip := pts[pts.size() - 1]
	var along := Vector2.from_angle(a1).orthogonal() * (-1.0 if a1 > a0 else 1.0)
	pts[pts.size() - 1] = tip - along * head * 0.7
	c.draw_polyline(pts, color, width, true)
	var across := Vector2.from_angle(a1)
	c.draw_colored_polygon(PackedVector2Array([tip, tip - along * head + across * head * 0.5,
		tip - along * head - across * head * 0.5]), color)


static func arc_points(into: PackedVector2Array, centre: Vector2, radius: float, a0: float, a1: float, steps: int) -> void:
	for j in steps + 1:
		into.append(centre + Vector2.from_angle(lerpf(a0, a1, float(j) / float(steps))) * radius)


static func round_rect(c: CanvasItem, rect: Rect2, radius: float, fill: Color, outline: Color, width: float) -> void:
	var r := minf(radius, minf(rect.size.x, rect.size.y) / 2.0)
	var pts := PackedVector2Array()
	arc_points(pts, Vector2(rect.end.x - r, rect.position.y + r), r, -PI / 2.0, 0.0, 6)
	arc_points(pts, Vector2(rect.end.x - r, rect.end.y - r), r, 0.0, PI / 2.0, 6)
	arc_points(pts, Vector2(rect.position.x + r, rect.end.y - r), r, PI / 2.0, PI, 6)
	arc_points(pts, Vector2(rect.position.x + r, rect.position.y + r), r, PI, PI * 1.5, 6)
	c.draw_colored_polygon(pts, fill)
	if width > 0.0:
		pts.append(pts[0])
		c.draw_polyline(pts, outline, width, true)


# ── The combination pack ────────────────────────────────────────────────────────────────

## The wheel pack looked at down the axle, as the pick screen's side view draws it: the first
## wheel whole in front, every wheel behind it a ring. `wheels`, front first, are
## { gate, lies, state }: the angle of the true gate and of each false one, measured round from
## under the fence, rad. `o`: pull, open, picked, top_digit.
static func pack(c: CanvasItem, centre: Vector2, radius: float, band: float, wheels: Array, o: Dictionary) -> void:
	var n := wheels.size()
	var s := radius / 105.0
	var ghost := Color(Pal.INK, 0.75)
	var outer := radius + band * (n - 1)
	var picked: int = o.get("picked", 0)
	var opened: bool = o.get("open", false)
	var pulling: bool = opened or bool(o.get("pull", false))
	var front_wheel: Dictionary = wheels[0]
	var front_state: int = front_wheel["state"]
	var seated := 0

	for i in range(n - 1, -1, -1):
		var w: Dictionary = wheels[i]
		var rim := radius + band * i
		if int(w["state"]) == LockRig.SET:
			seated += 1
		c.draw_circle(centre, rim, Pal.PAPER)
		if i > 0:
			c.draw_circle(centre, rim, Color(Pal.INK, 0.03 * i))
		for j in 36:
			var spoke := Vector2.from_angle(j / 36.0 * TAU)
			c.draw_line(centre + spoke * (rim - 6.0 * s), centre + spoke * (rim + 1.0), Color(Pal.INK, 0.35), Pal.HAIRLINE)
		c.draw_arc(centre, rim, 0.0, TAU, 96, Color(Pal.state_color(int(w["state"])), 0.9),
			Pal.HEAVY if i == picked else Pal.STROKE, true)
		_cut(c, centre, float(w["gate"]) - PI / 2.0, rim, 34.0 * s if i == 0 else band + 4.0, true)
		for lie: float in w["lies"]:
			_cut(c, centre, lie - PI / 2.0, rim, (12.0 if i == 0 else 8.0) * s, false)

	# The digits stamped round the front face; the one under the fence is the one in the window.
	var top_digit: int = o.get("top_digit", 0)
	var size := maxi(12, roundi(Pal.T_DIM * s))
	for d in 10:
		var a := (d - top_digit) / 10.0 * TAU - PI / 2.0
		var at := centre + Vector2.from_angle(a) * (radius - 40.0 * s)
		Pal.text(c, at + Vector2(0.0, size * 0.36), str(d), size, Pal.INK if d == top_digit else Color(Pal.INK_LIGHT, 0.6),
			HORIZONTAL_ALIGNMENT_CENTER, d == top_digit)

	# The hub: the shackle's leg, end-on.
	c.draw_circle(centre, 22.0 * s, Pal.PAPER_SHADE)
	c.draw_arc(centre, 22.0 * s, 0.0, TAU, 48, ghost, Pal.STROKE, true)

	# Every cut in one radial row: the open channel.
	if seated == n or opened:
		var a := float(front_wheel["gate"]) - PI / 2.0
		for pass_: Array in [[10.0 * s, Color(Pal.TEAL_TEXT, 0.22)], [Pal.HEAVY, Pal.TEAL_TEXT]]:
			for edge: float in [-0.17, 0.17]:
				var dir := Vector2.from_angle(a + edge)
				c.draw_line(centre + dir * (outer + 3.0), centre + dir * (radius - 34.0 * s), pass_[1], pass_[0], true)

	# The fence, in section: the bar and its tooth riding the front wheel's rim.
	var bar := Rect2(centre.x - 64.0 * s, centre.y - outer - 46.0 * s, 128.0 * s, 14.0 * s)
	var drop := 0.0
	if opened:
		drop = 40.0
	elif front_state == LockRig.SET:
		drop = 26.0
	elif front_state == LockRig.FALSE_SET:
		drop = 9.0
	var tip_y := centre.y - radius + drop * s if pulling else centre.y - radius - 6.0 * s
	Pal.box(c, bar, Pal.PAPER, ghost, Pal.STROKE)
	var tooth := Rect2(centre.x - 13.0 * s, bar.end.y, 26.0 * s, tip_y - bar.end.y)
	c.draw_rect(tooth, Pal.PAPER)
	Pal.box(c, tooth, Color(Pal.state_color(front_state), 0.55), ghost, Pal.STROKE)
	if not opened and front_state == LockRig.BINDING and pulling:
		c.draw_line(Vector2(centre.x - 16.0 * s, tip_y), Vector2(centre.x + 16.0 * s, tip_y), Pal.AMBER_TEXT, Pal.HEAVY)


## A gate cut into a wheel's visible edge: deep and teal for the true one, shallow and violet
## for a lie.
static func _cut(c: CanvasItem, centre: Vector2, a: float, rim: float, depth_px: float, deep: bool) -> void:
	var w := 0.17 if deep else 0.11
	var edge := Pal.TEAL_TEXT if deep else Color(Pal.VIOLET, 0.85)
	var mouth := PackedVector2Array()
	arc_points(mouth, centre, rim + 3.0, a - w, a + w, 8)
	arc_points(mouth, centre, rim - depth_px, a + w, a - w, 8)
	c.draw_colored_polygon(mouth, Pal.PAPER_SHADE)
	var walls := PackedVector2Array([centre + Vector2.from_angle(a - w) * (rim + 3.0)])
	arc_points(walls, centre, rim - depth_px, a - w, a + w, 8)
	walls.append(centre + Vector2.from_angle(a + w) * (rim + 3.0))
	c.draw_polyline(walls, edge, Pal.STROKE, true)


## The padlock as you hold it: the body, a digit wheel per window, the shackle out of its right
## face. `body` is the body's box; `digits` and `states` run nearest wheel first; `slide` is how
## far the shackle has come out, px.
static func padlock(c: CanvasItem, body: Rect2, digits: Array, states: Array, picked: int, slide: float,
		pulled: bool) -> void:
	var s := body.size.y / 470.0
	var thick := 54.0 * s
	var right := body.end.x
	var top_y0 := body.position.y + 62.0 * s
	var top_y1 := top_y0 + thick
	var toe_y1 := body.end.y - 62.0 * s
	var toe_y0 := toe_y1 - thick
	var mid_y := (top_y0 + toe_y1) / 2.0
	var arc_x := right - 6.0 * s + slide
	var r_out := mid_y - top_y0
	var r_in := mid_y - top_y1
	var hook := PackedVector2Array([Vector2(right - 88.0 * s + slide, top_y0)])
	arc_points(hook, Vector2(arc_x, mid_y), r_out, -PI / 2.0, PI / 2.0, 48)
	hook.append(Vector2(right - 20.0 * s + slide, toe_y1))
	hook.append(Vector2(right - 20.0 * s + slide, toe_y0))
	arc_points(hook, Vector2(arc_x, mid_y), r_in, PI / 2.0, -PI / 2.0, 40)
	hook.append(Vector2(right - 88.0 * s + slide, top_y1))
	Pal.poly(c, hook, Pal.PAPER, Pal.INK, Pal.STROKE)
	# Nothing pulling: two chevrons point the way out of the arch.
	if not pulled:
		for j in 2:
			var x := arc_x + r_out + (16.0 + j * 22.0) * s
			c.draw_polyline(PackedVector2Array([Vector2(x, mid_y - 14.0 * s), Vector2(x + 14.0 * s, mid_y),
				Vector2(x, mid_y + 14.0 * s)]), Pal.AMBER_TEXT, Pal.HEAVY, true)
	round_rect(c, body, 26.0 * s, Pal.PAPER_SHADE, Pal.INK, Pal.STROKE)
	c.draw_line(Vector2(right - 1.0, toe_y0 - 8.0 * s), Vector2(right - 1.0, toe_y1 + 8.0 * s), Pal.INK, Pal.STROKE)

	var count := digits.size()
	var wheel_w := 132.0 * s
	var wheel_h := 236.0 * s
	var wheel_gap := 36.0 * s
	var row_w := count * wheel_w + (count - 1) * wheel_gap
	var left := body.position.x + (body.size.x - row_w) / 2.0
	var row_y := body.position.y + (618.0 - 402.0) * s
	var pitch := wheel_h / 3.0
	var big := maxi(12, roundi(Pal.T_HEADING * s * 1.5))
	var small := maxi(10, roundi(Pal.T_BODY * s * 1.4))
	for j in count:
		var r := Rect2(left + j * (wheel_w + wheel_gap), row_y - wheel_h / 2.0, wheel_w, wheel_h)
		round_rect(c, r.grow_individual(8.0 * s, 10.0 * s, 8.0 * s, 10.0 * s), 14.0 * s, Color(Pal.INK, 0.08), Color.TRANSPARENT, 0.0)
		round_rect(c, r, 12.0 * s, Pal.PAPER, Color(Pal.state_color(int(states[j])), 0.9), Pal.HEAVY if j == picked else Pal.STROKE)
		var d: int = digits[j]
		var cx := r.get_center().x
		Pal.text(c, Vector2(cx, row_y + big * 0.36), str(d), big, Pal.INK, HORIZONTAL_ALIGNMENT_CENTER, true)
		for step: int in [-1, 1]:
			Pal.text(c, Vector2(cx, row_y + step * pitch + small * 0.36), str(posmod(d + step, 10)), small,
				Color(Pal.INK_LIGHT, 0.55), HORIZONTAL_ALIGNMENT_CENTER)
		var line := Pal.INK if j == picked else Pal.RULE
		for y: float in [row_y - pitch / 2.0, row_y + pitch / 2.0]:
			c.draw_line(Vector2(r.position.x - 12.0 * s, y), Vector2(r.end.x + 12.0 * s, y), line, Pal.STROKE)
