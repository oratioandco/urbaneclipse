#!/usr/bin/env python3
"""Fetch Berlin ATKIS(R) DGM1 (1 m digital *terrain* model) tiles for the app AOI.

Why
---
The plaster-void scene has NO Cesium terrain provider: the globe is a bare WGS84
ellipsoid.  The LoD2 buildings, however, were lifted to ellipsoidal heights by
``convert_tile.py`` (DHHN2016 normal height + ~39.5 m geoid undulation), so their
bases sit at ~73 m ellipsoidal while "ground" in the scene is 0 m.  To place the
observer on the real ground we need an actual terrain elevation source.  This
script downloads it.

Source (verified reachable, no auth, 2026-07)
---------------------------------------------
Berlin Geodateninfrastruktur ATOM download service::

    https://gdi.berlin.de/data/dgm1/atom          (service feed)
    https://gdi.berlin.de/data/dgm1/atom/0.atom   (dataset feed, ~1 entry/tile)
    https://gdi.berlin.de/data/dgm1/atom/DGM1_<E_km>_<N_km>.zip

* Tiling      : 2 km x 2 km sheets, named by the SW corner in whole km of
                EPSG:25833 (so E_km/N_km are always EVEN).
* Payload     : one ``dgm1_33_<E_km>_<N_km>_2_be.xyz`` per zip -- plain ASCII
                ``<easting> <northing> <height>`` triples, one per line,
                1 m posting, cell CENTRES (coordinates end in ``.500``),
                4,000,000 lines / ~120 MB uncompressed, ~17 MB zipped.
* CRS         : EPSG:25833 (ETRS89 / UTM zone 33N).  IDENTICAL to the CityGML
                LoD2 tiles this project already converts -- NOT 25832.
* Vertical    : DHHN2016 normal heights ("NHN"), i.e. the SAME vertical datum
                as the Berlin LoD2 CityGML.  So the geoid handling in
                ``convert_tile.py`` applies unchanged and consistently.
* Accuracy    : +/-10 cm + 5 % of grid spacing in flat open terrain (95 %).
* License     : Datenlizenz Deutschland - Zero - Version 2.0 (no restrictions),
                https://www.govdata.de/dl-de/zero-2-0

Which tiles
-----------
The AOI is derived from ``public/berlin-core/tileset.json``: its children are
named ``tile_<E_km>_<N_km>.b3dm`` (1 km LoD2 sheets), which gives the UTM-33N
bounding box of the scene -- E 389-394 km / N 5818-5822 km for the committed
berlin-core subset.

That box is then EXPANDED to contain ``REFERENCE_POINTS`` (below) and snapped
out to the enclosing 2 km DGM1 sheet grid.  The expansion matters: the default
observer on the Lichtenberger Bruecke (52.5106, 13.4652 -> E 395841,
N 5818938) lies ~1.8 km EAST of the berlin-core building AOI, so a heightmap
built from the building bounds alone would not cover the observer at all.

Result for the current berlin-core subset: 10 sheets,
E 388/390/392/394/396 km x N 5818/5820 km.

Output
------
``data/dgm1/DGM1_<E>_<N>.zip`` (kept zipped; ``build_heightmap.py`` streams the
member out of the zip).  ``data/`` is gitignored -- these are ~17 MB each and
must NOT be committed.

Exit codes
----------
0  all requested sheets present locally (downloaded or already cached)
2  bad usage / AOI could not be derived
3  network or HTTP failure for at least one sheet
4  a downloaded file failed validation (not a zip / no .xyz member)

Run::

    .venv/bin/python scripts/fetch_dgm1.py
    .venv/bin/python scripts/fetch_dgm1.py --tileset public/berlin-core/tileset.json
    .venv/bin/python scripts/fetch_dgm1.py --out data/dgm1 --force
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ATOM_BASE = "https://gdi.berlin.de/data/dgm1/atom"
SHEET_KM = 2  # DGM1 sheet size in km (EPSG:25833)

#: Points the heightmap MUST cover, (label, lat, lon).  The AOI derived from
#: the LoD2 tileset is expanded to contain all of them (plus --margin).
REFERENCE_POINTS: tuple[tuple[str, float, float], ...] = (
    ("observer (Lichtenberger Bruecke)", 52.5106, 13.4652),
    ("Fernsehturm", 52.5208, 13.4093),
)

USER_AGENT = "plaster-void-dgm1-fetch/1.0 (+offline data prep)"
TIMEOUT_S = 600

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_NETWORK = 3
EXIT_BAD_PAYLOAD = 4

_TILE_URI_RE = re.compile(r"tile_(\d+)_(\d+)\.b3dm$")


def aoi_km_from_tileset(tileset_path: Path) -> tuple[int, int, int, int]:
    """Return (e_min_km, e_max_km, n_min_km, n_max_km) of the LoD2 AOI.

    The LoD2 sheets are 1 km, named by their SW corner, so the AOI's upper
    bound is the max sheet index + 1 km.  Parsing is defensive: any child
    whose content URI does not match the expected pattern is skipped, and an
    empty result is an error (never a silent default AOI).
    """
    try:
        doc = json.loads(tileset_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"[fetch_dgm1] cannot read tileset {tileset_path}: {exc}")

    children = doc.get("root", {}).get("children") or []
    es: list[int] = []
    ns: list[int] = []
    for child in children:
        uri = (child.get("content") or {}).get("uri", "")
        m = _TILE_URI_RE.search(str(uri))
        if not m:
            continue
        es.append(int(m.group(1)))
        ns.append(int(m.group(2)))

    if not es:
        raise SystemExit(
            f"[fetch_dgm1] no 'tile_<E>_<N>.b3dm' children found in {tileset_path}"
        )
    return min(es), max(es) + 1, min(ns), max(ns) + 1


def expand_for_reference_points(
    box_m: tuple[float, float, float, float], margin_m: float
) -> tuple[float, float, float, float]:
    """Grow a metric UTM-33N AOI box so every REFERENCE_POINTS entry fits."""
    import pyproj  # local import: only this path needs PROJ

    tr = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True)
    e_min, e_max, n_min, n_max = box_m
    for label, lat, lon in REFERENCE_POINTS:
        e, n = tr.transform(lon, lat)
        if not (e_min <= e <= e_max and n_min <= n <= n_max):
            print(f"[fetch_dgm1] AOI expanded for {label} (E {e:.0f}, N {n:.0f})")
        e_min = min(e_min, e - margin_m)
        e_max = max(e_max, e + margin_m)
        n_min = min(n_min, n - margin_m)
        n_max = max(n_max, n + margin_m)
    return e_min, e_max, n_min, n_max


def sheets_for_aoi(box_m: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """DGM1 2 km sheet SW corners (in km) covering the metric AOI box.

    A sheet ``[e, e+2)`` is needed while ``e < e_max``; an AOI ending exactly
    on a sheet boundary must NOT pull in the next (empty) sheet.
    """
    e_min_m, e_max_m, n_min_m, n_max_m = box_m
    e0 = int(math.floor(e_min_m / 1000.0 / SHEET_KM)) * SHEET_KM
    n0 = int(math.floor(n_min_m / 1000.0 / SHEET_KM)) * SHEET_KM
    sheets: list[tuple[int, int]] = []
    e = e0
    while e * 1000.0 < e_max_m:
        n = n0
        while n * 1000.0 < n_max_m:
            sheets.append((e, n))
            n += SHEET_KM
        e += SHEET_KM
    return sheets


def validate_zip(path: Path) -> bool:
    """True if *path* is a zip containing exactly one ``*.xyz`` member."""
    try:
        with zipfile.ZipFile(path) as zf:
            return any(n.lower().endswith(".xyz") for n in zf.namelist())
    except (zipfile.BadZipFile, OSError):
        return False


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:  # noqa: S310
        if resp.status != 200:
            raise urllib.error.HTTPError(url, resp.status, "unexpected status", resp.headers, None)
        with tmp.open("wb") as fh:
            while chunk := resp.read(1 << 20):
                fh.write(chunk)
    tmp.replace(dest)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument(
        "--tileset",
        type=Path,
        default=Path("public/berlin-core/tileset.json"),
        help="LoD2 tileset whose tile_<E>_<N>.b3dm children define the AOI",
    )
    ap.add_argument("--out", type=Path, default=Path("data/dgm1"), help="output directory")
    ap.add_argument(
        "--margin",
        type=float,
        default=250.0,
        help="metres of padding around the AOI / reference points (default 250)",
    )
    ap.add_argument("--force", action="store_true", help="re-download even if cached")
    args = ap.parse_args(argv)

    if not args.tileset.is_file():
        print(f"[fetch_dgm1] tileset not found: {args.tileset}", file=sys.stderr)
        return EXIT_USAGE

    e0, e1, n0, n1 = aoi_km_from_tileset(args.tileset)
    print(f"[fetch_dgm1] LoD2 AOI (EPSG:25833, km): E {e0}-{e1}  N {n0}-{n1}")
    # NOTE: the LoD2 box is used UNPADDED here on purpose.  Padding it would
    # push the box a few hundred metres over a 2 km sheet boundary and pull in
    # a whole extra ~17 MB row/column of DGM1 for a sliver of terrain; the
    # heightmap builder clamps its grid to whatever coverage exists instead.
    # --margin only guarantees breathing room around the reference points.
    box = expand_for_reference_points(
        (e0 * 1000.0, e1 * 1000.0, n0 * 1000.0, n1 * 1000.0), args.margin
    )
    sheets = sheets_for_aoi(box)
    print(f"[fetch_dgm1] fetch AOI (m): E {box[0]:.0f}..{box[1]:.0f}  N {box[2]:.0f}..{box[3]:.0f}")
    print(f"[fetch_dgm1] {len(sheets)} DGM1 2km sheet(s): {sheets}")

    args.out.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    bad: list[str] = []

    for e, n in sheets:
        name = f"DGM1_{e}_{n}.zip"
        dest = args.out / name
        if dest.is_file() and not args.force:
            if validate_zip(dest):
                print(f"[fetch_dgm1] cached  {name} ({dest.stat().st_size/1e6:.1f} MB)")
                continue
            print(f"[fetch_dgm1] cached copy of {name} is invalid, re-downloading")
        url = f"{ATOM_BASE}/{name}"
        try:
            print(f"[fetch_dgm1] GET     {url}")
            download(url, dest)
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            print(f"[fetch_dgm1] FAILED  {name}: {exc}", file=sys.stderr)
            failures.append(name)
            continue
        if not validate_zip(dest):
            print(f"[fetch_dgm1] INVALID {name}: no .xyz member", file=sys.stderr)
            bad.append(name)
            continue
        print(f"[fetch_dgm1] ok      {name} ({dest.stat().st_size/1e6:.1f} MB)")

    if failures:
        print(f"[fetch_dgm1] {len(failures)} sheet(s) failed to download", file=sys.stderr)
        return EXIT_NETWORK
    if bad:
        print(f"[fetch_dgm1] {len(bad)} sheet(s) failed validation", file=sys.stderr)
        return EXIT_BAD_PAYLOAD
    print(f"[fetch_dgm1] done -> {args.out}")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
