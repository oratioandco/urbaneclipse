#!/usr/bin/env python3
"""Work out where in Berlin a landmark's sphere can be seen from eye height.

Output: ``public/viewshed/fernsehturm.bin`` + ``.json``, a run-length-encoded grid the
browser samples to split the daily eclipse paths into usable and blocked stretches.

Method
------
1. Rasterise the LoD2 roofs into a surface model (2.5 m). The landmark's own coarse mesh
   is left out, as in the 3D tiles.
2. Ground height comes from the DGM1 grid where it exists. It only covers a strip around
   the original sightline, so elsewhere it is estimated from building base heights. The
   estimate's error against DGM1 is printed on every run.
3. Sweep rays outward from the sphere. Looking down from the sphere, a spot is visible
   when the eye sits above the steepest obstruction passed so far. Earth curvature and
   refraction are included.

Known limits: LoD2 has no trees, street furniture or bridges to stand on, so "visible"
means no building is in the way.

Run::

    .venv/bin/python scripts/build_viewshed.py              # reuses the cached model
    .venv/bin/python scripts/build_viewshed.py --rebuild
"""
from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import time
import zipfile  # noqa: F401  (parse_tile reads zips; imported early for a clear failure)
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.parse_citygml import parse_tile  # noqa: E402

CITYGML = ROOT / "data" / "citygml"
CACHE = ROOT / "data" / "viewshed" / "surface.npz"
OUT = ROOT / "public" / "viewshed"
HEIGHTMAP = ROOT / "public" / "heightmap" / "berlin-dgm1"

# Grid-km box matching data/berlin-9km (scripts/convert_batch.py --bbox).
X_MIN, Y_MIN, X_MAX, Y_MAX = 383, 5811, 401, 5829
CELL = 2.5
OUTPUT_CELL_M = 5.0
EYE_M = 1.5
SPHERE_CENTRE_AGL = 213.0
# Curvature minus standard refraction: drop = k * d^2 / (2R).
CURVATURE = (1 - 0.13) / (2 * 6_371_000.0)
MAX_RANGE_M = 9500.0
# Replaced by the analytical model in src/lib/landmarks.ts (see convert_tile.py).
REPLACED_BUILDING_IDS = {"DEBE01YYK0000B8a"}

ORIGIN_E = X_MIN * 1000.0
ORIGIN_N = Y_MIN * 1000.0
SIZE = int(((X_MAX + 1 - X_MIN) * 1000) / CELL)

BLOCKED, VISIBLE, BUILDING = 0, 1, 2


def rasterise_tile(path: str):
    """Max roof height per cell for one source tile, plus each building's base."""
    patches = []
    bases = []
    for b in parse_tile(path):
        if b.get("id") in REPLACED_BUILDING_IDS or not b["vertices"] or not b["triangles"]:
            continue
        v = np.asarray(b["vertices"], dtype=np.float64)
        t = np.asarray(b["triangles"], dtype=np.int64)
        bases.append((v[:, 0].mean(), v[:, 1].mean(), v[:, 2].min()))
        x = (v[:, 0] - ORIGIN_E) / CELL
        y = (v[:, 1] - ORIGIN_N) / CELL
        c0, c1 = int(np.floor(x.min())), int(np.ceil(x.max())) + 1
        r0, r1 = int(np.floor(y.min())), int(np.ceil(y.max())) + 1
        if c1 <= 0 or r1 <= 0 or c0 >= SIZE or r0 >= SIZE:
            continue
        patch = np.full((r1 - r0, c1 - c0), np.nan, dtype=np.float32)
        for a, bb, c in t:
            ax, ay, bx, by, cx, cy = x[a], y[a], x[bb], y[bb], x[c], y[c]
            det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(det) < 1e-6:
                continue  # a wall: no footprint of its own
            tc0, tc1 = int(np.floor(min(ax, bx, cx))), int(np.ceil(max(ax, bx, cx))) + 1
            tr0, tr1 = int(np.floor(min(ay, by, cy))), int(np.ceil(max(ay, by, cy))) + 1
            cols = np.arange(tc0, tc1) + 0.5
            rows = np.arange(tr0, tr1) + 0.5
            gx, gy = np.meshgrid(cols, rows)
            l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / det
            l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / det
            l3 = 1 - l1 - l2
            inside = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
            if not inside.any():
                continue
            z = l1 * v[a, 2] + l2 * v[bb, 2] + l3 * v[c, 2]
            ri = (gy[inside] - 0.5).astype(int) - r0
            ci = (gx[inside] - 0.5).astype(int) - c0
            np.fmax.at(patch, (ri, ci), z[inside].astype(np.float32))
        patches.append((r0, c0, patch))
    return patches, bases


