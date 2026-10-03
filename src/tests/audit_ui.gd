extends SceneTree
## Headless: walk every menu screen in its main states and hold each interactive control to the
## project's accessibility rules. Exits 1 if anything fails.
##
##   godot --headless --path godot --fixed-fps 60 -s res://tests/audit_ui.gd [-- verbose]
##
## The rules, per control (a Button, a text field, a toggle, a slider):
##   size      at least MIN_TARGET stage px in both directions
##   name      a spoken name (`accessibility_name`) that is not empty
##   reach     reachable by Tab from the first control, without a pointer
##   stage     wholly on the 1920×1080 stage
##   apart     not overlapping another control
##   caption   its caption is lettered at CAPTION_MIN px or more (a caption shrunk to fit is unreadable)

const MIN_TARGET := 40.0
const CAPTION_MIN := 15

var _app: Node
var _steps: Array = []
var _at := -1
var _wait := 0
var _failures := 0
var _checked := 0
var _verbose := false


func _initialize() -> void:
	_verbose = OS.get_cmdline_user_args().has("verbose")
	var scene: PackedScene = load("res://main.tscn")
	_app = scene.instantiate()
	_app.progress = Progress.new(SaveStore.memory())
	root.add_child(_app)
	_steps = [
		["menu, first run", func() -> void: _app.goto(&"menu")],
		["tutorial, first run", func() -> void: _app.goto(&"tutorial")],
		["bench, before the first lesson", func() -> void: _app.goto(&"bench")],
		["settings", func() -> void: _app.goto(&"settings")],
		["editor, empty draft", func() -> void: _app.goto(&"editor")],
		["help", func() -> void: _app.goto(&"help")],
		["feedback", func() -> void: _app.open_feedback()],
		["blitz briefing", func() -> void: _app.goto(&"streak")],
		["trophies, none earned", func() -> void: _app.goto(&"trophies")],
		["menu, played in", func() -> void:
			_play_in()
			_app.goto(&"menu")],
		["tutorial, played in", func() -> void: _app.goto(&"tutorial")],
		["bench, tier 1", func() -> void: _bench(1)],
		["bench, a locked tier", func() -> void: _bench(4)],
		["bench, combination shelf", func() -> void: _bench(0)],
		["bench, disc detainer shelf", func() -> void: _bench(-3)],
		["bench, pick gun shelf", func() -> void: _bench(-1)],
		["bench, your locks", func() -> void: _bench(-2)],
		["trophies, some earned", func() -> void: _app.goto(&"trophies")],
		["editor, saved locks", func() -> void: _app.goto(&"editor")],
		["results", func() -> void: _results()],
		["blitz breather", func() -> void: _breather()],
		["blitz tally", func() -> void: _tally()],
		["pause", func() -> void:
			_app.start_lock(Roster.by_slug("northgate-5-pin-cabinet"))
			_app.goto(&"pause")],
		["settings, from the pause panel", func() -> void: _app.goto(&"settings")],
		["feedback, from the pause panel", func() -> void: _app.open_feedback()],
		["help, from the pause panel", func() -> void: _app.goto(&"help")],
	]
	process_frame.connect(_frame)


# ── Getting the game into each state ────────────────────────────────────────────────────

func _play_in() -> void:
	var p: Progress = _app.progress
	p.complete_lesson("lesson-rotate")
	p.complete_lesson("lesson-1")
	var seconds := 20.0
	for def in Roster.all().slice(0, 9):
		var outcome := AttemptOutcome.of(def, true, seconds, &"normal")
		p.complete_attempt(outcome, Progress.today())
		p.claim_achievements(outcome)
		seconds += 9.0
	for n in 8:
		var draft := EditorModel.new(3 + n % 4)
		draft.set_name("design %d" % (n + 1))
		p.add_custom_lock(draft.to_lock_def(p.custom_locks().size()))


func _bench(shelf: int) -> void:
	_app.memo["bench_tier"] = shelf
	_app.goto(&"bench")


func _results() -> void:
	var def := Roster.by_slug("northgate-5-pin-cabinet")
	_app.lock_def = def
	_app.outcome = AttemptOutcome.of(def, true, 31.0, &"normal")
	_app.result = _app.progress.complete_attempt(_app.outcome, Progress.today())
	_app.earned = _app.progress.claim_achievements(_app.outcome)
	_app.goto(&"results")


func _breather() -> void:
	_app.streak = StreakRun.new(_app.progress, &"normal")
	_app.streak.deal_next()
	_app.streak.opened()
	_app.goto(&"streak")


func _tally() -> void:
	_app.streak = StreakRun.new(_app.progress, &"normal")
	_app.streak.deal_next()
	_app.streak.opened()
	_app.streak.deal_next()
	_app.streak.tick(Streak.SECONDS + 1.0)
	_app.goto(&"streak")


# ── The walk ────────────────────────────────────────────────────────────────────────────

