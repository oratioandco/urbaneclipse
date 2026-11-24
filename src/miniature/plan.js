/**
 * The day's plan: tower paths and hour lines, street henges and the spots for now. The panel
 * draws from it: the day view (dayview.js), the day list and the coming days.
 */
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { streetMoments } from '../lib/streets.ts';
import { alignmentLine, pointAtTime } from '../lib/dailyPaths.ts';
import { loadViewshed } from '../lib/viewshed.ts';
import { formatHour } from './time.js';
import { sceneFromLatLon } from './eye.js';
import { antennaRange } from './towerShots.js';
import { layers, shownBody } from './chrome.js';
import { dayEnd, dayStart, instant, showPhases } from './clock.js';
import { computeDayPaths as towerPaths } from './dayShots.js';
import { renderDayList } from './daylist.js';
import { renderDayView } from './dayview.js';
import { renderPlanCards } from './planmode.js';
import { loadWeather } from './forecast.js';
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
  app.stands = live.map((m) => ({ x: m.view.a[0], z: m.view.a[1], y: app.groundAt(m.view.a[0], m.view.a[1]) + 2, name: m.view.name, body: m.body, css: NEON_CSS[m.body] }));
}

export function updateDay() {
  const from = dayStart();
  const to = dayEnd();
  showPhases();
  app.moments = [
    ...streetMoments(app.views, 'sun', from, to, FERNSEHTURM.lat, FERNSEHTURM.lon),
    ...streetMoments(app.views, 'moon', from, to, FERNSEHTURM.lat, FERNSEHTURM.lon),
  ].sort((a, b) => a.peak - b.peak);
  app.shownKey = null;
  loadWeather();
  computePaths();
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

/** The day's paths for any date (dayShots.js, shared with the home page), put into scene
 * coordinates for the map; `source` keeps the path as computed, which the rows are read from. */
export function computeDayPaths(from, shed = viewshed) {
  return towerPaths(from, shed).map((path) => ({
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
  app.dayReady = true;
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

/**
 * The day view shows when each path is clear and when streets line up, as shots on its scale.
 * Called when the day's paths, its forecast or the layers change (the name is from when these
 * were bars above the slider; forecast.js still calls it).
 */
export function updateTracks() {
  renderDayView();
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
