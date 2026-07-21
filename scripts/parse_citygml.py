#!/usr/bin/env python3
"""Focused lxml parser for Berlin LoD2 CityGML 1.0 building tiles.

Parses a Berlin LoD2 CityGML 1.0 tile (the inner ``.xml`` file or the
containing ``LoD2_<x>_<y>.zip``) and turns every ``bldg:Building`` into a
triangle mesh using robust earcut triangulation.

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

Triangulation
-------------
Each ``gml:Polygon`` is triangulated with mapbox-earcut, which handles
NON-CONVEX rings (L-shaped footprints, hip roofs) AND interior rings
(courtyards / holes).  For every polygon:

1. Compute the plane normal via Newell's method on the exterior ring
   (robust to the ring's winding and to nearly-axis-aligned planes).
2. Build an orthonormal in-plane basis (u, v) from that normal and project
   the exterior + interior ring points to 2D on the plane (subtracting the
   exterior's first point as origin so the float coordinates fed to earcut
   stay small).
3. Run earcut with the shell followed by the holes (cumulative ring end
   indices); earcut returns 2D vertex indices that map 1:1 back to the 3D
   ring points.
4. Drop any zero-area (degenerate) triangles earcut may emit.

Vertices are DEDUPLICATED per building with a ~1 mm spatial-hash key, so
shared edges between wall/roof/ground polygons collapse and the buffer is
compact.  Unused vertices (e.g. from a filtered degenerate triangle) are
then pruned by a compaction pass.

The parser is deliberately minimal in other respects:

* only ``gml:posList`` is supported (Berlin tiles use no ``gml:pos`` /
  ``gml:coordinates``);
* Z is the DHHN2016 *normal* height (above sea level / the geoid), passed
  through UNCHANGED here.  The geoid->ellipsoid correction is applied
  downstream in ``convert_tile.py`` (it is a coordinate-datum concern, not
  a geometry-extraction concern).
"""

from __future__ import annotations

import math
import os
import sys
import zipfile

import mapbox_earcut as earcut
import numpy as np
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

# Vertex dedup tolerance: spatial-hash cells are ~1 mm.  Two points that
# round to the same cell key collapse to one vertex.  Points within 1 mm
# but straddling a cell boundary stay separate (inherent to hashing); for
# LoD2 meshes (metre-scale resolution) this is far below the noise floor.
DEDUP_CELL_M = 0.001

# Zero-area triangle threshold in the 2D plane projection (m^2).  Triangles
# with |signed area| below this are dropped as degenerate.
DEGENERATE_AREA2 = 1e-12


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


def _parse_ring(ring_el):
    """Parse a ``gml:LinearRing`` -> list of [x,y,z] (as written, possibly closed).

    Returns ``None`` if the ring has no usable posList.
    """
    pos_list = ring_el.find("gml:posList", NS)
    if pos_list is None or not pos_list.text or not pos_list.text.strip():
        return None
    ring = _parse_pos_list(pos_list.text)
    return ring or None


def _clean_ring(ring):
    """Drop the closing duplicate (first==last) of a GML LinearRing.

    Returns the ring unchanged if it is not explicitly closed.  Rings with
    fewer than 3 unique points cannot bound a face and are rejected upstream.
    """
    if len(ring) >= 2 and ring[0] == ring[-1]:
        return ring[:-1]
    return ring


def _newell_normal(pts):
    """Plane normal of a (open) ring via Newell's method.

    Robust to the ring's orientation and works for polygons whose projection
    is degenerate along one axis (Newell averages over all edges, so it never
    collapses to a zero vector unless the ring is truly degenerate).  The
    returned vector's magnitude is 2 * the ring's area; the caller normalizes.
    """
    nx = ny = nz = 0.0
    m = len(pts)
    for i in range(m):
        x0, y0, z0 = pts[i]
        x1, y1, z1 = pts[(i + 1) % m]
        nx += (y0 - y1) * (z0 + z1)
        ny += (z0 - z1) * (x0 + x1)
        nz += (x0 - x1) * (y0 + y1)
    return (nx, ny, nz)


