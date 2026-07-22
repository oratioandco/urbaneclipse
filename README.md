# Urban Eclipse — Plaster Void

A web-based 3D geospatial planning tool for **extreme telephoto photography** in
Berlin. It answers two questions a long-lens photographer needs before traveling to
a location:

1. **Is the shot physically possible?** Place an observer and a target at
   adjustable heights on a real 3D model of Berlin (Mitte + Lichtenberg + parts of
   Friedrichshain, LoD2 buildings) and see whether an intervening building blocks
   the line of sight.
2. **When is the light right?** Scrub to any date/time and see the real sun
   position and shadows (via `suncalc`), read a golden/blue-hour timeline, or run a
   reverse-ephemeris search ("when is the moon behind the Fernsehturm?") over a
   date range.

A camera/lens framing preview (sensor size + focal length + zoom → field of view)
completes the planning loop.

## The "Plaster Void" aesthetic

The scene deliberately does **not** look like a GIS map. Buildings render as
uniform matte-white geometry with no satellite/road imagery, no sky box, and no
atmosphere — floating in a soft, hazy, grain-textured void, like a physical
architectural plaster/clay model under studio lighting. This is a first-class
product requirement (not decoration): stripping away map chrome and color isolates
pure geometry and shadow, which is what a line-of-sight/light planning tool
actually needs to show. See `src/cesium/shaders/studioEnvironment.ts` for the
depth-haze + film-grain post-process shader that produces the effect.

## Quick start

### Prerequisites

- **Node 22** (Astro 7 requires Node `>=22.12`; this repo pins `22` in `.nvmrc`).
  **Node 20 (the common default on many machines) fails outright** — Astro 7 will
  refuse to run. If your shell's default `node` is v20, load the correct version
  before running any command, e.g.:
  ```bash
  export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
  # or, with nvm installed:
  nvm use
  ```
- A **Cesium Ion account** is *not required* to run the app — the plaster-void
  scene loads a self-hosted 3D Tiles tileset and uses no Ion assets (no World
  Terrain, no base imagery). `PUBLIC_CESIUM_ION_TOKEN` is read defensively and
  applied only if present, for any future Ion-backed feature; the app never
  crashes or silently falls back to a demo token when it's absent.
- **Python 3 + a virtualenv** only if you intend to (re)run the CityGML→3D Tiles
  data pipeline (see "Data pipeline" below) — not needed to run the web app itself,
  since the converted tiles are already committed under `public/berlin-core/`.

### Install, dev, build, test

```bash
npm install
npm run dev        # Astro dev server — http://localhost:4321
npm run build      # astro build -> dist/ (static)
npm run preview    # astro preview -> serves dist/
npm test           # vitest run (all unit tests, no browser needed)
npm run test:watch # vitest watch mode
```

There is no `PUBLIC_CESIUM_ION_TOKEN` needed for `npm run dev`/`build` to render the
scene; copy `.env.example` to `.env` and paste a token (from
`https://ion.cesium.com/tokens/`) only if you plan to wire in an Ion-hosted asset
later.

A `playwright.config.ts` exists (targets `tests/e2e/` against `astro preview` on
port 4402 with software-rendered WebGL), and `scripts/diagnose.mjs` /
`scripts/screenshot.mjs` are runnable ad hoc — see "Verification tooling" below.
There is currently no `test:e2e` npm script and no populated `tests/e2e/` suite;
Playwright is wired but not yet exercised as an npm script.

## Architecture

### Astro static shell + a `client:only` Cesium island

`src/pages/index.astro` is a server-rendered shell — markup only, plus a single
mount point for `<CesiumViewer client:only="react" />`. **Cesium must never enter
the SSR module graph**: it touches `window`/`document`/`Worker` at import time, and
Astro's dev/build pipeline would crash (or silently produce broken output) trying
to server-render it. `client:only="react"` guarantees Astro never runs that
component on the server — it only ever mounts in the browser.

This is enforced by a real test, not just a comment: `tests/unit/ssr-graph-guard.test.ts`
scans every `.ts`/`.tsx`/`.astro` file under `src/pages/**` and `src/layouts/**` for
a `from 'cesium'` import and fails if it finds one. It's a cheap, fast regression
guard against someone accidentally importing Cesium (or a module that re-exports
it) into a server-rendered file.

