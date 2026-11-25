/**
 * How much of a shot is seen from an eye point: of the body's disc, and of the part of the
 * landmark it stands behind (the sphere, the stretch of mast, the figure). One ray to the
 * disc's centre said "clear" while the moon stood half behind a roof (22 April 2027, 5:00, the
 * antenna) or the frame was walled by trees (11 May 2027, the sphere).
 *
 *   shotRays(row, eye, base, t)       the rays of a row's shot: five to the disc (centre and
 *                                     rim), and five to the target's outline
 *   shotShare(row, eye, base, t)      the share of each that buildings hide, and that the tree
 *                                     register's trees hide: { disc, target } x { buildings, trees }
 *   shotClear(share)                  whether buildings leave the shot: at most one ray in five
 *                                     of the disc and of the target hidden, the centre not
 *   treesClear(share)                 the same for trees
 *
 * Buildings are the scene's own, in whatever detail is loaded (load full detail first:
 * sightlines.js `fineAlong`), and the hand-built landmarks (landmarks.js), which are no tiles. Trees are the tree register's (trees.js): each a crown of its
 * listed height and width where the register puts it, in full leaf whatever the date. Dense
 * woods inside parks are not in the register, so "no trees" here is "none the register has".
 */
import * as THREE from 'three';
import { sampleBody } from '../lib/bodyPosition.ts';
import { FIGURE_TARGETS } from '../lib/landmarkStands.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { sceneFromLatLon } from './eye.js';
import { landmarks } from './landmarks.js';
import { clearView } from './sightlines.js';
import { app } from './state.js';
import { DISC_DEG, SPHERE_CENTRE_AGL, SPHERE_RADIUS_M } from './towerShots.js';
import { treeData } from './trees.js';

const rad = (d) => (d * Math.PI) / 180;
const direction = (az, alt) => new THREE.Vector3(Math.sin(rad(az)) * Math.cos(rad(alt)), Math.sin(rad(alt)), -Math.cos(rad(az)) * Math.cos(rad(alt)));
/** Up to this share of the rays may be hidden: one in five. (Each ray is a cast through the
 * full-detail buildings, so there are few of them.) */
export const MAY_HIDE = 0.2;

/** The rays of a row's shot from an eye point at instant `t`: `{ disc: [...], target: [...] }`, each `{ direction, distance }`. */
export function shotRays(row, eye, base, t = row.openAt ?? row.t) {
  const body = sampleBody(row.body, new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);
  const figure = row.target ? FIGURE_TARGETS.find((item) => item.id === row.target) : null;
  let axis = { x: 0, z: 0 };
  if (figure) {
    const [x, z] = sceneFromLatLon(figure.landmark.lat, figure.landmark.lon, FERNSEHTURM.lat, FERNSEHTURM.lon);
    axis = { x, z };
  }
  const flat = Math.hypot(axis.x - eye.x, axis.z - eye.z);
  // As far as the landmark, short of its own block; down a street, the first 600 m.
  const reach = row.kind === 'street' ? 600 : Math.max(50, flat - 40);
  const alt = Math.max(0, body.alt);
  const r = DISC_DEG / 2;
  const disc = [{ direction: direction(body.az, alt), distance: reach }];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    disc.push({ direction: direction(body.az + (r * Math.sin(a)) / Math.cos(rad(alt)), Math.max(0, alt + r * Math.cos(a))), distance: reach });
  }
  const origin = new THREE.Vector3(eye.x, eye.y, eye.z);
  const to = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).sub(origin);
    const length = v.length();
    return { direction: v.normalize(), distance: Math.max(20, length - 25) };
  };
  const target = [];
  if (row.kind === 'street') return { disc, target };
  if (figure) {
    // The figure: three heights on its axis, and its middle a metre and a half either side.
    const ground = figure.landmark.baseOrthometric - 34.6;
    for (let i = 0; i < 3; i++) target.push(to(axis.x, ground + figure.fromAgl + ((figure.toAgl - figure.fromAgl) * (i + 0.5)) / 3, axis.z));
    const side = { x: -(axis.z - eye.z) / flat, z: (axis.x - eye.x) / flat };
    for (const k of [-1.5, 1.5]) target.push(to(axis.x + side.x * k, ground + (figure.fromAgl + figure.toAgl) / 2, axis.z + side.z * k));
  } else if (row.where === 'antenna') {
    // The stretch of mast the moon stands on: its heights across the disc.
    for (const d of [-1, -0.5, 0, 0.5, 1]) target.push(to(0, eye.y + flat * Math.tan(rad(alt + d * r)), 0));
  } else {
    // The sphere: its centre and four points just inside its outline.
    const centre = new THREE.Vector3(0, base + SPHERE_CENTRE_AGL, 0);
    target.push(to(centre.x, centre.y, centre.z));
    const view = centre.clone().sub(origin).normalize();
    const right = new THREE.Vector3(-view.z, 0, view.x).normalize();
    const up = new THREE.Vector3().crossVectors(right, view).normalize();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const p = centre.clone().addScaledVector(right, Math.sin(a) * SPHERE_RADIUS_M * 0.9).addScaledVector(up, Math.cos(a) * SPHERE_RADIUS_M * 0.9);
      target.push(to(p.x, p.y, p.z));
    }
  }
  return { disc, target };
}

/**
 * Whether one of the hand-built landmarks (landmarks.js: the towers at Alexanderplatz, the
 * Estrel, the cathedral's domes...) stands in a ray. They are not among the city's tiles, so
 * `clearView` does not see them: a row opened onto a tower block's wall and said "clear"
 * (19 February 2027, 2:10 PM, the sphere from 520 m NNE). A ray stops short of its own target,
 * so the gate under the quadriga and the column under the Viktoria are not met.
 */
