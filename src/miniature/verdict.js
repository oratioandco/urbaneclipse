/**
 * Verdicts in words. A shot's weather is never a bare coloured dot: it is "Go", "Maybe" or
 * "Skip" with the reason beside it, so the colour only backs the word up. Pure, no DOM.
 *
 * The thresholds are the plan's own grading (cloud over 75% or under 3 km of sight is poor,
 * over 50% or under 9 km fair); this file only adds the words.
 */
export const VERDICT_WORD = { good: 'Go', fair: 'Maybe', poor: 'Skip' };

/** The grade for a sky: `low`, `mid`, `high` cloud 0 to 1, `vis` sight in metres. */
export function gradeSky({ low, mid, high, vis = 24_000 }) {
  const cover = Math.max(low, mid, high);
  if (cover > 0.75 || vis < 3000) return 'poor';
  if (cover > 0.5 || vis < 9000) return 'fair';
  return 'good';
}

/** Why: the one thing about the sky that decides the grade, in two words at most. */
function reason(grade, { low, mid, high, vis = 24_000, rain = 0 }) {
  const cover = Math.max(low, mid, high);
  if (grade === 'poor') {
    if (vis < 1000) return 'fog';
    if (vis < 3000 && cover <= 0.75) return 'thick haze';
    if (rain >= 0.6) return 'rain likely';
    return low > 0.6 ? 'low cloud' : 'overcast';
  }
  if (grade === 'fair') {
    if (cover <= 0.5) return 'hazy';
    if (rain >= 0.6) return 'rain likely';
    return 'mixed cloud';
  }
  if (cover < 0.1) return 'clear light';
  // Thin high cloud with nothing under it is what catches the colour.
  if (high >= 0.2 && Math.max(low, mid) < 0.2) return 'high cloud';
  return 'light cloud';
}

/**
 * The verdict for a sky, or for none: `{ grade, word, reason, label }`. Without a forecast
 * the grade is null and the label says which kind of nothing it is.
 */
export function verdict(sky, missing = 'No forecast yet') {
  if (!sky) return { grade: null, word: missing, reason: '', label: missing };
  const grade = gradeSky(sky);
  const word = VERDICT_WORD[grade];
  const why = reason(grade, sky);
  return { grade, word, reason: why, label: `${word} · ${why}` };
}

/** A shot whose minute is behind us. */
export const PASSED = { grade: 'past', word: 'Passed', reason: '', label: 'Passed' };

/**
 * A sunrise or sunset reading (`readSky` in weather.js) as a verdict: its grade's word, and
 * its own text as the reason.
 */
export const readingVerdict = (reading) => ({
  grade: reading.grade,
  word: VERDICT_WORD[reading.grade],
  reason: reading.text,
  label: `${VERDICT_WORD[reading.grade]} · ${reading.text}`,
});

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
