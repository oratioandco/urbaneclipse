/**
 * Verdicts in words, and the one grade behind them. A shot's weather is never a bare coloured
 * dot: it is "Go", "Maybe" or "Skip" with the reason beside it, so the colour only backs the
 * word up. Pure, no DOM.
 *
 * Every grade in `/plan/` comes from `assess` here: the shot cards, the day list, the coming
 * days, the date list and the sunrise and sunset line. It answers one question, the one a
 * photographer of the disc behind a landmark has: will the disc and the landmark be seen?
 *
 * - Cloud is weighed by how well it hides the disc: low cloud fully, middle cloud nearly
 *   (0.85), thin high cloud little (0.4). A sky of cirrus over a clear lower sky is a Go.
 * - A body under 4 degrees is seen through air 60 to 220 km away, so the low cloud out there,
 *   toward the body, counts as much as the cloud over Berlin. The forecast holds it for the
 *   directions of sunrise and sunset; a low body elsewhere is graded on Berlin's sky and says so.
 * - Haze is compared with the distance of the shot (Koschmieder: contrast falls as
 *   exp(-3.9 d / V)): with the sight shorter than the distance the landmark is gone, under
 *   2.5 times it is washed out (a fifth of its contrast left).
 * - Over 75% hidden is Skip, over 50% Maybe. Rain likely is never better than Maybe.
 */
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { cloudsAt, visibilityAt } from './weather.js';

export const VERDICT_WORD = { good: 'Go', fair: 'Maybe', poor: 'Skip' };
/** How well each cloud layer hides the disc. */
export const CLOUD_WEIGHT = { low: 1, mid: 0.85, high: 0.4 };
/** Below this altitude the cloud out toward the horizon decides. */
export const LOW_BODY_DEG = 4;
/** How far a body may stand from the direction of sunrise or sunset for that forecast to count. */
const HORIZON_SPREAD_DEG = 15;
/** The landmark is lost when the sight is under the distance, washed out under 2.5 times it. */
const HAZE_LOST = 1;
const HAZE_WASHED = 2.5;

const hourOf = (series, minutes) => Math.min(series.length - 1, Math.max(0, Math.floor(minutes / 60)));

/**
 * The sky a forecast day (`cloudsFor` in weather.js) gives at a minute after midnight: the
 * three cloud layers and the sight, between the hours, and that hour's chance of rain.
 */
export function skyAt(day, minutes) {
  return { ...cloudsAt(day, minutes), vis: visibilityAt(day, minutes), rain: day.rain.prob[hourOf(day.rain.prob, minutes)] ?? 0 };
}

/**
 * The low cloud 60 to 220 km out in a direction, 0 to 1, or null when the forecast does not
 * look that way: it holds the horizon toward sunrise and toward sunset only.
 */
export function horizonLowToward(day, azDeg, minutes) {
  for (const which of ['rise', 'set']) {
    const event = day[which];
    const series = (which === 'rise' ? day.riseHorizon : day.setHorizon)?.low;
    if (!event || !series) continue;
    const off = Math.abs(((azDeg - event.az + 540) % 360) - 180);
    if (off <= HORIZON_SPREAD_DEG) return series[hourOf(series, minutes)] ?? null;
  }
  return null;
}

/**
 * The sky for a shot: Berlin's at that minute, the body's altitude, and, for a low body, the
 * low cloud toward it (null when the forecast does not look that way). `distanceM` is how far
 * the landmark stands from the photographer.
 */
export function shotSky(day, from, t, { body = 'sun', distanceM = null } = {}) {
  const minutes = (t - from) / 60_000;
  const at = sampleBody(body, new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);
  const sky = { ...skyAt(day, minutes), altDeg: at.alt, distanceM };
  if (at.alt < LOW_BODY_DEG) sky.horizonLow = horizonLowToward(day, at.az, minutes);
  return sky;
}

/**
 * The one grade: `{ grade, reason, colour, horizonChecked }` for a sky of `low`, `mid`, `high`
 * cloud (0 to 1), `vis` sight in metres, `rain` chance, and, when known, the body's `altDeg`,
 * the `horizonLow` cloud toward it and the shot's `distanceM`. `colour` says the clouds above
 * may catch the low sun's colour: a note beside the verdict, never a second grade.
 */
