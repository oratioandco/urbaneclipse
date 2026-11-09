/**
 * The light for the moment: sun, moon, sky, haze and clouds; the shadow map fitted to the
 * view; and the water's mirror view.
 */
import * as THREE from 'three';
import { getMoonIllumination } from 'suncalc';
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { LIGHT_PHASE_NAMES, lightPhaseAt } from '../lib/lightPhases.ts';
import { lightAt } from './light.js';
import { cityUniforms, mirrorGround } from './shading.js';
import { ribbonUniforms } from './map.js';
import { skyUniforms } from './sky.js';
import { cloudDrift, cloudsAt, visibilityAt } from './weather.js';
import { formatMinutes } from './time.js';
import { lookDirection } from './eye.js';
import { skyPalette } from '../lib/skyPalette.ts';
import { worldHeightNow } from './camera.js';
import { layers } from './chrome.js';
import { clock, fine, instant, timeInput } from './clock.js';
import { LIGHT_DISTANCE, MIRROR_SCALE, REFLECTION_REACH_M, SHADOW_SIZE, VIEW_RADIUS, params } from './config.js';
import { look } from './eyeLevel.js';
import { updateHighlights, updateSpots } from './plan.js';
import { controls, edgeBlur, eyeCamera, glow, groundMaterial, mirrorTarget, overview, renderer, scene, sky, skyDome, sun } from './render.js';
import { app, invalidateShadows, smooth, stats, toDirection } from './state.js';
import { tileSphere, tiles, viewFrustum, viewMatrix } from './tiles.js';

const sunLabel = document.getElementById('sun');

const sunDirection = new THREE.Vector3(0, 1, 0);
const keyDirection = new THREE.Vector3(0, 1, 0);
const background = new THREE.Color();

const moonDirection = new THREE.Vector3();

app.bodies = [];
const mirrorSky = new THREE.Color();
const WATER_TINT = new THREE.Color(0.62, 0.84, 1.22);
app.night = false;
app.bloomLights = 0;

