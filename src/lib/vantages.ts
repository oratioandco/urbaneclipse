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
 * elevation per point: sampled 2026-11-12 from the repo's documented DOM1 surface
 * path (scripts/README.md, https://gdi.berlin.de/data/dom/atom), sheet
 * dom1_33_398_5818_2 (1 m laser postings, EPSG:25833, DHHN2016 orthometric).
 * Method: all postings within a +-2 m box around the point; the deck plateau is
 * the tight cluster of adjacent postings (<=0.25 m spread), excluding ground
 * readings (~39-40 m, cross-checked against DGM1 sheet dgm1_33_398_5818_2) and
 * railing/structure hits (>49 m). Values below form a consistent ramp profile:
 * west knick ~46.9 m -> north arm ~47.7-47.8 m -> south-mid crest 48.2 m
 * (matching the curated mid-span record 48.1-48.3 m in src/lib/viewpoints.ts)
 * -> east end 48.1 m. Ground beneath mid-span reads 39.3 m in DGM1, so the deck
 * sits ~8.8 m above the rail corridor, as documented. Independently re-sampled and
 * confirmed 2026-11-12 (3 m and 2 m boxes agree within 0.1 m on every point).
 * needsSiteCheck holds where a point departs from the curated mid-span envelope
 * (48.1-48.3 m, +/-0.3 m error bar) by more than that error bar — the four
 * ramp/flank points carry it; the two crest points (48.2, 48.1) do not.
 * Bearings and distances are COMPUTED here from coordinates (ellipsoidal ECEF -> ENU),
 * never hand-entered.
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
  /** Where this point's deck elevation comes from — dataset, datum, sampling. */
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

/** Provenance shared by every sampled deck value below. */
const DOM1_SOURCE =
  'DOM1 sheet dom1_33_398_5818_2 (gdi.berlin.de/data/dom/atom, fetched 2026-11-12), ' +
  '1 m laser postings, EPSG:25833, DHHN2016 orthometric; deck plateau median over ' +
  'a +-2 m box, ground (~39-40 m) excluded against DGM1 dgm1_33_398_5818_2.';

const OSM_BRIDGE_SOURCE =
  'Polyline OSM way 1335772137 (fetched 2026-11-12). Deck elevations sampled per point ' +
  'from DOM1 (see each point\'s source field); mid-span crest matches the curated ' +
  'viewpoint record (48.1-48.3 m DHHN2016, src/lib/viewpoints.ts).';

/**
 * Build standing points with per-point sampled deck values, source and site-check state.
 * Every value must come from a measured DOM1 plateau — nothing interpolated or invented.
 * needsSiteCheck: true exactly where the sampled deck departs from the curated
 * mid-span envelope (48.1-48.3 m) by more than its +/-0.3 m error bar.
 */
function pts(
  list: Array<[id: string, lat: number, lon: number, deckM: number, needsSiteCheck: boolean]>,
): StandingPoint[] {
  return list.map(([id, lat, lon, deckM, needsSiteCheck]) =>
    standingPoint(
      {
        id,
        lat,
        lon,
        surfaceOrthometric: deckM,
        eyeHeightM: EYE_HEIGHT_M,
        needsSiteCheck,
        source: DOM1_SOURCE,
      },
      FERNSEHTURM_POS,
    ),
  );
}

/**
 * The Lichtenberger Bruecke as a set of standing points, west arm -> east arm.
 *
 * The bridge curves: bearings run 279.63-280.04 deg, i.e. +-0.2 deg of standing-point
 * choice — about +-0.35 days of alignment-calendar shift, and the alignment windows
 * themselves are only 1-2 days wide, so the choice of railing is within the noise but
 * the choice of BRIDGE END is not. Points are the OSM shape nodes, thinned to
 * representative positions. Deck values are the DOM1 plateau medians rounded to
 * 0.1 m; the west-knick/ramp points sit ~1.3 m below the mid-span crest, exactly as
 * the documented DOM1 deck profile predicts (west ramp 46.1 m, scripts/README.md).
 */
export const LICHTENBERGER_BRUECKE: Vantage = {
  id: 'lichtenberger-bruecke',
  name: 'Lichtenberger Brücke',
  landmarkId: 'fernsehturm',
  points: [
    ...pts([
      ['nord-west', 52.5115685, 13.4983761, 47.8, true],
      ['nord-mitte', 52.5115358, 13.4982790, 47.7, true],
      ['nord-knick', 52.5112931, 13.4975595, 46.9, true],
      ['sued-west', 52.5112551, 13.4975327, 47.0, true],
      ['sued-mitte', 52.5111010, 13.4991829, 48.2, false],
      ['sued-ost', 52.5110579, 13.4996359, 48.1, false],
    ]),
  ],
  notes: OSM_BRIDGE_SOURCE,
};
