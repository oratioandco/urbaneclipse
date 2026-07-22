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
- `fetch_dgm1.py` — downloads Berlin ATKIS DGM1 (1 m terrain) sheets for the AOI.
- `build_heightmap.py` — DGM1 → compact int16 lon/lat heightmap for runtime sampling.

---

# Ground-elevation heightmap (DGM1 → browser asset)

## Why

The scene has **no Cesium terrain provider** — the globe is a bare WGS84
ellipsoid at height 0 — while `convert_tile.py` lifts the LoD2 buildings to
*ellipsoidal* heights (DHHN2016 + 39.5 m). Berlin ground is ~34 m DHHN2016 ≈
**73.5 m ellipsoidal**, so anything that assumes "ground ≈ 0" places the
observer ~72 m below the actual street. This pipeline supplies the real ground
elevation so the observer can be planted correctly.

## Source (verified reachable 2026-07, no auth)

| | |
|---|---|
| Dataset | **ATKIS® DGM1 Berlin** — 1 m *bare-earth* digital terrain model |
| ATOM feed | `https://gdi.berlin.de/data/dgm1/atom` → `0.atom` → per-sheet zips |
| Sheet URL | `https://gdi.berlin.de/data/dgm1/atom/DGM1_<E_km>_<N_km>.zip` |
| Tiling | 2 km × 2 km, named by SW corner in whole (even) km |
| Payload | one `dgm1_33_<E>_<N>_2_be.xyz` — ASCII `E N H`, 1 m posting, cell **centres** (`…​.500`), 4 M lines / ~120 MB per sheet (~17 MB zipped) |
| CRS | **EPSG:25833** (ETRS89 / UTM 33N) — *identical to the LoD2 CityGML, not 25832* |
| Vertical datum | **DHHN2016** normal heights (NHN) — *identical to the LoD2 CityGML* |
| Accuracy | ±10 cm + 5 % of grid spacing in flat open terrain (95 %) |
| License | Datenlizenz Deutschland – Zero – 2.0 (`https://www.govdata.de/dl-de/zero-2-0`) |

A companion **DOM1** *surface* model (same tiling/CRS/datum, includes bridges,
buildings and vegetation) lives at `https://gdi.berlin.de/data/dom/atom` — note
its member file is `*.txt`, not `*.xyz`. It is not part of this pipeline, but it
is the right source if a *deck* elevation (bridge, roof) is ever needed rather
than bare earth.

## Usage

```bash
# 1. download the DGM1 sheets covering the AOI (into gitignored data/)
./.venv/bin/python scripts/fetch_dgm1.py

# 2. build the compact heightmap asset
./.venv/bin/python scripts/build_heightmap.py \
    --probe 52.5106,13.4652 --probe 52.5208,13.4093

# 3. mirror the (small) asset into public/ so Astro serves it at /heightmap/*
cp -r data/heightmap public/heightmap
```

Same manual-sync convention as `public/berlin-core`: `data/` is gitignored and
not web-served, `public/` is served at the web root. **Unlike the b3dm tiles,
the heightmap is small enough to commit** (~0.7 MB), so `public/heightmap/`
should be checked in; the ~170 MB of raw `data/dgm1/*.zip` must **not** be.

## AOI

`fetch_dgm1.py` derives the AOI from the `tile_<E>_<N>.b3dm` children of
`public/berlin-core/tileset.json` (E 389–394 km / N 5818–5822 km) and then
**expands it to contain `REFERENCE_POINTS`**. This matters: the default observer
coordinate (52.5106, 13.4652 → E 395841) is ~1.8 km **east** of the berlin-core
building AOI, so a heightmap built from the building bounds alone would not
cover the observer at all. Result: 10 sheets, E 388/390/392/394/396 ×
N 5818/5820.

`build_heightmap.py` then clamps its grid to whatever sheets actually exist, and
uses the largest lon/lat box **inscribed** in that UTM coverage (a
circumscribing box would have nodata corners).

## Output format

`data/heightmap/berlin-dgm1.json` (header) + `berlin-dgm1.bin` (raw samples).

