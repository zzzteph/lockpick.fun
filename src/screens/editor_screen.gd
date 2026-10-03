extends GameScreen
## The lock editor: the lock is the editor.
##
## The draft is drawn large, in the pick screen's own section, and every chamber of that drawing
## is a thing to press. Pressing one — or walking to it with the arrows — makes it the pin the
## panel beside the lock is about: its driver (every profile on show at once, as pictures), the
## length of its key pin, its spring, and a line saying what those add up to under a pick.
## What belongs to the whole lock sits in one labelled row above the drawing; what the lock has
## become, and everything that can be done with it, is the column on the right.
##
## Every edit clamps instead of validating (see `EditorModel`), so the verdict under "This lock"
## reads "ready to pick" unless something is truly wrong.
##
## Type is three sizes and no others: the small face is every label and line of help, the body
## face every value and every sentence about the lock, and the heading face the panel's title
## and the value in a stepper — the thing being set.
##
## A keyboard or a controller drives all of it. Tab runs the page in reading order; the arrows
## are wired by hand where the engine's nearest-control guess would surprise (`_wire`), and on
## the lock itself left and right move the selection as well as the focus (`_focus_moved`).

# ── The three columns: the drawing, the selected pin, the lock as a whole ────────────────
const RIGHT_W := 400.0
const RIGHT_X := 1920.0 - MARGIN - 28.0 - RIGHT_W
const PANEL_W := 460.0
const PANEL_X := RIGHT_X - 32.0 - PANEL_W
const PANEL_Y := 252.0
const PANEL_H := 676.0
const PAD := 16.0
const IX := PANEL_X + PAD
const IW := PANEL_W - PAD * 2.0
## Where the cutaway may go. Its foot stops short of the message strip along the bottom.
const AREA := Rect2(LEFT, 236.0, PANEL_X - 32.0 - LEFT, 764.0)

# ── The drawing ─────────────────────────────────────────────────────────────────────────
## Stage px per mm at most — the pick screen's own scale — and less for a lock too long for it.
const MAX_PX := 30.0
const HATCH := 6.0
## How far the shear line runs past the body, and the room under the body for the pin numbers.
const OVERHANG := 24.0
const NUMBERS_H := 56.0
## The room over the body for the selected pin's bracket.
const MARK_ROOM := 14.0

# ── The row for the whole lock ──────────────────────────────────────────────────────────
const LABEL_Y := 126.0
const TOP_Y := 136.0
const TOP_H := 48.0
const HELP_Y := 208.0
## A stepper button's side: comfortably over the 40 px a target must be.
const STEP := 48.0
const NAME_W := 360.0
const PINS_X := LEFT + NAME_W + 48.0
const PINS_VALUE_W := 64.0
const TOL_X := PINS_X + STEP * 2.0 + PINS_VALUE_W + 56.0
const TOL_VALUE_W := 140.0

# ── The selected pin's panel ────────────────────────────────────────────────────────────
const DRIVER_LABEL_Y := PANEL_Y + 72.0
const DRIVER_Y := PANEL_Y + 82.0
const DRIVER_COLS := 4
const DRIVER_H := 122.0
const DRIVER_GAP := 8.0
## Stage px per mm of the driver pictures: the whole 4.5 mm of a driver in under half a button.
const ART_PX := 13.0
const DEPTH_LABEL_Y := PANEL_Y + 368.0
const DEPTH_Y := PANEL_Y + 378.0
const DEPTH_VALUE_W := 150.0
const DEPTH_HELP_Y := PANEL_Y + 448.0
const SPRING_LABEL_Y := PANEL_Y + 496.0
const SPRING_Y := PANEL_Y + 506.0
const SPRING_HELP_Y := PANEL_Y + 576.0
const WORDS_RULE_Y := PANEL_Y + 596.0
const WORDS_Y := PANEL_Y + 626.0

# ── The right column ────────────────────────────────────────────────────────────────────
const SUMMARY := Rect2(RIGHT_X, 128.0, RIGHT_W, 224.0)
const TEST_Y := 364.0
const SAVE_Y := 432.0
const NEW_Y := 492.0
const SHELF_LABEL_Y := 580.0
const PAGER_Y := 554.0
const PAGER_W := 76.0
const ROWS_Y := 602.0
const ROW_H := 82.0
const ROW_GAP := 6.0
const PER_PAGE := 4
## Wide enough for what each turns into while it waits for its second press.
const EDIT_W := 126.0
const DELETE_W := 112.0
const SHARE_Y := 972.0

## Where the focus lands when the control that had it is gone or spent after a rebuild.
const FALLBACK := {
	"count-": "count+", "count+": "count-", "prev": "next", "next": "prev", "save": "test", "test": "pin",
}

## The three tolerances the lock can tell apart (its ledge is held between the outer two).
const TOLERANCES: Array[float] = [0.7, 1.0, 1.3]
const SHORTEST := EditorModel.FELT_MIN_DEPTH

var _name: LineEdit
var _test: Button
var _save: Button
var _copy: Button
## One per chamber, laid over its column of the drawing, and where each sits on the stage.
var _cards: Array[Button] = []
var _cols: Array[Rect2] = []
var _drivers: Array[Button] = []
var _springs: Array[Button] = []
## The driver profiles as closed outlines in mm, for the picture on each driver button.
var _driver_art: Array[PackedVector2Array] = []
## The controls whose way down (the lock-wide row) or left (the panel's left edge) is the
## selected pin.
var _above: Array[Control] = []
var _beside: Array[Control] = []
## The controls whose way right is the lock's actions, and the ones whose way left is the panel.
var _outward: Array[Control] = []
var _inward: Array[Control] = []
## The saved locks on the page of the shelf that is up: { rect, index }.
var _rows: Array[Dictionary] = []
var _page := 0
var _pages := 1

## The selected chamber.
var _pin := 0
## The drawing: px per mm, mm to the stage (x from the keyway's mouth, y up from the shear
## line), the lock's length in mm, and the assembly's box on the stage.
var _px := MAX_PX
var _at := Transform2D.IDENTITY
var _depth := 0.0
var _body := Rect2()
## Each chamber at rest: { driver, driver_y, key, key_y }, outlines in mm.
var _pins: Array[Dictionary] = []

## The draft as the lock it would be, why it cannot be built (or ""), and its code (or "").
var _def: Dictionary = {}
var _problem := ""
var _code := ""
var _security := 0
var _lies := 0

