/** The tool buttons: layers and their menu, the intro, the compass and the 2D/3D switch. */
import * as THREE from 'three';
import { bodyIcon } from './bodyAt.js';
import { moonSvg, sunSvg } from './bodies.js';
import { nameControl } from './controlNames.js';
import { icon, phaseIcon } from './icons.js';
import { orbitTo } from './camera.js';
import { dateInput, instant } from './clock.js';
import { params } from './config.js';
import { exitEye, look, turnTo } from './eyeLevel.js';
import { introLogo } from './introLogo.js';
import { updateSun } from './lighting.js';
import { updateDay } from './plan.js';
import { controls, eyeCamera } from './render.js';
import { app, invalidate } from './state.js';

/**
 * Every icon in the page comes from the one set (icons.js), and every icon-only control takes
 * its icon, tooltip and accessible name from the one table (controlNames.js). The markup only
 * says which: `data-icon="calendar"`, `data-control="layers"`.
 */
export function applyControl(el, key = el.dataset.control) {
  nameControl(el, key, { size: Number(el.dataset.iconSize) || 22 });
  if ('iconAfter' in el.dataset) el.append(el.querySelector(':scope > [data-ue-slot]'));
  // The toolbars show the tip beside the button (`data-tip`, also on keyboard focus); in the
  // panel the browser's own tooltip does. Never both.
  if (el.closest('.tools, .topleft, .ticket-head')) el.removeAttribute('title');
  else delete el.dataset.tip;
}
for (const el of document.querySelectorAll('[data-control]')) applyControl(el);
for (const el of document.querySelectorAll('[data-icon]')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, { size: Number(el.dataset.iconSize) || 20 }));
for (const el of document.querySelectorAll('[data-phase]')) el.insertAdjacentHTML('afterbegin', phaseIcon(el.dataset.phase, { size: 20 }));
// The intro's example cards: the low sun and the full moon those pictures show.
for (const el of document.querySelectorAll('[data-body]')) {
  el.innerHTML = el.dataset.body === 'moon' ? moonSvg({ fraction: 1, altitudeDeg: 6, sunAltitudeDeg: -8, size: 14, glow: false }) : sunSvg({ altitudeDeg: 3, size: 14, glow: false });
}

export const layers = { tower: true, landmarks: true, streets: true, trees: true, clouds: true, names: true, sun: true, moon: true, weather: true };
try {
  Object.assign(layers, JSON.parse(localStorage.getItem('miniature.layers') ?? '{}'));
} catch {}
export const shownBody = (item) => layers[item.body] !== false;
export const towerItems = (items) => (layers.tower ? items.filter(shownBody) : []);
/** The Siegessäule's and the Brandenburger Tor's paths and stand points: the Landmarks switch is theirs. */
export const landmarkItems = (items) => (layers.landmarks !== false ? items.filter(shownBody) : []);

document.getElementById('minimap').addEventListener('click', () => exitEye());
// The ticket at eye level: the camera's rows wait behind "More", the map of where you stand
// behind a corner button. Both are remembered.
function ticketSwitch(button, attribute, key, pressed) {
  const set = (open, remember = true) => {
    document.body.dataset[attribute] = open ? 'open' : 'closed';
    button.setAttribute(pressed, String(open));
    if (!remember) return;
    try {
      localStorage.setItem(key, open ? 'open' : 'closed');
    } catch {}
  };
  let stored = null;
  try {
    stored = localStorage.getItem(key);
  } catch {}
  set((params.get(attribute) ?? stored) === 'open', false);
  button.addEventListener('click', () => {
    set(document.body.dataset[attribute] !== 'open');
    invalidate();
  });
}
ticketSwitch(document.getElementById('ticket-more'), 'more', 'miniature.more', 'aria-expanded');
ticketSwitch(document.getElementById('minimap-toggle'), 'minimap', 'miniature.minimap', 'aria-pressed');

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
  // Not over a view or a shot the address names (a card on the home page, a shared link): the
  // introduction's examples are links that would leave it. It waits behind the ? button.
  if (!localStorage.getItem('miniature.intro') && !params.has('nointro') && !params.has('shot') && !params.has('at')) setTimeout(openIntro, 600);
} catch {}

