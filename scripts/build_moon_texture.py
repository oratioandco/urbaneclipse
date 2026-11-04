#!/usr/bin/env python3
"""Project NASA's lunar colour map onto the disc as seen from Earth.

Input : a 2:1 cylindrical map centred on 0 degrees longitude, from the CGI Moon Kit
        (https://svs.gsfc.nasa.gov/4720). Credit: NASA's Scientific Visualization Studio.
Output: ``public/textures/moon-nearside.jpg``, greyscale, with north up and lunar east
        (Mare Crisium) on the right.

Libration is ignored: the real view shifts by up to about 8 degrees over a month.

Run with Pillow available::

    python3 scripts/build_moon_texture.py path/to/lroc_color_poles_2k.tif
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SIZE = 512
OUT = Path(__file__).resolve().parent.parent / "public" / "textures" / "moon-nearside.jpg"


def main(source: str) -> None:
    Image.MAX_IMAGE_PIXELS = None
    albedo = np.asarray(Image.open(source).convert("L"), dtype=np.float32) / 255.0
    height, width = albedo.shape

    axis = (np.arange(SIZE) + 0.5) / SIZE * 2 - 1
    x, y = np.meshgrid(axis, -axis)  # image rows run downward, north is up
    inside = x * x + y * y <= 1
    z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
    lat = np.arcsin(np.clip(y, -1, 1))
    lon = np.arctan2(x, z)

    col = np.clip((lon / (2 * np.pi) + 0.5) * width - 0.5, 0, width - 2)
    row = np.clip((0.5 - lat / np.pi) * height - 0.5, 0, height - 2)
    c0, r0 = col.astype(int), row.astype(int)
    fc, fr = col - c0, row - r0
    disc = (
        albedo[r0, c0] * (1 - fc) * (1 - fr)
        + albedo[r0, c0 + 1] * fc * (1 - fr)
        + albedo[r0 + 1, c0] * (1 - fc) * fr
        + albedo[r0 + 1, c0 + 1] * fc * fr
    )

    # Spread the disc over the full range, so the maria hold up at small sizes.
    low, high = np.percentile(disc[inside], [1, 99.5])
    disc = np.clip((disc - low) / (high - low), 0, 1)
    disc[~inside] = disc[inside].mean()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray((disc * 255).astype(np.uint8)).save(OUT, quality=85, optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main(sys.argv[1])
