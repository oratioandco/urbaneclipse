/**
 * Scene-height resolution tests — the layer that finally fixes the 72 m bug at runtime.
 */
import { describe, it, expect } from 'vitest';
import { resolveObserverHeight, resolveTargetHeight } from '../../src/lib/sceneHeights.js';
import { LICHTENBERGER_BRUECKE } from '../../src/lib/viewpoints.js';
import {
  GEOID_UNDULATION_BERLIN,
  BERLIN_GROUND_ORTHOMETRIC_FALLBACK,
} from '../../src/lib/elevation.js';

const flat = (h: number) => () => h;
const noCoverage = () => undefined;

describe('resolveObserverHeight', () => {
  it('puts a 1.5 m observer on 36 m terrain at 77 m ellipsoidal, not 1.5', () => {
    // THE regression. Previously observerHeight reached Cesium verbatim as 1.5 m
    // ellipsoidal — ~72 m below Berlin's streets and beneath every building base.
    const r = resolveObserverHeight(52.51, 13.45, 1.5, flat(36));
    expect(r.ellipsoidalHeight).toBeCloseTo(36 + GEOID_UNDULATION_BERLIN + 1.5, 9);
    expect(r.ellipsoidalHeight).toBeGreaterThan(70);
    expect(r.surfaceSource).toBe('terrain');
  });

  it('prefers a curated viewpoint surface over the terrain sample', () => {
    // On the Lichtenberger Brücke, DGM1 returns the rail cutting ~8.8 m below the deck.
    const r = resolveObserverHeight(
      LICHTENBERGER_BRUECKE.lat,
      LICHTENBERGER_BRUECKE.lon,
      1.5,
      flat(39.3), // terrain: the cutting
      LICHTENBERGER_BRUECKE,
    );
    expect(r.surfaceSource).toBe('viewpoint');
    expect(r.surfaceOrthometric).toBe(48.2);
    expect(r.ellipsoidalHeight).toBeCloseTo(48.2 + GEOID_UNDULATION_BERLIN + 1.5, 9);

    const onTerrain = resolveObserverHeight(
      LICHTENBERGER_BRUECKE.lat,
      LICHTENBERGER_BRUECKE.lon,
      1.5,
      flat(39.3),
    );
    expect(r.ellipsoidalHeight - onTerrain.ellipsoidalHeight).toBeCloseTo(8.9, 6);
  });

  it('falls back and SAYS SO when the heightmap misses', () => {
    const r = resolveObserverHeight(52.51, 13.45, 1.5, noCoverage);
    expect(r.surfaceSource).toBe('fallback');
    expect(r.surfaceOrthometric).toBe(BERLIN_GROUND_ORTHOMETRIC_FALLBACK);
    // Still vastly better than the 1.5 m it used to produce.
    expect(r.ellipsoidalHeight).toBeGreaterThan(70);
  });

  it('applies the geoid exactly once', () => {
    // Double-applying would add another ~39.5 m; the guard is that the difference
    // between two eye heights is exactly the eye-height difference.
    const a = resolveObserverHeight(52.51, 13.45, 1.5, flat(36));
    const b = resolveObserverHeight(52.51, 13.45, 11.5, flat(36));
    expect(b.ellipsoidalHeight - a.ellipsoidalHeight).toBeCloseTo(10, 9);
  });

  it('a viewpoint without a surface override still uses terrain', () => {
    const groundLevel = { ...LICHTENBERGER_BRUECKE, surfaceOrthometric: undefined };
    const r = resolveObserverHeight(52.51, 13.45, 1.5, flat(36), groundLevel);
    expect(r.surfaceSource).toBe('terrain');
  });
});

describe('resolveTargetHeight', () => {
  it('measures the target from its own base, not the ellipsoid', () => {
    // The Fernsehturm is "368 m tall", not "441 m ellipsoidal".
    const r = resolveTargetHeight(52.520815, 13.409419, 368.03, flat(34.6));
    expect(r.ellipsoidalHeight).toBeCloseTo(34.6 + GEOID_UNDULATION_BERLIN + 368.03, 6);
    expect(r.ellipsoidalHeight).toBeCloseTo(442.13, 2);
  });

  it('falls back when the heightmap misses', () => {
    const r = resolveTargetHeight(52.52, 13.41, 100, noCoverage);
    expect(r.surfaceSource).toBe('fallback');
  });

  it('rejects a negative or non-finite height above base', () => {
    expect(() => resolveTargetHeight(52.52, 13.41, -1, flat(34.6))).toThrow();
    expect(() => resolveTargetHeight(52.52, 13.41, NaN, flat(34.6))).toThrow();
  });

  it('observer and target share the same datum, so their difference is physical', () => {
    // The whole point: both sides must be in the same reference or the sightline is
    // geometrically meaningless even when it "looks" plausible.
    const obs = resolveObserverHeight(52.5113, 13.4988, 1.5, flat(39.3), LICHTENBERGER_BRUECKE);
    const tgt = resolveTargetHeight(52.520815, 13.409419, 368.03, flat(34.6));
    const rise = tgt.ellipsoidalHeight - obs.ellipsoidalHeight;
    // Deck 48.2 + 1.5 eye = 49.7 m; tower tip 34.6 + 368.03 = 402.63 m. Rise ~352.9 m.
    expect(rise).toBeCloseTo(402.63 - 49.7, 2);
  });
});