const layersButton = document.getElementById('layers');
const layersMenu = document.getElementById('layers-menu');
// When the forecast's clouds nearly hide the map, mark the layers button, so the white on
// screen has an address — and an obvious switch.
let cloudHeavy = false;
function refreshCloudHint() {
  const covered = cloudHeavy && layers.clouds;
  layersButton.classList.toggle('clouds-heavy', covered);
  applyControl(layersButton, 'layers');
  if (!covered) return;
  layersButton.dataset.tip = 'Map layers: the forecast’s clouds cover the map';
  layersButton.setAttribute('aria-label', 'Map layers: the forecast’s clouds cover the map. Switch off “Clouds on the map” here');
}
/** Called by the weather code when the day's peak cloud cover crosses in or out of the heavy band. */
export function setCloudHint(heavy) {
  cloudHeavy = heavy;
  refreshCloudHint();
}
// Escape closes the menu, and only the menu.
addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || layersMenu.hidden) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  layersMenu.hidden = true;
  layersButton.setAttribute('aria-expanded', 'false');
  layersButton.focus({ preventScroll: true });
}, true);
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
// The sun and moon in the layers menu are the ones of the chosen minute.
function showLayersBodies() {
  const t = instant().getTime();
  for (const body of ['sun', 'moon']) document.getElementById(`layers-${body}`).innerHTML = bodyIcon(body, t, { size: 16 });
}
layersButton.addEventListener('click', showLayersBodies);
// At eye level, the buttons that turn to the sun and the moon show them as they are now.
let faces = '';
export function showFaceBodies(t, sunAlt, moonAlt) {
  const key = `${Math.round(sunAlt * 2)}|${Math.round(moonAlt * 2)}|${Math.floor(t / 86_400_000)}`;
  if (key === faces) return;
  faces = key;
  for (const body of ['sun', 'moon']) document.getElementById(`face-${body}`).innerHTML = bodyIcon(body, t, { size: 26, glow: true });
}
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
// Its word flips between 2D and 3D (main.js); the tip and the name follow.
new MutationObserver(() => {
  const key = tiltButton.textContent === '3D' ? 'tilt-angled' : 'tilt-flat';
  if (tiltButton.dataset.control !== key) applyControl(tiltButton, (tiltButton.dataset.control = key));
}).observe(tiltButton, { childList: true, characterData: true, subtree: true });
tiltButton.addEventListener('click', () => orbitTo(controls.getPolarAngle() < 0.2 ? THREE.MathUtils.degToRad(55) : 0, null));

/** The list's filters are the map's layers, so both always agree. */
/** Which of the five shot switches (sun, moon, tower, landmarks, streets) are off, as words: "Sun and Streets". */
export function switchedOff() {
  const off = [['sun', 'Sun'], ['moon', 'Moon'], ['tower', 'Tower'], ['landmarks', 'Landmarks'], ['streets', 'Streets']].filter(([key]) => layers[key] === false).map(([, word]) => word);
  return off.length < 3 ? off.join(' and ') : `${off.slice(0, -1).join(', ')} and ${off[off.length - 1]}`;
}
/** Switch all five back on. */
export function showAllShots() {
  for (const name of ['sun', 'moon', 'tower', 'landmarks', 'streets']) if (layers[name] === false) setLayer(name, true);
}

function setLayer(name, on) {
  layers[name] = on;
  try {
    localStorage.setItem('miniature.layers', JSON.stringify(layers));
  } catch {}
  for (const input of document.querySelectorAll(`input[data-layer="${name}"]`)) input.checked = on;
  for (const chip of document.querySelectorAll(`button[data-layer="${name}"]`)) chip.setAttribute('aria-pressed', String(on));
  if (name === 'clouds') refreshCloudHint();
  app.shownKey = null;
  updateDay();
  updateSun();
  invalidate();
  // Lists that are not the day's own (the year from where you stand) follow the switches too.
  document.dispatchEvent(new CustomEvent('layerchange', { detail: name }));
}
/**
 * The four shot switches as buttons (`data-layer`: sun, moon, tower, streets) inside `root`:
 * the day list's row, and any other list's copy of it. All of them show and set the one state.
 */
export function wireSwitches(root) {
  for (const chip of root.querySelectorAll('button[data-layer]')) {
    chip.setAttribute('aria-pressed', String(layers[chip.dataset.layer]));
    chip.addEventListener('click', () => setLayer(chip.dataset.layer, !layers[chip.dataset.layer]));
  }
}
wireSwitches(document.getElementById('dayfilter'));
