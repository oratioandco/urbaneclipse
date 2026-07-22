/**
 * Celestial-disc placement geometry.
 *
 * The preview draws the sun/moon so a predicted composition can actually be SEEN.
 * The disc is placed at a fixed large distance along its true topocentric direction,
 * sized to subtend the correct angle — so it must land in the right direction, at the
 * right apparent size, and far enough out that city geometry occults it.
 */
import { describe, it, expect } from 'vitest';
import {
  directionOffsetECEF,
  discRadiusMetres,
  azAltTo,
  ecefToGeodetic,
  type ObserverGeodetic,
} from '../../src/lib/silhouette.js';
import { angularRadiusDeg, SUN_RADIUS_KM, MOON_RADIUS_KM } from '../../src/lib/occultation.js';

const OBSERVER: ObserverGeodetic = {
  lat: 52.5113,
  lon: 13.4988,
  ellipsoidalHeight: 89.2,
};

describe('discRadiusMetres', () => {
  it('sizes the sun correctly at a given range', () => {
    // Sun angular radius ~0.2666 deg. At 50 km that is 50000 * tan(0.2666 deg) ~= 232.7 m.
    const r = discRadiusMetres(angularRadiusDeg(SUN_RADIUS_KM, 149.6e6), 50_000);
    expect(r).toBeGreaterThan(220);
    expect(r).toBeLessThan(245);
  });

  it('scales linearly with distance, so apparent size is range-independent', () => {
    const ar = angularRadiusDeg(MOON_RADIUS_KM, 384400);
    const a = discRadiusMetres(ar, 20_000);
    const b = discRadiusMetres(ar, 60_000);
    expect(b / a).toBeCloseTo(3, 6);
  });
});

describe('directionOffsetECEF', () => {
  /** Round-trip: place a point in a direction, then measure the direction back to it. */
  const roundTrip = (az: number, alt: number, d = 50_000) => {
    const p = directionOffsetECEF(OBSERVER, az, alt, d);
    const g = ecefToGeodetic(p[0], p[1], p[2]);
    return azAltTo(OBSERVER, g.lat, g.lon, g.height);
  };

  it('places the point at the requested azimuth and altitude', () => {
    /** Azimuth difference wrapped across the 0/360 seam (due north round-trips as
     *  359.999..., which is 0 for every purpose except naive subtraction). */
    const azDelta = (a: number, b: number) => {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    };

    for (const [az, alt] of [
      [0, 10],
      [90, 5],
      [180, 30],
      [270, 1.8],
      [279.9, 1.81], // the Fernsehturm's real bearing from the bridge
    ] as const) {
      const back = roundTrip(az, alt);
      expect(azDelta(back.az, az), `az=${az}`).toBeLessThan(0.05);
      expect(back.alt, `alt=${alt}`).toBeCloseTo(alt, 1);
    }
  });

  it('places it at the requested range', () => {
    const p = directionOffsetECEF(OBSERVER, 270, 5, 50_000);
    const g = ecefToGeodetic(p[0], p[1], p[2]);
    expect(azAltTo(OBSERVER, g.lat, g.lon, g.height).rangeM).toBeCloseTo(50_000, -1);
  });

  it('puts the disc well beyond the city, so buildings can occult it', () => {
    // The Fernsehturm is ~6.2 km from the bridge; the disc must be much further.
    const p = directionOffsetECEF(OBSERVER, 279.9, 1.81, 50_000);
    const g = ecefToGeodetic(p[0], p[1], p[2]);
    expect(azAltTo(OBSERVER, g.lat, g.lon, g.height).rangeM).toBeGreaterThan(20_000);
  });

  it('a low-altitude direction stays near the horizon rather than diving underground', () => {
    // Naive flat-earth placement at 50 km would sit ~196 m below the horizon plane due
    // to curvature; the resulting point must still be ABOVE the ellipsoid.
    const p = directionOffsetECEF(OBSERVER, 270, 0.5, 50_000);
    const g = ecefToGeodetic(p[0], p[1], p[2]);
    expect(g.height).toBeGreaterThan(0);
  });

  it('north/east/up directions land where expected', () => {
    const north = ecefToGeodetic(...(directionOffsetECEF(OBSERVER, 0, 0, 10_000) as [number, number, number]));
    expect(north.lat).toBeGreaterThan(OBSERVER.lat);

    const east = ecefToGeodetic(...(directionOffsetECEF(OBSERVER, 90, 0, 10_000) as [number, number, number]));
    expect(east.lon).toBeGreaterThan(OBSERVER.lon);

    const up = ecefToGeodetic(...(directionOffsetECEF(OBSERVER, 0, 90, 10_000) as [number, number, number]));
    expect(up.height).toBeGreaterThan(OBSERVER.ellipsoidalHeight + 9_000);
  });
});
