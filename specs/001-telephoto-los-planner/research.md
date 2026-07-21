# Phase 0 Research — Telephoto Line-of-Sight Planner ("Plaster Void")

**Feature**: `001-telephoto-los-planner` | **Date**: 2026-07-20 | **Plan**: [plan.md](./plan.md)

## Methodology & Confidence

This research was produced by an **8-domain parallel research workflow** (`plaster-void-phase0-research`, run `wf_d92c17a3-76b`). **WebSearch and the web reader were unavailable this session** (rate-limited), so all findings are **reasoned from training knowledge** — every fact that must be confirmed against live docs before implementation is collected in the [Consolidated VERIFY-LIVE Checklist](#consolidated-verify-live-checklist). Per-domain confidence:

| Domain | Confidence | One-liner |
|--------|-----------|-----------|
| `integration` (Astro/React/Vite/Cesium) | **medium** | `client:only` island + `vite-plugin-cesium`; keep cesium out of the SSR graph |
| `data-pipeline` (CityGML→3D Tiles) | **low** 🔴 | **Ion does NOT tile CityGML** — convert locally first. Likely Phase-1 blocker |
| `scene` (Viewer/terrain/tileset/camera) | **medium** | All widgets off; local `tileset.json`; camera at observer, heading = bearing |
| `ephemeris` (suncalc→sun/shadows) | **medium** | Drive Cesium clock (Strategy B) — gated on a sun-agreement test |
| `occlusion` (LOS raycasting) | **medium** | `drillPickFromRay` + pure classifier; **time-independent** — recompute on move only |
| `state` (nanostores) | **high** | `computed` read-only `isOccluded`; rAF-coalesced scrub; occlusion ≠ time |
| `art-direction` (plaster void) | **medium** | `CustomShader` matte white; keep `SunLight`; shader has 4 correctness risks |
| `features-2` (solver/timeline/camera) | **medium** | Worker over `src/lib/solver.ts`; derive blue hour; FOV semantics must be verified |

---

## 🔴 CRITICAL FINDING — Data Pipeline (resolves the Phase-1 blocker)

**The spec's assumption is wrong.** `scripts/uploadToCesium.js` *cannot* "upload CityGML to Cesium Ion and trigger a tiling pipeline," because **Cesium Ion's 3D Tiling service does not ingest CityGML**. Ion accepts a closed set of source formats — **glTF/glb, OBJ, FBX, DAE (Collada), LAS/LAZ/XYZ point clouds, and passthrough 3D Tiles** — not the GML application schema CityGML uses.

**Recommended pipeline** (Decision):

```
Berlin CityGML (LoD2) ──► [LOCAL CONVERTER] ──► glTF/glb (white material, normals)
        │                                            │
        │  CRS: EPSG:25832 → WGS84 (near-identity)   │
        │  (EPSG:31468 historical → needs datum shift)│
        │  Height: DHHN/sea-level → ellipsoid reconcile│
        │                                            ▼
        │                              ┌──────────────┴──────────────┐
        │                              ▼                              ▼
        │                   (Option A) Upload glTF to Ion        (Option B) Self-host
        │                   for Ion's native glTF tiling;        the tileset; reference
        │                   poll job; write assetId              by URL in Cesium3DTileset
        │                              │                              │
        └──────────────────────────────┴──────────────────────────────┘
```

**`scripts/uploadToCesium.js` should actually**: parse CityGML → transform CRS to WGS84 → emit glTF (baked uniform-white material + normals) → create an Ion source asset via REST API → poll the tiling job → write the resulting `assetId` to a config/env file the app reads.

**Converter options** (all need VERIFY-LIVE — confidence low):
- **FME** (commercial) — CityGML reader + 3D Tiles writer; most robust/repeatable; cost is the blocker.
- **py3dtiles** (OSS, Python) — generates 3D Tiles; mesh/b3dm support added in newer versions; needs a separate CityGML parser.
- **citygml-to-3d-tiles** (npm) — would fit the TS stack; **existence/maintenance unverified** (low confidence).
- **citygml-tools** (virtualcitySYSTEMS, Java) — good for validation/transform; to my knowledge **does NOT export glTF/3D Tiles**.
- **3d-tiles-tools** (CesiumGS, official TS CLI) — **not** an importer; useful *downstream* (`upgrade`, `glbToB3dm`, `tilesetToTileset`).
- **"Nussknacker"** — **name collision** with a stream-processing engine; not a real CityGML→3D-Tiles tool.

**Why this is a potential Phase-1 redirect**: if no maintained open-source converter handles Berlin LoD2 (CityGML 2.0/3.0, EPSG:25832, LoD2 roof solids), Phase 1 must either license FME or hand-build a CityGML→glTF parser. This changes scope/timeline/tooling. **This is the kind of "technical limitation" the spec permits as a reason to deviate from the original upload-to-Ion design.**

**Two silent-failure traps** (Principle II):
1. **CRS datum shift** — treating EPSG:31468 (DHDN) data as UTM/WGS84 shifts the whole scene by tens of meters and silently corrupts LOS occlusion (P1). EPSG:25832→4326 is near-identity (ETRS89≈WGS84), but 31468 needs the DHDN→WGS84 datum transform.
2. **Height-datum mismatch** — CityGML Z is typically DHHN (above sea level); Cesium World Terrain is ellipsoid-referenced. Unreconciled, buildings float/sink by meters, corrupting both the plaster look and LOS.

---

## Domain Decisions

### 1. Integration — Astro + React + Vite + Cesium *(medium)*

**Decision**: Astro `output: 'static'` with Cesium mounted in a **single `client:only="react"` island**. Wire Cesium runtime assets via `vite-plugin-cesium` (fallback: manual `define: { CESIUM_BASE_URL }` + `vite-plugin-static-copy` of `cesium/Build/Cesium/{Workers,Assets,ThirdParty,Widgets}`). Set `Cesium.Ion.defaultAccessToken` exactly once in a **client-only bootstrap module** before any `Viewer`/`IonResource`, reading from `import.meta.env.PUBLIC_CESIUM_ION_TOKEN`. Use Cesium's **bundled `.d.ts`** (do **not** install `@types/cesium`). The reverse-ephemeris worker imports `suncalc` only — never cesium.

**Key rule**: keep **all** `import * as Cesium from 'cesium'` confined to the `client:only` island + `src/cesium/*`. If any server-reachable module transitively imports cesium, `astro build` crashes with `window is not defined`.

```ts
// astro.config.mjs — shape (VERIFY plugin options)
export default defineConfig({
  output: 'static',
  integrations: [react()],
  vite: {
    plugins: [cesium(), tailwind()],
    ssr: { external: ['cesium'] },          // guardrail
    optimizeDeps: { exclude: ['cesium'] },
  },
});
```

**TDD (Vitest, no WebGL)**: (1) assert `CESIUM_BASE_URL` resolves + token set before mocked `Viewer`; (2) **source-graph guard test** — fail if any file under `src/pages/**`/`src/layouts/**` imports `'cesium'`; (3) assert worker factory uses `new Worker(url, { type: 'module' })`.

---

### 2. Scene — Viewer / terrain / tileset / camera *(medium)*

**Decision**: `Cesium.Viewer` with **all widget booleans false** (animation, timeline, baseLayerPicker, fullscreenButton, geocoder, homeButton, infoBox, sceneModePicker, selectionIndicator, navigationHelpButton) + `baseLayer: false` (no imagery); `CesiumWorldTerrain` from Ion; Berlin LoD2 loaded from a **local `tileset.json` URL** (Ion can't tile CityGML); camera positioned at the observer with `heading = greatCircleBearing(observer→target)` (~WNW ≈ 290–300°), small positive pitch, and a **narrow `PerspectiveFrustum.fov`** for the telephoto look. Drive `scene.clock.currentTime` from the same JS Date used by suncalc so native sun/shadows stay consistent. CSS-hide the credit container (the credits API option name churns between versions).

**Key APIs**: `Cesium3DTileset.fromUrl('/data/berlin-lod2/tileset.json')` + `scene.primitives.add(tileset)`; `camera.setView({ destination: Cartesian3.fromDegrees(lon, lat, terrainH + eyeH), orientation: { heading, pitch } })`.

**⚠️ Fernsehturm height**: the spec assumes **~210 m**, but the Fernsehturm's total height is **~368 m** (the ~210 m may be the observation deck / a sphere). **VERIFY** the actual reference height and whether the tower is in the chosen LoD2 dataset — this affects `targetHeight` default + framing.

**TDD (pure, `src/lib/sceneMath.ts`)**: `greatCircleBearing()` (assert observer→target ≈ 290–300°, reverse ≈ 110–120°, cardinals), `cameraOrientation()`, `viewerOptions()` (assert every widget `=== false`), `telephotoFrustum(fovDeg, aspect)`.

---

### 3. Ephemeris — suncalc → sun/moon + shadows *(medium)*

**Decision**: **PRIMARY = Strategy B** — drive `viewer.clock.currentTime = JulianDate.fromDate(date)` so Cesium's **native sun** drives *both* `globe.enableLighting` and the `ShadowMap` (they consume the same internal sun → can never disagree). `viewer.shadows = true`, `globe.enableLighting = true`, `tileset.shadows = ShadowMode.ENABLED`. **GATED** on a verified sun-agreement test (Cesium internal sun vs suncalc < ±0.5°, target < 0.1°). `scene.sun.show = false` hides only the sun **glyph**, not the lighting (verify per version). **FALLBACK = Strategy A** — custom `Cesium.DirectionalLight` from suncalc alt/az → ENU → ECEF, with `globe.enableLighting = false` (used only if agreement fails or pixel-exact solver/render parity is required).

**suncalc azimuth convention**: **0 = south, + west** (CRITICAL — classic north/south conversion bug vs Cesium's north-referenced compass). Pin with a golden test at solar noon (should point due south). **Moon** is decorative only — Cesium's `Moon` contributes nothing to lighting/shadows natively.

**Key APIs**: `SunCalc.getPosition(date, lat, lon) → {azimuth, altitude}` (radians); `getMoonPosition(date, lat, lon)`; `Simon1994PlanetaryPositions.computeSunPosition(julianDate)` (pure math — usable in Node for the agreement test, no Viewer).

**TDD**: golden snapshot of `getPosition`; alt/az→ENU unit vector (assert magnitude 1, solar-noon → south); ENU→ECEF round-trip; **the cross-library agreement test** (Cesium sun vs suncalc < 0.5° across sampled dates) — this test ratifies Strategy B and must pass green before shipping B.

---

### 4. Occlusion — line-of-sight raycasting *(medium)*

**Decision**: sample terrain height at observer & target via `sampleTerrainMostDetailed` (await, then add heights) → Cartesian3 each → `new Cesium.Ray(observer, normalize(target − observer))` → **`Scene.drillPickFromRay(ray)`** (returns **all** intersections, not just the closest) → pure classifier. Render observer→target as an **Entity polyline**, red (occluded/marginal) / green (clear), `width: 1.0`, `clampToGround: false`.

**Pure classifier** (testable without Cesium):
```ts
classifyOcclusion(observer: V3, target: V3,
  intersections: { distance: number; kind: 'building'|'terrain'|'other' }[],
  epsilon = 0.5): 'occluded' | 'marginal' | 'clear' | 'same-point'
```
targetDistance = `distance(observer, target)`; any intersection with `kind ∈ {building, terrain}` and `distance ∈ (epsilon, targetDistance − epsilon)` → **occluded**; within ±epsilon of targetDistance → **marginal** (grazing); none → **clear**.

**🟥 Most important performance fact**: **LOS occlusion is TIME-INDEPENDENT** — the observer→target ray is fixed by lat/lon + heights; only *shadows* move with the sun. So recompute **only when observer/target move or tiles finish loading** — **never per frame** and **never on `dateTime` change**. `drillPickFromRay` issues a GPU pick pass; per-frame calls tank FPS.

**Must gate on `tilesLoaded`** — if LoD2 tiles along the 5.5 km path aren't loaded yet, the ray sees nothing → false CLEAR. Cross-check terrain-only blocks with `Globe.pick(ray, scene)` if `drillPickFromRay` doesn't reliably return terrain hits.

**TDD**: the pure classifier over fixture intersection arrays (clear, occluded-by-building, occluded-by-terrain, grazing/marginal, closest-is-target, multi-hit, same-point, order-independence).

---

### 5. State — nanostores *(high)*

**Decision**: single `src/store.ts` exporting four atoms. `dateTime` (Date, default now), `observerHeight` (1.5), `targetHeight` (210), and a **private** `_isOccludedSource` atom wrapped as `isOccluded = computed(_isOccludedSource, v => v)` so it is genuinely **read-only** to consumers (`computed` stores expose no working `.set()`). The occlusion engine (inside the `CesiumViewer` island) is the **sole writer** via `commitOcclusion(v)` (guarded by `Object.is` to skip redundant notifies). Slider scrubbing uses a **rAF-coalesced** `setDateTimeScrubbing(date)` (≤1 commit/frame, latest-wins); all other writers call `dateTime.set()` directly.

**Dependency direction** (encodes the time-independence fact from §4):
- `dateTime` listener → sun-clock + shadow refresh.
- `observerHeight`/`targetHeight` listeners → occlusion recompute.
- `isOccluded` → read-only in the control panel.

**Key risk**: listener leaks — every `.listen()` in the island MUST be unsubscribed in `useEffect` cleanup, or HMR/remounts stack callbacks and multiply Cesium work.

**TDD (pure, no Cesium)**: initial values; **read-only guarantee** (`(isOccluded as any).set(true)` throws/absent); `commitOcclusion` equality guard (no double-notify); rAF coalescing (fake timers + stubbed `requestAnimationFrame` — burst → single notify); **the dependency-direction guard** (set `dateTime` → `updateSunClock` called, `recomputeOcclusion` NOT; set height → vice-versa).

---

### 6. Art Direction — "Plaster Void" *(medium)*

**Decision** — four independent layers:

- **(A) Kill realism** at construction (`baseLayer: false`) + imperative flags: `skyBox.show=false`, `skyAtmosphere.show=false`, `sun.show=false`, `moon.show=false`, `fog.enabled=false`, `globe.showGroundAtmosphere=false`, `globe.baseColor=#f4f4f4`, `imageryLayers.removeAll()`.
- **(B) Force plaster** in **two parts** (style alone is insufficient — LoD2 b3dm specular bleeds through white albedo): `tileset.style = Cesium3DTileStyle({ color: "color('#ffffff')" })` **AND** a `CustomShader` (PBR, `roughness=1, metallic=0, specular=0, diffuse=vec3(1)`); flatten IBL via `tileset.imageBasedLighting.imageBasedLightingFactor = Cartesian2(0,0)`.
- **(C) Harsh studio shadows** — **keep the default `SunLight`** (do NOT replace). `scene.sun.show=false` hides only the glyph; lighting/shadow direction still come from `scene.light` driven by `scene.time` → time-scrubbed shadows keep working with **no sun disc** (verify per version — this is the linchpin of "no sky/sun but real shadows").
- **(D) Haze + grain PostProcessStage** using `colorTexture` + auto-bound `depthTexture`, `czm_readDepth`, `czm_windowToEyeCoordinates`, `czm_frameNumber`.

**🟥 Shader critique — 4 correctness risks** (the spec's exact shader has latent bugs):
1. **`depth == 1.0` exact comparison — HIGH risk.** With `logarithmicDepthBuffer=true` (default), distant 5.5 km geometry samples extremely close to 1.0 → flicker. **Never** compare `== 1.0`; use `isBackgroundDepth(d) = d > 0.9999` (a pure TS helper, unit-tested at the boundary).
2. **`fogStart`/`fogEnd` unit mismatch — HIGHEST silent-bug risk.** `czm_windowToEyeCoordinates(...).xyz` length is in **meters**. The spec's `fogStart=3000 / fogEnd=8000` only make sense as **meters of eye-space distance**; comparing against raw window depth `[0,1]` either fully fogs or doesn't fog at all. Compute `float dist = length(czm_windowToEyeCoordinates(vec4(gl_FragCoord.xy, depth, 1.0)).xyz)` and `smoothstep(fogStart, fogEnd, dist)`.
3. **`depthTexture` availability — medium risk.** Auto-bound on WebGL2 when referenced; guard on `scene.context.depthTexture` and degrade gracefully (else black screen).
4. **GLSL ES version — medium risk.** Cesium injects `#version`/`precision` and all `czm_*`; do **not** add your own. Write GLSL ES 1.00 style (`texture2D`, not `texture`); cast `czm_frameNumber` explicitly (type varies by version).

**TDD**: pure config factory (`createPlasterSceneConfig()`), `applyPlasterVoid(sceneStub)` with spy scene, GLSL-source builder asserting the 4 rules as substring assertions (no `#version`, uses `texture2D`, epsilon background test, `length(czm_windowToEyeCoordinates(...).xyz)`, references `czm_frameNumber`), `isBackgroundDepth()` boundary tests. Visual proof is Playwright + headless-WebGL (SwiftShader) perceptual-hash regression — `@gpu`, mandatory pre-merge of any shader change.

---

### 7. Features-2 — solver / timeline / camera *(medium)*

- **(a) Reverse-ephemeris Worker**: `new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' })`; all pure logic in `src/lib/solver.ts` (importable by tests); thin `self.onmessage` wrapper. **Chunk** the minute-step iteration with `setTimeout(0)` yields so the worker can receive `cancel` and emit `progress`. Match via **combined 3-D angular distance** on the unit sphere (`acos(clamp(dot, -1, 1))`) within ±0.5° (physically meaningful for "behind the tower" — avoids the diagonal az/alt edge case). ~43,800 steps/month × Sun+Moon is too heavy for the main thread alongside 60 fps Cesium (FR-012).
- **(b) Golden/blue hour timeline**: `suncalc.getTimes(date, lat, lon)` once per date. `goldenHour`/`goldenHourEnd` exist but have a **counterintuitive morning/evening swap gotcha** (morning golden window = `[sunrise, goldenHourEnd]`; evening = `[goldenHour, sunset]`). **`blueHour` does NOT exist in suncalc** — derive from civil/nautical twilight (morning ≈ `[nauticalDawn, dawn]`, evening ≈ `[dusk, nauticalDusk]`, i.e. sun altitude ≈ −6°…−12°).
- **(c) Camera/lens framing**: `computeHorizontalFov(sensorWidthMm, focalLengthMm) = 2 * atan(sensorWidthMm / (2 * focalLengthMm))` (radians); bind to `viewer.camera.frustum.fov` (`PerspectiveFrustum`). **VERIFY fov semantics** (horizontal vs vertical vs aspect-dependent) — load-bearing for preview accuracy; if vertical, convert `vfov = 2*atan(tan(hfov/2)/aspectRatio)`.

**TDD**: `generateMinuteSteps`, `angularDistanceDeg` (identical→0, orthogonal→90, dot clamp), `findAlignments` over an **injected** position provider (one integration test with real suncalc against a known alignment locks end-to-end); `classifyHourBand`/`buildTimelineBands` over a mock `getTimes` object; `computeHorizontalFov` (full-frame 36 mm × 600 mm → ≈3.44°; focal≤0 throws) + `fovToCesium` conversion.

---

## Resolved NEEDS CLARIFICATION (back to [plan.md](./plan.md))

| plan.md item | Resolution |
|---|---|
| CityGML→3D Tiles pipeline | **Ion does NOT tile CityGML.** Convert locally → glTF (white material) → upload glTF to Ion for tiling **or** self-host. `scripts/uploadToCesium.js` is redirected. 🔴 Phase-1 scope risk. |
| Berlin CRS → WGS84 | EPSG:25832 (current) → 4326 is near-identity (no datum shift). EPSG:31468 (historical DHDN) **needs** the DHDN→WGS84 datum shift or the scene shifts tens of meters. Height-datum (DHHN→ellipsoid) must be reconciled. |
| `suncalc.getTimes` names / `getMoonPosition` | `goldenHour`/`goldenHourEnd` exist (morning/evening swap gotcha); **`blueHour` does NOT exist** — derive from civil/nautical twilight. `getMoonPosition(date, lat, lon)` — verify it takes no height arg. |
| Cesium Sun/shadow strategy | **Strategy B** (drive `clock.currentTime`, keep native `SunLight`) — **gated** on the Cesium-vs-suncalc agreement test (< 0.5°). Fallback = Strategy A (custom `DirectionalLight`). |

---

## Consolidated VERIFY-LIVE Checklist

> These must be confirmed against live docs/the installed versions **before** the dependent implementation. Web tools were down this session. Items are prioritized (🔴 = blocks architecture / correctness).

**🔴 Architecture / correctness (confirm first):**
1. **Cesium Ion 3D-Tiling source formats** — confirm CityGML is **not** supported; glTF/glb, OBJ, FBX, DAE, LAS/LAZ/XYZ, passthrough 3D Tiles are. *(Decides the whole pipeline.)*
2. **Cesium internal-sun vs `suncalc` agreement** < ±0.5° at ≥4 datetimes/seasons at Berlin. *(Decides Strategy B vs A; proves solver/render parity.)*
3. **`scene.sun.show=false` hides only the glyph** and does **not** disable `SunLight`-driven shadows when `globe.enableLighting=true`. *(Linchpin of "no sun disc but real time-scrubbed shadows".)*
4. **suncalc azimuth convention** = 0=south, +west; `getMoonPosition(date,lat,lon)` signature; **`blueHour` absent** from `getTimes`; `goldenHour`/`goldenHourEnd` morning/evening semantics.
5. **`PerspectiveFrustum.fov` semantics** — horizontal/vertical/aspect-dependent? *(Decides FOV→Cesium binding for the framing preview.)*

**Data (🔴 for Phase 1):**
6. Berlin LoD2 exact download URL (FIS-Broker / Berlin Open Data), per-Bezirk granularity, declared CRS (25832 vs 31468), LoD level, license, **whether the Fernsehturm is included**.
7. **Fernsehturm actual height** (~368 m total vs spec's ~210 m) and base elevation.
8. Height-datum facts: are Berlin LoD2 Z values DHHN/sea-level? What does Cesium World Terrain expose (ellipsoid vs MSL)? Quantify the offset.
9. Converter viability: `citygml-to-3d-tiles` (npm) existence/maintenance; `py3dtiles` mesh path; `citygml-tools` export capability; FME licensing; EPSG:31468 `+towgs84` datum params.

**Cesium API (verify against the pinned `cesium` version):**
10. `Scene.drillPickFromRay` signature/return shape + whether terrain (`scene.globe`) appears in results; `pickFromRay`; tiles-loaded gate event name; `sampleTerrainMostDetailed` return contract.
11. `Cesium3DTileset.fromUrl` / `CesiumWorldTerrain.fromUrl` (post-1.107 async factories) vs deprecated constructors; credits-disable option name; `tileset.readyEvent` vs deprecated `readyPromise`.
12. `CustomShader` API (`LightingModel.PBR`, `fragmentMain`, `czm_modelMaterial` field set); `tileset.imageBasedLighting.imageBasedLightingFactor`; `Cesium3DTileStyle` color expression grammar; back-face-culling disable.
13. PostProcessStage `depthTexture` auto-binding on WebGL2; `czm_windowToEyeCoordinates` arg/return units (meters); `czm_readDepth` under log depth; `czm_frameNumber` type.

**Toolchain (verify against installed Astro/Vite):**
14. `vite-plugin-cesium` version + option names + `CESIUM_BASE_URL` value/prefix it produces; manual fallback sufficiency.
15. `cesium` ships its own `.d.ts` (no `@types/cesium`); `exports`/`types` resolve under `moduleResolution: Bundler`.
16. Astro `client:only="react"` syntax + fallback slot; `import.meta.env.PUBLIC_*` vs `astro:env/client`; `output:'static'` build does not evaluate cesium server-side.
17. `new Worker(new URL(..., import.meta.url), {type:'module'})` builds under Astro+`vite-plugin-cesium`; `vite/client` types.
18. Tailwind v3 vs v4 entry (`@tailwindcss/vite` vs `@astrojs/tailwind`) + whether Preflight must be scoped to avoid clobbering Cesium widget DOM.

**nanostores:**
19. `computed` store `.set()` is rejected (the read-only guarantee for `isOccluded`); `.listen` (changes-only) vs `.subscribe` (immediate); `useStore` opts shape; React-major compatibility.

---

## Ratified Architectural Decisions (for plan.md / data-model / contracts)

1. **`src/lib/*` vs `src/cesium/*` split** — all pure logic (ephemeris, occlusion, FOV, solver, CRS, scene math, hour classification, shader-source builder) is Cesium-free and Vitest-first. *(Constitution Principle I.)*
2. **Strategy B for sun/shadows** (drive the clock) — gated on the agreement test.
3. **`drillPickFromRay` + pure `classifyOcclusion`**; occlusion is time-independent (recompute on move/tile-load only).
4. **`computed` read-only `isOccluded`** with a single `commitOcclusion` writer; rAF-coalesced `setDateTimeScrubbing`.
5. **Single `client:only="react"` island**; cesium never in the SSR graph (source-graph guard test).
6. **Custom PBR shader + IBL-off** for guaranteed matte plaster (style alone insufficient).
7. **Local CityGML→glTF conversion** (Ion can't tile CityGML); upload glTF to Ion **or** self-host.
8. **Worker = thin wrapper over `src/lib/solver.ts`**; combined angular-distance matching; derive blue hour from twilight.
