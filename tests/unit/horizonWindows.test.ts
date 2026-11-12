/**
 * Horizon-gated windows for a second landmark (Siegessäule) — known-answer tests.
 *
 * The expectations below were computed INDEPENDENTLY (spherical trig / atan2 in a
 * separate script), not read back out of the implementation, so a sign error or a
 * missing curvature term cannot pass by agreeing with itself.
 *
 * This module is flag-gated and not shipped: the first group proves the flag is OFF
 * by default, which is what keeps the trial out of the app.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HORIZON_WINDOWS_FLAG,
  horizonWindowsEnabled,
  groundAltitudeDeg,
  sampleHorizonProfile,
  azimuthToLandmark,
  landmarkTipAltitudeDeg,
  targetWindow,
  gateDirection,
  horizonTowardsLandmark,
  eyeEllipsoidal,
  enumerateHorizonGatedWindows,
  HorizonWindowsDisabledError,
} from '../../src/lib/horizonWindows.js';
import { sampleBody } from '../../src/lib/bodyPosition.js';
import { createHeightmap, decodeSamples, type HeightmapHeader, type Heightmap } from '../../src/lib/heightmap.js';
import { SIEGESSAEULE, FERNSEHTURM, landmarkHeight } from '../../src/lib/landmarks.js';
import { standingPoint, EYE_HEIGHT_M } from '../../src/lib/vantages.js';
import { resolveEyeEllipsoidalHeight } from '../../src/lib/elevation.js';

/** A standing point on Straße des 17. Juni, east of the column, looking west. */
const OBS = standingPoint(
  {
    id: 'strasse-des-17-juni',
    lat: 52.5145,
    lon: 13.37,
    surfaceOrthometric: 34,
    eyeHeightM: EYE_HEIGHT_M,
    needsSiteCheck: true,
    source: 'Test observer; ground ~33.4 m from the committed DGM1 grid.',
  },
  { lat: SIEGESSAEULE.lat, lon: SIEGESSAEULE.lon },
);

/** Flat synthetic grid, 40.0 m everywhere, ~111 m row spacing, centred on 52.01/13.01. */
function grid(fill: (row: number, col: number) => number): Heightmap {
  const width = 21;
  const height = 21;
  const header: HeightmapHeader = {
    format: 'plaster-void-heightmap',
    version: 1,
    dtype: 'int16',
    scale: 0.1,
    offset: 0,
    nodata: -32768,
    width,
    height,
    bbox: { lonMin: 13.0, latMin: 52.0, lonMax: 13.02, latMax: 52.02 },
    dLon: 0.001,
    dLat: 0.001,
  };
  const samples = new Int16Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) samples[r * width + c] = Math.round(fill(r, c) * 10);
  }
  return createHeightmap(header, samples);
}

const FLAT = grid(() => 40);
const CENTRE = standingPoint(
  { id: 'c', lat: 52.01, lon: 13.01, surfaceOrthometric: 40, eyeHeightM: 1.6, needsSiteCheck: true, source: 'fixture' },
  { lat: 52.02, lon: 13.01 },
);

function realBerlin(): Heightmap {
  const header = JSON.parse(readFileSync('public/heightmap/berlin-dgm1.json', 'utf8')) as HeightmapHeader;
  const buf = readFileSync('public/heightmap/berlin-dgm1.bin');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return createHeightmap(header, decodeSamples(ab));
}

describe('the feature flag keeps this out of the app', () => {
  it('is OFF when nothing is set', () => {
    expect(horizonWindowsEnabled({})).toBe(false);
    expect(horizonWindowsEnabled(undefined)).toBe(false);
  });

  it('is OFF for anything that is not an explicit truthy string', () => {
    for (const v of ['0', 'false', 'off', '', 'yes', 'TRUE']) {
      expect(horizonWindowsEnabled({ [HORIZON_WINDOWS_FLAG]: v })).toBe(false);
    }
  });

  it('is ON only for 1 / true / on', () => {
    for (const v of ['1', 'true', 'on']) {
      expect(horizonWindowsEnabled({ [HORIZON_WINDOWS_FLAG]: v })).toBe(true);
    }
  });
});

