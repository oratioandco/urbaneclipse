import { describe, it, expect } from 'vitest';
import {
  generateMinuteSteps,
  angularDistanceDeg,
  findAlignments,
} from '../../src/lib/solver';

/**
 * US5 solver pure core — STRICT TDD. These tests are written FIRST (RED) and drive
 * src/lib/solver.ts (GREEN). The solver must remain a pure module: no suncalc, no
 * Cesium. findAlignments takes an injected positionProvider so it is unit-testable
 * without any ephemeris dependency (Constitution Principle I).
 */

describe('generateMinuteSteps', () => {
  it('yields 1440 inclusive-start steps for a 1-day range (no off-by-one)', () => {
    const start = new Date('2026-03-21T00:00:00Z');
    const end = new Date('2026-03-22T00:00:00Z'); // exactly 24h later
    const steps = generateMinuteSteps(start, end, 1);
    expect(steps).toHaveLength(1440);
  });

  it('includes the start as the first step (inclusive start)', () => {
    const start = new Date('2026-03-21T00:00:00Z');
    const end = new Date('2026-03-21T00:10:00Z');
    const steps = generateMinuteSteps(start, end, 1);
    expect(steps[0]).toEqual(start);
  });

  it('excludes end and stops one step before it (no off-by-one at the tail)', () => {
    const start = new Date('2026-03-21T00:00:00Z');
    const end = new Date('2026-03-21T00:10:00Z');
    const steps = generateMinuteSteps(start, end, 1);
    expect(steps).toHaveLength(10);
    // last step is 00:09, NOT 00:10 (end is exclusive)
    expect(steps[steps.length - 1]!.getTime()).toBe(start.getTime() + 9 * 60_000);
  });

  it('honours stepMin > 1', () => {
    const start = new Date('2026-03-21T00:00:00Z');
    const end = new Date('2026-03-21T01:00:00Z');
    const steps = generateMinuteSteps(start, end, 15);
    expect(steps).toHaveLength(4); // 00:00, 00:15, 00:30, 00:45
    expect(steps[0]).toEqual(start);
    expect(steps[steps.length - 1]!.getTime()).toBe(start.getTime() + 45 * 60_000);
  });

  it('defaults stepMin to 1', () => {
    const start = new Date('2026-03-21T00:00:00Z');
    const end = new Date('2026-03-21T00:03:00Z');
    const steps = generateMinuteSteps(start, end);
    expect(steps).toHaveLength(3);
  });
});

describe('angularDistanceDeg', () => {
  it('returns 0 for identical directions', () => {
    expect(angularDistanceDeg(45, 30, 45, 30)).toBeCloseTo(0, 10);
  });

  it('returns 90 for orthogonal directions', () => {
    // (az=0, alt=0) -> (1,0,0); (az=90, alt=0) -> (0,1,0); dot = 0 -> 90deg
    expect(angularDistanceDeg(0, 0, 90, 0)).toBeCloseTo(90, 10);
  });

  it('returns 180 for opposite directions', () => {
    expect(angularDistanceDeg(0, 0, 180, 0)).toBeCloseTo(180, 10);
  });

  it('does not produce NaN for near-identical directions (clamps dot <= 1)', () => {
    const d = angularDistanceDeg(0, 0, 1e-9, 1e-9);
    expect(Number.isNaN(d)).toBe(false);
    expect(d).toBeLessThanOrEqual(1e-6);
  });

  it('does not produce NaN for near-opposite directions (clamps dot >= -1)', () => {
    const d = angularDistanceDeg(0, 0, 180, 1e-12);
    expect(Number.isNaN(d)).toBe(false);
    expect(d).toBeGreaterThanOrEqual(179.999);
  });

  it('is symmetric in its arguments', () => {
    const a = angularDistanceDeg(10, 20, 200, 45);
    const b = angularDistanceDeg(200, 45, 10, 20);
    expect(a).toBeCloseTo(b, 10);
  });
});

