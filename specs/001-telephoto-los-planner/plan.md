# Implementation Plan: Telephoto Line-of-Sight Planner ("Plaster Void")

**Branch**: `001-telephoto-los-planner` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-telephoto-los-planner/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. Phase 0 research was produced by an 8-domain parallel research workflow (knowledge-based — web tools were rate-limited this session; uncertain items are flagged `VERIFY-LIVE` in [research.md](./research.md)).

## Summary

A web-based 3D geospatial planner for extreme telephoto photography. An observer (Lichtenberger Brücke) and a target (Berliner Fernsehturm, ~5.5 km, ~210 m) are placed in a CesiumJS scene of Berlin LoD2 buildings rendered as a monochrome white "plaster" model in a hazy grainy void. The app (a) computes line-of-sight occlusion via Cesium raycasting, (b) scrubs date/time to drive sun/moon position and real-time shadows via `suncalc`, (c) shows a golden/blue-hour timeline, (d) runs a Web-Worker reverse-ephemeris solver to find celestial-alignment dates, and (e) previews camera/lens framing. Built on the locked stack: Astro + React (`client:only`) + CesiumJS + `suncalc` + `nanostores` + Tailwind + TypeScript.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode). Node 20 LTS for tooling and the data-pipeline script.

**Primary Dependencies**: Astro (framework) · React 18 (UI islands, `client:only`) · `cesium` / CesiumJS (3D WebGL engine) · `suncalc` (Sun/Moon ephemeris) · `nanostores` + `@nanostores/react` (state) · `tailwindcss` (styling) · `vite` + `vite-plugin-cesium` (build + Cesium static assets). Dev: `vitest` (unit), `@playwright/test` (e2e/visual). [NEEDS CLARIFICATION: exact current versions and Astro/Vite compatibility of `vite-plugin-cesium` — resolved in research.md.]

**Storage**: No server-side storage. Optional `localStorage` for UI preferences (last date/time, observer/target heights). No accounts/data persistence otherwise.

**Testing**: `vitest` for **pure logic** (ephemeris math, occlusion classification, FOV calc, solver, store transitions, CRS transforms); `@playwright/test` for scene/visual smoke tests, the hour timeline, and the solver end-to-end. Cesium/WebGL is not unit-testable, so all pure math is isolated in `src/lib/*` and tested there first (TDD, Principle I).

**Target Platform**: Modern evergreen **desktop** browsers with WebGL2 (Chrome/Edge/Firefox/Safari current). Mobile is out of scope (telephoto planning is a desktop workflow) — consistent with the web-only constitution.

**Project Type**: web-app (Astro static/SSR-hybrid shell with a client-heavy Cesium island).

**Performance Goals**: 60 fps orbit/pan/zoom in the scene; shadow update on time-scrub within a perceivably immediate response (< ~100 ms perceived); occlusion recompute on height change < ~200 ms; reverse-search over a 1-month range (~43,800 minute-steps × Sun+Moon) completes without freezing the UI (runs in a Web Worker).

**Constraints**: Client-side only; Cesium **strictly** `client:only` (never server-rendered — it touches `window`/`Worker` at import); requires a Cesium Ion access token + Berlin LoD2 data (Phase 1 prerequisites, user-provided); Berlin-only for v1; the plaster aesthetic is mandatory (non-functional but required); reverse-solver uses ±0.5° angular tolerance at 1-minute resolution.

**Scale/Scope**: One scene; two Berlin districts (Mitte + Lichtenberg) of LoD2 geometry; single-user; one main page (`index.astro`).

**NEEDS CLARIFICATION (RESOLVED in Phase 0 — see [research.md](./research.md) § "Resolved NEEDS CLARIFICATION")**:

- [NEEDS CLARIFICATION: CityGML (Berlin LoD2) → 3D Tiles pipeline — does Cesium Ion tile CityGML natively, or must we convert locally (`citygml-to-3d-tiles`, `citygml-tools`, FME, `py3dtiles`)? Determines the real design of `scripts/uploadToCesium.js` and the tileset load path. **Likely technical blocker** — flagged in research.md.]
- [NEEDS CLARIFICATION: Berlin CRS → WGS84 transform (ETRS89/UTM 32N = EPSG:25832, historically DHDN/GK = EPSG:31468) needed if converting locally.]
- [NEEDS CLARIFICATION: `suncalc.getTimes` exact property names (golden/blue hour) and `getMoonPosition` signature — verify before implementing the timeline + solver.]
- [NEEDS CLARIFICATION: Cesium Sun/shadow strategy — drive the Cesium clock (JulianDate) so native sun/shadows match `suncalc`, vs. overriding `scene.sun` / a custom `DirectionalLight`.]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against [constitution.md](../../.specify/memory/constitution.md) v1.1.0:

