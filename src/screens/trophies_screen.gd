extends GameScreen
## The trophy case.
##
## An earned plate is drawn in full ink with its drawing in colour. An unearned one keeps its
## name and says what to do to earn it, its drawing drained to grey — so the case reads as a
## list of things to go and do rather than a wall of question marks. A trophy that cannot be
## earned against the roster as it stands says so, instead of sitting dark with no reason given.

const COLS := 3
const MAX_ROWS := 5
const GAP_X := 20.0
const GAP_Y := 18.0
const X := MARGIN + 56.0
const PAGER_H := 40.0
const ART_MAX := 130.0
## What a plate says in place of its condition when nothing on the roster can meet it.
const LOCKED_LINE := "Needs a lock that is not in the game yet"

## An unearned trophy's drawing: the same picture by luminance, at reduced strength — waiting
## to be coloured in.
const GREY := """shader_type canvas_item;
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	COLOR = vec4(vec3(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))), c.a * 0.55);
}"""

## Held by the screen, not the script: a static var in a script loaded by path keeps the
## script — and everything it names — alive past exit.
var _grey: ShaderMaterial
## What is on the page: {rect, entry, got, locked, art (Rect2, or null with no drawing)}.
var _plates: Array[Dictionary] = []


func build() -> void:
	title = "Trophies"
	var progress: Progress = app.progress
	var all := Achievements.all()
	var earned := 0
	for a in all:
		if progress.has_achievement(str(a["id"])):
			earned += 1
	status = "%d of %d earned  ·  %d currently earnable" % [earned, all.size(),
		all.size() - Achievements.unreachable().size()]
	accessibility_description = status
	nav([["Menu", func() -> void: app.goto(&"menu")]])
	var focus := get_child(-1) as Control

	# The page turner sits under the nav bar, the plates start under the page turner, and the
	# last row stops clear of the report link in the corner.
	var pager_y := MARGIN + 24.0 + Kit.box_for("Menu", Pal.T_BODY, 150.0, 40.0).y + 16.0
	var top := pager_y + PAGER_H + 14.0
	var w := floorf((1920.0 - MARGIN - 28.0 - X - GAP_X * (COLS - 1)) / COLS)
	# A plate needs a name, up to two lines of condition, and air. The rows that fit share the
	# height there is, up to the point where a plate stops looking deliberate and starts
	# looking empty.
	var need := Pal.T_BODY + Pal.T_DIM * 2.4 + 30.0
	var room := feedback_rect().position.y - 16.0 - top
	var rows := clampi(int((room + GAP_Y) / (need + GAP_Y)), 1, MAX_ROWS)
	var h := minf(ceilf(need) + 56.0, maxf(need, floorf((room - GAP_Y * (rows - 1)) / rows)))
	var per_page := COLS * rows
	var pages := maxi(1, ceili(all.size() / float(per_page)))
	var page := clampi(int(app.memo.get("trophy_page", 0)), 0, pages - 1)

	if pages > 1:
		var pw := maxf(44.0, Kit.caption_width("›"))
		var right := 1920.0 - MARGIN - 28.0
		var back := Kit.button(self, Rect2(right - pw * 2.0 - 12.0, pager_y, pw, PAGER_H), "‹", _turn.bind(page - 1))
		var on := Kit.button(self, Rect2(right - pw, pager_y, pw, PAGER_H), "›", _turn.bind(page + 1))
		# An arrow is not a name: said aloud, each turner says where it goes.
		Kit.describe(back, "Previous page of trophies", "page %d of %d" % [page + 1, pages])
		Kit.describe(on, "Next page of trophies", "page %d of %d" % [page + 1, pages])
		back.disabled = page == 0
		on.disabled = page == pages - 1
		for turner: Button in [back, on]:
			if turner.disabled:
				turner.focus_mode = Control.FOCUS_NONE
		# Turning a page rebuilds it: the focus stays on the turner just pressed, or moves to the
		# other one at the end of the run.
		var turned := int(app.memo.get("trophy_turned", 0))
		if turned != 0:
			var pressed := back if turned < 0 else on
			focus = pressed if not pressed.disabled else (on if turned < 0 else back)
	app.memo.erase("trophy_turned")
	focus.grab_focus.call_deferred(true)

	_plates.clear()
	for n in mini(per_page, all.size() - page * per_page):
		var a := all[page * per_page + n]
		var id := str(a["id"])
		var rect := Rect2(X + (n % COLS) * (w + GAP_X), top + (n / COLS) * (h + GAP_Y), w, h)
		var got := progress.has_achievement(id)
		var art: Variant = null
		var path := Achievements.art_path(id)
		if ResourceLoader.exists(path):
			# The trophy's own drawing, on the right of its plate; the words stop short of it.
			var side := minf(h - 20.0, ART_MAX)
			var at := Rect2(rect.end.x - side - 12.0, rect.position.y + (h - side) / 2.0, side, side)
			var picture := TextureRect.new()
			picture.texture = load(path)
			picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			picture.stretch_mode = TextureRect.STRETCH_SCALE
			picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
			picture.position = at.position
			picture.size = at.size
			if not got:
				picture.material = _grey_material()
			add_child(picture)
			art = at
		var locked := not got and not Achievements.is_reachable(id)
		_plates.append({"rect": rect, "entry": a, "got": got, "locked": locked, "art": art})
		# A plate is painted, and earned is a filled square against a hollow one. Neither reaches
		# a screen reader, so each plate also stands in the tree as a thing with a name: what the
		# trophy is called, whether it is earned, and what earns it.
		var plate := Control.new()
		plate.position = rect.position
		plate.size = rect.size
		plate.mouse_filter = Control.MOUSE_FILTER_IGNORE
		Kit.describe(plate, "%s — %s" % [a["name"], "earned" if got else "not yet earned"],
			LOCKED_LINE if locked else str(a["condition"]))
		add_child(plate)


