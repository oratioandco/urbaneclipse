/**
 * The /plan/ clock on the days the clocks change (audit defect 1,
 * docs/accuracy-audit-2026-11.md).
 *
 * Before: `setMinute` stored minutes elapsed since Berlin midnight and `instant()` read them
 * back as wall-clock minutes, so a shot picked on 28 March 2027 at 19:35 set the scene at
 * 18:35, and on 31 October 2027 one at 16:40 gave 17:40.
 *
 * INDEPENDENT CHECK. The EU rule: clocks go forward at 01:00 UTC on the last Sunday of March
 * (28 March 2027: 02:00 CET becomes 03:00 CEST) and back at 01:00 UTC on the last Sunday of
 * October (31 October 2027: 03:00 CEST becomes 02:00 CET). The expected instants below are
 * written out in UTC from that rule, and the sunrise, sunset and moonrise instants come from
 * the audit's Skyfield reference (tests/fixtures/accuracy-reference.json).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { berlinDayEnd, berlinDayStart, isLaterReading, isSkipped, wallMinutesOf, wallToInstant } from '../../src/miniature/berlinClock.js';

const ref = JSON.parse(readFileSync('tests/fixtures/accuracy-reference.json', 'utf8')) as {
  days: Array<{ day: string; sunCentre4DegDownEvening: string; sunrise: string; sunset: string; moonrise: string[]; moonset: string[] }>;
};
const SPRING = '2027-03-28';
const AUTUMN = '2027-10-31';
const utc = (s: string) => Date.parse(s);
const hm = (h: number, m = 0) => h * 60 + m;
/** What clock.js does with a picked shot: store the wall-clock minute to 5 s, then read it back. */
const pickAndRead = (day: string, t: number) => {
  const minutes = Math.round(wallMinutesOf(day, t) * 12) / 12;
  return { minutes, instant: wallToInstant(day, minutes, isLaterReading(day, t)) };
};

