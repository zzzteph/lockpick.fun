class_name Feedback
extends RefCounted
## Feedback that lands in the form.
##
## A player writes in the game and presses Send; the game posts one ordinary submission to a
## Google Form, and the answer appears in its sheet like any other response — no server of the
## game's own, no account, nothing opens in a browser.
##
## Every Google Form has a submit address ending in `/formResponse`, and every question an id
## like `entry.1234567`; the ids below were read off the form's own page. Change the form and
## they have to be read again (`tests/send_feedback.gd` posts one entry from the command line to
## check that the form still takes what the game sends).
##
## This file is the rules, and pure: what a submission is made of. `FeedbackPost` sends it.

const FORM_ID := "1FAIpQLSeX-fjkkB1v4lu5IICHDdQsMSfRSKJX_LAoW_PrF7CnC2TLpw"
const FORM_URL := "https://docs.google.com/forms/d/e/" + FORM_ID + "/formResponse"
const ENTRIES := {
	"rating": "entry.432679203",     # linear scale, 1-5
	"type": "entry.331551608",       # Bug / Suggestion / General
	"details": "entry.468455090",    # paragraph
	"version": "entry.2018506613",   # short answer, filled in by the game
	"name": "entry.465977324",       # short answer, the player's own, optional
}
## The form's own choices, word for word: anything else it would refuse.
const TYPES: Array[String] = ["Bug", "Suggestion", "General"]
const DEFAULT_TYPE := "General"
const MAX_DETAILS := 600
const MAX_NAME := 24
const HEADERS: Array[String] = ["Content-Type: application/x-www-form-urlencoded"]
## Sends that failed wait here for the next launch. Never in a browser: there the reply is hidden
## from the game, so a "failure" is usually a success and trying again would be a duplicate.
const QUEUE_PATH := "user://feedback_queue.json"
const QUEUE_MAX := 20
## Seconds between two sends from one machine: time for a second thought, not for a flood.
const MIN_INTERVAL := 30.0


## "Windows", "Linux", "macOS", "Android", "iOS" or "Web": the first thing a bug report needs.
static func platform_name() -> String:
	if OS.has_feature("web"):
		return "Web"
	return OS.get_name()


## A browser will not let the game read Google's reply to a post from another site, so a send
## there is fire-and-forget.
static func is_fire_and_forget() -> bool:
	return OS.has_feature("web")


## Printable text, trimmed and capped — newlines kept, because a paragraph is allowed one.
static func clean(text: String, max_len: int) -> String:
	var out := ""
	for ch in text:
		var c := ch.unicode_at(0)
		if c == 10 or c >= 32:
			out += ch
	out = out.strip_edges()
	if out.length() > max_len:
		out = out.left(max_len - 1).strip_edges() + "…"
	return out


## The line the game adds under the player's words: the platform, and where they were.
static func context_line(where: String) -> String:
	var at := clean(where, 80)
	return "[%s%s]" % [platform_name(), (", " + at) if at != "" else ""]


## Whether there is anything to send: a rating, or a few words.
static func has_something(rating: int, details: String) -> bool:
	return (rating >= 1 and rating <= 5) or clean(details, MAX_DETAILS) != ""


## The form submission, url-encoded. `rating` is 1-5 (anything else leaves that question
## unanswered), `type` one of `TYPES` (anything else is General), `details` the player's words —
## the context line goes under them — and `version` the build they were written in.
static func build_body(rating: int, type: String, details: String, name: String, where: String, version: String) -> String:
	var fields: Array = []
	if rating >= 1 and rating <= 5:
		fields.append([ENTRIES["rating"], str(rating)])
	fields.append([ENTRIES["type"], type if TYPES.has(type) else DEFAULT_TYPE])
	var words := clean(details, MAX_DETAILS)
	fields.append([ENTRIES["details"], (words + "\n\n" if words != "" else "") + context_line(where)])
	fields.append([ENTRIES["version"], clean(version, 40)])
	fields.append([ENTRIES["name"], clean(name, MAX_NAME)])
	var parts := PackedStringArray()
	for field: Array in fields:
		parts.append("%s=%s" % [str(field[0]), str(field[1]).uri_encode()])
	return "&".join(parts)


## A submission's fields back out of a body: for the tests, and for looking at the queue.
static func parse_body(body: String) -> Dictionary:
	var out := {}
	for part in body.split("&", false):
		var pair := part.split("=", true, 1)
		if pair.size() == 2:
			out[str(pair[0])] = str(pair[1]).uri_decode()
	return out


# ── The queue ───────────────────────────────────────────────────────────────────────────

static func queue_load(path: String = QUEUE_PATH) -> Array[String]:
	var out: Array[String] = []
	if not FileAccess.file_exists(path):
		return out
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return out
	# Parsed quietly: a file that is not a list is an empty queue, not an error to shout about.
	var json := JSON.new()
	var read := json.parse(file.get_as_text())
	file.close()
	if read == OK and json.data is Array:
		for item: Variant in json.data:
			if item is String and item != "":
				out.append(item)
	return out


static func queue_save(bodies: Array[String], path: String = QUEUE_PATH) -> void:
	if bodies.is_empty():
		if FileAccess.file_exists(path):
			DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
		return
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return
	file.store_string(JSON.stringify(bodies))
	file.close()


## Keep a send that failed for the next launch; the oldest goes once there are `QUEUE_MAX`.
static func queue_add(body: String, path: String = QUEUE_PATH) -> void:
	var bodies := queue_load(path)
	bodies.append(body)
	while bodies.size() > QUEUE_MAX:
		bodies.pop_front()
	queue_save(bodies, path)
