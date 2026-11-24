/**
 * The home grid's logic: which three days, which shots are still to come, which are worth
 * taking, which one is next, and what an empty day says. Pure: no DOM, testable in Node.
 *
 * A "rated" shot is `{ shot, verdict }`: a row of `dayShots` (shots.js) and what `shotVerdict`
 * (src/miniature/verdict.js) says of it. A verdict's grade is 'good' (Go), 'fair' (Maybe),
 * 'poor' (Skip) or null (no forecast). Skip is hidden until asked for; a shot without a
 * forecast is shown, since nothing says it is not worth taking.
 */
import { shotKey, withoutContinued } from '../miniature/dayShots.js';
import { berlinDayStart, wallMinutesOf } from '../miniature/berlinClock.js';

export const DAYS = 3;
const ZONE = 'Europe/Berlin';

/** The Berlin date of an instant, as 2026-11-24. */
export const berlinDate = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: ZONE });

/** The date `n` days after a date, both as 2026-11-24. */
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * A fixed "now" from the address, for testing, or null: `?now=2027-06-21T05:30` is that time
 * on the Berlin clock; with a zone (`Z`, `+02:00`) or as milliseconds it is that instant.
 */
export function parseNow(search) {
  const value = new URLSearchParams(search).get('now');
  if (!value) return null;
  if (/^\d{11,}$/.test(value)) return Number(value);
  const wall = value.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{1,2}):(\d{2}))?$/);
  if (wall) return berlinDayStart(wall[1]) + (Number(wall[2] ?? 12) * 60 + Number(wall[3] ?? 0)) * 60_000;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** Today, tomorrow and the day after on the Berlin calendar: date, bounds, and its names. */
export function threeDays(now) {
  const today = berlinDate(now);
  return Array.from({ length: DAYS }, (_, i) => {
    const date = addDays(today, i);
    const from = berlinDayStart(date);
    const weekday = new Date(from + 43_200_000).toLocaleDateString('en-GB', { timeZone: ZONE, weekday: 'long' });
    return { i, date, from, to: berlinDayStart(addDays(date, 1)), weekday, name: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekday };
  });
}

// A list of days side by side drops the midnight repeat of a pass: the rule is the planner's too.
export { withoutContinued };

/** Whether a rated shot is worth taking: anything but Skip. */
export const worthTaking = (rated) => rated.verdict?.grade !== 'poor';

/**
 * One day of the grid: its shots still to come, in time order, split into those worth taking
 * and those skipped, with the counts for its heading. `rate(shot)` gives the verdict.
 */
export function groupDay(day, shots, rate, now) {
  const all = shots
    .filter((shot) => shot.t > now && shot.t >= day.from && shot.t < day.to)
    .sort((a, b) => a.t - b.t)
    .map((shot) => ({ shot, verdict: rate(shot) }));
  const worth = all.filter(worthTaking);
  const skipped = all.filter((r) => !worthTaking(r));
  const count = (grade) => all.filter((r) => (r.verdict?.grade ?? null) === grade).length;
  return {
    ...day,
    // How many line up on the day at all, passed ones included: tells "none left" from "none".
    lined: shots.filter((shot) => shot.t >= day.from && shot.t < day.to).length,
    all,
    worth,
    skipped,
    counts: { go: count('good'), maybe: count('fair'), skipped: skipped.length, unrated: count(null) },
  };
}

/** The next shot worth taking across the days, or null. */
export function nextWorth(groups) {
  return groups.flatMap((g) => g.worth.map((r) => ({ ...r, day: g }))).sort((a, b) => a.shot.t - b.shot.t)[0] ?? null;
}

