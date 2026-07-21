#!/usr/bin/env python3
"""Focused lxml parser for Berlin LoD2 CityGML 1.0 building tiles.

Parses a Berlin LoD2 CityGML 1.0 tile (the inner ``.xml`` file or the
containing ``LoD2_<x>_<y>.zip``) and turns every ``bldg:Building`` into a
simple triangle mesh using fan triangulation.

Geometry model
--------------
Berlin LoD2 tiles store the actual polygon data inside
``bldg:boundedBy`` surfaces (``bldg:WallSurface`` / ``bldg:RoofSurface`` /
``bldg:GroundSurface``), each carrying a ``bldg:lod2MultiSurface``.  The
``bldg:lod2Solid`` element on a Building / BuildingPart does NOT embed
geometry directly - it only holds ``xlink:href`` references to the polygon
``gml:id``s defined inside those bounded surfaces.  Gathering every
``bldg:lod2MultiSurface`` in the Building subtree (which includes the
bounded surfaces of the Building and any ``bldg:BuildingPart`` children)
therefore yields each polygon exactly once and avoids resolving the xlinks.

The parser is deliberately minimal:

* only ``gml:posList`` is supported (Berlin tiles use no ``gml:pos`` /
  ``gml:coordinates``);
* only exterior rings are triangulated (see ``interior_ring_count`` /
  PITFALLS - the 30 interior rings / holes in the tile are skipped because
  fan triangulation cannot represent them);
* vertices are NOT deduplicated - every polygon ring contributes its own
  vertices, producing a flat, per-polygon index buffer.
"""

from __future__ import annotations

import os
import sys
import zipfile

from lxml import etree

# --- CityGML 1.0 namespaces --------------------------------------------------
NS = {
    "core": "http://www.opengis.net/citygml/1.0",
    "bldg": "http://www.opengis.net/citygml/building/1.0",
    "gml": "http://www.opengis.net/gml",
    "gen": "http://www.opengis.net/citygml/generics/1.0",
    "app": "http://www.opengis.net/citygml/appearance/1.0",
    "xlink": "http://www.w3.org/1999/xlink",
}
GML_ID = "{%s}id" % NS["gml"]


def _parse_pos_list(text: str):
    """Parse a GML ``posList`` (space-separated ``x y z`` triples, EPSG:25833)."""
    vals = text.split()
    if len(vals) % 3 != 0:
        raise ValueError(
            "posList length %d is not a multiple of 3 (srsDimension=3)" % len(vals)
        )
    out = []
    for i in range(0, len(vals), 3):
        out.append([float(vals[i]), float(vals[i + 1]), float(vals[i + 2])])
    return out


def _fan_triangulate_ring(ring, vertices, triangles):
    """Append ``ring`` (a list of [x,y,z]) to ``vertices`` and fan-triangulate it.

    GML LinearRings are closed: the first vertex equals the last.  We drop the
    closing duplicate and emit triangles ``(0, i, i+1)`` for i in 1..n-2.  At
    least 4 raw points (i.e. a closed triangle) are required.
    """
    if ring is None or len(ring) < 4:
        return 0
    # Drop the closing duplicate if present (closed ring).
    if ring[0] == ring[-1]:
        pts = ring[:-1]
    else:
        pts = ring
    n = len(pts)
    if n < 3:
        return 0
    base = len(vertices)
    vertices.extend(pts)
    for i in range(1, n - 1):
        triangles.append([base, base + i, base + i + 1])
    return n - 2  # number of triangles emitted


def _parse_building(bldg_el):
    """Extract one building mesh (id, vertices, triangles) from a ``bldg:Building``."""
    bid = bldg_el.get(GML_ID, "<no-gml-id>")

    vertices = []
    triangles = []
    poly_count = 0
    interior_ring_count = 0

    # Every lod2MultiSurface in the Building subtree: direct on the Building,
    # inside bldg:boundedBy/*/lod2MultiSurface (Wall/Roof/GroundSurface), and
    # inside bldg:consistsOfBuildingPart/bldg:BuildingPart/bldg:boundedBy/*.
    # This collects each polygon exactly once (polygons live in the bounded
    # surfaces; lod2Solid only references them via xlink:href).
    for ms in bldg_el.findall(".//bldg:lod2MultiSurface", NS):
        for poly in ms.findall(".//gml:Polygon", NS):
            ext = poly.find("gml:exterior/gml:LinearRing", NS)
            if ext is None:
                continue
            pos_list = ext.find("gml:posList", NS)
            if pos_list is None or not pos_list.text or not pos_list.text.strip():
                continue
            ring = _parse_pos_list(pos_list.text)
            if not ring:
                continue
            _fan_triangulate_ring(ring, vertices, triangles)
            poly_count += 1
            # Holes: interior rings exist in this tile (30 of them) but cannot
            # be represented by a fan.  Count them so callers can warn; they
            # are intentionally skipped (see module docstring / PITFALLS).
            interior_ring_count += len(poly.findall("gml:interior", NS))

    return {
        "id": bid,
        "vertices": vertices,
        "triangles": triangles,
        "polygon_count": poly_count,
        "interior_ring_count": interior_ring_count,
    }


