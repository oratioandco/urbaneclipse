/**
 * "From here": the year's shots from the spot you stand on, put in order for the panel. The
 * search itself is dates.js and its worker; this file only decides what to show of what it
 * found: each date as a shot for the shot card, the few worth a card of their own
 * (`highlights`), and the whole year by month (`byMonth`). Pure: no DOM, no three.js.
 *
 *   asShot(found)                  a date of dates.js as a shot for shotCard.js
 *   shotFromKey(key, t, distanceM) the same shot again from a link's `shot=`, for the ticket
 *   spectacle(found)               how much of a picture it is, on dayShots.js's scale
 *   shownShots(shots, switches)    the four switches of the day list, applied
 *   highlights(shots, now)         up to three, the next decent one first
 *   byMonth(shots)                 the year list's groups
 *   rowWhen(when)                  a row's date under its month's name: without the year
 *   gatherNotes(groups)            what the search said beside its dates, said once
 *   countWords(n)                  "14 dates in 12 months"
 */
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { FIGURE_TARGETS, discShare } from '../lib/landmarkStands.ts';
import { LANDMARK_CAUTION, LANDMARK_CHECK, figureWord, landmarkScore, lensFor } from './landmarkShots.js';
import { discOverSphere } from './towerShots.js';
// The pale moon by day: one pair of numbers for every list (spectacle.js).
import { PALE_MOON, PALE_MOON_SUN_DEG } from './spectacle.js';

const DAY_MS = 86_400_000;
/** A shot scoring this much is worth going out for: the first card is the next of these. */
export const DECENT = 1;
/** How much a shot a year away loses against the same shot today. */
const LATER_COSTS = 0.35;
/** Dates of one kind this close together are one run (a henge comes back several days in a row). */
const RUN_MS = 21 * DAY_MS;
/** Days of one run follow each other this closely (a pass comes back a day later, a little changed). */
const NEXT_DAY_MS = 1.5 * DAY_MS;
/** A forecast that says Skip halves a shot's rank; one that says Go lifts it a little. */
const WEATHER = { good: 1.1, fair: 0.9, poor: 0.5 };

/**
 * The sprite (public/landmark-sprites) and the short name of each landmark the search knows,
 * and for the two the day list has as "Landmarks" the part a shot is named after: the same
 * `where` their day rows carry (landmarkShots.js; tests keep the two in step).
 */
const LANDMARK = {
  fernsehturm: { sprite: 'fernsehturm', short: 'TV tower' },
  'brandenburger-tor': { sprite: 'brandenburger_tor', short: 'Brandenburger Tor' },
  siegessaeule: { sprite: 'siegessaeule', short: 'Siegessäule' },
};
const TARGET_OF_PART = Object.fromEntries(FIGURE_TARGETS.map((item) => [item.where, item.id]));

const distanceText = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const SIDES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Which side of a landmark a bearing from it lies on, in a word, as its day rows say "west". */
export const sideOf = (bearingDeg) => SIDES[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8];

/**
 * The spectacle of a date, on the scale `collectRows` (dayShots.js) scores a day's rows with,
 * so a year's list ranks as a day's does: a big moon over a ring of sun over a plain pass, a
 * long street over a short one. `found` is what `asShot` takes. A year also holds what a day's
 * list never has to weigh: the moon by day, which counts for less (`t` given).
 */
export function spectacle({ kind, body, target = 'fernsehturm', state = 'hidden', distanceM = null, lengthM = null, t = null }) {
  const pale = body === 'moon' && t !== null && sampleBody('sun', new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon).alt > PALE_MOON_SUN_DEG ? PALE_MOON : 1;
  return pale * picture({ kind, body, target, state, distanceM, lengthM });
}