## Controls by name, so a rebuild can put the focus back on whatever was just pressed.
var _named := {}
var _focus := "pin"
## Whether the focus marks were on show when the screen was last rebuilt: somebody steering by
## key keeps them, somebody with a pointer never sees them.
var _show_focus := false
var _focus_id := 0
## The button waiting on a second press ("" for none), and what it said before it asked.
var _armed := ""
var _armed_caption := ""
var _armed_name := ""


func build() -> void:
	title = "Editor"
	status = "click a pin in the lock to change it  ·  the left and right arrows move from pin to pin"
	var draft: EditorModel = app.draft
	var saved: Array = app.progress.custom_locks()
	var count := draft.chambers.size()
	_named.clear()
	_armed = ""
	_pin = clampi(int(app.memo.get("editor_pin", 0)), 0, count - 1)
	_layout(count)
	if not get_viewport().gui_focus_changed.is_connected(_focus_moved):
		get_viewport().gui_focus_changed.connect(_focus_moved)

	# ── The whole lock: its name, how many pins, how forgiving ──
	_name = LineEdit.new()
	_name.position = Vector2(LEFT, TOP_Y)
	_name.max_length = EditorModel.NAME_MAX
	_name.text = draft.name
	_name.accessibility_name = "Name"
	_name.accessibility_description = "Letters, digits, spaces and hyphens. Press Enter to type, and Enter again when done."
	_name.text_changed.connect(_rename)
	add_child(_name)
	_name.size = Vector2(NAME_W, TOP_H)
	_named["name"] = _name
	_stepper("count", Vector2(PINS_X, TOP_Y), PINS_VALUE_W, "Fewer pins", "More pins", _resize)
	_stepper("tol", Vector2(TOL_X, TOP_Y), TOL_VALUE_W, "Tighter tolerance", "Looser tolerance", _tolerate)
	_above.clear()
	for key: String in ["name", "count-", "count+", "tol-", "tol+"]:
		_above.append(_named[key])

	# ── The lock: a card a chamber, laid over the drawing ──
	_cards.clear()
	var chambers := ButtonGroup.new()
	for i in count:
		var card := Kit.card(self, _cols[i], _select.bind(i), false, "Pin %d" % (i + 1))
		card.theme_type_variation = "Bare"
		card.toggle_mode = true
		card.button_group = chambers
		_cards.append(card)
	for i in count:
		# A keyway has two ends: the arrows stop at the first pin, and step off the last one
		# into the panel beside it.
		_cards[i].focus_neighbor_left = _cards[maxi(0, i - 1)].get_path()
		if i < count - 1:
			_cards[i].focus_neighbor_right = _cards[i + 1].get_path()

	# ── The selected pin: every driver at once, the key pin's length, the spring ──
	_drivers.clear()
	_driver_art.clear()
	var profiles := ButtonGroup.new()
	var driver_w := (IW - DRIVER_GAP * (DRIVER_COLS - 1)) / DRIVER_COLS
	for k in EditorModel.EDITABLE_PINS.size():
		var pin := EditorModel.EDITABLE_PINS[k]
		var rect := Rect2(IX + (k % DRIVER_COLS) * (driver_w + DRIVER_GAP),
			DRIVER_Y + floorf(k / float(DRIVER_COLS)) * (DRIVER_H + DRIVER_GAP), driver_w, DRIVER_H)
		var choice := Kit.card(self, rect, _set_driver.bind(k), false, "Driver: %s" % pin, _lie_words(pin))
		choice.toggle_mode = true
		choice.button_group = profiles
		_drivers.append(choice)
		_driver_art.append(_outline(Profiles.silhouette(pin, LockRig.PIN_R, LockRig.PIN_BEVEL)))
	_stepper("depth", Vector2(IX, DEPTH_Y), DEPTH_VALUE_W, "Shorter key pin", "Longer key pin", _cut)
	_springs = Kit.segmented(self, Rect2(IX, SPRING_Y, IW, STEP), EditorModel.SPRING_LABELS, 0, _set_spring, "Spring")
	_beside.clear()
	_beside.append(_named["depth-"])
	_beside.append(_springs[0])
	for k in range(0, _drivers.size(), DRIVER_COLS):
		_beside.append(_drivers[k])

	# ── What to do with it: one primary, then the rest ──
	_test = Kit.button(self, Rect2(RIGHT_X, TEST_Y, RIGHT_W, 56.0), "Test pick", _test_pick, true)
	_save = Kit.button(self, Rect2(RIGHT_X, SAVE_Y, RIGHT_W, 48.0), "Save", _save_draft)
	_named["test"] = _test
	_named["save"] = _save
	_guard("new", Kit.button(self, Rect2(RIGHT_X, NEW_Y, RIGHT_W, 48.0), "New draft", _new_draft))

	# ── The locks already built here, a page at a time. Edit loads a copy, so saving again adds
	# a lock rather than overwriting one you liked ──
	_pages = maxi(1, ceili(saved.size() / float(PER_PAGE)))
	_page = clampi(int(app.memo.get("editor_page", 0)), 0, _pages - 1)
	var pager: Array[Button] = []
	if _pages > 1:
		var next_x := RIGHT_X + RIGHT_W - PAGER_W
		var prev := Kit.button(self, Rect2(next_x - 8.0 - PAGER_W, PAGER_Y, PAGER_W, 40.0), "Prev", _turn.bind(-1))
		var next := Kit.button(self, Rect2(next_x, PAGER_Y, PAGER_W, 40.0), "Next", _turn.bind(1))
		Kit.describe(prev, "Previous page of your locks")
		Kit.describe(next, "Next page of your locks")
		_able(prev, _page > 0)
		_able(next, _page < _pages - 1)
		_named["prev"] = prev
		_named["next"] = next
		pager = [prev, next]
	_rows.clear()
	var edits: Array[Button] = []
	var deletes: Array[Button] = []
	for k in PER_PAGE:
		var index := _page * PER_PAGE + k
		if index >= saved.size():
			break
		var def: Dictionary = saved[index]
		var rect := Rect2(RIGHT_X, ROWS_Y + k * (ROW_H + ROW_GAP), RIGHT_W, ROW_H)
		_rows.append({"rect": rect, "index": index})
		var delete_x := rect.end.x - 12.0 - DELETE_W
		var edit := Kit.button(self, Rect2(delete_x - 12.0 - EDIT_W, rect.position.y + 34.0, EDIT_W, 40.0), "Edit",
			_load.bind(index))
		var delete := Kit.button(self, Rect2(delete_x, rect.position.y + 34.0, DELETE_W, 40.0), "Delete",
			_delete.bind(index))
		Kit.describe(edit, "Edit %s" % def["name"], "%s. Loads a copy into the editor." % _count_words(def))
		Kit.describe(delete, "Delete %s" % def["name"], _count_words(def))
		_guard("edit%d" % index, edit)
		_guard("delete%d" % index, delete)
		edits.append(edit)
		deletes.append(delete)

	# ── The lock as a code: two small buttons, and no string on the page ──
	var half := (RIGHT_W - 8.0) / 2.0
	_copy = Kit.button(self, Rect2(RIGHT_X, SHARE_Y, half, 44.0), "Copy code", _copy_code)
	var paste := Kit.button(self, Rect2(RIGHT_X + half + 8.0, SHARE_Y, half, 44.0), "Paste code", _paste_code)
	Kit.describe(_copy, "Copy code", "Copies this lock as a short code you can send to somebody.")
	Kit.describe(paste, "Paste code", "Loads the lock a code on the clipboard describes.")
	_named["copy"] = _copy
	_guard("paste", paste)
	_wire(pager, edits, deletes, paste)

	# Last, so Tab runs through the editor itself before it reaches the ways out.
	nav([
		["Bench", func() -> void: app.goto(&"bench")],
		["Menu", func() -> void: app.goto(&"menu")],
	])

	_sync()
	var target: Control = _named.get(_focus)
	if target == null or (target is BaseButton and (target as BaseButton).disabled):
		target = _named.get(FALLBACK.get(_focus, "pin"))
	if target == null or (target is BaseButton and (target as BaseButton).disabled):
		target = _cards[_pin]
	target.grab_focus.call_deferred(not _show_focus)


