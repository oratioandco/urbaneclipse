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
import { drawOverlay, drawPhotographer, resizeOverlay, setLabels } from './overlay.js';
import { makeSky, skyUniforms } from './sky.js';
import { EYE_HEIGHT, LENS_MAX, LENS_MIN, attachLook, compassName, fovForLens, lookDirection, sceneFromLatLon, setLens } from './eye.js';
import { skyPalette } from '../../../src/lib/skyPalette.ts';

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
// One overview camera tilts continuously from straight down to a low angle. A narrow field of
// view keeps the angled view close to the miniature look of a parallel projection.
const FOV = 28;
const TILT_MAX = THREE.MathUtils.degToRad(80);
const overview = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 10, 80_000);
const eyeCamera = new THREE.PerspectiveCamera(fovForLens(50), innerWidth / innerHeight, 1, 40_000);
let camera = overview;
const START = { top: [0, 0], iso: [54.7, 35], free: [68, 35] };
const [startTilt, startHeading] = START[params.get('mode')] ?? START.iso;
const startHeight = Number(params.get('height')) || (isPhone ? 3200 : 2400);
overview.position
  .setFromSphericalCoords(startHeight / (2 * Math.tan((FOV * Math.PI) / 360)), THREE.MathUtils.degToRad(Number(params.get('tilt') ?? startTilt)) + 1e-4, THREE.MathUtils.degToRad(Number(params.get('heading') ?? startHeading)));
