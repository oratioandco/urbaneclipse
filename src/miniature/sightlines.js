/**
 * What the buildings hide: roofs over a point, sightlines, and the search for a clear spot
 * along a line, confirmed in full detail before anyone is put there.
 */
import * as THREE from 'three';
import { deckTop } from './decks.js';
import { missingBridgeAt, railViaductAt } from './bridgesMissing.js';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { EYE_HEIGHT, latLonFromScene, lookDirection } from './eye.js';
import { buildingMaterial, controls, raycaster, tower } from './render.js';
import { app } from './state.js';
import { loadLevel, tiles } from './tiles.js';

/** How far one can see along a heading from a spot, up to `far` metres. */
export function sightline(x, z, heading, far = 300) {
  const eye = new THREE.Vector3(x, standY(x, z) + EYE_HEIGHT, z);
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

// Bridges (decks.js). The city model draws a bridge's deck as a built surface above the bare-earth terrain
// (the river, the rail cutting), so to the roof test a deck looks like a building, and a
// photographer on Berlin's bridges was moved to the street below and stood inside the bridge
// (docs/adversarial-test-2026-11.md, finding 1). A deck is told from a roof by what runs over
// it: a street. Follow the street's points away from the spot; if their surface (the built top
// where there is one, the terrain where not) carries on without a step until it is plain
// ground, the built top is a deck that the street comes onto from the ground. A street that
// passes UNDER something (a rail viaduct, a house over a passage) steps down by the clearance
// as it comes out, and is not taken for a deck.
const DECK_CELL_M = 64;

/** Street points are asked for at most this far apart along a street. */
const ROAD_STEP_M = 12;
let roadCells = null;
/**
 * The street points near a spot, as [x, z] pairs: the streets' own corner points and, between
 * two that lie far apart, points every 12 m along the line. A straight bridge has no corner
 * point on it, so with the corners alone its deck had no street on it (Moltkebrücke).
 */
export function roadsNear(x, z, radius) {
  if (!app.roadXZ) return [];
  if (!roadCells || roadCells.source !== app.roadXZ) {
    roadCells = { source: app.roadXZ, cells: new Map() };
    const add = (px, pz) => {
      const key = `${Math.floor(px / DECK_CELL_M)},${Math.floor(pz / DECK_CELL_M)}`;
      let cell = roadCells.cells.get(key);
      if (!cell) roadCells.cells.set(key, (cell = []));
      cell.push(px, pz);
    };
    // The points come in runs, one per street line (map.json `runs`: [count, level]).
    const runs = app.roadRuns ?? [[app.roadXZ.length / 2, 0]];
    let at = 0;
    for (const [count] of runs) {
      for (let i = 0; i < count; i++) {
        const px = app.roadXZ[at + i * 2] / 2;
        const pz = app.roadXZ[at + i * 2 + 1] / 2;
        add(px, pz);
        if (i + 1 < count && app.roadRuns) {
          const qx = app.roadXZ[at + i * 2 + 2] / 2;
          const qz = app.roadXZ[at + i * 2 + 3] / 2;
          const pieces = Math.ceil(Math.hypot(qx - px, qz - pz) / ROAD_STEP_M);
          for (let k = 1; k < pieces; k++) add(px + ((qx - px) * k) / pieces, pz + ((qz - pz) * k) / pieces);
        }
      }
      at += count * 2;
    }
  }
  const found = [];
  for (let cx = Math.floor((x - radius) / DECK_CELL_M); cx <= Math.floor((x + radius) / DECK_CELL_M); cx++) {
    for (let cz = Math.floor((z - radius) / DECK_CELL_M); cz <= Math.floor((z + radius) / DECK_CELL_M); cz++) {
      const cell = roadCells.cells.get(`${cx},${cz}`);
      if (!cell) continue;
      for (let i = 0; i < cell.length; i += 2) if (Math.hypot(cell[i] - x, cell[i + 1] - z) <= radius) found.push([cell[i], cell[i + 1]]);
    }
  }
  return found;
}

/** Which 3 m cells are on a deck. */
const deckMemo = new Map();
/**
 * The top of a bridge deck at a point, as a scene height, or null where the point is on plain
 * ground, on a building, or under something (the rule is decks.js `deckTop`).
 *
 * Whether a place is a deck is remembered per 3 m cell (the rule walks the street and is not
 * cheap). The height never is: it is read at the very point, from the buildings as they are
 * drawn now. The coarse deck and the fine one differ by half a metre, and a height remembered
 * from the first, or from a neighbouring point, put the eye inside the deck.
 */
export function deckAt(x, z) {
  const key = `${Math.round(x / 3)},${Math.round(z / 3)}`;
  if (!deckMemo.has(key)) {
    if (deckMemo.size > 4000) deckMemo.clear();
    // Not the railway viaducts the rule is known to take for bridges (bridgesMissing.js).
    // Nor the bridges listed as not in the model: the Swinemünder Brücke's middle passed for a
    // deck at one level of detail and not at another, so a phone stood on it without a word and
    // a desktop was moved off it with one. Listed means not stood on, everywhere.
    const [lat, lon] = latLonFromScene(x, z, FERNSEHTURM.lat, FERNSEHTURM.lon);
    deckMemo.set(key, app.roadXZ && !railViaductAt(lat, lon) && !missingBridgeAt(lat, lon, 0) ? deckTop(x, z, { roofAt, groundAt: app.groundAt, roadsNear }) !== null : false);
  }
  if (!deckMemo.get(key)) return null;
  const top = roofAt(x, z);
  return top === -Infinity ? null : top;
}

/** The height one stands at: a bridge's deck where there is one, the ground everywhere else. */
export function standY(x, z) {
  return deckAt(x, z) ?? app.groundAt(x, z);
}
/** How far above the terrain one stands at a point: a deck's height over it, or 0. */
export const standLift = (x, z) => Math.max(0, standY(x, z) - app.groundAt(x, z));

/** Somewhere to stand: out in the open or on a bridge, with a view at least one way. */
const roomy = (x, z) => (!underRoof(x, z) || deckAt(x, z) !== null) && [0, 90, 180, 270].some((heading) => sightline(x, z, heading, 120) >= 80);

/** The spot itself if it is roomy, else the nearest roomy point on a street. */
export function standable(point) {
  if (roomy(point.x, point.z) || !app.roadXZ) return point;
  // Points along the streets, corners and in between, so the nearest one is a few metres off.
  const candidates = roadsNear(point.x, point.z, 500).map(([x, z]) => [Math.hypot(x - point.x, z - point.z), x, z]);
  candidates.sort((a, b) => a[0] - b[0]);
  for (const [, x, z] of candidates.slice(0, 120)) {
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
        app.tileEpoch = (app.tileEpoch ?? 0) + 1;
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
  // Up in the air, being over a roof is no obstacle; on the ground, a bridge's deck is where
  // one stands.
  if (lift < 1) {
    lift = standLift(x, z);
    if (lift < 1 && underRoof(x, z)) return false;
  }
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
