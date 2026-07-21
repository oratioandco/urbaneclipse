# CityGML → 3D Tiles converter (offline Python tool)

This is an **offline data-prep tool**, intentionally written in **Python** because no
maintained TypeScript CityGML→3D-Tiles converter exists (verified: `citygml-to-3d-tiles`
on npm does not exist; `py3dtiles` 12.x does mesh→b3dm, confirmed by a synthetic-box PoC).
It is **not** part of the locked TS web app — it runs once (per data refresh) to produce
the 3D Tiles the Astro/Cesium app loads.

## Setup

```bash
python3 -m venv .venv
./.venv/bin/pip install py3dtiles lxml pyproj
```

## Usage

```bash
# one tile (PoC — the Fernsehturm tile):
./.venv/bin/python scripts/convert_tile.py data/citygml/LoD2_392_5820.zip --out data/test_tile

# output: data/test_tile/tileset.json + tile.b3dm (uniform WHITE material, ECEF-georeferenced)
```

The app loads the produced `tileset.json` via `Cesium3DTileset` (self-hosted under
`data/`); no Cesium Ion tiling is used (Ion does not tile CityGML — see
`specs/001-telephoto-los-planner/research.md`).

## Verified PoC (LoD2_392_5820, the Fernsehturm tile)

732 buildings · 99,694 vertices · 57,930 triangles · valid `b3dm` (magic `b3dm`) ·
`tileset.json` v1.0 · root transform = Berlin ECEF. The Fernsehturm itself is present
(building `DEBE01YYK0000B8a`, Z 34.6–288 m). CRS confirmed EPSG:25833 (UTM 33N, ETRS89),
vertical DHHN2016.

## Known limitations → production follow-ups (before the full 236-tile run)

These do not block structural validity but affect render + raycast quality:

1. **Fan triangulation** (`parse_citygml.py`) assumes convex rings — non-convex
   footprints/roofs yield self-intersecting/degenerate triangles. **Priority fix:
   earcut / constrained Delaunay.** (Hurts both the plaster look AND occlusion math.)
2. **Interior rings (holes) skipped** (30 in the PoC tile) — courtyards render filled.
3. **Z is DHHN2016 (normal/sea-level), not ellipsoidal** — buildings sit ~**+39 m low**
   vs Cesium World Terrain (Berlin geoid undulation ≈ +39 m). Add the geoid offset to Z.
4. **Vertices not deduplicated** — flat per-polygon buffers; ~1.9 MB/tile (≈450 MB for
   236 tiles). Spatial-hash dedup shrinks this materially.
5. **Winding/orientation** from GML may be inconsistent — may need normalization to avoid
   back-face culling culling visible faces.

## Files
- `parse_citygml.py` — lxml parser: `parse_tile(zip_or_xml)` → `[{id, vertices, triangles}]`.
- `convert_tile.py` — CRS 25833→ECEF + white-material b3dm/tileset emission via py3dtiles.
