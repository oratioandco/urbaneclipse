/** The day as a list in the panel's planning: tower alignments and street henges, each a tap away. */
import * as THREE from 'three';
import { getMoonIllumination } from 'suncalc';
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { compassPoint } from '../lib/dailyPaths.ts';
import { shotPicture } from './shotPicture.js';
import { icon } from './icons.js';
import { formatClock } from './time.js';
import { EYE_HEIGHT } from './eye.js';
import { alignmentMinute, discOverSphere, SPHERE_TOP_AGL, TIP_AGL } from './towerShots.js';
import { layers, shownBody } from './chrome.js';
import { dayStart } from './clock.js';
import { BODY_NAME } from './eclipse.js';
import { cloudNote } from './forecast.js';
import { forecastReach } from './weather.js';
import { shotVerdict, verdict, verdictNote } from './verdict.js';
import { dateInput } from './clock.js';
import { toScene } from './plan.js';
import { goViewHere } from './pointer.js';
import { app, invalidate } from './state.js';

const dayList = document.getElementById('daylist');
const distanceText = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

/**
 * Every chance of a day, in time order: tower alignments, moonrise and moonset behind the
 * antenna, and street henges \u2014 the rows both the day list and the plan cards draw from.
 * `from` is the day's start; `flags` carry the layer switches and, when given, a instant
 * before which the day's chances have already passed. Each row also carries a spectacle
 * score, so the plan can rank the big moon over a short henge, and a short name for the day
 * view's cards (the place: the card's picture says sun or moon, tower or street), and the
 * shot in a few words (`brief`) for the peek line. Tower rows also say where to stand
 * (`stand`: how far and which side of the tower), which is all that tells two of them apart.
 */
