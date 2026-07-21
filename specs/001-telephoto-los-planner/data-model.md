# Data Model — Telephoto Line-of-Sight Planner ("Plaster Void")

**Feature**: `001-telephoto-los-planner` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

This feature has **no server-side persistence** — the data model is a set of client-side value types (TypeScript interfaces/enums) flowing through the nanostores store and the pure functions in `src/lib/*`. The split between **pure value types** (here, testable) and **Cesium-bound runtime objects** (Cartesians, etc.) follows the plan's `src/lib/*` vs `src/cesium/*` boundary (Constitution Principle I).

## Enums / Value Types

```ts
/** Result of the pure LOS classifier (src/lib/occlusionMath.ts). */
type OcclusionState = 'clear' | 'occluded' | 'marginal' | 'same-point' | 'unknown';

/** Celestial body under consideration. */
type CelestialBody = 'sun' | 'moon';

/** Kind of object a ray intersection hit (drives occlusion classification). */
type IntersectionKind = 'building' | 'terrain' | 'other';

/** Where the Berlin LoD2 tileset is served from. */
type BuildingSource = 'ion' | 'self-hosted';

/** Coordinate reference system the source CityGML uses (research §data-pipeline). */
type SourceCRS = 'EPSG:25832' | 'EPSG:31468';   // ETRS89/UTM 32N (current) | DHDN/GK zone 4 (historical)

/** Vertical datum of CityGML Z values (research §data-pipeline). */
type HeightDatum = 'DHHN' | 'ellipsoid';         // above sea level | WGS84 ellipsoid
```

## Entities

### Observer
A standing point from which the sightline originates.

| Field | Type | Default | Validation |
|-------|------|---------|------------|
| `lat` | `number` (deg) | `52.5106` (Lichtenberger Brücke) | `-90..90`; v1 within Berlin bounds |
| `lon` | `number` (deg) | `13.4652` | `-180..180`; v1 within Berlin bounds |
| `heightAboveGround` | `number` (m) | `1.5` (tripod) | `> 0`, clamp `0..100` |

*Derived (Cesium-bound, not stored)*: `terrainHeight` (via `sampleTerrainMostDetailed`), `cartesian`.

### Target
The structure the sightline terminates on.

| Field | Type | Default | Validation |
|-------|------|---------|------------|
| `lat` | `number` (deg) | `52.5208` (Fernsehturm) | `-90..90` |
| `lon` | `number` (deg) | `13.4093` | `-180..180` |
| `heightAboveGround` | `number` (m) | `210` ⚠️ | `> 0`, clamp `0..400` |

> ⚠️ **VERIFY (research §scene)**: the Fernsehturm total height is **~368 m**; the spec's 210 m may be an observation-deck reference. Confirm and set the default accordingly.

### Sightline
The segment between observer eyepoint and target point, with a derived occlusion state. **Time-independent** (research §occlusion) — recomputed only on observer/target change or tile-load.

| Field | Type | Notes |
|-------|------|-------|
| `observer` | `Observer` | |
| `target` | `Target` | |
| `state` | `OcclusionState` | `unknown` until first compute / tiles loaded |
| `occluderKind` | `IntersectionKind \| null` | what blocks it, if anything |
| `targetDistance` | `number` (m) | `distance(observer, target)` (~5500 for the default pair) |

**State transitions**:
```
unknown ──(tiles loaded + heights set + ray cast)──► { clear | occluded | marginal }
same-point ◄──(targetDistance < epsilon)──
any ──(observer/target move OR tile-load completes)──► unknown ──► recompute
```

### CelestialPosition
A body's direction at a given instant (output of `suncalc.getPosition` / `getMoonPosition`).

| Field | Type | Notes |
|-------|------|-------|
| `body` | `CelestialBody` | |
| `azimuth` | `number` (rad) | **suncalc convention: 0 = south, + west** (research §ephemeris) |
| `altitude` | `number` (rad) | above horizon |
| `at` | `Date` | |

*Derived (pure, `src/lib/ephemerisMath.ts`)*: `enuDirection` (unit vector), and a **north-referenced** azimuth for comparison with geodesic bearings (the `±π` conversion — research §features-2 critical risk).

### AlignmentWindow
A moment a celestial body matches a required target direction within tolerance (solver output).

