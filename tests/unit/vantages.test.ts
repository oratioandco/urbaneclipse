import { describe, it, expect } from 'vitest';
import { EYE_HEIGHT_M, LICHTENBERGER_BRUECKE } from '../../src/lib/vantages.js';

/**
 * Deck elevations for the Lichtenberger Bruecke's six standing points.
 *
 * Every value is sampled per point from the repo's documented DOM1 surface path
 * (scripts/README.md -> gdi.berlin.de/data/dom/atom, sheet dom1_33_398_5818_2,
 * 1 m laser postings, DHHN2016): the tight deck-plateau cluster of postings within
 * a +-2 m box, with bare ground (~39-40 m, confirmed against DGM1) and railing or
 * structure hits (>49 m) excluded. The profile is a real ramp: the west-knick /
 * sued-west points sit ~1.3 m below the mid-span crest, matching the documented
 * west-ramp figure (46.1 m) in scripts/README.md — so the mid-span acceptance band
 * (48.0-48.5 m) holds for the crest points but NOT for the two ramp points, and
 * those two assertions below encode the sampled ramp values instead of the flat
 * band. The curated mid-span value (48.2 m, src/lib/viewpoints.ts) is preserved.
 */

const points = LICHTENBERGER_BRUECKE.points;

describe('Lichtenberger Bruecke standing points', () => {
  it('has the six OSM standing points', () => {
    expect(points.map((p) => p.id)).toEqual([
      'nord-west',
      'nord-mitte',
      'nord-knick',
      'sued-west',
      'sued-mitte',
      'sued-ost',
    ]);
  });

  it('carries individual, DOM1-sampled deck heights — no flat value', () => {
    const heights = points.map((p) => p.surfaceOrthometric);
    expect(new Set(heights).size).toBe(heights.length);
  });

  it('keeps every deck height inside the DOM1-sampled plausibility band (no outliers)', () => {
    // Sampled plateau medians: 46.9 ... 48.2 m DHHN2016. Nothing invented outside it.
    for (const p of points) {
      expect(p.surfaceOrthometric).toBeGreaterThanOrEqual(46.0);
      expect(p.surfaceOrthometric).toBeLessThanOrEqual(49.0);
    }
  });

  it('keeps the mid-span crest on the curated DOM1 record: ~48.2 m (48.0-48.5 band)', () => {
    const mid = points.find((p) => p.id === 'sued-mitte')!;
    expect(mid.surfaceOrthometric).toBeGreaterThanOrEqual(48.0);
    expect(mid.surfaceOrthometric).toBeLessThanOrEqual(48.5);
    expect(Math.abs(mid.surfaceOrthometric - 48.2)).toBeLessThanOrEqual(0.1);
  });

  it('keeps the east crest point in the curated mid-span band', () => {
    const east = points.find((p) => p.id === 'sued-ost')!;
    expect(east.surfaceOrthometric).toBeGreaterThanOrEqual(48.0);
    expect(east.surfaceOrthometric).toBeLessThanOrEqual(48.5);
  });

  it('samples the west-knick ramp LOW, as the documented DOM1 deck profile says', () => {
    // scripts/README.md: "Deck at west ramp / east ramp 46.1 m / 46.7 m" — the two
    // west points sit on the ramp, so the flat 48.2 m mid-span value was wrong there.
    // DOM1 plateau: nord-knick 46.75-46.99 (13 postings), sued-west 46.92-46.98 (5).
    const knick = points.find((p) => p.id === 'nord-knick')!;
    const west = points.find((p) => p.id === 'sued-west')!;
    expect(Math.abs(knick.surfaceOrthometric - 46.9)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(west.surfaceOrthometric - 47.0)).toBeLessThanOrEqual(0.05);
    expect(knick.surfaceOrthometric).toBeLessThan(48.0);
    expect(west.surfaceOrthometric).toBeLessThan(48.0);
  });

  it('keeps the north-arm plateau just below the crest, as sampled', () => {
    // DOM1 plateau: nord-west 47.75-47.84 (7 postings), nord-mitte 47.58-47.73 (9).
    expect(Math.abs(points.find((p) => p.id === 'nord-west')!.surfaceOrthometric - 47.8))
      .toBeLessThanOrEqual(0.05);
    expect(Math.abs(points.find((p) => p.id === 'nord-mitte')!.surfaceOrthometric - 47.7))
      .toBeLessThanOrEqual(0.05);
  });

  it('documents the elevation source per point (dataset, datum, sampling)', () => {
    for (const p of points) {
      expect(p.source.length).toBeGreaterThan(20);
      expect(p.source).toContain('DOM1');
      expect(p.source).toContain('DHHN2016');
      expect(p.source).toContain('dom1_33_398_5818_2');
    }
  });

  it('clears needsSiteCheck only where DOM1 sits inside the curated mid-span band (48.1-48.3)', () => {
    // Crest points (sued-mitte 48.2, sued-ost 48.1) land inside the curated
    // 48.1-48.3 m mid-span band from src/lib/viewpoints.ts — DOM1 is confident there.
    for (const p of points) {
      if (p.surfaceOrthometric >= 48.0) {
        expect(p.needsSiteCheck).toBe(false);
      } else {
        // Ramp points (46.9-47.8) fall outside the curated band: DOM1 is confident
        // the terrain is a ramp, but that DISAGREES with the acceptance band, so a
        // site check stays pending until the conflict is confirmed on the ground.
        expect(p.needsSiteCheck).toBe(true);
      }
    }
  });

  it('keeps eye height 1.6 m and computed bearings/distances intact', () => {
    for (const p of points) {
      expect(p.eyeHeightM).toBe(EYE_HEIGHT_M);
      expect(p.bearingToLandmarkDeg).toBeGreaterThan(279);
      expect(p.bearingToLandmarkDeg).toBeLessThan(281);
      expect(p.distanceToLandmarkM).toBeGreaterThan(5000);
      expect(p.distanceToLandmarkM).toBeLessThan(6500);
    }
  });
});