describe('findAlignments', () => {
  it('keeps only steps within tolerance of the target', () => {
    const steps = [
      new Date('2026-03-21T12:00:00Z'),
      new Date('2026-03-21T12:01:00Z'),
      new Date('2026-03-21T12:02:00Z'),
    ];
    // step 0 exactly at target; step 1 is a clean 0.5deg off (same az, +0.5 alt ->
    // great-circle distance is exactly 0.5deg, well within the 1deg tolerance);
    // step 2 is ~10deg off and must be excluded. Note: a 2deg AZIMUTH offset is NOT
    // a 2deg spherical distance (azimuth spans a small circle), so we use an altitude
    // offset to get a known great-circle distance.
    const provider = (date: Date): { az: number; alt: number } => {
      if (date.getTime() === steps[0]!.getTime()) return { az: 90, alt: 10 };
      if (date.getTime() === steps[1]!.getTime()) return { az: 90, alt: 10.5 };
      return { az: 100, alt: 10 };
    };
    const res = findAlignments(steps, 'sun', { az: 90, alt: 10 }, 1, provider);
    expect(res).toHaveLength(2); // steps 0 and 1 within 1deg; step 2 excluded
    // res[0] is the target itself; distance is ~1e-6deg float roundoff (cos(90deg)
    // is ~6e-17 in IEEE-754, so a point-vs-itself is not bit-exactly 0). ~1e-6deg
    // is milliarcseconds — treat as zero.
    expect(res[0]!.angularDistanceDeg).toBeCloseTo(0, 5);
    expect(res[1]!.angularDistanceDeg).toBeCloseTo(0.5, 6);
  });

  it('applies a default tolerance of 0.5deg when toleranceDeg is undefined', () => {
    const steps = [
      new Date('2026-03-21T12:00:00Z'),
      new Date('2026-03-21T12:01:00Z'),
    ];
    const provider = (date: Date): { az: number; alt: number } => {
      if (date.getTime() === steps[0]!.getTime()) return { az: 90, alt: 10 };
      return { az: 91, alt: 10 }; // 1deg off -> excluded by the 0.5deg default
    };
    const res = findAlignments(steps, 'sun', { az: 90, alt: 10 }, undefined, provider);
    expect(res).toHaveLength(1);
    expect(res[0]!.angularDistanceDeg).toBeLessThanOrEqual(0.5);
  });

  it('returns an empty array when no step is within tolerance', () => {
    const steps = [
      new Date('2026-03-21T12:00:00Z'),
      new Date('2026-03-21T12:01:00Z'),
    ];
    const provider = (): { az: number; alt: number } => ({ az: 200, alt: 60 });
    const res = findAlignments(steps, 'moon', { az: 0, alt: 0 }, 1, provider);
    expect(res).toEqual([]);
  });

  it('is order-independent: reordering steps yields the same kept set', () => {
    const s0 = new Date('2026-03-21T12:00:00Z');
    const s1 = new Date('2026-03-21T12:01:00Z');
    const s2 = new Date('2026-03-21T12:02:00Z');
    const lookup: Record<number, { az: number; alt: number }> = {
      [s0.getTime()]: { az: 90, alt: 10 },
      [s1.getTime()]: { az: 91, alt: 10 },
      [s2.getTime()]: { az: 200, alt: 10 },
    };
    const provider = (date: Date): { az: number; alt: number } => lookup[date.getTime()]!;
    const target = { az: 90, alt: 10 };
    const a = findAlignments([s0, s1, s2], 'sun', target, 1, provider);
    const b = findAlignments([s2, s1, s0], 'sun', target, 1, provider);
    const datesA = a.map((r) => r.date.getTime()).sort();
    const datesB = b.map((r) => r.date.getTime()).sort();
    expect(datesA).toEqual(datesB);
    expect(datesA).toHaveLength(2);
  });

  it('forwards body to the positionProvider and tags each result with it', () => {
    const steps = [new Date('2026-03-21T12:00:00Z')];
    let seenBody: 'sun' | 'moon' | null = null;
    const provider = (_date: Date, body: 'sun' | 'moon'): { az: number; alt: number } => {
      seenBody = body;
      return { az: 90, alt: 10 };
    };
    const res = findAlignments(steps, 'moon', { az: 90, alt: 10 }, 1, provider);
    expect(seenBody).toBe('moon');
    expect(res[0]!.body).toBe('moon');
    expect(res[0]!.az).toBe(90);
    expect(res[0]!.alt).toBe(10);
    expect(res[0]!.date).toEqual(steps[0]);
  });
});
