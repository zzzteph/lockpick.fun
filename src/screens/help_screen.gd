extends GameScreen
## Help: a deck of slides. One picture, one short sentence, one tap for the next.
##
## The first thing shown is a grid of topic tiles; picking one starts its slides. A slide is one
## large figure — a frame of the game held still (`HelpFigure`), in one view — with a heading of
## a few words and a single sentence under it. Nothing is lettered smaller than body type, and
## the two buttons that turn the slides sit in the bottom corners, where the thumbs are.
##
## A figure is laid out by one function that is called twice: from `build()` to add its windows
## (clipped Controls that draw themselves), and every frame from `paint()` to set the names over
## them. Handed a tile's corner instead of the stage, the same function is that topic's picture
## on the grid.

## [topic, the figure on its tile, [[heading, the one sentence, figure], …]]
const TOPICS: Array = [
	["The lock", &"_fig_parts", [
		["The parts", "A plug turns inside a shell. Sprung pins cross the line between them.", &"_fig_parts"],
		["Why it will not turn", "The plug must turn. A driver pin across the shear line stops it.", &"_fig_blocked"],
		["Lift it to the line", "Lift until the gap between the two pins meets the line. The plug turns.", &"_fig_open"],
	]],
	["Binding and setting", &"_fig_bind", [
		["One pin binds", "Turn the wrench: the plug moves a hair and pinches one pin.", &"_fig_bind"],
		["Lift the binding pin", "It pushes back harder than the rest. Put the pick under it and lift.", &"_fig_lift"],
		["Stop at the click", "The plug slips under the driver and holds it up. Find the next.", &"_fig_set"],
		["Overset", "Push on past the click and the key pin jams up in the shell.", &"_fig_overset"],
		["Reset", "Only letting go of the wrench frees it, and every set pin drops too.", &"_fig_reset"],
	]],
	["Wrench pressure", &"_fig_dial", [
		["Ten pressures", "Keys 1 to 0 set how hard the wrench turns. 5 is the all-rounder.", &"_fig_dial"],
		["Heavy or light", "Heavy holds sets but pinches harder. Light frees a caught pin; sets can slip.", &"_fig_heavy_light"],
	]],
	["Security pins", &"_fig_spool", [
		["The spool", "A spool is a driver with a narrow waist. Many locks hide a few.", &"_fig_spool"],
		["False set", "The plug turns into the waist and the pin feels set. It is not.", &"_fig_false_set"],
		["Ease back and lift", "Ease the plug back and keep lifting. The spool's foot slips past the edge.", &"_fig_ease"],
		["The others", "Serrated, mushroom and T-pins catch the plug too. Ease back and lift through.", &"_fig_others"],
		["The sidebar", "Still shut with every pin set? Lift each key pin into its gate.", &"_fig_sidebar"],
	]],
	["Reading the screen", &"_fig_columns", [
		["Force and resistance", "Resistance far above force means the plug is pinching this pin. Lift it.", &"_fig_columns"],
		["Pin colours", "Training colours each pin by what it is doing. Normal draws them all plain.", &"_fig_colours"],
		["The plug bar", "The bar fills as the plug turns. Past the notch, the lock opens.", &"_fig_plug_bar"],
	]],
	["Controls", &"_fig_tile_keys", [
		["Keyboard", "One hand turns the wrench, the other works the pick.", &"_fig_keyboard"],
		["Mouse", "The pointer moves the pick. Hold a button over the lock for the wrench.", &"_fig_mouse"],
		["Controller", "Right trigger for the wrench, A to lift, left trigger to ease back.", &"_fig_controller"],
		["Touch", "Tap a pin, then drag up to lift it. The slider on the left edge is the wrench.", &"_fig_touch"],
	]],
	["Snap gun", &"_fig_gun_ready", [
		["The needle", "The gun's needle lies under every pin. The lighter the wrench, the softer a strike will do.", &"_fig_gun_ready"],
		["Hold to draw back", "Hold Space, A on a controller, or the strike pad. A longer hold strikes harder, up to a limit.",
			&"_fig_gun_draw"],
		["Let go to strike", "Every pin jumps, higher the harder it is struck. Too soft and they fall short of the line.", &"_fig_gun_strike"],
		["What it cannot open", "A plain pin thrown over the line can catch. A security pin only jiggles.", &"_fig_gun_caught"],
	]],
	["Combination wheels", &"_fig_pack_pull", [
		["Pull the shackle", "Pull, and the tooth jams on one wheel. That wheel drags when turned.", &"_fig_pack_pull"],
		["A false gate", "A shallow cut holds the wheel. Let the shackle right off, then roll on.", &"_fig_pack_lie"],
		["The true gate", "The tooth drops in and the drag moves on. Line up every wheel.", &"_fig_pack_gate"],
	]],
	["Disc detainers", &"_fig_disc_tile", [
		["The parts", "A row of discs in a sleeve, and one bar along the top of them. No pins, no springs.", &"_fig_disc_parts"],
		["The gate", "Every disc has a gate in its rim. Turn the disc and the gate comes round to the bar.", &"_fig_disc_gate"],
		["One disc binds", "Turn the wrench: the bar comes down on one disc. That disc turns stiff.", &"_fig_disc_bind"],
		["The bar drops in", "Turn the stiff disc until its gate is under the bar, and stop. Then find the next.", &"_fig_disc_set"],
		["Too far", "Keep pushing after the bar drops and the disc rides on past its gate. Turn it back.", &"_fig_disc_past"],
		["Nothing falls back", "Let the wrench go and the bar lifts. Every disc stays where you left it.", &"_fig_disc_stay"],
		["A false gate", "A shallow notch takes the bar and holds the disc. Ease the sleeve, then turn on.", &"_fig_disc_lie"],
		["Open", "Every gate in line: the bar drops clear of the body, and the sleeve turns.", &"_fig_disc_open"],
	]],
	["Ranks and tiers", &"_fig_tile_rank", [
		["Rank", "You start on S; the letter falls as the clock runs. C is par.", &"_fig_rank_bar"],
		["Tiers", "Open enough locks at D or better and the next tier unlocks.", &"_fig_tiers"],
	]],
]
## Where each page of the old fifteen-page manual went: a memo left by it opens that topic.
const OLD_PAGES: Array[int] = [0, 0, 1, 1, 1, 1, 2, 3, 3, 3, 4, 5, 9, 6, 7]

# ── Type: nothing here is smaller than body type ────────────────────────────────────────
const T_HEAD := 44
const T_SENTENCE := 34
const T_NAME := 28
const T_TILE := 32
const T_WAY := Pal.T_HEADING
const SENTENCE_LINE := 46.0

# ── The ways out, top-right ─────────────────────────────────────────────────────────────
const WAY_Y := MARGIN + 12.0
const WAY_H := 72.0
const WAY_GAP := 20.0

# ── A slide ─────────────────────────────────────────────────────────────────────────────
## The figure's share of the stage.
const FIG := Rect2(LEFT, 124.0, WIDTH, 610.0)
## Previous and Next: one in each bottom corner, clear of the message strip under them.
const TURN := Vector2(280.0, 130.0)
const TURN_Y := 790.0
## The heading, the sentence and the count sit between the two buttons.
const TEXT_W := WIDTH - 2.0 * (TURN.x + 36.0)
const HEAD_Y := 800.0
const SENTENCE_Y := 858.0
const COUNT_Y := 1006.0

# ── The grid of topics ──────────────────────────────────────────────────────────────────
const TILE_COLS := 3
const TILE_GAP := 24.0
const TILE_PAD := 22.0
const GRID := Rect2(LEFT, 124.0, WIDTH, 838.0)
## The picture on a tile is this wide; the topic's name takes the rest.
const TILE_PICTURE := 216.0