def build_surface() -> tuple[np.ndarray, np.ndarray]:
    zips = sorted(
        p
        for p in CITYGML.glob("LoD2_*.zip")
        if X_MIN <= int(p.stem.split("_")[1]) <= X_MAX and Y_MIN <= int(p.stem.split("_")[2]) <= Y_MAX
    )
    print(f"rasterising {len(zips)} tiles")
    roofs = np.full((SIZE, SIZE), np.nan, dtype=np.float32)
    bases: list[tuple[float, float, float]] = []
    with ProcessPoolExecutor() as pool:
        for i, (patches, tile_bases) in enumerate(pool.map(rasterise_tile, map(str, zips)), 1):
            bases.extend(tile_bases)
            for r0, c0, patch in patches:
                rs, cs = max(r0, 0), max(c0, 0)
                re_, ce = min(r0 + patch.shape[0], SIZE), min(c0 + patch.shape[1], SIZE)
                if re_ <= rs or ce <= cs:
                    continue
                sub = patch[rs - r0 : re_ - r0, cs - c0 : ce - c0]
                roofs[rs:re_, cs:ce] = np.fmax(roofs[rs:re_, cs:ce], sub)
            if i % 50 == 0:
                print(f"  {i}/{len(zips)}", flush=True)
    return roofs, np.asarray(bases, dtype=np.float64)


def ground_from_bases(bases: np.ndarray) -> np.ndarray:
    """Ground estimate on a coarse grid from building base heights, then upsampled."""
    coarse_cell = 100.0
    n = int(SIZE * CELL / coarse_cell)
    buckets: dict[tuple[int, int], list[float]] = {}
    for x, y, z in bases:
        c, r = int((x - ORIGIN_E) / coarse_cell), int((y - ORIGIN_N) / coarse_cell)
        if 0 <= r < n and 0 <= c < n:
            buckets.setdefault((r, c), []).append(z)
    g = np.full((n, n), np.nan)
    for (r, c), zs in buckets.items():
        g[r, c] = np.median(zs)
    # Fill gaps (parks, water) by repeated neighbour averaging, then smooth.
    while np.isnan(g).any():
        p = np.pad(g, 1, constant_values=np.nan)
        stack = np.stack([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
        count = np.sum(~np.isnan(stack), axis=0)
        fill = np.nansum(stack, axis=0) / np.maximum(count, 1)
        g = np.where(np.isnan(g) & (count > 0), fill, g)
    for _ in range(2):
        p = np.pad(g, 1, mode="edge")
        g = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:] + 4 * g) / 8
    # Bilinear upsample to the fine grid.
    pos = (np.arange(SIZE) + 0.5) * CELL / coarse_cell - 0.5
    i0 = np.clip(np.floor(pos).astype(int), 0, n - 2)
    f = np.clip(pos - i0, 0, 1).astype(np.float32)
    rows = g[i0] * (1 - f)[:, None] + g[i0 + 1] * f[:, None]
    return (rows[:, i0] * (1 - f) + rows[:, i0 + 1] * f).astype(np.float32)


