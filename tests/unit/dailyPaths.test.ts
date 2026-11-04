import { describe, it, expect } from 'vitest';
import { berlinDayBounds, berlinDayOf, formatTime, shiftDay } from '../../src/lib/berlinTime';
import {
  compassPoint,
  computeDayPath,
  dayHighlights,
  findSpotEvents,
  pointAtTime,
} from '../../src/lib/dailyPaths';
import { findOccultationsAtPosition } from '../../src/lib/areaSolver';
import { sampleBody } from '../../src/lib/bodyPosition';
import { FERNSEHTURM } from '../../src/lib/landmarks';

const pathFor = (day: string, body: 'sun' | 'moon') =>
  computeDayPath({ body, ...berlinDayBounds(day), landmark: FERNSEHTURM });

describe('berlinTime', () => {
  it('resolves the calendar day in Berlin, not UTC', () => {
    expect(berlinDayOf(new Date('2026-11-04T23:30:00Z'))).toBe('2026-11-05');
  });

  it('gives DST days their real length', () => {
    const hours = (day: string) => {
      const { start, end } = berlinDayBounds(day);
      return (end.getTime() - start.getTime()) / 3_600_000;
    };
    expect(hours('2026-11-04')).toBe(24);
    expect(hours('2027-03-28')).toBe(23);
    expect(hours('2026-10-25')).toBe(25);
  });

  it('starts the day at local midnight', () => {
    expect(formatTime(berlinDayBounds('2027-06-21').start)).toBe('00:00');
  });

  it('shifts across month and year ends', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('computeDayPath', () => {
  it('produces a sun path every day, inside the data range', () => {
    for (const day of ['2026-11-04', '2026-12-21', '2027-03-20', '2027-06-21']) {
      const path = pathFor(day, 'sun');
      const points = path.segments.flat();
      expect(points.length).toBeGreaterThan(50);
      for (const p of points) {
        expect(p.distanceM).toBeGreaterThanOrEqual(250);
        expect(p.distanceM).toBeLessThanOrEqual(9000);
      }
    }
  });

  it('places each point opposite the body, seen from the landmark', () => {
    const points = pathFor('2026-11-04', 'sun').segments.flat();
    const p = points[Math.floor(points.length / 2)];
    const body = sampleBody('sun', new Date(p.t), FERNSEHTURM.lat, FERNSEHTURM.lon);
    const dLat = p.lat - FERNSEHTURM.lat;
    const dLon = (p.lon - FERNSEHTURM.lon) * Math.cos((FERNSEHTURM.lat * Math.PI) / 180);
    const measured = ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
    expect(Math.abs(measured - (body.az + 180) % 360)).toBeLessThan(0.5);
  });

  it('classifies coverage from the real silhouette: full only when close enough', () => {
    const points = pathFor('2027-06-21', 'sun').segments.flat();
    const full = points.filter((p) => p.kind === 'full');
    const far = points.filter((p) => p.distanceM > 5000);
    expect(full.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    expect(far.every((p) => p.kind !== 'full')).toBe(true);
  });
});

describe('pointAtTime', () => {
  it('returns nothing when the path is not active', () => {
    const path = pathFor('2026-11-04', 'sun');
    const { start } = berlinDayBounds('2026-11-04');
    expect(pointAtTime(path, start.getTime())).toBeUndefined();
  });
});

describe('dayHighlights', () => {
  it('surfaces low-light sun shots in time order', () => {
    const picks = dayHighlights(pathFor('2026-11-04', 'sun'));
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((p) => p.bodyAlt >= 2 && p.bodyAlt <= 12)).toBe(true);
    expect([...picks].sort((a, b) => a.t - b.t)).toEqual(picks);
  });

  it('leaves out a moon too thin to read', () => {
    const path = pathFor('2026-11-04', 'moon');
    expect(dayHighlights({ ...path, illumination: 0.1 })).toEqual([]);
  });
});

describe('findSpotEvents', () => {
  const observer = { lat: 52.5205, lon: 13.416, ellipsoidalHeight: 77 };
  const year = { start: new Date('2026-11-04T00:00:00Z'), end: new Date('2027-11-04T00:00:00Z') };

  it('groups minutes into separate daily passes, soonest first', () => {
    const events = findSpotEvents({ observer, landmark: FERNSEHTURM, body: 'sun', ...year, stepMinutes: 2 });
    expect(events.length).toBeGreaterThan(50);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].peak).toBeGreaterThan(events[i - 1].peak);
    }
    const longest = Math.max(...events.map((e) => e.end - e.start));
    expect(longest).toBeLessThan(40 * 60_000);
  }, 30_000);

  it('finds nothing from south of the tower, where neither body can line up', () => {
    const south = { lat: 52.5, lon: 13.409419, ellipsoidalHeight: 77 };
    const events = findSpotEvents({ observer: south, landmark: FERNSEHTURM, body: 'sun', ...year, stepMinutes: 2 });
    expect(events).toEqual([]);
  }, 30_000);

  it('finds the same passes as a minute-by-minute sweep of every instant', () => {
    const window = { start: new Date('2027-03-15T00:00:00Z'), end: new Date('2027-04-20T00:00:00Z') };
    for (const position of [observer, { lat: 52.5182, lon: 13.4285, ellipsoidalHeight: 76 }]) {
      for (const body of ['sun', 'moon'] as const) {
        const fast = findSpotEvents({ observer: position, landmark: FERNSEHTURM, body, ...window })
          .map((e) => e.peak)
          .sort((a, b) => a - b);
        const every = findOccultationsAtPosition({
          observer: position,
          landmark: FERNSEHTURM,
          ...window,
          stepMinutes: 1,
          bodyAt: (t: Date) => sampleBody(body, t, position.lat, position.lon),
          minAltitudeDeg: 1,
          limit: Number.MAX_SAFE_INTEGER,
        });
        for (const peak of fast) {
          expect(every.some((c) => c.when.getTime() === peak)).toBe(true);
        }
        const days = (ts: number[]) => new Set(ts.map((t) => new Date(t).toISOString().slice(0, 10)));
        const fastDays = days(fast);
        const everyDays = days(every.map((c) => c.when.getTime()));
        if (body === 'sun') expect(fastDays).toEqual(everyDays);
        else for (const d of fastDays) expect(everyDays.has(d)).toBe(true);
      }
    }
  }, 60_000);
});

describe('compassPoint', () => {
  it('names bearings, wrapping at north', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(112.5)).toBe('ESE');
    expect(compassPoint(359)).toBe('N');
  });
});