Cesium itself isn't even loaded as an ES module — `astro.config.mjs` wires
`vite-plugin-cesium()` to serve Cesium's prebuilt UMD bundle from `/cesium/` (dev)
and copy it into `dist/cesium/` (build); `index.astro` loads it via a `<script
is:inline src="/cesium/Cesium.js">` tag, and `CesiumViewer.tsx` reads the global
`window.Cesium` rather than `import * as Cesium from 'cesium'`. This sidesteps a
real problem hit during development: importing the npm `cesium` package as an ESM
module breaks Vite's dev-server dependency optimization on Cesium's CommonJS deps
(a `mersenne-twister` default-export error, then repeated 504 "Outdated Optimize
Dep" reload loops). `cesium` is also marked `ssr.external` and excluded from
`optimizeDeps` in `astro.config.mjs` as a defensive belt-and-suspenders measure.

### State layer — nanostores

`src/store.ts` holds the cross-island application state (`dateTime`,
`observerHeight`, `targetHeight`, `cameraProfile`, `solverState`, and the read-only
`isOccluded`) as `nanostores` atoms, consumed via `@nanostores/react`'s `useStore`.
Two invariants worth knowing:

- **`isOccluded` is read-only from outside the engine.** It's a private source atom
  exported only under its `ReadableAtom<boolean>` type; the sole writer is
  `commitOcclusion()`, called only from the occlusion engine in `CesiumViewer.tsx`.
- **Occlusion is time-independent.** Line-of-sight occlusion recomputes only on
  observer/target height change or tileset load — **never** on `dateTime` — because
  whether a building blocks the line doesn't depend on the time of day. Sun
  position/shadows, by contrast, are driven by `dateTime` alone. This dependency
  direction is asserted by `tests/unit/store.test.ts`.

### Pure-math `lib/` cores vs. the Cesium adapter layer

The architecture's central discipline (Constitution Principle I — TDD) is keeping
every piece of non-trivial logic in a Cesium-free, Vitest-testable module under
`src/lib/`, with a thin Cesium-aware adapter in `src/cesium/` wrapping it for the
live scene:

| Pure core (`src/lib/*`, Vitest) | Cesium adapter (`src/cesium/*` + island) |
|---|---|
| `occlusionMath.ts` — classify ray intersections into clear/occluded/marginal/same-point | `cesium/lineOfSight.ts` — `drillPickFromRay` + `classifyOcclusion` |
| `ephemerisMath.ts` — alt/az ⇄ ENU/ECEF, sun direction | inlined in `CesiumViewer.tsx` — drives `viewer.clock.currentTime` |
| `timeline.ts` — golden/blue/day/night band classification from a `getTimes`-shaped input | `HourTimeline.tsx` — renders the color-coded bar |
| `solver.ts` — minute-step generation, angular distance, alignment search over an injected position provider | `workers/solver.worker.ts` — thin `postMessage` shell over `findAlignments` |
| `cameraMath.ts` — sensor+focal length → horizontal FOV, FOV→Cesium conversion | inlined in `CesiumViewer.tsx` — assigns `camera.frustum.fov` |
| `coords.ts` — CRS transforms (EPSG:25832/25833/31468 → WGS84) via `proj4` | consumed by the Python data pipeline, not the live Cesium scene |

Note that some pieces the original plan sketched as separate `src/cesium/*`
modules (`scene.ts`, `artDirection.ts`, `bootstrap.ts`, `ephemeris.ts`) ended up
folded directly into `CesiumViewer.tsx` as the implementation settled — the
scene-setup, plaster-aesthetic overrides, and clock-binding logic all live there
now, alongside inline comments explaining each piece. `cesium/lineOfSight.ts` and
`cesium/shaders/studioEnvironment.ts` remain separate, Cesium-namespace-taking
modules.

### The solver Web Worker

The reverse-ephemeris search ("find dates where the moon is behind the target
within tolerance") iterates roughly one step per minute over a date range (a
30-day search is ~43,000 steps), computing a celestial position at each step. That
would freeze a 60fps Cesium scene if run on the main thread, so it runs in
`src/workers/solver.worker.ts`, a Vite ESM Web Worker. The worker is a thin shell:
it owns no solver logic itself, just chunks the work and relays
`progress`/`result`/`done`/`error` messages (with `cancel` support) around the pure
`findAlignments` core in `src/lib/solver.ts`. `SolverSearch.tsx` spawns the worker,
writes progress/results into the `solverState` store, and cancels a stale search
before starting a new one.

## Data pipeline — Berlin LoD2 CityGML → 3D Tiles

Cesium Ion does not tile CityGML directly, so a local conversion stage is
mandatory (this was a confirmed blocker during planning — see
[research.md](specs/001-telephoto-los-planner/research.md)). The pipeline that
actually shipped is a set of **Python** scripts under `scripts/`, not the
JavaScript `scripts/uploadToCesium.js` CLI originally sketched in
[contracts/data-pipeline.md](specs/001-telephoto-los-planner/contracts/data-pipeline.md)
— no maintained TypeScript CityGML→3D-Tiles converter exists, while `py3dtiles`
does mesh→b3dm conversion (confirmed by a synthetic-box proof of concept). Full
details, including the exact geometry/datum fixes applied, are in
[`scripts/README.md`](scripts/README.md); summary:

- **`parse_citygml.py`** — parses LoD2 CityGML via `lxml`, triangulates each
  `gml:Polygon` with `mapbox-earcut` (handles non-convex rings and interior-ring
  holes/courtyards), and deduplicates vertices (~73% reduction on the verified
  tile).
- **`convert_tile.py`** — converts one CityGML tile: adds the Berlin geoid
  undulation (+39.5 m, DHHN2016 → WGS84-ellipsoidal), reprojects EPSG:25833 (UTM
  zone 33N, ETRS89 — **not** 25832, corrected after a coordinate bug) → ECEF, bakes
  a uniform white material, and emits a `tileset.json` + `.b3dm` via `py3dtiles`.
- **`convert_batch.py`** — runs the above over all 236 source tiles (Mitte,
  Friedrichshain, Lichtenberg), emitting one combined tileset with the root's
  bounding volume as the union of its children, processing one tile's geometry at
  a time to bound memory.
- **`subset_tileset.py`** — the full 236-tile tileset is ~183 MB and gitignored;
  this script extracts a small "core" subset (the tiles spanning the default
  Lichtenberger-Brücke → Fernsehturm sightline) into `public/berlin-core/`, which
  **is** committed, so the deployed app (built from a fresh git clone by Coolify)
  renders real buildings and a working occlusion raycast without the full dataset.
- **`diagnose.mjs`** / **`screenshot.mjs`** — see "Verification tooling" below.

**Committed vs. generated**: `data/` (source CityGML + the full generated
tileset), `public/berlin/` (the full 236-tile tileset mirrored for local dev), and
`public/test_tile/` are all gitignored — regenerate them locally with the scripts
above if you need the full scene. `public/berlin-core/` (the deploy subset) **is**
committed, so the image always has a usable scene even with no data volume attached.

**Deployed tile hosting.** The full city (924 tiles / 545 MB) is far too large for git
or the Docker image, so in production it lives on the Hetzner Coolify host and is
mounted into nginx's docroot via a Coolify persistent volume
(`/data/plastervoid/tiles/berlin-full` -> `/usr/share/nginx/html/berlin-full`). It is
therefore served from the **same origin** as the app, so no CORS is involved at all.
Sync it with `scripts/sync_tiles_hetzner.sh` (needs Tailscale — the Hetzner firewall
exposes only 80/443 publicly). See [scripts/README.md](./scripts/README.md).

The app reads the tileset URL from `PUBLIC_TILESET_URL`. Astro bakes `PUBLIC_*` at
build time, so it is set by the **Dockerfile** (`ARG PUBLIC_TILESET_URL`, defaulting to
`/berlin-full/tileset.json` for deploys) rather than at runtime. Locally, set it in
`.env` — `/berlin/tileset.json` for the full 236-tile dev set, or leave it unset to use
the committed core subset. If the tileset 404s the app says so explicitly rather than
rendering an empty void.

## Verification tooling

- **`vitest` unit tests** (`npm test`) cover every pure `src/lib/*` module, the
  store's invariants (read-only `isOccluded`, dependency direction, scrub
  coalescing), and the SSR graph guard. 12 test files, 148 passing tests (+1
  skipped) as of this writing — run entirely in Node, no browser/WebGL needed.
