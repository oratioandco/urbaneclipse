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
import { profileRadius } from '../lib/landmarks.ts';

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

/**
 * Where a body stands against a solid of revolution — a radius profile standing on `base` at
 * (x, z) — seen from an eye point. The tower's states, minus the antenna and the shaft, which
 * only a mast has: 'hidden', 'ring', 'edge' or 'near'; plus ringRatio, how many times wider
 * the disc looks than the solid at the crossing (the scanner drops moon rings below 1.25).
 * Sight-line maths in metres at the axis crossing, rather than angles: the ray from the eye
 * along the body's direction is checked where it passes closest to the axis.
 *
 * @param profile (height above base, radius) pairs, as in src/lib/landmarks.ts
 * @param x, z the axis, scene metres
 * @param topAGL the solid's top height above its base, degrees of freedom only for the gates
 */
export function bodyAgainstProfile(profile, x, z, topAGL, eye, base, body) {
  const dx = x - eye.x;
  const dz = z - eye.z;
  const flat = Math.hypot(dx, dz);
  const d = direction(body.az, body.alt);
  const targetAz = (deg(Math.atan2(dx, -dz)) + 360) % 360;
  const signedOff = (((((body.az - targetAz) % 360) + 540) % 360) - 180) * Math.cos(rad(body.alt));
  const near = { state: 'near', sepDeg: 90, signedOff, rise: body.alt };
  // Closest approach of the ray's horizontal track to the axis: s along the ray, then the
  // sideways gap there.
  const across = d[0] * d[0] + d[2] * d[2];
  if (across < 1e-9 || flat < 1) return near;
  const s = (dx * d[0] + dz * d[2]) / across;
  if (s <= 0) return near;
  // Where the ray passes the axis, and how wide the disc is there.
  const perp = Math.hypot(eye.x + s * d[0] - x, eye.z + s * d[2] - z);
  const crossY = eye.y + s * d[1];
  const h = crossY - base;
  const discR = Math.tan(rad(DISC_DEG / 2)) * s;
  const sepDeg = deg(Math.atan2(perp, s));
  if (h - discR > topAGL || h < -discR) return { ...near, rise: body.alt - deg(Math.atan2(base - eye.y, flat)) };
  // The solid's reach across the disc's height, sampled finely enough for a taper to be
  // caught: hidden wants the solid covering the disc everywhere; ring wants the solid's
  // silhouette inside the disc's circle, as with the tower's sphere — a shape that runs on
  // past the disc, like a column, crosses at the edge instead.
  let coversDisc = h - discR >= 0 && h + discR <= topAGL;
  let fitsInDisc = true;
  let rMax = 0;
  const sample = (hh) => {
    if (hh > topAGL) return; // nothing stands there to hide or fit
    const r = profileRadius(profile, hh);
    rMax = Math.max(rMax, r);
    const dy = hh - h;
    if (Math.abs(dy) > discR) return;
    if (r < perp + Math.sqrt(Math.max(0, discR * discR - dy * dy))) coversDisc = false;
    if (Math.hypot(dy, r) + perp > discR) fitsInDisc = false;
  };
  // The rim heights first: a solid still standing where the disc's circle passes, like a
  // column crossing at the top and bottom of the disc, can never fit inside it — a mid-span
  // grid can miss exactly those corners.
  sample(h - discR);
  sample(h + discR);
  const from = Math.max(0, h - discR * 1.05);
  const to = Math.min(topAGL, h + discR * 1.05);
  const steps = 16;
  for (let i = 0; i <= steps; i++) sample(from + ((to - from) * i) / steps);
  let state = 'near';
  if (coversDisc) state = 'hidden';
  else if (fitsInDisc && rMax > 0) state = 'ring';
  else if (perp <= rMax + discR) state = 'edge';
  const ringRatio = DISC_DEG / deg(2 * Math.atan(Math.max(rMax, 0.5) / s));
  return { state, sepDeg, signedOff, ringRatio, dist: s, rise: body.alt };
}

/**
 * What is worth a photograph, per body: never the moon hidden behind the sphere or the shaft, and
 * never the sun behind the antenna. Its disc is about ten times the mast's width, so that is a thin
 * line across a glare that needs a solar filter; the sphere is the shot. The moon on the antenna
 * is a classic.
 */
const WANTED = { sun: ['hidden', 'ring', 'edge'], moon: ['ring', 'edge', 'antenna'] };
/** Which minute of a pass to show: fullest cover first. */
const RANK = { hidden: 4, ring: 4, edge: 3, antenna: 2 };
const MINUTE = 60_000;
const COARSE = 10 * MINUTE;