describe('the planner clock when the clocks change', () => {
  it('knows the two days are 23 and 25 hours long', () => {
    expect(berlinDayStart(SPRING)).toBe(utc('2027-03-27T23:00:00Z'));
    expect(berlinDayEnd(SPRING)).toBe(utc('2027-03-28T22:00:00Z'));
    expect(berlinDayStart(AUTUMN)).toBe(utc('2027-10-30T22:00:00Z'));
    expect(berlinDayEnd(AUTUMN)).toBe(utc('2027-10-31T23:00:00Z'));
    expect(berlinDayEnd('2027-06-21') - berlinDayStart('2027-06-21')).toBe(86_400_000);
  });

  it('28 March 2027: a shot at 19:35 CEST sets the slider to 19:35 and the scene to that instant (was 18:35)', () => {
    const shot = utc('2027-03-28T17:35:00Z');
    const { minutes, instant } = pickAndRead(SPRING, shot);
    expect(minutes).toBe(hm(19, 35));
    expect(instant).toBe(shot);
    // The old arithmetic, for the record: minutes elapsed since midnight read 18:35.
    expect((shot - berlinDayStart(SPRING)) / 60_000).toBe(hm(18, 35));
  });

  it('31 October 2027: a shot at 16:40 CET sets the slider to 16:40 and the scene to that instant (was 17:40)', () => {
    const shot = utc('2027-10-31T15:40:00Z');
    const { minutes, instant } = pickAndRead(AUTUMN, shot);
    expect(minutes).toBe(hm(16, 40));
    expect(instant).toBe(shot);
    expect((shot - berlinDayStart(AUTUMN)) / 60_000).toBe(hm(17, 40));
  });

  it('the hour that does not exist (28 March, 02:00 to 03:00) reads as 03:00 and on', () => {
    expect(wallToInstant(SPRING, hm(1, 59))).toBe(utc('2027-03-28T00:59:00Z'));
    expect(isSkipped(SPRING, hm(1, 59))).toBe(false);
    for (const m of [0, 1, 30, 59]) {
      expect(isSkipped(SPRING, hm(2, m)), `02:${m}`).toBe(true);
      const t = wallToInstant(SPRING, hm(2, m));
      // 02:30 is taken as half an hour after 02:00, which the clock shows as 03:30 CEST.
      expect(t).toBe(utc('2027-03-28T01:00:00Z') + m * 60_000);
      expect(wallMinutesOf(SPRING, t)).toBe(hm(3, m));
    }
    expect(isSkipped(SPRING, hm(3, 0))).toBe(false);
    expect(wallToInstant(SPRING, hm(3, 0))).toBe(utc('2027-03-28T01:00:00Z'));
    // No instant on that day reads 02:xx.
    for (let t = berlinDayStart(SPRING); t < berlinDayEnd(SPRING); t += 60_000) {
      const m = wallMinutesOf(SPRING, t);
      expect(m < hm(2) || m >= hm(3)).toBe(true);
    }
    // Nothing is skipped on an ordinary day or when the clocks go back.
    expect(isSkipped('2027-06-21', hm(2, 30))).toBe(false);
    expect(isSkipped(AUTUMN, hm(2, 30))).toBe(false);
  });

  it('the hour that happens twice (31 October, 02:00 to 03:00) keeps its two instants apart', () => {
    const first = utc('2027-10-31T00:30:00Z'); // 02:30 CEST
    const second = utc('2027-10-31T01:30:00Z'); // 02:30 CET
    expect(wallMinutesOf(AUTUMN, first)).toBe(hm(2, 30));
    expect(wallMinutesOf(AUTUMN, second)).toBe(hm(2, 30));
    expect(wallToInstant(AUTUMN, hm(2, 30))).toBe(first);
    expect(wallToInstant(AUTUMN, hm(2, 30), true)).toBe(second);
    expect(isLaterReading(AUTUMN, first)).toBe(false);
    expect(isLaterReading(AUTUMN, second)).toBe(true);
    // A shot picked in either hour comes back as itself.
    expect(pickAndRead(AUTUMN, first).instant).toBe(first);
    expect(pickAndRead(AUTUMN, second).instant).toBe(second);
    // Outside that hour there is nothing to tell apart, and asking for the later one changes nothing.
    expect(isLaterReading(AUTUMN, utc('2027-10-31T02:30:00Z'))).toBe(false);
    expect(wallToInstant(AUTUMN, hm(3, 30), true)).toBe(utc('2027-10-31T02:30:00Z'));
    expect(wallToInstant('2027-06-21', hm(2, 30), true)).toBe(utc('2027-06-21T00:30:00Z'));
  });

  it('every minute of both days, and of the days around them, survives slider and back', () => {
    for (const day of ['2027-03-27', SPRING, '2027-03-29', '2027-10-30', AUTUMN, '2027-11-01']) {
      for (let t = berlinDayStart(day); t < berlinDayEnd(day); t += 60_000) {
        const { minutes, instant } = pickAndRead(day, t);
        expect(minutes >= 0 && minutes < 1440, `${day} ${new Date(t).toISOString()}`).toBe(true);
        expect(instant, `${day} ${new Date(t).toISOString()}`).toBe(t);
      }
    }
  });

  it("reads the reference's sunrise, sunset and moonrise on the audit's twelve days as Berlin's clock does", () => {
    // Independent of the module: the platform's own formatting of the instant in Berlin time.
    const berlin = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    for (const d of ref.days) {
      const dayOf = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
      for (const iso of [d.sunrise, d.sunset, d.sunCentre4DegDownEvening, ...d.moonrise, ...d.moonset]) {
        if (dayOf(iso) !== d.day) continue;
        const [h, m, s] = berlin.format(new Date(iso)).split(':').map(Number);
        expect(wallMinutesOf(d.day, utc(iso)), `${d.day} ${iso}`).toBeCloseTo(h * 60 + m + s / 60, 6);
        const { instant } = pickAndRead(d.day, utc(iso));
        expect(Math.abs(instant - utc(iso)), `${d.day} ${iso}`).toBeLessThanOrEqual(2500);
      }
    }
  });
});
