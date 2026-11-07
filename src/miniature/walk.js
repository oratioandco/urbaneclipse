/** Walking at eye level with keys or a stick, and flying as a drone up to 120 m. */
import * as THREE from 'three';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { camera as cameraFormat, EYE_HEIGHT, sceneFromLatLon, setFormat, setLens } from './eye.js';
import { look, updateEyeBar } from './eyeLevel.js';
import { roofAt } from './sightlines.js';
import { app, invalidate, smooth } from './state.js';

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
export function nudgeKeys() {
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

const takeoffButton = document.getElementById('takeoff');
const DRONE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="5.5" cy="5.5" r="3"/><circle cx="18.5" cy="5.5" r="3"/><circle cx="5.5" cy="18.5" r="3"/><circle cx="18.5" cy="18.5" r="3"/><path d="M7.6 7.6l2.4 2.4M16.4 7.6 14 10M7.6 16.4l2.4-2.4M16.4 16.4 14 14"/><rect x="9.5" y="9.5" width="5" height="5" rx="1.2" fill="currentColor" stroke="none"/></svg>';
const heightInput = document.getElementById('height');
const heightLabel = document.getElementById('height-label');
const airspace = document.getElementById('airspace');
app.liftAnimation = null;
let formatBeforeFlight = null;
/** Feet on the ground, or on the roof below once you have landed on one. */
function floorUnder(x, z) {
  const roof = roofAt(x, z);
  return roof > -Infinity ? roof - app.groundAt(x, z) : 0;
}
function animateLift(to, done) {
  app.liftAnimation = { from: look.lift ?? 0, to, start: performance.now(), done };
  invalidate();
}
export function stepLift(now) {
  if (!app.liftAnimation) return;
  const t = smooth(Math.min(1, (now - app.liftAnimation.start) / 1500), 0, 1);
  look.lift = THREE.MathUtils.lerp(app.liftAnimation.from, app.liftAnimation.to, t);
  showFlight();
  app.shadowsDirty = true;
  app.dirty = true;
  if (t >= 1) {
    const { done } = app.liftAnimation;
    app.liftAnimation = null;
    done?.();
  }
}
// The restricted area over the government quarter: 3 nautical miles round the Reichstag.
const ED_R_146 = { lat: 52.51861, lon: 13.37611, radiusM: 3 * 1852 };
const edr146 = sceneFromLatLon(ED_R_146.lat, ED_R_146.lon, FERNSEHTURM.lat, FERNSEHTURM.lon);
export function showFlight() {
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
  app.liftAnimation = null;
  look.lift = Math.max(floorUnder(look.x, look.z), Number(heightInput.value));
  showFlight();
  app.shadowsDirty = true;
  invalidate();
});

/** Somewhere you can be: open ground, or anywhere above the roofs once you have risen. */
const passable = (x, z) => Math.abs(x) < 9300 && Math.abs(z) < 9300 && roofAt(x, z) < app.groundAt(x, z) + EYE_HEIGHT + (look.lift ?? 0) - 0.5;

export function stepWalk(now) {
  const dt = Math.min(0.1, (now - lastStep) / 1000);
  lastStep = now;
  if (!look.active || app.lookAnimation) return;
  const forward = THREE.MathUtils.clamp((held.has('fwd') ? 1 : 0) - (held.has('back') ? 1 : 0) + pad, -1, 1);
  const sideways = THREE.MathUtils.clamp((held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0) + padSide, -1, 1);
  const turn = (held.has('turnR') ? 1 : 0) - (held.has('turnL') ? 1 : 0);
  // Only a drone changes height; on foot the keys for it do nothing.
  const climb = look.mode === 'drone' && !app.liftAnimation ? (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0) : 0;
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
  look.y = app.groundAt(look.x, look.z);
  if (look.mode !== 'drone') {
    // On foot on a roof: stay on it, and step down where it ends.
    const below = floorUnder(look.x, look.z);
    look.lift = below <= (look.lift ?? 0) + 0.6 ? below : look.lift ?? 0;
  } else showFlight();
  app.photographer.x = look.x;
  app.photographer.z = look.z;
  app.photographer.y = look.y;
  if (!shadowFrom || Math.hypot(look.x - shadowFrom.x, look.z - shadowFrom.z) > 120 || turn) {
    shadowFrom = { x: look.x, z: look.z };
    app.shadowsDirty = true;
  }
  updateEyeBar();
  app.dirty = true;
}
