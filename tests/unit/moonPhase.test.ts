import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { getMoonIllumination, getMoonPosition } from 'suncalc';
import {
  celestialNorthOnDisc,
  litDiscPath,
  moonDaylightVisibility,
  moonLighting,
  phaseLabel,
  phaseName,
} from '../../src/lib/moonPhase';
import { moonPalette, skyPalette } from '../../src/lib/skyPalette';

const BERLIN = [52.52, 13.41] as const;
const days = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 10, 5 + i, 21, 0)));

describe('moonLighting', () => {
  it('agrees with the ephemeris on the lit fraction', () => {
    for (const d of days) {
      const { fraction } = moonLighting(d, ...BERLIN);
      expect(Math.abs(fraction - getMoonIllumination(d).fraction)).toBeLessThan(0.03);
    }
  });

  it('points the bright limb the way the ephemeris does', () => {
    for (const d of days) {
      const illum = getMoonIllumination(d);
      if (illum.fraction < 0.05 || illum.fraction > 0.95) continue; // the limb is ill-defined here
      const position = getMoonPosition(d, ...BERLIN);
      const zenith = ((illum.angle - position.parallacticAngle) * Math.PI) / 180;
      const { limb } = moonLighting(d, ...BERLIN);
      const agreement = limb[0] * -Math.sin(zenith) + limb[1] * Math.cos(zenith);
      expect(agreement).toBeGreaterThan(0.97);
    }
  });

  it('finds the celestial pole at the ephemeris parallactic angle', () => {
    for (const d of days) {
      const position = getMoonPosition(d, ...BERLIN);
      if (position.altitude < 5) continue;
      const [x, y] = celestialNorthOnDisc(d, ...BERLIN);
      const measured = Math.abs((Math.atan2(x, y) * 180) / Math.PI);
      expect(Math.abs(measured - Math.abs(position.parallacticAngle))).toBeLessThan(1.5);
    }
  });

  it('keeps lunar north within the tilt of the ecliptic of the celestial pole', () => {
    for (const d of days) {
      const celestial = celestialNorthOnDisc(d, ...BERLIN);
      const { north } = moonLighting(d, ...BERLIN);
      const degrees = (Math.acos(celestial[0] * north[0] + celestial[1] * north[1]) * 180) / Math.PI;
      expect(degrees).toBeLessThan(26);
    }
  });

  it('returns a unit limb direction and a consistent phase angle', () => {
    for (const d of days) {
      const m = moonLighting(d, ...BERLIN);
      expect(Math.hypot(...m.limb)).toBeCloseTo(1, 9);
      expect(Math.hypot(...m.north)).toBeCloseTo(1, 9);
      expect(Math.hypot(m.phaseCos, m.phaseSin)).toBeCloseTo(1, 9);
      expect((1 + m.phaseCos) / 2).toBeCloseTo(m.fraction, 9);
    }
  });
});

describe('phase names', () => {
  it('names the whole cycle', () => {
    expect(phaseName(0.01, true)).toBe('New moon');
    expect(phaseName(0.2, true)).toBe('Waxing crescent');
    expect(phaseName(0.5, true)).toBe('First quarter');
    expect(phaseName(0.8, true)).toBe('Waxing gibbous');
    expect(phaseName(0.99, false)).toBe('Full moon');
    expect(phaseName(0.8, false)).toBe('Waning gibbous');
    expect(phaseName(0.5, false)).toBe('Last quarter');
    expect(phaseName(0.2, false)).toBe('Waning crescent');
    expect(phaseLabel(0.27, false)).toBe('Waning crescent, 27% lit');
  });
});

describe('litDiscPath', () => {
  it('lights the right while waxing and the left while waning', () => {
    expect(litDiscPath(0.25, true)).toContain('A1,1 0 0 1 0,1');
    expect(litDiscPath(0.25, false)).toContain('A1,1 0 0 0 0,1');
  });

  it('narrows the terminator to a straight line at quarter', () => {
    expect(litDiscPath(0.5, true)).toContain('A0.000,1');
    expect(litDiscPath(1, true)).toContain('A1.000,1');
  });

  it('bends the terminator the opposite way once past quarter', () => {
    const inner = (f: number) => litDiscPath(f, true).split(' A')[2];
    expect(inner(0.2)).not.toBe(inner(0.8));
  });
});

describe('the lunar surface texture', () => {
  it('ships with the app', () => {
    const file = readFileSync(join(__dirname, '..', '..', 'public', 'textures', 'moon-nearside.jpg'));
    expect(file.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(file.length).toBeGreaterThan(10_000);
  });
});

describe('moonDaylightVisibility', () => {
  it('has nothing to say once the sky is dark', () => {
    expect(moonDaylightVisibility(0.1, 20, -10, 90)).toBeNull();
  });

  it('rates a high quarter moon far from the sun as easy', () => {
    expect(moonDaylightVisibility(0.5, 30, 30, 90)).toBe('easy');
  });

  it('rates a moon near the sun, near the horizon or very thin as hard', () => {
    expect(moonDaylightVisibility(0.5, 30, 30, 15)).toBe('hard');
    expect(moonDaylightVisibility(0.5, 2, 30, 90)).toBe('hard');
    expect(moonDaylightVisibility(0.05, 30, 30, 40)).toBe('hard');
  });

  it('gives a thinner daytime crescent a middling rating', () => {
    expect(moonDaylightVisibility(0.25, 25, 30, 60)).toBe('faint');
  });

  it('is more forgiving when the sun is low', () => {
    expect(moonDaylightVisibility(0.5, 6, 30, 90)).toBe('faint');
    expect(moonDaylightVisibility(0.5, 6, 3, 90)).toBe('easy');
  });
});

describe('moonPalette', () => {
  it('uses the daytime sky when the moon is up in daylight', () => {
    const day = moonPalette(20, 30, 0.5);
    expect(day.skyTop).toEqual(skyPalette('sun', 30).skyTop);
    expect(day.lightIntensity).toBeCloseTo(skyPalette('sun', 30).lightIntensity, 6);
  });

  it('uses a night sky once the sun is well down', () => {
    const night = moonPalette(20, -20, 0.5);
    expect(night.skyTop[2]).toBeLessThan(0.3);
    expect(night.lightIntensity).toBeLessThan(0.4);
  });

  it('lets a thin moon cast far less light and glow than a full one', () => {
    const thin = moonPalette(20, -20, 0.1);
    const full = moonPalette(20, -20, 1);
    expect(thin.lightIntensity).toBeLessThan(full.lightIntensity);
    expect(thin.glowStrength).toBeLessThan(full.glowStrength);
  });

  it('reddens a moon near the horizon', () => {
    const low = moonPalette(1, -20, 1).discTint;
    const high = moonPalette(40, -20, 1).discTint;
    expect(low[2]).toBeLessThan(high[2]);
  });
});
