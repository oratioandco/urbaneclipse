import { atom, type ReadableAtom } from 'nanostores';
import { log } from './lib/log';

/**
 * Core shared state. Pure logic, NO Cesium (Constitution Principle I — Vitest-first).
 * See specs/001-telephoto-los-planner/contracts/store.md for the full contract.
 *
 * Key invariant (research.md §occlusion): line-of-sight occlusion is TIME-INDEPENDENT,
 * so `isOccluded` is wired to height changes + tile-load in the CesiumViewer island —
 * NEVER to the `dateTime` listener.
 */

export const dateTime = atom<Date>(new Date());

/**
 * SEMANTICS (changed with the vertical-datum fix — see src/lib/sceneHeights.ts):
 *
 *   observerHeight — EYE HEIGHT above the surface you are standing on, metres.
 *   targetHeight   — height up the target ABOVE ITS OWN BASE, metres.
 *
 * Neither is a height above the WGS84 ellipsoid. They used to be passed to Cesium
 * verbatim, which put the observer ~72 m underground because the buildings are baked
 * ~73.5 m up (DHHN2016 ground + the 39.5 m geoid lift). Convert via
 * resolveObserverHeight / resolveTargetHeight — never hand these to Cesium directly.
 */
export const observerHeight = atom<number>(1.5);
/** Default is the Fernsehturm's full 368.03 m, matching TARGET_DEFAULT in lib/berlin.ts
 *  (it was 210 m, roughly the observation deck, leaving the target ~158 m short). */
export const targetHeight = atom<number>(368.03);

// --- Map-first placement ----------------------------------------------------
// The observer and target are no longer hardcoded constants: they are placed by
// clicking the scene in MAP mode. Positions are WGS84 degrees; their ELEVATIONS are
// resolved separately from the DGM1 heightmap / curated viewpoints
// (src/lib/sceneHeights.ts) — never stored here, so there is exactly one place that
// knows about the vertical datum.
export interface ScenePosition {
  lat: number;
  lon: number;
  /** Set when the position came from a curated viewpoint, so its surveyed surface
   *  elevation overrides the terrain sample (e.g. a bridge deck). */
  viewpointId?: string;
  /** Human label for the UI; falls back to coordinates when absent. */
  label?: string;
}

/**
 * View mode.
 *   'map'     — top-down over Berlin; clicking places the observer or target.
 *   'preview' — the telephoto shot itself, from the observer toward the target.
 * The plaster model IS the map: no external tile provider, no extra dependency, and
 * the same geometry the occlusion and silhouette maths already use.
 */
export type ViewMode = 'map' | 'preview';

/** Which body the solver searches for and the preview draws. Shared so the disc you
 *  see is always the body the results describe. */
export type SolverBody = 'sun' | 'moon';
export const solverBody = atom<SolverBody>('sun');
export const viewMode = atom<ViewMode>('preview');

/** What a click in MAP mode places. 'none' disables picking so the map can be panned. */
export type PickMode = 'none' | 'observer' | 'target' | 'area';

/**
 * A reachable camera AREA: everywhere within `radiusM` of `center`.
 *
 * Expressed as a centre plus radius rather than a drawn polygon because that is how a
 * photographer actually describes reach — "anywhere along this bridge", "somewhere in
 * this park" — and it is far quicker to place. It is converted to a polygon
 * (circleToPolygon) only where the geometry needs one.
 *
 * null means "no area": the solver then reports where you would have to stand without
 * constraining it.
 */
export interface SearchArea {
  center: { lat: number; lon: number };
  radiusM: number;
}
export const searchArea = atom<SearchArea | null>(null);

/** Clamp bounds for the area radius, metres. Below ~25 m an area is effectively a
 *  point; above ~5 km it stops describing anywhere you can actually walk. */
export const AREA_RADIUS_MIN_M = 25;
export const AREA_RADIUS_MAX_M = 5000;

export function setSearchArea(area: SearchArea | null): boolean {
  if (area === null) {
    searchArea.set(null);
    return true;
  }
  if (!isPlausibleBerlinPosition(area.center)) {
    log.warn('store', 'search area rejected: centre outside Berlin', area.center);
    return false;
  }
  if (!Number.isFinite(area.radiusM) || area.radiusM <= 0) {
    log.warn('store', 'search area rejected: bad radius', { radiusM: area.radiusM });
    return false;
  }
  searchArea.set({
    center: area.center,
    radiusM: Math.min(AREA_RADIUS_MAX_M, Math.max(AREA_RADIUS_MIN_M, area.radiusM)),
  });
  return true;
}
export const pickMode = atom<PickMode>('none');

export const observerPosition = atom<ScenePosition>({
  lat: 52.5113,
  lon: 13.4988,
  viewpointId: 'lichtenberger-bruecke',
  label: 'Lichtenberger Brücke',
});

export const targetPosition = atom<ScenePosition>({
  lat: 52.520815,
  lon: 13.409419,
  label: 'Berliner Fernsehturm',
});

/** Rough Berlin bounds — a click outside these is a mis-pick, not a viewpoint. */
const BERLIN_LAT = [52.3, 52.7] as const;
const BERLIN_LON = [13.05, 13.8] as const;

/** True when a position is a plausible Berlin location. */
export function isPlausibleBerlinPosition(p: {
  lat: number;
  lon: number;
}): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    p.lat >= BERLIN_LAT[0] &&
    p.lat <= BERLIN_LAT[1] &&
    p.lon >= BERLIN_LON[0] &&
    p.lon <= BERLIN_LON[1]
  );
}

/**
 * Commit a picked position. Rejects implausible coordinates rather than moving the
 * scene somewhere impossible — a ray-pick that misses all geometry can return a point
 * on the far side of the globe, and silently accepting it would send the camera to the
 * middle of the ocean with no explanation.
 */