## A -/value/+ stepper. The value is painted between the two buttons, and each button says
## aloud what it does rather than "minus" and "plus".
func _stepper(key: String, at: Vector2, value_w: float, less: String, more: String, step: Callable) -> void:
	var minus := Kit.button(self, Rect2(at, Vector2(STEP, STEP)), "−", step.bind(-1), false, Pal.T_HEADING)
	var plus := Kit.button(self, Rect2(at + Vector2(STEP + value_w, 0.0), Vector2(STEP, STEP)), "+", step.bind(1),
		false, Pal.T_HEADING)
	Kit.describe(minus, less)
	Kit.describe(plus, more)
	_named[key + "-"] = minus
	_named[key + "+"] = plus


## The arrows, said outright wherever "the nearest control that way" is not the one a reader of
## the page would name: along each row, down each column, and across from one part of the page
## to the next. A control that cannot be used is passed over on the way.
func _wire(pager: Array[Button], edits: Array[Button], deletes: Array[Button], paste: Button) -> void:
	var shorter: Button = _named["depth-"]
	var longer: Button = _named["depth+"]
	var fresh: Button = _named["new"]
	_row(_above)
	_row(_drivers.slice(0, DRIVER_COLS))
	_row(_drivers.slice(DRIVER_COLS))
	_row([shorter, longer])
	_row(_springs)
	for k in DRIVER_COLS:
		var low := _drivers[k + DRIVER_COLS]
		_stack([_drivers[k], low])
		low.focus_neighbor_bottom = low.get_path_to(shorter if k < 2 else longer)
	shorter.focus_neighbor_top = shorter.get_path_to(_drivers[DRIVER_COLS])
	longer.focus_neighbor_top = longer.get_path_to(_drivers[DRIVER_COLS + 1])
	_stack([shorter, _springs[0]])
	longer.focus_neighbor_bottom = longer.get_path_to(_springs[1])
	for k in range(1, _springs.size()):
		_springs[k].focus_neighbor_top = _springs[k].get_path_to(longer)

	# The right column is two columns of its own under the three actions: Edit over Edit down to
	# Copy, Delete over Delete down to Paste.
	var left_side: Array = [_test, _save, fresh]
	var right_side: Array = []
	if not pager.is_empty():
		_row(pager)
		left_side.append(pager[0])
		right_side.append(pager[1])
	left_side.append_array(edits)
	right_side.append_array(deletes)
	left_side.append(_copy)
	right_side.append(paste)
	_stack(left_side)
	_stack(right_side)
	var top: Control = right_side[0]
	top.focus_neighbor_top = top.get_path_to(fresh)
	for i in edits.size():
		_row([edits[i], deletes[i]])
	_row([_copy, paste])

	# From the panel's right edge, right is the lock's actions; from the actions, left is the panel.
	_outward.clear()
	_outward.append_array([_above[_above.size() - 1], _drivers[DRIVER_COLS - 1], _drivers[_drivers.size() - 1], longer,
		_springs[_springs.size() - 1]])
	_inward.clear()
	for control: Control in left_side:
		_inward.append(control)


## Left and right along a row of controls, in the order given.
static func _row(controls: Array) -> void:
	for i in controls.size() - 1:
		var a: Control = controls[i]
		var b: Control = controls[i + 1]
		a.focus_neighbor_right = a.get_path_to(b)
		b.focus_neighbor_left = b.get_path_to(a)


## Up and down a column of controls, top first.
static func _stack(controls: Array) -> void:
	for i in controls.size() - 1:
		var a: Control = controls[i]
		var b: Control = controls[i + 1]
		a.focus_neighbor_bottom = a.get_path_to(b)
		b.focus_neighbor_top = b.get_path_to(a)


## A button whose action throws work away: it asks first, and stops asking when the focus leaves.
func _guard(key: String, button: Button) -> void:
	_named[key] = button
	button.focus_exited.connect(_disarm_if.bind(key))


## Where the drawing goes for a lock of `count` chambers: as large as the pick screen draws it
## when that fits, smaller when the lock is too long, in the middle of its part of the stage.
func _layout(count: int) -> void:
	var top := LockRig.SEAT_Y + 0.8
	var bottom := LockRig.KEYWAY_FLOOR_Y - 1.7
	_depth = LockRig.FIRST_X + LockRig.PITCH * (count - 1) + 3.5
	_px = minf(MAX_PX, minf((AREA.size.x - OVERHANG * 2.0) / _depth, (AREA.size.y - NUMBERS_H) / (top - bottom)))
	var size := Vector2(_depth, top - bottom) * _px
	var origin := (AREA.position + Vector2(AREA.size.x - size.x, AREA.size.y - NUMBERS_H - size.y) / 2.0).round()
	_at = Transform2D(Vector2(_px, 0.0), Vector2(0.0, -_px), origin + Vector2(0.0, top * _px))
	_body = Rect2(origin, size)
	_cols.clear()
	for i in count:
		var x := (_at * Vector2(LockRig.FIRST_X + LockRig.PITCH * (i - 0.5), 0.0)).x
		_cols.append(Rect2(x, origin.y - MARK_ROOM, LockRig.PITCH * _px, size.y + MARK_ROOM + NUMBERS_H))


