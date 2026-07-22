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

export const VIEWPOINTS: readonly Viewpoint[] = [LICHTENBERGER_BRUECKE];

/** Look up a curated viewpoint by id. */
export function findViewpoint(id: string): Viewpoint | undefined {
  return VIEWPOINTS.find((v) => v.id === id);
}
