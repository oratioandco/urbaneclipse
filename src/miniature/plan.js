/**
 * The day's plan: tower paths and hour lines, street henges, the spots for now, and the bars
 * above the time slider.
 */
import * as THREE from 'three';
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { streetMoments } from '../lib/streets.ts';
import { alignmentLine, applyView, computeDayPath, MIN_MOON_ILLUMINATION, pointAtTime } from '../lib/dailyPaths.ts';
import { loadViewshed, sampleViewshed, VIEW_VISIBLE } from '../lib/viewshed.ts';
import { formatClock, formatHour, formatMinutes } from './time.js';
import { sceneFromLatLon } from './eye.js';
import { antennaRange, visibleMoon } from './towerShots.js';
import { flyTo } from './camera.js';
import { layers, shownBody } from './chrome.js';
import { dayStart, instant, showPhases, timeInput } from './clock.js';
import { renderDayList } from './daylist.js';
import { renderPlanCards } from './planmode.js';
import { enterEye, fullFrame } from './eyeLevel.js';
import { loadWeather } from './forecast.js';
import { updateSun } from './lighting.js';
import { eyeCamera } from './render.js';
import { app, invalidate } from './state.js';

const RAY_COLOUR = { sun: [1, 0.6, 0.16], moon: [0.56, 0.7, 1] };
const NEON_CSS = { sun: '#f26a12', moon: '#5b82ff' };
app.views = [];
app.moments = [];
app.highlights = null;
app.groundAt = () => 0;
app.shownKey = null;
app.stands = [];

export function updateHighlights(t) {
  if (!app.highlights) return;
  const live = layers.streets ? app.moments.filter((m) => shownBody(m) && t >= m.from - 60_000 && t <= m.to + 60_000) : [];
  const key = live.map((m) => `${m.body}${app.views.indexOf(m.view)}`).join('|');
  if (key === app.shownKey) return;
  app.shownKey = key;
  const when = new Date(t);
  const azimuth = { sun: sampleBody('sun', when, FERNSEHTURM.lat, FERNSEHTURM.lon).az, moon: sampleBody('moon', when, FERNSEHTURM.lat, FERNSEHTURM.lon).az };
  app.highlights.set(live.map((m) => ({ a: m.view.a, b: m.view.b, body: m.body, az: azimuth[m.body], colour: RAY_COLOUR[m.body], altitude: m.bodyAlt, strength: m.body === 'moon' ? 0.3 : 1 })));
  app.liveStreets = live;
  app.stands = live.map((m) => ({ x: m.view.a[0], z: m.view.a[1], y: app.groundAt(m.view.a[0], m.view.a[1]) + 2, name: m.view.name, css: NEON_CSS[m.body] }));
}

