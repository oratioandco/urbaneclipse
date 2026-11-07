/**
 * More dates for where you stand, over the next twelve months: when the sun or moon lines up
 * with the street you are in ("Down this street"), and when it passes behind the TV tower from
 * this very spot ("Behind the tower from here"). Each date is checked against the buildings
 * before it is listed. Picking one sets the day and time and turns you to face it.
 */
import * as THREE from 'three';
import { getMoonIllumination } from 'suncalc';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { LIGHT_PHASE_NAMES, lightPhaseOf } from '../lib/lightPhases.ts';
import { EYE_HEIGHT, latLonFromScene } from './eye.js';
import { formatClock, formatDay } from './time.js';
import { discOverSphere } from './towerShots.js';
import { cloudsAt, cloudsFor, forecastReach } from './weather.js';
import { setDay, setMinute } from './clock.js';
import { bodyIcon } from './daylist.js';
import { look, turnTo } from './eyeLevel.js';
import { clearView, fineAlong } from './sightlines.js';
import { app, invalidate, toDirection } from './state.js';

const YEAR_MS = 365 * 86_400_000;
const MAX_ROWS = 40;
/** Standing this close to a street's centre line counts as standing in it, metres. */
const IN_STREET_M = 30;
/** Walking further than this makes the list out of date, metres. */
const MOVED_M = 25;

const toggle = document.getElementById('dates-toggle');
const list = document.getElementById('dates');
let worker = null;
let nextId = 1;
const pending = new Map();
let searched = null;
let watch = 0;

