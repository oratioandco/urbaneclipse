import { describe, expect, it } from 'vitest';
import { addDays, berlinDate, berlinDay, dayEndOf, daysFrom, moonOfDay, phaseStops, wallMinute, wallShare } from '../../src/miniature/dayMath.js';
import { wallToInstant } from '../../src/miniature/berlinClock.js';
import { shotSky } from '../../src/miniature/verdict.js';

// The two days of 2027 on which Berlin's clocks change. 28 March: 02:00 CET becomes 03:00
// CEST, a 23-hour day. 31 October: 03:00 CEST becomes 02:00 CET, a 25-hour day. (EU summer
// time: last Sunday of March and of October, at 01:00 UTC.)
const SPRING = '2027-03-28';
const AUTUMN = '2027-10-31';
const HOUR = 3_600_000;

describe('Berlin days for the panel', () => {
  it('gives each day its own length', () => {
    expect((berlinDay(SPRING).to - berlinDay(SPRING).from) / HOUR).toBe(23);
    expect((berlinDay(AUTUMN).to - berlinDay(AUTUMN).from) / HOUR).toBe(25);
    expect((berlinDay('2027-06-10').to - berlinDay('2027-06-10').from) / HOUR).toBe(24);
    // 27 March starts at 23:00 UTC on the 26th (CET), 29 March at 22:00 UTC on the 28th (CEST).
    expect(new Date(berlinDay('2027-03-27').from).toISOString()).toBe('2027-03-26T23:00:00.000Z');
    expect(new Date(berlinDay('2027-03-29').from).toISOString()).toBe('2027-03-28T22:00:00.000Z');
  });
  it('steps three days across a change without drifting an hour', () => {
    const days = daysFrom('2027-03-27', 3);
    expect(days.map((d) => d.date)).toEqual(['2027-03-27', SPRING, '2027-03-29']);
    for (let i = 1; i < days.length; i++) expect(days[i].from).toBe(days[i - 1].to);
    // Adding 24 hours twice to the first midnight, as the panel used to, lands at 01:00.
    expect(days[2].from).not.toBe(days[0].from + 48 * HOUR);
    const autumn = daysFrom('2027-10-30', 3);
    for (let i = 1; i < autumn.length; i++) expect(autumn[i].from).toBe(autumn[i - 1].to);
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
  });
  it('places a shot on the timeline at the minute the clock reads: 28 March 2027, 19:35', () => {
    // The audit's case (defect 1): a shot at 19:35 CEST, 17:35 UTC.
    const t = Date.UTC(2027, 2, 28, 17, 35);
    expect(berlinDate(t)).toBe(SPRING);
    expect(wallMinute(t)).toBe(19 * 60 + 35);
    // Minutes elapsed since midnight, the old arithmetic, is an hour short.
    expect((t - berlinDay(SPRING).from) / 60_000).toBe(18 * 60 + 35);
    expect(wallShare(t)).toBeCloseTo((19 * 60 + 35) / 1440, 9);
    // And back: the thumb at 19:35 is that instant.
    expect(wallToInstant(SPRING, 19 * 60 + 35)).toBe(t);
    expect(dayEndOf(t)).toBe(berlinDay(SPRING).to);
  });
  it('places a shot on the timeline at the minute the clock reads: 31 October 2027, 16:40', () => {
    // The audit's second case: 16:40 CET, 15:40 UTC, on the 25-hour day.
    const t = Date.UTC(2027, 9, 31, 15, 40);
    expect(berlinDate(t)).toBe(AUTUMN);
    expect(wallMinute(t)).toBe(16 * 60 + 40);
    expect((t - berlinDay(AUTUMN).from) / 60_000).toBe(17 * 60 + 40);
    expect(wallToInstant(AUTUMN, 16 * 60 + 40)).toBe(t);
  });
  it('reads the forecast at the wall-clock hour on both days', () => {
    const hours = (v: (h: number) => number) => Array.from({ length: 24 }, (_, h) => v(h));
    // Cloud only in the hour from 19:00: a 19:35 shot must see it, an 18:35 one must not.
    const day = { berlin: { low: hours((h) => (h === 19 ? 1 : 0)), mid: hours(() => 0), high: hours(() => 0) }, vis: hours(() => 24_000), rain: { prob: hours((h) => (h === 19 ? 1 : 0)), mm: hours(() => 0) } };
    for (const date of [SPRING, AUTUMN]) {
      const { from } = berlinDay(date);
      expect(shotSky(day, from, wallToInstant(date, 19 * 60 + 35)).rain, date).toBe(1);
      expect(shotSky(day, from, wallToInstant(date, 18 * 60 + 35)).rain, date).toBe(0);
    }
  });
  it('lays the light bar along the clock, so sunset sits under its hour on a 23-hour day', () => {
    // 28 March 2027: sunset in Berlin is about 19:35 CEST (suncalc; the golden band ends near it).
    const stops = phaseStops(SPRING);
    expect(stops[0].at).toBe(0);
    expect(stops.at(-1)!.at).toBeCloseTo(1, 6);
    for (let i = 1; i < stops.length; i++) expect(stops[i].at).toBeGreaterThanOrEqual(stops[i - 1].at);
    const lastDay = stops.filter((s) => s.phase === 'day').at(-1)!;
    // Full daylight ends between 18:00 and 19:30 by the clock, not an hour earlier.
    expect(lastDay.at * 24).toBeGreaterThan(18);
    expect(lastDay.at * 24).toBeLessThan(19.5);
  });
});

describe('the moon header', () => {
  it('finds the moonrise at 00:18 on 27 March 2027 that the UTC day misses', () => {
    // The audit's case (defect 13): moonrise 00:18 CET, which is 23:18 UTC on the 26th.
    const { rise } = moonOfDay('2027-03-27');
    expect(rise).not.toBeNull();
    const clock = new Date(rise!).toLocaleTimeString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
    expect(clock).toBe('00:18');
  });
  it('keeps rise and set inside the Berlin day', () => {
    for (const date of ['2027-01-14', '2027-03-27', SPRING, AUTUMN, '2027-06-10']) {
      const { from, to } = berlinDay(date);
      const { rise, set } = moonOfDay(date);
      for (const t of [rise, set]) if (t !== null) expect(t >= from && t < to, `${date} ${new Date(t).toISOString()}`).toBe(true);
    }
    // 14 January 2027: the set suncalc reports for that UTC day is 00:01 on the 15th in Berlin.
    expect(moonOfDay('2027-01-14').set).toBeNull();
  });
});
