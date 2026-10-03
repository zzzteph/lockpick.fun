class_name RigDisc
extends RigidBody2D
## One disc of a disc-detainer lock: its rim, unrolled flat, with its gates cut into the edge.
##
## A disc has no spring and no weight to speak of: it stays where it is left. The engine does the
## collisions with the bar; this only says what pushes on the disc each tick — the hand, if it is
## on this disc, and the grease it turns in.

## The hand: stiffness (engine force per px), the turn it is holding the disc to (px along the
## rim from the disc's back stop), its damping, and the most it will put in. Off while `hand_k` is 0.
var hand_k := 0.0
var hand_x := 0.0
var hand_c := 0.0
var hand_max := 0.0
## What the hand actually put in last step, engine units: positive turns the disc forward.
var hand_force := 0.0
## Viscous drag against the spacers, engine force per px/s.
var drag := 0.0
var max_speed := 0.0
## The disc's quarter turn inside the sleeve: its tab between the two ends of the sleeve's window.
var stop_lo := 0.0
var stop_hi := INF
## Where the rig sits in the world, px.
var base := Vector2.ZERO


func _integrate_forces(state: PhysicsDirectBodyState2D) -> void:
	var dt := state.step
	var x := state.transform.origin.x - base.x
	var v := state.linear_velocity.x
	var force := -v * drag
	hand_force = 0.0
	if hand_k > 0.0:
		hand_force = clampf(hand_k * (hand_x - x) - hand_c * v, -hand_max, hand_max)
		force += hand_force
	# Whole and explicit, as every force in the rig is: the bar can only be passed what the disc
	# arrives with.
	v += force * state.inverse_mass * dt
	v = clampf(v, -max_speed, max_speed)
	if x + v * dt > stop_hi:
		v = (stop_hi - x) / dt
	if x + v * dt < stop_lo:
		v = (stop_lo - x) / dt
	# It only turns. The track carries everything across the turn; this bleeds off the residue.
	state.linear_velocity = Vector2(v, state.linear_velocity.y * 0.5)
	state.angular_velocity = 0.0
