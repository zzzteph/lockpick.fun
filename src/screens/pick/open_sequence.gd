class_name OpenSequence
extends RefCounted
## The open sequence: two and a half seconds, skippable after half a second, in beats.
##
## Pure timing — seconds in, magnitudes out — so what is on screen at 1.4 s is fully determined
## by the number 1.4. Reduced motion keeps every beat and every duration and drops only the
## things that move: the jolt, the burst, the sweep and the slide.

# Beat starts, in seconds from the open.
const IMPACT := 0.25
const DILATE := 0.35
const BURST := 0.6
const SWEEP := 0.9
const STAMP := 1.2
const CARDS := 1.8
const SETTLE := 2.5

const SKIPPABLE_AFTER := 0.5
const IMPACT_FLASH_SECONDS := 2.0 / 60.0
const IMPACT_JOLT_PX := 8.0
const BURST_SECONDS := 0.45
const BURST_RAYS := 18
const SWEEP_SECONDS := 0.6
const STAMP_SECONDS := 0.55
const CARD_STAGGER := 0.12
const CARD_SLIDE_SECONDS := 0.28
const CARD_SLIDE_PX := 420.0
## How long the last card holds the screen before the results take it.
const CARD_HOLD := 1.2

var elapsed := 0.0
var running := false
var skipped := false
## Rank index earned, 0 = S; negative for an open with no rank to stamp (a lesson, a bump).
var rank := -1
var card_count := 0
var reduced_motion := false
var _ticked := false


func start(earned_rank: int, cards: int) -> void:
	elapsed = 0.0
	running = true
	skipped = false
	rank = earned_rank
	card_count = maxi(0, cards)
	_ticked = false


## How long this open runs: it waits for the last card rather than cutting it off, then holds it
## long enough to be read.
func seconds() -> float:
	if card_count <= 0:
		return SETTLE
	var last_lands := CARDS + (card_count - 1) * CARD_STAGGER + CARD_SLIDE_SECONDS
	return maxf(SETTLE, last_lands + CARD_HOLD)


func can_skip() -> bool:
	return running and elapsed >= SKIPPABLE_AFTER


## Skip to the end — onto exactly the state the sequence would have reached on its own.
func skip() -> bool:
	if not can_skip():
		return false
	elapsed = seconds()
	skipped = true
	running = false
	return true


## Advance; returns true on the frame the rank letter lands (one mechanical tick).
func update(dt: float) -> bool:
	if not running:
		return false
	var end := seconds()
	elapsed = minf(end, elapsed + maxf(0.0, dt))
	var landed := rank >= 0 and stamp() >= 1.0 and not _ticked
	if landed:
		_ticked = true
	if elapsed >= end:
		running = false
	return landed


func settled() -> bool:
	return elapsed >= seconds()


static func _beat(t: float, begin: float, duration: float) -> float:
	if duration <= 0.0:
		return 1.0 if t >= begin else 0.0
	return clampf((t - begin) / duration, 0.0, 1.0)


static func ease_out(t: float) -> float:
	var u := 1.0 - clampf(t, 0.0, 1.0)
	return 1.0 - u * u * u


## The whole picture flashing to highlight, 1 → 0 across two frames.
func flash() -> float:
	if elapsed < IMPACT:
		return 0.0
	return 1.0 - _beat(elapsed, IMPACT, IMPACT_FLASH_SECONDS)


## The 8 px jolt of the drawing.
func jolt() -> float:
	if reduced_motion:
		return 0.0
	var t := _beat(elapsed, IMPACT, 0.12)
	if t <= 0.0 or t >= 1.0:
		return 0.0
	return IMPACT_JOLT_PX * (1.0 - t) * sin(t * PI * 3.0)


## A thin radial burst of hairlines from the plug centre, 0 → 1 → gone.
func burst() -> float:
	if reduced_motion:
		return 0.0
	var t := _beat(elapsed, BURST, BURST_SECONDS)
	return 0.0 if t <= 0.0 or t >= 1.0 else sin(t * PI)


## Grid rings sweeping outward and fading.
func sweep() -> float:
	if reduced_motion:
		return 0.0
	var t := _beat(elapsed, SWEEP, SWEEP_SECONDS)
	return 0.0 if t <= 0.0 or t >= 1.0 else t


## How far the rank letter has stamped in, 0 → 1.
func stamp() -> float:
	var t := _beat(elapsed, STAMP, STAMP_SECONDS)
	if t <= 0.0:
		return 0.0
	if t >= 1.0:
		return 1.0
	return ease_out(t)


func card_visible(index: int) -> bool:
	return elapsed >= CARDS + index * CARD_STAGGER


## Horizontal offset for card `index`, px; zero once it has landed.
func card_offset(index: int) -> float:
	if reduced_motion:
		return 0.0
	var p := ease_out(_beat(elapsed, CARDS + index * CARD_STAGGER, CARD_SLIDE_SECONDS))
	return (1.0 - p) * CARD_SLIDE_PX