export function updateDay() {
  const from = dayStart();
  const to = from + 86_400_000;
  showPhases();
  app.moments = [
    ...streetMoments(app.views, 'sun', from, to, FERNSEHTURM.lat, FERNSEHTURM.lon),
    ...streetMoments(app.views, 'moon', from, to, FERNSEHTURM.lat, FERNSEHTURM.lon),
  ].sort((a, b) => a.peak - b.peak);
  app.shownKey = null;
  loadWeather();
  computePaths();
  const list = document.getElementById('moments');
  list.replaceChildren();
  const seen = new Set();
  // The longest views are the ones worth a trip; the rest can still be found with the slider.
  const best = [...app.moments].sort((a, b) => b.view.lengthM - a.view.lengthM).slice(0, 14).sort((a, b) => a.peak - b.peak);
  for (const moment of best.filter((m) => layers.streets && shownBody(m))) {
    // One chip per street: both directions of a street rarely share a moment, but parts can.
    const key = `${moment.view.name}${moment.body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const chip = document.createElement('button');
    const minutes = Math.round((moment.peak - from) / 60_000);
    const stamp = formatMinutes(minutes);
    chip.textContent = `${stamp} ${moment.view.name}`;
    chip.dataset.body = moment.body;
    chip.addEventListener('click', () => {
      timeInput.value = String(minutes);
      updateSun();
      const [x, z] = moment.view.a;
      app.photographer = { x, y: app.groundAt(x, z), z, heading: moment.view.bearingDeg };
      if (app.camera === eyeCamera) enterEye(x, z, { heading: moment.view.bearingDeg, pitch: THREE.MathUtils.clamp(moment.bodyAlt * 0.9, 0, 12), lens: fullFrame(85) });
      else flyTo((moment.view.a[0] + moment.view.b[0]) / 2, (moment.view.a[1] + moment.view.b[1]) / 2);
      invalidate();
    });
    list.append(chip);
  }
  // Saying no street lines up would be wrong while the streets are merely hidden.
  document.getElementById('moments-empty').hidden = seen.size > 0 || !layers.streets;
}

// The rules live in towerShots.js. Along a line through the tower, where the disc sits behind
// the antenna, as scene points.
function antennaStretch(line) {
  const range = antennaRange(line.bodyAlt);
  if (!range) return null;
  const far = toScene(line.farEnd);
  const length = Math.hypot(far.x, far.z) || 1;
  const at = (d) => ({ x: (far.x / length) * d, z: (far.z / length) * d, y: app.groundAt((far.x / length) * d, (far.z / length) * d) + 1 });
  return { from: at(range.fromM), to: at(range.toM), ...range };
}
let dayPlanned = false;
let viewshed = null;
app.dayPaths = [];
app.spots = [];
export const toScene = (p) => {
  const [x, z] = sceneFromLatLon(p.lat, p.lon, FERNSEHTURM.lat, FERNSEHTURM.lon);
  return { x, z, y: app.groundAt(x, z) + 1 };
};
export const getViewshed = () => viewshed;

/** The day's paths for any date, in scene coordinates, checked against the buildings once the
 * viewshed is in — the same pipeline the selected day runs, kept pure so the plan's three
 * days can share it. */
export function computeDayPaths(from, shed = viewshed) {
  const to = from + 86_400_000;
  return ['sun', 'moon']
    .map((body) => computeDayPath({ body, start: new Date(from), end: new Date(to), landmark: FERNSEHTURM }))
    .filter((path) => path.body === 'sun' || path.illumination >= MIN_MOON_ILLUMINATION)
    .map((path) => (shed ? applyView(path, (lat, lon) => sampleViewshed(shed, lat, lon) === VIEW_VISIBLE) : path))
    .map(visibleMoon)
    .map((path) => ({
      body: path.body,
      source: path,
      faint: path.body === 'moon' && path.illumination < 0.5,
      segments: path.segments.map((segment) => segment.map((p) => ({ ...toScene(p), t: p.t, clear: p.clear }))),
    }));
}

function computePaths() {
  dayPlanned = true;
  buildPaths();
}

/** The paths in scene coordinates, checked against the buildings once that data is in. */
function buildPaths() {
  const from = dayStart();
  app.dayPaths = computeDayPaths(from);
  // One line through the tower per hour, like the hours on a clock face: along each, the disc
  // sits behind some part of the tower at that hour.
  app.hourRays = [];
  const base = { x: 0, y: app.groundAt(0, 0) + 1, z: 0 };
  for (const path of app.dayPaths) {
    for (let hour = 0; hour < 24; hour++) {
      const t = from + hour * 3_600_000;
      const line = alignmentLine(path.body, t, FERNSEHTURM);
      if (line) app.hourRays.push({ body: path.body, hour, label: formatHour(hour), t, base, far: toScene(line.farEnd), antenna: path.body === 'moon' ? antennaStretch(line) : null });
    }
  }
  updateTracks();
  updateSpots(instant().getTime());
  renderDayList();
  renderPlanCards();
}

app.rays = [];
app.hourRays = [];
app.weather = null;
app.cloudNow = null;
/** How much direct light gets through the clouds now, 0 to 1. */
app.cloudPasses = 1;
export function updateSpots(t) {
  app.spots = [];
  // The line through the tower for this instant: anywhere along its bright part the disc sits
  // behind some part of the tower, the sphere at the marked spot.
  app.rays = [];
  for (const path of app.dayPaths) {
    const line = alignmentLine(path.body, t, FERNSEHTURM);
    if (line) app.rays.push({ body: path.body, far: toScene(line.farEnd), near: toScene(line.bodySide), base: { x: 0, y: app.groundAt(0, 0) + 1, z: 0 }, antenna: path.body === 'moon' ? antennaStretch(line) : null });
  }
  for (const path of app.dayPaths) {
    const p = pointAtTime(path.source, t);
    if (p && p.clear !== false) app.spots.push({ body: path.body, t: p.t, ...toScene(p) });
  }
}

/** Bars above the time slider for when each path is clear and when streets line up. */
export function updateTracks() {
  const from = dayStart();
  const pct = (t) => `${(((t - from) / 86_400_000) * 100).toFixed(2)}%`;
  const span = (fromT, toT, title, detail) => ({ from: fromT, to: toT, title, detail });
  const rows = [];
  for (const path of app.dayPaths) {
    const runs = [];
    for (const segment of path.source.segments) {
      let open = null;
      for (const p of segment) {
        if (p.clear === false) open = null;
        else if (open) open.to = p.t;
        else runs.push((open = { from: p.t, to: p.t }));
      }
    }
    if (layers.tower && shownBody(path)) {
      const who = path.body === 'sun' ? 'Sun' : 'Moon';
      rows.push({
        cls: path.body,
        runs: runs.map((run) =>
          span(
            run.from,
            run.to,
            `${who} behind the TV tower`,
            `${formatClock(run.from)}–${formatClock(run.to)} · the ${who.toLowerCase()} sits behind the tower with the buildings out of the way${path.faint ? ' · faint moon' : ''}`,
          ),
        ),
      });
    }
  }
  if (layers.streets) {
    rows.push({
      cls: 'streets',
      runs: app.moments.filter(shownBody).map((m) =>
        span(
          m.from,
          m.to,
          `${m.view.name} street henge`,
          `${formatClock(m.from)}–${formatClock(m.to)} · the ${m.body} runs straight down the street, peaking at ${formatClock(m.peak)}`,
        ),
      ),
    });
  }
  const tracks = document.getElementById('tracks');
  const cloudRow = cloudTrack();
  hideTrackTip();
  // A roving tab stop: Tab reaches the strip once, the arrow keys walk the bars.
  const bars = [];
  tracks.replaceChildren(
    ...(cloudRow ? [cloudRow] : []),
    ...rows.map((row) => {
      const line = document.createElement('div');
      line.className = `track track--${row.cls}`;
      for (const run of row.runs) {
        const bar = document.createElement('span');
        bar.style.left = pct(run.from);
        bar.style.width = `calc(${pct(run.to)} - ${pct(run.from)} + 3px)`;
        bar.dataset.tipTitle = run.title;
        bar.dataset.tipDetail = run.detail;
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', `${run.title}. ${run.detail}`);
        bars.push(bar);
        line.append(bar);
      }
      return line;
    }),
  );
  if (bars.length) bars[0].tabIndex = 0;
  for (const bar of bars.slice(1)) bar.tabIndex = -1;
}

/** One shared tooltip for the track bars, shown near the hovered or focused bar. */
const trackTip = document.createElement('div');
trackTip.id = 'track-tip';
trackTip.className = 'track-tip surface';
trackTip.setAttribute('role', 'tooltip');
trackTip.hidden = true;
document.body.append(trackTip);

function showTrackTip(bar) {
  trackTip.replaceChildren(
    Object.assign(document.createElement('b'), { textContent: bar.dataset.tipTitle }),
    Object.assign(document.createElement('small'), { textContent: bar.dataset.tipDetail }),
  );
  trackTip.hidden = false;
  placeTrackTip(bar);
}
function placeTrackTip(bar) {
  if (trackTip.hidden) return;
  const barBox = bar.getBoundingClientRect();
  const tipBox = trackTip.getBoundingClientRect();
  const left = Math.max(8, Math.min(barBox.left + barBox.width / 2 - tipBox.width / 2, window.innerWidth - tipBox.width - 8));
  let top = barBox.top - tipBox.height - 8;
  if (top < 8) top = barBox.bottom + 8;
  trackTip.style.left = `${Math.round(left)}px`;
  trackTip.style.top = `${Math.round(top)}px`;
}
function hideTrackTip() {
  trackTip.hidden = true;
}
{
  const tracks = document.getElementById('tracks');
  const barFor = (target) => (target instanceof Element ? target.closest('.track > span[data-tip-title]') : null);
  const allBars = () => [...tracks.querySelectorAll('span[data-tip-title]')];
  let bar = null;
  tracks.addEventListener('mouseover', (e) => {
    const hit = barFor(e.target);
    if (hit) showTrackTip((bar = hit));
  });
  tracks.addEventListener('mousemove', () => placeTrackTip(bar));
  tracks.addEventListener('mouseleave', hideTrackTip);
  tracks.addEventListener('focusin', (e) => {
    const hit = barFor(e.target);
    if (hit) showTrackTip((bar = hit));
  });
  tracks.addEventListener('focusout', hideTrackTip);
  tracks.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const hit = barFor(e.target);
    if (!hit) return;
    const bars = allBars();
    const at = bars.indexOf(hit) + (e.key === 'ArrowRight' ? 1 : -1);
    if (at < 0 || at >= bars.length) return;
    e.preventDefault();
    bars[at].focus();
  });
  window.addEventListener('scroll', hideTrackTip, true);
  window.addEventListener('blur', hideTrackTip);
}

/** The day's clouds above the slider: high, mid and low in three thin bands, darker with more cover. */
function cloudTrack() {
  if (!app.weather || !layers.weather) return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'track track--clouds';
  canvas.width = 24 * 4;
  canvas.height = 3;
  const ctx = canvas.getContext('2d');
  [['high', '#9aa3b5'], ['mid', '#6f788b'], ['low', '#454c5c']].forEach(([layer, colour], row) => {
    app.weather.berlin[layer].forEach((cover, hour) => {
      ctx.globalAlpha = Math.min(1, cover * 1.1);
      ctx.fillStyle = colour;
      ctx.fillRect(hour * 4, row, 4, 1);
    });
  });
  canvas.title = 'Cloud through the day: high, middle and low';
  return canvas;
}

export const PHASE_COLOURS = { night: '#1b2140', twilight: '#2f3a6e', blue: '#3f62b5', golden: '#f0a03c', day: '#f3e6c4' };

// Safari drops a request now and then while the first load is busy; try again a few times.
function loadVisibility(attempt = 0) {
  loadViewshed().then(
    (loaded) => {
      viewshed = loaded;
      if (dayPlanned) buildPaths();
      invalidate();
    },
    (error) => {
      if (attempt < 3) setTimeout(() => loadVisibility(attempt + 1), 1500 * (attempt + 1));
      else console.error('[miniature] visibility data failed', error);
    },
  );
}
loadVisibility();
