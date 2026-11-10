/**
 * The planner: a white miniature of Berlin with real geometry, real shadows and the map drawn
 * into it. This file loads the city and runs the frame loop; the rest lives in modules:
 *
 * - config, state, render: settings, shared state, and the renderer, scene and cameras
 * - tiles, sightlines: the buildings, and what they hide
 * - trees, landmarks: the tree register, and the landmarks LoD2 gets wrong, modelled by hand
 * - clouds: the forecast's clouds over the map
 * - clock, lighting: the moment, and the light, sky and shadows it makes
 * - plan, forecast, daylist: the day's paths, streets, clouds and the list of chances
 * - camera, eyeLevel, walk, eclipse: moving round, standing in the street, flying, the tower
 * - pointer, chrome, link: the map's taps and hovers, the tool buttons, the address
 *
 * Frames are only drawn when something changed, and the shadow map only re-renders when the
 * light or the view moves.
 */
import * as THREE from 'three';
import { MeshoptDecoder } from 'meshoptimizer';
import { decodeStreets } from '../lib/streets.ts';
import { cityUniforms, makeTerrainTexture } from './shading.js';
import { makeHighlights, paintGroundMap, ribbonUniforms } from './map.js';
import { drawOverlay, resizeOverlay, setLabels } from './overlay.js';
import { skyUniforms } from './sky.js';
import { drawMinimap, setMinimapGround } from './minimap.js';
import { frameRect, sceneFromLatLon, setViewArea } from './eye.js';
import { DISC_RADIUS_DEG } from './towerShots.js';
import { orbitTo, stepFlight, stepOrbit } from './camera.js';
import { layers, needle, tiltButton, towerItems } from './chrome.js';
import { CITY, CITY_VERSION, REFLECTION_REACH_M, isPhone, params } from './config.js';
import { face, showEclipseStatus, updateForecast } from './eclipse.js';
import { enterEye, exitEye, look, placeEyeCamera, shotCaption, stepLook, stepTransition } from './eyeLevel.js';
import { fitShadow, renderMirror, updateHaze, updateSun } from './lighting.js';
import { openLinkedView, syncLink } from './link.js';
import './dates.js';
import './share.js';
import './locate.js';
import { updateDay } from './plan.js';
import './planmode.js';
import { TOWER_BOUND, beaconLit, beacons, bloom, composer, controls, eyeCamera, groundMaterial, overview, renderPass, renderer, scene, sizeBlur, sizeMirror, sky, skyDome, sun } from './render.js';
import { clearView, roofAt } from './sightlines.js';
import { app, invalidate, invalidateShadows, smooth, stats } from './state.js';
import { loadLevel, loading, showLevel, tiles, updateLevels, viewFrustum, viewMatrix } from './tiles.js';
import { clampToScreen, quality, sampleFrame } from './quality.js';
import { stepLift, stepWalk } from './walk.js';
import { loadTrees, setTrees, updateTrees } from './trees.js';
import { loadBlossom } from './blossomForecast.js';
import { liftOntoLandmarks } from './landmarks.js';
import { updateClouds } from './clouds.js';
import { dayStart } from './clock.js';

const statsEl = document.getElementById('stats');
app.base = null;
let lastFrame = performance.now();
// At eye level the mini map stands as tall as the card beside it.
// Set on the next frame and only when it changes: the map's size feeds back into the card's.
let mapSize = 0;
new ResizeObserver(() => {
  requestAnimationFrame(() => {
    const height = document.querySelector('.panel').offsetHeight;
    // With the dates list open the card grows tall; the map keeps its size.
    if (document.body.dataset.eye !== 'true' || document.body.dataset.dates === 'open' || height === mapSize) return;
    mapSize = height;
    document.body.style.setProperty('--map-size', `${height}px`);
  });
}).observe(document.querySelector('.panel'));
// The bottom block: the sheet, and at eye level the camera row above it.
const panel = document.querySelector('.bottom');
/** Thirds in the viewfinder, on request. */
let thirds = false;
try {
  thirds = localStorage.getItem('miniature.thirds') === 'on';
} catch {}
const thirdsButton = document.getElementById('thirds');
thirdsButton.setAttribute('aria-pressed', String(thirds));
thirdsButton.addEventListener('click', () => {
  thirds = !thirds;
  thirdsButton.setAttribute('aria-pressed', String(thirds));
  try {
    localStorage.setItem('miniature.thirds', thirds ? 'on' : 'off');
  } catch {}
  invalidate();
});
let panelTop = innerHeight;
/**
 * The viewfinder sits in the view between the buttons above and the card below, and the lens's
 * axis goes through its middle. The card's height while the dates list is open does not count.
 */