/**
 * Every pass of the sun and moon behind any of the targets from one spot, soonest first, by
 * the same rules as the eye-level line: scan every 10 minutes and look closer, minute by
 * minute, only when a body is near a target. One target owns the tower's rules
 * (bodyAgainstTower); any solid of revolution can join through bodyAgainstProfile.
 *
 * @param targets [{ id, x, z, topAGL, wanted: { sun: states, moon: states }, rank: { state: score },
 *   offState (scored by |signedOff|, not sepDeg), stateAt(eye, base, body) → state }] in scene
 *   metres; outputs carry the target's id.
 * @param bodyAt (body, t) => { az, alt } seen from the spot
 * @param moonLit t => lit fraction; moon passes below `minMoonLit` are left out
 * @returns [{ target, body, start, end, peak, state, az, alt }]
 */
export function findShots({ eye, base, start, end, bodyAt, moonLit, minMoonLit = 0.25, targets }) {
  const shots = [];
  for (const target of targets) {
    const flat = Math.hypot(target.x - eye.x, target.z - eye.z);
    const targetAz = (deg(Math.atan2(target.x - eye.x, -(target.z - eye.z))) + 360) % 360;
    const angleTo = (h) => deg(Math.atan2(base + h - eye.y, flat));
    const low = Math.max(0, angleTo(0)) - 3;
    const high = angleTo(target.topAGL) + 3;
    for (const body of ['sun', 'moon']) {
      const wanted = target.wanted[body];
      let current = null;
      let refinedTo = -Infinity;
      const close = () => {
        if (current) shots.push(current);
        current = null;
      };
      for (let t = start; t < end; t += COARSE) {
        const p = bodyAt(body, t);
        const off = Math.abs(((((p.az - targetAz) % 360) + 540) % 360) - 180) * Math.cos(rad(p.alt));
        if (off > 4 || p.alt < low || p.alt > high) continue;
        for (let u = Math.max(t - COARSE, refinedTo + MINUTE, start); u <= Math.min(t + COARSE, end); u += MINUTE) {
          refinedTo = u;
          const q = bodyAt(body, u);
          if (q.alt <= 0 || (body === 'moon' && moonLit(u) < minMoonLit)) continue;
          const r = target.stateAt(eye, base, q);
          // A ring of moon round the solid only reads as a big moon from far enough out.
          if (!wanted.includes(r.state) || (body === 'moon' && r.state === 'ring' && (r.ringRatio ?? 1) < 1.25)) continue;
          const score = target.rank[r.state] - (target.offState === r.state ? Math.abs(r.signedOff) : r.sepDeg) / 10;
          if (current && u - current.end <= 2 * MINUTE) {
            current.end = u;
            if (score > current.score) Object.assign(current, { peak: u, state: r.state, az: q.az, alt: q.alt, score });
          } else {
            close();
            current = { target: target.id, body, start: u, end: u, peak: u, state: r.state, az: q.az, alt: q.alt, score };
          }
        }
        if (current && refinedTo - current.end > 2 * MINUTE) close();
      }
      close();
    }
  }
  // The moon touches the solid's edge going in and again coming out: one shot, not two.
  const merged = [];
  for (const shot of shots.sort((a, b) => a.start - b.start)) {
    const last = merged.findLast((m) => m.target === shot.target && m.body === shot.body);
    if (last && shot.start - last.end <= 15 * MINUTE) {
      last.end = shot.end;
      if (shot.score > last.score) Object.assign(last, { peak: shot.peak, state: shot.state, az: shot.az, alt: shot.alt, score: shot.score });
    } else merged.push(shot);
  }
  return merged.map(({ score, ...shot }) => shot).sort((a, b) => a.peak - b.peak);
}

/** The tower's rules as one target for findShots, so the year search can sweep them all. */
export const TOWER_TARGET = {
  id: 'fernsehturm',
  x: 0,
  z: 0,
  topAGL: TIP_AGL,
  wanted: WANTED,
  rank: RANK,
  offState: 'antenna',
  stateAt: (eye, base, body) => {
    const r = bodyAgainstTower(eye, base, body);
    if (r.state === 'ring') r.ringRatio = discOverSphere(Math.hypot(eye.x, eye.z));
    return r;
  },
};

/**
 * Every pass of the sun and moon behind the tower from one spot over a stretch of time, soonest
 * first: the sun behind or round the sphere, or at its edge; the moon at the sphere's edge,
 * behind the antenna, or round the sphere only from far enough out for a big moon.
 */
export function findTowerShots({ eye, base, start, end, bodyAt, moonLit, minMoonLit = 0.25 }) {
  return findShots({ eye, base, start, end, bodyAt, moonLit, minMoonLit, targets: [TOWER_TARGET] });
}
