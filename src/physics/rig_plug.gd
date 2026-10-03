class_name RigPlug
extends RigidBody2D
## The plug: the part the wrench turns.
##
## In this world it slides rather than rotates — the turn at the rim of a 12.7 mm plug, unrolled
## flat. One degree of freedom, the same as the real thing, and a flat ledge for a set driver to
## stand on. The wrench is a force along the slide; the stops are where the hand is holding it.

## The wrench (minus the return spring), engine units.
var drive := 0.0
## Viscous drag, engine force per px/s.
var drag := 0.0
var max_speed := 0.0
## The plug may not be outside [stop_lo, stop_hi], px.
var stop_lo := 0.0
var stop_hi := INF
## Where the rig sits in the world, px: the stops above are the rig's own.
var base := Vector2.ZERO


func _integrate_forces(state: PhysicsDirectBodyState2D) -> void:
	var dt := state.step
	var x := state.transform.origin.x - base.x
	var vx := state.linear_velocity.x
	vx += (drive - vx * drag) * state.inverse_mass * dt
	vx = clampf(vx, -max_speed, max_speed)
	# The stops are soft from this side: the plug arrives at one inside the step instead of
	# overshooting it and being put back.
	if x + vx * dt > stop_hi:
		vx = (stop_hi - x) / dt
	if x + vx * dt < stop_lo:
		vx = (stop_lo - x) / dt
	# It only slides. The track carries everything across the slide; this bleeds off the residue.
	state.linear_velocity = Vector2(vx, state.linear_velocity.y * 0.5)
	state.angular_velocity = 0.0
