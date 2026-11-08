import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import {
  CHERRY_EARLY,
  CHERRY_LATE,
  CHERRY_ORNAMENTAL,
  autumnOn,
  blossomAmount,
  cherryKind,
  climatologyPeak,
  leafOn,
  peakFromGdd,
} from '../../src/miniature/blossom.js';

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('cherryKind', () => {
  it('sorts the register’s Prunus into early, ornamental and late', () => {
    expect(cherryKind('Prunus avium', 'Süss-Kirsche')).toBe(CHERRY_EARLY);
    expect(cherryKind("Prunus cerasifera 'Nigra'", 'Blutpflaume')).toBe(CHERRY_EARLY);
    expect(cherryKind("Prunus serrulata 'Kanzan'", 'Japanische Zierkirsche')).toBe(CHERRY_ORNAMENTAL);
    expect(cherryKind('Prunus serrulata', 'Japanische Blütenkirsche')).toBe(CHERRY_ORNAMENTAL);
    expect(cherryKind('Prunus spec.', 'Kirsche')).toBe(CHERRY_ORNAMENTAL);
    expect(cherryKind('', 'Zierkirsche')).toBe(CHERRY_ORNAMENTAL);
    expect(cherryKind('Prunus padus', 'Trauben-Kirsche')).toBe(CHERRY_LATE);
    expect(cherryKind('Prunus serotina', 'Spätblühende Trauben-Kirsche')).toBe(CHERRY_LATE);
  });

  it('leaves non-cherries alone', () => {
    expect(cherryKind('Tilia cordata', 'Winter-Linde')).toBeNull();
    expect(cherryKind('', 'Platane')).toBeNull();
    expect(cherryKind('Prunus laurocerasus', 'Kirschlorbeer')).toBe(CHERRY_ORNAMENTAL); // still Prunus
  });
});

describe('blossomAmount', () => {
  it('is off well outside the window and full at the climatology peak', () => {
    expect(blossomAmount(day('2027-01-15'), CHERRY_ORNAMENTAL)).toBe(0);
    expect(blossomAmount(day('2027-08-20'), CHERRY_ORNAMENTAL)).toBe(0);
    expect(blossomAmount(day('2027-04-14'), CHERRY_ORNAMENTAL)).toBe(1);
  });

  it('blooms the early kind before the ornamental one, and the late kind after', () => {
    expect(blossomAmount(day('2027-04-06'), CHERRY_EARLY)).toBeGreaterThan(0.5);
    expect(blossomAmount(day('2027-04-06'), CHERRY_ORNAMENTAL)).toBeLessThan(0.5);
    expect(blossomAmount(day('2027-04-26'), CHERRY_LATE)).toBeGreaterThan(0.5);
    expect(blossomAmount(day('2027-05-25'), CHERRY_ORNAMENTAL)).toBe(0);
  });

  it('a predicted peak moves the window instead of adding to it', () => {
    const peaks = { [CHERRY_ORNAMENTAL]: Date.UTC(2027, 3, 24) };
    expect(blossomAmount(day('2027-04-24'), CHERRY_ORNAMENTAL, peaks)).toBe(1);
    expect(blossomAmount(day('2027-04-14'), CHERRY_ORNAMENTAL, peaks)).toBeLessThan(0.3);
    expect(blossomAmount(day('2027-04-08'), CHERRY_ORNAMENTAL, peaks)).toBe(0);
  });
});

describe('the season model', () => {
  it('keep the leaves on in summer and drops them for winter', () => {
    expect(leafOn(day('2027-07-01'))).toBe(1);
    expect(leafOn(day('2027-01-15'))).toBe(0);
    expect(leafOn(day('2027-04-15'))).toBeGreaterThan(0);
    expect(leafOn(day('2027-11-15'))).toBeLessThan(1);
  });

  it('gilds the autumn after the blossom is over, and never with blossom on', () => {
    expect(autumnOn(day('2027-09-10'))).toBe(0);
    expect(autumnOn(day('2027-10-18'))).toBe(1);
    expect(autumnOn(day('2027-04-14'))).toBe(0);
    for (const iso of ['2027-03-15', '2027-04-10', '2027-05-01', '2027-08-01', '2027-12-01']) {
      expect(blossomAmount(day(iso), CHERRY_ORNAMENTAL) * autumnOn(day(iso))).toBe(0);
    }
  });
});

describe('peakFromGdd', () => {
  it('returns the day the sum crosses the threshold', () => {
    const days = Array.from({ length: 100 }, (_, i) => ({ t: Date.UTC(2027, 0, 1 + i), gdd: i * 4 }));
    expect(peakFromGdd(days, CHERRY_EARLY)).toBe(Date.UTC(2027, 0, 1 + 70)); // 280 °Cd
  });

  it('extrapolates at the recent rate while the forecast falls short', () => {
    const days = Array.from({ length: 100 }, (_, i) => ({ t: Date.UTC(2027, 0, 1 + i), gdd: i * 2 }));
    const peak = peakFromGdd(days, CHERRY_ORNAMENTAL)!;
    expect(peak).toBeGreaterThan(days[99].t);
    expect(peak).toBeLessThan(days[99].t + 90 * 86_400_000);
  });

  it('says nothing without days', () => {
    expect(peakFromGdd([], CHERRY_LATE)).toBeNull();
  });
});

describe('climatologyPeak', () => {
  it('lands in the right order early < ornamental < late', () => {
    const early = climatologyPeak(2027, CHERRY_EARLY);
    const ornamental = climatologyPeak(2027, CHERRY_ORNAMENTAL);
    const late = climatologyPeak(2027, CHERRY_LATE);
    expect(early).toBeLessThan(ornamental!);
    expect(ornamental).toBeLessThan(late!);
  });
});