function updateViewArea() {
  if (document.body.dataset.dates !== 'open') panelTop = panel.getBoundingClientRect().top;
  const top = document.querySelector('.topleft').getBoundingClientRect().bottom;
  if (setViewArea({ left: 0, top: top + 4, right: innerWidth, bottom: panelTop - 4 })) invalidateShadows();
  const frame = frameRect();
  const dx = innerWidth / 2 - (frame.x + frame.w / 2);
  const dy = innerHeight / 2 - (frame.y + frame.h / 2);
  const view = eyeCamera.view;
  if (!view || Math.abs(view.offsetX - dx) > 0.5 || Math.abs(view.offsetY - dy) > 0.5 || view.fullWidth !== innerWidth || view.fullHeight !== innerHeight) {
    eyeCamera.setViewOffset(innerWidth, innerHeight, dx, dy, innerWidth, innerHeight);
  }
}
const frameTimes = [];

function frame(now) {
  requestAnimationFrame(frame);
  stepFlight(now);
  stepOrbit(now);
  stepLook(now);
  stepWalk(now);
  stepLift(now);
  syncLink(now);
  const flying = stepTransition(now);
  if (app.camera === eyeCamera) updateViewArea();
  placeEyeCamera();
  if (flying) {
    app.shadowsDirty = true;
    app.dirty = true;
  }
  const litNow = cityUniforms.uLights.value > 0.12 && beaconLit(Date.now());
  if (litNow !== beacons.visible) {
    beacons.visible = litNow;
    // Waking the renderer for a blink only matters if the tower is on screen.
    viewMatrix.multiplyMatrices(app.camera.projectionMatrix, app.camera.matrixWorldInverse);
    viewFrustum.setFromProjectionMatrix(viewMatrix);
    if (viewFrustum.intersectsSphere(TOWER_BOUND)) invalidate();
  }
  const moved = controls.enabled && controls.update();
  if (moved) app.shadowsDirty = true;
  if (!app.dirty && !moved && !window.__forceRender) {
    lastFrame = now;
    return;
  }
  app.dirty = false;
  frameTimes.push(now - lastFrame);
  if (frameTimes.length > 60) frameTimes.shift();
  const ratio = sampleFrame(now - lastFrame, now);
  if (ratio) {
    renderer.setPixelRatio(ratio);
    resize({ shadows: false });
  }
  lastFrame = now;
  // How far into the street the camera has come: 0 high above, 1 standing.
  let street = 0;
  if (app.camera === eyeCamera) {
    const above = eyeCamera.position.y - app.groundAt(eyeCamera.position.x, eyeCamera.position.z);
    street = 1 - smooth(above, 120, 900);
    eyeCamera.near = THREE.MathUtils.clamp(above / 150, 0.8, 10);
    eyeCamera.updateProjectionMatrix();
  }
  skyDome.visible = street > 0.001;
  updateClouds({ on: layers.clouds, camera: app.camera, street });
  skyDome.position.copy(app.camera.position);
  skyUniforms.uFade.value = street;
  // At street level the real sun or moon is down the street; the beams are a map device.
  ribbonUniforms.uBeams.value = (1 - street) * app.cloudPasses;
  // The sun's disc needs bloom at street level; from above only the city's lights do.
  bloom.enabled = app.bloomLights > 0.02 || street > 0.5;
  bloom.strength = Math.max(0.55 * app.bloomLights, 0.45 * street);
  bloom.threshold = street > 0.5 ? 1.2 : 0.95;
  app.camera.updateMatrixWorld();
  updateLevels();
  setTrees({ date: new Date(dayStart() + 43_200_000), on: layers.trees });
  updateTrees();
  // Without a key light the existing shadow map goes unread, so it can wait.
  if (app.shadowsDirty && sun.intensity > 0) {
    fitShadow();
    app.shadowsDirty = false;
  }
  renderer.info.reset();
  updateHaze(street);
  renderMirror();
  renderPass.camera = app.camera;
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
  app.taps = drawOverlay({
    camera: app.camera,
    target: controls.target,
    night: app.night,
    bodies: app.bodies,
    stands: street > 0 ? [] : app.stands,
    bottomInset: panel.offsetHeight + 16,
    eye: street > 0.5 ? look : null,
    frame: street > 0.5 ? frameRect() : null,
    caption: street > 0.5 ? shotCaption() : '',
    thirds,
    eclipse: street > 0.5 ? eclipseHere : null,
    photographer: street > 0 || app.drag?.moved ? null : app.photographer,
    paths: towerItems(app.dayPaths),
    spots: towerItems(app.spots),
    rays: towerItems(app.rays),
    hourRays: towerItems(app.hourRays),
    names: layers.names,
    drop: app.drag?.drop ?? null,
  });
  if (street > 0.5) {
    const aspect = innerWidth / innerHeight;
    const hfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(eyeCamera.fov) / 2) * aspect));
    drawMinimap({ look, fov: hfov, paths: towerItems(app.dayPaths), rays: towerItems(app.rays), spots: towerItems(app.spots), bodies: app.bodies, night: app.night });
  }
  needle.style.transform = `rotate(${app.camera === eyeCamera ? -look.heading : THREE.MathUtils.radToDeg(controls.getAzimuthalAngle())}deg)`;
  tiltButton.textContent = controls.getPolarAngle() < 0.2 ? '3D' : '2D';
  stats.triangles = renderer.info.render.triangles;
  stats.calls = renderer.info.render.calls;
  stats.frames++;
  if (stats.frames % 6 === 0 && params.has('stats')) {
    const sorted = [...frameTimes].sort((a, b) => a - b);
    statsEl.textContent = `frame ${sorted[sorted.length >> 1]?.toFixed(1)} ms   ${(stats.triangles / 1e6).toFixed(2)} M tris incl. shadow   ${stats.calls} calls\nshadow texel ${stats.texel.toFixed(2)} m   loaded ${(app.bytesLoaded / 1e6).toFixed(1)} MB   ${loading.size} loading   pixel ratio ${quality.ratio.toFixed(2)}`;
  }
}

