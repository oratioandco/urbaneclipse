import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { addDays, answer, berlinDate, countsLine, dayLine, groupDay, nextWorth, parseNow, planLink, skipReasons, threeDays } from '../../src/home/grid.js';
import { dayShots } from '../../src/home/shots.js';
import { decodeStreets } from '../../src/lib/streets';
import { decodeViewshed } from '../../src/lib/viewshed';
import { berlinDayStart, wallToInstant } from '../../src/miniature/berlinClock.js';

const HOUR = 3_600_000;
const verdictOf = (grade: string | null, reason = '') => ({ grade, word: grade ?? 'No forecast', reason, label: reason ? `${grade} · ${reason}` : String(grade) });
/** A shot at an hour of a day, graded by a letter in its name: g, f, p or n (no forecast). */
const shotAt = (day: { from: number }, hour: number, name: string) => ({ t: day.from + hour * HOUR, body: 'sun', kind: 'street', title: name, short: name });
const GRADES: Record<string, [string | null, string]> = { g: ['good', 'clear light'], f: ['fair', 'mixed cloud'], p: ['poor', 'overcast'], r: ['poor', 'rain likely'], n: [null, ''] };
const rate = (shot: { title: string }) => verdictOf(...GRADES[shot.title[0]]);

describe('the home grid: its three days', () => {
  it('names today, tomorrow and the weekday after, on the Berlin calendar', () => {
    // 23:30 in Berlin on Tuesday 24 November 2026 is still that Tuesday there (22:30 UTC).
    const days = threeDays(Date.UTC(2026, 10, 24, 22, 30));
    expect(days.map((d) => d.date)).toEqual(['2026-11-24', '2026-11-25', '2026-11-26']);
    expect(days.map((d) => d.name)).toEqual(['Today', 'Tomorrow', 'Thursday']);
    expect(days.map((d) => d.weekday)).toEqual(['Tuesday', 'Wednesday', 'Thursday']);
    // Half an hour later it is Wednesday in Berlin, though still Tuesday in UTC.
    expect(threeDays(Date.UTC(2026, 10, 24, 23, 0))[0].date).toBe('2026-11-25');
  });
  it('gives each day its true length when the clocks change', () => {
    // 28 March 2027: the clocks go forward, the day is 23 hours long.
    const days = threeDays(wallToInstant('2027-03-27', 600));
    expect(days.map((d) => (d.to - d.from) / HOUR)).toEqual([24, 23, 24]);
    expect(days[1].to).toBe(days[2].from);
    expect(days[0].from).toBe(berlinDayStart('2027-03-27'));
  });
  it('steps dates across a month and a year', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-02-28', 2)).toBe('2027-03-02');
    expect(berlinDate(Date.UTC(2027, 5, 20, 22, 30))).toBe('2027-06-21');
  });
  it('reads a fixed now from the address: Berlin wall time, an instant, or nothing', () => {
    expect(parseNow('?now=2027-06-21T05:30')).toBe(Date.UTC(2027, 5, 21, 3, 30));
    expect(parseNow('?now=2026-11-25T14:05')).toBe(Date.UTC(2026, 10, 25, 13, 5));
    expect(parseNow('?now=2027-06-21')).toBe(Date.UTC(2027, 5, 21, 10, 0));
    expect(parseNow('?now=2027-06-21T05:30:00Z')).toBe(Date.UTC(2027, 5, 21, 5, 30));
    expect(parseNow('?now=1800000000000')).toBe(1_800_000_000_000);
    expect(parseNow('')).toBeNull();
    expect(parseNow('?now=soon')).toBeNull();
  });
});

