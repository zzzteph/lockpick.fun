extends GameScreen
## Settings, in two columns under four headings: how the game plays and how it looks down the
## left; the mixing desk and the controller down the right. Every change is saved as it is made.

## The two columns, and the gutter between them.
const COL_W := 860.0
const LEFT_X := LEFT
const RIGHT_X := 1920.0 - LEFT - COL_W
## A two-way choice, and the box it is pressed in.
const PAIR_W := 420.0
const PAIR_H := 44.0
const SLIDER_W := 520.0
const SWITCH_H := 40.0

# ── Down the left: Play, then Display. Each y is the top of its control. ──
const PLAY_Y := 150.0
const LEVEL_Y := PLAY_Y + 78.0
const WRENCH_Y := LEVEL_Y + 162.0
const DISPLAY_HEAD_Y := WRENCH_Y + 118.0
const THEME_Y := DISPLAY_HEAD_Y + 78.0
const DISPLAY_Y := THEME_Y + 118.0
const MOTION_Y := DISPLAY_Y + PAIR_H + 30.0

# ── Down the right: Sound, then Controller. ──
const SOUND_Y := PLAY_Y
const SLIDERS_Y := SOUND_Y + 56.0
const SLIDER_PITCH := 62.0
const MUTE_Y := SLIDERS_Y + SLIDER_PITCH * 3.0 + 8.0
const TONES_Y := MUTE_Y + SWITCH_H + 8.0
const SUBTITLES_Y := TONES_Y + SWITCH_H + 36.0
const CONTROLLER_Y := SUBTITLES_Y + SWITCH_H + 50.0
const VIBRATE_Y := CONTROLLER_Y + 48.0

## [caption, settings key, spoken name].
const SLIDERS: Array = [
	["master", "masterVolume", "Master volume"],
	["mechanical", "mechanicalVolume", "Mechanical volume"],
	["ambient", "ambientVolume", "Ambient volume"],
]

var _display: Array[Button] = []
var _fullscreen := false


func build() -> void:
	title = "Settings"
	status = "changes save immediately"
	# The way back to a paused attempt, when there is one to go back to: the pause panel links
	# here, and the attempt survives the trip.
	if app.pick_active():
		nav([
			["Back to the lock", func() -> void: app.goto(&"pause")],
			["Menu", func() -> void: app.goto(&"menu")],
		])
	else:
		nav([["Menu", func() -> void: app.goto(&"menu")]])
	var s: Dictionary = app.progress.settings

	# ── Play ──
	var levels := Challenges.ASSIST_MODES
	var level := maxi(0, levels.find(app.progress.assist()))
	var level_cells := Kit.segmented(self, Rect2(LEFT_X, LEVEL_Y, PAIR_W, PAIR_H), _spoken(levels), level,
		func(i: int) -> void: app.update_settings({"assist": String(levels[i])}), "Level")

	# The save keeps "toggle"; the control offers the two ways to work a wrench by name.
	Kit.segmented(self, Rect2(LEFT_X, WRENCH_Y, PAIR_W, PAIR_H), ["Hold", "Toggle"],
		1 if bool(s["tensionToggle"]) else 0,
		func(i: int) -> void: app.update_settings({"tensionToggle": i == 1}), "Wrench")

	# ── Display ──
	# Changing the theme rebuilds the whole screen in the new ink, so where the focus was has to
	# outlive the screen it was on.
	var themes := SaveData.THEMES
	var set_theme := func(i: int) -> void:
		app.memo["settings_focus"] = "theme"
		app.update_settings({"theme": themes[i]})
	var theme_cells := Kit.segmented(self, Rect2(LEFT_X, THEME_Y, PAIR_W, PAIR_H), _spoken(themes),
		maxi(0, themes.find(str(s["theme"]))), set_theme, "Theme")

	_fullscreen = _is_fullscreen()
	var set_window := func(i: int) -> void:
		get_window().mode = Window.MODE_FULLSCREEN if i == 1 else Window.MODE_WINDOWED
	_display = Kit.segmented(self, Rect2(LEFT_X, DISPLAY_Y, PAIR_W, PAIR_H), ["Windowed", "Fullscreen"],
		1 if _fullscreen else 0, set_window, "Display")

	_switch(LEFT_X, MOTION_Y, "reduce motion", "reducedMotion", "animations arrive settled instead of playing")

	# ── Sound ──
	for i in SLIDERS.size():
		var key: String = SLIDERS[i][1]
		var slider := KitSlider.make(self, Rect2(RIGHT_X, SLIDERS_Y + SLIDER_PITCH * i, SLIDER_W, 44.0),
			str(SLIDERS[i][0]), float(s[key]), func(v: float) -> void: app.update_settings({key: v}))
		slider.accessibility_name = str(SLIDERS[i][2])
	_switch(RIGHT_X, MUTE_Y, "mute everything", "muted")
	# Off unless asked for. The clicks always play; this is the drone layer underneath them.
	_switch(RIGHT_X, TONES_Y, "continuous tones", "continuousTones",
		"the hum, the scrape and the room under the clicks")
	_switch(RIGHT_X, SUBTITLES_Y, "audio subtitles", "subtitles", "what the lock is doing, in words on the pick screen")

	# ── Controller ──
	_switch(RIGHT_X, VIBRATE_Y, "vibrate", "haptics", "rumble through a controller's motors")

	var first: Button = level_cells[level]
	if app.memo.get("settings_focus", "") == "theme":
		first = theme_cells[maxi(0, themes.find(str(s["theme"])))]
	app.memo.erase("settings_focus")
	first.grab_focus.call_deferred(true)


