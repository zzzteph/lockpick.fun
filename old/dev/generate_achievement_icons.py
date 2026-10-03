from __future__ import annotations

import hashlib
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw


SIZE = 1024
INK = (28, 27, 25)
CREAM = (244, 241, 234)
GREY = (201, 195, 182)
AMBER = (217, 131, 36)
TEAL = (30, 122, 115)
VIOLET = (107, 78, 155)
CRIMSON = (178, 58, 46)
GOLD = (242, 193, 78)

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "shear-line" / "steam" / "achievement-icons"


def rng_for(name: str) -> random.Random:
    digest = hashlib.sha256(name.encode("utf-8")).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


def canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (SIZE, SIZE), CREAM)
    return image, ImageDraw.Draw(image)


def points_to_int(points: list[tuple[float, float]]) -> list[tuple[int, int]]:
    return [(round(x), round(y)) for x, y in points]


def subdivide(
    points: list[tuple[float, float]],
    rng: random.Random,
    *,
    jitter: float = 3.0,
    step: float = 28.0,
    closed: bool = False,
) -> list[tuple[int, int]]:
    if closed:
        points = points + [points[0]]

    out: list[tuple[float, float]] = []
    for index in range(len(points) - 1):
        x1, y1 = points[index]
        x2, y2 = points[index + 1]
        distance = math.hypot(x2 - x1, y2 - y1)
        count = max(1, int(distance / step))
        for part in range(count + 1):
            if index and part == 0:
                continue
            t = part / count
            wobble = jitter * (0.35 if (part == 0 or part == count) else 1.0)
            out.append(
                (
                    x1 + (x2 - x1) * t + rng.uniform(-wobble, wobble),
                    y1 + (y2 - y1) * t + rng.uniform(-wobble, wobble),
                )
            )
    if not closed:
        x, y = points[-1]
        out.append((x + rng.uniform(-jitter * 0.35, jitter * 0.35), y + rng.uniform(-jitter * 0.35, jitter * 0.35)))
    return points_to_int(out)


def line(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    points: list[tuple[float, float]],
    *,
    fill: tuple[int, int, int] = INK,
    width: int = 12,
    jitter: float = 3.0,
    step: float = 28.0,
    closed: bool = False,
) -> None:
    pts = subdivide(points, rng, jitter=jitter, step=step, closed=closed)
    if len(pts) > 1:
        draw.line(pts, fill=fill, width=width, joint="curve")


def polygon(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    points: list[tuple[float, float]],
    *,
    fill: tuple[int, int, int] = CREAM,
    outline: tuple[int, int, int] = INK,
    width: int = 12,
    jitter: float = 3.0,
    step: float = 24.0,
) -> None:
    pts = subdivide(points, rng, jitter=jitter, step=step, closed=True)
    draw.polygon(pts, fill=fill)
    draw.line(pts + [pts[0]], fill=outline, width=width, joint="curve")


def ellipse_points(cx: float, cy: float, rx: float, ry: float, count: int = 72) -> list[tuple[float, float]]:
    return [
        (cx + math.cos(math.tau * i / count) * rx, cy + math.sin(math.tau * i / count) * ry)
        for i in range(count)
    ]


def arc_points(
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    start: float,
    end: float,
    count: int = 28,
) -> list[tuple[float, float]]:
    return [
        (
            cx + math.cos(math.radians(start + (end - start) * i / count)) * rx,
            cy + math.sin(math.radians(start + (end - start) * i / count)) * ry,
        )
        for i in range(count + 1)
    ]


def circle(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    cx: float,
    cy: float,
    r: float,
    *,
    fill: tuple[int, int, int],
    outline: tuple[int, int, int] = INK,
    width: int = 12,
    jitter: float = 2.5,
) -> None:
    polygon(draw, rng, ellipse_points(cx, cy, r, r), fill=fill, outline=outline, width=width, jitter=jitter, step=18)


def oval(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    *,
    fill: tuple[int, int, int],
    outline: tuple[int, int, int] = INK,
    width: int = 12,
    jitter: float = 2.5,
) -> None:
    polygon(draw, rng, ellipse_points(cx, cy, rx, ry), fill=fill, outline=outline, width=width, jitter=jitter, step=18)


def rounded_rect_points(x: float, y: float, w: float, h: float, r: float) -> list[tuple[float, float]]:
    return (
        arc_points(x + w - r, y + r, r, r, -90, 0, 12)
        + arc_points(x + w - r, y + h - r, r, r, 0, 90, 12)
        + arc_points(x + r, y + h - r, r, r, 90, 180, 12)
        + arc_points(x + r, y + r, r, r, 180, 270, 12)
    )


