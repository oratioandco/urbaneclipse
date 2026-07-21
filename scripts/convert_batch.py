#!/usr/bin/env python3
"""Batch-convert the 236 Mitte + Friedrichshain + Lichtenberg LoD2 CityGML
tiles into ONE combined 3D Tiles tileset.

Output
------
``data/berlin/tileset.json`` + 236 ``tile_<x>_<y>.b3dm`` files.

Tileset shape
-------------
A root Tile (no content, large geometric error, identity transform) with one
child Tile per source tile (236 children).  Each child carries:

* its own ECEF root ``transform`` (a pure translation by the child's RTC
  center, exactly as in ``convert_tile.py``), and
* a per-tile ``tile_<x>_<y>.b3dm`` content (uniform WHITE material) whose
  vertices are stored relative to that RTC center in float32.

The root ``boundingVolume`` is the union of all children's transformed
(ECEF) bounding boxes, auto-computed by ``Tile.add_child`` and re-synced in
``TileSet.to_dict`` -> it encloses all of central Berlin in ECEF.

Per-tile conversion pipeline (REUSED from ``convert_tile.py``):
  parse_tile  ->  merge_buildings  ->  +geoid 39.5  ->  EPSG:25883->4978
                ->  RTC center  ->  white-material b3dm via py3dtiles

Memory
------
Each source tile is parsed, converted and written to its own ``.b3dm`` one
at a time, then dropped: the child Tile is added with ``tile_content=None``
(only its ``content_uri``), so ``write_as_json`` never re-holds all 236
meshes in memory.  Peak memory is one tile's geometry.

Run::

    .venv/bin/python scripts/convert_batch.py
    .venv/bin/python scripts/convert_batch.py --out data/berlin
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

import numpy as np
from pyproj import Transformer

# Make ``scripts`` importable when run as a script (no package install).
_HERE = Path(__file__).resolve().parent
if str(_HERE.parent) not in sys.path:
    sys.path.insert(0, str(_HERE.parent))

from scripts.parse_citygml import parse_tile  # noqa: E402
from scripts.convert_tile import (  # noqa: E402
    GEOID_UNDULATION_BERLIN,
    SOURCE_CRS,
    TARGET_CRS,
    build_white_material,
    merge_buildings,
)
from py3dtiles.tileset import Tile, TileSet  # noqa: E402
from py3dtiles.tileset.bounding_volume_box import BoundingVolumeBox  # noqa: E402
from py3dtiles.tileset.content.b3dm import B3dm  # noqa: E402

REPO_ROOT = _HERE.parent
CITYGML_DIR = REPO_ROOT / "data" / "citygml"
DEFAULT_OUT = REPO_ROOT / "data" / "berlin"

# Mitte + Friedrichshain + Lichtenberg selection: UTM-33N grid x 388..406,
# y 5814..5826 (19 x 13 = 247 nominal cells; 236 actually present on disk).
GRID_X = range(388, 407)  # 388..406 inclusive
GRID_Y = range(5814, 5827)  # 5814..5826 inclusive
TILE_RE = re.compile(r"^LoD2_(\d+)_(\d+)\.zip$")

GEOID = GEOID_UNDULATION_BERLIN  # +39.5 m: DHHN2016 normal -> WGS84 ellipsoidal

# Root GE large enough that the root always refines into its leaf children at
# any reasonable viewing distance (we only have one LOD level).  Children are
# full-detail leaves -> geometric_error 0.
ROOT_GEOMETRIC_ERROR = 5000.0
CHILD_GEOMETRIC_ERROR = 0.0


def select_tiles(citygml_dir: Path) -> list[tuple[int, int, Path]]:
    """Return sorted [(x, y, path)] for the grid tiles that exist on disk."""
    wanted = {(x, y) for x in GRID_X for y in GRID_Y}
    tiles: list[tuple[int, int, Path]] = []
    for name in sorted(os.listdir(citygml_dir)):
        m = TILE_RE.match(name)
        if not m:
            continue
        x, y = int(m.group(1)), int(m.group(2))
        if (x, y) in wanted:
            tiles.append((x, y, citygml_dir / name))
    return tiles


def _build_transformers():
    """One UTM->ECEF transformer, reused across all 236 tiles.

    This is the same reprojection as ``convert_tile.to_ecef`` but hoists the
    ``Transformer.from_crs`` construction out of the per-tile loop (it is the
    only piece not already amortised by ``convert_tile``).
    """
    utm_to_ecef = Transformer.from_crs(SOURCE_CRS, TARGET_CRS, always_xy=True)
    ecef_to_ll = Transformer.from_crs(TARGET_CRS, "EPSG:4326", always_xy=True)
    return utm_to_ecef, ecef_to_ll


def convert_one_tile(x, y, src_path, out_dir, utm_to_ecef):
    """Convert one source tile -> write ``tile_<x>_<y>.b3dm`` -> return (child Tile, stats).

    Returns ``(None, stats)`` for tiles with no usable geometry so the caller
    can skip them while keeping the run going.
    """
    buildings = parse_tile(str(src_path))
    n_total = len(buildings)
    if not buildings:
        return None, {
            "x": x, "y": y, "skipped": "no buildings",
            "buildings_total": 0, "buildings_kept": 0,
            "vertices": 0, "triangles": 0, "b3dm_bytes": 0,
            "ecef_center": None,
        }

    # Reused conversion logic from convert_tile.py:
    verts_utm, tris, n_kept = merge_buildings(buildings)

    # 1. Vertical datum: lift DHHN2016 normal heights to ellipsoidal (geoid).
    verts_utm = verts_utm.copy()
    verts_utm[:, 2] += GEOID

    # 2. Reproject EPSG:25833 -> EPSG:4978 (ECEF).
    xs, ys, zs = utm_to_ecef.transform(
        verts_utm[:, 0], verts_utm[:, 1], verts_utm[:, 2]
    )
    verts_ecef = np.column_stack([
        np.asarray(xs, dtype=np.float64),
        np.asarray(ys, dtype=np.float64),
        np.asarray(zs, dtype=np.float64),
    ])

    # 3. Relative-to-center: center = midpoint of ECEF min/max (float32 deltas).
    ecef_min = verts_ecef.min(axis=0)
    ecef_max = verts_ecef.max(axis=0)
    center = (ecef_min + ecef_max) / 2.0
    verts_local = (verts_ecef - center).astype(np.float32)
    tris_u32 = tris.astype(np.uint32)

    # 4. White-material b3dm via py3dtiles (same material as convert_tile.py).
    b3dm = B3dm.from_numpy_arrays(
        points=verts_local,
        triangles=tris_u32,
        material=build_white_material(),
    )
    uri = "tile_%d_%d.b3dm" % (x, y)
    b3dm_path = out_dir / uri
    b3dm.save_as(b3dm_path)  # write directly; we will NOT hold tile_content
    b3dm_bytes = b3dm_path.stat().st_size

    # 5. Child Tile: local RTC bbox + ECEF center transform.  tile_content
    #    left None so write_as_json never re-serialises 236 meshes at once.
    bbox = BoundingVolumeBox.from_points(verts_local)
    transform = np.identity(4, dtype=np.float64)
    transform[0:3, 3] = center

    child = Tile(
        geometric_error=CHILD_GEOMETRIC_ERROR,
        bounding_volume=bbox,
        refine_mode="ADD",
        content_uri=uri,
        transform=transform,
    )

    stats = {
        "x": x, "y": y,
        "buildings_total": n_total,
        "buildings_kept": n_kept,
        "vertices": int(verts_local.shape[0]),
        "triangles": int(tris_u32.shape[0]),
        "b3dm_bytes": b3dm_bytes,
        "ecef_center": center.tolist(),
    }
    return child, stats


def convert_batch(out_dir: Path) -> dict:
    """Convert all selected tiles into one combined tileset under ``out_dir``."""
    out_dir = out_dir.resolve()
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    utm_to_ecef, ecef_to_ll = _build_transformers()
    tiles = select_tiles(CITYGML_DIR)
    print("selected %d tiles from %s" % (len(tiles), CITYGML_DIR))

    root = Tile(
        geometric_error=ROOT_GEOMETRIC_ERROR,
        bounding_volume=None,  # auto-computed by add_child / sync
        refine_mode="ADD",
        transform=np.identity(4, dtype=np.float64),
    )

    t0 = time.time()
    all_stats: list[dict] = []
    n_children = 0
    for i, (x, y, src) in enumerate(tiles, 1):
        try:
            child, stats = convert_one_tile(x, y, src, out_dir, utm_to_ecef)
        except Exception as e:  # keep going on a single bad tile
            print("  [%3d/%d] tile_%d_%d FAILED: %s" % (i, len(tiles), x, y, e))
            all_stats.append({
                "x": x, "y": y, "skipped": "error: %s" % e,
                "buildings_total": 0, "buildings_kept": 0,
                "vertices": 0, "triangles": 0, "b3dm_bytes": 0,
                "ecef_center": None,
            })
            continue

        if child is None:
            print("  [%3d/%d] tile_%d_%d skipped (%s)" % (
                i, len(tiles), x, y, stats.get("skipped", "empty")))
            all_stats.append(stats)
            continue

        root.add_child(child)
        n_children += 1
        all_stats.append(stats)
        if i % 10 == 0 or i == len(tiles):
            elapsed = time.time() - t0
            print("  [%3d/%d] tile_%d_%d  bldg=%d  tri=%d  %d KB  (%.1fs)" % (
                i, len(tiles), x, y,
                stats["buildings_kept"], stats["triangles"],
                stats["b3dm_bytes"] // 1024, elapsed))

    if n_children == 0:
        raise RuntimeError("no tile produced any geometry - aborting")

    tileset = TileSet(geometric_error=ROOT_GEOMETRIC_ERROR)
    tileset.root_tile = root

    tileset_path = out_dir / "tileset.json"
    tileset.write_as_json(tileset_path)  # writes JSON only; b3dm already on disk

    run_time = time.time() - t0

    # ---- Aggregate stats + structural verification ----
    total_buildings = sum(s.get("buildings_kept", 0) for s in all_stats)
    total_triangles = sum(s.get("triangles", 0) for s in all_stats)
    total_vertices = sum(s.get("vertices", 0) for s in all_stats)
    total_b3dm_bytes = sum(s.get("b3dm_bytes", 0) for s in all_stats)

    # Overall lon/lat extent from per-tile ECEF centers (sanity check that
    # the combined tileset really covers central Berlin).
    lons, lats = [], []
    sample_centers = {}
    for s in all_stats:
        c = s.get("ecef_center")
        if not c:
            continue
        lon, lat = ecef_to_ll.transform(c[0], c[1], c[2])[:2]
        lons.append(lon)
        lats.append(lat)
        if s["x"] in (388, 406) or s["y"] in (5814, 5826):
            sample_centers["tile_%d_%d" % (s["x"], s["y"])] = (lon, lat)

    # Verify the written tileset.json structurally.
    with tileset_path.open() as f:
        ts_json = json.load(f)
    asset_version = ts_json.get("asset", {}).get("version")
    root_children = ts_json.get("root", {}).get("children", [])
    written_child_count = len(root_children)
    has_root_box = "boundingVolume" in ts_json.get("root", {})

    report = {
        "out_dir": str(out_dir),
        "tileset_path": str(tileset_path),
        "tileset_json_bytes": tileset_path.stat().st_size,
        "selected_tiles": len(tiles),
        "child_count": n_children,
        "written_child_count": written_child_count,
        "skipped": [s for s in all_stats if s.get("skipped")],
        "total_buildings_kept": total_buildings,
        "total_triangles": total_triangles,
        "total_vertices": total_vertices,
        "total_b3dm_bytes": total_b3dm_bytes,
        "total_b3dm_mb": round(total_b3dm_bytes / (1024 * 1024), 2),
        "run_time_s": round(run_time, 1),
        "asset_version": asset_version,
        "has_root_bounding_volume": has_root_box,
        "lon_extent": [round(min(lons), 5), round(max(lons), 5)] if lons else None,
        "lat_extent": [round(min(lats), 5), round(max(lats), 5)] if lats else None,
        "sample_corner_centers_lonlat": {
            k: [round(v[0], 5), round(v[1], 5)] for k, v in sample_centers.items()
        },
    }
    return report


def main(argv):
    p = argparse.ArgumentParser(
        description="Batch-convert the 236 central Berlin LoD2 tiles into one 3D Tiles tileset."
    )
    p.add_argument(
        "--out", default=str(DEFAULT_OUT),
        help="Output directory for tileset.json + *.b3dm (default: %(default)s)",
    )
    args = p.parse_args(argv)

    report = convert_batch(Path(args.out))

    print("=" * 70)
    print("Batch CityGML -> 3D Tiles conversion report")
    print("=" * 70)
    print("out_dir                : %s" % report["out_dir"])
    print("tileset.json           : %s (%d bytes)" % (
        report["tileset_path"], report["tileset_json_bytes"]))
    print("asset.version          : %s" % report["asset_version"])
    print("has root boundingVolume: %s" % report["has_root_bounding_volume"])
    print("selected tiles         : %d" % report["selected_tiles"])
    print("child tiles (content)  : %d" % report["child_count"])
    print("children in JSON       : %d" % report["written_child_count"])
    print("skipped tiles          : %d" % len(report["skipped"]))
    print("total buildings (kept) : %d" % report["total_buildings_kept"])
    print("total vertices         : %d" % report["total_vertices"])
    print("total triangles        : %d" % report["total_triangles"])
    print("total .b3dm on disk    : %.2f MB" % report["total_b3dm_mb"])
    print("lon extent (centers)   : %s" % report["lon_extent"])
    print("lat extent (centers)   : %s" % report["lat_extent"])
    print("sample corner centers (lon,lat):")
    for k, v in sorted(report["sample_corner_centers_lonlat"].items()):
        print("  %-16s : %.5f, %.5f" % (k, v[0], v[1]))
    print("run time               : %.1f s" % report["run_time_s"])
    if report["skipped"]:
        print("skipped detail         :")
        for s in report["skipped"]:
            print("  tile_%d_%d : %s" % (s["x"], s["y"], s.get("skipped")))
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
