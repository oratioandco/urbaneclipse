# Contract — Reverse-Ephemeris Solver Worker

**Feature**: `001-telephoto-los-planner` | **Worker**: `src/workers/solver.worker.ts` | **Pure core**: `src/lib/solver.ts`

The reverse-ephemeris solver runs in a Vite ESM Web Worker (`new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' })`) so a 1-month/1-min search (~43,800 steps × Sun+Moon) never blocks the 60 fps Cesium scene (FR-012). The worker imports **`suncalc` only — never `cesium`** — so the pure core is Vitest-first.

## Message Protocol (postMessage)

All messages carry a `id` correlation string. The main thread ignores messages whose `id` is not the active request's.

### Main → Worker

```ts
type SolverRequest =
  | {
      type: 'solve';
      id: string;
      start: Date;                 // inclusive
      end: Date;                   // exclusive of end if it lands on a step
      body: 'sun' | 'moon';
      lat: number;                 // observer latitude, degrees
      lon: number;                 // observer longitude, degrees
      targetAzimuth: number;       // radians, NORTH-referenced (geodesic bearing frame)
      targetAltitude: number;      // radians, above horizon
      toleranceDeg: number;        // default 0.5; combined 3-D angular distance
      stepMinutes: number;         // default 1
      filter?: { minMoonFraction?: number };   // optional "full moon behind tower" enrichment
    }
  | { type: 'cancel'; id: string };
```

### Worker → Main

```ts
type SolverMessage =
  | { type: 'progress'; id: string; progress: number }                 // 0.0 .. 1.0
  | { type: 'result';  id: string; matches: AlignmentWindow[] }        // see data-model.md
  | { type: 'done';    id: string }                                    // terminal (success or after cancel)
  | { type: 'error';   id: string; code: SolverErrorCode; message: string };

type SolverErrorCode = 'INVALID_RANGE' | 'INVALID_TOLERANCE' | 'INTERNAL';
```

## Semantics

- **Chunked iteration**: the worker processes the step list in chunks (e.g., 1000 steps) with `setTimeout(0)` yields between chunks, so it can receive `cancel` and emit `progress`. A tight synchronous loop would starve the main thread of progress updates and ignore cancel.
- **Matching** (research §features-2): combined **3-D angular distance on the unit sphere** between the target direction and the body direction at each step — `acos(clamp(dot, -1, 1))` — within `toleranceDeg`. This is more physically meaningful for "appears behind the tower" than per-axis az/alt tolerances.
- **Frame convention** (🟥 critical): `targetAzimuth` is **north-referenced** (matches the geodesic observer→target bearing). `suncalc` azimuth is **south-referenced (+ west)**. The pure core applies the `±π` conversion in ONE place (`src/lib/ephemerisMath.ts`) — never inline. A missing conversion returns systematically wrong dates.
- **Terminal ordering**: `progress*` … `result` … `done`. On `cancel`: stop ASAP, post `done` (no `result`). On error: post `error` then `done`.
- **Idempotency / latest-wins**: a new `solve` supersedes any in-flight one; the main thread cancels the prior `id` first.
- **Edge cases**: empty `matches` → `result` with `[]` + `done` (not an error). Polar/`NaN` `getTimes` values (not expected for Berlin) → the step is skipped, not fatal (Principle II).

## Test Contract (TDD — `tests/worker/` + `tests/unit/solver.test.ts`)

The pure core (`src/lib/solver.ts`) is tested with an **injected** `positionProvider` (no suncalc, no DOM):
- `generateMinuteSteps(start, end, stepMin)` — count, inclusive start, DST boundary.
- `angularDistanceDeg(az1, alt1, az2, alt2)` — identical→0, orthogonal→90, dot-clamp (no NaN).
- `findAlignments(steps, target, tolDeg, positionProvider)` — only in-tolerance steps; respects default 0.5; empty when none.
- **One** integration test with real `suncalc` against a known published alignment (VERIFY-LIVE item) locks end-to-end correctness (SC-003).

The worker shell is tested by mocking the `Worker` global (`vi.stubGlobal`) and asserting the `progress`/`result`/`done`/`error` sequence, including a `cancel` mid-run.

## VERIFY-LIVE

- `suncalc.getPosition` / `getMoonPosition` exact signatures (units, azimuth convention, no height arg).
- A known reference alignment date (e.g., a published full-moon-rise behind the Fernsehturm) to validate end-to-end within ±0.5° / 1-min.