## Read the draft again after an edit: what it is as a lock, what may be pressed, what each
## control says aloud, and how its pins sit in the drawing.
func _sync() -> void:
	var draft: EditorModel = app.draft
	var count := draft.chambers.size()
	# Built against the *next* index, so a draft picks identically before and after saving.
	var index: int = app.progress.custom_locks().size()
	_def = draft.to_lock_def(index)
	_problem = draft.problem(index)
	_code = draft.share_code(index)
	_pin = clampi(_pin, 0, count - 1)
	var row := draft.chambers[_pin]
	var depth: float = row["depth"]

	_enable("count-", draft.can_remove_chamber(), "%d now, %d at least" % [count, LockDefs.MIN_CHAMBERS])
	_enable("count+", draft.can_add_chamber(), "%d now, %d at most" % [count, LockDefs.MAX_CHAMBERS])
	var room := "%s: the ledge a set pin rests on is %.2f mm wide" % [_tolerance_word(draft), _ledge(draft)]
	_enable("tol-", draft.tolerance_quality > TOLERANCES[0] + 1e-9, room)
	_enable("tol+", draft.tolerance_quality < TOLERANCES[-1] - 1e-9, room)
	var longest := _longest(draft, _pin)
	var length := "pin %d's is %.1f mm; it may be %.1f to %.1f mm" % [_pin + 1, depth, SHORTEST, longest]
	_enable("depth-", depth > SHORTEST + 1e-9, length)
	_enable("depth+", depth < longest - 1e-9, length)
	_able(_test, _problem == "")
	_able(_save, _problem == "")
	_able(_copy, _code != "")

	# The panel shows the selected pin's choices; a choice is a filled button, and says so.
	var driver := EditorModel.EDITABLE_PINS.find(row["pin"])
	for k in _drivers.size():
		_drivers[k].theme_type_variation = "SegmentOn" if k == driver else "Segment"
		_drivers[k].set_pressed_no_signal(k == driver)
	var spring: int = row["spring"]
	for k in _springs.size():
		_springs[k].theme_type_variation = "SegmentOn" if k == spring else "Segment"
		_springs[k].set_pressed_no_signal(k == spring)

	_security = 0
	_lies = 0
	for i in count:
		var pin: String = draft.chambers[i]["pin"]
		_lies += Profiles.groove_count(pin)
		if Profiles.is_security(pin):
			_security += 1
		_cards[i].set_pressed_no_signal(i == _pin)
		var cut: float = draft.chambers[i]["depth"]
		Kit.describe(_cards[i], "Pin %d: %s, key pin %.1f mm, %s spring" % [i + 1, pin, cut, draft.spring_label(i)],
			_pin_words(draft, i))
	Kit.describe(_test, "Test pick", "%s. %s" % [_summary_words(), "Ready to pick." if _problem == "" else _verdict()])

	# From the row above the lock, down is the selected pin; from a pin, down — and right off
	# the last one — is that pin's controls; from the panel's left edge, left is the pin again.
	var here := _cards[_pin].get_path()
	var chosen := _drivers[maxi(0, driver)].get_path()
	for control in _above:
		control.focus_neighbor_bottom = here
	for control in _beside:
		control.focus_neighbor_left = here
	for card in _cards:
		card.focus_neighbor_bottom = chosen
	_cards[count - 1].focus_neighbor_right = chosen
	for control in _inward:
		control.focus_neighbor_left = chosen
	var actions := (_test if not _test.disabled else _named["new"] as Button).get_path()
	for control in _outward:
		control.focus_neighbor_right = actions

	# The rest pose the rig will build: a key pin hangs by its cone in the keyway slot with its
	# top one set-lift under the shear line, and the driver stands on it.
	var shoulder := _shoulder()
	_pins.clear()
	for chamber in draft.chambers:
		var pin: String = chamber["pin"]
		var lift := LockRig.set_lift_for(chamber["depth"], pin)
		var key_len := -shoulder - lift
		_pins.append({
			"driver": _outline(Profiles.silhouette(pin, LockRig.PIN_R, LockRig.PIN_BEVEL)),
			"driver_y": LockRig.DRIVER_HALF - lift,
			"key": _outline(LockRig.key_silhouette(key_len)),
			"key_y": shoulder + key_len / 2.0,
		})


func _enable(key: String, on: bool, more: String) -> void:
	var button: Button = _named[key]
	# A stepper that has just run out hands the focus to its other half, so a keyboard is never
	# left standing on a button that no longer does anything.
	if not on and not button.disabled and button.has_focus():
		var other: Button = _named[key.left(-1) + ("+" if key.ends_with("-") else "-")]
		other.grab_focus(not button.has_focus(true))
	_able(button, on)
	button.accessibility_description = more


## A button that cannot be pressed is drawn faint and is not somewhere the focus can stop.
static func _able(button: Button, on: bool) -> void:
	button.disabled = not on
	button.focus_mode = Control.FOCUS_ALL if on else Control.FOCUS_NONE


## The height of a key pin's shoulder at rest: where its cone hangs in the keyway slot.
static func _shoulder() -> float:
	var hang := LockRig.KEY_TIP * (LockRig.SLOT_HALF - LockRig.KEY_TIP_HALF) / (LockRig.PIN_R - LockRig.KEY_TIP_HALF)
	return LockRig.FLOOR_Y - hang + LockRig.KEY_TIP


## A right-hand silhouette ([u, half_width]) as a closed outline in mm, x across and y up.
static func _outline(silhouette: Array[Vector2]) -> PackedVector2Array:
	var points := PackedVector2Array()
	for p in silhouette:
		points.append(Vector2(p.y, p.x))
	for k in range(silhouette.size() - 1, -1, -1):
		points.append(Vector2(-silhouette[k].y, silhouette[k].x))
	return points


# ── What the numbers mean, in words ─────────────────────────────────────────────────────

static func _lie_words(pin: String) -> String:
	var grooves := Profiles.groove_count(pin)
	match grooves:
		0:
			return "never false-sets"
		1:
			return "can false-set once"
		2:
			return "can false-set twice"
	return "can false-set %d times" % grooves


## What one pin will do under a pick: how far it has to be lifted, and how often it can lie.
static func _pin_words(draft: EditorModel, index: int) -> String:
	var row := draft.chambers[index]
	var pin: String = row["pin"]
	return "sets when lifted %.2f mm  ·  %s" % [LockRig.set_lift_for(row["depth"], pin), _lie_words(pin)]


