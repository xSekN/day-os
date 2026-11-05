#!/usr/bin/env python3
"""Generate the Day OS app icons (PNG) with Pillow.

A bold yellow ring with a gap (a day "in progress") around a white check,
on the app's near-black background. Run from the repo root:

    python3 tools/make_icons.py
"""
import math
import os

from PIL import Image, ImageDraw

BG = (10, 12, 15, 255)
ACCENT = (255, 210, 63, 255)
WHITE = (244, 246, 248, 255)
SS = 4  # supersampling factor for smooth edges

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')


def draw_icon(size, scale=1.0):
    n = size * SS
    img = Image.new('RGBA', (n, n), BG)
    d = ImageDraw.Draw(img)
    cx = cy = n / 2
    r = n * 0.30 * scale  # ring radius (to stroke centre)
    w = n * 0.105 * scale  # ring thickness

    # Ring: from -50 deg round to 250 deg (clockwise, y down), gap top-right.
    start, end = -50, 250
    box = [cx - r - w / 2, cy - r - w / 2, cx + r + w / 2, cy + r + w / 2]
    d.arc(box, start, end, fill=ACCENT, width=int(w))
    for a in (start, end):  # round caps
        x = cx + r * math.cos(math.radians(a))
        y = cy + r * math.sin(math.radians(a))
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=ACCENT)

    # Dot in the gap, like the "now" marker on a progress ring.
    a = (end + start + 360) / 2  # middle of the gap
    x = cx + r * math.cos(math.radians(a))
    y = cy + r * math.sin(math.radians(a))
    dr = w * 0.62
    d.ellipse([x - dr, y - dr, x + dr, y + dr], fill=WHITE)

    # Check mark.
    cw = n * 0.085 * scale
    p1 = (cx - n * 0.125 * scale, cy + n * 0.005 * scale)
    p2 = (cx - n * 0.03 * scale, cy + n * 0.10 * scale)
    p3 = (cx + n * 0.14 * scale, cy - n * 0.095 * scale)
    d.line([p1, p2, p3], fill=WHITE, width=int(cw), joint='curve')
    for p in (p1, p3):
        d.ellipse([p[0] - cw / 2, p[1] - cw / 2, p[0] + cw / 2, p[1] + cw / 2], fill=WHITE)
    # Fill the elbow so it stays crisp.
    d.ellipse([p2[0] - cw / 2, p2[1] - cw / 2, p2[0] + cw / 2, p2[1] + cw / 2], fill=WHITE)

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ('icon-192.png', 192, 1.0),
        ('icon-512.png', 512, 1.0),
        ('apple-touch-icon.png', 180, 1.0),
        ('icon-32.png', 32, 1.15),
        ('icon-maskable-512.png', 512, 0.82),  # content inside the 80% safe zone
    ]
    for name, size, scale in jobs:
        img = draw_icon(size, scale).convert('RGB')  # iOS wants no alpha
        path = os.path.join(OUT, name)
        img.save(path, optimize=True)
        print('wrote', os.path.relpath(path), f'{size}x{size}')


if __name__ == '__main__':
    main()
