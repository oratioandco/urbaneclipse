import { describe, expect, it } from 'vitest';
import { coverage, parseHeight, sheetSizes, snapHeight, stepDown, stepUp, tapHeight } from '../../src/miniature/sheetHeights.js';
import { PASSED, countdown, gradeSky, readingVerdict, verdict } from '../../src/miniature/verdict.js';
import {
  altitudeToY,
  clampMinute,
  cloudBand,
  DIP_SHARE,
  glideAt,
  minuteToX,
  neighbourShot,
  nextShotIndex,
  rainBars,
  shotAt,
  shotRowLayout,
  shotRowScroll,
  topAltitude,
  xToMinute,
} from '../../src/miniature/dayTimeline.js';

describe('the sheet’s three heights', () => {
  // A 390x844 phone: a 48 px handle row, a 320 px day view, 900 px of content in all.
  const sizes = sheetSizes({ viewport: 844, head: 48, day: 320, all: 900 });

  it('sizes peek to the handle, half to the day view, full to the screen less a strip of map', () => {
    expect(sizes).toEqual({ peek: 48, half: 368, full: 788 });
  });
  it('has no full height of its own when there is nothing below the day view', () => {
    expect(sheetSizes({ viewport: 844, head: 48, day: 320, all: 320 }).full).toBe(368);
  });
  it('never grows past a short screen', () => {
    const short = sheetSizes({ viewport: 360, head: 48, day: 320, all: 900 });
    expect(short.half).toBe(304);
    expect(short.full).toBe(304);
  });

  it('steps down one height at a time and stops at peek', () => {
    expect(stepDown('full')).toBe('half');
    expect(stepDown('half')).toBe('peek');
    expect(stepDown('peek')).toBe('peek');
    expect(stepUp('peek')).toBe('half');
    expect(stepUp('full')).toBe('full');
  });
  it('toggles peek and half on a tap, and folds from full', () => {
    expect(tapHeight('peek')).toBe('half');
    expect(tapHeight('half')).toBe('peek');
    expect(tapHeight('full')).toBe('peek');
  });
  it('reads a stored height and refuses anything else', () => {
    expect(parseHeight('full')).toBe('full');
    expect(parseHeight('open')).toBe('half');
    expect(parseHeight(null, 'peek')).toBe('peek');
  });

  it('settles a slow release on the nearest height', () => {
    expect(snapHeight({ at: 120, from: 'peek', sizes })).toBe('peek');
    expect(snapHeight({ at: 260, from: 'peek', sizes })).toBe('half');
    expect(snapHeight({ at: 600, from: 'half', sizes })).toBe('full');
    expect(snapHeight({ at: 500, from: 'full', sizes })).toBe('half');
  });
  it('lets a short flick move one height its way', () => {
    expect(snapHeight({ at: 70, velocity: 0.8, from: 'peek', sizes })).toBe('half');
    expect(snapHeight({ at: 350, velocity: -0.8, from: 'half', sizes })).toBe('peek');
    expect(snapHeight({ at: 380, velocity: 0.8, from: 'half', sizes })).toBe('full');
  });
  it('lets a hard flick from full reach peek, and never leaves the three', () => {
    expect(snapHeight({ at: 300, velocity: -3, from: 'full', sizes })).toBe('peek');
    expect(snapHeight({ at: 780, velocity: 3, from: 'full', sizes })).toBe('full');
    expect(snapHeight({ at: 50, velocity: -3, from: 'peek', sizes })).toBe('peek');
  });
  it('skips a full height that equals half', () => {
    const two = { peek: 48, half: 368, full: 368 };
    expect(snapHeight({ at: 380, velocity: 0.8, from: 'half', sizes: two })).toBe('half');
  });

  it('measures how much of the screen a box takes', () => {
    expect(coverage({ width: 390, height: 422 }, { width: 390, height: 844 })).toBe(0.5);
  });
});

