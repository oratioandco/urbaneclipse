/**
 * Area-solver tests — "where AND when do I stand for this shot?"
 *
 * The key property under test is the reduction: instead of searching a 3-D grid of
 * (lat, lon, t), the solver SOLVES for the observer position at each instant, because
 * the body's direction is effectively constant across a small search area.
 */
import { describe, it, expect } from 'vitest';
import {
  solveObserverPosition,
  evaluateCandidate,
  findCompositions,
  isInsideArea,
  circleToPolygon,
  feasibility,
  type GroundProvider,
  type BodySample,
} from '../../src/lib/areaSolver.js';
import { FERNSEHTURM } from '../../src/lib/landmarks.js';
import { azAltTo } from '../../src/lib/silhouette.js';
import { resolveEyeEllipsoidalHeight } from '../../src/lib/elevation.js';
import { MOON_RADIUS_KM, SUN_RADIUS_KM } from '../../src/lib/occultation.js';

/** Flat Berlin ground for deterministic tests. */
const FLAT_GROUND: GroundProvider = () => 34.6;

const SPHERE_AGL = 213;

const moon = (az: number, alt: number): BodySample => ({
  az,
  alt,
  distanceKm: 384400,
  radiusKm: MOON_RADIUS_KM,
});

describe('isInsideArea', () => {
  const square = [
    { lat: 52.5, lon: 13.4 },
    { lat: 52.5, lon: 13.5 },
    { lat: 52.6, lon: 13.5 },
    { lat: 52.6, lon: 13.4 },
  ];

  it('accepts an interior point', () => {
    expect(isInsideArea({ lat: 52.55, lon: 13.45 }, square)).toBe(true);
  });

  it('rejects an exterior point', () => {
    expect(isInsideArea({ lat: 52.55, lon: 13.7 }, square)).toBe(false);
    expect(isInsideArea({ lat: 52.4, lon: 13.45 }, square)).toBe(false);
  });

  it('rejects degenerate polygons rather than throwing', () => {
    expect(isInsideArea({ lat: 52.5, lon: 13.4 }, [])).toBe(false);
    expect(isInsideArea({ lat: 52.5, lon: 13.4 }, [{ lat: 52.5, lon: 13.4 }])).toBe(false);
  });
});

describe('solveObserverPosition', () => {
  const opts = {
    landmark: FERNSEHTURM,
    featureHeightAgl: SPHERE_AGL,
    eyeHeight: 1.5,
    ground: FLAT_GROUND,
  };

  it('places the observer so the feature sits exactly at the body altitude', () => {
    // THE core invariant. Solve, then verify by independent forward computation.
    for (const alt of [2, 5, 10, 20, 35]) {
      const solved = solveObserverPosition(moon(270, alt), opts);
      expect(solved, `alt=${alt}`).not.toBeNull();

      const check = azAltTo(
        {
          lat: solved!.position.lat,
          lon: solved!.position.lon,
          ellipsoidalHeight: solved!.eyeEllipsoidalHeight,
        },
        FERNSEHTURM.lat,
        FERNSEHTURM.lon,
        resolveEyeEllipsoidalHeight({ groundOrthometric: 34.6, eyeHeight: 0 }) + SPHERE_AGL,
      );
      expect(check.alt).toBeCloseTo(alt, 2);
    }
  });

  it('places the observer opposite the body azimuth, looking back at the landmark', () => {
    // Moon in the west (az 270) => stand EAST of the tower and look west.
    const solved = solveObserverPosition(moon(270, 10), opts);
    expect(solved).not.toBeNull();
    expect(solved!.position.lon).toBeGreaterThan(FERNSEHTURM.lon);

    // Moon in the east (az 90) => stand WEST of the tower.
    const east = solveObserverPosition(moon(90, 10), opts);
    expect(east!.position.lon).toBeLessThan(FERNSEHTURM.lon);
  });

  it('moves the observer further out as the body sinks toward the horizon', () => {
    const high = solveObserverPosition(moon(270, 30), opts)!;
    const low = solveObserverPosition(moon(270, 3), opts)!;
    expect(low.distanceM).toBeGreaterThan(high.distanceM);
  });

  it('returns null for a body at or below the horizon', () => {
    expect(solveObserverPosition(moon(270, 0), opts)).toBeNull();
    expect(solveObserverPosition(moon(270, -5), opts)).toBeNull();
  });

  it('converges to the same distance regardless of azimuth on flat ground', () => {
    const a = solveObserverPosition(moon(0, 10), opts)!;
    const b = solveObserverPosition(moon(180, 10), opts)!;
    expect(a.distanceM).toBeCloseTo(b.distanceM, 0);
  });

  it('accounts for terrain: standing on higher ground moves you closer', () => {
    // Higher ground raises the eye, shrinking the height difference to the sphere, so
    // the same elevation angle is reached at a shorter distance.
    const low = solveObserverPosition(moon(270, 10), { ...opts, ground: () => 30 })!;
    const high = solveObserverPosition(moon(270, 10), { ...opts, ground: () => 80 })!;
    expect(high.distanceM).toBeLessThan(low.distanceM);
  });
});

