/**
 * A white miniature of Berlin with real geometry and real sun shadows.
 *
 * The shadow map only re-renders when the sun or view changes, and frames are only drawn
 * when something changed. It is fitted to the ground in view: a point that shades another
 * lies at the same spot in the light's view, so the fit needs no room for casters outside.
 */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { sampleBody } from '../../../src/lib/bodyPosition.ts';
import { FERNSEHTURM } from '../../../src/lib/landmarks.ts';
import { skyPalette } from '../../../src/lib/skyPalette.ts';

const params = new URLSearchParams(location.search);
const isPhone = Math.min(innerWidth, innerHeight) < 600;
const SHADOW_SIZE = Number(params.get('shadow')) || (isPhone ? 2048 : 4096);
const TRIANGLE_BUDGET = Number(params.get('budget')) || (isPhone ? 1_200_000 : 5_000_000);
/** A level is good enough once its error covers fewer pixels than this. */
const ERROR_PX = 1.5;
const LIGHT_DISTANCE = 30_000;
const MAX_SUN = 5;
const GROUND_FROM_SUN = 1.9;
const VIEW_RADIUS = 12_000;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const buildingMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide, shadowSide: THREE.BackSide });
const groundMaterial = new THREE.MeshLambertMaterial({ color: 0xe9e6df });

const sky = new THREE.HemisphereLight(0xffffff, 0xd8d3ca, 1.7);
scene.add(sky);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
sun.shadow.radius = 1.6;
scene.add(sun, sun.target);

// Tower: the same solid of revolution the eclipse maths uses.
const towerPoints = FERNSEHTURM.profile.map(([h, r]) => new THREE.Vector2(r, h));
towerPoints.unshift(new THREE.Vector2(0, 0));
towerPoints.push(new THREE.Vector2(0, towerPoints[towerPoints.length - 1].y));
const tower = new THREE.Mesh(new THREE.LatheGeometry(towerPoints, 32), new THREE.MeshLambertMaterial({ color: 0xffffff }));
tower.castShadow = true;
tower.receiveShadow = true;
scene.add(tower);

// ---- Cameras ------------------------------------------------------------------------
const FOV = 35;
const perspective = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 10, 60_000);
const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 90_000);
let camera = orthographic;
let controls = null;
let mode = 'top';
let worldHeight = Number(params.get('height')) || (isPhone ? 3200 : 2400);

function worldHeightNow() {
  if (camera.isOrthographicCamera) return (camera.top - camera.bottom) / camera.zoom;
  return 2 * camera.position.distanceTo(controls.target) * Math.tan((FOV * Math.PI) / 360);
}

function fitOrthographic() {
  const aspect = innerWidth / innerHeight;
  orthographic.left = (-worldHeight * aspect) / 2;
  orthographic.right = (worldHeight * aspect) / 2;
  orthographic.top = worldHeight / 2;
  orthographic.bottom = -worldHeight / 2;
  orthographic.zoom = 1;
  orthographic.updateProjectionMatrix();
}

const ANGLES = {
  top: { polar: 0.0001, azimuth: 0 },
  iso: { polar: THREE.MathUtils.degToRad(54.7), azimuth: THREE.MathUtils.degToRad(35) },
  free: { polar: THREE.MathUtils.degToRad(68), azimuth: THREE.MathUtils.degToRad(35) },
};

function setMode(next) {
  const target = controls ? controls.target.clone() : new THREE.Vector3(0, 0, 0);
  if (controls) {
    worldHeight = worldHeightNow();
    controls.dispose();
  }
  mode = next;
  camera = next === 'free' ? perspective : orthographic;
  const { polar, azimuth } = ANGLES[next];
  const distance = next === 'free' ? worldHeight / (2 * Math.tan((FOV * Math.PI) / 360)) : 30_000;
  if (next !== 'free') fitOrthographic();
  camera.position.setFromSphericalCoords(distance, polar, azimuth).add(target);
  camera.lookAt(target);
  controls = new MapControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = false;
  controls.minDistance = 150;
  controls.maxDistance = 40_000;
  controls.minZoom = 0.2;
  controls.maxZoom = 60;
  if (next === 'free') {
    controls.minPolarAngle = 0.05;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(86);
  } else {
    controls.minPolarAngle = polar;
    controls.maxPolarAngle = polar;
  }
  controls.addEventListener('change', invalidate);
  controls.update();
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === next));
  invalidate();
}

// ---- City tiles ---------------------------------------------------------------------
const tiles = [];
const loading = new Set();
let bytesLoaded = 0;