def rounded_rect(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    x: float,
    y: float,
    w: float,
    h: float,
    r: float,
    *,
    fill: tuple[int, int, int] = CREAM,
    outline: tuple[int, int, int] = INK,
    width: int = 12,
    jitter: float = 3.0,
) -> None:
    polygon(draw, rng, rounded_rect_points(x, y, w, h, r), fill=fill, outline=outline, width=width, jitter=jitter)


def thick_path(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    points: list[tuple[float, float]],
    *,
    outer: tuple[int, int, int] = INK,
    inner: tuple[int, int, int] = GREY,
    outer_width: int = 78,
    inner_width: int = 50,
    jitter: float = 2.2,
) -> None:
    line(draw, rng, points, fill=outer, width=outer_width, jitter=jitter, step=24)
    line(draw, rng, points, fill=inner, width=inner_width, jitter=jitter, step=24)


def arrow(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    start: tuple[float, float],
    end: tuple[float, float],
    *,
    color: tuple[int, int, int],
    width: int = 28,
    head_len: float = 88,
    head_w: float = 86,
) -> None:
    sx, sy = start
    ex, ey = end
    dx, dy = ex - sx, ey - sy
    length = max(1.0, math.hypot(dx, dy))
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    neck = (ex - ux * head_len, ey - uy * head_len)
    line(draw, rng, [start, neck], fill=INK, width=width + 18, jitter=3)
    line(draw, rng, [start, neck], fill=color, width=width, jitter=2)
    head = [
        (ex, ey),
        (neck[0] + px * head_w / 2, neck[1] + py * head_w / 2),
        (neck[0] - px * head_w / 2, neck[1] - py * head_w / 2),
    ]
    polygon(draw, rng, head, fill=color, outline=INK, width=12, jitter=2)


def checkmark(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    points: list[tuple[float, float]],
    *,
    color: tuple[int, int, int],
    width: int = 32,
) -> None:
    line(draw, rng, points, fill=INK, width=width + 18, jitter=3)
    line(draw, rng, points, fill=color, width=width, jitter=2)


def plus(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    cx: float,
    cy: float,
    *,
    size: float,
    color: tuple[int, int, int],
    width: int = 12,
) -> None:
    arm = size * 0.33
    half = size * 0.5
    pts = [
        (cx - arm, cy - half),
        (cx + arm, cy - half),
        (cx + arm, cy - arm),
        (cx + half, cy - arm),
        (cx + half, cy + arm),
        (cx + arm, cy + arm),
        (cx + arm, cy + half),
        (cx - arm, cy + half),
        (cx - arm, cy + arm),
        (cx - half, cy + arm),
        (cx - half, cy - arm),
        (cx - arm, cy - arm),
    ]
    polygon(draw, rng, pts, fill=color, outline=INK, width=width, jitter=2)


def star(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    cx: float,
    cy: float,
    *,
    outer: float,
    inner: float,
    color: tuple[int, int, int],
    width: int = 12,
) -> None:
    pts = []
    for i in range(10):
        radius = outer if i % 2 == 0 else inner
        angle = math.radians(-90 + i * 36)
        pts.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    polygon(draw, rng, pts, fill=color, outline=INK, width=width, jitter=2.5)


def scaled_star(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    cx: float,
    cy: float,
    *,
    outer_x: float,
    outer_y: float,
    inner_x: float,
    inner_y: float,
    color: tuple[int, int, int],
    width: int = 12,
) -> None:
    pts = []
    for i in range(10):
        rx = outer_x if i % 2 == 0 else inner_x
        ry = outer_y if i % 2 == 0 else inner_y
        angle = math.radians(-90 + i * 36)
        pts.append((cx + math.cos(angle) * rx, cy + math.sin(angle) * ry))
    polygon(draw, rng, pts, fill=color, outline=INK, width=width, jitter=2.5)


def sparkle_cross(draw: ImageDraw.ImageDraw, rng: random.Random, cx: float, cy: float, size: float) -> None:
    line(draw, rng, [(cx - size, cy), (cx + size, cy)], fill=INK, width=10, jitter=1)
    line(draw, rng, [(cx, cy - size), (cx, cy + size)], fill=INK, width=10, jitter=1)


def keyhole(draw: ImageDraw.ImageDraw, rng: random.Random, cx: float, cy: float, scale: float = 1.0, *, fill: tuple[int, int, int] = INK) -> None:
    circle(draw, rng, cx, cy, 44 * scale, fill=fill, outline=fill, width=1, jitter=1.5)
    polygon(
        draw,
        rng,
        [
            (cx - 29 * scale, cy + 24 * scale),
            (cx + 29 * scale, cy + 24 * scale),
            (cx + 42 * scale, cy + 130 * scale),
            (cx - 42 * scale, cy + 130 * scale),
        ],
        fill=fill,
        outline=fill,
        width=1,
        jitter=1.5,
    )