static func _tolerance_word(draft: EditorModel) -> String:
	var quality := draft.tolerance_quality
	if quality >= 1.15:
		return "loose"
	return "normal" if quality >= 0.85 else "tight"


## How wide a ledge the plug leaves under each set pin, mm — what tolerance comes to in the lock.
static func _ledge(draft: EditorModel) -> float:
	return LockRig.BIND_STEP * clampf(draft.tolerance_quality, TOLERANCES[0], TOLERANCES[-1])


static func _longest(draft: EditorModel, index: int) -> float:
	return draft.felt_max_depth(index)


static func _count_words(def: Dictionary) -> String:
	var n := LockDefs.chamber_count(def)
	return "%d pin%s" % [n, "" if n == 1 else "s"]


func _summary_words() -> String:
	var security := "no security pins" if _security == 0 else "%d security pin%s" % [_security, "" if _security == 1 else "s"]
	return "%s, %s, par %s seconds" % [_count_words(_def), security, WebNum.text(_def["par"])]


## The validator's sentence without the slug it opens with: the page already says which lock.
func _verdict() -> String:
	var cut := _problem.find('": ')
	return "cannot be built — %s" % (_problem.substr(cut + 3) if cut >= 0 else _problem)


# ── Drawing ─────────────────────────────────────────────────────────────────────────────

## The draft is the app's and outlives this screen. Should anything else change its length, the
## page is built again around it rather than drawn against a lock it no longer matches.
func _process(delta: float) -> void:
	super(delta)
	var draft: EditorModel = app.draft
	if draft.chambers.size() != _cards.size():
		rebuild()


func paint_under() -> void:
	panel(Rect2(PANEL_X, PANEL_Y, PANEL_W, PANEL_H))
	panel(SUMMARY, "this lock")
	for row in _rows:
		panel(row["rect"])
	_paint_cutaway()


func paint() -> void:
	var draft: EditorModel = app.draft
	if draft.chambers.size() != _cards.size():
		return
	_paint_top(draft)
	_paint_marks()
	_paint_pin(draft)
	_paint_summary(draft)
	_paint_shelf()


## The value a stepper is holding, between its two buttons.
func _value(at: Vector2, value_w: float, text: String) -> void:
	plain(at + Vector2(STEP + value_w / 2.0, STEP / 2.0 + Pal.T_HEADING * 0.36), text, Pal.T_HEADING, Pal.INK,
		HORIZONTAL_ALIGNMENT_CENTER)


func _paint_top(draft: EditorModel) -> void:
	tracked(Vector2(LEFT, LABEL_Y), "name", Pal.T_DIM, Pal.INK_LIGHT)
	plain(Vector2(LEFT, HELP_Y), "typing — press Enter when done" if _name.is_editing()
		else "letters, digits, spaces and hyphens", Pal.T_DIM, Pal.INK_LIGHT)

	tracked(Vector2(PINS_X, LABEL_Y), "pins", Pal.T_DIM, Pal.INK_LIGHT)
	_value(Vector2(PINS_X, TOP_Y), PINS_VALUE_W, str(draft.chambers.size()))
	plain(Vector2(PINS_X, HELP_Y), "%d to %d" % [LockDefs.MIN_CHAMBERS, LockDefs.MAX_CHAMBERS], Pal.T_DIM, Pal.INK_LIGHT)

	# Said as a word, then as the thing it changes: the ledge each set pin is left resting on.
	tracked(Vector2(TOL_X, LABEL_Y), "tolerance", Pal.T_DIM, Pal.INK_LIGHT)
	_value(Vector2(TOL_X, TOP_Y), TOL_VALUE_W, _tolerance_word(draft))
	plain(Vector2(TOL_X, HELP_Y), "a set pin rests on a %.2f mm ledge — a tight one is easier to lose" % _ledge(draft),
		Pal.T_DIM, Pal.INK_LIGHT)



## The draft as the pick screen will show it: the same section along the keyway, every pin at
## rest. Drawn from the lock Test pick would hand the bench, so it is a picture of what you are
## about to pick and not an illustration of it.
func _paint_cutaway() -> void:
	var top := LockRig.SEAT_Y + 0.8
	var bottom := LockRig.KEYWAY_FLOOR_Y - 1.7
	var bore := LockRig.PIN_R + LockRig.PLUG_CLEAR

	var shell := _span(0.0, top, _depth, LockRig.SHEAR_GAP)
	var plug := _span(0.0, 0.0, _depth, bottom)
	pen.draw_rect(shell, Pal.SHELL_BODY)
	Pal.hatch_rect(pen, shell, HATCH, 45.0, Pal.RULE)
	pen.draw_rect(plug, Pal.PLUG_BODY)
	Pal.hatch_rect(pen, plug, HATCH, -45.0, Pal.RULE)
	# What is punched out of them: the keyway, open at the face and closed 2 mm short of the
	# back, and a bore a chamber.
	var keyway := _span(0.0, LockRig.KEYWAY_CEIL_Y, _depth - 2.0, LockRig.KEYWAY_FLOOR_Y).grow_side(SIDE_LEFT, 2.0)
	var holes: Array[Rect2] = [keyway]
	for i in _pins.size():
		var x := LockRig.FIRST_X + LockRig.PITCH * i
		holes.append(_span(x - bore, LockRig.SEAT_Y, x + bore, LockRig.SHEAR_GAP))
		holes.append(_span(x - bore, 0.0, x + bore, LockRig.KEYWAY_CEIL_Y))
	for hole in holes:
		pen.draw_rect(hole, Pal.PAPER)
	pen.draw_rect(shell, Pal.INK, false, Pal.STROKE)
	pen.draw_rect(plug, Pal.INK, false, Pal.STROKE)
	for hole in holes:
		pen.draw_rect(hole, Pal.INK, false, Pal.STROKE)

	for i in _pins.size():
		var pin := _pins[i]
		var x := LockRig.FIRST_X + LockRig.PITCH * i
		var driver_y: float = pin["driver_y"]
		var key_y: float = pin["key_y"]
		# The spring, from its seat down to the driver's top.
		var coil := PackedVector2Array([Vector2(x, LockRig.SEAT_Y)])
		var run := driver_y + LockRig.DRIVER_HALF - LockRig.SEAT_Y
		for k in 5:
			coil.append(Vector2(x + LockRig.PIN_R * (0.72 if k % 2 == 0 else -0.72), LockRig.SEAT_Y + run * (k + 0.5) / 5.0))
			coil.append(Vector2(x, LockRig.SEAT_Y + run * (k + 1.0) / 5.0))
		pen.draw_polyline(_at * coil, Pal.INK_LIGHT, 1.0, true)
		Pal.poly(pen, _at.translated_local(Vector2(x, driver_y)) * (pin["driver"] as PackedVector2Array), Pal.STEEL)
		Pal.poly(pen, _at.translated_local(Vector2(x, key_y)) * (pin["key"] as PackedVector2Array),
			Pal.STEEL.lerp(Pal.PAPER, 0.32))
	# The shear line: the strongest line in the drawing, as it is on the bench.
	pen.draw_line(Vector2(_body.position.x - OVERHANG, (_at * Vector2.ZERO).y),
		Vector2(_body.end.x + OVERHANG, (_at * Vector2.ZERO).y), Pal.INK, Pal.HEAVY)
	Pal.text(pen, Vector2(keyway.end.x - 12.0, keyway.end.y - 10.0), "KEYWAY", Pal.T_DIM, Pal.INK_LIGHT,
		HORIZONTAL_ALIGNMENT_RIGHT, false, 1.4)


