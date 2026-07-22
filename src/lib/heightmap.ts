/**
 * Runtime sampler for the Berlin DGM1 ground-elevation grid. Pure math, NO Cesium,
 * no fetch — the caller supplies the already-decoded header and samples, so this is
 * fully testable in Node and reusable from a worker.
 *
 * The grid is produced by scripts/build_heightmap.py from Berlin's official 1 m DGM1
 * terrain model. Samples are ORTHOMETRIC (DHHN2016 normal heights) — the geoid
 * undulation is deliberately NOT baked in, so exactly one place applies it
 * (src/lib/elevation.ts) and it can never be double-counted.
 *
 * IMPORTANT: DGM1 is a TERRAIN model — bare earth. On a bridge, rooftop or viewing
 * platform it returns the ground BENEATH the structure. For the Lichtenberger Brücke
 * that is the rail cutting, 8.8 m below the deck. Curated overrides live in
 * src/lib/viewpoints.ts and take precedence; see resolveEyeEllipsoidalHeight.
 */

export interface HeightmapHeader {
  format: string;
  version: number;
  dtype: string;
  scale: number;
  offset: number;
  nodata: number;
  width: number;
  height: number;
  bbox: { lonMin: number; latMin: number; lonMax: number; latMax: number };
  dLon: number;
  dLat: number;
}

export interface Heightmap {
  header: HeightmapHeader;
  samples: Int16Array;
}

/** Thrown when the header and binary payload disagree — a corrupt or truncated fetch. */
export class HeightmapError extends Error {}

/**
 * Validate a header/sample pair before any sampling happens.
 *
 * A truncated download would otherwise read as silently wrong elevations rather than
 * an error, and a wrong elevation is exactly the failure this whole subsystem exists
 * to prevent.
 */
export function createHeightmap(header: HeightmapHeader, samples: Int16Array): Heightmap {
  if (header.format !== 'plaster-void-heightmap') {
    throw new HeightmapError(`unexpected heightmap format ${header.format}`);
  }
  if (header.version !== 1) {
    throw new HeightmapError(`unsupported heightmap version ${header.version}`);
  }
  if (header.dtype !== 'int16') {
    throw new HeightmapError(`unsupported dtype ${header.dtype}`);
  }
  const expected = header.width * header.height;
  if (samples.length !== expected) {
    throw new HeightmapError(
      `heightmap payload has ${samples.length} samples, header declares ${expected} ` +
        `(${header.width}x${header.height}) — likely a truncated download`,
    );
  }
  if (!(header.dLon > 0) || !(header.dLat > 0)) {
    throw new HeightmapError('heightmap grid spacing must be positive');
  }
  return { header, samples };
}

/** Raw sample at integer grid coordinates, or undefined for nodata / out of range. */
function rawAt(map: Heightmap, col: number, row: number): number | undefined {
  const { width, height, nodata, scale, offset } = map.header;
  if (col < 0 || col >= width || row < 0 || row >= height) return undefined;
  const v = map.samples[row * width + col];
  if (v === nodata) return undefined;
  return v * scale + offset;
}

/**
 * Ground elevation at a position, DHHN2016 orthometric metres.
 *
 * Bilinearly interpolated: the grid is ~10 m and the app cares about metre-level
 * accuracy, so nearest-neighbour would introduce up to ~5 m of quantisation on sloped
 * ground. Returns undefined outside coverage or where any contributing corner is
 * nodata — never a fabricated value, because a plausible-looking wrong elevation is
 * worse than an explicit miss.
 */
export function sampleGroundOrthometric(
  map: Heightmap,
  lat: number,
  lon: number,
): number | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;

  const { bbox, dLon, dLat } = map.header;
  if (lon < bbox.lonMin || lon > bbox.lonMax || lat < bbox.latMin || lat > bbox.latMax) {
    return undefined;
  }

  // Row order is south-to-north and column order west-to-east (see the header).
  const fc = (lon - bbox.lonMin) / dLon;
  const fr = (lat - bbox.latMin) / dLat;

  // Clamp the interpolation CELL (not the position) so that a point exactly on the
  // north or east edge still has four valid corners. Without this, fr == height - 1
  // selects a row that does not exist and the whole sample is lost — silently turning
  // the entire top and right boundary into a coverage miss.
  const { width, height } = map.header;
  const c0 = Math.min(Math.max(Math.floor(fc), 0), Math.max(width - 2, 0));
  const r0 = Math.min(Math.max(Math.floor(fr), 0), Math.max(height - 2, 0));
  const tc = fc - c0;
  const tr = fr - r0;

  const v00 = rawAt(map, c0, r0);
  const v10 = rawAt(map, c0 + 1, r0);
  const v01 = rawAt(map, c0, r0 + 1);
  const v11 = rawAt(map, c0 + 1, r0 + 1);

  // Degenerate 1xN or Nx1 grids have no second row/column at all.
  if (v00 !== undefined && v10 === undefined && v01 === undefined && v11 === undefined) {
    return v00;
  }
  if (v00 === undefined || v10 === undefined || v01 === undefined || v11 === undefined) {
    return undefined;
  }

  const bottom = v00 + (v10 - v00) * tc;
  const top = v01 + (v11 - v01) * tc;
  return bottom + (top - bottom) * tr;
}

/** True when a position lies within the heightmap's coverage. */
export function isWithinCoverage(map: Heightmap, lat: number, lon: number): boolean {
  const { bbox } = map.header;
  return lon >= bbox.lonMin && lon <= bbox.lonMax && lat >= bbox.latMin && lat <= bbox.latMax;
}

/**
 * Decode a fetched heightmap binary into an Int16Array.
 *
 * The file is little-endian; on a big-endian host a direct Int16Array view would
 * silently produce garbage, so byte order is handled explicitly.
 */
export function decodeSamples(buffer: ArrayBuffer): Int16Array {
  const littleEndianHost = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (littleEndianHost) return new Int16Array(buffer);

  const view = new DataView(buffer);
  const out = new Int16Array(buffer.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}