```
int16 little-endian, width*height samples, row-major, no padding
height_m = value * scale + offset      (scale 0.1 m, offset 0.0)
nodata   = -32768
index    = row * width + col
row 0    = SOUTH (latMin), increasing north
col 0    = WEST  (lonMin), increasing east
lon(col) = lonMin + col*dLon,  lat(row) = latMin + row*dLat
```

Regular in **EPSG:4326** on purpose: the browser samples it with a plain
bilinear lookup on lon/lat, no reprojection at runtime. Each node is the *mean*
of the 1 m DGM1 postings in its cell (box decimation → anti-aliased, so a single
lamppost-sized pit cannot dominate a node).

## Vertical datum — the load-bearing part

Samples are **ORTHOMETRIC DHHN2016 (NHN) metres**. The geoid undulation is
deliberately **not** baked in; it is reported in the header so the consumer
applies exactly the convention `convert_tile.py` used for the buildings:

```
h_ellipsoidal = sample + header.geoidUndulation.appliedByConvertTile   // 39.5
```

DGM1 and the Berlin LoD2 CityGML share DHHN2016, so **ground and building bases
are in the same vertical datum with no shift** — that is what makes a single
constant safe.

The header also carries `geoidUndulation.gcg2016`, the *true* BKG GCG2016
undulation over the AOI, obtained through PROJ (`EPSG:4326+7837 → EPSG:4979`,
`PROJ_NETWORK=ON`, grid fetched from the PROJ CDN). Measured over this AOI:
**39.147 – 39.381 m, mean 39.262** — i.e. the hardcoded 39.5 m is
~**0.24 m too high**, and the true undulation varies only ~0.23 m across the
whole 7 × 4 km AOI. Replacing the constant with a per-vertex GCG2016 lookup in
`convert_tile.py` is entirely practical (one `pyproj.Transformer` call on the
vertex array, grid auto-downloaded by PROJ) but is worth <0.3 m — and if it is
done it must be done in `convert_tile.py` **and** here together, or ground and
buildings will disagree.

## Verified output (2026-07 run)

| | |
|---|---|
| Grid | 725 × 385 = 279,125 nodes, ~10 m spacing |
| `berlin-dgm1.bin` | **558,250 bytes** (0.53 MiB) — well under the 2 MB budget |
| `berlin-dgm1.json` | 2,139 bytes |
| bbox | lon 13.36107 – 13.46793, lat 52.50222 – 52.53671 |
| Heights | 16.85 – 90.50 m DHHN2016, mean 38.76, p0.5 30.75 / p99.5 63.97 |
| nodata nodes | **0** |
| Build time | ~14 s from the cached sheets |

Sampled cross-checks against independently published elevations:

| Point | Heightmap (DHHN2016) | Published | Δ |
|---|---|---|---|
| Volkspark Friedrichshain, Gr. Bunkerberg | **78.10 m** | ~78 m | ~0.1 m |
| Volkspark Prenzlauer Berg summit | **90.50 m** | ~91 m | ~0.5 m |
| Fernsehturm base (52.5208, 13.4093) | **35.31 m** | LoD2 building ground Z 34.6 m | 0.7 m |
| Spree at Museumsinsel (lowest node) | **30.80 m** | Spree/Oberwasser ~31 m | ~0.2 m |
| Viktoriapark Kreuzberg summit (raw DGM1, outside AOI) | **65.92 m** | 66 m | ~0.1 m |
| Großer Müggelberg (raw DGM1 sheet max, outside AOI) | **114.66 m** | 114.7 m | 0.04 m |

The 16.85 m minimum is a real, ~18 m deep man-made pit near
Ida-von-Arnim-Straße (Charitéviertel) — the DGM1 models excavations; it is not a
datum error. That is why the plausibility gate is applied to the 0.5/99.5
percentiles rather than the absolute extremes.

## Note on the "Lichtenberger Brücke" observer coordinate

The default observer coordinate **(52.5106, 13.4652) is not on the Lichtenberger
Brücke.** It is a street-level point in the Boxhagener Kiez, Friedrichshain
(Wismarplatz / Weserstraße), ~2.3 km west of the actual bridge. Both DGM1
(terrain) and DOM1 (surface) read **≈ 36.3 m** there — identical, i.e. no
elevated structure exists at that spot.

