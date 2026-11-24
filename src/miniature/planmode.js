/**
 * Planning: the coming three days' shots as cards, each a real moment, ranked by weather and
 * spectacle. A tap on a card flies there, already set to that minute. The same three days
 * give the panel its one line, the next shot (peek.js). The panel's other list, "This day",
 * is daylist.js; the tabs above them switch `data-mode` between plan and shoot.
 */
import { streetMoments } from '../lib/streets.ts';
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { phaseName } from '../lib/moonPhase.ts';
import { getMoonIllumination, getMoonTimes } from 'suncalc';
import { formatClock } from './time.js';
import { params } from './config.js';
import { cloudsAt, cloudsFor, forecastReach, visibilityAt } from './weather.js';
import { shotVerdict } from './verdict.js';
import { layers } from './chrome.js';
import { dateDayStart, dateInput, dayStart, setDay, setMinute } from './clock.js';
import { shotPicture } from './shotPicture.js';
import { icon, iconEl } from './icons.js';
import { moonSvg } from './bodies.js';
import { collectRows, renderDayList, showVerdict } from './daylist.js';
import { computeDayPaths, getViewshed } from './plan.js';
import { renderPeek } from './peek.js';
import { onPeek } from './sheet.js';
import { renderSparkstrip } from './sparkstrip.js';
import { app, invalidate } from './state.js';

const panel = document.getElementById('plancards');
const strip = document.getElementById('sparkstrip');
const planHead = document.getElementById('plan-head');
const tabs = document.querySelectorAll('.tabs [data-mode]');
const DAYS = 3;
const PER_DAY = 3;
const GRADE_WEIGHT = { good: 1.25, fair: 1, poor: 0.55 };

/** The days the plan speaks of, in the city's time: real today, not the day being explored. */
const svDate = (from) => new Date(from).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const realToday = () => dateDayStart(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }));

const moonDisc = document.getElementById('moon-head-disc');
const moonText = document.getElementById('moon-head-text');
let moonHeadDate = '';
/** The header's moon: today's phase as a little disc, and when it rises and sets tonight —
 * the plan's moon cards mean most when the moon is up and more than a sliver. */
function renderMoonHead() {
  const from = realToday();
  const sv = svDate(from);
  if (sv === moonHeadDate) return;
  moonHeadDate = sv;
  const mid = new Date(from + 43_200_000);
  const moon = getMoonIllumination(mid);
  // Tonight's moon, as it stands high in a dark sky: the phase is what this line is about.
  moonDisc.innerHTML = moonSvg({ fraction: moon.fraction, waxing: moon.waxing ?? moon.phase < 0.5, altitudeDeg: 40, sunAltitudeDeg: -18, size: 18, glow: false });
  const times = getMoonTimes(mid, FERNSEHTURM.lat, FERNSEHTURM.lon);
  const rise = times.rise ? formatClock(times.rise.getTime()) : '';
  const set = times.set ? formatClock(times.set.getTime()) : '';
  const phase = `${phaseName(moon.fraction, moon.waxing)} ${Math.round(moon.fraction * 100)}%`;
  // Rise and set as the set's two signs, with the words for a screen reader.
  moonText.replaceChildren(phase);
  if (rise) moonText.append(' · ', iconEl('rise', { size: 14, label: 'rises' }), rise);
  if (set) moonText.append(' · ', iconEl('set', { size: 14, label: 'sets' }), set);
  if (!rise && !set) moonText.append(` · ${sampleMoonUp(mid) ? 'up all day' : 'down all day'}`);
  moonText.title = `${phase}${rise ? `, rises ${rise}` : ''}${set ? `, sets ${set}` : ''}`;
}
/** Whether the moon stands above the horizon at midday. */
function sampleMoonUp(when) {
  return sampleBody('moon', when, FERNSEHTURM.lat, FERNSEHTURM.lon).alt > 0;
}

/**
 * Which of the panel's two views is up: the coming three days (plan: the overview strips and
 * the best shots of each day) or this day (shoot: the day view with its timeline, and every
 * shot of the day). One timeline at a time.
 */