## The stage rectangle between two corners given in mm.
func _span(x0: float, y_top: float, x1: float, y_bottom: float) -> Rect2:
	var a := _at * Vector2(x0, y_top)
	return Rect2(a, _at * Vector2(x1, y_bottom) - a)


## Which pin is which, and which one the panel is about. The selected pin is marked three ways
## and none of them is a colour: a bracket over its chamber, another under it, and its number
## reversed out of a block of ink. A pin under the pointer gets the brackets alone, in outline.
func _paint_marks() -> void:
	for i in _cols.size():
		var col := _cols[i]
		var cx := col.get_center().x
		var badge_w := minf(44.0, col.size.x - 8.0)
		var badge := Rect2(cx - badge_w / 2.0, _body.end.y + 18.0, badge_w, 34.0)
		var base := Vector2(cx, badge.get_center().y + Pal.T_BODY * 0.36)
		if i == _pin:
			_brackets(col, Pal.INK, Pal.HEAVY)
			pen.draw_rect(badge, Pal.INK)
			plain(base, str(i + 1), Pal.T_BODY, Pal.PAPER, HORIZONTAL_ALIGNMENT_CENTER, true)
		else:
			plain(base, str(i + 1), Pal.T_BODY, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_CENTER)
			if _cards[i].is_hovered():
				_brackets(col, Pal.INK_LIGHT, Pal.px(1.0))
		# The marks are for a keyboard or a pad; a pointer already knows where it is.
		if _cards[i].has_focus(true):
			FocusMarks.paint(pen.get_canvas_item(), col.grow_individual(-10.0, 4.0, -10.0, -4.0))


## A bracket over a chamber and one under it, opening towards the lock: the column between them
## is the pin in question.
func _brackets(col: Rect2, ink: Color, weight: float) -> void:
	var inset := minf(8.0, col.size.x * 0.1)
	var left := col.position.x + inset
	var width := col.size.x - inset * 2.0
	var over := _body.position.y - 10.0
	var under := _body.end.y + 10.0 - weight
	for bar: Rect2 in [Rect2(left, over, width, weight), Rect2(left, under, width, weight)]:
		pen.draw_rect(bar, ink)
	for x: float in [left, left + width - weight]:
		pen.draw_rect(Rect2(x, over, weight, 9.0), ink)
		pen.draw_rect(Rect2(x, under - 9.0 + weight, weight, 9.0), ink)


func _paint_pin(draft: EditorModel) -> void:
	var row := draft.chambers[_pin]
	var depth: float = row["depth"]
	tracked(Vector2(IX, PANEL_Y + 40.0), "pin %d" % (_pin + 1), Pal.T_HEADING, Pal.INK, HORIZONTAL_ALIGNMENT_LEFT, true)
	plain(Vector2(IX + IW, PANEL_Y + 40.0), "of %d" % draft.chambers.size(), Pal.T_DIM, Pal.INK_LIGHT,
		HORIZONTAL_ALIGNMENT_RIGHT)

	tracked(Vector2(IX, DRIVER_LABEL_Y), "driver", Pal.T_DIM, Pal.INK_LIGHT)
	var chosen := EditorModel.EDITABLE_PINS.find(row["pin"])
	for k in _drivers.size():
		_paint_driver(k, k == chosen)

	tracked(Vector2(IX, DEPTH_LABEL_Y), "key pin length", Pal.T_DIM, Pal.INK_LIGHT)
	_value(Vector2(IX, DEPTH_Y), DEPTH_VALUE_W, "%.1f mm" % depth)
	var longest := _longest(draft, _pin)
	plain(Vector2(IX + IW, DEPTH_Y + STEP / 2.0 + Pal.T_DIM * 0.36), "%.1f to %.1f mm" % [SHORTEST, longest],
		Pal.T_DIM, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_RIGHT)
	# Why the + has stopped, when it has stopped short of a plain pin's limit.
	var capped := depth >= longest - 1e-9 and Profiles.is_security(row["pin"])
	paragraph(Vector2(IX, DEPTH_HELP_Y), "the longest this driver takes — its grooves must start under the shear line"
		if capped else "a longer key pin needs less lift to set", Pal.T_DIM, Pal.INK_LIGHT, IW, Pal.T_DIM + 5.0, 2)

	tracked(Vector2(IX, SPRING_LABEL_Y), "spring", Pal.T_DIM, Pal.INK_LIGHT)
	plain(Vector2(IX, SPRING_HELP_Y), "how hard the pin is pushed back down", Pal.T_DIM, Pal.INK_LIGHT)

	# What those three choices add up to, in the lock's own terms.
	pen.draw_line(Vector2(IX, WORDS_RULE_Y), Vector2(IX + IW, WORDS_RULE_Y), Pal.RULE, Pal.HAIRLINE)
	plain(Vector2(IX, WORDS_Y), "sets when lifted %.2f mm" % LockRig.set_lift_for(depth, row["pin"]), Pal.T_BODY, Pal.INK)
	plain(Vector2(IX, WORDS_Y + Pal.T_BODY + 7.0), _lie_words(row["pin"]), Pal.T_BODY, Pal.INK)