def _plane_basis(n):
    """Two orthonormal in-plane vectors (u, v) for unit normal ``n``.

    The reference axis is chosen as the component of ``n`` with the smallest
    magnitude, guaranteeing ``n`` and the reference are not parallel, so the
    cross product is non-degenerate.  ``u = n x ref`` (normalized) and
    ``v = n x u`` (already unit).  Both lie in the polygon's plane.
    """
    ax, ay, az = abs(n[0]), abs(n[1]), abs(n[2])
    if ax <= ay and ax <= az:
        ref = (1.0, 0.0, 0.0)
    elif ay <= az:
        ref = (0.0, 1.0, 0.0)
    else:
        ref = (0.0, 0.0, 1.0)
    # u = n x ref
    ux = n[1] * ref[2] - n[2] * ref[1]
    uy = n[2] * ref[0] - n[0] * ref[2]
    uz = n[0] * ref[1] - n[1] * ref[0]
    ul = math.sqrt(ux * ux + uy * uy + uz * uz)
    if ul < 1e-12:
        return None
    u = (ux / ul, uy / ul, uz / ul)
    # v = n x u  (unit, since n and u are orthonormal)
    vx = n[1] * uz - n[2] * uy
    vy = n[2] * ux - n[0] * uz
    vz = n[0] * uy - n[1] * ux
    return u, (vx, vy, vz)


def _triangulate_polygon(exterior, interiors, vertices, triangles):
    """Triangulate one GML polygon (exterior + interior rings) with earcut.

    Appends the polygon's 3D ring points to ``vertices`` and its triangle
    index triples (offset by the current ``len(vertices)``) to ``triangles``.
    earcut's 2D vertex indices map 1:1 back to the 3D ring points in the
    order [exterior..., hole0..., hole1...].

    Returns ``(n_triangles, n_holes_used, n_degenerate_dropped)``.
    """
    ext = _clean_ring(exterior)
    if len(ext) < 3:
        return 0, 0, 0

    holes = []
    for r in interiors:
        if not r:
            continue
        c = _clean_ring(r)
        if len(c) >= 3:
            holes.append(c)

    # 1. Plane normal (Newell) on the exterior ring.
    nvec = _newell_normal(ext)
    mag = math.sqrt(nvec[0] ** 2 + nvec[1] ** 2 + nvec[2] ** 2)
    if mag < 1e-9:
        # Degenerate plane (zero-area exterior); nothing to emit.
        return 0, len(holes), 0
    n = (nvec[0] / mag, nvec[1] / mag, nvec[2] / mag)

    # 2. In-plane basis + 2D projection (subtract origin for precision).
    basis = _plane_basis(n)
    if basis is None:
        return 0, len(holes), 0
    u, v = basis

    pts3d = list(ext)
    for h in holes:
        pts3d.extend(h)
    n_pts = len(pts3d)

    ox, oy, oz = ext[0]
    pts2d = np.empty((n_pts, 2), dtype=np.float64)
    for i in range(n_pts):
        px, py, pz = pts3d[i]
        rx, ry, rz = px - ox, py - oy, pz - oz
        pts2d[i, 0] = rx * u[0] + ry * u[1] + rz * u[2]
        pts2d[i, 1] = rx * v[0] + ry * v[1] + rz * v[2]

    # 3. earcut: shell first, then holes, via CUMULATIVE ring end indices.
    ring_ends = [len(ext)]
    for h in holes:
        ring_ends.append(ring_ends[-1] + len(h))
    ring_idx = np.asarray(ring_ends, dtype=np.uint32)

    tri_flat = earcut.triangulate_float64(pts2d, ring_idx)

    # 4. Map 2D indices back to the 3D buffer; drop degenerate triangles.
    base = len(vertices)
    vertices.extend(pts3d)

    n_tris = 0
    n_degen = 0
    m = len(tri_flat)
    for k in range(0, m, 3):
        a = int(tri_flat[k])
        b = int(tri_flat[k + 1])
        c = int(tri_flat[k + 2])
        ax, ay = pts2d[a]
        bx, by = pts2d[b]
        cx, cy = pts2d[c]
        area2 = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(area2) < DEGENERATE_AREA2:
            n_degen += 1
            continue
        triangles.append([base + a, base + b, base + c])
        n_tris += 1

    return n_tris, len(holes), n_degen


