/**
 * Named vantages — pure data + pure geometry, NO Cesium (Constitution Principle I).
 *
 * WHY THIS EXISTS
 * ---------------
 * The founding use case: "sunset or moon behind the Fernsehturm from MY bridge, predicted
 * precisely." The area solver answers "where do I stand?"; findOccultationsAtPosition
 * answers "when, from this exact spot?" — but both take an ad-hoc observer. A photographer
 * has a PLACE: a curved bridge whose standing points differ. Over the Lichtenberger
 * Bruecke's ~150 m the bearing to the tower sweeps 279.6 deg to 280.4 deg, and the
 * alignment calendar shifts about a day per 0.6 deg of bearing — so each standing point
 * deserves its own entry, not one averaged "the bridge".
 *
 * WHERE THE DATA COMES FROM
 * -------------------------
 * Polyline: OSM way 1335772137 (two carriageway arms, fetched 2026-11-12). Deck
 * elevation: Berlin DOM1 (1 m surface model, sheet dom1_33_398_5818_2, EPSG:25833,
 * DHHN2016), sampled per node on 2026-11-12. Only crest nodes whose measured median
 * falls inside the curated mid-span envelope 48.1-48.3 m adopt their own value. The
 * ramp/flank nodes measure 46.9-47.8 m — the real ramp profile (scripts/README.md:
 * west ramp 46.1 m, east ramp 46.7 m), but not a confirmed deck height for the
 * curated band, so they keep the curated 48.2 m with needsSiteCheck until surveyed.
 * Every measurement is kept in the point's `source`; none is raised to fit a band.
 * Bearings and distances are COMPUTED here from coordinates (ellipsoidal ECEF ->
 * ENU), never hand-entered.
 *
 * DATUM TRAP: public/heightmap/berlin-dgm1.bin is DGM1 = bare earth. Under this deck
 * it returns the rail cutting (~39-41 m), not the deck. Deck surface needs DOM1.
 */
import { geodeticToECEF, ecefToENU } from './silhouette.js';
import type { LatLon } from './areaSolver.js';

export interface StandingPoint extends LatLon {
  id: string;
  /** Deck/platform surface at this point, DHHN2016 orthometric metres. */
  surfaceOrthometric: number;
  /** Photographer's eye above the surface, metres. */
  eyeHeightM: number;
  /** True when nobody has confirmed the surface value at THIS point of the bridge. */
  needsSiteCheck: boolean;
  /**
   * Provenance of the surface value: dataset, fetch date, CRS/vertical datum, sampling
   * method and the measured median — including the median REJECTED for the height
   * field, so the evidence survives without asserting an unconfirmed height.
   */
  source: string;
  /** Initial bearing from this point to the landmark, degrees true. Computed, not stored. */
  readonly bearingToLandmarkDeg: number;
  /** Great-circle ground distance to the landmark, metres. Computed. */
  readonly distanceToLandmarkM: number;
}

export interface Vantage {
  id: string;
  name: string;
  /** landmarks.ts id of the aligned structure. */
  landmarkId: string;
  points: StandingPoint[];
  notes: string;
}

/**
 * Initial bearing (degrees true) and ground distance (metres) between two geodetic
 * positions, via the repo's standard ECEF -> ENU path — the same convention the
 * silhouette builder uses, so solver targets and these bearings cannot drift apart.
 */
export function bearingDistanceTo(from: LatLon, to: LatLon): {
  bearingDeg: number;
  distanceM: number;
} {
  // Eye heights differ by metres; the bearing impact is <0.001 deg, so compare
  // surface-level positions (h=0 on both ends).
  const a = geodeticToECEF(from.lat, from.lon, 0);
  const b = geodeticToECEF(to.lat, to.lon, 0);
  const d: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const enu = ecefToENU(d, from.lat, from.lon);
  const bearingDeg = (Math.atan2(enu[0], enu[1]) * 180) / Math.PI;
  return {
    bearingDeg: (bearingDeg + 360) % 360,
    distanceM: Math.hypot(enu[0], enu[1]),
  };
}

/** Build a standing point, computing bearing/distance to the landmark from coordinates. */
export function standingPoint(
  base: Omit<
    StandingPoint,
    'bearingToLandmarkDeg' | 'distanceToLandmarkM'
  >,
  landmark: LatLon,
): StandingPoint {
  const { bearingDeg, distanceM } = bearingDistanceTo(base, landmark);
  return Object.freeze({
    ...base,
    bearingToLandmarkDeg: bearingDeg,
    distanceToLandmarkM: distanceM,
  });
}

const FERNSEHTURM_POS: LatLon = { lat: 52.520815, lon: 13.409419 };

/** Eye height of a standing photographer, metres. */
export const EYE_HEIGHT_M = 1.6;

