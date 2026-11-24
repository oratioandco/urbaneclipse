/**
 * Berlin wall-clock arithmetic for the planner's clock. Pure: no DOM, testable in Node.
 *
 * The `#time` slider holds minutes on the Berlin wall clock (17:50 is 1070), and a Berlin day
 * is 23 or 25 hours long when the clocks change. So "midnight plus the slider's minutes" is
 * not the instant: on 28 March 2027 the hour from 02:00 does not exist, and on 31 October
 * 2027 the hour from 02:00 happens twice. Everything that turns the slider into an instant,
 * or an instant into a slider position, goes through here.
 */
const ZONE = 'Europe/Berlin';
const parts = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

// The offset changes on the hour at most; asking Intl every frame showed in profiles.
const offsets = new Map();
/** Berlin's offset from UTC at an instant, in minutes: 60 in winter, 120 in summer. */
export function berlinOffsetMinutes(t) {
  const hour = Math.floor(t / 3_600_000);
  let offset = offsets.get(hour);
  if (offset === undefined) {
    const p = {};
    for (const part of parts.formatToParts(new Date(hour * 3_600_000))) if (part.type !== 'literal') p[part.type] = Number(part.value);
    offset = (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - hour * 3_600_000) / 60_000;
    offsets.set(hour, offset);
  }
  return offset;
}

const utcMidnight = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/**
 * The instant (ms) of a wall-clock time on a Berlin day (yyyy-mm-dd), in minutes after
 * midnight; fractions are seconds.
 *
 * An hour that happens twice (02:00 to 03:00 when the clocks go back) gives its first
 * occurrence, in summer time, unless `later` asks for the second. A time that does not exist
 * (02:00 to 03:00 when the clocks go forward) gives the instant that long after 02:00, which
 * the clock shows as 03:00 and on; `wallMinutesOf` of the result says what it reads.
 */
export function wallToInstant(day, minutes, later = false) {
  const wall = utcMidnight(day) + minutes * 60_000;
  // The offsets in force around that time: the same twice, except across a clock change.
  const before = berlinOffsetMinutes(wall - 86_400_000);
  const after = berlinOffsetMinutes(wall + 86_400_000);
  if (before === after) return wall - before * 60_000;
  const first = wall - Math.max(before, after) * 60_000;
  const second = wall - Math.min(before, after) * 60_000;
  const firstHolds = berlinOffsetMinutes(first) === Math.max(before, after);
  const secondHolds = berlinOffsetMinutes(second) === Math.min(before, after);
  if (firstHolds && secondHolds) return later ? second : first;
  if (firstHolds) return first;
  // Either only the second reading holds, or neither does: the hour the clocks skip.
  return second;
}

/**
 * What the Berlin clock reads at an instant, in minutes after the midnight that starts `day`
 * (so below 0 or from 1440 on for an instant on another day).
 */
export function wallMinutesOf(day, t) {
  return (t + berlinOffsetMinutes(t) * 60_000 - utcMidnight(day)) / 60_000;
}

/** Whether an instant is the second time the Berlin clock shows that reading (clocks gone back). */
export function isLaterReading(day, t) {
  const minutes = wallMinutesOf(day, t);
  return wallToInstant(day, minutes, false) !== t && wallToInstant(day, minutes, true) === t;
}

/** Whether the Berlin clock skips this wall-clock time on this day (clocks gone forward). */
export function isSkipped(day, minutes) {
  return Math.abs(wallMinutesOf(day, wallToInstant(day, minutes)) - minutes) > 1e-6;
}

/** Midnight that starts a Berlin day, as an instant (ms). */
export function berlinDayStart(day) {
  return wallToInstant(day, 0);
}

/** Midnight that ends a Berlin day: 23, 24 or 25 hours after it starts. */
export function berlinDayEnd(day) {
  return wallToInstant(new Date(utcMidnight(day) + 86_400_000).toISOString().slice(0, 10), 0);
}

/** The day to open at: `asked` when it is a real yyyy-mm-dd, else `fallback` (today). */
export function startDate(asked, fallback) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asked ?? '')) return fallback;
  const t = Date.parse(`${asked}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === asked ? asked : fallback;
}