## A driver button: the profile itself, drawn from the same outline the lock is built from, and
## its name. The chosen one is reversed — ink for paper — with everything on it.
func _paint_driver(k: int, on: bool) -> void:
	var button := _drivers[k]
	var rect := Rect2(button.position, button.size)
	var ink := Pal.PAPER if on else Pal.INK
	var centre := Vector2(rect.get_center().x, rect.position.y + 10.0 + Profiles.DRIVER_LENGTH * ART_PX / 2.0)
	Pal.poly(pen, Transform2D(Vector2(ART_PX, 0.0), Vector2(0.0, -ART_PX), centre) * _driver_art[k], Pal.STEEL, ink,
		Pal.px(1.5))
	# A name too long for the button breaks at its hyphen: "spool" over "double".
	var pin := EditorModel.EDITABLE_PINS[k]
	var lines := PackedStringArray([pin])
	if Pal.text_width(pin, Pal.T_DIM) > rect.size.x - 16.0:
		lines = pin.split("-")
	var middle := rect.end.y - 30.0 + Pal.T_DIM * 0.36
	for n in lines.size():
		plain(Vector2(rect.get_center().x, middle + (n - (lines.size() - 1) * 0.5) * 20.0), lines[n], Pal.T_DIM, ink,
			HORIZONTAL_ALIGNMENT_CENTER)


func _paint_summary(draft: EditorModel) -> void:
	var x := SUMMARY.position.x + 16.0
	var rows := [
		["pins", str(draft.chambers.size())],
		["security pins", "none" if _security == 0 else str(_security)],
		["false sets", "none" if _lies == 0 else "up to %d" % _lies],
		["par", "%ss" % WebNum.text(_def["par"])],
	]
	for i in rows.size():
		var base := SUMMARY.position.y + 56.0 + i * 26.0
		plain(Vector2(x, base), str(rows[i][0]), Pal.T_BODY, Pal.INK_LIGHT)
		plain(Vector2(x + 190.0, base), str(rows[i][1]), Pal.T_BODY, Pal.INK)
	var rule := SUMMARY.position.y + 146.0
	pen.draw_line(Vector2(x, rule), Vector2(SUMMARY.end.x - 16.0, rule), Pal.RULE, Pal.HAIRLINE)
	# The verdict, in the open: said in words either way, and amber when something is wrong.
	if _problem == "":
		plain(Vector2(x, rule + 30.0), "ready to pick", Pal.T_BODY, Pal.TEAL_TEXT)
	else:
		paragraph(Vector2(x, rule + 22.0), _verdict(), Pal.T_DIM, Pal.AMBER_TEXT, SUMMARY.size.x - 32.0, Pal.T_DIM + 4.0, 3)


func _paint_shelf() -> void:
	var saved: Array = app.progress.custom_locks()
	tracked(Vector2(RIGHT_X, SHELF_LABEL_Y), "your locks", Pal.T_DIM, Pal.INK_LIGHT)
	if saved.is_empty():
		paragraph(Vector2(RIGHT_X, ROWS_Y + 20.0), "nothing saved yet — Save keeps this lock here, and puts it on the bench under Your locks",
			Pal.T_DIM, Pal.INK_LIGHT, RIGHT_W, Pal.T_DIM + 5.0, 3)
	elif _pages > 1:
		var first := _page * PER_PAGE + 1
		plain(Vector2(RIGHT_X + RIGHT_W - PAGER_W * 2.0 - 24.0, SHELF_LABEL_Y), "%d–%d of %d" % [first,
			first + _rows.size() - 1, saved.size()], Pal.T_DIM, Pal.INK_LIGHT, HORIZONTAL_ALIGNMENT_RIGHT)
	for row in _rows:
		var rect: Rect2 = row["rect"]
		var def: Dictionary = saved[row["index"]]
		paragraph(rect.position + Vector2(12.0, 26.0), str(def["name"]), Pal.T_BODY, Pal.INK, rect.size.x - 24.0,
			Pal.T_BODY + 4.0, 1)
		plain(rect.position + Vector2(12.0, 61.0), _count_words(def), Pal.T_DIM, Pal.INK_LIGHT)
	var rule := SHARE_Y - 14.0
	pen.draw_line(Vector2(RIGHT_X, rule), Vector2(RIGHT_X + RIGHT_W, rule), Pal.RULE, Pal.HAIRLINE)


# ── Choosing a pin ──────────────────────────────────────────────────────────────────────

func _select(index: int) -> void:
	if index == _pin or index < 0 or index >= _cards.size():
		# Pressing the pin already chosen must not un-choose it.
		if index == _pin:
			_cards[index].set_pressed_no_signal(true)
		return
	_pin = index
	app.memo["editor_pin"] = index
	_sync()


## The arrows walk the lock, and the pin they arrive at becomes the selected one. Tab does not:
## it passes over the pins on its way through the page and leaves the selection where it was,
## so the panel is still about the same pin when Tab gets there.
func _focus_moved(now: Control) -> void:
	var was := _focus_id
	_focus_id = now.get_instance_id() if now != null else 0
	var index := -1
	var from_pin := false
	for i in _cards.size():
		var id := _cards[i].get_instance_id()
		if id == _focus_id:
			index = i
		if id == was:
			from_pin = true
	if index < 0 or index == _pin or not from_pin:
		return
	if Input.is_action_pressed(&"ui_focus_next") or Input.is_action_pressed(&"ui_focus_prev"):
		return
	_select(index)


# ── Edits ───────────────────────────────────────────────────────────────────────────────

func _rename(text: String) -> void:
	var clean := EditorModel.clean_name(text)
	if clean != text:
		var caret := EditorModel.clean_name(text.left(_name.caret_column)).length()
		_name.text = clean
		_name.caret_column = caret
	var draft: EditorModel = app.draft
	draft.set_name(clean)
	_sync()


## The drawing is as long as the lock, so a new count is a new set of controls.
func _resize(by: int) -> void:
	var draft: EditorModel = app.draft
	draft.set_chamber_count(draft.chambers.size() + by)
	if by > 0:
		# The pin just added is the one to look at next.
		app.memo["editor_pin"] = draft.chambers.size() - 1
	_refresh("count+" if by > 0 else "count-")


func _tolerate(by: int) -> void:
	var draft: EditorModel = app.draft
	# From wherever the draft stands (a pasted lock may be between settings) to the next one.
	var at := 0
	for k in TOLERANCES.size():
		if absf(TOLERANCES[k] - draft.tolerance_quality) < absf(TOLERANCES[at] - draft.tolerance_quality):
			at = k
	draft.set_tolerance(TOLERANCES[clampi(at + by, 0, TOLERANCES.size() - 1)])
	_sync()


