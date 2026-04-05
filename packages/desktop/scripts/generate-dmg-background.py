#!/usr/bin/env python3
"""
Generate the DMG background image for Edgebric.

Creates both 1x (512x320) and 2x retina (1024x640) versions.
dmgbuild auto-detects the @2x variant and combines them into a multi-resolution TIFF.

Coordinate system reference:
  - window_rect = ((200, 120), (512, 320))  =>  512pt wide, 320pt tall
  - icon_locations: Edgebric.app at (150, 140), Applications at (362, 140)
  - Origin (0,0) = top-left of content area; x right, y down
  - icon_size = 80pt (center of icon is at the Iloc coordinate)

Usage:
  python3 scripts/generate-dmg-background.py
"""

from PIL import Image, ImageDraw, ImageFont
import math
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RESOURCES_DIR = os.path.join(SCRIPT_DIR, "..", "resources")

# Window dimensions (must match dmg-settings.py window_rect)
WIN_W = 512
WIN_H = 320

# Icon positions (must match dmg-settings.py icon_locations)
APP_X, APP_Y = 150, 140
APPS_X, APPS_Y = 362, 140
ICON_SIZE = 80  # must match dmg-settings.py icon_size

# Colors
BG_COLOR = (10, 15, 26)
ARROW_COLOR = (180, 195, 220, 200)
TEXT_COLOR = (150, 165, 185, 180)
BRAND_COLOR = (120, 135, 155, 160)
LINE_COLOR = (80, 95, 115, 100)


def generate(scale=2):
    """Generate background at given scale factor."""
    W = WIN_W * scale
    H = WIN_H * scale

    app_x = APP_X * scale
    app_y = APP_Y * scale
    apps_x = APPS_X * scale
    icon_half = (ICON_SIZE * scale) // 2

    img = Image.new("RGBA", (W, H), (*BG_COLOR, 255))

    # Subtle radial gradient
    pixels = img.load()
    for y in range(H):
        for x in range(W):
            dx = (x - W / 2) / (W / 2)
            dy = (y - H / 2) / (H / 2)
            dist = math.sqrt(dx * dx + dy * dy)
            factor = max(0, 1 - dist * 0.3)
            r = int(10 + 8 * factor)
            g = int(15 + 10 * factor)
            b = int(26 + 15 * factor)
            pixels[x, y] = (r, g, b, 255)

    draw = ImageDraw.Draw(img)

    # Dashed arrow between icons
    margin = 18 * scale
    arrow_y = app_y
    arrow_x_start = app_x + icon_half + margin
    arrow_x_end = apps_x - icon_half - margin
    arrow_width = 4 * scale
    dash_len = 16 * scale
    gap_len = 10 * scale
    head_size = 18 * scale

    x = arrow_x_start
    while x < arrow_x_end - 30 * scale:
        x_end = min(x + dash_len, arrow_x_end - 30 * scale)
        draw.line([(x, arrow_y), (x_end, arrow_y)], fill=ARROW_COLOR, width=arrow_width)
        x += dash_len + gap_len

    # Arrowhead
    draw.polygon(
        [
            (arrow_x_end, arrow_y),
            (arrow_x_end - head_size, int(arrow_y - head_size * 0.7)),
            (arrow_x_end - head_size, int(arrow_y + head_size * 0.7)),
        ],
        fill=ARROW_COLOR,
    )

    # "Drag to install" text
    try:
        font_install = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 13 * scale)
    except Exception:
        font_install = ImageFont.load_default()

    text = "Drag to install"
    bbox = draw.textbbox((0, 0), text, font=font_install)
    tw = bbox[2] - bbox[0]
    tx = (arrow_x_start + arrow_x_end) // 2 - tw // 2
    ty = arrow_y - 42 * scale
    draw.text((tx, ty), text, fill=TEXT_COLOR, font=font_install)

    # Brand text at bottom
    try:
        font_brand = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18 * scale)
    except Exception:
        font_brand = ImageFont.load_default()

    brand = "Edgebric"
    bbox = draw.textbbox((0, 0), brand, font=font_brand)
    bw = bbox[2] - bbox[0]
    bx = W // 2 - bw // 2
    by = H - 52 * scale
    draw.text((bx, by), brand, fill=BRAND_COLOR, font=font_brand)

    # Decorative line
    lw = 60 * scale
    ly = by + 32 * scale
    draw.line([(W // 2 - lw // 2, ly), (W // 2 + lw // 2, ly)], fill=LINE_COLOR, width=scale)

    return img.convert("RGB")


def main():
    # Generate 2x (retina)
    img_2x = generate(scale=2)
    path_2x = os.path.join(RESOURCES_DIR, "dmg-background@2x.png")
    img_2x.save(path_2x, dpi=(144, 144))
    print(f"Saved {path_2x}  ({img_2x.size[0]}x{img_2x.size[1]})")

    # Generate 1x
    img_1x = img_2x.resize((WIN_W, WIN_H), Image.LANCZOS)
    path_1x = os.path.join(RESOURCES_DIR, "dmg-background.png")
    img_1x.save(path_1x, dpi=(72, 72))
    print(f"Saved {path_1x}  ({img_1x.size[0]}x{img_1x.size[1]})")


if __name__ == "__main__":
    main()