async function start() {
  const manifest = await (await fetch(`${CITY}manifest.json${CITY_VERSION}`)).json();
  const mapData = await (await fetch(`${CITY}map.json${CITY_VERSION}`)).json();
  const roadPoints = new Int16Array(await (await fetch(`${CITY}roads.bin${CITY_VERSION}`)).arrayBuffer());
  app.roadXZ = roadPoints;
  const streetsDoc = await (await fetch(`${CITY}streets.json${CITY_VERSION}`)).json();
  const terrainInfo = await (await fetch(`${CITY}terrain.json${CITY_VERSION}`)).json();
  const terrain = new Int16Array(await (await fetch(`${CITY}terrain.bin${CITY_VERSION}`)).arrayBuffer());
  const { size, half } = terrainInfo;
  const plane = new THREE.PlaneGeometry(half * 2, half * 2, size - 1, size - 1);
  plane.rotateX(-Math.PI / 2);
  const positions = plane.attributes.position;
  for (let i = 0; i < positions.count; i++) positions.setY(i, terrain[i] / 10 - 0.4);
  const spacing = (half * 2) / (size - 1);
  app.groundAt = (x, z) => {
    const u = Math.min(size - 1.001, Math.max(0, (x + half) / spacing));
    const v = Math.min(size - 1.001, Math.max(0, (z + half) / spacing));
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const at = (a, b) => terrain[b * size + a] / 10;
    return (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
  };
  liftOntoLandmarks();
  cityUniforms.uHalf.value = half;
  cityUniforms.uTerrain.value = makeTerrainTexture(terrain, size);
  cityUniforms.uMap.value = paintGroundMap(mapData, mapData.runs, roadPoints, half, isPhone ? 2048 : 4096, renderer);
  setLabels(mapData, app.groundAt);
  setMinimapGround(cityUniforms.uMap.value.image, half);
  app.highlights = makeHighlights(scene, app.groundAt);
  app.views = decodeStreets(streetsDoc).map((view, i) => ({ ...view, a: [streetsDoc.scene[i][0], streetsDoc.scene[i][1]], b: [streetsDoc.scene[i][2], streetsDoc.scene[i][3]] }));
  updateDay();
  updateSun();
  plane.computeVertexNormals();
  plane.computeBoundingSphere();
  app.base = new THREE.Mesh(plane, groundMaterial);
  app.base.receiveShadow = true;
  scene.add(app.base);

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
  // Trees after the buildings: the city reads without them, and they are 4 MB.
  await loadTrees();
  // The cherry-blossom forecast, once the trees exist to wear it (it declines to fetch off-season).
  loadBlossom();
  invalidate();
}

/** Sizes everything that follows the window or the drawing buffer's pixel ratio. */
function resize({ shadows = true } = {}) {
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  resizeOverlay();
  ribbonUniforms.uViewportH.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  sizeMirror();
  sizeBlur();
  for (const c of [overview, eyeCamera]) {
    c.aspect = innerWidth / innerHeight;
    c.updateProjectionMatrix();
  }
  if (shadows) invalidateShadows();
  else invalidate();
}
addEventListener('resize', () => {
  clampToScreen();
  renderer.setPixelRatio(quality.ratio);
  resize();
});

// Until the city has arrived once, say so: on a slow line the first view takes a while.
const loadingEl = document.getElementById('loading');
const loadingTimer = setInterval(() => {
  if (window.__ready && loading.size === 0) {
    loadingEl.dataset.done = 'true';
    clearInterval(loadingTimer);
    return;
  }
  const mb = (app.bytesLoaded ?? 0) / 1e6;
  loadingEl.querySelector('span').textContent = mb >= 1 ? `Building Berlin \u00b7 ${mb.toFixed(0)} MB` : 'Building Berlin';
}, 250);

resizeOverlay();
updateSun();
requestAnimationFrame(frame);
start().then(openLinkedView);
window.__sky = skyUniforms;
window.__mini = { frame: () => frameRect(), get lastBlock() { return app.lastBlock; }, get rays() { return app.rays; }, clearView: (x, z, d, dist) => clearView(x, z, d, dist), get tiles() { return tiles; }, roofAt: (x, z) => roofAt(x, z), groundAt: (x, z) => app.groundAt(x, z), cityUniforms, sun, sky, bloom, scene, groundMaterial, enterEye, exitEye, look, sceneFromLatLon, views: () => app.views, face, orbitTo, invalidate, invalidateShadows, stats, getHistory: () => frameTimes, quality: () => quality.ratio, get camera() { return app.camera; }, get controls() { return controls; }, renderer };