export function setPanelMode(mode) {
  document.body.dataset.mode = mode;
  for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.mode === mode));
  if (mode === 'plan') renderPlanCards();
  else renderDayList();
}
for (const tab of tabs) tab.addEventListener('click', () => setPanelMode(tab.dataset.mode));

for (const chip of planHead.querySelectorAll('[data-filter]')) {
  chip.addEventListener('click', () => {
    app.planFilter = chip.dataset.filter;
    renderPlanCards();
  });
}

// A link that names a spot or a look is someone arriving for a shot: that day's list, not
// the coming days. On a timeout, so the first paint (and the city fetches) are not stuck
// behind the three days of alignment math.
setTimeout(() => setPanelMode(params.get('at') || params.get('look') ? 'shoot' : 'plan'), 0);

// The afternoon moves under an open panel: today's now-marker drifts and shots pass, so
// re-grade on a slow beat, and keep the countdown honest in between.
setInterval(renderPlanCards, 5 * 60_000);
setInterval(showPeek, 30_000);
// Standing in the street the plan is out of sight and waits; back on the map it catches up.
new MutationObserver(() => {
  if (document.body.dataset.eye !== 'true') renderPlanCards();
}).observe(document.body, { attributes: true, attributeFilter: ['data-eye'] });

/** The next shot of the three days, kept so the countdown can tick without the maths. */
let next = null;
let nextSentence = undefined;
function showPeek() {
  const now = Date.now();
  if (next && next.row.t <= now) return renderPlanCards();
  renderPeek(next, now, nextSentence);
}
// On a wide screen the line is a heading: a click shows that shot's day and minute.
onPeek(() => {
  if (!next) return;
  if (svDate(next.from) !== dateInput.value) setDay(svDate(next.from));
  setPanelMode('shoot');
  setMinute(next.row.t);
  invalidate();
});

