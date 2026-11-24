/** The day as a list in the panel's planning: tower alignments and street henges, each a tap away. */
import { shotCard } from './shotCard.js';
import { collectRows as collectShots } from './dayShots.js';
import { icon } from './icons.js';
import { layers, showAllShots, switchedOff } from './chrome.js';
import { dayStart } from './clock.js';
import { cloudNote } from './forecast.js';
import { forecastReach } from './weather.js';
import { shotVerdict, verdict, verdictNote } from './verdict.js';
import { dateInput } from './clock.js';
import { FIGURE_TARGETS } from '../lib/landmarkStands.ts';
import { landmarkPassesFor, landmarkShedCount, toScene } from './plan.js';
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
  // The Siegessäule's and the Brandenburger Tor's rows come with every list (plan.js keeps
  // each day's passes); the Landmarks switch is theirs.
  const rows = collectShots(
    dayPaths.map((path) => path.source ?? path),
    moments,
    from,
    { ...flags, sun: layers.sun !== false, moon: flags.moon !== false && layers.moon !== false, landmarks: layers.landmarks !== false },
    landmarkPassesFor(from),
  );
  for (const row of rows) row.go = () => goViewHere(flightTo(row));
  return rows;
}

/** Where `goViewHere` starts its search for a clear view of a row's shot, in the scene. */
function flightTo(row) {
  if (row.kind === 'street') return { kind: 'street', body: row.body, t: row.t, x: row.moment.view.a[0], z: row.moment.view.a[1], moment: row.moment };
  if (row.target) {
    // Behind a figure on the Siegessäule or the Brandenburger Tor: the one spot it lines up
    // from at that minute, and the landmark's axis, which the sight line is checked up to.
    const landmark = FIGURE_TARGETS.find((target) => target.id === row.target).landmark;
    return { kind: 'landmark', body: row.body, t: row.t, ...toScene({ lat: row.at[0], lon: row.at[1] }), axis: toScene(landmark), lens: row.lens };
  }
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
  const key = [dayStart(), layers.tower, layers.streets, layers.sun, layers.moon, layers.landmarks, landmarkShedCount()].join('|');
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
/** Put a shot's card on the ticket, without going anywhere: the view is already its own. */
export function showTicket(row, verdict) {
  ticketRow = row;
  // For the status line and the caption, which speak of the open shot's landmark (landmarkView.js).
  app.ticketShot = row;
  ticketShot.replaceChildren(shotCard(row, verdict, { size: 'ticket', tag: 'div' }));
  ticketShot.hidden = false;
}
export function openShot(row, verdict) {
  showTicket(row, verdict);
  row.go();
  invalidate();
}
/** A tap on a landmark's stand point on the map (plan.js, pointer.js) opens that row's shot. */
app.openLandmarkSpot = (spot) => {
  const row = currentRows().find((r) => r.target === spot.target && r.body === spot.body && r.t === spot.t);
  if (row) openShot(row, dayVerdict(row));
};
/** The shot on the ticket, or null: what the address, the calendar entry and a shared link name. */
export const ticketShotRow = () => (ticketShot.hidden ? null : ticketRow);
/** The ticket's card again, once the day's forecast is in: a shot opened from a link arrives before it. */
function refreshTicket() {
  if (ticketRow && !ticketShot.hidden) ticketShot.replaceChildren(shotCard(ticketRow, ticketVerdict(ticketRow), { size: 'ticket', tag: 'div' }));
}
/**
 * The verdict the ticket shows for a shot. A shot of the year from this spot (fromHere.js) has
 * none beyond the forecast's reach, on the ticket as in its list: nothing rather than "No
 * forecast yet" a year ahead. The day's own shots say which kind of none it is, as their list does.
 */
export const ticketVerdict = (row) => (row?.fromHere && !forecastReach(dateInput.value).ok ? null : dayVerdict(row));
// Back on the map the ticket's card goes: the next visit to eye level may be for no shot at all.
new MutationObserver(() => {
  if (document.body.dataset.eye === 'true') return;
  ticketRow = null;
  app.ticketShot = null;
  ticketShot.hidden = true;
  ticketShot.replaceChildren();
}).observe(document.body, { attributes: true, attributeFilter: ['data-eye'] });

/**
 * Why a list shows no shots, as a paragraph: with any of the four switches off it is the
 * switches that are named, not the day, with a button that shows all again (adversarial test
 * 2026-11, finding 8: switches kept from an earlier visit made the app say nothing lines up).
 */
export function emptyNote(nothing = 'Nothing lines up on this day. Try another.') {
  const note = Object.assign(document.createElement('p'), { className: 'muted' });
  const off = switchedOff();
  if (!off) {
    note.textContent = nothing;
    return note;
  }
  note.textContent = `No shots to show with ${off} switched off. `;
  const all = Object.assign(document.createElement('button'), { type: 'button', className: 'pill', textContent: 'Show all shots' });
  all.addEventListener('click', showAllShots);
  note.append(all);
  return note;
}

/** The day as a list in planning: the same rows, in time order, each a tap from standing there. */
export function renderDayList() {
  const rows = currentRows();
  refreshTicket();
  dayList.replaceChildren(...rows.map((row) => shotRow({ ...row, detail: row.detail + cloudNote(row.t) }, dayVerdict(row), () => openShot(row, dayVerdict(row)))));
  if (!rows.length) dayList.replaceChildren(emptyNote());
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
  return shotVerdict(app.weather, dayStart(), row.t, { body: row.body, distanceM: row.distanceM, now: Date.now(), until: row.until, missing });
}

/** The mark of a row (marks.js): `tower-sun`, `henge-sun`, `tower-moon` or `henge-moon`. */
export const markKind = (row) => `${row.kind === 'tower' ? 'tower' : 'henge'}-${row.body}`;
