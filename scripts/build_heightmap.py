#!/usr/bin/env python3
"""Build a compact browser-samplable ground-elevation heightmap from Berlin DGM1.

Input  : ``data/dgm1/DGM1_<E>_<N>.zip`` produced by ``scripts/fetch_dgm1.py``
         (1 m ASCII XYZ, EPSG:25833, DHHN2016 normal heights).
Output : ``data/heightmap/berlin-dgm1.bin`` + ``berlin-dgm1.json`` (header).

VERTICAL DATUM -- READ THIS BEFORE CONSUMING THE ASSET
------------------------------------------------------
The samples are **ORTHOMETRIC (DHHN2016 normal / "NHN") heights in metres**.
They are *not* WGS84-ellipsoidal.  The geoid undulation is deliberately NOT
baked in, and is instead reported in the header (``geoidUndulation``) so the
consumer applies exactly the same convention as ``scripts/convert_tile.py``::

    h_ellipsoidal = H_orthometric + N

``convert_tile.py`` uses a single constant ``GEOID_UNDULATION_BERLIN = 39.5``
for the LoD2 buildings.  For the ground to line up with the building bases the
consumer MUST use the same N the buildings were built with -- the header
therefore carries both:

* ``geoidUndulation.appliedByConvertTile`` -- 39.5, the value the b3dm meshes
  were shifted by.  **Use this one** unless/until ``convert_tile.py`` changes.
* ``geoidUndulation.gcg2016`` -- the true GCG2016 undulation over this AOI
  (min/mean/max), computed via PROJ's official BKG grid.  Informational: it
  quantifies how wrong the 39.5 constant is (~-0.3 m over central Berlin).

Both the DGM1 and the Berlin LoD2 CityGML are referenced to **DHHN2016**
(verified, see ``fetch_dgm1.py`` docstring), so no datum shift is needed
between ground and buildings.

BINARY LAYOUT (``berlin-dgm1.bin``)
-----------------------------------
Raw, headerless, contiguous::

    int16 little-endian, ``width * height`` samples, row-major.
    value  = int16 sample
    height = value * scale + offset          (scale = 0.1 m, offset = 0.0)
    nodata = -32768                          (never a valid height)

    index(row, col) = row * width + col
    row 0   = SOUTH edge (latMin);  row increases NORTHWARD
    col 0   = WEST  edge (lonMin);  col increases EASTWARD

    lon(col) = lonMin + col * dLon           (dLon = (lonMax-lonMin)/(width-1))
    lat(row) = latMin + row * dLat           (dLat = (latMax-latMin)/(height-1))

The grid is regular in *geographic* (EPSG:4326) coordinates so a browser can
sample it with a plain bilinear interpolation on lon/lat -- no reprojection at
runtime.  Node values are the mean of the underlying 1 m DGM1 postings inside
each node's cell (box decimation), which is anti-aliased rather than a nearest
-neighbour pick, so a single lamppost-sized pit cannot dominate a node.

Exit codes
----------
0  heightmap written and all internal sanity checks passed
2  bad usage / missing inputs
3  DGM1 payload could not be parsed (unexpected XYZ shape / out-of-sheet rows)
4  produced heightmap failed a sanity check (nodata holes, absurd heights,
   AOI does not contain the required reference points)

Run::

    .venv/bin/python scripts/build_heightmap.py
    .venv/bin/python scripts/build_heightmap.py --spacing 10 --margin 250
    .venv/bin/python scripts/build_heightmap.py --probe 52.5106,13.4652 \
                                                --probe 52.5208,13.4093
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import zipfile
from pathlib import Path

import numpy as np

# PROJ network is needed to pull the BKG GCG2016 quasigeoid grid on demand.
os.environ.setdefault("PROJ_NETWORK", "ON")
import pyproj  # noqa: E402

_HERE = Path(__file__).resolve().parent
if str(_HERE.parent) not in sys.path:
    sys.path.insert(0, str(_HERE.parent))

from scripts.fetch_dgm1 import REFERENCE_POINTS, expand_for_reference_points  # noqa: E402

# --- constants ---------------------------------------------------------------

UTM33 = "EPSG:25833"
WGS84 = "EPSG:4326"
SHEET_KM = 2
SHEET_M = SHEET_KM * 1000
POSTING_M = 1.0

SCALE = 0.1  # int16 unit = 1 decimetre
OFFSET = 0.0
NODATA = -32768

# Must match scripts/convert_tile.py::GEOID_UNDULATION_BERLIN.
GEOID_UNDULATION_CONVERT_TILE = 39.5

# Plausibility envelope for bare-earth Berlin (DHHN2016 metres), applied to the
# 0.5/99.5 PERCENTILES rather than the absolute extremes: the DGM1 legitimately
# contains deep man-made pits (rail cuttings, canal locks, building excavations)
# that sit far below the surrounding terrain, and clipping the check to
# percentiles keeps the gate about "is the DATUM/parse right" instead of
# "is any single pixel unusual".  General Berlin terrain runs ~30-60 m, with
# Kreuzberg ~66 m and the Muggelberge ~115 m.
H_MIN_PLAUSIBLE = 25.0
H_MAX_PLAUSIBLE = 130.0
PCTL_LO, PCTL_HI = 0.5, 99.5

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_PARSE = 3
EXIT_SANITY = 4

_SHEET_RE = re.compile(r"DGM1_(\d+)_(\d+)\.zip$")
_TILE_URI_RE = re.compile(r"tile_(\d+)_(\d+)\.b3dm$")


# --- AOI ---------------------------------------------------------------------


def aoi_utm_from_tileset(tileset_path: Path, margin_m: float) -> tuple[float, float, float, float]:
    """(e_min, e_max, n_min, n_max) in EPSG:25833 metres, padded by *margin_m*."""
    doc = json.loads(tileset_path.read_text(encoding="utf-8"))
    es: list[int] = []
    ns: list[int] = []
    for child in doc.get("root", {}).get("children") or []:
        uri = (child.get("content") or {}).get("uri", "")
        m = _TILE_URI_RE.search(str(uri))
        if m:
            es.append(int(m.group(1)))
            ns.append(int(m.group(2)))
    if not es:
        raise SystemExit(f"[heightmap] no LoD2 tile children in {tileset_path}")
    return (
        min(es) * 1000.0 - margin_m,
        (max(es) + 1) * 1000.0 + margin_m,
        min(ns) * 1000.0 - margin_m,
        (max(ns) + 1) * 1000.0 + margin_m,
    )


def geographic_bbox(
    utm_box: tuple[float, float, float, float], n_edge: int = 256
) -> tuple[float, float, float, float]:
    """Largest lon/lat box *inscribed* in the UTM rectangle *utm_box*.

    A geographic grid is wanted (so the browser can sample without
    reprojecting), but a lon/lat box that CIRCUMSCRIBES the UTM rectangle would
    have corners outside the DGM1 coverage and hence nodata holes.  UTM 33N and
    geographic axes differ by the meridian convergence (~0.3 deg in Berlin), so
    the inscribed box is only ~30 m smaller per side -- a cheap price for a
    hole-free grid.  Each edge is sampled densely and the *worst* (innermost)
    value along it is taken.
    """
    e0, e1, n0, n1 = utm_box
    e = np.linspace(e0, e1, n_edge)
    n = np.linspace(n0, n1, n_edge)
    tr = pyproj.Transformer.from_crs(UTM33, WGS84, always_xy=True)
    lon_w, _ = tr.transform(np.full(n_edge, e0), n)  # west edge
    lon_e, _ = tr.transform(np.full(n_edge, e1), n)  # east edge
    _, lat_s = tr.transform(e, np.full(n_edge, n0))  # south edge
    _, lat_n = tr.transform(e, np.full(n_edge, n1))  # north edge
    return float(np.max(lon_w)), float(np.max(lat_s)), float(np.min(lon_e)), float(np.min(lat_n))


def sheet_extent(sheet_paths: list[Path]) -> tuple[float, float, float, float]:
    """(e_min, e_max, n_min, n_max) metres covered by the fetched DGM1 sheets."""
    es: list[int] = []
    ns: list[int] = []
    for p in sheet_paths:
        m = _SHEET_RE.search(p.name)
        if not m:
            raise SystemExit(f"[heightmap] non-DGM1 file in the input directory: {p.name}")
        es.append(int(m.group(1)) * 1000)
        ns.append(int(m.group(2)) * 1000)
    return float(min(es)), float(max(es) + SHEET_M), float(min(ns)), float(max(ns) + SHEET_M)


# --- DGM1 mosaic -------------------------------------------------------------


def load_sheet(zip_path: Path) -> tuple[int, int, np.ndarray]:
    """Parse one DGM1 sheet zip -> (e0_m, n0_m, grid[2000, 2000] float32).

    ``grid[j, i]`` is the posting whose CENTRE is at
    ``(e0 + i + 0.5, n0 + j + 0.5)``, i.e. row 0 = south, col 0 = west.
    Missing postings stay NaN.  Rows outside the declared sheet are a hard
    error -- the file is not what its name claims.
    """
    m = _SHEET_RE.search(zip_path.name)
    if not m:
        raise SystemExit(f"[heightmap] unexpected sheet filename: {zip_path.name}")
    e0 = int(m.group(1)) * 1000
    n0 = int(m.group(2)) * 1000

    with zipfile.ZipFile(zip_path) as zf:
        members = [n for n in zf.namelist() if n.lower().endswith(".xyz")]
        if len(members) != 1:
            raise SystemExit(f"[heightmap] {zip_path.name}: expected 1 .xyz member, got {members}")
        raw = zf.read(members[0]).decode("ascii", errors="strict")

    flat = np.fromstring(raw, sep=" ")  # noqa: NPY003 - text mode, still supported
    del raw
    if flat.size == 0 or flat.size % 3 != 0:
        raise SystemExit(f"[heightmap] {zip_path.name}: XYZ token count {flat.size} not a multiple of 3")
    pts = flat.reshape(-1, 3)
    del flat

    n_side = SHEET_M  # 2000 postings per side at 1 m
    grid = np.full((n_side, n_side), np.nan, dtype=np.float32)

    ix = np.rint(pts[:, 0] - e0 - 0.5).astype(np.int64)
    iy = np.rint(pts[:, 1] - n0 - 0.5).astype(np.int64)
    if ix.min() < 0 or ix.max() >= n_side or iy.min() < 0 or iy.max() >= n_side:
        raise SystemExit(
            f"[heightmap] {zip_path.name}: postings fall outside the declared sheet "
            f"(E {pts[:,0].min():.1f}..{pts[:,0].max():.1f}, N {pts[:,1].min():.1f}..{pts[:,1].max():.1f})"
        )
    grid[iy, ix] = pts[:, 2].astype(np.float32)
    filled = np.count_nonzero(~np.isnan(grid))
    if filled != pts.shape[0]:
        # duplicate coordinates would silently overwrite -- surface it
        print(
            f"[heightmap] warn {zip_path.name}: {pts.shape[0]} rows -> {filled} unique cells",
            file=sys.stderr,
        )
    return e0, n0, grid


def build_mosaic(sheet_paths: list[Path]) -> tuple[int, int, np.ndarray]:
    """Stitch sheets into one (e0, n0, mosaic[H, W]) float32 raster, NaN-filled."""
    metas = [_SHEET_RE.search(p.name) for p in sheet_paths]
    if any(m is None for m in metas):
        raise SystemExit("[heightmap] non-DGM1 file in the input directory")
    es = [int(m.group(1)) * 1000 for m in metas]  # type: ignore[union-attr]
    ns = [int(m.group(2)) * 1000 for m in metas]  # type: ignore[union-attr]
    e0, n0 = min(es), min(ns)
    w = (max(es) + SHEET_M) - e0
    h = (max(ns) + SHEET_M) - n0
    mosaic = np.full((h, w), np.nan, dtype=np.float32)
    for path in sheet_paths:
        se, sn, grid = load_sheet(path)
        mosaic[sn - n0 : sn - n0 + SHEET_M, se - e0 : se - e0 + SHEET_M] = grid
        print(f"[heightmap] loaded {path.name}  z {np.nanmin(grid):.2f}..{np.nanmax(grid):.2f} m")
        del grid
    return e0, n0, mosaic


# --- sampling ----------------------------------------------------------------


def sample_cells(
    mosaic: np.ndarray,
    mos_e0: int,
    mos_n0: int,
    lon: np.ndarray,
    lat: np.ndarray,
    cell_m: float,
) -> np.ndarray:
    """Mean DGM1 height inside a *cell_m* box around each (lat, lon) node.

    ``lon``/``lat`` are 2-D node grids of identical shape.  Returns float32 with
    NaN where the box has no DGM1 coverage.
    """
    tr = pyproj.Transformer.from_crs(WGS84, UTM33, always_xy=True)
    e, n = tr.transform(lon, lat)
    half = max(int(round(cell_m / 2.0)), 1)

    # Node centre in mosaic index space.
    ci = np.rint(e - mos_e0 - 0.5).astype(np.int64)
    cj = np.rint(n - mos_n0 - 0.5).astype(np.int64)

    h, w = mosaic.shape
    # Integral-image style averaging would be faster, but the grid is only
    # ~280k nodes and clarity wins here; vectorise over the offset window.
    acc = np.zeros(lon.shape, dtype=np.float64)
    cnt = np.zeros(lon.shape, dtype=np.int32)
    for dj in range(-half, half + 1):
        jj = cj + dj
        okj = (jj >= 0) & (jj < h)
        jjc = np.clip(jj, 0, h - 1)
        for di in range(-half, half + 1):
            ii = ci + di
            ok = okj & (ii >= 0) & (ii < w)
            vals = mosaic[jjc, np.clip(ii, 0, w - 1)]
            good = ok & ~np.isnan(vals)
            acc += np.where(good, vals, 0.0)
            cnt += good
    out = np.where(cnt > 0, acc / np.maximum(cnt, 1), np.nan).astype(np.float32)
    return out


def geoid_undulation(lon: np.ndarray, lat: np.ndarray) -> np.ndarray | None:
    """GCG2016 undulation N = h_ellipsoidal - H_DHHN2016, metres, or None.

    Uses PROJ's official BKG grid (fetched from the PROJ CDN when
    ``PROJ_NETWORK=ON``).  Returns None if the grid is unavailable so the build
    still succeeds offline -- the header then reports the constant only.
    """
    try:
        pyproj.network.set_network_enabled(True)
        src = pyproj.CRS.from_user_input("EPSG:4326+7837")  # WGS84 2D + DHHN2016 height
        dst = pyproj.CRS("EPSG:4979")  # WGS84 3D (ellipsoidal height)
        tr = pyproj.Transformer.from_crs(src, dst, always_xy=True)
        zeros = np.zeros_like(lon, dtype=np.float64)
        _, _, h = tr.transform(lon, lat, zeros)
        h = np.asarray(h, dtype=np.float64)
        if not np.isfinite(h).any() or np.nanmax(np.abs(h)) > 100.0:
            return None
        return h
    except Exception as exc:  # noqa: BLE001 - informational only, never fatal
        print(f"[heightmap] warn: GCG2016 undulation unavailable ({exc})", file=sys.stderr)
        return None


# --- main --------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--dgm1", type=Path, default=Path("data/dgm1"))
    ap.add_argument("--tileset", type=Path, default=Path("public/berlin-core/tileset.json"))
    ap.add_argument("--out", type=Path, default=Path("data/heightmap"))
    ap.add_argument("--name", default="berlin-dgm1")
    ap.add_argument("--spacing", type=float, default=10.0, help="node spacing in metres")
    ap.add_argument("--margin", type=float, default=250.0, help="AOI padding in metres")
    ap.add_argument(
        "--probe",
        action="append",
        default=[],
        metavar="LAT,LON",
        help="print the sampled height at this point (repeatable)",
    )
    args = ap.parse_args(argv)

    if not args.tileset.is_file():
        print(f"[heightmap] tileset not found: {args.tileset}", file=sys.stderr)
        return EXIT_USAGE
    sheets = sorted(args.dgm1.glob("DGM1_*.zip"))
    if not sheets:
        print(f"[heightmap] no DGM1 sheets in {args.dgm1}; run scripts/fetch_dgm1.py", file=sys.stderr)
        return EXIT_USAGE

    t0 = time.time()
    want = expand_for_reference_points(
        aoi_utm_from_tileset(args.tileset, args.margin), args.margin
    )
    have = sheet_extent(sheets)
    # Never sample outside the fetched sheets -- that is the only way this
    # pipeline can produce nodata holes, so clamp (loudly) instead.
    utm_box = (
        max(want[0], have[0]), min(want[1], have[1]),
        max(want[2], have[2]), min(want[3], have[3]),
    )
    if utm_box != want:
        print(f"[heightmap] AOI clamped to fetched DGM1 coverage "
              f"(wanted E {want[0]:.0f}..{want[1]:.0f} N {want[2]:.0f}..{want[3]:.0f})")
    if utm_box[0] >= utm_box[1] or utm_box[2] >= utm_box[3]:
        print("[heightmap] fetched sheets do not overlap the AOI", file=sys.stderr)
        return EXIT_USAGE
    lon_min, lat_min, lon_max, lat_max = geographic_bbox(utm_box)
    print(f"[heightmap] AOI UTM33 : E {utm_box[0]:.0f}..{utm_box[1]:.0f}  N {utm_box[2]:.0f}..{utm_box[3]:.0f}")
    print(f"[heightmap] AOI WGS84 : lon {lon_min:.5f}..{lon_max:.5f}  lat {lat_min:.5f}..{lat_max:.5f}")

    # Node counts from the requested ground spacing at the AOI centre latitude.
    lat_mid = 0.5 * (lat_min + lat_max)
    m_per_deg_lat = 111132.0
    m_per_deg_lon = 111320.0 * math.cos(math.radians(lat_mid))
    width = int(math.ceil((lon_max - lon_min) * m_per_deg_lon / args.spacing)) + 1
    height = int(math.ceil((lat_max - lat_min) * m_per_deg_lat / args.spacing)) + 1

    lons = np.linspace(lon_min, lon_max, width)
    lats = np.linspace(lat_min, lat_max, height)
    lon_g, lat_g = np.meshgrid(lons, lats)  # row 0 = south
    print(f"[heightmap] grid     : {width} x {height} = {width*height} nodes "
          f"(~{args.spacing:.0f} m, {width*height*2/1e6:.2f} MB int16)")

    try:
        mos_e0, mos_n0, mosaic = build_mosaic(sheets)
    except SystemExit as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_PARSE
    print(f"[heightmap] mosaic   : {mosaic.shape[1]} x {mosaic.shape[0]} m from E{mos_e0} N{mos_n0}")

    heights = sample_cells(mosaic, mos_e0, mos_n0, lon_g, lat_g, args.spacing)
    n_hole = int(np.count_nonzero(np.isnan(heights)))
    h_valid = heights[~np.isnan(heights)]
    if h_valid.size == 0:
        print("[heightmap] no valid samples", file=sys.stderr)
        return EXIT_SANITY
    p_lo = float(np.percentile(h_valid, PCTL_LO))
    p_hi = float(np.percentile(h_valid, PCTL_HI))
    print(f"[heightmap] heights  : {h_valid.min():.2f}..{h_valid.max():.2f} m DHHN2016, "
          f"mean {h_valid.mean():.2f}, p{PCTL_LO}={p_lo:.2f} p{PCTL_HI}={p_hi:.2f}, holes {n_hole}")
    for label, idx in (("min", int(np.nanargmin(heights))), ("max", int(np.nanargmax(heights)))):
        r, c = divmod(idx, width)
        print(f"[heightmap]   {label} {heights.flat[idx]:.2f} m at "
              f"{lats[r]:.5f},{lons[c]:.5f}")

    # --- sanity gates --------------------------------------------------------
    problems: list[str] = []
    if p_lo < H_MIN_PLAUSIBLE or p_hi > H_MAX_PLAUSIBLE:
        problems.append(
            f"height percentiles {p_lo:.1f}..{p_hi:.1f} m outside the plausible "
            f"Berlin envelope {H_MIN_PLAUSIBLE}..{H_MAX_PLAUSIBLE} m"
        )
    if n_hole:
        problems.append(f"{n_hole} nodata node(s) -- AOI is not fully covered by the fetched sheets")
    for label, rlat, rlon in REFERENCE_POINTS:
        if not (lon_min <= rlon <= lon_max and lat_min <= rlat <= lat_max):
            problems.append(f"AOI does not contain {label} ({rlat}, {rlon})")

    # --- geoid ---------------------------------------------------------------
    corner_lon = np.array([lon_min, lon_max, lon_min, lon_max, 0.5 * (lon_min + lon_max)])
    corner_lat = np.array([lat_min, lat_min, lat_max, lat_max, 0.5 * (lat_min + lat_max)])
    n_grid = geoid_undulation(corner_lon, corner_lat)
    if n_grid is not None:
        geoid = {
            "model": "GCG2016 (BKG, via PROJ grid de_bkg_gcg2016)",
            "min": round(float(np.min(n_grid)), 3),
            "max": round(float(np.max(n_grid)), 3),
            "mean": round(float(np.mean(n_grid)), 3),
            "note": "informational -- NOT applied to the samples",
        }
    else:
        geoid = {"model": None, "note": "GCG2016 grid unavailable at build time"}

    # --- encode --------------------------------------------------------------
    quant = np.where(np.isnan(heights), NODATA, np.rint(heights / SCALE))
    if np.any((quant > 32767) | (quant < NODATA)):
        print("[heightmap] int16 overflow while quantising", file=sys.stderr)
        return EXIT_SANITY
    data = quant.astype("<i2")

    args.out.mkdir(parents=True, exist_ok=True)
    bin_path = args.out / f"{args.name}.bin"
    hdr_path = args.out / f"{args.name}.json"
    bin_path.write_bytes(data.tobytes(order="C"))

    header = {
        "format": "plaster-void-heightmap",
        "version": 1,
        "binary": bin_path.name,
        "byteLength": bin_path.stat().st_size,
        "dtype": "int16",
        "byteOrder": "little",
        "scale": SCALE,
        "offset": OFFSET,
        "nodata": NODATA,
        "width": width,
        "height": height,
        "rowOrder": "south-to-north",
        "colOrder": "west-to-east",
        "index": "row * width + col",
        "crs": "EPSG:4326",
        "bbox": {
            "lonMin": lon_min, "latMin": lat_min,
            "lonMax": lon_max, "latMax": lat_max,
        },
        "dLon": (lon_max - lon_min) / (width - 1),
        "dLat": (lat_max - lat_min) / (height - 1),
        "approxSpacingMetres": args.spacing,
        "heightUnit": "metre",
        "heightType": "orthometric",
        "verticalDatum": "DHHN2016 (normal heights, NHN)",
        "toEllipsoidal": "h_wgs84 = sample + geoidUndulation.appliedByConvertTile",
        "geoidUndulation": {
            "appliedByConvertTile": GEOID_UNDULATION_CONVERT_TILE,
            "gcg2016": geoid,
        },
        "stats": {
            "minHeight": round(float(h_valid.min()), 2),
            "maxHeight": round(float(h_valid.max()), 2),
            "meanHeight": round(float(h_valid.mean()), 2),
            "p0_5Height": round(p_lo, 2),
            "p99_5Height": round(p_hi, 2),
            "nodataCount": n_hole,
        },
        "source": {
            "dataset": "ATKIS(R) DGM1 Berlin (1 m digital terrain model, bare earth)",
            "provider": "Senatsverwaltung fuer Stadtentwicklung, Bauen und Wohnen Berlin",
            "endpoint": "https://gdi.berlin.de/data/dgm1/atom",
            "sourceCrs": "EPSG:25833 (ETRS89 / UTM zone 33N)",
            "sheets": [p.name for p in sheets],
            "license": "Datenlizenz Deutschland - Zero - Version 2.0",
            "licenseUrl": "https://www.govdata.de/dl-de/zero-2-0",
            "attribution": "Geoportal Berlin / ATKIS DGM1",
        },
        "resampling": f"mean of 1 m DGM1 postings in a {args.spacing:.0f} m box per node",
        "generatedBy": "scripts/build_heightmap.py",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    hdr_path.write_text(json.dumps(header, indent=2) + "\n", encoding="utf-8")

    # --- probes --------------------------------------------------------------
    def sample_at(plat: float, plon: float) -> float:
        """Bilinear read-back straight out of the encoded grid (consumer path)."""
        fx = (plon - lon_min) / header["dLon"]
        fy = (plat - lat_min) / header["dLat"]
        x0, y0 = int(math.floor(fx)), int(math.floor(fy))
        if not (0 <= x0 < width - 1 and 0 <= y0 < height - 1):
            return float("nan")
        tx, ty = fx - x0, fy - y0
        q = data.reshape(height, width)[y0 : y0 + 2, x0 : x0 + 2].astype(np.float64)
        if np.any(q == NODATA):
            return float("nan")
        q = q * SCALE + OFFSET
        return float(
            q[0, 0] * (1 - tx) * (1 - ty)
            + q[0, 1] * tx * (1 - ty)
            + q[1, 0] * (1 - tx) * ty
            + q[1, 1] * tx * ty
        )

    for spec in args.probe:
        try:
            plat, plon = (float(v) for v in spec.split(","))
        except ValueError:
            print(f"[heightmap] bad --probe {spec!r} (want LAT,LON)", file=sys.stderr)
            return EXIT_USAGE
        val = sample_at(plat, plon)
        print(f"[heightmap] probe {plat:.4f},{plon:.4f} -> {val:.2f} m DHHN2016 "
              f"({val + GEOID_UNDULATION_CONVERT_TILE:.2f} m ellipsoidal)")

    print(f"[heightmap] wrote {bin_path} ({bin_path.stat().st_size} B) + {hdr_path.name}")
    print(f"[heightmap] {time.time() - t0:.1f} s")

    if problems:
        for p in problems:
            print(f"[heightmap] SANITY: {p}", file=sys.stderr)
        return EXIT_SANITY
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
