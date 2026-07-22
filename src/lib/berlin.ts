/** Berlin defaults + constants. Pure data, no Cesium. */

export type SourceCRS = 'EPSG:25832' | 'EPSG:31468';
export type HeightDatum = 'DHHN' | 'ellipsoid';

export interface GeoPoint {
  lat: number;
  lon: number;
  heightAboveGround: number;
}

/** Default observer: Lichtenberger Brücke (see src/lib/viewpoints.ts for provenance).
 *
 *  COORDINATE CORRECTED. The previous value (52.5106, 13.4652) is not this bridge —
 *  it is a street-level point in the Boxhagener Kiez ~2.3 km west, with no bridge
 *  within 250 m and identical DGM1/DOM1 readings (nothing elevated there).
 *
 *  `heightAboveGround` is eye height above the BRIDGE DECK (48.2 m DHHN2016), not
 *  above the terrain 8.8 m below it. Use resolveEyeEllipsoidalHeight() with the
 *  viewpoint's surfaceOrthometric to obtain the ellipsoidal height Cesium needs —
 *  never pass this straight to Cartesian3.fromDegrees. */
export const OBSERVER_DEFAULT: GeoPoint = {
  lat: 52.5113,
  lon: 13.4988,
  heightAboveGround: 1.5,
};

/** Default target: Berliner Fernsehturm.
 *
 *  RESOLVED (was VERIFY-LIVE): total height is 368.03 m above ground, NOT 210 m —
 *  210 m is near the observation deck. The old value put the target ~231 m too low,
 *  which at telephoto range is ~4.6 lunar diameters of aiming error.
 *
 *  For silhouette work use the parametric model in src/lib/landmarks.ts instead: the
 *  LoD2 tile geometry omits the sphere, the shaft taper and the entire antenna. */
export const TARGET_DEFAULT: GeoPoint = {
  lat: 52.520815,
  lon: 13.409419,
  heightAboveGround: 368.03,
};

/** Rough bounds for v1 (Berlin Mitte + Lichtenberg). */
export const BERLIN_BOUNDS = {
  minLat: 52.3,
  maxLat: 52.7,
  minLon: 13.1,
  maxLon: 13.8,
} as const;

/** Plaster-void globe base color. */
export const VOID_COLOR = '#f4f4f4';
