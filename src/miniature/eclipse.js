/**
 * At eye level, the line in the camera card: whether the sun or moon is behind the tower now,
 * how long until it is, or which way to step. Also turning to face the tower, sun or moon.
 */
import * as THREE from 'three';
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { SPHERE_CENTRE_AGL } from '../lib/dailyPaths.ts';
import { formatClock } from './time.js';
import { streetStatus } from './dayShots.js';
import { ticketShotRow } from './daylist.js';
import { compassName, EYE_HEIGHT } from './eye.js';
import { bodyAgainstTower, DISC_RADIUS_DEG, SPHERE_RADIUS_M } from './towerShots.js';
import { orbitTo } from './camera.js';
import { instant, setFine, setMinute } from './clock.js';
import { look, turnTo } from './eyeLevel.js';
import { landmarkStatus } from './landmarkView.js';
import { goViewHere } from './pointer.js';
import { eyeCamera } from './render.js';
import { clearView } from './sightlines.js';
import { app, invalidate, toDirection } from './state.js';

const eyePoint = () => new THREE.Vector3(look.x, look.y + EYE_HEIGHT + (look.lift ?? 0), look.z);
const sphereCentre = () => new THREE.Vector3(0, app.groundAt(0, 0) + SPHERE_CENTRE_AGL, 0);
const degreesBetween = (a, b) => THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)));
const bodyDirection = new THREE.Vector3();

/** How far each body is from the sphere as seen from here, and the sphere's size. */
function eclipseNow() {
  const eye = eyePoint();
  const toSphere = sphereCentre().sub(eye);
  const distance = toSphere.length();
  const radiusDeg = THREE.MathUtils.radToDeg(Math.asin(Math.min(1, SPHERE_RADIUS_M / distance)));
  toSphere.normalize();
  const base = app.groundAt(0, 0);
  const items = app.bodies.map((body) => {
    const kind = body.moon ? 'moon' : 'sun';
    const { sepDeg, state, signedOff, rise, flat, touching } = bodyAgainstTower(eye, base, body);
    return { body: kind, az: body.az, alt: body.alt, sepDeg, state, signedOff, rise, flat, covered: touching || state === 'antenna' || state === 'shaft', full: state === 'hidden' };
  });
  return { centre: sphereCentre(), radiusDeg, items };
}

