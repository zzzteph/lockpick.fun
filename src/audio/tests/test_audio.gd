extends SceneTree
## Headless: every sound the game makes is rendered, measured, and held against what the web
## game's own code produced in a browser; then the mixer is driven the way the game drives it
## and listened to through a capture.
##
##   godot --headless --path godot --fixed-fps 60 -s res://audio/tests/test_audio.gd -- [quick] [dump=<dir>]
##
## `quick` skips the parts that listen to the mixer in real time (they take most of a minute).
## `dump=<dir>` also writes every sound as a .wav into <dir>.
##
## The numbers it is held against are in web_reference.json, beside this file, and
## web_reference.mjs is what wrote them.

const Analysis := preload("res://audio/tests/audio_analysis.gd")
const SfxNode := preload("res://audio/sfx.gd")
const RATE := 44100.0

## Catalogue id to the name the reference knows the same render by.
const RAW_NAMES := {
	&"click-shallow": "click-0-5-0.2-0-1",
	&"click-deep": "click-4-5-0.9-0-1",
	&"reset": "reset-5",
}

var ref: Dictionary
var checks := 0
var failures := 0
var synth := SfxSynth.new()
var sfx: SfxNode
var quick := false
var dump_dir := ""
var started: Array = []
var own_sfx := false


func _initialize() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg == "quick":
			quick = true
		elif arg.begins_with("dump="):
			dump_dir = arg.substr(5)
	ref = JSON.parse_string(FileAccess.get_file_as_string("res://audio/tests/web_reference.json"))
	process_frame.connect(_run, CONNECT_ONE_SHOT)


func _run() -> void:
	_section("constants and tables")
	_test_constants()
	_section("noise")
	_test_noise()
	_section("catalogue, against the browser's render")
	var measured := _test_catalogue()
	_section("what the sound design asks of each sound")
	_test_character(measured)
	_section("click and reset variants")
	_test_variants()
	_section("streams")
	_test_streams()
	_section("captions")
	_test_captions()
	_section("haptics")
	_test_haptics()
	_section("mixer")
	await _test_mixer()
	if not quick:
		_section("through the mixer, against the browser's limiter")
		await _test_limiter()
		_section("sustained voices, through the mixer")
		await _test_sustained()
	if dump_dir != "":
		_dump()
	if own_sfx:
		sfx.queue_free()
	await process_frame
	print("\n---- %d checks, %d failed" % [checks, failures])
	quit(1 if failures > 0 else 0)


# ── Checks ──────────────────────────────────────────────────────────────────────────────

func _section(title: String) -> void:
	print("\n== ", title)


func _ok(condition: bool, what: String) -> bool:
	checks += 1
	if not condition:
		failures += 1
		print("  FAIL  ", what)
	return condition


## `actual` within `tolerance` of `expected`, as a fraction of `expected`.
func _near(actual: float, expected: float, tolerance: float, what: String) -> void:
	_ok(absf(actual - expected) <= tolerance * absf(expected), "%s: %s, expected %s ±%d%%" % [what, _f(actual), _f(expected), roundi(tolerance * 100.0)])


func _same(actual: Variant, expected: Variant, what: String) -> void:
	_ok(actual == expected, "%s: %s, expected %s" % [what, str(actual), str(expected)])


func _f(v: float) -> String:
	return String.num(v, 5)


func _padded(samples: PackedFloat32Array, n: int) -> PackedFloat32Array:
	var out := samples.duplicate()
	out.resize(n)
	return out


# ── Pure numbers ────────────────────────────────────────────────────────────────────────

func _test_constants() -> void:
	var c: Dictionary = ref["constants"]
	var web: Dictionary = c["DEFAULT_AUDIO_SETTINGS"]
	_same(SfxNode.VOICE_CAP, int(c["VOICE_CAP"]), "voice cap")
	_same(SfxNode.DUCK_TO, c["DUCK_TO"], "duck depth")
	_same(SfxNode.DUCK_SECONDS, c["DUCK_SECONDS"], "duck length")
	_same(SfxNode.DEFAULT_MASTER, web["master"], "default master")
	_same(SfxNode.DEFAULT_MECHANICAL, web["mechanical"], "default mechanical")
	_same(SfxNode.DEFAULT_AMBIENT, web["ambient"], "default ambient")
	_same(SfxNode.DEFAULT_UI, web["ui"], "default ui")
	_same(SfxSynth.CLICK_LOW_HZ, c["CLICK_LOW_HZ"], "click low")
	_same(SfxSynth.CLICK_HIGH_HZ, c["CLICK_HIGH_HZ"], "click high")
	_same(Array(SfxSynth.FALSE_SET_RATIOS), c["FALSE_SET_RATIOS"], "false-set ratios")
	_same(Array(SfxSynth.PENTATONIC), c["PENTATONIC"], "pentatonic")
	_same(SfxSynth.RESET_STAGGER, c["RESET_STAGGER"], "reset stagger")
	_same(SfxSynth.PLUG_FREE_FROM_HZ, c["PLUG_FREE_FROM_HZ"], "plug-free from")
	_same(SfxSynth.PLUG_FREE_TO_HZ, c["PLUG_FREE_TO_HZ"], "plug-free to")
	_same(SfxSynth.AMBIENT_BED_HZ, c["AMBIENT_BED_HZ"], "bed cutoff")
	_same(SfxSynth.AMBIENT_BED_OPEN_HZ, c["AMBIENT_BED_OPEN_HZ"], "bed cutoff, open")
	_same(Captions.CAPTION_SECONDS, c["CAPTION_SECONDS"], "caption seconds")
	_same(Captions.MAX_CAPTIONS, int(c["MAX_CAPTIONS"]), "max captions")
	_same(Haptics.MIN_GAP_MS, int(c["MIN_GAP_MS"]), "haptic gap")
	var silent: Array = []
	for e in Captions.SILENT_EVENTS:
		silent.append(String(e))
	_same(silent, c["SILENT_EVENTS"], "events with no caption")
	var sounded: Array = []
	for e in SfxCatalogue.SOUNDED_EVENTS:
		sounded.append(String(e))
	_same(sounded, c["SOUNDED_EVENTS"], "sounded events")
	for step in 10:
		var t := SfxNode.TENSION_MIN_STEP + (SfxNode.TENSION_MAX_STEP - SfxNode.TENSION_MIN_STEP) * step / 9.0
		_ok(absf(t - float(c["tensionSteps"][step])) < 1e-9, "tension step %d" % (step + 1))

	# The catalogue is the web's catalogue, entry for entry.
	var entries: Array = ref["catalogue"]
	_same(SfxCatalogue.SOUNDS.size(), entries.size(), "catalogue size")
	for i in mini(entries.size(), SfxCatalogue.SOUNDS.size()):
		var mine: Dictionary = SfxCatalogue.SOUNDS[i]
		var theirs: Dictionary = entries[i]
		_same(String(mine["id"]), theirs["id"], "catalogue id %d" % i)
		_same(String(mine["kind"]), theirs["kind"], "%s kind" % mine["id"])
		_same(mine["seconds"], theirs["seconds"], "%s window" % mine["id"])
		_same(String(mine["event"]), theirs["event"] if theirs["event"] != null else "", "%s event" % mine["id"])
		_same(mine["name"], theirs["name"], "%s name" % mine["id"])
	# Every sounded event has a sound.
	for event in SfxCatalogue.SOUNDED_EVENTS:
		var covered := false
		for s in SfxCatalogue.SOUNDS:
			covered = covered or s["event"] == event
		_ok(covered, "no sound wired to %s" % event)

	for row: Array in ref["clickBody"]:
		var hz := SfxSynth.click_body_frequency(int(row[0]), int(row[1]))
		_ok(absf(hz - float(row[2])) < 1e-9, "click body pin %d of %d: %s, expected %s" % [row[0], row[1], _f(hz), _f(row[2])])
	for row: Array in ref["clickDetune"]:
		var d := SfxNode.click_detune(int(row[0]), int(row[1]))
		_ok(absf(d - float(row[2])) < 1e-12, "click detune chamber %d tick %d: %s, expected %s" % [row[0], row[1], str(d), str(row[2])])
	print("  %d click pitches and %d detunes agree with the web's" % [(ref["clickBody"] as Array).size(), (ref["clickDetune"] as Array).size()])

	var returned: Dictionary = ref["returned"]
	var nominal := {
		"click-0-5-0.2": SfxSynth.click_seconds(0.2),
		"click-4-5-0.9": SfxSynth.click_seconds(0.9),
		"overset": SfxSynth.OVERSET_SECONDS,
		"false-set": SfxSynth.FALSE_SET_SECONDS,
		"plug-free": SfxSynth.PLUG_FREE_SECONDS,
		"pick-bent": SfxSynth.pick_strain_seconds(false),
		"pick-broken": SfxSynth.pick_strain_seconds(true),
		"reset-5": SfxSynth.reset_seconds(5),
		"open": SfxSynth.OPEN_SECONDS,
		"ui": SfxSynth.UI_TICK_SECONDS,
	}
	for key: String in nominal:
		_ok(absf(nominal[key] - float(returned[key])) < 1e-9, "%s nominal length: %s, expected %s" % [key, _f(nominal[key]), _f(returned[key])])


