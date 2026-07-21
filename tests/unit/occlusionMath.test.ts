import { describe, it, expect } from 'vitest';
import {
  classifyOcclusion,
  rayDirection,
  distance,
} from '../../src/lib/occlusionMath';

/**
 * Pure line-of-sight occlusion classifier — NO Cesium (Constitution Principle I: TDD-first).
 *
 * Coordinate convention for fixtures: observer at the origin, target displaced along +X,
 * so targetDistance == the X displacement. Distances in the intersection list are scalar
 * ranges along the observer->target ray (as produced by a raycaster), NOT coordinates.
 */
const OBSERVER: [number, number, number] = [0, 0, 0];
const TARGET: [number, number, number] = [10, 0, 0]; // targetDistance = 10

describe('classifyOcclusion — clear', () => {
  it('returns "clear" when there are no intersections', () => {
    expect(classifyOcclusion(OBSERVER, TARGET, [])).toBe('clear');
  });

  it('returns "clear" when a building intersection lies beyond targetDistance', () => {
    // distance 15 is outside [targetDistance - eps, targetDistance + eps] AND > targetDistance
    expect(
      classifyOcclusion(OBSERVER, TARGET, [{ distance: 15, kind: 'building' }]),
    ).toBe('clear');
  });

  it('returns "clear" when the only intersection is of kind "other" (non-occluding)', () => {
    expect(
      classifyOcclusion(OBSERVER, TARGET, [{ distance: 5, kind: 'other' }]),
    ).toBe('clear');
  });

  it('returns "clear" for a building intersection hugging the observer (distance <= epsilon)', () => {
    // distance 0.4 < epsilon(0.5): neither in the strict before-window nor near the target
    expect(
      classifyOcclusion(OBSERVER, TARGET, [{ distance: 0.4, kind: 'building' }]),
    ).toBe('clear');
  });
});

describe('classifyOcclusion — occluded', () => {
  it('is "occluded" by a building intersecting strictly before the target', () => {
    // 0.5 < 5 < 9.5 (targetDistance - epsilon)
    expect(
      classifyOcclusion(OBSERVER, TARGET, [{ distance: 5, kind: 'building' }]),
    ).toBe('occluded');
  });

  it('is "occluded" by terrain alone (not just buildings)', () => {
    expect(
      classifyOcclusion(OBSERVER, TARGET, [{ distance: 3, kind: 'terrain' }]),
    ).toBe('occluded');
  });

  it('is "occluded" when one of several intersections lies before the target', () => {
    const xs = [
      { distance: 15, kind: 'building' as const }, // beyond -> clear on its own
      { distance: 5, kind: 'building' as const }, // before -> occludes
      { distance: 9.7, kind: 'terrain' as const }, // marginal on its own
    ];
    // occluded has priority over marginal and clear
    expect(classifyOcclusion(OBSERVER, TARGET, xs)).toBe('occluded');
  });

  it('is "occluded" at the edge of the before-window: just under targetDistance - epsilon', () => {
    // targetDistance - epsilon = 9.5; 9.49 is strictly inside the before-window
    expect(
      classifyOcclusion(OBSERVER, TARGET, [{ distance: 9.49, kind: 'building' }]),
    ).toBe('occluded');
  });
});

describe('classifyOcclusion — marginal', () => {
  it('is "marginal" when an intersection sits exactly at targetDistance', () => {
    expect(
      classifyOcclusion(OBSERVER, TARGET, [{ distance: 10, kind: 'building' }]),
    ).toBe('marginal');
  });

  it('is "marginal" when an intersection is within +epsilon of targetDistance', () => {
    // |10.3 - 10| = 0.3 <= 0.5
    expect(
      classifyOcclusion(OBSERVER, TARGET, [{ distance: 10.3, kind: 'terrain' }]),
    ).toBe('marginal');
  });

  it('is "marginal" when an intersection is within -epsilon of targetDistance', () => {
    // |9.7 - 10| = 0.3 <= 0.5
    expect(
      classifyOcclusion(OBSERVER, TARGET, [{ distance: 9.7, kind: 'building' }]),
    ).toBe('marginal');
  });

  it('is "marginal" at the inclusive boundary: distance == targetDistance + epsilon', () => {
    // |10.5 - 10| = 0.5 <= 0.5 (inclusive)
    expect(
      classifyOcclusion(OBSERVER, TARGET, [{ distance: 10.5, kind: 'building' }]),
    ).toBe('marginal');
  });

  it('is "marginal" at the inclusive boundary: distance == targetDistance - epsilon', () => {
    // distance 9.5: occluded needs strict < 9.5 (false); marginal needs >= 9.5 (true)
    expect(
      classifyOcclusion(OBSERVER, TARGET, [{ distance: 9.5, kind: 'building' }]),
    ).toBe('marginal');
  });

  it('is "marginal" (not clear) when a marginal intersection coexists with a beyond-target one', () => {
    const xs = [
      { distance: 15, kind: 'building' as const }, // beyond -> clear alone
      { distance: 10.3, kind: 'terrain' as const }, // marginal
    ];
    expect(classifyOcclusion(OBSERVER, TARGET, xs)).toBe('marginal');
  });
});