def shackle_path(x: float, y: float, w: float, h: float, *, open_: bool = False) -> list[tuple[float, float]]:
    if open_:
        left = [(x + w * 0.25, y + h * 0.05), (x + w * 0.25, y - h * 0.42)]
        arch = arc_points(x + w * 0.56, y - h * 0.42, w * 0.31, h * 0.35, 180, 380, 32)
        return left + arch + [(x + w * 1.04, y + h * 0.05)]
    left = [(x + w * 0.27, y + h * 0.05), (x + w * 0.27, y - h * 0.42)]
    arch = arc_points(x + w * 0.5, y - h * 0.42, w * 0.23, h * 0.31, 180, 360, 28)
    return left + arch + [(x + w * 0.73, y + h * 0.05)]


def padlock(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    open_: bool = False,
    body_fill: tuple[int, int, int] = CREAM,
    shackle_fill: tuple[int, int, int] = GREY,
    key_fill: tuple[int, int, int] = INK,
    line_width: int = 12,
    key: bool = True,
) -> None:
    scale = w / 440
    thick_path(
        draw,
        rng,
        shackle_path(x, y, w, h, open_=open_),
        outer=INK,
        inner=shackle_fill,
        outer_width=round(64 * scale),
        inner_width=round(39 * scale),
        jitter=2.5,
    )
    rounded_rect(draw, rng, x, y, w, h, 62 * scale, fill=body_fill, outline=INK, width=line_width, jitter=3)
    if key:
        keyhole(draw, rng, x + w * 0.5, y + h * 0.49, scale * 0.92, fill=key_fill)


def tiny_padlock(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    x: float,
    y: float,
    w: float,
    *,
    open_: bool = False,
    body_fill: tuple[int, int, int] = CREAM,
) -> None:
    padlock(draw, rng, x, y, w, w * 0.75, open_=open_, body_fill=body_fill, line_width=9, key=True)


def dot(draw: ImageDraw.ImageDraw, rng: random.Random, cx: float, cy: float, color: tuple[int, int, int], r: float = 36) -> None:
    circle(draw, rng, cx, cy, r, fill=color, outline=INK, width=10, jitter=2)


def drop(draw: ImageDraw.ImageDraw, rng: random.Random, cx: float, cy: float, color: tuple[int, int, int]) -> None:
    pts = [
        (cx, cy - 78),
        (cx + 55, cy + 8),
        (cx + 44, cy + 82),
        (cx, cy + 116),
        (cx - 44, cy + 82),
        (cx - 55, cy + 8),
    ]
    polygon(draw, rng, pts, fill=color, outline=INK, width=12, jitter=2.5)


def pin(draw: ImageDraw.ImageDraw, rng: random.Random, cx: float, y: float, *, h: float = 210, w: float = 70, fill: tuple[int, int, int] = GREY) -> None:
    rounded_rect(draw, rng, cx - w / 2, y, w, h, w * 0.3, fill=fill, outline=INK, width=11, jitter=2)
    oval(draw, rng, cx, y, w * 0.48, w * 0.20, fill=fill, outline=INK, width=10, jitter=2)


def hourglass_pin(draw: ImageDraw.ImageDraw, rng: random.Random, cx: float, cy: float, *, h: float = 430, w: float = 190) -> None:
    y1 = cy - h / 2
    y2 = cy + h / 2
    pts = [
        (cx - w / 2, y1),
        (cx + w / 2, y1),
        (cx + w * 0.18, cy),
        (cx + w / 2, y2),
        (cx - w / 2, y2),
        (cx - w * 0.18, cy),
    ]
    polygon(draw, rng, pts, fill=GREY, outline=INK, width=13, jitter=3)
    oval(draw, rng, cx, y1, w * 0.53, 28, fill=GREY, outline=INK, width=10, jitter=2)
    oval(draw, rng, cx, y2, w * 0.53, 28, fill=GREY, outline=INK, width=10, jitter=2)


def lock_pick(draw: ImageDraw.ImageDraw, rng: random.Random, start: tuple[float, float], end: tuple[float, float], *, accent: tuple[int, int, int] | None = None, width: int = 18) -> None:
    sx, sy = start
    ex, ey = end
    line(draw, rng, [(sx, sy), (ex, ey)], fill=INK, width=width + 8, jitter=2.5)
    line(draw, rng, [(sx, sy), (ex, ey)], fill=GREY, width=max(6, width - 6), jitter=2)
    dx, dy = ex - sx, ey - sy
    length = max(1, math.hypot(dx, dy))
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    hook_base = (ex - ux * 42, ey - uy * 42)
    hook_tip = (ex - ux * 14 + px * 66, ey - uy * 14 + py * 66)
    line(draw, rng, [hook_base, hook_tip], fill=INK, width=width + 8, jitter=2)
    line(draw, rng, [hook_base, hook_tip], fill=accent or GREY, width=max(7, width - 4), jitter=2)


