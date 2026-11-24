/**
 * "From here" at eye level: what the year's search from where you stand (dates.js) shows.
 * Shots from one spot are rare, a handful per landmark in a year, so there is no day-by-day
 * strip: the best few are shot cards, and under them the whole twelve months as a list by
 * month, every entry the one shot card (shotCard.js) with the frame drawn for its minute.
 *
 *   begin(groups, again)   a search has started: `[{ id, heading }]`, one per thing searched;
 *                          `again` starts it over
 *   progress(share)        how far the year's search is, 0 to 1
 *   result(id, found)      a group is done: `{ heading, shots, notes }` (shots as dates.js finds
 *                          them), or `{ heading, failed }` with why it could not be searched
 *
 * The order and the choice are fromHere.js's (pure, tested). The switches are the day list's
 * own four (chrome.js), a verdict is given in words and only within the forecast's reach, and
 * picking a shot does what its date did before (`go`: day, time, turn to face it) and puts
 * its card on the ticket, so the link and the calendar entry name it.
 */
import { asShot, byMonth, countWords, gatherNotes, highlights, rowWhen, shownShots, weekdayApart } from './fromHere.js';
import { shotCard } from './shotCard.js';
import { emptyNote, shotRow, showTicket } from './daylist.js';
import { layers, wireSwitches } from './chrome.js';
import { bodyIcon } from './bodyAt.js';
import { berlinDayStart } from './berlinClock.js';
import { berlinDate } from './dayMath.js';
import { icon } from './icons.js';
import { formatClock, formatDay } from './time.js';
import { shotVerdict } from './verdict.js';
import { cloudsFor, forecastReach } from './weather.js';
import { invalidate } from './state.js';

const list = document.getElementById('dates');
const body = Object.assign(document.createElement('div'), { className: 'fh-body' });
list.append(body);

/** The search under way or done: its groups by id, how far it is, and the shot last picked. */
let search = null;

const el = (tag, className, text = '') => Object.assign(document.createElement(tag), { className, textContent: text });
const keyOf = (shot) => `${shot.series}|${shot.t}`;
const pending = () => [...search.groups.values()].filter((g) => !g.done);
const allShots = () => [...search.groups.values()].flatMap((g) => g.shots);

/** A search has started: show that, and what is being looked for. */
export function begin(groups, again = null) {
  search = { groups: new Map(groups.map((g) => [g.id, { ...g, done: false, shots: [], notes: [] }])), again, share: 0, picked: null, verdicts: new Map() };
  list.querySelector('.dates-again')?.remove();
  list.scrollTop = 0;
  render();
}

/** How far the year's search is, 0 to 1. Only the bar moves. */
export function progress(share) {
  if (!search || !pending().length) return;
  search.share = Math.max(search.share, Math.min(1, share));
  const bar = body.querySelector('.fh-bar');
  if (!bar) return;
  bar.setAttribute('aria-valuenow', String(Math.round(search.share * 100)));
  bar.firstElementChild.style.width = `${(search.share * 100).toFixed(1)}%`;
}

/** A group's search is done: its dates as shots, and what there is to say when there are none. */
export function result(id, found) {
  const group = search?.groups.get(id);
  if (!group) return;
  Object.assign(group, { done: true, failed: found.failed ?? null, heading: found.heading ?? group.heading, notes: found.failed ? [`Could not search: ${found.failed}`] : (found.notes ?? []), shots: (found.shots ?? []).map((s) => asShot({ ...s, group: found.heading ?? group.heading })) });
  render();
  if (!pending().length) forecasts(search);
}

/**
 * The verdicts of the shots the forecast reaches, in the words and from the one grade of every
 * other list (verdict.js). Past its reach a shot has no verdict: none is shown rather than a guess.
 */
async function forecasts(mine) {
  const now = Date.now();
  const within = allShots().filter((s) => (s.until ?? s.t) >= now && forecastReach(berlinDate(s.t)).ok);
  if (!within.length) return;
  await Promise.all(
    within.map(async (shot) => {
      const day = berlinDate(shot.t);
      const start = berlinDayStart(day);
      const clouds = await cloudsFor(day, start).catch(() => null);
      if (clouds) mine.verdicts.set(shot, shotVerdict(clouds, start, shot.t, { body: shot.body, distanceM: shot.distanceM, now, until: shot.until }));
    }),
  );
  if (search === mine && mine.verdicts.size) render();
}

