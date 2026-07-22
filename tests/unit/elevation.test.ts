/**
 * Elevation / vertical-datum core tests.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * A datum bug placed the observer ~72 m underground. The chain:
 *   - Berlin LoD2 CityGML Z values are DHHN2016 NORMAL (orthometric) heights.
 *   - scripts/convert_tile.py lifts them to WGS84 ELLIPSOIDAL heights by adding the
 *     Berlin geoid undulation (GEOID_UNDULATION_BERLIN = 39.5 m), so building bases
 *     sit near 73.5 m ellipsoidal (~34 m ground + 39.5 m geoid).
 *   - The app has NO terrain provider, and src/cesium/lineOfSight.ts assumed
 *     "ground ~= 0", so observerHeight = 1.5 was interpreted as 1.5 m ELLIPSOIDAL —
 *     roughly 72 m below the street.
 *
 * This module is the single place where the three vertical references are related:
 *   orthometric (DHHN2016, what humans and DGM1/CityGML quote)
 *   ellipsoidal (WGS84, what Cesium consumes)
 *   eye height   (metres above the surface you are standing on)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  GEOID_UNDULATION_BERLIN,
  orthometricToEllipsoidal,
  ellipsoidalToOrthometric,
  resolveEyeEllipsoidalHeight,
  BERLIN_GROUND_ORTHOMETRIC_FALLBACK,
} from '../../src/lib/elevation.js';

describe('geoid undulation constant', () => {
  it('stays numerically in sync with scripts/convert_tile.py', () => {
    // LOAD-BEARING GUARD. The building geometry is baked with the Python constant.
    // If the two ever drift apart, every building silently sits at the wrong height
    // relative to the observer — the exact class of bug this module was written to
    // fix. Fail loudly at test time instead.
    const py = readFileSync('scripts/convert_tile.py', 'utf8');
    const m = py.match(/GEOID_UNDULATION_BERLIN\s*=\s*([0-9.]+)/);
    expect(m, 'GEOID_UNDULATION_BERLIN not found in scripts/convert_tile.py').not.toBeNull();
    expect(Number(m![1])).toBe(GEOID_UNDULATION_BERLIN);
  });

  it('is a plausible Berlin geoid undulation', () => {
    // ETRS89/GRS80 geoid height across Berlin is ~39-40 m. Guards a fat-finger edit.
    expect(GEOID_UNDULATION_BERLIN).toBeGreaterThan(35);
    expect(GEOID_UNDULATION_BERLIN).toBeLessThan(45);
  });
});

describe('orthometricToEllipsoidal / ellipsoidalToOrthometric', () => {
  it('adds the undulation: h = H + N', () => {
    expect(orthometricToEllipsoidal(34)).toBeCloseTo(73.5, 10);
    expect(orthometricToEllipsoidal(0)).toBeCloseTo(GEOID_UNDULATION_BERLIN, 10);
  });

  it('subtracts the undulation: H = h - N', () => {
    expect(ellipsoidalToOrthometric(73.5)).toBeCloseTo(34, 10);
  });

  it('round-trips exactly', () => {
    for (const H of [-5, 0, 34, 66, 115, 368]) {
      expect(ellipsoidalToOrthometric(orthometricToEllipsoidal(H))).toBeCloseTo(H, 9);
    }
  });

  it('rejects non-finite input rather than propagating NaN into the scene', () => {
    expect(() => orthometricToEllipsoidal(NaN)).toThrow();
    expect(() => orthometricToEllipsoidal(Infinity)).toThrow();
    expect(() => ellipsoidalToOrthometric(NaN)).toThrow();
  });
});

describe('resolveEyeEllipsoidalHeight', () => {
  it('places a 1.5 m observer on 34 m Berlin ground at ~75 m ellipsoidal', () => {
    // The headline fix: previously this produced 1.5.
    expect(resolveEyeEllipsoidalHeight({ groundOrthometric: 34, eyeHeight: 1.5 })).toBeCloseTo(
      75,
      10,
    );
  });

  it('is the sum ground + undulation + eye height', () => {
    const r = resolveEyeEllipsoidalHeight({ groundOrthometric: 50, eyeHeight: 2 });
    expect(r).toBeCloseTo(50 + GEOID_UNDULATION_BERLIN + 2, 10);
  });

  it('uses a surfaceOrthometric override (bridge deck) in place of terrain ground', () => {
    // Lichtenberger Bruecke: DGM1 returns the rail cutting BELOW the bridge, not the
    // deck the photographer stands on. An explicit deck elevation must win.
    const onTerrain = resolveEyeEllipsoidalHeight({ groundOrthometric: 32, eyeHeight: 1.5 });
    const onDeck = resolveEyeEllipsoidalHeight({
      groundOrthometric: 32,
      surfaceOrthometric: 41,
      eyeHeight: 1.5,
    });
    expect(onDeck - onTerrain).toBeCloseTo(9, 10);
  });

  it('falls back to the Berlin mean ground when no sample is available', () => {
    const r = resolveEyeEllipsoidalHeight({ groundOrthometric: undefined, eyeHeight: 1.5 });
    expect(r).toBeCloseTo(BERLIN_GROUND_ORTHOMETRIC_FALLBACK + GEOID_UNDULATION_BERLIN + 1.5, 10);
  });

  it('rejects a negative eye height (you cannot stand below your own feet)', () => {
    expect(() => resolveEyeEllipsoidalHeight({ groundOrthometric: 34, eyeHeight: -1 })).toThrow();
  });

  it('rejects non-finite ground / eye values', () => {
    expect(() => resolveEyeEllipsoidalHeight({ groundOrthometric: NaN, eyeHeight: 1.5 })).toThrow();
    expect(() => resolveEyeEllipsoidalHeight({ groundOrthometric: 34, eyeHeight: NaN })).toThrow();
  });

  it('rejects an implausible ground elevation for Berlin', () => {
    // Guards against a heightmap sampled in the wrong CRS or with the geoid already
    // baked in — both would silently yield a ~40 m or ~400000 m error.
    expect(() => resolveEyeEllipsoidalHeight({ groundOrthometric: 5000, eyeHeight: 1.5 })).toThrow();
    expect(() => resolveEyeEllipsoidalHeight({ groundOrthometric: -500, eyeHeight: 1.5 })).toThrow();
  });
});