describe('the home grid: grouping and order', () => {
  const [today, tomorrow, after] = threeDays(wallToInstant('2026-11-24', 12 * 60));
  const now = today.from + 12 * HOUR;

  it('keeps a day’s shots still to come, in time order, whatever order they arrive in', () => {
    const shots = [shotAt(today, 16, 'g late'), shotAt(today, 8, 'g passed'), shotAt(today, 13, 'f early'), shotAt(tomorrow, 9, 'g other day'), shotAt(today, 14.5, 'p middle')];
    const group = groupDay(today, shots, rate, now);
    expect(group.all.map((r) => r.shot.title)).toEqual(['f early', 'p middle', 'g late']);
    expect(group.worth.map((r) => r.shot.title)).toEqual(['f early', 'g late']);
    expect(group.skipped.map((r) => r.shot.title)).toEqual(['p middle']);
    expect(group.counts).toEqual({ go: 1, maybe: 1, skipped: 1, unrated: 0 });
    // The passed one still counts as having lined up on the day.
    expect(group.lined).toBe(4);
  });
  it('shows a shot without a forecast rather than hiding it', () => {
    const group = groupDay(tomorrow, [shotAt(tomorrow, 9, 'n one'), shotAt(tomorrow, 7, 'n two')], rate, now);
    expect(group.worth.map((r) => r.shot.title)).toEqual(['n two', 'n one']);
    expect(group.counts).toEqual({ go: 0, maybe: 0, skipped: 0, unrated: 2 });
    expect(countsLine(group)).toBe('2 shots, no forecast');
  });
  it('picks the next shot worth taking across the days, passing over skipped ones', () => {
    const groups = [
      groupDay(today, [shotAt(today, 15, 'p skip me'), shotAt(today, 9, 'g gone')], rate, now),
      groupDay(tomorrow, [shotAt(tomorrow, 17, 'g evening'), shotAt(tomorrow, 8, 'f morning')], rate, now),
      groupDay(after, [shotAt(after, 6, 'g later')], rate, now),
    ];
    const next = nextWorth(groups);
    expect(next?.shot.title).toBe('f morning');
    expect(next?.day.name).toBe('Tomorrow');
    expect(nextWorth([groupDay(today, [shotAt(today, 15, 'p only')], rate, now)])).toBeNull();
  });
  it('words a day’s heading count', () => {
    const group = groupDay(today, [shotAt(today, 13, 'g'), shotAt(today, 14, 'g'), shotAt(today, 15, 'f'), shotAt(today, 16, 'p')], rate, now);
    expect(countsLine(group)).toBe('2 go · 1 maybe · 1 skipped');
  });
});

describe('the home grid: what an empty day says', () => {
  const [today, tomorrow] = threeDays(wallToInstant('2026-11-24', 12 * 60));
  const now = today.from + 12 * HOUR;

  it('says nothing is worth shooting, and why, the commonest reason first', () => {
    const group = groupDay(tomorrow, [shotAt(tomorrow, 8, 'r'), shotAt(tomorrow, 9, 'r'), shotAt(tomorrow, 10, 'p')], rate, now);
    expect(skipReasons(group)).toEqual(['rain likely', 'overcast']);
    expect(dayLine(group)).toEqual({ text: 'Nothing worth shooting: rain likely and overcast.', hidden: 3 });
    // Once the skipped shots are shown there is nothing left to say.
    expect(dayLine(group, true)).toBeNull();
  });
  it('counts the hidden ones on a day that has shots worth taking', () => {
    const group = groupDay(tomorrow, [shotAt(tomorrow, 8, 'g'), shotAt(tomorrow, 9, 'p'), shotAt(tomorrow, 10, 'p')], rate, now);
    expect(dayLine(group)).toEqual({ text: '2 more hidden: overcast.', hidden: 2 });
  });
  it('tells a day with nothing left from a day where nothing lines up', () => {
    expect(dayLine(groupDay(today, [shotAt(today, 8, 'g')], rate, now))).toEqual({ text: 'No shots left today.', hidden: 0 });
    expect(dayLine(groupDay(tomorrow, [], rate, now))).toEqual({ text: 'Nothing lines up on this day.', hidden: 0 });
    expect(dayLine(groupDay(tomorrow, [shotAt(tomorrow, 8, 'g')], rate, now))).toBeNull();
  });
  it('answers the question for the three days in a sentence', () => {
    const [a, b, c] = threeDays(wallToInstant('2026-11-24', 12 * 60));
    const groups = (x: string[], y: string[], z: string[]) => [
      groupDay(a, x.map((n, i) => shotAt(a, 13 + i, n)), rate, now),
      groupDay(b, y.map((n, i) => shotAt(b, 8 + i, n)), rate, now),
      groupDay(c, z.map((n, i) => shotAt(c, 8 + i, n)), rate, now),
    ];
    expect(answer(groups(['g'], ['g', 'f'], ['p']))).toBe('Yes: 2 go, 1 maybe, today and tomorrow.');
    expect(answer(groups(['f'], ['g'], ['g']))).toBe('Yes: 2 go, 1 maybe, on all three days.');
    expect(answer(groups(['p'], ['r', 'r'], []))).toBe('Nothing worth shooting in the next three days: rain likely and overcast.');
    expect(answer(groups([], [], []))).toBe('Nothing lines up in the next three days.');
    expect(answer(groups(['n'], ['n'], []), 'failed')).toBe('2 shots line up in the next three days. No forecast, so no verdict.');
    expect(answer(groups(['n'], [], []), 'loading')).toBe('1 shot lines up in the next three days. Checking the forecast…');
  });
});

