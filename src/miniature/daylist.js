/** The day as a list in the expanded sheet: tower alignments and street henges, each with Go. */
import * as THREE from 'three';
import { getMoonIllumination } from 'suncalc';
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { compassPoint } from '../lib/dailyPaths.ts';
import { litDiscPath } from '../lib/moonPhase.ts';
import { formatClock } from './time.js';
import { EYE_HEIGHT } from './eye.js';
import { discOverSphere, SPHERE_TOP_AGL, TIP_AGL } from './towerShots.js';
import { layers, shownBody } from './chrome.js';
import { dayStart } from './clock.js';
import { BODY_NAME } from './eclipse.js';
import { cloudNote } from './forecast.js';
import { toScene } from './plan.js';
import { goViewHere } from './pointer.js';
import { app, invalidate } from './state.js';

const dayList = document.getElementById('daylist');
const sheetToggle = document.getElementById('sheet-toggle');
const distanceText = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

/** Every chance of the day, in time order: tower alignments and street henges. */
export function renderDayList() {
  const rows = [];
  if (layers.tower) {
    for (const path of app.dayPaths.filter(shownBody)) {
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
        rows.push({
          t: first.t,
          body: path.body,
          kind: 'tower',
          title:
            path.body === 'moon'
              ? `Big moon behind the TV tower, ${discOverSphere(mid.distanceM).toFixed(1)}\u00d7 the sphere`
              : discOverSphere(mid.distanceM) > 1
                ? 'Ring of sun round the TV tower\u2019s sphere'
                : 'Sun behind the TV tower\u2019s sphere',
          detail: `${formatClock(first.t)}\u2013${formatClock(lastPoint.t)}${w.broken ? ' (with breaks)' : ''} \u00b7 ${distanceText(mid.distanceM)} ${compassPoint(mid.bearingDeg)} of the tower \u00b7 ${Math.round(mid.bodyAlt)}\u00b0 up`,
          go: () => goViewHere({ kind: 'tower', body: path.body, t: mid.t, ...toScene(mid) }),
        });
      }
    }
  }
  // Moonrise and moonset behind the antenna: the moon low, more than half lit, and visible
  // round the thin mast from a few kilometres out.
  if (layers.tower && layers.moon) {
    const from = dayStart();
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
  if (layers.streets) {
    const seen = new Set();
    // The longest views are the ones worth a trip; the rest still show on the map and slider.
    for (const m of [...app.moments].filter(shownBody).sort((a, b) => b.view.lengthM - a.view.lengthM)) {
      const key = `${m.view.name}${m.body}`;
      if (seen.has(key) || seen.size >= 12) continue;
      seen.add(key);
      rows.push({
        t: m.peak,
        body: m.body,
        kind: 'street',
        title: `${m.view.name}`,
        detail: `${formatClock(m.peak)} \u00b7 street henge: the ${BODY_NAME[m.body].toLowerCase()} down the street \u00b7 ${distanceText(m.view.lengthM)} long \u00b7 ${Math.round(m.bodyAlt)}\u00b0 up`,
        go: () => goViewHere({ kind: 'street', body: m.body, t: m.peak, x: m.view.a[0], z: m.view.a[1], moment: m }),
      });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  dayList.replaceChildren(
    ...rows.map((row) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'dayrow';
      item.dataset.body = row.body;
      item.dataset.kind = row.kind;
      item.innerHTML = `${bodyIcon(row.body, row.t)}<span><b></b><small></small></span><em>Go \u203a</em>`;
      item.querySelector('b').textContent = row.title;
      item.querySelector('small').textContent = row.detail + cloudNote(row.t);
      item.addEventListener('click', () => {
        row.go();
        setSheet(false);
        invalidate();
      });
      return item;
    }),
  );
  if (!rows.length) dayList.innerHTML = '<p class="muted">Nothing lines up today. Try another day.</p>';
  sheetToggle.querySelector('span').textContent = `${rows.length} chance${rows.length === 1 ? '' : 's'} today`;
}

/** A small sun, or the moon in its phase at that time, for the list. */
function bodyIcon(body, t) {
  if (body === 'sun') return '<svg class="disc" viewBox="-1 -1 2 2" aria-hidden="true"><circle r="0.92" fill="#f8a03a"/><circle r="0.62" fill="#ffd27a"/></svg>';
  const moon = getMoonIllumination(new Date(t));
  return `<svg class="disc" viewBox="-1 -1 2 2" aria-hidden="true"><circle r="0.92" fill="#2a3150"/><path d="${litDiscPath(moon.fraction, moon.waxing ?? moon.phase < 0.5)}" transform="scale(0.92)" fill="#e8ecff"/><circle r="0.92" fill="none" stroke="#5b82ff" stroke-width="0.12"/></svg>`;
}

function setSheet(open) {
  document.body.dataset.sheet = open ? 'open' : 'closed';
  sheetToggle.setAttribute('aria-expanded', String(open));
}
sheetToggle.addEventListener('click', () => setSheet(document.body.dataset.sheet !== 'open'));