func _test_noise() -> void:
	var facts: Dictionary = ref["noise"]
	var white := synth.white_noise()
	var brown := synth.brown_noise()
	_same(white.size(), int(facts["length"]), "white noise length")
	_same(brown.size(), int(facts["length"]), "brown noise length")
	var head := synth.noise(16)
	for i in 16:
		# The same 32-bit floats; the tolerance is only for the JSON they were read back from.
		_ok(absf(white[i] - float(facts["white16"][i])) < 1e-9 and head[i] == white[i], "white noise sample %d" % i)
		_ok(absf(brown[i] - float(facts["brown16"][i])) < 1e-9, "brown noise sample %d" % i)


# ── The catalogue ───────────────────────────────────────────────────────────────────────

## Renders every catalogue sound and checks it against the browser's render of the same thing.
## Returns each sound's measurements over the catalogue's own window.
func _test_catalogue() -> Dictionary:
	var measured := {}
	print("  %-18s %7s %8s %8s %9s %9s %9s   (ours / browser)" % ["sound", "samples", "peak", "rms", "centroid", "dominant", "duration"])
	for spec in SfxCatalogue.SOUNDS:
		var id: StringName = spec["id"]
		var one_shot: bool = spec["kind"] == &"one-shot"
		var samples := SfxCatalogue.render(id, synth)
		var web: Dictionary
		if one_shot:
			web = ref["raw"][RAW_NAMES.get(id, String(id))]
		else:
			web = ref["continuous"][String(id)]["catalogue"]

		_ok(not Analysis.has_nan(samples), "%s has a NaN in it" % id)
		_ok(Analysis.peak(samples) > 0.005 and Analysis.rms(samples) > 0.0005, "%s is silent" % id)
		if one_shot:
			# As long as it is meant to be: the nominal length, plus at most the 20 ms a voice is
			# left running at its floor before it is stopped.
			var nominal := SfxCatalogue.nominal_seconds(id)
			var seconds := samples.size() / RATE
			_ok(seconds >= nominal - 1e-4 and seconds <= nominal + 0.0201, "%s is %s s long, nominal %s" % [id, _f(seconds), _f(nominal)])
		else:
			_near(samples.size() / RATE, spec["seconds"], 0.001, "%s length" % id)

		# Measured over the browser's own window, so the two spectra have the same bins.
		var m := Analysis.measure(_padded(samples, int(web["samples"])), RATE)
		var bin := RATE / Analysis.floor_pow2(int(web["samples"]))
		print("  %-18s %7d %8s %8s %9s %9s %9s" % [id, samples.size(), "%.3f/%.3f" % [m["peak"], web["peak"]],
				"%.4f/%.4f" % [m["rms"], web["rms"]], "%d/%d" % [m["centroid"], web["centroid"]],
				"%d/%d" % [m["dominant"], web["dominant"]], "%d/%d ms" % [m["durationMs"], web["durationMs"]]])
		# The reset's later drops start mid-way through a browser's render block, where its
		# oscillator runs a few milliseconds off pitch; ours does not reproduce that, so the
		# cascade agrees in shape rather than sample for sample.
		var loose := id == &"reset"
		_ok(m["peak"] <= 1.0, "%s peaks at %s" % [id, _f(m["peak"])])
		_near(m["peak"], web["peak"], 0.08 if loose else 0.02, "%s peak" % id)
		_near(m["rms"], web["rms"], 0.08 if loose else 0.02, "%s rms" % id)
		if not loose:
			_near(m["centroid"], web["centroid"], 0.03, "%s centroid" % id)
		_near(m["durationMs"], web["durationMs"], 0.10, "%s audible duration" % id)
		if not loose:
			_ok(absf(m["dominant"] - float(web["dominant"])) <= 1.5 * bin, "%s dominant frequency: %s, expected %s" % [id, _f(m["dominant"]), _f(web["dominant"])])
			_ok(absf(m["bodyHz"] - float(web["bodyHz"])) <= 1.5 * bin * 2.0, "%s body frequency: %s, expected %s" % [id, _f(m["bodyHz"]), _f(web["bodyHz"])])
		if one_shot:
			_ok(absf(m["attackMs"] - float(web["attackMs"])) <= 1.0 or loose, "%s attack: %s ms, expected %s" % [id, _f(m["attackMs"]), _f(web["attackMs"])])
		measured[id] = Analysis.measure(_padded(samples, roundi(float(spec["seconds"]) * RATE)), RATE)
		measured[id]["web_rms"] = web["rms"]
		measured[id]["own_rms"] = m["rms"]

	# Loudness, relative: the one-shots come out in the order the browser's do.
	var ids: Array = []
	for spec in SfxCatalogue.SOUNDS:
		if spec["kind"] == &"one-shot":
			ids.append(spec["id"])
	var ours := ids.duplicate()
	var theirs := ids.duplicate()
	ours.sort_custom(func(a: StringName, b: StringName) -> bool: return measured[a]["own_rms"] < measured[b]["own_rms"])
	theirs.sort_custom(func(a: StringName, b: StringName) -> bool: return measured[a]["web_rms"] < measured[b]["web_rms"])
	_same(ours, theirs, "one-shots, quietest to loudest")
	print("  quietest to loudest: ", ", ".join(ours.map(func(id: StringName) -> String: return String(id))))
	return measured


