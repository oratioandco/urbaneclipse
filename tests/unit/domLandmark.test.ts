/**
 * Berliner Dom landmark — sanity, geometry and physics goldens.
 *
 * WHAT THE MODEL CAN CLAIM: sun/moon alignments against the DOME complex only
 * (tambour band, hemispherical dome, lantern, cross) — a dome-only surface of
 * revolution, apex at the CURRENT 98 m (de.wikipedia), never the historic
 * 114 m (en.wikipedia, pre-1975) or 115 m (pre-1944).
 * WHAT IT CANNOT CLAIM: alignments against the four corner towers or the nave —
 * they are excluded from the profile. The December negative control below proves
 * the exclusion: a winter sun at the dome azimuth sits BELOW the tambour foot and
 * would hit a nave-inclusive model, but must miss this one.
 *
 * Canonical vantage: Friedrichsbrücke, OSM way 339201182, 52.5205529, 13.4003017
 * (.research/friedrichs.json). No network at test time: the independent checks are
 * a self-contained Vincenty inverse geodesic and a self-contained Meeus-style
 * solar ephemeris (patterns from vantages.test.ts / horizonWindows.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { BERLINER_DOM, landmarkHeight } from '../../src/lib/landmarks';
import { buildSilhouetteDirections } from '../../src/lib/silhouette';
import { findOccultationsAtPosition } from '../../src/lib/areaSolver';
import { sampleBody } from '../../src/lib/bodyPosition';
import { bearingDistanceTo } from '../../src/lib/vantages';
import { orthometricToEllipsoidal } from '../../src/lib/elevation';

const D2R = Math.PI / 180;

/** Canonical vantage (research-pinned, see header). */
const FRIEDRICHSBRUECKE = { lat: 52.5205529, lon: 13.4003017 };
/** DGM1 ground at the vantage, bilinear, measured offline (NHN, m). */
const VANTAGE_GROUND = 30.8;
const EYE_HEIGHT = 1.6;

// ---------------------------------------------------------------------------
// Independent geodesic: Vincenty inverse on WGS84 (no repo code involved).
// ---------------------------------------------------------------------------
function vincentyInverse(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): { distanceM: number; bearingDeg: number } {
  const A = 6378137;
  const F = 1 / 298.257223563;
  const B = A * (1 - F);
  const p1 = a.lat * D2R;
  const p2 = b.lat * D2R;
  const L = (b.lon - a.lon) * D2R;
  const U1 = Math.atan((1 - F) * Math.tan(p1));
  const U2 = Math.atan((1 - F) * Math.tan(p2));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1);
  const sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, lamP = 0, it = 0;
  let sSig = 0, cSig = 0, sig = 0, sAlp = 0, c2Alp = 0, c2Sm = 0;
  do {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    sSig = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl);
    cSig = sU1 * sU2 + cU1 * cU2 * cl;
    sig = Math.atan2(sSig, cSig);
    sAlp = (cU1 * cU2 * sl) / sSig;
    c2Alp = 1 - sAlp * sAlp;
    c2Sm = cSig - (2 * sU1 * sU2) / c2Alp;
    const C = (F / 16) * c2Alp * (4 + F * (4 - 3 * c2Alp));
    lamP = lam;
    lam = L + (1 - C) * F * sAlp *
      (sig + C * sSig * (c2Sm + C * cSig * (-1 + 2 * c2Sm * c2Sm)));
  } while (Math.abs(lam - lamP) > 1e-12 && ++it < 100);
  const u2 = (c2Alp * (A * A - B * B)) / (B * B);
  const Ac = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const Bc = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dSig = Bc * sSig * (c2Sm + (Bc / 4) *
    (cSig * (-1 + 2 * c2Sm * c2Sm) -
      (Bc / 6) * c2Sm * (-3 + 4 * sSig * sSig) * (-3 + 4 * c2Sm * c2Sm)));
  const distanceM = B * Ac * (sig - dSig);
  const az1 = Math.atan2(cU2 * Math.sin(lam), cU1 * sU2 - sU1 * cU2 * Math.cos(lam));
  return { distanceM, bearingDeg: ((az1 / D2R) + 360) % 360 };
}