describe('evaluateCandidate', () => {
  const opts = {
    landmark: FERNSEHTURM,
    featureHeightAgl: SPHERE_AGL,
    eyeHeight: 1.5,
    ground: FLAT_GROUND,
  };

  it('reports a real occultation at the solved position', () => {
    const c = evaluateCandidate(new Date('2026-08-01T20:00:00Z'), moon(270, 10), opts);
    expect(c).not.toBeNull();
    // Solved for alignment, so the disc must actually be on the silhouette.
    expect(['full', 'partial']).toContain(c!.kind);
    expect(c!.coveredFraction).toBeGreaterThan(0);
  });

  it('marks candidates outside the requested area', () => {
    const tinyFarAway = [
      { lat: 52.0, lon: 13.0 },
      { lat: 52.0, lon: 13.01 },
      { lat: 52.01, lon: 13.01 },
      { lat: 52.01, lon: 13.0 },
    ];
    const c = evaluateCandidate(new Date(), moon(270, 10), { ...opts, area: tinyFarAway });
    expect(c!.withinArea).toBe(false);
  });

  it('body altitude sets the solved distance, which decides full vs partial', () => {
    // Aiming at the sphere, the required distance is ~213 m / tan(alt). So the body's
    // altitude alone determines how far out you stand, and therefore whether a FULL
    // occultation is even reachable (needs < ~3540 m for a mean-distance moon).
    const near = evaluateCandidate(new Date(), moon(270, 25), opts)!; // ~457 m
    const far = evaluateCandidate(new Date(), moon(270, 2), opts)!; // ~6100 m

    expect(near.distanceM).toBeLessThan(far.distanceM);
    expect(near.distanceM).toBeLessThan(3540);
    expect(far.distanceM).toBeGreaterThan(3540);

    expect(near.kind).toBe('full');
    expect(near.coveredFraction).toBeCloseTo(1, 6);

    // At Lichtenberger-Brücke range the tower is narrower than the moon.
    expect(far.kind).toBe('partial');
    expect(far.coveredFraction).toBeLessThan(0.6);
  });

  it('a 2 deg moon altitude reproduces the Lichtenberger Brücke geometry', () => {
    // Sanity anchor tying the solver back to the real-world case: to see the sphere
    // from ~6.1 km the moon must sit only ~2 deg up.
    const c = evaluateCandidate(new Date(), moon(288, 2), opts)!;
    expect(c.distanceM).toBeGreaterThan(5800);
    expect(c.distanceM).toBeLessThan(6400);
    expect(c.kind).toBe('partial');
  });
});

