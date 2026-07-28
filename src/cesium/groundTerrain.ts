/**
 * Builds the globe's terrain from the committed DGM1 heightmap, so the plaster ground
 * sits under the buildings instead of ~77 m below them.
 *
 * Thin Cesium adapter — all the sampling math is pure and Vitest-covered in
 * src/lib/terrainTile.ts (Constitution Principle I). Reads the Cesium UMD global the
 * same way CesiumViewer.tsx does, so no cesium ESM enters the module graph.
 *
 * WHY CustomHeightmapTerrainProvider, AND THE TWO TRAPS IN IT
 * ----------------------------------------------------------
 * It is the supported way to serve terrain from an in-memory grid without subclassing
 * TerrainProvider. Two details are easy to get wrong and both produce garbage geometry
 * rather than an error:
 *
 *  1. THE CALLBACK MUST RETURN A RAW TypedArray — NOT a HeightmapTerrainData.
 *     CustomHeightmapTerrainProvider.requestTileGeometry wraps whatever the callback
 *     returns in `new HeightmapTerrainData({ buffer: <your return value>, ... })`
 *     (node_modules/@cesium/engine/Source/Core/CustomHeightmapTerrainProvider.js:230).
 *     Returning a HeightmapTerrainData makes `buffer` a non-array object, and the
 *     tessellator then reads undefined heights — the globe comes out mangled.
 *
 *  2. THE TILING SCHEME MUST COVER THE WHOLE GLOBE.
 *     Cesium's quadtree tiles the entire planet with the provider's scheme. Handing it
 *     a scheme whose rectangle is only the Berlin bbox (e.g. 1x1 level-zero tiles over
 *     0.14 deg x 0.034 deg) leaves the quadtree subdividing a sliver with a ~4:1 aspect
 *     where it expects 2:1, and the surface renders wrong. We therefore use the DEFAULT
 *     global GeographicTilingScheme and handle "outside Berlin" in the sampler instead,
 *     by edge-extending the grid (see src/lib/terrainTile.ts).
 */
import type * as CesiumType from 'cesium';
import type { Heightmap } from '../lib/heightmap.js';
import { sampleTerrainTile } from '../lib/terrainTile.js';

const Cesium = (window as unknown as { Cesium: typeof CesiumType }).Cesium;

/**
 * Samples per terrain tile edge. 64 is Cesium's own heightmap tile size; across a tile
 * small enough to matter visually it resolves the 10 m DGM1 grid with room to spare.
 */
const TILE_SAMPLES = 64;

/**
 * Deepest terrain level served. A geographic tile at level 16 is roughly 300 m across,
 * so 64 samples over it is ~5 m — already finer than the 10 m DGM1 source. Refining
 * past that spends tiles and main-thread time inventing detail the data does not have.
 * Beyond this level Cesium upsamples from the parent mesh, which is exactly the
 * interpolation we would have produced anyway.
 */
const MAX_TERRAIN_LEVEL = 16;

/**
 * Create a terrain provider that serves the DGM1 grid as the globe's surface.
 *
 * Heights handed to Cesium are ELLIPSOIDAL (the geoid undulation is applied once, in
 * the pure sampler) so the ground shares the datum the building tiles were baked in.
 */
export function createGroundTerrainProvider(
  map: Heightmap,
): CesiumType.CustomHeightmapTerrainProvider {
  // Default (global) GeographicTilingScheme — see trap 2 above.
  const provider = new Cesium.CustomHeightmapTerrainProvider({
    width: TILE_SAMPLES,
    height: TILE_SAMPLES,
    callback: (x: number, y: number, level: number) => {
      const rect = provider.tilingScheme.tileXYToRectangle(x, y, level);
      // tileXYToRectangle returns RADIANS; the pure sampler works in degrees.
      return sampleTerrainTile(
        map,
        {
          west: Cesium.Math.toDegrees(rect.west),
          south: Cesium.Math.toDegrees(rect.south),
          east: Cesium.Math.toDegrees(rect.east),
          north: Cesium.Math.toDegrees(rect.north),
        },
        TILE_SAMPLES,
        TILE_SAMPLES,
      );
    },
  });

  // Stop SAMPLING past the resolution the DGM1 source actually carries.
  //
  // Precisely what this does: it does NOT halt refinement. Cesium's canRefine only
  // needs a defined answer, and `false` is defined, so the quadtree still descends.
  // What it does is mark deeper tiles as having no data, which routes them to
  // "upsample from the parent mesh" — the same interpolation this sampler would have
  // produced, minus 4096 bilinear samples and a tile request per tile. The visible
  // surface is unchanged; only the invented detail is skipped.
  (
    provider as unknown as {
      getTileDataAvailable: (x: number, y: number, level: number) => boolean | undefined;
    }
  ).getTileDataAvailable = (_x: number, _y: number, level: number) =>
    level <= MAX_TERRAIN_LEVEL ? true : false;

  return provider;
}
