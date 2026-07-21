/**
 * Pure scene math — NO Cesium dependency (Constitution Principle I: TDD-first, Vitest).
 * Consumed by the WebGL-bound adapter in src/cesium/scene.ts.
 */

/** Great-circle initial bearing from (lat1,lon1) to (lat2,lon2).
 *  Degrees in, radians out. Convention: 0 = North, clockwise positive (matches Cesium heading). */
export function greatCircleBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lon2 - lon1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const bearing = Math.atan2(y, x);
  return (bearing + 2 * Math.PI) % (2 * Math.PI);
}

/** Cesium.Viewer constructor options: every default UI widget disabled (plaster-void canvas). */
export function viewerOptions() {
  return {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    navigationHelpButton: false,
  } as const;
}

/** Telephoto PerspectiveFrustum params from a field of view (degrees) + aspect ratio. */
export function telephotoFrustum(
  fovDeg: number,
  aspectRatio: number,
): { fov: number; aspectRatio: number } {
  return { fov: (fovDeg * Math.PI) / 180, aspectRatio };
}
