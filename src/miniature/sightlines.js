/**
 * What the buildings hide: roofs over a point, sightlines, and the search for a clear spot
 * along a line, confirmed in full detail before anyone is put there.
 */
import * as THREE from 'three';
import { EYE_HEIGHT, lookDirection } from './eye.js';
import { buildingMaterial, controls, raycaster, tower } from './render.js';
import { app } from './state.js';
import { loadLevel, tiles } from './tiles.js';

/** How far one can see along a heading from a spot, up to `far` metres. */
export function sightline(x, z, heading, far = 300) {
  const eye = new THREE.Vector3(x, app.groundAt(x, z) + EYE_HEIGHT, z);
  raycaster.set(eye, lookDirection(heading, 0));
  raycaster.far = far;
  const meshes = tiles.filter((tile) => tile.mesh && tile.center.distanceTo(eye) < tile.radius + far).map((tile) => tile.mesh);
  meshes.push(tower);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  raycaster.far = Infinity;
  return hit ? hit.distance : far;
}

app.roadXZ = null;

/** Where a screen point meets the ground, refined against the terrain heights. */
export function groundUnder(clientX, clientY) {
  const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, app.camera);
  const { origin, direction } = raycaster.ray;
  if (direction.y >= -1e-4) return null;
  let height = app.groundAt(controls.target.x, controls.target.z);
  let point = null;
  for (let i = 0; i < 4; i++) {
    point = origin.clone().addScaledVector(direction, (height - origin.y) / direction.y);
    height = app.groundAt(point.x, point.z);
  }
  return point;
}

/**
 * Something to cast rays against for a tile: what is on screen, or else the coarse level every
 * tile loads at the start, so checks never see an unloaded tile as empty ground.
 */
function rayTarget(tile) {
  if (tile.fineMesh) return tile.fineMesh;
  if (tile.mesh) return tile.mesh;
  if (!tile.coarse) return null;
  if (!tile.rayMesh) {
    const lod = tile.lods[tile.lods.length - 1];
    tile.rayMesh = new THREE.Mesh(tile.coarse, buildingMaterial);
    tile.rayMesh.position.fromArray(lod.min);
    tile.rayMesh.scale.setScalar(lod.step);
    tile.rayMesh.updateMatrixWorld(true);
  }
  return tile.rayMesh;
}

/** The highest building surface over a point, or -Infinity on open ground. */
export function roofAt(x, z) {
  raycaster.set(new THREE.Vector3(x, 2000, z), new THREE.Vector3(0, -1, 0));
  const near = tiles.filter((tile) => Math.abs(tile.center.x - x) < tile.radius && Math.abs(tile.center.z - z) < tile.radius).map(rayTarget).filter(Boolean);
  near.push(tower);
  const hit = raycaster.intersectObjects(near, false)[0];
  return hit && hit.point.y > app.groundAt(x, z) + 1.5 ? hit.point.y : -Infinity;
}

function underRoof(x, z) {
  return roofAt(x, z) > -Infinity;
}

/** Somewhere to stand: out in the open, with a view at least one way. */
const roomy = (x, z) => !underRoof(x, z) && [0, 90, 180, 270].some((heading) => sightline(x, z, heading, 120) >= 80);

/** The spot itself if it is roomy, else the nearest roomy point on a street. */
export function standable(point) {
  if (roomy(point.x, point.z) || !app.roadXZ) return point;
  const candidates = [];
  for (let i = 0; i < app.roadXZ.length; i += 2) {
    const x = app.roadXZ[i] / 2;
    const z = app.roadXZ[i + 1] / 2;
    const d = Math.hypot(x - point.x, z - point.z);
    if (d < 500) candidates.push([d, x, z]);
  }
  candidates.sort((a, b) => a[0] - b[0]);
  for (const [, x, z] of candidates.slice(0, 40)) {
    if (roomy(x, z)) return new THREE.Vector3(x, app.groundAt(x, z), z);
  }
  return point;
}

/** Load full detail, for checks only, for the tiles along a sightline that do not have it on screen. */
export async function fineAlong(x, z, direction, distance) {
  const origin = new THREE.Vector3(x, app.groundAt(x, z) + EYE_HEIGHT, z);
  const end = origin.clone().addScaledVector(direction, Math.min(distance, 1500));
  const box = new THREE.Box3().setFromPoints([origin, end]).expandByScalar(60);
  await Promise.all(
    tiles
      .filter((tile) => box.distanceToPoint(tile.center) < tile.radius && !tile.fineMesh && tile.level !== tile.lods[0].level)
      .map(async (tile) => {
        const lod = tile.lods[0];
        const mesh = new THREE.Mesh(await loadLevel(tile, lod), buildingMaterial);
        mesh.position.fromArray(lod.min);
        mesh.scale.setScalar(lod.step);
        mesh.updateMatrixWorld(true);
        tile.fineMesh = mesh;
      }),
  );
}

/**
 * A clear spot near (x, z) along a line, checked in full detail: the quick search runs on
 * whatever detail is loaded, then each find is confirmed with the full-detail buildings along
 * its sightline, and the search goes on past any that turn out blocked.
 */
export async function confirmedSpotAlong(x, z, ux, uz, viewFrom, keep = () => true) {
  const rejected = new Set();
  const key = (px, pz) => `${Math.round(px)},${Math.round(pz)}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const spot = clearSpotAlong(x, z, ux, uz, viewFrom, (px, pz) => keep(px, pz) && !rejected.has(key(px, pz)));
    if (!spot) return null;
    const view = viewFrom(spot.x, spot.z);
    await fineAlong(spot.x, spot.z, view.direction, view.distance);
    if (clearView(spot.x, spot.z, view.direction, view.distance)) return spot;
    rejected.add(key(spot.x, spot.z));
  }
  return null;
}

/** For checking by hand: what the last sightline check ran into. */
app.lastBlock = null;
/** Whether nothing built stands between an eye at (x, z) and a point along a direction. */
export function clearView(x, z, direction, distance, lift = 0) {
  // Up in the air, being over a roof is no obstacle.
  if (lift < 1 && underRoof(x, z)) return false;
  const origin = new THREE.Vector3(x, app.groundAt(x, z) + EYE_HEIGHT + lift, z);
  raycaster.set(origin, direction);
  raycaster.near = 2;
  raycaster.far = distance;
  const end = origin.clone().addScaledVector(direction, distance);
  const box = new THREE.Box3().setFromPoints([origin, end]).expandByScalar(60);
  const meshes = tiles.filter((tile) => box.distanceToPoint(tile.center) < tile.radius).map(rayTarget).filter(Boolean);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  raycaster.near = 0;
  raycaster.far = Infinity;
  app.lastBlock = hit ? { distance: hit.distance, point: hit.point.clone() } : null;
  return !hit;
}

/**
 * The nearest point along a line from (x, z) with a clear view, trying outward both ways:
 * finely close by, more coarsely further out. Null when nothing within 3 km sees through.
 */
function clearSpotAlong(x, z, ux, uz, viewFrom, keep = () => true) {
  const steps = [];
  for (let d = 0; d <= 600; d += 15) steps.push(d);
  for (let d = 650; d <= 3000; d += 50) steps.push(d);
  for (const step of steps) {
    for (const sign of step ? [1, -1] : [1]) {
      const px = x + ux * step * sign;
      const pz = z + uz * step * sign;
      if (!keep(px, pz)) continue;
      const view = viewFrom(px, pz);
      if (clearView(px, pz, view.direction, view.distance)) return { x: px, z: pz };
    }
  }
  return null;
}
