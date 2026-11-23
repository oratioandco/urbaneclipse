/**
 * The day view's arithmetic: one day on a straight 24-hour scale. Where a minute sits, how
 * the forecast's three cloud layers blend into one band, how tall the rain bars stand, how
 * the sun and moon curves bend over the horizon, and how the row of shots lays out. Pure,
 * no DOM, so it runs under Node.
 */
export const DAY_MINUTES = 1440;
/** The slider's last value: 23:59, as the app's time input has always had it. */
export const LAST_MINUTE = 1439;

export const clampMinute = (minute) => Math.min(LAST_MINUTE, Math.max(0, minute));

/** A minute's place along the scale, 0 to 1. Straight: every hour is as wide as the next. */
export const minuteToX = (minute) => Math.min(1, Math.max(0, minute / DAY_MINUTES));
/** The minute under a pointer: `x` and the scale's `left` and `width` in the same pixels. */
export const xToMinute = (x, left, width) => clampMinute(((x - left) / width) * DAY_MINUTES);

/**
 * One band from three layers. Each layer hides the sky by its own weight (low cloud is
 * dense, high cloud thin), and layers overlap at random, so the band's strength at an hour
 * is 1 minus what gets through all three. Clear sky gives 0: the band is empty there.
 */
export const CLOUD_WEIGHT = { low: 1, mid: 0.75, high: 0.45 };
export function cloudBand({ low, mid, high }) {
  return low.map((_, h) => {
    const through = (1 - CLOUD_WEIGHT.low * low[h]) * (1 - CLOUD_WEIGHT.mid * mid[h]) * (1 - CLOUD_WEIGHT.high * high[h]);
    const strength = 1 - through;
    return strength < 0.02 ? 0 : Math.min(1, strength);
  });
}

/** Rain an hour that fills the bar; a cloudburst is no taller than steady heavy rain. */
export const RAIN_FULL_MM = 4;
/**
 * Rain bars, one per hour: `height` 0 to 1 from the amount, `strength` 0 to 1 from the
 * chance. A dry hour, or a trace under a tenth of a millimetre with a slim chance, is null.
 */
export function rainBars({ mm, prob }) {
  return mm.map((amount, h) => {
    const chance = prob[h] ?? 0;
    if (amount < 0.1 && chance < 0.5) return null;
    // A likely shower the model gives no amount for still shows, as the shortest bar.
    const height = Math.max(0.18, Math.min(1, Math.sqrt(amount / RAIN_FULL_MM)));
    return { height, strength: Math.max(0.35, Math.min(1, chance || 0.35)) };
  });
}

/** Below the horizon the curves only need to show "down": this many degrees fill the dip. */
const DIP_DEG = 18;
/** How much of the plot's height the dip under the horizon takes. */
export const DIP_SHARE = 0.26;
/**
 * A height in the sky as a place in the plot, 0 at the top and 1 at the bottom. The horizon
 * sits at `1 - DIP_SHARE`; `topAlt` degrees reaches the top. A winter day passes a low top, so
 * its low sun still draws a curve and not a flat line.
 */
export function altitudeToY(alt, topAlt) {
  const horizon = 1 - DIP_SHARE;
  if (alt >= 0) return horizon * (1 - Math.min(1, alt / topAlt));
  return horizon + DIP_SHARE * Math.min(1, -alt / DIP_DEG);
}
/** The altitude the plot's top stands for: the day's highest body, with headroom, never under 12. */
export const topAltitude = (...peaks) => Math.max(12, ...peaks) * 1.12;

/**
 * The shot row. Five cards fit a phone's width without scrolling; a wider row fits more.
 * Past what fits, the row scrolls sideways at the same card width and says how many wait.
 */
export function shotRowLayout(width, count, { gap = 6, min = 5, ideal = 76 } = {}) {
  const fits = Math.max(min, Math.floor((width + gap) / (ideal + gap)));
  const card = (width - (fits - 1) * gap) / fits;
  const scrolls = count > fits;
  return { card, gap, fits, scrolls, more: Math.max(0, count - fits) };
}

/**
 * How far the row is scrolled when it opens: the next shot first, the passed ones off to the
 * left, never past the row's end.
 */
export function shotRowScroll(index, count, { card, gap, fits }) {
  const first = Math.max(0, Math.min(index, count - fits));
  return first * (card + gap);
}

/** The first shot at or after an instant, as an index; the count when all have passed. */
export function nextShotIndex(times, now) {
  const index = times.findIndex((t) => t >= now);
  return index < 0 ? times.length : index;
}

/**
 * The shot to jump to from a minute: the nearest strictly earlier (`dir` -1) or later (+1)
 * one, or null at the day's end. Half a minute of slack, so the shot the thumb stands on
 * is not its own neighbour.
 */
export function neighbourShot(minutes, current, dir) {
  const slack = 0.5;
  const pool = minutes.filter((m) => (dir < 0 ? m < current - slack : m > current + slack));
  if (!pool.length) return null;
  return dir < 0 ? Math.max(...pool) : Math.min(...pool);
}

/** The shot the thumb stands on, within a minute, as an index, or -1. */
export function shotAt(minutes, current, within = 1) {
  let best = -1;
  minutes.forEach((m, i) => {
    if (Math.abs(m - current) <= within && (best < 0 || Math.abs(m - current) < Math.abs(minutes[best] - current))) best = i;
  });
  return best;
}

/** A glide from one minute to another: where it is after `elapsed` of `ms`, eased both ways. */
export function glideAt(from, to, elapsed, ms) {
  const raw = Math.min(1, Math.max(0, elapsed / ms));
  const eased = raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2;
  return from + (to - from) * eased;
}
