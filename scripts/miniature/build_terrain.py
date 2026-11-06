#!/usr/bin/env python3
"""Sample the ground model onto a grid around the tower, for the miniature's base.

Output: public/city/terrain.bin (little-endian int16 decimetres above the tower's base,
rows north to south) and terrain.json. Scene axes match build_city.mjs.

Usage: python build_terrain.py <path to data/viewshed/ground.npz>
"""
import json
import sys
from pathlib import Path

import numpy as np
from pyproj import Transformer

TOWER_LAT, TOWER_LON, TOWER_BASE = 52.520815, 13.409419, 34.6
ORIGIN_E, ORIGIN_N, CELL = 383000.0, 5811000.0, 2.5  # scripts/build_viewshed.py
SPACING_M, HALF_M = 40.0, 9400.0
OUT = Path(__file__).resolve().parent.parent.parent / "public" / "city"

ground = np.load(sys.argv[1])["ground"]
local = Transformer.from_crs(
    f"+proj=tmerc +lat_0={TOWER_LAT} +lon_0={TOWER_LON} +k=1 +x_0=0 +y_0=0 +ellps=GRS80",
    "EPSG:25833",
    always_xy=True,
)
axis = np.arange(-HALF_M, HALF_M + SPACING_M, SPACING_M)
xs, ys = np.meshgrid(axis, axis[::-1])
east, north = local.transform(xs, ys)
col = np.clip(((east - ORIGIN_E) / CELL).astype(int), 0, ground.shape[1] - 1)
row = np.clip(((north - ORIGIN_N) / CELL).astype(int), 0, ground.shape[0] - 1)
heights = ground[row, col] - TOWER_BASE
print(f"terrain {heights.shape}, {np.nanmin(heights):.1f} to {np.nanmax(heights):.1f} m about the tower base")
OUT.mkdir(parents=True, exist_ok=True)
np.round(np.nan_to_num(heights, nan=0.0) * 10).astype("<i2").tofile(OUT / "terrain.bin")
(OUT / "terrain.json").write_text(json.dumps({"size": len(axis), "spacing": SPACING_M, "half": HALF_M}))