- **I. Test-Driven Development** — ✅ Plan isolates all pure math in `src/lib/*` (ephemeris, occlusion, FOV, solver, CRS) as TDD-first targets; WebGL-bound code in `src/cesium/*` is covered by Playwright visual smoke tests. Tests written before implementation.
- **II. Defensive Programming** — ✅ Inputs validated at boundaries: heights clamped to sane ranges, date ranges bounded, Cesium Ion token presence checked at startup, missing/expired data reported explicitly (never silent), solver tolerances enforced.
- **III. Build, Test, Verify** — ✅ Each phase has a verify gate; [quickstart.md](./quickstart.md) provides runnable end-to-end validation; the build-test-verify gate runs before any task is marked complete.
- **IV. Never Assume — Research First** — ✅ **(post-design)** The four `NEEDS CLARIFICATION` items are resolved in [research.md](./research.md). One — the CityGML→3D Tiles pipeline — is a **confirmed technical blocker**: Cesium Ion does NOT tile CityGML, so Phase 1 must insert a local conversion stage. Its remaining unknowns (Ion REST shape, converter viability, Berlin CRS/height-datum) are captured as `VERIFY-LIVE` items to confirm before Phase-1 *implementation* — none block the Phase-1 *design* (this plan + contracts).
- **V. Infrastructure as Code — /infra + Coolify** — ✅ Deployment target is Coolify via `/infra`. A deployable build (Astro static or Node adapter) + Dockerfile + health check will be added at the deploy gate. The Cesium Ion token is supplied via Coolify env (never committed; `.env` is gitignored).
- **VI. Git Discipline** — ✅ Work is on feature branch `001-telephoto-los-planner` off `main`; atomic Conventional Commits per task.

**Result: PASS (post-design).** Principles I, II, III, V, VI ✅; Principle IV ✅ — NEEDS CLARIFICATION resolved in research.md. One **justified complexity** remains — the CityGML→3D Tiles local conversion (confirmed by research; tracked below). Phase-1 *implementation* of the data pipeline is gated on a small set of `VERIFY-LIVE` confirmations (Ion REST API, converter viability, Berlin CRS/height-datum, Fernsehturm height).

## Project Structure

### Documentation (this feature)

```text
specs/001-telephoto-los-planner/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output — 8-domain research + VERIFY-LIVE flags
├── data-model.md        # Phase 1 output — entities, state, validation
├── quickstart.md        # Phase 1 output — runnable end-to-end validation guide
├── contracts/           # Phase 1 output — worker message + store + pipeline contracts
├── spec.md              # Feature spec (/speckit-specify output)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
urbaneclipse/
├── astro.config.mjs
├── vite.config.ts              # vite-plugin-cesium: serve Workers/Assets/ThirdParty/Widgets, set CESIUM_BASE_URL
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── .env                        # CESIUM_ION_TOKEN (gitignored — never committed)
├── scripts/
│   └── uploadToCesium.js       # CityGML -> 3D Tiles pipeline (Phase 1; design TBD by research.md)
├── public/
├── src/
│   ├── pages/
│   │   └── index.astro         # main layout; mounts islands via client:only="react"
│   ├── components/react/       # Astro Islands (all client:only="react")
│   │   ├── CesiumViewer.tsx    # 3D engine host
│   │   ├── ControlPanel.tsx    # date/time picker + height sliders
│   │   ├── HourTimeline.tsx    # golden/blue hour color-coded timeline
│   │   ├── SolverSearch.tsx    # reverse-ephemeris mock search bar
│   │   └── CameraControls.tsx  # sensor / focal-length / zoom framing
│   ├── workers/
│   │   └── solver.worker.ts    # ephemeris iteration (keeps UI responsive)
│   ├── cesium/                 # WebGL-bound (Playwright-tested, not unit-tested)
│   │   ├── scene.ts            # Viewer init, terrain, tileset, camera framing
│   │   ├── artDirection.ts     # plaster overrides + PostProcessStage
│   │   ├── ephemeris.ts        # suncalc -> sun/moon + shadow binding
│   │   ├── lineOfSight.ts      # drillPickFromRay occlusion
│   │   └── shaders/
│   │       └── studioEnvironment.ts   # createStudioEnvironmentStage (GLSL)
│   ├── lib/                    # PURE logic — TDD-first (vitest), no WebGL
│   │   ├── ephemerisMath.ts    # alt/az -> direction; hour classification
│   │   ├── occlusionMath.ts    # classify intersections -> occluded boolean
│   │   ├── cameraMath.ts       # sensor + focal length -> FOV
│   │   ├── solver.ts           # date-range alignment search (worker-shared)
│   │   └── coords.ts           # Berlin CRS -> WGS84 (if local conversion)
│   ├── store.ts                # nanostores atoms (dateTime, heights, isOccluded)
│   └── styles/
└── tests/
    ├── unit/                   # vitest — src/lib/* (written FIRST, must fail)
    ├── worker/                 # vitest — solver.worker (mocked postMessage)
    └── e2e/                    # playwright — scene/visual + timeline + solver
```

**Structure Decision**: Single Astro web app. The key architectural choice (Constitution Principle I) is the **`src/lib/*` vs `src/cesium/*` split**: every pure function (ephemeris math, occlusion classification, FOV, solver, CRS) lives in `src/lib/*` with no Cesium dependency, so it is unit-tested with Vitest *before* implementation. WebGL-bound code in `src/cesium/*` is exercised by Playwright visual smoke tests. React islands in `src/components/react/*` are all `client:only="react"`, keeping Cesium out of Astro's SSR.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| CityGML → 3D Tiles local conversion | **Confirmed by research**: Cesium Ion does NOT tile CityGML (accepts glTF/glb, OBJ, FBX, DAE, LAS/LAZ/XYZ, passthrough 3D Tiles). A local conversion stage is mandatory. | Uploading raw CityGML to Ion fails; no simpler path exists. The pipeline emits glTF (baked white material) → uploads glTF to Ion for tiling **or** self-hosts the tileset ([contracts/data-pipeline.md](./contracts/data-pipeline.md)). |
