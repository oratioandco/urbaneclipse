import { atom, type ReadableAtom } from 'nanostores';

/**
 * Core shared state. Pure logic, NO Cesium (Constitution Principle I — Vitest-first).
 * See specs/001-telephoto-los-planner/contracts/store.md for the full contract.
 *
 * Key invariant (research.md §occlusion): line-of-sight occlusion is TIME-INDEPENDENT,
 * so `isOccluded` is wired to height changes + tile-load in the CesiumViewer island —
 * NEVER to the `dateTime` listener.
 */

export const dateTime = atom<Date>(new Date());
export const observerHeight = atom<number>(1.5);
export const targetHeight = atom<number>(210);

// --- US6 camera profile -----------------------------------------------------
// Sensor + lens model authored by CameraControls; consumed by the CesiumViewer
// island to drive viewer.camera.frustum.fov via fovToCesium(computeHorizontalFov(...)).
// Defaults model a full-frame camera at 600 mm with no zoom boost (the US6 spec).
export interface CameraProfile {
  sensorWidth: number; // mm
  focalLength: number; // mm (prime, before zoom)
  zoom: number; // dimensionless multiplier on focalLength
}
export const cameraProfile = atom<CameraProfile>({
  sensorWidth: 36,
  focalLength: 600,
  zoom: 1,
});

// --- US5 solver state -------------------------------------------------------
// Worker -> store handshake. Status transitions:
//   idle -> running (search started) -> done|error (terminal)
// `matches` is the list of alignment instants found by the solver worker; empty until
// a search completes with at least one match. `progress` is 0..1.
export type SolverStatus = 'idle' | 'running' | 'done' | 'error';
export interface SolverState {
  status: SolverStatus;
  progress: number;
  matches: Date[];
  error?: string;
}
export const solverState = atom<SolverState>({
  status: 'idle',
  progress: 0,
  matches: [],
});

// `isOccluded` is READ-ONLY BY TYPE: a private source atom exported under the
// `ReadableAtom<boolean>` type (no `.set` visible to consumers). The sole writer is
// commitOcclusion(). (nanostores 1.4 `computed` does not enforce read-only at runtime,
// so we use the private-source + typed-export pattern instead of a derived store.)
const _isOccluded = atom<boolean>(false);
export const isOccluded: ReadableAtom<boolean> = _isOccluded;

/** SOLE writer for isOccluded — called only by the occlusion engine (CesiumViewer island).
 *  Guarded by Object.is to skip redundant notifications. */
export function commitOcclusion(v: boolean): void {
  if (_isOccluded.get() !== v) {
    _isOccluded.set(v);
  }
}

// --- rAF-coalesced scrub (slider only) -------------------------------------
let rafHandle: number | null = null;
let pendingDate: Date | null = null;

function flushScrub(): void {
  rafHandle = null;
  if (pendingDate !== null) {
    const d = pendingDate;
    pendingDate = null;
    dateTime.set(d);
  }
}

/** Coalesce a burst of slider writes into <=1 dateTime.set() per animation frame (latest-wins).
 *  Non-scrub writers (solver result, step buttons, manual edit) call dateTime.set() directly.
 *  Assumes a browser requestAnimationFrame (the store runs only in the client:only island). */
export function setDateTimeScrubbing(date: Date): void {
  pendingDate = date;
  if (rafHandle !== null) return;
  rafHandle = requestAnimationFrame(flushScrub);
}
