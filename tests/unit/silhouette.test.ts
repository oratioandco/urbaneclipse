/**
 * Silhouette projection + parametric landmark tests.
 *
 * These pin the geometry that the whole urban-eclipse feature rests on: how big the
 * Fernsehturm actually looks from the Lichtenberger Bruecke, and whether the sphere
 * shows up as a bulge in the outline the way it must.
 */
import { describe, it, expect } from 'vitest';
import {
  FERNSEHTURM,
  radiusAtHeight,
  landmarkHeight,
  type RevolutionLandmark,
} from '../../src/lib/landmarks.js';
import {
  azAltTo,
  buildSilhouette,
  geodeticToECEF,
  toTangentPlane,
  type ObserverGeodetic,
} from '../../src/lib/silhouette.js';
import {
  classifyOccultation,
  angularRadiusDeg,
  maxRangeForFullOccultation,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
} from '../../src/lib/occultation.js';
import { resolveEyeEllipsoidalHeight } from '../../src/lib/elevation.js';
import { OBSERVER_DEFAULT } from '../../src/lib/berlin.js';

/** Observer on the Lichtenberger Bruecke deck, eye height 1.5 m. */
const OBSERVER: ObserverGeodetic = {
  lat: OBSERVER_DEFAULT.lat,
  lon: OBSERVER_DEFAULT.lon,
  ellipsoidalHeight: resolveEyeEllipsoidalHeight({ groundOrthometric: 34, eyeHeight: 1.5 }),
};

describe('FERNSEHTURM parametric model', () => {
  it('is 368.03 m tall — the LoD2 data was 114.5 m short', () => {
    expect(landmarkHeight(FERNSEHTURM)).toBeCloseTo(368.03, 2);
  });

  it('models the sphere as a genuine bulge, not a prism', () => {
    // THE defining regression. LoD2 held radius constant to 4 significant figures
    // across 216 vertical metres; a real sphere must bulge and then narrow again.
    const belowSphere = radiusAtHeight(FERNSEHTURM, 197);
    const atCentre = radiusAtHeight(FERNSEHTURM, 213);
    const aboveSphere = radiusAtHeight(FERNSEHTURM, 231);

    expect(atCentre).toBeCloseTo(16, 1); // 32 m diameter
    expect(atCentre).toBeGreaterThan(belowSphere * 2);
    expect(atCentre).toBeGreaterThan(aboveSphere * 2);
  });

  it('tapers monotonically along the shaft', () => {
    // Real: 32 m flare at the foot -> 16 m -> 9 m at the top of the concrete.
    expect(radiusAtHeight(FERNSEHTURM, 0)).toBeCloseTo(16, 1);
    expect(radiusAtHeight(FERNSEHTURM, 20)).toBeCloseTo(8, 1);
    expect(radiusAtHeight(FERNSEHTURM, 100)).toBeLessThan(radiusAtHeight(FERNSEHTURM, 20));
    expect(radiusAtHeight(FERNSEHTURM, 240)).toBeLessThan(radiusAtHeight(FERNSEHTURM, 100));
  });

  it('has a thin antenna above the concrete shaft', () => {
    const antenna = radiusAtHeight(FERNSEHTURM, 300);
    expect(antenna).toBeGreaterThan(0);
    expect(antenna).toBeLessThan(3);
    expect(radiusAtHeight(FERNSEHTURM, 368.03)).toBe(0);
  });

  it('returns zero radius above the tip', () => {
    expect(radiusAtHeight(FERNSEHTURM, 400)).toBe(0);
  });
});

