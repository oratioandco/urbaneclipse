import proj4 from 'proj4';

/**
 * Pure CRS transforms for the Berlin LoD2 pipeline. NO Cesium.
 *
 * Berlin's LoD2 distribution CRS is EPSG:25833 (ETRS89 / UTM zone 33N), confirmed from the
 * GDI ATOM feed (gdi.berlin.de/data/a_lod2/atom) and the tile filenames (LoD2_33_*). Verified
 * via round-trip.
 * EPSG:31468 (historical DHDN / Gauss-Kruger zone 4) is VERIFY-LIVE: its +towgs84 datum
 * parameters must be confirmed against an authoritative PROJ reference before use, so the
 * datum-shift path is intentionally not registered here yet (see research.md VERIFY-LIVE).
 */
proj4.defs(
  'EPSG:25832',
  '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);
proj4.defs(
  'EPSG:25833',
  '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);

export type Vec3 = [number, number, number];

/** Transform an [x, y, z] coordinate between two CRSes. EPSG:4326 expects [lon, lat].
 *  The vertical z passes through unchanged (horizontal CRS transform only). */
export function transformCoord(from: string, to: string, coord: Vec3): Vec3 {
  const [x, y, z] = coord;
  const [outX, outY] = proj4(from, to, [x, y]) as [number, number];
  return [outX, outY, z];
}
