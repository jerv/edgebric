#!/usr/bin/env python3
"""Generate DMG background image with arrow between icon positions."""

from PIL import Image, ImageDraw

# Window dimensions (1x)
W, H = 512, 320

# Icon centers and size from dmg-settings.py
app_x, app_y = 150, 140
folder_x, folder_y = 362, 140
icon_size = 80
half_icon = icon_size // 2

# Light grey background so Finder's dark text labels are readable
bg_color = (212, 212, 212)

# Arrow color — darker grey to contrast with light background
arrow_color = (100, 100, 100)


def draw_arrow(draw, scale=1):
    """Draw a clean arrow between the two icon positions."""
    s = scale

    # Arrow geometry
    pad = 50  # padding from icon edge
    shaft_x1 = (app_x + half_icon + pad) * s
    shaft_y = app_y * s
    arrowhead_length = 8 * s
    arrowhead_half_h = 4 * s
    tip_x = (folder_x - half_icon - pad) * s

    # Shaft ends BEFORE the arrowhead so it doesn't bleed through
    shaft_x2 = tip_x - arrowhead_length

    # Draw shaft — thin line
    shaft_thickness = 2 * s
    draw.line([(shaft_x1, shaft_y), (shaft_x2, shaft_y)],
              fill=arrow_color, width=shaft_thickness)

    # Draw arrowhead — clean triangle, no overlap with shaft
    draw.polygon([
        (tip_x, shaft_y),                           # tip (rightmost point)
        (tip_x - arrowhead_length, shaft_y - arrowhead_half_h),  # top-left
        (tip_x - arrowhead_length, shaft_y + arrowhead_half_h),  # bottom-left
    ], fill=arrow_color)


# --- 1x image ---
img = Image.new("RGB", (W, H), bg_color)
draw_arrow(ImageDraw.Draw(img), scale=1)
img.save("resources/dmg-background.png")
print("Saved resources/dmg-background.png (512x320)")

# --- 2x (Retina) image ---
img2 = Image.new("RGB", (W * 2, H * 2), bg_color)
draw_arrow(ImageDraw.Draw(img2), scale=2)
img2.save("resources/dmg-background@2x.png")
print("Saved resources/dmg-background@2x.png (1024x640)")
