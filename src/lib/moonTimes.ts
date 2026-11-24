/**
 * Moonrise and moonset inside a stretch of time, such as a Berlin calendar day. Pure.
 *
 * suncalc's `getMoonTimes` scans the UTC calendar day of the date it is given, which in
 * Berlin runs from 01:00 to 01:00 (02:00 to 02:00 in summer). Asked for "today" it therefore
 * misses a rise or set in the first hour or two after local midnight, and can report one
 * that belongs to tomorrow (audit defect 13: 27 March 2027, moonrise 00:18 Berlin time).
 * This asks suncalc for every UTC day the stretch touches and keeps what falls inside it.
 */
import { getMoonTimes } from 'suncalc';

export interface MoonTimes {
  /** The first moonrise in the stretch, if there is one. */
  rise?: Date;
  /** The first moonset in the stretch, if there is one. */
  set?: Date;
  /** Every rise and set in the stretch, in order (a 25-hour day can hold two of one kind). */
  rises: Date[];
  sets: Date[];
}

const DAY_MS = 86_400_000;

/** Moonrise and moonset with `from <= t < to` (instants in ms), seen from a place. */
export function moonTimesBetween(from: number, to: number, lat: number, lon: number): MoonTimes {
  const rises: Date[] = [];
  const sets: Date[] = [];
  const keep = (list: Date[], when: Date | null | undefined) => {
    if (!when) return;
    const t = when.getTime();
    // Neighbouring UTC days can each report an event that falls on their shared midnight.
    if (Number.isFinite(t) && t >= from && t < to && !list.some((d) => Math.abs(d.getTime() - t) < 60_000)) list.push(when);
  };
  for (let day = Math.floor(from / DAY_MS) * DAY_MS; day < to; day += DAY_MS) {
    const times = getMoonTimes(new Date(day), lat, lon);
    keep(rises, times.rise);
    keep(sets, times.set);
  }
  rises.sort((a, b) => a.getTime() - b.getTime());
  sets.sort((a, b) => a.getTime() - b.getTime());
  return { rise: rises[0], set: sets[0], rises, sets };
}
