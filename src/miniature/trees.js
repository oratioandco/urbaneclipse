/**
 * Berlin's street and park trees, from the city's tree register (scripts/miniature/build_trees.mjs):
 * about 540,000, each at its real place with its listed height and crown. Low-poly clay shapes,
 * drawn as six instanced meshes (broadleaf, conifer, columnar, and three cherry kinds) holding only
 * the 500 m cells near enough for a crown to cover a few pixels, within an instance budget.
 *
 * Broadleaf trees turn gold through October and are bare from December to March: their crowns
 * shrink to a twiggy remnant and go dark, ramping through April and November. Conifers stay green.
 * The cherries (Prunus) pink up at blossom season — early kinds first, the famous ornamental ones
 * mid-April, late ones into May; blossomForecast.js shifts the peaks to the year's weather when it
 * can. Dense woods inside parks are not in the register.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY, CITY_VERSION, isPhone, params } from './config.js';
import { autumnOn, blossomAmount, CHERRY_EARLY, CHERRY_ORNAMENTAL, CHERRY_LATE } from './blossom.js';
import { scene } from './render.js';
import { shadeFoliage } from './shading.js';
import { app, invalidateShadows } from './state.js';
import { metresPerPixelAt, viewFrustum } from './tiles.js';

/** A crown smaller than this many pixels is not worth drawing. */
const MIN_CROWN_PX = 3;
const BUDGET = Number(params.get('trees')) || (isPhone ? 30_000 : 90_000);

const SUMMER = new THREE.Color(0xa9bb92);
// Winter is not grey: the crown shrinks to a remnant and the whole tree reads as dark twigs.
const WINTER = new THREE.Color(0x5d5348);
const CONIFER = new THREE.Color(0x8fa486);
const BLOSSOM = new THREE.Color(0xf5b8ce);
// Autumn gold, per instance: the seed picks where a tree sits between gold, amber and rust.
const AUTUMN = [new THREE.Color(0xd9a441), new THREE.Color(0xc8873a), new THREE.Color(0x9c5f30)];
const KINDS = [0, 1, 2, CHERRY_EARLY, CHERRY_ORNAMENTAL, CHERRY_LATE];

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

const broadleaf = unitTree(0);
const kinds = KINDS.map((kind) => {
  const material = shadeFoliage(new THREE.MeshLambertMaterial({ color: kind === 1 ? CONIFER : SUMMER, flatShading: true }));
  const mesh = new THREE.InstancedMesh(kind >= 3 ? broadleaf : unitTree(kind), material, BUDGET);
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
let autumn = 0;
let bloomKey = '';
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

/** Each kind's blossom on the date, from climatology or — in season — the GDD prediction. */
function blossomOn(date) {
  const peaks = app.blossomPeaks;
  return {
    [CHERRY_EARLY]: blossomAmount(date, CHERRY_EARLY, peaks),
    [CHERRY_ORNAMENTAL]: blossomAmount(date, CHERRY_ORNAMENTAL, peaks),
    [CHERRY_LATE]: blossomAmount(date, CHERRY_LATE, peaks),
  };
}

/** The layers menu names the season, so the pink (and the bare crowns) are explained. */
function treeNote(date, bloom) {
  const note = document.getElementById('trees-note');
  if (!note) return;
  const blooming = Object.values(bloom).some((amount) => amount > 0.5);
  if (blooming) {
    note.textContent = 'From the city’s tree register — the cherry trees are in bloom';
  } else if (app.blossomPeaks) {
    const LABEL = { [CHERRY_EARLY]: 'early', [CHERRY_ORNAMENTAL]: 'ornamental', [CHERRY_LATE]: 'late' };
    const expected = KINDS.filter((kind) => app.blossomPeaks[kind])
      .map((kind) => `~${new Date(app.blossomPeaks[kind]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} (${LABEL[kind]})`)
      .join(', ');
    note.textContent = `Cherry blossom expected ${expected}`;
  } else if (leaf < 0.5) {
    note.textContent = 'From the city’s tree register, bare in winter';
  } else {
    note.textContent = 'From the city’s tree register';
  }
}

/** Sets the season and whether the layer is on; the next update rebuilds if either changed. */
export function setTrees({ date, on }) {
  const nextLeaf = leafOn(date);
  const nextAutumn = autumnOn(date);
  const nextBloom = blossomOn(date);
  const nextKey = `${Object.values(nextBloom).map((v) => v.toFixed(2)).join(',')}/${nextAutumn.toFixed(2)}`;
  if (Math.abs(nextLeaf - leaf) > 0.01 || nextKey !== bloomKey || on !== visible) {
    leaf = nextLeaf;
    autumn = nextAutumn;
    bloomKey = nextKey;
    visible = on;
    shownKey = '';
    kinds[0].material.color.lerpColors(WINTER, SUMMER, leaf);
    kinds[2].material.color.lerpColors(WINTER, SUMMER, leaf);
    // The cherries follow the broadleaf season, but bloom washes them pink at blossom time.
    for (const kind of [CHERRY_EARLY, CHERRY_ORNAMENTAL, CHERRY_LATE]) {
      kinds[kind].material.color.lerpColors(WINTER, SUMMER, leaf).lerp(BLOSSOM, nextBloom[kind]);
    }
    treeNote(date, nextBloom);
  }
}

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const turn = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const tint = new THREE.Color();
// How much of the summer green each autumn palette colour replaces, as a shader multiplier on
// the material colour — precomputed once, since instance colours multiply the material's.
const AUTUMN_MIX = AUTUMN.map((gold) => new THREE.Color(gold.r / SUMMER.r, gold.g / SUMMER.g, gold.b / SUMMER.b));
const WHITE = new THREE.Color(1, 1, 1);

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
  const counts = [0, 0, 0, 0, 0, 0];
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
      // Bare in winter: the crown shrinks to a twiggy remnant the trunk still carries.
      if (kind !== 1) crown *= 0.18 + 0.82 * leaf;
      // A steady turn and tint per tree, from its position, so the rows do not look stamped.
      const seed = Math.abs(Math.sin(data.x[t] * 12.9898 + data.z[t] * 78.233) * 43758.5453) % 1;
      position.set(data.x[t] / 2, cell.ground[i] - 0.2, data.z[t] / 2);
      scale.set(crown, height, crown);
      turn.setFromAxisAngle(up, seed * Math.PI * 2);
      matrix.compose(position, turn, scale);
      const mesh = kinds[kind];
      mesh.setMatrixAt(counts[kind], matrix);
      // Autumn gilds the broadleaves (conifers keep their green), each tree its own gold.
      if (kind !== 1 && autumn > 0) {
        tint.copy(WHITE).lerp(AUTUMN_MIX[seed * 3 | 0], autumn);
      } else {
        tint.setScalar(1);
      }
      tint.multiplyScalar(0.92 + 0.16 * seed);
      mesh.setColorAt(counts[kind], tint);
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