## AUDIO.md §6, and the assertions the web game's browser suite makes of its debug page.
func _test_character(m: Dictionary) -> void:
	for id: StringName in [&"click-shallow", &"click-deep"]:
		_ok(m[id]["attackMs"] < 8.0, "%s attack is %s ms" % [id, _f(m[id]["attackMs"])])
		_ok(m[id]["durationMs"] < 150.0 and m[id]["durationMs"] > 10.0, "%s lasts %s ms" % [id, _f(m[id]["durationMs"])])
	# Pin index: chamber 1 of 5 against chamber 5 of 5 is a 420-to-180 Hz body.
	_ok(m[&"click-shallow"]["bodyHz"] > m[&"click-deep"]["bodyHz"] * 1.8, "the click's pitch does not follow the pin")
	# Tension: heavy tension shortens the decay.
	_ok(m[&"click-deep"]["durationMs"] < m[&"click-shallow"]["durationMs"] * 0.85, "the click's decay does not follow tension")
	# If binding and free pin converge the game cannot be played by ear.
	_ok(m[&"free-pin"]["centroid"] - m[&"binding"]["centroid"] >= 200.0, "binding and free pin are less than 200 Hz apart")
	_ok(m[&"binding"]["centroid"] < 300.0, "binding is not low")
	# Overset: a dull thud, no ring.
	_ok(m[&"overset"]["centroid"] < 300.0, "overset is not dark")
	_ok(m[&"overset"]["durationMs"] > 60.0 and m[&"overset"]["durationMs"] < 400.0, "overset length")
	# False set: a bright metallic ping.
	_ok(m[&"false-set"]["centroid"] > 600.0 and m[&"false-set"]["durationMs"] > 150.0, "false set is not a bright ping")
	# The plug going slack has no metal in it, and is nothing like the false-set ping.
	_ok(m[&"plug-free"]["centroid"] < 300.0, "plug-free has metal in it")
	_ok(m[&"plug-free"]["centroid"] < m[&"false-set"]["centroid"] / 2.0, "plug-free is too like the false set")
	_ok(m[&"plug-free"]["durationMs"] > 150.0 and m[&"plug-free"]["durationMs"] < 500.0, "plug-free length")
	# A cascade, not a single drop; the whole open sequence; a tiny detent.
	_ok(m[&"reset"]["durationMs"] > 100.0, "reset is not a cascade")
	_ok(m[&"open"]["durationMs"] > 500.0, "open is cut short")
	_ok(m[&"ui"]["durationMs"] < 20.0 and m[&"ui"]["centroid"] > 2000.0, "ui tick is not a tiny bright detent")
	_ok(m[&"scrape"]["centroid"] > 2000.0, "scrape is not high")
	_ok(m[&"ambience"]["peak"] < 0.35, "the bed is not quiet")


func _test_variants() -> void:
	var raw: Dictionary = ref["raw"]
	var clicks := 0
	for name: String in raw:
		if not name.begins_with("click-"):
			continue
		var web: Dictionary = raw[name]
		var samples := synth.click(int(web["pinIndex"]), int(web["chamberCount"]), web["tension"], web["detune"], web["gain"])
		var m := Analysis.measure(_padded(samples, int(web["samples"])), RATE)
		_near(m["peak"], web["peak"], 0.02, "%s peak" % name)
		_near(m["rms"], web["rms"], 0.02, "%s rms" % name)
		_near(m["centroid"], web["centroid"], 0.03, "%s centroid" % name)
		_near(m["durationMs"], web["durationMs"], 0.10, "%s duration" % name)
		_ok(absf(m["bodyHz"] - float(web["bodyHz"])) <= 16.0, "%s body: %s, expected %s" % [name, _f(m["bodyHz"]), _f(web["bodyHz"])])
		_ok(absf(samples.size() / RATE - SfxSynth.click_seconds(web["tension"])) < 1e-4, "%s length" % name)
		clicks += 1
	print("  %d click variants within 2%% of the browser's level and 3%% of its centroid" % clicks)
	for n in range(1, 9):
		var web: Dictionary = raw["reset-%d" % n]
		var samples := synth.reset(n)
		var m := Analysis.measure(_padded(samples, int(web["samples"])), RATE)
		var tolerance := 0.001 if n == 1 else 0.08
		_near(m["peak"], web["peak"], tolerance, "reset of %d, peak" % n)
		_near(m["rms"], web["rms"], tolerance, "reset of %d, rms" % n)
		_near(m["durationMs"], web["durationMs"], 0.10, "reset of %d, duration" % n)
		_ok(absf(samples.size() / RATE - SfxSynth.reset_seconds(n)) < 1e-4, "reset of %d, length" % n)
	var credit := synth.ui_tick(0.8 + 3 * 0.12)
	_near(Analysis.peak(credit), raw["ui-credit-3"]["peak"], 0.01, "credit tick 3 peak")

	# The sustained voices at other settings.
	var cont: Dictionary = ref["continuous"]
	var voices := {
		"binding-0.3": synth.binding_hum(0.8, 0.3),
		"scrape-0": synth.scrape(0.8, 1.0, 0.0),
		"scrape-1": synth.scrape(0.8, 1.0, 1.0),
		"spring-0": synth.spring(0.8, 0.0, 1.0),
		"ambience-open": synth.ambience(0.8, 1.0, 1.0),
	}
	for name: String in voices:
		var web: Dictionary = cont[name]["catalogue"]
		var m := Analysis.measure(voices[name], RATE)
		_near(m["rms"], web["rms"], 0.02, "%s rms" % name)
		_near(m["centroid"], web["centroid"], 0.03, "%s centroid" % name)
	# Opening the bed is audible as brightness, not as a note.
	_ok(Analysis.spectral_centroid(voices["ambience-open"], RATE) > Analysis.spectral_centroid(synth.ambience(0.8, 1.0), RATE) * 1.3, "the bed does not open on a false set")


