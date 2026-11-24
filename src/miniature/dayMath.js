/**
 * Days as Berlin has them, for the panel: a day is 23 or 25 hours long when the clocks change
 * (28 March and 31 October 2027), so nothing here adds 24 hours to a midnight or reads minutes
 * off the difference of two instants. Pure, no DOM; the clock arithmetic is berlinClock.js.
 */
import { lightBands, lightGradientStops } from '../lib/lightPhases.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { moonTimesBetween } from '../lib/moonTimes.ts';
import { berlinDayEnd, berlinDayStart, wallMinutesOf } from './berlinClock.js';

/** The Berlin date (yyyy-mm-dd) an instant falls on. */
export const berlinDate = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

/** The date `n` days after a yyyy-mm-dd. */
export const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A Berlin day: its date and the two midnights that bound it. */
export const berlinDay = (date) => ({ date, from: berlinDayStart(date), to: berlinDayEnd(date) });

/** `count` Berlin days from a date on, each with its own true length. */
export const daysFrom = (date, count) => Array.from({ length: count }, (_, i) => berlinDay(addDays(date, i)));

/** The midnight that ends the Berlin day an instant falls on. */
export const dayEndOf = (t) => berlinDayEnd(berlinDate(t));

/** What the Berlin clock reads at an instant, in minutes after that day's own midnight. */
export const wallMinute = (t, date = berlinDate(t)) => wallMinutesOf(date, t);

/** Where an instant stands on a 24-hour wall-clock scale of its day, 0 to 1. */
export const wallShare = (t, date = berlinDate(t)) => wallMinutesOf(date, t) / 1440;

/**
 * The day's light as the stops of one gradient along a wall-clock scale: `[{ phase, at }]`
 * with `at` from 0 to 1 by the clock, so a phase edge sits under the hour it happens at on a
 * 23 or 25 hour day too.
 */
export function phaseStops(date, stepMs = 300_000) {
  const { from, to } = berlinDay(date);
  return lightGradientStops(lightBands(from, to, FERNSEHTURM.lat, FERNSEHTURM.lon, stepMs), from, to).map(({ phase, at }) => ({ phase, at: Math.min(1, Math.max(0, wallShare(from + at * (to - from), date))) }));
}

/**
 * The moon's rise and set on a Berlin day, midnight to midnight: `{ rise, set }` as instants
 * or null. suncalc alone looks at the UTC day and misses a rise between Berlin's midnight and
 * 01:00 or 02:00 (27 March 2027, 00:18).
 */
export function moonOfDay(date) {
  const { from, to } = berlinDay(date);
  const times = moonTimesBetween(from, to, FERNSEHTURM.lat, FERNSEHTURM.lon);
  return { rise: times.rise ? times.rise.getTime() : null, set: times.set ? times.set.getTime() : null };
}
