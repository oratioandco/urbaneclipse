#!/usr/bin/env python3
"""Turn OpenStreetMap data into the miniature's map layers.

Reads the named roads build_streets.py downloaded, and fetches water and parks once (kept in
data/streets/osm/areas.json). Coordinates use the scene's axes: x east, z south of the tower.

Output in public/city:
  roads.bin    int16 half-metres, one (x, z) per point
  map.json     road run lengths and classes, label anchors, water and park rings,
               plus railway runs
  streets.json the street-alignment views, each with its ends in scene coordinates

Derived from OpenStreetMap, ODbL 1.0.

Usage: python build_map.py <urbaneclipse checkout>
"""
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np
from pyproj import Transformer

TOWER_LAT, TOWER_LON = 52.520815, 13.409419
HALF_M = 9400.0
ROOT = Path(sys.argv[1])
OSM = ROOT / "data" / "streets" / "osm"
OUT = Path(__file__).resolve().parent.parent.parent / "public" / "city"
CLASSES = {"trunk": 0, "primary": 0, "secondary": 1, "tertiary": 2, "unclassified": 3, "residential": 3, "living_street": 3, "pedestrian": 3}
# Railways ride in the road runs at the dimmest class (level 3, the residential tier). The ground
# shader reads only .r of the map texture, as night-time street light (pow(r, 2.6)), so a separate
# grey would need a shader change; level 3 is the cheapest reading that still works: the corridors
# (Gleisdreieck, Stadtbahn, ring) show as faint lines of light, dimmer than any road, and their
# many parallel tracks sum up through the texture's additive painting, so the big corridors glow
# a little more than a single street.
RAIL_LEVEL = 3
LABEL_SPACING_M = 420.0
# Smaller patches are verges and courtyards, too small to read at the ground map's scale.
MIN_AREA_M2 = 1500.0
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]

local = Transformer.from_crs("EPSG:4326", f"+proj=tmerc +lat_0={TOWER_LAT} +lon_0={TOWER_LON} +k=1 +x_0=0 +y_0=0 +ellps=WGS84", always_xy=True)


def scene(lat, lon):
    east, north = local.transform(lon, lat)
    return east, -north


def line(points):
    xs, zs = scene(np.array([p["lat"] for p in points]), np.array([p["lon"] for p in points]))
    return np.column_stack([xs, zs])


def overpass(query, path, label):
    """Run an Overpass query, caching the raw answer at path and retrying across servers."""
    for attempt in range(9):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            request = urllib.request.Request(url, data=urllib.parse.urlencode({"data": query}).encode(), headers={"User-Agent": "urban-eclipse-build"})
            body = urllib.request.urlopen(request, timeout=180).read()
            data = json.loads(body)
            path.write_bytes(body)
            print("fetched", label, len(data["elements"]), flush=True)
            return data
        except Exception as err:  # any failure means try the next server
            print(url, "failed:", err, flush=True)
            time.sleep(6)
    raise SystemExit(f"could not download {label}")


def box():
    dlat = (HALF_M + 300) / 111_320
    dlon = dlat / math.cos(math.radians(TOWER_LAT))
    return f"{TOWER_LAT - dlat},{TOWER_LON - dlon},{TOWER_LAT + dlat},{TOWER_LON + dlon}"


def fetch_areas():
    path = OSM / "areas.json"
    if path.exists():
        return json.loads(path.read_text())
    query = (
        f'[out:json][timeout:170][bbox:{box()}];('
        'way["natural"="water"];relation["natural"="water"];way["waterway"="riverbank"];'
        'way["leisure"="park"];relation["leisure"="park"];way["landuse"="forest"];relation["landuse"="forest"];'
        'way["natural"="wood"];way["landuse"="cemetery"];way["landuse"="grass"];'
        ');out geom;'
    )
    return overpass(query, path, "areas")


def fetch_railways():
    """Mainline and S-Bahn tracks: railway=rail without a service tag, so yards and sidings
    stay out and only the corridors remain. Tunnels stay in on purpose — the miniature has no
    underground, and the covered Nord-Süd-Fernbahn should still read on the ground."""
    path = OSM / "railways.json"
    if path.exists():
        return json.loads(path.read_text())
    query = f'[out:json][timeout:170][bbox:{box()}];(way["railway"="rail"]["service"!~"."];);out geom;'
    return overpass(query, path, "railways")


def rings_of(element):
    if element["type"] == "way":
        return [element["geometry"]] if len(element.get("geometry", [])) > 3 else []
    # Join a relation's outer and inner members into closed rings; holes come from even-odd filling.
    pieces = [m["geometry"] for m in element.get("members", []) if m.get("type") == "way" and m.get("geometry")]
    rings = []
    while pieces:
        ring = list(pieces.pop())
        grown = True
        while grown and (ring[0]["lat"], ring[0]["lon"]) != (ring[-1]["lat"], ring[-1]["lon"]):
            grown = False
            for i, piece in enumerate(pieces):
                head, tail = (piece[0]["lat"], piece[0]["lon"]), (piece[-1]["lat"], piece[-1]["lon"])
                end = (ring[-1]["lat"], ring[-1]["lon"])
                if head == end:
                    ring += piece[1:]
                elif tail == end:
                    ring += piece[::-1][1:]
                else:
                    continue
                pieces.pop(i)
                grown = True
                break
        if len(ring) > 3:
            rings.append(ring)
    return rings


