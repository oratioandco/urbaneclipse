import { describe, it, expect } from 'vitest';
import { cssRgb, moonLook, sunLook } from '../../src/lib/mapBodyLook.js';
import { skyPalette } from '../../src/lib/skyPalette.js';

describe('sunLook', () => {
  it('runs from a pale midday disc to a deep orange one as the sun sinks', () => {
    const blues = [45, 20, 6, 1].map((alt) => sunLook(alt).core[2]);
    for (let i = 1; i < blues.length; i++) expect(blues[i]).toBeLessThan(blues[i - 1]);
    expect(sunLook(45).core).toEqual([1, 1, 1]);
    expect(sunLook(1).core[0] - sunLook(1).core[2]).toBeGreaterThan(0.3);
  });

  it('darkens and reddens toward the limb', () => {
    for (const alt of [1, 6, 20, 45]) {
      const { core, limb } = sunLook(alt);
      expect(limb[1]).toBeLessThan(core[1]);
      expect(limb[2]).toBeLessThan(core[2]);
    }
  });

  it('glows hardest near the horizon', () => {
    expect(sunLook(1).glowOpacity).toBeGreaterThan(sunLook(45).glowOpacity);
    expect(sunLook(1).glowOpacity).toBeLessThanOrEqual(1);
  });

  it('takes its disc colour from the preview palette', () => {
    const tint = skyPalette('sun', 6).discTint;
    expect(sunLook(6).limb[0]).toBe(tint[0]);
    expect(sunLook(6).limb[1]).toBeCloseTo(tint[1] * 0.82);
  });

  it('keeps a saturated glow that reddens as the sun sinks', () => {
    const greens = [45, 20, 6, 0].map((alt) => sunLook(alt).glow[1]);
    for (let i = 1; i < greens.length; i++) expect(greens[i]!).toBeLessThan(greens[i - 1]!);
    expect(sunLook(45).glow[2]).toBeLessThan(0.5);
  });
});

describe('moonLook', () => {
  it('glows more the more of it is lit', () => {
    expect(moonLook(40, -30, 1).glowOpacity).toBeGreaterThan(moonLook(40, -30, 0.2).glowOpacity);
  });

  it('warms near the horizon', () => {
    const low = moonLook(1, -30, 1).core;
    const high = moonLook(40, -30, 1).core;
    expect(low[2]).toBeLessThan(high[2]);
    expect(low[0]).toBeGreaterThan(low[2]);
  });
});

describe('moon glow', () => {
  it('is cool overhead and warm at the horizon', () => {
    expect(moonLook(40, -30, 1).glow[2]).toBeGreaterThan(moonLook(40, -30, 1).glow[0]);
    expect(moonLook(0, -30, 1).glow[0]).toBeGreaterThan(moonLook(0, -30, 1).glow[2]);
  });
});

describe('cssRgb', () => {
  it('writes channels as 0 to 255', () => {
    expect(cssRgb([1, 0.5, 0])).toBe('rgb(255 128 0)');
  });
});