/** The day's sky at an instant as a verdict in words; without a forecast, which kind of none. */
function verdictAt(day, from, row) {
  const date = svDate(from);
  const missing = !forecastReach(date).ok ? 'No forecast yet' : retryAfter.has(date) ? 'No forecast' : 'Forecast loading';
  return shotVerdict(day, from, row.t, { body: row.body, distanceM: row.distanceM, missing });
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

/** Cloud forecasts by day, resolved once and kept; a late arrival redraws the cards. A failed
 * one is not asked for again for a minute and redraws nothing: a redraw would ask again at
 * once, and with the forecast service down that went round as fast as the network answered. */
const forecasts = new Map();
const retryAfter = new Map();
const RETRY_MS = 60_000;
function forecastFor(from) {
  const date = svDate(from);
  if (!forecasts.has(date) && (retryAfter.get(date) ?? 0) <= Date.now()) {
    forecasts.set(date, null);
    cloudsFor(date, from).then((day) => {
      if (day) {
        forecasts.set(date, day);
        renderPlanCards();
      } else {
        forecasts.delete(date);
        retryAfter.set(date, Date.now() + RETRY_MS);
      }
    });
  }
  return forecasts.get(date) ?? null;
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

const weekday = (from) => new Date(from).toLocaleDateString('en-GB', { timeZone: 'Europe/Berlin', weekday: 'short' });
const dayName = (from, i) =>
  i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(from).toLocaleDateString('en-GB', { timeZone: 'Europe/Berlin', weekday: 'long' });

/** The cards: three days, each its best few moments, the best weather and the biggest
 * spectacle first. */
export function renderPlanCards() {
  // Not before the city's streets and the day's paths are in (three days of alignment maths
  // would run twice), and not while standing in the street, where the plan is out of sight.
  if (!app.dayReady || document.body.dataset.eye === 'true') return;
  const now = Date.now();
  const base = realToday();
  renderMoonHead();
  const filter = app.planFilter ?? 'all';
  for (const chip of planHead.querySelectorAll('[data-filter]')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.filter === filter));
  }
  const blocks = [];
  let total = 0;
  for (let i = 0; i < DAYS; i++) {
    const from = base + i * 86_400_000;
    const rows = rowsFor(from, i === 0 ? now : null).filter((row) => filter === 'all' || row.body === filter);
    const day = forecastFor(from);
    // A poor sky is not a shot: over 75% cloud or grey soup hides the disc entirely. The
    // strip still shows those days — light and cloud are exactly what a covered week is for
    // glancing at — but they earn no cards and no ticks.
    const picks = rows
      .map((row) => {
        const verdict = verdictAt(day, from, row);
        return { ...row, verdict, grade: verdict.grade };
      })
      .filter((row) => row.grade !== 'poor')
      .sort((a, b) => GRADE_WEIGHT[b.grade ?? 'fair'] * b.score - GRADE_WEIGHT[a.grade ?? 'fair'] * a.score)
      .slice(0, PER_DAY);
    total += picks.length;
    blocks.push({ from, i, picks, day, rows: rows.length, name: dayName(from, i), now: i === 0 ? now : null, cards: picks.length > 0 });
  }
  // The one line: the earliest of the picks, whichever day it falls on.
  const first = blocks.flatMap((block) => block.picks.map((row) => ({ row, from: block.from, verdict: row.verdict, day: block.i === 0 ? '' : block.name, dayShort: block.i === 0 ? '' : weekday(block.from) }))).sort((a, b) => a.row.t - b.row.t)[0];
  next = first ?? null;
  nextSentence = blocks.some((block) => block.rows > 0)
    ? 'Skip the next three days: too much cloud for a shot'
    : 'Nothing lines up in the next three days';
  renderPeek(next, now, nextSentence);
  if (document.body.dataset.mode !== 'plan') return;
  const flyTo = (row, from) => {
    // The flight presets the slider to the shot's minute, on the shot's day: bring the day
    // along first, or setMinute clamps a Tomorrow shot into tonight.
    if (svDate(from) !== dateInput.value) setDay(svDate(from));
    setPanelMode('shoot');
    row.go();
    invalidate();
  };
  const stripHandlers = {
    onTick: flyTo,
    // A day's name opens that day: its own light, weather and shots, on the day view.
    onDay: (from) => {
      if (svDate(from) !== dateInput.value) setDay(svDate(from));
      setPanelMode('shoot');
      invalidate();
    },
  };
  // The strip keeps its three days even when nothing is shootable: the light and the cloud
  // are the answer to "when, then?".
  renderSparkstrip(strip, blocks, stripHandlers);
  if (!total) {
    // Two different nothings: the geometry has none, or the cloud hides what there is.
    const what = filter === 'all' ? 'shots' : `${filter} shots`;
    const cloudy = blocks.some((block) => block.rows > 0);
    const text = cloudy
      ? `Skip: too much cloud for the ${blocks.reduce((sum, block) => sum + block.rows, 0)} ${what} that line up in the next three days. Open a day above to see them.`
      : `No ${what} line up in the next three days. Try another day.`;
    panel.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: text }));
    return;
  }
  panel.replaceChildren(
    ...blocks
      .filter((block) => block.cards)
      .flatMap(({ from, i, picks, day, name }) => {
      const heading = Object.assign(document.createElement('div'), { className: 'plan-day', textContent: name });
      heading.dataset.date = svDate(from);
      return [
        heading,
      ...picks.map((row) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'dayrow planrow';
        item.dataset.body = row.body;
        item.innerHTML = `${shotPicture(row, { size: 28 })}<span><b></b><em class="verdict"></em><small></small></span>${icon('chevron-right', { size: 16, className: 'chev' })}`;
        item.querySelector('b').textContent = row.title;
        showVerdict(item.querySelector('.verdict'), row.verdict);
        item.querySelector('small').textContent = row.detail + noteAt(day, from, row.t);
        item.addEventListener('click', () => flyTo(row, from));
        return item;
      }),
      ];
    }),
  );
}
