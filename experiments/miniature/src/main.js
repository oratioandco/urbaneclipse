/**
 * A white miniature of Berlin with real geometry, real shadows and the map drawn into it.
 *
 * The shadow map only re-renders when the sun or view changes, and frames are only drawn
 * when something changed. It is fitted to the ground in view: a point that shades another
 * lies at the same spot in the light's view, so the fit needs no room for casters outside.
 */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { getMoonIllumination } from 'suncalc';
import { MeshoptDecoder } from 'meshoptimizer';
import { sampleBody } from '../../../src/lib/bodyPosition.ts';
import { FERNSEHTURM } from '../../../src/lib/landmarks.ts';
import { LIGHT_PHASE_NAMES, lightBands, lightGradientStops, lightPhaseAt } from '../../../src/lib/lightPhases.ts';
import { decodeStreets, streetMoments } from '../../../src/lib/streets.ts';
import { lightAt } from './light.js';
import { cityUniforms, makeTerrainTexture, mirrorGround, shadeBuildings, shadeGround, shadeTower } from './shading.js';
import { makeHighlights, paintGroundMap, ribbonUniforms } from './map.js';
import { drawOverlay, resizeOverlay, setLabels } from './overlay.js';

const params = new URLSearchParams(location.search);
const isPhone = Math.min(innerWidth, innerHeight) < 600;
const SHADOW_SIZE = Number(params.get('shadow')) || (isPhone ? 2048 : 4096);
const TRIANGLE_BUDGET = Number(params.get('budget')) || (isPhone ? 1_200_000 : 5_000_000);
/** A level is good enough once its error covers fewer pixels than this. */
const ERROR_PX = 1.5;
const LIGHT_DISTANCE = 30_000;
const VIEW_RADIUS = 12_000;
const MIRROR_SCALE = Number(params.get('mirror') ?? 0.5);
/** Buildings further from water than this cannot show in its reflection from these views. */
const REFLECTION_REACH_M = 280;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const buildingMaterial = shadeBuildings(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide, shadowSide: THREE.BackSide }));
const groundMaterial = shadeGround(new THREE.MeshLambertMaterial({ color: 0xd8d7d3 }));

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
const tower = new THREE.Mesh(new THREE.LatheGeometry(towerPoints, 64), shadeTower(new THREE.MeshLambertMaterial({ color: 0xffffff })));
tower.castShadow = true;
tower.receiveShadow = true;
scene.add(tower);

// Red aircraft warning lights in tiers up the antenna. Heights are read from photographs.
const BEACON_TIERS = [[368, 0], [340, 1.3], [312, 1.6], [284, 2], [256, 2.8]];
const beaconPoints = [];
for (const [height, radius] of BEACON_TIERS) {
  for (let i = 0; i < 3; i++) beaconPoints.push(Math.cos((i * 2 * Math.PI) / 3) * radius, height, Math.sin((i * 2 * Math.PI) / 3) * radius);
}
const beacons = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(beaconPoints, 3)),
  new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 5 * renderer.getPixelRatio() } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: 'uniform float uSize; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }',
    fragmentShader: 'void main() { float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(3.2, 0.12, 0.06) * smoothstep(1.0, 0.3, d), 1.0); }',
  }),
);
beacons.frustumCulled = false;
beacons.visible = false;
scene.add(beacons);
/** The German "Feuer W, rot" rhythm: 1 s on, 0.5 s off, 1 s on, 1.5 s off. */
const beaconLit = (ms) => {
  const t = ms % 4000;
  return t < 1000 || (t >= 1500 && t < 2500);
};
const TOWER_BOUND = new THREE.Sphere(new THREE.Vector3(0, 190, 0), 190);

