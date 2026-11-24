/**
 * The home page's grid of the next three days' shots: one hero card for the next shot worth
 * taking, with a countdown, then a grid per day. It answers "is anything worth shooting
 * soon?" without the 3D scene: the shots come from the planner's own dayShots.js, the verdicts from the planner's
 * own `shotVerdict` and forecast (`cloudsFor`), and every card is the planner's `shotCard`.
 * The logic of days, order and empty days is in grid.js.
 *
 * Markup it fills: `#next-shots` in src/pages/index.astro. For testing, `?now=2027-06-21T05:30`
 * fixes the clock (grid.js `parseNow`); the forecast still only reaches 16 days from the real
 * today, so further dates show their shots without a verdict.
 */
import { loadStreets } from '../lib/streets.ts';
import { FIGURE_TARGETS } from '../lib/landmarkStands.ts';
import { loadViewshed } from '../lib/viewshed.ts';
import { drawShotFrame, shotCard } from '../miniature/shotCard.js';
import { formatClock } from '../miniature/time.js';
import { countdown, shotVerdict } from '../miniature/verdict.js';
import { cloudsFor, forecastReach } from '../miniature/weather.js';
import { answer, countsLine, dayLine, dayLink, groupDay, nextWorth, parseNow, planLink, threeDays, withoutContinued } from './grid.js';
import { dayShots } from '../miniature/dayShots.js';

const root = document.getElementById('next-shots');
const answerEl = root.querySelector('[data-answer]');
const list = root.querySelector('[data-list]');
const toggle = root.querySelector('[data-skip-toggle]');

// The clock: the real one, or one that starts at `?now=` and runs on from there.
const fixed = parseNow(location.search);
const opened = Date.now();
const clock = () => (fixed === null ? Date.now() : fixed + (Date.now() - opened));