func _test_streams() -> void:
	var samples := synth.click(2, 6, 0.489, 0.0, 1.7)
	_ok(Analysis.peak(samples) > 1.0, "a click at the game's gain is expected to peak past 1.0")
	var packed := SfxSynth.pack(samples)
	var stream: AudioStreamWAV = packed["stream"]
	_same(stream.format, AudioStreamWAV.FORMAT_16_BITS, "stream format")
	_same(stream.mix_rate, 44100, "stream rate")
	_same(stream.stereo, false, "stream is mono")
	_same(stream.data.size(), samples.size() * 2, "stream size")
	_near(packed["seconds"], samples.size() / RATE, 1e-6, "stream length")
	var worst := 0.0
	var top := 0
	for i in samples.size():
		var stored := stream.data.decode_s16(i * 2)
		top = maxi(top, absi(stored))
		worst = maxf(worst, absf(stored / 32767.0 * float(packed["gain"]) - samples[i]))
	_ok(top <= 32000 and top >= 31999, "a stream is stored at full scale without clipping (peak %d)" % top)
	_ok(worst < 1.0 / 16000.0, "a stream played at its gain is the render (worst error %s)" % _f(worst))
	var looped: AudioStreamWAV = SfxSynth.pack(synth.loop(&"hum-saw"), true)["stream"]
	_same(looped.loop_mode, AudioStreamWAV.LOOP_FORWARD, "a loop loops")
	_same(looped.loop_end - looped.loop_begin, 735 * 4, "a loop is a whole number of cycles long")
	# The mixer plays the sample at the end point, then the one after the start.
	_same(looped.data.size(), (735 * 4 + 1) * 2, "a loop carries its end point")
	_same(looped.data.decode_s16(looped.loop_end * 2), looped.data.decode_s16(0), "a loop's end point is its start")
	# Every loop the sustained voices play closes on itself: the step across the join is no
	# bigger than the steps inside it. (The two noise loops are noise; there is no seam to hear.)
	for id: StringName in [&"hum-saw", &"hum-sub", &"spring", &"free-pin", &"grind", &"friction"]:
		var loop := synth.loop(id)
		var inside := 0.0
		for i in range(1, loop.size()):
			inside = maxf(inside, absf(loop[i] - loop[i - 1]))
		_ok(absf(loop[0] - loop[loop.size() - 1]) <= inside * 1.01, "the %s loop has a seam" % id)


# ── Captions and haptics ────────────────────────────────────────────────────────────────

static func _event(e: Dictionary) -> Array:
	var data := e.duplicate()
	data.erase("type")
	return [StringName(e["type"]), data]


func _test_captions() -> void:
	for row: Dictionary in ref["captions"]:
		var e := _event(row["event"])
		var line := Captions.caption_for(e[0], e[1])
		_same(line, row["line"] if row["line"] != null else "", "caption for %s" % e[0])
		_same(line == "", Captions.SILENT_EVENTS.has(e[0]), "%s is silent" % e[0])
	for row: Dictionary in ref["sustained"]:
		var line := Captions.sustained_caption(row["counter"], float(row["velocity"]) * Captions.PLUG_RADIUS)
		_same(line, row["line"] if row["line"] != null else "", "sustained caption at counter %s, velocity %s" % [row["counter"], row["velocity"]])
	# The web's subtitle track, replayed: the same lines up, with the same life left, at each step.
	var track := Captions.new()
	var now := 0.0
	for step: Dictionary in ref["captionScript"]:
		for e: Dictionary in step["events"]:
			var ev := _event(e)
			track.on_event(ev[0], ev[1], now)
		now += float(step["dt"])
		track.update(now, step["counter"], float(step["velocity"]) * Captions.PLUG_RADIUS)
		_same(Array(track.lines(now)), step["lines"], "captions at %.1f s" % now)
		var rows := track.rows(now)
		for i in rows.size():
			_same([rows[i][0], rows[i][2]], [step["lines"][i], step["kinds"][i] == "state"], "caption row %d at %.1f s" % [i, now])
		var entries := track.entries(now)
		for i in mini(entries.size(), (step["life"] as Array).size()):
			_ok(absf(entries[i]["life"] - float(step["life"][i])) < 1e-6, "caption %d life at %.1f s" % [i, now])
			_same(String(entries[i]["kind"]), step["kinds"][i], "caption %d kind at %.1f s" % [i, now])
			_ok(absf(entries[i]["fade"] - minf(1.0, float(step["life"][i]) / 0.4)) < 1e-6, "caption %d fade at %.1f s" % [i, now])
	track.clear()
	_same(track.lines(now).size(), 0, "a cleared track")
	print("  %d captions, %d sustained lines and a %d-step track agree with the web's" % [(ref["captions"] as Array).size(), (ref["sustained"] as Array).size(), (ref["captionScript"] as Array).size()])


func _test_haptics() -> void:
	var patterns: Dictionary = ref["constants"]["PATTERNS"]
	var names := {"set": &"set", "overset": &"overset", "falseSet": &"false_set", "detent": &"detent", "free": &"free", "reset": &"reset", "broken": &"broken", "opened": &"opened"}
	_same(patterns.size(), Haptics.PATTERNS.size(), "pattern count")
	for name: String in patterns:
		var theirs: Variant = patterns[name]
		var expected: Array = theirs if theirs is Array else [theirs]
		var mine: Array = Haptics.PATTERNS[names[name]]
		_same(mine.map(func(v: int) -> float: return float(v)), expected, "pattern %s" % name)

	var fired: Array = []
	var clock := [0.0]
	Haptics.sink = func(pattern: Array) -> void: fired.append({"at": clock[0], "pattern": pattern})
	# Off until the settings say otherwise.
	Haptics.enabled = false
	Haptics.handle_event(&"PIN_SET", {}, 0.0)
	_same(fired.size(), 0, "nothing vibrates while disabled")
	Haptics.enabled = true
	Haptics.reset_clock()
	for step: Dictionary in ref["haptics"]["steps"]:
		clock[0] = float(step["at"])
		if step["what"] is String:
			Haptics.detent(clock[0])
		else:
			for e: Dictionary in step["what"]:
				Haptics.handle_event(StringName(e["type"]), e, clock[0])
	var expected_fired: Array = ref["haptics"]["fired"]
	_same(fired.size(), expected_fired.size(), "vibrations fired")
	for i in mini(fired.size(), expected_fired.size()):
		_same(fired[i]["at"], expected_fired[i]["at"], "vibration %d time" % i)
		_same((fired[i]["pattern"] as Array).map(func(v: int) -> float: return float(v)), expected_fired[i]["pattern"], "vibration %d pattern" % i)
	# A step of the wrench arrives as an event here, and is the detent.
	fired.clear()
	Haptics.reset_clock()
	Haptics.handle_event(&"WRENCH_STEP", {"step": 4}, 5000.0)
	Haptics.handle_event(&"STRIKE", {}, 6000.0)
	_same(fired.size(), 1, "a wrench step is felt, a strike is not")
	_same(fired[0]["pattern"] if fired.size() > 0 else [], Haptics.PATTERNS[&"detent"], "a wrench step is the detent")
	Haptics.sink = Callable()
	Haptics.enabled = false
	Haptics.reset_clock()
	print("  %d vibrations, the same ones at the same times as the web's" % fired.size())


# ── The mixer ───────────────────────────────────────────────────────────────────────────

func _wait(seconds: float) -> void:
	var until := Time.get_ticks_usec() + int(seconds * 1.0e6)
	while Time.get_ticks_usec() < until:
		await process_frame


func _wait_ready() -> void:
	while not sfx.is_ready():
		await process_frame
	await process_frame


func _capture_on(bus: StringName) -> AudioEffectCapture:
	var capture := AudioEffectCapture.new()
	capture.buffer_length = 6.0
	AudioServer.add_bus_effect(AudioServer.get_bus_index(bus), capture)
	return capture


## What a capture heard, left channel.
func _heard(capture: AudioEffectCapture) -> PackedFloat32Array:
	var frames := capture.get_buffer(capture.get_frames_available())
	var out := PackedFloat32Array()
	out.resize(frames.size())
	for i in frames.size():
		out[i] = frames[i].x
	return out


