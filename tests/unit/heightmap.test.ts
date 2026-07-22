/**
 * Heightmap sampler tests, including a load of the REAL committed Berlin grid.
 *
 * Sampling the real asset matters: a synthetic fixture would happily pass while the
 * shipped binary was byte-swapped, transposed, or built with an inverted row order —
 * all of which produce plausible-looking but wrong elevations, the precise failure
 * this subsystem exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createHeightmap,
  sampleGroundOrthometric,
  isWithinCoverage,
  decodeSamples,
  HeightmapError,
  type HeightmapHeader,
} from '../../src/lib/heightmap.js';

/** A tiny 3x2 synthetic grid with exactly known values. */
function fixture(): { header: HeightmapHeader; samples: Int16Array } {
  const header: HeightmapHeader = {
    format: 'plaster-void-heightmap',
    version: 1,
    dtype: 'int16',
    scale: 0.1,
    offset: 0,
    nodata: -32768,
    width: 3,
    height: 2,
    bbox: { lonMin: 13.0, latMin: 52.0, lonMax: 13.2, latMax: 52.1 },
    dLon: 0.1,
    dLat: 0.1,
  };
  // row 0 (south): 10, 20, 30 m ; row 1 (north): 50, 60, 70 m
  const samples = Int16Array.from([100, 200, 300, 500, 600, 700]);
  return { header, samples };
}

describe('createHeightmap validation', () => {
  it('accepts a well-formed pair', () => {
    const { header, samples } = fixture();
    expect(() => createHeightmap(header, samples)).not.toThrow();
  });

  it('rejects a truncated payload rather than sampling garbage', () => {
    const { header, samples } = fixture();
    expect(() => createHeightmap(header, samples.slice(0, 4))).toThrow(HeightmapError);
  });

  it('rejects an unknown format or version', () => {
    const { header, samples } = fixture();
    expect(() => createHeightmap({ ...header, format: 'nope' }, samples)).toThrow(HeightmapError);
    expect(() => createHeightmap({ ...header, version: 99 }, samples)).toThrow(HeightmapError);
  });

  it('rejects non-positive grid spacing', () => {
    const { header, samples } = fixture();
    expect(() => createHeightmap({ ...header, dLat: 0 }, samples)).toThrow(HeightmapError);
  });
});

describe('sampleGroundOrthometric', () => {
  const { header, samples } = fixture();
  const map = createHeightmap(header, samples);

  it('returns exact grid values at nodes', () => {
    expect(sampleGroundOrthometric(map, 52.0, 13.0)).toBeCloseTo(10, 6);
    expect(sampleGroundOrthometric(map, 52.0, 13.2)).toBeCloseTo(30, 6);
    expect(sampleGroundOrthometric(map, 52.1, 13.0)).toBeCloseTo(50, 6);
    expect(sampleGroundOrthometric(map, 52.1, 13.2)).toBeCloseTo(70, 6);
  });

  it('interpolates bilinearly between nodes', () => {
    // Halfway east on the south row: between 10 and 20 -> 15.
    expect(sampleGroundOrthometric(map, 52.0, 13.05)).toBeCloseTo(15, 6);
    // Halfway north on the west column: between 10 and 50 -> 30.
    expect(sampleGroundOrthometric(map, 52.05, 13.0)).toBeCloseTo(30, 6);
    // Centre of the first cell: mean of 10, 20, 50, 60 -> 35.
    expect(sampleGroundOrthometric(map, 52.05, 13.05)).toBeCloseTo(35, 6);
  });

  it('orients rows south-to-north, matching the header', () => {
    // A transposed or flipped grid is the classic silent failure. North must be higher.
    const south = sampleGroundOrthometric(map, 52.0, 13.1)!;
    const north = sampleGroundOrthometric(map, 52.1, 13.1)!;
    expect(north).toBeGreaterThan(south);
  });

  it('returns undefined outside coverage rather than extrapolating', () => {
    expect(sampleGroundOrthometric(map, 52.5, 13.1)).toBeUndefined();
    expect(sampleGroundOrthometric(map, 52.05, 12.0)).toBeUndefined();
  });

  it('returns undefined for non-finite input', () => {
    expect(sampleGroundOrthometric(map, NaN, 13.1)).toBeUndefined();
    expect(sampleGroundOrthometric(map, 52.05, Infinity)).toBeUndefined();
  });

  it('returns undefined when a contributing corner is nodata', () => {
    const holed = createHeightmap(header, Int16Array.from([100, -32768, 300, 500, 600, 700]));
    expect(sampleGroundOrthometric(holed, 52.05, 13.05)).toBeUndefined();
  });
});

