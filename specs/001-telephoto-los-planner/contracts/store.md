# Contract — Application State (nanostores)

**Feature**: `001-telephoto-los-planner` | **Module**: `src/store.ts` | **Binding**: `@nanostores/react` `useStore`

The store is the single source of truth shared across the `client:only="react"` islands (`CesiumViewer`, `ControlPanel`, `HourTimeline`, `SolverSearch`, `CameraControls`). It is **pure logic with zero Cesium dependency** — fully Vitest-first (Constitution Principle I). See [data-model.md](../data-model.md) for value types.

## Exported Surface

```ts
import { WritableAtom, ReadableAtom } from 'nanostores';

// --- Core atoms (writable) ---
export const dateTime: WritableAtom<Date>;            // default: new Date()
export const observerHeight: WritableAtom<number>;    // default: 1.5
export const targetHeight: WritableAtom<number>;      // default: 210 (⚠️ verify Fernsehturm height)
export const cameraProfile: WritableAtom<CameraProfile>;
export const solverState: WritableAtom<{
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;          // 0..1
  matches: AlignmentWindow[];
  error?: string;
}>;

// --- Read-only derived ---
export const isOccluded: ReadableAtom<boolean>;       // computed — consumers CANNOT .set()
export const timelineBands: ReadableAtom<Band[]>;     // computed from dateTime via getTimes

// --- Controlled writers ---
export function setDateTimeScrubbing(date: Date): void;   // rAF-coalesced (slider only)
export function commitOcclusion(v: boolean): void;        // SOLE writer of isOccluded (engine-only)
```

## Invariants (enforced; the test suite locks these)

1. **`isOccluded` is read-only.** Implemented as `computed(_isOccludedSource, v => v)`; calling `.set()` on it is rejected (throws / absent) by nanostores. The only mutation path is `commitOcclusion(v)`, which writes the private `_isOccludedSource` and skips the notify when `Object.is(v, prev)` (no redundant raycast-driven re-renders).
2. **🟥 Occlusion is time-independent** (research §occlusion). Inside `CesiumViewer`:
   - `dateTime.listen(updateSunClock)` — sun/shadow refresh only.
   - `observerHeight.listen(scheduleOcclusion)` + `targetHeight.listen(scheduleOcclusion)` — occlusion recompute.
   - `dateTime` MUST NOT trigger occlusion. The test suite asserts this dependency direction explicitly (a future regression that wires occlusion to `dateTime` fails the test).
3. **Scrub is rAF-coalesced.** `setDateTimeScrubbing` collapses a burst of slider writes into ≤1 `dateTime.set()` per animation frame (latest-wins); it cancels the pending frame on island unmount (`cancelAnimationFrame`). Non-scrub writers (solver result, step buttons, manual edit) call `dateTime.set()` directly.
4. **Listener hygiene.** Every `.listen()`/`.subscribe()` in an island is unsubscribed in `useEffect` cleanup (prevents HMR/remount leak → stacked callbacks → multiplied Cesium work).
5. **Timezone-free.** `dateTime` is an absolute `Date`; all formatting lives in the control panel. No dual source of truth.
6. **Tiles gate.** Occlusion stays `unknown`/stale until `tilesLoaded === true`; `commitOcclusion` is only called after the engine confirms tiles along the sightline are loaded.

## Consumer Wiring (shape)

```tsx
// CesiumViewer.tsx (engine — sole writer of isOccluded)
const dt = useStore(dateTime);
useEffect(() => {
  const u1 = dateTime.listen(updateSunClock);
  const u2 = observerHeight.listen(scheduleOcclusion);
  const u3 = targetHeight.listen(scheduleOcclusion);
  return () => { u1(); u2(); u3(); };
}, []);
// ... after raycast: commitOcclusion(state === 'occluded' || state === 'marginal');

// ControlPanel.tsx (reader)
const dt = useStore(dateTime);
const blocked = useStore(isOccluded);
```

## Test Contract (TDD — `tests/unit/store.test.ts`, no browser/Cesium)

- Initial values exact.
- **Read-only**: `(isOccluded as any).set(true)` throws / is undefined.
- `commitOcclusion` writes once; a second identical call does NOT re-notify (equality guard).
- **Scrub coalescing** (fake timers + stubbed `requestAnimationFrame`): a burst → exactly one notify; `cancelAnimationFrame` called on cleanup.
- **Dependency-direction guard**: spy on `updateSunClock` + `recomputeOcclusion`; set `dateTime` →前者 called, latter NOT; set height → vice-versa.

## VERIFY-LIVE

- In the installed `nanostores`, confirm `computed` store `.set()` is rejected (foundation of the read-only guarantee). Fallback if not: private source atom + non-exported setter + ESLint rule.
- `.listen` (changes-only) vs `.subscribe` (immediate + changes); `useStore` opts shape; `@nanostores/react` ↔ React-major compatibility.
