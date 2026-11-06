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
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { LIGHT_PHASE_NAMES, lightBands, lightGradientStops, lightPhaseAt } from '../lib/lightPhases.ts';
import { decodeStreets, streetMoments } from '../lib/streets.ts';
import { MIN_MOON_ILLUMINATION, SPHERE_CENTRE_AGL, alignmentLine, applyView, compassPoint, computeDayPath, pointAtTime } from '../lib/dailyPaths.ts';
import { VIEW_VISIBLE, loadViewshed, sampleViewshed } from '../lib/viewshed.ts';
import { lightAt } from './light.js';
import { cityUniforms, makeTerrainTexture, mirrorGround, shadeBuildings, shadeGround, shadeTower } from './shading.js';
import { makeHighlights, paintGroundMap, ribbonUniforms } from './map.js';
import { drawOverlay, drawPhotographer, resizeOverlay, setLabels } from './overlay.js';
import { makeSky, skyUniforms } from './sky.js';
import { drawMinimap, setMinimapGround } from './minimap.js';
import { litDiscPath } from '../lib/moonPhase.ts';
import { cloudDrift, cloudsAt, cloudsFor, forecastReach, readSky } from './weather.js';
import { formatClock, formatHour, formatMinutes, parseTime, uses12h } from './time.js';
import { EYE_HEIGHT, FIXED_FORMATS, FORMATS, SENSOR_FORMATS, attachLook, camera as cameraFormat, compassName, fovForLens, latLonFromScene, lensForFov, lensRange, lookDirection, sceneFromLatLon, setFormat, setLens } from './eye.js';
import { skyPalette } from '../lib/skyPalette.ts';
import { DISC_RADIUS_DEG, SPHERE_RADIUS_M, SPHERE_TOP_AGL, TIP_AGL, antennaRange, bodyAgainstTower, discOverSphere, visibleMoon } from './towerShots.js';

const params = new URLSearchParams(location.search);
/** The city's geometry, built by scripts/miniature and served from a volume. Bump the version on a rebuild. */
const CITY = '/city/';
const CITY_VERSION = '?v=1';
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
// Neutral keeps a colour's hue as it nears white, so low sun on a pale wall reads gold, not white.
renderer.toneMapping = THREE.NeutralToneMapping;
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
// The sunset sky's glow on walls facing it; see lightAt.
const glow = new THREE.DirectionalLight(0xffffff, 0);
scene.add(glow, glow.target);

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
/** A full-frame focal length on the current format, for the same framing. */
const fullFrame = (mm) => (mm * cameraFormat.format.width) / 36;
const look = { active: false, x: 0, y: 0, z: 0, heading: 0, pitch: 0, lens: 50 };
let photographer = null;
let transition = null;
let savedOverview = null;
const skyDome = makeSky();
scene.add(skyDome);

