/** The tool buttons: layers and their menu, the intro, the compass and the 2D/3D switch. */
import * as THREE from 'three';
import { getMoonIllumination } from 'suncalc';
import { litDiscPath } from '../lib/moonPhase.ts';
import { orbitTo } from './camera.js';
import { dateInput, dayStart } from './clock.js';
import { params } from './config.js';
import { exitEye, look, turnTo } from './eyeLevel.js';
import { introLogo } from './introLogo.js';
import { updateSun } from './lighting.js';
import { updateDay } from './plan.js';
import { controls, eyeCamera } from './render.js';
import { app, invalidate } from './state.js';

export const layers = { tower: true, streets: true, trees: true, clouds: true, names: true, sun: true, moon: true, weather: true };
try {
  Object.assign(layers, JSON.parse(localStorage.getItem('miniature.layers') ?? '{}'));
} catch {}
export const shownBody = (item) => layers[item.body] !== false;
export const towerItems = (items) => (layers.tower ? items.filter(shownBody) : []);

document.getElementById('minimap').addEventListener('click', () => exitEye());

const intro = document.getElementById('intro');
const openIntro = () => {
  if (!intro.open) intro.showModal();
  introLogo.start();
};
document.getElementById('help').addEventListener('click', openIntro);
document.getElementById('intro-start').addEventListener('click', () => intro.close());
// Opening an example from it counts as having seen it.
for (const shot of intro.querySelectorAll('.intro-shot')) {
  shot.addEventListener('click', () => {
    try {
      localStorage.setItem('miniature.intro', 'seen');
    } catch {}
  });
}
intro.addEventListener('close', () => {
  introLogo.stop();
  try {
    localStorage.setItem('miniature.intro', 'seen');
  } catch {}
});
try {
  if (!localStorage.getItem('miniature.intro') && !params.has('nointro')) setTimeout(openIntro, 600);
} catch {}

const layersButton = document.getElementById('layers');
const layersMenu = document.getElementById('layers-menu');
// When the forecast's clouds nearly hide the map, mark the layers button, so the white on
// screen has an address — and an obvious switch.
let cloudHeavy = false;
function refreshCloudHint() {
  const covered = cloudHeavy && layers.clouds;
  layersButton.classList.toggle('clouds-heavy', covered);
  layersButton.title = covered ? 'The forecast’s clouds cover the map — switch off “Clouds on the map” in the layers' : '';
}
/** Called by the weather code when the day's peak cloud cover crosses in or out of the heavy band. */
export function setCloudHint(heavy) {
  cloudHeavy = heavy;
  refreshCloudHint();
}
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
// The earlier flat map, on the same day.
const flatMap = document.getElementById('flatmap');
layersButton.addEventListener('click', () => (flatMap.href = `/map/#/day=${dateInput.value}`));
for (const input of layersMenu.querySelectorAll('input[data-layer]')) {
  input.checked = layers[input.dataset.layer];
  input.addEventListener('change', () => setLayer(input.dataset.layer, input.checked));
}
const compass = document.getElementById('compass');
export const needle = compass.querySelector('svg');
compass.addEventListener('click', () => {
  if (app.camera === eyeCamera) turnTo(0, look.pitch);
  else orbitTo(null, 0);
});
export const tiltButton = document.getElementById('tilt');
tiltButton.addEventListener('click', () => orbitTo(controls.getPolarAngle() < 0.2 ? THREE.MathUtils.degToRad(55) : 0, null));

/** The list's filters are the map's layers, so both always agree. */
function setLayer(name, on) {
  layers[name] = on;
  try {
    localStorage.setItem('miniature.layers', JSON.stringify(layers));
  } catch {}
  for (const input of document.querySelectorAll(`input[data-layer="${name}"]`)) input.checked = on;
  for (const chip of document.querySelectorAll(`#dayfilter [data-layer="${name}"]`)) chip.setAttribute('aria-pressed', String(on));
  if (name === 'clouds') refreshCloudHint();
  app.shownKey = null;
  updateDay();
  updateSun();
  invalidate();
}
for (const chip of document.querySelectorAll('#dayfilter [data-layer]')) {
  chip.setAttribute('aria-pressed', String(layers[chip.dataset.layer]));
  chip.addEventListener('click', () => setLayer(chip.dataset.layer, !layers[chip.dataset.layer]));
}
