/**
 * Plan mode: the panel opens on the coming three days' shots as cards — each a real moment,
 * ranked by weather and spectacle — instead of the camera tools. A tap on a card flies there
 * and flips to the tools (shoot mode), already set to that minute. Shoot mode is the panel as
 * it always was, reached by the same toggle or a card.
 */
import { streetMoments } from '../lib/streets.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { formatClock } from './time.js';
import { params } from './config.js';
import { cloudsAt, cloudsFor, visibilityAt } from './weather.js';
import { layers } from './chrome.js';
import { dateDayStart, dateInput, dayStart, setDay } from './clock.js';
import { bodyIcon, collectRows, renderDayList, setSheet } from './daylist.js';
import { computeDayPaths, getViewshed } from './plan.js';
import { app, invalidate } from './state.js';

const panel = document.getElementById('plancards');
const planHead = document.getElementById('plan-head');
const modeToggle = document.getElementById('mode-toggle');
const sheetToggle = document.getElementById('sheet-toggle');
const DAYS = 3;
const PER_DAY = 3;
const GRADE_WEIGHT = { good: 1.25, fair: 1, poor: 0.55 };

/** The days the plan speaks of, in the city's time: real today, not the day being explored. */
const svDate = (from) => new Date(from).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const realToday = () => dateDayStart(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }));

/** The panel's two modes; the body attribute drives what the stylesheet shows. */
export function setPanelMode(mode) {
  document.body.dataset.mode = mode;
  modeToggle.textContent = mode === 'plan' ? 'Advanced ›' : '‹ Shots';
  modeToggle.setAttribute('aria-label', mode === 'plan' ? 'Advanced — the camera tools' : 'Shots — back to the coming days');
  // The handle expands whatever the mode's list is.
  sheetToggle.setAttribute('aria-controls', mode === 'plan' ? 'plancards' : 'daylist');
  if (mode === 'plan') {
    setSheet(true);
    renderPlanCards();
  } else {
    renderDayList();
  }
}
modeToggle.addEventListener('click', () => setPanelMode(document.body.dataset.mode === 'plan' ? 'shoot' : 'plan'));

for (const chip of planHead.querySelectorAll('[data-filter]')) {
  chip.addEventListener('click', () => {
    app.planFilter = chip.dataset.filter;
    renderPlanCards();
  });
}

// A link that names a spot or a look is someone arriving for a shot: the tools, not the
// cards. On a timeout, so the first paint (and the city fetches) are not stuck behind the
// three days of alignment math.
setTimeout(() => setPanelMode(params.get('at') || params.get('look') ? 'shoot' : 'plan'), 0);

/** The day's clouds and sight at an instant, as a grade for the card's dot. */
function gradeAt(day, from, t) {
  if (!day) return null;
  const minutes = (t - from) / 60_000;
  const c = cloudsAt(day, minutes);
  const cover = Math.max(c.low, c.mid, c.high);
  const vis = visibilityAt(day, minutes);
  if (cover > 0.75 || vis < 3000) return 'poor';
  if (cover > 0.5 || vis < 9000) return 'fair';
  return 'good';
}

/** The same reading as a short note, in the weather line's words. */
function noteAt(day, from, t) {
  if (!day) return '';
  const minutes = (t - from) / 60_000;
  const c = cloudsAt(day, minutes);
  const cover = Math.round(100 * Math.max(c.low, c.mid, c.high));
  const vis = visibilityAt(day, minutes);
  const view = vis < 20_000 ? ` · ${(Math.round(vis / 100) / 10).toFixed(1).replace(/\.0$/, '')} km view` : '';
  return ` · ${cover < 10 ? 'clear sky' : `${cover}% cloud${c.low > 0.6 ? ', low' : ''}`}${view}`;
}

/** Cloud forecasts by day, resolved once and kept; a late arrival redraws the cards, and a
 * failed one is forgotten, so the next redraw tries again. */
const forecasts = new Map();
function forecastFor(from) {
  const date = svDate(from);
  if (!forecasts.has(date)) {
    forecasts.set(date, null);
    cloudsFor(date, from).then((day) => {
      if (day) forecasts.set(date, day);
      else forecasts.delete(date);
      renderPlanCards();
    });
  }
  return forecasts.get(date);
}

