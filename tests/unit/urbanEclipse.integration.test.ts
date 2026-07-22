/**
 * End-to-end urban-eclipse integration: REAL suncalc ephemeris against the REAL
 * parametric Fernsehturm, from the REAL Lichtenberger Brücke deck.
 *
 * Every other test injects a synthetic body or a flat ground so it can assert exact
 * numbers. This one wires the actual pieces together, because the product claim is a
 * conjunction — correct ephemeris AND correct datum AND correct silhouette AND correct
 * classification — and each has been individually wrong at some point in this project.
 */
import { describe, it, expect } from 'vitest';
import { sampleBody, sunDistanceKm } from '../../src/lib/bodyPosition.js';
import { findOccultationsAtPosition, feasibility } from '../../src/lib/areaSolver.js';
import { FERNSEHTURM } from '../../src/lib/landmarks.js';
import { LICHTENBERGER_BRUECKE } from '../../src/lib/viewpoints.js';
import { resolveObserverHeight } from '../../src/lib/sceneHeights.js';
import { azAltTo, type ObserverGeodetic } from '../../src/lib/silhouette.js';
import { MOON_RADIUS_KM, SUN_RADIUS_KM } from '../../src/lib/occultation.js';

/** The photographer, standing on the surveyed bridge deck. */
const resolved = resolveObserverHeight(
  LICHTENBERGER_BRUECKE.lat,
  LICHTENBERGER_BRUECKE.lon,
  1.5,
  () => undefined, // no heightmap in unit tests; the viewpoint deck wins anyway
  LICHTENBERGER_BRUECKE,
);

const OBSERVER: ObserverGeodetic = {
  lat: LICHTENBERGER_BRUECKE.lat,
  lon: LICHTENBERGER_BRUECKE.lon,
  ellipsoidalHeight: resolved.ellipsoidalHeight,
};

describe('sunDistanceKm', () => {
  it('varies between perihelion and aphelion by ~3.3%', () => {
    // Perihelion ~3 Jan (~147.1 Mkm), aphelion ~4 Jul (~152.1 Mkm).
    const perihelion = sunDistanceKm(new Date(Date.UTC(2026, 0, 3)));
    const aphelion = sunDistanceKm(new Date(Date.UTC(2026, 6, 4)));
    expect(perihelion).toBeGreaterThan(147.0e6);
    expect(perihelion).toBeLessThan(147.4e6);
    expect(aphelion).toBeGreaterThan(151.9e6);
    expect(aphelion).toBeLessThan(152.3e6);
    expect(aphelion).toBeGreaterThan(perihelion);
  });
});

describe('sampleBody against real suncalc', () => {
  it('puts the summer midday sun high and south over Berlin', () => {
    const s = sampleBody('sun', new Date(Date.UTC(2026, 5, 21, 11, 0)), 52.51, 13.4);
    expect(s.alt).toBeGreaterThan(55); // ~61 deg at solstice
    expect(s.az).toBeGreaterThan(150);
    expect(s.az).toBeLessThan(210); // south
    expect(s.radiusKm).toBe(SUN_RADIUS_KM);
  });

  it('reports a moon distance in the real perigee-apogee band', () => {
    const m = sampleBody('moon', new Date(Date.UTC(2026, 5, 21, 22, 0)), 52.51, 13.4);
    expect(m.distanceKm).toBeGreaterThan(350_000);
    expect(m.distanceKm).toBeLessThan(410_000);
    expect(m.radiusKm).toBe(MOON_RADIUS_KM);
  });
});

describe('the tower as actually seen from the bridge', () => {
  it('sits low and roughly west, ~6.1 km away', () => {
    const sphere = azAltTo(
      OBSERVER,
      FERNSEHTURM.lat,
      FERNSEHTURM.lon,
      // base 34.6 DHHN + 39.5 geoid + sphere centre 213 m
      34.6 + 39.5 + 213,
    );
    expect(sphere.rangeM).toBeGreaterThan(6000);
    expect(sphere.rangeM).toBeLessThan(6300);
    expect(sphere.az).toBeGreaterThan(275);
    expect(sphere.az).toBeLessThan(285);
    // The sphere is only ~1.5 deg up from here — these are low-sun/low-moon shots.
    expect(sphere.alt).toBeGreaterThan(0.5);
    expect(sphere.alt).toBeLessThan(3);
  });
});

