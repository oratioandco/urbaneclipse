/**
 * Browser-only line-of-sight occlusion engine — wraps the global Cesium namespace
 * (window.Cesium) and bridges to the pure {@link classifyOcclusion} classifier.
 *
 * Constitution Principle I: the pure math lives in src/lib/occlusionMath.ts and is
 * Vitest-covered without a WebGL context. This module is the thin Cesium adapter —
 * it is ONLY imported from the `client:only` CesiumViewer island, so importing the
 * cesium ESM here would still be safe, but we follow the global-Cesium pattern used
 * by CesiumViewer.tsx so Vite never loads cesium ESM at all (Constitution Principle IV).
 *
 * Verified Cesium 1.143 runtime signatures (read from
 * node_modules/cesium/Build/CesiumUnminified/index.cjs):
 *   - `Scene.prototype.drillPickFromRay(ray, limit?, objectsToExclude?, width?)`
 *     Returns `Array<{object, position, exclude}>`. `object` is the picked primitive
 *     (Cesium3DTileFeature / tile content / globe primitive / ...); `position` is a
 *     Cartesian3 in world coordinates. NOTE: this method is NOT declared in
 *     Cesium.d.ts but IS present on the runtime prototype (search the unminified
 *     build, line ~230510). Throws DeveloperError if scene.mode !== SCENE3D.
 *   - `Cesium.Cartesian3.fromDegrees(longitude, latitude, height?, ellipsoid?, result?)`
 *     (height is ellipsoidal metres). The globe DOES carry terrain now — the DGM1 grid,
 *     via src/cesium/groundTerrain.ts — so Berlin's ground is ~73-80 m ellipsoidal, not
 *     0. Heights reaching here have already been through src/lib/sceneHeights.ts, which
 *     applies the geoid; see the globe-hiding note in computeOcclusion for why the
 *     terrain is nevertheless kept out of the pick.
 *   - `Cesium.Ray(origin?, direction?)` with `.origin` and `.direction` (unit).
 *   - `Cesium.Cartesian3.distance(left, right)`.
 *   - `Cesium.Cartesian3.subtract(left, right, result)`; `normalize(cartesian, result)`.
 *   - `Cesium.defined(x)` for null/undef check (used by Cesium internally; safe).
 *   - `viewer.entities.add({ polyline: { positions, width, material, clampToGround } })`
 *     returns a Cesium.Entity whose `.polyline.positions` / `.polyline.material` /
 *     `.polyline.width` can be reassigned to update in place.
 */
import type * as CesiumType from 'cesium';
import {
  classifyOcclusion,
  type Intersection,
  type OcclusionResult,
} from '../lib/occlusionMath.js';
import { classifyPick } from '../lib/pickKind.js';

/**
 * Read the Cesium UMD global the same way CesiumViewer.tsx does. `import type` is
 * erased at build, so this introduces NO runtime cesium ESM dependency.
 */
const Cesium = (window as unknown as { Cesium: typeof CesiumType }).Cesium;

/** Geodetic observer/target spec (height is metres above the ellipsoid). */
export interface LatLonHeight {
  lat: number;
  lon: number;
  height: number;
}

export type OcclusionState = OcclusionResult | 'unknown';

export interface ComputeOcclusionResult {
  state: OcclusionState;
  /** Kind of the first occluder Cesium reported (for diagnostics). Undefined if none. */
  occluderKind?: 'building' | 'terrain' | 'other';
}

/**
 * Upper bound on drill-pick hits. Picks are ordered nearest-first and only the closest
 * occluder decides the verdict, so this bounds work without changing the result.
 */
const MAX_DRILL_PICKS = 32;

/** Polyline entity created/updated by {@link drawLineOfSight}. */
type PolylineEntity = CesiumType.Entity;

/**
 * Compute line-of-sight occlusion from observer toward target by ray-picking the
 * scene. PURE with respect to React state — reads only its args + the live scene.
 *
 * Returns `state: 'unknown'` while the tileset is still streaming content
 * (`tileset.tilesLoaded === false`) so the caller can avoid committing a misleading
 * 'clear' result during initial load.
 *
 * @param viewer   Live Cesium Viewer (must be SCENE3D — Cesium's ray-pick throws otherwise).
 * @param observer Observer geodetic position (height metres above ellipsoid).
 * @param target   Target geodetic position (height metres above ellipsoid).
 */
