/**
 * Guards for the DGM1 -> Cesium terrain-tile sampler.
 *
 * These exist because the two ways to get this wrong (mirrored rows, and a
 * double-applied or missing geoid undulation) BOTH produce a scene that renders
 * without erroring — one silently mirrors Berlin's terrain, the other floats or buries
 * the whole city. Neither would be caught by "does it throw".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createHeightmap,
  decodeSamples,
  sampleGroundOrthometric,
  type HeightmapHeader,
} from '../../src/lib/heightmap.js';
import {
  sampleTerrainTile,
  sampleGroundClamped,
  type TileRectangleDegrees,
} from '../../src/lib/terrainTile.js';
import {
  GEOID_UNDULATION_BERLIN,
  BERLIN_GROUND_ORTHOMETRIC_FALLBACK,
  orthometricToEllipsoidal,
} from '../../src/lib/elevation.js';
import { resolveObserverHeight } from '../../src/lib/sceneHeights.js';
import { BERLIN_BOUNDS } from '../../src/lib/berlin.js';

/**
 * A 2x2 grid over a 1-degree box with a distinct value per corner, so any transpose or
 * flip changes the result. Rows are south-to-north in the SOURCE grid (the DGM1 header
 * convention) — the tile sampler must emit north-to-south.
 *
 *   source row 1 (north):  30 (west)  40 (east)
 *   source row 0 (south):  10 (west)  20 (east)
 */
function cornerGrid() {
  const header: HeightmapHeader = {
    format: 'plaster-void-heightmap',
    version: 1,
    dtype: 'int16',
    scale: 1,
    offset: 0,
    nodata: -32768,
    width: 2,
    height: 2,
    bbox: { lonMin: 13, latMin: 52, lonMax: 14, latMax: 53 },
    dLon: 1,
    dLat: 1,
  };
  // index = row * width + col, row 0 = south, col 0 = west
  const samples = new Int16Array([10, 20, 30, 40]);
  return createHeightmap(header, samples);
}

const FULL: TileRectangleDegrees = { west: 13, south: 52, east: 14, north: 53 };

describe('sampleTerrainTile', () => {
  it('emits row 0 = NORTH and column 0 = WEST (Cesium HeightmapTerrainData order)', () => {
    const map = cornerGrid();
    const tile = sampleTerrainTile(map, FULL, 2, 2);

    // Cesium reads row-major from the NORTH-WEST corner. The north-west source value is
    // 30, north-east 40, south-west 10, south-east 20 — each lifted by the geoid.
    const g = GEOID_UNDULATION_BERLIN;
    expect(Array.from(tile)).toEqual([30 + g, 40 + g, 10 + g, 20 + g]);
  });

  it('is not merely symmetric — a transposed grid would fail the row-order check', () => {
    const map = cornerGrid();
    const tile = sampleTerrainTile(map, FULL, 2, 2);
    // north row is strictly higher than south row, and east strictly higher than west.
    expect(tile[0]).toBeLessThan(tile[1]!); // NW < NE
    expect(tile[2]).toBeLessThan(tile[3]!); // SW < SE
    expect(tile[2]).toBeLessThan(tile[0]!); // SW < NW
  });

  it('applies the geoid undulation exactly once', () => {
    const map = cornerGrid();
    const tile = sampleTerrainTile(map, FULL, 2, 2);
    // South-west corner is 10 m orthometric. Ellipsoidal must be 10 + N, never
    // 10 (geoid missed -> city floats) nor 10 + 2N (double-counted -> city buried).
    expect(tile[2]).toBeCloseTo(10 + GEOID_UNDULATION_BERLIN, 6);
    expect(tile[2]).not.toBeCloseTo(10, 3);
    expect(tile[2]).not.toBeCloseTo(10 + 2 * GEOID_UNDULATION_BERLIN, 3);
  });

  it('interpolates across the tile rather than snapping to nearest', () => {
    const map = cornerGrid();
    // A single-sample tile at the exact centre of the box: bilinear mean of 10,20,30,40.
    const centre: TileRectangleDegrees = {
      west: 13.5,
      south: 52.5,
      east: 13.5,
      north: 52.5,
    };
    const tile = sampleTerrainTile(map, centre, 1, 1);
    expect(tile[0]).toBeCloseTo(25 + GEOID_UNDULATION_BERLIN, 6);
  });

  it('produces exactly width*height samples', () => {
    const map = cornerGrid();
    expect(sampleTerrainTile(map, FULL, 8, 5)).toHaveLength(40);
    expect(sampleTerrainTile(map, FULL, 64, 64)).toHaveLength(4096);
  });

  it('rejects a degenerate tile size instead of punching a hole in the globe', () => {
    const map = cornerGrid();
    expect(() => sampleTerrainTile(map, FULL, 0, 64)).toThrow(RangeError);
    expect(() => sampleTerrainTile(map, FULL, 64, -1)).toThrow(RangeError);
    expect(() => sampleTerrainTile(map, FULL, 1.5, 64)).toThrow(RangeError);
  });

  it('edge-extends outside the grid instead of falling off a cliff', () => {
    const map = cornerGrid();
    // A tile far to the east of the AOI: every sample clamps onto the east edge, so the
    // surface leaves coverage continuously rather than dropping ~77 m to the ellipsoid.
    const faraway: TileRectangleDegrees = { west: 20, south: 52, east: 21, north: 53 };
    const tile = sampleTerrainTile(map, faraway, 2, 2);
    const g = GEOID_UNDULATION_BERLIN;
    // Clamped to lon 14 (east edge): north 40, south 20.
    expect(Array.from(tile)).toEqual([40 + g, 40 + g, 20 + g, 20 + g]);
    // Critically: nothing anywhere near ellipsoidal zero.
    for (const h of tile) expect(h).toBeGreaterThan(g);
  });

  it('returns finite ellipsoidal heights for a whole-globe tile', () => {
    const map = cornerGrid();
    const world: TileRectangleDegrees = { west: -180, south: -90, east: 180, north: 90 };
    const tile = sampleTerrainTile(map, world, 16, 16);
    for (const h of tile) {
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(0);
    }
  });
});

