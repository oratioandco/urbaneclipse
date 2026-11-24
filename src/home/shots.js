/**
 * The shots of one Berlin day, for the home grid: the same rows `/plan/` lists, without the
 * 3D scene. Pure: no DOM, no three.js, testable in Node.
 *
 * `/plan/` collects its rows in `collectRows` (src/miniature/daylist.js) from the day's tower
 * paths (`computeDayPaths` in plan.js) and street moments. Both of those modules import
 * three.js and the planner's DOM, so they cannot be loaded on the home page. This file runs
 * the same pipeline from the same pure functions (`computeDayPath`, `applyView`,
 * `visibleMoon`, `alignmentMinute`, `discOverSphere`, `streetMoments`) and words the rows the
 * same way. If `collectRows` changes, change this with it; better, move `collectRows` into a
 * module without three.js and import it from both.
 *
 * A row is a shot for `shotCard` (src/miniature/shotCard.js). Each also carries what the link
 * into `/plan/` needs: where to stand (`at`, lat and lon), where to look (`look`, heading and
 * pitch in degrees), the lens, and the instant the planner opens at (`openAt`).
 */
import { getMoonIllumination } from 'suncalc';
import { sampleBody } from '../lib/bodyPosition.ts';
import { applyView, compassPoint, computeDayPath, MIN_MOON_ILLUMINATION } from '../lib/dailyPaths.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { offsetGeodetic } from '../lib/silhouette.ts';
import { streetMoments } from '../lib/streets.ts';
import { sampleViewshed, VIEW_VISIBLE } from '../lib/viewshed.ts';
import { formatClock } from '../miniature/time.js';
import { alignmentMinute, discOverSphere, EYE_HEIGHT, SPHERE_TOP_AGL, TIP_AGL, visibleMoon } from '../miniature/towerShots.js';

const DAY_MS = 86_400_000;
const BODY_NAME = { sun: 'Sun', moon: 'Moon' };
const rad = (d) => (d * Math.PI) / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distanceText = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const bodyAt = (body, t) => sampleBody(body, new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);

/** The day's tower paths, checked against the buildings: `computeDayPaths` of plan.js without the scene. */
export function towerPaths(from, shed) {
  return ['sun', 'moon']
    .map((body) => computeDayPath({ body, start: new Date(from), end: new Date(from + DAY_MS), landmark: FERNSEHTURM }))
    .filter((path) => path.body === 'sun' || path.illumination >= MIN_MOON_ILLUMINATION)
    .map((path) => (shed ? applyView(path, (lat, lon) => sampleViewshed(shed, lat, lon) === VIEW_VISIBLE) : path))
    .map(visibleMoon);
}

/** The sun or moon behind the tower's sphere: one row per stretch with a clear view of it. */
function sphereRows(paths) {
  const rows = [];
  for (const path of paths) {
    // Stretches with a clear view of the tower, joined across short gaps (a building in the
    // way for a few minutes), and kept only when long enough to get to.
    const windows = [];
    for (const segment of path.segments) {
      for (const p of segment) {
        if (p.clear === false) continue;
        const last = windows[windows.length - 1];
        if (last && p.t - last.points[last.points.length - 1].t <= 12 * 60_000) {
          if (p.t - last.points[last.points.length - 1].t > 4 * 60_000) last.broken = true;
          last.points.push(p);
        } else windows.push({ points: [p], broken: false });
      }
    }
    for (const w of windows) {
      const first = w.points[0];
      const lastPoint = w.points[w.points.length - 1];
      if (lastPoint.t - first.t < 4 * 60_000) continue;
      const mid = w.points[Math.floor(w.points.length / 2)];
      // The minute the body's azimuth crosses the bearing from the standing point to the tower.
      const t = alignmentMinute(bodyAt, path.body, (mid.bearingDeg + 180) % 360, first.t, lastPoint.t) ?? mid.t;
      const over = discOverSphere(mid.distanceM);
      const sky = bodyAt(path.body, t);
      rows.push({
        t,
        body: path.body,
        kind: 'tower',
        landmark: 'fernsehturm',
        short: 'TV tower',
        where: 'sphere',
        stand: `${distanceText(mid.distanceM)} ${compassPoint(mid.bearingDeg)}`,
        brief: path.body === 'moon' ? 'Moon behind TV tower' : over > 1 ? 'Sun ring at TV tower' : 'Sun behind TV tower',
        distanceM: mid.distanceM,
        score: path.body === 'moon' ? Math.min(2.4, 1.5 * over) : over > 1 ? 1.8 : 1.2,
        title: path.body === 'moon' ? `Big moon behind the TV tower, ${over.toFixed(1)}× the sphere` : over > 1 ? 'Ring of sun round the TV tower’s sphere' : 'Sun behind the TV tower’s sphere',
        detail: `${formatClock(first.t)}–${formatClock(lastPoint.t)}${w.broken ? ' (with breaks)' : ''} · ${distanceText(mid.distanceM)} ${compassPoint(mid.bearingDeg)} of the tower · ${Math.round(mid.bodyAlt)}° up`,
        openAt: t,
        at: [mid.lat, mid.lon],
        look: [sky.az, Math.max(0, sky.alt)],
        lens: 200,
      });
    }
  }
  return rows;
}