- **`scripts/diagnose.mjs`** is a headless, objective **scene-state inspector**,
  not a pixel-diff tool. It exists because headless Chromium's software renderer
  (SwiftShader) **cannot meaningfully render Cesium's actual pixels** — shader
  compilation, tile streaming, and the post-process pass behave differently enough
  under software rendering that a screenshot taken there proves very little about
  correctness (and can stall indefinitely). Instead, `diagnose.mjs` launches
  headless Chromium with SwiftShader, drives the live app, and reads back objective
  scene state through a `window.__cesium` debug hook exposed by `CesiumViewer.tsx`:
  primitive count, whether the tileset's root content loaded, its bounding sphere,
  frustum-culling intersection, draw-command count, the occlusion classifier's last
  result, whether the Cesium clock actually moves when the date/time input changes,
  whether the camera frustum FOV responds to a sensor-preset click, and whether the
  solver worker actually constructs when "SEARCH" is clicked. It still takes a
  best-effort screenshot at the end, but the pass/fail signal is the objective scene
  state, not the image.
- **`scripts/screenshot.mjs`** is a simpler headless screenshot utility for eyeballing
  the render, also useful for confirming asset requests (`/cesium/`, `/berlin-core/`
  or `/test_tile/`) actually succeed.
- **`playwright.config.ts`** is configured (points `tests/e2e/**/*.spec.ts` at
  `astro preview` on port 4402, with SwiftShader launch flags) but no e2e spec files
  exist yet and no `test:e2e` npm script is wired up.