describe('sampleGroundClamped', () => {
  it('matches the plain sampler inside coverage', () => {
    const map = cornerGrid();
    expect(sampleGroundClamped(map, 52, 13)).toBeCloseTo(10, 6);
    expect(sampleGroundClamped(map, 53, 14)).toBeCloseTo(40, 6);
  });

  it('clamps onto the nearest edge outside coverage', () => {
    const map = cornerGrid();
    expect(sampleGroundClamped(map, 52, 0)).toBeCloseTo(10, 6); // far west, south row
    expect(sampleGroundClamped(map, 99, 99)).toBeCloseTo(40, 6); // far north-east corner
  });

  it('falls back to the Berlin mean on a nodata hole rather than spiking', () => {
    const header: HeightmapHeader = {
      format: 'plaster-void-heightmap',
      version: 1,
      dtype: 'int16',
      scale: 1,
      offset: 0,
      nodata: -32768,
      width: 2,
      height: 2,
      bbox: { lonMin: 13, latMin: 52, lonMax: 14, latMax: 53 },
      dLon: 1,
      dLat: 1,
    };
    const map = createHeightmap(header, new Int16Array([-32768, -32768, -32768, -32768]));
    expect(sampleGroundClamped(map, 52.5, 13.5)).toBe(BERLIN_GROUND_ORTHOMETRIC_FALLBACK);
  });
});

/**
 * The synthetic grids above prove the CONVENTIONS. These prove the fix against the
 * data that actually ships — the failure this whole change exists to prevent is a
 * scene that renders happily with the city 77 m off the ground, which no
 * convention-level assertion can catch.
 *
 * Float32Array round-trips the samples, so compare with a tolerance rather than
 * exact equality (observed max deviation ~4e-6 m).
 */