## The save's own words for a choice, as captions: lettered in capitals either way, and said
## aloud with one — "Level: Training".
static func _spoken(values: Array) -> Array:
	var out: Array = []
	for value: Variant in values:
		out.append(str(value).capitalize())
	return out


## A switch is as wide as its own caption, so the whole of the words can be pressed. `more` is
## what a screen reader adds after the name.
func _switch(x: float, y: float, caption: String, key: String, more: String = "") -> KitToggle:
	var w := Kit.caption_width(caption) + 12.0
	var toggle := KitToggle.make(self, Rect2(x, y, w, SWITCH_H), caption, bool(app.progress.settings[key]),
		func(on: bool) -> void: app.update_settings({key: on}))
	# Said as a sentence would write it: "Reduce motion", not the capitals it is lettered in.
	Kit.describe(toggle, caption.left(1).to_upper() + caption.substr(1), more)
	return toggle


func paint() -> void:
	var assist: StringName = app.progress.assist()
	_heading(LEFT_X, PLAY_Y, "play")
	_label(LEFT_X, LEVEL_Y, "level")
	# What the level takes away and what it costs on the clock, so the choice is informed rather
	# than a guess at two adjectives.
	plain(Vector2(LEFT_X + PAIR_W + 24.0, LEVEL_Y + PAIR_H / 2.0 + Pal.T_BODY * 0.36), Challenges.assist_par_text(assist),
		Pal.T_BODY, Pal.AMBER_TEXT)
	paragraph(Vector2(LEFT_X, LEVEL_Y + PAIR_H + 30.0), Challenges.assist_blurb(assist), Pal.T_BODY, Pal.INK, COL_W, 26.0, 2)
	_label(LEFT_X, WRENCH_Y, "wrench")
	_note(LEFT_X, WRENCH_Y + PAIR_H, "hold the wrench key down, or press once to latch it")

	_heading(LEFT_X, DISPLAY_HEAD_Y, "display")
	_label(LEFT_X, THEME_Y, "theme")
	_note(LEFT_X, THEME_Y + PAIR_H, "ink on drafting paper, or the same drawing as a blueprint")
	_label(LEFT_X, DISPLAY_Y, "display")

	_heading(RIGHT_X, SOUND_Y, "sound")
	_note(RIGHT_X + 39.0, TONES_Y + SWITCH_H - 6.0, "the hum, the scrape and the room under the clicks")

	_heading(RIGHT_X, CONTROLLER_Y, "controller")
	# The switch is shown either way — the setting travels with the save to a machine that has a
	# pad — and a line under it says which this one is.
	if not Haptics.is_supported():
		_note(RIGHT_X + 39.0, VIBRATE_Y + SWITCH_H - 6.0, "no controller is connected — its motors are what would vibrate")


## A group's heading: heavier than a control's label, and ruled off across its column.
func _heading(x: float, y: float, text: String) -> void:
	tracked(Vector2(x, y + Pal.T_BODY), text, Pal.T_BODY, Pal.INK, HORIZONTAL_ALIGNMENT_LEFT, true)
	pen.draw_rect(Rect2(x, y + Pal.T_BODY + 12.0, COL_W, Pal.STROKE), Pal.INK)


## The name of a control, standing just above it. `y` is the control's top.
func _label(x: float, y: float, text: String) -> void:
	tracked(Vector2(x, y - 10.0), text, Pal.T_DIM, Pal.INK_LIGHT)


## One plain line under a control. `y` is the control's bottom.
func _note(x: float, y: float, text: String) -> void:
	plain(Vector2(x, y + 26.0), text, Pal.T_DIM, Pal.INK_LIGHT)


func _process(delta: float) -> void:
	super(delta)
	# The window can be switched from anywhere, this screen included: the control follows it.
	var full := _is_fullscreen()
	if full != _fullscreen:
		_fullscreen = full
		for k in _display.size():
			var on := k == (1 if full else 0)
			_display[k].theme_type_variation = "SegmentOn" if on else "Segment"
			_display[k].set_pressed_no_signal(on)


func _is_fullscreen() -> bool:
	var mode := get_window().mode
	return mode == Window.MODE_FULLSCREEN or mode == Window.MODE_EXCLUSIVE_FULLSCREEN


## Reached from the pause panel, backing out goes back to it — not past the lock to the menu.
func _unhandled_input(event: InputEvent) -> void:
	if app.pick_active() and event.is_action_pressed(&"ui_cancel"):
		get_viewport().set_input_as_handled()
		app.goto(&"pause")
		return
	super(event)