function search(job) {
  worker ??= new Worker(new URL('./dates.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const done = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) done?.reject(new Error(data.error));
    else done?.resolve(data.result);
  };
  const id = nextId++;
  worker.postMessage({ id, ...job });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

/** The street you stand in, facing the way you look if both directions are near. */
function streetHere() {
  let best = null;
  for (const view of app.views) {
    const [ax, az] = view.a;
    const [bx, bz] = view.b;
    const dx = bx - ax;
    const dz = bz - az;
    const f = THREE.MathUtils.clamp(((look.x - ax) * dx + (look.z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const d = Math.hypot(ax + dx * f - look.x, az + dz * f - look.z);
    if (d > IN_STREET_M) continue;
    const turn = Math.abs(((((view.bearingDeg - look.heading) % 360) + 540) % 360) - 180);
    if (!best || turn < best.turn) best = { view, turn };
  }
  return best?.view ?? null;
}

const dayOf = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const dateLabel = formatDay;

/** Midnight in Berlin at the start of a day, as an instant. */
function berlinMidnight(day) {
  const [y, m, d] = day.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const local = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return guess.getTime() - (local - utc);
}

/** Within the forecast's reach, say what the clouds will do: a clear date can still be grey. */
async function addClouds(small, t) {
  const day = dayOf(t);
  if (t < Date.now() || !forecastReach(day).ok) return;
  const start = berlinMidnight(day);
  const clouds = await cloudsFor(day, start);
  if (!clouds) return;
  const c = cloudsAt(clouds, (t - start) / 60_000);
  const cover = Math.round(100 * Math.max(c.low, c.mid, c.high));
  small.textContent += ` \u00b7 forecast: ${cover < 10 ? 'clear sky' : `${cover}% cloud${c.low > 0.6 ? ', low' : ''}`}`;
}

const TOWER_STATE = {
  sun: { hidden: 'Sun behind the sphere', ring: 'Ring of sun round the sphere', edge: 'Sun at the sphere’s edge', antenna: 'Sun behind the antenna' },
  moon: { edge: 'Moon at the sphere’s edge', antenna: 'Moon behind the antenna' },
};

function row({ body, t, title, detail, go }) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'dayrow';
  item.dataset.body = body;
  item.innerHTML = `${bodyIcon(body, t)}<span><b></b><small></small></span><em>Go ›</em>`;
  item.querySelector('b').textContent = title;
  item.querySelector('small').textContent = detail;
  addClouds(item.querySelector('small'), t);
  item.addEventListener('click', () => {
    go();
    for (const other of list.querySelectorAll('.dayrow')) other.removeAttribute('aria-current');
    item.setAttribute('aria-current', 'true');
    invalidate();
  });
  return item;
}

function section(heading, note) {
  const box = document.createElement('section');
  const h = document.createElement('h3');
  h.textContent = heading;
  box.append(h);
  if (note) box.append(paragraph(note));
  return box;
}

function paragraph(text) {
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  return p;
}

const describeLight = (body, t, lat, lon) => {
  const parts = [LIGHT_PHASE_NAMES[lightPhaseOf(t, lat, lon)]];
  if (body === 'moon') parts.push(`${Math.round(getMoonIllumination(new Date(t)).fraction * 100)}% lit`);
  return parts.join(' · ');
};

/** Search from where you stand and fill the list. */
async function refresh() {
  const spot = { x: look.x, z: look.z, lift: look.lift ?? 0 };
  searched = spot;
  const [lat, lon] = latLonFromScene(spot.x, spot.z, FERNSEHTURM.lat, FERNSEHTURM.lon);
  const now = Date.now();
  const street = streetHere();
  const towerBox = section('Behind the tower from here', 'Searching the next 12 months…');
  const streetBox = street ? section(`Down ${street.name}`, 'Searching the next 12 months…') : null;
  list.replaceChildren(...[streetBox, towerBox].filter(Boolean));

  const base = app.groundAt(0, 0);
  const eye = { x: spot.x, y: app.groundAt(spot.x, spot.z) + EYE_HEIGHT + spot.lift, z: spot.z };
  const flat = Math.hypot(spot.x, spot.z);
  const towerJob = search({ kind: 'tower', eye, base, lat, lon, start: now, end: now + YEAR_MS });
  const streetJob = street
    ? search({ kind: 'street', view: { bearingDeg: street.bearingDeg, skylineDeg: street.skylineDeg, toleranceDeg: street.toleranceDeg, from: { lat, lon } }, start: now, end: now + YEAR_MS })
    : null;

  // Full detail for the checks: toward the tower, and down the street.
  const towardTower = new THREE.Vector3(-spot.x, 0, -spot.z).normalize();
  await fineAlong(spot.x, spot.z, towardTower, flat);
  if (street) await fineAlong(spot.x, spot.z, toDirection(new THREE.Vector3(), street.bearingDeg, 0), 1500);
  const direction = new THREE.Vector3();

  if (streetJob) {
    streetJob.then(
      (passes) => {
        if (searched !== spot) return;
        const open = passes.filter((p) => clearView(spot.x, spot.z, toDirection(direction, p.bodyAz, p.bodyAlt), 3000, spot.lift));
        const box = section(`Down ${street.name}`);
        if (!passes.length) box.append(paragraph('Neither the sun nor a well-lit moon lines up with this direction of the street in the next 12 months. Try facing the other way.'));
        else if (!open.length) box.append(paragraph(`All ${passes.length} dates are hidden by buildings from this spot. Try further along the street.`));
        for (const p of open.slice(0, MAX_ROWS)) {
          box.append(
            row({
              body: p.body,
              t: p.peak,
              title: `${dateLabel(p.peak)} · ${formatClock(p.peak)}`,
              detail: `${p.body === 'sun' ? 'Sun' : 'Moon'} down the street · ${Math.round(p.bodyAlt)}° up · ${describeLight(p.body, p.peak, lat, lon)}`,
              go: () => {
                setDay(dayOf(p.peak));
                setMinute(p.peak);
                turnTo(street.bearingDeg, THREE.MathUtils.clamp(p.bodyAlt * 0.9, 0, 12));
              },
            }),
          );
        }
        if (open.length > MAX_ROWS) box.append(paragraph(`The next ${MAX_ROWS} of ${open.length} dates.`));
        if (open.length && open.length < passes.length) box.append(paragraph(`${passes.length - open.length} more hidden by buildings from this spot.`));
        streetBox.replaceWith(box);
      },
      (error) => streetBox.replaceWith(section(`Down ${street.name}`, `Could not search: ${error.message}`)),
    );
  }

  towerJob.then(
    (shots) => {
      if (searched !== spot) return;
      // Stop the check short of the tower, which would otherwise count as in the way.
      const open = shots.filter((s) => clearView(spot.x, spot.z, toDirection(direction, s.az, s.alt), Math.max(20, flat - 40) / Math.cos(THREE.MathUtils.degToRad(s.alt)), spot.lift));
      const box = section('Behind the tower from here');
      if (!shots.length) box.append(paragraph('Neither the sun nor the moon passes behind the tower from this spot in the next 12 months. Tower lines on the map show where they do.'));
      else if (!open.length) box.append(paragraph('Buildings hide the tower from here. Try a few steps along, or take off.'));
      for (const s of open.slice(0, MAX_ROWS)) {
        const what = s.body === 'moon' && s.state === 'ring' ? `Big moon behind the TV tower, ${discOverSphere(flat).toFixed(1)}× the sphere` : TOWER_STATE[s.body][s.state];
        box.append(
          row({
            body: s.body,
            t: s.peak,
            title: `${dateLabel(s.peak)} · ${formatClock(s.peak)}`,
            detail: `${what} · ${Math.round(s.alt)}° up · ${describeLight(s.body, s.peak, lat, lon)}`,
            go: () => {
              setDay(dayOf(s.peak));
              setMinute(s.peak);
              turnTo(s.az, Math.max(0, s.alt));
            },
          }),
        );
      }
      if (open.length > MAX_ROWS) box.append(paragraph(`The next ${MAX_ROWS} of ${open.length} dates.`));
      if (open.length && open.length < shots.length) box.append(paragraph(`${shots.length - open.length} more hidden by buildings from this spot.`));
      towerBox.replaceWith(box);
    },
    (error) => towerBox.replaceWith(section('Behind the tower from here', `Could not search: ${error.message}`)),
  );
}

/** While open, offer a new search once you have walked or flown away from the searched spot. */
function watchSpot() {
  const moved = searched && Math.hypot(look.x - searched.x, look.z - searched.z, (look.lift ?? 0) - searched.lift) > MOVED_M;
  const button = list.querySelector('.dates-again');
  if (moved && !button) {
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'dates-again';
    again.textContent = 'You have moved: search from here';
    again.addEventListener('click', refresh);
    list.prepend(again);
  }
}

export function setDates(open) {
  document.body.dataset.dates = open ? 'open' : 'closed';
  toggle.setAttribute('aria-expanded', String(open));
  clearInterval(watch);
  if (!open) return;
  if (!searched || Math.hypot(look.x - searched.x, look.z - searched.z, (look.lift ?? 0) - searched.lift) > 5) refresh();
  watch = setInterval(watchSpot, 500);
}

toggle.addEventListener('click', () => setDates(document.body.dataset.dates !== 'open'));
// On touch screens the keyboard hint is hidden, which leaves room beside the heading: the
// button goes there rather than taking a line of its own.
if (matchMedia('(pointer: coarse)').matches) document.getElementById('facing').after(toggle);
