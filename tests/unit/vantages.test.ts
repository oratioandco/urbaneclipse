import { describe, expect, it } from 'vitest';
import { LICHTENBERGER_BRUECKE } from '../../src/lib/vantages.js';

/**
 * The Lichtenberger Bruecke standing points carry PER-POINT deck heights sampled
 * from Berlin DOM1 (sheet 398_5818), not one flat mid-span value. The bridge is
 * not flat: it climbs from the west ramp (~46.9-47.0 m) to the span over the rail
 * corridor (48.1 m) — see scripts/README.md, which derived west/east ramp 46.1/46.7
 * and mid-span crest 48.1-48.3 from the same DOM1. The plausible envelope below is
 * therefore the deck+ramp band, not just the crest band.
 */
const SAMPLED_DECK_MIN = 46.5; // below the west-ramp ramp figure 46.1 would be suspect
const SAMPLED_DECK_MAX = 48.5; // above the mid-span crest band would be railing hits

describe('Lichtenberger Bruecke standing points', () => {
  const points = LICHTENBERGER_BRUECKE.points;

  it('has the six surveyed standing points', () => {
    expect(points.map((p) => p.id)).toEqual([
      'nord-west',
      'nord-mitte',
      'nord-knick',
      'sued-west',
      'sued-mitte',
      'sued-ost',
    ]);
  });

  it('carries individual, plausible DOM1 deck heights — no flat value, no outliers', () => {
    const heights = points.map((p) => p.surfaceOrthometric);
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(SAMPLED_DECK_MIN);
      expect(h).toBeLessThanOrEqual(SAMPLED_DECK_MAX);
    }
    // Individual: not one value copy-pasted across the bridge.
    expect(new Set(heights).size).toBeGreaterThanOrEqual(4);
    // The deck rises from the west ramp to the span over the rail corridor.
    const knick = points.find((p) => p.id === 'nord-knick')!;
    const span = points.find((p) => p.id === 'sued-mitte')!;
    expect(span.surfaceOrthometric).toBeGreaterThan(knick.surfaceOrthometric);
  });

  it('keeps mid-span at the curated ~48.2 m crest', () => {
    const span = points.find((p) => p.id === 'sued-mitte')!;
    expect(span.surfaceOrthometric).toBeGreaterThanOrEqual(48.0);
    expect(span.surfaceOrthometric).toBeLessThanOrEqual(48.3);
  });

  it('flags site checks exactly where the DOM1 reading departs from the curated mid-span envelope', () => {
    // Curated mid-span 48.1-48.3 with a +/-0.3 m DOM1 error bar: readings at or
    // above 47.8 are corroborated deck; lower readings are the ramp profile.
    for (const p of points) {
      if (p.surfaceOrthometric >= 47.8) {
        expect(p.needsSiteCheck, p.id).toBe(false);
      } else {
        expect(p.needsSiteCheck, p.id).toBe(true);
      }
    }
  });

  it('documents the sampling source on every point', () => {
    for (const p of points) {
      expect(p.source).toMatch(/DOM1 sheet 398_5818/);
      expect(p.source).toContain(p.id === undefined ? '' : p.surfaceOrthometric.toFixed(1));
    }
  });

  it('keeps the computed geometry intact: bearings sweep 279.6-280.4 deg to the Fernsehturm', () => {
    const bearings = points.map((p) => p.bearingToLandmarkDeg);
    expect(Math.min(...bearings)).toBeGreaterThanOrEqual(279.5);
    expect(Math.max(...bearings)).toBeLessThanOrEqual(280.2);
    const distances = points.map((p) => p.distanceToLandmarkM);
    // ~6.1-6.2 km to the Fernsehturm from the bridge.
    for (const d of distances) {
      expect(d).toBeGreaterThan(5500);
      expect(d).toBeLessThan(7000);
    }
  });
});
