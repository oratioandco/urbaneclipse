/**
 * The shots of one Berlin day: the rows that `/plan/` lists and the home page's grid shows.
 * One pipeline for both, and nothing here needs the 3D scene: no three.js, no DOM, so the
 * home page loads it without the planner and Node can test it.
 *
 *   computeDayPaths(from, shed)            the day's tower paths, checked against the buildings
 *   collectRows(paths, moments, from, f)   every shot of the day, in time order
 *   dayShots(from, { shed, views })       both in one call, from the city data alone
 *   withoutContinued(rows, from, before)   a list of days side by side: drop a midnight repeat
 *   shotKey(row), findShot(rows, key, t)   a shot's name in a link, and the row it names
 *
 * A row is a shot for `shotCard` (shotCard.js). It also says where to stand and look, as
 * numbers a link can carry and the planner can fly to: `at` (lat, lon), `look` (heading and
 * pitch, degrees), `lens`, `openAt` (the instant to open at), and for the antenna the bearing
 * and distance of the stretch (`standBearingDeg`, `standDistanceM`). Flying there is the
 * planner's business (`go`, added in daylist.js).
 */
import { getMoonIllumination } from 'suncalc';
import { sampleBody } from '../lib/bodyPosition.ts';
import { applyView, compassPoint, computeDayPath, MIN_MOON_ILLUMINATION } from '../lib/dailyPaths.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { offsetGeodetic } from '../lib/silhouette.ts';
import { streetMoments } from '../lib/streets.ts';
import { sampleViewshed, VIEW_VISIBLE } from '../lib/viewshed.ts';
import { dayEndOf } from './dayMath.js';
import { formatClock } from './time.js';
import { alignmentMinute, discOverSphere, EYE_HEIGHT, SPHERE_TOP_AGL, TIP_AGL, visibleMoon } from './towerShots.js';

export const BODY_NAME = { sun: 'Sun', moon: 'Moon' };
const rad = (d) => (d * Math.PI) / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distanceText = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const bodyAt = (body, t) => sampleBody(body, new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);

/**
 * The day's tower paths for the day that starts at `from` (a Berlin midnight, ms): where on
 * the ground the sun and the moon stand behind the tower's sphere, minute by minute, with each
 * point marked clear or not once the viewshed (`shed`, src/lib/viewshed.ts) is given.
 */
export function computeDayPaths(from, shed = null) {
  return ['sun', 'moon']
    .map((body) => computeDayPath({ body, start: new Date(from), end: new Date(dayEndOf(from)), landmark: FERNSEHTURM }))
    .filter((path) => path.body === 'sun' || path.illumination >= MIN_MOON_ILLUMINATION)
    .map((path) => (shed ? applyView(path, (lat, lon) => sampleViewshed(shed, lat, lon) === VIEW_VISIBLE) : path))
    .map(visibleMoon);
}

/**
 * Every chance of a day, in time order: the sun or moon behind the tower's sphere, moonrise
 * and moonset behind the antenna, and street henges. `paths` are `computeDayPaths`'s,
 * `moments` the day's street moments (`streetMoments`, src/lib/streets.ts), `from` the day's
 * start. `flags` switch kinds and bodies off (`tower`, `streets`, `sun`, `moon`; all on by
 * default). Each row carries a spectacle score, so a list can rank the big moon over a short
 * henge; a short name (the place); the shot in a few words (`brief`); and for tower rows where
 * to stand (`stand`), which is all that tells two of them apart.
 */