/** The collected rows of one day, kept per day and data state so a redraw only re-grades. */
const rowsMemo = new Map();
function rowsFor(from, now) {
  const shed = getViewshed();
  const key = [
    svDate(from),
    shed ? 'shed' : 'raw',
    app.views.length,
    layers.tower ? 1 : 0,
    layers.streets ? 1 : 0,
    layers.sun ? 1 : 0,
    layers.moon ? 1 : 0,
  ].join('|');
  if (!rowsMemo.has(key)) {
    const views = app.views ?? [];
    const to = from + 86_400_000;
    // The selected day's paths are already built for the map; only the other days need solving.
    const paths = from === dayStart() && app.dayPaths.length ? app.dayPaths : computeDayPaths(from, shed);
    const moments = [
      ...streetMoments(views, 'sun', from, to, FERNSEHTURM.lat, FERNSEHTURM.lon),
      ...streetMoments(views, 'moon', from, to, FERNSEHTURM.lat, FERNSEHTURM.lon),
    ];
    rowsMemo.set(key, collectRows(paths, moments, from, { tower: layers.tower, streets: layers.streets, moon: layers.moon }));
    // Keep the memo from growing across day changes and layer flips.
    if (rowsMemo.size > 8) rowsMemo.delete(rowsMemo.keys().next().value);
  }
  const rows = rowsMemo.get(key);
  return now === null ? rows : rows.filter((row) => row.t > now);
}

const dayName = (from, i) =>
  i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(from).toLocaleDateString('en-GB', { timeZone: 'Europe/Berlin', weekday: 'long' });

/** The cards: three days, each its best few moments, the best weather and the biggest
 * spectacle first. */
export function renderPlanCards() {
  if (document.body.dataset.mode !== 'plan') return;
  const now = Date.now();
  const base = realToday();
  const filter = app.planFilter ?? 'all';
  for (const chip of planHead.querySelectorAll('[data-filter]')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.filter === filter));
  }
  const blocks = [];
  let total = 0;
  for (let i = 0; i < DAYS; i++) {
    const from = base + i * 86_400_000;
    const rows = rowsFor(from, i === 0 ? now : null).filter((row) => filter === 'all' || row.body === filter);
    if (!rows.length) continue;
    const day = forecastFor(from);
    const picks = rows
      .map((row) => ({ ...row, grade: gradeAt(day, from, row.t) }))
      .sort((a, b) => GRADE_WEIGHT[b.grade ?? 'fair'] * b.score - GRADE_WEIGHT[a.grade ?? 'fair'] * a.score)
      .slice(0, PER_DAY);
    total += picks.length;
    blocks.push({ from, i, picks, day });
  }
  sheetToggle.querySelector('span').textContent = total
    ? `${total} shot${total === 1 ? '' : 's'} in the next ${DAYS === 3 ? 'three days' : `${DAYS} days`}`
    : 'No shots in the next three days';
  if (!blocks.length) {
    const why = filter === 'all' ? 'Nothing lines up' : `No ${filter === 'sun' ? 'sun' : 'moon'} shots line up`;
    panel.replaceChildren(
      Object.assign(document.createElement('p'), { className: 'muted', textContent: `${why} in the next three days. Try another day.` }),
    );
    return;
  }
  panel.replaceChildren(
    ...blocks.flatMap(({ from, i, picks, day }) => [
      Object.assign(document.createElement('div'), { className: 'plan-day', textContent: dayName(from, i) }),
      ...picks.map((row) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'dayrow planrow';
        item.dataset.body = row.body;
        item.innerHTML = `${bodyIcon(row.body, row.t)}<span><b></b><small></small></span><i class="grade"${row.grade ? ` data-grade="${row.grade}"` : ''} title="${row.grade ?? 'waiting for the forecast'}"></i>`;
        item.querySelector('b').textContent = row.title;
        item.querySelector('small').textContent = row.detail + noteAt(day, from, row.t);
        item.addEventListener('click', () => {
          // The flight presets the slider to the shot's minute, on the shot's day: bring the
          // day along first, or setMinute clamps a Tomorrow shot into tonight.
          if (svDate(from) !== dateInput.value) setDay(svDate(from));
          setPanelMode('shoot');
          row.go();
          modeToggle.focus({ preventScroll: true });
          invalidate();
        });
        return item;
      }),
    ]),
  );
}
