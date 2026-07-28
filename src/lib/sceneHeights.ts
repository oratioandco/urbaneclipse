/**
 * Resolves the store's human-facing heights into the ellipsoidal heights Cesium needs.
 * Pure, NO Cesium — the ground sampler is injected.
 *
 * THE SEMANTIC CHANGE THIS ENCODES
 * --------------------------------
 * `observerHeight` and `targetHeight` used to be fed to Cesium verbatim as metres
 * above the WGS84 ellipsoid. Since the buildings are baked ~73.5 m up (DHHN2016 ground
 * + the 39.5 m geoid lift applied by scripts/convert_tile.py), that placed the
 * photographer ~72 m underground.
 *
 * They now mean what a photographer means:
 *   observerHeight — EYE HEIGHT above the surface you are standing on
 *   targetHeight   — height up the target ABOVE ITS OWN BASE
 *
 * and this module converts both to ellipsoidal, applying the geoid exactly once.
 *
 * SURFACE vs TERRAIN: the DGM1 sampler is a bare-earth terrain model. On a bridge,
 * rooftop or platform it returns the ground beneath the structure — 8.8 m low on the
 * Lichtenberger Brücke. A curated viewpoint's `surfaceOrthometric` therefore takes
 * precedence over the sample.
 */
import {
  resolveEyeEllipsoidalHeight,
  orthometricToEllipsoidal,
  BERLIN_GROUND_ORTHOMETRIC_FALLBACK,
} from './elevation.js';
import type { Viewpoint } from './viewpoints.js';

/** Injected ground-elevation source; undefined outside coverage. */
export type SampleGround = (lat: number, lon: number) => number | undefined;

export interface ResolvedHeight {
  /** Metres above the WGS84 ellipsoid — what Cesium consumes. */
  ellipsoidalHeight: number;
  /** The surface elevation used, DHHN2016 m. */
  surfaceOrthometric: number;
  /** How that surface was determined — surfaced in the UI so it is never a mystery. */
  surfaceSource: 'viewpoint' | 'terrain' | 'extrapolated' | 'fallback';
}

/**
 * Resolve the surface elevation and say where it came from.
 *
 * ONE RULE FOR THE GROUND. The globe now renders terrain from the same DGM1 grid
 * (src/lib/terrainTile.ts), and outside the grid's ~9.5 x 3.8 km bbox that surface is
 * EDGE-EXTENDED so it leaves coverage continuously. If this resolver instead fell
 * straight to the Berlin mean out there, the two would disagree by as much as 22 m —
 * and since the mean is the LOWER of the two across most of the fringe, the
 * photographer would be placed underground and the preview would render as a plaster
 * whiteout. So an out-of-coverage position uses the same edge-extended value the globe
 * draws, and is reported as 'extrapolated' rather than 'terrain' so the UI never
 * implies DGM1 accuracy the sample does not have.
 */
function resolveSurface(
  lat: number,
  lon: number,
  sampleGround: SampleGround,
  extrapolateGround?: SampleGround,
): { surfaceOrthometric: number; surfaceSource: 'terrain' | 'extrapolated' | 'fallback' } {
  const sampled = sampleGround(lat, lon);
  if (sampled !== undefined) {
    return { surfaceOrthometric: sampled, surfaceSource: 'terrain' };
  }
  const extrapolated = extrapolateGround?.(lat, lon);
  if (extrapolated !== undefined) {
    return { surfaceOrthometric: extrapolated, surfaceSource: 'extrapolated' };
  }
  return {
    surfaceOrthometric: BERLIN_GROUND_ORTHOMETRIC_FALLBACK,
    surfaceSource: 'fallback',
  };
}

/**
 * Resolve the observer's eye to an ellipsoidal height.
 *
 * `surfaceSource` is returned rather than hidden because a 'fallback' result means the
 * heightmap missed and the elevation could be several metres out — the UI should say
 * so rather than present it with false confidence.
 */
export function resolveObserverHeight(
  lat: number,
  lon: number,
  eyeHeight: number,
  sampleGround: SampleGround,
  viewpoint?: Viewpoint,
  extrapolateGround?: SampleGround,
): ResolvedHeight {
  if (viewpoint?.surfaceOrthometric !== undefined) {
    return {
      ellipsoidalHeight: resolveEyeEllipsoidalHeight({
        groundOrthometric: undefined,
        surfaceOrthometric: viewpoint.surfaceOrthometric,
        eyeHeight,
      }),
      surfaceOrthometric: viewpoint.surfaceOrthometric,
      surfaceSource: 'viewpoint',
    };
  }

  const { surfaceOrthometric, surfaceSource } = resolveSurface(
    lat,
    lon,
    sampleGround,
    extrapolateGround,
  );

  return {
    ellipsoidalHeight: resolveEyeEllipsoidalHeight({
      groundOrthometric: undefined,
      surfaceOrthometric,
      eyeHeight,
    }),
    surfaceOrthometric,
    surfaceSource,
  };
}

/**
 * Resolve a height up the target structure to an ellipsoidal height.
 *
 * The target's base sits on the terrain, so this is base + heightAboveBase, with the
 * geoid applied once. `heightAboveBase` is measured from the ground, matching how
 * building heights are quoted (the Fernsehturm is "368 m", not "441 m ellipsoidal").
 */
export function resolveTargetHeight(
  lat: number,
  lon: number,
  heightAboveBase: number,
  sampleGround: SampleGround,
  extrapolateGround?: SampleGround,
): ResolvedHeight {
  if (!Number.isFinite(heightAboveBase) || heightAboveBase < 0) {
    throw new RangeError(`target height above base must be >= 0, received ${heightAboveBase}`);
  }

  const { surfaceOrthometric, surfaceSource } = resolveSurface(
    lat,
    lon,
    sampleGround,
    extrapolateGround,
  );

  return {
    ellipsoidalHeight: orthometricToEllipsoidal(surfaceOrthometric) + heightAboveBase,
    surfaceOrthometric,
    surfaceSource,
  };
}
