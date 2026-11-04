/**
 * Berlin wall-clock helpers. Pure, no Cesium.
 *
 * The store carries absolute instants; everything a photographer reads is local time.
 * Days are Berlin calendar days, which are 23 or 25 hours long at the DST changes, so
 * "midnight" has to be resolved through the time zone rather than by adding 24 hours.
 */
const ZONE = 'Europe/Berlin';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});
const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const longDayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** A Berlin calendar day as "YYYY-MM-DD". */
export type BerlinDay = string;

function wallClock(d: Date): { y: number; mo: number; da: number; h: number; mi: number; s: number } {
  const p: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(d)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { y: p.year, mo: p.month, da: p.day, h: p.hour, mi: p.minute, s: p.second };
}

/** The Berlin calendar day containing an instant. */
export function berlinDayOf(d: Date): BerlinDay {
  const { y, mo, da } = wallClock(d);
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

/** The instant of Berlin wall-clock time `minutes` after midnight on `day`. */
function instantAt(day: BerlinDay, minutes: number): Date {
  const [y, mo, da] = day.split('-').map(Number);
  const utcGuess = Date.UTC(y, mo - 1, da, 0, minutes);
  // Two passes settle the offset even when the guess falls across a DST change.
  let t = utcGuess;
  for (let i = 0; i < 2; i++) {
    const w = wallClock(new Date(t));
    t -= Date.UTC(w.y, w.mo - 1, w.da, w.h, w.mi, w.s) - utcGuess;
  }
  return new Date(t);
}

/** The instant of a Berlin wall-clock hour on a given day. */
export function berlinInstant(day: BerlinDay, hour: number): Date {
  return instantAt(day, hour * 60);
}

/** Start (inclusive) and end (exclusive) instants of a Berlin calendar day. */
export function berlinDayBounds(day: BerlinDay): { start: Date; end: Date } {
  return { start: instantAt(day, 0), end: instantAt(shiftDay(day, 1), 0) };
}

/** Move a Berlin calendar day by whole days. */
export function shiftDay(day: BerlinDay, delta: number): BerlinDay {
  const [y, mo, da] = day.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, da + delta)).toISOString().slice(0, 10);
}

/** "15:20" */
export function formatTime(d: Date): string {
  return timeFormatter.format(d);
}

/** "Wed, 4 Nov" */
export function formatDay(d: Date): string {
  return dayFormatter.format(d);
}

/** "Wed, 4 Nov 2026" */
export function formatLongDay(d: Date): string {
  return longDayFormatter.format(d);
}
