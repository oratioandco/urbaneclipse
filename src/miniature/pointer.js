/**
 * The map under the pointer: dragging the photographer down, taps on pills and spots, and the
 * "View from here" button on lines and lit streets.
 */
import * as THREE from 'three';
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { drawPhotographer } from './overlay.js';
import { formatClock } from './time.js';
import { towerItems } from './chrome.js';
import { dayStart, instant, setMinute, timeInput } from './clock.js';
import { BODY_NAME, face } from './eclipse.js';
import { enterEye, fullFrame, look } from './eyeLevel.js';
import { updateSun } from './lighting.js';
import { controls, eyeCamera, overview, renderer } from './render.js';
import { confirmedSpotAlong, groundUnder, standable } from './sightlines.js';
import { app, invalidate, toDirection } from './state.js';

const tool = document.getElementById('photographer');
const ghost = document.getElementById('ghost');
{
  const context = ghost.getContext('2d');
  ghost.width = ghost.height = 2 * 48;
  context.scale(2, 2);
  drawPhotographer(24, 44, context);
}
app.drag = null;
// The drag is followed on the window, so it ends wherever the pointer is let go.
function dragMove(event) {
  if (!app.drag) return;
  if (Math.hypot(event.clientX - app.drag.x, event.clientY - app.drag.y) > 6) app.drag.moved = true;
  if (!app.drag.moved) return;
  ghost.hidden = false;
  ghost.style.transform = `translate(${event.clientX - 24}px, ${event.clientY - 44}px)`;
  const over = document.elementFromPoint(event.clientX, event.clientY);
  app.drag.drop = over === renderer.domElement || over?.id === 'labels' ? groundUnder(event.clientX, event.clientY) : null;
  invalidate();
}
function dragEnd(event) {
  removeEventListener('pointermove', dragMove);
  removeEventListener('pointerup', dragEnd);
  removeEventListener('pointercancel', dragEnd);
  if (!app.drag) return;
  const { moved } = app.drag;
  app.drag = null;
  ghost.hidden = true;
  invalidate();
  if (event.type === 'pointercancel') return;
  if (!moved) {
    // A tap stands the photographer in the middle of the map.
    const spot = standable(controls.target.clone().setY(app.groundAt(controls.target.x, controls.target.z)));
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
  app.drag = { x: event.clientX, y: event.clientY, moved: false };
  addEventListener('pointermove', dragMove);
  addEventListener('pointerup', dragEnd);
  addEventListener('pointercancel', dragEnd);
});

// Taps on the overlay: the pills turn the view toward their body, the marker goes back down.
app.taps = [];
let press = null;
renderer.domElement.addEventListener('pointerdown', (event) => {
  press = { x: event.clientX, y: event.clientY };
});
const viewHere = document.getElementById('viewhere');
let viewTarget = null;
app.liveStreets = [];

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
  if (app.camera !== overview) return null;
  const point = groundUnder(clientX, clientY);
  if (!point) return null;
  // About twelve pixels on screen, in metres at that spot.
  const metresPerPx = (2 * app.camera.position.distanceTo(point) * Math.tan(THREE.MathUtils.degToRad(app.camera.fov / 2))) / innerHeight;
  const reach = 12 * metresPerPx;
  let best = null;
  const offer = (candidate) => {
    if (candidate.d < reach && (!best || candidate.d < best.d)) best = candidate;
  };
  for (const ray of [...towerItems(app.rays), ...towerItems(app.hourRays)]) {
    const near = nearestOnSegment(ray.base, ray.far, point.x, point.z);
    if (Math.hypot(near.x, near.z) < 120) continue;
    offer({ ...near, kind: 'tower', body: ray.body, t: ray.t ?? instant().getTime() });
  }
  for (const path of towerItems(app.dayPaths)) {
    for (const segment of path.segments) {
      for (const p of segment) offer({ x: p.x, z: p.z, d: Math.hypot(p.x - point.x, p.z - point.z), kind: 'tower', body: path.body, t: p.t });
    }
  }
  for (const m of app.liveStreets) {
    const near = nearestOnSegment({ x: m.view.a[0], z: m.view.a[1] }, { x: m.view.b[0], z: m.view.b[1] }, point.x, point.z);
    offer({ ...near, d: near.d * 0.8, kind: 'street', body: m.body, t: m.peak, moment: m });
  }
  return best;
}

export function showViewHere(target, clientX, clientY) {
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

export async function goViewHere(target) {
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
  if (event.pointerType !== 'mouse' || event.buttons || app.drag || hoverFrame) return;
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
  const hit = app.taps.find((t) => t.kind !== 'path' && inside(t)) ?? app.taps.find((t) => t.kind === 'path' && inside(t));
  if (hit?.kind === 'spot') {
    const spot = app.spots.find((s) => s.body === hit.body);
    goViewHere({ kind: 'tower', body: spot.body, t: spot.t, x: spot.x, z: spot.z });
  }
  if (hit?.kind === 'path') {
    timeInput.value = String(Math.round((hit.t - dayStart()) / 60_000));
    updateSun();
    invalidate();
  }
  if (hit?.kind === 'pill') face(hit.body);
  if (hit?.kind === 'photographer' && app.photographer) enterEye(app.photographer.x, app.photographer.z, { heading: app.photographer.heading, pitch: look.pitch, lens: look.lens });
});
renderer.domElement.addEventListener('dblclick', (event) => {
  // At eye level, a double tap on the ground walks there.
  if (!look.active) return;
  const point = groundUnder(event.clientX, event.clientY);
  if (!point || point.distanceTo(eyeCamera.position) > 600) return;
  const spot = standable(point);
  enterEye(spot.x, spot.z, { heading: look.heading, pitch: look.pitch, lens: look.lens });
});
