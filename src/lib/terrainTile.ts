/**
 * Turns the DGM1 heightmap into the raw height grids Cesium's heightmap terrain
 * consumes. Pure math, NO Cesium (Constitution Principle I) — the caller supplies the
 * tile rectangle in degrees, so this is fully Vitest-covered without a WebGL context.
 *
 * WHY THIS EXISTS
 * ---------------
 * The globe was the bare WGS84 ellipsoid (height 0) while the 3D Tiles buildings are
 * baked at ELLIPSOIDAL heights — Berlin ground is ~34-41 m orthometric plus the 39.5 m
 * geoid undulation, so building bases sit near 73-80 m. The whole city therefore
 * floated ~77 m above the rendered ground. Feeding the SAME DGM1 grid to the globe as
 * terrain puts the plaster ground back under the buildings.
 *
 * THE TWO CONVENTIONS THAT MUST NOT BE GOT WRONG
 * ----------------------------------------------
 *  1. ROW ORDER. Cesium's HeightmapTerrainData is documented as "a rectangular array of
 *     heights in row-major order FROM NORTH TO SOUTH and WEST TO EAST" (see
 *     node_modules/@cesium/engine/Source/Core/HeightmapTerrainData.js). So row 0 is the
 *     NORTH edge and column 0 is the WEST edge. Getting this wrong mirrors the terrain.
 *  2. VERTICAL DATUM. The grid is orthometric (DHHN2016); Cesium wants ellipsoidal.
 *     The geoid undulation is applied here EXACTLY ONCE, via the same
 *     `orthometricToEllipsoidal` every other consumer uses, so it can never be
 *     double-counted against the value scripts/convert_tile.py baked into the tiles.
 *
 * OUTSIDE THE AOI: the DGM1 grid covers only a ~9.5 x 3.8 km strip of Berlin, but the
 * globe asks for tiles across the whole planet. Sampling coordinates are CLAMPED to the
 * grid's bounding box (edge extension) rather than dropped, so the surface leaves the
 * AOI continuously instead of falling off a ~77 m cliff at the boundary.
 */
import { sampleGroundOrthometric, type Heightmap } from './heightmap.js';
import {
  BERLIN_GROUND_ORTHOMETRIC_FALLBACK,
  orthometricToEllipsoidal,
} from './elevation.js';

/** A tile's geographic extent in DEGREES. Mirrors Cesium.Rectangle, without Cesium. */
export interface TileRectangleDegrees {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Linear interpolation; `t` is not clamped (callers pass t in [0,1]). */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Ground elevation at a position, edge-extended beyond the grid's coverage.
 *
 * Returns ORTHOMETRIC metres. Positions outside the bounding box are clamped onto the
 * nearest edge so the caller always gets a finite, continuous value; a nodata hole
 * degrades to the Berlin mean rather than punching a spike through the terrain.
 */
export function sampleGroundClamped(map: Heightmap, lat: number, lon: number): number {
  const { bbox } = map.header;
  const clampedLat = clamp(lat, bbox.latMin, bbox.latMax);
  const clampedLon = clamp(lon, bbox.lonMin, bbox.lonMax);
  const sampled = sampleGroundOrthometric(map, clampedLat, clampedLon);
  return sampled ?? BERLIN_GROUND_ORTHOMETRIC_FALLBACK;
}

/**
 * Sample the heightmap into one Cesium terrain tile.
 *
 * @param map    Decoded DGM1 grid (orthometric samples).
 * @param rect   The tile's extent in degrees.
 * @param width  Columns per tile (west -> east).
 * @param height Rows per tile (north -> south).
 * @returns A `width * height` Float32Array of ELLIPSOIDAL metres, row-major, row 0 =
 *          north, column 0 = west — exactly what Cesium.HeightmapTerrainData expects.
 *
 * Throws on a non-positive grid size: a zero-sized tile would otherwise surface as an
 * invisible hole in the globe rather than an error.
 */
export function sampleTerrainTile(
  map: Heightmap,
  rect: TileRectangleDegrees,
  width: number,
  height: number,
): Float32Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(
      `terrain tile size must be positive integers, received ${width}x${height}`,
    );
  }

  const out = new Float32Array(width * height);
  // A 1-wide or 1-tall tile has no span to interpolate across; sample its north/west
  // edge rather than dividing by zero.
  const lastCol = width > 1 ? width - 1 : 1;
  const lastRow = height > 1 ? height - 1 : 1;

  for (let row = 0; row < height; row++) {
    // Row 0 is the NORTH edge — see the header comment.
    const lat = lerp(rect.north, rect.south, row / lastRow);
    for (let col = 0; col < width; col++) {
      const lon = lerp(rect.west, rect.east, col / lastCol);
      const orthometric = sampleGroundClamped(map, lat, lon);
      out[row * width + col] = orthometricToEllipsoidal(orthometric);
    }
  }

  return out;
}