def apply_dgm(ground: np.ndarray) -> np.ndarray:
    """Use measured ground where DGM1 covers, and report the estimate's error there."""
    header = json.loads(HEIGHTMAP.with_suffix(".json").read_text())
    samples = np.fromfile(HEIGHTMAP.with_suffix(".bin"), dtype="<i2").reshape(header["height"], header["width"])
    to_wgs = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True)
    centres = ORIGIN_E + (np.arange(SIZE) + 0.5) * CELL, ORIGIN_N + (np.arange(SIZE) + 0.5) * CELL
    out = ground.copy()
    errors = []
    bbox = header["bbox"]
    for r in range(SIZE):
        lon, lat = to_wgs.transform(centres[0], np.full(SIZE, centres[1][r]))
        lon, lat = np.asarray(lon), np.asarray(lat)
        ok = (lon >= bbox["lonMin"]) & (lon <= bbox["lonMax"]) & (lat >= bbox["latMin"]) & (lat <= bbox["latMax"])
        if not ok.any():
            continue
        cols = np.round((lon[ok] - bbox["lonMin"]) / header["dLon"]).astype(int)
        rows = np.round((lat[ok] - bbox["latMin"]) / header["dLat"]).astype(int)
        values = samples[rows, cols]
        valid = values != header["nodata"]
        idx = np.nonzero(ok)[0][valid]
        measured = values[valid] * header["scale"] + header["offset"]
        errors.append(np.abs(out[r, idx] - measured))
        out[r, idx] = measured
    e = np.concatenate(errors)
    print(
        f"ground estimate vs DGM1 over {e.size * CELL * CELL / 1e6:.0f} km2: "
        f"median {np.median(e):.2f} m, p95 {np.percentile(e, 95):.2f} m, max {e.max():.2f} m"
    )
    return out


def sweep(roofs: np.ndarray, ground: np.ndarray, east: float, north: float, target_h: float) -> np.ndarray:
    """Per-cell verdict from rays swept out of the target."""
    surface = np.fmax(roofs, ground)
    state = np.where(np.isnan(roofs), BLOCKED, BUILDING).astype(np.uint8)
    step = CELL * 0.8
    samples = int(MAX_RANGE_M / step)
    n_rays = int(2 * np.pi * MAX_RANGE_M / (CELL * 0.8))
    r = (np.arange(samples) + 1) * step
    print(f"sweeping {n_rays} rays of {samples} samples")
    origin_c, origin_r = (east - ORIGIN_E) / CELL, (north - ORIGIN_N) / CELL
    drop = CURVATURE * r * r
    for start in range(0, n_rays, 2000):
        angles = np.arange(start, min(start + 2000, n_rays)) * (2 * np.pi / n_rays)
        cols = (origin_c + np.outer(np.sin(angles), r) / CELL).astype(np.int32)
        rows = (origin_r + np.outer(np.cos(angles), r) / CELL).astype(np.int32)
        inside = (cols >= 0) & (cols < SIZE) & (rows >= 0) & (rows < SIZE)
        c = np.where(inside, cols, 0)
        rr = np.where(inside, rows, 0)
        top = np.where(inside, (surface[rr, c] - drop - target_h) / r, -np.inf)
        eye = (ground[rr, c] + EYE_M - drop - target_h) / r
        steepest = np.maximum.accumulate(top, axis=1)
        # The eye's own cell is excluded: bare ground there must not block the eye above it.
        before = np.concatenate([np.full((top.shape[0], 1), -np.inf), steepest[:, :-1]], axis=1)
        seen = inside & (eye >= before) & np.isnan(roofs[rr, c])
        state[rr[seen], c[seen]] = VISIBLE
    return state