const controls = new MapControls(overview, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = false;
controls.minDistance = 120;
controls.maxDistance = 60_000;
controls.minPolarAngle = 0;
controls.maxPolarAngle = TILT_MAX;
controls.addEventListener('change', invalidate);

function worldHeightNow() {
  return 2 * overview.position.distanceTo(controls.target) * Math.tan((FOV * Math.PI) / 360);
}

/** Turn and tilt the overview smoothly; null keeps a value as it is. */
let orbitAnimation = null;
function orbitTo(polar, azimuth, ms = 700) {
  const offset = new THREE.Spherical().setFromVector3(overview.position.clone().sub(controls.target));
  let to = azimuth ?? offset.theta;
  to = offset.theta + ((((to - offset.theta) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  orbitAnimation = { from: offset.clone(), polar: polar ?? offset.phi, azimuth: to, start: performance.now(), ms };
  invalidate();
}

function stepOrbit(now) {
  if (!orbitAnimation) return;
  const { from, polar, azimuth, start, ms } = orbitAnimation;
  const t = smooth(Math.min(1, (now - start) / ms), 0, 1);
  const at = new THREE.Spherical(from.radius, THREE.MathUtils.lerp(from.phi, polar, t) + 1e-4, THREE.MathUtils.lerp(from.theta, azimuth, t));
  overview.position.setFromSpherical(at).add(controls.target);
  overview.lookAt(controls.target);
  shadowsDirty = true;
  dirty = true;
  if (t >= 1) orbitAnimation = null;
}

// ---- Standing in the street ------------------------------------------------------------
const look = { active: false, x: 0, y: 0, z: 0, heading: 0, pitch: 0, lens: 50 };
let photographer = null;
let transition = null;
let savedOverview = null;
const skyDome = makeSky();
scene.add(skyDome);

function eyePose(state) {
  const position = new THREE.Vector3(state.x, state.y + EYE_HEIGHT, state.z);
  const helper = new THREE.Object3D();
  helper.position.copy(position);
  helper.lookAt(position.clone().add(lookDirection(state.heading, state.pitch)));
  // Object3D.lookAt points +z at the target; cameras look down -z, so turn round.
  helper.rotateY(Math.PI);
  return { position, quaternion: helper.quaternion.clone(), fov: fovForLens(state.lens) };
}

function overviewPose() {
  return { position: overview.position.clone(), quaternion: overview.quaternion.clone(), fov: FOV };
}

/** Which way to face on arrival: down a lined-up street, else toward the sun, moon or tower. */
function chooseView(x, z) {
  const y = groundAt(x, z);
  const t = instant().getTime();
  const street = moments.find((m) => t >= m.from - 60_000 && t <= m.to + 60_000 && Math.hypot(m.view.a[0] - x, m.view.a[1] - z) < 80);
  if (street) return { heading: street.view.bearingDeg, pitch: THREE.MathUtils.clamp(street.bodyAlt * 0.9, 0, 12), lens: 85 };
  for (const body of bodies) {
    if (body.alt > -1) return { heading: body.az, pitch: THREE.MathUtils.clamp(body.alt * 0.8, 0, 25), lens: body.moon ? 85 : 35 };
  }
  const distance = Math.hypot(x, z) || 1;
  return { heading: (Math.atan2(-x, z) * 180) / Math.PI, pitch: THREE.MathUtils.clamp((Math.atan2(200 - y, distance) * 180) / Math.PI, 0, 30), lens: 50 };
}

/** How far one can see along a heading from a spot, up to `far` metres. */
function sightline(x, z, heading, far = 300) {
  const eye = new THREE.Vector3(x, groundAt(x, z) + EYE_HEIGHT, z);
  raycaster.set(eye, lookDirection(heading, 0));
  raycaster.far = far;
  const meshes = tiles.filter((tile) => tile.mesh && tile.center.distanceTo(eye) < tile.radius + far).map((tile) => tile.mesh);
  meshes.push(tower);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  raycaster.far = Infinity;
  return hit ? hit.distance : far;
}

/** Keep the chosen direction unless a wall is right there; then turn to the nearest open view. */
function openView(x, z, view) {
  if (sightline(x, z, view.heading) >= 60) return view;
  let best = view;
  let bestReach = 0;
  for (const turn of [30, -30, 60, -60, 90, -90, 135, -135, 180]) {
    const reach = sightline(x, z, view.heading + turn);
    if (reach > bestReach) {
      bestReach = reach;
      best = { ...view, heading: view.heading + turn, pitch: Math.min(view.pitch, 6) };
    }
    if (reach >= 150) break;
  }
  return best;
}

function enterEye(x, z, view = openView(x, z, chooseView(x, z))) {
  const y = groundAt(x, z);
  Object.assign(look, { x, y, z, ...view, active: false });
  photographer = { x, y, z, heading: look.heading };
  orbitAnimation = null;
  flight = null;
  const wasStanding = camera === eyeCamera;
  const from = wasStanding ? { position: eyeCamera.position.clone(), quaternion: eyeCamera.quaternion.clone(), fov: eyeCamera.fov } : overviewPose();
  if (!wasStanding) savedOverview = { position: overview.position.clone(), target: controls.target.clone() };
  controls.enabled = false;
  camera = eyeCamera;
  transition = { from, to: eyePose(look), start: performance.now(), ms: wasStanding ? 900 : 1700, done: () => (look.active = true) };
  document.body.dataset.eye = 'true';
  updateEyeBar();
  invalidateShadows();
}

function exitEye() {
  if (!savedOverview) return;
  look.active = false;
  overview.position.copy(savedOverview.position);
  controls.target.copy(savedOverview.target);
  overview.lookAt(controls.target);
  transition = {
    from: { position: eyeCamera.position.clone(), quaternion: eyeCamera.quaternion.clone(), fov: eyeCamera.fov },
    to: overviewPose(),
    start: performance.now(),
    ms: 1400,
    done: () => {
      camera = overview;
      controls.enabled = true;
      document.body.dataset.eye = 'false';
    },
  };
  invalidateShadows();
}

function stepTransition(now) {
  if (!transition) return false;
  const { from, to, start, ms } = transition;
  const raw = Math.min(1, (now - start) / ms);
  const t = raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2;
  eyeCamera.position.lerpVectors(from.position, to.position, t);
  eyeCamera.quaternion.slerpQuaternions(from.quaternion, to.quaternion, t);
  eyeCamera.fov = THREE.MathUtils.lerp(from.fov, to.fov, t);
  if (raw >= 1) {
    const done = transition.done;
    transition = null;
    done();
  }
  return true;
}

function placeEyeCamera() {
  if (!look.active) return;
  const pose = eyePose(look);
  eyeCamera.position.copy(pose.position);
  eyeCamera.quaternion.copy(pose.quaternion);
  eyeCamera.fov = pose.fov;
  photographer.heading = look.heading;
}

const lensInput = document.getElementById('lens');
const lensLabel = document.getElementById('lens-label');
const facingLabel = document.getElementById('facing');
function updateEyeBar() {
  lensInput.value = String((Math.log(look.lens / LENS_MIN) / Math.log(LENS_MAX / LENS_MIN)) * 1000);
  lensLabel.textContent = `${Math.round(look.lens)} mm`;
  const heading = ((look.heading % 360) + 360) % 360;
  facingLabel.textContent = `Facing ${compassName(heading)} ${Math.round(heading)}\u00b0`;
}

attachLook(renderer.domElement, look, () => {
  updateEyeBar();
  invalidateShadows();
});
lensInput.addEventListener('input', () => setLens(look, LENS_MIN * (LENS_MAX / LENS_MIN) ** (Number(lensInput.value) / 1000), () => {
  updateEyeBar();
  invalidateShadows();
}));
document.getElementById('back').addEventListener('click', exitEye);

let lookAnimation = null;
function turnTo(heading, pitch) {
  const delta = ((((heading - look.heading) % 360) + 540) % 360) - 180;
  lookAnimation = { from: [look.heading, look.pitch], to: [look.heading + delta, pitch], start: performance.now() };
  invalidate();
}
function stepLook(now) {
  if (!lookAnimation) return;
  const t = smooth(Math.min(1, (now - lookAnimation.start) / 600), 0, 1);
  look.heading = THREE.MathUtils.lerp(lookAnimation.from[0], lookAnimation.to[0], t);
  look.pitch = THREE.MathUtils.lerp(lookAnimation.from[1], lookAnimation.to[1], t);
  updateEyeBar();
  shadowsDirty = true;
  dirty = true;
  if (t >= 1) lookAnimation = null;
}

/** Face a body: at eye level by turning, from above by rotating the map so it lies ahead. */
function face(body) {
  if (camera === eyeCamera) turnTo(body.az, THREE.MathUtils.clamp(body.alt * 0.8, -5, 40));
  else orbitTo(null, -THREE.MathUtils.degToRad(body.az));
}

// ---- Putting the photographer down -------------------------------------------------------
const raycaster = new THREE.Raycaster();
let roadXZ = null;

/** Where a screen point meets the ground, refined against the terrain heights. */
function groundUnder(clientX, clientY) {
  const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const { origin, direction } = raycaster.ray;
  if (direction.y >= -1e-4) return null;
  let height = groundAt(controls.target.x, controls.target.z);
  let point = null;
  for (let i = 0; i < 4; i++) {
    point = origin.clone().addScaledVector(direction, (height - origin.y) / direction.y);
    height = groundAt(point.x, point.z);
  }
  return point;
}

function underRoof(x, z) {
  raycaster.set(new THREE.Vector3(x, 2000, z), new THREE.Vector3(0, -1, 0));
  const near = tiles.filter((tile) => tile.mesh && Math.abs(tile.center.x - x) < tile.radius && Math.abs(tile.center.z - z) < tile.radius).map((tile) => tile.mesh);
  near.push(tower);
  const hit = raycaster.intersectObjects(near, false)[0];
  return Boolean(hit) && hit.point.y > groundAt(x, z) + 1.5;
}

/** Somewhere to stand: out in the open, with a view at least one way. */
const roomy = (x, z) => !underRoof(x, z) && [0, 90, 180, 270].some((heading) => sightline(x, z, heading, 120) >= 80);

/** The spot itself if it is roomy, else the nearest roomy point on a street. */
function standable(point) {
  if (roomy(point.x, point.z) || !roadXZ) return point;
  const candidates = [];
  for (let i = 0; i < roadXZ.length; i += 2) {
    const x = roadXZ[i] / 2;
    const z = roadXZ[i + 1] / 2;
    const d = Math.hypot(x - point.x, z - point.z);
    if (d < 500) candidates.push([d, x, z]);
  }
  candidates.sort((a, b) => a[0] - b[0]);
  for (const [, x, z] of candidates.slice(0, 40)) {
    if (roomy(x, z)) return new THREE.Vector3(x, groundAt(x, z), z);
  }
  return point;
}

const tool = document.getElementById('photographer');
const ghost = document.getElementById('ghost');
{
  const context = ghost.getContext('2d');
  ghost.width = ghost.height = 2 * 48;
  context.scale(2, 2);
  drawPhotographer(24, 44, context);
}
let drag = null;
// The drag is followed on the window, so it ends wherever the pointer is let go.
function dragMove(event) {
  if (!drag) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true;
  if (!drag.moved) return;
  ghost.hidden = false;
  ghost.style.transform = `translate(${event.clientX - 24}px, ${event.clientY - 44}px)`;
}
function dragEnd(event) {
  removeEventListener('pointermove', dragMove);
  removeEventListener('pointerup', dragEnd);
  removeEventListener('pointercancel', dragEnd);
  if (!drag) return;
  const { moved } = drag;
  drag = null;
  ghost.hidden = true;
  if (event.type === 'pointercancel') return;
  if (!moved) {
    // A tap stands the photographer in the middle of the map.
    const spot = standable(controls.target.clone().setY(groundAt(controls.target.x, controls.target.z)));
    enterEye(spot.x, spot.z);
    return;
  }
  const over = document.elementFromPoint(event.clientX, event.clientY);
  if (over !== renderer.domElement) return;
  const point = groundUnder(event.clientX, event.clientY);
  if (!point) return;
  const spot = standable(point);
  enterEye(spot.x, spot.z);
}
tool.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  drag = { x: event.clientX, y: event.clientY, moved: false };
  addEventListener('pointermove', dragMove);
  addEventListener('pointerup', dragEnd);
  addEventListener('pointercancel', dragEnd);
});

// Taps on the overlay: the pills turn the view toward their body, the marker goes back down.
let taps = [];
let press = null;
renderer.domElement.addEventListener('pointerdown', (event) => {
  press = { x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!press || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) return;
  const hit = taps.find((t) => event.clientX >= t.x && event.clientX <= t.x + t.w && event.clientY >= t.y && event.clientY <= t.y + t.h);
  if (hit?.kind === 'pill') face(hit.body);
  if (hit?.kind === 'photographer' && photographer) enterEye(photographer.x, photographer.z, { heading: photographer.heading, pitch: look.pitch, lens: look.lens });
});
renderer.domElement.addEventListener('dblclick', (event) => {
  // At eye level, a double tap on the ground walks there.
  if (!look.active) return;
  const point = groundUnder(event.clientX, event.clientY);
  if (!point || point.distanceTo(eyeCamera.position) > 600) return;
  const spot = standable(point);
  enterEye(spot.x, spot.z, { heading: look.heading, pitch: look.pitch, lens: look.lens });
});

const compass = document.getElementById('compass');
const needle = compass.querySelector('svg');
compass.addEventListener('click', () => {
  if (camera === eyeCamera) turnTo(0, look.pitch);
  else orbitTo(null, 0);
});
const tiltButton = document.getElementById('tilt');
tiltButton.addEventListener('click', () => orbitTo(controls.getPolarAngle() < 0.2 ? THREE.MathUtils.degToRad(55) : 0, null));

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
  return (2 * camera.position.distanceTo(point) * Math.tan((camera.fov * Math.PI) / 360)) / innerHeight;
}

/** What the view is about: the map's centre, or where the photographer stands. */
const focusPoint = () => (camera === eyeCamera ? eyeCamera.position : controls.target);

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
    wanted.push({ tile, lod, inView, distance: tile.center.distanceTo(focusPoint()) });
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
let bloomLights = 0;

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

  const palette = skyPalette('sun', sunAt.alt);
  skyUniforms.uHorizon.value.copy(background);
  skyUniforms.uZenith.value.setRGB(...palette.skyTop, THREE.SRGBColorSpace);
  skyUniforms.uSunDir.value.copy(sunDirection);
  skyUniforms.uMoonDir.value.copy(moonDirection);
  skyUniforms.uSunColour.value.setRGB(...palette.discTint, THREE.SRGBColorSpace);
  skyUniforms.uGlowColour.value.setRGB(...palette.glowColor, THREE.SRGBColorSpace);
  skyUniforms.uGlow.value = palette.glowStrength * smooth(sunAt.alt, -4, 0);
  skyUniforms.uMoonLight.value = THREE.MathUtils.lerp(1.6, 0.55, smooth(sunAt.alt, -6, 4));
  bloomLights = rig.lights;

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
      const [x, z] = moment.view.a;
      photographer = { x, y: groundAt(x, z), z, heading: moment.view.bearingDeg };
      if (camera === eyeCamera) enterEye(x, z, { heading: moment.view.bearingDeg, pitch: THREE.MathUtils.clamp(moment.bodyAlt * 0.9, 0, 12), lens: 85 });
      else flyTo((moment.view.a[0] + moment.view.b[0]) / 2, (moment.view.a[1] + moment.view.b[1]) / 2);
      invalidate();
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

/** Standing up, shadows matter most within a few hundred metres ahead. */
const EYE_SHADOW_SPAN = 1400;

function fitShadow() {
  const distance = LIGHT_DISTANCE;
  const standing = camera === eyeCamera && eyeCamera.position.y - groundAt(eyeCamera.position.x, eyeCamera.position.z) < 300;
  const ahead = lookDirection(look.heading, 0).multiplyScalar(EYE_SHADOW_SPAN * 0.3);
  const anchor = standing ? eyeCamera.position.clone().add(ahead).setY(look.y) : controls.target;
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
      if (standing) {
        minX = Math.min(minX, (x * EYE_SHADOW_SPAN) / 2);
        maxX = Math.max(maxX, (x * EYE_SHADOW_SPAN) / 2);
        minY = Math.min(minY, (y * EYE_SHADOW_SPAN) / 2);
        maxY = Math.max(maxY, (y * EYE_SHADOW_SPAN) / 2);
        continue;
      }
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

/** Haze starts beyond the middle of the view, whatever the zoom; standing, it is the real air. */
function updateHaze(street) {
  const u = cityUniforms;
  const height = worldHeightNow();
  const across = Math.hypot(height, (height * innerWidth) / innerHeight) / 2;
  const tilt = smooth(controls.getPolarAngle(), THREE.MathUtils.degToRad(35), THREE.MathUtils.degToRad(68));
  let near = THREE.MathUtils.lerp(across * 0.62, height * 1.5, tilt);
  let far = THREE.MathUtils.lerp(across * 1.5, height * 6, tilt);
  const focus = camera === eyeCamera ? eyeCamera.position : controls.target;
  near = THREE.MathUtils.lerp(near, 1200, street);
  far = THREE.MathUtils.lerp(far, 14_000, street);
  u.uHazeFocus.value.set(focus.x, focus.z);
  u.uHazeNear.value = near;
  u.uHazeFar.value = far;
  edgeBlur.uniforms.uFar.value = tilt * 0.8;
  edgeBlur.enabled = params.get('blur') !== '0' && street < 0.5;
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
  if ((camera === overview && controls.getPolarAngle() < 0.14) || !base || MIRROR_SCALE <= 0) return;
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
  const domeShown = skyDome.visible;
  skyDome.visible = false;
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
  skyDome.visible = domeShown;
  base.material = groundMaterial;
  for (const mesh of hidden) mesh.visible = true;
  cityUniforms.uMirrorOn.value = 1;
}

function frame(now) {
  requestAnimationFrame(frame);
  stepFlight(now);
  stepOrbit(now);
  stepLook(now);
  const flying = stepTransition(now);
  placeEyeCamera();
  if (flying) {
    shadowsDirty = true;
    dirty = true;
  }
  const litNow = cityUniforms.uLights.value > 0.12 && beaconLit(Date.now());
  if (litNow !== beacons.visible) {
    beacons.visible = litNow;
    // Waking the renderer for a blink only matters if the tower is on screen.
    viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    viewFrustum.setFromProjectionMatrix(viewMatrix);
    if (viewFrustum.intersectsSphere(TOWER_BOUND)) invalidate();
  }
  const moved = controls.enabled && controls.update();
  if (moved) shadowsDirty = true;
  if (!dirty && !moved && !window.__forceRender) {
    lastFrame = now;
    return;
  }
  dirty = false;
  history.push(now - lastFrame);
  if (history.length > 60) history.shift();
  lastFrame = now;
  // How far into the street the camera has come: 0 high above, 1 standing.
  let street = 0;
  if (camera === eyeCamera) {
    const above = eyeCamera.position.y - groundAt(eyeCamera.position.x, eyeCamera.position.z);
    street = 1 - smooth(above, 120, 900);
    eyeCamera.near = THREE.MathUtils.clamp(above / 150, 0.8, 10);
    eyeCamera.updateProjectionMatrix();
  }
  skyDome.visible = street > 0.001;
  skyDome.position.copy(camera.position);
  skyUniforms.uFade.value = street;
  // The sun's disc needs bloom at street level; from above only the city's lights do.
  bloom.enabled = bloomLights > 0.02 || street > 0.5;
  bloom.strength = Math.max(0.55 * bloomLights, 0.45 * street);
  bloom.threshold = street > 0.5 ? 1.2 : 0.95;
  camera.updateMatrixWorld();
  updateLevels();
  // Without a key light the existing shadow map goes unread, so it can wait.
  if (shadowsDirty && sun.intensity > 0) {
    fitShadow();
    shadowsDirty = false;
  }
  renderer.info.reset();
  updateHaze(street);
  renderMirror();
  renderPass.camera = camera;
  composer.render();
  taps = drawOverlay({
    camera,
    target: controls.target,
    night,
    bodies,
    stands: street > 0 ? [] : stands,
    bottomInset: panel.offsetHeight + 16,
    eye: street > 0.5 ? look : null,
    photographer: street > 0 ? null : photographer,
  });
  needle.style.transform = `rotate(${camera === eyeCamera ? -look.heading : THREE.MathUtils.radToDeg(controls.getAzimuthalAngle())}deg)`;
  tiltButton.textContent = controls.getPolarAngle() < 0.2 ? '3D' : '2D';
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
  roadXZ = roadPoints;
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
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  resizeOverlay();
  ribbonUniforms.uViewportH.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  sizeMirror();
  sizeBlur();
  for (const c of [overview, eyeCamera]) {
    c.aspect = innerWidth / innerHeight;
    c.updateProjectionMatrix();
  }
  invalidateShadows();
});

resizeOverlay();
updateSun();
requestAnimationFrame(frame);
start();
window.__mini = { cityUniforms, sun, sky, bloom, scene, groundMaterial, enterEye, exitEye, look, sceneFromLatLon, views: () => views, face, orbitTo, invalidate, invalidateShadows, stats, getHistory: () => history, get camera() { return camera; }, get controls() { return controls; }, renderer };