async function loadLevel(tile, lod) {
  const response = await fetch(`/city/${tile.id}-${lod.level}.bin`);
  const data = new Uint8Array(await response.arrayBuffer());
  bytesLoaded += data.length;
  const head = new Uint32Array(data.buffer, 0, 2);
  const vertices = new Uint16Array(lod.vertices * 4);
  MeshoptDecoder.decodeVertexBuffer(new Uint8Array(vertices.buffer), lod.vertices, 8, data.subarray(8, 8 + head[0]));
  const indices = new Uint32Array(lod.indexCount);
  MeshoptDecoder.decodeIndexBuffer(new Uint8Array(indices.buffer), lod.indexCount, 4, data.subarray(8 + head[0], 8 + head[0] + head[1]));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(vertices, 4), 3, 0));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const size = new THREE.Vector3().fromArray(lod.max).sub(new THREE.Vector3().fromArray(lod.min)).divideScalar(lod.step);
  geometry.boundingSphere = new THREE.Sphere(size.clone().multiplyScalar(0.5), size.length() * 0.5);
  return geometry;
}

function showLevel(tile, level, geometry) {
  if (!tile.mesh) {
    tile.mesh = new THREE.Mesh(geometry, buildingMaterial);
    tile.mesh.castShadow = true;
    tile.mesh.receiveShadow = true;
    tile.mesh.matrixAutoUpdate = false;
    scene.add(tile.mesh);
  } else {
    if (tile.mesh.geometry !== tile.coarse) tile.mesh.geometry.dispose();
    tile.mesh.geometry = geometry;
  }
  const lod = tile.lods.find((l) => l.level === level);
  tile.mesh.position.fromArray(lod.min);
  tile.mesh.scale.setScalar(lod.step);
  tile.mesh.updateMatrix();
  tile.level = level;
  invalidateShadows();
}

function metresPerPixelAt(point) {
  const pixels = innerHeight;
  if (camera.isOrthographicCamera) return worldHeightNow() / pixels;
  return (2 * camera.position.distanceTo(point) * Math.tan((FOV * Math.PI) / 360)) / pixels;
}

const viewFrustum = new THREE.Frustum();
const viewMatrix = new THREE.Matrix4();
const tileSphere = new THREE.Sphere();

/** Pick each tile's level from its size on screen, then coarsen the most distant to stay in budget. */
function updateLevels() {
  viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  viewFrustum.setFromProjectionMatrix(viewMatrix);
  const wanted = [];
  let total = 0;
  for (const tile of tiles) {
    tileSphere.center.copy(tile.center);
    tileSphere.radius = tile.radius;
    const inView = viewFrustum.intersectsSphere(tileSphere);
    const coarsest = tile.lods[tile.lods.length - 1];
    let lod = coarsest;
    if (inView) {
      const metres = metresPerPixelAt(tile.center);
      lod = tile.lods.find((l) => l.error <= ERROR_PX * metres) ?? coarsest;
      total += lod.triangles;
    }
    wanted.push({ tile, lod, inView, distance: tile.center.distanceTo(controls.target) });
  }
  wanted.sort((a, b) => b.distance - a.distance);
  for (const entry of wanted) {
    if (total <= TRIANGLE_BUDGET) break;
    if (!entry.inView) continue;
    const at = entry.tile.lods.indexOf(entry.lod);
    if (at < entry.tile.lods.length - 1) {
      const coarser = entry.tile.lods[at + 1];
      total += coarser.triangles - entry.lod.triangles;
      entry.lod = coarser;
    }
  }
  const toLoad = wanted
    .filter((e) => e.tile.level !== e.lod.level && !loading.has(e.tile.id))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(0, 6 - loading.size));
  for (const { tile, lod } of toLoad) {
    if (lod === tile.lods[tile.lods.length - 1] && tile.coarse) {
      showLevel(tile, lod.level, tile.coarse);
      continue;
    }
    loading.add(tile.id);
    loadLevel(tile, lod)
      .then((geometry) => showLevel(tile, lod.level, geometry))
      .finally(() => {
        loading.delete(tile.id);
        invalidate();
      });
  }
  if (toLoad.length > 0) invalidate();
}

// ---- Sun ----------------------------------------------------------------------------
const dateInput = document.getElementById('date');
const timeInput = document.getElementById('time');
const clock = document.getElementById('clock');
const sunLabel = document.getElementById('sun');
const berlinOffsetMinutes = (date) => {
  const local = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  return (local - utc) / 60_000;
};