def _dedup_vertices(vertices, triangles):
    """Deduplicate vertices with a ~1 mm spatial hash; remap triangle indices.

    Returns ``(new_vertices, new_triangles, n_duplicates_removed)``.  Two
    vertices that round to the same cell key collapse to the first one seen.
    """
    key_to_new = {}
    old_to_new = []  # old vertex index -> new (deduped) vertex index
    new_verts = []
    for p in vertices:
        key = (
            round(p[0] / DEDUP_CELL_M),
            round(p[1] / DEDUP_CELL_M),
            round(p[2] / DEDUP_CELL_M),
        )
        idx = key_to_new.get(key)
        if idx is None:
            idx = len(new_verts)
            key_to_new[key] = idx
            new_verts.append(p)
        old_to_new.append(idx)
    new_tris = [
        [old_to_new[t[0]], old_to_new[t[1]], old_to_new[t[2]]] for t in triangles
    ]
    return new_verts, new_tris, len(vertices) - len(new_verts)


def _compact(vertices, triangles):
    """Drop vertices referenced by no triangle; reindex contiguously.

    Returns ``(new_vertices, new_triangles, n_unused_removed)``.
    """
    used = set()
    for t in triangles:
        used.add(t[0])
        used.add(t[1])
        used.add(t[2])
    if len(used) == len(vertices):
        return vertices, triangles, 0
    ordered = sorted(used)
    remap = {old: new for new, old in enumerate(ordered)}
    new_verts = [vertices[i] for i in ordered]
    new_tris = [[remap[t[0]], remap[t[1]], remap[t[2]]] for t in triangles]
    return new_verts, new_tris, len(vertices) - len(used)


def _parse_building(bldg_el):
    """Extract one building mesh (id, vertices, triangles) from a ``bldg:Building``."""
    bid = bldg_el.get(GML_ID, "<no-gml-id>")

    raw_vertices = []
    raw_triangles = []
    poly_count = 0
    interior_ring_count = 0
    degen_count = 0

    # Every lod2MultiSurface in the Building subtree: direct on the Building,
    # inside bldg:boundedBy/*/lod2MultiSurface (Wall/Roof/GroundSurface), and
    # inside bldg:consistOfBuildingPart/bldg:BuildingPart/bldg:boundedBy/*.
    # This collects each polygon exactly once (polygons live in the bounded
    # surfaces; lod2Solid only references them via xlink:href).
    for ms in bldg_el.findall(".//bldg:lod2MultiSurface", NS):
        for poly in ms.findall(".//gml:Polygon", NS):
            ext_el = poly.find("gml:exterior/gml:LinearRing", NS)
            if ext_el is None:
                continue
            ext_ring = _parse_ring(ext_el)
            if not ext_ring:
                continue

            interiors = []
            for intr_el in poly.findall("gml:interior/gml:LinearRing", NS):
                r = _parse_ring(intr_el)
                if r:
                    interiors.append(r)

            n_tris, n_holes, n_degen = _triangulate_polygon(
                ext_ring, interiors, raw_vertices, raw_triangles
            )
            if n_tris > 0:
                poly_count += 1
                interior_ring_count += n_holes
            degen_count += n_degen

    raw_vertex_count = len(raw_vertices)

    # Dedup shared vertices (per building), then prune any now-unused verts.
    vertices, triangles, n_dup = _dedup_vertices(raw_vertices, raw_triangles)

    # After dedup a triangle may have a repeated index (two corners < 1 mm
    # apart); drop those as degenerate.
    clean_tris = []
    n_dedup_degen = 0
    for t in triangles:
        if t[0] == t[1] or t[1] == t[2] or t[0] == t[2]:
            n_dedup_degen += 1
            continue
        clean_tris.append(t)

    vertices, clean_tris, n_unused = _compact(vertices, clean_tris)

    return {
        "id": bid,
        "vertices": vertices,
        "triangles": clean_tris,
        "polygon_count": poly_count,
        "interior_ring_count": interior_ring_count,
        "raw_vertex_count": raw_vertex_count,
        "duplicates_removed": n_dup,
        "degenerate_dropped": degen_count + n_dedup_degen,
        "unused_removed": n_unused,
    }