| Field | Type | Notes |
|-------|------|-------|
| `at` | `Date` | the matching instant (1-min resolution) |
| `body` | `CelestialBody` | |
| `azimuth` | `number` (rad, north-referenced) | |
| `altitude` | `number` (rad) | |
| `angularDistanceDeg` | `number` | `≤ 0.5` (combined 3-D unit-sphere distance) |
| `moonIllumination?` | `{ fraction: number; phase: number }` | optional enrichment (for "full moon behind tower") |

### CameraProfile
Sensor + lens parameters defining a field of view.

| Field | Type | Default | Validation |
|-------|------|---------|------------|
| `sensorWidth` | `number` (mm) | `36` (full-frame) | `> 0` |
| `focalLength` | `number` (mm) | `600` | `> 0` |
| `zoom` | `number` | `1` | `> 0` (multiplier on focal length, optional) |

*Derived (pure, `src/lib/cameraMath.ts`)*: `horizontalFov = 2 * atan(sensorWidth / (2 * focalLength * zoom))` (radians).

**Presets**: sensors — full-frame 36, APS-C ~23.6, Micro 4/3 ~17.3; focal lengths — 70/100/200/400/600/800 mm.

### BuildingGeometry
The Berlin LoD2 tileset as a data asset (research §data-pipeline).

| Field | Type | Notes |
|-------|------|-------|
| `source` | `BuildingSource` | `ion` (assetId) or `self-hosted` (url) |
| `assetId?` | `number` | Ion asset id (if `source === 'ion'`) |
| `url?` | `string` | `tileset.json` URL (if `source === 'self-hosted'`) |
| `sourceCRS` | `SourceCRS` | declared CRS of the original CityGML |
| `heightDatum` | `HeightDatum` | vertical datum of original Z values |
| `districts` | `('mitte' \| 'lichtenberg')[]` | coverage |
| `materialBaked` | `boolean` | uniform-white material baked at conversion time |

## Application State (nanostores — see [contracts/store.md](./contracts/store.md))

| Atom | Type | Default | Writable by |
|------|------|---------|-------------|
| `dateTime` | `Date` | now | control panel (rAF-coalesced via `setDateTimeScrubbing`), solver result, step buttons |
| `observerHeight` | `number` | `1.5` | control panel slider |
| `targetHeight` | `number` | `210` | control panel slider |
| `isOccluded` | `boolean` (read-only `computed`) | `false` | **occlusion engine only**, via `commitOcclusion(v)` |
| `cameraProfile` | `CameraProfile` | full-frame + 600 mm | camera controls |
| `solverState` | `{ status: 'idle' \| 'running' \| 'done' \| 'error'; progress: number; matches: AlignmentWindow[] }` | `idle` | solver worker → main thread |
| `timelineBands` | `Band[]` | `[]` | derived from `getTimes` on `dateTime` change |

## Validation Rules (Constitution Principle II — defensive)

- **Heights**: `observerHeight`/`targetHeight` clamped to `(0, max]`; non-finite → reject + surface error (never silently NaN the ray).
- **Coordinates**: lat/lon range-checked; v1 additionally bounded to the Berlin region (Mitte/Lichtenberg) — out-of-bounds surfaces a warning, not a crash.
- **Date ranges** (solver): `start < end`; span capped (e.g., ≤ 1 year) to bound worker runtime; invalid → typed error.
- **Solver tolerance**: `0 < toleranceDeg ≤ 5` (default 0.5); `angularDistanceDeg` dot product clamped to `[-1, 1]` before `acos` (avoids NaN at the poles).
- **FOV**: `sensorWidth > 0`, `focalLength > 0`, else throw.
- **Token**: Cesium Ion token presence checked at bootstrap; missing → explicit error screen (FR-013), never silent fallback to the demo token.
- **Tiles gate**: occlusion cannot resolve `clear`/`occluded` until `tilesLoaded === true`; stays `unknown` otherwise (prevents false-clear on slow tile streaming).

## Key Relationships

```
Observer + Target ──► Sightline ──(classifyOcclusion + intersections)──► OcclusionState ──► isOccluded (store)
Date + Observer.lat/lon ──► CelestialPosition (sun/moon) ──► shadows (Cesium clock) + timelineBands
Date range + target direction ──► AlignmentWindow[] (solver, worker)
CameraProfile ──► horizontalFov ──► Cesium frustum
CityGML (EPSG:25832/31468, DHHN) ──► BuildingGeometry (WGS84, ellipsoid, white) ──► Cesium3DTileset
```
