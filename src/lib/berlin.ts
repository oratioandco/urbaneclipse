/** Berlin defaults + constants. Pure data, no Cesium. */

export type SourceCRS = 'EPSG:25832' | 'EPSG:31468';
export type HeightDatum = 'DHHN' | 'ellipsoid';

export interface GeoPoint {
  lat: number;
  lon: number;
  heightAboveGround: number;
}

/** Default observer: Lichtenberger Brücke. */
export const OBSERVER_DEFAULT: GeoPoint = {
  lat: 52.5106,
  lon: 13.4652,
  heightAboveGround: 1.5,
};

/** Default target: Berliner Fernsehturm.
 *  ⚠️ VERIFY-LIVE: total height ~368 m; the 210 m default may be an observation-deck
 *  reference — confirm before relying on it for framing/raycast math. */
export const TARGET_DEFAULT: GeoPoint = {
  lat: 52.5208,
  lon: 13.4093,
  heightAboveGround: 210,
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