def parse_tile(source):
    """Parse a Berlin LoD2 CityGML tile.

    ``source`` is either the inner ``LoD2_33_<x>_<y>_<n>_BE.xml`` file or the
    ``LoD2_<x>_<y>.zip`` that contains it; the zip is handled transparently.

    Returns a list of dicts, one per ``bldg:Building`` (BuildingParts are
    folded into their parent Building):

        {
          "id":                 str,            # gml:id of the Building
          "vertices":           list[[x,y,z]],  # EPSG:25833 (UTM 33N), DEDUPED ~1 mm
          "triangles":          list[[i,j,k]],  # indices into vertices
          "polygon_count":      int,            # gml:Polygon count consumed
          "interior_ring_count":int,            # holes USED by earcut
          "raw_vertex_count":   int,            # vertices before dedup
          "duplicates_removed": int,            # vertices collapsed by dedup
          "degenerate_dropped": int,            # zero-area tris dropped
          "unused_removed":     int,            # unreferenced verts pruned
        }

    Z values are DHHN2016 normal heights, returned UNCHANGED; the
    geoid->ellipsoid offset is applied in ``convert_tile.py``.
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
    total_raw_v = sum(b["raw_vertex_count"] for b in buildings)
    total_poly = sum(b["polygon_count"] for b in buildings)
    total_holes = sum(b["interior_ring_count"] for b in buildings)
    total_dup = sum(b["duplicates_removed"] for b in buildings)
    total_degen = sum(b["degenerate_dropped"] for b in buildings)

    xs, ys, zs = [], [], []
    for b in buildings:
        for v in b["vertices"]:
            xs.append(v[0])
            ys.append(v[1])
            zs.append(v[2])

    largest = max(buildings, key=lambda b: len(b["vertices"])) if buildings else None

    print("=" * 70)
    print("CityGML parse report %s" % label)
    print("=" * 70)
    print("buildings              : %d" % n)
    print("polygons consumed      : %d" % total_poly)
    print("interior rings USED    : %d  (holes - now modelled by earcut)" % total_holes)
    print("vertices (raw, no dedup): %d" % total_raw_v)
    print("duplicates removed (~1mm): %d" % total_dup)
    print("vertices (deduped)     : %d" % total_v)
    print("total triangles        : %d" % total_tri)
    print("degenerate tris dropped: %d" % total_degen)
    if xs:
        print("X (easting)  range     : %.3f .. %.3f" % (min(xs), max(xs)))
        print("Y (northing) range     : %.3f .. %.3f" % (min(ys), max(ys)))
        print("Z (height,DHHN2016)    : %.3f .. %.3f  (geoid offset applied later)" % (min(zs), max(zs)))
    if largest:
        print("largest building       : %s" % largest["id"])
        print("  vertices (deduped)   : %d" % len(largest["vertices"]))
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
            print("nearest bldg to Fernsehturm (~392073, 5820155):")
            print("  id                   : %s" % best[1]["id"])
            print("  centroid (E,N)       : %.1f, %.1f" % best[2])
            print("  distance (m)         : %.1f" % math.sqrt(best[0]))
            print("  vertices (deduped)   : %d" % len(best[1]["vertices"]))


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
