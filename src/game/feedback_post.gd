class_name FeedbackPost
extends Node
## The one place a feedback entry leaves the game from.
##
## It belongs to the app, not to the feedback screen, so a send that is still on its way when the
## player walks off the screen arrives all the same — and what could not be sent last time is
## tried again, once, at the next launch.
##
## What it says back is only what it knows. On a desktop it has Google's reply. In a browser it
## does not: the post goes, and the browser keeps the answer to itself.

## The send is over: whether it went, and the sentence to show.
signal finished(ok: bool, words: String)

## Tests: build the body, say "sent", post nothing and queue nothing.
var dry_run := false
## The last body handed to `send`, sent or not.
var last_body := ""
## Where failed sends are kept; a test points it somewhere of its own.
var queue_path := Feedback.QUEUE_PATH

var _http: HTTPRequest
var _pending := ""
var _pending_queued := false
var _queue_left: Array[String] = []
var _last_sent_at := -1.0e9
var _retried := false


## Whether a send made now would be let through, and if not, why — "" when it would.
func refusal(rating: int, details: String) -> String:
	if not Feedback.has_something(rating, details):
		return "pick a rating or write a few words first"
	if Time.get_ticks_msec() / 1000.0 - _last_sent_at < Feedback.MIN_INTERVAL:
		return "sent a moment ago — give it half a minute"
	return ""


## Post one submission. `finished` says how it went — at once when there is nothing to wait for.
func send(body: String) -> void:
	last_body = body
	_last_sent_at = Time.get_ticks_msec() / 1000.0
	if dry_run:
		finished.emit(true, _thanks())
		return
	_post(body, false)


func _thanks() -> String:
	if Feedback.is_fire_and_forget():
		return "submitted — the browser will not say whether it arrived. Thank you"
	return "sent — thank you"


func _post(body: String, from_queue: bool) -> void:
	if _http == null:
		_http = HTTPRequest.new()
		_http.name = "Post"
		_http.timeout = 15.0
		add_child(_http)
		_http.request_completed.connect(_on_completed)
	if _http.get_http_client_status() != HTTPClient.STATUS_DISCONNECTED:
		if not from_queue:
			_keep(body)
			finished.emit(false, "still sending the last one — kept, and it goes with the next launch")
		return
	_pending = body
	_pending_queued = from_queue
	var err := _http.request(Feedback.FORM_URL, PackedStringArray(Feedback.HEADERS), HTTPClient.METHOD_POST, body)
	if err != OK:
		_pending = ""
		if not from_queue:
			_keep(body)
			finished.emit(false, "could not send — kept, and it goes with the next launch")
		return
	if Feedback.is_fire_and_forget() and not from_queue:
		# The post goes; the reply will never be shown to the game. Say so now.
		finished.emit(true, _thanks())


func _on_completed(result: int, code: int, _headers: PackedStringArray, _body: PackedByteArray) -> void:
	var body := _pending
	var was_queued := _pending_queued
	_pending = ""
	if Feedback.is_fire_and_forget():
		return
	var ok := result == HTTPRequest.RESULT_SUCCESS and code >= 200 and code < 400
	if ok:
		if not was_queued:
			finished.emit(true, _thanks())
		_next_queued()
		return
	if body != "":
		_keep(body)
	# What has just failed will fail again for the rest of the queue: leave it for another day.
	for left in _queue_left:
		_keep(left)
	_queue_left.clear()
	if not was_queued:
		finished.emit(false, "could not reach the form — kept, and it goes with the next launch")


func _keep(body: String) -> void:
	if not Feedback.is_fire_and_forget():
		Feedback.queue_add(body, queue_path)


## Send what failed last time, one at a time, once per run. Returns how many were waiting.
func retry_queue() -> int:
	if _retried or dry_run or Feedback.is_fire_and_forget():
		return 0
	_retried = true
	_queue_left = Feedback.queue_load(queue_path)
	var waiting := _queue_left.size()
	if waiting > 0:
		# Emptied now; whatever fails again is put back by `_on_completed`.
		Feedback.queue_save([] as Array[String], queue_path)
		_next_queued()
	return waiting


func _next_queued() -> void:
	if _queue_left.is_empty():
		return
	_post(_queue_left.pop_front(), true)
