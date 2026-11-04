#!/usr/bin/env python3
"""Find Berlin streets that can frame the sun or moon along their axis.

Output: ``public/streets/berlin.json``, one entry per viewing direction of each long,
straight street. Derived from OpenStreetMap, so it stays under the ODbL and needs credit.

Steps
-----
1. Download named roads from Overpass into ``data/streets/osm`` (skipped if present).
2. Join each street's ways and cut them into straight runs of at least 500 m.
3. Measure each direction against the LoD2 surface model from build_viewshed.py: how high
   the skyline stands along the axis, how wide the street is, and how far the view runs.

Bearings are measured on the ellipsoid. Taking them from UTM coordinates gives grid north,
about 1.3 degrees off true north at Berlin, which moves every predicted date.

Run::

    .venv/bin/python scripts/build_streets.py
"""
from __future__ import annotations

import collections
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from pyproj import Geod, Transformer

ROOT = Path(__file__).resolve().parent.parent
OSM_DIR = ROOT / "data" / "streets" / "osm"
SURFACE = ROOT / "data" / "viewshed" / "surface.npz"
GROUND = ROOT / "data" / "viewshed" / "ground.npz"
OUT = ROOT / "public" / "streets" / "berlin.json"

# Same grid as scripts/build_viewshed.py.
ORIGIN_E, ORIGIN_N, CELL = 383000.0, 5811000.0, 2.5
CENTRE_LAT, CENTRE_LON = 52.520815, 13.409419
HALF_SPAN_M = 9500.0
EYE_M = 1.5
CURVATURE = (1 - 0.13) / (2 * 6_371_000.0)

MIN_LENGTH_M = 500.0
# How far a street may stray from a straight line, metres.
MAX_DEVIATION_M = 6.0
MAX_TURN_RAD = math.radians(12)
# Buildings framing the street within this distance count as walls.
WALL_DISTANCE_M = 45.0
MIN_WALL_SHARE = 0.5
# A wider avenue still reads as a street canyon up to this half-width.
MAX_OPEN_HALF_WIDTH_M = 45.0
MAX_SKYLINE_DEG = 8.0
MIN_TOLERANCE_DEG = 0.25

OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

to_utm = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True)
to_wgs = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True)
geod = Geod(ellps="WGS84")


def download(parts: int = 4) -> None:
    """Fetch in pieces: public Overpass servers often refuse the whole area at once."""
    OSM_DIR.mkdir(parents=True, exist_ok=True)
    dlat = HALF_SPAN_M / 111_320.0
    dlon = dlat / math.cos(math.radians(CENTRE_LAT))
    for i in range(parts):
        for j in range(parts):
            path = OSM_DIR / f"part_{i}_{j}.json"
            if path.exists():
                continue
            s = CENTRE_LAT - dlat + 2 * dlat * i / parts
            n = s + 2 * dlat / parts
            w = CENTRE_LON - dlon + 2 * dlon * j / parts
            e = w + 2 * dlon / parts
            query = (
                '[out:json][timeout:90];way["highway"~"^(trunk|primary|secondary|tertiary|'
                'unclassified|residential|living_street|pedestrian)$"]["tunnel"!~"yes"]["name"]'
                f"({s},{w},{n},{e});out tags geom;"
            )
            for attempt in range(12):
                url = OVERPASS[attempt % len(OVERPASS)]
                try:
                    request = urllib.request.Request(
                        url,
                        data=urllib.parse.urlencode({"data": query}).encode(),
                        headers={"User-Agent": "urban-eclipse-build"},
                    )
                    body = urllib.request.urlopen(request, timeout=100).read()
                    json.loads(body)
                    path.write_bytes(body)
                    print(f"fetched {path.name}", flush=True)
                    break
                except Exception as err:  # noqa: BLE001 - any failure means try the next server
                    print(f"{path.name}: {url} failed ({err})", flush=True)
                    time.sleep(5)
            else:
                raise SystemExit(f"could not download {path.name}")