describe('the REAL committed Berlin heightmap, as terrain', () => {
  const header = JSON.parse(
    readFileSync('public/heightmap/berlin-dgm1.json', 'utf8'),
  ) as HeightmapHeader;
  const buf = readFileSync('public/heightmap/berlin-dgm1.bin');
  const samples = decodeSamples(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  const map = createHeightmap(header, samples);
  const { bbox } = header;

  /** Single-sample tile at a point — the terrain height the globe will render there. */
  const terrainAt = (lat: number, lon: number): number =>
    sampleTerrainTile(map, { west: lon, east: lon, south: lat, north: lat }, 1, 1)[0]!;

  it('THE BUG: the city does not float — ground under the Fernsehturm is ~74-75 m', () => {
    // Fernsehturm base sits at ~35.3 m orthometric. Ellipsoidal must therefore be
    // ~74.8. This single assertion discriminates every way the datum can go wrong:
    //   ~35  -> geoid never applied  (city floats 39.5 m above the ground)
    //   ~114 -> geoid applied twice  (city buried 39.5 m under it)
    //   0    -> no terrain at all    (the original bug: city floats ~75 m)
    const h = terrainAt(52.520815, 13.409419);
    expect(h).toBeGreaterThan(74);
    expect(h).toBeLessThan(75.5);
  });

  it('renders the SAME ground the occlusion elevations are resolved from', () => {
    // One source of truth. If these ever drift, the photographer stands at a height the
    // scene does not draw, and the sightline is computed against invisible geometry.
    const probes: Array<[number, number]> = [
      [52.5182, 13.4285], // Strausberger Platz (default observer)
      [52.520815, 13.409419], // Fernsehturm
      [52.5219, 13.4132], // Alexanderplatz
      [52.5113, 13.4988], // Lichtenberger Brücke
      [52.5152, 13.4186], // Jannowitzbrücke
    ];
    for (const [lat, lon] of probes) {
      const direct = sampleGroundOrthometric(map, lat, lon);
      expect(direct, `no coverage at ${lat},${lon}`).toBeDefined();
      expect(Math.abs(terrainAt(lat, lon) - orthometricToEllipsoidal(direct!))).toBeLessThan(1e-4);
    }
  });

  it('keeps row 0 = north on real terrain, where a flip cannot hide', () => {
    // A symmetric synthetic grid hides a north/south flip; real relief does not.
    const rect = { west: 13.40, east: 13.42, south: bbox.latMin + 0.002, north: bbox.latMax - 0.002 };
    const w = 8;
    const h = 8;
    const tile = sampleTerrainTile(map, rect, w, h);
    const northWest = orthometricToEllipsoidal(sampleGroundOrthometric(map, rect.north, rect.west)!);
    const southWest = orthometricToEllipsoidal(sampleGroundOrthometric(map, rect.south, rect.west)!);
    expect(Math.abs(tile[0]! - northWest)).toBeLessThan(1e-4);
    expect(Math.abs(tile[(h - 1) * w]! - southWest)).toBeLessThan(1e-4);
    // And the two edges must actually differ, or this test proves nothing.
    expect(Math.abs(northWest - southWest)).toBeGreaterThan(0.5);
  });

  it('leaves the AOI without a cliff', () => {
    // Edge extension, not a 77 m drop to the ellipsoid, at every boundary.
    const midLat = (bbox.latMin + bbox.latMax) / 2;
    const midLon = (bbox.lonMin + bbox.lonMax) / 2;
    // Straddle each edge by ~0.1 m. A wider straddle measures Berlin's real slope
    // rather than the discontinuity we care about (1e-4 deg is ~11 m, over which the
    // ground legitimately moves ~0.2 m).
    const E = 1e-6;
    const pairs: Array<[[number, number], [number, number]]> = [
      [[midLat, bbox.lonMin + E], [midLat, bbox.lonMin - E]],
      [[midLat, bbox.lonMax - E], [midLat, bbox.lonMax + E]],
      [[bbox.latMin + E, midLon], [bbox.latMin - E, midLon]],
      [[bbox.latMax - E, midLon], [bbox.latMax + E, midLon]],
    ];
    for (const [[inLat, inLon], [outLat, outLon]] of pairs) {
      expect(Math.abs(terrainAt(inLat, inLon) - terrainAt(outLat, outLon))).toBeLessThan(0.01);
    }
    // Far outside, the surface holds the edge value rather than collapsing.
    expect(terrainAt(midLat, bbox.lonMax + 0.05)).toBeCloseTo(terrainAt(midLat, bbox.lonMax), 3);
  });

  it('stays inside a plausible Berlin band across the whole AOI', () => {
    // Catches a scale, byte-order or datum error that a handful of point probes miss.
    const tile = sampleTerrainTile(
      map,
      { west: bbox.lonMin, east: bbox.lonMax, south: bbox.latMin, north: bbox.latMax },
      64,
      64,
    );
    let min = Infinity;
    let max = -Infinity;
    for (const h of tile) {
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    // Header stats: 16.85-90.50 m orthometric, so 56.35-130.00 ellipsoidal.
    expect(min).toBeGreaterThanOrEqual(56.3);
    expect(max).toBeLessThanOrEqual(130.0);
  });

  it('leaves the default sightline clear of the terrain', () => {
    // Strausberger Platz eye -> Fernsehturm tip must not graze the ground. Skips the
    // first 20 m so the observer's own footing cannot register as an occluder.
    const obsLat = 52.5182;
    const obsLon = 13.4285;
    const tgtLat = 52.520815;
    const tgtLon = 13.409419;
    const eye = terrainAt(obsLat, obsLon) + 1.5;
    const tip = terrainAt(tgtLat, tgtLon) + 368.03;

    const dLatM = (tgtLat - obsLat) * 111_320;
    const dLonM = (tgtLon - obsLon) * 111_320 * Math.cos((obsLat * Math.PI) / 180);
    const range = Math.hypot(dLatM, dLonM);

    let minClearance = Infinity;
    const STEPS = 400;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      if (t * range < 20) continue; // skip the observer's own footing
      const lat = obsLat + (tgtLat - obsLat) * t;
      const lon = obsLon + (tgtLon - obsLon) * t;
      minClearance = Math.min(minClearance, eye + (tip - eye) * t - terrainAt(lat, lon));
    }
    expect(minClearance).toBeGreaterThan(5);
  });
});

/**
 * THE B5 REGRESSION GUARD.
 *
 * The map lets an observer be placed anywhere in a ~44 x 47 km Berlin box
 * (src/lib/berlin.ts), but the DGM1 grid covers only ~9.5 x 3.8 km of it. Once the
 * globe carries edge-extended terrain, resolving out-of-coverage eyes to the 34 m
 * Berlin mean puts the photographer BELOW the ground that is actually drawn — measured
 * at -22.3 m on the northern fringe, i.e. a full-frame plaster whiteout.
 *
 * Passing the same edge-extended sampler to resolveObserverHeight makes clearance equal
 * the eye height everywhere by construction. This asserts exactly that.
 */
describe('the eye is never underground, anywhere in the placement bbox', () => {
  const header = JSON.parse(
    readFileSync('public/heightmap/berlin-dgm1.json', 'utf8'),
  ) as HeightmapHeader;
  const buf = readFileSync('public/heightmap/berlin-dgm1.bin');
  const samples = decodeSamples(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  const map = createHeightmap(header, samples);

  const strict = (lat: number, lon: number) => sampleGroundOrthometric(map, lat, lon);
  const extrapolate = (lat: number, lon: number) => sampleGroundClamped(map, lat, lon);

  it('clears the RENDERED ground across a sweep of the placement bbox', () => {
    const EYE = 1.5;
    let worst = Infinity;
    let worstAt = '';
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        const lat = BERLIN_BOUNDS.minLat + (BERLIN_BOUNDS.maxLat - BERLIN_BOUNDS.minLat) * (i / 20);
        const lon = BERLIN_BOUNDS.minLon + (BERLIN_BOUNDS.maxLon - BERLIN_BOUNDS.minLon) * (j / 20);
        const eye = resolveObserverHeight(lat, lon, EYE, strict, undefined, extrapolate)
          .ellipsoidalHeight;
        const renderedGround = orthometricToEllipsoidal(sampleGroundClamped(map, lat, lon));
        const clearance = eye - renderedGround;
        if (clearance < worst) {
          worst = clearance;
          worstAt = `${lat.toFixed(4)},${lon.toFixed(4)}`;
        }
      }
    }
    // Clearance is the eye height itself, everywhere — no position is underground.
    expect(worst, `worst clearance ${worst.toFixed(2)} m at ${worstAt}`).toBeCloseTo(EYE, 3);
  });

  it('still reports out-of-coverage positions honestly', () => {
    // Inside the DGM1 grid -> 'terrain'. Outside it -> 'extrapolated', never a silent
    // 'terrain' that would imply accuracy the sample does not have.
    const inside = resolveObserverHeight(52.5182, 13.4285, 1.5, strict, undefined, extrapolate);
    expect(inside.surfaceSource).toBe('terrain');

    const outside = resolveObserverHeight(52.56, 13.42, 1.5, strict, undefined, extrapolate);
    expect(outside.surfaceSource).toBe('extrapolated');

    // With no extrapolating sampler supplied, the old Berlin-mean behaviour is kept.
    const noExtrap = resolveObserverHeight(52.56, 13.42, 1.5, strict);
    expect(noExtrap.surfaceSource).toBe('fallback');
  });
});