// ---------------------------------------------------------------------------
// Independent solar ephemeris: Meeus, Astronomical Algorithms, low precision
// (ch. 25 solar coordinates + ch. 13 transformation). No refraction — suncalc's
// geometric position is the like-for-like comparison. Accurate to ~0.01 deg.
// ---------------------------------------------------------------------------
function meeusSunAzAlt(date: Date, lat: number, lon: number): { az: number; alt: number } {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * D2R;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * T) * D2R;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * D2R;
  const eps0 = 23 + 26 / 60 + 21.448 / 3600 -
    (46.815 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545) +
    0.000387933 * T * T - (T * T * T) / 38710000;
  const lst = (((gmst + lon) % 360) + 360) % 360;
  const H = lst * D2R - ra;
  const phi = lat * D2R;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) +
    Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H),
    Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) / D2R + 180;
  return { az: ((az % 360) + 360) % 360, alt: alt / D2R };
}

const OBSERVER = {
  lat: FRIEDRICHSBRUECKE.lat,
  lon: FRIEDRICHSBRUECKE.lon,
  ellipsoidalHeight: orthometricToEllipsoidal(VANTAGE_GROUND + EYE_HEIGHT),
};
const bodyAt = (t: Date) => sampleBody('sun', t, OBSERVER.lat, OBSERVER.lon);

// ---------------------------------------------------------------------------
// (a) Sanity
// ---------------------------------------------------------------------------
describe('BERLINER_DOM sanity', () => {
  it('claims the CURRENT 98 m apex, not the historic 114/115 m', () => {
    expect(landmarkHeight(BERLINER_DOM)).toBe(98);
    expect(landmarkHeight(BERLINER_DOM)).toBeLessThan(114);
  });

  it('has strictly ascending heights and positive radii', () => {
    const p = BERLINER_DOM.profile;
    expect(p.length).toBeGreaterThan(4);
    for (let i = 0; i < p.length; i++) {
      expect(p[i]![1]).toBeGreaterThan(0);
      if (i > 0) expect(p[i]![0]).toBeGreaterThan(p[i - 1]![0]);
    }
  });

  it('sits at the OSM way 313670734 centroid, on plausible Berlin ground', () => {
    expect(BERLINER_DOM.lat).toBeCloseTo(52.5190822, 7);
    expect(BERLINER_DOM.lon).toBeCloseTo(13.4010942, 7);
    // DGM1 ground at the dome axis measured offline: 35.26 m NHN.
    expect(BERLINER_DOM.baseOrthometric).toBeGreaterThan(30);
    expect(BERLINER_DOM.baseOrthometric).toBeLessThan(40);
  });

  it('carries the sourced 33 m dome diameter as its widest ring', () => {
    // Profile entries are [heightAboveBase, radius] tuples.
    const maxR = Math.max(...BERLINER_DOM.profile.map((r) => r[1]));
    expect(maxR).toBeCloseTo(16.5, 2);
    const apex = BERLINER_DOM.profile[BERLINER_DOM.profile.length - 1]!;
    expect(apex[1]).toBeLessThan(3); // cross tip, not a spire
  });
});