func _turn(to: int) -> void:
	app.memo["trophy_turned"] = to - int(app.memo.get("trophy_page", 0))
	app.memo["trophy_page"] = to
	rebuild()


func _grey_material() -> ShaderMaterial:
	if _grey == null:
		var shader := Shader.new()
		shader.code = GREY
		_grey = ShaderMaterial.new()
		_grey.shader = shader
	return _grey


func paint_under() -> void:
	for plate in _plates:
		var r: Rect2 = plate["rect"]
		var got: bool = plate["got"]
		if got:
			Pal.box(pen, r, Pal.PAPER_SHADE)
		else:
			Pal.box(pen, r, Pal.PAPER, Pal.RULE, Pal.HAIRLINE)
		# A filled square for earned, a hollow one for not — the pattern channel, so the case
		# still reads in greyscale and to a colourblind player.
		var mark := Rect2(r.position + Vector2(14.0, 16.0), Vector2(14.0, 14.0))
		if got:
			Pal.box(pen, mark, Pal.TEAL_TEXT)
		else:
			pen.draw_rect(mark, Pal.RULE, false, Pal.STROKE)


func paint() -> void:
	for plate in _plates:
		var r: Rect2 = plate["rect"]
		var a: Dictionary = plate["entry"]
		var got: bool = plate["got"]
		var right := r.end.x
		if plate["art"] != null:
			# A thin frame makes the drawing a card taped to the plate rather than a floating square.
			var art: Rect2 = plate["art"]
			pen.draw_rect(art, Pal.RULE, false, Pal.HAIRLINE)
			right = art.position.x
		var x := r.position.x + 40.0
		var room := right - 14.0 - x
		paragraph(Vector2(x, r.position.y + Pal.T_BODY + 10.0), str(a["name"]), Pal.T_BODY,
			Pal.INK if got else Pal.INK_LIGHT, room, Pal.T_BODY + 4.0, 1)
		# An unearned trophy says what to do, not that it is locked: the condition is the one
		# thing on the screen telling you how to earn it.
		var line := LOCKED_LINE if plate["locked"] else str(a["condition"])
		paragraph(Vector2(x, r.position.y + Pal.T_BODY + Pal.T_DIM + 20.0), line, Pal.T_DIM, Pal.INK_LIGHT, room,
			Pal.T_DIM + 4.0, 2)