describe('geodesy helpers', () => {
  it('places the ECEF origin sensibly for Berlin', () => {
    const [x, y, z] = geodeticToECEF(52.52, 13.41, 0);
    expect(Math.hypot(x, y, z)).toBeGreaterThan(6.35e6);
    expect(Math.hypot(x, y, z)).toBeLessThan(6.39e6);
  });

  it('measures the observer-to-tower range as ~6160 m', () => {
    // From the CORRECTED Lichtenberger Bruecke coordinate (52.5113, 13.4988). The old
    // default (52.5106, 13.4652) was not the bridge at all and sat 3953 m out.
    const r = azAltTo(OBSERVER, FERNSEHTURM.lat, FERNSEHTURM.lon, 74.1);
    expect(r.rangeM).toBeGreaterThan(6000);
    expect(r.rangeM).toBeLessThan(6300);
  });

  it('bears roughly west toward the tower', () => {
    const r = azAltTo(OBSERVER, FERNSEHTURM.lat, FERNSEHTURM.lon, 74.1);
    expect(r.az).toBeGreaterThan(275);
    expect(r.az).toBeLessThan(285);
  });

  it('tangent-plane projection puts the reference direction at the origin', () => {
    const ref = { az: 288, alt: 5 };
    const p = toTangentPlane(ref, ref);
    expect(p.x).toBeCloseTo(0, 12);
    expect(p.y).toBeCloseTo(0, 12);
  });

  it('tangent-plane compresses azimuth by cos(alt)', () => {
    // 1 deg of azimuth at 60 deg altitude is only ~0.5 deg on the sky. Ignoring this would
    // badly distort high-sun geometry.
    const low = toTangentPlane({ az: 1, alt: 0 }, { az: 0, alt: 0 });
    const high = toTangentPlane({ az: 1, alt: 60 }, { az: 0, alt: 60 });
    expect(Math.abs(low.x)).toBeCloseTo(1, 2);
    expect(Math.abs(high.x)).toBeCloseTo(0.5, 1);
  });
});