func _set_driver(k: int) -> void:
	var draft: EditorModel = app.draft
	var pin := EditorModel.EDITABLE_PINS[k]
	var before: float = draft.chambers[_pin]["depth"]
	draft.set_pin(_pin, pin)
	var after: float = draft.chambers[_pin]["depth"]
	if after < before - 1e-9:
		# The model pulled the cut up to keep the lock buildable: say so, or it looks like a bug.
		app.status = "pin %d's key pin shortened to %.1f mm — the longest a %s takes" % [_pin + 1, after, pin]
	_sync()


func _cut(by: int) -> void:
	var draft: EditorModel = app.draft
	var depth: float = draft.chambers[_pin]["depth"]
	var longest := _longest(draft, _pin)
	# A lock that came in by code may sit outside the range that makes a difference: the first
	# step brings it to the edge of it rather than through sizes that all pick the same.
	if by > 0 and depth < SHORTEST:
		draft.set_depth(_pin, SHORTEST)
	elif by < 0 and depth > longest:
		draft.set_depth(_pin, longest)
	else:
		draft.nudge_depth(_pin, by)
	_sync()


func _set_spring(k: int) -> void:
	var draft: EditorModel = app.draft
	draft.set_spring(_pin, k)
	_sync()


# ── Asking before work is thrown away ───────────────────────────────────────────────────

## The draft as a string: two drafts are the same lock exactly when these match.
static func _signature(draft: EditorModel) -> String:
	return JSON.stringify([draft.name, draft.chambers, draft.tolerance_quality, draft.keyway])


## True while the draft holds work that exists nowhere else: it is not a fresh draft, and it is
## not the lock that was last saved or opened from the shelf.
func _dirty() -> bool:
	var draft: EditorModel = app.draft
	var now := _signature(draft)
	return now != _signature(EditorModel.new()) and now != str(app.memo.get("editor_saved", ""))


## Two presses for anything that cannot be undone. The first turns the button into the question
## and says what a second press will do; the second, on the same button, does it. Moving to any
## other control takes the question back.
func _confirmed(key: String, question: String, message: String) -> bool:
	if _armed == key:
		return true
	_disarm_if(_armed)
	var button: Button = _named.get(key)
	if button == null:
		return true
	_armed = key
	_armed_caption = button.text
	_armed_name = button.accessibility_name
	button.text = question.to_upper()
	button.accessibility_name = question
	button.theme_type_variation = "Primary"
	app.status = message
	return false


func _disarm_if(key: String) -> void:
	if key == "" or _armed != key:
		return
	_armed = ""
	var button: Button = _named.get(key)
	if button != null and is_instance_valid(button):
		button.text = _armed_caption
		button.accessibility_name = _armed_name
		button.theme_type_variation = ""


## Build the screen again around a changed draft or shelf, and put the focus back where it was
## — showing its marks only if they were showing.
func _refresh(focus: String) -> void:
	var owner := get_viewport().gui_get_focus_owner()
	_show_focus = owner != null and owner.has_focus(true)
	_focus = focus
	rebuild()


# ── Out of the editor ───────────────────────────────────────────────────────────────────

## A test pick is a real attempt at the lock the draft would be, on the seed its saved copy
## will have.
func _test_pick() -> void:
	if _problem != "":
		app.status = _verdict()
		return
	app.start_lock(_def)


func _save_draft() -> void:
	if _problem != "":
		app.status = _verdict()
		return
	var draft: EditorModel = app.draft
	var now := _signature(draft)
	if now == str(app.memo.get("editor_saved", "")):
		# A second press on Save is not a second lock.
		app.status = "%s is already saved — it is on the bench under Your locks" % _def["name"]
		return
	var at: int = app.progress.add_custom_lock(_def)
	app.memo["editor_saved"] = now
	app.memo["editor_page"] = int(at / float(PER_PAGE))
	app.status = "%s saved — it is on the bench under Your locks" % _def["name"]
	_refresh("save")


func _new_draft() -> void:
	if _dirty() and not _confirmed("new", "Discard this draft?", "this draft is not saved — press again to discard it"):
		return
	var draft: EditorModel = app.draft
	draft.reset()
	draft.keep_felt()
	app.memo.erase("editor_saved")
	app.memo["editor_pin"] = 0
	app.status = "a new draft"
	_refresh("new")


## Copies into the draft, so there is no way to lose a lock you liked by opening it to try a
## variation.
func _load(index: int) -> void:
	var def: Dictionary = app.progress.custom_locks()[index]
	if _dirty() and not _confirmed("edit%d" % index, "Replace?",
			"this draft is not saved — press again to replace it with a copy of %s" % def["name"]):
		return
	var draft: EditorModel = app.draft
	draft.load_lock_def(def)
	app.memo["editor_saved"] = _signature(draft)
	app.memo["editor_pin"] = 0
	app.status = "editing a copy of %s — Save keeps it as a new lock" % def["name"]
	_refresh("edit%d" % index)


func _delete(index: int) -> void:
	var saved: Array = app.progress.custom_locks()
	var def: Dictionary = saved[index]
	if not _confirmed("delete%d" % index, "Delete?", "press again to delete %s for good" % def["name"]):
		return
	app.progress.remove_custom_lock(index)
	# Whatever the draft was a copy of may be the lock that just went: it counts as unsaved again.
	app.memo.erase("editor_saved")
	app.status = "deleted %s" % def["name"]
	var left: int = app.progress.custom_locks().size()
	var next := mini(index, left - 1)
	app.memo["editor_page"] = maxi(0, int(next / float(PER_PAGE)))
	_refresh("delete%d" % next if left > 0 else "save")


func _turn(by: int) -> void:
	app.memo["editor_page"] = clampi(_page + by, 0, _pages - 1)
	_refresh("next" if by > 0 else "prev")


func _copy_code() -> void:
	if _code != "":
		app.copy_text(ShareCode.format(_code), "the lock's code")


func _paste_code() -> void:
	var text := DisplayServer.clipboard_get().strip_edges()
	if text == "":
		app.status = "nothing to paste — copy a lock's code first"
		return
	var read := ShareCode.decode(text, app.progress.custom_locks().size())
	if not read.ok():
		app.status = "nothing pasted: %s" % read.problem
		return
	var pins := LockDefs.chamber_count(read.def)
	if _dirty() and not _confirmed("paste", "Replace?",
			"this draft is not saved — press again to replace it with the %d-pin lock on the clipboard" % pins):
		return
	var draft: EditorModel = app.draft
	draft.load_lock_def(read.def)
	app.memo["editor_pin"] = 0
	app.status = "pasted a %d-pin lock from its code" % pins
	_refresh("paste")
