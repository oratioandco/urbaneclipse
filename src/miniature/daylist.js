/** The day as a list in the panel's planning: tower alignments and street henges, each a tap away. */
import { shotCard } from './shotCard.js';
import { collectRows as collectShots } from './dayShots.js';
import { icon } from './icons.js';
import { layers, shownBody } from './chrome.js';
import { dayStart } from './clock.js';
import { cloudNote } from './forecast.js';
import { forecastReach } from './weather.js';
import { shotVerdict, verdict, verdictNote } from './verdict.js';
import { dateInput } from './clock.js';
import { toScene } from './plan.js';
import { goViewHere } from './pointer.js';
import { app, invalidate } from './state.js';

const dayList = document.getElementById('daylist');

/**
 * Every chance of a day, in time order, as the planner uses them: the rows of dayShots.js
 * (shared with the home page), filtered by the layer switches, each with `go`, which flies to
 * where to stand for it. `dayPaths` are the planner's (plan.js), `moments` the day's street
 * moments, `from` the day's start; `flags` carry the tower, streets and moon switches.
 */
export function collectRows(dayPaths, moments, from, flags = {}) {
  const rows = collectShots(dayPaths.map((path) => path.source ?? path), moments, from, { ...flags, sun: layers.sun !== false, moon: flags.moon !== false && layers.moon !== false });
  for (const row of rows) row.go = () => goViewHere(flightTo(row));
  return rows;
}

/** Where `goViewHere` starts its search for a clear view of a row's shot, in the scene. */
function flightTo(row) {
  if (row.kind === 'street') return { kind: 'street', body: row.body, t: row.t, x: row.moment.view.a[0], z: row.moment.view.a[1], moment: row.moment };
  if (row.where === 'antenna') {
    // The middle of the antenna stretch; the search finds a clear view near it.
    const a = (row.standBearingDeg * Math.PI) / 180;
    return { kind: 'tower', body: 'moon', t: row.openAt, x: Math.sin(a) * row.standDistanceM, z: -Math.cos(a) * row.standDistanceM, lens: row.lens };
  }
  return { kind: 'tower', body: row.body, t: row.t, ...toScene({ lat: row.at[0], lon: row.at[1] }) };
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

/** A list row: the shot card at its row size, with the chevron that says it opens. */
export function shotRow(shot, verdict, onClick) {
  const item = shotCard(shot, verdict, { size: 'row' });
  item.insertAdjacentHTML('beforeend', icon('chevron-right', { size: 16, className: 'chev' }));
  item.addEventListener('click', onClick);
  return item;
}

// At eye level the ticket shows the card of the shot that was opened, at its smallest.
const ticketShot = document.getElementById('ticket-shot');
/** Open a shot: fly to where to stand for it, at its minute, and put its card on the ticket. */
let ticketRow = null;
export function openShot(row, verdict) {
  ticketRow = row;
  ticketShot.replaceChildren(shotCard(row, verdict, { size: 'ticket', tag: 'div' }));
  ticketShot.hidden = false;
  row.go();
  invalidate();
}
/** The ticket's card again, once the day's forecast is in: a shot opened from a link arrives before it. */
function refreshTicket() {
  if (ticketRow && !ticketShot.hidden) ticketShot.replaceChildren(shotCard(ticketRow, dayVerdict(ticketRow), { size: 'ticket', tag: 'div' }));
}
// Back on the map the ticket's card goes: the next visit to eye level may be for no shot at all.
new MutationObserver(() => {
  if (document.body.dataset.eye === 'true') return;
  ticketRow = null;
  ticketShot.hidden = true;
  ticketShot.replaceChildren();
}).observe(document.body, { attributes: true, attributeFilter: ['data-eye'] });

/** Why a day shows no shots: the filters hide them all, or nothing lines up. */
export const emptyDay = () => (!layers.tower && !layers.streets ? 'Tower and street shots are both switched off. Switch one on under \u201cThis day\u201d.' : !layers.sun && !layers.moon ? 'Sun and moon are both switched off. Switch one on under \u201cThis day\u201d.' : 'Nothing lines up on this day. Try another.');

/** The day as a list in planning: the same rows, in time order, each a tap from standing there. */
export function renderDayList() {
  const rows = currentRows();
  refreshTicket();
  dayList.replaceChildren(...rows.map((row) => shotRow({ ...row, detail: row.detail + cloudNote(row.t) }, dayVerdict(row), () => openShot(row, dayVerdict(row)))));
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
