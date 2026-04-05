import os

application = defines.get("app", "dist/mac-arm64/Edgebric.app")
appname = os.path.basename(application)

# --- Volume format ---
format = "UDBZ"
size = None
files = [application]
symlinks = {"Applications": "/Applications"}
icon = "resources/icon.icns"

# --- Background image ---
# Must match window_rect dimensions: 512x320 at 1x.
# dmgbuild will auto-detect resources/dmg-background@2x.png for retina.
background = "resources/dmg-background.png"

# --- Icon and text sizing ---
icon_size = 80
text_size = 12

# --- Window position and size ---
# Format: ((screen_x, screen_y), (width, height))
# screen_y runs bottom-to-top (Cocoa convention)
# width/height defines the window content area
window_rect = ((200, 120), (512, 320))

# --- Icon positions ---
# Coordinates: (x, y) = center of icon in content area
# Origin (0,0) = top-left; x increases right, y increases down
# Centered horizontally: 256 +/- 106 = 150 and 362
# Centered vertically: 140 (slightly above midpoint to account for label below icon)
icon_locations = {
    appname: (150, 140),
    "Applications": (362, 140),
}

hide_extensions = [appname]