/** What is known so far: the data the shots are computed from, the shots, and the forecasts. */
const state = {
  days: [],
  shots: new Map(), // date -> rows of dayShots
  forecasts: new Map(), // date -> the day's forecast, null (failed), or 'none' (out of reach)
  shed: undefined, // undefined while loading, null when it failed
  sheds: {}, // the Siegessäule's and the Brandenburger Tor's viewsheds, by id; one that failed is absent
  views: undefined,
  showSkipped: false,
  hero: null,
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** The verdict of a shot from its day's forecast, or which kind of none there is. */
function rate(day) {
  const forecast = state.forecasts.get(day.date);
  const missing = forecast === 'none' ? 'No forecast yet' : forecast === null ? 'No forecast' : 'Forecast loading';
  return (shot) => shotVerdict(forecast && forecast !== 'none' ? forecast : null, day.from, shot.t, { body: shot.body, distanceM: shot.distanceM, missing });
}

/** The three days' forecast as one word: 'loading' until all are in, 'failed' if none came. */
function forecastState() {
  const all = state.days.map((day) => state.forecasts.get(day.date));
  if (all.some((f) => f === undefined)) return 'loading';
  return all.some((f) => f && f !== 'none') ? 'ok' : all.some((f) => f === null) ? 'failed' : 'none';
}

/** A shot's card, as a link into the planner at that shot. */
function card(rated, day, { hero = false, now } = {}) {
  const { shot, verdict } = rated;
  // A link: the card names itself (its day, time, shot and verdict) for a screen reader.
  const node = shotCard(shot, verdict, { size: 'card', tag: 'a', day: day.name });
  node.href = planLink(shot);
  if (hero) {
    node.classList.add('home-hero');
    // A wider frame for the hero, drawn by the card's own drawing.
    const canvas = node.querySelector('canvas');
    canvas.width = 1120;
    canvas.height = 840;
    drawShotFrame(canvas, shot, verdict);
    node.querySelector('.sc-verdict').prepend(el('em', 'home-upnext', 'Up next'));
    const time = node.querySelector('.sc-time');
    time.textContent = `${day.i === 0 ? '' : `${day.name} `}${formatClock(shot.t)}`;
    time.append(el('small', 'home-eta', countdown(shot.t, now)));
  }
  return node;
}

function button(text, onClick, className = 'home-chip') {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function setSkipped(value) {
  state.showSkipped = value;
  render();
}
toggle.addEventListener('click', () => setSkipped(!state.showSkipped));

function render() {
  const now = clock();
  const ready = state.shed !== undefined && state.views !== undefined && state.days.every((day) => state.shots.has(day.date));
  if (!ready) return;
  const groups = state.days.map((day) => groupDay(day, state.shots.get(day.date), rate(day), now));
  const forecast = forecastState();
  const next = nextWorth(groups);
  state.hero = next;
  root.dataset.state = 'ready';
  root.dataset.forecast = forecast;
  // Without the viewshed and the streets nothing is known: that is not "nothing lines up".
  const blind = state.shed === null && state.views === null;
  answerEl.textContent = blind ? 'The next shots could not be worked out.' : answer(groups, forecast === 'none' ? 'failed' : forecast);

  const skipped = groups.reduce((sum, g) => sum + g.skipped.length, 0);
  toggle.hidden = !skipped;
  toggle.setAttribute('aria-pressed', String(state.showSkipped));
  toggle.textContent = state.showSkipped ? 'Hide skipped shots' : 'Show skipped shots';

  const nodes = [];
  // What could not be loaded is said in words, with a way to try again.
  if (blind) {
    // The forecast has nothing to rate.
  } else if (forecast === 'failed') {
    const note = el('p', 'home-note', 'The weather forecast could not be loaded, so these shots have no verdict: they line up, but nothing says whether the sky lets them through. ');
    note.append(button('Try again', loadForecasts));
    nodes.push(note);
  } else if (forecast === 'none') {
    nodes.push(el('p', 'home-note', 'The forecast reaches 16 days ahead, and these days are beyond it: the shots line up, without a verdict.'));
  }
  if (state.shed === null || state.views === null) {
    const what = blind ? 'Where the tower can be seen from and which streets line up is worked out from city data, and that' : state.shed === null ? 'Shots behind the tower’s sphere are missing' : 'Street shots are missing';
    const note = el('p', 'home-note', blind ? `${what} did not load. ` : `${what}: the city data did not load. `);
    note.append(button('Try again', loadCity));
    nodes.push(note);
  }
  if (next) nodes.push(card(next, next.day, { hero: true, now }));

  for (const group of blind ? [] : groups) {
    const section = el('section', 'home-day');
    const heading = el('h3', 'home-day-name', group.name);
    const small = el('small', '', [group.name === group.weekday ? '' : group.weekday, countsLine(group)].filter(Boolean).join(' · '));
    heading.append(small);
    section.append(heading);
    const shown = state.showSkipped ? group.all : group.worth;
    if (shown.length) {
      const grid = el('div', 'home-grid');
      grid.append(...shown.map((rated) => card(rated, group)));
      section.append(grid);
    }
    const line = dayLine(group, state.showSkipped);
    if (line) {
      const row = el('p', 'home-line');
      row.append(el('span', '', line.text));
      if (line.hidden) row.append(button('Show skipped shots', () => setSkipped(true)));
      else {
        const link = el('a', 'home-chip', 'Open this day in the planner');
        link.href = dayLink(group.date);
        row.append(link);
      }
      section.append(row);
    }
    nodes.push(section);
  }
  list.replaceChildren(...nodes);
}

/** The forecast of each of the three days; a failed day says so and can be tried again. */
function loadForecasts() {
  for (const day of state.days) {
    const had = state.forecasts.get(day.date);
    if (had && had !== 'none') continue;
    if (!forecastReach(day.date).ok) {
      state.forecasts.set(day.date, 'none');
      continue;
    }
    state.forecasts.delete(day.date);
    cloudsFor(day.date, day.from).then((forecast) => {
      state.forecasts.set(day.date, forecast ?? null);
      render();
    });
  }
  render();
}

// Three days of alignment maths take a moment on a phone: one day per frame, so the page
// stays responsive and the header is painted first.
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));
async function computeShots() {
  state.days = threeDays(clock());
  let before = [];
  for (const day of state.days) {
    const rows = dayShots(day.from, { shed: state.shed, views: state.views ?? [], sheds: state.sheds });
    state.shots.set(day.date, withoutContinued(rows, day.from, before));
    before = rows;
    await nextFrame();
  }
}

/** The viewshed and the streets, then the shots. Either may fail without taking the other along. */
async function loadCity() {
  root.dataset.state = 'loading';
  const [shed, views, ...landmarks] = await Promise.allSettled([loadViewshed(), loadStreets(), ...FIGURE_TARGETS.map((target) => loadViewshed(target.id))]);
  state.shed = shed.status === 'fulfilled' ? shed.value : null;
  state.views = views.status === 'fulfilled' ? views.value : null;
  // A landmark whose viewshed did not load has no shots: unchecked ones are not offered.
  state.sheds = Object.fromEntries(FIGURE_TARGETS.map((target, i) => [target.id, landmarks[i].status === 'fulfilled' ? landmarks[i].value : null]).filter(([, value]) => value));
  state.shots.clear();
  await computeShots();
  render();
}

// The countdown runs; a shot that passes, or midnight, brings the grid up to date.
setInterval(() => {
  const now = clock();
  const hero = state.hero;
  const newDay = state.days.length && now >= state.days[0].to;
  if (newDay) {
    state.shots.clear();
    computeShots().then(loadForecasts);
  } else if (hero && hero.shot.t <= now) render();
  else if (hero) {
    const eta = list.querySelector('.home-eta');
    if (eta) eta.textContent = countdown(hero.shot.t, now);
  }
}, 15_000);

state.days = threeDays(clock());
loadForecasts();
loadCity();
