#!/usr/bin/env python3
"""Generate a small committed 'core' 3D-Tiles subset for deployment.

The full 236-tile Mitte+Fi+Li tileset (183MB) is gitignored (too large for git).
For deployment via Coolify (which builds from a git clone), this writes a small
committed subset covering the Lichtenberger-Brücke -> Fernsehturm sightline into
public/berlin-core/ so the deployed app renders buildings + a working occlusion
raycast without the full dataset.

Usage: .venv/bin/python scripts/subset_tileset.py
Reads data/berlin/tileset.json (+ its 236 .b3dm); writes public/berlin-core/.
"""
import json
import os
import re
import shutil
from itertools import product

import numpy as np

SRC = "data/berlin"
DST = "public/berlin-core"
# Sightline tiles: Fernsehturm (392,5820) -> Lichtenberger Brücke (398,5818),
# plus one tile of north/south context for the Frankfurter Allee street canyon.
X_RANGE = (392, 398)
Y_RANGE = (5818, 5821)


def in_subset(uri: str) -> bool:
    m = re.search(r"tile_(\d+)_(\d+)\.b3dm", uri)
    return bool(m) and X_RANGE[0] <= int(m.group(1)) <= X_RANGE[1] and Y_RANGE[0] <= int(m.group(2)) <= Y_RANGE[1]


def main() -> None:
    ts = json.load(open(f"{SRC}/tileset.json"))
    root = ts["root"]
    keep = [c for c in root["children"] if in_subset(c["content"]["uri"])]
    if not keep:
        raise SystemExit("no tiles matched the subset range")

    # Recompute the root ECEF AABB from every transformed child-box corner. Converted
    # tiles use local ENU coordinates, so their transforms include rotation as well as
    # translation; treating the local half-axes as ECEF would under-bound the subset.
    xs, ys, zs = [], [], []
    for c in keep:
        transform = np.array(c["transform"], dtype=float).reshape((4, 4), order="F")
        b = c["boundingVolume"]["box"]
        center = np.array(b[0:3], dtype=float)
        axes = np.array([b[3:6], b[6:9], b[9:12]], dtype=float)
        for signs in product((-1, 1), repeat=3):
            local = center + sum(sign * axis for sign, axis in zip(signs, axes))
            world = transform @ np.array([*local, 1.0])
            xs.append(float(world[0]))
            ys.append(float(world[1]))
            zs.append(float(world[2]))
    cx, cy, cz = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2
    hx, hy, hz = (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2, (max(zs) - min(zs)) / 2
    root["boundingVolume"] = {"box": [cx, cy, cz, hx, 0, 0, 0, hy, 0, 0, 0, hz]}
    root["children"] = keep

    os.makedirs(DST, exist_ok=True)
    with open(f"{DST}/tileset.json", "w") as f:
        json.dump(ts, f)
    size = 0
    for c in keep:
        uri = c["content"]["uri"]
        shutil.copy(f"{SRC}/{uri}", f"{DST}/{uri}")
        size += os.path.getsize(f"{DST}/{uri}")
    print(f"core subset: {len(keep)} tiles, {size / 1e6:.1f} MB -> {DST}/")


if __name__ == "__main__":
    main()