describe('groundAltitudeDeg — known answers (independent computation)', () => {
  it('is level ground slightly BELOW zero because the Earth curves away', () => {
    // Same height as the eye: only curvature+refraction remain. -(1-k)d^2/(2R).
    expect(groundAltitudeDeg(41.6, 41.6, 1000)).toBeCloseTo(-0.003912049, 8);
    expect(groundAltitudeDeg(41.6, 41.6, 2000)).toBeCloseTo(-0.007824098, 8);
  });

  it('matches atan2 of rise over distance for a 10 m rise at 1 km', () => {
    expect(groundAltitudeDeg(51.6, 41.6, 1000)).toBeCloseTo(0.569027037, 8);
  });

  it('matches a steep near obstruction', () => {
    expect(groundAltitudeDeg(60, 41.6, 100)).toBeCloseTo(10.425430131, 8);
    expect(groundAltitudeDeg(100, 41.6, 800)).toBeCloseTo(4.172072831, 8);
  });

  it('is negative for ground below the eye', () => {
    expect(groundAltitudeDeg(30, 41.6, 500)).toBeCloseTo(-1.330978645, 8);
  });

  it('applies refraction: the drop is 0.0683 m at 1 km, not the bare 0.0785 m', () => {
    const bare = (1000 * 1000) / (2 * 6371000);
    const withRefraction = -Math.tan((groundAltitudeDeg(41.6, 41.6, 1000) * Math.PI) / 180) * 1000;
    expect(bare).toBeCloseTo(0.0784806, 6);
    expect(withRefraction).toBeCloseTo(0.0682781, 6);
    expect(withRefraction).toBeLessThan(bare);
  });

  it('is monotone: a higher obstruction is a higher angle at the same distance', () => {
    expect(groundAltitudeDeg(70, 41.6, 500)).toBeGreaterThan(groundAltitudeDeg(60, 41.6, 500));
    expect(groundAltitudeDeg(60, 41.6, 500)).toBeGreaterThan(groundAltitudeDeg(60, 41.6, 1500));
  });
});

describe('sampleHorizonProfile — skyline semantics', () => {
  it('on flat ground BELOW the eye nothing obstructs: the skyline tends to 0 from below', () => {
    const p = sampleHorizonProfile({ point: CENTRE, azimuthDeg: 0, maxDistanceM: 1000, stepM: 100, map: FLAT });
    expect(p.samples).toHaveLength(10);
    // Ground 40 m, eye 41.6 m: rise/d = (-1.6 - drop)/d, so the angle is negative and
    // RISES toward 0 as d grows. The maximum is therefore the FARTHEST sample — flat
    // terrain never blocks a sunset, which is exactly what this must report.
    expect(p.horizonDistanceM).toBe(1000);
    expect(p.horizonAltitudeDeg).toBeCloseTo(groundAltitudeDeg(40, 41.6, 1000), 9);
    expect(p.horizonAltitudeDeg).toBeLessThan(0);
    expect(p.samples[0]!.altitudeDeg).toBeLessThan(p.horizonAltitudeDeg);
    expect(p.coverage).toBe(1);
    expect(p.truncated).toBe(false);
    expect(p.maxDistanceM).toBe(1000);
  });

  it('on flat ground ABOVE the eye the NEAREST sample wins, since angle falls with distance', () => {
    // Eye at 36.4 + 1.6 = 38.0 m, i.e. 2 m BELOW the 40 m plain: every sample is above
    // the eye, the angle falls with distance, so the closest sample subtends the most.
    const low = standingPoint(
      { id: 'low', lat: 52.01, lon: 13.01, surfaceOrthometric: 36.4, eyeHeightM: 1.6, needsSiteCheck: true, source: 'fixture' },
      { lat: 52.02, lon: 13.01 },
    );
    const p = sampleHorizonProfile({ point: low, azimuthDeg: 0, maxDistanceM: 1000, stepM: 100, map: FLAT });
    expect(p.horizonDistanceM).toBe(100);
    expect(p.horizonAltitudeDeg).toBeGreaterThan(0);
    expect(p.samples[p.samples.length - 1]!.altitudeDeg).toBeCloseTo(p.horizonAltitudeDeg, 9);
  });

  it('returns the RUNNING MAXIMUM, never a decreasing skyline', () => {
    const p = sampleHorizonProfile({ point: CENTRE, azimuthDeg: 0, maxDistanceM: 1000, stepM: 50, map: FLAT });
    for (let i = 1; i < p.samples.length; i++) {
      expect(p.samples[i]!.altitudeDeg).toBeGreaterThanOrEqual(p.samples[i - 1]!.altitudeDeg);
    }
  });

  it('finds a ridge north of the observer and reports where it is', () => {
    // Rows 13..16 are ~333-667 m north of the centre row 10: a 60 m plateau.
    const ridged = grid((r) => (r >= 13 && r <= 16 ? 60 : 40));
    const p = sampleHorizonProfile({ point: CENTRE, azimuthDeg: 0, maxDistanceM: 1000, stepM: 25, map: ridged });
    expect(p.horizonAltitudeDeg).toBeGreaterThan(2);
    expect(p.horizonAltitudeDeg).toBeLessThan(4);
    expect(p.horizonDistanceM).toBeGreaterThan(300);
    expect(p.horizonDistanceM).toBeLessThan(700);
    // A nearer ridge hides a taller far one: the skyline must not keep rising past it.
    const last = p.samples[p.samples.length - 1]!;
    expect(last.altitudeDeg).toBeCloseTo(p.horizonAltitudeDeg, 9);
  });

  it('rejects a non-positive step or range instead of looping forever', () => {
    expect(() => sampleHorizonProfile({ point: CENTRE, azimuthDeg: 0, maxDistanceM: 100, stepM: 0, map: FLAT })).toThrow(RangeError);
    expect(() => sampleHorizonProfile({ point: CENTRE, azimuthDeg: 0, maxDistanceM: 0, stepM: 10, map: FLAT })).toThrow(RangeError);
  });

  it('reports a coverage gap rather than inventing ground', () => {
    // Walk east out of the 21x21 grid: samples past the edge have no data.
    const p = sampleHorizonProfile({ point: CENTRE, azimuthDeg: 90, maxDistanceM: 3000, stepM: 100, map: FLAT });
    expect(p.truncated).toBe(true);
    expect(p.coverage).toBeGreaterThan(0);
    expect(p.coverage).toBeLessThan(1);
    expect(p.maxDistanceM).toBeLessThan(3000);
    // Nothing beyond the last known sample may appear in the profile.
    for (const s of p.samples) expect(s.distanceM).toBeLessThanOrEqual(p.maxDistanceM);
  });

  it('returns NaN and zero coverage when NO terrain is available, never 0 degrees', () => {
    const p = sampleHorizonProfile({ point: CENTRE, azimuthDeg: 0, maxDistanceM: 100, stepM: 50, map: grid(() => -3276.8) });
    expect(p.coverage).toBe(0);
    expect(Number.isNaN(p.horizonAltitudeDeg)).toBe(true);
    expect(p.truncated).toBe(true);
    expect(p.samples).toHaveLength(0);
  });
});

