class_name Steady
extends RefCounted
## A reading as an instrument shows it: eased towards the measurement, and held still until
## the measurement has moved by more than its own noise.

## The eased value, for anything drawn as a level.
var value := 0.0
## The value to print: it only changes when `value` has left it by `step`.
var shown := 0.0
var step := 0.02
## Seconds to close most of the gap.
var ease := 0.12


func _init(hold_within: float = 0.02, ease_seconds: float = 0.12) -> void:
	step = hold_within
	ease = ease_seconds


func follow(target: float, delta: float) -> void:
	# Letting go is immediate: a reading that lingers after the hand has left is a lie.
	if target <= 0.0:
		value = 0.0
	else:
		value += (target - value) * (1.0 - exp(-delta / ease))
	if absf(value - shown) >= step or value == 0.0:
		shown = value


func reset() -> void:
	value = 0.0
	shown = 0.0