function eyePose(state) {
  const position = new THREE.Vector3(state.x, state.y + EYE_HEIGHT + (state.lift ?? 0), state.z);
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
  if (street) return { heading: street.view.bearingDeg, pitch: THREE.MathUtils.clamp(street.bodyAlt * 0.9, 0, 12), lens: fullFrame(85) };
  for (const body of bodies) {
    if (body.alt > -1) return { heading: body.az, pitch: THREE.MathUtils.clamp(body.alt * 0.8, 0, 25), lens: body.moon ? fullFrame(85) : fullFrame(35) };
  }
  const distance = Math.hypot(x, z) || 1;
  return { heading: (Math.atan2(-x, z) * 180) / Math.PI, pitch: THREE.MathUtils.clamp((Math.atan2(200 - y, distance) * 180) / Math.PI, 0, 30), lens: fullFrame(50) };
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
  Object.assign(look, { x, y, z, lift: 0, mode: 'walk', ...view, active: false });
  liftAnimation = null;
  photographer = { x, y, z, heading: look.heading };
  orbitAnimation = null;
  flight = null;
  const wasStanding = camera === eyeCamera;
  const from = wasStanding ? { position: eyeCamera.position.clone(), quaternion: eyeCamera.quaternion.clone(), fov: eyeCamera.fov } : overviewPose();
  if (!wasStanding) savedOverview = { position: overview.position.clone(), target: controls.target.clone() };
  controls.enabled = false;
  camera = eyeCamera;
  transition = { from, to: eyePose(look), start: performance.now(), ms: wasStanding ? 900 : 1700, done: () => (look.active = true) };
  if (document.body.dataset.eye !== 'true') nudgeKeys();
  showViewHere(null);
  document.body.dataset.eye = 'true';
  updateEyeBar();
  showFlight();
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
const formatSelect = document.getElementById('format');
for (const [label, group] of [['Camera', SENSOR_FORMATS], ['Phone and drone', FIXED_FORMATS]]) {
  const optgroup = document.createElement('optgroup');
  optgroup.label = label;
  for (const format of group) optgroup.append(new Option(format.label, format.id));
  formatSelect.append(optgroup);
}
const lensChips = document.getElementById('lens-chips');
let chipsFor = null;
/** A fixed-lens camera picks a lens with buttons; the others zoom with the slider. */
function showLensControl() {
  const format = cameraFormat.format;
  const fixed = Boolean(format.lenses);
  lensInput.hidden = fixed;
  lensLabel.hidden = fixed;
  lensChips.hidden = !fixed;
  if (fixed && chipsFor !== format.id) {
    chipsFor = format.id;
    lensChips.replaceChildren(
      ...format.lenses.map((mm, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.dataset.mm = String(mm);
        chip.innerHTML = format.names ? `${format.names[i]}<small>${mm}</small>` : `${mm}<small>mm</small>`;
        chip.addEventListener('click', () => setLens(look, mm, () => {
          updateEyeBar();
          invalidate();
        }));
        return chip;
      }),
    );
  }
  for (const chip of lensChips.children) chip.setAttribute('aria-pressed', String(Number(chip.dataset.mm) === look.lens));
}
try {
  const saved = localStorage.getItem('miniature.format');
  if (FORMATS.some((f) => f.id === saved)) cameraFormat.format = FORMATS.find((f) => f.id === saved);
} catch {}
formatSelect.value = cameraFormat.format.id;
formatSelect.addEventListener('change', () => {
  setFormat(look, formatSelect.value, () => {
    updateEyeBar();
    invalidate();
  });
  try {
    localStorage.setItem('miniature.format', formatSelect.value);
  } catch {}
});
const lensLabel = document.getElementById('lens-label');
const facingLabel = document.getElementById('facing');
function updateEyeBar() {
  const [lensMin, lensMax] = lensRange();
  lensInput.value = String((Math.log(look.lens / lensMin) / Math.log(lensMax / lensMin)) * 1000);
  formatSelect.value = cameraFormat.format.id;
  showLensControl();
  lensLabel.textContent = `${Math.round(look.lens)} mm`;
  const heading = ((look.heading % 360) + 360) % 360;
  facingLabel.textContent = `Facing ${compassName(heading)} ${Math.round(heading)}\u00b0`;
  const lift = look.lift ?? 0;
  if (look.mode === 'drone') facingLabel.textContent += ` \u00b7 ${Math.round(lift)} m up`;
  else if (lift >= 1) facingLabel.textContent += ` \u00b7 on a roof, ${Math.round(lift)} m up`;
}

attachLook(renderer.domElement, look, () => {
  updateEyeBar();
  invalidateShadows();
});
lensInput.addEventListener('input', () => setLens(look, lensRange()[0] * (lensRange()[1] / lensRange()[0]) ** (Number(lensInput.value) / 1000), () => {
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

// ---- Walking at eye level ------------------------------------------------------------------
const WALK_MPS = 14;
const RUN_MPS = 45;
const TURN_DPS = 70;
const CLIMB_MPS = 12;
/** The open-category ceiling for drones in the EU, metres above the ground. */
const MAX_LIFT_M = 120;
const TAKEOFF_M = 30;
const held = new Set();
let pad = 0;
let lastStep = 0;
let shadowFrom = null;
const KEYS = { shift: 'run', e: 'up', ' ': 'up', q: 'down', c: 'down', w: 'fwd', arrowup: 'fwd', s: 'back', arrowdown: 'back', a: 'left', d: 'right', arrowleft: 'turnL', arrowright: 'turnR' };
addEventListener('keydown', (event) => {
  if (!look.active || event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
  const key = KEYS[event.key.toLowerCase()];
  if (!key) return;
  held.add(key);
  if (event.shiftKey) held.add('run');
  showKeys();
  event.preventDefault();
  invalidate();
});
addEventListener('keyup', (event) => {
  held.delete(KEYS[event.key.toLowerCase()]);
  if (event.key === 'Shift') held.delete('run');
  showKeys();
});
addEventListener('blur', () => {
  held.clear();
  showKeys();
});
// The keys on screen light up while held, so it is clear they do something.
const keycaps = document.querySelectorAll('kbd[data-key]');
function showKeys() {
  for (const cap of keycaps) cap.classList.toggle('on', held.has(cap.dataset.key));
}
const keyHint = document.querySelector('.keys');
function nudgeKeys() {
  keyHint.classList.remove('hint');
  void keyHint.offsetWidth;
  keyHint.classList.add('hint');
}
// Touch: a stick for walking, like a game or a drone's controller. Up walks forward.
let padSide = 0;
{
  const stick = document.getElementById('stick');
  const knob = stick.querySelector('.knob');
  let centre = null;
  const move = (event) => {
    if (!centre) return;
    const reach = stick.clientWidth / 2 - 14;
    let dx = event.clientX - centre.x;
    let dy = event.clientY - centre.y;
    const d = Math.hypot(dx, dy);
    if (d > reach) {
      dx = (dx / d) * reach;
      dy = (dy / d) * reach;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // A small dead zone, so resting a thumb does not creep.
    const scale = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    pad = scale(-dy / reach);
    padSide = scale(dx / reach);
    invalidate();
  };
  const end = () => {
    centre = null;
    pad = 0;
    padSide = 0;
    knob.style.transform = '';
  };
  stick.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    try {
      stick.setPointerCapture(event.pointerId);
    } catch {}
    const box = stick.getBoundingClientRect();
    centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    move(event);
  });
  stick.addEventListener('pointermove', move);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(name, end);
}

// ---- Flying: take off, the height, and landing again ---------------------------------------
const takeoffButton = document.getElementById('takeoff');
const DRONE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="5.5" cy="5.5" r="3"/><circle cx="18.5" cy="5.5" r="3"/><circle cx="5.5" cy="18.5" r="3"/><circle cx="18.5" cy="18.5" r="3"/><path d="M7.6 7.6l2.4 2.4M16.4 7.6 14 10M7.6 16.4l2.4-2.4M16.4 16.4 14 14"/><rect x="9.5" y="9.5" width="5" height="5" rx="1.2" fill="currentColor" stroke="none"/></svg>';
const heightInput = document.getElementById('height');
const heightLabel = document.getElementById('height-label');
const airspace = document.getElementById('airspace');
let liftAnimation = null;
let formatBeforeFlight = null;
/** Feet on the ground, or on the roof below once you have landed on one. */
function floorUnder(x, z) {
  const roof = roofAt(x, z);
  return roof > -Infinity ? roof - groundAt(x, z) : 0;
}
function animateLift(to, done) {
  liftAnimation = { from: look.lift ?? 0, to, start: performance.now(), done };
  invalidate();
}
function stepLift(now) {
  if (!liftAnimation) return;
  const t = smooth(Math.min(1, (now - liftAnimation.start) / 1500), 0, 1);
  look.lift = THREE.MathUtils.lerp(liftAnimation.from, liftAnimation.to, t);
  showFlight();
  shadowsDirty = true;
  dirty = true;
  if (t >= 1) {
    const { done } = liftAnimation;
    liftAnimation = null;
    done?.();
  }
}
// The restricted area over the government quarter: 3 nautical miles round the Reichstag.
const ED_R_146 = { lat: 52.51861, lon: 13.37611, radiusM: 3 * 1852 };
const edr146 = sceneFromLatLon(ED_R_146.lat, ED_R_146.lon, FERNSEHTURM.lat, FERNSEHTURM.lon);
function showFlight() {
  const flying = look.mode === 'drone';
  document.body.dataset.drone = String(flying);
  takeoffButton.innerHTML = `${DRONE_ICON}${flying ? 'Land' : 'Take off'}`;
  takeoffButton.setAttribute('aria-label', flying ? 'Land' : 'Take off as a drone');
  heightInput.value = String(Math.round(look.lift ?? 0));
  heightLabel.textContent = `${Math.round(look.lift ?? 0)} m`;
  updateEyeBar();
  if (!flying) {
    airspace.hidden = true;
    return;
  }
  const inside = Math.hypot(look.x - edr146[0], look.z - edr146[1]) < ED_R_146.radiusM;
  airspace.hidden = false;
  airspace.dataset.inside = String(inside);
  airspace.querySelector('span').textContent = inside
    ? 'ED-R 146 \u00b7 permit only'
    : 'Check geo zones';
  airspace.title = inside
    ? 'Inside the restricted area ED-R 146 round the Reichstag: drones only commercially, with a permit. Tap for the official geo zones on dipul.'
    : 'Other geo zones may apply here. Tap for the official map on dipul.';
}
function takeOff() {
  look.mode = 'drone';
  if (!cameraFormat.format.id.startsWith('drone')) {
    formatBeforeFlight = { id: cameraFormat.format.id, lens: look.lens };
    setFormat(look, 'drone-3', () => {});
  }
  updateEyeBar();
  animateLift(Math.min(MAX_LIFT_M, floorUnder(look.x, look.z) + TAKEOFF_M));
  showFlight();
  nudgeKeys();
}
function land() {
  animateLift(floorUnder(look.x, look.z), () => {
    look.mode = 'walk';
    if (formatBeforeFlight) {
      setFormat(look, formatBeforeFlight.id, () => {});
      setLens(look, formatBeforeFlight.lens, () => {});
    }
    formatBeforeFlight = null;
    updateEyeBar();
    showFlight();
  });
}
takeoffButton.addEventListener('click', () => (look.mode === 'drone' ? land() : takeOff()));
heightInput.addEventListener('input', () => {
  liftAnimation = null;
  look.lift = Math.max(floorUnder(look.x, look.z), Number(heightInput.value));
  showFlight();
  shadowsDirty = true;
  invalidate();
});

/** Somewhere you can be: open ground, or anywhere above the roofs once you have risen. */
const passable = (x, z) => Math.abs(x) < 9300 && Math.abs(z) < 9300 && roofAt(x, z) < groundAt(x, z) + EYE_HEIGHT + (look.lift ?? 0) - 0.5;

function stepWalk(now) {
  const dt = Math.min(0.1, (now - lastStep) / 1000);
  lastStep = now;
  if (!look.active || lookAnimation) return;
  const forward = THREE.MathUtils.clamp((held.has('fwd') ? 1 : 0) - (held.has('back') ? 1 : 0) + pad, -1, 1);
  const sideways = THREE.MathUtils.clamp((held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0) + padSide, -1, 1);
  const turn = (held.has('turnR') ? 1 : 0) - (held.has('turnL') ? 1 : 0);
  // Only a drone changes height; on foot the keys for it do nothing.
  const climb = look.mode === 'drone' && !liftAnimation ? (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0) : 0;
  if (!forward && !sideways && !turn && !climb) return;
  look.heading += turn * TURN_DPS * dt;
  if (climb) {
    const next = THREE.MathUtils.clamp((look.lift ?? 0) + climb * CLIMB_MPS * (held.has('run') ? 3 : 1) * dt, 0, MAX_LIFT_M);
    // Sinking stops on a roof rather than going through it.
    look.lift = Math.max(next, Math.min(floorUnder(look.x, look.z), look.lift ?? 0));
    showFlight();
  }
  const step = (held.has('run') ? RUN_MPS : WALK_MPS) * dt;
  const a = THREE.MathUtils.degToRad(look.heading);
  const dx = (Math.sin(a) * forward + Math.cos(a) * sideways) * step;
  const dz = (-Math.cos(a) * forward + Math.sin(a) * sideways) * step;
  // Slide along a wall rather than stopping dead at it. Anywhere already blocked, as after
  // landing in a tight spot, lets you walk out in any direction.
  const stuck = !passable(look.x, look.z);
  const reach = Math.max(1.2, step * 2) / Math.max(step, 1e-6);
  for (const [mx, mz] of [[dx, dz], [dx, 0], [0, dz]]) {
    if ((mx || mz) && (stuck || passable(look.x + mx * reach, look.z + mz * reach))) {
      look.x += mx;
      look.z += mz;
      break;
    }
  }
  look.y = groundAt(look.x, look.z);
  if (look.mode !== 'drone') {
    // On foot on a roof: stay on it, and step down where it ends.
    const below = floorUnder(look.x, look.z);
    look.lift = below <= (look.lift ?? 0) + 0.6 ? below : look.lift ?? 0;
  } else showFlight();
  photographer.x = look.x;
  photographer.z = look.z;
  photographer.y = look.y;
  if (!shadowFrom || Math.hypot(look.x - shadowFrom.x, look.z - shadowFrom.z) > 120 || turn) {
    shadowFrom = { x: look.x, z: look.z };
    shadowsDirty = true;
  }
  updateEyeBar();
  dirty = true;
}

// ---- Behind the sphere: the indicator at eye level -----------------------------------------
const eyePoint = () => new THREE.Vector3(look.x, look.y + EYE_HEIGHT + (look.lift ?? 0), look.z);
const sphereCentre = () => new THREE.Vector3(0, groundAt(0, 0) + SPHERE_CENTRE_AGL, 0);
const degreesBetween = (a, b) => THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)));
const bodyDirection = new THREE.Vector3();

/** How far each body is from the sphere as seen from here, and the sphere's size. */
function eclipseNow() {
  const eye = eyePoint();
  const toSphere = sphereCentre().sub(eye);
  const distance = toSphere.length();
  const radiusDeg = THREE.MathUtils.radToDeg(Math.asin(Math.min(1, SPHERE_RADIUS_M / distance)));
  toSphere.normalize();
  const base = groundAt(0, 0);
  const items = bodies.map((body) => {
    const kind = body.moon ? 'moon' : 'sun';
    const { sepDeg, state, signedOff, rise, flat, touching } = bodyAgainstTower(eye, base, body);
    return { body: kind, az: body.az, alt: body.alt, sepDeg, state, signedOff, rise, flat, covered: touching || state === 'antenna' || state === 'shaft', full: state === 'hidden' };
  });
  return { centre: sphereCentre(), radiusDeg, items };
}

/** From here, when each body comes closest to the sphere within an hour and a half either way. */
let forecastAt = 0;
let forecast = [];
function updateForecast(now) {
  if (now - forecastAt < 300) return;
  forecastAt = now;
  const t = instant().getTime();
  const eye = eyePoint();
  const toSphere = sphereCentre().sub(eye);
  const radiusDeg = THREE.MathUtils.radToDeg(Math.asin(Math.min(1, SPHERE_RADIUS_M / toSphere.length())));
  toSphere.normalize();
  forecast = [];
  for (const path of dayPaths) {
    let best = { sepDeg: Infinity, t };
    for (let k = -90; k <= 90; k++) {
      const at = t + k * 60_000;
      const p = sampleBody(path.body, new Date(at), FERNSEHTURM.lat, FERNSEHTURM.lon);
      if (p.alt < -0.5) continue;
      const sepDeg = degreesBetween(toDirection(bodyDirection, p.az, p.alt), toSphere);
      if (sepDeg < best.sepDeg) best = { sepDeg, t: at };
    }
    if (best.sepDeg < Infinity) forecast.push({ body: path.body, ...best, covers: best.sepDeg < radiusDeg + DISC_RADIUS_DEG, beside: best.sepDeg - radiusDeg });
  }
}

const eclipseButton = document.getElementById('eclipse');
const clockOf = formatClock;
const BODY_NAME = { sun: 'Sun', moon: 'Moon' };
let eclipseAction = null;
/** The moon close beside the sphere, level with it: near enough to walk it onto the edge. */
function moonBeside(here) {
  return here.items.find(
    (item) => item.body === 'moon' && item.state === 'near' && Math.abs(item.rise) < here.radiusDeg + DISC_RADIUS_DEG && Math.abs(item.signedOff) < 4,
  );
}

/** One line in the camera card: covered now, how long until, or where to go instead. */
function showEclipseStatus(now) {
  const here = eclipseNow();
  const covering = here.items.find((item) => item.covered);
  const t = instant().getTime();
  let text = '';
  let state = 'soon';
  let body = 'sun';
  eclipseAction = null;
  if (covering) {
    body = covering.body;
    state = 'now';
    const name = BODY_NAME[body];
    text = {
      hidden: body === 'sun' ? 'Sun behind the sphere now' : 'Moon hidden behind the sphere: move further away',
      ring: body === 'sun' ? 'Ring of sun round the sphere now' : 'Sphere in front of the moon now',
      edge: `${name} at the edge of the sphere now`,
      antenna: `${name} behind the antenna now`,
      shaft: `${name} behind the tower\u2019s shaft now`,
    }[covering.state];
    if (body === 'moon' && covering.state === 'hidden') {
      state = 'warn';
      // Stepping sideways moves the sphere across the moon; this far puts the moon on its edge.
      const metres = covering.flat * Math.tan(THREE.MathUtils.degToRad(Math.max(0, here.radiusDeg - Math.abs(covering.signedOff))));
      text = `Moon hidden behind the sphere: step ${Math.max(1, Math.round(metres))} m left or right, or move further away`;
    }
  } else if (moonBeside(here)) {
    const moon = moonBeside(here);
    body = 'moon';
    const metres = moon.flat * Math.tan(THREE.MathUtils.degToRad(Math.abs(moon.signedOff) - here.radiusDeg));
    // The moon is far away and stays put. With the moon right of the sphere, stepping left
    // swings the nearby sphere to the right, onto it.
    const side = moon.signedOff > 0 ? 'left' : 'right';
    text = `Moon just beside the sphere: step ${Math.max(1, Math.round(metres))} m ${side} to put it on the edge`;
  } else {
    const next = forecast.filter((f) => f.covers).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
    const spot = spots[0];
    if (next) {
      body = next.body;
      const minutes = Math.round((next.t - t) / 60_000);
      text = minutes > 0 ? `${BODY_NAME[body]} behind the sphere in ${minutes} min (${clockOf(next.t)})` : `${BODY_NAME[body]} was behind the sphere ${-minutes} min ago`;
      eclipseAction = () => {
        timeInput.value = String(Math.round((next.t - dayStart()) / 60_000));
        updateSun();
      };
    } else if (spot) {
      body = spot.body;
      const dx = spot.x - look.x;
      const dz = spot.z - look.z;
      const metres = Math.hypot(dx, dz);
      const bearing = (THREE.MathUtils.radToDeg(Math.atan2(dx, -dz)) + 360) % 360;
      text = `Sphere spot for now: ${metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`} ${compassName(bearing)} \u2192 go`;
      eclipseAction = () => goViewHere({ kind: 'tower', body: spot.body, t: spot.t, x: spot.x, z: spot.z });
    } else {
      const closest = forecast.sort((a, b) => a.sepDeg - b.sepDeg)[0];
      if (closest && closest.beside < 8) {
        body = closest.body;
        text = `Closest at ${clockOf(closest.t)}: ${closest.beside.toFixed(1)}\u00b0 beside the sphere`;
      }
    }
  }
  // The line keeps its place when empty, so the card does not jump while the time is slid.
  eclipseButton.hidden = false;
  eclipseButton.textContent = text || 'Nothing lines up with the tower from here';
  if (!text) state = 'idle';
  eclipseButton.dataset.state = state;
  eclipseButton.style.setProperty('--dot', body === 'moon' ? '#5b82ff' : '#f26a12');
  return here;
}
eclipseButton.addEventListener('click', () => {
  eclipseAction?.();
  invalidate();
});

// ---- Turning to the tower, the sun or the moon ----------------------------------------------
function faceTower() {
  const eye = eyePoint();
  const heading = (THREE.MathUtils.radToDeg(Math.atan2(-eye.x, eye.z)) + 360) % 360;
  const pitch = THREE.MathUtils.radToDeg(Math.atan2(sphereCentre().y - eye.y, Math.hypot(eye.x, eye.z)));
  turnTo(heading, pitch);
}
document.getElementById('face-tower').addEventListener('click', faceTower);
for (const kind of ['sun', 'moon']) {
  document.getElementById(`face-${kind}`).addEventListener('click', () => {
    const body = bodies.find((b) => (kind === 'moon') === Boolean(b.moon));
    if (body) face(body);
  });
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
function roofAt(x, z) {
  raycaster.set(new THREE.Vector3(x, 2000, z), new THREE.Vector3(0, -1, 0));
  const near = tiles.filter((tile) => Math.abs(tile.center.x - x) < tile.radius && Math.abs(tile.center.z - z) < tile.radius).map(rayTarget).filter(Boolean);
  near.push(tower);
  const hit = raycaster.intersectObjects(near, false)[0];
  return hit && hit.point.y > groundAt(x, z) + 1.5 ? hit.point.y : -Infinity;
}

function underRoof(x, z) {
  return roofAt(x, z) > -Infinity;
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
  const over = document.elementFromPoint(event.clientX, event.clientY);
  drag.drop = over === renderer.domElement || over?.id === 'labels' ? groundUnder(event.clientX, event.clientY) : null;
  invalidate();
}
function dragEnd(event) {
  removeEventListener('pointermove', dragMove);
  removeEventListener('pointerup', dragEnd);
  removeEventListener('pointercancel', dragEnd);
  if (!drag) return;
  const { moved } = drag;
  drag = null;
  ghost.hidden = true;
  invalidate();
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
// ---- View from here: lines and streets on the map lead into the view ------------------------
const viewHere = document.getElementById('viewhere');
let viewTarget = null;
let liveStreets = [];

/** The closest point on a ground segment to (x, z), and how far away it is. */
function nearestOnSegment(a, b, x, z) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  const px = a.x + dx * t;
  const pz = a.z + dz * t;
  return { x: px, z: pz, d: Math.hypot(px - x, pz - z) };
}

/** What lies under a screen point that can be viewed from: a tower line, the path, a lit street. */
function viewableAt(clientX, clientY) {
  if (camera !== overview) return null;
  const point = groundUnder(clientX, clientY);
  if (!point) return null;
  // About twelve pixels on screen, in metres at that spot.
  const metresPerPx = (2 * camera.position.distanceTo(point) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / innerHeight;
  const reach = 12 * metresPerPx;
  let best = null;
  const offer = (candidate) => {
    if (candidate.d < reach && (!best || candidate.d < best.d)) best = candidate;
  };
  for (const ray of [...towerItems(rays), ...towerItems(hourRays)]) {
    const near = nearestOnSegment(ray.base, ray.far, point.x, point.z);
    if (Math.hypot(near.x, near.z) < 120) continue;
    offer({ ...near, kind: 'tower', body: ray.body, t: ray.t ?? instant().getTime() });
  }
  for (const path of towerItems(dayPaths)) {
    for (const segment of path.segments) {
      for (const p of segment) offer({ x: p.x, z: p.z, d: Math.hypot(p.x - point.x, p.z - point.z), kind: 'tower', body: path.body, t: p.t });
    }
  }
  for (const m of liveStreets) {
    const near = nearestOnSegment({ x: m.view.a[0], z: m.view.a[1] }, { x: m.view.b[0], z: m.view.b[1] }, point.x, point.z);
    offer({ ...near, d: near.d * 0.8, kind: 'street', body: m.body, t: m.peak, moment: m });
  }
  return best;
}

function showViewHere(target, clientX, clientY) {
  viewTarget = target;
  viewHere.hidden = !target;
  if (!target) return;
  const what = target.kind === 'street' ? target.moment.view.name : `${BODY_NAME[target.body]} & tower`;
  viewHere.innerHTML = `<i style="background: var(--${target.body})"></i>View from here <small>${what} \u00b7 ${formatClock(target.t)}</small>`;
  // Centred on the pointer, so a click where it already is lands on the button.
  const width = viewHere.offsetWidth || 220;
  const height = viewHere.offsetHeight || 36;
  viewHere.style.left = `${Math.min(innerWidth - width - 8, Math.max(8, clientX - width / 2))}px`;
  viewHere.style.top = `${Math.max(8, clientY - height / 2)}px`;
}
viewHere.addEventListener('pointerleave', (event) => {
  // Off the button and off any line: let it go.
  if (!viewableAt(event.clientX, event.clientY)) showViewHere(null);
});

/** Load full detail, for checks only, for the tiles along a sightline that do not have it on screen. */
async function fineAlong(x, z, direction, distance) {
  const origin = new THREE.Vector3(x, groundAt(x, z) + EYE_HEIGHT, z);
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
async function confirmedSpotAlong(x, z, ux, uz, viewFrom, keep = () => true) {
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
let lastBlock = null;
/** Whether nothing built stands between an eye at (x, z) and a point along a direction. */
function clearView(x, z, direction, distance) {
  if (underRoof(x, z)) return false;
  const origin = new THREE.Vector3(x, groundAt(x, z) + EYE_HEIGHT, z);
  raycaster.set(origin, direction);
  raycaster.near = 2;
  raycaster.far = distance;
  const end = origin.clone().addScaledVector(direction, distance);
  const box = new THREE.Box3().setFromPoints([origin, end]).expandByScalar(60);
  const meshes = tiles.filter((tile) => box.distanceToPoint(tile.center) < tile.radius).map(rayTarget).filter(Boolean);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  raycaster.near = 0;
  raycaster.far = Infinity;
  lastBlock = hit ? { distance: hit.distance, point: hit.point.clone() } : null;
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

/** Better to say so than to drop the photographer in front of a wall. */
function noClearView(target) {
  viewTarget = null;
  viewHere.hidden = false;
  viewHere.innerHTML = `<i style="background: var(--${target.body})"></i>No clear view along here <small>try another line or time</small>`;
  setTimeout(() => {
    if (!viewTarget) viewHere.hidden = true;
  }, 2500);
}

viewHere.addEventListener('click', () => {
  const target = viewTarget;
  if (!target) return;
  viewTarget = null;
  // The search can take a moment among dense blocks; say so, and let that show before it runs.
  viewHere.innerHTML = `<i style="background: var(--${target.body})"></i>Finding a clear view\u2026`;
  setTimeout(() => goViewHere(target), 30);
});

async function goViewHere(target) {
  viewHere.hidden = true;
  setMinute(target.t);
  const p = sampleBody(target.body, new Date(target.t), FERNSEHTURM.lat, FERNSEHTURM.lon);
  const towards = toDirection(new THREE.Vector3(), p.az, Math.max(0, p.alt));
  if (target.kind === 'tower') {
    // Along the tower line, somewhere the tower and the body behind it are both in view: the
    // look toward the body must reach the tower without a building in between.
    const length = Math.hypot(target.x, target.z) || 1;
    // Stay on the line's useful part: out from the tower, within the model.
    const keep = (x, z) => Math.hypot(x, z) > 150 && Math.abs(x) < 9000 && Math.abs(z) < 9000 && x * target.x + z * target.z > 0;
    const spot = await confirmedSpotAlong(target.x, target.z, target.x / length, target.z / length, (x, z) => ({ direction: towards, distance: Math.max(50, Math.hypot(x, z) - 40) }), keep);
    if (!spot) return noClearView(target);
    // Face the body: on a tower line it is behind some part of the tower, not always the sphere.
    enterEye(spot.x, spot.z, { heading: p.az, pitch: Math.max(0, p.alt), lens: fullFrame(target.lens ?? 200) });
  } else if (target.kind === 'street') {
    const m = target.moment;
    const dx = m.view.b[0] - m.view.a[0];
    const dz = m.view.b[1] - m.view.a[1];
    const length = Math.hypot(dx, dz) || 1;
    const spot = await confirmedSpotAlong(target.x, target.z, dx / length, dz / length, () => ({ direction: towards, distance: 600 }));
    if (!spot) return noClearView(target);
    enterEye(spot.x, spot.z, { heading: m.view.bearingDeg, pitch: THREE.MathUtils.clamp(m.bodyAlt * 0.9, 0, 12), lens: fullFrame(85) });
  }
}

let hoverFrame = 0;
renderer.domElement.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse' || event.buttons || drag || hoverFrame) return;
  const { clientX, clientY } = event;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    const target = viewableAt(clientX, clientY);
    renderer.domElement.style.cursor = target ? 'pointer' : '';
    // Keep the button while the pointer heads for it.
    if (target || !viewTarget) showViewHere(target, clientX, clientY);
  });
});
renderer.domElement.addEventListener('pointerleave', () => {
  renderer.domElement.style.cursor = '';
});

renderer.domElement.addEventListener('pointerup', (event) => {
  if (!press || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) return;
  // A tap on a line or a lit street offers the view from there, as hovering does with a mouse.
  const viewable = viewableAt(event.clientX, event.clientY);
  if (event.pointerType !== 'mouse') showViewHere(viewable, event.clientX, event.clientY);
  else if (!viewable) showViewHere(null);
  const inside = (t) => event.clientX >= t.x && event.clientX <= t.x + t.w && event.clientY >= t.y && event.clientY <= t.y + t.h;
  // A path lies under everything else, so it only takes a tap nothing else wants.
  const hit = taps.find((t) => t.kind !== 'path' && inside(t)) ?? taps.find((t) => t.kind === 'path' && inside(t));
  if (hit?.kind === 'spot') {
    const spot = spots.find((s) => s.body === hit.body);
    goViewHere({ kind: 'tower', body: spot.body, t: spot.t, x: spot.x, z: spot.z });
  }
  if (hit?.kind === 'path') {
    timeInput.value = String(Math.round((hit.t - dayStart()) / 60_000));
    updateSun();
    invalidate();
  }
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

// ---- What the map shows ---------------------------------------------------------------------
const layers = { tower: true, streets: true, names: true, sun: true, moon: true, weather: true };
try {
  Object.assign(layers, JSON.parse(localStorage.getItem('miniature.layers') ?? '{}'));
} catch {}
const shownBody = (item) => layers[item.body] !== false;
const towerItems = (items) => (layers.tower ? items.filter(shownBody) : []);

document.getElementById('minimap').addEventListener('click', () => exitEye());

// ---- How it works: once on a first visit, and again from the ? button -----------------------
const intro = document.getElementById('intro');
const openIntro = () => {
  if (!intro.open) intro.showModal();
};
document.getElementById('help').addEventListener('click', openIntro);
document.getElementById('intro-start').addEventListener('click', () => intro.close());
intro.addEventListener('close', () => {
  try {
    localStorage.setItem('miniature.intro', 'seen');
  } catch {}
});
try {
  if (!localStorage.getItem('miniature.intro') && !params.has('nointro')) setTimeout(openIntro, 600);
} catch {}

const layersButton = document.getElementById('layers');
const layersMenu = document.getElementById('layers-menu');
layersButton.addEventListener('click', () => {
  layersMenu.hidden = !layersMenu.hidden;
  layersButton.setAttribute('aria-expanded', String(!layersMenu.hidden));
});
addEventListener('pointerdown', (event) => {
  if (!layersMenu.hidden && !layersMenu.contains(event.target) && !layersButton.contains(event.target)) {
    layersMenu.hidden = true;
    layersButton.setAttribute('aria-expanded', 'false');
  }
});
// The moon in the layers menu shows today's phase.
function showLayersMoon() {
  const moon = getMoonIllumination(new Date(dayStart() + 43_200_000));
  document.getElementById('layers-moon').innerHTML = `<circle r="0.92" fill="#2a3150"/><path d="${litDiscPath(moon.fraction, moon.waxing ?? moon.phase < 0.5)}" transform="scale(0.92)" fill="#e8ecff"/>`;
}
layersButton.addEventListener('click', showLayersMoon);
for (const input of layersMenu.querySelectorAll('input[data-layer]')) {
  input.checked = layers[input.dataset.layer];
  input.addEventListener('change', () => setLayer(input.dataset.layer, input.checked));
}
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
  const response = await fetch(`${CITY}${tile.id}-${lod.level}.bin${CITY_VERSION}`);
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
// The time can be typed or picked as well as slid; the browser shows it in the viewer's format.
clock.classList.toggle('h12', uses12h);
clock.addEventListener('focus', () => clock.select());
clock.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') clock.blur();
  if (event.key === 'Escape') {
    clock.value = formatMinutes(Number(timeInput.value));
    clock.blur();
  }
});
clock.addEventListener('change', () => {
  const minutes = parseTime(clock.value);
  if (minutes !== null) timeInput.value = String(minutes);
  clock.value = formatMinutes(Number(timeInput.value));
  updateSun();
  invalidate();
});
const sunLabel = document.getElementById('sun');
// The offset only changes on the hour at most; asking Intl every frame showed in profiles.
const offsets = new Map();
const berlinOffsetMinutes = (date) => {
  const hour = Math.floor(date.getTime() / 3_600_000);
  let offset = offsets.get(hour);
  if (offset === undefined) {
    const local = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
    const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    offset = (local - utc) / 60_000;
    offsets.set(hour, offset);
  }
  return offset;
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
  glow.color.setRGB(...rig.glow.colour);
  glow.intensity = rig.glow.intensity;
  toDirection(glow.position, sunAt.az, 9).multiplyScalar(1000);
  sun.intensity = rig.key.intensity;
  sky.color.setRGB(...rig.sky);
  sky.intensity = rig.skyI;
  sky.groundColor.copy(sky.color).multiplyScalar(0.84);
  background.setRGB(...rig.haze);
  // Clouds: they hold back the direct light, soften shadows, and grey the sky and the haze.
  cloudNow = weather && layers.weather ? cloudsAt(weather, Number(timeInput.value)) : null;
  const passes = cloudNow ? (1 - 0.85 * cloudNow.low) * (1 - 0.55 * cloudNow.mid) * (1 - 0.2 * cloudNow.high) : 1;
  cloudPasses = passes;
  // The clouds themselves, in the sky and as shadows on the city, drifting with the wind.
  const drift = cloudNow ? cloudDrift(weather, Number(timeInput.value)) : { x: 0, z: 0 };
  for (const u of [skyUniforms, cityUniforms]) {
    u.uCloudLow.value = cloudNow?.low ?? 0;
    u.uCloudMid.value = cloudNow?.mid ?? 0;
    u.uCloudHigh.value = cloudNow?.high ?? 0;
    u.uCloudShift.value.set(drift.x, drift.z);
  }
  cityUniforms.uCloudSun.value.copy(sunDirection);
  const cloudiness = 1 - passes;
  // Direct light is held back per place in the shaders (cloud shadows); here only the average,
  // for what has no place: the water's glint.
  sun.shadow.radius = 1.6 + 7 * cloudiness;
  if (cloudiness > 0) {
    const grey = new THREE.Color(0.82, 0.84, 0.88);
    sky.color.lerp(grey, 0.75 * cloudiness);
    sky.intensity *= 1 + 0.3 * cloudiness * smooth(sunAt.alt, -2, 10);
    background.lerp(grey.clone().multiplyScalar(Math.max(0.05, background.r + background.g + background.b) / 2.5), 0.5 * cloudiness);
  }
  scene.background = background;
  cityUniforms.uHazeColour.value.copy(background);

  cityUniforms.uLights.value = rig.lights;
  cityUniforms.uGroundTone.value = rig.groundTone;
  cityUniforms.uWindows.value = rig.lights * rig.windows;
  ribbonUniforms.uDay.value = 1 - smooth(rig.lights, 0.1, 0.7);
  cityUniforms.uKeyDir.value.copy(keyDirection);
  cityUniforms.uKeyLight.value.copy(sun.color).multiplyScalar(sun.intensity * cloudPasses);
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
  // Exposed for the moon, as a photographer would, so its face shows rather than a glow.
  skyUniforms.uMoonLight.value = THREE.MathUtils.lerp(1.0, 0.6, smooth(sunAt.alt, -6, 4));
  bloomLights = rig.lights;

  night = sunAt.alt < -3;
  document.body.dataset.night = String(night);
  bodies = [];
  if (sunAt.alt > -1) bodies.push({ az: sunAt.az, alt: sunAt.alt, sunAlt: sunAt.alt });
  if (moonAt.alt > -1) bodies.push({ az: moonAt.az, alt: moonAt.alt, sunAlt: sunAt.alt, moon: illumination });
  document.getElementById('face-sun').hidden = !bodies.some((b) => !b.moon);
  document.getElementById('face-moon').hidden = !bodies.some((b) => b.moon);

  if (document.activeElement !== clock) clock.value = formatMinutes(Number(timeInput.value));
  const phase = LIGHT_PHASE_NAMES[lightPhaseAt(sunAt.alt)];
  sunLabel.textContent = `${phase} \u00b7 ${sunAt.alt > -0.5 ? `sun ${sunAt.alt.toFixed(0)}\u00b0` : moonAt.alt > 0 ? `moon ${Math.round(illumination.fraction * 100)}% lit` : 'moon down'}`;
  updateHighlights(when.getTime());
  updateSpots(when.getTime());
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
  const live = layers.streets ? moments.filter((m) => shownBody(m) && t >= m.from - 60_000 && t <= m.to + 60_000) : [];
  const key = live.map((m) => `${m.body}${views.indexOf(m.view)}`).join('|');
  if (key === shownKey) return;
  shownKey = key;
  const when = new Date(t);
  const azimuth = { sun: sampleBody('sun', when, FERNSEHTURM.lat, FERNSEHTURM.lon).az, moon: sampleBody('moon', when, FERNSEHTURM.lat, FERNSEHTURM.lon).az };
  highlights.set(live.map((m) => ({ a: m.view.a, b: m.view.b, body: m.body, az: azimuth[m.body], colour: RAY_COLOUR[m.body], altitude: m.bodyAlt, strength: m.body === 'moon' ? 0.3 : 1 })));
  liveStreets = live;
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
  loadWeather();
  computePaths(from, to);
  const list = document.getElementById('moments');
  list.replaceChildren();
  const seen = new Set();
  // The longest views are the ones worth a trip; the rest can still be found with the slider.
  const best = [...moments].sort((a, b) => b.view.lengthM - a.view.lengthM).slice(0, 14).sort((a, b) => a.peak - b.peak);
  for (const moment of best.filter((m) => layers.streets && shownBody(m))) {
    // One chip per street: both directions of a street rarely share a moment, but parts can.
    const key = `${moment.view.name}${moment.body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const chip = document.createElement('button');
    const minutes = Math.round((moment.peak - from) / 60_000);
    const stamp = formatMinutes(minutes);
    chip.textContent = `${stamp} ${moment.view.name}`;
    chip.dataset.body = moment.body;
    chip.addEventListener('click', () => {
      timeInput.value = String(minutes);
      updateSun();
      const [x, z] = moment.view.a;
      photographer = { x, y: groundAt(x, z), z, heading: moment.view.bearingDeg };
      if (camera === eyeCamera) enterEye(x, z, { heading: moment.view.bearingDeg, pitch: THREE.MathUtils.clamp(moment.bodyAlt * 0.9, 0, 12), lens: fullFrame(85) });
      else flyTo((moment.view.a[0] + moment.view.b[0]) / 2, (moment.view.a[1] + moment.view.b[1]) / 2);
      invalidate();
    });
    list.append(chip);
  }
  // Saying no street lines up would be wrong while the streets are merely hidden.
  document.getElementById('moments-empty').hidden = seen.size > 0 || !layers.streets;
}

// ---- Where the tower covers the sun or moon ------------------------------------------------
// The rules live in towerShots.js. Along a line through the tower, where the disc sits behind
// the antenna, as scene points.
function antennaStretch(line) {
  const range = antennaRange(line.bodyAlt);
  if (!range) return null;
  const far = toScene(line.farEnd);
  const length = Math.hypot(far.x, far.z) || 1;
  const at = (d) => ({ x: (far.x / length) * d, z: (far.z / length) * d, y: groundAt((far.x / length) * d, (far.z / length) * d) + 1 });
  return { from: at(range.fromM), to: at(range.toM), ...range };
}
let rawPaths = [];
let viewshed = null;
let dayPaths = [];
let spots = [];
const toScene = (p) => {
  const [x, z] = sceneFromLatLon(p.lat, p.lon, FERNSEHTURM.lat, FERNSEHTURM.lon);
  return { x, z, y: groundAt(x, z) + 1 };
};

function computePaths(from, to) {
  rawPaths = ['sun', 'moon'].map((body) => computeDayPath({ body, start: new Date(from), end: new Date(to), landmark: FERNSEHTURM }));
  buildPaths();
}

/** The paths in scene coordinates, checked against the buildings once that data is in. */
function buildPaths() {
  const from = dayStart();
  const viewed = rawPaths
    .filter((path) => path.body === 'sun' || path.illumination >= MIN_MOON_ILLUMINATION)
    .map((path) => (viewshed ? applyView(path, (lat, lon) => sampleViewshed(viewshed, lat, lon) === VIEW_VISIBLE) : path))
    .map(visibleMoon);
  dayPaths = viewed.map((path) => ({
    body: path.body,
    source: path,
    faint: path.body === 'moon' && path.illumination < 0.5,
    segments: path.segments.map((segment) => segment.map((p) => ({ ...toScene(p), t: p.t, clear: p.clear }))),
  }));
  // One line through the tower per hour, like the hours on a clock face: along each, the disc
  // sits behind some part of the tower at that hour.
  hourRays = [];
  const base = { x: 0, y: groundAt(0, 0) + 1, z: 0 };
  for (const path of dayPaths) {
    for (let hour = 0; hour < 24; hour++) {
      const t = from + hour * 3_600_000;
      const line = alignmentLine(path.body, t, FERNSEHTURM);
      if (line) hourRays.push({ body: path.body, hour, label: formatHour(hour), t, base, far: toScene(line.farEnd), antenna: path.body === 'moon' ? antennaStretch(line) : null });
    }
  }
  updateTracks();
  updateSpots(instant().getTime());
  renderDayList();
}

// ---- Weather: clouds for the day ----------------------------------------------------------------
const weatherLine = document.getElementById('weather');
function loadWeather() {
  const date = dateInput.value;
  weather = null;
  const reach = forecastReach(date);
  if (!reach.ok) {
    weatherLine.textContent = reach.reason;
    weatherLine.dataset.state = 'none';
    return;
  }
  weatherLine.textContent = 'Loading the cloud forecast\u2026';
  weatherLine.dataset.state = 'loading';
  cloudsFor(date, dayStart()).then((day) => {
    if (dateInput.value !== date) return;
    weather = day;
    showWeather();
    updateTracks();
    renderDayList();
    updateSun();
    invalidate();
  });
}

/** Sunrise and sunset, read for colour: will the sun get through, and will clouds catch it? */
function showWeather() {
  if (!weather) {
    weatherLine.textContent = 'No cloud forecast available';
    weatherLine.dataset.state = 'none';
    return;
  }
  weatherLine.dataset.state = 'ok';
  weatherLine.replaceChildren(
    ...['rise', 'set'].map((which) => {
      const reading = readSky(weather, which);
      const part = document.createElement('span');
      if (!reading) return part;
      part.dataset.grade = reading.grade;
      part.textContent = `${which === 'rise' ? 'Sunrise' : 'Sunset'} ${formatClock(reading.t)}: ${reading.text}`;
      return part;
    }),
  );
}

/** Cloud at an instant, as a short note for the list. */
function cloudNote(t) {
  if (!weather || !layers.weather) return '';
  const c = cloudsAt(weather, (t - dayStart()) / 60_000);
  const cover = Math.round(100 * Math.max(c.low, c.mid, c.high));
  return ` \u00b7 ${cover < 10 ? 'clear sky' : `${cover}% cloud${c.low > 0.6 ? ', low' : ''}`}`;
}

// ---- The day as a list, in the expanded sheet -------------------------------------------------
const dayList = document.getElementById('daylist');
const sheetToggle = document.getElementById('sheet-toggle');
const distanceText = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

/** Every chance of the day, in time order: tower alignments and street henges. */
function renderDayList() {
  const rows = [];
  if (layers.tower) {
    for (const path of dayPaths.filter(shownBody)) {
      // Stretches with a clear view of the tower, joined across short gaps (a building in
      // the way for a few minutes), and kept only when long enough to get to.
      const windows = [];
      for (const segment of path.source.segments) {
        for (const p of segment) {
          if (p.clear === false) continue;
          const last = windows[windows.length - 1];
          if (last && p.t - last.points[last.points.length - 1].t <= 12 * 60_000) {
            if (p.t - last.points[last.points.length - 1].t > 4 * 60_000) last.broken = true;
            last.points.push(p);
          } else windows.push({ points: [p], broken: false });
        }
      }
      for (const w of windows) {
        const first = w.points[0];
        const lastPoint = w.points[w.points.length - 1];
        if (lastPoint.t - first.t < 4 * 60_000) continue;
        const mid = w.points[Math.floor(w.points.length / 2)];
        rows.push({
          t: first.t,
          body: path.body,
          kind: 'tower',
          title:
            path.body === 'moon'
              ? `Big moon behind the TV tower, ${discOverSphere(mid.distanceM).toFixed(1)}\u00d7 the sphere`
              : discOverSphere(mid.distanceM) > 1
                ? 'Ring of sun round the TV tower\u2019s sphere'
                : 'Sun behind the TV tower\u2019s sphere',
          detail: `${formatClock(first.t)}\u2013${formatClock(lastPoint.t)}${w.broken ? ' (with breaks)' : ''} \u00b7 ${distanceText(mid.distanceM)} ${compassPoint(mid.bearingDeg)} of the tower \u00b7 ${Math.round(mid.bodyAlt)}\u00b0 up`,
          go: () => goViewHere({ kind: 'tower', body: path.body, t: mid.t, ...toScene(mid) }),
        });
      }
    }
  }
  // Moonrise and moonset behind the antenna: the moon low, more than half lit, and visible
  // round the thin mast from a few kilometres out.
  if (layers.tower && layers.moon) {
    const from = dayStart();
    const lit = getMoonIllumination(new Date(from + 43_200_000)).fraction;
    if (lit >= 0.5) {
      let window = null;
      const windows = [];
      for (let t = from; t <= from + 86_400_000; t += 5 * 60_000) {
        const p = sampleBody('moon', new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);
        const low = p.alt >= 1 && p.alt <= 8;
        if (low && !window) windows.push((window = { start: t, end: t, rising: null, samples: [] }));
        if (low) {
          window.end = t;
          window.samples.push({ t, ...p });
        } else window = null;
      }
      for (const w of windows) {
        if (w.samples.length < 2) continue;
        const rising = w.samples[w.samples.length - 1].alt > w.samples[0].alt;
        const mid = w.samples[Math.floor(w.samples.length / 2)];
        const reach = (h, alt) => Math.min(9000, (h - EYE_HEIGHT) / Math.tan(THREE.MathUtils.degToRad(alt)));
        const near = reach(SPHERE_TOP_AGL, Math.max(...w.samples.map((p) => p.alt)));
        const far = reach(TIP_AGL, Math.min(...w.samples.map((p) => p.alt)));
        const bearing = (mid.az + 180) % 360;
        rows.push({
          t: w.start,
          body: 'moon',
          kind: 'tower',
          title: `${rising ? 'Moonrise' : 'Moonset'} behind the TV tower\u2019s antenna`,
          detail: `${formatClock(w.start)}\u2013${formatClock(w.end)} \u00b7 ${distanceText(near)}\u2013${distanceText(far)} ${compassPoint(bearing)} of the tower \u00b7 ${Math.round(lit * 100)}% lit`,
          go: () => {
            // Start from the middle of the antenna stretch; the search finds a clear view near it.
            const a = THREE.MathUtils.degToRad(bearing);
            const d = (reach(SPHERE_TOP_AGL, mid.alt) + reach(TIP_AGL, mid.alt)) / 2;
            goViewHere({ kind: 'tower', body: 'moon', t: mid.t, x: Math.sin(a) * d, z: -Math.cos(a) * d, lens: 400 });
          },
        });
      }
    }
  }
  if (layers.streets) {
    const seen = new Set();
    // The longest views are the ones worth a trip; the rest still show on the map and slider.
    for (const m of [...moments].filter(shownBody).sort((a, b) => b.view.lengthM - a.view.lengthM)) {
      const key = `${m.view.name}${m.body}`;
      if (seen.has(key) || seen.size >= 12) continue;
      seen.add(key);
      rows.push({
        t: m.peak,
        body: m.body,
        kind: 'street',
        title: `${m.view.name}`,
        detail: `${formatClock(m.peak)} \u00b7 street henge: the ${BODY_NAME[m.body].toLowerCase()} down the street \u00b7 ${distanceText(m.view.lengthM)} long \u00b7 ${Math.round(m.bodyAlt)}\u00b0 up`,
        go: () => goViewHere({ kind: 'street', body: m.body, t: m.peak, x: m.view.a[0], z: m.view.a[1], moment: m }),
      });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  dayList.replaceChildren(
    ...rows.map((row) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'dayrow';
      item.dataset.body = row.body;
      item.dataset.kind = row.kind;
      item.innerHTML = `${bodyIcon(row.body, row.t)}<span><b></b><small></small></span><em>Go \u203a</em>`;
      item.querySelector('b').textContent = row.title;
      item.querySelector('small').textContent = row.detail + cloudNote(row.t);
      item.addEventListener('click', () => {
        row.go();
        setSheet(false);
        invalidate();
      });
      return item;
    }),
  );
  if (!rows.length) dayList.innerHTML = '<p class="muted">Nothing lines up today. Try another day.</p>';
  sheetToggle.querySelector('span').textContent = `${rows.length} chance${rows.length === 1 ? '' : 's'} today`;
}

/** A small sun, or the moon in its phase at that time, for the list. */
function bodyIcon(body, t) {
  if (body === 'sun') return '<svg class="disc" viewBox="-1 -1 2 2" aria-hidden="true"><circle r="0.92" fill="#f8a03a"/><circle r="0.62" fill="#ffd27a"/></svg>';
  const moon = getMoonIllumination(new Date(t));
  return `<svg class="disc" viewBox="-1 -1 2 2" aria-hidden="true"><circle r="0.92" fill="#2a3150"/><path d="${litDiscPath(moon.fraction, moon.waxing ?? moon.phase < 0.5)}" transform="scale(0.92)" fill="#e8ecff"/><circle r="0.92" fill="none" stroke="#5b82ff" stroke-width="0.12"/></svg>`;
}

function setMinute(t) {
  timeInput.value = String(Math.round((t - dayStart()) / 60_000));
  updateSun();
}

function setSheet(open) {
  document.body.dataset.sheet = open ? 'open' : 'closed';
  sheetToggle.setAttribute('aria-expanded', String(open));
}
sheetToggle.addEventListener('click', () => setSheet(document.body.dataset.sheet !== 'open'));

/** The list's filters are the map's layers, so both always agree. */
function setLayer(name, on) {
  layers[name] = on;
  try {
    localStorage.setItem('miniature.layers', JSON.stringify(layers));
  } catch {}
  for (const input of document.querySelectorAll(`input[data-layer="${name}"]`)) input.checked = on;
  for (const chip of document.querySelectorAll(`#dayfilter [data-layer="${name}"]`)) chip.setAttribute('aria-pressed', String(on));
  shownKey = null;
  updateDay();
  updateSun();
  invalidate();
}
for (const chip of document.querySelectorAll('#dayfilter [data-layer]')) {
  chip.setAttribute('aria-pressed', String(layers[chip.dataset.layer]));
  chip.addEventListener('click', () => setLayer(chip.dataset.layer, !layers[chip.dataset.layer]));
}

let rays = [];
let hourRays = [];
let weather = null;
let cloudNow = null;
/** How much direct light gets through the clouds now, 0 to 1. */
let cloudPasses = 1;
function updateSpots(t) {
  spots = [];
  // The line through the tower for this instant: anywhere along its bright part the disc sits
  // behind some part of the tower, the sphere at the marked spot.
  rays = [];
  for (const path of dayPaths) {
    const line = alignmentLine(path.body, t, FERNSEHTURM);
    if (line) rays.push({ body: path.body, far: toScene(line.farEnd), near: toScene(line.bodySide), base: { x: 0, y: groundAt(0, 0) + 1, z: 0 }, antenna: path.body === 'moon' ? antennaStretch(line) : null });
  }
  for (const path of dayPaths) {
    const p = pointAtTime(path.source, t);
    if (p && p.clear !== false) spots.push({ body: path.body, t: p.t, ...toScene(p) });
  }
}

/** Stand at a point on a path, facing the tower's sphere, with a lens that frames it. */
function standOnPath(spot) {
  const distance = Math.hypot(spot.x, spot.z);
  const eye = groundAt(spot.x, spot.z) + EYE_HEIGHT;
  const heading = (THREE.MathUtils.radToDeg(Math.atan2(-spot.x, spot.z)) + 360) % 360;
  const pitch = THREE.MathUtils.radToDeg(Math.atan2(groundAt(0, 0) + SPHERE_CENTRE_AGL - eye, distance));
  // The sphere (about 32 m across) a fifth of the frame's height.
  const fov = 5 * (32 / distance);
  const lens = THREE.MathUtils.clamp(lensForFov(fov), ...lensRange());
  enterEye(spot.x, spot.z, { heading, pitch, lens });
}

/** Bars above the time slider for when each path is clear and when streets line up. */
function updateTracks() {
  const from = dayStart();
  const pct = (t) => `${(((t - from) / 86_400_000) * 100).toFixed(2)}%`;
  const rows = [];
  for (const path of dayPaths) {
    const runs = [];
    for (const segment of path.source.segments) {
      let open = null;
      for (const p of segment) {
        if (p.clear === false) open = null;
        else if (open) open.to = p.t;
        else runs.push((open = { from: p.t, to: p.t }));
      }
    }
    if (layers.tower && shownBody(path)) rows.push({ cls: path.body, runs });
  }
  if (layers.streets) rows.push({ cls: 'streets', runs: moments.filter(shownBody).map((m) => ({ from: m.from, to: m.to })) });
  const tracks = document.getElementById('tracks');
  const cloudRow = cloudTrack();
  tracks.replaceChildren(
    ...(cloudRow ? [cloudRow] : []),
    ...rows.map((row) => {
      const line = document.createElement('div');
      line.className = `track track--${row.cls}`;
      for (const run of row.runs) {
        const bar = document.createElement('span');
        bar.style.left = pct(run.from);
        bar.style.width = `calc(${pct(run.to)} - ${pct(run.from)} + 3px)`;
        line.append(bar);
      }
      return line;
    }),
  );
}

/** The day's clouds above the slider: high, mid and low in three thin bands, darker with more cover. */
function cloudTrack() {
  if (!weather || !layers.weather) return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'track track--clouds';
  canvas.width = 24 * 4;
  canvas.height = 3;
  const ctx = canvas.getContext('2d');
  [['high', '#9aa3b5'], ['mid', '#6f788b'], ['low', '#454c5c']].forEach(([layer, colour], row) => {
    weather.berlin[layer].forEach((cover, hour) => {
      ctx.globalAlpha = Math.min(1, cover * 1.1);
      ctx.fillStyle = colour;
      ctx.fillRect(hour * 4, row, 4, 1);
    });
  });
  canvas.title = 'Cloud through the day: high, middle and low';
  return canvas;
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

/** Above the tallest roof and the tower's tip, metres. */
const SHADOW_TOP_M = 420;
const depthPoint = new THREE.Vector3();
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
  // Depth along the light. With a low sun the view stretches a long way along it, so a fixed
  // range would leave shadows only in a strip across the city.
  let nearest = distance - 1500;
  let farthest = distance + 1500;
  if (!standing) {
    nearest = Infinity;
    farthest = -Infinity;
  }
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
      for (const height of [-15, SHADOW_TOP_M]) {
        depthPoint.set(corner.x, height, corner.z).applyMatrix4(lightView);
        nearest = Math.min(nearest, -depthPoint.z);
        farthest = Math.max(farthest, -depthPoint.z);
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
  // The box's sides reach past the view, and tall buildings there cast into it.
  shadowCamera.near = Math.max(1, nearest - margin - SHADOW_TOP_M);
  shadowCamera.far = farthest + margin + SHADOW_TOP_M;
  shadowCamera.updateProjectionMatrix();
  sun.shadow.bias = -Math.max(0.2, texel * 0.6) / (shadowCamera.far - shadowCamera.near);
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
// At eye level the mini map stands as tall as the card beside it.
// Set on the next frame and only when it changes: the map's size feeds back into the card's.
let mapSize = 0;
new ResizeObserver(() => {
  requestAnimationFrame(() => {
    const height = document.querySelector('.panel').offsetHeight;
    if (document.body.dataset.eye !== 'true' || height === mapSize) return;
    mapSize = height;
    document.body.style.setProperty('--map-size', `${height}px`);
  });
}).observe(document.querySelector('.panel'));
// The bottom block: the sheet, and at eye level the camera row above it.
const panel = document.querySelector('.bottom');
const frameTimes = [];

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
  highlights.group.visible = layers.streets;
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
  stepWalk(now);
  stepLift(now);
  syncLink(now);
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
  frameTimes.push(now - lastFrame);
  if (frameTimes.length > 60) frameTimes.shift();
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
  // At street level the real sun or moon is down the street; the beams are a map device.
  ribbonUniforms.uBeams.value = (1 - street) * cloudPasses;
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
  let eclipseHere = null;
  skyUniforms.uCorona.value = 0;
  if (street > 0.5) {
    updateForecast(now);
    eclipseHere = showEclipseStatus(now);
    const sun = eclipseHere.items.find((item) => item.body === 'sun');
    if (sun) {
      // Full behind the sphere: the whole corona. Grazing its edge: a hint of it.
      const overlap = THREE.MathUtils.clamp((eclipseHere.radiusDeg + DISC_RADIUS_DEG - sun.sepDeg) / (2 * DISC_RADIUS_DEG), 0, 1);
      // A corona needs the whole disc hidden; a sphere smaller than the sun leaves a ring of daylight.
      skyUniforms.uCorona.value = eclipseHere.radiusDeg > DISC_RADIUS_DEG ? overlap * overlap : 0;
      skyUniforms.uCoronaR.value = THREE.MathUtils.degToRad(eclipseHere.radiusDeg);
    }
  }
  taps = drawOverlay({
    camera,
    target: controls.target,
    night,
    bodies,
    stands: street > 0 ? [] : stands,
    bottomInset: panel.offsetHeight + 16,
    eye: street > 0.5 ? look : null,
    eclipse: street > 0.5 ? eclipseHere : null,
    photographer: street > 0 || drag?.moved ? null : photographer,
    paths: towerItems(dayPaths),
    spots: towerItems(spots),
    rays: towerItems(rays),
    hourRays: towerItems(hourRays),
    names: layers.names,
    drop: drag?.drop ?? null,
  });
  if (street > 0.5) {
    const aspect = innerWidth / innerHeight;
    const hfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(eyeCamera.fov) / 2) * aspect));
    drawMinimap({ look, fov: hfov, paths: towerItems(dayPaths), rays: towerItems(rays), spots: towerItems(spots), bodies, night });
  }
  needle.style.transform = `rotate(${camera === eyeCamera ? -look.heading : THREE.MathUtils.radToDeg(controls.getAzimuthalAngle())}deg)`;
  tiltButton.textContent = controls.getPolarAngle() < 0.2 ? '3D' : '2D';
  stats.triangles = renderer.info.render.triangles;
  stats.calls = renderer.info.render.calls;
  stats.frames++;
  if (stats.frames % 6 === 0 && params.has('stats')) {
    const sorted = [...frameTimes].sort((a, b) => a - b);
    statsEl.textContent = `frame ${sorted[sorted.length >> 1]?.toFixed(1)} ms   ${(stats.triangles / 1e6).toFixed(2)} M tris incl. shadow   ${stats.calls} calls\nshadow texel ${stats.texel.toFixed(2)} m   loaded ${(bytesLoaded / 1e6).toFixed(1)} MB   ${loading.size} loading`;
  }
}

async function start() {
  const manifest = await (await fetch(`${CITY}manifest.json${CITY_VERSION}`)).json();
  const mapData = await (await fetch(`${CITY}map.json${CITY_VERSION}`)).json();
  const roadPoints = new Int16Array(await (await fetch(`${CITY}roads.bin${CITY_VERSION}`)).arrayBuffer());
  roadXZ = roadPoints;
  const streetsDoc = await (await fetch(`${CITY}streets.json${CITY_VERSION}`)).json();
  const terrainInfo = await (await fetch(`${CITY}terrain.json${CITY_VERSION}`)).json();
  const terrain = new Int16Array(await (await fetch(`${CITY}terrain.bin${CITY_VERSION}`)).arrayBuffer());
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
  setMinimapGround(cityUniforms.uMap.value.image, half);
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
const todayInBerlin = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
function showDay() {
  const [y, m, d] = dateInput.value.split('-').map(Number);
  const isToday = dateInput.value === todayInBerlin();
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: y === new Date().getFullYear() ? undefined : 'numeric' });
  document.getElementById('day-label').textContent = isToday ? `Today, ${label}` : label;
  document.getElementById('today').hidden = isToday;
}
function setDay(value) {
  if (!value) return;
  dateInput.value = value;
  showDay();
  updateDay();
  updateSun();
  invalidate();
}
function shiftDay(days) {
  const [y, m, d] = dateInput.value.split('-').map(Number);
  setDay(new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10));
}
dateInput.addEventListener('input', () => setDay(dateInput.value));
document.getElementById('prev-day').addEventListener('click', () => shiftDay(-1));
document.getElementById('next-day').addEventListener('click', () => shiftDay(1));
document.getElementById('today').addEventListener('click', () => setDay(todayInBerlin()));
showDay();
timeInput.addEventListener('input', updateSun);
// Safari drops a request now and then while the first load is busy; try again a few times.
function loadVisibility(attempt = 0) {
  loadViewshed().then(
    (loaded) => {
      viewshed = loaded;
      if (rawPaths.length) buildPaths();
      invalidate();
    },
    (error) => {
      if (attempt < 3) setTimeout(() => loadVisibility(attempt + 1), 1500 * (attempt + 1));
      else console.error('[miniature] visibility data failed', error);
    },
  );
}
loadVisibility();
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