# ── Figures ─────────────────────────────────────────────────────────────────────────────
## Which side of a figure a name is set on.
const WEST := -1
const EAST := 1
## How much of a tool's shank shows outside the keyway's mouth, mm.
const TOOL_LEAD := 2.5
const STATE_WORDS: Array[String] = ["free", "binding", "false set", "set", "overset"]
## A wheel's gates, in digits round from under the fence: the false one comes up first.
const DIGIT := TAU / 10.0
const LIE_AT := 3.0 * DIGIT
const GATE_AT := 7.0 * DIGIT
const KEYBOARD: Array = [
	["[Q]", "hold: turn the wrench"],
	["[1] to [0]  [W] [E]", "wrench pressure"],
	["[←] [→]", "move the pick"],
	["[Space]", "hold: lift a pin, or turn a disc on"],
	["[↓]", "hold: turn a disc back"],
	["[C]", "hold: ease the plug back"],
	["[R]", "restart"],
	["[Esc]", "pause"],
]
const MOUSE: Array = [
	["[Move]", "move the pick"],
	["[Click]", "hold: turn the wrench"],
	["[Right click]", "hold too: ease the plug back"],
	["[Space]", "hold: lift"],
	["[Click] [Right click]", "on a disc lock: turn the disc on, or back"],
	["[Q] [C]", "on a disc lock: the wrench, and easing it"],
]
const CONTROLLER: Array = [
	["[RT]", "hold: turn the wrench"],
	["[LB] [RB]", "wrench pressure"],
	["[D-pad]", "move the pick"],
	["[A]", "hold: lift a pin, or turn a disc on"],
	["[B]", "hold: turn a disc back"],
	["[LT] or [X]", "hold: ease the plug back"],
	["[Back]", "restart"],
	["[Start]", "pause"],
]

const TOUCH: Array = [
	["[Tap]", "a pin: move the pick"],
	["[Drag up]", "lift it; let go to drop it"],
	["[Drag across]", "carry the pick along"],
	["[Drag up or down]", "on a disc: turn it on, or back"],
	["[Slider]", "the wrench: off at the bottom"],
	["[Counter-rotate]", "hold: ease the plug back"],
	["[Pick out]", "take the pick out"],
	["[Pause]", "pause, restart"],
]

var _prev: Button
var _next: Button
var _tiles: Array[Button] = []
var _frames: Array[Control] = []
## The slide's sentence, broken into its lines.
var _sentence := PackedStringArray()
## True while `build()` is laying a figure out: its windows are added and nothing is drawn.
var _building := false
## True while a figure is being drawn as a tile's picture: no names on it.
var _bare := false
## The topic last read, for the grid to put the focus back on.
var _last := 0
## Where the focus goes after a turn, and whether its marker was showing.
var _focus_prev := false
var _focus_shown := false


## Help is one of the two pages a player goes to when something is wrong.
func show_feedback() -> bool:
	return true


func _ready() -> void:
	super()
	# A figure's window draws itself once; the stroke weights follow the window's size.
	get_viewport().size_changed.connect(func() -> void:
		for f in _frames:
			if is_instance_valid(f):
				f.queue_redraw())


# ── Where the reader is ─────────────────────────────────────────────────────────────────

## The topic being read, or -1 on the grid.
func _topic() -> int:
	return clampi(int(app.memo.get("help_topic", -1)), -1, TOPICS.size() - 1)


func _slides(topic: int) -> Array:
	return TOPICS[topic][2]


func _slide() -> int:
	return clampi(int(app.memo.get("help_slide", 0)), 0, _slides(maxi(0, _topic())).size() - 1)


func _open(topic: int, slide: int) -> void:
	var holder := get_viewport().gui_get_focus_owner()
	_focus_shown = holder != null and holder.has_focus(true)
	_focus_prev = holder != null and holder == _prev
	if _topic() >= 0:
		_last = _topic()
	app.memo["help_topic"] = topic
	app.memo["help_slide"] = slide
	rebuild()


## One slide on or back. Past a topic's last slide is the next topic; past the last of all, the grid.
func _turn(step: int) -> void:
	var topic := _topic()
	if topic < 0:
		return
	var slide := _slide() + step
	if slide >= _slides(topic).size():
		topic = topic + 1 if topic + 1 < TOPICS.size() else -1
		slide = 0
	elif slide < 0:
		if topic == 0:
			return
		topic -= 1
		slide = _slides(topic).size() - 1
	_open(topic, slide)


# ── Controls ────────────────────────────────────────────────────────────────────────────

func build() -> void:
	# A memo from the old manual: its page number, turned into the topic that page became.
	if app.memo.has("help_page"):
		var old: Variant = app.memo["help_page"]
		app.memo.erase("help_page")
		if (old is int or old is float) and not app.memo.has("help_topic"):
			app.memo["help_topic"] = OLD_PAGES[clampi(int(old), 0, OLD_PAGES.size() - 1)]
			app.memo["help_slide"] = 0
	status = ""
	_frames.clear()
	_tiles.clear()
	_prev = null
	_next = null
	var topic := _topic()
	var ways: Array = []
	if topic >= 0:
		ways.append(["Topics", _open.bind(-1, 0)])
	# Help is reachable from the pause panel, and the way in needs a way back.
	if app.pick_active():
		ways.append(["Back to the lock", func() -> void: app.goto(&"pause")])
	ways.append(["Menu", func() -> void: app.goto(&"menu")])
	# The same corner and the same order as `nav()` gives every screen, but a thumb tall.
	var x := LEFT + WIDTH + WAY_GAP
	var boxes: Array[Rect2] = []
	for i in range(ways.size() - 1, -1, -1):
		var w := Kit.box_for(str(ways[i][0]), T_WAY, 190.0, WAY_H).x
		x -= w + WAY_GAP
		boxes.push_front(Rect2(x, WAY_Y, w, WAY_H))
	for i in ways.size():
		Kit.button(self, boxes[i], str(ways[i][0]), ways[i][1], false, T_WAY)
	_building = true
	if topic < 0:
		_build_grid()
	else:
		_build_slide(topic, _slide())
	_building = false
	_bare = false


func _build_grid() -> void:
	title = "Help"
	accessibility_name = "Help"
	accessibility_description = "%d topics. Choose one to read its slides." % TOPICS.size()
	for i in TOPICS.size():
		var box := _tile_rect(i)
		_tiles.append(Kit.card(self, box, _open.bind(i, 0), false, str(TOPICS[i][0]), "%d slides" % _slides(i).size()))
		_bare = true
		call(TOPICS[i][1], _tile_picture(box))
	_tiles[clampi(_last, 0, _tiles.size() - 1)].grab_focus.call_deferred(not _focus_shown)


func _build_slide(topic: int, slide: int) -> void:
	var slides := _slides(topic)
	var shown: Array = slides[slide]
	title = str(TOPICS[topic][0])
	accessibility_name = "Help: %s" % title
	# The figure is painted; this is the slide for someone who cannot see it.
	accessibility_description = "Slide %d of %d. %s. %s" % [slide + 1, slides.size(), shown[0], shown[1]]
	_sentence = _even_lines(str(shown[1]), T_SENTENCE, TEXT_W)
	var last := slide == slides.size() - 1
	var onward := "Next →"
	var spoken := "Next slide"
	if last and topic == TOPICS.size() - 1:
		onward = "Topics"
		spoken = "Back to the topics"
	elif last:
		onward = "Next topic →"
		spoken = "Next topic: %s" % TOPICS[topic + 1][0]
	_prev = Kit.button(self, Rect2(LEFT, TURN_Y, TURN.x, TURN.y), "← Previous", _turn.bind(-1), false, T_NAME)
	_next = Kit.button(self, Rect2(LEFT + WIDTH - TURN.x, TURN_Y, TURN.x, TURN.y), onward, _turn.bind(1), true, T_NAME)
	Kit.describe(_prev, "Previous slide")
	Kit.describe(_next, spoken)
	if topic == 0 and slide == 0:
		_prev.disabled = true
		_prev.focus_mode = Control.FOCUS_NONE
	call(shown[2], FIG)
	# Hidden until the keyboard or a pad is steering — unless it was already showing.
	var target := _prev if _focus_prev and not _prev.disabled else _next
	target.grab_focus.call_deferred(not _focus_shown)


static func _tile_rect(i: int) -> Rect2:
	var rows := ceili(TOPICS.size() / float(TILE_COLS))
	var w := floorf((GRID.size.x - TILE_GAP * (TILE_COLS - 1)) / TILE_COLS)
	var h := floorf((GRID.size.y - TILE_GAP * (rows - 1)) / rows)
	return Rect2(GRID.position.x + (i % TILE_COLS) * (w + TILE_GAP), GRID.position.y + int(i / float(TILE_COLS)) * (h + TILE_GAP),
		w, h)


