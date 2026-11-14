import { describe, it, expect } from 'vitest';
import { LICHTENBERGER_BRUECKE } from '../../src/lib/vantages.js';
import { enumerateVantageWindows } from '../../src/lib/vantageWindows.js';
import { FERNSEHTURM } from '../../src/lib/landmarks.js';
import { sampleBody } from '../../src/lib/bodyPosition.js';
import type { CelestialBody } from '../../src/lib/vantageWindows.js';

/**
 * Golden tests against an INDEPENDENT ephemeris run (Meeus low-precision solar +
 * abridged lunar theory with parallax + Bennett refraction, run 2026-11-12; see
 * /tmp/astro_check/check.py from the verification session). Tolerances are days, not
 * minutes: suncalc and the reference differ by up to ~0.3 deg on the moon, which at
 * ~1 day per 0.6 deg of bearing is a couple of days of calendar shift.
 *
 * The canonical standing point: the Lichtenberger Bruecke, Rummelsburg side — the
 * app's curated default observer (52.5113, 13.4988, deck 48.2 m DHHN2016).
 */

const point = LICHTENBERGER_BRUECKE.points[0];

const bodyAt = (t: Date, body: CelestialBody) => sampleBody(body, t, point.lat, point.lon);

const scan = (year: number, fromMonth: number, toMonth: number, stepMinutes: number, bodies: CelestialBody[]) =>
  enumerateVantageWindows({
    point,
    landmark: FERNSEHTURM,
    bodyAt,
    bodies,
    start: new Date(Date.UTC(year, fromMonth, 1)),
    end: new Date(Date.UTC(year, toMonth, 1)),
    stepMinutes,
  });

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

describe('Lichtenberger Bruecke geometry', () => {
  it('standing points bear 279.4-280.2 deg to the Fernsehturm at ~6.1 km', () => {
    for (const p of LICHTENBERGER_BRUECKE.points) {
      expect(p.bearingToLandmarkDeg).toBeGreaterThan(279.4);
      expect(p.bearingToLandmarkDeg).toBeLessThan(280.2);
      expect(p.distanceToLandmarkM).toBeGreaterThan(5900);
      expect(p.distanceToLandmarkM).toBeLessThan(6350);
    }
  });

  it('the bridge curves: standing-point bearings span at least 0.15 deg', () => {
    const bearings = LICHTENBERGER_BRUECKE.points.map((p) => p.bearingToLandmarkDeg);
    const span = Math.max(...bearings) - Math.min(...bearings);
    // OSM centreline says ~0.41 deg across the whole bridge; the thinned point set
    // should retain most of it. If this drops below 0.15 the polyline has collapsed
    // and per-point calendars are pointless again.
    expect(span).toBeGreaterThan(0.15);
  });
});

describe('2027 sun calendar from the bridge', () => {
  // Reference: sun-disc-on-spire (280 deg line, spire top 3.29 deg): ~Apr 11 and ~Aug 31.
  // Horizon sunset exactly behind the tower (base band): ~Apr 4-5 and ~Sep 6-7.
  const windows = scan(2027, 0, 10, 5, ['sun']);
  const spire = windows.filter((w) => w.band === 'spire');

  it('finds the April spire window within Apr 8-14', () => {
    const hits = spire.filter((w) => {
      const d = dayOf(w.peak);
      return d >= '2027-04-08' && d <= '2027-04-14';
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('finds the late-August / early-September spire window within Aug 28 - Sep 3', () => {
    const hits = spire.filter((w) => {
      const d = dayOf(w.peak);
      return d >= '2027-08-28' && d <= '2027-09-03';
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('says NEVER in mid-May: no occultation at all between May 5 and May 25', () => {
    // In May the sun crosses the 280 deg line ~13 deg HIGH, far above the 3.29 deg
    // spire — the tool's honest "not from here, not then".
    const hits = windows.filter((w) => {
      const d = dayOf(w.peak);
      return d >= '2027-05-05' && d <= '2027-05-25';
    });
    expect(hits).toHaveLength(0);
  });

  it('finds the horizon sunset behind the tower around Apr 4-7 (fine scan)', () => {
    // The foot sits 15 m BELOW the bridge eye, so the horizon event crosses the LOWER
    // SHAFT, not the base band — and it is minutes-thin, so it needs a fine step and
    // the sub-horizon allowance (apparent refraction altitude).
    const hits = enumerateVantageWindows({
      point,
      landmark: FERNSEHTURM,
      bodyAt,
      bodies: ['sun'],
      start: new Date(Date.UTC(2027, 3, 1)),
      end: new Date(Date.UTC(2027, 3, 9)),
      stepMinutes: 2,
    }).filter((w) => {
      const d = dayOf(w.peak);
      return d >= '2027-04-02' && d <= '2027-04-07' && (w.band === 'shaft' || w.band === 'base');
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...hits.map((w) => w.coveredFraction))).toBeGreaterThan(0.1);
  });
});

describe('2027 moon calendar from the bridge', () => {
  /**
   * Reference ephemeris (Meeus, parallax-corrected) gives FOUR moon-disc-on-spire
   * events for 2027; on this far (280 deg) line: Jan 14 22:34 UTC and Sep 27 15:14 UTC,
   * plus Apr 8 18:48 UTC on the close (287 deg) line. Suncalc's lunar theory resolves
   * the April one (found: Apr 6, ~2 d early, inside its ~0.3 deg error budget) but
   * NOT the two far-line events — their windows are narrower than suncalc's moon
   * accuracy. HONEST LIMIT: moon-spire planning from this bridge needs a better lunar
   * theory before it can promise Jan/Sep dates. Tracked as follow-up; the test pins
   * only what suncalc can actually deliver.
   */
  const windows = scan(2027, 0, 12, 10, ['moon']).filter((w) => w.band === 'spire');

  it('finds a spire window within +-7 days of the Apr 8 2027 reference event', () => {
    const hits = windows.filter((w) => {
      const d = dayOf(w.peak);
      return d >= '2027-04-01' && d <= '2027-04-15';
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('and the moon also offers the forgiving shaft-band shots (>= 2 per year)', () => {
    const shaft = scan(2027, 0, 12, 10, ['moon']).filter((w) => w.band === 'shaft');
    expect(shaft.length).toBeGreaterThanOrEqual(2);
  });
});
