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
 *   countWords(n)                  "14 dates in the next twelve months"
 */
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { discOverSphere } from './towerShots.js';

const DAY_MS = 86_400_000;
/** A shot scoring this much is worth going out for: the first card is the next of these. */
export const DECENT = 1;
/** How much a shot a year away loses against the same shot today. */
const LATER_COSTS = 0.35;
/** Dates of one kind this close together are one run (a henge comes back several days in a row). */
const RUN_MS = 21 * DAY_MS;
/** With the sun this high the moon is a pale disc in a blue sky: less of a picture. */
const PALE_MOON_SUN_DEG = 6;
const PALE_MOON = 0.6;
/** A forecast that says Skip halves a shot's rank; one that says Go lifts it a little. */
const WEATHER = { good: 1.1, fair: 0.9, poor: 0.5 };

/** The sprite (public/landmark-sprites) and the short name of each landmark the search knows. */
const LANDMARK = {
  fernsehturm: { sprite: 'fernsehturm', short: 'TV tower' },
  'brandenburger-tor': { sprite: 'brandenburger_tor', short: 'Brandenburger Tor' },
  siegessaeule: { sprite: 'siegessaeule', short: 'Siegessäule' },
};

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
  // The other landmarks: the disc round the figure or the quadriga is the picture.
  if (state === 'ring') return body === 'moon' ? 2 : 1.8;
  return 1.2;
}

/**
 * A date the search found, as a shot for `shotCard`. `found` is what dates.js hands over:
 * `{ t, body, kind, when, detail, go, distanceM }` and, for a landmark, `target` (its id),
 * `state` (hidden, ring, edge, antenna), `what` (the pass in words) and `until`; for a street,
 * `place` (its name) and `lengthM`. `altDeg` is the body's height at that minute.
 *
 * The shot's `title` is the sentence the ticket and the calendar entry use; `when` is the date
 * and time the year list's row is headed with. `where` names the part of the landmark: the
 * tower's sphere or antenna, and for another landmark its own id, so a link's `shot=` never
 * names the tower's sphere for a pass behind the gate.
 */
export function asShot(found) {
  const street = found.kind === 'street';
  const mark = LANDMARK[found.target] ?? LANDMARK.fernsehturm;
  const short = street ? found.place : mark.short;
  const bodyName = found.body === 'moon' ? 'Moon' : 'Sun';
  const what = street ? `${bodyName} down ${found.place}` : (found.what ?? `${bodyName} behind the ${short}`);
  const shot = {
    t: found.t,
    until: found.until ?? found.t,
    body: found.body,
    kind: street ? 'street' : 'tower',
    short,
    // The tower's own passes say "the sphere" and "the antenna": the sentence names the tower too.
    title: street || (found.target ?? 'fernsehturm') !== 'fernsehturm' || what.includes('TV tower') ? what : `TV tower: ${what[0].toLowerCase()}${what.slice(1)}`,
    when: found.when,
    detail: found.detail ? `${short} · ${found.detail}` : short,
    distanceM: street ? (found.lengthM ?? null) : (found.distanceM ?? null),
    altDeg: found.altDeg ?? null,
    score: spectacle({ ...found, kind: street ? 'street' : 'tower' }),
    series: `${street ? 'street' : (found.target ?? 'fernsehturm')}|${found.body}`,
    group: found.group ?? '',
    // A link says so (`here=year`): the day's own rows are for other spots, so the ticket's
    // card is made again from the link itself (`shotFromKey`).
    fromHere: true,
    go: found.go,
  };
  if (!street) {
    shot.landmark = mark.sprite;
    shot.where = (found.target ?? 'fernsehturm') === 'fernsehturm' ? (found.state === 'antenna' ? 'antenna' : 'sphere') : found.target;
  }
  return shot;
}

/**
 * A shot from here again, from what a link carries: its name (`shot=`, the `shotKey` of
 * dayShots.js: "sphere-sun", "antenna-moon", "street-moon:Karl-Marx-Allee", and for the other
 * landmarks "siegessaeule-sun"), the link's instant, and for the tower how far the spot is from
 * it. Enough for the ticket's card and the calendar entry's name; null for a name it cannot read.
 */
export function shotFromKey(key, t, distanceM = null) {
  const [head, ...rest] = String(key ?? '').split(':');
  const match = /^(.+)-(sun|moon)$/.exec(head);
  if (!match || !Number.isFinite(t)) return null;
  const [, part, body] = match;
  if (part === 'street') return rest.length ? asShot({ t, body, kind: 'street', place: rest.join(':') }) : null;
  const tower = part === 'sphere' || part === 'antenna';
  if (!tower && !LANDMARK[part]) return null;
  const what = tower ? `${body === 'moon' ? 'Moon' : 'Sun'} behind the TV tower’s ${part}` : undefined;
  return asShot({ t, body, kind: 'tower', target: tower ? 'fernsehturm' : part, state: part === 'antenna' ? 'antenna' : 'hidden', what, distanceM: tower ? distanceM : null });
}

/**
 * The day list's four switches applied to the year's shots: `sun` and `moon` by body, `tower`
 * for every landmark, `streets` for the street you stand in. A switch that is not false is on.
 */
export function shownShots(shots, switches = {}) {
  return shots.filter((s) => switches[s.body] !== false && switches[s.kind === 'street' ? 'streets' : 'tower'] !== false);
}

/** A shot's rank at `now`: its spectacle, less for being far off, weighed by a forecast's grade. */
export function rank(shot, now, grade = null) {
  const far = Math.min(1, Math.max(0, (shot.t - now) / (365 * DAY_MS)));
  return shot.score * (1 - LATER_COSTS * far) * (WEATHER[grade] ?? 1);
}

/**
 * The shots worth a card: up to `max`, in time order. The next shot in time comes first when
 * it is decent (it scores `DECENT` or more and no forecast says Skip); the rest are the best by
 * `rank`, one of each kind (the same body at the same place) before a second of any: the moon
 * comes round every month and would otherwise take every card. A run of the same shot on
 * neighbouring days never gives two. `gradeOf` gives a shot's forecast grade ('good', 'fair',
 * 'poor') or null beyond the forecast's reach.
 */
export function highlights(shots, now, { max = 3, gradeOf = () => null } = {}) {
  const ahead = shots.filter((s) => (s.until ?? s.t) >= now).sort((a, b) => a.t - b.t);
  const chosen = [];
  const sameRun = (a, b) => a.series === b.series && Math.abs(a.t - b.t) < RUN_MS;
  const next = ahead[0];
  if (next && next.score >= DECENT && gradeOf(next) !== 'poor') chosen.push(next);
  const ranked = ahead.map((shot) => ({ shot, value: rank(shot, now, gradeOf(shot)) })).sort((a, b) => b.value - a.value || a.shot.t - b.shot.t);
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
  return of > n ? `${dates} of ${of} shown` : `${dates} in the next twelve months`;
}