def parse_tile(source):
    """Parse a Berlin LoD2 CityGML tile.

    ``source`` is either the inner ``LoD2_33_<x>_<y>_<n>_BE.xml`` file or the
    ``LoD2_<x>_<y>.zip`` that contains it; the zip is handled transparently.

    Returns a list of dicts, one per ``bldg:Building`` (BuildingParts are
    folded into their parent Building):

        {
          "id":               str,            # gml:id of the Building
          "vertices":         list[[x,y,z]],  # EPSG:25833 (UTM 33N), no dedup
          "triangles":        list[[i,j,k]],  # indices into vertices
          "polygon_count":    int,            # gml:Polygon count consumed
          "interior_ring_count": int,         # holes skipped (see PITFALLS)
        }
    """
    source = os.path.abspath(source)
    if not os.path.exists(source):
        raise FileNotFoundError(source)

    if zipfile.is_zipfile(source):
        with zipfile.ZipFile(source) as z:
            xml_names = [n for n in z.namelist() if n.lower().endswith(".xml")]
            if not xml_names:
                raise ValueError("zip %s contains no .xml file" % source)
            if len(xml_names) > 1:
                # Pick the LoD2_33_*_BE.xml naming used by Berlin tiles.
                beam = [n for n in xml_names if "_BE.xml" in n]
                xml_name = beam[0] if beam else xml_names[0]
            else:
                xml_name = xml_names[0]
            with z.open(xml_name) as fh:
                tree = etree.parse(fh)
    else:
        tree = etree.parse(source)

    root = tree.getroot()

    # cityObjectMember may in principle hold non-building features; we only
    # take bldg:Building.  BuildingPart is a child of Building, never a
    # top-level member, so .//bldg:Building yields exactly the top-level ones.
    buildings = []
    for bldg_el in root.findall(".//bldg:Building", NS):
        buildings.append(_parse_building(bldg_el))
    return buildings


# --- CLI / reporting ---------------------------------------------------------
def _report(buildings, label=""):
    n = len(buildings)
    total_tri = sum(len(b["triangles"]) for b in buildings)
    total_v = sum(len(b["vertices"]) for b in buildings)
    total_poly = sum(b["polygon_count"] for b in buildings)
    total_holes = sum(b["interior_ring_count"] for b in buildings)

    xs, ys, zs = [], [], []
    for b in buildings:
        for v in b["vertices"]:
            xs.append(v[0]); ys.append(v[1]); zs.append(v[2])

    largest = max(buildings, key=lambda b: len(b["vertices"])) if buildings else None

    print("=" * 70)
    print("CityGML parse report %s" % label)
    print("=" * 70)
    print("buildings              : %d" % n)
    print("polygons consumed      : %d" % total_poly)
    print("interior rings skipped : %d  (holes - fan triangulation cannot model)" % total_holes)
    print("total vertices (no dedup): %d" % total_v)
    print("total triangles        : %d" % total_tri)
    if xs:
        print("X (easting)  range     : %.3f .. %.3f" % (min(xs), max(xs)))
        print("Y (northing) range     : %.3f .. %.3f" % (min(ys), max(ys)))
        print("Z (height)   range     : %.3f .. %.3f" % (min(zs), max(zs)))
    if largest:
        print("largest building       : %s" % largest["id"])
        print("  vertices             : %d" % len(largest["vertices"]))
        print("  triangles            : %d" % len(largest["triangles"]))
        print("  polygons             : %d" % largest["polygon_count"])

    # Nearest building to the Fernsehturm (~13.4093E, 52.5208N -> UTM 33N
    # easting ~392073 / northing ~5820155), by centroid distance.
    if buildings:
        target = (392073.0, 5820155.0)

        def centroid(b):
            vs = b["vertices"]
            if not vs:
                return None
            cx = sum(v[0] for v in vs) / len(vs)
            cy = sum(v[1] for v in vs) / len(vs)
            return (cx, cy)

        best = None
        for b in buildings:
            c = centroid(b)
            if c is None:
                continue
            d = (c[0] - target[0]) ** 2 + (c[1] - target[1]) ** 2
            if best is None or d < best[0]:
                best = (d, b, c)
        if best:
            import math
            print("nearest bldg to Fernsehturm (~392073, 5820155):")
            print("  id                   : %s" % best[1]["id"])
            print("  centroid (E,N)       : %.1f, %.1f" % best[2])
            print("  distance (m)         : %.1f" % math.sqrt(best[0]))
            print("  vertices             : %d" % len(best[1]["vertices"]))


def main(argv):
    if len(argv) < 2:
        tile = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "data",
            "citygml",
            "LoD2_392_5820.zip",
        )
        print("no source given - defaulting to %s" % tile)
    else:
        tile = argv[1]
    buildings = parse_tile(tile)
    _report(buildings, label="(%s)" % os.path.basename(tile))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