describe('feasibility from the bridge — the headline planning answer', () => {
  it('rules out a FULL occultation for both sun and moon', () => {
    const range = azAltTo(OBSERVER, FERNSEHTURM.lat, FERNSEHTURM.lon, 34.6 + 39.5 + 213).rangeM;

    const moon = feasibility(
      FERNSEHTURM,
      { distanceKm: 384400, radiusKm: MOON_RADIUS_KM },
      range,
    );
    const sun = feasibility(FERNSEHTURM, { distanceKm: 149.6e6, radiusKm: SUN_RADIUS_KM }, range);

    expect(moon.fullPossible).toBe(false);
    expect(sun.fullPossible).toBe(false);

    // The tower is markedly narrower than either disc from here.
    expect(moon.landmarkWidthDeg).toBeLessThan(0.32);
    expect(moon.landmarkWidthDeg).toBeGreaterThan(0.27);

    // And it tells you how much closer you would have to get.
    expect(moon.maxRangeForFullM).toBeGreaterThan(3400);
    expect(moon.maxRangeForFullM).toBeLessThan(3700);
  });
});

describe('findOccultationsAtPosition over a real window', () => {
  // THE WINDOW MATTERS, and discovering why was a genuine product finding.
  //
  // From this bridge the tower's tip is only ~3.2 deg above the horizon, and the tower
  // bears ~280 deg. So a sun transit requires the sun to be at azimuth ~280 deg while BELOW
  // ~3.2 deg altitude — which only happens near the equinoxes. Measured minimum solar
  // altitude at az 280 deg through 2026: June 20.4 deg, August 4.6 deg (still too high),
  // September 11th -1.7 deg. A 30-day August window therefore yields ZERO transits, not
  // because the geometry is broken but because the shot is seasonally impossible then.
  //
  // The real windows in 2026 are 4-11 April and 31 August-7 September: a twice-yearly
  // event, the same phenomenon as Manhattanhenge.
  const start = new Date(Date.UTC(2026, 7, 25, 0, 0));
  const end = new Date(Date.UTC(2026, 8, 15, 0, 0));

  it('finds real sun transits behind the tower, and none are full', () => {
    const hits = findOccultationsAtPosition({
      observer: OBSERVER,
      landmark: FERNSEHTURM,
      start,
      end,
      stepMinutes: 2,
      bodyAt: (t) => sampleBody('sun', t, OBSERVER.lat, OBSERVER.lon),
      wanted: ['full', 'partial'],
    });

    // The sun sets in the west-north-west in August, passing behind the tower from
    // this bridge — so there MUST be transits. A zero result would mean the geometry
    // chain is broken somewhere.
    expect(hits.length).toBeGreaterThan(0);

    // But never a full cover: the tower is narrower than the sun from 6.1 km.
    for (const h of hits) expect(h.kind).toBe('partial');
    expect(Math.max(...hits.map((h) => h.coveredFraction))).toBeLessThan(0.75);
    // Measured best in this window is ~33% (7 Sep), consistent with a 0.298 deg tower
    // against a 0.533 deg sun.
    expect(Math.max(...hits.map((h) => h.coveredFraction))).toBeGreaterThan(0.2);

    // Every hit must be above the horizon and roughly toward the tower.
    for (const h of hits) {
      expect(h.bodyAlt).toBeGreaterThan(0);
      expect(h.bodyAz).toBeGreaterThan(265);
      expect(h.bodyAz).toBeLessThan(295);
    }
  });

  it('ranks the best-covered transit first', () => {
    const hits = findOccultationsAtPosition({
      observer: OBSERVER,
      landmark: FERNSEHTURM,
      start,
      end,
      stepMinutes: 2,
      bodyAt: (t) => sampleBody('sun', t, OBSERVER.lat, OBSERVER.lon),
    });
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].coveredFraction).toBeGreaterThanOrEqual(hits[i].coveredFraction - 1e-9);
    }
  });

  it('finds adjacent framings too — the crescent-beside-the-spire shot', () => {
    const hits = findOccultationsAtPosition({
      observer: OBSERVER,
      landmark: FERNSEHTURM,
      start,
      end,
      stepMinutes: 5,
      bodyAt: (t) => sampleBody('moon', t, OBSERVER.lat, OBSERVER.lon),
      wanted: ['adjacent'],
      limit: 50,
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.kind).toBe('adjacent');
      expect(h.coveredFraction).toBe(0);
      expect(h.separationDeg).toBeGreaterThan(0);
    }
  });

  it('never returns a body below the horizon', () => {
    const hits = findOccultationsAtPosition({
      observer: OBSERVER,
      landmark: FERNSEHTURM,
      start,
      end,
      stepMinutes: 5,
      bodyAt: (t) => sampleBody('moon', t, OBSERVER.lat, OBSERVER.lon),
      wanted: ['full', 'partial', 'adjacent', 'clear'],
      limit: 500,
    });
    for (const h of hits) expect(h.bodyAlt).toBeGreaterThan(0);
  });
});
