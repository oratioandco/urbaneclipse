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
 * elevation: sampled per point from Berlin DOM1 (1 m surface model, sheet
 * DOM1_398_5818, 2021 acquisition, DHHN2016), modal cluster of the postings in a
 * 2-3 m box around each point — the same DOM1/DGM1 workflow that produced the
 * curated viewpoint record (src/lib/viewpoints.ts) and the ramp figures in
 * scripts/README.md (deck crest mid-span 48.1-48.3 m, west/east ramp 46.1/46.7 m,
 * rail level beneath 39.3 m). The bridge is NOT flat: it rises from the west ramp
 * (Knick points, ~46.9-47.0 m) toward the span over the rail corridor
 * (sued-mitte/sued-ost, 48.1 m). Points whose DOM1 reading departs from the curated
 * mid-span envelope by more than the DOM1 error bar (+/-0.3 m) keep
 * needsSiteCheck: true; the value is still the sampled one, but a site check is
 * warranted where the deck interpretation is not corroborated by the curated band.
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
  /** Where this point's surface value came from. */
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
  'Polyline OSM way 1335772137 (fetched 2026-11-12). Deck per point from Berlin DOM1 ' +
  '(1 m surface model, sheet DOM1_398_5818, 2021, DHHN2016), modal cluster of postings ' +
  'in a 2-3 m box; cross-checked against DGM1 rail level 39.2-39.3 m beneath and the ' +
  'curated viewpoint record (mid-span crest 48.1-48.3 m, ramps 46.1/46.7 m). Sampled ' +
  '2026-11-12; needsSiteCheck holds where the reading departs from the curated ' +
  'mid-span envelope by more than the DOM1 error bar.';

/** Deck heights sampled per point from DOM1 (DHHN2016 m), with per-point provenance. */
function pts(
  list: Array<[id: string, lat: number, lon: number, surface: number, siteCheck: boolean]>,
): StandingPoint[] {
  return list.map(([id, lat, lon, surface, siteCheck]) =>
    standingPoint(
      {
        id,
        lat,
        lon,
        surfaceOrthometric: surface,
        eyeHeightM: EYE_HEIGHT_M,
        needsSiteCheck: siteCheck,
        source:
          `DOM1 sheet 398_5818 (2021), modal cluster in a 2-3 m box at ${lat}, ${lon}: ` +
          `${surface.toFixed(1)} m DHHN2016 (sampled 2026-11-12)`,
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
 *
 * Deck heights are NOT flat: the deck climbs from the west ramp (nord-knick 46.9,
 * sued-west 47.0) to the span over the rail corridor (48.1), then eases toward the
 * east abutment (nord-west 47.8). nord-mitte reads 47.7 — 0.5 m under the curated
 * mid-span crest, plausibly the carriageway on the western flank of the arch; it and
 * the two ramp points keep needsSiteCheck.
 */
export const LICHTENBERGER_BRUECKE: Vantage = {
  id: 'lichtenberger-bruecke',
  name: 'Lichtenberger Brücke',
  landmarkId: 'fernsehturm',
  points: pts([
    ['nord-west', 52.5115685, 13.4983761, 47.8, false],
    ['nord-mitte', 52.5115358, 13.4982790, 47.7, true],
    ['nord-knick', 52.5112931, 13.4975595, 46.9, true],
    ['sued-west', 52.5112551, 13.4975327, 47.0, true],
    ['sued-mitte', 52.5111010, 13.4991829, 48.1, false],
    ['sued-ost', 52.5110579, 13.4996359, 48.1, false],
  ]),
  notes: OSM_BRIDGE_SOURCE,
};