function instant() {
  const [y, m, d] = dateInput.value.split('-').map(Number);
  const minutes = Number(timeInput.value);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, minutes));
  return new Date(guess.getTime() - berlinOffsetMinutes(guess) * 60_000);
}

const sunDirection = new THREE.Vector3(0, 1, 0);
const background = new THREE.Color();
const smooth = THREE.MathUtils.smoothstep;

function updateSun() {
  const when = instant();
  const { az, alt } = sampleBody('sun', when, FERNSEHTURM.lat, FERNSEHTURM.lon);
  const a = THREE.MathUtils.degToRad(az);
  const h = THREE.MathUtils.degToRad(alt);
  sunDirection.set(Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h));
  const { discTint } = skyPalette('sun', alt);
  const up = smooth(alt, -1, 3);
  const daylight = smooth(alt, -9, 6);
  sun.color.setRGB(discTint[0], 0.35 + 0.65 * discTint[1], 0.2 + 0.8 * discTint[2]);
  // Lit like a studio model: sunlit ground stays near white as the sun sinks, until the sun
  // is too low to keep it there, and shadows hold about half of that.
  sun.intensity = up * Math.min(MAX_SUN, GROUND_FROM_SUN / Math.max(0.02, sunDirection.y));
  sun.castShadow = alt > -1;
  sky.intensity = 0.4 + 1.25 * daylight;
  // A cool sky fills the shadows, against the warm sun.
  sky.color.setRGB(THREE.MathUtils.lerp(0.55, 0.95, daylight), THREE.MathUtils.lerp(0.62, 0.975, daylight), THREE.MathUtils.lerp(0.9, 1.02, daylight));
  sky.groundColor.copy(sky.color).multiplyScalar(0.84);
  // The page takes the colour the flat ground has under these lights, so the model's edge dissolves.
  const irradiance = new THREE.Color().copy(sky.color).multiplyScalar(sky.intensity);
  irradiance.add(new THREE.Color().copy(sun.color).multiplyScalar(sun.intensity * Math.max(0, sunDirection.y)));
  background.copy(groundMaterial.color).multiply(irradiance).multiplyScalar(1 / Math.PI);
  scene.background = background;
  clock.textContent = `${String(Math.floor(timeInput.value / 60)).padStart(2, '0')}:${String(timeInput.value % 60).padStart(2, '0')}`;
  sunLabel.textContent = alt > -0.5 ? `Sun ${alt.toFixed(0)}°, ${az.toFixed(0)}°` : 'Sun down';
  invalidateShadows();
}

const corner = new THREE.Vector3();
const farCorner = new THREE.Vector3();
const lightView = new THREE.Matrix4();

function fitShadow() {
  const distance = LIGHT_DISTANCE;
  const anchor = controls.target;
  sun.target.position.copy(anchor);
  sun.position.copy(anchor).addScaledVector(sunDirection, distance);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();
  const shadowCamera = sun.shadow.camera;
  shadowCamera.position.copy(sun.position);
  shadowCamera.lookAt(anchor);
  shadowCamera.updateMatrixWorld();
  lightView.copy(shadowCamera.matrixWorld).invert();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      corner.set(x, y, -1).unproject(camera);
      farCorner.set(x, y, 1).unproject(camera);
      const dy = farCorner.y - corner.y;
      let t = dy < 0 ? -corner.y / dy : 1;
      t = Math.min(1, Math.max(0, t));
      corner.lerp(farCorner, t);
      // A view above the horizon would stretch the fit across the whole sky.
      const dx = corner.x - anchor.x;
      const dz = corner.z - anchor.z;
      const reach = Math.hypot(dx, dz);
      if (reach > VIEW_RADIUS) {
        corner.x = anchor.x + (dx * VIEW_RADIUS) / reach;
        corner.z = anchor.z + (dz * VIEW_RADIUS) / reach;
      }
      corner.y = 0;
      corner.applyMatrix4(lightView);
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y);
      maxY = Math.max(maxY, corner.y);
    }
  }
  const margin = Math.max(maxX - minX, maxY - minY) * 0.08 + 40;
  const span = Math.max(maxX - minX, maxY - minY) + margin * 2;
  const texel = span / SHADOW_SIZE;
  // Snap to whole texels, so shadow edges do not shimmer as the view pans.
  const centreX = Math.round((minX + maxX) / 2 / texel) * texel;
  const centreY = Math.round((minY + maxY) / 2 / texel) * texel;
  shadowCamera.left = centreX - span / 2;
  shadowCamera.right = centreX + span / 2;
  shadowCamera.bottom = centreY - span / 2;
  shadowCamera.top = centreY + span / 2;
  shadowCamera.near = distance - 1500;
  shadowCamera.far = distance + 1500;
  shadowCamera.updateProjectionMatrix();
  sun.shadow.bias = -Math.max(0.2, texel * 0.6) / 3000;
  sun.shadow.needsUpdate = true;
  renderer.shadowMap.needsUpdate = true;
  stats.texel = texel;
}

