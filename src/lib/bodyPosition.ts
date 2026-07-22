/**
 * Adapter from suncalc to the occultation core's BodySample. Pure, NO Cesium.
 *
 * The occultation classifier needs the body's DISTANCE, not just its direction,
 * because apparent size decides full-vs-partial. The moon's perigee-to-apogee swing
 * moves its angular diameter by ~14% (0.490 deg to 0.559 deg), which is far larger than the
 * ~0.05 deg composition tolerance.
 *
 * suncalc's getMoonPosition reports distance directly. getPosition (sun) does NOT, so
 * the Earth-Sun distance is computed here from the standard low-eccentricity series.
 *
 * ANGLE CONVENTION (verified against the installed suncalc 2.0.1 typings): getPosition
 * and getMoonPosition return DEGREES, azimuth north-based clockwise (0=N, 90=E, 180=S,
 * 270=W), altitude refraction-corrected. This differs from the suncalc 1.x convention
 * (radians, 0=south) that the spec prose assumed.
 */
import { getPosition, getMoonPosition } from 'suncalc';
import { SUN_RADIUS_KM, MOON_RADIUS_KM } from './occultation.js';
import type { BodySample } from './areaSolver.js';

export type Body = 'sun' | 'moon';

const AU_KM = 149597870.7;
const RAD = Math.PI / 180;

/** Days since the J2000.0 epoch. */
function daysSinceJ2000(date: Date): number {
  return date.getTime() / 86400000 - 10957.5;
}

/**
 * Earth-Sun distance in km.
 *
 * Standard low-eccentricity series (accurate to ~0.0002 AU, i.e. ~0.0001 deg of angular
 * radius — three orders of magnitude below the tolerance that matters here):
 *   R = 1.00014 - 0.01671 cos g - 0.00014 cos 2g   [AU]
 * with g the Sun's mean anomaly.
 */
export function sunDistanceKm(date: Date): number {
  const n = daysSinceJ2000(date);
  const g = (357.529 + 0.98560028 * n) * RAD;
  const au = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  return au * AU_KM;
}

/**
 * Body direction + apparent size as seen from a ground position.
 *
 * Moon distance is topocentric-ish as suncalc reports it; that is adequate here since
 * a 1 km observer displacement shifts the moon's direction by ~0.00015 deg.
 */
export function sampleBody(body: Body, date: Date, lat: number, lon: number): BodySample {
  if (body === 'moon') {
    const p = getMoonPosition(date, lat, lon);
    return {
      az: p.azimuth,
      alt: p.altitude,
      distanceKm: p.distance,
      radiusKm: MOON_RADIUS_KM,
    };
  }
  const p = getPosition(date, lat, lon);
  return {
    az: p.azimuth,
    alt: p.altitude,
    distanceKm: sunDistanceKm(date),
    radiusKm: SUN_RADIUS_KM,
  };
}