/** Pick a shot: its day and minute, turned to face it, and its card on the ticket. */
function pick(shot) {
  search.picked = keyOf(shot);
  shot.go();
  showTicket(shot, search.verdicts.get(shot) ?? null);
  for (const other of body.querySelectorAll('.shotcard')) other.toggleAttribute('aria-current', false);
  for (const mine of body.querySelectorAll(`.shotcard[data-key="${CSS.escape(search.picked)}"]`)) mine.setAttribute('aria-current', 'true');
  invalidate();
}

function mark(card, shot) {
  card.dataset.key = keyOf(shot);
  card.dataset.heading = shot.group;
  // The date in full, year and all: a row under its month's name shows it without (scripts read it here).
  card.dataset.when = shot.when ?? '';
  if (search.picked === card.dataset.key) card.setAttribute('aria-current', 'true');
  return card;
}

/** A card's width where there is room: three side by side in the desktop ticket, two and a bit on a phone. */
const CARD_PX = 132;

/** The row of cards fades at an edge that has more, as the day view's does. */
function showEdges(row) {
  row.dataset.before = String(row.scrollLeft > 2);
  row.dataset.after = String(row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
}

/** The best few, as cards side by side: all three where they fit, two and a bit on a phone. */
function best(shots) {
  const row = el('div', 'shots-row shotcards-dated fh-best');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'The best shots from here');
  for (const shot of shots) {
    const card = shotCard(shot, search.verdicts.get(shot) ?? null, { size: 'card', day: formatDay(shot.t) });
    card.addEventListener('click', () => pick(shot));
    row.append(mark(card, shot));
  }
  row.addEventListener('scroll', () => showEdges(row), { passive: true });
  requestAnimationFrame(() => {
    const width = row.clientWidth;
    if (!width) return;
    const gap = 6;
    row.style.setProperty('--card', `${Math.min(CARD_PX, (width - 2 * gap) / 2.35).toFixed(1)}px`);
    showEdges(row);
  });
  return row;
}

/** The five switches of the day list, the same buttons on the same state. */
function switches() {
  const group = el('div', 'shotfilter');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Show');
  group.innerHTML =
    '<button type="button" data-layer="sun">Sun</button><button type="button" data-layer="moon">Moon</button><span class="sep"></span>' +
    '<button type="button" data-layer="tower">Tower</button><button type="button" data-layer="landmarks" title="The sun or moon behind the Siegessäule and the Brandenburger Tor">Landmarks</button><button type="button" data-layer="streets">Streets</button>';
  wireSwitches(group);
  return group;
}

/** What the search had to say beside its dates, each under the name of what was searched. */
function notes() {
  const box = el('div', 'fh-notes');
  for (const { names, note } of gatherNotes([...search.groups.values()])) {
    const p = el('p', 'muted');
    p.append(el('b', '', `${names.join(', ')}: `), note);
    box.append(p);
  }
  return box;
}

/** While the year is searched: a bar that moves, and each thing looked for with what it gave. */
function searching() {
  const box = el('div', 'fh-search');
  box.setAttribute('role', 'status');
  box.append(el('h3', '', 'From here'), el('p', '', 'Searching the next 12 months from this spot…'));
  const bar = el('div', 'fh-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Search of the next twelve months');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(Math.round(search.share * 100)));
  bar.append(el('i', ''));
  bar.firstElementChild.style.width = `${(search.share * 100).toFixed(1)}%`;
  const steps = el('ul', 'fh-steps');
  for (const group of search.groups.values()) {
    const step = el('li', '', group.heading);
    if (group.done) {
      step.dataset.done = 'true';
      step.append(el('span', 'muted', group.shots.length ? ` · ${group.shots.length} date${group.shots.length === 1 ? '' : 's'}` : ' · none'));
    }
    steps.append(step);
  }
  box.append(bar, steps);
  return box;
}