// Rendered in linear light, so the city's lights can exceed white and bloom. Multisampling this
// format cost about half the frame on a dense screen, whose pixels are small enough to go without.
const composerTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Number(params.get('samples') ?? (renderer.getPixelRatio() >= 2 ? 0 : 4)) });
const composer = new EffectComposer(renderer, composerTarget);
composer.setPixelRatio(renderer.getPixelRatio());
const mirrorTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
const sizeMirror = () => {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  mirrorTarget.setSize(Math.ceil(size.x * MIRROR_SCALE), Math.ceil(size.y * MIRROR_SCALE));
};
sizeMirror();
cityUniforms.uMirror.value = mirrorTarget.texture;
composer.setSize(innerWidth, innerHeight);
const renderPass = new RenderPass(scene, null);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.5, 0.55, 0.95);
composer.addPass(renderPass);
composer.addPass(bloom);
// A soft lens blur toward the edges of the view, and toward the far distance in the 3D view.
const edgeBlur = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uPixel: { value: new THREE.Vector2() }, uFar: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uPixel;
    uniform float uFar;
    varying vec2 vUv;
    void main() {
      vec2 fromCentre = (vUv - vec2(0.5, 0.54)) * vec2(1.0, 1.1);
      float amount = smoothstep(0.46, 0.86, length(fromCentre));
      amount = max(amount, uFar * smoothstep(0.74, 1.0, vUv.y));
      vec3 sum = texture2D(tDiffuse, vUv).rgb;
      if (amount > 0.01) {
        for (int i = 1; i <= 12; i++) {
          float f = float(i);
          float angle = f * 2.39996;
          sum += texture2D(tDiffuse, vUv + vec2(cos(angle), sin(angle)) * sqrt(f / 12.0) * amount * uPixel * 4.5).rgb;
        }
        sum /= 13.0;
      }
      gl_FragColor = vec4(sum, 1.0);
    }`,
});
const sizeBlur = () => edgeBlur.uniforms.uPixel.value.set(renderer.getPixelRatio() / renderer.domElement.width, renderer.getPixelRatio() / renderer.domElement.height);
sizeBlur();
edgeBlur.enabled = params.get('blur') !== '0';
composer.addPass(edgeBlur);
composer.addPass(new OutputPass());
ribbonUniforms.uViewportH.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y;

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
const keyDirection = new THREE.Vector3(0, 1, 0);
const background = new THREE.Color();
const smooth = THREE.MathUtils.smoothstep;

const moonDirection = new THREE.Vector3();
const toDirection = (out, az, alt) => {
  const a = THREE.MathUtils.degToRad(az);
  const h = THREE.MathUtils.degToRad(alt);
  return out.set(Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h));
};
let bodies = [];
const mirrorSky = new THREE.Color();
const WATER_TINT = new THREE.Color(0.62, 0.84, 1.22);
let night = false;

function updateSun() {
  const when = instant();
  const sunAt = sampleBody('sun', when, FERNSEHTURM.lat, FERNSEHTURM.lon);
  const moonAt = sampleBody('moon', when, FERNSEHTURM.lat, FERNSEHTURM.lon);
  const illumination = getMoonIllumination(when);
  toDirection(sunDirection, sunAt.az, sunAt.alt);
  toDirection(moonDirection, moonAt.az, moonAt.alt);
  const rig = lightAt(sunAt.alt, moonAt.alt, illumination.fraction, Number(timeInput.value));
  keyDirection.copy(rig.key.body === 'sun' ? sunDirection : moonDirection);
  sun.color.setRGB(...rig.key.colour);
  sun.intensity = rig.key.intensity;
  sky.color.setRGB(...rig.sky);
  sky.intensity = rig.skyI;
  sky.groundColor.copy(sky.color).multiplyScalar(0.84);
  background.setRGB(...rig.haze);
  scene.background = background;
  cityUniforms.uHazeColour.value.copy(background);

  cityUniforms.uLights.value = rig.lights;
  cityUniforms.uWindows.value = rig.lights * rig.windows;
  ribbonUniforms.uDay.value = 1 - smooth(rig.lights, 0.1, 0.7);
  cityUniforms.uKeyDir.value.copy(keyDirection);
  cityUniforms.uKeyLight.value.copy(sun.color).multiplyScalar(sun.intensity);
  // What the water mirrors where no building stands: the sky, a little brighter than the ground.
  mirrorSky.copy(sky.color).multiply(WATER_TINT).multiplyScalar((sky.intensity / Math.PI) * 1.15);
  cityUniforms.uSkyLight.value.copy(mirrorSky);
  bloom.strength = 0.55 * rig.lights;
  bloom.enabled = rig.lights > 0.02;

  night = sunAt.alt < -3;
  document.body.dataset.night = String(night);
  bodies = [];
  if (sunAt.alt > -1) bodies.push({ az: sunAt.az, alt: sunAt.alt, sunAlt: sunAt.alt });
  if (moonAt.alt > -1) bodies.push({ az: moonAt.az, alt: moonAt.alt, sunAlt: sunAt.alt, moon: illumination });

  clock.textContent = `${String(Math.floor(timeInput.value / 60)).padStart(2, '0')}:${String(timeInput.value % 60).padStart(2, '0')}`;
  const phase = LIGHT_PHASE_NAMES[lightPhaseAt(sunAt.alt)];
  sunLabel.textContent = `${phase} \u00b7 ${sunAt.alt > -0.5 ? `sun ${sunAt.alt.toFixed(0)}\u00b0` : moonAt.alt > 0 ? `moon ${Math.round(illumination.fraction * 100)}% lit` : 'moon down'}`;
  updateHighlights(when.getTime());
  invalidateShadows();
}

// ---- Streets lined up with the sun or moon -----------------------------------------------
const RAY_COLOUR = { sun: [1, 0.6, 0.16], moon: [0.56, 0.7, 1] };
const NEON_CSS = { sun: '#f26a12', moon: '#5b82ff' };
let views = [];
let moments = [];
let highlights = null;
let groundAt = () => 0;
let shownKey = null;
let stands = [];

function updateHighlights(t) {
  if (!highlights) return;
  const live = moments.filter((m) => t >= m.from - 60_000 && t <= m.to + 60_000);
  const key = live.map((m) => `${m.body}${views.indexOf(m.view)}`).join('|');
  if (key === shownKey) return;
  shownKey = key;
  highlights.set(live.map((m) => ({ a: m.view.a, b: m.view.b, colour: RAY_COLOUR[m.body], altitude: m.bodyAlt })));
  stands = live.map((m) => ({ x: m.view.a[0], z: m.view.a[1], y: groundAt(m.view.a[0], m.view.a[1]) + 2, name: m.view.name, css: NEON_CSS[m.body] }));
}

function dayStart() {
  const [y, m, d] = dateInput.value.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  return guess.getTime() - berlinOffsetMinutes(guess) * 60_000;
}

function updateDay() {
  const from = dayStart();
  const to = from + 86_400_000;
  const stops = lightGradientStops(lightBands(from, to, FERNSEHTURM.lat, FERNSEHTURM.lon, 300_000), from, to);
  timeInput.style.setProperty('--phases', stops.map((s) => `${PHASE_COLOURS[s.phase]} ${(s.at * 100).toFixed(1)}%`).join(','));
  moments = [
    ...streetMoments(views, 'sun', from, to, FERNSEHTURM.lat, FERNSEHTURM.lon),
    ...streetMoments(views, 'moon', from, to, FERNSEHTURM.lat, FERNSEHTURM.lon),
  ].sort((a, b) => a.peak - b.peak);
  shownKey = null;
  const list = document.getElementById('moments');
  list.replaceChildren();
  const seen = new Set();
  // The longest views are the ones worth a trip; the rest can still be found with the slider.
  const best = [...moments].sort((a, b) => b.view.lengthM - a.view.lengthM).slice(0, 14).sort((a, b) => a.peak - b.peak);
  for (const moment of best) {
    // One chip per street: both directions of a street rarely share a moment, but parts can.
    const key = `${moment.view.name}${moment.body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const chip = document.createElement('button');
    const minutes = Math.round((moment.peak - from) / 60_000);
    const stamp = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    chip.textContent = `${stamp} ${moment.view.name}`;
    chip.dataset.body = moment.body;
    chip.addEventListener('click', () => {
      timeInput.value = String(minutes);
      updateSun();
      flyTo((moment.view.a[0] + moment.view.b[0]) / 2, (moment.view.a[1] + moment.view.b[1]) / 2);
    });
    list.append(chip);
  }
  document.getElementById('moments-empty').hidden = seen.size > 0;
}

