/**
 * Berlin's street and park trees, from the city's tree register (scripts/miniature/build_trees.mjs):
 * about 540,000, each at its real place with its listed height and crown. Low-poly clay shapes,
 * drawn as three instanced meshes (broadleaf, conifer, columnar) holding only the 500 m cells near
 * enough for a crown to cover a few pixels, within an instance budget.
 *
 * Broadleaf trees are bare from December to March: their crowns thin a little and turn twig-grey, ramping
 * through April and November. Dense woods inside parks are not in the register.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY, CITY_VERSION, isPhone, params } from './config.js';
import { scene } from './render.js';
import { shadeFoliage } from './shading.js';
import { app, invalidateShadows } from './state.js';
import { metresPerPixelAt, viewFrustum } from './tiles.js';

/** A crown smaller than this many pixels is not worth drawing. */
const MIN_CROWN_PX = 3;
const BUDGET = Number(params.get('trees')) || (isPhone ? 30_000 : 90_000);

const SUMMER = new THREE.Color(0xa9bb92);
const WINTER = new THREE.Color(0x8e877d);
const CONIFER = new THREE.Color(0x8fa486);

/**
 * Unit trees, one unit tall and one crown wide, for each instance to scale to its own height and
 * crown. The trunk ends inside the crown.
 */
function unitTree(kind) {
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.5, 5, 1, true).translate(0, 0.25, 0);
  let crown;
  if (kind === 1) {
    crown = new THREE.ConeGeometry(0.5, 0.85, 7, 1).translate(0, 0.575, 0);
  } else if (kind === 2) {
    crown = new THREE.DodecahedronGeometry(0.5, 0).scale(1, 1.5, 1).translate(0, 0.62, 0);
  } else {
    crown = new THREE.DodecahedronGeometry(0.5, 0).scale(1, 1.1, 1).translate(0, 0.7, 0);
  }
  for (const g of [trunk, crown]) {
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
  }
  return mergeGeometries([trunk.toNonIndexed(), crown.toNonIndexed()]);
}

const kinds = [0, 1, 2].map((kind) => {
  const material = shadeFoliage(new THREE.MeshLambertMaterial({ color: kind === 1 ? CONIFER : SUMMER, flatShading: true }));
  const mesh = new THREE.InstancedMesh(unitTree(kind), material, BUDGET);
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // The instances span the visible cells; culling the whole set by one sphere would be wrong.
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
});

let data = null;
let shownKey = '';
let leaf = 1;
let visible = true;
const cellSphere = new THREE.Sphere();
const cellPoint = new THREE.Vector3();

/** 1 in leaf, 0 bare: December to March bare, ramping through April and November. */
export function leafOn(date) {
  const month = date.getUTCMonth();
  const day = date.getUTCDate() / 30;
  if (month >= 4 && month <= 9) return 1;
  if (month === 3) return day;
  if (month === 10) return 1 - day;
  return 0;
}

export async function loadTrees() {
  const info = await (await fetch(`${CITY}trees.json${CITY_VERSION}`)).json();
  const buffer = await (await fetch(`${CITY}trees.bin${CITY_VERSION}`)).arrayBuffer();
  app.bytesLoaded = (app.bytesLoaded ?? 0) + buffer.byteLength;
  const n = info.count;
  data = {
    x: new Int16Array(buffer, 0, n),
    z: new Int16Array(buffer, 2 * n, n),
    h: new Uint8Array(buffer, 4 * n, n),
    c: new Uint8Array(buffer, 5 * n, n),
    kind: new Uint8Array(buffer, 6 * n, n),
    cells: info.cells.map(([col, row, first, count]) => ({
      x: -info.half + (col + 0.5) * info.cell,
      z: -info.half + (row + 0.5) * info.cell,
      radius: info.cell * 0.72,
      first,
      count,
      ground: null,
    })),
  };
}

/** Sets the season and whether the layer is on; the next update rebuilds if either changed. */
export function setTrees({ date, on }) {
  const next = leafOn(date);
  if (Math.abs(next - leaf) > 0.01 || on !== visible) {
    leaf = next;
    visible = on;
    shownKey = '';
    kinds[0].material.color.lerpColors(WINTER, SUMMER, leaf);
    kinds[2].material.color.lerpColors(WINTER, SUMMER, leaf);
  }
}

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const turn = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const tint = new THREE.Color();

/** Called each drawn frame, after the view frustum is set: refills the meshes when the cells change. */
export function updateTrees() {
  if (!data) return;
  const wanted = [];
  if (visible) {
    for (const cell of data.cells) {
      cellPoint.set(cell.x, app.groundAt(cell.x, cell.z), cell.z);
      cellSphere.set(cellPoint, cell.radius);
      if (!viewFrustum.intersectsSphere(cellSphere)) continue;
      // Measured at the cell's near edge, so a cell starts showing as its first trees get big enough.
      const distance = Math.max(1, app.camera.position.distanceTo(cellPoint) - cell.radius);
      const metres = (metresPerPixelAt(cellPoint) * distance) / Math.max(1, app.camera.position.distanceTo(cellPoint));
      if (6 / metres < MIN_CROWN_PX) continue;
      wanted.push({ cell, distance });
    }
  }
  wanted.sort((a, b) => a.distance - b.distance);
  let total = 0;
  const shown = [];
  for (const { cell } of wanted) {
    if (total + cell.count > BUDGET) break;
    shown.push(cell);
    total += cell.count;
  }
  const key = shown.map((c) => c.first).join(',');
  if (key === shownKey) return;
  shownKey = key;
  const counts = [0, 0, 0];
  for (const cell of shown) {
    if (!cell.ground) {
      cell.ground = new Float32Array(cell.count);
      for (let i = 0; i < cell.count; i++) cell.ground[i] = app.groundAt(data.x[cell.first + i] / 2, data.z[cell.first + i] / 2);
    }
    for (let i = 0; i < cell.count; i++) {
      const t = cell.first + i;
      const kind = data.kind[t];
      const height = data.h[t] / 5;
      let crown = data.c[t] / 5;
      if (kind !== 1) crown *= 0.82 + 0.18 * leaf;
      // A steady turn and tint per tree, from its position, so the rows do not look stamped.
      const seed = Math.abs(Math.sin(data.x[t] * 12.9898 + data.z[t] * 78.233) * 43758.5453) % 1;
      position.set(data.x[t] / 2, cell.ground[i] - 0.2, data.z[t] / 2);
      scale.set(crown, height, crown);
      turn.setFromAxisAngle(up, seed * Math.PI * 2);
      matrix.compose(position, turn, scale);
      const mesh = kinds[kind];
      mesh.setMatrixAt(counts[kind], matrix);
      mesh.setColorAt(counts[kind], tint.setScalar(0.92 + 0.16 * seed));
      counts[kind]++;
    }
  }
  kinds.forEach((mesh, kind) => {
    mesh.count = counts[kind];
    mesh.visible = counts[kind] > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  invalidateShadows();
}

export const treeMeshes = kinds;
