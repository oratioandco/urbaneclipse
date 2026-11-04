import { describe, it, expect } from 'vitest';
import { MAX_VERTICAL_FOV, computeHorizontalFov, fovToCesium, limitFovForFrame } from '../../src/lib/cameraMath';

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
  it('keeps the long-side angle, which Cesium applies to the long side of any frame', () => {
    const fov = computeHorizontalFov(36, 600);
    expect(fovToCesium(fov)).toBe(fov);
  });
});

describe('limitFovForFrame', () => {
  const ultraWide = computeHorizontalFov(23.6, 8);

  it('caps a very short lens in a tall frame', () => {
    expect(limitFovForFrame(ultraWide, 0.82)).toBeCloseTo(MAX_VERTICAL_FOV, 12);
  });

  it('leaves the same lens alone in a 16:10 frame', () => {
    expect(limitFovForFrame(ultraWide, 1.6)).toBe(ultraWide);
  });

  it('caps the vertical extent of a nearly square landscape frame', () => {
    const fov = limitFovForFrame(ultraWide, 1.05);
    const vertical = 2 * Math.atan(Math.tan(fov / 2) / 1.05);
    expect(vertical).toBeCloseTo(MAX_VERTICAL_FOV, 12);
  });

  it('leaves telephoto lenses alone', () => {
    const tele = computeHorizontalFov(23.6, 600);
    expect(limitFovForFrame(tele, 0.82)).toBe(tele);
  });
});
