/**
 * The map under the pointer: dragging the photographer down, taps on pills and spots, and the
 * "View from here" button on lines and lit streets.
 */
import { onlyAsked } from './tips.js';
import * as THREE from 'three';
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { drawPhotographer } from './overlay.js';
import { bodyIcon } from './bodyAt.js';
import { formatClock } from './time.js';
import { towerItems } from './chrome.js';
import { instant, setFine, setMinute } from './clock.js';
import { BODY_NAME, face } from './eclipse.js';
import { enterEye, fullFrame, look } from './eyeLevel.js';
import { controls, eyeCamera, overview, renderer } from './render.js';
import { clearView, confirmedSpotAlong, fineAlong, groundUnder, standable, standLift } from './sightlines.js';
import { shotClear, shotShare, treesClear } from './shotVisibility.js';
import { params } from './config.js';
import { EYE_HEIGHT } from './towerShots.js';
import { toast } from './share.js';
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
    // A long press on a touch screen only asked what the button is (tips.js).
    if (onlyAsked()) return;
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
  viewHere.innerHTML = `${bodyIcon(target.body, target.t ?? instant().getTime(), { size: 16 })}View from here <small>${what} \u00b7 ${formatClock(target.t)}</small>`;
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

/**
 * Better to say so than to drop the photographer in front of a wall; and to say it where it
 * is seen. The words used to go into the "View from here" button, which has a place only after
 * a hover on the map: a tap on a list row or a link that found no clear spot moved the clock
 * and then said nothing at all (20 December 2026, the antenna's moonset). Returns false.
 */
function noClearView(target) {
  viewTarget = null;
  viewHere.hidden = true;
  const what = target.kind === 'street' ? `down ${target.moment.view.name}` : target.kind === 'landmark' ? 'of the landmark' : 'of the tower';
  toast(`No clear view ${what} found for ${formatClock(target.t)}: buildings stand in the way along that line. Try another shot or time.`, 6000);
  return false;
}

viewHere.addEventListener('click', () => {
  const target = viewTarget;
  if (!target) return;
  viewTarget = null;
  // The search can take a moment among dense blocks; say so, and let that show before it runs.
  viewHere.innerHTML = `${bodyIcon(target.body, target.t ?? instant().getTime(), { size: 16 })}Finding a clear view\u2026`;
  setTimeout(() => goViewHere(target), 30);
});

/**
 * The target's own spot, if the view from it is clear in full detail; else null. A row's spot
 * has already passed the viewshed (dayShots.js), so it is tried first and as it is. The search
 * along the line (`confirmedSpotAlong`) looks through whatever detail is loaded and confirms
 * only what that lets through: over far tiles, loaded coarse, simplified roofs stood in every
 * sight line, the search found nothing to confirm, and a listed row opened nothing (the
 * antenna's moonset of 20 December 2026, 3 km out).
 */
async function clearAt(target, viewFrom) {
  // The row's spot, then the others it names: for the antenna further spots on the same line
  // at the same minute, for the sphere and the figures the spots of other minutes of the same
  // pass (each minute has its own spot, and its own direction to the body).
  // Clear is the shot, not a ray: the disc's rim and the target's outline against the
  // buildings in full detail (shotVisibility.js). Among the clear spots the first from which
  // the tree register's trees leave the frame too; the first clear one when trees stand in all.
  let behindTrees = null;
  for (const { x, z, t } of [target, ...(target.others ?? [])]) {
    const view = viewFrom(x, z, t ?? target.t);
    await fineAlong(x, z, view.direction, view.distance);
    const spot = { x, z, t: t ?? target.t };
    if (!target.row || params.get('shotcheck') === 'centre') {
      if (clearView(x, z, view.direction, view.distance)) return spot;
      continue;
    }
    const share = shotShare(target.row, { x, y: app.groundAt(x, z) + EYE_HEIGHT + standLift(x, z), z }, app.groundAt(0, 0), spot.t);
    if (!shotClear(share)) continue;
    // Kept for whoever asks what was seen on arrival (the sweep: scripts/adversarial/rows.mjs).
    spot.share = share;
    app.lastShare = { row: target.row, share };
    if (treesClear(share)) return spot;
    behindTrees ??= spot;
  }
  if (behindTrees) app.lastShare = { row: target.row, share: behindTrees.share };
  return behindTrees;
}