// ---- Loop ---------------------------------------------------------------------------
let dirty = true;
let shadowsDirty = true;
function invalidate() {
  dirty = true;
}
function invalidateShadows() {
  shadowsDirty = true;
  dirty = true;
}

const stats = { texel: 0, ms: 0, frames: 0, triangles: 0, calls: 0 };
const statsEl = document.getElementById('stats');
let lastFrame = performance.now();
const history = [];

function frame(now) {
  requestAnimationFrame(frame);
  const moved = controls.update();
  if (moved) shadowsDirty = true;
  if (!dirty && !moved && !window.__forceRender) {
    lastFrame = now;
    return;
  }
  dirty = false;
  history.push(now - lastFrame);
  if (history.length > 60) history.shift();
  lastFrame = now;
  camera.updateMatrixWorld();
  updateLevels();
  if (shadowsDirty && sun.castShadow) {
    fitShadow();
  }
  shadowsDirty = false;
  renderer.info.reset();
  renderer.render(scene, camera);
  stats.triangles = renderer.info.render.triangles;
  stats.calls = renderer.info.render.calls;
  stats.frames++;
  if (stats.frames % 6 === 0 && params.has('stats')) {
    const sorted = [...history].sort((a, b) => a - b);
    statsEl.textContent = `frame ${sorted[sorted.length >> 1]?.toFixed(1)} ms   ${(stats.triangles / 1e6).toFixed(2)} M tris incl. shadow   ${stats.calls} calls\nshadow texel ${stats.texel.toFixed(2)} m   loaded ${(bytesLoaded / 1e6).toFixed(1)} MB   ${loading.size} loading`;
  }
}

async function start() {
  const manifest = await (await fetch('/city/manifest.json')).json();
  const terrainInfo = await (await fetch('/city/terrain.json')).json();
  const terrain = new Int16Array(await (await fetch('/city/terrain.bin')).arrayBuffer());
  const { size, half } = terrainInfo;
  const plane = new THREE.PlaneGeometry(half * 2, half * 2, size - 1, size - 1);
  plane.rotateX(-Math.PI / 2);
  const positions = plane.attributes.position;
  for (let i = 0; i < positions.count; i++) positions.setY(i, terrain[i] / 10 - 0.4);
  plane.computeVertexNormals();
  plane.computeBoundingSphere();
  const base = new THREE.Mesh(plane, groundMaterial);
  base.receiveShadow = true;
  scene.add(base);

  await MeshoptDecoder.ready;
  for (const tile of manifest.tiles) {
    const coarse = tile.lods[tile.lods.length - 1];
    tile.center = new THREE.Vector3().fromArray(coarse.min).add(new THREE.Vector3().fromArray(coarse.max)).multiplyScalar(0.5);
    tile.radius = new THREE.Vector3().fromArray(coarse.max).distanceTo(new THREE.Vector3().fromArray(coarse.min)) / 2;
    tile.level = -1;
    tiles.push(tile);
  }
  // The coarse city first: small, and enough to see shadows at any zoom.
  const queue = [...tiles].sort((a, b) => a.center.length() - b.center.length());
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let tile = queue.shift(); tile; tile = queue.shift()) {
        const coarse = tile.lods[tile.lods.length - 1];
        tile.coarse = await loadLevel(tile, coarse);
        showLevel(tile, coarse.level, tile.coarse);
        invalidate();
      }
    }),
  );
  window.__ready = true;
  invalidate();
}

// ---- Wiring -------------------------------------------------------------------------
const startAt = params.get('date') ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
dateInput.value = startAt;
timeInput.value = params.get('time') ?? '960';
dateInput.addEventListener('input', updateSun);
timeInput.addEventListener('input', updateSun);
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  perspective.aspect = innerWidth / innerHeight;
  perspective.updateProjectionMatrix();
  const h = worldHeightNow();
  worldHeight = h;
  if (camera.isOrthographicCamera) fitOrthographic();
  invalidateShadows();
});

setMode(params.get('mode') ?? 'iso');
updateSun();
requestAnimationFrame(frame);
start();
window.__mini = { setMode, invalidate, invalidateShadows, stats, getHistory: () => history, get camera() { return camera; }, get controls() { return controls; }, renderer };
