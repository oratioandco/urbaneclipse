import { describe, it, expect } from 'vitest';
import { computeHorizontalFov, fovToCesium } from '../../src/lib/cameraMath';

const toDeg = (r: number) => (r * 180) / Math.PI;

describe('computeHorizontalFov', () => {
  it('full-frame 36mm x 600mm focal -> ~3.44deg (0.0601 rad)', () => {
    const hfov = computeHorizontalFov(36, 600);
    // Print actual values for the record.
    // eslint-disable-next-line no-console
    console.log(`computeHorizontalFov(36,600) -> rad=${hfov} deg=${toDeg(hfov)}`);
    expect(hfov).toBeCloseTo(0.0601, 3); // ~0.059982 rad
    expect(toDeg(hfov)).toBeCloseTo(3.44, 1);
  });

  it('longer focal length strictly decreases FOV', () => {
    const shorter = computeHorizontalFov(36, 600);
    const longer = computeHorizontalFov(36, 1200);
    // eslint-disable-next-line no-console
    console.log(`600mm=${shorter}  1200mm=${longer}`);
    expect(longer).toBeLessThan(shorter);
  });

  it('throws when sensor width is 0', () => {
    expect(() => computeHorizontalFov(0, 600)).toThrow();
  });

  it('throws when focal length is 0', () => {
    expect(() => computeHorizontalFov(36, 0)).toThrow();
  });

  it('throws when either argument is negative', () => {
    expect(() => computeHorizontalFov(-36, 600)).toThrow();
    expect(() => computeHorizontalFov(36, -600)).toThrow();
  });
});

describe('fovToCesium', () => {
  it('at aspectRatio >= 1 returns hfov unchanged', () => {
    const hfov = computeHorizontalFov(36, 600);
    const out16x9 = fovToCesium(hfov, 16 / 9);
    const out1x1 = fovToCesium(hfov, 1);
    // eslint-disable-next-line no-console
    console.log(`aspect 16/9 -> ${out16x9} (hfov=${hfov}); aspect 1 -> ${out1x1}`);
    expect(out16x9).toBe(hfov);
    expect(out1x1).toBe(hfov);
  });

  it('at aspectRatio < 1 returns a smaller (converted) value', () => {
    const hfov = computeHorizontalFov(36, 600);
    const out9x16 = fovToCesium(hfov, 9 / 16);
    // eslint-disable-next-line no-console
    console.log(`aspect 9/16 -> ${out9x16} (hfov=${hfov}); smaller=${out9x16 < hfov}`);
    expect(out9x16).toBeLessThan(hfov);
    // Matches the documented vfov conversion: 2*atan(tan(hfov/2)*aspect)
    const expected = 2 * Math.atan(Math.tan(hfov / 2) * (9 / 16));
    expect(out9x16).toBeCloseTo(expected, 12);
  });

  it('round-trip sanity: hfov -> vfov (aspect<1) -> back to hfov recovers input', () => {
    const hfov = computeHorizontalFov(36, 600);
    const aspect = 9 / 16;
    const vfov = fovToCesium(hfov, aspect);
    const back = 2 * Math.atan(Math.tan(vfov / 2) / aspect);
    // eslint-disable-next-line no-console
    console.log(`round-trip hfov=${hfov} -> vfov=${vfov} -> back=${back}`);
    expect(back).toBeCloseTo(hfov, 12);
  });
});
