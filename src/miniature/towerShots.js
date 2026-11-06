/**
 * The rules for a sun or moon shot with the TV tower, as plain maths so they can be tested.
 *
 * The moon is only worth a photograph while it can be seen. Behind the sphere it vanishes
 * unless it looks clearly bigger than the sphere, which needs distance: from 4.4 km it is 1.25
 * times the sphere's width, and the sphere stands in front of the moon as a silhouette. Closer
 * in, the shot is the moon behind the thin antenna, between the sphere's top and the tip.
 *
 * Scene axes: x east, z south, y up, metres, with the tower's foot at x = z = 0.
 */
import { SPHERE_CENTRE_AGL } from '../lib/dailyPaths.ts';

export { SPHERE_CENTRE_AGL };
export const SPHERE_RADIUS_M = 16;
export const SPHERE_TOP_AGL = 229;
export const TIP_AGL = 368;
/** The sun's and the moon's apparent width, degrees, near enough for both. */
export const DISC_DEG = 0.52;
/** Half the disc, plus a hair so a touch reads as a touch. */
export const DISC_RADIUS_DEG = 0.27;
/** Eye height of a standing photographer, metres. */
export const EYE_HEIGHT = 1.6;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** From this far the moon looks 1.25 times the sphere's width: about 4.4 km. */
export const BIG_MOON_M = SPHERE_RADIUS_M / Math.tan(rad(DISC_DEG / 2 / 1.25));

/** How many times wider the disc looks than the sphere from a distance. */
export const discOverSphere = (distanceM) => DISC_DEG / deg(2 * Math.atan(SPHERE_RADIUS_M / distanceM));

/** Keep only the stretches of a moon path far enough out for the moon to show round the sphere. */
export function visibleMoon(path) {
  if (path.body !== 'moon') return path;
  const segments = [];
  for (const segment of path.segments) {
    let run = [];
    for (const p of segment) {
      if (p.distanceM >= BIG_MOON_M) run.push(p);
      else if (run.length) {
        segments.push(run);
        run = [];
      }
    }
    if (run.length) segments.push(run);
  }
  return { ...path, segments };
}

/**
 * How far from the tower, along the ground, a body at this height sits behind the antenna:
 * from where it clears the sphere's top out to where it reaches the tip, capped at 9 km.
 */
export function antennaRange(bodyAlt) {
  const slope = Math.tan(rad(bodyAlt));
  const fromM = (SPHERE_TOP_AGL - EYE_HEIGHT) / slope;
  const toM = Math.min(9000, (TIP_AGL - EYE_HEIGHT) / slope);
  return fromM < toM ? { fromM, toM } : null;
}

/** A compass direction and a height above the horizon as a unit vector in scene axes. */
export function direction(az, alt) {
  const a = rad(az);
  const h = rad(alt);
  return [Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h)];
}

/** The sphere's apparent radius from an eye point, degrees. */
export function sphereRadiusDeg(eye, base) {
  const d = Math.hypot(eye.x, base + SPHERE_CENTRE_AGL - eye.y, eye.z);
  return deg(Math.asin(Math.min(1, SPHERE_RADIUS_M / d)));
}

/**
 * Where a body stands against the tower, seen from an eye point.
 *
 * @param eye { x, y, z } the camera, scene metres (y is height above the scene's zero)
 * @param base ground height at the tower's foot
 * @param body { az, alt } degrees
 * @returns state: 'hidden' (behind a bigger sphere), 'ring' (sphere inside the disc),
 *   'edge' (the outlines overlap), 'antenna', 'shaft' or 'near'; sepDeg from the sphere's
 *   centre; signedOff, degrees across (positive: the body is right of the tower, so step left);
 *   rise, degrees above the sphere's centre.
 */
export function bodyAgainstTower(eye, base, body) {
  const toSphere = [-eye.x, base + SPHERE_CENTRE_AGL - eye.y, -eye.z];
  const length = Math.hypot(...toSphere);
  const radiusDeg = deg(Math.asin(Math.min(1, SPHERE_RADIUS_M / length)));
  const d = direction(body.az, body.alt);
  const dot = (d[0] * toSphere[0] + d[1] * toSphere[1] + d[2] * toSphere[2]) / length;
  const sepDeg = deg(Math.acos(Math.min(1, Math.max(-1, dot))));
  const touching = sepDeg < radiusDeg + DISC_RADIUS_DEG;
  // Inside the disc's outline: the sphere in front of a bigger disc, or the disc behind a bigger sphere.
  const inside = sepDeg < Math.abs(radiusDeg - DISC_RADIUS_DEG);
  const flat = Math.hypot(eye.x, eye.z);
  const towerAz = (deg(Math.atan2(-eye.x, eye.z)) + 360) % 360;
  const signedOff = (((((body.az - towerAz) % 360) + 540) % 360) - 180) * Math.cos(rad(body.alt));
  const off = Math.abs(signedOff);
  const angleTo = (h) => deg(Math.atan2(base + h - eye.y, flat));
  let state = 'near';
  if (off < DISC_RADIUS_DEG + 0.1) {
    if (body.alt > angleTo(SPHERE_TOP_AGL + 8) && body.alt < angleTo(TIP_AGL) + DISC_RADIUS_DEG) state = 'antenna';
    else if (body.alt > angleTo(0) && body.alt < angleTo(SPHERE_CENTRE_AGL - SPHERE_RADIUS_M - 4)) state = 'shaft';
  }
  if (inside && radiusDeg >= DISC_RADIUS_DEG) state = 'hidden';
  else if (inside) state = 'ring';
  else if (touching) state = 'edge';
  const rise = body.alt - angleTo(SPHERE_CENTRE_AGL);
  return { radiusDeg, sepDeg, state, signedOff, rise, flat, touching };
}