const caster = new THREE.Raycaster();
function landmarkInRay(eye, ray) {
  caster.set(new THREE.Vector3(eye.x, eye.y, eye.z), ray.direction);
  caster.near = 2;
  caster.far = ray.distance;
  return caster.intersectObjects(landmarks, false).length > 0;
}

/** Each kind's crown as an ellipsoid: where its middle sits and how tall its half is, in tree heights (trees.js `unitTree`). */
const CROWN = { 1: [0.575, 0.425], 2: [0.62, 0.75] };
const BROADLEAF = [0.7, 0.55];

/**
 * The register's trees along a look from the eye: those within `reach` metres ahead and near
 * enough to the line to stand in a ray up to a degree off it. Gathered once per shot, since
 * all of a shot's rays run within half a degree of each other; null when no trees are loaded.
 */
export function treesAlong(eye, dir, reach) {
  const data = treeData();
  if (!data) return null;
  const flat = Math.hypot(dir.x, dir.z) || 1;
  const ux = dir.x / flat;
  const uz = dir.z / flat;
  const found = [];
  for (const cell of data.cells) {
    const sc = Math.max(0, Math.min(reach, (cell.x - eye.x) * ux + (cell.z - eye.z) * uz));
    if (Math.hypot(cell.x - eye.x - sc * ux, cell.z - eye.z - sc * uz) > cell.radius + 40) continue;
    for (let i = cell.first; i < cell.first + cell.count; i++) {
      const tx = data.x[i] / 2;
      const tz = data.z[i] / 2;
      const s = (tx - eye.x) * ux + (tz - eye.z) * uz;
      if (s < 3 || s > reach) continue;
      const half = data.c[i] / 10;
      if (Math.abs((tx - eye.x) * uz - (tz - eye.z) * ux) > half + 8 + s * 0.02) continue;
      const [middle, tall] = CROWN[data.kind[i]] ?? BROADLEAF;
      const height = data.h[i] / 5;
      found.push({ x: tx, z: tz, half: Math.max(half, 0.1), middle: app.groundAt(tx, tz) - 0.2 + middle * height, tall: tall * height });
    }
  }
  return found;
}

/**
 * Whether one of `trees` (`treesAlong`) stands in a ray from the eye. Looked for only as far
 * as a tree could reach up into the ray (45 m).
 */
export function treeInRay(eye, dir, distance, trees) {
  const flat = Math.hypot(dir.x, dir.z);
  if (flat < 1e-6) return false;
  const ux = dir.x / flat;
  const uz = dir.z / flat;
  const slope = dir.y / flat;
  const reach = Math.min(distance * flat, slope > 0.01 ? 45 / slope : 1500, 1500);
  for (const tree of trees) {
    const s = (tree.x - eye.x) * ux + (tree.z - eye.z) * uz;
    if (s < 3 || s > reach) continue;
    const dx = Math.abs((tree.x - eye.x) * uz - (tree.z - eye.z) * ux) / tree.half;
    if (dx > 1) continue;
    const dy = (eye.y + s * slope - tree.middle) / tree.tall;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

/** The trees a shot's rays could meet: along its first ray, as far as any of them goes. */
function treesOfShot(eye, rays) {
  const all = [...rays.disc, ...rays.target];
  return treesAlong(eye, rays.disc[0].direction, Math.min(1500, Math.max(...all.map((ray) => ray.distance))));
}

/**
 * The hidden share of a row's disc and target from an eye point: by buildings and by trees.
 * `trees` shares are null when the register is not loaded. `centre` says whether the ray to
 * the disc's centre is hidden by buildings.
 */
export function shotShare(row, eye, base, t = row.openAt ?? row.t) {
  const rays = shotRays(row, eye, base, t);
  const origin = { x: eye.x, y: eye.y, z: eye.z };
  const count = (list, hit) => (list.length ? list.filter(hit).length / list.length : 0);
  const built = (ray) => !clearView(eye.x, eye.z, ray.direction, ray.distance) || landmarkInRay(eye, ray);
  const trees = treesOfShot(origin, rays);
  const loaded = trees !== null;
  const treed = (ray) => treeInRay(origin, ray.direction, ray.distance, trees);
  return {
    disc: { buildings: count(rays.disc, built), trees: loaded ? count(rays.disc, treed) : null },
    target: { buildings: count(rays.target, built), trees: loaded ? count(rays.target, treed) : null },
    centre: built(rays.disc[0]),
  };
}

/** The share of a row's disc and target the register's trees hide from an eye point, or null when they are not loaded. */
export function treeShare(row, eye, base, t = row.openAt ?? row.t) {
  const rays = shotRays(row, eye, base, t);
  const trees = treesOfShot(eye, rays);
  if (trees === null) return null;
  const count = (list) => (list.length ? list.filter((ray) => treeInRay(eye, ray.direction, ray.distance, trees)).length / list.length : 0);
  return { disc: count(rays.disc), target: count(rays.target) };
}

/** Buildings leave the shot: the disc's centre, and all but one ray in five of the disc and of the target. */
export const shotClear = (share) => !share.centre && share.disc.buildings <= MAY_HIDE + 1e-9 && share.target.buildings <= MAY_HIDE + 1e-9;
/** The register's trees leave the shot, by the same measure (true when the trees are not loaded: nothing is known). */
export const treesClear = (share) => (share.disc.trees ?? 0) <= MAY_HIDE + 1e-9 && (share.target.trees ?? 0) <= MAY_HIDE + 1e-9;
