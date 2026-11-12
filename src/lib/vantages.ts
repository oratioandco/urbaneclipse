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
 * elevation: the curated viewpoint record (src/lib/viewpoints.ts) — DOM1 crest
 * 48.1-48.3 m DHHN2016 mid-span; per-node DOM1 sampling is follow-up work, so all
 * points carry the mid-span value and needsSiteCheck until surveyed. Bearings and
 * distances are COMPUTED here from coordinates (ellipsoidal ECEF -> ENU), never
 * hand-entered.
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
  'Polyline OSM way 1335772137 (fetched 2026-11-12). Deck from the curated viewpoint ' +
  'record (DOM1 crest 48.1-48.3 m mid-span); per-node DOM1 sampling pending, so ' +
  'needsSiteCheck holds until surveyed.';

/** West end of the northern carriageway arm. */
function pts(list: Array<[id: string, lat: number, lon: number]>, siteCheck: boolean): StandingPoint[] {
  return list.map(([id, lat, lon]) =>
    standingPoint(
      {
        id,
        lat,
        lon,
        surfaceOrthometric: 48.2,
        eyeHeightM: EYE_HEIGHT_M,
        needsSiteCheck: siteCheck,
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
 * representative positions.
 */
export const LICHTENBERGER_BRUECKE: Vantage = {
  id: 'lichtenberger-bruecke',
  name: 'Lichtenberger Brücke',
  landmarkId: 'fernsehturm',
  points: [
    ...pts(
      [
        ['nord-west', 52.5115685, 13.4983761],
        ['nord-mitte', 52.5115358, 13.4982790],
        ['nord-knick', 52.5112931, 13.4975595],
      ],
      true,
    ),
    ...pts(
      [
        ['sued-west', 52.5112551, 13.4975327],
        ['sued-mitte', 52.5111010, 13.4991829],
        ['sued-ost', 52.5110579, 13.4996359],
      ],
      true,
    ),
  ],
  notes: OSM_BRIDGE_SOURCE,
};
