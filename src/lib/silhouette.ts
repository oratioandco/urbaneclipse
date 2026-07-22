/**
 * Silhouette projection — turns a 3D landmark into the angular outline that
 * src/lib/occultation.ts classifies against. Pure math, NO Cesium.
 *
 * Given an observer and a solid-of-revolution landmark, this produces the polygon the
 * structure occupies on the sky, in a local tangent-plane angular frame (degrees)
 * centred on a caller-supplied reference direction — normally the sun/moon disc.
 *
 * GEOMETRY NOTES THAT MATTER AT THIS PRECISION
 * --------------------------------------------
 * Working range is ~4 km and the tolerance is ~0.05 deg, where 1 deg = 69 m. Two effects
 * are NOT negligible and are handled properly by working in the observer's local ENU
 * frame via full geodetic->ECEF->ENU transforms rather than a flat-earth approximation:
 *
 *   - Earth curvature: the drop over 3953 m is d^2/(2R) = 1.23 m = 0.018 deg. That is a
 *     third of the tolerance budget — far too large to ignore for altitude angles.
 *   - Geodetic vs geocentric latitude: ignoring the ellipsoid's flattening would
 *     introduce errors of a similar order.
 *
 * Atmospheric refraction is deliberately NOT applied here. It bends the light from the
 * celestial body, not the building, so it belongs with the ephemeris (suncalc already
 * refraction-corrects its altitudes) — applying it to terrestrial geometry too would
 * double-count it.
 *
 * For a solid of revolution the silhouette limb at height h sits at horizontal angular
 * half-width asin(r(h)/d). The outline is therefore traced up one side and down the
 * other.
 */
import { orthometricToEllipsoidal } from './elevation.js';
import { radiusAtHeight, landmarkHeight, type RevolutionLandmark } from './landmarks.js';
import type { AngularPoint } from './occultation.js';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

// WGS84
const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

export interface ObserverGeodetic {
  lat: number;
  lon: number;
  /** Eye height, metres above the WGS84 ellipsoid (see src/lib/elevation.ts). */
  ellipsoidalHeight: number;
}

/** Direction in the observer's horizontal frame. */
export interface AzAlt {
  /** Degrees clockwise from north. */
  az: number;
  /** Degrees above the horizon. */
  alt: number;
}

type Vec3 = [number, number, number];

/** Geodetic (deg, deg, ellipsoidal m) -> ECEF metres. */
export function geodeticToECEF(lat: number, lon: number, h: number): Vec3 {
  const sφ = Math.sin(lat * RAD);
  const cφ = Math.cos(lat * RAD);
  const sλ = Math.sin(lon * RAD);
  const cλ = Math.cos(lon * RAD);
  const N = A / Math.sqrt(1 - E2 * sφ * sφ);
  return [(N + h) * cφ * cλ, (N + h) * cφ * sλ, (N * (1 - E2) + h) * sφ];
}

/** ECEF delta -> local ENU at the given geodetic origin. */
export function ecefToENU(d: Vec3, originLat: number, originLon: number): Vec3 {
  const sφ = Math.sin(originLat * RAD);
  const cφ = Math.cos(originLat * RAD);
  const sλ = Math.sin(originLon * RAD);
  const cλ = Math.cos(originLon * RAD);
  return [
    -sλ * d[0] + cλ * d[1],
    -sφ * cλ * d[0] - sφ * sλ * d[1] + cφ * d[2],
    cφ * cλ * d[0] + cφ * sλ * d[1] + sφ * d[2],
  ];
}

/** Az/alt of a target as seen from an observer, both geodetic. Exact (ellipsoidal). */
export function azAltTo(
  observer: ObserverGeodetic,
  targetLat: number,
  targetLon: number,
  targetEllipsoidalHeight: number,
): AzAlt & { rangeM: number } {
  const o = geodeticToECEF(observer.lat, observer.lon, observer.ellipsoidalHeight);
  const t = geodeticToECEF(targetLat, targetLon, targetEllipsoidalHeight);
  const enu = ecefToENU([t[0] - o[0], t[1] - o[1], t[2] - o[2]], observer.lat, observer.lon);
  const [e, n, u] = enu;
  const horiz = Math.hypot(e, n);
  return {
    az: ((Math.atan2(e, n) * DEG) + 360) % 360,
    alt: Math.atan2(u, horiz) * DEG,
    rangeM: Math.hypot(horiz, u),
  };
}

/**
 * Project an az/alt direction into a local tangent-plane angular frame centred on
 * `reference`, in degrees.
 *
 * Uses a gnomonic (tangent-plane) projection about the reference direction, so the
 * `x` axis is the local great-circle east-ish direction and `y` is toward increasing
 * altitude. Azimuth differences are compressed by cos(alt), which is essential: near
 * the zenith a degree of azimuth is far less than a degree on the sky, and ignoring
 * it would badly distort high-sun geometry.
 */
export function toTangentPlane(dir: AzAlt, reference: AzAlt): AngularPoint {
  const a0 = reference.az * RAD;
  const h0 = reference.alt * RAD;
  const a = dir.az * RAD;
  const h = dir.alt * RAD;

  const dA = a - a0;
  const cosC = Math.sin(h0) * Math.sin(h) + Math.cos(h0) * Math.cos(h) * Math.cos(dA);

  // Guard the antipode, where the gnomonic projection diverges.
  if (cosC <= 1e-9) {
    return { x: Infinity, y: Infinity };
  }

  return {
    x: (Math.cos(h) * Math.sin(dA) * DEG) / cosC,
    y: ((Math.cos(h0) * Math.sin(h) - Math.sin(h0) * Math.cos(h) * Math.cos(dA)) * DEG) / cosC,
  };
}

/**
 * Build the angular silhouette polygon of a solid-of-revolution landmark.
 *
 * @param observer  Observer position (ellipsoidal eye height).
 * @param landmark  The parametric landmark.
 * @param reference Direction the tangent-plane frame is centred on (the disc centre).
 * @param steps     Vertical sampling resolution. The default resolves the sphere to
 *                  well under the composition tolerance.
 */
export function buildSilhouette(
  observer: ObserverGeodetic,
  landmark: RevolutionLandmark,
  reference: AzAlt,
  steps = 96,
): AngularPoint[] {
  const total = landmarkHeight(landmark);
  if (total <= 0) return [];

  const baseEllipsoidal = orthometricToEllipsoidal(landmark.baseOrthometric);

  const left: AngularPoint[] = [];
  const right: AngularPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const hAgl = (total * i) / steps;
    const axis = azAltTo(observer, landmark.lat, landmark.lon, baseEllipsoidal + hAgl);
    const r = radiusAtHeight(landmark, hAgl);

    // Horizontal angular half-width of the limb at this height.
    const ratio = Math.min(1, r / Math.max(axis.rangeM, 1e-9));
    const halfWidthDeg = Math.asin(ratio) * DEG;

    // Offset in azimuth. Divide by cos(alt) so that after the tangent-plane
    // projection's cos(alt) compression the on-sky width is correct.
    const cosAlt = Math.max(Math.cos(axis.alt * RAD), 1e-9);
    const dAz = halfWidthDeg / cosAlt;

    left.push(toTangentPlane({ az: axis.az - dAz, alt: axis.alt }, reference));
    right.push(toTangentPlane({ az: axis.az + dAz, alt: axis.alt }, reference));
  }

  // Trace up the left limb and back down the right to close the outline.
  const polygon = [...left, ...right.reverse()];
  return polygon.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}
