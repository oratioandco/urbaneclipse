/**
 * Time-of-day sky palette tests.
 *
 * The palette is the single source of truth for the preview's mood: sky gradient,
 * haze, bloom, scene light and disc tint all derive from the body's suncalc altitude.
 * The invariants that matter: night is dark and unlit, sunset is warm with a strong
 * red-leaning glow and a heavily reddened disc, day is cool and fully lit — and the
 * ramp between them is monotonic and clamped at the extremes.
 */
import { describe, it, expect } from 'vitest';
import { skyPalette } from '../../src/lib/skyPalette.js';

const brightness = (rgb: readonly [number, number, number]) => rgb[0] + rgb[1] + rgb[2];

describe('skyPalette — sun', () => {
  it('deep night is dark, unlit and glow-free', () => {
    const p = skyPalette('sun', -18);
    expect(brightness(p.skyTop)).toBeLessThan(0.4);
    expect(p.glowStrength).toBe(0);
    expect(p.lightIntensity).toBeLessThan(0.5);
    // Sky-ambient fill collapses at night (the clay dims via light, not tint).
    expect(p.ambientLevel).toBeLessThan(0.1);
    // sceneTint is a mild cool cast, not a heavy dimmer.
    expect(brightness(p.sceneTint)).toBeGreaterThan(1.5);
    expect(brightness(p.sceneTint)).toBeLessThan(3.0);
  });

  it('clamps absurd negative altitudes to full night (polar night)', () => {
    expect(skyPalette('sun', -40)).toEqual(skyPalette('sun', -18));
    expect(skyPalette('sun', NaN)).toEqual(skyPalette('sun', -18));
  });

  it('sunset (horizon) is warm: red-leaning glow, strong bloom, reddened disc', () => {
    const p = skyPalette('sun', 0);
    expect(p.glowColor[0]).toBeGreaterThan(p.glowColor[2]); // red > blue
    expect(p.glowStrength).toBeGreaterThan(0.8);
    // Atmospheric reddening: the disc loses blue far faster than red.
    expect(p.discTint[0]).toBe(1);
    expect(p.discTint[2]).toBeLessThan(0.3);
    expect(p.lightIntensity).toBeGreaterThan(0.4);
    expect(p.lightIntensity).toBeLessThan(1.5);
  });

  it('high day is cool, fully lit, with an untinted disc and undimmed city', () => {
    const p = skyPalette('sun', 45);
    expect(p.skyTop[2]).toBeGreaterThan(p.skyTop[0]); // blue sky
    expect(p.lightIntensity).toBe(2.0);
    expect(p.discTint).toEqual([1, 1, 1]);
    expect(p.sceneTint).toEqual([1, 1, 1]);
    expect(p.glowStrength).toBeLessThan(0.5);
  });

  it('clamps extreme high altitudes to the day keyframe', () => {
    expect(skyPalette('sun', 80)).toEqual(skyPalette('sun', 45));
  });

  it('interpolates between keyframes (twilight sits between night and sunset)', () => {
    const night = skyPalette('sun', -18);
    const sunset = skyPalette('sun', 0);
    const mid = skyPalette('sun', -3);
    expect(mid.lightIntensity).toBeGreaterThan(night.lightIntensity);
    expect(mid.lightIntensity).toBeLessThan(sunset.lightIntensity);
    expect(brightness(mid.skyTop)).toBeGreaterThan(brightness(night.skyTop));
    expect(brightness(mid.skyTop)).toBeLessThan(brightness(sunset.skyTop));
  });

  it('sunset warms the city geometry (golden-hour scene tint)', () => {
    const p = skyPalette('sun', 0);
    expect(p.sceneTint[0]).toBeGreaterThan(p.sceneTint[2]); // warm cast
  });

  it('light intensity increases monotonically through the morning ramp', () => {
    const alts = [-18, -6, 0, 6, 20, 45];
    const intensities = alts.map((a) => skyPalette('sun', a).lightIntensity);
    for (let i = 1; i < intensities.length; i++) {
      expect(intensities[i]).toBeGreaterThanOrEqual(intensities[i - 1]);
    }
  });

  it('ambient fill rises with the sun (clay stays lit by day, dark by night)', () => {
    const night = skyPalette('sun', -18).ambientLevel;
    const day = skyPalette('sun', 45).ambientLevel;
    expect(day).toBeGreaterThan(night);
    expect(day).toBeGreaterThan(0.4);
    expect(night).toBeLessThan(0.1);
  });
});

describe('skyPalette — moon', () => {
  it('is a dim cool palette at any altitude', () => {
    for (const alt of [1, 20, 60]) {
      const p = skyPalette('moon', alt);
      expect(p.lightIntensity).toBeLessThan(0.5);
      expect(p.glowColor[2]).toBeGreaterThan(p.glowColor[0]); // cool halo
      expect(brightness(p.skyTop)).toBeLessThan(0.6);
    }
  });

  it('has a slightly stronger halo near the horizon', () => {
    const low = skyPalette('moon', 0);
    const high = skyPalette('moon', 45);
    expect(low.glowStrength).toBeGreaterThan(high.glowStrength);
  });
});