export function updateSun() {
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
  app.cloudNow = app.weather && layers.weather ? cloudsAt(app.weather, Number(timeInput.value)) : null;
  const passes = app.cloudNow ? (1 - 0.85 * app.cloudNow.low) * (1 - 0.55 * app.cloudNow.mid) * (1 - 0.2 * app.cloudNow.high) : 1;
  app.cloudPasses = passes;
  // The clouds themselves, in the sky and as shadows on the city, drifting with the wind.
  const drift = app.cloudNow ? cloudDrift(app.weather, Number(timeInput.value)) : { x: 0, z: 0 };
  for (const u of [skyUniforms, cityUniforms]) {
    u.uCloudLow.value = app.cloudNow?.low ?? 0;
    u.uCloudMid.value = app.cloudNow?.mid ?? 0;
    u.uCloudHigh.value = app.cloudNow?.high ?? 0;
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
  cityUniforms.uKeyLight.value.copy(sun.color).multiplyScalar(sun.intensity * app.cloudPasses);
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
  app.bloomLights = rig.lights;

  app.night = sunAt.alt < -3;
  document.body.dataset.night = String(app.night);
  app.bodies = [];
  if (sunAt.alt > -1) app.bodies.push({ az: sunAt.az, alt: sunAt.alt, sunAlt: sunAt.alt });
  if (moonAt.alt > -1) app.bodies.push({ az: moonAt.az, alt: moonAt.alt, sunAlt: sunAt.alt, moon: illumination });
  document.getElementById('face-sun').hidden = !app.bodies.some((b) => !b.moon);
  document.getElementById('face-moon').hidden = !app.bodies.some((b) => b.moon);

  if (document.activeElement !== clock) clock.value = formatMinutes(Number(timeInput.value), fine.on);
  const phase = LIGHT_PHASE_NAMES[lightPhaseAt(sunAt.alt)];
  sunLabel.textContent = `${phase} \u00b7 ${sunAt.alt > -0.5 ? `sun ${sunAt.alt.toFixed(0)}\u00b0` : moonAt.alt > 0 ? `moon ${Math.round(illumination.fraction * 100)}% lit` : 'moon down'}`;
  updateHighlights(when.getTime());
  updateSpots(when.getTime());
  invalidateShadows();
}

const corner = new THREE.Vector3();
const farCorner = new THREE.Vector3();
const lightView = new THREE.Matrix4();

/** Standing up, shadows matter most within a few hundred metres ahead. */
const EYE_SHADOW_SPAN = 1400;

/** Above the tallest roof and the tower's tip, metres. */
const SHADOW_TOP_M = 420;
const depthPoint = new THREE.Vector3();
export function fitShadow() {
  const distance = LIGHT_DISTANCE;
  const standing = app.camera === eyeCamera && eyeCamera.position.y - app.groundAt(eyeCamera.position.x, eyeCamera.position.z) < 300;
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
      corner.set(x, y, -1).unproject(app.camera);
      farCorner.set(x, y, 1).unproject(app.camera);
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

/** Haze starts beyond the middle of the view, whatever the zoom; standing, it is the real air. */
export function updateHaze(street) {
  const u = cityUniforms;
  const height = worldHeightNow();
  const across = Math.hypot(height, (height * innerWidth) / innerHeight) / 2;
  const tilt = smooth(controls.getPolarAngle(), THREE.MathUtils.degToRad(35), THREE.MathUtils.degToRad(68));
  let near = THREE.MathUtils.lerp(across * 0.62, height * 1.5, tilt);
  let far = THREE.MathUtils.lerp(across * 1.5, height * 6, tilt);
  const focus = app.camera === eyeCamera ? eyeCamera.position : controls.target;
  near = THREE.MathUtils.lerp(near, 1200, street);
  far = THREE.MathUtils.lerp(far, 14_000, street);
  // The forecast's visibility closes the air in: how far you can really look sets where the
  // haze swallows the city. Clear (24 km, the ceiling) leaves the view as it is.
  if (app.weather && layers.weather) {
    const vis = visibilityAt(app.weather, Number(timeInput.value));
    const reach = THREE.MathUtils.clamp(vis / 24_000, 0.07, 1);
    near *= reach;
    far *= reach;
  }
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
export function renderMirror() {
  cityUniforms.uMirrorOn.value = 0;
  if ((app.camera === overview && controls.getPolarAngle() < 0.14) || !app.base || MIRROR_SCALE <= 0) return;
  const near = tiles.filter((tile) => tile.nearWater && tile.mesh);
  tileSphere.radius = 0;
  viewMatrix.multiplyMatrices(app.camera.projectionMatrix, app.camera.matrixWorldInverse);
  viewFrustum.setFromProjectionMatrix(viewMatrix);
  const visible = near.some((tile) => {
    tileSphere.center.copy(tile.center);
    tileSphere.radius = tile.radius + REFLECTION_REACH_M;
    return viewFrustum.intersectsSphere(tileSphere);
  });
  if (!visible) return;
  let mirror = mirrorCameras.get(app.camera);
  if (!mirror) {
    mirror = app.camera.clone();
    mirrorCameras.set(app.camera, mirror);
  }
  const level = cityUniforms.uWaterLevel.value;
  app.camera.getWorldDirection(mirrorLook);
  mirrorUp.set(0, 1, 0).transformDirection(app.camera.matrixWorld);
  mirror.position.set(app.camera.position.x, 2 * level - app.camera.position.y, app.camera.position.z);
  mirror.up.set(mirrorUp.x, -mirrorUp.y, mirrorUp.z);
  mirrorLook.y = -mirrorLook.y;
  mirrorLook.add(mirror.position);
  mirror.lookAt(mirrorLook);
  mirror.projectionMatrix.copy(app.camera.projectionMatrix);
  mirror.projectionMatrixInverse.copy(app.camera.projectionMatrixInverse);
  mirror.updateMatrixWorld();
  cityUniforms.uMirrorVP.value.multiplyMatrices(mirror.projectionMatrix, mirror.matrixWorldInverse);

  const hidden = [];
  for (const tile of tiles) {
    if (tile.mesh && !tile.nearWater) {
      tile.mesh.visible = false;
      hidden.push(tile.mesh);
    }
  }
  app.base.material = mirrorGround;
  app.highlights.group.visible = false;
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
  app.highlights.group.visible = layers.streets;
  skyDome.visible = domeShown;
  app.base.material = groundMaterial;
  for (const mesh of hidden) mesh.visible = true;
  cityUniforms.uMirrorOn.value = 1;
}