def load_ways() -> dict[str, list[np.ndarray]]:
    ways = {}
    for path in OSM_DIR.glob("part_*.json"):
        for way in json.loads(path.read_text())["elements"]:
            ways[way["id"]] = way
    by_name: dict[str, list[np.ndarray]] = collections.defaultdict(list)
    for way in ways.values():
        points = way.get("geometry") or []
        if len(points) < 2:
            continue
        e, n = to_utm.transform([p["lon"] for p in points], [p["lat"] for p in points])
        by_name[way["tags"]["name"]].append(np.column_stack([e, n]))
    print(f"{len(ways)} ways on {len(by_name)} named streets")
    return by_name


def join_ways(polylines: list[np.ndarray]) -> list[np.ndarray]:
    """Join a street's ways end to end wherever its direction continues."""
    used = [False] * len(polylines)
    ends: dict[tuple[float, float], list[int]] = collections.defaultdict(list)
    for i, line in enumerate(polylines):
        ends[tuple(np.round(line[0], 1))].append(i)
        ends[tuple(np.round(line[-1], 1))].append(i)

    def heading(a: np.ndarray, b: np.ndarray) -> float:
        return math.atan2(b[0] - a[0], b[1] - a[1])

    chains = []
    for i, line in enumerate(polylines):
        if used[i]:
            continue
        used[i] = True
        current = line.copy()
        for _ in range(2):  # extend forward, then reversed to extend the other end
            while True:
                best, best_turn = None, MAX_TURN_RAD
                h = heading(current[-2], current[-1])
                for j in ends[tuple(np.round(current[-1], 1))]:
                    if used[j]:
                        continue
                    other = polylines[j]
                    if not np.allclose(other[0], current[-1], atol=0.2):
                        other = other[::-1]
                    turn = abs((heading(other[0], other[1]) - h + math.pi) % (2 * math.pi) - math.pi)
                    if turn < best_turn:
                        best, best_turn = (j, other), turn
                if best is None:
                    break
                used[best[0]] = True
                current = np.vstack([current, best[1][1:]])
            current = current[::-1]
        chains.append(current)
    return chains


def straight_runs(chain: np.ndarray) -> list[tuple[np.ndarray, np.ndarray, float]]:
    runs = []
    i, count = 0, len(chain)
    while i < count - 1:
        best, j = None, i + 1
        while j < count:
            a, b = chain[i], chain[j]
            v = b - a
            length = float(np.hypot(*v))
            if length > 0:
                rel = chain[i : j + 1] - a
                if (np.abs(v[0] * rel[:, 1] - v[1] * rel[:, 0]) / length).max() > MAX_DEVIATION_M:
                    break
                best = j
            j += 1
        if best is None:
            i += 1
            continue
        length = float(np.hypot(*(chain[best] - chain[i])))
        if length >= MIN_LENGTH_M:
            runs.append((chain[i], chain[best], length))
            i = best
        else:
            i += 1
    return runs


def remove_second_carriageways(runs):
    """Two carriageways of one avenue are one street: keep the longer."""
    runs = sorted(runs, key=lambda r: -r[3])
    kept = collections.defaultdict(list)
    out = []
    for name, a, b, length in runs:
        axis = math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) % 180
        middle = (a + b) / 2
        duplicate = False
        for _, oa, ob, _, oaxis in kept[name]:
            if abs((axis - oaxis + 90) % 180 - 90) < 4:
                v = ob - oa
                rel = middle - oa
                across = abs(v[0] * rel[1] - v[1] * rel[0]) / np.hypot(*v)
                along = np.dot(rel, v) / np.dot(v, v)
                if across < 70 and -0.1 < along < 1.1:
                    duplicate = True
                    break
        if not duplicate:
            record = (name, a, b, length, axis)
            kept[name].append(record)
            out.append(record)
    return out