describe('isWithinCoverage', () => {
  const { header, samples } = fixture();
  const map = createHeightmap(header, samples);

  it('discriminates inside from outside', () => {
    expect(isWithinCoverage(map, 52.05, 13.1)).toBe(true);
    expect(isWithinCoverage(map, 51.0, 13.1)).toBe(false);
  });
});

describe('the REAL committed Berlin heightmap', () => {
  const header = JSON.parse(
    readFileSync('public/heightmap/berlin-dgm1.json', 'utf8'),
  ) as HeightmapHeader & { stats: Record<string, number>; byteLength: number };
  const buf = readFileSync('public/heightmap/berlin-dgm1.bin');
  const samples = decodeSamples(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  const map = createHeightmap(header, samples);

  it('header and binary agree', () => {
    expect(samples.length).toBe(header.width * header.height);
    expect(buf.byteLength).toBe(header.byteLength);
  });

  it('covers both the observer and the Fernsehturm', () => {
    // The build script hard-fails if these fall outside; assert it here too, because
    // an AOI that misses the observer silently reverts them to the fallback elevation.
    expect(isWithinCoverage(map, 52.5113, 13.4988)).toBe(true); // Lichtenberger Brücke
    expect(isWithinCoverage(map, 52.520815, 13.409419)).toBe(true); // Fernsehturm
  });

  it('reports plausible Berlin ground at the Fernsehturm', () => {
    // The LoD2 building's own GroundSurface sits at 34.34-34.63 m DHHN2016. An
    // independent terrain source agreeing to ~1 m cross-validates the whole datum
    // chain — if the geoid had been double-applied this would read ~74 m.
    const h = sampleGroundOrthometric(map, 52.520815, 13.409419)!;
    expect(h).toBeGreaterThan(30);
    expect(h).toBeLessThan(40);
  });

  it('reports plausible ground at the Lichtenberger Brücke — the TERRAIN, not the deck', () => {
    // DGM1 is bare earth, so this is the rail cutting (~39 m), NOT the 48.2 m deck.
    // That gap is exactly why viewpoints.ts carries a surfaceOrthometric override.
    const h = sampleGroundOrthometric(map, 52.5113, 13.4988)!;
    expect(h).toBeGreaterThan(30);
    expect(h).toBeLessThan(45);
  });

  it('stays inside the documented statistical range across a sweep', () => {
    // Guards against a byte-order or scale error, which would blow these bounds wildly.
    const { bbox } = header;
    let min = Infinity;
    let max = -Infinity;
    let hits = 0;
    for (let i = 0; i <= 40; i++) {
      for (let j = 0; j <= 40; j++) {
        const lat = bbox.latMin + ((bbox.latMax - bbox.latMin) * i) / 40;
        const lon = bbox.lonMin + ((bbox.lonMax - bbox.lonMin) * j) / 40;
        const h = sampleGroundOrthometric(map, lat, lon);
        if (h === undefined) continue;
        hits++;
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    }
    expect(hits).toBeGreaterThan(1600);
    expect(min).toBeGreaterThan(10);
    expect(max).toBeLessThan(95);
  });
});
