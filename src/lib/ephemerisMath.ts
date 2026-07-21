/**
 * Pure solar-ephemeris math — NO Cesium dependency
 * (Constitution Principle I: TDD-first, pure math, Vitest-covered).
 *
 * Consumed by the (future) scene adapter that orients the directional light /
 * shadow frustum in Cesium. All branching and convention handling lives here so
 * it can be exercised without a WebGL context.
 */
import { getPosition } from 'suncalc';

export type Vec3 = [number, number, number];

const DEG2RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

/** Normalize an angle in radians into [0, 2 PI). */
function mod2pi(x: number): number {
  return ((x % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Horizontal (az/el) -> ENU unit vector.
 *
 * Input convention (the US3 pure-math contract — south-referenced radians):
 *   - azimuth: radians, 0 = south, positive toward west (suncalc 1.x style).
 *   - altitude: radians above the horizon.
 *
 * Mapping (per spec):
 *   E = -cos(alt) * sin(az)
 *   N = -cos(alt) * cos(az)
 *   U =  sin(alt)
 *
 * Sanity anchors:
 *   - solar noon (az=0, alt>0) -> E=0, N<0 (pointing south), U>0 (above horizon).
 *   - due west  (az=PI/2)      -> E<0 (pointing west).
 */
export function positionToENU(azimuth: number, altitude: number): Vec3 {
  const ca = Math.cos(altitude);
  return [-ca * Math.sin(azimuth), -ca * Math.cos(azimuth), Math.sin(altitude)];
}

/**
 * Convert a south-referenced azimuth (0 = south, +west) to a north-referenced
 * compass azimuth (0 = north, +east). Both in radians; output in [0, 2 PI).
 *
 *   northRef = (southRef + PI) mod 2 PI
 *
 * Anchors: south(0)->PI, west(PI/2)->3PI/2, north(PI)->0, east(3PI/2)->PI/2.
 */
export function southToNorthAzimuth(az: number): number {
  return mod2pi(az + Math.PI);
}

/**
 * Rotate an ENU vector at geodetic (lat, lon) — both in RADIANS — into ECEF.
 *
 * Standard rotation: columns of the matrix are the ENU basis vectors expressed
 * in ECEF. With enu = [e, n, u] and φ = lat, λ = lon:
 *
 *   x = -e sin(λ) - n sin(φ) cos(λ) + u cos(φ) cos(λ)
 *   y =  e cos(λ) - n sin(φ) sin(λ) + u cos(φ) sin(λ)
 *   z =  n cos(φ) + u sin(φ)
 *
 * Pure rotation (orthogonal): preserves magnitude; transpose is the inverse.
 * At (lat=0, lon=0) this reduces to the axis swap [e, n, u] -> [u, e, n].
 */
export function enuToECEF(enu: Vec3, lat: number, lon: number): Vec3 {
  const sφ = Math.sin(lat);
  const cφ = Math.cos(lat);
  const sλ = Math.sin(lon);
  const cλ = Math.cos(lon);
  const e = enu[0];
  const n = enu[1];
  const u = enu[2];
  return [
    -e * sλ - n * sφ * cλ + u * cφ * cλ,
    e * cλ - n * sφ * sλ + u * cφ * sλ,
    n * cφ + u * sφ,
  ];
}

/**
 * Sun direction as a unit ECEF vector for a given UTC instant and observer
 * geodetic position.
 *
 * NOTE on suncalc 2.0.1 convention (pinned by tests/unit/ephemerisMath.test.ts):
 *   getPosition returns { azimuth, altitude } with angles in DEGREES and azimuth
 *   north-referenced clockwise (0=N, 90=E, 180=S, 270=W). This differs from the
 *   suncalc 1.x convention (radians, 0=south, +west) that the US3 spec prose
 *   assumed. positionToENU takes south-referenced radians, so this adapter
 *   converts suncalc's (deg, north) output to (rad, south) before delegating:
 *     azSouthRad = degToRad(azNorthDeg - 180)   (subtract 180 deg to re-reference
 *                                                from north to south; handedness
 *                                                stays clockwise => "+west".)
 *
 * `lat` / `lon` are degrees in (matching getPosition's signature); they are
 * converted to radians for the ENU->ECEF rotation.
 */
export function sunDirectionECEF(date: Date, lat: number, lon: number): Vec3 {
  const { azimuth: azNorthDeg, altitude: altDeg } = getPosition(date, lat, lon);
  const latRad = lat * DEG2RAD;
  const lonRad = lon * DEG2RAD;
  const altRad = altDeg * DEG2RAD;
  const azSouthRad = (azNorthDeg - 180) * DEG2RAD;
  return enuToECEF(positionToENU(azSouthRad, altRad), latRad, lonRad);
}