describe('findCompositions', () => {
  const base = {
    landmark: FERNSEHTURM,
    featureHeightAgl: SPHERE_AGL,
    eyeHeight: 1.5,
    ground: FLAT_GROUND,
  };

  /** Synthetic body tracking across the sky so the sweep is deterministic. */
  const bodyAt = (t: Date): BodySample => {
    const hours = (t.getTime() - Date.UTC(2026, 7, 1)) / 3_600_000;
    return moon(240 + hours * 5, 5 + hours * 2);
  };

  it('returns ranked candidates, best first', () => {
    const res = findCompositions({
      ...base,
      start: new Date(Date.UTC(2026, 7, 1, 0, 0)),
      end: new Date(Date.UTC(2026, 7, 1, 6, 0)),
      stepMinutes: 30,
      bodyAt,
      requireWithinArea: false,
    });

    expect(res.length).toBeGreaterThan(0);
    for (let i = 1; i < res.length; i++) {
      const prev = res[i - 1];
      const cur = res[i];
      const rank = (k: string) => (k === 'full' ? 2 : k === 'partial' ? 1 : 0);
      expect(rank(prev.kind)).toBeGreaterThanOrEqual(rank(cur.kind));
    }
  });

  it('filters to the requested composition kinds', () => {
    const res = findCompositions({
      ...base,
      start: new Date(Date.UTC(2026, 7, 1, 0, 0)),
      end: new Date(Date.UTC(2026, 7, 1, 6, 0)),
      stepMinutes: 30,
      bodyAt,
      wanted: ['adjacent'],
      requireWithinArea: false,
    });
    for (const c of res) expect(c.kind).toBe('adjacent');
  });

  it('returns nothing when the area excludes every solved position', () => {
    const elsewhere = [
      { lat: 40.0, lon: -70.0 },
      { lat: 40.0, lon: -69.9 },
      { lat: 40.1, lon: -69.9 },
      { lat: 40.1, lon: -70.0 },
    ];
    const res = findCompositions({
      ...base,
      area: elsewhere,
      start: new Date(Date.UTC(2026, 7, 1, 0, 0)),
      end: new Date(Date.UTC(2026, 7, 1, 6, 0)),
      stepMinutes: 30,
      bodyAt,
    });
    expect(res).toEqual([]);
  });

  it('respects the limit', () => {
    const res = findCompositions({
      ...base,
      start: new Date(Date.UTC(2026, 7, 1, 0, 0)),
      end: new Date(Date.UTC(2026, 7, 1, 8, 0)),
      stepMinutes: 5,
      bodyAt,
      requireWithinArea: false,
      limit: 3,
    });
    expect(res.length).toBeLessThanOrEqual(3);
  });

  it('rejects a non-positive step and a reversed window', () => {
    const bad = {
      ...base,
      start: new Date(Date.UTC(2026, 7, 1)),
      end: new Date(Date.UTC(2026, 7, 2)),
      bodyAt,
    };
    expect(() => findCompositions({ ...bad, stepMinutes: 0 })).toThrow();
    expect(() =>
      findCompositions({
        ...bad,
        stepMinutes: 10,
        start: new Date(Date.UTC(2026, 7, 3)),
      }),
    ).toThrow();
  });
});

describe('feasibility', () => {
  it('declares a full occultation impossible from the Lichtenberger Brücke', () => {
    // The headline planning fact: 32 m of tower vs a ~0.518 deg moon at 6160 m.
    const f = feasibility(
      FERNSEHTURM,
      { distanceKm: 384400, radiusKm: MOON_RADIUS_KM },
      6160,
    );
    expect(f.fullPossible).toBe(false);
    expect(f.landmarkWidthDeg).toBeCloseTo(0.298, 2);
    expect(f.maxRangeForFullM).toBeGreaterThan(3400);
    expect(f.maxRangeForFullM).toBeLessThan(3700);
  });

  it('declares it possible once you are close enough', () => {
    const f = feasibility(FERNSEHTURM, { distanceKm: 384400, radiusKm: MOON_RADIUS_KM }, 3000);
    expect(f.fullPossible).toBe(true);
  });

  it('a perigee supermoon is the LEAST forgiving case', () => {
    const mean = feasibility(FERNSEHTURM, { distanceKm: 384400, radiusKm: MOON_RADIUS_KM }, 5000);
    const perigee = feasibility(
      FERNSEHTURM,
      { distanceKm: 356500, radiusKm: MOON_RADIUS_KM },
      5000,
    );
    expect(perigee.maxRangeForFullM).toBeLessThan(mean.maxRangeForFullM);
  });

  it('handles the sun', () => {
    const f = feasibility(FERNSEHTURM, { distanceKm: 149.6e6, radiusKm: SUN_RADIUS_KM }, 6160);
    expect(f.fullPossible).toBe(false);
    expect(f.maxRangeForFullM).toBeCloseTo(3441, -2);
  });
});

