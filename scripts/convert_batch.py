#!/usr/bin/env python3
"""Batch-convert Berlin LoD2 CityGML tiles into ONE combined 3D Tiles tileset.

Default selection (UNCHANGED, this is what ships): the 236 Mitte +
Friedrichshain + Lichtenberg tiles (UTM-33N grid x 388..406, y 5814..5826).
Opt-in flags widen the selection to the whole city (925 tiles on disk):

    --all                       every LoD2_<x>_<y>.zip in data/citygml
    --bbox XMIN YMIN XMAX YMAX  inclusive grid-km box (UTM-33N km, EPSG:25833)
    --tiles 392_5820,393_5820   explicit tile keys (or @file with one per line)

Output
------
``data/berlin/tileset.json`` + one ``tile_<x>_<y>.b3dm`` per selected tile,
plus ``_manifest.json`` (the resume ledger, see below).

Tileset shape
-------------
A root Tile (no content, large geometric error, identity transform) with one
child Tile per source tile.  Each child carries:

* its own ECEF root ``transform`` (a pure translation by the child's RTC
  center, exactly as in ``convert_tile.py``), and
* a per-tile ``tile_<x>_<y>.b3dm`` content (uniform WHITE material) whose
  vertices are stored relative to that RTC center in float32.

The root ``boundingVolume`` is the union of all children's transformed
(ECEF) bounding boxes, auto-computed by ``Tile.add_child`` and re-synced in
``TileSet.to_dict`` -> it encloses the whole selection in ECEF.

Per-tile conversion pipeline (REUSED from ``convert_tile.py``):
  parse_tile  ->  merge_buildings  ->  +geoid 39.5  ->  EPSG:25833->4978
                ->  RTC center  ->  white-material b3dm via py3dtiles

Memory
------
Each source tile is parsed, converted and written to its own ``.b3dm`` one
at a time, then dropped: the child Tile is added with ``tile_content=None``
(only its ``content_uri``), so ``write_as_json`` never re-holds all meshes in
memory.  Peak memory is one tile's geometry, independent of selection size.

Resume / idempotency
--------------------
A 925-tile run takes hours and MUST survive interruption.  ``_manifest.json``
in the output directory is an append-as-you-go ledger: after every converted
tile its stats (source mtime/size, RTC center, LOCAL bbox min/max, counts)
are flushed to disk atomically.  On a later run a tile is SKIPPED when

  * a manifest entry exists whose recorded source mtime+size match the zip
    on disk, and
  * either its ``.b3dm`` exists and is newer than the zip, or the entry
    records that the tile legitimately has no geometry.

Skipped tiles still get their child Tile rebuilt from the manifest (RTC
center + local bbox), so ``tileset.json`` is always complete and correct for
the *current* selection even if only one tile was actually reconverted.
``--force`` reconverts everything; ``--clean`` wipes the output directory
first (the pre-resume behaviour).

Run::

    .venv/bin/python scripts/convert_batch.py                    # 236 central
    .venv/bin/python scripts/convert_batch.py --all --out data/berlin-full
    .venv/bin/python scripts/convert_batch.py --bbox 388 5814 406 5826
    .venv/bin/python scripts/convert_batch.py --tiles 392_5820 --dry-run

Exit codes: 0 ok, 2 usage, 3 no geometry produced, 4 output/manifest I/O error.
"""

from __future__ import annotations

from typing import Iterable, Sequence

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
TILE_KEY_RE = re.compile(r"^(\d+)[_,](\d+)$")

GEOID = GEOID_UNDULATION_BERLIN  # +39.5 m: DHHN2016 normal -> WGS84 ellipsoidal

# Root GE large enough that the root always refines into its leaf children at
# any reasonable viewing distance (we only have one LOD level).  Children are
# full-detail leaves -> geometric_error 0.
ROOT_GEOMETRIC_ERROR = 5000.0
CHILD_GEOMETRIC_ERROR = 0.0

MANIFEST_NAME = "_manifest.json"
MANIFEST_VERSION = 1

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_NO_GEOMETRY = 3
EXIT_IO = 4


# --------------------------------------------------------------------------
# Selection
# --------------------------------------------------------------------------

