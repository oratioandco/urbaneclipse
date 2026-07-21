import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getTimes } from 'suncalc';
import {
  buildTimelineBands,
  classifyHourBand,
  type Band,
} from '../../src/lib/timeline';

/**
 * Pure sun-event timeline classifier — NO suncalc at module load
 * (Constitution Principle I: TDD-first, pure, Vitest-covered; Principle II: defensive).
 *
 * The module takes a getTimes-SHAPED object as input (mockable). We VERIFY the
 * exact suncalc-2.0.1 field names below by calling getTimes once in setup, then
 * drive buildTimelineBands / classifyHourBand with HAND-BUILT mock times objects
 * (stable round-number UTC instants) so the timeline math is exercised without
 * depending on suncalc's floating-point output.
 */

// ─── Field-name verification (call suncalc once; no assumption) ───────────────────
const VERIFIED_FIELDS: string[] = [];
beforeAll(() => {
  const times = getTimes(new Date('2026-01-15T12:00:00Z'), 52.52, 13.405);
  VERIFIED_FIELDS.push(...Object.keys(times));
});

describe('suncalc 2.0.1 getTimes field names — verified by a live call, not assumed', () => {
  it('exposes solarNoon and nadir (the solar-midnight field), not solarMidnight', () => {
    expect(VERIFIED_FIELDS).toContain('solarNoon');
    expect(VERIFIED_FIELDS).toContain('nadir');
    // suncalc 2.0.1 renamed/uses `nadir`; there is NO solarMidnight key.
    expect(VERIFIED_FIELDS).not.toContain('solarMidnight');
  });

  it('has NO blueHour field', () => {
    expect(VERIFIED_FIELDS).not.toContain('blueHour');
  });

  it('exposes every event field the timeline is built from', () => {
    for (const f of [
      'sunrise',
      'sunset',
      'sunriseEnd',
      'sunsetStart',
      'dawn',
      'dusk',
      'nauticalDawn',
      'nauticalDusk',
      'night',
      'nightEnd',
      'goldenHour',
      'goldenHourEnd',
    ]) {
      expect(VERIFIED_FIELDS).toContain(f);
    }
  });
});