describe('circleToPolygon', () => {
  const centre = { lat: 52.5113, lon: 13.4988 };

  it('produces points at the requested radius, not an east-west ellipse', () => {
    // Longitude degrees are ~64% shorter than latitude degrees at Berlin. Failing to
    // scale by cos(lat) would stretch the area badly in the east-west direction.
    const poly = circleToPolygon(centre, 500);
    const mPerDegLat = 111_320;
    const mPerDegLon = 111_320 * Math.cos((centre.lat * Math.PI) / 180);

    for (const p of poly) {
      const dy = (p.lat - centre.lat) * mPerDegLat;
      const dx = (p.lon - centre.lon) * mPerDegLon;
      expect(Math.hypot(dx, dy)).toBeCloseTo(500, 0);
    }
  });

  it('contains its centre and excludes points beyond the radius', () => {
    const poly = circleToPolygon(centre, 300);
    expect(isInsideArea(centre, poly)).toBe(true);

    // ~1 km north — comfortably outside a 300 m circle.
    expect(isInsideArea({ lat: centre.lat + 0.009, lon: centre.lon }, poly)).toBe(false);
  });

  it('rejects a non-positive or non-finite radius', () => {
    expect(() => circleToPolygon(centre, 0)).toThrow();
    expect(() => circleToPolygon(centre, -10)).toThrow();
    expect(() => circleToPolygon(centre, NaN)).toThrow();
  });

  it('rejects a non-finite centre', () => {
    expect(() => circleToPolygon({ lat: NaN, lon: 13.4 }, 100)).toThrow();
  });

  it('more segments approximate the circle more closely', () => {
    // Area of an inscribed regular n-gon approaches pi r^2 as n grows.
    const area = (poly: { lat: number; lon: number }[]) => {
      let a = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        a += poly[j].lon * poly[i].lat - poly[i].lon * poly[j].lat;
      }
      return Math.abs(a / 2);
    };
    expect(area(circleToPolygon(centre, 500, 64))).toBeGreaterThan(
      area(circleToPolygon(centre, 500, 8)),
    );
  });
});

describe('ranking prefers reachable results', () => {
  const base = {
    landmark: FERNSEHTURM,
    featureHeightAgl: SPHERE_AGL,
    eyeHeight: 1.5,
    ground: FLAT_GROUND,
  };

  it('puts within-area candidates above better-but-unreachable ones', () => {
    // Sweep a range of body altitudes so solved positions land at many distances, with
    // an area covering only some of them.
    const bodyAt = (t: Date): BodySample => {
      const h = (t.getTime() - Date.UTC(2026, 7, 1)) / 3_600_000;
      return moon(270, 2 + h * 3);
    };
    // A ring roughly 6 km east of the tower — where the LOW-altitude (partial-only)
    // solutions land, not the high-altitude full ones.
    const far = circleToPolygon({ lat: FERNSEHTURM.lat, lon: FERNSEHTURM.lon + 0.09 }, 1500);

    const res = findCompositions({
      ...base,
      area: far,
      start: new Date(Date.UTC(2026, 7, 1, 0, 0)),
      end: new Date(Date.UTC(2026, 7, 1, 9, 0)),
      stepMinutes: 15,
      bodyAt,
      requireWithinArea: false,
      limit: 200,
    });

    const firstOutside = res.findIndex((c) => !c.withinArea);
    const lastInside = res.map((c) => c.withinArea).lastIndexOf(true);

    // If both groups are present, every reachable one must precede every unreachable one.
    if (firstOutside !== -1 && lastInside !== -1) {
      expect(lastInside).toBeLessThan(firstOutside);
    }
    expect(res.length).toBeGreaterThan(0);
  });
});
