# Contract — CityGML → 3D Tiles Data Pipeline (`scripts/uploadToCesium.js`)

**Feature**: `001-telephoto-los-planner` | **Script**: `scripts/uploadToCesium.js` | **Research**: [research.md §data-pipeline](../research.md)

🟥 **The spec's original assumption is redirected**: Cesium Ion does **not** tile CityGML. This script performs a **local conversion** to glTF/glb (white material + normals, WGS84, ellipsoid heights) and then **either** uploads the glTF to Ion for native glTF tiling **or** writes a self-hosted `tileset.json`. See the [consolidated VERIFY-LIVE checklist](../research.md#consolidated-verify-live-checklist) — most Ion REST details are unverified and must be confirmed before implementation.

## CLI

```bash
node scripts/uploadToCesium.js \
  --input        <citygml-dir>            # dir of CityGML files for Mitte + Lichtenberg
  --districts    mitte,lichtenberg
  --source-crs   EPSG:25832               # EPSG:25832 (current) | EPSG:31468 (historical DHDN)
  --height-datum DHHN                     # DHHN (sea-level) | ellipsoid
  --converter    auto                     # auto | fme | py3dtiles | citygml-to-3d-tiles | custom
  --out-config   src/data/buildings.json  # app reads the tileset location from here
  [--host        ion|self]                # default: ion
  [--self-out    dist/data/berlin-lod2/tileset.json]   # required when --host self
  [--force]                               # re-convert even if out-config exists
```

Environment: `CESIUM_ION_TOKEN` (read when `--host ion`). Never embedded in the repo (Constitution Principle V; `.env` gitignored).

## Pipeline Stages (each a pure, unit-testable function where possible)

1. **Parse** CityGML (LoD2) → triangulated meshes + ground-height semantics per building.
2. **CRS transform** → WGS84 lon/lat/ellipsoid-height. EPSG:25832→4326 near-identity (no datum shift); EPSG:31468 **requires** the DHDN→WGS84 datum transform (else the scene shifts tens of meters — silent LOS corruption).
3. **Height-datum reconcile** DHHN/sea-level → WGS84 ellipsoid (offset table; VERIFY the offset vs Cesium World Terrain).
4. **Emit glTF/glb** with a single **baked uniform-white baseColorFactor material** + `NORMAL` attribute (research: bake white at emit time — runtime styling alone is overridden by converter-baked specular).
5. **Host**:
   - `ion` → create an Ion source asset (REST), upload glTF to the returned upload locations, poll the tiling job to `COMPLETE`, capture `assetId`. (Exact REST endpoints/shapes unverified — VERIFY-LIVE.)
   - `self` → author a one-tile `tileset.json` (+ `.b3dm`/`.glb`) via `3d-tiles-tools` and write to `--self-out`.
6. **Write config** to `--out-config`.

## Output — `src/data/buildings.json` (consumed by `src/cesium/scene.ts`)

```json
{
  "source": "ion",
  "assetId": 12345,
  "sourceCRS": "EPSG:25832",
  "heightDatum": "ellipsoid",
  "districts": ["mitte", "lichtenberg"],
  "materialBaked": true,
  "generatedAt": "2026-07-20"
}
```
…or, for self-host:
```json
{
  "source": "self-hosted",
  "url": "/data/berlin-lod2/tileset.json",
  "sourceCRS": "EPSG:25832",
  "heightDatum": "ellipsoid",
  "districts": ["mitte", "lichtenberg"],
  "materialBaked": true,
  "generatedAt": "2026-07-20"
}
```

`scene.ts` consumes: `source === 'ion'` → `Cesium3DTileset({ url: Cesium.IonResource.fromAssetId(assetId) })`; else `Cesium3DTileset.fromUrl(url)`.

## Exit Codes & Errors (Principle II — explicit, never silent)

- `0` — success; config written.
- `2` — `INVALID_INPUT` (missing `--input`, unreadable files, no district match).
- `3` — `CRS_UNSUPPORTED` (source CRS not 25832/31468, or datum params unavailable).
- `4` — `CONVERTER_FAILED` (chosen converter errored / produced no geometry).
- `5` — `ION_ERROR` (auth failed, upload failed, tiling job `ERROR`).
- `6` — `HEIGHT_DATUM_UNKNOWN` (cannot reconcile).

Each non-zero exit prints a structured `{ code, message, detail }` to stderr.

## Idempotency

If `--out-config` exists and `--force` is absent, the script reads it, verifies the named districts are already present, and exits `0` without re-converting. `--force` re-runs end-to-end (and, for `ion`, creates a new asset — old `assetId` is left for manual cleanup).

## Test Contract (TDD — pure units in `src/lib/*`, no network/Cesium)

- `transformCoord(fromEPSG, toEPSG, [x,y,z])` over fixtures incl. the 31468 datum-shift regression.
- CityGML parser over a minimal LoD2 Solid fixture (hand-written XML) → triangulated mesh + ground height.
- glTF emitter: triangle count, single white `baseColorFactor`, `NORMAL` present, valid JSON.
- `buildTileset(specs)` → JSON validated against a checked-in 3D Tiles schema fixture.
- Upload orchestration state machine with a **mocked** Ion HTTP client: uploads to returned locations, polls `COMPLETE`→writes assetId, `ERROR`→typed error.
- The real conversion + real Ion + real Berlin data is a **manual/live milestone**, not a unit test — a headless-Cesium smoke (white style + known clear/blocked sightline) runs only after the pure units pass.

## VERIFY-LIVE (blocking — confirm before implementing)

- Cesium Ion accepted 3D-tiling source formats (glTF/glb yes; CityGML no).
- Ion REST API base URL, auth scheme, create-asset request body (`sourceType` enum), upload-location endpoint, tiling-job polling + status enum + error retrieval.
- Whether Ion can host a **pre-built** 3D Tiles tileset vs only on-demand tiling of a single source (decides `--host ion` vs `self`).
- Per-asset size/pricing limits for the full Mitte+Lichtenberg volume.
- Converter viability: `citygml-to-3d-tiles` (npm) existence; `py3dtiles` mesh path; `citygml-tools` export capability; FME licensing; EPSG:31468 `+towgs84` params.
- Berlin LoD2 download URL, granularity, declared CRS, LoD level, license, **Fernsehturm inclusion**; height-datum facts.
