import { describe, it, expect } from 'vitest';
import { computeHorizontalFov } from '../../src/lib/cameraMath';
import {
  EYE_MARKS,
  EYE_MAX_M,
  EYE_MIN_M,
  SENSOR_FORMATS,
  focalForFov,
  logPosition,
  logValue,
  roundEye,
  roundFocal,
  sensorFormatFor,
} from '../../src/lib/lensScale';

describe('sensor formats', () => {
  it('gives APS-C an 8 to 600 mm range', () => {
    const apsc = sensorFormatFor(23.6);
    expect([apsc.minFocal, apsc.maxFocal]).toEqual([8, 600]);
  });

  it('offers medium format, full-frame, APS-C and MFT', () => {
    expect(SENSOR_FORMATS.map((f) => f.label)).toEqual(['Medium format', 'Full-frame', 'APS-C', 'MFT']);
  });

  it('marks every scale from its first to its last value, ascending', () => {
    for (const f of SENSOR_FORMATS) {
      expect(f.focalMarks[0]).toBe(f.minFocal);
      expect(f.focalMarks[f.focalMarks.length - 1]).toBe(f.maxFocal);
      expect([...f.focalMarks].sort((a, b) => a - b)).toEqual(f.focalMarks);
    }
    expect(EYE_MARKS[0]).toBe(EYE_MIN_M);
    expect(EYE_MARKS[EYE_MARKS.length - 1]).toBe(EYE_MAX_M);
  });

  it('falls back to APS-C for an unknown sensor', () => {
    expect(sensorFormatFor(5).id).toBe('apsc');
  });
});

describe('log scale', () => {
  it('reaches both ends and round-trips', () => {
    expect(logPosition(8, 8, 600)).toBe(0);
    expect(logPosition(600, 8, 600)).toBe(1);
    expect(logValue(logPosition(85, 8, 600), 8, 600)).toBeCloseTo(85, 6);
  });

  it('gives equal ratios equal distance', () => {
    const a = logPosition(16, 8, 600) - logPosition(8, 8, 600);
    const b = logPosition(600, 8, 600) - logPosition(300, 8, 600);
    expect(a).toBeCloseTo(b, 9);
  });

  it('clamps values outside the scale', () => {
    expect(logPosition(1000, 8, 600)).toBe(1);
    expect(logPosition(1, 8, 600)).toBe(0);
    expect(logPosition(Number.NaN, 8, 600)).toBe(0);
  });
});

describe('rounding', () => {
  it('rounds focal lengths the way lenses are marked', () => {
    expect(roundFocal(8.4)).toBe(8);
    expect(roundFocal(87)).toBe(85);
    expect(roundFocal(297)).toBe(300);
  });

  it('keeps half-metre eye steps at low heights', () => {
    expect(roundEye(1.6)).toBe(1.5);
    expect(roundEye(23.4)).toBe(23);
  });
});

describe('focalForFov', () => {
  it('inverts the field of view calculation', () => {
    const fov = (computeHorizontalFov(23.6, 150) * 180) / Math.PI;
    expect(focalForFov(fov, 23.6)).toBeCloseTo(150, 6);
  });
});