static func _tile_picture(tile: Rect2) -> Rect2:
	return Rect2(tile.position + Vector2(TILE_PAD, TILE_PAD), Vector2(TILE_PICTURE, tile.size.y - 2.0 * TILE_PAD))


## Left and Right turn the slides — unless the focus is up among the ways out, where they move
## along the row as they do everywhere else.
func _input(event: InputEvent) -> void:
	if _topic() < 0 or event is InputEventJoypadMotion:
		return
	var step := 0
	if event.is_action_pressed(&"ui_right"):
		step = 1
	elif event.is_action_pressed(&"ui_left"):
		step = -1
	if step == 0:
		return
	var holder := get_viewport().gui_get_focus_owner()
	if holder != null and holder != _prev and holder != _next:
		return
	get_viewport().set_input_as_handled()
	_turn(step)


## PgUp and PgDn, or a controller's bumpers, turn the slides from anywhere; backing out of a
## topic goes to the grid, and from the grid to wherever Help was opened from.
func _unhandled_input(event: InputEvent) -> void:
	if _topic() >= 0:
		if event.is_action_pressed(&"ui_cancel"):
			get_viewport().set_input_as_handled()
			_open(-1, 0)
			return
		var step := 0
		if event.is_action_pressed(&"ui_page_down"):
			step = 1
		elif event.is_action_pressed(&"ui_page_up"):
			step = -1
		elif event is InputEventJoypadButton and (event as InputEventJoypadButton).pressed:
			match (event as InputEventJoypadButton).button_index:
				JOY_BUTTON_RIGHT_SHOULDER:
					step = 1
				JOY_BUTTON_LEFT_SHOULDER:
					step = -1
		if step != 0:
			get_viewport().set_input_as_handled()
			_turn(step)
			return
	super(event)


# ── Paint ───────────────────────────────────────────────────────────────────────────────

func paint() -> void:
	var topic := _topic()
	if topic < 0:
		for i in TOPICS.size():
			var tile := _tile_rect(i)
			var x := tile.position.x + TILE_PAD * 2.0 + TILE_PICTURE
			var lines := _caps_lines(str(TOPICS[i][0]), T_TILE, tile.end.x - TILE_PAD - x)
			var y := tile.get_center().y + T_TILE * 0.36 - (lines.size() - 1) * (T_TILE + 10.0) / 2.0
			for j in lines.size():
				tracked(Vector2(x, y + j * (T_TILE + 10.0)), lines[j], T_TILE, Pal.INK, HORIZONTAL_ALIGNMENT_LEFT, true)
			_bare = true
			call(TOPICS[i][1], _tile_picture(tile))
			_bare = false
		return
	var slides := _slides(topic)
	var shown: Array = slides[_slide()]
	var mid := LEFT + WIDTH / 2.0
	tracked(Vector2(mid, HEAD_Y), str(shown[0]), T_HEAD, Pal.INK, HORIZONTAL_ALIGNMENT_CENTER, true)
	for i in _sentence.size():
		plain(Vector2(mid, SENTENCE_Y + i * SENTENCE_LINE), _sentence[i], T_SENTENCE, Pal.INK, HORIZONTAL_ALIGNMENT_CENTER)
	tracked(Vector2(mid, COUNT_Y), "%d of %d" % [_slide() + 1, slides.size()], T_NAME, Pal.INK_LIGHT,
		HORIZONTAL_ALIGNMENT_CENTER)
	call(shown[2], FIG)


## Running text in as few lines as `max_width` allows, and those of about one length: a
## sentence is not left with a last line of one word.
static func _even_lines(words: String, size: int, max_width: float) -> PackedStringArray:
	var lines := wrap_text(words, size, max_width)
	var width := max_width - 40.0
	while width > 200.0:
		var narrower := wrap_text(words, size, width)
		if narrower.size() > lines.size():
			break
		lines = narrower
		width -= 40.0
	return lines


## A name in spaced capitals, broken into lines no wider than `max_width`.
static func _caps_lines(words: String, size: int, max_width: float) -> PackedStringArray:
	var out := PackedStringArray()
	var line := ""
	for word in words.split(" "):
		var longer := word if line == "" else line + " " + word
		if line != "" and Pal.text_width(longer.to_upper(), size, true, size * 0.08) > max_width:
			out.append(line)
			line = word
		else:
			line = longer
	if line != "":
		out.append(line)
	return out


# ── What a figure is made of ────────────────────────────────────────────────────────────
# Each of these does its own half of the two passes: the build pass adds windows, the paint
# pass draws over them.

## A clipped window on the stage that draws itself: `painter` is handed the Control to draw on.
func _frame(rect: Rect2, painter: Callable) -> void:
	var f := Control.new()
	f.position = rect.position
	f.size = rect.size
	f.clip_contents = true
	f.mouse_filter = Control.MOUSE_FILTER_IGNORE
	f.draw.connect(func() -> void: painter.call(f))
	add_child(f)
	_frames.append(f)


## The side cutaway of `pose`, as large as fits `area`, from `above` mm over the shear line to
## `below` mm under it. Returns { o, k, box }: where the keyway's mouth meets the line, the px
## per mm, and the window.
func _side(area: Rect2, pose: Dictionary, above: float, below: float) -> Dictionary:
	var count: int = (pose["pins"] as Array).size()
	var lead := TOOL_LEAD if float(pose["pick"]) >= 0.0 else HelpFigure.SIDE_PAD
	var mm := Vector2(lead + HelpFigure.depth(count) + HelpFigure.SIDE_PAD, above + below)
	var k := minf(area.size.x / mm.x, area.size.y / mm.y)
	var box := Rect2(area.get_center() - mm * k / 2.0, mm * k)
	if _building:
		_frame(box, func(c: Control) -> void: HelpFigure.side(c, Vector2(lead, above) * k, k, pose))
	return {"o": box.position + Vector2(lead, above) * k, "k": k, "box": box}


## Chamber `pin` of `pose` from the lock's face: `across` mm wide, from `above` mm over the
## shear line to `below` under it. Returns { o, k, box }, `o` where the bore's axis meets the line.
func _front(area: Rect2, pose: Dictionary, pin: int, above: float, below: float, across: float) -> Dictionary:
	var mm := Vector2(across, above + below)
	var k := minf(area.size.x / mm.x, area.size.y / mm.y)
	var box := Rect2(area.get_center() - mm * k / 2.0, mm * k)
	if _building:
		_frame(box, func(c: Control) -> void:
			HelpFigure.front(c, Rect2(Vector2.ZERO, c.size), Vector2(c.size.x / 2.0, above * k), k, pose, pin))
	return {"o": box.position + Vector2(box.size.x / 2.0, above * k), "k": k, "box": box}


## A point of a figure on the stage: `x` mm to the right of its origin, `y` mm above the line.
static func _at(fig: Dictionary, x: float, y: float) -> Vector2:
	return (fig["o"] as Vector2) + Vector2(x, -y) * float(fig["k"])


## A part's name, set beside the figure and level with the part, with a line in to it.
func _name(fig: Dictionary, at: Vector2, words: String, side: int, ink: Color = Pal.INK) -> void:
	if _building or _bare:
		return
	var box: Rect2 = fig["box"]
	var x := box.end.x + 52.0 if side > 0 else box.position.x - 52.0
	var from := Vector2(x - side * 14.0, at.y)
	# The line crosses the drawing on a strip of paper, so the hatch under it cannot argue.
	pen.draw_line(from, at, Pal.PAPER, 8.0)
	pen.draw_line(from, at, ink, Pal.STROKE)
	pen.draw_circle(at, 9.0, Pal.PAPER)
	pen.draw_circle(at, 6.0, ink)
	tracked(Vector2(x, at.y + T_NAME * 0.36), words, T_NAME, ink,
		HORIZONTAL_ALIGNMENT_LEFT if side > 0 else HORIZONTAL_ALIGNMENT_RIGHT, true)