const OSM_BRIDGE_SOURCE =
  'Polyline OSM way 1335772137 (fetched 2026-11-12). Deck heights per node from Berlin ' +
  'DOM1 (sheet dom1_33_398_5818_2, EPSG:25833, DHHN2016), sampled 2026-11-12: only the ' +
  'crest nodes inside the curated 48.1-48.3 m mid-span envelope adopt their measured ' +
  'median; the ramp/flank nodes keep the curated 48.2 m with needsSiteCheck until ' +
  'surveyed. Each point carries its own source, including the rejected measurement.';

/** The curated mid-span deck record (src/lib/viewpoints.ts), metres DHHN2016. */
const CURATED_MIDSPAN_M = 48.2;

/**
 * The curated mid-span crest envelope, metres DHHN2016 (p05-p95 of the DOM1 crest,
 * src/lib/viewpoints.ts). DOM1 is trusted for the deck ONLY inside this band: a node
 * measuring within it is on the confirmed crest, a node below it is on the ramp, where
 * the surface model does not establish a deck height for this bridge.
 */
export const CURATED_CREST_ENVELOPE_M: readonly [number, number] = [48.1, 48.3];

/** Dataset provenance shared by every point; the per-node measurement is appended. */
const DOM1_DATASET_SOURCE =
  'Deck surface from Berlin DOM1 (1 m digital surface model), sheet dom1_33_398_5818_2 ' +
  '(DOM1_398_5818.zip, member dom1_33_398_5818_2_be.txt), ' +
  'https://gdi.berlin.de/data/dom/atom/, fetched 2026-11-12; EPSG:25833 (ETRS89/UTM33N), ' +
  'heights DHHN2016 orthometric, licence dl-de/zero-2-0. Method: median of the 1 m ' +
  'postings on the deck plateau around this OSM node; three independent samplings ' +
  'agreed within 0.1 m. NOT DGM1 (bare earth), which returns the rail cutting (~39-41 m) ' +
  'under this deck.';

/**
 * Build the standing points of one carriageway arm from its OSM shape nodes and the
 * DOM1 median measured at each node.
 *
 * The adoption rule is the decision, not a hand-typed table: a median inside the
 * curated crest envelope becomes the point's deck height and clears needsSiteCheck;
 * anything outside it is ramp profile, so the point keeps the curated mid-span value
 * and still needs a site survey. The rejected measurement is recorded either way —
 * no value is ever raised to fit the band.
 */
function pts(list: Array<[id: string, lat: number, lon: number, dom1MedianM: number]>): StandingPoint[] {
  const [lo, hi] = CURATED_CREST_ENVELOPE_M;
  return list.map(([id, lat, lon, dom1MedianM]) => {
    const onCrest = dom1MedianM >= lo && dom1MedianM <= hi;
    const measured = dom1MedianM.toFixed(1);
    const source = onCrest
      ? `${DOM1_DATASET_SOURCE} Measured median ${measured} m lies inside the curated ` +
        `mid-span envelope ${lo}-${hi} m, so it is adopted as the deck height and ` +
        'needsSiteCheck is false.'
      : `${DOM1_DATASET_SOURCE} Measured median ${measured} m lies outside the curated ` +
        `mid-span envelope ${lo}-${hi} m — the expected ramp profile (scripts/README.md: ` +
        'west ramp 46.1 m, east ramp 46.7 m) — so it is NOT adopted: this point keeps ' +
        `the curated mid-span ${CURATED_MIDSPAN_M.toFixed(1)} m and needsSiteCheck stays ` +
        'true until surveyed on site.';
    return standingPoint(
      {
        id,
        lat,
        lon,
        surfaceOrthometric: onCrest ? dom1MedianM : CURATED_MIDSPAN_M,
        eyeHeightM: EYE_HEIGHT_M,
        needsSiteCheck: !onCrest,
        source,
      },
      FERNSEHTURM_POS,
    );
  });
}

/**
 * The Lichtenberger Bruecke as a set of standing points, west arm -> east arm.
 *
 * The bridge curves: bearings run 279.63-280.04 deg, i.e. +-0.2 deg of standing-point
 * choice — about +-0.35 days of alignment-calendar shift, and the alignment windows
 * themselves are only 1-2 days wide, so the choice of railing is within the noise but
 * the choice of BRIDGE END is not. Points are the OSM shape nodes, thinned to
 * representative positions.
 */
export const LICHTENBERGER_BRUECKE: Vantage = {
  id: 'lichtenberger-bruecke',
  name: 'Lichtenberger Brücke',
  landmarkId: 'fernsehturm',
  points: [
    // Fourth column: DOM1 plateau median measured at that node, metres DHHN2016.
    ...pts([
      ['nord-west', 52.5115685, 13.4983761, 47.8],
      ['nord-mitte', 52.5115358, 13.4982790, 47.7],
      ['nord-knick', 52.5112931, 13.4975595, 46.9],
    ]),
    ...pts([
      ['sued-west', 52.5112551, 13.4975327, 47.0],
      ['sued-mitte', 52.5111010, 13.4991829, 48.2],
      ['sued-ost', 52.5110579, 13.4996359, 48.1],
    ]),
  ],
  notes: OSM_BRIDGE_SOURCE,
};