function render() {
  if (!search) return;
  queueMicrotask(nameNext);
  if (pending().length) {
    list.dataset.state = 'searching';
    body.replaceChildren(searching());
    return;
  }
  const now = Date.now();
  const all = allShots();
  const shown = shownShots(all, layers);
  const head = el('div', 'fh-head');
  head.append(el('h3', '', 'From here'));
  if (all.length) head.append(el('span', 'muted', countWords(shown.length, all.length)));
  if (all.length) {
    const full = document.body.dataset.datesSize === 'full';
    const size = el('button', 'icon-btn fh-size');
    size.type = 'button';
    size.setAttribute('aria-pressed', String(full));
    size.setAttribute('aria-label', full ? 'Show less of the list' : 'Show more of the list');
    size.title = full ? 'Show less' : 'Show more';
    size.innerHTML = icon(full ? 'chevron-down' : 'chevron-up', { size: 18 });
    size.addEventListener('click', () => {
      document.body.dataset.datesSize = full ? 'half' : 'full';
      render();
    });
    head.append(size);
  }

  if (!all.length) {
    const none = el('p', 'fh-none');
    if ([...search.groups.values()].some((g) => g.failed)) {
      // No answer is not "nothing": say the search failed, and offer it again.
      list.dataset.state = 'failed';
      none.append(el('b', '', 'The search did not finish.'), ' ');
      if (search.again) {
        const retry = Object.assign(el('button', 'pill', 'Search again'), { type: 'button' });
        retry.addEventListener('click', search.again);
        none.append(retry);
      }
    } else {
      // Nothing in the whole year: say so, and what the search knows about why.
      list.dataset.state = 'empty';
      none.append(el('b', '', 'Nothing lines up from here in the next twelve months.'), ' Try a few steps along.');
    }
    body.replaceChildren(head, none, notes());
    return;
  }
  list.dataset.state = 'ready';
  const parts = [head, switches()];
  if (!shown.length) parts.push(emptyNote());
  else {
    const picks = highlights(shown, now, { gradeOf: (shot) => search.verdicts.get(shot)?.grade ?? null });
    if (picks.length) parts.push(el('h4', 'plan-day', 'Best from here'), best(picks));
    // The whole year under them, the picked ones too: a row says what a card has no room for.
    for (const month of byMonth(shown)) {
      const rows = el('div', 'fh-month');
      for (const shot of month.shots) {
        const row = shotRow({ ...shot, title: rowWhen(shot.when) }, search.verdicts.get(shot) ?? null, () => pick(shot));
        // The canonical sun or moon of that minute (the moon in its phase) before the date; the
        // weekday apart, and the small print in short beside it, for a screen too narrow for
        // either (fromhere.css shows one or the other).
        const [weekday, rest] = weekdayApart(rowWhen(shot.when));
        const title = row.querySelector('.sc-title');
        title.replaceChildren(el('span', 'fh-weekday', weekday), rest);
        title.insertAdjacentHTML('afterbegin', bodyIcon(shot.body, shot.t, { size: 14 }));
        row.querySelector('.sc-detail').after(el('span', 'fh-brief', shot.brief));
        rows.append(mark(row, shot));
      }
      parts.push(el('h4', 'plan-day', month.label), rows);
    }
  }
  parts.push(notes());
  body.replaceChildren(...parts);
}

/*
 * The ticket's line says what lines up at the chosen minute, and "nothing with the tower" when
 * nothing does. With the year's list open under it that reads as if the list were empty, so
 * while the list is open the idle line names the next date from here instead (or says that
 * its nothing is about this minute). Only the idle line, only while the list is open: what
 * eclipse.js says of the minute itself is left as it is.
 */
const statusLine = document.getElementById('eclipse');
let theirs = null;
let ours = null;
function nameNext() {
  if (document.body.dataset.dates !== 'open') {
    // Closed: the line is the minute's own again.
    if (ours !== null && statusLine.textContent === ours) statusLine.textContent = theirs;
    ours = null;
    return;
  }
  if (statusLine.dataset.state !== 'idle' || !search || pending().length) return;
  const now = Date.now();
  const next = shownShots(allShots(), layers).filter((s) => (s.until ?? s.t) >= now).sort((a, b) => a.t - b.t)[0];
  const text = next ? `Next from here: ${formatDay(next.t)}, ${formatClock(next.t)}` : 'Nothing lines up right now';
  if (statusLine.textContent === text) return;
  theirs = statusLine.textContent;
  statusLine.textContent = ours = text;
}
new MutationObserver(nameNext).observe(statusLine, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
new MutationObserver(nameNext).observe(document.body, { attributes: true, attributeFilter: ['data-dates'] });

document.addEventListener('layerchange', () => {
  if (search && !pending().length) render();
});
