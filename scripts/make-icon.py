# SPDX-License-Identifier: MIT
"""
Renders the app icon: a macOS-proportioned squircle (824 px of artwork centred in 1024, the
same superellipse Apple uses) in deep indigo, carrying the three chevrons that also mark the
managed block in the hosts file. Rendered at 4x and downsampled for clean edges.

Outputs resources/icon.png (1024), resources/icon.ico (Windows) and, via iconutil, icon.icns.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "resources"
S = 4
N = 1024 * S
ART, OFF = 824 * S, 100 * S

# --- squircle body -------------------------------------------------------------------------
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
cx = cy = N / 2
a = ART / 2
n = 5.0  # superellipse exponent; ~Apple's continuous-corner shape
d = np.abs((xx + 0.5 - cx) / a) ** n + np.abs((yy + 0.5 - cy) / a) ** n
mask = (d <= 1.0).astype(np.float32)

t = np.clip((yy - OFF) / ART, 0, 1)[..., None]
top = np.array([84, 104, 222], np.float32)
bot = np.array([33, 46, 124], np.float32)
rgb = top * (1 - t) + bot * t
# a soft highlight across the upper third, so it reads as a surface rather than a flat tile
hl = (np.clip(1 - (yy - OFF) / (ART * 0.6), 0, 1) ** 2 * 0.12)[..., None]
rgb = rgb * (1 - hl) + 255 * hl
body = Image.fromarray(np.dstack([rgb, mask * 255]).astype(np.uint8), "RGBA")

# --- chevrons --------------------------------------------------------------------------------
W = 88 * S
R = W // 2
def chevron(x0: int, alpha: float) -> Image.Image:
    layer = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    pts = [(x0 * S, 372 * S), ((x0 + 140) * S, 512 * S), (x0 * S, 652 * S)]
    dr.line(pts, fill=(255, 255, 255, 255), width=W, joint="curve")
    for x, y in (pts[0], pts[-1]):
        dr.ellipse([x - R, y - R, x + R, y + R], fill=(255, 255, 255, 255))
    if alpha < 1:
        layer.putalpha(layer.getchannel("A").point(lambda v: int(v * alpha)))
    return layer

# visually centred: stroke extents run from x0-44 to x0+528, so x0 = 270 centres on 512
for x0, alpha in ((270, 1.0), (442, 0.72), (614, 0.44)):
    body = Image.alpha_composite(body, chevron(x0, alpha))

icon = body.resize((1024, 1024), Image.LANCZOS)
OUT.mkdir(exist_ok=True)
icon.save(OUT / "icon.png")
icon.save(OUT / "icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print("wrote icon.png and icon.ico")