export function computeOcclusion(
  viewer: CesiumType.Viewer,
  observer: LatLonHeight,
  target: LatLonHeight,
): ComputeOcclusionResult {
  // Pull the tileset back out of the diagnostic hook (set by CesiumViewer after
  // tileset readiness). If the viewer-level hook isn't populated yet we can still
  // run — but we report 'unknown' since we can't gate on tilesLoaded.
  const w = window as unknown as {
    __cesium?: { tileset?: CesiumType.Cesium3DTileset };
  };
  const tileset = w.__cesium?.tileset;
  if (tileset && !tileset.tilesLoaded) {
    return { state: 'unknown' };
  }

  // Build observer/target Cartesian3. fromDegrees takes (LON, lat, height).
  const observerCart = Cesium.Cartesian3.fromDegrees(
    observer.lon,
    observer.lat,
    observer.height,
  );
  const targetCart = Cesium.Cartesian3.fromDegrees(
    target.lon,
    target.lat,
    target.height,
  );

  // Ray direction = normalize(target − observer).
  const direction = Cesium.Cartesian3.subtract(
    targetCart,
    observerCart,
    new Cesium.Cartesian3(),
  );
  Cesium.Cartesian3.normalize(direction, direction);

  const ray = new Cesium.Ray(observerCart, direction);

  // drillPickFromRay returns Array<{object, position, exclude}>. It throws if the
  // scene is not 3D — wrap defensively so a transient mode switch can't crash the
  // island (the caller treats 'unknown' the same as 'not yet computed').
  let picks: Array<{ object: unknown; position: CesiumType.Cartesian3 }> = [];
  // HIDE THE GLOBE FOR THE PICK.
  //
  // The globe now carries real DGM1 terrain (src/cesium/groundTerrain.ts) instead of
  // sitting 77 m below the city as a bare ellipsoid, so the observer's ray can reach it.
  // A globe hit comes back as `{ object: undefined, position }` — verified live — and
  // Cesium's drill treats a positioned hit with no object as COMPLETE and stops there
  // (addDrillPickedResults). Anything behind the ground would therefore never be
  // reported, silently truncating the sightline.
  //
  // `objectsToExclude` cannot help: Cesium's isExcluded() returns false immediately when
  // the picked object is undefined. Hiding the globe is the one lever that works.
  // Globe.render() returns early when show is false and this offscreen pick pass is
  // never composited, so nothing flickers on screen.
  //
  // The terrain is not a sightline occluder in this app anyway: the photographer stands
  // ON it, and every curated viewpoint looks over it. Excluding it keeps the terrain
  // upgrade a strict no-op for occlusion.
  const globe = viewer.scene.globe;
  const globeWasShown = globe.show;
  try {
    globe.show = false;
    picks = (viewer.scene as unknown as {
      drillPickFromRay: (
        ray: CesiumType.Ray,
        limit?: number,
        objectsToExclude?: unknown[],
        width?: number,
      ) => Array<{ object: unknown; position: CesiumType.Cartesian3 }>;
    // Bounded: drill results come back NEAREST-FIRST, and classifyOcclusion only ever
    // needs the closest occluder, so a cap cannot change the verdict — it just stops a
    // horizontal ray through dense city from enumerating the whole block. Unbounded was
    // survivable only while the terrain hit truncated the drill early.
    }).drillPickFromRay(ray, MAX_DRILL_PICKS);
  } catch (e) {
    // Non-3D scene or pick failure — can't classify. Don't crash the React tree.
    return { state: 'unknown' };
  } finally {
    globe.show = globeWasShown;
  }

  // Map each pick to the Intersection shape classifyOcclusion expects.
  const intersections: Intersection[] = [];
  let firstOccluderKind: Intersection['kind'] | undefined;
  for (const p of picks) {
    if (!p || !p.position) continue;
    const kind = classifyPick(p.object);
    const distance = Cesium.Cartesian3.distance(observerCart, p.position);
    intersections.push({ distance, kind });
    if (firstOccluderKind === undefined && (kind === 'building' || kind === 'terrain')) {
      firstOccluderKind = kind;
    }
  }

  // classifyOcclusion takes (observer, target, intersections) as Vec3 tuples.
  const state = classifyOcclusion(
    cartesianToVec3(observerCart),
    cartesianToVec3(targetCart),
    intersections,
  );

  return { state, occluderKind: firstOccluderKind };
}

function cartesianToVec3(c: CesiumType.Cartesian3): [number, number, number] {
  return [c.x, c.y, c.z];
}

/**
 * Create (or update) the observer→target line-of-sight polyline entity on the
 * viewer's entity collection. Returns the entity so the caller can keep updating
 * its positions/material each recompute without leaking entities.
 *
 * Colour: RED for occluded/marginal, GREEN for clear. Same-point/unknown keeps
 * whatever colour was last set (the caller usually hides the line in those cases
 * via `entity.show = false`).
 */
export function drawLineOfSight(
  viewer: CesiumType.Viewer,
  observer: LatLonHeight,
  target: LatLonHeight,
  state: OcclusionState,
  existing?: PolylineEntity,
): PolylineEntity {
  const positions = [
    Cesium.Cartesian3.fromDegrees(observer.lon, observer.lat, observer.height),
    Cesium.Cartesian3.fromDegrees(target.lon, target.lat, target.height),
  ];

  const color =
    state === 'occluded' || state === 'marginal'
      ? Cesium.Color.RED
      : state === 'clear'
        ? Cesium.Color.GREEN
        : Cesium.Color.YELLOW;

  if (existing) {
    // Mutate in place — Cesium's ConstantProperty wrapping is what `entities.add`
    // did internally on first insert; reuse the same pattern for live updates.
    existing.polyline!.positions = new Cesium.ConstantProperty(positions) as never;
    existing.polyline!.material = new Cesium.ColorMaterialProperty(color) as never;
    existing.show = state !== 'same-point' && state !== 'unknown';
    return existing;
  }

  return viewer.entities.add({
    polyline: {
      positions: new Cesium.ConstantProperty(positions) as never,
      width: new Cesium.ConstantProperty(2) as never,
      material: new Cesium.ColorMaterialProperty(color) as never,
      clampToGround: new Cesium.ConstantProperty(false) as never,
    },
  }) as PolylineEntity;
}