## The way the wrench turns the plug in a front view (anticlockwise, as on the bench) — or the
## way it is eased `back`.
func _turn_arrow(fig: Dictionary, back: bool = false) -> void:
	if _building:
		return
	var k: float = fig["k"]
	var axis := -sqrt(pow(PinSession.PLUG_RADIUS, 2.0) - pow(FrontArt.bore(), 2.0))
	var a0 := deg_to_rad(-40.0)
	var a1 := deg_to_rad(-63.0)
	HelpFigure.arc_arrow(pen, _at(fig, 0.0, axis), (PinSession.PLUG_RADIUS - 1.3) * k, a1 if back else a0,
		a0 if back else a1, Pal.INK, maxf(3.0, k * 0.07), maxf(10.0, k * 0.3))


## The wrench at dial step `step`, N at the plug's rim.
static func _wrench(step: int = 5) -> float:
	return PinSession.wrench_newtons(PinSession.tension_for_step(step))


## How much further the plug slides before the `n`-th pin to bind is pinched, mm — the game's own.
static func _relief(n: int) -> float:
	return LockRig.BIND_STEP * n


## Three plain pins. The third binds first, then the first, then the second — so the pin being
## worked is the one nearest the names on the right.
static func _three() -> Dictionary:
	return HelpFigure.pose([HelpFigure.pin("standard", 1.5, _relief(1)), HelpFigure.pin("standard", 1.2, _relief(2)),
		HelpFigure.pin("standard", 2.0, _relief(0))])


## The same lock with the wrench on: the third pin pinched.
static func _bound() -> Dictionary:
	var base := _three()
	return HelpFigure.alter(base, {"shift": HelpFigure.bind_at(base["pins"][2]), "wrench": _wrench()},
		{2: {"state": LockRig.BINDING}})


## A side cutaway with the pick in the keyway.
func _picked(area: Rect2, pose: Dictionary) -> Dictionary:
	return _side(area, pose, 5.6, 11.0)


# ── The lock ────────────────────────────────────────────────────────────────────────────

func _fig_parts(area: Rect2) -> void:
	var fig := _side(area, _three(), 7.4, 7.2)
	var x := HelpFigure.chamber_x(0) - 0.7
	_name(fig, _at(fig, 1.0, 4.6), "shell", WEST)
	_name(fig, _at(fig, x, 1.3), "driver pin", WEST)
	_name(fig, _at(fig, x, -3.0), "key pin", WEST)
	_name(fig, _at(fig, HelpFigure.depth(3), 0.0), "shear line", EAST)
	_name(fig, _at(fig, HelpFigure.depth(3) - 1.0, -2.6), "plug", EAST)


## One pin: across the line with the wrench on, or lifted to it and the plug turned.
static func _one(open: bool) -> Dictionary:
	var base := HelpFigure.pose([HelpFigure.pin("standard", 1.8, _relief(0))])
	var first: Dictionary = base["pins"][0]
	if open:
		return HelpFigure.alter(base, {"shift": HelpFigure.bind_at(first) + LockRig.BIND_STEP, "wrench": _wrench(), "turn": 0.39},
			{0: HelpFigure.set_at(first, 1.8)})
	return HelpFigure.alter(base, {"shift": HelpFigure.bind_at(first), "wrench": _wrench()}, {0: {"state": LockRig.BINDING}})


func _fig_blocked(area: Rect2) -> void:
	var fig := _front(area, _one(false), 0, 4.4, 4.4, 11.0)
	_name(fig, _at(fig, -3.6, 2.6), "shell", WEST)
	_name(fig, _at(fig, -3.6, -2.6), "plug", WEST)
	_name(fig, _at(fig, -0.3, 1.5), "driver pin", EAST)
	_name(fig, _at(fig, 5.2, 0.0), "shear line", EAST)
	_turn_arrow(fig)


func _fig_open(area: Rect2) -> void:
	var fig := _front(area, _one(true), 0, 4.8, 6.4, 13.0)
	_name(fig, _at(fig, -0.5, 2.4), "driver pin", EAST)
	_name(fig, _at(fig, -2.4, -2.2), "key pin", WEST)
	_turn_arrow(fig)


# ── Binding and setting ─────────────────────────────────────────────────────────────────

func _fig_bind(area: Rect2) -> void:
	var pose := _bound()
	var fig := _front(area, pose, 2, 4.4, 4.4, 11.0)
	_name(fig, _at(fig, -0.6, 1.6), "binding pin", WEST, Pal.AMBER_TEXT)
	# Where the plug's edge has come round to: the bore's wall, less what the plug is drawn turned.
	_name(fig, _at(fig, FrontArt.bore() - FrontArt.drawn(float(pose["shift"])), 0.0), "pinched here", EAST, Pal.CRIMSON_TEXT)
	_turn_arrow(fig)


func _fig_lift(area: Rect2) -> void:
	var pose := HelpFigure.alter(_bound(), {"pick": 2.0, "pick_lift": 0.8, "push": 1.4},
		{2: HelpFigure.lifted(0.8, LockRig.BINDING)})
	var fig := _picked(area, pose)
	_name(fig, _at(fig, HelpFigure.chamber_x(2) + 0.6, 1.8), "binding pin", EAST, Pal.AMBER_TEXT)
	_name(fig, _at(fig, -1.2, HelpFigure.tip_rest() + 0.8 - 3.3), "pick", WEST)


func _fig_set(area: Rect2) -> void:
	var base := _three()
	var pins: Array = base["pins"]
	var pose := HelpFigure.alter(base, {"shift": HelpFigure.bind_at(pins[0]), "wrench": _wrench(), "pick": 2.0},
		{0: {"state": LockRig.BINDING}, 2: HelpFigure.set_at(pins[2])})
	var fig := _picked(area, pose)
	_name(fig, _at(fig, HelpFigure.chamber_x(2) + 0.6, 2.2), "set", EAST, Pal.TEAL_TEXT)
	_name(fig, _at(fig, HelpFigure.chamber_x(0) - 0.6, 1.2), "binds next", WEST, Pal.AMBER_TEXT)


func _fig_overset(area: Rect2) -> void:
	var pose := HelpFigure.alter(_bound(), {"pick": 2.0, "pick_lift": 2.55, "push": 3.0},
		{2: HelpFigure.lifted(2.55, LockRig.OVERSET)})
	var fig := _picked(area, pose)
	_name(fig, _at(fig, HelpFigure.chamber_x(2) + 0.6, 0.28), "jammed in the shell", EAST, Pal.CRIMSON_TEXT)


func _fig_reset(area: Rect2) -> void:
	var fig := _picked(area, HelpFigure.alter(_three(), {"pick": 2.0}))
	if _building:
		return
	# Every pin back down: an arrow in the brass beside each bore.
	var k: float = fig["k"]
	for i in 3:
		var x := HelpFigure.chamber_x(i) + LockRig.PITCH / 2.0
		HelpFigure.arrow(pen, _at(fig, x, 4.6), _at(fig, x, 1.6), Pal.INK, maxf(3.0, k * 0.12), maxf(10.0, k * 0.5))


# ── Wrench pressure ─────────────────────────────────────────────────────────────────────

func _fig_dial(area: Rect2) -> void:
	if _building:
		return
	const STEP := 5
	var w := minf(area.size.x, 1240.0)
	var h := roundf(w * 0.1)
	var at := area.get_center() - Vector2(w, h) / 2.0
	HelpFigure.meter(pen, at, w, PinSession.tension_for_step(STEP), Pal.AMBER, 10, h)
	if _bare:
		return
	tracked(at + Vector2(0.0, -24.0), "wrench — pressure %d of 10" % STEP, T_NAME, Pal.INK, HORIZONTAL_ALIGNMENT_LEFT, true)
	# The key for each step, under its segment.
	var seg := (w - 4.0 * 9.0) / 10.0
	for n in 10:
		var label := str((n + 1) % 10)
		var cap := HelpFigure.keycap_width(label, T_HEAD)
		HelpFigure.keycap(pen, at + Vector2(n * (seg + 4.0) + (seg - cap) / 2.0, h + 28.0), label, T_HEAD, n + 1 == STEP)