export function assess({ low, mid, high, vis = 24_000, rain = 0, altDeg = null, horizonLow, distanceM = null }) {
  const overhead = Math.max(low * CLOUD_WEIGHT.low, mid * CLOUD_WEIGHT.mid, high * CLOUD_WEIGHT.high);
  const lowBody = altDeg !== null && altDeg < LOW_BODY_DEG;
  const horizon = lowBody && typeof horizonLow === 'number' ? horizonLow : 0;
  const hidden = Math.max(overhead, horizon);
  const lost = distanceM ? distanceM * HAZE_LOST : 3000;
  const washed = distanceM ? distanceM * HAZE_WASHED : 9000;
  const haze = vis < 1000 ? 'fog' : vis < lost ? 'lost' : vis < washed ? 'washed' : '';
  const wet = rain >= 0.6;
  const horizonChecked = !lowBody || typeof horizonLow === 'number';

  let grade = 'good';
  if (hidden > 0.75 || haze === 'fog' || haze === 'lost') grade = 'poor';
  else if (hidden > 0.5 || haze === 'washed' || wet) grade = 'fair';

  let reason;
  if (grade === 'poor') {
    if (haze === 'fog') reason = 'fog';
    else if (haze === 'lost' && hidden <= 0.75) reason = 'thick haze';
    else if (wet) reason = 'rain likely';
    else if (horizon > 0.75 && horizon > overhead) reason = 'horizon cloud';
    else reason = low > 0.6 ? 'low cloud' : 'overcast';
  } else if (grade === 'fair') {
    if (hidden <= 0.5 && haze === 'washed') reason = 'hazy';
    else if (wet) reason = 'rain likely';
    else if (horizon > 0.5 && horizon > overhead) reason = 'horizon cloud';
    else reason = 'mixed cloud';
  } else if (!horizonChecked) reason = 'clear here';
  else if (Math.max(low, mid, high) < 0.1) reason = 'clear light';
  // Thin high cloud with nothing under it is what catches the colour.
  else if (high >= 0.2 && Math.max(low, mid) < 0.2) reason = 'high cloud';
  else reason = 'light cloud';

  const canvas = Math.max(mid, high);
  const colour = grade !== 'poor' && altDeg !== null && altDeg < 6 && canvas > 0.2 && canvas < 0.8 && low < 0.5;
  return { grade, reason, colour, horizonChecked };
}

/** The grade alone. */
export const gradeSky = (sky) => assess(sky).grade;

/**
 * The verdict for a sky, or for none: `{ grade, word, reason, label, colour, horizonChecked }`.
 * Without a forecast the grade is null and the label says which kind of nothing it is.
 */
export function verdict(sky, missing = 'No forecast yet') {
  if (!sky) return { grade: null, word: missing, reason: '', label: missing, colour: false, horizonChecked: true };
  const { grade, reason, colour, horizonChecked } = assess(sky);
  const word = VERDICT_WORD[grade];
  return { grade, word, reason, label: `${word} · ${reason}`, colour, horizonChecked };
}

/** What a verdict leaves unsaid in two words, for a tooltip or a detail line; '' when nothing. */
export function verdictNote(v) {
  if (!v || v.grade === null || v.grade === 'past') return '';
  if (!v.horizonChecked) return 'the forecast does not cover the horizon toward this low moon or sun';
  return v.colour ? 'clouds above may catch the colour' : '';
}

/** A shot whose minute is behind us. */
export const PASSED = { grade: 'past', word: 'Passed', reason: '', label: 'Passed', colour: false, horizonChecked: true };

/**
 * The verdict for a shot at instant `t` on the day starting at `from`: passed, or the sky's,
 * or which kind of no-forecast it is (`missing`). `body` and `distanceM` are the shot's: which
 * disc, and how far away the landmark stands.
 */
export function shotVerdict(day, from, t, { body = 'sun', distanceM = null, now = null, missing } = {}) {
  if (now !== null && t < now) return PASSED;
  return verdict(day ? shotSky(day, from, t, { body, distanceM }) : null, missing);
}

/** Time until an instant, short: "in 12 min", "in 1 h 46 min", "in 2 days", "now". */
export function countdown(t, now) {
  const minutes = Math.round((t - now) / 60_000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 24 * 60) {
    const rest = minutes % 60;
    return `in ${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''}`;
  }
  const days = Math.round(minutes / (24 * 60));
  return `in ${days} day${days === 1 ? '' : 's'}`;
}