def wrench(draw: ImageDraw.ImageDraw, rng: random.Random, x: float, y: float, *, color: tuple[int, int, int], scale: float = 1.0) -> None:
    pts = [(x, y), (x + 250 * scale, y), (x + 250 * scale, y - 120 * scale)]
    line(draw, rng, pts, fill=INK, width=34, jitter=3)
    line(draw, rng, pts, fill=color, width=18, jitter=2)


def feather(draw: ImageDraw.ImageDraw, rng: random.Random, cx: float, cy: float, *, color: tuple[int, int, int]) -> None:
    pts = [
        (cx - 190, cy + 84),
        (cx - 90, cy - 130),
        (cx + 18, cy - 210),
        (cx + 104, cy - 134),
        (cx + 78, cy + 52),
        (cx - 36, cy + 122),
    ]
    polygon(draw, rng, pts, fill=color, outline=INK, width=12, jitter=4)
    line(draw, rng, [(cx - 155, cy + 78), (cx + 60, cy - 145)], fill=INK, width=10, jitter=2)
    line(draw, rng, [(cx - 72, cy - 8), (cx - 128, cy - 52)], fill=INK, width=7, jitter=1.5)
    line(draw, rng, [(cx - 10, cy - 72), (cx + 48, cy - 94)], fill=INK, width=7, jitter=1.5)


def open_hand(draw: ImageDraw.ImageDraw, rng: random.Random, cx: float, cy: float) -> None:
    for offset, length in [(-132, 150), (-52, 176), (28, 165), (104, 135)]:
        rounded_rect(draw, rng, cx + offset, cy - length, 58, length, 28, fill=CREAM, outline=INK, width=11, jitter=2.5)
    rounded_rect(draw, rng, cx - 158, cy - 120, 310, 165, 55, fill=CREAM, outline=INK, width=12, jitter=3)
    polygon(
        draw,
        rng,
        [(cx + 130, cy - 70), (cx + 230, cy - 18), (cx + 200, cy + 48), (cx + 108, cy + 30)],
        fill=CREAM,
        outline=INK,
        width=11,
        jitter=3,
    )


def fist(draw: ImageDraw.ImageDraw, rng: random.Random, cx: float, cy: float) -> None:
    rounded_rect(draw, rng, cx - 165, cy - 150, 330, 265, 76, fill=CREAM, outline=INK, width=13, jitter=3)
    for offset in [-128, -42, 44, 126]:
        oval(draw, rng, cx + offset, cy - 150, 54, 58, fill=CREAM, outline=INK, width=11, jitter=2.5)
    polygon(draw, rng, [(cx - 178, cy - 20), (cx - 244, cy + 54), (cx - 172, cy + 110), (cx - 102, cy + 42)], fill=CREAM, outline=INK, width=12, jitter=3)
    line(draw, rng, [(cx - 130, cy - 20), (cx + 118, cy - 20)], fill=INK, width=9, jitter=2)
    line(draw, rng, [(cx - 104, cy + 58), (cx + 90, cy + 58)], fill=INK, width=9, jitter=2)


def broom(draw: ImageDraw.ImageDraw, rng: random.Random, *, color: tuple[int, int, int]) -> None:
    line(draw, rng, [(280, 280), (640, 620)], fill=INK, width=24, jitter=3)
    polygon(draw, rng, [(610, 575), (806, 675), (770, 758), (574, 658)], fill=color, outline=INK, width=12, jitter=3)
    line(draw, rng, [(608, 684), (748, 752)], fill=INK, width=8, jitter=2)


def stopwatch(draw: ImageDraw.ImageDraw, rng: random.Random, cx: float, cy: float, r: float) -> None:
    rounded_rect(draw, rng, cx - 50, cy - r - 92, 100, 74, 24, fill=GREY, outline=INK, width=12, jitter=2)
    oval(draw, rng, cx, cy, r, r, fill=CREAM, outline=INK, width=14, jitter=3)
    line(draw, rng, [(cx, cy), (cx + r * 0.18, cy - r * 0.58)], fill=INK, width=12, jitter=2)
    circle(draw, rng, cx, cy, 18, fill=INK, outline=INK, width=1, jitter=1)


def save(name: str, draw_fn) -> None:
    image, draw = canvas()
    draw_fn(draw, rng_for(name))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    image.save(OUT_DIR / name)