func _bus_level(bus: StringName) -> float:
	return db_to_linear(AudioServer.get_bus_volume_db(AudioServer.get_bus_index(bus)))


func _test_mixer() -> void:
	# The game's own node where the project registers one; otherwise one made here.
	var boot := Time.get_ticks_usec()
	sfx = root.get_node_or_null("Sfx") as SfxNode
	own_sfx = sfx == null
	if own_sfx:
		sfx = SfxNode.new()
		sfx.name = "Sfx"
		root.add_child(sfx)
		print("  no Sfx autoload in this project: made one, in %.2f ms" % ((Time.get_ticks_usec() - boot) / 1000.0))
	sfx.voice_started.connect(func(key: String, bus: StringName) -> void: started.append([key, String(bus)]))
	await _wait_ready()

	# Buses: made at runtime, wired as the web's graph is.
	var sends := {
		SfxNode.BUS_OUT: &"Master", SfxNode.BUS_MASTER: SfxNode.BUS_OUT, SfxNode.BUS_MECHANICAL: SfxNode.BUS_MASTER,
		SfxNode.BUS_AMBIENT: SfxNode.BUS_MASTER, SfxNode.BUS_UI: SfxNode.BUS_MASTER, SfxNode.BUS_HUM: SfxNode.BUS_MECHANICAL,
		SfxNode.BUS_SPRING: SfxNode.BUS_MECHANICAL, SfxNode.BUS_SCRAPE: SfxNode.BUS_MECHANICAL, SfxNode.BUS_BED: SfxNode.BUS_AMBIENT,
	}
	for bus: StringName in sends:
		var idx := AudioServer.get_bus_index(bus)
		if _ok(idx >= 0, "bus %s exists" % bus):
			_same(AudioServer.get_bus_send(idx), sends[bus], "bus %s sends to" % bus)
	_ok(AudioServer.get_bus_effect(AudioServer.get_bus_index(SfxNode.BUS_OUT), 0) is AudioEffectCompressor, "the output bus has its limiter")

	# The settings: three groups and a master, linear, at the web's defaults.
	_near(_bus_level(SfxNode.BUS_MASTER), 0.8, 1e-4, "master level")
	_near(_bus_level(SfxNode.BUS_MECHANICAL), 1.0, 1e-4, "mechanical level")
	_near(_bus_level(SfxNode.BUS_AMBIENT), 0.2, 1e-4, "ambient level")
	_near(_bus_level(SfxNode.BUS_UI), 0.7, 1e-4, "ui level")
	sfx.set_master(0.5)
	sfx.set_mechanical(0.25)
	sfx.set_ambient(1.0)
	sfx.set_ui(0.1)
	_near(_bus_level(SfxNode.BUS_MASTER), 0.5, 1e-4, "master level, set")
	_near(_bus_level(SfxNode.BUS_MECHANICAL), 0.25, 1e-4, "mechanical level, set")
	_near(_bus_level(SfxNode.BUS_AMBIENT), 1.0, 1e-4, "ambient level, set")
	_near(_bus_level(SfxNode.BUS_UI), 0.1, 1e-4, "ui level, set")
	sfx.set_master(0.0)
	_ok(_bus_level(SfxNode.BUS_MASTER) < 0.0001, "master at zero is silent")
	sfx.set_master(0.8)
	sfx.set_mechanical(1.0)
	sfx.set_ambient(0.2)
	sfx.set_ui(0.7)
	sfx.set_muted(true)
	_ok(AudioServer.is_bus_mute(AudioServer.get_bus_index(SfxNode.BUS_OUT)), "mute stops the output bus")
	sfx.set_muted(false)
	_ok(not AudioServer.is_bus_mute(AudioServer.get_bus_index(SfxNode.BUS_OUT)), "unmute restores it")

	# Rendering: what the worker made at startup, and how long each took.
	var times := sfx.render_times()
	var total := 0.0
	for key: String in times:
		total += times[key]
	print("  %d startup sounds rendered off the main thread in %.1f ms of work" % [times.size(), total])
	for key: String in times:
		print("    %-12s %6.2f ms" % [key, times[key]])
	_same(sfx.stats["rendered_late"], 0, "nothing rendered on the main thread yet")

	# A click nobody prepared is rendered on the spot rather than dropped.
	var t0 := Time.get_ticks_usec()
	sfx.play(&"click", {"chamber": 1, "count": 9, "tension": 0.33})
	var late_ms := (Time.get_ticks_usec() - t0) / 1000.0
	_same(sfx.stats["rendered_late"], 1, "an unprepared click is rendered late")
	t0 = Time.get_ticks_usec()
	sfx.play(&"click", {"chamber": 1, "count": 9, "tension": 0.33})
	var cached_ms := (Time.get_ticks_usec() - t0) / 1000.0
	_same(sfx.stats["rendered_late"], 1, "and then kept")
	print("  an unprepared click costs %.2f ms on the main thread once; played again, %.3f ms" % [late_ms, cached_ms])
	# It also tells the worker what lock this must be, so the next pin's click is not late too.
	await _wait_ready()
	sfx.play(&"click", {"chamber": 7, "count": 9, "tension": 0.12})
	_same(sfx.stats["rendered_late"], 1, "after the first late click the rest of the lock's are prepared")

	# A lock arrives: its clicks and cascades are rendered ahead of the first set.
	t0 = Time.get_ticks_usec()
	sfx.handle_event(&"ATTEMPT_STARTED", {"chambers": 6})
	var asked_ms := (Time.get_ticks_usec() - t0) / 1000.0
	await _wait_ready()
	var prepared_ms := (Time.get_ticks_usec() - t0) / 1000.0
	times = sfx.render_times()
	var click_total := 0.0
	var click_max := 0.0
	var click_n := 0
	for key: String in times:
		if key.begins_with("click:") and key.split(":")[2] == "6":
			click_total += times[key]
			click_max = maxf(click_max, times[key])
			click_n += 1
	_same(click_n, 60, "clicks prepared for a six-pin lock")
	print("  a six-pin lock: asking took %.2f ms; %d clicks rendered off the main thread, %.2f ms each on average, %.2f ms at worst, all ready after %.0f ms" % [asked_ms, click_n, click_total / maxi(1, click_n), click_max, prepared_ms])
	await _wait(0.3)

	# Events to sounds.
	started.clear()
	var late_before: int = sfx.stats["rendered_late"]
	var script := [
		[&"ATTEMPT_STARTED", {}, ""],
		[&"PIN_SET", {"chamber": 2, "tension": 0.4888888888888889}, "click:2:6:49"],
		[&"PIN_OVERSET", {"chamber": 1}, "overset"],
		[&"FALSE_SET_ENTERED", {"chamber": 3, "depth": 0.1}, "false-set"],
		[&"COUNTER_ROTATION", {"chamber": 3}, ""],
		[&"PLUG_MOVED", {"shift": 0.1, "velocity": 2.0}, ""],
		[&"PICK_MOVED", {"from": 0, "to": 1}, ""],
		[&"RESET", {"kind": "counter", "dropped": [3, 4]}, "reset:2"],
		[&"RESET", {"kind": "counter", "dropped": []}, "reset:1"],
		[&"RESET", {"kind": "full", "dropped": [0]}, "reset:6"],
		[&"RESET", {"kind": "feather", "dropped": [0, 1]}, "reset:6"],
		[&"PLUG_FREE", {}, "plug-free"],
		[&"PICK_BENT", {}, "pick-bent"],
		[&"PICK_BROKEN", {}, "pick-broken"],
		[&"LOCK_OPENED", {"time": 12.0}, "open"],
		[&"WRENCH_STEP", {"step": 6}, ""],
		# The snap gun's strike is this build's own sound (the web's gun is silent): one voice,
		# sized by how far the needle was drawn back.
		[&"STRIKE", {}, "strike:10"],
		[&"STRIKE", {"power": 0.33}, "strike:3"],
		[&"STRIKE", {"power": 1.5}, "strike:15"],
	]
	for row: Array in script:
		var before := started.size()
		sfx.handle_event(row[0], row[1])
		if row[2] == "":
			_same(started.size(), before, "%s makes no one-shot" % row[0])
		elif _ok(started.size() == before + 1, "%s starts one sound" % row[0]):
			_same(started[-1], [row[2], "SfxMechanical"], "%s %s" % [row[0], str(row[1])])
	_same(sfx.stats["rendered_late"], late_before, "every event sound was ready before it was needed")
	# An analogue wrench, between two steps of the dial: the nearest prepared click plays now and
	# the exact one is rendered behind it, so the frame never waits for a click.
	sfx.handle_event(&"PIN_SET", {"chamber": 4, "tension": 0.52})
	_same(started[-1], ["click:4:6:49", "SfxMechanical"], "a click between dial steps plays the nearest step's")
	_same(sfx.stats["rendered_late"], late_before, "without rendering on the main thread")
	await _wait_ready()
	sfx.handle_event(&"PIN_SET", {"chamber": 4, "tension": 0.52})
	_same(started[-1], ["click:4:6:52", "SfxMechanical"], "and the exact click the next time")
	started.clear()
	sfx.handle_event(&"RANK_STAMP", {})
	_same(started, [["ui", "SfxUi"]], "the rank landing is one tick on the UI bus")
	sfx.ui_click()
	_same(started[-1], ["ui", "SfxUi"], "the UI click")
	sfx.credit_tick(2)
	_same(started[-1], ["ui", "SfxUi"], "the credit tick")
	for sound: StringName in [&"ui", &"ui_click", &"credit", &"credit_tick", &"click", &"click-shallow", &"click-deep", &"overset", &"false-set", &"reset", &"pick-bent", &"pick-broken", &"plug-free", &"open"]:
		_ok(sfx.play(sound), "play(%s)" % sound)
	_ok(not sfx.play(&"no-such-sound"), "play() refuses a name it does not know")
	# A false set opens the room; a reset or a new attempt closes it.
	sfx.handle_event(&"FALSE_SET_ENTERED", {"chamber": 0})
	_same(sfx._bed_lift, 1.0, "a false set opens the bed")
	sfx.handle_event(&"RESET", {"kind": "full", "dropped": [0]})
	_same(sfx._bed_lift, 0.0, "a reset closes it")
	sfx.handle_event(&"FALSE_SET_ENTERED", {"chamber": 0})
	sfx.handle_event(&"ATTEMPT_STARTED", {})
	_same(sfx._bed_lift, 0.0, "a new attempt closes it")

	# The voice cap, under a synthetic rake.
	await _wait(1.5)
	_same(sfx.active_voices(), 0, "voices are released when they finish")
	var scheduled: int = sfx.stats["scheduled"]
	var stolen: int = sfx.stats["stolen"]
	t0 = Time.get_ticks_usec()
	for i in 48:
		sfx.handle_event(&"PIN_SET", {"chamber": i % 6, "tension": 0.4888888888888889, "tick": i})
	var burst_ms := (Time.get_ticks_usec() - t0) / 1000.0
	_ok(sfx.active_voices() <= SfxNode.VOICE_CAP, "voice cap exceeded: %d" % sfx.active_voices())
	_same(sfx.active_voices(), SfxNode.VOICE_CAP, "a rake fills every voice")
	_same(sfx.stats["scheduled"] - scheduled, 48, "every click of a rake is scheduled")
	_same(sfx.stats["stolen"] - stolen, 24, "the cap steals the oldest")
	var playing := 0
	for child in sfx.get_children():
		if child is AudioStreamPlayer and (child as AudioStreamPlayer).playing:
			playing += 1
	_ok(playing <= SfxNode.VOICE_CAP, "%d players sounding" % playing)
	print("  a 48-click rake in one frame: %.2f ms on the main thread, %d voices live, %d stolen" % [burst_ms, sfx.active_voices(), sfx.stats["stolen"] - stolen])
	await _wait(0.4)


