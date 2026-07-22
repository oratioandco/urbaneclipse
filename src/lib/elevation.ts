/**
 * Vertical-datum core — the single place where the app relates its three height
 * references. Pure math, NO Cesium (Constitution Principle I).
 *
 * THE THREE REFERENCES
 * --------------------
 *   H  orthometric  DHHN2016 normal height ("metres above sea level"). What Berlin
 *                   CityGML LoD2, the DGM1 terrain model, and humans all quote.
 *   h  ellipsoidal  Height above the WGS84 ellipsoid. What Cesium consumes
 *                   (Cartesian3.fromDegrees takes ellipsoidal metres).
 *   eye             Metres above the surface you are physically standing on.
 *
 * The relation is  h = H + N,  where N is the geoid undulation (~39.5 m in Berlin).
 *
 * THE BUG THIS FIXES
 * ------------------
 * scripts/convert_tile.py already lifts building geometry by N, so building bases sit
 * near 73.5 m ellipsoidal. But the app has no terrain provider and
 * src/cesium/lineOfSight.ts assumed "ground ~= 0", so an observerHeight of 1.5 was fed
 * to Cesium as 1.5 m ELLIPSOIDAL — placing the photographer ~72 m below the street,
 * beneath every building base. Occlusion results computed from that geometry were
 * unsound even though the scene looked plausible (observer and target were shifted in
 * the same direction).
 *
 * Consumers should treat `resolveEyeEllipsoidalHeight` as the ONLY way to turn a
 * ground sample plus an eye height into a Cesium height.
 */

/**
 * Berlin geoid undulation (ETRS89/GRS80 geoid height above the ellipsoid), metres.
 *
 * MUST stay numerically identical to `GEOID_UNDULATION_BERLIN` in
 * scripts/convert_tile.py, which bakes it into the building geometry. A guard test in
 * tests/unit/elevation.test.ts reads the Python source and asserts the two match.
 *
 * This is a tile-wide CONSTANT approximation of the GCG2016/EGG97 geoid; the true
 * undulation varies by roughly +/-0.5 m across the Berlin AOI. Replacing it with a
 * sampled grid is a known refinement (research.md VERIFY-LIVE #8).
 */
export const GEOID_UNDULATION_BERLIN = 39.5;

/**
 * Mean ground elevation across the Berlin AOI (DHHN2016 metres), used only when no
 * terrain sample is available. Berlin is broadly 30-60 m; the centre sits near 34 m.
 * A fallback exists so a heightmap miss degrades to "slightly wrong" rather than the
 * catastrophic 72 m error it replaced.
 */
export const BERLIN_GROUND_ORTHOMETRIC_FALLBACK = 34;

/**
 * Plausible orthometric range for the Berlin AOI, metres. Anything outside this is
 * treated as a data-integrity failure rather than a real elevation: a heightmap
 * sampled in the wrong CRS, or one that already had the geoid baked in, would land
 * far outside it. Berlin's true span runs from ~28 m (Spree lowlands) to ~115 m
 * (Mueggelberge), so this is deliberately generous.
 */
const BERLIN_GROUND_MIN = -50;
const BERLIN_GROUND_MAX = 400;

function assertFinite(v: number, what: string): void {
  if (!Number.isFinite(v)) {
    throw new RangeError(`${what} must be a finite number, received ${v}`);
  }
}

/** Orthometric (DHHN2016) -> WGS84 ellipsoidal height. h = H + N. */
export function orthometricToEllipsoidal(
  orthometric: number,
  undulation: number = GEOID_UNDULATION_BERLIN,
): number {
  assertFinite(orthometric, 'orthometric height');
  assertFinite(undulation, 'geoid undulation');
  return orthometric + undulation;
}

/** WGS84 ellipsoidal -> orthometric (DHHN2016) height. H = h - N. */
export function ellipsoidalToOrthometric(
  ellipsoidal: number,
  undulation: number = GEOID_UNDULATION_BERLIN,
): number {
  assertFinite(ellipsoidal, 'ellipsoidal height');
  assertFinite(undulation, 'geoid undulation');
  return ellipsoidal - undulation;
}

export interface EyeHeightInput {
  /**
   * Ground elevation at the location in DHHN2016 metres, as sampled from the DGM1
   * heightmap. `undefined` when no sample is available (outside the AOI, or the
   * heightmap failed to load) — the Berlin mean is substituted.
   */
  groundOrthometric: number | undefined;
  /**
   * Explicit elevation of the surface actually being stood on, DHHN2016 metres.
   * Overrides `groundOrthometric` when present.
   *
   * This exists because a terrain model is, by definition, the TERRAIN: for a
   * viewpoint on a bridge deck (Lichtenberger Bruecke), a rooftop, or a viewing
   * platform, DGM1 returns the ground *below* the structure. For the Lichtenberger
   * Bruecke that is the rail cutting, a ~7-10 m error in the photographer's eye
   * height. Curated viewpoints supply the surveyed deck elevation here.
   */
  surfaceOrthometric?: number;
  /** Metres above that surface — the photographer's eye height. */
  eyeHeight: number;
}

/**
 * Resolve a Cesium-ready ellipsoidal height for the observer's eye.
 *
 *   h = (surfaceOrthometric ?? groundOrthometric ?? fallback) + N + eyeHeight
 *
 * Throws on non-finite input, a negative eye height, or a ground elevation outside
 * the plausible Berlin range — all of which indicate upstream data corruption that
 * must not be allowed to reach the scene silently (FR-013).
 */
export function resolveEyeEllipsoidalHeight(input: EyeHeightInput): number {
  const { groundOrthometric, surfaceOrthometric, eyeHeight } = input;

  assertFinite(eyeHeight, 'eye height');
  if (eyeHeight < 0) {
    throw new RangeError(`eye height must be >= 0, received ${eyeHeight}`);
  }

  let surface: number;
  if (surfaceOrthometric !== undefined) {
    assertFinite(surfaceOrthometric, 'surface elevation');
    surface = surfaceOrthometric;
  } else if (groundOrthometric !== undefined) {
    assertFinite(groundOrthometric, 'ground elevation');
    surface = groundOrthometric;
  } else {
    surface = BERLIN_GROUND_ORTHOMETRIC_FALLBACK;
  }

  if (surface < BERLIN_GROUND_MIN || surface > BERLIN_GROUND_MAX) {
    throw new RangeError(
      `surface elevation ${surface} m is outside the plausible Berlin range ` +
        `[${BERLIN_GROUND_MIN}, ${BERLIN_GROUND_MAX}] — check the heightmap CRS and ` +
        `that the geoid undulation has not already been applied to the samples`,
    );
  }

  return orthometricToEllipsoidal(surface) + eyeHeight;
}