def image_01(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    padlock(draw, rng, 272, 410, 480, 365, open_=True)
    drop(draw, rng, 790, 522, AMBER)


def image_02(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    padlock(draw, rng, 298, 338, 428, 324, open_=True)
    dot(draw, rng, 512, 786, TEAL, 43)


def image_03(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    padlock(draw, rng, 298, 338, 428, 324, open_=True)
    dot(draw, rng, 456, 786, TEAL, 38)
    dot(draw, rng, 568, 786, TEAL, 38)


def image_04(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    padlock(draw, rng, 298, 338, 428, 324, open_=True)
    for cx in [410, 512, 614]:
        dot(draw, rng, cx, 786, TEAL, 34)


def image_05(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    padlock(draw, rng, 298, 338, 428, 324, open_=True)
    for cx in [374, 466, 558, 650]:
        dot(draw, rng, cx, 786, TEAL, 31)


def image_06(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    polygon(draw, rng, [(170, 625), (846, 625), (812, 705), (206, 705)], fill=AMBER, outline=INK, width=13, jitter=4)
    for x in [244, 714]:
        polygon(draw, rng, [(x, 700), (x + 54, 700), (x + 18, 884), (x - 36, 884)], fill=CREAM, outline=INK, width=12, jitter=3)
    line(draw, rng, [(230, 790), (780, 790)], fill=INK, width=13, jitter=3)
    padlock(draw, rng, 362, 332, 300, 245, open_=True)


def image_07(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    left, top, cell, gap = 276, 224, 98, 18
    for row in range(4):
        for col in range(4):
            rounded_rect(draw, rng, left + col * (cell + gap), top + row * (cell + gap), cell, cell, 8, fill=GREY, outline=INK, width=8, jitter=2)
    checkmark(draw, rng, [(254, 562), (438, 720), (790, 292)], color=TEAL, width=45)


def image_08(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    lock_pick(draw, rng, (238, 744), (744, 258), accent=TEAL, width=24)


def image_09(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    pin(draw, rng, 600, 584, h=250, w=82)
    feather(draw, rng, 465, 472, color=AMBER)


def image_10(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    hourglass_pin(draw, rng, 512, 542, h=470, w=220)
    arrow(draw, rng, (512, 755), (512, 242), color=TEAL, width=30, head_len=98, head_w=105)


def image_11(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    oval(draw, rng, 512, 316, 252, 110, fill=CREAM, outline=INK, width=14, jitter=4)
    circle(draw, rng, 512, 316, 58, fill=VIOLET, outline=INK, width=11, jitter=2)
    circle(draw, rng, 512, 316, 20, fill=INK, outline=INK, width=1, jitter=1)
    line(draw, rng, [(264, 316), (382, 236), (512, 208), (642, 236), (760, 316)], fill=INK, width=14, jitter=4)
    hourglass_pin(draw, rng, 512, 686, h=310, w=160)


def image_12(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    open_hand(draw, rng, 512, 450)
    wrench(draw, rng, 338, 722, color=TEAL, scale=1.08)


def image_13(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    wrench(draw, rng, 346, 654, color=CRIMSON, scale=1.08)
    fist(draw, rng, 512, 480)


def image_14(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    broom(draw, rng, color=TEAL)
    for cx, cy in [(335, 764), (472, 792), (596, 762)]:
        pin(draw, rng, cx, cy - 74, h=116, w=56)
    line(draw, rng, [(242, 820), (766, 820)], fill=INK, width=10, jitter=2)


def image_15(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    lock_pick(draw, rng, (500, 800), (500, 244), accent=GREY, width=22)
    plus(draw, rng, 664, 410, size=130, color=CRIMSON)


def dashed_line(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    points: list[tuple[float, float]],
    *,
    fill: tuple[int, int, int],
    width: int,
    dash: float = 34,
    gap: float = 24,
) -> None:
    for start, end in zip(points, points[1:]):
        x1, y1 = start
        x2, y2 = end
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy)
        ux, uy = dx / max(1, length), dy / max(1, length)
        pos = 0.0
        while pos < length:
            a = pos
            b = min(length, pos + dash)
            line(draw, rng, [(x1 + ux * a, y1 + uy * a), (x1 + ux * b, y1 + uy * b)], fill=fill, width=width, jitter=2)
            pos += dash + gap


def image_16(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    x, y, w, h = 292, 410, 440, 340
    rounded_rect(draw, rng, x, y, w, h, 60, fill=CREAM, outline=CREAM, width=1, jitter=1)
    line(draw, rng, [(x + w * 0.5, y), (x + 45, y), (x + 20, y + 42), (x + 20, y + h - 42), (x + 45, y + h), (x + w * 0.5, y + h)], fill=INK, width=14, jitter=3)
    left_shackle = [(x + w * 0.27, y + h * 0.05), (x + w * 0.27, y - h * 0.42)] + arc_points(x + w * 0.5, y - h * 0.42, w * 0.23, h * 0.31, 180, 272, 18)
    thick_path(draw, rng, left_shackle, outer=INK, inner=GREY, outer_width=64, inner_width=40, jitter=2)
    dashed_line(draw, rng, arc_points(x + w * 0.5, y - h * 0.42, w * 0.23, h * 0.31, 270, 360, 18) + [(x + w * 0.73, y + h * 0.05)], fill=AMBER, width=14)
    dashed_line(draw, rng, [(x + w * 0.5, y), (x + w - 45, y), (x + w - 20, y + 42), (x + w - 20, y + h - 42), (x + w - 45, y + h), (x + w * 0.5, y + h)], fill=AMBER, width=14)
    keyhole(draw, rng, x + w * 0.5, y + h * 0.49, 0.85)


def image_17(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    padlock(draw, rng, 292, 378, 440, 340, open_=False)
    polygon(draw, rng, [(286, 495), (744, 468), (758, 560), (294, 588)], fill=CRIMSON, outline=INK, width=12, jitter=4)
    circle(draw, rng, 686, 520, 38, fill=CRIMSON, outline=INK, width=11, jitter=2)
    polygon(draw, rng, [(708, 538), (820, 585), (780, 636), (690, 568)], fill=CRIMSON, outline=INK, width=11, jitter=3)
    polygon(draw, rng, [(662, 542), (760, 656), (700, 684), (630, 560)], fill=CRIMSON, outline=INK, width=11, jitter=3)


def image_18(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    scaled_star(
        draw,
        rng,
        512,
        184,
        outer_x=200,
        outer_y=145,
        inner_x=84,
        inner_y=60,
        color=CRIMSON,
        width=13,
    )
    padlock(draw, rng, 312, 558, 400, 300, open_=False)
    polygon(draw, rng, [(302, 662), (724, 638), (736, 728), (312, 754)], fill=CRIMSON, outline=INK, width=12, jitter=4)
    circle(draw, rng, 670, 692, 40, fill=CRIMSON, outline=INK, width=11, jitter=2)
    polygon(draw, rng, [(700, 704), (812, 748), (774, 804), (668, 728)], fill=CRIMSON, outline=INK, width=11, jitter=3)
    polygon(draw, rng, [(646, 704), (738, 816), (678, 846), (614, 728)], fill=CRIMSON, outline=INK, width=11, jitter=3)


def image_19(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    stopwatch(draw, rng, 512, 542, 258)
    checkmark(draw, rng, [(390, 552), (484, 642), (655, 430)], color=AMBER, width=36)


def image_20(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    left_half = arc_points(480, 536, 215, 245, 94, 266, 40) + [(480, 536)]
    right_half = arc_points(544, 536, 215, 245, -86, 86, 40) + [(544, 536)]
    polygon(draw, rng, left_half, fill=CREAM, outline=INK, width=13, jitter=3)
    polygon(draw, rng, right_half, fill=CREAM, outline=INK, width=13, jitter=3)
    polygon(draw, rng, [(476, 290), (515, 310), (510, 766), (468, 790)], fill=AMBER, outline=INK, width=10, jitter=2)
    polygon(draw, rng, [(548, 292), (508, 314), (516, 766), (558, 790)], fill=AMBER, outline=INK, width=10, jitter=2)
    rounded_rect(draw, rng, 462, 186, 104, 72, 24, fill=GREY, outline=INK, width=11, jitter=2)


def image_21(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    line(draw, rng, [(160, 424), (356, 424)], fill=AMBER, width=20, jitter=3)
    line(draw, rng, [(130, 536), (340, 536)], fill=AMBER, width=20, jitter=3)
    line(draw, rng, [(184, 650), (380, 650)], fill=AMBER, width=20, jitter=3)
    polygon(draw, rng, [(388, 396), (770, 330), (812, 676), (436, 746)], fill=CREAM, outline=INK, width=13, jitter=4)
    keyhole(draw, rng, 604, 518, 0.86)
    thick_path(draw, rng, [(474, 394), (454, 242)] + arc_points(602, 242, 150, 116, 180, 360, 24) + [(752, 336)], outer=INK, inner=GREY, outer_width=62, inner_width=38, jitter=2.5)


def image_22(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    padlock(draw, rng, 292, 392, 440, 340, open_=False)
    arrow(draw, rng, (176, 512), (508, 558), color=CRIMSON, width=28, head_len=82, head_w=84)


def image_23(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    padlock(draw, rng, 300, 404, 424, 340, open_=False, body_fill=INK, shackle_fill=INK, key_fill=CREAM)
    polygon(draw, rng, [(350, 334), (420, 198), (512, 326), (604, 198), (674, 334), (674, 392), (350, 392)], fill=GOLD, outline=INK, width=13, jitter=4)


def image_24(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    padlock(draw, rng, 334, 390, 356, 286, open_=False, body_fill=CREAM, shackle_fill=CREAM, key=False, line_width=6)
    keyhole(draw, rng, 512, 526, 0.62)
    polygon(draw, rng, [(248, 282), (296, 244), (792, 742), (742, 782)], fill=VIOLET, outline=INK, width=11, jitter=3)
    polygon(draw, rng, [(742, 782), (792, 742), (820, 822)], fill=GREY, outline=INK, width=9, jitter=2)
    polygon(draw, rng, [(740, 262), (786, 308), (284, 810), (238, 764)], fill=GREY, outline=INK, width=11, jitter=3)


def image_25(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    positions = [(250, 612), (418, 612), (586, 612), (334, 392), (502, 392)]
    for index, (x, y) in enumerate(positions):
        tiny_padlock(draw, rng, x, y, 142, body_fill=VIOLET if index == 1 else CREAM)


def image_26(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    padlock(draw, rng, 230, 430, 330, 260, open_=False)
    polygon(draw, rng, [(615, 356), (800, 430), (738, 590), (554, 516)], fill=CREAM, outline=VIOLET, width=25, jitter=3)
    rounded_rect(draw, rng, 676, 578, 48, 190, 22, fill=VIOLET, outline=INK, width=11, jitter=2)
    padlock(draw, rng, 620, 450, 86, 66, open_=False, body_fill=CREAM, line_width=6, key=False)


def image_27(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    circle(draw, rng, 512, 522, 262, fill=CREAM, outline=INK, width=15, jitter=3)
    rounded_rect(draw, rng, 422, 472, 180, 96, 38, fill=INK, outline=INK, width=1, jitter=1)
    polygon(draw, rng, [(634, 286), (716, 310), (668, 402), (628, 394)], fill=CREAM, outline=INK, width=12, jitter=2)
    line(draw, rng, [(650, 158), (650, 392)], fill=INK, width=42, jitter=3)
    line(draw, rng, [(650, 158), (650, 392)], fill=TEAL, width=24, jitter=2)


def image_28(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    left_half = [
        (430, 250),
        (354, 274),
        (292, 334),
        (246, 420),
        (220, 522),
        (230, 644),
        (278, 748),
        (358, 812),
        (450, 834),
        (412, 748),
        (478, 682),
        (416, 610),
        (488, 540),
        (420, 466),
        (486, 396),
        (424, 328),
    ]
    right_half = [
        (582, 222),
        (680, 242),
        (758, 306),
        (810, 404),
        (826, 522),
        (808, 650),
        (748, 758),
        (654, 824),
        (540, 848),
        (604, 758),
        (538, 690),
        (612, 616),
        (536, 540),
        (608, 464),
        (546, 388),
        (620, 314),
    ]
    polygon(draw, rng, left_half, fill=CREAM, outline=INK, width=13, jitter=5)
    polygon(draw, rng, right_half, fill=CREAM, outline=INK, width=13, jitter=5)
    line(draw, rng, [(424, 328), (486, 396), (420, 466), (488, 540), (416, 610), (478, 682), (412, 748), (450, 834)], fill=INK, width=15, jitter=2.5)
    line(draw, rng, [(620, 314), (546, 388), (608, 464), (536, 540), (612, 616), (538, 690), (604, 758), (540, 848)], fill=INK, width=15, jitter=2.5)
    circle(draw, rng, 512, 604, 86, fill=AMBER, outline=INK, width=12, jitter=3)
    keyhole(draw, rng, 686, 520, 0.70)


def image_29(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    for cx in [272, 392, 512, 632, 752]:
        pin(draw, rng, cx, 290, h=380, w=74)
    line(draw, rng, [(206, 480), (818, 480)], fill=INK, width=29, jitter=2)
    line(draw, rng, [(206, 480), (818, 480)], fill=TEAL, width=15, jitter=1.5)


def image_30(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    diamond = [(512, 228), (738, 392), (512, 796), (286, 392)]
    polygon(draw, rng, diamond, fill=GOLD, outline=INK, width=13, jitter=3)
    line(draw, rng, [(286, 392), (738, 392)], fill=INK, width=10, jitter=2)
    line(draw, rng, [(512, 228), (420, 392), (512, 796), (604, 392), (512, 228)], fill=INK, width=10, jitter=2)
    sparkle_cross(draw, rng, 254, 274, 38)
    sparkle_cross(draw, rng, 788, 306, 32)
    sparkle_cross(draw, rng, 768, 704, 28)


def image_31(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    rounded_rect(draw, rng, 224, 230, 576, 608, 38, fill=CREAM, outline=INK, width=13, jitter=3)
    polygon(draw, rng, [(224, 230), (800, 230), (800, 350), (224, 350)], fill=GREY, outline=INK, width=12, jitter=2)
    left, top, cell, gap = 286, 398, 58, 28
    filled = {(0, 0), (1, 0), (3, 1), (4, 1), (2, 2), (5, 3), (1, 4)}
    for row in range(5):
        for col in range(7):
            fill = AMBER if (col, row) in filled else CREAM
            rounded_rect(draw, rng, left + col * (cell + gap), top + row * (cell + gap), cell, cell, 6, fill=fill, outline=INK, width=6, jitter=1.5)


def image_32(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    padlock(draw, rng, 286, 392, 452, 354, open_=True)
    for pts in [[(360, 486), (424, 522)], [(602, 454), (666, 426)], [(464, 672), (534, 646)], [(642, 652), (700, 700)]]:
        line(draw, rng, pts, fill=INK, width=9, jitter=2)
    polygon(draw, rng, [(344, 558), (710, 522), (726, 620), (360, 658)], fill=CRIMSON, outline=INK, width=12, jitter=3)
    rounded_rect(draw, rng, 478, 558, 112, 68, 18, fill=CREAM, outline=INK, width=8, jitter=2)


def image_33(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    polygon(draw, rng, [(350, 202), (674, 202), (600, 512), (674, 822), (350, 822), (424, 512)], fill=CREAM, outline=INK, width=14, jitter=3)
    oval(draw, rng, 512, 202, 164, 42, fill=GREY, outline=INK, width=12, jitter=2)
    oval(draw, rng, 512, 822, 164, 42, fill=GREY, outline=INK, width=12, jitter=2)
    polygon(draw, rng, [(416, 628), (608, 628), (650, 790), (374, 790)], fill=AMBER, outline=INK, width=10, jitter=2)
    line(draw, rng, [(512, 438), (512, 626)], fill=AMBER, width=12, jitter=2)
    keyhole(draw, rng, 782, 704, 0.62)


def image_34(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    oval(draw, rng, 416, 566, 132, 210, fill=CREAM, outline=INK, width=13, jitter=4)
    circle(draw, rng, 402, 326, 108, fill=CREAM, outline=INK, width=13, jitter=3)
    polygon(draw, rng, [(320, 260), (344, 140), (426, 242)], fill=CREAM, outline=INK, width=12, jitter=3)
    polygon(draw, rng, [(458, 244), (546, 152), (510, 278)], fill=CREAM, outline=INK, width=12, jitter=3)
    circle(draw, rng, 366, 322, 12, fill=INK, outline=INK, width=1, jitter=1)
    circle(draw, rng, 444, 322, 12, fill=INK, outline=INK, width=1, jitter=1)
    line(draw, rng, [(402, 344), (398, 370), (372, 386)], fill=INK, width=9, jitter=2)
    polygon(draw, rng, [(320, 410), (496, 408), (488, 456), (328, 462)], fill=VIOLET, outline=INK, width=10, jitter=2)
    line(draw, rng, [(500, 560), (650, 508)], fill=INK, width=42, jitter=3)
    line(draw, rng, [(500, 560), (650, 508)], fill=CREAM, width=22, jitter=2)
    line(draw, rng, [(330, 748), (238, 850)], fill=INK, width=40, jitter=3)
    line(draw, rng, [(486, 748), (568, 850)], fill=INK, width=40, jitter=3)
    line(draw, rng, [(330, 748), (238, 850)], fill=CREAM, width=21, jitter=2)
    line(draw, rng, [(486, 748), (568, 850)], fill=CREAM, width=21, jitter=2)
    line(draw, rng, [(292, 642), (180, 560), (242, 470)], fill=INK, width=34, jitter=3)
    line(draw, rng, [(292, 642), (180, 560), (242, 470)], fill=CREAM, width=18, jitter=2)
    padlock(draw, rng, 630, 530, 210, 170, open_=False)


IMAGES = [
    ("first-blood.png", image_01),
    ("apprentice.png", image_02),
    ("journeyman.png", image_03),
    ("locksmith.png", image_04),
    ("specialist.png", image_05),
    ("master-of-the-bench.png", image_06),
    ("completionist.png", image_07),
    ("single-pin-purist.png", image_08),
    ("feather-touch.png", image_09),
    ("push-through.png", image_10),
    ("not-fooled.png", image_11),
    ("light-hand.png", image_12),
    ("iron-grip.png", image_13),
    ("clean-sweep.png", image_14),
    ("surgeon.png", image_15),
    ("expert-hands.png", image_16),
    ("blind-faith.png", image_17),
    ("blind-master.png", image_18),
    ("under-par.png", image_19),
    ("half-par.png", image_20),
    ("speed-run.png", image_21),
    ("no-second-chances.png", image_22),
    ("the-sovereign.png", image_23),
    ("architect.png", image_24),
    ("prolific.png", image_25),
    ("own-medicine.png", image_26),
    ("sidebar.png", image_27),
    ("cracked-it.png", image_28),
    ("every-cylinder.png", image_29),
    ("flawless-tier.png", image_30),
    ("regular.png", image_31),
    ("persistent.png", image_32),
    ("patience.png", image_33),
    ("curious.png", image_34),
]


def main() -> None:
    for name, draw_fn in IMAGES:
        save(name, draw_fn)
        print(name)


if __name__ == "__main__":
    main()
