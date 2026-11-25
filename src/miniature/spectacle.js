/**
 * Rules of spectacle that every list of shots shares, whatever the shot is of: the day's rows
 * (dayShots.js), and through them `/plan/`'s "Next 3 days", the home grid and `/map`; and
 * "From here"'s year of dates (fromHere.js). Pure.
 *
 *   paleMoon(body, t)        what the light of its minute does to a moon shot's score
 *   litPercent(t)            the moon's lit share, as every list prints it
 *   pickTop(rows, n, value)  the n to show of a list: parallel henges as one, kinds mixed
 */
import { getMoonIllumination } from 'suncalc';
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';

/** The moon's lit share at an instant, in whole percent: the number every list prints. */
export const litPercent = (t) => Math.round(getMoonIllumination(new Date(t)).fraction * 100);

/**
 * The moon by day. In a bright sky the moon is a pale disc: a street henge or a tower pass
 * with it is less of a picture than the same at dusk or at night. How much less is a ramp, not
 * a step: nothing is lost while the sun is 3° under the horizon or lower, all of it once the
 * sun is 9° up, smoothly between. (It was a step at 6°, 0.6 times above it: on 25 November
 * 2026 the big moon behind the tower at 08:54 fell to 1.44, under a plain henge, while the
 * antenna's moonset nineteen minutes earlier kept its 2.0.) What "all of it" is depends on the
 * moon's contrast against that sky: a full moon by day still counts 0.7 times, a quarter moon
 * 0.55.
 */
export const PALE_MOON_SUN_DEG = [-3, 9];
export const PALE_MOON_FLOOR = [0.5, 0.7];

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The factor from the sun's height (degrees) and the moon's lit fraction (0 to 1). */
export function paleMoonFactor(sunAltDeg, lit) {
  const floor = PALE_MOON_FLOOR[0] + (PALE_MOON_FLOOR[1] - PALE_MOON_FLOOR[0]) * Math.max(0, Math.min(1, lit));
  return 1 - (1 - floor) * smooth(PALE_MOON_SUN_DEG[0], PALE_MOON_SUN_DEG[1], sunAltDeg);
}

/** What a shot's score is multiplied by for the light its body stands in at instant `t`. */
export function paleMoon(body, t) {
  if (body !== 'moon') return 1;
  return paleMoonFactor(sampleBody('sun', new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon).alt, getMoonIllumination(new Date(t)).fraction);
}

/**
 * Whether a moon shot is one at all at instant `t`: by day a thin moon low over the roofs is
 * not seen. In a dark sky a quarter lit is enough (dailyPaths.ts `MIN_MOON_ILLUMINATION`); with
 * the sun up it takes more, along the same ramp the score falls on: 0.6 lit from a sun 9° up.
 * (10 June 2027, 12:13: a 39% moon "behind the quadriga" at noon was listed as a shot.)
 */
export function moonShows(t) {
  const sunAlt = sampleBody('sun', new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon).alt;
  return getMoonIllumination(new Date(t)).fraction >= 0.25 + 0.35 * smooth(PALE_MOON_SUN_DEG[0], PALE_MOON_SUN_DEG[1], sunAlt);
}

/**
 * Trees. No list knows whether a tree stands in a sight line: every tower and street shot says
 * "trees unchecked". Where the city's tree register puts crowns in the frame from a row's spot
 * (measured in the planner's scene by scripts/adversarial/rows.mjs, kept in
 * public/viewshed/trees-in-the-way.json, asked through src/lib/treeSpots.ts) the row says the
 * stronger thing and counts half, so it does not make a day's three. The register has street
 * and park trees with their listed height and crown; it says nothing of the season, and
 * neither do these words.
 */
export const TREES_UNCHECKED = 'trees unchecked';
export const TREES_IN_WAY = 'street trees in the way';
export const TREES_IN_WAY_NOTE = 'street trees in the way here, per the tree register: look for a gap';
export const TREES_IN_WAY_SCORE = 0.5;

/** How much a forecast's grade weighs a score, and how many shots a day shows in a short list. */
export const GRADE_WEIGHT = { good: 1.25, fair: 1, poor: 0.55 };
export const PER_DAY = 3;

