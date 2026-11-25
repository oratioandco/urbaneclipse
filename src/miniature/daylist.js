/** The day as a list in the panel's planning: tower alignments and street henges, each a tap away. */
import { shotCard } from './shotCard.js';
import { moreStreets } from './spectacle.js';
import { collectRows as collectShots, coveredBy, shotStillHeld, towerSeenFrom, treesSeenFrom } from './dayShots.js';
import { icon } from './icons.js';
import { layers, showAllShots, switchedOff } from './chrome.js';
import { dayStart, instant } from './clock.js';
import { look } from './eyeLevel.js';
import { cloudNote } from './forecast.js';
import { forecastReach } from './weather.js';
import { shotVerdict, verdict, verdictNote } from './verdict.js';
import { dateInput } from './clock.js';
import { FIGURE_TARGETS } from '../lib/landmarkStands.ts';
import { getViewshed, landmarkPassesFor, landmarkShedCount, toScene } from './plan.js';
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
    { ...flags, sun: layers.sun !== false, moon: flags.moon !== false && layers.moon !== false, landmarks: layers.landmarks !== false, seesTower: towerSeenFrom(getViewshed()), treesAt: treesSeenFrom(getViewshed()), covered: coveredBy(getViewshed()) },
    landmarkPassesFor(from),
  );
  // The row goes with its flight: the check on arrival is of the row's own shot (pointer.js).
  for (const row of rows) row.go = () => goViewHere({ ...flightTo(row), row });
  return rows;
}

/** Where `goViewHere` starts its search for a clear view of a row's shot, in the scene. */
function flightTo(row) {
  if (row.kind === 'street') return { kind: 'street', body: row.body, t: row.t, x: row.moment.view.a[0], z: row.moment.view.a[1], moment: row.moment };
  if (row.target) {
    // Behind a figure on the Siegessäule or the Brandenburger Tor: the one spot it lines up
    // from at that minute, and the landmark's axis, which the sight line is checked up to.
    const landmark = FIGURE_TARGETS.find((target) => target.id === row.target).landmark;
    return { kind: 'landmark', body: row.body, t: row.t, ...toScene({ lat: row.at[0], lon: row.at[1] }), axis: toScene(landmark), lens: row.lens, others: (row.alternates ?? []).map((p) => ({ ...toScene({ lat: p.at[0], lon: p.at[1] }), t: p.t })) };
  }
  if (row.where === 'antenna') {
    // The middle of the antenna stretch; the search finds a clear view near it.
    const a = (row.standBearingDeg * Math.PI) / 180;
    const at = (d) => ({ x: Math.sin(a) * d, z: -Math.cos(a) * d });
    return { kind: 'tower', body: 'moon', t: row.openAt, ...(row.at ? toScene({ lat: row.at[0], lon: row.at[1] }) : at(row.standDistanceM)), lens: row.lens, range: row.standRange, exact: true, others: (row.standOthers ?? []).map(([lat, lon]) => toScene({ lat, lon })) };
  }
  // The sphere: the row's spot at its minute, then the spots of other minutes of the same pass.
  return { kind: 'tower', body: row.body, t: row.t, ...toScene({ lat: row.at[0], lon: row.at[1] }), exact: true, others: (row.alternates ?? []).map((p) => ({ ...toScene({ lat: p.at[0], lon: p.at[1] }), t: p.t })) };
}

/** The chosen day's rows, collected once per day, data and layer state. */
let rowsMemo = { key: null, rows: [] };
export function currentRows() {
  const key = [dayStart(), layers.tower, layers.streets, layers.sun, layers.moon, layers.landmarks, landmarkShedCount(), Boolean(getViewshed())].join('|');
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
  ticketStood = null;
  ticketShot.replaceChildren(shotCard(row, verdict, { size: 'ticket', tag: 'div' }), ...otherStreets(row));
  ticketShot.hidden = false;
}
/**
 * Under the card of a henge that stands for others on parallel streets ("and 2 more streets",
 * spectacle.js `pickTop`): a button that lists them, each a tap from standing there.
 */
function otherStreets(row) {
  if (!row.others?.length) return [];
  const more = Object.assign(document.createElement('button'), { type: 'button', className: 'more-streets', textContent: moreStreets(row) });
  more.setAttribute('aria-expanded', 'false');
  const list = Object.assign(document.createElement('div'), { className: 'more-streets-list', hidden: true });
  more.addEventListener('click', () => {
    if (!list.childElementCount) {
      list.append(
        ...row.others.map((other) => {
          const item = shotCard(other, dayVerdict(other), { size: 'ticket', tag: 'button' });
          item.addEventListener('click', () => openShot(other, dayVerdict(other)));
          return item;
        }),
      );
    }
    list.hidden = !list.hidden;
    more.setAttribute('aria-expanded', String(!list.hidden));
  });
  return [more, list];
}
export function openShot(row, verdict) {
  showTicket(row, verdict);
  // Until the flight to the shot's spot has been set off, where one stands says nothing.
  ticketPending = true;
  Promise.resolve(row.go())
    .then((arrived) => {
      // No clear spot was found (pointer.js says so): the card of a shot one is not looking at goes.
      if (arrived === false && ticketRow === row) {
        ticketRow = null;
        app.ticketShot = null;
        ticketShot.hidden = true;
        ticketShot.replaceChildren();
      }
    })
    .finally(() => (ticketPending = false));
  invalidate();
}
/** Where one stood when the ticket's card went up; null until one stands there. */
let ticketStood = null;
let ticketPending = false;
/**
 * The ticket's card goes when the view is no longer its shot: walked away from the spot, or
 * the clock moved out of the shot's stretch (dayShots.js `shotStillHeld`). With it go the
 * shot's name in the address and in the calendar entry, which read the ticket. Before, one
 * could open the 8:33 shot, walk 130 m, set the clock to 9:03, and still share "8:33, Go".
 */
export function checkTicket() {
  if (!ticketRow || ticketShot.hidden || ticketPending || !look.active) return;
  if (!ticketStood) ticketStood = { x: look.x, z: look.z };
  if (shotStillHeld(ticketRow, ticketStood, look, instant().getTime())) return;
  ticketShot.hidden = true;
  ticketRow = null;
  app.ticketShot = null;
  ticketStood = null;
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

/**
 * Under a list that has rows but not all of them: which kinds are switched off, and the way
 * back. An empty list says so itself (`emptyNote`); a shortened one gave no hint.
 */
export function filterHint() {
  const off = switchedOff();
  if (!off) return [];
  const note = Object.assign(document.createElement('p'), { className: 'muted filter-hint', textContent: `${off} switched off: not every shot is listed. ` });
  const all = Object.assign(document.createElement('button'), { type: 'button', className: 'pill', textContent: 'Show all shots' });
  all.addEventListener('click', showAllShots);
  note.append(all);
  return [note];
}

/** The day as a list in planning: the same rows, in time order, each a tap from standing there. */
export function renderDayList() {
  const rows = currentRows();
  refreshTicket();
  dayList.replaceChildren(...rows.map((row) => shotRow({ ...row, detail: row.detail + cloudNote(row.t) }, dayVerdict(row), () => openShot(row, dayVerdict(row)))), ...filterHint());
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
