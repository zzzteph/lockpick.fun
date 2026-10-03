class_name RigPin
extends RigidBody2D
## One pin — a key pin or a driver — as a rigid body in its bore.
##
## The engine does the collisions; this only says what pushes on the pin each tick: its spring,
## its weight, its drag, and the hand under it.

## Extra force for this tick, engine units, set by the rig before the step.
var push := Vector2.ZERO
## The hand under the pin: stiffness (engine force per px), the height it is holding the pin's
## centre up to (px, smaller is higher), and the most it will push. Off while `hand_k` is 0.
var hand_k := 0.0
var hand_y := 0.0
var hand_max := 0.0
## What the hand actually put in last step, engine units.
var hand_force := 0.0
## Spring on the top face (drivers only): preload and rate, engine units, and the centre height
## it is seated at.
var spring_preload := 0.0
var spring_rate := 0.0
var spring_rest_y := 0.0
var weight := 0.0
## Viscous drag, engine force per px/s.
var drag := 0.0
var max_speed := 0.0

## Where the rig sits in the world, px: the heights above are the rig's own.
var base := Vector2.ZERO


func _integrate_forces(state: PhysicsDirectBodyState2D) -> void:
	var dt := state.step
	var v := state.linear_velocity
	var force := push + Vector2(0.0, weight) - v * drag
	if spring_preload > 0.0:
		# The spring presses the driver straight down its bore, harder the further it is lifted.
		var f := spring_preload + spring_rate * (spring_rest_y - (state.transform.origin.y - base.y))
		if f > 0.0:
			force.y += f
	hand_force = 0.0
	if hand_k > 0.0:
		var gap := state.transform.origin.y - base.y - hand_y
		if gap > 0.0:
			hand_force = minf(hand_k * gap, hand_max)
			force.y -= hand_force
	# Every force goes in whole and explicit: a contact can only pass on what the body arrives
	# with, so anything integrated implicitly here would be hidden from the pin it is pressing.
	v += force * state.inverse_mass * dt
	if max_speed > 0.0 and v.length() > max_speed:
		v = v.normalized() * max_speed
	state.linear_velocity = v
	state.angular_velocity = 0.0