function picture({ kind, body, target, state, distanceM, lengthM }) {
  if (kind === 'street') return Math.min(1.6, (lengthM ?? 800) / 800);
  if (state === 'antenna') return body === 'moon' ? 2 : 1.4;
  if (state === 'edge') return body === 'moon' ? 1.3 : 1;
  if (target === 'fernsehturm') {
    if (body === 'moon') return Math.min(2.4, 1.5 * (distanceM ? discOverSphere(distanceM) : 1));
    return state === 'ring' ? 1.8 : 1.2;
  }
  // The Viktoria and the quadriga, scored as their day rows are: by the disc against the figure.
  const figure = FIGURE_TARGETS.find((item) => item.id === target);
  return landmarkScore(body, figure && distanceM ? discShare(figure, distanceM) : 1);
}

/**
 * A date the search found, as a shot for `shotCard`. `found` is what dates.js hands over:
 * `{ t, body, kind, when, detail, go, distanceM }` and, for a landmark, `target` (its id),
 * `state` (hidden, ring, edge, antenna), `what` (the pass in words), `until` and `fromDeg`
 * (the bearing from the landmark to the spot); for a street, `place` (its name) and `lengthM`.
 * `altDeg` is the body's height at that minute.
 *
 * The shot's `title` is the sentence the ticket and the calendar entry use; `when` is the date
 * and time the year list's row is headed with; `brief` is the row's small print for a narrow
 * screen (place, pass, height). `where` names the part of the landmark as its day rows do:
 * the tower's sphere or antenna, the column's `viktoria`, the gate's `quadriga`. The column
 * and the gate also carry what their day rows carry (landmarkShots.js): `stand` (how far and
 * on which side), `side`, and the caution that buildings are checked and trees are not.
 */
export function asShot(found) {
  const street = found.kind === 'street';
  const mark = LANDMARK[found.target] ?? LANDMARK.fernsehturm;
  const short = street ? found.place : mark.short;
  const bodyName = found.body === 'moon' ? 'Moon' : 'Sun';
  const target = street ? null : (found.target ?? 'fernsehturm');
  const figure = FIGURE_TARGETS.find((item) => item.id === target) ?? null;
  // A figure's sentence is its day row's (landmarkRows): "Sun behind the Siegessäule’s Viktoria",
  // and a disc a quarter larger than the figure is a big one.
  const share = figure && found.distanceM ? discShare(figure, found.distanceM) : null;
  const behind = figure ? `${bodyName} behind the ${short}’s ${figureWord(figure)}` : `${bodyName} behind the ${short}`;
  const what = street ? `${bodyName} down ${found.place}` : figure && share >= 1.25 ? `Big ${found.body} behind the ${short}’s ${figureWord(figure)}, ${share.toFixed(1)}× the figure` : (figure ? behind : (found.what ?? behind));
  // The search words a figure's date with the plain sentence first: the row says the same as the card.
  const said = figure && found.detail?.startsWith(behind) ? what + found.detail.slice(behind.length) : found.detail;
  const detail = figure ? (said ?? what) : found.detail ? `${short} · ${found.detail}` : short;
  const up = Number.isFinite(found.altDeg) ? ` · ${Math.round(found.altDeg)}° up` : '';
  const shot = {
    t: found.t,
    until: found.until ?? found.t,
    body: found.body,
    kind: street ? 'street' : 'tower',
    short,
    // The tower's own passes say "the sphere" and "the antenna": the sentence names the tower too.
    title: street || figure || what.includes('TV tower') ? what : `TV tower: ${what[0].toLowerCase()}${what.slice(1)}`,
    when: found.when,
    detail: figure ? `${detail} · ${LANDMARK_CHECK}` : detail,
    // A figure's sentence names its landmark; what is not checked stays at every width.
    brief: figure ? `${behind}${up} · ${LANDMARK_CAUTION}` : `${short} · ${street ? `${bodyName} down the street` : what}${up}`,
    distanceM: street ? (found.lengthM ?? null) : (found.distanceM ?? null),
    altDeg: found.altDeg ?? null,
    score: spectacle({ ...found, kind: street ? 'street' : 'tower' }),
    series: `${street ? 'street' : target}|${found.body}`,
    group: found.group ?? '',
    // A link says so (`here=year`): the day's own rows are for other spots, so the ticket's
    // card is made again from the link itself (`shotFromKey`).
    fromHere: true,
    go: found.go,
  };
  if (!street) {
    shot.target = target;
    shot.landmark = mark.sprite;
    shot.where = figure ? figure.where : found.state === 'antenna' ? 'antenna' : 'sphere';
  }
  if (figure) {
    shot.caution = LANDMARK_CAUTION;
    shot.checked = { buildings: true, trees: false };
    // The rest of a day row's shape (landmarkShots.js), which the eye-level line and caption read.
    if (Array.isArray(found.at)) Object.assign(shot, { at: found.at, openAt: found.t });
    if (Array.isArray(found.look)) shot.look = found.look;
    if (shot.distanceM) Object.assign(shot, { discShare: share, lens: lensFor(figure, shot.distanceM), standDistanceM: shot.distanceM });
    if (Number.isFinite(found.fromDeg)) Object.assign(shot, { side: sideOf(found.fromDeg), standBearingDeg: found.fromDeg });
    if (shot.side && shot.distanceM) shot.stand = `${distanceText(shot.distanceM)} ${shot.side}`;
  }
  return shot;
}

