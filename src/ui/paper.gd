class_name Paper
extends Node2D
## The drafting paper behind every screen: a lattice of hairlines over the page colour.


func _ready() -> void:
	z_index = -100


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, Pal.STAGE), Pal.PAPER)
	var x := 0.0
	while x <= Pal.STAGE.x:
		draw_line(Vector2(x, 0.0), Vector2(x, Pal.STAGE.y), Pal.RULE, Pal.HAIRLINE)
		x += Pal.GRID
	var y := 0.0
	while y <= Pal.STAGE.y:
		draw_line(Vector2(0.0, y), Vector2(Pal.STAGE.x, y), Pal.RULE, Pal.HAIRLINE)
		y += Pal.GRID
	# The page's own margin.
	draw_rect(Rect2(24.0, 24.0, Pal.STAGE.x - 48.0, Pal.STAGE.y - 48.0), Color(Pal.RULE, 0.9), false, Pal.HAIRLINE)
