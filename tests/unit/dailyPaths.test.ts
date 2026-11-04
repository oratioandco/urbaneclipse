import { describe, it, expect } from 'vitest';
import { berlinDayBounds, berlinDayOf, formatTime, shiftDay } from '../../src/lib/berlinTime';
import { lightPhaseOf } from '../../src/lib/lightPhases';
import {
  alignmentLine,
  applyView,
  nextClearPoint,
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
    for (const e of events) expect(Number.isFinite(e.bodyAz)).toBe(true);
    const longest = Math.max(...events.map((e) => e.end - e.start));
    expect(longest).toBeLessThan(40 * 60_000);
  }, 30_000);

  it('finds nothing from south of the tower, where neither body can line up', () => {
    const south = { lat: 52.5, lon: 13.409419, ellipsoidalHeight: 77 };
    const events = findSpotEvents({ observer: south, landmark: FERNSEHTURM, body: 'sun', ...year, stepMinutes: 2 });
    expect(events).toEqual([]);
  }, 30_000);

  it('reports the true peak of a pass regardless of when the sweep starts', () => {
    const position = { lat: 52.535147, lon: 13.372137, ellipsoidalHeight: 76.8 };
    const peakFrom = (offsetSeconds: number) => {
      const start = new Date(Date.UTC(2026, 10, 5, 5, 0, offsetSeconds));
      const end = new Date(start.getTime() + 3 * 3_600_000);
      const [event] = findSpotEvents({ observer: position, landmark: FERNSEHTURM, body: 'sun', start, end });
      return event;
    };
    const a = peakFrom(0);
    const b = peakFrom(37);
    expect(Math.abs(a.coveredFraction - b.coveredFraction)).toBeLessThan(0.02);
    expect(a.kind).toBe(b.kind);
  });

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

describe('applyView', () => {
  const path = pathFor('2026-11-04', 'sun');
  const midLat = path.segments[0][Math.floor(path.segments[0].length / 2)].lat;

  it('marks every sampled point, more finely than the solved path', () => {
    const viewed = applyView(path, () => true);
    const solved = path.segments.flat().length;
    const dense = viewed.segments.flat();
    expect(dense.length).toBeGreaterThan(solved * 5);
    expect(dense.every((p) => p.clear === true)).toBe(true);
  });

  it('keeps points on the solved path when it interpolates', () => {
    const viewed = applyView(path, () => true);
    for (const solved of path.segments.flat().slice(0, 20)) {
      const match = viewed.segments.flat().find((p) => p.t === solved.t);
      expect(match?.lat).toBeCloseTo(solved.lat, 9);
    }
  });

  it('never offers a blocked point as a highlight', () => {
    const viewed = applyView(path, (lat) => lat > midLat);
    for (const p of dayHighlights(viewed)) expect(p.clear).toBe(true);
    expect(dayHighlights(applyView(path, () => false))).toEqual([]);
  });

  it('treats a chink between buildings as blocked', () => {
    let calls = 0;
    const viewed = applyView(path, () => {
      calls++;
      // One sample clear, 15 seconds long, and everything else blocked.
      return calls === 40;
    });
    expect(viewed.segments.flat().some((p) => p.clear)).toBe(false);
  });

  it('finds the next clear moment, and nothing when none remains', () => {
    const viewed = applyView(path, () => true);
    const all = viewed.segments.flat();
    expect(nextClearPoint(viewed, all[5].t)?.t).toBe(all[5].t);
    expect(nextClearPoint(viewed, all[all.length - 1].t + 1)).toBeUndefined();
  });
});

describe('dayHighlights ranking', () => {
  it('prefers golden hour when a clear shot exists there', () => {
    for (const day of ['2026-11-05', '2027-03-20', '2027-09-04']) {
      for (const pick of dayHighlights(pathFor(day, 'sun'))) {
        expect(lightPhaseOf(pick.t, pick.lat, pick.lon)).toBe('golden');
      }
    }
  });

  it('falls back to daylight when golden hour is blocked, rather than offering nothing', () => {
    const path = pathFor('2026-11-05', 'sun');
    const viewed = applyView(path, () => true);
    for (const segment of viewed.segments) {
      for (const p of segment) p.clear = lightPhaseOf(p.t, p.lat, p.lon) !== 'golden';
    }
    const picks = dayHighlights(viewed);
    expect(picks.length).toBeGreaterThan(0);
    for (const p of picks) expect(lightPhaseOf(p.t, p.lat, p.lon)).toBe('day');
  });
});

describe('alignmentLine', () => {
  const noon = (day: string) => {
    const { start, end } = berlinDayBounds(day);
    return (start.getTime() + end.getTime()) / 2;
  };

  it('runs away from the body on the far side of the landmark', () => {
    const line = alignmentLine('sun', noon('2026-11-05'), FERNSEHTURM)!;
    // At midday the sun is south, so the far side is north and the near side south.
    expect(line.farEnd.lat).toBeGreaterThan(FERNSEHTURM.lat);
    expect(line.bodySide.lat).toBeLessThan(FERNSEHTURM.lat);
  });

  it('reaches further as the body gets lower', () => {
    const distance = (t: number) => {
      const line = alignmentLine('sun', t, FERNSEHTURM)!;
      return Math.hypot(line.farEnd.lat - FERNSEHTURM.lat, line.farEnd.lon - FERNSEHTURM.lon);
    };
    const t = noon('2026-11-05');
    expect(distance(t + 3 * 3_600_000)).toBeGreaterThan(distance(t));
  });

  it('passes through the sphere position on the path', () => {
    const path = pathFor('2026-11-05', 'sun');
    const point = path.segments[0][Math.floor(path.segments[0].length / 2)];
    const line = alignmentLine('sun', point.t, FERNSEHTURM)!;
    const bearing = (lat: number, lon: number) =>
      (Math.atan2(
        (lon - FERNSEHTURM.lon) * Math.cos((FERNSEHTURM.lat * Math.PI) / 180),
        lat - FERNSEHTURM.lat,
      ) * 180) / Math.PI;
    expect(Math.abs(bearing(line.farEnd.lat, line.farEnd.lon) - bearing(point.lat, point.lon))).toBeLessThan(0.5);
  });

  it('does not exist once the body has set', () => {
    expect(alignmentLine('sun', berlinDayBounds('2026-11-05').start.getTime(), FERNSEHTURM)).toBeUndefined();
  });
});