/**
 * A shot from here again, from what a link carries: its name (`shot=`, the `shotKey` of
 * dayShots.js: "sphere-sun", "antenna-moon", "street-moon:Karl-Marx-Allee", and for the other
 * landmarks "viktoria-sun" and "quadriga-moon"), the link's instant, and where the spot lies
 * from the landmark the name is of (`targetOfKey`): how far, and for the column and the gate
 * on which bearing. Enough for the ticket's card and the calendar entry's name; null for a
 * name it cannot read.
 */
export function shotFromKey(key, t, { distanceM = null, fromDeg = null, at = null } = {}) {
  const [head, ...rest] = String(key ?? '').split(':');
  const match = /^(.+)-(sun|moon)$/.exec(head);
  if (!match || !Number.isFinite(t)) return null;
  const [, part, body] = match;
  if (part === 'street') return rest.length ? asShot({ t, body, kind: 'street', place: rest.join(':') }) : null;
  const tower = part === 'sphere' || part === 'antenna';
  const figure = TARGET_OF_PART[part];
  if (!tower && !figure) return null;
  const what = tower ? `${body === 'moon' ? 'Moon' : 'Sun'} behind the TV tower’s ${part}` : undefined;
  return asShot({ t, body, kind: 'tower', target: tower ? 'fernsehturm' : figure, state: part === 'antenna' ? 'antenna' : 'hidden', what, distanceM, fromDeg, at });
}

/** The landmark a link's `shot=` is of, by its id in targets.js, or null for a street or an unknown name. */
export function targetOfKey(key) {
  const part = /^(.+)-(sun|moon)$/.exec(String(key ?? '').split(':')[0])?.[1];
  return part === 'sphere' || part === 'antenna' ? 'fernsehturm' : (TARGET_OF_PART[part] ?? null);
}

/**
 * The day list's five switches applied to the year's shots: `sun` and `moon` by body, `tower`
 * for the TV tower, `landmarks` for the Siegessäule and the Brandenburger Tor, `streets` for
 * the street you stand in. A switch that is not false is on.
 */
export function shownShots(shots, switches = {}) {
  const kind = (s) => (s.kind === 'street' ? 'streets' : (s.target ?? 'fernsehturm') === 'fernsehturm' ? 'tower' : 'landmarks');
  return shots.filter((s) => switches[s.body] !== false && switches[kind(s)] !== false);
}

/** A shot's rank at `now`: its spectacle, less for being far off, weighed by a forecast's grade. */
export function rank(shot, now, grade = null) {
  const far = Math.min(1, Math.max(0, (shot.t - now) / (365 * DAY_MS)));
  return shot.score * (1 - LATER_COSTS * far) * (WEATHER[grade] ?? 1);
}