describe('Siegessäule target window — spherical trig, known answers', () => {
  it('looks almost exactly west from Straße des 17. Juni', () => {
    // Independent WGS84 Vincenty inverse: 270.069244374 deg. (A mean-sphere
    // haversine gives 270.069397 — the 1.5e-4 deg difference is the datum, not drift.)
    expect(azimuthToLandmark(OBS, SIEGESSAEULE)).toBeCloseTo(270.069244, 5);
  });

  it('puts the 67 m tip about 3.2 deg above the eye at ~1.35 km', () => {
    expect(landmarkHeight(SIEGESSAEULE)).toBeCloseTo(67, 6);
    // Independent: base 44 + 67 = 111 m, eye 35.6 m, WGS84 geodesic d = 1351.037460 m
    // -> 3.189035495 deg. The mean-sphere haversine distance (1346.678 m) is 4.36 m
    // short on this east-west line at 52.5 deg N, which would overstate this by 0.010 deg.
    expect(landmarkTipAltitudeDeg(OBS, SIEGESSAEULE)).toBeCloseTo(3.189035495, 6);
  });

  it('spans the published azimuth/altitude box', () => {
    const w = targetWindow(OBS, SIEGESSAEULE);
    expect(w.azimuthDeg).toBeCloseTo(270.069244, 5);
    // Widest profile radius is the 30 m terrace -> 1.272052783 deg at 1351.037 m.
    expect(w.azimuthHalfWidthDeg).toBeCloseTo(1.272052783, 6);
    expect(w.altitudeMinDeg).toBeCloseTo(0.350943598, 6);
    expect(w.altitudeMaxDeg).toBeCloseTo(3.189035495, 6);
    expect(w.altitudeMaxDeg).toBeGreaterThan(w.altitudeMinDeg);
  });

  it('is a much smaller target than the Fernsehturm from the same spot', () => {
    const column = targetWindow(OBS, SIEGESSAEULE);
    const tower = targetWindow(OBS, FERNSEHTURM);
    expect(tower.altitudeMaxDeg).toBeGreaterThan(column.altitudeMaxDeg);
  });
});