def main() -> None:
    download()
    if not SURFACE.exists():
        raise SystemExit("Run scripts/build_viewshed.py first: it builds the surface model.")
    roofs = np.load(SURFACE)["roofs"]
    ground = np.load(GROUND)["ground"]
    size = roofs.shape[0]

    def sample(e: np.ndarray, n: np.ndarray):
        c = ((e - ORIGIN_E) / CELL).astype(int)
        r = ((n - ORIGIN_N) / CELL).astype(int)
        ok = (c >= 0) & (c < size) & (r >= 0) & (r < size)
        c, r = np.where(ok, c, 0), np.where(ok, r, 0)
        return roofs[r, c], ground[r, c], ok

    runs = []
    for name, polylines in load_ways().items():
        for chain in join_ways(polylines):
            runs.extend((name, a, b, length) for a, b, length in straight_runs(chain))
    runs = remove_second_carriageways(runs)
    print(f"{len(runs)} straight stretches of at least {MIN_LENGTH_M:.0f} m")

    views = []
    offsets = np.arange(4, 80, 2.5)
    for name, a, b, length, _ in runs:
        unit = (b - a) / length
        across = np.array([-unit[1], unit[0]])
        half_widths, walled = [], 0
        stations = np.arange(30, length - 30, 25)
        for t in stations:
            p = a + unit * t
            sides = []
            for sign in (1, -1):
                q = p[None, :] + np.outer(sign * offsets, across)
                z, _, _ = sample(q[:, 0], q[:, 1])
                hit = np.nonzero(~np.isnan(z))[0]
                sides.append(float(offsets[hit[0]]) if len(hit) else 80.0)
            half_widths.append(min(sides))
            walled += sides[0] < WALL_DISTANCE_M and sides[1] < WALL_DISTANCE_M
        half_width = float(np.median(half_widths))
        wall_share = walled / len(stations)
        if wall_share < MIN_WALL_SHARE and half_width > MAX_OPEN_HALF_WIDTH_M:
            continue

        for start, end, direction in ((a, b, unit), (b, a, -unit)):
            _, eye_ground, _ = sample(start[:1], start[1:])
            eye = float(eye_ground[0]) + EYE_M
            s = np.arange(40.0, 9000.0, 5.0)
            e_along, n_along = start[0] + direction[0] * s, start[1] + direction[1] * s
            z, g, ok = sample(e_along, n_along)
            surface = np.where(np.isnan(z), g, z)
            angles = np.degrees(np.arctan2(surface - CURVATURE * s * s - eye, s))
            skyline = float(np.max(np.where(ok, angles, -9.0)))
            roofs_on_axis = np.nonzero(~np.isnan(z) & ok)[0]
            clear = float(s[roofs_on_axis[0]]) if len(roofs_on_axis) else 9000.0
            if skyline >= MAX_SKYLINE_DEG or clear < min(length, 1200.0):
                continue
            lon0, lat0 = to_wgs.transform(*start)
            lon1, lat1 = to_wgs.transform(*end)
            bearing, _, _ = geod.inv(lon0, lat0, lon1, lat1)
            tolerance = max(MIN_TOLERANCE_DEG, math.degrees(math.atan2(max(half_width, 8.0), length)))
            views.append(
                [
                    name,
                    round(lat0, 5),
                    round(lon0, 5),
                    round(lat1, 5),
                    round(lon1, 5),
                    round(length),
                    round(bearing % 360, 2),
                    round(skyline, 2),
                    round(tolerance, 2),
                ]
            )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    document = {
        "format": "urban-eclipse-streets",
        "version": 1,
        "license": "Derived from OpenStreetMap data, ODbL 1.0. (c) OpenStreetMap contributors.",
        "fields": ["name", "fromLat", "fromLon", "toLat", "toLon", "lengthM", "bearingDeg", "skylineDeg", "toleranceDeg"],
        "views": views,
    }
    OUT.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {len(views)} views, {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