def encode(state: np.ndarray, target_lat: float, target_lon: float) -> None:
    """Resample to a regular lat/lon grid and write it run-length encoded."""
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True)
    to_wgs = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True)
    dlat = OUTPUT_CELL_M / 111_320.0
    dlon = OUTPUT_CELL_M / (111_320.0 * np.cos(np.radians(target_lat)))
    half = MAX_RANGE_M
    lat_min = target_lat - half / 111_320.0
    lon_min = target_lon - half / (111_320.0 * np.cos(np.radians(target_lat)))
    height = int(2 * half / OUTPUT_CELL_M)
    width = height
    packed = bytearray()
    lon_axis = lon_min + (np.arange(width) + 0.5) * dlon
    counts = [0, 0, 0]
    for row in range(height):
        lat = lat_min + (row + 0.5) * dlat
        e, n = to_utm.transform(lon_axis, np.full(width, lat))
        c = np.floor((np.asarray(e) - ORIGIN_E) / CELL).astype(int)
        r = np.floor((np.asarray(n) - ORIGIN_N) / CELL).astype(int)
        ok = (c >= 0) & (c < SIZE - 1) & (r >= 0) & (r < SIZE - 1)
        cc, rr = np.where(ok, c, 0), np.where(ok, r, 0)
        # An output cell is usable if most of its 2.5 m cells are: this keeps footpaths
        # and drops the single-cell specks a person could not actually stand in.
        block = np.stack([state[rr, cc], state[rr, cc + 1], state[rr + 1, cc], state[rr + 1, cc + 1]])
        line = np.where(
            (block == VISIBLE).sum(axis=0) >= 2,
            VISIBLE,
            np.where((block == BUILDING).sum(axis=0) >= 2, BUILDING, BLOCKED),
        )
        line = np.where(ok, line, BLOCKED)
        for v in range(3):
            counts[v] += int((line == v).sum())
        edges = np.concatenate([[0], np.nonzero(np.diff(line))[0] + 1, [width]])
        for a, b in zip(edges[:-1], edges[1:]):
            # One byte per run: value in the top 2 bits, length - 1 in the low 6.
            length = int(b - a)
            value = int(line[a]) << 6
            while length > 0:
                part = min(length, 64)
                packed.append(value | (part - 1))
                length -= part
    OUT.mkdir(parents=True, exist_ok=True)
    bin_path = OUT / "fernsehturm.bin"
    bin_path.write_bytes(bytes(packed))
    header = {
        "format": "urban-eclipse-viewshed",
        "version": 1,
        "landmark": "fernsehturm",
        "binary": bin_path.name,
        "byteLength": bin_path.stat().st_size,
        "encoding": "one byte per run: value in the top 2 bits, length - 1 in the low 6",
        "width": width,
        "height": height,
        "latMin": lat_min,
        "lonMin": lon_min,
        "dLat": dlat,
        "dLon": dlon,
        "rowOrder": "south-to-north",
        "values": {"blocked": BLOCKED, "visible": VISIBLE, "building": BUILDING},
        "eyeHeightM": EYE_M,
        "aimHeightAglM": SPHERE_CENTRE_AGL,
        "limits": "LoD2 buildings only: no trees, street furniture or raised walkways.",
    }
    (OUT / "fernsehturm.json").write_text(json.dumps(header, indent=2) + "\n")
    total = sum(counts)
    print(
        f"wrote {bin_path.stat().st_size / 1024:.0f} KB; "
        f"visible {counts[VISIBLE] / total:.1%}, blocked {counts[BLOCKED] / total:.1%}, building {counts[BUILDING] / total:.1%}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rebuild", action="store_true", help="Re-rasterise the building tiles.")
    args = parser.parse_args()

    source = (ROOT / "src" / "lib" / "landmarks.ts").read_text()
    block = source[source.index("export const FERNSEHTURM") :]
    lat = float(re.search(r"lat:\s*([\d.]+)", block).group(1))
    lon = float(re.search(r"lon:\s*([\d.]+)", block).group(1))
    base = float(re.search(r"baseOrthometric:\s*([\d.]+)", block).group(1))
    east, north = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True).transform(lon, lat)

    started = time.time()
    if CACHE.exists() and not args.rebuild:
        data = np.load(CACHE)
        roofs, bases = data["roofs"], data["bases"]
        print("reused cached surface model")
    else:
        roofs, bases = build_surface()
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(CACHE, roofs=roofs, bases=bases)
    print(f"surface ready in {time.time() - started:.0f}s; {len(bases)} buildings, roofs {np.nanmin(roofs):.0f}..{np.nanmax(roofs):.0f} m")

    ground = apply_dgm(ground_from_bases(bases))
    np.savez_compressed(CACHE.with_name("ground.npz"), ground=ground)
    state = sweep(roofs, ground, east, north, base + SPHERE_CENTRE_AGL)
    np.savez_compressed(CACHE.with_name("state.npz"), state=state)
    encode(state, lat, lon)
    print(f"done in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
