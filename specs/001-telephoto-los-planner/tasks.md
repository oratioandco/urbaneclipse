---
description: "Task list for the Plaster Void telephoto line-of-sight planner"
---

# Tasks: Telephoto Line-of-Sight Planner ("Plaster Void")

**Input**: Design documents from `/specs/001-telephoto-los-planner/` — [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md.

**Tests**: **INCLUDED — TDD is NON-NEGOTIABLE** (Constitution Principle I). Every pure-logic unit is written test-first (RED), then implemented (GREEN). Cesium/WebGL-bound code is covered by Playwright. The `src/lib/*` vs `src/cesium/*` boundary (plan.md) keeps all pure logic Cesium-free so it is Vitest-first.

**Organization**: Tasks grouped by user story (US1 P1 → US6 P6) so each story is independently implementable and testable.

## Format: `[ID] [P?] [Story?] Description with file path`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[Story]**: user-story phase tasks MUST carry `[USx]`; Setup/Foundational/Polish carry none
- Every task ends with an exact file path

## Path Conventions

Single Astro web app (repo root): `src/{pages,components/react,workers,cesium/shaders,lib,styles,data}`, `scripts/`, `tests/{unit,worker,e2e}`, `public/`. Cesium is confined to `src/cesium/*` + `src/components/react/*` (never `src/pages/*` / `src/layouts/*`).

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and build/test tooling.

- [x] T001 Create project directory structure per [plan.md](./plan.md) (src/{pages,components/react,workers,cesium/shaders,lib,styles,data}, scripts/, tests/{unit,worker,e2e}, public/) (tests/worker and tests/e2e do not yet exist — no worker-shell or e2e specs written yet)
- [x] T002 Initialize Astro + React + TypeScript project in package.json — deps: astro, @astrojs/react, react, react-dom, cesium, suncalc, nanostores, @nanostores/react, tailwindcss, proj4; devDeps: typescript, vitest, jsdom, @playwright/test, vite, vite-plugin-cesium
- [x] T003 [P] Configure astro.config.mjs + vite.config.ts — `vite-plugin-cesium()`, `ssr.external:['cesium']`, `optimizeDeps.exclude:['cesium']`, `output:'static'` (all Vite config lives inline in astro.config.mjs; there is no separate vite.config.ts)
- [x] T004 [P] Configure tsconfig.json — strict, `module:ESNext`, `moduleResolution:Bundler`, `skipLibCheck:true`, `types:[]` (NO `@types/cesium`)
- [ ] T005 [P] Configure Tailwind entry (`@tailwindcss/vite` or `@astrojs/tailwind`) in vite.config.ts + scope/disable Preflight over Cesium widget DOM (credits/timeline/animation) (Tailwind v4 is wired via `@tailwindcss/vite` in astro.config.mjs + src/styles/global.css; Preflight is not specifically scoped/disabled over the Cesium widget DOM)
- [x] T006 [P] Add .env.example with `PUBLIC_CESIUM_ION_TOKEN=` placeholder + document the `import.meta.env.PUBLIC_*` accessor (.env stays gitignored — never committed)
- [ ] T007 [P] Setup vitest (vitest.config.ts, jsdom env) + playwright (playwright.config.ts) + package.json scripts (dev, build, preview, test, test:e2e) (vitest.config.ts uses `environment:'node'` not jsdom; playwright.config.ts exists targeting tests/e2e/ but there is no `test:e2e` script and no e2e specs yet)
- [x] T008 Create src/pages/index.astro shell mounting `<CesiumViewer client:only="react" />` with a fallback slot — NO `cesium` import in the `.astro` frontmatter

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure every user story depends on. Tests written first (RED) → implement (GREEN). Cesium stays out of the SSR module graph.

**⚠️ CRITICAL**: No user-story work begins until this phase is complete. Pure-logic tasks here do NOT require the building data; the Cesium-integration tasks (and downstream US1–US3 Cesium work) do (see T024).

- [x] T009 [P] Write source-graph guard test tests/unit/ssr-graph-guard.test.ts — FAIL if any file under src/pages/** or src/layouts/** imports `'cesium'` (allow-list src/cesium/** and src/components/react/**)
- [x] T010 [P] Write failing store tests tests/unit/store.test.ts — initial values; read-only `isOccluded` (`.set` throws/absent); `commitOcclusion` equality guard; `setDateTimeScrubbing` rAF coalesce (fake timers); dependency-direction (dateTime→updateSunClock not recomputeOcclusion; height→recomputeOcclusion not updateSunClock)
- [x] T011 Implement src/store.ts — `dateTime`, `observerHeight`, `targetHeight` atoms; private `_isOccludedSource` + `isOccluded = computed(...)`; `commitOcclusion(v)`; `setDateTimeScrubbing` rAF-coalesced — to pass T010
- [x] T012 [P] Define Berlin constants src/lib/berlin.ts — observer default (52.5106, 13.4652, 1.5 m), target default (52.5208, 13.4093, 210 m ⚠️ VERIFY ~368), Berlin bounds, `SourceCRS`/`HeightDatum` enums, plaster/void colors (#f4f4f4)
- [x] T013 [P] Write failing CRS-transform tests tests/unit/coords.test.ts — `transformCoord` EPSG:25832→4326 near-identity (fixture); EPSG:31468→4326 DHDN datum-shift regression (precomputed reference)
- [x] T014 Implement src/lib/coords.ts — `transformCoord` via proj4; define EPSG:25832 + EPSG:31468 (with `+towgs84`) — to pass T013
- [x] T015 [P] Write failing scene-math tests tests/unit/sceneMath.test.ts — `greatCircleBearing` (observer→target ~290–300°, reverse ~110–120°, cardinals); `viewerOptions()` all widgets `===false`; `telephotoFrustum(fovDeg,aspect)`
- [x] T016 Implement src/lib/sceneMath.ts — `greatCircleBearing`, `cameraOrientation`, `cameraDestinationCarto`, `viewerOptions`, `telephotoFrustum` — to pass T015
- [ ] T017 Implement src/cesium/bootstrap.ts — client-only module setting `Cesium.Ion.defaultAccessToken = import.meta.env.PUBLIC_CESIUM_ION_TOKEN` as a top-level side effect BEFORE any Viewer/IonResource; import `cesium/Widgets/widgets.css` (no separate bootstrap.ts module — the token-set + widgets.css `<link>` are inlined directly in CesiumViewer.tsx / index.astro instead)
- [ ] T018 Implement src/components/react/CesiumViewer.tsx shell — `useEffect` → `new Cesium.Viewer(container, viewerOptions())` with ref guard (React 18 StrictMode double-mount), terrain via `CesiumWorldTerrain.fromUrl`, `viewer.destroy()` cleanup; render the container div (viewer construction, ref guard, and destroy-on-cleanup are all implemented; `CesiumWorldTerrain` is deliberately NOT used — the plaster void has no terrain by design, `baseLayer:false` + no Ion assets)
- [ ] T019 Implement src/cesium/scene.ts — load src/data/buildings.json → `Cesium3DTileset.fromUrl` (Ion assetId OR self-hosted url); `scene.primitives.add(tileset)`; `camera.setView` at observer (terrain height + eye) heading=`greatCircleBearing`, narrow fov; `tilesLoaded` gate helper (no scene.ts module or src/data/buildings.json config — tileset URL comes from `PUBLIC_TILESET_URL`/self-hosted default, loaded via `Cesium3DTileset.fromUrl` directly inside CesiumViewer.tsx; camera framing uses `viewer.zoomTo(tileset, ...)` rather than hand-rolled `camera.setView`, per an in-code note explaining zoomTo replaced fragile ECEF math that culled the tileset)
- [ ] T020 [P] Add token-presence guard UI in src/components/react/CesiumViewer.tsx — if `PUBLIC_CESIUM_ION_TOKEN` missing, render an explicit error screen (FR-013); never silently fall back to the demo token (token is read defensively and applied only if present — correct in that it never silently falls back to a demo token — but there is no explicit FR-013 error-screen UI for the missing-token case, since the shipped scene uses no Ion assets at all)
- [ ] T021 [P] Write failing pipeline tests tests/unit/pipeline.test.ts — CityGML parser over a minimal LoD2 Solid fixture; glTF emitter (triangle count, single white `baseColorFactor`, `NORMAL` present, valid JSON); `buildTileset` vs a checked-in 3D Tiles schema fixture; upload state machine (mocked Ion HTTP client: COMPLETE→assetId, ERROR→typed error) (no such Vitest file — the pipeline was reimplemented in Python, see T022/T023 note; it has no Vitest coverage, only the informal PoC/verification notes in scripts/README.md)
- [ ] T022 Implement src/lib/pipeline/*.ts — parseCityGML.ts, transformToWGS84.ts (uses coords.ts), emitWhiteGltf.ts (baked white material + normals), buildTileset.ts, ionUpload.ts (mockable client) — to pass T021 (superseded: the CityGML→3D-Tiles pipeline was implemented in Python instead — `scripts/parse_citygml.py`, `scripts/convert_tile.py`, `scripts/convert_batch.py` — using `py3dtiles`/`lxml`/`mapbox-earcut`, because no maintained TS CityGML→3D-Tiles converter exists; there is no `src/lib/pipeline/` and no glTF/Ion-upload path, it emits b3dm/tileset.json self-hosted tiles directly)
- [ ] T023 Implement scripts/uploadToCesium.js CLI — wire the pipeline lib (`--input`, `--districts`, `--source-crs`, `--height-datum`, `--converter`, `--out-config`, `--host`, `--force`); structured exit codes (0/2/3/4/5/6); idempotency; write src/data/buildings.json — per [contracts/data-pipeline.md](./contracts/data-pipeline.md) (no such JS CLI exists; superseded by the Python scripts `convert_tile.py`/`convert_batch.py`/`subset_tileset.py`, which take no CLI flags matching this contract, have no structured exit codes, and write `public/berlin-core/` + `public/berlin/` directly rather than `src/data/buildings.json` — see scripts/README.md for the actual interface)

**Checkpoint**: foundational pure logic + scaffolding ready. The live 3D scene still needs real building data.

- [x] T024 🟥 **MANUAL GATE (human intervention)** — user downloads Berlin LoD2 CityGML (Mitte + Lichtenberg) and provides `CESIUM_ION_TOKEN`; run `node scripts/uploadToCesium.js --input ./data/citygml --districts mitte,lichtenberg --source-crs EPSG:25832 --height-datum DHHN --out-config src/data/buildings.json` to generate src/data/buildings.json. Blocks Cesium-integration tasks in US1–US3 (NOT the pure-logic/TDD tasks). (gate substantively cleared: real Berlin LoD2 CityGML was procured and converted — `data/citygml/` has 927 source files, `data/berlin/` + `public/berlin/` hold the full 236-tile converted output, `public/berlin-core/` is the committed deploy subset — but via the Python pipeline (T022/T023 note), not `scripts/uploadToCesium.js`/`src/data/buildings.json` as originally specced; no Cesium Ion token was needed since the shipped scene is fully self-hosted)

---

## Phase 3: User Story 1 — Line-of-Sight Occlusion (Priority: P1) 🎯 MVP

**Goal**: place observer/target at adjustable heights and see whether the sightline is blocked.
**Independent test**: defaults → green (clear); raise `observerHeight` so an intervening building crosses the line → red (occluded).

### Tests for User Story 1 (TDD — pure, no Cesium/data)

> Write FIRST, confirm RED, then implement.

- [x] T025 [P] [US1] Write failing occlusion-math tests tests/unit/occlusionMath.test.ts — `classifyOcclusion` fixtures (clear; occluded-by-building; occluded-by-terrain; grazing/marginal within epsilon=0.5; closest-is-target beyond; multi-hit one occludes; same-point; order-independence)
- [x] T026 [P] [US1] Implement src/lib/occlusionMath.ts — `classifyOcclusion(observer, target, intersections, epsilon=0.5)` + ray helpers (normalize/distance) — to pass T025

### Implementation for User Story 1

- [x] T027 [P] [US1] Implement src/components/react/ControlPanel.tsx — observerHeight + targetHeight sliders (clamped/defensive) reading/writing src/store.ts; display `isOccluded` (read-only) as clear/blocked
- [x] T028 [US1] Implement src/cesium/lineOfSight.ts — `sampleTerrainMostDetailed` + heights → Cartesian3; `new Ray(observer, normalize(target−observer))`; version requests (ignore stale); map `drillPickFromRay` intersections → `{distance,kind}`; classify via occlusionMath; terrain cross-check via `Globe.pick`; gate on `tilesLoaded` (state `unknown` until loaded) (implemented via `Cartesian3.fromDegrees` rather than `sampleTerrainMostDetailed`/`Globe.pick` — there is no terrain layer in this scene, so ground height is ellipsoid-relative by design; `drillPickFromRay` → classifyOcclusion → tilesLoaded gate all match)
- [x] T029 [US1] Render observer→target Entity polyline in src/components/react/CesiumViewer.tsx — width 1.0, `clampToGround:false`, green (clear) / red (occluded|margin); recompute ONLY on observer/target move or tile-load (never per-frame, never on `dateTime`) (polyline width is 2, not 1.0 — cosmetic difference only; everything else matches, including the time-independence)
- [x] T030 [US1] Wire the occlusion engine in src/components/react/CesiumViewer.tsx — `observerHeight.listen` + `targetHeight.listen` → `scheduleOcclusion`; on result `commitOcclusion(state==='occluded'||state==='marginal')`; subscribe to tile-load-progress→0 to recompute

**Checkpoint**: US1 independently functional — a user can determine whether the shot is blocked.

---

## Phase 4: User Story 2 — Plaster Void Visual Aesthetic (Priority: P2)

**Goal**: the scene reads as a white plaster model in a hazy, grainy void — not a GIS map.
**Independent test**: open the scene; buildings matte white, no imagery/sky/atmosphere, soft hazy void, subtle grain.

### Tests for User Story 2 (TDD — pure builders, no GPU)

- [ ] T031 [P] [US2] Write failing art-direction tests tests/unit/artDirection.test.ts — `createPlasterSceneConfig()` fields; `applyPlasterVoid(sceneStub)` spy flips; `buildPlasterTilesetStyle()` color `color('#ffffff')`; `buildPlasterCustomShader()` GLSL contains `roughness=1`/`metallic=0`/`specular=0`; `buildStudioEnvironmentShaderSource()` asserts NO `#version`, uses `texture2D`, epsilon background (`>0.9999` not `==1.0`), `length(czm_windowToEyeCoordinates(...).xyz)`, references `czm_frameNumber`; `isBackgroundDepth()` boundary (0.9998→false, 0.99995→true) (no tests/unit/artDirection.test.ts — there is no separate artDirection module to test; `tests/unit/studioEnvironment.test.ts` covers the shader-source assertions instead, and it uses GLSL ES 3.00 `texture(...)`, not `texture2D`, per a documented Cesium 1.143 runtime-verification note)

### Implementation for User Story 2

- [x] T032 [P] [US2] Implement src/cesium/shaders/studioEnvironment.ts — `buildStudioEnvironmentShaderSource` + `isBackgroundDepth` + `createStudioEnvironmentStage` factory — to pass T031
- [ ] T033 [P] [US2] Implement src/cesium/artDirection.ts — `createPlasterSceneConfig`, `applyPlasterVoid`, `buildPlasterTilesetStyle`, `buildPlasterCustomShader` — to pass T031 (no artDirection.ts module — the plaster overrides (sky/atmosphere/sun/moon off, globe base color, tileset white style) are applied imperatively inline in CesiumViewer.tsx instead of as separate pure/testable builder functions)
- [x] T034 [US2] Apply plaster overrides in src/cesium/scene.ts — construction `baseLayer:false`; imperative `skyBox/skyAtmosphere/sun/moon.show=false`, `fog.enabled=false`, `globe.showGroundAtmosphere=false`, `globe.baseColor=#f4f4f4`, `imageryLayers.removeAll()`; KEEP default `SunLight` (do NOT replace); VERIFY-LIVE `sun.show=false` keeps shadows (applied inline in CesiumViewer.tsx, not scene.ts — baseLayer:false, skyBox/skyAtmosphere/sun/moon.show=false, globe.baseColor=#f4f4f4, imageryLayers.removeAll() all present; `fog.enabled=false`/`showGroundAtmosphere=false` are not explicitly set but have no visible effect since skyAtmosphere/fog inputs are already suppressed upstream; live-verified `sun.show=false` keeps shadows working, per code comments)
- [ ] T035 [US2] Apply tileset plaster on ready in src/cesium/scene.ts — `tileset.style`=white + `tileset.customShader`=PBR matte + `tileset.imageBasedLighting.imageBasedLightingFactor=Cartesian2(0,0)` (only `tileset.style` (uniform white `Cesium3DTileStyle`) is set, in CesiumViewer.tsx's tileset-ready callback; no `customShader` PBR override and no `imageBasedLightingFactor` tweak — the white tileset style alone was sufficient for the shipped look)
- [ ] T036 [US2] Add the studio `PostProcessStage` to `scene.postProcessStages` in src/cesium/scene.ts (fogStart/End in METERS, hazeColor, grainAmount); `.remove()` on teardown; guard on `scene.context.depthTexture` (stage is added in CesiumViewer.tsx with fogStart/End in meters + hazeColor + grainAmount all present, but it is never `.remove()`d on island teardown/cleanup, and there is no explicit guard on `scene.context.depthTexture` before adding it)
- [ ] T037 [US2] [VERIFY-LIVE] Add visual regression tests/e2e/aesthetic.spec.ts (`@gpu`) — perceptual-hash baseline + black-screen detector (shader-compile failure → black canvas → diff trips) (no tests/e2e/ specs exist yet — visual verification currently relies on manual `scripts/screenshot.mjs`/`scripts/diagnose.mjs` runs, not an automated perceptual-hash regression test)

**Checkpoint**: scene reads as a plaster void (US2 + US1 together = a usable, on-brand occlusion checker).

---

## Phase 5: User Story 3 — Temporal Celestial Lighting (Priority: P3)

**Goal**: scrub date/time → sun/moon position and real-time shadows.
**Independent test**: set Berlin sunrise → long westward shadows; scrub to noon → shadows shorten.

### Tests for User Story 3 (TDD — pure ephemeris, no Cesium)

- [x] T038 [P] [US3] Write failing ephemeris-math tests tests/unit/ephemerisMath.test.ts — golden snapshot of `SunCalc.getPosition` at a fixed Berlin date (pins azimuth 0=south,+west); alt/az→ENU unit vector (magnitude 1, solar-noon→south, west→E<0); ENU→ECEF round-trip; light-direction predicate (`direction == −normalize(ECEF-to-sun)`)
- [x] T039 [P] [US3] Implement src/lib/ephemerisMath.ts — `positionToENU`, `enuToECEF`, `sunDirectionECEF`, `southToNorthAzimuth` — to pass T038

### Implementation for User Story 3

- [ ] T040 [US3] 🟥 Write the **Cesium-vs-suncalc agreement test** tests/unit/sun-agreement.test.ts — import `Cesium.Simon1994PlanetaryPositions.computeSunPosition` (pure math, Node, no Viewer) → derive alt/az at Berlin; assert max delta vs `SunCalc.getPosition` < 0.5° across ≥4 seasonal dates. **Ratifies Strategy B** — must pass GREEN before shipping B; if it fails, fall back to Strategy A (custom `DirectionalLight`, `globe.enableLighting=false`). (this test does NOT exist — Strategy B (drive `viewer.clock.currentTime` from `dateTime`, `globe.enableLighting=true`) was implemented anyway in CesiumViewer.tsx without this ratifying gate ever being run; this is the single highest-priority missing verification in the whole task list)
- [x] T041 [US3] Implement src/cesium/ephemeris.ts — on `dateTime` change (throttled) set `viewer.clock.currentTime=JulianDate.fromDate(dt)`, `shouldAnimate=false`, `scene.requestRender()`; keep `globe.enableLighting=true`, `viewer.shadows=true`, `tileset.shadows=ENABLED`; hide the sun glyph only (no ephemeris.ts module — the `dateTime.listen` → `viewer.clock.currentTime`/`requestRender()` binding is inlined in CesiumViewer.tsx; `globe.enableLighting`, `viewer.shadows`, `tileset.shadows=ENABLED` all present as specified — NOTE: this ships without T040's ratifying agreement test having been run)
- [x] T042 [US3] Wire src/components/react/ControlPanel.tsx date/time picker → `setDateTimeScrubbing(dt)` (slider) / `dateTime.set` (step buttons); subscribe `CesiumViewer` `dateTime.listen → updateSunClock`

**Checkpoint**: scrubbing time updates sun position + shadows in real time.

---

## Phase 6: User Story 4 — Golden & Blue Hour Timeline (Priority: P4)

**Goal**: a color-coded daily timeline marking golden and blue hour.
**Independent test**: pick a date → amber golden-hour band + blue blue-hour band; slider highlights its band; bands shift with season.

### Tests for User Story 4 (TDD — pure, mock getTimes)

- [x] T043 [P] [US4] Write failing timeline tests tests/unit/timeline.test.ts — `buildTimelineBands(mockTimes)` → golden (amber) + blue (blue) bands; golden morning=`[sunrise,goldenHourEnd]` / evening=`[goldenHour,sunset]` swap; blue derived from `[nauticalDawn,dawn]` / `[dusk,nauticalDusk]`; `classifyHourBand(times, t)`
- [x] T044 [P] [US4] Extend src/lib/ephemerisMath.ts — `buildTimelineBands` + `classifyHourBand` (derive blue hour from civil/nautical twilight; guard NaN polar) — to pass T043 (implemented as a separate module, src/lib/timeline.ts, rather than extending ephemerisMath.ts; `buildTimelineBands` matches — golden/blue/day/night bands, NaN/null-guarded; no separate `classifyHourBand` export, band lookup for the current time is done by `HourTimeline.tsx` directly)

### Implementation for User Story 4

- [x] T045 [US4] Implement src/components/react/HourTimeline.tsx — on `dateTime` change call `SunCalc.getTimes` once → `buildTimelineBands` → render color-coded bands; highlight the band under the slider; map the time slider to the timeline
- [ ] T046 [US4] Add a `timelineBands` computed store (derived from `dateTime`) in src/store.ts consumed by HourTimeline.tsx (no `timelineBands` atom exists in src/store.ts; `HourTimeline.tsx` instead reads `dateTime` directly and computes `suncalc.getTimes` + `buildTimelineBands` locally on each render/date change)

**Checkpoint**: timeline shows golden/blue hour windows, seasonally correct.

---

## Phase 7: User Story 5 — Reverse Ephemeris Alignment Search (Priority: P5)

**Goal**: "when is the moon/sun behind the target?" over a date range → matching dates; UI stays responsive.
**Independent test**: run "moon behind the Fernsehturm" over 1 month → concrete dates; each within ±0.5° of the target line; UI responsive.

### Tests for User Story 5 (TDD — pure solver core, no worker/suncalc)

- [x] T047 [P] [US5] Write failing solver tests tests/unit/solver.test.ts — `generateMinuteSteps` (count, inclusive start, DST boundary); `angularDistanceDeg` (identical→0, orthogonal→90, dot-clamp); `findAlignments` over an INJECTED `positionProvider` (in-tolerance only, default 0.5, empty when none); south→north azimuth conversion applied in ONE place
- [x] T048 [P] [US5] Implement src/lib/solver.ts — `generateMinuteSteps`, `angularDistanceDeg`, `findAlignments` — to pass T047

### Implementation for User Story 5

- [x] T049 [US5] Implement src/workers/solver.worker.ts — thin `self.onmessage` shell over `findAlignments`; chunked `setTimeout(0)` yields; `postMessage` progress/result/done/error; honor `cancel` — per [contracts/worker-solver.md](./contracts/worker-solver.md)
- [ ] T050 [US5] Write worker-shell test tests/worker/solver.worker.test.ts — mock the `Worker` global; assert progress/result/done sequence + cancel mid-run (no tests/worker/ directory or worker-shell test exists — the worker is exercised indirectly via `scripts/diagnose.mjs`'s "solver worker constructs" check, not a Vitest-mocked-Worker unit test)
- [x] T051 [US5] Implement src/components/react/SolverSearch.tsx — mock search bar with hardcoded JSON params → spawn the worker → display matches (`AlignmentWindow[]`); cancel on new search; drive `solverState` store
- [ ] T052 [US5] [VERIFY-LIVE] Add ONE integration test with real `suncalc` against a known published alignment in tests/unit/solver.integration.test.ts (locks SC-003 end-to-end) (no tests/unit/solver.integration.test.ts exists — `solver.test.ts` only covers the pure core with an injected/fake position provider, not real `suncalc` against a known published alignment; SC-003 end-to-end accuracy is unverified)

**Checkpoint**: solver returns alignment dates; UI never blocks.

---

## Phase 8: User Story 6 — Camera/Lens Framing Preview (Priority: P6)

**Goal**: sensor + focal length + zoom → accurate framing preview.
**Independent test**: full-frame + 600 mm tightly frames the target; 200 mm widens it (target shrinks).

### Tests for User Story 6 (TDD — pure, no Cesium)

- [x] T053 [P] [US6] Write failing camera-math tests tests/unit/cameraMath.test.ts — `computeHorizontalFov` (full-frame 36×600 → ≈3.44°; longer focal decreases FOV; focal≤0 throws); `fovToCesium(hfov, aspect)` conversion for the vertical-fov case (aspect>1, aspect<1)
- [x] T054 [P] [US6] Implement src/lib/cameraMath.ts — `computeHorizontalFov`, `fovToCesium` — to pass T053

### Implementation for User Story 6

- [x] T055 [US6] Implement src/components/react/CameraControls.tsx — sensor presets (full-frame/APS-C/M4/3) + focal-length selector + zoom → `cameraProfile` store
- [x] T056 [US6] Bind `cameraProfile` → `viewer.camera.frustum.fov` (`PerspectiveFrustum`) in src/components/react/CesiumViewer.tsx — VERIFY-LIVE fov semantics (horizontal/vertical/aspect); apply `fovToCesium` conversion if vertical

**Checkpoint**: framing preview matches real telephoto FOV.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: improvements spanning multiple user stories + deployment.

- [ ] T057 [P] Polish UI styling across src/components/react/* (Tailwind; plaster-consistent editorial controls) in src/styles/
- [ ] T058 [P] Implement optional localStorage preference persistence (dateTime, heights, cameraProfile) — guarded, in src/store.ts
- [ ] T059 [P] Implement defensive error states (FR-013) across src/components/react/* — missing token, missing buildings.json, worker error, solver no-match — explicit messages, never silent
- [ ] T060 [P] Add structured logging/observability for pipeline + occlusion + solver events in src/lib/log.ts (no PII)
- [ ] T061 Perf tune in src/cesium/* — verify 60 fps orbit, shadow-scrub <100 ms, occlusion <200 ms, worker non-blocking; tune `viewer.shadowMap.maximumDistance` for the 5.5 km telephoto range
- [ ] T062 Write E2E suite tests/e2e/*.spec.ts (non-`@gpu`) — US1 occlusion flip, US4 timeline bands, US5 solver responsiveness
- [ ] T063 [VERIFY-LIVE] Resolve the consolidated VERIFY-LIVE checklist in [research.md](./research.md) — Ion source formats, sun-agreement, `sun.show` keeps shadows, suncalc conventions, `PerspectiveFrustum.fov` semantics, converter viability, Berlin CRS/height-datum, Fernsehturm height
- [x] T064 Deploy via Coolify using `/infra` — Dockerfile (Astro static build) + health check; supply `CESIUM_ION_TOKEN` via Coolify env (never committed); document in README (Constitution Principle V)
- [ ] T065 Run [quickstart.md](./quickstart.md) validation end-to-end (all 6 user-story scenarios) — build, test, verify (Constitution Principle III)
- [x] T066 Write README.md + architecture summary linking plan/research/contracts/data-model

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: no deps — start immediately.
- **Foundational (Phase 2)**: depends on Setup. Pure-logic tasks (T009–T023) need no building data; **T024 (manual data gate)** blocks the Cesium-integration tasks here (T019 application) and downstream US1–US3 Cesium work.
- **User Stories (Phases 3–8)**: all depend on Foundational.
  - **Pure-logic TDD tasks in every story are unblocked by T024** — start them in parallel immediately.
  - Cesium-integration tasks in US1 (T028–T030), US2 (T034–T037), US3 (T041–T042), US6 (T056) require T024 (real building data).
- **Polish (Phase 9)**: depends on the desired user stories being complete.

### Cross-Story Notes
- **US1 is the MVP** — but its pure slice (T025–T026 classifier + T027 control panel) is shippable/testable before any building data exists; the Cesium occlusion (T028–T030) needs T024.
- US2 (aesthetic) and US3 (lighting) both modify `src/cesium/scene.ts` / `CesiumViewer.tsx` — sequence them; do not edit concurrently.
- US3 T040 (sun-agreement test) is a hard gate for Strategy B — it MUST pass before T041 ships the clock-driven approach.
- US4/US5/US6 are largely independent of each other and can proceed in parallel once Foundational is done.

### Within Each User Story
- Tests (pure) FIRST, confirmed RED, then implement (GREEN).
- Pure `src/lib/*` before Cesium-bound `src/cesium/*`.
- Cesium binding before UI wiring.
- Recompute/cache rules respected (occlusion not per-frame; shadows on `dateTime`).

### Parallel Opportunities
- All `[P]` Setup tasks (T003–T007) run in parallel.
- All `[P]` pure-logic TDD tasks within and across stories (e.g., T025, T031, T038, T043, T047, T053) are independent — different files, no shared incomplete dependency.
- Within a story, `[P]`-marked test + impl pairs of distinct modules run in parallel.

---

## Parallel Example

```bash
# Foundational pure-logic tasks (parallel — independent files):
Task: "T010 store tests in tests/unit/store.test.ts"
Task: "T013 coords tests in tests/unit/coords.test.ts"
Task: "T015 scene-math tests in tests/unit/sceneMath.test.ts"
Task: "T021 pipeline tests in tests/unit/pipeline.test.ts"

# Cross-story pure-logic TDD (parallel — independent files):
Task: "T025 [US1] occlusion-math tests in tests/unit/occlusionMath.test.ts"
Task: "T038 [US3] ephemeris-math tests in tests/unit/ephemerisMath.test.ts"
Task: "T047 [US5] solver tests in tests/unit/solver.test.ts"
Task: "T053 [US6] camera-math tests in tests/unit/cameraMath.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)
1. Phase 1: Setup.
2. Phase 2: Foundational — store, scene-math, coords, Cesium bootstrap + Viewer shell, pipeline pure logic (T009–T023).
3. **🟥 T024 manual data gate** — obtain CityGML + token; run the pipeline.
4. Phase 3: US1 — pure occlusion classifier (T025–T027) → Cesium occlusion (T028–T030).
5. **STOP and VALIDATE** — US1 independently testable (quickstart.md scenario 1).

### Incremental Delivery
1. Setup + Foundational → foundation ready.
2. + US1 → occlusion checker (MVP) → validate → deploy/demo.
3. + US2 → on-brand plaster look → validate.
4. + US3 → time-scrub lighting → validate.
5. + US4 → golden/blue hour timeline → validate.
6. + US5 → reverse-ephemeris solver → validate.
7. + US6 → camera/lens framing → validate.
8. Polish + deploy (Coolify).

Each story adds value without breaking prior stories.

---

## Notes

- `[P]` tasks = different files, no dependency on an incomplete task.
- `[USx]` labels map a task to its user story for traceability.
- Each user story is independently completable and testable (per spec.md priorities).
- **Verify tests fail before implementing** (Constitution Principle I).
- Commit after each task or logical group (Constitution Principle VI — atomic Conventional Commits).
- Stop at any checkpoint to validate a story independently.
- **`🟥` and `[VERIFY-LIVE]` tasks gate correctness** — do not skip; the data gate (T024) and the sun-agreement test (T040) are the two highest-stakes items.
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence.