// ─── Purity contract: no suncalc import at module load ────────────────────────────
describe('timeline.ts purity', () => {
  it('does NOT import suncalc at module load (pure + mockable input)', () => {
    const here = fileURLToPath(import.meta.url);
    const src = readFileSync(
      path.resolve(path.dirname(here), '../../src/lib/timeline.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/from\s+['"]suncalc['"]/);
    expect(src).not.toMatch(/require\s*\(\s*['"]suncalc['"]\)/);
  });
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────────
/**
 * Hand-built mock times object (UTC, round numbers on 2026-01-15). NOT from suncalc.
 *
 * Chronological layout (single solar day, nadir at 00:00 of the same date):
 *   00:00 nadir ─ 05:00 nightEnd ─ 06:00 nauticalDawn ─ 07:00 dawn
 *   08:00 sunrise ─ 08:10 sunriseEnd ─ 09:00 goldenHourEnd ─ 12:00 solarNoon
 *   15:00 goldenHour ─ 16:00 sunsetStart ─ 16:10 sunset ─ 17:00 dusk
 *   18:00 nauticalDusk ─ 19:00 night
 *
 * Note the counterintuitive golden-hour naming we must assert the swap of:
 *   goldenHourEnd (09:00) is the END of the MORNING golden hour
 *   goldenHour    (15:00) is the START of the EVENING golden hour
 */
const D = (h: number, m = 0): Date => new Date(Date.UTC(2026, 0, 15, h, m, 0));

function mockTimes(): Record<string, Date> {
  return {
    nadir: D(0, 0),
    solarNoon: D(12, 0),
    nightEnd: D(5, 0),
    nauticalDawn: D(6, 0),
    dawn: D(7, 0),
    sunrise: D(8, 0),
    sunriseEnd: D(8, 10),
    goldenHourEnd: D(9, 0),
    goldenHour: D(15, 0),
    sunsetStart: D(16, 0),
    sunset: D(16, 10),
    dusk: D(17, 0),
    nauticalDusk: D(18, 0),
    night: D(19, 0),
  };
}

const kind = (bands: Band[], k: Band['kind']) => bands.filter((b) => b.kind === k);

// ─── buildTimelineBands: golden hour morning/evening swap ─────────────────────────
describe('buildTimelineBands — golden hour morning/evening swap', () => {
  const bands = buildTimelineBands(mockTimes());
  const golden = kind(bands, 'golden');

  it('produces exactly two golden bands (morning + evening)', () => {
    expect(golden).toHaveLength(2);
  });

  it('MORNING golden = [sunrise, goldenHourEnd] (goldenHourEnd is the MORNING end)', () => {
    const morning = golden.find((b) => b.start.getTime() === D(8, 0).getTime());
    expect(morning, 'morning golden band must start at sunrise').toBeDefined();
    expect(morning!.end.getTime()).toBe(D(9, 0).getTime()); // goldenHourEnd, NOT goldenHour
    expect(morning!.start.getTime()).toBe(D(8, 0).getTime()); // sunrise
  });

  it('EVENING golden = [goldenHour, sunset] (goldenHour is the EVENING start)', () => {
    const evening = golden.find((b) => b.end.getTime() === D(16, 10).getTime());
    expect(evening, 'evening golden band must end at sunset').toBeDefined();
    expect(evening!.start.getTime()).toBe(D(15, 0).getTime()); // goldenHour, NOT goldenHourEnd
    expect(evening!.end.getTime()).toBe(D(16, 10).getTime()); // sunset
  });

  it('never confuses the two: morning end != evening start', () => {
    const morning = golden.find((b) => b.start.getTime() === D(8, 0).getTime())!;
    const evening = golden.find((b) => b.end.getTime() === D(16, 10).getTime())!;
    expect(morning.end.getTime()).toBe(D(9, 0).getTime()); // goldenHourEnd
    expect(evening.start.getTime()).toBe(D(15, 0).getTime()); // goldenHour
    expect(morning.end.getTime()).not.toBe(evening.start.getTime());
  });
});

// ─── buildTimelineBands: blue hour windows ────────────────────────────────────────
describe('buildTimelineBands — blue hour windows', () => {
  const bands = buildTimelineBands(mockTimes());
  const blue = kind(bands, 'blue');

  it('produces exactly two blue bands (morning + evening)', () => {
    expect(blue).toHaveLength(2);
  });

  it('MORNING blue = [nauticalDawn, dawn]', () => {
    const morning = blue.find((b) => b.start.getTime() === D(6, 0).getTime());
    expect(morning).toBeDefined();
    expect(morning!.start.getTime()).toBe(D(6, 0).getTime()); // nauticalDawn
    expect(morning!.end.getTime()).toBe(D(7, 0).getTime()); // dawn
  });

  it('EVENING blue = [dusk, nauticalDusk]', () => {
    const evening = blue.find((b) => b.end.getTime() === D(18, 0).getTime());
    expect(evening).toBeDefined();
    expect(evening!.start.getTime()).toBe(D(17, 0).getTime()); // dusk
    expect(evening!.end.getTime()).toBe(D(18, 0).getTime()); // nauticalDusk
  });
});

// ─── buildTimelineBands: day + night ──────────────────────────────────────────────
describe('buildTimelineBands — day and night', () => {
  const bands = buildTimelineBands(mockTimes());

  it('DAY = [sunriseEnd, sunsetStart]', () => {
    const day = kind(bands, 'day');
    expect(day).toHaveLength(1);
    expect(day[0]!.start.getTime()).toBe(D(8, 10).getTime()); // sunriseEnd
    expect(day[0]!.end.getTime()).toBe(D(16, 0).getTime()); // sunsetStart
  });

  it('NIGHT = [night, nightEnd] anchored around the solar-midnight instant (nadir)', () => {
    // night (evening 19:00) > nightEnd (morning 05:00) in wall-clock for one solar day,
    // so the band wraps midnight and contains nadir (00:00).
    const night = kind(bands, 'night');
    expect(night).toHaveLength(1);
    expect(night[0]!.start.getTime()).toBe(D(19, 0).getTime()); // night (evening onset)
    expect(night[0]!.end.getTime()).toBe(D(5, 0).getTime()); // nightEnd (morning end)
    // nadir (00:00) lies inside the wrapped night band.
    const nadirInside =
      night[0]!.start.getTime() <= D(0, 0).getTime() || // 00:00 >= 19:00 (wrap branch)
      D(0, 0).getTime() <= night[0]!.end.getTime(); // 00:00 <= 05:00
    expect(nadirInside).toBe(true);
  });
});

// ─── buildTimelineBands: defensiveness (Principle II) ─────────────────────────────
describe('buildTimelineBands — defensive against missing / NaN / null fields', () => {
  it('returns an empty array for an empty times object', () => {
    expect(buildTimelineBands({})).toEqual([]);
  });

  it('omits a band when one of its endpoints is missing (no throw)', () => {
    const partial = mockTimes();
    delete partial['goldenHourEnd']; // morning golden incomplete
    delete partial['nauticalDawn']; // morning blue incomplete
    const bands = buildTimelineBands(partial);
    expect(kind(bands, 'golden')).toHaveLength(1); // only evening remains
    expect(kind(bands, 'blue')).toHaveLength(1); // only evening remains
    expect(kind(bands, 'day')).toHaveLength(1);
    expect(kind(bands, 'night')).toHaveLength(1);
  });

  it('skips endpoints that are Invalid Dates (NaN getTime) without crashing', () => {
    const t = mockTimes();
    t['goldenHour'] = new Date(NaN); // evening golden invalid
    t['sunriseEnd'] = new Date(NaN); // day invalid
    const bands = buildTimelineBands(t);
    expect(kind(bands, 'golden')).toHaveLength(1); // morning only
    expect(kind(bands, 'day')).toHaveLength(0);
  });

  it('treats null endpoints (summer high-latitude night) as missing — no night band', () => {
    const t = mockTimes();
    // suncalc returns null for night/nightEnd in summer Berlin; simulate that.
    (t as Record<string, Date | null>)['night'] = null;
    (t as Record<string, Date | null>)['nightEnd'] = null;
    const bands = buildTimelineBands(t as Record<string, Date>);
    expect(kind(bands, 'night')).toHaveLength(0);
    // other bands still build normally
    expect(kind(bands, 'golden')).toHaveLength(2);
  });

  it('skips a band whose endpoints are inverted (start > end) for non-night kinds', () => {
    const t = mockTimes();
    // Physically impossible inverted morning golden window.
    (t as Record<string, Date>)['sunrise'] = D(11, 0); // after goldenHourEnd (09:00)
    const bands = buildTimelineBands(t);
    const morningGolden = kind(bands, 'golden').filter(
      (b) => b.end.getTime() === D(9, 0).getTime(),
    );
    expect(morningGolden).toHaveLength(0);
  });
});

// ─── classifyHourBand: windowed lookup ────────────────────────────────────────────
describe('classifyHourBand — returns the right kind inside each window', () => {
  // Shared bands for all cases.
  const bands = buildTimelineBands(mockTimes());
  const T = (h: number, m = 0): Date => D(h, m);

  it('classifies a point inside MORNING blue as "blue"', () => {
    expect(classifyHourBand(bands, T(6, 30))).toBe('blue');
  });

  it('classifies a point inside EVENING blue as "blue"', () => {
    expect(classifyHourBand(bands, T(17, 30))).toBe('blue');
  });

  it('classifies a point inside MORNING golden as "golden"', () => {
    expect(classifyHourBand(bands, T(8, 30))).toBe('golden');
  });

  it('classifies a point inside EVENING golden as "golden"', () => {
    expect(classifyHourBand(bands, T(15, 30))).toBe('golden');
  });

  it('classifies midday as "day"', () => {
    expect(classifyHourBand(bands, T(12, 0))).toBe('day');
  });

  it('classifies nadir (solar midnight) as "night" (wrap: t >= start)', () => {
    expect(classifyHourBand(bands, T(0, 0))).toBe('night');
  });

  it('classifies a pre-dawn morning instant as "night" (wrap: t <= end)', () => {
    expect(classifyHourBand(bands, T(4, 0))).toBe('night');
  });

  it('classifies a late-evening instant as "night" (t >= start)', () => {
    expect(classifyHourBand(bands, T(20, 0))).toBe('night');
  });

  it('prefers "golden" over "day" in the morning overlap [sunriseEnd, goldenHourEnd]', () => {
    // sunriseEnd 08:10 .. goldenHourEnd 09:00 is inside BOTH day and morning golden.
    expect(classifyHourBand(bands, T(8, 30))).toBe('golden');
    expect(classifyHourBand(bands, T(8, 45))).toBe('golden');
  });

  it('prefers "golden" over "day" in the evening overlap [goldenHour, sunsetStart]', () => {
    // goldenHour 15:00 .. sunsetStart 16:00 is inside BOTH day and evening golden.
    expect(classifyHourBand(bands, T(15, 30))).toBe('golden');
    expect(classifyHourBand(bands, T(15, 59))).toBe('golden');
  });

  it('returns null in an uncovered gap (civil twilight between blue and golden morning)', () => {
    // 07:30 is after dawn (blue morning end 07:00) and before sunrise (golden start 08:00).
    expect(classifyHourBand(bands, T(7, 30))).toBeNull();
  });

  it('returns null in an uncovered gap (nautical twilight between golden evening and blue evening)', () => {
    // 16:30 is after sunset (golden evening end 16:10) and before dusk (blue start 17:00).
    expect(classifyHourBand(bands, T(16, 30))).toBeNull();
  });

  it('returns null for an empty band list', () => {
    expect(classifyHourBand([], T(12, 0))).toBeNull();
  });
});

// ─── classifyHourBand: defensiveness ──────────────────────────────────────────────
describe('classifyHourBand — defensive', () => {
  it('does not throw when bands contain degenerate equal start/end', () => {
    const bands: Band[] = [
      { kind: 'day', start: D(12, 0), end: D(12, 0) }, // zero-width
    ];
    expect(() => classifyHourBand(bands, D(12, 0))).not.toThrow();
  });
});
