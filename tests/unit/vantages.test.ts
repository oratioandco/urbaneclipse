/**
 * Standing points of the Lichtenberger Bruecke — the deck-height decision, locked.
 *
 * THE DECISION THESE TESTS DEFEND (chosen by the person, ask id 2, key "2")
 * -----------------------------------------------------------------------
 * Berlin DOM1 was sampled at all six OSM nodes. Only the two crest nodes measure
 * inside the curated mid-span envelope 48.1-48.3 m DHHN2016; the four ramp/flank
 * nodes measure 46.9-47.8 m, which is the real ramp profile (scripts/README.md:
 * west ramp 46.1 m, east ramp 46.7 m), not a confirmed deck height for the curated
 * band. So ONLY the crest points adopt an individual value and clear needsSiteCheck;
 * the ramp points keep the curated 48.2 m and still need an on-site survey.
 *
 * The original acceptance criterion asked for six individual heights inside
 * 48.0-48.5 m. That is NOT satisfiable with the real data, and raising a measured
 * 46.9 m to 48.0 m would be fabrication. The person chose this reading knowing that
 * consequence, so the last test below pins the consequence instead of hiding it.
 */
import { describe, it, expect } from 'vitest';
import {
  LICHTENBERGER_BRUECKE,
  EYE_HEIGHT_M,
  CURATED_CREST_ENVELOPE_M,
  bearingDistanceTo,
  standingPoint,
} from '../../src/lib/vantages.js';

const FERNSEHTURM = { lat: 52.520815, lon: 13.409419 };

/** The DOM1 plateau medians measured per node, metres DHHN2016 (three samplings, +-0.1 m). */
const MEASURED: Record<string, number> = {
  'nord-west': 47.8,
  'nord-mitte': 47.7,
  'nord-knick': 46.9,
  'sued-west': 47.0,
  'sued-mitte': 48.2,
  'sued-ost': 48.1,
};

/** The DOM1 median of a node; fails loudly if a point is ever added without data. */
function measured(id: string): number {
  const m = MEASURED[id];
  if (m === undefined) throw new Error(`no DOM1 median recorded for ${id}`);
  return m;
}

const CURATED_MIDSPAN = 48.2;
const CREST_IDS = ['sued-mitte', 'sued-ost'];
const RAMP_IDS = ['nord-west', 'nord-mitte', 'nord-knick', 'sued-west'];

const points = LICHTENBERGER_BRUECKE.points;
const byId = (id: string) => {
  const p = points.find((q) => q.id === id);
  if (!p) throw new Error(`no standing point ${id}`);
  return p;
};

describe('Lichtenberger Bruecke standing points', () => {
  it('carries exactly the six OSM nodes of both carriageway arms', () => {
    expect(points.map((p) => p.id)).toEqual([
      'nord-west',
      'nord-mitte',
      'nord-knick',
      'sued-west',
      'sued-mitte',
      'sued-ost',
    ]);
  });

  it('keeps the curated mid-span envelope as the adoption band', () => {
    expect(CURATED_CREST_ENVELOPE_M).toEqual([48.1, 48.3]);
  });

  it('adopts an individual height for exactly the two crest points', () => {
    const confirmed = points.filter((p) => !p.needsSiteCheck).map((p) => p.id);
    expect(confirmed.sort()).toEqual([...CREST_IDS].sort());
    for (const id of CREST_IDS) {
      const p = byId(id);
      const [lo, hi] = CURATED_CREST_ENVELOPE_M;
      expect(p.surfaceOrthometric).toBeGreaterThanOrEqual(lo);
      expect(p.surfaceOrthometric).toBeLessThanOrEqual(hi);
      // Adopted means measured: the value IS the DOM1 median, not a rounded guess.
      expect(p.surfaceOrthometric).toBeCloseTo(measured(id), 6);
    }
  });

  it('gives the two crest points genuinely different deck heights', () => {
    expect(byId('sued-mitte').surfaceOrthometric).not.toBe(byId('sued-ost').surfaceOrthometric);
    expect(byId('sued-ost').surfaceOrthometric).toBeCloseTo(48.1, 6);
  });

  it('leaves the four ramp/flank points on the curated flat value, still unsurveyed', () => {
    for (const id of RAMP_IDS) {
      const p = byId(id);
      expect(p.surfaceOrthometric).toBe(CURATED_MIDSPAN);
      expect(p.needsSiteCheck).toBe(true);
    }
  });

  it('keeps mid-span at the curated ~48.2 m', () => {
    expect(byId('sued-mitte').surfaceOrthometric).toBeCloseTo(48.2, 1);
    expect(Math.abs(byId('sued-mitte').surfaceOrthometric - 48.2)).toBeLessThan(0.05);
  });

  it('never raises a measured value to fit a band', () => {
    for (const p of points) {
      const median = measured(p.id);
      // Either the measurement was adopted verbatim, or the curated value is used and
      // the point is flagged. No point may claim to be higher than what DOM1 measured
      // while also claiming to be confirmed.
      if (!p.needsSiteCheck) expect(p.surfaceOrthometric).toBeLessThanOrEqual(median + 1e-9);
      else expect(p.surfaceOrthometric).toBe(CURATED_MIDSPAN);
    }
  });

  it('keeps every deck height physically plausible for this bridge', () => {
    for (const p of points) {
      // Deck crest 48.1-48.3 curated; nothing may drift into the DGM1 rail cutting.
      expect(p.surfaceOrthometric).toBeGreaterThan(45);
      expect(p.surfaceOrthometric).toBeLessThan(50);
    }
  });

  it('uses the standing photographer eye height of 1.6 m everywhere', () => {
    expect(EYE_HEIGHT_M).toBe(1.6);
    for (const p of points) expect(p.eyeHeightM).toBe(1.6);
  });
});