func _fig_heavy_light(area: Rect2) -> void:
	if _building:
		return
	const W := 1000.0
	const H := 96.0
	var x := area.get_center().x - W / 2.0
	var rows: Array = [[8, "heavy — pressure 8"], [3, "light — pressure 3"]]
	for i in rows.size():
		var y := area.position.y + area.size.y * (0.27 + 0.4 * i)
		tracked(Vector2(x, y - 24.0), str(rows[i][1]), T_NAME, Pal.INK, HORIZONTAL_ALIGNMENT_LEFT, true)
		HelpFigure.meter(pen, Vector2(x, y), W, PinSession.tension_for_step(int(rows[i][0])), Pal.AMBER, 10, H)


# ── Security pins ───────────────────────────────────────────────────────────────────────

## A row of drivers standing on their own, each in its state's colour with its name under it.
## Returns { o, k, box, pitch }: the first driver's centre, the px per mm, and the row's box.
func _drivers(area: Rect2, profiles: Array, names: Array, states: Array = []) -> Dictionary:
	const GAP := 2.2
	var n := profiles.size()
	var room := 0.0 if _bare else 64.0
	var across := n * 2.0 * LockRig.PIN_R + (n - 1) * GAP
	var k := minf(100.0, minf(area.size.x / (across + 0.4), (area.size.y - room) / (Profiles.DRIVER_LENGTH + 0.4)))
	var pitch := (2.0 * LockRig.PIN_R + GAP) * k
	var first := Vector2(area.get_center().x - pitch * (n - 1) / 2.0, area.position.y + (area.size.y - room) / 2.0)
	var half := Vector2(LockRig.PIN_R, Profiles.DRIVER_LENGTH / 2.0) * k
	if _building:
		_frame(area, func(c: Control) -> void:
			for i in n:
				var state: int = states[i] if i < states.size() else LockRig.FREE
				HelpFigure.driver(c, first - area.position + Vector2(i * pitch, 0.0), k, str(profiles[i]), Pal.state_color(state)))
	elif not _bare:
		for i in n:
			var ink := Pal.state_text_color(int(states[i])) if i < states.size() and int(states[i]) != LockRig.FREE else Pal.INK
			tracked(first + Vector2(i * pitch, half.y + 50.0), str(names[i]), T_NAME, ink, HORIZONTAL_ALIGNMENT_CENTER, true)
	return {"o": first, "k": k, "pitch": pitch, "box": Rect2(first - half, Vector2(pitch * (n - 1), 0.0) + half * 2.0)}


func _fig_spool(area: Rect2) -> void:
	var fig := _drivers(area, ["standard", "spool"], ["plain driver", "spool"])
	# The waist: the reduced band a little way up from the foot.
	var waist: Array = Profiles.grooves("spool")[0]
	var up := (float(waist[0]) + float(waist[1])) / 2.0 - Profiles.DRIVER_LENGTH / 2.0
	var in_by := LockRig.PIN_R * (1.0 - Profiles.max_groove_depth("spool"))
	_name(fig, (fig["o"] as Vector2) + Vector2(float(fig["pitch"]) + in_by * float(fig["k"]), -up * float(fig["k"])),
		"waist", EAST, Pal.VIOLET_TEXT)


## A plain pin and a spool: the spool caught in its false set, or the plug `eased` back off it.
static func _spooled(eased: bool) -> Dictionary:
	var base := HelpFigure.pose([HelpFigure.pin("standard", 1.4, _relief(1)), HelpFigure.pin("spool", 2.0, _relief(0))])
	var spool: Dictionary = base["pins"][1]
	if eased:
		return HelpFigure.alter(base, {"shift": HelpFigure.bind_at(spool) - 0.02, "wrench": _wrench()},
			{1: HelpFigure.lifted(1.75, LockRig.BINDING)})
	# The plug has turned on into the waist, as far as the cut-back under its bore's edge lets it.
	return HelpFigure.alter(base, {"shift": HelpFigure.bind_at(spool) + LockRig.RIM_RELIEF, "wrench": _wrench()},
		{1: HelpFigure.lifted(1.38, LockRig.FALSE_SET)})


func _fig_false_set(area: Rect2) -> void:
	var fig := _front(area, _spooled(false), 1, 4.4, 4.4, 11.0)
	_name(fig, _at(fig, -0.9, 0.35), "waist", WEST, Pal.VIOLET_TEXT)
	_name(fig, _at(fig, 0.6, 2.4), "false set", EAST, Pal.VIOLET_TEXT)
	_turn_arrow(fig)


func _fig_ease(area: Rect2) -> void:
	var fig := _front(area, _spooled(true), 1, 4.4, 4.4, 11.0)
	_name(fig, _at(fig, 3.15, -2.2), "plug eased back", EAST)
	_turn_arrow(fig, true)


func _fig_others(area: Rect2) -> void:
	_drivers(area, ["serrated", "mushroom", "t-pin"], ["serrated", "mushroom", "t-pin"])


func _fig_sidebar(area: Rect2) -> void:
	var base := _three()
	var pins: Array = base["pins"]
	pins[0]["gate"] = [-0.5, -0.14]
	pins[2]["gate"] = [-0.62, -0.26]
	# Every pin set, and the first key pin lifted back up into its gate.
	var pose := HelpFigure.alter(base, {"shift": HelpFigure.bind_at(pins[1]) + LockRig.BIND_STEP, "wrench": _wrench(),
		"pick": 0.0, "pick_lift": 1.2, "push": 0.4},
		{0: HelpFigure.set_at(pins[0], 1.2), 1: HelpFigure.set_at(pins[1]), 2: HelpFigure.set_at(pins[2])})
	pose["pins"][0]["met"] = true
	var fig := _picked(area, pose)
	# Just clear of the marks cut either side of the bore.
	var edge := LockRig.PIN_R + 0.62
	_name(fig, _at(fig, HelpFigure.chamber_x(0) - edge, -0.32), "in its gate", WEST, Pal.TEAL_TEXT)
	_name(fig, _at(fig, HelpFigure.chamber_x(2) + edge, -0.44), "gate", EAST, Pal.VIOLET_TEXT)


# ── Reading the screen ──────────────────────────────────────────────────────────────────

## The two columns beside the lock, on a binding pin.
func _fig_columns(area: Rect2) -> void:
	if _building:
		return
	const FORCE := 0.14
	const RESISTANCE := 0.33
	var top := 0.0 if _bare else 112.0
	var foot := 0.0 if _bare else 54.0
	var h := area.size.y - top - foot
	var w := roundf(h * 0.26)
	var gap := w * (0.8 if _bare else 2.6)
	var x := area.get_center().x - w - gap / 2.0
	var bottom := area.position.y + top + h
	var ink := Pal.state_text_color(LockRig.BINDING)
	HelpFigure.column(pen, x, bottom, h, FORCE, Color(Pal.INK_LIGHT, 0.7), w)
	HelpFigure.column(pen, x + w + gap, bottom, h, RESISTANCE, ink, w)
	if _bare:
		return
	var mids: Array[float] = [x + w / 2.0, x + w + gap + w / 2.0]
	plain(Vector2(mids[0], bottom - h - 18.0), "%.2f" % FORCE, T_HEAD, Pal.INK, HORIZONTAL_ALIGNMENT_CENTER)
	plain(Vector2(mids[1], bottom - h - 18.0), "%.2f" % RESISTANCE, T_HEAD, ink, HORIZONTAL_ALIGNMENT_CENTER)
	tracked(Vector2(mids[1], bottom - h - 72.0), "binding", T_NAME, ink, HORIZONTAL_ALIGNMENT_CENTER, true)
	tracked(Vector2(mids[0], bottom + 44.0), "force", T_NAME, Pal.INK, HORIZONTAL_ALIGNMENT_CENTER, true)
	tracked(Vector2(mids[1], bottom + 44.0), "resistance", T_NAME, Pal.INK, HORIZONTAL_ALIGNMENT_CENTER, true)


func _fig_colours(area: Rect2) -> void:
	_drivers(area, ["standard", "standard", "spool", "standard", "standard"], STATE_WORDS,
		[LockRig.FREE, LockRig.BINDING, LockRig.FALSE_SET, LockRig.SET, LockRig.OVERSET])