## One sound through the whole chain at the web's defaults, against the same sound through the
## web's graph and limiter. Peak within 1.5 dB, energy within 2.
func _test_limiter() -> void:
	var out := _capture_on(SfxNode.BUS_OUT)
	var pre := _capture_on(SfxNode.BUS_MECHANICAL)
	await _wait(0.2)
	var warm: Dictionary = ref["warm"]
	var plays := [
		["click-2-6-0.489", func() -> void: sfx.play(&"click", {"chamber": 2, "count": 6, "tension": 0.489, "gain": 1.7})],
		["click-0-5-0.2", func() -> void: sfx.play(&"click", {"chamber": 0, "count": 5, "tension": 0.2, "gain": 1.7})],
		["click-4-5-0.9", func() -> void: sfx.play(&"click", {"chamber": 4, "count": 5, "tension": 0.9, "gain": 1.7})],
		["overset", func() -> void: sfx.play(&"overset")],
		["false-set", func() -> void: sfx.play(&"false-set")],
		["plug-free", func() -> void: sfx.play(&"plug-free")],
		["pick-bent", func() -> void: sfx.play(&"pick-bent")],
		["pick-broken", func() -> void: sfx.play(&"pick-broken")],
		["reset-6", func() -> void: sfx.play(&"reset", {"count": 6})],
		["open", func() -> void: sfx.play(&"open")],
		["ui", func() -> void: sfx.ui_click()],
		["ui-credit-3", func() -> void: sfx.credit_tick(3)],
	]
	print("  %-28s %15s %12s" % ["sound, as heard", "peak ours/web", "energy"])
	for row: Array in plays:
		await _limiter_case(out, row[0], row[1], warm[row[0]])
	# The master sits before the limiter: turned up, the limiter holds the click harder.
	sfx.set_master(1.0)
	await _limiter_case(out, "click-2-6-0.489-master1", plays[0][1], warm["click-2-6-0.489-master1"])
	await _limiter_case(out, "open-master1", plays[9][1], warm["open-master1"])
	sfx.set_master(0.3)
	await _limiter_case(out, "click-2-6-0.489-master0.3", plays[0][1], warm["click-2-6-0.489-master0.3"])
	sfx.set_master(0.8)

	# Before the master and the limiter, a voice is at the level it was rendered: the stream's
	# gain undoes its normalisation.
	pre.clear_buffer()
	sfx.play(&"overset")
	await _wait(0.5)
	_near(Analysis.peak(_heard(pre)), ref["raw"]["overset"]["peak"], 0.02, "overset on the mechanical bus")
	pre.clear_buffer()
	sfx.handle_event(&"PIN_SET", {"chamber": 2, "tension": 0.489, "tick": 7})
	await _wait(0.4)
	_near(Analysis.peak(_heard(pre)), ref["raw"]["click-2-6-0.489-0-1.7"]["peak"], 0.03, "a set click on the mechanical bus, at the game's gain")

	# Mute is a real mute.
	var master_bus := _capture_on(&"Master")
	sfx.set_muted(true)
	await _wait(0.1)
	master_bus.clear_buffer()
	sfx.play(&"overset")
	await _wait(0.4)
	_ok(Analysis.peak(_heard(master_bus)) == 0.0, "muted, nothing reaches the master bus")
	sfx.set_muted(false)
	await _wait(0.1)
	master_bus.clear_buffer()
	sfx.play(&"overset")
	await _wait(0.4)
	_ok(Analysis.peak(_heard(master_bus)) > 0.3, "unmuted, it does")
	for bus: StringName in [SfxNode.BUS_OUT, SfxNode.BUS_MECHANICAL, &"Master"]:
		var idx := AudioServer.get_bus_index(bus)
		AudioServer.remove_bus_effect(idx, AudioServer.get_bus_effect_count(idx) - 1)