export async function goViewHere(target) {
  viewHere.hidden = true;
  setMinute(target.t);
  let p = sampleBody(target.body, new Date(target.t), FERNSEHTURM.lat, FERNSEHTURM.lon);
  const towards = toDirection(new THREE.Vector3(), p.az, Math.max(0, p.alt));
  const towardsAt = (t) => {
    const q = sampleBody(target.body, new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);
    return toDirection(new THREE.Vector3(), q.az, Math.max(0, q.alt));
  };
  if (target.kind === 'tower') {
    // Along the tower line, somewhere the tower and the body behind it are both in view: the
    // look toward the body must reach the tower without a building in between.
    const length = Math.hypot(target.x, target.z) || 1;
    // Stay on the line's useful part: out from the tower, within the model.
    // For the antenna, only the stretch of the line from which the moon is behind it (`range`).
    const keep = (x, z) => Math.hypot(x, z) > 150 && Math.abs(x) < 9000 && Math.abs(z) < 9000 && x * target.x + z * target.z > 0 && (!target.range || (Math.hypot(x, z) >= target.range[0] && Math.hypot(x, z) <= target.range[1]));
    const viewFrom = (x, z, t = target.t) => ({ direction: t === target.t ? towards : towardsAt(t), distance: Math.max(50, Math.hypot(x, z) - 40) });
    // A row's shot holds only at its own spots (`exact`): a search along the line would find a
    // clear view of the tower from which the body is no longer where the row says (59 of a
    // year's 3,037 sphere rows opened with the sun on the antenna, the shaft or beside it).
    const spot = (await clearAt(target, viewFrom)) ?? (target.exact ? null : await confirmedSpotAlong(target.x, target.z, target.x / length, target.z / length, viewFrom, keep));
    if (!spot) return noClearView(target);
    if (spot.t && spot.t !== target.t) {
      setMinute(spot.t);
      p = sampleBody(target.body, new Date(spot.t), FERNSEHTURM.lat, FERNSEHTURM.lon);
    }
    // Face the body: on a tower line it is behind some part of the tower, not always the sphere.
    enterEye(spot.x, spot.z, { heading: p.az, pitch: Math.max(0, p.alt), lens: fullFrame(target.lens ?? 200) });
    setFine(true);
    return true;
  } else if (target.kind === 'landmark') {
    // Behind the figure on a low landmark (the Viktoria, the quadriga): the alignment holds
    // at one spot only, so the search stays within a few steps of it along the line through
    // the landmark's axis, and the sight line is checked as far as the landmark.
    const dx = target.x - target.axis.x;
    const dz = target.z - target.axis.z;
    const length = Math.hypot(dx, dz) || 1;
    const keep = (x, z) => Math.hypot(x - target.x, z - target.z) <= 45;
    const viewFrom = (x, z, t = target.t) => ({ direction: t === target.t ? towards : towardsAt(t), distance: Math.max(50, Math.hypot(x - target.axis.x, z - target.axis.z) - 40) });
    const spot = (await clearAt(target, viewFrom)) ?? (await confirmedSpotAlong(target.x, target.z, dx / length, dz / length, viewFrom, keep));
    if (!spot) return noClearView(target);
    // Another minute of the pass has its own spot: the clock goes with it.
    if (spot.t && spot.t !== target.t) {
      setMinute(spot.t);
      p = sampleBody(target.body, new Date(spot.t), FERNSEHTURM.lat, FERNSEHTURM.lon);
    }
    enterEye(spot.x, spot.z, { heading: p.az, pitch: Math.max(0, p.alt), lens: fullFrame(target.lens ?? 200) });
    setFine(true);
    return true;
  } else if (target.kind === 'street') {
    const m = target.moment;
    const dx = m.view.b[0] - m.view.a[0];
    const dz = m.view.b[1] - m.view.a[1];
    const length = Math.hypot(dx, dz) || 1;
    const spot = await confirmedSpotAlong(target.x, target.z, dx / length, dz / length, () => ({ direction: towards, distance: 600 }));
    if (!spot) return noClearView(target);
    enterEye(spot.x, spot.z, { heading: m.view.bearingDeg, pitch: THREE.MathUtils.clamp(m.bodyAlt * 0.9, 0, 12), lens: fullFrame(85) });
    setFine(true);
    return true;
  }
  return false;
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
  if (hit?.kind === 'landmark') app.openLandmarkSpot?.(hit);
  if (hit?.kind === 'spot') {
    const spot = app.spots.find((s) => s.body === hit.body);
    goViewHere({ kind: 'tower', body: spot.body, t: spot.t, x: spot.x, z: spot.z });
  }
  if (hit?.kind === 'path') {
    setMinute(hit.t);
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