describe('classifyOcclusion — same-point', () => {
  it('returns "same-point" when observer == target (targetDistance == 0)', () => {
    expect(classifyOcclusion(OBSERVER, OBSERVER, [])).toBe('same-point');
  });

  it('returns "same-point" even in the presence of would-be occluding intersections', () => {
    // Short-circuit: same-point wins regardless of intersections.
    expect(
      classifyOcclusion(
        OBSERVER,
        OBSERVER,
        [{ distance: 0.1, kind: 'building' }],
      ),
    ).toBe('same-point');
  });

  it('returns "same-point" when targetDistance is positive but below epsilon', () => {
    // target at [0.3, 0, 0] -> targetDistance 0.3 < 0.5
    expect(classifyOcclusion(OBSERVER, [0.3, 0, 0], [])).toBe('same-point');
  });
});

describe('classifyOcclusion — order independence', () => {
  // Same set of intersections, two different orders, identical result.
  const setA = [
    { distance: 5, kind: 'building' as const },
    { distance: 9.7, kind: 'terrain' as const },
    { distance: 15, kind: 'building' as const },
  ];
  const setB = [...setA].reverse();

  it('an occluding set classifies the same regardless of order (occluded)', () => {
    expect(classifyOcclusion(OBSERVER, TARGET, setA)).toBe(
      classifyOcclusion(OBSERVER, TARGET, setB),
    );
    expect(classifyOcclusion(OBSERVER, TARGET, setA)).toBe('occluded');
  });

  it('a marginal-only set classifies the same regardless of order', () => {
    const m1 = [
      { distance: 15, kind: 'building' as const },
      { distance: 10.2, kind: 'terrain' as const },
    ];
    const m2 = [...m1].reverse();
    expect(classifyOcclusion(OBSERVER, TARGET, m1)).toBe(
      classifyOcclusion(OBSERVER, TARGET, m2),
    );
    expect(classifyOcclusion(OBSERVER, TARGET, m1)).toBe('marginal');
  });
});

describe('classifyOcclusion — custom epsilon', () => {
  it('epsilon widens/narrows the marginal band (marginal at eps=1, occluded at eps=0.2)', () => {
    // distance 9.5, targetDistance 10.
    // eps=1: occluded needs 1 < 9.5 < 9 (false); marginal |9.5-10|=0.5<=1 -> marginal
    expect(
      classifyOcclusion(OBSERVER, TARGET, [{ distance: 9.5, kind: 'building' }], 1),
    ).toBe('marginal');
    // eps=0.2: occluded needs 0.2 < 9.5 < 9.8 -> occluded
    expect(
      classifyOcclusion(OBSERVER, TARGET, [{ distance: 9.5, kind: 'building' }], 0.2),
    ).toBe('occluded');
  });

  it('a larger epsilon can flip a clear target into same-point', () => {
    // targetDistance 0.3 < epsilon 1.0 -> same-point
    expect(classifyOcclusion(OBSERVER, [0.3, 0, 0], [], 1.0)).toBe('same-point');
  });
});

describe('distance', () => {
  it('computes the 3-4-5 hypotenuse', () => {
    expect(distance([0, 0, 0], [3, 4, 0])).toBeCloseTo(5, 10);
  });

  it('is symmetric (distance(a,b) == distance(b,a))', () => {
    const a: [number, number, number] = [1, 2, 3];
    const b: [number, number, number] = [4, 6, 11];
    expect(distance(a, b)).toBeCloseTo(distance(b, a), 10);
  });

  it('is 0 for identical points', () => {
    expect(distance([7, 7, 7], [7, 7, 7])).toBe(0);
  });

  it('accounts for the Z component (3D, not 2D)', () => {
    // [0,0,0]->[0,0,5] is 5; if it ignored Z it would be 0
    expect(distance([0, 0, 0], [0, 0, 5])).toBeCloseTo(5, 10);
  });
});

describe('rayDirection', () => {
  it('points along +X for a target on the X axis and is unit-length', () => {
    const d = rayDirection([0, 0, 0], [10, 0, 0]);
    expect(d[0]).toBeCloseTo(1, 10);
    expect(d[1]).toBeCloseTo(0, 10);
    expect(d[2]).toBeCloseTo(0, 10);
  });

  it('points along +Y for a target on the Y axis', () => {
    const d = rayDirection([0, 0, 0], [0, 5, 0]);
    expect(d[0]).toBeCloseTo(0, 10);
    expect(d[1]).toBeCloseTo(1, 10);
    expect(d[2]).toBeCloseTo(0, 10);
  });

  it('normalizes a non-axis-aligned vector (3,4,0 -> 0.6,0.8,0)', () => {
    const d = rayDirection([0, 0, 0], [3, 4, 0]);
    expect(d[0]).toBeCloseTo(0.6, 10);
    expect(d[1]).toBeCloseTo(0.8, 10);
    expect(d[2]).toBeCloseTo(0, 10);
  });

  it('always returns a unit vector (magnitude 1) for non-coincident points', () => {
    const d = rayDirection([1, 2, 3], [4, 6, 11]);
    const mag = Math.hypot(d[0]!, d[1]!, d[2]!);
    expect(mag).toBeCloseTo(1, 10);
  });

  it('is independent of the observer origin (a translated ray has the same direction)', () => {
    const a = rayDirection([0, 0, 0], [3, 4, 0]);
    const b = rayDirection([100, 100, 100], [103, 104, 100]);
    expect(b[0]).toBeCloseTo(a[0]!, 10);
    expect(b[1]).toBeCloseTo(a[1]!, 10);
    expect(b[2]).toBeCloseTo(a[2]!, 10);
  });
});
