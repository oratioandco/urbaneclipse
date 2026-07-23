/**
 * Curated camera viewpoints — pure data, NO Cesium.
 *
 * WHY A CURATED TABLE EXISTS ALONGSIDE THE TERRAIN MODEL
 * ------------------------------------------------------
 * The DGM1 heightmap is a *terrain* model, so it returns the bare ground. For any
 * viewpoint on a built structure — a bridge deck, a rooftop, a viewing platform —
 * that is the wrong surface, sometimes badly:
 *
 *   Lichtenberger Bruecke: deck ~48.2 m DHHN2016, rail cutting beneath ~39.3 m.
 *   Standing on the bridge, DGM1 would place the photographer 8.8 m too low.
 *
 * Entries with `surfaceOrthometric` override the terrain sample via
 * resolveEyeEllipsoidalHeight (src/lib/elevation.ts). Entries without one fall back
 * to the heightmap, which is correct for ordinary ground-level spots.
 *
 * Every entry records its provenance and error bar, because these numbers feed
 * directly into sub-0.05-degree alignment claims and must not look more authoritative
 * than they are.
 */

export type ViewpointKind = 'bridge' | 'ground' | 'rooftop' | 'platform';

export interface Viewpoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: ViewpointKind;
  /**
   * Elevation of the surface actually stood on, DHHN2016 orthometric metres.
   * Omitted where the terrain model is the right answer.
   */
  surfaceOrthometric?: number;
  /** Metres of uncertainty on `surfaceOrthometric`. */
  surfaceUncertaintyM?: number;
  /** Where the elevation came from. */
  source: string;
}

/**
 * Lichtenberger Bruecke, Berlin.
 *
 * COORDINATE CORRECTION: the previous default of (52.5106, 13.4652) is NOT this
 * bridge. It is a street-level point in the Boxhagener Kiez, Friedrichshain, roughly
 * 2.3 km west — OpenStreetMap has no bridge within 250 m of it, and DGM1 (terrain) and
 * DOM1 (surface) both read 36.3 m there, i.e. nothing elevated exists at that spot.
 *
 * No surveyed deck elevation is published (the EBA Planfeststellung notices for the
 * Ersatzneubau give no gradient), so the deck height is derived from Berlin's official
 * 1 m DOM1 surface model: crest 48.1-48.3 m mid-span (p05-p95 spread only 0.4 m), with
 * the rail level beneath at 39.3 m from DGM1.
 */
export const LICHTENBERGER_BRUECKE: Viewpoint = {
  id: 'lichtenberger-bruecke',
  name: 'Lichtenberger Brücke',
  lat: 52.5113,
  lon: 13.4988,
  kind: 'bridge',
  surfaceOrthometric: 48.2,
  surfaceUncertaintyM: 0.3,
  source:
    'Deck crest derived from Berlin DOM1 (1 m surface model), mid-span p05-p95 ' +
    '48.1-48.3 m DHHN2016; rail level beneath 39.3 m from DGM1. No surveyed value is ' +
    'published. Coordinate corrected from (52.5106, 13.4652), which is not the bridge.',
};

/**
 * Karl-Marx-Allee at Strausberger Platz. A grand, wide boulevard plaza with an
 * unobstructed corridor sightline WNW to the Fernsehturm ~1.3 km away — verified clear
 * against the LoD2 geometry by ray-casting. This is the SHOWCASE default: a clean shot
 * of the tower, unlike the Lichtenberger Brücke, whose low sightline is blocked by
 * intervening buildings at a sun transit.
 *
 * Street-level, so no surface override — the DGM1 terrain gives the ground elevation.
 */
export const STRAUSBERGER_PLATZ: Viewpoint = {
  id: 'strausberger-platz',
  name: 'Strausberger Platz',
  lat: 52.5182,
  lon: 13.4285,
  kind: 'ground',
  source: 'Karl-Marx-Allee boulevard plaza; clean corridor sightline to the tower.',
};

/** Weberwiese, further down Karl-Marx-Allee (~1.9 km). Also a clear corridor view. */
export const WEBERWIESE: Viewpoint = {
  id: 'weberwiese',
  name: 'Weberwiese',
  lat: 52.517,
  lon: 13.436,
  kind: 'ground',
  source: 'Karl-Marx-Allee; clean corridor sightline to the tower.',
};

/** Alexanderplatz east side (~0.5 km) — the tower looms large. Clear sightline. */
export const ALEXANDERPLATZ: Viewpoint = {
  id: 'alexanderplatz',
  name: 'Alexanderplatz',
  lat: 52.5205,
  lon: 13.416,
  kind: 'ground',
  source: 'Alexanderplatz; close, unobstructed view of the tower.',
};

export const VIEWPOINTS: readonly Viewpoint[] = [
  STRAUSBERGER_PLATZ,
  WEBERWIESE,
  ALEXANDERPLATZ,
  LICHTENBERGER_BRUECKE,
];

/** The showcase default: a clean, corridor sightline to the tower. */
export const DEFAULT_VIEWPOINT = STRAUSBERGER_PLATZ;

/** Look up a curated viewpoint by id. */
export function findViewpoint(id: string): Viewpoint | undefined {
  return VIEWPOINTS.find((v) => v.id === id);
}