def available_tiles(citygml_dir: Path) -> list[tuple[int, int, Path]]:
    """Return sorted [(x, y, path)] for EVERY ``LoD2_<x>_<y>.zip`` on disk."""
    tiles: list[tuple[int, int, Path]] = []
    for name in sorted(os.listdir(citygml_dir)):
        m = TILE_RE.match(name)
        if not m:
            continue
        tiles.append((int(m.group(1)), int(m.group(2)), citygml_dir / name))
    return sorted(tiles, key=lambda t: (t[0], t[1]))


def select_tiles(
    citygml_dir: Path,
    *,
    all_tiles: bool = False,
    bbox: Sequence[int] | None = None,
    keys: Iterable[tuple[int, int]] | None = None,
) -> list[tuple[int, int, Path]]:
    """Return sorted [(x, y, path)] for the selected tiles that exist on disk.

    With no selection argument this is the historical default: the hardcoded
    ``GRID_X`` x ``GRID_Y`` central grid (236 tiles present on disk).
    """
    avail = available_tiles(citygml_dir)
    if all_tiles:
        return avail
    if keys is not None:
        wanted = set(keys)
    elif bbox is not None:
        xmin, ymin, xmax, ymax = bbox
        return [t for t in avail if xmin <= t[0] <= xmax and ymin <= t[1] <= ymax]
    else:
        wanted = {(x, y) for x in GRID_X for y in GRID_Y}
    return [t for t in avail if (t[0], t[1]) in wanted]


def parse_tile_keys(raw: str) -> list[tuple[int, int]]:
    """Parse ``--tiles`` (comma/space separated ``x_y``, or ``@path`` file)."""
    if raw.startswith("@"):
        text = Path(raw[1:]).expanduser().read_text()
    else:
        text = raw
    keys: list[tuple[int, int]] = []
    for token in re.split(r"[,\s]+", text.strip()):
        if not token:
            continue
        m = TILE_KEY_RE.match(token)
        if not m:
            raise ValueError("bad tile key %r (expected <x>_<y>, e.g. 392_5820)" % token)
        keys.append((int(m.group(1)), int(m.group(2))))
    if not keys:
        raise ValueError("--tiles produced an empty selection")
    return keys


# --------------------------------------------------------------------------
# Manifest (resume ledger)
# --------------------------------------------------------------------------

def manifest_path(out_dir: Path) -> Path:
    return out_dir / MANIFEST_NAME


def load_manifest(out_dir: Path) -> dict[str, dict]:
    """Load the resume ledger; a missing/corrupt manifest means 'start fresh'."""
    p = manifest_path(out_dir)
    if not p.exists():
        return {}
    try:
        raw = json.loads(p.read_text())
    except (OSError, ValueError):
        print("  warning: unreadable %s - ignoring (full reconvert)" % p)
        return {}
    if not isinstance(raw, dict) or raw.get("version") != MANIFEST_VERSION:
        return {}
    entries = raw.get("tiles", {})
    return entries if isinstance(entries, dict) else {}


def save_manifest(out_dir: Path, entries: dict[str, dict]) -> None:
    """Atomically write the ledger (tmp + replace) so a kill cannot truncate it."""
    p = manifest_path(out_dir)
    tmp = p.with_suffix(".json.tmp")
    payload = {"version": MANIFEST_VERSION, "tiles": entries}
    tmp.write_text(json.dumps(payload))
    os.replace(tmp, p)


def tile_key(x: int, y: int) -> str:
    return "%d_%d" % (x, y)


def is_up_to_date(entry: dict | None, src: Path, out_dir: Path) -> bool:
    """True when the recorded conversion still matches the source zip on disk."""
    if not entry:
        return False
    try:
        st = src.stat()
    except OSError:
        return False
    if entry.get("src_size") != st.st_size:
        return False
    if abs(float(entry.get("src_mtime", -1)) - st.st_mtime) > 1e-6:
        return False
    if entry.get("skipped"):
        return True  # legitimately empty tile: nothing to (re)write
    uri = entry.get("uri")
    if not uri:
        return False
    b3dm = out_dir / uri
    if not b3dm.exists():
        return False
    return b3dm.stat().st_mtime >= st.st_mtime