export function collectRows(dayPaths, moments, from, flags = {}) {
  const { tower = true, streets = true, moon = true } = flags;
  const rows = [];
  if (tower) {
    for (const path of dayPaths.filter(shownBody)) {
      // Stretches with a clear view of the tower, joined across short gaps (a building in
      // the way for a few minutes), and kept only when long enough to get to.
      const windows = [];
      for (const segment of path.source.segments) {
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
        // bearing from here to the tower — not the window's start, and not a middle sample.
        const align =
          alignmentMinute(
            (body, t) => sampleBody(body, new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon),
            path.body,
            (mid.bearingDeg + 180) % 360,
            first.t,
            lastPoint.t,
          ) ?? mid.t;
        rows.push({
          t: align,
          body: path.body,
          kind: 'tower',
          short: 'TV tower',
          where: 'sphere',
          stand: `${distanceText(mid.distanceM)} ${compassPoint(mid.bearingDeg)}`,
          brief: path.body === 'moon' ? 'Moon behind TV tower' : discOverSphere(mid.distanceM) > 1 ? 'Sun ring at TV tower' : 'Sun behind TV tower',
          distanceM: mid.distanceM,
          // The closer the tower, the larger the body behind it: the spectacle, scored.
          score: path.body === 'moon' ? Math.min(2.4, 1.5 * discOverSphere(mid.distanceM)) : discOverSphere(mid.distanceM) > 1 ? 1.8 : 1.2,
          title:
            path.body === 'moon'
              ? `Big moon behind the TV tower, ${discOverSphere(mid.distanceM).toFixed(1)}\u00d7 the sphere`
              : discOverSphere(mid.distanceM) > 1
                ? 'Ring of sun round the TV tower\u2019s sphere'
                : 'Sun behind the TV tower\u2019s sphere',
          detail: `${formatClock(first.t)}\u2013${formatClock(lastPoint.t)}${w.broken ? ' (with breaks)' : ''} \u00b7 ${distanceText(mid.distanceM)} ${compassPoint(mid.bearingDeg)} of the tower \u00b7 ${Math.round(mid.bodyAlt)}\u00b0 up`,
          go: () => goViewHere({ kind: 'tower', body: path.body, t: align, ...toScene(mid) }),
        });
      }
    }
  }
  // Moonrise and moonset behind the antenna: the moon low, more than half lit, and visible
  // round the thin mast from a few kilometres out.
  if (tower && moon) {
    const lit = getMoonIllumination(new Date(from + 43_200_000)).fraction;
    if (lit >= 0.5) {
      let window = null;
      const windows = [];
      for (let t = from; t <= from + 86_400_000; t += 5 * 60_000) {
        const p = sampleBody('moon', new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);
        const low = p.alt >= 1 && p.alt <= 8;
        if (low && !window) windows.push((window = { start: t, end: t, rising: null, samples: [] }));
        if (low) {
          window.end = t;
          window.samples.push({ t, ...p });
        } else window = null;
      }
      for (const w of windows) {
        if (w.samples.length < 2) continue;
        const rising = w.samples[w.samples.length - 1].alt > w.samples[0].alt;
        const mid = w.samples[Math.floor(w.samples.length / 2)];
        const reach = (h, alt) => Math.min(9000, (h - EYE_HEIGHT) / Math.tan(THREE.MathUtils.degToRad(alt)));
        const near = reach(SPHERE_TOP_AGL, Math.max(...w.samples.map((p) => p.alt)));
        const far = reach(TIP_AGL, Math.min(...w.samples.map((p) => p.alt)));
        const bearing = (mid.az + 180) % 360;
        rows.push({
          t: w.start,
          body: 'moon',
          kind: 'tower',
          short: 'TV antenna',
          where: 'antenna',
          stand: `${distanceText(near)}+ ${compassPoint(bearing)}`,
          brief: `${rising ? 'Moonrise' : 'Moonset'} on TV antenna`,
          distanceM: (near + far) / 2,
          score: 2,
          title: `${rising ? 'Moonrise' : 'Moonset'} behind the TV tower\u2019s antenna`,
          detail: `${formatClock(w.start)}\u2013${formatClock(w.end)} \u00b7 ${distanceText(near)}\u2013${distanceText(far)} ${compassPoint(bearing)} of the tower \u00b7 ${Math.round(lit * 100)}% lit`,
          go: () => {
            // Start from the middle of the antenna stretch; the search finds a clear view near it.
            const a = THREE.MathUtils.degToRad(bearing);
            const d = (reach(SPHERE_TOP_AGL, mid.alt) + reach(TIP_AGL, mid.alt)) / 2;
            goViewHere({ kind: 'tower', body: 'moon', t: mid.t, x: Math.sin(a) * d, z: -Math.cos(a) * d, lens: 400 });
          },
        });
      }
    }
  }
  if (streets) {
    const seen = new Set();
    // The longest views are the ones worth a trip; the rest still show on the map and slider.
    for (const m of [...moments].filter(shownBody).sort((a, b) => b.view.lengthM - a.view.lengthM)) {
      const key = `${m.view.name}${m.body}`;
      if (seen.has(key) || seen.size >= 12) continue;
      seen.add(key);
      rows.push({
        t: m.peak,
        body: m.body,
        kind: 'street',
        short: m.view.name,
        brief: `${BODY_NAME[m.body]} down ${m.view.name}`,
        compact: `${BODY_NAME[m.body]} \u00b7 ${m.view.name}`,
        distanceM: m.view.lengthM,
        score: Math.min(1.6, m.view.lengthM / 800),
        title: `${BODY_NAME[m.body]} down ${m.view.name}`,
        detail: `${formatClock(m.peak)} \u00b7 street henge: the ${BODY_NAME[m.body].toLowerCase()} down the street \u00b7 ${distanceText(m.view.lengthM)} long \u00b7 ${Math.round(m.bodyAlt)}\u00b0 up`,
        go: () => goViewHere({ kind: 'street', body: m.body, t: m.peak, x: m.view.a[0], z: m.view.a[1], moment: m }),
      });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

/** The chosen day's rows, collected once per day, data and layer state. */
let rowsMemo = { key: null, rows: [] };
export function currentRows() {
  const key = [dayStart(), layers.tower, layers.streets, layers.sun, layers.moon].join('|');
  if (rowsMemo.key !== key || rowsMemo.paths !== app.dayPaths || rowsMemo.moments !== app.moments) {
    rowsMemo = {
      key,
      paths: app.dayPaths,
      moments: app.moments,
      rows: collectRows(app.dayPaths, app.moments, dayStart(), { tower: layers.tower, streets: layers.streets, moon: layers.moon }),
    };
  }
  return rowsMemo.rows;
}

/**
 * The tower alignment to snap a scrubbed minute to, or null: the nearest row\u0027s alignment
 * minute within two minutes of it \u2014 the sun needs minutes to cross the sphere, so landing
 * a minute off misses the shot. Only the ticket\u0027s scrubber at eye level snaps; the day
 * view\u0027s thumb moves freely and says so with `app.freeScrub`.
 */
export function snapMinute(t) {
  if (app.freeScrub) return null;
  let best = null;
  for (const row of currentRows()) {
    if (row.kind !== 'tower') continue;
    const d = Math.abs(row.t - t);
    if (d <= 2 * 60_000 && (!best || d < best.d)) best = { t: row.t, d };
  }
  return best ? best.t : null;
}

/** Why a day shows no shots: the filters hide them all, or nothing lines up. */
export const emptyDay = () => (!layers.tower && !layers.streets ? 'Tower and street shots are both switched off. Switch one on under \u201cThis day\u201d.' : !layers.sun && !layers.moon ? 'Sun and moon are both switched off. Switch one on under \u201cThis day\u201d.' : 'Nothing lines up on this day. Try another.');

/** The day as a list in planning: the same rows, in time order, each a tap from standing there. */
export function renderDayList() {
  const rows = currentRows();
  dayList.replaceChildren(
    ...rows.map((row) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'dayrow';
      item.dataset.body = row.body;
      item.dataset.kind = row.kind;
      item.innerHTML = `${shotPicture(row, { size: 28 })}<span><b></b><em class="verdict"></em><small></small></span>${icon('chevron-right', { size: 16, className: 'chev' })}`;
      item.querySelector('b').textContent = row.title;
      showVerdict(item.querySelector('.verdict'), dayVerdict(row));
      item.querySelector('small').textContent = row.detail + cloudNote(row.t);
      item.addEventListener('click', () => {
        row.go();
        invalidate();
      });
      return item;
    }),
  );
  if (!rows.length) dayList.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: emptyDay() }));
}