describe('buildSilhouette from the Lichtenberger Bruecke', () => {
  const towerDir = azAltTo(OBSERVER, FERNSEHTURM.lat, FERNSEHTURM.lon, 74.1 + 213);
  const reference = { az: towerDir.az, alt: towerDir.alt };
  const poly = buildSilhouette(OBSERVER, FERNSEHTURM, reference);

  it('produces a closed polygon with finite vertices', () => {
    expect(poly.length).toBeGreaterThan(50);
    for (const p of poly) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('spans ~3.4 deg vertically — the tower is far taller than the moon is wide', () => {
    const ys = poly.map((p) => p.y);
    const span = Math.max(...ys) - Math.min(...ys);
    // 368 m of structure at ~6160 m ~= 3.4 deg.
    expect(span).toBeGreaterThan(3.0);
    expect(span).toBeLessThan(4.0);
  });

  it('is only ~0.30 deg wide at the sphere — NARROWER than the moon', () => {
    // 32 m at 6160 m ~= 0.298 deg, against a ~0.52 deg moon. The tower is visibly
    // slimmer than the disc from here, which is what caps coverage well below 100%.
    const widest = Math.max(...poly.map((p) => Math.abs(p.x))) * 2;
    expect(widest).toBeGreaterThan(0.26);
    expect(widest).toBeLessThan(0.34);
  });

  it('is far narrower at mid-shaft than at the sphere — the LoD2 failure mode', () => {
    // LoD2 reported a constant 36 m width here, claiming a 0.52 deg obstacle where the
    // real shaft is ~0.2 deg. Widths are measured in narrow altitude bands.
    const widthNear = (targetY: number) => {
      const band = poly.filter((p) => Math.abs(p.y - targetY) < 0.05);
      return band.length ? Math.max(...band.map((p) => Math.abs(p.x))) * 2 : 0;
    };
    const sphereY = 0; // reference is the sphere centre
    const midShaftDir = azAltTo(OBSERVER, FERNSEHTURM.lat, FERNSEHTURM.lon, 74.1 + 100);
    const midShaftY = toTangentPlane({ az: midShaftDir.az, alt: midShaftDir.alt }, reference).y;

    const wSphere = widthNear(sphereY);
    const wShaft = widthNear(midShaftY);

    expect(wSphere).toBeGreaterThan(0.26);
    expect(wShaft).toBeGreaterThan(0);
    expect(wShaft).toBeLessThan(wSphere * 0.6);
  });
});

describe('end-to-end urban eclipse classification', () => {
  const moonRadius = angularRadiusDeg(MOON_RADIUS_KM, 384400);

  it('a moon centred on the sphere is only ~43% covered — NEVER full from this bridge', () => {
    const sphereDir = azAltTo(OBSERVER, FERNSEHTURM.lat, FERNSEHTURM.lon, 74.1 + 213);
    const ref = { az: sphereDir.az, alt: sphereDir.alt };
    const poly = buildSilhouette(OBSERVER, FERNSEHTURM, ref);
    const r = classifyOccultation(moonRadius, poly);

    // HARD GEOMETRIC LIMIT, not a modelling shortfall. The tower's widest point is
    // 32 m, subtending just 0.298 deg at 6160 m, while the moon spans ~0.518 deg. The moon
    // is substantially BIGGER than the tower looks from here, so no date or time can
    // produce a full occultation from the Lichtenberger Bruecke — the best achievable
    // is a partial with the disc protruding on both sides.
    expect(r.kind).toBe('partial');
    expect(r.coveredFraction).toBeGreaterThan(0.35);
    expect(r.coveredFraction).toBeLessThan(0.5);
  });

  it('quantifies how much closer you must stand for a FULL occultation', () => {
    const towerWidest = 32; // sphere diameter, and the flared foot
    const sunRadius = angularRadiusDeg(SUN_RADIUS_KM, 149.6e6);
    const moonPerigee = angularRadiusDeg(MOON_RADIUS_KM, 356500);

    const dMoon = maxRangeForFullOccultation(towerWidest, moonRadius);
    const dSun = maxRangeForFullOccultation(towerWidest, sunRadius);
    const dPerigee = maxRangeForFullOccultation(towerWidest, moonPerigee);

    expect(dMoon).toBeCloseTo(3540, -1);
    expect(dSun).toBeCloseTo(3441, -1);
    expect(dPerigee).toBeCloseTo(3283, -1);

    // A perigee "supermoon" is the LEAST forgiving: bigger disc, shorter range.
    expect(dPerigee).toBeLessThan(dMoon);

    // All are inside the bridge's 3953 m — the impossibility above, from the other side.
    const bridgeRange = azAltTo(OBSERVER, FERNSEHTURM.lat, FERNSEHTURM.lon, 74.1 + 213).rangeM;
    expect(bridgeRange).toBeGreaterThan(dMoon);
    expect(bridgeRange).toBeGreaterThan(dSun);
  });

  it('a moon well to the side of the tower is not occulted', () => {
    const sphereDir = azAltTo(OBSERVER, FERNSEHTURM.lat, FERNSEHTURM.lon, 74.1 + 213);
    const ref = { az: sphereDir.az + 2, alt: sphereDir.alt };
    const poly = buildSilhouette(OBSERVER, FERNSEHTURM, ref);
    const r = classifyOccultation(moonRadius, poly);

    expect(r.coveredFraction).toBe(0);
    expect(['adjacent', 'clear']).toContain(r.kind);
  });

  it('the thin antenna only partially covers the moon — never fully', () => {
    // At 300 m AGL the antenna is ~2 m wide (~0.03 deg) against a 0.52 deg moon. This is the
    // shot LoD2 could not represent at all, since it had no antenna.
    const antennaDir = azAltTo(OBSERVER, FERNSEHTURM.lat, FERNSEHTURM.lon, 74.1 + 300);
    const ref = { az: antennaDir.az, alt: antennaDir.alt };
    const poly = buildSilhouette(OBSERVER, FERNSEHTURM, ref);
    const r = classifyOccultation(moonRadius, poly);

    expect(r.kind).toBe('partial');
    expect(r.coveredFraction).toBeGreaterThan(0);
    expect(r.coveredFraction).toBeLessThan(0.35);
  });

  it('an empty landmark yields no silhouette rather than throwing', () => {
    const empty: RevolutionLandmark = { ...FERNSEHTURM, profile: [] };
    expect(buildSilhouette(OBSERVER, empty, { az: 0, alt: 0 })).toEqual([]);
  });
});