describe('per-point provenance', () => {
  it('gives every point a non-empty source', () => {
    for (const p of points) {
      expect(typeof p.source).toBe('string');
      expect(p.source.trim().length).toBeGreaterThan(0);
    }
  });

  it('names dataset, sheet, fetch date, CRS, vertical datum, licence and method', () => {
    for (const p of points) {
      expect(p.source).toContain('DOM1');
      expect(p.source).toContain('dom1_33_398_5818_2');
      expect(p.source).toContain('2026-11-12');
      expect(p.source).toContain('EPSG:25833');
      expect(p.source).toContain('DHHN2016');
      expect(p.source).toContain('dl-de/zero-2-0');
      expect(p.source).toMatch(/median/i);
      expect(p.source).toContain('https://gdi.berlin.de/data/dom/atom/');
    }
  });

  it('records the measured median of each point, adopted or rejected', () => {
    for (const p of points) {
      expect(p.source).toContain(`Measured median ${measured(p.id).toFixed(1)} m`);
    }
  });

  it('says explicitly which medians were rejected and why', () => {
    for (const id of RAMP_IDS) {
      const src = byId(id).source;
      expect(src).toMatch(/NOT adopted/);
      expect(src).toContain('needsSiteCheck stays true');
      // The rejected measurement is preserved, not overwritten by the flat value.
      expect(src).toContain(measured(id).toFixed(1));
    }
    for (const id of CREST_IDS) {
      expect(byId(id).source).toMatch(/adopted as the deck height/);
      expect(byId(id).source).toContain('needsSiteCheck is false');
    }
  });

  it('warns that DGM1 bare earth is not the deck', () => {
    for (const p of points) expect(p.source).toContain('NOT DGM1');
  });
});