def child_from_entry(entry: dict) -> Tile | None:
    """Rebuild a child Tile from a manifest entry (no reparse of the source)."""
    center = entry.get("ecef_center")
    lo, hi = entry.get("local_min"), entry.get("local_max")
    uri = entry.get("uri")
    if not center or not lo or not hi or not uri:
        return None
    corners = np.array([lo, hi], dtype=np.float32)
    transform = np.identity(4, dtype=np.float64)
    transform[0:3, 3] = np.asarray(center, dtype=np.float64)
    return Tile(
        geometric_error=CHILD_GEOMETRIC_ERROR,
        bounding_volume=BoundingVolumeBox.from_points(corners),
        refine_mode="ADD",
        content_uri=uri,
        transform=transform,
    )


# --------------------------------------------------------------------------
# Conversion
# --------------------------------------------------------------------------

def _build_transformers():
    """One UTM->ECEF transformer, reused across all tiles.

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
    st = src_path.stat()
    base_stats = {
        "x": x, "y": y,
        "src_mtime": st.st_mtime, "src_size": st.st_size,
    }
    buildings = parse_tile(str(src_path))
    n_total = len(buildings)
    if not buildings:
        return None, {
            **base_stats, "skipped": "no buildings",
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
    #    left None so write_as_json never re-serialises every mesh at once.
    local_min = verts_local.min(axis=0)
    local_max = verts_local.max(axis=0)
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
        **base_stats,
        "uri": uri,
        "buildings_total": n_total,
        "buildings_kept": n_kept,
        "vertices": int(verts_local.shape[0]),
        "triangles": int(tris_u32.shape[0]),
        "b3dm_bytes": b3dm_bytes,
        "ecef_center": center.tolist(),
        "local_min": local_min.tolist(),
        "local_max": local_max.tolist(),
    }
    return child, stats


def _fmt_dur(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    if h:
        return "%dh%02dm%02ds" % (h, m, s)
    if m:
        return "%dm%02ds" % (m, s)
    return "%ds" % s


def convert_batch(
    out_dir: Path,
    *,
    all_tiles: bool = False,
    bbox: Sequence[int] | None = None,
    keys: Iterable[tuple[int, int]] | None = None,
    force: bool = False,
    clean: bool = False,
    progress_every: int = 10,
    limit: int | None = None,
) -> dict:
    """Convert all selected tiles into one combined tileset under ``out_dir``."""
    out_dir = out_dir.resolve()
    if clean and out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    utm_to_ecef, ecef_to_ll = _build_transformers()
    tiles = select_tiles(
        CITYGML_DIR, all_tiles=all_tiles, bbox=bbox, keys=keys
    )
    if limit is not None:
        tiles = tiles[:limit]
    print("selected %d tiles from %s" % (len(tiles), CITYGML_DIR))

    manifest = {} if (force or clean) else load_manifest(out_dir)

    root = Tile(
        geometric_error=ROOT_GEOMETRIC_ERROR,
        bounding_volume=None,  # auto-computed by add_child / sync
        refine_mode="ADD",
        transform=np.identity(4, dtype=np.float64),
    )

    t0 = time.time()
    all_stats: list[dict] = []
    n_children = 0
    n_converted = 0
    n_reused = 0
    n_failed = 0
    convert_time = 0.0
    for i, (x, y, src) in enumerate(tiles, 1):
        key = tile_key(x, y)
        entry = manifest.get(key)

        # ---- resume: reuse an up-to-date conversion without touching the zip
        if not force and is_up_to_date(entry, src, out_dir):
            all_stats.append(entry)
            n_reused += 1
            if not entry.get("skipped"):
                child = child_from_entry(entry)
                if child is not None:
                    root.add_child(child)
                    n_children += 1
                    continue
                # manifest entry too old/incomplete to rebuild -> reconvert
                n_reused -= 1
                all_stats.pop()
            else:
                continue

        t_tile = time.time()
        try:
            child, stats = convert_one_tile(x, y, src, out_dir, utm_to_ecef)
        except Exception as e:  # keep going on a single bad tile
            print("  [%d/%d] tile_%s FAILED: %s" % (i, len(tiles), key, e))
            n_failed += 1
            st = src.stat()
            all_stats.append({
                "x": x, "y": y, "skipped": "error: %s" % e,
                "src_mtime": st.st_mtime, "src_size": st.st_size,
                "buildings_total": 0, "buildings_kept": 0,
                "vertices": 0, "triangles": 0, "b3dm_bytes": 0,
                "ecef_center": None,
            })
            continue
        convert_time += time.time() - t_tile
        n_converted += 1

        # Flush the ledger after EVERY tile: an interrupted run resumes here.
        manifest[key] = stats
        try:
            save_manifest(out_dir, manifest)
        except OSError as e:
            raise RuntimeError("cannot write manifest: %s" % e) from e

        if child is None:
            print("  [%d/%d] tile_%s skipped (%s)" % (
                i, len(tiles), key, stats.get("skipped", "empty")))
            all_stats.append(stats)
            continue

        root.add_child(child)
        n_children += 1
        all_stats.append(stats)
        if progress_every and (i % progress_every == 0 or i == len(tiles)):
            elapsed = time.time() - t0
            remaining = len(tiles) - i
            rate = (convert_time / n_converted) if n_converted else 0.0
            eta = rate * remaining
            print(
                "  [%d/%d] tile_%s  bldg=%d  tri=%d  %d KB  |  done=%d "
                "remaining=%d  elapsed=%s  %.2fs/tile  ETA=%s" % (
                    i, len(tiles), key,
                    stats["buildings_kept"], stats["triangles"],
                    stats["b3dm_bytes"] // 1024,
                    i, remaining, _fmt_dur(elapsed), rate, _fmt_dur(eta)))

    if n_children == 0:
        raise RuntimeError("no tile produced any geometry - aborting")

    tileset = TileSet(geometric_error=ROOT_GEOMETRIC_ERROR)
    tileset.root_tile = root

    tileset_path = out_dir / "tileset.json"
    tileset.write_as_json(tileset_path)  # writes JSON only; b3dm already on disk
    save_manifest(out_dir, manifest)

    run_time = time.time() - t0

    # ---- Aggregate stats + structural verification ----
    total_buildings = sum(s.get("buildings_kept", 0) for s in all_stats)
    total_triangles = sum(s.get("triangles", 0) for s in all_stats)
    total_vertices = sum(s.get("vertices", 0) for s in all_stats)
    total_b3dm_bytes = sum(s.get("b3dm_bytes", 0) for s in all_stats)

    # Overall lon/lat extent from per-tile ECEF centers (sanity check that
    # the combined tileset really covers the intended area).
    xs_sel = [t[0] for t in tiles]
    ys_sel = [t[1] for t in tiles]
    x_lo, x_hi = (min(xs_sel), max(xs_sel)) if xs_sel else (0, 0)
    y_lo, y_hi = (min(ys_sel), max(ys_sel)) if ys_sel else (0, 0)
    lons, lats = [], []
    sample_centers = {}
    for s in all_stats:
        c = s.get("ecef_center")
        if not c:
            continue
        lon, lat = ecef_to_ll.transform(c[0], c[1], c[2])[:2]
        lons.append(lon)
        lats.append(lat)
        if s["x"] in (x_lo, x_hi) or s["y"] in (y_lo, y_hi):
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
        "converted_this_run": n_converted,
        "reused_from_manifest": n_reused,
        "failed": n_failed,
        "skipped": [s for s in all_stats if s.get("skipped")],
        "total_buildings_kept": total_buildings,
        "total_triangles": total_triangles,
        "total_vertices": total_vertices,
        "total_b3dm_bytes": total_b3dm_bytes,
        "total_b3dm_mb": round(total_b3dm_bytes / (1024 * 1024), 2),
        "run_time_s": round(run_time, 1),
        "convert_time_s": round(convert_time, 1),
        "sec_per_converted_tile": round(convert_time / n_converted, 2) if n_converted else None,
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
        description="Batch-convert Berlin LoD2 tiles into one 3D Tiles tileset "
                    "(default: the 236 central tiles)."
    )
    p.add_argument(
        "--out", default=str(DEFAULT_OUT),
        help="Output directory for tileset.json + *.b3dm (default: %(default)s)",
    )
    sel = p.add_mutually_exclusive_group()
    sel.add_argument(
        "--all", action="store_true",
        help="Convert EVERY LoD2_<x>_<y>.zip found in data/citygml (all of Berlin).",
    )
    sel.add_argument(
        "--bbox", nargs=4, type=int, metavar=("XMIN", "YMIN", "XMAX", "YMAX"),
        help="Inclusive UTM-33N grid-km box, e.g. --bbox 388 5814 406 5826.",
    )
    sel.add_argument(
        "--tiles",
        help="Explicit tile keys '<x>_<y>' (comma/space separated), or @FILE.",
    )
    p.add_argument(
        "--force", action="store_true",
        help="Reconvert every selected tile even if it is already up to date.",
    )
    p.add_argument(
        "--clean", action="store_true",
        help="Delete the output directory first (pre-resume behaviour).",
    )
    p.add_argument(
        "--limit", type=int, default=None,
        help="Only process the first N selected tiles (measurement / smoke runs).",
    )
    p.add_argument(
        "--progress-every", type=int, default=10, metavar="N",
        help="Print a progress line every N tiles (0 = quiet, default: %(default)s).",
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="List the selection (and what would be reused vs converted) and exit.",
    )
    args = p.parse_args(argv)

    keys = None
    if args.tiles:
        try:
            keys = parse_tile_keys(args.tiles)
        except (ValueError, OSError) as e:
            print("error: %s" % e, file=sys.stderr)
            return EXIT_USAGE
    if args.bbox and (args.bbox[0] > args.bbox[2] or args.bbox[1] > args.bbox[3]):
        print("error: --bbox min must be <= max", file=sys.stderr)
        return EXIT_USAGE
    if not CITYGML_DIR.is_dir():
        print("error: CityGML source dir not found: %s" % CITYGML_DIR, file=sys.stderr)
        return EXIT_USAGE

    out_dir = Path(args.out).resolve()

    if args.dry_run:
        tiles = select_tiles(
            CITYGML_DIR, all_tiles=args.all, bbox=args.bbox, keys=keys
        )
        if args.limit is not None:
            tiles = tiles[: args.limit]
        manifest = {} if args.force else load_manifest(out_dir)
        reuse = [
            (x, y) for x, y, src in tiles
            if not args.force and is_up_to_date(manifest.get(tile_key(x, y)), src, out_dir)
        ]
        src_bytes = sum(src.stat().st_size for _, _, src in tiles)
        print("dry run: %d tiles selected (%.1f MB of source zips)" % (
            len(tiles), src_bytes / (1024 * 1024)))
        print("  would reuse   : %d" % len(reuse))
        print("  would convert : %d" % (len(tiles) - len(reuse)))
        print("  out_dir       : %s" % out_dir)
        if tiles:
            print("  first / last  : tile_%d_%d ... tile_%d_%d" % (
                tiles[0][0], tiles[0][1], tiles[-1][0], tiles[-1][1]))
        return EXIT_OK

    try:
        report = convert_batch(
            out_dir,
            all_tiles=args.all,
            bbox=args.bbox,
            keys=keys,
            force=args.force,
            clean=args.clean,
            progress_every=args.progress_every,
            limit=args.limit,
        )
    except RuntimeError as e:
        print("error: %s" % e, file=sys.stderr)
        return EXIT_NO_GEOMETRY if "no tile produced" in str(e) else EXIT_IO
    except OSError as e:
        print("error: output I/O failed: %s" % e, file=sys.stderr)
        return EXIT_IO

    print("=" * 70)
    print("Batch CityGML -> 3D Tiles conversion report")
    print("=" * 70)
    print("out_dir                : %s" % report["out_dir"])
    print("tileset.json           : %s (%d bytes)" % (
        report["tileset_path"], report["tileset_json_bytes"]))
    print("asset.version          : %s" % report["asset_version"])
    print("has root boundingVolume: %s" % report["has_root_bounding_volume"])
    print("selected tiles         : %d" % report["selected_tiles"])
    print("converted this run     : %d" % report["converted_this_run"])
    print("reused (up to date)    : %d" % report["reused_from_manifest"])
    print("failed tiles           : %d" % report["failed"])
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
    print("run time               : %.1f s (convert %.1f s, %s s/tile)" % (
        report["run_time_s"], report["convert_time_s"],
        report["sec_per_converted_tile"]))
    if report["skipped"]:
        print("skipped detail         :")
        for s in report["skipped"]:
            print("  tile_%d_%d : %s" % (s["x"], s["y"], s.get("skipped")))
    print("=" * 70)
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
