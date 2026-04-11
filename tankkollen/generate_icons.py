#!/usr/bin/env python3
"""Generates Tankkollen PNG app icons (regular + maskable)."""
from PIL import Image, ImageDraw, ImageFilter

def gradient_rect(size, c1, c2):
    """Create a diagonal gradient from c1 to c2."""
    w, h = size
    img = Image.new("RGB", size, c1)
    top_r, top_g, top_b = c1
    bot_r, bot_g, bot_b = c2
    for y in range(h):
        for x in range(w):
            t = (x + y) / (w + h)
            r = int(top_r + (bot_r - top_r) * t)
            g = int(top_g + (bot_g - top_g) * t)
            b = int(top_b + (bot_b - top_b) * t)
            img.putpixel((x, y), (r, g, b))
    return img


def gradient_fast(size, c1, c2):
    """Fast diagonal gradient via row-wise blending."""
    w, h = size
    base = Image.new("RGB", size)
    pixels = base.load()
    for y in range(h):
        for x in range(w):
            t = min(1.0, (x + y) / (w + h - 2))
            r = int(c1[0] + (c2[0] - c1[0]) * t)
            g = int(c1[1] + (c2[1] - c1[1]) * t)
            b = int(c1[2] + (c2[2] - c1[2]) * t)
            pixels[x, y] = (r, g, b)
    return base


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m


def draw_pump(size, margin_ratio=0.22):
    """Draws a simplified fuel pump glyph centered on size x size."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Calculate coordinate system
    m = int(size * margin_ratio)
    # Pump body rectangle (left portion)
    body_w = int(size * 0.36)
    body_h = int(size * 0.54)
    body_x = m
    body_y = int(size * 0.24)
    body_rx = int(body_w * 0.14)

    dark = (10, 14, 26, 255)
    accent = (0, 217, 163, 255)

    # Body
    draw.rounded_rectangle(
        [body_x, body_y, body_x + body_w, body_y + body_h],
        radius=body_rx,
        fill=dark,
    )

    # Display window
    disp_pad = int(body_w * 0.08)
    draw.rounded_rectangle(
        [
            body_x + disp_pad,
            body_y + disp_pad,
            body_x + body_w - disp_pad,
            body_y + disp_pad + int(body_h * 0.28),
        ],
        radius=int(body_w * 0.08),
        fill=accent,
    )

    # Hose lines
    for i, (width_ratio, alpha) in enumerate(
        [(0.78, 180), (0.62, 130), (0.48, 90)]
    ):
        y = body_y + int(body_h * (0.45 + i * 0.13))
        line_w = int(body_w * width_ratio)
        x = body_x + disp_pad
        line_h = int(body_h * 0.04)
        draw.rounded_rectangle(
            [x, y, x + line_w, y + line_h],
            radius=line_h // 2,
            fill=(0, 217, 163, alpha),
        )

    # Right arm (nozzle)
    arm_x = body_x + body_w
    arm_top_y = body_y + int(body_h * 0.14)
    arm_w = int(size * 0.12)
    arm_h = int(body_h * 0.7)
    draw.rounded_rectangle(
        [arm_x, arm_top_y, arm_x + arm_w, arm_top_y + arm_h],
        radius=int(arm_w * 0.4),
        fill=dark,
    )
    # arm elbow going down
    elbow_y1 = arm_top_y + int(arm_h * 0.45)
    elbow_y2 = arm_top_y + int(arm_h * 1.05)
    elbow_w = int(arm_w * 0.55)
    draw.rounded_rectangle(
        [arm_x + arm_w - elbow_w, elbow_y1, arm_x + arm_w + elbow_w // 2, elbow_y2],
        radius=int(elbow_w * 0.4),
        fill=dark,
    )

    # Accent nozzle tip
    tip_r = int(arm_w * 0.55)
    tip_cx = arm_x + arm_w // 2
    tip_cy = arm_top_y + int(arm_w * 0.2)
    draw.ellipse(
        [tip_cx - tip_r, tip_cy - tip_r, tip_cx + tip_r, tip_cy + tip_r],
        fill=accent,
    )

    return img


def make_icon(size, maskable=False):
    # Rounded bg or square bg for maskable
    bg = gradient_fast((size, size), (0, 217, 163), (0, 180, 255))

    if maskable:
        # Maskable needs full bleed background
        icon = bg.convert("RGBA")
        # Safe zone: draw pump in center 60%
        pump_size = int(size * 0.62)
        pump = draw_pump(pump_size, margin_ratio=0.15)
        offset = ((size - pump_size) // 2, (size - pump_size) // 2)
        icon.paste(pump, offset, pump)
    else:
        # Rounded corners
        radius = int(size * 0.22)
        mask = rounded_mask((size, size), radius)
        icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        icon.paste(bg, (0, 0), mask)
        # Pump glyph
        pump = draw_pump(size, margin_ratio=0.18)
        icon.paste(pump, (0, 0), pump)

    return icon


def main():
    sizes = [(192, False), (512, False), (512, True)]
    for size, maskable in sizes:
        icon = make_icon(size, maskable=maskable)
        name = f"icons/icon-maskable-{size}.png" if maskable else f"icons/icon-{size}.png"
        icon.save(name, "PNG", optimize=True)
        print(f"Wrote {name}  ({size}x{size}{' maskable' if maskable else ''})")

    # Apple touch icon (180)
    icon_apple = make_icon(180, maskable=False)
    icon_apple.save("icons/apple-touch-icon.png", "PNG", optimize=True)
    print("Wrote icons/apple-touch-icon.png (180x180)")

    # Favicon 32
    fav = make_icon(32, maskable=False)
    fav.save("icons/favicon-32.png", "PNG", optimize=True)
    print("Wrote icons/favicon-32.png (32x32)")


if __name__ == "__main__":
    main()