export function collectRows(paths, moments, from, flags = {}) {
  const { tower = true, streets = true, sun = true, moon = true } = flags;
  const shown = (item) => (item.body === 'moon' ? moon : sun);
  const rows = [];
  if (tower) {
    for (const path of paths.filter(shown)) {
      // Stretches with a clear view of the tower, joined across short gaps (a building in
      // the way for a few minutes), and kept only when long enough to get to.
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
        // The geometric alignment minute for this standpoint: when the body's azimuth crosses the
        // bearing from here to the tower, not the window's start and not a middle sample.
        const align = alignmentMinute(bodyAt, path.body, (mid.bearingDeg + 180) % 360, first.t, lastPoint.t) ?? mid.t;
        const over = discOverSphere(mid.distanceM);
        const sky = bodyAt(path.body, align);
        rows.push({
          t: align,
          body: path.body,
          kind: 'tower',
          landmark: 'fernsehturm',
          short: 'TV tower',
          where: 'sphere',
          stand: `${distanceText(mid.distanceM)} ${compassPoint(mid.bearingDeg)}`,
          brief: path.body === 'moon' ? 'Moon behind TV tower' : over > 1 ? 'Sun ring at TV tower' : 'Sun behind TV tower',
          distanceM: mid.distanceM,
          // The closer the tower, the larger the body behind it: the spectacle, scored.
          score: path.body === 'moon' ? Math.min(2.4, 1.5 * over) : over > 1 ? 1.8 : 1.2,
          title: path.body === 'moon' ? `Big moon behind the TV tower, ${over.toFixed(1)}\u00d7 the sphere` : over > 1 ? 'Ring of sun round the TV tower\u2019s sphere' : 'Sun behind the TV tower\u2019s sphere',
          detail: `${formatClock(first.t)}\u2013${formatClock(lastPoint.t)}${w.broken ? ' (with breaks)' : ''} \u00b7 ${distanceText(mid.distanceM)} ${compassPoint(mid.bearingDeg)} of the tower \u00b7 ${Math.round(mid.bodyAlt)}\u00b0 up`,
          openAt: align,
          at: [mid.lat, mid.lon],
          look: [sky.az, Math.max(0, sky.alt)],
          lens: 200,
        });
      }
    }
  }
  // Moonrise and moonset behind the antenna: the moon low, more than half lit, and visible
  // round the thin mast from a few kilometres out.
  if (tower && moon) {
    const lit = getMoonIllumination(new Date(from + 43_200_000)).fraction;
    if (lit >= 0.5) {
      let open = null;
      const windows = [];
      for (let t = from; t <= dayEndOf(from); t += 5 * 60_000) {
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
        // Where the search for a clear view starts: the middle of the antenna stretch.
        const out = (reach(SPHERE_TOP_AGL, mid.alt) + reach(TIP_AGL, mid.alt)) / 2;
        const spot = offsetGeodetic(FERNSEHTURM.lat, FERNSEHTURM.lon, 0, bearing, out);
        rows.push({
          // The row's time is the minute it opens at, the middle of the stretch; the stretch
          // itself is in the detail, and the shot has passed only when the stretch has.
          t: mid.t,
          start: w.start,
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
          title: `${rising ? 'Moonrise' : 'Moonset'} behind the TV tower\u2019s antenna`,
          detail: `${formatClock(w.start)}\u2013${formatClock(w.end)} \u00b7 ${distanceText(near)}\u2013${distanceText(far)} ${compassPoint(bearing)} of the tower \u00b7 ${Math.round(lit * 100)}% lit`,
          openAt: mid.t,
          at: [spot.lat, spot.lon],
          look: [mid.az, Math.max(0, mid.alt)],
          lens: 400,
          standBearingDeg: bearing,
          standDistanceM: out,
        });
      }
    }
  }
  if (streets) {
    const seen = new Set();
    // The longest views are the ones worth a trip; the rest still show on the map and slider.
    for (const m of [...moments].filter(shown).sort((a, b) => b.view.lengthM - a.view.lengthM)) {
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
        compact: `${BODY_NAME[m.body]} \u00b7 ${m.view.name}`,
        distanceM: m.view.lengthM,
        score: Math.min(1.6, m.view.lengthM / 800),
        title: `${BODY_NAME[m.body]} down ${m.view.name}`,
        detail: `${formatClock(m.peak)} \u00b7 street henge: the ${BODY_NAME[m.body].toLowerCase()} down the street \u00b7 ${distanceText(m.view.lengthM)} long \u00b7 ${Math.round(m.bodyAlt)}\u00b0 up`,
        openAt: m.peak,
        at: m.view.from ? [m.view.from.lat, m.view.from.lon] : null,
        look: [m.view.bearingDeg, clamp(m.bodyAlt * 0.9, 0, 12)],
        lens: 85,
        moment: m,
      });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

/**
 * A day's rows without those that only continue a pass from the evening before. Rows are
 * collected a day at a time, so a moon that is low across midnight is one row late in the
 * evening and a second at 00:00 the next day: side by side in a list of days that reads as two
 * shots. A row that starts at its day's very start is dropped when the day before has the same shot
 * (place, body, kind) still running at midnight (`until`). For lists of several days only: a
 * day looked at alone keeps its 00:00 row, which is all it has of that pass.
 */
export function withoutContinued(rows, from, dayBefore = []) {
  return rows.filter((row) => (row.start ?? row.t) !== from || !dayBefore.some((b) => b.kind === row.kind && b.body === row.body && b.short === row.short && (b.until ?? b.t) >= from - 60_000));
}

/**
 * A shot's name in a link (`?shot=`): which kind and body, and for a street its name.
 * "sphere-sun", "sphere-moon", "antenna-moon", "street-sun:Sonnenallee".
 */
export const shotKey = (row) => (row.kind === 'street' ? `street-${row.body}:${row.short}` : `${row.where ?? 'sphere'}-${row.body}`);

/**
 * The row a link's `shot` names among a day's rows, or null: the one of that kind, body and
 * street whose minute is nearest the linked instant `t`, within three hours (a tower shot can
 * come twice a day; the link's time says which).
 */
export function findShot(rows, key, t) {
  let best = null;
  for (const row of rows) {
    if (shotKey(row) !== key) continue;
    const off = Math.min(Math.abs(row.t - t), Math.abs((row.openAt ?? row.t) - t));
    if (off <= 3 * 3_600_000 && (!best || off < best.off)) best = { row, off };
  }
  return best ? best.row : null;
}

/**
 * Every shot of the day that starts at `from`, from the city data alone: `shed` is the tower's
 * viewshed (src/lib/viewshed.ts), `views` the street views (src/lib/streets.ts). Without a
 * viewshed nothing says where the tower can be seen from, so no sphere rows are given: an
 * unchecked standing point is not offered as a shot.
 */
export function dayShots(from, { shed = null, views = [] } = {}) {
  const to = dayEndOf(from);
  const moments = [...streetMoments(views, 'sun', from, to, FERNSEHTURM.lat, FERNSEHTURM.lon), ...streetMoments(views, 'moon', from, to, FERNSEHTURM.lat, FERNSEHTURM.lon)];
  return collectRows(shed ? computeDayPaths(from, shed) : [], moments, from);
}