/**
 * The shots worth a card: up to `max`, in time order. The next shot in time comes first when
 * it is decent (it scores `DECENT` or more and no forecast says Skip), on the best of its days
 * when it runs over several (the sun at the sphere's edge today is a ring round it tomorrow:
 * the card is tomorrow's); the rest are the best by
 * `rank`, one of each kind (the same body at the same place) before a second of any: the moon
 * comes round every month and would otherwise take every card. A run of the same shot on
 * neighbouring days never gives two. `gradeOf` gives a shot's forecast grade ('good', 'fair',
 * 'poor') or null beyond the forecast's reach.
 */
export function highlights(shots, now, { max = 3, gradeOf = () => null } = {}) {
  const ahead = shots.filter((s) => (s.until ?? s.t) >= now).sort((a, b) => a.t - b.t);
  const chosen = [];
  const sameRun = (a, b) => a.series === b.series && Math.abs(a.t - b.t) < RUN_MS;
  const ranked = ahead.map((shot) => ({ shot, value: rank(shot, now, gradeOf(shot)) })).sort((a, b) => b.value - a.value || a.shot.t - b.shot.t);
  const next = ahead[0];
  if (next && next.score >= DECENT && gradeOf(next) !== 'poor') {
    // The days that follow it without a gap are the same chance: its best day stands for it.
    const run = [next];
    for (const shot of ahead) if (shot.series === next.series && shot.t > run[run.length - 1].t && shot.t - run[run.length - 1].t <= NEXT_DAY_MS) run.push(shot);
    chosen.push(ranked.find(({ shot }) => run.includes(shot)).shot);
  }
  for (const again of [(c, shot) => c.series === shot.series, sameRun]) {
    for (const { shot } of ranked) {
      if (chosen.length >= max) break;
      if (!chosen.includes(shot) && !chosen.some((c) => again(c, shot))) chosen.push(shot);
    }
  }
  return chosen.sort((a, b) => a.t - b.t);
}

const monthKey = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 7);
const monthName = (t) => new Date(t).toLocaleDateString('en-GB', { timeZone: 'Europe/Berlin', month: 'long', year: 'numeric' });

/**
 * The year list: the shots in time order, grouped by Berlin's calendar month.
 * `[{ key: '2027-03', label: 'March 2027', shots }]`, months without a shot left out.
 */
export function byMonth(shots) {
  const months = [];
  for (const shot of [...shots].sort((a, b) => a.t - b.t)) {
    const key = monthKey(shot.t);
    if (months[months.length - 1]?.key !== key) months.push({ key, label: monthName(shot.t), shots: [] });
    months[months.length - 1].shots.push(shot);
  }
  return months;
}

/**
 * A row's date and time as the year list heads it: the month's name over the rows already
 * carries the year, so "Thu, 14 Jan 2027 · 23:34–23:37" is said as "Thu, 14 Jan · 23:34–23:37".
 */
export const rowWhen = (when) => String(when ?? '').replace(/ \d{4}(?= \u00b7)/, '');

/** A row's date as its weekday ("Thu, ") and the rest, for a screen too narrow for both. */
export const weekdayApart = (when) => {
  const [, weekday = '', rest = when] = /^([A-Za-z]+, )(.*)$/.exec(when) ?? [];
  return [weekday, rest];
};

/**
 * What the searches said beside their dates ("8 more hidden by buildings"), each once, under
 * the names of what it was said of: three landmarks hidden by the same wall are one sentence.
 * `groups` are `[{ id, heading, notes }]`; gives `[{ names, note }]` in the order first said.
 */
export function gatherNotes(groups) {
  const said = [];
  for (const group of groups) {
    const name = LANDMARK[group.id]?.short ?? group.heading;
    for (const note of group.notes ?? []) {
      const same = said.find((s) => s.note === note);
      if (same) same.names.push(name);
      else said.push({ names: [name], note });
    }
  }
  return said;
}

/** How many dates the year holds, in words; `of` the number before the switches hid some. */
export function countWords(n, of = n) {
  const dates = `${n} date${n === 1 ? '' : 's'}`;
  return of > n ? `${dates} of ${of} shown` : `${dates} in 12 months`;
}