/** Moonrise and moonset behind the antenna: the moon low and more than half lit. */
function antennaRows(from) {
  const rows = [];
  const lit = getMoonIllumination(new Date(from + DAY_MS / 2)).fraction;
  if (lit < 0.5) return rows;
  let open = null;
  const windows = [];
  for (let t = from; t <= from + DAY_MS; t += 5 * 60_000) {
    const p = bodyAt('moon', t);
    const low = p.alt >= 1 && p.alt <= 8;
    if (low && !open) windows.push((open = { start: t, end: t, samples: [] }));
    if (low) {
      open.end = t;
      open.samples.push({ t, ...p });
    } else open = null;
  }
  for (const w of windows) {
    if (w.samples.length < 2) continue;
    const rising = w.samples[w.samples.length - 1].alt > w.samples[0].alt;
    const mid = w.samples[Math.floor(w.samples.length / 2)];
    const reach = (h, alt) => Math.min(9000, (h - EYE_HEIGHT) / Math.tan(rad(alt)));
    const near = reach(SPHERE_TOP_AGL, Math.max(...w.samples.map((p) => p.alt)));
    const far = reach(TIP_AGL, Math.min(...w.samples.map((p) => p.alt)));
    const bearing = (mid.az + 180) % 360;
    // Where the planner starts looking for a clear view: the middle of the antenna stretch.
    const spot = offsetGeodetic(FERNSEHTURM.lat, FERNSEHTURM.lon, 0, bearing, (reach(SPHERE_TOP_AGL, mid.alt) + reach(TIP_AGL, mid.alt)) / 2);
    rows.push({
      t: w.start,
      until: w.end,
      body: 'moon',
      kind: 'tower',
      landmark: 'fernsehturm',
      short: 'TV antenna',
      where: 'antenna',
      stand: `${distanceText(near)}+ ${compassPoint(bearing)}`,
      brief: `${rising ? 'Moonrise' : 'Moonset'} on TV antenna`,
      distanceM: (near + far) / 2,
      score: 2,
      title: `${rising ? 'Moonrise' : 'Moonset'} behind the TV tower’s antenna`,
      detail: `${formatClock(w.start)}–${formatClock(w.end)} · ${distanceText(near)}–${distanceText(far)} ${compassPoint(bearing)} of the tower · ${Math.round(lit * 100)}% lit`,
      openAt: mid.t,
      at: [spot.lat, spot.lon],
      look: [mid.az, Math.max(0, mid.alt)],
      lens: 400,
    });
  }
  return rows;
}

/** Street henges: each street's moment of the day, the twelve longest views. */
function streetRows(moments) {
  const rows = [];
  const seen = new Set();
  for (const m of [...moments].sort((a, b) => b.view.lengthM - a.view.lengthM)) {
    const key = `${m.view.name}${m.body}`;
    if (seen.has(key) || seen.size >= 12) continue;
    seen.add(key);
    rows.push({
      t: m.peak,
      until: m.to,
      body: m.body,
      kind: 'street',
      short: m.view.name,
      brief: `${BODY_NAME[m.body]} down ${m.view.name}`,
      compact: `${BODY_NAME[m.body]} · ${m.view.name}`,
      distanceM: m.view.lengthM,
      score: Math.min(1.6, m.view.lengthM / 800),
      title: `${BODY_NAME[m.body]} down ${m.view.name}`,
      detail: `${formatClock(m.peak)} · street henge: the ${BODY_NAME[m.body].toLowerCase()} down the street · ${distanceText(m.view.lengthM)} long · ${Math.round(m.bodyAlt)}° up`,
      openAt: m.peak,
      at: [m.view.from.lat, m.view.from.lon],
      look: [m.view.bearingDeg, clamp(m.bodyAlt * 0.9, 0, 12)],
      lens: 85,
    });
  }
  return rows;
}

/**
 * Every shot of the day that starts at `from` (a Berlin midnight, ms), in time order.
 * `shed` is the tower's viewshed (src/lib/viewshed.ts), `views` the street views
 * (src/lib/streets.ts). Without a viewshed nothing says where the tower can be seen from, so
 * no sphere rows are given: an unchecked standing point is not offered as a shot.
 */
export function dayShots(from, { shed = null, views = [] } = {}) {
  const to = from + DAY_MS;
  const moments = [
    ...streetMoments(views, 'sun', from, to, FERNSEHTURM.lat, FERNSEHTURM.lon),
    ...streetMoments(views, 'moon', from, to, FERNSEHTURM.lat, FERNSEHTURM.lon),
  ];
  return [...(shed ? sphereRows(towerPaths(from, shed)) : []), ...antennaRows(from), ...streetRows(moments)].sort((a, b) => a.t - b.t);
}