The real Lichtenberger Brücke (Frankfurter Allee over the Lichtenberg rail
corridor) is at ≈ **52.5113, 13.4988**. Derived from DOM1/DGM1 (2 m boxes along
the deck centreline):

| | DHHN2016 |
|---|---|
| Deck crest (mid-span, DOM1) | **48.1 – 48.3 m** |
| Deck at west ramp / east ramp | 46.1 m / 46.7 m |
| Bare ground / rail level beneath (DGM1) | **39.3 m** |
| Deck above rail level | ~8.8 m |

So a person standing mid-span has their feet at ~48.2 m DHHN2016 (≈ 87.7 m
ellipsoidal with +39.5) and their eyes at ~49.8 m (≈ 89.3 m ellipsoidal).
No surveyed deck elevation could be found in any public source; these figures
are derived from the 1 m airborne-laser DOM1, whose stated accuracy is ±10 cm
plus whatever the laser hit (railings, vehicles) — the mid-span p05–p95 spread
was only 0.4 m, so **±0.3 m** is a fair error bar on the deck value.


---

## Publishing the full Berlin tileset (Hetzner + Coolify)

The committed `public/berlin-core/` subset (20 tiles, 28 MB) ships inside the Docker
image. The full city is far too large for that, so it lives on the Hetzner host and is
served from a Docker volume mounted into the app's nginx docroot.

**Why not object storage.** The tiles are served from the SAME ORIGIN as the app
(`https://<app>/berlin-full/...`), so there is no CORS configuration to get wrong, no
second provider, and traffic is covered by the server's existing allowance. Note the
Hetzner Storage Box on this account (`u591347.your-storagebox.de`) is SFTP-only backup
storage with no public HTTP and no CORS control — it cannot serve tiles to a browser.

### 1. Convert the whole city

```bash
.venv/bin/python scripts/convert_batch.py --all --out data/berlin-full --progress-every 25
```

Resumable and idempotent: a tile whose `.b3dm` is newer than its source zip is reused,
so an interrupted run continues where it left off. Produces **924 tiles / 545 MB** from
the 925 source zips (one contains no buildings). ~15-20 minutes. `data/` is gitignored.

The default (no `--all`) still selects the original 236 central tiles.

### 2. Sync to the host

```bash
scripts/sync_tiles_hetzner.sh
```

Requires **Tailscale** — the Hetzner firewall exposes only 80/443/ICMP publicly, so SSH
is Tailscale-only. Uses compressed, resumable rsync; expect ~20-40 minutes for a cold
545 MB sync (the path is latency-bound at ~160 ms RTT), and only changed tiles
thereafter. The script verifies the remote tile count matches and exits non-zero if not.

### 3. Coolify wiring (already applied — documented for rebuilds)

A persistent volume maps the host directory into the nginx docroot:

| | |
|---|---|
| host path | `/data/plastervoid/tiles/berlin-full` |
| mount path | `/usr/share/nginx/html/berlin-full` |
| name | `plastervoid-berlin-tiles` |

```bash
coolify app storage create <app-uuid> --type persistent \
  --name plastervoid-berlin-tiles \
  --host-path /data/plastervoid/tiles/berlin-full \
  --mount-path /usr/share/nginx/html/berlin-full
```

The tileset URL is set by the **Dockerfile** rather than a Coolify env var, so it is
version-controlled and reproducible:

```dockerfile
ARG PUBLIC_TILESET_URL="/berlin-full/tileset.json"
```

Astro bakes `PUBLIC_*` at build time, so changing it requires a rebuild, not a restart.
To build an image serving only the committed subset:
`--build-arg PUBLIC_TILESET_URL=/berlin-core/tileset.json`.

`nginx.conf` gives `/berlin-full/`, `/berlin-core/` and `/heightmap/` an explicit
`try_files $uri =404`. Without it the SPA fallback would answer a missing tile with
`index.html` at HTTP 200, and Cesium would try to parse HTML as b3dm — an opaque
failure that looks like corrupt geometry rather than a missing file.

If the volume is empty or unmounted, `tileset.json` 404s and the app reports
"Building data unavailable" with the URL and status, rather than rendering an empty void.

