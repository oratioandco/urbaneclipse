/**
 * The renderer, the scene and what stands in it from the start: lights, the tower and its red
 * lights, the sky dome, post-processing, and the two cameras with the map controls.
 */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { cityUniforms, shadeBuildings, shadeGround, shadeTower } from './shading.js';
import { ribbonUniforms } from './map.js';
import { makeSky } from './sky.js';
import { fovForLens } from './eye.js';
import { MIRROR_SCALE, SHADOW_SIZE, isPhone, params } from './config.js';
import { app, invalidate } from './state.js';
import { quality } from './quality.js';

// No multisampling on the canvas itself: every frame is drawn into the composer's target, which
// multisamples where it helps, and the canvas only receives the finished picture.
export const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(quality.ratio);
renderer.setSize(innerWidth, innerHeight);
// Neutral keeps a colour's hue as it nears white, so low sun on a pale wall reads gold, not white.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);

export const scene = new THREE.Scene();
export const buildingMaterial = shadeBuildings(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide, shadowSide: THREE.BackSide }));
export const groundMaterial = shadeGround(new THREE.MeshLambertMaterial({ color: 0xd8d7d3 }));

export const sky = new THREE.HemisphereLight(0xffffff, 0xd8d3ca, 1.7);
scene.add(sky);
export const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
sun.shadow.radius = 1.6;
scene.add(sun, sun.target);
// The sunset sky's glow on walls facing it; see lightAt.
export const glow = new THREE.DirectionalLight(0xffffff, 0);
scene.add(glow, glow.target);

// Tower: the same solid of revolution the eclipse maths uses.
const towerPoints = FERNSEHTURM.profile.map(([h, r]) => new THREE.Vector2(r, h));
towerPoints.unshift(new THREE.Vector2(0, 0));
towerPoints.push(new THREE.Vector2(0, towerPoints[towerPoints.length - 1].y));
export const tower = new THREE.Mesh(new THREE.LatheGeometry(towerPoints, 64), shadeTower(new THREE.MeshLambertMaterial({ color: 0xffffff })));
tower.castShadow = true;
tower.receiveShadow = true;
scene.add(tower);

// Red aircraft warning lights in tiers up the antenna. Heights are read from photographs.
const BEACON_TIERS = [[368, 0], [340, 1.3], [312, 1.6], [284, 2], [256, 2.8]];
const beaconPoints = [];
for (const [height, radius] of BEACON_TIERS) {
  for (let i = 0; i < 3; i++) beaconPoints.push(Math.cos((i * 2 * Math.PI) / 3) * radius, height, Math.sin((i * 2 * Math.PI) / 3) * radius);
}
export const beacons = new THREE.Points(
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
export const beaconLit = (ms) => {
  const t = ms % 4000;
  return t < 1000 || (t >= 1500 && t < 2500);
};
export const TOWER_BOUND = new THREE.Sphere(new THREE.Vector3(0, 190, 0), 190);

// Rendered in linear light, so the city's lights can exceed white and bloom. Multisampling this
// format cost about half the frame on a dense screen, whose pixels are small enough to go without.
const composerTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Number(params.get('samples') ?? (devicePixelRatio >= 2 ? 0 : 4)) });
export const composer = new EffectComposer(renderer, composerTarget);
composer.setPixelRatio(renderer.getPixelRatio());
export const mirrorTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
export const sizeMirror = () => {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  mirrorTarget.setSize(Math.ceil(size.x * MIRROR_SCALE), Math.ceil(size.y * MIRROR_SCALE));
};
sizeMirror();
cityUniforms.uMirror.value = mirrorTarget.texture;
composer.setSize(innerWidth, innerHeight);
export const renderPass = new RenderPass(scene, null);
export const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.5, 0.55, 0.95);
composer.addPass(renderPass);
composer.addPass(bloom);
// A soft lens blur toward the edges of the view, and toward the far distance in the 3D view.
export const edgeBlur = new ShaderPass({
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
export const sizeBlur = () => edgeBlur.uniforms.uPixel.value.set(renderer.getPixelRatio() / renderer.domElement.width, renderer.getPixelRatio() / renderer.domElement.height);
sizeBlur();
edgeBlur.enabled = params.get('blur') !== '0';
composer.addPass(edgeBlur);
composer.addPass(new OutputPass());
ribbonUniforms.uViewportH.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y;

// One overview camera tilts continuously from straight down to a low angle. A narrow field of
// view keeps the angled view close to the miniature look of a parallel projection.
export const FOV = 28;
const TILT_MAX = THREE.MathUtils.degToRad(80);
export const overview = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 10, 80_000);
export const eyeCamera = new THREE.PerspectiveCamera(fovForLens(50), innerWidth / innerHeight, 1, 40_000);
app.camera = overview;
const START = { top: [0, 0], iso: [54.7, 35], free: [68, 35] };
const [startTilt, startHeading] = START[params.get('mode')] ?? START.iso;
const startHeight = Number(params.get('height')) || (isPhone ? 3200 : 2400);
overview.position
  .setFromSphericalCoords(startHeight / (2 * Math.tan((FOV * Math.PI) / 360)), THREE.MathUtils.degToRad(Number(params.get('tilt') ?? startTilt)) + 1e-4, THREE.MathUtils.degToRad(Number(params.get('heading') ?? startHeading)));
export const controls = new MapControls(overview, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = false;
controls.minDistance = 120;
controls.maxDistance = 60_000;
controls.minPolarAngle = 0;
controls.maxPolarAngle = TILT_MAX;
controls.addEventListener('change', invalidate);

export const skyDome = makeSky();
scene.add(skyDome);

export const raycaster = new THREE.Raycaster();
