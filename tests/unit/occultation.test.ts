/**
 * Urban-eclipse occultation core tests.
 *
 * "Urban eclipse" = the sun or moon disc passing BEHIND a building silhouette, as
 * seen through a telephoto lens from km away. Not an astronomical eclipse.
 *
 * The classification the product is built on:
 *   full     — disc entirely inside the silhouette
 *   partial  — disc partly overlapping the silhouette
 *   adjacent — disc clear of the silhouette but close (crescent beside the spire)
 *   clear    — disc nowhere near it
 *
 * Everything here works in a LOCAL TANGENT-PLANE angular frame centred on the disc,
 * in degrees. At the scales involved (discs ~0.52 deg wide, structures under ~1 deg)
 * the small-angle planar approximation is accurate to far better than the ~0.05 deg
 * composition tolerance.
 */
import { describe, it, expect } from 'vitest';
import {
  SUN_RADIUS_KM,
  MOON_RADIUS_KM,
  angularRadiusDeg,
  circlePolygonIntersectionArea,
  classifyOccultation,
  type AngularPoint,
} from '../../src/lib/occultation.js';

/** Regular n-gon approximating a circle of radius `r` centred at (cx, cy). */
function disc(r: number, cx = 0, cy = 0, n = 512): AngularPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
  });
}