describe('gateDirection — the disc must clear the terrain AND hit the target', () => {
  const target = targetWindow(OBS, SIEGESSAEULE);
  const clearSky = { azimuthDeg: target.azimuthDeg, horizonAltitudeDeg: -0.5, samples: [], horizonDistanceM: 100, maxDistanceM: 1400, coverage: 1, truncated: false };

  it('accepts a setting sun on the column above the skyline', () => {
    const g = gateDirection({ azimuthDeg: target.azimuthDeg, altitudeDeg: 1.5 }, target, clearSky, 0.25);
    expect(g.clearsHorizon).toBe(true);
    expect(g.alignedWithTarget).toBe(true);
    expect(g.horizonConfident).toBe(true);
  });

  it('rejects a geometrically perfect alignment that is already below the skyline', () => {
    const blocked = { ...clearSky, horizonAltitudeDeg: 2.0 };
    const g = gateDirection({ azimuthDeg: target.azimuthDeg, altitudeDeg: 1.5 }, target, blocked, 0.25);
    expect(g.alignedWithTarget).toBe(true);
    expect(g.clearsHorizon).toBe(false);
  });

  it('requires the WHOLE disc to clear when a radius is given', () => {
    const horizon = { ...clearSky, horizonAltitudeDeg: 1.4 };
    expect(gateDirection({ azimuthDeg: target.azimuthDeg, altitudeDeg: 1.5 }, target, horizon, 0).clearsHorizon).toBe(true);
    expect(gateDirection({ azimuthDeg: target.azimuthDeg, altitudeDeg: 1.5 }, target, horizon, 0.25).clearsHorizon).toBe(false);
  });

  it('rejects a body outside the azimuth box', () => {
    const g = gateDirection({ azimuthDeg: target.azimuthDeg + 5, altitudeDeg: 1.5 }, target, clearSky, 0.25);
    expect(g.alignedWithTarget).toBe(false);
  });

  it('rejects a body above the tip', () => {
    const g = gateDirection({ azimuthDeg: target.azimuthDeg, altitudeDeg: 20 }, target, clearSky, 0.25);
    expect(g.alignedWithTarget).toBe(false);
  });

  it('handles the 0/360 azimuth wrap', () => {
    const north = { ...target, azimuthDeg: 0.2 };
    const g = gateDirection({ azimuthDeg: 359.9, altitudeDeg: 1.5 }, north, clearSky, 0.25);
    expect(g.alignedWithTarget).toBe(true);
  });

  it('flags a decision made on a truncated skyline as not confident', () => {
    const partial = { ...clearSky, truncated: true, coverage: 0.7 };
    const g = gateDirection({ azimuthDeg: target.azimuthDeg, altitudeDeg: 1.5 }, target, partial, 0.25);
    expect(g.horizonConfident).toBe(false);
  });
});

describe('the REAL committed DGM1 grid — the honest limitation', () => {
  it('does not cover the Siegessäule itself, and says so', () => {
    const map = realBerlin();
    const p = horizonTowardsLandmark(OBS, SIEGESSAEULE, map, 25);
    // The grid starts at lon 13.3611; the column stands at 13.3501 — outside it.
    expect(p.truncated).toBe(true);
    expect(p.coverage).toBeGreaterThan(0.4);
    expect(p.coverage).toBeLessThan(1);
    expect(p.maxDistanceM).toBeLessThan(1200);
    expect(p.samples.length).toBeGreaterThan(10);
  });

  it('still measures a plausible Berlin skyline towards the column', () => {
    const p = horizonTowardsLandmark(OBS, SIEGESSAEULE, realBerlin(), 25);
    // Tiergarten ground is ~32-34 m; the eye is at 35.6 m, so the skyline is near 0.
    expect(p.horizonAltitudeDeg).toBeGreaterThan(-2);
    expect(p.horizonAltitudeDeg).toBeLessThan(1);
  });

  it('never samples past the landmark, so ground behind it cannot hide it', () => {
    const p = horizonTowardsLandmark(OBS, SIEGESSAEULE, realBerlin(), 25);
    for (const s of p.samples) expect(s.distanceM).toBeLessThanOrEqual(OBS.distanceToLandmarkM);
  });

  it('marks any window gated on that partial skyline as not confident', () => {
    const horizon = horizonTowardsLandmark(OBS, SIEGESSAEULE, realBerlin(), 25);
    const g = gateDirection({ azimuthDeg: targetWindow(OBS, SIEGESSAEULE).azimuthDeg, altitudeDeg: 1 }, targetWindow(OBS, SIEGESSAEULE), horizon, 0.25);
    expect(g.horizonConfident).toBe(false);
  });

  it('is fully covered for a short sightline inside the grid', () => {
    const p = sampleHorizonProfile({ point: OBS, azimuthDeg: 90, maxDistanceM: 500, stepM: 25, map: realBerlin() });
    expect(p.truncated).toBe(false);
    expect(p.coverage).toBe(1);
    expect(p.samples).toHaveLength(20);
  });
});