func _fig_plug_bar(area: Rect2) -> void:
	if _building:
		return
	const W := 1100.0
	const H := 100.0
	var at := area.get_center() - Vector2(W, H) / 2.0
	HelpFigure.meter(pen, at, W, 0.6, Pal.INK, 10, H)
	# The opening threshold, as a notch above the bar: a line the fill has to reach.
	var notch := at.x + W * 0.98
	pen.draw_line(Vector2(notch, at.y - 40.0), Vector2(notch, at.y - 6.0), Pal.INK, Pal.HEAVY * 2.0)
	tracked(at + Vector2(0.0, -24.0), "plug", T_NAME, Pal.INK, HORIZONTAL_ALIGNMENT_LEFT, true)
	tracked(Vector2(notch - 18.0, at.y - 24.0), "the notch", T_NAME, Pal.INK, HORIZONTAL_ALIGNMENT_RIGHT, true)


# ── Controls ────────────────────────────────────────────────────────────────────────────

## A row of key caps and the words between them: anything in [square brackets] is a cap.
## Draws from `at`, the caps' top-left, when `inked`; returns the width either way.
func _caps(at: Vector2, markup: String, size: int, inked: bool) -> float:
	var x := 0.0
	for piece in markup.split("["):
		var close := piece.find("]")
		var words := piece
		if close >= 0:
			var label := piece.left(close)
			if inked:
				HelpFigure.keycap(pen, at + Vector2(x, 0.0), label, size)
			x += HelpFigure.keycap_width(label, size)
			words = piece.substr(close + 1)
		if words != "":
			if inked:
				plain(at + Vector2(x, (size + 10.0) / 2.0 + size * 0.36), words, size, Pal.INK)
			x += Pal.text_width(words, size)
	return x


## A short list: the keys on the left, what each does beside it.
func _keys(area: Rect2, rows: Array) -> void:
	if _building:
		return
	const CAP := 38
	const BETWEEN := 36.0
	var pitch := minf(86.0, area.size.y / rows.size())
	var caps_w := 0.0
	var words_w := 0.0
	for row: Array in rows:
		caps_w = maxf(caps_w, _caps(Vector2.ZERO, str(row[0]), CAP, false))
		words_w = maxf(words_w, Pal.text_width(str(row[1]), T_SENTENCE))
	var x := area.get_center().x - (caps_w + BETWEEN + words_w) / 2.0
	var y := area.get_center().y - pitch * rows.size() / 2.0 + (pitch - CAP - 10.0) / 2.0
	for row: Array in rows:
		_caps(Vector2(x + caps_w - _caps(Vector2.ZERO, str(row[0]), CAP, false), y), str(row[0]), CAP, true)
		plain(Vector2(x + caps_w + BETWEEN, y + (CAP + 10.0) / 2.0 + T_SENTENCE * 0.36), str(row[1]), T_SENTENCE, Pal.INK)
		y += pitch


func _fig_keyboard(area: Rect2) -> void:
	_keys(area, KEYBOARD)


func _fig_mouse(area: Rect2) -> void:
	_keys(area, MOUSE)


func _fig_controller(area: Rect2) -> void:
	_keys(area, CONTROLLER)


func _fig_touch(area: Rect2) -> void:
	_keys(area, TOUCH)


func _fig_tile_keys(area: Rect2) -> void:
	if _building:
		return
	var labels: Array[String] = ["Q", "Space"]
	for i in labels.size():
		var w := HelpFigure.keycap_width(labels[i], T_SENTENCE)
		HelpFigure.keycap(pen, Vector2(area.get_center().x - w / 2.0, area.get_center().y - 54.0 + i * 64.0), labels[i], T_SENTENCE)


# ── Snap gun ────────────────────────────────────────────────────────────────────────────

## The gun in a plain lock on a light wrench: its needle under every pin.
static func _armed() -> Dictionary:
	var base := _three()
	base["gun"] = true
	base["pick"] = 2.0
	return HelpFigure.alter(base, {"shift": HelpFigure.bind_at(base["pins"][2]), "wrench": _wrench(2)},
		{2: {"state": LockRig.BINDING}})


func _gunned(area: Rect2, pose: Dictionary) -> Dictionary:
	return _side(area, pose, 5.6, 9.4)


## Where the needle's blade runs out of the keyway's mouth, with the needle drawn `back` mm.
func _needle_at(fig: Dictionary, back: float = 0.0) -> Vector2:
	return _at(fig, -1.2, HelpFigure.tip_rest() - 0.55 - back)


func _fig_gun_ready(area: Rect2) -> void:
	var fig := _gunned(area, _armed())
	_name(fig, _needle_at(fig), "needle", WEST)


func _fig_gun_draw(area: Rect2) -> void:
	const FLICK := 2.0
	var fig := _gunned(area, HelpFigure.alter(_armed(), {"flick": FLICK}))
	_name(fig, _needle_at(fig, FLICK * 0.7), "drawn back", WEST)
	if _building:
		return
	var k: float = fig["k"]
	for i in 3:
		var x := HelpFigure.chamber_x(i) - LockRig.PITCH / 2.0
		HelpFigure.arrow(pen, _at(fig, x, HelpFigure.tip_rest() - 0.1), _at(fig, x, HelpFigure.tip_rest() - 1.5), Pal.INK,
			maxf(3.0, k * 0.12), maxf(10.0, k * 0.5))


func _fig_gun_strike(area: Rect2) -> void:
	# A soft strike: one blade throws every driver the same short way, and none reaches the line.
	const THROW := 1.0
	var thrown := {}
	for i in 3:
		thrown[i] = {"driver": THROW, "key": THROW * 0.45, "state": LockRig.FREE}
	var fig := _gunned(area, HelpFigure.alter(_armed(), {}, thrown))
	_name(fig, _at(fig, HelpFigure.chamber_x(2) + 0.6, -0.5), "short of the line", EAST)


func _fig_gun_caught(area: Rect2) -> void:
	var base := HelpFigure.pose([HelpFigure.pin("spool", 1.6, _relief(2)), HelpFigure.pin("standard", 1.2, _relief(1)),
		HelpFigure.pin("standard", 2.0, _relief(0))])
	base["gun"] = true
	base["pick"] = 2.0
	var pins: Array = base["pins"]
	var pose := HelpFigure.alter(base, {"shift": HelpFigure.bind_at(pins[0]), "wrench": _wrench(2)},
		{0: {"state": LockRig.BINDING}, 1: HelpFigure.set_at(pins[1]), 2: HelpFigure.set_at(pins[2])})
	var fig := _gunned(area, pose)
	_name(fig, _at(fig, HelpFigure.chamber_x(0) - 0.6, 1.4), "spool: not caught", WEST)
	_name(fig, _at(fig, HelpFigure.chamber_x(2) + 0.6, 2.2), "caught", EAST, Pal.TEAL_TEXT)


# ── Combination wheels ──────────────────────────────────────────────────────────────────

## The wheel pack down its axle, as large as fits `area`. Returns { o, k, box, band }: the axle,
## the front wheel's radius in px, and the pack's box.
func _pack(area: Rect2, first: Dictionary, second_state: int, opts: Dictionary) -> Dictionary:
	var wheels: Array = [first, {"gate": 4.0, "lies": [5.3], "state": second_state},
		{"gate": 1.1, "lies": [], "state": LockRig.FREE}]
	var radius := floorf((area.size.y - 8.0) / 3.1)
	var band := radius * 0.16
	var outer := radius + band * (wheels.size() - 1)
	var centre := Vector2(area.get_center().x, area.end.y - outer - 4.0)
	var box := Rect2(centre.x - outer - 4.0, area.position.y, outer * 2.0 + 8.0, area.size.y)
	opts["pull"] = true
	if _building:
		_frame(box, func(c: Control) -> void: HelpFigure.pack(c, centre - box.position, radius, band, wheels, opts))
	return {"o": centre, "k": radius, "box": box, "band": band}


## A point on the pack: `angle` round from under the fence, `out` px from the axle.
static func _on_pack(fig: Dictionary, angle: float, out: float) -> Vector2:
	return (fig["o"] as Vector2) + Vector2.from_angle(angle - PI / 2.0) * out


func _fig_pack_pull(area: Rect2) -> void:
	var fig := _pack(area, {"gate": GATE_AT, "lies": [LIE_AT], "state": LockRig.BINDING}, LockRig.FREE, {"top_digit": 4})
	var r: float = fig["k"]
	_name(fig, _on_pack(fig, 0.0, r * 1.06), "tooth", EAST, Pal.AMBER_TEXT)
	_name(fig, _on_pack(fig, LIE_AT, r * 0.97), "false gate", EAST, Pal.VIOLET_TEXT)
	_name(fig, _on_pack(fig, GATE_AT, r * 0.9), "gate", WEST, Pal.TEAL_TEXT)