const PHASE_COLOURS = { night: '#1b2140', twilight: '#2f3a6e', blue: '#3f62b5', golden: '#f0a03c', day: '#f3e6c4' };

let flight = null;
function flyTo(x, z) {
  flight = { from: controls.target.clone(), to: new THREE.Vector3(x, 0, z), start: performance.now() };
  invalidate();
}

function stepFlight(now) {
  if (!flight) return;
  const t = Math.min(1, (now - flight.start) / 700);
  const eased = t * t * (3 - 2 * t);
  const next = flight.from.clone().lerp(flight.to, eased);
  const delta = next.sub(controls.target);
  controls.target.add(delta);
  camera.position.add(delta);
  shadowsDirty = true;
  dirty = true;
  if (t === 1) flight = null;
}

const corner = new THREE.Vector3();
const farCorner = new THREE.Vector3();
const lightView = new THREE.Matrix4();

function fitShadow() {
  const distance = LIGHT_DISTANCE;
  const anchor = controls.target;
  sun.target.position.copy(anchor);
  sun.position.copy(anchor).addScaledVector(keyDirection, distance);
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
let base = null;
let lastFrame = performance.now();
const panel = document.querySelector('.panel');
const history = [];

/** Haze starts beyond the middle of the view, whatever the zoom. */
function updateHaze() {
  const u = cityUniforms;
  u.uHazeFocus.value.set(controls.target.x, controls.target.z);
  const height = worldHeightNow();
  if (camera.isPerspectiveCamera) {
    u.uHazeNear.value = height * 1.5;
    u.uHazeFar.value = height * 6;
    edgeBlur.uniforms.uFar.value = 1;
  } else {
    const across = Math.hypot(height, (height * innerWidth) / innerHeight) / 2;
    u.uHazeNear.value = across * 0.62;
    u.uHazeFar.value = across * 1.5;
    edgeBlur.uniforms.uFar.value = mode === 'iso' ? 0.6 : 0;
  }
}

const mirrorCameras = new Map();
const mirrorLook = new THREE.Vector3();
const mirrorUp = new THREE.Vector3();

/**
 * A second view of the buildings from below the water, as in a mirror, for the water to sample.
 * Straight down there is nothing to see in it, and only buildings near water can appear.
 */
function renderMirror() {
  cityUniforms.uMirrorOn.value = 0;
  if (mode === 'top' || !base || MIRROR_SCALE <= 0) return;
  const near = tiles.filter((tile) => tile.nearWater && tile.mesh);
  tileSphere.radius = 0;
  viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  viewFrustum.setFromProjectionMatrix(viewMatrix);
  const visible = near.some((tile) => {
    tileSphere.center.copy(tile.center);
    tileSphere.radius = tile.radius + REFLECTION_REACH_M;
    return viewFrustum.intersectsSphere(tileSphere);
  });
  if (!visible) return;
  let mirror = mirrorCameras.get(camera);
  if (!mirror) {
    mirror = camera.clone();
    mirrorCameras.set(camera, mirror);
  }
  const level = cityUniforms.uWaterLevel.value;
  camera.getWorldDirection(mirrorLook);
  mirrorUp.set(0, 1, 0).transformDirection(camera.matrixWorld);
  mirror.position.set(camera.position.x, 2 * level - camera.position.y, camera.position.z);
  mirror.up.set(mirrorUp.x, -mirrorUp.y, mirrorUp.z);
  mirrorLook.y = -mirrorLook.y;
  mirrorLook.add(mirror.position);
  mirror.lookAt(mirrorLook);
  mirror.projectionMatrix.copy(camera.projectionMatrix);
  mirror.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
  mirror.updateMatrixWorld();
  cityUniforms.uMirrorVP.value.multiplyMatrices(mirror.projectionMatrix, mirror.matrixWorldInverse);

  const hidden = [];
  for (const tile of tiles) {
    if (tile.mesh && !tile.nearWater) {
      tile.mesh.visible = false;
      hidden.push(tile.mesh);
    }
  }
  base.material = mirrorGround;
  highlights.group.visible = false;
  const shadowsWanted = renderer.shadowMap.needsUpdate;
  renderer.shadowMap.needsUpdate = false;
  const page = scene.background;
  scene.background = mirrorSky;
  renderer.setRenderTarget(mirrorTarget);
  renderer.clear();
  renderer.render(scene, mirror);
  renderer.setRenderTarget(null);
  scene.background = page;
  renderer.shadowMap.needsUpdate = shadowsWanted;
  highlights.group.visible = true;
  base.material = groundMaterial;
  for (const mesh of hidden) mesh.visible = true;
  cityUniforms.uMirrorOn.value = 1;
}

function frame(now) {
  requestAnimationFrame(frame);
  stepFlight(now);
  const litNow = cityUniforms.uLights.value > 0.12 && beaconLit(Date.now());
  if (litNow !== beacons.visible) {
    beacons.visible = litNow;
    // Waking the renderer for a blink only matters if the tower is on screen.
    viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    viewFrustum.setFromProjectionMatrix(viewMatrix);
    if (viewFrustum.intersectsSphere(TOWER_BOUND)) invalidate();
  }
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
  // Without a key light the existing shadow map goes unread, so it can wait.
  if (shadowsDirty && sun.intensity > 0) {
    fitShadow();
    shadowsDirty = false;
  }
  renderer.info.reset();
  updateHaze();
  renderMirror();
  renderPass.camera = camera;
  composer.render();
  drawOverlay({ camera, target: controls.target, night, bodies, stands, bottomInset: panel.offsetHeight + 16 });
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
  const mapData = await (await fetch('/city/map.json')).json();
  const roadPoints = new Int16Array(await (await fetch('/city/roads.bin')).arrayBuffer());
  const streetsDoc = await (await fetch('/city/streets.json')).json();
  const terrainInfo = await (await fetch('/city/terrain.json')).json();
  const terrain = new Int16Array(await (await fetch('/city/terrain.bin')).arrayBuffer());
  const { size, half } = terrainInfo;
  const plane = new THREE.PlaneGeometry(half * 2, half * 2, size - 1, size - 1);
  plane.rotateX(-Math.PI / 2);
  const positions = plane.attributes.position;
  for (let i = 0; i < positions.count; i++) positions.setY(i, terrain[i] / 10 - 0.4);
  const spacing = (half * 2) / (size - 1);
  groundAt = (x, z) => {
    const u = Math.min(size - 1.001, Math.max(0, (x + half) / spacing));
    const v = Math.min(size - 1.001, Math.max(0, (z + half) / spacing));
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const at = (a, b) => terrain[b * size + a] / 10;
    return (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
  };
  cityUniforms.uHalf.value = half;
  cityUniforms.uTerrain.value = makeTerrainTexture(terrain, size);
  cityUniforms.uMap.value = paintGroundMap(mapData, mapData.runs, roadPoints, half, isPhone ? 2048 : 4096, renderer);
  setLabels(mapData, groundAt);
  highlights = makeHighlights(scene, groundAt);
  views = decodeStreets(streetsDoc).map((view, i) => ({ ...view, a: [streetsDoc.scene[i][0], streetsDoc.scene[i][1]], b: [streetsDoc.scene[i][2], streetsDoc.scene[i][3]] }));
  updateDay();
  updateSun();
  plane.computeVertexNormals();
  plane.computeBoundingSphere();
  base = new THREE.Mesh(plane, groundMaterial);
  base.receiveShadow = true;
  scene.add(base);

  // A small copy of the painted map, to find the tiles close enough to water to reflect in it.
  const WATER_GRID = 256;
  const small = document.createElement('canvas');
  small.width = small.height = WATER_GRID;
  const smallCtx = small.getContext('2d', { willReadFrequently: true });
  smallCtx.drawImage(cityUniforms.uMap.value.image, 0, 0, WATER_GRID, WATER_GRID);
  const waterPixels = smallCtx.getImageData(0, 0, WATER_GRID, WATER_GRID).data;
  const waterNear = (min, max) => {
    const cell = (v) => Math.floor(((v + half) / (2 * half)) * WATER_GRID);
    const low = (v) => Math.max(0, cell(v - REFLECTION_REACH_M));
    const high = (v) => Math.min(WATER_GRID - 1, cell(v + REFLECTION_REACH_M));
    for (let row = low(min[2]); row <= high(max[2]); row++) {
      for (let col = low(min[0]); col <= high(max[0]); col++) {
        if (waterPixels[(row * WATER_GRID + col) * 4 + 1] > 12) return true;
      }
    }
    return false;
  };

  await MeshoptDecoder.ready;
  for (const tile of manifest.tiles) {
    const coarse = tile.lods[tile.lods.length - 1];
    tile.center = new THREE.Vector3().fromArray(coarse.min).add(new THREE.Vector3().fromArray(coarse.max)).multiplyScalar(0.5);
    tile.radius = new THREE.Vector3().fromArray(coarse.max).distanceTo(new THREE.Vector3().fromArray(coarse.min)) / 2;
    tile.level = -1;
    tile.nearWater = waterNear(coarse.min, coarse.max);
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
dateInput.addEventListener('input', () => {
  updateDay();
  updateSun();
});
timeInput.addEventListener('input', updateSun);
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  resizeOverlay();
  ribbonUniforms.uViewportH.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  sizeMirror();
  sizeBlur();
  perspective.aspect = innerWidth / innerHeight;
  perspective.updateProjectionMatrix();
  const h = worldHeightNow();
  worldHeight = h;
  if (camera.isOrthographicCamera) fitOrthographic();
  invalidateShadows();
});

resizeOverlay();
setMode(params.get('mode') ?? 'iso');
updateSun();
requestAnimationFrame(frame);
start();
window.__mini = { cityUniforms, sun, sky, bloom, scene, groundMaterial, setMode, invalidate, invalidateShadows, stats, getHistory: () => history, get camera() { return camera; }, get controls() { return controls; }, renderer };