def areas():
    water, green = [], []
    for element in fetch_areas()["elements"]:
        tags = element.get("tags", {})
        target = water if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" else green
        # Rings stay grouped by element, so an island's ring can cut a hole when filled.
        rings = []
        for ring in rings_of(element):
            xz = np.round(line(ring)).astype(int)
            area = abs(np.dot(xz[:, 0], np.roll(xz[:, 1], 1)) - np.dot(xz[:, 1], np.roll(xz[:, 0], 1))) / 2
            if area >= MIN_AREA_M2 and np.abs(xz).max(axis=1).min() < HALF_M + 400:
                rings.append(xz.ravel().tolist())
        if rings:
            target.append(rings)
    return water, green


def load_ways():
    ways = {}
    for path in OSM.glob("part_*.json"):
        for way in json.loads(path.read_text())["elements"]:
            ways[way["id"]] = way
    return ways


def chains(lines):
    """Join one street's ways end to end, carrying on along whichever continues straightest."""
    pool = sorted(lines, key=lambda l: -len(l))
    key = lambda p: (round(p[0]), round(p[1]))
    ends = defaultdict(set)
    for i, l in enumerate(pool):
        ends[key(l[0])].add(i)
        ends[key(l[-1])].add(i)
    used = set()

    def extend(chain):
        while True:
            a = chain[-1] - chain[-2]
            best, best_cos = None, 0.6
            for i in ends[key(chain[-1])] - used:
                l = pool[i]
                cand = l if key(l[0]) == key(chain[-1]) else l[::-1]
                b = cand[1] - cand[0]
                cos = float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
                if cos > best_cos:
                    best, best_cos, best_line = i, cos, cand
            if best is None:
                return chain
            used.add(best)
            chain = np.vstack([chain, best_line[1:]])

    out = []
    for i, l in enumerate(pool):
        if i in used:
            continue
        used.add(i)
        chain = extend(l)
        chain = extend(chain[::-1])
        out.append(chain)
    return out


def anchors_of(chain):
    """Where a name can sit, with the angle there and how long the street stays straight around it."""
    steps = np.linalg.norm(np.diff(chain, axis=0), axis=1)
    along = np.concatenate([[0], np.cumsum(steps)])
    total = along[-1]
    if total < 40:
        return []
    at = lambda s: np.array([np.interp(s, along, chain[:, 0]), np.interp(s, along, chain[:, 1])])
    count = max(1, int(total / LABEL_SPACING_M))
    result = []
    for k in range(count):
        s = total * (k + 0.5) / count
        reach = 20.0
        for wider in (40, 80, 160, 320, 640):
            a, b = max(0, s - wider), min(total, s + wider)
            ends = at(a), at(b)
            axis = ends[1] - ends[0]
            length = np.linalg.norm(axis)
            inside = (along > a) & (along < b)
            if length < 1:
                break
            rel = chain[inside] - ends[0]
            off = np.abs(rel[:, 0] * axis[1] - rel[:, 1] * axis[0]) / length if inside.any() else np.zeros(1)
            if off.max() > max(5.0, wider * 0.05):
                break
            reach = wider
        a, b = at(max(0, s - reach)), at(min(total, s + reach))
        d = b - a
        mid = at(s)
        result.append((round(float(mid[0])), round(float(mid[1])), round(math.atan2(d[1], d[0]), 3), round(float(np.linalg.norm(d)))))
    return result


def rail_lines():
    """Railway tracks as scene polylines, kept within the model like the roads."""
    out = []
    for way in fetch_railways()["elements"]:
        geometry = way.get("geometry") or []
        if len(geometry) < 2:
            continue
        xz = line(geometry)
        if np.abs(xz).max() > HALF_M + 200:
            continue
        out.append(xz)
    return out


def main():
    points, runs = [], []
    names, anchors = [], []
    by_name = defaultdict(list)
    for way in load_ways().values():
        geometry = way.get("geometry") or []
        if len(geometry) < 2:
            continue
        xz = line(geometry)
        if np.abs(xz).max() > HALF_M + 200:
            continue
        level = CLASSES.get(way["tags"].get("highway"), 3)
        runs.append([len(xz), level])
        points.append(xz)
        by_name[way["tags"]["name"]].append((xz, level))
    for name, items in by_name.items():
        level = min(l for _, l in items)
        index = len(names)
        names.append(name)
        for chain in chains([xz for xz, _ in items]):
            for x, z, angle, run in anchors_of(chain):
                anchors.append([index, x, z, angle, run, level])
    rails = rail_lines()
    for xz in rails:
        runs.append([len(xz), RAIL_LEVEL])
        points.append(xz)
    joined = np.vstack(points)
    OUT.mkdir(parents=True, exist_ok=True)
    np.round(joined * 2).astype("<i2").tofile(OUT / "roads.bin")
    water, green = areas()
    (OUT / "map.json").write_text(json.dumps({
        "license": "Derived from OpenStreetMap data, ODbL 1.0. (c) OpenStreetMap contributors.",
        "runs": runs, "names": names, "anchors": anchors, "water": water, "green": green,
    }, separators=(",", ":")))
    doc = json.loads((ROOT / "public" / "streets" / "berlin.json").read_text())
    doc["scene"] = []
    for view in doc["views"]:
        ax, az = scene(view[1], view[2])
        bx, bz = scene(view[3], view[4])
        doc["scene"].append([round(ax, 1), round(az, 1), round(bx, 1), round(bz, 1)])
    (OUT / "streets.json").write_text(json.dumps(doc, separators=(",", ":")))
    print(f"{len(runs)} runs ({len(rails)} rail), {len(joined)} points, {len(names)} names, {len(anchors)} anchors, {len(water)} water, {len(green)} green")


main()