describe('geometry stays computed, never hand-entered', () => {
  it('reproduces bearing and distance from the coordinates via ECEF -> ENU', () => {
    for (const p of points) {
      const { bearingDeg, distanceM } = bearingDistanceTo(p, FERNSEHTURM);
      expect(p.bearingToLandmarkDeg).toBe(bearingDeg);
      expect(p.distanceToLandmarkM).toBe(distanceM);
    }
  });

  it('agrees with an independent Vincenty inverse on WGS84 to 0.001 deg / 0.01 m', () => {
    // Genuinely independent of the repo's ECEF -> ENU path: Vincenty's inverse geodesic
    // on the same ellipsoid. The only residual is chord-vs-geodesic tangent, ~1e-5 deg
    // over 6 km, hence the 0.001 deg bound.
    const a = 6378137;
    const f = 1 / 298.257223563;
    const b = a * (1 - f);
    const rad = Math.PI / 180;
    for (const p of points) {
      const U1 = Math.atan((1 - f) * Math.tan(p.lat * rad));
      const U2 = Math.atan((1 - f) * Math.tan(FERNSEHTURM.lat * rad));
      const L = (FERNSEHTURM.lon - p.lon) * rad;
      let lambda = L;
      let sinSigma = 0;
      let cosSigma = 0;
      let cos2SigmaM = 0;
      let sigma = 0;
      let sinAlpha = 0;
      for (let i = 0; i < 200; i++) {
        const sinL = Math.sin(lambda);
        const cosL = Math.cos(lambda);
        sinSigma = Math.hypot(
          Math.cos(U2) * sinL,
          Math.cos(U1) * Math.sin(U2) - Math.sin(U1) * Math.cos(U2) * cosL,
        );
        cosSigma = Math.sin(U1) * Math.sin(U2) + Math.cos(U1) * Math.cos(U2) * cosL;
        sigma = Math.atan2(sinSigma, cosSigma);
        sinAlpha = (Math.cos(U1) * Math.cos(U2) * sinL) / sinSigma;
        cos2SigmaM = cosSigma - (2 * Math.sin(U1) * Math.sin(U2)) / (1 - sinAlpha * sinAlpha);
        const C = (f / 16) * (1 - sinAlpha * sinAlpha) * (4 + f * (4 - 3 * (1 - sinAlpha * sinAlpha)));
        const next =
          L +
          (1 - C) * f * sinAlpha *
            (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
        if (Math.abs(next - lambda) < 1e-13) { lambda = next; break; }
        lambda = next;
      }
      const azimuth =
        (Math.atan2(
          Math.cos(U2) * Math.sin(lambda),
          Math.cos(U1) * Math.sin(U2) - Math.sin(U1) * Math.cos(U2) * Math.cos(lambda),
        ) / rad + 360) % 360;
      // cos^2(alpha) of the geodesic azimuth at the equator — NOT cos^2(sigma).
      const uSq = (1 - sinAlpha * sinAlpha) * ((a * a - b * b) / (b * b));
      const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
      const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
      const dSigma =
        B * sinSigma *
        (cos2SigmaM + (B / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
      const geodesicM = b * A * (sigma - dSigma);
      expect(Math.abs(p.bearingToLandmarkDeg - azimuth)).toBeLessThan(0.001);
      // ENU horizontal distance is the chord projection; over 6 km it is within 1 cm.
      expect(Math.abs(p.distanceToLandmarkM - geodesicM)).toBeLessThan(0.01);
    }
  });

  it('sits in the bridge bearing/distance corridor (spherical sanity check)', () => {
    const rad = Math.PI / 180;
    for (const p of points) {
      const dLon = (FERNSEHTURM.lon - p.lon) * rad;
      const y = Math.sin(dLon) * Math.cos(FERNSEHTURM.lat * rad);
      const x =
        Math.cos(p.lat * rad) * Math.sin(FERNSEHTURM.lat * rad) -
        Math.sin(p.lat * rad) * Math.cos(FERNSEHTURM.lat * rad) * Math.cos(dLon);
      const spherical = (Math.atan2(y, x) / rad + 360) % 360;
      // Sphere vs ellipsoid differs by ~0.024 deg here — a datum difference, not drift.
      expect(Math.abs(p.bearingToLandmarkDeg - spherical)).toBeLessThan(0.05);
      expect(p.bearingToLandmarkDeg).toBeGreaterThan(279);
      expect(p.bearingToLandmarkDeg).toBeLessThan(281);
      expect(p.distanceToLandmarkM).toBeGreaterThan(6000);
      expect(p.distanceToLandmarkM).toBeLessThan(6300);
    }
  });

  it('is independent of the deck height, so the height decision cannot move a bearing', () => {
    const low = standingPoint(
      { id: 'x', lat: 52.5111010, lon: 13.4991829, surfaceOrthometric: 39.3, eyeHeightM: 1.6, needsSiteCheck: true, source: 'probe' },
      FERNSEHTURM,
    );
    const high = standingPoint(
      { id: 'x', lat: 52.5111010, lon: 13.4991829, surfaceOrthometric: 48.2, eyeHeightM: 1.6, needsSiteCheck: false, source: 'probe' },
      FERNSEHTURM,
    );
    expect(low.bearingToLandmarkDeg).toBe(high.bearingToLandmarkDeg);
    expect(low.distanceToLandmarkM).toBe(high.distanceToLandmarkM);
  });
});

describe('the accepted consequence of the chosen reading', () => {
  it('does NOT give all six points individual heights in 48.0-48.5 m', () => {
    // Criterion 1 as originally written is unsatisfiable with real DOM1 data: two
    // ramp nodes measure 46.9 and 47.0 m. The person chose "only replace the crest"
    // over fabricating heights. This test pins that truth so a future edit cannot
    // quietly raise a ramp value to make the old band pass.
    const inBand = points.filter(
      (p) => p.surfaceOrthometric >= 48.0 && p.surfaceOrthometric <= 48.5,
    );
    const individual = new Set(points.map((p) => p.surfaceOrthometric));
    expect(inBand.length).toBe(6); // all six remain in the band ...
    expect(individual.size).toBe(2); // ... but only two DISTINCT heights exist.
    expect(MEASURED['nord-knick']).toBeLessThan(48.0);
    expect(MEASURED['sued-west']).toBeLessThan(48.0);
  });
});