func _frame() -> void:
	if _wait > 0:
		_wait -= 1
		if _wait == 0:
			_audit(str(_steps[_at][0]))
		return
	_at += 1
	if _at >= _steps.size():
		_audit_contrast()
		print("---- ui audit: %d controls checked on %d screens, %d failed" % [_checked, _steps.size(), _failures])
		quit(1 if _failures > 0 else 0)
		return
	(_steps[_at][1] as Callable).call()
	_wait = 4


# ── Contrast ────────────────────────────────────────────────────────────────────────────

static func _luminance(c: Color) -> float:
	var parts: Array[float] = []
	for v: float in [c.r, c.g, c.b]:
		parts.append(v / 12.92 if v <= 0.04045 else pow((v + 0.055) / 1.055, 2.4))
	return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]


static func contrast(a: Color, b: Color) -> float:
	var la := _luminance(a)
	var lb := _luminance(b)
	return (maxf(la, lb) + 0.05) / (minf(la, lb) + 0.05)


## Every ink the game sets type in, against every ground that type is set on, in both themes:
## WCAG AA for text is 4.5 to 1.
func _audit_contrast() -> void:
	var was := Pal.theme_name
	for theme_name: String in Pal.THEMES:
		Pal.use(theme_name)
		var grounds := {"paper": Pal.PAPER, "panel": Pal.PAPER_SHADE}
		var inks := {"ink": Pal.INK, "secondary ink": Pal.INK_LIGHT, "amber text": Pal.AMBER_TEXT,
			"teal text": Pal.TEAL_TEXT, "crimson text": Pal.CRIMSON_TEXT, "violet text": Pal.VIOLET_TEXT}
		for ink_name: String in inks:
			for ground_name: String in grounds:
				_checked += 1
				var ratio := contrast(inks[ink_name], grounds[ground_name])
				if ratio < 4.5:
					_failures += 1
					print("FAIL  %-34s contrast %s on %s is %.2f to 1" % [theme_name + " theme", ink_name, ground_name, ratio])
		# Reversed type: the page colour on an ink fill (primary buttons, the message strip).
		_checked += 1
		if contrast(Pal.PAPER, Pal.INK) < 4.5:
			_failures += 1
			print("FAIL  %-34s contrast reversed type is %.2f to 1" % [theme_name + " theme", contrast(Pal.PAPER, Pal.INK)])
	Pal.use(was)


func _interactive(node: Node, out: Array[Control]) -> void:
	for child in node.get_children():
		if child is Control:
			var c := child as Control
			if not c.is_visible_in_tree():
				continue
			if (c is BaseButton and not (c as BaseButton).disabled) or c is LineEdit or c is TextEdit or c is Range:
				out.append(c)
		_interactive(child, out)


func _label_of(c: Control) -> String:
	if c.accessibility_name != "":
		return c.accessibility_name
	if c is Button and (c as Button).text != "":
		return (c as Button).text
	return "<%s>" % c.get_class()


func _fail(screen: String, c: Control, rule: String, detail: String) -> void:
	_failures += 1
	print("FAIL  %-34s %-8s %-34s %s" % [screen, rule, _label_of(c).left(34), detail])


func _audit(screen: String) -> void:
	var found: Array[Control] = []
	_interactive(_app, found)
	if found.is_empty():
		_failures += 1
		print("FAIL  %-34s nothing interactive on the screen at all" % screen)
		return
	# What Tab reaches, starting from the first control.
	var reached := {}
	var walker: Control = found[0]
	for _i in found.size() * 2 + 4:
		if walker == null or reached.has(walker):
			break
		reached[walker] = true
		walker = walker.find_next_valid_focus()
	var stage := Rect2(Vector2.ZERO, Pal.STAGE)
	for i in found.size():
		var c := found[i]
		_checked += 1
		var rect := c.get_global_rect()
		if rect.size.x < MIN_TARGET - 0.5 or rect.size.y < MIN_TARGET - 0.5:
			_fail(screen, c, "size", "%d×%d" % [roundi(rect.size.x), roundi(rect.size.y)])
		if c.accessibility_name.strip_edges() == "":
			_fail(screen, c, "name", "no spoken name")
		if c.focus_mode == Control.FOCUS_NONE or not reached.has(c):
			_fail(screen, c, "reach", "not reachable by keyboard")
		if not stage.encloses(rect):
			_fail(screen, c, "stage", "at %s" % str(rect))
		for k in range(i + 1, found.size()):
			var other := found[k]
			if other.is_ancestor_of(c) or c.is_ancestor_of(other):
				continue
			var shared := rect.intersection(other.get_global_rect())
			if shared.size.x > 1.0 and shared.size.y > 1.0:
				_fail(screen, c, "apart", "overlaps %s" % _label_of(other))
		if c is Button and (c as Button).text != "":
			var px := c.get_theme_font_size("font_size")
			if px < CAPTION_MIN:
				_fail(screen, c, "caption", "lettered at %d px" % px)
	if _verbose:
		print("ok    %-34s %d controls" % [screen, found.size()])
