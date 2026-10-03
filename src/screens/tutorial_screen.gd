extends GameScreen
## The lessons' own screen: a curriculum, on a page that says what order it goes in. Every
## lesson is always shown and always replayable, done or not.

const GAP := 24.0
const TOP := 210.0

var _cards: Array[Rect2] = []


func build() -> void:
	title = "Tutorial"
	var progress: Progress = app.progress
	var lessons := Lessons.all()
	var done := 0
	for l in lessons:
		if progress.lesson_done(str(l["id"])):
			done += 1
	if done == 0:
		status = "start with lesson one — the bench unlocks once it is done"
	elif done == lessons.size():
		status = "all lessons done — they replay whenever you like"
	else:
		status = "%d of %d done — pick up where you left off" % [done, lessons.size()]
	nav([
		["Bench", func() -> void: app.goto(&"bench")],
		["Menu", func() -> void: app.goto(&"menu")],
	])
	# As few columns as leave every card room for its blurb: the blurb is the content here,
	# because this is the screen a zero-knowledge player reads before their first pick.
	var cols := 2 if lessons.size() <= 8 else 3
	var card_w := floorf((WIDTH - GAP * (cols - 1)) / cols)
	var rows := ceili(lessons.size() / float(cols))
	var floor_y := 1080.0 - MARGIN - 60.0
	var fit_h := floorf((floor_y - TOP - GAP * (rows - 1)) / rows)
	# A narrower card needs a second line for its blurb.
	var blurb_lines := 1 if cols == 2 else 2
	var want_h := maxf(150.0, Pal.T_DIM + Pal.T_HEADING + maxf(Pal.T_BODY * 2.4, (Pal.T_BODY + 6.0) * blurb_lines + 6.0) + 70.0)
	var card_h := minf(want_h, fit_h)
	_cards.clear()
	var next := _next_lesson()
	for i in lessons.size():
		var rect := Rect2(LEFT + (card_w + GAP) * (i % cols), TOP + (i / cols) * (card_h + GAP), card_w, card_h)
		_cards.append(rect)
		var id := str(lessons[i]["id"])
		# Read aloud as it is painted: which lesson, what it is called, where it stands, then
		# what it teaches.
		var spoken := "Lesson %d: %s" % [i + 1, lessons[i]["title"]]
		if progress.lesson_done(id):
			spoken += " — done"
		elif i == next:
			spoken += " — next"
		var card := Kit.card(self, rect, func() -> void: app.start_lesson(id), false, spoken, str(lessons[i]["teaches"]))
		# The focus starts where the player left off; on the first lesson once they are all done.
		if i == maxi(0, next):
			card.grab_focus.call_deferred(true)


## The first lesson not yet done, or -1 when they all are.
func _next_lesson() -> int:
	var lessons := Lessons.all()
	for i in lessons.size():
		if not app.progress.lesson_done(str(lessons[i]["id"])):
			return i
	return -1


func paint() -> void:
	var progress: Progress = app.progress
	var lessons := Lessons.all()
	plain(Vector2(LEFT, 170.0), "%d short lessons, in order. Everything on the bench comes down to these." % lessons.size(),
		Pal.T_BODY, Pal.INK_LIGHT)
	var next := _next_lesson()
	for i in lessons.size():
		var l := lessons[i]
		var r := _cards[i]
		var done := progress.lesson_done(str(l["id"]))
		tracked(r.position + Vector2(20.0, 16.0 + Pal.T_DIM), "lesson %d" % (i + 1), Pal.T_DIM, Pal.INK_LIGHT)
		tracked(r.position + Vector2(20.0, 30.0 + Pal.T_DIM + Pal.T_HEADING), str(l["title"]), Pal.T_HEADING, Pal.INK)
		var lines := maxi(0, mini(2, int((r.size.y - Pal.T_DIM - Pal.T_HEADING - 70.0) / (Pal.T_BODY + 6.0))))
		if lines > 0:
			paragraph(r.position + Vector2(20.0, 48.0 + Pal.T_DIM + Pal.T_HEADING + Pal.T_BODY), str(l["teaches"]),
				Pal.T_BODY, Pal.INK_LIGHT, r.size.x - 40.0, Pal.T_BODY + 6.0, lines)
		# `done` in teal on the finished ones; `next` in amber on the first that is not — so the
		# order the page keeps talking about is visible as a mark.
		if done or i == next:
			plain(r.position + Vector2(r.size.x - 20.0, 16.0 + Pal.T_DIM), "done" if done else "next", Pal.T_DIM,
				Pal.TEAL_TEXT if done else Pal.AMBER_TEXT, HORIZONTAL_ALIGNMENT_RIGHT)
