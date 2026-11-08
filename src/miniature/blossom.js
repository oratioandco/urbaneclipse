/**
 * The trees' year, pure and date-only: the season's leaf and autumn colour, which Prunus are
 * which kind, when each kind peaks, and how much of its blossom is open on a day. Three cherry
 * kinds, because they do not bloom together: the wild and orchard cherries open first, the famous
 * ornamental cherries (serrulata 'Kanzan' and friends, the Mauerweg's) follow mid-April, and the
 * bird cherries trail into May.
 *
 * The climatology windows are Berlin's average season. blossomForecast.js can replace a kind's
 * peak with one predicted from growing degree days; the window's shape then stays as it is.
 */

/** Day in milliseconds. */
const DAY = 86_400_000;

/** 1 in leaf, 0 bare: December to March bare, ramping through April and November. */
export function leafOn(date) {
  const month = date.getUTCMonth();
  const day = date.getUTCDate() / 30;
  if (month >= 4 && month <= 9) return 1;
  if (month === 3) return day;
  if (month === 10) return 1 - day;
  return 0;
}

/**
 * How far the autumn colour has come, 0 to 1: it starts showing in the last days of September,
 * is full by mid-October, and holds while the leaves fall into late November. Bloom is long over
 * by then — the two never overlap, and where they nearly would the season model favours blossom.
 */
export function autumnOn(date) {
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  if (month === 8) return day < 20 ? 0 : ((day - 20) / 10) * 0.4; // last ten days of Sep: hint at it
  if (month === 9) return day <= 15 ? 0.4 + 0.6 * (day / 15) : 1; // full gold by mid-Oct, held
  if (month === 10) return Math.max(0, 1 - (day - 10) / 20); // fading out as the leaves drop
  return 0;
}

/** Kind numbers, shared with build_trees.mjs and trees.bin's kind byte. */
export const CHERRY_EARLY = 3;
export const CHERRY_ORNAMENTAL = 4;
export const CHERRY_LATE = 5;

/**
 * Which cherry kind a tree is, from its botanical and German register names; null when it is no
 * cherry. Unspecified "Prunus spec." with a German kirsch name counts as ornamental — that is how
 * the Mauerweg's avenue trees are mostly registered.
 */
export function cherryKind(botanical, german) {
  const bot = (botanical ?? '').trim().toLowerCase();
  const de = (german ?? '').toLowerCase();
  if (/^prunus (avium|cerasifera|domestica)/.test(bot)) return CHERRY_EARLY;
  if (/^prunus (padus|serotina)/.test(bot)) return CHERRY_LATE;
  if (/^prunus/.test(bot)) return CHERRY_ORNAMENTAL;
  return /kirsch/.test(de) && !bot ? CHERRY_ORNAMENTAL : null;
}

/** Peak of each kind in Berlin's mean year, as [month, day]; the ramps hang off these. */
const CLIMATOLOGY = {
  [CHERRY_EARLY]: [3, 8],
  [CHERRY_ORNAMENTAL]: [3, 14],
  [CHERRY_LATE]: [3, 25],
};

/** Window shape per kind, in days: rise to full, hold, then fade away green. */
const SHAPES = {
  [CHERRY_EARLY]: { rise: 7, hold: 6, fade: 14 },
  [CHERRY_ORNAMENTAL]: { rise: 11, hold: 16, fade: 8 },
  [CHERRY_LATE]: { rise: 11, hold: 10, fade: 10 },
};

/** The climatology peak of a kind in a given year, as an instant. */
export function climatologyPeak(year, kind) {
  const [month, day] = CLIMATOLOGY[kind] ?? [];
  return month == null ? null : Date.UTC(year, month, day);
}

const asDay = (date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

/**
 * How much of a kind's blossom is open on the date, 0 to 1: a ramp up to its peak, a hold, and a
 * fade back to green. `peaks` — from the forecast, `{ [kind]: instant }` — moves a kind's peak;
 * without it the climatology peak applies.
 */
export function blossomAmount(date, kind, peaks) {
  const peak = peaks?.[kind] ?? climatologyPeak(date.getUTCFullYear(), kind);
  if (peak == null) return 0;
  const { rise, hold, fade } = SHAPES[kind];
  const t = asDay(date);
  if (t <= peak - rise * DAY || t >= peak + (hold + fade) * DAY) return 0;
  if (t < peak) return (t - (peak - rise * DAY)) / (rise * DAY);
  if (t <= peak + hold * DAY) return 1;
  return 1 - (t - (peak + hold * DAY)) / (fade * DAY);
}

/**
 * Approximate base-0 °C growing-degree-day sums at which each kind peaks. Calibrated on Berlin's
 * mean year (Jan ≈ 15, Feb ≈ 40, Mar ≈ 155, Apr ≈ 285 °Cd, ~10 °Cd a day in April) so the mean
 * season lands on the climatology windows; a warm or cold spring swings the real peaks a week or
 * two either way around them.
 */
export const GDD_PEAK = { [CHERRY_EARLY]: 280, [CHERRY_ORNAMENTAL]: 340, [CHERRY_LATE]: 470 };

/**
 * When a kind peaks, read off a season's growing degree days: the day the sum crosses its
 * threshold, or — while the forecast still falls short — an extrapolation at the last fortnight's
 * accumulation rate. `days` is ascending `{ t, gdd }` dailies. Returns an instant, or null.
 */
export function peakFromGdd(days, kind) {
  const threshold = GDD_PEAK[kind];
  const last = days[days.length - 1];
  if (!last) return null;
  for (const { t, gdd } of days) if (gdd >= threshold) return t;
  const a = days[Math.max(0, days.length - 14)];
  const rate = Math.max(0.5, (last.gdd - a.gdd) / Math.max(1, days.length - 1 - days.indexOf(a)));
  return last.t + ((threshold - last.gdd) / rate) * DAY;
}
