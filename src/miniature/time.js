/**
 * Times as the viewer's own locale writes them: 17:50 or 5:50 PM. Always Berlin time, since
 * the light and the city are Berlin's wherever the viewer is.
 */
export const uses12h = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 === true;

const clock = new Intl.DateTimeFormat(undefined, { hour: uses12h ? 'numeric' : '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
const dayClock = new Intl.DateTimeFormat(undefined, { hour: uses12h ? 'numeric' : '2-digit', minute: '2-digit', timeZone: 'UTC' });
const dayClockSeconds = new Intl.DateTimeFormat(undefined, { hour: uses12h ? 'numeric' : '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
const hourOnly = new Intl.DateTimeFormat(undefined, { hour: uses12h ? 'numeric' : '2-digit', timeZone: 'UTC' });

/** An instant, as a Berlin wall-clock time. */
export const formatClock = (t) => clock.format(new Date(t));
/** Minutes after local midnight, with seconds on request. */
export const formatMinutes = (minutes, seconds = false) =>
  (seconds ? dayClockSeconds : dayClock).format(new Date(Date.UTC(2000, 0, 1) + Math.round(minutes * 60) * 1000));
/** A day, short: "Mon, 22 Mar", with the year when it is not this one. Takes an instant or 2027-03-22. */
export function formatDay(day) {
  const date = typeof day === 'string' ? new Date(`${day}T12:00:00Z`) : new Date(day);
  const part = (options) => date.toLocaleDateString('en-GB', { timeZone: 'Europe/Berlin', ...options });
  const year = part({ year: 'numeric' });
  return `${part({ weekday: 'short' })}, ${part({ day: 'numeric' })} ${part({ month: 'short' })}${Number(year) === new Date().getFullYear() ? '' : ` ${year}`}`;
}
/** A whole hour, short: 07 or 7 AM. */
export const formatHour = (hour) => hourOnly.format(new Date(Date.UTC(2000, 0, 1, hour))).replace(/\s?Uhr$/, '');

/**
 * A typed time, as people write them: 17:50, 1750, 17.50, 17:50:30, 5:50 pm, 5pm. Minutes
 * after midnight (with seconds as a fraction), or null if it cannot be read.
 */
export function parseTime(text) {
  const match = text.trim().toLowerCase().match(/^(\d{1,2})(?:[:.h\s]?(\d{2})(?:[:.](\d{2}))?)?\s*(a|p)?\.?\s*m?\.?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const second = Number(match[3] ?? 0);
  if (second > 59) return null;
  if (match[4]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (match[4] === 'p' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute + second / 60;
}