/**
 * The next shot: the earliest still to come among the few each day shows (`pickTop`). One rule
 * for the home page's "Up next", the planner's one line and the first row of its list, which
 * had three answers at 00:30 on 20 December 2026 (3:05, 3:15, 3:26). `days` is a list of days,
 * each a list of `{ row, grade }` not graded Skip; `now` an instant.
 */
export function dayPicks(rated, n = PER_DAY) {
  const grade = new Map(rated.map((r) => [r.row, r.grade]));
  return pickTop(rated.map((r) => r.row), n, (row) => GRADE_WEIGHT[grade.get(row) ?? 'fair'] * row.score, true);
}

/** What a row is, for telling kinds apart: a street, a landmark's figure, the tower's sphere or antenna. */
export const kindOf = (row) => (row.kind === 'street' ? 'street' : row.target && row.target !== 'fernsehturm' ? 'landmark' : (row.where ?? 'sphere'));

/** A kind of picture: the kind and the body (a ring of sun and a big moon at the tower are two). */
const pictureOf = (row) => `${kindOf(row)}|${row.body}`;

/** Henges this close in time, down streets this close in direction, are one sight on parallel streets. */
const SAME_SIGHT_MS = 12 * 60_000;
const PARALLEL_DEG = 15;
/** Each shot of a kind already chosen makes the next of that kind count this much less. */
const SAME_KIND = 0.95;

/**
 * The `n` rows to show of a list, best first. `value(row)` is what a row is worth (its score,
 * weighed by the forecast where there is one).
 *
 * Two things a plain "top n by score" got wrong (14 January and 8 March 2027: three henges on
 * parallel streets within minutes of each other; 2 December 2026: three henges with the same
 * 37% moon):
 * - Henges of one body within twelve minutes, down streets within 15° of each other, are the
 *   same sight seen from parallel streets: the best stands for them, with the number of the
 *   others as `more`.
 * - Where values are close the list prefers different kinds: each row of a kind and body
 *   already chosen makes the next of that kind and body count 0.95 times, so a tower shot at 1.5
 *   comes before a third henge at 1.6, and never before a henge at 2 or a second moonrise at 1.7.
 *
 * Returns copies of the rows, in time order when `byTime` is set (a list reads by the clock;
 * its first row is then the next shot), with `more` (how many) and `others` (the rows) on a
 * henge that stands for others.
 */
export function pickTop(rows, n, value = (row) => row.score, byTime = false) {
  const sorted = [...rows].sort((a, b) => value(b) - value(a) || a.t - b.t);
  const sights = [];
  for (const row of sorted) {
    const bearing = row.moment?.view?.bearingDeg;
    const same =
      row.kind === 'street' && Number.isFinite(bearing)
        ? sights.find((s) => {
            const other = s.row.moment?.view?.bearingDeg;
            return s.row.kind === 'street' && s.row.body === row.body && Number.isFinite(other) && Math.abs(s.row.t - row.t) <= SAME_SIGHT_MS && Math.abs(((((bearing - other) % 360) + 540) % 360) - 180) <= PARALLEL_DEG;
          })
        : null;
    if (same) {
      same.more++;
      same.others.push(row);
    } else sights.push({ row, more: 0, others: [] });
  }
  const picked = [];
  const taken = {};
  while (picked.length < n && sights.length) {
    let best = 0;
    const worth = (s) => value(s.row) * SAME_KIND ** (taken[pictureOf(s.row)] ?? 0);
    for (let i = 1; i < sights.length; i++) if (worth(sights[i]) > worth(sights[best])) best = i;
    const [sight] = sights.splice(best, 1);
    taken[pictureOf(sight.row)] = (taken[pictureOf(sight.row)] ?? 0) + 1;
    picked.push(sight.more ? { ...sight.row, more: sight.more, others: sight.others.sort((a, b) => a.t - b.t), source: sight.row } : { ...sight.row, source: sight.row });
  }
  return byTime ? picked.sort((a, b) => a.t - b.t) : picked;
}

/** "and 2 more streets", for a henge that stands for others in a short list; '' for none. */
export const moreStreets = (row) => (row.more ? `and ${row.more} more street${row.more === 1 ? '' : 's'}` : '');
