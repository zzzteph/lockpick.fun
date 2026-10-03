class_name RigBar
extends RigidBody2D
## The sidebar: the one bar that lies along the top of the disc pack.
##
## It rides in the sleeve's slot, so it goes round with the sleeve, and it moves in and out along
## that slot. Its own spring only holds it out against the body; what presses it down onto the
## discs is the body's groove, as the sleeve tries to turn. All of that is contact — this says
## only what the spring and the drag do.

## The spring's push outward, engine units.
var lift := 0.0
## Viscous drag, engine force per px/s.
var drag := 0.0
var max_speed := 0.0


func _integrate_forces(state: PhysicsDirectBodyState2D) -> void:
	var v := state.linear_velocity
	var force := Vector2(0.0, -lift) - v * drag
	v += force * state.inverse_mass * state.step
	if max_speed > 0.0 and v.length() > max_speed:
		v = v.normalized() * max_speed
	state.linear_velocity = v
	state.angular_velocity = 0.0