func _fig_pack_lie(area: Rect2) -> void:
	var fig := _pack(area, {"gate": GATE_AT - LIE_AT, "lies": [0.0], "state": LockRig.FALSE_SET}, LockRig.FREE,
		{"top_digit": 7})
	_name(fig, _on_pack(fig, 0.0, float(fig["k"]) * 0.97), "caught in a false gate", EAST, Pal.VIOLET_TEXT)


func _fig_pack_gate(area: Rect2) -> void:
	var fig := _pack(area, {"gate": 0.0, "lies": [LIE_AT - GATE_AT], "state": LockRig.SET}, LockRig.BINDING,
		{"top_digit": 1, "picked": 1})
	var r: float = fig["k"]
	_name(fig, _on_pack(fig, 0.0, r * 0.86), "in its gate", EAST, Pal.TEAL_TEXT)
	_name(fig, _on_pack(fig, -PI / 2.0, r + float(fig["band"])), "drags next", WEST, Pal.AMBER_TEXT)


# ── Disc detainers ──────────────────────────────────────────────────────────────────────

## Three discs as the lessons' lock has them: the second binds first, then the first, then the third.
static func _discs() -> Dictionary:
	return DiscArt.pose([DiscArt.disc(2, [], 1), DiscArt.disc(4, [2], 0), DiscArt.disc(3, [], 2)])


## A copy of a disc pose with `changes` laid over it, and `discs` ({index: {…}}) over its discs.
static func _disc_alter(base: Dictionary, changes: Dictionary, discs: Dictionary = {}) -> Dictionary:
	var p := base.duplicate(true)
	p.merge(changes, true)
	for i: int in discs:
		(p["discs"][i] as Dictionary).merge(discs[i], true)
	return p


## How far the sleeve has turned by the time the bar's foot has come down to `foot`, mm.
static func _sleeve_for(foot: float) -> float:
	return DiscRig.TAKE_UP + (DiscRig.BAR_LIFT - foot) * DiscRig.RAMP_RUN / DiscRig.GROOVE


## The slice through disc `i` of `pose`, as large as fits `area`. Returns { o, k, box }, `o` the axis.
func _disc_front(area: Rect2, pose: Dictionary, i: int) -> Dictionary:
	var reach := (DiscArt.BODY_R + DiscArt.PAD) * 2.0
	var k := minf(area.size.x / reach, area.size.y / reach)
	var box := Rect2(area.get_center() - Vector2(reach, reach) * k / 2.0, Vector2(reach, reach) * k)
	if _building:
		_frame(box, func(c: Control) -> void: DiscArt.front(c, c.size / 2.0, k, pose, i))
	return {"o": box.get_center(), "k": k, "box": box}


## The pack of `pose` from the side, as large as fits `area`. Returns { o, k, box }, `o` where the
## keyway's mouth meets the axis.
func _disc_side(area: Rect2, pose: Dictionary) -> Dictionary:
	var count: int = (pose["discs"] as Array).size()
	var lead := TOOL_LEAD if int(pose["pick"]) >= 0 else DiscArt.PAD
	var mm := Vector2(lead + DiscArt.FACE_T + DiscArt.depth(count) + DiscArt.BACK_T + DiscArt.PAD, (DiscArt.BODY_R + DiscArt.PAD) * 2.0)
	var k := minf(area.size.x / mm.x, area.size.y / mm.y)
	var box := Rect2(area.get_center() - mm * k / 2.0, mm * k)
	var origin := Vector2(lead + DiscArt.FACE_T, DiscArt.BODY_R + DiscArt.PAD) * k
	if _building:
		_frame(box, func(c: Control) -> void: DiscArt.side(c, origin, k, pose))
	return {"o": box.position + origin, "k": k, "box": box}


## A point of a disc's slice on the stage: `r` mm from the axis, `clockwise` rad round from the bar.
static func _on_disc(fig: Dictionary, r: float, clockwise: float) -> Vector2:
	return (fig["o"] as Vector2) + Vector2(sin(clockwise), -cos(clockwise)) * r * float(fig["k"])


## The way a disc is turned: anticlockwise, as the plug turns on the bench.
func _disc_turn_arrow(fig: Dictionary) -> void:
	if _building or _bare:
		return
	var k: float = fig["k"]
	HelpFigure.arc_arrow(pen, fig["o"], 4.6 * k, deg_to_rad(-20.0), deg_to_rad(-75.0), Pal.INK, maxf(3.0, k * 0.16),
		maxf(10.0, k * 0.7))


func _fig_disc_tile(area: Rect2) -> void:
	_disc_front(area, _disc_alter(_discs(), {}, {1: {"turned": 1.4 * DiscRig.UNIT}}), 1)


func _fig_disc_parts(area: Rect2) -> void:
	var fig := _disc_side(area, _discs())
	var top := DiscArt.RIM_R + DiscRig.BAR_LIFT + DiscRig.BAR_H / 2.0
	_name(fig, _at(fig, DiscArt.disc_z(2.0) + 1.6, top), "the bar", EAST)
	_name(fig, _at(fig, DiscArt.disc_z(2.0), 4.4), "a disc", EAST)
	_name(fig, _at(fig, DiscArt.disc_z(0.0), 5.6), "its gate", WEST, Pal.TEAL_TEXT)
	_name(fig, _at(fig, DiscArt.disc_z(-0.5), -4.6), "a spacer", WEST)
	_name(fig, _at(fig, 0.6, DiscArt.BODY_R - 1.2), "body", WEST)
	_name(fig, _at(fig, DiscArt.disc_z(1.0), -(DiscArt.SLEEVE_IN_R + 1.0)), "sleeve", EAST)


func _fig_disc_gate(area: Rect2) -> void:
	var turned := 1.4 * DiscRig.UNIT
	var fig := _disc_front(area, _disc_alter(_discs(), {"pick": 2}, {2: {"turned": turned}}), 2)
	_name(fig, _on_disc(fig, DiscArt.RIM_R + DiscRig.BAR_LIFT + 1.4, 0.0), "the bar", WEST)
	_name(fig, _on_disc(fig, DiscArt.RIM_R - 0.5, (3.0 * DiscRig.UNIT - turned) / DiscArt.RIM_R), "gate", EAST, Pal.TEAL_TEXT)
	_name(fig, _on_disc(fig, DiscArt.SLEEVE_IN_R + 1.0, deg_to_rad(250.0)), "sleeve", WEST)
	_name(fig, _on_disc(fig, DiscArt.BODY_R - 1.4, deg_to_rad(300.0)), "body", WEST)
	_name(fig, _on_disc(fig, 1.6, deg_to_rad(100.0)), "the pick, in the key's slot", EAST)
	_disc_turn_arrow(fig)


func _fig_disc_bind(area: Rect2) -> void:
	var pose := _disc_alter(_discs(), {"pick": 1, "foot": 0.0, "shift": _sleeve_for(0.0), "wrench": _wrench()},
		{1: {"turned": 1.2 * DiscRig.UNIT, "state": LockRig.BINDING}})
	var fig := _disc_front(area, pose, 1)
	_name(fig, _on_disc(fig, DiscArt.RIM_R, 0.0), "the bar rests here", WEST, Pal.AMBER_TEXT)
	_name(fig, _on_disc(fig, DiscArt.RIM_R - 0.5, (4.0 - 1.2) * DiscRig.CUT_ANGLE), "its gate", EAST, Pal.TEAL_TEXT)
	_disc_turn_arrow(fig)


func _fig_disc_set(area: Rect2) -> void:
	var foot := -0.4
	var pose := _disc_alter(_discs(), {"pick": 1, "foot": foot, "shift": _sleeve_for(foot), "wrench": _wrench()},
		{1: {"turned": 4.0 * DiscRig.UNIT, "state": LockRig.SET}})
	var fig := _disc_front(area, pose, 1)
	_name(fig, _on_disc(fig, DiscArt.RIM_R + foot, 0.0), "in its gate", EAST, Pal.TEAL_TEXT)
	# The shallow one came up first, and has gone on over the top.
	_name(fig, _on_disc(fig, DiscArt.RIM_R - 0.2, -(4.0 - 2.0) * DiscRig.CUT_ANGLE), "false gate, passed", WEST, Pal.VIOLET_TEXT)