describe('eye height uses the repo resolver, not a second convention', () => {
  it('agrees with resolveEyeEllipsoidalHeight for the standing point', () => {
    expect(eyeEllipsoidal(OBS)).toBe(
      resolveEyeEllipsoidalHeight({ groundOrthometric: undefined, surfaceOrthometric: 34, eyeHeight: 1.6 }),
    );
  });
});

/**
 * The time dimension: real ephemeris, real silhouette, terrain-gated.
 *
 * Known answer used here: at the March equinox the sun sets essentially DUE WEST, and
 * the Siegessäule's axis from Straße des 17. Juni lies at 270.069 deg — so the best
 * covered window of that week must be the equinox one, within the column's 1.27 deg
 * half-width. Measured independently before writing these expectations: six windows,
 * best 2027-03-21 17:14Z at az 270.268 deg, coveredFraction 0.94.
 */
describe('enumerateHorizonGatedWindows — flag-gated, terrain-aware', () => {
  const bodyAt = (t: Date, body: 'sun' | 'moon') => sampleBody(body, t, OBS.lat, OBS.lon);
  const range = {
    start: new Date('2027-03-18T00:00:00Z'),
    end: new Date('2027-03-24T00:00:00Z'),
    stepMinutes: 2,
  };

  /** Synthetic Berlin-sized grid, 33.4 m plain, fully covering observer AND column. */
  function berlinGrid(fill: (lat: number, lon: number) => number): Heightmap {
    const width = 41;
    const height = 31;
    const bbox = { lonMin: 13.34, latMin: 52.5, lonMax: 13.38, latMax: 52.53 };
    const dLon = 0.001;
    const dLat = 0.001;
    const header: HeightmapHeader = {
      format: 'plaster-void-heightmap', version: 1, dtype: 'int16', scale: 0.1, offset: 0,
      nodata: -32768, width, height, bbox, dLon, dLat,
    };
    const samples = new Int16Array(width * height);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const lat = bbox.latMin + r * dLat;
        const lon = bbox.lonMin + c * dLon;
        samples[r * width + c] = Math.round(fill(lat, lon) * 10);
      }
    }
    return createHeightmap(header, samples);
  }

  const PLAIN = berlinGrid(() => 33.4);
  // A 60 m ridge ~250-450 m west of the observer: atan((60-35.6)/300) ~ 4.6 deg, well
  // above the 0.2-1.7 deg the equinox sun reaches on the column.
  const RIDGED = berlinGrid((_lat, lon) => (lon > 13.3635 && lon < 13.3665 ? 60 : 33.4));

  it('throws while the flag is off, so nothing can ship by accident', () => {
    expect(() =>
      enumerateHorizonGatedWindows({ point: OBS, landmark: SIEGESSAEULE, map: PLAIN, bodyAt, ...range }),
    ).toThrow(HorizonWindowsDisabledError);
    expect(() =>
      enumerateHorizonGatedWindows({ point: OBS, landmark: SIEGESSAEULE, map: PLAIN, bodyAt, ...range, enabled: false }),
    ).toThrow(/flag-gated/);
  });

  it('finds the equinox sunset windows on the column when enabled', () => {
    const w = enumerateHorizonGatedWindows({
      point: OBS, landmark: SIEGESSAEULE, map: PLAIN, bodyAt, ...range, bodies: ['sun'], enabled: true,
    });
    expect(w.length).toBeGreaterThan(3);
    expect(w.every((x) => x.body === 'sun')).toBe(true);
    // Chronological, as the calendar needs.
    for (let i = 1; i < w.length; i++) {
      expect(w[i]!.peak.getTime()).toBeGreaterThan(w[i - 1]!.peak.getTime());
    }
    const best = w.reduce((a, b) => (b.coveredFraction > a.coveredFraction ? b : a));
    expect(best.coveredFraction).toBeGreaterThan(0.8);
    // The equinox: 20 or 21 March 2027.
    expect(best.peak.getUTCDate()).toBeGreaterThanOrEqual(20);
    expect(best.peak.getUTCDate()).toBeLessThanOrEqual(21);
    expect(best.peak.getUTCMonth()).toBe(2);
    // Sunset, i.e. late afternoon UTC in Berlin.
    expect(best.peak.getUTCHours()).toBeGreaterThanOrEqual(16);
    expect(best.peak.getUTCHours()).toBeLessThanOrEqual(18);
    // On the column's azimuth, within its half-width.
    const target = targetWindow(OBS, SIEGESSAEULE);
    expect(Math.abs(best.peakAzimuthDeg - target.azimuthDeg)).toBeLessThan(target.azimuthHalfWidthDeg);
    expect(best.peakAltitudeDeg).toBeGreaterThan(target.altitudeMinDeg - 0.5);
    expect(best.peakAltitudeDeg).toBeLessThan(target.altitudeMaxDeg);
  });

  it('reports a fully sampled skyline as confident on complete coverage', () => {
    const w = enumerateHorizonGatedWindows({
      point: OBS, landmark: SIEGESSAEULE, map: PLAIN, bodyAt, ...range, bodies: ['sun'], enabled: true,
    });
    expect(w.every((x) => x.horizonConfident)).toBe(true);
    // Flat ground below the eye cannot block a sunset.
    expect(w.every((x) => x.clearsHorizon)).toBe(true);
    expect(w.some((x) => x.photographable)).toBe(true);
  });

  it('REJECTS a perfect alignment that sets behind a ridge — the whole point of the module', () => {
    const open = enumerateHorizonGatedWindows({
      point: OBS, landmark: SIEGESSAEULE, map: PLAIN, bodyAt, ...range, bodies: ['sun'], enabled: true,
    });
    const blocked = enumerateHorizonGatedWindows({
      point: OBS, landmark: SIEGESSAEULE, map: RIDGED, bodyAt, ...range, bodies: ['sun'], enabled: true,
    });
    // Same instants, same geometry: the alignment itself is unchanged ...
    expect(blocked.length).toBe(open.length);
    for (let i = 0; i < open.length; i++) {
      expect(blocked[i]!.peak.getTime()).toBe(open[i]!.peak.getTime());
      expect(blocked[i]!.coveredFraction).toBeCloseTo(open[i]!.coveredFraction, 9);
    }
    // ... but the terrain now hides every one of them.
    expect(blocked.every((x) => !x.clearsHorizon)).toBe(true);
    expect(blocked.every((x) => !x.photographable)).toBe(true);
    expect(blocked[0]!.horizonAltitudeDeg).toBeGreaterThan(2);
    expect(open[0]!.horizonAltitudeDeg).toBeLessThan(0);
  });

  it('marks the REAL grid result as not confident, because the column is outside coverage', () => {
    const w = enumerateHorizonGatedWindows({
      point: OBS, landmark: SIEGESSAEULE, map: realBerlin(), bodyAt, ...range, bodies: ['sun'], enabled: true,
    });
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((x) => !x.horizonConfident)).toBe(true);
    // Honest, not silently optimistic: the alignment is still reported.
    expect(w.some((x) => x.coveredFraction > 0.5)).toBe(true);
  });

  it('honours the bodies filter', () => {
    const w = enumerateHorizonGatedWindows({
      point: OBS, landmark: SIEGESSAEULE, map: PLAIN, bodyAt, ...range, bodies: ['moon'], enabled: true,
    });
    expect(w.every((x) => x.body === 'moon')).toBe(true);
  });

  it('requires the whole disc to clear when a radius is supplied', () => {
    const centre = enumerateHorizonGatedWindows({
      point: OBS, landmark: SIEGESSAEULE, map: PLAIN, bodyAt, ...range, bodies: ['sun'], enabled: true, discRadiusDeg: 0,
    });
    const whole = enumerateHorizonGatedWindows({
      point: OBS, landmark: SIEGESSAEULE, map: RIDGED, bodyAt, ...range, bodies: ['sun'], enabled: true, discRadiusDeg: 0.25,
    });
    expect(centre.some((x) => x.clearsHorizon)).toBe(true);
    expect(whole.every((x) => !x.clearsHorizon)).toBe(true);
  });
});