export function setObserverPosition(p: ScenePosition): boolean {
  if (!isPlausibleBerlinPosition(p)) {
    log.warn('store', 'observer position rejected', { lat: p.lat, lon: p.lon });
    return false;
  }
  observerPosition.set(p);
  return true;
}

export function setTargetPosition(p: ScenePosition): boolean {
  if (!isPlausibleBerlinPosition(p)) {
    log.warn('store', 'target position rejected', { lat: p.lat, lon: p.lon });
    return false;
  }
  targetPosition.set(p);
  return true;
}

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

// --- T058 preference persistence (localStorage, guarded + validated) -------
// Persists dateTime/observerHeight/targetHeight/cameraProfile so a returning visitor
// resumes their last scene instead of the hardcoded defaults. This module is imported
// by code that must not assume a browser (SSR, tests, potentially a worker), so every
// localStorage touch is wrapped defensively: absence, SecurityError (private mode),
// and QuotaExceededError all degrade to "use the in-memory defaults", never a throw.
//
// Versioned key: bump the `v1` suffix if the persisted shape changes incompatibly so
// old/foreign payloads are naturally ignored (JSON.parse of an unrelated shape just
// fails per-field validation below rather than crashing).
const PREFS_STORAGE_KEY = 'plaster-void:prefs:v1';

interface PersistedPrefs {
  dateTime: number; // epoch ms
  observerHeight: number;
  targetHeight: number;
  cameraProfile: CameraProfile;
}

// Mirrors the ranges documented in data-model.md's "Validation Rules" section
// (observerHeight/targetHeight clamp bounds) so a corrupted or hand-edited
// localStorage payload can never resurrect a NaN/negative/absurd height.
const MAX_OBSERVER_HEIGHT_M = 100;
// 450 m, not 400: the Fernsehturm alone is 368.03 m and the slider must not clamp its
// own default. Kept as a sanity ceiling against corrupt persisted values.
const MAX_TARGET_HEIGHT_M = 450;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidHeight(v: unknown, max: number): v is number {
  return isFiniteNumber(v) && v > 0 && v <= max;
}

function isValidCameraProfile(v: unknown): v is CameraProfile {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    isFiniteNumber(c.sensorWidth) &&
    c.sensorWidth > 0 &&
    isFiniteNumber(c.focalLength) &&
    c.focalLength > 0 &&
    isFiniteNumber(c.zoom) &&
    c.zoom > 0
  );
}

/** Returns the browser's localStorage, or null if unavailable/inaccessible for any reason. */
function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return null;
    return localStorage;
  } catch {
    // Some environments (privacy mode in older Safari, sandboxed iframes) throw on
    // merely referencing localStorage rather than returning undefined.
    return null;
  }
}

/** Reads + validates persisted prefs, applying only the fields that pass validation. */
function rehydratePrefs(): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;

  let raw: string | null;
  try {
    raw = storage.getItem(PREFS_STORAGE_KEY);
  } catch (err) {
    log.warn('store', 'rehydrate-read-failed', { message: String(err) });
    return;
  }
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn('store', 'rehydrate-parse-failed', { message: String(err) });
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    log.warn('store', 'rehydrate-rejected', { reason: 'not-an-object' });
    return;
  }
  const p = parsed as Partial<Record<keyof PersistedPrefs, unknown>>;

  if (p.dateTime !== undefined) {
    const ms = p.dateTime;
    const d = isFiniteNumber(ms) ? new Date(ms) : null;
    if (d && !Number.isNaN(d.getTime())) {
      dateTime.set(d);
    } else {
      log.warn('store', 'rehydrate-rejected', { field: 'dateTime' });
    }
  }

  if (p.observerHeight !== undefined) {
    if (isValidHeight(p.observerHeight, MAX_OBSERVER_HEIGHT_M)) {
      observerHeight.set(p.observerHeight);
    } else {
      log.warn('store', 'rehydrate-rejected', { field: 'observerHeight' });
    }
  }

  if (p.targetHeight !== undefined) {
    if (isValidHeight(p.targetHeight, MAX_TARGET_HEIGHT_M)) {
      targetHeight.set(p.targetHeight);
    } else {
      log.warn('store', 'rehydrate-rejected', { field: 'targetHeight' });
    }
  }

  if (p.cameraProfile !== undefined) {
    if (isValidCameraProfile(p.cameraProfile)) {
      cameraProfile.set(p.cameraProfile);
    } else {
      log.warn('store', 'rehydrate-rejected', { field: 'cameraProfile' });
    }
  }
}

/** Writes the current persistable slice of state; a no-op (never throws) if storage is unavailable. */
function persistPrefs(): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  try {
    const prefs: PersistedPrefs = {
      dateTime: dateTime.get().getTime(),
      observerHeight: observerHeight.get(),
      targetHeight: targetHeight.get(),
      cameraProfile: cameraProfile.get(),
    };
    storage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch (err) {
    // Quota exceeded, storage revoked mid-session, serialization failure — never
    // propagate; persistence is a nice-to-have, not a scene-breaking dependency.
    log.warn('store', 'persist-failed', { message: String(err) });
  }
}

// Rehydrate once at module load (before any consumer reads the atoms), then keep
// localStorage in sync on every subsequent change. `dateTime`'s persistence listener
// fires at most once per animation frame during a scrub (setDateTimeScrubbing already
// coalesces the underlying .set()), so this adds no new write-amplification risk.
rehydratePrefs();
dateTime.listen(persistPrefs);
observerHeight.listen(persistPrefs);
targetHeight.listen(persistPrefs);
cameraProfile.listen(persistPrefs);