func _fig_disc_past(area: Rect2) -> void:
	var pose := _disc_alter(_discs(), {"pick": 1, "foot": 0.0, "shift": _sleeve_for(0.0), "wrench": _wrench()},
		{1: {"turned": 4.7 * DiscRig.UNIT, "state": LockRig.OVERSET}})
	var fig := _disc_front(area, pose, 1)
	_name(fig, _on_disc(fig, DiscArt.RIM_R, 0.0), "the bar, back on the rim", EAST, Pal.CRIMSON_TEXT)
	_name(fig, _on_disc(fig, DiscArt.RIM_R - 0.6, -0.7 * DiscRig.CUT_ANGLE), "its gate, gone past", WEST, Pal.TEAL_TEXT)
	if not _building and not _bare:
		# Back the other way: clockwise.
		var k: float = fig["k"]
		HelpFigure.arc_arrow(pen, fig["o"], 4.6 * k, deg_to_rad(-75.0), deg_to_rad(-20.0), Pal.INK, maxf(3.0, k * 0.16),
			maxf(10.0, k * 0.7))


func _fig_disc_stay(area: Rect2) -> void:
	# The wrench off: the bar up on its own spring, and each disc turned as far as it was left.
	var base := _discs()
	var pose := _disc_alter(base, {}, {
		0: {"turned": 2.0 * DiscRig.UNIT}, 1: {"turned": 4.0 * DiscRig.UNIT}, 2: {"turned": 1.3 * DiscRig.UNIT}})
	var fig := _disc_side(area, pose)
	var top := DiscArt.RIM_R + DiscRig.BAR_LIFT + DiscRig.BAR_H / 2.0
	_name(fig, _at(fig, DiscArt.disc_z(2.0) + 1.6, top), "the bar, lifted", EAST)
	_name(fig, _at(fig, DiscArt.disc_z(0.0), DiscArt.RIM_R - 0.25), "still under the bar", WEST, Pal.TEAL_TEXT)
	_name(fig, _at(fig, DiscArt.disc_z(2.0), DiscArt.RIM_R * cos((3.0 - 1.3) * DiscRig.CUT_ANGLE)), "still where it was left", EAST)


func _fig_disc_lie(area: Rect2) -> void:
	var foot := -DiscRig.FALSE_DEPTH
	var pose := _disc_alter(_discs(), {"pick": 1, "foot": foot, "shift": _sleeve_for(foot), "wrench": _wrench()},
		{1: {"turned": 2.0 * DiscRig.UNIT, "state": LockRig.FALSE_SET}})
	var fig := _disc_front(area, pose, 1)
	_name(fig, _on_disc(fig, DiscArt.RIM_R + foot, 0.0), "caught: this notch is shallow", WEST, Pal.VIOLET_TEXT)
	_name(fig, _on_disc(fig, DiscArt.RIM_R - 0.6, 2.0 * DiscRig.CUT_ANGLE), "the true gate", EAST, Pal.TEAL_TEXT)


func _fig_disc_open(area: Rect2) -> void:
	var foot := DiscRig.BAR_LIFT - DiscRig.GROOVE - 0.04
	var base := _discs()
	var all := {}
	for i in 3:
		all[i] = {"turned": float(base["discs"][i]["cut"]) * DiscRig.UNIT, "state": LockRig.SET}
	var pose := _disc_alter(base, {"pick": 1, "foot": foot, "shift": DiscRig.TAKE_UP + DiscRig.RAMP_RUN, "extra": 0.5}, all)
	var fig := _disc_front(area, pose, 1)
	_name(fig, _on_disc(fig, DiscArt.BORE_R + 0.5, 0.0), "the groove, empty", EAST)
	_name(fig, _on_disc(fig, DiscArt.RIM_R + 1.0, -0.5 - DiscRig.TAKE_UP / DiscArt.RIM_R), "the bar, clear of the body", WEST, Pal.TEAL_TEXT)


# ── Ranks and tiers ─────────────────────────────────────────────────────────────────────

static func _rank_ink(rank: int) -> Color:
	if rank > 4:
		return Pal.CRIMSON_TEXT
	if rank > 3:
		return Pal.INK
	if rank > 1:
		return Pal.AMBER_TEXT
	return Pal.TEAL_TEXT


func _fig_tile_rank(area: Rect2) -> void:
	if not _building:
		tracked(area.get_center() + Vector2(0.0, Pal.T_RANK * 0.36), Ranks.LETTERS[Ranks.S], Pal.T_RANK, _rank_ink(Ranks.S),
			HORIZONTAL_ALIGNMENT_CENTER, true)


## The clock as a bar of time cut into ranks, in multiples of par.
func _fig_rank_bar(area: Rect2) -> void:
	if _building:
		return
	const SPAN := 2.5
	const NOW := 0.72
	var bar := Rect2(area.position.x + 40.0, area.get_center().y - 70.0, area.size.x - 80.0, 140.0)
	# F has no end; it gets the stub past the last timed rank.
	var timed := bar.size.x * 0.9
	var from := 0.0
	var on := Ranks.index_for(NOW, 1.0)
	for i in Ranks.LETTERS.size():
		var to: float = Ranks.THROUGH[i] if i < Ranks.F else SPAN / 0.9
		var seg := Rect2(bar.position.x + timed * from / SPAN, bar.position.y, timed * (to - from) / SPAN, bar.size.y)
		Pal.box(pen, seg, Color(_rank_ink(i), 0.4 if i == on else 0.14))
		tracked(seg.get_center() + Vector2(0.0, T_HEAD * 0.36), Ranks.LETTERS[i], T_HEAD, _rank_ink(i),
			HORIZONTAL_ALIGNMENT_CENTER, true)
		from = to
	# The clock, running along the bar, and where par falls.
	var now_x := bar.position.x + timed * NOW / SPAN
	pen.draw_colored_polygon(PackedVector2Array([Vector2(now_x, bar.position.y - 6.0),
		Vector2(now_x - 16.0, bar.position.y - 34.0), Vector2(now_x + 16.0, bar.position.y - 34.0)]), Pal.INK)
	tracked(Vector2(now_x, bar.position.y - 50.0), "the clock", T_NAME, Pal.INK, HORIZONTAL_ALIGNMENT_CENTER, true)
	var par_x := bar.position.x + timed / SPAN
	pen.draw_line(Vector2(par_x, bar.end.y), Vector2(par_x, bar.end.y + 24.0), Pal.INK, Pal.HEAVY)
	tracked(Vector2(par_x, bar.end.y + 60.0), "par", T_NAME, Pal.INK, HORIZONTAL_ALIGNMENT_CENTER, true)


func _fig_tiers(area: Rect2) -> void:
	if _building:
		return
	const BOX := Vector2(250.0, 170.0)
	var gap := (area.size.x - BOX.x * Progress.MAX_TIER) / (Progress.MAX_TIER - 1)
	var mid := area.get_center().y
	for t in range(1, Progress.MAX_TIER + 1):
		var box := Rect2(area.position.x + (t - 1) * (BOX.x + gap), mid - BOX.y / 2.0, BOX.x, BOX.y)
		Pal.box(pen, box, Pal.PAPER_SHADE)
		tracked(box.get_center() + Vector2(0.0, T_HEAD * 0.36), "tier %d" % t, T_HEAD, Pal.INK, HORIZONTAL_ALIGNMENT_CENTER, true)
		if t < Progress.MAX_TIER:
			# What the next tier costs, on the way to it.
			HelpFigure.arrow(pen, Vector2(box.end.x + 20.0, mid + 14.0), Vector2(box.end.x + gap - 20.0, mid + 14.0), Pal.INK, 5.0, 22.0)
			tracked(Vector2(box.end.x + gap / 2.0, mid - 16.0), "%d locks" % Progress.opens_required_for(t + 1), T_NAME, Pal.INK,
				HORIZONTAL_ALIGNMENT_CENTER, true)