// ---------------------------------------------------------------------------
// (b) Geometry — repo ECEF->ENU chain vs independent Vincenty geodesic
// ---------------------------------------------------------------------------
describe('geometry from the canonical vantage (Friedrichsbrücke)', () => {
  const repo = bearingDistanceTo(FRIEDRICHSBRUECKE, {
    lat: BERLINER_DOM.lat,
    lon: BERLINER_DOM.lon,
  });
  const vincenty = vincentyInverse(FRIEDRICHSBRUECKE, BERLINER_DOM);

  it('repo bearing/distance agree with the independent geodesic', () => {
    // Offline-pinned values: 161.8036 deg, 172.270 m (Vincenty, WGS84).
    expect(vincenty.bearingDeg).toBeCloseTo(161.8036, 2);
    expect(vincenty.distanceM).toBeCloseTo(172.27, 1);
    expect(Math.abs(repo.bearingDeg - vincenty.bearingDeg)).toBeLessThan(0.05);
    expect(Math.abs(repo.distanceM - vincenty.distanceM)).toBeLessThan(0.5);
  });

  it('silhouette spans exactly the dome band — no towers, no nave', () => {
    const sil = buildSilhouetteDirections(OBSERVER, BERLINER_DOM);
    const d = vincenty.distanceM;
    const eye = VANTAGE_GROUND + EYE_HEIGHT;
    const base = BERLINER_DOM.baseOrthometric;
    const halfWidth = Math.atan2(16.5, d) / D2R; // ~5.48 deg
    const altMax = Math.atan2(base + 98 - eye, d) / D2R; // ~30.35 deg
    const altMin = Math.atan2(base + 62 - eye, d) / D2R; // ~20.63 deg (tambour foot)
    const centre = vincenty.bearingDeg;
    const azMin = Math.min(...sil.outline.map((s) => s.az));
    const azMax = Math.max(...sil.outline.map((s) => s.az));
    const hiAlt = Math.max(...sil.outline.map((s) => s.alt));
    const loAlt = Math.min(...sil.outline.map((s) => s.alt));
    expect(azMin).toBeGreaterThan(centre - halfWidth - 0.4);
    expect(azMax).toBeLessThan(centre + halfWidth + 0.4);
    expect(azMax - azMin).toBeGreaterThan(2 * halfWidth - 0.8);
    expect(Math.abs(hiAlt - altMax)).toBeLessThan(0.5);
    // The band FLOOR is the tambour foot: a nave-inclusive model would reach ~8 deg.
    expect(loAlt).toBeGreaterThan(altMin - 0.5);
    expect(loAlt).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// (c) Physics goldens — findOccultationsAtPosition over the sun season
// ---------------------------------------------------------------------------
describe('sun transits behind the dome from Friedrichsbrücke (2026)', () => {
  // Geometry: the dome bears 161.8 deg and spans alt 20.6-30.3 deg. The sun
  // crosses that azimuth at ~26 deg altitude when its declination is ~-10 deg
  // (late February / mid October) — a twice-yearly window, like Manhattanhenge.
  // At the June solstice the sun is ~46 deg high at that azimuth (too high);
  // at the December solstice ~12.7 deg (below the tambour foot).
  const spring = {
    start: new Date(Date.UTC(2026, 1, 10)),
    end: new Date(Date.UTC(2026, 2, 20)),
  };
  const autumn = {
    start: new Date(Date.UTC(2026, 9, 1)),
    end: new Date(Date.UTC(2026, 10, 10)),
  };
  const search = (w: { start: Date; end: Date }) =>
    findOccultationsAtPosition({
      observer: OBSERVER,
      landmark: BERLINER_DOM,
      start: w.start,
      end: w.end,
      stepMinutes: 5,
      bodyAt,
      wanted: ['full', 'partial'],
    });

  /**
   * Independent CORE full-transit window: Meeus sun fully inside the dome band's
   * core. The core (below the 84.5 m crown, well inside the limbs) is where the
   * flat rectangle is faithful; near the band's top corners the true silhouette
   * narrows to the lantern, so a rectangle there would wrongly call corner
   * grazes "full" before the sun actually fits inside the dome shape.
   */
  function independentCoreWindow(w: { start: Date; end: Date }) {
    const v = vincentyInverse(FRIEDRICHSBRUECKE, BERLINER_DOM);
    const d = v.distanceM;
    const eye = VANTAGE_GROUND + EYE_HEIGHT;
    const base = BERLINER_DOM.baseOrthometric;
    const halfWidth = Math.atan2(16.5, d) / D2R;
    const altLo = Math.atan2(base + 62 - eye, d) / D2R;
    const altCrown = Math.atan2(base + 84.5 - eye, d) / D2R;
    const margin = 1.5; // deg — deep inside the full-width dome band
    let first: number | null = null;
    let last: number | null = null;
    for (let t = w.start.getTime(); t <= w.end.getTime(); t += 5 * 60000) {
      const s = meeusSunAzAlt(new Date(t), OBSERVER.lat, OBSERVER.lon);
      if (Math.abs(s.az - v.bearingDeg) < halfWidth - margin &&
        s.alt > altLo + margin && s.alt < altCrown - margin) {
        if (first === null) first = t;
        last = t;
      }
    }
    return { first, last };
  }

  it('finds real transits in BOTH seasonal windows, including full ones', () => {
    for (const w of [spring, autumn]) {
      const hits = search(w);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((h) => h.kind === 'full')).toBe(true);
    }
  }, 60000);

  it('pins transit dates against the independent Meeus ephemeris', () => {
    for (const w of [spring, autumn]) {
      const hits = search(w).filter((h) => h.kind === 'full');
      const ind = independentCoreWindow(w);
      expect(ind.first).not.toBeNull();
      expect(ind.last).not.toBeNull();
      const times = hits.map((h) => h.when.getTime());
      const lo = Math.min(...times);
      const hi = Math.max(...times);
      // The core window lies strictly inside the true full-transit window, so the
      // repo's span must CONTAIN it — within one 5-min grid step plus tolerance
      // at each edge. The repo may legitimately extend beyond the core: the dome
      // band's corners still occult where the rectangle check has stopped.
      expect(lo).toBeLessThanOrEqual(ind.first! + 15 * 60000);
      expect(hi).toBeGreaterThanOrEqual(ind.last! - 15 * 60000);
      // Every hit's sun position agrees with Meeus, and sits in the dome band.
      for (const h of hits) {
        const s = sampleBody('sun', h.when, OBSERVER.lat, OBSERVER.lon);
        const m = meeusSunAzAlt(h.when, OBSERVER.lat, OBSERVER.lon);
        expect(Math.abs(s.az - m.az)).toBeLessThan(0.1);
        expect(Math.abs(s.alt - m.alt)).toBeLessThan(0.1);
        expect(Math.abs(s.az - 161.8036)).toBeLessThan(6.0);
        expect(s.alt).toBeGreaterThan(20.0);
        expect(s.alt).toBeLessThan(31.0);
      }
    }
  }, 60000);

  it('JUNE: no transits — the sun passes far ABOVE the dome', () => {
    const hits = search({
      start: new Date(Date.UTC(2026, 5, 1)),
      end: new Date(Date.UTC(2026, 6, 1)),
    });
    expect(hits).toHaveLength(0);
    // Independent confirmation: at the dome azimuth the June sun is > 40 deg up.
    let maxAltAtAz = -90;
    for (let t = Date.UTC(2026, 5, 21); t < Date.UTC(2026, 5, 22); t += 60000) {
      const s = meeusSunAzAlt(new Date(t), OBSERVER.lat, OBSERVER.lon);
      if (Math.abs(s.az - 161.8) < 1) maxAltAtAz = Math.max(maxAltAtAz, s.alt);
    }
    expect(maxAltAtAz).toBeGreaterThan(40);
  }, 60000);

  it('DECEMBER: no transits — proves towers/nave are NOT modeled', () => {
    // A winter sun at az 161.8 deg is ~12.7 deg high: below the 20.6 deg tambour
    // foot, but ABOVE a nave roofline (~8 deg). Zero hits is the discriminator.
    const hits = search({
      start: new Date(Date.UTC(2026, 11, 10)),
      end: new Date(Date.UTC(2027, 0, 10)),
    });
    expect(hits).toHaveLength(0);
    let altAtAz = -90;
    for (let t = Date.UTC(2026, 11, 21); t < Date.UTC(2026, 11, 22); t += 60000) {
      const s = meeusSunAzAlt(new Date(t), OBSERVER.lat, OBSERVER.lon);
      if (Math.abs(s.az - 161.8) < 1) altAtAz = Math.max(altAtAz, s.alt);
    }
    expect(altAtAz).toBeGreaterThan(8); // would hit a nave-inclusive model
    expect(altAtAz).toBeLessThan(20); // misses the dome-only band
  }, 60000);
});