func _limiter_case(out: AudioEffectCapture, name: String, trigger: Callable, web: Dictionary) -> void:
	out.clear_buffer()
	trigger.call()
	await _wait(float(web["seconds"]) + 0.35)
	var heard := _heard(out)
	var peak := Analysis.peak(heard)
	var energy := Analysis.energy(heard)
	var peak_db := 20.0 * log(peak / float(web["peak"])) / log(10.0)
	var energy_db := 10.0 * log(energy / float(web["energy"])) / log(10.0)
	print("  %-28s %15s %9s dB" % [name, "%.3f/%.3f" % [peak, web["peak"]], "%+.2f" % energy_db])
	_ok(absf(peak_db) <= 1.5, "%s peak through the limiter: %s, web %s (%+.2f dB)" % [name, _f(peak), _f(web["peak"]), peak_db])
	_ok(absf(energy_db) <= 2.0, "%s energy through the limiter: %+.2f dB from the web's" % [name, energy_db])
	_ok(peak <= 1.0, "%s clips" % name)


## Each sustained voice on its own, as the game would drive it, heard after its filter and
## compared with the browser's voice once it has settled: level within 10%, centroid within 10%.
## (Run-to-run the levels land within 2%.)
func _test_sustained() -> void:
	var cont: Dictionary = ref["continuous"]
	# Off by default, and silent while off.
	var pre := _capture_on(SfxNode.BUS_MECHANICAL)
	_same(sfx.continuous, false, "the sustained layer is off by default")
	pre.clear_buffer()
	for i in 20:
		sfx.update_continuous(1.0 / 60.0, 3, SfxNode.STATE_BINDING, float(i % 2), 0.9, 30.0, 10.0)
		await process_frame
	await _wait(0.3)
	_ok(Analysis.peak(_heard(pre)) == 0.0, "off, the sustained voices make no sound")

	sfx.set_continuous(true)
	sfx.set_chamber_count(7)
	await _wait_ready()
	var times := sfx.render_times()
	var total := 0.0
	for key: String in times:
		if key.begins_with("loop:"):
			total += times[key]
	print("  eight loops rendered off the main thread in %.0f ms of work" % total)
	print("  %-16s %17s %15s" % ["voice", "rms ours/web", "centroid"])

	var hum := _capture_on(SfxNode.BUS_HUM)
	var spring := _capture_on(SfxNode.BUS_SPRING)
	var scrape := _capture_on(SfxNode.BUS_SCRAPE)
	var bed := _capture_on(SfxNode.BUS_BED)

	# Binding at 0.9 with the tip working pin 4 of 7: the hum, the spring at 2 mm, and a scrape
	# held at full speed by a tip that keeps moving.
	var drive := func(state: int, lift: float, resistance: float, counter: float, speed: float, wobble: bool) -> void:
		var until := Time.get_ticks_usec() + 2300000
		var flip := false
		while Time.get_ticks_usec() < until:
			flip = not flip
			sfx.update_continuous(1.0 / 240.0, 3, state, lift + (0.2 if wobble and flip else 0.0), resistance, counter, speed)
			await process_frame
	var settle := func() -> void:
		for capture: AudioEffectCapture in [hum, spring, scrape, bed, pre]:
			capture.clear_buffer()
	# Let the levels arrive, then listen.
	sfx.update_continuous(1.0 / 60.0, 3, SfxNode.STATE_BINDING, 2.0, 0.9, 0.0, 0.0)
	await _wait(0.5)
	settle.call()
	await drive.call(SfxNode.STATE_BINDING, 2.0, 0.9, 0.0, 0.0, false)
	_steady("binding", _heard(hum), cont["binding"]["steady"])
	_steady("spring", _heard(spring), cont["spring"]["steady"])
	_steady("ambience", _heard(bed), cont["ambience"]["steady"])
	_ok(Analysis.peak(_tail(_heard(scrape))) < 0.0005, "the scrape stops when the pick does")

	settle.call()
	await drive.call(SfxNode.STATE_SET, 0.0, 0.0, 0.0, 0.0, true)
	_steady("scrape", _heard(scrape), cont["scrape"]["steady"])
	_ok(Analysis.peak(_tail(_heard(hum))) < 0.0005, "the hum stops when the pin is no longer binding")

	# The voices that go straight to the mechanical bus, each alone: the filtered ones are muted
	# at their own buses so only the one being measured is heard there.
	for bus: StringName in [SfxNode.BUS_HUM, SfxNode.BUS_SPRING, SfxNode.BUS_SCRAPE]:
		AudioServer.set_bus_mute(AudioServer.get_bus_index(bus), true)
	sfx.update_continuous(1.0 / 60.0, 3, SfxNode.STATE_FREE, 0.0, 0.0, 0.0, 0.0)
	await _wait(0.5)
	settle.call()
	await drive.call(SfxNode.STATE_FREE, 0.0, 0.0, 0.0, 0.0, false)
	_steady("free-pin", _heard(pre), cont["free-pin"]["steady"])

	sfx.update_continuous(1.0 / 60.0, -1, SfxNode.STATE_FREE, 0.0, 0.0, SfxNode.GRIND_FULL_FORCE, 0.0)
	await _wait(0.5)
	settle.call()
	var until := Time.get_ticks_usec() + 2300000
	while Time.get_ticks_usec() < until:
		sfx.update_continuous(1.0 / 240.0, -1, SfxNode.STATE_FREE, 0.0, 0.0, SfxNode.GRIND_FULL_FORCE, 0.0)
		await process_frame
	_steady("counter-rotation", _heard(pre), cont["counter-rotation"]["steady"])

	var full_speed := SfxNode.FRICTION_FULL_SPEED * SfxNode.PLUG_RADIUS
	sfx.update_continuous(1.0 / 60.0, -1, SfxNode.STATE_FREE, 0.0, 0.0, 0.0, full_speed)
	await _wait(0.5)
	settle.call()
	until = Time.get_ticks_usec() + 2300000
	while Time.get_ticks_usec() < until:
		sfx.update_continuous(1.0 / 240.0, -1, SfxNode.STATE_FREE, 0.0, 0.0, 0.0, full_speed)
		await process_frame
	_steady("plug-friction", _heard(pre), cont["plug-friction"]["steady"])
	for bus: StringName in [SfxNode.BUS_HUM, SfxNode.BUS_SPRING, SfxNode.BUS_SCRAPE]:
		AudioServer.set_bus_mute(AudioServer.get_bus_index(bus), false)

	# A false set opens the bed: brighter, no louder to speak of.
	sfx.handle_event(&"FALSE_SET_ENTERED", {"chamber": 0})
	await _wait(1.2)
	settle.call()
	await _wait(2.3)
	_steady("ambience-open", _heard(bed), cont["ambience-open"]["steady"])
	sfx.handle_event(&"ATTEMPT_STARTED", {})

	# A click pushes the sustained voices down and lets them back: down in 8 ms, held for 45%
	# of the duck, then eased back.
	sfx.duck()
	var at: float = sfx._duck_at
	_near(sfx._duck_gain(at), 1.0, 1e-6, "a duck starts from where the level was")
	_near(sfx._duck_gain(at + 0.004), 0.65, 1e-6, "half-way down after 4 ms")
	_near(sfx._duck_gain(at + 0.008), SfxNode.DUCK_TO, 1e-6, "down after 8 ms")
	_near(sfx._duck_gain(at + SfxNode.DUCK_SECONDS * 0.45), SfxNode.DUCK_TO, 1e-6, "held")
	_near(sfx._duck_gain(at + SfxNode.DUCK_SECONDS * 0.8), 1.0 - 0.7 / exp(1.0), 1e-6, "eased back by its time constant")
	_ok(sfx._duck_gain(at + 0.5) > 0.999, "and gone")
	# Heard, on the free-pin tone, which holds a steady level. The mixer here runs in bursts,
	# so the duck is stretched to a second to be sure of landing inside its hold.
	for bus: StringName in [SfxNode.BUS_HUM, SfxNode.BUS_SPRING, SfxNode.BUS_SCRAPE]:
		AudioServer.set_bus_mute(AudioServer.get_bus_index(bus), true)
	sfx.update_continuous(1.0 / 60.0, 3, SfxNode.STATE_FREE, 0.0, 0.0, 0.0, 0.0)
	await _wait(0.6)
	settle.call()
	await _wait(0.3)
	sfx.duck(SfxNode.DUCK_TO, 1.0)
	var ducked_at := pre.get_frames_available()
	await _wait(3.0)
	var around := _heard(pre)
	var before := Analysis.rms(around.slice(0, ducked_at - 2048))
	var during := Analysis.rms(around.slice(ducked_at + 8820, ducked_at + 13230))
	var after := Analysis.rms(around.slice(around.size() - 8820))
	print("  duck: the free-pin tone at %.4f, %.4f under a duck, %.4f after" % [before, during, after])
	_near(during / before, SfxNode.DUCK_TO, 0.1, "a duck takes the sustained voices to 0.3")
	_near(after / before, 1.0, 0.03, "and they come back")
	for bus: StringName in [SfxNode.BUS_HUM, SfxNode.BUS_SPRING, SfxNode.BUS_SCRAPE]:
		AudioServer.set_bus_mute(AudioServer.get_bus_index(bus), false)

	# Leaving the screen silences the lock's voices; the room stays.
	sfx.update_continuous(1.0 / 60.0, 3, SfxNode.STATE_BINDING, 0.0, 0.9, 0.0, 0.0)
	await _wait(0.4)
	settle.call()
	await _wait(0.3)
	_ok(Analysis.rms(_heard(hum)) > 0.1, "the hum is sounding")
	sfx.hush()
	await _wait(0.4)
	settle.call()
	await _wait(0.4)
	_ok(Analysis.peak(_heard(pre)) < 0.0005, "hush silences the lock's voices")
	_ok(Analysis.rms(_heard(bed)) > 0.005, "and leaves the bed")
	sfx.set_continuous(false)
	await _wait(0.5)
	settle.call()
	await _wait(0.3)
	# Not exactly zero: a filter's tail takes a long time to die all the way.
	_ok(Analysis.peak(_heard(bed)) < 1e-5 and Analysis.peak(_heard(pre)) < 1e-5, "turned off, the sustained layer is silent")
	var playing := 0
	for child in sfx.get_children():
		if child is AudioStreamPlayer and (child as AudioStreamPlayer).playing:
			playing += 1
	_same(playing, 0, "and none of its players is left running")