/**
 * A verdict into its element: the set's sign for it (a tick, a wave, a bar: three shapes, so it
 * reads without colour), the word and, unless `reason` is off, the reason; the grade backs the
 * word up with colour.
 */
const VERDICT_ICON = { good: 'verdict-go', fair: 'verdict-maybe', poor: 'verdict-skip' };
export function showVerdict(el, verdict, { reason = true } = {}) {
  const sign = VERDICT_ICON[verdict.grade];
  el.innerHTML = sign ? icon(sign, { size: 14 }) : '';
  el.append(reason ? verdict.label : verdict.word);
  el.dataset.grade = verdict.grade ?? 'none';
  const note = verdictNote(verdict);
  if (note) el.title = `${verdict.label}: ${note}`;
  else el.removeAttribute('title');
}

/** The verdict for a row of the chosen day: its forecast, or why there is none (also for no row). */
export function dayVerdict(row) {
  const missing = !forecastReach(dateInput.value).ok ? 'No forecast yet' : app.weather === null && app.weatherFailed ? 'No forecast' : 'Forecast loading';
  if (!row) return verdict(null, missing);
  return shotVerdict(app.weather, dayStart(), row.t, { body: row.body, distanceM: row.distanceM, now: Date.now(), missing });
}

/** The mark of a row (marks.js): `tower-sun`, `henge-sun`, `tower-moon` or `henge-moon`. */
export const markKind = (row) => `${row.kind === 'tower' ? 'tower' : 'henge'}-${row.body}`;