// ---- Links: the address holds the day, the time and, at eye level, where you stand ----------
// Shared links open the same view: ?date=2027-03-22&time=1020&at=52.5,13.4&look=268,2&lens=200&cam=ff
let lastLink = '';
let lastLinkCheck = 0;
function linkQuery() {
  const q = new URLSearchParams();
  q.set('date', dateInput.value);
  q.set('time', timeInput.value);
  if (camera === eyeCamera && look.active) {
    const [lat, lon] = latLonFromScene(look.x, look.z, FERNSEHTURM.lat, FERNSEHTURM.lon);
    q.set('at', `${lat.toFixed(6)},${lon.toFixed(6)}`);
    q.set('look', `${Math.round((((look.heading % 360) + 360) % 360) * 10) / 10},${Math.round(look.pitch * 10) / 10}`);
    q.set('lens', String(Math.round(look.lens)));
    q.set('cam', cameraFormat.format.id);
  }
  // Developer options stay put.
  for (const key of ['nointro', 'stats', 'shadow', 'budget', 'mirror', 'samples', 'blur']) if (params.has(key)) q.set(key, params.get(key));
  return q.toString().replace(/%2C/g, ',').replace(/=(&|$)/g, '$1');
}
function syncLink(now) {
  if (now - lastLinkCheck < 400 || !window.__ready) return;
  lastLinkCheck = now;
  const query = linkQuery();
  if (query === lastLink) return;
  lastLink = query;
  history.replaceState(null, '', `${location.pathname}?${query}`);
}
/** Open the view a shared link names, once the city is there to stand in. */
function openLinkedView() {
  const at = params.get('at')?.split(',').map(Number);
  if (!at || at.length !== 2 || at.some((v) => !Number.isFinite(v))) return;
  const [x, z] = sceneFromLatLon(at[0], at[1], FERNSEHTURM.lat, FERNSEHTURM.lon);
  const half = cityUniforms.uHalf.value;
  if (Math.abs(x) > half || Math.abs(z) > half) return;
  const cam = FORMATS.find((f) => f.id === params.get('cam'));
  if (cam) cameraFormat.format = cam;
  const [heading, pitch] = (params.get('look') ?? '').split(',').map(Number);
  const [lensMin, lensMax] = lensRange();
  const lens = THREE.MathUtils.clamp(Number(params.get('lens')) || 50, lensMin, lensMax);
  enterEye(x, z, { heading: Number.isFinite(heading) ? heading : 0, pitch: Number.isFinite(pitch) ? pitch : 0, lens });
}

resizeOverlay();
updateSun();
requestAnimationFrame(frame);
start().then(openLinkedView);
window.__sky = skyUniforms;
window.__mini = { get lastBlock() { return lastBlock; }, get rays() { return rays; }, clearView: (x, z, d, dist) => clearView(x, z, d, dist), get tiles() { return tiles; }, roofAt: (x, z) => roofAt(x, z), groundAt: (x, z) => groundAt(x, z), cityUniforms, sun, sky, bloom, scene, groundMaterial, enterEye, exitEye, look, sceneFromLatLon, views: () => views, face, orbitTo, invalidate, invalidateShadows, stats, getHistory: () => frameTimes, get camera() { return camera; }, get controls() { return controls; }, renderer };