describe('verdicts in words', () => {
  const sky = (low: number, mid: number, high: number, vis = 24_000, rain = 0) => ({ low, mid, high, vis, rain });

  it('keeps the plan’s thresholds: 75% cloud or 3 km is poor, 50% or 9 km fair', () => {
    expect(gradeSky(sky(0.76, 0, 0))).toBe('poor');
    expect(gradeSky(sky(0.75, 0, 0))).toBe('fair');
    expect(gradeSky(sky(0, 0.51, 0))).toBe('fair');
    expect(gradeSky(sky(0, 0.5, 0))).toBe('good');
    expect(gradeSky(sky(0, 0, 0, 2999))).toBe('poor');
    expect(gradeSky(sky(0, 0, 0, 8999))).toBe('fair');
  });
  it('says the word and the reason', () => {
    expect(verdict(sky(0, 0, 0.05)).label).toBe('Go · clear light');
    expect(verdict(sky(0, 0.6, 0.3)).label).toBe('Maybe · mixed cloud');
    expect(verdict(sky(0.2, 0.9, 0.9)).label).toBe('Skip · overcast');
  });
  it('names what decides it: low cloud, haze, fog, rain, thin high cloud', () => {
    expect(verdict(sky(0.9, 0, 0)).reason).toBe('low cloud');
    expect(verdict(sky(0.1, 0.1, 0.1, 6000)).reason).toBe('hazy');
    expect(verdict(sky(0.1, 0.1, 0.1, 600)).reason).toBe('fog');
    expect(verdict(sky(0.2, 0.2, 0.2, 2500)).reason).toBe('thick haze');
    expect(verdict(sky(0.3, 0.7, 0.2, 24_000, 0.8)).label).toBe('Maybe · rain likely');
    expect(verdict(sky(0.3, 0.9, 0.2, 24_000, 0.8)).label).toBe('Skip · rain likely');
    expect(verdict(sky(0, 0.1, 0.4)).label).toBe('Go · high cloud');
    expect(verdict(sky(0.3, 0.3, 0)).label).toBe('Go · light cloud');
  });
  it('never leaves a reason too long for a shot card', () => {
    const samples = [sky(0, 0, 0), sky(0.3, 0.3, 0), sky(0, 0, 0.4), sky(0, 0.6, 0), sky(0, 0, 0, 6000), sky(0.9, 0, 0), sky(0, 0.9, 0), sky(0, 0, 0, 500), sky(0, 0, 0, 2000), sky(0, 0.9, 0, 24_000, 1)];
    for (const s of samples) expect(verdict(s).reason.length).toBeLessThanOrEqual(11);
  });
  it('says so in words when there is no forecast', () => {
    expect(verdict(null)).toEqual({ grade: null, word: 'No forecast yet', reason: '', label: 'No forecast yet' });
    expect(verdict(null, 'Forecast loading').label).toBe('Forecast loading');
    expect(PASSED.label).toBe('Passed');
  });
  it('words a sunrise or sunset reading', () => {
    expect(readingVerdict({ grade: 'good', text: 'clouds above to catch the colour' }).label).toBe('Go · clouds above to catch the colour');
    expect(readingVerdict({ grade: 'poor', text: 'overcast, little direct light' }).word).toBe('Skip');
  });
  it('counts down in the units that fit', () => {
    const now = Date.UTC(2026, 10, 23, 12);
    expect(countdown(now + 12 * 60_000, now)).toBe('in 12 min');
    expect(countdown(now + 106 * 60_000, now)).toBe('in 1 h 46 min');
    expect(countdown(now + 120 * 60_000, now)).toBe('in 2 h');
    expect(countdown(now + 50 * 3_600_000, now)).toBe('in 2 days');
    expect(countdown(now + 26 * 3_600_000, now)).toBe('in 1 day');
    expect(countdown(now - 60_000, now)).toBe('now');
  });
});