/** Axis-aligned rectangle as a polygon. */
function rect(x0: number, y0: number, x1: number, y1: number): AngularPoint[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

describe('angularRadiusDeg', () => {
  it('gives the sun a ~0.266 deg angular radius at 1 AU', () => {
    // Sun's apparent DIAMETER is ~0.533 deg.
    expect(angularRadiusDeg(SUN_RADIUS_KM, 149.6e6)).toBeCloseTo(0.2666, 3);
  });

  it('spans the moon perigee-to-apogee range', () => {
    // Perigee ~356500 km, apogee ~406700 km. This variation is ~14% of the moon's
    // own size and matters for "fully behind" vs "partial" at the margin.
    const perigee = angularRadiusDeg(MOON_RADIUS_KM, 356500);
    const apogee = angularRadiusDeg(MOON_RADIUS_KM, 406700);
    expect(perigee).toBeCloseTo(0.2793, 3);
    expect(apogee).toBeCloseTo(0.2448, 3);
    expect(perigee).toBeGreaterThan(apogee);
  });

  it('rejects nonsensical geometry', () => {
    expect(() => angularRadiusDeg(MOON_RADIUS_KM, 0)).toThrow();
    expect(() => angularRadiusDeg(-1, 1000)).toThrow();
    expect(() => angularRadiusDeg(MOON_RADIUS_KM, NaN)).toThrow();
  });
});

describe('circlePolygonIntersectionArea', () => {
  const R = 0.26;
  const FULL = Math.PI * R * R;

  it('returns the whole disc when the polygon contains it', () => {
    expect(circlePolygonIntersectionArea(R, rect(-10, -10, 10, 10))).toBeCloseTo(FULL, 6);
  });

  it('returns zero when the polygon is disjoint', () => {
    expect(circlePolygonIntersectionArea(R, rect(5, 5, 6, 6))).toBeCloseTo(0, 12);
  });

  it('halves the disc for a half-plane through the centre', () => {
    expect(circlePolygonIntersectionArea(R, rect(0, -10, 10, 10))).toBeCloseTo(FULL / 2, 6);
  });

  it('quarters the disc for a quadrant', () => {
    expect(circlePolygonIntersectionArea(R, rect(0, 0, 10, 10))).toBeCloseTo(FULL / 4, 6);
  });

  it('returns the polygon area when the polygon is inside the circle', () => {
    // A small square well within the disc contributes its own area, not the disc's.
    expect(circlePolygonIntersectionArea(R, rect(-0.05, -0.05, 0.05, 0.05))).toBeCloseTo(0.01, 6);
  });

  it('is invariant to polygon winding direction', () => {
    const cw = rect(0, -10, 10, 10);
    const ccw = [...cw].reverse();
    expect(circlePolygonIntersectionArea(R, ccw)).toBeCloseTo(
      circlePolygonIntersectionArea(R, cw),
      12,
    );
  });

  it('agrees with a known circle-circle overlap', () => {
    // Two equal circles whose centres are exactly one radius apart overlap by
    // 2r^2*(pi/3) - (sqrt(3)/2)r^2  ->  lens area.
    const lens = 2 * R * R * (Math.PI / 3) - (Math.sqrt(3) / 2) * R * R;
    expect(circlePolygonIntersectionArea(R, disc(R, R, 0))).toBeCloseTo(lens, 4);
  });

  it('degenerate polygons contribute no area', () => {
    expect(circlePolygonIntersectionArea(R, [])).toBe(0);
    expect(circlePolygonIntersectionArea(R, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeCloseTo(0, 12);
  });
});

describe('classifyOccultation', () => {
  const R = 0.26; // moon-ish

  it('reports FULL when the silhouette swallows the disc', () => {
    const r = classifyOccultation(R, rect(-1, -1, 1, 1));
    expect(r.kind).toBe('full');
    expect(r.coveredFraction).toBeCloseTo(1, 6);
  });

  it('reports PARTIAL for a half-covered disc, with the right fraction', () => {
    const r = classifyOccultation(R, rect(0, -1, 1, 1));
    expect(r.kind).toBe('partial');
    expect(r.coveredFraction).toBeCloseTo(0.5, 4);
  });

  it('reports ADJACENT for a near miss — the crescent-beside-the-spire case', () => {
    // Silhouette edge sits 0.1 deg clear of the disc's limb.
    const r = classifyOccultation(R, rect(R + 0.1, -1, 1, 1), { adjacentWithinDeg: 0.5 });
    expect(r.kind).toBe('adjacent');
    expect(r.coveredFraction).toBeCloseTo(0, 9);
    expect(r.separationDeg).toBeCloseTo(0.1, 6);
  });

  it('reports CLEAR when the silhouette is far away', () => {
    const r = classifyOccultation(R, rect(5, -1, 6, 1), { adjacentWithinDeg: 0.5 });
    expect(r.kind).toBe('clear');
    expect(r.coveredFraction).toBe(0);
  });

  it('separationDeg is zero whenever the disc is touched at all', () => {
    expect(classifyOccultation(R, rect(0, -1, 1, 1)).separationDeg).toBe(0);
    expect(classifyOccultation(R, rect(-1, -1, 1, 1)).separationDeg).toBe(0);
  });

  it('a grazing silhouette just short of the limb is adjacent, not partial', () => {
    const r = classifyOccultation(R, rect(R + 1e-6, -1, 1, 1), { adjacentWithinDeg: 0.5 });
    expect(r.kind).toBe('adjacent');
  });

  it('distinguishes full from partial at the tower-width boundary', () => {
    // A silhouette exactly as wide as the disc, centred: covers it vertically but
    // only just — must NOT be reported as full once it narrows.
    expect(classifyOccultation(R, rect(-R * 0.9, -1, R * 0.9, 1)).kind).toBe('partial');
    expect(classifyOccultation(R, rect(-R * 1.1, -1, R * 1.1, 1)).kind).toBe('full');
  });

  it('a silhouette edge exactly tangent to the limb covers nothing', () => {
    // REGRESSION. Tangency makes the circle-line discriminant exactly zero, so no
    // split point is recorded and the edge midpoint lands exactly on the circle. A
    // non-strict interior test classified the whole tangent edge as inside and
    // reported ~80% coverage for what is measure-zero contact. Tangency is precisely
    // the full/partial boundary a transit sweep crosses, so it must be exact.
    const r = classifyOccultation(R, rect(R, -1, 1, 1), { adjacentWithinDeg: 1 });
    expect(r.coveredFraction).toBeCloseTo(0, 9);
    expect(r.kind).toBe('adjacent');
  });

  it('treats an empty silhouette as clear rather than throwing', () => {
    const r = classifyOccultation(R, []);
    expect(r.kind).toBe('clear');
    expect(r.coveredFraction).toBe(0);
  });

  it('rejects a non-positive disc radius', () => {
    expect(() => classifyOccultation(0, rect(-1, -1, 1, 1))).toThrow();
    expect(() => classifyOccultation(NaN, rect(-1, -1, 1, 1))).toThrow();
  });

  it('coveredFraction is monotonic as the silhouette sweeps across the disc', () => {
    // Models the disc transiting behind a tower edge: coverage must rise monotonically.
    const fractions = [];
    for (let edge = R; edge >= -R; edge -= R / 10) {
      fractions.push(classifyOccultation(R, rect(edge, -1, 1, 1)).coveredFraction);
    }
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1] - 1e-9);
    }
    expect(fractions[0]).toBeCloseTo(0, 6);
    expect(fractions[fractions.length - 1]).toBeCloseTo(1, 6);
  });
});