/** From here, when each body comes closest to the sphere within an hour and a half either way. */
let forecastAt = 0;
let forecast = [];
export function updateForecast(now) {
  if (now - forecastAt < 300) return;
  forecastAt = now;
  const t = instant().getTime();
  const eye = eyePoint();
  const toSphere = sphereCentre().sub(eye);
  const radiusDeg = THREE.MathUtils.radToDeg(Math.asin(Math.min(1, SPHERE_RADIUS_M / toSphere.length())));
  toSphere.normalize();
  forecast = [];
  for (const path of app.dayPaths) {
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
export const BODY_NAME = { sun: 'Sun', moon: 'Moon' };
let eclipseAction = null;
/** The moon close beside the sphere, level with it: near enough to walk it onto the edge. */
function moonBeside(here) {
  return here.items.find(
    (item) => item.body === 'moon' && item.state === 'near' && Math.abs(item.rise) < here.radiusDeg + DISC_RADIUS_DEG && Math.abs(item.signedOff) < 4,
  );
}

/**
 * Whether the look from the eye toward a body reaches the tower with nothing built in between.
 * A ray cast into the city, so it is asked again only when the eye, the body (to 0.05 degrees)
 * or the buildings' detail have changed.
 */
let sightMemo = { key: '', clear: true };
function seesToTower(item) {
  const key = [Math.round(look.x), Math.round(look.z), Math.round((look.lift ?? 0) * 2), Math.round(item.az * 20), Math.round(item.alt * 20), app.tileEpoch].join('|');
  if (sightMemo.key !== key) {
    const flat = Math.hypot(look.x, look.z);
    sightMemo = { key, clear: clearView(look.x, look.z, toDirection(new THREE.Vector3(), item.az, item.alt), Math.max(20, flat - 40) / Math.cos(THREE.MathUtils.degToRad(item.alt)), look.lift ?? 0) };
  }
  return sightMemo.clear;
}

/** One line in the camera card: covered now, how long until, or where to go instead. */
export function showEclipseStatus(now) {
  const here = eclipseNow();
  const covering = here.items.find((item) => item.covered);
  const t = instant().getTime();
  let text = '';
  let state = 'soon';
  let body = 'sun';
  eclipseAction = null;
  // With a landmark's shot open (the Viktoria, the quadriga) the line is about that landmark:
  // "nothing lines up with the tower" is true there and beside the point.
  const landmark = landmarkStatus({ x: look.x, y: look.y + EYE_HEIGHT + (look.lift ?? 0), z: look.z }, t);
  if (landmark) {
    if (landmark.at !== null && landmark.state === 'soon') {
      eclipseAction = () => {
        setMinute(landmark.at);
        setFine(true);
      };
    }
    eclipseButton.hidden = false;
    eclipseButton.textContent = landmark.text;
    eclipseButton.dataset.state = landmark.state;
    eclipseButton.style.setProperty('--dot', landmark.body === 'moon' ? '#5b82ff' : '#f26a12');
    return here;
  }
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
    // The sun on the mast is a thin line across the glare, not the shot: say so without the alarm.
    if (body === 'sun' && covering.state === 'antenna') {
      state = 'soon';
      text = 'Sun behind the antenna, not the sphere';
    }
    if (body === 'moon' && covering.state === 'hidden') {
      state = 'warn';
      // Stepping sideways moves the sphere across the moon; this far puts the moon on its edge.
      const metres = covering.flat * Math.tan(THREE.MathUtils.degToRad(Math.max(0, here.radiusDeg - Math.abs(covering.signedOff))));
      text = `Moon hidden behind the sphere: step ${Math.max(1, Math.round(metres))} m left or right, or move further away`;
    }
    // The same look Dates takes (dates.js): from the eye toward the body, as far as the tower.
    // The line said "Sun at the edge of the sphere now" where Dates, rightly, said a building
    // hides it (nord-mitte on the Lichtenberger Brücke, 8 April 2027, 19:36).
    if (!seesToTower(covering)) {
      state = 'warn';
      text = `${text.replace(/ now$/, '').replace(/: .*$/, '')}, but a building hides it from here`;
    }
  } else if (streetStatus(ticketShotRow(), t)) {
    // The card above is a street's: the line speaks of that street, not of the tower.
    const street = streetStatus(ticketShotRow(), t);
    ({ text, state, body } = street);
    if (street.jumpTo !== null) {
      eclipseAction = () => {
        setMinute(street.jumpTo);
        setFine(true);
      };
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
    const spot = app.spots[0];
    if (next) {
      body = next.body;
      const minutes = Math.round((next.t - t) / 60_000);
      text = minutes > 0 ? `${BODY_NAME[body]} behind the sphere in ${minutes} min (${clockOf(next.t)})` : `${BODY_NAME[body]} was behind the sphere ${-minutes} min ago`;
      // The same look at the tower, at that minute: a pass a building hides is not promised.
      if (!seesToTower(sampleBody(body, new Date(next.t), FERNSEHTURM.lat, FERNSEHTURM.lon))) text += ', but a building hides it from here';
      eclipseAction = () => {
        setMinute(next.t);
        setFine(true);
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

function faceTower() {
  const eye = eyePoint();
  const heading = (THREE.MathUtils.radToDeg(Math.atan2(-eye.x, eye.z)) + 360) % 360;
  const pitch = THREE.MathUtils.radToDeg(Math.atan2(sphereCentre().y - eye.y, Math.hypot(eye.x, eye.z)));
  turnTo(heading, pitch);
}
document.getElementById('face-tower').addEventListener('click', faceTower);
for (const kind of ['sun', 'moon']) {
  document.getElementById(`face-${kind}`).addEventListener('click', () => {
    const body = app.bodies.find((b) => (kind === 'moon') === Boolean(b.moon));
    if (body) face(body);
  });
}

/** Face a body: at eye level by turning, from above by rotating the map so it lies ahead. */
export function face(body) {
  if (app.camera === eyeCamera) turnTo(body.az, THREE.MathUtils.clamp(body.alt * 0.8, -5, 40));
  else orbitTo(null, -THREE.MathUtils.degToRad(body.az));
}