describe('the home grid: the link into the planner', () => {
  it('writes the day, the Berlin minute, the standing point, the look and the lens', () => {
    // 10 June 2027, 21:04 in Berlin (summer time): minute 1264, as the landing page's own example link.
    const t = Date.UTC(2027, 5, 10, 19, 4);
    expect(planLink({ t, at: [52.49225, 13.47185], look: [307.04, 2.61], lens: 400 })).toBe('/plan/?date=2027-06-10&time=1264&at=52.492250,13.471850&look=307,2.6&lens=400&cam=ff');
    // Seconds are kept to five, as the planner writes them; without a standing point, the day and time.
    expect(planLink({ t: t + 15_000 })).toBe('/plan/?date=2027-06-10&time=1264.25');
    // The planner may open at another instant than the card shows (the middle of an antenna pass).
    expect(planLink({ t, openAt: t + 20 * 60_000 })).toBe('/plan/?date=2027-06-10&time=1284');
  });
});

describe('the home grid: real shots of a day', () => {
  const header = JSON.parse(readFileSync('public/viewshed/fernsehturm.json', 'utf8'));
  const shed = decodeViewshed(header, new Uint8Array(readFileSync(`public/viewshed/${header.binary}`)));
  const views = decodeStreets(JSON.parse(readFileSync('public/streets/berlin.json', 'utf8')));
  const from = berlinDayStart('2026-11-25');
  const rows = dayShots(from, { shed, views });

  it('finds tower and street shots, in time order, each with what its card and its link need', () => {
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.map((r) => r.t)).toEqual([...rows.map((r) => r.t)].sort((a, b) => a - b));
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(['tower', 'street']));
    for (const row of rows) {
      expect(row.t).toBeGreaterThanOrEqual(from);
      expect(row.t).toBeLessThanOrEqual(from + 86_400_000);
      expect(['sun', 'moon']).toContain(row.body);
      expect(row.title && row.short && row.detail).toBeTruthy();
      expect(row.distanceM).toBeGreaterThan(0);
      expect(planLink(row)).toMatch(/^\/plan\/\?date=2026-11-2[56]&time=[\d.]+&at=52\.\d{6},13\.\d{6}&look=[\d.]+,[\d.]+&lens=\d+&cam=ff$/);
    }
    // At most twelve street views a day, each street once per body: the planner's own limit.
    const streets = rows.filter((r) => r.kind === 'street');
    expect(streets.length).toBeLessThanOrEqual(12);
    expect(new Set(streets.map((r) => r.short + r.body)).size).toBe(streets.length);
  });
  it('faces the disc at the minute it stands behind the tower', () => {
    const sphere = rows.filter((r) => r.where === 'sphere');
    expect(sphere.length).toBeGreaterThan(0);
    for (const row of sphere) {
      // The standing point is on the far side of the tower from the body: looking along `look`
      // from `at` meets the tower. Checked with the flat-earth bearing, good to a tenth of a degree here.
      const north = 52.520803 - row.at[0];
      const east = (13.40945 - row.at[1]) * Math.cos((52.52 * Math.PI) / 180);
      const bearing = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
      expect(Math.abs(((bearing - row.look[0] + 540) % 360) - 180)).toBeLessThan(0.5);
    }
  });
  it('offers no sphere shot when nothing says where the tower can be seen from', () => {
    const blind = dayShots(from, { views });
    expect(blind.some((r) => r.where === 'sphere')).toBe(false);
    expect(blind.filter((r) => r.kind === 'street')).toEqual(rows.filter((r) => r.kind === 'street'));
  });
});
