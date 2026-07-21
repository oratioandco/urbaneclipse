#!/usr/bin/env python3
"""Convert ONE Berlin LoD2 CityGML tile to a 3D Tiles tileset (mesh -> b3dm).

Pipeline
--------
1. ``scripts.parse_citygml.parse_tile(source)`` parses the
   ``LoD2_<x>_<y>.zip`` (or its inner ``LoD2_33_<x>_<y>_<n>_BE.xml``) into one
   triangle mesh per ``bldg:Building`` (fan triangulation, EPSG:25833,
   interior rings skipped, vertices not deduplicated - see that module's
   docstring for the known PITFALLS).
2. All buildings are merged into a single triangle mesh (the material is a
   uniform WHITE, so there is no per-building material benefit to keeping
   separate primitives).  Triangle indices are offset by the running vertex
   count so they stay valid in the merged buffer.
3. Vertices are reprojected EPSG:25833 (ETRS89 / UTM 33N) -> EPSG:4978
   (WGS84 geocentric / ECEF) via ``pyproj.Transformer`` with ``always_xy=True``;
   Z is passed through unchanged.
4. Because ECEF coordinates are large (~3.78e6 m) and glTF POSITIONs are
   float32 (~7 significant digits), the tile is stored *relative to a center*
   (RTC, "relative-to-center"): the merged vertices become ``ECEF - center``
   in float32, and the center is carried by the root Tile's ``transform``
   (a pure translation, identity rotation).  This mirrors the py3dtiles IFC
   tiler.  The LOCAL boundingVolumeBox is derived from the centered vertices
   and, per the 3D Tiles spec, the root transform maps it to world (ECEF).

HEIGHT DATUM CAVEAT (known follow-up, NOT fixed here):
   CityGML Z is a DHHN2016 *normal height* (above the geoid / sea level),
   while Cesium's WGS84 ellipsoid is the reference for EPSG:4978.  The geoid
   in Berlin sits ~33-37 m above the ellipsoid, so buildings will render
   ~30-40 m below their visual ground in Cesium until a geoid->ellipsoid
   correction (e.g. via ``pyproj`` with the ETRS89 -> WGS84 + geoid grid, or a
   per-tile constant offset) is applied.  pyproj's plain
   ``EPSG:25833 -> EPSG:4978`` transform treats the input Z as ellipsoidal,
   which is the approximation we knowingly make here.

Material: uniform WHITE baked into the glTF - ``baseColorFactor=[1,1,1,1]``,
``metallicFactor=0``, ``roughnessFactor=1``, ``alphaMode=OPAQUE``,
``doubleSided=True`` (one primitive, one material).

Run::

    .venv/bin/python scripts/convert_tile.py \
        data/citygml/LoD2_392_5820.zip --out data/test_tile
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import pygltflib
from pyproj import Transformer

# Make ``scripts`` importable when run as a script (no package install).
_HERE = Path(__file__).resolve().parent
if str(_HERE.parent) not in sys.path:
    sys.path.insert(0, str(_HERE.parent))

from scripts.parse_citygml import parse_tile  # noqa: E402

from py3dtiles.tileset import Tile, TileSet  # noqa: E402
from py3dtiles.tileset.bounding_volume_box import BoundingVolumeBox  # noqa: E402
from py3dtiles.tileset.content.b3dm import B3dm  # noqa: E402

# Source CRS = Berlin LoD2 horizontal datum (ETRS89 / UTM zone 33N).
# Target CRS = WGS84 geocentric (Earth-centered, Earth-fixed).
SOURCE_CRS = "EPSG:25833"
TARGET_CRS = "EPSG:4978"

# Default Fernsehturm tile, used when no source is given on the CLI.
DEFAULT_TILE = Path(__file__).resolve().parent.parent / "data" / "citygml" / "LoD2_392_5820.zip"

B3DM_URI = "tile.b3dm"  # relative to the tileset.json directory


def merge_buildings(buildings):
    """Merge per-building meshes into one flat (verts, tris) pair (EPSG:25833).

    Triangle indices are offset by the running vertex count so they index
    into the merged vertex buffer.  Buildings with no geometry are skipped.
    """
    vert_lists = []
    tri_lists = []
    base = 0
    n_kept = 0
    for b in buildings:
        vs = b["vertices"]
        ts = b["triangles"]
        if not vs or not ts:
            continue
        n_kept += 1
        vert_lists.append(np.asarray(vs, dtype=np.float64))
        tris = np.asarray(ts, dtype=np.int64) + base
        tri_lists.append(tris)
        base += len(vs)

    if not vert_lists:
        raise ValueError("no geometry found in tile (all buildings empty)")

    verts = np.concatenate(vert_lists, axis=0)
    tris = np.concatenate(tri_lists, axis=0)
    return verts, tris, n_kept


def to_ecef(verts_utm: np.ndarray) -> np.ndarray:
    """Reproject (N,3) UTM-33N verts to ECEF (EPSG:4978), Z passed through."""
    transformer = Transformer.from_crs(SOURCE_CRS, TARGET_CRS, always_xy=True)
    xs, ys, zs = transformer.transform(
        verts_utm[:, 0], verts_utm[:, 1], verts_utm[:, 2]
    )
    return np.column_stack([np.asarray(xs), np.asarray(ys), np.asarray(zs)])


def build_white_material() -> pygltflib.Material:
    return pygltflib.Material(
        pbrMetallicRoughness=pygltflib.PbrMetallicRoughness(
            baseColorFactor=[1.0, 1.0, 1.0, 1.0],  # solid WHITE (linear RGBA)
            roughnessFactor=1.0,
            metallicFactor=0.0,
        ),
        alphaMode=pygltflib.OPAQUE,
        doubleSided=True,
    )


def convert(source: Path, out_dir: Path) -> dict:
    """Convert one CityGML tile to a 3D Tiles tileset under ``out_dir``.

    Returns a dict of structural stats (building/triangle/vertex counts,
    output file sizes) for the caller to report.
    """
    out_dir = out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    tileset_path = out_dir / "tileset.json"

    # 1. Parse -> per-building meshes (EPSG:25833).
    buildings = parse_tile(str(source))
    n_buildings_total = len(buildings)

    # 2. Merge into one mesh.
    verts_utm, tris, n_buildings_kept = merge_buildings(buildings)
    n_verts = int(verts_utm.shape[0])
    n_tris = int(tris.shape[0])

    # 3. Reproject to ECEF.
    verts_ecef = to_ecef(verts_utm)

    # 4. Relative-to-center: center = midpoint of ECEF min/max (keeps the
    #    float32 deltas small and symmetric for precision).
    ecef_min = verts_ecef.min(axis=0)
    ecef_max = verts_ecef.max(axis=0)
    center = (ecef_min + ecef_max) / 2.0
    verts_local = (verts_ecef - center).astype(np.float32)

    # Triangle indices: uint32 (vertex count > 65535, so uint16 won't fit).
    tris_u32 = tris.astype(np.uint32)

    # 5. Build the b3dm (mesh -> glTF -> b3dm) with a baked WHITE material.
    white_material = build_white_material()
    b3dm = B3dm.from_numpy_arrays(
        points=verts_local,
        triangles=tris_u32,
        material=white_material,
    )

    # 6. Local (RTC) bounding box + root transform carrying the ECEF center.
    bbox = BoundingVolumeBox.from_points(verts_local)

    transform = np.identity(4, dtype=np.float64)
    transform[0:3, 3] = center  # pure translation; identity rotation

    tile = Tile(
        geometric_error=0.0,  # leaf tile (no children) -> 0 is allowed
        bounding_volume=bbox,
        refine_mode="REPLACE",
        content_uri=B3DM_URI,
        transform=transform,
    )
    tile.tile_content = b3dm

    tileset = TileSet(geometric_error=500.0)  # root geometric error must be > 0
    tileset.root_tile = tile

    # 7. Write tileset.json (at tileset_path) + tile.b3dm (at out_dir / B3DM_URI).
    tileset.write_to_directory(tileset_path, overwrite=True)

    b3dm_path = out_dir / B3DM_URI
    ts_size = tileset_path.stat().st_size
    b3dm_size = b3dm_path.stat().st_size

    return {
        "source": str(source),
        "out_dir": str(out_dir),
        "tileset_path": str(tileset_path),
        "b3dm_path": str(b3dm_path),
        "buildings_total": n_buildings_total,
        "buildings_kept": n_buildings_kept,
        "vertices": n_verts,
        "triangles": n_tris,
        "tileset_json_bytes": ts_size,
        "b3dm_bytes": b3dm_size,
        "ecef_center": center.tolist(),
        "local_extent": {
            "min": verts_local.min(axis=0).tolist(),
            "max": verts_local.max(axis=0).tolist(),
        },
    }


def main(argv):
    p = argparse.ArgumentParser(
        description="Convert one Berlin LoD2 CityGML tile to a 3D Tiles tileset."
    )
    p.add_argument(
        "source",
        nargs="?",
        default=str(DEFAULT_TILE),
        help="Path to LoD2_<x>_<y>.zip (or inner LoD2_33_*.xml). "
        "Defaults to the Fernsehturm tile: %s" % DEFAULT_TILE,
    )
    p.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent.parent / "data" / "test_tile"),
        help="Output directory for tileset.json + tile.b3dm.",
    )
    args = p.parse_args(argv)

    source = Path(args.source).resolve()
    if not source.exists():
        p.error("source not found: %s" % source)
    out_dir = Path(args.out).resolve()

    stats = convert(source, out_dir)

    print("=" * 70)
    print("CityGML -> 3D Tiles conversion report")
    print("=" * 70)
    print("source                 : %s" % stats["source"])
    print("out_dir                : %s" % stats["out_dir"])
    print("buildings (total)      : %d" % stats["buildings_total"])
    print("buildings (with geom)  : %d" % stats["buildings_kept"])
    print("vertices (merged)      : %d" % stats["vertices"])
    print("triangles (merged)     : %d" % stats["triangles"])
    print("ECEF center (RTC)      : %s" % ["%.3f" % c for c in stats["ecef_center"]])
    print("local extent min       : %s" % ["%.3f" % c for c in stats["local_extent"]["min"]])
    print("local extent max       : %s" % ["%.3f" % c for c in stats["local_extent"]["max"]])
    print("tileset.json           : %s (%d bytes)" % (stats["tileset_path"], stats["tileset_json_bytes"]))
    print("tile.b3dm              : %s (%d bytes)" % (stats["b3dm_path"], stats["b3dm_bytes"]))
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
