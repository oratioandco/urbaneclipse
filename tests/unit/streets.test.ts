import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { berlinDayBounds } from '../../src/lib/berlinTime';
import { sampleBody } from '../../src/lib/bodyPosition';
import {
  decodeStreets,
  findStreetPasses,
  inStreetGap,
  streetMoments,
  type StreetsDocument,
} from '../../src/lib/streets';

const doc = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'public', 'streets', 'berlin.json'), 'utf8'),
) as StreetsDocument & { license: string };
const views = decodeStreets(doc);
const LAT = 52.5208;
const LON = 13.4094;
const find = (name: string, near: number) =>
  views
    .filter((v) => v.name === name)
    .sort((a, b) => Math.abs(a.bearingDeg - near) - Math.abs(b.bearingDeg - near))[0];

describe('the shipped street data', () => {
  it('credits OpenStreetMap', () => {
    expect(doc.license).toMatch(/OpenStreetMap/);
    expect(doc.license).toMatch(/ODbL/);
  });

  it('holds a useful number of views', () => {
    expect(views.length).toBeGreaterThan(500);
  });

  // Grid north is about 1.3 degrees off true north here. That mistake moved every date
  // once, and only showed up by rendering the result.
  it('measures bearings from true north, not the map grid', () => {
    for (const v of views) {
      const dLat = v.to.lat - v.from.lat;
      const dLon = (v.to.lon - v.from.lon) * Math.cos((((v.from.lat + v.to.lat) / 2) * Math.PI) / 180);
      const expected = ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
      const d = Math.abs(expected - v.bearingDeg) % 360;
      expect(Math.min(d, 360 - d)).toBeLessThan(0.3);
    }
  });

  it('keeps wide avenues such as Karl-Marx-Allee', () => {
    expect(find('Karl-Marx-Allee', 280).bearingDeg).toBeGreaterThan(278);
    expect(find('Karl-Marx-Allee', 280).bearingDeg).toBeLessThan(281);
  });
});

describe('inStreetGap', () => {
  const view = { bearingDeg: 280, skylineDeg: 1, toleranceDeg: 0.5 };

  it('needs the disc on the axis and just above the skyline', () => {
    expect(inStreetGap(view, 280, 2)).toBe(true);
    expect(inStreetGap(view, 281, 2)).toBe(false);
    expect(inStreetGap(view, 280, 1.1)).toBe(false);
    expect(inStreetGap(view, 280, 6)).toBe(false);
  });

  it('handles bearings across north', () => {
    expect(inStreetGap({ ...view, bearingDeg: 359.9 }, 0.2, 2)).toBe(true);
  });
});

describe('streetMoments', () => {
  it('finds streets for a day, each with a moment inside its window', () => {
    const { start, end } = berlinDayBounds('2027-04-08');
    const moments = streetMoments(views, 'sun', start.getTime(), end.getTime(), LAT, LON);
    expect(moments.length).toBeGreaterThan(10);
    for (const m of moments) {
      expect(m.peak).toBeGreaterThanOrEqual(m.from);
      expect(m.peak).toBeLessThanOrEqual(m.to);
      expect(inStreetGap(m.view, m.bodyAz, m.bodyAlt)).toBe(true);
    }
  });

  it('skips a moon too thin to read', () => {
    // New moon, 9 Nov 2026.
    const { start, end } = berlinDayBounds('2026-11-09');
    expect(streetMoments(views, 'moon', start.getTime(), end.getTime(), LAT, LON)).toEqual([]);
  });
});

describe('findStreetPasses', () => {
  const year = [Date.UTC(2026, 10, 5), Date.UTC(2027, 10, 5)] as const;

  it('puts the Frankfurter Allee sunset in early April and early September', () => {
    const view = find('Frankfurter Allee', 279.4);
    const months = new Set(
      findStreetPasses(view, 'sun', ...year).map((p) => new Date(p.peak).getUTCMonth()),
    );
    expect(months.has(3)).toBe(true); // April
    expect(months.has(8)).toBe(true); // September
  }, 30_000);

  it('gives each pass a real alignment, at most one a day, in order', () => {
    const view = find('Kantstraße', 275);
    const passes = findStreetPasses(view, 'sun', ...year);
    expect(passes.length).toBeGreaterThan(3);
    for (let i = 0; i < passes.length; i++) {
      const at = sampleBody('sun', new Date(passes[i].peak), view.from.lat, view.from.lon);
      expect(inStreetGap(view, at.az, at.alt)).toBe(true);
      if (i > 0) expect(passes[i].peak).toBeGreaterThan(passes[i - 1].peak);
    }
  }, 30_000);
});
