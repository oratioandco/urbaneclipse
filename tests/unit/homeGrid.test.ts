import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { addDays, answer, berlinDate, countsLine, dayLine, groupDay, nextWorth, parseNow, planLink, skipReasons, threeDays, withoutContinued } from '../../src/home/grid.js';
import { collectRows, computeDayPaths, dayShots, findShot, shotKey, streetStatus } from '../../src/miniature/dayShots.js';
import { decodeStreets, streetMoments } from '../../src/lib/streets';
import { FERNSEHTURM } from '../../src/lib/landmarks';
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
  it('drops a row at midnight that only continues the evening before', () => {
    const evening = [
      { t: tomorrow.from - 45 * 60_000, until: tomorrow.from, kind: 'tower', body: 'moon', short: 'TV antenna' },
      { t: tomorrow.from - 2 * 60_000, until: tomorrow.from - 60_000, kind: 'street', body: 'moon', short: 'Seestraße' },
    ];
    const morning = [
      { t: tomorrow.from, kind: 'tower', body: 'moon', short: 'TV antenna' },
      { t: tomorrow.from, kind: 'street', body: 'moon', short: 'Seestraße' },
      { t: tomorrow.from, kind: 'street', body: 'moon', short: 'Sonnenallee' },
      { t: tomorrow.from + 5 * HOUR, kind: 'tower', body: 'moon', short: 'TV antenna' },
    ];
    expect(withoutContinued(morning, tomorrow.from, evening).map((r) => `${(r.t - tomorrow.from) / HOUR} ${r.short}`)).toEqual(['0 Sonnenallee', '5 TV antenna']);
    // With no evening before it, a pass that starts at midnight is a shot of its own.
    expect(withoutContinued(morning, tomorrow.from)).toHaveLength(4);
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
    expect(answer(groups(['g'], ['p'], ['f']))).toBe('Yes: 1 go, 1 maybe, today and on Thursday.');
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
      expect(planLink(row)).toMatch(/^\/plan\/\?date=2026-11-2[56]&time=[\d.]+&at=52\.\d{6},13\.\d{6}&look=[\d.]+,[\d.]+&lens=\d+&cam=ff&shot=(sphere-(sun|moon)|antenna-moon|street-(sun|moon):[^&]+)$/);
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

describe('one row logic for the planner and the home page', () => {
  const read = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');
  it('is one module, free of three.js and of the planner\u2019s DOM', () => {
    const source = read('miniature/dayShots.js');
    expect(source).not.toMatch(/from 'three'|document\.|from '\.\/(plan|daylist|pointer|chrome|eye|clock)\.js'/);
    // The planner's rows are these rows, with `go` added; home has no copy of its own.
    expect(read('miniature/daylist.js')).toMatch(/import \{ collectRows as collectShots \} from '\.\/dayShots\.js'/);
    expect(read('miniature/plan.js')).toMatch(/from '\.\/dayShots\.js'/);
    expect(read('home/home.js')).toMatch(/from '\.\.\/miniature\/dayShots\.js'/);
    expect(() => read('home/shots.js')).toThrow();
  });
  it('is the list `/map` shows too, and the same whatever order the street moments come in', () => {
    // Finding 6 of the adversarial test: `/map` had a list of its own (`dayHighlights`).
    const map = read('components/react/daily/TodayScreen.tsx');
    expect(map).toMatch(/import \{ collectRows, computeDayPaths[^}]*\} from '\.\.\/\.\.\/\.\.\/miniature\/dayShots\.js'/);
    expect(map).not.toMatch(/dayHighlights/);
    // 24 November 2026: Weserstraße's two directions are equally long, the moon down one at
    // 07:34 and the sun down the other at 08:09. Which of them is among the twelve kept must not
    // depend on whether the moments arrive by time (`/plan/`) or sun first (`/map`, home).
    const views = decodeStreets(JSON.parse(readFileSync(new URL('../../public/streets/berlin.json', import.meta.url), 'utf8')));
    const from = berlinDayStart('2026-11-24');
    const { lat, lon } = FERNSEHTURM;
    const all = [...streetMoments(views, 'sun', from, from + 24 * HOUR, lat, lon), ...streetMoments(views, 'moon', from, from + 24 * HOUR, lat, lon)];
    const names = (moments: typeof all) => collectRows([], moments, from, { tower: false }).map((r: { t: number; title: string }) => `${r.t} ${r.title}`);
    const byTime = names([...all].sort((x, y) => x.peak - y.peak));
    expect(byTime.length).toBe(12);
    expect(names(all)).toEqual(byTime);
    expect(names([...all].reverse())).toEqual(byTime);
  });
  it('names a shot in a link and finds its row again', () => {
    const sphere = { kind: 'tower', where: 'sphere', body: 'sun', short: 'TV tower', t: 1000 * 3_600_000 };
    const later = { ...sphere, t: 1008 * 3_600_000 };
    const antenna = { kind: 'tower', where: 'antenna', body: 'moon', short: 'TV antenna', t: 1001 * 3_600_000, openAt: 1001.5 * 3_600_000 };
    const street = { kind: 'street', body: 'sun', short: 'An der Wuhlheide', t: 1002 * 3_600_000 };
    expect([sphere, antenna, street].map(shotKey)).toEqual(['sphere-sun', 'antenna-moon', 'street-sun:An der Wuhlheide']);
    const rows = [sphere, antenna, street, later];
    // A tower shot can come twice a day: the link's time says which.
    expect(findShot(rows, 'sphere-sun', sphere.t + 60_000)).toBe(sphere);
    expect(findShot(rows, 'sphere-sun', later.t - 60_000)).toBe(later);
    // The antenna opens at the middle of its stretch, not at its start.
    expect(findShot(rows, 'antenna-moon', antenna.openAt)).toBe(antenna);
    expect(findShot(rows, 'street-sun:An der Wuhlheide', street.t)).toBe(street);
    // No such row that day, or the wrong street, or hours away: nothing, and the link's own view opens.
    expect(findShot(rows, 'street-sun:Sonnenallee', street.t)).toBeNull();
    expect(findShot(rows, 'sphere-moon', sphere.t)).toBeNull();
    expect(findShot(rows, 'sphere-sun', sphere.t - 4 * 3_600_000)).toBeNull();
  });
  it('keeps old links as they were: no shot named, no parameter', () => {
    expect(planLink({ t: Date.UTC(2027, 5, 10, 19, 4) })).toBe('/plan/?date=2027-06-10&time=1264');
    expect(planLink({ t: Date.UTC(2027, 5, 10, 19, 4), kind: 'street', body: 'sun', short: 'Straße des 17. Juni' })).toBe('/plan/?date=2027-06-10&time=1264&shot=street-sun:Stra%C3%9Fe+des+17.+Juni');
    expect(new URLSearchParams('shot=street-sun:Stra%C3%9Fe+des+17.+Juni').get('shot')).toBe('street-sun:Straße des 17. Juni');
  });
  it('switches kinds and bodies off by flag, as the planner\u2019s layers do', () => {
    const from = Date.UTC(2026, 10, 24, 23);
    const paths = computeDayPaths(from);
    const all = collectRows(paths, [], from);
    expect(all.some((r) => r.body === 'sun')).toBe(true);
    expect(collectRows(paths, [], from, { sun: false }).some((r) => r.body === 'sun')).toBe(false);
    expect(collectRows(paths, [], from, { moon: false }).some((r) => r.body === 'moon')).toBe(false);
    expect(collectRows(paths, [], from, { tower: false })).toEqual([]);
    for (const row of all) expect(row.go).toBeUndefined();
  });
});

// Adversarial test 2026-11, finding 4: 24 December 2026, "Moonset behind the TV tower's
// antenna" was listed at 7:50 (the stretch's start) and opened at 8:20.
describe('the status line under a street shot', () => {
  // Sonnenallee on 24 November 2026: the sun stands in the street from 08:05 to 08:10 (made-up
  // bounds for the wording; the real ones come from streetMoments).
  const from = wallToInstant('2026-11-24', 8 * 60 + 5);
  const row = { kind: 'street', body: 'sun', moment: { body: 'sun', from, to: from + 5 * 60_000, peak: from + 2 * 60_000, view: { name: 'Sonnenallee' } } };
  it('speaks of the street, before, during and after', () => {
    expect(streetStatus(row, from + 60_000)).toMatchObject({ text: 'Sun down Sonnenallee now', state: 'now', jumpTo: null });
    const before = streetStatus(row, from - 20 * 60_000);
    expect(before.text).toMatch(/^Sun down Sonnenallee in 20 min \(/);
    expect(before.jumpTo).toBe(row.moment.peak);
    expect(streetStatus(row, from + 35 * 60_000).text).toMatch(/^Sun was down Sonnenallee 30 min ago \(/);
    expect(streetStatus(row, from + 5 * 3_600_000).text).toMatch(/5 h ago/);
  });
  it('has nothing to say of a tower row or of no row', () => {
    expect(streetStatus({ kind: 'tower', body: 'sun' }, from)).toBeNull();
    expect(streetStatus(null, from)).toBeNull();
  });
});

describe('antenna rows', () => {
  const from = Date.UTC(2026, 11, 23, 23);
  const rows = collectRows([], [], from).filter((r) => r.where === 'antenna');
  it('carry the minute they open at, with the stretch around it', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.t).toBe(row.openAt);
      expect(row.start).toBeLessThan(row.t);
      expect(row.until).toBeGreaterThan(row.t);
    }
    const morning = rows.find((r) => /Moonset/.test(r.title))!;
    const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
    expect(clock(morning.start)).toBe('07:50');
    expect(clock(morning.t)).toBe('08:20');
  });
  it('have passed at the stretch\u2019s end, not at its start or middle', async () => {
    const { shotVerdict, PASSED } = await import('../../src/miniature/verdict.js');
    const row = rows[0];
    const at = (now: number) => shotVerdict(null, from, row.t, { body: 'moon', now, until: row.until, missing: 'No forecast' });
    expect(at(row.t + 60_000)).not.toBe(PASSED);
    expect(at(row.until - 60_000)).not.toBe(PASSED);
    expect(at(row.until + 60_000)).toBe(PASSED);
  });
  it('are one shot across midnight in a list of days', () => {
    const evening = [{ kind: 'tower', body: 'moon', short: 'TV antenna', t: from - 20 * 60_000, start: from - 40 * 60_000, until: from }];
    const next = [{ kind: 'tower', body: 'moon', short: 'TV antenna', t: from + 30 * 60_000, start: from, until: from + 60 * 60_000 }];
    expect(withoutContinued(next, from, evening)).toEqual([]);
    expect(withoutContinued(next, from)).toHaveLength(1);
  });
});