## Deployment

Deployed via **Docker + nginx**, orchestrated by **Coolify** (per the project
constitution's Infrastructure-as-Code principle — no hand-configured servers).

- **`Dockerfile`** is a two-stage build: `node:22-alpine` runs `npm ci && npm run
  build` (Astro static output), then `nginx:alpine` serves the resulting `dist/`.
  `PUBLIC_CESIUM_ION_TOKEN` and `PUBLIC_TILESET_URL` are accepted as build `ARG`s
  (Astro bakes `PUBLIC_*` env vars in at build time) and should be supplied as
  Coolify build-time environment variables — **never committed** (`.env` is
  gitignored; `.env.example` documents the token variable as a placeholder only).
  A `HEALTHCHECK` hits `/` every 30s for Coolify's health monitoring.
- **`.dockerignore`** keeps the build context small and explicitly excludes the
  gitignored full datasets (`data/`, `public/berlin/`, `public/test_tile/`) and
  `.env` — only the committed `public/berlin-core/` subset travels with the image.

### Operational notes

**The nginx `types {}` gotcha that broke the first deploy**: `nginx.conf`
carries an explicit comment warning against adding a bare `types { ... }` block to
the server config. In nginx, a `types {}` block does not *add* to the inherited
`/etc/nginx/mime.types` map — it **replaces it entirely**. An earlier version of
this config added one to explicitly type `.b3dm` files, which had the side effect
of wiping every other MIME mapping, including `text/html` for `index.html`. The
result: the browser received `index.html` as `application/octet-stream` and
**downloaded the page as a file instead of rendering it** — the deployed app
appeared completely broken with no error in the app itself, because the app never
even started (see commit `49ca158`). The fix was to remove the bare `types {}`
block entirely and rely on the inherited default MIME map; `.b3dm` files are
served with the default `application/octet-stream` type, which Cesium parses fine
by magic bytes regardless of the declared `Content-Type`. If you ever need custom
MIME types in this nginx config, use `types_hash_bucket_size`/`include
mime.types;` plus additive `types` entries — never a bare replacing block.

## Cross-references

Deeper design documentation lives under
[`specs/001-telephoto-los-planner/`](specs/001-telephoto-los-planner/):

- [`spec.md`](specs/001-telephoto-los-planner/spec.md) — the feature spec: user
  stories, functional requirements, success criteria.
- [`plan.md`](specs/001-telephoto-los-planner/plan.md) — technical plan,
  Constitution Check, and the original project-structure sketch.
- [`research.md`](specs/001-telephoto-los-planner/research.md) — Phase 0 research
  findings and `VERIFY-LIVE` flags (Cesium/suncalc agreement, Ion REST behavior,
  Berlin CRS/height-datum, etc.).
- [`data-model.md`](specs/001-telephoto-los-planner/data-model.md) — entity/value
  types (`Observer`, `Target`, `Sightline`, `CelestialPosition`, `AlignmentWindow`,
  `CameraProfile`, `BuildingGeometry`) and the nanostores state shape.
- [`quickstart.md`](specs/001-telephoto-los-planner/quickstart.md) — a runnable,
  per-user-story validation guide (some prerequisite details there, e.g. "Node 20",
  are superseded by this README's Node 22 requirement).
- [`contracts/`](specs/001-telephoto-los-planner/contracts/) — the store, solver
  worker message protocol, and (superseded) data-pipeline CLI contracts.
- [`tasks.md`](specs/001-telephoto-los-planner/tasks.md) — the task breakdown and
  its current completion status.
- [`.specify/memory/constitution.md`](.specify/memory/constitution.md) — the
  project's non-negotiable engineering principles (TDD, defensive programming,
  build-test-verify, research-before-acting, infra-as-code, git discipline).