describe('the day view’s scale', () => {
  it('is straight: every hour as wide as the next', () => {
    expect(minuteToX(0)).toBe(0);
    expect(minuteToX(360)).toBe(0.25);
    expect(minuteToX(720) - minuteToX(660)).toBeCloseTo(minuteToX(60) - minuteToX(0), 12);
    expect(minuteToX(1440)).toBe(1);
  });
  it('reads a minute back from a pointer and keeps it inside the day', () => {
    expect(xToMinute(112 + 183, 112, 366)).toBe(720);
    expect(xToMinute(0, 112, 366)).toBe(0);
    expect(xToMinute(9999, 112, 366)).toBe(1439);
    expect(clampMinute(-5)).toBe(0);
  });
  it('does not snap: a pointer between two minutes stays between them', () => {
    const minute = xToMinute(100.3, 0, 366);
    expect(minute).toBeCloseTo(394.62, 1);
    expect(Number.isInteger(minute)).toBe(false);
  });

  it('blends the three cloud layers into one band, empty under a clear sky', () => {
    const band = cloudBand({ low: [0, 1, 0, 0, 0.5], mid: [0, 0, 0, 0, 0.5], high: [0, 0, 1, 0.01, 0.5] });
    expect(band[0]).toBe(0);
    expect(band[1]).toBe(1);
    // High cloud alone is thin: under half strength however much of it there is.
    expect(band[2]).toBeCloseTo(0.45, 6);
    expect(band[3]).toBe(0);
    // Three half-covered layers add up to more than any one of them.
    expect(band[4]).toBeGreaterThan(0.5);
    expect(band[4]).toBeLessThan(1);
  });
  it('draws rain as bars only where it rains', () => {
    const bars = rainBars({ mm: [0, 0.05, 1, 4, 12, 0], prob: [0.1, 0.2, 0.6, 0.9, 1, 0.7] });
    expect(bars[0]).toBeNull();
    expect(bars[1]).toBeNull();
    expect(bars[2]!.height).toBeCloseTo(0.5, 6);
    expect(bars[3]!.height).toBe(1);
    expect(bars[4]!.height).toBe(1);
    expect(bars[5]!.height).toBe(0.18);
    expect(bars[3]!.strength).toBe(0.9);
  });
  it('puts the horizon at one line and the day’s highest body under the top', () => {
    const top = topAltitude(14.2, 9);
    expect(altitudeToY(0, top)).toBeCloseTo(1 - DIP_SHARE, 12);
    expect(altitudeToY(14.2, top)).toBeGreaterThan(0);
    expect(altitudeToY(14.2, top)).toBeLessThan(0.12);
    expect(altitudeToY(-40, top)).toBe(1);
    expect(altitudeToY(-5, top)).toBeGreaterThan(1 - DIP_SHARE);
    // Midsummer in Berlin: the sun reaches 61 degrees and still fits.
    expect(altitudeToY(61, topAltitude(61, 20))).toBeGreaterThan(0);
  });
});

describe('the shot row', () => {
  // The sheet at 390 px leaves 366 px for the row.
  it('fits five cards at 390 px without scrolling', () => {
    const row = shotRowLayout(366, 5);
    expect(row.fits).toBe(5);
    expect(row.scrolls).toBe(false);
    expect(row.more).toBe(0);
    expect(row.card * 5 + row.gap * 4).toBeCloseTo(366, 9);
  });
  it('scrolls a sixth and counts what waits', () => {
    const row = shotRowLayout(366, 13);
    expect(row.scrolls).toBe(true);
    expect(row.more).toBe(8);
    expect(row.card).toBeCloseTo(shotRowLayout(366, 5).card, 9);
  });
  it('fits more on a wide row', () => {
    expect(shotRowLayout(700, 3).fits).toBe(8);
  });
  it('opens at the next shot, and never scrolls past the end', () => {
    const row = shotRowLayout(366, 13);
    const step = row.card + row.gap;
    expect(shotRowScroll(0, 13, row)).toBe(0);
    expect(shotRowScroll(4, 13, row)).toBeCloseTo(4 * step, 9);
    expect(shotRowScroll(12, 13, row)).toBeCloseTo(8 * step, 9);
    expect(shotRowScroll(13, 13, row)).toBeCloseTo(8 * step, 9);
    expect(shotRowScroll(3, 4, shotRowLayout(366, 4))).toBe(0);
  });
  it('finds the next shot from now', () => {
    expect(nextShotIndex([100, 200, 300], 150)).toBe(1);
    expect(nextShotIndex([100, 200, 300], 301)).toBe(3);
    expect(nextShotIndex([], 0)).toBe(0);
  });
  it('jumps to the earlier and later shot, not to the one it stands on', () => {
    const shots = [458, 878, 906, 936, 1268];
    expect(neighbourShot(shots, 800, 1)).toBe(878);
    expect(neighbourShot(shots, 878, 1)).toBe(906);
    expect(neighbourShot(shots, 878.2, 1)).toBe(906);
    expect(neighbourShot(shots, 878, -1)).toBe(458);
    expect(neighbourShot(shots, 400, -1)).toBeNull();
    expect(neighbourShot(shots, 1300, 1)).toBeNull();
    expect(shotAt(shots, 906.4)).toBe(2);
    expect(shotAt(shots, 920)).toBe(-1);
  });
  it('glides to a tapped shot, starting and ending at rest', () => {
    expect(glideAt(800, 878, 0, 400)).toBe(800);
    expect(glideAt(800, 878, 200, 400)).toBeCloseTo(839, 9);
    expect(glideAt(800, 878, 400, 400)).toBe(878);
    expect(glideAt(800, 878, 999, 400)).toBe(878);
  });
});
