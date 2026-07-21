import { describe, it, expect } from 'vitest';
import { greatCircleBearing, viewerOptions, telephotoFrustum } from '../../src/lib/sceneMath';

const toDeg = (r: number) => (r * 180) / Math.PI;

describe('greatCircleBearing', () => {
  it('cardinals: N=0, E=90, S=180, W=270', () => {
    expect(toDeg(greatCircleBearing(0, 0, 1, 0))).toBeCloseTo(0, 5);
    expect(toDeg(greatCircleBearing(0, 0, 0, 1))).toBeCloseTo(90, 5);
    expect(toDeg(greatCircleBearing(0, 0, -1, 0))).toBeCloseTo(180, 5);
    expect(toDeg(greatCircleBearing(0, 0, 0, -1))).toBeCloseTo(270, 5);
  });

  it('observer -> target is in the western quadrant (target is west of observer)', () => {
    const b = toDeg(greatCircleBearing(52.5106, 13.4652, 52.5208, 13.4093));
    expect(b).toBeGreaterThan(255);
    expect(b).toBeLessThan(315);
  });

  it('reverse bearing differs by ~180 deg', () => {
    const fwd = toDeg(greatCircleBearing(52.5106, 13.4652, 52.5208, 13.4093));
    const rev = toDeg(greatCircleBearing(52.5208, 13.4093, 52.5106, 13.4652));
    const diff = Math.abs(((rev - fwd + 360) % 360) - 180);
    expect(diff).toBeLessThan(1);
  });
});

describe('viewerOptions', () => {
  it('disables every default widget (plaster void / clean canvas)', () => {
    const o = viewerOptions();
    const off = [
      'animation', 'timeline', 'baseLayerPicker', 'fullscreenButton',
      'geocoder', 'homeButton', 'infoBox', 'sceneModePicker',
      'selectionIndicator', 'navigationHelpButton',
    ] as const;
    for (const key of off) {
      expect(o[key], `${key} should be false`).toBe(false);
    }
  });
});

describe('telephotoFrustum', () => {
  it('converts fov degrees to radians and passes aspect through', () => {
    const f = telephotoFrustum(20, 16 / 9);
    expect(f.fov).toBeCloseTo((20 * Math.PI) / 180, 5);
    expect(f.aspectRatio).toBeCloseTo(16 / 9, 5);
  });
});