## The last 65536 samples of what was heard.
func _tail(heard: PackedFloat32Array) -> PackedFloat32Array:
	return heard.slice(maxi(0, heard.size() - 65536))


func _steady(name: String, heard: PackedFloat32Array, web: Dictionary) -> void:
	if not _ok(heard.size() >= 88200, "%s: only %d samples captured" % [name, heard.size()]):
		return
	# The level over exactly two seconds — a whole number of the hum's and the grind's beats —
	# and the spectrum over the last 65536 samples.
	var level := Analysis.rms(heard.slice(heard.size() - 88200))
	var centroid := Analysis.spectral_centroid(_tail(heard), RATE)
	print("  %-16s %17s %15s" % [name, "%.4f/%.4f" % [level, web["rms"]], "%d/%d Hz" % [centroid, web["centroid"]]])
	_near(level, web["rms"], 0.10, "%s level through the mixer" % name)
	# The hum's spectrum swings with its beat, and the window catches it where it happens to be.
	_near(centroid, web["centroid"], 0.15 if name == "binding" else 0.10, "%s centroid through the mixer" % name)


# ── For the ear that is not here ────────────────────────────────────────────────────────

func _dump() -> void:
	DirAccess.make_dir_recursive_absolute(dump_dir)
	var sounds := {}
	for spec in SfxCatalogue.SOUNDS:
		sounds[String(spec["id"])] = SfxCatalogue.render(spec["id"], synth)
	sounds["click-game-pin3of6"] = synth.click(2, 6, 0.489, 0.0, 1.7)
	sounds["reset-1"] = synth.reset(1)
	sounds["binding-3s"] = synth.binding_hum(3.0, 0.9)
	sounds["ambience-open-3s"] = synth.ambience(3.0, 1.0, 1.0)
	print("\n== wav files in ", dump_dir)
	for name: String in sounds:
		var packed := SfxSynth.pack(sounds[name])
		var path := dump_dir.path_join(name + ".wav")
		var err: Error = (packed["stream"] as AudioStreamWAV).save_to_wav(path)
		print("  %-22s %6d samples  rendered peak %.4f  stored at 1/%.3f  %s" % [name, (sounds[name] as PackedFloat32Array).size(), Analysis.peak(sounds[name]), 1.0 / maxf(packed["gain"], 1e-9), "ok" if err == OK else "error %d" % err])
