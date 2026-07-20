# Quickstart — Telephoto Line-of-Sight Planner ("Plaster Void")

**Feature**: `001-telephoto-los-planner` | **Date**: 2026-07-20 | **Plan**: [plan.md](./plan.md)

A **runnable validation guide**: how to prove the feature works end-to-end. This is a validation/run guide — implementation details live in `tasks.md`. Types and message shapes live in [data-model.md](./data-model.md) and [contracts/](./contracts/); refer to those rather than duplicating.

## Prerequisites

1. **Node 20 LTS** + npm (or pnpm).
2. **Cesium Ion access token** — create at `https://ion.cesium.com/tokens/` (free Community tier). Store as:
   ```
   # .env  (gitignored — never committed; Constitution Principle V)
   PUBLIC_CESIUM_ION_TOKEN=eyJ...
   ```
3. **Berlin LoD2 data, converted** (🟥 **Phase-1 human-intervention gate** — see [contracts/data-pipeline.md](./contracts/data-pipeline.md)):
   - Download "3D-Gebäudemodelle LoD2" for **Mitte** + **Lichtenberg** from the Berlin Open Data portal / FIS-Broker.
   - Run the pipeline once:
     ```bash
     node scripts/uploadToCesium.js \
       --input ./data/citygml --districts mitte,lichtenberg \
       --source-crs EPSG:25832 --height-datum DHHN \
       --out-config src/data/buildings.json
     ```
   - This writes `src/data/buildings.json` (the tileset location the app loads). The app cannot run P1/P2 meaningfully without it.

> If the token or data are not yet available, the **pure-logic units** (vitest) and the **scene shell** still run — see "Partial / no-data smoke" below.

## Setup

```bash
npm install                 # Astro + React + cesium + suncalc + nanostores + tailwind + vite-plugin-cesium
cp .env.example .env        # then paste your token into .env
npm run dev                 # Astro dev server (http://localhost:4321)
```

Build artifacts + scripts (`dev`, `build`, `preview`, `test`, `test:e2e`) are created in **Phase 2 scaffolding**.

## Test

```bash
npm test                    # vitest — pure logic (src/lib/*), store (src/store.ts), worker shell
npm run test:e2e            # playwright — needs WebGL (mark @gpu; SwiftShader in CI)
```

Per the `src/lib/*` vs `src/cesium/*` split (Constitution Principle I), **all** pure logic is unit-tested without WebGL/Cesium. Visual/scene correctness is Playwright (`@gpu`).

## Runnable Validation Scenarios (one per user story)

Each maps to a Success Criterion in [spec.md](./spec.md). Run `npm run dev` and verify:

| # | User story | Steps | Expected outcome | SC |
|---|-----------|-------|------------------|----|
| 1 | **LOS occlusion (P1)** | Leave defaults (observer Lichtenberger Brücke 1.5 m, target Fernsehturm). Note the sightline color. Raise `observerHeight` until an intervening building crosses the line. | Sightline is **green** (clear) at default; flips to **red** (occluded) once a building crosses; the control panel reads `isOccluded` accordingly. | SC-001 |
| 2 | **Plaster aesthetic (P2)** | Open the scene. | Buildings are uniform matte **white**; **no** satellite/road imagery, sky, or atmosphere; background is a soft hazy void; subtle film grain. Reads as a physical plaster model. | SC-006 |
| 3 | **Temporal lighting (P3)** | Set date/time to a known Berlin sunrise; scrub to solar noon. | Sun low in the east with long westward shadows at sunrise; shadows shorten toward noon; updates within a perceivably immediate response while scrubbing. | SC-002, SC-007 |
| 4 | **Golden/blue hour (P4)** | Pick a date with clear sunrise/sunset. | Timeline shows an **amber** golden-hour band and a **blue** blue-hour band; the time slider highlights the band it sits in; bands shift with season. | SC-004 |
| 5 | **Reverse ephemeris (P5)** | Run the (mock) search "moon behind the Fernsehturm" over a 1-month range. | UI stays responsive; returns concrete date(s)/time(s); at each, the moon's azimuth/altitude is within ±0.5° of the target line; "no match" reported cleanly when none. | SC-003, SC-008 |
| 6 | **Camera/lens framing (P6)** | Select full-frame + 600 mm, then 200 mm. | 600 mm tightly frames the target; 200 mm widens the composition (target shrinks), matching real telephoto behavior. | SC-005 |

## Automated Evidence (CI gates, run before "done")

- `npm test` green — esp. the **source-graph guard** (no `cesium` import under `src/pages`/`src/layouts`), the **dependency-direction guard** (occlusion not wired to `dateTime`), the **read-only `isOccluded`** test, and the **sun-agreement test** (Cesium vs suncalc < 0.5° — ratifies Strategy B).
- `npm run build` succeeds (`output: 'static'`); the SSR/HTML output contains **no** cesium reference and the client chunk + static `cesium/{Workers,Assets,…}` are present.
- `npm run test:e2e` (at least the non-`@gpu` subset) green; `@gpu` perceptual-hash regression run pre-merge of any shader change.

## Partial / no-data smoke (when Phase-1 data/token are pending)

- `npm test` runs fully (pure logic needs no data/token).
- `npm run dev` loads the scene shell: viewer initializes with all widgets off, white void, Cesium World Terrain — but the LoD2 tileset will be absent (FR-013 surfaces an explicit "building data not loaded" state, not a silent blank). Occlusion stays `unknown`.

## Cross-references

- **Why/What**: [spec.md](./spec.md) · **Architecture**: [plan.md](./plan.md) · **Findings**: [research.md](./research.md)
- **Types/state**: [data-model.md](./data-model.md)
- **Contracts**: [worker-solver.md](./contracts/worker-solver.md), [store.md](./contracts/store.md), [data-pipeline.md](./contracts/data-pipeline.md)