/** Words joined as a list: "rain likely", "rain likely and overcast", "fog, haze and overcast". */
const listed = (words) => (words.length < 3 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

/** Why a day's skipped shots are skipped, each reason once, the commonest first. */
export function skipReasons(group) {
  const tally = new Map();
  for (const r of group.skipped) if (r.verdict?.reason) tally.set(r.verdict.reason, (tally.get(r.verdict.reason) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1]).map(([reason]) => reason);
}

/** A day's heading, small print: "2 go · 1 maybe · 3 skipped". */
export function countsLine(group) {
  const { go, maybe, skipped, unrated } = group.counts;
  const parts = [[go, 'go'], [maybe, 'maybe'], [unrated, unrated === 1 ? 'shot, no forecast' : 'shots, no forecast'], [skipped, 'skipped']];
  return parts.filter(([n]) => n).map(([n, word]) => `${n} ${word}`).join(' · ');
}

/**
 * What a day says beside or in place of its cards, or null when every shot is shown:
 * `{ text, hidden }`, `hidden` the number of skipped shots a tap would show.
 */
export function dayLine(group, showSkipped = false) {
  if (!group.all.length) {
    const text = group.lined ? `No shots left ${group.i === 0 ? 'today' : 'on this day'}.` : 'Nothing lines up on this day.';
    return { text, hidden: 0 };
  }
  if (showSkipped || !group.skipped.length) return null;
  const why = listed(skipReasons(group));
  const hidden = group.skipped.length;
  if (!group.worth.length) return { text: `Nothing worth shooting${why ? `: ${why}` : ''}.`, hidden };
  return { text: `${hidden} more hidden${why ? `: ${why}` : ''}.`, hidden };
}

/**
 * The answer to "is anything worth shooting in the next three days?", in a sentence.
 * `forecast` is 'ok', 'loading' or 'failed' for the three days together.
 */
export function answer(groups, forecast = 'ok') {
  const total = groups.reduce((sum, g) => sum + g.all.length, 0);
  if (!total) return 'Nothing lines up in the next three days.';
  if (forecast === 'loading') return `${total} ${total === 1 ? 'shot lines' : 'shots line'} up in the next three days. Checking the forecast…`;
  const rated = groups.reduce((sum, g) => sum + g.counts.go + g.counts.maybe + g.counts.skipped, 0);
  if (!rated) return `${total} ${total === 1 ? 'shot lines' : 'shots line'} up in the next three days. No forecast, so no verdict.`;
  const go = groups.reduce((sum, g) => sum + g.counts.go, 0);
  const maybe = groups.reduce((sum, g) => sum + g.counts.maybe, 0);
  if (!go && !maybe) {
    const why = listed(skipReasons({ skipped: groups.flatMap((g) => g.skipped) }).slice(0, 3));
    return `Nothing worth shooting in the next three days${why ? `: ${why}` : ''}.`;
  }
  const days = groups.filter((g) => g.counts.go + g.counts.maybe > 0).map((g) => (g.i < 2 ? g.name.toLowerCase() : `on ${g.name}`));
  const what = [go ? `${go} go` : '', maybe ? `${maybe} maybe` : ''].filter(Boolean).join(', ');
  return `Yes: ${what}, ${days.length === DAYS ? 'on all three days' : listed(days)}.`;
}

/**
 * The address that opens a shot in `/plan/`: its day, its time on the Berlin clock (minutes,
 * to five seconds, as the planner writes its own links), and the standing point with the
 * look and the lens, which the planner opens at eye level (src/miniature/link.js).
 */
export function planLink(shot) {
  const t = shot.openAt ?? shot.t;
  const date = berlinDate(t);
  const time = String(Math.round(wallMinutesOf(date, t) * 12) / 12).replace(/(\.\d{3})\d+$/, '$1');
  let query = `date=${date}&time=${time}`;
  if (shot.at && shot.look) {
    const heading = Math.round((((shot.look[0] % 360) + 360) % 360) * 10) / 10;
    query += `&at=${shot.at[0].toFixed(6)},${shot.at[1].toFixed(6)}&look=${heading},${Math.round(shot.look[1] * 10) / 10}&lens=${Math.round(shot.lens ?? 50)}&cam=ff`;
  }
  // Which shot it is, so the planner opens it as its own card would (link.js): it searches for
  // a clear spot and shows the shot's card. `at` and `look` stay, for a planner that finds no such row.
  if (shot.kind) query += `&shot=${encodeURIComponent(shotKey(shot)).replace(/%3A/g, ':').replace(/%20/g, '+')}`;
  return `/plan/?${query}`;
}

/** The address that opens a day in `/plan/`, at noon. */
export const dayLink = (date) => `/plan/?date=${date}&time=720`;
