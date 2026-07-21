# CityGML → 3D Tiles converter (offline Python tool)

This is an **offline data-prep tool**, intentionally written in **Python** because no
maintained TypeScript CityGML→3D-Tiles converter exists (verified: `citygml-to-3d-tiles`
on npm does not exist; `py3dtiles` 12.x does mesh→b3dm, confirmed by a synthetic-box PoC).
It is **not** part of the locked TS web app — it runs once (per data refresh) to produce
the 3D Tiles the Astro/Cesium app loads.

## Setup

```bash
python3 -m venv .venv
./.venv/bin/pip install py3dtiles lxml pyproj mapbox-earcut numpy
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

## Serving the tileset to the web app (IMPORTANT)

`data/` is gitignored and **not** web-served by Astro. Astro serves `public/` at the
web root (`/`), so the Cesium island loads the tileset from the URL
`/test_tile/tileset.json`. After (re)running the converter, mirror the output into
`public/` so the dev server and the static build can both resolve it:

```bash
# from the repo root
cp -r data/test_tile public/test_tile
```

This is a manual sync step (kept explicit rather than scripted so a stale
`public/test_tile` never silently diverges from `data/test_tile`). The `tileset.json`
inside references `tile.b3dm` by relative URI, so the directory shape must be
preserved (`public/test_tile/{tileset.json,tile.b3dm}`). The Cesium island reads the
tileset URL once at mount: `src/components/react/CesiumViewer.tsx` →
`Cesium.Cesium3DTileset.fromUrl('/test_tile/tileset.json')`.

Because the plaster-void scene uses **no** Cesium Ion asset (no World Terrain, no base
imagery — `baseLayer: false` + `scene.imageryLayers.removeAll()`), this self-hosted
tileset renders **without** a `PUBLIC_CESIUM_ION_TOKEN`.

## Verified PoC (LoD2_392_5820, the Fernsehturm tile)

732 buildings · 26,760 vertices (deduped) · 58,492 triangles · valid `b3dm`
(magic `b3dm`) · `tileset.json` v1.0 · root transform = Berlin ECEF
(`[3782802, 902286, 5038574]`). The Fernsehturm itself is present (building
`DEBE01YYK0000B8a`, Z 34.6–288 m DHHN2016). CRS confirmed EPSG:25833 (UTM 33N,
ETRS89), vertical DHHN2016 lifted to ellipsoidal via the Berlin geoid offset
(+39.5 m). `tile.b3dm` = 1.00 MB (was 1.89 MB pre-dedup).

Before the production hardening below, the same tile was 99,694 vertices /
57,930 triangles / 1.89 MB (fan triangulation, holes skipped, no dedup, no
geoid offset). Triangle count is the same order post-fix (+1 %, the small rise
is the 30 previously-skipped courtyard holes now being modelled); vertices
dropped 73 % and the file 46 %.

## Geometry / datum pipeline (current state)

1. **Robust triangulation** — `parse_citygml.py` uses mapbox-earcut per
   `gml:Polygon`: Newell plane normal → project rings to 2D → earcut
   (shell + holes) → map indices back to 3D. Handles non-convex rings and
   interior rings (courtyards). Degenerate (zero-area) triangles are dropped.
2. **Vertex dedup** — per building, ~1 mm spatial-hash key collapses shared
   wall/roof/ground edges; an unused-vertex compaction pass follows. ~73 %
   vertex reduction on the Fernsehturm tile.
3. **Vertical datum** — `convert_tile.py` adds the Berlin geoid undulation
   (`GEOID_UNDULATION_BERLIN = 39.5`) to DHHN2016 normal heights *before* the
   ECEF reprojection, so Z becomes WGS84-ellipsoidal. Verified: the tile's ECEF
   center shifts exactly 39.5 m along the ellipsoid normal vs the uncorrected
   PoC.
4. **CRS + RTC** — EPSG:25833 → EPSG:4978 (ECEF) via pyproj, stored
   relative-to-center in float32 with the ECEF center on the root Tile
   `transform`. Uniform WHITE material, `doubleSided=True`.

## Known limitations → production follow-ups (before the full 236-tile run)

Status vs the original PoC limitations:

1. ~~**Fan triangulation** assumes convex rings~~ — **FIXED**: earcut handles
   non-convex rings (Newell plane + 2D projection).
2. ~~**Interior rings (holes) skipped**~~ — **FIXED**: the 30 holes in this
   tile are now modelled by earcut (shell + holes).
3. ~~**Z is DHHN2016, not ellipsoidal**~~ — **FIXED (approximation)**: a
   tile-wide +39.5 m geoid offset is applied. This is an approximation; the
   precise per-vertex BKG GCG2016 geoid-grid correction (~±0.5 m residual) is a
   later refinement.
4. ~~**Vertices not deduplicated**~~ — **FIXED**: per-building ~1 mm spatial
   hash + compaction (~73 % reduction here).
5. **Winding / orientation** from GML may be inconsistent — **mitigated, not
   fully solved**: the baked material is `doubleSided=True`, so back-face
   culling will not hide faces regardless of winding, and earcut is
   winding-agnostic. Explicit winding normalization (for lighting / raycast
   normal coherence) remains a possible follow-up.

## Files
- `parse_citygml.py` — lxml parser: `parse_tile(zip_or_xml)` → `[{id, vertices, triangles}]`
  with earcut triangulation (holes), per-building ~1 mm vertex dedup, degenerate-tri drop.
- `convert_tile.py` — geoid offset (+39.5 m) + CRS 25833→ECEF + RTC +
  white-material b3dm/tileset emission via py3dtiles.
