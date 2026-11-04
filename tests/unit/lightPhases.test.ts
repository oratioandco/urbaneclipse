import { describe, it, expect } from 'vitest';
import { getTimes } from 'suncalc';
import { berlinDayBounds, berlinInstant } from '../../src/lib/berlinTime';
import { bandAt, lightBands, lightPhaseAt, lightPhaseOf } from '../../src/lib/lightPhases';

const LAT = 52.52;
const LON = 13.41;
const dayBands = (day: string) => {
  const { start, end } = berlinDayBounds(day);
  return lightBands(start.getTime(), end.getTime(), LAT, LON);
};

describe('lightPhaseAt', () => {
  it('uses the photography boundaries', () => {
    expect(lightPhaseAt(6)).toBe('day');
    expect(lightPhaseAt(5.9)).toBe('golden');
    expect(lightPhaseAt(-4)).toBe('golden');
    expect(lightPhaseAt(-4.1)).toBe('blue');
    expect(lightPhaseAt(-8)).toBe('blue');
    expect(lightPhaseAt(-8.1)).toBe('twilight');
    expect(lightPhaseAt(-12.1)).toBe('night');
  });
});

describe('lightBands', () => {
  it('covers the whole day with no gaps', () => {
    const { start, end } = berlinDayBounds('2026-11-05');
    const bands = dayBands('2026-11-05');
    expect(bands[0].from).toBe(start.getTime());
    expect(bands[bands.length - 1].to).toBe(end.getTime());
    for (let i = 1; i < bands.length; i++) expect(bands[i].from).toBe(bands[i - 1].to);
  });

  it('runs in the order of a normal day', () => {
    expect(dayBands('2026-11-05').map((b) => b.phase)).toEqual([
      'night', 'twilight', 'blue', 'golden', 'day', 'golden', 'blue', 'twilight', 'night',
    ]);
  });

  it('places sunset inside the evening golden hour', () => {
    const { sunset } = getTimes(new Date('2026-11-05T12:00:00Z'), LAT, LON);
    expect(lightPhaseOf(sunset!.getTime(), LAT, LON)).toBe('golden');
  });

  it('keeps a real night in Berlin at midsummer, if a short one', () => {
    const nights = dayBands('2027-06-21').filter((b) => b.phase === 'night');
    const minutes = nights.reduce((sum, b) => sum + (b.to - b.from) / 60_000, 0);
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThan(180);
  });

  it('finds the band for an instant, including the very end', () => {
    const bands = dayBands('2026-11-05');
    const { end } = berlinDayBounds('2026-11-05');
    expect(bandAt(bands, end.getTime())?.phase).toBe('night');
    expect(bandAt(bands, end.getTime() + 1)).toBeUndefined();
  });
});

describe('berlinInstant', () => {
  it('finds wall-clock hours across a DST change', () => {
    const iso = (day: string, hour: number) => berlinInstant(day, hour).toISOString();
    expect(iso('2027-03-28', 6)).toBe('2027-03-28T04:00:00.000Z');
    expect(iso('2026-11-05', 6)).toBe('2026-11-05T05:00:00.000Z');
  });
});
